/**
 * Classes data layer (Panels Program, Parts C0/C1–C7 + F Phases 1–3).
 *
 * Google-Classroom model: a class is one subject taught to one group;
 * students join with a code; everything inside the class (posts,
 * comments, submissions, test attempts) is visible only to members.
 * The database enforces that with RLS — this module is just the typed
 * access layer the pages share.
 */
import { supabase } from "@/integrations/supabase/client";

export type ClassPostType = "announcement" | "material" | "homework" | "test";
export type MemberStatus = "active" | "pending";

export interface ClassRow {
  id: string;
  teacher_id: string;
  title: string;
  subject: string | null;
  program: string | null;
  semester: number | null;
  section: string | null;
  code: string;
  join_requires_approval: boolean;
  archived: boolean;
  cover: number;
  created_at: string;
  updated_at: string;
}

export interface ClassMemberRow {
  id: string;
  class_id: string;
  user_id: string;
  role: "teacher" | "student";
  status: MemberStatus;
  joined_at: string;
}

export interface ClassPostRow {
  id: string;
  class_id: string;
  author_id: string;
  type: ClassPostType;
  title: string | null;
  body: string | null;
  attachment_url: string | null;
  attachment_name: string | null;
  due_at: string | null;
  max_marks: number | null;
  meta: Record<string, unknown>;
  created_at: string;
}

export interface ClassCommentRow {
  id: string;
  post_id: string;
  class_id: string;
  author_id: string;
  body: string;
  created_at: string;
}

export interface SubmissionRow {
  id: string;
  post_id: string;
  class_id: string;
  student_id: string;
  text_answer: string | null;
  file_url: string | null;
  file_name: string | null;
  status: "turned_in" | "returned";
  marks: number | null;
  feedback: string | null;
  submitted_at: string;
  returned_at: string | null;
}

export interface PrivateCommentRow {
  id: string;
  post_id: string;
  class_id: string;
  student_id: string;
  author_id: string;
  body: string;
  created_at: string;
}

export interface TestAttemptRow {
  id: string;
  post_id: string;
  class_id: string;
  student_id: string;
  score: number | null;
  total: number | null;
  status: "started" | "submitted";
  started_at: string;
  submitted_at: string | null;
}

const db = () => supabase as any;

/* ---------------- pure helpers (unit-tested) ---------------- */

/** Cover band gradient per class cover variant (locked violet family). */
export const CLASS_COVERS = [
  "linear-gradient(95deg,#8B5CF6,#6D5CFF)",
  "linear-gradient(95deg,#6D5CFF,#4E7BFF)",
  "linear-gradient(95deg,#7C5CFF,#B45CF6)",
  "linear-gradient(95deg,#5C7CFF,#8B5CF6)",
] as const;

export function classCoverStyle(cover: number | null | undefined): string {
  const i = Math.abs(Number(cover) || 0) % CLASS_COVERS.length;
  return CLASS_COVERS[i];
}

/** A short decorative glyph for a class, from its subject/title. */
export function classGlyph(cls: Pick<ClassRow, "subject" | "title">): string {
  const s = `${cls.subject || ""} ${cls.title || ""}`.toLowerCase();
  if (s.includes("discrete") || s.includes("math")) return "∑";
  if (s.includes("logic") || s.includes("digital")) return "⚡";
  if (s.includes("program") || s.includes("oop") || s.includes("object")) return "{ }";
  if (s.includes("ict") || s.includes("computer")) return "💻";
  if (s.includes("physics")) return "🧲";
  if (s.includes("chem")) return "🧪";
  if (s.includes("bio")) return "🧬";
  if (s.includes("english") || s.includes("writing")) return "✍️";
  return "📘";
}

/** Percentage helper that never divides by zero. */
export function pct(score: number | null, total: number | null): number {
  if (!score || !total || total <= 0) return 0;
  return Math.round((score / total) * 100);
}

export interface DueItem {
  post: ClassPostRow;
  classTitle: string;
  done: boolean;
}

/**
 * "Due This Week": homework/test posts in the student's classes whose
 * deadline is within the window (default: from 24h ago to 7 days ahead),
 * unfinished first, then by deadline. Pure — takes plain data.
 */
export function dueThisWeek(
  posts: ClassPostRow[],
  classTitles: Map<string, string>,
  donePostIds: Set<string>,
  now: Date = new Date(),
  windowDays = 7,
): DueItem[] {
  const from = now.getTime() - 24 * 3600 * 1000;
  const to = now.getTime() + windowDays * 24 * 3600 * 1000;
  return posts
    .filter((p) => (p.type === "homework" || p.type === "test") && p.due_at)
    .filter((p) => {
      const t = new Date(p.due_at as string).getTime();
      return t >= from && t <= to;
    })
    .map((p) => ({ post: p, classTitle: classTitles.get(p.class_id) || "Class", done: donePostIds.has(p.id) }))
    .sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      return new Date(a.post.due_at as string).getTime() - new Date(b.post.due_at as string).getTime();
    });
}

