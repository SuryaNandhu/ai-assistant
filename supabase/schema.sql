-- Personal AI assistant schema (Supabase / Postgres).
-- Apply in the Supabase dashboard: SQL Editor -> paste this file -> Run.
-- The script is re-runnable: tables and policies are created only when missing.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- items: saved videos, articles, practice problems and learning goals
-- ---------------------------------------------------------------------------
create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  type text not null check (type in ('video', 'article', 'leetcode', 'learn', 'job', 'other')),
  title text not null,
  url text,
  est_minutes integer check (est_minutes is null or est_minutes > 0),
  goal text check (goal in ('ai', 'coding', 'bi', 'job', 'other')),
  status text not null default 'todo' check (status in ('todo', 'done', 'dropped')),
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
  kind text not null check (kind in ('leetcode', 'study', 'project', 'other')),
  minutes integer check (minutes is null or minutes >= 0),
  felt text check (felt in ('easy', 'ok', 'hard')),
  completed_at timestamptz not null default now()
);

create index if not exists completions_user_completed_idx
  on public.completions (user_id, completed_at desc);

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


create index if not exists messages_user_created_idx
  on public.messages (user_id, created_at desc);
