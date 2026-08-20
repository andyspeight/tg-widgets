---
name: Harlow & Wren
description: Quiet couture for a private-travel house that composes a few journeys a year by hand. A warm amber-brown lacquer ground, immense negative space, one champagne-gold thread that runs a bound-folio spine down the left margin, and a high-contrast Bodoni Moda over a quiet geometric sans, with a warm serif carrying the long reads.
mode: Persuade

colors:
  # Ground and surfaces (warm amber-brown lacquer, never charcoal)
  lacquer: "#1B1510"          # page ground, also the ink on a champagne fill
  lacquer-deep: "#14100B"     # footer, deepest inset, input fill, hero veil base
  lacquer-raised: "#241C13"   # the one floating panel, the enquiry form
  lacquer-hover: "#2C2318"    # a hovered surface, one quiet step up

  # The single metallic thread
  champagne: "#C8A96C"        # the one accent: spine, rules, one word, one CTA
  champagne-bright: "#DDC291" # hover lift on the accent
  brass: "#9A7E4A"            # icon strokes, heavier borders, the scrollbar thumb
  gold-hair: "rgba(200,169,108,.24)"        # default gold rule and divider
  gold-hair-strong: "rgba(200,169,108,.6)"  # active rule, focus ring, quiet-link underline
  rule: "rgba(244,237,223,.1)"              # the quietest ivory-tinted divider

  # Text ramp (all warm-tinted, so secondary text never reads flat grey)
  ivory: "#F4EDDF"           # display and headlines, warm white
  text: "#E7DFCF"            # body, ~12:1 on lacquer
  text-muted: "#B7A98D"      # captions, meta, placeholders, ~6:1
  text-faint: "#8E826A"      # decorative sub-labels and legal only
  ink: "#1B1510"             # text sitting on a champagne fill

fonts:
  display: "Bodoni Moda, Didot, \"Times New Roman\", serif"
  body: "Jost, system-ui, sans-serif"
  longform: "Newsreader, Georgia, serif"

typography:
  scale:
    micro: "9.5px"    # wordmark sub-label, tightest tracked caps
    tiny: "11px"      # figcaptions, the spine, field labels
    label: "12px"     # tracked caps meta, strip, buttons, the stated by-line
    small: "13px"     # hero foot, prices, meta lines
    body: "17px"      # the reading size (Jost)
    read: "18px"      # longform paragraphs (Newsreader)
    read-lg: "19px"   # opening longform paragraphs
    sub: "clamp(16px,1.4vw,19px)"    # hero standfirst
    title: "clamp(21px,2vw,27px)"    # step headings
    heading: "clamp(26px,3vw,42px)"  # movement titles
    stated: "clamp(28px,4.6vw,60px)" # the stated line
    consult: "clamp(30px,4vw,56px)"  # the consultation headline
    hero: "clamp(44px,8vw,104px)"    # the masthead h1
  hero:
    fontFamily: "Bodoni Moda, Didot, serif"
    fontSize: "clamp(44px,8vw,104px)"
    fontWeight: 500
    letterSpacing: "-0.035em"
    lineHeight: 0.98
  stated:
    fontFamily: "Bodoni Moda, Didot, serif"
    fontSize: "clamp(28px,4.6vw,60px)"
    fontWeight: 400
    letterSpacing: "-0.02em"
    lineHeight: 1.16
  heading:
    fontFamily: "Bodoni Moda, Didot, serif"
    fontSize: "clamp(26px,3vw,42px)"
    fontWeight: 500
    letterSpacing: "-0.02em"
    lineHeight: 1.08
  body:
    fontFamily: "Jost, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.75
  longform:
    fontFamily: "Newsreader, Georgia, serif"
    fontSize: "18px"
    fontWeight: 300
    lineHeight: 1.7
  wordmark:
    fontFamily: "Bodoni Moda, serif"
    fontSize: "23px"
    fontWeight: 500
    letterSpacing: "0.16em"
  label:
    fontFamily: "Jost, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    letterSpacing: "0.24em"
    textTransform: "uppercase"

