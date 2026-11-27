import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Ban, GraduationCap, Loader2, LogOut, Plus, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import ModeSwitcher from "@/components/ModeSwitcher";
import { useSmartBack } from "@/hooks/use-smart-back";
import ClassCard from "@/components/classes/ClassCard";
import NewClassDialog from "@/components/classes/NewClassDialog";
import { useAuth } from "@/contexts/AuthContext";
import { useViewMode } from "@/contexts/ViewModeContext";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchAttemptsForClass, fetchClassesByIds, fetchDisplayNames, fetchMyMemberships,
  fetchMyTeachingClasses, joinClassByCode, logClassAudit, pct, removeMember,
  type ClassMemberRow, type ClassRow,
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
  const goBack = useSmartBack();
  const [teaching, setTeaching] = useState<ClassRow[]>([]);
  const [joined, setJoined] = useState<ClassRow[]>([]);
  const [pending, setPending] = useState<ClassRow[]>([]);
  const [suspended, setSuspended] = useState<ClassRow[]>([]);
  const [memberRows, setMemberRows] = useState<ClassMemberRow[]>([]);
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
      setMemberRows(memberships);
      const active = memberships.filter((m) => m.status === "active" && m.role === "student");
      const pend = memberships.filter((m) => m.status === "pending");
      const susp = memberships.filter((m) => m.status === "suspended" && m.role === "student");
      const [activeClasses, pendingClasses, suspendedClasses] = await Promise.all([
        fetchClassesByIds(active.map((m) => m.class_id)),
        fetchClassesByIds(pend.map((m) => m.class_id)),
        fetchClassesByIds(susp.map((m) => m.class_id)),
      ]);
      setJoined(activeClasses);
      setPending(pendingClasses);
      setSuspended(suspendedClasses);
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
      } else if (r.status === "suspended") {
        toast.error("You are suspended from this class — contact your teacher.");
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

  const leave = async (cls: ClassRow) => {
    const mine = memberRows.find((m) => m.class_id === cls.id && m.user_id === user?.id);
    if (!mine || !user) return;
    try {
      await removeMember(mine.id);
      void logClassAudit(user.id, "class_leave", { class_id: cls.id, class_title: cls.title, member_id: mine.id });
      toast.success(`You left “${cls.title}”`);
      await load();
    } catch (e: any) {
      toast.error(e?.message || "Could not leave the class");
    }
  };

  if (!user) return null;

  return (
    <div className="min-h-screen flex flex-col gradient-hero">
      <Navbar />
      <main className="flex-1 container mx-auto px-4 md:px-6 lg:px-10 py-6 space-y-6 pb-28 md:pb-10 max-w-5xl w-full">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-2">
            <Button variant="ghost" size="icon" onClick={() => goBack("/")} className="rounded-xl shrink-0 mt-0.5" aria-label="Go back">
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div>
              <h1 className="font-display font-bold text-2xl md:text-3xl text-foreground flex items-center gap-2">
                <GraduationCap className="w-7 h-7 text-primary" /> {teacherMode ? "My Classes" : "Classes"}
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                {teacherMode ? "Classes you teach — tap one to open it." : "Your classes, all in one place."}
              </p>
            </div>
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

                {suspended.length > 0 && (
                  <section className="space-y-2.5">
                    <h2 className="font-display font-bold text-base flex items-center gap-1.5"><Ban className="w-4 h-4 text-destructive" /> Suspended</h2>
                    {suspended.map((c) => (
                      <button key={c.id} onClick={() => navigate(`/classes/${c.id}`)}
                        className="w-full text-left rounded-2xl border border-destructive/40 bg-destructive/5 px-4 py-3 flex items-center justify-between gap-2">
                        <span className="min-w-0">
                          <span className="block text-sm font-medium truncate">{c.title}</span>
                          <span className="block text-[11px] text-muted-foreground mt-0.5">You are suspended from this class — contact your teacher.</span>
                        </span>
                        <span className="text-[11px] font-bold text-destructive shrink-0">SUSPENDED</span>
                      </button>
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
                        <div key={c.id} className="space-y-1.5">
                          <ClassCard cls={c} studentCount={counts.get(c.id) ?? 0}
                            avgPct={myAvgs.get(c.id) ?? null} avgLabel="my avg"
                            footerNote={teacherNames.get(c.teacher_id) ? `Teacher: ${teacherNames.get(c.teacher_id)}` : undefined} />
                          <div className="flex justify-end">
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px] text-muted-foreground hover:text-destructive">
                                  <LogOut className="w-3.5 h-3.5 mr-1" /> Leave class
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Leave “{c.title}”?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    You will lose access to this class, its posts, homework and tests. Work you already submitted stays in your teacher's records. You can join again with the class code.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => void leave(c)}>
                                    Leave class
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </div>
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
