import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// Quiz of the Day: one bank question picked deterministically by
// day-of-year. The card must render that question, tag it, and route
// Play into Practice Mode carrying the question id.
const h = vi.hoisted(() => ({
  count: 100,
  row: null as any,
  navigate: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (fn: string) => {
      if (fn === "get_question_bank_count") {
        return Promise.resolve({ data: h.count, error: null });
      }
      // list_question_bank_safe: ranged fetch of safe columns
      return {
        range: (from: number, to: number) =>
          Promise.resolve({
            data: h.row && from <= 0 && to >= 0 ? [h.row] : h.row ? [h.row] : [],
            error: null,
          }),
      };
    },
  },
}));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, useNavigate: () => h.navigate };
});

import QuizOfDayCard from "@/components/QuizOfDayCard";

const renderCard = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <QuizOfDayCard />
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  h.count = 100;
  h.row = {
    id: "q-42",
    subject: "Digital Logic Design",
    topic: "Boolean Algebra",
    question: "What is the output of an AND gate when both inputs are 1?",
  };
});

describe("QuizOfDayCard", () => {
  it("renders the picked question with its topic tag", async () => {
    renderCard();
    expect(await screen.findByText(/output of an AND gate/)).toBeInTheDocument();
    expect(screen.getByText("Boolean Algebra")).toBeInTheDocument();
    expect(screen.getByText("QUIZ OF THE DAY")).toBeInTheDocument();
  });

  it("routes Play into Practice Mode carrying the daily question id and subject", async () => {
    renderCard();
    const play = await screen.findByRole("button", { name: /play now/i });
    fireEvent.click(play);
    expect(h.navigate).toHaveBeenCalledWith("/practice", {
      state: { dailyQuestionId: "q-42", dailySubject: "Digital Logic Design" },
    });
  });

  it("falls back to the subject as the tag when the question has no topic", async () => {
    h.row = { ...h.row, topic: null };
    renderCard();
    expect(await screen.findByText(/output of an AND gate/)).toBeInTheDocument();
    expect(screen.getByText("Digital Logic Design")).toBeInTheDocument();
  });

  it("renders nothing when the question bank is empty", async () => {
    h.count = 0;
    h.row = null;
    const { container } = renderCard();
    await waitFor(() => expect(container.firstChild).toBeNull());
  });
});
