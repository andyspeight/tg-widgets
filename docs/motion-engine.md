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
