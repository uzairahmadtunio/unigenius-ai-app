import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  BookOpen, ChevronDown, ChevronRight, ChevronUp, Download, ExternalLink,
  FileText, FlaskConical, LibraryBig, ListOrdered, Loader2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import BookViewer from "@/components/BookViewer";
import { downloadFile } from "@/lib/file-delivery";
import { toast } from "sonner";
import {
  bookDownloadUrl,
  fetchSubjectBooks,
  fetchSubjectReferences,
  fetchSubjectTopics,
  fetchTopicPageStatuses,
  type LibraryBook,
  type SubjectReference,
  type SubjectTopic,
} from "@/lib/notes-reader";

/**
 * The Notes Reader home inside a Subject Hub: syllabus topic list
 * (subject_topics), the subject's mirrored books (library_books, read
 * in-app via BookViewer), and — collapsed at the bottom — the external
 * notes/past-paper links demoted to an "Official references" strip.
 */
const SubjectStudySection = ({ subjectName, subjectId }: { subjectName: string; subjectId: string }) => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [topics, setTopics] = useState<SubjectTopic[]>([]);
  const [statuses, setStatuses] = useState<Map<string, string>>(new Map());
  const [books, setBooks] = useState<LibraryBook[]>([]);
  const [refs, setRefs] = useState<SubjectReference[]>([]);
  const [loading, setLoading] = useState(true);
  const [refsOpen, setRefsOpen] = useState(false);
  const [openBook, setOpenBook] = useState<LibraryBook | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [t, s, b, r] = await Promise.all([
        fetchSubjectTopics(subjectName),
        fetchTopicPageStatuses(subjectName),
        fetchSubjectBooks(subjectName),
        fetchSubjectReferences(subjectName),
      ]);
      if (cancelled) return;
      setTopics(t);
      setStatuses(s);
      setBooks(b);
      setRefs(r);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [subjectName]);

  const openTopic = (topic: SubjectTopic) => {
    const qs = searchParams.toString();
    navigate(`/subject/${subjectId}/topic/${topic.slug}${qs ? `?${qs}` : ""}`);
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const publishedCount = topics.filter((t) => statuses.get(t.id) === "published").length;

  return (
    <div className="flex-1 overflow-y-auto space-y-5 pb-4">
      {/* ── Topics ─────────────────────────────────────────────── */}
      <section>
        <div className="flex items-center gap-2 mb-1">
          <ListOrdered className="w-4 h-4 text-primary" />
          <h2 className="font-display font-bold text-base text-foreground">Study Topics</h2>
          {topics.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {publishedCount} of {topics.length} ready
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Every topic has its own study page — theory, code examples, key points and practice questions, all inside the app.
        </p>
        {topics.length === 0 ? (
          <div className="glass rounded-2xl border border-border p-5 text-center">
            <p className="text-2xl mb-2">🛠️</p>
            <p className="text-sm font-medium text-foreground">Topic pages are being prepared</p>
            <p className="text-xs text-muted-foreground mt-1">
              Study pages for this subject are being prepared. Until then, study from the lectures (above) and the AI Tutor.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {topics.map((topic) => {
              const ready = statuses.get(topic.id) === "published";
              return (
                <button
                  key={topic.id}
                  disabled={!ready}
                  onClick={() => ready && openTopic(topic)}
                  className={`w-full flex items-center gap-3 glass rounded-2xl border border-border px-4 py-3 text-left transition-colors ${
                    ready ? "hover:border-primary/50 cursor-pointer" : "opacity-60 cursor-default"
                  }`}
                >
                  <span className="w-8 h-8 rounded-xl gradient-primary text-primary-foreground flex items-center justify-center text-xs font-bold shrink-0">
                    {topic.topic_no}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium text-foreground leading-snug">{topic.title}</span>
                    <span className="block text-[11px] text-muted-foreground mt-0.5">
                      {ready ? "Study page ready — tap to open" : "Coming soon"}
                    </span>
                  </span>
                  {topic.has_lab && (
                    <Badge variant="secondary" className="text-[10px] rounded-lg gap-1 shrink-0">
                      <FlaskConical className="w-3 h-3" /> Lab
                    </Badge>
                  )}
                  {ready && <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Books ──────────────────────────────────────────────── */}
      {books.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <LibraryBig className="w-4 h-4 text-primary" />
            <h2 className="font-display font-bold text-base text-foreground">Books — read them here</h2>
          </div>
          <div className="space-y-2">
            {books.map((book) => (
              <div key={book.id} className="glass rounded-2xl border border-border px-4 py-3 flex items-center gap-3">
                <span className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  <BookOpen className="w-5 h-5 text-primary" />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground leading-snug">{book.title}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {[book.author, book.page_count ? `${book.page_count} pages` : null, book.license]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <Button
                  size="sm"
                  className="rounded-xl text-xs gradient-primary text-primary-foreground shrink-0"
                  onClick={() => setOpenBook(book)}
                >
                  Read
                </Button>
                {bookDownloadUrl(book) && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-xl text-xs gap-1 shrink-0"
                    aria-label={`Download ${book.title}`}
                    onClick={async () => { await downloadFile(bookDownloadUrl(book)!, `${book.title}.pdf`); toast.success("Download started"); }}
                  >
                    <Download className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Official references (demoted external links) ───────── */}
      {refs.length > 0 && (
        <section className="glass rounded-2xl border border-border overflow-hidden">
          <button
            onClick={() => setRefsOpen((o) => !o)}
            className="w-full flex items-center gap-2 px-4 py-3 text-sm font-semibold text-foreground"
          >
            <FileText className="w-4 h-4 text-muted-foreground" />
            Official references
            <span className="text-xs font-medium text-muted-foreground">
              {refs.length} external links
            </span>
            <span className="ml-auto text-muted-foreground">
              {refsOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </span>
          </button>
          {refsOpen && (
            <div className="px-4 pb-3 space-y-1.5">
              <p className="text-[11px] text-muted-foreground pb-1">
                These links open external websites — for reference only. Your main study material is in the topic pages and books above.
              </p>
              {refs.map((ref, i) => (
                <a
                  key={i}
                  href={ref.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs hover:bg-muted/60 transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <span className="flex-1 min-w-0">
                    <span className="block font-medium text-foreground truncate">{ref.title}</span>
                    <span className="block text-[10px] text-muted-foreground">
                      {ref.kind === "paper" ? "Past paper" : "Note"} · {ref.meta}
                    </span>
                  </span>
                </a>
              ))}
            </div>
          )}
        </section>
      )}

      {openBook && <BookViewer book={openBook} onClose={() => setOpenBook(null)} />}
    </div>
  );
};

export default SubjectStudySection;
