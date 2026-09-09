# Show Lead Scanner: handover

Living doc for the staff app that captures people met at trade shows, files them
into Luna Desk, mirrors them to a Google Sheet and sends the first follow-up.
Airtable project record: "Show Lead Scanner", `recBhuqwABacT7fg3`, in the Projects table
(base `appj9tksreHOwkhYg`, table `tblpyhPNhiQg3XkkT`). Read that record first
in any session that resumes this project, and update it at the end.

Started 8 Sep 2026 (Claude Code on the web, session on branch
`claude/staff-show-pwa-card-scan-yng47h`). This first session was research and
scoping only. No product code has been written yet.

A third session on 9 Sep 2026 (Claude Code on the web, same branch) finished
the VoxBulk research with the site fully readable. The decision is final and
sits under "Third pass" in the VoxBulk section below.

## What Andy asked for (8 Sep 2026)

"A PWA app for all of our staff attending a show, that scans business cards,
etc., and adds the details directly into our B2B CRM, populates a Google Sheet,
and contacts the person directly." Andy also asked for VoxBulk (voxbulk.com) to
be researched as a possible messaging provider, excluding its AI dialling.

## Decisions locked (Andy, 8 Sep 2026)

1. **The CRM is Luna Desk**, repo `andyspeight/tg-crm-b2b`, live at
   `https://tg-crm-b2b.vercel.app`. Not Luna Work (the travel-agent CRM at
   crm.travelify.io) and not Monday, which Luna Desk is replacing.
2. **The shows are WTM London and the TravelTech Show.** WTM London runs
   3 to 5 Nov 2026 at ExCeL. The next TravelTech Show is 23 to 24 June 2027 at
   ExCeL, co-located with Business Travel Show Europe and The Meetings Show.
   WTM is eight weeks away, so it sets the Phase 1 deadline.
3. **Follow-up is email first, sent by the person who met them.** WhatsApp only
   when the contact said yes on the spot and the app recorded that.
4. Andy will pick this doc up in the desktop Claude session, which has web
   access, to finish the VoxBulk research and anything else listed under
   "Research still to do". (The VoxBulk part was done on 9 Sep 2026 from
   Claude Code on the web instead, because the network was open on that run.
   The other open items still need the desktop session or an account login.)

## Recommendation: build it inside Luna Desk, not as a separate PWA

The first-pass thinking assumed a standalone PWA in tg-widgets pushing into a
CRM over an API. Once "Tg-CRM-b2b" turned out to be Luna Desk, that stopped
being the right shape. Luna Desk already has almost everything the app needs
around the scan itself:

- **Mobile-first by design.** Its brief says "open it on a phone, know exactly
  what to do next in 10 seconds". A `/scan` screen belongs there.
- **Contacts, Companies, Deals and Activities already exist** in Airtable base
  `appPivSWEnuM2lAhi` (IDs in `docs/airtable-ids.md` of that repo). Deals
  already have an `Event` source. Contacts already carry `Marketing Opt-In`
  (Opted In / Opted Out / Unknown), `Source` and `Notes`.
- **Quick-add exists.** `POST /api/quick-add` calls `quickAddPerson()` in
  `src/lib/crm/data.ts` and creates the person plus their company in one go.
  `POST /api/contacts` also runs `ensureLeadDealForContact()`, so a new lead
  drops straight into the pipeline.
- **Sending as a real person exists.** `POST /api/email/send-template` sends
  through the connected Gmail account, appends the signature, adds open and
  click tracking, logs an Activity and can start a drip sequence
  (`startDripAfterSend` in `src/lib/email/sequence-engine.ts`). The sequence
  engine stops automatically when the contact replies. That is the follow-up
  machine, already built.
- **AI drafting exists.** `POST /api/ai/outreach` drafts a personalised email
  in Travelgenix voice from the company, contact and recent activity.
- **Duplicate detection exists**, post hoc: `listDuplicateGroups()` and the
  merge tooling under `/api/cleanup`.
- **Anthropic SDK is already a dependency**, with prompts organised one module
  per feature under `src/lib/ai/`.

