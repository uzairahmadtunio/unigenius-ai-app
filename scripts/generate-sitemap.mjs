#!/usr/bin/env node
/**
 * Generate public/sitemap.xml (Full SEO program, 26 Nov 2026).
 *
 * Static routes + the public topic preview routes (/topics,
 * /topics/:subjectSlug, /topics/:subjectSlug/:topicSlug) built from
 * subject_topics in Supabase (public-read under RLS). Run manually
 * after content changes:  node scripts/generate-sitemap.mjs
 * Deliberately NOT wired into `npm run build` so a network hiccup can
 * never break a deploy — the committed sitemap.xml is the fallback.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = "https://unigenius.vercel.app";

function readEnv(name) {
  for (const file of [".env.local", ".env"]) {
    try {
      const text = readFileSync(join(root, file), "utf8");
      const m = text.match(new RegExp(`^${name}=(.+)$`, "m"));
      if (m) return m[1].trim().replace(/^["']|["']$/g, "");
    } catch { /* try next */ }
  }
  return null;
}

const slugify = (text) =>
  (text || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const today = new Date().toISOString().slice(0, 10);

const STATIC_ROUTES = [
  ["/", "weekly", "1.0"],
  ["/topics", "weekly", "0.9"],
  ["/blog", "weekly", "0.8"],
  ["/about", "monthly", "0.8"],
  ["/lectures", "weekly", "0.8"],
  ["/courses", "weekly", "0.8"],
  ["/question-bank", "weekly", "0.8"],
  ["/projects", "weekly", "0.7"],
  ["/notes", "weekly", "0.7"],
  ["/library", "weekly", "0.7"],
  ["/past-papers", "monthly", "0.7"],
  ["/career", "monthly", "0.6"],
  ["/premium", "monthly", "0.6"],
  ["/contact", "monthly", "0.5"],
  ["/privacy", "yearly", "0.3"],
  ["/terms", "yearly", "0.3"],
];

async function main() {
  const url = readEnv("VITE_SUPABASE_URL");
  const key = readEnv("VITE_SUPABASE_PUBLISHABLE_KEY") || readEnv("VITE_SUPABASE_ANON_KEY");
  if (!url || !key) throw new Error("Supabase URL/key not found in .env.local/.env");

  const resp = await fetch(
    `${url}/rest/v1/subject_topics?select=subject,slug&order=subject,topic_no`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } },
  );
  if (!resp.ok) throw new Error(`subject_topics fetch failed: HTTP ${resp.status}`);
  const rows = await resp.json();

  const subjects = new Map(); // slug -> { name, topics: [slug] }
  for (const r of rows) {
    const sSlug = slugify(r.subject);
    if (!subjects.has(sSlug)) subjects.set(sSlug, { name: r.subject, topics: [] });
    subjects.get(sSlug).topics.push(r.slug);
  }

  const urls = [];
  const push = (loc, changefreq, priority) =>
    urls.push(
      `  <url><loc>${SITE}${loc}</loc><lastmod>${today}</lastmod><changefreq>${changefreq}</changefreq><priority>${priority}</priority></url>`,
    );

  for (const [loc, cf, pr] of STATIC_ROUTES) push(loc, cf, pr);
  // Blog / study guides (SEO Round 2) — slugs from the shared data file.
  try {
    const blog = JSON.parse(readFileSync(join(root, "src", "data", "blog-posts.json"), "utf8"));
    for (const a of blog.articles || []) push(`/blog/${a.slug}`, "monthly", "0.7");
  } catch { /* blog data optional for sitemap generation */ }
  for (const [sSlug, s] of [...subjects.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name))) {
    push(`/topics/${sSlug}`, "weekly", "0.8");
    for (const tSlug of s.topics) push(`/topics/${sSlug}/${tSlug}`, "monthly", "0.7");
  }

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.join("\n") +
    `\n</urlset>\n`;
  writeFileSync(join(root, "public", "sitemap.xml"), xml);
  console.log(`sitemap.xml written: ${urls.length} URLs (${subjects.size} subjects, ${rows.length} topics)`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
