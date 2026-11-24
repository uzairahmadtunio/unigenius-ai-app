import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

const SEMESTER_KEY = "unigenius-semester";

function readLocalSemester(): number | null {
  try {
    const v = localStorage.getItem(SEMESTER_KEY);
    const n = v ? parseInt(v, 10) : NaN;
    return n >= 1 && n <= 8 ? n : null;
  } catch {
    return null;
  }
}

/**
 * Single source of truth for the student's current semester.
 *
 * profiles.current_semester is authoritative; the localStorage key
 * "unigenius-semester" is only a first-paint mirror and is kept in sync
 * with the profile. Changing the semester updates BOTH, so Dashboard,
 * Progress, My Subjects, Lectures and the exam countdown can never
 * disagree again.
 *
 * (Bug fixed 24 Nov 2026: Dashboard read only localStorage — a stale "8"
 * from browsing — Progress hardcoded semester 1, while My Subjects read
 * the profile's real semester 2.)
 */
export function useCurrentSemester() {
  const { user } = useAuth();
  const [semester, setSemesterState] = useState<number>(() => readLocalSemester() ?? 1);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!user) {
      setLoaded(true);
      return;
    }
    let cancelled = false;
    supabase
      .from("profiles")
      .select("current_semester")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        const cs = (data as { current_semester?: number } | null)?.current_semester;
        if (typeof cs === "number" && cs >= 1 && cs <= 8) {
          setSemesterState(cs);
          try {
            localStorage.setItem(SEMESTER_KEY, String(cs));
          } catch {
            /* storage unavailable */
          }
        }
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const setSemester = useCallback(
    (sem: number) => {
      if (sem < 1 || sem > 8) return;
      setSemesterState(sem);
      try {
        localStorage.setItem(SEMESTER_KEY, String(sem));
      } catch {
        /* storage unavailable */
      }
      if (user) {
        supabase
          .from("profiles")
          .update({ current_semester: sem } as never)
          .eq("user_id", user.id)
          .then(() => undefined);
      }
    },
    [user],
  );

  return { semester, setSemester, loaded };
}

export default useCurrentSemester;
