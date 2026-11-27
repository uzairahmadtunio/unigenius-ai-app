import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  DEFAULT_SETTINGS,
  parseAppSettings,
  type AppSettings,
} from "@/lib/app-settings";

interface AppSettingsState {
  settings: AppSettings;
  /** True until the first fetch settles; gates stay open while loading. */
  loading: boolean;
}

const AppSettingsContext = createContext<AppSettingsState>({
  settings: DEFAULT_SETTINGS,
  loading: true,
});

/**
 * Loads public.app_settings once on mount and re-checks every minute so a
 * maintenance switch or feature toggle reaches open sessions quickly.
 * Any failure keeps the defaults (everything on) — the app must never be
 * taken down by a settings read error.
 */
export const AppSettingsProvider = ({ children }: { children: ReactNode }) => {
  const [state, setState] = useState<AppSettingsState>({ settings: DEFAULT_SETTINGS, loading: true });

  useEffect(() => {
    let live = true;
    const load = async () => {
      const { data, error } = await supabase
        .from("app_settings" as any)
        .select("key, value");
      if (!live) return;
      if (!error && data) {
        setState({ settings: parseAppSettings(data as any), loading: false });
      } else {
        setState((s) => ({ settings: s.settings, loading: false }));
      }
    };
    load();
    const t = setInterval(load, 60_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);

  return <AppSettingsContext.Provider value={state}>{children}</AppSettingsContext.Provider>;
};

export const useAppSettings = () => useContext(AppSettingsContext);
