// ─── Shared text-to-speech (voice fix, 2026-11-25) ────────────────
// Every read-aloud surface (Chat, Slides, Viva) used to roll its own
// speechSynthesis code, and the Male/Female selector was broken: voice
// resolution ran synchronously against a possibly-empty getVoices()
// list (voices load async on Chrome/Android), and the fallback chain
// returned the SAME — usually female/default — voice for both
// genders. Pitch alone cannot change a voice's perceived gender, so
// "Male" still sounded female.
//
// This module is the single shared path:
//  • waits for the async voice list (voiceschanged) before choosing,
//  • picks the best gender-matching voice by quality tier (Google →
//    Microsoft Natural/Neural → other named voices → en/ur fallback),
//    scored deterministically (see voiceScore) so the result never
//    depends on the order the OS happens to list voices in,
//  • demotes known robotic / novelty / compact voices (eSpeak,
//    Eloquence, macOS novelty voices, "Compact" variants) to last
//    resort — free voices only, tuned as natural as they can sound
//    (free-voice quality pass, 2026-11-26; no paid TTS by decision),
//  • when the device has NO voice of the requested gender, keeps the
//    best voice but applies a stronger pitch shift as a deliberate
//    fallback (male 0.85, female 1.15 — vs a near-natural 0.95 / 1.05
//    when the voice itself matches the gender),
//  • chunks long text at sentence boundaries (~180 chars) because
//    Chrome/Android degrade or silently cut long utterances,
//  • persists the gender selection across sessions.

export type VoiceGender = "female" | "male";

const GENDER_KEY = "ug-voice-gender";
export const DEFAULT_RATE = 0.97;
const MAX_CHUNK = 180;

export function getVoiceGender(): VoiceGender {
  try {
    return localStorage.getItem(GENDER_KEY) === "male" ? "male" : "female";
  } catch {
    return "female";
  }
}

export function setVoiceGender(gender: VoiceGender): void {
  try {
    localStorage.setItem(GENDER_KEY, gender);
  } catch {
    /* storage unavailable — selection still applies for this session */
  }
}

// Name heuristics. NOTE: "female" contains "male" — gender detection
// must test female hints first (see voiceGenderOf).
const FEMALE_HINTS = [
  "female", "zira", "samantha", "jenny", "aria", "sara", "susan",
  "catherine", "hazel", "sonya", "libby", "michelle", "joana", "veena",
  "heera", "kalpana", "lekha", "priya", "neerja", "swara",
];
const MALE_HINTS = [
  "male", "david", "daniel", "guy", "mark", "roger", "ryan", "george",
  "arthur", "brian", "christopher", "eric", "jacob", "hemant", "madhur",
  "ravi", "salim", "aarav",
];
export function voiceGenderOf(voice: SpeechSynthesisVoice): VoiceGender | null {
  const name = voice.name.toLowerCase();
  if (FEMALE_HINTS.some((h) => name.includes(h))) return "female";
  if (MALE_HINTS.some((h) => name.includes(h))) return "male";
  return null;
}

// ─── Free-voice quality ranking (2026-11-26) ──────────────────────
// The audience is ~90% Android Chrome, where the best free voices are
// Google's; desktop Chrome offers the same Google voices plus OS
// voices. Rank by a deterministic score instead of "first quality
// voice in OS list order" (that order is arbitrary per device):
//   tier 0  Google voices — the most natural free voices on both
//           Android and desktop Chrome.
//   tier 1  "Natural" / "Neural" / "Premium" / "Enhanced" voices
//           (Microsoft Natural, Apple enhanced downloads).
//   tier 2  standard named voices (legacy Microsoft David/Zira,
//           Samantha, Daniel, Samsung/OEM engine voices, …).
//   tier 3  known robotic / novelty / compact voices — last resort
//           only, never chosen over a real voice of any gender.
// Within a tier, prefer en-US → en-GB → other English → Urdu → Hindi.
const ROBOTIC_HINTS = [
  "espeak", "eloquence", "compact",
  // macOS novelty voices (joke voices, not narration voices)
  "fred", "albert", "zarvox", "trinoids", "bubbles", "bahh", "boing",
  "cellos", "deranged", "good news", "bad news", "hysterical",
  "pipe organ", "whisper", "grandma", "grandpa", "junior", "ralph",
  "princess", "kathy", "agnes",
];
const ROBOTIC_TIER = 3;

