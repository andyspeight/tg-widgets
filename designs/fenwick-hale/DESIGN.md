---
name: Fenwick & Hale
description: A scholarly cultural-touring house set as its own annual prospectus. Aubergine ink on warm dove paper, two disciplined golds, a grotesque sans that carries every heading against a literary serif that does all the reading, section-numbered like a brochure spine, with photography mounted as museum plates.
mode: Persuade

colors:
  # Ink (aubergine, the house colour, printed dark)
  plum: "#3B2537"          # headings, the mark, primary button fill, top rules
  plum-deep: "#2C1B29"     # top strip, footer, hovered button, deepest band
  # Paper (warm dove, the ground and its surfaces)
  dove: "#E8E4E1"          # page ground, ink-band text
  dove-light: "#F2F0EE"    # raised paper: plates, panels, contents strip, inputs on dark
  dove-deep: "#DED8D4"     # the one recessed band (terms of travel)
  # Text
  graphite: "#2A272B"      # body copy on paper, ~13:1
  muted: "#5C5560"         # captions, notes, secondary meta, ~5:1 on dove
  # The two golds (never interchangeable)
  gold: "#C9A45C"          # bright gold, on plum grounds only, and as rules on ink
  gold-ink: "#7A5F28"      # gold as text on paper: labels, plate numbers, numerals, ~5:1
  # Rules (all derived from graphite or dove at alpha)
  rule: "rgba(42, 39, 43, .24)"          # the default hairline on paper
  rule-strong: "rgba(42, 39, 43, .55)"   # active rule, table region divider, input border
  rule-light: "rgba(232, 228, 225, .28)" # the hairline on plum grounds

fonts:
  display: "Albert Sans, \"Helvetica Neue\", sans-serif"   # every heading, all UI, all tracked caps
  read: "Literata, Georgia, serif"                          # body, ledes, italic captions, all numerals

typography:
  scale:
    micro: "11px"       # folio labels, plate numbers, "leads" caps
    label: "12px"       # tracked caps meta, table headers, region rules
    eyebrow: "12.5px"   # the gold-ink section label above a note (see not-canonized)
    small: "13.5px"     # captions, top strip, post-notes
    meta: "14.5px"      # table dates, credentials, quiet italics
    detail: "15.5px"    # nav, buttons, day-cell body, band bios
    body: "17px"        # the reading size, Literata
    lede: "19px"        # hero standfirst
    daynum: "26px"      # itinerary day numerals, Literata
    wordmark: "27px"    # the masthead lockup
    headline: "clamp(25px, 2.8vw, 34px)"  # section titles
    folio: "52px"       # the big prospectus section numeral, Literata
    hero: "clamp(33px, 3.8vw, 50px)"      # the hero line
  hero:
    fontFamily: "Albert Sans, \"Helvetica Neue\", sans-serif"
    fontSize: "clamp(33px, 3.8vw, 50px)"
    fontWeight: 700
    lineHeight: 1.12
    letterSpacing: "-0.012em"
  folio:
    fontFamily: "Literata, Georgia, serif"
    fontSize: "52px"
    fontWeight: 400
    lineHeight: 1
    fontVariantNumeric: "lining-nums"
  headline:
    fontFamily: "Albert Sans, \"Helvetica Neue\", sans-serif"
    fontSize: "clamp(25px, 2.8vw, 34px)"
    fontWeight: 700
    lineHeight: 1.16
    letterSpacing: "-0.01em"
  lede:
    fontFamily: "Literata, Georgia, serif"
    fontSize: "19px"
    fontWeight: 400
    lineHeight: 1.68
  body:
    fontFamily: "Literata, Georgia, serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.62
  daynum:
    fontFamily: "Literata, Georgia, serif"
    fontSize: "26px"
    fontWeight: 500
    lineHeight: 1
    fontVariantNumeric: "lining-nums"
  caption:
    fontFamily: "Literata, Georgia, serif"
    fontSize: "13.5px"
    fontStyle: "italic"
    lineHeight: 1.5
  wordmark:
    fontFamily: "Albert Sans, \"Helvetica Neue\", sans-serif"
    fontSize: "27px"
    fontWeight: 700
    letterSpacing: "0.045em"
  label:
    fontFamily: "Albert Sans, \"Helvetica Neue\", sans-serif"
    fontSize: "12px"
    fontWeight: 700
    letterSpacing: "0.16em"
    textTransform: "uppercase"

