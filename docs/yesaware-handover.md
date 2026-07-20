# YesAware — research and build plan

Founding handover for **YesAware**, a personal Yesware-style email tracking and
templates tool for Andy inside Gmail. Read it together with the repo-wide
conventions in `CLAUDE.md`.

- **Date started:** 20 July 2026
- **Owner / only user:** Andy Speight. This is a personal tool, not a client
  product and not a widget in the suite. It reuses the widget-suite backend and
  extension patterns but it is for one inbox only.
- **Airtable project record:** base `appj9tksreHOwkhYg`, table
  `tblpyhPNhiQg3XkkT`, record `rec4Akjuxd3Sl344h`. Keep it current per the
  project-handover rule.

## The one-line answer

You do not need to build much. You already ship the two hardest pieces (an
open-tracking pixel and a click-tracking redirect), a production event sink, a
realtime channel and, crucially, a working Gmail compose extension. YesAware is
mostly assembly and generalisation, not a new build. The honest catch is that
in 2026 open tracking is a weak, polluted signal, so the tool should be built
around click intent and templates, with opens treated as a soft hint.

---

## 1. What Yesware actually is

Yesware is a sales-engagement layer that lives inside Gmail and Outlook. Its
features, ranked by how much people actually rely on them:

1. **Open tracking** — know when (and how often) a sent email is opened.
2. **Link and attachment tracking** — know when a link or attached document is
   clicked or viewed. This is the strongest signal of the lot.
3. **Templates** — save reusable email bodies, insert them into a compose window
   in one click, track which template performs.
4. **Send later / scheduling** — write now, deliver at a chosen time.
5. **Reminders and follow-ups** — nudge me if no reply by date X.
6. **Meeting scheduler** — share bookable times and a booking link inside the
   email, Calendly style.
7. **Campaigns / sequences / mail merge** — send a personalised email to many
   recipients and chase non-responders automatically.
8. **Reporting** — engagement dashboards across everything above.
9. **CRM sync** — push activity into Salesforce. Not relevant to a personal tool.

For a personal tool the useful core is a much shorter list: **open tracking,
click tracking, templates, a live "opened just now" feed and the meeting
scheduler**. Sequences, mail merge and CRM sync are the enterprise tail and can
wait or be skipped.

---

## 2. The market, so we build the right thing

The field splits cleanly in two.

**Simple open-tracking tools** (do one thing, cheap or free):

- **Mailtrack (mailtrack.io), now rebranded Mailsuite** — the closest thing to
  "just open tracking" for Gmail, and the tool most people mean by "a personal
  Mailtrack". Free tier tracks unlimited emails but adds a "Sent with Mailtrack"
  line, the paid tier (indicatively about $5 to $10 a month) removes branding
  and adds link tracking, reminders and simple campaigns. Chrome extension.
  Enormous free installed base, this is the bar an MVP should clear.
- **Boomerang for Gmail** — read receipts plus its real speciality, send later
  and follow-up reminders (it "boomerangs" a message back to your inbox). Free
  tier is limited, paid roughly £5 to £15 a month. Chrome extension.
- **Right Inbox** — send later, reminders, recurring emails, templates, tracking
  and light sequences. Free tier limited, paid roughly £7 to £15 a month.
- **Mailmeteor and YAMM (Yet Another Mail Merge)** — Google Sheets Apps Script
  add-ons for mail merge with open, click and reply tracking. A different shape
  to the extensions (they run as Workspace add-ons, no DOM injection). Free tiers
  cap daily sends, paid from about $10 a month. Worth knowing if send-later or
  mail merge ever matters (Phase 5).
- **Mailtag** — a separate, older Gmail tracker (open and click tracking, "Pings"
  notifications, send later). Appears defunct in 2026. Listed only to avoid
  confusion: "Mailsuite" is the rebranded Mailtrack above, it is not Mailtag.

**Full sales-engagement platforms** (tracking is one feature among many):

- **Yesware** — the reference. Chrome extension plus Outlook add-in. It no
  longer has a permanent free plan (the old free-forever tier was discontinued),
  only a 14-day trial. Pro is about $15 a month (verified), Premium about $35,
  Enterprise about $65, all per seat billed annually. Now owned by Vendasta.
