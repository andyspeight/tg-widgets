---
name: Windward & West
description: Bright-tropical warmth for a Caribbean-only specialist. Sun-lit off-white paper, deep sea-ink text, three flat holiday colours (turquoise, hibiscus coral, sun yellow) poured into full-width blocks, rounded corners throughout, and a Young Serif display voice over a plain Hanken Grotesk. Photography graded to one sun-drenched reel.
mode: Persuade

colors:
  # Ground and ink (warm, never white-white, never grey)
  paper: "#FFFDF9"          # sun-lit white, the page ground
  ink: "#0F3237"            # deep sea ink, body text on paper
  ph-tint: "#E7F4F2"        # pale sea, the placeholder behind a loading photo

  # Turquoise sea (blocks, accents)
  sea: "#12A5A0"            # turquoise block fill, ink text sits on top
  sea-deep: "#0B7672"       # text-safe turquoise, meta and links on paper
  sea-ink: "#07333A"        # darkest sea, footer, season band, ink button

  # Hibiscus coral (the warm block, the button)
  coral: "#F2594F"          # hibiscus flat-block fill, dark text on top
  coral-btn: "#D9382D"      # button coral, passes AA with white
  coral-btn-h: "#BE2B21"    # button coral, hover
  ink-on-coral: "#3A130E"   # body text on a hibiscus block

  # Sun yellow (highlight, never a text colour)
  sun: "#FFC63F"            # flat sun yellow, always paired with ink text

  # Secondary text tints (sea-hued, never flat grey)
  text-muted: "#3C5A60"     # secondary paragraphs on paper, ~7:1
  text-faint: "#48666C"     # captions and sub-labels on paper, ~5.6:1

  # Lines and lift
  line: "rgba(15,50,55,.14)"        # hairline dividers and input borders
  shadow: "0 12px 34px rgba(7,51,58,.14)"   # the soft floating-card shadow

fonts:
  display: "\"Young Serif\", Georgia, serif"
  body: "\"Hanken Grotesk\", \"Segoe UI\", sans-serif"

typography:
  scale:
    micro: "10.5px"    # trust badges, fast tags, foot-bottom legal
    label: "12.5px"    # tracked caps labels and form labels
    small: "13.5px"    # captions, chip sub-labels, facts
    body: "16.5px"     # the reading size, line-height 1.62
    lead: "17px"       # section standfirsts and intros
    sub: "19.5px"      # hero standfirst top of clamp
    title: "19px"      # chip, tile and rest names
    heading: "clamp(28px, 2.6vw, 38px)"   # spotlight panel headings
    section: "clamp(30px, 3.4vw, 48px)"   # movement titles
    display: "clamp(42px, 5.8vw, 82px)"   # the hero line
    stat: "clamp(78px, 9vw, 140px)"       # the one oversized sea-temperature figure
  display:
    fontFamily: "\"Young Serif\", Georgia, serif"
    fontSize: "clamp(42px, 5.8vw, 82px)"
    fontWeight: 400
    lineHeight: 1.1
    letterSpacing: "-0.005em"
  section:
    fontFamily: "\"Young Serif\", Georgia, serif"
    fontSize: "clamp(30px, 3.4vw, 48px)"
    fontWeight: 400
    lineHeight: 1.1
  heading:
    fontFamily: "\"Young Serif\", Georgia, serif"
    fontSize: "clamp(28px, 2.6vw, 38px)"
    fontWeight: 400
    lineHeight: 1.1
  stat:
    fontFamily: "\"Young Serif\", Georgia, serif"
    fontSize: "clamp(78px, 9vw, 140px)"
    fontWeight: 400
    lineHeight: 0.95
  title:
    fontFamily: "\"Young Serif\", Georgia, serif"
    fontSize: "19px"
    fontWeight: 400
    lineHeight: 1.1
  price:
    fontFamily: "\"Young Serif\", Georgia, serif"
    fontSize: "24px"
    fontWeight: 400
  lead:
    fontFamily: "\"Hanken Grotesk\", \"Segoe UI\", sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.55
  body:
    fontFamily: "\"Hanken Grotesk\", \"Segoe UI\", sans-serif"
    fontSize: "16.5px"
    fontWeight: 400
    lineHeight: 1.62
  label:
    fontFamily: "\"Hanken Grotesk\", \"Segoe UI\", sans-serif"
    fontSize: "12.5px"
    fontWeight: 700
    letterSpacing: "0.16em"
    textTransform: "uppercase"
  button:
    fontFamily: "\"Hanken Grotesk\", \"Segoe UI\", sans-serif"
    fontSize: "15.5px"
    fontWeight: 700

