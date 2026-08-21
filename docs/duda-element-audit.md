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
| Travelgenix customs (built for Duda) | **Done.** Stacked Collection and Expand & Focus ignored on Andy's word |
| Travelgenix customs, second list (21 Aug) | Audited. Four built, two skipped, three waiting on Andy |

**Every category and every Travelgenix custom element has been checked as of 21
Aug 2026**, and everything not explicitly skipped or waiting on Andy is built
and tested. Two more lists arrived on 21 Aug after the categories were finished,
so treat "complete" as "complete up to the last list Andy sent".

---

## Built during the audit, all live

Advanced Grid · File element (+ documents in the media library) · Breadcrumbs as
a placeable element · Read more · Copyright · Icon · Shape · Coupon · Multi
Location · Google Calendar embeds · WhatsApp click to chat · always-on hamburger
· Half overlay · Slider two-row / bold scroll bar / mosaic · Expanding cards ·
Screen carousel · scrolling gallery · popup gallery (lightbox) · tilted carousel
· Flipping boxes · stop right click (a site setting) · video slides in the
slideshow · Stacked cards · Shifting images.

**Three of Duda's became settings rather than elements**, because the library
already had something that cycled or something that showed pictures: the
scrolling and popup galleries are `layout` and `lightbox` on the Gallery, the
tilted carousel is `tilt` on the Slider, and video slides are a field on the
Image slideshow. A picker holding three galleries makes a client choose before
they know what they want.

**21 Aug, second custom list:** Rating (standalone 1 to 5 stars with halves, on
its own rather than a field on a card, which Andy confirmed unprompted) ·
Tooltip · Tags, covering BOTH of Duda's delimited-tag elements as two styles of
one thing because bullets and pills differ by a border radius · Icon pulse, a
setting on the Icon we already had rather than a fourth icon element.

Already built when that list arrived, so nothing to do: **Page anchor links**
(a section already takes an anchor id, and `safeUrl` passes both `#suites` and
`/holidays#suites`) and **Custom Offer / Tour cards**, which is the widget block
plus the cards bound to a collection.

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
· Yelp Reviews · Twin Showcase · Stacked Collection · Expand & Focus · Gradient
Text (already built as a heading effect) · Advanced Divider (the shape dividers
already cover it) · Zoom Banner (Ken Burns and the S5 scrub-scale recipe already
cover it, and Andy ignored it on 21 Aug when that was put to him).

**Stop right click was argued against and asked for again**, so it is built. The
case against it is recorded in `lib/settings/schema.ts` and the settings screen
says plainly that it is a deterrent rather than protection — which matters more
than the feature, because somebody relying on it is the bad outcome.

## Waiting on Andy

- **Facebook Feed.** Possible as a one-line allowlist addition, no script. Not
  built because a Facebook iframe sets cookies and tracks visitors on a
  client's page, and that is his call to make, not ours.
- **Fancy Grid.** Not built, because "fancy" could mean masonry, bento or
  mosaic and we already have Advanced Grid, the two-row mosaic slider and the
  gallery. A screenshot decides whether it is a fourth thing or a setting on one
  of those three.
- **One truncated name** from the 21 Aug screenshot that Andy has not yet
  finished: "Custom Offer/Tour...". Read as the widget block plus cards bound to
  a collection, both of which exist, so nothing is blocked on it.

  ("Coloured Delimited..." was the other, and Andy confirmed on 21 Aug that it is
  the pair to Bullet Delimited. Both are the Tags element. The one colour field
  tints the bullet as well as the pill, so a client wanting a coloured separator
  rather than coloured chips is covered without a second element.)
- **Re-cutting the element categories.** Andy noted Duda categorises its
  elements and "we should do the same". The offer on the table is one pass over
  our five groups (Text, Media, Actions, Layout, Advanced) once the full list is
  known. It is now nearly known.

---

## What this audit taught, that the conventions did not already say

### The no-JavaScript rule changed the same day, in a parallel session