- **HubSpot Sales Hub** — the strongest free option. Free email tracking,
  templates, a meeting scheduler and notifications, wired into the free HubSpot
  CRM. Chrome extension ("HubSpot Sales"). Paid tiers climb steeply but the free
  tier alone replicates much of Yesware's personal-use value.
- **Mixmax** — sequences, tracking, templates, one-click meeting scheduling,
  send later, polls. Chrome extension. Free tier, paid roughly £25 to £65 a
  month per seat.
- **Streak** — a CRM built inside Gmail (pipelines) with tracking, mail merge,
  snippets and send later layered on. Free tier, paid roughly £15 to £60 a month.
  Notable because Streak built **InboxSDK**, the open-source library most Gmail
  extensions use (see section 6).
- **GMass** — mail merge and cold-email campaigns that send through your own
  Gmail, with tracking and scheduling. Chrome extension. Around £20 to £25 a
  month. Best in class if bulk sending ever matters.
- **Gmelius** — shared inboxes and team collaboration, plus sequences, templates
  and tracking. Roughly £10 to £30 a month per user.
- **Saleshandy / Snov.io** — cold-outreach suites (email finder, verification,
  sequences). More separate-app than in-Gmail now. Roughly £25 to £40 a month.
- **Cirrus Insight** — Salesforce-in-Gmail with tracking and scheduling. Only
  interesting if you live in Salesforce, which you do not.

Pricing above is indicative for mid-2026 and per seat unless noted. Treat it as
"order of magnitude", not a quote.

### The honest build-versus-buy call

If the only goal were "see opens in Gmail tomorrow for nothing", the rational
answer is **Mailtrack free** or the **HubSpot Sales free tier**, and no build at
all. That is worth saying plainly.

Building your own still makes sense here for reasons specific to you:

- You already own about 70 percent of it (section 5), so the marginal build is
  small.
- No per-seat subscription, no third party sitting in the middle of your inbox
  data, no "Sent with Mailtrack" footer.
- It slots into the Travelgenix stack you already run and can later fold into the
  scheduler extension you already ship, so one Gmail button does tracking,
  templates and booking.
- It is a proving ground. Anything that works well for your inbox could later
  become a real widget-suite feature for clients.

Recommendation: **build**, but start from the free tools as the bar to beat, and
be ruthless about scope (section 9).

---

## What we are building, and where each feature is done best

Scope is locked to the full set (Phases 1 to 5). Here is every feature YesAware
will have and the tool whose version we should model on. "Model on" means copy the
behaviour and feel, not the code, we build it on our own stack.

| Feature | What it does | Model it on | Why that one |
|---|---|---|---|
| Open tracking + live "opened" ping | pixel fires, you get a real-time alert | **Mailtrack** for the one-glance simplicity, **Yesware** for the notification feed | Mailtrack owns simple, Yesware owns the sales-alert feel |
| Click tracking | wrapped links, the real intent signal | **Yesware** | the strongest, most trusted click reporting in the field |
| Attachment / document tracking | know when a sent PDF or deck is opened, and for how long | **Yesware** | this is Yesware's signature feature, nobody does it better |
| Templates + per-template stats | save, insert in one click, see which wins | **HubSpot** (clean templates + performance), **Yesware** | HubSpot's free template experience is the benchmark |
| Send later | write now, deliver at the right hour | **Boomerang** | the category definer for scheduling |
| Reminders / follow-ups | "nudge me if no reply by Friday", auto-bump | **Boomerang** (the original), **Right Inbox** | Boomerang invented this pattern |
| Meeting scheduler | share bookable times + a booking link in the email | **your own appointment scheduler** (already built), **Mixmax** as the external benchmark | you already ship this in Gmail, Mixmax is the best paid version to borrow from |
| Sequences / mail merge | one personalised email to many, auto-chase non-repliers | **GMass** for Gmail-native merge that sends through your own Gmail, **Yesware Campaigns** / **Mixmax** for the drip logic | GMass is best-in-class for sending from your own address at Gmail scale |
| Dashboard / analytics | opens, clicks, per-email and per-template history | **Yesware** reporting, plus the **pixel-tracker-vercel** open-source dashboard as a build reference | one is the feature bar, one is the code shortcut |
| Bot filtering (quiet but essential) | discount Apple and Gmail proxy opens and your own self-opens | **samrathreddy/mail-tracker** open-source | it already implements exactly the filters we need |