/** Human deadline label for due chips ("Due Fri", "Overdue", "Due today"). */
export function dueLabel(dueAt: string, now: Date = new Date()): string {
  const due = new Date(dueAt);
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(due) - startOfDay(now)) / 86400000);
  if (days < 0) return "Overdue";
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  return `Due ${due.toLocaleDateString(undefined, { weekday: "short" })}`;
}

/* ---------------- queries ---------------- */

export async function fetchMyTeachingClasses(userId: string): Promise<ClassRow[]> {
  const { data } = await db().from("classes").select("*").eq("teacher_id", userId).order("created_at", { ascending: false });
  return (data || []) as ClassRow[];
}

export async function fetchMyMemberships(userId: string): Promise<ClassMemberRow[]> {
  const { data } = await db().from("class_members").select("*").eq("user_id", userId);
  return (data || []) as ClassMemberRow[];
}

export async function fetchClassesByIds(ids: string[]): Promise<ClassRow[]> {
  if (!ids.length) return [];
  const { data } = await db().from("classes").select("*").in("id", ids);
  return (data || []) as ClassRow[];
}

export async function fetchClass(classId: string): Promise<ClassRow | null> {
  const { data } = await db().from("classes").select("*").eq("id", classId).maybeSingle();
  return (data as ClassRow) || null;
}

export async function fetchClassMembers(classId: string): Promise<ClassMemberRow[]> {
  const { data } = await db().from("class_members").select("*").eq("class_id", classId).order("joined_at");
  return (data || []) as ClassMemberRow[];
}

export async function fetchClassPosts(classId: string): Promise<ClassPostRow[]> {
  const { data } = await db().from("class_posts").select("*").eq("class_id", classId).order("created_at", { ascending: false });
  return (data || []) as ClassPostRow[];
}

export async function fetchComments(postIds: string[]): Promise<ClassCommentRow[]> {
  if (!postIds.length) return [];
  const { data } = await db().from("class_comments").select("*").in("post_id", postIds).order("created_at");
  return (data || []) as ClassCommentRow[];
}

export async function fetchSubmissionsForClass(classId: string): Promise<SubmissionRow[]> {
  const { data } = await db().from("assignment_submissions").select("*").eq("class_id", classId).order("submitted_at", { ascending: false });
  return (data || []) as SubmissionRow[];
}

export async function fetchAttemptsForClass(classId: string): Promise<TestAttemptRow[]> {
  const { data } = await db().from("class_test_attempts").select("*").eq("class_id", classId).order("submitted_at", { ascending: false });
  return (data || []) as TestAttemptRow[];
}

export async function fetchPrivateComments(postId: string): Promise<PrivateCommentRow[]> {
  const { data } = await db().from("submission_private_comments").select("*").eq("post_id", postId).order("created_at");
  return (data || []) as PrivateCommentRow[];
}

/** Display names for a set of user ids (profiles are readable by members). */
export async function fetchDisplayNames(userIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = [...new Set(userIds)].filter(Boolean);
  if (!ids.length) return out;
  const { data } = await supabase.from("profiles").select("user_id, display_name").in("user_id", ids);
  (data || []).forEach((p: any) => out.set(p.user_id, p.display_name || "Student"));
  return out;
}

/* ---------------- mutations ---------------- */

export interface NewClassInput {
  title: string;
  subject?: string;
  program?: string;
  semester?: number;
  section?: string;
  joinRequiresApproval: boolean;
}

