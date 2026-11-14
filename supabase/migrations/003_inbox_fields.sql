-- 003: inbox fields (additive).
--
-- Apply once in the Supabase dashboard: SQL Editor -> paste this file -> Run.
-- Safe to run once (and re-runnable): it only adds columns, never drops or
-- rewrites a table, column, row or index.
--
-- items.source_domain  host shown in the inbox ("youtube.com")
-- items.summary        on-demand summary text (null until summarised)
-- items.takeaway       one-line note written when an article/video is finished
-- items.summarized_at  when the summary was generated (also drives the rate limit)
-- items.added_via      how the link arrived: 'manual' | 'share' | 'api'

begin;

alter table public.items
  add column if not exists source_domain text,
  add column if not exists summary text,
  add column if not exists takeaway text,
  add column if not exists summarized_at timestamptz,
  add column if not exists added_via text default 'manual';

-- Tell PostgREST (the Supabase API layer) to pick up the new columns.
notify pgrst, 'reload schema';

commit;
