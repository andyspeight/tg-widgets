# tg-sites handover

**Written 25 Aug 2026, at the end of the performance and fidelity session.**
Living doc. Read it at the start of any tg-sites session, update it at the end.

Companions, all still current:

- `docs/tg-sites-speed-and-visibility.md` (23 Aug) is the ANALYSIS: what was
  slow, what was invisible, measured from the repository. This doc is the
  STATE: what got built, what is still open.
- `docs/duda-gap-analysis.md` (23 Aug) is the platform-level comparison. The
  element axis closed on 21 Aug (`docs/duda-element-audit.md`), so a new "how
  do we compare" question belongs in the gap analysis, not a fresh sweep.
- `docs/motion-engine.md` (25 Aug) is what is BUILT and switchable.
  `references/motion-recipes.md` in travelgenix-taste is the design catalogue.

Airtable project record: base `appj9tksreHOwkhYg`, table `tblpyhPNhiQg3XkkT`.

---

## Do this first

**The font fix is committed and pushed to
`claude/travelgenix-sites-handover-py1mx0` but it is NOT on main, so it is not
live.** It is the only unmerged commit on the branch (`1054904`). Everything
else in this doc already shipped.

Merge it to main, let Vercel deploy, then verify like this:

```
# The URL in the <head> must now be /fonts/coastwise/... and return 200.
# Sandbox egress is blocked, so fetch through the Vercel MCP tool:
#   mcp__Vercel__web_fetch_vercel_url on https://coastwise.travelgenixsites.com/
# then fetch the font URL you find in the markup.
```

Success signal: the font URL returns 200 rather than 404, and the Coastwise
homepage headline wraps onto two lines the way the editor shows it.

### Why this matters more than it looks

Every published client site has been loading its fonts from a 404 for as long
as the font route has existed. Nothing errored. No page broke. No test failed.
The sites have simply been rendering in a system fallback instead of the
typeface their design committed to.

`/fonts/<tenant>/<file>` takes a bare slug and builds the hostname itself,
refusing anything with a dot in it on purpose so a slug cannot be dressed up as
another domain. The published route was handing it `decodeURIComponent(host)`,
so the URL was `/fonts/coastwise.travelgenixsites.com/...`. Confirmed 404
against the live site on 25 Aug.

It surfaced only because Andy noticed a Coastwise headline sitting on one line
live and two lines in the editor, and asked why the two did not match. The
editor was right the whole time. It passes `site.slug`.

The variable in the published route is called `slug` and holds a hostname.
That is most of why it read as correct for so long.

`tests/font-url.test.ts` now pins the contract from both ends.

**Do not "fix" this by deriving the slug from the hostname.** That works for
preview subdomains and nothing else. A client on their own domain has a
hostname with no slug anywhere in it.

---

## Numbers you can quote

Measured with `node tools/verify-perf.mjs`: Playwright, slow 4G, CPU throttled
4x, 390px viewport. Current state is recorded in `perf/baseline.json`.

| Profile | LCP before | LCP now |
|---|---|---|
| A page of native blocks | 4564 ms | **2132 ms** |
| An imported design | 8040 ms | **4360 ms** |

Both roughly halved. The remaining cost is different in each case: the designed
page is still carrying 820 KB of images, the native page is fast enough that
CSS is now the visible floor.

Two caveats before quoting any of it:

- These are harness pages, not the live site. They render through the real
  `PageRenderer` with real CSS, so the shape is honest, but they do not include
  network TTFB from Vercel or the database.
- CLS is 0 across every profile and always has been. That is a real result, not
  a measurement gap.

### What is still fat

`cssUnusedPct` is between 93 and 97 on every profile. A page that uses six
blocks is served the CSS for all 53. That is item 4 below and it is the single
biggest remaining win on the native profile.

---

## What shipped this session

All on main already.

**Speed**

- `load()` wrapped in React `cache()`. A page view was running the same six
  database reads twice, once in `generateMetadata` and once in the component.
- Image variants generated in the browser at upload (migration 0027, applied).
  Widths 400/800/1600, with a rung only created when it saves at least 25% of
  the pixels. Ladder rule is in `lib/media/downscale.ts`.
- `srcset` for native blocks and for imported markup, the latter through a
  post-substitution pass on the slot tokens.
- Functions run in London (`regions` in vercel.json), where the database
  already is. Confirmed live: `x-vercel-id` shows `lhr1`.
- Backfill for images already in the bank, with orphan cleanup, so deleting a
  picture removes its smaller copies too.
- `lib/media/dimensions.ts` reads real pixel size from JPEG/PNG/WebP/GIF
  headers with no decoder, because stock imports were recording the provider's
  word about a bigger original rather than the file we actually stored.

**Editor fidelity**

- An `alignY` control, so a section taller than its content can say where the
  content sits.
- The editor badge now warns about the width that decides fidelity (1100px
  contained), not the width you typed.

**Motion**

