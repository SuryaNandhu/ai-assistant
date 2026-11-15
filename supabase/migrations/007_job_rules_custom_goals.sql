-- 007: job-search daily minimum, the monthly resume task and custom goals.
--
-- Apply once in the Supabase dashboard: SQL Editor -> paste this file -> Run.
-- Re-runnable and additive: it only adds columns, a table, a policy and seed
-- rows. The one removal is the old CHECK on items.url, which made link-less
-- one-off tasks impossible; no row or column is dropped or rewritten.
--
-- completions.quantity  how many things a completion covered (3 applications)
-- targets.period        'week' or 'month' — a monthly target is done once
-- targets.min_quantity  a day only counts when this many were logged that day
-- targets.est_minutes   default minutes for the quick-log / picker suggestion
-- targets.energy        default energy for the picker suggestion
-- targets.is_custom     true for goals the user invented in the add sheet
-- data_exports          one row per JSON export, which enforces 5 per hour

begin;

-- ---------------------------------------------------------------------------
-- 1. completions.quantity: 3 applications, 2 problems, and so on. NULL means
--    "a single thing was done", which is every existing row.
-- ---------------------------------------------------------------------------
alter table public.completions
  add column if not exists quantity integer
    constraint completions_quantity_check
    check (quantity is null or quantity between 0 and 1000);

-- ---------------------------------------------------------------------------
-- 2. targets: period, per-day minimum, default minutes/energy, custom flag.
-- ---------------------------------------------------------------------------
alter table public.targets
  add column if not exists period text not null default 'week'
    constraint targets_period_check check (period in ('week', 'month')),
  add column if not exists min_quantity integer
    constraint targets_min_quantity_check
    check (min_quantity is null or min_quantity between 1 and 1000),
  add column if not exists est_minutes integer
    constraint targets_est_minutes_check
    check (est_minutes is null or est_minutes between 1 and 600),
  add column if not exists energy text not null default 'normal'
    constraint targets_energy_check check (energy in ('low', 'normal', 'high')),
  add column if not exists is_custom boolean not null default false;

-- ---------------------------------------------------------------------------
-- 3. items: a one-off task has no link, so url must be nullable and the old
--    CHECK that required a link has to go. Re-runnable: both steps are no-ops
--    once applied.
-- ---------------------------------------------------------------------------
alter table public.items alter column url drop not null;

do $$
declare
  check_name text;
begin
  for check_name in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace ns on ns.oid = rel.relnamespace
    where ns.nspname = 'public'
      and rel.relname = 'items'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%url%'
  loop
    execute format('alter table public.items drop constraint %I', check_name);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 4. data_exports: one row per export, so the route can allow 5 per hour.
-- ---------------------------------------------------------------------------
create table if not exists public.data_exports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists data_exports_user_created_idx
  on public.data_exports (user_id, created_at desc);

alter table public.data_exports enable row level security;

drop policy if exists "data_exports owner" on public.data_exports;
create policy "data_exports owner" on public.data_exports
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 5. Job search becomes a three-day-a-week rule with three applications on each
--    of those days, and the resume gets one small update a month. Both are
--    seeded for every existing user; a later edit to per_week or est_minutes is
--    kept because only these rule columns are refreshed.
-- ---------------------------------------------------------------------------
insert into public.targets (
  user_id,
  goal,
  label,
  per_week,
  min_distance_km,
  period,
  min_quantity,
  est_minutes,
  energy,
  is_custom
)
select
  u.id,
  v.goal,
  v.label,
  v.per_week,
  null::numeric,
  v.period,
  v.min_quantity,
  v.est_minutes,
  v.energy,
  false
from auth.users u
cross join (
  values
    ('job_search',    'Job search',    3, 'week',  3,   45, 'normal'),
    ('resume_update', 'Update resume', 1, 'month', null::integer, 60, 'normal')
) as v (goal, label, per_week, period, min_quantity, est_minutes, energy)
on conflict (user_id, goal) do update
  set per_week = excluded.per_week,
      period = excluded.period,
      min_quantity = excluded.min_quantity,
      est_minutes = excluded.est_minutes,
      energy = excluded.energy,
      is_custom = false;

-- Ask PostgREST (the Supabase API layer) to reload its schema cache.
notify pgrst, 'reload schema';

commit;
