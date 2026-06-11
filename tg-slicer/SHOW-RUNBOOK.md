# TG Slicer — show runbook

For the TravelTech Show, 24 to 25 June 2026, ExCeL London, stand N60. Two parts:
build one widget into Duda end to end, then run the stand demo. The engine is done
and green, this is the last mile.

## Part A — build one widget into Duda Widget Builder

You only need to prove this once before the show. Do it with the Hays "Book with
confidence" band, or any slice whose full preview looked faithful.

1. **Capture and open the build sheet.** Slice the section, hit **Make Duda
   widget**, then in the review tab hit **Copy full build sheet**. That Markdown
   has everything below, in order.
2. **New Custom Widget.** In Duda, open Widget Builder and create a new widget.
   Name it from the sheet's widget name.
3. **Content inputs.** Create each content input from section 1 of the sheet, in
   order. Match the type (Text, Large Text, Image), the variable name and the
   default. The defaults are the original content, so the widget looks right
   before anyone edits it.
4. **Design inputs.** Create each design input from section 2. These are the
   editable colours and toggles, each mapped to a selector. For a WebGL gradient
   stand-in, the gradient colours come through here as Color inputs.
5. **HTML.** Paste section 3 into the widget's HTML field. It already uses Duda's
   `{{variable}}` tokens, so the inputs wire straight in.
6. **CSS.** Paste section 4 (desktop and tablet) and section 5 (mobile) into the
   CSS field. The CSS is scoped to the widget's `.tgs-` classes, so it will not
   leak into the page.
7. **No JavaScript.** The widget is CSS only by design. Nothing to paste in the JS
   field, nothing for Duda to sanitise.
8. **Publish to the library**, drop it on a test page, and run the acceptance test
   below.

### Acceptance test (the real proof)

The sheet's own **Acceptance test** section is the checklist, generated per
widget. In general, confirm:

- It renders on the page looking like the original full preview.
- Editing each content input in Duda updates the widget.
- Editing each design input (a colour, a toggle) updates the widget.
- It picks up the site theme colour where it should.
- It reflows sensibly on mobile.
- A non-coder could do all of the above without touching code.

If something here fails, that is a real fault. Send me the slice (the review tab's
**Download HTML**) and what broke, and I will fix it. Everything that passes is
done, resist polishing further.

## Part B — the stand demo

The beat is simple: their vision, our build, their ownership.

1. **Ask.** "What site do you love? What does great look like to you?" Let them
   name a site.
2. **Open it** in Chrome with TG Slicer pinned.
3. **Slice** one strong section live. Lock it with the arrow keys, press **C**,
   hit **Make Duda widget**.
4. **Show the review tab**, then **Open full preview** next to the original. "That
   is your section, captured clean, in about a minute."
5. **Drop it into Duda** (or show the one you pre-built) and restyle a colour or a
   line of text in the panel. "Editable by anyone, no developer."
6. **Land it.** "We can match your vision and you own it."

### Keep it safe on the stand

- **Have a banker.** Pre-build the Hays band into Duda and keep its full preview
  open in a tab. If the floor wifi or a chosen site fights you, show the banker
  and carry on.
- **Pick friendly sections.** A hero, a USP band, a card row or a footer slice
  cleanly. Avoid deep app-like pages and login walls.
- **Moving heroes.** A CSS-animated gradient carries through. A canvas or WebGL
  hero comes back as an editable gradient stand-in. That is the story, not a flaw.
- **Offline fallback.** **Download HTML** from the review tab gives a standalone
  file you can open with no network.
- **Legitimate use.** Slice sites the prospect owns, or a well-known reference
  site as a live throwaway. Do not publish a permanent clone of someone else's
  site.
