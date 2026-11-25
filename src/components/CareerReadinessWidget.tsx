import { motion } from "framer-motion";
import { TrendingUp, ArrowRight } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

const CareerReadinessWidget = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const { data: score = null } = useQuery({
    queryKey: ["career-readiness", user?.id],
    enabled: !!user,
    staleTime: 10 * 60 * 1000, // 10 minutes — this data rarely changes
    gcTime: 15 * 60 * 1000,
    queryFn: async () => {
      const [profileRes, activityRes, quizRes] = await Promise.all([
        supabase.from("profiles").select("skills, display_name, roll_number, headline, github_url, linkedin_url, section, avatar_url").eq("user_id", user!.id).single(),
        supabase.from("career_activity").select("activity_type, metadata, points").eq("user_id", user!.id),
        supabase.from("quiz_results").select("id, score, total").eq("user_id", user!.id),
      ]);

      const p = profileRes.data as any;
      const activities = activityRes.data || [];
      const quizzes = quizRes.data || [];

      const profileFields = [p?.display_name, p?.roll_number, p?.headline, p?.avatar_url, p?.github_url || p?.linkedin_url, p?.section];
      const profileScore = profileFields.filter(Boolean).length / profileFields.length * 20;
      const dsaSolved = activities.filter((a: any) => a.activity_type === "dsa_solve").length;
      const dsaScore = Math.min(dsaSolved / 10, 1) * 30;
      const interviews = activities.filter((a: any) => a.activity_type === "interview_complete").length;
      const interviewScore = Math.min(interviews / 5, 1) * 20;
      const cvScores = activities.filter((a: any) => a.activity_type === "cv_score").map((a: any) => (a.metadata as any)?.score || 0);
      const bestCv = cvScores.length > 0 ? Math.max(...cvScores) : 0;
      const cvScore = (bestCv / 100) * 15;
      const quizScore = Math.min(quizzes.length / 10, 1) * 15;

      return Math.round(profileScore + dsaScore + interviewScore + cvScore + quizScore);
    },
  });

  if (!user || score === null) return null;

  // 12 tick marks around the ring, like a dial.
  const ticks = Array.from({ length: 12 }, (_, i) => {
    const a = (i * 30 * Math.PI) / 180;
    return {
      x1: 20 + Math.cos(a) * 17.4,
      y1: 20 + Math.sin(a) * 17.4,
      x2: 20 + Math.cos(a) * 19,
      y2: 20 + Math.sin(a) * 19,
    };
  });
  const circumference = 2 * Math.PI * 15.5;

  return (
    <motion.button
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      onClick={() => navigate("/career")}
      className="glass rounded-2xl p-4 sm:p-5 flex items-center gap-4 w-full h-full text-left transition-shadow hover:shadow-md group"
    >
      <div className="relative w-14 h-14 flex-shrink-0">
        <svg viewBox="0 0 40 40" className="w-14 h-14 -rotate-90">
          <defs>
            <linearGradient id="career-readiness-gradient" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#8B5CF6" />
              <stop offset="100%" stopColor="#4E7BFF" />
            </linearGradient>
          </defs>
          {ticks.map((t, i) => (
            <line
              key={i}
              x1={t.x1}
              y1={t.y1}
              x2={t.x2}
              y2={t.y2}
              stroke="currentColor"
              className="text-muted-foreground/40"
              strokeWidth="0.8"
              strokeLinecap="round"
            />
          ))}
          <circle cx="20" cy="20" r="15.5" fill="none" stroke="currentColor" className="text-muted/30" strokeWidth="3" />
          <circle
            cx="20"
            cy="20"
            r="15.5"
            fill="none"
            stroke="url(#career-readiness-gradient)"
            strokeWidth="3"
            strokeDasharray={`${(score / 100) * circumference} ${circumference}`}
            strokeLinecap="round"
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-foreground">{score}%</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-display font-semibold text-sm text-foreground flex items-center gap-1.5">
          <TrendingUp className="w-3.5 h-3.5 text-primary" /> Career Readiness
        </p>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          {score >= 70 ? "You're career-ready! Keep it up." : score >= 40 ? "Getting there — solve more DSA & do interviews." : "Start with DSA, mock interviews & CV upload."}
        </p>
        <span className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary">
          Start with DSA <ArrowRight className="w-3 h-3 transition-transform duration-200 group-hover:translate-x-0.5" />
        </span>
      </div>
      <ArrowRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
    </motion.button>
  );
};

export default CareerReadinessWidget;
