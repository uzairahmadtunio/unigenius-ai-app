import { useEffect } from "react";
import {
  DEFAULT_DESCRIPTION,
  DEFAULT_TITLE,
  OG_IMAGE,
  SITE_NAME,
  canonicalFor,
} from "@/lib/seo";

/**
 * Per-route head manager (Full SEO program, 26 Nov 2026).
 *
 * The SPA ships one static index.html whose title/description/canonical
 * all point at the homepage — every route used to look identical to
 * crawlers. This component rewrites the document head on mount for the
 * route it is rendered on: unique title + description, self-referencing
 * canonical, matching og:/twitter: tags, optional JSON-LD blocks and an
 * optional noindex (used by the soft-404 page). On unmount it restores
 * the site defaults so app screens never inherit a stale route title.
 */

interface SeoProps {
  title?: string;
  description?: string;
  /** In-app path for the canonical URL, e.g. "/lectures". */
  path?: string;
  ogType?: string;
  image?: string;
  jsonLd?: Record<string, unknown> | Record<string, unknown>[];
  noindex?: boolean;
}

const setMeta = (selector: string, attr: "name" | "property", key: string, content: string) => {
  let el = document.head.querySelector<HTMLMetaElement>(selector);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
};

const setCanonical = (href: string) => {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", "canonical");
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
};

const Seo = ({ title, description, path, ogType = "website", image, jsonLd, noindex }: SeoProps) => {
  const ldKey = jsonLd ? JSON.stringify(jsonLd) : "";

  useEffect(() => {
    const finalTitle = title || DEFAULT_TITLE;
    const finalDesc = description || DEFAULT_DESCRIPTION;
    const url = canonicalFor(path ?? window.location.pathname);
    const img = image || OG_IMAGE;

    document.title = finalTitle;
    setMeta('meta[name="description"]', "name", "description", finalDesc);
    setCanonical(url);
    setMeta('meta[property="og:title"]', "property", "og:title", finalTitle);
    setMeta('meta[property="og:description"]', "property", "og:description", finalDesc);
    setMeta('meta[property="og:url"]', "property", "og:url", url);
    setMeta('meta[property="og:type"]', "property", "og:type", ogType);
    setMeta('meta[property="og:image"]', "property", "og:image", img);
    setMeta('meta[property="og:site_name"]', "property", "og:site_name", SITE_NAME);
    setMeta('meta[name="twitter:card"]', "name", "twitter:card", "summary_large_image");
    setMeta('meta[name="twitter:title"]', "name", "twitter:title", finalTitle);
    setMeta('meta[name="twitter:description"]', "name", "twitter:description", finalDesc);
    setMeta('meta[name="twitter:image"]', "name", "twitter:image", img);
    if (noindex) setMeta('meta[name="robots"]', "name", "robots", "noindex, follow");

    let ldScript: HTMLScriptElement | null = null;
    if (ldKey) {
      ldScript = document.createElement("script");
      ldScript.type = "application/ld+json";
      ldScript.setAttribute("data-seo-ld", "1");
      ldScript.textContent = ldKey;
      document.head.appendChild(ldScript);
    }

    return () => {
      if (ldScript) ldScript.remove();
      if (noindex) {
        document.head.querySelector('meta[name="robots"]')?.remove();
      }
      // Restore site defaults; the next route's Seo overwrites them.
      document.title = DEFAULT_TITLE;
      setMeta('meta[name="description"]', "name", "description", DEFAULT_DESCRIPTION);
      setCanonical(canonicalFor("/"));
      setMeta('meta[property="og:title"]', "property", "og:title", DEFAULT_TITLE);
      setMeta('meta[property="og:description"]', "property", "og:description", DEFAULT_DESCRIPTION);
      setMeta('meta[property="og:url"]', "property", "og:url", canonicalFor("/"));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, description, path, ogType, image, noindex, ldKey]);

  return null;
};

export default Seo;
