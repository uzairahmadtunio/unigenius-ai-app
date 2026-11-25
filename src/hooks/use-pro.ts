import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

export const usePro = () => {
  const { user } = useAuth();
  // Derived-loading pattern (see use-role): the fetched pro status is
  // tagged with its user id so consumers never read a stale "not pro"
  // while the session restores on a hard page load.
  const [fetched, setFetched] = useState<{ userId: string | null; isPro: boolean }>({
    userId: null,
    isPro: false,
  });

  useEffect(() => {
    if (!user) {
      setFetched({ userId: null, isPro: false });
      return;
    }
    let live = true;
    supabase
      .from("profiles")
      .select("is_pro, streak_pro_until")
      .eq("user_id", user.id)
      .single()
      .then(({ data }) => {
        if (!live) return;
        const row = data as { is_pro?: boolean | null; streak_pro_until?: string | null } | null;
        const streakActive = !!row?.streak_pro_until && new Date(row.streak_pro_until) > new Date();
        setFetched({ userId: user.id, isPro: !!row?.is_pro || streakActive });
      });
    return () => {
      live = false;
    };
  }, [user]);

  const isPro = !!user && fetched.userId === user.id ? fetched.isPro : false;
  const loading = !!user && fetched.userId !== user.id;

  return { isPro, loading };
};
