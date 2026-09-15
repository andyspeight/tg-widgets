# The React Bits review (tg-sites, what the layouts can learn)

**Written 15 Sep 2026. Andy: "the layouts, etc are fairly basic. Review reactbits.dev
and see what we can learn, and add to the platform." Companion to
`elementor-gap-analysis.md` and `duda-gap-analysis.md`, which compare us with rival
CMSs. This one compares us with an effects library, so it asks a different question:
not "what can a client do that we cannot" but "what makes a page FEEL designed that
ours does not do yet".**

Our side is read from the code on 15 Sep 2026, every claim with a file behind it.
React Bits' side is read from the library's own category index in its repository
(`src/constants/Categories.js`, 171 components on the day), because reactbits.dev
itself is blocked by the session egress. Dependencies are read from the repository
and from knowledge of the library rather than from the demo pages, so treat any
"needs WebGL" call as indicative.

---

## The short version

React Bits is not a layout library. It is 171 effects: 32 text animations, 38
animations, 45 components and 56 backgrounds, each a copy-in React component, with
the heavier ones leaning on GSAP, Motion, Three.js and OGL. Thirty-odd of the 56
backgrounds are shader canvases. It is the same shape as Scrolltide was: an
ATMOSPHERE library, and a good one, with almost nothing structural in it.

That settles the how before the what. A published tg-sites page carries no React
runtime and no animation library: the render tree "ships no JavaScript at all, which
is the property the whole project is built on" (`lib/content/blocks.ts`, the slider's
own comment), and the two motion scripts we do ship are 325 and 310 lines of
hand-written vanilla, loaded only by a page that asks for them
(`lib/content/motion.ts`, `components/render/MotionScript.tsx:39`). That is what the
98 / 99 PageSpeed scores rest on. So nothing here is imported. **The rule is the one
recorded for Scrolltide: take the direction, never the code.** React Bits' MIT plus
Commons Clause licence never comes into it, because no line of theirs reaches the repo.

What we learn is a vocabulary, and five of its words are missing from ours:

1. **Shapes.** Every grid we draw is equal cells. Bento, a mosaic, a photo wall and
   a fanned deck are the layouts a visitor reads as designed, and the equal
   three-card row is the single most common AI tell in the taste skill. **Built
   and shipped 15 Sep 2026**, see the note at the end of section 1.
2. **Backdrops.** A section without a photograph is a flat colour or one gradient.
   Aurora, light rays, soft waves, drifting particles, contour lines and grain give a
   call to action or a stats band an atmosphere without a picture. **Built and
   shipped 15 Sep 2026**, see the note at the end of section 2.
3. **Words arriving.** The one thing on a hero that never moves is the headline. Word
   by word, letter by letter, line by line, a word that takes turns, an outlined
   display style.
4. **Under the pointer.** Spotlight, tilt and glare on cards; a sheen and a magnetic
   pull on buttons. Our hover vocabulary is lift, zoom and tint.
5. **Menus.** A pill that marks the current page, and a full-screen staggered menu
   behind the burger, the two header treatments a luxury client notices.

Everything else in the library, and it is the majority, is either something we
already have under a different name or something with no travel reading at all. Both
lists are below, so the next person does not re-review 171 components.

---

## What we already have, so it is not built twice

The library's names beside ours. If a client asks for the left column, the answer is
the right column, and it is already in the editor.

