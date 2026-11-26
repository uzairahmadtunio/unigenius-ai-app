import { useEffect, useMemo, useState } from "react";
import { BookOpen, Download, LibraryBig, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import PageShell from "@/components/PageShell";
import BookViewer from "@/components/BookViewer";
import { fetchAllBooks, bookDownloadUrl, type LibraryBook } from "@/lib/notes-reader";
import { downloadFile } from "@/lib/file-delivery";
import { toast } from "sonner";

/**
 * Library (D-4 fix): the 23 openly-licensed books used to live only
 * inside each subject hub, with no index anywhere — students could not
 * discover them. This page lists every book in one place (search +
 * subject filter) and opens each in the same in-app BookViewer the
 * subject hubs use. The per-subject hub sections are unchanged.
 */
const LibraryPage = () => {
  const [books, setBooks] = useState<LibraryBook[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [subjectFilter, setSubjectFilter] = useState<string>("all");
  const [openBook, setOpenBook] = useState<LibraryBook | null>(null);

  useEffect(() => {
    let live = true;
    fetchAllBooks()
      .then((rows) => {
        if (live) setBooks(rows);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, []);

  const subjects = useMemo(
    () => [...new Set(books.map((b) => b.subject).filter(Boolean))].sort(),
    [books],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return books.filter((b) => {
      if (subjectFilter !== "all" && b.subject !== subjectFilter) return false;
      if (q && !`${b.title} ${b.author || ""} ${b.subject}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [books, search, subjectFilter]);

  return (
    <PageShell
      title="Library"
      subtitle="Free, openly-licensed books — read them right here"
      icon={
        <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
          <LibraryBig className="w-5 h-5 text-primary" />
        </div>
      }
    >
      <div className="space-y-4 pb-24">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search books, authors, subjects..."
            className="pl-9 rounded-xl"
          />
        </div>

        {subjects.length > 1 && (
          <div className="flex gap-1.5 flex-wrap" role="group" aria-label="Filter by subject">
            <Button
              size="sm"
              variant={subjectFilter === "all" ? "default" : "outline"}
              aria-pressed={subjectFilter === "all"}
              className="rounded-lg text-xs"
              onClick={() => setSubjectFilter("all")}
            >
              All Subjects
            </Button>
            {subjects.map((s) => (
              <Button
                key={s}
                size="sm"
                variant={subjectFilter === s ? "default" : "outline"}
                aria-pressed={subjectFilter === s}
                className="rounded-lg text-xs"
                onClick={() => setSubjectFilter(s)}
              >
                {s}
              </Button>
            ))}
          </div>
        )}

        {loading ? (
          <div className="glass rounded-2xl p-8 text-center">
            <Loader2 className="w-6 h-6 animate-spin text-primary mx-auto" />
            <p className="text-sm text-muted-foreground mt-2">Loading the library…</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="glass rounded-2xl p-8 text-center space-y-2">
            <LibraryBig className="w-10 h-10 text-muted-foreground/30 mx-auto" />
            <p className="text-sm text-muted-foreground">No books match your search.</p>
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {filtered.length} book{filtered.length === 1 ? "" : "s"}
            </p>
            <div className="space-y-2">
              {filtered.map((book) => (
                <div
                  key={book.id}
                  className="glass rounded-2xl border border-border px-4 py-3 flex items-center gap-3"
                >
                  <span className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                    <BookOpen className="w-5 h-5 text-primary" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground leading-snug">{book.title}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {[book.subject, book.author, book.page_count ? `${book.page_count} pages` : null, book.license]
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
                      onClick={async () => {
                        await downloadFile(bookDownloadUrl(book)!, `${book.title}.pdf`);
                        toast.success("Download started");
                      }}
                    >
                      <Download className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {openBook && <BookViewer book={openBook} onClose={() => setOpenBook(null)} />}
    </PageShell>
  );
};

export default LibraryPage;
