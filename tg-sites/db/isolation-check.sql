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

-- A font each, with a file. The bytes carry the real woff2 signature so a check
-- can tell a corrupted read from an empty one.
insert into public.fonts (id, tenant_id, family, slug, source, fallback) values
  ('cccc0000-0000-0000-0000-00000000c001', '11111111-1111-1111-1111-111111111111',
   'Alpha Display', 'alpha-display', 'google', 'serif'),
  ('dddd0000-0000-0000-0000-00000000d001', '22222222-2222-2222-2222-222222222222',
   'Beta Grotesk', 'beta-grotesk', 'upload', 'sans');

insert into public.font_files
  (tenant_id, font_id, weight, style, format, subset, unicode_range, bytes, byte_size) values
  ('11111111-1111-1111-1111-111111111111', 'cccc0000-0000-0000-0000-00000000c001',
   400, 'normal', 'woff2', 'latin', 'U+0000-00FF', decode('774f4632aaaaaaaa', 'hex'), 8),
  ('22222222-2222-2222-2222-222222222222', 'dddd0000-0000-0000-0000-00000000d001',
   400, 'normal', 'woff2', null, null, decode('774f4632bbbbbbbb', 'hex'), 8);

-- An image each. Unlike a font file, the bytes are not here: they live in the
-- blob store and are served by its CDN. What this table holds is the row that
-- says the image is this tenant's, which is the thing that has to be scoped.
insert into public.media
  (id, tenant_id, storage_key, url, filename, mime, bytes, width, height, alt, source) values
  ('eeee0000-0000-0000-0000-00000000e001', '11111111-1111-1111-1111-111111111111',
   'sites/alpha/media/alpha-hero.jpg', 'https://blob.example/alpha-hero.jpg',
   'alpha-hero.jpg', 'image/jpeg', 240000, 2400, 1600, 'Alpha hero', 'upload'),
  ('ffff0000-0000-0000-0000-00000000f001', '22222222-2222-2222-2222-222222222222',
   'sites/beta/media/beta-hero.jpg', 'https://blob.example/beta-hero.jpg',
   'beta-hero.jpg', 'image/jpeg', 180000, 1920, 1080, 'Beta hero', 'pexels');

-- One writing-assistant request each. Inserted up here with the other fixtures
-- rather than beside the checks that use them, so the "nothing set returns
-- nothing" block further down has rows it could leak. A meter fixture created
-- after that block would make its ai_usage count zero for the boring reason.
insert into public.ai_usage (tenant_id, user_id, intent) values
  ('11111111-1111-1111-1111-111111111111', 'iso-user-ann', 'write'),
  ('22222222-2222-2222-2222-222222222222', 'iso-user-bob', 'write');

-- One activity line each, up here with the other fixtures for the same reason as
-- the meter above: the "nothing set returns nothing" block needs rows it could
-- leak.
insert into public.site_activity (tenant_id, actor_id, action, summary) values
  ('11111111-1111-1111-1111-111111111111', 'iso-user-ann', 'page.publish', 'Published the Home page'),
  ('22222222-2222-2222-2222-222222222222', 'iso-user-bob', 'page.publish', 'Published the Home page');

-- One comment thread each, on that tenant's own page, so the "own only" read has
-- real rows and the resolve has one to touch. Alpha owns a root and its reply,
-- Beta owns a root: two against one, so a leak of Beta's would change the count.
insert into public.site_comments (id, tenant_id, page_id, parent_id, author_id, body) values
  ('cccccccc-0000-0000-0000-00000000c001', '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-0000-0000-0000-00000000a001', null, 'iso-user-ann', 'Make the hero bigger'),
  ('cccccccc-0000-0000-0000-00000000c002', '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-0000-0000-0000-00000000a001', 'cccccccc-0000-0000-0000-00000000c001', 'iso-user-ann', 'Will do'),
  ('cccccccc-0000-0000-0000-00000000c003', '22222222-2222-2222-2222-222222222222',
   'bbbbbbbb-0000-0000-0000-00000000b001', null, 'iso-user-bob', 'Change the colour');

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
        fonts int; font_files int; media int; ai int;
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
  select count(*) into fonts   from public.fonts;
  select count(*) into font_files from public.font_files;
  select count(*) into media   from public.media;
  select count(*) into ai      from public.ai_usage;

  -- Step back out before recording. The roles under test have no business
  -- writing anywhere, including to this scratch table.
  reset role;
  insert into checks (name, passed, detail) values
    ('a query with nothing set returns nothing',
     pages = 0 and tenants = 0 and domains = 0 and members = 0 and creds = 0
       and fonts = 0 and font_files = 0 and media = 0 and ai = 0,
     format('pages %s, tenants %s, domains %s, memberships %s, credentials %s, fonts %s, files %s, media %s, usage %s',
            pages, tenants, domains, members, creds, fonts, font_files, media, ai));
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
-- Domains: the write path that arrived with custom domains
-- ---------------------------------------------------------------------------

-- addDomain in lib/db/tenants.ts inserts a domains row with tenant_id set to the
-- session's tenant, and every other domain write is scoped by withTenant. The
-- WITH CHECK policy is what stops a confused or hostile caller planting a row
-- against another tenant, exactly as it does for pages, so this holds the domains
-- table to the same promise. Added when the domain write path shipped, because a
-- table only read from until then is now written to.
do $$
declare refused boolean := false; cross_tenant int;
begin
  -- Role set outside the exception block. See trap 1.
  set local role tg_sites_app;
  perform set_config('app.current_tenant_id', '11111111-1111-1111-1111-111111111111', true);

  begin
    insert into public.domains (tenant_id, hostname, kind)
      values ('22222222-2222-2222-2222-222222222222', 'planted-domain.example', 'custom');
  exception when others then refused := true;
  end;

  -- And a plain read of another tenant's domains, which the app role must not see.
  select count(*) into cross_tenant from public.domains
    where tenant_id = '22222222-2222-2222-2222-222222222222';

  reset role;
  insert into checks (name, passed, detail) values
    ('a domain for another tenant is refused', refused,
     case when refused then 'WITH CHECK rejected it' else 'THE ROW WAS WRITTEN' end),
    ('the app role cannot read another tenant''s domains', cross_tenant = 0,
     'leaked ' || cross_tenant);
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
  preview uuid; custom uuid; unknown uuid; suspended uuid; domains_seen int;
