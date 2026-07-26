-- Tripbuster migration 006 — bulk import provenance
--
-- Supports the two bulk ingestion routes (spreadsheet upload and the
-- Travelgenix live offer cache) alongside the manual form that already exists.
--
-- Three changes:
--   1. external_ref becomes UNIQUE per agent, so re-importing the same row
--      updates the existing deal instead of creating a second copy.
--   2. deals.synced_at records when a live-cache deal last had its prices
--      refreshed, which is different from updated_at (any edit touches that).
--   3. import_runs gives the agent a history of what each import actually did.
--
-- Safe to re-run: every statement is guarded.

-- ── 1. one external_ref per agent ───────────────────────────────────────────
-- 001_init created this as a plain index, which stops nothing. The importer
-- already looks for an existing row before writing, but two uploads racing
-- would both find nothing and both insert. Making it unique turns that race
-- into a constraint violation the importer reports honestly, rather than a
-- duplicate deal the agent has to find and delete.
--
-- The refs the importers write are namespaced by route ('sheet:<reference>',
-- 'cache:<offer id>'), so a spreadsheet reference can never collide with a
-- cache offer id.
--
-- If this fails with "could not create unique index", the table already holds
-- duplicates. Find them before retrying:
--   select agent_id, external_ref, count(*) from public.deals
--    where external_ref is not null group by 1,2 having count(*) > 1;
drop index if exists public.deals_external_ref_idx;
create unique index if not exists deals_external_ref_key
  on public.deals (agent_id, external_ref)
  where external_ref is not null;

-- ── 2. when a live-cache deal was last refreshed ────────────────────────────
-- updated_at moves whenever anything changes, including an agent editing the
-- copy. synced_at answers a different question: how stale are the prices we
-- are advertising? Null for manual and spreadsheet deals, which have no
-- upstream to resync from.
alter table public.deals
  add column if not exists synced_at timestamptz;

comment on column public.deals.synced_at is
  'Last time a live_cache deal had its prices and dates refreshed from the '
  'Travelgenix offer cache. Null for manual and spreadsheet deals.';

-- ── 3. import history ───────────────────────────────────────────────────────
-- Andy relies on the dashboard as an external record, so an import must leave
-- a trace the agent can read back later: what was uploaded, when, and what it
-- actually did. Counts are stored rather than derived because deals can be
-- edited or deleted afterwards, and the run should still say what happened at
-- the time.
create table if not exists public.import_runs (
  id            uuid primary key default gen_random_uuid(),
  agent_id      uuid not null references public.agents(id) on delete cascade,

  source        text not null check (source in ('spreadsheet','live_cache')),
  filename      text,                        -- as supplied by the agent, display only

  rows_total    integer not null default 0,
  created_count integer not null default 0,
  updated_count integer not null default 0,
  skipped_count integer not null default 0,   -- valid but nothing to change
  failed_count  integer not null default 0,

  -- First few row-level problems, for "3 rows need attention" in the UI.
  -- Capped by the API before it gets here so a bad file cannot bloat the table.
  problems      jsonb not null default '[]'::jsonb,

  created_at    timestamptz not null default now()
);

create index if not exists import_runs_agent_idx
  on public.import_runs (agent_id, created_at desc);

-- ── access: same fail-closed model as every other table ─────────────────────
-- RLS on with NO policies, privileges revoked. Only the service role reads or
-- writes. The rls_enabled_no_policy notice from the Supabase linter is the
-- intended design, not an oversight.
alter table public.import_runs enable row level security;
revoke all on public.import_runs from anon, authenticated;

-- ── deal counts by source, for the dashboard ────────────────────────────────
-- Lets the import screen say "12 from your spreadsheet, 40 from the live feed"
-- without shipping every deal to the browser to count them.
create or replace function public.tb_agent_source_counts(p_agent_id uuid)
returns json
language sql
stable
security invoker
set search_path = public
as $$
  select json_build_object(
    'manual',      count(*) filter (where source = 'manual'),
    'spreadsheet', count(*) filter (where source = 'spreadsheet'),
    'live_cache',  count(*) filter (where source = 'live_cache'),
    'total',       count(*)
  )
  from public.deals
  where agent_id = p_agent_id;
$$;