export function qualityTier(v: SpeechSynthesisVoice): number {
  const name = v.name.toLowerCase();
  if (ROBOTIC_HINTS.some((h) => name.includes(h))) return ROBOTIC_TIER;
  if (name.includes("google")) return 0;
  if (["natural", "neural", "premium", "enhanced"].some((h) => name.includes(h))) return 1;
  return 2;
}

const langSubRank = (v: SpeechSynthesisVoice) => {
  // Android engines sometimes report "en_US" — normalise separators.
  const lang = (v.lang || "").toLowerCase().replace(/_/g, "-");
  if (lang.startsWith("en-us")) return 0;
  if (lang.startsWith("en-gb")) return 1;
  if (lang.startsWith("en")) return 2;
  if (lang.startsWith("ur")) return 3;
  if (lang.startsWith("hi")) return 4;
  return 5;
};

/** Lower is better: quality tier dominates, language breaks ties. */
export function voiceScore(v: SpeechSynthesisVoice): number {
  return qualityTier(v) * 10 + langSubRank(v);
}

export interface PickedVoice {
  voice: SpeechSynthesisVoice | null;
  /** True when the picked voice actually matches the requested gender. */
  genderMatched: boolean;
}

/** Best voice for the requested gender, by quality score. Pure — the
 *  caller supplies the (already loaded) voice list. */
export function pickVoice(voices: SpeechSynthesisVoice[], gender: VoiceGender): PickedVoice {
  if (!voices.length) return { voice: null, genderMatched: false };
  const bestOf = (list: SpeechSynthesisVoice[]) =>
    [...list].sort((a, b) => voiceScore(a) - voiceScore(b))[0];
  const matched = voices.filter((v) => voiceGenderOf(v) === gender);
  if (matched.length) {
    return { voice: bestOf(matched), genderMatched: true };
  }
  // No voice of this gender on the device: prefer a gender-NEUTRAL
  // voice (pitch shift works with it, not against a distinctly
  // opposite-gender voice). Robotic/novelty neutrals do NOT count as
  // usable — a real voice of the other gender, pitch-shifted, sounds
  // better than a novelty voice. Pitch compensates (see pitchFor).
  const neutral = voices.filter((v) => voiceGenderOf(v) === null);
  const usableNeutral = neutral.filter((v) => qualityTier(v) < ROBOTIC_TIER);
  const pool = usableNeutral.length ? usableNeutral : voices;
  return { voice: bestOf(pool), genderMatched: false };
}

/** Pitch stays close to 1.0 when the voice itself matches the gender
 *  (a real male/female voice needs no acting — shifting it ±10% only
 *  adds resampling artefacts), and is the deliberate differentiator
 *  when no voice of the requested gender exists. */
export function pitchFor(gender: VoiceGender, genderMatched: boolean): number {
  if (genderMatched) return gender === "male" ? 0.95 : 1.05;
  return gender === "male" ? 0.85 : 1.15;
}

export interface SynthLike {
  getVoices(): SpeechSynthesisVoice[];
  speak(utterance: SpeechSynthesisUtterance): void;
  cancel(): void;
  addEventListener?: (type: string, cb: () => void) => void;
  removeEventListener?: (type: string, cb: () => void) => void;
}

/** Resolve the voice list, waiting for the async voiceschanged event
 *  when the first read comes back empty (Chrome/Android behaviour). */
