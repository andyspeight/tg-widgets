-- Tripbuster migration 007 — pay per call alongside pay per click
--
-- Many independent agencies are phone-first. Some convert far better on a call
-- than online, and a few have a brochure site with no booking engine at all.
-- Those are exactly the agencies the big comparison sites shut out, so the call
-- is arguably the more natural billable event for a good part of this market.
--
-- Set at two levels: an agency default, and a per-deal override.
--
-- THE OVERRIDE RESOLVES AT READ TIME, which is deliberately the opposite of how
-- protection and booking links work. Those are content, copied onto the deal
-- when it is written. Billing mode is a commercial setting: switching an agency
-- from click to call must take effect across every deal at once, without
-- rewriting hundreds of rows. So deals.billing_mode is NULLABLE and null means
-- "whatever the agency does".
--
-- Safe to re-run: every statement is guarded.

-- ── 1. the agency default ───────────────────────────────────────────────────
alter table public.agents
  add column if not exists billing_mode text not null default 'click';

do $$ begin
  alter table public.agents add constraint agents_billing_mode_check
    check (billing_mode in ('click', 'call', 'both'));
exception when duplicate_object then null; end $$;

-- How long a call must last before it counts. This is what separates a lead
-- from a wrong number or a hang-up, and it is per agency because a quick
-- availability check and a considered booking enquiry are not the same trade.
alter table public.agents
  add column if not exists call_min_seconds integer not null default 60;

do $$ begin
  alter table public.agents add constraint agents_call_min_seconds_check
    check (call_min_seconds between 0 and 600);
exception when duplicate_object then null; end $$;

-- Reserved for step 3. A tracked number forwards to the agency's real line and
-- is what finally makes a call provable, including on desktop where tap-to-call
-- tells us nothing. Null until a telephony provider is wired up.
alter table public.agents
  add column if not exists tracked_number text;

comment on column public.agents.billing_mode is
  'What this agency pays for: click, call, or both. Overridable per deal.';
comment on column public.agents.call_min_seconds is
  'Minimum connected seconds before a call is billable. Filters hang-ups.';

-- ── 2. the per-deal override ────────────────────────────────────────────────
alter table public.deals
  add column if not exists billing_mode text;

do $$ begin
  alter table public.deals add constraint deals_billing_mode_check
    check (billing_mode is null or billing_mode in ('click', 'call', 'both'));
exception when duplicate_object then null; end $$;

comment on column public.deals.billing_mode is
  'Overrides the agency default. NULL means inherit, resolved on read so an '
  'agency-level change applies everywhere at once.';

-- ── 3. a call-only deal has no booking link ─────────────────────────────────
-- The old rule demanded a price AND a link, which would refuse to publish a
-- perfectly good call-only deal. Relaxed to a price plus at least one route to
-- the agency. Which route a given deal actually NEEDS depends on its resolved
-- billing mode, and that depends on the agents row, which a CHECK cannot see —
-- so the mode-specific rule lives in publishBlockers, alongside the plan rules,
-- exactly as the "commercial rules stay out of the schema" decision requires.
alter table public.deals drop constraint if exists deals_live_needs_price_and_link;

do $$ begin
  alter table public.deals add constraint deals_live_needs_price_and_route
    check (
      status <> 'live' or (
        price_from is not null and (
          coalesce(clickout_url, '') <> '' or coalesce(booking_phone, '') <> ''
        )
      )
    );
exception when duplicate_object then null; end $$;

-- ── 4. calls are billable events too ────────────────────────────────────────
-- Deliberately the SAME table as clicks rather than a second one. The salted IP
-- hash, the bot handling, the billable flag, the ownership columns and the
-- de-duplication are identical concerns; splitting them would fork the careful
-- logic in tb_record_click and split tb_agent_stats in two. Existing rows are
-- correct on the default.
alter table public.click_events
  add column if not exists event_type text not null default 'click';

do $$ begin
  alter table public.click_events add constraint click_events_event_type_check
    check (event_type in ('click', 'call'));
exception when duplicate_object then null; end $$;

-- Populated by the telephony provider in step 3. Until then a call event is an
-- INTENT: someone pressed the call button. call_connected stays null, which is
-- what makes it unbillable — see the qualification rule in tb_record_click.
alter table public.click_events add column if not exists call_seconds   integer;
alter table public.click_events add column if not exists call_connected boolean;
-- The caller's number, salted and hashed like the IP. Never stored in the clear.
alter table public.click_events add column if not exists caller_hash    text;

