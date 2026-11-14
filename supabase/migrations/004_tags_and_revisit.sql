-- 004: tags and "revisit later" (additive).
--
-- Apply once in the Supabase dashboard: SQL Editor -> paste this file -> Run.
-- Re-runnable and additive: it only adds columns and an index. No row, column
-- or table is ever dropped or rewritten.
--
-- items.revisit_at  when a deferred link should come back (null = right away)
-- items.tags        short topic tags, lowercase ('react', 'system-design')

begin;

alter table public.items
  add column if not exists revisit_at timestamptz,
  add column if not exists tags text[] not null default '{}';

-- Tag filtering ("show me everything tagged 'react'").
create index if not exists items_tags_idx
  on public.items using gin (tags);

-- Tell PostgREST (the Supabase API layer) to pick up the new columns.
notify pgrst, 'reload schema';

commit;
