import { describe, it, expect } from "vitest";
import { availableModes, resolveViewMode, isViewingAs } from "@/lib/view-mode";

describe("availableModes", () => {
  it("admin gets all three modes, most privileged first", () => {
    expect(availableModes(["admin"])).toEqual(["admin", "teacher", "student"]);
    expect(availableModes(["admin", "teacher"])).toEqual(["admin", "teacher", "student"]);
  });
  it("teacher gets teacher + student only", () => {
    expect(availableModes(["teacher"])).toEqual(["teacher", "student"]);
  });
  it("students and role-less users get student only", () => {
    expect(availableModes(["student"])).toEqual(["student"]);
    expect(availableModes([])).toEqual(["student"]);
  });
});

describe("resolveViewMode", () => {
  it("honours a stored mode that is still allowed", () => {
    expect(resolveViewMode(["admin"], "student")).toBe("student");
    expect(resolveViewMode(["teacher"], "student")).toBe("student");
    expect(resolveViewMode(["teacher"], "teacher")).toBe("teacher");
  });
  it("falls back to the primary mode when the stored mode is not allowed", () => {
    expect(resolveViewMode(["teacher"], "admin")).toBe("teacher");
    expect(resolveViewMode(["student"], "teacher")).toBe("student");
  });
  it("falls back on missing or garbage stored values", () => {
    expect(resolveViewMode(["admin"], null)).toBe("admin");
    expect(resolveViewMode(["teacher"], "bogus")).toBe("teacher");
    expect(resolveViewMode([], null)).toBe("student");
  });
});

describe("isViewingAs", () => {
  it("is false in the account's primary mode", () => {
    expect(isViewingAs(["admin"], "admin")).toBe(false);
    expect(isViewingAs(["teacher"], "teacher")).toBe(false);
    expect(isViewingAs(["student"], "student")).toBe(false);
  });
  it("is true when viewing below the real role (badge must show)", () => {
    expect(isViewingAs(["admin"], "teacher")).toBe(true);
    expect(isViewingAs(["admin"], "student")).toBe(true);
    expect(isViewingAs(["teacher"], "student")).toBe(true);
  });
});
