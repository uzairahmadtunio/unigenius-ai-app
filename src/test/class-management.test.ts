import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Class Management Controls (26 Nov 2026): deleteClass storage sweep +
 * best-effort audit logging. The database behaviour (RLS, cascade,
 * suspend semantics) is covered by the API-level E2E; here we pin the
 * client-side contract of the two new lib functions.
 */
const h = vi.hoisted(() => ({
  calls: [] as any[],
  listImpl: (_prefix: string): any[] => [],
  removeResult: { data: [] as any[] | null, error: null as any },
  deleteError: null as any,
  insertError: null as any,
}));

vi.mock("@/integrations/supabase/client", () => {
  const builder = (table: string): any => {
    const b: any = {
      delete: () => { h.calls.push(["delete", table]); return b; },
      eq: () => Promise.resolve({ error: h.deleteError }),
      insert: (row: any) => {
        h.calls.push(["insert", table, row]);
        return h.insertError ? Promise.reject(new Error("audit down")) : Promise.resolve({ error: null });
      },
    };
    return b;
  };
  return {
    supabase: {
      from: (table: string) => builder(table),
      storage: {
        from: () => ({
          list: async (prefix: string) => ({ data: h.listImpl(prefix), error: null }),
          remove: async (paths: string[]) => { h.calls.push(["storage.remove", paths]); return h.removeResult; },
        }),
      },
    },
  };
});

import { deleteClass, logClassAudit } from "@/lib/classes";

beforeEach(() => {
  h.calls = [];
  h.listImpl = () => [];
  h.removeResult = { data: [], error: null };
  h.deleteError = null;
  h.insertError = null;
});

describe("deleteClass", () => {
  it("sweeps nested storage files first, then deletes the class row", async () => {
    h.listImpl = (prefix: string) => {
      if (prefix === "cls1") return [{ name: "materials", id: null }, { name: "f1.pdf", id: "a" }];
      if (prefix === "cls1/materials") return [{ name: "lec.pdf", id: "b" }];
      if (prefix === "cls1/submissions") return [];
      return [];
    };
    h.removeResult = { data: [{ name: "x" }, { name: "y" }], error: null };
    const r = await deleteClass("cls1");
    const removeCall = h.calls.find((c) => c[0] === "storage.remove");
    expect(removeCall).toBeTruthy();
    expect([...removeCall[1]].sort()).toEqual(["cls1/f1.pdf", "cls1/materials/lec.pdf"]);
    expect(r).toEqual({ filesRemoved: 2, filesFailed: false });
    expect(h.calls.some((c) => c[0] === "delete" && c[1] === "classes")).toBe(true);
  });

  it("skips the storage remove when the class has no files", async () => {
    const r = await deleteClass("cls-empty");
    expect(h.calls.some((c) => c[0] === "storage.remove")).toBe(false);
    expect(r).toEqual({ filesRemoved: 0, filesFailed: false });
    expect(h.calls.some((c) => c[0] === "delete" && c[1] === "classes")).toBe(true);
  });

  it("still deletes the row when the storage sweep fails, and reports it honestly", async () => {
    h.listImpl = (prefix: string) => (prefix === "cls1" ? [{ name: "f1.pdf", id: "a" }] : []);
    h.removeResult = { data: null, error: new Error("storage down") };
    const r = await deleteClass("cls1");
    expect(r.filesFailed).toBe(true);
    expect(h.calls.some((c) => c[0] === "delete" && c[1] === "classes")).toBe(true);
  });

  it("throws when the class-row delete itself fails", async () => {
    h.deleteError = new Error("rls says no");
    await expect(deleteClass("cls1")).rejects.toThrow("rls says no");
  });
});

describe("logClassAudit", () => {
  it("inserts an audit_log row with actor, action and details", async () => {
    await logClassAudit("teacher-1", "class_student_suspend", { class_id: "cls1", student_id: "stu-1" });
    const ins = h.calls.find((c) => c[0] === "insert");
    expect(ins[1]).toBe("audit_log");
    expect(ins[2]).toMatchObject({ actor_id: "teacher-1", action: "class_student_suspend", details: { class_id: "cls1", student_id: "stu-1" } });
  });

  it("never throws — a failed audit insert must not block the action", async () => {
    h.insertError = new Error("audit down");
    await expect(logClassAudit("teacher-1", "class_delete", { class_id: "cls1" })).resolves.toBeUndefined();
  });
});
