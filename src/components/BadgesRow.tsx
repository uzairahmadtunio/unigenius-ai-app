import { Award } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

/**
 * The student's three most recently earned badges (user_badges), with a
 * link through to the full list on their profile. Renders nothing when
 * signed out or when no badge has been earned yet.
 */
const BadgesRow = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const { data: badges } = useQuery({
    queryKey: ["dashboard-badges", user?.id],
    enabled: !!user,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data } = await supabase
        .from("user_badges")
        .select("badge_name")
        .eq("user_id", user!.id)
        .order("earned_at", { ascending: false })
        .limit(3);
      return (data as { badge_name: string }[]) || [];
    },
  });

  if (!user || !badges || badges.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-display font-bold text-lg tracking-tight text-foreground mr-1 leading-none">
        Your badges
      </span>
      {badges.map((b, i) => (
        <span
          key={`${b.badge_name}-${i}`}
          className="glass rounded-full h-9 pl-1.5 pr-3 flex items-center gap-2 transition-transform duration-200 hover:-translate-y-0.5"
        >
          <span className="w-6 h-6 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
            <Award className="w-3.5 h-3.5 text-primary" />
          </span>
          <span className="text-xs font-medium text-foreground">{b.badge_name}</span>
        </span>
      ))}
      <button
        onClick={() => navigate("/profile")}
        className="h-9 inline-flex items-center text-xs text-primary font-medium hover:underline ml-1 transition-transform active:scale-95"
      >
        View all
      </button>
    </div>
  );
};

export default BadgesRow;
