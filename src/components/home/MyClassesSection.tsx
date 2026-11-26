import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarClock, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  dueLabel, dueThisWeek,
  type ClassPostRow, type ClassRow,
} from "@/lib/classes";

/**
 * Student-home "Due This Week" strip (Panels Program F3.1): what a
 * student needs most, first — homework/tests due in the next 7 days
 * across every class they joined. The classes list and the
 * join-by-code box used to live here too; on Uzair's order
 * (26 Nov 2026) they moved to the Classes tile → /classes page, so a
 * student with many teachers finds everything in one place. This
 * section now renders ONLY the due strip — and nothing at all when
 * nothing is due. Renders nothing for signed-out visitors.
 */
export const MyClassesSection = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [due, setDue] = useState<ReturnType<typeof dueThisWeek>>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!user) { setLoaded(true); return; }
    let live = true;
    (async () => {
      try {
        const db = supabase as any;
        const { data: memberships } = await db.from("class_members").select("class_id, status").eq("user_id", user.id).eq("role", "student");
        const activeIds = (memberships || []).filter((m: any) => m.status === "active").map((m: any) => m.class_id);
        if (!activeIds.length) { if (live) { setDue([]); setLoaded(true); } return; }
        const [{ data: clsRows }, { data: posts }, { data: subs }, { data: atts }] = await Promise.all([
          db.from("classes").select("*").in("id", activeIds),
          db.from("class_posts").select("*").in("class_id", activeIds),
          db.from("assignment_submissions").select("post_id").eq("student_id", user.id),
          db.from("class_test_attempts").select("post_id, status").eq("student_id", user.id),
        ]);
        if (!live) return;
        const cls = (clsRows || []) as ClassRow[];
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

  if (!user || !loaded || due.length === 0) return null;

  return (
    <section className="space-y-2.5">
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
    </section>
  );
};

export default MyClassesSection;
