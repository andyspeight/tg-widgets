-- Tripbuster 010 — every call is chargeable, whatever the time
--
-- ANDY'S DECISION, AND IT REPLACES THE OUT-OF-HOURS RULE FROM 009:
--
--   "All calls are chargeable. If an agency doesn't want calls after hours, they
--    can switch on the leave us a message or disable their account during
--    certain hours."
--
-- 009 tried to protect agencies by not charging for calls that arrived while
-- they were shut. That was well meant and wrong, for a reason that is obvious
-- once said out loud: IT TOOK THE DECISION AWAY FROM THE AGENCY. We were
-- guessing on their behalf that a call at half five was worthless to them, when
-- plenty of shops answer the phone after the door is locked, divert to a mobile,
-- or would simply rather have the enquiry than not.
--
-- The agency already has the controls it needs, and they are better controls
-- than a billing exception:
--
--   closed_behaviour = 'callback'  ask for a message instead. NO CALL BUTTON is
--                                  offered, so no call happens and nothing is
--                                  charged. This is the "leave us a message"
--                                  option, and it is the default.
--   closed_behaviour = 'hide'      show nothing at all out of hours.
--   closed_behaviour = 'show'      show the number and take the calls. Charged,
--                                  because the agency asked for them.
--
-- So the agency decides whether a call CAN happen. We do not second-guess what
-- it is worth once it has. That is the same principle as decision 34a: the
-- billable event is the deliberate act, and we do not pretend to know more about
-- the call than we can see.
--
-- WHAT THIS MEANS FOR THE PAGE, and it matters: under 'callback' the site must
-- not render a chargeable call button out of hours. Before this change it showed
-- the number as a muted, still-tracked link. Leaving that in place alongside
-- "every call is chargeable" would bill an agency for taps on a number they had
-- explicitly chosen not to offer, which is precisely the complaint this whole
-- area exists to avoid. The number now shows as PLAIN TEXT there: readable, not
-- a link, not reported.
--
-- WHAT IS KEPT: out_of_hours is still recorded on every call and lead. It is no
-- longer a billing flag, it is a REPORTING one, and it is still worth having.
-- "Nineteen of your enquiries arrived while you were closed" is exactly the
-- figure an agency needs to decide whether to open on a Saturday.
--
-- NOT BACKFILLED ON PURPOSE. Calls already recorded as unbillable under the old
-- rule stay unbillable. A rule change must not reach back and re-bill history
-- somebody has already been invoiced against; that is the same reasoning that
-- put out_of_hours on the row in the first place (decision 55). The demo seed is
-- regenerated rather than patched, because it is invented data.

begin;

-- Same signature as 009, so this replaces rather than overloading it.
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

  -- STILL ASKED, STILL RECORDED, NO LONGER A BILLING DECISION. An agency that
  -- does not want out-of-hours calls sets closed_behaviour and the site stops
  -- offering the button; it is not our place to decide the call was worthless
  -- once somebody has deliberately made it.
  if v_type in ('call', 'lead') then
    v_closed := not coalesce(tb_agent_is_open(v_agent_id, now()), true);
  end if;

  -- Telephony detail, when we have any, can only take billing AWAY. We do not
  -- own the agency's number, so this is normally null and simply does not apply.
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

commit;
