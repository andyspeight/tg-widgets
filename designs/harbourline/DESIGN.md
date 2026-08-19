---
name: Harbourline Cruise Co.
description: A deep-water cruise specialist that keeps its books in the open. Night-navy grounds banded against paper white, one warm gold thread that draws the rules and marks the price, a reading serif over a plain humanist sans, and every offer laid out as a straight ledger — itinerary night by night, cabin by cabin, fare itemised before a deposit is paid.
mode: Persuade

colors:
  # Navy grounds (the deep water the site sails on)
  navy: "#0A1C33"          # dominant page surface
  navy-deep: "#071426"     # footer and console band, the deepest inset
  navy-panel: "#0E2440"    # raised panels on navy: console, value card
  navy-line: "#24384F"     # hairlines and dividers on navy

  # Paper grounds (the white sections between the navy bands)
  white: "#FFFFFF"         # bright section ground
  bone: "#F7F5F0"          # soft-white section variant and photo wells
  rule: "#DDD8CE"          # warm hairline on paper

  # Ink text (on paper grounds)
  ink: "#22303F"           # body on white, a navy-tinted near-black
  ink-soft: "#51606F"      # secondary text on white

  # Sea text (on navy grounds)
  paper-text: "#E9EEF4"    # primary text on navy
  sea-text: "#9FB0C4"      # secondary text on navy
  sea-faint: "#7C90A6"     # dimmest tier: legal line in the footer

  # The one gold thread (three tints so it stays legible on every ground)
  gold: "#C9A24B"          # the accent fill: buttons, top-rules, checkbox
  gold-bright: "#D9B25F"   # gold labels and focus ring on navy
  gold-ink: "#8A6626"      # gold-toned text on white, holds AA

fonts:
  display: "'Source Serif 4', Georgia, serif"
  body: "'PT Sans', Arial, sans-serif"

typography:
  scale:
    micro: "10px"       # wordmark subline, the widest tracking
    label: "12px"       # tracked caps: kickers, day markers, field labels
    caption: "13.5px"   # captions, facts, fine print, notes
    meta: "14.5px"      # section asides, console copy, footer body
    ui: "16px"          # nav, buttons, list rows
    body: "16.5px"      # the reading size
    lede: "17.5px"      # hero lede
    subtitle: "21px"    # port names, hero-aside serif line
    title: "24px"       # cabin names, value figures
    console: "26px"     # the finder console heading
    price: "30px"       # the largest ledger figure
    section: "clamp(28px, 3.2vw, 40px)"  # section headings
    display: "clamp(38px, 4.6vw, 62px)"  # the hero headline
  display:
    fontFamily: "'Source Serif 4', Georgia, serif"
    fontSize: "clamp(38px, 4.6vw, 62px)"
    fontWeight: 600
    lineHeight: 1.08
    letterSpacing: "-0.01em"
  section:
    fontFamily: "'Source Serif 4', Georgia, serif"
    fontSize: "clamp(28px, 3.2vw, 40px)"
    fontWeight: 600
    lineHeight: 1.12
    letterSpacing: "-0.005em"
  console-title:
    fontFamily: "'Source Serif 4', Georgia, serif"
    fontSize: "26px"
    fontWeight: 600
    lineHeight: 1.2
  serif-figure:
    fontFamily: "'Source Serif 4', Georgia, serif"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: 1.25
  price:
    fontFamily: "'Source Serif 4', Georgia, serif"
    fontSize: "30px"
    fontWeight: 700
    lineHeight: 1
  lede:
    fontFamily: "'PT Sans', Arial, sans-serif"
    fontSize: "17.5px"
    fontWeight: 400
    lineHeight: 1.55
  body:
    fontFamily: "'PT Sans', Arial, sans-serif"
    fontSize: "16.5px"
    fontWeight: 400
    lineHeight: 1.65
  label:
    fontFamily: "'PT Sans', Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.18em"
    textTransform: "uppercase"
  wordmark:
    fontFamily: "'Source Serif 4', Georgia, serif"
    fontSize: "27px"
    fontWeight: 600
    letterSpacing: "0.01em"