spacing:
  3xs: "3px"
  2xs: "6px"
  xs: "10px"
  sm: "14px"
  md: "18px"
  lg: "26px"
  xl: "34px"
  2xl: "48px"
  3xl: "64px"
  section: "78px"          # vertical rhythm between prospectus sections
  hero-top: "72px"
  gutter: "40px"           # plates grid gap
  page-margin: "48px"      # 22px below 720px
  max-width: "1200px"
  measure: "62ch"          # notes and reading copy cap at 54-66ch

radii:
  none: "0"          # tables, plates, panels, bands
  hair: "1px"        # focus outline corner only
  sm: "2px"          # buttons, inputs, the solo flag

motion:
  signature: "hero-rise"
  duration: "700ms"
  easing: "ease-out"
  transform: "translateY(14px) to translateY(0)"
  opacity: "0 to 1"
  stagger: "120ms"                         # the plate lifts a beat after the text
  ui: "200ms ease-out"                     # nav underline and button fill only
  scroll: "smooth"                         # in-page anchors, dropped under reduced motion
  reducedMotion: "all animation and transition removed, scroll-behavior auto, content simply present"
---

# Design World: Fenwick & Hale

## 1. Overview: The Annual Prospectus

Fenwick & Hale is a house of small-group cultural tours led by scholars, and the site should read like the printed prospectus it names itself after, not a booking funnel. The whole system rests on one idea: this is a considered document you would read with a pencil, published annually, numbered and set in full before anyone books. Authority comes from completeness and restraint, the way a good brochure earns trust by naming every hotel and every walking note rather than by shouting a saving.

The world is aubergine ink on warm dove paper. A grotesque sans, Albert Sans, carries every heading and all the tracked-caps machinery of a prospectus. A literary serif, Literata, does all the reading and carries every numeral, so prices, day numbers and section folios sit in an old-style book face while the headings stay modern and plain. Colour is disciplined to two families, a plum ink and a dove paper, with two golds held apart by where they may appear. Photography is mounted as museum plates, print-graded, and the page is spined by section numbers that match a contents strip, because the sequence is genuine navigation the reader uses.

**Key characteristics**

- Two-tone by law: plum ink, dove paper, and nothing outside those two families but the golds.
- Two golds that never swap grounds: bright gold on plum only, deep gold-ink as text on paper.
- Albert Sans is the display and UI voice, the reverse of a serif-led house; Literata carries reading and every figure.
- A numbered prospectus spine, sections 01 to 05, mirrored by a contents strip, because the order is real navigation.
- Photography mounted as museum plates: a paper mount, a hairline, a print grade, an italic caption with a gold-ink plate number.
- Rules do the structural work. A 3px plum rule over a 1px hairline heads every section.
- Two ink bands (lecturers, order the brochure) invert the page to plum ground with dove text and bright gold.
- One restrained motion moment, a hero rise, and nothing else moves.

## 2. The Kit: One Prospectus Vocabulary

Every Fenwick & Hale page is set from the same small kit. Reach for these before inventing anything, and invent only for a genuinely editorial moment such as a new plate or a bespoke table.

- **The section spine.** A numbered `sec-head`: a big Literata folio numeral in gold-ink with an Albert Sans "SECTION" label above it, beside an Albert Sans title and a serif note, all sitting under a 3px plum rule doubled by a 1px hairline. This heads every section and is echoed by the contents strip.
- **The collection table.** The house's central object is a real tabular price list, region-grouped, with Literata tour numbers and prices and Albert Sans dates and party sizes. It stacks to labelled rows on narrow screens, never to cards.
- **The museum plate.** Every photograph is a `figure.plate`: a dove-light mount, a 1px rule, a flat 1px shelf shadow, a print grade on the image, and an italic caption led by a gold-ink plate number.
- **Ink bands.** A section may invert to a plum ground (lecturers, brochure order). On ink, text is dove, rules go to `rule-light`, the section rule and folio switch to bright gold, and focus rings switch to gold.
- **Type roles.** Headings, navigation, buttons, labels and all tracked caps are Albert Sans. Body, ledes, captions, credentials and every numeral are Literata. The italic serif is the quiet aside voice throughout.
- **One button.** A filled plum button for the primary act (order the brochure), a ghost outline for the secondary, and a plain quiet link for everything else.

If a shape is not in this kit it is almost certainly not needed. The instinct to add a coloured card is the instinct of a discounter, and this house is a scholar.

## 3. Colours: Ink and Paper, Two Golds

### Ink

- **Plum** `#3B2537`: the house ink. Headings, the wordmark, the primary button fill, the 3px section rules, tour titles in the table.
- **Plum Deep** `#2C1B29`: the top strip, the footer, a hovered button, the deepest ground.

### Paper