Building the scanner in tg-widgets instead would mean a new HMAC ingest
endpoint in Luna Desk, a second copy of the contact rules, and two logins for
staff. The only things tg-widgets has that Luna Desk lacks are the
vision-endpoint security pattern, the Google Sheets writer and the base64 image
transport, and all three port across as single files.

**Luna Desk is a Next.js App Router app, which can be installed as a PWA** with
an `app/manifest.ts`, a small hand-written service worker in `public/`, icons
and the Apple meta tags. Nothing about "PWA" requires a separate codebase.

Andy has not yet said yes or no to this placement. It is the first question
for the next session.

## The flow (four screens, nothing auto-sends)

1. **Scan.** Camera opens rear-facing. First try the browser's
   `BarcodeDetector` for a QR vCard or LinkedIn QR on the card, which is free,
   offline and exact. Otherwise take the photo, downscale on the device to
   about 1600px on the long edge and JPEG quality 0.8, then post base64 JSON
   to the new card-reading route. Fallback for iOS camera bugs: a plain
   `<input type="file" accept="image/*" capture="environment">`.
2. **Review.** Editable fields: name, role, company, email, phone, LinkedIn,
   website. Each field carries a confidence from the model and low-confidence
   ones are highlighted. Plus: which show (WTM 2026 or TravelTech 2027), who
   met them (a staff picker until SSO gives Luna Desk per-user identity), a
   one-line note ("wants the widget suite for 12 homeworkers"), a consent line
   for email follow-up, and a separate "said yes to WhatsApp" toggle that
   stores the time, the show and who asked. The app checks for an existing
   contact by email and phone before saving and shows "already in Luna Desk"
   with the match, so a second scan of the same person adds an Activity to the
   existing record rather than a duplicate.
3. **Send.** The AI draft is shown with the staff member's name and the note
   folded in. They read it, edit if they like, and tap Send. Email goes via the
   Gmail route and lands as an Activity. If the WhatsApp toggle is on, the
   approved template goes via Brevo (see compliance below). Nothing is sent
   from a raw scan without a human tapping Send.
4. **Done.** Contact, Company, Deal (source Event, stage New Lead) and Activity
   ("Met at WTM London 2026, scanned by X") written to Luna Desk. A row
   appended to the show's Google Sheet. Back to Scan in one tap.

If the venue wifi drops, the scan and review still work. The save and send sit
in an IndexedDB outbox and drain when the app next comes to the foreground.
iOS has no Background Sync, so "drain on next open" is the only option there.

## What is new (the build list)

In `tg-crm-b2b`:

- `src/app/(app)/scan/page.tsx` and the four screens above, mobile-first.
- `src/app/api/scan/route.ts`: the card-reading endpoint. Port the security
  story from tg-widgets `api/screenshot-to-code.js`: auth already covered by
  `src/middleware.ts`, per-IP rate limit via `src/lib/ratelimit.ts`, media
  allowlist (jpeg, png, webp, heic converted client-side), decoded size cap
  around 3.5MB, the image passed as explicitly labelled untrusted data with a
  system prompt that ignores instructions printed on the card. Returns a JSON
  contact with a confidence per field.
- `src/lib/ai/card-scan.ts`: the prompt and schema. Model `claude-sonnet-5`
  by default, overridable by env, Haiku 4.5 as the cheap option.
- A pre-insert lookup by email (lower-cased) and phone (E.164) in
  `src/lib/crm/data.ts`. `findDuplicateGroups` runs after the fact; the scan
  needs the check before it writes.
- `src/lib/sheets.ts`: port of tg-widgets `api/_lib/destinations/google-sheets.js`
  (service-account JWT, header auto-write, `values:append`). Env
  `GOOGLE_SERVICE_ACCOUNT_EMAIL` and `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`,
  same names as tg-widgets. One sheet per show, shared with staff who do not
  live in Luna Desk.
- PWA shell: `src/app/manifest.ts`, `public/sw.js` (precache the scan
  screens, outbox in IndexedDB), icons, `apple-mobile-web-app-capable`,
  `theme-color`. Install instructions on the scan screen for iPhone (Share,
  then Add to Home Screen).
- A "Card Scan" value in `ACTIVITY_SOURCES` in `src/lib/crm/config.ts`, and a
  show picker list (config, not hard-coded).
