import { useEffect, useMemo, useState } from "react";
import { Building2, Check, ChevronDown, ExternalLink, Loader2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/contexts/AuthContext";
import { useDepartment, departmentInfo, type Department } from "@/contexts/DepartmentContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type ProgramCode = "SE" | "CS" | "AI";
const PROGRAMS: ProgramCode[] = ["SE", "CS", "AI"];
const PROGRAM_LABELS: Record<ProgramCode, string> = {
  SE: "BS Software Engineering",
  CS: "BS Computer Science",
  AI: "BS Artificial Intelligence",
};

interface University {
  id: string;
  name: string;
  city: string | null;
}

interface SchemeRow {
  university_id: string;
  program: ProgramCode;
  semester: number;
  subjects: string[];
  scheme_year: string | null;
  source_url: string | null;
}

interface PoolRef {
  id: string;
  name: string;
}

interface Props {
  /** subjects_pool (id + name) — used to link loaded subjects to pool rows. */
  pool: PoolRef[];
  /** Called after a preset is applied so the page can refresh its rows. */
  onApplied?: () => void;
}

/**
 * Phase 3b — "Apni University se auto-load karein".
 * The student picks their HEC-recognised university + program; if a
 * verified scheme of studies exists for it, one tap loads every seeded
 * semester into their user_subjects (preset + override: everything stays
 * editable in the manager below). Universities without a verified scheme
 * fall back to the pool/manual flow, and the card says so plainly.
 */
const UniversityPresetLoader = ({ pool, onApplied }: Props) => {
  const { user } = useAuth();
  const { department } = useDepartment();
  const [universities, setUniversities] = useState<University[]>([]);
  const [schemes, setSchemes] = useState<SchemeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selected, setSelected] = useState<University | null>(null);
  const [program, setProgram] = useState<ProgramCode>(
    department ? (department.toUpperCase() as ProgramCode) : "SE"
  );
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const [lastResult, setLastResult] = useState<{ loaded: number[]; missing: number[] } | null>(null);

  // Universities (picker) + all scheme rows (availability) load once.
  useEffect(() => {
    (async () => {
      const [unis, sch] = await Promise.all([
        supabase
          .from("universities" as any)
          .select("id, name, city")
          .order("name", { ascending: true }),
        supabase
          .from("university_schemes" as any)
          .select("university_id, program, semester, subjects, scheme_year, source_url")
          .order("semester", { ascending: true }),
      ]);
      if (!unis.error) setUniversities((unis.data as unknown as University[]) || []);
      if (!sch.error) setSchemes((sch.data as unknown as SchemeRow[]) || []);
      setLoading(false);
    })();
  }, []);

  // Preselect the university already saved on the student's profile.
  useEffect(() => {
    if (!user || universities.length === 0) return;
    supabase
      .from("profiles")
      .select("university")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        const saved = (data as any)?.university as string | null;
        if (!saved) return;
        const match = universities.find((u) => u.name.toLowerCase() === saved.toLowerCase());
        if (match) {
          setSelected(match);
          setQuery(match.name);
        }
      });
  }, [user, universities]);

  const poolByName = useMemo(() => {
    const map = new Map<string, string>();
    pool.forEach((p) => map.set(p.name.toLowerCase(), p.id));
    return map;
  }, [pool]);

  /** university_id → set of programs that have at least one seeded semester. */
  const programsByUniversity = useMemo(() => {
    const map = new Map<string, Set<ProgramCode>>();
    schemes.forEach((s) => {
      if (!map.has(s.university_id)) map.set(s.university_id, new Set());
      map.get(s.university_id)!.add(s.program);
    });
    return map;
  }, [schemes]);

  const schemeRows = useMemo(
    () =>
      selected
        ? schemes
            .filter((s) => s.university_id === selected.id && s.program === program)
            .sort((a, b) => a.semester - b.semester)
        : [],
    [schemes, selected, program]
  );
  const loadedSemesters = schemeRows.map((s) => s.semester);
  const missingSemesters = [1, 2, 3, 4, 5, 6, 7, 8].filter((n) => !loadedSemesters.includes(n));
  const hasScheme = schemeRows.length > 0;
  const schemeYear = schemeRows.find((s) => s.scheme_year)?.scheme_year ?? null;
  const sourceUrl = schemeRows.find((s) => s.source_url)?.source_url ?? null;

  const filteredUniversities = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? universities.filter(
          (u) => u.name.toLowerCase().includes(q) || (u.city ?? "").toLowerCase().includes(q)
        )
      : universities;
    return list.slice(0, 12);
  }, [universities, query]);

  const pickUniversity = (u: University) => {
    setSelected(u);
    setQuery(u.name);
    setPickerOpen(false);
    setLastResult(null);
    // If the chosen university only offers schemes for other programs,
    // preselect one that exists so the student isn't left on a dead end.
    const available = programsByUniversity.get(u.id);
    if (available && !available.has(program)) {
      const first = PROGRAMS.find((p) => available.has(p));
      if (first) setProgram(first);
    }
  };

  const applyPreset = async () => {
    if (!user || !selected || !hasScheme || applying) return;
    setApplying(true);
    try {
      const appliedSemesters: number[] = [];
      for (const row of schemeRows) {
        // Dedupe within the semester (case-insensitive), keep scheme order.
        const seen = new Set<string>();
        const names = (row.subjects || []).filter((n) => {
          const key = n.trim().toLowerCase();
          if (!key || seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        const { error: delError } = await supabase
          .from("user_subjects" as any)
          .delete()
          .eq("user_id", user.id)
          .eq("semester", row.semester);
        if (delError) throw delError;
        if (names.length) {
          const payload = names.map((name) => ({
            user_id: user.id,
            name: name.trim(),
            pool_id: poolByName.get(name.trim().toLowerCase()) ?? null,
            semester: row.semester,
            department: program.toLowerCase() as Department,
            custom: false,
          }));
          const { error: insError } = await supabase.from("user_subjects" as any).insert(payload);
          if (insError) throw insError;
        }
        appliedSemesters.push(row.semester);
      }
      // Remember the student's university on their profile.
      const { error: profError } = await supabase
        .from("profiles")
        .update({ university: selected.name } as any)
        .eq("user_id", user.id);
      if (profError) console.error("[UniversityPreset] profile university save failed:", profError);

      setLastResult({ loaded: appliedSemesters, missing: missingSemesters });
      toast.success(
        `${selected.name} scheme loaded — Semester ${appliedSemesters.join(", ")}`
      );
      onApplied?.();
    } catch (e: any) {
      console.error("[UniversityPreset] apply failed:", e);
      toast.error(e?.message || "The scheme could not be loaded");
    } finally {
      setApplying(false);
      setConfirmOpen(false);
    }
  };

  return (
    <div className="glass rounded-2xl p-5 space-y-4">
      <div className="space-y-1">
        <h3 className="font-display font-semibold text-foreground text-sm flex items-center gap-2">
          <Building2 className="w-4 h-4 text-primary" /> Auto-load from your university
        </h3>
        <p className="text-xs text-muted-foreground">
          Select your university and program — if its verified scheme of studies is available, the subjects of all
          semesters will load into your lists in one tap. You can change any semester's list below at any
          time.
        </p>
      </div>

      {/* University picker */}
      <div className="relative">
        <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 z-10" />
        <Input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPickerOpen(true);
            if (selected && e.target.value !== selected.name) setSelected(null);
          }}
          onFocus={() => setPickerOpen(true)}
          placeholder="Search your university (HEC recognised)…"
          className="rounded-xl pl-9 pr-16"
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {selected && (
            <button
              className="text-muted-foreground hover:text-foreground p-1"
              onClick={() => {
                setSelected(null);
                setQuery("");
                setLastResult(null);
              }}
              aria-label="Clear university"
            >
              <X className="w-4 h-4" />
            </button>
          )}
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        </div>
        {pickerOpen && (
          <div className="absolute z-20 mt-2 w-full max-h-72 overflow-y-auto rounded-xl border border-border bg-popover shadow-elevated">
            {loading ? (
              <p className="px-3 py-3 text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading universities…
              </p>
            ) : filteredUniversities.length === 0 ? (
              <p className="px-3 py-3 text-sm text-muted-foreground">
                No university found — please check the name and try again.
              </p>
            ) : (
              filteredUniversities.map((u) => {
                const available = programsByUniversity.get(u.id);
                return (
                  <button
                    key={u.id}
                    className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-muted/70 transition-colors"
                    onClick={() => pickUniversity(u)}
                  >
                    <span className="text-sm text-foreground flex-1 min-w-0 line-clamp-2">
                      {u.name}
                      {u.city && <span className="text-muted-foreground"> — {u.city}</span>}
                    </span>
                    {available ? (
                      <Badge className="rounded-lg text-[10px] flex-shrink-0">Scheme available</Badge>
                    ) : (
                      <Badge variant="secondary" className="rounded-lg text-[10px] flex-shrink-0">
                        No scheme
                      </Badge>
                    )}
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* Program picker */}
      <div className="flex gap-2 flex-wrap">
        {PROGRAMS.map((p) => {
          const available = selected ? programsByUniversity.get(selected.id)?.has(p) : undefined;
          return (
            <Button
              key={p}
              size="sm"
              variant={program === p ? "default" : "outline"}
              className="rounded-xl gap-1.5"
              onClick={() => {
                setProgram(p);
                setLastResult(null);
              }}
            >
              {program === p && <Check className="w-3.5 h-3.5" />}
              {PROGRAM_LABELS[p]}
              {selected && available === false && (
                <span className="text-[10px] opacity-70">(no scheme)</span>
              )}
            </Button>
          );
        })}
      </div>

      {/* Status + load */}
      {selected && (
        <div className="space-y-3">
          {hasScheme ? (
            <>
              <div className="rounded-xl bg-muted/60 px-3 py-2.5 text-sm text-foreground space-y-1">
                <p>
                  <span className="font-medium">{selected.name}</span> — {PROGRAM_LABELS[program]}{" "}
                  scheme available: Semester {loadedSemesters.join(", ")} will be loaded
                  {missingSemesters.length > 0 &&
                    ` · The scheme for Semester ${missingSemesters.join(", ")} is not available yet, so those lists will stay as they are`}
                  .
                </p>
                <p className="text-xs text-muted-foreground">
                  {schemeYear && <>Scheme year: {schemeYear}. </>}
                  {sourceUrl && (
                    <a
                      href={sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-foreground"
                    >
                      Official source <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </p>
              </div>
              <Button
                className="rounded-xl gradient-primary text-primary-foreground gap-1.5"
                disabled={applying}
                onClick={() => setConfirmOpen(true)}
              >
                {applying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Building2 className="w-4 h-4" />}
                Load subjects — {selected.name}
              </Button>
            </>
          ) : (
            <div className="rounded-xl bg-muted/60 px-3 py-2.5 text-sm text-muted-foreground">
              This university's scheme is not available yet — pick subjects from the pool (Subjects Pool
              below) or add your own subject.
              {department && (
                <> For now, you can use the default {departmentInfo[department].fullName} list.</>
              )}
            </div>
          )}
          {lastResult && (
            <p className="text-xs text-muted-foreground">
              Done: Semester {lastResult.loaded.join(", ")} loaded
              {lastResult.missing.length > 0 &&
                ` · The scheme for Semester ${lastResult.missing.join(", ")} was not available, so those lists were not changed`}
              . You can change any semester's list further below.
            </p>
          )}
        </div>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Load the university scheme?</AlertDialogTitle>
            <AlertDialogDescription>
              {selected?.name} — the {PROGRAM_LABELS[program]} scheme will <strong>replace</strong>
              your current lists for Semester{" "}
              {loadedSemesters.join(", ")}.
              {missingSemesters.length > 0 &&
                ` The scheme for Semester ${missingSemesters.join(", ")} is not available — those lists will stay as they are.`}{" "}
              You can change any semester's list from this page later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={applying}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={applyPreset} disabled={applying}>
              {applying ? "Loading…" : "Load subjects"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default UniversityPresetLoader;
