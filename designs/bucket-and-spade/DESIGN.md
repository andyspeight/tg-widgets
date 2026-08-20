---
name: Bucket & Spade
description: Bright, warm and practical for a family holiday specialist. A sun-warmed sand ground, a coral that only ever means "go", a sea blue that carries trust, and a rounded Baloo 2 that sounds like a friendly human doing the maths so a tired parent does not have to.
mode: Persuade

colors:
  # Ground and surfaces (warm sand, never white-box, never grey)
  sand: "#FAF5EC"          # page ground, the warm off-white of dry beach sand
  sand-deep: "#F1E7D6"     # alternating section wash and hover fill
  white: "#FFFFFF"         # raised cards and inputs only, never the page ground
  ink: "#322D26"           # headings, body, the dark utility bar and footer ground
  ink-soft: "#6B6357"      # secondary text, warm taupe, never flat grey
  line: "rgba(50,45,38,.14)"  # hairline borders and dividers, ink at 14 percent

  # Action (coral is the one "go" colour)
  coral: "#C6472E"         # primary button fill, prices, one emphasised word
  coral-bright: "#E8604C"  # the lighter coral, held in reserve for accents
  coral-press: "#AD3A24"   # primary button hover, one step deeper

  # Trust (sea blue carries protection, dates and links)
  sea: "#1D6A96"           # links, kicker text, icon strokes, the dates band, focus ring
  sea-deep: "#155476"      # date chips on the sea band, deepest blue

  # Highlight (amber is the sunlight, sparingly)
  amber: "#E9A13B"         # sticker, tags, selection, the accent that catches the eye
  flag-amber-ink: "#8A5A10"  # small "flag" copy on sand, a legible dark amber

fonts:
  display: "\"Baloo 2\", \"Trebuchet MS\", system-ui, sans-serif"
  body: "\"Nunito Sans\", -apple-system, \"Segoe UI\", system-ui, sans-serif"

typography:
  scale:
    meta: "12.5px"        # uppercase field labels
    kicker: "13px"        # tracked caps meta (see the not-canonized note)
    small: "13.5px"       # notes, spans, badge copy
    fine: "14px"          # captions and sub-copy
    nav: "15.5px"         # nav links, list body
    body: "16.5px"        # the reading size
    lede: "18px"          # hero standfirst and pull quote
    h3: "19px"            # age-row and card headings
    subtitle: "25px"      # featured card heading
    section: "clamp(27px, 3vw, 36px)"   # section titles
    quote: "clamp(23px, 2.6vw, 32px)"   # the big review quote
    price: "30px"         # the featured total price
    score: "34px"         # the review score figure
    hero: "clamp(34px, 4.2vw, 54px)"    # the one hero line
  hero:
    fontFamily: "\"Baloo 2\", sans-serif"
    fontSize: "clamp(34px, 4.2vw, 54px)"
    fontWeight: 600
    lineHeight: 1.12
    letterSpacing: "-0.01em"
  section-title:
    fontFamily: "\"Baloo 2\", sans-serif"
    fontSize: "clamp(27px, 3vw, 36px)"
    fontWeight: 600
    lineHeight: 1.12
  subtitle:
    fontFamily: "\"Baloo 2\", sans-serif"
    fontSize: "25px"
    fontWeight: 600
    lineHeight: 1.12
  quote:
    fontFamily: "\"Baloo 2\", sans-serif"
    fontSize: "clamp(23px, 2.6vw, 32px)"
    fontWeight: 500
    lineHeight: 1.35
  lede:
    fontFamily: "\"Nunito Sans\", sans-serif"
    fontSize: "18px"
    fontWeight: 400
    lineHeight: 1.6
  body:
    fontFamily: "\"Nunito Sans\", sans-serif"
    fontSize: "16.5px"
    fontWeight: 400
    lineHeight: 1.6
  meta-label:
    fontFamily: "\"Nunito Sans\", sans-serif"
    fontSize: "12.5px"
    fontWeight: 800
    letterSpacing: "0.05em"
    textTransform: "uppercase"
  price:
    fontFamily: "\"Baloo 2\", sans-serif"
    fontSize: "30px"
    fontWeight: 700
    color: "coral"
  wordmark:
    fontFamily: "\"Baloo 2\", sans-serif"
    fontSize: "21px"
    fontWeight: 700
    lineHeight: 1.05

