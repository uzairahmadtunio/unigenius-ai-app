import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "admin" | "teacher" | "moderator" | "user";

export const useRole = () => {
  const { user } = useAuth();
  // Roles are tagged with the user id they were fetched for. `loading`
  // is DERIVED from that tag during render — not stored as separate
  // state — because a stored flag flips one render too late: on a hard
  // page load the session restores after mount, and a route guard
  // reading (loading=false, roles=[]) in that gap bounced teachers and
  // admins to "/" even though their roles existed.
  const [fetched, setFetched] = useState<{ userId: string | null; roles: AppRole[] }>({
    userId: null,
    roles: [],
  });

  useEffect(() => {
    if (!user) {
      setFetched({ userId: null, roles: [] });
      return;
    }
    let live = true;
    supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .then(({ data }) => {
        if (!live) return;
        setFetched({
          userId: user.id,
          roles: (data || []).map((r: { role: string }) => r.role as AppRole),
        });
      });
    return () => {
      live = false;
    };
  }, [user]);

  const roles = user && fetched.userId === user.id ? fetched.roles : [];
  const loading = !!user && fetched.userId !== user.id;

  return {
    roles,
    loading,
    isAdmin: roles.includes("admin"),
    isTeacher: roles.includes("teacher"),
    hasRole: (role: AppRole) => roles.includes(role),
  };
};
