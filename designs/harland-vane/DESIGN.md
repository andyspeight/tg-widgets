---
name: Harland & Vane
description: A warm editorial studio world for a bespoke private-travel house. Ivory paper ground, near-black ink, two rationed metals (bronze for light, champagne for dark), a soft modern serif set light and italic against a grotesque sans, laid out as asymmetric magazine spreads on hairline rules with one inverted dark chapter.
mode: Persuade

colors:
  # Ground and surface (warm ivory paper, never white)
  ivory: "#F6F1E8"          # page ground
  ivory-deep: "#EFE8DA"     # the one raised block, the client-quote band
  ink: "#1C1917"            # display, headlines, body on ivory; the dark-chapter ground
  ink-soft: "#2B2620"       # body emphasis, solid-button hover

  # The two rationed metals
  bronze: "#7A5A2C"         # accent legible on ivory: links, kicker meta, focus ring on light
  champagne: "#C2A671"      # accent for dark only: hairlines, step numbers, labels, focus ring on dark
  stone: "#6E675C"          # captions and meta on ivory, 4.5:1+

  # Dark-chapter text ramp (on the ink ground)
  mist: "#CFC7B8"           # body copy on ink
  ash: "#8A8378"            # placeholders and faint meta on ink

  # Hairlines
  hairline: "rgba(28,25,23,0.18)"       # dividers on ivory
  hairline-dark: "rgba(194,166,113,0.35)" # dividers on ink, a dimmed champagne

fonts:
  display: "Fraunces, Georgia, serif"
  body: "Archivo, system-ui, sans-serif"

typography:
  scale:
    micro: "0.625rem"     # 10px, the wordmark sub-label only
    label: "0.75rem"      # 12px, tracked caps meta and field labels
    caption: "0.8125rem"  # 13px, roles, prices, section counts
    small: "0.875rem"     # 14px, nav and quiet links
    body: "1rem"          # 16px, the reading size
    lead: "1.0625rem"     # 17px, the hero standfirst
    subtitle: "clamp(20px, 2vw, 27px)"   # pair and designer headings
    title: "clamp(24px, 2.4vw, 34px)"    # feature heading
    section: "clamp(28px, 3vw, 42px)"    # section titles
    statement: "clamp(26px, 3.4vw, 46px)" # the pull line
    headline: "clamp(30px, 3.6vw, 52px)" # dark-chapter titles
    display: "clamp(38px, 5.2vw, 72px)"  # the hero line
  display:
    fontFamily: "Fraunces, Georgia, serif"
    fontSize: "clamp(38px, 5.2vw, 72px)"
    fontWeight: 300
    letterSpacing: "-0.01em"
    lineHeight: 1.06
  headline:
    fontFamily: "Fraunces, Georgia, serif"
    fontSize: "clamp(30px, 3.6vw, 52px)"
    fontWeight: 300
    letterSpacing: "-0.01em"
    lineHeight: 1.14
  statement:
    fontFamily: "Fraunces, Georgia, serif"
    fontSize: "clamp(26px, 3.4vw, 46px)"
    fontWeight: 300
    letterSpacing: "-0.01em"
    lineHeight: 1.25
  section:
    fontFamily: "Fraunces, Georgia, serif"
    fontSize: "clamp(28px, 3vw, 42px)"
    fontWeight: 400
    letterSpacing: "-0.01em"
    lineHeight: 1.15
  title:
    fontFamily: "Fraunces, Georgia, serif"
    fontSize: "clamp(24px, 2.4vw, 34px)"
    fontWeight: 400
    lineHeight: 1.2
  subtitle:
    fontFamily: "Fraunces, Georgia, serif"
    fontSize: "clamp(20px, 2vw, 27px)"
    fontWeight: 400
    lineHeight: 1.2
  lead:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.6
  body:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.65
  label:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    letterSpacing: "0.22em"
    textTransform: "uppercase"
  wordmark:
    fontFamily: "Fraunces, Georgia, serif"
    fontSize: "1.375rem"
    fontWeight: 500
    letterSpacing: "0.01em"

