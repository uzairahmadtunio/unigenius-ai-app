import { supabase } from "@/integrations/supabase/client";

/**
 * Thrown by authHeader() when the stored session is dead beyond recovery —
 * its refresh token was rejected (rotated by another device/tab, revoked, or
 * expired), so no valid access token can ever be minted from it. Callers
 * surface err.message, which reads as a plain instruction instead of the
 * server's raw "Unauthorized" for a corpse token.
 */
export class SessionExpiredError extends Error {
  constructor() {
    super("Your session has expired — please sign in again to continue.");
    this.name = "SessionExpiredError";
  }
}

let signOutStarted = false;

function isRetryableFetchError(error: unknown): boolean {
  const e = error as { name?: string; status?: number } | null | undefined;
  if (!e) return false;
  return e.name === "AuthRetryableFetchError" || e.status === 0;
}

/**
 * Returns an Authorization header using the current user's JWT, falling back to
 * the publishable anon key. Edge functions that call requireAuth() need the user JWT.
 *
 * Aged-session hardening (Bug #5 follow-up, 2026-11-25): getSession() can hand
 * back an access token that has already expired (e.g. the app was backgrounded
 * on a phone past the token's lifetime and the background refresh has not run
 * yet). requireAuth() rejects an expired token with 401, which surfaces to the
 * user as a bogus "Unauthorized". If the stored token is expired or within
 * 30 s of expiry, refresh the session first and use the fresh token.
 *
 * Dead-session handling (2026-11-27): if that refresh is rejected by the auth
 * server (anything other than a transient network error), the refresh token
 * is dead and the session can never be revived. The old fallback — sending
 * the expired access token anyway — made every AI action fail with a raw
 * "Unauthorized" while the user still looked signed in. Now the corpse
 * session is cleared locally (so the app returns to its proper signed-out
 * state and sign-in prompts) and a SessionExpiredError is thrown instead.
 * A transient network failure during refresh keeps the old behaviour: send
 * the current token and let the request fail on its own merits.
 */
export async function authHeader(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  let session = data.session;
  const expiresAtMs = session?.expires_at ? session.expires_at * 1000 : 0;
  const expiring = !!session && (!expiresAtMs || expiresAtMs < Date.now() + 30_000);
  if (session && !expiring) signOutStarted = false;
  if (session && expiring) {
    const { data: refreshed, error } = await supabase.auth.refreshSession();
    if (refreshed.session) {
      session = refreshed.session;
    } else if (isRetryableFetchError(error)) {
      // Network blip — keep the current token; no worse than before.
    } else {
      if (!signOutStarted) {
        signOutStarted = true;
        try {
          await supabase.auth.signOut({ scope: "local" });
        } catch { /* already gone — nothing to clear */ }
      }
      throw new SessionExpiredError();
    }
  }
  const token = session?.access_token;
  return `Bearer ${token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`;
}
