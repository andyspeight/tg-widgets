---
name: Aurelia
description: A small London studio arranging a limited book of luxury escapes each year. Warm ebony ground lit by candle-gold, an ivory light interlude, a high-contrast Playfair Display Didone that turns one word italic and gold, and Manrope running quietly beneath it. The page of a studio that answers its own phone.
mode: Persuade

colors:
  # Ground and surfaces (a warm near-black brown, hue of dark wood and low light, never charcoal)
  ebony: "#161009"                 # page ground
  ebony-soft: "#221709"            # base tone of the floating escape card fill
  smoke: "rgba(22,16,9,.55)"       # ground-coloured wash over imagery
  card-fill: "rgba(34,23,9,.72)"   # the blurred escape card, ebony-soft at 72%

  # The two ivories (the light interlude ground and the text on dark)
  ivory: "#F3EDE3"                 # primary text on ebony, and the light-section ground
  ivory-deep: "#EAE1D2"            # the deeper ivory step

  # Candle-gold, the studio's one accent
  gold: "#D8A94E"                  # the accent: italic emphasis word, labels, links, the one filled button
  gold-bright: "#E5BC66"           # hover lift on the gold button
  gold-ink: "#8A6A24"              # gold set as text or focus ring on ivory, holds AA
  gold-soft: "rgba(216,169,78,.35)" # gold at low alpha for rings, hairline underlines, the CTA ring

  # Text tints (warm, never flat grey)
  mist: "#B9AE9C"                  # secondary text on ebony, warm taupe
  text-faint: "#7E7462"            # placeholders, fine print, legal line, ~4.6:1 on ebony

  # Hairlines
  line-dark: "rgba(243,237,227,.16)"  # divider and border on the ebony ground
  line-light: "rgba(22,16,9,.16)"     # divider and border on the ivory interlude

fonts:
  display: "'Playfair Display', Georgia, serif"
  body: "Manrope, system-ui, sans-serif"

typography:
  scale:
    micro: "0.594rem"     # 9.5px, the wordmark's tracked subtitle only
    label: "0.6875rem"    # 11px, tracked caps meta and form labels
    kicker: "0.75rem"     # 12px, tracked caps (see the note on kickers)
    small: "0.844rem"     # 13.5px, nav pills, quiet links
    sub: "0.969rem"       # 15.5px, hero standfirst and strip copy
    body: "1rem"          # 16px, the reading size
    subtitle: "1.125rem"  # 18px, promise-list headings
    lead: "1.5rem"        # 24px, the ivory statement line
    title: "1.5625rem"    # 25px, escape-card headings
    headline: "clamp(1.875rem, 3.4vw, 2.875rem)"  # 30-46px, section titles
    quote: "clamp(1.375rem, 2.6vw, 2.125rem)"     # 22-34px, the guest word
    display: "clamp(2.375rem, 4.6vw, 4rem)"       # 38-64px, the hero line
  display:
    fontFamily: "'Playfair Display', Georgia, serif"
    fontSize: "clamp(2.375rem, 4.6vw, 4rem)"
    fontWeight: 500
    lineHeight: 1.12
    letterSpacing: "0.005em"
  headline:
    fontFamily: "'Playfair Display', Georgia, serif"
    fontSize: "clamp(1.875rem, 3.4vw, 2.875rem)"
    fontWeight: 500
    lineHeight: 1.15
    letterSpacing: "0.005em"
  quote:
    fontFamily: "'Playfair Display', Georgia, serif"
    fontSize: "clamp(1.375rem, 2.6vw, 2.125rem)"
    fontWeight: 400
    fontStyle: "italic"
    lineHeight: 1.4
  lead:
    fontFamily: "'Playfair Display', Georgia, serif"
    fontSize: "clamp(1.1875rem, 1.8vw, 1.5rem)"
    fontWeight: 500
    lineHeight: 1.3
  numeral:
    fontFamily: "'Playfair Display', Georgia, serif"
    fontSize: "1.375rem"     # 22px, the roman numerals on the promise list
    fontWeight: 400
    color: "gold"
  body:
    fontFamily: "Manrope, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.65
  subtitle:
    fontFamily: "Manrope, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.4
  label:
    fontFamily: "Manrope, system-ui, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 700
    letterSpacing: "0.2em"
    textTransform: "uppercase"
  wordmark:
    fontFamily: "'Playfair Display', Georgia, serif"
    fontSize: "1.625rem"     # 26px
    fontWeight: 600
    letterSpacing: "0.06em"