spacing:
  wrap-max: "1240px"       # content column max width
  wrap-pad: "32px"         # side gutter, drops to 20px under 620px
  card-pad: "22px"         # search card, panel interiors
  card-pad-lg: "28px"      # featured card body
  section-y: "84px"        # the standard section rhythm (offers, ages)
  section-y-lg: "88px"     # humans, reviews
  hero-y: "64px 0 76px"    # hero top and bottom
  gap-grid: "44px"         # offer-grid column gap
  gap-split: "64px"        # hero and ages two-column gap
  gap-wide: "70px"         # humans and reviews split
  gap-field: "12px"        # form field grid gap
  measure: "52ch"          # lede and body measure cap

radii:
  none: "0"
  sm: "8px"                # buttons, inputs, chips, tags, nav pills
  md: "14px"               # cards, panels, stickers, the final CTA box
  focus: "4px"             # the focus-visible corner
  round: "50%"             # age icons and the round "go" affordances

motion:
  signature: "reveal-rise"
  duration: "500ms"
  easing: "ease-out"
  transform: "translateY(22px) to translateY(0)"
  opacity: "0 to 1"
  stagger: "60ms"          # per sibling within a group, applied on intersect
  threshold: 0.12          # IntersectionObserver, revealed once
  ui: "180ms ease-out"     # button lift, chip hover, border colour
  ui-fast: "150ms ease-out" # input border, nav pill fill
  press: "scale(0.97)"     # button :active
  reducedMotion: "no transform, no opacity ramp, no stagger, scroll-behavior auto, content present"
---

# Design World: Bucket & Spade

## 1. Overview: The Seaside, Sorted

Bucket & Spade is a family holiday specialist, and the site should feel the way it feels when a good adviser takes the worry off your hands. The whole system rests on one idea: a family holiday is a lot of maths, dates, ages, transfer times, a total price with everything in, and this brand has already done it for you. Warmth is the promise and clarity is the proof. The page earns trust the way a trusted human does, by being bright, plain and specific, never slick and never cold.

The world is a sun-warmed sand ground with coloured bands that break the scroll into rooms, a rounded display face that sounds friendly out loud, and one coral that only ever means "go". Sea blue carries the trustworthy work, the dates, the protection badges, the links. Amber is the sunlight, a sticker or a tag that catches the eye and then steps back. Cards are soft-cornered and lift on a gentle shadow, photography is graded on one warm reel so the beach always looks like the same beach, and every price on the page is a real total for a real family.

**Key characteristics**

- A warm sand ground with alternating coloured bands (sea blue, deep ink, sand-deep) so each section reads as its own room.
- Coral as the single action colour, used for the primary button, prices and one emphasised word, never as decoration.
- Sea blue as the trust colour, carrying links, the school-dates band and the protection marks.
- Amber as rationed sunlight: the hero sticker, deal tags, text selection.
- A rounded Baloo 2 display face paired with a warm humanist Nunito Sans for everything read at length.
- Soft-cornered cards (8px and 14px) that lift on one shared soft shadow.
- One photographic grade across every image so the site never reads as stock assembled from many sources.
- One motion moment, a gentle staggered rise, and a real total price on every offer.

## 2. The Kit: One Vocabulary For Every Page

Every Bucket & Spade page is built from the same small, friendly kit. Reach for these before inventing anything, and invent only when a page has a genuinely new job to do.

- **Rooms, not slabs.** A page is a run of full-width bands. Most sit on sand, then one drops to the sea band, one to the deep ink band, one to sand-deep. The colour change is the section break, so headings rarely need a rule above them.
- **The soft card.** A white card at `md` radius on the soft shadow carries an offer, a search panel or a caption. This is the one container, used for things a family will actually click.
- **The chip and the row.** Lists of dates, ages and deals are chips (on the sea band) or hairline-divided rows (on sand), not a wall of equal cards. The row keeps a long list calm.
- **One total price.** Every price is the full total for the whole party with flights and transfers in, set in Baloo 2 and coloured coral. A price is never a "from" teaser with the real cost hidden.
- **The friendly aside.** A rotated amber sticker or an offset caption card adds a human, handwritten-feeling note. Used once or twice per page, never on every image.
- **Two buttons only.** A coral fill for the main action and a ghost outline for the quieter one. Everything else is a sea-blue text link.

If a shape is not covered here it probably is not needed. The instinct to reach for a fourth colour or a fifth card is usually the instinct to look busy, and busy reads as untrustworthy on a family site.

## 3. Colours: Sand, Sea, Coral, Sun

### Ground and surface

