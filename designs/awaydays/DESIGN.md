---
name: Away Days
description: Loud budget travel for 18–30s, built like a fly-poster. A near-white paper ground, four flat poster inks locked behind 2px black rules, prices set enormous in a chunky display grotesque, hard offset shadows and a few degrees of tilt on every sticker. A cut-and-paste collage that reads as cheap on purpose and never dull.
mode: Persuade

colors:
  # Ground and ink (the paper and the line)
  paper: "#FAFAF5"        # page ground, a warm near-white newsprint
  ink: "#17161B"          # text, every 2px rule, every border, dark panels
  # The three poster inks
  cobalt: "#2F45E0"       # primary accent, the price colour and the focus ring
  pink: "#FF5E7A"         # hot secondary, hover shadows and festival block
  acid: "#FFD84D"         # highlight yellow, selection, the marker underline, CTA fill
  # Muted tints (as shipped, near-neutral)
  ink-soft: "#3d3c44"     # secondary text on paper, meta and trust lines
  paper-dim: "#dddce2"    # footer links at rest on ink
  paper-mute: "#b9b8c0"   # footer body copy on ink
  paper-faint: "#8a8992"  # footer legal, smallest print on ink
  ink-faint: "#6b6a73"    # polaroid sub-caption on paper

fonts:
  display: "\"Bricolage Grotesque\", sans-serif"
  body: "\"Figtree\", sans-serif"

typography:
  scale:
    micro: "12px"          # stickers, smallest caps labels
    label: "13px"          # chips, band sub-labels, legal
    small: "14px"          # meta, go-buttons, footer links
    body: "16px"           # reading size
    lead: "16.5px"         # hero standfirst
    logo: "22px"           # wordmark
    quote: "clamp(18px, 2.2vw, 25px)"    # review pull-quotes
    place: "clamp(20px, 2vw, 26px)"      # deal destination
    h2: "clamp(28px, 4vw, 46px)"         # section headings
    band: "clamp(24px, 3vw, 38px)"       # budget band labels
    promo: "clamp(30px, 2.6vw, 40px)"    # promo tile
    fest-price: "clamp(38px, 4vw, 56px)" # festival price
    price: "clamp(46px, 4.6vw, 66px)"    # deal price
    deposit: "clamp(48px, 6vw, 84px)"    # deposit hero figure
    h1: "clamp(44px, 6vw, 86px)"         # hero headline
  h1:
    fontFamily: "\"Bricolage Grotesque\", sans-serif"
    fontSize: "clamp(44px, 6vw, 86px)"
    fontWeight: 800
    letterSpacing: "-0.03em"
    lineHeight: 0.95
  h2:
    fontFamily: "\"Bricolage Grotesque\", sans-serif"
    fontSize: "clamp(28px, 4vw, 46px)"
    fontWeight: 800
    letterSpacing: "-0.02em"
    lineHeight: 1
  price:
    fontFamily: "\"Bricolage Grotesque\", sans-serif"
    fontSize: "clamp(46px, 4.6vw, 66px)"
    fontWeight: 800
    letterSpacing: "-0.03em"
    lineHeight: 0.9
    color: cobalt
  place:
    fontFamily: "\"Bricolage Grotesque\", sans-serif"
    fontSize: "clamp(20px, 2vw, 26px)"
    fontWeight: 700
    letterSpacing: "-0.01em"
  quote:
    fontFamily: "\"Bricolage Grotesque\", sans-serif"
    fontSize: "clamp(18px, 2.2vw, 25px)"
    fontWeight: 600
    letterSpacing: "-0.01em"
    lineHeight: 1.25
  lead:
    fontFamily: "\"Figtree\", sans-serif"
    fontSize: "16.5px"
    fontWeight: 500
    lineHeight: 1.5
  body:
    fontFamily: "\"Figtree\", sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
  meta:
    fontFamily: "\"Figtree\", sans-serif"
    fontSize: "14px"
    fontWeight: 500
    color: ink-soft
  label:
    fontFamily: "\"Bricolage Grotesque\", sans-serif"
    fontSize: "13px"
    fontWeight: 700
    letterSpacing: "0.06em"
    textTransform: "uppercase"
  wordmark:
    fontFamily: "\"Bricolage Grotesque\", sans-serif"
    fontSize: "22px"
    fontWeight: 800
    letterSpacing: "-0.01em"

