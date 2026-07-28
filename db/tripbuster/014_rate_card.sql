-- ============================================================================
-- Tripbuster 014 — the rate card
-- ============================================================================
-- Pricing, decided 28 July 2026:
--
--                    Standard   Premium
--   Click               10p       25p
--   Call                £1        £2
--   Details (callback)  £1        £2
--
-- Premium also buys PLACEMENT: top five in the results, and the headline agency
-- on a compare card. See section 6, and the warning attached to it.
--
-- Those are defaults. They can be overridden three ways, most specific winning:
--
--   per client per product   Sunseeker pays 30p a click on cruises
--   per client               Sunseeker pays 30p a click on everything
--   per product              everyone pays 4p a click on flight-only
--   (the default)            everyone pays 10p a click
--
-- ── ONE MECHANISM, NOT FOUR ─────────────────────────────────────────────────
--
-- The defaults are not special. They are rows in the same table with agent_id
-- and holiday_type both null, which makes them the least specific match. So
-- there is one table, one lookup and one precedence rule, rather than a default
-- constant in the code plus three kinds of override to keep in step with it.
--
-- ── THE PRICE IS FROZEN ONTO THE EVENT ──────────────────────────────────────
--
-- tb_record_click resolves the rate and writes the pence onto click_events.
-- Working the charge out later, at invoice time, from whatever the rate card
-- says then, would mean a rate change quietly re-pricing months an agency has
-- already been billed for. Same principle as out_of_hours in migration 009:
-- record what was true when it happened, do not re-derive it afterwards.
--
-- Which also means: CHANGING A RATE ONLY AFFECTS EVENTS FROM THAT MOMENT ON.
-- That is the intended behaviour, and it is what makes the numbers defensible
-- in an argument about a bill.
-- ============================================================================

begin;

-- ── 1. what an agency pays ──────────────────────────────────────────────────
alter table public.agents add column if not exists rate_tier text not null default 'standard';

do $$ begin
  alter table public.agents add constraint agents_rate_tier_check
    check (rate_tier in ('standard', 'premium'));
exception when duplicate_object then null; end $$;

-- ── 2. the rate card itself ─────────────────────────────────────────────────
-- agent_id null      → applies to every agency
-- holiday_type null  → applies to every product type
-- Both null          → the platform default
create table if not exists public.rate_card (
  id           uuid primary key default gen_random_uuid(),
  agent_id     uuid references public.agents(id) on delete cascade,
  holiday_type text,
  event_type   text not null check (event_type in ('click', 'call', 'lead')),
  tier         text not null check (tier in ('standard', 'premium')),

  -- Pence, as an integer. Money is never a float, and pence rather than pounds
  -- because 10p and £0.10 are the same number but only one of them survives
  -- being added up ten thousand times.
  amount_pence integer not null check (amount_pence >= 0 and amount_pence <= 100000),

  note         text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint rate_card_holiday_type_check check (
    holiday_type is null or holiday_type in (
      'Package holiday', 'Hotel only', 'Flight + hotel', 'City break',
      'Cruise', 'Escorted tour', 'Flight only')
  )
);

