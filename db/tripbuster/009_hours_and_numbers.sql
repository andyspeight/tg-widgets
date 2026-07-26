-- Tripbuster 009 — opening hours, and more than one number per agency
--
-- WHY THIS EXISTS
--
-- Migration 008 made a call billable the moment somebody deliberately asks for
-- the number, because we do not own the agency's phone line and never learn
-- whether it was answered. That is the right rule, and it has one uncomfortable
-- edge: a traveller tapping at eleven at night gets no answer, and under 008
-- that tap is still chargeable.
--
-- Opening hours close that edge, and they close it by keeping the enquiry
-- rather than throwing it away:
--
--   * OUT OF HOURS, A CALL IS RECORDED BUT NOT CHARGED FOR. The agency sees it
--     happened, which is genuinely useful when deciding whether Saturday
--     afternoons are worth staffing, and they are not billed for a phone nobody
--     was sitting next to.
--   * OUT OF HOURS, A CALLBACK REQUEST IS STILL CHARGED FOR, and it should be.
--     It is the enquiry that would otherwise have been lost, it arrives with a
--     name and a way to reply, and it is worth more to the agency at midnight
--     than a ring they missed.
--
-- So the closed state does not remove the call to action, it CHANGES it. That is
-- why the default closed behaviour is 'callback' rather than 'hide'.
--
-- MULTIPLE NUMBERS is the same feature seen from the other side. An agency with
-- an out-of-hours mobile does not want it shown at ten in the morning, and an
-- agency with two shops wants both listed. agent_phones therefore carries a
-- label and a when_shown, and 'open' / 'closed' are resolved against exactly the
-- same hours.
--
-- WHERE EACH DECISION IS MADE, AND WHY IT IS SPLIT
--
--   THE PAGE decides what to SHOW. tb_search_deals hands out the schedule and
--   the numbers, never a computed "we are open right now", because
--   /api/tripbuster/deals is CDN-cached — a cached yes would still read yes an
--   hour after closing time. A schedule does not go stale.
--
--   THE DATABASE decides what to CHARGE, at the moment the event arrives, from
--   its own clock. A page that was cached, kept open overnight or edited by hand
--   cannot mint a chargeable out-of-hours call.
--
-- TIMES ARE STORED AS LOCAL WALL-CLOCK TIMES against the agency's own time zone,
-- not as offsets from UTC. That is what makes British Summer Time a non-event:
-- nine in the morning is nine in the morning in March and in July, and
-- `at time zone` does the work. Storing an offset would have meant editing every
-- agency's hours twice a year.

begin;

-- ── 1. how an agency describes itself ───────────────────────────────────────

alter table public.agents
  add column if not exists time_zone text not null default 'Europe/London';

-- 'always' keeps the pre-009 behaviour exactly: no hours, never closed. An
-- agency only becomes closeable once it has actually told us its hours, so this
-- migration changes nothing for anybody until they fill the form in.
alter table public.agents
  add column if not exists hours_mode text not null default 'always';

do $$ begin
  alter table public.agents add constraint agents_hours_mode_check
    check (hours_mode in ('always', 'scheduled'));
exception when duplicate_object then null; end $$;

-- What a closed agency shows instead of a live call button.
--   callback — lead with "ask us to ring you", and show the number as
--              information rather than as a call we are selling. The default,
--              because it is the only one of the three that keeps the enquiry.
--   show     — show the number anyway. For an agency happy to take voicemail.
--   hide     — show neither. For an agency that would rather have silence.
alter table public.agents
  add column if not exists closed_behaviour text not null default 'callback';

do $$ begin
  alter table public.agents add constraint agents_closed_behaviour_check
    check (closed_behaviour in ('callback', 'show', 'hide'));
exception when duplicate_object then null; end $$;

-- ── 2. the weekly pattern ───────────────────────────────────────────────────
-- One row per period, so a shop that shuts for lunch is two rows on that day
-- rather than a special case. NO ROWS FOR A DAY MEANS CLOSED THAT DAY, which is
-- why a missing Sunday needs no "closed" flag to go with it.
--
-- day_of_week matches extract(dow): 0 is Sunday. Chosen to match Postgres and
-- JavaScript's getDay() rather than ISO, so neither side has to shift it.
create table if not exists public.agent_hours (
  id           uuid primary key default gen_random_uuid(),
  agent_id     uuid not null references public.agents(id) on delete cascade,
  day_of_week  smallint not null check (day_of_week between 0 and 6),
  opens        time not null,
  closes       time not null,
  created_at   timestamptz not null default now(),

  -- time '24:00' is a real value in Postgres and means end of day, so a
  -- genuinely 24-hour Saturday is 00:00 to 24:00 rather than a magic flag.
  -- Periods that wrap past midnight are deliberately NOT allowed: a travel
  -- agency open 23:00 to 01:00 is not a real case, and allowing it would make
  -- "when do you next open" ambiguous for the sake of nobody.
  constraint agent_hours_ordered check (closes > opens and closes <= time '24:00'),
  unique (agent_id, day_of_week, opens)
);

