// ─── Client-side text extraction (audit F-03) ─────────────────────
// The upload pipeline used to ship every file to the model as a raw
// base64 blob — including formats the model cannot read at all
// (DOCX/PPTX/ZIP/RAR), which made "upload anything" a false promise.
// Now Office/text formats are genuinely READ in the browser and their
// text is sent to the AI as text. PDF/images/audio/video still go to
// the model natively (Gemini reads those directly, verified live).

export interface ExtractedText {
  text: string;
  truncated: boolean;
}

const MAX_CHARS = 60_000;

function cap(text: string): ExtractedText {
  const clean = text.replace(/\n{3,}/g, "\n\n").trim();
  if (clean.length <= MAX_CHARS) return { text: clean, truncated: false };
  return { text: clean.slice(0, MAX_CHARS), truncated: true };
}

/** Strip RTF control words/groups down to readable plain text. */
function rtfToText(rtf: string): string {
  return rtf
    .replace(/\\par[d]?\b ?/g, "\n")
    .replace(/\\tab\b ?/g, "\t")
    .replace(/\\'[0-9a-fA-F]{2}/g, " ")
    .replace(/\\[a-zA-Z]+-?\d* ?/g, "")
    .replace(/[{}]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function extractDocx(file: File): Promise<ExtractedText> {
  const mammoth = await import("mammoth");
  const buffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer: buffer });
  return cap(result.value || "");
}

async function extractPptx(file: File): Promise<ExtractedText> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const slideNames = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => {
      const na = parseInt(a.match(/slide(\d+)\.xml$/)![1], 10);
      const nb = parseInt(b.match(/slide(\d+)\.xml$/)![1], 10);
      return na - nb;
    });
  const chunks: string[] = [];
  for (let i = 0; i < slideNames.length; i++) {
    const xml = await zip.files[slideNames[i]].async("string");
    const texts = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) =>
      m[1]
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'"),
    );
    chunks.push(`--- Slide ${i + 1} ---\n${texts.join("\n")}`);
  }
  return cap(chunks.join("\n\n"));
}

/**
 * Extract readable text from a document file. Returns null when the
 * format has no client-side extraction path (caller then falls back
 * to native model ingestion for PDF/media, or rejects the file).
 */
export async function extractTextFromFile(file: File): Promise<ExtractedText | null> {
  const name = file.name.toLowerCase();
  try {
    if (name.endsWith(".docx")) return await extractDocx(file);
    if (name.endsWith(".pptx")) return await extractPptx(file);
    if (name.endsWith(".txt") || name.endsWith(".md")) return cap(await file.text());
    if (name.endsWith(".rtf")) return cap(rtfToText(await file.text()));
    return null;
  } catch {
    return null;
  }
}
