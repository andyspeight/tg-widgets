---
name: Harlow & Vane
description: Quiet couture for a bespoke travel house. Warm deep lacquer, immense negative space, one champagne-gold thread that carries the trip's own ledger, and a high-contrast Bodoni Didone with photography shot as one commissioned reel.
mode: Persuade

colors:
  # Ground and surfaces (warm amber-brown lacquer, hue 58, never charcoal)
  lacquer: "oklch(16% 0.014 58)"            # page ground
  lacquer-deep: "oklch(12% 0.012 58)"       # footer, deepest inset, input fill
  lacquer-raised: "oklch(20% 0.015 58)"     # panels, the floating enquiry bar
  lacquer-hover: "oklch(25% 0.015 58)"      # hovered surface
  veil: "oklch(10% 0.010 58 / 0.72)"        # ground-coloured scrim graded up from the lower third of a plate

  # The single metallic thread
  champagne: "oklch(80% 0.10 85)"           # the one accent: the spine, its ledger, rules, the mark, one CTA, one word
  champagne-bright: "oklch(86% 0.08 88)"    # hover lift on the accent
  brass: "oklch(62% 0.085 78)"              # deeper accent for icon strokes and heavier borders
  gold-hairline: "oklch(80% 0.10 85 / 0.24)"        # default gold rule
  gold-hairline-strong: "oklch(80% 0.10 85 / 0.55)" # active rule, focus ring
  rule-neutral: "oklch(90% 0.02 80 / 0.12)"         # the quietest divider

  # Text ramp (all warm-tinted, chroma lifted so secondary text never reads flat grey)
  ivory: "oklch(95% 0.014 88)"              # display and headlines
  text: "oklch(90% 0.014 82)"               # body, ~12:1 on lacquer
  text-muted: "oklch(78% 0.030 80)"         # captions, placeholders, tracked meta, ~6.4:1
  text-faint: "oklch(66% 0.030 78)"         # decorative sub-labels only, ~4.7:1
  text-disabled: "oklch(50% 0.020 76)"      # disabled copy
  ink: "oklch(18% 0.02 58)"                 # text on a champagne fill, ~8:1

  # State
  success: "oklch(74% 0.12 150)"
  error: "oklch(66% 0.16 34)"               # warm terracotta, belongs to the palette
  error-soft: "oklch(40% 0.10 34)"          # error surface fill

fonts:
  display: "Bodoni Moda, \"Didot\", \"Bodoni 72\", Georgia, serif"
  body: "Jost, \"Futura\", \"Avenir Next\", system-ui, sans-serif"
  longform: "Newsreader, \"Iowan Old Style\", \"Hoefler Text\", Georgia, serif"

typography:
  scale:
    micro: "0.6875rem"     # 11px, reference codes only
    label: "0.75rem"       # 12px, tracked caps meta and the margin ledger
    small: "0.9375rem"     # 15px, secondary text
    body: "1.0625rem"      # 17px, the reading size
    subtitle: "1.25rem"    # 20px
    lead: "1.375rem"       # 22px, opening paragraph
    title: "1.75rem"       # 28px, component headings
    headline: "2.75rem"    # 44px, movement titles
    display: "4rem"        # 64px
    display-xl: "clamp(3rem, 7vw, 6rem)"  # hero and stated lines
  display-xl:
    fontFamily: "Bodoni Moda, \"Didot\", Georgia, serif"
    fontSize: "clamp(3rem, 7vw, 6rem)"
    fontWeight: 500
    letterSpacing: "-0.04em"
    lineHeight: 1.02
  display:
    fontFamily: "Bodoni Moda, \"Didot\", Georgia, serif"
    fontSize: "4rem"
    fontWeight: 500
    letterSpacing: "-0.035em"
    lineHeight: 1.05
  headline:
    fontFamily: "Bodoni Moda, \"Didot\", Georgia, serif"
    fontSize: "2.75rem"
    fontWeight: 500
    letterSpacing: "-0.02em"
    lineHeight: 1.1
  lead:
    fontFamily: "Jost, \"Futura\", system-ui, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 400
    lineHeight: 1.55
  body:
    fontFamily: "Jost, \"Futura\", system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.75
  longform:
    fontFamily: "Newsreader, \"Iowan Old Style\", Georgia, serif"
    fontSize: "1.125rem"
    fontWeight: 400
    lineHeight: 1.7
  label:
    fontFamily: "Jost, \"Futura\", system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    letterSpacing: "0.24em"
    textTransform: "uppercase"
  wordmark:
    fontFamily: "Bodoni Moda, \"Didot\", Georgia, serif"
    fontSize: "1.25rem"
    fontWeight: 500
    letterSpacing: "0.32em"
    textTransform: "uppercase"

