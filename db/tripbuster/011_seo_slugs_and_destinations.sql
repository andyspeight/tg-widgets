-- ============================================================================
-- Tripbuster 011 — addressable pages: deal slugs, destinations, sitemap
-- ============================================================================
-- WHY THIS EXISTS
--
-- Until now a deal lived at /tripbuster/deal?id=<uuid>. Three things were wrong
-- with that, and only one of them is cosmetic:
--
--   1. There was NO WAY TO FETCH ONE DEAL. The deal page pulled sixty deals and
--      searched the response for the one it wanted, which quietly stops working
--      the moment the catalogue is bigger than sixty live deals. That is a real
--      bug with a deadline on it, not a tidiness problem.
--   2. An opaque uuid in a query string tells a search engine nothing, and
--      parameterised URLs are treated conservatively by every crawler.
--   3. There were no destination pages at all, and "cheap holidays to Benidorm"
--      is the entire acquisition channel for a comparison site.
--
-- So this migration gives every published deal a stable, readable, unique slug,
-- teaches the existing read path to filter by it, and derives country and resort
-- landing pages from the deals that are actually live.
--
-- STABLE IS THE POINT. A slug is minted ONCE, when a deal first goes live, and
-- is never rewritten afterwards. If an agent corrects a hotel's spelling the URL
-- stays put, because a URL that moves loses every link and every ranking that
-- pointed at it. Draft deals get no slug at all: they have no public page, so
-- there is nothing to name.
--
-- DESTINATIONS ARE DERIVED, NOT DECLARED. There is no destinations table. A
-- country page exists exactly while some agent has a live deal in that country,
-- and stops existing when the last one expires. That is the honest answer for an
-- advertising platform: we do not have a view on Spain, we have whatever our
-- advertisers are selling in Spain this week.
-- ============================================================================

begin;