| React Bits | Ours | Where |
|---|---|---|
| Animated Content, Fade Content | Section **Reveal**, six styles, plus **Stagger** | `styles.ts:586`, `globals.css:1004` |
| Count Up, Counter | Key numbers **Count up on scroll** | `blocks.ts:2930` |
| Gradient Text, Shiny Text | Heading **Animated gradient** | `blocks.ts:402`, `globals.css:957` |
| Logo Loop, Infinite Scroll, Infinite Menu | Logo strip **Scroll the logos**; Gallery **rail that scrolls itself** | `blocks.ts:3014`, `:1739` |
| Scroll Stack | **Cards stack up** (S3) and the Stacked cards block | `styles.ts:560`, `blocks.ts:1259` |
| Carousel, Depth Carousel, Morph Slider, Elastic Slider | Slider with **Tilt**, Screen carousel, Half overlay slider, S2 **Cards travel sideways** | `blocks.ts:2121`, `:1092`, `:882` |
| Accordion Gallery | Expanding cards | `blocks.ts:1004` |
| Stepper | Steps, numbered or a timeline | `blocks.ts:2771` |
| Card Swap, Bounce Cards | Shifting images, three pictures trading places | `blocks.ts:1342` |
| Pixel Transition, Decay Card, Sticker Peel | Flipping boxes, tap or hover | `blocks.ts:1169` |
| Waves, Silk, Liquid Ether, Sliced Waves | **Cinematic sea** (A1), a real Gerstner sea on the GPU, with nine tones | `public/tg-sea.js`, `styles.ts:611` |
| Slideshow-style backgrounds | Section background slides, fade or slide | `PageRenderer.tsx:410` |
| Video backgrounds | **Film behind the words** (A7) | `styles.ts:560` |
| Glare Hover, Tilted Card (in part) | Section **hover lift, zoom, tint** | `globals.css:1195`, `:1216`, `:1277` |
| Scroll Float, Scroll Reveal (in part) | **Words rise like a tide** (S1), per block | `globals.css:1524` |
| Magic Rings, Glass Icons (the icon pulse) | Icon **Pulse**, ring or glow | `blocks.ts:4089` |

That is a longer list than the motion doc's embarrassing lesson of 25 Aug would
predict, and it is the reason this review starts with an inventory: the engine is
eleven recipes with three strengths, six reveal styles, three background effects,
three hover effects and seven block-level effects. Read `docs/motion-engine.md` before
telling a client something cannot move.

---

## The five gaps, ranked by what a visitor notices

Ranked by the same tests as every motion decision here: does it make a section feel
designed rather than assembled, does it mean something about a holiday or at least
feel physical under the hand, can it be CSS alone (tier 0) or a few lines in
`tg-motion.js` at most (tier 1), is it a SETTING on a block or section we already have
rather than a new block a client has to find, and does it have a still, designed
answer under reduced motion.

### 1. Shapes: every grid is equal cells

React Bits: Magic Bento, Masonry, Drift Wall, Stack, Flying Posters, Rolling
Gallery, Circular Gallery, Dome Gallery.

Ours: Cards go two, three or four across, every cell the same
(`blocks.ts:2013`). Gallery goes two, three or four across, or one self-scrolling
rail (`blocks.ts:1720`, `:1739`). The Collection loop shares the grid. 129 section
presets and every card row in them is equal.

This is the gap that answers "the layouts are fairly basic" most literally, and it
is tier 0 throughout.

- **Cards and the loop gain a `shape`:** *Even* (today) | *Bento* (the first card
  spans two cells, then the rhythm continues, in CSS `grid-template-areas`) |
  *Featured* (the first card full width, the rest three across). A destinations grid
  where Greece is the big picture and Italy and Portugal sit beside it reads as a
  choice somebody made. On a phone all three collapse to one column, as now.
- **Gallery gains three layouts:** *Mosaic* (some pictures two cells wide or two
  tall in a fixed rhythm, the rest packed round them; a designed mosaic rather than
  React Bits' masonry of natural heights, because natural heights only settle once
  every picture has loaded and the page shifts under the reader, which the project's
  CLS of zero forbids), *Photo wall* (two or three rows drifting in opposite
  directions and pausing under the pointer, the Drift Wall, which is also the
  Instagram-wall hero we have a preset shape for in `hero-gallery-social`), and
  *Deck* (photographs fanned like postcards, the top one sliding to the back every few
  seconds, holding under the pointer, a click still opening the picture; the Stack and
  Bounce Cards, built the way Shifting images already is, on keyframes, so no script).
  Postcards from the trip is the travel reading, and it is a strong one.
- **Four designed presets** to put them in the picker, so a client meets them without
  reading a menu: a bento destinations section, a mosaic gallery, a photo-wall hero
  and a postcard deck beside words. Each drawn in the picker by `presetThumb` and
  photographed on insert like the rest (the 1 Sep doctrine in `presets-page.ts`).

