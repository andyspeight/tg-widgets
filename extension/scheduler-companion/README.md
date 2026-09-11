# Travelgenix Scheduler — the browser extension

The Calendly-style drawer for the Appointment Scheduler widget. One click on
the toolbar icon opens a side panel on any page.

This is the ONE scheduler extension. A second, earlier one lived at
`chrome-extension/` ("Travelgenix — Send Time Options") and was retired on
11 Sep 2026: everything it did is here or in the hosted share page this panel
embeds, and it asked for far wider permissions (`scripting` + `activeTab`) to
do it. See the note at the end for the one thing that went with it.

## What the panel does

**Whose schedulers.** Yours, not the agency's. The panel used to ask for the
client's whole widget list and merge your own on top, so two people working in
one agency account each saw the other's meeting types on the first screen this
panel opens. Reported three times as "it is showing my meetings" (11 Sep 2026),
and it was the Meetings tab, never the diary. The panel now asks for
`?scope=self`, AND the server recognises this extension by its `Sec-Fetch-Site`
header and scopes to the caller either way, so a copy installed before 0.5.4 is
fixed too.

Chrome sends no `Origin` and no `Referer` for an extension's fetch to a host it
holds permission for. That was verified in Chromium rather than assumed, which
is why the header rule uses `Sec-Fetch-Site: none` with `Sec-Fetch-Dest: empty`:
the browser sets both, and page script cannot forge them.

**Meetings tab.** One card per meeting type across all your schedulers, each
showing its name, its length and which scheduler it belongs to. Per card:

- **Copy link** puts that meeting's standing booking page on the clipboard,
  ready to paste into an email.
- **Share times** opens the pick-specific-slots flow (the hosted
  `/appointment-share` page, embedded), where you tick the times that suit,
  edit the intro and closing lines, and get a snippet in which every time is a
  one-click booking link.
- **Open booking page** opens that booking page in a tab.

A search box appears once you have more than four meeting types.

**Coming up tab.** Your next two weeks at a glance, with a link through to
`/bookings` to reschedule or cancel.

It is YOUR appointments, and only yours. Two separate faults were reported as
one on 11 Sep 2026 and both are fixed server-side, so the behaviour is the same
whichever build of this extension someone has installed:

- **Whose.** A calendar connection was held once per client, so a second admin
  on an agency account was shown the first one's calendar. Connections are now
  keyed to a person. See the ownership table in `CALENDAR-OAUTH.md`.
- **What.** The diary returned every event in that calendar, so a private
  commitment, or a meeting a colleague had invited you to, was listed in a
  booking tool. `/api/appointment/agenda` now returns only the events that ARE
  your Travelgenix bookings, matched on the provider event id recorded when
  each was made. `?scope=all` still returns the lot.

Your calendar is still read, and that has not changed: it is what keeps the
times you offer clear of your real commitments, in
`/api/appointment/availability`. It was never a reason to list them here.

**Header.** Refresh, a link to your meetings, and a link to the dashboard. The
signed-in account is shown underneath. Staff acting as a client get a standing
warning strip, because the schedulers listed then belong to that client and not
to them.

## Gmail compose button

Inside Gmail, a teal calendar button appears beside **Send** in every compose
window. It opens a popover with your meeting types: **Link** drops the booking
page in at your cursor as a tidy hyperlink; **Times** opens the slot picker
right there and inserts the composed snippet at your cursor, with no
copy-paste. The caret position is preserved throughout (the button never steals
focus). Only two Gmail landmarks are relied on (the message body and the Send
button); if Google ever shifts them, the button quietly does not appear and
Gmail is unaffected.

## How it works

A deliberately thin shell (Manifest V3, Chrome 114+). The panel talks straight
to the widget-suite APIs on `widgets.travelify.io` using the user's existing
dashboard session: the `tg_session` cookie is issued for `.travelify.io`, and
the extension's host permissions let panel fetches carry it.

The Gmail content script cannot use that cookie itself (it fetches as
mail.google.com, so a SameSite=Lax cookie never travels), so `background.js`
proxies its reads. That bridge is read-only and whitelisted to three paths:
`/api/widget-list`, `/api/appointment/list` and `/api/widget-config?id=…`.

The share-times flow is the hosted `/appointment-share` page embedded in the
panel, so improvements to it ship from Vercel with no store re-review.

Nothing is stored inside the extension. There is no analytics, no tracking and
no third-party service.

## Try it locally (Chrome or Edge)

1. Open `chrome://extensions` (or `edge://extensions`).
2. Turn on **Developer mode** (top right).
3. **Load unpacked** → choose this folder (`extension/scheduler-companion`).
4. Pin the icon, click it, sign in to the dashboard if prompted.

## Publish to the Chrome Web Store

Run `npm run extension:package` from the repo root. It writes a store-ready zip
to `build/scheduler-companion-<version>.zip` with `manifest.json` at the root
and the README and dotfiles excluded.

Everything the listing asks for — the descriptions, the single purpose
statement, the justification for each permission, the data disclosures and the
privacy policy URL — is written out ready to paste in `STORE-LISTING.md` next
to this file. The privacy policy itself is hosted at
`https://widgets.travelify.io/extension-privacy` (source:
`public/extension-privacy.html`).

Upload at https://chrome.google.com/webstore/devconsole. There is a one-off $5
developer fee. The same package works for Edge's store.

## Version bumps

Only changes to files in this folder need a store re-submission. Changes to the
hosted pages and APIs it uses (booking page, share-times flow, widget list) ship
instantly via Vercel. Bump `version` in `manifest.json` for each submission.

## What was lost with the retired extension

The old one could insert its composed times into ANY focused editable field, so
it worked in Outlook web and CRMs as well as Gmail. It did that with the
`scripting` and `activeTab` permissions, which reach every page you visit.

This one inserts inline in Gmail only. Everywhere else it is Copy, then paste,
which loses nothing from the message itself. That trade was taken deliberately:
a side panel asking for `sidePanel` and two named hosts is a far narrower ask of
the person installing it, and a far shorter store review, than one asking to run
code on every site. If Outlook web insertion is ever wanted back, add a content
script scoped to `outlook.office.com` and reuse `gmail.js`'s approach rather
than reaching for `activeTab` again.
