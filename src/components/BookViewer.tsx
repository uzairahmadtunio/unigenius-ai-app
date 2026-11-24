import { Download, ExternalLink, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { bookDownloadUrl, type LibraryBook } from "@/lib/notes-reader";

/**
 * In-app reader for a mirrored library book. The hosted file (Google
 * Drive, anyone-reader — the premium-courses pattern) is embedded in
 * its preview viewer so the student reads without leaving UniGenius;
 * a download button and the official source link sit alongside.
 */
const BookViewer = ({ book, onClose }: { book: LibraryBook; onClose: () => void }) => {
  const downloadUrl = bookDownloadUrl(book);
  return (
    <div className="fixed inset-0 z-50 bg-background/90 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6">
      <div className="glass rounded-2xl border border-border w-full max-w-4xl h-full max-h-[92vh] flex flex-col overflow-hidden">
        <div className="flex items-start gap-3 px-4 py-3 border-b border-border">
          <div className="flex-1 min-w-0">
            <h3 className="font-display font-bold text-sm sm:text-base text-foreground leading-snug">
              {book.title}
            </h3>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1 text-xs text-muted-foreground">
              {book.author && <span>{book.author}</span>}
              {book.page_count ? <span>· {book.page_count} pages</span> : null}
              {book.size_mb ? <span>· {book.size_mb} MB</span> : null}
              {book.license && (
                <Badge variant="secondary" className="text-[10px] rounded-lg">{book.license}</Badge>
              )}
            </div>
          </div>
          <Button variant="ghost" size="icon" className="rounded-xl shrink-0" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="flex-1 bg-black/40">
          {book.hosted_url ? (
            <iframe
              src={book.hosted_url}
              title={book.title}
              className="w-full h-full"
              allow="autoplay; encrypted-media"
              allowFullScreen
            />
          ) : (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground px-6 text-center">
              This book is not hosted in-app yet — use the official source link below.
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2 px-4 py-3 border-t border-border">
          {downloadUrl && (
            <a href={downloadUrl} target="_blank" rel="noreferrer">
              <Button size="sm" className="rounded-xl text-xs gap-1.5 gradient-primary text-primary-foreground">
                <Download className="w-3.5 h-3.5" /> Download PDF
              </Button>
            </a>
          )}
          {book.official_url && (
            <a href={book.official_url} target="_blank" rel="noreferrer">
              <Button size="sm" variant="outline" className="rounded-xl text-xs gap-1.5">
                <ExternalLink className="w-3.5 h-3.5" /> Official source{book.source ? ` — ${book.source}` : ""}
              </Button>
            </a>
          )}
          {book.license && (
            <span className="ml-auto text-[11px] text-muted-foreground self-center">
              Freely shared by its authors under {book.license}.
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

export default BookViewer;