begin
  set local role tg_sites_renderer;
  -- No tenant. That is the point: this call happens before one is known.
  perform set_config('app.current_tenant_id', '', true);

  preview   := public.resolve_tenant('iso-alpha.travelgenixsites.com');
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
    ('a preview subdomain resolves with no tenant set',
     preview = '11111111-1111-1111-1111-111111111111', coalesce(preview::text, 'null')),
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
      values ('22222222-2222-2222-2222-222222222222', 'iso-alpha.travelgenixsites.com');
  exception when others then refused := true;
  end;

  insert into checks (name, passed, detail) values
    ('a preview subdomain cannot be claimed as a custom domain', refused,
     case when refused then 'the check constraint refused it'
          else 'ONE TENANT COULD HIJACK ANOTHERS PREVIEW URL' end);
end $$;

-- ---------------------------------------------------------------------------
-- The version history
-- ---------------------------------------------------------------------------

-- publish_events holds what a page USED to say, including prices that were
-- changed for a reason. Three properties, and the third is the one a schema
-- change is most likely to lose by accident.

insert into public.publish_events (tenant_id, page_id, snapshot, title) values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-00000000a001',
   '{"v":"alpha"}', 'Alpha live'),
  ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-0000-0000-0000-00000000b001',
   '{"v":"beta"}', 'Beta live');

do $$
declare denied boolean := false; seen int := 0;
begin
  set local role tg_sites_renderer;
  perform set_config('app.current_tenant_id', '11111111-1111-1111-1111-111111111111', true);
  begin
    select count(*) into seen from public.publish_events;
  exception when insufficient_privilege then denied := true;
  end;
  reset role;

  insert into checks (name, passed, detail) values
    ('the public renderer cannot read the version history', denied,
     case when denied then 'permission denied, as it should be'
          else 'THE PUBLIC SITE ROLE READ ' || seen || ' HISTORY ROWS' end);
end $$;

do $$
declare mine int; theirs int; reachable int;
begin
  set local role tg_sites_app;
  perform set_config('app.current_tenant_id', '11111111-1111-1111-1111-111111111111', true);

  select count(*) into mine from public.publish_events;
  select count(*) into theirs from public.publish_events
    where page_id = 'bbbbbbbb-0000-0000-0000-00000000b001';

  -- The restore's own lookup, run as Alpha reaching for Beta's version. It
  -- matches on publish id AND page id, which is the scope the tenant policy
  -- does not cover: one page of a tenant restored from another page's history.
  select count(*) into reachable from public.publish_events
    where id = (select id from public.publish_events limit 1)
      and page_id = 'bbbbbbbb-0000-0000-0000-00000000b001';

  reset role;
  insert into checks (name, passed, detail) values
    ('a tenant sees only its own versions', mine = 1, mine || ' visible'),
    ('another tenant''s versions are invisible', theirs = 0, theirs || ' visible'),
    ('a restore cannot reach across tenants', reachable = 0, reachable || ' matched');
end $$;

do $$
declare refused boolean := false;
begin
  set local role tg_sites_app;
  perform set_config('app.current_tenant_id', '11111111-1111-1111-1111-111111111111', true);
  begin
    update public.publish_events set snapshot = '{"v":"tampered"}';
  exception when insufficient_privilege then refused := true;
  end;
  reset role;

  -- There is deliberately no UPDATE grant. A snapshot that can be edited after
  -- the fact is not a snapshot, it is just another copy of the page.
  insert into checks (name, passed, detail) values
    ('a stored snapshot cannot be rewritten', refused,
     case when refused then 'no UPDATE grant, as intended'
          else 'A SNAPSHOT WAS EDITED IN PLACE' end);
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
-- Fonts, which are the one thing the public role must be able to READ
-- ---------------------------------------------------------------------------

/*
 * Fonts sit differently from everything else in this schema.
 *
 * A draft page is invisible to the renderer, on purpose. A font file cannot be:
 * it is fetched by an unauthenticated browser while painting a published page,
 * so the read-only role has to see it. That makes these the checks worth having.
 * The renderer must read a font and still be unable to write one, and neither
 * role may see another tenant's, because the bytes are somebody's licensed
 * property and the family names give away who a client is.
 */

do $$
declare
  own int; other int; own_files int; other_files int; by_id int;
begin
  set local role tg_sites_app;
  perform set_config('app.current_tenant_id', '11111111-1111-1111-1111-111111111111', true);
  perform set_config('app.current_user_id',   '', true);
  perform set_config('app.login_email',       '', true);

  select count(*) into own   from public.fonts;
  select count(*) into other from public.fonts where slug = 'beta-grotesk';
  select count(*) into own_files   from public.font_files;
  select count(*) into other_files from public.font_files
    where font_id = 'dddd0000-0000-0000-0000-00000000d001';
  -- Straight at the row by its id, which is what a font URL carries.
  select count(*) into by_id from public.font_files
    where tenant_id = '22222222-2222-2222-2222-222222222222';

  reset role;
  insert into checks (name, passed, detail) values
    ('a tenant sees its own fonts',            own = 1,          'saw ' || own || ' of 1'),
    ('a tenant sees none of the others fonts', other = 0,        'leaked ' || other),
    ('a tenant sees only its own font files',  own_files = 1,    'saw ' || own_files || ' of 1'),
    ('font files do not leak across tenants',  other_files = 0,  'leaked ' || other_files),
    ('asking for a font file by id is scoped', by_id = 0,        'leaked ' || by_id);
end $$;

do $$
declare
  can_read int; leaked int; wrote boolean := true; deleted boolean := true;
  signature bytea;
