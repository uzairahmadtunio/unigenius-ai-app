/**
 * In-app file delivery for Notes / Past Papers (Bug #6 fix, 2026-11-25).
 *
 * Uzair's standing rule (the MeriKitab pattern): everything opens, reads
 * and downloads INSIDE the app — the user must never be bounced out to
 * Google Drive's UI. Files stay hosted where they are (his Drive, the
 * source sites, Supabase storage); only the delivery changes:
 *  - Drive files preview through Drive's embed endpoint and download
 *    through its direct-download endpoint (neither shows Drive's UI).
 *  - Direct files (PDFs, storage objects) embed and download directly.
 *  - Plain web pages are labelled web resources and embedded as-is;
 *    some sources refuse framing, in which case the viewer says so.
 */

export type FileKind = "drive" | "pdf" | "image" | "web";

/** Extract the file id from any Google Drive URL shape, or null. */
export function driveFileId(url: string): string | null {
  if (!url) return null;
  const m =
    url.match(/drive\.google\.com\/file\/d\/([^/?#]+)/) ||
    url.match(/drive\.google\.com\/(?:open|uc)\?[^#]*\bid=([^&#]+)/) ||
    url.match(/[?&]id=([^&#]+)/);
  if (m && /drive\.google\.com/.test(url)) return m[1];
  return null;
}

export function fileKind(url: string, fileName?: string | null): FileKind {
  if (driveFileId(url)) return "drive";
  const name = (fileName || "").toLowerCase();
  if (/\.(png|jpe?g|gif|webp)$/.test(name) || /\.(png|jpe?g|gif|webp)(\?|$)/i.test(url)) return "image";
  if (/\.pdf(\?|$)/i.test(url) || name.endsWith(".pdf")) return "pdf";
  return "web";
}

/** URL to embed in the in-app viewer iframe. */
export function previewUrl(url: string): string {
  const id = driveFileId(url);
  if (id) return `https://drive.google.com/file/d/${id}/preview`;
  return url;
}

/** URL that makes the browser download the file (never a Drive UI page). */
export function directDownloadUrl(url: string, fileName?: string | null): string {
  const id = driveFileId(url);
  if (id) return `https://drive.google.com/uc?export=download&id=${id}`;
  // Supabase storage public URLs honour ?download=<name> with a
  // Content-Disposition: attachment header.
  if (/\/storage\/v1\/object\/public\//.test(url)) {
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}download=${encodeURIComponent(fileName || "download")}`;
  }
  return url;
}

/** A sensible download filename for a note/paper. */
export function downloadName(title: string, fileName?: string | null, url?: string): string {
  if (fileName && /\.[a-z0-9]{2,5}$/i.test(fileName)) return fileName;
  const base = (title || "file").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "file";
  const kind = url ? fileKind(url, fileName) : "web";
  return kind === "pdf" || kind === "drive" ? `${base}.pdf` : base;
}

/**
 * Download a file without leaving the app: fetch it as a blob and save
 * via an object URL where CORS allows; otherwise fall back to a
 * programmatic click on the direct-download URL (the browser downloads
 * in place — no navigation to any Drive page either way).
 */
export async function downloadFile(url: string, fileName: string): Promise<void> {
  const target = directDownloadUrl(url, fileName);
  try {
    const resp = await fetch(target);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const blob = await resp.blob();
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objUrl), 4000);
  } catch {
    const a = document.createElement("a");
    a.href = target;
    a.download = fileName;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
}

/**
 * The creator/source embedded in a note's data, when one exists: the
 * title's trailing "— …" segment (e.g. "— Full NPTEL Course (CMI)",
 * "— Free Textbook (Allen B. Downey)") is where the seed data records
 * provenance. Returns null when the title carries no source segment.
 */
export function sourceFromTitle(title: string): string | null {
  if (!title) return null;
  const m = title.match(/—\s*(.+)$/);
  if (!m) return null;
  const seg = m[1].replace(/\s*\(official source:.*$/i, "").trim();
  return seg.length >= 3 ? seg : null;
}