- **Dove** `#E8E4E1`: the page ground, and the text colour on ink bands.
- **Dove Light** `#F2F0EE`: raised paper. Plate mounts, the contents strip, panels, note boxes, and the inputs on the dark order band.
- **Dove Deep** `#DED8D4`: the one gently recessed band, Terms of Travel.

### Text

- **Graphite** `#2A272B`: body copy on paper, about 13:1. Warm near-black, never a cold grey.
- **Muted** `#5C5560`: captions, section notes, credentials and secondary meta, about 5:1 on dove. Tinted toward the plum hue so it never reads as flat gray.

### The two golds

- **Gold** `#C9A45C`: bright gold. It appears on plum grounds only, and as rules on ink. The section rule and folio on an ink band, a caption's plate number on ink, a focus ring on ink, the footer headings.
- **Gold Ink** `#7A5F28`: gold as text on paper, about 5:1 on dove. Labels, plate numbers, table tour numbers, the itinerary day numeral, the wordmark ampersand.

### Rules

- **Rule** `rgba(42, 39, 43, .24)`: the default hairline on paper, under the plum section rule and between table rows.
- **Rule Strong** `rgba(42, 39, 43, .55)`: an active or heavier divider, the table region rule, the input border.
- **Rule Light** `rgba(232, 228, 225, .28)`: the hairline on plum grounds, where a graphite rule would vanish.

### Browser surfaces

The source themes the focus ring and the link underline. Derive the rest from the palette in the same spirit.

- **Focus ring** (from source): 2px solid `plum`, `outline-offset: 3px`, `border-radius: 1px`. On plum bands it switches to `gold`.
- **Link underline** (from source): `text-decoration-thickness: 1px`, `text-underline-offset: 3px`, link in `plum`, hover in `plum-deep`.
- **Selection** (derive): background `rgba(59, 37, 55, .14)` (a plum wash), text `graphite`; on ink bands, a `gold` wash at low alpha with dove text.
- **Caret** (derive): `plum` on paper, `gold` on ink.
- **Scrollbar** (derive): a `plum-deep` thumb on a `dove-deep` track, thin.
- **Numerals**: every figure uses Literata with `font-variant-numeric: lining-nums`, and table quantities use `tabular-nums`, so prices and party sizes align down a column.

### Colour rules

**The Two Golds Rule.** Bright gold `#C9A45C` may touch a plum ground only, as rules, folios and marks on ink. Gold as text on paper is always the deeper gold-ink `#7A5F28`, for contrast. Never set bright gold as text on dove, and never carry gold-ink onto an ink band.

**The Ink and Paper Rule.** Plum is the ink and dove is the paper. Surfaces are paper tones, type and structure are plum. There is no third hue and no coloured card. A band earns emphasis by inverting to plum, not by tinting.

**The Warm Neutral Rule.** Every neutral is tinted warm toward the plum hue. Secondary text is the muted plum-grey, never a flat cold gray, and the ground is warm dove paper, never white and never charcoal.

## 4. Typography: Albert Sans Heads, Literata Reads

**Display and UI:** Albert Sans, "Helvetica Neue", sans-serif. A clean grotesque sans at weights 500 to 700. It carries every heading, the wordmark, navigation, buttons, table headers and all tracked-caps meta. This is the unusual move for a scholarly house: the plain modern sans is the loud voice, not the serif.

**Reading:** Literata, Georgia, serif. A literary book serif built for long reading. It sets body copy at 17px on 1.62, the hero lede, every italic caption and quiet aside, and crucially every numeral on the page. The folios, day numbers, tour numbers and the italic issue lines are all Literata, so the figures read like a printed brochure.

The tension is deliberate and it is the reverse of the obvious choice. The sans keeps the headings and the machinery matter-of-fact, and the serif keeps the reading and the numbers warm and considered.

### Hierarchy

- **Hero line**: Albert Sans, `clamp(33px, 3.8vw, 50px)`, weight 700, line-height 1.12, letter-spacing `-0.012em`, capped near 16ch.
- **Section folio**: Literata, `52px`, weight 400, lining figures, in gold-ink (bright gold on ink bands), with an Albert Sans "SECTION" label at `11px`/`.2em` above it.
- **Section title**: Albert Sans, `clamp(25px, 2.8vw, 34px)`, weight 700, line-height 1.16, letter-spacing `-0.01em`, in plum.
- **Lede**: Literata, `19px`, weight 400, line-height 1.68, capped near 54ch.
- **Body**: Literata, `17px`, weight 400, line-height 1.62, graphite, notes capped near 62ch.
- **Day numeral**: Literata, `26px`, weight 500, lining figures, gold-ink.
- **Wordmark**: Albert Sans, `27px`, weight 700, letter-spacing `0.045em`, plum with a gold-ink ampersand.
- **Label and meta**: Albert Sans, `12px`, weight 700, uppercase, letter-spacing `0.16em` to `0.2em`, on muted or gold-ink.
- **Caption and aside**: Literata italic, `13.5px` to `16.5px`, muted.

