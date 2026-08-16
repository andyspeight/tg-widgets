-- ---------------------------------------------------------------------------
-- 0020: a scheduled post stays hidden until its moment
--
-- WHAT THIS ADDS. Scheduled publishing: a client sets a post to go live at a
-- future time, and it must not appear until then. The go-live time is
-- published_at, which an ordinary publish already sets to now() and scheduling
-- sets to the future (see scheduleItem in lib/db/collections.ts). So the only
-- thing missing is a public read that respects it.
--
-- THE GATE LIVES IN THE POLICY, not in a WHERE clause, for the reason the whole
-- of lib/db/collections.ts is written the way it is: the renderer role already
-- cannot see a draft because this policy forbids it, and every public read leans
-- on that so none has to remember. A future-dated post is the same shape of
-- secret as a draft, so it belongs in the same place. The listing, the single
-- post, the tag archive and the sitemap are all gated at once, and a read added
-- tomorrow cannot forget.
--
-- TIGHTENING ONLY, so it is safe on the live table. Every post published before
-- today has published_at in the past, so `published_at <= now()` is true for all
-- of them and none disappears. It can only ever hide a post dated in the future,
-- which is exactly a scheduled one.
--
-- now() is transaction start time in Postgres, so a read taken after the moment
-- has passed sees the post and one taken before does not, with nothing to run in
-- between. No cron, no flip, no window.
--
-- Safe to run more than once, like every migration here.
-- ---------------------------------------------------------------------------

drop policy if exists collection_items_renderer on public.collection_items;
create policy collection_items_renderer on public.collection_items
  for select to tg_sites_renderer
  using (
    tenant_id = public.current_tenant()
    and status = 'published'
    and published_at is not null
    and published_at <= now()
  );
