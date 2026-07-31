-- ---------------------------------------------------------------------------
-- 0017: keep collection_items.updated_at honest
--
-- WHAT WAS WRONG. collection_items has had an `updated_at` column since 0004
-- and nothing has ever written to it. Nothing had to, because until 31 Jul 2026
-- nothing read or wrote the table at all. Now the collections screen does, and
-- it asks the same question the pages screen asks:
--
--   (published_at is null or updated_at > published_at) as has_unpublished_changes
--
-- Without a trigger, `updated_at` stays at the moment the row was inserted for
-- the rest of its life. So the sequence that matters would lie:
--
--   write a post          updated_at = T0, published_at = null   -> changes: yes
--   publish it            published_at = T1                      -> changes: no
--   edit it again         updated_at STILL T0                    -> changes: NO
--
-- That last one is the state an agent most needs to see: live, but what they
-- are looking at in the editor is not what a visitor is looking at. It would
-- have said "Live" and been wrong.
--
-- WHY A TRIGGER RATHER THAN `set updated_at = now()` IN THE SAVE. Because the
-- save is not the only write. Publish, unpublish and any future one would each
-- have to remember, and the one that forgets is silent. pages and tenants have
-- used this trigger since 0003 and media since 0011, for the same reason.
--
-- The trigger firing on publish is not a problem and is exactly what pages
-- does: now() is transaction start time in Postgres, so `updated_at` and
-- `published_at` come out equal in that statement, and `updated_at >
-- published_at` is false. Published, with nothing waiting. Correct.
--
-- Safe to run more than once, like every migration here.
-- ---------------------------------------------------------------------------

drop trigger if exists collection_items_touch on public.collection_items;
create trigger collection_items_touch before update on public.collection_items
  for each row execute function public.touch_updated_at();
