# WeTravel teardown, and where Travelgenix Trips stands against it

**Deep competitor teardown, 27 Aug 2026.** Companion to
`docs/trips-platform-handover.md`. Lives here, not in the public
`travelgenix-trips` repo, because it is competitive intelligence and roadmap.

## How this was gathered, and how far to trust it

Four parallel research passes over WeTravel's own site
(`product.wetravel.com`, `help.wetravel.com`, `academy.wetravel.com`), its
pricing pages, and the review sites (Capterra, G2, TrustRadius, SoftwareWorld,
TrekkSoft). One caveat that matters: the research environment's proxy blocked
direct page loads of `wetravel.com` subdomains and the store/review pages, so
findings came from search-engine summaries of those pages cross-checked across
at least two sources. It is solid for shape and for most specifics, but **any
figure you are about to quote to a customer, re-verify on the live page first**
— especially fee percentages and plan gating, which WeTravel changes. Items the
research could not pin down are marked *unverified* below and should not be
quoted at all.

---

## 1. WeTravel in one paragraph

A booking-and-payments platform for multi-day and group tour operators, ~5,000+
businesses, **payments-first** (built on Stripe underneath, custodial: it holds
the money then pays the operator out). Three plans: **Basic/Free** ($0/mo,
transaction fees only), **Pro** ($79/mo, adds the itinerary builder,
white-label, lead capture, API and more), **Enterprise** (custom, SSO, migration
team). All plans: unlimited trips, bookings and team members. 60-day trial.

**Fees (re-verify before quoting):** 1% platform fee + card processing 2.9%
(3.9% AMEX), $1.50 minimum per transaction, no surcharge on international cards
or FX, local bank rails (ACH/SEPA/BACS/PAD/BECS) fee-free, wire $25. So the real
price is ~3.9% of everything that moves, and $79/mo is almost incidental. That
is the whole reason Trips exists — section 4 of the handover.

---

## 2. Full feature teardown

### A. Back office and trip operations

- **Itinerary builder** — day-by-day sections, interactive maps, media, show/hide
  dates, PDF/brochure export, templates and one-click duplication, a reusable
  **content library**, and a per-trip **participant questionnaire**.
- **AI in the builder** — an **AI writing assistant** (draft/rewrite content) and
  **Smart Import AI** that turns a PDF (≤32 MB) or a URL into a structured
  itinerary. **This is the important one: WeTravel now has AI brochure import.**
- **Packages, add-ons, pricing** — multiple packages each with own capacity,
  deposit, payment plan and cut-off; add-ons per-participant or per-booking, each
  able to carry its own payment plan.
- **Inventory / rooming (Pro)** — define resources (rooms, seats) with capacities
  and sharing types, connect them to packages so availability is inventory-driven,
  a **Resource List and Resource Calendar** shareable with suppliers, plus
  **rooming/allocation lists** (assign people to rooms/flights/activities, export
  for vendors). Does not hard-block over-capacity but surfaces counts.
- **Manage Trip / participant table** — customisable columns, filters (package,
  status, payment plan, balance due, auto-billing, departure date), **bulk
  actions** (edit prices/plans across many bookings), CSV export, edit/refund/
  cancel one person in a multi-person booking, switch a participant's package,
  **transfer participants between trips**.
- **Forms, waivers, documents, tasks** — custom questionnaire; waivers as a
  checkbox at checkout or a dedicated **eSignature** document (Pro); file/ID
  upload (up to 5 files, 10 MB each); **Participant Tasks** with due dates
  relative to checkout/trip and automated reminders.
- **Waitlist** — auto-appears when a package is sold out or closed, captures
  contact details, organiser invites people in.
- **Reporting** — a **cross-trip Cash Flow dashboard** (filter by trip/currency/
  date, export CSV/XLSX/PNG) and accounting-friendly payment reports.
