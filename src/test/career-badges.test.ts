import { describe, it, expect, vi, beforeEach } from "vitest";

// Career Hub points/badges run on mocked supabase chains: activities come
// from career_activity, existing badges from user_badges, and awards go
// through the award_badge / record_career_activity RPCs.
const h = vi.hoisted(() => ({
  tables: {} as Record<string, any[]>,
  rpc: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: h.rpc,
    from: (table: string) => {
      const chain: any = Promise.resolve({ data: h.tables[table] ?? [] });
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.single = () =>
        Promise.resolve({ data: (h.tables[table] ?? [])[0] ?? null, error: null });
      chain.maybeSingle = () =>
        Promise.resolve({ data: (h.tables[table] ?? [])[0] ?? null });
      return chain;
    },
  },
}));

vi.mock("canvas-confetti", () => ({ default: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { success: h.toastSuccess, error: vi.fn() },
}));

import { recordCareerActivity, checkAndAwardBadges } from "@/lib/career-points";

const acts = (type: string, n: number, metadata: any = {}) =>
  Array.from({ length: n }, () => ({ activity_type: type, metadata }));

beforeEach(() => {
  vi.clearAllMocks();
  h.tables = { career_activity: [], user_badges: [] };
  h.rpc.mockResolvedValue({ data: true, error: null });
});

describe("recordCareerActivity", () => {
  it("returns true and calls the RPC with the activity type and metadata", async () => {
    const ok = await recordCareerActivity("u1", "dsa_solve", 20, { problem_id: 3 });
    expect(ok).toBe(true);
    expect(h.rpc).toHaveBeenCalledWith("record_career_activity", {
      _activity_type: "dsa_solve",
      _metadata: { problem_id: 3 },
    });
  });

  it("returns false when the RPC errors", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "denied" } });
    expect(await recordCareerActivity("u1", "cv_score", 10)).toBe(false);
  });
});

describe("checkAndAwardBadges", () => {
  const awardedIds = () =>
    h.rpc.mock.calls.filter((c) => c[0] === "award_badge").map((c) => c[1]._badge_id);

  it("awards DSA Warrior at exactly 5 solved problems", async () => {
    h.tables.career_activity = acts("dsa_solve", 5);
    await checkAndAwardBadges("u1");
    expect(awardedIds()).toEqual(["dsa_warrior"]);
    expect(h.toastSuccess).toHaveBeenCalledWith(
      expect.stringContaining("DSA Warrior"),
      expect.anything(),
    );
  });

  it("awards nothing at 4 solved problems", async () => {
    h.tables.career_activity = acts("dsa_solve", 4);
    await checkAndAwardBadges("u1");
    expect(awardedIds()).toEqual([]);
  });

  it("awards Interview Ready at 5 completed interviews", async () => {
    h.tables.career_activity = acts("interview_complete", 5);
    await checkAndAwardBadges("u1");
    expect(awardedIds()).toEqual(["interview_ready"]);
  });

  it("awards CV Ready for any CV analysis and CV Master only at score >= 80", async () => {
    h.tables.career_activity = acts("cv_score", 1, { score: 85 });
    await checkAndAwardBadges("u1");
    expect(awardedIds().sort()).toEqual(["cv_master", "cv_ready"]);

    vi.clearAllMocks();
    h.rpc.mockResolvedValue({ data: true, error: null });
    h.tables.career_activity = acts("cv_score", 1, { score: 79 });
    await checkAndAwardBadges("u1");
    expect(awardedIds()).toEqual(["cv_ready"]);
  });

  it("never re-awards a badge the student already owns", async () => {
    h.tables.career_activity = acts("dsa_solve", 9);
    h.tables.user_badges = [{ badge_id: "dsa_warrior" }];
    await checkAndAwardBadges("u1");
    expect(awardedIds()).toEqual([]);
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("does not toast when the award RPC declines (data !== true)", async () => {
    h.tables.career_activity = acts("dsa_solve", 5);
    h.rpc.mockResolvedValue({ data: false, error: null });
    await checkAndAwardBadges("u1");
    expect(awardedIds()).toEqual(["dsa_warrior"]); // attempted
    expect(h.toastSuccess).not.toHaveBeenCalled(); // but not celebrated
  });
});
