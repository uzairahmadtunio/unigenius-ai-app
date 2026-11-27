import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock supabase.auth before importing the module under test.
const h = vi.hoisted(() => ({ getSession: vi.fn(), refreshSession: vi.fn(), signOut: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: h.getSession, refreshSession: h.refreshSession, signOut: h.signOut } },
}));

import { authHeader, SessionExpiredError } from "@/lib/auth-header";

// Edge functions behind requireAuth() need the user's JWT; with no
// session the header must fall back to the publishable anon key.

beforeEach(() => {
  vi.clearAllMocks();
  h.signOut.mockResolvedValue({ error: null });
});

describe("authHeader", () => {
  it("returns the signed-in user's JWT when a session exists", async () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    h.getSession.mockResolvedValue({ data: { session: { access_token: "user-jwt-123", expires_at: future } } });
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
    h.refreshSession.mockResolvedValue({ data: { session: { access_token: "refreshed-jwt", expires_at: past + 7200 } }, error: null });
    expect(await authHeader()).toBe("Bearer refreshed-jwt");
    expect(h.refreshSession).toHaveBeenCalledTimes(1);
  });

  it("keeps the stale token when the refresh fails on a transient network error", async () => {
    const past = Math.floor(Date.now() / 1000) - 600;
    h.getSession.mockResolvedValue({ data: { session: { access_token: "stale-jwt", expires_at: past } } });
    h.refreshSession.mockResolvedValue({
      data: { session: null },
      error: { name: "AuthRetryableFetchError", status: 0, message: "Failed to fetch" },
    });
    expect(await authHeader()).toBe("Bearer stale-jwt");
    expect(h.signOut).not.toHaveBeenCalled();
  });

  it("throws SessionExpiredError and clears the corpse session when the refresh token is dead", async () => {
    const past = Math.floor(Date.now() / 1000) - 600;
    h.getSession.mockResolvedValue({ data: { session: { access_token: "stale-jwt", expires_at: past } } });
    h.refreshSession.mockResolvedValue({
      data: { session: null },
      error: { name: "AuthApiError", status: 400, message: "Invalid Refresh Token: Refresh Token Not Found" },
    });
    await expect(authHeader()).rejects.toBeInstanceOf(SessionExpiredError);
    await expect(authHeader()).rejects.toThrow("Your session has expired");
    expect(h.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("treats a refresh that yields no session and no error as a dead session too", async () => {
    const past = Math.floor(Date.now() / 1000) - 600;
    h.getSession.mockResolvedValue({ data: { session: { access_token: "stale-jwt", expires_at: past } } });
    h.refreshSession.mockResolvedValue({ data: { session: null }, error: null });
    await expect(authHeader()).rejects.toBeInstanceOf(SessionExpiredError);
  });
});
