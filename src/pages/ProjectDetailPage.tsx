import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Rocket, Loader2, Clock, Gauge, CalendarRange, CheckCircle2,
  ExternalLink, Lightbulb, Wrench, ArrowLeft, Layers,
} from "lucide-react";
import PageShell from "@/components/PageShell";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { difficultyStyles, type Project } from "./ProjectsPage";

const ProjectDetailPage = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("projects" as any)
        .select(
          "id, title, level, level_name, semesters, one_line, why_useful, features, tech_stack, difficulty, estimated_weeks, reference_links, domains",
        )
        .eq("id", projectId)
        .maybeSingle();
      if (cancelled) return;
      if (data) setProject(data as unknown as Project);
      else setNotFound(true);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return (
    <PageShell
      title={project ? project.title : "Project"}
      subtitle={
        project ? `${project.level_name} · ${project.semesters}` : "Full details of this project"
      }
      icon={
        <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center">
          <Rocket className="w-5 h-5 text-primary" />
        </div>
      }
    >
      <div className="max-w-4xl mx-auto space-y-6">
        <Link
          to="/projects"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> All projects
        </Link>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-7 h-7 animate-spin text-primary" />
          </div>
        ) : notFound || !project ? (
          <div className="glass rounded-2xl border border-border p-8 text-center text-muted-foreground">
            This project was not found.{" "}
            <Link to="/projects" className="text-primary hover:underline">
              Go back to Projects
            </Link>
            .
          </div>
        ) : (
          <>
            {/* Meta strip */}
            <div className="glass rounded-2xl border border-border p-5 flex flex-wrap items-center gap-x-6 gap-y-3">
              <span
                className={cn(
                  "rounded-full px-2.5 py-1 text-xs font-semibold",
                  difficultyStyles[project.difficulty] || "bg-secondary text-secondary-foreground",
                )}
              >
                {project.difficulty}
              </span>
              <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                <Clock className="w-4 h-4" /> ~{project.estimated_weeks} week
                {project.estimated_weeks === 1 ? "" : "s"}
              </span>
              <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                <CalendarRange className="w-4 h-4" /> {project.semesters}
              </span>
              <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                <Gauge className="w-4 h-4" /> {project.level_name}
              </span>
              {(project.domains || []).length > 0 && (
                <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Layers className="w-4 h-4" /> {project.domains.join(" · ")}
                </span>
              )}
            </div>

            <p className="text-base leading-relaxed">{project.one_line}</p>

            {/* Why useful */}
            <section className="glass rounded-2xl border border-border p-5 sm:p-6">
              <h2 className="flex items-center gap-2 font-semibold">
                <Lightbulb className="w-5 h-5 text-primary" /> Why this project is useful
              </h2>
              <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">
                {project.why_useful}
              </p>
            </section>

            {/* Features */}
            <section className="glass rounded-2xl border border-border p-5 sm:p-6">
              <h2 className="flex items-center gap-2 font-semibold">
                <CheckCircle2 className="w-5 h-5 text-primary" /> What you will build — features
              </h2>
              <ul className="mt-3 space-y-2">
                {(project.features || []).map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-sm">
                    <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-emerald-400" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </section>

            {/* Tech stack */}
            <section className="glass rounded-2xl border border-border p-5 sm:p-6">
              <h2 className="flex items-center gap-2 font-semibold">
                <Wrench className="w-5 h-5 text-primary" /> Tech stack
              </h2>
              <div className="mt-3 flex flex-wrap gap-2">
                {(project.tech_stack || []).map((t) => (
                  <span
                    key={t}
                    className="rounded-lg bg-secondary px-2.5 py-1 text-[13px] font-medium text-secondary-foreground"
                  >
                    {t}
                  </span>
                ))}
              </div>
            </section>

            {/* Reference links */}
            {(project.reference_links || []).length > 0 && (
              <section className="glass rounded-2xl border border-border p-5 sm:p-6">
                <h2 className="flex items-center gap-2 font-semibold">
                  <ExternalLink className="w-5 h-5 text-primary" /> Real examples — reference
                  projects
                </h2>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  See real projects built like this, so you understand what to build.
                </p>
                <div className="mt-3 space-y-2">
                  {project.reference_links.map((url) => (
                    <a
                      key={url}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2.5 rounded-xl border border-border/70 px-3.5 py-2.5 text-sm text-primary hover:border-primary/40 hover:bg-primary/5 transition-colors break-all"
                    >
                      <ExternalLink className="w-4 h-4 shrink-0" />
                      {url}
                    </a>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </PageShell>
  );
};

export default ProjectDetailPage;