spacing:
  3xs: "0.25rem"
  2xs: "0.5rem"
  xs: "0.75rem"
  sm: "1rem"
  md: "1.5rem"
  lg: "2rem"
  xl: "3rem"
  2xl: "4rem"
  3xl: "6rem"
  4xl: "8rem"
  5xl: "12rem"
  section: "clamp(6rem, 12vw, 12rem)"   # vertical rhythm between movements
  gutter: "1.5rem"
  page-margin: "clamp(1.5rem, 6vw, 8rem)"
  max-width: "1400px"
  measure: "66ch"

radii:
  none: "0"          # the couture default, sharp corners
  xs: "1px"
  sm: "2px"          # buttons, inputs
  pill: "999px"      # the rare tag only

motion:
  signature: "fade-rise"
  duration: "900ms"
  easing: "cubic-bezier(0.16, 1, 0.3, 1)"
  transform: "translateY(18px) to translateY(0)"
  opacity: "0 to 1"
  stagger: "80ms"
  ui: "200ms ease"   # hover and focus colour only
  reducedMotion: "no transform, no opacity ramp, no stagger, content simply present"
---

# Design World: Harlow & Vane

## 1. Overview: Quiet Couture

Harlow & Vane is a house of bespoke travel, and the site should feel like a fashion house, not a travel agency. The whole system rests on one idea: say less, leave space, let the photography do the wanting. A discerning traveller reads confidence in restraint, so the page earns trust the way a couturier does. The authority comes from the space around the words, not the volume of them.

The world is a deep warm lacquer ground with immense negative space, a single champagne-gold thread of colour, and a high-contrast Bodoni Didone that carries every headline with quiet weight. Body copy is a calm geometric sans that stays out of the way, and the longest reading passages hand off to a warm serif so a long scroll never tires the eye. There are no feature cards, no metric tiles, no eyebrow labels and no coloured panels. There is photography, air, one serif voice and one thread of gold that also does a job.

**Key characteristics**

- A warm amber-brown lacquer ground, never black and never charcoal.
- Immense negative space as the primary luxury signal.
- One metallic accent, champagne-gold, rationed like a single thread.
- A champagne spine that carries the trip's own ledger down the margin, so the one ornament also informs.
- A high-contrast modern serif (Bodoni Moda) for display, a quiet geometric sans (Jost) for UI and short copy, a warm transitional serif (Newsreader) for the longest reads.
- Full-bleed photography shot as one reel, carrying the emotion edge to edge.
- Asymmetric magazine spreads on a stepped diagonal, never a centred grid.
- One motion moment, the fade-rise, and nothing else.

## 2. The Kit: One Vocabulary For Every Page

Every Harlow & Vane page is built from the same small vocabulary. Reach for these before inventing anything, and invent only when a page has a genuinely bespoke editorial moment, a hero plate or a unique photographic treatment. Do not reinvent a button, a rule or a spread.

- **Movements, not sections.** A page is a sequence of full-height editorial movements, each a stepped asymmetric spread of photograph and offset text. Use the `section` rhythm between them.
- **The thread and its ledger.** A 1px champagne hairline runs the outer margin as the page's spine, and it carries real trip metadata climbing beside the scroll: destination, coordinates, season, folio number, set in tracked Jost small caps. The one structural ornament is also the one thing the reader wants to know.
- **The chapter initial.** A movement opens with a raised Bodoni initial, three lines deep, the couture way to begin a passage in place of a heading badge.
- **The stated line.** An oversized Bodoni pull-quote in near-empty space, one word in champagne. This is how a movement lands a point, in place of any callout box.
- **The wall-label caption.** Photography is credited below-left in tracked caps: place, then a latitude line, then the year. A museum label, never a kicker.
- **Type roles.** Display and headlines are Bodoni. UI, controls and short body are Jost. The longest passages are Newsreader. Tracked caps in Jost carry meta, in the margin or the caption, never above a heading.
- **One CTA.** A single filled champagne button per view, for the enquiry. Every other action is a text link with a gold underline.

If a shape is not covered here it is almost certainly not needed. The instinct to add a container is the instinct to fill the space, and the space is the point.

## 3. Colours: Lacquer and One Thread

### Ground and surface

- **Lacquer** `oklch(16% 0.014 58)`: the page ground. Warm, deep, mineral, the colour of dark lacquered wood.
- **Lacquer Deep** `oklch(12% 0.012 58)`: footer, deepest inset, input fills.
- **Lacquer Raised** `oklch(20% 0.015 58)`: the few panels that exist, and the floating enquiry bar.
- **Lacquer Hover** `oklch(25% 0.015 58)`: a hovered surface, one quiet step up.
- **Veil** `oklch(10% 0.010 58 / 0.72)`: a ground-coloured scrim graded up from the lower third of a full-bleed photograph so headline text stays readable.

