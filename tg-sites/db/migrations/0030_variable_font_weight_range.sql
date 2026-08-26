-- ---------------------------------------------------------------------------
-- 0030  One row per font FILE, not per weight
-- ---------------------------------------------------------------------------
--
-- WHAT WAS WRONG. A modern Google family is usually a VARIABLE font: one file
-- that covers a continuous range of weights. Google's stylesheet reflects that
-- by pointing four @font-face rules, one per weight, at the SAME url. The
-- importer read those four faces and stored four rows, each with its own id and
-- therefore its own /fonts/<tenant>/<id>.woff2 url, so the one thing that made
-- Google's shape efficient, the shared url a browser downloads once, was
-- exactly what we threw away.
--
-- MEASURED ON COASTWISE, 26 Aug 2026, before this ran:
--
--   8 font_files rows for Archivo, holding 2 distinct files
--   md5 cd56e2ec... appears at weights 400, 500, 600 and 700 (latin)
--   md5 c5e41aa1... appears at weights 400, 500, 600 and 700 (latin-ext)
--   the published page preloaded 102,384 bytes across 3 requests
--   for 34,928 bytes of actual font
--
-- Confirmed against Google rather than assumed: fetching Archivo at four
-- weights returns 3 urls, each repeated 4 times, and the latin file's md5 is
-- byte-for-byte the cd56e2ec... already in this table.
--
-- THE SECOND THING, AND IT IS LATENT RATHER THAN LIVE. Read the paragraph
-- before believing the stronger version of it.
--
-- A face pinned to a single weight tells the browser that file IS that weight,
-- so a style asking for a weight in between snaps to the nearest pinned face
-- instead of interpolating. Measured in Chromium: with four pinned faces, 650
-- and 700 render at exactly the same width, 396.11px; with the range declared,
-- the same file renders 650 at 389.09px, between 400 and 700 where it belongs.
--
-- That is a real property of the CSS and it is NOT visible on any site today,
-- which I got wrong on the first pass and am recording so nobody re-derives it.
-- parseTheme admits only 400, 500, 600 and 700 and rewrites anything else to
-- the style's default, so no in-between weight can reach the page. Coastwise's
-- stored h2 weight of 650 is already 700 by the time it is rendered, and that
-- is the theme parser doing it, not font matching.
--
-- So the win this migration actually banks is the bytes. The interpolation
-- becomes a real one the day the type panel offers a weight off the four steps,
-- which a variable font is precisely what makes possible.
--
-- WHAT THIS DOES. weight becomes the BOTTOM of the range a file covers and
-- weight_max the top, null meaning a single weight as before. Then the
-- duplicates already stored are collapsed: one row survives per identical file,
-- carrying the range, and the rest go.
--
-- WHY COLLAPSING IS SAFE. The surviving row keeps its own id, so its url is
-- unchanged and still cached. The deleted ids are only ever reached from HTML
-- we render fresh on every request, and that HTML will no longer mention them.
--
-- NO GRANTS HERE. font_files was granted at TABLE level in 0010 to both
-- tg_sites_app and tg_sites_renderer, so a column added later is covered.
-- Checked rather than assumed, for the same reason 0029 says so.
-- ---------------------------------------------------------------------------

alter table public.font_files
  add column if not exists weight_max int;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'font_files_weight_range'
  ) then
    alter table public.font_files
      add constraint font_files_weight_range
      check (weight_max is null or (weight_max between weight and 900));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Collapse what is already stored.
-- ---------------------------------------------------------------------------
--
-- Done as ONE statement with a data-modifying CTE rather than a temp table and
-- two passes. The update and the delete then see the same snapshot and touch
-- disjoint rows, the survivor and the copies, so there is no order in which
-- this half-applies.
--
-- Grouped on the BYTES, through md5, rather than on anything the importer
-- recorded. Two rows are the same file if and only if they hold the same file,
-- and that is the only signal that stays true for rows written by an older
-- build, by an upload, or by a re-import.

with groups as (
  select
    font_id,
    coalesce(subset, '')                as sub,
    style,
    md5(bytes)                          as digest,
    min(weight)                         as weight_min,
    max(weight)                         as weight_top,
    count(*)                            as copies,
    (array_agg(id order by weight))[1]  as keep
  from public.font_files
  group by font_id, coalesce(subset, ''), style, md5(bytes)
),
-- The survivor learns the range it actually covers. It keeps its own id, so its
-- url is unchanged and any cached copy stays valid.
widened as (
  update public.font_files f
  set weight     = g.weight_min,
      weight_max = g.weight_top
  from groups g
  where f.id = g.keep
    and g.copies > 1
  returning f.id
)
-- And the copies go. Only ever reached from HTML we render fresh on every
-- request, and that HTML will no longer mention them.
delete from public.font_files f
using groups g
where f.font_id = g.font_id
  and coalesce(f.subset, '') = g.sub
  and f.style   = g.style
  and md5(f.bytes) = g.digest
  and g.copies > 1
  and f.id <> g.keep;
