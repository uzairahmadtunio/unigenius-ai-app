import { supabase } from "@/integrations/supabase/client";

// ─── Notes Reader data layer (Masterplan Part 2a/2b) ─────────────────
// subject_topics = syllabus skeleton, topic_pages = on-platform study
// pages, library_books = openly-licensed books mirrored for in-app
// reading. Subject names in these tables are the canonical pool names;
// hub names can differ slightly ("Object-Oriented Programming" vs pool
// "Object Oriented Programming"), so matching is normalisation-based —
// the same approach the hub already uses for subject_lectures.

export interface SubjectTopic {
  id: string;
  subject: string;
  semester: number | null;
  topic_no: number;
  title: string;
  slug: string;
  has_lab: boolean;
}

export interface CodeExample {
  language: string;
  title?: string;
  code: string;
  explanation?: string;
  stdin?: string;
}

export interface TopicPageData {
  id: string;
  topic_id: string;
  subject: string;
  title: string;
  body_md: string;
  code_examples: CodeExample[];
  key_points: string[];
  common_mistakes: string[];
  diagram_md: string | null;
  status: string;
}

export interface LibraryBook {
  id: string;
  subject: string;
  semester: number | null;
  title: string;
  author: string | null;
  source: string | null;
  license: string | null;
  hosted_url: string | null;
  official_url: string | null;
  size_mb: number | null;
  page_count: number | null;
}

export interface SubjectReference {
  kind: "note" | "paper";
  title: string;
  url: string;
  meta: string;
}

/** "Object-Oriented Programming (OOP)" -> "object oriented programming" */
export const normSubject = (x: string) =>
  x
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/^introduction to /, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const sameSubject = (a: string, b: string) => {
  const na = normSubject(a);
  const nb = normSubject(b);
  return na === nb || na.includes(nb) || nb.includes(na);
};

export async function fetchSubjectTopics(subjectName: string): Promise<SubjectTopic[]> {
  const { data } = await supabase
    .from("subject_topics" as any)
    .select("id, subject, semester, topic_no, title, slug, has_lab")
    .order("topic_no", { ascending: true });
  if (!data) return [];
  return (data as unknown as SubjectTopic[]).filter((t) => sameSubject(t.subject, subjectName));
}

/** topic_id -> status for every topic page of this subject (published or not). */
export async function fetchTopicPageStatuses(subjectName: string): Promise<Map<string, string>> {
  const { data } = await supabase
    .from("topic_pages" as any)
    .select("topic_id, subject, status");
  const map = new Map<string, string>();
  if (!data) return map;
  (data as unknown as { topic_id: string; subject: string; status: string }[])
    .filter((p) => sameSubject(p.subject, subjectName))
    .forEach((p) => map.set(p.topic_id, p.status));
  return map;
}

export async function fetchTopicPage(topicId: string): Promise<TopicPageData | null> {
  const { data } = await supabase
    .from("topic_pages" as any)
    .select("id, topic_id, subject, title, body_md, code_examples, key_points, common_mistakes, diagram_md, status")
    .eq("topic_id", topicId)
    .eq("status", "published")
    .maybeSingle();
  if (!data) return null;
  const page = data as unknown as TopicPageData;
  return {
    ...page,
    code_examples: Array.isArray(page.code_examples) ? page.code_examples : [],
    key_points: page.key_points ?? [],
    common_mistakes: page.common_mistakes ?? [],
  };
}

export async function fetchSubjectBooks(subjectName: string): Promise<LibraryBook[]> {
  const { data } = await supabase
    .from("library_books" as any)
    .select("id, subject, semester, title, author, source, license, hosted_url, official_url, size_mb, page_count")
    .order("title", { ascending: true });
  if (!data) return [];
  return (data as unknown as LibraryBook[]).filter((b) => sameSubject(b.subject, subjectName));
}

/** External notes + past papers for this subject (demoted reference strip). */
export async function fetchSubjectReferences(subjectName: string): Promise<SubjectReference[]> {
  const refs: SubjectReference[] = [];
  const [notesRes, papersRes] = await Promise.all([
    supabase.from("notes" as any).select("title, subject, file_url, uploader_name").order("upvotes", { ascending: false }),
    supabase.from("past_papers" as any).select("title, subject, file_url, paper_type, year").order("created_at", { ascending: false }),
  ]);
  if (notesRes.data) {
    (notesRes.data as any[])
      .filter((n) => n.file_url && sameSubject(n.subject || "", subjectName))
      .forEach((n) => refs.push({ kind: "note", title: n.title, url: n.file_url, meta: n.uploader_name || "Community note" }));
  }
  if (papersRes.data) {
    (papersRes.data as any[])
      .filter((p) => p.file_url && sameSubject(p.subject || "", subjectName))
      .forEach((p) =>
        refs.push({
          kind: "paper",
          title: p.title,
          url: p.file_url,
          meta: [p.paper_type, p.year].filter(Boolean).join(" · ") || "Past paper",
        }),
      );
  }
  return refs;
}

/** Drive preview URL -> direct download URL (other hosts pass through). */
export function bookDownloadUrl(book: LibraryBook): string | null {
  if (!book.hosted_url) return book.official_url;
  const m = book.hosted_url.match(/drive\.google\.com\/file\/d\/([^/]+)/);
  if (m) return `https://drive.google.com/uc?export=download&id=${m[1]}`;
  return book.hosted_url;
}
