# Travelgenix homepage redesign, two directions

Living record for the homepage redesign of the Travelgenix Framer site
(project "Scary Wealth", `vna1Dww9wfns4nJSst1v`, home page `augiA20Il`).
Companion to `docs/framer-timeline-brief.md`, which covers `/roadmap`, the home
news area and the press page.

## The brief, 16 Sep 2026

Andy: "I want you to redesign the homepage of the Travelgenix site. I'm looking
for two options, one based on https://www.duda.co/ and one based on the Apple
website."

## What was delivered, and what it is NOT

Two full homepage comps in one page, with an A/B switcher:
**https://claude.ai/artifact/LCGrEEmNo3HDjXxFKJVHyi**

These are comps, not Framer builds. Nothing on the Framer site was touched and
no branch was opened. Building both in Framer would mean building two complete
homepages and binning one, so the sequence is: Andy picks a direction, THEN it
gets built on a branch and reviewed the usual way.

Source files live in the session scratchpad (they die with the container). The
page is plain HTML with its images published alongside it as artifact files.

## Both directions use real material

Nothing is placeholder. Copy, figures and screenshots all come from the live
site or from Andy:

- Copy lifted from the live homepage: the H1, the lead, "You didn't start a
  travel business to become an IT manager", the Steer / Keep it moving / Grow
  framework, the five tool descriptions, the Absolutely Snow story, the
  Travelaire testimonial, the FAQ answers, the closing CTA.
- Figures from the live page: 200+ suppliers, 300+ travel businesses, 20+ years
  in travel tech, 99.95% uptime, 4.8 from 27 Google reviews.
- ONE figure deliberately differs from the live site. The live homepage says
  "over 100 ready-made tools"; both comps say over 150, per Andy on 4 Sep: "We
  shipped 61 new widgets in the period, we have over 150." The live page is the
  one that is out of date.
- Screenshots are real Travelgenix product, reused from the roadmap page build:
  Luna Chat on a client site, the widget catalogue, the booking results page,
  contracted rates, the world map widget with its embed code, the appointment
  scheduler, and the travel app phone. Supplier logos are the real marks.

Guard rail worth keeping: the first draft of direction B invented customer
proof for Dawson Travel, EveryHoliday and Exclusively Travel ("24/7",
"150+", "6 countries"). Those were fabricated and were removed before handover.
Only Absolutely Snow (doubled bookings) and Travelaire (4.8 from 27 reviews)
have sourced figures, so only those two carry numbers; the rest are named
without claims. Never invent a customer metric, even in a comp.

## Direction A, Commercial (after duda.co)

What duda.co actually does, from the live page: white ground with a single
accent used sparingly, pill CTAs, product screenshots in browser frames with
soft shadows, a grayscale logo carousel, a repeating three-part framework
(theirs is Build / Get found / Convert) used as branded scaffolding, alternating
deep-dive rows with the text and screenshot swapping sides, stat callouts inside
case studies, an FAQ accordion, then a closing CTA.

Applied to Travelgenix: Travelgenix already owns a three-part framework on the
live site, **Steer / Keep it moving / Grow**, so that became the triad rather
than inventing one. Supplier logos carry the logo strip, labelled honestly as
suppliers rather than implying they are customers. Teal is the only accent, used
on CTAs and one swash under "Not their budgets" in the H1.

Reads as: a confident, conversion-led SaaS homepage. Dense, scannable, every
section earning a click.

## Direction B, Product (after apple.com)

What apple.com actually does: stacked full-bleed tiles alternating white and
near-black, monumental centred headlines with a one-line tagline, TWO INLINE
CHEVRON LINKS instead of buttons, product imagery presented bare with no frame
or border, a paired half-width row to break the rhythm, a horizontal snap-scroll
gallery, tiny nav type, very short copy.

Applied to Travelgenix: the near-black is navy-biased (`#0A1022`) so it still
reads as Travelgenix rather than Apple. Product names become the headlines,
Apple-style: "Luna.", "Widgets.", "Contracting.", "Booking, built in." Copy is
compressed hard, because this language collapses if the tiles carry paragraphs.
There is exactly one button on the page, at the very end.

Reads as: quiet, premium and product-led. Sells the product rather than the
pitch, and demands short copy discipline for ever after.

## Brand decisions taken

- **No new colours and no new font.** Navy `#1B2B5B`, teal `#00B4D8` and Inter
  throughout both. Pink `#E81070` and yellow `#F8B810` appear only where the
  live site already uses them (the eyebrow dot, the review stars).
- **Inter in both, deliberately.** The Travelgenix system mandates it, and it
  suits both references: Duda and Apple both run grotesques. An imported
  display face would have been the wrong kind of boldness here.
