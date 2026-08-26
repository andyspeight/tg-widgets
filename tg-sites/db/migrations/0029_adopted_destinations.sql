-- ---------------------------------------------------------------------------
-- 0029  Adopted destinations
-- ---------------------------------------------------------------------------
--
-- WHAT ADOPTION IS. A client picks a destination out of the shared corpus and
-- it becomes an ordinary collection item on their site: their words, their
-- pictures, their layout. What it also carries is a pointer back to the corpus
-- record it came from, and that pointer is what these two columns are.
--
-- WHY A POINTER RATHER THAN A COPY OF THE FACTS. Both were on the table. A copy
-- would mean every corpus change needs a pass over every adopted item on every
-- site, and until that pass runs the two disagree with nothing recording which
-- is right. A pointer has one copy of every fact, so a visa rule that changes
-- is live everywhere the moment the sync writes it, and drift is not possible
-- because there is nowhere for it to drift to.
--
-- The join is safe to make: reference_records is deliberately not tenant scoped
-- (see 0028) and tg_sites_renderer already holds select on it, so a published
-- page can read its own facts without a second connection.
--
-- WHY THE FACTS ARE NOT IN `data`. This is the important one, and it was found
-- by testing rather than reasoning. `data` is the blob the CLIENT writes when
-- they edit their prose, and it is parsed through CollectionItemSchema on the
-- way in. That schema is a plain zod object, so it STRIPS keys it does not know
-- about. A facts payload living in there would have been deleted, silently, the
-- first time somebody fixed a typo in their own copy. One blob with two writers
-- is how the four earlier double-encode failures happened as well. So the
-- client writes `data` and the corpus owns these columns, and neither can reach
-- the other.
--
-- NO GRANTS HERE ON PURPOSE. collection_items was granted at TABLE level in
-- 0004 to both tg_sites_app and tg_sites_renderer, so columns added later are
-- covered already. Checked rather than assumed, because a missing renderer
-- grant is exactly the shape of the font bug: correct everywhere except on the
-- one path a client actually loads.
-- ---------------------------------------------------------------------------

alter table public.collection_items
  add column if not exists ref_kind      text,
  add column if not exists ref_source_id text;

-- Both or neither. A kind with no source id could never be matched to a corpus
-- row, and a source id with no kind cannot be looked up, since the corpus is
-- unique on the pair rather than on the id alone.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'collection_items_ref_pair'
  ) then
    alter table public.collection_items
      add constraint collection_items_ref_pair
      check ((ref_kind is null) = (ref_source_id is null));
  end if;
end $$;

-- A tenant adopts a given destination once. Adopting twice would give a client
-- two pages competing for the same searches, which is the thing the whole
-- prose-is-yours split exists to avoid.
create unique index if not exists collection_items_ref_once_per_tenant
  on public.collection_items (tenant_id, ref_kind, ref_source_id)
  where ref_source_id is not null;

-- For going the other way: given a corpus record, who has adopted it. Partial,
-- because the overwhelming majority of items are ordinary posts with no
-- pointer at all and there is no reason to carry them in this index.
create index if not exists collection_items_ref_lookup_idx
  on public.collection_items (ref_kind, ref_source_id)
  where ref_source_id is not null;
