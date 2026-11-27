-- UniGenius Phase 4 — Admin Panel Core (2026-11-27)
-- Spec Part B2 (core) + B3 (Phase 2 items): Live Dashboard, User Management
-- depth + User 360, Payments totals + Revenue, Content Moderation,
-- System Health, Audit Log support, Feature Switches, Maintenance Mode,
-- Growth graphs, Feedback reply, CSV export support.
-- Everything admin-facing goes through SECURITY DEFINER RPCs that check
-- has_role(auth.uid(), 'admin'); no admin data is exposed by table RLS
-- beyond what already existed.

-- ============ 1. app_settings (feature switches + maintenance mode) ============
CREATE TABLE IF NOT EXISTS public.app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_settings_select_all ON public.app_settings;
CREATE POLICY app_settings_select_all ON public.app_settings
  FOR SELECT USING (true);
DROP POLICY IF EXISTS app_settings_admin_write ON public.app_settings;
CREATE POLICY app_settings_admin_write ON public.app_settings
  FOR ALL USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

INSERT INTO public.app_settings (key, value) VALUES
  ('maintenance', '{"enabled": false, "message": "UniGenius is getting a quick upgrade. We will be back shortly."}'::jsonb),
  ('features', '{"ai_tutor": true, "code_lab": true, "downloads": true, "groups": true, "flashcards": true, "viva": true, "presentations": true}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ============ 2. profiles: plan + suspend ============
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'free';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS suspended boolean NOT NULL DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS suspended_at timestamptz;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_plan_check') THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_plan_check
      CHECK (plan IN ('free', 'pro', 'lifetime'));
  END IF;
END $$;
-- Backfill: lifetime = the 2099 safeguard pattern; pro = is_pro.
UPDATE public.profiles SET plan = CASE
  WHEN streak_pro_until IS NOT NULL AND streak_pro_until > now() + interval '10 years' THEN 'lifetime'
  WHEN is_pro THEN 'pro'
  ELSE 'free'
END;

-- ============ 3. content moderation ============
ALTER TABLE public.notes ADD COLUMN IF NOT EXISTS moderation_status text NOT NULL DEFAULT 'approved';
ALTER TABLE public.study_materials ADD COLUMN IF NOT EXISTS moderation_status text NOT NULL DEFAULT 'approved';
ALTER TABLE public.past_papers ADD COLUMN IF NOT EXISTS moderation_status text NOT NULL DEFAULT 'approved';
-- New uploads wait for approval; existing rows were backfilled 'approved' above.
ALTER TABLE public.notes ALTER COLUMN moderation_status SET DEFAULT 'pending';
ALTER TABLE public.study_materials ALTER COLUMN moderation_status SET DEFAULT 'pending';
ALTER TABLE public.past_papers ALTER COLUMN moderation_status SET DEFAULT 'pending';

DROP POLICY IF EXISTS "Anyone can view notes" ON public.notes;
DROP POLICY IF EXISTS "View approved own or admin notes" ON public.notes;
CREATE POLICY "View approved own or admin notes" ON public.notes
  FOR SELECT USING (
    moderation_status = 'approved'
    OR auth.uid() = user_id
    OR public.has_role(auth.uid(), 'admin'::app_role)
  );

DROP POLICY IF EXISTS "Anyone authenticated can view materials" ON public.study_materials;
DROP POLICY IF EXISTS "View approved own or admin materials" ON public.study_materials;
CREATE POLICY "View approved own or admin materials" ON public.study_materials
  FOR SELECT USING (
    moderation_status = 'approved'
    OR auth.uid() = uploaded_by
    OR public.has_role(auth.uid(), 'admin'::app_role)
  );

DROP POLICY IF EXISTS "Anyone can view past papers" ON public.past_papers;
DROP POLICY IF EXISTS "View approved own or admin papers" ON public.past_papers;
CREATE POLICY "View approved own or admin papers" ON public.past_papers
  FOR SELECT USING (
    moderation_status = 'approved'
    OR auth.uid() = user_id
    OR public.has_role(auth.uid(), 'admin'::app_role)
  );

-- ============ 4. feedback reply columns ============
ALTER TABLE public.feedbacks ADD COLUMN IF NOT EXISTS admin_reply text;
ALTER TABLE public.feedbacks ADD COLUMN IF NOT EXISTS replied_at timestamptz;
ALTER TABLE public.feedbacks ADD COLUMN IF NOT EXISTS replied_by uuid;

-- ============ 5. Live Dashboard ============
CREATE OR REPLACE FUNCTION public.admin_live_dashboard()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  RETURN jsonb_build_object(
    'total_users', (SELECT count(*) FROM auth.users),
    'teachers', (SELECT count(DISTINCT user_id) FROM public.user_roles WHERE role = 'teacher'),
    'admins', (SELECT count(DISTINCT user_id) FROM public.user_roles WHERE role = 'admin'),
    'pro_users', (SELECT count(*) FROM public.profiles WHERE plan IN ('pro', 'lifetime')),
    'lifetime_users', (SELECT count(*) FROM public.profiles WHERE plan = 'lifetime'),
    'suspended_users', (SELECT count(*) FROM public.profiles WHERE suspended),
    'signups_today', (SELECT count(*) FROM auth.users WHERE created_at >= date_trunc('day', now())),
    'signups_7d', (SELECT count(*) FROM auth.users WHERE created_at >= now() - interval '7 days'),
    'ai_calls_today', (SELECT count(*) FROM public.ai_usage_events WHERE created_at >= date_trunc('day', now())),
    'ai_failures_today', (SELECT count(*) FROM public.ai_usage_events WHERE created_at >= date_trunc('day', now()) AND NOT success),
    'quizzes_today', (SELECT count(*) FROM public.quiz_results WHERE created_at >= date_trunc('day', now())),
    'pending_payments', (SELECT count(*) FROM public.payment_requests WHERE status = 'pending'),
    'pending_moderation',
      (SELECT count(*) FROM public.notes WHERE moderation_status = 'pending')
      + (SELECT count(*) FROM public.study_materials WHERE moderation_status = 'pending')
      + (SELECT count(*) FROM public.past_papers WHERE moderation_status = 'pending'),
    'new_feedback', (SELECT count(*) FROM public.feedbacks WHERE status = 'new'),
    'open_support', (SELECT count(*) FROM public.support_tickets WHERE status = 'open'),
    'classes_total', (SELECT count(*) FROM public.classes),
    'generated_at', now()
  );
END;
$$;

-- ============ 6. Full user list (plan / joined / last active / roles) ============
CREATE OR REPLACE FUNCTION public.admin_list_users_full()
RETURNS TABLE(
  user_id uuid, email text, display_name text, avatar_url text,
  roll_number text, current_semester integer, department text,
  plan text, is_pro boolean, suspended boolean,
  joined_at timestamptz, last_active_at timestamptz, roles text[]
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  RETURN QUERY
  SELECT
    u.id,
    u.email::text,
    p.display_name,
    p.avatar_url,
    p.roll_number,
    p.current_semester,
    p.department,
    COALESCE(p.plan, 'free'),
    COALESCE(p.is_pro, false),
    COALESCE(p.suspended, false),
    u.created_at,
    GREATEST(
      p.updated_at,
      (SELECT max(q.created_at) FROM public.quiz_results q WHERE q.user_id = u.id),
      (SELECT max(a.created_at) FROM public.ai_usage_events a WHERE a.user_id = u.id),
      (SELECT (max(s.last_active_date)::timestamptz) FROM public.daily_streaks s WHERE s.user_id = u.id)
    ),
    COALESCE((SELECT array_agg(r.role::text ORDER BY r.role::text) FROM public.user_roles r WHERE r.user_id = u.id), ARRAY[]::text[])
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.user_id = u.id
  ORDER BY u.created_at DESC;
END;
$$;

-- ============ 7. User 360 ============
CREATE OR REPLACE FUNCTION public.admin_get_user_360(_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _profile jsonb;
  _subjects jsonb;
  _quiz jsonb;
  _weak jsonb;
  _purchases jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT to_jsonb(x) INTO _profile FROM (
    SELECT p.user_id, p.display_name, p.avatar_url, p.roll_number, p.section,
           p.university, p.department, p.current_semester, p.headline,
           p.plan, p.is_pro, p.suspended, p.suspended_at, p.created_at AS profile_created_at,
           u.email, u.created_at AS joined_at,
           COALESCE((SELECT array_agg(r.role::text ORDER BY r.role::text) FROM public.user_roles r WHERE r.user_id = p.user_id), ARRAY[]::text[]) AS roles
    FROM public.profiles p
    JOIN auth.users u ON u.id = p.user_id
    WHERE p.user_id = _user_id
  ) x;

  IF _profile IS NULL THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT COALESCE(jsonb_agg(name ORDER BY name), '[]'::jsonb) INTO _subjects
  FROM public.user_subjects WHERE user_id = _user_id;

  SELECT jsonb_build_object(
    'attempts', count(*),
    'avg_pct', CASE WHEN count(*) = 0 THEN 0 ELSE round(avg(100.0 * score / NULLIF(total, 0))) END,
    'last_attempt_at', max(created_at)
  ) INTO _quiz FROM public.quiz_results WHERE user_id = _user_id;

  SELECT COALESCE(jsonb_agg(x ORDER BY x.avg_pct ASC), '[]'::jsonb) INTO _weak FROM (
    SELECT subject, count(*) AS attempts, round(avg(100.0 * score / NULLIF(total, 0))) AS avg_pct
    FROM public.quiz_results WHERE user_id = _user_id
    GROUP BY subject ORDER BY avg(100.0 * score / NULLIF(total, 0)) ASC LIMIT 3
  ) x;

  SELECT COALESCE(jsonb_agg(x ORDER BY x.created_at DESC), '[]'::jsonb) INTO _purchases FROM (
    SELECT id, plan, amount, status, payment_method, created_at, reviewed_at
    FROM public.payment_requests WHERE user_id = _user_id ORDER BY created_at DESC LIMIT 20
  ) x;

  RETURN jsonb_build_object(
    'found', true,
    'profile', _profile,
    'subjects', _subjects,
    'quiz', _quiz,
    'weak_subjects', _weak,
    'notes_uploaded', (SELECT count(*) FROM public.notes WHERE user_id = _user_id),
    'materials_uploaded', (SELECT count(*) FROM public.study_materials WHERE uploaded_by = _user_id),
    'classes_joined', (SELECT count(*) FROM public.class_members WHERE user_id = _user_id AND status = 'active'),
    'badges', (SELECT count(*) FROM public.user_badges WHERE user_id = _user_id),
    'feedback_count', (SELECT count(*) FROM public.feedbacks WHERE user_id = _user_id),
    'purchases', _purchases
  );
END;
$$;

-- ============ 8. Suspend / restore (real login ban via auth.users) ============
CREATE OR REPLACE FUNCTION public.admin_set_user_suspended(_target_user_id uuid, _suspended boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF _target_user_id = auth.uid() THEN
    RAISE EXCEPTION 'You cannot suspend your own account';
  END IF;
  IF public.has_role(_target_user_id, 'admin') THEN
    RAISE EXCEPTION 'Admin accounts cannot be suspended';
  END IF;

  UPDATE public.profiles
  SET suspended = _suspended,
      suspended_at = CASE WHEN _suspended THEN now() ELSE NULL END
  WHERE user_id = _target_user_id;

  UPDATE auth.users
  SET banned_until = CASE WHEN _suspended THEN now() + interval '100 years' ELSE NULL END
  WHERE id = _target_user_id;

  INSERT INTO public.audit_log (actor_id, action, details)
  VALUES (auth.uid(),
          CASE WHEN _suspended THEN 'user_suspended' ELSE 'user_restored' END,
          jsonb_build_object('target_user_id', _target_user_id));
END;
$$;

-- ============ 9. Plan change ============
CREATE OR REPLACE FUNCTION public.admin_set_user_plan(_target_user_id uuid, _plan text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF _plan NOT IN ('free', 'pro', 'lifetime') THEN
    RAISE EXCEPTION 'Invalid plan';
  END IF;
  UPDATE public.profiles
  SET plan = _plan, is_pro = (_plan <> 'free')
  WHERE user_id = _target_user_id;
  INSERT INTO public.audit_log (actor_id, action, details)
  VALUES (auth.uid(), 'user_plan_changed',
          jsonb_build_object('target_user_id', _target_user_id, 'plan', _plan));
END;
$$;

-- ============ 10. Content moderation actions ============
CREATE OR REPLACE FUNCTION public.admin_moderate_content(_kind text, _id uuid, _decision text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF _decision NOT IN ('approved', 'rejected', 'removed') THEN
    RAISE EXCEPTION 'Invalid decision';
  END IF;

  IF _kind = 'note' THEN
    IF _decision = 'removed' THEN DELETE FROM public.notes WHERE id = _id;
    ELSE UPDATE public.notes SET moderation_status = _decision WHERE id = _id; END IF;
  ELSIF _kind = 'material' THEN
    IF _decision = 'removed' THEN DELETE FROM public.study_materials WHERE id = _id;
    ELSE UPDATE public.study_materials SET moderation_status = _decision WHERE id = _id; END IF;
  ELSIF _kind = 'paper' THEN
    IF _decision = 'removed' THEN DELETE FROM public.past_papers WHERE id = _id;
    ELSE UPDATE public.past_papers SET moderation_status = _decision WHERE id = _id; END IF;
  ELSE
    RAISE EXCEPTION 'Invalid content kind';
  END IF;

  INSERT INTO public.audit_log (actor_id, action, details)
  VALUES (auth.uid(), 'content_moderated',
          jsonb_build_object('kind', _kind, 'content_id', _id, 'decision', _decision));
END;
$$;

-- Moderation queue read (pending first, then everything recent)
CREATE OR REPLACE FUNCTION public.admin_moderation_queue()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _items jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  SELECT COALESCE(jsonb_agg(x ORDER BY x.sort_pending DESC, x.created_at DESC), '[]'::jsonb) INTO _items FROM (
    SELECT 'note' AS kind, n.id, n.title, n.subject, n.semester, n.file_url, n.file_name,
           n.moderation_status, n.created_at, n.uploader_name AS uploader,
           (n.moderation_status = 'pending')::int AS sort_pending
    FROM public.notes n
    UNION ALL
    SELECT 'material', m.id, m.title, m.subject, m.semester, m.file_url, m.file_name,
           m.moderation_status, m.created_at,
           (SELECT p.display_name FROM public.profiles p WHERE p.user_id = m.uploaded_by),
           (m.moderation_status = 'pending')::int
    FROM public.study_materials m
    UNION ALL
    SELECT 'paper', pp.id, pp.title, pp.subject, pp.semester, pp.file_url, pp.file_name,
           pp.moderation_status, pp.created_at,
           (SELECT p.display_name FROM public.profiles p WHERE p.user_id = pp.user_id),
           (pp.moderation_status = 'pending')::int
    FROM public.past_papers pp
    LIMIT 200
  ) x;
  RETURN _items;
END;
$$;

-- ============ 11. System Health ============
CREATE OR REPLACE FUNCTION public.admin_system_health()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'private'
AS $$
DECLARE
  _ai24 jsonb; _ai7 jsonb; _pool jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT jsonb_build_object(
    'calls', count(*),
    'failures', count(*) FILTER (WHERE NOT success),
    'error_rate', CASE WHEN count(*) = 0 THEN 0 ELSE round(100.0 * count(*) FILTER (WHERE NOT success) / count(*), 1) END
  ) INTO _ai24 FROM public.ai_usage_events WHERE created_at >= now() - interval '24 hours';

  SELECT jsonb_build_object(
    'calls', count(*),
    'failures', count(*) FILTER (WHERE NOT success),
    'error_rate', CASE WHEN count(*) = 0 THEN 0 ELSE round(100.0 * count(*) FILTER (WHERE NOT success) / count(*), 1) END
  ) INTO _ai7 FROM public.ai_usage_events WHERE created_at >= now() - interval '7 days';

  SELECT jsonb_build_object(
    'total', count(*),
    'active', count(*) FILTER (WHERE enabled AND status <> 'invalid' AND NOT (status = 'cooldown' AND cooldown_until > now())),
    'cooling', count(*) FILTER (WHERE enabled AND status = 'cooldown' AND cooldown_until > now()),
    'disabled', count(*) FILTER (WHERE NOT enabled OR status = 'invalid')
  ) INTO _pool FROM private.api_keys;

  RETURN jsonb_build_object(
    'db_size_bytes', pg_database_size(current_database()),
    'storage_bytes', (SELECT COALESCE(sum((metadata->>'size')::bigint), 0) FROM storage.objects),
    'storage_objects', (SELECT count(*) FROM storage.objects),
    'ai_24h', _ai24,
    'ai_7d', _ai7,
    'key_pool', _pool,
    'users', (SELECT count(*) FROM auth.users),
    'questions', (SELECT count(*) FROM public.question_bank),
    'last_backup_at', NULL,
    'generated_at', now()
  );
END;
$$;

-- ============ 12. Growth stats ============
CREATE OR REPLACE FUNCTION public.admin_growth_stats(_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _signups jsonb; _quizzes jsonb; _ai jsonb; _subjects jsonb; _features jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF _days < 7 THEN _days := 7; END IF;
  IF _days > 90 THEN _days := 90; END IF;

  SELECT COALESCE(jsonb_agg(x ORDER BY x.day), '[]'::jsonb) INTO _signups FROM (
    SELECT d::date AS day, (SELECT count(*) FROM auth.users u WHERE u.created_at::date = d::date) AS count
    FROM generate_series(date_trunc('day', now()) - ((_days - 1) || ' days')::interval, date_trunc('day', now()), interval '1 day') d
  ) x;

  SELECT COALESCE(jsonb_agg(x ORDER BY x.day), '[]'::jsonb) INTO _quizzes FROM (
    SELECT d::date AS day, (SELECT count(*) FROM public.quiz_results q WHERE q.created_at::date = d::date) AS count
    FROM generate_series(date_trunc('day', now()) - ((_days - 1) || ' days')::interval, date_trunc('day', now()), interval '1 day') d
  ) x;

  SELECT COALESCE(jsonb_agg(x ORDER BY x.day), '[]'::jsonb) INTO _ai FROM (
    SELECT d::date AS day, (SELECT count(*) FROM public.ai_usage_events a WHERE a.created_at::date = d::date) AS count
    FROM generate_series(date_trunc('day', now()) - ((_days - 1) || ' days')::interval, date_trunc('day', now()), interval '1 day') d
  ) x;

  SELECT COALESCE(jsonb_agg(x ORDER BY x.attempts DESC), '[]'::jsonb) INTO _subjects FROM (
    SELECT subject, count(*) AS attempts,
           round(avg(100.0 * score / NULLIF(total, 0))) AS avg_pct
    FROM public.quiz_results GROUP BY subject ORDER BY count(*) DESC LIMIT 8
  ) x;

  SELECT COALESCE(jsonb_agg(x ORDER BY x.calls DESC), '[]'::jsonb) INTO _features FROM (
    SELECT feature, count(*) AS calls, count(*) FILTER (WHERE NOT success) AS failures
    FROM public.ai_usage_events GROUP BY feature ORDER BY count(*) DESC LIMIT 10
  ) x;

  RETURN jsonb_build_object(
    'days', _days,
    'signups', _signups,
    'quiz_attempts', _quizzes,
    'ai_calls', _ai,
    'top_subjects', _subjects,
    'top_features', _features
  );
END;
$$;

-- ============ 13. Revenue report ============
CREATE OR REPLACE FUNCTION public.admin_revenue_report()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _months jsonb; _plans jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT COALESCE(jsonb_agg(x ORDER BY x.month), '[]'::jsonb) INTO _months FROM (
    SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS month,
           count(*) AS sales, sum(amount) AS total
    FROM public.payment_requests WHERE status = 'approved'
    GROUP BY date_trunc('month', created_at)
  ) x;

  SELECT COALESCE(jsonb_agg(x ORDER BY x.total DESC), '[]'::jsonb) INTO _plans FROM (
    SELECT COALESCE(plan, 'pro') AS plan, count(*) AS sales, sum(amount) AS total
    FROM public.payment_requests WHERE status = 'approved'
    GROUP BY COALESCE(plan, 'pro')
  ) x;

  RETURN jsonb_build_object(
    'approved_total', (SELECT COALESCE(sum(amount), 0) FROM public.payment_requests WHERE status = 'approved'),
    'approved_count', (SELECT count(*) FROM public.payment_requests WHERE status = 'approved'),
    'pending_count', (SELECT count(*) FROM public.payment_requests WHERE status = 'pending'),
    'pro_users', (SELECT count(*) FROM public.profiles WHERE plan = 'pro'),
    'lifetime_users', (SELECT count(*) FROM public.profiles WHERE plan = 'lifetime'),
    'by_month', _months,
    'by_plan', _plans
  );
END;
$$;

-- ============ 14. Feedback reply ============
CREATE OR REPLACE FUNCTION public.admin_reply_feedback(_feedback_id uuid, _reply text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _owner uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF _reply IS NULL OR btrim(_reply) = '' THEN
    RAISE EXCEPTION 'Reply cannot be empty';
  END IF;
  SELECT user_id INTO _owner FROM public.feedbacks WHERE id = _feedback_id;
  IF _owner IS NULL THEN
    RAISE EXCEPTION 'Feedback not found';
  END IF;

  UPDATE public.feedbacks
  SET admin_reply = _reply, replied_at = now(), replied_by = auth.uid(), status = 'reviewed'
  WHERE id = _feedback_id;

  INSERT INTO public.notifications (user_id, type, title, body)
  VALUES (_owner, 'feedback_reply', 'We replied to your feedback', left(_reply, 240));

  INSERT INTO public.audit_log (actor_id, action, details)
  VALUES (auth.uid(), 'feedback_replied', jsonb_build_object('feedback_id', _feedback_id));
END;
$$;

-- ============ 15. Results export ============
CREATE OR REPLACE FUNCTION public.admin_export_quiz_results(_limit integer DEFAULT 1000)
RETURNS TABLE(
  created_at timestamptz, user_name text, user_email text,
  subject text, quiz_type text, score integer, total integer
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  RETURN QUERY
  SELECT q.created_at, p.display_name, u.email::text, q.subject, q.quiz_type, q.score, q.total
  FROM public.quiz_results q
  LEFT JOIN public.profiles p ON p.user_id = q.user_id
  LEFT JOIN auth.users u ON u.id = q.user_id
  ORDER BY q.created_at DESC
  LIMIT LEAST(GREATEST(_limit, 1), 5000);
END;
$$;
