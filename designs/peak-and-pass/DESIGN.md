---
name: Peak & Pass
description: A bold outdoors world for a small-group expedition operator. Deep peat-brown ground, warm bone paper, one signal-orange flare, condensed Oswald caps carved at size, and honest grade tables that say when a trip is hard. Hard edges, no gloss, every photograph on one grade.
mode: Persuade

colors:
  # Grounds and surfaces (warm earth, never grey, never charcoal)
  peat: "#17150f"          # page ground, deep near-black brown
  peat-2: "#211e15"        # raised dark surface, the stats strip
  footer-ground: "#100e0a" # footer, one step deeper than peat
  pitch: "#000000"         # btn-dark active hover only, the hardest edge

  # Light chapters (bone paper — the itinerary and grading turn the page over)
  bone: "#ece5d8"          # primary light text on dark, and the itinerary ground
  bone-2: "#e2d9c7"        # secondary light text, and the grading ground
  earth-text: "#3d392e"    # body copy set on the bone chapters
  summit-white: "#ffffff"  # headlines and emphasis on dark, the brightest tier

  # Muted earth
  stone: "#9a9180"         # muted text on dark, ~5.9:1 on peat
  stone-dark: "#5d5747"    # muted text on the bone chapters
  moss: "#7a7a5c"          # darker earth green, held in the committed set as reserve

  # The single flare
  signal: "#e4591c"        # the one accent: links, kicker dash, grade pips, one emphasised word
  signal-deep: "#c74a13"   # the button fill and the CTA band ground
  signal-ink: "#a83c0d"    # button hover, and the flare on the light chapters

  # Hairlines
  rule: "rgba(236,229,216,.16)"    # 1px divider on dark grounds
  rule-light: "rgba(23,21,15,.16)" # 1px divider on the bone chapters

fonts:
  display: "Oswald, \"Bebas Neue\", \"Arial Narrow\", system-ui, sans-serif"
  body: "\"Source Sans 3\", system-ui, -apple-system, sans-serif"

typography:
  scale:
    micro: "11.5px"    # quickstat labels, tracked caps
    meta: "12.5px"     # exp-meta sub-labels
    label: "13px"      # the tracked Oswald label
    small: "14.5px"    # secondary text and captions
    body: "17px"       # the reading size
    large: "19px"      # wordmark, lead paragraph top
    title: "clamp(24px, 2.5vw, 36px)"      # expedition and itinerary headings
    headline: "clamp(30px, 4vw, 52px)"     # section headings
    display: "clamp(28px, 3.6vw, 50px)"    # CTA band
    hero: "clamp(64px, 12.5vw, 176px)"     # the one carved line
  hero:
    fontFamily: "Oswald, sans-serif"
    fontSize: "clamp(64px, 12.5vw, 176px)"
    fontWeight: 700
    lineHeight: 0.88
    letterSpacing: "-0.012em"
    textTransform: "uppercase"
  headline:
    fontFamily: "Oswald, sans-serif"
    fontSize: "clamp(30px, 4vw, 52px)"
    fontWeight: 600
    lineHeight: 1.02
    letterSpacing: "0.005em"
    textTransform: "uppercase"
  title:
    fontFamily: "Oswald, sans-serif"
    fontSize: "clamp(24px, 2.5vw, 36px)"
    fontWeight: 600
    lineHeight: 1.08
    textTransform: "uppercase"
  statistic:
    fontFamily: "Oswald, sans-serif"
    fontSize: "clamp(30px, 3.4vw, 46px)"
    fontWeight: 600
    lineHeight: 1.05
    letterSpacing: "0.01em"
  quote:
    fontFamily: "Oswald, sans-serif"
    fontSize: "clamp(24px, 2.8vw, 40px)"
    fontWeight: 500
    lineHeight: 1.22
    textTransform: "none"
  lead:
    fontFamily: "\"Source Sans 3\", sans-serif"
    fontSize: "clamp(16px, 1.4vw, 19px)"
    fontWeight: 400
    lineHeight: 1.55
  body:
    fontFamily: "\"Source Sans 3\", sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.6
  small:
    fontFamily: "\"Source Sans 3\", sans-serif"
    fontSize: "14.5px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Oswald, sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "0.22em"
    textTransform: "uppercase"
  button:
    fontFamily: "Oswald, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    letterSpacing: "0.12em"
    textTransform: "uppercase"
  wordmark:
    fontFamily: "Oswald, sans-serif"
    fontSize: "19px"
    fontWeight: 600
    letterSpacing: "0.08em"
    textTransform: "uppercase"
  nav:
    fontFamily: "Oswald, sans-serif"
    fontSize: "13.5px"
    fontWeight: 500
    letterSpacing: "0.14em"
    textTransform: "uppercase"