- WhatsApp send (Phase 3): a small Brevo client for
  `POST /v3/whatsapp/sendMessage` with a template id, plus the opt-in record
  on the Contact.

Port from `tg-widgets`, do not rewrite:

| Need | tg-widgets source |
|---|---|
| Vision endpoint security pattern | `api/screenshot-to-code.js` (rate limits, allowlist, size cap, untrusted-data framing) |
| Base64 image transport that survives venue firewalls | `api/upload-photo-direct.js` |
| Google Sheets append with service account | `api/_lib/destinations/google-sheets.js`, provisioning in `api/_lib/sheets-provisioning.js` |
| Phone normalisation, UK-first, refuses to guess | `normalisePhone()` in `api/_lib/calendar/sms.js` |

## Compliance shapes the design

Design guidance, not legal advice.

- **WhatsApp needs a recorded opt-in.** Meta requires one for any
  business-initiated message, plus an approved template and business
  verification. Since Meta's 2026 policy change an opt-in collected on any
  channel counts, but a business card handed over is not one. Hence the
  separate toggle, the stored time and asker, and templates only.
- **Email and SMS to limited companies** are allowed under PECR without
  consent. Sole traders and partnerships count as individuals and need
  consent. UK GDPR still needs a lawful basis, normally legitimate interest for
  B2B, and a privacy notice at the point of collection. So: one consent line on
  the review screen, privacy link and unsubscribe in the first email, and the
  Contact's `Marketing Opt-In` set from what was actually said.
- **WhatsApp cost is not the issue, the plan and the template are.** Meta
  bills per delivered template message since 1 July 2025. A "good to meet you
  at WTM" first message counts as a marketing template. The UK marketing base
  rate was about 4p early in 2026 and rose on 1 July 2026 to roughly 6 US
  cents before the provider's markup. Two hundred contacts from a show is a
  few pounds. Brevo sells WhatsApp as pay-as-you-go credits with no setup fee,
  but only on its Professional or Enterprise plans, and every template needs
  Meta approval first, so the sender, the plan and the template have to be
  sorted weeks before the show, not the day before.
- **A human confirms before anything sends.** One "great to meet you, Dave" to
  a Sarah does real damage on a show floor.

## The show organisers' own apps

- **WTM London bundles Lead Manager** (formerly Emperia) with the exhibitor
  package: badge QR scanning, works offline, custom qualifying questions, as
  many logins as needed. Badge QRs only resolve inside their app. Our scanner
  complements it: business cards, people met off-stand, and the follow-up
  automation. Phase 3 imports the Lead Manager export into the same pipeline
  so every WTM lead ends up in Luna Desk.
- **What the WTM Lead Manager export contains** (from RX's own guidance,
  found via search on 8 Sep 2026): per scanned badge, the name, company, job
  title, email, phone number(s) and company address the visitor gave at
  registration, plus your notes and the answers to your custom qualifying
  questions. Leads download as CSV or XLSX from the Lead Manager tile in the
  Exhibitor Portal, arrive by email at the end of each show day, and stay
  available for 20 days after the show. Logins are emailed to the stand's
  portal admin about a week before. So the Phase 3 importer is a CSV mapper
  into `quickAddPerson()` with source Event and a "WTM 2026 badge scan"
  Activity, run within 20 days of the show.
- **TravelTech Show is run by Clarion Events and its official app is
  ExpoPlatform**, the same platform behind the co-located Business Travel Show
  Europe app. Business Travel Show's exhibitor pages describe the platform as
  the place to "arrange meetings, chat with attendees, and collect leads".
  Whether that includes badge scanning on the stand, and what it exports,
  could not be confirmed from outside the exhibitor portal. Ask Clarion when
  the 2027 stand is booked. Either way it exports a spreadsheet, and the same
  CSV importer handles it.

## VoxBulk: what was found and what was not

The site could not be loaded from the Claude Code web session: voxbulk.com,
the Wayback Machine and Companies House were all blocked by the session's
network policy. From search results only:

- VOXBULK LTD is UK company 17096983, registered at 2 Greenacre Close,
  Northolt UB5 4DT. Its person-with-significant-control entry is dated
  17 March 2026, which suggests incorporation around then.
