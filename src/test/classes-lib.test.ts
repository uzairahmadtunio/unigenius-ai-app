import { describe, it, expect } from "vitest";
import { dueThisWeek, dueLabel, pct, classCoverStyle, classGlyph, CLASS_COVERS } from "@/lib/classes";
import type { ClassPostRow } from "@/lib/classes";

const NOW = new Date("2026-11-26T12:00:00Z");
const post = (over: Partial<ClassPostRow>): ClassPostRow => ({
  id: "p1", class_id: "c1", author_id: "t1", type: "homework", title: "HW",
  body: null, attachment_url: null, attachment_name: null, meta: null,
  due_at: null, max_marks: null, created_at: "2026-11-26T00:00:00Z",
  ...over,
} as ClassPostRow);

describe("dueThisWeek", () => {
  const titles = new Map([["c1", "OOP"], ["c2", "DLD"]]);
  it("keeps only homework/test posts with deadlines inside the window", () => {
    const items = dueThisWeek([
      post({ id: "a", due_at: "2026-11-28T12:00:00Z" }),
      post({ id: "b", type: "test", due_at: "2026-12-02T12:00:00Z" }),
      post({ id: "c", type: "announcement", due_at: "2026-11-28T12:00:00Z" }),
      post({ id: "d", due_at: "2026-12-20T12:00:00Z" }),
      post({ id: "e", due_at: null }),
      post({ id: "f", due_at: "2026-11-20T12:00:00Z" }),
    ], titles, new Set(), NOW);
    expect(items.map((i) => i.post.id)).toEqual(["a", "b"]);
    expect(items[0].classTitle).toBe("OOP");
  });
  it("includes items due within the last 24 hours (just-overdue work)", () => {
    const items = dueThisWeek([post({ id: "late", due_at: "2026-11-25T20:00:00Z" })], titles, new Set(), NOW);
    expect(items).toHaveLength(1);
  });
  it("sorts unfinished first by deadline, done items last", () => {
    const items = dueThisWeek([
      post({ id: "done1", due_at: "2026-11-27T12:00:00Z" }),
      post({ id: "open2", due_at: "2026-11-29T12:00:00Z" }),
      post({ id: "open1", due_at: "2026-11-27T13:00:00Z" }),
    ], titles, new Set(["done1"]), NOW);
    expect(items.map((i) => i.post.id)).toEqual(["open1", "open2", "done1"]);
    expect(items[2].done).toBe(true);
  });
  it("falls back to a generic class title for unknown classes", () => {
    const items = dueThisWeek([post({ id: "x", class_id: "c9", due_at: "2026-11-28T12:00:00Z" })], titles, new Set(), NOW);
    expect(items[0].classTitle).toBe("Class");
  });
});

describe("dueLabel", () => {
  it("labels overdue, today, tomorrow and weekday deadlines", () => {
    expect(dueLabel("2026-11-25T12:00:00Z", NOW)).toBe("Overdue");
    expect(dueLabel("2026-11-26T12:00:00Z", NOW)).toBe("Due today");
    expect(dueLabel("2026-11-27T12:00:00Z", NOW)).toBe("Due tomorrow");
    expect(dueLabel("2026-11-30T12:00:00Z", NOW)).toBe("Due Mon");
  });
});

describe("pct", () => {
  it("rounds and never divides by zero", () => {
    expect(pct(7, 10)).toBe(70);
    expect(pct(1, 3)).toBe(33);
    expect(pct(0, 10)).toBe(0);
    expect(pct(5, 0)).toBe(0);
    expect(pct(null, null)).toBe(0);
  });
});

describe("class covers and glyphs", () => {
  it("cover style cycles through the violet variants", () => {
    expect(classCoverStyle(0)).toBe(CLASS_COVERS[0]);
    expect(classCoverStyle(4)).toBe(CLASS_COVERS[0]);
    expect(classCoverStyle(null)).toBe(CLASS_COVERS[0]);
    expect(CLASS_COVERS).toHaveLength(4);
  });
  it("glyph picks a subject-flavoured symbol", () => {
    expect(classGlyph({ subject: "Discrete Mathematics", title: "x" })).toBe("∑");
    expect(classGlyph({ subject: "Object Oriented Programming", title: "x" })).toBe("{ }");
    expect(classGlyph({ subject: "Digital Logic Design", title: "x" })).toBe("⚡");
    expect(classGlyph({ subject: "History", title: "x" })).toBe("📘");
  });
});
