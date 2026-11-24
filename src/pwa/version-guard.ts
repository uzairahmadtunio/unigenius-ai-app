// Deterministic stale-build guard.
//
// Why this exists: some browser profiles kept serving an old UniGenius build
// after deploys — refresh / close / reopen did not help, only a manual
// "Clear & reset" in site settings did. The service-worker update chain can
// silently stall (a failed SW install, a throttled update check), so this
// guard does not rely on it:
//
//   1. Every production build writes /version.json holding the entry bundle
//      hash of THAT build (scripts/write-version.mjs, run after vite build).
//   2. This guard compares the hash of the bundle that is actually running
//      (read from the page's own <script src>) against /version.json, fetched
//      with cache: "no-store" so neither HTTP cache nor the SW can fake it.
//   3. On mismatch it does automatically what "Clear & reset" does manually —
//      unregister service workers + delete Cache Storage — then reloads.
//      Login is NOT touched: the Supabase session lives in localStorage.
//
// The purge runs at most once per target build per browser session
// (sessionStorage), so a bad deploy can never cause a reload loop.

import { clearServiceWorkersAndCaches } from "./purge";

function runningEntryHash(): string | null {
  const scripts = Array.from(document.querySelectorAll<HTMLScriptElement>("script[src]"));
  for (const s of scripts) {
    const m = s.src.match(/index-([A-Za-z0-9_-]+)\.js/);
    if (m) return m[1];
  }
  return null;
}

let checking = false;

async function purgeAndReload(targetHash: string): Promise<void> {
  const key = "ug-ver-purge-" + targetHash;
  try {
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
  } catch {
    return;
  }
  await clearServiceWorkersAndCaches();
  window.location.reload();
}

async function checkVersion(): Promise<void> {
  if (checking) return;
  checking = true;
  try {
    const current = runningEntryHash();
    if (!current) return;
    const res = await fetch("/version.json?ts=" + Date.now(), { cache: "no-store" });
    if (!res.ok) return;
    const data: unknown = await res.json().catch(() => null);
    const entry =
      data && typeof data === "object" && "entry" in data
        ? String((data as { entry: unknown }).entry)
        : null;
    if (entry && entry !== current) {
      await purgeAndReload(entry);
    }
  } catch {
    /* offline or transient — the next check retries */
  } finally {
    checking = false;
  }
}

export function startVersionGuard(): void {
  if (typeof window === "undefined") return;
  if (!import.meta.env.PROD) return;
  const host = window.location.hostname;
  if (host.endsWith(".lovableproject.com") || host.startsWith("id-preview--")) return;

  window.setTimeout(checkVersion, 4000);
  window.setInterval(checkVersion, 5 * 60 * 1000);
  window.addEventListener("focus", checkVersion);
  window.addEventListener("online", checkVersion);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkVersion();
  });
}
