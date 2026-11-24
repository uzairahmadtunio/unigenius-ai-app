-- Phase 3b: University presets.
-- Students pick their university + program and auto-load that university's
-- verified scheme of studies into their personal subject lists (Phase 3's
-- user_subjects). Schemes are seeded ONLY from officially published sources
-- (university websites / prospectuses / HEC) — see
-- ~/workspace/unigenius/university-schemes.json + RESEARCH.md for provenance.
-- Additive only: two new tables, no changes to existing ones.

-- ─── HEC-recognised universities (picker list) ───
CREATE TABLE IF NOT EXISTS public.universities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  city text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS universities_lower_name_key
  ON public.universities (lower(name));

ALTER TABLE public.universities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view universities" ON public.universities;
CREATE POLICY "Authenticated users can view universities" ON public.universities
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Admins can add universities" ON public.universities;
CREATE POLICY "Admins can add universities" ON public.universities
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins can update universities" ON public.universities;
CREATE POLICY "Admins can update universities" ON public.universities
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins can delete universities" ON public.universities;
CREATE POLICY "Admins can delete universities" ON public.universities
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

GRANT SELECT ON public.universities TO authenticated, service_role;
GRANT INSERT, UPDATE, DELETE ON public.universities TO authenticated, service_role;

-- ─── Verified schemes of studies, one row per (university, program, semester) ───
CREATE TABLE IF NOT EXISTS public.university_schemes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  university_id uuid NOT NULL REFERENCES public.universities(id) ON DELETE CASCADE,
  program text NOT NULL CHECK (program IN ('SE', 'CS', 'AI')),
  semester int NOT NULL CHECK (semester BETWEEN 1 AND 8),
  subjects text[] NOT NULL DEFAULT '{}',
  scheme_year text,
  source_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (university_id, program, semester)
);

CREATE INDEX IF NOT EXISTS university_schemes_lookup_idx
  ON public.university_schemes (university_id, program, semester);

ALTER TABLE public.university_schemes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view university schemes" ON public.university_schemes;
CREATE POLICY "Authenticated users can view university schemes" ON public.university_schemes
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Admins can add university schemes" ON public.university_schemes;
CREATE POLICY "Admins can add university schemes" ON public.university_schemes
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins can update university schemes" ON public.university_schemes;
CREATE POLICY "Admins can update university schemes" ON public.university_schemes
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins can delete university schemes" ON public.university_schemes;
CREATE POLICY "Admins can delete university schemes" ON public.university_schemes
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

GRANT SELECT ON public.university_schemes TO authenticated, service_role;
GRANT INSERT, UPDATE, DELETE ON public.university_schemes TO authenticated, service_role;