begin
  set local role tg_sites_renderer;
  perform set_config('app.current_tenant_id', '11111111-1111-1111-1111-111111111111', true);

  select count(*) into can_read from public.font_files;
  select count(*) into leaked   from public.font_files
    where tenant_id = '22222222-2222-2222-2222-222222222222';
  -- The bytes themselves, since serving them is the entire job of this role.
  select substring(bytes from 1 for 4) into signature from public.font_files limit 1;

  begin
    insert into public.fonts (tenant_id, family, slug, source, fallback)
      values ('11111111-1111-1111-1111-111111111111', 'Planted', 'planted', 'upload', 'sans');
  exception when others then wrote := false; end;

  begin
    delete from public.font_files;
  exception when others then deleted := false; end;

  reset role;
  insert into checks (name, passed, detail) values
    ('the renderer can read a font file, which it must',
     can_read = 1, 'saw ' || can_read || ' of 1'),
    ('the renderer gets the bytes back intact',
     signature = decode('774f4632', 'hex'),
     'signature: ' || coalesce(encode(signature, 'escape'), 'null')),
    ('the renderer cannot see another tenants font',
     leaked = 0, 'leaked ' || leaked),
    ('the renderer cannot add a font',
     not wrote, case when wrote then 'IT WROTE ONE' else 'refused' end),
    ('the renderer cannot delete a font file',
     not deleted, case when deleted then 'IT DELETED THEM' else 'refused' end);
end $$;

-- ---------------------------------------------------------------------------
-- The image bank
-- ---------------------------------------------------------------------------

/*
 * Media sits between a page and a font file, and the difference matters.
 *
 * The bytes are not in this database. They are in a blob store and served by its
 * CDN to anyone with the URL, so nothing here can make an image private and
 * these checks do not pretend to. What they cover is the row: the filename, the
 * dimensions, the alt text and the credit. That is a list of what a client has
 * uploaded, and one travel agency being able to enumerate another's image
 * library would be a straightforward leak even with the pictures themselves
 * public.
 *
 * The renderer still needs select, because a published page names a media id and
 * the row carries the URL and the alt text that go into the markup.
 */

do $$
declare
  own int; other int; by_id int; wrote boolean := true;
begin
  set local role tg_sites_app;
  perform set_config('app.current_tenant_id', '11111111-1111-1111-1111-111111111111', true);
  perform set_config('app.current_user_id',   '', true);
  perform set_config('app.login_email',       '', true);

  select count(*) into own   from public.media;
  select count(*) into other from public.media where filename = 'beta-hero.jpg';
  -- Straight at the row by its id, which is what a page's image block stores.
  select count(*) into by_id from public.media
    where id = 'ffff0000-0000-0000-0000-00000000f001';

  -- Writing a row that claims to belong to the other tenant. The WITH CHECK on
  -- media_app is the half of the policy a read-only test never exercises, and
  -- without it one client could plant an image in another's library.
  begin
    insert into public.media
      (tenant_id, storage_key, url, filename, mime, bytes)
    values ('22222222-2222-2222-2222-222222222222', 'sites/beta/media/planted.jpg',
            'https://blob.example/planted.jpg', 'planted.jpg', 'image/jpeg', 1000);
  exception when others then wrote := false; end;

  reset role;
  insert into checks (name, passed, detail) values
    ('a tenant sees its own media',              own = 1,   'saw ' || own || ' of 1'),
    ('a tenant sees none of the others media',   other = 0, 'leaked ' || other),
    ('asking for a media row by id is scoped',   by_id = 0, 'leaked ' || by_id),
    ('a tenant cannot file an image under another tenant',
     not wrote, case when wrote then 'IT PLANTED ONE' else 'the policy refused it' end);
end $$;

do $$
declare
  can_read int; leaked int; wrote boolean := true; deleted boolean := true;
  the_url text;
begin
  set local role tg_sites_renderer;
  perform set_config('app.current_tenant_id', '11111111-1111-1111-1111-111111111111', true);

  select count(*) into can_read from public.media;
  select count(*) into leaked   from public.media
    where tenant_id = '22222222-2222-2222-2222-222222222222';
  -- The URL specifically, because putting it in an img tag is the whole reason
  -- this role reads the table at all.
  select url into the_url from public.media limit 1;

  begin
    insert into public.media (tenant_id, storage_key, url, filename, mime, bytes)
    values ('11111111-1111-1111-1111-111111111111', 'sites/alpha/media/planted.jpg',
            'https://blob.example/planted.jpg', 'planted.jpg', 'image/jpeg', 1000);
  exception when others then wrote := false; end;

  begin
    delete from public.media;
  exception when others then deleted := false; end;

  reset role;
  insert into checks (name, passed, detail) values
    ('the renderer can read a media row, which it must',
     can_read = 1, 'saw ' || can_read || ' of 1'),
    ('the renderer gets the image url back',
     the_url = 'https://blob.example/alpha-hero.jpg', 'url: ' || coalesce(the_url, 'null')),
    ('the renderer cannot see another tenants media',
     leaked = 0, 'leaked ' || leaked),
    ('the renderer cannot add media',
     not wrote, case when wrote then 'IT WROTE ONE' else 'refused' end),
    ('the renderer cannot delete media',
     not deleted, case when deleted then 'IT DELETED THEM' else 'refused' end);
end $$;

-- ---------------------------------------------------------------------------
-- The writing assistant's spend limit
-- ---------------------------------------------------------------------------
--
-- ai_usage is not client data, it is a METER, and that changes which properties
-- matter. A leak here is minor: the worst it says is how often somebody asked for
-- help writing a paragraph. What must hold is that the count cannot be got rid
-- of, because the count is the only thing standing between a login and
-- Travelgenix's Anthropic bill.
--
-- Three ways to get rid of it, and all three are checked: delete the rows, move
-- them out of the window by rewriting created_at, or write them against somebody
-- else's tenant so the cost lands on a different site.

-- The fixtures are up at the top with the rest. See the note there.

do $$
declare
  own int; other int;
  planted boolean := true; removed boolean := true; backdated boolean := true;
  counted int;
