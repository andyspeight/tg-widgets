-- ---------------------------------------------------------------------------
-- 0031  A collection item can be put where the client wants it
-- ---------------------------------------------------------------------------
--
-- WHY. Andy, 26 Aug 2026: "in the cards i can't see a way to reorder them".
-- Typed cards have always had up and down arrows per card. Collection cards are
-- a live query, so there was nothing to drag and nothing to drag it to.
--
-- The four intrinsic orders added alongside this (newest, oldest, A to Z, Z to
-- A) answer most of it and cannot answer the rest. An agency featuring a
-- destination wants Hvar first BECAUSE they decided so, and no rule derived
-- from a date or a title expresses that. Renaming a guide to move it up a grid
-- is the sort of thing people do when a product will not let them say what they
-- mean.
--
-- WHY A COLUMN AND NOT A LIST ON THE COLLECTION. An ordered array of item ids
-- on the parent row would need every writer to keep it in step: a new entry
-- appended, a deleted one spliced out, and a bug in either leaves items that
-- exist and cannot be ordered or ids that order nothing. A column on the row
-- cannot drift from the row it describes.
--
-- NULL IS A REAL STATE, not a missing value. It means "never placed by hand",
-- and the readers sort those last, so a collection nobody has arranged behaves
-- exactly as it did. Every existing item is backfilled below rather than left
-- null, so the first arrow press moves something rather than revealing that the
-- order was undefined all along.
--
-- NOT UNIQUE, on purpose. A unique constraint would make the ordinary swap
-- illegal halfway through unless it were deferrable, and the reader breaks ties
-- on the same date-then-id it always used, so duplicates degrade to the old
-- order rather than to an arbitrary one.
--
-- NO GRANTS HERE. collection_items was granted at TABLE level in 0004 to both
-- tg_sites_app and tg_sites_renderer, so a column added later is covered for
-- the editor that writes it and the renderer that reads it. Checked rather than
-- assumed, the same note 0029 and 0030 carry.
-- ---------------------------------------------------------------------------

alter table public.collection_items
  add column if not exists position int;

-- ---------------------------------------------------------------------------
-- Backfill: the order they are already in.
-- ---------------------------------------------------------------------------
--
-- Deliberately the order the DASHBOARD shows, coalesce(published_at,
-- updated_at) desc, rather than the order the published page shows. This column
-- is arranged on the collections screen, so the numbering has to match the list
-- somebody is looking at when they first press an arrow. If it matched the
-- other one, the first press would appear to move the wrong row.

with placed as (
  select
    id,
    row_number() over (
      partition by collection_id
      order by coalesce(published_at, updated_at) desc, id desc
    ) as seat
  from public.collection_items
)
update public.collection_items i
set position = placed.seat
from placed
where placed.id = i.id
  and i.position is null;

-- Reading a collection in hand-set order, which is the only new access pattern.
-- Partial on nothing, because unlike the reference pointers in 0029 every item
-- carries a position once the backfill above has run.
create index if not exists collection_items_position_idx
  on public.collection_items (collection_id, position);
