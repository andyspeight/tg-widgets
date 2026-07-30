-- Site settings, domains that can actually be verified, and a way back from a
-- bad publish.
--
-- THREE THINGS IN HERE AND ONE OF THEM IS A CORRECTION
--
-- 1. A second settings column, for the things only Travelgenix may set.
-- 2. The domains table pointed at the certificate provider we actually chose, and
--    its reserved-suffix guard pointed at the domain we actually own.
-- 3. page_versions, so a publish can be undone days later.

-- ---------------------------------------------------------------------------
-- 1. Settings, in two columns rather than one
-- ---------------------------------------------------------------------------

/*
 * tenants.settings already existed and is what a client may change: analytics
 * ids, a favicon, a social image, a home screen icon, the site language.
 *
 * staff_settings is new and holds the two fields a client may NOT change: raw
 * HTML injected into the head and the body. Andy's call, 30 Jul 2026, and the
 * right one, because arbitrary HTML on a page is arbitrary script on a page.
 *
 * WHY A SEPARATE COLUMN AND NOT A FIELD INSIDE settings
 *
 * Because then the client's save action has no path to it at all. One blob would
 * mean the save action parsing a client's whole object and stripping the fields
 * they are not allowed to set, and a stripping bug is an injected script on a
 * live travel site. Two columns turn that from a filtering problem into a
 * structural one: the action that a client can reach writes `settings`, names
 * that column, and could not touch the other one if it tried.
 *
 * Exactly the same reasoning as the two-policy split in 0008_auth.sql, where a
 * SELECT policy sits beside a FOR ALL one rather than being merged into it.
 */
alter table public.tenants
  add column if not exists staff_settings jsonb not null default '{}'::jsonb;

comment on column public.tenants.settings is
  'Client-editable site settings. Written by the settings action any member can reach.';
comment on column public.tenants.staff_settings is
  'Travelgenix-only settings: head and body HTML. Never written by a client-reachable path.';

-- ---------------------------------------------------------------------------
-- 2. Domains
-- ---------------------------------------------------------------------------

/*
 * cf_hostname_id becomes provider_id.
 *
 * The column was named for Cloudflare, because that was the plan when this table
 * was written. The decision on 30 Jul 2026 was Vercel, with the provider behind
 * an interface so Cloudflare for SaaS stays a one-file swap. A column called
 * cf_hostname_id holding a Vercel domain name is the kind of lie that costs
 * somebody an hour at exactly the wrong moment, and it is empty today, so it
 * costs nothing to fix now and would cost a data migration later.
 */
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'domains' and column_name = 'cf_hostname_id'
  ) then
    alter table public.domains rename column cf_hostname_id to provider_id;
  end if;
end $$;

alter table public.domains
  -- Which provider issued the certificate. Recorded rather than assumed, so a
  -- half-migrated table after a provider swap is readable instead of ambiguous.
  add column if not exists provider text
    check (provider is null or provider in ('vercel', 'cloudflare')),

  /*
   * A preview hostname or one the client owns.
   *
   * They behave differently in every way that matters: a preview is created by us
   * and must not be deletable, a custom one is added by the client and must be
   * verified before it serves anything. Without this column the two are
   * indistinguishable and every query has to guess from the hostname's shape.
   */
  add column if not exists kind text not null default 'custom'
    check (kind in ('preview', 'custom')),

  /*
   * The provider's verification challenge, as given.
   *
   * Stored rather than re-fetched because the client needs to be shown the exact
   * record to add, and they will come back to it tomorrow after speaking to
   * whoever runs their DNS. Re-asking the provider every page load would be a
   * network call to render a text field.
   */
  add column if not exists verification jsonb not null default '[]'::jsonb;

create index if not exists domains_tenant_idx on public.domains (tenant_id);

