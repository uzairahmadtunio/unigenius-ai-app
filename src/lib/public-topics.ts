import { supabase } from "@/integrations/supabase/client";
import { slugify } from "@/lib/seo";
import {
  fetchTopicPage,
  type SubjectTopic,
  type TopicPageData,
} from "@/lib/notes-reader";

/**
 * Public topic previews (Full SEO program, 26 Nov 2026).
 *
 * The 615 topic pages used to sit entirely behind login, invisible to
 * search engines. subject_topics + published topic_pages are already
 * public-read under RLS, so these helpers power the crawlable preview
 * routes (/topics, /topics/:subjectSlug, /topics/:subjectSlug/:topicSlug)
 * without touching the signed-in reading experience.
 */

export interface PublicSubject {
  name: string;
  slug: string;
  topicCount: number;
  semesters: number[];
}

interface SubjectTopicRow {
  subject: string;
  semester: number | null;
}

let subjectsCache: PublicSubject[] | null = null;

export async function fetchPublicSubjects(): Promise<PublicSubject[]> {
  if (subjectsCache) return subjectsCache;
  const { data } = await supabase
    // subject_topics is missing from the generated types (drift, F-07).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from("subject_topics" as any)
    .select("subject, semester");
  if (!data) return [];
  const bySubject = new Map<string, { count: number; semesters: Set<number> }>();
  (data as unknown as SubjectTopicRow[]).forEach((r) => {
    const entry = bySubject.get(r.subject) ?? { count: 0, semesters: new Set<number>() };
    entry.count += 1;
    if (r.semester != null) entry.semesters.add(r.semester);
    bySubject.set(r.subject, entry);
  });
  subjectsCache = [...bySubject.entries()]
    .map(([name, v]) => ({
      name,
      slug: slugify(name),
      topicCount: v.count,
      semesters: [...v.semesters].sort((a, b) => a - b),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return subjectsCache;
}

export async function resolvePublicSubject(subjectSlug: string): Promise<PublicSubject | null> {
  const subjects = await fetchPublicSubjects();
  return subjects.find((s) => s.slug === subjectSlug) ?? null;
}

/**
 * Topics of one subject, queried directly by the exact DB subject name
 * (the public pages resolve the name from the DB itself, so no
 * normalisation fetch-all is needed — keeps the preview pages fast).
 */
export async function fetchPublicTopics(subjectName: string): Promise<SubjectTopic[]> {
  const { data } = await supabase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from("subject_topics" as any)
    .select("id, subject, semester, topic_no, title, slug, has_lab")
    .eq("subject", subjectName)
    .order("topic_no", { ascending: true });
  if (!data) return [];
  return data as unknown as SubjectTopic[];
}

export async function fetchPublicTopicPreview(
  subjectName: string,
  topicSlug: string,
): Promise<{ topic: SubjectTopic; page: TopicPageData } | null> {
  // Direct (subject, slug) lookup — one round-trip instead of listing
  // the subject's topics first; keeps the preview page's LCP down.
  const { data } = await supabase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from("subject_topics" as any)
    .select("id, subject, semester, topic_no, title, slug, has_lab")
    .eq("subject", subjectName)
    .eq("slug", topicSlug)
    .maybeSingle();
  if (!data) return null;
  const topic = data as unknown as SubjectTopic;
  const page = await fetchTopicPage(topic.id);
  if (!page) return null;
  return { topic, page };
}
