-- Tripbuster migration 008 — make the call meter actually work, and add leads
--
-- Migration 007 made a call billable only once a telephony provider confirmed it
-- connected and ran past a minimum length. We do not own the agency's phone
-- number, so that data never arrives: `call_connected` is always null, the
-- qualification always fails, and NOTHING IS EVER BILLABLE. An agency on
-- call-only billing would meter zero forever. This corrects that.
--
-- Two chargeable things a traveller can do, both of which we can see:
--
--   1. THE CALL BUTTON. On a desktop it reveals the number; on a phone it dials
--      it. Either is a deliberate act by someone who wants to ring this agency
--      about this holiday, and either is chargeable.
--
--   2. ASK US TO RING YOU. A name plus a phone number or an email address or
--      both. This one we can stand behind completely: a real person left real
--      contact details, on desktop as well as mobile, and the agency can tell us
--      what came of it.
--
-- Connection and duration are NOT gone. They are demoted from a precondition to
-- optional enrichment, and they can now only ever REDUCE what is billable, never
-- gate it. If tracked numbers are ever added, a call the provider reports as
-- unanswered stops being chargeable and everything else keeps working.
--
-- Safe to re-run: every statement is guarded.

-- ── 1. leads ────────────────────────────────────────────────────────────────
-- The first genuinely personal data Tripbuster stores, and it is stored for one
-- reason: the traveller ASKED to be contacted. It goes to the agency named on
-- the deal and nowhere else, which the form says in as many words.
--
-- Everything else in this database is minimised to hashes. This is not, because
-- a name and a number the agency cannot read is of no use to anybody.
create table if not exists public.leads (
  id            uuid primary key default gen_random_uuid(),
  agent_id      uuid not null references public.agents(id) on delete cascade,

  -- The deal survives being deleted: an agency should not lose a live enquiry
  -- because they tidied up a listing, so the title is snapshotted alongside.
  deal_id       uuid references public.deals(id) on delete set null,
  deal_title    text,

  name          text not null,
  phone         text,
  email         text,
  message       text,
  -- Free text rather than a fixed set: "after 6pm" and "weekends only" are both
  -- things people say, and neither fits a dropdown.
  preferred_time text,

  -- What came of it, as reported by the agency. This is what turns a lead into
  -- quality data and gives both sides something to point at in a dispute.
  status        text not null default 'new'
                  check (status in ('new','contacted','booked','not_interested','junk')),
  agent_note    text,
  contacted_at  timestamptz,

  -- Same minimisation as every other event: no raw IP, no full user agent, no
  -- full referrer.
  ip_hash       text,
  ua_family     text,
  referrer_host text,
  country_code  char(2),

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- A callback request with no way to call back is not a lead.
  constraint leads_need_a_way_to_reply
    check (coalesce(phone, '') <> '' or coalesce(email, '') <> '')
);

create index if not exists leads_agent_idx  on public.leads (agent_id, created_at desc);
create index if not exists leads_status_idx on public.leads (agent_id, status);
create index if not exists leads_deal_idx   on public.leads (deal_id) where deal_id is not null;

do $$ begin
  create trigger leads_touch before update on public.leads
    for each row execute function tb_touch_updated_at();
exception when duplicate_object then null; end $$;

-- Same fail-closed model as every other table.
alter table public.leads enable row level security;
revoke all on public.leads from anon, authenticated;

comment on table public.leads is
  'Callback requests. Personal data, held because the traveller asked to be '
  'contacted by the agency named on the deal. Not used for anything else.';

-- ── 2. a lead is a third kind of billable event ─────────────────────────────
alter table public.click_events drop constraint if exists click_events_event_type_check;
do $$ begin
  alter table public.click_events add constraint click_events_event_type_check
    check (event_type in ('click', 'call', 'lead'));
exception when duplicate_object then null; end $$;

alter table public.deal_daily_stats
  add column if not exists leads integer not null default 0;

