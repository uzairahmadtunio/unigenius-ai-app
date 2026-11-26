-- D-16 fix (2026-11-26): the profiles.university column DEFAULT was
-- 'University of Larkana' — a misspelling of the founder's university
-- that every new profile silently inherited. Correct the DEFAULT
-- only; existing rows keep whatever they already hold (user data is
-- never rewritten).
ALTER TABLE public.profiles
  ALTER COLUMN university SET DEFAULT 'The University of Larkano';
