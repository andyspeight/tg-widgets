-- ============================================================================
-- Tripbuster 003 — tb_search_deals, the single consumer read path
-- ============================================================================
-- Serves every consumer surface from one place:
--   • the embeddable widget's per-agent feed   (p_agent_slug)
--   • the consumer site's search results       (filters + p_compare)
--   • the deal page's multi-agent compare      (p_compare => true)
--
-- Why a function instead of PostgREST filters assembled in JavaScript: every
-- argument is a bound, typed parameter, so hostile query-string input cannot
-- alter the query shape. Sort is a fixed whitelist expressed as CASE in ORDER BY
-- rather than dynamic SQL. Limit and offset are clamped here as well as in the
-- API layer — defence in depth.
--
-- search_path is PINNED rather than empty so the pg_trgm operators (now in the
-- extensions schema) still resolve. A pinned search_path satisfies the linter;
-- the risk it guards against is a mutable one.
-- ============================================================================

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
    coalesce(nullif(d.clickout_url, ''), a.default_clickout_url) as effective_clickout
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
      'clickoutUrl', f.effective_clickout
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

-- Only the service role (the Vercel API) may call it.
revoke all on function public.tb_search_deals from anon, authenticated;
