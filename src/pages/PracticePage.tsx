import { useState, useRef, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { Brain, ListChecks, Trophy, ArrowRight, ArrowLeft, CheckCircle, XCircle, Loader2, BarChart3, ChevronDown, ChevronUp, Upload, X, FileText, PenLine, Layers, ListOrdered, Sparkles, AlertCircle, Timer, Target, Zap, Cpu, Code2, Sigma, Landmark, BookOpen, Atom, FlaskConical, Leaf, Network, Database, AppWindow, Globe, Gauge, type LucideIcon } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useDepartment, departmentInfo } from "@/contexts/DepartmentContext";
import { useAuth } from "@/contexts/AuthContext";
import { useMySubjects } from "@/hooks/use-my-subjects";
import { useCurrentSemester } from "@/hooks/use-current-semester";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { authHeader } from "@/lib/auth-header";
import { normalizeMcqs, normalizeSaQuestions, asText } from "@/lib/quiz-questions";
import { notifyAiTier } from "@/lib/ai-tier-notifier";
import { useAdmin } from "@/hooks/use-admin";
import PageShell from "@/components/PageShell";
import WeakAreas from "@/components/WeakAreas";
import { quizPercent } from "@/lib/utils";
import { deriveLevel, extractWeakTopics, bumpLevel, type Difficulty } from "@/lib/adaptive-difficulty";

interface MCQ {
  question: string;
  options: { A: string; B: string; C: string; D: string };
  correct: "A" | "B" | "C" | "D";
  explanation?: string;
  topic?: string;
  source?: "bank" | "ai";
}

interface AnswerRecord {
  questionIndex: number;
  selected: string;
  correct: string;
  isCorrect: boolean;
}

interface SAQuestion {
  question: string;
  modelAnswer: string;
  keyPoints: string[];
  topic?: string;
}

interface TopicStat {
  topic: string;
  total: number;
  accuracy: number; // 0..1 (SA questions contribute score/maxScore)
  avgTime: number; // seconds per question
  budget: number; // seconds per question for this kind
  verdict: "strong" | "average" | "weak";
  note?: string;
}

interface TopicOption {
  topic: string;
  count?: number; // questions available in the bank, when known
}

interface SAGrade {
  index: number;
  verdict: "correct" | "partial" | "wrong";
  score: number;
  maxScore: number;
  whatWasRight: string;
  whatWasMissing: string;
  howToImprove: string;
}

type QuizType = "objective" | "subjective" | "mixed";
type SAStage = "idle" | "answering" | "grading" | "done";

// Marks per written answer — must match grade-answers (MAX_MARKS_PER_ANSWER).
const SA_MAX_MARKS = 5;
const SA_COUNT: Record<Exclude<QuizType, "objective">, number> = { subjective: 5, mixed: 3 };
const MCQ_COUNT: Record<QuizType, number> = { objective: 30, subjective: 0, mixed: 10 };

// Exam-style time budget per question (seconds) — like real papers:
// objective/MCQ = 1 minute each, subjective/short = 3 minutes each.
const MCQ_TIME_SEC = 60;
const SA_TIME_SEC = 180;

const fmtClock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/**
 * Per-topic report from one attempt's saved items: accuracy and average
 * time per topic, with a plain-language verdict. Slow-but-correct and
 * fast-but-wrong patterns surface as notes.
 */
export function computeTopicStats(items: any[]): TopicStat[] {
  const byTopic = new Map<string, { total: number; ratio: number; timeSum: number; timed: number; budgetSum: number }>();
  items.forEach((it) => {
    const topic = (it?.topic || "General").toString();
    const budget = it?.kind === "subjective" ? SA_TIME_SEC : MCQ_TIME_SEC;
    const cur = byTopic.get(topic) ?? { total: 0, ratio: 0, timeSum: 0, timed: 0, budgetSum: 0 };
    cur.total += 1;
    cur.budgetSum += budget;
    if (it?.kind === "subjective") {
      cur.ratio += it.maxScore ? (it.score ?? 0) / it.maxScore : 0;
    } else if (it?.isCorrect) {
      cur.ratio += 1;
    }
    if (typeof it?.timeSec === "number") {
      cur.timeSum += it.timeSec;
      cur.timed += 1;
    }
    byTopic.set(topic, cur);
  });
  const stats: TopicStat[] = [...byTopic.entries()].map(([topic, v]) => {
    const accuracy = v.total ? v.ratio / v.total : 0;
    const avgTime = v.timed ? Math.round(v.timeSum / v.timed) : 0;
    const budget = v.total ? v.budgetSum / v.total : MCQ_TIME_SEC;
    const verdict: TopicStat["verdict"] = accuracy >= 0.75 ? "strong" : accuracy >= 0.5 ? "average" : "weak";
    let note: string | undefined;
    if (accuracy >= 0.75 && avgTime > budget * 1.3) {
      note = "Your answers are correct, but you are taking too long — increase your speed.";
    } else if (accuracy < 0.5 && avgTime > 0 && avgTime < budget * 0.5) {
      note = "It looks like you guessed too quickly — think first, then answer.";
    } else if (accuracy >= 0.75) {
      note = "You are strong in this area — keep it up.";
    } else if (verdict === "weak") {
      note = "This area needs improvement — practice it more.";
    }
    return { topic, total: v.total, accuracy, avgTime, budget, verdict, note };
  });
  const rank = { weak: 0, average: 1, strong: 2 };
  return stats.sort((a, b) => rank[a.verdict] - rank[b.verdict] || a.accuracy - b.accuracy);
}

/* ─── Adaptive level system ──────────────────────────────────────────
 * deriveLevel / extractWeakTopics / bumpLevel live in
 * src/lib/adaptive-difficulty.ts (unit-tested): accuracy over the
 * student's last 5 quiz_results attempts decides the difficulty sent
 * to generate-quiz; weak topics come from each attempt's topicStats. */

interface SubjectAdaptive {
  /** Attempts in the selected semester (card history line). */
  semAttempts: number;
  /** Best score % in the selected semester. */
  semBestPct: number;
  /** Derived level, or null when the student has no history at all. */
  level: Difficulty | null;
  weakTopics: string[];
}

/** "Object-Oriented Programming (OOP)" -> "objectorientedprogramming" */
const normSubject = (s: string) =>
  (s || "").toLowerCase().replace(/\([^)]*\)/g, " ").replace(/[^a-z0-9]+/g, "");

/** Keyword-matched line icon + soft tinted tile for a subject — mirrors
 *  the mapping used in src/components/SubjectGrid.tsx. */
