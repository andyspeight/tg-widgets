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

## The font fix is done

**Merged and verified live on 25 Aug 2026.** Main is at `9a7275b`, the
production deployment is READY in `lhr1`, and every published client site now
loads the typeface its design committed to. Nothing here is outstanding; start
at the open queue below.

How it was proved, in case the method is useful again. The decisive evidence
came BEFORE the deploy: the same file id was fetched from the running
production site under both URL shapes, so the only variable was the tenant
segment.

| URL | Result |
|---|---|
| `/fonts/coastwise.travelgenixsites.com/<id>.woff2` (what the page asked for) | 404 |
| `/fonts/coastwise/<id>.woff2` (what the fix asks for) | 200, `font/woff2`, 34,928 bytes |

That is causation rather than inference, and it means a fix like this can be
confirmed without spending a deploy on the question.

After the deploy, the served homepage and the search results page both carry
eight slug-shaped font URLs and zero hostname-shaped ones, three `rel=preload`
links among them, sixteen `@font-face` blocks across weights 400 to 700, and
`--tgs-font-display` resolving to Archivo. Three of the eight URLs were fetched
and returned real WOFF2 bytes.

Sandbox egress is blocked, so all of that went through
`mcp__Vercel__web_fetch_vercel_url`. The responses are large; parse them as JSON
and grep rather than reading them whole.

### Two things worth keeping from this

**The renderer role could have failed here and only in production.** The fix
reads the slug through `getPublicTenantSlug`, which uses the read-only renderer
role. That works because `public.tenants` carries a TABLE-level grant to
`tg_sites_renderer`, so the `slug` column is covered without a column grant, and
because both `resolve_tenant` and the `tenants_renderer` policy require
`status = 'active'` — so if a page rendered at all, the slug read cannot come
back empty. Check both halves before adding another renderer-role read.

**The `?? slug` fallback in the published route is unreachable, not
load-bearing.** If it ever does fire it silently restores the 404, so do not
treat it as a safety net.

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
| A page of native blocks | 4564 ms | **2128 ms** |
| An imported design | 8040 ms | **1892 ms** |

Both roughly halved. The remaining cost is different in each case: the designed
page is still carrying 820 KB of images, the native page is fast enough that
CSS is now the visible floor.

**Measured for real on 25 Aug 2026** (PageSpeed Insights, lab, no field data
because the site has no traffic yet): Performance **98 mobile / 99 desktop**,
Accessibility, Best Practices and SEO **100** on both. LCP 2.4 s mobile and
0.7 s desktop, CLS **0** on both, TBT 10 ms. Desktop FCP of 0.3 s is worth
noting on its own: FCP includes server time, so TTFB is already small, which
means edge caching buys less than the queue assumed.

Two caveats before quoting any of it:

- These are harness pages, not the live site. They render through the real
  `PageRenderer` with real CSS, so the shape is honest, but they do not include
  network TTFB from Vercel or the database.
- CLS is 0 across every profile and always has been. That is a real result, not
  a measurement gap.

### What is still fat

Not the CSS, whatever `cssUnusedPct` says. See the entry under "Things that
will bite you" before ranking that work again.

The honest remaining fat is image BYTES. On a designed page the two pictures
still on the critical path are 400 KB between them, and at 390px on a DPR-3
phone both legitimately want the 1600px candidate, so `sizes` will not save
them. Format would.

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

Re-ordered on 25 Aug 2026 after re-measuring. The order the queue had before
rested on a number that does not mean what it looks like.

1. **Andy decides: is published HTML cached at the edge.** The thing that kept
   this parked was a worry about colliding with server-side personalisation.
   There is none: no cookies, no geography, no user agent, no A/B or audience
   feature anywhere in tg-sites. A published page is a pure function of
   hostname, path, query and database state. The route currently says
   `dynamic = 'force-dynamic'` and the response says
   `private, no-cache, no-store`, which is the strongest refusal there is.
   Recommended: `revalidate = 60`. One line, reversible in one line, no
   invalidation matrix. The cost is that Publish means "live within a minute".
   **Switch Web Analytics on first** — it is off, so there is no real-user TTFB
   and every number in this doc is a harness floor.

2. **The CSS work, whose shape item 1 decides.** Cached pages mean inlining
   each page's own CSS, which removes a render-blocking round trip and is worth
   more than halving the file. Dynamic pages mean an external core stylesheet
   plus per-block files. Different builds; do not start before 1 is settled.

3. **Let a block's Text size take a typed pixel value.** It stops at 2.5rem
   while the toolbar takes 6 to 200px, which is what pushed a 100px hero onto
   the words and silently disabled auto-resize. `normaliseTextSize` already
   accepts a typed px on a block, so this is UI only.

4. **Submit travelgenixsites.com to the Public Suffix List.** Free, and it
   matters more now the client subdomains are live: without it a script on one
   client's subdomain can set a cookie another client's subdomain receives.

5. **Backfill Demo Travel.** 9 images, dimensions also wrong. Coastwise is done.

6. **Per-column `sizes`.** Worth less than it looks: at 390px on a DPR-3 phone
   almost everything wants the 1600 candidate anyway.

7. **Site-wide widgets panel, cookie consent first.** Compliance exposure.

8. **Collections fed from an external source.**