spacing:
  # Observed from the build; no numeric scale token set exists in :root, these are the rhythms actually used
  3xs: "0.25rem"
  2xs: "0.5rem"
  xs: "0.875rem"    # card padding, input padding
  sm: "1.125rem"    # card and cluster gaps
  md: "1.625rem"    # nav padding
  lg: "2.125rem"    # section-head bottom on small ends
  xl: "3.25rem"     # hero-inner gap
  section: "clamp(5rem, 9vw, 8.125rem)"     # 80-130px, vertical rhythm between movements
  page-margin: "clamp(1.25rem, 4vw, 3.5rem)" # 20-56px, the horizontal frame
  max-width: "1500px"
  measure: "52ch"   # widest reading column used (promise copy); most sit 34-46ch

radii:
  focus: "4px"      # the focus-visible corner
  thumb: "12px"     # the small square escape thumbnail
  card: "18px"      # --r-card, every card, panel and form
  pill: "999px"     # --r-pill, nav pills, gold button, chips

motion:
  signature: "reveal"
  duration: "500ms"
  easing: "ease-out"
  transform: "translateY(16px) to translateY(0)"
  opacity: "0 to 1"
  ui: "200ms ease-out"        # hover and focus, colour and border only
  imageZoom: "600ms ease"     # escape photo lifts to scale 1.035 on hover
  crossfade: "1100ms ease"    # the ambient hero background dissolve, 7s cadence
  scrollCue: "2400ms ease-in-out infinite"  # the scroll chevron's slow bob
  reducedMotion: "all animation and transition removed, reveals present, smooth scroll off, slider frozen"
---

# Design World: Aurelia

## 1. Overview: By Invitation

Aurelia is a small London studio that arranges a limited book of luxury escapes each year, and the site should feel like being let in rather than sold to. It sells fewer trips than it is asked to, and the page carries that confidence: unhurried, warmly lit, and personal enough that a real designer answers their own phone. The authority comes from restraint and from warmth at the same time, the low light of a private room, not the glare of a shop window.

The world is a warm near-black ebony ground, the colour of dark wood in low light, lit by a single candle-gold accent. Playfair Display, a high-contrast Didone, carries every headline and turns exactly one word italic and gold to land the point. Manrope runs quietly beneath it for copy, controls and meta. Twice in the scroll the page steps into an ivory interlude, the statement strip and the guest word, so the gold reads warmer for the contrast. Photography is graded on one warm reel and set into rounded cards with soft blurred surfaces. This is a furnished, tactile luxury, not an empty gallery.

**Key characteristics**

- A warm ebony ground, hue of dark wood and low candlelight, never charcoal and never pure black.
- Two ivory interludes that lift out of the dark, so the page breathes light then returns to the dark.
- One candle-gold accent, used with intent: the italic emphasis word, tracked labels, links, numerals and the single filled button.
- A high-contrast Playfair Display Didone for display, its emphasis word set italic and gold. Manrope for everything else.
- The italic gold word as the studio's signature gesture, one per heading, never more.
- Roman numerals (I, II, III) for the ordered promise, because the order of service is the information.
- Rounded 18px cards with a soft blurred fill floating over photography, a warm and furnished depth.
- One authored entrance, the reveal, with a few ambient background motions, all gated on reduced motion.

## 2. The Kit: One Vocabulary For Every Page

Every Aurelia page is built from a small, warm vocabulary. Reach for these before inventing anything.

- **Movements on a stepped grid.** A page is a sequence of asymmetric spreads on a 5/4/4 or 6/5 column split, the escapes stepped down a diagonal (`margin-top` climbing across the three cards). Use the `section` rhythm between them.
- **The ivory interlude.** Twice, the page steps from ebony into an ivory panel, the statement strip and the guest word. These are the light beats that make the gold read warm.
- **The italic gold word.** A Playfair heading lands its point by setting one phrase in italic gold. This is the studio's signature and it replaces any callout or badge.
- **The gold pill.** One filled candle-gold button per view, pill-shaped, for the enquiry. Every other action is a tracked-caps link with a gold-soft underline.
- **The floating escape card.** A rounded, blurred card carrying one featured escape over the hero photography, with a saved-heart control and a small side thumbnail.
- **The ordered promise.** A roman-numeralled list of how the studio works, numerals in Playfair gold, headings in Manrope.
- **Type roles.** Display, headlines, the statement line, the guest quote and the numerals are Playfair. Body, labels, controls and meta are Manrope. The gold italic word is Playfair.