create index if not exists agent_hours_agent_day_idx
  on public.agent_hours (agent_id, day_of_week);

-- ── 3. the exceptions ───────────────────────────────────────────────────────
-- Bank holidays, the Christmas shutdown, a late night before the school break.
-- A special day REPLACES the weekly pattern for that date, rather than adding to
-- it, because "closed on Boxing Day" has to be able to override "open Fridays".
--
-- opens null means closed all day. One period per date is enough: a bank holiday
-- with a lunch break is not worth a schema.
create table if not exists public.agent_special_days (
  id          uuid primary key default gen_random_uuid(),
  agent_id    uuid not null references public.agents(id) on delete cascade,
  on_date     date not null,
  opens       time,
  closes      time,
  note        text,
  created_at  timestamptz not null default now(),

  constraint agent_special_days_shape check (
    (opens is null and closes is null)
    or (opens is not null and closes is not null
        and closes > opens and closes <= time '24:00')
  ),
  unique (agent_id, on_date)
);

create index if not exists agent_special_days_agent_date_idx
  on public.agent_special_days (agent_id, on_date);

-- ── 4. more than one number ─────────────────────────────────────────────────
-- agents.phone STAYS THE PRIMARY NUMBER. It is referenced by the write path, the
-- settings screen and every existing deal, and duplicating it into this table
-- would create two places to change it and one of them to forget. This table
-- holds the ADDITIONAL numbers, and tb_agent_contact returns the primary first
-- followed by these.
create table if not exists public.agent_phones (
  id          uuid primary key default gen_random_uuid(),
  agent_id    uuid not null references public.agents(id) on delete cascade,
  label       text not null,
  phone       text not null,

  -- always — list it whatever the time
  -- open    — only while the agency is open (a shop line)
  -- closed  — only while it is closed (the out-of-hours mobile)
  when_shown  text not null default 'always'
                check (when_shown in ('always', 'open', 'closed')),
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),

  constraint agent_phones_label_not_blank check (btrim(label) <> ''),
  constraint agent_phones_phone_not_blank check (btrim(phone) <> '')
);

create index if not exists agent_phones_agent_idx
  on public.agent_phones (agent_id, sort_order);

-- Fail closed, exactly like every other table here.
alter table public.agent_hours        enable row level security;
alter table public.agent_special_days enable row level security;
alter table public.agent_phones       enable row level security;

revoke all on public.agent_hours        from anon, authenticated;
revoke all on public.agent_special_days from anon, authenticated;
revoke all on public.agent_phones       from anon, authenticated;

-- ── 5. why a call was not charged for ───────────────────────────────────────
-- Recorded on the row rather than worked out later from the hours, because hours
-- change. An agency that starts opening on Sundays must not retrospectively turn
-- last month's unbilled Sunday calls into billed ones, and an auditor asking
-- "why was this one free" deserves an answer from the row itself.
--
-- Null for a click, where the question does not apply.
alter table public.click_events
  add column if not exists out_of_hours boolean;

-- ── 6. is this agency open? ─────────────────────────────────────────────────
-- The authority for billing. Evaluated in the agency's own zone, so BST needs no
-- thought anywhere else in the system.
create or replace function public.tb_agent_is_open(
  p_agent_id uuid,
  p_at       timestamptz default now()
)
returns boolean
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_tz      text;
  v_mode    text;
  v_local   timestamp;
  v_time    time;
  v_dow     smallint;
  v_opens   time;
  v_closes  time;
  v_found   boolean := false;
begin
  select coalesce(nullif(a.time_zone, ''), 'Europe/London'), a.hours_mode
    into v_tz, v_mode
  from agents a where a.id = p_agent_id;

  -- Unknown agency: say nothing rather than guess. Callers treat null as open,
  -- so a missing row can never make an event free by accident.
  if v_mode is null then
    return null;
  end if;

  if v_mode <> 'scheduled' then
    return true;
  end if;

  v_local := p_at at time zone v_tz;
  v_time  := v_local::time;
  v_dow   := extract(dow from v_local)::smallint;

  -- A special day replaces the weekly pattern for that date.
  select s.opens, s.closes into v_opens, v_closes
  from agent_special_days s
  where s.agent_id = p_agent_id and s.on_date = v_local::date;

  if found then
    if v_opens is null then
      return false;                    -- closed all day
    end if;
    return v_time >= v_opens and v_time < v_closes;
  end if;

  select exists (
    select 1 from agent_hours h
    where h.agent_id = p_agent_id
      and h.day_of_week = v_dow
      and v_time >= h.opens
      and v_time < h.closes
  ) into v_found;

  return v_found;
