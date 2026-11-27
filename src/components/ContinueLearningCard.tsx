import { motion } from "framer-motion";
import { Play, Brain, Trophy } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

/**
 * Continue-where-you-left-off card (approved Dashboard v2 design).
 *
 * Shows the student's MOST RECENT learning activity, whichever kind it
 * was — the audit (2026-11-27) found the card missing in every run
 * because it only looked at lecture progress: a student whose latest
 * activity was practice/quizzes (or who had not started a playlist
 * yet) got no card at all. Now:
 *   - lecture activity  → the unfinished playlist, next video, x/y bar
 *   - quiz/practice     → the latest result, score bar, tap to retry
 *   - no activity yet   → a "start learning" card in the same shell
 * Renders nothing only for guests.
 */
type CardData =
  | {
      kind: "lecture";
      subject: string;
      title: string;
      thumbVideoId: string | null;
      nextTitle: string | null;
      watched: number;
      total: number;
      link: string;
    }
  | {
      kind: "quiz";
      subject: string;
      title: string;
      detail: string;
      score: number;
      total: number;
      link: string;
    }
  | { kind: "start" };

const ContinueLearningCard = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const { data } = useQuery({
    queryKey: ["continue-learning", user?.id],
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<CardData | null> => {
      // ── Lecture progress (most recent first) ──────────────────────
      let progressRows: any[] | null = null;
      const primary = await supabase
        .from("user_lecture_progress" as any)
        .select("lecture_id, video_id, watched_at")
        .eq("user_id", user!.id)
        .order("watched_at", { ascending: false });
      if (!primary.error && primary.data) {
        progressRows = primary.data as any[];
      } else {
        // Fallback if the progress table timestamps rows differently.
        const fallback = await supabase
          .from("user_lecture_progress" as any)
          .select("lecture_id, video_id, created_at")
          .eq("user_id", user!.id)
          .order("created_at", { ascending: false });
        progressRows = (fallback.data as any[]) || [];
      }
      const rows = progressRows || [];
      const lectureTs = rows.length
        ? new Date((rows[0] as any).watched_at || (rows[0] as any).created_at || 0).getTime()
        : 0;

      let lectureCard: CardData | null = null;
      if (rows.length > 0) {
        // Most-recent-first lecture order + watched video ids per lecture.
        const orderedIds: string[] = [];
        const watchedByLecture = new Map<string, Set<string>>();
        rows.forEach((r) => {
          if (!watchedByLecture.has(r.lecture_id)) {
            watchedByLecture.set(r.lecture_id, new Set());
            orderedIds.push(r.lecture_id);
          }
          watchedByLecture.get(r.lecture_id)!.add(r.video_id);
        });

        const { data: lectureRows } = await supabase
          .from("subject_lectures" as any)
          .select("id, subject, title, video_count, thumb_video_id")
          .in("id", orderedIds);
        const lectureById = new Map<string, any>();
        ((lectureRows as any[]) || []).forEach((l) => lectureById.set(l.id, l));

        // Prefer the most recently watched playlist that still has
        // unwatched videos; fall back to the most recent one overall.
        const pickedId =
          orderedIds.find((id) => {
            const lec = lectureById.get(id);
            const total = lec?.video_count || 0;
            return total > 0 && (watchedByLecture.get(id)?.size || 0) < total;
          }) || orderedIds[0];
        const lecture = lectureById.get(pickedId);
        if (lecture) {
          const watchedSet = watchedByLecture.get(pickedId) || new Set<string>();

          const { data: videoRows } = await supabase
            .from("lecture_videos" as any)
            .select("video_id, title, position")
            .eq("lecture_id", pickedId)
            .order("position", { ascending: true });
          const videos = (videoRows as any[]) || [];
          const next = videos.find((v) => !watchedSet.has(v.video_id)) || null;

          const total = lecture.video_count || videos.length;
          const watched = Math.min(watchedSet.size, total || watchedSet.size);
          if (total > 0) {
            lectureCard = {
              kind: "lecture",
              subject: lecture.subject as string,
              title: lecture.title as string,
              thumbVideoId: (lecture.thumb_video_id as string | null) || null,
              nextTitle: (next?.title as string | undefined) || null,
              watched,
              total,
              link: "/lectures",
            };
          }
        }
      }

      // ── Latest quiz / practice result ─────────────────────────────
      const { data: quizRows } = await supabase
        .from("quiz_results")
        .select("subject, score, total, quiz_type, details, created_at")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(1);
      const quiz = (quizRows as any[])?.[0] || null;
      const quizTs = quiz ? new Date(quiz.created_at).getTime() : 0;

      if (quiz && quizTs >= lectureTs) {
        const isClassTest = quiz.quiz_type === "class-test";
        const topic = (quiz.details as any)?.topic as string | undefined;
        return {
          kind: "quiz",
          subject: String(quiz.subject || "Practice"),
          title: topic || (isClassTest ? "Class Test" : "Practice Session"),
          detail: `Last score ${quiz.score}/${quiz.total} — tap to ${isClassTest ? "open your classes" : "practice again"}`,
          score: Number(quiz.score) || 0,
          total: Number(quiz.total) || 0,
          link: isClassTest ? "/classes" : "/practice",
        };
      }

      if (lectureCard) return lectureCard;

      // No tracked activity yet — the design still carries the card,
      // as a start prompt instead of a resume.
      return { kind: "start" };
    },
  });

  if (!user || !data) return null;

  if (data.kind === "start") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        whileHover={{ y: -2 }}
        whileTap={{ scale: 0.99 }}
        onClick={() => navigate("/lectures")}
        className="glass rounded-2xl p-4 sm:p-5 cursor-pointer transition-shadow hover:shadow-elevated group"
      >
        <p className="text-[10px] tracking-widest text-muted-foreground font-semibold">
          START LEARNING
        </p>
        <div className="mt-3 flex gap-4 items-center">
          <div className="w-36 flex-shrink-0 aspect-video rounded-xl overflow-hidden relative bg-gradient-to-br from-primary/25 via-primary/10 to-transparent ring-1 ring-white/10">
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="w-11 h-11 rounded-full gradient-button flex items-center justify-center">
                <Play className="w-5 h-5 text-white fill-white" />
              </span>
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-primary font-semibold">Video Lectures</p>
            <p className="font-display font-semibold text-foreground line-clamp-1 mt-0.5">
              Watch your first lecture
            </p>
            <p className="text-xs text-muted-foreground line-clamp-1 mt-1">
              Pick a playlist for your semester and start learning.
            </p>
          </div>
        </div>
      </motion.div>
    );
  }

  if (data.kind === "quiz") {
    const pct = data.total > 0 ? Math.round((data.score / data.total) * 100) : 0;
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        whileHover={{ y: -2 }}
        whileTap={{ scale: 0.99 }}
        onClick={() => navigate(data.link)}
        className="glass rounded-2xl p-4 sm:p-5 cursor-pointer transition-shadow hover:shadow-elevated group"
      >
        <p className="text-[10px] tracking-widest text-muted-foreground font-semibold">
          CONTINUE WHERE YOU LEFT OFF
        </p>
        <div className="mt-3 flex gap-4">
          <div className="w-36 flex-shrink-0 aspect-video rounded-xl overflow-hidden relative bg-gradient-to-br from-primary/25 via-primary/10 to-transparent ring-1 ring-white/10">
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="w-11 h-11 rounded-full gradient-button flex items-center justify-center">
                <Brain className="w-5 h-5 text-white" />
              </span>
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-primary font-semibold flex items-center gap-1">
              <Trophy className="w-3 h-3" /> {data.subject}
            </p>
            <p className="font-display font-semibold text-foreground line-clamp-1 mt-0.5">
              {data.title}
            </p>
            <p className="text-xs text-muted-foreground line-clamp-1 mt-1">
              {data.detail}
            </p>
            <div className="flex items-center gap-2 mt-2.5">
              <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
                <div
                  className="h-full rounded-full gradient-primary"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="text-[11px] font-medium text-muted-foreground">
                {data.score}/{data.total}
              </span>
            </div>
          </div>
        </div>
      </motion.div>
    );
  }

  const pct = data.total > 0 ? Math.round((data.watched / data.total) * 100) : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.99 }}
      onClick={() => navigate(data.link)}
      className="glass rounded-2xl p-4 sm:p-5 cursor-pointer transition-shadow hover:shadow-elevated group"
    >
      <p className="text-[10px] tracking-widest text-muted-foreground font-semibold">
        CONTINUE WHERE YOU LEFT OFF
      </p>
      <div className="mt-3 flex gap-4">
        <div className="w-36 flex-shrink-0 aspect-video rounded-xl overflow-hidden relative bg-primary/10 ring-1 ring-white/10">
          {data.thumbVideoId && (
            <img
              src={`https://i.ytimg.com/vi/${data.thumbVideoId}/hqdefault.jpg`}
              alt={data.title}
              loading="lazy"
              onError={(e) => { e.currentTarget.style.display = "none"; }}
              className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
          )}
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="w-11 h-11 rounded-full gradient-button flex items-center justify-center">
              <Play className="w-5 h-5 text-white fill-white" />
            </span>
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-primary font-semibold">{data.subject}</p>
          <p className="font-display font-semibold text-foreground line-clamp-1 mt-0.5">
            {data.title}
          </p>
          {data.nextTitle && (
            <p className="text-xs text-muted-foreground line-clamp-1 mt-1">
              Next: {data.nextTitle}
            </p>
          )}
          <div className="flex items-center gap-2 mt-2.5">
            <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
              <div
                className="h-full rounded-full gradient-primary"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="text-[11px] font-medium text-muted-foreground">
              {data.watched}/{data.total}
            </span>
          </div>
        </div>
      </div>
    </motion.div>
  );
};

export default ContinueLearningCard;
