-- ============================================================================
-- Tripbuster 005 — click-out and impression tracking
-- ============================================================================
-- Click-outs are the billable event: the moment Tripbuster delivers a traveller
-- to an agent. Impressions exist to make click-through rate meaningful.
--
-- Privacy: no raw IP addresses and no full user-agent strings are ever stored.
-- The API passes a salted hash and a coarse browser family, which is the minimum
-- needed to de-duplicate a repeat visitor and spot obvious bots.
-- ============================================================================

-- Record one click-out.
--
-- Atomic on purpose: verifying the deal, deciding whether the click is billable,
-- writing the event and bumping the daily rollup all happen in one statement, so
-- the API needs a single round trip and two concurrent clicks cannot race the
-- de-duplication check.
--
-- De-duplication: a second billable click on the same deal from the same hashed
-- IP inside 30 minutes is still RECORDED but marked not billable. Keeping the row
-- means refresh-happy visitors and click fraud stay visible rather than being
-- silently dropped, while the agent is only ever billed once.
--
-- Returns null when the deal does not exist, so the API can 404 rather than
-- accumulating events for made-up ids.
create or replace function public.tb_record_click(
  p_deal_id       uuid,
  p_surface       text default 'site',
  p_ip_hash       text default null,
  p_ua_family     text default null,
  p_referrer_host text default null,
  p_country_code  text default null,
  p_suspect_bot   boolean default false
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_agent_id  uuid;
  v_clickout  text;
  v_recent    boolean := false;
  v_billable  boolean;
  v_surface   text := coalesce(nullif(p_surface, ''), 'site');
begin
  select d.agent_id, coalesce(nullif(d.clickout_url, ''), a.default_clickout_url)
    into v_agent_id, v_clickout
  from deals d
  join agents a on a.id = d.agent_id
  where d.id = p_deal_id;

  if v_agent_id is null then
    return null;
  end if;

  if v_surface not in ('site', 'widget', 'directory', 'api') then
    v_surface := 'site';
  end if;

  if p_ip_hash is not null then
    select exists (
      select 1 from click_events
      where deal_id = p_deal_id
        and ip_hash = p_ip_hash
        and is_billable
        and occurred_at > now() - interval '30 minutes'
    ) into v_recent;
  end if;

  v_billable := not (coalesce(p_suspect_bot, false) or v_recent);

  insert into click_events (deal_id, agent_id, surface, ip_hash, ua_family, referrer_host, country_code, is_billable)
  values (p_deal_id, v_agent_id, v_surface, p_ip_hash, p_ua_family, p_referrer_host,
          nullif(upper(left(coalesce(p_country_code, ''), 2)), ''), v_billable);

  insert into deal_daily_stats (deal_id, agent_id, stat_date, clicks)
  values (p_deal_id, v_agent_id, current_date, 1)
  on conflict (deal_id, stat_date)
  do update set clicks = deal_daily_stats.clicks + 1;

  return jsonb_build_object(
    'recorded',    true,
    'billable',    v_billable,
    'duplicate',   v_recent,
    'clickoutUrl', v_clickout
  );
end;
$$;

revoke all on function public.tb_record_click from anon, authenticated;

-- Record impressions in bulk.
--
-- Impressions run orders of magnitude higher than clicks and are only ever read
-- in aggregate, so they go straight into the daily counter — one row per deal per
-- day — rather than one row per view. A widget showing six deals sends one call.
create or replace function public.tb_record_impressions(p_deal_ids uuid[])
returns integer
language sql
volatile
security invoker
set search_path = public
as $$
  with wanted as (
    -- distinct, and capped, so one call cannot inflate a deal's count
    select distinct id from unnest(coalesce(p_deal_ids, '{}'::uuid[])) as id
    limit 60
  ),
  real_deals as (
    select d.id, d.agent_id from deals d join wanted w on w.id = d.id
  ),
  bumped as (
    insert into deal_daily_stats (deal_id, agent_id, stat_date, impressions)
    select r.id, r.agent_id, current_date, 1 from real_deals r
    on conflict (deal_id, stat_date)
    do update set impressions = deal_daily_stats.impressions + 1
    returning 1
  )
  select coalesce(count(*), 0)::int from bumped;
$$;

revoke all on function public.tb_record_impressions from anon, authenticated;

-- Performance for an agent's dashboard: totals over a window plus a per-deal
-- breakdown, so the dashboard reads one row instead of aggregating client-side.
-- billableClicks is what the agent would actually be charged for, which is lower
-- than clicks once repeats and bots are excluded.
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
           coalesce(sum(clicks), 0)::bigint      as clicks
    from rows_in_window
  ),
  billable as (
    select count(*)::bigint as n from click_events c, win
    where c.agent_id = p_agent_id and c.is_billable
      and c.occurred_at >= win.from_date
  ),
  per_deal as (
    select jsonb_object_agg(deal_id, jsonb_build_object('impressions', imp, 'clicks', clk)) as map
    from (
      select deal_id, sum(impressions)::bigint as imp, sum(clicks)::bigint as clk
      from rows_in_window group by deal_id
    ) t
  )
  select jsonb_build_object(
    'days',          least(greatest(coalesce(p_days, 30), 1), 365),
    'impressions',   (select impressions from totals),
    'clicks',        (select clicks from totals),
    'billableClicks',(select n from billable),
    'ctr',           case when (select impressions from totals) > 0
                          then round(((select clicks from totals)::numeric
                                      / (select impressions from totals)) * 100, 2)
                          else null end,
    'perDeal',       coalesce((select map from per_deal), '{}'::jsonb)
  );
$$;

revoke all on function public.tb_agent_stats from anon, authenticated;
