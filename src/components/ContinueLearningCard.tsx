import { motion } from "framer-motion";
import { Play } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

/**
 * Resume card: the playlist the student most recently watched but has not
 * finished, with the next unwatched video and a watched/total progress bar.
 * Renders nothing for guests or students with no lecture progress yet.
 */
const ContinueLearningCard = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const { data } = useQuery({
    queryKey: ["continue-learning", user?.id],
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
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
      if (rows.length === 0) return null;

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

      // Prefer the most recently watched playlist that still has unwatched
      // videos; fall back to the most recent one overall.
      const pickedId =
        orderedIds.find((id) => {
          const lec = lectureById.get(id);
          const total = lec?.video_count || 0;
          return total > 0 && (watchedByLecture.get(id)?.size || 0) < total;
        }) || orderedIds[0];
      const lecture = lectureById.get(pickedId);
      if (!lecture) return null;

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
      if (total === 0) return null;

      return {
        subject: lecture.subject as string,
        title: lecture.title as string,
        thumbVideoId: (lecture.thumb_video_id as string | null) || null,
        nextTitle: (next?.title as string | undefined) || null,
        watched,
        total,
      };
    },
  });

  if (!user || !data) return null;

  const pct = data.total > 0 ? Math.round((data.watched / data.total) * 100) : 0;

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
        CONTINUE WHERE YOU LEFT OFF
      </p>
      <div className="mt-3 flex gap-4">
        <div className="w-36 flex-shrink-0 aspect-video rounded-xl overflow-hidden relative bg-primary/10 ring-1 ring-white/10">
          {data.thumbVideoId && (
            <img
              src={`https://i.ytimg.com/vi/${data.thumbVideoId}/hqdefault.jpg`}
              alt={data.title}
              loading="lazy"
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