spacing:
  pad: "clamp(20px, 5vw, 84px)"          # the page margin, one token for every edge
  measure: "66ch"                        # reading-copy cap
  section-tight: "clamp(72px, 9vw, 140px)"  # standard block rhythm
  section-loose: "clamp(80px, 10vw, 150px)" # the statement and dark chapters
  gap-spread: "clamp(24px, 4vw, 64px)"   # column gap inside a spread
  gap-step: "clamp(56px, 7vw, 100px)"    # between features down the scroll

radii:
  none: "0"        # the editorial default, sharp corners everywhere
  focus: "1px"     # the softened corner on a focus ring only

motion:
  signature: "reveal"
  transform: "translateY(14px) to translateY(0)"
  opacity: "0 to 1"
  duration: "400ms"
  easing: "ease-out"
  stagger: "70ms"          # applied in threes, capped at 140ms
  ui: "200ms ease-out"     # button and field colour, nav underline is 250ms
  press: "100ms ease-out"  # the 1px button press only
  reducedMotion: "no reveal, scroll-behavior auto, all animation and transition removed, content present"
---

# Design World: Harland & Vane

## 1. Overview: The Studio Journal

Harland & Vane is a studio of eleven travel designers who plan very few trips a
year and answer their own phones. The site should read like the studio's own
journal, printed on warm paper: an editorial spread, not a booking funnel. The
authority comes from restraint and from evidence, a room number, a named
contact, a season, set with the confidence of people who have been there. The
page persuades the way a good magazine does, by being worth reading.

The world is a warm ivory ground with near-black ink text, laid out as
asymmetric magazine spreads separated by fine hairlines. Colour is rationed to
two metals that never trade places: bronze does the accent work on the light
paper, champagne takes over inside the one dark chapter where the page inverts
to an ink ground. Display is Fraunces, a soft modern serif set light and often
italic, given room at scale. Everything else, controls, meta, body, is Archivo,
a plain grotesque sans that stays out of the serif's way. Photography is graded
to a single warm reel so a stock library reads as one commissioned shoot.

**Key characteristics**

- A warm ivory paper ground, never white, with warm near-black ink for text.
- Two rationed metals that never swap surfaces: bronze on light, champagne on dark.
- One inverted dark chapter where the whole palette flips to an ink ground.
- Fraunces set light (weight 300) and italic for emphasis, never bold.
- Archivo grotesque sans for every control, label and body run.
- Asymmetric fractional spreads with offset column heights, never a centred grid.
- Fine hairlines opening every section, doing the work of borders and shadows.
- Photography graded on one warm reel, edge to edge, no frames.
- A single motion moment, the reveal, staggered in threes and nothing else.

## 2. The Kit: One Vocabulary For Every Page

Every Harland & Vane page is built from the same small set of shapes. Reach for
these before inventing, and invent only for a genuinely bespoke editorial
moment. Do not reinvent a button, a rule or a spread.

- **Spreads, not sections.** A page is a run of asymmetric editorial spreads,
  each a fractional grid of photograph and offset text, opened by a hairline.
  Use the `section-tight` rhythm between them, `section-loose` around the
  statement and the dark chapters.
- **The hairline header.** Almost every block begins with a full-width 1px
  hairline and a baseline-aligned title and count. The line is the section
  marker, in place of any badge or panel.
- **The offset column.** Grids are fractional and uneven (7/5, 8/4, 5/1/4),
  and paired items step each other down with a `margin-top` offset so no two
  edges line up. This diagonal is the layout's signature.
- **The inverted chapter.** The process, the consultation and the footer sit
  on a dark ink ground with the palette flipped. This is the one inversion,
  used to mark the shift from browsing to working.
- **The pull line.** An oversized Fraunces sentence in near-empty space, one
  clause carried in italic, is how a block lands a point, in place of a callout.
- **Type roles.** Fraunces is display and headings, always. Archivo runs
  controls, labels, meta and body. Tracked Archivo caps carry meta beside or
  below content, never above a heading.
