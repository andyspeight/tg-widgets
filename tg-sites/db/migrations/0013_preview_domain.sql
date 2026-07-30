-- ---------------------------------------------------------------------------
-- 0013  The preview domain moves off travelify.io
-- ---------------------------------------------------------------------------
--
-- WHY THIS EXISTS
--
-- 0012 pointed the reserved-suffix guard at sites.travelify.io. That fixed a real
-- bug, the previous guard named .tgsites.io which is a domain we do not own, and it
-- introduced a worse one that nobody noticed at the time.
--
-- api/_lib/auth/cookie.js in the widget suite sets tg_session on
-- Domain=.travelify.io, HttpOnly, Secure, SameSite=Lax, shared across id, marketing,
-- chat, widgets and trends. Site owners can now put arbitrary script on their own
-- site. A client site on any *.travelify.io hostname therefore runs script inside
-- that cookie's scope: HttpOnly stops the script READING the token, and SameSite=Lax
-- still has the browser ATTACH the cookie to same-site requests, so the script could
-- act as the signed-in Travelify user against every other product's API without ever
-- seeing the credential.
--
-- Cookie scope is per REGISTRABLE domain, so the fix is a different registrable
-- domain rather than a different subdomain. Andy chose travelgenixsites.com on
-- 30 Jul 2026. It is the same thing Wix, Webflow and Shopify do, for the same
-- reason: wixsite.com, webflow.io, myshopify.com.
--
-- Note what the 0012 guard DID get right and this keeps: hostname is globally
-- unique, so without a per-kind guard a client could add another agency's preview
-- hostname as their own custom domain, first come first served, and take over their
-- preview URL.
--
-- NOTHING OF OURS MAY EVER BE SERVED FROM travelgenixsites.com. No dashboard, no
-- API, no cookie. The moment something of ours sets a cookie there, this migration
-- is decoration.
--
-- The suffix is also written down in tg-sites/lib/domains/preview.ts, because a
-- check constraint cannot import a module. tests/settings.test.ts reads this file
-- and asserts the two agree.
--
-- Safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. The reserved suffix, pointed at a domain that is not travelify.io
-- ---------------------------------------------------------------------------

alter table public.domains drop constraint if exists domains_no_staging_suffix;
alter table public.domains drop constraint if exists domains_reserved_suffix;

alter table public.domains add constraint domains_reserved_suffix check (
  case kind
    -- Ours. A single label beneath the suffix, so a preview row cannot be a nested
    -- hostname nobody can route, and cannot be one of the labels reserved below.
    when 'preview' then hostname ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?\.travelgenixsites\.com$'
    -- Theirs. Must NOT be under it, and must not BE it. The second half matters:
    -- '%.travelgenixsites.com' does not match the apex on its own.
    else hostname not like '%.travelgenixsites.com' and hostname <> 'travelgenixsites.com'
  end
);

-- ---------------------------------------------------------------------------
-- 2. Labels a preview row cannot use
-- ---------------------------------------------------------------------------

/*
 * Separate from the constraint above so a failure says WHICH rule was broken.
 *
 * www.travelgenixsites.com would look like the apex and api or admin look like
 * infrastructure, both of which are confusing at best and useful to somebody
 * phishing at worst. None of these can arise from a tenant slug today because we
 * choose the slugs, and the point of a reserved list is that it survives the day
 * somebody lets a client choose their own.
 *
 * MUST match RESERVED_LABELS in tg-sites/lib/domains/preview.ts. There is a test.
 */
alter table public.domains drop constraint if exists domains_reserved_label;

alter table public.domains add constraint domains_reserved_label check (
  kind <> 'preview'
  or split_part(hostname, '.', 1) not in (
    'www', 'api', 'app', 'admin', 'mail', 'smtp', 'ftp', 'cdn', 'static',
    'assets', 'status', 'support', 'help', 'billing', 'login', 'signin',
    'auth', 'id', 'preview', 'staging', 'test', 'dev'
  )
);

-- ---------------------------------------------------------------------------
-- 3. resolve_tenant, which is where a preview hostname is ACTUALLY resolved
-- ---------------------------------------------------------------------------

/*
 * THE PART THAT MAKES ANY OF THIS WORK, and it was nearly missed.
 *
 * 0006 hardcoded the free-for-every-tenant hostname as slug || '.tgsites.io' inside
 * this function. The constraints above only govern what may be WRITTEN to domains; a
 * preview hostname needs no domains row at all, it is resolved here by string
 * comparison. So changing the constraints and the middleware without changing this
 * would have left every preview URL resolving to nothing, on a domain whose whole
 * purpose is to be reachable before DNS is pointed anywhere.
 *
 * That is three places one domain name is written down, which is why
 * tg-sites/lib/domains/preview.ts now exists and why the tests read this file.
 *
 * CREATE OR REPLACE, same signature, deliberately. This is the ONLY SECURITY DEFINER
 * function in the database and db/isolation-check.sql asserts that there is exactly
 * one. A second overload would be a second answer to "what can see past RLS".
 *
 * Body otherwise unchanged from 0006, including the empty search_path, so a caller
 * cannot plant their own domains table on the path.
 */
create or replace function public.resolve_tenant(host text)
returns uuid
language sql
stable
security definer
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
    -- The preview subdomain every tenant always has, so a site is reachable
    -- before anyone points DNS at it.
    select t.id, 2
    from public.tenants t
    where t.status = 'active'
      and lower(trim(host)) = t.slug || '.travelgenixsites.com'
  ) m
  order by rank
  limit 1
$$;

comment on function public.resolve_tenant(text) is
  'Hostname to tenant id, or NULL. The only function here that sees past RLS.';

-- Re-granted because create or replace on a function does not preserve grants in
-- every Postgres version, and a resolver the roles cannot execute 404s every site.
revoke all on function public.resolve_tenant(text) from public, anon, authenticated;
grant execute on function public.resolve_tenant(text)
  to tg_sites_app, tg_sites_renderer;

-- ---------------------------------------------------------------------------
-- 4. The comment on tenants.slug, which still described .tgsites.io
-- ---------------------------------------------------------------------------

-- 0002_core_tables.sql documents the column as "{slug}.tgsites.io". Left stale it
-- is the same trap twice: somebody reads it and builds against a domain we do not
-- own. Comments are cheap to fix and expensive to leave.
comment on column public.tenants.slug is
  'URL-safe identifier. Also the label of the preview hostname, '
  '{slug}.travelgenixsites.com. See tg-sites/lib/domains/preview.ts.';
