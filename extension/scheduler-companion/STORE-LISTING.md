# Chrome Web Store listing — Travelgenix Scheduler

Everything the submission form asks for, written out ready to paste. Work down
it in order. Written 11 Sep 2026 for v0.5.2.

Upload at <https://chrome.google.com/webstore/devconsole>. There is a one-off
$5 developer registration fee, payable once per Google account, not per
extension. The same package and copy work for Microsoft Edge's store.

---

## Before you start

| You need | Where it is |
|---|---|
| The upload package | `build/scheduler-companion-0.5.2.zip`, from `npm run extension:package` |
| The screenshot (1280x800) | `build/store-screenshot-1280x800.png`, from `npm run extension:screenshot` |
| The 128px icon | Already inside the package. The store reads it automatically |
| The privacy policy URL | <https://widgets.travelify.io/extension-privacy> |

Use a Google account that should own this listing for the long term. Moving an
extension between accounts later is possible but tedious, so prefer a shared or
company account over a personal one.

---

## 1. Package

Upload the zip. Everything on this page comes from `manifest.json` and needs no
editing:

- **Name**: Travelgenix Scheduler
- **Version**: 0.5.2

---

## 2. Store listing

**Summary** (132 character limit, this is 128, shown under the name in search):

```
Your appointment schedulers, one click away: copy booking links, share times that suit, and insert them into Gmail as you write.
```

**Description** (paste whole):

```
Travelgenix Scheduler puts your appointment booking links where you actually need them: in the email you are writing.

Open the side panel from any page and you have every meeting type from every one of your Travelgenix schedulers, ready to use.

WHAT YOU CAN DO

• Copy a booking link. One click puts that meeting's booking page on your clipboard, ready to paste.

• Share times that suit. Tick the slots you want to offer, edit the opening and closing lines, and you get a tidy list in which every time is a one-click booking link. Whoever you send it to picks one and it is booked. The rest stay free.

• See what is coming up. Your next two weeks of appointments at a glance, with a link through to reschedule or cancel.

• Write straight into Gmail. A calendar button appears beside Send in every compose window. Drop in a booking link, or pick times and insert them, without leaving the message or losing your place in it.

BUILT FOR TRAVEL AGENTS

This is the companion to the Travelgenix Appointment Scheduler widget. Your availability, your meeting types, your buffers and your connected calendar all come from your Travelgenix account, so the times you offer are genuinely free. Book one and your calendar, your confirmation emails and your reminders all follow as usual.

YOU WILL NEED

A Travelgenix account with at least one Appointment Scheduler. Sign in to the dashboard once and the panel picks up that session.

PRIVACY

The extension stores nothing, sends nothing to anyone else, and shows you only your own account. There is no tracking and no analytics. It does not read your emails. Full policy: https://widgets.travelify.io/extension-privacy
```

**Category**: `Workflow & Planning`

> Travel is the other candidate, but that category is aimed at trip-planning
> tools for travellers. This is a working tool for an agent's day, so Workflow
> & Planning is the better fit and the less competitive shelf.

**Language**: English (United Kingdom)

**Screenshot**: upload `build/store-screenshot-1280x800.png`. One is enough to
publish. If you would rather show your own real schedulers, take a 1280x800
grab of the open panel and use that instead. Nothing in the supplied one is a
real client: the agency, the person and the meeting names are invented.

**Small promo tile (440x280)**: optional. Skip it. It only affects whether you
can be featured, and it is not worth holding up the submission for.

**Support URL**: `https://widgets.travelify.io`

---

## 3. Privacy practices

This is the tab that decides how long the review takes. Every answer below is
true of the code as it stands. Do not soften any of them.

**Single purpose** (paste):

```
A side panel that shows the signed-in Travelgenix user their own appointment schedulers, so they can copy a booking link or offer specific times, and insert either into an email they are writing.
```

**Permission justifications**, one box each:

`sidePanel`

```
The extension's entire interface is the side panel. This permission opens it when the user clicks the toolbar icon. It is not used for anything else.
```

`https://widgets.travelify.io/*` (host permission)

```
This is our own API. The panel reads the signed-in user's own appointment schedulers and their booked appointments from it, using the session cookie the user already has from signing in to our dashboard, and embeds our hosted pick-a-time page. No other site is contacted.
```

`https://id.travelify.io/*` (host permission)

```
The same Travelgenix application served on our dashboard host. Users sign in and manage their account here, and the panel links back to it. The session cookie is issued for this domain.
```

Content script on `https://mail.google.com/*`

```
To place a calendar button beside Gmail's Send button, so a booking link or a set of chosen times can be inserted into the message at the user's cursor. It reads only two things on the page: the message body element, so it knows where to insert, and the Send button, so it knows where to put the button. It does not read, collect or transmit message content, recipients, subjects or contacts.
```

**Are you using remote code?** → **No, I am not using remote code**

> All JavaScript is inside the package. The panel does embed one of our own
> hosted pages in an iframe, which runs in its own origin and not in the
> extension, so it is not remote code in Chrome's sense. If a reviewer queries
> it, that is the answer, and the page is `/appointment-share` on our own
> domain.

**Data usage** — what does your extension collect? → **tick nothing**

> The extension transmits nothing off the device. It receives the user's own
> data from our server and displays it. It has no storage permission, so it
> cannot keep anything either, and you can point a reviewer at the manifest to
> show that. If a reviewer does push back on the account name and email shown
> at the top of the panel, the honest follow-up is that this is the user's own
> identity, fetched from us to label the panel, never stored and never sent
> anywhere.

**The three certifications** — tick all three. All are true:

- I do not sell or transfer user data to third parties, apart from the approved use cases
- I do not use or transfer user data for purposes unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL**:

```
https://widgets.travelify.io/extension-privacy
```

---

## 4. Distribution

**Visibility**: `Unlisted`

> Recommended. Unlisted passes the same review and installs the same way, but
> it does not appear in search or in the category shelves. Anyone with the link
> can install it, which is exactly how your clients will get it, from the
> dashboard. It avoids the reviewer question of what the general public would
> want with an extension only Travelgenix account holders can use. You can
> switch it to Public later from this same page.

**Regions**: all regions.

**Pricing**: free.

---

## After you submit

Review usually takes a few days and can stretch longer when an extension asks
for host permissions, which this one does. Google emails the outcome to the
developer account.

If they come back with a question, it is most likely to be one of these two,
and both answers are above: the iframe of our hosted page, and why the panel
needs to reach two of our hosts rather than one.

Once it is approved you get a Web Store link. Tell me and I will add a panel to
the appointment editor pointing at it, which is the third piece we agreed and
the one that makes it findable. Until then nothing in the product mentions the
extension exists.

## Next time

Bump `version` in `manifest.json`, run `npm run extension:package`, and upload
the new zip to the same listing. Only changes to files in the extension folder
need a resubmission. The hosted pages and APIs it uses ship instantly via
Vercel, which is why the pick-a-time flow lives on our server and not in the
package.
