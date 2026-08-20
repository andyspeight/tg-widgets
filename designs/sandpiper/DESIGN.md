---
name: Sandpiper Holidays
description: A calm, price-clear family travel house. Soft sage ground, deep pine greens, one warm apricot thread, and a warm Lora serif over clean DM Sans, organised around the school-holiday dates every family is already stuck with. White cards carry real prices, the corners are soft, and nothing shouts.
mode: Persuade

colors:
  # Ground and surfaces (soft sage, the whole page rests on it)
  sage: "#DFE8E2"          # page ground
  sage-soft: "#EBF1EC"     # hovered nav pill, faint tint fill
  white: "#FFFFFF"         # every card, chip, panel, input on the light band

  # Brand greens (pine, the voice of every heading and dark surface)
  pine: "#17453A"          # headings, dark pills, the enquiry band, the logo disc
  pine-deep: "#0E332B"     # pressed dark pill, the shadow hue
  pine-mid: "#2E6355"      # icon strokes, focus ring, hovered date-card border

  # Text ramp (warm green-tinted, never flat grey)
  ink: "#152420"           # body copy, ~13:1 on sage
  ink-soft: "#47605A"      # secondary text, captions, placeholders, ~5.5:1 on white

  # The single warm thread
  apricot: "#E8A15D"       # the one accent: selection, stars, the light CTA, the quote rule
  apricot-deep: "#8C5A22"  # tracked meta and the age-badge, a darker apricot that clears contrast

  # Lines
  line: "rgba(21,36,32,.12)"   # hairline dividers and card borders, ink at 12%

fonts:
  display: "Lora, Georgia, serif"
  body: "DM Sans, sans-serif"

typography:
  scale:
    micro: "11px"            # logo sub-label, legal line
    caption: "12.5px"        # chip captions, tracked meta
    label: "13px"            # date span, review meta
    small: "14px"            # age copy, footer, secondary paragraphs
    meta: "15px"             # dark pill, promises, nav quiet link
    body: "16px"             # the reading size
    lead: "16.5px"           # pine-card line, date-card "when"
    subtitle: "18px"         # age headings, the italic blockquote
    price: "23px"            # the Lora price figure on a date card
    figure: "24px"           # Lora proof figure on a chip
    stat: "clamp(30px, 2.6vw, 40px)"   # the hero stat-card figure
    headline: "clamp(27px, 3vw, 40px)" # section headings
    band: "clamp(26px, 3vw, 38px)"     # heading inside the pine enquiry band
    display: "clamp(32px, 3.9vw, 52px)" # the hero h1
  display:
    fontFamily: "Lora, Georgia, serif"
    fontSize: "clamp(32px, 3.9vw, 52px)"
    fontWeight: 600
    lineHeight: 1.13
    letterSpacing: "-0.01em"
    maxWidth: "16ch"
  headline:
    fontFamily: "Lora, Georgia, serif"
    fontSize: "clamp(27px, 3vw, 40px)"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  band:
    fontFamily: "Lora, Georgia, serif"
    fontSize: "clamp(26px, 3vw, 38px)"
    fontWeight: 600
    lineHeight: 1.2
  price:
    fontFamily: "Lora, Georgia, serif"
    fontSize: "23px"
    fontWeight: 600
    lineHeight: 1.15
  figure:
    fontFamily: "Lora, Georgia, serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.1
  blockquote:
    fontFamily: "Lora, Georgia, serif"
    fontSize: "18px"
    fontStyle: "italic"
    fontWeight: 500
    lineHeight: 1.5
  lead:
    fontFamily: "DM Sans, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.6
  body:
    fontFamily: "DM Sans, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.6
  subtitle:
    fontFamily: "DM Sans, sans-serif"
    fontSize: "18px"
    fontWeight: 700
    lineHeight: 1.3
  label:
    fontFamily: "DM Sans, sans-serif"
    fontSize: "12px"
    fontWeight: 700
    letterSpacing: "0.12em"
    textTransform: "uppercase"