- **One CTA per view.** A single filled ink button (or champagne inside the
  dark chapter) for the enquiry. Every other action is a text link with a
  bronze underline.

## 3. Colours: Ivory Paper, Two Metals

### Ground and surface

- **Ivory** `#F6F1E8`: the page ground. Warm, soft, the colour of good paper.
- **Ivory Deep** `#EFE8DA`: the single raised band, used for the client quote.
- **Ink** `#1C1917`: display, headline and body text on ivory, and the ground
  of the inverted chapter. A warm near-black, never pure black.
- **Ink Soft** `#2B2620`: body emphasis and the hover state of a solid button.

### The two metals

- **Bronze** `#7A5A2C`: the accent for the light paper. Links, the tracked meta
  labels, the underline reveal, and the focus ring on ivory. It clears 4.5:1 on
  ivory, so it is the only metal allowed to carry small text there.
- **Champagne** `#C2A671`: the accent for the dark chapter only. Hairlines on
  ink, the process numerals, field labels and the focus ring on ink. It is too
  light to carry small text on ivory and is never used for text there.

### Text tiers

- **Stone** `#6E675C`: captions, roles, prices and section counts on ivory,
  4.5:1 and above. Warm-tinted, never flat grey.
- **Mist** `#CFC7B8`: body copy inside the dark chapter, sitting on ink.
- **Ash** `#8A8378`: placeholders and the faintest meta on ink. Never load an
  essential word onto this tier.

### Hairlines

- **Hairline** `rgba(28,25,23,0.18)`: the divider on ivory.
- **Hairline Dark** `rgba(194,166,113,0.35)`: the divider on ink, a dimmed
  champagne so the rule belongs to the same family.

### Browser surfaces

Theme every surface the browser would otherwise leave in its defaults, from
this palette.

- **Selection**: background champagne `#C2A671`, text ink. (As shipped.)
- **Caret**: bronze on ivory, champagne inside the dark chapter.
- **Scrollbar**: a bronze thumb on an ivory-deep track, thin. Derived from the
  palette; the source leaves the scrollbar at browser default, so set this.
- **Focus ring**: 2px solid bronze at a 3px offset on ivory, switching to
  champagne inside the dark chapter. (As shipped.)
- **Link underline**: bronze, sitting a little below the text with the same
  hairline weight the nav and quiet links already use.

### Colour rules

**The Two Metals Rule.** Bronze belongs to the light paper, champagne to the
dark chapter, and they never trade places. A metal is chosen by whether it
clears 4.5:1 on the ground it sits on, so champagne never carries small text on
ivory and bronze is not the accent on ink.

**The Warm Paper Rule.** The ground is warm ivory and the ink is a warm
near-black. There is no pure white and no pure black anywhere. Secondary text is
stone or mist, warm-tinted, never a flat neutral grey.

**The Inverted Chapter Rule.** One dark chapter flips the whole palette to an
ink ground with mist body and champagne accent. It is a deliberate shift, not a
decorative panel, and there is only one voice of it per page.

## 4. Typography: Fraunces Light, Archivo Plain

**Display:** Fraunces, Georgia, serif. A soft modern serif with an optical-size
axis, set light (weight 300 on the largest lines, 400 on section titles) and
often italic for the emphasised clause. This is the whole editorial voice.

**Everything else:** Archivo, system-ui, sans-serif. A plain grotesque sans that
runs nav, buttons, labels, meta and body at 16px/1.65. It is deliberately quiet,
so the serif never has to compete.

The tension between a warm light serif and a neutral grotesque is the entire
typographic story. Fraunces gets to be large and expressive, Archivo gets to be
legible and calm, and neither reaches into the other's job.

### Hierarchy

- **Wordmark**: Fraunces `1.375rem`, weight 500, with an Archivo `0.625rem`
  sub-label tracked `0.28em` uppercase in bronze beneath it.
- **Display (hero)**: Fraunces `clamp(38px, 5.2vw, 72px)`, weight 300,
  line-height 1.06, letter-spacing `-0.01em`, emphasis in italic weight 400.
- **Headline (dark chapters)**: Fraunces `clamp(30px, 3.6vw, 52px)`, weight 300,
  line-height 1.14.
