-- 002: targets + flexible goals (additive).
--
-- Apply once in the Supabase dashboard: SQL Editor -> paste this file -> Run.
-- Safe to re-run: it never drops a table, column, row or index. The only
-- DDL that removes anything is dropping single-column CHECK constraints on
-- goal-like columns, so that goals can be free-form text from now on.
--
-- Everything runs in one transaction: either the whole migration applies or
-- nothing does.

begin;

-- ---------------------------------------------------------------------------
-- 1. Goals become flexible.
--    Drop single-column CHECK constraints that pin goal-like columns to a
--    fixed list (e.g. items_type_check, items_goal_check,
--    completions_kind_check). Existing row values are left untouched.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select n.nspname as schema_name, t.relname as table_name, c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    join pg_attribute a on a.attrelid = c.conrelid
    where c.contype = 'c'
      and n.nspname = 'public'
      and t.relkind = 'r'
      and t.relname in ('items', 'completions', 'projects')
      and a.attname in ('goal', 'type', 'kind')
      and a.attnum > 0
      and not a.attisdropped
      and a.attnum = any (c.conkey)
      and array_length(c.conkey, 1) = 1
  loop
    execute format(
      'alter table %I.%I drop constraint %I',
      r.schema_name,
      r.table_name,
      r.conname
    );
    raise notice 'dropped check constraint % on public.%',
      r.conname, r.table_name;
  end loop;
end
$$;

-- Same idea for enum (or varchar/bpchar) columns: convert them to plain text
-- in place, casting the existing values so no data is lost.
do $$
declare
  r record;
begin
  for r in
    select n.nspname as schema_name, t.relname as table_name, a.attname
    from pg_attribute a
    join pg_class t on t.oid = a.attrelid
    join pg_namespace n on n.oid = t.relnamespace
    join pg_type ty on ty.oid = a.atttypid
    where n.nspname = 'public'
      and t.relkind = 'r'
      and t.relname in ('items', 'completions', 'projects')
      and a.attname in ('goal', 'type', 'kind')
      and a.attnum > 0
      and not a.attisdropped
      and (ty.typtype = 'e' or ty.typname in ('varchar', 'bpchar'))
  loop
    execute format(
      'alter table %I.%I alter column %I type text using %I::text',
      r.schema_name,
      r.table_name,
      r.attname,
      r.attname
    );
    raise notice 'converted %.% to text', r.table_name, r.attname;
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 2. items: time estimate, energy level, skip tracking, free-form notes.
--    (est_minutes already exists on current databases; the constraint below
--    only applies when the column has to be created.)
-- ---------------------------------------------------------------------------
alter table public.items
  add column if not exists est_minutes integer
    constraint items_est_minutes_check
    check (est_minutes is null or est_minutes > 0),
  add column if not exists energy text not null default 'normal'
    constraint items_energy_check
    check (energy in ('low', 'normal', 'high')),
  add column if not exists skipped_count integer not null default 0,
  add column if not exists last_skipped_at timestamptz,
  add column if not exists notes text;

-- ---------------------------------------------------------------------------
-- 3. completions: a completion can count toward a goal (and a distance)
--    even when no item is involved.
-- ---------------------------------------------------------------------------
alter table public.completions
  add column if not exists distance_km numeric,
  add column if not exists goal text;

-- ---------------------------------------------------------------------------
-- 4. targets: one weekly number per goal ("leetcode, 3x / week").
--    New goals are just new rows, so nothing here is constrained to a list.
-- ---------------------------------------------------------------------------
create table if not exists public.targets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  goal text not null,
  label text not null,
  per_week integer not null,
  min_distance_km numeric,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (user_id, goal)
);

alter table public.targets enable row level security;

drop policy if exists "targets owner" on public.targets;
create policy "targets owner" on public.targets
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 5. Seed the default weekly targets for every existing user.
--    ON CONFLICT DO NOTHING keeps this re-runnable and never overwrites edits.
-- ---------------------------------------------------------------------------
insert into public.targets (user_id, goal, label, per_week, min_distance_km)
select
  u.id,
  v.goal,
  v.label,
  v.per_week,
  v.min_distance_km
from auth.users u
cross join (
  values
    ('leetcode',    'LeetCode',            3, null::numeric),
    ('ai_learning', 'AI learning',         3, null::numeric),
    ('bi',          'Tableau / Power BI',  2, null::numeric),
    ('job_search',  'Job search',          2, null::numeric),
    ('walk_run',    '5 km walk/run',       3, 5::numeric)
) as v (goal, label, per_week, min_distance_km)
on conflict (user_id, goal) do nothing;

-- ---------------------------------------------------------------------------
-- 6. daily_completions: completions per user per day, bucketed in IST.
--    security_invoker = true makes the query run with the caller's rights, so
--    the completions RLS policy still applies.
-- ---------------------------------------------------------------------------
create or replace view public.daily_completions
with (security_invoker = true) as
select
  c.user_id,
  (c.completed_at at time zone 'Asia/Kolkata')::date as day,
  count(*)::integer as count
from public.completions c
group by
  c.user_id,
  (c.completed_at at time zone 'Asia/Kolkata')::date;

-- Tell PostgREST (the Supabase API layer) to pick up the new schema.
notify pgrst, 'reload schema';

commit;