end;
$$;

revoke all on function public.tb_agent_is_open(uuid, timestamptz) from anon, authenticated;

-- ── 7. everything a page needs to decide for itself ─────────────────────────
-- Deliberately time-INDEPENDENT apart from the special-day window, so a CDN can
-- cache it. The page works out whether the agency is open right now; the
-- database works it out again when money is involved.
create or replace function public.tb_agent_contact(p_agent_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'timeZone',        coalesce(nullif(a.time_zone, ''), 'Europe/London'),
    'hoursMode',       a.hours_mode,
    'closedBehaviour', a.closed_behaviour,
    -- The primary number first, then the extras in the agency's own order.
    'phones', (
      case when coalesce(a.phone, '') = '' then '[]'::jsonb
           else jsonb_build_array(jsonb_build_object(
                  'label', 'Main number', 'phone', a.phone, 'whenShown', 'always'))
      end
      ||
      coalesce((
        select jsonb_agg(jsonb_build_object(
                 'label', p.label, 'phone', p.phone, 'whenShown', p.when_shown)
               order by p.sort_order, p.created_at)
        from agent_phones p where p.agent_id = a.id
      ), '[]'::jsonb)
    ),
    'hours', coalesce((
      select jsonb_agg(jsonb_build_object(
               'day',    h.day_of_week,
               'opens',  to_char(h.opens,  'HH24:MI'),
               'closes', to_char(h.closes, 'HH24:MI'))
             order by h.day_of_week, h.opens)
      from agent_hours h where h.agent_id = a.id
    ), '[]'::jsonb),
    -- Only the dates near enough to matter. A page does not need last winter's
    -- bank holidays, and shipping them all would grow forever.
    'specialDays', coalesce((
      select jsonb_agg(jsonb_build_object(
               'date',   to_char(s.on_date, 'YYYY-MM-DD'),
               'opens',  to_char(s.opens,  'HH24:MI'),
               'closes', to_char(s.closes, 'HH24:MI'),
               'note',   s.note)
             order by s.on_date)
      from agent_special_days s
      where s.agent_id = a.id
        and s.on_date between current_date - 1 and current_date + 90
    ), '[]'::jsonb)
  )
  from agents a where a.id = p_agent_id;
$$;

revoke all on function public.tb_agent_contact(uuid) from anon, authenticated;

-- ── 8. a deal's phone becomes an OVERRIDE, not a copy ───────────────────────
-- Before 009, saving a deal copied the agency's number onto it. With one number
-- that was invisible; with several it would pin every existing deal to whichever
-- number happened to be primary when it was saved, and no amount of hours
-- routing would ever reach it.
--
-- booking_phone now means "this deal rings somewhere different". Null means "use
-- whichever of the agency's numbers applies right now". The read path already
-- coalesced in exactly that order, so nothing about a single-number agency
-- changes.
--
-- Clearing only the values that MATCH the agency's number is precise rather than
-- broad: that equality is the signature of the old write-time copy. A number an
-- agent actually typed in by hand differs from their agency default, and survives.
--
-- THE ROUTE CHECK HAS TO COME OUT OF THE DATABASE FIRST. 007 left a backstop
-- saying a live deal needs a price AND either a link or a phone ON THE ROW. Once
-- the phone is inherited rather than copied, a perfectly good call-only deal has
-- neither column set, so that check would refuse it — and would have refused
-- this very migration on any agency whose only route was the inherited number.
--
-- This is the same reasoning as decision 33, followed one step further. A CHECK
-- constraint cannot see the agents row, so it can never judge a route correctly;
-- publishBlockers can, and already does. The database keeps the half it can
-- actually verify: a live deal needs a price.
alter table public.deals drop constraint if exists deals_live_needs_price_and_route;

do $$ begin
  alter table public.deals add constraint deals_live_needs_price
    check (status <> 'live' or price_from is not null);
exception when duplicate_object then null; end $$;

update public.deals d
   set booking_phone = null
  from public.agents a
 where a.id = d.agent_id
   and d.booking_phone is not null
   and btrim(d.booking_phone) = btrim(coalesce(a.phone, ''));

