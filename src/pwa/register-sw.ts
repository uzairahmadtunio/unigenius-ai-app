// Guarded service worker registration for UniGenius AI.
// Only registers in production deployments — never in Lovable previews, iframes,
// dev, or when the user opts out via ?sw=off.

const SW_PATH = "/sw.js";

function isInIframe(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

function isLovablePreviewHost(host: string): boolean {
  if (host.startsWith("id-preview--") || host.startsWith("preview--")) return true;
  if (host === "lovableproject.com" || host.endsWith(".lovableproject.com")) return true;
  if (host === "lovableproject-dev.com" || host.endsWith(".lovableproject-dev.com")) return true;
  if (host === "beta.lovable.dev" || host.endsWith(".beta.lovable.dev")) return true;
  return false;
}

async function unregisterMatching(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(
      regs
        .filter((r) => {
          const url = r.active?.scriptURL || r.installing?.scriptURL || r.waiting?.scriptURL || "";
          return url.endsWith(SW_PATH);
        })
        .map((r) => r.unregister().catch(() => false))
    );
  } catch {
    /* noop */
  }
}

export async function registerServiceWorker(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;

  const isProd = import.meta.env.PROD;
  const host = typeof window !== "undefined" ? window.location.hostname : "";
  const hasOptOut =
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("sw") === "off";

  const refuse = !isProd || isInIframe() || isLovablePreviewHost(host) || hasOptOut;

  if (refuse) {
    await unregisterMatching();
    return;
  }

  // Auto-update, part 1: when a NEW service worker takes control of this page,
  // reload once so the user immediately runs the freshly deployed bundle
  // instead of the stale one this document was loaded with. Guarded by
  // `hadController` so the very first install (no previous controller) does
  // not trigger a pointless reload.
  const hadController = !!navigator.serviceWorker.controller;
  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  try {
    const registration = await navigator.serviceWorker.register(SW_PATH, { scope: "/" });

    // Auto-update, part 2: actively poll for a new sw.js. Without this the
    // browser only re-checks on navigation (and throttles checks to ~24h),
    // so an installed PWA left open on a phone can serve the old build for a
    // day after a deploy. The generated SW uses skipWaiting + clientsClaim
    // (registerType: "autoUpdate"), so once an update is found it activates,
    // claims this page, and the controllerchange handler above reloads it.
    const checkForUpdate = () => {
      registration.update().catch(() => {
        /* offline or transient — next check will retry */
      });
    };
    checkForUpdate();
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") checkForUpdate();
    });
    window.addEventListener("focus", checkForUpdate);
    window.addEventListener("online", checkForUpdate);
    window.setInterval(checkForUpdate, 10 * 60 * 1000);
  } catch (err) {
    // Never break the app if SW fails
    console.warn("[PWA] Service worker registration failed:", err);
  }
}
