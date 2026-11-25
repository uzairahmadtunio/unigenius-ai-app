import { describe, it, expect } from "vitest";
import { parseAiTaskText, buildDeterministicTasks } from "@/lib/planner-tasks";

// 2026-01-05 is a Monday.
const TODAY = "2026-01-05";
const END = "2026-01-11";

describe("parseAiTaskText", () => {
  it("parses a bare JSON array", () => {
    const rows = parseAiTaskText(
      '[{"date":"2026-01-05","subject":"OOP","title":"Revise inheritance"}]',
      TODAY, END,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ date: "2026-01-05", subject: "OOP", title: "Revise inheritance" });
  });

  it("parses an array wrapped in prose and code fences", () => {
    const text = "Here are your tasks:\n```json\n[{\"date\":\"2026-01-06\",\"subject\":\"DLD\",\"title\":\"K-maps\"}]\n```\nGood luck!";
    const rows = parseAiTaskText(text, TODAY, END);
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("K-maps");
  });

  it("parses an object holding the array under a tasks key", () => {
    const rows = parseAiTaskText('{"tasks":[{"date":"2026-01-07","title":"Calculus drills"}]}', TODAY, END);
    expect(rows).toHaveLength(1);
    expect(rows[0].subject).toBeNull();
  });

  it("drops rows with out-of-range dates or missing titles", () => {
    const rows = parseAiTaskText(
      '[{"date":"2026-02-01","title":"Too late"},{"date":"2026-01-05","title":""},{"date":"2026-01-05","title":"Kept"}]',
      TODAY, END,
    );
    expect(rows.map((r) => r.title)).toEqual(["Kept"]);
  });

  it("returns [] for garbage instead of throwing", () => {
    expect(parseAiTaskText("no json here", TODAY, END)).toEqual([]);
    expect(parseAiTaskText("", TODAY, END)).toEqual([]);
  });

  it("applies the canonical subject mapper", () => {
    const rows = parseAiTaskText('[{"date":"2026-01-05","subject":"oop","title":"x"}]', TODAY, END, (s) => s.toUpperCase());
    expect(rows[0].subject).toBe("OOP");
  });
});

describe("buildDeterministicTasks", () => {
  const schedule = [
    "Monday: Object Oriented Programming 2h, Digital Logic Design 1h",
    "Tuesday: Applied Calculus 2h",
    "Wednesday: Object Oriented Programming 1h",
    "Sunday: Rest",
  ].join("\n");

  it("places weekday sessions on the matching dates of the coming week", () => {
    const tasks = buildDeterministicTasks(schedule, [], TODAY);
    const monday = tasks.filter((t) => t.date === "2026-01-05");
    expect(monday.map((t) => t.title)).toEqual(["Object Oriented Programming", "Digital Logic Design"]);
    expect(tasks.filter((t) => t.date === "2026-01-06").map((t) => t.title)).toEqual(["Applied Calculus"]);
    expect(tasks.filter((t) => t.date === "2026-01-07").map((t) => t.title)).toEqual(["Object Oriented Programming"]);
    // Sunday is "Rest" — no tasks on 2026-01-11.
    expect(tasks.some((t) => t.date === "2026-01-11")).toBe(false);
  });

  it("caps at 3 tasks per day", () => {
    const busy = "Monday: A One 1h, B Two 1h, C Three 1h, D Four 1h, E Five 1h";
    const tasks = buildDeterministicTasks(busy, [], TODAY);
    expect(tasks.filter((t) => t.date === TODAY)).toHaveLength(3);
  });

  it("falls back to round-robin subjects when the schedule has no weekday lines", () => {
    const tasks = buildDeterministicTasks("Study hard every day", ["OOP", "DLD"], TODAY);
    expect(tasks.length).toBe(14); // 2 per day x 7 days
    expect(tasks[0]).toEqual({ date: TODAY, subject: "OOP", title: "Study OOP" });
    expect(tasks[1].subject).toBe("DLD");
    expect(tasks[2].date).toBe("2026-01-06");
  });

  it("returns [] when there is nothing to distribute", () => {
    expect(buildDeterministicTasks("", [], TODAY)).toEqual([]);
  });
});