The short version: no single tool is the model, we cherry-pick. **Yesware is the
reference for tracking depth, Mailtrack for tracking simplicity, Boomerang for
scheduling and reminders, GMass for mail merge, HubSpot for templates, and your
own widgets already cover the meeting scheduler.** For the plumbing we copy the
approach from three open-source builds: **pixel-tracker-vercel** (pixel, click and
dashboard on your exact Vercel and Upstash stack), **samrathreddy/mail-tracker**
(the Gmail extension, per-recipient tracker and bot filtering) and **InboxSDK**
(the clean Send hook for Phase 4).

---

## 3. The uncomfortable truth about open tracking in 2026

This shapes the whole design, so it goes near the top.

- **Apple Mail Privacy Protection** (on by default since iOS 15, 2021) downloads
  every remote image, including your pixel, the moment a message is delivered,
  through Apple's proxies, whether or not a human ever opens it. Apple Mail is
  roughly half of all email opens, so depending on the recipient mix **half or
  more of your "opens" can be machine prefetches, not people.** Timestamps from
  those are meaningless and the IP is an Apple proxy in the `17.0.0.0/8` range.
- **Gmail's image proxy** (since 2013) fetches every image through Google and
  re-hosts a cached copy. The practical effects: you get **Google's proxy IP,
  never the recipient's**, so city-level geolocation for Gmail opens is
  worthless, the user-agent is a generic `GoogleImageProxy`, and after the first
  fetch Gmail serves its own cache so **repeat opens usually do not reach you.**
  Some Gmail opens also fire on prefetch, seconds after send, so a very fast open
  from a Google IP is suspect.
- **Yahoo and Outlook.com** now proxy images the same way. Classic **Outlook
  desktop** is one of the last places a real open with real IP survives, and only
  if the reader clicks "download images".

**What this means for YesAware:**

1. Treat opens as a **soft, directional hint** ("something engaged"), never as
   proof a person read the email, never for geolocation on Gmail or Apple, and
   never for reliable repeat-open counts.
2. **Clicks are the real currency.** A click is a genuine human browser request
   that proxies do not fake, so it carries the recipient's real IP and device and
   it survives Apple and Gmail. Design the dashboard and any "hot lead" logic
   around clicks first.
3. **Flag likely-automated opens** rather than hiding them: tag opens from Apple
   `17.0.0.0/8` and known Google proxy ranges, and opens within a few seconds of
   send, as "probably a machine". This is exactly what the grown-up tools now do.

---

## 4. Why a Chrome extension, and not a Gmail add-on

Three ways exist to get a pixel and rewritten links into an outgoing Gmail
message. For a single personal user the choice is not close.

- **Chrome extension with a content script (recommended).** It runs in your
  browser as you, hooks the compose window, injects the pixel and rewrites the
  links in the outgoing HTML, and talks only to your own server. Because it
  touches **no Google API, it needs no Google OAuth and no verification at all.**
  You load it unpacked and it just works. This is how Mailtrack, Yesware and
  Streak actually do it, and it is how your own scheduler extension already works.
- **Gmail add-on (Apps Script).** Google-sanctioned and survives Gmail UI
  changes, but it can only **insert** content at compose time, it has no clean
  "rewrite the whole body on send" hook, so link-wrapping is a poor fit. Worse,
  reading or modifying the draft needs sensitive or restricted Gmail scopes.
  Publishing that to anyone drags you into OAuth verification plus a **CASA
  security audit, redone every year**, which for real Gmail restricted scopes has
  been reported at tens of thousands of pounds. Pointless for one user.
- **Gmail API app.** Cleanest for unattended mass mail-merge (you build the MIME
  with the pixel already inside and call `messages.send`), but you lose the normal
  Gmail compose experience and you inherit the same verification regime if ever
  published. Keep this in reserve for a future mail-merge phase only.

The single biggest cost sink in this whole space is Google's OAuth and CASA
verification. **A personal, unpacked Chrome extension sidesteps all of it.** That
is the decisive reason to go this way, and you have already walked this path with
the scheduler.

---

## 5. What you already own (the 70 percent)

This is the reason the build is small. Every row below is code already in this
repo and, in most cases, already deployed.