spacing:
  page-margin: "clamp(22px,6vw,120px)"   # --pad, the single horizontal margin token
  measure: "66ch"                        # --measure, the reading cap
  section-tall: "clamp(84px,13vw,190px)" # the stated line and the largest sections
  section: "clamp(80px,11vw,170px)"      # how / consult vertical rhythm
  section-mid: "clamp(76px,10vw,150px)"  # the studio
  movement-gap: "clamp(64px,9vw,140px)"  # between stepped spreads
  spread-gap: "clamp(28px,4vw,72px)"     # column gap inside a spread
  nav: "24px"                            # header padding

radii:
  none: "0"      # the couture default: buttons, inputs, panels, images all sharp
  focus: "1px"   # the focus outline only
  pill: "99px"   # the scrollbar thumb only

motion:
  signature: "fade-rise"
  duration: "900ms"
  easing: "cubic-bezier(0.16, 1, 0.3, 1)"
  transform: "translateY(18px) to translateY(0)"
  opacity: "0 to 1"
  stagger: "80ms up to 160ms, cycling every three items"
  ui: "200ms ease"                       # button colour
  underline: "300ms cubic-bezier(0.16, 1, 0.3, 1)"  # the nav underline wipe
  press: "100ms ease"                    # the button active nudge
  reducedMotion: "no transform, no opacity ramp, no stagger, scroll-behavior auto, content simply present"
---

# Design World: Harlow & Wren

## 1. Overview: The Bound Folio

Harlow & Wren is a private-travel house above a bookbinder's in Fitzrovia that composes around forty journeys a year, one designer to one traveller. The site should feel like a folio of those journeys, hand-set and bound, not a catalogue. The North Star is **The Bound Folio**: the page reads as a few pages from a private book, each journey shown "as it was composed", carried by a champagne spine down the outer margin that names the house and the year in Roman numerals. Authority comes from restraint and from the sense that only a few of these exist, not from volume.

The world is a warm amber-brown lacquer ground with immense negative space, a single champagne-gold thread of colour, and a high-contrast Bodoni Moda that carries every headline. A quiet geometric sans keeps the controls and short copy out of the way, and every long passage hands off to a warm serif so a long scroll never tires the eye. There are no feature cards, no metric tiles, no eyebrow labels and no coloured panels. There is photography on one warm grade, air, one serif voice and one thread of gold that also does a job.

**Key characteristics**

- A warm amber-brown lacquer ground, `#1B1510`, never black and never charcoal.
- Immense negative space, set by tall section clamps, as the primary luxury signal.
- One metallic accent, champagne-gold `#C8A96C`, rationed like a single thread.
- A champagne spine down the left margin carrying the house, the folio and the year in vertical tracked caps, so the one ornament also reads.
- A high-contrast modern serif (Bodoni Moda) for display, a quiet geometric sans (Jost) for UI and short copy, a warm serif (Newsreader) at weight 300 for the longest reads.
- Full-bleed and framed photography on one warm grade, `saturate(.8) contrast(.98) sepia(.06)`.
- Journeys built as stepped asymmetric spreads that flip weight side to side down the scroll.
- One motion moment, the fade-rise, and nothing else.

## 2. The Kit: One Vocabulary For Every Page

Every Harlow & Wren page is built from the same small vocabulary. Reach for these before inventing anything, and invent only for a genuinely bespoke editorial moment, a hero plate or a unique photographic treatment. Do not reinvent a button, a rule or a spread.

- **Movements, not sections.** A journey is a stepped asymmetric spread of photograph and offset text, `7fr / 5fr` one way then `5fr / 7fr` the next, separated by the `movement-gap` rhythm.
- **The folio spine.** A 1px champagne hairline runs the left margin, carrying vertical tracked caps: the house name, "Private Travel", and "Folio MMXXVI". The one structural ornament is also the running index. It hides below 1080px.
- **The stated line.** An oversized Bodoni line in near-empty space with one clause carried in champagne italic, followed by a small tracked by-line. This lands a point in place of any callout box.
- **The wall-label caption.** Photography is credited below in tracked caps: place on the left, a season or a moment on the right. A museum label, never a kicker.
- **The numbered movements of process.** "How we work" is three steps marked I, II, III in Bodoni champagne, because the sequence itself is the information.
- **Type roles.** Display and headlines are Bodoni. UI, controls, the strip and short copy are Jost. The longest passages are Newsreader at weight 300. Tracked caps in Jost carry meta, never above a heading.
- **One CTA.** A single filled champagne button per view, for the enquiry. Every other action is a text link with a gold underline.

