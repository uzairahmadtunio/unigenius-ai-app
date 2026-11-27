import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ChevronRight, FileText, Loader2 } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import Seo from "@/components/Seo";
import {
  fetchPublicTopics,
  resolvePublicSubject,
  type PublicSubject,
} from "@/lib/public-topics";
import type { SubjectTopic } from "@/lib/notes-reader";
import { SITE_URL } from "@/lib/seo";

/**
 * /topics/:subjectSlug — public topic list for one subject
 * (Full SEO program, 26 Nov 2026).
 */
const SubjectTopicsPage = () => {
  const { subjectSlug = "" } = useParams();
  const [subject, setSubject] = useState<PublicSubject | null>(null);
  const [topics, setTopics] = useState<SubjectTopic[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const subj = await resolvePublicSubject(subjectSlug);
      if (cancelled) return;
      if (!subj) { setState("missing"); return; }
      setSubject(subj);
      const list = await fetchPublicTopics(subj.name);
      if (cancelled) return;
      setTopics(list);
      setState("ready");
    })().catch(() => { if (!cancelled) setState("missing"); });
    return () => { cancelled = true; };
  }, [subjectSlug]);

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

  if (state === "missing" || !subject) {
    return (
      <div className="min-h-screen flex flex-col gradient-hero">
        <Seo title="Subject Not Found — UniGenius AI" path={`/topics/${subjectSlug}`} noindex />
        <Navbar />
        <main className="flex-1 container mx-auto px-4 py-20 max-w-2xl text-center">
          <h1 className="font-display font-bold text-2xl text-foreground">Subject not found</h1>
          <p className="mt-2 text-muted-foreground">
            We could not find that subject. Browse all subjects on the topics index.
          </p>
          <Link to="/topics" className="mt-5 inline-block gradient-primary text-primary-foreground font-display font-bold text-sm rounded-xl px-6 py-2.5">
            Browse all topics
          </Link>
        </main>
        <Footer />
      </div>
    );
  }

  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
        { "@type": "ListItem", position: 2, name: "Topics", item: `${SITE_URL}/topics` },
        { "@type": "ListItem", position: 3, name: subject.name, item: `${SITE_URL}/topics/${subject.slug}` },
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: `${subject.name} — topics and study notes`,
      numberOfItems: topics.length,
      itemListElement: topics.map((t, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: t.title,
        url: `${SITE_URL}/topics/${subject.slug}/${t.slug}`,
      })),
    },
  ];

  return (
    <div className="min-h-screen flex flex-col gradient-hero">
      <Seo
        title={`${subject.name} Notes & Topics — UniGenius AI`}
        description={`Study ${subject.name} topic by topic: ${topics.length} structured topic pages with short summaries, key points, code examples and common mistakes — free previews on UniGenius AI.`}
        path={`/topics/${subject.slug}`}
        jsonLd={jsonLd}
      />
      <Navbar />
      <main className="flex-1 container mx-auto px-4 md:px-6 lg:px-10 py-8 max-w-4xl w-full pb-28 md:pb-10">
        <nav className="text-xs text-muted-foreground flex items-center gap-1.5 mb-4" aria-label="Breadcrumb">
          <Link to="/" className="hover:text-foreground">Home</Link>
          <ChevronRight className="w-3 h-3" />
          <Link to="/topics" className="hover:text-foreground">Topics</Link>
          <ChevronRight className="w-3 h-3" />
          <span className="text-foreground font-medium">{subject.name}</span>
        </nav>

        <h1 className="font-display font-bold text-3xl md:text-4xl text-foreground">
          {subject.name}
        </h1>
        <p className="mt-3 text-muted-foreground max-w-2xl leading-relaxed">
          {topics.length} topic pages for {subject.name}
          {subject.semesters.length > 0 && <> (Semester {subject.semesters.join(", ")})</>} — each with a
          short summary, key points, code examples and common mistakes. Tap any topic for a free preview.
        </p>

        <ol className="mt-8 space-y-2.5">
          {topics.map((t) => (
            <li key={t.id}>
              <Link
                to={`/topics/${subject.slug}/${t.slug}`}
                className="glass rounded-2xl border border-border px-4 py-3.5 flex items-center gap-3 transition hover:border-primary/40 group"
              >
                <span className="font-display font-bold text-sm text-primary/80 w-8 shrink-0 text-center">
                  {t.topic_no}
                </span>
                <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                <span className="flex-1 font-medium text-sm text-foreground group-hover:text-primary transition-colors">
                  {t.title}
                </span>
                {t.has_lab && (
                  <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground border border-border rounded-md px-1.5 py-0.5">
                    Lab
                  </span>
                )}
                <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
              </Link>
            </li>
          ))}
        </ol>
      </main>
      <Footer />
    </div>
  );
};

export default SubjectTopicsPage;