export function waitForVoices(synth: SynthLike, timeoutMs = 1500): Promise<SpeechSynthesisVoice[]> {
  const now = synth.getVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      synth.removeEventListener?.("voiceschanged", finish);
      resolve(synth.getVoices());
    };
    synth.addEventListener?.("voiceschanged", finish);
    setTimeout(finish, timeoutMs);
    // A second immediate read covers engines that populate silently.
    if (synth.getVoices().length) finish();
  });
}

/** Split text into speakable chunks at sentence boundaries. Long
 *  sentences are split further at commas/semicolons, then spaces. */
export function chunkText(text: string, maxLen = MAX_CHUNK): string[] {
  const clean = (text || "").replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const sentences = clean.match(/[^.!?…۔]+(?:[.!?…۔]+["'”’)]*)?/g) || [clean];
  const chunks: string[] = [];
  let current = "";
  const flush = () => {
    if (current.trim()) chunks.push(current.trim());
    current = "";
  };
  const pushLong = (sentence: string) => {
    let rest = sentence.trim();
    while (rest.length > maxLen) {
      let cut = Math.max(
        rest.lastIndexOf(", ", maxLen),
        rest.lastIndexOf("; ", maxLen),
        rest.lastIndexOf(" ", maxLen),
      );
      if (cut < maxLen * 0.4) cut = maxLen;
      chunks.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    if (rest) current = rest;
  };
  for (const raw of sentences) {
    const sentence = raw.trim();
    if (!sentence) continue;
    if (sentence.length > maxLen) {
      flush();
      pushLong(sentence);
      continue;
    }
    if (current && current.length + 1 + sentence.length > maxLen) flush();
    current = current ? `${current} ${sentence}` : sentence;
  }
  flush();
  return chunks;
}

export interface SpeakOptions {
  gender?: VoiceGender;
  rate?: number;
  onend?: () => void;
  onerror?: () => void;
}

export interface SpeakController {
  stop: () => void;
}

type UtteranceCtor = new (text: string) => SpeechSynthesisUtterance;

/** Speak text through an injected synthesis engine (the public speak()
 *  passes the real window objects; tests pass mocks). Chunks play
 *  sequentially; stop() cancels and silences all pending callbacks. */
export function speakWith(
  synth: SynthLike,
  Ctor: UtteranceCtor,
  text: string,
  opts: SpeakOptions = {},
): SpeakController {
  let stopped = false;
  const controller: SpeakController = {
    stop: () => {
      stopped = true;
      try {
        synth.cancel();
      } catch {
        /* engine already gone */
      }
    },
  };

  const chunks = chunkText(text);
  if (!chunks.length) {
    opts.onend?.();
    return controller;
  }
  const gender = opts.gender ?? getVoiceGender();

  void (async () => {
    const voices = await waitForVoices(synth);
    if (stopped) return;
    const { voice, genderMatched } = pickVoice(voices, gender);
    const pitch = pitchFor(gender, genderMatched);
    let i = 0;
    const next = () => {
      if (stopped) return;
      if (i >= chunks.length) {
        opts.onend?.();
        return;
      }
      const utterance = new Ctor(chunks[i]);
      if (voice) utterance.voice = voice;
      utterance.lang = voice?.lang || "en-US";
      utterance.rate = opts.rate ?? DEFAULT_RATE;
      utterance.pitch = pitch;
      utterance.onend = () => {
        i += 1;
        next();
      };
      utterance.onerror = () => {
        if (!stopped) opts.onerror?.();
      };
      synth.speak(utterance);
    };
    next();
  })();

  return controller;
}

let current: SpeakController | null = null;

/** Stop whatever is currently speaking (any surface). */
export function stopSpeaking(): void {
  current?.stop();
  current = null;
}

/** Speak text aloud with the shared voice resolution + chunking. Any
 *  previous speech (from any surface) is stopped first. */
export function speak(text: string, opts: SpeakOptions = {}): SpeakController {
  stopSpeaking();
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    opts.onend?.();
    return { stop: () => {} };
  }
  current = speakWith(window.speechSynthesis, SpeechSynthesisUtterance, text, opts);
  return current;
}