export async function createClass(teacherId: string, input: NewClassInput): Promise<ClassRow> {
  const cover = Math.floor(Math.random() * CLASS_COVERS.length);
  const { data, error } = await db()
    .from("classes")
    .insert({
      teacher_id: teacherId,
      title: input.title.trim(),
      subject: input.subject?.trim() || null,
      program: input.program?.trim() || null,
      semester: input.semester ?? null,
      section: input.section?.trim() || null,
      join_requires_approval: input.joinRequiresApproval,
      cover,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as ClassRow;
}

export type JoinResult =
  | { status: "joined" | "pending" | "already_member"; classId: string; title?: string }
  | { status: "not_found" | "own_class" | "unauthenticated"; classId?: string };

export async function joinClassByCode(code: string): Promise<JoinResult> {
  const { data, error } = await (supabase.rpc as any)("join_class_by_code", { _code: code.trim() });
  if (error) throw error;
  const r = (data || {}) as any;
  return { status: r.status, classId: r.class_id, title: r.title } as JoinResult;
}

export interface NewPostInput {
  type: ClassPostType;
  title?: string;
  body?: string;
  attachmentUrl?: string;
  attachmentName?: string;
  dueAt?: string | null;
  maxMarks?: number | null;
  meta?: Record<string, unknown>;
}

export async function createPost(classId: string, authorId: string, input: NewPostInput): Promise<ClassPostRow> {
  const { data, error } = await db()
    .from("class_posts")
    .insert({
      class_id: classId,
      author_id: authorId,
      type: input.type,
      title: input.title?.trim() || null,
      body: input.body?.trim() || null,
      attachment_url: input.attachmentUrl || null,
      attachment_name: input.attachmentName || null,
      due_at: input.dueAt || null,
      max_marks: input.maxMarks ?? null,
      meta: input.meta || {},
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as ClassPostRow;
}

export async function addComment(postId: string, classId: string, authorId: string, body: string): Promise<void> {
  const { error } = await db().from("class_comments").insert({ post_id: postId, class_id: classId, author_id: authorId, body: body.trim() });
  if (error) throw error;
}

export async function upsertSubmission(input: {
  postId: string;
  classId: string;
  studentId: string;
  textAnswer?: string;
  fileUrl?: string;
  fileName?: string;
}): Promise<void> {
  const { error } = await db()
    .from("assignment_submissions")
    .upsert(
      {
        post_id: input.postId,
        class_id: input.classId,
        student_id: input.studentId,
        text_answer: input.textAnswer?.trim() || null,
        file_url: input.fileUrl || null,
        file_name: input.fileName || null,
        status: "turned_in",
        submitted_at: new Date().toISOString(),
      },
      { onConflict: "post_id,student_id" },
    );
  if (error) throw error;
}

export async function returnSubmission(submissionId: string, marks: number, feedback: string): Promise<void> {
  const { error } = await db()
    .from("assignment_submissions")
    .update({ marks, feedback: feedback.trim() || null, status: "returned", returned_at: new Date().toISOString() })
    .eq("id", submissionId);
  if (error) throw error;
}

export async function addPrivateComment(input: {
  postId: string;
  classId: string;
  studentId: string;
  authorId: string;
  body: string;
}): Promise<void> {
  const { error } = await db().from("submission_private_comments").insert({
    post_id: input.postId,
    class_id: input.classId,
    student_id: input.studentId,
    author_id: input.authorId,
    body: input.body.trim(),
  });
  if (error) throw error;
}

export async function setMemberStatus(memberId: string, status: MemberStatus): Promise<void> {
  const { error } = await db().from("class_members").update({ status }).eq("id", memberId);
  if (error) throw error;
}

export async function removeMember(memberId: string): Promise<void> {
  const { error } = await db().from("class_members").delete().eq("id", memberId);
  if (error) throw error;
}

export async function updateClass(classId: string, patch: Partial<Pick<ClassRow, "title" | "join_requires_approval" | "archived" | "cover">>): Promise<void> {
  const { error } = await db().from("classes").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", classId);
  if (error) throw error;
}

/* ---------------- class test RPCs ---------------- */

export interface ClassTestQuestion {
  id: string;
  question: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  topic: string | null;
}

export type StartTestResult =
  | { status: "started"; questions: ClassTestQuestion[]; total: number }
  | { status: "submitted"; score: number; total: number }
  | { status: "no_questions" | "not_member" | "not_found" | "unauthenticated" };

export async function startClassTest(postId: string): Promise<StartTestResult> {
  const { data, error } = await (supabase.rpc as any)("start_class_test", { _post_id: postId });
  if (error) throw error;
  return data as StartTestResult;
}

export async function submitClassTest(postId: string, answers: Record<string, string>): Promise<{ status: string; score?: number; total?: number; marks?: number }> {
  const { data, error } = await (supabase.rpc as any)("submit_class_test", { _post_id: postId, _answers: answers });
  if (error) throw error;
  return data as any;
}

/* ---------------- files (private class-files bucket) ---------------- */

export async function uploadClassFile(classId: string, kind: "materials" | "submissions", userId: string, file: File): Promise<{ path: string; name: string }> {
  const safe = file.name.replace(/[^\w.\-]+/g, "_");
  const path = kind === "materials"
    ? `${classId}/materials/${Date.now()}-${safe}`
    : `${classId}/submissions/${userId}/${Date.now()}-${safe}`;
  const { error } = await supabase.storage.from("class-files").upload(path, file, { upsert: true });
  if (error) throw error;
  return { path, name: file.name };
}

/** Signed URL for a class-files path; external http links pass through. */
export async function classFileUrl(pathOrUrl: string): Promise<string | null> {
  if (!pathOrUrl) return null;
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const { data } = await supabase.storage.from("class-files").createSignedUrl(pathOrUrl, 3600);
  return data?.signedUrl ?? null;
}
