-- ============================================================
-- API Key Auto-Routing: DB-backed provider key pool
-- ============================================================
-- Moves the Gemini/Groq key pool out of edge-function env secrets
-- (GEMINI_KEY_1..20, capped at 20, read once at cold start) into a
-- locked-down table the Admin Panel can manage at runtime:
-- add / enable / disable / delete / health-test an unlimited number
-- of keys without touching Supabase secrets or redeploying.
--
-- Security model:
--   * Table lives in the `private` schema (same as private.app_secrets),
--     which is NOT exposed through the Data API (PostgREST).
--   * RLS is enabled and NO policies exist for anon/authenticated, and
--     all privileges are revoked from them — the browser can never read
--     or write key values, not even masked ones, directly.
--   * Edge functions (service role) read the pool and report health via
--     the SECURITY DEFINER RPCs below (service-role-only EXECUTE).
--   * The Admin Panel talks only to admin_* RPCs, which verify
--     has_role(auth.uid(), 'admin') server-side and NEVER return a full
--     key value — only a masked form (first/last 4 chars).
-- ============================================================

-- 1. Pool table ------------------------------------------------
CREATE TABLE IF NOT EXISTS private.api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'gemini'
    CHECK (provider IN ('gemini', 'groq')),
  label text NOT NULL,
  key_value text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  -- Health state maintained by report_api_key_result():
  --   active   -> usable
  --   cooldown -> temporarily benched after a 429 (see cooldown_until)
  --   invalid  -> provider rejected the key itself (401/403/bad key);
  --               also flips enabled=false so it stays out of the pool
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'cooldown', 'invalid')),
  consecutive_errors integer NOT NULL DEFAULT 0,
  total_requests integer NOT NULL DEFAULT 0,
  total_errors integer NOT NULL DEFAULT 0,
  last_error text,
  last_error_at timestamptz,
  cooldown_until timestamptz,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One row per distinct key per provider (also makes env-seeding idempotent)
CREATE UNIQUE INDEX IF NOT EXISTS api_keys_provider_value_uidx
  ON private.api_keys (provider, key_value);
CREATE INDEX IF NOT EXISTS api_keys_provider_idx
  ON private.api_keys (provider, created_at);

ALTER TABLE private.api_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.api_keys FROM anon, authenticated;
GRANT ALL ON private.api_keys TO service_role;

