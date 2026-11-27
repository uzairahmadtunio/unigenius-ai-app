import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ClipboardCheck, FilePlus2, GraduationCap, Hourglass, Loader2, Plus, Upload, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import ModeSwitcher from "@/components/ModeSwitcher";
import FeedbackWidget from "@/components/FeedbackWidget";
import ClassCard from "@/components/classes/ClassCard";
import NewClassDialog from "@/components/classes/NewClassDialog";
import { useAuth } from "@/contexts/AuthContext";
import { useRole } from "@/hooks/use-role";
import { useViewMode } from "@/contexts/ViewModeContext";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchAttemptsForClass, fetchMyTeachingClasses, fetchSubmissionsForClass, pct,
  type ClassRow,
} from "@/lib/classes";

/**
 * Teacher Home (Panels Program C1) — the teacher-mode landing screen
 * from the approved design preview: stats, pending work, class cards
 * with join codes, and the New Class / New Test / Upload shortcuts.
 */
const TeacherHome = () => {
  const { user } = useAuth();
  const { isTeacher, isAdmin } = useRole();
  const { mode } = useViewMode();
  const navigate = useNavigate();
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const [avgs, setAvgs] = useState<Map<string, number>>(new Map());
  const [toGrade, setToGrade] = useState(0);
  const [testsLive, setTestsLive] = useState(0);
  const [teacherName, setTeacherName] = useState("");
  const [loading, setLoading] = useState(true);
  const [newClassOpen, setNewClassOpen] = useState(false);

  const canTeach = isTeacher || isAdmin;

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const mine = await fetchMyTeachingClasses(user.id);
      setClasses(mine);
      const { data: profile } = await supabase.from("profiles").select("display_name").eq("user_id", user.id).maybeSingle();
      setTeacherName((profile as any)?.display_name || "");

      const ids = mine.map((c) => c.id);
      if (!ids.length) { setCounts(new Map()); setAvgs(new Map()); setToGrade(0); setTestsLive(0); return; }

      const { data: memberRows } = await (supabase as any)
        .from("class_members").select("class_id").in("class_id", ids).eq("status", "active").eq("role", "student");
      const cm = new Map<string, number>();
      (memberRows || []).forEach((r: any) => cm.set(r.class_id, (cm.get(r.class_id) || 0) + 1));
      setCounts(cm);

      let grade = 0;
      let tests = 0;
      const avgMap = new Map<string, number>();
      await Promise.all(mine.map(async (c) => {
        const [subs, attempts, posts] = await Promise.all([
          fetchSubmissionsForClass(c.id),
          fetchAttemptsForClass(c.id),
          (supabase as any).from("class_posts").select("id, type").eq("class_id", c.id).then((r: any) => r.data || []),
        ]);
        grade += subs.filter((s) => s.status === "turned_in").length;
        tests += (posts as any[]).filter((p) => p.type === "test").length;
        const done = attempts.filter((a) => a.status === "submitted" && a.total);
        if (done.length) avgMap.set(c.id, Math.round(done.reduce((sum, a) => sum + pct(a.score, a.total), 0) / done.length));
      }));
      setToGrade(grade);
      setTestsLive(tests);
      setAvgs(avgMap);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { void load(); }, [load]);

  const totalStudents = useMemo(() => [...counts.values()].reduce((a, b) => a + b, 0), [counts]);
  const firstName = (teacherName || "Teacher").split(" ")[0];

  if (!user) return null;

  return (
    <div className="min-h-screen flex flex-col gradient-hero">
      <Navbar />
      <main className="flex-1 container mx-auto px-4 md:px-6 lg:px-10 py-6 space-y-5 pb-28 md:pb-10 max-w-5xl w-full">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="font-display font-bold text-2xl md:text-3xl text-foreground">
              Welcome back, {firstName} 👋
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {new Date().toLocaleDateString(undefined, { weekday: "long" })} · Teacher Mode
            </p>
          </div>
          <ModeSwitcher />
        </div>

        {!canTeach ? (
          <div className="rounded-2xl border border-border bg-card p-6 text-center space-y-2">
            <GraduationCap className="w-8 h-8 text-primary mx-auto" />
            <p className="font-display font-bold">Teacher access is not active on this account</p>
            <p className="text-sm text-muted-foreground">
              You are viewing Teacher Mode, but class tools unlock when an admin grants this account the teacher role.
            </p>
          </div>
        ) : (
          <>
            {/* Stats */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { n: totalStudents, label: "STUDENTS" },
                { n: toGrade, label: "TO GRADE" },
                { n: testsLive, label: "TESTS LIVE" },
              ].map((s) => (
                <div key={s.label} className="rounded-2xl border border-primary/20 bg-card py-3.5 text-center">
                  <p className="text-xl font-black gradient-text">{s.n}</p>
                  <p className="text-[10px] font-semibold tracking-wider text-muted-foreground mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>

            {/* Pending strip */}
            <button
              onClick={() => classes[0] && navigate(`/classes/${classes[0].id}`)}
              className="w-full flex items-center justify-between gap-3 rounded-2xl border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-left"
            >
              <span className="flex items-center gap-2 text-sm text-foreground">
                <Hourglass className="w-4 h-4 text-amber-500 shrink-0" />
                {toGrade > 0
                  ? <span><b>{toGrade} {toGrade === 1 ? "copy" : "copies"}</b> waiting to be graded</span>
                  : <span>Nothing waiting — all submissions are graded 🎉</span>}
              </span>
              <span className="text-xs font-semibold text-primary shrink-0">Open classes →</span>
            </button>

            {/* Classes */}
            <div className="flex items-center justify-between">
              <h2 className="font-display font-bold text-lg text-foreground">My Classes</h2>
              <Button size="sm" variant="ghost" className="rounded-xl text-primary gap-1" onClick={() => setNewClassOpen(true)}>
                <Plus className="w-4 h-4" /> New Class
              </Button>
            </div>

            {loading ? (
              <div className="flex justify-center py-14"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>
            ) : classes.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-primary/40 bg-card p-8 text-center space-y-3">
                <GraduationCap className="w-9 h-9 text-primary mx-auto" />
                <p className="font-display font-bold">No classes yet</p>
                <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                  Create your first class, share its code with students, and post tests, homework and materials — all in one place.
                </p>
                <Button className="rounded-xl gradient-primary" onClick={() => setNewClassOpen(true)}>
                  <Plus className="w-4 h-4 mr-1.5" /> Create a Class
                </Button>
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 gap-3.5">
                {classes.map((c, i) => (
                  <motion.div key={c.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18, delay: i * 0.04 }}>
                    <ClassCard cls={c} studentCount={counts.get(c.id) ?? 0} avgPct={avgs.get(c.id) ?? null} avgLabel="class avg" />
                  </motion.div>
                ))}
              </div>
            )}

            {/* Shortcuts */}
            <div className="grid grid-cols-3 gap-3">
              <Button variant="outline" className="rounded-2xl h-auto py-3.5 flex-col gap-1.5" onClick={() => (classes[0] ? navigate(`/classes/${classes[0].id}?tab=classwork&create=test`) : setNewClassOpen(true))}>
                <FilePlus2 className="w-5 h-5 text-primary" />
                <span className="text-xs font-semibold">New Test</span>
              </Button>
              <Button variant="outline" className="rounded-2xl h-auto py-3.5 flex-col gap-1.5" onClick={() => (classes[0] ? navigate(`/classes/${classes[0].id}?tab=classwork&create=material`) : setNewClassOpen(true))}>
                <Upload className="w-5 h-5 text-primary" />
                <span className="text-xs font-semibold">Upload Material</span>
              </Button>
              <Button variant="outline" className="rounded-2xl h-auto py-3.5 flex-col gap-1.5" onClick={() => navigate("/teacher-dashboard")}>
                <Wrench className="w-5 h-5 text-primary" />
                <span className="text-xs font-semibold">Quiz Tools</span>
              </Button>
            </div>

            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <ClipboardCheck className="w-3.5 h-3.5" />
              Quiz Tools opens the classic panel: create quizzes, add Question Bank questions and upload to the shared materials library.
            </p>
          </>
        )}
        {/* Feedback lives on the student home only — teachers had no
            way to send it from Teacher Mode (audit 2026-11-27). Same
            widget, same destination (Admin → Feedback). */}
        <div className="flex justify-end">
          <FeedbackWidget />
        </div>
      </main>
      <Footer />
      {user && (
        <NewClassDialog
          open={newClassOpen}
          onOpenChange={setNewClassOpen}
          teacherId={user.id}
          onCreated={(cls) => { setClasses((prev) => [cls, ...prev]); navigate(`/classes/${cls.id}`); }}
        />
      )}
    </div>
  );
};

export default TeacherHome;