spacing:
  3xs: "4px"
  2xs: "8px"
  xs: "12px"
  sm: "18px"       # the default grid gap
  md: "26px"       # gap between cards and ledger rows
  lg: "36px"       # wrap side padding, column gaps
  xl: "48px"       # hero column gap
  2xl: "64px"      # large internal gaps, spotlight columns
  3xl: "72px"      # specialist grid gap
  row: "26px"      # vertical padding inside a ledger row
  section: "clamp(88px, 9vw, 96px)"  # vertical rhythm between bands
  gutter: "36px"
  page-margin: "36px"   # 20px under 640px
  max-width: "1280px"
  measure: "56ch"       # lede and intro cap; body copy 52ch

radii:
  none: "0"    # every surface: panels, cards, buttons, inputs, tags, images. Square throughout.

motion:
  signature: "reveal (fade-rise)"
  duration: "550ms"
  easing: "ease-out"
  transform: "translateY(20px) to translateY(0)"
  opacity: "0 to 1"
  stagger: "80ms"     # delays 80 / 160 / 240ms on d1 / d2 / d3
  threshold: "0.12"   # IntersectionObserver trigger
  hero-drift: "scale(1.05) to scale(1) over 16s ease-out, plays once on load"
  ui: "180ms ease-out"          # button colour and press
  nav-underline: "200ms ease-out"
  photo-zoom: "350ms ease-out"  # port and thumb hover lift
  reducedMotion: "all animation and transition removed, reveals shown, hero image static, scroll-behavior auto"
---

# Design World: Harbourline Cruise Co.

## 1. Overview: The Purser's Ledger

Harbourline is an independent cruise specialist that has been booking sailings out of Southampton since 2004, and the site should feel the way an honest quote from them feels: deep, calm and completely itemised. The whole system rests on one idea. A cruise fare has a reputation for hidden extras, so Harbourline earns trust by putting the whole book in the open — the nights, the ports, what the cabin costs a night, what the fare covers and what it does not. The authority comes from the straightness of the ledger, not from a hard sell.

The world is a night-navy ground banded against paper white and a soft bone, with one warm gold thread that draws the rules, tops the panels and marks the price. Headlines and prices are set in Source Serif 4, a reading serif with real weight; everything else — labels, controls, body, the running copy — is PT Sans, a plain humanist sans that stays out of the way. Corners are square everywhere. Structure is carried by hairlines and a single gold top-rule, never by rounded cards or drop shadows. Content is laid out as ledgers: an itinerary read night by night, cabin grades priced straight in rows, sailings listed like a shipping register.

**Key characteristics**

- A deep night-navy ground in three tones, banded against two paper grounds (white and bone) as the page alternates on-navy and on-white.
- One warm gold thread in three tints, so the same accent stays legible on navy (gold-bright) and on white (gold-ink) without ever going grey.
- A reading serif (Source Serif 4) for headlines and every price, a plain humanist sans (PT Sans) for labels, controls and body.
- Square corners on everything. Radii are 0 across the whole world.
- Structure drawn by hairlines and a single gold top-rule, not by shadow or rounding.
- Every offer set as a straight ledger: the itinerary daylist, the cabin rows, the sailings register, the value card's field list.
- One photographic grade across every image, so the plates read as one voyage rather than assembled stock.
- One authored motion moment, the reveal fade-rise with a short stagger, plus a slow one-time drift on the hero panorama.

## 2. The Kit: One Vocabulary For Every Page

Every Harbourline page is built from the same small set of parts. Reach for these before inventing, and invent only when a page has a genuinely new editorial moment. Do not reinvent a button, a rule or a row.