spacing:
  3xs: "4px"
  2xs: "8px"
  xs: "12px"
  sm: "14px"
  md: "16px"
  lg: "18px"
  xl: "22px"
  gutter: "clamp(18px, 3.4vw, 44px)"    # the .wrap side padding
  panel-gap: "clamp(26px, 4vw, 64px)"   # column gap inside the big panels
  head-gap: "clamp(30px, 4vw, 48px)"    # section head to content
  panel-pad: "clamp(36px, 5vw, 64px)"   # inner padding of ages / team / band panels
  section: "clamp(56px, 7vw, 96px)"     # vertical rhythm between sections
  max-width: "1360px"
  measure: "56ch"                       # section-head copy width

radii:
  s: "12px"        # inputs and the smallest tiles
  m: "20px"        # every card, chip, stat and side panel
  l: "28px"        # the hero photo, the ages panel, the enquiry band
  pill: "999px"    # nav pills, buttons, badges, the review chip
  focus: "6px"     # the focus-visible outline corner
  fillet: "26px"   # the radius of a carved notch and its fillet corners

motion:
  signature: "reveal-rise"
  duration: "500ms"
  easing: "ease-out"
  transform: "translateY(16px) to translateY(0)"
  opacity: "0 to 1"
  threshold: 0.12
  ui: "200ms ease-out"                 # hover and focus, colour and small transform
  lift: "translateY(-2px)"             # button hover; a date card lifts -4px
  press: "scale(0.97)"                 # button active
  reducedMotion: "all transitions and animations removed, reveal content present, smooth scroll off"
---

# Design World: Sandpiper Holidays

## 1. Overview: Rested Parents, Priced Up Front

Sandpiper is a family holiday specialist, and the site should feel like a calm, capable adviser who has already done the maths. The whole system rests on one idea: take the stress off a parent who is stuck with the school-holiday dates and worried about the cost, and answer both before they ask. The authority comes from being clear and honest, not from being loud. Every headline is warm, every price is a real total, and the page never makes a family hunt for the catch.

The world is a soft sage-green ground carrying white cards, deep pine-green headings in a warm Lora serif, clean DM Sans for everything you read, and a single apricot thread for the one warm accent. Corners are generously rounded. The hero is one honest photograph with real proof carved into its corners. This is the leaner, price-clear family site, not the loud one: no exclamation marks, no confetti, no urgency banners, no jumbo discount flags. The reassurance is the design.

**Key characteristics**

- A soft sage-green ground, calm and warm, never white and never grey.
- White cards on sage, lifted by one soft pine-tinted shadow, with generously rounded corners.
- Deep pine green for every heading and dark surface, the steady adult voice.
- One apricot thread, rationed to the selection, the stars, the light CTA and the quote rule.
- A warm Lora serif for headings, figures and prices, clean DM Sans for all reading and UI.
- Priced school-holiday date cards as the centre of the page, one honest total per card.
- One motion moment, a gentle reveal-rise as content enters, and nothing else.

## 2. The Kit: One Vocabulary For Every Page

Every Sandpiper page is built from the same small set of pieces. Reach for these before inventing anything, and invent only when a page has a genuinely new job to do. Do not reinvent a button, a card or a panel.

- **The white card on sage.** The workhorse surface: `radii.m`, white fill, the one soft shadow. Date cards, stat cards, chips and proof tiles are all this card at different sizes.
- **The priced date card.** The signature unit. A school-holiday name, its span of dates, then one Lora price that is the whole-party total. This is how Sandpiper sells, in place of a generic offer grid.
- **The dark pill and the light pill.** Two buttons only. A pine pill for navigation and quiet CTAs, an apricot pill for the one form submit.
- **The pine panel.** A deep pine-green rounded band (`radii.l`) for the enquiry section, apricot used only for its labels and its button.
- **The soft-rounded photo.** Photography sits in `radii.l` or `radii.m` frames, warmed a touch by the `.ph` filter, never full-bleed to the browser edge.
- **The proof chip.** A small white pill or card carrying one real figure and a short caption, scattered around the hero rather than lined up as a metric row.