- **Team, CRM, integrations** — team members with granular permissions and
  multi-account switching (multi-brand); a built-in **Travel CRM** (contacts,
  opportunities pipeline, auto-captured leads, AI-drafted replies — messaging/AI
  is Pro); public **API** + **Zapier** (Mailchimp, Salesforce, HubSpot,
  QuickBooks, Xero, Slack, Google Calendar); **abandoned-cart** recovery email.

### B. Selling, marketing and distribution (including widgets)

- **Hosted trip pages**, public or private (private link for a specific group).
  No consumer marketplace.
- **Embeddable widgets — a full suite, and this is now parity not our edge.**
  From Manage Trip → Promote → Embed: a **Book Now button** whose checkout opens
  as an **iframe overlay on the operator's own page** (exactly the pattern we
  just built), a **Pricing Packages** widget with live availability, a **Trip
  Overview** widget listing all public trips, a **Reviews** widget, and a
  **Download Brochure** button. Button text/colour editable, text-link option.
  Official **WordPress plugin** plus guides for Squarespace/Wix/Weebly.
- **White-label (Pro)** — custom URLs, branded traveller login and dashboard, no
  WeTravel cross-links.
- **Promo/discount codes** — per-trip or account-wide, date- or trip-tied, applied
  per participant. **Early-bird** pricing (dated code or an expiring package).
- **Deposits and payment plans as a selling tool** — "buy now pay later" framing.
- **Lead capture** — email-gated brochure download feeding a **Leads** list (Pro);
  the CRM captures enquiries; one abandoned-cart email.
- **Reviews** — verified (paid-through-WeTravel only), shown on trip/organiser
  pages, up to 12 featured, embeddable.
- **B2B Partner Hub / Marketplace** — operators discover and collaborate with each
  other (not a consumer sales channel).
- **Not found:** consumer **gift cards** (the "WeTravel Card" is an expense Visa,
  unrelated) and any **affiliate/ambassador/referral** commission engine. Treat
  both as things WeTravel does *not* offer.

### C. Payments and money (their moat)

- **Payment plans** — up to **18 instalments** (one source says 24; unverified),
  operator-set amounts/dates, **auto-billing** on a saved card (Pro), missed
  instalments auto-spread.
- **Dunning** — a fixed automated cadence: reminder 7 and 3 days before and on the
  due date, "late notice" 2 days after, retries around days 7/10/12 on failure.
- **Multi-currency** — price in **34 currencies**, hold funds in **19**,
  multi-currency checkout at market rates, local methods per currency (iDEAL,
  Bancontact, SEPA, BACS…).
- **Payouts** — USD next business day, EUR/GBP 2–3 days; instant to debit card at
  1.5%; international wire payout $15. Custodial: WeTravel holds funds, KYC/KYB
  required, may hold funds until ~30 days post-trip.
- **Supplier payments** — free instant transfers to verified partners, in-account
  FX, virtual cards, and a **WeTravel Visa expense card** (up to 10 cards).
- **Refunds/chargebacks** — no refunds after 30 days; card processing fee is not
  returned; operator fully liable for chargebacks.

### D. Communication with bookers and the traveller experience

- **Automated emails** — booking confirmation (optional), payment receipts (to
  both sides), the payment-plan reminders above, participant-task reminders, and
  **post-trip review requests** (2 days after, chased 7 days later). Cadence is
  hard-coded, not editable.
- **Broadcast messaging** — a **Messages** hub: send to everyone on a trip, a
  segment (by package/add-on), specific people, or those with incomplete tasks;
  custom subject/sender/reply-to; **scheduling**. Reviewer gripes: **no reusable
  templates**, and "everyone" includes cancelled participants.
- **No real-time in-app chat**; replies go to the organiser's inbox. The CRM (Pro)
  threads Gmail/Outlook mail per contact.
- **No SMS** — every documented channel is email (inferred from a complete absence
  of SMS docs, not a vendor denial).
- **Traveller area** — sign in at wetravel.com → My Trips → Manage Booking to pay
  instalments, view details, update questionnaire answers, complete tasks, upload
  documents.
