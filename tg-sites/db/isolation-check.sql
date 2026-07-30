-- Tenant isolation, proven rather than assumed.
--
-- Seeds three tenants and two people, tries every way one could reach the
-- other's data, reports a pass or fail per check, and removes its own
-- fixtures. Covers the three questions this database answers before it knows
-- whose data it is looking at: which tenant does this hostname mean, who is
-- signing in, and which sites are theirs.
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
--    the single most important check in this file is a no-op. There are three
--    of these settings now, one per question: which tenant, which user, which
--    email is signing in. A block that tests the absence of one must clear it
--    by name, and a block that only cares about one of them should clear the
--    other two so it is testing what it says it is.
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
-- Domains and memberships both cascade with their tenant, so this clears them
-- too. auth_users does not: it has no foreign key to anything, deliberately,
-- because tenant_users.user_id holds whatever subject the identity provider
-- issues and that provider is not this database.
delete from public.tenants where id in (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333'
);
delete from public.auth_users where id in ('iso-user-ann', 'iso-user-bob');

insert into public.tenants (id, slug, name, status) values
  ('11111111-1111-1111-1111-111111111111', 'iso-alpha', 'Isolation Alpha', 'active'),
  ('22222222-2222-2222-2222-222222222222', 'iso-beta',  'Isolation Beta',  'active'),
  -- Suspended, to prove a switched-off site stops resolving.
  ('33333333-3333-3333-3333-333333333333', 'iso-gamma', 'Isolation Gamma', 'suspended');

insert into public.domains (tenant_id, hostname, is_primary) values
  ('11111111-1111-1111-1111-111111111111', 'iso-alpha-live.example', true),
  ('22222222-2222-2222-2222-222222222222', 'iso-beta-live.example',  true),
  ('33333333-3333-3333-3333-333333333333', 'iso-gamma-live.example', true);

insert into public.pages (id, tenant_id, slug, title, status, published_content) values
  ('aaaaaaaa-0000-0000-0000-00000000a001', '11111111-1111-1111-1111-111111111111', 'iso-live',  'Alpha live',  'published', '{"version":1,"sections":[]}'),
  ('aaaaaaaa-0000-0000-0000-00000000a002', '11111111-1111-1111-1111-111111111111', 'iso-draft', 'Alpha draft', 'draft',     null),
  ('bbbbbbbb-0000-0000-0000-00000000b001', '22222222-2222-2222-2222-222222222222', 'iso-live',  'Beta live',   'published', '{"version":1,"sections":[]}');

-- Two people. The hash is a placeholder; nothing here verifies a password,
-- only who is allowed to read the row a password would be checked against.
insert into public.auth_users (id, email, password_hash, name) values
  ('iso-user-ann', 'ann@iso.example', 'not-a-real-hash', 'Ann'),
  ('iso-user-bob', 'bob@iso.example', 'not-a-real-hash', 'Bob');

-- Ann is in two tenants, one of them suspended. Bob is in the third.
--
-- The suspended membership is the interesting fixture: it is a real row, so a
-- site picker that trusts tenant_users alone would offer Ann a switched-off
-- site. The tenants_mine policy is what stops that, and there is a check for
-- it below.
insert into public.tenant_users (tenant_id, user_id, role) values
  ('11111111-1111-1111-1111-111111111111', 'iso-user-ann', 'owner'),
  ('33333333-3333-3333-3333-333333333333', 'iso-user-ann', 'owner'),
  ('22222222-2222-2222-2222-222222222222', 'iso-user-bob', 'owner');

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
declare pages int; tenants int; domains int; members int; creds int;
begin
  set local role tg_sites_app;
  -- All three, by name. This block does not depend on running early, so
  -- reordering the file cannot quietly turn it into a no-op.
  perform set_config('app.current_tenant_id', '', true);
  perform set_config('app.current_user_id',   '', true);
  perform set_config('app.login_email',       '', true);

  select count(*) into pages   from public.pages;
  select count(*) into tenants from public.tenants;
  select count(*) into domains from public.domains;
  select count(*) into members from public.tenant_users;
  select count(*) into creds   from public.auth_users;

  -- Step back out before recording. The roles under test have no business
  -- writing anywhere, including to this scratch table.
  reset role;
  insert into checks (name, passed, detail) values
    ('a query with nothing set returns nothing',
     pages = 0 and tenants = 0 and domains = 0 and members = 0 and creds = 0,
     format('pages %s, tenants %s, domains %s, memberships %s, credentials %s',
            pages, tenants, domains, members, creds));
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
-- Resolving a hostname, the one thing that runs before a tenant is known
-- ---------------------------------------------------------------------------

-- resolve_tenant is SECURITY DEFINER, so it is the one place in this database
-- that sees past RLS. These checks exist to hold it to exactly that: a
-- hostname in, one id out, and nothing else opened up on the way.
insert into checks (name, passed, detail)
select 'only one function sees past RLS',
  count(*) = 1 and bool_and(p.proname = 'resolve_tenant'),
  'security definer: ' || coalesce(string_agg(p.proname, ', '), 'none')
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef;