spacing:
  3xs: "4px"
  2xs: "8px"
  xs: "12px"
  sm: "18px"
  md: "26px"
  lg: "44px"
  xl: "64px"
  page-padding: "clamp(20px, 4vw, 64px)"     # the horizontal gutter, everywhere
  section-y: "clamp(72px, 9vw, 128px)"       # vertical rhythm between chapters
  section-y-tight: "clamp(56px, 7vw, 96px)"  # the shorter bands (guides, stats)
  grid-gap: "clamp(20px, 3vw, 48px)"         # the ledger row gap
  grid-gap-wide: "clamp(28px, 4vw, 72px)"    # the two-column chapter gap
  nav-height: "76px"
  max-width: "1440px"

radii:
  none: "0"   # every corner in the world is square, no exceptions

motion:
  signature: "reveal-rise"
  duration: "500ms"
  easing: "ease-out"
  transform: "translateY(22px) to translateY(0)"
  opacity: "0 to 1"
  stagger: "60ms"        # capped at 180ms, cycling every four items
  trigger: "IntersectionObserver, threshold 0.12, rootMargin 0px 0px -6% 0px"
  hover-media: "scale(1.035) over 500ms ease-out"
  ui: "180ms ease-out"   # buttons; nav links 200ms ease-out
  reducedMotion: "no transform, no opacity ramp, no stagger; scroll-behavior auto; content present"
---

# Design World: Peak & Pass

## 1. Overview: Earn the View

Peak & Pass is a small-group expedition operator: treks, climbs and expeditions
with qualified leaders and honest grades. The site should feel like a route card
pinned to a hut wall, not a holiday brochure. The whole system rests on one idea:
tell the truth about difficulty and let the mountain sell itself. A serious walker
trusts an operator who says a trip is hard, so the page earns the booking by being
straight, never by being soft. The authority comes from the honesty and the hard
edges, not from gloss.

The world is a deep peat-brown ground, warm bone paper where a chapter turns the
page over, one signal-orange flare rationed to the thing that matters, and a tall
condensed Oswald set in uppercase and carved at size. Body copy is Source Sans 3,
a plain workhorse that stays out of the way and lets the numbers do the talking.
There is no rounded corner, no drop shadow, no gradient panel and no corporate
gloss. There is peat, bone, one orange flare, condensed caps, and grade tables
that state a trip's difficulty in plain language.

**Creative North Star.** Earn the view. A page carved in condensed caps out of
peat, one orange flare for the thing you act on, and an honest grade beside every
trip. The difficulty is the sales pitch. Hard edges, straight talk, no filler.

**Key characteristics**

- A deep peat-brown ground, warm earth throughout, never grey and never charcoal.
- One chromatic colour, signal orange, rationed to a flare and two block fills.
- Bone-paper chapters that turn the page over from dark to light mid-scroll.
- A tall condensed display face, Oswald, set uppercase and tight at size.
- A plain sans, Source Sans 3, carrying every sentence you actually read.
- Honest grade tables and grade pips that state difficulty as trust, not decoration.
- Every photograph on one shared grade, so a page of stock reads as one shoot.
- Hard square edges everywhere, no rounded corners and no drop shadow.
- One motion moment, the reveal-rise, and a single slow zoom on hovered media.