begin
  set local role tg_sites_app;
  perform set_config('app.current_tenant_id', '11111111-1111-1111-1111-111111111111', true);

  select count(*) into own   from public.ai_usage;
  select count(*) into other from public.ai_usage
    where tenant_id = '22222222-2222-2222-2222-222222222222';

  -- Billing the other tenant for your own request. The WITH CHECK half of the
  -- policy is what refuses this, and without it a site could spend somebody
  -- else's allowance and leave them refused for the rest of the day.
  begin
    insert into public.ai_usage (tenant_id, user_id, intent)
    values ('22222222-2222-2222-2222-222222222222', 'iso-user-ann', 'write');
  exception when others then planted := false; end;

  -- Clearing the meter. There is deliberately no DELETE grant.
  begin
    delete from public.ai_usage;
  exception when others then removed := false; end;

  /*
   * The subtle one, and the reason the UPDATE grant names its columns.
   *
   * The limit counts rows newer than a moment. A table-wide UPDATE grant would
   * carry created_at with it, so one statement moving every row back two days
   * empties the window and hands the allowance back. recordTokens only ever
   * writes the two token counts, so that is all the grant covers.
   */
  begin
    update public.ai_usage set created_at = now() - interval '2 days';
  exception when others then backdated := false; end;

  select count(*) into counted from public.ai_usage
    where created_at > now() - interval '24 hours';

  reset role;
  insert into checks (name, passed, detail) values
    ('a tenant sees its own usage', own = 1, 'saw ' || own || ' of 1'),
    ('and none of another tenants', other = 0, 'leaked ' || other),
    ('a tenant cannot bill its requests to another site',
     not planted, case when planted then 'IT PLANTED ONE' else 'the policy refused it' end),
    ('the meter cannot be cleared by the thing being metered',
     not removed, case when removed then 'IT DELETED THE ROWS' else 'no DELETE grant' end),
    ('and it cannot be backdated out of the window either',
     not backdated,
     case when backdated then 'created_at WAS REWRITTEN' else 'no UPDATE grant on created_at' end),
    ('so the request still counts against today',
     counted = 1, counted || ' in the window');
end $$;

-- The token counts DO have to be writable, or nothing could record what a call
-- cost. Checked as well, because a grant narrowed too far breaks the feature
-- quietly: recordTokens swallows its own errors on purpose.
do $$
declare wrote boolean := true; got int;
begin
  set local role tg_sites_app;
  perform set_config('app.current_tenant_id', '11111111-1111-1111-1111-111111111111', true);
  begin
    update public.ai_usage set input_tokens = 900, output_tokens = 120;
  exception when others then wrote := false; end;
  select coalesce(max(input_tokens), -1) into got from public.ai_usage;
  reset role;

  insert into checks (name, passed, detail) values
    ('what a call cost can still be written down', wrote and got = 900,
     case when wrote then 'recorded ' || got else 'THE UPDATE WAS REFUSED' end);
end $$;

-- ---------------------------------------------------------------------------
-- The activity log
-- ---------------------------------------------------------------------------
--
-- Append-only, and scoped like everything else. What must hold: a tenant reads
-- its own history and none of another's; it cannot write a line against another
-- site; and once written a line cannot be changed or removed, because there is
-- no update or delete grant. The last two are what make it a log rather than a
-- story its subject can rewrite.
--
-- The fixtures are up at the top with the rest.
do $$
declare
  own int; other int;
  planted boolean := true; changed boolean := true; removed boolean := true;
begin
  set local role tg_sites_app;
  perform set_config('app.current_tenant_id', '11111111-1111-1111-1111-111111111111', true);

  select count(*) into own   from public.site_activity;
  select count(*) into other from public.site_activity
    where tenant_id = '22222222-2222-2222-2222-222222222222';

  -- Writing history onto another site. The WITH CHECK half refuses it.
  begin
    insert into public.site_activity (tenant_id, actor_id, action, summary)
    values ('22222222-2222-2222-2222-222222222222', 'iso-user-ann', 'page.delete', 'Deleted the Home page');
  exception when others then planted := false; end;

  -- Rewriting a line. There is deliberately no UPDATE grant.
  begin
    update public.site_activity set summary = 'Nothing happened here';
  exception when others then changed := false; end;

  -- Erasing a line. There is deliberately no DELETE grant.
  begin
    delete from public.site_activity;
  exception when others then removed := false; end;

  reset role;
  insert into checks (name, passed, detail) values
    ('a tenant sees its own activity', own = 1, 'saw ' || own || ' of 1'),
    ('and none of another tenants activity', other = 0, 'leaked ' || other),
    ('a tenant cannot write history onto another site',
     not planted, case when planted then 'IT PLANTED ONE' else 'the policy refused it' end),
    ('the log cannot be rewritten',
     not changed, case when changed then 'A LINE WAS CHANGED' else 'no UPDATE grant' end),
    ('nor a line erased from it',
     not removed, case when removed then 'A LINE WAS DELETED' else 'no DELETE grant' end);
end $$;

-- ---------------------------------------------------------------------------
-- Comments
-- ---------------------------------------------------------------------------
--
-- Scoped like everything else, but NOT append-only: a thread is replied to and
-- resolved, so update is granted where the activity log's is not. What must
-- hold: a tenant reads its own comments and none of another's; it cannot leave a
-- comment on another site; it CAN resolve one of its own; and it still cannot
-- delete, because a review record should not vanish by default. The query layer
-- adds the page-ownership fail-closed (a comment cannot be planted on a page you
-- cannot see) on top of this, proven separately in tests/db.test.ts.
--
-- Fixtures are up at the top with the rest.
do $$
declare
  own int; other int;
  planted boolean := true; resolved_ok boolean := false; removed boolean := true;
