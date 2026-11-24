import { lazy, type ComponentType } from "react";
import { clearServiceWorkersAndCaches } from "@/pwa/purge";

// Lazy route loading that survives stale builds.
//
// Failure mode this fixes (seen live on /practice, 24 Nov): after a deploy,
// a browser — especially the installed PWA — can still hold the PREVIOUS
// build's entry bundle. That bundle references lazy chunks by their old
// content hashes; those files no longer exist on the server, so the dynamic
// import fails with "Failed to fetch dynamically imported module" and the
// page never loads. The version guard eventually purges the stale build,
// but a user can hit the broken route before the guard's check runs, and
// the error boundary's single plain reload can be served the same stale
// shell again by the service worker.
//
// So: on the first chunk-load failure in a session, purge service workers
// + Cache Storage (login in localStorage is untouched) and reload, which
// lands on the fresh build whose chunk names match the server. If a chunk
// still fails after that purge, the error propagates to RouteErrorBoundary
// instead of looping forever.

const PURGE_KEY = "ug-lazy-purge-v1";

function isChunkLoadError(error: unknown): boolean {
  const msg = String((error as Error)?.message || error || "");
  return /failed to fetch dynamically imported module|loading chunk|importing a module script failed|chunkloaderror/i.test(
    msg
  );
}

export function lazyWithRetry<T extends ComponentType<never>>(
  importer: () => Promise<{ default: T }>
) {
  return lazy(async () => {
    try {
      return await importer();
    } catch (error) {
      if (isChunkLoadError(error)) {
        let alreadyPurged = true;
        try {
          alreadyPurged = sessionStorage.getItem(PURGE_KEY) === "1";
          if (!alreadyPurged) sessionStorage.setItem(PURGE_KEY, "1");
        } catch {
          // No sessionStorage access: treat as already purged so we can
          // never enter a reload loop.
          alreadyPurged = true;
        }
        if (!alreadyPurged) {
          await clearServiceWorkersAndCaches();
          window.location.reload();
          // The page is reloading; never settle, so React keeps showing
          // the Suspense fallback instead of flashing an error screen.
          return new Promise<{ default: T }>(() => {});
        }
      }
      throw error;
    }
  });
}