comment on column public.click_events.call_connected is
  'True when the telephony provider confirmed the call was answered. NULL means '
  'this is a tap-to-call intent we cannot prove, and is never billable.';

create index if not exists click_events_type_idx
  on public.click_events (agent_id, event_type, occurred_at desc);

-- ── 5. calls in the daily rollup ────────────────────────────────────────────
alter table public.deal_daily_stats
  add column if not exists calls integer not null default 0;

-- ── 6. recording an event ───────────────────────────────────────────────────
-- Handles both kinds. Kept as one function for the same reason as one table:
-- the ownership lookup, bot handling and de-duplication are shared, and two
-- copies would drift.
--
-- Two rules differ for calls:
--   * A LONGER DE-DUPLICATION WINDOW. Thirty minutes is right for clicks. The
--     same person ringing twice in a day is one lead, so calls use 24 hours,
--     keyed on the caller's number when we have it and the IP hash otherwise.
--   * QUALIFICATION. A call is billable only when the provider confirms it
--     connected AND it ran past the agency's call_min_seconds. An unproven
--     tap-to-call is recorded, so demand is visible, but never charged for.
-- The old seven-argument version must be DROPPED, not replaced. Adding
-- parameters creates an overload, and because the new ones all have defaults a
-- seven-argument call would match both and fail with "function is not unique".
drop function if exists public.tb_record_click(uuid, text, text, text, text, text, boolean);

