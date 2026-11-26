import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import React from "react";

/**
 * Home Classes Tile Fix (Uzair, 26 Nov 2026): the big dashed
 * "Join a Class" box + "My Classes" block left the student Home.
 * Classes is now a tile in the QuickActions grid (→ /classes), and
 * MyClassesSection renders ONLY the "Due This Week" strip.
 */

// ---- QuickActions deps: no department chosen -> plain tutor copy ----
vi.mock("@/contexts/DepartmentContext", () => ({
  useDepartment: () => ({ department: null }),
  departmentInfo: {},
}));

// ---- MyClassesSection deps: controllable auth user + table data ----
const h = vi.hoisted(() => ({
  user: { id: "student-1" } as { id: string } | null,
  tables: {} as Record<string, unknown[]>,
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: h.user }),
}));

vi.mock("@/integrations/supabase/client", () => {
  const makeChain = (rows: unknown[]) => {
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      in: () => chain,
      then: (resolve: (v: { data: unknown[] }) => void) =>
        Promise.resolve({ data: rows }).then(resolve),
    };
    return chain;
  };
  return { supabase: { from: (t: string) => makeChain(h.tables[t] ?? []) } };
});

import QuickActions from "@/components/QuickActions";
import MyClassesSection from "@/components/home/MyClassesSection";

beforeEach(() => {
  vi.clearAllMocks();
  h.user = { id: "student-1" };
  h.tables = {};
});

describe("QuickActions — Classes tile", () => {
  const renderGrid = () =>
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<QuickActions />} />
          <Route path="/classes" element={<div>CLASSES PAGE PROBE</div>} />
        </Routes>
      </MemoryRouter>,
    );

  it("shows a Classes tile with the join/classes subtitle", () => {
    renderGrid();
    expect(screen.getByText("Classes")).toBeInTheDocument();
    expect(
      screen.getByText("Join classes · tests, homework & results"),
    ).toBeInTheDocument();
  });

  it("places Classes up front, before Courses and Practice", () => {
    renderGrid();
    const labels = screen
      .getAllByRole("button")
      .map((b) => b.textContent || "");
    const idx = (s: string) => labels.findIndex((t) => t.includes(s));
    expect(idx("Classes")).toBeGreaterThanOrEqual(0);
    expect(idx("Classes")).toBeLessThan(idx("Courses"));
    expect(idx("Classes")).toBeLessThan(idx("Practice"));
  });

  it("navigates to /classes when the tile is tapped", async () => {
    renderGrid();
    fireEvent.click(screen.getByText("Classes"));
    expect(await screen.findByText("CLASSES PAGE PROBE")).toBeInTheDocument();
  });
});

describe("MyClassesSection — Due This Week only", () => {
  it("renders nothing for a signed-out visitor", async () => {
    h.user = null;
    const { container } = render(
      <MemoryRouter>
        <MyClassesSection />
      </MemoryRouter>,
    );
    await waitFor(() => expect(container.textContent).toBe(""));
    expect(screen.queryByText("My Classes")).not.toBeInTheDocument();
  });

  it("renders nothing (no join box) when the student has no classes", async () => {
    h.tables = { class_members: [] };
    const { container } = render(
      <MemoryRouter>
        <MyClassesSection />
      </MemoryRouter>,
    );
    // loaded state reached, still empty
    await waitFor(() => expect(container.textContent).toBe(""));
    expect(screen.queryByText("My Classes")).not.toBeInTheDocument();
    expect(screen.queryByText("Join a Class")).not.toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText("ENTER CLASS CODE"),
    ).not.toBeInTheDocument();
  });

  it("shows Due This Week but never the My Classes block or join box", async () => {
    const dueSoon = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    h.tables = {
      class_members: [{ class_id: "c1", status: "active" }],
      classes: [{ id: "c1", title: "Discrete Structures" }],
      class_posts: [
        {
          id: "p1",
          class_id: "c1",
          type: "homework",
          title: "HW 5 — Graph Theory",
          due_at: dueSoon,
          max_marks: 10,
        },
      ],
      assignment_submissions: [],
      class_test_attempts: [],
    };
    render(
      <MemoryRouter>
        <MyClassesSection />
      </MemoryRouter>,
    );
    expect(await screen.findByText("Due This Week")).toBeInTheDocument();
    expect(screen.getByText(/HW 5 — Graph Theory/)).toBeInTheDocument();
    expect(screen.queryByText("My Classes")).not.toBeInTheDocument();
    expect(screen.queryByText("Join a Class")).not.toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText("ENTER CLASS CODE"),
    ).not.toBeInTheDocument();
  });
});