spacing:
  3xs: "4px"
  2xs: "6px"
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "18px"
  xl: "22px"
  2xl: "28px"
  gap-hero: "clamp(24px, 4vw, 64px)"
  page-inset: "clamp(16px, 4vw, 48px)"       # left/right page margin, every band aligns to it
  section-pad: "clamp(40px, 6vw, 72px)"      # top pad on a section head
  section-gap: "clamp(40px, 6vw, 72px)"      # margin between dark and light sections
  footer-pad: "clamp(36px, 5vw, 64px)"
  nav-height: "64px"

radii:
  none: "0"      # the entire world is sharp cornered, no exceptions

motion:
  signature: "reveal-rise"
  duration: "400ms"
  easing: "ease-out"
  transform: "translateY(14px) to translateY(0)"
  opacity: "0 to 1"
  stagger: "55ms"            # cycled every 6 items via IntersectionObserver
  threshold: "0.12"
  ui: "150ms ease-out"       # hover colour, button nudge, image saturation
  buttonHover: "translate(-2px, -2px) + 4px 4px 0 shadow"
  reducedMotion: "content present, no transform, no opacity ramp, tilts kept, transitions 0.01ms"
---

# Design World: Away Days

## 1. Overview: The Fly-Poster

Away Days sells cheap group trips to 18–30s, and the site should feel like a fly-poster stapled to a student union wall, not a travel agent's window. The whole system rests on one idea: make the price the loudest thing on the page and make everything around it look cut, tilted and stuck down by hand. A skint traveller trusts a brand that admits it is cheap and wears it as a badge, so the page earns the click by being blunt about money and fast to scan. The energy is the point. Restraint would read as expensive, and expensive is the wrong promise.

The world is a warm near-white paper ground, four flat poster inks locked behind a 2px black rule on everything, and a chunky display grotesque (Bricolage Grotesque) that sets every price at a size you can read across a room. Body copy is a friendly humanist sans (Figtree) that keeps the jokes legible. Blocks are tilted a degree or two, stickers sit at a jauntier angle, and hard offset shadows drop straight down and right like paper lifted off the wall. There are no soft shadows, no rounded corners, no gradients and no calm. There is paper, thick black line, three bright inks and prices set enormous.

**Key characteristics**

- A warm near-white paper ground, never pure white and never a dark theme except the ink panels.
- Everything boxed in a 2px solid ink rule, the single structural device that holds the collage together.
- Four flat poster inks: ink black, cobalt, hot pink, acid yellow, used as fills not tints.
- The price set enormous in Bricolage Grotesque, in cobalt, the biggest type on the page after the headline.
- Hard offset shadows, `Npx Npx 0` with zero blur, native to this world and never softened.
- A few degrees of tilt on collage blocks, stickers, price badges and polaroids, so the page reads as pasted up.
- A friendly humanist sans (Figtree) for all reading copy, plain and warm, carrying the copy's dry humour.
- One motion moment, the reveal-rise, staggered as cards enter, honouring reduced motion.

## 2. The Kit: One Vocabulary For Every Page

Every Away Days page is built from the same small kit. Reach for these before inventing anything, and invent only when a page has a genuinely new editorial moment. Do not reinvent the rule, the sticker or the shadow.

- **The 2px rule.** `2px solid ink` borders every block, panel, chip, button, image and band. It is the grid and the frame at once. Add the line before anything heavier.
- **The price, huge.** Money is the hero. A price is Bricolage Grotesque at `price` scale in cobalt, with a small `from` superscript and a small `pp` superscript, so the number itself dominates and the qualifiers shrink out of the way.
- **The sticker.** A small rotated caps label in one of the three inks, 2px bordered, tilted 3–5 degrees, used to flag "Selling fast", "Group fave", "£49 locks it in". A price sticker adds a `4px 4px 0` shadow and sets the figure at `1.7em` block.
- **Poster inks are fills.** Cobalt, pink and acid are surfaces you paint whole panels with, not accent hairlines. A deposit strip is a solid cobalt block, a festival panel is solid pink, a promo tile is solid acid.
- **Tilt and shadow do the depth.** A block is lifted off the wall with a hard offset shadow and set a degree or two off square. That is the only elevation the world has.
- **Ink panels for the serious bits.** Nav, the deal-board footnote, the UGC strip and the site footer flip to a solid ink ground with paper text, where acid does the highlighting.