### The single thread

- **Champagne** `oklch(80% 0.10 85)`: the one accent. The spine and its ledger, hairline rules, the brand mark, the single CTA fill, one emphasised word. Nothing else.
- **Champagne Bright** `oklch(86% 0.08 88)`: hover lift on the accent.
- **Brass** `oklch(62% 0.085 78)`: a deeper metallic for icon strokes and heavier borders.
- **Gold Hairline** `oklch(80% 0.10 85 / 0.24)`: the default rule and divider.
- **Gold Hairline Strong** `oklch(80% 0.10 85 / 0.55)`: active rules and focus rings.
- **Rule Neutral** `oklch(90% 0.02 80 / 0.12)`: the quietest divider where gold would be too much.

### Text

- **Ivory** `oklch(95% 0.014 88)`: display and headlines. Warm, not cold white.
- **Text** `oklch(90% 0.014 82)`: body copy, about 12:1 on lacquer.
- **Text Muted** `oklch(78% 0.030 80)`: captions, placeholders and all tracked meta, about 6.4:1. The chroma is lifted so it reads as warm off-white, never grey. Everything a reader must actually read sits here or brighter.
- **Text Faint** `oklch(66% 0.030 78)`: decorative sub-labels only, about 4.7:1. Never load essential words onto this tier.
- **Text Disabled** `oklch(50% 0.020 76)`: disabled copy only.
- **Ink** `oklch(18% 0.02 58)`: text sitting on a champagne fill, about 8:1.

### State

- **Success** `oklch(74% 0.12 150)`: an enquiry sent, a field accepted.
- **Error** `oklch(66% 0.16 34)`: a warm terracotta so a problem still belongs to the palette, never a cold system red.
- **Error Soft** `oklch(40% 0.10 34)`: the fill behind an error message.

### Browser surfaces

Theme every surface the browser would otherwise leave in defaults.

- **Selection**: background `oklch(80% 0.10 85 / 0.28)`, text ivory.
- **Caret**: champagne.
- **Scrollbar**: brass thumb on a lacquer-deep track, thin.
- **Focus ring**: `gold-hairline-strong` at 2px with a 2px offset.
- **Link underline**: champagne, `text-underline-offset: 0.22em`.
- **Numerals**: any figure in a data run uses lining tabular figures so ledgers and prices align.

### Colour rules

**One Thread Rule.** Champagne-gold is rationed. It is allowed on the spine and its ledger, a hairline, the mark, one word and one button per view. If more has crept in, pull it back to lacquer.

**Warm Everything Rule.** Every neutral is tinted warm and the secondary tiers carry real chroma. Secondary text is warm off-white, never flat grey. The ground is amber-brown, never charcoal and never the near-neutral grey of a gallery wall.

**No Coloured Panels Rule.** Colour lives in the photography and the thread. Surfaces are lacquer. There are no tinted cards, no gradient fills and absolutely no purple.

**OKLCH Only Rule.** New colours are declared in OKLCH. Hex appears only inside imported assets.

## 4. Typography: Bodoni Speaks, Jost Whispers, Newsreader Carries The Long Read

**Display:** Bodoni Moda, "Didot", "Bodoni 72", Georgia, serif. A true high-contrast Didone, self-hosted. This is the couture voice and it carries every headline.

**UI and short body:** Jost, "Futura", "Avenir Next", system-ui, sans-serif. A quiet geometric sans, self-hosted. It runs controls, captions, the margin ledger and short copy blocks.

**Long read:** Newsreader, "Iowan Old Style", "Hoefler Text", Georgia, serif. A warm transitional serif, self-hosted, held in reserve for the longest editorial passages only, where a geometric sans would start to tire the eye. It is invisible by design, a reading aid, never a display voice.

The tension between a dramatic modern serif and a calm geometric sans is the whole typographic story. Newsreader sits beneath that story, doing the reading work so Bodoni never has to shrink.

### Hierarchy