spacing:
  # The built rhythm, generous but not couture-vast
  chip-gap: "18px"
  grid-gap: "20px"
  card-pad: "28px 34px"
  panel-pad: "46px 48px"
  block: "96px"          # standard vertical padding on a coloured block
  block-deep: "150px"    # the turquoise why-block that a wave sits under
  wrap: "1280px"         # max content width
  gutter: "36px"         # page side padding, 20px under 640px
  measure: "66ch"        # the note and long-copy cap

radii:
  sm: "10px"     # --r-sm, photo corners inside a chip
  md: "14px"     # --r-md, tiles, month cells, mini-photos
  lg: "18px"     # --r-lg, chips, panels, forms, the big photos
  input: "10px"  # form fields
  pill: "999px"  # buttons, the sea-temp pill, the fast tag
  focus: "6px"   # the rounding on the focus ring

motion:
  signature: "reveal"
  duration: "550ms"
  easing: "ease-out"
  transform: "translateY(20px) to translateY(0)"
  opacity: "0 to 1"
  stagger: "70ms"          # items in one row, cycled every 4th
  ui: "160ms ease-out"     # button colour, transform and shadow
  hover-lift: "translateY(-2px) on buttons, translateY(-8px) on chips"
  reducedMotion: "no transform, no opacity ramp, scroll-behavior auto, content simply present"
---

# Design World: Windward & West

## 1. Overview: Island Time

Windward & West is a Caribbean-only holiday specialist, and the site should feel like the moment you step off the plane into the heat. The whole system rests on one idea: the islands are already this bright, so the page does not have to invent colour, it has to be honest about the colour that is really there. Where a couture house earns trust by restraint, this house earns it by warmth and by candour. The specialist has stayed on every island and will tell you the awkward truth about hurricane season, and the design carries that same plain confidence.

The world is a warm off-white paper ground, deep sea-ink text, and three flat holiday colours poured full-width into bold blocks: turquoise sea, hibiscus coral and flat sun yellow. Nothing is a gradient and nothing is a tint of grey. Corners are softly rounded throughout, photographs float on a soft warm shadow, and a Young Serif display voice sits over plain Hanken Grotesk body copy. Photography is graded to one sun-drenched reel so a page never reads as stock from many sources.

**Key characteristics**

- A sun-lit off-white ground (`#FFFDF9`), never a cold white and never grey.
- Three flat holiday colours in full-width blocks: turquoise, hibiscus coral, sun yellow. Flat fills, never gradients.
- Deep sea-ink text with secondary tiers tinted from the sea hue, never flat grey.
- Rounded corners at three sizes (10 / 14 / 18px) plus a pill for every button.
- Young Serif for display and every headline, Hanken Grotesk for body, controls and meta.
- Full-width coloured movements alternating with paper, each a bold block of a single holiday colour.
- Photography on one warm grade, floating on a soft shadow, corners always rounded.
- Sun yellow as the highlight thread: the underline marker, the nav hover, the fastest-flight row, always paired with ink text.
- One motion moment, a short staggered fade-rise as content enters, and nothing else.

## 2. The Kit: One Vocabulary For Every Page