If a shape is not covered here it is almost certainly not needed. The warmth is the luxury, not the furniture count.

## 3. Colours: Ebony, Ivory and Candle-Gold

Colours are declared in the source's own hex and rgba. Keep them as written; never state a value in prose that differs from the frontmatter.

### Ground and surface

- **Ebony** `#161009`: the page ground. A warm near-black brown, the colour of dark wood in low light.
- **Ebony Soft** `#221709`: the base tone the floating escape card is mixed from.
- **Card Fill** `rgba(34,23,9,.72)`: the escape card itself, ebony-soft at 72% over a blur.
- **Smoke** `rgba(22,16,9,.55)`: a ground-coloured wash for grading imagery down.

### The two ivories

- **Ivory** `#F3EDE3`: primary text on ebony, and the ground of the two light interludes.
- **Ivory Deep** `#EAE1D2`: the deeper ivory step, for a quiet second surface in the light.

### Candle-gold

- **Gold** `#D8A94E`: the one accent. The italic emphasis word, tracked labels, links, numerals, the progress bar and the single filled button.
- **Gold Bright** `#E5BC66`: the hover lift on the gold button only.
- **Gold Ink** `#8A6A24`: gold set as text or a focus ring on the ivory interlude, darkened to hold AA.
- **Gold Soft** `rgba(216,169,78,.35)`: gold at low alpha, for the CTA ring, link underlines and soft borders.

### Text

- **Ivory** `#F3EDE3`: display, headlines and body on ebony. Warm, not cold white.
- **Mist** `#B9AE9C`: secondary text on ebony, a warm taupe. Everything a reader must actually read sits here or brighter.
- **Text Faint** `#7E7462`: placeholders, fine print, the legal line, about 4.6:1 on ebony. Never load an essential sentence onto this tier.

### Hairlines

- **Line Dark** `rgba(243,237,227,.16)`: the divider and border on the ebony ground.
- **Line Light** `rgba(22,16,9,.16)`: the divider and border on the ivory interlude.

### Browser surfaces

Theme every surface the browser would otherwise leave in defaults; the build already sets the first two.

- **Selection**: background `gold`, text `ebony`.
- **Focus ring**: `2px` solid `gold`, offset `3px`, corner `4px`. On the ivory interlude the ring is `gold-ink` so it holds against the light.
- **Caret**: `gold` on ebony, `gold-ink` on ivory, derived from the accent (not set in source, add it).
- **Scrollbar**: a `mist` thumb on the `ebony` track, thin, derived from the palette (not set in source, add it).
- **Link underline**: the tracked-caps links carry a `gold-soft` bottom border; keep `text-underline-offset` at about `0.22em` on any inline underline.

### Colour rules

**The Warm Dark Rule.** The ground is warm ebony, hue of wood and low light, and every neutral is tinted with it. Secondary text is warm taupe mist, never flat grey. Never drop the ground to charcoal or pure black.

**The Candle-Gold Rule.** Gold is the studio's one accent and it is used with intent, not scattered. It belongs to the italic emphasis word, tracked labels, links, numerals and the single filled button. It is not a second surface colour and there are no gold fills beyond that one button.

**The Ivory Interlude Rule.** The light beats are ivory, only twice, only for the statement strip and the guest word. On ivory, gold becomes `gold-ink` so it stays legible and passes AA. Do not add more light panels; the dark is home.

## 4. Typography: Playfair Speaks, Manrope Answers

**Display:** 'Playfair Display', Georgia, serif. A true high-contrast Didone at weight 500 with a whisper of positive tracking (`0.005em`). This is the studio's voice and it carries every headline, the statement line, the guest quote and the numerals.

**Body and UI:** Manrope, system-ui, sans-serif. A calm geometric sans at 16px on 1.65 line-height. It runs copy, controls, labels and all tracked meta, and it stays out of the way so Playfair never has to shrink.

The tension between a dramatic Didone and a quiet geometric sans is the whole typographic story. Playfair carries the feeling; Manrope carries the reading.

