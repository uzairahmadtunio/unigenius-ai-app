-- Study plans get a user-chosen name (Uzair, 2026-11-27): plans were
-- listed only as "Semester X • N subjects", with no way for a student
-- to name their own plan. Nullable — old plans keep working unnamed.
ALTER TABLE public.study_plans ADD COLUMN IF NOT EXISTS title text;
