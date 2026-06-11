# TG Slicer — v0.3.0

Point at any component on any live website, capture it clean, and turn it into an
editable Travelgenix Duda widget. An internal accelerator, not a product to sell.

The whole loop runs locally in the extension: **capture, build, review.** No
network, no model, nothing to deploy. The capture engine is in `capture.js`, the
build sheet is assembled by `emit-local.js`, and the review tab shows it back to
you ready for Duda.

## The flow

1. Click the toolbar icon, hit **Start slicing this page**.
2. Hover a component. **↑** widens to the parent, **↓** narrows to a child. Click
   to lock, then press **C** (or the **Capture** button).
3. Hit **Make Duda widget**. The build sheet is assembled on the spot and a
   **review tab** opens. No endpoint, no waiting.
4. In the review tab: an approximate preview, the content and design inputs to
   create, the Handlebars HTML and the desktop and mobile CSS each with a copy
   button, plus **Copy full build sheet**, **Open full preview** and
   **Download HTML**.
5. Paste into Duda Widget Builder once, publish, and it is a reusable section on
   every client site.

The older capture-and-copy buttons, **Copy HTML+CSS** and **Copy slice JSON**,
are still on the capture bar if you want them.

## Setup

Load unpacked: `chrome://extensions` → Developer mode → Load unpacked → pick this
folder. That is it. Leave the popup's endpoint and secret blank, the default path
does not use them.

## What the review tab gives you

- **Approximate preview.** A quick in-tab render with defaults filled. It is not
  pixel-exact and is labelled as such. Hit **Open full preview** for the real,
  full-width render in its own tab. The true proof is dropping it into Duda.
- **Content inputs and design inputs.** The exact inputs to create in Widget
  Builder, in order, with variables, defaults and any list sub-inputs.
- **HTML and CSS blocks.** Copy each into the matching Widget Builder field.
- **Copy full build sheet.** The whole thing as Markdown, the same shape as a
  written build sheet.

## Deliberate limits (rebuilt in Duda, not faults)

- Hover and focus states and `@media` rules are not captured. The responsive
  layout is rebuilt to our tokens in Duda.
- Repeated cards come through one by one, not yet as a single repeating list.
- Anything painted by JavaScript (a WebGL shader, a JS counter) cannot be lifted
  as CSS. A WebGL hero becomes an editable pure-CSS animated gradient stand-in.

## The optional AI path

There is an optional "AI smarten up" endpoint for later. It is not needed for the
default build or the show. See `AI-EMIT-ENDPOINT.md`.

## Files

| File | Role |
|------|------|
| `manifest.json` | MV3 manifest (v0.3.0) |
| `background.js` | On-demand injection, opens the review tab |
| `capture.js` | Capture engine: snapshot, scope, absolutise, inline sprites |
| `emit-local.js` | Builds the Duda build sheet locally |
| `content.js` | Selector overlay, capture bar, local build |
| `overlay.css` | Scoped overlay styles |
| `popup.html` / `popup.js` | Activate, plus the optional endpoint and secret |
| `review.html` / `review.css` / `review.js` | The build-sheet review screen |
| `AI-EMIT-ENDPOINT.md` | The optional AI endpoint reference |
| `SHOW-RUNBOOK.md` | Build one widget into Duda, then run the stand demo |
