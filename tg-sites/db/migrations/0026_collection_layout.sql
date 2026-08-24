-- ---------------------------------------------------------------------------
-- 0026  How a collection's entries are laid out
-- ---------------------------------------------------------------------------
--
-- A published entry has had exactly one look since the blog shipped: the date,
-- the title, the byline, the summary, the tags, then the picture. That is a
-- good article page and a poor product page, and a site with a Blog and a Tours
-- collection wants both.
--
-- WHY IT LIVES ON THE COLLECTION and not in site settings or on the entry. A
-- site setting would make a Blog and a Tours collection share one look, which
-- is the thing this exists to stop. Putting it on the entry would ask the
-- question again on every post and a blog would stop looking like one blog
-- within a fortnight. The collection is the unit that has one identity, the
-- same reason `fields` sits here.
--
-- A COLUMN RATHER THAN A KEY INSIDE `fields`. That column is a list of field
-- definitions and this is a single choice about the collection itself; folding
-- one into the other would mean every reader of the schema having to skip a
-- row that is not a field.
--
-- EMPTY MEANS THE LAYOUT EVERY SITE ALREADY HAS. The default is '' rather than
-- 'standard' so that nothing has to be backfilled and no published site moves
-- on deploy: lib/content/collection-layout.ts reads an unrecognised value, an
-- empty one included, as the standard layout. A value this database has never
-- heard of therefore degrades to the safe look rather than to a blank page,
-- which is the same rule parseTheme and parseFieldDefs follow.
--
-- NO POLICY CHANGES. `collections` already has its row level security from
-- 0004: the app role reads and writes its own tenant's rows, and the renderer
-- role may only read them. A new column on the table inherits both, which is
-- the whole reason column-level grants were never used here.

alter table public.collections
  add column if not exists layout text not null default '';

comment on column public.collections.layout is
  'How this collection''s published entries are laid out: standard, centred or '
  'hero. Empty means standard, so nothing needs backfilling. Parsed by '
  'lib/content/collection-layout.ts, which treats an unknown value as standard.';