| YesAware needs | You already have | File |
|---|---|---|
| Open-tracking pixel | 1x1 transparent GIF, no-store headers, fail-open so it never breaks in an inbox | `api/emailsig-pixel.js` |
| Click-tracking redirect | logs the click, 302s to a safe destination, no open-redirect surface | `api/emailsig-click.js` |
| Shared tracking helpers | `TRANSPARENT_GIF`, `safeWidgetId`, `safeHttpUrl`, `clientIp`, `fetchWidgetConfig` | `api/_lib/emailsig.js` |
| Event store and analytics | Supabase `widget_events` with a Redis fallback, "respond first then log", hashed IPs, fail-open, dedupe-friendly | `api/_lib/telemetry.js` |
| A second event pattern to copy | staged "log to stdout now, write rows later" tracker with CORS and rate limiting | `api/share-track.js` |
| Gmail compose integration | Manifest V3 extension that finds the compose body and Send button by stable landmarks, injects a shadow-DOM button, inserts HTML at the caret without stealing focus, refreshes on a coalesced MutationObserver, and carries your session via a service-worker fetch bridge | `extension/scheduler-companion/gmail.js` |
| Meeting scheduler (a Yesware feature) already in Gmail | the appointment scheduler widget plus its "insert booking link / share times" compose button | `api/appointment/*`, `api/_lib/calendar/*`, `extension/scheduler-companion/*` |
| Realtime "opened just now" pings | Ably is already in the stack | used in `api/enquiry/submit.js`, `api/_lib/calendar/mail.js`, `api/widget-ai.js` |
| A dashboard shell | the client dashboard and admin traffic views | `public/index.html`, `api/admin/widget-traffic.js` |

The genuinely new work is narrow:

1. Generalise the pixel and click endpoints from **one id per signature** to
   **one token per email sent**.
2. Add send-time injection to the Gmail extension (auto-insert the pixel and
   rewrite links when a tracked email is sent).
3. A templates store and a template picker in the compose popover (the caret
   insertion it needs already exists in `gmail.js`).
4. A small opens/clicks dashboard, ideally live via Ably.

The `scheduler-companion` extension is not just "a scheduler you do not need to
rebuild". It is the **skeleton of the YesAware extension.** The only thing it
does not yet do is hook the Send action, which is the one new technique.

---

## 6. Recommended architecture

```
Gmail compose (Chrome extension, built on scheduler-companion)
  ├─ "Track this email" toggle + "Insert template" picker in the compose popover
  └─ on send: register the email, append the pixel, rewrite links
                     │
   Vercel serverless functions (generalise the emailsig endpoints)
   ├─ POST /api/track/register   auth'd. Stores {token, subject, recipientHint,
   │                             links[]} and returns the token. Called at send.
   ├─ GET  /api/track/open?t=…   returns the 1x1 GIF, logs the open (async)
   └─ GET  /api/track/click?t=…&u=…  logs the click, 302s to the original URL
                     │
   Store (Airtable)
   ├─ Templates table   (edit by hand)
   ├─ Messages table    (one row per sent email + its tokens)
   └─ Events table      (opens + clicks, written off the hot path, Redis-buffered
                         if volume ever grows)
                     │
   Ably: each open/click publishes to your private channel
                     │
   Dashboard (a new editor-style page or a section of the dashboard)
   └─ subscribes to Ably for a live feed, reads history from Supabase
```

Design rules to carry over from the existing code, they are not optional:

- **The pixel and redirect must never add latency and never throw.** Send the
  response first, then log. Copy the pattern in `telemetry.js` and
  `emailsig-pixel.js` exactly.
- **No-store on the pixel and redirect, and do not let Vercel cache them.** The
  emailsig pixel already sets `no-store, no-cache, must-revalidate, max-age=0`.
  On Vercel you must also **omit any `s-maxage`**, otherwise the CDN caches the
  response and swallows opens. This is the inverse of normal Vercel tuning and is
  easy to get wrong.
- **Opaque tokens only.** Random or an HMAC of the message id. Never put the
  recipient email in the URL, never let tokens be enumerable.
- **The redirect validates its destination.** Only `http(s)`, ideally only hosts
  you recorded at register time. `safeHttpUrl` in `emailsig.js` already does the
  protocol check.
- **`/api/track/register` is authenticated** so nobody but your extension can
  write to your store or forge events. Reuse the dashboard session and the
  service-worker fetch bridge the scheduler extension already uses.
