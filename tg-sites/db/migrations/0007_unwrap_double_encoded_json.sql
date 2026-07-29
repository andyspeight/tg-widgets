-- Repair jsonb columns that were written double encoded.
--
-- WHAT HAPPENED
--
-- The application wrote jsonb as `${JSON.stringify(value)}::jsonb`. The
-- driver serialised that JS string to JSON, and the cast then read it back,
-- so what landed was a JSON *string* containing JSON rather than an object.
-- `jsonb_typeof` said 'string' where it should have said 'object'.
--
-- Two consequences, one loud and one not:
--   - Reading `seo` threw, which is how it was noticed.
--   - Reading `draft_content` did NOT throw. The mapping layer skipped
--     anything that was not already an object, so a saved page came back
--     empty and the content looked lost.
--
-- The writes use the driver's json() helper now, so nothing new arrives in
-- this shape. This unwraps what is already here.
--
-- Safe to re-run: rows that are already objects are left alone.

update public.pages set
  seo = case when jsonb_typeof(seo) = 'string'
             then (seo #>> '{}')::jsonb else seo end,
  draft_content = case when jsonb_typeof(draft_content) = 'string'
             then (draft_content #>> '{}')::jsonb else draft_content end,
  published_content = case when jsonb_typeof(published_content) = 'string'
             then (published_content #>> '{}')::jsonb else published_content end
where jsonb_typeof(seo) = 'string'
   or jsonb_typeof(draft_content) = 'string'
   or jsonb_typeof(published_content) = 'string';

update public.publish_events set
  snapshot = (snapshot #>> '{}')::jsonb
where jsonb_typeof(snapshot) = 'string';

-- Everything should read 'object' now, or be null.
select
  count(*) filter (where jsonb_typeof(seo) <> 'object')                       as bad_seo,
  count(*) filter (where draft_content is not null
                     and jsonb_typeof(draft_content) <> 'object')             as bad_draft,
  count(*) filter (where published_content is not null
                     and jsonb_typeof(published_content) <> 'object')         as bad_published
from public.pages;