If a shape is not covered here it is almost certainly not needed. The instinct to add a container is the instinct to fill the space, and the space is the point.

## 3. Colours: Lacquer and One Thread

### Ground and surface

- **Lacquer** `#1B1510`: the page ground. Warm, deep, mineral, the colour of dark lacquered wood. It doubles as the ink on a champagne fill.
- **Lacquer Deep** `#14100B`: the footer, the deepest inset, input fills, and the base tone of the hero veil.
- **Lacquer Raised** `#241C13`: the one floating panel, the enquiry form.
- **Lacquer Hover** `#2C2318`: a hovered surface, one quiet step up.

### The single thread

- **Champagne** `#C8A96C`: the one accent. The spine, hairline rules, the emphasised word, the single CTA fill. Nothing else.
- **Champagne Bright** `#DDC291`: hover lift on the accent.
- **Brass** `#9A7E4A`: a deeper metallic for icon strokes, heavier borders and the scrollbar thumb.
- **Gold Hair** `rgba(200,169,108,.24)`: the default rule and divider.
- **Gold Hair Strong** `rgba(200,169,108,.6)`: active rules, the focus ring, the quiet-link underline.
- **Rule** `rgba(244,237,223,.1)`: the quietest ivory-tinted divider, used where gold would be too much (the strip, nav and section tops).

### Text

- **Ivory** `#F4EDDF`: display and headlines. Warm, not cold white.
- **Text** `#E7DFCF`: body copy, about 12:1 on lacquer.
- **Text Muted** `#B7A98D`: captions, meta, tracked labels and placeholders, about 6:1. Warm off-white, never grey. Everything a reader must actually read sits here or brighter, so placeholders clear 4.5:1.
- **Text Faint** `#8E826A`: decorative sub-labels, the form note and legal lines only. Never load essential words onto this tier.
- **Ink** `#1B1510`: text sitting on a champagne fill.

### Browser surfaces

Every surface the browser would otherwise leave in defaults is themed from the palette, exactly as the source ships.

- **Selection**: background `rgba(200,169,108,.28)`, text ivory.
- **Caret**: champagne.
- **Focus ring**: 2px solid `gold-hair-strong`, 3px offset, 1px radius.
- **Scrollbar**: 11px, brass thumb with a 3px lacquer-deep border on a lacquer-deep track, thin, `scrollbar-color: brass lacquer-deep`.
- **Link underline**: `gold-hair-strong`, `text-underline-offset: 0.22em`, moving to champagne on hover.

### Colour rules

**The One Thread Rule.** Champagne-gold is rationed. It is allowed on the spine, a hairline, one emphasised word and one button per view. If more has crept in, pull it back to lacquer.

**The Warm Everything Rule.** Every neutral is tinted warm and the muted tiers stay legible. Secondary text is warm off-white, never flat grey. The ground is amber-brown, never charcoal and never the near-neutral grey of a gallery wall.

**The No Coloured Panels Rule.** Colour lives in the photography and the thread. Surfaces are lacquer. There are no tinted cards, no gradient fills and no purple.

## 4. Typography: Bodoni Speaks, Jost Whispers, Newsreader Carries the Long Read

**Display:** Bodoni Moda, Didot, "Times New Roman", serif. A high-contrast Didone. This is the couture voice and it carries every headline, at weight 500, with the hero's emphasis set in italic at weight 400.

**UI and short body:** Jost, system-ui, sans-serif. A quiet geometric sans at weight 400. It runs the strip, the nav, controls, captions and short copy, and the tracked caps of the spine and labels.

**Long read:** Newsreader, Georgia, serif, held at weight 300. A warm serif for the longest editorial passages, the journey copy and the process steps, where a geometric sans would start to tire the eye. It is invisible by design, a reading aid, never a display voice.

The tension between a dramatic modern serif and a calm geometric sans is the whole typographic story. Newsreader sits beneath it, doing the reading work so Bodoni never has to shrink.

### Hierarchy

