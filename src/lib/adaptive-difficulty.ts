// ─── Adaptive difficulty (audit: quiz level rule) ─────────────────
// The student's Practice difficulty is derived from their own
// quiz_results history: accuracy over the last 5 attempts decides the
// difficulty sent to generate-quiz (no history or <50% → Easy,
// 50–75% → Medium, >75% → Hard). Weak topics come from the topicStats
// saved with each attempt's results. Extracted from PracticePage so
// the rules are unit-testable (src/test/adaptive-difficulty.test.ts).

export type Difficulty = "Easy" | "Medium" | "Hard";

export const deriveLevel = (rows: { score: number; total: number }[]): Difficulty => {
  const last5 = rows.slice(0, 5);
  const totalScore = last5.reduce((a, r) => a + (r.score || 0), 0);
  const totalMax = last5.reduce((a, r) => a + (r.total || 0), 0);
  if (!last5.length || totalMax <= 0) return "Easy";
  const accuracy = totalScore / totalMax;
  if (accuracy < 0.5) return "Easy";
  if (accuracy <= 0.75) return "Medium";
  return "Hard";
};

/** Weak topics from the most recent attempts that carry topicStats
 *  (latest first, merged across attempts, at most 3). Rows are
 *  quiz_results records whose `details` JSON is narrowed defensively. */
export const extractWeakTopics = (rows: readonly ({ details?: unknown } | null | undefined)[]): string[] => {
  const out: string[] = [];
  for (const row of rows) {
    const details = (row?.details ?? null) as { topicStats?: unknown } | null;
    const stats = Array.isArray(details?.topicStats) ? details.topicStats : [];
    for (const st of stats as { verdict?: unknown; topic?: unknown }[]) {
      if (st?.verdict === "weak" && typeof st?.topic === "string" && st.topic && !out.includes(st.topic)) {
        out.push(st.topic);
        if (out.length >= 3) return out;
      }
    }
  }
  return out;
};

export const bumpLevel = (level: Difficulty, dir: 1 | -1): Difficulty => {
  const order: Difficulty[] = ["Easy", "Medium", "Hard"];
  const i = order.indexOf(level);
  return order[Math.min(2, Math.max(0, i + dir))];
};
