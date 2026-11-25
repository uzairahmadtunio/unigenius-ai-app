import { describe, it, expect } from "vitest";
import { deriveLevel, extractWeakTopics, bumpLevel } from "@/lib/adaptive-difficulty";

// The quiz level rule (locked product behaviour): a student's Practice
// difficulty comes from their own quiz_results history — accuracy over
// the last 5 attempts: <50% Easy, 50–75% Medium, >75% Hard — and weak
// topics are merged from the attempts' topicStats (latest first, max 3).

describe("deriveLevel", () => {
  it("returns Easy when there is no history", () => {
    expect(deriveLevel([])).toBe("Easy");
  });

  it("returns Easy when totals are zero", () => {
    expect(deriveLevel([{ score: 0, total: 0 }])).toBe("Easy");
  });

  it("returns Easy below 50% accuracy", () => {
    expect(deriveLevel([{ score: 4, total: 10 }])).toBe("Easy");
    expect(deriveLevel([{ score: 49, total: 100 }])).toBe("Easy");
  });

  it("returns Medium at exactly 50% and at exactly 75%", () => {
    expect(deriveLevel([{ score: 5, total: 10 }])).toBe("Medium");
    expect(deriveLevel([{ score: 75, total: 100 }])).toBe("Medium");
  });

  it("returns Hard above 75% accuracy", () => {
    expect(deriveLevel([{ score: 76, total: 100 }])).toBe("Hard");
    expect(deriveLevel([{ score: 8, total: 10 }])).toBe("Hard");
  });

  it("aggregates score and total across attempts (not a per-attempt average)", () => {
    // 9/10 then 0/90 → aggregate 9% (Easy); a per-attempt average would be 45%.
    expect(deriveLevel([{ score: 9, total: 10 }, { score: 0, total: 90 }])).toBe("Easy");
    // 10/10 five times = 100% (Hard).
    expect(deriveLevel(Array.from({ length: 5 }, () => ({ score: 10, total: 10 })))).toBe("Hard");
  });

  it("only counts the 5 most recent attempts", () => {
    const recentPerfect = Array.from({ length: 5 }, () => ({ score: 10, total: 10 }));
    // A disastrous 6th (older) attempt must not drag the level down.
    expect(deriveLevel([...recentPerfect, { score: 0, total: 500 }])).toBe("Hard");
    const recentZero = Array.from({ length: 5 }, () => ({ score: 0, total: 10 }));
    // A perfect 6th (older) attempt must not lift the level either.
    expect(deriveLevel([...recentZero, { score: 500, total: 500 }])).toBe("Easy");
  });

  it("treats missing score/total fields as zero", () => {
    expect(deriveLevel([{ score: undefined as any, total: 10 }])).toBe("Easy");
    expect(deriveLevel([{ score: 10, total: undefined as any }])).toBe("Easy");
  });
});

describe("extractWeakTopics", () => {
  const row = (topicStats: any) => ({ details: { topicStats } });

  it("returns an empty list for no rows or rows without topicStats", () => {
    expect(extractWeakTopics([])).toEqual([]);
    expect(extractWeakTopics([{}, { details: {} }, { details: { topicStats: "nope" } }, null])).toEqual([]);
  });

  it("collects only topics whose verdict is weak, in order", () => {
    const rows = [
      row([
        { topic: "Inheritance", verdict: "weak" },
        { topic: "Loops", verdict: "strong" },
        { topic: "Pointers", verdict: "average" },
        { topic: "Recursion", verdict: "weak" },
      ]),
    ];
    expect(extractWeakTopics(rows)).toEqual(["Inheritance", "Recursion"]);
  });

  it("merges across attempts, latest first, without duplicates", () => {
    const rows = [
      row([{ topic: "Inheritance", verdict: "weak" }]),
      row([
        { topic: "Inheritance", verdict: "weak" },
        { topic: "Polymorphism", verdict: "weak" },
      ]),
    ];
    expect(extractWeakTopics(rows)).toEqual(["Inheritance", "Polymorphism"]);
  });

  it("caps the result at 3 topics", () => {
    const rows = [
      row([
        { topic: "A", verdict: "weak" },
        { topic: "B", verdict: "weak" },
        { topic: "C", verdict: "weak" },
        { topic: "D", verdict: "weak" },
      ]),
    ];
    expect(extractWeakTopics(rows)).toEqual(["A", "B", "C"]);
  });

  it("skips stats entries with no topic", () => {
    const rows = [row([{ verdict: "weak" }, { topic: "", verdict: "weak" }, { topic: "Real", verdict: "weak" }])];
    expect(extractWeakTopics(rows)).toEqual(["Real"]);
  });
});

describe("bumpLevel", () => {
  it("moves up one step", () => {
    expect(bumpLevel("Easy", 1)).toBe("Medium");
    expect(bumpLevel("Medium", 1)).toBe("Hard");
  });

  it("moves down one step", () => {
    expect(bumpLevel("Hard", -1)).toBe("Medium");
    expect(bumpLevel("Medium", -1)).toBe("Easy");
  });

  it("clamps at both ends", () => {
    expect(bumpLevel("Hard", 1)).toBe("Hard");
    expect(bumpLevel("Easy", -1)).toBe("Easy");
  });
});
