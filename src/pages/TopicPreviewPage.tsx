import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft, ArrowRight, CheckCircle2, ChevronRight, Code2, ListChecks,
  Loader2, Sparkles, TriangleAlert,
} from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import Seo from "@/components/Seo";
import StudyMarkdown from "@/components/StudyMarkdown";
import {
  fetchPublicTopicPreview,
  fetchPublicTopics,
  resolvePublicSubject,
  type PublicSubject,
} from "@/lib/public-topics";
import type { SubjectTopic, TopicPageData } from "@/lib/notes-reader";
import { SITE_URL, extractHeadings, extractSummary, metaDescription } from "@/lib/seo";

/**
 * /topics/:subjectSlug/:topicSlug — public preview of one topic page
 * (Full SEO program, 26 Nov 2026). Shows the topic's own short summary
 * (locked content, rendered as-is), its key points and the full page's
 * section list, then a sign-up CTA for the complete interactive page.
 * The signed-in TopicPage experience is untouched.
 */
const TopicPreviewPage = () => {
  const { subjectSlug = "", topicSlug = "" } = useParams();
  const [subject, setSubject] = useState<PublicSubject | null>(null);
  const [topic, setTopic] = useState<SubjectTopic | null>(null);
  const [page, setPage] = useState<TopicPageData | null>(null);
  const [siblings, setSiblings] = useState<SubjectTopic[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const subj = await resolvePublicSubject(subjectSlug);
      if (cancelled) return;
      if (!subj) { setState("missing"); return; }
      setSubject(subj);
      const [preview, all] = await Promise.all([
        fetchPublicTopicPreview(subj.name, topicSlug),
        fetchPublicTopics(subj.name),
      ]);
      if (cancelled) return;
      if (!preview) { setState("missing"); return; }
      setTopic(preview.topic);
      setPage(preview.page);
      setSiblings(all);
      setState("ready");
    })().catch(() => { if (!cancelled) setState("missing"); });
    return () => { cancelled = true; };
  }, [subjectSlug, topicSlug]);

  const summaryBlock = useMemo(() => {
    if (!page) return "";
    return (page.body_md || "").split(/\n\s*\n/)[0] || "";
  }, [page]);

  const headings = useMemo(() => (page ? extractHeadings(page.body_md) : []), [page]);

  if (state === "loading") {
    return (
      <div className="min-h-screen flex flex-col gradient-hero">
        <Navbar />
        <div className="flex-1 flex justify-center items-center py-24">
          <Loader2 className="w-7 h-7 animate-spin text-primary" />
        </div>
        <Footer />
      </div>
    );
  }

  if (state === "missing" || !subject || !topic || !page) {
    return (
      <div className="min-h-screen flex flex-col gradient-hero">
        <Seo title="Topic Not Found — UniGenius AI" path={`/topics/${subjectSlug}/${topicSlug}`} noindex />
        <Navbar />
        <main className="flex-1 container mx-auto px-4 py-20 max-w-2xl text-center">
          <h1 className="font-display font-bold text-2xl text-foreground">Topic not found</h1>
          <p className="mt-2 text-muted-foreground">
            We could not find that topic. Browse all subjects and topics instead.
          </p>
          <Link to="/topics" className="mt-5 inline-block gradient-primary text-primary-foreground font-display font-bold text-sm rounded-xl px-6 py-2.5">
            Browse all topics
          </Link>
        </main>
        <Footer />
      </div>
    );
  }

  const idx = siblings.findIndex((t) => t.id === topic.id);
  const prev = idx > 0 ? siblings[idx - 1] : null;
  const next = idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1] : null;
  const path = `/topics/${subject.slug}/${topic.slug}`;
  const summary = extractSummary(page.body_md);
  const description = metaDescription(
    `${page.title} — ${subject.name} study notes: ${page.key_points[0] || summary}`,
  );

  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
        { "@type": "ListItem", position: 2, name: "Topics", item: `${SITE_URL}/topics` },
        { "@type": "ListItem", position: 3, name: subject.name, item: `${SITE_URL}/topics/${subject.slug}` },
        { "@type": "ListItem", position: 4, name: page.title, item: `${SITE_URL}${path}` },
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "LearningResource",
      name: page.title,
      description,
      url: `${SITE_URL}${path}`,
      learningResourceType: "Study notes",
      educationalLevel: "University",
      about: { "@type": "Thing", name: subject.name },
      isPartOf: { "@type": "WebSite", name: "UniGenius AI", url: `${SITE_URL}/` },
      inLanguage: ["en", "ur"],
    },
  ];

  return (
    <div className="min-h-screen flex flex-col gradient-hero">
      <Seo title={`${page.title} — ${subject.name} Notes | UniGenius AI`} description={description} path={path} jsonLd={jsonLd} ogType="article" />
      <Navbar />
      <main className="flex-1 container mx-auto px-4 md:px-6 lg:px-10 py-8 max-w-3xl w-full pb-28 md:pb-10">
        <nav className="text-xs text-muted-foreground flex items-center gap-1.5 mb-4 flex-wrap" aria-label="Breadcrumb">
          <Link to="/" className="hover:text-foreground">Home</Link>
          <ChevronRight className="w-3 h-3" />
          <Link to="/topics" className="hover:text-foreground">Topics</Link>
          <ChevronRight className="w-3 h-3" />
          <Link to={`/topics/${subject.slug}`} className="hover:text-foreground">{subject.name}</Link>
          <ChevronRight className="w-3 h-3" />
          <span className="text-foreground font-medium">{page.title}</span>
        </nav>

        <p className="text-xs font-semibold uppercase tracking-wider text-primary">
          {subject.name} · Topic {topic.topic_no}
        </p>
        <h1 className="mt-1.5 font-display font-bold text-3xl md:text-4xl text-foreground leading-tight">
          {page.title}
        </h1>

        {/* Short summary — the page's own locked summary, rendered as-is */}
        <section className="mt-6 glass rounded-2xl border border-primary/25 p-5">
          <h2 className="font-display font-bold text-base text-foreground flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" /> Short summary
          </h2>
          <div className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
            <StudyMarkdown content={summaryBlock} />
          </div>
        </section>

        {/* Key points */}
        {page.key_points.length > 0 && (
          <section className="mt-6">
            <h2 className="font-display font-bold text-lg text-foreground flex items-center gap-2">
              <ListChecks className="w-5 h-5 text-primary" /> Key points
            </h2>
            <ul className="mt-3 space-y-2">
              {page.key_points.map((kp, i) => (
                <li key={i} className="flex items-start gap-2.5 text-sm leading-relaxed text-muted-foreground">
                  <CheckCircle2 className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                  <span>{kp}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* What's inside the full page */}
        <section className="mt-8 glass rounded-2xl border border-border p-5">
          <h2 className="font-display font-bold text-base text-foreground">Inside the full topic page</h2>
          {headings.length > 0 && (
            <ul className="mt-3 grid sm:grid-cols-2 gap-x-4 gap-y-1.5">
              {headings.map((h, i) => (
                <li key={i} className="text-sm text-muted-foreground flex items-center gap-2">
                  <ChevronRight className="w-3.5 h-3.5 text-primary shrink-0" /> {h}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted-foreground">
            {page.code_examples.length > 0 && (
              <span className="inline-flex items-center gap-1.5 border border-border rounded-full px-2.5 py-1">
                <Code2 className="w-3.5 h-3.5 text-primary" /> {page.code_examples.length} code examples
              </span>
            )}
            {page.common_mistakes.length > 0 && (
              <span className="inline-flex items-center gap-1.5 border border-border rounded-full px-2.5 py-1">
                <TriangleAlert className="w-3.5 h-3.5 text-primary" /> {page.common_mistakes.length} common mistakes covered
              </span>
            )}
            <span className="inline-flex items-center gap-1.5 border border-border rounded-full px-2.5 py-1">
              <ListChecks className="w-3.5 h-3.5 text-primary" /> Practice questions in the app
            </span>
          </div>

          <div className="mt-5 flex flex-wrap gap-2.5">
            <Link to="/auth" className="gradient-primary text-primary-foreground font-display font-bold text-sm rounded-xl px-5 py-2.5">
              Read the full page — free
            </Link>
            <Link to="/question-bank" className="border border-border font-display font-bold text-sm rounded-xl px-5 py-2.5 text-foreground hover:border-primary/40">
              Practise questions
            </Link>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            This is a free preview. The complete topic page — full explanation, code examples and
            practice questions — is free with a UniGenius account.
          </p>
        </section>

        {/* Prev / next */}
        <nav className="mt-8 flex items-stretch justify-between gap-3" aria-label="More topics">
          {prev ? (
            <Link to={`/topics/${subject.slug}/${prev.slug}`} className="glass rounded-2xl border border-border px-4 py-3 flex items-center gap-2 max-w-[48%] hover:border-primary/40 group">
              <ArrowLeft className="w-4 h-4 text-muted-foreground shrink-0" />
              <span className="min-w-0">
                <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">Previous</span>
                <span className="block text-sm font-medium text-foreground truncate group-hover:text-primary">{prev.title}</span>
              </span>
            </Link>
          ) : <span />}
          {next ? (
            <Link to={`/topics/${subject.slug}/${next.slug}`} className="glass rounded-2xl border border-border px-4 py-3 flex items-center gap-2 max-w-[48%] hover:border-primary/40 group text-right">
              <span className="min-w-0">
                <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">Next</span>
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

export default TopicPreviewPage;
