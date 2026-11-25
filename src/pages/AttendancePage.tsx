import { useState, useEffect, useMemo } from "react";
import {
  CalendarCheck, AlertTriangle, CheckCircle, XCircle, MinusCircle, TrendingUp, TrendingDown,
  Calculator, Calendar, ChevronRight, Target, Code2, Monitor, Sigma, Atom, PenLine,
  Network, BookOpen, GraduationCap, type LucideIcon,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { useAuth } from "@/contexts/AuthContext";
import { useMySubjects } from "@/hooks/use-my-subjects";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import PageShell from "@/components/PageShell";

type Status = "present" | "absent" | "leave";

interface AttendanceRecord {
  id: string;
  subject: string;
  date: string;
  status: Status;
}

// The app's one required threshold — used everywhere in this UI.
const MIN_ATTENDANCE = 75;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11-24" → "24 Nov 2026" */
const fmtDate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${MONTHS[m - 1]} ${y}`;
};

// Line icon per subject (replaces the emoji stored in subject data).
const subjectIcon = (name: string): LucideIcon => {
  const n = name.toLowerCase();
  if (n.includes("programming") || n.includes("oop") || n.includes("object-oriented")) return Code2;
  if (n.includes("ict") || n.includes("computer")) return Monitor;
  if (n.includes("calculus") || n.includes("algebra") || n.includes("math")) return Sigma;
  if (n.includes("physics")) return Atom;
  if (n.includes("english") || n.includes("writing") || n.includes("composition") || n.includes("communication")) return PenLine;
  if (n.includes("discrete") || n.includes("logic") || n.includes("digital")) return Network;
  if (n.includes("islamic") || n.includes("quran") || n.includes("studies")) return BookOpen;
  return GraduationCap;
};

// ── Circular Progress Component ──
// The track is a visible plum ring (primary at low opacity) so a 0%
// ring still reads as a ring; figures below the threshold are muted
// neutral, never alarm-red.
const CircularProgress = ({ percentage, size = 80, strokeWidth = 7 }: { percentage: number; size?: number; strokeWidth?: number }) => {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.min(percentage, 100) / 100) * circumference;
  const met = percentage >= MIN_ATTENDANCE;

  return (
    <div className="relative flex items-center justify-center shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" strokeWidth={strokeWidth} className="text-primary/20" />
        <circle
          cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" strokeWidth={strokeWidth}
          strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
          className={`${met ? "text-primary" : "text-primary/40"} transition-all duration-700 ease-out`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`font-bold font-display ${size >= 64 ? "text-lg" : "text-[11px]"} ${met ? "text-foreground" : "text-muted-foreground"}`}>{percentage}%</span>
      </div>
    </div>
  );
};

// ── Bunk Calculator Logic ──
function calcBunkable(present: number, total: number): number {
  // How many more classes can I miss and stay >= MIN_ATTENDANCE%?
  if (total === 0) return 0;
  const maxBunks = Math.floor(present / (MIN_ATTENDANCE / 100)) - total;
  return Math.max(0, maxBunks);
}

function calcToReach(present: number, total: number, target: number): number {
  // How many consecutive classes to attend to reach target%?
  if (total === 0) return 0;
  const current = (present / total) * 100;
  if (current >= target) return 0;
  const needed = Math.ceil((target * total - 100 * present) / (100 - target));
  return Math.max(0, needed);
}

// ── 14-Day Calendar Strip — numbered day tiles, today highlighted ──
const CalendarStrip = ({ records, subject }: { records: AttendanceRecord[]; subject: string }) => {
  const days = useMemo(() => {
    const arr = [];
    const today = new Date();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split("T")[0];
      const rec = records.find(r => r.subject === subject && r.date === dateStr);
      arr.push({ date: d, dateStr, status: rec?.status || null, isToday: i === 0 });
    }
    return arr;
  }, [records, subject]);

  const dayLabels = ["S", "M", "T", "W", "T", "F", "S"];
  const rangeLabel = days.length
    ? `${fmtDate(days[0].dateStr)} – ${fmtDate(days[days.length - 1].dateStr)}`
    : "";

  return (
    <div className="space-y-1.5">
      <p className="text-[10px] text-muted-foreground">{rangeLabel}</p>
      <div className="grid grid-cols-7 gap-1.5">
        {days.map(({ date, dateStr, status, isToday }) => (
          <div
            key={dateStr}
            title={`${fmtDate(dateStr)}: ${status || "no record"}`}
            className={`rounded-lg border px-1 py-1.5 text-center ${
              isToday ? "border-primary/60 bg-primary/10" : "border-border/60 bg-muted/20"
            }`}
          >
            <p className="text-[8px] uppercase tracking-wide text-muted-foreground">{dayLabels[date.getDay()]}</p>
            <p className={`text-xs font-semibold leading-tight ${isToday ? "text-primary" : "text-foreground"}`}>{date.getDate()}</p>
            <span
              className={`mx-auto mt-1 block w-1.5 h-1.5 rounded-full ${
                status === "present"
                  ? "bg-primary"
                  : status === "absent"
                    ? "bg-rose-400"
                    : status === "leave"
                      ? "bg-amber-400"
                      : "bg-transparent"
              }`}
            />
          </div>
        ))}
      </div>
    </div>
  );
};

const AttendancePage = () => {
  const { user } = useAuth();
  const [semester, setSemester] = useState(1);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [loading, setLoading] = useState(false);
  const [expandedSubject, setExpandedSubject] = useState<string | null>(null);

  const { subjects } = useMySubjects(semester);

  useEffect(() => {
    if (user) fetchRecords();
  }, [user, semester]);

  const fetchRecords = async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase
      .from("attendance")
      .select("*")
      .eq("user_id", user.id)
      .eq("semester", semester)
      .order("date", { ascending: false });
    setRecords((data as AttendanceRecord[]) || []);
    setLoading(false);
  };

  const markAttendance = async (subject: string, status: Status) => {
    if (!user) { toast.error("Sign in to track attendance"); return; }
    try {
      const { error } = await supabase.from("attendance").upsert(
        { user_id: user.id, subject, semester, date: selectedDate, status },
        { onConflict: "user_id,subject,date" }
      );
      if (error) throw error;
      toast.success(`${subject}: ${status}`);
      fetchRecords();
    } catch (e: any) {
      toast.error(e.message || "Failed to save");
    }
  };

  const getStats = (subjectName: string) => {
    const subRecords = records.filter(r => r.subject === subjectName);
    const total = subRecords.length;
    const present = subRecords.filter(r => r.status === "present").length;
    const absent = subRecords.filter(r => r.status === "absent").length;
    const leaves = subRecords.filter(r => r.status === "leave").length;
    const percentage = total > 0 ? Math.round((present / total) * 100) : 0;
    const bunkable = calcBunkable(present, total);
    const toReach = calcToReach(present, total, MIN_ATTENDANCE);
    return { total, present, absent, leaves, percentage, bunkable, toReach };
  };

  const getTodayStatus = (subjectName: string): Status | null => {
    const rec = records.find(r => r.subject === subjectName && r.date === selectedDate);
    return rec?.status || null;
  };

  // Overall stats
  const overallStats = useMemo(() => {
    if (subjects.length === 0) return { totalClasses: 0, totalPresent: 0, overallPct: 0, lowCount: 0 };
    let totalClasses = 0, totalPresent = 0, lowCount = 0;
    subjects.forEach(sub => {
      const s = getStats(sub.name);
      totalClasses += s.total;
      totalPresent += s.present;
      if (s.total >= 3 && s.percentage < MIN_ATTENDANCE) lowCount++;
    });
    const overallPct = totalClasses > 0 ? Math.round((totalPresent / totalClasses) * 100) : 0;
    return { totalClasses, totalPresent, overallPct, lowCount };
  }, [records, subjects]);

  const nothingMarked = records.length === 0;

  if (!user) {
    return (
      <PageShell
        title="Attendance Tracker"
        subtitle="Smart Bunk Calculator & 75% Monitor"
        icon={<div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center"><CalendarCheck className="w-5 h-5 text-primary" /></div>}
      >
        <div className="glass rounded-2xl p-8 text-center space-y-4">
          <CalendarCheck className="w-12 h-12 text-muted-foreground/30 mx-auto" />
          <p className="text-foreground font-display font-semibold">Sign in to track your attendance</p>
          <p className="text-sm text-muted-foreground">Your attendance data will be saved securely.</p>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Attendance Tracker"
      subtitle="Smart Bunk Calculator & 75% Monitor"
      icon={<div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center"><CalendarCheck className="w-5 h-5 text-primary" /></div>}
    >
      <div className="space-y-5 pb-6">
        {/* Overall Summary Bar */}
        <div className="glass rounded-2xl p-4 flex flex-wrap items-center gap-5">
          <CircularProgress percentage={overallStats.overallPct} size={70} strokeWidth={6} />
          <div className="flex-1 min-w-[200px]">
            <h3 className="font-display font-bold text-foreground text-lg">Overall Attendance</h3>
            <p className="text-sm text-muted-foreground">
              {`${overallStats.totalPresent}/${overallStats.totalClasses} classes attended`}
            </p>
            {nothingMarked && (
              <p className="text-xs text-muted-foreground mt-1">
                No classes marked yet. Mark your first class below to start tracking.
              </p>
            )}
          </div>
          <div className="flex items-center gap-4 text-center">
            <div>
              <p className="text-2xl font-bold font-display text-foreground">{subjects.length}</p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Subjects</p>
            </div>
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20">
              <Target className="w-3.5 h-3.5 text-primary" />
              <span className="text-xs text-primary font-medium">Min Required: {MIN_ATTENDANCE}%</span>
            </span>
            {overallStats.lowCount > 0 && (
              <div>
                <p className="text-2xl font-bold font-display text-amber-500 dark:text-amber-400">{overallStats.lowCount}</p>
                <p className="text-[10px] text-amber-500 dark:text-amber-400 uppercase tracking-wider">Low (&lt;{MIN_ATTENDANCE}%)</p>
              </div>
            )}
          </div>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap gap-3 items-end">
          <div className="space-y-1">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Semester</label>
            <Select value={String(semester)} onValueChange={v => setSemester(Number(v))}>
              <SelectTrigger className="rounded-xl w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 4, 5, 6, 7, 8].map(s => <SelectItem key={s} value={String(s)}>Semester {s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Date</label>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={selectedDate}
                onChange={e => setSelectedDate(e.target.value)}
                className="glass rounded-xl px-3 py-2 text-sm text-foreground outline-none"
              />
              <span className="text-xs text-muted-foreground whitespace-nowrap">{fmtDate(selectedDate)}</span>
            </div>
          </div>
        </div>

        {/* Subject list — compact rows in one card. The per-subject
            Present / Absent / Leave marking controls stay functional as
            a compact strip inside each row (the design mockup hid them;
            removing working controls was not authorised). */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Subjects</p>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
              {subjects.length} subject{subjects.length === 1 ? "" : "s"}
            </span>
            {loading && <span className="text-[11px] text-muted-foreground">Loading…</span>}
          </div>

          <div className="glass rounded-2xl border border-border overflow-hidden divide-y divide-border/50">
            {subjects.map((sub, idx) => {
              const stats = getStats(sub.name);
              const todayStatus = getTodayStatus(sub.name);
              const isLow = stats.total >= 3 && stats.percentage < MIN_ATTENDANCE;
              const isExpanded = expandedSubject === sub.name;
              const Icon = subjectIcon(sub.name);

              return (
                <motion.div
                  key={sub.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.04 }}
                  className="p-3.5 sm:p-4"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                      <Icon className="w-5 h-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-display font-semibold text-foreground text-sm truncate">{sub.name}</h4>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                        <span className="px-1.5 py-0.5 rounded-md bg-primary/10 text-primary font-medium">{stats.present}P</span>
                        <span className="px-1.5 py-0.5 rounded-md bg-rose-500/10 text-rose-500 dark:text-rose-400 font-medium">{stats.absent}A</span>
                        <span className="px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400 font-medium">{stats.leaves}L</span>
                        <span className="text-muted-foreground">= {stats.total} total</span>
                        {isLow && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-600 dark:text-amber-400 bg-amber-500/10 rounded-full px-2 py-0.5 uppercase tracking-wider">
                            <AlertTriangle className="w-2.5 h-2.5" />
                            Short Attendance
                          </span>
                        )}
                      </div>
                    </div>
                    <CircularProgress percentage={stats.percentage} size={46} strokeWidth={4} />
                  </div>

                  {/* Marking controls — compact strip, marking for the
                      date selected above */}
                  <div className="mt-3 flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground whitespace-nowrap hidden sm:inline">
                      {fmtDate(selectedDate)}:
                    </span>
                    {(["present", "absent", "leave"] as Status[]).map(status => {
                      const isActive = todayStatus === status;
                      const StatusIcon = status === "present" ? CheckCircle : status === "absent" ? XCircle : MinusCircle;
                      const activeColors = status === "present"
                        ? "bg-primary/15 text-primary border-primary/40"
                        : status === "absent"
                          ? "bg-rose-500/10 text-rose-500 dark:text-rose-400 border-rose-500/30"
                          : "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30";

                      return (
                        <button
                          key={status}
                          onClick={() => markAttendance(sub.name, status)}
                          className={`flex-1 rounded-lg py-1.5 px-2 text-[11px] font-medium border transition-all flex items-center justify-center gap-1 ${isActive ? activeColors : "border-border/50 text-muted-foreground hover:border-primary/30 hover:text-foreground"}`}
                        >
                          <StatusIcon className="w-3 h-3" />
                          {status.charAt(0).toUpperCase() + status.slice(1)}
                        </button>
                      );
                    })}
                    <button
                      onClick={() => setExpandedSubject(isExpanded ? null : sub.name)}
                      aria-label="Bunk Calculator and history"
                      className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground transition-colors shrink-0"
                    >
                      <ChevronRight className={`w-4 h-4 transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                    </button>
                  </div>

                  {/* Bunk Calculator & History */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="space-y-3 pt-3">
                          <p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                            <Calculator className="w-3.5 h-3.5 text-primary" />
                            Bunk Calculator &amp; History
                          </p>
                          {/* One threshold (MIN_ATTENDANCE) in both tiles */}
                          <div className="grid grid-cols-2 gap-2">
                            <div className="rounded-xl bg-primary/10 border border-primary/15 p-2.5 text-center">
                              <TrendingDown className="w-4 h-4 text-primary mx-auto mb-1" />
                              <p className="text-lg font-bold font-display text-foreground">{stats.bunkable}</p>
                              <p className="text-[9px] text-muted-foreground leading-tight">
                                classes you can still miss while staying at {MIN_ATTENDANCE}%
                              </p>
                            </div>
                            <div className="rounded-xl bg-primary/10 border border-primary/15 p-2.5 text-center">
                              <TrendingUp className="w-4 h-4 text-primary mx-auto mb-1" />
                              <p className="text-lg font-bold font-display text-foreground">
                                {stats.total > 0 && stats.percentage >= MIN_ATTENDANCE ? "✓" : stats.toReach}
                              </p>
                              <p className="text-[9px] text-muted-foreground leading-tight">
                                {stats.total > 0 && stats.percentage >= MIN_ATTENDANCE
                                  ? `already at ${MIN_ATTENDANCE}%+`
                                  : `classes to attend to reach ${MIN_ATTENDANCE}%`}
                              </p>
                            </div>
                          </div>

                          {stats.percentage < MIN_ATTENDANCE && stats.total > 0 && (
                            <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 p-2.5 text-center flex items-center justify-center gap-1.5">
                              <AlertTriangle className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400 shrink-0" />
                              <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                                Attend next <span className="font-bold">{stats.toReach}</span> classes consecutively to reach {MIN_ATTENDANCE}%
                              </p>
                            </div>
                          )}

                          {/* Last 14 Days */}
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                              <Calendar className="w-3 h-3" />
                              Last 14 Days
                            </div>
                            <CalendarStrip records={records} subject={sub.name} />
                            <div className="flex gap-3 justify-center mt-1">
                              <span className="flex items-center gap-1 text-[8px] text-muted-foreground">
                                <span className="w-2 h-2 rounded-full bg-primary inline-block" /> Present
                              </span>
                              <span className="flex items-center gap-1 text-[8px] text-muted-foreground">
                                <span className="w-2 h-2 rounded-full bg-rose-400 inline-block" /> Absent
                              </span>
                              <span className="flex items-center gap-1 text-[8px] text-muted-foreground">
                                <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /> Leave
                              </span>
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </div>
        </div>
      </div>
    </PageShell>
  );
};

export default AttendancePage;
