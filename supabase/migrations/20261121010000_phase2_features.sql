-- Phase 2 (2026-11-21): subjective/mixed quizzes, per-answer details,
-- personal text notes. Additive only — no destructive changes.

-- 1. Per-answer detail for quiz attempts (questions, student answers,
--    scores, AI feedback) stored alongside the summary row.
ALTER TABLE public.quiz_results
  ADD COLUMN IF NOT EXISTS details jsonb;

-- 2. Allow the new Practice Mode quiz types. NOTE: inserts are also
--    gated by the validate_quiz_result() trigger function, whose
--    hard-coded list was even narrower than the CHECK (only
--    'practice','daily','past_paper','flashcard') — both are widened to
--    the same union here. The trigger's total (1..50) and score
--    (0..total) rules are unchanged; Phase-2 totals fit them
--    (subjective 5x5=25, mixed 10+3x5=25, objective 30).
ALTER TABLE public.quiz_results
  DROP CONSTRAINT IF EXISTS quiz_results_quiz_type_check;
ALTER TABLE public.quiz_results
  ADD CONSTRAINT quiz_results_quiz_type_check
  CHECK (quiz_type = ANY (ARRAY['daily','weekly','midterm','final','practice','past_paper','flashcard','subjective','mixed']));

CREATE OR REPLACE FUNCTION public.validate_quiz_result()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.total IS NULL OR NEW.total <= 0 OR NEW.total > 50 THEN
    RAISE EXCEPTION 'Invalid total: % (must be 1..50)', NEW.total;
  END IF;
  IF NEW.score IS NULL OR NEW.score < 0 OR NEW.score > NEW.total THEN
    RAISE EXCEPTION 'Invalid score: % (must be 0..total)', NEW.score;
  END IF;
  IF NEW.quiz_type IS NULL OR NEW.quiz_type NOT IN ('practice','daily','weekly','midterm','final','past_paper','flashcard','subjective','mixed') THEN
    RAISE EXCEPTION 'Invalid quiz_type: %', NEW.quiz_type;
  END IF;
  RETURN NEW;
END;
$function$;

-- 3. Personal text notes (owner-only), separate from the shared
--    file marketplace in public.notes.
CREATE TABLE IF NOT EXISTS public.user_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'Untitled note',
  content text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_notes_user_created_idx
  ON public.user_notes (user_id, created_at DESC);

ALTER TABLE public.user_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own text notes" ON public.user_notes;
CREATE POLICY "Users can view own text notes" ON public.user_notes
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create own text notes" ON public.user_notes;
CREATE POLICY "Users can create own text notes" ON public.user_notes
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own text notes" ON public.user_notes;
CREATE POLICY "Users can update own text notes" ON public.user_notes
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own text notes" ON public.user_notes;
CREATE POLICY "Users can delete own text notes" ON public.user_notes
  FOR DELETE USING (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_notes TO authenticated, service_role;
