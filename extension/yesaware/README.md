# YesAware — Gmail extension

The in-Gmail half of YesAware (Andy's personal email tracker). It adds a **Track**
button beside Send in every compose window. One click registers a tracker for the
email, rewrites the links to tracked redirects and drops in an invisible open
pixel. Opens and clicks then show up on the dashboard at
`https://widgets.travelify.io/yesaware`.

It is a deliberately thin shell (Manifest V3, Chrome 114+). All the string work
lives in `tracking.js` (pure, unit-tested in `tests/test-yesaware-ext.cjs`); the
backend lives in the widget suite (`/api/track/*`). Nothing is stored in the
extension. Auth rides the existing `.travelify.io` dashboard session: content-
script fetches go through the service worker so the session cookie travels.

## Files

- `manifest.json` — MV3 manifest.
- `tracking.js` — pure transforms (extract links, rewrite hrefs, insert pixel).
- `gmail.js` — content script: the Track button, the Templates picker, and
  auto-track on send (Phases 2 to 4). Auto-track intercepts the Send button and
  Ctrl/Cmd+Enter, registers the tracker, rewrites the body, then sends — failing
  open so your email always goes even if tracking hiccups.
- `background.js` — service-worker fetch bridge (whitelisted paths only).
- `popup.html` / `popup.js` — settings: auto-track toggle, dashboard + templates links.

## Try it locally (Chrome or Edge)

1. Open `chrome://extensions` (or `edge://extensions`).
2. Turn on **Developer mode** (top right).
3. **Load unpacked** and choose this folder (`extension/yesaware`).
4. Sign in to your Travelgenix dashboard, open Gmail, start a new email — the
   Track button appears beside Send.

Icons are intentionally omitted so the folder loads with no binary assets; Chrome
shows a default icon. Drop 16/32/48/128px PNGs in `icons/` and add an `icons`
block to the manifest to brand it.

## How the Track button works

1. Reads the compose subject, recipients and body HTML.
2. Extracts the http(s) links from the body.
3. Calls `POST /api/track/register` (via the service worker, with your session)
   which mints a token, stores the message and returns the pixel plus a signed
   tracked URL per link.
4. Rewrites the body: each link becomes its tracked redirect, and the invisible
   pixel is appended. You then send as normal.

Only two Gmail landmarks are relied on (the message body and the Send button). If
Google shifts them the button simply doesn't appear and Gmail is unaffected.