- **Wordmark**: Bodoni Moda, `23px`, weight 500, letter-spacing `0.16em`, ivory, with a `9.5px` Jost sub-label in champagne tracked `0.34em`.
- **Hero (masthead)**: Bodoni Moda, `clamp(44px,8vw,104px)`, weight 500, line-height 0.98, letter-spacing `-0.035em`, in ivory, capped near 15ch and balanced. The emphasis clause is italic weight 400.
- **Stated line**: Bodoni Moda, `clamp(28px,4.6vw,60px)`, weight 400, line-height 1.16, letter-spacing `-0.02em`, capped at 20ch, one clause in champagne italic.
- **Movement and section titles**: Bodoni Moda, `clamp(26px,3vw,42px)`, weight 500, line-height 1.08, letter-spacing `-0.02em`.
- **Step number**: Bodoni Moda Roman numeral, `clamp(22px,2vw,28px)`, weight 400, champagne.
- **Body (short)**: Jost, `17px`, weight 400, line-height 1.75.
- **Long read**: Newsreader, `18px` to `19px`, weight 300, line-height 1.68 to 1.72, capped near 44 to 58ch.
- **Label and meta**: Jost, `11px` to `12px`, weight 500, uppercase, letter-spacing `0.20em` to `0.42em`, on champagne or text-muted.

### Typography rules

**The Serif Carries the Room Rule.** Only Bodoni gets to be large. The feeling of the page lives in the serif at scale, set tight and given room, so authority is earned by the space around it rather than by shouting.

**The No Eyebrow Rule.** There is never a small tracked label directly above a heading. The Bodoni heading carries its own weight. Meta lives in the spine, the caption or a below-heading by-line, never as a kicker.

**The Tight At the Top Rule.** Large display holds a tracking floor of `-0.035em` at the hero and is never looser than `-0.02em` anywhere in the display range. A Didone set loose reads cheap.

**The Air For Reading Rule.** Reading copy uses line-height 1.68 to 1.75 and a measure capped at 44 to 66ch, offset and narrow, never a full-width slab. Any passage past a few tight paragraphs is Newsreader.

## 5. Elevation and Material

The system is almost entirely flat. Depth comes from photography, from the hairline thread, and from the vast negative space, not from shadow.

### Photography as one reel

Every plate is graded as though it came from a single commissioned shoot, so the site never reads as stock assembled from many sources.

- **One grade.** `filter: saturate(.8) contrast(.98) sepia(.06) brightness(.9)` across all imagery, weighted warm to the lacquer hue.
- **One veil.** The hero plate carries a two-part lacquer-deep gradient, rising from `rgba(20,16,11,.92)` at the foot to near-clear at two thirds, plus a left-to-right wash, so the masthead always sits on calm tone.
- **Framed figures.** Journey and studio photographs are set in fixed aspect ratios, `4/5` and `5/4` alternating, `4/5` for the studio, with a below-left caption in tracked caps.

### Material rules

**The Hairline First Rule.** A 1px gold hairline does the work a border or a shadow would do elsewhere: section tops, the spine, the form border, dividers. Add the line before you add anything heavier.

**The No Glass Rule.** No blur panels, no glassmorphism, no glow, no drop shadows on surfaces. Translucency exists only in the gold hairlines, the rule tint and the hero veil.

**The Sharp Corners Rule.** Radii are 0 by default. Buttons, inputs, panels and images are all sharp. The only curves in the world are the 1px focus outline and the 99px scrollbar thumb.

## 6. Motion: One Gesture

There is a single authored motion, the **fade-rise**. Content begins fully legible in its resting state, so a failed script never hides the page, and as it enters the viewport it lifts from `translateY(18px)` to `0` while opacity moves `0` to `1`, over `900ms` on `cubic-bezier(0.16, 1, 0.3, 1)`. That easing is an exponential ease-out, so content decelerates into place and settles without a bounce. The hero masthead ships already-in, so the top of the page never waits on the observer.

Items entering together stagger by `80ms`, cycling every three so the delay caps at `160ms`. There is no second animation, no clip-path or mask reveal, no parallax and no scroll-scrub. The only other transitions are the nav underline, which wipes in over `300ms` on the same easing, the button colour over `200ms ease`, and a `1px` press nudge over `100ms`.

**Reduced motion.** Under `prefers-reduced-motion: reduce` every animation and transition is removed, smooth scrolling drops to auto, and the fade-rise content is simply present.

## 7. Components

### The stepped spread (a movement)

Each journey is a two-column spread, photograph and offset text, `7fr / 5fr` on odd movements and `5fr / 7fr` on even, the figure and text swapping order so weight flips side to side down the scroll. The text column caps at 44ch, opens with a Bodoni title, runs Newsreader body, then a muted price line and a champagne "Discuss this journey" text link. Below 900px the spread stacks to one column and the figure returns to a `16/10` frame.