Every Windward & West page is built from the same small vocabulary. Reach for these before inventing, and invent only for a genuinely bespoke editorial moment such as a hero plate or a unique photographic treatment.

- **Coloured movements.** A page is a sequence of full-width blocks. Paper sections and flat-colour blocks (turquoise, coral, sun, sea-ink) alternate down the scroll so the eye is walked through a rhythm of warmth. Use the `block` vertical rhythm.
- **The floating chip rail.** A row of white rounded chips, each a rounded photo plus a name and a plain-spoken sub-label ("the reliable one"), overlapping the edge of the block above on the soft shadow. Alternate chips sit a beat lower so the rail reads as hand-placed, not gridded.
- **The spotlight spread.** A rounded photograph with a flat-colour panel pulled over its inner edge, a small mini-photo bordered in paper hanging off the corner. The panel colour rotates sun, coral, sea down a run of features.
- **The highlight marker.** Sun yellow set behind a word as an inset box-shadow underline, or as the growing underline under a nav link. This is how a single word is lifted, in place of italics or a second colour of text.
- **Type roles.** Every headline, island name, price and oversized figure is Young Serif. Everything else, body, labels, controls, meta, is Hanken Grotesk. Tracked caps carry meta only, never sit above a heading as a kicker.
- **One CTA.** A single filled coral pill (`coral-btn`) is the primary action for the enquiry. Ink and outlined pills are secondary. Every "ask" beyond that is a text link with a coloured underline.

## 3. Colours: Sun-Lit Paper and Three Holiday Blocks

### Ground and ink

- **Paper** `#FFFDF9`: the page ground, a warm sun-lit off-white.
- **Ink** `#0F3237`: body text on paper, a deep sea-green ink, never pure black.
- **Photo tint** `#E7F4F2`: the pale-sea placeholder behind a photograph before it loads.

### Turquoise sea

- **Sea** `#12A5A0`: the turquoise block fill. Only ink and sea-ink text sit on it, never white.
- **Sea Deep** `#0B7672`: the text-safe turquoise for meta, links and sub-labels on paper.
- **Sea Ink** `#07333A`: the darkest sea, used for the footer, the season-honesty band and the ink button.

### Hibiscus coral

- **Coral** `#F2594F`: the hibiscus block fill, warm and loud. Dark `ink-on-coral` text sits on it.
- **Coral Button** `#D9382D`: the button coral, darkened so white text clears AA.
- **Coral Button Hover** `#BE2B21`: the button on hover.
- **Ink on Coral** `#3A130E`: body text on a hibiscus block.

### Sun yellow

- **Sun** `#FFC63F`: the flat highlight yellow. Always paired with ink text, never used as a text colour on paper and never used for a body run.

### Secondary text

- **Text Muted** `#3C5A60`: secondary paragraphs and section standfirsts on paper, about 7:1. Tinted from the sea hue so it reads as warm slate, never grey.
- **Text Faint** `#48666C`: captions and sub-labels on paper, about 5.6:1. Still comfortably past the body floor.

### Lines and lift

- **Line** `rgba(15,50,55,.14)`: hairline dividers and the resting border on an input.
- **Shadow** `0 12px 34px rgba(7,51,58,.14)`: the soft warm shadow every floating card, chip and panel rests on.

### Browser surfaces

Theme every surface the browser would otherwise leave in its defaults. The source ships the focus ring; the rest are derived from this palette and should be added.

- **Focus ring** (shipped): `3px solid #D9382D` with a `3px` offset and a `6px` corner radius, on every link, button, input and select.
- **Selection** (derived): background `rgba(255,198,63,.4)` sun-tint, text ink. Sun is the highlight thread, so the selection is a wash of it.
- **Caret** (derived): `#D9382D` coral, to match the primary action.
- **Scrollbar** (derived): a `sea-deep` thumb on a `paper` track, thin.
- **Link underline** (derived): links on paper carry a `sea-deep` underline at `text-underline-offset: 0.2em`; the coral-block alt-link keeps its white underline at `3px` offset as shipped.

