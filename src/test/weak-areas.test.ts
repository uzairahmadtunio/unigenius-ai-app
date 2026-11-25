import { describe, it, expect } from "vitest";
import { computeSubjectStats, collectMissed } from "@/components/WeakAreas";

// Weak Areas is driven entirely by these two pure reducers over the
// student's real quiz_results rows — grouping, averages, trends and the
// missed-question list must be exactly right or the advice misleads.

const row = (subject: string, score: number, total: number, created_at: string, details: any = null) => ({
  subject,
  score,
  total,
  quiz_type: "objective",
  created_at,
  details,
});

describe("computeSubjectStats", () => {
  it("groups rows by subject with rounded average percentages", () => {
    const stats = computeSubjectStats([
      row("OOP", 8, 10, "2026-11-01T10:00:00Z"),
      row("OOP", 6, 10, "2026-11-02T10:00:00Z"),
      row("DLD", 3, 10, "2026-11-01T10:00:00Z"),
    ]);
    const oop = stats.find((s) => s.subject === "OOP")!;
    expect(oop.attempts).toBe(2);
    expect(oop.avgPct).toBe(70); // (80 + 60) / 2
    expect(oop.lastPct).toBe(60); // latest attempt by date
  });

  it("sorts weakest subjects first", () => {
    const stats = computeSubjectStats([
      row("Strong", 9, 10, "2026-11-01T10:00:00Z"),
      row("Weak", 3, 10, "2026-11-01T10:00:00Z"),
    ]);
    expect(stats[0].subject).toBe("Weak");
    expect(stats[1].subject).toBe("Strong");
  });

  it("detects an improving trend when the newer half beats the older by >5 points", () => {
    const stats = computeSubjectStats([
      row("Math", 4, 10, "2026-11-01T10:00:00Z"),
      row("Math", 4, 10, "2026-11-02T10:00:00Z"),
      row("Math", 9, 10, "2026-11-03T10:00:00Z"),
      row("Math", 9, 10, "2026-11-04T10:00:00Z"),
    ]);
    expect(stats[0].trend).toBe("improving");
  });

  it("detects a declining trend", () => {
    const stats = computeSubjectStats([
      row("Math", 9, 10, "2026-11-01T10:00:00Z"),
      row("Math", 9, 10, "2026-11-02T10:00:00Z"),
      row("Math", 4, 10, "2026-11-03T10:00:00Z"),
      row("Math", 4, 10, "2026-11-04T10:00:00Z"),
    ]);
    expect(stats[0].trend).toBe("declining");
  });

  it("reports steady for small changes and for a single attempt", () => {
    const two = computeSubjectStats([
      row("Math", 6, 10, "2026-11-01T10:00:00Z"),
      row("Math", 6, 10, "2026-11-02T10:00:00Z"),
    ]);
    expect(two[0].trend).toBe("steady");
    const one = computeSubjectStats([row("Math", 6, 10, "2026-11-01T10:00:00Z")]);
    expect(one[0].trend).toBe("steady");
  });

  it("treats a zero-total row as 0% instead of dividing by zero", () => {
    const stats = computeSubjectStats([row("Math", 0, 0, "2026-11-01T10:00:00Z")]);
    expect(stats[0].avgPct).toBe(0);
    expect(stats[0].lastPct).toBe(0);
  });

  it("returns an empty list for no history", () => {
    expect(computeSubjectStats([])).toEqual([]);
  });
});

describe("collectMissed", () => {
  const mcq = (question: string, isCorrect: boolean) => ({ kind: "mcq", question, isCorrect });
  const subj = (question: string, verdict: string) => ({ kind: "subjective", question, verdict });

  it("collects wrong MCQs and non-correct subjective answers only", () => {
    const rows = [
      row("OOP", 1, 4, "2026-11-02T10:00:00Z", {
        items: [mcq("Q-wrong", false), mcq("Q-right", true), subj("S-partial", "partial"), subj("S-ok", "correct")],
      }),
    ];
    const missed = collectMissed(rows as any);
    expect(missed.map((m) => m.question)).toEqual(["Q-wrong", "S-partial"]);
    expect(missed[0]).toEqual({ subject: "OOP", question: "Q-wrong", kind: "mcq" });
    expect(missed[1].kind).toBe("subjective");
  });

  it("orders by most recent attempt first", () => {
    const rows = [
      row("Old", 0, 1, "2026-11-01T10:00:00Z", { items: [mcq("old-q", false)] }),
      row("New", 0, 1, "2026-11-05T10:00:00Z", { items: [mcq("new-q", false)] }),
    ];
    expect(collectMissed(rows as any).map((m) => m.question)).toEqual(["new-q", "old-q"]);
  });

  it("respects the limit", () => {
    const items = Array.from({ length: 10 }, (_, i) => mcq(`q${i}`, false));
    const rows = [row("OOP", 0, 10, "2026-11-02T10:00:00Z", { items })];
    expect(collectMissed(rows as any, 3)).toHaveLength(3);
    expect(collectMissed(rows as any)).toHaveLength(8); // default limit
  });

  it("skips rows without a details.items array and items without a question", () => {
    const rows = [
      row("OOP", 0, 1, "2026-11-02T10:00:00Z", null),
      row("OOP", 0, 1, "2026-11-03T10:00:00Z", { items: "nope" }),
      row("OOP", 0, 1, "2026-11-04T10:00:00Z", { items: [{ kind: "mcq", isCorrect: false }] }),
    ];
    expect(collectMissed(rows as any)).toEqual([]);
  });
});
