import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Flame, Trophy, Calendar, TrendingUp, Gift, Heart, Check } from "lucide-react";
import { useStreak } from "@/hooks/use-streak";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import confetti from "canvas-confetti";

const MILESTONES = [7, 14, 30, 50, 100];

const LEVEL_LABELS: Record<string, string> = {
  warming: "Warming up",
  hot: "On fire",
  blazing: "Blazing",
  legendary: "Legendary",
};

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

const DailyStreakWidget = () => {
  const { user } = useAuth();
  const { currentStreak, longestStreak, totalActiveDays, loading } = useStreak();
  const [claimed, setClaimed] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [recoveryRemaining, setRecoveryRemaining] = useState<number | null>(null);
  const [isUnlimited, setIsUnlimited] = useState(false);
  const [monthlyLimit, setMonthlyLimit] = useState(5);

  const loadRecoveryStatus = async () => {
    if (!user) return;
    const { data } = await supabase.rpc("get_streak_recovery_status" as any);
    const row: any = Array.isArray(data) ? data[0] : data;
    if (row) {
      setRecoveryRemaining(row.remaining ?? 0);
      setIsUnlimited(!!row.is_unlimited);
      setMonthlyLimit(row.monthly_limit ?? 5);
    }
  };

  useEffect(() => {
    if (!user) return;
    supabase
      .from("profiles")
      .select("streak_pro_until")
      .eq("user_id", user.id)
      .single()
      .then(({ data }) => {
        const until = (data as any)?.streak_pro_until;
        if (until && new Date(until) > new Date()) setClaimed(true);
      });
    loadRecoveryStatus();
  }, [user]);

  if (!user || loading) return null;

  const streakLevel =
    currentStreak >= 30 ? "legendary" : currentStreak >= 14 ? "blazing" : currentStreak >= 7 ? "hot" : "warming";

  const canClaimProDay = currentStreak >= 7 && !claimed;
  const canRecover = isUnlimited || (recoveryRemaining ?? 0) > 0;

  const claimProDay = async () => {
    if (claiming) return;
    setClaiming(true);
    const { error } = await supabase.rpc("grant_streak_pro_day" as any);
    setClaiming(false);
    if (error) {
      toast.error("Couldn't claim Pro Day. Keep your streak going!");
      return;
    }
    setClaimed(true);
    confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
    toast.success("🎉 Free Pro Day claimed! Enjoy all Pro features today!");
  };

  const recoverStreak = async () => {
    if (!user || recovering) return;
    setRecovering(true);
    const { data, error } = await supabase.rpc("recover_streak" as any);
    setRecovering(false);
    if (error) {
      toast.error("Couldn't restore streak. Please try again.");
      return;
    }
    const row: any = Array.isArray(data) ? data[0] : data;
    if (!row?.success) {
      toast.error(`Monthly limit reached (${row?.monthly_limit ?? monthlyLimit}/month). Resets next month.`);
      setRecoveryRemaining(0);
      return;
    }
    setRecoveryRemaining(row.remaining ?? 0);
    setIsUnlimited(!!row.is_unlimited);
    sessionStorage.removeItem(`streak_recorded_${user.id}`);
    confetti({ particleCount: 80, spread: 60, origin: { y: 0.6 } });
    const remainingMsg = row.is_unlimited
      ? "Unlimited restores available."
      : `${row.remaining} restore${row.remaining === 1 ? "" : "s"} left this month.`;
    toast.success(`Streak restored. ${remainingMsg}`);
    setTimeout(() => window.location.reload(), 900);
  };

  // Week dots (Mon–Sun): a day is active when it falls inside the current
  // streak window — today back through (currentStreak - 1) days — and is
  // not in the future.
  const todayStart = startOfDay(new Date());
  const mondayOffset = (todayStart.getDay() + 6) % 7;
  const monday = new Date(todayStart);
  monday.setDate(monday.getDate() - mondayOffset);
  const streakStart = new Date(todayStart);
  streakStart.setDate(streakStart.getDate() - (currentStreak - 1));
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(monday);
    date.setDate(date.getDate() + i);
    const isToday = date.getTime() === todayStart.getTime();
    const isActive =
      currentStreak > 0 && date.getTime() <= todayStart.getTime() && date.getTime() >= streakStart.getTime();
    return { date, isToday, isActive, label: "MTWTFSS"[i] };
  });

  // Milestone strip copy.
  const nextMilestone = MILESTONES.find((m) => m > currentStreak);
  const reachedMilestone = MILESTONES.includes(currentStreak);
  const lastMilestone = MILESTONES.filter((m) => m <= currentStreak).pop();
  let milestoneText: string | null = null;
  if (currentStreak > 0) {
    if (reachedMilestone) {
      milestoneText = `You reached a ${currentStreak}-day streak. Keep going!`;
    } else if (nextMilestone) {
      const remaining = nextMilestone - currentStreak;
      milestoneText = `${remaining} more day${remaining === 1 ? "" : "s"} to your ${nextMilestone}-day streak!`;
    } else if (lastMilestone) {
      milestoneText = `You reached a ${lastMilestone}-day streak. Keep going!`;
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.06 }}
      className="glass rounded-2xl p-4 sm:p-5 h-full"
    >
      <div className="flex items-center justify-between">
        {/* Streak counter */}
        <div className="flex items-center gap-3">
          <motion.div
            animate={{ scale: [1, 1.15, 1] }}
            transition={{ repeat: Infinity, duration: 1.5, ease: "easeInOut" }}
            className="relative"
          >
            <Flame className="w-8 h-8 text-amber-400" />
            {currentStreak >= 7 && (
              <motion.div
                animate={{ opacity: [0.5, 1, 0.5] }}
                transition={{ repeat: Infinity, duration: 1 }}
                className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-amber-400 blur-[2px]"
              />
            )}
          </motion.div>
          <div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-display font-bold text-foreground">{currentStreak}</span>
              <span className="text-xs text-muted-foreground font-medium">day streak</span>
            </div>
            <p className="text-[10px] text-muted-foreground">{LEVEL_LABELS[streakLevel]}</p>
          </div>
        </div>

        {/* Stats + Claim */}
        <div className="flex items-center gap-4">
          {canClaimProDay && (
            <Button
              size="sm"
              onClick={claimProDay}
              className="rounded-xl gap-1.5 text-xs gradient-button text-white"
            >
              <Gift className="w-3.5 h-3.5" />
              Free Pro Day
            </Button>
          )}
          {currentStreak === 0 && canRecover && (
            <div className="flex flex-col items-end gap-0.5">
              <Button
                size="sm"
                onClick={recoverStreak}
                disabled={recovering}
                variant="outline"
                className="rounded-xl gap-1.5 text-xs border-primary/40 text-primary hover:bg-primary/10"
              >
                <Heart className="w-3.5 h-3.5" />
                {recovering ? "Restoring..." : "Restore Streak"}
              </Button>
              <span className="text-[9px] text-muted-foreground font-medium">
                {isUnlimited
                  ? "Admin · Unlimited"
                  : `${recoveryRemaining ?? 0} of ${monthlyLimit} left this month`}
              </span>
            </div>
          )}
          <div className="text-center">
            <div className="flex items-center gap-1 justify-center">
              <Trophy className="w-3 h-3 text-amber-400" />
              <span className="text-sm font-bold text-foreground">{longestStreak}</span>
            </div>
            <p className="text-[10px] text-muted-foreground">Best</p>
          </div>
          <div className="text-center">
            <div className="flex items-center gap-1 justify-center">
              <Calendar className="w-3 h-3 text-primary" />
              <span className="text-sm font-bold text-foreground">{totalActiveDays}</span>
            </div>
            <p className="text-[10px] text-muted-foreground">Total</p>
          </div>
        </div>
      </div>

      {/* Streak progress bar to next milestone */}
      {currentStreak > 0 && <StreakProgress current={currentStreak} />}

      {/* Week dots */}
      <div className="mt-5 flex items-start justify-between px-0.5">
        {weekDays.map((d) => (
          <div key={d.label + d.date.toISOString()} className="flex flex-col items-center gap-1.5">
            <div
              className={`relative w-8 h-8 rounded-full flex items-center justify-center ${
                d.isActive || d.isToday
                  ? "bg-amber-400 text-amber-950"
                  : "border border-border text-muted-foreground"
              }`}
            >
              {d.isToday && (
                <span className="absolute -inset-0.5 rounded-full ring-2 ring-amber-400/40 animate-pulse" />
              )}
              {d.isToday ? (
                <Flame className="w-3.5 h-3.5" />
              ) : d.isActive ? (
                <Check className="w-3 h-3" />
              ) : (
                <span className="w-1 h-1 rounded-full bg-muted-foreground/40" />
              )}
            </div>
            <span
              className={`text-[9px] font-semibold ${
                d.isToday ? "text-amber-400" : "text-muted-foreground"
              }`}
            >
              {d.label}
            </span>
          </div>
        ))}
      </div>

      {/* Milestone strip */}
      {currentStreak > 0 && milestoneText && (
        <div className="mt-4 bg-amber-400/10 border border-amber-300/20 rounded-xl px-3.5 py-2.5 flex items-center gap-2">
          <Flame className="w-3.5 h-3.5 text-amber-300 flex-shrink-0" />
          <p className="text-xs font-medium leading-snug text-foreground">{milestoneText}</p>
        </div>
      )}
    </motion.div>
  );
};

const StreakProgress = ({ current }: { current: number }) => {
  const nextMilestone = MILESTONES.find((m) => m > current) || 100;
  const prevMilestone = MILESTONES.filter((m) => m <= current).pop() || 0;
  const progress = ((current - prevMilestone) / (nextMilestone - prevMilestone)) * 100;

  return (
    <div className="mt-4 space-y-1.5">
      <div className="flex justify-between items-center">
        <span className="text-[10px] text-muted-foreground flex items-center gap-1">
          <TrendingUp className="w-3 h-3" />
          {`Next milestone: ${nextMilestone} days`}
        </span>
        <span className="text-[10px] font-medium text-foreground">{Math.round(progress)}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 1, ease: "easeOut" }}
          className="h-full rounded-full gradient-primary"
        />
      </div>
    </div>
  );
};

export default DailyStreakWidget;
