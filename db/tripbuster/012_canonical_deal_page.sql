-- ============================================================================
-- Tripbuster 012 — one hotel, one page, one URL
-- ============================================================================
-- WHAT 011 GOT WRONG
--
-- 011 gave every DEAL a slug, and a deal page shows the whole compare group:
-- one hotel, every agent advertising it. Three agents on the Sol Pelicanos
-- therefore produced three URLs that all render the same page. In a sitemap of
-- 26 deals only 21 were distinct pages.
--
-- Worse, the canonical was written from whichever agent was cheapest, because
-- that is the row the read path returns first. So the canonical URL of a page
-- MOVED whenever an agent undercut another. Stable slugs, unstable canonical:
-- the second one undoes the first.
--
-- THE FIX: every deal in a group agrees on which of their slugs is the page.
-- It is the one that got there first — earliest published, then lowest id as a
-- tiebreak — which is stable because publication dates and ids never change.
-- Prices can move as much as they like and the URL does not.
--
-- The other slugs still work. They 301 to the canonical one, so there is exactly
-- one live URL per hotel rather than one that ranks and two that dilute it.
-- ============================================================================

begin;

-- ── the read path names the canonical page ──────────────────────────────────
-- canonical_slug is computed in `filtered`, with a window function, so it lands
-- on BOTH shapes the function returns: the flat rows a search uses and the
-- grouped rows a deal page uses. Working it out only in the grouped branch would
-- have left every search result linking to a URL that then redirected.
drop function if exists public.tb_search_deals(
  text, text, text, text, text, text, numeric, numeric, int, text, boolean, int, int, text, text
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
  select property_key from deals where p_deal_slug is not null and slug = p_deal_slug limit 1
),
matched as (
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
filtered as (
  -- NOT partitioned over the filtered set. The canonical page of a hotel cannot
  -- depend on which filters the visitor happened to apply, or a search for
  -- "all inclusive" would link somewhere different from a search for "Benidorm".
  select m.*, (
    select d2.slug
      from deals d2
      join agents a2 on a2.id = d2.agent_id
     where d2.property_key = m.property_key
       and d2.status = 'live' and a2.status = 'active'
       and d2.slug is not null
     order by d2.published_at nulls last, d2.id
     limit 1
  ) as canonical_slug
  from matched m
),
grouped as (
  select
    f.property_key,
    count(*)::int                                           as agent_count,
    (array_agg(to_jsonb(f) order by f.price_from, f.id))[1]  as best,
    jsonb_agg(jsonb_build_object(
      'dealId',      f.id,
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

create index if not exists deals_property_live_idx
  on public.deals (property_key, published_at, id) where status = 'live';

-- ── the sitemap lists pages, not deals ──────────────────────────────────────
-- A sitemap that lists three URLs which all canonicalise to a fourth is asking
-- Google to crawl three pages in order to be told to ignore them. One row per
-- hotel, carrying the most recent change any of its agents made.
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
  'generated', now()
);
$$;

revoke all on function public.tb_sitemap from anon, authenticated;

commit;

-- ── verify it actually landed ───────────────────────────────────────────────
--   select jsonb_array_length(public.tb_sitemap() -> 'deals');   -- pages, not deals
--   select (public.tb_search_deals(p_compare := true) -> 'deals' -> 0 ->> 'canonical_slug');
--   -- every member of a group must name the same page:
--   select count(distinct row->>'canonical_slug')
--     from jsonb_array_elements(public.tb_search_deals(
--            p_deal_slug := '<any member slug>', p_compare := false, p_limit := 60
--          ) -> 'deals') as row;                                 -- must be 1
