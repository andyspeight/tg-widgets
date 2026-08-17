# TG Slicer

Point at any component on any live website, capture it clean, and send it to
Travelgenix Sites, where it becomes an editable, on-brand section. An internal
accelerator, not a product to sell.

The slicer captures; the CMS rebuilds. There is no emit step in the extension and
nothing to configure: capture a section, hit Send to Travelgenix Sites, and it
turns up in the editor's Import tab for a one-click add.

## The flow

1. Click the toolbar icon, hit **Start slicing this page**.
2. Hover a component. **↑** widens to the parent, **↓** narrows to a child. Click
   to lock, then press **C** (or the **Capture** button).
3. Hit **Send to Travelgenix Sites**. The section goes into the extension's
   outbox. With a Sites editor open it appears in the **Import** tab straight
   away, and adds with one click. No copy-paste, no network.
4. **Copy HTML+CSS** and **Copy slice JSON** stay on the bar as fallbacks, for a
   hand paste or when the editor is not open.

Once in the editor the CMS import turns the capture into content: native blocks
where it recognises the shape, an AI-laid-out set of blocks for unusual markup
(your exact words, nothing invented) or a frozen but editable imported section
for anything else. See `SITES-HANDOFF.md` for the handoff mechanics.

## Setup

Load unpacked: `chrome://extensions` → Developer mode → Load unpacked → pick this
folder. That is it. There is no endpoint or secret to set.

## Deliberate limits (rebuilt by the CMS, not faults)

- Hover and focus states and `@media` rules are not captured. The CMS rebuilds a
  clean responsive layout to the site's tokens.
- Repeated cards are captured as they stand; grouping them into one editable list
  is the CMS import's job.
- Anything painted by JavaScript (a WebGL shader, a JS counter) cannot be lifted
  as CSS. A WebGL hero captures blank.

## Files

| File | Role |
|------|------|
| `manifest.json` | MV3 manifest |
| `background.js` | Injects the capture engine and overlay on demand |
| `capture.js` | Capture engine: snapshot, scope, absolutise, inline sprites |
| `content.js` | Selector overlay, capture bar, Send to Travelgenix Sites |
| `bridge.js` | Runs on the Sites editor domains, carries a capture to the Import tab |
| `overlay.css` | Scoped overlay styles |
| `popup.html` / `popup.js` | The Start button |
| `SITES-HANDOFF.md` | How the capture reaches the Sites editor |
