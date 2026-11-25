import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock supabase.auth before importing the module under test.
const h = vi.hoisted(() => ({ getSession: vi.fn(), refreshSession: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: h.getSession, refreshSession: h.refreshSession } },
}));

import { authHeader } from "@/lib/auth-header";

// Edge functions behind requireAuth() need the user's JWT; with no
// session the header must fall back to the publishable anon key.

beforeEach(() => {
  vi.clearAllMocks();
});

describe("authHeader", () => {
  it("returns the signed-in user's JWT when a session exists", async () => {
    h.getSession.mockResolvedValue({ data: { session: { access_token: "user-jwt-123" } } });
    expect(await authHeader()).toBe("Bearer user-jwt-123");
  });

  it("falls back to the publishable key when there is no session", async () => {
    h.getSession.mockResolvedValue({ data: { session: null } });
    const header = await authHeader();
    expect(header).toBe(`Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`);
    expect(header.startsWith("Bearer ")).toBe(true);
    expect(header).not.toContain("user-jwt");
  });

  it("does not refresh a token that is still comfortably valid", async () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    h.getSession.mockResolvedValue({ data: { session: { access_token: "fresh-jwt", expires_at: future } } });
    expect(await authHeader()).toBe("Bearer fresh-jwt");
    expect(h.refreshSession).not.toHaveBeenCalled();
  });

  it("refreshes an expired (aged) session and returns the fresh token", async () => {
    const past = Math.floor(Date.now() / 1000) - 600;
    h.getSession.mockResolvedValue({ data: { session: { access_token: "stale-jwt", expires_at: past } } });
    h.refreshSession.mockResolvedValue({ data: { session: { access_token: "refreshed-jwt", expires_at: past + 7200 } } });
    expect(await authHeader()).toBe("Bearer refreshed-jwt");
    expect(h.refreshSession).toHaveBeenCalledTimes(1);
  });

  it("keeps the stale token if the refresh attempt fails (no worse than before)", async () => {
    const past = Math.floor(Date.now() / 1000) - 600;
    h.getSession.mockResolvedValue({ data: { session: { access_token: "stale-jwt", expires_at: past } } });
    h.refreshSession.mockResolvedValue({ data: { session: null } });
    expect(await authHeader()).toBe("Bearer stale-jwt");
  });
});
