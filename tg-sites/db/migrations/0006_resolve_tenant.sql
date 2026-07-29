-- Resolving a hostname to a tenant, which is a genuine chicken and egg.
--
-- Every policy in this database keys off current_tenant(). But a request
-- arrives knowing only a hostname, and the lookup that turns a hostname into
-- a tenant lives in `domains`, which is itself behind RLS keyed on the tenant
-- we do not have yet. Done naively that lookup returns nothing and every
-- request 404s.
--
-- The fix is one narrow SECURITY DEFINER function. It takes a hostname and
-- returns a single uuid. It cannot be persuaded to return a row, a list, or
-- anything about a tenant beyond "this hostname belongs to it", which the
-- public DNS already says out loud.
--
-- The alternative, leaving `domains` unprotected, would have exposed every
-- client's hostnames, SSL state and Cloudflare ids to anything that could
-- reach the table. This is the smaller hole by a wide margin.

-- ---------------------------------------------------------------------------
-- The staging subdomain is reserved
-- ---------------------------------------------------------------------------

-- Without this, tenant B could register `alpha.tgsites.io` as a custom domain
-- while tenant A holds the slug `alpha`, and the resolver would have two
-- honest answers for one hostname. Refused at the write, which is the only
-- place it can be refused reliably.
alter table public.domains drop constraint if exists domains_no_staging_suffix;
alter table public.domains add constraint domains_no_staging_suffix
  check (hostname not like '%.tgsites.io');

-- ---------------------------------------------------------------------------
-- resolve_tenant
-- ---------------------------------------------------------------------------

create or replace function public.resolve_tenant(host text)
returns uuid
language sql
stable
-- Runs as the owner, so it can see past RLS. This is the ONLY function in the
-- database allowed to do that, and the review question for any future one is
-- "could this return more than a single id".
security definer
-- Empty search path. Without it, a caller could plant their own `domains` in
-- a schema earlier on the path and have this function read that instead.
set search_path = ''
as $$
  select tenant_id from (
    -- A custom domain, checked first.
    select d.tenant_id, 1 as rank
    from public.domains d
    join public.tenants t on t.id = d.tenant_id
    where d.hostname = lower(trim(host))
      and t.status = 'active'
    union all
    -- The staging subdomain every tenant always has, so a site is reachable
    -- before anyone points DNS at it.
    select t.id, 2
    from public.tenants t
    where t.status = 'active'
      and lower(trim(host)) = t.slug || '.tgsites.io'
  ) m
  order by rank
  limit 1
$$;

comment on function public.resolve_tenant(text) is
  'Hostname to tenant id, or NULL. The only function here that sees past RLS.';

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

-- Postgres grants EXECUTE on new functions to PUBLIC by default, which would
-- hand this to anon over PostgREST. Revoked before it is granted to anyone.
revoke all on function public.resolve_tenant(text) from public, anon, authenticated;

grant execute on function public.resolve_tenant(text)
  to tg_sites_app, tg_sites_renderer;

-- Same default applies to every function added later.
alter default privileges in schema public
  revoke all on functions from public, anon, authenticated;