- **Dedupe and tag on read.** Collapse proxy bursts by (token, type, coarse time
  window). Tag Apple `17.0.0.0/8` and Google proxy opens as likely automated. Add
  the filtering the open-source builds all converge on: **self-open detection**
  (the extension spots the pixel in your own thread and tells the server to
  discount it), sender-IP exclusion, and deferring any "opened just now" ping by
  about ten seconds so your own views do not fire it.

### The Gmail send-hook, the one new technique

Two ways to inject at send, presented cheapest first:

- **MVP, button-triggered (reuses `gmail.js` almost verbatim).** The compose
  popover gets a "Track this email" action. On click it appends the pixel to the
  body and rewrites the links that are there, using the existing `insertHtml`
  caret machinery, then you send normally. Cheapest path, zero new libraries.
  Weakness: if you edit links afterwards or forget to click, that email is not
  tracked.
- **Proper, send-time hook.** Intercept the actual send so every tracked email
  gets a fresh pixel and rewritten links automatically. The clean way is
  **InboxSDK**, the open-source library Streak built and Mailtrack uses. You
  register a compose handler and, on its `presending` event, read the HTML, inject
  the pixel, wrap the links and set it back before the message leaves. InboxSDK
  now ships a Manifest V3 build with no remote code loading, so it is compatible.
  The alternative is patching `XMLHttpRequest` in the page context to catch
  Gmail's send request and rewrite the body, which is what InboxSDK does under the
  hood but is fiddly to maintain by hand.

Recommendation: ship the **button-triggered MVP first** because it is nearly free
given `gmail.js`, then upgrade to the **InboxSDK send-hook** once the backend and
dashboard are proven. This honours the house rule of upgrading working code
rather than rebuilding.

### Where to store events

Decision (section 11): **Airtable for everything** — a Templates table, a Messages
table (one row per sent email and its tokens) and an Events table (opens and
clicks). Andy prefers keeping it in the one place he knows. At personal volume this
is fine. Two rules make it safe: never put Airtable in the image's response path
(log after the pixel is served, exactly as `telemetry.js` already does), and if
volume ever climbs, buffer events through the Upstash Redis that `telemetry.js`
already falls back to, then flush to Airtable in batches (Airtable allows about 5
requests a second). Supabase stays as the escape hatch if the Events table ever
outgrows Airtable, but we are not using it now.

---

## 7. Legal and ethical, build the off-switch in from day one

This matters even for one-to-one B2B email, and it is cheap to get right if done
early and expensive to retrofit.

- The UK ICO treats a **tracking pixel like a cookie under PECR**: it accesses
  information on the recipient's device, so the storage-and-access rule applies
  and it **needs consent**, and that consent cannot be waved away with a
  legitimate-interest argument. Someone emailing you is not consent to be tracked
  when they read your reply.
- **B2B is not exempt.** A named business address like `jane@company.com` is
  personal data and the device-access rule still applies.
- Enforcement is hardening. The Data (Use and Access) Act 2025 gives the ICO
  GDPR-level teeth over PECR, so the historic £500k PECR fine ceiling is rising
  toward UK-GDPR levels.

Realistically the chance of enforcement against a single low-volume sender is
small, but the rules plainly cover this, so build the defensible version:

1. **A per-recipient and global off-switch.** Tracking must be trivially
   toggleable, and off by default is the safest posture for cold contacts.
2. **Prefer click tracking on people who expect to hear from you** over covert
   pixels on strangers. Covertly pixel-tracking cold B2B contacts is the single
   riskiest thing in this build.
3. **Do not keep proxy IPs or fake geo.** Store the source tag, not a pretend
   location. Keep retention short.
4. **Disclose it** in your privacy notice.

---

## 8. Open-source references

You do not need a library for the pixel or redirect, you already have both. But
two open-source projects are near-exact matches for this build and worth reading
before we write a line:

- **anujarkitekt/pixel-tracker-vercel** (JavaScript, Next.js, MIT) — a serverless
  1x1 pixel on **Vercel plus Upstash Redis**, which is your exact stack (your own
  `telemetry.js` already falls back to Upstash Redis). It has `/api/track` (pixel)
  and `/api/click` (302, restricted to http/https to block open redirects),
  per-campaign counters, a webhook per event and a live dashboard. It is candid
  that Apple and Gmail preloading inflate opens and that unique-open dedupe is not
  done yet. This is the closest thing to a working blueprint for Phase 1.