- **Marketing type scale, not the product type scale.** The type scale in the
  travelgenix-design skill tops out at 36px for hero headings; that scale is for
  product UI (dashboards, widgets, editors). A marketing homepage needs 60px in
  direction A and up to 88px in direction B, which is what the live site already
  does.
- **The standing "no new styles" rule does not apply here.** That rule governs
  EDITING the existing Framer site. A redesign is the one job that is allowed to
  replace the look, and mixing the old and the new would produce a compromise
  neither direction chose.


## Second pass, 16 Sep 2026: execution rebuild

Andy on v1: "nope, lets try again", and on what missed: execution, not
direction. The two directions were right; the craft was not. Rebuilt in place
at the same URL.

### What was actually wrong, found by rendering the page

The first version was published WITHOUT looking at it. Rendering it locally
(Playwright, using the repo's own install, Chromium at
`/opt/pw-browsers/chromium-1194/chrome-linux/chrome`) showed three faults that
a single look would have caught:

1. **A browser frame around a browser frame.** The hero image was
   `roadmap-jul3`, which is itself a browser-framed mockup cut from the roadmap
   page. Wrapping it in my own frame gave two sets of traffic lights and two
   URL bars, and it was the first thing on the page.
2. **Borrowed page furniture.** That same source carried the roadmap marketing
   page's floating pink chat bubble and a sub-nav strip ("Luna Chat / What it
   does / Always on / ...") that had nothing to do with a homepage.
3. **A caption burnt into the photo.** The coastal crop already had "Your next
   escape, sorted" rendered into the pixels, so when the HTML drew the caption
   too it appeared twice, overlapping.

Two further bugs found on the rebuild's own first render:

4. `#b .art img` and `#b .bleed img` matched EVERY image inside the tile,
   including the ones inside the hand-built mock, stretching its 40px
   thumbnails to full width and breaking the offer rows to one character per
   line. Fixed by scoping to the direct child: `#b .art>img`, `#b .bleed>img`.
   Worth remembering: a descendant selector inside a section wrapper will reach
   into any component you nest there.
5. The mock's site column did not fill the frame height, leaving dead white
   below the photo. Fixed with a flex column and `flex:1` on the hero band.

### The rule that came out of it

**Never frame a screenshot that is already framed, and never trust a source
image to be clean.** Every image now used is PURE product UI, cropped away from
its own chrome and from any furniture belonging to the page it was cut from:

- `widgets.jpg` from `may` (0,250,1200,890), catalogue only
- `contracting.jpg` from `aug2` (40,192,1115,815), its own browser chrome
  removed from the top and the floating bubble trimmed off the right
- `map.jpg` from `alt-map` (140,140,1060,735)
- `scheduler.jpg` from `jun` (310,335,895,815)
- `booking.jpg` from the June booking flow crop, already clean
- `coast.jpg` from `jul3` (40,128,777,528), stopping ABOVE the burnt-in caption

### The hero is drawn, not screenshotted

Both directions now open on a hand-built HTML product mock: a browser frame
containing the Coast & Co Travel site with Luna open, the real conversation
(Algarve in October under £700pp, Albufeira £649, Vilamoura £689), language
switcher, typing indicator and input. It scales through one custom property
(`--u`, a `clamp()` on the container font-size) with every internal dimension in
`em`, so the whole mock resizes cleanly at any width. This removes the nested
frame problem completely and is crisp at any size, which no screenshot would be.

### Other craft fixes

- The teal highlight on "Not their budgets." was a thin swash that read as a
  stray underline. It is now a proper highlight block sitting behind the words.
- Direction A's hero shot now breaks out wider than the text column, as Duda's
  does, instead of sitting inside it.
- Direction B's subhead was muted 19px body copy; Apple's sits close to the
  headline in weight, so it is now 30px at weight 500.
- Direction B presents imagery bare with a soft shadow, never framed, because
  Apple never frames.

## Next steps

1. Andy picks A or B, or the bits he wants from each.
2. Build the winner in Framer on a new branch, breakpoints included, verified by
   screenshot at Desktop / Tablet / Phone as usual. Never publish.
3. The five-tool section is the biggest structural decision inside either
   direction: the live site runs a sticky scroll toolkit (01 to 05). Direction A
   turns that into alternating deep-dive rows; direction B turns it into
   separate tiles. Whichever wins, the sticky toolkit component goes.
4. Open question for Andy: the live homepage's "Compete with the big travel
   brands. Not their budgets." is strong and both comps keep it. Worth checking
   he still wants to lead with it.
