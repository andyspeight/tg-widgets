-- ---------------------------------------------------------------------------
-- 0034  Page visits: who is reading a published site
-- ---------------------------------------------------------------------------
--
-- The first slice of the Duda visibility upgrade (docs/duda-visibility-review.md,
-- 15 Sep 2026). Duda's headline finding is that AI crawler visits predict AI
-- recommendations, and until today we allowed every crawler in (lib/seo/
-- robots.ts) and could not say whether one had ever come. This table counts
-- every request to a published page, per day, as one of four kinds:
--
--   visitor   a person, or at least a browser that is not a known robot
--   ai        a person who arrived FROM an AI assistant (the referer is
--             chatgpt.com, perplexity.ai, gemini.google.com and so on)
--   crawler   a named crawler: the AI ones (GPTBot, PerplexityBot, ClaudeBot,
--             Google-Extended...) and the search ones (Googlebot, Bingbot...),
--             with its name in `source`
--   bot       anything else that is plainly not a person (monitors, link
--             previews, scripts), counted so it is kept OUT of the visitor number
--
-- COUNTS ONLY, and nothing about anybody. One row per tenant, day, path, kind
-- and source, incremented in place. No IP, no user agent, no session, no cookie,
-- so a visitor is never identified and the cookie banner is untouched: this is
-- a tally of pages read, not a record of people. The day is the UTC day, the
-- same clock the monthly report uses.
--
-- THE RENDERER ROLE STAYS READ-ONLY, the doctrine of 0025. The public site holds
-- no privilege on this table; its one door is public.record_visit, a SECURITY
-- DEFINER function it may only execute, which takes the tenant from the
-- transaction, checks the shape, and increments. A bug in the public site can
-- at worst inflate a count; it cannot read one back or touch anything else.
--
-- THE APP ROLE READS AND NEVER WRITES. The dashboard reads through RLS like
-- every other screen. Nothing on the tool side inserts, updates or deletes a
-- row: the only deletion is public.prune_page_visits, a definer function the
-- nightly housekeeping cron runs to keep ninety days and no more, because a
-- tally older than that is not something a client will ever ask to see, and
-- keeping it forever would be keeping it for no reason.
--
-- Safe to re-run.

create table if not exists public.page_visits (
  tenant_id uuid    not null references public.tenants(id) on delete cascade,
  -- The UTC day the requests fell on.
  day       date    not null,
  -- The page's path with its leading slash; '/' is the home page.
  path      text    not null check (length(path) <= 400),
  kind      text    not null check (kind in ('visitor', 'ai', 'crawler', 'bot')),
  -- The crawler's name, or the assistant a visitor came from; '' otherwise.
  source    text    not null default '' check (length(source) <= 40),
  count     integer not null default 0 check (count >= 0),
  primary key (tenant_id, day, path, kind, source)
);

-- The dashboard's one read: this site, the last N days.
create index if not exists page_visits_recent
  on public.page_visits (tenant_id, day desc);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.page_visits enable row level security;
alter table public.page_visits force row level security;

drop policy if exists page_visits_app on public.page_visits;
create policy page_visits_app on public.page_visits
  for select to tg_sites_app
  using (tenant_id = public.current_tenant());

-- Read only. No insert, update or delete for the app role: see the header.
grant select on public.page_visits to tg_sites_app;

-- ---------------------------------------------------------------------------
-- The one write door for the public site
-- ---------------------------------------------------------------------------

create or replace function public.record_visit(
  p_path   text,
  p_kind   text,
  p_source text
) returns boolean
language plpgsql
security definer
-- Definer functions must pin their search path or a hostile schema shadows
-- every unqualified name in the body.
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid;
begin
  -- The tenant comes from the transaction's setting, exactly as RLS reads it.
  v_tenant := public.current_tenant();
  if v_tenant is null then
    return false;
  end if;

  -- Shape checks here as well as on the table, so the caller gets a calm
  -- false rather than an exception to swallow.
  if p_path is null or length(p_path) = 0 or length(p_path) > 400 then
    return false;
  end if;
  if p_kind is null or p_kind not in ('visitor', 'ai', 'crawler', 'bot') then
    return false;
  end if;

  insert into public.page_visits (tenant_id, day, path, kind, source, count)
  values (
    v_tenant,
    (now() at time zone 'utc')::date,
    p_path,
    p_kind,
    left(coalesce(p_source, ''), 40),
    1
  )
  on conflict (tenant_id, day, path, kind, source)
  do update set count = public.page_visits.count + 1;

  return true;
end;
$$;

-- Execute only. The renderer role holds no privilege on the table itself.
revoke all on function public.record_visit(text, text, text) from public;
grant execute on function public.record_visit(text, text, text)
  to tg_sites_renderer, tg_sites_app;

-- ---------------------------------------------------------------------------
-- Housekeeping: keep ninety days
-- ---------------------------------------------------------------------------

create or replace function public.prune_page_visits(
  p_days integer
) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_removed integer;
begin
  -- A floor of thirty days, so a wrong argument cannot empty the table.
  delete from public.page_visits
   where day < (now() at time zone 'utc')::date - greatest(coalesce(p_days, 90), 30);
  get diagnostics v_removed = row_count;
  return v_removed;
end;
$$;

-- The app role only: the public site has no business pruning anything.
revoke all on function public.prune_page_visits(integer) from public;
grant execute on function public.prune_page_visits(integer) to tg_sites_app;