create or replace function public.tb_record_click(
  p_deal_id        uuid,
  p_surface        text default 'site',
  p_ip_hash        text default null,
  p_ua_family      text default null,
  p_referrer_host  text default null,
  p_country_code   text default null,
  p_suspect_bot    boolean default false,
  p_event_type     text default 'click',
  p_call_seconds   integer default null,
  p_call_connected boolean default null,
  p_caller_hash    text default null
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_agent_id   uuid;
  v_clickout   text;
  v_phone      text;
  v_mode       text;
  v_min_secs   integer;
  v_recent     boolean := false;
  v_billable   boolean;
  v_qualified  boolean := true;
  v_surface    text := coalesce(nullif(p_surface, ''), 'site');
  v_type       text := case when p_event_type = 'call' then 'call' else 'click' end;
  v_window     interval;
begin
  select d.agent_id,
         coalesce(nullif(d.clickout_url, ''), a.default_clickout_url),
         coalesce(nullif(d.booking_phone, ''), a.phone),
         coalesce(d.billing_mode, a.billing_mode),
         a.call_min_seconds
    into v_agent_id, v_clickout, v_phone, v_mode, v_min_secs
  from deals d
  join agents a on a.id = d.agent_id
  where d.id = p_deal_id;

  if v_agent_id is null then
    return null;
  end if;

  if v_surface not in ('site', 'widget', 'directory', 'api') then
    v_surface := 'site';
  end if;

  -- A repeat inside the window is recorded but not charged for twice.
  v_window := case when v_type = 'call' then interval '24 hours' else interval '30 minutes' end;

  if v_type = 'call' and p_caller_hash is not null then
    select exists (
      select 1 from click_events
      where deal_id = p_deal_id and event_type = 'call'
        and caller_hash = p_caller_hash
        and is_billable
        and occurred_at > now() - v_window
    ) into v_recent;
  elsif p_ip_hash is not null then
    select exists (
      select 1 from click_events
      where deal_id = p_deal_id and event_type = v_type
        and ip_hash = p_ip_hash
        and is_billable
        and occurred_at > now() - v_window
    ) into v_recent;
  end if;

  -- A call has to be proven before it can be charged for. An intent arrives
  -- with call_connected null and is deliberately never billable.
  if v_type = 'call' then
    v_qualified := coalesce(p_call_connected, false)
                   and coalesce(p_call_seconds, 0) >= coalesce(v_min_secs, 60);
  end if;

  v_billable := v_qualified and not (coalesce(p_suspect_bot, false) or v_recent);

  insert into click_events (deal_id, agent_id, surface, ip_hash, ua_family, referrer_host,
                            country_code, is_billable, event_type,
                            call_seconds, call_connected, caller_hash)
  values (p_deal_id, v_agent_id, v_surface, p_ip_hash, p_ua_family, p_referrer_host,
          nullif(upper(left(coalesce(p_country_code, ''), 2)), ''), v_billable, v_type,
          p_call_seconds, p_call_connected, p_caller_hash);

  if v_type = 'call' then
    insert into deal_daily_stats (deal_id, agent_id, stat_date, calls)
    values (p_deal_id, v_agent_id, current_date, 1)
    on conflict (deal_id, stat_date)
    do update set calls = deal_daily_stats.calls + 1;
  else
    insert into deal_daily_stats (deal_id, agent_id, stat_date, clicks)
    values (p_deal_id, v_agent_id, current_date, 1)
    on conflict (deal_id, stat_date)
    do update set clicks = deal_daily_stats.clicks + 1;
  end if;

  return jsonb_build_object(
    'recorded',    true,
    'billable',    v_billable,
    'duplicate',   v_recent,
    'eventType',   v_type,
    'billingMode', v_mode,
    'clickoutUrl', v_clickout,
    'phone',       v_phone
  );
end;
$$;

revoke all on function public.tb_record_click(uuid, text, text, text, text, text, boolean,
                                              text, integer, boolean, text)
  from anon, authenticated;

-- ── 7. stats, split by what is being charged for ────────────────────────────
-- clicks and billableClicks keep their names so the existing dashboard keeps
-- working; calls and billableCalls sit alongside them.
create or replace function public.tb_agent_stats(p_agent_id uuid, p_days int default 30)
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
           coalesce(sum(calls), 0)::bigint       as calls
    from rows_in_window
  ),
  billable as (
    select
      count(*) filter (where c.event_type = 'click')::bigint as clicks,
      count(*) filter (where c.event_type = 'call')::bigint  as calls
    from click_events c, win
    where c.agent_id = p_agent_id and c.is_billable
      and c.occurred_at >= win.from_date
  ),
  per_deal as (
    select jsonb_object_agg(deal_id, jsonb_build_object(
             'impressions', imp, 'clicks', clk, 'calls', cll)) as map
    from (
      select deal_id, sum(impressions)::bigint as imp,
             sum(clicks)::bigint as clk, sum(calls)::bigint as cll
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
    'ctr',            case when (select impressions from totals) > 0
                           then round(((select clicks from totals)::numeric
                                       / (select impressions from totals)) * 100, 2)
                           else null end,
    'callRate',       case when (select impressions from totals) > 0
                           then round(((select calls from totals)::numeric
                                       / (select impressions from totals)) * 100, 2)
                           else null end,
    'perDeal',        coalesce((select map from per_deal), '{}'::jsonb)
  );
$$;
revoke all on function public.tb_agent_stats from anon, authenticated;

-- ── 8. deal counts by billing mode, for the dashboard ───────────────────────
create or replace function public.tb_agent_billing_counts(p_agent_id uuid)
returns json
language sql
stable
security invoker
set search_path = public
as $$
  select json_build_object(
    'click',     count(*) filter (where coalesce(d.billing_mode, a.billing_mode) = 'click'),
    'call',      count(*) filter (where coalesce(d.billing_mode, a.billing_mode) = 'call'),
    'both',      count(*) filter (where coalesce(d.billing_mode, a.billing_mode) = 'both'),
    'overridden',count(*) filter (where d.billing_mode is not null),
    'total',     count(*)
  )
  from public.deals d
  join public.agents a on a.id = d.agent_id
  where d.agent_id = p_agent_id;
$$;
revoke all on function public.tb_agent_billing_counts from anon, authenticated;

-- ── 9. the consumer read path learns about calls ────────────────────────────
-- Adds the resolved billing mode and the effective phone number so the site and
-- the widget can render the right calls to action in step 2. The raw
-- d.billing_mode travels too, so an editor can tell "inherited" from "set on
-- this deal". Everything else is unchanged from 003.
create or replace function public.tb_search_deals(
  p_agent_slug text    default null,
  p_q          text    default null,
  p_country    text    default null,
  p_resort     text    default null,
  p_board      text    default null,
  p_airport    text    default null,
  p_min_price  numeric default null,
  p_max_price  numeric default null,
  p_nights     int     default null,
  p_sort       text    default 'recommended',
  p_compare    boolean default false,
  p_limit      int     default 24,
  p_offset     int     default 0
)
returns jsonb
language sql
stable
security invoker
set search_path = public, extensions
as $$
with filtered as (
  select
    d.*,
    a.name  as agent_name,
    a.slug  as agent_slug,
    a.town  as agent_town,
    -- A deal inherits the agent's protection and booking link when it has none of
    -- its own. This is what makes the spreadsheet importer's "no click-out URL"
    -- warning safe: the deal falls back rather than shipping a dead card.
    coalesce(nullif(d.atol_number, ''), a.atol_number)           as effective_atol,
    coalesce(nullif(d.protection_type, ''), a.protection_type)   as effective_protection,
    coalesce(nullif(d.clickout_url, ''), a.default_clickout_url) as effective_clickout,
    coalesce(nullif(d.booking_phone, ''), a.phone)               as effective_phone,
    -- Resolved here rather than copied onto the deal, so changing an agency's
    -- billing takes effect everywhere at once.
    coalesce(d.billing_mode, a.billing_mode)                     as effective_billing_mode
  from deals d
  join agents a on a.id = d.agent_id
  where d.status = 'live'
    and a.status = 'active'
    and (d.travel_until is null or d.travel_until >= current_date)
    and (p_agent_slug is null or a.slug = lower(p_agent_slug))
    and (p_country    is null or lower(d.country) = lower(p_country))
    and (p_board      is null or d.board_basis = p_board)
    and (p_airport    is null or d.departure_airports @> array[p_airport])
    and (p_min_price  is null or d.price_from >= p_min_price)
    and (p_max_price  is null or d.price_from <= p_max_price)
    and (p_nights     is null or d.nights = p_nights)
    -- resort accepts an exact match or a near-miss, so "Benidrom" still lands
    and (p_resort is null or lower(d.resort) = lower(p_resort) or d.resort % p_resort)
    and (
      p_q is null or p_q = ''
      or d.search_vector @@ websearch_to_tsquery('english', p_q)
      or d.resort % p_q
      or d.accommodation_name % p_q
    )
),
-- one row per hotel, cheapest agent representing it, every rival price attached
grouped as (
  select
    f.property_key,
    count(*)::int                                           as agent_count,
    (array_agg(to_jsonb(f) order by f.price_from, f.id))[1]  as best,
    jsonb_agg(jsonb_build_object(
      'dealId',      f.id,
      'agent',       f.agent_name,
      'agentSlug',   f.agent_slug,
      'atol',        f.effective_atol,
      'price',       f.price_from,
      'clickoutUrl', f.effective_clickout,
      -- The rival rows need their own route too: on a call-first agency the
      -- compare drawer has a number to ring, not a link to follow.
      'phone',       f.effective_phone,
      'billingMode', f.effective_billing_mode
    ) order by f.price_from, f.id)                           as compare
  from filtered f
  group by f.property_key
),
rows_flat as (
  select (to_jsonb(f) - 'search_vector') as row,
         f.price_from, f.discount_pct, f.guest_score, f.published_at
  from filtered f
),
rows_grouped as (
  select ((g.best - 'search_vector')
            || jsonb_build_object('agentCount', g.agent_count, 'compare', g.compare)) as row,
         (g.best->>'price_from')::numeric       as price_from,
         (g.best->>'discount_pct')::int         as discount_pct,
         (g.best->>'guest_score')::numeric      as guest_score,
         (g.best->>'published_at')::timestamptz as published_at
  from grouped g
),
unified as (
  select * from rows_flat    where not coalesce(p_compare, false)
  union all
  select * from rows_grouped where coalesce(p_compare, false)
),
ordered as (
  select row from unified
  order by
    case when p_sort = 'price'    then price_from   end asc  nulls last,
    case when p_sort = 'discount' then discount_pct end desc nulls last,
    case when p_sort = 'score'    then guest_score  end desc nulls last,
    case when p_sort = 'recent'   then published_at end desc nulls last,
    -- default "recommended": best saving first, then cheapest
    discount_pct desc nulls last,
    price_from   asc  nulls last
  limit  least(greatest(coalesce(p_limit, 24), 1), 60)
  offset greatest(coalesce(p_offset, 0), 0)
)
select jsonb_build_object(
  'total',   (select count(*) from unified),
  'limit',   least(greatest(coalesce(p_limit, 24), 1), 60),
  'offset',  greatest(coalesce(p_offset, 0), 0),
  'compare', coalesce(p_compare, false),
  'deals',   coalesce((select jsonb_agg(row) from ordered), '[]'::jsonb)
);
$$;
revoke all on function public.tb_search_deals from anon, authenticated;
