-- Tenants, their domains, and who may edit them.
--
-- Every table below carries tenant_id and has row level security on, with
-- FORCE so the table owner is subject to it too. The only thing that can see
-- across tenants is a role holding BYPASSRLS, which neither application role
-- has.

-- ---------------------------------------------------------------------------
-- tenants
-- ---------------------------------------------------------------------------

create table if not exists public.tenants (
  id          uuid primary key default gen_random_uuid(),
  -- The staging subdomain: {slug}.tgsites.io. Always available alongside any
  -- custom domain, so a site is reachable before its DNS is pointed.
  slug        text not null unique
              check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 2 and 63),
  name        text not null check (length(name) between 1 and 200),
  plan        text not null default 'spark'
              check (plan in ('spark', 'boost', 'ignite', 'bespoke')),
  status      text not null default 'active'
              check (status in ('active', 'suspended', 'archived')),
  -- The theme token set. Not CSS: colour, type, shape and motion choices the
  -- section components consume.
  theme       jsonb not null default '{}'::jsonb,
  settings    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- domains
-- ---------------------------------------------------------------------------

create table if not exists public.domains (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  -- Globally unique, not unique per tenant. A hostname resolves to exactly
  -- one tenant or the request is refused, and that is what stops one client
  -- claiming another's domain.
  hostname      text not null unique check (hostname = lower(hostname)),
  is_primary    boolean not null default false,
  cf_hostname_id text,
  ssl_status    text not null default 'pending'
                check (ssl_status in ('pending', 'active', 'failed', 'deleted')),
  verified_at   timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists domains_tenant_idx on public.domains (tenant_id);

-- One primary per tenant, enforced by the database rather than by hoping.
create unique index if not exists domains_one_primary
  on public.domains (tenant_id) where is_primary;

-- ---------------------------------------------------------------------------
-- tenant_users
-- ---------------------------------------------------------------------------

create table if not exists public.tenant_users (
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  -- The subject from id.travelify.io. Text, not a foreign key: the identity
  -- provider owns users, this database only records who may edit what.
  user_id    text not null check (length(user_id) between 1 and 255),
  role       text not null default 'editor' check (role in ('owner', 'editor', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

create index if not exists tenant_users_user_idx on public.tenant_users (user_id);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.tenants      enable row level security;
alter table public.domains      enable row level security;
alter table public.tenant_users enable row level security;

alter table public.tenants      force row level security;
alter table public.domains      force row level security;
alter table public.tenant_users force row level security;

-- The tenants row itself is keyed on id rather than tenant_id.
create policy tenants_app on public.tenants
  for all to tg_sites_app
  using (id = public.current_tenant())
  with check (id = public.current_tenant());

create policy tenants_renderer on public.tenants
  for select to tg_sites_renderer
  using (id = public.current_tenant() and status = 'active');

create policy domains_app on public.domains
  for all to tg_sites_app
  using (tenant_id = public.current_tenant())
  with check (tenant_id = public.current_tenant());

create policy domains_renderer on public.domains
  for select to tg_sites_renderer
  using (tenant_id = public.current_tenant());

create policy tenant_users_app on public.tenant_users
  for all to tg_sites_app
  using (tenant_id = public.current_tenant())
  with check (tenant_id = public.current_tenant());

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

-- Supabase grants public-schema tables to anon and authenticated by default,
-- which would expose all of this over PostgREST. RLS would return nothing,
-- but a table nobody should reach is better than a table that returns
-- nothing. Revoked outright.
revoke all on public.tenants, public.domains, public.tenant_users
  from public, anon, authenticated;

grant select, insert, update, delete
  on public.tenants, public.domains, public.tenant_users
  to tg_sites_app;

grant select on public.tenants, public.domains to tg_sites_renderer;
