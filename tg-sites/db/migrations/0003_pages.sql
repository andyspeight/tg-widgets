-- Pages, and the audit trail of publishing them.

-- ---------------------------------------------------------------------------
-- pages
-- ---------------------------------------------------------------------------

create table if not exists public.pages (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  -- Nesting, for /destinations/greece. Deleting a parent orphans rather than
  -- cascades: losing a whole branch of a site because someone removed a
  -- landing page would be unforgivable.
  parent_id         uuid references public.pages(id) on delete set null,
  -- Empty string is the home page. Not null, so the unique indexes below
  -- behave predictably.
  slug              text not null default ''
                    check (slug ~ '^[a-z0-9]*(-[a-z0-9]+)*$' and length(slug) <= 120),
  title             text not null check (length(title) between 1 and 200),
  status            text not null default 'draft' check (status in ('draft', 'published')),
  seo               jsonb not null default '{}'::jsonb,
  -- What the editor is working on. Always present.
  draft_content     jsonb not null default '{"version":1,"sections":[]}'::jsonb,
  -- What a visitor sees. NULL until the page has been published once, which
  -- is exactly how the renderer tells "not published yet" from "published
  -- and empty".
  published_content jsonb,
  published_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  updated_by        text
);

create index if not exists pages_tenant_idx on public.pages (tenant_id);
create index if not exists pages_parent_idx on public.pages (parent_id);

-- Two partial indexes rather than one unique (tenant_id, parent_id, slug).
--
-- The obvious single constraint does not work: parent_id is NULL for every
-- top-level page, NULLs are never equal to each other in a unique index, so
-- a tenant could create ten different home pages and Postgres would allow
-- all of them. Splitting on whether parent_id is null fixes it.
create unique index if not exists pages_root_slug
  on public.pages (tenant_id, slug) where parent_id is null;

create unique index if not exists pages_child_slug
  on public.pages (tenant_id, parent_id, slug) where parent_id is not null;

-- The renderer looks pages up by tenant and path on every request.
create index if not exists pages_published_lookup
  on public.pages (tenant_id, slug) where status = 'published';

-- ---------------------------------------------------------------------------
-- publish_events
-- ---------------------------------------------------------------------------

-- One row per publish, holding the content as it was at that moment. This is
-- what makes rollback possible, and what answers "who changed the homepage on
-- Tuesday" without anyone having to guess.
create table if not exists public.publish_events (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  page_id    uuid not null references public.pages(id) on delete cascade,
  user_id    text,
  snapshot   jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists publish_events_page_idx
  on public.publish_events (page_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Keep updated_at honest
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end
$$;

drop trigger if exists pages_touch on public.pages;
create trigger pages_touch before update on public.pages
  for each row execute function public.touch_updated_at();

drop trigger if exists tenants_touch on public.tenants;
create trigger tenants_touch before update on public.tenants
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.pages          enable row level security;
alter table public.publish_events enable row level security;
alter table public.pages          force row level security;
alter table public.publish_events force row level security;

create policy pages_app on public.pages
  for all to tg_sites_app
  using (tenant_id = public.current_tenant())
  with check (tenant_id = public.current_tenant());

-- The renderer sees published pages and nothing else. Two conditions, both
-- required: the right tenant AND published. A draft is invisible to it even
-- with the correct tenant set, which is what stops an unpublished page
-- leaking onto a live domain.
create policy pages_renderer on public.pages
  for select to tg_sites_renderer
  using (tenant_id = public.current_tenant() and status = 'published');

create policy publish_events_app on public.publish_events
  for all to tg_sites_app
  using (tenant_id = public.current_tenant())
  with check (tenant_id = public.current_tenant());

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on public.pages, public.publish_events from public, anon, authenticated;

grant select, insert, update, delete on public.pages to tg_sites_app;
grant select, insert on public.publish_events to tg_sites_app;

-- Read only, and no grant at all on publish_events: the public renderer has
-- no business reading the edit history.
grant select on public.pages to tg_sites_renderer;
