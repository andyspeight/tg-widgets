-- Tables the platform needs but this work package does not fill.
--
-- Created now, empty, because the brief asked for the shape to be settled
-- early. More usefully: creating them now means their row level security is
-- written at the same time as everything else, by someone with the isolation
-- rules fresh in mind, rather than bolted on later by someone in a hurry to
-- ship the media library.

-- ---------------------------------------------------------------------------
-- media
-- ---------------------------------------------------------------------------

create table if not exists public.media (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  storage_key text not null,
  mime        text not null,
  bytes       integer not null check (bytes > 0),
  width       integer,
  height      integer,
  alt         text,
  created_at  timestamptz not null default now(),
  -- Storage keys are namespaced per tenant, so one client's media id can
  -- never resolve to another's file even if the id leaks.
  unique (tenant_id, storage_key)
);

create index if not exists media_tenant_idx on public.media (tenant_id);

-- ---------------------------------------------------------------------------
-- collections
-- ---------------------------------------------------------------------------

create table if not exists public.collections (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  key        text not null check (key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name       text not null,
  fields     jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (tenant_id, key)
);

create table if not exists public.collection_items (
  id            uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.collections(id) on delete cascade,
  -- Denormalised from the parent collection so RLS can be checked without a
  -- join. A policy that needs a join is a policy that gets slow and then
  -- gets relaxed.
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  slug          text not null,
  status        text not null default 'draft' check (status in ('draft', 'published')),
  data          jsonb not null default '{}'::jsonb,
  seo           jsonb not null default '{}'::jsonb,
  published_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (collection_id, slug)
);

create index if not exists collection_items_tenant_idx
  on public.collection_items (tenant_id);

-- ---------------------------------------------------------------------------
-- navigations
-- ---------------------------------------------------------------------------

create table if not exists public.navigations (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  location   text not null check (location in ('header', 'footer')),
  items      jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  unique (tenant_id, location)
);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.media            enable row level security;
alter table public.collections      enable row level security;
alter table public.collection_items enable row level security;
alter table public.navigations      enable row level security;

alter table public.media            force row level security;
alter table public.collections      force row level security;
alter table public.collection_items force row level security;
alter table public.navigations      force row level security;

create policy media_app on public.media
  for all to tg_sites_app
  using (tenant_id = public.current_tenant())
  with check (tenant_id = public.current_tenant());

create policy media_renderer on public.media
  for select to tg_sites_renderer
  using (tenant_id = public.current_tenant());

create policy collections_app on public.collections
  for all to tg_sites_app
  using (tenant_id = public.current_tenant())
  with check (tenant_id = public.current_tenant());

create policy collections_renderer on public.collections
  for select to tg_sites_renderer
  using (tenant_id = public.current_tenant());

create policy collection_items_app on public.collection_items
  for all to tg_sites_app
  using (tenant_id = public.current_tenant())
  with check (tenant_id = public.current_tenant());

create policy collection_items_renderer on public.collection_items
  for select to tg_sites_renderer
  using (tenant_id = public.current_tenant() and status = 'published');

create policy navigations_app on public.navigations
  for all to tg_sites_app
  using (tenant_id = public.current_tenant())
  with check (tenant_id = public.current_tenant());

create policy navigations_renderer on public.navigations
  for select to tg_sites_renderer
  using (tenant_id = public.current_tenant());

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on public.media, public.collections, public.collection_items,
  public.navigations from public, anon, authenticated;

grant select, insert, update, delete
  on public.media, public.collections, public.collection_items, public.navigations
  to tg_sites_app;

grant select
  on public.media, public.collections, public.collection_items, public.navigations
  to tg_sites_renderer;

-- Anything added to this schema later starts locked down rather than open.
alter default privileges in schema public
  revoke all on tables from public, anon, authenticated;
