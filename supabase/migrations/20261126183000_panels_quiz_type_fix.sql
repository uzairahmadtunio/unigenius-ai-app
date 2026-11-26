-- Panels Program fix (found by API E2E, 2026-11-26): quiz_results only
-- allows a fixed quiz_type list, so the class-test mirror insert made
-- submit_class_test roll back entirely. Allow 'class-test' in both the
-- CHECK constraint and the validate_quiz_result() trigger, cap class
-- test size at the trigger's total<=50 rule, and make the mirror insert
-- non-fatal: the attempt row is the source of truth for class results,
-- a history-mirror failure must never eat a student's submission.

ALTER TABLE public.quiz_results DROP CONSTRAINT IF EXISTS quiz_results_quiz_type_check;
ALTER TABLE public.quiz_results ADD CONSTRAINT quiz_results_quiz_type_check
  CHECK (quiz_type = ANY (ARRAY['daily','weekly','midterm','final','practice','past_paper','flashcard','subjective','mixed','class-test']));

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
  IF NEW.quiz_type IS NULL OR NEW.quiz_type NOT IN ('practice','daily','weekly','midterm','final','past_paper','flashcard','subjective','mixed','class-test') THEN
    RAISE EXCEPTION 'Invalid quiz_type: %', NEW.quiz_type;
  END IF;
  RETURN NEW;
END;
$function$;

-- start_class_test: never pick more than 50 questions (mirror limit).
CREATE OR REPLACE FUNCTION public.start_class_test(_post_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _post public.class_posts%ROWTYPE;
  _attempt public.class_test_attempts%ROWTYPE;
  _subject text;
  _topic text;
  _count int;
  _ids uuid[];
  _questions jsonb;
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('status', 'unauthenticated'); END IF;
  SELECT * INTO _post FROM public.class_posts WHERE id = _post_id AND type = 'test';
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'not_found'); END IF;
  IF NOT (public.is_class_member(_post.class_id, _uid) OR public.is_class_teacher(_post.class_id, _uid)) THEN
    RETURN jsonb_build_object('status', 'not_member');
  END IF;

  SELECT * INTO _attempt FROM public.class_test_attempts WHERE post_id = _post_id AND student_id = _uid;
  IF FOUND AND _attempt.status = 'submitted' THEN
    RETURN jsonb_build_object('status', 'submitted', 'score', _attempt.score, 'total', _attempt.total);
  END IF;

  IF NOT FOUND THEN
    _subject := _post.meta->>'subject';
    _topic := NULLIF(_post.meta->>'topic', '');
    _count := LEAST(COALESCE((_post.meta->>'question_count')::int, 10), 50);
    SELECT array_agg(id) INTO _ids FROM (
      SELECT id FROM public.question_bank
      WHERE subject = _subject AND (_topic IS NULL OR topic = _topic)
      ORDER BY random() LIMIT _count
    ) s;
    IF _ids IS NULL OR array_length(_ids, 1) < LEAST(_count, 3) THEN
      SELECT array_agg(id) INTO _ids FROM (
        SELECT id FROM public.question_bank WHERE subject = _subject ORDER BY random() LIMIT _count
      ) s;
    END IF;
    IF _ids IS NULL THEN RETURN jsonb_build_object('status', 'no_questions'); END IF;
    INSERT INTO public.class_test_attempts (post_id, class_id, student_id, question_ids, total)
    VALUES (_post_id, _post.class_id, _uid, _ids, array_length(_ids, 1))
    RETURNING * INTO _attempt;
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'id', q.id, 'question', q.question,
    'option_a', q.option_a, 'option_b', q.option_b, 'option_c', q.option_c, 'option_d', q.option_d,
    'topic', q.topic
  ) ORDER BY array_position(_attempt.question_ids, q.id))
  INTO _questions
  FROM public.question_bank q WHERE q.id = ANY(_attempt.question_ids);

  RETURN jsonb_build_object('status', 'started', 'attempt_id', _attempt.id, 'questions', COALESCE(_questions, '[]'::jsonb), 'total', _attempt.total);
END;
$$;

-- submit_class_test: identical scoring, but the quiz_results mirror is
-- best-effort (EXCEPTION guard) so it can never roll back a submission.
CREATE OR REPLACE FUNCTION public.submit_class_test(_post_id uuid, _answers jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _attempt public.class_test_attempts%ROWTYPE;
  _post public.class_posts%ROWTYPE;
  _class public.classes%ROWTYPE;
  _score int := 0;
  _per int;
  _marks int;
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('status', 'unauthenticated'); END IF;
  SELECT * INTO _attempt FROM public.class_test_attempts WHERE post_id = _post_id AND student_id = _uid;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'not_started'); END IF;
  IF _attempt.status = 'submitted' THEN
    RETURN jsonb_build_object('status', 'submitted', 'score', _attempt.score, 'total', _attempt.total);
  END IF;

  SELECT count(*) INTO _score
  FROM public.question_bank q
  WHERE q.id = ANY(_attempt.question_ids)
    AND upper(q.correct_answer) = upper(COALESCE(_answers->>(q.id::text), ''));

  SELECT * INTO _post FROM public.class_posts WHERE id = _post_id;
  SELECT * INTO _class FROM public.classes WHERE id = _attempt.class_id;
  _per := COALESCE((_post.meta->>'marks_per_question')::int, 1);
  _marks := _score * _per;

  UPDATE public.class_test_attempts
  SET answers = _answers, score = _score, status = 'submitted', submitted_at = now()
  WHERE id = _attempt.id;

  BEGIN
    INSERT INTO public.quiz_results (user_id, subject, semester, score, total, quiz_type, details)
    VALUES (
      _uid,
      COALESCE(_post.meta->>'subject', _class.subject, 'Class Test'),
      _class.semester,
      _score,
      _attempt.total,
      'class-test',
      jsonb_build_object('class_id', _class.id, 'post_id', _post_id, 'class_title', _class.title, 'marks', _marks)
    );
  EXCEPTION WHEN OTHERS THEN
    -- Mirror is a convenience for Progress/Practice; never fail the submit.
    NULL;
  END;

  RETURN jsonb_build_object('status', 'submitted', 'score', _score, 'total', _attempt.total, 'marks', _marks);
END;
$$;
