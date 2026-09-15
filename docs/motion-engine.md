# The motion engine: what is actually built

**Written 25 Aug 2026, because Andy asked what is in it and the honest answer
was more than the person who built half of it was remembering.**

This is the BUILT inventory: what a client can switch on today, in the editor,
by name. It is not the design catalogue. That is `references/motion-recipes.md`
in the travelgenix-taste skill, which holds the recipes' purpose, tier and
rationale, including ones that are agreed but not implemented. Read that one to
decide WHETHER something should move. Read this one to find out what is on the
menu.

If the two ever disagree, this file is wrong: `MOTION_CHOICES` in
`lib/content/styles.ts` is what the editor actually renders.

---

## Ten movements, each with three strengths

A section's **Movement** dropdown. Every one also takes an intensity, and the
band is deliberately Gentle / Medium / Strong with no "off": a recipe that can be
turned down to nothing is a checkbox wearing a slider's clothes.

| Editor label | Recipe | What moves |
|---|---|---|
| Pictures breathe | A5 | The pictures inside the section, not its background |
| Background drifts | A6 | The section's background photograph, on its own clock |
| Scenes change | A2 | Background frames cross-fading |
| Layers drift apart | A4 | Near and far layers separating |
| Film behind the words | A7 | A moving background behind the text |
| Cinematic sea | A1 | A WebGL Gerstner-wave sea on the GPU, behind the words |
| Background settles | S5 | The background scrubbing to rest as you scroll |
| Words rise like a tide | S1 | The section's text arriving |
| Cards stack up | S3 | Sticky-stacking cards |
| Cards travel sideways | S2 | The section pins and its cards travel horizontally on scroll |
| Cards drift past | A3 | A rail drifting on its own, added to by scroll |

**All eleven are live.** Every entry the editor offers renders, and
`tests/motion.test.ts` fails if one does not. S2 the pinned itinerary (added 31 Aug
2026) is pure CSS: on Chromium the section pins and its card row travels sideways on
a named view-timeline; on Safari, Firefox and under reduced motion it falls back to a
swipeable scroll-snap carousel, a finished section either way. It only turns on when
the section actually has a Cards block to travel.

**Two need JavaScript, each its own file, and the rest are pure stylesheet.** A3
drifting-rail pulls `tg-motion.js` (a track that drifts by itself AND is added to
by scroll is the one thing CSS cannot express). A1 cinematic sea (added 31 Aug
2026) pulls `tg-sea.js`, the hand-written WebGL shader engine: it is the one tier-2
recipe, so it caps itself at one canvas per page, creates NO canvas at all under
reduced motion (the section's own still photograph is the fallback and a finished
hero), caps the device pixel ratio, and pauses when off-screen or the tab is
hidden. A page carrying neither ships neither file: a page that asks for nothing
ships nothing.

Separately, `tg-motion.js` now also carries a fallback so **reveal and parallax
move on Safari and Firefox** (added 31 Aug 2026), not just Chromium. They are
scroll-driven CSS on a view() timeline that only Chromium ships; where it is
missing the script drives the same keyframes on an IntersectionObserver and a
scroll listener, and where it is present the CSS does it all and the script stands
down. See the reveal/parallax fallback in `app/globals.css` and `public/tg-motion.js`.

---

## Three things a recipe can claim, and the collisions the editor resolves

This is why picking a recipe sometimes clears a tick box you had set. Two things
animating one element is the bug, so the model resolves it rather than letting
both run.

- **The background**: A2, A4, A6, A7, S5. Choosing one clears Parallax and Ken
  Burns, because those move the same picture.
- **The arrival**: S1. Choosing it clears Reveal and Stagger, because those are
  also how a section arrives.
- **Neither**: A5, S3, A3 compose freely with the background and arrival
  settings.

---

## The rest of the menu, which is not recipes

**A section arriving**
- Reveal, on or off, with six styles: Rise up, Fade in, Slide from the left,
  Slide from the right, Zoom in, Blur in.
- Stagger, so the section's contents cascade rather than arriving together.

**A section's background photograph**
- Parallax: drifts as you scroll.
- Ken Burns: drifts and zooms on its own, unrelated to scroll. The right one for
  a hero somebody lands on, since parallax does nothing until they move.

**A section under the pointer**
- Hover lift, hover zoom, hover tint. All pure CSS, all held back under
  prefers-reduced-motion.