- No reviews, no API documentation and no LinkedIn presence are indexed.

Assessment so far: a months-old outfit in the bulk SMS, WhatsApp and voice
space is almost always reselling an aggregator's routes. The risks are sender
reputation, deliverability, their GDPR processor terms and whether they exist
next year. Every channel they would offer is already reachable through
providers Travelgenix has contracts with: Brevo (transactional SMS at
`POST /v3/transactionalSMS/send`, WhatsApp templates at
`POST /v3/whatsapp/sendMessage`), SendGrid for email in tg-widgets, Gmail for
1:1 email in Luna Desk, and Twilio SMS already wired in tg-widgets. Current
recommendation: not as the foundation for this app. If Andy likes their
pricing for outbound campaigns, that is a separate marketing purchasing
decision.

**Second pass, later on 8 Sep 2026, same sandbox.** The site was still
blocked, and a `site:voxbulk.com` search returns no indexed pages at all, so
there is nothing public to compare. Decision recorded as **no, not as the
foundation**. If Andy wants a like-for-like on campaign pricing, paste the
site's pricing and features text into a chat and it takes ten minutes.

### Third pass, 9 Sep 2026: the site read in full, decision final

**What was read this time.** The network was open on this run, so: the home
page and every page linked from it (Expo, Smart Business Card, WhatsApp
Surveys, Customer Feedback, Recruitment, Pricing, Contact, Demo, Blog, News,
Help, FAQ, Legal, Legal and policies, Terms, Privacy, Cookies, GDPR and the
DPA), the machine-readable feeds the site publishes for crawlers (`llms.txt`,
the live price catalogue at `/frontpage/catalog.json`, the FAQ feed, the help
article feed and the product visibility registry), Companies House for both
company numbers that appear on the site, and the ICO register. There is no
About page, no API page and no developer documentation: `/about`, `/api`,
`/docs`, `/developers` and `/features` all serve the empty app shell.

**The first two passes had the wrong premise.** VoxBulk is not a bulk SMS or
WhatsApp provider and does not sell messaging as a service. There is no SMS
product anywhere on the site, no send API and no API documentation. It is a
five-product SaaS dashboard, UK-built, self-serve, sign in with email or
Google:

- **VoxBulk Expo.** The reverse of our scanner. The visitor scans the
  exhibitor's booth QR on their own phone, answers qualifying questions on
  WhatsApp (any language) or a short English web form, can photograph their
  business card to fill the contact fields, gets the catalogue or price list
  sent back, and lands in VoxBulk's dashboard scored Hot, Warm or Cold by
  deterministic rules. The way out is a CSV or Excel export. One package is
  one booth QR and the booth switches off when the window ends. Live GBP
  prices on 9 Sep 2026: £49 for one day, £99 for three days, £149 for seven.
  WTM is three days, so £99.
- **Smart Business Card.** The same flow as a per-rep digital business card:
  one QR per rep, the prospect scans and chats on WhatsApp or web, card photo
  OCR fills the fields, each rep sees only their own leads and managers see
  everyone's. £4 per rep per month or £38.40 a year, with 15 free preview
  runs before buying a seat.
- **WhatsApp Surveys and AI interviews** on one shared plan (pay as you go,
  Starter £59, Pro £129, Business £249 a month), billed per recipient send.
- **Customer Feedback**, one QR per location, at £25, £99 or £175 a month.
- **Recruitment automation** (CV scoring and AI voice interviews). Out of
  scope for us, as Andy said on 8 Sep.

