-- D-16 fix (2026-11-26): Admin Overview "Files Uploaded" read 0 while
-- uploads existed, because admin_get_stats counted ONLY group_files.
-- The platform's files live in four places: shared notes, the past-paper
-- vault, teacher study materials, and group files. Count them all so
-- the stat reflects the files the platform actually serves.
CREATE OR REPLACE FUNCTION public.admin_get_stats()
 RETURNS TABLE(total_users bigint, total_groups bigint, total_files bigint, total_notices bigint, total_quizzes bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    IF NOT public.has_role(auth.uid(), 'admin') THEN
        RAISE EXCEPTION 'Unauthorized';
    END IF;

    RETURN QUERY
    SELECT
        (SELECT COUNT(*) FROM auth.users)::bigint AS total_users,
        (SELECT COUNT(*) FROM public.groups)::bigint AS total_groups,
        ((SELECT COUNT(*) FROM public.group_files)
         + (SELECT COUNT(*) FROM public.study_materials)
         + (SELECT COUNT(*) FROM public.past_papers)
         + (SELECT COUNT(*) FROM public.notes))::bigint AS total_files,
        (SELECT COUNT(*) FROM public.university_notices)::bigint AS total_notices,
        (SELECT COUNT(*) FROM public.quiz_results)::bigint AS total_quizzes;
END;
$function$;
