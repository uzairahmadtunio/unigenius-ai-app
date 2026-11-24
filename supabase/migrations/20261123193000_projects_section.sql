-- Projects section (owner-approved content pack, 2026-11-23):
--   projects — curated project ideas for Sem 1–8 (beginner → FYP-grade),
--              seeded verbatim from unigenius-projects-pack.json (44 rows).
-- RLS mirrors the app's existing patterns: public read (subject_lectures /
-- subject_topics pattern), admin-only writes via has_role (subjects_pool
-- pattern), service_role full access for pipelines.

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  title text not null unique,
  level integer not null check (level between 1 and 4),
  level_name text not null,
  semesters text not null,
  one_line text not null,
  why_useful text not null,
  features text[] not null default '{}',
  tech_stack text[] not null default '{}',
  difficulty text not null,
  estimated_weeks integer not null,
  reference_links text[] not null default '{}',
  domains text[] not null default '{}',
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists projects_level_idx
  on public.projects (level, sort_order);
create index if not exists projects_domains_idx
  on public.projects using gin (domains);

alter table public.projects enable row level security;

-- ── projects: public read, admin write ────────────────────────────────
create policy "Projects are public" on public.projects
  for select to public using (true);
create policy "Admins can add projects" on public.projects
  for insert to authenticated
  with check (public.has_role(auth.uid(), 'admin'::app_role));
create policy "Admins can update projects" on public.projects
  for update to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role))
  with check (public.has_role(auth.uid(), 'admin'::app_role));
create policy "Admins can delete projects" on public.projects
  for delete to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role));

-- ── Grants (RLS still gates authenticated writes to admins) ───────────
grant select on public.projects to anon, authenticated;
grant insert, update, delete on public.projects to authenticated;
grant select, insert, update, delete on public.projects to service_role;