- **Bands, not cards.** A page is a stack of full-width bands that alternate ground: navy, then white or bone, then navy again. A gold hairline or a 1px rule tops the band change. The rhythm between bands is the `section` value.
- **The gold top-rule.** A panel or a caption block earns a 2px or 3px gold rule across its top edge — the console, the port caption, the value card, the cabin rows. This is the house way to open a block, in place of a border box or a shadow.
- **The ledger row.** Data is a row on a hairline: a label or day marker on the left, the substance in the middle, the figure hard right. The itinerary daylist, the cabin rows and the sailings register are all the same row logic at different widths.
- **The field label.** Inside a panel or a card, a data field is titled in tracked PT Sans caps at `label` size in gold (gold-bright on navy, gold-ink on white), with the value in serif beneath. This labels data, and it is the only place tracked gold caps belong.
- **The serif figure.** Every price, every headline number and every stat is set in Source Serif 4. The serif carries weight and the sans carries the small print beside it.
- **Type roles.** Serif for headlines, prices, wordmark and pull-quote. Sans for labels, nav, controls, body and fine print. Nothing else.
- **Two buttons only.** A filled gold button for the primary action, a gold-outlined button on navy for the secondary. Everything else is a plain link.

If a shape is not covered here it is almost certainly not needed. The ledger is the structure; add a row before you add a container.

## 3. Colours: Night Water and One Gold Thread

### Navy grounds

- **Navy** `#0A1C33`: the dominant page surface, a deep night blue.
- **Navy Deep** `#071426`: the footer and the console band, the deepest inset.
- **Navy Panel** `#0E2440`: raised panels on navy — the finder console, the value card, the framed photos.
- **Navy Line** `#24384F`: hairlines and dividers drawn on navy.

### Paper grounds

- **White** `#FFFFFF`: the bright section ground for ports, sailings and the lines strip.
- **Bone** `#F7F5F0`: a soft-white section variant, and the well behind a photo before it loads.
- **Rule** `#DDD8CE`: the warm hairline that divides rows on paper.

### Ink text (on paper)

- **Ink** `#22303F`: body on white, a navy-tinted near-black rather than a flat grey.
- **Ink Soft** `#51606F`: secondary text on white, still navy-tinted. This is the floor for reading text on paper and clears 4.5:1.

### Sea text (on navy)

- **Paper Text** `#E9EEF4`: primary text on navy, a cool off-white.
- **Sea Text** `#9FB0C4`: secondary text on navy — ledes, captions, notes. Tinted to the navy hue, never a flat grey, and it clears 4.5:1 on every navy ground.
- **Sea Faint** `#7C90A6`: the dimmest tier, the legal line at the foot only. Never load reading copy onto it.

### The gold thread

- **Gold** `#C9A24B`: the accent fill — the primary button, the top-rules, the checkbox accent, borders on framed photos.
- **Gold Bright** `#D9B25F`: gold on navy — kicker-weight labels, field labels, the hero emphasis word, the focus ring.
- **Gold Ink** `#8A6626`: gold on white — the same thread darkened so tracked caps and small labels hold AA on paper.

### Colour rules

**The One Thread Rule.** Gold is the single accent and it is rationed. It draws the rules, tops the panels, fills the one primary button, marks the price emphasis and the hover lift. It is never a large fill and never a second brand colour. If gold has spread across a surface, pull it back to navy or paper.

**The Right Gold For The Ground Rule.** The thread has three tints for one reason: legibility. On navy use gold-bright, on white use gold-ink, and reserve plain gold for fills and rules where contrast is not carrying text. Never set gold-bright as text on white or gold-ink as text on navy.

**The Navy-Tinted Neutral Rule.** Every grey in this world is tinted toward navy or bone, never flat. Secondary text on navy is sea-blue off-white, secondary on paper is a navy-grey. If a neutral reads as dead grey, it is wrong.

**The Banded Ground Rule.** Colour lives in the ground bands and the photography. Sections alternate navy, white and bone; text and rules flip with the ground (paper-text and gold-bright on navy, ink and gold-ink on paper). Do not float a lone tinted card on a matching ground — change the whole band or use a hairline.

## 4. Typography: Serif Carries The Number, Sans Keeps The Book

**Display and figures:** Source Serif 4, Georgia, serif. The reading serif carries every headline, the wordmark, the pull-quote and — the signature move — every price and stat. When a number matters, it is set in the serif.

**Everything else:** PT Sans, Arial, sans-serif. A plain humanist sans that runs the nav, the labels, the controls, the body and all the fine print. It is legible and unshowy, the clerk to the serif's captain.

