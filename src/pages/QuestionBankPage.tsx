import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Library, Search, Eye, EyeOff, Lightbulb, Play, Pencil, Trash2, CheckCircle, XCircle, ArrowRight, Trophy, Loader2, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useRole } from "@/hooks/use-role";
import { useCurrentSemester } from "@/hooks/use-current-semester";
import { toast } from "sonner";
import PageShell from "@/components/PageShell";

interface QuestionRow {
  id: string;
  subject: string;
  topic: string;
  question: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  // Only present for teachers/admins (direct table read).
  correct_answer?: string | null;
  explanation?: string | null;
  has_explanation?: boolean;
  semester: number | null;
  created_by: string;
}

const QuestionBankPage = () => {
  const { user } = useAuth();
  const { isTeacher, isAdmin } = useRole();
  const queryClient = useQueryClient();

  const [subjectFilter, setSubjectFilter] = useState<string>("all");
  const [topicFilter, setTopicFilter] = useState<string>("all");
  // Semester filter (question_bank.semester). Defaults to the student's
  // own current semester once the profile value has loaded — applied
  // exactly once so it never fights a manual change.
  const [semesterFilter, setSemesterFilter] = useState<string>("all");
  const { semester: studentSemester, loaded: semesterLoaded } = useCurrentSemester();
  const semesterDefaultApplied = useRef(false);
  useEffect(() => {
    if (semesterDefaultApplied.current) return;
    if (semesterLoaded && user) {
      semesterDefaultApplied.current = true;
      setSemesterFilter(String(studentSemester));
    }
  }, [semesterLoaded, studentSemester, user]);
  const [search, setSearch] = useState("");
  // Pagination: the bank renders 25 questions per page — previously ALL
  // matching questions (800+) rendered in one endless list.
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 25;
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [explained, setExplained] = useState<Record<string, boolean>>({});

  // Practice state
  const [practiceMode, setPracticeMode] = useState(false);
  const [practiceQs, setPracticeQs] = useState<QuestionRow[]>([]);
  const [pIdx, setPIdx] = useState(0);
  const [pSelected, setPSelected] = useState<string | null>(null);
  const [pShow, setPShow] = useState(false);
  const [pScore, setPScore] = useState(0);
  const [pDone, setPDone] = useState(false);
  const [pResult, setPResult] = useState<{ is_correct: boolean; correct_answer: string; explanation: string } | null>(null);
  const [pChecking, setPChecking] = useState(false);

  // Edit/delete
  const [editing, setEditing] = useState<QuestionRow | null>(null);
  const [saving, setSaving] = useState(false);

  const canManage = isAdmin || isTeacher;

  // PostgREST returns at most 1,000 rows per request, but the bank has
  // more than 2,000 questions — a single fetch silently stopped at
  // 1,000 and the page showed "of 1000 questions". Fetch in 1,000-row
  // ranges until a short range comes back, so every question is loaded
  // and the subject/topic filters and pages below work on the full bank.
  const FETCH_CHUNK = 1000;
  const { data: questions = [], isLoading } = useQuery({
    queryKey: ["question-bank-all", canManage],
    queryFn: async () => {
      const all: QuestionRow[] = [];
      const seen = new Set<string>();
      for (let offset = 0; offset < 10000; offset += FETCH_CHUNK) {
        let chunk: QuestionRow[];
        if (canManage) {
          const { data, error } = await supabase
            .from("question_bank")
            .select("*")
            .order("created_at", { ascending: false })
            .range(offset, offset + FETCH_CHUNK - 1);
          if (error) throw error;
          chunk = (data || []) as QuestionRow[];
        } else {
          const { data, error } = await (supabase.rpc("list_question_bank_safe" as any) as any)
            .range(offset, offset + FETCH_CHUNK - 1);
          if (error) throw error;
          chunk = (data || []) as QuestionRow[];
        }
        let added = 0;
        for (const row of chunk) {
          if (row?.id && !seen.has(row.id)) {
            seen.add(row.id);
            all.push(row);
            added++;
          }
        }
        if (chunk.length < FETCH_CHUNK || added === 0) break;
      }
      return all;
    },
    staleTime: 5 * 60 * 1000,
  });

  // Exact total straight from the database (a head request — no rows are
  // downloaded). It drives the unfiltered "of N questions" label, so the
  // total can never get stuck at the 1,000-row fetch limit again.
  const { data: exactTotal } = useQuery({
    queryKey: ["question-bank-count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("question_bank")
        .select("id", { count: "exact", head: true });
      if (error) return null;
      return count;
    },
    staleTime: 5 * 60 * 1000,
  });

  const subjects = useMemo(
    () => Array.from(new Set(questions.map((q) => q.subject).filter(Boolean))).sort(),
    [questions]
  );
  const semesters = useMemo(
    () =>
      Array.from(
        new Set(questions.map((q) => q.semester).filter((s): s is number => typeof s === "number"))
      ).sort((a, b) => a - b),
    [questions]
  );
  const topics = useMemo(
    () =>
      Array.from(
        new Set(
          questions
            .filter((q) => subjectFilter === "all" || q.subject === subjectFilter)
            .map((q) => q.topic)
            .filter(Boolean)
        )
      ).sort(),
    [questions, subjectFilter]
  );

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return questions.filter((q) => {
      if (subjectFilter !== "all" && q.subject !== subjectFilter) return false;
      if (topicFilter !== "all" && q.topic !== topicFilter) return false;
      if (semesterFilter !== "all" && q.semester !== Number(semesterFilter)) return false;
      if (!s) return true;
      return (
        q.question.toLowerCase().includes(s) ||
        q.topic?.toLowerCase().includes(s) ||
        q.subject?.toLowerCase().includes(s)
      );
    });
  }, [questions, subjectFilter, topicFilter, semesterFilter, search]);

  // Reset to the first page whenever the result set changes.
  useEffect(() => {
    setPage(1);
  }, [subjectFilter, topicFilter, semesterFilter, search, questions]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const rangeFrom = filtered.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
  const rangeTo = Math.min(filtered.length, safePage * PAGE_SIZE);

  // The "of N questions" label: with a subject/topic/search filter on,
  // the filtered length IS the exact count for that selection (the full
  // bank is loaded, so per-subject counts are exact too). With no filter,
  // prefer the database's exact count, and never show less than the
  // number of questions actually loaded.
  const filtersActive =
    subjectFilter !== "all" || topicFilter !== "all" || semesterFilter !== "all" || search.trim() !== "";
  const displayTotal = filtersActive
    ? filtered.length
    : Math.max(exactTotal ?? 0, filtered.length);

  const startPractice = () => {
    if (filtered.length === 0) {
      toast.error("No questions match your filters");
      return;
    }
    const shuffled = [...filtered].sort(() => Math.random() - 0.5).slice(0, Math.min(20, filtered.length));
    setPracticeQs(shuffled);
    setPIdx(0);
    setPSelected(null);
    setPShow(false);
    setPScore(0);
    setPDone(false);
    setPracticeMode(true);
  };

  const submitAnswer = async () => {
    if (!pSelected) return;
    const q = practiceQs[pIdx];
    setPChecking(true);
    try {
      const { data, error } = await supabase.rpc("check_question_answer" as any, {
        _question_id: q.id,
        _answer: pSelected,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      const result = {
        is_correct: !!row?.is_correct,
        correct_answer: row?.correct_answer ?? "",
        explanation: row?.explanation ?? "",
      };
      setPResult(result);
      if (result.is_correct) setPScore((s) => s + 1);
      setPShow(true);
    } catch (e: any) {
      toast.error(e.message || "Could not check answer");
    } finally {
      setPChecking(false);
    }
  };

  const nextQuestion = () => {
    if (pIdx + 1 >= practiceQs.length) {
      setPDone(true);
      return;
    }
    setPIdx((i) => i + 1);
    setPSelected(null);
    setPShow(false);
    setPResult(null);
  };

  const handleDelete = async (q: QuestionRow) => {
    if (!confirm("Delete this question?")) return;
    const { error } = await supabase.from("question_bank").delete().eq("id", q.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Question deleted");
    queryClient.invalidateQueries({ queryKey: ["question-bank-all"] });
    queryClient.invalidateQueries({ queryKey: ["question-bank-count"] });
  };

  const handleSaveEdit = async () => {
    if (!editing) return;
    setSaving(true);
    const { error } = await supabase
      .from("question_bank")
      .update({
        question: editing.question,
        topic: editing.topic,
        option_a: editing.option_a,
        option_b: editing.option_b,
        option_c: editing.option_c,
        option_d: editing.option_d,
        correct_answer: editing.correct_answer,
        explanation: editing.explanation,
      })
      .eq("id", editing.id);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Question updated");
    setEditing(null);
    queryClient.invalidateQueries({ queryKey: ["question-bank-all"] });
    queryClient.invalidateQueries({ queryKey: ["question-bank-count"] });
  };

  const canEdit = (q: QuestionRow) => isAdmin || (isTeacher && q.created_by === user?.id);

  // PRACTICE MODE UI
  if (practiceMode) {
    const currentQ = practiceQs[pIdx];
    const opts: { key: "A" | "B" | "C" | "D"; text: string }[] = currentQ
      ? [
          { key: "A", text: currentQ.option_a },
          { key: "B", text: currentQ.option_b },
          { key: "C", text: currentQ.option_c },
          { key: "D", text: currentQ.option_d },
        ]
      : [];

    return (
      <PageShell title="Practice Quiz" subtitle={`Question ${Math.min(pIdx + 1, practiceQs.length)} of ${practiceQs.length}`} icon={<Play className="w-6 h-6 text-primary" />}>
        {pDone ? (
          <Card className="p-8 text-center max-w-xl mx-auto">
            <Trophy className="w-16 h-16 mx-auto text-yellow-500 mb-4" />
            <h2 className="text-3xl font-bold mb-2">Quiz Complete!</h2>
            <p className="text-5xl font-display font-bold text-primary mb-2">
              {pScore}/{practiceQs.length}
            </p>
            <p className="text-muted-foreground mb-6">
              {Math.round((pScore / practiceQs.length) * 100)}% correct
            </p>
            <div className="flex gap-3 justify-center">
              <Button onClick={() => setPracticeMode(false)} variant="outline">
                Back to Bank
              </Button>
              <Button onClick={startPractice}>Practice Again</Button>
            </div>
          </Card>
        ) : currentQ ? (
          <Card className="p-6 max-w-3xl mx-auto space-y-6">
            <div>
              <div className="flex gap-2 mb-3">
                <Badge variant="secondary">{currentQ.subject}</Badge>
                {currentQ.topic && <Badge variant="outline">{currentQ.topic}</Badge>}
              </div>
              <h3 className="text-lg font-semibold">{currentQ.question}</h3>
            </div>
            <div className="space-y-2">
              {opts.map((o) => {
                const correct = pResult?.correct_answer ?? currentQ.correct_answer ?? "";
                const isCorrect = pShow && o.key === correct;
                const isWrong = pShow && pSelected === o.key && o.key !== correct;
                const isDimmed = pShow && !isCorrect && !isWrong;
                return (
                  <button
                    key={o.key}
                    disabled={pShow}
                    onClick={() => setPSelected(o.key)}
                    className={`w-full text-left px-3 py-2.5 rounded-lg border transition-all ${
                      isCorrect
                        ? "gradient-primary border-transparent text-primary-foreground"
                        : isWrong
                        ? "border-rose-500/50 bg-rose-500/10"
                        : pSelected === o.key
                        ? "border-primary bg-primary/10"
                        : "border-border hover:border-primary/50"
                    } ${isDimmed ? "opacity-50" : ""}`}
                  >
                    <div className="flex items-center gap-2.5">
                      <span
                        className={`w-6 h-6 rounded-md flex items-center justify-center text-[11px] font-bold shrink-0 ${
                          isCorrect
                            ? "bg-white/20 text-white"
                            : "bg-primary/10 text-primary border border-primary/20"
                        }`}
                      >
                        {o.key}
                      </span>
                      <span className="flex-1">{o.text}</span>
                      {isCorrect && (
                        <span className="flex items-center gap-1.5 shrink-0">
                          <CheckCircle className="w-4 h-4 text-white" />
                          <span className="text-[9px] font-bold tracking-wider px-1.5 py-0.5 rounded-full bg-white/20 text-white">CORRECT</span>
                        </span>
                      )}
                      {isWrong && (
                        <span className="flex items-center gap-1.5 shrink-0">
                          <XCircle className="w-4 h-4 text-rose-400" />
                          <span className="text-[9px] font-bold tracking-wider px-1.5 py-0.5 rounded-full bg-rose-500/15 text-rose-400">YOUR PICK</span>
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
            {pShow && (pResult?.explanation || currentQ.explanation) && (
              <div className="px-3 py-2.5 rounded-lg bg-muted/40 border-l-2 border-primary">
                <p className="text-[10px] font-bold tracking-wider text-primary mb-1">EXPLANATION</p>
                <p className="text-sm text-muted-foreground">{pResult?.explanation || currentQ.explanation}</p>
              </div>
            )}
            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setPracticeMode(false)}>Exit</Button>
              {pShow ? (
                <Button onClick={nextQuestion}>
                  {pIdx + 1 >= practiceQs.length ? "Finish" : "Next"} <ArrowRight className="w-4 h-4 ml-1" />
                </Button>
              ) : (
                <Button onClick={submitAnswer} disabled={!pSelected || pChecking}>
                  {pChecking && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Submit
                </Button>
              )}
            </div>
          </Card>
        ) : null}
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Question Bank"
      subtitle="Browse teacher-curated MCQs and practice for exams"
      icon={<Library className="w-6 h-6 text-primary" />}
    >
      {/* Level pill — reflects the active semester filter. When the
          filter matches the student's own semester, the bank is
          matched to their level. */}
      <div className="mb-4">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 border border-primary/25 px-3 py-1 text-xs font-medium text-primary">
          <Target className="w-3.5 h-3.5" />
          {semesterFilter === "all"
            ? "All semesters"
            : user && Number(semesterFilter) === studentSemester
              ? `Matched to your level · Semester ${studentSemester}`
              : `Semester ${semesterFilter}`}
        </span>
      </div>

      {/* Controls */}
      <Card className="p-4 mb-6 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search questions..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={subjectFilter} onValueChange={(v) => { setSubjectFilter(v); setTopicFilter("all"); }}>
            <SelectTrigger><SelectValue placeholder="Subject" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Subjects</SelectItem>
              {subjects.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={topicFilter} onValueChange={setTopicFilter}>
            <SelectTrigger><SelectValue placeholder="Topic" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Topics</SelectItem>
              {topics.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={semesterFilter} onValueChange={setSemesterFilter}>
            <SelectTrigger><SelectValue placeholder="Semester" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All semesters</SelectItem>
              {semesters.map((s) => <SelectItem key={s} value={String(s)}>Semester {s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center justify-between flex-wrap gap-2">
          {isLoading ? (
            // D-5: while the bank is still loading, say so — the old
            // line rendered "Showing 0–0 of 0 questions", which reads
            // as an empty bank on slow connections.
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-primary" /> Loading questions…
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Showing{" "}
              <span className="font-bold text-foreground">
                {rangeFrom}–{rangeTo}
              </span>{" "}
              of <span className="font-bold text-foreground">{displayTotal}</span> question
              {displayTotal !== 1 && "s"}
            </p>
          )}
          <Button onClick={startPractice} disabled={filtered.length === 0}>
            <Play className="w-4 h-4 mr-1" /> Start Practice
          </Button>
        </div>
      </Card>

      {/* Questions list */}
      {isLoading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : filtered.length === 0 ? (
        <Card className="p-12 text-center">
          <Library className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
          <p className="text-muted-foreground">No questions found. Try adjusting your filters.</p>
        </Card>
      ) : (
        <div className="space-y-4">
          {pageItems.map((q, i) => {
            const showAns = revealed[q.id];
            const showExp = explained[q.id];
            const opts: ("A" | "B" | "C" | "D")[] = ["A", "B", "C", "D"];
            const optMap = { A: q.option_a, B: q.option_b, C: q.option_c, D: q.option_d };
            return (
              <motion.div
                key={q.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.02, 0.3) }}
              >
                <Card className="p-4 space-y-3">
                  {/* Admin edit/delete controls were removed from the
                      student-facing cards (Batch 2). The edit dialog +
                      handlers below stay in the codebase; content is
                      managed from the admin area. */}
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="secondary">{q.subject}</Badge>
                    {q.topic && <Badge variant="outline">{q.topic}</Badge>}
                  </div>
                  <h3 className="font-semibold text-sm sm:text-[15px] leading-snug">{q.question}</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {opts.map((k) => {
                      const isCorrect = showAns && !!q.correct_answer && k === q.correct_answer;
                      const isDimmed = showAns && !!q.correct_answer && !isCorrect;
                      return (
                        <div
                          key={k}
                          className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border text-sm transition-opacity ${
                            isCorrect
                              ? "gradient-primary border-transparent text-primary-foreground font-medium"
                              : "border-border bg-muted/30"
                          } ${isDimmed ? "opacity-50" : ""}`}
                        >
                          <span
                            className={`w-6 h-6 rounded-md flex items-center justify-center text-[11px] font-bold shrink-0 ${
                              isCorrect
                                ? "bg-white/20 text-white"
                                : "bg-primary/10 text-primary border border-primary/20"
                            }`}
                          >
                            {k}
                          </span>
                          <span className="flex-1">{optMap[k]}</span>
                          {isCorrect && (
                            <span className="flex items-center gap-1.5 shrink-0">
                              <CheckCircle className="w-4 h-4 text-white" />
                              <span className="text-[9px] font-bold tracking-wider px-1.5 py-0.5 rounded-full bg-white/20 text-white">CORRECT</span>
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {canManage && (
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => setRevealed((r) => ({ ...r, [q.id]: !r[q.id] }))}
                        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                          showAns
                            ? "bg-primary/15 border-primary/40 text-primary"
                            : "border-border text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {showAns ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        {showAns ? "Hide Answer" : "Show Answer"}
                      </button>
                      {q.explanation && (
                        <button
                          onClick={() => setExplained((r) => ({ ...r, [q.id]: !r[q.id] }))}
                          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                            showExp
                              ? "bg-primary/15 border-primary/40 text-primary"
                              : "border-border text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          <Lightbulb className="w-3.5 h-3.5" />
                          {showExp ? "Hide Explanation" : "Show Explanation"}
                        </button>
                      )}
                    </div>
                  )}
                  {showExp && q.explanation && (
                    <div className="px-3 py-2.5 rounded-lg bg-muted/40 border-l-2 border-primary">
                      <p className="text-[10px] font-bold tracking-wider text-primary mb-1">EXPLANATION</p>
                      <p className="text-sm text-muted-foreground">{q.explanation}</p>
                    </div>
                  )}
                </Card>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Pagination controls — in the normal content flow, with clear
          space above the fixed bottom nav. */}
      {!isLoading && filtered.length > PAGE_SIZE && (
        <div className="flex items-center justify-center gap-3 mt-6 pb-24 md:pb-8">
          <Button
            size="sm"
            variant="outline"
            className="rounded-full px-4 border-primary/30 text-primary hover:bg-primary/10 hover:text-primary disabled:text-muted-foreground disabled:border-border"
            disabled={safePage <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page <span className="font-bold text-foreground">{safePage}</span> of{" "}
            <span className="font-bold text-foreground">{pageCount}</span>
          </span>
          <Button
            size="sm"
            variant="outline"
            className="rounded-full px-4 border-primary/30 text-primary hover:bg-primary/10 hover:text-primary disabled:text-muted-foreground disabled:border-border"
            disabled={safePage >= pageCount}
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
          >
            Next
          </Button>
        </div>
      )}

      {/* Edit dialog */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Question</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div>
                <Label>Topic</Label>
                <Input value={editing.topic} onChange={(e) => setEditing({ ...editing, topic: e.target.value })} />
              </div>
              <div>
                <Label>Question</Label>
                <Textarea value={editing.question} onChange={(e) => setEditing({ ...editing, question: e.target.value })} />
              </div>
              {(["a", "b", "c", "d"] as const).map((k) => (
                <div key={k}>
                  <Label>Option {k.toUpperCase()}</Label>
                  <Input
                    value={(editing as any)[`option_${k}`]}
                    onChange={(e) => setEditing({ ...editing, [`option_${k}`]: e.target.value } as QuestionRow)}
                  />
                </div>
              ))}
              <div>
                <Label>Correct Answer</Label>
                <Select
                  value={editing.correct_answer}
                  onValueChange={(v) => setEditing({ ...editing, correct_answer: v })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["A", "B", "C", "D"].map((x) => <SelectItem key={x} value={x}>{x}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Explanation</Label>
                <Textarea
                  value={editing.explanation || ""}
                  onChange={(e) => setEditing({ ...editing, explanation: e.target.value })}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={handleSaveEdit} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 mr-1 animate-spin" />} Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
};

export default QuestionBankPage;