- **Statement (pull line)**: Fraunces `clamp(26px, 3.4vw, 46px)`, weight 300,
  line-height 1.25, the emphasised clause in italic weight 500.
- **Section title**: Fraunces `clamp(28px, 3vw, 42px)`, weight 400.
- **Feature heading**: Fraunces `clamp(24px, 2.4vw, 34px)`, line-height 1.2.
- **Pair and designer heading**: Fraunces `clamp(20px, 2vw, 27px)`.
- **Lead (standfirst)**: Archivo `1.0625rem`, weight 400, on ink-soft.
- **Body**: Archivo `1rem`, weight 400, line-height 1.65, measure capped 66ch.
- **Label and meta**: Archivo `0.75rem`, weight 600, uppercase, tracked
  `0.18em` to `0.22em`, on bronze (light) or champagne (dark).

### Typography rules

**The Light Serif Rule.** Fraunces carries display at weight 300 and never goes
bold. Weight and drama come from size, italics and the space around the line,
not from a heavy cut. A soft serif set heavy loses its whole character.

**The No Eyebrow Rule.** There is never a small tracked label directly above a
heading. The Fraunces heading carries its own weight. Where meta is genuinely
needed it sits in the hairline header's count, in a caption, or beside the copy,
apart from the heading and never as a kicker.

**The Tracked Caps Rule.** Uppercase Archivo caps at `0.14em` to `0.28em`
tracking are for labels, buttons and meta only, never for a heading or a
sentence. Reading always happens in the serif or in sentence-case body.

## 5. Elevation and Material

The system is flat. There is not a single drop shadow in the build. Depth comes
from photography, from hairlines, and from the offset of the spreads.

### Photography as one reel

Every image is graded identically so a stock library reads as one commissioned
shoot: `saturate(0.72) contrast(0.96) sepia(0.09) brightness(1.01)`. The warm
sepia lean ties the imagery to the ivory ground. Photographs bleed to a fixed
aspect ratio (4/5 hero, 16/9 feature, 3/4 and 1/1 in the pair) with no frame,
no rounded corner and no shadow.

### Shadow vocabulary

- **No card shadow.** Surfaces rest on hairlines and the ground, never on a
  drop shadow. The build ships none and neither should any new surface.
- **Focus ring.** A 2px solid bronze outline at a 3px offset, champagne inside
  the dark chapter. An outline, never a glow.

### Material rules

**The Hairline Rule.** A 1px hairline does the work a border or a shadow would
do elsewhere. It opens sections, separates process steps and closes the page.
Add the line before you reach for anything heavier, and never reach past it.

**The One Reel Rule.** All photography carries the same warm grade so the site
reads as one shoot. A raw or cool-toned image breaks the world immediately.

**The Sharp Corners Rule.** Radii are 0 everywhere. Buttons, inputs and images
are square-cornered. The only softened corner in the system is the 1px on a
focus ring. Rounded cards do not exist here.

## 6. Motion: One Reveal

There is a single authored motion, the **reveal**. Content begins fully legible
in its resting state, so a failed script never hides the page, and as it enters
the viewport it lifts from `translateY(14px)` to `0` while opacity moves `0` to
`1`, over `400ms` on `ease-out`. Items are revealed in threes with a `70ms`
stagger capped at `140ms`, so a spread settles in a short cascade rather than
all at once.

Everything else is a quiet colour or border change. Buttons and fields
transition colour over `200ms ease-out`, the nav underline wipes in over
`250ms`, and a pressed button drops `1px` over `100ms`. There is no parallax, no
scroll-scrub, no clip-path reveal and no second entrance.

**Reduced motion.** Under `prefers-reduced-motion: reduce` the reveal is
removed, smooth scrolling drops to auto, and all animation and transition are
switched off. Content is simply present. (This is enforced in the build.)

## 7. Components

### Top strip and nav