### The folio spine

A fixed 1px champagne hairline down the left margin at `page-margin` width, carrying vertical tracked caps (`writing-mode: vertical-rl`, rotated) in `11px` Jost at `0.42em`: the house name, "Private Travel", and "Folio MMXXVI" with the year in champagne. Pointer-events off, decorative, hidden below 1080px. It never becomes an eyebrow because it lives in the margin, never above a heading.

### The single CTA

- **Primary:** champagne fill, `ink` text, sharp corners, min-height 44px, horizontal padding 26px, Jost 500 tracked `0.16em` uppercase, `12px`. One per view, for the enquiry.
- **Hover:** fill and border lift to champagne-bright over `200ms ease`.
- **Active:** a `1px` downward nudge over `100ms`.
- **Ghost variant:** transparent fill, champagne text, `gold-hair-strong` border, for a secondary action only where a filled button would be a second thread.

### Text link (every other action)

Ivory or champagne text with a `gold-hair-strong` underline at `0.22em` offset. Hover moves the text and border to champagne over `200ms`. This is the default way to act on the page. The nav variant carries a champagne underline that wipes in from the left over `300ms`.

### Enquiry form

- **Panel:** lacquer-raised, a 1px gold-hair border, sharp corners, generous padding.
- **Field:** a transparent input with a single `gold-hair` bottom border, ivory text, Jost `16px`, min-height 44px. The label is `11px` champagne tracked caps.
- **Focus:** the bottom border moves to champagne, plus the browser focus ring.
- **Placeholder:** text-muted, clearing 4.5:1.
- **Note:** a text-faint line beside the submit, one honest sentence, never a marketing promise.

### The stated line

An oversized Bodoni line at the `stated` scale in near-empty lacquer, one clause in champagne italic, closed by a small tracked Jost by-line in text-muted. This replaces every callout, badge and pull-quote box.

### The process steps

A bordered list with a Bodoni Roman numeral (I, II, III) in champagne, a Bodoni title and a Newsreader body, divided by gold hairlines. Numbers appear here only because the sequence carries meaning; they are not a decorative device to reuse elsewhere.

### Dividers

A single 1px `gold-hair`, or the quieter `rule` tint where gold would be too loud. Never a thick coloured border, never a `border-left` accent bar.

### Footer

Lacquer-deep, the wordmark in Bodoni, a gold hairline above it, links as text-muted links that warm to champagne on hover. The quietest part of the page, a signature rather than a sitemap.

## 8. Do and Do Not

### Do

- Do leave space empty. The air is the luxury, set by the tall section clamps.
- Do let photography carry the feeling, graded on one warm reel with the hero veil where text sits over it.
- Do give the champagne spine a job, carrying the house, the folio and the year in vertical tracked caps down the left margin.
- Do keep champagne-gold to the spine, a hairline, one word and one button per view.
- Do set every headline in Bodoni, give it room and hold the tracking at the `-0.035em` floor on the hero.
- Do build journeys as stepped asymmetric spreads, weight flipping side to side down the scroll.
- Do hand the longest passages to Newsreader at weight 300 so a long read stays comfortable.
- Do tint every neutral warm, ground and text alike, so muted text reads off-white not grey.
- Do theme the browser surfaces, selection, caret, scrollbar, focus ring and link underline, from the palette.
- Do honour the one fade-rise moment and its reduced-motion path.

### Do Not

- Do not use three equal feature cards, metric tiles or any card grid as page structure.
- Do not place a small tracked label above a heading. Meta lives in the spine and the caption only, never as an eyebrow.
- Do not use purple, neon, gradient text, glass or glow.
- Do not use a system sans as the display voice. Bodoni carries display, always.
- Do not spread champagne-gold across surfaces. It is a single thread that happens to carry information.
- Do not use charcoal, pure black or pure white, and do not drop the ground to a near-neutral grey. The world is warm lacquer.
- Do not add a second animation, a clip-path reveal, a mask or a scroll effect. One fade-rise only.
- Do not number a plain sequence for decoration. Roman numerals belong to a genuine ordered process, nowhere else.
- Do not fill the negative space. If a container is tempting, the answer is more space, not a box.