While this audit ran, the motion-layer session replaced the blanket ban with
**four clauses**, on Andy's call: a page that asks for nothing ships nothing;
the content never depends on a script; ours, hand-written, no libraries; and a
named cost against a page budget.

**The canonical statement is the header of `lib/content/blocks.ts`. Read it
there, not here** — an earlier draft of this doc restated the rule as "three
exceptions" and was already out of date within a day, which is the exact trap
these conventions warn about everywhere else.

What it means for element work is unchanged in practice: every block built in
this audit meets the strictest reading, using a hidden input and `:checked ~`,
`<details>`, scroll-snap or a server computation rather than a script. Clause 2
is the one to check a new block against.

### New moving elements should borrow the slideshow, not grow their own

`public/slideshow.js` queries `.tgs-slideshow` and `.tgs-slideshow__slide` and
asks nothing about what is inside them. Emit that wrapper with the same data
attributes and a new block gets arrows, dots and pause **with no change to that
file**. Half overlay and Screen carousel both do this. If you add a third, add
it to `hasSlideshow` in `lib/content/slideshow.ts` too, or the page never asks
for the script and the element silently loses its pause button.

### Check the motion catalogue before building anything that moves

Stacked cards was already in it: **S3, sticky-stack, tier 0, marked proven**,
with its purpose recorded as comparison and the note that it "replaces the
three-equal-cards row, which is the single most common AI tell". Reading it
first was the difference between one element and two implementations of one
idea, and it supplied the design rationale for free.

The catalogue lives at `references/motion-recipes.md` in the travelgenix-taste
skill. The vocabulary is in `MOTION_RECIPES` in `lib/content/schema.ts`; only
the recipes in `MOTION_LIVE_RECIPES` have CSS behind them.

### Sticky has a runway, and two obvious ways to give it are wrong

For the last sticky card in a stack to reach its resting place there must be
scroll length after it. `padding-bottom` on the container **shrinks the content
box that sticky is constrained to**, so it squeezes the whole deck flat and
adding more makes it worse. `margin-bottom` on the last card is respected as
part of *that card's* margin box, so the card overshoots its own stop. The
answer is a separate empty element after the cards. All three were measured.

### A source assertion must strip comments first, every time

This repo already had the rule written down, and this audit walked into it
**twice**: a CSP check grepped a script for `innerHTML` and found the header
promising not to use it, and a no-scroll-jacking check grepped a component for
`scroll` and found the comment saying there is no scroll handler.

Both test files now build a `code` constant with comments stripped and assert
against that. Do the same in any new test that greps source.

### Re-run the block catalogue after adding a block

`tg-sites/tools/block-catalogue.mjs` generates `/block-catalogue.json` from the
registry. This audit added thirteen blocks and never ran it, so the catalogue
fell eighteen blocks behind and another session had to regenerate it twice to
catch up. It is one command and it belongs in the same commit as the block.

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
- A panel that measured perfectly and was invisible from halfway down, because
  the header is a stacking context the panel could not rise out of.

And a claim from that same work that was WRONG, corrected 21 Aug: that
`container-type` stops `position: fixed` reaching the viewport. Measured in
Chromium, it does not — only an explicit `contain: layout`, or a transform,
does, and `.tgs-page` sets neither. The burger still uses a panel rather than an
overlay, but for the reason that always mattered: with no script nothing traps
focus inside an overlay. **Reasoning from a spec is not measuring**, and the
same session that wrote the rule about verifying in a browser then reasoned its
way to a false conclusion in the next paragraph.

### A flaky test, finally explained

One test failed every few full runs, always a different one. Cause: the suite
loads modules with `await import()` **inside** a test, so the first test in a
file pays for transforming that module's whole graph — about 5.6 seconds cold
for `lib/db/pages.ts`, against a 5000ms default. `testTimeout` is now 30s in
`vitest.config.ts` with the reasoning written down. If a single test starts
failing at random again, this is not the cause any more; look elsewhere.