### Typography rules

**The Heading Is Sans Rule.** Every `h1`, `h2` and `h3` is Albert Sans. The serif never becomes a display voice, and the sans never carries a numeral. Keep the roles clean: sans heads and labels, serif reads and counts.

**The Numerals Are Literata Rule.** Prices, party sizes, dates, folios and day numbers are set in Literata with lining figures, tabular where they stack in a column. A price in a sans figure would read like a supermarket shelf edge.

**The Tracked Caps Belong To The Machinery Rule.** Uppercase tracked labels are for the prospectus furniture only, the folio label, table headers, the issue bar, the plate number, the footer headings. They carry structure, not persuasion, and they sit within the furniture, not as a kicker over a heading.

## 5. Elevation and Material: Mounted Plates and Ruled Paper

The system is flat like a printed page. Depth comes from mounts, rules and the print grade, never from soft floating shadows.

### The museum plate

Every photograph is mounted, not bled to the edge.

- **The mount.** A `dove-light` mat with `13px` of padding and a 1px `rule` border, so each image sits inside a paper frame.
- **The shelf shadow.** A single flat `0 1px 0 rgba(42,39,43,.12)`, a printed hairline of a shadow, never a soft blur. On ink bands the mount border and shadow go translucent to suit the dark ground.
- **The print grade.** Every image carries `saturate(.8) contrast(1.05) sepia(.07) brightness(.99)`, a restrained warm print look so the photography reads as one collection, never as bright stock.
- **The caption.** Italic Literata in muted, led by an Albert Sans `plate-no` in gold-ink tracked caps: Frontispiece, Plate I, Plate II.

### The ruled page

- **The double section rule.** Every section head is a 3px plum rule with a 1px hairline set 5px below it, the double rule of a title page. On ink bands the top rule becomes bright gold.
- **Hairline grids.** The itinerary day grid and the terms list are built from `rule` hairlines alone, a ledger drawn in fine lines rather than boxed cards.
- **The recessed band.** Terms of Travel drops to `dove-deep`, one quiet step into the page. Ink bands (lecturers, brochure) invert fully to plum.

### Material rules

**The Mounted Plate Rule.** Photography is always matted, hairlined, print-graded and captioned with a plate number. No edge-to-edge bleed, no full-viewport hero image, no uncaptioned photograph.

**The Hairline First Rule.** Structure is drawn with rules before anything heavier. A 3px plum rule heads a section, a 1px hairline divides rows. Reach for a line before a border, and a border before a fill.

**The Flat Page Rule.** The only shadow in the world is the plate and panel `0 1px 0` shelf line. No soft drop shadows, no glow, no glass, no rounded floating cards. Corners are square everywhere but buttons and inputs, which take 2px.

## 6. Motion: One Restrained Entrance

There is a single authored motion, the **hero rise**, and it is confined to the hero. Content begins fully legible in its resting state, and on load each hero child lifts from `translateY(14px)` to `0` while opacity moves `0` to `1`, over `700ms` on `ease-out`. The plate is the second child and starts `120ms` after the text, so the words settle first and the photograph follows a beat behind.

Nothing else animates. In-page anchor links scroll smoothly, navigation underlines and button fills transition over `200ms ease-out`, and that is the whole motion vocabulary. There is no scroll reveal on later sections, no parallax on the plates, no counter, no carousel.

**Reduced motion.** Under `prefers-reduced-motion: reduce` all animation and transition are removed, `scroll-behavior` drops to auto, and content is simply present in its resting state.

**The One Entrance Rule.** The hero rise is the only entrance on the page. Do not bolt it onto later sections, and do not add a second gesture. A prospectus does not animate as you turn its pages.

## 7. Components

### Masthead and issue bar

The wordmark is the Albert Sans lockup, plum with a gold-ink ampersand, over a Literata italic tagline in muted. Navigation is Albert Sans 600 with a gold underline on hover drawn by a 2px bottom border. Below it, the issue bar is a double plum rule carrying tracked-caps prospectus lines (the issue title, the series number, the place and date of publication), with an italic Literata phrase set inside the caps run.

### The contents spine

A `dove-light` strip of tracked-caps links, each numbered in a Literata gold-ink figure, divided by hairlines. It mirrors the five section folios exactly, so the number a reader sees in the strip is the number that heads the section. This is genuine navigation the sequence carries, not decoration.