If a shape is not covered here it is almost certainly not needed. The instinct to add an urgency badge or a second accent is the instinct to make a calm page shout.

## 3. Colours: Sage, Pine and One Apricot Thread

### Ground and surface

- **Sage** `#DFE8E2`: the page ground. Soft, warm, green-grey, the colour the whole site rests on.
- **Sage Soft** `#EBF1EC`: a faint tint for a hovered nav pill and the quietest fill.
- **White** `#FFFFFF`: every card, chip, panel and light input. The surfaces float on sage, they are not the ground.

### Brand greens

- **Pine** `#17453A`: headings, dark pills, the enquiry band, the logo disc. The steady adult voice of the brand.
- **Pine Deep** `#0E332B`: the pressed state of a dark pill, and the hue inside the one shadow.
- **Pine Mid** `#2E6355`: icon strokes, the focus ring, and the border a date card takes on hover.

### Text

- **Ink** `#152420`: body copy on sage or white, about 13:1. Warm near-black, tinted green, never pure black.
- **Ink Soft** `#47605A`: secondary text, captions and placeholders, about 5.5:1 on white. Tinted from the pine hue so it reads as warm, never flat grey.

### The single thread

- **Apricot** `#E8A15D`: the one accent. Text selection, the review stars, the light CTA fill, the blockquote rule. A warm hello, rationed.
- **Apricot Deep** `#8C5A22`: the darker apricot that carries tracked meta and the age-group badge, where the bright apricot would fail contrast on white.

### Lines

- **Line** `rgba(21,36,32,.12)`: the hairline for dividers, card borders and list rows. Ink at 12 percent, never a hard grey.

### Browser surfaces

Theme every surface the browser would otherwise leave in its defaults, from this palette. The source already sets the first two.

- **Selection**: background `apricot`, text `ink` (from the source).
- **Focus ring**: `3px solid pine-mid` at `3px` offset, `radii.focus` corner (from the source).
- **Caret**: `pine` (derived; match the heading voice on a light field).
- **Scrollbar**: a `pine-mid` thumb on a `sage` track, thin (derived from the palette).
- **Link underline**: pine on hover with `text-underline-offset: 0.2em` (the nav and footer links already underline on hover).

### Colour rules

**One Thread Rule.** Apricot is the only warm accent and it stays rare: selection, the stars, the light CTA, the quote rule, the tracked meta in its deep form. If apricot has spread onto surfaces or headings, pull it back to pine.

**Pine Carries Authority Rule.** Every heading, every dark button and the enquiry band are pine. The seriousness of a family trusting you with their holiday lives in the green, not in the accent.

**Warm Neutrals Rule.** Sage, ink and ink-soft are all tinted from the green hue. Secondary text is warm green-grey, never a cold system grey, and the ground is sage, never white and never charcoal.

**Honest Contrast Rule.** Body and placeholder text clear 4.5:1: ink-soft on white is about 5.5:1, and apricot-deep replaces bright apricot wherever meta sits on a light surface.

## 4. Typography: Lora Warms, DM Sans Reads

**Display and figures:** Lora, Georgia, serif, weight 600, letter-spacing `-0.01em`. The warm serif carries every heading, every big proof figure and every price. It is the reassuring, human voice of the house.

**Reading and UI:** DM Sans, sans-serif. It runs body copy, controls, captions, age headings and the footer. It stays clean and out of the way so Lora never has to work at small sizes.

The pairing is the whole typographic story: a warm serif for the feeling and the numbers, a clean sans for the facts. Prices and proof are set in Lora on purpose, so the figure a parent cares about most reads as considered, not as a spreadsheet cell.

### Hierarchy

