-- ============================================================================
-- Tripbuster 016 — agent profiles
-- ============================================================================
-- The independent agent is the entire differentiator. Icelolly and
-- TravelSupermarket cannot show you a person in a shop in Bolton who will
-- answer the phone; that is the only thing Tripbuster has that they do not.
--
-- And until now an agency existed on this site as a name in small type under a
-- price, with nothing behind it. Every deal card said "by Coastline Holidays"
-- and that text went nowhere.
--
-- ── THE WHOLE POINT OF THIS MIGRATION IS THE SELECT LIST ────────────────────
--
-- An agency row holds things a traveller must never see: the sign-in address,
-- the password hash, the Travelgenix link, the rate tier, what they pay, when
-- their free period ends, the IP they signed up from.
--
-- So these functions NAME EVERY COLUMN THEY RETURN. No to_jsonb(a), no a.*, no
-- "everything except". A whitelist fails safe when somebody adds a column; a
-- blacklist publishes it. There is a test that reads a profile and fails if any
-- private column name appears anywhere in the response.
-- ============================================================================

begin;

-- ── 1. what an agency can say about itself ──────────────────────────────────
-- Deliberately plain text rather than markup. This is rendered on a page that
-- already treats agent-written content as untrusted, and giving them HTML would
-- mean either trusting it or building a sanitiser for the sake of a paragraph.
alter table public.agents add column if not exists about text;
alter table public.agents add column if not exists founded_year smallint;

do $$ begin
  alter table public.agents add constraint agents_founded_year_check
    check (founded_year is null or founded_year between 1800 and 2100);
exception when duplicate_object then null; end $$;

-- ── 2. one agency, everything a traveller may see ───────────────────────────
-- Returns null for an agency that is not trading, so a paused or suspended
-- agency's page 404s rather than lingering with stale deals on it.
create or replace function public.tb_agent_profile(p_slug text, p_limit int default 24)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  a agents%rowtype;
  v_stats record;
begin
  select * into a from agents where slug = lower(btrim(p_slug)) and status = 'active';
  if not found then
    return null;
  end if;

  select count(*)::int                          as live_deals,
         min(d.price_from)                      as min_price,
         max(d.discount_pct)                    as max_discount,
         count(distinct d.country)::int         as countries,
         max(greatest(d.updated_at, d.published_at)) as last_change
    into v_stats
    from deals d
   where d.agent_id = a.id and d.status = 'live'
     and (d.travel_until is null or d.travel_until >= current_date);

  return jsonb_build_object(
    -- EVERY FIELD NAMED. See the note at the top of this file before adding one.
    'name',           a.name,
    'slug',           a.slug,
    'town',           a.town,
    'region',         a.region,
    'about',          a.about,
    'website',        a.website,
    'logoUrl',        a.logo_url,
    'foundedYear',    a.founded_year,
    'protectionType', a.protection_type,
    'atolNumber',     a.atol_number,
    'abtaNumber',     a.abta_number,
    'memberSince',    a.created_at,
    -- Hours and every labelled number, in the same shape the deal page gets.
    'contact',        tb_agent_contact(a.id),
    'liveDeals',      coalesce(v_stats.live_deals, 0),
    'minPrice',       v_stats.min_price,
    'maxDiscount',    coalesce(v_stats.max_discount, 0),
    'countries',      coalesce(v_stats.countries, 0),
    'lastChange',     v_stats.last_change,
    'results',        tb_search_deals(
                        p_agent_slug := a.slug,
                        p_compare    := false,
                        p_sort       := 'discount',
                        p_limit      := p_limit
                      )
  );
end;
$$;

revoke all on function public.tb_agent_profile from anon, authenticated;

-- ── 3. the directory ────────────────────────────────────────────────────────
-- Only agencies with something live. An agency with no deals has nothing to say
-- to a traveller and would be an empty page for a crawler to find.
create or replace function public.tb_agents_public()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with live as (
    select d.agent_id,
           count(*)::int as live_deals,
           min(d.price_from) as min_price,
           max(greatest(d.updated_at, d.published_at)) as last_change,
           (array_agg(distinct d.country))[1:3] as countries
      from deals d
      join agents ag on ag.id = d.agent_id
     where d.status = 'live' and ag.status = 'active'
       and (d.travel_until is null or d.travel_until >= current_date)
     group by d.agent_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'name',           a.name,
    'slug',           a.slug,
    'town',           a.town,
    'region',         a.region,
    'about',          a.about,
    'protectionType', a.protection_type,
    'atolNumber',     a.atol_number,
    'liveDeals',      l.live_deals,
    'minPrice',       l.min_price,
    'countries',      l.countries,
    'lastChange',     l.last_change
  ) order by l.live_deals desc, a.name), '[]'::jsonb)
  from agents a
  join live l on l.agent_id = a.id
  where a.status = 'active';
$$;

revoke all on function public.tb_agents_public from anon, authenticated;

-- ── 4. the sitemap gains them ───────────────────────────────────────────────
create or replace function public.tb_sitemap()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
with live as (
  select d.property_key, d.slug, d.published_at, d.id,
         greatest(d.updated_at, d.published_at) as touched
  from deals d
  join agents a on a.id = d.agent_id
  where d.status = 'live'
    and a.status = 'active'
    and d.slug is not null
    and (d.travel_until is null or d.travel_until >= current_date)
),
pages as (
  select
    (array_agg(slug order by published_at nulls last, id))[1] as slug,
    max(touched)                                              as lastmod
  from live
  group by property_key
)
select jsonb_build_object(
  'deals', coalesce((
    select jsonb_agg(jsonb_build_object('slug', slug, 'lastmod', lastmod) order by lastmod desc)
    from pages), '[]'::jsonb),
  'destinations', tb_destinations(1),
  'agents', tb_agents_public(),
  'generated', now()
);
$$;

revoke all on function public.tb_sitemap from anon, authenticated;

-- ── 5. something for the demo agencies to say ───────────────────────────────
-- Invented, like the rest of the demo, but written the way a real agency would
-- write it rather than as lorem ipsum: who they are, how long, and what they are
-- actually good at.
update public.agents set
  about = 'We have been putting Bolton families on planes since 1998. Three of us, '
       || 'one shop on Bradshawgate, and between us about ninety years of doing this. '
       || 'We know which rooms at the Sol Pelicanos actually face the sea, and we will '
       || 'tell you when a deal is not worth having.',
  founded_year = 1998
 where slug = 'sunseeker-travel';

update public.agents set
  about = 'A Brighton agency that grew out of a cruise desk. We still do more cruise '
       || 'than anybody our size, and we are open seven days because people plan '
       || 'holidays at the weekend. Ask for Marie if it is a cruise; she has sailed '
       || 'most of them.',
  founded_year = 2006
 where slug = 'coastline-holidays';

update public.agents set
  about = 'Glasgow, family run, and we would rather you rang us. Half of what we sell '
       || 'never makes it onto a website because it is put together for the people '
       || 'asking. If you cannot get us, leave a number and you will get a call back '
       || 'the same day we open.',
  founded_year = 2011
 where slug = 'jetaway-travel';

commit;

-- ── verify it actually landed ───────────────────────────────────────────────
--   select tb_agent_profile('coastline-holidays') - 'results';
--   -- and the important one, which must return nothing:
--   select key from jsonb_each_text(tb_agent_profile('coastline-holidays') - 'results')
--    where key in ('email','password_hash','tg_client_email','rate_tier','free_until',
--                  'notify_email','signup_ip_hash','verify_token_hash','plan','status');
--   select jsonb_array_length(tb_agents_public());
--   select tb_agent_profile('no-such-agency');   -- null
