import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, Lock, Paperclip, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  addPrivateComment, classFileUrl, fetchPrivateComments, returnSubmission, uploadClassFile, upsertSubmission,
  type ClassPostRow, type PrivateCommentRow, type SubmissionRow,
} from "@/lib/classes";

interface Props {
  post: ClassPostRow;
  userId: string;
  isTeacher: boolean;
  mySubmission: SubmissionRow | null;
  submissions: SubmissionRow[];
  names: Map<string, string>;
  studentCount: number;
  onChanged: () => void;
}

/**
 * Homework block (Google Classroom model). Students turn work in
 * privately — only the class teacher sees it — and each student has a
 * private comment thread with the teacher on the assignment. The
 * teacher grades and returns from the same block.
 */
export const HomeworkPanel = ({ post, userId, isTeacher, mySubmission, submissions, names, studentCount, onChanged }: Props) => {
  if (isTeacher) {
    return <TeacherGrading post={post} submissions={submissions} names={names} studentCount={studentCount} teacherId={userId} onChanged={onChanged} />;
  }
  return <StudentSubmit post={post} userId={userId} mySubmission={mySubmission} onChanged={onChanged} />;
};

/* ---------------- student side ---------------- */

const StudentSubmit = ({ post, userId, mySubmission, onChanged }: { post: ClassPostRow; userId: string; mySubmission: SubmissionRow | null; onChanged: () => void }) => {
  const [text, setText] = useState(mySubmission?.text_answer || "");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [comments, setComments] = useState<PrivateCommentRow[]>([]);
  const [draft, setDraft] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const loadComments = async () => setComments(await fetchPrivateComments(post.id));
  useEffect(() => { void loadComments(); /* eslint-disable-next-line */ }, [post.id]);
  useEffect(() => { setText(mySubmission?.text_answer || ""); }, [mySubmission?.id, mySubmission?.status]);

  const turnedIn = !!mySubmission;
  const returned = mySubmission?.status === "returned";

  const submit = async () => {
    if (!text.trim() && !file && !mySubmission?.file_url) {
      toast.error("Write your answer or attach a file first");
      return;
    }
    setBusy(true);
    try {
      let fileUrl = mySubmission?.file_url || undefined;
      let fileName = mySubmission?.file_name || undefined;
      if (file) {
        const up = await uploadClassFile(post.class_id, "submissions", userId, file);
        fileUrl = up.path;
        fileName = up.name;
      }
      await upsertSubmission({ postId: post.id, classId: post.class_id, studentId: userId, textAnswer: text, fileUrl, fileName });
      toast.success(returned ? "Resubmitted to your teacher" : "Turned in — only your teacher can see this");
      setFile(null);
      onChanged();
    } catch (e: any) {
      toast.error(e?.message || "Could not turn in");
    } finally {
      setBusy(false);
    }
  };

  const sendComment = async () => {
    if (!draft.trim()) return;
    try {
      await addPrivateComment({ postId: post.id, classId: post.class_id, studentId: userId, authorId: userId, body: draft });
      setDraft("");
      await loadComments();
    } catch (e: any) {
      toast.error(e?.message || "Could not send");
    }
  };

  return (
    <div className="mt-3 space-y-3">
      <div className="rounded-xl border border-border bg-muted/30 p-3 space-y-2.5">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className="text-xs font-semibold flex items-center gap-1.5">
            <Lock className="w-3.5 h-3.5 text-primary" /> Your work — private
          </p>
          {returned ? (
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-primary/15 text-primary border border-primary/30">
              Returned · {mySubmission?.marks ?? "—"}{post.max_marks ? ` / ${post.max_marks}` : ""} marks
            </span>
          ) : turnedIn ? (
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-500 border border-emerald-500/30 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> Turned in
            </span>
          ) : (
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-400/15 text-amber-500 border border-amber-400/30">Not turned in</span>
          )}
        </div>
        {returned && mySubmission?.feedback && (
          <p className="text-xs text-foreground bg-primary/5 border border-primary/20 rounded-lg px-2.5 py-2">
            <b>Teacher feedback:</b> {mySubmission.feedback}
          </p>
        )}
        <Textarea rows={3} placeholder="Type your answer here…" value={text} onChange={(e) => setText(e.target.value)} className="rounded-lg bg-background" />
        <div className="flex items-center gap-2 flex-wrap">
          <input ref={fileRef} type="file" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          <Button size="sm" variant="outline" className="rounded-lg gap-1.5" onClick={() => fileRef.current?.click()}>
            <Paperclip className="w-3.5 h-3.5" /> {file ? file.name : mySubmission?.file_name || "Attach a file"}
          </Button>
          <Button size="sm" className="rounded-lg gradient-primary ml-auto" onClick={submit} disabled={busy}>
            {busy && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}
            {returned ? "Resubmit" : turnedIn ? "Update turn-in" : "Turn in"}
          </Button>
        </div>
      </div>

      {/* Private comments with the teacher */}
      <div className="space-y-2">
        <p className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1"><Lock className="w-3 h-3" /> Private comments — only you and your teacher</p>
        {comments.map((c) => (
          <div key={c.id} className={`flex ${c.author_id === userId ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-xs leading-relaxed ${c.author_id === userId ? "bg-primary/15 rounded-br-md" : "bg-muted rounded-bl-md"}`}>
              <span className="font-semibold">{c.author_id === userId ? "You" : "Teacher"}: </span>{c.body}
            </div>
          </div>
        ))}
        <div className="flex gap-2">
          <Input placeholder="Ask your teacher privately…" value={draft} onChange={(e) => setDraft(e.target.value)} className="rounded-full h-9 text-xs" onKeyDown={(e) => e.key === "Enter" && void sendComment()} />
          <Button size="icon" className="rounded-full h-9 w-9 shrink-0 gradient-primary" onClick={() => void sendComment()} aria-label="Send private comment">
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
};

/* ---------------- teacher side ---------------- */

const TeacherGrading = ({ post, submissions, names, studentCount, teacherId, onChanged }: { post: ClassPostRow; submissions: SubmissionRow[]; names: Map<string, string>; studentCount: number; teacherId: string; onChanged: () => void }) => {
  const [openId, setOpenId] = useState<string | null>(null);
  const turnedIn = submissions.length;

  return (
    <div className="mt-3 space-y-2">
      <p className="text-xs text-muted-foreground">
        <b className="text-foreground">{turnedIn}</b> of <b className="text-foreground">{studentCount}</b> students turned in
      </p>
      {submissions.map((s) => (
        <div key={s.id} className="rounded-xl border border-border overflow-hidden">
          <button className="w-full flex items-center justify-between gap-2 px-3 py-2.5 bg-muted/30 hover:bg-muted/50 text-left" onClick={() => setOpenId(openId === s.id ? null : s.id)}>
            <span className="text-sm font-medium truncate">{names.get(s.student_id) || "Student"}</span>
            <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border shrink-0 ${s.status === "returned" ? "bg-primary/15 text-primary border-primary/30" : "bg-emerald-500/15 text-emerald-500 border-emerald-500/30"}`}>
              {s.status === "returned" ? `Returned · ${s.marks ?? "—"}${post.max_marks ? `/${post.max_marks}` : ""}` : "Turned in"}
            </span>
          </button>
          {openId === s.id && (
            <GradeDetail post={post} submission={s} studentName={names.get(s.student_id) || "Student"} teacherId={teacherId} onChanged={onChanged} />
          )}
        </div>
      ))}
      {submissions.length === 0 && <p className="text-xs text-muted-foreground">No submissions yet.</p>}
    </div>
  );
};

const GradeDetail = ({ post, submission, studentName, teacherId, onChanged }: { post: ClassPostRow; submission: SubmissionRow; studentName: string; teacherId: string; onChanged: () => void }) => {
  const [marks, setMarks] = useState(submission.marks?.toString() || "");
  const [feedback, setFeedback] = useState(submission.feedback || "");
  const [busy, setBusy] = useState(false);
  const [comments, setComments] = useState<PrivateCommentRow[]>([]);
  const [draft, setDraft] = useState("");

  const loadComments = async () => {
    const all = await fetchPrivateComments(post.id);
    setComments(all.filter((c) => c.student_id === submission.student_id));
  };
  useEffect(() => { void loadComments(); /* eslint-disable-next-line */ }, [post.id, submission.student_id]);

  const openFile = async () => {
    if (!submission.file_url) return;
    const url = await classFileUrl(submission.file_url);
    if (url) window.open(url, "_blank", "noopener");
  };

  const doReturn = async () => {
    const m = Number(marks);
    if (marks === "" || Number.isNaN(m) || m < 0 || (post.max_marks != null && m > post.max_marks)) {
      toast.error(`Enter marks between 0 and ${post.max_marks ?? "∞"}`);
      return;
    }
    setBusy(true);
    try {
      await returnSubmission(submission.id, m, feedback);
      toast.success(`Returned to ${studentName}`);
      onChanged();
    } catch (e: any) {
      toast.error(e?.message || "Could not return");
    } finally {
      setBusy(false);
    }
  };

  const sendComment = async () => {
    if (!draft.trim()) return;
    try {
      await addPrivateComment({ postId: post.id, classId: post.class_id, studentId: submission.student_id, authorId: teacherId, body: draft });
      setDraft("");
      await loadComments();
    } catch (e: any) {
      toast.error(e?.message || "Could not send");
    }
  };

  return (
    <div className="p-3 space-y-3">
      {submission.text_answer && (
        <div className="rounded-lg bg-muted/30 border border-border px-3 py-2 text-sm whitespace-pre-wrap">{submission.text_answer}</div>
      )}
      {submission.file_url && (
        <Button size="sm" variant="outline" className="rounded-lg gap-1.5" onClick={() => void openFile()}>
          <Paperclip className="w-3.5 h-3.5" /> {submission.file_name || "Attached file"}
        </Button>
      )}
      {!submission.text_answer && !submission.file_url && <p className="text-xs text-muted-foreground">Turned in without an answer or file.</p>}

      <div className="flex items-end gap-2 flex-wrap">
        <div className="space-y-1">
          <label className="text-[11px] font-semibold text-muted-foreground">MARKS{post.max_marks ? ` / ${post.max_marks}` : ""}</label>
          <Input type="number" min={0} max={post.max_marks ?? undefined} value={marks} onChange={(e) => setMarks(e.target.value)} className="rounded-lg w-24 h-9" />
        </div>
        <div className="space-y-1 flex-1 min-w-[160px]">
          <label className="text-[11px] font-semibold text-muted-foreground">FEEDBACK</label>
          <Input value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="Good work — check Q3 again" className="rounded-lg h-9" />
        </div>
        <Button size="sm" className="rounded-lg gradient-primary" onClick={() => void doReturn()} disabled={busy}>
          {busy && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />} Return
        </Button>
      </div>

      <div className="space-y-2">
        <p className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1"><Lock className="w-3 h-3" /> Private comments with {studentName}</p>
        {comments.map((c) => (
          <div key={c.id} className={`flex ${c.author_id === teacherId ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-xs leading-relaxed ${c.author_id === teacherId ? "bg-primary/15 rounded-br-md" : "bg-muted rounded-bl-md"}`}>
              <span className="font-semibold">{c.author_id === teacherId ? "You" : studentName}: </span>{c.body}
            </div>
          </div>
        ))}
        <div className="flex gap-2">
          <Input placeholder="Reply privately…" value={draft} onChange={(e) => setDraft(e.target.value)} className="rounded-full h-9 text-xs" onKeyDown={(e) => e.key === "Enter" && void sendComment()} />
          <Button size="icon" className="rounded-full h-9 w-9 shrink-0 gradient-primary" onClick={() => void sendComment()} aria-label="Send private comment">
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
};

export default HomeworkPanel;
