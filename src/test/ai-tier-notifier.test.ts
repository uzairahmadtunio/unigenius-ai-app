import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ toast: h.toast }));

import { notifyAiTier } from "@/lib/ai-tier-notifier";

// The tier notifier watches AI edge-function response headers: admins get
// one toast per tier/key change, students get none, repeats never spam.

const respWith = (tier?: string, keyIndex?: string) => {
  const headers = new Headers();
  if (tier) headers.set("x-ai-tier", tier);
  if (keyIndex) headers.set("x-ai-key-index", keyIndex);
  return new Response(null, { headers });
};

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
});

describe("notifyAiTier", () => {
  it("does nothing when the response carries no tier header", () => {
    notifyAiTier(respWith(), true);
    expect(h.toast).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("ai-last-tier")).toBeNull();
  });

  it("notifies an admin when traffic switches to a backup Gemini key", () => {
    notifyAiTier(respWith("gemini", "1"), true);
    expect(h.toast).toHaveBeenCalledTimes(1);
    expect(h.toast.mock.calls[0][0].title).toBe("Switched to Backup Key #2");
  });

  it("records the tier but never toasts non-admins", () => {
    notifyAiTier(respWith("gemini", "0"), false);
    expect(h.toast).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("ai-last-tier")).toBe("gemini:0");
  });

  it("does not re-toast the same tier+key on repeat responses", () => {
    notifyAiTier(respWith("gemini", "1"), true);
    notifyAiTier(respWith("gemini", "1"), true);
    expect(h.toast).toHaveBeenCalledTimes(1);
  });

  it("toasts again when the key index changes", () => {
    notifyAiTier(respWith("gemini", "1"), true);
    notifyAiTier(respWith("gemini", "2"), true);
    expect(h.toast).toHaveBeenCalledTimes(2);
    expect(h.toast.mock.calls[1][0].title).toBe("Switched to Backup Key #3");
  });

  it("never toasts for the primary 'lovable' tier", () => {
    notifyAiTier(respWith("lovable"), true);
    expect(h.toast).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("ai-last-tier")).toBe("lovable:-1");
  });

  it("raises a destructive toast when Groq fallback engages", () => {
    notifyAiTier(respWith("groq"), true);
    expect(h.toast).toHaveBeenCalledTimes(1);
    expect(h.toast.mock.calls[0][0]).toMatchObject({
      title: "Switched to Groq Backup",
      variant: "destructive",
    });
  });
});
