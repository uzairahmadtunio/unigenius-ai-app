import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Rocket, Search, Loader2, Clock, Gauge, ChevronRight, Code2, Users, BookOpen,
  Landmark, Calculator, GraduationCap, HeartPulse, ShoppingBag, Gamepad2,
  ShieldCheck, Wifi, Leaf, Bus, Briefcase, Database, MonitorSmartphone,
  Accessibility, FolderGit2, Layers, type LucideIcon,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import PageShell from "@/components/PageShell";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export type Project = {
  id: string;
  title: string;
  level: number;
  level_name: string;
  semesters: string;
  one_line: string;
  why_useful: string;
  features: string[];
  tech_stack: string[];
  difficulty: string;
  estimated_weeks: number;
  reference_links: string[];
  domains: string[];
};

const LEVELS: { value: number | "all"; label: string }[] = [
  { value: "all", label: "All Levels" },
  { value: 1, label: "Beginner · Sem 1–2" },
  { value: 2, label: "Intermediate · Sem 3–4" },
  { value: 3, label: "Advanced · Sem 5–6" },
  { value: 4, label: "FYP-Grade · Sem 7–8" },
];

export const difficultyStyles: Record<string, string> = {
  Easy: "bg-primary/15 text-primary",
  Medium: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  Hard: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-300",
};

