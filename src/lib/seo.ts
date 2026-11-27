// ─── SEO helpers (Full SEO program, 26 Nov 2026) ─────────────────────
// Shared constants + text helpers for per-route meta, JSON-LD and the
// public topic preview pages. Pure functions — unit-tested in
// src/test/seo.test.ts.

export const SITE_URL = "https://unigenius.vercel.app";
export const SITE_NAME = "UniGenius AI";
export const DEFAULT_TITLE = "UniGenius AI: Master Your Logic";
export const DEFAULT_DESCRIPTION =
  "UniGenius AI is the AI study assistant for CS, SE & AI university students: smart notes, topic pages, video lectures, a 2,500+ question bank, viva prep, a code lab and past papers — all in one place.";
export const OG_IMAGE = `${SITE_URL}/og-image.png`;

/** Absolute URL for an in-app path ("/lectures" -> full canonical URL). */
export const canonicalFor = (path: string): string => {
  if (!path || path === "/") return `${SITE_URL}/`;
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
};

/** "Object Oriented Programming" -> "object-oriented-programming". */
export const slugify = (text: string): string =>
  (text || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** Strip markdown syntax for meta descriptions / plain-text excerpts. */
export const stripMarkdown = (md: string): string =>
  (md || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_~>]+/g, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * The topic pages open with a "*Short summary: …*" line (Roman Urdu,
 * locked content — rendered, never edited). Extract it for previews
 * and meta descriptions; falls back to the first body paragraph.
 */
export const extractSummary = (bodyMd: string): string => {
  const text = (bodyMd || "").trim();
  const firstBlock = text.split(/\n\s*\n/)[0] || "";
  const plain = stripMarkdown(firstBlock);
  const m = plain.match(/^short summary:\s*(.+)$/i);
  if (m) return m[1].trim();
  return plain;
};

/** Clamp a meta description to a sane length on a word boundary. */
export const metaDescription = (text: string, max = 158): string => {
  const clean = (text || "").replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trim()}…`;
};

/** H2/H3 headings of a topic page body — the preview "what's inside" list. */
export const extractHeadings = (bodyMd: string): string[] => {
  const out: string[] = [];
  for (const line of (bodyMd || "").split("\n")) {
    const m = line.match(/^#{2,3}\s+(.+)$/);
    if (m) out.push(stripMarkdown(m[1]));
  }
  return out;
};
