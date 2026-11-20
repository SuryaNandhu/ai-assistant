-- 010: job search is counted, not timed, and the reading tracker gets a table.
--
-- Apply once in the Supabase dashboard: SQL Editor -> paste this file -> Run.
-- Re-runnable: `drop not null` is harmless when the column is already nullable,
-- and every table/index/policy is created only when missing. Nothing is deleted.
--
-- completions.minutes  a job-search row stores the count in `quantity` and
--                      leaves minutes NULL, so the column may no longer be
--                      required. Every other goal still writes minutes.
-- books                one row per book. A partial unique index allows at most
--                      one `reading` row per user, which is the
--                      one-book-at-a-time rule enforced by the database.

begin;

-- ---------------------------------------------------------------------------
-- 1. completions: count-only rows have no minutes.
-- ---------------------------------------------------------------------------
alter table public.completions
  alter column minutes drop not null;

-- ---------------------------------------------------------------------------
-- 2. books: reading now, up next, finished.
-- ---------------------------------------------------------------------------
create table if not exists public.books (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null
    constraint books_title_check
    check (char_length(title) between 1 and 200),
  author text
    constraint books_author_check
    check (author is null or char_length(author) <= 120),
  status text not null default 'up_next'
    constraint books_status_check
    check (status in ('up_next', 'reading', 'finished', 'dropped')),
  total_pages integer
    constraint books_total_pages_check
    check (total_pages is null or total_pages between 1 and 20000),
  current_page integer not null default 0
    constraint books_current_page_check
    check (current_page >= 0),
  started_on date,
  finished_on date,
  rating smallint
    constraint books_rating_check
    check (rating is null or rating between 1 and 5),
  note text
    constraint books_note_check
    check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint books_current_page_within_total
    check (total_pages is null or current_page <= total_pages)
);

-- One book at a time: the second `reading` row cannot exist.
create unique index if not exists books_one_reading_idx
  on public.books (user_id)
  where status = 'reading';

create index if not exists books_user_status_idx
  on public.books (user_id, status, created_at desc);

alter table public.books enable row level security;

drop policy if exists "books owner" on public.books;
create policy "books owner" on public.books
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

commit;

-- Ask PostgREST (the Supabase API layer) to reload its schema cache.
notify pgrst, 'reload schema';
