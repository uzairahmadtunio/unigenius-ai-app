-- UniGenius Panels Program — Phase 1 foundation (2026-11-26)
-- Classes (Google Classroom model), role-switch audit log, class test RPCs.
-- All class content is member-only via RLS; submissions & private comments
-- are visible only to the owning student and the class teacher.

-- ============ tables ============
CREATE TABLE IF NOT EXISTS public.classes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL,
  title text NOT NULL,
  subject text,
  program text,
  semester integer,
  section text,
  code text UNIQUE NOT NULL,
  join_requires_approval boolean NOT NULL DEFAULT false,
  archived boolean NOT NULL DEFAULT false,
  cover integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.class_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'student' CHECK (role IN ('teacher', 'student')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (class_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.class_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  author_id uuid NOT NULL,
  type text NOT NULL CHECK (type IN ('announcement', 'material', 'homework', 'test')),
  title text,
  body text,
  attachment_url text,
  attachment_name text,
  due_at timestamptz,
  max_marks integer,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.class_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.class_posts(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  author_id uuid NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.assignment_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.class_posts(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  student_id uuid NOT NULL,
  text_answer text,
  file_url text,
  file_name text,
  status text NOT NULL DEFAULT 'turned_in' CHECK (status IN ('turned_in', 'returned')),
  marks numeric,
  feedback text,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  returned_at timestamptz,
  UNIQUE (post_id, student_id)
);

CREATE TABLE IF NOT EXISTS public.submission_private_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.class_posts(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  student_id uuid NOT NULL,
  author_id uuid NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.class_test_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.class_posts(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  student_id uuid NOT NULL,
  question_ids uuid[] NOT NULL DEFAULT '{}',
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  score integer,
  total integer,
  status text NOT NULL DEFAULT 'started' CHECK (status IN ('started', 'submitted')),
  started_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  UNIQUE (post_id, student_id)
);

CREATE TABLE IF NOT EXISTS public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL,
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============ helper functions ============
CREATE OR REPLACE FUNCTION public.is_class_member(_class_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.class_members
    WHERE class_id = _class_id AND user_id = _user_id AND status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_class_teacher(_class_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.classes WHERE id = _class_id AND teacher_id = _user_id)
      OR EXISTS (
        SELECT 1 FROM public.class_members
        WHERE class_id = _class_id AND user_id = _user_id AND role = 'teacher' AND status = 'active'
      );
$$;

CREATE OR REPLACE FUNCTION public.generate_class_code()
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  _alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  _code text;
BEGIN
  LOOP
    _code := '';
    FOR i IN 1..6 LOOP
      _code := _code || substr(_alphabet, 1 + floor(random() * length(_alphabet))::int, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.classes WHERE code = _code);
  END LOOP;
  RETURN _code;
END;
$$;

ALTER TABLE public.classes ALTER COLUMN code SET DEFAULT public.generate_class_code();

-- ============ RLS ============
ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignment_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.submission_private_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_test_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "classes_select" ON public.classes FOR SELECT TO authenticated
  USING (teacher_id = auth.uid() OR public.is_class_member(id, auth.uid()) OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "classes_insert" ON public.classes FOR INSERT TO authenticated
  WITH CHECK (teacher_id = auth.uid() AND (public.has_role(auth.uid(), 'teacher') OR public.has_role(auth.uid(), 'admin')));
CREATE POLICY "classes_update" ON public.classes FOR UPDATE TO authenticated
  USING (teacher_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (teacher_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "classes_delete" ON public.classes FOR DELETE TO authenticated
  USING (teacher_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "members_select" ON public.class_members FOR SELECT TO authenticated
  USING (public.is_class_member(class_id, auth.uid()) OR public.is_class_teacher(class_id, auth.uid()) OR user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "members_update_teacher" ON public.class_members FOR UPDATE TO authenticated
  USING (public.is_class_teacher(class_id, auth.uid()) OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.is_class_teacher(class_id, auth.uid()) OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "members_delete" ON public.class_members FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.is_class_teacher(class_id, auth.uid()) OR public.has_role(auth.uid(), 'admin'));
-- No direct INSERT policy on class_members: joining happens only through join_class_by_code().

CREATE POLICY "posts_select" ON public.class_posts FOR SELECT TO authenticated
  USING (public.is_class_member(class_id, auth.uid()) OR public.is_class_teacher(class_id, auth.uid()) OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "posts_insert" ON public.class_posts FOR INSERT TO authenticated
  WITH CHECK (author_id = auth.uid() AND public.is_class_teacher(class_id, auth.uid()));
CREATE POLICY "posts_update" ON public.class_posts FOR UPDATE TO authenticated
  USING (author_id = auth.uid() OR public.is_class_teacher(class_id, auth.uid()))
  WITH CHECK (author_id = auth.uid() OR public.is_class_teacher(class_id, auth.uid()));
CREATE POLICY "posts_delete" ON public.class_posts FOR DELETE TO authenticated
  USING (author_id = auth.uid() OR public.is_class_teacher(class_id, auth.uid()));

CREATE POLICY "comments_select" ON public.class_comments FOR SELECT TO authenticated
  USING (public.is_class_member(class_id, auth.uid()) OR public.is_class_teacher(class_id, auth.uid()) OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "comments_insert" ON public.class_comments FOR INSERT TO authenticated
  WITH CHECK (author_id = auth.uid() AND (public.is_class_member(class_id, auth.uid()) OR public.is_class_teacher(class_id, auth.uid())));
CREATE POLICY "comments_delete" ON public.class_comments FOR DELETE TO authenticated
  USING (author_id = auth.uid() OR public.is_class_teacher(class_id, auth.uid()));

CREATE POLICY "subs_select" ON public.assignment_submissions FOR SELECT TO authenticated
  USING (student_id = auth.uid() OR public.is_class_teacher(class_id, auth.uid()) OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "subs_insert" ON public.assignment_submissions FOR INSERT TO authenticated
  WITH CHECK (student_id = auth.uid() AND public.is_class_member(class_id, auth.uid()));
CREATE POLICY "subs_update_student" ON public.assignment_submissions FOR UPDATE TO authenticated
  USING (student_id = auth.uid())
  WITH CHECK (student_id = auth.uid());
CREATE POLICY "subs_update_teacher" ON public.assignment_submissions FOR UPDATE TO authenticated
  USING (public.is_class_teacher(class_id, auth.uid()))
  WITH CHECK (public.is_class_teacher(class_id, auth.uid()));

CREATE POLICY "pvt_select" ON public.submission_private_comments FOR SELECT TO authenticated
  USING (student_id = auth.uid() OR public.is_class_teacher(class_id, auth.uid()) OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "pvt_insert" ON public.submission_private_comments FOR INSERT TO authenticated
  WITH CHECK (author_id = auth.uid() AND (student_id = auth.uid() OR public.is_class_teacher(class_id, auth.uid())));

CREATE POLICY "attempts_select" ON public.class_test_attempts FOR SELECT TO authenticated
  USING (student_id = auth.uid() OR public.is_class_teacher(class_id, auth.uid()) OR public.has_role(auth.uid(), 'admin'));
-- No INSERT/UPDATE policies on class_test_attempts: start/submit run as SECURITY DEFINER RPCs.

CREATE POLICY "audit_insert" ON public.audit_log FOR INSERT TO authenticated
  WITH CHECK (actor_id = auth.uid());
CREATE POLICY "audit_select_admin" ON public.audit_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- ============ storage: private bucket for class files ============
INSERT INTO storage.buckets (id, name, public) VALUES ('class-files', 'class-files', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "class_files_select" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'class-files'
    AND (
      public.is_class_member(((storage.foldername(name))[1])::uuid, auth.uid())
      OR public.is_class_teacher(((storage.foldername(name))[1])::uuid, auth.uid())
      OR public.has_role(auth.uid(), 'admin')
    )
  );
CREATE POLICY "class_files_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'class-files'
    AND (
      ((storage.foldername(name))[2] = 'materials' AND public.is_class_teacher(((storage.foldername(name))[1])::uuid, auth.uid()))
      OR ((storage.foldername(name))[2] = 'submissions' AND (storage.foldername(name))[3] = auth.uid()::text AND public.is_class_member(((storage.foldername(name))[1])::uuid, auth.uid()))
    )
  );
CREATE POLICY "class_files_update" ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'class-files'
    AND (storage.foldername(name))[2] = 'submissions'
    AND (storage.foldername(name))[3] = auth.uid()::text
  );
CREATE POLICY "class_files_delete" ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'class-files'
    AND (
      public.is_class_teacher(((storage.foldername(name))[1])::uuid, auth.uid())
      OR ((storage.foldername(name))[2] = 'submissions' AND (storage.foldername(name))[3] = auth.uid()::text)
    )
  );

-- ============ RPC: join a class by code ============
CREATE OR REPLACE FUNCTION public.join_class_by_code(_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
    RETURN jsonb_build_object('status', CASE WHEN _existing.status = 'active' THEN 'already_member' ELSE 'pending' END, 'class_id', _class.id, 'title', _class.title);
  END IF;
  _status := CASE WHEN _class.join_requires_approval THEN 'pending' ELSE 'active' END;
  INSERT INTO public.class_members (class_id, user_id, role, status) VALUES (_class.id, _uid, 'student', _status);
  RETURN jsonb_build_object('status', CASE WHEN _status = 'active' THEN 'joined' ELSE 'pending' END, 'class_id', _class.id, 'title', _class.title);
END;
$$;

-- ============ RPC: start a class test (answers never leave the server) ============
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
    _count := COALESCE((_post.meta->>'question_count')::int, 10);
    SELECT array_agg(id) INTO _ids FROM (
      SELECT id FROM public.question_bank
      WHERE subject = _subject AND (_topic IS NULL OR topic = _topic)
      ORDER BY random() LIMIT _count
    ) s;
    -- Fall back to the whole subject when the topic has too few questions.
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

-- ============ RPC: submit a class test (scored server-side) ============
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

  -- Mirror into the student's own quiz history so Progress/Practice see it.
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

  RETURN jsonb_build_object('status', 'submitted', 'score', _score, 'total', _attempt.total, 'marks', _marks);
END;
$$;
