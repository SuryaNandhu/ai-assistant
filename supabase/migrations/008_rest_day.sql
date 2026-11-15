-- 008: one weekly rest day that holds the streak.
--
-- Apply once in the Supabase dashboard: SQL Editor -> paste this file -> Run.
-- Additive and re-runnable: a boolean column with a default, so every existing
-- journal row simply reads as "not a rest day". Nothing is dropped or rewritten.
--
-- journal_entries.is_rest_day  the day was taken as a rest day. The one-per-week
-- rule and the "today or yesterday" rule live in the app, not in SQL, because
-- they are evaluated against the week the chosen day belongs to.

begin;

alter table public.journal_entries
  add column if not exists is_rest_day boolean not null default false;

commit;

-- Ask PostgREST (the Supabase API layer) to reload its schema cache.
notify pgrst, 'reload schema';