**Individual blocks**
- Key numbers: count up on scroll.
- Heading: animated gradient text, in two chosen colours.
- Icon: pulse.
- Slider: tilt.
- Logo strip: scrolls by itself, pausing on hover.
- Cards: the link underline sweeps in.
- Gallery, **a wall of drifting rows** (15 Sep 2026, from the React Bits review):
  the rail's marquee stacked two or three deep, alternate rows running the other
  way, each on its own period so they never fall into step. Holds under the
  pointer and under keyboard focus; a wrapped grid with the copies gone under
  reduced motion. Pure CSS.
- Gallery, **a deck of postcards** (15 Sep 2026): up to eight pictures fanned,
  the top one sliding off to the right and under the pile every 3.5 seconds, on
  keyframes the way Shifting images is. Holds under the pointer; a still fan
  under reduced motion and on the editing canvas. Pure CSS.

The same review added three LAYOUT shapes that do not move and so are not
listed here: bento and featured grids on Cards and the Collection loop, and the
gallery mosaic. See `docs/react-bits-review.md`.

## Words: arriving, taking turns, under the pointer (15 Sep 2026)

The third slice of the React Bits review, on the **Heading** block's Effects
group and one setting on **Text**. `lib/content/words.ts` wraps each word (or
letter) of the sanitised markup in its own span on the server; the stylesheet
and `public/tg-motion.js` do the rest.

**The words arrive** (Heading): *All at once* | *Word by word* | *Word by word,
from a blur* | *Word by word, rising out of a line* | *Letter by letter*. The
first time the heading scrolls into view, each piece a step behind the last.
Time-based CSS, so it plays on every browser; the script (`setUpArrive`, an
IntersectionObserver) only says WHEN. The content never depends on it: words are
hidden only once the script has marked the heading (`data-arrive-fb`), the same
promise the reveal fallback keeps, so no script means the words simply stand.
Past 120 letters a heading arrives by word. A page with an arriving heading
pulls `tg-motion.js` (`needsMotionScript` now walks the blocks).

**Words that take turns** (Heading): a list of words, one per line, that take
turns where `{{turn}}` sits in the text (or after it). "Holidays to Greece",
then Italy, then Portugal, 2.6 seconds a word, on keyframes per count like the
slideshow, no script. The words share one inline grid cell so the heading never
jumps. Still on the canvas and under reduced motion, on the first word.