## 2. The Kit: One Vocabulary For Every Page

Every Peak & Pass page is built from the same small vocabulary. Reach for these
before inventing anything, and invent only when a page has a genuinely new
editorial moment such as a fresh photographic treatment. Do not reinvent a button,
a rule or a row.

- **Chapters, not cards.** A page is a sequence of full-width chapters, some on the
  peat ground and some on bone paper, separated by the `section-y` rhythm. The
  page turns over from dark to light and back as you scroll.
- **The hairline row.** The ledger, itinerary and grading table are rows separated
  by a single 1px hairline, never boxes. The rule does the dividing.
- **The honest number.** Distances, altitudes, grades, ratios and prices are set in
  Oswald at size, because the numbers are the proof. A stat carries a signal-orange
  border-left flare and a tracked sub-label beneath.
- **The grade device.** Difficulty is shown two ways that agree: a five-bar pip row
  where filled bars are signal, and a plain-language name (Steady, Solid, Tough,
  Hard, Savage) with a sentence that tells the truth about the day.
- **Type roles.** Oswald carries every heading, number, label and button, always
  uppercase bar the one pull-quote. Source Sans 3 carries every sentence. They
  never swap jobs.
- **One flare.** Signal orange marks the thing you act on and one word you must
  read. It fills exactly two blocks: the primary button and the CTA band. Elsewhere
  it is a hairline, a pip, a border-left or a single word, never a field of colour.

## 3. Colours: Peat, Bone and One Flare

### Grounds and surfaces

- **Peat** `#17150f`: the page ground. A deep near-black brown, the colour of wet
  moorland, warm and mineral, never a cool charcoal.
- **Peat 2** `#211e15`: the one raised dark surface, the stats strip under the hero.
- **Footer Ground** `#100e0a`: the footer, one honest step deeper than peat.
- **Pitch** `#000000`: reserved for the dark button's active hover, the hardest edge.

### Bone chapters

- **Bone** `#ece5d8`: primary light text on the dark ground, and the ground of the
  itinerary chapter when the page turns over.
- **Bone 2** `#e2d9c7`: secondary light text, and the ground of the grading chapter.
- **Earth Text** `#3d392e`: body copy set on the bone chapters, warm and readable.
- **Summit White** `#ffffff`: headlines and emphasis on dark, the brightest tier,
  used only where a number or a heading must ring clear.

### Muted earth

- **Stone** `#9a9180`: muted text on dark grounds, sub-labels and captions, about
  5.9:1 on peat. Warm, never a flat grey.
- **Stone Dark** `#5d5747`: muted text on the bone chapters.
- **Moss** `#7a7a5c`: a darker earth green, carried in the committed token set as a
  reserve tone. Unused on this page; available for an earth accent on a future
  surface, never a second flare competing with signal.

### The single flare

- **Signal** `#e4591c`: the one accent. Links on hover, the kicker dash, filled
  grade pips, the border-left on a stat, one emphasised word in a headline or quote.
- **Signal Deep** `#c74a13`: the primary button fill and the CTA band ground. The
  only two places signal fills a block.
- **Signal Ink** `#a83c0d`: the button hover, and the flare on the bone chapters
  where the brighter signal would glare against paper.

### Hairlines

- **Rule** `rgba(236,229,216,.16)`: the 1px divider on dark grounds.
- **Rule Light** `rgba(23,21,15,.16)`: the 1px divider on the bone chapters.

### Browser surfaces

Theme every surface the browser would otherwise leave in its defaults. The source
already sets the focus ring; the rest are derived from this palette and stated here.

- **Focus ring** (shipped): `3px solid #e4591c` with a `3px` offset, on links and
  buttons. A bold visible ring, in keeping with the world.
