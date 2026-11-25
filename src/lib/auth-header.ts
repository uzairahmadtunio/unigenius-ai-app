import { supabase } from "@/integrations/supabase/client";

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
 */
export async function authHeader(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  let session = data.session;
  const expiresAtMs = session?.expires_at ? session.expires_at * 1000 : 0;
  if (session && expiresAtMs && expiresAtMs < Date.now() + 30_000) {
    const { data: refreshed } = await supabase.auth.refreshSession();
    if (refreshed.session) session = refreshed.session;
  }
  const token = session?.access_token;
  return `Bearer ${token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`;
}
