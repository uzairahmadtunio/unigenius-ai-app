import { motion } from "framer-motion";
import { Clock, Play, HelpCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * One question from the bank, picked deterministically by day-of-year so
 * every student sees the same "Quiz of the Day" and it rotates daily.
 * The Play button drops the student into Practice Mode.
 */
const QuizOfDayCard = () => {
  const navigate = useNavigate();
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
    today.getDate()
  ).padStart(2, "0")}`;
  const dayOfYear = Math.floor(
    (today.getTime() - new Date(today.getFullYear(), 0, 0).getTime()) / 86400000
  );

  const { data, isLoading } = useQuery({
    queryKey: ["quiz-of-day", todayStr],
    staleTime: 60 * 60 * 1000,
    queryFn: async () => {
      const { count } = await supabase
        .from("question_bank")
        .select("id", { count: "exact", head: true });
      if (!count) return null;
      const idx = dayOfYear % count;
      const { data: row, error } = await supabase
        .from("question_bank")
        .select("id, subject, topic, question")
        .order("created_at", { ascending: true })
        .range(idx, idx)
        .single();
      if (error) return null;
      return row as { id: string; subject: string | null; topic: string | null; question: string };
    },
  });

  if (isLoading) {
    return (
      <div className="glass rounded-2xl p-4 sm:p-5 animate-pulse">
        <div className="flex items-center justify-between">
          <div className="h-5 w-32 rounded-full bg-white/5" />
          <div className="h-5 w-14 rounded-full bg-white/5" />
        </div>
        <div className="mt-4 space-y-2">
          <div className="h-4 w-full rounded bg-white/5" />
          <div className="h-4 w-2/3 rounded bg-white/5" />
        </div>
        <div className="mt-4 h-9 w-28 rounded-full bg-white/5" />
      </div>
    );
  }

  if (!data) return null;

  const tag = data.topic || data.subject;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2 }}
      className="glass rounded-2xl p-4 sm:p-5 h-full flex flex-col transition-shadow hover:shadow-elevated"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 bg-primary/15 text-primary text-[10px] font-bold tracking-widest rounded-full px-2.5 py-1">
          <HelpCircle className="w-3 h-3" />
          QUIZ OF THE DAY
        </span>
        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground bg-white/5 rounded-full px-2 py-1">
          <Clock className="w-3 h-3" /> 2 min
        </span>
      </div>

      <p className="mt-4 font-display font-medium text-base leading-relaxed text-foreground line-clamp-3">
        Q. {data.question}
      </p>

      <div className="flex items-center gap-3 flex-wrap mt-auto pt-4">
        <button
          onClick={() =>
            navigate("/practice", {
              state: { dailyQuestionId: data.id, dailySubject: data.subject || "Quiz of the Day" },
            })
          }
          className="gradient-button text-white rounded-full px-4 h-9 text-sm font-semibold inline-flex items-center gap-1.5 transition-transform duration-200 hover:scale-[1.03] active:scale-95"
        >
          <Play className="w-4 h-4" /> Play now
        </button>
        {tag && (
          <span className="text-xs text-muted-foreground bg-white/5 rounded-full px-2.5 py-1">
            {tag}
          </span>
        )}
      </div>
    </motion.div>
  );
};

export default QuizOfDayCard;
