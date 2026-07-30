-- ---------------------------------------------------------------------------
-- 0014  One snapshot table, not two
-- ---------------------------------------------------------------------------
--
-- A CORRECTION TO 0012, AND IT IS MINE.
--
-- 0012 added page_versions "so a publish can be undone days later". publish_events
-- had already existed since 0003 for exactly that, was already written inside the
-- publish transaction by publishPage, was already read back by listPublishes, and
-- was already covered by tests. 0012 added a second table for the same job without
-- noticing the first, and nothing ever wrote to it.
--
-- Both were empty when this was found, because nothing had ever been published, so
-- this costs nothing today and would have cost a data migration once either table
-- had history in it.
--
-- WHICH ONE SURVIVES, AND WHY IT IS THE OLDER ONE
--
-- publish_events, because it has the code and the tests. page_versions had the
-- better SHAPE, carrying title and seo beside the content, and that turns out to be
-- three columns rather than a table. Renaming a table that working, tested code
-- depends on would buy a nicer noun and risk the path that works.
--
-- The name is defensible on its own terms: one row per publish event, holding the
-- content as it went live. A rollback reads the log. That is what an event log is.
--
-- IF YOU ARE HERE TO ADD A VERSIONS TABLE, DON'T. This is it.
--
-- Safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. One column, and NOT the two page_versions had
-- ---------------------------------------------------------------------------

/*
 * page_versions carried content, seo AND title, on the reasoning that a restore
 * putting the body back without the search title would be a restore that quietly
 * did half the job. That reasoning is right and the columns were still wrong,
 * because of something the top of lib/db/pages.ts says out loud: a page's id, slug,
 * title and SEO exist TWICE, as columns on `pages` and inside the content JSON.
 *
 * snapshot is a copy of draft_content, and draft_content is the whole Page object.
 * So the title and the SEO are already in there. Storing them again beside it would
 * be page_versions' mistake in miniature: a second copy with no reader, free to
 * disagree with the first.
 *
 * title survives that argument on different grounds. It is a PROJECTION, not a
 * second copy of the truth: listPublishes names each entry in the history list, and
 * without a column it would have to pull every snapshot blob out of the database to
 * read one string from each. The restore still takes the title from the snapshot.
 *
 * NULLABLE, deliberately. `not null` is achievable today because the table is empty,
 * and it would open an outage window: between this migration and the new application
 * code deploying, the CURRENT code is still inserting without a title, and every
 * publish in that gap would fail. A default of '' would accept those rows and record
 * a page called nothing, which is worse than a null because a null can be
 * recognised. Null means "written before 0014", and the restore reads the snapshot
 * anyway, so nothing depends on it.
 */
alter table public.publish_events add column if not exists title text;

-- Added and then dropped in the same change, recorded rather than hidden: see the
-- reasoning above. If it comes back, it needs a reader that the snapshot cannot serve.
alter table public.publish_events drop column if exists seo;

comment on column public.publish_events.snapshot is
  'The page content as it went live, the whole Page object including its title and '
  'SEO. Not a diff: a diff chain is only as good as its oldest link and cannot be '
  'read without replaying everything before it.';
comment on column public.publish_events.title is
  'The page title at publish time, a projection of the snapshot so the version list '
  'can name each entry without reading every snapshot blob. Null before 0014.';

-- ---------------------------------------------------------------------------
-- 2. page_versions goes
-- ---------------------------------------------------------------------------

-- Nothing reads it, nothing writes it, and it is empty. Left in place it is an
-- invitation to write the second half of this feature against the wrong table.
drop table if exists public.page_versions;

-- ---------------------------------------------------------------------------
-- 3. The renderer still gets nothing
-- ---------------------------------------------------------------------------

/*
 * Restated rather than assumed. 0003 granted the renderer nothing on this table and
 * that is load-bearing: a version history is what a page USED to say, including
 * prices that were changed for a reason, and the public site has no business
 * reading it. The new columns inherit the table's grants, so this is belt and
 * braces, and cheap.
 */
revoke all on public.publish_events from public, anon, authenticated, tg_sites_renderer;
grant select, insert, delete on public.publish_events to tg_sites_app;

-- DELETE is new, and it is for retention. lib/db/pages.ts prunes to the most recent
-- PUBLISH_HISTORY_LIMIT rows per page inside the publish transaction. There is
-- deliberately no UPDATE grant: a snapshot that can be edited is not a snapshot.

-- ---------------------------------------------------------------------------
-- 4. An index that matches how the list is actually read
-- ---------------------------------------------------------------------------

-- 0003 indexed (page_id, created_at desc), which serves the list. The prune needs
-- the same order, so it is already covered. Named here only so the next person does
-- not add a duplicate.
--   publish_events_page_idx on (page_id, created_at desc)
