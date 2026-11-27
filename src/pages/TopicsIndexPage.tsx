import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BookOpen, ChevronRight, Loader2 } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import Seo from "@/components/Seo";
import { fetchPublicSubjects, type PublicSubject } from "@/lib/public-topics";
import { SITE_URL } from "@/lib/seo";

/**
 * /topics — public index of every subject's topic pages
 * (Full SEO program, 26 Nov 2026). Crawlable without login.
 */
const TopicsIndexPage = () => {
  const [subjects, setSubjects] = useState<PublicSubject[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchPublicSubjects()
      .then((s) => { if (!cancelled) { setSubjects(s); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const totalTopics = subjects.reduce((n, s) => n + s.topicCount, 0);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "UniGenius AI — Study Topics by Subject",
    numberOfItems: subjects.length,
    itemListElement: subjects.map((s, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: `${s.name} — topics and notes`,
      url: `${SITE_URL}/topics/${s.slug}`,
    })),
  };

  return (
    <div className="min-h-screen flex flex-col gradient-hero">
      <Seo
        title="Study Topics & Notes for 54 Subjects — UniGenius AI"
        description="Browse 615 free topic pages and study notes for CS, SE & AI subjects: OOP, Data Structures, DLD, Databases, Operating Systems and more — with key points and code examples."
        path="/topics"
        jsonLd={jsonLd}
      />
      <Navbar />
      <main className="flex-1 container mx-auto px-4 md:px-6 lg:px-10 py-8 max-w-5xl w-full pb-28 md:pb-10">
        <nav className="text-xs text-muted-foreground flex items-center gap-1.5 mb-4" aria-label="Breadcrumb">
          <Link to="/" className="hover:text-foreground">Home</Link>
          <ChevronRight className="w-3 h-3" />
          <span className="text-foreground font-medium">Topics</span>
        </nav>

        <h1 className="font-display font-bold text-3xl md:text-4xl text-foreground">
          Study Topics &amp; Notes
        </h1>
        <p className="mt-3 text-muted-foreground max-w-2xl leading-relaxed">
          Every subject in the CS, SE and AI degree programs, broken into structured topic pages —
          a short summary, the key points, code examples and the mistakes to avoid.{" "}
          {subjects.length > 0 && (
            <>{subjects.length} subjects · {totalTopics} topic pages. </>
          )}
          Previews are free to read; the full interactive experience is free with an account.
        </p>

        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-7 h-7 animate-spin text-primary" />
          </div>
        ) : (
          <div className="mt-8 grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
            {subjects.map((s) => (
              <Link
                key={s.slug}
                to={`/topics/${s.slug}`}
                className="glass rounded-2xl border border-border p-4 transition hover:border-primary/40 group"
              >
                <div className="flex items-start justify-between gap-2">
                  <BookOpen className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                  <span className="text-[11px] font-semibold text-muted-foreground whitespace-nowrap">
                    {s.topicCount} topics
                  </span>
                </div>
                <h2 className="mt-2.5 font-display font-bold text-[15px] leading-snug text-foreground group-hover:text-primary transition-colors">
                  {s.name}
                </h2>
                {s.semesters.length > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Semester {s.semesters.join(", ")}
                  </p>
                )}
              </Link>
            ))}
          </div>
        )}

        <section className="mt-12 glass rounded-2xl border border-primary/25 p-6 text-center">
          <h2 className="font-display font-bold text-lg text-foreground">Want the full experience?</h2>
          <p className="mt-1.5 text-sm text-muted-foreground max-w-lg mx-auto">
            Read complete topic pages, ask the AI Tutor, practise 2,500+ questions and track your
            weak areas — free with a UniGenius account.
          </p>
          <Link
            to="/auth"
            className="mt-4 inline-block gradient-primary text-primary-foreground font-display font-bold text-sm rounded-xl px-6 py-2.5"
          >
            Create free account
          </Link>
        </section>
      </main>
      <Footer />
    </div>
  );
};

export default TopicsIndexPage;