If a shape is not covered here it is almost certainly a box with a 2px rule and a price in it. That is usually the right answer.

## 3. Colours: Paper, Black Line, Three Poster Inks

### Ground and line

- **Paper** `#FAFAF5`: the page ground, a warm off-white newsprint. Cards and the deal board sit on it; a hovered deal lifts to pure `#fff`.
- **Ink** `#17161B`: every 2px rule, all body text on paper, and the ground of the nav, UGC strip and footer. Near-black with a faint violet warmth, never a flat `#000`.

### The three inks

- **Cobalt** `#2F45E0`: the primary. The price colour, the focus ring, a filled collage block, the deposit strip ground, the "Wristband incl." sticker. This is the colour that says money.
- **Pink** `#FF5E7A`: the hot secondary. The button hover shadow, the festival panel ground, the review quote mark, the hero standfirst rule.
- **Acid** `#FFD84D`: the highlight. Text selection, the marker underline behind hero words, the primary CTA fill, "Group fave" stickers, footer headings and the wordmark's second half.

### Muted tints (as shipped)

- **Ink Soft** `#3d3c44`: secondary text on paper, meta lines, board notes. Clears roughly 9:1 on paper.
- **Paper Mute** `#b9b8c0` and **Paper Dim** `#dddce2`: body copy and links on the ink footer ground.
- **Paper Faint** `#8a8992`: the smallest legal print on ink.
- **Ink Faint** `#6b6a73`: a polaroid's second caption line on paper.

### Browser surfaces

The build themes selection and the focus ring from the palette, and sets one custom scrollbar. Theme the rest from the same inks.

- **Selection**: `::selection` background acid, text falls to ink. High contrast and on-brand.
- **Focus ring**: `:focus-visible` is `3px solid cobalt` with a `3px` offset. Thick and unmissable, which suits the world.
- **Scrollbar**: the UGC row uses `scrollbar-width: thin` with `scrollbar-color: acid transparent`. Carry the same acid-on-transparent thumb to the page scrollbar.
- **Caret**: not set in the build. Derive `caret-color: cobalt` so the caret matches the price colour.
- **Link underline**: the build underlines nav and footer links on hover only. Where a body link needs a rest-state underline, set it in ink or cobalt with a `0.12em` offset so the thick type does not swallow it.

### Colour rules

**The Flat Ink Rule.** The three inks are flat fills behind a black rule, never gradients, never tints of each other and never softened. A panel is wholly cobalt or wholly pink or wholly acid. If a colour has gone semi-transparent or gradient, it has left the world.

**The Cobalt Is Money Rule.** Cobalt is the price colour first. It also rings focus and grounds the deposit strip, but its main job is the number. Do not spend cobalt on decoration that competes with a price.

**The Paper Not White Rule.** The ground is warm paper `#FAFAF5`. Pure white is reserved for the one-step hover lift on a deal card, so a hover reads as the paper brightening under the cursor.

## 4. Typography: Bricolage Shouts, Figtree Talks

**Display:** Bricolage Grotesque, sans-serif. A chunky variable grotesque with real personality, loaded at weights 400/600/700/800. It sets the wordmark, every heading, every price, every sticker and every go-button. It is meant to be big and tight.

**Body:** Figtree, sans-serif. A friendly humanist sans at weights 400/500/600/700. It runs all reading copy, meta, chips, standfirst and footer text, keeping the dry copy warm and legible while Bricolage does the shouting.

The whole typographic story is the gap between the two: a loud display grotesque set enormous and tight against a plain, warm sans that never tries to compete. When both want to be big, the price wins.

### Hierarchy