const getSubjectVisual = (name: string): { Icon: LucideIcon; tile: string } => {
  const n = name.toLowerCase();
  if (n.includes("logic") || n.includes("digital")) return { Icon: Cpu, tile: "bg-violet-500/10 text-violet-400 border-violet-500/20" };
  if (n.includes("programming") || n.includes("oop") || n.includes("object")) return { Icon: Code2, tile: "bg-blue-500/10 text-blue-400 border-blue-500/20" };
  if (n.includes("calculus") || n.includes("math")) return { Icon: Sigma, tile: "bg-amber-500/10 text-amber-400 border-amber-500/20" };
  if (n.includes("writing") || n.includes("english") || n.includes("composition")) return { Icon: PenLine, tile: "bg-rose-500/10 text-rose-400 border-rose-500/20" };
  if (n.includes("pakistan")) return { Icon: Landmark, tile: "bg-teal-500/10 text-teal-400 border-teal-500/20" };
  if (n.includes("quran") || n.includes("islam")) return { Icon: BookOpen, tile: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" };
  if (n.includes("physics")) return { Icon: Atom, tile: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20" };
  if (n.includes("chemistry")) return { Icon: FlaskConical, tile: "bg-pink-500/10 text-pink-400 border-pink-500/20" };
  if (n.includes("biolog")) return { Icon: Leaf, tile: "bg-lime-500/10 text-lime-400 border-lime-500/20" };
  if (n.includes("data structure") || n.includes("algorithm")) return { Icon: Network, tile: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20" };
  if (n.includes("database")) return { Icon: Database, tile: "bg-sky-500/10 text-sky-400 border-sky-500/20" };
  if (n.includes("operating")) return { Icon: AppWindow, tile: "bg-slate-500/10 text-slate-400 border-slate-500/20" };
  if (n.includes("network")) return { Icon: Globe, tile: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20" };
  return { Icon: BookOpen, tile: "bg-primary/10 text-primary border-primary/20" };
};

const ALLOWED_QUIZ_EXTENSIONS = ".pdf,.png,.jpg,.jpeg,.webp,.docx,.doc,.txt,.pptx,.ppt";

const PracticePage = () => {
  const { isAdmin } = useAdmin();
  const { department } = useDepartment();
  const { user } = useAuth();
  // Shared profile-first semester (same hook as Dashboard) — Practice
  // used to open on a hardcoded Sem 1 local state.
  const { semester, setSemester } = useCurrentSemester();
  const [selectedSubject, setSelectedSubject] = useState<string | null>(null);
  const [quizType, setQuizType] = useState<QuizType>("objective");
  const [questions, setQuestions] = useState<MCQ[]>([]);
  const [currentQ, setCurrentQ] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [score, setScore] = useState(0);
  const [loading, setLoading] = useState(false);
  const [quizDone, setQuizDone] = useState(false);
  const [answers, setAnswers] = useState<AnswerRecord[]>([]);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<{ name: string; type: string; dataUrl: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Subjective (written-answer) state
  const [saQuestions, setSaQuestions] = useState<SAQuestion[]>([]);
  const [saAnswers, setSaAnswers] = useState<string[]>([]);
  const [saIndex, setSaIndex] = useState(0);
  const [saStage, setSaStage] = useState<SAStage>("idle");
  const [saGrades, setSaGrades] = useState<SAGrade[]>([]);
  const [finalTotals, setFinalTotals] = useState<{ score: number; total: number } | null>(null);

  // Topic practice + timer + analytics state
  const [quizTopic, setQuizTopic] = useState<string | null>(null);
  const [topicOptions, setTopicOptions] = useState<Record<string, TopicOption[]>>({});
  const [expandedSubject, setExpandedSubject] = useState<string | null>(null);
  const [topicsLoading, setTopicsLoading] = useState(false);
  const [bankMeta, setBankMeta] = useState<{ bank: number; ai: number } | null>(null);
  const [pendingFill, setPendingFill] = useState(false);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [timeLimitSec, setTimeLimitSec] = useState(0);
  const mcqTimesRef = useRef<number[]>([]);
  const saTimesRef = useRef<number[]>([]);
  const questionStartRef = useRef<number>(Date.now());
  const quizSessionRef = useRef(0);
  const timeUpHandledRef = useRef(false);
  const autoSubmitRef = useRef<() => void>(() => {});

  // Adaptive level data: real question-bank counts + quiz history,
  // keyed by subject name. The ref mirror lets startQuiz read the
  // derived level/weak topics without waiting on state.
  const [bankCounts, setBankCounts] = useState<Record<string, number>>({});
  const [adaptiveMap, setAdaptiveMap] = useState<Record<string, SubjectAdaptive>>({});
  const adaptiveRef = useRef<Record<string, SubjectAdaptive>>({});
  const answersRef = useRef<AnswerRecord[]>([]);
  // Deferred phase-2 AI fill: bank questions start the quiz instantly;
  // the fill fires once the student has answered a few bank questions
  // (so its difficulty can adapt to this session), with a timer
  // fallback so it always fires. Session-guarded like before.
  const fillRef = useRef<{
    session: number;
    base: any;
    want: number;
    bankCount: number;
    baseDifficulty: Difficulty;
    weakTopics: string[];
  } | null>(null);
  const fillFiredRef = useRef(false);
  const fillTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { subjects } = useMySubjects(semester);

  // Load the real per-subject bank counts (selected semester) and the
  // student's quiz history, and derive each subject's adaptive level.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Bank counts: rows in question_bank for this semester, counted
      // per subject with the same name normalisation the edge function
      // uses, so "Digital Logic Design (DLD)" style variants still hit.
      try {
        const { data } = await supabase
          .from("question_bank")
          .select("subject")
          .eq("semester", semester);
        if (!cancelled) {
          const byNorm = new Map<string, number>();
          (data ?? []).forEach((r: any) => {
            const key = normSubject(String(r.subject || ""));
            if (key) byNorm.set(key, (byNorm.get(key) || 0) + 1);
          });
          const counts: Record<string, number> = {};
          subjects.forEach((s) => {
            counts[s.name] = byNorm.get(normSubject(s.name)) || 0;
          });
          setBankCounts(counts);
        }
      } catch { /* bank counts are display-only; quiz flow is unaffected */ }

      if (!user) return;
      try {
        const { data } = await supabase
          .from("quiz_results")
          .select("subject, score, total, semester, details, created_at")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(200);
        if (cancelled) return;
        const rows = (data ?? []) as any[];
        const map: Record<string, SubjectAdaptive> = {};
        subjects.forEach((s) => {
          const mine = rows.filter((r) => normSubject(String(r.subject || "")) === normSubject(s.name));
          const semRows = mine.filter((r) => r.semester === semester);
          map[s.name] = {
            semAttempts: semRows.length,
            semBestPct: semRows.length
              ? Math.max(...semRows.map((r) => (r.total > 0 ? Math.round((r.score / r.total) * 100) : 0)))
              : 0,
            level: mine.length ? deriveLevel(mine) : null,
            weakTopics: extractWeakTopics(mine),
          };
        });
        adaptiveRef.current = map;
        setAdaptiveMap(map);
      } catch { /* history is a bonus; quizzes still start at Easy */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, semester, subjects.map((s) => s.name).join("|")]);

  // Fire the deferred phase-2 AI fill exactly once per session. The
  // difficulty adapts to this session so far: with ≥3 bank answers,
  // ≥80% accuracy bumps one level up, <40% drops one level.
  const fireFill = () => {
    const f = fillRef.current;
    if (!f || fillFiredRef.current) return;
    fillFiredRef.current = true;
    if (fillTimerRef.current) { clearTimeout(fillTimerRef.current); fillTimerRef.current = null; }
    const answered = answersRef.current;
    let difficulty = f.baseDifficulty;
    if (answered.length >= 3) {
      const acc = answered.filter((a) => a.isCorrect).length / answered.length;
      if (acc >= 0.8) difficulty = bumpLevel(difficulty, 1);
      else if (acc < 0.4) difficulty = bumpLevel(difficulty, -1);
    }
    callGenerateQuiz({ ...f.base, count: f.want, bankFirst: false, difficulty, weakTopics: f.weakTopics })
      .then((aiData) => {
        if (quizSessionRef.current !== f.session) return;
        const aiQs = normalizeMcqs(aiData.questions) as MCQ[];
        if (aiQs.length) {
          setQuestions((prev) => [...prev, ...aiQs]);
          setBankMeta({ bank: f.bankCount, ai: aiQs.length });
        }
        setPendingFill(false);
      })
      .catch(() => {
        if (quizSessionRef.current !== f.session) return;
        setPendingFill(false);
        toast.info("AI is busy right now — quiz continues with the bank questions.");
      });
  };

  // Trigger the fill once enough bank answers exist to judge the
  // session (3 answers, or the last bank question when fewer exist).
  const maybeFireFill = () => {
    const f = fillRef.current;
    if (!f || fillFiredRef.current) return;
    if (answersRef.current.length >= Math.min(3, f.bankCount)) fireFill();
  };

  // Add the elapsed time on the currently visible question to its slot.
  const bankCurrentTime = () => {
    const now = Date.now();
    const elapsed = Math.max(0, Math.round((now - questionStartRef.current) / 1000));
    questionStartRef.current = now;
    if (elapsed === 0) return;
    if (saStage === "answering") {
      saTimesRef.current[saIndex] = (saTimesRef.current[saIndex] || 0) + elapsed;
    } else if (questions.length > 0) {
      mcqTimesRef.current[currentQ] = (mcqTimesRef.current[currentQ] || 0) + elapsed;
    }
  };

  const startTimer = (totalSec: number) => {
    setTimeLimitSec(totalSec);
    setTimeLeft(totalSec);
    timeUpHandledRef.current = false;
    questionStartRef.current = Date.now();
  };

  // Countdown; at zero the quiz auto-submits with whatever is answered.
  useEffect(() => {
    if (timeLeft === null) return;
    if (timeLeft <= 0) {
      if (!timeUpHandledRef.current) {
        timeUpHandledRef.current = true;
        toast.info("Time up! Quiz auto-submitted.");
        autoSubmitRef.current();
      }
      return;
    }
    const t = setTimeout(() => setTimeLeft((s) => (s === null ? null : s - 1)), 1000);
    return () => clearTimeout(t);
  }, [timeLeft]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error("File too large! Max 10MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setUploadedFile({ name: file.name, type: file.type, dataUrl: reader.result as string });
      toast.success(`${file.name} attached! Select a subject or click "Generate from File" to start.`);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  // Bug #3 fix: generation gets a hard 90 s ceiling and a user-cancellable
  // abort, so a stalled AI pool can never hang the loading screen forever —
  // it ends in the normal error path (toast + back to setup) or the user
  // cancels back to setup themselves.
  const genAbortRef = useRef<AbortController | null>(null);
  const callGenerateQuiz = async (body: any) => {
    const ctrl = new AbortController();
    genAbortRef.current = ctrl;
    const timer = setTimeout(() => ctrl.abort(), 90_000);
    try {
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-quiz`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `${await authHeader()}`,
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        if (resp.status === 401) throw new Error("Session expired — please sign in again");
        throw new Error(err.error || "Failed to generate quiz");
      }
      notifyAiTier(resp, isAdmin);
      return resp.json();
    } catch (e: any) {
      if (e?.name === "AbortError") throw new Error("Generation timed out — please try again");
      throw e;
    } finally {
      clearTimeout(timer);
    }
  };

  // Topic catalogue for a subject: bank topics (with instant-question
  // counts) merged with topics from the student's own quiz history.
  const loadTopics = async (subjectName: string) => {
    if (expandedSubject === subjectName) {
      setExpandedSubject(null);
      return;
    }
    setExpandedSubject(subjectName);
    if (topicOptions[subjectName]) return;
    setTopicsLoading(true);
    try {
      const merged = new Map<string, TopicOption>();
      try {
        const data = await callGenerateQuiz({
          mode: "topics",
          subject: subjectName,
          department: department ? departmentInfo[department].fullName : "Software Engineering",
        });
        (data.topics ?? []).forEach((t: TopicOption) => merged.set(t.topic, { topic: t.topic, count: t.count }));
      } catch { /* bank topics are a bonus, not a requirement */ }
      if (user) {
        const { data } = await supabase
          .from("quiz_results")
          .select("details")
          .eq("user_id", user.id)
          .eq("subject", subjectName)
          .order("created_at", { ascending: false })
          .limit(50);
        (data ?? []).forEach((row: any) => {
          const items = Array.isArray(row.details?.items) ? row.details.items : [];
          items.forEach((it: any) => {
            if (it?.topic && !merged.has(it.topic)) merged.set(it.topic, { topic: it.topic });
          });
        });
      }
      setTopicOptions((prev) => ({ ...prev, [subjectName]: [...merged.values()] }));
    } finally {
      setTopicsLoading(false);
    }
  };

  const startQuiz = async (subjectName: string, topic?: string | null) => {
    const session = ++quizSessionRef.current;
    setLoading(true);
    setSelectedSubject(subjectName);
    setQuizTopic(topic ?? null);
    setQuestions([]);
    setCurrentQ(0);
    setScore(0);
    setQuizDone(false);
    setAnswers([]);
    setShowBreakdown(false);
    setSaQuestions([]);
    setSaAnswers([]);
    setSaIndex(0);
    setSaStage("idle");
    setSaGrades([]);
    setFinalTotals(null);
    setBankMeta(null);
    setPendingFill(false);
    setTimeLeft(null);
    setTimeLimitSec(0);
    mcqTimesRef.current = [];
    saTimesRef.current = [];
    answersRef.current = [];
    fillRef.current = null;
    fillFiredRef.current = false;
    if (fillTimerRef.current) { clearTimeout(fillTimerRef.current); fillTimerRef.current = null; }
    timeUpHandledRef.current = false;

    // Adaptive level for this subject from the student's real history
    // (defaults to Easy when there is no history yet).
    const adaptive = adaptiveRef.current[subjectName];
    const baseDifficulty: Difficulty = adaptive?.level ?? "Easy";
    const weakTopics = adaptive?.weakTopics ?? [];

    const base: any = {
      subject: subjectName,
      department: department ? departmentInfo[department].fullName : "Software Engineering",
      semester,
    };
    if (topic) base.topic = topic;
    if (uploadedFile) {
      base.fileData = uploadedFile.dataUrl;
      base.fileType = uploadedFile.type;
      base.fileName = uploadedFile.name;
    }

    try {
      if (quizType === "subjective") {
        const data = await callGenerateQuiz({ ...base, mode: "subjective", count: SA_COUNT.subjective, difficulty: baseDifficulty, weakTopics });
        const saNorm = normalizeSaQuestions(data.questions);
        if (saNorm.length) {
          setSaQuestions(saNorm as SAQuestion[]);
          setSaAnswers(new Array(saNorm.length).fill(""));
          setSaStage("answering");
          startTimer(data.questions.length * SA_TIME_SEC);
        } else throw new Error("No questions generated");
        return;
      }

      const wantMcq = MCQ_COUNT[quizType];
      const wantSa = quizType === "mixed" ? SA_COUNT.mixed : 0;

      // Written questions (mixed mode) generate in the background of the
      // MCQ flow, exactly as before.
      const saPromise = wantSa
        ? callGenerateQuiz({ ...base, mode: "subjective", count: wantSa, difficulty: baseDifficulty, weakTopics })
        : Promise.resolve(null);

      if (!uploadedFile) {
        // Phase 1 — instant bank questions (no AI call server-side).
        const bankData = await callGenerateQuiz({ ...base, count: wantMcq, bankOnly: true });
        const bankQs = normalizeMcqs(bankData.questions) as MCQ[];
        if (bankQs.length > 0) {
          setQuestions(bankQs);
          setBankMeta({ bank: bankQs.length, ai: 0 });
          startTimer(wantMcq * MCQ_TIME_SEC + wantSa * SA_TIME_SEC);
          setLoading(false);
          if (bankQs.length < wantMcq) {
            // Phase 2 — AI fills the remainder while the student is
            // already answering; new questions append at the end. The
            // fill is deferred until the student has answered a few
            // bank questions so its difficulty can adapt to this
            // session (see fireFill); a timer guarantees it fires.
            setPendingFill(true);
            fillRef.current = {
              session,
              base,
              want: wantMcq - bankQs.length,
              bankCount: bankQs.length,
              baseDifficulty,
              weakTopics,
            };
            fillTimerRef.current = setTimeout(() => fireFill(), 20000);
          }
          if (wantSa) {
            try {
              const saData = await saPromise;
              if (quizSessionRef.current !== session) return;
              const saNorm = normalizeSaQuestions(saData?.questions);
              if (saNorm.length) {
                setSaQuestions(saNorm as SAQuestion[]);
                setSaAnswers(new Array(saNorm.length).fill(""));
              }
            } catch {
              toast.info("Written questions could not be generated — continuing with MCQs only.");
            }
          }
          return;
        }
        // No bank coverage for this subject/topic — classic single call
        // (server still merges any bank questions it finds).
        const [mcqData, saData] = await Promise.all([
          callGenerateQuiz({ ...base, count: wantMcq, difficulty: baseDifficulty, weakTopics }),
          saPromise,
        ]);
        const mcqNorm = normalizeMcqs(mcqData.questions) as MCQ[];
        const saNorm = normalizeSaQuestions(saData?.questions) as SAQuestion[];
        if (!mcqNorm.length) throw new Error("No questions generated");
        if (wantSa && !saNorm.length) throw new Error("No questions generated");
        setQuestions(mcqNorm);
        setBankMeta({ bank: mcqData.bankCount ?? 0, ai: mcqData.aiCount ?? mcqNorm.length });
        if (wantSa) {
          setSaQuestions(saNorm);
          setSaAnswers(new Array(saNorm.length).fill(""));
        }
        startTimer(mcqNorm.length * MCQ_TIME_SEC + wantSa * SA_TIME_SEC);
        return;
      }

      // File-based quiz: questions come only from the uploaded file.
      if (quizType === "objective") {
        const data = await callGenerateQuiz({ ...base, count: wantMcq, difficulty: baseDifficulty, weakTopics });
        const fileNorm = normalizeMcqs(data.questions) as MCQ[];
        if (fileNorm.length) {
          setQuestions(fileNorm);
          startTimer(fileNorm.length * MCQ_TIME_SEC);
        } else throw new Error("No questions generated");
      } else {
        const [mcqData, saData] = await Promise.all([
          callGenerateQuiz({ ...base, count: wantMcq, difficulty: baseDifficulty, weakTopics }),
          saPromise,
        ]);
        const mcqNorm = normalizeMcqs(mcqData.questions) as MCQ[];
        const saNorm = normalizeSaQuestions(saData?.questions) as SAQuestion[];
        if (!mcqNorm.length || !saNorm.length) throw new Error("No questions generated");
        setQuestions(mcqNorm);
        setSaQuestions(saNorm);
        setSaAnswers(new Array(saNorm.length).fill(""));
        startTimer(mcqNorm.length * MCQ_TIME_SEC + saNorm.length * SA_TIME_SEC);
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to generate quiz");
      setSelectedSubject(null);
      setSaStage("idle");
      setTimeLeft(null);
    } finally {
      setLoading(false);
    }
  };

  const startQuizFromFile = async () => {
    if (!uploadedFile) {
      toast.error("Please upload a file first!");
      return;
    }
    await startQuiz(uploadedFile.name.replace(/\.[^/.]+$/, ""));
  };

  const handleAnswer = (key: string) => {
    if (showResult) return;
    setSelected(key);
    setShowResult(true);
    const isCorrect = key === questions[currentQ].correct;
    if (isCorrect) setScore((s) => s + 1);
    const record: AnswerRecord = {
      questionIndex: currentQ,
      selected: key,
      correct: questions[currentQ].correct,
      isCorrect,
    };
    answersRef.current = [...answersRef.current, record];
    setAnswers((prev) => [...prev, record]);
    // Enough bank answers to judge this session? Fire the AI fill
    // with the session-adjusted difficulty.
    maybeFireFill();
  };

  // Persist the finished attempt (summary + per-answer details) and show
  // the scorecard. supabase-js returns { error } instead of throwing, so
  // the error is checked explicitly (a failed save must never be silent).
  const finishAndSave = async (grades: SAGrade[] | null) => {
    bankCurrentTime();
    const timeUsedSec = timeLimitSec > 0 && timeLeft !== null
      ? Math.max(0, timeLimitSec - timeLeft)
      : null;
    setTimeLeft(null);
    const saScore = grades ? grades.reduce((a, g) => a + g.score, 0) : 0;
    const saTotal = grades ? saQuestions.length * SA_MAX_MARKS : 0;
    const totalScore = score + saScore;
    const totalMax = questions.length + saTotal;
    setFinalTotals({ score: totalScore, total: totalMax });
    setQuizDone(true);

    if (!user) return;
    const items: any[] = [
      ...answers.map((a) => ({
        kind: "mcq",
        question: questions[a.questionIndex]?.question || "",
        selected: a.selected,
        correct: a.correct,
        isCorrect: a.isCorrect,
        topic: questions[a.questionIndex]?.topic || quizTopic || "General",
        timeSec: mcqTimesRef.current[a.questionIndex] ?? null,
      })),
      ...(grades ? saQuestions.map((q, i) => {
        const g = grades.find((x) => x.index === i) || grades[i];
        return {
          kind: "subjective",
          question: q.question,
          studentAnswer: saAnswers[i] || "",
          modelAnswer: q.modelAnswer,
          verdict: g?.verdict,
          score: g?.score ?? 0,
          maxScore: SA_MAX_MARKS,
          whatWasRight: g?.whatWasRight || "",
          whatWasMissing: g?.whatWasMissing || "",
          howToImprove: g?.howToImprove || "",
          topic: q.topic || quizTopic || "General",
          timeSec: saTimesRef.current[i] ?? null,
        };
      }) : []),
    ];
    const { error: saveError } = await supabase.from("quiz_results").insert({
      user_id: user.id,
      subject: selectedSubject!,
      semester,
      score: totalScore,
      total: totalMax,
      quiz_type: quizType === "objective" ? "practice" : quizType,
      details: {
        version: 2,
        items,
        topic: quizTopic,
        timeLimitSec: timeLimitSec || null,
        timeUsedSec,
        topicStats: computeTopicStats(items),
      },
    });
    if (saveError) {
      console.error("Failed to save quiz result:", saveError);
      toast.error("Your score could not be saved — please check your connection and try again.");
    }
  };

  const nextQuestion = async () => {
    bankCurrentTime();
    setSelected(null);
    setShowResult(false);
    if (currentQ + 1 < questions.length) {
      setCurrentQ((c) => c + 1);
    } else if (saQuestions.length > 0 && saStage === "idle") {
      // Mixed mode: MCQs done, move on to the written questions.
      setSaStage("answering");
      setSaIndex(0);
    } else {
      await finishAndSave(null);
    }
  };

  const navSa = (delta: number) => {
    bankCurrentTime();
    setSaIndex((i) => Math.min(saQuestions.length - 1, Math.max(0, i + delta)));
  };

  const submitSubjective = async () => {
    bankCurrentTime();
    setSaStage("grading");
    try {
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/grade-answers`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `${await authHeader()}`,
        },
        body: JSON.stringify({
          subject: selectedSubject,
          items: saQuestions.map((q, i) => ({
            question: q.question,
            modelAnswer: q.modelAnswer,
            keyPoints: q.keyPoints,
            studentAnswer: saAnswers[i] || "",
          })),
        }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || "Grading failed");
      }
      notifyAiTier(resp, isAdmin);
      const data = await resp.json();
      const grades: SAGrade[] = data.grades || [];
      setSaGrades(grades);
      setSaStage("done");
      await finishAndSave(grades);
    } catch (err: any) {
      toast.error(err.message || "Grading failed — your answers are still here, please retry.");
      setSaStage("answering");
    }
  };

  // Timer auto-submit: grade written answers if any exist (blanks score
  // 0), otherwise finish with the MCQ answers recorded so far.
  autoSubmitRef.current = () => {
    if (quizDone || loading || saStage === "grading") return;
    bankCurrentTime();
    if (saQuestions.length > 0) {
      void submitSubjective();
    } else {
      void finishAndSave(null);
    }
  };

  const resetQuiz = () => {
    quizSessionRef.current++;
    setSelectedSubject(null);
    setQuizTopic(null);
    setQuestions([]);
    setCurrentQ(0);
    setScore(0);
    setQuizDone(false);
    setSelected(null);
    setShowResult(false);
    setAnswers([]);
    setShowBreakdown(false);
    setUploadedFile(null);
    setSaQuestions([]);
    setSaAnswers([]);
    setSaIndex(0);
    setSaStage("idle");
    setSaGrades([]);
    setFinalTotals(null);
    setBankMeta(null);
    setPendingFill(false);
    setTimeLeft(null);
    setTimeLimitSec(0);
    mcqTimesRef.current = [];
    saTimesRef.current = [];
    answersRef.current = [];
    fillRef.current = null;
    fillFiredRef.current = false;
    if (fillTimerRef.current) { clearTimeout(fillTimerRef.current); fillTimerRef.current = null; }
  };

  const displayScore = finalTotals?.score ?? score;
  const displayTotal = finalTotals?.total ?? questions.length;
  const percentage = quizPercent(displayScore, displayTotal);
  const saScoreTotal = saGrades.reduce((a, g) => a + g.score, 0);

  const TimerChip = () => timeLeft === null ? null : (
    <span
      className={`flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full border flex-shrink-0 ${timeLeft < 60 ? "text-destructive border-destructive/40 bg-destructive/10 animate-pulse" : "text-foreground border-border/50 bg-muted/40"}`}
      title={`Time limit ${fmtClock(timeLimitSec)} — exam style (1 min per MCQ, 3 min per written question)`}
    >
      <Timer className="w-3.5 h-3.5" /> {fmtClock(timeLeft)}
    </span>
  );

  // End-of-quiz topic report, rebuilt from the same data that was saved.
  const reportItems: any[] = [
    ...answers.map((a) => ({
      kind: "mcq",
      topic: questions[a.questionIndex]?.topic || quizTopic || "General",
      isCorrect: a.isCorrect,
      timeSec: mcqTimesRef.current[a.questionIndex] ?? null,
    })),
    ...(saGrades.length > 0 ? saQuestions.map((q, i) => {
      const g = saGrades.find((x) => x.index === i) || saGrades[i];
      return {
        kind: "subjective",
        topic: q.topic || quizTopic || "General",
        score: g?.score ?? 0,
        maxScore: SA_MAX_MARKS,
        timeSec: saTimesRef.current[i] ?? null,
      };
    }) : []),
  ];
  const topicStats = quizDone ? computeTopicStats(reportItems) : [];
  const strongTopics = topicStats.filter((t) => t.verdict === "strong");
  const weakTopics = topicStats.filter((t) => t.verdict === "weak");

  // ─── Deep links (Quiz of the Day F-19 + Exam Prep weak topics) ────
  // The dashboard's Quiz of the Day card now passes the EXACT question
  // id it displayed; Exam Prep passes a subject/topic to practise.
  const startDailyQuestion = async (questionId: string, subjectName: string) => {
    const session = ++quizSessionRef.current;
    setLoading(true);
    setSelectedSubject(subjectName);
    setQuizTopic(null);
    setQuestions([]);
    setCurrentQ(0);
    setScore(0);
    setQuizDone(false);
    setAnswers([]);
    setShowBreakdown(false);
    setSaQuestions([]);
    setSaAnswers([]);
    setSaIndex(0);
    setSaStage("idle");
    setSaGrades([]);
    setFinalTotals(null);
    setBankMeta(null);
    setPendingFill(false);
    setTimeLeft(null);
    setTimeLimitSec(0);
    mcqTimesRef.current = [];
    saTimesRef.current = [];
    answersRef.current = [];
    fillRef.current = null;
    fillFiredRef.current = false;
    if (fillTimerRef.current) { clearTimeout(fillTimerRef.current); fillTimerRef.current = null; }
    timeUpHandledRef.current = false;
    try {
      const data = await callGenerateQuiz({
        mode: "question",
        questionId,
        subject: subjectName,
        department: department ? departmentInfo[department].fullName : "Software Engineering",
        semester,
      });
      const qs = normalizeMcqs(data.questions) as MCQ[];
      if (quizSessionRef.current !== session) return;
      if (!qs.length) throw new Error("That question is no longer available");
      setQuestions(qs);
      setQuizTopic(qs[0].topic || null);
      setBankMeta({ bank: qs.length, ai: 0 });
      startTimer(qs.length * MCQ_TIME_SEC);
    } catch (e: any) {
      toast.error(e.message || "Could not load the Quiz of the Day");
      setSelectedSubject(null);
    } finally {
      setLoading(false);
    }
  };

  const location = useLocation();
  const deepLinkRef = useRef(false);
  useEffect(() => {
    if (deepLinkRef.current) return;
    const st = (location.state || {}) as {
      dailyQuestionId?: string;
      dailySubject?: string;
      subject?: string;
      topic?: string;
    };
    if (!st.dailyQuestionId && !st.subject) return;
    deepLinkRef.current = true;
    if (st.dailyQuestionId) {
      void startDailyQuestion(st.dailyQuestionId, st.dailySubject || "Quiz of the Day");
    } else if (st.subject) {
      void startQuiz(st.subject, st.topic ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Final scorecard
  if (quizDone && selectedSubject) {
    return (
      <PageShell
        title="Practice Mode"
        subtitle="Final Scorecard"
        icon={<div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-500 flex items-center justify-center"><Trophy className="w-5 h-5 text-primary-foreground" /></div>}
      >
        <div className="max-w-2xl mx-auto space-y-6">
          <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="glass rounded-2xl p-8 text-center space-y-4">
            <div className="text-6xl">{percentage >= 80 ? "🏆" : percentage >= 50 ? "👍" : "📚"}</div>
            <h2 className="font-display font-bold text-2xl text-foreground">
              {percentage >= 80 ? "Excellent!" : percentage >= 50 ? "Good Job!" : "Keep Practicing!"}
            </h2>
            <p className="text-muted-foreground">{selectedSubject}{quizTopic ? ` — Topic: ${quizTopic}` : ""}</p>
            <div className="text-4xl font-bold gradient-text">{displayScore}/{displayTotal}</div>
            <p className="text-sm text-muted-foreground">Score: {percentage}%</p>

            <div className="flex justify-center gap-6 pt-2 flex-wrap">
              {questions.length > 0 && (
                <>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-emerald-400">{answers.filter(a => a.isCorrect).length}</p>
                    <p className="text-xs text-muted-foreground">MCQ Correct</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-destructive">{answers.filter(a => !a.isCorrect).length}</p>
                    <p className="text-xs text-muted-foreground">MCQ Incorrect</p>
                  </div>
                </>
              )}
              {saGrades.length > 0 && (
                <div className="text-center">
                  <p className="text-2xl font-bold text-primary">{saScoreTotal}/{saQuestions.length * SA_MAX_MARKS}</p>
                  <p className="text-xs text-muted-foreground">Written Marks</p>
                </div>
              )}
            </div>

            {!user && <p className="text-xs text-muted-foreground">Sign in to save your quiz results!</p>}

            <div className="flex gap-3 justify-center pt-2">
              {questions.length > 0 && (
                <Button onClick={() => setShowBreakdown(!showBreakdown)} variant="outline" className="rounded-xl gap-2">
                  <BarChart3 className="w-4 h-4" />
                  {showBreakdown ? "Hide" : "View"} MCQ Breakdown
                  {showBreakdown ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </Button>
              )}
              <Button onClick={resetQuiz} className="rounded-xl gradient-primary text-primary-foreground">
                Try Another Quiz
              </Button>
            </div>
          </motion.div>

          <AnimatePresence>
            {showBreakdown && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="space-y-3 overflow-hidden"
              >
                {questions.map((q, i) => {
                  const ans = answers[i];
                  if (!ans) return null;
                  return (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.03 }}
                      className={`glass rounded-xl p-4 border-l-4 ${ans.isCorrect ? "border-l-emerald-500" : "border-l-destructive"}`}
                    >
                      <div className="flex items-start gap-3">
                        <span className="flex-shrink-0 mt-0.5">
                          {ans.isCorrect
                            ? <CheckCircle className="w-5 h-5 text-emerald-500" />
                            : <XCircle className="w-5 h-5 text-destructive" />}
                        </span>
                        <div className="flex-1 min-w-0 space-y-1">
                          <p className="text-sm font-medium text-foreground">Q{i + 1}: {asText(q.question)}</p>
                          {!ans.isCorrect && (
                            <p className="text-xs text-destructive">
                              Your answer: {ans.selected} — {asText(q.options[ans.selected as keyof typeof q.options])}
                            </p>
                          )}
                          <p className="text-xs text-emerald-400">
                            Correct: {ans.correct} — {asText(q.options[ans.correct as keyof typeof q.options])}
                          </p>
                          {q.explanation && (
                            <p className="text-xs text-muted-foreground italic mt-1">💡 {asText(q.explanation)}</p>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Topic-wise report: accuracy + time per topic */}
          {topicStats.length > 0 && (
            <div className="glass rounded-2xl p-5 space-y-4">
              <h3 className="font-display font-semibold text-foreground flex items-center gap-2">
                <Target className="w-4 h-4 text-primary" /> Topic Report
                <span className="text-xs font-normal text-muted-foreground">accuracy + time per topic</span>
              </h3>
              {(strongTopics.length > 0 || weakTopics.length > 0) && (
                <div className="space-y-1 text-sm">
                  {strongTopics.length > 0 && (
                    <p className="text-emerald-400">✅ You are strong in these areas: {strongTopics.map((t) => t.topic).join(", ")}</p>
                  )}
                  {weakTopics.length > 0 && (
                    <p className="text-destructive">⚠️ These areas need improvement: {weakTopics.map((t) => t.topic).join(", ")} — practice them more.</p>
                  )}
                </div>
              )}
              <div className="space-y-2">
                {topicStats.map((t) => {
                  const accPct = Math.round(t.accuracy * 100);
                  const chip = t.verdict === "strong"
                    ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                    : t.verdict === "average"
                      ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
                      : "bg-destructive/15 text-destructive border-destructive/30";
                  const label = t.verdict === "strong" ? "Strong" : t.verdict === "average" ? "Average" : "Needs Improvement";
                  return (
                    <div key={t.topic} className="rounded-xl bg-muted/30 border border-border/40 p-3 space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-foreground flex-1 min-w-0 truncate">{t.topic}</span>
                        <span className="text-xs text-muted-foreground">{accPct}% • avg {t.avgTime}s/question • {t.total} question{t.total > 1 ? "s" : ""}</span>
                        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${chip}`}>{label}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted/60 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${t.verdict === "strong" ? "bg-emerald-400" : t.verdict === "average" ? "bg-amber-400" : "bg-destructive"}`}
                          style={{ width: `${accPct}%` }}
                        />
                      </div>
                      {t.note && <p className="text-xs text-muted-foreground">{t.note}</p>}
                      {t.verdict === "weak" && selectedSubject && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="rounded-xl gap-1.5 mt-1"
                          onClick={() => startQuiz(selectedSubject, t.topic)}
                        >
                          <Target className="w-3.5 h-3.5" /> Practice this topic
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Written-answer review */}
          {saGrades.length > 0 && (
            <div className="space-y-3">
              <h3 className="font-display font-semibold text-foreground flex items-center gap-2">
                <PenLine className="w-4 h-4 text-primary" /> Written Answers — AI Feedback
              </h3>
              {saQuestions.map((q, i) => {
                const g = saGrades.find((x) => x.index === i) || saGrades[i];
                if (!g) return null;
                const chip = g.verdict === "correct"
                  ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                  : g.verdict === "partial"
                    ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
                    : "bg-destructive/15 text-destructive border-destructive/30";
                const label = g.verdict === "correct" ? "Correct" : g.verdict === "partial" ? "Partially Correct" : "Needs Work";
                return (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.04 }}
                    className="glass rounded-xl p-4 space-y-2.5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-medium text-foreground">Q{i + 1}: {asText(q.question)}</p>
                      <span className={`flex-shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${chip}`}>
                        {label} • {g.score}/{g.maxScore}
                      </span>
                    </div>
                    <div className="rounded-lg bg-muted/40 p-3">
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Your answer</p>
                      <p className="text-sm text-foreground whitespace-pre-wrap">{saAnswers[i]?.trim() || <span className="italic text-muted-foreground">(left blank)</span>}</p>
                    </div>
                    {g.whatWasRight && (
                      <p className="text-xs text-emerald-400 flex gap-1.5"><CheckCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /> <span><b>Right:</b> {g.whatWasRight}</span></p>
                    )}
                    {g.whatWasMissing && (
                      <p className="text-xs text-destructive flex gap-1.5"><AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /> <span><b>Missing:</b> {g.whatWasMissing}</span></p>
                    )}
                    {g.howToImprove && (
                      <p className="text-xs text-muted-foreground flex gap-1.5"><Sparkles className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-primary" /> <span><b>Improve:</b> {g.howToImprove}</span></p>
                    )}
                    <div className="rounded-lg bg-primary/5 border border-primary/10 p-3">
                      <p className="text-[11px] uppercase tracking-wide text-primary mb-1">Model answer</p>
                      <p className="text-xs text-foreground/90 whitespace-pre-wrap">{q.modelAnswer}</p>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      </PageShell>
    );
  }

  // Grading in progress
  if (saStage === "grading" && selectedSubject) {
    return (
      <PageShell
        title="Practice Mode"
        subtitle={`${selectedSubject} — Written Answers`}
        icon={<div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-500 flex items-center justify-center"><PenLine className="w-5 h-5 text-primary-foreground" /></div>}
      >
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
          <p className="text-muted-foreground">AI is grading your written answers…</p>
          <p className="text-xs text-muted-foreground">Checking each answer against the model answer and key points</p>
        </div>
      </PageShell>
    );
  }

  // Subjective answering
  if (saStage === "answering" && selectedSubject && saQuestions.length > 0) {
    const q = saQuestions[saIndex];
    const isLast = saIndex + 1 >= saQuestions.length;
    return (
      <PageShell
        title="Practice Mode"
        subtitle={`${selectedSubject} — Written Q${saIndex + 1}/${saQuestions.length}`}
        icon={<div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-500 flex items-center justify-center"><PenLine className="w-5 h-5 text-primary-foreground" /></div>}
      >
        <div className="max-w-2xl mx-auto space-y-6">
          <div className="flex items-center gap-3">
            <div className="flex-1 bg-muted rounded-full h-2">
              <div className="h-2 rounded-full gradient-primary transition-all" style={{ width: `${((saIndex + 1) / saQuestions.length) * 100}%` }} />
            </div>
            <span className="text-xs text-muted-foreground font-medium">{saIndex + 1}/{saQuestions.length}</span>
            <TimerChip />
          </div>

          <AnimatePresence mode="wait">
            <motion.div key={saIndex} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
              <div className="glass rounded-2xl p-6">
                <p className="text-sm text-muted-foreground mb-2">Written Question {saIndex + 1} • {SA_MAX_MARKS} marks{(q.topic || quizTopic) ? ` • Topic: ${q.topic || quizTopic}` : ""}</p>
                <h3 className="font-display font-semibold text-foreground text-lg">{asText(q.question)}</h3>
              </div>

              <Textarea
                value={saAnswers[saIndex] || ""}
                onChange={(e) => {
                  const next = [...saAnswers];
                  next[saIndex] = e.target.value;
                  setSaAnswers(next);
                }}
                placeholder="Write your answer in your own words (3–6 sentences is ideal)…"
                rows={7}
                className="rounded-xl resize-y"
              />
              <p className="text-[11px] text-muted-foreground">Tip: cover the key concepts in your own words. A blank answer scores 0 — AI grades meaning, not exact wording.</p>

              <div className="flex gap-3">
                <Button
                  variant="outline"
                  className="rounded-xl gap-2"
                  disabled={saIndex === 0}
                  onClick={() => navSa(-1)}
                >
                  <ArrowLeft className="w-4 h-4" /> Back
                </Button>
                {isLast ? (
                  <Button onClick={submitSubjective} className="flex-1 rounded-xl gradient-primary text-primary-foreground gap-2">
                    Submit for AI Grading <Sparkles className="w-4 h-4" />
                  </Button>
                ) : (
                  <Button onClick={() => navSa(1)} className="flex-1 rounded-xl gradient-primary text-primary-foreground gap-2">
                    Next Question <ArrowRight className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      </PageShell>
    );
  }

  // Active MCQ quiz
  if (questions.length > 0 && selectedSubject) {
    const q = questions[currentQ];
    return (
      <PageShell
        title="Practice Mode"
        subtitle={`${selectedSubject} — Q${currentQ + 1}/${questions.length}`}
        icon={<div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-500 flex items-center justify-center"><Brain className="w-5 h-5 text-primary-foreground" /></div>}
      >
        <div className="max-w-2xl mx-auto space-y-6">
          <div className="flex items-center gap-3">
            <div className="flex-1 bg-muted rounded-full h-2">
              <div className="h-2 rounded-full gradient-primary transition-all" style={{ width: `${((currentQ + 1) / questions.length) * 100}%` }} />
            </div>
            <span className="text-xs text-muted-foreground font-medium">{currentQ + 1}/{questions.length}</span>
            <TimerChip />
          </div>

          {(bankMeta || pendingFill) && (
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground flex-wrap">
              {bankMeta && bankMeta.bank > 0 && (
                <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/25 text-emerald-400">
                  <Zap className="w-3 h-3" /> {bankMeta.bank} question{bankMeta.bank > 1 ? "s" : ""} from Question Bank (instant)
                </span>
              )}
              {pendingFill && (
                <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted/50 border border-border/40">
                  <Loader2 className="w-3 h-3 animate-spin" /> AI is adding more questions…
                </span>
              )}
              {quizTopic && (
                <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 border border-primary/25 text-primary">
                  <Target className="w-3 h-3" /> Topic: {quizTopic}
                </span>
              )}
            </div>
          )}

          <AnimatePresence mode="wait">
            <motion.div key={currentQ} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
              <div className="glass rounded-2xl p-6">
                <p className="text-sm text-muted-foreground mb-2">Question {currentQ + 1}{(q.topic || quizTopic) ? ` • Topic: ${q.topic || quizTopic}` : ""}</p>
                <h3 className="font-display font-semibold text-foreground text-lg">{asText(q.question)}</h3>
              </div>

              <div className="grid gap-3">
                {(["A", "B", "C", "D"] as const).map((key) => {
                  const isCorrect = key === q.correct;
                  const isSelected = key === selected;
                  let borderClass = "border-border/50";
                  if (showResult) {
                    if (isCorrect) borderClass = "border-emerald-500 bg-emerald-500/10";
                    else if (isSelected && !isCorrect) borderClass = "border-destructive bg-destructive/10";
                  }

                  return (
                    <motion.button
                      key={key}
                      whileHover={!showResult ? { scale: 1.01 } : undefined}
                      whileTap={!showResult ? { scale: 0.99 } : undefined}
                      onClick={() => handleAnswer(key)}
                      disabled={showResult}
                      className={`glass rounded-xl p-4 text-left flex items-center gap-3 transition-all border-2 ${borderClass} ${!showResult ? "hover:border-primary/50 cursor-pointer" : ""}`}
                    >
                      <span className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center text-sm font-bold text-foreground">{key}</span>
                      <span className="text-sm text-foreground flex-1">{asText(q.options[key])}</span>
                      {showResult && isCorrect && <CheckCircle className="w-5 h-5 text-emerald-500" />}
                      {showResult && isSelected && !isCorrect && <XCircle className="w-5 h-5 text-destructive" />}
                    </motion.button>
                  );
                })}
              </div>

              {showResult && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
                  {q.explanation && (
                    <div className="glass rounded-xl p-4 border-l-4 border-l-primary">
                      <p className="text-xs text-muted-foreground font-medium mb-1">💡 Explanation</p>
                      <p className="text-sm text-foreground">{asText(q.explanation)}</p>
                    </div>
                  )}
                  <Button onClick={nextQuestion} className="w-full rounded-xl gradient-primary text-primary-foreground gap-2">
                    {currentQ + 1 < questions.length
                      ? "Next Question"
                      : saQuestions.length > 0
                        ? "Continue to Written Questions"
                        : "See Final Scorecard"} <ArrowRight className="w-4 h-4" />
                  </Button>
                </motion.div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </PageShell>
    );
  }


  // Subject selection (setup)
  return (
    <PageShell
      title="Practice Mode"
      subtitle="AI-Powered Quizzes — Objective, Subjective & Mixed"
      icon={<div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-500 flex items-center justify-center"><Brain className="w-5 h-5 text-primary-foreground" /></div>}
    >
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
          <p className="text-muted-foreground">
            {uploadedFile
              ? "AI is reading your file and generating questions from its content..."
              : quizType === "objective"
                ? "Checking the question bank + generating quiz questions..."
                : quizType === "subjective"
                  ? "Generating written questions with AI..."
                  : "Generating MCQs + written questions with AI..."}
          </p>
          <p className="text-xs text-muted-foreground">This may take a moment</p>
          <Button
            variant="outline"
            size="sm"
            className="rounded-xl"
            onClick={() => { genAbortRef.current?.abort(); setLoading(false); setSelectedSubject(null); }}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Level pill — quizzes are matched to the student's real
              current semester (shared useCurrentSemester hook). */}
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 border border-primary/25 px-3 py-1 text-xs font-medium text-primary">
              <Target className="w-3.5 h-3.5" />
              Matched to your level · Semester {semester}
            </span>
          </div>

          {/* Quiz type choice */}
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            {([
              { value: "objective", label: "Objective", desc: "30 MCQs", icon: ListOrdered, tile: "bg-violet-500/10 text-violet-400 border-violet-500/20" },
              { value: "subjective", label: "Subjective", desc: "5 written, AI-graded", icon: PenLine, tile: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
              { value: "mixed", label: "Mixed", desc: "10 MCQs + 3 written", icon: Layers, tile: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
            ] as const).map((opt) => {
              const selected = quizType === opt.value;
              return (
              <button
                key={opt.value}
                onClick={() => setQuizType(opt.value)}
                aria-pressed={selected}
                className={`relative rounded-2xl p-3 sm:p-4 text-left border-2 transition-all ${selected ? "gradient-primary border-primary text-primary-foreground shadow-lg shadow-primary/30" : "glass border-transparent hover:border-primary/40"}`}
              >
                {selected && (
                  <span className="absolute top-2 right-2 w-5 h-5 rounded-full bg-white/25 flex items-center justify-center">
                    <CheckCircle className="w-3.5 h-3.5 text-white" />
                  </span>
                )}
                <span className={`w-9 h-9 rounded-lg border flex items-center justify-center mb-2 ${selected ? "bg-white/20 text-white border-white/30" : opt.tile}`}>
                  <opt.icon className="w-[18px] h-[18px]" />
                </span>
                <p className={`text-sm font-semibold ${selected ? "text-white" : "text-foreground"}`}>{opt.label}</p>
                <p className={`text-[11px] ${selected ? "text-white/80" : "text-muted-foreground"}`}>{opt.desc}</p>
              </button>
              );
            })}
          </div>

          {/* Adaptive rule strip */}
          <div className="glass rounded-2xl px-4 py-3 flex items-start gap-3">
            <span className="w-9 h-9 rounded-lg border bg-primary/10 text-primary border-primary/20 flex items-center justify-center flex-shrink-0">
              <Gauge className="w-[18px] h-[18px]" />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-foreground leading-snug">
                AI-generated questions adapt to you — they start Easy, get harder as you improve, and focus extra on your weak areas.
              </p>
              <span className="inline-flex items-center gap-1 mt-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full bg-muted/50 border border-border/40 text-muted-foreground">
                <Timer className="w-3 h-3" /> ~1 min per question
              </span>
            </div>
          </div>

          {/* File Upload for Vision questions */}
          <div className="glass rounded-2xl p-4 border border-dashed border-primary/30 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Upload className="w-4 h-4 text-primary" />
                <span className="text-sm font-medium text-foreground">Upload File for AI-Powered Questions</span>
              </div>
              {uploadedFile && (
                <button onClick={() => setUploadedFile(null)} className="text-muted-foreground hover:text-foreground">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {uploadedFile ? (
              <div className="flex items-center gap-3 bg-muted/50 rounded-xl p-3">
                {uploadedFile.type.startsWith("image/") ? (
                  <img src={uploadedFile.dataUrl} alt="Preview" className="w-10 h-10 rounded-lg object-cover" />
                ) : (
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                    <FileText className="w-5 h-5 text-primary" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{uploadedFile.name}</p>
                  <p className="text-xs text-muted-foreground">AI will analyze this file to generate relevant questions</p>
                </div>
                <Button onClick={startQuizFromFile} size="sm" className="rounded-xl gradient-primary text-primary-foreground gap-1.5 flex-shrink-0">
                  <Brain className="w-3.5 h-3.5" /> Generate
                </Button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 py-3">
                <p className="text-xs text-muted-foreground">Upload a textbook page, lecture slide, or document — AI will read it and create questions</p>
                <Button variant="outline" size="sm" className="rounded-xl gap-1.5" onClick={() => fileInputRef.current?.click()}>
                  <Upload className="w-3.5 h-3.5" /> Choose File
                </Button>
              </div>
            )}
            <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept={ALLOWED_QUIZ_EXTENSIONS} className="hidden" />
          </div>

          {/* Semester selector */}
          <div className="flex gap-2 flex-wrap">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((s) => (
              <motion.div key={s} whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                <Button
                  variant={semester === s ? "default" : "outline"}
                  size="sm"
                  className={`rounded-xl ${semester === s ? "gradient-primary text-primary-foreground" : ""}`}
                  onClick={() => { setSemester(s); setExpandedSubject(null); }}
                >
                  Sem {s}
                </Button>
              </motion.div>
            ))}
          </div>

          {/* Subject grid */}
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {subjects.map((sub) => {
              const expanded = expandedSubject === sub.name;
              const topics = topicOptions[sub.name] ?? [];
              const { Icon: SubIcon, tile: subTile } = getSubjectVisual(sub.name);
              const bankCount = bankCounts[sub.name] || 0;
              const adaptive = adaptiveMap[sub.name];
              return (
                <motion.div
                  key={sub.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.15 }}
                  className="glass rounded-2xl p-4 sm:p-5 text-left space-y-3 border-2 border-transparent hover:border-primary/50 transition-all hover:shadow-elevated flex flex-col"
                >
                  <div className="cursor-pointer space-y-3" onClick={() => startQuiz(sub.name)}>
                    <div className="flex items-start gap-3">
                      <span className={`w-11 h-11 rounded-xl border flex items-center justify-center flex-shrink-0 ${subTile}`}>
                        <SubIcon className="w-5 h-5" />
                      </span>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-display font-semibold text-foreground text-sm leading-snug">{sub.name}</h3>
                        {sub.hasLab && (
                          <span className="inline-block mt-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">Lab</span>
                        )}
                      </div>
                    </div>
                    {/* Real bank coverage for this subject + semester —
                        replaces the old fabricated uniform counts. */}
                    <div className="flex items-center gap-1 text-xs text-primary">
                      <ListChecks className="w-3 h-3" />
                      {bankCount > 0 ? `${bankCount} MCQs in bank` : "AI-generated questions"}
                      {uploadedFile && <span className="text-amber-400 ml-1">+ File Analysis</span>}
                    </div>
                    {/* Real quiz history for this subject + semester. */}
                    {adaptive && adaptive.semAttempts > 0 ? (
                      <div className="space-y-0.5">
                        <p className="text-[11px] text-muted-foreground">
                          {adaptive.semAttempts} attempt{adaptive.semAttempts > 1 ? "s" : ""} · Best {adaptive.semBestPct}%
                        </p>
                        {adaptive.level && (
                          <p className="text-[11px] font-medium text-foreground/80">Your level: {adaptive.level}</p>
                        )}
                      </div>
                    ) : (
                      <p className="text-[11px] text-muted-foreground">Not started yet</p>
                    )}
                  </div>

                  {!uploadedFile && (
                    <div className="pt-1 mt-auto">
                      <button
                        onClick={() => loadTopics(sub.name)}
                        className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-primary transition-colors"
                      >
                        <Target className="w-3.5 h-3.5" />
                        Topic-wise Practice
                        {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      </button>
                      {expanded && (
                        <div className="flex flex-wrap gap-1.5 pt-2.5">
                          {topicsLoading && topics.length === 0 ? (
                            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading topics…
                            </span>
                          ) : (
                            <>
                              <button
                                onClick={() => startQuiz(sub.name)}
                                className="text-[11px] font-medium px-2.5 py-1 rounded-full border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                              >
                                All Topics (Mixed)
                              </button>
                              {topics.map((t) => (
                                <button
                                  key={t.topic}
                                  onClick={() => startQuiz(sub.name, t.topic)}
                                  className="text-[11px] px-2.5 py-1 rounded-full border border-border/50 bg-muted/40 text-foreground hover:border-primary/50 hover:text-primary transition-colors"
                                  title={t.count ? `${t.count} questions ready in the bank — instant start` : "Topic-focused quiz"}
                                >
                                  {t.topic}
                                  {t.count ? <span className="text-emerald-400 ml-1">⚡{t.count}</span> : null}
                                </button>
                              ))}
                              {topics.length === 0 && !topicsLoading && (
                                <span className="text-[11px] text-muted-foreground">No saved topics yet — take your first mixed quiz and topics will be created automatically.</span>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>

          {/* Weak areas from quiz history (compact) */}
          <WeakAreas compact />
        </div>
      )}
    </PageShell>
  );
};

export default PracticePage;