-- ── 9. out of hours takes billing away from a call, never from a callback ───
-- Same signature as 008, so this replaces rather than overloading it. (Adding a
-- parameter would have created a second function and made an existing call
-- ambiguous — see the note in 008.)
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
  v_surface    text := coalesce(nullif(p_surface, ''), 'site');
  v_type       text := case when p_event_type in ('call', 'lead') then p_event_type else 'click' end;
  v_window     interval;
  v_closed     boolean := false;
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

  -- A click is a cheap, repeatable act; revealing a number or asking for a call
  -- back is not, so those get a full day rather than half an hour.
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

  -- Asked and answered from OUR clock, not the caller's word for it. A page that
  -- was cached, left open overnight or edited by hand cannot make a closed
  -- agency look open. An agency with no hours set is never closed, and a missing
  -- agency row returns null, which coalesces to open — so this can only ever
  -- take billing away deliberately.
  if v_type in ('call', 'lead') then
    v_closed := not coalesce(tb_agent_is_open(v_agent_id, now()), true);
  end if;

  -- A CALL nobody can answer is not something to charge for. A CALLBACK REQUEST
  -- out of hours is the opposite: it is the enquiry that would otherwise have
  -- been lost, and it is worth MORE at midnight than a ring into an empty shop.
  -- So the closed state moves the charge from one to the other rather than
  -- cancelling it, which is also why the site swaps the button for the form.
  if v_type = 'call' and v_closed then
    v_billable := false;
  end if;

  -- Telephony detail, when we have any, can only take billing AWAY. We do not
  -- own the agency's number, so this is normally null and simply does not
  -- apply; if tracked numbers are added later, a call the provider reports as
  -- unanswered or too short stops being chargeable with no other change.
  if v_type = 'call' then
    if p_call_connected is false then
      v_billable := false;
    elsif p_call_seconds is not null and p_call_seconds < coalesce(v_min_secs, 0) then
      v_billable := false;
    end if;
  end if;

  insert into click_events (deal_id, agent_id, surface, ip_hash, ua_family, referrer_host,
                            country_code, is_billable, event_type,
                            call_seconds, call_connected, caller_hash, out_of_hours)
  values (p_deal_id, v_agent_id, v_surface, p_ip_hash, p_ua_family, p_referrer_host,
          nullif(upper(left(coalesce(p_country_code, ''), 2)), ''), v_billable, v_type,
          p_call_seconds, p_call_connected, p_caller_hash,
          case when v_type = 'click' then null else v_closed end);

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
    'phone',       v_phone
  );
end;
$$;

revoke all on function public.tb_record_click(uuid, text, text, text, text, text, boolean,
                                              text, integer, boolean, text)
  from anon, authenticated;

-- ── 10. out-of-hours counts on the dashboard ────────────────────────────────
-- An agency deciding whether to staff Saturday afternoons needs to see the
-- demand it is currently turning away, so the unbilled out-of-hours events are
-- reported rather than quietly dropped.
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
           coalesce(sum(calls), 0)::bigint       as calls,
           coalesce(sum(leads), 0)::bigint       as leads
    from rows_in_window
  ),
  billable as (
    select
      count(*) filter (where c.event_type = 'click')::bigint as clicks,
      count(*) filter (where c.event_type = 'call')::bigint  as calls,
      count(*) filter (where c.event_type = 'lead')::bigint  as leads
    from click_events c, win
    where c.agent_id = p_agent_id and c.is_billable
      and c.occurred_at >= win.from_date
  ),
  after_hours as (
    select
      count(*) filter (where c.event_type = 'call')::bigint as calls,
      count(*) filter (where c.event_type = 'lead')::bigint as leads
    from click_events c, win
    where c.agent_id = p_agent_id and c.out_of_hours
      and c.occurred_at >= win.from_date
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
    -- Demand that arrived while the shop was shut. Calls here were NOT charged
    -- for; callbacks here were, and are the reason the form exists.
    'afterHoursCalls', (select calls from after_hours),
    'afterHoursLeads', (select leads from after_hours),
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

-- ── 11. the read path hands out the schedule, not a verdict ─────────────────
-- Unchanged from 007 apart from agent_contact, which travels on every deal and
-- on every rival row in the compare drawer, because the drawer has to offer each
-- agency the route that agency can actually answer.
--
-- Deliberately NOT "isOpen": this response is CDN-cached, and a cached yes would
-- still say yes an hour after closing time. A schedule cannot go stale.
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
    coalesce(nullif(d.atol_number, ''), a.atol_number)           as effective_atol,
    coalesce(nullif(d.protection_type, ''), a.protection_type)   as effective_protection,
    coalesce(nullif(d.clickout_url, ''), a.default_clickout_url) as effective_clickout,
    -- Still the single best number, for anything that only wants one. Null on
    -- the deal now means "use the agency's", which is what makes the hours
    -- routing reachable at all.
    coalesce(nullif(d.booking_phone, ''), a.phone)               as effective_phone,
    coalesce(d.billing_mode, a.billing_mode)                     as effective_billing_mode,
    -- Hours, time zone, closed behaviour and every number with its label.
    tb_agent_contact(a.id)                                       as agent_contact
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
    and (p_resort is null or lower(d.resort) = lower(p_resort) or d.resort % p_resort)
    and (
      p_q is null or p_q = ''
      or d.search_vector @@ websearch_to_tsquery('english', p_q)
      or d.resort % p_q
      or d.accommodation_name % p_q
    )
),
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
      'phone',       f.effective_phone,
      'billingMode', f.effective_billing_mode,
      'contact',     f.agent_contact
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

