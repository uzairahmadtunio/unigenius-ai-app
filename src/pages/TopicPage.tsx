import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  AlertTriangle, ArrowLeft, ArrowRight, Bot, CheckCircle2, Code2,
  HelpCircle, Loader2, Sparkles, Target,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import StudyMarkdown from "@/components/StudyMarkdown";
import CodeExampleCard from "@/components/CodeExampleCard";
import { findSubjectById } from "@/data/subjects";
import { useDepartment } from "@/contexts/DepartmentContext";
import { authHeader } from "@/lib/auth-header";
import {
  fetchSubjectTopics,
  fetchTopicPage,
  type SubjectTopic,
  type TopicPageData,
} from "@/lib/notes-reader";
import { toast } from "sonner";

const QUIZ_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-quiz`;

interface BankQuestion {
  question: string;
  options: { A: string; B: string; C: string; D: string };
  correct: string;
  explanation: string;
  topic: string;
}

const normTopic = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

/**
 * Practice strip: pulls this topic's questions LIVE from question_bank
 * through generate-quiz's bankOnly fast path (the bank is teacher/admin
 * RLS, so the service-role function is the read path). Matching is
 * catalogue-based: the bank's own topic strings for the subject are
 * fetched first, then matched to this page's title by containment, so
 * bank vocabulary ("Loops") finds its page ("Loops") even when titles
 * differ in detail. No bank match -> a graceful hand-off to Practice
 * Mode, which generates questions with AI instead.
 */
const PracticeStrip = ({ subjectName, topicTitle }: { subjectName: string; topicTitle: string }) => {
  const navigate = useNavigate();
  const [state, setState] = useState<"loading" | "ready" | "empty" | "error">("loading");
  const [questions, setQuestions] = useState<BankQuestion[]>([]);
  const [picked, setPicked] = useState<Record<number, string>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const headers = { "Content-Type": "application/json", Authorization: `${await authHeader()}` };
        const catResp = await fetch(QUIZ_URL, {
          method: "POST", headers,
          body: JSON.stringify({ mode: "topics", subject: subjectName }),
        });
        const cat = await catResp.json().catch(() => ({}));
        const bankTopics: { topic: string; count: number }[] = cat.topics ?? [];
        const pageNorm = normTopic(topicTitle);
        const match = bankTopics.find((t) => {
          const bn = normTopic(t.topic);
          return bn === pageNorm || pageNorm.includes(bn) || bn.includes(pageNorm);
        });
        if (!match) { if (!cancelled) setState("empty"); return; }
        const qResp = await fetch(QUIZ_URL, {
          method: "POST", headers,
          body: JSON.stringify({ subject: subjectName, topic: match.topic, count: 5, bankOnly: true }),
        });
        const qData = await qResp.json().catch(() => ({}));
        const qs: BankQuestion[] = qData.questions ?? [];
        if (cancelled) return;
        if (qs.length === 0) { setState("empty"); return; }
        setQuestions(qs);
        setState("ready");
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => { cancelled = true; };
  }, [subjectName, topicTitle]);

  if (state === "loading") {
    return (
      <div className="glass rounded-2xl border border-border p-5 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading practice questions…
      </div>
    );
  }

  if (state === "empty" || state === "error") {
    return (
      <div className="glass rounded-2xl border border-border p-5 space-y-3">
        <div className="flex items-center gap-2">
          <HelpCircle className="w-4 h-4 text-primary" />
          <h3 className="font-display font-bold text-sm text-foreground">Practice — {topicTitle}</h3>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">
          There are no ready-made bank questions for this topic yet. You can generate questions on this topic with AI in Practice Mode and practise
          right away — those questions are also saved to the bank.
        </p>
        <Button size="sm" className="rounded-xl text-xs gap-1.5 gradient-primary text-primary-foreground" onClick={() => navigate("/practice")}>
          <Sparkles className="w-3.5 h-3.5" /> Open Practice Mode
        </Button>
      </div>
    );
  }

  return (
    <div className="glass rounded-2xl border border-border p-5 space-y-5">
      <div className="flex items-center gap-2">
        <Target className="w-4 h-4 text-primary" />
        <h3 className="font-display font-bold text-sm text-foreground">Practice — {topicTitle}</h3>
        <Badge variant="secondary" className="text-[10px] rounded-lg">{questions.length} questions · Question Bank</Badge>
      </div>
      {questions.map((q, qi) => {
        const chosen = picked[qi];
        const revealed = chosen !== undefined;
        return (
          <div key={qi} className="space-y-2">
            <p className="text-sm font-medium text-foreground leading-relaxed">
              {qi + 1}. {q.question}
            </p>
            <div className="grid gap-1.5">
              {(["A", "B", "C", "D"] as const).map((letter) => {
                const isCorrect = q.correct === letter;
                const isChosen = chosen === letter;
                let cls = "border-border hover:border-primary/50";
                if (revealed && isCorrect) cls = "border-green-500/60 bg-green-500/10";
                else if (revealed && isChosen) cls = "border-red-500/60 bg-red-500/10";
                else if (revealed) cls = "border-border opacity-70";
                return (
                  <button
                    key={letter}
                    disabled={revealed}
                    onClick={() => setPicked((p) => ({ ...p, [qi]: letter }))}
                    className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm transition-colors ${cls}`}
                  >
                    <span className="w-6 h-6 rounded-lg bg-muted flex items-center justify-center text-[11px] font-bold shrink-0">
                      {letter}
                    </span>
                    <span className="flex-1">{q.options[letter]}</span>
                    {revealed && isCorrect && <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />}
                  </button>
                );
              })}
            </div>
            {revealed && (
              <p className={`text-xs leading-relaxed rounded-xl px-3 py-2 ${chosen === q.correct ? "bg-green-500/10 text-foreground" : "bg-red-500/10 text-foreground"}`}>
                {chosen === q.correct ? "✓ Correct! " : `✗ Wrong — the correct answer is ${q.correct}. `}
                {q.explanation}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
};

const TopicPage = () => {
  const { subjectId, topicSlug } = useParams<{ subjectId: string; topicSlug: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { department } = useDepartment();

  const result = findSubjectById(subjectId || "", department);
  const nameParam = searchParams.get("name");
  const subjectName = result?.subject.name ?? nameParam ?? "Unknown Subject";

  const [topics, setTopics] = useState<SubjectTopic[]>([]);
  const [page, setPage] = useState<TopicPageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const hubUrl = useMemo(() => {
    const qs = searchParams.toString();
    return `/subject/${subjectId}${qs ? `?${qs}` : ""}`;
  }, [subjectId, searchParams]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setNotFound(false);
      const all = await fetchSubjectTopics(subjectName);
      if (cancelled) return;
      setTopics(all);
      const topic = all.find((t) => t.slug === topicSlug);
      if (!topic) { setNotFound(true); setLoading(false); return; }
      const p = await fetchTopicPage(topic.id);
      if (cancelled) return;
      if (!p) { setNotFound(true); setLoading(false); return; }
      setPage(p);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [subjectName, topicSlug]);

  const currentIdx = topics.findIndex((t) => t.slug === topicSlug);
  const current = topics[currentIdx];
  const prev = currentIdx > 0 ? topics[currentIdx - 1] : null;
  const next = currentIdx >= 0 && currentIdx < topics.length - 1 ? topics[currentIdx + 1] : null;

  const openTopic = (t: SubjectTopic) => {
    const qs = searchParams.toString();
    navigate(`/subject/${subjectId}/topic/${t.slug}${qs ? `?${qs}` : ""}`);
  };

  const askTutor = () => {
    if (!current) return;
    try {
      sessionStorage.setItem(
        "ug-hub-prefill",
        `Explain this topic in simple words with an example: ${current.title}`,
      );
    } catch { /* ignore */ }
    navigate(hubUrl);
  };

  return (
    <div className="min-h-screen flex flex-col gradient-hero">
      <Navbar />
      <div className="flex-1 w-full max-w-3xl mx-auto px-4 py-4">
        <div className="flex items-center gap-3 mb-4">
          <Button variant="ghost" size="icon" className="rounded-xl" onClick={() => navigate(hubUrl)}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-muted-foreground truncate">{subjectName}</p>
            <h1 className="font-display font-bold text-lg text-foreground leading-snug">
              {loading ? "Loading…" : page?.title ?? current?.title ?? "Topic"}
            </h1>
          </div>
          {current && (
            <Badge variant="secondary" className="text-xs rounded-lg shrink-0">
              Topic {current.topic_no} of {topics.length}
            </Badge>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : notFound || !page ? (
          <div className="glass rounded-2xl p-8 text-center space-y-4">
            <p className="text-4xl">🔍</p>
            <h2 className="font-display font-bold text-xl text-foreground">Topic page not ready yet</h2>
            <p className="text-sm text-muted-foreground">
              This topic's study page is not published yet. You can study other topics from the subject hub.
            </p>
            <Button onClick={() => navigate(hubUrl)} className="rounded-xl gradient-primary text-primary-foreground">
              Back to {subjectName}
            </Button>
          </div>
        ) : (
          <div className="space-y-6 pb-6">
            <div className="glass rounded-2xl border border-border p-5 sm:p-7">
              <StudyMarkdown content={page.body_md} />
              {page.diagram_md && (
                <div className="mt-6 rounded-xl border border-dashed border-border p-4">
                  <p className="text-xs font-semibold text-muted-foreground mb-2">DIAGRAM</p>
                  <StudyMarkdown content={page.diagram_md} />
                </div>
              )}
            </div>

            {page.code_examples.length > 0 && (
              <div className="glass rounded-2xl border border-border p-5 sm:p-7 space-y-5">
                <div className="flex items-center gap-2">
                  <Code2 className="w-4 h-4 text-primary" />
                  <h2 className="font-display font-bold text-base text-foreground">Code Examples</h2>
                </div>
                {page.code_examples.map((ex, i) => (
                  <CodeExampleCard key={i} example={ex} />
                ))}
              </div>
            )}

            {page.key_points.length > 0 && (
              <div className="glass rounded-2xl border border-border p-5 sm:p-7">
                <div className="flex items-center gap-2 mb-3">
                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                  <h2 className="font-display font-bold text-base text-foreground">Key Points — for revision</h2>
                </div>
                <ul className="space-y-2">
                  {page.key_points.map((kp, i) => (
                    <li key={i} className="flex gap-2 text-sm leading-relaxed text-foreground/90">
                      <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0 mt-0.5" />
                      <span>{kp}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {page.common_mistakes.length > 0 && (
              <div className="glass rounded-2xl border border-amber-500/30 p-5 sm:p-7">
                <div className="flex items-center gap-2 mb-3">
                  <AlertTriangle className="w-4 h-4 text-amber-500" />
                  <h2 className="font-display font-bold text-base text-foreground">Common Mistakes — avoid these</h2>
                </div>
                <ul className="space-y-2">
                  {page.common_mistakes.map((cm, i) => (
                    <li key={i} className="flex gap-2 text-sm leading-relaxed text-foreground/90">
                      <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                      <span>{cm}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <PracticeStrip subjectName={subjectName} topicTitle={page.title} />

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" className="rounded-xl text-xs gap-1.5" onClick={askTutor}>
                <Bot className="w-3.5 h-3.5" /> Ask Tutor about this topic
              </Button>
            </div>

            <div className="flex items-center justify-between gap-2 pt-2">
              {prev ? (
                <Button variant="outline" className="rounded-xl text-xs gap-1.5" onClick={() => openTopic(prev)}>
                  <ArrowLeft className="w-3.5 h-3.5" /> {prev.title}
                </Button>
              ) : <span />}
              {next ? (
                <Button className="rounded-xl text-xs gap-1.5 gradient-primary text-primary-foreground" onClick={() => openTopic(next)}>
                  {next.title} <ArrowRight className="w-3.5 h-3.5" />
                </Button>
              ) : <span />}
            </div>
          </div>
        )}
      </div>
      <Footer />
    </div>
  );
};

export default TopicPage;
