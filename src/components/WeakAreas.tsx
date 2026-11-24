import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, Lightbulb, Loader2, Sparkles, TrendingDown, TrendingUp, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { authHeader } from "@/lib/auth-header";
import { notifyAiTier } from "@/lib/ai-tier-notifier";
import { useAdmin } from "@/hooks/use-admin";
import { toast } from "sonner";

interface QuizRow {
  subject: string;
  score: number;
  total: number;
  quiz_type: string;
  created_at: string;
  details: any;
}

export interface SubjectStat {
  subject: string;
  attempts: number;
  avgPct: number;
  trend: "improving" | "declining" | "steady";
  lastPct: number;
}

interface MissedItem {
  subject: string;
  question: string;
  kind: "mcq" | "subjective";
}

const pct = (r: QuizRow) => (r.total > 0 ? Math.round((r.score / r.total) * 100) : 0);

export function computeSubjectStats(rows: QuizRow[]): SubjectStat[] {
  const bySubject = new Map<string, QuizRow[]>();
  rows.forEach((r) => {
    const list = bySubject.get(r.subject) || [];
    list.push(r);
    bySubject.set(r.subject, list);
  });
  const stats: SubjectStat[] = [];
  bySubject.forEach((list, subject) => {
    const sorted = [...list].sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at));
    const avgPct = Math.round(sorted.reduce((a, r) => a + pct(r), 0) / sorted.length);
    let trend: SubjectStat["trend"] = "steady";
    if (sorted.length >= 2) {
      const mid = Math.floor(sorted.length / 2);
      const older = sorted.slice(0, mid || 1);
      const newer = sorted.slice(mid || 1);
      if (newer.length) {
        const oldAvg = older.reduce((a, r) => a + pct(r), 0) / older.length;
        const newAvg = newer.reduce((a, r) => a + pct(r), 0) / newer.length;
        if (newAvg - oldAvg > 5) trend = "improving";
        else if (oldAvg - newAvg > 5) trend = "declining";
      }
    }
    stats.push({ subject, attempts: sorted.length, avgPct, trend, lastPct: pct(sorted[sorted.length - 1]) });
  });
  return stats.sort((a, b) => a.avgPct - b.avgPct);
}

export function collectMissed(rows: QuizRow[], limit = 8): MissedItem[] {
  const missed: MissedItem[] = [];
  const sorted = [...rows].sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
  for (const r of sorted) {
    const items = Array.isArray(r.details?.items) ? r.details.items : [];
    for (const it of items) {
      if (it?.kind === "mcq" && it.isCorrect === false && it.question) {
        missed.push({ subject: r.subject, question: it.question, kind: "mcq" });
      } else if (it?.kind === "subjective" && it.verdict && it.verdict !== "correct" && it.question) {
        missed.push({ subject: r.subject, question: it.question, kind: "subjective" });
      }
      if (missed.length >= limit) return missed;
    }
  }
  return missed;
}

function ruleBasedTips(stats: SubjectStat[]): string[] {
  const tips: string[] = [];
  const weak = stats.filter((s) => s.avgPct < 70);
  weak.slice(0, 3).forEach((s) => {
    tips.push(`Revise ${s.subject} — your average is ${s.avgPct}% over ${s.attempts} attempt${s.attempts > 1 ? "s" : ""}. Re-take a practice quiz after reviewing the basics.`);
  });
  stats.filter((s) => s.trend === "declining").slice(0, 2).forEach((s) => {
    tips.push(`${s.subject} scores are slipping — schedule short daily revision sessions before your next attempt.`);
  });
  const strong = stats[stats.length - 1];
  if (strong && strong.avgPct >= 80 && stats.length > 1) {
    tips.push(`Keep ${strong.subject} warm with an occasional quiz (${strong.avgPct}% average) while you focus on the weaker subjects.`);
  }
  if (tips.length === 0 && stats.length > 0) {
    tips.push("Solid work — all your subject averages are 70%+. Try mixed quizzes to keep every subject fresh.");
  }
  return tips;
}