-- ── 12. saving a schedule, all or nothing ───────────────────────────────────
-- A schedule is edited as a whole week and saved as a whole week, so storing it
-- means REPLACING three child tables. Doing that over PostgREST would be a
-- delete followed by an insert, with a window in between where the agency has no
-- hours at all — and an agency on 'scheduled' with no hours reads as CLOSED. A
-- save that failed halfway would therefore take their call buttons down and swap
-- every deal to a callback form until somebody noticed.
--
-- One function, one transaction, no window. This is also why the collections are
-- replace-all rather than per-row CRUD: the agent chose a whole week, and a
-- half-applied week is a state they never asked for.
--
-- NULL MEANS LEAVE IT ALONE. An empty array means clear it. p_clear_phone exists
-- because null already means "don't touch", so there would otherwise be no way
-- to remove the main number.
--
-- The agency id comes from the caller, which is the API, which takes it from the
-- bearer token and never from the request body.
create or replace function public.tb_save_agent_settings(
  p_agent_id         uuid,
  p_billing_mode     text    default null,
  p_call_min_seconds integer default null,
  p_phone            text    default null,
  p_clear_phone      boolean default false,
  p_time_zone        text    default null,
  p_hours_mode       text    default null,
  p_closed_behaviour text    default null,
  p_hours            jsonb   default null,
  p_special_days     jsonb   default null,
  p_phones           jsonb   default null
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_row agents;
begin
  update agents a set
    billing_mode     = coalesce(p_billing_mode, a.billing_mode),
    call_min_seconds = coalesce(p_call_min_seconds, a.call_min_seconds),
    phone            = case when coalesce(p_clear_phone, false) then null
                            when p_phone is not null then p_phone
                            else a.phone end,
    time_zone        = coalesce(p_time_zone, a.time_zone),
    hours_mode       = coalesce(p_hours_mode, a.hours_mode),
    closed_behaviour = coalesce(p_closed_behaviour, a.closed_behaviour)
  where a.id = p_agent_id
  returning a.* into v_row;

  if v_row.id is null then
    return null;
  end if;

  if p_hours is not null then
    delete from agent_hours where agent_id = p_agent_id;
    insert into agent_hours (agent_id, day_of_week, opens, closes)
    select p_agent_id,
           (e->>'day')::smallint,
           (e->>'opens')::time,
           (e->>'closes')::time
    from jsonb_array_elements(p_hours) e;
  end if;

  if p_special_days is not null then
    delete from agent_special_days where agent_id = p_agent_id;
    insert into agent_special_days (agent_id, on_date, opens, closes, note)
    select p_agent_id,
           (e->>'date')::date,
           nullif(e->>'opens', '')::time,
           nullif(e->>'closes', '')::time,
           nullif(e->>'note', '')
    from jsonb_array_elements(p_special_days) e;
  end if;

  if p_phones is not null then
    delete from agent_phones where agent_id = p_agent_id;
    insert into agent_phones (agent_id, label, phone, when_shown, sort_order)
    select p_agent_id,
           e->>'label',
           e->>'phone',
           coalesce(nullif(e->>'whenShown', ''), 'always'),
           coalesce((e->>'sortOrder')::integer, 0)
    from jsonb_array_elements(p_phones) e;
  end if;

  return jsonb_build_object(
    'billingMode',     v_row.billing_mode,
    'callMinSeconds',  v_row.call_min_seconds,
    'phone',           coalesce(v_row.phone, ''),
    'contact',         tb_agent_contact(p_agent_id)
  );
end;
$$;

revoke all on function public.tb_save_agent_settings(uuid, text, integer, text, boolean,
                                                     text, text, text, jsonb, jsonb, jsonb)
  from anon, authenticated;

commit;