- **Display (hero h1)**: Lora, `clamp(32px, 3.9vw, 52px)`, weight 600, line-height 1.13, wrapped at about 16ch so it breaks into three calm lines.
- **Headline (section h2)**: Lora, `clamp(27px, 3vw, 40px)`, weight 600, line-height 1.2.
- **Band headline**: Lora, `clamp(26px, 3vw, 38px)`, weight 600, in off-white on the pine band.
- **Price**: Lora, `23px`, weight 600, the whole-party total on a date card.
- **Figure**: Lora, `24px` on a chip, or `clamp(30px, 2.6vw, 40px)` on a hero stat card.
- **Blockquote**: Lora italic, `18px`, weight 500, on ink-soft with an apricot left rule.
- **Subtitle (age headings)**: DM Sans, `18px`, weight 700, in ink, with the age range trailing in apricot-deep.
- **Body**: DM Sans, `16px`, weight 400, line-height 1.6.
- **Small and meta**: DM Sans, `13px` to `15px`, on ink-soft.
- **Label**: DM Sans, `12px`, weight 700, uppercase, letter-spacing `0.12em`, on apricot. Reserved for form field labels only.

### Typography rules

**Lora Owns The Numbers Rule.** Prices, proof figures and phone numbers are Lora, not DM Sans. The number a family is weighing up is set in the warm serif so it reads as a considered promise.

**Serif Sets The Warmth Rule.** Only Lora gets to be large. The headline range holds its `-0.01em` tracking so the serif stays warm and settled, never tight or cold.

**Clean Sans For Facts Rule.** Everything a parent must read, dates, ages, small print, the total's caption, is DM Sans at 1.6 line-height and clears 4.5:1. Reading copy is never set in the serif.

## 5. Elevation and Material

The system is mostly flat, lifted by one soft shadow and one hairline. Depth comes from a white card resting on sage, not from stacked layers.

### The one shadow

- **Card shadow:** `0 14px 34px -16px rgba(14,51,43,.28)`. A single soft, pine-tinted lift used on every raised white card, chip, stat and photo. It is the same shadow everywhere, so nothing on the page floats higher than anything else.

### Rounded, not sharp

This world is soft-cornered by design. Radii climb `12px` for inputs, `20px` for cards and chips, `28px` for the hero photo and the big panels, and `999px` for pills and badges. Sharp corners belong to a different, colder world.

### The carved notch

The hero photograph has its proof carved out of its own corners: sage-coloured notches with `26px` fillet corners sit in the photo, so the caption, the stat card and the proof stack read as cut from the same image rather than pasted over it. This is the one bespoke material moment, and it collapses to a simple stack on narrow screens.

### Material rules

**One Shadow Rule.** There is exactly one shadow value. Do not invent a second, harder or larger drop shadow to make an element stand out; if it needs more presence, give it the pine border or more space.

**Card On Sage Rule.** A raised surface is white on the sage ground with the one shadow. Depth is the tone step from sage to white, not a heavy border or a glow.

**Soft Corners Rule.** Radii follow the `s / m / l / pill` ladder. A right-angled corner on a card or a button belongs to a louder, harder world, not this one.

**Hairline First Rule.** A `line` hairline does the work of a divider or a list rule. Add the line before you add a heavier border.

## 6. Motion: One Gentle Reveal

There is a single authored motion, the **reveal-rise**. Content begins fully legible in its resting state, so a failed script never hides the page, and as an element enters the viewport it lifts from `translateY(16px)` to `0` while opacity moves `0` to `1`, over `500ms` on `ease-out`. An IntersectionObserver triggers it once at a `0.12` threshold, then stops watching. It is calm and quick, a settle rather than a performance.

Hover and focus are the only other movement: buttons and cards shift colour and lift by `translateY(-2px)` (a date card by `-4px`) over `200ms ease-out`, and a pressed button dips to `scale(0.97)`. There is no parallax, no scroll-scrub, no second entrance animation and no auto-playing carousel.

**Reduced motion.** Under `prefers-reduced-motion: reduce` every transition and animation is removed, the reveal content is simply present, and smooth scrolling is turned off. The source already ships this path in both CSS and the observer script.