-- ── 1. slugify ──────────────────────────────────────────────────────────────
-- IMMUTABLE because it is used in the index expressions below, and Postgres will
-- not index a function it cannot trust to give the same answer twice.
--
-- Accents are folded by hand rather than with unaccent(). unaccent is an
-- extension, and the whole point of an index expression is that it must never
-- change meaning underneath the index. A translate() table cannot be upgraded
-- out from under us. It also keeps this schema installable on a bare Postgres.
create or replace function public.tb_slugify(p_text text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select nullif(
    btrim(
      regexp_replace(
        regexp_replace(
          lower(
            translate(
              -- The one-to-many folds have to happen before translate(), which
              -- is strictly character for character.
              replace(replace(replace(replace(p_text,
                'ß', 'ss'), 'æ', 'ae'), 'Æ', 'ae'), 'ø', 'o'),
              -- 54 characters in, 54 characters out. Count these if you edit them.
              'àáâãäåÀÁÂÃÄÅ' || 'èéêëÈÉÊË' || 'ìíîïÌÍÎÏ'
                || 'òóôõöÒÓÔÕÖØ' || 'ùúûüÙÚÛÜ' || 'ñÑ' || 'çÇ' || 'ýÿÝ',
              'aaaaaaAAAAAA' || 'eeeeEEEE' || 'iiiiIIII'
                || 'oooooOOOOOO' || 'uuuuUUUU' || 'nN' || 'cC' || 'yyY'
            )
          ),
          '[^a-z0-9]+', '-', 'g'
        ),
        '-{2,}', '-', 'g'
      ),
      '-'
    ),
    ''
  );
$$;

comment on function public.tb_slugify(text) is
  'URL-safe lowercase slug. Immutable so it can be indexed. Folds Latin-1 accents by hand rather than depending on unaccent.';

-- ── 2. the slug column ──────────────────────────────────────────────────────
alter table public.deals add column if not exists slug text;

do $$ begin
  alter table public.deals add constraint deals_slug_shape
    check (slug is null or slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
exception when duplicate_object then null; end $$;

create unique index if not exists deals_slug_key on public.deals (slug) where slug is not null;

-- How a slug is built. Hotel and resort first because that is what a traveller
-- types, then eight hex characters of the deal's own id.
--
-- The id suffix is not decoration. Two agents advertising the same hotel in the
-- same resort produce the same words, and they are DIFFERENT deals at different
-- prices, so they need different pages. The suffix is what makes the slug unique
-- without a retry loop, and the unique index above turns the remaining
-- one-in-four-billion case into a loud error rather than a silent overwrite.
create or replace function public.tb_build_deal_slug(p_deal public.deals)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    nullif(
      concat_ws('-',
        public.tb_slugify(left(coalesce(nullif(btrim(p_deal.accommodation_name), ''),
                                        p_deal.title, 'holiday'), 60)),
        public.tb_slugify(left(coalesce(nullif(btrim(p_deal.resort), ''),
                               nullif(btrim(p_deal.country), ''), ''), 40))
      ), ''),
    'holiday'
  ) || '-' || left(replace(p_deal.id::text, '-', ''), 8);
$$;

-- Minted at first publish, never rewritten. `slug is null` is the whole guard:
-- once a deal has a URL it keeps it, whatever the agent edits afterwards.
create or replace function public.tb_set_deal_slug()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.slug is null and new.status = 'live' then
    new.slug := public.tb_build_deal_slug(new);
  end if;
  return new;
end;
$$;

drop trigger if exists deals_slug on public.deals;
create trigger deals_slug before insert or update on public.deals
  for each row execute function public.tb_set_deal_slug();

-- Backfill. Every deal that is already live needs its page today, and every deal
-- that has ever been live keeps a URL so the page can 410 rather than 404 later.
update public.deals
   set slug = public.tb_build_deal_slug(deals)
 where slug is null
   and status in ('live', 'paused', 'expired');

-- ── 3. destinations are looked up by slug ───────────────────────────────────
-- Indexed on the expression, so /tripbuster/holidays/spain does not sequentially
-- scan every deal to discover that 'spain' means 'Spain'.
create index if not exists deals_country_slug_idx
  on public.deals (public.tb_slugify(country)) where status = 'live';

create index if not exists deals_resort_slug_idx
  on public.deals (public.tb_slugify(resort)) where status = 'live';

-- ── 4. the read path learns one more filter ─────────────────────────────────
-- p_deal_slug narrows to the property group containing that one deal, which is
-- exactly what a deal page wants: this hotel, and every agent advertising it.
--
-- DROPPED AND RECREATED rather than replaced. Adding a defaulted parameter to a
-- function that already exists creates an OVERLOAD, not a replacement, and every
-- subsequent call fails with "function is not unique" because both signatures
-- match. This bit us in 007. The drop must name the old argument list exactly.
drop function if exists public.tb_search_deals(
  text, text, text, text, text, text, numeric, numeric, int, text, boolean, int, int
);

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
  p_offset     int     default 0,
  p_deal_slug  text    default null,
  p_holiday_type text  default null
)
returns jsonb
language sql
stable
security invoker
set search_path = public, extensions
as $$
with target as (
  -- The property group the requested deal belongs to. Null when no slug was
  -- asked for, which leaves every filter below untouched.
  select property_key from deals where p_deal_slug is not null and slug = p_deal_slug limit 1
),
filtered as (
  select
    d.*,
    a.name  as agent_name,
    a.slug  as agent_slug,
    a.town  as agent_town,
    coalesce(nullif(d.atol_number, ''), a.atol_number)           as effective_atol,
    coalesce(nullif(d.protection_type, ''), a.protection_type)   as effective_protection,
    coalesce(nullif(d.clickout_url, ''), a.default_clickout_url) as effective_clickout,
    coalesce(nullif(d.booking_phone, ''), a.phone)               as effective_phone,
    coalesce(d.billing_mode, a.billing_mode)                     as effective_billing_mode,
    tb_agent_contact(a.id)                                       as agent_contact
  from deals d
  join agents a on a.id = d.agent_id
  where d.status = 'live'
    and a.status = 'active'
    and (d.travel_until is null or d.travel_until >= current_date)
    and (p_deal_slug  is null or d.property_key = (select property_key from target))
    and (p_agent_slug is null or a.slug = lower(p_agent_slug))
    and (p_country    is null or lower(d.country) = lower(p_country))
    and (p_board      is null or d.board_basis = p_board)
    and (p_holiday_type is null or d.holiday_type = p_holiday_type)
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
      -- Each rival has its own page, so the compare list can link to it.
      'slug',        f.slug,
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

-- ── 5. what destinations exist right now ────────────────────────────────────
-- Countries and resorts that currently carry live deals, with the numbers a
-- landing page and a sitemap both need. Resorts hang off their country, because
-- "Benidorm" on its own is not a URL we can defend: two countries can share a
-- resort name and only the pair is unique.
create or replace function public.tb_destinations(p_min_deals int default 1)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
with live as (
  select d.country, d.resort, d.price_from, d.discount_pct, d.hero_image_url,
         greatest(d.updated_at, d.published_at) as touched
  from deals d
  join agents a on a.id = d.agent_id
  where d.status = 'live'
    and a.status = 'active'
    and (d.travel_until is null or d.travel_until >= current_date)
    and coalesce(btrim(d.country), '') <> ''
),
countries as (
  select
    country                                    as name,
    tb_slugify(country)                        as slug,
    count(*)::int                              as deal_count,
    min(price_from)                            as min_price,
    max(discount_pct)                          as max_discount,
    max(touched)                               as last_change,
    (array_remove(array_agg(hero_image_url order by discount_pct desc nulls last),
                  null))[1]                    as image
  from live
  group by country
  having count(*) >= greatest(coalesce(p_min_deals, 1), 1)
),
resorts as (
  select
    resort                                     as name,
    tb_slugify(resort)                         as slug,
    country                                    as country_name,
    tb_slugify(country)                        as country_slug,
    count(*)::int                              as deal_count,
    min(price_from)                            as min_price,
    max(discount_pct)                          as max_discount,
    max(touched)                               as last_change,
    (array_remove(array_agg(hero_image_url order by discount_pct desc nulls last),
                  null))[1]                    as image
  from live
  where coalesce(btrim(resort), '') <> ''
  group by country, resort
  having count(*) >= greatest(coalesce(p_min_deals, 1), 1)
)
select jsonb_build_object(
  'countries', coalesce((select jsonb_agg(to_jsonb(c) order by c.deal_count desc, c.name)
                         from countries c), '[]'::jsonb),
  'resorts',   coalesce((select jsonb_agg(to_jsonb(r) order by r.deal_count desc, r.name)
                         from resorts r), '[]'::jsonb)
);
$$;

revoke all on function public.tb_destinations from anon, authenticated;

-- ── 6. one destination page, one round trip ─────────────────────────────────
-- Resolves the slug back to the name the agents actually typed, then delegates
-- to tb_search_deals so the landing page and the search page can never disagree
-- about what is on offer or how it is ordered.
--
-- Returns a null 'country' when the slug matches nothing live, which is how the
-- renderer knows to answer 404 rather than serve an empty page a crawler would
-- go on to index.
create or replace function public.tb_destination(
  p_country_slug text,
  p_resort_slug  text default null,
  p_limit        int  default 24,
  p_offset       int  default 0,
  p_sort         text default 'recommended'
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_country text;
  v_resort  text;
  v_stats   record;
begin
  select d.country into v_country
    from deals d join agents a on a.id = d.agent_id
   where d.status = 'live' and a.status = 'active'
     and (d.travel_until is null or d.travel_until >= current_date)
     and tb_slugify(d.country) = p_country_slug
   limit 1;

  if v_country is null then
    return jsonb_build_object('country', null);
  end if;

  if coalesce(p_resort_slug, '') <> '' then
    select d.resort into v_resort
      from deals d join agents a on a.id = d.agent_id
     where d.status = 'live' and a.status = 'active'
       and (d.travel_until is null or d.travel_until >= current_date)
       and lower(d.country) = lower(v_country)
       and tb_slugify(d.resort) = p_resort_slug
     limit 1;

    if v_resort is null then
      return jsonb_build_object('country', null);
    end if;
  end if;

  select count(*)::int          as deal_count,
         min(d.price_from)      as min_price,
         max(d.discount_pct)    as max_discount,
         count(distinct d.agent_id)::int as agent_count,
         max(greatest(d.updated_at, d.published_at)) as last_change
    into v_stats
    from deals d join agents a on a.id = d.agent_id
   where d.status = 'live' and a.status = 'active'
     and (d.travel_until is null or d.travel_until >= current_date)
     and lower(d.country) = lower(v_country)
     and (v_resort is null or lower(d.resort) = lower(v_resort));

  return jsonb_build_object(
    'country',      v_country,
    'countrySlug',  tb_slugify(v_country),
    'resort',       v_resort,
    'resortSlug',   case when v_resort is null then null else tb_slugify(v_resort) end,
    'dealCount',    v_stats.deal_count,
    'minPrice',     v_stats.min_price,
    'maxDiscount',  v_stats.max_discount,
    'agentCount',   v_stats.agent_count,
    'lastChange',   v_stats.last_change,
    -- The resorts inside this country, for the internal links a country page
    -- owes its children. Empty on a resort page: there is nothing below it.
    'children', case when v_resort is not null then '[]'::jsonb else coalesce((
      select jsonb_agg(child order by child->>'name')
        from (
          select jsonb_build_object(
                   'name',      d.resort,
                   'slug',      tb_slugify(d.resort),
                   'dealCount', count(*)::int,
                   'minPrice',  min(d.price_from)
                 ) as child
            from deals d join agents a on a.id = d.agent_id
           where d.status = 'live' and a.status = 'active'
             and (d.travel_until is null or d.travel_until >= current_date)
             and lower(d.country) = lower(v_country)
             and coalesce(btrim(d.resort), '') <> ''
           group by d.resort
        ) kids
    ), '[]'::jsonb) end,
    'results', tb_search_deals(
      p_country := v_country,
      p_resort  := v_resort,
      p_sort    := p_sort,
      p_compare := true,
      p_limit   := p_limit,
      p_offset  := p_offset
    )
  );
end;
$$;

revoke all on function public.tb_destination from anon, authenticated;

-- ── 7. everything a sitemap needs, in one call ──────────────────────────────
-- lastmod matters more than it looks: a sitemap that claims every page changed
-- today, every day, gets its lastmod ignored, and then a genuinely repriced deal
-- waits its turn behind pages that did not move. So each URL carries the real
-- timestamp of the thing it describes.
create or replace function public.tb_sitemap()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
with live as (
  select d.slug, d.country, d.resort,
         greatest(d.updated_at, d.published_at) as touched
  from deals d
  join agents a on a.id = d.agent_id
  where d.status = 'live'
    and a.status = 'active'
    and d.slug is not null
    and (d.travel_until is null or d.travel_until >= current_date)
)
select jsonb_build_object(
  'deals', coalesce((
    select jsonb_agg(jsonb_build_object('slug', slug, 'lastmod', touched) order by touched desc)
    from live), '[]'::jsonb),
  'destinations', tb_destinations(1),
  'generated', now()
);
$$;

revoke all on function public.tb_sitemap from anon, authenticated;

commit;

-- ── verify it actually landed ───────────────────────────────────────────────
-- Run these after applying. `create or replace` is silent about a function you
-- never got round to running, and a migration applied in chunks can lose a
-- section in the gap. Section 4 of migration 009 went missing exactly that way.
--
--   select public.tb_slugify('Costa del Sol, Málaga');       -- costa-del-sol-malaga
--   select count(*) from public.deals where slug is not null and status = 'live';
--   select public.tb_destinations() -> 'countries';
--   select public.tb_destination('spain') -> 'dealCount';
--   select jsonb_array_length(public.tb_sitemap() -> 'deals');
--   select pg_get_function_identity_arguments(oid) from pg_proc
--    where proname = 'tb_search_deals';   -- must list p_deal_slug and p_holiday_type
