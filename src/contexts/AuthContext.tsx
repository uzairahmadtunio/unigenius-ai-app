import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User, Session } from "@supabase/supabase-js";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  loading: true,
  signOut: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    // Land on the welcome screen, not wherever the app happens to be.
    // Without this, signing out from the menu left the user on "/" —
    // and anyone whose department was never set on this device (e.g. a
    // teacher, whose home skips the department gate) was dumped
    // straight into the "Choose Your Department" onboarding picker.
    // Clearing the splash flag makes Index boot into the welcome /
    // PublicLanding screen again; the full reload also guarantees no
    // in-memory state (query cache, view mode) survives the sign-out.
    // (Key literal matches SPLASH_KEY in pages/Index.tsx.)
    try { sessionStorage.removeItem("unigenius-splash-shown"); } catch { /* private mode */ }
    window.location.assign("/");
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};