**How their WhatsApp actually works.** Messages travel over the WhatsApp
Business API on VoxBulk-managed numbers ("or your connected profile where
enabled"). Every conversation is visitor-initiated: the visitor scans and
messages them, never the other way round, and templates need approval on their
side too (their survey help article says "ensure WhatsApp templates are
approved"). There is no way to send our own "good to meet you" message from a
Travelgenix number through VoxBulk, and no email to leads at all. A visitor
messaging VoxBulk's number is an opt-in to that number, not to ours, so it
would not let Brevo send either. Integrations are a HubSpot CRM connector,
booking calendars (Calendly, Google Calendar, Microsoft 365, Cal.com, HubSpot
Meetings, Zoho Bookings) and a Zoho Recruit import. The FAQ mentions "API push
into ATS or HRIS" and the recruitment page says "we connect to anything with a
REST API or webhook", but nothing is documented, and Airtable, Google Sheets,
Zapier and outbound webhooks appear nowhere. Lead data sits in UK and EU data
centres and, by default, is anonymised or deleted after 90 days (call
recordings after 30). Sub-processors are not named.

**The company, corrected.** VOXBULK LTD is company 17096983, incorporated on
17 March 2026 as micro greenia LTD and renamed VoxBulk on 27 May 2026. Sole
director and secretary Nabil Ayache. The Northolt address in the first pass is
his correspondence address; the registered office is 128 City Road, London
EC1V 2NX. Confirmation statement filed 8 Sep 2026, first accounts due
17 Dec 2027. The ICO registration quoted on the site, ZC229415, is genuine:
Voxbulk Ltd, Tier 1, registered 23 Aug 2026, expiring 22 Aug 2027. But the
terms, privacy policy, DPA and legal page all give the company number as
15466735, which Companies House lists as MENASIM LTD (incorporated 5 Feb 2024,
director Qusay Ajez, a telecoms SIC code). So the DPA a customer accepts at
signup names a counterparty that is not VoxBulk Ltd. Whether that is a related
business or a copy-paste error, it would need fixing before anyone at
Travelgenix signed. Terms last updated 25 July 2026. Blog posts run from 3 May
to 9 Sep 2026 and the newsroom has one item (2 July 2026). Still nothing
third-party: no reviews, no LinkedIn page, no press. Their own blog post
comparing QR capture with badge scanning served an empty body on 9 Sep 2026.

**Against what we already have.**

| Need | VoxBulk | Already in hand |
|---|---|---|
| First follow-up by email, from the person who met them | Not offered. No email to leads. | Gmail in Luna Desk: the `send-template` route, signature, tracking, Activity, drip sequence. |
| WhatsApp "good to meet you" after a recorded yes, from our number | Not offered. Inbound only, on their number, no send API. | Brevo WhatsApp: our sender, our approved template, one call from Luna Desk. Needs Professional or Enterprise. |
| SMS | No SMS product. | Brevo transactional SMS. Twilio REST already in tg-widgets (`api/_lib/calendar/sms.js`, dark-launched behind env vars). |
| Business card OCR | Yes, inside their flow. | Building: `api/scan` with Claude vision, a confidence per field. |
| Contact, Company, Deal and Activity in Luna Desk | No. Their dashboard, CSV out, HubSpot connector only. | Direct write through `quickAddPerson()`. |
| Row in the show's Google Sheet | No. Manual CSV export. | Sheets writer ported from tg-widgets. |
| Dedupe before saving | No. | Pre-insert lookup by email and phone. |
| Consent record for WhatsApp | Yes, and well shaped: time, channel, prompt shown, answer, exportable. | Our toggle stores time, show and who asked. |
| Where the lead lives | Their tenant, 90 days, then anonymised. | Luna Desk, for as long as we like. |

**Decision: no, final.** Three reasons.

1. It is not a messaging provider. There is nothing to put against Brevo SMS,
   Brevo WhatsApp, Gmail or Twilio, because VoxBulk does not send email or SMS
   and its WhatsApp is inbound on its own numbers.
2. It is a rival capture flow, not a component. The lead lands in their
   dashboard, comes out as a CSV and is anonymised after 90 days. That is the
   opposite of "straight into Luna Desk".
3. The paperwork is not ready. The DPA and terms name the wrong company, the
   ICO registration is seventeen days old and there is still no third-party
   footprint.

**Two things worth keeping from the read.** First, their consent proof shape
(time, channel, prompt shown, answer) is better than ours. The WhatsApp toggle
should store the prompt text the staff member read out as well as the time,
the show and the asker, and it should export with the Contact. Second, "stand
too busy, scan this" is a sound idea for a visitor who cannot reach a staff
member, and it does not need VoxBulk: a QR on the stand pointing at a Luna Desk
form (or an Enquiry widget routed into Luna Desk) is an afternoon's work and
lands in the same pipeline. Phase 2 candidate.

**Reopen trigger.** None needed for this project. If Andy ever wants a
visitor-led QR at a show without building one, a £99 three-day Expo package
plus the Phase 3 CSV importer would do it, once they have fixed the company
number on the DPA. That is a purchasing call, not an architecture question.

## Phases and dates

| Phase | Scope | Target |
|---|---|---|
| 1 | Scan, review, dedupe check, save to Luna Desk, Sheet row, email via Gmail with the AI draft. Online only. Installable on iPhone. | Working on a real iPhone by 23 Oct 2026, eleven days before WTM |
| 2 | IndexedDB outbox, service worker, install polish, staff picker, real-device testing on the ExCeL floor plan of "no signal" | Before 3 Nov 2026 |
| 3 | WhatsApp template via Brevo behind the consent toggle, Lead Manager export import, per-staff Gmail once SSO lands | After WTM, before TravelTech Show June 2027 |

## Open questions for Andy

1. Confirm the placement: build the scanner inside Luna Desk (recommended) or
   as a separate PWA in tg-widgets that pushes into Luna Desk over a new
   signed endpoint.
2. **Who sends the email.** Luna Desk today has ONE connected Gmail account for
   the whole app (`getAccessToken()` in `src/lib/google/oauth.ts` reads a single
   app-level setting) and a shared password with no per-user identity. So
   "from the person who met them" needs either per-staff Gmail connections,
   which needs SSO first, or an interim: send from one connected account (Andy's
   or a show mailbox such as a dedicated WTM address) with the staff member
   named in the body. Which interim is acceptable for WTM?
3. Are we exhibiting at WTM 2026 with a stand, and therefore getting Lead
   Manager logins? And at TravelTech Show 2027?
4. How many staff are attending, and do they all already log in to Luna Desk?
5. Closed on 9 Sep 2026: VoxBulk is no, final, with the site read in full
   (third pass above). Nothing for Andy to decide. A £99 Expo package would be
   an optional purchase, not something this project needs.

## Research: done and still open

Done on 8 Sep 2026 (second pass, search snippets only, most sites blocked
from the sandbox):

- VoxBulk: no public content reachable or indexed. Decision: no (above).
- WTM Lead Manager export: fields, formats, daily email and the 20-day window
  are recorded above.
- TravelTech Show: organiser Clarion, app ExpoPlatform, lead collection via
  the platform confirmed in general terms, badge scanning on the stand not
  confirmed.
- WhatsApp cost: Meta per-message billing, UK marketing rate and the Brevo
  plan requirement recorded above.

Done on 9 Sep 2026 (third pass, full site read, network open):

- VoxBulk: closed as no, final. It is a QR lead-capture dashboard, not a
  messaging provider; prices, integrations, retention, company records and
  the wrong company number on its DPA are all recorded in the third pass.

Still open, needs a real browser or an account login:

- Which Brevo plan the Travelgenix account is on, and whether it already has
  a WhatsApp sender connected. WhatsApp needs Professional or Enterprise.
- Template approval turnaround with Brevo today, so the "met at WTM" template
  is approved before 3 Nov 2026.
- Clarion: is badge scanning in the TravelTech Show 2027 exhibitor package,
  and what does the ExpoPlatform lead export look like.
- iOS 26 PWA camera behaviour in standalone mode: confirm on a real iPhone
  early, because WebKit has a history of `getUserMedia` failing in
  home-screen apps.

## Things that will bite

- Luna Desk auth is a shared password (`APP_PASSWORD`, cookie
  `luna_desk_session`). Every scan will look the same in the audit trail until
  SSO lands, hence the staff picker.
- Vercel's request body limit is about 4.5MB and base64 adds a third. Downscale
  on the device before upload; do not rely on the server cap alone.
- The Airtable rate limit on the CRM base is 5 requests a second. A busy stand
  with three staff scanning is fine; a bulk import of a Lead Manager export is
  not, so batch it.
- Luna Desk's dedupe is post hoc. Without the pre-insert lookup, two staff
  scanning the same person produces two records and two follow-ups.
- No Background Sync on iOS. Test the "closed the app, reopened it" path on
  device, not in desktop Chrome.

## Files touched (8 Sep 2026)

- `docs/show-lead-scanner-handover.md` (this file, new)
- `CLAUDE.md` (pointer added to the project handovers list)

No changes to `tg-crm-b2b` yet. It was cloned read-only for the survey.

## Files touched (9 Sep 2026)

- `docs/show-lead-scanner-handover.md` (third pass on VoxBulk, open question
  5 closed, research list and sources updated)

Still nothing in `tg-crm-b2b`.

## Sources used in the 8 Sep 2026 research

- WTM London Lead Manager: https://www.wtm.com/london/en-gb/exhibit/lead-manager.html
- WTM London 2026 dates: https://www.wtm.com/portfolio/en-gb/blog/press-releases/wtm-london-2026-registration-open.html
- TravelTech Show: https://traveltech-show.com/ and Business Travel Show Europe 2027: https://www.businesstravelshoweurope.com/
- Companies House, VOXBULK LTD: https://find-and-update.company-information.service.gov.uk/company/17096983/persons-with-significant-control
- Brevo transactional SMS: https://developers.brevo.com/docs/transactional-sms-endpoints
- Brevo WhatsApp messages: https://developers.brevo.com/docs/whatsapp-messages
- ICO, business-to-business marketing: https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/business-to-business-marketing/
- Infobip on WhatsApp opt-in: https://www.infobip.com/docs/whatsapp/compliance/user-opt-ins
- PWA on iOS in 2026: https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide
- STRICH on iOS PWA camera access: https://kb.strich.io/article/29-camera-access-issues-in-ios-pwa
- RX Lead Manager app: https://rxglobal.com/RX-lead-manager-app and the exhibitor guide https://rxglobal.com/sites/default/files/2025-01/How%20to%20use%20Lead%20Manager%20App%20exhibitor%20guide.pdf
- RX Lead Manager legal notice: https://legal.rxglobal.com/en-us/LeadManagerApp.html
- TravelTech Show official app (ExpoPlatform): https://traveltech-show.com/visit/show-app
- Business Travel Show Europe exhibitor page: https://www.businesstravelshoweurope.com/exhibit
- Brevo WhatsApp countries and pricing: https://help.brevo.com/hc/en-us/articles/4416961286674-Supported-countries-and-pricing-for-WhatsApp-messages
- Brevo WhatsApp pricing update, 1 July 2026: https://www.brevo.com/releases/whatsapp-pricing-update/
- Meta WhatsApp Business Platform pricing: https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing
- WhatsApp UK pricing guide 2026: https://payperwa.com/blog/whatsapp-business-api-pricing-uk-2026

## Sources used in the 9 Sep 2026 third pass

- VoxBulk site, read in full on 9 Sep 2026: https://voxbulk.com/ plus
  `/expo`, `/smart-card`, `/surveys`, `/feedback`, `/recruitment`, `/pricing`,
  `/contact`, `/demo`, `/blog`, `/news`, `/help`, `/faq`, `/legal`,
  `/legal-policies`, `/terms`, `/privacy`, `/cookies`, `/gdpr`, `/dpa` and
  `/whatsapp-surveys-vs-email-surveys`
- VoxBulk crawler feeds: https://voxbulk.com/llms.txt,
  https://voxbulk.com/frontpage/catalog.json (live prices),
  https://voxbulk.com/frontpage/faq, https://voxbulk.com/frontpage/help/articles,
  https://voxbulk.com/frontpage/product-visibility, https://voxbulk.com/robots.txt
  and https://voxbulk.com/sitemap.xml
- Companies House, VOXBULK LTD 17096983 (overview, officers, persons with
  significant control, filing history):
  https://find-and-update.company-information.service.gov.uk/company/17096983
- Companies House, MENASIM LTD 15466735 (the number printed on VoxBulk's
  terms, privacy policy, DPA and legal page):
  https://find-and-update.company-information.service.gov.uk/company/15466735
- ICO register of fee payers, Voxbulk Ltd ZC229415:
  https://ico.org.uk/ESDWebPages/Entry/ZC229415
- tg-widgets, for what is already wired: `api/_lib/calendar/sms.js` (Twilio)
  and `api/_lib/destinations/brevo.js` (Brevo contacts upsert)