- **Mobile app** — **My Trips by WeTravel** (iOS/Android) is a **view-only
  traveller** app: day-by-day itinerary, offline access, maps, live itinerary
  updates, flight status, opens from any itinerary link with no login. No
  payments or changes in-app. A dedicated **operator** app is *unverified* — trip
  management is web-based.
- **English-only platform and emails.** The only localisation is multi-currency
  checkout.

---

## 3. Trips vs WeTravel — the honest matrix

Legend: **Have** = built and live in `travelgenix-trips`; **Partial** = some of
it; **Seam** = built but waiting on Stripe; **Gap** = not started; **Won't** =
deliberately out of scope.

| Capability | WeTravel | Trips today |
|---|---|---|
| Trip / itinerary builder | yes | **Have** (rich content editor, day-by-day, gallery) |
| AI brochure/PDF import | **yes (Smart Import AI)** | **Have** in tg-widgets Tour Builder; not yet in the standalone app |
| Media upload + stock library | yes | **Have** (upload, reuse, Pexels) |
| Packages / rooming with photos+links | yes | **Have** (phase 5) |
| Inventory allocation (hard caps, resource calendar) | yes (Pro) | **Gap** (capacity is per-departure; per-package allocation deferred) |
| Add-ons / options selectable at booking | yes | **Gap** (table missing a selection join) |
| Custom booking forms | yes | **Have** (phase 4) |
| Waivers + e-signature, mandatory gate | yes (Pro) | **Have** (phase 4, sha-pinned) |
| Document / ID upload | yes | **Gap** (needs a private blob store) |
| Participant tasks with reminders | yes | **Gap** |
| Waitlist | yes | **Gap** |
| Manage Trip dashboard (money, tabs, participants) | yes | **Have** (money summary, Bookings/Participants, CSV) |
| Bulk actions / custom columns / rich filters | yes | **Partial** (basic table + CSV; no bulk/columns yet) |
| Deposits taken online | yes | **Seam** (hold built; Stripe not wired) |
| Payment plans / instalments | yes (up to 18) | **Seam** (phase 3, needs Stripe) |
| Auto-billing + dunning schedule | yes (Pro) | **Seam** (reminder pipeline exists) |
| Multi-currency (price/hold/checkout) | yes (34/19) | **Gap** (one currency per trip) |
| Supplier payments / expense card | yes | **Won't** (regulated; do cost/margin instead) |
| Embeddable widgets (button/overlay) | **yes (full suite + WP plugin)** | **Have** (card + overlay); grid/button next |
| White-label / custom domain | yes (Pro) | **Gap** (planned for Enterprise band) |
| Promo / discount / early-bird codes | yes | **Gap** |
| Gift cards | **no** | n/a (neither) |
| Affiliate / referral engine | **no** | n/a (neither) |
| Reviews (collect + embed) | yes | **Gap** |
| Lead capture / abandoned cart | yes | **Partial** (enquiry engine in tg-widgets) |
| CRM | built-in | **Have**, native Airtable |
| Reporting dashboard (cross-trip) | yes | **Gap** |
| Team roles / permissions | yes | **Gap** (single operator per client today) |
| API / Zapier / accounting integrations | yes | **Partial** (`/api/v1/trips` read; no write/Zapier) |
| Automated emails (receipts, reminders) | yes | **Partial** (confirmation seam only) |
| Broadcast messaging to a trip | yes | **Gap** |
| SMS | **no** | **Gap** (an opening — see below) |
| Traveller mobile app | view-only, English-only | **Have but unwired**: Luna Travel PWA (offline, 6 languages, docs, agent chat) |
| Consumer marketplace | no | no (neither) |

---

## 4. Corrections to our own positioning

The teardown moved three things we had been claiming as ours:

1. **AI brochure import is no longer unique.** WeTravel shipped **Smart Import AI**
   (PDF/URL → itinerary) and an in-builder AI writer. The parity-list row "AI
   brochure import | no | ours" in the handover is now **wrong** — it is parity.
   Our edge there is only that ours can be better, not that it exists and theirs
   does not.
