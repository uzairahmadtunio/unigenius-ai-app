-- Notes Reader foundation (Degree Content Masterplan, Part 2a/2b):
--   subject_topics — syllabus skeleton per subject (shared topic vocabulary
--                    with question_bank.topic)
--   topic_pages    — the on-platform study pages (theory, code, key points,
--                    common mistakes), with a draft/reviewed/published workflow
--   library_books  — openly-licensed books mirrored for in-app reading
-- RLS mirrors the app's existing patterns: public read of published/curated
-- content (subject_lectures pattern), admin-only writes via has_role
-- (subjects_pool pattern), service_role full access for pipelines.

create table if not exists public.subject_topics (
  id uuid primary key default gen_random_uuid(),
  subject text not null,
  semester integer,
  topic_no integer not null,
  title text not null,
  slug text not null,
  has_lab boolean not null default false,
  created_at timestamptz not null default now(),
  unique (subject, topic_no),
  unique (subject, slug)
);
create index if not exists subject_topics_subject_idx
  on public.subject_topics (subject, topic_no);

create table if not exists public.topic_pages (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.subject_topics (id) on delete cascade,
  subject text not null,
  title text not null,
  body_md text not null default '',
  code_examples jsonb not null default '[]'::jsonb,
  key_points text[] not null default '{}',
  common_mistakes text[] not null default '{}',
  diagram_md text,
  status text not null default 'draft'
    check (status in ('draft', 'reviewed', 'published')),
  source_type text not null default 'ai_authored'
    check (source_type in ('ai_authored', 'adapted_open')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (topic_id)
);
create index if not exists topic_pages_subject_idx
  on public.topic_pages (subject, status);
-- Full-text index so unified search can find topic content later.
create index if not exists topic_pages_fts_idx
  on public.topic_pages using gin (to_tsvector('english', coalesce(body_md, '')));

create table if not exists public.library_books (
  id uuid primary key default gen_random_uuid(),
  subject text not null,
  semester integer,
  title text not null,
  author text,
  source text,
  license text,
  hosted_url text,
  official_url text,
  size_mb numeric,
  page_count integer,
  created_at timestamptz not null default now()
);
create index if not exists library_books_subject_idx
  on public.library_books (subject);

alter table public.subject_topics enable row level security;
alter table public.topic_pages enable row level security;
alter table public.library_books enable row level security;

-- ── subject_topics: public read, admin write ──────────────────────────
create policy "Subject topics are public" on public.subject_topics
  for select to public using (true);
create policy "Admins can add subject topics" on public.subject_topics
  for insert to authenticated
  with check (public.has_role(auth.uid(), 'admin'::app_role));
create policy "Admins can update subject topics" on public.subject_topics
  for update to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role))
  with check (public.has_role(auth.uid(), 'admin'::app_role));
create policy "Admins can delete subject topics" on public.subject_topics
  for delete to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role));

-- ── topic_pages: published read for everyone; staff see drafts too ────
create policy "Published topic pages are public" on public.topic_pages
  for select to public using (status = 'published');
create policy "Staff can view all topic pages" on public.topic_pages
  for select to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role)
         or public.has_role(auth.uid(), 'teacher'::app_role));
create policy "Admins can add topic pages" on public.topic_pages
  for insert to authenticated
  with check (public.has_role(auth.uid(), 'admin'::app_role));
create policy "Admins can update topic pages" on public.topic_pages
  for update to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role))
  with check (public.has_role(auth.uid(), 'admin'::app_role));
create policy "Admins can delete topic pages" on public.topic_pages
  for delete to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role));

-- ── library_books: public read, admin write ───────────────────────────
create policy "Library books are public" on public.library_books
  for select to public using (true);
create policy "Admins can add library books" on public.library_books
  for insert to authenticated
  with check (public.has_role(auth.uid(), 'admin'::app_role));
create policy "Admins can update library books" on public.library_books
  for update to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role))
  with check (public.has_role(auth.uid(), 'admin'::app_role));
create policy "Admins can delete library books" on public.library_books
  for delete to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role));

-- ── Grants (RLS still gates authenticated writes to admins) ───────────
grant select on public.subject_topics to anon, authenticated;
grant insert, update, delete on public.subject_topics to authenticated;
grant select, insert, update, delete on public.subject_topics to service_role;

grant select on public.topic_pages to anon, authenticated;
grant insert, update, delete on public.topic_pages to authenticated;
grant select, insert, update, delete on public.topic_pages to service_role;

grant select on public.library_books to anon, authenticated;
grant insert, update, delete on public.library_books to authenticated;
grant select, insert, update, delete on public.library_books to service_role;
