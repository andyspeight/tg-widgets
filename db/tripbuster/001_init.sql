-- ============================================================================
-- Tripbuster — initial schema (001)
-- ============================================================================
-- Tripbuster is an ADVERTISING platform, not a travel company. Agents advertise
-- holiday deals here; travellers click through and book on the agent's own site
-- under the agent's own financial protection. Tripbuster never takes a booking,
-- never holds customer money, and needs no ATOL of its own.
--
-- Storage lives in its own Postgres project (separate from Travelgenix), so
-- Tripbuster stays a genuinely separate product.
--
-- Access model: RLS is ON with NO public policies — fail closed. Nothing reads
-- or writes with the anon key. All access goes through the Vercel API using the
-- service role, so we control caching, rate limiting and validation in one place.
-- ============================================================================

-- ── helpers ─────────────────────────────────────────────────────────────────
create extension if not exists "pgcrypto";   -- gen_random_uuid()
create extension if not exists "pg_trgm";    -- fuzzy resort/hotel matching

create or replace function tb_touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ── agents (the advertisers) ────────────────────────────────────────────────
create table public.agents (
  id                    uuid primary key default gen_random_uuid(),
  slug                  text not null unique,              -- /agent/sunseeker-travel
  name                  text not null,
  email                 text not null unique,              -- login identity
  phone                 text,
  website               text,
  logo_url              text,
  town                  text,
  region                text,

  -- The agent's own financial protection. Displayed as a trust badge only —
  -- Tripbuster does not verify or provide it.
  protection_type       text check (protection_type in ('ATOL','ABTA','ATOL + ABTA','Trust account','None')),
  atol_number           text,
  abta_number           text,

  -- Fallback used when an imported deal has no click-out URL of its own.
  default_clickout_url  text,

  -- Provisional tiers. Names match the Travelgenix convention (Title Case).
  -- Per-plan deal limits are enforced in the API, not here, because the pricing
  -- model is still an open decision — keeping it out of the schema means the
  -- numbers can change without a migration.
  plan                  text not null default 'Spark'
                          check (plan in ('Spark','Boost','Ignite','Bespoke')),
  status                text not null default 'pending'
                          check (status in ('pending','active','paused','suspended')),

  -- Set when the agent is also a Travelgenix client, which unlocks the
  -- pull-from-live-offer-cache import route.
  tg_client_email       text,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index agents_status_idx on public.agents (status);
create index agents_tg_client_idx on public.agents (tg_client_email) where tg_client_email is not null;

create trigger agents_touch before update on public.agents
  for each row execute function tb_touch_updated_at();

-- ── deals ───────────────────────────────────────────────────────────────────
-- Field groups mirror the nine sections of the advertiser deal editor.
create table public.deals (
  id                    uuid primary key default gen_random_uuid(),
  agent_id              uuid not null references public.agents(id) on delete cascade,

  status                text not null default 'draft'
                          check (status in ('draft','live','paused','expired')),

  -- 1. type & headline
  holiday_type          text not null default 'Package holiday'
                          check (holiday_type in ('Package holiday','Hotel only','Flight + hotel',
                                                  'City break','Cruise','Escorted tour','Flight only')),
  reference             text,                              -- agent's own SKU
  title                 text not null,
  strapline             text,

  -- 2. destination & accommodation
  country               text,
  region                text,
  resort                text,
  accommodation_name    text,
  star_rating           smallint check (star_rating between 1 and 5),
  guest_score           numeric(3,1) check (guest_score >= 0 and guest_score <= 10),
  distance_to_beach     text,
  distance_to_airport   text,
  overview              text,

  -- 3. room & board
  board_basis           text check (board_basis in ('All inclusive','Ultra all inclusive','Full board',
                                                    'Half board','Bed & breakfast','Self catering','Room only')),
  room_type             text,
  adults                smallint default 2 check (adults >= 0),
  children              smallint default 0 check (children >= 0),
  infants               smallint default 0 check (infants >= 0),
  facilities            text[] not null default '{}',

  -- 4. flights & transfers
  departure_airports    text[] not null default '{}',
  airline               text,
  flight_duration       text,
  cabin_bag             text,
  hold_luggage          text,
  transfers             text,

  -- 5. dates & availability
  availability_type     text not null default 'range'
                          check (availability_type in ('range','fixed','flexible')),
  nights                smallint check (nights > 0),
  travel_from           date,
  travel_until          date,
  booking_deadline      date,
  availability_status   text not null default 'Available'
                          check (availability_status in ('Available','On request','Limited')),
  spaces_left           smallint check (spaces_left >= 0),

  -- 6. pricing. Money is numeric, never float.
  price_from            numeric(10,2) check (price_from >= 0),
  price_basis           text not null default 'pp' check (price_basis in ('pp','total')),
  was_price             numeric(10,2) check (was_price >= 0),
  deposit_from          numeric(10,2) check (deposit_from >= 0),
  child_price_from      numeric(10,2) check (child_price_from >= 0),
  single_supplement     numeric(10,2) check (single_supplement >= 0),
  currency              text not null default 'GBP' check (currency in ('GBP','EUR','USD')),
  price_includes        text[] not null default '{}',
  local_charges         text,

  -- 7. offer & selling points
  offer_badges          text[] not null default '{}',
  selling_points        text[] not null default '{}',

  -- 8. media
  hero_image_url        text,
  gallery               text[] not null default '{}',
  video_url             text,

  -- 9. booking & protection (falls back to the agent's values when blank)
  clickout_url          text,
  booking_phone         text,
  protection_type       text,
  atol_number           text,
  abta_number           text,
  terms_url             text,

  -- provenance: which of the three ingestion routes created this deal
  source                text not null default 'manual'
                          check (source in ('manual','spreadsheet','live_cache')),
  external_ref          text,                              -- live-cache offer id, for resync/dedupe

  -- Saving shown on the card. Derived so it can never drift from the prices.
  discount_pct integer generated always as (
    case
      when was_price is not null and price_from is not null
           and was_price > 0 and was_price > price_from
      then round((1 - price_from / was_price) * 100)::int
      else null
    end
  ) stored,

  -- Groups the same hotel advertised by different agents, which drives the
  -- multi-agent price compare. A canonical properties table can come later;
  -- this key means the compare works now without asking agents to match
  -- their deal to a central property record.
  property_key text generated always as (
    lower(trim(coalesce(accommodation_name,''))) || '|' || lower(trim(coalesce(resort,'')))
  ) stored,

  -- Consumer free-text search across the fields travellers actually type.
  search_vector tsvector generated always as (
    to_tsvector('english',
      coalesce(title,'') || ' ' || coalesce(resort,'') || ' ' || coalesce(country,'') || ' ' ||
      coalesce(region,'') || ' ' || coalesce(accommodation_name,'') || ' ' || coalesce(strapline,'')
    )
  ) stored,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  published_at          timestamptz,

  -- A live deal is useless without a price and somewhere to send the traveller.
  constraint deals_live_needs_price_and_link check (
    status <> 'live' or (price_from is not null and coalesce(clickout_url,'') <> '')
  ),
  constraint deals_travel_window_ordered check (
    travel_from is null or travel_until is null or travel_until >= travel_from
  )
);

create index deals_agent_idx        on public.deals (agent_id);
create index deals_live_idx         on public.deals (status) where status = 'live';
create index deals_country_idx      on public.deals (lower(country));
create index deals_resort_idx       on public.deals (lower(resort));
create index deals_price_idx        on public.deals (price_from);
create index deals_board_idx        on public.deals (board_basis);
create index deals_nights_idx       on public.deals (nights);
create index deals_property_idx     on public.deals (property_key);
create index deals_external_ref_idx on public.deals (agent_id, external_ref) where external_ref is not null;
create index deals_airports_gin     on public.deals using gin (departure_airports);
create index deals_facilities_gin   on public.deals using gin (facilities);
create index deals_search_gin       on public.deals using gin (search_vector);
create index deals_resort_trgm      on public.deals using gin (resort gin_trgm_ops);

create trigger deals_touch before update on public.deals
  for each row execute function tb_touch_updated_at();

-- ── click_events (the billable event) ───────────────────────────────────────
-- One row per click-out to an agent. This is what Tripbuster charges for, so it
-- is stored per event rather than aggregated. No raw IPs: we keep a salted hash
-- only, for de-duplication and abuse detection, per UK GDPR data minimisation.
create table public.click_events (
  id            bigserial primary key,
  deal_id       uuid references public.deals(id) on delete set null,
  agent_id      uuid references public.agents(id) on delete set null,  -- denormalised for fast billing rollups
  occurred_at   timestamptz not null default now(),
  surface       text not null default 'site'
                  check (surface in ('site','widget','directory','api')),
  ip_hash       text,          -- salted SHA-256, never the raw address
  ua_family     text,          -- coarse UA bucket, not the full string
  referrer_host text,          -- host only, never the full URL
  country_code  char(2),
  is_billable   boolean not null default true   -- false for known bots / repeat clicks
);

create index click_agent_time_idx on public.click_events (agent_id, occurred_at desc);
create index click_deal_time_idx  on public.click_events (deal_id, occurred_at desc);
create index click_billable_idx   on public.click_events (agent_id, occurred_at) where is_billable;

-- ── deal_daily_stats (impression rollup) ────────────────────────────────────
-- Impressions run orders of magnitude higher than clicks and are only ever read
-- in aggregate, so they are upserted into a daily counter instead of stored per
-- event. Clicks are mirrored here too so the dashboard reads one cheap row.
create table public.deal_daily_stats (
  deal_id     uuid not null references public.deals(id) on delete cascade,
  agent_id    uuid not null references public.agents(id) on delete cascade,
  stat_date   date not null,
  impressions integer not null default 0,
  clicks      integer not null default 0,
  primary key (deal_id, stat_date)
);

create index stats_agent_date_idx on public.deal_daily_stats (agent_id, stat_date desc);

-- ── lock it down ────────────────────────────────────────────────────────────
-- RLS on, no policies: the anon and authenticated keys can do nothing at all.
-- Only the service role (used by the Vercel API) bypasses RLS. Fail closed.
alter table public.agents           enable row level security;
alter table public.deals            enable row level security;
alter table public.click_events     enable row level security;
alter table public.deal_daily_stats enable row level security;

revoke all on public.agents           from anon, authenticated;
revoke all on public.deals            from anon, authenticated;
revoke all on public.click_events     from anon, authenticated;
revoke all on public.deal_daily_stats from anon, authenticated;