- **Sand** `#FAF5EC`: the page ground, the warm off-white of dry beach sand. The default everywhere.
- **Sand Deep** `#F1E7D6`: the alternating section wash and the hover fill on nav pills and deal rows. One quiet step down from sand.
- **White** `#FFFFFF`: raised cards, the search panel and inputs only. Never the page ground, so a card always reads as lifted off the sand.
- **Ink** `#322D26`: headings and body on sand, and the ground of the utility bar, the reviews band and the footer. Warm near-black, never pure black.
- **Ink Soft** `#6B6357`: secondary text, sub-copy and placeholders. A warm taupe tinted from the ink hue, clears 4.5:1 on sand, never a flat grey.
- **Line** `rgba(50,45,38,.14)`: hairline borders and dividers, ink at 14 percent.

### Action

- **Coral** `#C6472E`: the one action colour. Primary button fill, every price, and at most one emphasised word in a heading. When coral appears, something is meant to happen.
- **Coral Press** `#AD3A24`: the primary button hover, one step deeper.
- **Coral Bright** `#E8604C`: the lighter coral, held for a small accent where full coral would shout. Rarely needed.

### Trust

- **Sea** `#1D6A96`: the trust colour. Links, kicker text, icon strokes, the school-dates band and the focus ring. Where coral says "act", sea says "you can rely on this".
- **Sea Deep** `#155476`: date chips sitting on the sea band, the deepest blue.

### Highlight

- **Amber** `#E9A13B`: rationed sunlight. The hero sticker, deal tags, the amber dash and text selection. It catches the eye then steps back, never a body-text colour.
- **Flag Amber Ink** `#8A5A10`: the darkened amber used only for small "flag" copy on sand, where bright amber would fail contrast. This is the legible form of the highlight, never the bright swatch.

### Browser surfaces

Theme every surface the browser would otherwise leave in its defaults, from this palette.

- **Selection**: background `amber`, text `ink`. Already set, warm and bright.
- **Caret**: `coral`, so the cursor matches the action colour in every input.
- **Scrollbar**: an `ink-soft` thumb on a `sand-deep` track, thin. Derived from the palette, since the source leaves it default.
- **Focus ring**: `3px solid sea` at `2px` offset with a `4px` corner. Already set on `:focus-visible`, a bright and obvious ring.
- **Link underline**: sea, with `text-underline-offset: 0.18em` so an underline never crowds the descenders. Derived, since the source underlines on hover only.

### Colour rules

**The Coral Means Go Rule.** Coral is the action colour and nothing else. It fills the primary button, colours prices and carries at most one word of a heading. If coral has crept into a border, an icon or a run of body text, pull it back to ink or sea.

**The Warm Neutrals Rule.** Every neutral is tinted warm. The ground is sand not white, the dark is ink not black, and secondary text is taupe tinted from the ink hue, never a flat grey. A cold grey anywhere reads as a booking system, not a family adviser.

**The Coloured Bands Rule.** Colour blocks are how sections separate, and they belong to this world. The sea band, the ink band and the sand-deep wash are all correct here. Keep them to full-width section grounds, and keep the three action-and-highlight colours (coral, sea, amber) off each other so the eye always knows which one means "go".

## 4. Typography: Baloo 2 Says It, Nunito Sans Explains It

**Display:** "Baloo 2", "Trebuchet MS", system-ui, sans-serif. A rounded, warm display sans, self-hosted via Google Fonts at weights 500, 600 and 700. It carries every heading, the wordmark, prices and the big review quote. Its roundness is the friendliness of the whole brand, so it is never swapped for a system sans.

**Body:** "Nunito Sans", -apple-system, "Segoe UI", system-ui, sans-serif. A warm humanist sans at weights 400, 600, 700 and 800 plus a 400 italic for quotes. It runs body copy, controls, labels, navigation and every long read. It is soft enough to sit beside Baloo 2 and plain enough to disappear while a parent reads the detail.

The pairing is the whole typographic story: a rounded voice that sounds like a person for the headlines, a calm humanist that does the explaining underneath. Baloo carries feeling, Nunito Sans carries fact.

### Hierarchy

- **Wordmark**: Baloo 2, `21px`, weight 700, line-height 1.05, with an uppercase Nunito Sans `11px` sub-label tracked `0.08em`.
- **Hero**: Baloo 2, `clamp(34px, 4.2vw, 54px)`, weight 600, line-height 1.12, letter-spacing `-0.01em`. One emphasised span in coral.
- **Section title**: Baloo 2, `clamp(27px, 3vw, 36px)`, weight 600, line-height 1.12.
- **Subtitle (featured card)**: Baloo 2, `25px`, weight 600.
- **Card and row heading**: Baloo 2, `19px` to `17.5px`, weight 600.
- **Big review quote**: Baloo 2, `clamp(23px, 2.6vw, 32px)`, weight 500, line-height 1.35.
- **Price and figures**: Baloo 2, `19px` to `34px`, weight 700, coloured coral (prices) or amber (on dark bands).
- **Lede**: Nunito Sans, `18px`, weight 400, line-height 1.6, on `ink-soft`, measure capped near 52ch.
- **Body**: Nunito Sans, `16.5px`, weight 400, line-height 1.6.
- **Meta label**: Nunito Sans, `12.5px`, weight 800, uppercase, letter-spacing `0.05em`, on `ink-soft`. Field labels only.

