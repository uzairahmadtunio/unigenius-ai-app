import { describe, it, expect } from "vitest";
import { toText, asText, normalizeMcq, normalizeMcqs, normalizeSaQuestion } from "@/lib/quiz-questions";

describe("toText / asText", () => {
  it("passes strings through and stringifies numbers/booleans", () => {
    expect(toText("abc")).toBe("abc");
    expect(toText(42)).toBe("42");
    expect(toText(true)).toBe("true");
  });
  it("joins arrays of text parts", () => {
    expect(toText(["Hello ", "world"])).toBe("Hello world");
  });
  it("unwraps {text} objects and rejects other objects", () => {
    expect(toText({ text: "inner" })).toBe("inner");
    expect(toText({ foo: "bar" })).toBeNull();
    expect(toText(null)).toBeNull();
    expect(toText(undefined)).toBeNull();
  });
  it("asText never returns a non-string (the React #300 guard)", () => {
    expect(asText({ nested: { deep: 1 } })).toBe("");
    expect(asText("x")).toBe("x");
  });
});

describe("normalizeMcq", () => {
  const good = {
    question: "What is a flip-flop?",
    options: { A: "A gate", B: "A memory element", C: "A wire", D: "A clock" },
    correct: "B",
    explanation: "It stores one bit.",
    topic: "Sequential Logic",
  };
  it("accepts a canonical question unchanged", () => {
    expect(normalizeMcq(good)).toMatchObject(good);
  });
  it("coerces an object explanation (the #300 shape) into text", () => {
    const q = normalizeMcq({ ...good, explanation: { text: "Because reasons." } });
    expect(q?.explanation).toBe("Because reasons.");
  });
  it("joins an array explanation into text", () => {
    const q = normalizeMcq({ ...good, explanation: ["Part one. ", "Part two."] });
    expect(q?.explanation).toBe("Part one. Part two.");
  });
  it("maps array options onto A–D", () => {
    const q = normalizeMcq({ ...good, options: ["A gate", "A memory element", "A wire", "A clock"] });
    expect(q?.options).toEqual(good.options);
  });
  it("maps a full-text correct answer back to its letter", () => {
    const q = normalizeMcq({ ...good, correct: "A memory element" });
    expect(q?.correct).toBe("B");
  });
  it("normalises a lowercase correct letter", () => {
    expect(normalizeMcq({ ...good, correct: "b" })?.correct).toBe("B");
  });
  it("drops questions with an object question field that cannot flatten", () => {
    expect(normalizeMcq({ ...good, question: { diagram: "x" } })).toBeNull();
  });
  it("drops questions with a missing option", () => {
    expect(normalizeMcq({ ...good, options: { A: "x", B: "y", C: "z" } })).toBeNull();
  });
  it("drops questions whose correct answer matches nothing", () => {
    expect(normalizeMcq({ ...good, correct: "Z" })).toBeNull();
  });
});

describe("normalizeMcqs / normalizeSaQuestion", () => {
  it("keeps good items and drops irreparable ones", () => {
    const out = normalizeMcqs([
      { question: "Q1", options: { A: "1", B: "2", C: "3", D: "4" }, correct: "A" },
      { question: { bad: true }, options: { A: "1", B: "2", C: "3", D: "4" }, correct: "A" },
      "nonsense",
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].question).toBe("Q1");
  });
  it("returns [] for non-arrays", () => {
    expect(normalizeMcqs(null)).toEqual([]);
    expect(normalizeMcqs({ questions: [] })).toEqual([]);
  });
  it("normalises subjective questions and coerces keyPoints", () => {
    const q = normalizeSaQuestion({ question: "Explain polymorphism.", modelAnswer: "…", keyPoints: "one string point", topic: "OOP" });
    expect(q?.keyPoints).toEqual(["one string point"]);
    expect(normalizeSaQuestion({ question: { x: 1 } })).toBeNull();
  });
});
