-- Class Management Controls (Uzair's order, 26 Nov 2026 ~18:55 PKT):
-- teacher can REMOVE / SUSPEND / UNSUSPEND students and DELETE a class;
-- students can LEAVE a class. Nobody gets stuck, and a suspension can
-- never be dodged by re-joining or by leaving.
--
-- How suspension works: every content policy (posts/comments SELECT +
-- INSERT, submissions INSERT, test start) already goes through
-- is_class_member(), which only accepts status='active'. Making
-- 'suspended' a legal status therefore cuts content access by itself.
-- The gaps this migration closes:
--   * classes SELECT hid the class row entirely -> a suspended student
--     could not even see the class in their list / the notice page.
--   * members DELETE let a suspended student delete their own row and
--     re-join fresh (suspension bypass).
--   * submission UPDATE + private-comment INSERT did not re-check
--     active membership (a suspended student could still write).
--   * join_class_by_code answered 'pending' for a suspended member
--     (misleading) — it now answers 'suspended' and never reactivates.
--   * submit_class_test let an in-flight attempt be submitted after a
--     suspend/remove — it now re-checks active membership.

-- 1) 'suspended' becomes a legal membership status.
ALTER TABLE public.class_members DROP CONSTRAINT class_members_status_check;
ALTER TABLE public.class_members
  ADD CONSTRAINT class_members_status_check
  CHECK (status IN ('active', 'pending', 'suspended'));

-- 2) Helper: suspended membership (class shell + notice only).
CREATE OR REPLACE FUNCTION public.is_suspended_member(_class_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.class_members
    WHERE class_id = _class_id AND user_id = _user_id AND status = 'suspended'
  );
$$;

-- 3) A suspended student can still read the class ROW (list + notice),
--    never its content (content tables keep the active-only check).
DROP POLICY classes_select ON public.classes;
CREATE POLICY classes_select ON public.classes FOR SELECT
USING (
  teacher_id = auth.uid()
  OR is_class_member(id, auth.uid())
  OR is_suspended_member(id, auth.uid())
  OR has_role(auth.uid(), 'admin'::app_role)
);

-- 4) Self-delete (Leave) is blocked while suspended — otherwise Leave +
--    re-join would silently undo a teacher's suspension. Teachers and
--    admins can always delete a membership (Remove).
DROP POLICY members_delete ON public.class_members;
CREATE POLICY members_delete ON public.class_members FOR DELETE
USING (
  (user_id = auth.uid() AND status <> 'suspended')
  OR is_class_teacher(class_id, auth.uid())
  OR has_role(auth.uid(), 'admin'::app_role)
);

-- 5) A suspended student cannot update/resubmit their own submission.
DROP POLICY subs_update_student ON public.assignment_submissions;
CREATE POLICY subs_update_student ON public.assignment_submissions FOR UPDATE
USING (student_id = auth.uid() AND is_class_member(class_id, auth.uid()))
WITH CHECK (student_id = auth.uid() AND is_class_member(class_id, auth.uid()));

-- 6) Private comments: students must be ACTIVE members to write.
--    Teachers are unaffected.
DROP POLICY pvt_insert ON public.submission_private_comments;
CREATE POLICY pvt_insert ON public.submission_private_comments FOR INSERT
WITH CHECK (
  author_id = auth.uid()
  AND (
    (student_id = auth.uid() AND is_class_member(class_id, auth.uid()))
    OR is_class_teacher(class_id, auth.uid())
  )
);

-- 7) join_class_by_code: honest 'suspended' answer, never a reactivation.
CREATE OR REPLACE FUNCTION public.join_class_by_code(_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _class public.classes%ROWTYPE;
  _uid uuid := auth.uid();
  _existing public.class_members%ROWTYPE;
  _status text;
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('status', 'unauthenticated'); END IF;
  SELECT * INTO _class FROM public.classes WHERE upper(code) = upper(trim(_code)) AND NOT archived;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'not_found'); END IF;
  IF _class.teacher_id = _uid THEN
    RETURN jsonb_build_object('status', 'own_class', 'class_id', _class.id);
  END IF;
  SELECT * INTO _existing FROM public.class_members WHERE class_id = _class.id AND user_id = _uid;
  IF FOUND THEN
    RETURN jsonb_build_object('status', CASE
      WHEN _existing.status = 'active' THEN 'already_member'
      WHEN _existing.status = 'suspended' THEN 'suspended'
      ELSE 'pending' END, 'class_id', _class.id, 'title', _class.title);
  END IF;
  _status := CASE WHEN _class.join_requires_approval THEN 'pending' ELSE 'active' END;
  INSERT INTO public.class_members (class_id, user_id, role, status) VALUES (_class.id, _uid, 'student', _status);
  RETURN jsonb_build_object('status', CASE WHEN _status = 'active' THEN 'joined' ELSE 'pending' END, 'class_id', _class.id, 'title', _class.title);
END;
$function$;

-- 8) submit_class_test: an attempt started while active cannot be
--    submitted after a suspend/remove (already-submitted stays readable).
CREATE OR REPLACE FUNCTION public.submit_class_test(_post_id uuid, _answers jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
  IF NOT public.is_class_member(_attempt.class_id, _uid) THEN
    RETURN jsonb_build_object('status', 'not_active_member');
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
$function$;
