import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { GraduationCap, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import ModeSwitcher from "@/components/ModeSwitcher";
import ClassCard from "@/components/classes/ClassCard";
import NewClassDialog from "@/components/classes/NewClassDialog";
import { useAuth } from "@/contexts/AuthContext";
import { useViewMode } from "@/contexts/ViewModeContext";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchAttemptsForClass, fetchClassesByIds, fetchDisplayNames, fetchMyMemberships,
  fetchMyTeachingClasses, joinClassByCode, pct, type ClassRow,
} from "@/lib/classes";

/**
 * /classes — one list for every role. Teacher mode shows the classes
 * they teach (+ create); student mode shows joined classes, pending
 * requests and the Join-by-code box.
 */
const ClassesPage = () => {
  const { user } = useAuth();
  const { mode } = useViewMode();
  const navigate = useNavigate();
  const [teaching, setTeaching] = useState<ClassRow[]>([]);
  const [joined, setJoined] = useState<ClassRow[]>([]);
  const [pending, setPending] = useState<ClassRow[]>([]);
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const [teacherNames, setTeacherNames] = useState<Map<string, string>>(new Map());
  const [myAvgs, setMyAvgs] = useState<Map<string, number>>(new Map());
  const [code, setCode] = useState("");
  const [joining, setJoining] = useState(false);
  const [loading, setLoading] = useState(true);
  const [newClassOpen, setNewClassOpen] = useState(false);

  const teacherMode = mode === "teacher";

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [mine, memberships] = await Promise.all([fetchMyTeachingClasses(user.id), fetchMyMemberships(user.id)]);
      setTeaching(mine);
      const active = memberships.filter((m) => m.status === "active" && m.role === "student");
      const pend = memberships.filter((m) => m.status === "pending");
      const [activeClasses, pendingClasses] = await Promise.all([
        fetchClassesByIds(active.map((m) => m.class_id)),
        fetchClassesByIds(pend.map((m) => m.class_id)),
      ]);
      setJoined(activeClasses);
      setPending(pendingClasses);
      setTeacherNames(await fetchDisplayNames(activeClasses.map((c) => c.teacher_id)));

      const ids = [...mine, ...activeClasses].map((c) => c.id);
      if (ids.length) {
        const { data } = await (supabase as any).from("class_members").select("class_id").in("class_id", ids).eq("status", "active").eq("role", "student");
        const cm = new Map<string, number>();
        (data || []).forEach((r: any) => cm.set(r.class_id, (cm.get(r.class_id) || 0) + 1));
        setCounts(cm);
        const avgMap = new Map<string, number>();
        await Promise.all(activeClasses.map(async (c) => {
          const atts = await fetchAttemptsForClass(c.id);
          const mineDone = atts.filter((a) => a.student_id === user.id && a.status === "submitted" && a.total);
          if (mineDone.length) avgMap.set(c.id, Math.round(mineDone.reduce((s, a) => s + pct(a.score, a.total), 0) / mineDone.length));
        }));
        setMyAvgs(avgMap);
      }
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { void load(); }, [load]);

  const join = async () => {
    if (!code.trim()) return;
    setJoining(true);
    try {
      const r = await joinClassByCode(code);
      if (r.status === "joined") {
        toast.success(`Joined “${r.title || "the class"}” 🎉`);
        setCode("");
        await load();
        if (r.classId) navigate(`/classes/${r.classId}`);
      } else if (r.status === "pending") {
        toast.success("Request sent — the teacher will approve you");
        setCode("");
        await load();
      } else if (r.status === "already_member") {
        toast.info("You are already in this class");
        if (r.classId) navigate(`/classes/${r.classId}`);
      } else if (r.status === "own_class") {
        toast.info("This is your own class");
        if (r.classId) navigate(`/classes/${r.classId}`);
      } else {
        toast.error("No class found with that code — check it and try again");
      }
    } catch (e: any) {
      toast.error(e?.message || "Could not join");
    } finally {
      setJoining(false);
    }
  };

  if (!user) return null;

  return (
    <div className="min-h-screen flex flex-col gradient-hero">
      <Navbar />
      <main className="flex-1 container mx-auto px-4 md:px-6 lg:px-10 py-6 space-y-6 pb-28 md:pb-10 max-w-5xl w-full">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="font-display font-bold text-2xl md:text-3xl text-foreground flex items-center gap-2">
              <GraduationCap className="w-7 h-7 text-primary" /> {teacherMode ? "My Classes" : "Classes"}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {teacherMode ? "Classes you teach — tap one to open it." : "Your classes, all in one place."}
            </p>
          </div>
          <ModeSwitcher />
        </div>

        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>
        ) : (
          <>
            {teacherMode && (
              <section className="space-y-3">
                {teaching.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-primary/40 bg-card p-8 text-center space-y-3">
                    <p className="font-display font-bold">No classes yet</p>
                    <p className="text-sm text-muted-foreground">Create a class and share its code with your students.</p>
                    <Button className="rounded-xl gradient-primary" onClick={() => setNewClassOpen(true)}>
                      <Plus className="w-4 h-4 mr-1.5" /> Create a Class
                    </Button>
                  </div>
                ) : (
                  <div className="grid sm:grid-cols-2 gap-3.5">
                    {teaching.map((c) => (
                      <ClassCard key={c.id} cls={c} studentCount={counts.get(c.id) ?? 0} />
                    ))}
                  </div>
                )}
                {teaching.length > 0 && (
                  <Button variant="outline" className="rounded-xl gap-1.5" onClick={() => setNewClassOpen(true)}>
                    <Plus className="w-4 h-4" /> New Class
                  </Button>
                )}
              </section>
            )}

            {!teacherMode && (
              <>
                {pending.length > 0 && (
                  <section className="space-y-2.5">
                    <h2 className="font-display font-bold text-base">Waiting for approval</h2>
                    {pending.map((c) => (
                      <div key={c.id} className="rounded-2xl border border-amber-400/40 bg-amber-400/5 px-4 py-3 flex items-center justify-between gap-2">
                        <span className="text-sm font-medium truncate">{c.title}</span>
                        <span className="text-[11px] font-bold text-amber-500 shrink-0">PENDING</span>
                      </div>
                    ))}
                  </section>
                )}

                <section className="space-y-3">
                  <h2 className="font-display font-bold text-base">Joined classes</h2>
                  {joined.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-primary/40 bg-card p-8 text-center space-y-2">
                      <p className="font-display font-bold">You have not joined any class yet</p>
                      <p className="text-sm text-muted-foreground">Ask your teacher for the class code and join below.</p>
                    </div>
                  ) : (
                    <div className="grid sm:grid-cols-2 gap-3.5">
                      {joined.map((c) => (
                        <ClassCard key={c.id} cls={c} studentCount={counts.get(c.id) ?? 0}
                          avgPct={myAvgs.get(c.id) ?? null} avgLabel="my avg"
                          footerNote={teacherNames.get(c.teacher_id) ? `Teacher: ${teacherNames.get(c.teacher_id)}` : undefined} />
                      ))}
                    </div>
                  )}
                </section>

                <section className="rounded-2xl border-[1.5px] border-dashed border-primary/50 bg-card p-4 space-y-3 max-w-md">
                  <h2 className="font-display font-bold text-base">Join a Class</h2>
                  <div className="flex gap-2">
                    <Input
                      placeholder="ENTER CLASS CODE"
                      value={code}
                      onChange={(e) => setCode(e.target.value.toUpperCase())}
                      className="rounded-xl tracking-[0.2em] font-semibold uppercase"
                      maxLength={8}
                      onKeyDown={(e) => e.key === "Enter" && void join()}
                    />
                    <Button className="rounded-xl gradient-primary shrink-0" onClick={() => void join()} disabled={joining || !code.trim()}>
                      {joining && <Loader2 className="w-4 h-4 mr-1 animate-spin" />} Join
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">Your teacher will give you a 6-letter code, like XK4P9Q.</p>
                </section>
              </>
            )}
          </>
        )}
      </main>
      <Footer />
      {user && (
        <NewClassDialog open={newClassOpen} onOpenChange={setNewClassOpen} teacherId={user.id}
          onCreated={(cls) => { setTeaching((p) => [cls, ...p]); navigate(`/classes/${cls.id}`); }} />
      )}
    </div>
  );
};

export default ClassesPage;