-- Every function, not just that one. Postgres grants EXECUTE to PUBLIC the
-- moment a function is created, so the safe state is one you have to go and
-- ask for. Checking the whole schema rather than naming resolve_tenant means
-- the next function somebody adds is covered before they think to cover it.
insert into checks (name, passed, detail)
select 'anon and authenticated cannot execute any function', count(*) = 0,
  'callable: ' || coalesce(string_agg(p.proname, ', '), 'none')
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and (has_function_privilege('anon', p.oid, 'EXECUTE')
    or has_function_privilege('authenticated', p.oid, 'EXECUTE'));

do $$
declare
  staging uuid; custom uuid; unknown uuid; suspended uuid; domains_seen int;
begin
  set local role tg_sites_renderer;
  -- No tenant. That is the point: this call happens before one is known.
  perform set_config('app.current_tenant_id', '', true);

  staging   := public.resolve_tenant('iso-alpha.tgsites.io');
  -- Mixed case on purpose. Hostnames are case insensitive in DNS and a
  -- Host header can arrive in any case at all.
  custom    := public.resolve_tenant('ISO-Beta-Live.example');
  unknown   := public.resolve_tenant('nobody.example');
  suspended := public.resolve_tenant('iso-gamma-live.example');

  -- The function reads `domains`. Calling it must not leave that table
  -- readable to the caller.
  select count(*) into domains_seen from public.domains;

  reset role;
  insert into checks (name, passed, detail) values
    ('a staging subdomain resolves with no tenant set',
     staging = '11111111-1111-1111-1111-111111111111', coalesce(staging::text, 'null')),
    ('a custom domain resolves, whatever its case',
     custom = '22222222-2222-2222-2222-222222222222', coalesce(custom::text, 'null')),
    ('an unknown hostname resolves to nothing',
     unknown is null, coalesce(unknown::text, 'null')),
    ('a suspended tenant does not resolve',
     suspended is null, coalesce(suspended::text, 'null')),
    ('resolving does not open up the domains table',
     domains_seen = 0, 'rows visible: ' || domains_seen);
end $$;

-- Run as the admin role deliberately. This is a CHECK constraint, not a
-- policy, and constraints bind everyone including a superuser. If it holds
-- here it holds everywhere.
do $$
declare refused boolean := false;
begin
  begin
    insert into public.domains (tenant_id, hostname)
      values ('22222222-2222-2222-2222-222222222222', 'iso-alpha.tgsites.io');
  exception when others then refused := true;
  end;

  insert into checks (name, passed, detail) values
    ('a staging subdomain cannot be claimed as a custom domain', refused,
     case when refused then 'the check constraint refused it'
          else 'ONE TENANT COULD HIJACK ANOTHERS STAGING URL' end);
end $$;

-- ---------------------------------------------------------------------------
-- Signing in, and finding your own sites
-- ---------------------------------------------------------------------------

-- The other thing that happens before a tenant is known. Everything above
-- keys off current_tenant(); none of it can answer "who is this" or "which
-- sites are theirs", because the tenant is the answer to the second question
-- and there is no tenant yet.

-- Sign in: one email in, at most one row out.
do $$
declare found int; total int; wrong int; who text;
begin
  set local role tg_sites_app;
  -- No user. Sign-in runs before there is one; that is the whole difficulty.
  perform set_config('app.current_tenant_id', '', true);
  perform set_config('app.current_user_id',   '', true);
  perform set_config('app.login_email', 'ann@iso.example', true);

  select count(*) into found from public.auth_users where email = 'ann@iso.example';
  select id       into who   from public.auth_users where email = 'ann@iso.example';
  -- The enumeration check. Naming one email must not open the table: the only
  -- row visible in the whole of auth_users is the one just named.
  select count(*) into total from public.auth_users;

  perform set_config('app.login_email', 'nobody@iso.example', true);
  select count(*) into wrong from public.auth_users;

  reset role;
  insert into checks (name, passed, detail) values
    ('signing in can read the row it names',
     found = 1 and who = 'iso-user-ann', 'saw ' || found || ', id ' || coalesce(who, 'null')),
    ('signing in cannot enumerate other people',
     total = 1, 'rows visible while naming one email: ' || total),
    ('an unknown email reveals nothing',
     wrong = 0, 'rows visible: ' || wrong);
end $$;

-- A signed-in person, reading their own things.
do $$
declare
  mine int; others int; tenants_seen int; suspended_seen int; beta_seen int;
  own_creds int; other_creds int;