### Colour rules

**The Flat Block Rule.** Colour arrives as a flat full-width fill of a single holiday colour, never a gradient and never a tint. The one graded thing on the page is the photography. If a fill has a gradient in it, it is wrong for this world.

**The Sun Is A Highlight Rule.** Sun yellow is never a text colour on paper and never a body or link colour. It lifts one word, underlines a nav link, marks the fastest flight and paints the brand dot. It always sits under or beside ink text.

**The Warm Ink Rule.** Every neutral is tinted from the sea hue. Text is sea-ink, secondary tiers are sea-slate, the ground is warm paper. There is no flat grey and no cold white anywhere in the system.

**The Text-Safe Pair Rule.** The bold `sea` and `coral` are block fills that carry dark text. When the same hue must be text on paper, drop to `sea-deep` or `coral-btn`, which are darkened to clear contrast.

## 4. Typography: Young Serif Names, Hanken Grotesk Speaks

**Display:** Young Serif, Georgia, serif. A warm, slightly rustic slab-ish serif with a hand-made feel. It carries every headline, every island name, every price and the one oversized figure. Weight 400 only, line-height 1.1, a whisker of negative tracking (`-0.005em`).

**Body and UI:** Hanken Grotesk, "Segoe UI", sans-serif. A plain, friendly grotesk that runs body copy, form controls, tracked-caps labels, prices' small print and every piece of meta. Weights 300 to 700 are available; body is 400 at 16.5px / 1.62.

The warmth of Young Serif at size against the plainness of Hanken Grotesk is the whole typographic story. The serif is never made to shrink into a label; when small type is needed it is the grotesk that does the work.

### Hierarchy

- **Display (hero)**: Young Serif, `clamp(42px, 5.8vw, 82px)`, line-height 1.1, on paper or over a scrimmed photo. Capped near 13ch so it breaks like a headline.
- **Section title (movement)**: Young Serif, `clamp(30px, 3.4vw, 48px)`, line-height 1.1.
- **Heading (spotlight panel)**: Young Serif, `clamp(28px, 2.6vw, 38px)`.
- **Stat figure**: Young Serif, `clamp(78px, 9vw, 140px)`, line-height 0.95. The single oversized sea-temperature number, used once.
- **Title (chip, tile, island name)**: Young Serif, `19px`.
- **Price**: Young Serif, `24px`, with the "incl. flights" small print set in Hanken Grotesk at 13px.
- **Lead (standfirst)**: Hanken Grotesk, `17px`, line-height 1.55, in `text-muted`.
- **Body**: Hanken Grotesk, `16.5px`, line-height 1.62, ink, measure capped near 66ch.
- **Label (meta)**: Hanken Grotesk, `12.5px`, weight 700, uppercase, letter-spacing `0.16em`, in `sea-deep` on paper or `sun` on a dark band.

### Typography rules

**The Serif Names Things Rule.** Only Young Serif gets to be large, and it is reserved for names and numbers: headlines, islands, prices, the one big figure. It never carries a paragraph and never shrinks to caption size.

**The Grotesk Carries The Words Rule.** All reading copy, all controls and all meta are Hanken Grotesk. Reading copy uses line-height 1.62 and a 66ch measure so a long section stays comfortable.

**The One Big Number Rule.** The oversized `stat` figure appears once on a page, for the single fact worth shouting (the sea temperature). It is a piece of editorial evidence, not a template to repeat as a row of tiles.

## 5. Elevation and Material

Depth comes from soft warm shadow, rounded corners and flat colour blocks, not from borders or glass.

### Photography as one reel

Every photograph is graded to one sun-drenched look so the site reads as a single shoot, not assembled stock.

