import { Link } from "react-router-dom";
import { ArrowRight, BookOpen, Clock3 } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import Seo from "@/components/Seo";
import { BLOG_POSTS } from "@/lib/blog";
import { SITE_URL } from "@/lib/seo";

/**
 * /blog — public Study Guides index (SEO Round 2). Standalone public
 * page for visitors and search engines; linked only from the public
 * landing footer. The signed-in app never links here.
 */
const BlogIndexPage = () => {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "UniGenius Study Guides",
    description:
      "Study guides and exam preparation articles for CS, SE and AI university students.",
    itemListElement: BLOG_POSTS.map((p, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: p.title,
      url: `${SITE_URL}/blog/${p.slug}`,
    })),
  };

  return (
    <div className="min-h-screen flex flex-col gradient-hero">
      <Seo
        title="Study Guides & Exam Tips for CS, SE & AI Students | UniGenius AI"
        description="Free study guides for university students: final exam plans, OOP, DLD, calculus and DSA guides, viva preparation and past-paper strategy from UniGenius AI."
        path="/blog"
        jsonLd={jsonLd}
      />
      <Navbar />
      <main className="flex-1 container mx-auto px-4 md:px-6 lg:px-10 py-8 max-w-5xl w-full pb-28 md:pb-10">
        <p className="text-xs font-semibold uppercase tracking-wider text-primary flex items-center gap-1.5">
          <BookOpen className="w-4 h-4" /> UniGenius Blog
        </p>
        <h1 className="mt-2 font-display font-bold text-3xl md:text-4xl text-foreground leading-tight">
          Study guides &amp; exam tips
        </h1>
        <p className="mt-3 max-w-3xl text-[15px] leading-relaxed text-muted-foreground">
          Practical guides written for Computer Science, Software Engineering and Artificial
          Intelligence students: how to plan your final-exam revision, how to study the hard
          subjects topic by topic, and how to walk into vivas and exams prepared. Every guide
          links into the matching topic pages, lectures and practice questions inside UniGenius.
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {BLOG_POSTS.map((p) => (
            <Link
              key={p.slug}
              to={`/blog/${p.slug}`}
              className="glass group rounded-2xl border border-border p-5 transition hover:border-primary/40"
            >
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                {p.tags.map((t) => (
                  <span key={t} className="rounded-full border border-border px-2 py-0.5 font-medium">
                    {t}
                  </span>
                ))}
                <span className="inline-flex items-center gap-1">
                  <Clock3 className="w-3.5 h-3.5" /> {p.readingMinutes} min read
                </span>
              </div>
              <h2 className="mt-3 font-display font-bold text-lg leading-snug text-foreground group-hover:text-primary">
                {p.title}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{p.description}</p>
              <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary">
                Read the guide <ArrowRight className="w-3.5 h-3.5 transition group-hover:translate-x-0.5" />
              </span>
            </Link>
          ))}
        </div>

        <section className="mt-10 glass rounded-2xl border border-primary/25 p-5 md:p-6 text-center">
          <h2 className="font-display font-bold text-lg text-foreground">
            Study the topics behind these guides — free
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Every guide on this page connects to structured topic pages, video lectures and a
            2,500+ question bank inside UniGenius. Create a free account and study your own
            subjects, matched to your semester.
          </p>
          <Link
            to="/auth"
            className="mt-4 inline-block gradient-primary text-primary-foreground font-display font-bold text-sm rounded-xl px-6 py-2.5"
          >
            Get Started Free
          </Link>
        </section>
      </main>
      <Footer />
    </div>
  );
};

export default BlogIndexPage;