- **Wordmark**: Bricolage `22px`, weight 800, letter-spacing `-0.01em`. `AWAY` in paper, `DAYS` in acid, on the ink nav.
- **H1 (hero)**: Bricolage `clamp(44px, 6vw, 86px)`, weight 800, line-height `0.95`, letter-spacing `-0.03em`, max ~12ch. One word carries an acid marker underline via `box-shadow: inset 0 -0.28em 0 acid`.
- **H2 (section heads)**: Bricolage `clamp(28px, 4vw, 46px)`, weight 800, line-height 1, letter-spacing `-0.02em`. Copy is blunt and funny ("This week's damage.").
- **Price**: Bricolage `clamp(46px, 4.6vw, 66px)`, weight 800, line-height `0.9`, letter-spacing `-0.03em`, in cobalt. The deposit figure runs bigger at `clamp(48px, 6vw, 84px)`.
- **Deal place**: Bricolage `clamp(20px, 2vw, 26px)`, weight 700, letter-spacing `-0.01em`.
- **Review quote**: Bricolage `clamp(18px, 2.2vw, 25px)`, weight 600, line-height 1.25.
- **Lead / standfirst**: Figtree `16.5px`, weight 500, on a 4px pink `border-left`.
- **Body**: Figtree `16px`, weight 400, line-height 1.5.
- **Meta**: Figtree `14px`, weight 500, on ink-soft.
- **Sticker / label**: Bricolage `12–13px`, weight 700–800, uppercase, letter-spacing `0.05–0.06em`.

### Typography rules

**The Price Is Biggest Rule.** After the hero headline, the price is the largest thing on any card, set in Bricolage weight 800 with the tightest tracking. The `from` and `pp` qualifiers are superscripts at a fraction of the size, so nothing dilutes the number.

**The Tight Display Rule.** Bricolage at scale holds negative tracking, `-0.03em` on the largest figures and headline, `-0.02em` on section heads, with line-heights of `0.9` to 1. A big grotesque set loose loses its punch.

**The Plain Body Rule.** Reading copy stays Figtree at `16px`/1.5 in one plain weight. The jokes carry the tone, not the type. Do not set body copy in the display face or track it out; keep the loud voice for headings, prices and stickers only.

## 5. Elevation and Material: Cut, Tilt, Drop

Depth in this world is paper physics, not soft light. A block is a rectangle with a 2px black rule, turned a couple of degrees off square, with a hard shadow dropped down and to the right as if it were lifted off the wall.

### The hard offset shadow

The offset shadow with zero blur is native here and must never be softened into a blur.

- **Collage cut**: `box-shadow: 8px 8px 0 ink` on a paper card with a `3px` ink border (drops to `6px 6px 0` on small screens).
- **Price sticker**: `box-shadow: 4px 4px 0 ink`.
- **Button hover**: `box-shadow: 4px 4px 0 pink` (or acid on the pink button) as the button nudges up-left.

### Tilt

- Collage blocks sit at `2deg` and `-3deg`; cuts at `-1.6deg`, `2.4deg`, `4deg`; stickers at `3–5deg`; polaroids alternate `-1.6deg` / `1.4deg`. Tilt is small and varied, never uniform, so the wall looks hand-pasted.

### Material rules

**The Zero-Blur Rule.** Every shadow is `Npx Npx 0`, a hard offset in a solid ink or ink colour. There are no soft drop shadows, no glows and no blur anywhere in the world. This is the one place a blur would break the material.

**The Rule Before The Fill Rule.** A block is defined by its 2px ink border first. Add the border, then decide whether it needs a fill. Depth is the border plus a tilt plus a hard shadow, in that order, never a soft card float.

**The Sharp Corner Rule.** Radius is `0` everywhere. Buttons, images, chips, stickers, panels, all sharp. A rounded corner reads as a different, softer brand and does not exist here.

## 6. Motion: One Rise, A Few Nudges

There is a single authored entrance, the **reveal-rise**. An element marked `.rv` starts at `opacity: 0` and `translateY(14px)` and, as it crosses `0.12` of the viewport, transitions to full opacity and `translateY(0)` over `400ms` on `ease-out`. Cards reveal in sequence with a `55ms` stagger cycled every six items, so the deal board deals itself out rather than snapping in at once. Blocks that carry a resting tilt keep it through the rise, so a cut lands back at its jaunty angle, never square.

Beyond the entrance there are only small interaction nudges, all at `150ms ease-out`: a button lifts `translate(-2px, -2px)` and drops its hard colour shadow on hover, a deal card brightens paper to white and pushes its image saturation, a go-button flips to ink with acid text. Hover and press are quick and physical, like paper being pressed. There is no parallax, no scroll-scrub and no second entrance.

**Reduced motion.** Under `prefers-reduced-motion: reduce` the reveal is removed, content is simply present at full opacity, the resting tilts are preserved, smooth scroll is turned off, the button hover nudge is dropped and all transitions collapse to `0.01ms`. The page stays loud but stops moving.

