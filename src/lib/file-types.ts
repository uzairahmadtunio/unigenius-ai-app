import { FileText, Image as ImageIcon, FileSpreadsheet, Presentation, Music, Video } from "lucide-react";
import { ReactNode } from "react";
import { extractTextFromFile } from "./extract-text";

// ── Allowed MIME types for upload ──────────────────────────────
// Only formats the pipeline genuinely reads (audit F-03):
// - PDF + images + audio + video: read natively by the AI model.
// - DOCX / PPTX / TXT / MD / RTF: text is extracted in the browser
//   (see lib/extract-text.ts) and sent to the AI as text.
// ZIP/RAR and legacy .doc/.ppt were removed: nothing in the stack
// could read them, so accepting them misled students.
export const ALLOWED_MIME_TYPES = [
  // Documents
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  "text/plain", // .txt / .md
  "application/rtf", // .rtf
  "text/rtf",
  // Presentations
  "application/vnd.openxmlformats-officedocument.presentationml.presentation", // .pptx
  // Images
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  // Audio
  "audio/mpeg", // .mp3
  "audio/wav",
  "audio/x-m4a",
  "audio/mp4",
  // Video
  "video/mp4",
  "video/quicktime", // .mov
];

// File extensions for the accept attribute
export const ACCEPT_EXTENSIONS = ".pdf,.png,.jpg,.jpeg,.webp,.gif,.docx,.txt,.md,.rtf,.pptx,.mp3,.wav,.m4a,.mp4,.mov";

// ── File type detection ───────────────────────────────────────
export type FileCategory = "image" | "pdf" | "word" | "presentation" | "audio" | "video" | "text" | "document";

export function getFileCategory(typeOrName: string): FileCategory {
  const t = typeOrName.toLowerCase();
  if (t.startsWith("image/") || /\.(png|jpg|jpeg|webp|gif)$/i.test(t)) return "image";
  if (t === "application/pdf" || t.endsWith(".pdf")) return "pdf";
  if (t.includes("wordprocessingml") || /\.(docx?|doc)$/i.test(t)) return "word";
  if (t.includes("presentationml") || /\.(pptx?|ppt)$/i.test(t)) return "presentation";
  if (t.startsWith("audio/") || /\.(mp3|wav|m4a)$/i.test(t)) return "audio";
  if (t.startsWith("video/") || /\.(mp4|mov)$/i.test(t)) return "video";
  if (t === "text/plain" || t === "application/rtf" || t === "text/rtf" || /\.(txt|md|rtf)$/i.test(t)) return "text";
  return "document";
}

// ── Color-coded icon styles ───────────────────────────────────
export const FILE_CATEGORY_STYLES: Record<FileCategory, { color: string; bgColor: string; label: string }> = {
  image:        { color: "text-blue-500",    bgColor: "bg-blue-500/10",    label: "Image" },
  pdf:          { color: "text-red-500",     bgColor: "bg-red-500/10",     label: "PDF" },
  word:         { color: "text-blue-600",    bgColor: "bg-blue-600/10",    label: "Word" },
  presentation: { color: "text-orange-500",  bgColor: "bg-orange-500/10",  label: "PPT" },
  audio:        { color: "text-green-500",   bgColor: "bg-green-500/10",    label: "Audio" },
  video:        { color: "text-purple-500",  bgColor: "bg-purple-500/10",   label: "Video" },
  text:         { color: "text-muted-foreground", bgColor: "bg-muted",     label: "Text" },
  document:     { color: "text-primary",     bgColor: "bg-primary/10",     label: "File" },
};

// ── Check if a file is allowed ────────────────────────────────
export function isFileAllowed(file: File): boolean {
  // Check by MIME type
  if (ALLOWED_MIME_TYPES.some(t => file.type === t)) return true;
  // Fallback: check by extension
  const ext = file.name.split(".").pop()?.toLowerCase();
  const allowedExts = ["pdf","png","jpg","jpeg","webp","gif","docx","txt","md","rtf","pptx","mp3","wav","m4a","mp4","mov"];
  return ext ? allowedExts.includes(ext) : false;
}