Also parked: option A on canvas fidelity, a counter-scaled canvas. Read the note
in `components/editor/Canvas.tsx` around line 1041 before touching it.

## Things that will bite you

Hard-won, none of it obvious from the code.

**A RULE THAT READS A TOKEN THE THEME HAS NOT GOT DRAWS NOTHING, NOT THE
FALLBACK.** This is a hole in the whole stylesheet, found on 25 Aug 2026 in the
destination panel. A `var()` that cannot be substituted invalidates its
declaration AT COMPUTED-VALUE TIME, and the property then takes its INITIAL
value rather than falling back to the earlier declaration in the cascade, which
is what everybody expects. So
`background: color-mix(in srgb, var(--tgs-accent) 42%, var(--tgs-bg))` did not
come out grey from the rule above it. It came out TRANSPARENT, and two months of
a climate chart were simply absent with every unit test green.

The trap is that a CLIENT THEME IS SPARSER THAN THE DEFAULTS. Coastwise does not
define `--tgs-bg` at all. Before using a token in a rule, check a real tenant's
token set carries it, not just `:root` in globals.css.

**AND A TRIPWIRE NOBODY HAS WATCHED FAIL IS NOT ONE.**
`tools/verify-destination.mjs` took three goes. The first rendered with no theme
and passed the broken build. The second read the ground off `<body>` rather than
off what is actually behind the element, and passed it too. Only the third, which
carries a real tenant's sparse tokens, failed. Reintroduce the bug and watch the
check go red before believing it.

**ANYTHING A PUBLISHED PAGE LOADS BY NAME FROM OUR ORIGIN HAS TO BE LISTED IN
THE MIDDLEWARE.** This bit twice in one day. Everything on a client's hostname
is rewritten into the site renderer, and `isPlatformPath` names the exceptions.
The fonts were the first case (they asked by hostname instead of slug); the four
scripts in `public/` were the second, and they were simply missing from the list,
so `/tg-motion.js` on a client domain returned a 404 HTML document with a
JavaScript content type. Both were silent: nothing errored where anyone would
see it, the feature just did not happen. The list lives in `middleware.ts` as
`SITE_ASSETS` and is repeated in the matcher literal, because Next reads that at
build time and cannot call a function. `tests/site-assets.test.ts` checks the
directory, the function and the matcher against each other.

**CLS IS ZERO BECAUSE OF THE FONT PRELOADS, not by luck.** PageSpeed measured 0
on mobile and desktop on 25 Aug. `font-display: swap` with no metric overrides
would shift the layout if the font arrived after first paint; the three
`rel=preload` links in FontHead are what stop it arriving late. Forced to swap
in a probe (font held back 600 ms) the same page scored 0.047. If anyone ever
trims those preloads as dead weight, this comes back.

**LIGHTHOUSE'S "LEGACY JAVASCRIPT" IS NOT ACTIONABLE HERE.** Next emits the
polyfills chunk with `noModule`, so no browser supporting ES modules downloads
it and the 12 KiB it counts costs real users nothing. A browserslist does not
remove it either: measured both ways on identical code, adding
`supports es6-module, not dead` made the client bundle 23,336 bytes BIGGER,
because it is a wider target set than Next's own default.

**THE BIG "EFFICIENT CACHE LIFETIMES" NUMBER IS THE DEMO, NOT THE PRODUCT.**
PageSpeed reports about 1,789 KB of desktop savings, nearly all of it pictures.
Those are hardcoded Supabase urls in `tools/coastwise-seed`, put there by hand.
Real client media goes to Vercel Blob through `/api/media/upload`, which now asks
for a year. Fixing the demo's number means the bucket's own settings.

**`cssUnusedPct` does not mean what it looks like, and it mis-ranked the whole
queue.** It read 93 to 97 per cent and put "split the CSS" at the top. It is
Chrome coverage: a rule counts as used only if it matched an element during
that page load, so it excludes hover and focus states, container-query branches
for other widths, dark mode, and variants of blocks that ARE on the page. All of
those are needed. Measured properly with postcss and attribution by class root,
69.7 per cent of the code is block-attributable and a realistic page needs 53
per cent of it: about 8 KB brotli off a 17.9 KB stylesheet, not 96 per cent.

**And `globals.css` resists splitting anyway.** It alternates between shared and
block rules 49 times, with 102 KB of block rules sitting BEFORE the last shared
one. Lifting blocks into their own files reorders 792 rules against shared ones,
and any equal-specificity tie flips silently. A safe split needs a
conflict-detection pass, not just an attribution pass.

**The hero must be eager, and that is not the same as "the others are lazy".**
Making every picture lazy, hero included, measured 2916 ms. Hero eager with
`fetchpriority="high"` and the rest lazy measured 1892 ms. The all-lazy version
still saves the bytes below the fold, so it reads like a win while delaying
discovery of the one image being waited on. `tests/image-priority.test.ts`
asserts the first image is NOT lazy for exactly this reason.

**The harness diverged from the site a fourth time.** `perf/entry.tsx` called
`prepareSections` without `heroFirst`, so it measured an arrangement we do not
ship, and a thousand milliseconds sat in the difference. It is now pinned by a
test. Whenever you add a render-time option, ask what the harness passes.

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