## 7. Components

### The button

- **Primary**: Bricolage weight 700, `15px`, acid fill, ink text, `2px` ink border, padding `11px 20px`, sharp corners. A `--big` variant runs `17px` / `14px 26px`.
- **Pink variant**: pink fill, otherwise identical.
- **Hover**: nudges `translate(-2px, -2px)` and drops a `4px 4px 0` hard shadow (pink under the acid button, acid under the pink one).
- **Active**: returns to `translate(0,0)` with no shadow, so a press slams the paper flat.
- **Focus**: the 3px cobalt offset ring.

### The deal card

A bordered cell in a 12-column board, spanning 7/5/4/3 columns for a ragged magazine grid. Image on top with a `2px` bottom rule and a saturation-boosted filter, an optional sticker pinned top-right, then place, the huge cobalt price, a meta line and a `Grab it` go-button pinned to the bottom. Hover lifts paper to white, pushes image saturation and flips the go-button to ink/acid.

### The promo tile

A solid acid cell inside the board, no image, carrying a big count line ("84 deals live right now") in Bricolage and a one-line pitch. It is a deal-shaped shout, not a card.

### The deposit strip

A full-bleed solid cobalt band, paper text, top and bottom 2px rules. A giant `£49` figure with a small caps `locks it in` under it, then three items divided by faint white left-borders. The money promise, stated once, loud.

### The budget bands

Stacked full-width rows divided by 2px rules, each a big Bricolage band label with a wry sub-label, a wrap of bordered destination chips, and a large `→` arrow. On hover the label turns cobalt and alternate chips fill acid.

### The festival panel

A two-column bordered banner, photo left, solid pink body right, carrying an H2, a short pitch, a big `from £329` and one button. Colour comes from the pink fill, not from the image.

### The UGC strip

A solid ink section with paper text and a horizontally scrolling row of tilted polaroids, each a paper card with a 2px rule, a square-ish photo and a handle/place caption. The one custom scrollbar, acid thumb on transparent, lives here.

### Stickers and chips

Small bordered caps labels in one of the three inks, tilted a few degrees, `2px` ink border, sharp corners. Price stickers add the `4px 4px 0` shadow and blow the figure up to `1.7em`. Chips are the calm version: no tilt, no shadow, paper fill until a hover paints alternates acid.

### Footer

Solid ink ground, paper text, a Bricolage wordmark with the acid `DAYS`, section headings in acid caps, links that turn acid and underline on hover, and a legal line in the faintest paper tint. Loud to the very bottom.

## 8. Do and Do Not

### Do

- Do make the price the hero, set enormous in Bricolage weight 800 in cobalt, with the qualifiers shrunk to superscripts.
- Do frame everything in a 2px solid ink rule, and reach for the line before any heavier device.
- Do use the three inks as flat fills for whole panels, cobalt, pink and acid, one colour per block.
- Do drop hard offset shadows with zero blur and tilt blocks a degree or two, so the page reads as pasted up.
- Do keep the copy blunt, dry and warm, and let Figtree carry the jokes in plain weight while Bricolage shouts the numbers.
- Do flip the serious sections (nav, footnotes, UGC, footer) to a solid ink ground with paper text and acid highlights.
- Do theme selection, the focus ring, the caret and the scrollbar from the inks, acid selection and a 3px cobalt ring.
- Do honour the one reveal-rise and the reduced-motion path, keeping the resting tilts when motion is off.
- Do hold body and meta text at high contrast on paper (ink and ink-soft), loud is fine, illegible is not.

### Do Not

- Do not soften a shadow into a blur or a glow. Every shadow is a hard `Npx Npx 0` offset, that is the material.
- Do not round a corner. Radius is 0 on every button, image, chip and panel.
- Do not tint the inks, gradient them or make them translucent. They are flat fills behind a black rule.
- Do not set body copy in the display face or track it out. Bricolage is for headings, prices and stickers only.
- Do not spend cobalt on decoration that competes with a price, and do not let another element out-shout the number.
- Do not go quiet, spacious or corporate to look trustworthy. Trust here comes from being loud and blunt about the money.
- Do not add a second animation, a parallax or a scroll effect. One reveal-rise and small hover nudges only.
- Do not drop a decorative tracked label above a heading. A heading and a tilted sticker carry the world; an eyebrow strip above the H1 is not the house style.
