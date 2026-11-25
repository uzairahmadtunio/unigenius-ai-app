/**
 * Planner "break my week into daily tasks" helpers (Bug #2 fix, 2026-11-25).
 *
 * The split originally depended entirely on the AI chat function: when the
 * AI pool is exhausted the function returns 503 and the user got only an
 * error toast. These helpers provide (a) a tolerant parser for the AI's
 * JSON answer and (b) a deterministic fallback that distributes the weekly
 * schedule across the next 7 days with no AI involved, so the button
 * always produces a sensible result.
 */

export interface DailyTaskDraft {
  date: string;
  subject: string | null;
  title: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validRow(r: any, todayStr: string, endStr: string, canonical: (s: string) => string): DailyTaskDraft | null {
  if (!r || typeof r.title !== "string" || !r.title.trim()) return null;
  const date = String(r.date || "");
  if (!DATE_RE.test(date) || date < todayStr || date > endStr) return null;
  return {
    date,
    subject: typeof r.subject === "string" && r.subject.trim() ? canonical(r.subject.trim()) : null,
    title: String(r.title).trim(),
  };
}

/**
 * Tolerantly parse the AI's answer into task drafts. Accepts a bare JSON
 * array, an array wrapped in prose/code fences, or an object holding the
 * array under a tasks/items/days key. Returns [] when nothing usable is
 * found (the caller then falls back to buildDeterministicTasks).
 */
export function parseAiTaskText(
  text: string,
  todayStr: string,
  endStr: string,
  canonical: (s: string) => string = (s) => s,
): DailyTaskDraft[] {
  if (!text) return [];
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  let parsed: any = null;
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start !== -1 && end > start) {
    try { parsed = JSON.parse(cleaned.slice(start, end + 1)); } catch { parsed = null; }
  }
  if (parsed == null) {
    // Maybe a bare object: {"tasks": [...]}
    const os = cleaned.indexOf("{");
    const oe = cleaned.lastIndexOf("}");
    if (os !== -1 && oe > os) {
      try {
        const obj = JSON.parse(cleaned.slice(os, oe + 1));
        for (const key of ["tasks", "items", "days", "schedule"]) {
          if (Array.isArray(obj?.[key])) { parsed = obj[key]; break; }
        }
      } catch { /* fall through */ }
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((r) => validRow(r, todayStr, endStr, canonical))
    .filter((r): r is DailyTaskDraft => r !== null);
}

const WEEKDAYS: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function weekdayOf(dateStr: string): number {
  return new Date(`${dateStr}T12:00:00Z`).getUTCDay();
}

/** Strip a trailing duration like "2h", "1.5 hours", "(2h)" from a segment. */
function cleanSegment(seg: string): string {
  return seg
    .replace(/\(\s*\d+(?:\.\d+)?\s*(?:h|hr|hrs|hour|hours|min|mins)\s*\)/gi, "")
    .replace(/\b\d+(?:\.\d+)?\s*(?:h|hr|hrs|hour|hours)\b/gi, "")
    .replace(/\b\d+\s*(?:min|mins|minutes)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Deterministic fallback: read weekday lines out of the weekly schedule
 * text ("Monday: OOP 2h, DLD 1h") and place those sessions on the matching
 * weekdays within the next 7 days. If no weekday lines parse, distribute
 * the selected subjects round-robin (2 per day) across the week.
 */
export function buildDeterministicTasks(
  scheduleText: string,
  subjects: string[],
  todayStr: string,
  canonical: (s: string) => string = (s) => s,
): DailyTaskDraft[] {
  const byWeekday = new Map<number, string[]>();
  for (const rawLine of (scheduleText || "").split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z]+)\s*(?:day)?\s*[:\-–]\s*(.+)$/);
    if (!m) continue;
    const wd = WEEKDAYS[m[1].toLowerCase()];
    if (wd === undefined) continue;
    const segments = m[2]
      .split(/[,;•·]/)
      .map((s) => cleanSegment(s))
      .filter((s) => s.length > 1 && !/^rest$/i.test(s) && !/^off$/i.test(s) && !/^free$/i.test(s));
    if (segments.length) byWeekday.set(wd, [...(byWeekday.get(wd) || []), ...segments]);
  }

  const tasks: DailyTaskDraft[] = [];
  if (byWeekday.size) {
    for (let i = 0; i < 7; i++) {
      const date = addDays(todayStr, i);
      const segments = byWeekday.get(weekdayOf(date)) || [];
      for (const seg of segments.slice(0, 3)) {
        tasks.push({ date, subject: canonical(seg), title: seg });
      }
    }
    if (tasks.length) return tasks;
  }

  // Round-robin fallback over the selected subjects.
  const pool = (subjects || []).map((s) => canonical(s)).filter(Boolean);
  if (!pool.length) return [];
  let idx = 0;
  for (let i = 0; i < 7; i++) {
    const date = addDays(todayStr, i);
    for (let k = 0; k < 2 && pool.length; k++) {
      const subject = pool[idx % pool.length];
      idx++;
      tasks.push({ date, subject, title: `Study ${subject}` });
    }
  }
  return tasks;
}
