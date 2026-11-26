import { useState, useEffect, useRef } from "react";
import { fetchWithRetry } from "@/lib/fetch-with-retry";
import { authHeader } from "@/lib/auth-header";
import { parseAiTaskText, buildDeterministicTasks, type DailyTaskDraft } from "@/lib/planner-tasks";
import { CalendarDays, Sparkles, Loader2, RefreshCw, Save, Clock, Trash2, FolderOpen, Plus, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import { useMySubjects } from "@/hooks/use-my-subjects";
import { supabase } from "@/integrations/supabase/client";
import PageShell from "@/components/PageShell";
import MarkdownMessage from "@/components/MarkdownMessage";
import ThinkingAnimation from "@/components/ThinkingAnimation";
import { toast } from "sonner";
import { format } from "date-fns";

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`;

/* One subject-naming standard everywhere (the plan form's canonical
 * names). The old names still live in src/data/subjects.ts defaults
 * and in stored user data — stored data is never rewritten; labels
 * derived in code (form, prompts, task rows) are mapped at the source. */
const CANONICAL_SUBJECT_NAMES: Record<string, string> = {
  "Multivariable Calculus": "Applied Calculus",
  "Communication Skills": "Expository Writing",
};
const canonicalSubject = (name?: string | null): string =>
  name ? (CANONICAL_SUBJECT_NAMES[name.trim()] ?? name) : "";

/** "2026-11-23" / ISO timestamp -> "23 Nov 2026" */
const fmtDate = (value?: string | null): string => {
  if (!value) return "";
  const d = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  return Number.isNaN(d.getTime()) ? value : format(d, "d MMM yyyy");
};
/** "2026-11-24" -> "Tue, 24 Nov 2026" */
const fmtDayHeading = (dateStr: string): string => {
  const d = new Date(`${dateStr}T12:00:00`);
  return Number.isNaN(d.getTime()) ? dateStr : format(d, "EEE, d MMM yyyy");
};

// Asia/Karachi date helpers for Daily Tasks (YYYY-MM-DD strings).
const pktTodayStr = (): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const addDaysStr = (dateStr: string, n: number): string => {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const PlannerPage = () => {
  const { user } = useAuth();
  const [semester, setSemester] = useState(1);
  // True once the user (or a loaded plan) has chosen subjects manually —
  // stops the auto-select effect from overriding their picks.
  const selectionTouchedRef = useRef(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [weeklyHours, setWeeklyHours] = useState(14);
  const [examDate, setExamDate] = useState("");
  const [schedule, setSchedule] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedPlans, setSavedPlans] = useState<any[]>([]);
  // Daily Tasks (plan_tasks)
  const [currentPlanId, setCurrentPlanId] = useState<string | null>(null);
  const [planTasks, setPlanTasks] = useState<any[]>([]);
  const [taskDate, setTaskDate] = useState(pktTodayStr());
  const [taskSubject, setTaskSubject] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [addingTask, setAddingTask] = useState(false);
  const [breakingWeek, setBreakingWeek] = useState(false);

  const loadSavedPlans = async () => {
    if (!user) return;
    const { data, error } = await supabase.from("study_plans" as any)
      .select("*").eq("user_id", user.id).order("created_at", { ascending: false });
    if (error) { console.error("[Planner] Saved plans load error:", error); return; }
    setSavedPlans((data as any[]) || []);
  };

  const loadPlanTasks = async () => {
    if (!user) return;
    const endStr = addDaysStr(pktTodayStr(), 7);
    const { data, error } = await supabase.from("plan_tasks" as any)
      .select("*").eq("user_id", user.id).lte("task_date", endStr)
      .order("task_date", { ascending: true }).order("created_at", { ascending: true });
    if (error) { console.error("[Planner] Daily tasks load error:", error); return; }
    setPlanTasks((data as any[]) || []);
  };

  const toggleTask = async (t: any) => {
    const { error } = await supabase.from("plan_tasks" as any)
      .update({ done: !t.done } as any).eq("id", t.id);
    if (error) { toast.error(`Couldn't update task: ${error.message}`); return; }
    setPlanTasks((prev) => prev.map((x) => (x.id === t.id ? { ...x, done: !x.done } : x)));
  };

  const deleteTask = async (id: string) => {
    const { error } = await supabase.from("plan_tasks" as any).delete().eq("id", id);
    if (error) { toast.error(`Couldn't delete task: ${error.message}`); return; }
    toast.success("Task deleted");
    setPlanTasks((prev) => prev.filter((x) => x.id !== id));
  };

  const addTask = async () => {
    if (!user) return;
    if (!taskTitle.trim()) { toast.error("Add a task title"); return; }
    if (!taskDate) { toast.error("Pick a date"); return; }
    setAddingTask(true);
    const { error } = await supabase.from("plan_tasks" as any).insert({
      user_id: user.id, plan_id: currentPlanId, task_date: taskDate,
      subject: taskSubject.trim() || null, title: taskTitle.trim(), done: false,
    } as any);
    setAddingTask(false);
    if (error) { toast.error(`Couldn't add task: ${error.message}`); return; }
    toast.success("Task added");
    setTaskTitle("");
    loadPlanTasks();
  };

  const breakIntoDailyTasks = async () => {
    if (!user) return;
    // D-6: the button used to dead-end on return visits when no plan
    // had been generated/loaded in THIS session, even though the
    // student's subjects (and their earlier tasks) were right there.
    // A saved plan is auto-loaded on mount; when there is still no
    // schedule text, synthesize a weekday split from the selected
    // subjects so the same AI/fallback pipeline can run.
    let effectiveSchedule = schedule;
    if (!effectiveSchedule) {
      if (!selected.length) {
        toast.error("Pick your subjects or generate a weekly plan first");
        return;
      }
      const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
      effectiveSchedule = selected
        .map((s, i) => `${days[i % days.length]}: ${canonicalSubject(s)}`)
        .join("\n");
    }
    setBreakingWeek(true);
    const todayStr = pktTodayStr();
    const endStr = addDaysStr(todayStr, 6);
    try {
      // Primary path: ask the AI to split the week. If the AI pool is
      // unavailable (503) or its answer cannot be parsed, fall back to a
      // deterministic distribution of the weekly schedule so the button
      // never dead-ends (Bug #2 fix, 2026-11-25).
      let drafts: DailyTaskDraft[] = [];
      try {
        const auth = await authHeader();
        const resp = await fetchWithRetry(CHAT_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: auth },
          body: JSON.stringify({
            messages: [
              {
                role: "system",
                content: `You break a weekly study timetable into daily tasks. Respond with ONLY a JSON array (no markdown, no code fences, no extra text). Each item: {"date": "YYYY-MM-DD", "subject": string, "title": string}. Every date must be between ${todayStr} and ${endStr} inclusive. Create 1-3 short, concrete tasks per day.`,
              },
              {
                role: "user",
                content: `Today is ${todayStr}. Subjects: ${selected.map((s) => canonicalSubject(s)).join(", ") || "general study"}.\n\nWeekly schedule:\n${effectiveSchedule}\n\nBreak this week into daily tasks for ${todayStr} to ${endStr}.`,
              },
            ],
          }),
        });
        if (resp.status === 401) { toast.error("Session expired — please sign in again"); return; }
        if (resp.status === 429) { toast.error("Rate limited, try again shortly"); return; }
        if (resp.ok) {
          // Same streaming (SSE) response shape as generatePlan — collect full text.
          let text = "";
          const contentType = resp.headers.get("content-type") || "";
          if (resp.body && contentType.includes("text/event-stream")) {
            const reader = resp.body.getReader();
            const decoder = new TextDecoder();
            let buf = "";
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buf += decoder.decode(value, { stream: true });
              let nl: number;
              while ((nl = buf.indexOf("\n")) !== -1) {
                let line = buf.slice(0, nl);
                buf = buf.slice(nl + 1);
                if (line.endsWith("\r")) line = line.slice(0, -1);
                if (!line.startsWith("data: ")) continue;
                const json = line.slice(6).trim();
                if (json === "[DONE]") break;
                try {
                  const c = JSON.parse(json).choices?.[0]?.delta?.content;
                  if (c) text += c;
                } catch { /* skip malformed SSE chunk */ }
              }
            }
          } else {
            text = await resp.text();
          }
          drafts = parseAiTaskText(text, todayStr, endStr, canonicalSubject);
        }
      } catch (aiErr) {
        console.warn("[Planner] AI break-down unavailable, using deterministic fallback:", aiErr);
      }
      const usedFallback = drafts.length === 0;
      if (usedFallback) {
        drafts = buildDeterministicTasks(effectiveSchedule, selected, todayStr, canonicalSubject);
      }
      if (!drafts.length) { toast.error("Couldn't create tasks — pick subjects or generate a weekly plan first"); return; }
      const rows = drafts.map((d) => ({
        user_id: user.id, plan_id: currentPlanId, task_date: d.date,
        subject: d.subject, title: d.title, done: false,
      }));
      const { error } = await supabase.from("plan_tasks" as any).insert(rows as any);
      if (error) { toast.error(`Couldn't save tasks: ${error.message}`); return; }
      toast.success(usedFallback ? `${rows.length} daily tasks created from your weekly schedule` : `${rows.length} daily tasks created`);
      loadPlanTasks();
    } catch (e: any) {
      console.error("[Planner] Break-week exception:", e);
      toast.error(e.message || "Failed to break week into tasks");
    } finally {
      setBreakingWeek(false);
    }
  };

  const loadPlan = (p: any) => {
    selectionTouchedRef.current = true;
    setCurrentPlanId(p.id || null);
    setSemester(p.semester);
    setSelected(p.subjects || []);
    setWeeklyHours(p.weekly_hours || 14);
    setExamDate(p.exam_date || "");
    setSchedule(p.schedule || "");
    toast.success("Plan loaded");
  };

  const deletePlan = async (id: string) => {
    const { error } = await supabase.from("study_plans" as any).delete().eq("id", id);
    if (error) { toast.error(`Couldn't delete plan: ${error.message}`); return; }
    toast.success("Plan deleted");
    loadSavedPlans();
  };

  useEffect(() => {
    if (!user) return;
    supabase.from("profiles").select("current_semester").eq("user_id", user.id).single()
      .then(({ data }) => {
        if ((data as any)?.current_semester) setSemester((data as any).current_semester);
      });
    supabase.from("study_plans" as any).select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(1).maybeSingle()
      .then(({ data, error }) => {
        if (error) { console.error("[Planner] Load error:", error); return; }
        const p: any = data;
        if (p) {
          console.log("[Planner] Loaded saved plan from database");
          selectionTouchedRef.current = true;
          setCurrentPlanId(p.id || null);
          setSemester(p.semester);
          setSelected(p.subjects || []);
          setWeeklyHours(p.weekly_hours || 14);
          setExamDate(p.exam_date || "");
          setSchedule(p.schedule || "");
        }
      });
    loadSavedPlans();
    loadPlanTasks();
  }, [user]);

  const { subjects, resolved } = useMySubjects(semester);

  // Auto-select all of the semester's subjects until the user picks their
  // own. Re-runs when the student's custom list resolves, so a customised
  // semester pre-selects the custom subjects rather than stale defaults.
  useEffect(() => {
    if (resolved && subjects.length && !selectionTouchedRef.current) {
      setSelected(subjects.map((s) => s.name));
    }
     
  }, [semester, resolved, subjects]);

  const toggle = (name: string) => {
    selectionTouchedRef.current = true;
    setSelected((p) => (p.includes(name) ? p.filter((x) => x !== name) : [...p, name]));
  };

  const generatePlan = async () => {
    if (!selected.length) {
      toast.error("Pick at least one subject");
      return;
    }
    setLoading(true);
    setSchedule("");

    const examInfo = examDate
      ? `\n\nExam date: ${examDate} (${Math.ceil((new Date(examDate).getTime() - Date.now()) / 86400000)} days away). Prioritize topics for highest weightage subjects.`
      : "";

    const subjectList = subjects
      .filter((s) => selected.includes(s.name))
      .map((s) => `${s.icon} ${canonicalSubject(s.name)}${s.hasLab ? " (has Lab)" : ""}`)
      .join("\n");

    try {
      console.log("[Planner] AI request start", { semester, subjects: selected, weeklyHours, examDate });
      const auth = await authHeader();
      const resp = await fetchWithRetry(CHAT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: auth },
        body: JSON.stringify({
          messages: [
            {
              role: "system",
              content: `You are an academic study planner for Pakistani university students.
Create a detailed 7-day timetable (Mon–Sun) in markdown tables. Use all ${weeklyHours} hours/week.
Distribute time fairly with extra slots for lab subjects. Include morning, afternoon, evening blocks, revision and a weekend review. Add emojis and 2 motivational tips.`,
            },
            {
              role: "user",
              content: `Semester ${semester}. Weekly capacity: ${weeklyHours} hours.\nSubjects:\n${subjectList}${examInfo}\n\nMake it practical and balanced.`,
            },
          ],
        }),
      });

      console.log("[Planner] AI response received", { status: resp.status, tier: resp.headers.get("x-ai-tier") });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => "");
        console.error("[Planner] AI error", resp.status, errText);
        if (resp.status === 401) toast.error("Session expired — please sign in again");
        else if (resp.status === 429) toast.error("Rate limited, try again shortly");
        else if (resp.status === 402) toast.error("AI credits exhausted");
        else toast.error(`Generation failed (${resp.status})`);
        return;
      }

      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "", text = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) !== -1) {
          let line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (!line.startsWith("data: ")) continue;
          const json = line.slice(6).trim();
          if (json === "[DONE]") break;
          try {
            const c = JSON.parse(json).choices?.[0]?.delta?.content;
            if (c) { text += c; setSchedule(text); }
          } catch { /* skip malformed SSE chunk */ }
        }
      }
      console.log("[Planner] Stream complete, chars:", text.length);
      if (!text.trim()) toast.error("Empty response — please retry");
    } catch (e: any) {
      console.error("[Planner] Generation exception:", e);
      toast.error(e.message || "Failed to generate plan");
    } finally {
      setLoading(false);
    }
  };

  const savePlan = async () => {
    if (!user || !schedule) return;
    setSaving(true);
    console.log("[Planner] Save to database start");
    const { data: savedRow, error } = await supabase.from("study_plans" as any).insert({
      user_id: user.id, semester, subjects: selected,
      exam_date: examDate || null, weekly_hours: weeklyHours, schedule,
    } as any).select("id").single();
    setSaving(false);
    if (error) {
      console.error("[Planner] Save error:", error);
      toast.error(`Couldn't save plan: ${error.message}`);
      return;
    }
    if ((savedRow as any)?.id) setCurrentPlanId((savedRow as any).id);
    console.log("[Planner] Save success");
    toast.success("Plan saved!");
    loadSavedPlans();
  };

  // Daily Tasks: visible = today..today+7, plus overdue pending (highlighted).
  const todayStr = pktTodayStr();
  const visibleTasks = planTasks.filter((t) => !(String(t.task_date) < todayStr && t.done));
  const groupedTasks: { date: string; tasks: any[] }[] = [];
  for (const t of visibleTasks) {
    const key = String(t.task_date);
    let g = groupedTasks.find((x) => x.date === key);
    if (!g) { g = { date: key, tasks: [] }; groupedTasks.push(g); }
    g.tasks.push(t);
  }
  groupedTasks.sort((a, b) => (a.date < b.date ? -1 : 1));
  const subjectOptions = Array.from(new Set([...(selected || []), ...subjects.map((s) => s.name)].map((s) => canonicalSubject(s))));

  return (
    <PageShell
      title="AI Study Planner"
      subtitle="Smart weekly schedule built around your exams"
      icon={
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-500 flex items-center justify-center">
          <CalendarDays className="w-5 h-5 text-primary-foreground" />
        </div>
      }
    >
      <div className="space-y-6">
        {/* Controls */}
        <div className="glass rounded-2xl p-4 space-y-4">
          <div className="grid sm:grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Semester</label>
              <Select value={String(semester)} onValueChange={(v) => { selectionTouchedRef.current = false; setSemester(Number(v)); setSelected([]); }}>
                <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((s) => (
                    <SelectItem key={s} value={String(s)}>Semester {s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="w-3 h-3" /> Weekly Study Hours</label>
              <Input type="number" min={1} max={80} value={weeklyHours} onChange={(e) => setWeeklyHours(Number(e.target.value) || 14)} className="rounded-xl" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Exam Date (optional)</label>
              <Input type="date" value={examDate} onChange={(e) => setExamDate(e.target.value)} className="rounded-xl" />
            </div>
          </div>

          {/* Subject selector */}
          <div>
            <label className="text-xs text-muted-foreground">Subjects ({selected.length}/{subjects.length})</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
              {subjects.map((s) => {
                const isSelected = selected.includes(s.name);
                return (
                  <label
                    key={s.id}
                    className={`flex items-center gap-2 glass rounded-xl px-3 py-2 cursor-pointer transition-colors ${
                      isSelected ? "border-primary/50 bg-primary/10" : "hover:bg-muted/30"
                    }`}
                  >
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => toggle(s.name)}
                      className="h-5 w-5 rounded-md border-2 border-primary/60 data-[state=checked]:bg-primary data-[state=checked]:border-primary data-[state=checked]:text-primary-foreground [&_svg]:h-4 [&_svg]:w-4 [&_svg]:stroke-[3]"
                    />
                    <span className="text-sm text-foreground">{s.icon} {canonicalSubject(s.name)}</span>
                    {s.hasLab && <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary">Lab</span>}
                  </label>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={generatePlan} disabled={loading} className="rounded-xl gap-2 gradient-primary text-primary-foreground">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {loading ? "Generating..." : "Generate Weekly Plan"}
            </Button>
            {schedule && !loading && (
              <>
                <Button onClick={generatePlan} variant="outline" className="rounded-xl gap-2">
                  <RefreshCw className="w-4 h-4" /> Regenerate
                </Button>
                <Button onClick={savePlan} disabled={saving} variant="outline" className="rounded-xl gap-2">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Save Plan
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Saved plans — list with load + delete (previously saved plans
            persisted but there was no way to see or remove them) */}
        {savedPlans.length > 0 && (
          <div className="glass rounded-2xl p-4 space-y-2">
            <p className="text-sm font-display font-semibold text-foreground">Saved Plans</p>
            {savedPlans.map((p) => (
              <div key={p.id} className="flex items-center gap-3 bg-muted/40 rounded-xl px-3 py-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    {`Semester ${p.semester} • ${(p.subjects || []).length} subjects • ${p.weekly_hours}h/week`}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {fmtDate(p.created_at)}{p.exam_date ? ` • Exam: ${fmtDate(p.exam_date)}` : ""}
                  </p>
                </div>
                <Button size="sm" variant="outline" className="rounded-xl gap-1.5 shrink-0" onClick={() => loadPlan(p)}>
                  <FolderOpen className="w-3.5 h-3.5" /> Load
                </Button>
                <Button size="sm" variant="ghost" className="rounded-xl text-destructive hover:text-destructive shrink-0" onClick={() => deletePlan(p.id)}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {loading && !schedule && <ThinkingAnimation message="UniGenius is creating your study plan..." />}

        {schedule ? (
          <div className="glass rounded-2xl p-6 overflow-x-auto">
            <MarkdownMessage content={schedule} />
          </div>
        ) : !loading ? (
          <div className="glass rounded-2xl p-12 text-center space-y-3">
            <CalendarDays className="w-12 h-12 text-muted-foreground/30 mx-auto" />
            <p className="font-display font-semibold text-foreground">Your AI Study Plan</p>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Pick subjects, set weekly hours & optional exam date. AI builds a personalized weekly timetable.
            </p>
          </div>
        ) : null}

        {/* Daily Tasks */}
        <div className="glass rounded-2xl p-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-display font-semibold text-foreground flex items-center gap-2">
              <ListChecks className="w-4 h-4" /> Daily Tasks
            </p>
            <span className="text-xs text-muted-foreground">Today + next 7 days</span>
            <Button
              onClick={breakIntoDailyTasks}
              disabled={breakingWeek || (!schedule && selected.length === 0)}
              variant="outline"
              className="rounded-xl gap-2 ml-auto"
              title={schedule ? "Use AI to break the weekly plan into daily tasks" : selected.length ? "Break your subjects into daily tasks" : "Pick your subjects or generate a weekly plan first"}
            >
              {breakingWeek ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {breakingWeek ? "Breaking down..." : "Break my week into daily tasks"}
            </Button>
          </div>

          {/* Add-task form */}
          <div className="grid sm:grid-cols-[160px_1fr_1fr_auto] gap-2">
            <Input type="date" value={taskDate} onChange={(e) => setTaskDate(e.target.value)} className="rounded-xl" />
            <Input
              value={taskSubject}
              onChange={(e) => setTaskSubject(e.target.value)}
              placeholder="Subject (optional)"
              list="planner-subject-options"
              className="rounded-xl"
            />
            <datalist id="planner-subject-options">
              {subjectOptions.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
            <Input value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} placeholder="Task title" className="rounded-xl" />
            <Button onClick={addTask} disabled={addingTask} className="rounded-xl gap-2 gradient-primary text-primary-foreground">
              {addingTask ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Add Task
            </Button>
          </div>

          {/* Grouped task list */}
          {groupedTasks.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No tasks yet. Add one above, or break your weekly plan into daily tasks.
            </p>
          ) : (
            <div className="space-y-3">
              {groupedTasks.map((g) => {
                const isOverdue = g.date < todayStr;
                const isToday = g.date === todayStr;
                return (
                  <div key={g.date} className="space-y-1.5">
                    <p className={`text-xs font-semibold flex items-center gap-2 flex-wrap ${isOverdue ? "text-destructive" : "text-muted-foreground"}`}>
                      {fmtDayHeading(g.date)}
                      {isToday && (
                        <span className="text-[10px] font-bold tracking-wide px-2 py-0.5 rounded-full gradient-primary text-primary-foreground">TODAY</span>
                      )}
                      {isOverdue ? " • Overdue" : ""}
                    </p>
                    {g.tasks.map((t) => (
                      <div
                        key={t.id}
                        className={`flex items-center gap-3 rounded-xl px-3 py-2 ${isOverdue && !t.done ? "bg-destructive/10 border border-destructive/30" : "bg-muted/40"}`}
                      >
                        <Checkbox
                          checked={!!t.done}
                          onCheckedChange={() => toggleTask(t)}
                          className="h-5 w-5 rounded-full border-2 border-primary/60 data-[state=checked]:bg-primary data-[state=checked]:border-primary data-[state=checked]:text-primary-foreground [&_svg]:h-3.5 [&_svg]:w-3.5 [&_svg]:stroke-[3]"
                        />
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium truncate ${t.done ? "line-through text-muted-foreground" : "text-foreground"}`}>{t.title}</p>
                          {t.subject ? <p className="text-xs text-muted-foreground truncate">{canonicalSubject(t.subject)}</p> : null}
                        </div>
                        {isOverdue && !t.done && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-destructive/15 text-destructive shrink-0">Overdue</span>
                        )}
                        <Button size="sm" variant="ghost" className="rounded-xl text-destructive hover:text-destructive shrink-0" onClick={() => deleteTask(t.id)}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </PageShell>
  );
};

export default PlannerPage;
