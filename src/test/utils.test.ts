import { describe, it, expect } from "vitest";
import { cn, quizPercent } from "@/lib/utils";

describe("cn", () => {
  it("joins plain class names", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("drops falsy conditional classes", () => {
    expect(cn("a", false && "b", undefined, null as any, "c")).toBe("a c");
  });

  it("resolves Tailwind conflicts in favour of the later class", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
    expect(cn("text-red-500", "text-blue-500")).toBe("text-blue-500");
  });

  it("returns an empty string with no inputs", () => {
    expect(cn()).toBe("");
  });
});

describe("quizPercent — the one percentage formula used app-wide", () => {
  it("rounds to the nearest whole percent", () => {
    expect(quizPercent(1, 3)).toBe(33);
    expect(quizPercent(2, 3)).toBe(67);
    expect(quizPercent(1, 2)).toBe(50);
  });

  it("handles perfect and zero scores", () => {
    expect(quizPercent(10, 10)).toBe(100);
    expect(quizPercent(0, 10)).toBe(0);
  });

  it("returns 0 for a zero or invalid total instead of NaN/Infinity", () => {
    expect(quizPercent(5, 0)).toBe(0);
    expect(quizPercent(0, 0)).toBe(0);
    expect(quizPercent(5, -3)).toBe(0);
  });
});