### Hierarchy

- **Wordmark**: Playfair Display, `1.625rem` (26px), weight 600, letter-spacing `0.06em`, with a Manrope tracked subtitle beneath at 9.5px, `0.5em`, uppercase, in gold.
- **Display (hero)**: Playfair Display, `clamp(2.375rem, 4.6vw, 4rem)`, weight 500, line-height 1.12. One phrase set italic and gold.
- **Headline (section titles)**: Playfair Display, `clamp(1.875rem, 3.4vw, 2.875rem)`, weight 500, with one italic gold `em`.
- **Statement line**: Playfair Display, `clamp(1.1875rem, 1.8vw, 1.5rem)`, weight 500, on the ivory interlude.
- **Guest quote**: Playfair Display italic, `clamp(1.375rem, 2.6vw, 2.125rem)`, weight 400, line-height 1.4.
- **Numeral**: Playfair Display, `1.375rem` (22px), weight 400, in gold, for the ordered promise.
- **Card and list heading**: Manrope, `1.125rem` (18px), weight 600. Playfair on the escape cards at 17-25px weight 500.
- **Body**: Manrope, `1rem`, weight 400, line-height 1.65.
- **Label and meta**: Manrope, `0.6875rem` (11px), weight 700, uppercase, letter-spacing `0.2em`, in gold.

### Typography rules

**The Italic Gold Word Rule.** A Playfair heading lands its point by setting exactly one phrase in italic gold, once per heading. It is the studio's signature. Two gold words in one heading is one too many; the second is just ink.

**Playfair Carries The Room Rule.** Only Playfair gets to be large. The feeling of the page lives in the Didone at scale, given room and the slight positive tracking the build sets. Manrope never grows into a display voice.

**Air For Reading Rule.** Reading copy uses Manrope at 16px on 1.65 line-height, measures held between 34 and 52ch, offset and narrow, never a full-width slab.

## 5. Elevation and Material

The system is warm and lightly furnished. Depth comes from graded photography, soft blur, rounded corners and hairlines, not from hard drop shadows.

### Photography as one reel

Every plate is graded to one warm look so the site never reads as assembled stock.

- **One grade.** A shared `saturate(.82) contrast(1.04) brightness(.9)` across hero and escape imagery, weighted warm toward the ebony ground.
- **One scrim.** A layered radial-and-linear ebony gradient (the hero scrim and the card `veil`) rising from the lower third, so headline and caption text always sit on calm tone.

### Surfaces and depth

- **The blurred card.** The escape card and the nav pills float over imagery on a `backdrop-filter: blur` (10px on the card, 6px on the pills) with `card-fill` and a `line-dark` border. This soft glass is native to the world; keep it for elements that sit over photography.
- **Rounded corners.** Cards, panels and the form take `18px`. Thumbnails take `12px`. The pill controls and the gold button take the full `999px`.
- **Hairlines do the dividing.** A 1px `line-dark` (or `line-light` on ivory) separates movements and rows. Reach for the line before anything heavier.
- **No hard drop shadows.** Depth is blur, grade and hairline. There is no offset box-shadow in this world.

### Material rules

**The Soft Glass Rule.** Elements that float over photography, the escape card and the nav pills, carry a real backdrop blur and a hairline border. This is the furnished warmth of the world, not a violation; keep it, but only over imagery, never over flat ebony.

**Rounded, Not Sharp Rule.** Corners are soft here: `18px` on cards, `12px` on thumbs, `999px` on pills. This is a warmer luxury than a hard-cornered couture house, and the radii are the tell.

## 6. Motion: One Entrance, A Few Ambient Beats

The one authored entrance is the **reveal**. Content begins fully legible in its resting state, so a failed script never hides the page, and as a block enters the viewport it lifts from `translateY(16px)` to `0` while opacity moves `0` to `1`, over `500ms` on `ease-out`. It fires once per block and then releases the observer.

A few ambient motions support it and never compete: the hero background dissolves between plates over `1100ms` on a slow 7-second cadence, the scroll chevron bobs gently (`2400ms ease-in-out`), and an escape photo lifts to `scale(1.035)` over `600ms` on hover. Hover and focus change colour and border over `200ms ease-out` and nothing more. There is no parallax and no scroll-scrub.

