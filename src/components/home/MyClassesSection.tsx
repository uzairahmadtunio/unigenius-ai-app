import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarClock, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import ClassCard from "@/components/classes/ClassCard";
import {
  dueLabel, dueThisWeek, joinClassByCode,
  type ClassPostRow, type ClassRow,
} from "@/lib/classes";

/**
 * Student-home classes block (Panels Program F3.1/F3.2 + preview
 * screen 3): "Due This Week" first — what a student needs most — then
 * their class cards and the join-by-code box. Renders nothing for
 * signed-out visitors.
 */
export const MyClassesSection = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [due, setDue] = useState<ReturnType<typeof dueThisWeek>>([]);
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const [code, setCode] = useState("");
  const [joining, setJoining] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!user) { setLoaded(true); return; }
    let live = true;
    (async () => {
      try {
        const db = supabase as any;
        const { data: memberships } = await db.from("class_members").select("class_id, status").eq("user_id", user.id).eq("role", "student");
        const activeIds = (memberships || []).filter((m: any) => m.status === "active").map((m: any) => m.class_id);
        if (!activeIds.length) { if (live) { setClasses([]); setDue([]); setLoaded(true); } return; }
        const [{ data: clsRows }, { data: posts }, { data: subs }, { data: atts }, { data: memberRows }] = await Promise.all([
          db.from("classes").select("*").in("id", activeIds),
          db.from("class_posts").select("*").in("class_id", activeIds),
          db.from("assignment_submissions").select("post_id").eq("student_id", user.id),
          db.from("class_test_attempts").select("post_id, status").eq("student_id", user.id),
          db.from("class_members").select("class_id").in("class_id", activeIds).eq("status", "active").eq("role", "student"),
        ]);
        if (!live) return;
        const cls = (clsRows || []) as ClassRow[];
        setClasses(cls);
        const cm = new Map<string, number>();
        (memberRows || []).forEach((r: any) => cm.set(r.class_id, (cm.get(r.class_id) || 0) + 1));
        setCounts(cm);
        const done = new Set<string>([
          ...((subs || []) as any[]).map((s) => s.post_id),
          ...((atts || []) as any[]).filter((a) => a.status === "submitted").map((a) => a.post_id),
        ]);
        const titles = new Map(cls.map((c) => [c.id, c.title]));
        setDue(dueThisWeek((posts || []) as ClassPostRow[], titles, done));
      } catch { /* the home section is additive; never break the dashboard */ }
      if (live) setLoaded(true);
    })();
    return () => { live = false; };
  }, [user]);

  if (!user || !loaded) return null;

  const join = async () => {
    if (!code.trim()) return;
    setJoining(true);
    try {
      const r = await joinClassByCode(code);
      if (r.status === "joined") {
        toast.success(`Joined “${r.title || "the class"}” 🎉`);
        if (r.classId) navigate(`/classes/${r.classId}`);
      } else if (r.status === "pending") {
        toast.success("Request sent — the teacher will approve you");
        setCode("");
      } else if (r.status === "already_member" && r.classId) {
        navigate(`/classes/${r.classId}`);
      } else {
        toast.error("No class found with that code");
      }
    } catch (e: any) {
      toast.error(e?.message || "Could not join");
    } finally {
      setJoining(false);
    }
  };

  return (
    <section className="space-y-4">
      {due.length > 0 && (
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <h2 className="font-display font-bold text-lg tracking-tight text-foreground">Due This Week</h2>
            <Button variant="ghost" size="sm" className="rounded-xl text-primary" onClick={() => navigate("/classes")}>See all</Button>
          </div>
          <div className="grid sm:grid-cols-2 gap-2.5">
            {due.slice(0, 4).map(({ post, classTitle, done }) => (
              <button
                key={post.id}
                onClick={() => navigate(`/classes/${post.class_id}?tab=classwork`)}
                className={`flex items-center gap-3 rounded-2xl border px-3.5 py-3 text-left transition-all active:scale-[0.99] ${
                  done
                    ? "border-emerald-500/40 bg-emerald-500/5"
                    : post.due_at && new Date(post.due_at) < new Date()
                      ? "border-red-400/50 bg-red-400/5"
                      : "border-amber-400/40 bg-amber-400/5"
                }`}
              >
                {done ? <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" /> : <CalendarClock className="w-5 h-5 text-amber-500 shrink-0" />}
                <span className="min-w-0">
                  <span className="block text-[13px] font-bold truncate">{post.type === "test" ? "🎯 " : "📝 "}{post.title || (post.type === "test" ? "Class Test" : "Homework")}</span>
                  <span className="block text-[11px] text-muted-foreground truncate">
                    {classTitle} · {done ? "Done" : dueLabel(post.due_at as string)}{post.max_marks ? ` · ${post.max_marks} marks` : ""}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-display font-bold text-lg tracking-tight text-foreground">My Classes</h2>
          <Button variant="ghost" size="sm" className="rounded-xl text-primary" onClick={() => navigate("/classes")}>See all</Button>
        </div>
        {classes.length > 0 ? (
          <div className="grid sm:grid-cols-2 gap-3">
            {classes.slice(0, 4).map((c) => (
              <ClassCard key={c.id} cls={c} studentCount={counts.get(c.id) ?? 0} />
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border-[1.5px] border-dashed border-primary/50 bg-card p-4 space-y-3">
            <p className="text-sm"><b>Join a Class</b> <span className="text-muted-foreground">— your teacher will give you a code.</span></p>
            <div className="flex gap-2 max-w-md">
              <Input
                placeholder="ENTER CLASS CODE"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                className="rounded-xl tracking-[0.2em] font-semibold uppercase"
                maxLength={8}
                onKeyDown={(e) => e.key === "Enter" && void join()}
              />
              <Button className="rounded-xl gradient-primary shrink-0" onClick={() => void join()} disabled={joining || !code.trim()}>
                Join
              </Button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};

export default MyClassesSection;