// ── Get descriptive text for drop zone ────────────────────────
export const DROP_ZONE_TEXT = "PDF, Images, Word (DOCX), PowerPoint (PPTX), Text, Audio, Video";

// ── Build AI-friendly content parts for a file ────────────────
// Async since F-03: DOCX/PPTX/TXT/RTF are read in the browser and
// their extracted text is sent as a text part. If extraction fails
// or yields nothing, the student gets an honest note in the prompt
// instead of a silent unreadable blob.
// AI content-part shapes understood by the chat edge function
// (text / OpenAI-style image_url / inline file payload).
export type FileContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "file"; file: { name: string; mime_type: string; data: string } };

export async function buildFileContentParts(
  file: { name: string; type: string; dataUrl: string; file?: File },
  index: number,
  total: number,
  subjectContext?: string,
): Promise<FileContentPart[]> {
  const parts: FileContentPart[] = [];
  const cat = getFileCategory(file.type || file.name);
  const ctx = subjectContext ? ` for ${subjectContext}` : "";
  const label = `${index + 1}/${total}: ${file.name}`;

  const extractedPart = async (kindLabel: string): Promise<boolean> => {
    if (!file.file) return false;
    const extracted = await extractTextFromFile(file.file);
    if (!extracted || !extracted.text) return false;
    parts.push({
      type: "text",
      text: `[${kindLabel} ${label}] — The text below was extracted from this file${ctx}. Read and analyze it.\n\n----- BEGIN FILE TEXT -----\n${extracted.text}\n----- END FILE TEXT -----${extracted.truncated ? "\n(Note: the file was long, so only the first part of its text is included.)" : ""}`,
    });
    return true;
  };

  switch (cat) {
    case "image":
      parts.push({ type: "image_url", image_url: { url: file.dataUrl } });
      parts.push({ type: "text", text: `[Image ${label}] — Analyze this image${ctx}. Extract text/code via OCR if present.` });
      break;
    case "pdf":
      parts.push({ type: "file", file: { name: file.name, mime_type: file.type, data: file.dataUrl.split(",")[1] } });
      parts.push({ type: "text", text: `[PDF ${label}] — Read and analyze this PDF${ctx}.` });
      break;
    case "word":
      if (!(await extractedPart("Word Document"))) {
        parts.push({ type: "text", text: `[Word Document ${label}] — The student uploaded this Word file but its text could not be extracted. Tell the student honestly that this file could not be read and suggest re-saving it as PDF or DOCX.` });
      }
      break;
    case "presentation":
      if (!(await extractedPart("Presentation"))) {
        parts.push({ type: "text", text: `[Presentation ${label}] — The student uploaded this presentation but its slide text could not be extracted. Tell the student honestly that this file could not be read and suggest re-saving it as PPTX or PDF.` });
      }
      break;
    case "text":
      if (!(await extractedPart("Text File"))) {
        parts.push({ type: "text", text: `[Text File ${label}] — The student uploaded this text file but it could not be read. Tell the student honestly.` });
      }
      break;
    case "audio":
      parts.push({ type: "file", file: { name: file.name, mime_type: file.type, data: file.dataUrl.split(",")[1] } });
      parts.push({ type: "text", text: `[Audio ${label}] — This is a recorded lecture/audio. Transcribe it and provide key points${ctx}.` });
      break;
    case "video":
      parts.push({ type: "file", file: { name: file.name, mime_type: file.type, data: file.dataUrl.split(",")[1] } });
      parts.push({ type: "text", text: `[Video ${label}] — This is a video recording. Analyze its content (visuals and audio track)${ctx}.` });
      break;
    default:
      parts.push({ type: "file", file: { name: file.name, mime_type: file.type, data: file.dataUrl.split(",")[1] } });
      parts.push({ type: "text", text: `[Document ${label}] — Analyze this document${ctx}.` });
  }

  return parts;
}