begin
  set local role tg_sites_app;
  perform set_config('app.current_tenant_id', '11111111-1111-1111-1111-111111111111', true);

  select count(*) into own   from public.site_comments;
  select count(*) into other from public.site_comments
    where tenant_id = '22222222-2222-2222-2222-222222222222';

  -- Commenting on another site. The WITH CHECK half refuses it.
  begin
    insert into public.site_comments (tenant_id, page_id, author_id, body)
    values ('22222222-2222-2222-2222-222222222222',
            'bbbbbbbb-0000-0000-0000-00000000b001', 'iso-user-ann', 'sneaky');
  exception when others then planted := false; end;

  -- Resolving its own thread. Update IS granted here, unlike the log.
  begin
    update public.site_comments set resolved_at = now(), resolved_by = 'iso-user-ann'
      where id = 'cccccccc-0000-0000-0000-00000000c001';
    resolved_ok := true;
  exception when others then resolved_ok := false; end;

  -- Erasing one. There is deliberately no DELETE grant.
  begin
    delete from public.site_comments;
  exception when others then removed := false; end;

  reset role;
  insert into checks (name, passed, detail) values
    ('a tenant sees its own comments', own = 2, 'saw ' || own || ' of 2'),
    ('and none of another tenants comments', other = 0, 'leaked ' || other),
    ('a tenant cannot comment on another site',
     not planted, case when planted then 'IT PLANTED ONE' else 'the policy refused it' end),
    ('a tenant can resolve its own thread',
     resolved_ok, case when resolved_ok then 'update granted' else 'IT COULD NOT RESOLVE' end),
    ('a comment cannot be deleted',
     not removed, case when removed then 'A COMMENT WAS DELETED' else 'no DELETE grant' end);
end $$;

-- ---------------------------------------------------------------------------
-- The header and the footer
-- ---------------------------------------------------------------------------
--
-- A page keeps its draft away from the public renderer with a row policy,
-- because a draft page is a whole row. A region cannot: its draft and its live
-- copy are two COLUMNS OF THE SAME ROW, so a row policy has nothing to bite on
-- and the guarantee has to be a column grant instead.
--
-- That is a different mechanism from every other table here, which is exactly
-- why it is worth proving rather than assuming. An unfinished header appearing
-- on a live site would appear on every url of it.
--
-- The second block is the one that makes the first mean anything. A probe that
-- reports "refused" for a column the renderer IS allowed would report "refused"
-- for everything, and would be detecting nothing.
do $$
declare read_draft boolean := false; read_live boolean := false;
begin
  set local role tg_sites_renderer;
  perform set_config('app.current_tenant_id', '11111111-1111-1111-1111-111111111111', true);

  begin
    perform draft_content from public.site_regions limit 1;
    read_draft := true;
  exception when insufficient_privilege then read_draft := false; end;

  begin
    perform published_content from public.site_regions limit 1;
    read_live := true;
  exception when insufficient_privilege then read_live := false; end;

  reset role;
  insert into checks (name, passed, detail) values
    ('a visitor cannot be shown an unpublished header',
     not read_draft,
     case when read_draft then 'IT READ draft_content' else 'no grant on draft_content' end),
    ('and the probe above can tell a granted column from a refused one',
     read_live,
     case when read_live then 'published_content read fine'
          else 'THE PROBE REFUSES EVERYTHING, so it proves nothing' end);
end $$;

-- One header and one footer per tenant, said in the primary key so it is the
-- database's promise rather than the application's hope.
do $$
declare doubled boolean := false;
begin
  insert into public.site_regions (tenant_id, region)
    values ('11111111-1111-1111-1111-111111111111', 'header')
    on conflict do nothing;

  begin
    insert into public.site_regions (tenant_id, region)
      values ('11111111-1111-1111-1111-111111111111', 'header');
    doubled := true;
  exception when unique_violation then doubled := false; end;

  insert into checks (name, passed, detail) values
    ('a site cannot end up with two headers',
     not doubled,
     case when doubled then 'IT MADE A SECOND ONE' else 'the primary key refused it' end);
end $$;

-- ---------------------------------------------------------------------------
-- Collections and their entries
-- ---------------------------------------------------------------------------
--
-- A blog post keeps its unfinished state away from visitors the way a page
-- does, with a row policy: `tenant_id = current_tenant() and status =
-- 'published'`, written in 0004. lib/db/collections.ts has NO status filter in
-- its public queries and says so at the top, on the grounds that the database
-- is the thing enforcing it. This is where that claim is checked.
--
-- The second half of each pair is what makes the first half mean anything. A
-- probe that sees nothing at all would report "the draft is hidden" while
-- proving only that it is blind.
do $$
declare saw_draft int; saw_live int; wrote boolean := false; other int;
begin
  insert into public.collections (id, tenant_id, key, name) values
    ('cccc0000-0000-0000-0000-00000000c001',
     '11111111-1111-1111-1111-111111111111', 'iso-blog', 'Blog'),
    ('cccc0000-0000-0000-0000-00000000c002',
     '22222222-2222-2222-2222-222222222222', 'iso-blog', 'Blog');

  insert into public.collection_items (id, collection_id, tenant_id, slug, status, data) values
    ('cccc0000-0000-0000-0000-0000000000d1',
     'cccc0000-0000-0000-0000-00000000c001',
     '11111111-1111-1111-1111-111111111111', 'unfinished', 'draft',
     '{"version":1,"title":"Not ready"}'::jsonb),
    ('cccc0000-0000-0000-0000-0000000000d2',
     'cccc0000-0000-0000-0000-00000000c001',
     '11111111-1111-1111-1111-111111111111', 'out-now', 'published',
     '{"version":1,"title":"Out now"}'::jsonb),
    -- The other client's post, published, so the only reason to miss it is
    -- the tenant rather than the status.
    ('cccc0000-0000-0000-0000-0000000000d3',
     'cccc0000-0000-0000-0000-00000000c002',
     '22222222-2222-2222-2222-222222222222', 'theirs', 'published',
     '{"version":1,"title":"Theirs"}'::jsonb);

  set local role tg_sites_renderer;
  perform set_config('app.current_tenant_id', '11111111-1111-1111-1111-111111111111', true);

  select count(*) into saw_draft from public.collection_items where slug = 'unfinished';
  select count(*) into saw_live  from public.collection_items where slug = 'out-now';
  select count(*) into other     from public.collection_items where slug = 'theirs';

  begin
    update public.collection_items set slug = 'hijacked' where slug = 'out-now';
    wrote := true;
  exception when others then wrote := false; end;

  reset role;
  insert into checks (name, passed, detail) values
    ('a visitor cannot be shown an unpublished post',
     saw_draft = 0, 'leaked ' || saw_draft),
    ('and the probe above can still see a published one',
     saw_live = 1,
     case when saw_live = 1 then 'read it fine'
          else 'THE PROBE SEES NOTHING, so it proves nothing' end),
    ('a published post of another client stays hidden',
     other = 0, 'leaked ' || other),
    ('the renderer cannot edit a post',
     not wrote, case when wrote then 'IT CHANGED THE ROW' else 'refused' end);
