-- ---------------------------------------------------------------------------
-- 0016  The header and the footer
-- ---------------------------------------------------------------------------
--
-- Until now a site was a bag of pages and nothing else. No header, no footer,
-- no navigation anywhere in the model, which meant a client with five pages
-- had to rebuild the nav bar as a section on all five and keep them in step by
-- hand. This is the table that ends that.
--
-- WHY IT LOOKS SO MUCH LIKE `pages`
--
-- Because a header IS a page, structurally: sections, rows, columns, blocks.
-- Making it the same shape is what lets the same renderer draw it, the same
-- editor edit it and every block that works on a page work in it too. The only
-- things a page has that a region does not are a slug, a title, a parent and
-- SEO, none of which mean anything for furniture that appears on every page.
--
-- THE DRAFT AND PUBLISHED SPLIT IS NOT OPTIONAL HERE, IT IS THE POINT
--
-- A page is one URL. A header is EVERY url. Editing one without a draft would
-- mean a half-finished nav bar going live on the whole site the moment somebody
-- typed into it, which is a far worse accident than the same mistake on one
-- page. So the same two columns as `pages`, and the same rule: published_content
-- NULL means never published, which is how the renderer tells that apart from
-- published and deliberately empty.
--
-- WHY THERE IS NO `status` COLUMN
--
-- `pages` has one because a page can exist and be withdrawn. A header cannot be
-- withdrawn, only emptied, and a header with no sections already renders
-- nothing. A second way to say the same thing would be a state somebody has to
-- keep in their head for no benefit.
--
-- WHY THE PRIMARY KEY IS (tenant_id, region) AND THERE IS NO id
--
-- A tenant has exactly one header and exactly one footer. Said in the primary
-- key it is a database guarantee; said in application code it is a hope. It
-- also makes the upsert in lib/db/regions.ts a plain ON CONFLICT with nothing
-- to look up first.
--
-- Safe to re-run.

create table if not exists public.site_regions (
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  region            text not null check (region in ('header', 'footer')),
  draft_content     jsonb not null default '{"version":1,"sections":[]}'::jsonb,
  -- NULL until it has been published once. See the note above.
  published_content jsonb,
  published_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  updated_by        text,
  primary key (tenant_id, region)
);

-- ---------------------------------------------------------------------------
-- Keep updated_at honest
-- ---------------------------------------------------------------------------

-- The same trigger function 0003 created. Re-used rather than re-declared, so
-- there is one definition of "touch" in the database.
drop trigger if exists site_regions_touch on public.site_regions;
create trigger site_regions_touch before update on public.site_regions
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.site_regions enable row level security;
alter table public.site_regions force row level security;

create policy site_regions_app on public.site_regions
  for all to tg_sites_app
  using (tenant_id = public.current_tenant())
  with check (tenant_id = public.current_tenant());

create policy site_regions_renderer on public.site_regions
  for select to tg_sites_renderer
  using (tenant_id = public.current_tenant());

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on public.site_regions from public, anon, authenticated;

grant select, insert, update, delete on public.site_regions to tg_sites_app;

-- THE RENDERER IS NOT GRANTED draft_content, AND THAT IS THE WHOLE CONTROL.
--
-- `pages` keeps drafts away from the public role with a row policy, because a
-- draft page is a whole row. Here the draft and the live copy are two columns of
-- the SAME row, so a row policy has nothing to bite on and the equivalent
-- guarantee has to be a column grant. A renderer that somehow asked for
-- draft_content gets a permission error from Postgres rather than an unfinished
-- header on a live site.
--
-- Column grants are per column, so a column added later is NOT granted by this
-- and has to be named deliberately. That is the right way round.
grant select (tenant_id, region, published_content, published_at)
  on public.site_regions to tg_sites_renderer;
