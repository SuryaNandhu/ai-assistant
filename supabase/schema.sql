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
  revisit_at timestamptz,
  tags text[] not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists items_user_status_idx
  on public.items (user_id, status, created_at desc);

create index if not exists items_tags_idx
  on public.items using gin (tags);

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
  source text not null default 'suggestion'
    constraint completions_source_check
    check (source in ('suggestion', 'manual')),
  note text,
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
  description text,
  repo_url text,
  status text not null default 'planned' check (status in ('planned', 'in_progress', 'shipped', 'dropped')),
  resume_draft text,
  resume_drafted_at timestamptz,
  shipped_at timestamptz,
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
-- project_milestones: a short ordered checklist per monthly project
-- ---------------------------------------------------------------------------
create table if not exists public.project_milestones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  title text not null
    constraint project_milestones_title_check
    check (char_length(title) between 1 and 160),
  position integer not null default 0
    constraint project_milestones_position_check
    check (position >= 0),
  done boolean not null default false,
  done_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists project_milestones_project_idx
  on public.project_milestones (project_id, position, created_at);

-- ---------------------------------------------------------------------------
-- resume_drafts: one row per draft attempt (also the 10-per-24-hours limit)
-- ---------------------------------------------------------------------------
create table if not exists public.resume_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  ok boolean not null default true,
  draft text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists resume_drafts_user_created_idx
  on public.resume_drafts (user_id, created_at desc);

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
-- suggestions: one row per task the picker surfaced, plus what came of it.
-- 'pending' rows older than 12 hours are read as 'ignored' (no cron needed).
-- ---------------------------------------------------------------------------
create table if not exists public.suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  item_id uuid references public.items (id) on delete set null,
  title text,
  goal text,
  type text,
  tags text[] not null default '{}',
  shown_at timestamptz not null default now(),
  time_available integer
    constraint suggestions_time_available_check
    check (time_available is null or time_available >= 0),
  energy text,
  mode text
    constraint suggestions_mode_check
    check (mode is null or mode in ('what_now', 'surprise')),
  outcome text not null default 'pending'
    constraint suggestions_outcome_check
    check (outcome in ('pending', 'done', 'skipped', 'ignored')),
  skip_reason text
    constraint suggestions_skip_reason_check
    check (skip_reason is null or skip_reason in ('not_now', 'too_long', 'not_interested', 'too_hard')),
  felt text
    constraint suggestions_felt_check
    check (felt is null or felt in ('easy', 'right', 'hard')),
  liked boolean,
  actual_minutes integer
    constraint suggestions_actual_minutes_check
    check (actual_minutes is null or actual_minutes >= 0),
  meta jsonb
);

create index if not exists suggestions_user_shown_idx
  on public.suggestions (user_id, shown_at desc);

create index if not exists suggestions_user_outcome_idx
  on public.suggestions (user_id, outcome, shown_at desc);

-- ---------------------------------------------------------------------------
-- journal_entries: one mood + one line per IST day, editable that day.
-- Private to the app UI; the text is never sent to the LLM.
-- ---------------------------------------------------------------------------
create table if not exists public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  mood smallint
    constraint journal_entries_mood_check
    check (mood is null or mood between 1 and 5),
  note text
    constraint journal_entries_note_check
    check (note is null or char_length(note) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, day)
);

create index if not exists journal_entries_user_day_idx
  on public.journal_entries (user_id, day desc);

-- ---------------------------------------------------------------------------
-- screen_time_entries: one minutes-per-day row per user (IST day key)
-- ---------------------------------------------------------------------------
create table if not exists public.screen_time_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  minutes integer not null
    constraint screen_time_entries_minutes_check
    check (minutes between 0 and 1440),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, day)
);

create index if not exists screen_time_entries_user_day_idx
  on public.screen_time_entries (user_id, day desc);

-- ---------------------------------------------------------------------------
-- user_settings: one row per user; currently the daily screen-time limit
-- ---------------------------------------------------------------------------
create table if not exists public.user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  screen_limit_minutes integer not null default 120
    constraint user_settings_screen_limit_check
    check (screen_limit_minutes between 0 and 1440),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);


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
alter table public.suggestions enable row level security;
alter table public.journal_entries enable row level security;
alter table public.project_milestones enable row level security;
alter table public.resume_drafts enable row level security;
alter table public.screen_time_entries enable row level security;
alter table public.user_settings enable row level security;

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

drop policy if exists "suggestions owner" on public.suggestions;
create policy "suggestions owner" on public.suggestions
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "journal_entries owner" on public.journal_entries;
create policy "journal_entries owner" on public.journal_entries
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "project_milestones owner" on public.project_milestones;
create policy "project_milestones owner" on public.project_milestones
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "resume_drafts owner" on public.resume_drafts;
create policy "resume_drafts owner" on public.resume_drafts
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "screen_time_entries owner" on public.screen_time_entries;
create policy "screen_time_entries owner" on public.screen_time_entries
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "user_settings owner" on public.user_settings;
create policy "user_settings owner" on public.user_settings
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