-- 2. Pool read for edge functions (service role ONLY) ----------
-- Returns ALL rows (any state) ordered by creation; the caller
-- (ai-failover.ts) filters enabled/status/cooldown and merges the
-- legacy env-secret keys as fallback for values not present here.
CREATE OR REPLACE FUNCTION public.get_api_key_pool()
RETURNS TABLE (
  id uuid,
  provider text,
  key_value text,
  enabled boolean,
  status text,
  cooldown_until timestamptz,
  created_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = private
AS $$
  SELECT k.id, k.provider, k.key_value, k.enabled, k.status, k.cooldown_until, k.created_at
  FROM private.api_keys k
  ORDER BY k.created_at ASC;
$$;

REVOKE ALL ON FUNCTION public.get_api_key_pool() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_api_key_pool() TO service_role;

-- 3. Health reporting from edge functions (service role ONLY) --
-- Success: clears the error streak, marks the key active, stamps use.
-- Failure classification:
--   * 401/403 or an "API key invalid" message -> status=invalid,
--     enabled=false, reason recorded in last_error.
--   * 429 (quota / rate limit) -> status=cooldown until
--     now() + _cooldown_seconds (clamped 10s..1h, default 60s).
--   * 5xx repeated 5+ times in a row -> short 30s cooldown.
--   * anything else -> counters only.
CREATE OR REPLACE FUNCTION public.report_api_key_result(
  _key_id uuid,
  _success boolean,
  _error_status integer DEFAULT NULL,
  _error_message text DEFAULT NULL,
  _cooldown_seconds integer DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  _is_invalid boolean := false;
  _cooldown interval := NULL;
BEGIN
  IF _key_id IS NULL THEN
    RETURN;
  END IF;

  IF _success THEN
    UPDATE private.api_keys k SET
      consecutive_errors = 0,
      status = 'active',
      cooldown_until = NULL,
      last_used_at = now(),
      total_requests = k.total_requests + 1,
      updated_at = now()
    WHERE k.id = _key_id;
    RETURN;
  END IF;

  IF _error_status IN (401, 403)
     OR (_error_message IS NOT NULL AND (
          _error_message ILIKE '%API_KEY_INVALID%'
          OR _error_message ILIKE '%api key not valid%'
          OR _error_message ILIKE '%invalid api key%'
          OR _error_message ILIKE '%api_key_invalid%'
        )) THEN
    _is_invalid := true;
  ELSIF _error_status = 429 THEN
    _cooldown := make_interval(
      secs => LEAST(GREATEST(COALESCE(_cooldown_seconds, 60), 10), 3600)
    );
  END IF;

  UPDATE private.api_keys k SET
    total_requests = k.total_requests + 1,
    total_errors = k.total_errors + 1,
    consecutive_errors = k.consecutive_errors + 1,
    last_error = LEFT(
      COALESCE(_error_message, 'HTTP ' || COALESCE(_error_status::text, 'network error')),
      500
    ),
    last_error_at = now(),
    last_used_at = now(),
    enabled = CASE WHEN _is_invalid THEN false ELSE k.enabled END,
    status = CASE
      WHEN _is_invalid THEN 'invalid'
      WHEN _cooldown IS NOT NULL THEN 'cooldown'
      WHEN _error_status IS NOT NULL AND _error_status >= 500
           AND k.consecutive_errors + 1 >= 5 THEN 'cooldown'
      ELSE k.status
    END,
    cooldown_until = CASE
      WHEN _is_invalid THEN k.cooldown_until
      WHEN _cooldown IS NOT NULL THEN now() + _cooldown
      WHEN _error_status IS NOT NULL AND _error_status >= 500
           AND k.consecutive_errors + 1 >= 5 THEN now() + interval '30 seconds'
      ELSE k.cooldown_until
    END,
    updated_at = now()
  WHERE k.id = _key_id;
END;
$$;

REVOKE ALL ON FUNCTION public.report_api_key_result(uuid, boolean, integer, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.report_api_key_result(uuid, boolean, integer, text, integer)
  TO service_role;

-- 4. Idempotent insert used by the admin-api-keys edge function
--    to seed the legacy env-secret keys into the table.
--    (service role ONLY; returns the row id, existing or new)
CREATE OR REPLACE FUNCTION public.register_api_key(
  _provider text,
  _label text,
  _key_value text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  _id uuid;
BEGIN
  INSERT INTO private.api_keys (provider, label, key_value)
  VALUES (_provider, _label, _key_value)
  ON CONFLICT (provider, key_value) DO NOTHING
  RETURNING id INTO _id;

  IF _id IS NULL THEN
    SELECT k.id INTO _id
    FROM private.api_keys k
    WHERE k.provider = _provider AND k.key_value = _key_value;
  END IF;

  RETURN _id;
END;
$$;

REVOKE ALL ON FUNCTION public.register_api_key(text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_api_key(text, text, text) TO service_role;

-- 5. Admin RPCs (authenticated + in-function admin check) ------

-- 5a. List keys — masked values only, full key NEVER leaves the DB.
CREATE OR REPLACE FUNCTION public.admin_list_api_keys()
RETURNS TABLE (
  id uuid,
  provider text,
  label text,
  key_masked text,
  enabled boolean,
  status text,
  effective_status text,
  consecutive_errors integer,
  total_requests integer,
  total_errors integer,
  last_error text,
  last_error_at timestamptz,
  cooldown_until timestamptz,
  last_used_at timestamptz,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN QUERY
  SELECT
    k.id,
    k.provider,
    k.label,
    CASE
      WHEN length(k.key_value) >= 12
        THEN left(k.key_value, 4) || '••••••' || right(k.key_value, 4)
      ELSE '••••••••'
    END AS key_masked,
    k.enabled,
    k.status,
    CASE
      WHEN k.status = 'invalid' THEN 'invalid'
      WHEN NOT k.enabled THEN 'disabled'
      WHEN k.status = 'cooldown'
           AND k.cooldown_until IS NOT NULL
           AND k.cooldown_until > now() THEN 'cooldown'
      ELSE 'active'
    END AS effective_status,
    k.consecutive_errors,
    k.total_requests,
    k.total_errors,
    k.last_error,
    k.last_error_at,
    k.cooldown_until,
    k.last_used_at,
    k.created_at
  FROM private.api_keys k
  ORDER BY k.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_api_keys() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_api_keys() TO authenticated;

-- 5b. Add a key.
CREATE OR REPLACE FUNCTION public.admin_add_api_key(
  _provider text,
  _label text,
  _key_value text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  _id uuid;
  _clean_key text := btrim(COALESCE(_key_value, ''));
  _clean_label text := btrim(COALESCE(_label, ''));
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF _provider NOT IN ('gemini', 'groq') THEN
    RAISE EXCEPTION 'Unsupported provider: %', _provider;
  END IF;
  IF length(_clean_key) < 10 THEN
    RAISE EXCEPTION 'Key looks too short to be valid';
  END IF;
  IF _clean_label = '' THEN
    _clean_label := CASE _provider
      WHEN 'gemini' THEN 'Gemini key'
      ELSE 'Groq key'
    END;
  END IF;

  INSERT INTO private.api_keys (provider, label, key_value)
  VALUES (_provider, _clean_label, _clean_key)
  RETURNING id INTO _id;

  RETURN _id;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'This key is already in the pool';
END;
$$;

REVOKE ALL ON FUNCTION public.admin_add_api_key(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_add_api_key(text, text, text) TO authenticated;

-- 5c. Enable / disable. Enabling also clears health state, so this
--     doubles as the "reset" action for invalid / cooldown keys.
CREATE OR REPLACE FUNCTION public.admin_set_api_key_enabled(
  _key_id uuid,
  _enabled boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF _enabled THEN
    UPDATE private.api_keys k SET
      enabled = true,
      status = 'active',
      consecutive_errors = 0,
      cooldown_until = NULL,
      last_error = NULL,
      last_error_at = NULL,
      updated_at = now()
    WHERE k.id = _key_id;
  ELSE
    UPDATE private.api_keys k SET
      enabled = false,
      updated_at = now()
    WHERE k.id = _key_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_api_key_enabled(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_api_key_enabled(uuid, boolean) TO authenticated;

-- 5d. Delete a key.
CREATE OR REPLACE FUNCTION public.admin_delete_api_key(_key_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  DELETE FROM private.api_keys k WHERE k.id = _key_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_api_key(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_api_key(uuid) TO authenticated;
