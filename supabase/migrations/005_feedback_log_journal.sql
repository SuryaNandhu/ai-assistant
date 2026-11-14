-- 005: suggestion feedback, manual logs and the daily journal (additive).
--
-- Apply once in the Supabase dashboard: SQL Editor -> paste this file -> Run.
-- Re-runnable and additive: it only creates tables, adds columns and indexes.
-- No row, column or table is ever dropped or rewritten.
--
-- suggestions.*  what the picker offered, and what came of it (the learning
--                signal: done / skipped + reason / liked / actual minutes)
-- completions.source  'suggestion' (from Home) | 'manual' (quick log, Saved)
-- completions.note    optional one-liner typed with a manual log
-- journal_entries     one small daily entry per user per IST day

begin;

-- ---------------------------------------------------------------------------
-- 1. suggestions: one row per task the picker surfaced.
--    'pending' rows older than 12 hours are read as 'ignored' (no cron needed).
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

-- Recent suggestions per user drive the preference model and the calibration.
create index if not exists suggestions_user_shown_idx
  on public.suggestions (user_id, shown_at desc);

create index if not exists suggestions_user_outcome_idx
  on public.suggestions (user_id, outcome, shown_at desc);

alter table public.suggestions enable row level security;

drop policy if exists "suggestions owner" on public.suggestions;
create policy "suggestions owner" on public.suggestions
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 2. completions: where a logged thing came from, and the quick-log note.
--    Existing rows keep 'suggestion', which is what they were.
-- ---------------------------------------------------------------------------
alter table public.completions
  add column if not exists source text not null default 'suggestion'
    constraint completions_source_check
    check (source in ('suggestion', 'manual')),
  add column if not exists note text;

-- ---------------------------------------------------------------------------
-- 3. journal_entries: one mood + one line per IST day, editable that day.
--    The text is private to the app UI and is never sent to the LLM.
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

alter table public.journal_entries enable row level security;

drop policy if exists "journal_entries owner" on public.journal_entries;
create policy "journal_entries owner" on public.journal_entries
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Tell PostgREST (the Supabase API layer) to pick up the new schema.
notify pgrst, 'reload schema';

commit;
