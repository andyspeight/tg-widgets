-- Roles, and the one function every isolation policy depends on.
--
-- TWO ROLES, DELIBERATELY
--   tg_sites_app       the editor and its API. Reads and writes, RLS enforced.
--   tg_sites_renderer  the public site. Reads only, and only published rows.
--
-- Neither has BYPASSRLS. That matters more than anything else in this file:
-- a role with BYPASSRLS makes every policy below decorative.
--
-- Both are created without a password, so neither can authenticate yet.
-- Passwords are set out of band and never committed. See db/README.md.

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'tg_sites_app') then
    create role tg_sites_app login noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'tg_sites_renderer') then
    create role tg_sites_renderer login noinherit;
  end if;
end
$$;

-- Said explicitly rather than relied on. If a future migration or a hand
-- edit ever grants these, the policies stop working silently.
alter role tg_sites_app nobypassrls;
alter role tg_sites_renderer nobypassrls;

grant usage on schema public to tg_sites_app, tg_sites_renderer;

-- ---------------------------------------------------------------------------
-- The tenant of the current transaction
-- ---------------------------------------------------------------------------

-- Reads a transaction-local setting written by the application's withTenant
-- helper. Returns NULL when nothing has been set.
--
-- NULL is the whole safety story. Every policy compares tenant_id to this,
-- and `tenant_id = NULL` evaluates to NULL, which is not true, so a query
-- that forgets to set the tenant returns zero rows rather than everything.
-- Failing closed is not a happy accident here, it is the design.
create or replace function public.current_tenant()
returns uuid
language sql
stable
-- Empty search_path so the function cannot be hijacked by a caller planting
-- a different current_setting in an earlier schema.
set search_path = ''
as $$
  select nullif(current_setting('app.current_tenant_id', true), '')::uuid
$$;

comment on function public.current_tenant() is
  'The tenant for this transaction, or NULL. Every RLS policy keys off this.';

grant execute on function public.current_tenant() to tg_sites_app, tg_sites_renderer;
