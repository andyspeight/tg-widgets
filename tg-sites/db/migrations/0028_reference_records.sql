-- ---------------------------------------------------------------------------
-- 0028  The destination corpus, kept locally
-- ---------------------------------------------------------------------------
--
-- WHAT THIS HOLDS. Travelgenix maintains a researched, two-source-verified
-- reference corpus in Airtable: countries, cities and regions, resorts and
-- areas, airports, and theme parks and attractions. A client site that publishes
-- a destination should show those facts and keep showing them, because a visa
-- rule changes and every site carrying it should change with it.
--
-- WHY A LOCAL COPY RATHER THAN READING AIRTABLE AT RENDER. The same rule the
-- offers cache keeps, and for the same reason: a visitor's page view must never
-- wait on a supplier. /api/reference/export in the widget suite is pulled on our
-- own schedule and lands here; every page renders from this table.
--
-- ---------------------------------------------------------------------------
-- THIS TABLE IS NOT TENANT SCOPED, AND THAT IS DELIBERATE
-- ---------------------------------------------------------------------------
--
-- Every other table in this schema keys its policies on current_tenant(), and
-- lib/db/withTenant.ts exists so a query that forgets returns nothing rather
-- than everything. This one is different, so the difference is written down.
--
-- The corpus is not client data. It is public reference material, identical for
-- every tenant, and the same rows serve all of them. Adding a tenant_id would
-- mean a hundred and eight copies of Greece, one per client, each drifting from
-- the others the moment a sync missed one.
--
-- WHAT KEEPS IT SAFE, since the usual guarantee does not apply:
--
--   1. NOTHING ABOUT A CLIENT GOES IN IT. Only the corpus. A tenant's own
--      adoption of a destination is a collection_items row, which IS tenant
--      scoped and carries their words. This table holds the shared half.
--   2. THE RENDERER ROLE MAY ONLY READ. tg_sites_renderer gets select and
--      nothing else, so a compromised public site cannot write reference data
--      that every other client's site would then serve.
--   3. READS DO NOT GO THROUGH withTenant, and must not pretend to. There is
--      precedent: resolveTenantByHostname queries db(role) directly for the same
--      reason, that the question has no tenant in it yet. lib/db/reference.ts is
--      the only place that reads this table and says so at the top.
--
-- Safe to re-run.

create table if not exists public.reference_records (
  id uuid primary key default gen_random_uuid(),

  -- The five kinds the corpus holds. Checked here as well as in the exporter so
  -- a sixth cannot arrive by accident from the far end.
  kind text not null check (kind in ('country', 'city', 'resort', 'airport', 'attraction')),

  -- The Airtable record id. This is the join back to the source and the key the
  -- sync matches on, so a record renamed in Airtable updates rather than
  -- duplicating. Unique per kind rather than globally: the ids are unique across
  -- the base already, and scoping the constraint says which table it came from.
  source_id text not null,

  name text not null,

  -- A URL-safe handle. Not unique: two countries can hold a resort with the same
  -- name, and the tenant's own page address is theirs to choose at adoption. This
  -- is the suggestion, not the address.
  slug text not null,

  -- The centrally maintained half, refreshed on every sync. Shape and validation
  -- live in lib/content/reference.ts, which treats this as hostile on the way out
  -- because a jsonb column is a value from the database rather than from us.
  facts jsonb not null default '{}'::jsonb,

  -- The seed a client's prose starts from. Copied ONCE when a tenant adopts the
  -- destination and never read again for that tenant, which is the whole of why
  -- forty agencies do not end up publishing the same overview.
  prose jsonb not null default '{}'::jsonb,

  -- When the sync last wrote this row. A corpus that stops updating is a corpus
  -- nobody notices has stopped, so the freshness is a column rather than a guess.
  synced_at timestamptz not null default now(),

  unique (kind, source_id)
);

create index if not exists reference_records_kind_idx
  on public.reference_records (kind, name);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.reference_records enable row level security;
alter table public.reference_records force row level security;

-- Both roles may read every row, because every row is public reference material
-- and there is no tenant to scope it to. Stated as an explicit permissive policy
-- rather than left to the grants, so that reading `using (true)` here is a
-- decision somebody made rather than a policy somebody forgot.
drop policy if exists reference_records_read on public.reference_records;
create policy reference_records_read on public.reference_records
  for select to tg_sites_app, tg_sites_renderer
  using (true);

-- Only the app role writes, and only the sync uses it. The renderer is a reader
-- here and everywhere.
drop policy if exists reference_records_write on public.reference_records;
create policy reference_records_write on public.reference_records
  for all to tg_sites_app
  using (true)
  with check (true);

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

-- Supabase grants public-schema tables to anon and authenticated by default,
-- which would expose this over PostgREST. Revoked before anything is granted,
-- the same as every other table here.
revoke all on public.reference_records from public, anon, authenticated;

grant select, insert, update, delete on public.reference_records to tg_sites_app;

-- SELECT ONLY, and this is the line that matters. A compromised public site
-- writing to this table would be writing to every other client's site as well.
grant select on public.reference_records to tg_sites_renderer;

comment on table public.reference_records is
  'The shared destination corpus, synced from Airtable. NOT tenant scoped: see '
  'the note at the top of 0028_reference_records.sql for why, and what keeps it safe.';