The tension is quiet on purpose: a warm reading serif giving weight to the headline and the fare, a plain sans keeping the surrounding book clear. Neither shouts.

### Hierarchy

- **Display (hero headline):** Source Serif 4, `clamp(38px, 4.6vw, 62px)`, weight 600, line-height 1.08, letter-spacing `-0.01em`. Capped near 18ch so a line breaks with intent.
- **Section heading:** Source Serif 4, `clamp(28px, 3.2vw, 40px)`, weight 600, line-height 1.12, letter-spacing `-0.005em`.
- **Console title:** Source Serif 4, `26px`, weight 600.
- **Serif figure (stats, value fields):** Source Serif 4, `22px`–`24px`, weight 600, line-height 1.25.
- **Price:** Source Serif 4, `27px`–`30px`, weight 700, line-height 1, with the sans caption stacked beneath at `12.5px`.
- **Lede:** PT Sans, `17.5px`, weight 400, line-height 1.55, measure capped near 56ch.
- **Body:** PT Sans, `16.5px`, weight 400, line-height 1.65, reading measure near 52ch.
- **Field label / day marker:** PT Sans, `11.5px`–`12px`, weight 700, uppercase, letter-spacing `0.14em`–`0.18em`, in gold-bright on navy or gold-ink on white.
- **Wordmark:** Source Serif 4, `27px`, weight 600, with a `10px` sans subline tracked `0.3em`.

### Typography rules

**The Serif Prices Rule.** Every price, headline number and headline stat is Source Serif 4. This is the house signature: the number a customer is weighing is set in the voice that carries weight, with the per-night or per-person qualifier in small sans beneath. Never set a price in the sans.

**The Reading Floor Rule.** Body sits at `16.5px`/1.65 and never drops below `13.5px` for anything a reader must actually read. Fine print is `13.5px` on ink-soft or sea-text, both of which clear 4.5:1 on their ground. Placeholder and secondary copy never fall onto sea-faint.

**The Tight Serif Rule.** Large serif headlines carry a small negative tracking (`-0.01em` at the hero, `-0.005em` at section size) so a display line reads set and deliberate. The sans is never tracked negative; its labels are tracked wide instead.

**The Two Voices Rule.** Only two families exist. Do not introduce a third face for accents, quotes or numbers. The pull-quote is serif, the label is sans, and that is the whole book.

## 5. Elevation and Material

The system is almost flat. Depth comes from the ground bands, the gold rules and the photography, not from rounded cards or heavy shadow.

### Photography as one voyage

Every image is graded the same so the plates read as one commissioned voyage rather than assembled stock.

- **One grade.** A shared filter on every image: `saturate(0.85) contrast(1.06) brightness(0.97)`. Slightly desaturated, a touch of contrast, pulled a hair darker so it sits into the navy.
- **Framed on navy.** A feature photo on navy is matted: an 8px navy-panel pad inside a 1px gold border, like a print in a frame. On paper the photo runs edge to edge in its cell.
- **One caption voice.** Captions are small italic sea-text, credited with a gold em-dash lead-in.

### Shadow vocabulary

Shadow is rare and only ever a soft downward drop, never a glow.

- **Console:** `0 24px 50px -30px rgba(0,0,0,0.6)`. The finder console lifts off the navy band, the one genuine float above the fold.
- **Inset snapshot:** `0 20px 40px -20px rgba(0,0,0,0.7)`. The small overlapping photo on the specialist portrait.
- **No card shadow.** Every other surface rests on a hairline, a gold top-rule or a ground change. Do not add a drop shadow to a ledger row or a port cell.

### Material rules

**The Hairline First Rule.** A 1px rule (navy-line on navy, rule on paper) does the work a border box would do elsewhere, and a 2px–3px gold rule tops a block that needs to open. Add the line before you add anything heavier.

**The Square Corner Rule.** Radii are 0 on everything — panels, cards, buttons, inputs, tags and images. Rounded corners do not exist in this world. The straightness is the ledger.

**The No Glass Rule.** No blur panels, no glass, no glow, no gradient fills except the single gold wash that marks the most-booked cabin row (`linear-gradient(90deg, rgba(201,162,75,0.10), transparent 55%)`). Depth is the ground, the rule and the photograph.