**Reduced motion.** Under `prefers-reduced-motion: reduce` every animation and transition is removed, reveals are shown present, smooth scroll is off, and the hero slider is frozen on its first plate. The page is simply there.

## 7. Components

### The stepped escape grid

Three escapes on a `5fr 4fr 4fr` grid, each card stepped lower than the last (`margin-top` climbing) so the row reads as a diagonal, not a row of tiles. Each is a 4:5 photograph on the shared grade with a rising `veil`, a tracked-caps place-and-season line in gold, a Playfair title and a quiet "from" price. On hover the photo lifts to `scale(1.035)`.

### The floating escape card

A rounded blurred card over the hero, carrying one featured escape: a square thumbnail, a Playfair title, a line of copy, a gold pill and a circular save control, with a tall side thumbnail alongside. The soft glass belongs here because it sits over photography.

### The gold pill (the one CTA)

- **Primary:** `gold` fill, `ebony` text, pill radius, Manrope 700 tracked `0.1em` uppercase. One filled button per view, for the enquiry.
- **Hover:** fill lifts to `gold-bright` with a 1px rise. **Active:** a `scale(.97)` press.
- **Focus:** the `gold` focus ring at 2px, offset 3px.

### Tracked-caps link (every other action)

Gold uppercase text tracked `0.12em` with a `gold-soft` bottom border. Hover moves the text and border to ivory. This is the default way to act on the page, in place of a second button.

### The circular hero CTA

A 112px ring with an inset second ring in gold that draws inward on hover (`inset 10px` to `5px`), label in tracked Manrope. The studio's one ornamental call, used once in the hero.

### The ordered promise

A roman-numeralled list (I, II, III), numerals in Playfair gold, headings in Manrope 600, copy in mist. The numerals are canon here because the sequence is the order of service, information the reader needs, not decoration.

### Enquiry form

- **Input:** transparent fill with a `line-dark` bottom-border only, ivory text in Manrope, a gold tracked-caps label above, min-height 44px. Placeholder in `text-faint`, which clears the reading floor.
- **Focus:** the bottom border moves to `gold`.
- **Submit:** the gold pill, with one line of plain reassurance beneath ("One designer will call, once").

### The ivory interlude

The statement strip and the guest word invert to an ivory ground with ebony text, gold becoming `gold-ink`, dividers becoming `line-light`. Light beats between the dark movements.

### Icons

One set of fine stroke SVG icons, `1.6` stroke on `currentColor`, rounded caps and joins, at 20px. Rendered in ivory, mist or gold. Never emoji, never a unicode glyph.

### Footer

Ebony, a `line-dark` rule above, the Playfair wordmark, an address and quiet mist links, with the ABTA and ATOL protection stated plainly. The calm signature at the foot of the page.

## 8. Do and Do Not

### Do

- Do keep the ground warm ebony, the colour of wood in low light, and tint every neutral with it.
- Do land each heading with exactly one italic gold word, the studio's signature gesture.
- Do use candle-gold with intent: the emphasis word, tracked labels, links, numerals and the one filled button.
- Do let the page breathe into an ivory interlude twice, and darken gold to `gold-ink` there so it holds AA.
- Do grade all photography on one warm reel and set it into rounded cards with a rising scrim where text sits over it.
- Do use the soft backdrop blur for cards that float over imagery, and hairlines for everything on flat ground.
- Do number the ordered promise in Playfair gold roman numerals, because the sequence carries information.
- Do theme the browser surfaces from the palette: selection, caret, scrollbar, focus ring and link underline.
- Do honour the one reveal entrance and the reduced-motion path, and keep the ambient beats gentle.

### Do Not

- Do not use charcoal, pure black or pure white. The world is warm ebony and warm ivory.
- Do not place a small tracked kicker directly above a heading. The Playfair heading and its italic gold word carry the weight; meta belongs in the caption or the label row, not as an eyebrow.
- Do not spread gold across surfaces or add a second gold fill. It is one accent that also does jobs.
- Do not use a system sans as the display voice. Playfair Display carries display, always.
- Do not add a third light panel or a coloured panel; the two ivory interludes are the only breaks from the dark.
- Do not add hard offset drop shadows. Depth is blur, grade, rounded corners and hairlines.
- Do not add parallax, scroll-scrub or a second entrance animation. One reveal, plus the gentle ambient beats.