-- One rate per (scope, event, tier). Nulls do not compare equal in a plain
-- unique index, so the scope columns are coalesced to sentinels — otherwise two
-- rows could both claim to be "the default click rate" and the lookup would pick
-- one arbitrarily.
create unique index if not exists rate_card_scope_key on public.rate_card (
  coalesce(agent_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(holiday_type, '*'),
  event_type,
  tier
);

create index if not exists rate_card_agent_idx on public.rate_card (agent_id)
  where agent_id is not null;

alter table public.rate_card enable row level security;
revoke all on public.rate_card from anon, authenticated;

create trigger rate_card_touch before update on public.rate_card
  for each row execute function tb_touch_updated_at();

-- ── 3. the defaults ─────────────────────────────────────────────────────────
insert into public.rate_card (agent_id, holiday_type, event_type, tier, amount_pence, note)
values
  (null, null, 'click', 'standard',  10, 'Platform default'),
  (null, null, 'click', 'premium',   25, 'Platform default'),
  (null, null, 'call',  'standard', 100, 'Platform default'),
  (null, null, 'call',  'premium',  200, 'Platform default'),
  (null, null, 'lead',  'standard', 100, 'Platform default'),
  (null, null, 'lead',  'premium',  200, 'Platform default')
on conflict do nothing;

-- ── 4. resolving a rate ─────────────────────────────────────────────────────
-- Most specific wins: client+product, then client, then product, then default.
--
-- Returns the amount AND where it came from. The source is not decoration — it
-- is the difference between "why am I paying 30p" having an answer and being a
-- shrug, and it goes on the event row so the answer survives.
create or replace function public.tb_resolve_rate(
  p_agent_id     uuid,
  p_holiday_type text,
  p_event_type   text
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_tier text;
  r      record;
begin
  select rate_tier into v_tier from agents where id = p_agent_id;
  if v_tier is null then v_tier := 'standard'; end if;

  select rc.amount_pence,
         (case when rc.agent_id is not null then 2 else 0 end)
       + (case when rc.holiday_type is not null then 1 else 0 end) as specificity
    into r
    from rate_card rc
   where rc.event_type = p_event_type
     and rc.tier = v_tier
     and (rc.agent_id is null or rc.agent_id = p_agent_id)
     and (rc.holiday_type is null or rc.holiday_type = p_holiday_type)
   order by specificity desc
   limit 1;

  if not found then
    -- No rate at all, not even a default. Charging a number we invented here
    -- would be worse than charging nothing, so it is nothing, and it is visible
    -- in the source rather than silent.
    return jsonb_build_object('tier', v_tier, 'pence', 0, 'source', 'unrated');
  end if;

  return jsonb_build_object(
    'tier',  v_tier,
    'pence', r.amount_pence,
    'source', case r.specificity
                when 3 then 'client_product'
                when 2 then 'client'
                when 1 then 'product'
                else 'default'
              end
  );
end;
$$;

revoke all on function public.tb_resolve_rate from anon, authenticated;

-- ── 5. what an event cost ───────────────────────────────────────────────────
-- charged_pence is 0 on anything not billable, never null, so summing a column
-- never needs a coalesce and a zero is always a decision rather than a gap.
alter table public.click_events add column if not exists charged_pence integer not null default 0;
alter table public.click_events add column if not exists rate_tier   text;
alter table public.click_events add column if not exists rate_source text;

create index if not exists click_events_agent_charged_idx
  on public.click_events (agent_id, occurred_at) where charged_pence > 0;

commit;

-- ── 6. the charge is worked out as the event happens ────────────────────────
-- Same 11-parameter signature, so this is a genuine replacement rather than an
-- overload. Only the body changes: it now looks up the deal's product type,
-- resolves the rate, and writes the pence onto the row.
--
-- The resolution happens even when the event is NOT billable, and stores zero.
-- That is deliberate: "this call was worth £2 but we did not charge for it"
-- is a different fact from "we have no idea what this call was worth", and the
-- first one is the one an agency asks about.

begin;

create or replace function public.tb_record_click(
  p_deal_id uuid,
  p_surface text default 'site',
  p_ip_hash text default null,
  p_ua_family text default null,
  p_referrer_host text default null,
  p_country_code text default null,
  p_suspect_bot boolean default false,
  p_event_type text default 'click',
  p_call_seconds integer default null,
  p_call_connected boolean default null,
  p_caller_hash text default null
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_agent_id   uuid;
  v_clickout   text;
  v_phone      text;
  v_mode       text;
  v_min_secs   integer;
  v_holiday    text;
  v_recent     boolean := false;
  v_billable   boolean;
  v_surface    text := coalesce(nullif(p_surface, ''), 'site');
  v_type       text := case when p_event_type in ('call', 'lead') then p_event_type else 'click' end;
  v_window     interval;
  v_closed     boolean := false;
  v_rate       jsonb;
  v_charge     integer := 0;
begin
  select d.agent_id,
         coalesce(nullif(d.clickout_url, ''), a.default_clickout_url),
         coalesce(nullif(d.booking_phone, ''), a.phone),
         coalesce(d.billing_mode, a.billing_mode),
         a.call_min_seconds,
         d.holiday_type
    into v_agent_id, v_clickout, v_phone, v_mode, v_min_secs, v_holiday
  from deals d
  join agents a on a.id = d.agent_id
  where d.id = p_deal_id;

  if v_agent_id is null then
    return null;
  end if;

  if v_surface not in ('site', 'widget', 'directory', 'api') then
    v_surface := 'site';
  end if;

  v_window := case when v_type = 'click' then interval '30 minutes' else interval '24 hours' end;

  if v_type <> 'click' and p_caller_hash is not null then
    select exists (
      select 1 from click_events
      where deal_id = p_deal_id and event_type = v_type
        and caller_hash = p_caller_hash and is_billable
        and occurred_at > now() - v_window
    ) into v_recent;
  elsif p_ip_hash is not null then
    select exists (
      select 1 from click_events
      where deal_id = p_deal_id and event_type = v_type
        and ip_hash = p_ip_hash and is_billable
        and occurred_at > now() - v_window
    ) into v_recent;
  end if;

  v_billable := not (coalesce(p_suspect_bot, false) or v_recent);

  if v_type in ('call', 'lead') then
    v_closed := not coalesce(tb_agent_is_open(v_agent_id, now()), true);
  end if;

  if v_type = 'call' then
    if p_call_connected is false then
      v_billable := false;
    elsif p_call_seconds is not null and p_call_seconds < coalesce(v_min_secs, 0) then
      v_billable := false;
    end if;
  end if;

  -- Resolved now, at the agency's tier and this deal's product type, and frozen
  -- onto the row. A rate change tomorrow must not re-price today.
  v_rate := tb_resolve_rate(v_agent_id, v_holiday, v_type);
  v_charge := case when v_billable then (v_rate->>'pence')::int else 0 end;

  insert into click_events (deal_id, agent_id, surface, ip_hash, ua_family, referrer_host,
                            country_code, is_billable, event_type,
                            call_seconds, call_connected, caller_hash, out_of_hours,
                            charged_pence, rate_tier, rate_source)
  values (p_deal_id, v_agent_id, v_surface, p_ip_hash, p_ua_family, p_referrer_host,
          nullif(upper(left(coalesce(p_country_code, ''), 2)), ''), v_billable, v_type,
          p_call_seconds, p_call_connected, p_caller_hash,
          case when v_type = 'click' then null else v_closed end,
          v_charge, v_rate->>'tier', v_rate->>'source');

  if v_type = 'call' then
    insert into deal_daily_stats (deal_id, agent_id, stat_date, calls)
    values (p_deal_id, v_agent_id, current_date, 1)
    on conflict (deal_id, stat_date) do update set calls = deal_daily_stats.calls + 1;
  elsif v_type = 'lead' then
    insert into deal_daily_stats (deal_id, agent_id, stat_date, leads)
    values (p_deal_id, v_agent_id, current_date, 1)
    on conflict (deal_id, stat_date) do update set leads = deal_daily_stats.leads + 1;
  else
    insert into deal_daily_stats (deal_id, agent_id, stat_date, clicks)
    values (p_deal_id, v_agent_id, current_date, 1)
    on conflict (deal_id, stat_date) do update set clicks = deal_daily_stats.clicks + 1;
  end if;

  return jsonb_build_object(
    'recorded',    true,
    'billable',    v_billable,
    'duplicate',   v_recent,
    'outOfHours',  case when v_type = 'click' then null else v_closed end,
    'eventType',   v_type,
    'billingMode', v_mode,
    'clickoutUrl', v_clickout,
    'phone',       v_phone,
    -- Never returned to a browser. api/tripbuster/click.js picks out only the
    -- clickout URL and the phone number; what an event cost is between us and
    -- the agency, and putting it in a public response would publish the rate
    -- card one event at a time.
    'chargedPence', v_charge
  );
end;
$$;

-- ── 7. stats gain money ─────────────────────────────────────────────────────
-- Costs come from click_events and NEVER from the daily counters. The counters
-- are a fast approximation for charts; the events are what an invoice is built
-- from, and they are the only place the price actually lives.
create or replace function public.tb_agent_stats(p_agent_id uuid, p_days integer default 30)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with win as (
    select current_date - (least(greatest(coalesce(p_days, 30), 1), 365) - 1) as from_date
  ),
  rows_in_window as (
    select s.* from deal_daily_stats s, win
    where s.agent_id = p_agent_id and s.stat_date >= win.from_date
  ),
  totals as (
    select coalesce(sum(impressions), 0)::bigint as impressions,
           coalesce(sum(clicks), 0)::bigint      as clicks,
           coalesce(sum(calls), 0)::bigint       as calls,
           coalesce(sum(leads), 0)::bigint       as leads
    from rows_in_window
  ),
  events as (
    select c.* from click_events c, win
    where c.agent_id = p_agent_id and c.occurred_at >= win.from_date
  ),
  billable as (
    select
      count(*) filter (where event_type = 'click')::bigint as clicks,
      count(*) filter (where event_type = 'call')::bigint  as calls,
      count(*) filter (where event_type = 'lead')::bigint  as leads
    from events where is_billable
  ),
  spend as (
    select
      coalesce(sum(charged_pence) filter (where event_type = 'click'), 0)::bigint as clicks,
      coalesce(sum(charged_pence) filter (where event_type = 'call'), 0)::bigint  as calls,
      coalesce(sum(charged_pence) filter (where event_type = 'lead'), 0)::bigint  as leads,
      coalesce(sum(charged_pence), 0)::bigint                                     as total
    from events
  ),
  after_hours as (
    select
      count(*) filter (where event_type = 'call')::bigint as calls,
      count(*) filter (where event_type = 'lead')::bigint as leads
    from events where out_of_hours
  ),
  -- What was actually applied, so the screen can say "10p a click" without
  -- guessing, and can show more than one line when a product overrides it.
  applied as (
    select jsonb_agg(jsonb_build_object(
             'eventType', event_type, 'pence', charged_pence,
             'source', rate_source, 'events', n, 'costPence', charged_pence * n
           ) order by event_type, charged_pence) as rows
    from (
      select event_type, charged_pence, rate_source, count(*)::bigint as n
      from events where is_billable
      group by event_type, charged_pence, rate_source
    ) t
  ),
  per_deal as (
    select jsonb_object_agg(deal_id, jsonb_build_object(
             'impressions', imp, 'clicks', clk, 'calls', cll, 'leads', lds)) as map
    from (
      select deal_id, sum(impressions)::bigint as imp, sum(clicks)::bigint as clk,
             sum(calls)::bigint as cll, sum(leads)::bigint as lds
      from rows_in_window group by deal_id
    ) t
  )
  select jsonb_build_object(
    'days',           least(greatest(coalesce(p_days, 30), 1), 365),
    'impressions',    (select impressions from totals),
    'clicks',         (select clicks from totals),
    'billableClicks', (select clicks from billable),
    'calls',          (select calls from totals),
    'billableCalls',  (select calls from billable),
    'leads',          (select leads from totals),
    'billableLeads',  (select leads from billable),
    'afterHoursCalls', (select calls from after_hours),
    'afterHoursLeads', (select leads from after_hours),
    'costPence',      jsonb_build_object(
                        'clicks', (select clicks from spend),
                        'calls',  (select calls from spend),
                        'leads',  (select leads from spend),
                        'total',  (select total from spend)),
    'rateLines',      coalesce((select rows from applied), '[]'::jsonb),
    'rateTier',       (select rate_tier from agents where id = p_agent_id),
    'ctr',            case when (select impressions from totals) > 0
                           then round(((select clicks from totals)::numeric
                                       / (select impressions from totals)) * 100, 2)
                           else null end,
    'callRate',       case when (select impressions from totals) > 0
                           then round((((select calls from totals) + (select leads from totals))::numeric
                                       / (select impressions from totals)) * 100, 2)
                           else null end,
    'perDeal',        coalesce((select map from per_deal), '{}'::jsonb)
  );
$$;

revoke all on function public.tb_agent_stats from anon, authenticated;

commit;

-- ── 8. premium buys position, and that has to be visible ────────────────────
-- Applied as part of this migration; the full tb_search_deals body lives in the
-- applied migration `rate_card_part3_premium_placement`. What it adds:
--
--   • is_premium on every returned row, from agents.rate_tier
--   • the group's headline agency (`best`) is the premium one if there is one,
--     ordered (not is_premium), price_from, id — so premium first, then cheapest
--   • the compare list stays CHEAPEST FIRST regardless, so a traveller always
--     sees the cheaper option immediately below the promoted one
--   • the first five premium rows take the top five slots, then normal order
--     resumes; the cap is a window function over the same sort, not a guess
--
-- ── READ THIS BEFORE CHANGING ANY OF IT ─────────────────────────────────────
--
-- EVERY LISTING ON TRIPBUSTER IS ADVERTISING. Standard agents pay per click, per
-- call and per enquiry. Premium agents pay more, and the extra buys ORDER.
--
-- That distinction drives the disclosure, and the disclosure is a legal control
-- rather than a design choice:
--
--   the footer, on every page   says the whole site is advertising and that we
--                               never add anything to the price
--   rankingNote(), on any page  says agents can pay to appear higher
--     that lists deals
--   the Promoted badge          marks the individual listings that did
--
-- The badge deliberately does NOT say "Sponsored". On a site where everything is
-- paid for, badging five listings as sponsored implies the other twenty are
-- editorial picks, which is misleading in the opposite direction. "Promoted"
-- carries the narrower and accurate claim: this one paid to be higher up.
--
-- The note shows on every listing page whether or not anything on it is
-- promoted, because the first half of it is always true and a disclosure that
-- comes and goes teaches people that its absence means something.

-- ── verify it actually landed ───────────────────────────────────────────────
--   select tb_resolve_rate((select id from agents where slug='sunseeker-travel'),
--                          'Cruise', 'click');            -- 50p, client_product
--   select count(*) from click_events where charged_pence > 0;
--   -- exactly five promoted rows at the top, then normal order:
--   select ordinality, d->>'agent_name', (d->>'is_premium')::boolean
--     from jsonb_array_elements(tb_search_deals(p_compare := true, p_limit := 12) -> 'deals')
--          with ordinality as t(d, ordinality) order by ordinality;
