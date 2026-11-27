import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft, ArrowRight, CheckCircle2, ChevronRight, Clock3, ListChecks,
} from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import Seo from "@/components/Seo";
import { BLOG_POSTS, getBlogPost } from "@/lib/blog";
import { SITE_URL } from "@/lib/seo";

/**
 * /blog/:slug — one public Study Guide article (SEO Round 2).
 * Standalone public page; the signed-in app is untouched and never
 * links here. Content comes from src/data/blog-posts.json, the same
 * source the build-time prerender uses.
 */
const BlogPostPage = () => {
  const { slug = "" } = useParams();
  const post = getBlogPost(slug);

  if (!post) {
    return (
      <div className="min-h-screen flex flex-col gradient-hero">
        <Seo title="Guide Not Found — UniGenius AI" path={`/blog/${slug}`} noindex />
        <Navbar />
        <main className="flex-1 container mx-auto px-4 py-20 max-w-2xl text-center">
          <h1 className="font-display font-bold text-2xl text-foreground">Guide not found</h1>
          <p className="mt-2 text-muted-foreground">
            We could not find that study guide. Browse all guides instead.
          </p>
          <Link
            to="/blog"
            className="mt-5 inline-block gradient-primary text-primary-foreground font-display font-bold text-sm rounded-xl px-6 py-2.5"
          >
            Browse all study guides
          </Link>
        </main>
        <Footer />
      </div>
    );
  }

  const idx = BLOG_POSTS.findIndex((p) => p.slug === post.slug);
  const prev = idx > 0 ? BLOG_POSTS[idx - 1] : null;
  const next = idx < BLOG_POSTS.length - 1 ? BLOG_POSTS[idx + 1] : null;
  const path = `/blog/${post.slug}`;

  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: post.title,
      description: post.description,
      url: `${SITE_URL}${path}`,
      datePublished: post.datePublished,
      dateModified: post.datePublished,
      author: { "@type": "Person", name: "Uzair Ahmad Tunio" },
      publisher: { "@id": `${SITE_URL}/#organization` },
      image: `${SITE_URL}/og-image.png`,
      inLanguage: "en",
      about: post.tags.map((t) => ({ "@type": "Thing", name: t })),
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
        { "@type": "ListItem", position: 2, name: "Study Guides", item: `${SITE_URL}/blog` },
        { "@type": "ListItem", position: 3, name: post.title, item: `${SITE_URL}${path}` },
      ],
    },
  ];

  return (
    <div className="min-h-screen flex flex-col gradient-hero">
      <Seo title={`${post.title} | UniGenius AI`} description={post.description} path={path} jsonLd={jsonLd} ogType="article" />
      <Navbar />
      <main className="flex-1 container mx-auto px-4 md:px-6 lg:px-10 py-8 max-w-3xl w-full pb-28 md:pb-10">
        <nav className="text-xs text-muted-foreground flex items-center gap-1.5 mb-4 flex-wrap" aria-label="Breadcrumb">
          <Link to="/" className="hover:text-foreground">Home</Link>
          <ChevronRight className="w-3 h-3" />
          <Link to="/blog" className="hover:text-foreground">Study Guides</Link>
          <ChevronRight className="w-3 h-3" />
          <span className="text-foreground font-medium">{post.title}</span>
        </nav>

        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          {post.tags.map((t) => (
            <span key={t} className="rounded-full border border-border px-2 py-0.5 font-medium">{t}</span>
          ))}
          <span className="inline-flex items-center gap-1">
            <Clock3 className="w-3.5 h-3.5" /> {post.readingMinutes} min read
          </span>
          <span>{new Date(`${post.datePublished}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</span>
        </div>

        <h1 className="mt-3 font-display font-bold text-3xl md:text-4xl text-foreground leading-tight">
          {post.title}
        </h1>
        <p className="mt-4 text-[15px] leading-relaxed text-muted-foreground">{post.intro}</p>

        {post.sections.map((s) => (
          <section key={s.heading} className="mt-8">
            <h2 className="font-display font-bold text-xl text-foreground">{s.heading}</h2>
            {s.paragraphs.map((p, i) => (
              <p key={i} className="mt-3 text-[15px] leading-relaxed text-muted-foreground">{p}</p>
            ))}
            {s.list && (
              <ul className="mt-3 space-y-2">
                {s.list.map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-sm leading-relaxed text-muted-foreground">
                    <CheckCircle2 className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}

        <section className="mt-10 glass rounded-2xl border border-primary/25 p-5">
          <h2 className="font-display font-bold text-base text-foreground flex items-center gap-2">
            <ListChecks className="w-5 h-5 text-primary" /> Keep studying
          </h2>
          <div className="mt-3 flex flex-wrap gap-2.5">
            {post.links.map((l) =>
              l.href.startsWith("/blog/") ? (
                <Link key={l.href} to={l.href} className="border border-border font-display font-bold text-sm rounded-xl px-4 py-2 text-foreground hover:border-primary/40">
                  {l.label}
                </Link>
              ) : (
                <Link key={l.href} to={l.href} className="gradient-primary text-primary-foreground font-display font-bold text-sm rounded-xl px-4 py-2">
                  {l.label}
                </Link>
              ),
            )}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            UniGenius AI is free for students — topic pages, lectures, past papers, a question
            bank and an AI tutor for CS, SE &amp; AI degrees.
          </p>
        </section>

        <nav className="mt-8 flex items-stretch justify-between gap-3" aria-label="More guides">
          {prev ? (
            <Link to={`/blog/${prev.slug}`} className="glass rounded-2xl border border-border px-4 py-3 flex items-center gap-2 max-w-[48%] hover:border-primary/40 group">
              <ArrowLeft className="w-4 h-4 text-muted-foreground shrink-0" />
              <span className="min-w-0">
                <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">Previous guide</span>
                <span className="block text-sm font-medium text-foreground truncate group-hover:text-primary">{prev.title}</span>
              </span>
            </Link>
          ) : <span />}
          {next ? (
            <Link to={`/blog/${next.slug}`} className="glass rounded-2xl border border-border px-4 py-3 flex items-center gap-2 max-w-[48%] hover:border-primary/40 group text-right">
              <span className="min-w-0">
                <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">Next guide</span>
                <span className="block text-sm font-medium text-foreground truncate group-hover:text-primary">{next.title}</span>
              </span>
              <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0" />
            </Link>
          ) : <span />}
        </nav>
      </main>
      <Footer />
    </div>
  );
};

export default BlogPostPage;