## 7. Components

### The priced date card

A white card, `radii.m`, a `2px` transparent border, holding a school-holiday name, its date span in ink-soft, and one Lora price that is the total for the whole party. On hover it lifts `-4px`, the border becomes pine-mid and the one shadow appears. Four across on desktop, two on tablet, one on mobile. This is the centre of the page, so the price is always a real inclusive total and always names who it covers.

### Buttons

- **Dark pill:** pine fill, off-white text, `radii.pill`, min-height 48px, DM Sans 600. Hover deepens to pine-deep and lifts `-2px`; active dips to `scale(0.97)`. The everyday CTA and the nav quote button.
- **Light pill:** apricot fill, ink text, `radii.pill`, min-height 50px, DM Sans 700. Hover lightens the apricot and lifts `-2px`. Reserved for the one enquiry submit on the pine band.

One light pill per page. Every other action is a dark pill or a plain text link.

### Nav pills

A white rounded rail holding three text links; the active one takes a pine fill, the rest tint to sage-soft on hover. It collapses to a single menu toggle button under 980px, opening a white rounded mobile sheet.

### The enquiry band

A deep pine panel, `radii.l`, holding the heading in off-white and a short form. Inputs are translucent off-white on pine with a `radii.s` corner; labels are uppercase apricot at `label` size; the submit is the one light pill. The band's copy promises a same-day human reply, and the design keeps that promise calm, no countdown and no forced urgency.

### The age-group list

A white panel with a photo and a list of age bands. Each row is a sage circle icon, a DM Sans 700 heading with the age range in apricot-deep, a line of plain copy, and a round outline "go" control that fills pine and nudges right on hover. Rows are separated by the `line` hairline.

### Proof chips

Small white cards and pills carrying one real figure in Lora and a short caption in ink-soft: a review chip with stacked faces and apricot stars, a percentage stat card, a years-of-service chip. They are scattered around the hero, never lined up as a single metric row.

### Icons

One line-icon set, roughly `1.7` stroke weight, drawn in pine-mid or currentColor, `20px` on a `20px` box. Never emoji, never a unicode glyph in place of a real icon.

### Footer

Sage ground, a four-column link grid over a `line` hairline, the wordmark and a short line about the office, and two protection badges (ATOL, ABTA) as white pills. The quiet, trustworthy close of the page.

## 8. Do and Do Not

### Do

- Do lead with the priced school-holiday date cards, each one a real inclusive total that names who it covers.
- Do set every heading, figure, price and phone number in Lora, and everything you read in DM Sans.
- Do rest white cards on the sage ground and lift them with the one soft pine-tinted shadow.
- Do keep apricot to the one thread: selection, the stars, the light CTA, the quote rule, and apricot-deep for meta.
- Do use pine for every heading, dark button and the enquiry band.
- Do round every corner on the `s / m / l / pill` ladder; soft corners are the house.
- Do theme the browser surfaces, selection, caret, scrollbar, focus ring and link underline, from this palette.
- Do tint every neutral from the green hue, so secondary text reads warm, never flat grey.
- Do honour the one reveal-rise and its reduced-motion path.
- Do keep the tone reassuring: plain UK English, warm, honest, no exclamation marks.

### Do Not

- Do not add urgency devices, countdowns, "only 2 left", discount starbursts or flashing banners. This is the calm, price-clear family site, not the loud one.
- Do not introduce a second accent colour or spread apricot across surfaces and headings.
- Do not use pure black, pure white as the ground, or a cold system grey. The world is sage, pine, ink and apricot.
- Do not set prices or figures in DM Sans; the numbers a family weighs up are Lora.
- Do not give a card a second, harder shadow or a right-angled corner to stand out; use the pine border and more space.
- Do not add a second animation, parallax, scroll-scrub or an auto-playing carousel. One reveal-rise only.
- Do not hide a real total behind "from" pricing that omits who it covers or what is included.
