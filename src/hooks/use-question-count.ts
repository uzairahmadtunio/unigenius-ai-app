import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Live question-bank size for public stat surfaces (audit F-10: the
 * copy was hardcoded to a stale "2,410"). Backed by the
 * get_question_bank_count() RPC, which returns ONLY the count (the
 * bank itself stays RLS-closed to guests). Falls back to the last
 * verified count when the RPC is unreachable.
 */
export const QUESTION_COUNT_FALLBACK = 2495;

export function useQuestionCount(): number {
  const { data } = useQuery({
    queryKey: ["question-bank-count"],
    staleTime: 60 * 60 * 1000,
    queryFn: async () => {
      // The RPC was added after the generated types were last built,
      // so call it through a narrow typed shim instead of `any`.
      const rpc = supabase.rpc.bind(supabase) as unknown as (
        fn: string,
      ) => Promise<{ data: unknown; error: unknown }>;
      const { data, error } = await rpc("get_question_bank_count");
      if (error || typeof data !== "number") return null;
      return data;
    },
  });
  return data ?? QUESTION_COUNT_FALLBACK;
}

export function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}
