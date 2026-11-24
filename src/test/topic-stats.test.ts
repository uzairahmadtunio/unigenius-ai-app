import { describe, it, expect } from "vitest";
import { computeTopicStats } from "@/pages/PracticePage";

describe("computeTopicStats", () => {
  it("classifies strong / average / weak with time notes", () => {
    const items = [
      // Loops: 2/2 correct but very slow (200s avg vs 60s budget)
      { kind: "mcq", topic: "Loops", isCorrect: true, timeSec: 200 },
      { kind: "mcq", topic: "Loops", isCorrect: true, timeSec: 200 },
      // Arrays: 0/2 correct and very fast (10s avg) -> fast-but-wrong note
      { kind: "mcq", topic: "Arrays", isCorrect: false, timeSec: 10 },
      { kind: "mcq", topic: "Arrays", isCorrect: false, timeSec: 12 },
      // Pointers: 1/2 correct -> average
      { kind: "mcq", topic: "Pointers", isCorrect: true, timeSec: 55 },
      { kind: "mcq", topic: "Pointers", isCorrect: false, timeSec: 65 },
      // Subjective partial: 3/5 -> ratio 0.6
      { kind: "subjective", topic: "Pointers", score: 3, maxScore: 5, timeSec: 170 },
    ];
    const stats = computeTopicStats(items);
    const byTopic = Object.fromEntries(stats.map((s) => [s.topic, s]));

    expect(byTopic["Loops"].verdict).toBe("strong");
    expect(byTopic["Loops"].accuracy).toBe(1);
    expect(byTopic["Loops"].note).toContain("speed barhao");

    expect(byTopic["Arrays"].verdict).toBe("weak");
    expect(byTopic["Arrays"].accuracy).toBe(0);
    expect(byTopic["Arrays"].note).toContain("jaldi");

    // Pointers: (1 + 0 + 0.6) / 3 = 0.533 -> average
    expect(byTopic["Pointers"].verdict).toBe("average");
    expect(byTopic["Pointers"].total).toBe(3);

    // Weak topics sort first
    expect(stats[0].topic).toBe("Arrays");
  });

  it("handles missing time data", () => {
    const stats = computeTopicStats([
      { kind: "mcq", topic: "General", isCorrect: true, timeSec: null },
    ]);
    expect(stats[0].avgTime).toBe(0);
    expect(stats[0].verdict).toBe("strong");
  });
});