A thin top strip of tracked meta (established date, credentials) above a hairline,
then the nav: wordmark with its bronze sub-label at left, primary links centre,
a phone number and one outline CTA at right. The primary links carry a bronze
underline that wipes in from the left on hover. Below 760px the links collapse
behind an outline "Menu" toggle.

### Buttons

- **Outline (default):** 1px ink border, ink text, transparent fill, Archivo
  `0.8125rem` weight 600 tracked `0.14em` uppercase, min-height 44px, square
  corners. Hover fills ink with ivory text. Press drops 1px.
- **Solid:** ink fill, ivory text, used for the primary enquiry action. Hover
  moves to ink-soft.
- **Inside the dark chapter:** the border and text become champagne, and hover
  fills champagne with ink text.

### Quiet link

Small Archivo text with a hairline underline that warms to bronze on hover. The
default way to offer a secondary action beside a button.

### The spread

Each block is a fractional asymmetric grid, not a centred layout: the hero runs
7/5, features run 8/4, pairs run 5/1/4 with the second article dropped by a
`margin-top`, the designer grid runs 4/3/4 with each figure stepped to a
different height. The offset diagonal is the point; never even the columns out.

### Section header

A full-width hairline above a baseline-aligned Fraunces title and a small stone
count or note. This opens journeys, designers and the footer.

### The statement pull line

An oversized Fraunces sentence set in near-empty space with a short thin rule to
its left, one clause carried in italic. This replaces every callout box and
pull-quote panel.

### The process steps

A numbered ordered list on hairline separators, each row a grid of a Fraunces
numeral, a heading and a paragraph. The numbers are earned: the three steps are
a genuine sequence the reader needs in order (a conversation, then a proposal,
then support while travelling), so the numerals inform rather than decorate.

### The designer grid

Three portrait figures at 3/4 ratio, each stepped to a different height, with a
Fraunces name, a stone role-and-years line and a short note. A studio of people,
credited plainly.

### The client quote

A single italic Fraunces blockquote on the ivory-deep band, offset from the left
margin, with a stone citation. One voice, given room, in place of a testimonial
carousel.

### Enquiry form

Inside the dark chapter: labels in tracked champagne caps, inputs as transparent
fields with a champagne-family underline that brightens to champagne on focus,
mist text and ash placeholders (which clear 4.5:1 on ink). One submit button and
a short reassurance note, no newsletter opt-in.

### Footer

The dark ground, the wordmark in ivory with its champagne sub-label, an address,
a plain link list, a protection-and-registration block, and a legal line below a
hairline. The quietest part of the page, a colophon rather than a sitemap.

## 8. Do and Do Not

### Do

- Do keep the ground warm ivory and the ink a warm near-black, never white or
  black, with secondary text tinted stone or mist.
- Do ration the two metals to their grounds: bronze on the light paper,
  champagne inside the dark chapter, chosen by contrast and never swapped.
- Do set every heading in Fraunces, light and given room, using italic for
  emphasis rather than a heavier weight.
- Do lay blocks out as asymmetric fractional spreads with offset column heights,
  opened by a hairline.
- Do grade every photograph on the one warm reel so the imagery reads as a
  single shoot.
- Do keep to the one dark chapter for the working part of the page, palette
  flipped, and one CTA per view.
- Do theme the browser surfaces, selection, caret, scrollbar, focus ring and
  link underline, from bronze and champagne.
- Do honour the single reveal and its reduced-motion path.

### Do Not

- Do not place a small tracked label above a heading. Meta lives in the header
  count, a caption or beside the copy, never as a kicker.
- Do not use champagne for text on ivory or bronze for the dark-chapter accent;
  the metals are fixed to their grounds.
- Do not set Fraunces bold, or let a grotesque sans carry a display line.
- Do not add a drop shadow, a rounded card or a coloured panel. Depth is
  photography, hairlines and offset, and corners are square.
- Do not centre the grid or even the columns. The asymmetric offset is the
  layout's character.
- Do not add a second animation, a parallax or a scroll effect. One reveal only.
- Do not number a sequence that is not truly ordered; the process steps earn
  their numerals because their order carries meaning.
- Do not use pure white, pure black or a flat neutral grey anywhere.
