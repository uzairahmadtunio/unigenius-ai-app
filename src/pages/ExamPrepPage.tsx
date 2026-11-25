import { ClipboardList, FileText, Mic, Layers, ChevronRight, CalendarClock, Target, Play, LogIn, type LucideIcon } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import PageShell from "@/components/PageShell";
import ExamCountdown from "@/components/ExamCountdown";
import { motion } from "framer-motion";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrentSemester } from "@/hooks/use-current-semester";
import { supabase } from "@/integrations/supabase/client";

interface ExamPrepFeature {
  icon: LucideIcon;
  title: string;
  desc: string;
  path: string;
  tile: string;
}

const features: ExamPrepFeature[] = [
  { icon: FileText, title: "Past Papers", desc: "Practice with previous years' midterm and final papers", path: "/past-papers", tile: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  { icon: Mic, title: "Viva Prep", desc: "AI-simulated viva sessions for every subject", path: "/viva-prep", tile: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  { icon: Layers, title: "Quick Revision", desc: "AI flashcards from your notes and lab manuals", path: "/flashcards", tile: "bg-teal-500/10 text-teal-400 border-teal-500/20" },
];

interface UpcomingExam {
  id: string;
  subject: string;
  exam_type: string;
  exam_date: string;
}

interface QuizResultRow {
  subject: string;
  details: { topicStats?: { topic: string; accuracy: number; total: number }[] } | null;
}

interface FlashcardSetRow {
  id: string;
  cards: unknown[];
}

interface FlashcardReviewRow {
  set_id: string;
  card_index: number;
  next_review: string;
}

interface WeakTopic {
  subject: string;
  topic: string;
  accuracy: number;
  total: number;
}

const daysUntil = (iso: string) => {
  const ms = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86400000));
};

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const ExamPrepPage = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { semester } = useCurrentSemester();

  // Upcoming exams for the student's own semester (same source as the
  // dashboard countdown — this page used to be three static links).
  const { data: exams = [] } = useQuery({
    queryKey: ["exam-prep-exams", semester],
    enabled: !!user,
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      const { data } = await supabase
        .from("exam_schedule")
        .select("id, subject, exam_type, exam_date")
        .eq("semester", semester)
        .gte("exam_date", new Date().toISOString())
        .order("exam_date", { ascending: true })
        .limit(5);
      return (data as UpcomingExam[]) || [];
    },
  });

  // Weak topics aggregated from the student's real quiz history
  // (quiz_results.details.topicStats, written by Practice Mode).
  const { data: weakTopics = [] } = useQuery({
    queryKey: ["exam-prep-weak", user?.id],
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data } = await supabase
        .from("quiz_results")
        .select("subject, details")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(10);
      const agg = new Map<string, { subject: string; topic: string; weighted: number; total: number }>();
      ((data as unknown as QuizResultRow[] | null) ?? []).forEach((row) => {
        const stats = Array.isArray(row.details?.topicStats) ? row.details.topicStats : [];
        stats.forEach((s) => {
          if (!s?.topic || typeof s.accuracy !== "number" || !s.total) return;
          const key = `${row.subject}::${s.topic}`;
          const cur = agg.get(key) ?? { subject: row.subject, topic: s.topic, weighted: 0, total: 0 };
          cur.weighted += s.accuracy * s.total;
          cur.total += s.total;
          agg.set(key, cur);
        });
      });
      return [...agg.values()]
        .map((v) => ({ subject: v.subject, topic: v.topic, accuracy: v.total ? v.weighted / v.total : 0, total: v.total }))
        .filter((v) => v.total >= 2 && v.accuracy < 0.7)
        .sort((a, b) => a.accuracy - b.accuracy)
        .slice(0, 5) as WeakTopic[];
    },
  });

  // Flashcards due for review today (same SRS rule as the Flashcards page).
  const { data: dueCards = 0 } = useQuery({
    queryKey: ["exam-prep-due", user?.id, semester],
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const [{ data: sets }, { data: reviews }] = await Promise.all([
        supabase.from("flashcard_sets").select("id, cards").eq("user_id", user!.id).eq("semester", semester),
        (supabase.from("flashcard_reviews" as never) as unknown as {
          select: (cols: string) => {
            eq: (col: string, val: string) => Promise<{ data: FlashcardReviewRow[] | null }>;
          };
        }).select("set_id, card_index, next_review").eq("user_id", user!.id),
      ]);
      const today = todayStr();
      const reviewFor = (setId: string, idx: number) =>
        (reviews ?? []).find((r) => r.set_id === setId && r.card_index === idx);
      let due = 0;
      ((sets as unknown as FlashcardSetRow[] | null) ?? []).forEach((s) => {
        const cards = Array.isArray(s.cards) ? s.cards : [];
        cards.forEach((_, i) => {
          const r = reviewFor(s.id, i);
          if (!r || r.next_review <= today) due += 1;
        });
      });
      return due;
    },
  });

  return (
    <PageShell
      title="Exam Prep"
      subtitle="Midterms & Finals"
      icon={
        <div className="w-10 h-10 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center">
          <ClipboardList className="w-5 h-5 text-rose-400" />
        </div>
      }
    >
      <div className="space-y-6">
        {!user && (
          <button
            type="button"
            onClick={() => navigate("/auth")}
            className="glass rounded-2xl w-full text-left p-4 flex items-center gap-4 border border-primary/20 hover:border-primary/40 transition-all"
          >
            <span className="w-11 h-11 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
              <LogIn className="w-5 h-5 text-primary" />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block font-display font-semibold text-foreground">Sign in for your personal prep plan</span>
              <span className="block text-sm text-muted-foreground mt-0.5">Your exam countdown, weak topics and due flashcards appear here.</span>
            </span>
            <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />
          </button>
        )}

        {user && (
          <>
            {/* Next exam countdown (live from exam_schedule) */}
            <ExamCountdown semester={semester} />

            {/* Upcoming exams for this semester */}
            <section className="space-y-3">
              <h2 className="font-display font-semibold text-foreground flex items-center gap-2">
                <CalendarClock className="w-4 h-4 text-rose-400" /> Upcoming Exams — Semester {semester}
              </h2>
              {exams.length === 0 ? (
                <div className="glass rounded-2xl p-4 text-sm text-muted-foreground">
                  No exams are scheduled for Semester {semester} yet. When your university publishes the date sheet, it will appear here with a countdown.
                </div>
              ) : (
                <div className="space-y-2">
                  {exams.map((exam) => {
                    const days = daysUntil(exam.exam_date);
                    return (
                      <div key={exam.id} className="glass rounded-2xl px-4 py-3 flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm text-foreground truncate">{exam.subject}</p>
                          <p className="text-xs text-muted-foreground">
                            {exam.exam_type} · {new Date(exam.exam_date).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}
                          </p>
                        </div>
                        <span className={`text-xs font-semibold rounded-full px-2.5 py-1 ${days <= 3 ? "bg-destructive/15 text-destructive" : days <= 7 ? "bg-amber-500/15 text-amber-500" : "bg-primary/10 text-primary"}`}>
                          {days === 0 ? "Today" : `${days}d left`}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Weak topics from real quiz history */}
            <section className="space-y-3">
              <h2 className="font-display font-semibold text-foreground flex items-center gap-2">
                <Target className="w-4 h-4 text-rose-400" /> Focus Areas — Your Weak Topics
              </h2>
              {weakTopics.length === 0 ? (
                <div className="glass rounded-2xl p-4 text-sm text-muted-foreground">
                  No weak topics yet. Take a few Practice Mode quizzes and this section will show exactly which topics to revise first.
                </div>
              ) : (
                <div className="space-y-2">
                  {weakTopics.map((w) => (
                    <div key={`${w.subject}-${w.topic}`} className="glass rounded-2xl px-4 py-3 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm text-foreground truncate">{w.topic}</p>
                        <p className="text-xs text-muted-foreground">
                          {w.subject} · {Math.round(w.accuracy * 100)}% accuracy over {w.total} questions
                        </p>
                      </div>
                      <div className="w-20 h-1.5 rounded-full bg-white/5 overflow-hidden flex-shrink-0">
                        <div className="h-full rounded-full bg-rose-400" style={{ width: `${Math.round(w.accuracy * 100)}%` }} />
                      </div>
                      <button
                        type="button"
                        onClick={() => navigate("/practice", { state: { subject: w.subject, topic: w.topic } })}
                        className="gradient-button text-white rounded-full px-3.5 h-8 text-xs font-semibold inline-flex items-center gap-1.5 flex-shrink-0"
                      >
                        <Play className="w-3.5 h-3.5" /> Practice
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Due flashcards */}
            <button
              type="button"
              onClick={() => navigate("/flashcards")}
              className="glass rounded-2xl w-full text-left p-4 flex items-center gap-4 hover:border-teal-400/30 border border-transparent transition-all group"
            >
              <span className="w-11 h-11 rounded-2xl bg-teal-500/10 border border-teal-500/20 flex items-center justify-center flex-shrink-0">
                <Layers className="w-5 h-5 text-teal-400" />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block font-display font-semibold text-foreground group-hover:text-primary transition-colors">
                  {dueCards > 0 ? `${dueCards} flashcards due for review` : "Flashcards up to date"}
                </span>
                <span className="block text-sm text-muted-foreground mt-0.5">
                  {dueCards > 0 ? "Clear today's revision queue before the exam." : "No cards are due today — nice and steady."}
                </span>
              </span>
              <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors flex-shrink-0" />
            </button>
          </>
        )}

        {/* Original prep routes */}
        <section className="space-y-3">
          <h2 className="font-display font-semibold text-foreground">More Ways to Prepare</h2>
          <div className="space-y-3">
            {features.map((f, i) => (
              <motion.button
                key={f.title}
                type="button"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.08 }}
                onClick={() => navigate(f.path)}
                className="glass rounded-2xl w-full text-left p-4 flex items-center gap-4 cursor-pointer hover:border-primary/30 border border-transparent transition-all hover:shadow-lg group min-h-[104px]"
              >
                <span className={`w-14 h-14 rounded-2xl border flex items-center justify-center flex-shrink-0 ${f.tile}`}>
                  <f.icon className="w-6 h-6" />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block font-display font-semibold text-foreground group-hover:text-primary transition-colors">{f.title}</span>
                  <span className="block text-sm text-muted-foreground mt-1 leading-snug">{f.desc}</span>
                </span>
                <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors flex-shrink-0" />
              </motion.button>
            ))}
          </div>
        </section>
      </div>
    </PageShell>
  );
};

export default ExamPrepPage;