### Typography rules

**The Rounded Voice Rule.** Only Baloo 2 gets to be large and only Baloo 2 carries a price. The warmth of the page lives in the rounded face at scale, so a heading is never set in the body sans and a headline is never allowed to read as a system font.

**The Fact Below Feeling Rule.** Anything a parent must actually read to decide, transfer times, ages, what is included, the total, sits in Nunito Sans at `16.5px` or larger on `ink` or `ink-soft`. Detail is never loaded onto a decorative colour or shrunk below the body size.

**The One Coral Word Rule.** A heading may carry a single word in coral for emphasis, and no more. Two coloured words in one heading and the emphasis is gone.

## 5. Elevation and Material

Depth is gentle and comes from soft shadow, one warm photographic grade and the coloured bands, never from heavy borders or hard-edged drop shadows.

### Photography as one reel

Every image is graded on one warm treatment so the beach, the pool and the adviser all look photographed on the same sunny afternoon.

- **One grade.** A shared warm grade on every image: `sepia(.18) saturate(1.12) contrast(.98)`. Applied through the `.ph` class, never per-image tweaks.
- **Real families, real staff.** Photography shows actual holidays and a named adviser at her desk, not polished stock models. The warmth is in the subject as much as the grade.
- **Soft-cornered plates.** Images take `md` radius and the soft shadow, and the offset "small" photo carries a `6px` sand border so it reads as a print laid over the main shot.

### Shadow vocabulary

- **Soft shadow:** `0 10px 30px -12px rgba(50,45,38,.22)`. The one shared card and image shadow, a warm blur lifted well off the surface, never a hard 1:1 offset.
- **Button lift:** the coral button on hover rises `translateY(-2px)` and casts `0 8px 18px -8px rgba(198,71,46,.55)`, a coral-tinted shadow so the lift belongs to the action colour.
- **Focus ring:** the bright `3px sea` outline at `2px` offset, never a soft glow.

### Material rules

**The Soft Corner Rule.** Corners are rounded, always. Buttons, inputs, chips and tags take `sm` (8px), cards, panels and stickers take `md` (14px). A sharp 0-radius corner belongs to a different, colder world and does not appear here.

**The One Warm Shadow Rule.** Lift comes from the single soft shadow, warm and blurred and offset downward. No hard neobrutalist offset shadow, no black glow, no inset. Add the hairline `line` border before you add a second shadow.

**The Warm Grade Rule.** Every photograph carries the one `.ph` grade so the site reads as one shoot. An ungraded image, or a second grade, breaks the illusion that this is all one holiday.

## 6. Motion: One Gentle Rise

There is a single authored motion, the **reveal-rise**. Content begins fully legible in its resting state, so a failed script never hides the page, and as a group enters the viewport each item lifts from `translateY(22px)` to `0` while opacity moves `0` to `1`, over `500ms` on `ease-out`. Siblings inside one group stagger by `60ms`, applied on intersection through an IntersectionObserver at a `0.12` threshold, and each element reveals once and is then left alone.

Hover and focus are quicker and quieter: buttons and chips lift and change colour over `180ms ease-out`, inputs and nav pills settle their border or fill over `150ms`, and a pressed button dips to `scale(0.97)`. There is no parallax, no scroll-scrub, no second entrance animation and no looping motion.

**Reduced motion.** Under `prefers-reduced-motion: reduce` every animation and transition is removed, the reveal items are shown at rest, and smooth scrolling drops to auto. Content is simply present.

## 7. Components

### The band

A full-width section on its own ground: sand, the sand-deep wash, the sea band or the deep ink band. The ground change is the section break. Vertical rhythm is `84px` to `88px`, content held in a `1240px` wrap with a `32px` gutter.

### The soft card

A white panel at `md` radius on the soft shadow with a `1px line` border. It holds the search form, a featured offer or an offset caption. Interiors pad `22px`, the featured body `28px`. This is the one container in the world.

### The search panel