begin
  set local role tg_sites_app;
  -- A user and no tenant, which is exactly the state the site picker runs in.
  -- login_email cleared, or the credentials checks below would pass through
  -- the sign-in policy instead of the one they mean to test. See trap 2.
  perform set_config('app.current_tenant_id', '', true);
  perform set_config('app.login_email',       '', true);
  perform set_config('app.current_user_id', 'iso-user-ann', true);

  select count(*) into mine   from public.tenant_users where user_id = 'iso-user-ann';
  select count(*) into others from public.tenant_users where user_id = 'iso-user-bob';

  select count(*) into tenants_seen from public.tenants
    where id in ('11111111-1111-1111-1111-111111111111',
                 '22222222-2222-2222-2222-222222222222',
                 '33333333-3333-3333-3333-333333333333');
  select count(*) into suspended_seen from public.tenants
    where id = '33333333-3333-3333-3333-333333333333';
  select count(*) into beta_seen from public.tenants
    where id = '22222222-2222-2222-2222-222222222222';

  select count(*) into own_creds   from public.auth_users where id = 'iso-user-ann';
  select count(*) into other_creds from public.auth_users where id = 'iso-user-bob';

  reset role;
  insert into checks (name, passed, detail) values
    ('a user sees their own memberships with no tenant set',
     mine = 2, 'saw ' || mine || ' of 2'),
    ('a user sees nobody elses memberships',
     others = 0, 'leaked ' || others),
    ('the site picker offers only tenants the user is in',
     tenants_seen = 1, 'saw ' || tenants_seen || ' of 3 fixture tenants'),
    ('a membership of a suspended tenant is not offered',
     suspended_seen = 0, 'leaked ' || suspended_seen),
    ('a tenant the user is not in stays hidden',
     beta_seen = 0, 'leaked ' || beta_seen),
    ('a user can read their own credentials row',
     own_creds = 1, 'saw ' || own_creds || ' of 1'),
    ('a user cannot read anyone elses credentials',
     other_creds = 0, 'leaked ' || other_creds);
end $$;

-- Writes, from a signed-in person with no tenant chosen yet.
do $$
declare hijacked int; granted boolean := true; promoted int;
begin
  -- Role and settings outside every exception block. See trap 1.
  set local role tg_sites_app;
  perform set_config('app.current_tenant_id', '', true);
  perform set_config('app.login_email',       '', true);
  perform set_config('app.current_user_id', 'iso-user-ann', true);

  update public.auth_users set password_hash = 'planted' where id = 'iso-user-bob';
  get diagnostics hijacked = row_count;

  -- The one that matters most. tenant_users_own_memberships is SELECT only, so
  -- it has no WITH CHECK to widen; the write still has to go through
  -- tenant_users_app, which needs a tenant, and there is none. Being able to
  -- write your own membership row would mean being able to join any site.
  begin
    insert into public.tenant_users (tenant_id, user_id, role)
      values ('22222222-2222-2222-2222-222222222222', 'iso-user-ann', 'owner');
  exception when others then granted := false;
  end;

  -- Nor upgrade a membership already held.
  update public.tenant_users set role = 'owner'
    where tenant_id = '11111111-1111-1111-1111-111111111111' and user_id = 'iso-user-ann';
  get diagnostics promoted = row_count;

  reset role;
  insert into checks (name, passed, detail) values
    ('a user cannot overwrite anyone elses credentials',
     hijacked = 0, 'rows changed: ' || hijacked),
    ('a user cannot grant themselves a membership',
     not granted,
     case when granted then 'ANN JOINED BETA BY ASKING' else 'the policy refused it' end),
    ('reading a membership does not make it writable',
     promoted = 0, 'rows changed: ' || promoted);
end $$;

-- ---------------------------------------------------------------------------
-- Clear up, then report
-- ---------------------------------------------------------------------------

-- Cleanup runs first so the report is the last statement in the file. Tools
-- that show only the final result set then show the verdict rather than a
-- row count from a DELETE. The results already live in the temp table, so
-- removing the fixtures cannot affect them.
delete from public.pages where id in (
  'aaaaaaaa-0000-0000-0000-00000000a001',
  'aaaaaaaa-0000-0000-0000-00000000a002',
  'bbbbbbbb-0000-0000-0000-00000000b001'
);
delete from public.tenants where id in (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333'
);
delete from public.auth_users where id in ('iso-user-ann', 'iso-user-bob');

-- One result set, failures at the top, verdict on the last line.
select result, name, detail from (
  select
    case when passed then 'PASS' else 'FAIL' end as result,
    name, detail, passed, ord
  from checks
  union all
  select
    case when count(*) filter (where not passed) = 0 then '=====' else '!!!!!' end,
    case when count(*) filter (where not passed) = 0
      then 'Tenant isolation holds.'
      else 'SHIP BLOCKER: isolation is broken.' end,
    count(*) filter (where passed) || ' passed, '
      || count(*) filter (where not passed) || ' failed',
    true, 2147483647
  from checks
) r
order by passed, ord;
