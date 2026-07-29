-- Tenant isolation, proven rather than assumed.
--
-- Seeds two tenants, tries every way one could reach the other's data,
-- reports a pass or fail per check, and removes its own fixtures.
--
--   psql "$DATABASE_URL" -f db/isolation-check.sql
--
-- Or paste it into the Supabase SQL editor. Any FAIL row is a ship-blocker.
--
-- THREE TRAPS, ALL OF WHICH CAUGHT ME WRITING THIS
--
-- 1. Catching an exception in PL/pgSQL rolls back that block's
--    subtransaction, which silently undoes any SET LOCAL made inside it. Set
--    the role OUTSIDE the exception block, or the remaining checks quietly
--    run as the admin role, which bypasses RLS, and everything passes while
--    proving nothing.
--
-- 2. set_config with a local flag lasts for the whole TRANSACTION, not for
--    one block. A later block testing "no tenant set" is still holding the
--    tenant an earlier block set. It has to clear the value explicitly, or
--    the single most important check in this file is a no-op.
--
-- 3. Absolute row counts are fragile. Any row left behind by someone poking
--    at the database makes a correct policy look broken. Every count below
--    is scoped to this script's own fixture ids.

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

-- Written as the admin role, which bypasses RLS on purpose: this is the
-- setup, not the test. Deleted first so a re-run is a clean run.
delete from public.pages where id in (
  'aaaaaaaa-0000-0000-0000-00000000a001',
  'aaaaaaaa-0000-0000-0000-00000000a002',
  'bbbbbbbb-0000-0000-0000-00000000b001'
);
delete from public.tenants where id in (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222'
);

insert into public.tenants (id, slug, name) values
  ('11111111-1111-1111-1111-111111111111', 'iso-alpha', 'Isolation Alpha'),
  ('22222222-2222-2222-2222-222222222222', 'iso-beta',  'Isolation Beta');

insert into public.pages (id, tenant_id, slug, title, status, published_content) values
  ('aaaaaaaa-0000-0000-0000-00000000a001', '11111111-1111-1111-1111-111111111111', 'iso-live',  'Alpha live',  'published', '{"version":1,"sections":[]}'),
  ('aaaaaaaa-0000-0000-0000-00000000a002', '11111111-1111-1111-1111-111111111111', 'iso-draft', 'Alpha draft', 'draft',     null),
  ('bbbbbbbb-0000-0000-0000-00000000b001', '22222222-2222-2222-2222-222222222222', 'iso-live',  'Beta live',   'published', '{"version":1,"sections":[]}');

create temp table if not exists checks (
  ord    serial,
  name   text,
  passed boolean,
  detail text
);
truncate checks restart identity;

-- ---------------------------------------------------------------------------
-- Configuration, checked before anything sets a tenant
-- ---------------------------------------------------------------------------

insert into checks (name, passed, detail)
select 'neither application role can bypass RLS',
  count(*) filter (where rolbypassrls or rolsuper) = 0,
  'privileged: ' || coalesce(string_agg(rolname, ', ')
    filter (where rolbypassrls or rolsuper), 'none')
from pg_roles where rolname in ('tg_sites_app', 'tg_sites_renderer');

insert into checks (name, passed, detail)
select 'every public table has RLS enabled and forced',
  count(*) filter (where not (relrowsecurity and relforcerowsecurity)) = 0,
  'unprotected: ' || coalesce(string_agg(relname, ', ')
    filter (where not (relrowsecurity and relforcerowsecurity)), 'none')
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r';

-- Supabase exposes the public schema over PostgREST. Neither of its roles
-- should be able to reach any of this.
insert into checks (name, passed, detail)
select 'anon and authenticated cannot read any table', count(*) = 0,
  'reachable: ' || coalesce(string_agg(relname, ', '), 'none')
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
  and (has_table_privilege('anon', c.oid, 'SELECT')
    or has_table_privilege('authenticated', c.oid, 'SELECT'));

-- ---------------------------------------------------------------------------
-- Fail closed: no tenant set means no rows
-- ---------------------------------------------------------------------------

-- Clears the setting explicitly, so it cannot be fooled by a value left
-- behind earlier in the transaction. See trap 2. This is the most important
-- check here: it is what makes a forgotten withTenant call return nothing
-- rather than everything.
do $$
declare pages int; tenants int; domains int;
begin
  set local role tg_sites_app;
  perform set_config('app.current_tenant_id', '', true);

  select count(*) into pages   from public.pages;
  select count(*) into tenants from public.tenants;
  select count(*) into domains from public.domains;

  -- Step back out before recording. The roles under test have no business
  -- writing anywhere, including to this scratch table.
  reset role;
  insert into checks (name, passed, detail) values
    ('a query with no tenant set returns nothing',
     pages = 0 and tenants = 0 and domains = 0,
     format('pages %s, tenants %s, domains %s', pages, tenants, domains));
end $$;

-- ---------------------------------------------------------------------------
-- Reads across tenants
-- ---------------------------------------------------------------------------