Rolling Gallery (a 3D cylinder of pictures) is possible in CSS but cramped on a
phone; Circular and Dome galleries are WebGL. All three parked.

**Built 15 Sep 2026, the same day.** `shape` (even, bento, featured) on the Cards
block and the Collection loop; `layout` gains mosaic, wall and deck on the Gallery;
four presets (`features-bento-destinations`, `gallery-mosaic`, `hero-photo-wall`,
`gallery-deck-beside-words`), each photographed on insert with the frame count its
shape needs; `tests/shapes.test.ts`. Checked in Chromium through the real renderer
at 1280 and 390 and under reduced motion, which is how three bugs were found before
they shipped: a phone reset that lost to the desktop rules on specificity (the
second bento card was squeezed to zero width), the deck still dealing under reduced
motion for the same reason, and a mosaic rhythm that repeated its double every six
and left two rows of holes in an eight-picture gallery. All three are pinned in the
test file with the measurement that found them.

### 2. Backdrops: a section without a photograph is a flat panel

React Bits: Aurora, Soft Aurora, Light Rays, Side Rays, Beams, Light Pillar,
Lightfall, Gradient Waves, Line Waves, Floating Lines, Threads, Particles, Pixel
Snow, Grainient, Topography, Dot Grid, Dot Field, Grid Motion, Silk, Plasma, Orb,
Iridescence, Galaxy, Prism, Liquid Chrome and more. This is the library's largest
category and the one where it is strongest.

Ours: a section background is a photograph, a video, a slideshow, or one animated
two-colour gradient (`PageRenderer.tsx:500`, `globals.css:382`). The sea needs a
photograph for its sky. So the call to action, the stats band, the newsletter panel,
the testimonials and the banner, exactly the sections that have no picture, are a
colour.

- **The section gains a `backdrop`,** a select in the Background group beside the
  gradient toggle, drawn in the section's two gradient colours or the theme accent:
  *Aurora* (layered light drifting across the top of the frame; Northern Lights, the
  Nordics), *Light rays* (soft shafts turning slowly through the frame; sun, water),
  *Waves* (two or three soft wave layers drifting on different periods; the coast),
  *Drift* (a slow fall or rise of soft particles; snow for ski, stars for the desert),
  *Contours* (map contour lines with a slow drift; walking, routes, the map every
  travel site has), and *Grain* (a colour gradient under film grain, still or barely
  breathing; editorial and luxury). Every one is CSS keyframes over gradients or an
  inline SVG pattern, tier 0, no canvas. Under reduced motion the same backdrop
  stands still. Text stays under the scrim rules that already protect it over a
  photograph.
- **The presets that have no picture are updated** so a client sees them worn: the
  dark CTA panel, the stats band, the newsletter, the reassurance banner.

Skipped, with the reason the Scrolltide table gives for its own skips: Balatro,
Hyperspeed, Faulty Terminal, Letter Glitch, CRT Warp, Evil Eye, Lightning, Laser
Flow, Liquid Chrome, Molten Metal, Dither, Pixel Blast, Ballpit, Radar, Scanner,
Acid Squares, Grid Scan have no travel reading. Silk, Iridescence, Plasma, Orb,
Prism, Liquid Ether, Ferrofluid, Galaxy, Light Tunnel are shader canvases, and the
one tier-2 slot a page has is the sea's (`docs/motion-engine.md`, the per-page cap).

**Built 15 Sep 2026, the same day as the shapes.** A `backdrop` on the section
(`BACKDROP_CHOICES` in `styles.ts`, the select in the editor's Motion group beside
the animated gradient), six atmospheres in `globals.css` as one element with two
pseudo-element layers, the colours from the section's gradient pair or the theme,
white on the dark and brand bands. Never emitted for a section with a picture or a
film; still on the canvas and under reduced motion. Six pictureless presets wear
one and the picker hints at it. `tests/backdrops.test.ts`, and a Chromium check of
all six on all four tones, moving, holding under reduced motion, and under the
words.

