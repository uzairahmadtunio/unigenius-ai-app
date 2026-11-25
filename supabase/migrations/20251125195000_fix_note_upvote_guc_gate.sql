-- Fix toggle_note_upvote "Failed to upvote" (Bug #6C, 2026-11-25).
-- Root cause: toggle_note_upvote() used set_config('session_replication_role',
-- 'replica', true) to bypass the notes upvote-protection triggers, but the
-- platform no longer permits setting that parameter from a function
-- (PostgREST 403: permission denied to set parameter "session_replication_role"),
-- so every upvote failed. Replace the replica-role gate with a custom GUC
-- ('app.allow_upvote_update') that any session may set transaction-locally,
-- and teach both protection triggers to honour it.

CREATE OR REPLACE FUNCTION public.notes_block_upvote_tampering()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.upvotes IS DISTINCT FROM OLD.upvotes
     AND current_setting('app.allow_upvote_update', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Direct modification of upvotes is not allowed. Use toggle_note_upvote().';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notes_protect_upvotes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF current_setting('app.allow_upvote_update', true) IS DISTINCT FROM 'on' THEN
    NEW.upvotes := OLD.upvotes;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.toggle_note_upvote(_note_id uuid)
 RETURNS TABLE(upvoted boolean, total integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _exists boolean;
  _count integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  SELECT EXISTS(SELECT 1 FROM public.note_votes WHERE note_id = _note_id AND user_id = auth.uid())
    INTO _exists;

  IF _exists THEN
    DELETE FROM public.note_votes WHERE note_id = _note_id AND user_id = auth.uid();
  ELSE
    INSERT INTO public.note_votes (note_id, user_id) VALUES (_note_id, auth.uid())
      ON CONFLICT (note_id, user_id) DO NOTHING;
  END IF;

  SELECT COUNT(*)::int INTO _count FROM public.note_votes WHERE note_id = _note_id;

  -- Authorised counter write: the protection triggers honour this
  -- transaction-local GUC (replaces the session_replication_role hack).
  PERFORM set_config('app.allow_upvote_update', 'on', true);
  UPDATE public.notes SET upvotes = _count WHERE id = _note_id;
  PERFORM set_config('app.allow_upvote_update', 'off', true);

  RETURN QUERY SELECT (NOT _exists), _count;
END;
$function$;
