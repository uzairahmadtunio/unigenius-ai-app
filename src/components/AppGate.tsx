import { useEffect, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { Wrench, ShieldAlert, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useAdmin } from "@/hooks/use-admin";
import { useAppSettings } from "@/contexts/AppSettingsContext";
import { supabase } from "@/integrations/supabase/client";
import type { FeatureFlags } from "@/lib/app-settings";

// Paths that must stay reachable during maintenance so the admin can
// sign in and turn maintenance off again.
const MAINTENANCE_EXEMPT = ["/auth", "/forgot-password", "/reset-password", "/admin"];

/**
 * Site-wide gates (Phase 4):
 *  - Maintenance mode: when the admin flips it on, everyone except admins
 *    sees a "back shortly" screen.
 *  - Suspended accounts: a suspended signed-in user is stopped here (their
 *    login is also banned at the auth level by admin_set_user_suspended).
 * Both gates fail open while settings/profile are still loading.
 */
export const AppGate = ({ children }: { children: ReactNode }) => {
  const location = useLocation();
  const { user, signOut } = useAuth();
  const { isAdmin } = useAdmin();
  const { settings, loading } = useAppSettings();
  const [suspended, setSuspended] = useState(false);

  useEffect(() => {
    if (!user) {
      setSuspended(false);
      return;
    }
    let live = true;
    supabase
      .from("profiles")
      .select("suspended")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (live) setSuspended(!!(data as any)?.suspended);
      });
    return () => {
      live = false;
    };
  }, [user]);

  if (suspended && user && !isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="max-w-sm w-full text-center space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-destructive/10 border border-destructive/20 flex items-center justify-center mx-auto">
            <ShieldAlert className="w-7 h-7 text-destructive" />
          </div>
          <h1 className="text-xl font-display font-bold text-foreground">Account Suspended</h1>
          <p className="text-sm text-muted-foreground">
            Your account has been suspended by the admin. If you think this is a mistake,
            please contact support.
          </p>
          <Button className="rounded-xl gap-2" onClick={() => signOut()}>
            <LogOut className="w-4 h-4" /> Sign Out
          </Button>
        </div>
      </div>
    );
  }

  const exempt = MAINTENANCE_EXEMPT.some((p) => location.pathname.startsWith(p));
  if (!loading && settings.maintenance.enabled && !isAdmin && !exempt) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="max-w-sm w-full text-center space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto">
            <Wrench className="w-7 h-7 text-primary" />
          </div>
          <h1 className="text-xl font-display font-bold text-foreground">We Will Be Back Shortly</h1>
          <p className="text-sm text-muted-foreground">{settings.maintenance.message}</p>
          <a href="/auth" className="inline-block text-xs text-muted-foreground/70 underline underline-offset-2">
            Admin sign in
          </a>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

/** Wraps a page: when the admin has switched the feature off, show a
 *  friendly notice instead of the page. Fails open while loading. */
export const FeatureGate = ({
  flag,
  label,
  children,
}: {
  flag: keyof FeatureFlags;
  label: string;
  children: ReactNode;
}) => {
  const { settings, loading } = useAppSettings();
  if (!loading && !settings.features[flag]) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4 py-16">
        <div className="max-w-sm w-full text-center space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto">
            <Wrench className="w-6 h-6 text-primary" />
          </div>
          <h2 className="text-lg font-display font-bold text-foreground">{label} is Paused</h2>
          <p className="text-sm text-muted-foreground">
            This feature is temporarily unavailable. Please check back soon — everything
            else in UniGenius keeps working.
          </p>
        </div>
      </div>
    );
  }
  return <>{children}</>;
};
