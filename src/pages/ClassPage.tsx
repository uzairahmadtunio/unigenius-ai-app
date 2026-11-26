import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft, Ban, CalendarClock, CheckCircle2, Copy, Download, FileText, Loader2, Lock, LogOut,
  Megaphone, MessageSquare, Paperclip, Plus, RotateCcw, Send, Settings2, Trash2, TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { toast } from "sonner";
import Navbar from "@/components/Navbar";
import { useAuth } from "@/contexts/AuthContext";
import { useRole } from "@/hooks/use-role";
import {
  addComment, classCoverStyle, classFileUrl, createPost, deleteClass, dueLabel, fetchAttemptsForClass, fetchClass,
  fetchClassMembers, fetchClassPosts, fetchComments, fetchDisplayNames, fetchSubmissionsForClass,
  logClassAudit, pct, removeMember, setMemberStatus, updateClass,
  type ClassCommentRow, type ClassPostRow, type ClassRow, type ClassPostType, type SubmissionRow, type TestAttemptRow,
} from "@/lib/classes";
import { cn } from "@/lib/utils";
import CreatePostDialog from "@/components/classes/CreatePostDialog";
import HomeworkPanel from "@/components/classes/HomeworkPanel";
import ClassTestPanel from "@/components/classes/ClassTestPanel";

type Tab = "stream" | "classwork" | "people" | "results";
const TABS: { id: Tab; label: string }[] = [
  { id: "stream", label: "Stream" },
  { id: "classwork", label: "Classwork" },
  { id: "people", label: "People" },
  { id: "results", label: "Results" },
];

const TYPE_META: Record<ClassPostType, { label: string; cls: string }> = {
  announcement: { label: "ANNOUNCEMENT", cls: "text-sky-400" },
  test: { label: "TEST", cls: "text-amber-400" },
  homework: { label: "HOMEWORK", cls: "text-fuchsia-400" },
  material: { label: "MATERIAL", cls: "text-teal-300" },
};

