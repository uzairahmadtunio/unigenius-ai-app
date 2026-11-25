import { describe, it, expect } from "vitest";
import { computeTopicStats } from "@/pages/PracticePage";

// Extended coverage for computeTopicStats beyond src/test/topic-stats.test.ts:
// empty input, default topic bucketing, subjective ratios, note selection
// and sort stability. (Kept in its own file so the original suite file is
// untouched.)

describe("computeTopicStats — extended", () => {
  it("returns an empty array for no items", () => {
    expect(computeTopicStats([])).toEqual([]);
  });

  it("buckets items without a topic under 'General'", () => {
    const stats = computeTopicStats([{ kind: "mcq", isCorrect: true, timeSec: 30 }]);
    expect(stats).toHaveLength(1);
    expect(stats[0].topic).toBe("General");
    expect(stats[0].total).toBe(1);
  });

  it("scores subjective items by their score ratio", () => {
    const stats = computeTopicStats([
      { kind: "subjective", topic: "Essays", score: 4, maxScore: 5, timeSec: 10 },
    ]);
    expect(stats[0].accuracy).toBeCloseTo(0.8);
    expect(stats[0].verdict).toBe("strong");
    expect(stats[0].note).toContain("keep it up");
  });

  it("treats a subjective item with no maxScore as zero credit", () => {
    const stats = computeTopicStats([
      { kind: "subjective", topic: "Essays", score: 5, maxScore: 0, timeSec: 120 },
    ]);
    expect(stats[0].accuracy).toBe(0);
    expect(stats[0].verdict).toBe("weak");
  });

  it("gives the generic improvement note to weak topics answered at normal speed", () => {
    const stats = computeTopicStats([
      { kind: "mcq", topic: "Graphs", isCorrect: false, timeSec: 60 },
      { kind: "mcq", topic: "Graphs", isCorrect: false, timeSec: 60 },
    ]);
    expect(stats[0].verdict).toBe("weak");
    expect(stats[0].note).toContain("needs improvement");
  });

  it("gives the keep-it-up note to strong topics answered within budget", () => {
    const stats = computeTopicStats([
      { kind: "mcq", topic: "Loops", isCorrect: true, timeSec: 40 },
      { kind: "mcq", topic: "Loops", isCorrect: true, timeSec: 50 },
    ]);
    expect(stats[0].verdict).toBe("strong");
    expect(stats[0].note).toContain("keep it up");
  });

  it("sorts equal verdicts by accuracy ascending (weakest first)", () => {
    const stats = computeTopicStats([
      { kind: "mcq", topic: "A", isCorrect: true, timeSec: 10 },
      { kind: "mcq", topic: "A", isCorrect: false, timeSec: 10 },
      { kind: "mcq", topic: "A", isCorrect: false, timeSec: 10 },
      { kind: "mcq", topic: "A", isCorrect: false, timeSec: 10 },
      // A: accuracy 0.25 (weak)
      { kind: "mcq", topic: "B", isCorrect: false, timeSec: 10 },
      { kind: "mcq", topic: "B", isCorrect: false, timeSec: 10 },
      // B: accuracy 0 (weak) — must sort before A
    ]);
    expect(stats.map((s) => s.topic)).toEqual(["B", "A"]);
  });

  it("averages only the items that carry timing data", () => {
    const stats = computeTopicStats([
      { kind: "mcq", topic: "T", isCorrect: true, timeSec: 90 },
      { kind: "mcq", topic: "T", isCorrect: true, timeSec: null },
      { kind: "mcq", topic: "T", isCorrect: false },
    ]);
    expect(stats[0].avgTime).toBe(90);
    expect(stats[0].total).toBe(3);
  });
});
