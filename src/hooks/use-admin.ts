import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

export const useAdmin = () => {
  const { user } = useAuth();
  // Same derived-loading pattern as use-role: the check result is
  // tagged with the user id it belongs to, so a guard never reads a
  // stale "not admin" in the gap while the session restores on a hard
  // page load (which used to bounce real admins to "/").
  const [checked, setChecked] = useState<{ userId: string | null; isAdmin: boolean }>({
    userId: null,
    isAdmin: false,
  });

  useEffect(() => {
    if (!user) {
      setChecked({ userId: null, isAdmin: false });
      return;
    }
    let live = true;
    supabase
      .from("user_roles" as any)
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle()
      .then(({ data }) => {
        if (!live) return;
        setChecked({ userId: user.id, isAdmin: !!data });
      });
    return () => {
      live = false;
    };
  }, [user]);

  const isAdmin = !!user && checked.userId === user.id ? checked.isAdmin : false;
  const loading = !!user && checked.userId !== user.id;

  return { isAdmin, loading };
};