2. **Embeddable widgets are parity, not a moat.** WeTravel has a full widget suite
   (Book Now overlay, pricing, trip overview, reviews, brochure) and a WordPress
   plugin. Ours is good and it is ours to control, but "they have nothing like it"
   is false. Build the set out and make it nicer; do not sell it as unique.
3. **Reviews** — they have a verified-review system with an embeddable widget; we
   have none yet.

I have not edited the handover's parity table yet — flagging here first so the
correction is a decision, not a silent rewrite.

## 5. Where we genuinely win (and it holds up)

- **The money model.** They are custodial and take ~3.9% of everything; we never
  touch the money, it lands in the operator's own Stripe, and we are ~2.4 points
  cheaper on every pound. This is real and it is the whole pitch.
- **The traveller app.** Their My Trips app is **view-only and English-only**.
  Luna Travel is a full PWA — offline itinerary, maps, documents, six languages,
  push, agent messaging, Luna chat. Wired to a Trips booking it is a category
  ahead. This is our hardest-to-copy asset.
- **Multi-language** traveller comms and content, against their English-only
  platform.
- **The site builder (tg-sites)** and the **destination content database** — an
  operator can get a whole website and enriched destination content, not just a
  booking page.
- **SMS.** They have none. Reminders and pre-trip messages by SMS would be a
  visible, cheap differentiator.

---

## 6. Roadmap, in priority order

**P0 — unblock the reason the product exists.** Clear the Stripe Connect setup,
then: deposits taken online → **payment plans + auto-billing + the dunning
schedule** (phase 3). Nothing else matters as much; today we cannot take a penny.

**P1 — booking-management parity, most of it needs no Stripe.**
- Automated emails: receipts, payment reminders, task reminders (the reminder
  pipeline already exists in tg-widgets).
- **Broadcast messaging** to a trip (segments by package/status), scheduled — and
  build the **reusable templates** WeTravel's own users complain it lacks.
- **Waitlist** on a sold-out departure.
- **Promo / discount / early-bird codes.**
- **Document/passport upload** (needs a private blob store — an Andy step).
- **Per-package allocation** and **add-on/option selection** (both flagged in the
  handover as the next inventory slices).
- Participant table: **bulk actions, custom columns, richer filters.**
- **Reporting** dashboard (cross-trip money), **team roles**.

**P2 — distribution and growth.**
- Finish the embed set (**grid**, **book button**) and ship a **WordPress plugin**
  to match theirs.
- **White-label / custom domain** for the Scale/Enterprise band.
- **Reviews** (collect + embeddable widget).
- **API write + Zapier**, accounting export.
- Lead capture (email-gated brochure) and abandoned-cart.

**P3 — lean into the moat.**
- **Wire Luna Travel to Trips bookings** — the participant app that beats theirs
  outright.
- **SMS** reminders and messages — a gap they simply do not fill.
- Multi-language traveller comms.

**Deliberately not building** (say it plainly in sales, it is a scope choice):
supplier payments / custodial money movement, the Visa expense card, a consumer
marketplace (WeTravel has none either).

---

## 7. Sources

Full source lists are in the four research passes; the load-bearing ones:

- WeTravel product pages: itinerary builder, inventory, bookings, travel CRM,
  supplier transfers, expense card, pricing (`product.wetravel.com/*`).
- WeTravel help centre: embedding widgets, payment plans, reminder cadence,
  multi-currency, payouts, refunds/disputes, KYC, participant table, inventory,
  rooming lists, tasks, waitlist, messaging, mobile app, reviews, platform
  language (`help.wetravel.com/*`).
- WeTravel academy: payment-platform pricing, ways to embed, vendor transfers,
  reviews (`academy.wetravel.com/*`).
- Reviews/comparison: Capterra, G2, TrustRadius, SoftwareWorld, TrekkSoft.