end $$;

-- ---------------------------------------------------------------------------
-- The one thing the policies do NOT catch, written down so it stays caught
-- ---------------------------------------------------------------------------
--
-- Every other check in this file proves the database refuses something. This one
-- proves it does NOT, which is why lib/db/collections.ts has to.
--
-- collection_items.collection_id is a plain foreign key with no tenant in it.
-- The WITH CHECK policy asks only whether the new row's tenant_id is ours, and
-- with a straight INSERT ... VALUES it is: the row goes in pointing at another
-- client's collection. Nothing would ever render it, but a client should not be
-- able to write a row into somebody else's account at all.
--
-- So createItem inserts with SELECT ... FROM public.collections instead, which
-- puts the id through that table's own policy first. The second half here is the
-- proof that the fix works, run as SQL rather than taken on trust.
do $$
declare naive_worked boolean := false; scoped_wrote int;
begin
  set local role tg_sites_app;
  perform set_config('app.current_tenant_id', '11111111-1111-1111-1111-111111111111', true);

  -- What the obvious insert would do. Note the tenant is honestly ours.
  begin
    insert into public.collection_items (tenant_id, collection_id, slug, data)
      values ('11111111-1111-1111-1111-111111111111',
              'cccc0000-0000-0000-0000-00000000c002', 'planted', '{"version":1}'::jsonb);
    naive_worked := true;
  exception when others then naive_worked := false; end;

  -- What the query layer actually does.
  insert into public.collection_items (tenant_id, collection_id, slug, data)
    select '11111111-1111-1111-1111-111111111111', c.id, 'scoped', '{"version":1}'::jsonb
    from public.collections c
    where c.id = 'cccc0000-0000-0000-0000-00000000c002';
  get diagnostics scoped_wrote = row_count;

  reset role;
  insert into checks (name, passed, detail) values
    -- Recorded as a PASS when the naive insert DID work, because that is the
    -- true statement about this schema and the reason the query is shaped as it
    -- is. If this ever starts failing, the database has grown a defence of its
    -- own and the note in lib/db/collections.ts wants revisiting.
    ('a policy alone would let an entry point at another clients collection',
     naive_worked,
     case when naive_worked then 'as expected, hence the scoped insert'
          else 'the database refuses it now, so the note in collections.ts is stale' end),
    ('selecting the collection first is what refuses it',
     scoped_wrote = 0, 'rows written: ' || scoped_wrote);

  delete from public.collection_items where slug in ('planted', 'scoped');
end $$;

-- An entry's address is unique inside its collection and nowhere wider. Two
-- clients both wanting /blog/summer-in-crete is the normal case, not a clash.
do $$
declare doubled boolean := false; across boolean := false;
begin
  begin
    insert into public.collection_items (collection_id, tenant_id, slug, data)
      values ('cccc0000-0000-0000-0000-00000000c001',
              '11111111-1111-1111-1111-111111111111', 'out-now', '{"version":1}'::jsonb);
    doubled := true;
  exception when unique_violation then doubled := false; end;

  begin
    insert into public.collection_items (collection_id, tenant_id, slug, data)
      values ('cccc0000-0000-0000-0000-00000000c002',
              '22222222-2222-2222-2222-222222222222', 'out-now', '{"version":1}'::jsonb);
    across := true;
  exception when unique_violation then across := false; end;

  insert into checks (name, passed, detail) values
    ('two entries cannot share an address in one collection',
     not doubled, case when doubled then 'IT MADE A SECOND ONE' else 'refused' end),
    ('but two clients can each have the same one',
     across, case when across then 'both exist' else 'IT REFUSED A LEGITIMATE ADDRESS' end);
end $$;

-- Deleting a collection takes its entries. Otherwise a client who removes their
-- blog leaves every post behind, invisible and undeletable, still counting
-- towards their storage and still readable by a query that names the item id.
do $$
declare left_behind int;
begin
  delete from public.collections where id = 'cccc0000-0000-0000-0000-00000000c001';
  select count(*) into left_behind from public.collection_items
    where collection_id = 'cccc0000-0000-0000-0000-00000000c001';

  insert into checks (name, passed, detail) values
    ('deleting a collection removes its entries',
     left_behind = 0, 'left behind ' || left_behind);
end $$;

-- Deleting a tenant must take its fonts, their bytes and its media rows with it.
-- A removed client's licensed font files must not stay in the database, and a
-- media row left behind is a dangling reference to a blob nobody will ever tidy
-- up: the row is the only record that the object exists.
do $$
declare fonts_left int; files_left int; media_left int; usage_left int;
begin
  delete from public.tenants where id = '22222222-2222-2222-2222-222222222222';

  select count(*) into fonts_left from public.fonts
    where slug = 'beta-grotesk';
  select count(*) into files_left from public.font_files
    where font_id = 'dddd0000-0000-0000-0000-00000000d001';
  select count(*) into media_left from public.media
    where id = 'ffff0000-0000-0000-0000-00000000f001';
  select count(*) into usage_left from public.ai_usage
    where tenant_id = '22222222-2222-2222-2222-222222222222';

  insert into checks (name, passed, detail) values
    ('deleting a tenant removes its fonts and their bytes',
     fonts_left = 0 and files_left = 0,
     format('fonts %s, files %s', fonts_left, files_left)),
    ('deleting a tenant removes its media rows',
     media_left = 0, 'left behind ' || media_left),
    -- Otherwise a removed client's meter rows keep pointing at a tenant that is
    -- gone, and the table grows forever with nothing able to read it.
    ('deleting a tenant removes its usage rows',
     usage_left = 0, 'left behind ' || usage_left);
end $$;