## 6. Motion: One Reveal, One Drift

There is a single authored motion, the **reveal**. A block begins fully legible in its resting state, so a failed script never hides content, and as it enters the viewport it lifts from `translateY(20px)` to `0` while opacity moves `0` to `1` over `550ms` on `ease-out`. Items in one group stagger by `80ms` (the d1 / d2 / d3 delays of 80, 160 and 240ms), but it is always the same gesture. The trigger is an IntersectionObserver at a `0.12` threshold, firing once.

Alongside it, the hero panorama plays a slow **drift** on load: the image eases from `scale(1.05)` to `scale(1)` over `16s`, once, and never repeats. It is the only continuous motion and it settles quickly to stillness.

Everything else is a quiet colour or press change: buttons transition colour over `180ms ease-out` and press down 1px on `:active`, the nav underline wipes in over `200ms`, a port or thumbnail photo lifts `scale(1.03)` over `350ms` on hover, a sailings row tints to bone on hover. No parallax, no scroll-scrub, no clip-path reveal, no second entrance.

**Reduced motion.** Under `prefers-reduced-motion: reduce` every animation and transition is removed, the reveals are shown in place, the hero image is static and smooth scrolling is switched off. Content is simply present.

## 7. Components

### Masthead

Navy ground with a 1px gold bottom-border, 86px tall. The wordmark is a serif name (with one word carried in gold-bright via `em`) over a tracked sans subline. The nav links are sans, and a gold underline wipes in from the left on hover. The phone number sits in serif with a tracked sans caption ("Open until 8pm tonight"), beside one gold primary button. The nav collapses below 1120px, the phone below 680px.

### Hero and panorama

The headline sits in the navy band on a `8fr / 4fr` grid, the serif display at hero scale with one clause in gold-bright, a sea-text lede beside a bordered aside that carries the month's benchmark line. Below it a full-width panorama band, hairlined gold top and bottom, holds the drifting photo with an italic caption credited hard right. The aside's left border becomes a top border when the grid stacks.

### Finder console

A navy-panel card, 1px navy-line border with a 3px gold top-rule, lifted on the console shadow. Serif title, sea-text sub. The form is a `3 fields + button` grid: each field is a gold-bright tracked label over a navy-deep select with a 1px border that turns gold on hover, `color-scheme: dark` so the native dropdown matches. The gold button is 50px tall. A hairline-topped foot carries a gold-accent checkbox ("No-fly only") and a phone fallback. The grid drops to two columns, then one, and the button goes full width.

### Port grid

A six-column grid on white, cards spanning two columns each with one feature spanning four columns and two rows. Each port is a photo in a bone well with a 2px gold top-rule caption beneath: the serif place name over a gold-ink field label, and the facts (rating, sailings, best months) hard right in ink-soft. Photo lifts `scale(1.03)` on hover. Collapses to two columns, then one.

### Itinerary daylist

The signature ledger. A `7fr / 5fr` navy band: on the left the serif heading and a daylist where each row is `[day marker] [port] [note]` on a hairline — the day marker in gold-bright tracked caps, the port in paper-text, a sea day set italic in sea-text, the timing note hard right. On the right a gold-framed photo above a value card. The day markers are real information and are the one numbering that earns its place. Collapses to a two-column row with the note dropped beneath on mobile.

### Value card and cabin rows

The value card is a navy-panel `dl` of field labels (gold-bright caps) over serif values, with a full-width gold button beneath. The cabin rows are a paper ledger: each grade is a row — serif name over a gold-ink deck label, a sans description, size, and a serif price hard right with a sans caption. The most-booked row is marked by a 3px gold left-bar, a faint left-to-right gold wash and a gold tag. Rows divide on the `rule` hairline; the block opens and closes on a navy 1px rule.

### Sailings register

A paper ledger of three sailings, each a row of `[thumb] [detail] [price]`: a gold-ink kicker-weight line of facts, a serif sub-heading, a sans fact line, and a serif price hard right with a per-night sans line beneath. The row tints to bone on hover. Collapses the price beneath the detail on narrow screens.