// One chip component/style shared by BOTH filter rows (level + category).
const FilterChip = ({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) => (
  <button
    onClick={onClick}
    className={cn(
      "rounded-full border px-3.5 h-8 text-[13px] font-medium transition-colors whitespace-nowrap shrink-0",
      active
        ? "gradient-button text-primary-foreground border-transparent"
        : "border-border text-muted-foreground hover:text-foreground hover:border-primary/40",
    )}
  >
    {children}
  </button>
);

// Line icon per project, picked from its real domains/title keywords.
const domainIcons: Record<string, LucideIcon> = {
  Education: GraduationCap,
  Finance: Landmark,
  Business: Briefcase,
  Healthcare: HeartPulse,
  "AI/ML": Code2,
  Data: Database,
  Desktop: MonitorSmartphone,
  Mobile: MonitorSmartphone,
  Web: Code2,
  "Game Development": Gamepad2,
  Security: ShieldCheck,
  Networking: Wifi,
  IoT: Wifi,
  Agriculture: Leaf,
  Transport: Bus,
  Accessibility: Accessibility,
  Blockchain: Layers,
};

const projectIcon = (p: Project): LucideIcon => {
  const t = p.title.toLowerCase();
  if (t.includes("student") || t.includes("record")) return Users;
  if (t.includes("library") || t.includes("book")) return BookOpen;
  if (t.includes("bank") || t.includes("account")) return Landmark;
  if (t.includes("cgpa") || t.includes("grade") || t.includes("calculator")) return Calculator;
  if (t.includes("shop") || t.includes("store") || t.includes("commerce")) return ShoppingBag;
  for (const d of p.domains || []) {
    if (domainIcons[d]) return domainIcons[d];
  }
  return FolderGit2;
};

const ProjectsPage = () => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [level, setLevel] = useState<number | "all">("all");
  const [domain, setDomain] = useState<string>("All");
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("projects" as any)
        .select(
          "id, title, level, level_name, semesters, one_line, why_useful, features, tech_stack, difficulty, estimated_weeks, reference_links, domains",
        )
        .order("level", { ascending: true })
        .order("sort_order", { ascending: true });
      if (!cancelled) {
        setProjects((data as unknown as Project[]) || []);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const domains = useMemo(() => {
    const set = new Set<string>();
    projects.forEach((p) => (p.domains || []).forEach((d) => set.add(d)));
    return ["All", ...Array.from(set).sort()];
  }, [projects]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return projects.filter((p) => {
      if (level !== "all" && p.level !== level) return false;
      if (domain !== "All" && !(p.domains || []).includes(domain)) return false;
      if (!q) return true;
      const haystack = [
        p.title,
        p.one_line,
        p.difficulty,
        ...(p.tech_stack || []),
        ...(p.domains || []),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [projects, level, domain, query]);

  return (
    <PageShell
      title="Projects"
      seoTitle="Semester & Final Year Project Ideas for CS, SE & AI Students | UniGenius AI"
      seoDescription="Ready project ideas for every semester — from beginner mini-projects to final year projects — with full details, features and real examples."
      seoPath="/projects"
      subtitle="Ready project ideas for every semester — from beginner to final year project, with full details and real examples."
      icon={
        <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center">
          <Rocket className="w-5 h-5 text-primary" />
        </div>
      }
    >
      <div className="max-w-6xl mx-auto space-y-5 pb-6">
        {/* Search */}
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search projects or tech…"
            className="pl-9 rounded-xl"
          />
        </div>

        {/* Level filter — same chip component as the category row */}
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Level</p>
          <div className="flex flex-wrap gap-2">
            {LEVELS.map((l) => (
              <FilterChip key={String(l.value)} active={level === l.value} onClick={() => setLevel(l.value)}>
                {l.label}
              </FilterChip>
            ))}
          </div>
        </div>

        {/* Category filter — identical chip component */}
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Category</p>
          <div className="flex flex-wrap gap-2">
            {domains.map((d) => (
              <FilterChip key={d} active={domain === d} onClick={() => setDomain(d)}>
                {d}
              </FilterChip>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-7 h-7 animate-spin text-primary" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="glass rounded-2xl border border-border p-8 text-center text-muted-foreground">
            No project found in this filter — try changing the search or level.
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {filtered.length} project{filtered.length === 1 ? "" : "s"}
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              {filtered.map((p, i) => {
                const Icon = projectIcon(p);
                return (
                  <motion.div
                    key={p.id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(i * 0.03, 0.3) }}
                  >
                    <Link
                      to={`/projects/${p.id}`}
                      className="group flex h-full glass rounded-2xl border border-border p-4 hover:border-primary/40 transition-colors gap-3.5"
                    >
                      <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                        <Icon className="w-5 h-5 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0 flex flex-col">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="rounded-full bg-primary/15 text-primary px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap">
                            {p.level_name}
                          </span>
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap",
                              difficultyStyles[p.difficulty] || "bg-secondary text-secondary-foreground",
                            )}
                          >
                            {p.difficulty}
                          </span>
                        </div>
                        <h3 className="mt-2 font-semibold leading-snug group-hover:text-primary transition-colors">
                          {p.title}
                        </h3>
                        {/* The projects table has no author column — the
                            founder-approved neutral byline is used. */}
                        <p className="mt-0.5 text-xs text-muted-foreground">by UniGenius Team</p>
                        <p className="mt-1.5 text-sm text-muted-foreground line-clamp-3">{p.one_line}</p>
                        <div className="mt-2.5 flex flex-wrap gap-1.5">
                          {(p.tech_stack || []).map((t) => (
                            <span
                              key={t}
                              className="rounded-md bg-secondary/70 px-1.5 py-0.5 text-[11px] text-secondary-foreground"
                            >
                              {t}
                            </span>
                          ))}
                        </div>
                        <div className="flex-1" />
                        <div className="mt-3 pt-2.5 border-t border-border/60 flex items-center gap-4 text-xs text-muted-foreground">
                          <span className="inline-flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5" /> ~{p.estimated_weeks} week
                            {p.estimated_weeks === 1 ? "" : "s"}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <Gauge className="w-3.5 h-3.5" /> {p.semesters}
                          </span>
                          <ChevronRight className="w-4 h-4 ml-auto group-hover:translate-x-0.5 transition-transform" />
                        </div>
                      </div>
                    </Link>
                  </motion.div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </PageShell>
  );
};

export default ProjectsPage;