-- ---------------------------------------------------------------------------
-- Redirects: old addresses, and whose they are
-- ---------------------------------------------------------------------------
--
-- page_redirects is the ONE table the renderer may read without a published
-- filter, because a redirect is a fact about an address rather than content: it
-- holds no words, no pictures and nothing a competitor could learn. So the
-- tenant policy is doing all the work here, and it is worth checking on its own
-- rather than assuming it works because the others do.
--
-- The second half of each pair is what makes the first mean anything. A probe
-- that sees nothing at all would report "the other client's redirect is hidden"
-- while proving only that it is blind.
do $$
declare mine int; theirs int; leaked boolean := false;
begin
  insert into public.page_redirects (tenant_id, from_path, page_id) values
    ('11111111-1111-1111-1111-111111111111', 'iso-was-here',
     'aaaaaaaa-0000-0000-0000-00000000a001'),
    ('22222222-2222-2222-2222-222222222222', 'iso-beta-was-here',
     'bbbbbbbb-0000-0000-0000-00000000b001');

  set local role tg_sites_renderer;
  perform set_config('app.current_tenant_id', '11111111-1111-1111-1111-111111111111', true);

  select count(*) into mine from public.page_redirects where from_path = 'iso-was-here';
  select count(*) into theirs from public.page_redirects where from_path = 'iso-beta-was-here';

  reset role;
  insert into checks (name, passed, detail) values
    ('a visitor''s redirect lookup finds this site''s own old address',
     mine = 1, 'saw ' || mine),
    ('and never another client''s, even though redirects have no published flag',
     theirs = 0,
     case when theirs > 0 then 'IT READ ANOTHER TENANT''S REDIRECT'
          else 'the tenant policy hid it' end);

  -- And the app role cannot plant one in somebody else's site, the same claim
  -- that is made for pages a few blocks up.
  set local role tg_sites_app;
  perform set_config('app.current_tenant_id', '11111111-1111-1111-1111-111111111111', true);

  begin
    insert into public.page_redirects (tenant_id, from_path, page_id)
      values ('22222222-2222-2222-2222-222222222222', 'iso-planted',
              'bbbbbbbb-0000-0000-0000-00000000b001');
    leaked := true;
  exception when others then leaked := false; end;

  reset role;
  insert into checks (name, passed, detail) values
    ('a redirect cannot be written into another client''s site',
     not leaked,
     case when leaked then 'THE ROW WAS WRITTEN' else 'WITH CHECK rejected it' end);
end $$;

-- A redirect to a deleted page is a 404 with extra steps, so the row goes with
-- the page. Stated in the schema as ON DELETE CASCADE, checked here.
do $$
declare left_behind int;
begin
  insert into public.pages (id, tenant_id, slug, title, status, published_content) values
    ('aaaaaaaa-0000-0000-0000-00000000a003',
     '11111111-1111-1111-1111-111111111111', 'iso-doomed', 'Doomed', 'published',
     '{"version":1,"sections":[]}');

  insert into public.page_redirects (tenant_id, from_path, page_id) values
    ('11111111-1111-1111-1111-111111111111', 'iso-doomed-was-here',
     'aaaaaaaa-0000-0000-0000-00000000a003');

  delete from public.pages where id = 'aaaaaaaa-0000-0000-0000-00000000a003';

  select count(*) into left_behind
  from public.page_redirects where from_path = 'iso-doomed-was-here';

  insert into checks (name, passed, detail) values
    ('deleting a page removes the redirects pointing at it',
     left_behind = 0, 'left behind ' || left_behind);
end $$;

-- ---------------------------------------------------------------------------
-- Invites, and the one policy that is keyed on a token rather than a tenant
-- ---------------------------------------------------------------------------
--
-- site_invites is read two ways: by an owner listing their own site's invites,
-- which is the ordinary tenant policy, and by somebody redeeming a link, who is
-- by definition not in the tenant yet. The second is the interesting one, and it
-- is the same shape as the sign-in policy: a transaction-local setting holding
-- the hash, and a policy revealing precisely the row that matches it.
--
-- What must hold: naming one hash reveals one row and no others, and naming no
-- hash reveals nothing at all. The second half is what stops a query that forgot
-- to set the setting from returning every client's pending invites.
do $$
declare mine int; theirs int; loose int; without_setting int;
begin
  insert into public.site_invites (tenant_id, email, role, token_hash) values
    ('11111111-1111-1111-1111-111111111111', 'iso-alpha@example.com', 'editor',
     repeat('a', 64)),
    ('22222222-2222-2222-2222-222222222222', 'iso-beta@example.com', 'owner',
     repeat('b', 64));

  set local role tg_sites_app;
  perform set_config('app.current_tenant_id', '', true);
  perform set_config('app.invite_token_hash', repeat('a', 64), true);

  select count(*) into mine from public.site_invites where token_hash = repeat('a', 64);
  select count(*) into theirs from public.site_invites where token_hash = repeat('b', 64);
  -- No filter at all: the policy is the filter, and it must still be one row.
  select count(*) into loose from public.site_invites;

  perform set_config('app.invite_token_hash', '', true);
  select count(*) into without_setting from public.site_invites;

  reset role;
  insert into checks (name, passed, detail) values
    ('an invite link finds the one row it names', mine = 1, 'saw ' || mine),
    ('and never another one, even with the hash in hand',
     theirs = 0,
     case when theirs > 0 then 'IT READ AN INVITE IT DID NOT NAME'
          else 'the token policy hid it' end),
    ('a query with no filter still sees only the named invite',
     loose = 1, 'saw ' || loose),
    -- The half that makes the rest mean anything. With nothing set,
    -- invite_hash() is NULL and NULL = anything is NULL, so no row qualifies.
    ('and with no token set at all it sees nothing',
     without_setting = 0,
     case when without_setting > 0 then 'IT READ ' || without_setting || ' INVITES'
          else 'no token, no rows' end);
end $$;

-- An owner lists their own site's invites through the ordinary tenant policy,
-- and cannot plant one in somebody else's site.
do $$
declare mine int; theirs int; leaked boolean := false;
begin
  set local role tg_sites_app;
  perform set_config('app.invite_token_hash', '', true);
  perform set_config('app.current_tenant_id', '11111111-1111-1111-1111-111111111111', true);

  select count(*) into mine from public.site_invites;
  select count(*) into theirs from public.site_invites
    where email = 'iso-beta@example.com';

  begin
    insert into public.site_invites (tenant_id, email, role, token_hash)
      values ('22222222-2222-2222-2222-222222222222', 'iso-planted@example.com',
              'owner', repeat('c', 64));
    leaked := true;
  exception when others then leaked := false; end;

  reset role;
  insert into checks (name, passed, detail) values
    ('an owner sees their own pending invites', mine = 1, 'saw ' || mine),
    ('and not another client''s', theirs = 0, 'saw ' || theirs),
    ('an invite cannot be planted in another client''s site',
     not leaked,
     case when leaked then 'THE ROW WAS WRITTEN' else 'WITH CHECK rejected it' end);