- **Fields:** sand-filled inputs and selects, `2px line` border, `sm` radius, `48px` minimum height, Nunito Sans 600.
- **Label:** the meta label, uppercase `12.5px` weight 800 on `ink-soft`.
- **Hover:** border moves to `ink-soft`.
- **Focus:** border moves to `sea`, fill lifts to white, plus the focus ring.
- **Child ages:** age selectors appear only when children are chosen, so the form asks for exactly what it needs and no more.
- **Submit:** a full-width coral button carrying a real count ("Search 1,240 family holidays"), with a reassurance note beneath naming what is included.

### Buttons

- **Primary (coral):** coral fill, white text, `sm` radius, `48px` minimum height (`54px` in the search panel), Nunito Sans weight 800. Hover deepens to coral-press, rises `-2px` and casts the coral shadow. Active dips to `scale(0.97)`.
- **Ghost:** transparent fill, ink text, `line` border. Hover moves the border to ink and rises `-2px`. The quieter of the two, one per view alongside the coral.
- Never a third button style. Every other action is a sea-blue text link.

### Chips and rows

- **Date chip:** on the sea band, a `sea-deep` fill at `sm` radius with the season, the span and a Baloo 2 "from" price in amber. Hover rises `-3px` and shows an amber border.
- **Deal row:** on sand, a hairline-divided list. Hover fills sand-deep and nudges the padding left `14px`. A long list stays calm as rows, never a card wall.
- **Age row:** a round `white` icon, a Baloo 2 heading with the age range in coral, body in ink-soft, and a round outline "go" affordance that fills coral and slides `4px` right on hover.

### The friendly aside

A rotated amber sticker (`-3deg`) or an offset white caption card with a coral or amber accent edge. It adds one human, handwritten-feeling note per section at most. This is the world's warmth showing, used sparingly so it stays charming.

### Tags and flags

- **Tag:** an amber pill at `sm` radius, ink text, weight 800, on a card ("2 free child places left").
- **Flag:** small `flag-amber-ink` copy on sand for a scarcity or feature note, the legible dark form of amber, never the bright swatch on a light ground.

### Icons

One line-icon set drawn inline as SVG at a `1.8` stroke, `stroke-linecap` and `linejoin` round to match the rounded face. Rendered in sea (trust and utility), coral (promises and emphasis) or amber (on dark bands). Never emoji, never a unicode glyph, never a filled icon where the set is outline.

### Footer

The deep ink band, the wordmark in Baloo 2 with a sand sub-label, links as text, the protection badges (ATOL, ABTA) as outlined pills. Contact details carry amber icons. The quietest, most factual part of the page, and it still names a real office and real hours.

## 8. Do and Do Not

### Do

- Do break the page into coloured bands, sand then sea then ink then sand-deep, so each section reads as its own room.
- Do keep coral for action only, the primary button, prices and one emphasised word, and let sea carry links and trust.
- Do quote a real total price for the whole party with flights and transfers in, set in Baloo 2 in coral.
- Do round every corner, `sm` for controls and chips, `md` for cards and panels, and lift them on the one soft warm shadow.
- Do grade every photograph on the single warm `.ph` treatment so the site reads as one holiday.
- Do set headings, the wordmark and prices in Baloo 2, and hand every fact a parent must read to Nunito Sans at body size or larger.
- Do tint every neutral warm, sand ground, ink dark, taupe secondary text, and keep placeholder and body copy at 4.5:1 or better.
- Do theme the browser surfaces, selection, caret, scrollbar, focus ring and link underline, from this palette.
- Do add a friendly aside, a rotated sticker or an offset caption, once or twice a page to keep it human.
- Do honour the one reveal-rise and its reduced-motion path.

### Do Not

- Do not place a small tracked label above a heading. The heading carries its own weight, and the band change already marks the section. (The shipped page ships these kickers; they are a defect the build carries, not a rule to inherit.)
- Do not use a cold grey or a pure-white page ground. Sand is the ground and every neutral is warm.
- Do not spread coral across borders, icons or body text. It is the action colour, rationed.
- Do not let the three signals (coral, sea, amber) sit on or fight each other. One means go, one means trust, one is sunlight.
- Do not sharpen a corner. Rounded is the whole friendliness of the brand.
- Do not use a hard offset or black glow shadow. One soft warm shadow only.
- Do not swap Baloo 2 for a system sans on a heading, and do not shrink a fact below the body size to fit.
- Do not add a second animation, a parallax or a scroll effect. One gentle rise only.
- Do not hide the real cost behind a "from" teaser. The total, with everything in, is the honesty the brand is selling.
