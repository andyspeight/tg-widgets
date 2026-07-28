-- ============================================================================
-- Tripbuster 017 — trip types as browsable pages
-- ============================================================================
-- The schema has allowed seven product types since 001 and the site only ever
-- spoke about one of them. Every public URL says "holidays", the front page
-- says holidays, and the only way to see a cruise was to know the search filter
-- existed. Somebody googling "cruises from Southampton" had nothing to land on.
--
-- This adds the counts a hub page and a sitemap need. It deliberately adds NO
-- new read path for the deals themselves: a type page is tb_search_deals with
-- p_holiday_type set, exactly like a destination page is tb_search_deals with a
-- country set. One read path, as decided in 001.
--
-- The type STRINGS are the authority and live in the CHECK constraint on
-- deals.holiday_type. Their URL slugs live in public/tripbuster/tb-site.js,
-- because slugs are a presentation decision and putting them here would mean a
-- migration every time a word changed.
-- ============================================================================

begin;

-- ── what is actually on sale, by type ───────────────────────────────────────
-- Only types with something live. A type with nothing on is an empty page for a
-- crawler to find, and we would rather have six good pages than seven with one
-- that says "no deals".
--
-- min_price is what a landing page leads with ("cruises from £649"), so it has
-- to obey the same travel_until rule the search does, or the page advertises a
-- price no search can reproduce.
create or replace function public.tb_trip_types()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(jsonb_agg(t order by t.deals desc, t.holiday_type), '[]'::jsonb)
  from (
    select d.holiday_type,
           count(*)::int                                as deals,
           min(d.price_from)                            as min_price,
           max(d.discount_pct)                          as max_discount,
           count(distinct d.country)::int               as countries,
           count(distinct d.agent_id)::int              as agents,
           max(greatest(d.updated_at, d.published_at))  as last_change
      from deals d
      join agents a on a.id = d.agent_id
     where d.status = 'live'
       and a.status = 'active'
       and (d.travel_until is null or d.travel_until >= current_date)
     group by d.holiday_type
  ) t;
$$;

revoke all on function public.tb_trip_types from anon, authenticated;

-- ── the sitemap gains them ──────────────────────────────────────────────────
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
  'tripTypes', tb_trip_types(),
  'generated', now()
);
$$;

revoke all on function public.tb_sitemap from anon, authenticated;

commit;

-- ── verify it actually landed ───────────────────────────────────────────────
--   select jsonb_pretty(tb_trip_types());
--   -- every type with something live, biggest first:
--   select t->>'holiday_type', t->>'deals', t->>'min_price'
--     from jsonb_array_elements(tb_trip_types()) t;
--   -- and the sitemap must now carry them:
--   select jsonb_array_length(tb_sitemap()->'tripTypes');
