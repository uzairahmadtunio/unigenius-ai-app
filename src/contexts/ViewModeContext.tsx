import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useRole } from "@/hooks/use-role";
import { supabase } from "@/integrations/supabase/client";
import {
  availableModes,
  isViewingAs,
  resolveViewMode,
  VIEW_MODE_STORAGE_KEY,
  type ViewMode,
} from "@/lib/view-mode";

interface ViewModeContextType {
  /** Active view mode; null until the user's roles have loaded. */
  mode: ViewMode | null;
  /** Modes this account may switch into (never more than its real roles allow). */
  modes: ViewMode[];
  /** True when viewing as a lower role than the account's real top role. */
  viewingAs: boolean;
  setMode: (mode: ViewMode) => void;
  loading: boolean;
}

const ViewModeContext = createContext<ViewModeContextType>({
  mode: null,
  modes: ["student"],
  viewingAs: false,
  setMode: () => {},
  loading: true,
});

export const useViewMode = () => useContext(ViewModeContext);

export const ViewModeProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useAuth();
  const { roles, loading } = useRole();
  const [picked, setPicked] = useState<ViewMode | null>(null);

  const modes = useMemo(() => availableModes(roles), [roles]);

  const mode: ViewMode | null = loading
    ? null
    : picked && modes.includes(picked)
      ? picked
      : resolveViewMode(roles, typeof window !== "undefined" ? window.localStorage.getItem(VIEW_MODE_STORAGE_KEY) : null);

  const setMode = useCallback(
    (next: ViewMode) => {
      if (!modes.includes(next) || next === mode) return;
      setPicked(next);
      try {
        window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, next);
      } catch { /* private mode — the in-memory pick still applies */ }
      // Spec A4: every switch lands in the audit log. Best-effort — a
      // failed log insert must never block the switch itself.
      if (user) {
        void supabase
          .from("audit_log" as any)
          .insert({ actor_id: user.id, action: "mode_switch", details: { from: mode, to: next } } as any)
          .then(() => {}, () => {});
      }
    },
    [modes, mode, user],
  );

  const value: ViewModeContextType = {
    mode,
    modes,
    viewingAs: mode ? isViewingAs(roles, mode) : false,
    setMode,
    loading,
  };

  return <ViewModeContext.Provider value={value}>{children}</ViewModeContext.Provider>;
};
