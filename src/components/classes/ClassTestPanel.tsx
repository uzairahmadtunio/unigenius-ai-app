import { useState } from "react";
import { CheckCircle2, Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  pct, startClassTest, submitClassTest,
  type ClassPostRow, type ClassTestQuestion, type TestAttemptRow,
} from "@/lib/classes";

interface Props {
  post: ClassPostRow;
  userId: string;
  isTeacher: boolean;
  myAttempt: TestAttemptRow | null;
  attempts: TestAttemptRow[];
  names: Map<string, string>;
  onChanged: () => void;
}

/**
 * Class test block. Questions come from the existing Question Bank and
 * are served by the start_class_test RPC WITHOUT their answers;
 * submit_class_test scores on the server and mirrors the result into
 * the student's quiz_results history.
 */
export const ClassTestPanel = ({ post, isTeacher, myAttempt, attempts, names, onChanged }: Props) => {
  if (isTeacher) {
    const done = attempts.filter((a) => a.status === "submitted");
    const avg = done.length ? Math.round(done.reduce((s, a) => s + pct(a.score, a.total), 0) / done.length) : null;
    return (
      <div className="mt-3 space-y-2">
        <p className="text-xs text-muted-foreground">
          <b className="text-foreground">{done.length}</b> students attempted{avg !== null && <> · class average <b className="text-foreground">{avg}%</b></>}
        </p>
        {done.map((a) => (
          <div key={a.id} className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
            <span className="truncate">{names.get(a.student_id) || "Student"}</span>
            <span className="font-semibold shrink-0">{a.score}/{a.total} · {pct(a.score, a.total)}%</span>
          </div>
        ))}
        {done.length === 0 && <p className="text-xs text-muted-foreground">No attempts yet.</p>}
      </div>
    );
  }
  return <StudentRunner post={post} myAttempt={myAttempt} onChanged={onChanged} />;
};

const StudentRunner = ({ post, myAttempt, onChanged }: { post: ClassPostRow; myAttempt: TestAttemptRow | null; onChanged: () => void }) => {
  const [phase, setPhase] = useState<"idle" | "loading" | "running" | "done">("idle");
  const [questions, setQuestions] = useState<ClassTestQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ score: number; total: number; marks?: number } | null>(
    myAttempt?.status === "submitted" ? { score: myAttempt.score || 0, total: myAttempt.total || 0 } : null,
  );
  const [busy, setBusy] = useState(false);

  const meta = (post.meta || {}) as { subject?: string; topic?: string; question_count?: number; marks_per_question?: number };
  const per = meta.marks_per_question || 1;

  const start = async () => {
    setPhase("loading");
    try {
      const r = await startClassTest(post.id);
      if (r.status === "submitted") {
        setResult({ score: r.score, total: r.total });
        setPhase("done");
      } else if (r.status === "started") {
        setQuestions(r.questions);
        setPhase("running");
      } else if (r.status === "no_questions") {
        toast.error("No questions are available for this subject yet");
        setPhase("idle");
      } else {
        toast.error("You need to be a member of this class to take the test");
        setPhase("idle");
      }
    } catch (e: any) {
      toast.error(e?.message || "Could not start the test");
      setPhase("idle");
    }
  };

  const submit = async () => {
    if (Object.keys(answers).length < questions.length) {
      toast.error(`Answer all ${questions.length} questions first (${Object.keys(answers).length} done)`);
      return;
    }
    setBusy(true);
    try {
      const r = await submitClassTest(post.id, answers);
      if (r.status === "submitted") {
        setResult({ score: r.score || 0, total: r.total || questions.length, marks: r.marks });
        setPhase("done");
        onChanged();
      } else {
        toast.error("Could not submit — please try again");
      }
    } catch (e: any) {
      toast.error(e?.message || "Could not submit");
    } finally {
      setBusy(false);
    }
  };

  if (result || phase === "done") {
    const r = result || { score: 0, total: questions.length };
    return (
      <div className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 flex items-center gap-3">
        <CheckCircle2 className="w-6 h-6 text-emerald-500 shrink-0" />
        <div>
          <p className="text-sm font-bold">Test submitted</p>
          <p className="text-xs text-muted-foreground">
            You scored <b className="text-foreground">{r.score}/{r.total}</b> ({pct(r.score, r.total)}%)
            {r.marks !== undefined ? <> · <b className="text-foreground">{r.marks} marks</b></> : <> · <b className="text-foreground">{r.score * per} marks</b></>}
          </p>
        </div>
      </div>
    );
  }

  if (phase === "running") {
    return (
      <div className="mt-3 space-y-3">
        {questions.map((q, i) => (
          <div key={q.id} className="rounded-xl border border-border p-3 space-y-2">
            <p className="text-sm font-medium leading-relaxed"><span className="text-primary font-bold mr-1.5">{i + 1}.</span>{q.question}</p>
            <div className="grid gap-1.5">
              {(["A", "B", "C", "D"] as const).map((letter) => {
                const text = letter === "A" ? q.option_a : letter === "B" ? q.option_b : letter === "C" ? q.option_c : q.option_d;
                const selected = answers[q.id] === letter;
                return (
                  <button
                    key={letter}
                    onClick={() => setAnswers((prev) => ({ ...prev, [q.id]: letter }))}
                    aria-pressed={selected}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-[13px] transition-all",
                      selected
                        ? "gradient-primary text-primary-foreground border-transparent font-semibold shadow-sm"
                        : "border-border hover:border-primary/50 hover:bg-primary/5",
                    )}
                  >
                    <span className={cn(
                      "w-5 h-5 rounded-md flex items-center justify-center text-[11px] font-bold shrink-0",
                      selected ? "bg-white/25 text-white" : "bg-primary/10 text-primary",
                    )}>{letter}</span>
                    <span className="flex-1">{text}</span>
                    {selected && <CheckCircle2 className="w-4 h-4 shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        <Button className="w-full rounded-xl gradient-primary" onClick={() => void submit()} disabled={busy}>
          {busy && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />} Submit Test
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 px-3.5 py-3">
      <p className="text-xs text-muted-foreground">
        {meta.question_count || 10} questions · {(meta.question_count || 10) * per} marks · from the Question Bank
      </p>
      <Button size="sm" className="rounded-lg gradient-primary gap-1.5 shrink-0" onClick={() => void start()} disabled={phase === "loading"}>
        {phase === "loading" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
        Start Test
      </Button>
    </div>
  );
};

export default ClassTestPanel;