const ClassPage = () => {
  const { classId } = useParams<{ classId: string }>();
  const { user } = useAuth();
  const { isAdmin } = useRole();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab) || "stream";

  const [cls, setCls] = useState<ClassRow | null>(null);
  const [members, setMembers] = useState<any[]>([]);
  const [posts, setPosts] = useState<ClassPostRow[]>([]);
  const [comments, setComments] = useState<ClassCommentRow[]>([]);
  const [submissions, setSubmissions] = useState<SubmissionRow[]>([]);
  const [attempts, setAttempts] = useState<TestAttemptRow[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [createType, setCreateType] = useState<Exclude<ClassPostType, "announcement"> | null>(null);

  const load = useCallback(async () => {
    if (!classId || !user) return;
    const c = await fetchClass(classId);
    setCls(c);
    if (!c) { setLoading(false); return; }
    const [ms, ps] = await Promise.all([fetchClassMembers(classId), fetchClassPosts(classId)]);
    setMembers(ms);
    setPosts(ps);
    const [cs, subs, atts] = await Promise.all([
      fetchComments(ps.map((p) => p.id)),
      fetchSubmissionsForClass(classId),
      fetchAttemptsForClass(classId),
    ]);
    setComments(cs);
    setSubmissions(subs);
    setAttempts(atts);
    const ids = [c.teacher_id, ...ms.map((m: any) => m.user_id), ...ps.map((p) => p.author_id), ...cs.map((x) => x.author_id), ...subs.map((s) => s.student_id), ...atts.map((a) => a.student_id)];
    setNames(await fetchDisplayNames(ids));
    setLoading(false);
  }, [classId, user]);

  useEffect(() => { void load(); }, [load]);

  // Deep link from the teacher dashboard shortcuts: ?create=test|material
  useEffect(() => {
    const c = params.get("create");
    if (c === "test" || c === "material" || c === "homework") {
      setCreateType(c);
      params.delete("create");
      setParams(params, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.get("create")]);

  const myMember = members.find((m: any) => m.user_id === user?.id);
  const isTeacherOfClass = !!cls && !!user && (cls.teacher_id === user.id || myMember?.role === "teacher");
  const isActiveMember = isTeacherOfClass || myMember?.status === "active" || isAdmin;
  const isPending = myMember?.status === "pending" && !isTeacherOfClass;
  const isSuspended = myMember?.status === "suspended" && !isTeacherOfClass && !isAdmin;
  const studentMembers = members.filter((m: any) => m.status === "active" && m.role === "student");
  const suspendedMembers = members.filter((m: any) => m.status === "suspended" && m.role === "student");
  const pendingMembers = members.filter((m: any) => m.status === "pending");

  const commentsByPost = useMemo(() => {
    const map = new Map<string, ClassCommentRow[]>();
    comments.forEach((c) => { const arr = map.get(c.post_id) || []; arr.push(c); map.set(c.post_id, arr); });
    return map;
  }, [comments]);

  if (!user) return null;
  if (loading) {
    return <div className="min-h-screen gradient-hero"><Navbar /><div className="flex justify-center py-24"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div></div>;
  }
  if (!cls) {
    return (
      <div className="min-h-screen gradient-hero"><Navbar />
        <main className="container mx-auto px-4 py-20 text-center space-y-3">
          <Lock className="w-9 h-9 text-primary mx-auto" />
          <p className="font-display font-bold text-lg">Class not found</p>
          <p className="text-sm text-muted-foreground">This class does not exist, or you do not have access to it.</p>
          <Button className="rounded-xl gradient-primary" onClick={() => navigate("/classes")}>Go to My Classes</Button>
        </main>
      </div>
    );
  }
  if (isSuspended) {
    return (
      <div className="min-h-screen gradient-hero"><Navbar />
        <main className="container mx-auto px-4 py-20 text-center space-y-3 max-w-md">
          <Ban className="w-9 h-9 text-destructive mx-auto" />
          <p className="font-display font-bold text-lg">{cls.title}</p>
          <p className="text-sm text-muted-foreground">You are suspended from this class — contact your teacher.</p>
          <p className="text-xs text-muted-foreground">While you are suspended you cannot see this class's posts, homework or tests, and you cannot submit or comment. Your teacher can lift the suspension at any time.</p>
          <Button className="rounded-xl gradient-primary" onClick={() => navigate("/classes")}>Go to My Classes</Button>
        </main>
      </div>
    );
  }
  if (!isActiveMember) {
    return (
      <div className="min-h-screen gradient-hero"><Navbar />
        <main className="container mx-auto px-4 py-20 text-center space-y-3 max-w-md">
          <Lock className="w-9 h-9 text-primary mx-auto" />
          <p className="font-display font-bold text-lg">{isPending ? "Waiting for approval" : "You are not in this class"}</p>
          <p className="text-sm text-muted-foreground">
            {isPending
              ? `Your request to join “${cls.title}” is with the teacher. You will see the class as soon as it is approved.`
              : `Join “${cls.title}” with its class code from the Classes page.`}
          </p>
          <Button className="rounded-xl gradient-primary" onClick={() => navigate("/classes")}>Go to My Classes</Button>
        </main>
      </div>
    );
  }

  const setTab = (t: Tab) => { params.set("tab", t); setParams(params); };
  const subLine = [cls.program, cls.semester ? `Semester ${cls.semester}` : null, cls.section ? `Section ${cls.section}` : null].filter(Boolean).join(" · ");

  return (
    <div className="min-h-screen gradient-hero">
      <Navbar />
      <main className="container mx-auto px-4 md:px-6 py-5 pb-28 md:pb-10 max-w-4xl space-y-4">
        <button onClick={() => navigate("/classes")} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-4 h-4" /> All classes
        </button>

        {/* Class header */}
        <div className="rounded-3xl overflow-hidden border border-primary/25 shadow-md">
          <div className="relative px-5 py-5 overflow-hidden" style={{ background: classCoverStyle(cls.cover) }}>
            <div aria-hidden className="absolute -right-6 -top-12 w-44 h-44 rounded-full bg-white/15" />
            <div aria-hidden className="absolute right-24 -bottom-16 w-32 h-32 rounded-full bg-white/10" />
            <div className="relative flex items-start justify-between gap-3">
              <div>
                <h1 className="font-display font-bold text-2xl text-white leading-tight">{cls.title}</h1>
                <p className="text-white/85 text-sm mt-1">{subLine || cls.subject || ""}</p>
                <p className="text-white/75 text-xs mt-1.5">
                  {studentMembers.length} students · Teacher: {names.get(cls.teacher_id) || "Teacher"}
                </p>
              </div>
              {isTeacherOfClass && (
                <button
                  onClick={() => { void navigator.clipboard?.writeText(cls.code); toast.success(`Class code ${cls.code} copied — share it with students`); }}
                  className="shrink-0 flex items-center gap-1.5 rounded-lg bg-black/35 px-2.5 py-1.5 text-white text-xs font-bold tracking-widest hover:bg-black/50"
                  title="Copy class code"
                >
                  {cls.code} <Copy className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
          <div className="bg-card px-3 py-2 flex gap-1.5 overflow-x-auto">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                aria-pressed={tab === t.id}
                className={cn(
                  "rounded-full px-3.5 py-1.5 text-[13px] font-semibold whitespace-nowrap transition-all",
                  tab === t.id ? "gradient-primary text-primary-foreground shadow-sm" : "bg-muted/60 text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {tab === "stream" && (
          <StreamTab
            cls={cls} posts={posts} commentsByPost={commentsByPost} names={names} userId={user.id}
            isTeacher={isTeacherOfClass} submissions={submissions} attempts={attempts}
            studentCount={studentMembers.length} onChanged={load}
          />
        )}
        {tab === "classwork" && (
          <ClassworkTab
            cls={cls} posts={posts} names={names} userId={user.id} isTeacher={isTeacherOfClass}
            submissions={submissions} attempts={attempts} studentCount={studentMembers.length}
            onChanged={load} onCreate={(t) => setCreateType(t)}
          />
        )}
        {tab === "people" && (
          <PeopleTab
            cls={cls} members={members} pending={pendingMembers} students={studentMembers} suspended={suspendedMembers} names={names}
            userId={user.id} isTeacher={isTeacherOfClass} onChanged={load}
          />
        )}
        {tab === "results" && (
          <ResultsTab
            cls={cls} posts={posts} attempts={attempts} submissions={submissions} names={names}
            students={studentMembers} userId={user.id} isTeacher={isTeacherOfClass}
          />
        )}
      </main>

      {createType && (
        <CreatePostDialog
          open={!!createType}
          onOpenChange={(o) => !o && setCreateType(null)}
          classId={cls.id}
          teacherId={user.id}
          defaultType={createType}
          defaultSubject={cls.subject}
          onCreated={() => { setCreateType(null); void load(); }}
        />
      )}
    </div>
  );
};

/* ================= Stream ================= */

const StreamTab = ({ cls, posts, commentsByPost, names, userId, isTeacher, submissions, attempts, studentCount, onChanged }: any) => {
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);

  const postAnnouncement = async () => {
    if (!draft.trim()) return;
    setPosting(true);
    try {
      await createPost(cls.id, userId, { type: "announcement", body: draft });
      setDraft("");
      onChanged();
    } catch (e: any) {
      toast.error(e?.message || "Could not post");
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="space-y-3.5">
      {isTeacher && (
        <div className="rounded-2xl border border-primary/25 bg-card p-3.5 space-y-2.5">
          <Textarea rows={2} placeholder="Announce something to your class…" value={draft} onChange={(e) => setDraft(e.target.value)} className="rounded-xl border-0 bg-muted/40 focus-visible:ring-1" />
          <div className="flex justify-end">
            <Button size="sm" className="rounded-full gradient-primary gap-1.5" onClick={() => void postAnnouncement()} disabled={posting || !draft.trim()}>
              {posting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Megaphone className="w-3.5 h-3.5" />} Post
            </Button>
          </div>
        </div>
      )}
      {posts.length === 0 && (
        <div className="rounded-2xl border border-dashed border-primary/30 bg-card p-8 text-center">
          <p className="font-display font-bold">Nothing here yet</p>
          <p className="text-sm text-muted-foreground mt-1">{isTeacher ? "Post an announcement, or add tests, homework and materials from Classwork." : "Your teacher has not posted anything yet."}</p>
        </div>
      )}
      {posts.map((p: ClassPostRow) => (
        <PostCard key={p.id} post={p} comments={commentsByPost.get(p.id) || []} names={names} userId={userId}
          isTeacher={isTeacher} submissions={submissions} attempts={attempts} studentCount={studentCount}
          onChanged={onChanged} showComments />
      ))}
    </div>
  );
};

/* ================= Classwork ================= */

const ClassworkTab = ({ cls, posts, names, userId, isTeacher, submissions, attempts, studentCount, onChanged, onCreate }: any) => {
  const groups: { type: ClassPostType; label: string }[] = [
    { type: "test", label: "Tests" },
    { type: "homework", label: "Homework" },
    { type: "material", label: "Materials" },
  ];
  return (
    <div className="space-y-6">
      {isTeacher && (
        <div className="grid grid-cols-3 gap-2.5">
          <Button variant="outline" className="rounded-xl" onClick={() => onCreate("test")}>+ New Test</Button>
          <Button variant="outline" className="rounded-xl" onClick={() => onCreate("homework")}>+ Homework</Button>
          <Button variant="outline" className="rounded-xl" onClick={() => onCreate("material")}>+ Material</Button>
        </div>
      )}
      {groups.map((g) => {
        const items = posts.filter((p: ClassPostRow) => p.type === g.type);
        if (!items.length) return null;
        return (
          <section key={g.type} className="space-y-3">
            <h3 className="font-display font-bold text-sm tracking-wide text-muted-foreground uppercase">{g.label}</h3>
            {items.map((p: ClassPostRow) => (
              <PostCard key={p.id} post={p} comments={[]} names={names} userId={userId} isTeacher={isTeacher}
                submissions={submissions} attempts={attempts} studentCount={studentCount} onChanged={onChanged} showComments={false} />
            ))}
          </section>
        );
      })}
      {posts.filter((p: ClassPostRow) => p.type !== "announcement").length === 0 && (
        <div className="rounded-2xl border border-dashed border-primary/30 bg-card p-8 text-center">
          <p className="font-display font-bold">No classwork yet</p>
          <p className="text-sm text-muted-foreground mt-1">{isTeacher ? "Create a test, homework or material to get started." : "Tests, homework and materials will appear here."}</p>
        </div>
      )}
    </div>
  );
};

/* ================= Post card ================= */

const PostCard = ({ post, comments, names, userId, isTeacher, submissions, attempts, studentCount, onChanged, showComments }: {
  post: ClassPostRow; comments: ClassCommentRow[]; names: Map<string, string>; userId: string;
  isTeacher: boolean; submissions: SubmissionRow[]; attempts: TestAttemptRow[]; studentCount: number;
  onChanged: () => void; showComments: boolean;
}) => {
  const [draft, setDraft] = useState("");
  const [openComments, setOpenComments] = useState(false);
  const meta = TYPE_META[post.type];
  const mySubmission = submissions.find((s) => s.post_id === post.id && s.student_id === userId) || null;
  const postSubmissions = submissions.filter((s) => s.post_id === post.id);
  const myAttempt = attempts.find((a) => a.post_id === post.id && a.student_id === userId) || null;
  const postAttempts = attempts.filter((a) => a.post_id === post.id);

  const openAttachment = async () => {
    if (!post.attachment_url) return;
    const url = await classFileUrl(post.attachment_url);
    if (url) window.open(url, "_blank", "noopener");
    else toast.error("Could not open the file");
  };

  const sendComment = async () => {
    if (!draft.trim()) return;
    try {
      await addComment(post.id, post.class_id, userId, draft);
      setDraft("");
      onChanged();
    } catch (e: any) {
      toast.error(e?.message || "Could not comment");
    }
  };

  return (
    <article className="rounded-2xl border border-primary/20 bg-card p-4 space-y-2 shadow-sm">
      <div className="flex items-center gap-2.5">
        <Avatar className="w-8 h-8">
          <AvatarFallback className="bg-primary/15 text-primary text-[11px] font-bold">
            {(names.get(post.author_id) || "T").split(" ").map((w) => w[0]).slice(0, 2).join("")}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold leading-tight truncate">{names.get(post.author_id) || "Teacher"}</p>
          <p className="text-[11px] text-muted-foreground">{new Date(post.created_at).toLocaleDateString(undefined, { day: "numeric", month: "short" })} · <span className={cn("font-bold tracking-wide", meta.cls)}>{meta.label}</span></p>
        </div>
        {post.due_at && (
          <span className="shrink-0 flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-full bg-amber-400/10 border border-amber-400/35 text-amber-500">
            <CalendarClock className="w-3 h-3" /> {dueLabel(post.due_at)}
          </span>
        )}
      </div>

      {post.title && <h3 className="font-display font-bold text-[15px] leading-snug">{post.title}</h3>}
      {post.body && <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">{post.body}</p>}

      {post.attachment_url && (
        <button onClick={() => void openAttachment()} className="w-full flex items-center gap-3 rounded-xl border border-border bg-muted/30 hover:bg-muted/50 px-3 py-2.5 text-left">
          <span className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            {post.type === "material" ? <FileText className="w-5 h-5 text-primary" /> : <Paperclip className="w-5 h-5 text-primary" />}
          </span>
          <span className="min-w-0">
            <span className="block text-[13px] font-semibold truncate">{post.attachment_name || "Attachment"}</span>
            <span className="block text-[11px] text-muted-foreground">Tap to open</span>
          </span>
        </button>
      )}

      {post.type === "homework" && (
        <HomeworkPanel post={post} userId={userId} isTeacher={isTeacher} mySubmission={mySubmission}
          submissions={postSubmissions} names={names} studentCount={studentCount} onChanged={onChanged} />
      )}
      {post.type === "test" && (
        <ClassTestPanel post={post} userId={userId} isTeacher={isTeacher} myAttempt={myAttempt}
          attempts={postAttempts} names={names} onChanged={onChanged} />
      )}

      {showComments && (
        <div className="pt-1.5 border-t border-border/60">
          <button className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground" onClick={() => setOpenComments(!openComments)}>
            <MessageSquare className="w-3.5 h-3.5" /> {comments.length} class comment{comments.length === 1 ? "" : "s"}
          </button>
          {openComments && (
            <div className="mt-2.5 space-y-2">
              {comments.map((c) => (
                <div key={c.id} className="flex gap-2">
                  <Avatar className="w-6 h-6 shrink-0">
                    <AvatarFallback className="bg-primary/15 text-primary text-[9px] font-bold">
                      {(names.get(c.author_id) || "?").split(" ").map((w) => w[0]).slice(0, 2).join("")}
                    </AvatarFallback>
                  </Avatar>
                  <div className="bg-muted/50 rounded-xl rounded-tl-sm px-2.5 py-1.5 text-xs leading-relaxed">
                    <b>{names.get(c.author_id) || "User"}:</b> {c.body}
                  </div>
                </div>
              ))}
              <div className="flex gap-2">
                <Input placeholder="Add a class comment…" value={draft} onChange={(e) => setDraft(e.target.value)}
                  className="rounded-full h-9 text-xs" onKeyDown={(e) => e.key === "Enter" && void sendComment()} />
                <Button size="icon" className="rounded-full h-9 w-9 shrink-0 gradient-primary" onClick={() => void sendComment()} aria-label="Send comment">
                  <Send className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </article>
  );
};

/* ================= People ================= */

/** Small confirm-dialog button used by every class-management action. */
const ConfirmBtn = ({ label, icon, title, description, confirmLabel, destructive, className, onConfirm }: any) => (
  <AlertDialog>
    <AlertDialogTrigger asChild>
      <Button size="sm" variant="outline" className={className}>{icon}{label}</Button>
    </AlertDialogTrigger>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription>{description}</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction
          className={destructive ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : undefined}
          onClick={() => void onConfirm()}
        >
          {confirmLabel}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);

const PeopleTab = ({ cls, members, pending, students, suspended, names, userId, isTeacher, onChanged }: any) => {
  const navigate = useNavigate();
  const [showSettings, setShowSettings] = useState(false);
  const [deleteText, setDeleteText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const teacherRows = members.filter((m: any) => m.role === "teacher" && m.status === "active");

  const act = async (fn: () => Promise<void>, ok: string) => {
    try { await fn(); toast.success(ok); onChanged(); }
    catch (e: any) { toast.error(e?.message || "Something went wrong"); }
  };

  const audit = (action: "class_student_remove" | "class_student_suspend" | "class_student_unsuspend" | "class_delete" | "class_leave", details: Record<string, unknown>) =>
    void logClassAudit(userId, action, { class_id: cls.id, class_title: cls.title, ...details });

  const doDeleteClass = async () => {
    setDeleting(true);
    try {
      const r = await deleteClass(cls.id);
      audit("class_delete", { files_removed: r.filesRemoved, files_failed: r.filesFailed });
      toast.success("Class deleted");
      navigate("/classes");
    } catch (e: any) {
      toast.error(e?.message || "Could not delete the class");
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <h3 className="font-display font-bold text-sm tracking-wide text-muted-foreground uppercase">Teachers</h3>
        <PersonRow name={names.get(cls.teacher_id) || "Teacher"} note="Class teacher" highlight />
        {teacherRows.filter((m: any) => m.user_id !== cls.teacher_id).map((m: any) => (
          <PersonRow key={m.id} name={names.get(m.user_id) || "Teacher"} note="Co-teacher" />
        ))}
      </section>

      {isTeacher && pending.length > 0 && (
        <section className="space-y-2">
          <h3 className="font-display font-bold text-sm tracking-wide text-amber-500 uppercase">Waiting for approval ({pending.length})</h3>
          {pending.map((m: any) => (
            <div key={m.id} className="flex items-center justify-between gap-2 rounded-xl border border-amber-400/35 bg-amber-400/5 px-3 py-2.5">
              <span className="text-sm font-medium truncate">{names.get(m.user_id) || "Student"}</span>
              <span className="flex gap-1.5 shrink-0">
                <Button size="sm" className="rounded-lg gradient-primary h-8" onClick={() => void act(() => setMemberStatus(m.id, "active"), "Student approved")}>Approve</Button>
                <Button size="sm" variant="outline" className="rounded-lg h-8" onClick={() => void act(() => removeMember(m.id), "Request removed")}>Reject</Button>
              </span>
            </div>
          ))}
        </section>
      )}

      <section className="space-y-2">
        <h3 className="font-display font-bold text-sm tracking-wide text-muted-foreground uppercase">Students ({students.length})</h3>
        {students.map((m: any) => {
          const sName = names.get(m.user_id) || "Student";
          return (
            <div key={m.id} className="flex items-center justify-between gap-2 rounded-xl border border-border bg-card px-3 py-2.5">
              <PersonRow name={sName} note={m.user_id === userId ? "You" : undefined} bare />
              {isTeacher && (
                <span className="flex gap-1.5 shrink-0">
                  <ConfirmBtn
                    label="Suspend" icon={<Ban className="w-3.5 h-3.5 mr-1" />}
                    className="rounded-lg h-8 text-amber-500 border-amber-500/40 hover:bg-amber-500/10"
                    title={`Suspend ${sName}?`}
                    description={`${sName} will keep seeing this class in their list, but will not see any posts, homework or tests, and cannot submit or comment until you unsuspend them. Their earlier submissions stay visible to you.`}
                    confirmLabel="Suspend"
                    onConfirm={() => act(async () => { await setMemberStatus(m.id, "suspended"); audit("class_student_suspend", { student_id: m.user_id, member_id: m.id }); }, "Student suspended")}
                  />
                  <ConfirmBtn
                    label="Remove" icon={<Trash2 className="w-3.5 h-3.5 mr-1" />}
                    className="rounded-lg h-8 text-destructive border-destructive/40 hover:bg-destructive/10"
                    title={`Remove ${sName} from this class?`}
                    description={`${sName} will lose access to this class and its content right away. They can join again with the class code if you allow it.`}
                    confirmLabel="Remove" destructive
                    onConfirm={() => act(async () => { await removeMember(m.id); audit("class_student_remove", { student_id: m.user_id, member_id: m.id }); }, "Student removed from the class")}
                  />
                </span>
              )}
            </div>
          );
        })}
        {students.length === 0 && <p className="text-sm text-muted-foreground">No students yet — share the class code <b className="text-foreground">{cls.code}</b> to invite them.</p>}
      </section>

      {isTeacher && suspended.length > 0 && (
        <section className="space-y-2">
          <h3 className="font-display font-bold text-sm tracking-wide text-destructive uppercase">Suspended ({suspended.length})</h3>
          {suspended.map((m: any) => {
            const sName = names.get(m.user_id) || "Student";
            return (
              <div key={m.id} className="flex items-center justify-between gap-2 rounded-xl border border-destructive/35 bg-destructive/5 px-3 py-2.5">
                <PersonRow name={sName} note="Suspended — no access to class content" bare />
                <span className="flex gap-1.5 shrink-0">
                  <Button size="sm" variant="outline" className="rounded-lg h-8"
                    onClick={() => void act(async () => { await setMemberStatus(m.id, "active"); audit("class_student_unsuspend", { student_id: m.user_id, member_id: m.id }); }, "Student unsuspended — access restored")}>
                    <RotateCcw className="w-3.5 h-3.5 mr-1" /> Unsuspend
                  </Button>
                  <ConfirmBtn
                    label="Remove" icon={<Trash2 className="w-3.5 h-3.5 mr-1" />}
                    className="rounded-lg h-8 text-destructive border-destructive/40 hover:bg-destructive/10"
                    title={`Remove ${sName} from this class?`}
                    description={`${sName} will lose access to this class completely. They can join again with the class code if you allow it.`}
                    confirmLabel="Remove" destructive
                    onConfirm={() => act(async () => { await removeMember(m.id); audit("class_student_remove", { student_id: m.user_id, member_id: m.id }); }, "Student removed from the class")}
                  />
                </span>
              </div>
            );
          })}
        </section>
      )}

      {!isTeacher && (
        <ConfirmBtn
          label="Leave this class" icon={<LogOut className="w-4 h-4 mr-1.5" />}
          className="rounded-xl h-10 px-4 text-destructive border-destructive/40 hover:bg-destructive/10"
          title={`Leave “${cls.title}”?`}
          description="You will lose access to this class, its posts, homework and tests. Work you already submitted stays in your teacher's records. You can join again with the class code."
          confirmLabel="Leave class" destructive
          onConfirm={async () => {
            const mine = members.find((m: any) => m.user_id === userId);
            if (!mine) return;
            try {
              await removeMember(mine.id);
              audit("class_leave", { member_id: mine.id });
              toast.success("You left the class");
              navigate("/classes");
            } catch (e: any) { toast.error(e?.message || "Could not leave the class"); }
          }}
        />
      )}

      {isTeacher && (
        <section className="rounded-2xl border border-border bg-card p-4 space-y-3">
          <button className="flex items-center gap-2 font-display font-bold text-sm" onClick={() => setShowSettings(!showSettings)}>
            <Settings2 className="w-4 h-4 text-primary" /> Class settings
          </button>
          {showSettings && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">Approve students before they join</p>
                  <p className="text-[11px] text-muted-foreground">Currently {cls.join_requires_approval ? "ON — you approve each student" : "OFF — the code joins instantly"}</p>
                </div>
                <Switch checked={cls.join_requires_approval} onCheckedChange={(v) => void act(() => updateClass(cls.id, { join_requires_approval: v }), "Setting saved")} aria-label="Require join approval" />
              </div>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">Archive this class</p>
                  <p className="text-[11px] text-muted-foreground">Archived classes stop accepting students; all data stays saved</p>
                </div>
                <Switch checked={cls.archived} onCheckedChange={(v) => void act(() => updateClass(cls.id, { archived: v }), v ? "Class archived" : "Class re-opened")} aria-label="Archive class" />
              </div>
              <p className="text-xs text-muted-foreground">Class code: <b className="text-foreground tracking-widest">{cls.code}</b></p>
              <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-3 space-y-2.5">
                <p className="text-sm font-semibold text-destructive flex items-center gap-1.5"><TriangleAlert className="w-4 h-4" /> Danger zone</p>
                <p className="text-[11px] text-muted-foreground">Deleting this class permanently removes it for every member — all posts, comments, submissions and test results go with it. This cannot be undone.</p>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" className="rounded-lg h-9 text-destructive border-destructive/50 hover:bg-destructive/10" disabled={deleting}>
                      <Trash2 className="w-4 h-4 mr-1.5" /> Delete this class
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete “{cls.title}” forever?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Every member loses the class immediately, with all its posts, submissions and results. To confirm, type the class name exactly: <b className="text-foreground">{cls.title}</b>
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <Input value={deleteText} onChange={(e) => setDeleteText(e.target.value)} placeholder={cls.title} aria-label="Type the class name to confirm deletion" />
                    <AlertDialogFooter>
                      <AlertDialogCancel onClick={() => setDeleteText("")}>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        disabled={deleteText.trim() !== cls.title || deleting}
                        onClick={(e) => { if (deleteText.trim() !== cls.title) { e.preventDefault(); return; } void doDeleteClass(); }}
                      >
                        {deleting ? "Deleting…" : "Delete class"}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
};

const PersonRow = ({ name, note, highlight, bare }: { name: string; note?: string; highlight?: boolean; bare?: boolean }) => (
  <div className={cn("flex items-center gap-3", !bare && "rounded-xl border bg-card px-3 py-2.5", highlight ? "border-primary/30" : "border-border")}>
    <Avatar className="w-9 h-9">
      <AvatarFallback className="bg-primary/15 text-primary text-xs font-bold">
        {name.split(" ").map((w) => w[0]).slice(0, 2).join("")}
      </AvatarFallback>
    </Avatar>
    <div className="min-w-0">
      <p className="text-sm font-semibold truncate">{name}</p>
      {note && <p className="text-[11px] text-muted-foreground">{note}</p>}
    </div>
  </div>
);

/* ================= Results ================= */

const ResultsTab = ({ cls, posts, attempts, submissions, names, students, userId, isTeacher }: any) => {
  if (!isTeacher) {
    const myAttempts = attempts.filter((a: TestAttemptRow) => a.student_id === userId && a.status === "submitted");
    const mySubs = submissions.filter((s: SubmissionRow) => s.student_id === userId && s.status === "returned");
    const titleOf = (postId: string) => posts.find((p: ClassPostRow) => p.id === postId)?.title || "Item";
    if (!myAttempts.length && !mySubs.length) {
      return <div className="rounded-2xl border border-dashed border-primary/30 bg-card p-8 text-center"><p className="font-display font-bold">No results yet</p><p className="text-sm text-muted-foreground mt-1">Your test scores and graded homework will appear here.</p></div>;
    }
    return (
      <div className="space-y-2.5">
        {myAttempts.map((a: TestAttemptRow) => (
          <div key={a.id} className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3">
            <span className="text-sm font-medium truncate">{titleOf(a.post_id)}</span>
            <span className="font-bold shrink-0">{a.score}/{a.total} · {pct(a.score, a.total)}%</span>
          </div>
        ))}
        {mySubs.map((s: SubmissionRow) => (
          <div key={s.id} className="rounded-xl border border-border bg-card px-4 py-3 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium truncate">{titleOf(s.post_id)}</span>
              <span className="font-bold shrink-0">{s.marks ?? "—"} marks</span>
            </div>
            {s.feedback && <p className="text-xs text-muted-foreground">Feedback: {s.feedback}</p>}
          </div>
        ))}
      </div>
    );
  }

  // Teacher: whole-class sheet
  const rows = students.map((m: any) => {
    const myA = attempts.filter((a: TestAttemptRow) => a.student_id === m.user_id && a.status === "submitted");
    const avg = myA.length ? Math.round(myA.reduce((s: number, a: TestAttemptRow) => s + pct(a.score, a.total), 0) / myA.length) : null;
    const myS = submissions.filter((s: SubmissionRow) => s.student_id === m.user_id && s.status === "returned");
    const hwMarks = myS.reduce((s: number, x: SubmissionRow) => s + (Number(x.marks) || 0), 0);
    return { id: m.user_id, name: names.get(m.user_id) || "Student", tests: myA.length, avg, hw: myS.length, hwMarks };
  });
  const classAvg = rows.filter((r: any) => r.avg !== null).length
    ? Math.round(rows.filter((r: any) => r.avg !== null).reduce((s: number, r: any) => s + r.avg, 0) / rows.filter((r: any) => r.avg !== null).length)
    : null;

  const exportCsv = () => {
    const csv = ["Student,Tests attempted,Average %,Homework graded,Homework marks",
      ...rows.map((r: any) => `"${r.name}",${r.tests},${r.avg ?? ""},${r.hw},${r.hwMarks}`)].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${cls.title.replace(/[^\w]+/g, "-")}-results.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-sm text-muted-foreground">
          Class test average: <b className="text-foreground">{classAvg !== null ? `${classAvg}%` : "—"}</b> · {students.length} students
        </p>
        <Button size="sm" variant="outline" className="rounded-xl gap-1.5" onClick={exportCsv}>
          <Download className="w-3.5 h-3.5" /> Export CSV
        </Button>
      </div>
      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
              <th className="px-4 py-2.5 font-semibold">Student</th>
              <th className="px-3 py-2.5 font-semibold text-center">Tests</th>
              <th className="px-3 py-2.5 font-semibold text-center">Avg</th>
              <th className="px-3 py-2.5 font-semibold text-center">Homework</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r: any) => (
              <tr key={r.id} className="border-b border-border/50 last:border-0">
                <td className="px-4 py-2.5 font-medium truncate max-w-[140px]">{r.name}</td>
                <td className="px-3 py-2.5 text-center">{r.tests}</td>
                <td className="px-3 py-2.5 text-center font-semibold">{r.avg !== null ? `${r.avg}%` : "—"}</td>
                <td className="px-3 py-2.5 text-center">{r.hw ? `${r.hwMarks} marks · ${r.hw} graded` : "—"}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-6 text-center text-muted-foreground text-sm">No students in this class yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <CheckCircle2 className="w-3.5 h-3.5" /> Averages come from class tests; homework marks come from returned submissions.
      </p>
    </div>
  );
};

export default ClassPage;