const WeakAreas = ({ compact = false }: { compact?: boolean }) => {
  const { user } = useAuth();
  const { isAdmin } = useAdmin();
  const [rows, setRows] = useState<QuizRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [aiTips, setAiTips] = useState<{ summary: string; tips: string[] } | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    supabase
      .from("quiz_results")
      .select("subject, score, total, quiz_type, created_at, details")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(200)
      .then(({ data }) => {
        setRows((data as QuizRow[]) || []);
        setLoading(false);
      });
    // Load today's cached AI tips (no AI call on page load).
    try {
      const cached = localStorage.getItem(`ug-ai-tips-${user.id}-${new Date().toISOString().slice(0, 10)}`);
      if (cached) setAiTips(JSON.parse(cached));
    } catch { /* ignore */ }
  }, [user]);

  const stats = useMemo(() => computeSubjectStats(rows), [rows]);
  const missed = useMemo(() => collectMissed(rows), [rows]);
  const tips = useMemo(() => ruleBasedTips(stats), [stats]);

  const fetchAiTips = async () => {
    setAiLoading(true);
    try {
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/study-suggestions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `${await authHeader()}` },
        body: JSON.stringify({
          subjects: stats.map((s) => ({ subject: s.subject, attempts: s.attempts, avgPct: s.avgPct, trend: s.trend })),
          missedQuestions: missed.map((m) => m.question),
        }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || "Could not generate tips");
      }
      notifyAiTier(resp, isAdmin);
      const data = await resp.json();
      setAiTips(data);
      try {
        localStorage.setItem(`ug-ai-tips-${user!.id}-${new Date().toISOString().slice(0, 10)}`, JSON.stringify(data));
      } catch { /* ignore */ }
    } catch (e: any) {
      toast.error(e.message || "Could not generate tips");
    } finally {
      setAiLoading(false);
    }
  };

  if (!user) return null;
  if (loading) {
    return (
      <div className="glass rounded-2xl p-6 flex items-center gap-3">
        <Loader2 className="w-4 h-4 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Analysing your quiz history…</p>
      </div>
    );
  }
  if (rows.length === 0) {
    if (compact) return null;
    return (
      <div className="glass rounded-2xl p-8 text-center space-y-2">
        <div className="text-4xl">🎯</div>
        <h3 className="font-display font-semibold text-foreground">No weak areas yet</h3>
        <p className="text-sm text-muted-foreground">Take a practice quiz and this section will show where to focus, based on your real results.</p>
      </div>
    );
  }

  const shownStats = compact ? stats.slice(0, 3) : stats;

  return (
    <div className="glass rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="font-display font-semibold text-foreground flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-400" /> Weak Areas
          <span className="text-xs font-normal text-muted-foreground">from your quiz history</span>
        </h3>
        <Button size="sm" variant="outline" className="rounded-xl gap-1.5" onClick={fetchAiTips} disabled={aiLoading}>
          {aiLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          {aiTips ? "Refresh AI Tips" : "Get AI Study Tips"}
        </Button>
      </div>

      <div className="space-y-2">
        {shownStats.map((s, i) => (
          <motion.div
            key={s.subject}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04 }}
            className="flex items-center gap-3"
          >
            <div className="flex-1 min-w-0">
              <div className="flex justify-between text-xs gap-2">
                <span className="text-foreground truncate font-medium">{s.subject}</span>
                <span className="text-muted-foreground flex items-center gap-1.5 flex-shrink-0">
                  {s.trend === "declining" ? <TrendingDown className="w-3 h-3 text-destructive" /> : s.trend === "improving" ? <TrendingUp className="w-3 h-3 text-emerald-400" /> : <Minus className="w-3 h-3" />}
                  {s.avgPct}% avg • {s.attempts} attempt{s.attempts > 1 ? "s" : ""}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-muted/50 overflow-hidden mt-1">
                <div
                  className={`h-full rounded-full ${s.avgPct < 50 ? "bg-destructive" : s.avgPct < 70 ? "bg-amber-400" : "bg-emerald-400"}`}
                  style={{ width: `${s.avgPct}%` }}
                />
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {!compact && missed.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Recently missed — worth revisiting:</p>
          {missed.slice(0, 5).map((m, i) => (
            <p key={i} className="text-xs text-foreground/80 truncate">• <span className="text-muted-foreground">{m.subject}:</span> {m.question}</p>
          ))}
        </div>
      )}

      <div className="rounded-xl bg-primary/5 border border-primary/10 p-3 space-y-1.5">
        <p className="text-xs font-medium text-foreground flex items-center gap-1.5">
          <Lightbulb className="w-3.5 h-3.5 text-primary" /> Study suggestions
        </p>
        {tips.map((t, i) => (
          <p key={i} className="text-xs text-muted-foreground">• {t}</p>
        ))}
        {aiTips && (
          <div className="pt-1.5 space-y-1.5 border-t border-primary/10 mt-2">
            <p className="text-xs text-foreground/90">{aiTips.summary}</p>
            {aiTips.tips.map((t, i) => (
              <p key={i} className="text-xs text-muted-foreground">✦ {t}</p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default WeakAreas;