- **samrathreddy/mail-tracker** (JavaScript, Cloudflare Workers) — the closest
  "build your own personal Mailtrack". A Manifest V3 Chrome extension `gmail.js`
  reads the recipients from the compose window, mints a unique tracker id per
  recipient, injects the pixel before send, and adds the exact bot filtering we
  need (flags Apple Mail Privacy Protection, Gmail and Yahoo proxies and Outlook
  SafeLinks), plus self-open detection and a short dedupe window. This is the
  blueprint for Phases 2 and 4, and it confirms the approach in section 6.

Other useful references, not dependencies:

- **InboxSDK** (`github.com/inboxSDK/inboxsdk`) — the reusable library for the
  Gmail send-hook. Built by Streak, used by Mailtrack, Manifest V3 ready. The
  recommended route for the "proper" send-time injection in section 6.
- **listmonk** (Go, ~22k stars) and **postal** (Ruby, ~16k stars) — mature,
  high-quality references for doing open and click tracking at volume.
- **Mautic** (PHP) — heavyweight reference for tracking, segmentation and campaign
  logic if sequences are ever built.
- **MailTrackerBlocker** and **Ugly Email** — tracker *blockers*. Read these to
  see how pixels get detected and blocked, which tells you how to keep yours
  working and how to build the bot filtering.

Your own `emailsig-pixel.js`, `emailsig-click.js` and `telemetry.js` are already
better fitted to this stack than any of the above, so treat these as reading, not
shopping. The clearest signal from the open-source field: at personal volume this
runs essentially free on the infrastructure you already pay for, and **bot
filtering (tagging Apple and proxy opens, self-open detection, a dedupe window) is
not optional if the numbers are to mean anything.**

---

## 9. Phased roadmap

Scope is the main risk, so the phases are deliberately small and each one is
useful on its own.

**Phase 0 — decisions.** Locked, see section 11. The next code step is Phase 1.

**Phase 1 — tracking backend and dashboard (no extension yet).**
Generalise the emailsig endpoints into `/api/track/open`, `/api/track/click` and
`/api/track/register`. Add the Supabase tables. Build a minimal dashboard that
lists sent emails with open and click counts, live via Ably. Prove it by pasting
a tracked pixel and link into a normal email by hand. This delivers real value
with zero Gmail-extension risk.

**Phase 2 — Gmail extension, button-triggered tracking.**
Fork the mechanics of `scheduler-companion/gmail.js` (or add to it). A "Track this
email" button in the compose popover that registers the email and injects the
pixel and links. Now tracking is one click inside Gmail.

**Phase 3 — templates.**
An Airtable Templates table, a "templates" tab in the compose popover, insert at
caret using the existing `insertHtml`. Track which template was used so the
dashboard can show per-template open and click rates.

**Phase 4 — send-time hook (upgrade Phase 2).**
Adopt InboxSDK's `presending` so every tracked email is injected automatically at
send, links rewritten reliably, no forgotten-to-click gap.

**Phase 5 — send later, reminders and sequences (in scope, built last).**
Send later, follow-up reminders ("nudge me if no reply by Friday") and simple
sequences or mail merge. Andy has chosen to include these. They are the enterprise
tail and much larger, so they come last and are effectively their own project.
Send later and reminders are the most useful for a solo user and the cheapest of
the five. Mail merge pulls in the Gmail API and its sending limits (500 a day on
consumer Gmail, 2,000 on Workspace, 1,500 for merges) and needs the send-hook from
Phase 4, so it is genuinely the last thing we build.

**Phase 6 — unify.**
Fold YesAware into the existing scheduler extension so one Travelgenix button in
Gmail does tracking, templates and booking. This is the end state that beats
Yesware for your specific workflow.

---

## 10. Effort and risk

Rough effort, solo, assuming the existing code is reused:

- Phase 1: small. Mostly generalising endpoints you already have plus a modest
  dashboard.
- Phase 2: small to medium. The extension mechanics exist, the send/register glue
  is new.
- Phase 3: small.
- Phase 4: medium. InboxSDK integration and testing across Gmail states.
- Phase 5: large and open-ended. Treat as a separate project.

