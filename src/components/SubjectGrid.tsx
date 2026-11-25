import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useDepartment } from "@/contexts/DepartmentContext";
import { useAuth } from "@/contexts/AuthContext";
import { useMySubjects } from "@/hooks/use-my-subjects";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  BookOpen,
  BookMarked,
  X,
  ChevronRight,
  Cpu,
  Code2,
  Sigma,
  PenLine,
  Landmark,
  Atom,
  FlaskConical,
  Leaf,
  Network,
  Database,
  AppWindow,
  Globe,
  type LucideIcon,
} from "lucide-react";

interface SubjectGridProps {
  semester: number;
}

const HINT_KEY = "unigenius-mysubjects-hint-dismissed";

const normalizeName = (name: string) => name.toLowerCase().trim();

/** Pick a lucide icon for a subject by keyword match on its name. */
const getSubjectIcon = (name: string): LucideIcon => {
  const n = name.toLowerCase();
  if (n.includes("logic") || n.includes("digital")) return Cpu;
  if (n.includes("programming") || n.includes("oop") || n.includes("object")) return Code2;
  if (n.includes("calculus")) return Sigma;
  if (n.includes("math")) return Sigma;
  if (n.includes("writing") || n.includes("english") || n.includes("composition")) return PenLine;
  if (n.includes("pakistan")) return Landmark;
  if (n.includes("quran") || n.includes("islam")) return BookOpen;
  if (n.includes("physics")) return Atom;
  if (n.includes("chemistry")) return FlaskConical;
  if (n.includes("biolog")) return Leaf;
  if (n.includes("data structure") || n.includes("algorithm")) return Network;
  if (n.includes("database")) return Database;
  if (n.includes("operating")) return AppWindow;
  if (n.includes("network")) return Globe;
  return BookOpen;
};

const SubjectGrid = ({ semester }: SubjectGridProps) => {
  const { department } = useDepartment();
  const { user } = useAuth();
  const { subjects, isCustom, resolved } = useMySubjects(semester);
  const navigate = useNavigate();
  const [hintDismissed, setHintDismissed] = useState(
    () => localStorage.getItem(HINT_KEY) === "1"
  );

  // Topic counts per subject for this semester (subject_topics rows).
  const { data: topicCounts } = useQuery({
    queryKey: ["subject-topic-counts", semester],
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data } = await supabase
        .from("subject_topics" as any)
        .select("subject")
        .eq("semester", semester);
      const counts: Record<string, number> = {};
      ((data as any[]) || []).forEach((r) => {
        const key = normalizeName(String(r.subject || ""));
        if (key) counts[key] = (counts[key] || 0) + 1;
      });
      return counts;
    },
  });

  // Lecture progress per subject: watched videos vs total videos across
  // every playlist catalogued under the subject's name.
  const { data: lectureProgress } = useQuery({
    queryKey: ["subject-lecture-progress", user?.id],
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const [{ data: lectures }, { data: progress }] = await Promise.all([
        supabase.from("subject_lectures" as any).select("id, subject, video_count"),
        supabase
          .from("user_lecture_progress" as any)
          .select("lecture_id")
          .eq("user_id", user!.id),
      ]);
      const lectureById = new Map<string, { subject: string; video_count: number }>();
      ((lectures as any[]) || []).forEach((l) => lectureById.set(l.id, l));
      const totals: Record<string, number> = {};
      lectureById.forEach((l) => {
        const key = normalizeName(String(l.subject || ""));
        if (key) totals[key] = (totals[key] || 0) + (l.video_count || 0);
      });
      const watched: Record<string, number> = {};
      ((progress as any[]) || []).forEach((r) => {
        const lec = lectureById.get(r.lecture_id);
        if (!lec) return;
        const key = normalizeName(String(lec.subject || ""));
        if (key) watched[key] = (watched[key] || 0) + 1;
      });
      return { totals, watched };
    },
  });

  const showHint = resolved && !isCustom && !!department && !hintDismissed;

  const dismissHint = () => {
    localStorage.setItem(HINT_KEY, "1");
    setHintDismissed(true);
  };

  const openSubject = (subjectId: string, subjectName: string) => {
    // Always carry the name/semester along: scheme/pool subjects may not
    // exist in the hardcoded curriculum, and the hub falls back on these
    // params instead of showing "Subject Not Found".
    navigate(
      `/subject/${subjectId}?name=${encodeURIComponent(subjectName)}&sem=${semester}`
    );
  };

  return (
    <div className="space-y-4">
      {showHint && (
        <div className="glass rounded-2xl px-4 py-3 flex items-center gap-3">
          <BookMarked className="w-4 h-4 text-primary flex-shrink-0" />
          <p className="text-xs sm:text-sm text-muted-foreground flex-1">
            Set your subjects according to your university — every university has a different scheme of studies.
          </p>
          <Button
            size="sm"
            className="rounded-lg gradient-primary text-primary-foreground flex-shrink-0"
            onClick={() => navigate("/my-subjects")}
          >
            My Subjects
          </Button>
          <button
            onClick={dismissHint}
            aria-label="Dismiss"
            className="text-muted-foreground hover:text-foreground flex-shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      <AnimatePresence mode="wait">
        <motion.div
          key={`${department}-${semester}-${isCustom ? "custom" : "default"}`}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -16 }}
          transition={{ duration: 0.3 }}
          className="grid grid-cols-1 lg:grid-cols-2 gap-3"
        >
          {subjects.map((subject) => {
            const Icon = getSubjectIcon(subject.name);
            const key = normalizeName(subject.name);
            const topics = topicCounts?.[key];
            const total = lectureProgress?.totals[key] || 0;
            const watched = lectureProgress?.watched[key] || 0;
            const showProgress = total > 0 && watched > 0;
            const pct = showProgress ? Math.round((watched / total) * 100) : 0;
            return (
              <motion.div
                key={subject.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.15 }}
                whileHover={{ y: -4 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => openSubject(subject.id, subject.name)}
                className="glass rounded-2xl p-4 cursor-pointer transition-shadow hover:shadow-elevated group flex items-center gap-3"
              >
                <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                  <Icon className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-display font-semibold text-foreground text-sm leading-tight group-hover:text-primary transition-colors truncate">
                    {subject.name}
                  </h3>
                  <div className="flex items-center gap-2 mt-1.5">
                    {subject.hasLab && (
                      <Badge variant="secondary" className="text-xs rounded-lg">
                        Lab
                      </Badge>
                    )}
                    {typeof topics === "number" ? (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <BookOpen className="w-3 h-3" /> {topics} topics
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <BookOpen className="w-3 h-3" /> Study
                      </span>
                    )}
                  </div>
                  {showProgress && (
                    <div className="flex items-center gap-2 mt-2" title="Lecture progress">
                      <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
                        <div
                          className="h-full rounded-full gradient-primary"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-[10px] font-medium text-muted-foreground">{pct}%</span>
                    </div>
                  )}
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              </motion.div>
            );
          })}
        </motion.div>
      </AnimatePresence>
    </div>
  );
};

export default SubjectGrid;
