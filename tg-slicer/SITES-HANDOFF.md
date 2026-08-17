# TG Slicer → Travelgenix Sites handoff

How a captured section gets from the extension into the Sites editor, and the one
thing to keep current.

## The path

1. In the capture bar, **Send to Travelgenix Sites** writes the raw
   `{ html, css, title, ts }` to `chrome.storage.local` under `tgsOutbox`. The
   outbox is capped at 20 and nothing goes over the network.
2. **bridge.js** is a permanent content script that runs ONLY on the Sites editor
   domains (the `content_scripts.matches` list in `manifest.json`). On the editor
   page it reads the outbox and hands each section to the page with
   `window.postMessage`, and re-sends whenever the outbox changes, so a capture
   made while the editor is open turns up straight away.
3. The editor's **Import tab** (`tg-sites/components/editor/ImportPanel.tsx`)
   lists the waiting sections, adds one on click, and posts back which were used
   so they clear from the outbox and are never offered twice.
4. The CMS import (`tg-sites/lib/import/`, `tg-sites/lib/ai/import-rebuild.ts`)
   turns each capture into content: native blocks, an AI-laid-out set of blocks
   for unusual markup, or a frozen editable imported section.

Trust: the editor treats a handed-over section as nothing more than HTML and CSS.
It goes through the same import a hand paste does, which sanitises it. The bridge
only moves the bytes, it grants no new power.

## The one thing to keep current

The bridge only runs where `content_scripts.matches` says. Today that is
`tg-sites-shell.vercel.app` and its aliases, plus localhost for dev. When the
editor gets its real domain (e.g. `sites.travelgenix.com`), add it to the matches
list in `manifest.json` and reload the extension. It is deliberately NOT the
client preview domain (`*.travelgenixsites.com`), which serves customers' own
sites and never the editor.
