# Send Time Options — Chrome extension

A toolbar extension that brings the Appointment "send time options" flow into
your browser, Calendly-style: open it while composing an email, pick available
times from your scheduler, and drop bookable links straight into the message.
Each link lets the client confirm that exact slot; the others stay free.

It is a thin front-end over the live appointment endpoints — it reads real
availability (your connected calendar's busy time already subtracted) and the
links point at the hosted `/book-appointment` confirm page. No separate backend.

## Install (unpacked, for testing / internal use)

1. Go to `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this `chrome-extension/` folder.
4. Pin the extension (puzzle icon → pin) so it sits in the toolbar.

## Set up (once)

1. Click the extension icon → **Open settings** (or right-click → Options).
2. **Scheduler ID** — paste your Appointment scheduler's ID. The easiest way:
   open that scheduler in the editor and copy the whole URL
   (`https://widgets.travelify.io/editor-appointment?id=...`) into the box; the
   ID is pulled out automatically.
3. **Widgets address** — leave as `https://widgets.travelify.io` unless your
   widgets are hosted elsewhere.
4. **Save**.

## Use

1. Open a reply/compose window in Gmail, Outlook web, your CRM, etc., and click
   into the message body.
2. Click the extension icon. It lists your available times for the next two
   weeks, grouped by day. A pill shows whether your calendar is synced.
3. Tick the times you want to offer (up to 12). Tweak the intro/closing lines.
4. **Insert into email** drops the formatted, clickable times at your cursor.
   If it can't find an editable field it falls back to copying, and
   **Copy** always puts the block on your clipboard (rich + plain text) to
   paste anywhere.
5. The client clicks a time → confirms on the booking page → it books that slot
   and triggers the usual confirmation + reminders.

## Notes

- Availability and the booking links are public (they only need the scheduler
  ID), so the extension does not require a login.
- "Insert into email" uses the page's active editable element. It works well in
  Gmail and most rich editors; if a site blocks it, use **Copy** and paste.
- Icons are simple placeholders — swap `icons/16|48|128.png` for branded ones
  before any wider distribution.
- To publish on the Chrome Web Store, zip the contents of this folder (not the
  folder itself) and upload; update `version` in `manifest.json` each release.