- **Wordmark**: Bodoni Moda, `1.25rem`, weight 500, uppercase, letter-spacing `0.32em`. The lockup only.
- **Display XL (hero, stated lines)**: Bodoni Moda, `clamp(3rem, 7vw, 6rem)`, weight 500, line-height 1.02, letter-spacing `-0.04em`. Wrapped balanced at roughly 16 to 22ch so a line breaks like a cover.
- **Display**: Bodoni Moda, `4rem`, weight 500, line-height 1.05, letter-spacing `-0.035em`.
- **Headline (movement titles)**: Bodoni Moda, `2.75rem`, weight 500, line-height 1.1, letter-spacing `-0.02em`.
- **Lead (opening paragraph)**: Jost, `1.375rem`, weight 400, line-height 1.55.
- **Body (short)**: Jost, `1.0625rem`, weight 400, line-height 1.75, measure capped at 66ch.
- **Long read**: Newsreader, `1.125rem`, weight 400, line-height 1.7, measure capped at 68ch.
- **Chapter initial**: Bodoni Moda, raised three lines into the opening paragraph, weight 500, in ivory or champagne.
- **Label and ledger (meta)**: Jost, `0.75rem`, weight 500, uppercase, letter-spacing `0.24em`, on `text-muted`.

### Typography rules

**Serif Carries The Room Rule.** Only Bodoni gets to be large. The feeling of the page lives in the serif at scale, given room and set tight, so authority is earned by the space around it rather than by shouting.

**No Eyebrow Rule.** There is never a small tracked label directly above a heading. The Bodoni heading carries its own weight, and a movement opens with the raised chapter initial. Where meta is genuinely needed it lives in the margin ledger or the wall-label caption, apart from the heading, never as a kicker.

**Tight At The Top Rule.** Large display honours a tracking floor of `-0.04em` at the 6rem end and is never looser than `-0.02em` anywhere in the display range. A Didone set loose reads cheap.

**Air For Reading Rule.** Reading copy uses line-height 1.7 to 1.75 and a 66 to 68ch measure. Copy blocks stay narrow and offset, never full-width slabs. Anything past roughly three tight paragraphs hands off to Newsreader.

**Ledger Stays Small Rule.** The margin ledger is short tracked caps, place names and figures only, never a running sentence.

## 5. Elevation and Material

The system is almost entirely flat. Depth comes from photography, from the hairline thread, and from the vast negative space, not from shadow.

### Photography as one reel

Every full-bleed plate is graded as though it came from a single commissioned shoot, so the site never reads as stock assembled from many sources.

- **One grade.** A shared warm grade across all imagery, weighted to the lacquer hue so the photography and the ground belong together.
- **One grain.** A disciplined film grain held at about 6 percent, the same stock on every plate.
- **One scrim.** The `veil`, a ground-coloured gradient rising from the lower third, so headline and caption text always sit on calm tone and never on a busy region of the image.

### Shadow vocabulary

- **Floating Enquiry Bar:** `0 24px 60px oklch(8% 0.010 58 / 0.5)`. A real offset and a soft warm blur, the one genuine float on the page.
- **Focus Ring:** `0 0 0 2px var(--lacquer), 0 0 0 4px var(--gold-hairline-strong)`. An offset ring, never a halo.
- **No Card Shadow:** surfaces rest on hairlines and the ground shift, never on a drop shadow.

### Material rules

**Photography Is The Material Rule.** Depth and richness come from full-bleed imagery on one grade, graded with the veil where text must sit over it.

**Hairline First Rule.** A 1px gold hairline does the work a border or a shadow would do elsewhere. Add the line before you add anything heavier.

**No Glass Rule.** No blur panels, no glassmorphism, no glow. Translucency exists only in the veil and the focus ring.

**Sharp Corners Rule.** Radii are 0 by default. Buttons and inputs take `2px`. Rounded cards do not exist in this world.

## 6. Motion: One Gesture

There is a single authored motion, the **fade-rise**. A movement's content begins fully legible in its resting state, so a failed script never hides the page, and as it enters the viewport it lifts from `translateY(18px)` to `0` while opacity moves `0` to `1`, over `900ms` on `cubic-bezier(0.16, 1, 0.3, 1)`. That easing is an exponential ease-out, so content decelerates into place and settles without a bounce.

Items within one spread may stagger by `80ms`, but it is always the same gesture. There is no second animation, no clip-path or mask reveal, no parallax, no scroll-scrub and no per-section entrance. Hover and focus change colour and border over `200ms ease` and nothing more.

**Reduced motion.** Under `prefers-reduced-motion: reduce` the transform and the opacity ramp are removed entirely and the stagger is dropped. Content is simply present.

## 7. Components

### The stepped spread

Each movement is a magazine two-page logic on a stepped diagonal, not a loose "text opposite image".

- The photograph bleeds off a single edge across seven columns.
- The headline sits in columns 2 to 6.
- The standfirst drops to columns 8 to 12, a beat lower than the headline.
- The margin ledger and the wall-label caption hang into the outer gutter.
- The next movement flips the weight to the other side. The spine runs unbroken down column 1 the whole way.