**Under the pointer** (Heading; Andy's ask, 15 Sep): *The word lifts and takes
the accent* | *A frame finds the word, the rest fall back* | *Words near the
pointer swell*. Mouse only, behind `(hover: hover) and (pointer: fine)`, and
behind the reduced-motion guard like the section hover effects. The swell is the
one that needs the script (`setUpProximity` writes `--near`, 0 to 1, on each
word, rAF-throttled, measured once per entry); the other two are CSS.

**Outlined letters** (Heading): a stroke in the heading colour with a clear
fill, through `-webkit-text-fill-color` so `currentColor` keeps the theme's
colour. Still.

**Word by word as you scroll** (Text): the words of a statement go from faint to
solid as the reader scrolls to it, each word its own slice of the block's view
timeline. Chromium and Safari 26; elsewhere the words are simply solid.

**Not with the animated gradient.** That paints the gradient through the
heading's own glyphs, and a word that moves is composited outside that clip, so
it would paint clear. A gradient heading keeps its words whole and its turning
word still. The render enforces it; nothing goes blank.

Three presets use them: `hero-big-title` (letters, and the swell),
`hero-turning-word` (new: the turning destination), `text-statement` (the
scroll reveal). `tests/words.test.ts`.

## Cards and buttons under the pointer (15 Sep 2026)

The fourth slice of the React Bits review. Three more toggles in the section's
Motion group, beside the lift, the zoom and the tint, and one select on the
**Button** and the **Buttons** row. All mouse only, behind `(hover: hover) and
(pointer: fine)`, so a phone carries nothing it cannot use; everything that
moves is behind the reduced-motion guard as well; nothing runs on the editing
canvas (the section flags are gated on not editing like the tint, and a
button's effect is dropped there, because a button that slides toward the
pointer slides away from the person trying to select it). Every layer is
`pointer-events: none`, the lesson the tint paid for: the whole card is usually
a link.

**Spotlight** (section): a soft pool of the accent follows the pointer across
each card. `setUpCardPointer` in `tg-motion.js` writes `--mx` and `--my` (as
percentages of the card) and the stylesheet draws a radial gradient there on
the card's `::before`. With no script the pool sits at the centre and still
lights on hover: a finished effect, not a broken one. It only fades, so it
stays under reduced motion like the tint.

**Tilt toward the pointer** (section): each card leans up to seven degrees
toward the pointer (`--rx` and `--ry` from the same listener, behind
`perspective(900px)`) and eases back when it leaves. The card's box is measured
once on entry and again after a scroll, never per move, because a tilted card's
rect moves under every read. With the lift on as well, a combined rule keeps
the lean and adds the 4px rise, or the lift's own transform would flatten it.
Held still under reduced motion.

**Glare** (section): a sheen sweeps across each card's picture as the pointer
arrives, on the frame's `::before`, parked off to the left and only moved behind
both guards. Pure CSS.

**Under the pointer** (Button and Buttons row, one effect for the whole row):
*Nothing* | *A sheen sweeps across it* (CSS, the button clips it) | *It pulls
toward the pointer* (`setUpMagnets` writes `--px` and `--py`, up to 8px toward
the pointer, and clears them on leave; the stylesheet eases) | *A line of light
runs round it* (a 2px conic ring on `::before`, cut with a mask, its angle a
registered `@property` so it can turn; the Star Border turned well down, a ring
and not a glow). The ring shows for the keyboard too (`:focus-visible`); it
turns only where motion is welcome.

A page pulls `tg-motion.js` (1.3.0) only for the spotlight, the tilt or a
magnetic button; the glare, the sheen and the trace are CSS and pull nothing.
Three presets use them: `features-bento-destinations` (spotlight),
`hero-cards-below` (glare), `hero-turning-word` (a sheen on its buttons).
`tests/pointer.test.ts`.

## Menus: how a link looks, and what the burger opens (15 Sep 2026)

The fifth and last slice of the React Bits review, on the **Menu** block. Two
new settings, and one thing the menu now knows that it never did.

**The current page.** `fillNavFolders` in `lib/content/nav.ts`, which already
fills a folder link with its pages at the render boundary, now also takes the
address of the page being drawn and marks the link to it `current`. The block
renders that as `aria-current="page"`, so a screen reader says "current page"
on it, and the two styles below mark it. The site route, the standalone preview
and the editor canvas all pass the address (the editor works it out with the
site's own `livePaths`), so a client sees the mark while editing.

**Link style**: *Plain* | *Pill* (every link in a rounded field; the current
page washed in the brand colour, the link under the pointer in a lighter wash;
on a dark or accent bar the wash is the band's own border tint, the pair the
dropdown's hover already uses) | *Underline sweep* (a two-pixel line in the
link's own colour that draws in from the left under the pointer, leaves to the
right, and stays under the current page; the origin swap does the sweep, and
only the transition sits behind the reduced-motion guard). Both CSS. Inside a
burger's list the underline is dropped, where a full-width line reads as a
rule, and the current page takes the brand colour instead.

**Behind the button**: *A panel under the bar* (what it always opened) | *The
whole screen* (the stacked list becomes a fixed overlay over the viewport, the
links at display size, `clamp(2rem, 6vw, 4rem)`, arriving one a beat behind the
last; a folder's pages beneath at reading size; the burger that opened it stays
where it was as a cross, above the overlay; the page beneath stops scrolling
through a `:has()` on `html`; the header rises for the stacking reason the
always-on panel documents) | *Cards* (the links as a grid of cards, each
folder's pages beneath its card, the same panel otherwise).

**The focus concern, answered.** The always-on burger's note in `globals.css`
and `tests/burger.test.ts` recorded why a full-screen overlay was not chosen
in August: without a script nothing stops Tab wandering behind it. So the full
screen brings `setUpFullMenu` in `tg-motion.js` (1.4.0) with it: while one is
open, everything outside its header is `inert`, Escape closes it and hands
focus back to the button. It is wired BEFORE the script's reduced-motion return,
because it is the keyboard and not motion. With no script the overlay still
opens and closes from its cross. A full-screen menu is the only menu setting
that pulls the script.

**Never on the editing canvas.** The canvas is not an iframe: it sits inside the
editor's own page, through Preview too, so a fixed overlay there would cover
the tools. The block reads the canvas flag (`editorCanvas`) and opens the panel
instead; the standalone preview and the site show the real thing. The default
panel a menu gets without asking is still the absolute one, and still not fixed.

Three presets: `header-cta-bar` (pills), `header-dark-bar` (the underline),
and new `header-logo-full-menu` (the logo alone and an always-on burger that
opens the whole screen, the luxury and editorial header). `tests/menus.test.ts`.

## Backdrops: an atmosphere behind a section with no photograph (15 Sep 2026)

A section's **Backdrop** select, in the Motion group beside the animated
gradient. Six, each CSS over gradients or an SVG mask in the section's own two
colours (the gradient colours if set, otherwise the theme accent and brand, and
white on the dark and brand bands), no canvas and no script:

| Backdrop | What moves | Reading |
|---|---|---|
| Aurora | Two pools of light drifting across the top, on 26s and 37s | The Nordics |
| Light rays | Soft shafts from above, turning five degrees each way over 48s | Sun through water or cloud |
| Waves | Two rows of water along the foot, drifting past each other | The coast |
| Drifting specks | Two layers of soft dots falling at different speeds | Snow for ski, stars for a desert night |
| Map contours | Contour lines drifting a little over a minute | The map every travel site has |
| Grain | Nothing: a two-colour wash under film grain | The editorial page |

Rules that hold for all six: never emitted for a section with a background
picture or film (the background recipes own that picture); still on the
editing canvas (`data-backdrop-still`), the eye shows it moving; every
animation inside the reduced-motion guard, so a visitor who asked for less
gets the same atmosphere holding; only transform animates, on the layers, so
nothing repaints the words. Six pictureless presets wear one (the dark CTA
panel, the stats band, the newsletter, the one big quote, the reassurance
strip, the statement) and the picker hints at it. `tests/backdrops.test.ts`.

---

## Two rules that hold across all of it

**Everything honours prefers-reduced-motion.** Not as an afterthought: reduced
motion is a second designed version of the page, never an animation switched off.
A visitor who asks for less gets a still, complete page.

**A page that asks for nothing ships nothing.** Motion is conditional all the way
down, so a site using none of this carries no motion CSS decisions it did not
make and no script at all.

---

## Why a client might see no motion (30 Aug 2026)

Andy: "it is not obvious there is any motion." Three real causes, all now
addressed, recorded so the next person does not re-diagnose them:

1. **Motion is PAUSED while editing.** The render suppresses every section motion
   (the recipe, reveal, parallax, Ken Burns, hover) on the editing canvas, gated
   on `!editable` in PageRenderer, so a drifting background does not jump back to
   the start on every keystroke and a reveal does not replay as you type. Correct
   for editing, but it means a client who sets a recipe and stays in the editor
   sees nothing. The fix is a note in the Motion group and the answer it gives:
   **press the eye (Preview) to see it.** Preview and the published page run it.

2. **The ambient recipes were below the eye's threshold.** Measured in Chromium,
   A6 "Background drifts" moved 0.075% of scale and 0.14px over 1.5 seconds at its
   old 26s duration: technically animating, perceptually a still. Retuned 30 Aug:
   A6 16s (was 26s), A5 frames 16s (was 26s), Ken Burns 18s (was 24s), and the
   drift keyframe pans -6%,-4% (was -2%,-1.5%). Still calm, now visibly moving on
   load. `tests/motion.test.ts` pins these so they cannot drift back to subtle.

3. **A recipe with an unmet precondition no-ops silently.** A6 needs a background
   photograph (`.tgs-section__bg`); A5 needs cards or images in the section; S1
   needs text blocks; S3 needs cards. Pick one without its precondition and
   nothing moves. `motionHasWhatItNeeds` in the render already refuses to emit
   `data-motion` for a recipe whose precondition is unmet, so the attribute in the
   DOM always means something really moves; the remaining gap is telling the
   client in the editor, a future nicety.

Separately, the scroll-STEERED recipes (S1, S5, parallax, reveal) sit behind
`@supports (animation-timeline: view())`. That is true in Chromium; where it is
not, those recipes fall to a still, complete page (progressive enhancement). The
ambient A-family recipes above need no such support and move everywhere.

## Where this got embarrassing, recorded so it does not repeat

Asked on 25 Aug to make a client hero "more impressive", I offered Ken Burns and
parallax and described those as the options. They are not. For a hero whose
motion has to move the background PHOTOGRAPH the real list is seven: Ken Burns,
Parallax, and the five background recipes A2, A4, A6, A7 and S5. Andy's reply was
that we spent a long time building this and not using it is not good, and he was
right on the facts as well as the principle.

The lesson is narrower than "read the code": the motion vocabulary lives in four
places that each look complete on their own. `MOTION_RECIPES` is the enum,
`MOTION_LIVE_RECIPES` is what is built, `MOTION_CHOICES` is what a client sees,
and the section schema carries parallax, kenBurns, reveal and the hover flags
that are not recipes at all. Reading any one of them and stopping gives a
confident, wrong answer.