Risks, honestly:

| Risk | Reality | Mitigation |
|---|---|---|
| Open data is weak | Half of opens are machine prefetches, proxies strip IP | Build around clicks, flag automated opens, do not promise geo |
| Gmail DOM shifts | Google obfuscates and changes the DOM | Rely only on stable landmarks as `gmail.js` already does, or use InboxSDK, fail silently |
| Vercel caches the pixel | CDN would swallow opens | No-store and no `s-maxage`, verify with a real send |
| Legal (PECR) | Pixels need consent, B2B included | Off-switch, disclosure, prefer clicks, short retention |
| Deliverability | Rewritten links can look like phishing | Branded tracking subdomain with SPF, DKIM and DMARC, single 302 hop, do not wrap links in cold outreach |
| Scope creep | Sequences and mail merge are a different size of project | In scope but built last as their own mini-project, ship Phases 1 to 4 first |

---

## 11. Decisions locked (20 July 2026)

1. **Scope: all phases, 1 to 5.** Tracking, templates and dashboard, then send
   later, reminders and sequences/mail merge. Phase 5 is still built last but it
   is in.
2. **Event store: Airtable.** Keep it in the one place Andy knows well. At personal
   volume (tens of emails a day) Airtable is fine. The only watch-out is Airtable's
   roughly 5 requests a second limit, so events are written off the hot path and,
   if volume ever grows, buffered through the Upstash Redis that `telemetry.js`
   already uses. Templates and the message registry live in Airtable too.
3. **Send injection: start button-triggered, graduate to the InboxSDK send-hook.**
   Explained just below. The MVP (Phase 2) uses the button so we prove the backend
   fast, then Phase 4 switches to the automatic send-hook, which sequences
   (Phase 5) need anyway.
4. **Extension: separate.** Build YesAware as its own extension first, keep it
   apart from the scheduler. Phase 6 can still fold them into one button later.
5. **Tracking domain: reuse `widgets.travelify.io` (the simpler option).** The
   pixel and redirect endpoints already serve from there, so there is zero DNS or
   auth setup. If deliverability ever needs it (really only once mail merge is in
   use), we add a branded `trk.travelify.io` then.

### Button-triggered vs the send-hook (decision 3, explained)

The difference is *when and how* the pixel and tracked links get into the email.

- **Button-triggered (the MVP).** You write the email, then click a "Track this
  email" button. At that moment the extension drops the pixel in and rewrites the
  links that are there, then you press Gmail's normal Send. Simple, reuses the
  scheduler extension's existing insert-at-cursor code almost as-is, no third-party
  library. Weakness: it is manual (you have to remember to click) and it is a
  snapshot, so a link you add *after* clicking is not tracked, and giving each
  recipient their own pixel is awkward.
- **Send-hook (the proper version, via InboxSDK).** The extension intercepts the
  Send action itself. The instant you hit Send it injects a fresh pixel and
  rewrites every link automatically, then lets the message go. A simple on/off
  toggle is all you touch. This is how Mailtrack, Yesware and Streak actually work,
  it never misses anything and it handles per-recipient pixels cleanly. Cost: it
  leans on InboxSDK (a solid open-source library from Streak) and hooking Send is
  more to test across Gmail's compose, reply and pop-out states.

We start with the button because it proves the whole pipeline for almost no
effort, then move to the send-hook before sequences, because automatic per-send
injection is exactly what mail merge relies on.

---

## Sources

Market and pricing figures are indicative for mid-2026 and should be re-checked
before quoting. Key technical sources behind sections 3, 4 and 7:

- Gmail image proxy: Litmus, "Gmail adds image caching"; Suped, Gmail image proxy
  notes.
- Apple Mail Privacy Protection: Apple's MPP privacy page; Postmark and Litmus on
  identifying MPP opens; Litmus 2025 client share (~49% Apple Mail).
- Gmail add-on compose limits and OAuth/CASA verification: Google Workspace
  add-ons "extending compose UI" docs; Google restricted-scope verification and
  CASA docs.
- InboxSDK Manifest V3: `github.com/inboxSDK/inboxsdk`.
- UK PECR and pixels: ICO direct-marketing and cookies guidance; Data (Use and
  Access) Act 2025.
- Gmail sending limits: Google Workspace sending limits documentation.
