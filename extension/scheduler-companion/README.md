# Travelgenix Scheduler — browser extension

The Calendly-style drawer for the Appointment Scheduler widget. One click on
the toolbar icon opens a side panel on any page with:

- **Your schedulers** — one card each, with **Copy link** (puts the
  scheduler's standing booking page on the clipboard, ready to paste into an
  email) and **Share times** (the pick-specific-slots flow, composing an email
  snippet where every time is a one-click booking link).
- **Coming up** — the next two weeks of booked appointments at a glance.

## Gmail compose button (v0.2.0)

Inside Gmail, a teal calendar button appears beside **Send** in every compose
window. It opens a popover with your schedulers: **Link** drops the booking
page in at your cursor as a tidy hyperlink; **Times** opens the slot picker
right there and inserts the composed snippet at your cursor — no copy-paste.
The caret position is preserved throughout (the button never steals focus).
Only two Gmail landmarks are relied on (the message body and the Send
button); if Google ever shifts them, the button quietly doesn't appear and
Gmail is unaffected.

## How it works

The extension is a deliberately thin shell (Manifest V3, Chrome 114+). The
panel talks straight to the widget-suite APIs on widgets.travelify.io using
the user's existing dashboard session — the `tg_session` cookie is issued for
`.travelify.io`, and the extension's host permissions let panel fetches carry
it. The share-times flow is the hosted `/appointment-share` page embedded in
the panel, so improvements to it ship from Vercel with no store re-review.
Nothing is stored inside the extension.

## Try it locally (Chrome or Edge)

1. Open `chrome://extensions` (or `edge://extensions`).
2. Turn on **Developer mode** (top right).
3. **Load unpacked** → choose this folder (`extension/scheduler-companion`).
4. Pin the icon, click it, sign in to the dashboard if prompted.

## Publish to the Chrome Web Store

1. Zip this folder's CONTENTS (manifest.json at the zip root):
   `cd extension/scheduler-companion && zip -r ../scheduler-companion.zip . -x "*.DS_Store" "README.md"`
2. Upload at https://chrome.google.com/webstore/devconsole (one-off $5
   developer fee). The same package works for Edge's store.
3. Listing needs: 128px icon (in `icons/`), at least one 1280×800 screenshot
   of the open panel, a short description, and a privacy statement — honest
   one-liner: "The extension stores no data; it displays your Travelgenix
   account's schedulers using your existing travelify.io session."

## Version bumps

Only changes to files in this folder need a store re-submission. Changes to
the hosted pages and APIs it uses (booking page, share-times flow, widget
list) ship instantly via Vercel.
