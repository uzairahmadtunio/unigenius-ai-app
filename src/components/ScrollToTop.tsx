import { useEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

/**
 * Scroll manager (replaces the old scroll-to-top-on-every-route component).
 *
 * Behaviour:
 * - PUSH / REPLACE navigations (opening a new screen) start at the top.
 * - POP navigations (browser Back / in-app Back) restore the exact scroll
 *   position the user left that history entry at, so a list they had
 *   scrolled down (e.g. subjects near the bottom) is right where they
 *   left it instead of jumping to the top.
 *
 * Positions are kept per history entry (location.key) in a module-level
 * map, recorded continuously while scrolling. Restoration retries for a
 * short window because route chunks and list data render asynchronously.
 */
const positions = new Map<string, number>();
const MAX_ENTRIES = 60;

function remember(key: string, y: number) {
  positions.set(key, y);
  if (positions.size > MAX_ENTRIES) {
    const oldest = positions.keys().next().value;
    if (oldest !== undefined && oldest !== key) positions.delete(oldest);
  }
}

const ScrollToTop = () => {
  const location = useLocation();
  const navType = useNavigationType();
  const keyRef = useRef(location.key);
  keyRef.current = location.key;

  // Take over scroll restoration from the browser (unreliable for SPAs).
  useEffect(() => {
    if ("scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }
  }, []);

  // Continuously record the scroll offset of the current history entry.
  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => remember(keyRef.current, window.scrollY));
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  useEffect(() => {
    if (navType === "POP") {
      const y = positions.get(location.key) ?? 0;
      if (y > 0) {
        let tries = 0;
        const attempt = () => {
          window.scrollTo(0, y);
          tries += 1;
          if (Math.abs(window.scrollY - y) > 4 && tries < 30) {
            requestAnimationFrame(attempt);
          }
        };
        requestAnimationFrame(attempt);
        return;
      }
      window.scrollTo(0, 0);
      return;
    }
    // PUSH / REPLACE: a fresh screen starts at the top.
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [location.key, navType]);

  return null;
};

export default ScrollToTop;
