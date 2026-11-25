import { useState } from "react";
import { MessageSquareHeart, Star, Bug, Lightbulb, Send, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const feedbackTypes = [
  { id: "appreciate", icon: Star, label: "Appreciate", placeholder: "What do you love about UniGenius AI?", color: "text-violet-300" },
  { id: "bug", icon: Bug, label: "Report Bug", placeholder: "Describe what's not working...", color: "text-indigo-300" },
  { id: "suggestion", icon: Lightbulb, label: "Suggestion", placeholder: "Share your idea for UniGenius AI...", color: "text-purple-300" },
] as const;

const FeedbackWidget = () => {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [rating, setRating] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  if (!user) return null;

  const isAppreciate = selectedType === "appreciate";
  const canSubmit =
    !!selectedType && !!message.trim() && (!isAppreciate || rating > 0) && !submitting;

  const handleSubmit = async () => {
    if (!selectedType || !message.trim()) return;
    if (isAppreciate && !rating) return;
    setSubmitting(true);

    const { data: profile } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("user_id", user.id)
      .single();

    const { error } = await supabase.from("feedbacks" as any).insert({
      user_id: user.id,
      user_name: profile?.display_name || user.email || "Anonymous",
      user_email: user.email || "",
      feedback_type: selectedType,
      message: message.trim().slice(0, 1000),
      rating: isAppreciate ? rating : null,
    } as any);

    if (error) {
      toast.error("Failed to submit feedback. Please try again.");
    } else {
      toast.success("Thank you for your feedback! We are constantly improving UniGenius AI.");
    }

    setSubmitting(false);
    setMessage("");
    setRating(0);
    setSelectedType(null);
    setOpen(false);
  };

  const selected = feedbackTypes.find((t) => t.id === selectedType);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="rounded-xl gap-2 text-xs border-border/50 hover:border-primary/30"
        >
          <MessageSquareHeart className="w-3.5 h-3.5" />
          Feedback
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0 rounded-2xl glass border-primary/20 shadow-elevated overflow-hidden" align="end" side="top">
        <div className="p-3 border-b border-border/60">
          <p className="font-display font-semibold text-sm">Give Feedback</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">Help us improve UniGenius AI</p>
        </div>

        {/* Type chips — always visible; the selected chip carries the violet state */}
        <div className="p-3 pb-0">
          <div className="grid grid-cols-3 gap-2">
            {feedbackTypes.map((type) => {
              const isSelected = selectedType === type.id;
              return (
                <button
                  key={type.id}
                  type="button"
                  onClick={() => setSelectedType(type.id)}
                  aria-pressed={isSelected}
                  className={`flex flex-col items-center gap-1.5 rounded-xl border px-2 py-2.5 text-[11px] font-medium transition-all ${
                    isSelected
                      ? "border-primary/50 bg-primary/15 text-foreground shadow-[inset_0_1px_0_hsl(0_0%_100%/0.08),0_8px_18px_-12px_hsl(var(--primary)/0.7)]"
                      : "border-border/60 bg-white/[0.02] text-muted-foreground hover:border-primary/30 hover:text-foreground"
                  }`}
                >
                  <type.icon className={`w-4 h-4 ${isSelected ? "text-violet-300" : type.color}`} />
                  <span>{type.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {selectedType && (
          <div className="p-3 space-y-3">
            <div className="h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
            <button
              onClick={() => setSelectedType(null)}
              className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              ← {selected?.label}
            </button>

            {isAppreciate && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Your Rating
                </p>
                <div className="mt-1.5 flex items-center gap-1">
                  {[1, 2, 3, 4, 5].map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setRating(value)}
                      aria-label={`Rate ${value} of 5`}
                      className="p-0.5 transition-transform hover:scale-110"
                    >
                      <Star
                        className={`w-6 h-6 ${
                          value <= rating
                            ? "fill-violet-400 text-violet-400 drop-shadow-[0_4px_10px_rgba(139,92,246,0.45)]"
                            : "text-muted-foreground/40"
                        }`}
                      />
                    </button>
                  ))}
                  <span className="ml-1.5 text-[11px] font-semibold text-violet-300">{rating} of 5</span>
                </div>
              </div>
            )}

            <Textarea
              placeholder={selected?.placeholder}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="rounded-xl text-xs min-h-[80px] resize-none border-primary/20 focus-visible:ring-primary/60 focus-visible:border-primary/50"
              maxLength={1000}
            />
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground">{message.length}/1000</span>
              <Button
                size="sm"
                onClick={handleSubmit}
                disabled={!canSubmit}
                className={
                  canSubmit
                    ? "gradient-button text-white rounded-xl gap-1.5 text-xs border-0 shadow-[0_10px_26px_-10px_rgba(124,92,255,0.75)] hover:brightness-110"
                    : "rounded-xl gap-1.5 text-xs bg-secondary text-muted-foreground shadow-none"
                }
              >
                {submitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                Submit
              </Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
};

export default FeedbackWidget;