### The section head

A two-column grid: a `110px` folio column (the Literata numeral with its "SECTION" label) beside the title, note and body. Headed by the double plum rule. On ink bands the rule and folio turn bright gold and the title turns dove-light.

### The collection table

The central object. A region-grouped price table: Literata tour numbers in gold-ink, Albert Sans 700 tour titles in plum with an italic Literata guide credit beneath, Albert Sans dates and party sizes, and a Literata plum price with a muted "incl. flights" line. Region rows are tracked plum caps over a `rule-strong` divider. Rows tint to `dove-light` on hover. A solo place is flagged with a small gold-ink italic outline chip. Below 860px the header is hidden and each row restacks to labelled lines using `data-label`, never to a card.

### The museum plate

As set out in section 5: mounted, hairlined, print-graded, shelf-shadowed, with an italic caption and a gold-ink plate number. Plates arrange on a stepped 12-column grid with offset top margins so they sit like a print layout, and stack to one or two columns on narrow screens.

### The lecturer band (ink)

A plum-ground band. A three-column ruled row per lecturer: name and credential, biography in dove at reduced opacity, and a right-aligned "LEADS" list in tracked caps with a bright-gold sub-label. Rules are `rule-light`, credentials are Literata italic in bright gold, and focus rings switch to gold.

### The itinerary day grid

A two-column hairline grid of day cells. Each cell opens with a Literata gold-ink day numeral and its "DAY" label, an Albert Sans plum sub-heading and a short Literata note. Beside it, a paper `itinerary-note` box and a plum-ruled "On pace" aside. It collapses to a single column below 600px.

### Buttons and links

- **Primary:** filled `plum`, `dove-light` text, 2px radius, Albert Sans 600. Hover deepens to `plum-deep`; active nudges `translateY(1px)`.
- **Ghost:** transparent with a 1px plum border and plum text; hover fills with a faint plum wash.
- **Quiet link:** Albert Sans 600 with a trailing arrow, no underline until wanted. The default secondary act.

### The order form (ink)

On the plum brochure band, a `dove-light` paper form. Albert Sans caps labels in plum, Literata 16px inputs on white with a `rule-strong` border and 2px radius, a full-width filled button, and an italic post-note. Focus rings on this band switch to gold. Placeholder text sits in muted so it clears 4.5:1 on the white field. Beside it, a plate and a call card with a large Albert Sans phone number in dove-light.

### Footer

`plum-deep` ground, the wordmark in Albert Sans dove-light, column headings in bright-gold tracked caps, links in dove at reduced opacity brightening on hover, and a hairline `rule-light` legal line. Protection marks (ABTA, ATOL, established 1989) are stated plainly, the trust a touring house actually trades on.

## 8. Do and Do Not

### Do

- Do set the page as a numbered annual prospectus: sections 01 to 05, a matching contents spine, an issue bar, folios in Literata.
- Do keep the palette to plum ink and dove paper, adding only the two golds.
- Do hold the two golds apart: bright gold on plum grounds and as rules on ink, deep gold-ink as text on paper.
- Do head every section with the double plum rule and a Literata folio.
- Do mount every photograph as a museum plate, print-graded, hairlined and captioned with a gold-ink plate number.
- Do set every numeral in Literata with lining figures, tabular where it stacks in a column.
- Do let the collection table be a real table that restacks to labelled rows, never cards.
- Do invert a band to plum when it needs weight, and switch its rules and folio to gold.
- Do theme the browser surfaces, the focus ring, link underline, selection, caret and scrollbar, from the plum and gold palette.
- Do honour the single hero rise and its reduced-motion path.

### Do Not

- Do not introduce a third hue or a coloured card. Emphasis is an ink band, not a tint.
- Do not set bright gold as text on paper, or carry gold-ink onto a plum band. The golds do not swap grounds.
- Do not set a heading in the serif or a numeral in the sans. Albert Sans heads and labels, Literata reads and counts.
- Do not bleed photography edge to edge or leave a plate uncaptioned. Every image is mounted.
- Do not add discounter furniture: no sale badges, no strikethrough prices, no countdowns, no urgency banners, no five-star rating widgets.
- Do not use bright saturated stock photography. The print grade holds the whole collection to one restrained warm look.
- Do not soften the page with drop shadows, glass, glow or rounded floating cards. The only shadow is the 1px plate shelf line.
- Do not add a second animation or a scroll reveal on later sections. One hero rise only.
- Do not open a section or the hero with a tracked-caps kicker above the heading. Meta belongs to the folio, the issue bar and the plate number, inside the prospectus furniture, never as an eyebrow.
