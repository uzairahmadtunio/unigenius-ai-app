/**
 * Quiz question normalisation (Bug #3 fix, 2026-11-25) — the client-side
 * mirror of the generate-quiz boundary normaliser. AI-generated payloads
 * occasionally arrive with a field shaped as an object/array; rendering
 * one directly threw React error #300 ("Objects are not valid as a React
 * child") and crashed the whole Practice page. Every payload is coerced
 * into the canonical shape before it reaches state, irreparable items are
 * dropped, and `asText` gives renderers a can-never-throw fallback.
 */

export interface CanonicalMcq {
  question: string;
  options: { A: string; B: string; C: string; D: string };
  correct: string;
  explanation: string;
  topic: string;
  source?: string;
  [key: string]: unknown;
}

export interface CanonicalSaQuestion {
  question: string;
  modelAnswer: string;
  keyPoints: string[];
  topic: string;
  [key: string]: unknown;
}

/** Flatten any value into display text; null when it cannot be flattened. */
export function toText(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    const parts = v.map(toText);
    return parts.every((p) => p !== null) ? parts.join("") : null;
  }
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const t = o.text ?? o.content ?? o.value;
    if (typeof t === "string") return t;
  }
  return null;
}

/** Render-safe text: always a string, never an object (no React #300). */
export function asText(v: unknown): string {
  return toText(v) ?? "";
}

/** Normalise one raw MCQ into the canonical shape, or null to drop it. */
export function normalizeMcq(q: unknown): CanonicalMcq | null {
  if (!q || typeof q !== "object") return null;
  const raw = q as Record<string, unknown>;
  const question = toText(raw.question);
  if (!question || !question.trim()) return null;
  let rawOptions: unknown[] = [];
  if (Array.isArray(raw.options)) rawOptions = raw.options;
  else if (raw.options && typeof raw.options === "object") {
    const o = raw.options as Record<string, unknown>;
    rawOptions = ["A", "B", "C", "D"].map((k) => o[k] ?? o[k.toLowerCase()]);
  }
  const opts = rawOptions.map(toText);
  if (opts.length !== 4 || opts.some((o) => o === null || !String(o).trim())) return null;
  const options = { A: opts[0]!, B: opts[1]!, C: opts[2]!, D: opts[3]! };
  let correct = (toText(raw.correct) ?? "").trim().toUpperCase();
  if (!["A", "B", "C", "D"].includes(correct)) {
    const idx = opts.findIndex((o) => o !== null && o.trim().toLowerCase() === correct.toLowerCase());
    if (idx === -1) return null;
    correct = "ABCD"[idx];
  }
  return {
    ...raw,
    question,
    options,
    correct,
    explanation: toText(raw.explanation) ?? "",
    topic: toText(raw.topic) ?? "",
  } as CanonicalMcq;
}

/** Normalise a list of raw MCQs, dropping irreparable items. */
export function normalizeMcqs(raw: unknown): CanonicalMcq[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeMcq).filter((q): q is CanonicalMcq => q !== null);
}

/** Normalise one raw subjective question, or null to drop it. */
export function normalizeSaQuestion(q: unknown): CanonicalSaQuestion | null {
  if (!q || typeof q !== "object") return null;
  const raw = q as Record<string, unknown>;
  const question = toText(raw.question);
  if (!question || !question.trim()) return null;
  const kpRaw = Array.isArray(raw.keyPoints) ? raw.keyPoints : [raw.keyPoints];
  const keyPoints = kpRaw.map(toText).filter((k): k is string => !!k && !!k.trim());
  return {
    ...raw,
    question,
    modelAnswer: toText(raw.modelAnswer) ?? "",
    keyPoints,
    topic: toText(raw.topic) ?? "",
  } as CanonicalSaQuestion;
}

/** Normalise a list of raw subjective questions, dropping irreparable items. */
export function normalizeSaQuestions(raw: unknown): CanonicalSaQuestion[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeSaQuestion).filter((q): q is CanonicalSaQuestion => q !== null);
}
