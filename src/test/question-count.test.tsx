import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// Mock the supabase client: the hook binds supabase.rpc and calls
// get_question_bank_count(). The count must come from the RPC when it
// works and fall back to the last verified count when it does not
// (audit F-10: the copy used to be hardcoded and went stale).
const h = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: h.rpc },
}));

import { useQuestionCount, formatCount, QUESTION_COUNT_FALLBACK } from "@/hooks/use-question-count";

// One QueryClient per render (created outside the component so provider
// identity stays stable across re-renders).
const makeWrapper = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("formatCount", () => {
  it("formats with en-US thousands separators", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(999)).toBe("999");
    expect(formatCount(2435)).toBe("2,435");
    expect(formatCount(1_234_567)).toBe("1,234,567");
  });
});

describe("useQuestionCount", () => {
  it("shows the fallback count until the RPC resolves", () => {
    h.rpc.mockReturnValue(new Promise(() => {})); // never resolves
    const { result } = renderHook(() => useQuestionCount(), { wrapper: makeWrapper() });
    expect(result.current).toBe(QUESTION_COUNT_FALLBACK);
  });

  it("uses the live RPC count when it returns a number", async () => {
    h.rpc.mockResolvedValue({ data: 3000, error: null });
    const { result } = renderHook(() => useQuestionCount(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current).toBe(3000));
    expect(h.rpc).toHaveBeenCalledWith("get_question_bank_count");
  });

  it("falls back when the RPC errors", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const { result } = renderHook(() => useQuestionCount(), { wrapper: makeWrapper() });
    // Give the query a tick to settle; value must remain the fallback.
    await new Promise((r) => setTimeout(r, 50));
    expect(result.current).toBe(QUESTION_COUNT_FALLBACK);
  });

  it("falls back when the RPC returns a non-number payload", async () => {
    h.rpc.mockResolvedValue({ data: "2435", error: null });
    const { result } = renderHook(() => useQuestionCount(), { wrapper: makeWrapper() });
    await new Promise((r) => setTimeout(r, 50));
    expect(result.current).toBe(QUESTION_COUNT_FALLBACK);
  });
});