end $$;

-- ---------------------------------------------------------------------------
-- Seeing a colleague, and only a colleague
-- ---------------------------------------------------------------------------
--
-- auth_users_teammates was added in 0019 so the members screen is not a column
-- of blank names. It is the first policy that lets the app role read somebody
-- else's account row at all, so the thing to prove is where it stops: inside the
-- tenant currently open, and nowhere else.
do $$
declare same_site int; other_site int; no_tenant int;
begin
  insert into public.tenant_users (tenant_id, user_id, role) values
    ('11111111-1111-1111-1111-111111111111', 'iso-user-bob', 'editor')
  on conflict do nothing;

  set local role tg_sites_app;
  perform set_config('app.current_user_id', 'iso-user-ann', true);
  perform set_config('app.current_tenant_id', '11111111-1111-1111-1111-111111111111', true);

  -- Bob is in this site, so Ann can see his row.
  select count(*) into same_site from public.auth_users where id = 'iso-user-bob';

  -- Switch to the site Ann is in and Bob is not.
  perform set_config('app.current_tenant_id', '33333333-3333-3333-3333-333333333333', true);
  select count(*) into other_site from public.auth_users where id = 'iso-user-bob';

  -- And with no tenant at all, auth_users_self is on its own again.
  perform set_config('app.current_tenant_id', '', true);
  select count(*) into no_tenant from public.auth_users where id = 'iso-user-bob';

  reset role;
  insert into checks (name, passed, detail) values
    ('a members list can read the people in this site', same_site = 1, 'saw ' || same_site),
    ('and cannot read somebody who is not in it',
     other_site = 0,
     case when other_site > 0 then 'IT READ A NON-MEMBER''S ACCOUNT ROW'
          else 'the teammate policy stopped at the tenant' end),
    ('and reads nobody but yourself with no site open',
     no_tenant = 0,
     case when no_tenant > 0 then 'IT READ ANOTHER ACCOUNT WITH NO TENANT SET'
          else 'no tenant, no teammates' end);
end $$;

-- ---------------------------------------------------------------------------
-- Form submissions
-- ---------------------------------------------------------------------------
--
-- The first table the PUBLIC side may write. The doctrine holds by
-- construction: the renderer role has NO privilege on the table, only EXECUTE
-- on public.submit_form, which takes its tenant from the transaction setting
-- and refuses when none is set. So the checks are: the app role is fenced to
-- its tenant as usual and cannot delete; the renderer cannot SELECT the table
-- at all; the function stores for the tenant that is set and refuses with none.
do $$
declare
  own int := -1; other int := -1;
  planted boolean := true; removed boolean := true;
  renderer_read boolean := true;
  stored boolean := false; unset_stored boolean := true;
begin
  set local role tg_sites_app;
  perform set_config('app.current_tenant_id', '11111111-1111-1111-1111-111111111111', true);

  -- One legitimate enquiry, filed by the app role for its own tenant.
  insert into public.form_submissions (tenant_id, form_block_id, form_name, data)
  values ('11111111-1111-1111-1111-111111111111', 'b_iso', 'Iso', '{"Name":"Ann"}'::jsonb);

  select count(*) into own   from public.form_submissions;
  select count(*) into other from public.form_submissions
    where tenant_id = '22222222-2222-2222-2222-222222222222';

  -- Filing one against another site. The WITH CHECK half refuses it.
  begin
    insert into public.form_submissions (tenant_id, form_block_id, form_name, data)
    values ('22222222-2222-2222-2222-222222222222', 'b_iso', 'Iso', '{"Name":"sneaky"}'::jsonb);
  exception when others then planted := false; end;

  -- Erasing one. There is deliberately no DELETE grant.
  begin
    delete from public.form_submissions;
  exception when others then removed := false; end;

  reset role;

  set local role tg_sites_renderer;
  perform set_config('app.current_tenant_id', '11111111-1111-1111-1111-111111111111', true);

  -- The public role reading enquiries back. No grant, so no.
  begin
    perform count(*) from public.form_submissions;
  exception when others then renderer_read := false; end;

  -- The one write door, for the tenant that is set.
  select public.submit_form(null, 'b_iso', 'Iso', '{"Name":"Visitor"}'::jsonb, '{}'::jsonb)
    into stored;

  -- And with no tenant set, the door is shut. Cleared by name: trap 2 above.
  perform set_config('app.current_tenant_id', '', true);
  select public.submit_form(null, 'b_iso', 'Iso', '{"Name":"ghost"}'::jsonb, '{}'::jsonb)
    into unset_stored;

  reset role;
  insert into checks (name, passed, detail) values
    ('a tenant sees its own enquiries', own = 1, 'saw ' || own || ' of 1'),
    ('and none of another tenants enquiries', other = 0, 'leaked ' || other),
    ('a tenant cannot file an enquiry against another site',
     not planted, case when planted then 'IT PLANTED ONE' else 'the policy refused it' end),
    ('an enquiry cannot be deleted',
     not removed, case when removed then 'AN ENQUIRY WAS DELETED' else 'no DELETE grant' end),
    ('the renderer cannot read enquiries',
     not renderer_read, case when renderer_read then 'THE PUBLIC ROLE READ THE TABLE' else 'no SELECT grant' end),
    ('the renderer can file one through submit_form',
     stored, case when stored then 'the definer function stored it' else 'IT COULD NOT STORE' end),
    ('submit_form refuses with no tenant set',
     not unset_stored, case when unset_stored then 'IT STORED WITHOUT A TENANT' else 'refused' end);
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
delete from public.form_submissions where form_block_id = 'b_iso';
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