### The field ledger (the spine)

A 1px champagne hairline down the outer margin, carrying the trip's real metadata in tracked Jost caps at `label` size on `text-muted`: destination, coordinates, season, folio. It climbs beside the scroll so the page's only structural ornament is also its running index. It never becomes an eyebrow because it lives in the margin, never above a heading.

### The wall-label caption

Set below-left of a plate, in tracked caps on `text-muted`: the place on the first line, a latitude and longitude line beneath, the year last. A quiet museum credit, the tasteful way to label photography.

### The single CTA

- **Primary:** champagne fill, `ink` text, `2px` radius, min-height 56px, horizontal padding `2rem`, Jost 500 tracked `0.08em`. One per view, for the enquiry.
- **Hover:** fill lifts to champagne-bright over 200ms. No transform, no bounce.
- **Focus:** the offset gold focus ring.
- **Disabled:** fill drops to lacquer-hover, text to text-disabled, cursor not-allowed.
- **Loading:** the label is replaced by a small brass spinner drawn from the icon set, and the button keeps its width so nothing reflows.

### Text link (every other action)

Ivory text with a champagne underline at `0.22em` offset. Hover moves the text to champagne over 200ms. Focus shows the ring. This is the default way to act on the page.

### Enquiry form

- **Input:** lacquer-deep fill, 1px gold-hairline border, ivory text, `2px` radius, padding `0.875rem 1rem`. Placeholder in text-muted, which clears 4.5:1.
- **Focus:** border moves to gold-hairline-strong plus the offset ring.
- **Error:** border and helper text in `error`, and the helper names the problem and the fix ("Enter an email so we can reply", not "Invalid input"). The error surface uses error-soft.
- **Success:** a brief line in the `success` colour, then the fade-rise on a thank-you movement.
- **Empty state:** before any enquiry exists, the panel shows a single Bodoni line and one text link, never a blank box.

### The stated line

An oversized Bodoni quote at display-xl scale in near-empty lacquer, with exactly one word carried in champagne. This replaces every callout, badge and pull-quote box.

### The chapter initial

A raised Bodoni initial, three lines deep, opening a movement's first paragraph in ivory or champagne. The couture alternative to a section label.

### Dividers

Structural dividers are a single 1px `gold-hairline`. Where gold would be too loud, use `rule-neutral`. Never a thick coloured border, never a `border-left` accent bar.

### Icons

One library, Phosphor at the Light weight, a fine roughly 1px stroke that matches the hairline. Rendered in `brass` or `text-muted`. Never emoji, never a unicode glyph, never mixed weights.

### Footer

Lacquer-deep, the wordmark in Bodoni, one gold hairline above it, links as text links. The quietest part of the page, a signature rather than a sitemap.

## 8. Do and Do Not

### Do

- Do leave space empty. The air is the luxury.
- Do let full-bleed photography carry the feeling, graded on one warm reel with about 6 percent grain and the veil where text sits over it.
- Do give the champagne spine a job by hanging the trip's real ledger off it, destination, coordinates, season and folio, in tracked caps down the margin.
- Do keep champagne-gold to the spine, a hairline, the mark, one word and one button per view.
- Do open a movement with a raised Bodoni initial and credit its photograph with a below-left wall-label caption.
- Do set every headline in Bodoni, give it room and hold the tracking at the `-0.04em` floor on the largest sizes.
- Do build movements as stepped asymmetric spreads, headline in columns 2 to 6, standfirst dropped to columns 8 to 12, weight flipping side to side down the scroll.
- Do hand the longest passages to Newsreader so a long read stays comfortable.
- Do tint every neutral warm, ground and text alike, with real chroma on the muted tiers.
- Do theme the browser surfaces, selection, caret, scrollbar, focus ring, link underline and tabular figures, from the palette.
- Do honour the one motion moment and the reduced-motion path.

### Do Not

- Do not use three equal feature cards, metric tiles or any card grid as page structure.
- Do not place a small tracked label above a heading. Meta lives in the margin ledger and the caption only, never as an eyebrow.
- Do not use purple, neon, gradient text, glass or glow.
- Do not use a system sans as the display voice. Bodoni carries display, always self-hosted.
- Do not spread champagne-gold across surfaces. It is a single thread that happens to carry information.
- Do not use charcoal, pure black or pure white, and do not drop the ground to a near-neutral grey. The world is warm lacquer.
- Do not add a second animation, a clip-path reveal, a mask or a scroll effect. One fade-rise only.
- Do not fill the negative space. If a container is tempting, the answer is more space, not a box.
