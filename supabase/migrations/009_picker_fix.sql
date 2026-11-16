-- 009: the picker suggests every goal, and job postings always file under job
-- search.
--
-- Apply once in the Supabase dashboard: SQL Editor -> paste this file -> Run.
-- Re-runnable and additive: one boolean column with a default, two targeted
-- updates and one data fix. No row or column is deleted.
--
-- targets.suggestable  false keeps a goal out of the picker (walk/run); quick
--                      log and the Home pill still work exactly as before.
-- targets.energy       LeetCode was seeded as "high"; a normal slot should be
--                      enough for one easy/medium problem.
-- items.goal           any job posting that drifted to another goal belongs to
--                      job_search, which is the one rule the AI may not touch.

begin;

-- ---------------------------------------------------------------------------
-- 1. targets: the picker may skip a goal. Everything else stays suggestable.
-- ---------------------------------------------------------------------------
alter table public.targets
  add column if not exists suggestable boolean not null default true;

update public.targets
   set suggestable = false
 where goal = 'walk_run';

-- ---------------------------------------------------------------------------
-- 2. LeetCode is a normal-energy task, not a high-energy one.
-- ---------------------------------------------------------------------------
update public.targets
   set energy = 'normal'
 where goal = 'leetcode';

-- ---------------------------------------------------------------------------
-- 3. Job postings saved under another goal move to job_search. Nothing is
--    dropped: only the goal column changes, and only for type = 'job'.
-- ---------------------------------------------------------------------------
update public.items
   set goal = 'job_search'
 where type = 'job'
   and goal is distinct from 'job_search';

commit;

-- Ask PostgREST (the Supabase API layer) to reload its schema cache.
notify pgrst, 'reload schema';