do $$
declare own int; other int; by_id int; tenants_seen int;
begin
  set local role tg_sites_app;
  perform set_config('app.current_tenant_id', '11111111-1111-1111-1111-111111111111', true);

  select count(*) into own from public.pages
    where id in ('aaaaaaaa-0000-0000-0000-00000000a001', 'aaaaaaaa-0000-0000-0000-00000000a002');
  select count(*) into other from public.pages
    where tenant_id = '22222222-2222-2222-2222-222222222222';
  select count(*) into by_id from public.pages
    where id = 'bbbbbbbb-0000-0000-0000-00000000b001';
  select count(*) into tenants_seen from public.tenants
    where id in ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222');

  reset role;
  insert into checks (name, passed, detail) values
    ('a tenant sees its own pages',            own = 2,          'saw ' || own || ' of 2'),
    ('a tenant sees none of the others pages', other = 0,        'leaked ' || other),
    ('asking by direct id does not bypass it', by_id = 0,        'leaked ' || by_id),
    ('a tenant sees only its own tenant row',  tenants_seen = 1, 'saw ' || tenants_seen || ' of 2');
end $$;

-- ---------------------------------------------------------------------------
-- Writes across tenants
-- ---------------------------------------------------------------------------

do $$
declare touched int;
begin
  set local role tg_sites_app;
  perform set_config('app.current_tenant_id', '11111111-1111-1111-1111-111111111111', true);

  update public.pages set title = 'HIJACKED'
    where id = 'bbbbbbbb-0000-0000-0000-00000000b001';
  get diagnostics touched = row_count;

  reset role;
  insert into checks (name, passed, detail) values
    ('one tenant cannot update the others page', touched = 0, 'rows changed: ' || touched);
end $$;

do $$
declare refused boolean := false;
begin
  -- Role set outside the exception block. See trap 1.
  set local role tg_sites_app;
  perform set_config('app.current_tenant_id', '11111111-1111-1111-1111-111111111111', true);

  begin
    insert into public.pages (tenant_id, slug, title)
      values ('22222222-2222-2222-2222-222222222222', 'planted', 'Planted');
  exception when others then refused := true;
  end;

  reset role;
  insert into checks (name, passed, detail) values
    ('a tenant_id from the request body is refused', refused,
     case when refused then 'WITH CHECK rejected it' else 'THE ROW WAS WRITTEN' end);
end $$;

-- ---------------------------------------------------------------------------
-- The public renderer
-- ---------------------------------------------------------------------------

do $$
declare live int; drafts int; cross_tenant int;
begin
  set local role tg_sites_renderer;
  perform set_config('app.current_tenant_id', '11111111-1111-1111-1111-111111111111', true);

  select count(*) into live from public.pages
    where id = 'aaaaaaaa-0000-0000-0000-00000000a001';
  select count(*) into drafts from public.pages
    where id = 'aaaaaaaa-0000-0000-0000-00000000a002';
  select count(*) into cross_tenant from public.pages
    where tenant_id = '22222222-2222-2222-2222-222222222222';

  reset role;
  insert into checks (name, passed, detail) values
    ('the renderer sees a published page',     live = 1,         'saw ' || live || ' of 1'),
    ('a draft is invisible even by direct id', drafts = 0,       'leaked ' || drafts),
    ('the renderer cannot cross tenants',      cross_tenant = 0, 'leaked ' || cross_tenant);
end $$;

do $$
declare
  can_update boolean := true;
  can_insert boolean := true;
  can_delete boolean := true;
  can_read_events boolean := true;
begin
  -- Role set once, outside every exception block. See trap 1.
  set local role tg_sites_renderer;
  perform set_config('app.current_tenant_id', '11111111-1111-1111-1111-111111111111', true);

  begin
    update public.pages set title = 'defaced' where id = 'aaaaaaaa-0000-0000-0000-00000000a001';
  exception when others then can_update := false; end;

  begin
    insert into public.pages (tenant_id, slug, title)
      values ('11111111-1111-1111-1111-111111111111', 'injected', 'Injected');
  exception when others then can_insert := false; end;

  begin
    delete from public.pages where id = 'aaaaaaaa-0000-0000-0000-00000000a001';
  exception when others then can_delete := false; end;

  begin
    perform 1 from public.publish_events limit 1;
  exception when others then can_read_events := false; end;

  reset role;
  insert into checks (name, passed, detail) values
    ('the renderer cannot update',           not can_update,      ''),
    ('the renderer cannot insert',           not can_insert,      ''),
    ('the renderer cannot delete',           not can_delete,      ''),
    ('the renderer cannot read publish log', not can_read_events, '');
end $$;

-- ---------------------------------------------------------------------------
-- Report, then clear up
-- ---------------------------------------------------------------------------

select case when passed then 'PASS' else 'FAIL' end as result, name, detail
from checks order by passed, ord;

select
  count(*) filter (where passed)     as passed,
  count(*) filter (where not passed) as failed,
  case when count(*) filter (where not passed) = 0
    then 'Tenant isolation holds.'
    else 'SHIP BLOCKER: isolation is broken.'
  end as verdict
from checks;

delete from public.pages where id in (
  'aaaaaaaa-0000-0000-0000-00000000a001',
  'aaaaaaaa-0000-0000-0000-00000000a002',
  'bbbbbbbb-0000-0000-0000-00000000b001'
);
delete from public.tenants where id in (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222'
);
