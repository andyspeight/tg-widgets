# The Duda element audit (tg-sites)

**Live doc. Read this first if the session mentions Duda, "the next list", or
elements. Update it at the end of a session that moves it on.**

Started 20 Aug 2026. Andy is going through Duda's element list category by
category and sending screenshots. For each one the job is, in this order:

1. **Say what we already have.** Most of the list is built. Reporting an
   existing element as a gap and rebuilding it is the main way to waste a day.
2. **Build only what genuinely is not there.**
3. **Push to live between batches** (merge the branch to `main`, Vercel deploys).

Andy sends the lists faster than they can be built, and repeats are expected
because Duda lists the same element in several places. He has offered
screenshots for anything unclear — ask rather than guess. Guessing at
"Double Row Carousel" would have built the wrong thing twice.

---

## Where the audit has got to

| Category | Status |
|---|---|
| BASIC | Done |
| Carousel / Read more / Shape divider | Done |
| Copyright / Tabs / Text & Image | Done |
| VISUALS & AUDIO | Done |
| BUSINESS | Done |
| SOCIAL | Done — except Facebook Feed, see below |
| BLOG | Done |
| Travelgenix customs (built for Duda) | Done — except Stacked Collection, ignored |

**More Travelgenix elements are coming on 21 Aug 2026.** That is the next job.

---

## Built during the audit, all live

Advanced Grid · File element (+ documents in the media library) · Breadcrumbs as
a placeable element · Read more · Copyright · Icon · Shape · Coupon · Multi
Location · Google Calendar embeds · WhatsApp click to chat · always-on hamburger
· Half overlay · Slider two-row / bold scroll bar / mosaic · Expanding cards ·
Screen carousel.

Two fixes found while auditing rather than asked for:

- **`tel:` and `mailto:` links were saved and thrown away at render.** Seven of
  eight renderers dropped them. The cause was the option's name (`allowMailto`
  also gated `tel:`), so it was renamed `allowContact` and a test now sweeps
  every `href` call so the ninth renderer is covered on the day it appears.
- **Site search read pages only**, so a visitor searching a travel site for
  "Crete" was never shown the blog post about Crete. Posts are now in the same
  corpus, with the same live rule.

## Skipped, on Andy's word

HTML Attribute Select · Lottie · Booking · OpenTable · PayPal · Restaurant Menu
· Yelp Reviews · Twin Showcase · Stacked Collection.

## Waiting on Andy

- **Facebook Feed.** Possible as a one-line allowlist addition, no script. Not
  built because a Facebook iframe sets cookies and tracks visitors on a
  client's page, and that is his call to make, not ours.
- **Re-cutting the element categories.** Andy noted Duda categorises its
  elements and "we should do the same". The offer on the table is one pass over
  our five groups (Text, Media, Actions, Layout, Advanced) once the full list is
  known. It is now nearly known.

---

## What this audit taught, that the conventions did not already say

### "A published page ships no JavaScript" has THREE exceptions, not one

`CLAUDE.md` names the light/dark toggle. There are two more, both deliberate and
both progressive enhancement:

- **`/slideshow.js`** — every slideshow auto-plays and pauses on hover in pure
  CSS on its own. The script only adds clickable arrows, dots and a **pause
  button**, and that last one is not a nicety: auto-moving content needs a way
  to stop it (WCAG 2.2.2) and hover-to-pause is not reachable from a keyboard.
- **Widget scripts** — third-party embeds a client pasted in.

The rule that actually holds is: *the page works with no script, and a script
may only add to it*. Every interactive element built in this audit meets it.

### New moving elements should borrow the slideshow, not grow their own

`public/slideshow.js` queries `.tgs-slideshow` and `.tgs-slideshow__slide` and
asks nothing about what is inside them. Emit that wrapper with the same data
attributes and a new block gets arrows, dots and pause **with no change to that
file**. Half overlay and Screen carousel both do this. If you add a third, add
it to `hasSlideshow` in `lib/content/slideshow.ts` too, or the page never asks
for the script and the element silently loses its pause button.

### Click-to-choose-one is a radio group

Tabs and Expanding cards are both built from radios. "One of a set, and never
none" is not something to implement — it is what a radio group already is, and
it brings arrow-key movement, an announced state and back-button memory for
free. Two rules that are easy to miss:

- The **group name must carry the block id**, or two of the same element on one
  page become one group.
- **`defaultChecked`, never `checked`.** A controlled value makes the editor
  canvas snap back to the first item on every keystroke.

### Verify layout in a browser, not in your head

Three real bugs this audit produced looked correct in the CSS and were only
found by opening the page:

- A panel anchored to `.tgs-section` came out 48px high, because the nearest
  positioned ancestor is actually `.tgs-section__inner`.
- A panel measured perfectly and was invisible from halfway down, because the
  header is a stacking context at `z-index: 2` and the page below is a sibling
  at the same value, later in the document.
- `position: fixed` cannot reach the viewport from inside a region, because
  `.tgs-page` carries `container-type` and that brings layout containment.

### A flaky test, finally explained

One test failed every few full runs, always a different one. Cause: the suite
loads modules with `await import()` **inside** a test, so the first test in a
file pays for transforming that module's whole graph — about 5.6 seconds cold
for `lib/db/pages.ts`, against a 5000ms default. `testTimeout` is now 30s in
`vitest.config.ts` with the reasoning written down. If a single test starts
failing at random again, this is not the cause any more; look elsewhere.
