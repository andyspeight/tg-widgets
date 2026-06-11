# TG Slicer — v0.2 (full loop)

Point at any component on any live website, capture it clean, and turn it into a Travelgenix Duda widget build sheet, restyled to our brand and ready to paste into Duda's Widget Builder.

This is the whole loop: **capture → emit → review.**

## The flow

1. Click the toolbar icon, hit **Start slicing this page**.
2. Hover any component. Use **↑ / ↓** to widen or narrow to the exact boundary. Click to lock, press **C** to capture.
3. Hit **Make Duda widget**. The slice is sent to your Stage 2 endpoint, Claude turns it into a Duda build sheet, and a **review tab** opens.
4. In the review tab: see an approximate preview, the content and design inputs to create, the Handlebars HTML and CSS, each with a copy button, plus **Copy full build sheet** for the lot.
5. Paste into Duda Widget Builder once, publish, and it's a reusable section on every client site.

If you don't set an endpoint, the older **Copy HTML+CSS** and **Copy slice JSON** buttons still work for manual use.

## Setup

1. Load unpacked: `chrome://extensions` → Developer mode → Load unpacked → pick this folder.
2. Open the popup and set:
   - **Stage 2 endpoint**: `https://tg-widgets.vercel.app/api/slice-emit`
   - **Shared secret**: the same value as `TGS_SHARED_SECRET` in the tg-widgets Vercel project.
3. Deploy the endpoint first (see `SLICE-EMIT-DEPLOY.md`).

Both settings are stored locally in your browser and sent only to your own endpoint.

## The review tab

- **Approximate preview.** A best-effort render that fills in default values, loops list items a few times, and shows icon placeholders. It is not pixel-exact and it is labelled as such. The real proof is dropping the widget into Duda.
- **Content inputs / Design inputs.** The exact inputs to create in Widget Builder, in order, with variables, defaults and list sub-inputs spelled out.
- **HTML / CSS blocks.** Copy each into the matching Widget Builder field.
- **Copy full build sheet.** One click gives you the whole thing as Markdown, same shape as a written build sheet, handy for pasting into notes or handing to someone else to build.

## What's deliberately not here yet

- The build sheet is pasted into Duda by hand, once per component. Auto-install depends on whether Duda's Partner API allows programmatic widget creation, which is still an open question on the project.
- Source JavaScript behaviour is not reconstructed. Anything interactive is listed in the review tab's Notes for us to rebuild deliberately, restyled, rather than copied.
- Hover/focus states and `@media` rules aren't captured at the source. The emit step rebuilds a clean responsive layout to our tokens instead.

## Files

| File | Role |
|------|------|
| `manifest.json` | MV3 manifest (v0.2) |
| `background.js` | On-demand injection + opens the review tab |
| `capture.js` | Capture engine (unchanged from v0.1) |
| `content.js` | Selector overlay, capture bar, authenticated send |
| `overlay.css` | Scoped overlay styles (unchanged) |
| `popup.html` / `popup.js` | Activate + endpoint and secret config |
| `review.html` / `review.css` / `review.js` | The build-sheet review screen |
