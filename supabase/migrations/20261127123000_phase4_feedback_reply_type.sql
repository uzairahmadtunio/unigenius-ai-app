-- Phase 4 follow-up (2026-11-27): notifications.type ki CHECK list mein
-- 'feedback_reply' shamil karo — admin_reply_feedback() is type ki
-- notification insert karta hai; baghair is ke reply RPC fail hota tha
-- (live verification mein pakra gaya).
ALTER TABLE public.notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type = ANY (ARRAY['study_reminder', 'streak', 'quiz', 'assignment', 'teacher', 'system', 'feedback_reply']::text[]));