-- ── 3. the corrected billing rule ───────────────────────────────────────────
-- A call event is billable when it is a deliberate act, not a bot, and not the
-- same visitor going round again inside a day.
--
-- The de-duplication window matters more here than it does for clicks. Someone
-- who reveals a number, loses it, and comes back for it an hour later has not
-- generated a second lead, and an agency would rightly object to paying twice.
drop function if exists public.tb_record_click(uuid, text, text, text, text, text, boolean);
drop function if exists public.tb_record_click(uuid, text, text, text, text, text, boolean,
                                               text, integer, boolean, text);

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
                            call_seconds, call_connected, caller_hash)
  values (p_deal_id, v_agent_id, v_surface, p_ip_hash, p_ua_family, p_referrer_host,
          nullif(upper(left(coalesce(p_country_code, ''), 2)), ''), v_billable, v_type,
          p_call_seconds, p_call_connected, p_caller_hash);

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

-- ── 4. recording a callback request ─────────────────────────────────────────
-- Writes the lead and its billable event together, so the agency's inbox and
-- their bill can never disagree about how many enquiries arrived.
--
-- De-duplication is keyed on a hash of the contact details rather than the IP,
-- because the same person asking twice from two different places is still one
-- enquiry, and a family sharing a wifi connection is two.
create or replace function public.tb_record_lead(
  p_deal_id        uuid,
  p_name           text,
  p_phone          text default null,
  p_email          text default null,
  p_message        text default null,
  p_preferred_time text default null,
  p_surface        text default 'site',
  p_ip_hash        text default null,
  p_ua_family      text default null,
  p_referrer_host  text default null,
  p_country_code   text default null,
  p_suspect_bot    boolean default false,
  p_contact_hash   text default null
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_agent_id   uuid;
  v_agent_name text;
  v_title      text;
  v_lead_id    uuid;
  v_event      jsonb;
begin
  select d.agent_id, d.title, a.name
    into v_agent_id, v_title, v_agent_name
  from deals d join agents a on a.id = d.agent_id
  where d.id = p_deal_id;

  if v_agent_id is null then
    return null;
  end if;

  insert into leads (agent_id, deal_id, deal_title, name, phone, email, message,
                     preferred_time, ip_hash, ua_family, referrer_host, country_code)
  values (v_agent_id, p_deal_id, v_title, p_name,
          nullif(p_phone, ''), nullif(p_email, ''), nullif(p_message, ''),
          nullif(p_preferred_time, ''), p_ip_hash, p_ua_family, p_referrer_host,
          nullif(upper(left(coalesce(p_country_code, ''), 2)), ''))
  returning id into v_lead_id;

  -- One meter for everything chargeable.
  v_event := tb_record_click(p_deal_id, p_surface, p_ip_hash, p_ua_family, p_referrer_host,
                             p_country_code, p_suspect_bot, 'lead', null, null, p_contact_hash);

  return jsonb_build_object(
    'recorded',  true,
    'leadId',    v_lead_id,
    'agentName', v_agent_name,
    'dealTitle', v_title,
    'billable',  coalesce(v_event->>'billable', 'false')::boolean
  );
end;
$$;

revoke all on function public.tb_record_lead(uuid, text, text, text, text, text, text,
                                             text, text, text, text, boolean, text)
  from anon, authenticated;

-- ── 5. stats gain leads ─────────────────────────────────────────────────────
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

-- ── 6. how the leads inbox is looking ───────────────────────────────────────
create or replace function public.tb_agent_lead_counts(p_agent_id uuid)
returns json
language sql
stable
security invoker
set search_path = public
as $$
  select json_build_object(
    'new',            count(*) filter (where status = 'new'),
    'contacted',      count(*) filter (where status = 'contacted'),
    'booked',         count(*) filter (where status = 'booked'),
    'not_interested', count(*) filter (where status = 'not_interested'),
    'junk',           count(*) filter (where status = 'junk'),
    'total',          count(*)
  )
  from public.leads where agent_id = p_agent_id;
$$;
revoke all on function public.tb_agent_lead_counts from anon, authenticated;