### 3. Words arriving: the headline is the one thing that never moves

React Bits: Split Text, Blur Text, Masked Heading, Text Type, Rotating Text, Text
Loop, Scroll Reveal, Scroll Float, Stroke Text, Shiny Text, Variable Proximity, Text
Pressure, and a dozen glitch and scramble effects.

Ours: a section's reveal moves the WHOLE block (`globals.css:1004`); S1 lifts blocks,
not words; the heading has an animated gradient and nothing else (`blocks.ts:402`).
There is no per-word arrival, no word that takes turns, and no outlined display style.

- **Heading gains `arrive`:** *All at once* (today) | *Word by word* (each word rising
  on a short stagger) | *Word by word, from a blur* (Blur Text) | *Letter by letter*
  (Split Text) | *Line by line* (Masked Heading, each line wiping up inside its own
  mask, with the descender padding the motion catalogue's trap 2 demands). The render
  splits text nodes only, so bold and italic inside a heading survive, puts the whole
  heading in `aria-label` and marks the pieces `aria-hidden`, exactly as P3 in the
  catalogue prescribes. Keyframes with a per-piece delay, on the view timeline where
  Chromium has it and on the IntersectionObserver fallback `tg-motion.js` already
  runs for reveal everywhere else (`public/tg-motion.js`, `setUpRevealFallback`).
- **Heading gains `turns`,** a short list of words that take turns at a marker in the
  text: "Holidays to Greece" where Greece gives way to Italy, then Portugal, on the
  same keyframe scheme the section slideshow uses for two to eight frames
  (`globals.css:2868`). No script. For a travel headline that is the strongest text
  effect in the library, because the words are destinations.
- **Heading `style` gains *Outlined*** (Stroke Text): `-webkit-text-stroke` in the
  heading colour with a clear fill, still, tier 0. A display-size outlined word over a
  photograph is a whole editorial register we cannot reach today.
- **Text gains `arrive: Word by word as you scroll`** (Scroll Reveal): the words of a
  statement go from faint to solid as the reader moves down. For the
  `text-statement` and `cta-statement` presets.

Text Type (the typewriter) needs a script for a proportional face and its blinking
cursor reads as software rather than travel; parked. Variable Proximity and Text
Pressure need a variable font with width and weight axes, which a client's chosen
face may not carry; that is P3 kinetic-type in the catalogue, still a slot.
Decrypted, Scrambled, Glitch, ASCII, Fuzzy, Falling, Split Flap, Warp, Particle,
Depth, Fold and Echo Text have no travel reading. Circular Text and Curved Loop are
badge shapes rather than headings; a maybe for a "since 1987" roundel, later.

### 4. Under the pointer: cards and buttons

React Bits: Spotlight Card, Tilted Card, Glare Hover, Border Glow, Star Border,
Electric Border, Reflective Card, Chroma Grid, Pixel Card, Magic Bento, Magnet,
Click Spark, Specular Button.

Ours: three section-level hover effects, lift, zoom and tint (`schema.ts:1009`,
`globals.css:1195`), and a border that strengthens on a clickable card
(`globals.css:4051`). Buttons have style, size, colour and outline (`blocks.ts:2445`)
and no effect of their own.

- **The hover group gains three:** *Spotlight* (a soft light on the card that follows
  the pointer; `tg-motion.js` writes the pointer position to two custom properties,
  the CSS draws the light), *Tilt* (the card leans a few degrees toward the pointer,
  the same listener), and *Glare* (a sheen sweeping across the picture, pure CSS).
  Spotlight and tilt are tier 1 and only wake behind `(pointer: fine)`, so a phone
  never pays for a pointer it does not have; all three hold still under reduced
  motion like lift, zoom and tint do.
- **Button gains `effect`:** *None* | *Sheen* (a light sweeping across on hover,
  CSS) | *Magnetic* (the button pulls a few pixels toward the pointer, `tg-motion.js`,
  `pointer: fine` only; the taste skill names this as the right physical feedback
  above motion 5) | *Trace* (a line of light running round the edge, the Star Border
  turned well down, because a neon glow is on the forbidden list).

Skipped: every cursor effect (Splash, Blob, Target, Ghost, Swarm, Glow Cursor,
Crosshair, Cursor Grid, Image Trail, Pixel Trail, Ribbons, Magnet Lines, Strands,
Antigravity, Cubes). The taste skill is direct about custom cursors: an accessibility
violation and a performance cost, and none of them means anything about a holiday.
Click Spark, Electric Border, Metallic Paint, Meta Balls, Noise, Shape Blur, Halftone
Reveal and Pixel Swap are gimmicks or shaders with the same problem.

### 5. Menus: the header a luxury client notices

React Bits: Pill Nav, Gooey Nav, Dock, Staggered Menu, Bubble Menu, Card Nav,
Flowing Menu, Line Sidebar.

Ours: the Menu block goes across or down, collapses behind a burger never, on phones
or always, and sets the link font, size, weight, colour and case
(`blocks.ts:2639`). The burger opens one panel style (`globals.css:5428`).

- **Menu gains `style`:** *Plain* | *Pill* (the current page's link sits in a soft
  pill and the pill lights under the pointer) | *Underline sweep* (a line that draws
  in from the left on hover and stays on the current page). CSS only.
- **The burger gains `panel`:** *Panel* (today) | *Full screen* (the Staggered Menu:
  the links cascade in at display size over the whole viewport, the treatment every
  editorial and luxury header uses) | *Cards* (Card Nav: the top-level groups as cards
  with their children beneath). CSS transitions on the existing open state.

Gooey Nav and Bubble Menu are SVG filter tricks that read as playful software; Dock
is a macOS quotation; Flowing Menu and Line Sidebar are portfolio furniture. Parked.

---

## Skipped outright, so the list is not re-reviewed

Three reasons, the same three the Scrolltide table used. No travel reading: the
glitch, scramble, terminal, casino and neon families. Needs a WebGL canvas: the shader
backgrounds and the 3D pieces (Lanyard, Model Viewer, Fluid Glass, Glass Surface,
Elastic Mesh, Infinite Spiral, Dome and Circular Gallery). Custom cursor: all thirteen
of them. Between the three reasons that is roughly ninety of the 171, and none of it
is a loss.

Two the review nearly kept and let go: **Gradual Blur** (the edges of a scrolling
list fading to a blur) is a nice finish for the gallery rail and the slider but is a
`backdrop-filter` on a moving mask, which is a scroll-time cost on a phone for a
detail; and **Folder** and **Profile Card** are lovely and are a portfolio's props,
not a travel site's.

---

## Recommended order, and why

Five slices, each one commit, each gated the same way as everything else (tsc,
vitest, next build) and each carrying its own tests, presets and docs update.

1. **Shapes** (bento and featured cards, mosaic, photo wall and deck galleries,
   four presets). It is the literal answer to "the layouts are basic", it is all CSS,
   and the loop gets the same two grid shapes. **SHIPPED 15 Sep 2026.**
2. **Backdrops** (six, a section setting, the pictureless presets updated). The
   biggest lift per line of CSS in the whole review: every flat panel on every client
   site gets an atmosphere. **SHIPPED 15 Sep 2026.**
3. **Words arriving** (heading arrive, turns and outlined; text scroll reveal). The
   heroes stop being still, and the rotating destination word is the one effect here
   that is more travel than it is web.
4. **Under the pointer** (spotlight, tilt, glare; button sheen, magnetic, trace).
   Finish, not structure, so it comes after the three that change what a page IS.
5. **Menus** (pill and underline sweep; full-screen and cards behind the burger).

Standing rules that apply to every slice and are not up for re-deciding: no library,
ever; tier 0 unless CSS genuinely cannot, then a few lines in `tg-motion.js` behind
the same `needsMotionScript` gate; reduced motion is a still designed page, not an
animation switched off; a page that asks for nothing ships nothing; motion stays
paused on the editing canvas and the eye (Preview) shows it; and every new effect
gets a line in `docs/motion-engine.md` the day it ships, because the vocabulary
living in four places is how the 25 Aug embarrassment happened.
