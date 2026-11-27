import { describe, it, expect } from "vitest";
import {
  parseAppSettings,
  parseFeatureFlags,
  parseMaintenance,
  formatBytes,
  toCsv,
  relativeTime,
  DEFAULT_FEATURES,
} from "@/lib/app-settings";

describe("parseFeatureFlags", () => {
  it("returns all-on defaults for empty or invalid input", () => {
    expect(parseFeatureFlags(null)).toEqual(DEFAULT_FEATURES);
    expect(parseFeatureFlags(undefined)).toEqual(DEFAULT_FEATURES);
    expect(parseFeatureFlags("nope")).toEqual(DEFAULT_FEATURES);
    expect(parseFeatureFlags(42)).toEqual(DEFAULT_FEATURES);
  });

  it("applies stored booleans and ignores unknown keys and non-booleans", () => {
    const flags = parseFeatureFlags({ code_lab: false, groups: false, bogus: true, viva: "yes" });
    expect(flags.code_lab).toBe(false);
    expect(flags.groups).toBe(false);
    expect(flags.viva).toBe(true); // non-boolean falls back to default (on)
    expect(flags.ai_tutor).toBe(true);
    expect((flags as any).bogus).toBeUndefined();
  });
});

describe("parseMaintenance", () => {
  it("defaults to disabled with the standard message", () => {
    const m = parseMaintenance(null);
    expect(m.enabled).toBe(false);
    expect(m.message.length).toBeGreaterThan(0);
  });

  it("keeps a custom message and enabled state", () => {
    const m = parseMaintenance({ enabled: true, message: "Back at 5pm" });
    expect(m.enabled).toBe(true);
    expect(m.message).toBe("Back at 5pm");
  });

  it("ignores a blank message", () => {
    const m = parseMaintenance({ enabled: true, message: "   " });
    expect(m.message.length).toBeGreaterThan(0);
  });
});

describe("parseAppSettings", () => {
  it("builds settings from rows", () => {
    const s = parseAppSettings([
      { key: "features", value: { flashcards: false } },
      { key: "maintenance", value: { enabled: true, message: "Soon" } },
    ]);
    expect(s.features.flashcards).toBe(false);
    expect(s.features.ai_tutor).toBe(true);
    expect(s.maintenance.enabled).toBe(true);
  });

  it("fails open (all defaults) when rows are missing", () => {
    const s = parseAppSettings(null);
    expect(s.features).toEqual(DEFAULT_FEATURES);
    expect(s.maintenance.enabled).toBe(false);
  });
});

describe("formatBytes", () => {
  it("formats common sizes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatBytes(2.5 * 1024 * 1024 * 1024)).toBe("2.5 GB");
  });
  it("handles missing values", () => {
    expect(formatBytes(null)).toBe("—");
    expect(formatBytes(undefined)).toBe("—");
  });
});

describe("toCsv", () => {
  it("joins headers and rows", () => {
    expect(toCsv(["A", "B"], [[1, 2], [3, 4]])).toBe("A,B\n1,2\n3,4");
  });
  it("quotes and escapes values containing commas, quotes or newlines", () => {
    expect(toCsv(["Name"], [["a,b"], ['say "hi"'], ["x\ny"], [null]])).toBe(
      'Name\n"a,b"\n"say ""hi"""\n"x\ny"\n'
    );
  });
});

describe("relativeTime", () => {
  it("labels recent and old timestamps", () => {
    expect(relativeTime(new Date().toISOString())).toBe("Just now");
    expect(relativeTime(new Date(Date.now() - 5 * 60_000).toISOString())).toBe("5m ago");
    expect(relativeTime(new Date(Date.now() - 3 * 3_600_000).toISOString())).toBe("3h ago");
    expect(relativeTime(new Date(Date.now() - 2 * 86_400_000).toISOString())).toBe("2d ago");
  });
  it("handles missing values", () => {
    expect(relativeTime(null)).toBe("Never");
    expect(relativeTime("not-a-date")).toBe("Never");
  });
});
