-- Personal AI assistant schema (Supabase / Postgres) — final state.
--
-- Fresh setup: Supabase dashboard -> SQL Editor -> paste this file -> Run.
-- Existing database: apply supabase/migrations/*.sql in order instead; this
-- file always describes where those migrations end up.
--
-- The script is re-runnable: tables, columns, indexes, views and policies are
-- created only when missing. Goal-like columns (items.goal, items.type,
-- completions.kind, completions.goal) are deliberately plain text with no
-- CHECK constraints, so goals can be created freely at runtime.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- items: saved videos, articles and practice problems, plus free-form goals
-- ---------------------------------------------------------------------------
create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  type text not null,
  title text not null,
  url text,
  est_minutes integer check (est_minutes is null or est_minutes > 0),
  goal text,
  status text not null default 'todo' check (status in ('todo', 'done', 'dropped')),
  energy text not null default 'normal'
    constraint items_energy_check check (energy in ('low', 'normal', 'high')),
  skipped_count integer not null default 0,
  last_skipped_at timestamptz,
  notes text,
  source_domain text,
  summary text,
  takeaway text,
  summarized_at timestamptz,
  added_via text default 'manual',
  created_at timestamptz not null default now()
);

create index if not exists items_user_status_idx
  on public.items (user_id, status, created_at desc);

-- ---------------------------------------------------------------------------
-- completions: what was actually done (practice, study, project work)
-- ---------------------------------------------------------------------------
create table if not exists public.completions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  item_id uuid references public.items (id) on delete set null,
  kind text not null,
  goal text,
  distance_km numeric,
  minutes integer check (minutes is null or minutes >= 0),
  felt text check (felt in ('easy', 'ok', 'hard')),
  completed_at timestamptz not null default now()
);

create index if not exists completions_user_completed_idx
  on public.completions (user_id, completed_at desc);

-- ---------------------------------------------------------------------------
-- targets: one weekly number per goal ("leetcode, 3x / week")
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

-- ---------------------------------------------------------------------------
-- projects: one resume project per month
-- ---------------------------------------------------------------------------
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  month date not null,
  title text not null,
  goal text,
  status text not null default 'planned' check (status in ('planned', 'in_progress', 'shipped', 'dropped')),
  created_at timestamptz not null default now(),
  unique (user_id, month)
);

-- ---------------------------------------------------------------------------
-- project_updates: progress notes against a monthly project
-- ---------------------------------------------------------------------------
create table if not exists public.project_updates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  note text not null,
  created_at timestamptz not null default now()
);

create index if not exists project_updates_project_idx
  on public.project_updates (project_id, created_at desc);

-- ---------------------------------------------------------------------------
-- messages: chat transcript (used for context and the daily cap)
-- ---------------------------------------------------------------------------
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists messages_user_created_idx
  on public.messages (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- tool_calls: audit log for every tool the assistant runs
-- ---------------------------------------------------------------------------
create table if not exists public.tool_calls (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  tool text not null,
  input jsonb,
  output jsonb,
  created_at timestamptz not null default now()
);

create index if not exists tool_calls_user_created_idx
  on public.tool_calls (user_id, created_at desc);


-- ---------------------------------------------------------------------------
-- Row Level Security: every row belongs to exactly one authenticated user.
-- ---------------------------------------------------------------------------
alter table public.items enable row level security;
alter table public.completions enable row level security;
alter table public.targets enable row level security;
alter table public.projects enable row level security;
alter table public.project_updates enable row level security;
alter table public.messages enable row level security;
alter table public.tool_calls enable row level security;

drop policy if exists "items owner" on public.items;
create policy "items owner" on public.items
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "completions owner" on public.completions;
create policy "completions owner" on public.completions
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "targets owner" on public.targets;
create policy "targets owner" on public.targets
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "projects owner" on public.projects;
create policy "projects owner" on public.projects
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "project_updates owner" on public.project_updates;
create policy "project_updates owner" on public.project_updates
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "messages owner" on public.messages;
create policy "messages owner" on public.messages
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "tool_calls owner" on public.tool_calls;
create policy "tool_calls owner" on public.tool_calls
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));


-- ---------------------------------------------------------------------------
-- daily_completions: completions per user per day, bucketed in IST.
-- security_invoker = true keeps the completions RLS policy in force.
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

-- ---------------------------------------------------------------------------
-- Default weekly targets for every existing user. Re-runnable: existing rows
-- (including user edits) are never overwritten.
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

-- Ask PostgREST (the Supabase API layer) to reload its schema cache.
notify pgrst, 'reload schema';

