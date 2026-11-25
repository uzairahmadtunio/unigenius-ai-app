import { useCallback, useEffect, useMemo, useState } from "react";
import { BookMarked, Check, Plus, RotateCcw, Search, Sparkles, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import PageShell from "@/components/PageShell";
import SemesterSelector from "@/components/SemesterSelector";
import { useAuth } from "@/contexts/AuthContext";
import { useDepartment, departmentInfo } from "@/contexts/DepartmentContext";
import { supabase } from "@/integrations/supabase/client";
import { getSubjects } from "@/data/subjects";
import UniversityPresetLoader from "@/components/UniversityPresetLoader";
import type { UserSubjectRow } from "@/hooks/use-my-subjects";
import { toast } from "sonner";

interface PoolSubject {
  id: string;
  name: string;
  code: string | null;
  departments: string[];
  suggested_semester: number | null;
}

const MySubjectsPage = () => {
  const { user } = useAuth();
  const { department } = useDepartment();
  const [semester, setSemester] = useState(1);
  const [rows, setRows] = useState<UserSubjectRow[] | null>(null);
  const [pool, setPool] = useState<PoolSubject[]>([]);
  const [search, setSearch] = useState("");
  const [customName, setCustomName] = useState("");
  const [busy, setBusy] = useState(false);
  const [schemeNames, setSchemeNames] = useState<string[] | null>(null);

  // Start on the student's current semester, like the Planner does.
  useEffect(() => {
    if (!user) return;
    supabase
      .from("profiles")
      .select("current_semester")
      .eq("user_id", user.id)
      .single()
      .then(({ data }) => {
        if ((data as any)?.current_semester) setSemester((data as any).current_semester);
      });
  }, [user]);

  // Pool is small (~60 rows) — load it once.
  useEffect(() => {
    supabase
      .from("subjects_pool" as any)
      .select("id, name, code, departments, suggested_semester")
      .order("name", { ascending: true })
      .then(({ data, error }) => {
        if (error) {
          console.error("[MySubjects] pool load failed:", error);
          return;
        }
        setPool((data as unknown as PoolSubject[]) || []);
      });
  }, []);

  const loadRows = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from("user_subjects" as any)
      .select("*")
      .eq("user_id", user.id)
      .eq("semester", semester)
      .order("created_at", { ascending: true });
    if (error) {
      console.error("[MySubjects] rows load failed:", error);
      toast.error("Couldn't load your subjects");
      setRows([]);
      return;
    }
    setRows((data as unknown as UserSubjectRow[]) || []);
  }, [user, semester]);

  useEffect(() => {
    setRows(null);
    loadRows();
  }, [loadRows]);

  // Auto-subjects: if a verified scheme exists for the student's OWN
  // university + program + semester, those subjects become the defaults —
  // the student no longer has to load a preset or add subjects by hand.
  useEffect(() => {
    if (!user || !department) return;
    let cancelled = false;
    (async () => {
      const { data: prof } = await supabase
        .from("profiles")
        .select("university")
        .eq("user_id", user.id)
        .single();
      const uniName = (prof as any)?.university?.trim();
      if (!uniName) return;
      const { data: uni } = await supabase
        .from("universities" as any)
        .select("id")
        .ilike("name", uniName)
        .maybeSingle();
      if (!uni) return;
      const { data: scheme } = await supabase
        .from("university_schemes" as any)
        .select("subjects")
        .eq("university_id", (uni as any).id)
        .eq("program", department.toUpperCase())
        .eq("semester", semester)
        .maybeSingle();
      if (!cancelled && scheme && Array.isArray((scheme as any).subjects)) {
        setSchemeNames((scheme as any).subjects as string[]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, department, semester]);

  const defaults = useMemo(() => {
    if (schemeNames && schemeNames.length) {
      return schemeNames.map((name) => ({ id: `scheme-${name}`, name }) as any);
    }
    return department ? getSubjects(department, semester) : [];
  }, [department, semester, schemeNames]);

  const isCustom = (rows?.length ?? 0) > 0;

  /** What the student currently sees: their rows, or the defaults. */
  const displayList = useMemo(() => {
    if (isCustom) {
      return (rows ?? []).map((r) => ({ key: r.id, name: r.name, custom: r.custom, rowId: r.id as string | null }));
    }
    return defaults.map((s) => ({ key: `default-${s.id}`, name: s.name, custom: false, rowId: null as string | null }));
  }, [rows, isCustom, defaults]);

  const displayNames = useMemo(
    () => new Set(displayList.map((d) => d.name.toLowerCase())),
    [displayList]
  );

  const poolByName = useMemo(() => {
    const map = new Map<string, PoolSubject>();
    pool.forEach((p) => map.set(p.name.toLowerCase(), p));
    return map;
  }, [pool]);

  /**
   * Copy-on-write: the first edit of a semester copies the current
   * default list into user_subjects so add/remove operate on real rows.
   * Returns the fresh rows.
   */
  const materialize = async (): Promise<UserSubjectRow[]> => {
    if (!user || !department) return [];
    if (rows && rows.length > 0) return rows;
    const existing = new Set((rows ?? []).map((r) => r.name.toLowerCase()));
    const payload = defaults
      .filter((s) => !existing.has(s.name.toLowerCase()))
      .map((s) => ({
        user_id: user.id,
        name: s.name,
        pool_id: poolByName.get(s.name.toLowerCase())?.id ?? null,
        semester,
        department,
        custom: false,
      }));
    if (payload.length) {
      const { error } = await supabase.from("user_subjects" as any).insert(payload);
      if (error) throw error;
    }
    const { data, error } = await supabase
      .from("user_subjects" as any)
      .select("*")
      .eq("user_id", user.id)
      .eq("semester", semester)
      .order("created_at", { ascending: true });
    if (error) throw error;
    const fresh = (data as unknown as UserSubjectRow[]) || [];
    setRows(fresh);
    return fresh;
  };

  const runMutation = async (fn: () => Promise<void>, successMsg?: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      if (successMsg) toast.success(successMsg);
      await loadRows();
    } catch (e: any) {
      console.error("[MySubjects] mutation failed:", e);
      toast.error(e?.message || "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  const addFromPool = (p: PoolSubject) =>
    runMutation(async () => {
      if (!user || !department) return;
      if (displayNames.has(p.name.toLowerCase())) {
        toast.info(`${p.name} is already in your list`);
        return;
      }
      const current = await materialize();
      if (current.some((r) => r.name.toLowerCase() === p.name.toLowerCase())) return;
      const { error } = await supabase.from("user_subjects" as any).insert({
        user_id: user.id,
        name: p.name,
        pool_id: p.id,
        semester,
        department,
        custom: false,
      });
      if (error) throw error;
    }, "Subject added");

  const addCustom = () => {
    const name = customName.trim().replace(/\s+/g, " ");
    if (!name) {
      toast.error("Type a subject name first");
      return;
    }
    if (displayNames.has(name.toLowerCase())) {
      toast.error(`${name} is already in your list`);
      return;
    }
    runMutation(async () => {
      if (!user || !department) return;
      const current = await materialize();
      if (current.some((r) => r.name.toLowerCase() === name.toLowerCase())) return;
      const { error } = await supabase.from("user_subjects" as any).insert({
        user_id: user.id,
        name,
        pool_id: null,
        semester,
        department,
        custom: true,
      });
      if (error) throw error;
      setCustomName("");
    }, "Custom subject added");
  };

  const removeSubject = (item: { name: string; rowId: string | null }) =>
    runMutation(async () => {
      if (!user) return;
      let rowId = item.rowId;
      if (!rowId) {
        // Removing from the default view: materialise first, then delete.
        const current = await materialize();
        rowId = current.find((r) => r.name.toLowerCase() === item.name.toLowerCase())?.id ?? null;
      }
      if (!rowId) return;
      const { error } = await supabase
        .from("user_subjects" as any)
        .delete()
        .eq("id", rowId)
        .eq("user_id", user.id);
      if (error) throw error;
    }, "Subject removed");

  const resetSemester = () =>
    runMutation(async () => {
      if (!user) return;
      const { error } = await supabase
        .from("user_subjects" as any)
        .delete()
        .eq("user_id", user.id)
        .eq("semester", semester);
      if (error) throw error;
    }, "Back to the default list");

  // ─── Suggestions ───
  // Pool rows for subjects already in the student's list stay visible and
  // show an "Added" pill instead of an Add button (previously they were
  // filtered out entirely, which hid the duplicate-path state).
  const searchQuery = search.trim().toLowerCase();
  const isInList = useCallback(
    (p: PoolSubject) => displayNames.has(p.name.toLowerCase()),
    [displayNames]
  );
  const searchResults = useMemo(
    () =>
      searchQuery
        ? pool.filter((p) => p.name.toLowerCase().includes(searchQuery))
        : [],
    [pool, searchQuery]
  );
  const suggestedForSemester = useMemo(
    () =>
      department
        ? pool.filter(
            (p) => p.departments.includes(department) && p.suggested_semester === semester
          )
        : [],
    [pool, department, semester]
  );
  const moreFromDepartment = useMemo(
    () =>
      department
        ? pool.filter(
            (p) => p.departments.includes(department) && p.suggested_semester !== semester
          )
        : [],
    [pool, department, semester]
  );

  const renderPoolRow = (p: PoolSubject) => {
    const added = isInList(p);
    return (
      <div key={p.id} className="flex items-center gap-3 rounded-xl bg-muted/60 px-3 py-2.5 min-h-[3.25rem]">
        <span className="text-sm text-foreground flex-1 min-w-0 line-clamp-2">{p.name}</span>
        {p.suggested_semester && (
          <span className="text-[11px] text-muted-foreground flex-shrink-0">Sem {p.suggested_semester}</span>
        )}
        {added ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 border border-primary/30 text-primary text-[11px] font-semibold px-2.5 py-1 flex-shrink-0">
            <Check className="w-3 h-3" /> Added
          </span>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            className="rounded-lg gap-1 flex-shrink-0"
            disabled={busy}
            onClick={() => addFromPool(p)}
          >
            <Plus className="w-3.5 h-3.5" /> Add
          </Button>
        )}
      </div>
    );
  };

  return (
    <PageShell
      title="My Subjects"
      subtitle="Every university has a different scheme — set your own subjects"
      icon={
        <div className="w-10 h-10 rounded-xl gradient-primary flex items-center justify-center shadow-elevated">
          <BookMarked className="w-5 h-5 text-primary-foreground" />
        </div>
      }
    >
      {!user ? (
        <div className="glass rounded-2xl p-6 text-sm text-muted-foreground">Sign in to manage your subjects.</div>
      ) : !department ? (
        <div className="glass rounded-2xl p-6 text-sm text-muted-foreground">
          First select your department — then you can set your subjects.
        </div>
      ) : (
        <div className="space-y-6 pb-24">
          <UniversityPresetLoader pool={pool} onApplied={() => loadRows()} />

          <div className="space-y-3">
            <h2 className="font-display font-bold text-lg text-foreground">Select Semester</h2>
            <SemesterSelector selected={semester} onSelect={setSemester} />
          </div>

          {/* Current list */}
          <div className="glass rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h3 className="font-display font-semibold text-foreground text-sm">
                Semester {semester} Subjects{" "}
                <span className="text-muted-foreground font-normal">
                  ({departmentInfo[department].name})
                </span>
              </h3>
              {isCustom ? (
                <Badge className="rounded-lg">Your custom list</Badge>
              ) : (
                <Badge variant="secondary" className="rounded-lg">Default list</Badge>
              )}
            </div>

            {rows === null ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : displayList.length === 0 ? (
              <p className="text-sm text-muted-foreground">No subjects yet — add some from the suggestions below.</p>
            ) : (
              <div className="grid gap-2">
                {displayList.map((item) => (
                  <div key={item.key} className="flex items-center gap-3 rounded-xl bg-muted/60 px-3 py-2.5">
                    <span className="text-sm text-foreground flex-1 min-w-0 line-clamp-2">{item.name}</span>
                    {item.custom && (
                      <Badge variant="outline" className="rounded-lg text-[10px] flex-shrink-0">Custom</Badge>
                    )}
                    <Button
                      size="icon"
                      variant="ghost"
                      className="rounded-lg h-8 w-8 flex-shrink-0 text-muted-foreground hover:text-destructive"
                      disabled={busy}
                      onClick={() => removeSubject(item)}
                      aria-label={`Remove ${item.name}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              {isCustom
                ? "This is your own list — these subjects will appear in your Dashboard, Practice, Attendance and Planner."
                : "You are using the default list right now. As soon as you add or remove a subject, it becomes your own list."}
            </p>

            {isCustom && (
              <Button
                variant="outline"
                size="sm"
                className="rounded-xl gap-1.5"
                disabled={busy}
                onClick={resetSemester}
              >
                <RotateCcw className="w-3.5 h-3.5" /> Reset to defaults
              </Button>
            )}
          </div>

          {/* Add your own */}
          <div className="glass rounded-2xl p-5 space-y-3">
            <h3 className="font-display font-semibold text-foreground text-sm flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" /> Add your own subject
            </h3>
            <p className="text-xs text-muted-foreground">
              If a subject is not in the pool, type its name to add it — for example, a special subject of your university.
            </p>
            <div className="flex gap-2">
              <Input
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addCustom()}
                placeholder="e.g. Fehm-e-Quran"
                className="rounded-xl"
              />
              <Button className="rounded-xl gradient-primary text-primary-foreground gap-1 flex-shrink-0" disabled={busy} onClick={addCustom}>
                <Plus className="w-4 h-4" /> Add
              </Button>
            </div>
          </div>

          {/* Pool suggestions */}
          <div className="glass rounded-2xl p-5 space-y-4">
            <h3 className="font-display font-semibold text-foreground text-sm">Subjects Pool</h3>
            <div className="relative">
              <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search all subjects…"
                className="rounded-xl pl-9"
              />
              {search && (
                <button
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setSearch("")}
                  aria-label="Clear search"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {searchQuery ? (
              <div className="space-y-2">
                {searchResults.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No match found — use the box above to add it as a custom subject.
                  </p>
                ) : (
                  searchResults.map(renderPoolRow)
                )}
              </div>
            ) : (
              <>
                {suggestedForSemester.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Suggested for Semester {semester}
                    </p>
                    {suggestedForSemester.map(renderPoolRow)}
                  </div>
                )}
                {moreFromDepartment.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      More from {departmentInfo[department].name}
                    </p>
                    {moreFromDepartment.map(renderPoolRow)}
                  </div>
                )}
                {suggestedForSemester.length === 0 && moreFromDepartment.length === 0 && (
                  <p className="text-sm text-muted-foreground">No pool subjects found for your department yet.</p>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </PageShell>
  );
};

export default MySubjectsPage;
