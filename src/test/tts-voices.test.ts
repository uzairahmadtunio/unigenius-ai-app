import { describe, it, expect, beforeEach } from "vitest";
import {
  GEMINI_VOICES,
  DEFAULT_VOICE_BY_GENDER,
  genderOfVoiceName,
  isGeminiVoice,
  getVoiceName,
  setVoiceName,
  getVoiceGender,
  setVoiceGender,
  resolveVoiceName,
} from "@/lib/tts";

// TTS Upgrade (2026-11-26): the read-aloud voice is a named Gemini
// prebuilt voice, persisted across sessions and kept in sync with the
// older ug-voice-gender key so the Web Speech fallback follows the
// same gender. The final sound can only be judged on a real device;
// these tests pin the catalog, defaults and persistence contract.

beforeEach(() => {
  localStorage.clear();
});

describe("GEMINI_VOICES catalog", () => {
  it("offers exactly the eight approved voices with the right genders", () => {
    expect(GEMINI_VOICES.map((v) => v.name)).toEqual([
      "Charon", "Puck", "Fenrir", "Orus",
      "Kore", "Aoede", "Leda", "Callirrhoe",
    ]);
    for (const n of ["Charon", "Puck", "Fenrir", "Orus"]) expect(genderOfVoiceName(n)).toBe("male");
    for (const n of ["Kore", "Aoede", "Leda", "Callirrhoe"]) expect(genderOfVoiceName(n)).toBe("female");
  });
  it("defaults are Charon (male) and Kore (female)", () => {
    expect(DEFAULT_VOICE_BY_GENDER).toEqual({ male: "Charon", female: "Kore" });
  });
  it("rejects unknown voice names", () => {
    expect(isGeminiVoice("Charon")).toBe(true);
    expect(isGeminiVoice("charon")).toBe(false);
    expect(isGeminiVoice("NotAVoice")).toBe(false);
    expect(isGeminiVoice(null)).toBe(false);
    expect(genderOfVoiceName(undefined)).toBeNull();
  });
});

describe("voice persistence", () => {
  it("defaults to Kore when nothing is stored (female is the legacy default)", () => {
    expect(getVoiceName()).toBe("Kore");
  });
  it("honours the legacy gender key: male users land on Charon", () => {
    setVoiceGender("male");
    expect(getVoiceName()).toBe("Charon");
  });
  it("setVoiceName persists the name and syncs the gender key", () => {
    setVoiceName("Puck");
    expect(getVoiceName()).toBe("Puck");
    expect(getVoiceGender()).toBe("male");
    setVoiceName("Leda");
    expect(getVoiceName()).toBe("Leda");
    expect(getVoiceGender()).toBe("female");
  });
  it("setVoiceName ignores unknown voices", () => {
    setVoiceName("Puck");
    setVoiceName("Bogus");
    expect(getVoiceName()).toBe("Puck");
  });
  it("setVoiceGender resets the voice to that gender's default", () => {
    setVoiceName("Fenrir");
    setVoiceGender("female");
    expect(getVoiceName()).toBe("Kore");
    expect(getVoiceGender()).toBe("female");
  });
  it("a stored invalid name falls back to the gender default", () => {
    localStorage.setItem("ug-voice-name", "Garbage");
    localStorage.setItem("ug-voice-gender", "male");
    expect(getVoiceName()).toBe("Charon");
  });
});

describe("resolveVoiceName", () => {
  it("an explicit valid voice wins", () => {
    setVoiceName("Kore");
    expect(resolveVoiceName({ voice: "Fenrir" })).toBe("Fenrir");
  });
  it("an explicit gender keeps a stored voice of that gender", () => {
    setVoiceName("Aoede");
    expect(resolveVoiceName({ gender: "female" })).toBe("Aoede");
    expect(resolveVoiceName({ gender: "male" })).toBe("Charon");
  });
  it("with no options it returns the persisted voice", () => {
    setVoiceName("Orus");
    expect(resolveVoiceName({})).toBe("Orus");
  });
});
