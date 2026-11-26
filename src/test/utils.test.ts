import { describe, it, expect } from "vitest";
import { cn, quizPercent, formatFileSize } from "@/lib/utils";

describe("formatFileSize (D-10)", () => {
  it("shows real bytes for sub-1 KB files instead of \"0 KB\"", () => {
    expect(formatFileSize(328)).toBe("328 B");
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(1023)).toBe("1023 B");
  });
  it("formats KB and MB with sensible precision", () => {
    expect(formatFileSize(1024)).toBe("1.0 KB");
    expect(formatFileSize(1536)).toBe("1.5 KB");
    expect(formatFileSize(100 * 1024)).toBe("100 KB");
    expect(formatFileSize(2.5 * 1024 * 1024)).toBe("2.50 MB");
  });
  it("survives junk input", () => {
    expect(formatFileSize(-5)).toBe("0 B");
    expect(formatFileSize(NaN)).toBe("0 B");
  });
});

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
