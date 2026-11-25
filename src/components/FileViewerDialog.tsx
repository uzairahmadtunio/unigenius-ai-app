import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, Loader2, Globe } from "lucide-react";
import { fileKind, previewUrl, downloadFile, downloadName } from "@/lib/file-delivery";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  url: string | null;
  fileName?: string | null;
}

/**
 * In-app file viewer (Bug #6, the MeriKitab pattern): the file is read
 * inside a dialog — Drive files through Drive's embed endpoint, direct
 * files embedded as-is — and downloads happen in-window. The user never
 * lands on Google Drive's UI.
 */
const FileViewerDialog = ({ open, onOpenChange, title, url, fileName }: Props) => {
  const [loaded, setLoaded] = useState(false);
  const [downloading, setDownloading] = useState(false);
  if (!url) return null;
  const kind = fileKind(url, fileName);
  const downloadable = kind !== "web";

  const handleDownload = async () => {
    setDownloading(true);
    try {
      await downloadFile(url, downloadName(title, fileName, url));
      toast.success("Download started");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) setLoaded(false); onOpenChange(o); }}>
      <DialogContent className="max-w-3xl w-[94vw] h-[86vh] flex flex-col p-0 gap-0 overflow-hidden rounded-2xl">
        <DialogHeader className="px-4 sm:px-5 py-3.5 border-b border-border/60 shrink-0">
          <DialogTitle className="text-sm sm:text-base font-semibold text-foreground line-clamp-2 pr-6 text-left">
            {title}
          </DialogTitle>
        </DialogHeader>

        <div className="relative flex-1 bg-black/40 min-h-0">
          {!loaded && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
              <p className="text-xs">Loading preview…</p>
            </div>
          )}
          {kind === "image" ? (
            <img
              src={url}
              alt={title}
              className="w-full h-full object-contain"
              onLoad={() => setLoaded(true)}
            />
          ) : (
            <iframe
              src={previewUrl(url)}
              title={title}
              className="w-full h-full border-0"
              allow="autoplay; encrypted-media"
              onLoad={() => setLoaded(true)}
            />
          )}
        </div>

        <div className="px-4 sm:px-5 py-3 border-t border-border/60 flex items-center gap-3 shrink-0">
          {downloadable ? (
            <>
              <Button onClick={handleDownload} disabled={downloading} className="rounded-xl gradient-primary text-primary-foreground gap-2">
                {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                Download
              </Button>
              <p className="text-[11px] text-muted-foreground leading-snug">
                Downloads directly — no Drive trip. If the preview stays blank, the source is still loading or blocks embedding; the download still works.
              </p>
            </>
          ) : (
            <p className="text-[11px] text-muted-foreground leading-snug flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5 shrink-0" />
              Web resource — it reads right here in the app. Some sources block in-app previews; if this stays blank, the source site does not allow embedding.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default FileViewerDialog;