- **One grade.** Every image carries `saturate(1.22) contrast(1.05) brightness(1.03)` with a `rgba(255,176,64,.06)` warm multiply wash on top, so all imagery shares the same sunlit warmth.
- **Rounded always.** Photographs take `r-lg` (18px) at hero and feature size, `r-md` (14px) at tile size, `r-sm` (10px) inside a chip. A square-cornered photo does not exist here.
- **The hero scrim.** Over the full-bleed hero the sea-ink gradient rises from the bottom so the white headline and sun eyebrow always sit on calm tone.

### Shadow vocabulary

- **Card shadow**: `0 12px 34px rgba(7,51,58,.14)`, the resting float under every chip, panel, tile and the enquiry form.
- **Chip hover**: lifts to `0 20px 44px rgba(7,51,58,.2)` as the chip rises 8px.
- **Button hover**: a coloured cast, `0 8px 20px rgba(190,43,33,.28)` on the coral button as it lifts 2px.
- **Form on coral**: the white enquiry form on the coral block casts a deeper `0 20px 48px rgba(122,20,12,.28)`.

### Material rules

**The Soft Shadow Rule.** Cards and panels float on the warm blurred shadow, never on a hard offset shadow and never on a heavy border. The shadow is always warm-tinted from the sea-ink, never a neutral grey drop.

**The Rounded Corner Rule.** Everything with an edge is rounded: 10, 14 or 18px for surfaces and photos, a full pill for buttons and tags. Sharp corners are foreign to this world.

**The No Glass Rule.** The one translucency is the sticky header's `blur(6px)` over `rgba(255,253,249,.95)` and the hero scrim. No glassmorphism panels, no glow, no gradient fills on surfaces.

## 6. Motion: One Warm Rise

There is a single authored motion, the **reveal**. Content begins fully legible in its resting state, so a failed script never hides the page, and as it enters the viewport it lifts from `translateY(20px)` to `0` while opacity moves `0` to `1`, over `550ms` on `ease-out`. Items in one row stagger by `70ms`, cycled every fourth item, so a rail settles in a gentle cascade rather than all at once.

Interaction motion is the only other movement: buttons and chips shift colour, transform and shadow over `160ms ease-out`, buttons lifting 2px and chips 8px on hover, both dropping back on `:active`. The nav underline grows from 0 to full width over `220ms`. There is no parallax, no scroll-scrub, no second entrance animation.

**Reduced motion.** Under `prefers-reduced-motion: reduce` the reveal transform and opacity ramp are removed, every animation and transition is switched off, `scroll-behavior` drops to auto, and content is simply present.

## 7. Components

### The coloured block

A full-width section filled flat with one holiday colour (turquoise `why`, coral `plan`, sea-ink `season` and footer) or left on paper. Vertical padding is the `block` rhythm; the deep turquoise block runs to `block-deep` with a paper wave SVG cutting the bottom edge. Text colour is chosen for contrast on the fill: `sea-ink` on sea, `ink-on-coral` on coral, near-white on sea-ink.

### The floating chip rail

A row of white `r-lg` chips overlapping the block above on the card shadow, each holding a rounded photo, a Young Serif name and a plain `sea-deep` sub-label. Alternate chips are nudged 20px lower for a hand-placed feel. On hover a chip lifts 8px into the deeper shadow. Below 1060px the rail becomes a horizontal scroll-snap strip.

### The spotlight spread

A rounded feature photo with a flat-colour panel (`panel-sun`, `panel-coral`, `panel-sea`) pulled 72px over its inner edge, a paper-bordered mini-photo hanging off the lower corner, and the panel carrying a heading, an island line, body, a facts row, a Young Serif price and a text-link ask. Alternate spreads flip left to right. The panel colour rotates through the three holiday colours down a run.

### Buttons

