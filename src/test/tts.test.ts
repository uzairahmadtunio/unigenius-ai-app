import { describe, it, expect, beforeEach } from "vitest";
import {
  pickVoice,
  pitchFor,
  qualityTier,
  voiceScore,
  voiceGenderOf,
  chunkText,
  waitForVoices,
  speakWith,
  getVoiceGender,
  setVoiceGender,
  type SynthLike,
} from "@/lib/tts";

// Verification for the voice fix (2026-11-25): the Male/Female selector
// must resolve to genuinely different voice/pitch configurations, late
// (async) voice lists must be honoured, and long text must be chunked
// at sentence boundaries. speechSynthesis is mocked throughout — final
// sound quality can only be judged on a real device.

const voice = (name: string, lang = "en-US") =>
  ({ name, lang, voiceURI: name, localService: true, default: false }) as SpeechSynthesisVoice;

class MockUtterance {
  voice: SpeechSynthesisVoice | null = null;
  lang = "";
  rate = 1;
  pitch = 1;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public text: string) {}
}

function mockSynth(initial: SpeechSynthesisVoice[] = []) {
  const listeners = new Map<string, Set<() => void>>();
  const synth = {
    voices: initial,
    spoken: [] as MockUtterance[],
    cancelCount: 0,
    getVoices() {
      return synth.voices;
    },
    speak(u: MockUtterance) {
      synth.spoken.push(u);
    },
    cancel() {
      synth.cancelCount += 1;
    },
    addEventListener(type: string, cb: () => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(cb);
    },
    removeEventListener(type: string, cb: () => void) {
      listeners.get(type)?.delete(cb);
    },
    fireVoicesChanged() {
      listeners.get("voiceschanged")?.forEach((cb) => cb());
    },
  };
  return synth;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

const GENDERED = [
  voice("Google US English"),
  voice("Google UK English Female", "en-GB"),
  voice("Google UK English Male", "en-GB"),
  voice("Microsoft Zira - English (United States)"),
  voice("Microsoft David - English (United States)"),
];

describe("voiceGenderOf / pickVoice", () => {
  it("does not mistake 'Female' for a male voice (substring trap)", () => {
    expect(voiceGenderOf(voice("Google UK English Female", "en-GB"))).toBe("female");
    expect(voiceGenderOf(voice("Google UK English Male", "en-GB"))).toBe("male");
    expect(voiceGenderOf(voice("Google US English"))).toBeNull();
  });

  it("picks different, gender-matching quality voices for male vs female", () => {
    const male = pickVoice(GENDERED, "male");
    const female = pickVoice(GENDERED, "female");
    expect(male.genderMatched).toBe(true);
    expect(female.genderMatched).toBe(true);
    expect(male.voice?.name).toBe("Google UK English Male");
    expect(female.voice?.name).toBe("Google UK English Female");
    expect(male.voice).not.toBe(female.voice);
  });

  it("reports genderMatched=false when the device has no voice of that gender", () => {
    const onlyFemale = [voice("Google UK English Female", "en-GB"), voice("Google US English")];
    const male = pickVoice(onlyFemale, "male");
    expect(male.genderMatched).toBe(false);
    expect(male.voice?.name).toBe("Google US English"); // best-quality fallback
  });

  it("handles an empty voice list", () => {
    expect(pickVoice([], "male")).toEqual({ voice: null, genderMatched: false });
  });
});

describe("voice ranking — free-voice quality pass (2026-11-26)", () => {
  it("ranks Google first, Natural second, legacy third, robotic last", () => {
    expect(qualityTier(voice("Google US English"))).toBe(0);
    expect(qualityTier(voice("Microsoft Aria Online (Natural) - English (United States)"))).toBe(1);
    expect(qualityTier(voice("Microsoft David - English (United States)"))).toBe(2);
    expect(qualityTier(voice("eSpeak English", "en-GB"))).toBe(3);
    expect(qualityTier(voice("Samantha (Compact)"))).toBe(3);
    expect(qualityTier(voice("Fred"))).toBe(3);
  });

  it("prefers a Google voice over a Natural voice regardless of OS list order", () => {
    const naturalFirst = [
      voice("Microsoft Aria Online (Natural) - English (United States)"),
      voice("Google UK English Female", "en-GB"),
    ];
    expect(pickVoice(naturalFirst, "female").voice?.name).toBe("Google UK English Female");
    expect(pickVoice([...naturalFirst].reverse(), "female").voice?.name).toBe("Google UK English Female");
  });

  it("prefers a Natural voice over a legacy voice of the same gender", () => {
    const male = [
      voice("Microsoft David - English (United States)"),
      voice("Microsoft Guy Online (Natural) - English (United States)"),
    ];
    expect(pickVoice(male, "male").voice?.name).toContain("Guy");
  });

  it("prefers en-US over en-GB within the same quality tier", () => {
    const googles = [
      voice("Google UK English Female", "en-GB"),
      voice("Google US English Female"),
    ];
    expect(pickVoice(googles, "female").voice?.name).toBe("Google US English Female");
  });

  it("handles Android-style underscore locales (en_US) in ranking", () => {
    expect(voiceScore(voice("Google US English", "en_US"))).toBeLessThan(
      voiceScore(voice("Google UK English Female", "en_GB")),
    );
  });

  it("never lets a Compact variant beat a standard voice of the same gender", () => {
    const female = [voice("Samantha (Compact)"), voice("Microsoft Zira - English (United States)")];
    expect(pickVoice(female, "female").voice?.name).toContain("Zira");
  });

  it("falls back to a real opposite-gender voice rather than a novelty voice", () => {
    // No female voice on the device; the only gender-neutral voice is
    // the macOS novelty voice "Fred". A pitch-shifted real male voice
    // sounds better than a joke voice.
    const picked = pickVoice([voice("Fred"), voice("Microsoft David - English (United States)")], "female");
    expect(picked.genderMatched).toBe(false);
    expect(picked.voice?.name).toContain("David");
  });

  it("still uses a robotic voice when it is the only one available", () => {
    const picked = pickVoice([voice("eSpeak English", "en-GB")], "female");
    expect(picked.voice?.name).toBe("eSpeak English");
    expect(picked.genderMatched).toBe(false);
  });

  it("on an Android-style list, male and female get the gendered Google voices", () => {
    const android = [
      voice("Google US English"),
      voice("Google UK English Female", "en-GB"),
      voice("Google UK English Male", "en-GB"),
      voice("Google हिन्दी", "hi-IN"),
      voice("English (United States)"),
    ];
    expect(pickVoice(android, "male").voice?.name).toBe("Google UK English Male");
    expect(pickVoice(android, "female").voice?.name).toBe("Google UK English Female");
  });
});

describe("pitchFor", () => {
  it("stays near-natural when the voice matches the gender", () => {
    expect(pitchFor("male", true)).toBe(0.95);
    expect(pitchFor("female", true)).toBe(1.05);
  });

  it("uses the deliberate stronger shift when it does not", () => {
    expect(pitchFor("male", false)).toBe(0.85);
    expect(pitchFor("female", false)).toBe(1.15);
  });
});

describe("speakWith — gender actually changes the spoken configuration", () => {
  it("male and female selections produce different voices and pitches", async () => {
    const maleSynth = mockSynth(GENDERED);
    speakWith(maleSynth as unknown as SynthLike, MockUtterance as any, "Assalam o alaikum, welcome to the lesson.", { gender: "male" });
    await tick();
    expect(maleSynth.spoken).toHaveLength(1);
    expect(maleSynth.spoken[0].voice?.name).toBe("Google UK English Male");
    expect(maleSynth.spoken[0].pitch).toBe(0.95);

    const femaleSynth = mockSynth(GENDERED);
    speakWith(femaleSynth as unknown as SynthLike, MockUtterance as any, "Assalam o alaikum, welcome to the lesson.", { gender: "female" });
    await tick();
    expect(femaleSynth.spoken).toHaveLength(1);
    expect(femaleSynth.spoken[0].voice?.name).toBe("Google UK English Female");
    expect(femaleSynth.spoken[0].pitch).toBe(1.05);

    expect(maleSynth.spoken[0].voice).not.toBe(femaleSynth.spoken[0].voice);
    expect(maleSynth.spoken[0].pitch).not.toBe(femaleSynth.spoken[0].pitch);
  });

  it("differentiates by pitch alone when the device offers only one voice", async () => {
    const single = [voice("Google US English")];
    const maleSynth = mockSynth(single);
    speakWith(maleSynth as unknown as SynthLike, MockUtterance as any, "Hello students.", { gender: "male" });
    await tick();
    const femaleSynth = mockSynth(single);
    speakWith(femaleSynth as unknown as SynthLike, MockUtterance as any, "Hello students.", { gender: "female" });
    await tick();
    expect(maleSynth.spoken[0].voice?.name).toBe("Google US English");
    expect(femaleSynth.spoken[0].voice?.name).toBe("Google US English");
    expect(maleSynth.spoken[0].pitch).toBe(0.85);
    expect(femaleSynth.spoken[0].pitch).toBe(1.15);
  });

  it("honours voices that only arrive via voiceschanged (async load)", async () => {
    const synth = mockSynth([]);
    speakWith(synth as unknown as SynthLike, MockUtterance as any, "Late voices test.", { gender: "male" });
    await tick();
    expect(synth.spoken).toHaveLength(0); // still waiting for the list
    synth.voices = GENDERED;
    synth.fireVoicesChanged();
    await tick();
    expect(synth.spoken).toHaveLength(1);
    expect(synth.spoken[0].voice?.name).toBe("Google UK English Male");
  });

  it("stop() cancels and silences pending chunk callbacks", async () => {
    const synth = mockSynth(GENDERED);
    let ended = false;
    const longText = `${"Sentence one is here to stay. ".repeat(12)}`;
    const ctl = speakWith(synth as unknown as SynthLike, MockUtterance as any, longText, {
      gender: "female",
      onend: () => { ended = true; },
    });
    await tick();
    expect(synth.spoken.length).toBeGreaterThanOrEqual(1);
    const spokenBefore = synth.spoken.length;
    ctl.stop();
    expect(synth.cancelCount).toBeGreaterThanOrEqual(1);
    synth.spoken[0].onend?.();
    await tick();
    expect(synth.spoken.length).toBe(spokenBefore); // no next chunk after stop
    expect(ended).toBe(false);
  });
});

describe("waitForVoices", () => {
  it("resolves immediately when voices are already loaded", async () => {
    const synth = mockSynth(GENDERED);
    await expect(waitForVoices(synth as unknown as SynthLike)).resolves.toHaveLength(GENDERED.length);
  });

  it("waits for voiceschanged when the first read is empty", async () => {
    const synth = mockSynth([]);
    const pending = waitForVoices(synth as unknown as SynthLike, 5000);
    synth.voices = GENDERED;
    synth.fireVoicesChanged();
    await expect(pending).resolves.toHaveLength(GENDERED.length);
  });
});

describe("chunkText", () => {
  it("returns no chunks for empty text", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n  ")).toEqual([]);
  });

  it("keeps a short text as one chunk", () => {
    expect(chunkText("Hello world. How are you?")).toEqual(["Hello world. How are you?"]);
  });

  it("splits a long paragraph at sentence boundaries, every chunk within the cap", () => {
    const sentences = [
      "Object oriented programming organises code into classes and objects.",
      "Inheritance lets a child class reuse the behaviour of its parent class.",
      "Polymorphism means the same call can behave differently per object.",
      "Encapsulation hides internal state behind a clean public interface.",
      "Abstraction focuses on what an object does instead of how it works.",
    ];
    const chunks = chunkText(sentences.join(" "));
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(180);
    // No sentence is lost or mangled: re-joining reproduces the input.
    expect(chunks.join(" ")).toBe(sentences.join(" "));
    // Chunks break at sentence ends, never mid-sentence.
    for (const c of chunks.slice(0, -1)) expect(c.endsWith(".")).toBe(true);
  });

  it("splits a single over-long sentence at commas/spaces within the cap", () => {
    const longSentence = `A variable stores a value, a loop repeats work, a function groups steps, a class models an idea, an object holds state, an array keeps order, and a map links keys to values for fast lookup in programs`;
    expect(longSentence.length).toBeGreaterThan(180);
    const chunks = chunkText(longSentence);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(180);
    expect(chunks.join(" ").replace(/\s+/g, " ")).toContain("fast lookup in programs");
  });

  it("respects a custom max length", () => {
    const chunks = chunkText("One two three. Four five six. Seven eight nine.", 20);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(20);
    expect(chunks.length).toBeGreaterThan(1);
  });
});

describe("gender persistence", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to female and round-trips the user's selection", () => {
    expect(getVoiceGender()).toBe("female");
    setVoiceGender("male");
    expect(localStorage.getItem("ug-voice-gender")).toBe("male");
    expect(getVoiceGender()).toBe("male");
    setVoiceGender("female");
    expect(getVoiceGender()).toBe("female");
  });
});
