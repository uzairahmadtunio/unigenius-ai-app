import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useDepartment } from "@/contexts/DepartmentContext";
import {
  getSubjects,
  makeSubject,
  findDefaultSubjectByName,
  type Subject,
} from "@/data/subjects";

export interface UserSubjectRow {
  id: string;
  user_id: string;
  name: string;
  pool_id: string | null;
  semester: number;
  department: string;
  custom: boolean;
  created_at: string;
  updated_at: string;
}

/** Map a stored user_subjects row to the app's Subject shape, inheriting
 *  icon/lab from the known curriculum entry when the name matches one. */
export const userSubjectToSubject = (row: Pick<UserSubjectRow, "name">): Subject => {
  const known = findDefaultSubjectByName(row.name);
  return known ?? makeSubject(row.name);
};

export interface UseMySubjectsResult {
  /** The student's own list when they customised this semester,
   *  otherwise the hardcoded department defaults. */
  subjects: Subject[];
  /** Raw rows (empty when the semester was never customised). */
  rows: UserSubjectRow[];
  /** True once the user_subjects lookup has settled for this semester. */
  resolved: boolean;
  /** True when the student has a custom list for this semester. */
  isCustom: boolean;
  refresh: () => void;
}

/**
 * Single source of truth for "which subjects does this student have in
 * semester N": their user_subjects rows when present, else the built-in
 * getSubjects(department, semester) defaults. While the lookup is in
 * flight (or if it fails) the defaults are returned, so existing users
 * who never customise see zero change and never an empty flash.
 */
export const useMySubjects = (semester: number): UseMySubjectsResult => {
  const { user } = useAuth();
  const { department } = useDepartment();
  const [rows, setRows] = useState<UserSubjectRow[] | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    if (!user) {
      setRows([]);
      return;
    }
    setRows(null);
    (async () => {
      const { data, error } = await supabase
        .from("user_subjects" as any)
        .select("*")
        .eq("user_id", user.id)
        .eq("semester", semester)
        .order("created_at", { ascending: true });
      if (cancelled) return;
      if (error) {
        // Fall back to defaults rather than showing an empty list.
        console.error("[useMySubjects] load failed, using defaults:", error);
        setRows([]);
        return;
      }
      setRows((data as unknown as UserSubjectRow[]) || []);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, semester, refreshKey]);

  const result = useMemo<UseMySubjectsResult>(() => {
    const resolved = rows !== null;
    const isCustom = resolved && rows.length > 0;
    const subjects = isCustom
      ? rows.map(userSubjectToSubject)
      : department
        ? getSubjects(department, semester)
        : [];
    return { subjects, rows: rows ?? [], resolved, isCustom, refresh };
  }, [rows, department, semester, refresh]);

  return result;
};
