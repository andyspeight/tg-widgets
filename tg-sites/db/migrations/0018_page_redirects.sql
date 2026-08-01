-- ---------------------------------------------------------------------------
-- 0018  Old addresses keep working
-- ---------------------------------------------------------------------------
--
-- THE BUG THIS FIXES, WHICH IS A REAL ONE AND HAS BEEN THERE SINCE 0003.
--
-- A page's public address is its slug plus its parents' slugs. Rename /about to
-- /about-us and the old address resolves to nothing: getPublishedPage walks the
-- path a segment at a time, finds no row for 'about', and returns a 404. Every
-- link anybody ever made to that page, every search result, every mention in an
-- AI answer, is now broken, and whatever standing the page had earned goes with
-- it. Nothing warned anybody, because from the inside it looks like the page is
-- still there.
--
-- Re-parenting is worse, because it moves a whole subtree at once. Dragging
-- /greece under /destinations changes the address of every page beneath it.
--
-- WHY IT POINTS AT A PAGE AND NOT AT AN ADDRESS
--
-- The obvious column is `to_path`, and it is wrong. Rename /about to /about-us
-- and then to /who-we-are, and a to_path row still sends people to /about-us,
-- which now 404s: the redirect outlives the thing it was pointing at. Following
-- a chain of them is worse still, because a rename back the other way makes the
-- chain a loop.
--
-- Storing the PAGE means the target is worked out fresh on every request from
-- where that page actually lives now. Two renames leave two rows, both correct,
-- neither chained. A page that is later unpublished simply stops resolving,
-- which is the honest answer, and starts again if it is published back.
--
-- WHY THERE IS NO to_path COLUMN TO CACHE IT EITHER
--
-- Because the cache would have to be invalidated by every rename of every
-- ancestor, and a stale row here sends a visitor to a 404 while looking healthy.
-- The lookup is one indexed read plus one small select, on a request that was
-- already going to be a 404. That is the cheapest request on the site.
--
-- ON DELETE CASCADE FROM pages, deliberately. A deleted page has no address to
-- forward to, so its redirects are dead the moment it goes. Keeping them would
-- mean a row that resolves to nothing, which is a 404 with extra steps.
--
-- Safe to re-run.

create table if not exists public.page_redirects (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,

  -- The address somebody may have linked to, exactly as getPublishedPage would
  -- receive it: no leading slash, no trailing slash, '' is the home page.
  from_path  text not null,

  -- The page it leads to. See the note above about why this is not a path.
  page_id    uuid not null references public.pages(id) on delete cascade,

  created_at timestamptz not null default now(),

  -- One answer per address. An address that forwarded to two places would be a
  -- coin toss, and the newest claim is the one that wins: see the ON CONFLICT in
  -- lib/db/redirects.ts.
  unique (tenant_id, from_path)
);

-- The lookup a 404 makes. tenant_id is first because every query is scoped to
-- one, and the unique constraint above already indexes (tenant_id, from_path).
create index if not exists page_redirects_page
  on public.page_redirects (tenant_id, page_id);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.page_redirects enable row level security;
alter table public.page_redirects force row level security;

-- Dropped first, because db/README.md promises every migration here is
-- idempotent and a bare CREATE POLICY raises duplicate_object on a second run.
drop policy if exists page_redirects_app on public.page_redirects;
drop policy if exists page_redirects_renderer on public.page_redirects;

create policy page_redirects_app on public.page_redirects
  for all to tg_sites_app
  using (tenant_id = public.current_tenant())
  with check (tenant_id = public.current_tenant());

-- THE RENDERER READS THESE, WHICH IS UNLIKE ANYTHING ELSE IT READS.
--
-- Everywhere else the renderer is held to published rows only, because a draft
-- is content nobody outside the agency should see. A redirect is not content: it
-- is a fact about an address, and it holds no words, no pictures and nothing a
-- competitor could learn from. What it does is decide whether a visitor gets the
-- page or a 404, so the renderer has to be able to see it.
--
-- The page it points AT is still subject to pages_renderer, so a redirect to an
-- unpublished page resolves to nothing at all. The gate did not move.
create policy page_redirects_renderer on public.page_redirects
  for select to tg_sites_renderer
  using (tenant_id = public.current_tenant());

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on public.page_redirects from public, anon, authenticated;

grant select, insert, update, delete on public.page_redirects to tg_sites_app;
grant select on public.page_redirects to tg_sites_renderer;
