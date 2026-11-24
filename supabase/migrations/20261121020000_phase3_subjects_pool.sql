-- Phase 3: Courses pool + per-student subject lists (Sir's suggestion).
-- Every university's scheme differs, so instead of forcing the hardcoded
-- SE/CS/AI lists on everyone, students can build their own semester-wise
-- subject list from a shared pool (plus fully custom subjects).
-- Additive only: two new tables, no changes to existing ones.

-- ─── Shared pool of known subjects ───
CREATE TABLE IF NOT EXISTS public.subjects_pool (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  code text,
  departments text[] NOT NULL DEFAULT '{}',
  suggested_semester int,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS subjects_pool_lower_name_key
  ON public.subjects_pool (lower(name));

ALTER TABLE public.subjects_pool ENABLE ROW LEVEL SECURITY;

-- Readable by every signed-in student; writes are admin-only
-- (the per-student custom path writes to user_subjects, never here).
DROP POLICY IF EXISTS "Authenticated users can view subjects pool" ON public.subjects_pool;
CREATE POLICY "Authenticated users can view subjects pool" ON public.subjects_pool
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Admins can add pool subjects" ON public.subjects_pool;
CREATE POLICY "Admins can add pool subjects" ON public.subjects_pool
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins can update pool subjects" ON public.subjects_pool;
CREATE POLICY "Admins can update pool subjects" ON public.subjects_pool
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins can delete pool subjects" ON public.subjects_pool;
CREATE POLICY "Admins can delete pool subjects" ON public.subjects_pool
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

GRANT SELECT ON public.subjects_pool TO authenticated, service_role;
GRANT INSERT, UPDATE, DELETE ON public.subjects_pool TO authenticated, service_role;

-- ─── Per-student subject lists ───
-- A row set exists per (user, semester) only once the student customises
-- that semester; no rows = the app falls back to the hardcoded defaults.
CREATE TABLE IF NOT EXISTS public.user_subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  pool_id uuid REFERENCES public.subjects_pool(id) ON DELETE SET NULL,
  semester int NOT NULL CHECK (semester BETWEEN 1 AND 8),
  department text NOT NULL,
  custom boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS user_subjects_user_semester_name_key
  ON public.user_subjects (user_id, semester, lower(name));

CREATE INDEX IF NOT EXISTS user_subjects_user_semester_idx
  ON public.user_subjects (user_id, semester, created_at);

ALTER TABLE public.user_subjects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own subjects" ON public.user_subjects;
CREATE POLICY "Users can view own subjects" ON public.user_subjects
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can add own subjects" ON public.user_subjects;
CREATE POLICY "Users can add own subjects" ON public.user_subjects
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own subjects" ON public.user_subjects;
CREATE POLICY "Users can update own subjects" ON public.user_subjects
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own subjects" ON public.user_subjects;
CREATE POLICY "Users can delete own subjects" ON public.user_subjects
  FOR DELETE USING (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_subjects TO authenticated, service_role;

-- ─── Seed the pool from the hardcoded curriculum (src/data/subjects.ts) ───
-- departments = every department whose scheme contains the subject;
-- suggested_semester = earliest semester it appears in.
INSERT INTO public.subjects_pool (name, departments, suggested_semester) VALUES
  ('AI Ethics', ARRAY['ai']::text[], 7),
  ('Analysis of Algorithms', ARRAY['se']::text[], 5),
  ('Applied Physics', ARRAY['se','cs','ai']::text[], 1),
  ('Artificial Intelligence', ARRAY['se','cs']::text[], 5),
  ('Artificial Neural Networks', ARRAY['ai']::text[], 4),
  ('Calculus', ARRAY['se','cs','ai']::text[], 1),
  ('Calculus III', ARRAY['ai']::text[], 3),
  ('Cloud Computing', ARRAY['se']::text[], 7),
  ('Communication Skills', ARRAY['se','cs','ai']::text[], 2),
  ('Compiler Construction', ARRAY['cs']::text[], 5),
  ('Computer Networks', ARRAY['se','cs','ai']::text[], 5),
  ('Computer Organization & Assembly', ARRAY['se','cs']::text[], 3),
  ('Computer Vision', ARRAY['ai']::text[], 6),
  ('CS Elective', ARRAY['cs']::text[], 6),
  ('Data Science', ARRAY['cs','ai']::text[], 5),
  ('Data Structures & Algorithms (DSA)', ARRAY['se','cs','ai']::text[], 3),
  ('Database Systems', ARRAY['se','cs','ai']::text[], 4),
  ('Deep Learning', ARRAY['ai']::text[], 6),
  ('Design & Analysis of Algorithms', ARRAY['cs']::text[], 5),
  ('Digital Logic Design', ARRAY['cs']::text[], 3),
  ('Digital Logic Design (DLD)', ARRAY['se','cs','ai']::text[], 2),
  ('Discrete Structures', ARRAY['se','cs','ai']::text[], 1),
  ('English Composition', ARRAY['se','cs','ai']::text[], 1),
  ('Entrepreneurship', ARRAY['se']::text[], 8),
  ('Final Year Project (FYP-I)', ARRAY['se','cs','ai']::text[], 7),
  ('Final Year Project (FYP-II)', ARRAY['se','cs','ai']::text[], 8),
  ('Fuzzy Systems', ARRAY['ai']::text[], 8),
  ('Human Computer Interaction (HCI)', ARRAY['se']::text[], 3),
  ('ICT', ARRAY['se','cs','ai']::text[], 1),
  ('Information Security', ARRAY['se','cs']::text[], 6),
  ('Internship', ARRAY['se']::text[], 8),
  ('Introduction to AI', ARRAY['ai']::text[], 3),
  ('Islamic Studies', ARRAY['se','cs','ai']::text[], 1),
  ('Knowledge Representation & Reasoning', ARRAY['ai']::text[], 6),
  ('Linear Algebra', ARRAY['se','cs','ai']::text[], 3),
  ('Machine Learning', ARRAY['cs','ai']::text[], 5),
  ('Multivariable Calculus', ARRAY['se','cs','ai']::text[], 2),
  ('Natural Language Processing (NLP)', ARRAY['ai']::text[], 5),
  ('Object-Oriented Programming (OOP)', ARRAY['se','cs','ai']::text[], 2),
  ('Operating Systems', ARRAY['se','cs','ai']::text[], 4),
  ('Pakistan Studies', ARRAY['se','cs','ai']::text[], 2),
  ('Parallel & Distributed Computing', ARRAY['cs']::text[], 6),
  ('Probability & Statistics', ARRAY['se']::text[], 4),
  ('Professional Practices', ARRAY['se','cs']::text[], 6),
  ('Programming for AI (Python)', ARRAY['ai']::text[], 4),
  ('Programming Fundamentals', ARRAY['se','cs','ai']::text[], 1),
  ('Reinforcement Learning', ARRAY['ai']::text[], 7),
  ('Robotics', ARRAY['ai']::text[], 7),
  ('SE Elective-II', ARRAY['se']::text[], 7),
  ('SE Elective-III', ARRAY['se']::text[], 8),
  ('Software Construction & Development', ARRAY['se']::text[], 5),
  ('Software Design & Architecture', ARRAY['se']::text[], 4),
  ('Software Project Management (SPM)', ARRAY['se']::text[], 6),
  ('Software Quality Engineering', ARRAY['se']::text[], 5),
  ('Software Re-Engineering', ARRAY['se']::text[], 7),
  ('Software Requirement Engineering', ARRAY['se']::text[], 3),
  ('Statistics & Probability', ARRAY['cs','ai']::text[], 3),
  ('Technical Elective-I', ARRAY['se']::text[], 6),
  ('Technical Writing', ARRAY['se']::text[], 4),
  ('Theory of Automata', ARRAY['cs']::text[], 4),
  ('Web Engineering', ARRAY['se','cs']::text[], 6)
ON CONFLICT (lower(name)) DO NOTHING;
