// Shared "clear & reset" routine: unregister service workers and delete
// Cache Storage WITHOUT touching localStorage — the Supabase session and
// user preferences live there and must survive. Used by the version guard
// (stale build detected) and by the lazy-chunk retry (a stale entry bundle
// referenced a chunk that no longer exists on the server).

export async function clearServiceWorkersAndCaches(): Promise<void> {
  const jobs: Promise<unknown>[] = [];
  if ("serviceWorker" in navigator) {
    jobs.push(
      navigator.serviceWorker
        .getRegistrations()
        .then((rs) => Promise.all(rs.map((r) => r.unregister().catch(() => false))))
        .catch(() => [])
    );
  }
  if (window.caches) {
    jobs.push(
      caches
        .keys()
        .then((ks) => Promise.all(ks.map((k) => caches.delete(k).catch(() => false))))
        .catch(() => [])
    );
  }
  await Promise.all(jobs);
}