- **Primary (coral)**: `coral-btn` fill, paper text, pill radius, `14px 26px` padding, Hanken Grotesk 700 at 15.5px. Hover darkens to `coral-btn-h`, lifts 2px and casts the coral shadow. One primary per view, for the enquiry.
- **Ink**: `sea-ink` fill, paper text, for a secondary submit. Hover lightens and lifts 2px.
- **Outlined**: transparent with a 2px ink or white border, for a phone-number or "call us" action over a photo or a coloured block.
- **Active**: every button drops `translateY(1px) scale(.99)`.
- **Focus**: the shipped coral focus ring.

### Text link (every other ask)

Bold Hanken Grotesk with a `3px` underline in `currentColor` (or a sun underline on the specialist cards), fading to 70% opacity on hover. This is the default way to ask about an island.

### The highlight marker

Sun yellow lifting a single word, drawn as an inset `box-shadow: inset 0 -10px 0 var(--sun)` behind the word so the highlight sits under the text like a marker pen. Used sparingly, once or twice per movement.

### Enquiry form

- **Input**: paper fill, 2px `line` border, ink text, `10px` radius, `12px 14px` padding, min-height 48px. Label above in tracked `sea-deep` caps.
- **Hover**: border moves to `sea`.
- **Focus**: border to `sea-deep`, outline removed in favour of a `0 0 0 3px rgba(18,165,160,.22)` turquoise ring.
- **Error**: the field border turns `coral-btn`; on submit the first empty field takes focus. Prefer a message that names the fix over a bare red border.
- **Success**: the `pf-done` line appears on a turquoise-tinted panel and the submit button disables at 55% opacity.

### The season honesty band

A `sea-ink` block that tells the awkward truth (hurricane season) with a twelve-cell month strip coloured `sea` (prime), `sun` (green-season value) and `coral-btn` (watch), a legend, and a dashed sun-bordered promise box. This candour band is a signature of the world, not decoration.

### Footer

`sea-ink` ground, the wordmark in Young Serif, tracked-caps `sun` column headings, links as plain text that underline on hover, and outlined trust badges (ABTA, ATOL). The quiet close of a loud page.

## 8. Do and Do Not

### Do

- Do pour colour into flat full-width blocks and alternate them with paper down the scroll.
- Do keep the three holiday colours honest: turquoise, hibiscus coral, sun yellow, each flat, never a gradient.
- Do grade every photograph to the one sun-drenched reel and round its corners.
- Do float cards, chips and panels on the soft warm shadow, and let chips overlap the block above.
- Do set every headline, island name, price and the one big figure in Young Serif, and everything else in Hanken Grotesk.
- Do use sun yellow only as a highlight paired with ink text: a marker under a word, a nav underline, the fastest-flight row.
- Do tint every secondary text tier from the sea hue so it reads warm, never grey.
- Do theme the browser surfaces, selection, caret, scrollbar, focus ring and link underline, from this palette.
- Do keep one primary coral CTA per view and make every other ask a text link.
- Do tell the awkward truth plainly, in the season band, in the voice: warm, plain, UK English.
- Do honour the one reveal motion and its reduced-motion path.

### Do Not

- Do not use a gradient fill, a tint of grey, or a cold pure-white ground. The ground is warm paper and the blocks are flat.
- Do not place a small tracked label above a heading as a kicker or eyebrow. The Young Serif heading carries its own weight; meta belongs beside or below it.
- Do not set a row of equal metric tiles. The one oversized figure is editorial evidence used once, not a stat template.
- Do not number sections (N° 01 / 02 / 03) as decoration. A sequence label is only earned when the order carries information the reader needs.
- Do not put sun yellow on paper as a text or link colour, or run body copy in it.
- Do not use a hard offset shadow, a heavy border or a glass panel where the soft warm shadow and a rounded corner will do.
- Do not let the bold `sea` or `coral` become text on paper; drop to `sea-deep` or `coral-btn` so contrast holds.
- Do not add a second animation, a parallax or a scroll effect. One reveal only.
