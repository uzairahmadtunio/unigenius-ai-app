import { describe, expect, it } from "vitest";
import { BLOG_POSTS, blogWordCount, getBlogPost } from "@/lib/blog";

// Study Guides blog (SEO Round 2): the articles are rendered by the
// React pages AND the build-time prerender from the same JSON source,
// so their shape is guarded here — a malformed article would break
// both surfaces at once.
describe("blog posts data", () => {
  it("ships 14 articles with unique, URL-safe slugs", () => {
    expect(BLOG_POSTS.length).toBe(14);
    const slugs = BLOG_POSTS.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of slugs) expect(s).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("every article has complete meta and real substance", () => {
    for (const p of BLOG_POSTS) {
      expect(p.title.length).toBeGreaterThan(20);
      expect(p.description.length).toBeGreaterThanOrEqual(80);
      expect(p.description.length).toBeLessThanOrEqual(180);
      expect(p.intro.length).toBeGreaterThan(100);
      expect(p.sections.length).toBeGreaterThanOrEqual(4);
      expect(p.readingMinutes).toBeGreaterThanOrEqual(3);
      expect(blogWordCount(p)).toBeGreaterThanOrEqual(300);
      for (const s of p.sections) {
        expect(s.heading.length).toBeGreaterThan(5);
        expect(s.paragraphs.length).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("internal links only point at real app routes or sibling guides", () => {
    const slugs = new Set(BLOG_POSTS.map((p) => p.slug));
    for (const p of BLOG_POSTS) {
      expect(p.links.length).toBeGreaterThanOrEqual(2);
      for (const l of p.links) {
        expect(l.href.startsWith("/")).toBe(true);
        if (l.href.startsWith("/blog/")) {
          expect(slugs.has(l.href.replace("/blog/", ""))).toBe(true);
        }
      }
    }
  });

  it("getBlogPost resolves known slugs and rejects unknown ones", () => {
    expect(getBlogPost("dld-study-guide")?.title).toContain("Digital Logic Design");
    expect(getBlogPost("no-such-guide")).toBeNull();
  });
});