- **Selection**: background signal at low alpha (`rgba(228,89,28,.28)`), text bone.
- **Caret**: signal.
- **Scrollbar**: a stone thumb on a peat track, thin.
- **Link underline**: on the bone chapters, a signal underline at `0.16em` offset;
  on dark, links carry the signal hover and the nav's 2px signal underline.

### Colour rules

**The Signal Ration Rule.** Orange is the only chromatic colour on the page and it
earns its place one item at a time. It fills exactly two blocks, the primary button
and the CTA band. Everywhere else it is a flare: a hairline, a grade pip, a
border-left, a hovered link, one word. If orange has spread into a third fill, pull
it back to peat.

**The Earth, Not Grey Rule.** Every neutral is warm earth. The ground is peat brown,
the paper is bone, the muted tiers are stone. There is no cold grey, no charcoal and
no pure black except the footer's deeper ink and the one button's active state.

**The Hex Rule.** Colours are declared in hex, matching the source token set. New
colours join the `:root` block with a descriptive slug and a role, never inline.

## 4. Typography: Oswald Carved, Source Sans Straight

**Display:** Oswald, "Bebas Neue", "Arial Narrow", system-ui, sans-serif. A tall
condensed grotesque, set uppercase and carved at size. This is the mountain voice
and it carries every heading, number, label and button.

**Body:** "Source Sans 3", system-ui, -apple-system, sans-serif. A plain honest
sans that stays out of the way. It carries every sentence a reader actually reads,
in regular, semibold and one italic for a quiet aside.

The tension is between a tall condensed face shouting a place name in caps and a
calm sans stating the distance in plain words. Oswald sells the feeling; Source Sans
tells the truth. That is the whole typographic story.

### Hierarchy

- **Hero**: Oswald, `clamp(64px, 12.5vw, 176px)`, weight 700, uppercase, line-height
  0.88, letter-spacing `-0.012em`. Two short lines, the second flared in signal. It
  is cropped hard to the column edge and breaks over the image into the stats strip.
- **Headline** (section titles): Oswald, `clamp(30px, 4vw, 52px)`, weight 600,
  uppercase, line-height 1.02, capped near 14ch so a line breaks like a route name.
- **Title** (expedition and itinerary headings): Oswald, `clamp(24px, 2.5vw, 36px)`,
  weight 600, uppercase, line-height 1.08.
- **Statistic**: Oswald, `clamp(30px, 3.4vw, 46px)`, weight 600, in summit white or
  peat. The number reads bigger than the words around it, because it is the proof.
- **Quote** (field notes): Oswald, `clamp(24px, 2.8vw, 40px)`, weight 500, line-height
  1.22, sentence case, one word flared in signal. The single non-uppercase Oswald.
- **Lead**: Source Sans 3, `clamp(16px, 1.4vw, 19px)`, weight 400, line-height 1.55.
- **Body**: Source Sans 3, `17px`, weight 400, line-height 1.6, measure near 52-58ch.
- **Label** (tracked caps): Oswald, `13px`, weight 500, uppercase, letter-spacing
  `0.22em`. Lives in the nav, the footer headings and the meta rows.
- **Button**: Oswald, `14px`, weight 600, uppercase, letter-spacing `0.12em`.
- **Wordmark**: Oswald, `19px`, weight 600, uppercase, letter-spacing `0.08em`, with
  a tracked Source Sans sub-line beneath.

### Typography rules

**The Condensed Caps Rule.** Oswald is set uppercase everywhere it appears, held
tight at the big sizes (`-0.012em` on the hero) and opened at the small labels (up
to `0.22em`). The one deliberate exception is the field-notes pull-quote, set
sentence case at weight 500 so a human voice sounds human.

**The Two Voices Rule.** Oswald carries every heading, number, label and button.
Source Sans 3 carries every sentence you actually read. They never swap jobs; a
paragraph is never set in the condensed face, a heading is never set in the sans.