/*
 * THE RESERVED SUFFIX GUARD, POINTED AT THE RIGHT DOMAIN.
 *
 * The original constraint refused any hostname ending in .tgsites.io, which was
 * the intended preview domain at the time. The preview domain is now
 * sites.travelify.io (Andy, 30 Jul 2026), so the old guard was protecting a
 * domain we do not use and leaving the one we do wide open.
 *
 * That gap is worth naming. Without this, a client could add
 * someone-elses-slug.sites.travelify.io as their own "custom" domain and take
 * over another agency's preview URL. The hostname column is globally unique, so
 * it would be first come first served.
 *
 * Expressed per KIND rather than as a blanket ban, because our own preview rows
 * live under that suffix and a flat refusal would block the feature it protects.
 */
alter table public.domains drop constraint if exists domains_no_staging_suffix;
alter table public.domains drop constraint if exists domains_reserved_suffix;
alter table public.domains add constraint domains_reserved_suffix check (
  case kind
    -- Ours. Must be under the reserved suffix and must be a single label beneath
    -- it, so a preview row cannot be a nested hostname nobody can route.
    when 'preview' then hostname ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?\.sites\.travelify\.io$'
    -- Theirs. Must NOT be under it, whatever they type.
    else hostname not like '%.sites.travelify.io' and hostname <> 'sites.travelify.io'
  end
);

-- One primary per tenant, enforced rather than hoped for. A site with two
-- primary domains has no answer to "what is the canonical URL", which is the
-- question every og:url and every canonical link tag asks.
create unique index if not exists domains_one_primary_per_tenant
  on public.domains (tenant_id) where is_primary;

-- ---------------------------------------------------------------------------
-- 3. Publish snapshots
-- ---------------------------------------------------------------------------

/*
 * A copy of a page as it was published, so a bad change can be undone.
 *
 * WHY ON PUBLISH AND NOT ON SAVE
 *
 * A draft saves on a timer while somebody types, so versioning saves would store
 * hundreds of rows a day per page, most of them a half-typed heading. A publish
 * is a deliberate act with a moment attached, which is exactly what somebody
 * means when they say "put it back to how it was on Tuesday".
 *
 * WHY THE CONTENT IS COPIED RATHER THAN REFERENCED
 *
 * The whole point is to survive the current row changing. A reference to
 * pages.published_content would show the version that is live now, which is the
 * one thing a person restoring a version is definitely not looking for.
 */
-- SUPERSEDED BY 0014_publish_snapshots.sql, WHICH DROPS THIS TABLE.
--
-- Nothing was ever written to it. publish_events had existed since 0003 for exactly
-- this job, was already written inside the publish transaction, and was already
-- under test; this migration added a second table for it without noticing. The SQL
-- below is left exactly as it ran, because a migration is a record of what happened
-- rather than a description of the current schema. Do not build against it.
create table if not exists public.page_versions (
  id         uuid primary key default gen_random_uuid(),

  -- Denormalised from pages, deliberately, so every policy in this schema stays
  -- `tenant_id = current_tenant()` and this table needs no join to be scoped.
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  page_id    uuid not null references public.pages(id) on delete cascade,

  -- The page as it went live. Not a diff: a diff chain is only as good as its
  -- oldest link and cannot be read without replaying everything before it.
  content    jsonb not null,
  -- The SEO fields too, because they live in columns rather than in the content
  -- and a restore that put the body back but not the search title would be a
  -- restore that quietly did half the job.
  seo        jsonb not null default '{}'::jsonb,
  title      text not null,

  -- Who pressed publish, and when. The identity provider's subject, matching
  -- pages.updated_by.
  published_by text,
  published_at timestamptz not null default now()
);

create index if not exists page_versions_page_idx
  on public.page_versions (page_id, published_at desc);

alter table public.page_versions enable row level security;
alter table public.page_versions force  row level security;

create policy page_versions_app on public.page_versions
  for all to tg_sites_app
  using (tenant_id = public.current_tenant())
  with check (tenant_id = public.current_tenant());

/*
 * The renderer gets NOTHING here, and that is the point.
 *
 * Every other table the public role can read holds something a visitor is meant
 * to see. A version history is the opposite: it is what a page used to say,
 * including drafts of prices and offers that were changed for a reason. The
 * read-only role cannot see this table at all, and the isolation suite checks it.
 */
revoke all on public.page_versions from public, anon, authenticated, tg_sites_renderer;
grant select, insert, delete on public.page_versions to tg_sites_app;
