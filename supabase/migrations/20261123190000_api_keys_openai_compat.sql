-- ============================================================
-- API Key Pool: generic OpenAI-compatible provider tier
-- ============================================================
-- Adds a third provider kind, 'openai_compat', for any provider that
-- speaks the OpenAI chat-completions API (OpenRouter, Cloudflare
-- Workers AI, GitHub Models, NVIDIA NIM, SambaNova, ...). Each such
-- key carries its own base_url + model, so adding a new provider
-- becomes a single Admin Panel row — no code change, no redeploy.
--
-- Additive only: existing 'gemini' / 'groq' rows, RPC behaviour for
-- them, and the health-reporting function are untouched.
-- ============================================================

-- 1. Per-key endpoint + model columns (NULL for gemini/groq) ---
ALTER TABLE private.api_keys
  ADD COLUMN IF NOT EXISTS base_url text;
ALTER TABLE private.api_keys
  ADD COLUMN IF NOT EXISTS model text;

-- 2. Widen the provider CHECK ----------------------------------
ALTER TABLE private.api_keys
  DROP CONSTRAINT IF EXISTS api_keys_provider_check;
ALTER TABLE private.api_keys
  ADD CONSTRAINT api_keys_provider_check
  CHECK (provider IN ('gemini', 'groq', 'openai_compat'));

-- 3. Pool read: also return base_url + model -------------------
-- (Return-type change requires DROP + CREATE.)
DROP FUNCTION IF EXISTS public.get_api_key_pool();
CREATE FUNCTION public.get_api_key_pool()
RETURNS TABLE (
  id uuid,
  provider text,
  key_value text,
  enabled boolean,
  status text,
  cooldown_until timestamptz,
  created_at timestamptz,
  base_url text,
  model text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = private
AS $$
  SELECT k.id, k.provider, k.key_value, k.enabled, k.status,
         k.cooldown_until, k.created_at, k.base_url, k.model
  FROM private.api_keys k
  ORDER BY k.created_at ASC;
$$;

REVOKE ALL ON FUNCTION public.get_api_key_pool() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_api_key_pool() TO service_role;

-- 4. register_api_key: optional base_url/model -----------------
-- (Signature change: drop the 3-arg form, recreate with defaults
-- so existing 3-arg calls keep working unchanged.)
DROP FUNCTION IF EXISTS public.register_api_key(text, text, text);
CREATE FUNCTION public.register_api_key(
  _provider text,
  _label text,
  _key_value text,
  _base_url text DEFAULT NULL,
  _model text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  _id uuid;
BEGIN
  INSERT INTO private.api_keys (provider, label, key_value, base_url, model)
  VALUES (_provider, _label, _key_value, _base_url, _model)
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

REVOKE ALL ON FUNCTION public.register_api_key(text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_api_key(text, text, text, text, text)
  TO service_role;

-- 5. admin_list_api_keys: include base_url + model -------------
DROP FUNCTION IF EXISTS public.admin_list_api_keys();
CREATE FUNCTION public.admin_list_api_keys()
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
  created_at timestamptz,
  base_url text,
  model text
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
    k.created_at,
    k.base_url,
    k.model
  FROM private.api_keys k
  ORDER BY k.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_api_keys() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_api_keys() TO authenticated;

-- 6. admin_add_api_key: accept openai_compat + endpoint fields -
DROP FUNCTION IF EXISTS public.admin_add_api_key(text, text, text);
CREATE FUNCTION public.admin_add_api_key(
  _provider text,
  _label text,
  _key_value text,
  _base_url text DEFAULT NULL,
  _model text DEFAULT NULL
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
  _clean_base text := rtrim(btrim(COALESCE(_base_url, '')), '/');
  _clean_model text := btrim(COALESCE(_model, ''));
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF _provider NOT IN ('gemini', 'groq', 'openai_compat') THEN
    RAISE EXCEPTION 'Unsupported provider: %', _provider;
  END IF;
  IF length(_clean_key) < 10 THEN
    RAISE EXCEPTION 'Key looks too short to be valid';
  END IF;
  IF _provider = 'openai_compat' THEN
    IF _clean_base = '' OR _clean_base NOT LIKE 'http%://%' THEN
      RAISE EXCEPTION 'A Base URL (https://...) is required for OpenAI-compatible keys';
    END IF;
    IF _clean_model = '' THEN
      RAISE EXCEPTION 'A model name is required for OpenAI-compatible keys';
    END IF;
  END IF;
  IF _clean_label = '' THEN
    _clean_label := CASE _provider
      WHEN 'gemini' THEN 'Gemini key'
      WHEN 'groq' THEN 'Groq key'
      ELSE 'OpenAI-compatible key'
    END;
  END IF;

  INSERT INTO private.api_keys (provider, label, key_value, base_url, model)
  VALUES (
    _provider,
    _clean_label,
    _clean_key,
    CASE WHEN _provider = 'openai_compat' THEN _clean_base ELSE NULL END,
    CASE WHEN _provider = 'openai_compat' THEN _clean_model ELSE NULL END
  )
  RETURNING id INTO _id;

  RETURN _id;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'This key is already in the pool';
END;
$$;

REVOKE ALL ON FUNCTION public.admin_add_api_key(text, text, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_add_api_key(text, text, text, text, text)
  TO authenticated;