**The Honest Number Rule.** Distances, altitudes, grades, ratios and prices are set
in Oswald at size, in summit white on dark or peat on light, always above the small
tracked sub-label that names them. The number is the argument, so it reads first.

## 5. Elevation and Material

The system is flat and hard-edged. Depth comes from photography, from the hairline
rules and from the ground turning over from peat to bone, never from a shadow.

### Photography as one grade

Every photograph carries the same `.grade` treatment, `saturate(.82) contrast(1.06)
brightness(.96)`, so a page assembled from many sources reads as one commissioned
expedition shoot. The hero adds a single directional scrim, a 12deg peat gradient
from 82% down to 5%, so the carved headline always sits on calm tone.

### No shadow, hard edges

- **No drop shadow.** Nothing on the page floats. Surfaces sit flat on the ground.
- **Square corners.** Every corner is `0`. Buttons, images, pips, badges, notes and
  the stats strip are all hard-edged. A rounded corner does not exist in this world.
- **The border-left flare.** A stat and the "straight talk" note carry a signal
  border-left, `2px` on a stat and `3px` on the note. This is the one accent bar the
  world allows, and it marks a number or a warning, never mere decoration.

### Material rules

**The One Grade Rule.** Every photograph carries the shared grade so the imagery
belongs together. Add a new plate only if it can take the same treatment.

**The Hairline Rule.** A 1px rule does the work a border or a shadow would do
elsewhere. Ledger rows, itinerary days and grade rows are separated by `rule` on
dark or `rule-light` on bone. Add the line before you add anything heavier.

**The No Gloss Rule.** No drop shadow, no gradient panel, no glass, no glow and no
rounded corner. The one gradient on the page is the hero's text scrim, and it exists
only to keep the headline legible.

## 6. Motion: One Gesture, One Zoom

There is a single authored motion, the **reveal-rise**. Content begins fully legible
in its resting state, so a failed script never hides the page, and as it enters the
viewport it lifts from `translateY(22px)` to `0` while opacity moves `0` to `1`, over
`500ms` on `ease-out`. Items within one band stagger by `60ms`, capped at `180ms`
and cycling every four, so a row settles in sequence without a long wait. The trigger
is an IntersectionObserver at threshold `0.12`.

The only other movement is the **trail creep**: a hovered expedition photograph
zooms slowly to `scale(1.035)` over `500ms ease-out`, the trail pulling you in.
Buttons transition their fill over `180ms ease-out` and drop `1px` on active; nav
links move colour and underline over `200ms`. There is no parallax, no scroll-scrub,
no clip-path reveal and no second entrance.

**Reduced motion.** Under `prefers-reduced-motion: reduce` the transform and opacity
ramp are removed, the stagger is dropped, all animation and transition are switched
off and `scroll-behavior` returns to auto. Content is simply present.

## 7. Components

### Nav

A transparent bar over the hero, `76px` tall, a hairline beneath. The wordmark locks
a signal-and-bone peak mark to condensed caps with a tracked sub-line. Links are
tracked Oswald caps that gain a signal underline on hover. One filled signal button
sits at the right beside a stone phone number. Below 900px the links collapse to a
peat drawer behind a 48px hamburger.

### Hero and stats strip

A full-bleed graded photograph under a directional peat scrim, with the topline,
sub, actions and the carved two-line headline stacked at the bottom. The headline
breaks over the image edge into the **stats strip** beneath, a peat-2 band of three
stats, each a summit-white Oswald number over a stone sub-label with a signal
border-left. The strip is the hero's second half, not a separate section.

### Expedition ledger

Rows separated by hairlines, alternating the image left and right down the scroll.
Each row carries a `Nº` index tab on the image, a trek-or-climb label, an Oswald
title that hovers to signal, a plain-language description, a meta row of honest
numbers (grade with pips, distance, duration, group cap) fenced top and bottom by
hairlines, and a price beside a ghost button. The image takes the trail creep on
hover.