### Interlude

A full-width photo band, gold-hairlined top and bottom, with a navy scrim (`rgba(7,20,38,0.55)`) so a serif pull-quote reads clean over it. The attribution is a tracked gold-bright cite line. This is the one place a large serif quote appears, in place of any callout box.

### Specialist

A navy `5fr / 7fr` band pairing a gold-framed portrait (with an overlapping inset snapshot on the shadow) against the serif heading, a sea-text intro and a list of what the fare covers. The phone number is a serif link beside its opening hours and a gold-outlined secondary button.

### Trust strip

A hairline-bounded row of four cells divided by `rule` verticals, each a serif stat (ABTA/ATOL, rating, since-2004, repeat rate) over a small ink-soft line. Cells wrap to full width below 760px. Real numbers, not a decorative metric template.

### Buttons

- **Primary (gold):** gold fill, navy-deep text, square, min-height 48px (50px in the console), sans 700. Hover lifts the fill to gold-bright over 180ms; `:active` presses down 1px.
- **Secondary (outline on navy):** transparent fill, paper-text label, 1px gold border. Hover fills to a faint gold wash (`rgba(201,162,75,0.14)`).
- **Focus:** a 3px gold-bright outline at 2px offset on navy, gold-ink on white surfaces.

### Footer

Navy-deep, gold-hairlined top, a four-column sitemap under serif column headings tracked in gold-bright. The brand block repeats the serif wordmark and the serif phone number. The legal line at the very foot is the only place sea-faint text appears.

### Browser surfaces

Theme every surface the browser would otherwise leave in defaults, from this palette.

- **Focus ring:** authored — a 3px gold-bright outline at 2px offset on navy, gold-ink on paper. (Set in the source.)
- **Selection:** derived — background `rgba(201,162,75,0.28)` (a gold wash), text left at its ground colour. Not set in the source; add it from the thread.
- **Caret:** derived — gold on navy inputs, ink on paper inputs. Not set in the source.
- **Scrollbar:** derived — a navy-line thumb on a navy-deep track, thin. Not set in the source.
- **Link underline:** derived — gold underline at `0.14em` offset for inline text links. The source only underlines footer links on hover; extend the gold underline to any inline link and keep the offset generous.

## 8. Do and Do Not

### Do

- Do band the page: navy, then white or bone, then navy, and flip text and rules with the ground.
- Do lay every offer out as a straight ledger — the itinerary night by night, cabins priced in rows, sailings as a register — and itemise what the fare covers.
- Do set every price and headline number in Source Serif 4, with the qualifier in small sans beneath.
- Do keep gold to a single thread: the rules, the top-rules, one filled button, the price emphasis and the hover lift.
- Do pick the right gold for the ground — gold-bright on navy, gold-ink on white — so a label never drops below AA.
- Do open a block with a 2px–3px gold top-rule and divide rows on a 1px hairline, not with a shadow or a rounded box.
- Do grade every photograph on the one filter, and mat a feature photo in a gold frame on navy.
- Do tint every neutral toward navy or bone, so secondary text reads warm sea-blue or navy-grey, never flat.
- Do theme the browser surfaces — selection, caret, scrollbar, focus ring and link underline — from the gold thread and the navy line.
- Do honour the one reveal, the one hero drift and the reduced-motion path.

### Do Not

- Do not round a corner. Radii are 0 on every surface in this world.
- Do not set a price or a headline number in PT Sans. Numbers that matter are serif.
- Do not spread gold across a surface as a fill or introduce a second brand colour. It is one rationed thread.
- Do not float a shadowed card on a matching ground; change the band or draw a hairline.
- Do not let a grey go flat. Every neutral is navy- or bone-tinted, and reading copy never sits on sea-faint.
- Do not add a second animation, a parallax or a clip-path reveal. One reveal, one drift.
- Do not assemble stock at mixed grades. Every plate is the one voyage on the one filter.
- Do not label a heading with a decorative tracked cap. Tracked gold caps belong to data fields and the itinerary's day markers, where the label names a real value — not floating above a title.
