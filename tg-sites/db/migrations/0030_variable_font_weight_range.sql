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
-- THE SECOND FAULT, WHICH IS A CORRECTNESS ONE. A face pinned to a single
-- weight tells the browser that file IS that weight, so a style asking for a
-- weight in between snaps to the nearest pinned face instead of interpolating.
-- Coastwise's h2 asks for 650 and renders at 700: measured in Chromium, the
-- 650 and 700 samples come out at exactly the same width, 396.11px. With the
-- range declared, the same file renders 650 at 389.09px, between 400 and 700
-- where it belongs. The client set a weight and silently got a different one.
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