### Itinerary (bone chapter)

The page turns over to bone. A sticky left column holds the trip name, a graded
image and a three-cell quickstats block bordered in rule-light. The right column is
a day-by-day list, each day a `D1` marker in signal-deep, an Oswald day heading and
a plain description, with distance and hours ranged right. A **straight-talk note**
closes it, a signal border-left over a faint signal wash, stating the grade honestly.

### Grading table

On bone-2. Five rows, each a big signal Oswald grade number, its plain name, an
honest sentence about the day and a worked example with a price. The Grade 4 row
carries a faint signal wash to mark the grade most walkers return for. This table is
the trust mechanism of the whole site; it is never softened or inflated.

### Grade pips

Five hard bars, `14px` by `8px`, square. Filled bars are signal, empty bars are the
hairline rule. They sit inline before the written grade so difficulty reads at a
glance and in words at once.

### Field notes

A peat chapter pairing a sentence-case Oswald pull-quote, one word in signal, with a
credited photograph and a three-figure score row (survey rating, repeat rate, leader
ratio). The one place Oswald is not uppercase, so a client's voice sounds like a
person.

### Buttons

- **Signal** (primary): `signal-deep` fill, white text, square, min-height `48px`,
  padding `0 26px`, Oswald 600 tracked `0.12em` uppercase. Hover fills to `signal-ink`
  over `180ms`. Active drops `1px`. One primary per view, for the booking.
- **Ghost**: transparent with a `2px` inset rule box-shadow, hover to inset bone.
- **Dark**: peat fill, white text, hover to pitch. For actions on a light or signal
  ground.
- **Focus**: the shipped `3px` signal ring at `3px` offset, on every button and link.

### Footer

The deepest ground, `footer-ground`, a hairline above. The wordmark and a plain line
of copy, three columns of tracked-caps headings over text links that hover to signal,
a human phone number in Oswald, and a legal row carrying the real protections (ATOL,
ABTA, BMC) as small tracked-caps badges bordered in rule.

## 8. Do and Do Not

### Do

- Do keep the ground warm peat and turn the page over to bone paper for a chapter,
  never a flat grey and never charcoal.
- Do ration signal orange to one flare at a time, filling only the primary button and
  the CTA band.
- Do set every heading, number, label and button in condensed Oswald caps, tight at
  size and open on the small labels.
- Do let Source Sans 3 carry every sentence a reader actually reads.
- Do state difficulty honestly with the grade pips and a plain-language name, and let
  the grading table be the trust mechanism of the page.
- Do set distances, altitudes and prices in Oswald at size, because the numbers are
  the proof.
- Do grade every photograph on the one shared treatment so the imagery reads as one
  shoot.
- Do keep every corner square and every surface flat, dividing with hairlines.
- Do theme the browser surfaces, selection, caret, scrollbar, focus ring and link
  underline, from this palette, keeping the shipped signal focus ring.
- Do honour the one reveal-rise and the slow trail-creep zoom, and drop both under
  reduced motion.

### Do Not

- Do not soften the world with rounded corners, drop shadows, gradient panels, glass
  or glow. The one gradient allowed is the hero's text scrim.
- Do not spread signal orange across surfaces or add a second chromatic accent. It is
  one flare and two block fills.
- Do not inflate or hide a grade to win a booking. Honesty about difficulty is the
  product; a dishonest grade breaks the whole system.
- Do not set a paragraph in the condensed face or a heading in the sans. The two
  voices never swap jobs.
- Do not use cold grey, charcoal or pure black except the footer's deeper ink and the
  dark button's active state.
- Do not place a small tracked label above a heading as an eyebrow. Tracked Oswald
  labels belong in the nav, the footer headings and the meta rows, never as a kicker.
- Do not add a second animation, a parallax or a scroll-scrub. One reveal-rise and one
  hover zoom only.
- Do not let a photograph run ungraded, or the page reverts to assembled stock.
