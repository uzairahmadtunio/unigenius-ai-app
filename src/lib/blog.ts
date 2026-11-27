import data from "@/data/blog-posts.json";

/**
 * Study Guides blog (SEO Round 2, 26 Nov 2026).
 *
 * Articles live as structured data in src/data/blog-posts.json so the
 * React pages here and the build-time prerender script
 * (scripts/prerender.mjs) render from one source. The blog is a
 * public, visitor-facing section only: it is linked from the public
 * landing footer and lives on its own /blog routes — it is NOT wired
 * into the signed-in app (no dashboard/nav/tile links), per Uzair's
 * instruction that the app interface stays untouched.
 */

export interface BlogSection {
  heading: string;
  paragraphs: string[];
  list?: string[];
}

export interface BlogLink {
  label: string;
  href: string;
}

export interface BlogPost {
  slug: string;
  title: string;
  description: string;
  datePublished: string;
  readingMinutes: number;
  tags: string[];
  intro: string;
  sections: BlogSection[];
  links: BlogLink[];
}

export const BLOG_POSTS: BlogPost[] = (data as { articles: BlogPost[] }).articles;

export const getBlogPost = (slug: string): BlogPost | null =>
  BLOG_POSTS.find((p) => p.slug === slug) ?? null;

/** Total words of an article (intro + sections + lists) — used by tests. */
export const blogWordCount = (post: BlogPost): number => {
  const parts = [post.intro];
  for (const s of post.sections) {
    parts.push(s.heading, ...s.paragraphs, ...(s.list ?? []));
  }
  return parts.join(" ").split(/\s+/).filter(Boolean).length;
};
