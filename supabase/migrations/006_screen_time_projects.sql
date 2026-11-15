-- 006: screen time, the monthly project tracker and resume drafts (additive).
--
-- Apply once in the Supabase dashboard: SQL Editor -> paste this file -> Run.
-- Re-runnable and additive: it only creates tables, adds columns and indexes.
-- No row, column or table is ever dropped or rewritten.
--
-- screen_time_entries  one minutes-per-day row per user (IST day key), so the
--                      journal card, the day panel and /progress agree
-- user_settings        one row per user; currently holds screen_limit_minutes
-- projects.*           description, repo link, resume draft and ship date
-- project_milestones   a short checklist per monthly project
-- resume_drafts        every draft run, which also enforces 10 runs / 24 h
-- tool_calls           one row per chat tool the assistant runs (audit trail)

begin;

-- ---------------------------------------------------------------------------
-- 1. screen_time_entries: one row per user per IST day.
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

alter table public.screen_time_entries enable row level security;

drop policy if exists "screen_time_entries owner" on public.screen_time_entries;
create policy "screen_time_entries owner" on public.screen_time_entries
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 2. user_settings: one row per user. The daily limit defaults to 2 hours.
-- ---------------------------------------------------------------------------
create table if not exists public.user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  screen_limit_minutes integer not null default 120
    constraint user_settings_screen_limit_check
    check (screen_limit_minutes between 0 and 1440),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_settings enable row level security;

drop policy if exists "user_settings owner" on public.user_settings;
create policy "user_settings owner" on public.user_settings
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 3. projects: the detail the monthly tracker and the resume draft need.
-- ---------------------------------------------------------------------------
alter table public.projects
  add column if not exists description text,
  add column if not exists repo_url text,
  add column if not exists resume_draft text,
  add column if not exists resume_drafted_at timestamptz,
  add column if not exists shipped_at timestamptz;

-- ---------------------------------------------------------------------------
-- 4. project_milestones: a short ordered checklist per project.
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

alter table public.project_milestones enable row level security;

drop policy if exists "project_milestones owner" on public.project_milestones;
create policy "project_milestones owner" on public.project_milestones
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 5. resume_drafts: one row per draft attempt, so the limit can be enforced
--    by counting the last 24 hours (a failed attempt counts too).
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

alter table public.resume_drafts enable row level security;

drop policy if exists "resume_drafts owner" on public.resume_drafts;
create policy "resume_drafts owner" on public.resume_drafts
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 6. tool_calls: the chat tools write to my data, so keep a receipt per call.
--    Already in schema.sql; repeated here so this file stands on its own.
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

alter table public.tool_calls enable row level security;

drop policy if exists "tool_calls owner" on public.tool_calls;
create policy "tool_calls owner" on public.tool_calls
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Tell PostgREST (the Supabase API layer) to pick up the new schema.
notify pgrst, 'reload schema';

commit;
