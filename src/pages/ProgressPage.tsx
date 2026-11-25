import { useEffect, useMemo, useRef, useState } from "react";
import { TrendingUp, Clock, BookOpen, Plus, Loader2, CalendarPlus, PieChart as PieChartIcon, Cpu, Code2, Sigma, PenLine, Landmark, Atom, FlaskConical, Leaf, Network, Database, AppWindow, Globe, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import PageShell from "@/components/PageShell";
import WeakAreas from "@/components/WeakAreas";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useDepartment } from "@/contexts/DepartmentContext";
import { useCurrentSemester } from "@/hooks/use-current-semester";
import { getSubjects } from "@/data/subjects";
import { toast } from "sonner";
import { motion } from "framer-motion";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface Session {
  id: string;
  subject: string;
  duration_minutes: number;
  studied_at: string;
}

const COLORS = ["#8b5cf6", "#06b6d4", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#3b82f6", "#14b8a6"];

/* Same canonical subject-naming standard as the Planner form. Stored
 * session subjects are user data and are never rewritten — only the
 * labels derived in code (semester subject list) are mapped. */
const CANONICAL_SUBJECT_NAMES: Record<string, string> = {
  "Multivariable Calculus": "Applied Calculus",
  "Communication Skills": "Expository Writing",
};
const canonicalSubject = (name: string): string =>
  CANONICAL_SUBJECT_NAMES[name.trim()] ?? name;

/** Keyword-matched line icon for a subject (mirrors SubjectGrid). */
const getSubjectIcon = (name: string): LucideIcon => {
  const n = name.toLowerCase();
  if (n.includes("logic") || n.includes("digital")) return Cpu;
  if (n.includes("programming") || n.includes("oop") || n.includes("object")) return Code2;
  if (n.includes("calculus") || n.includes("math")) return Sigma;
  if (n.includes("writing") || n.includes("english") || n.includes("composition")) return PenLine;
  if (n.includes("pakistan")) return Landmark;
  if (n.includes("quran") || n.includes("islam")) return BookOpen;
  if (n.includes("physics")) return Atom;
  if (n.includes("chemistry")) return FlaskConical;
  if (n.includes("biolog")) return Leaf;
  if (n.includes("data structure") || n.includes("algorithm")) return Network;
  if (n.includes("database")) return Database;
  if (n.includes("operating")) return AppWindow;
  if (n.includes("network")) return Globe;
  return BookOpen;
};

const ProgressPage = () => {
  const { user } = useAuth();
  const { department } = useDepartment();
  // Shared profile-first semester (was hardcoded to 1, so Progress always
  // opened on Semester 1 while the student's real semester is on profile).
  const { semester, setSemester } = useCurrentSemester();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [subject, setSubject] = useState("");
  const [duration, setDuration] = useState("30");
  const logFormRef = useRef<HTMLDivElement>(null);

  const focusLogForm = () => {
    logFormRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => {
      logFormRef.current?.querySelector<HTMLElement>("button, input")?.focus();
    }, 350);
  };

  const subjects = department ? getSubjects(department, semester) : [];

  useEffect(() => {
    if (!user) return;
    supabase
      .from("study_sessions" as any)
      .select("*")
      .eq("user_id", user.id)
      .order("studied_at", { ascending: false })
      .limit(200)
      .then(({ data }) => {
        setSessions((data as any) || []);
        setLoading(false);
      });
  }, [user]);

  const addSession = async () => {
    if (!user || !subject || !duration) {
      toast.error("Pick a subject and duration");
      return;
    }
    setAdding(true);
    const { data, error } = await supabase
      .from("study_sessions" as any)
      .insert({ user_id: user.id, subject, duration_minutes: parseInt(duration, 10) } as any)
      .select()
      .single();
    setAdding(false);
    if (error) {
      toast.error("Couldn't save session");
      return;
    }
    setSessions((prev) => [data as any, ...prev]);
    toast.success("Session logged!");
    setSubject("");
    setDuration("30");
  };

  // Aggregations
  const last7DaysData = useMemo(() => {
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      d.setHours(0, 0, 0, 0);
      return d;
    });
    return days.map((d) => {
      const next = new Date(d);
      next.setDate(next.getDate() + 1);
      const mins = sessions
        .filter((s) => {
          const t = new Date(s.studied_at);
          return t >= d && t < next;
        })
        .reduce((a, b) => a + b.duration_minutes, 0);
      return {
        day: d.toLocaleDateString(undefined, { weekday: "short" }),
        hours: +(mins / 60).toFixed(1),
      };
    });
  }, [sessions]);

  const bySubject = useMemo(() => {
    const map = new Map<string, number>();
    sessions.forEach((s) => map.set(s.subject, (map.get(s.subject) || 0) + s.duration_minutes));
    return Array.from(map.entries()).map(([name, mins]) => ({ name, value: +(mins / 60).toFixed(1) }));
  }, [sessions]);

  const totalHours = useMemo(
    () => +(sessions.reduce((a, b) => a + b.duration_minutes, 0) / 60).toFixed(1),
    [sessions]
  );
  const weekHours = useMemo(() => last7DaysData.reduce((a, b) => a + b.hours, 0).toFixed(1), [last7DaysData]);
  const weekEmpty = useMemo(() => last7DaysData.every((d) => d.hours === 0), [last7DaysData]);

  // Subject progress %: target 20h per subject (semester goal)
  const subjectProgress = useMemo(() => {
    const target = 20;
    return subjects.map((s) => {
      const hours = (bySubject.find((b) => b.name === s.name)?.value as number) || 0;
      return { ...s, hours, pct: Math.min(100, Math.round((hours / target) * 100)) };
    });
  }, [subjects, bySubject]);

  return (
    <PageShell
      title="Progress Tracker"
      subtitle="Your study analytics & subject completion"
      icon={
        <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
          <TrendingUp className="w-5 h-5 text-primary" />
        </div>
      }
    >
      <div className="space-y-6">
        {/* Stats — three compact cards across on mobile too */}
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <StatCard icon={Clock} label="Total Hours" value={`${totalHours}h`} tile="bg-primary/10 text-primary border-primary/20" />
          <StatCard icon={TrendingUp} label="This Week" value={`${weekHours}h`} tile="bg-blue-500/10 text-blue-400 border-blue-500/20" />
          <StatCard icon={BookOpen} label="Sessions" value={String(sessions.length)} tile="bg-amber-500/10 text-amber-400 border-amber-500/20" />
        </div>

        {/* Log session */}
        <div ref={logFormRef} className="glass rounded-2xl p-4 space-y-3">
          <h3 className="font-display font-semibold text-foreground text-sm">Log a Study Session</h3>
          <div className="flex flex-wrap gap-2 items-end">
            <div className="flex-1 min-w-[140px]">
              <label className="text-xs text-muted-foreground">Semester</label>
              <Select value={String(semester)} onValueChange={(v) => setSemester(Number(v))}>
                <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((s) => (
                    <SelectItem key={s} value={String(s)}>Semester {s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 min-w-[180px]">
              <label className="text-xs text-muted-foreground">Subject</label>
              <Select value={subject} onValueChange={setSubject}>
                <SelectTrigger className="rounded-xl"><SelectValue placeholder="Select subject" /></SelectTrigger>
                <SelectContent>
                  {subjects.map((s) => (
                    <SelectItem key={s.id} value={s.name}>{s.icon} {canonicalSubject(s.name)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-28">
              <label className="text-xs text-muted-foreground">Minutes</label>
              <Input type="number" value={duration} onChange={(e) => setDuration(e.target.value)} className="rounded-xl" />
            </div>
            <Button onClick={addSession} disabled={adding} className="rounded-xl gradient-primary text-primary-foreground gap-2">
              {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Log
            </Button>
          </div>
        </div>

        {/* Weekly chart */}
        <div className="glass rounded-2xl p-4">
          <h3 className="font-display font-semibold text-foreground text-sm mb-3">Last 7 Days (hours)</h3>
          <div className="relative h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={last7DaysData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="day" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                <Bar dataKey="hours" fill="hsl(var(--primary))" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            {weekEmpty && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center px-4">
                <span className="w-11 h-11 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center">
                  <CalendarPlus className="w-5 h-5 text-primary" />
                </span>
                <p className="text-sm font-medium text-foreground">No sessions logged this week yet</p>
                <button
                  onClick={focusLogForm}
                  className="text-xs font-semibold text-primary hover:underline underline-offset-2"
                >
                  Log your first session
                </button>
              </div>
            )}
          </div>
        </div>

        {/* By subject + Subject progress bars */}
        <div className="grid md:grid-cols-2 gap-4">
          <div className="glass rounded-2xl p-4">
            <h3 className="font-display font-semibold text-foreground text-sm mb-3">Hours by Subject</h3>
            {bySubject.length === 0 ? (
              <div className="rounded-xl border border-dashed border-primary/25 bg-primary/5 px-4 py-8 flex flex-col items-center justify-center gap-2 text-center">
                <span className="w-11 h-11 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center">
                  <PieChartIcon className="w-5 h-5 text-primary" />
                </span>
                <p className="text-xs text-muted-foreground">Log a session to see breakdown</p>
              </div>
            ) : (
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={bySubject} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label={(e) => `${e.name}`}>
                      {bySubject.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
          <div className="glass rounded-2xl p-4">
            <h3 className="font-display font-semibold text-foreground text-sm mb-3">Semester {semester} Completion</h3>
            <div className="space-y-3 max-h-56 overflow-y-auto pr-1">
              {subjectProgress.map((s) => {
                const SubIcon = getSubjectIcon(s.name);
                return (
                  <div key={s.id} className="space-y-1">
                    <div className="flex justify-between items-center text-xs gap-2">
                      <span className="text-foreground truncate flex items-center gap-1.5 min-w-0">
                        <span className="w-5 h-5 rounded-md bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
                          <SubIcon className="w-3 h-3 text-primary" />
                        </span>
                        {canonicalSubject(s.name)}
                      </span>
                      <span className="text-muted-foreground flex-shrink-0">{s.hours}h / 20h</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted/50 overflow-hidden">
                      <motion.div initial={{ width: 0 }} animate={{ width: `${s.pct}%` }} transition={{ duration: 0.8 }} className="h-full gradient-primary" />
                    </div>
                  </div>
                );
              })}
              {subjectProgress.length === 0 && <p className="text-xs text-muted-foreground">No subjects</p>}
            </div>
          </div>
        </div>

        {/* Weak areas from quiz history */}
        <WeakAreas />

        {loading && <p className="text-center text-xs text-muted-foreground">Loading...</p>}
      </div>
    </PageShell>
  );
};

const StatCard = ({ icon: Icon, label, value, tile }: any) => (
  <div className="glass rounded-2xl p-3 sm:p-4 min-w-0">
    <div className={`w-8 h-8 sm:w-9 sm:h-9 rounded-xl border ${tile} flex items-center justify-center mb-2`}>
      <Icon className="w-4 h-4" />
    </div>
    <p className="text-xl sm:text-2xl font-display font-bold text-foreground truncate">{value}</p>
    <p className="text-[11px] sm:text-xs text-muted-foreground truncate">{label}</p>
  </div>
);

export default ProgressPage;