- `docs/motion-engine.md`, written because I had undersold the engine as "Ken
  Burns and parallax" when it is nine recipes with three strengths, six reveal
  styles, plus background and hover effects.
- Fixed a scroll-driven recipe (S5) doing nothing at all on a first section:
  `animation-range: entry 0% cover 35%` is already complete at load. Now gated
  on `data-motion-lead` with a `scroll()` timeline.

Test suite: **3386 passing**, 8 skipped. Was 3321 at the start of the session.

---

## The open queue, in order

1. **Decide whether published HTML is cached at the edge.** Andy's call, not a
   code decision. It is the ceiling on every number above, because TTFB sits
   inside LCP and no amount of image work touches it. It interacts with
   server-side personalisation, so decide that first.
2. **Stop sending 53 blocks of CSS to a page that uses six.** Biggest remaining
   measured win. See `cssUnusedPct` above.
3. **Image bytes, then priority hints.** `fetchpriority`, preload, lazy opt-out.
   Measurement reordered this below CSS, it used to be higher.
4. **Tell the browser how wide an image really is, per column.** Desktop
   `sizes` is still `100vw`, which is honest for full-bleed and wasteful in a
   three-column grid.
5. **Backfill Demo Travel.** 9 images, dimensions also wrong. Coastwise is
   done. The command is in `lib/media/backfill.ts`.
6. **Site-wide widgets panel, cookie consent first.** Compliance exposure, so
   it outranks the rest of the widget panel work.
7. **Collections fed from an external source.**

Also parked: option A on canvas fidelity, a counter-scaled canvas. Still on the
table if the current approach proves insufficient. Read the note in
`components/editor/Canvas.tsx` around line 1041 before touching it.

---

## Things that will bite you

Hard-won, none of it obvious from the code.

**The canvas has already eaten two attempts.** `Canvas.tsx` lines 1041 to 1063
record them with measurements: a fixed width overflowed, and shrinking gave
20px insert buttons and a 13px handle. I nearly re-implemented attempt 2 from
scratch. Read the comment first.

**Rebuild before you measure.** `tools/build-perf-page.mjs` serves the BUILT
stylesheet from `.next/app-build-manifest.json`, not the source. Edit
`globals.css` without running `npx next build` and you measure the previous
one. There is now a guard that hard-stops on this, added after it caught me.

**The harness lies in three specific ways, all now fixed, all worth knowing
about if you extend it.** It used to serve raw `globals.css` (302 KB instead of
the built 129.6 KB, overstating CSS cost four times over). It used to dedupe
images, so a four-image page measured like a one-image page. It used to key
srcset on slot tokens, so an imported design got the srcset for a different
image entirely.

**`stillBackground` silently drops background motion.** It is
`Boolean(background) && !bgShow && !video`. The Coastwise hero is a three-photo
slideshow, so Ken Burns, A6 and S5 were all silently ignored. I told Andy twice
that the hero was moving when it never was. A2 is the recipe that suits a hero
of several photographs.

**Verify a webfont actually loaded before measuring type.** I measured line
counts against a system fallback and reported them as fact. Archivo had failed
to load in the local render. This is the same root cause as the live font bug
and I hit it from the other direction without noticing.

**`vercel.json` takes no comments.** Not even `"//"` keys. The schema permits
no unknown keys at all, and the failure mode is strange: the deployment ERRORS
before building, so there are no build logs whatsoever. No build logs at all
means the config was rejected, not that the build broke.

**Check CSS tokens one at a time.** I invented `--ed-surface-2` and
`--ed-radius-sm` in one session. The real one was `--ed-r-md`. Grep for each
token individually before using it.

**Table grants vs column grants.** `public.media` has a table-level grant so a
new column is covered automatically. `public.site_regions` uses column-level
ACLs and needs an explicit grant. Getting this wrong fails at runtime under the
renderer role only, which local work will not catch.

**Run `npm run test:offers-cache-only` from the repo ROOT, not `tg-sites/`.**

---

## Standing rules for this work

From `CLAUDE.md` and from Andy directly. Repeated here because they are the
ones that actually come up in tg-sites sessions.

- Never rebuild from scratch. Always upgrade existing code.
- Diagnose before patching. Evidence before hypothesis. Hard stop after two
  failed fixes and rethink from the top.
- Refinement preserves, redesign replaces, never split the difference.
- The unit of design is the tenant. `designs/<slug>/DESIGN.md` is the committed
  home of that client's world. If it does not exist, run the init conversation
  with Andy before designing anything.
- Offers are cache-only. A visitor's browser must never trigger a Travelify
  search, and there is no "fall back to live if the cache is empty" path.
- Andy relies on this doc and the Airtable record as an external brain. Anchor
  everything with dates, restate context rather than assuming it carried over.

### Coastwise specifics

`designs/coastwise/DESIGN.md` carries two corrections worth knowing:

- The one-authored-moment-per-page rule was lifted by Andy on 25 Aug.
- The hero photograph is already full-bleed. `width` only controls the text
  column, which is currently 1200.
