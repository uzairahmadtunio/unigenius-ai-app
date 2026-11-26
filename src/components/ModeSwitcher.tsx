import { Shield, GraduationCap, UserRound } from "lucide-react";
import { useViewMode } from "@/contexts/ViewModeContext";
import { VIEW_MODE_LABELS, type ViewMode } from "@/lib/view-mode";
import { cn } from "@/lib/utils";

const MODE_ICONS: Record<ViewMode, typeof Shield> = {
  admin: Shield,
  teacher: GraduationCap,
  student: UserRound,
};

/**
 * The role switcher (Panels Program, Part A). Renders nothing for
 * single-mode accounts (students) — they never see any mode UI.
 * `full` stretches the segmented control to the container width
 * (drawer / teacher header); the default is a compact header pill.
 */
export const ModeSwitcher = ({ full = false }: { full?: boolean }) => {
  const { mode, modes, viewingAs, setMode, loading } = useViewMode();
  if (loading || !mode || modes.length < 2) return null;

  return (
    <div className={cn("flex items-center gap-2", full && "w-full flex-col items-stretch")}>
      <div
        role="tablist"
        aria-label="View mode"
        className={cn(
          "flex items-center gap-0.5 rounded-full border border-primary/25 bg-primary/5 p-0.5",
          full && "w-full",
        )}
      >
        {modes.map((m) => {
          const Icon = MODE_ICONS[m];
          const active = m === mode;
          return (
            <button
              key={m}
              role="tab"
              aria-selected={active}
              onClick={() => setMode(m)}
              className={cn(
                "flex items-center justify-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-all",
                full && "flex-1 py-1.5",
                active
                  ? "gradient-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="w-3 h-3" />
              {VIEW_MODE_LABELS[m]}
            </button>
          );
        })}
      </div>
      {viewingAs && (
        <span className="shrink-0 rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[10px] font-bold tracking-wide text-amber-500 dark:text-amber-300">
          VIEWING AS: {VIEW_MODE_LABELS[mode].toUpperCase()}
        </span>
      )}
    </div>
  );
};

export default ModeSwitcher;
