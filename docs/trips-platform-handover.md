# Travelgenix Trips — the standalone platform

**Living handover. Read this first for any session on the Trips platform.**

Airtable project record: `recLlu3Y30QX6vOsr` (Projects, base `appj9tksreHOwkhYg`,
table `tblpyhPNhiQg3XkkT`) — the record still carries the working name "Group Trips".

Started 26 Jul 2026 as a widget. Rescoped 25 Aug 2026 into a standalone product
after Andy's call: *"it's fine for Travelgenix users, but I think we can do better
than WeTravel if we build a complete standalone platform."*

---

## 1. Decisions locked on 25 Aug 2026

These four override the 26 Jul architecture decisions where they conflict. They are
settled, do not re-open them without Andy saying so.

| # | Decision | What it means |
|---|---|---|
| 1 | **Market: both, agents first** | Launch into the existing UK and Ireland agent base, on architecture that opens self-serve to retreat hosts and group leaders in phase 2. We ship with real trips on day one rather than a cold start. |
| 2 | **Money: SaaS subscription only** | Stripe Connect **Standard**, application fee **zero**. Funds land in the operator's own Stripe account on their own payout schedule. We never hold traveller money. This confirms the 26 Jul decision rather than overriding it. |
| 3 | **Architecture: new repo, reuse the plumbing** | A fresh Next.js app in its own repo and its own Vercel project, on the already-provisioned `group-trips` Supabase. See decision 5 for the embed channel. |
| 4 | **Brand: Travelgenix sub-brand** | Working product name **Travelgenix Trips**. Uses travelgenix-design and travelgenix-taste as-is. No separate design world to invent. |
| 5 | **Trips is fully standalone, with its OWN embed widgets (27 Aug 2026)** | Andy's call: Trips does NOT live in the tg-widgets suite and will not be one of those widgets. It ships its OWN embeddable widgets, like WeTravel's, served from Trips itself (trips.travelify.io) — a snippet an operator drops on their own site. This SUPERSEDES the earlier "tg-widgets is the embed/distribution channel" clause in decision 3 and the phase-1 "repoint the four live tg-widgets" task, which is dropped. The tg-widgets Group Trips / Escorted Tour widgets are legacy and not part of Trips. |

**The consequence of decision 2 that matters most.** Because we take nothing per
transaction and never touch traveller funds, Travelgenix Trips is software, not a
payment service. No FCA authorisation, no safeguarding, no e-money partner, no
client-money account. That is a real strategic advantage and it is also the sales
line, see section 4.

---

## 2. What WeTravel actually is

A booking and payments platform for multi-day and group travel, used by 5,000+
companies. Founded on payments: the trip pages came later, and the economics still
give it away.

**Modules**

- Trip page builder, public or private, with an itinerary builder and maps
- Packages, options and add-ons
- Booking management and custom traveller information forms
- Payment plans, up to 18 instalments, auto-billing and automated reminders
- Waivers and agreements with digital signature, plus ID and document upload
- A participant dashboard where a traveller sees their own booking
- Inventory tracking for accommodation and transport
- Supplier payments worldwide, plus WeTravel Visa cards
- Multi-currency with local rails: ACH in the US, SEPA in Europe, BACS in the UK,
  PAD in Canada, BECS in Australia
- CRM integration

**What it costs an operator**

- Free plan, Pro at **$79/month**, Enterprise custom. The free plan carries the
  **same ~1% platform cut**, it drops the itinerary builder, customisation and
  lead capture. So free is a payment link, Pro is the platform.
- Card payments: **1% platform + 2.9% processing + $0.30**, so **3.9% + $0.30** a
  transaction, and **4.9%** on AMEX
- A minimum WeTravel fee of **$1.50** a transaction, so the percentage floor bites
  only below about $38 and never on a real trip deposit
- Bank rails advertised as fee-free to the traveller
- Wire transfer fixed at $25 / €25
- Fees can be absorbed or passed to the traveller

So the $79 is not the price. The price is roughly 3.9% of everything that moves.

**Where it is weak.** Taken from verified reviewer complaints, these are the gaps we
aim at, not guesses:

1. **FX and payouts.** AUD payments route via Europe and pick up bank international
   fees as high as 6%, on both the traveller's payment and the operator's payout.
   Some operators cannot receive transfers from outside the US at all.
2. **Onboarding limbo.** Account verification taking days to weeks. At least one
   operator refunded their customers and left over it.
3. **Support falls off a cliff after the sale.** A chat window checked once every
   24 hours.
4. **The pages are text heavy** with limited customisation, poor cover photo
   handling and no video.
5. **Named feature gaps:** waivers cannot be made mandatory during registration, no
   SMS reminders, rooming options carry no photos and no direct links.
6. **The monthly fee stings seasonal operators** who do not run trips year round and
   still pay while dormant.

Sources are listed in section 12.

---

## 3. What we already have

More than it looks. The widget work was not wasted, it is the front end of the
platform.

**Built and live in tg-widgets**

- `public/widget-trips.js` — compact Group Trips booking card, v0.1.0
- `public/widget-trips-page.js` — full trip landing page with enquiry, v0.1.0
- `public/widget-tour.js` — long-form escorted tour page: hero, itinerary at a
  glance, day-by-day with per-day facts, photos and priced optional activities,
  extras, included and excluded, packing list, gallery
- `public/widget-tour-card.js` — grid card that opens the full tour in an overlay
- `public/editor-tour.html` — the full-width Tour Builder, with image upload to
  Vercel Blob and **AI brochure import**: the browser reads a PDF with pdf.js and
  posts only the text to `api/widget-ai` action `import-tour`, which structures it
  faithfully and fills the builder for review
- `api/trip-enquiry.js`, `api/trip-availability.js` — enquiry into the unified lead
  router, and counts-only public availability
- `api/_lib/trips/supabase.js` — service-role access to the trips database, with the
  capacity rule unit-tested
- `api/_lib/payment-reminders.js` + `api/cron/payment-reminders.js` — a working
  reminder pipeline, built for My Booking, reusable here

**Provisioned and empty**

- Supabase project `group-trips` (`uzyckitibyfudnboaezm`), migration
  `gt_001_bookings_payments_reminders`, RLS on with no policies so only the service
  role reads or writes. Three tables, all at zero rows: `gt_bookings`,
  `gt_payments`, `gt_reminders`.

**Elsewhere in the estate, and this is the interesting part**

- **Luna Travel PWA** — a real traveller app. Itinerary, offline trip map, day
  storyboard, in-app document viewer, six languages, push, agent messaging, Luna
  chat. Live at 0.14.11.
- **Destination content database** — countries, cities, resorts and airports with
  written Spotlight content
- **tg-sites** — the CMS, for operators with no website
- **Luna Marketing** — the AI email composer and campaign engine
- **The widget suite** — 40+ embeddable widgets and a client dashboard

**Two real client tours already built** for GLOBAL TRAVEL SOLUTION: Kenya
(`recpPjb2ngAHl94f1`) and Tanzania (`recDaQfzr0Ijlb6h2`).

---

## 4. Where we win

The positioning, in one line:

> **WeTravel is a payments company that added trip pages. Travelgenix Trips is a
> travel platform that leaves your money alone.**

Three pillars. Everything we build should serve one of them.

### Pillar 1 — Your money is yours

Their single loudest complaint is money: FX haircuts, verification limbo, payouts
that will not reach some countries. We answer it by not being in the middle at all.
Stripe Connect Standard means the operator is the merchant, the funds land in their
own Stripe account, on their own payout schedule, at their own Stripe rate. We take
nothing.

That is worth real money, not just reassurance. On £200,000 of annual card volume,
roughly 400 transactions:

| | WeTravel | Travelgenix Trips |
|---|---|---|
| Platform and processing | 3.9% + $0.30 ≈ **£7,895** | Stripe UK card 1.5% + 20p ≈ **£3,080** |
| Subscription | $79/mo ≈ **£750** | £99/mo = **£1,188** |
| **Total a year** | **≈ £8,645** | **≈ £4,268** |

A saving of about **£4,377 a year, roughly half**, at the £99 proposed in section 5.

**The part that does not depend on our pricing.** Their marginal rate is 3.9%, ours
is Stripe's 1.5%. We are **2.4 percentage points cheaper on every pound that moves**,
whatever we end up charging. That is the fact about WeTravel, and it is the only
part of this that is theirs. Where the break-even sits is a fact about *our* price,
which is a dial we control. Section 5 sets it.

*Assumes Stripe UK standard rates for UK cards, and $79 ≈ £62.50 a month at roughly
1.26 USD to the pound. EEA and international cards cost more, so quote the range in
front of a customer, never the single number.*

### Pillar 2 — The trip sells itself

Their pages are text heavy with limited customisation. That is our home ground. The
Tour Builder already renders a real brochure, and the AI brochure import means an
operator drops in the PDF they already have and gets a trip page back. WeTravel has
nothing like it. Add destination content auto-enrichment from our own database, and
embeddable widgets so the trip sells on the operator's own site rather than only on
a hosted page.

### Pillar 3 — The traveller gets an app, not a receipt

WeTravel gives a participant dashboard. We already have Luna Travel: a branded PWA
with an offline itinerary, a trip map, documents, six languages, push and a line to
the agent. Nobody in this category has that. It is the hardest thing on this list to
copy and we have already built it.

### The parity list

To be credible we need these, because an operator will ask. Honest status:

| Capability | WeTravel | Us today | Work |
|---|---|---|---|
| Trip page builder | yes | yes, Tour Builder | polish |
| Itinerary with maps | yes | yes | polish |
| Packages (rooming) with photos and links | yes | **yes, built** (phase 5) | done |
| Options / add-ons | yes | **yes, built** (gt_014, priced by the hold) | done |
| Promo / early-bird codes | yes | **yes, built** (gt_011/012) | done |
| Payment plans, up to 18 instalments | yes | no | **build** |
| Auto-billing and reminders | yes | reminder pipeline exists (gt_010) | wire up (needs Stripe) |
| Waivers with e-signature | yes | **yes, built** (phase 4, mandatory gate) | done |
| Custom booking forms | yes | **yes, built** (phase 4) | done |
| Document and ID collection | yes | **yes, built** (gt_015, private Supabase Storage) | done |
| Broadcast messaging + templates | yes | **yes, built** (gt_009) | done |
| Waitlist on full trips | yes | **yes, built** (gt_008) | done |
| Team roles / permissions | yes | **yes, built** (gt_016, owner/manager/viewer) | done |
| Reporting (money across trips) | yes | **yes, built** | done |
| Participant dashboard | yes | Luna Travel + Manage Trip | wire up |
| Inventory and rooming | yes | **rooming + per-package allocation built** (gt_013) | done |
| Multi-currency | yes | no | **build** |
| CRM | integration | Airtable, native | done |
| Supplier payments | yes | **not building** | see below |
| AI brochure import | **yes now** (Smart Import AI) | **yes** | **parity, not a moat** |
| Embeddable widgets | **yes now** (widget suite + WP plugin + reviews) | **yes** | **parity, not a moat** |
| Traveller PWA | view-only app | **yes**, Luna Travel | ours |
| Destination content | no | **yes** | ours |
| Site builder | no | **yes**, tg-sites | ours |
| No booking-fee money model | no | **yes** | ours |
| SMS to travellers | no | possible | ours |

**Supplier payments: deliberately not building.** Moving operator money to third
parties is a regulated activity and it is the one part of WeTravel that genuinely
needs to be a payments company. We do supplier **cost tracking and margin** instead,
so the operator sees profit per departure, and they pay suppliers however they
already do. Say this plainly in sales, it is a scope choice, not a gap.

---

## 5. Pricing

Recommendation, to confirm before the pricing page is built. **Revised 25 Aug 2026
after Andy asked whether we should band on volume. We should.**

### Band on volume, not on trip count

The first draft gated Lite at three active trips. That is the wrong metric and it
should not survive. Trip count punishes an operator for building their catalogue,
which is the exact behaviour we want from them, and it correlates badly with the
value they get. Volume correlates well.

It also fixes a hole. Because we take nothing per transaction, our revenue is
completely decoupled from the customer's success. An operator on £2m of volume pays
the same £99 as one running a single trip a year, while costing us far more to
support. Volume bands are how the "we take no cut" promise survives contact with
our own P&L.

| Band | Trailing 12-month volume | Price | Beyond the core product |
|---|---|---|---|
| Trial | any | 14 days free, no card | everything |
| **Trips Start** | up to £75k | **£39/mo** | core product, one brand |
| **Trips Grow** | £75k to £400k | **£99/mo** | extra users, saved templates |
| **Trips Scale** | £400k+ | **£249/mo** | multi-brand, API, custom domains, priority support |
| **Enterprise** | custom | custom | onboarding, SLA, bespoke work |

No free tier. WeTravel can afford free because they earn on every transaction, we
cannot and should not pretend otherwise. The trial does that job.

### The core product does not move between bands

This matters more than the numbers. **Payment plans, waivers, forms, rooming and the
traveller app are in every band, including Start.** Gate on scale (users, brands,
API, domains), never on the ability to run a trip properly. Two reasons: a small
operator who cannot take a deposit instalment is not a customer we have won, they
are one we have sent to WeTravel, and "you get the whole product" is a far cleaner
sentence than a feature matrix.

### The promise the bands must not break

Our pitch is a flat fee and no cut. Bands bend that unless we are careful, and a
sharp operator will say so. The defence is real, not cosmetic: **inside a band, the
marginal pound costs nothing.** On WeTravel every extra £1,000 of sales costs £39.
On us it costs £0 until the band steps, and the step is known in advance. We charge
for the size of the platform, not for the pound that moves through it.

So three rules, and they are not negotiable if the story is to hold:

1. Never a percentage. Never a per-transaction fee.
2. Bands assessed on **trailing 12 months**, reviewed annually, never auto-upgraded
   mid-term without notice. This also answers the seasonal-operator complaint in
   section 2: a quiet year drops them a band rather than billing them through it.
3. Three bands, wide. The moment there are six, we are metering, not pricing.

### What each band looks like against WeTravel

| Their volume | WeTravel Pro | Us | They save |
|---|---|---|---|
| £75k (top of Start) | £3,675 | £1,593 | £2,082 |
| £400k (top of Grow) | £16,350 | £7,188 | £9,162 |
| £1m (Scale) | £39,750 | £17,988 | £21,762 |

At £1m we earn **£2,988** from that operator instead of £1,188, and they still save
£21,762. That is the whole argument for banding in one row.

The £39 entry also closes the objection from the last section. At £39 we are cheaper
than WeTravel Pro at **every** volume, and cheaper than their **free** plan above
about **£19,500** rather than £49,500.

### Where the break-even sits, and who moves it

We beat them by 2.4 points on marginal rate whatever we charge. Our monthly fee
decides only at what volume that advantage has paid for itself. That number is ours
to set, not a property of WeTravel.

Against **WeTravel Pro** at $79/month, roughly £750 a year:

| Our monthly | We are cheaper above |
|---|---|
| £49 | every volume, including zero |
| £59 | every volume, including zero |
| £62.50 | break-even at zero, the crossover point |
| £79 | £8,250 |
| £99 | £18,250 |
| £129 | £33,250 |

Anything at or below about **£62 a month makes us cheaper than WeTravel Pro at
every volume**, including an operator who sells nothing all year. That is why the
Start band is £39 and not £49.

**The comparison that is harder, and the one I missed first time round.** WeTravel
also has a **free** plan: no monthly fee, the same cut on cards, minus the itinerary
builder, customisation and lead capture. It is not feature-comparable to us, but a
price-sensitive operator will hold it up anyway, so have the answer ready:

| Our monthly | Cheaper than WeTravel Free above |
|---|---|
| £49 | £24,500 |
| £79 | £39,500 |
| £99 | £49,500 |

Read against the bands above: **Start at £39 beats their free plan above about
£19,500**, and beats Pro everywhere. Grow at £99 needs about £50k against free,
which is inside its own band anyway, so nobody sits in the wrong place. Banding is
what makes both true at once, which a single flat fee could not do.

---

## 6. Architecture

```
  travelgenix-trips  (new repo, new Vercel project)
    Next.js 15 App Router
      /app/(operator)      the operator console, Travelgenix-branded
      /app/(public)        public trip pages, operator-branded
      /app/api             booking, payments, webhooks
    |
    +-- auth        cookie SSO against tg-widgets  (/api/auth/sso, /api/auth/me)
    +-- data        Supabase group-trips  uzyckitibyfudnboaezm  (service role only)
    +-- money       Stripe Connect Standard, application fee 0
    +-- content     Destination Content Airtable base
    +-- embed       Trips' OWN embed widgets (see 6a), served from this app
    |
  luna-travel  (the traveller PWA, post-booking)
```

### 6a. Embed widgets — Trips' own (decision 5, 27 Aug 2026)

Trips ships its own embeddable widgets, like WeTravel's, served from the Trips
app (trips.travelify.io), NOT from tg-widgets. An operator drops a container plus
one script on their own site and gets an operator-branded card / grid / button
that launches the hosted Trips booking flow.

The plumbing is already in place: `GET /api/v1/trips/{id}` is public, CORS-open,
counts-only (published trips, public brand only, no PII), and `next.config.ts`
deliberately leaves the public `/trip` and `/book` pages frame-able (only
`/console` is frame-denied), so the booking can open in an overlay iframe on the
operator's site while the PII stays on our origin. The embed loader (`embed.js`),
the container contract, and the widget rendering are the build. See section 8,
"Embed widgets" for status.

**Rules that must hold**

- **One identity.** Trips reuses the tg-widgets cookie SSO. An agent signs in once.
  Never build a second login.
- **The browser never touches Supabase.** RLS is on with no policies. Service role
  only, server side, exactly as `api/_lib/trips/supabase.js` does it today.
- **Traveller PII lives in `gt_travellers` and `gt_bookings` and nowhere else.**
  Public endpoints return counts, never a field of traveller data. That rule is
  already enforced in `api/trip-availability.js`, keep it.
- **The widgets keep the embed contract.** A container div plus one script, config
  by `data-tg-id`. The change is where the config comes from, not the contract.
- **Money moves only through Stripe.** No amount is ever trusted from the browser.
  Price is resolved server side from the trip record, every time.
- **Design.** travelgenix-design and travelgenix-taste govern the operator console.
  Public trip pages are operator-branded, so they follow the client-site craft floor
  in the root CLAUDE.md.

---

## 7. Data model

Extends the three existing `gt_*` tables rather than replacing them. Thirteen new
tables, written and committed as `gt_002_platform.sql`. The migration series
continues from `gt_001`.

**New**

- `gt_operators` — the selling business. Stripe account id, branding, plan, domain.
  Keyed to the Airtable client record id so an existing agent is not re-onboarded.
- `gt_trips` — a trip as a first-class row, not a widget config blob. This is the
  change that turns the widget into a platform.
- `gt_departures` — one trip, many dates, each with its own capacity and price.
- `gt_packages` — room types and tiers. Carries photos and links, which is a named
  WeTravel gap.
- `gt_options` — add-ons and priced extras, per booking or per traveller. Now
  selectable and billable through the hold (gt_014); a booking snapshots its
  chosen extras in `gt_bookings.selected_options` jsonb.
- `gt_travellers` — a person on a booking. A party of six is six rows.
- `gt_payment_plans` and `gt_instalments` — the schedule and each due amount.
- `gt_forms` and `gt_form_responses` — custom questions per trip. A question can
  now be of type `document` (an upload), authored like any other field.
- `gt_waivers` and `gt_signatures` — the document, its version, and who signed what
  and when. Version matters, a signature must point at the exact text signed.
- `gt_documents` — traveller uploads (passport, ID, insurance). RESHAPED by gt_017
  from the gt_002 placeholder to the shipped shape (operator_id, trip_id,
  field_key, file_path); the file lives in the private `traveller-docs` Supabase
  Storage bucket, never a public URL.
- `gt_promo_codes` (gt_011) — discount / early-bird codes, operator-scoped.
- `gt_waitlist` (gt_008) — would-be travellers when a departure is full.
- `gt_message_templates` and `gt_messages` (gt_009) — broadcast messaging.
- `gt_operator_members` (gt_016) — team roles (owner / manager / viewer) within an
  operator. Authorisation only; identity is tg-widgets SSO. See lib/members.ts.

**Existing, extended**

- `gt_bookings` — add `departure_id`, `package_id`, `operator_id`,
  `payment_plan_id`, `balance_pence`.
- `gt_payments` — widen `kind` beyond `deposit` and `balance` to include
  `instalment`. Keep the idempotent upsert on `stripe_checkout_session_id`.
- `gt_reminders` — widen `kind` for instalment reminders.

**Keep the capacity rule as it is.** A place is taken by `deposit_paid` and `paid`
always, and by `pending` only while the hold has not expired. It is already pure,
exported and unit-tested in `computeSpotsTaken`. It moves to counting against
`gt_departures` rather than a widget id, and that is the only change.

---

## 8. Build phases

Each phase ships something an operator can use. No phase is a refactor with nothing
to show.

**Phase 0 — Foundations. BUILT AND SHIPPED 25 Aug 2026.** Next.js 15 App Router app, the SSO
bridge to tg-widgets, the service-role data layer, the capacity and money rules
ported from the widget with 24 tests, the `gt_002_platform.sql` migration, a
console shell and a public trip page. Typecheck clean, build clean, tests green.
*Two things are outstanding and both need Andy: the GitHub repo itself, and the
Stripe Connect step. See section 9.*

**Phase 1 — A trip is a real thing. CORE BUILT 25 Aug 2026.** `gt_002` is APPLIED
to the live database (16 tables, RLS on, verified at zero rows). Trips and
departures are real records. The console does create, edit, publish and unpublish
with departures managed inline, the public trip page renders from the database, and
`GET /api/v1/trips/{id}` is live for the widgets, accepting either the trip uuid or
the legacy `tgw_` id. Ownership is enforced in the query rather than by the caller.
55 tests, typecheck and build clean, and the schema was smoke-tested against the
live database with the exact column sets the code writes.

*Two pieces of phase 1 are deliberately NOT done yet, and both deserve their own
pass rather than being rushed in behind the rest:*

1. ~~**Repointing the live widgets.**~~ **DROPPED 27 Aug 2026 by decision 5.**
   Trips is standalone and gets its OWN embed widgets (see section 6a), so the
   tg-widgets `widget-trips.js` / `widget-trips-page.js` / `widget-tour.js` /
   `widget-tour-card.js` are not repointed and are not part of Trips. The
   `legacy_widget_id` column and the API's dual-lookup stay harmless and can keep
   serving any old embed already on a customer site, but they are no longer a
   migration target.
2. **Migrating the Kenya and Tanzania tours.** Needs an operator record for GLOBAL
   TRAVEL SOLUTION and a one-off script to move the two saved configs across. Worth
   doing as the proof the model holds, and it will expose whatever the `content`
   jsonb shape gets wrong.

**Phase 2 — Take the money. THE JOURNEY IS BUILT, THE PAYMENT CALL IS THE SEAM
(27 Aug 2026).** Everything except the Stripe checkout call is done and on the
live database: a public checkout form, the ATOMIC hold, the confirmation email
seam, the confirmation page, and the booking landing in the operator console.

  - The hold (`gt_003` + `gt_004`) was designed by a four-way panel and judged
    before a line was written: a plpgsql RPC that locks the one departure row
    FOR UPDATE, counts in a separate statement under READ COMMITTED, then
    inserts. It cannot oversell. Verified against the live DB, and a live
    `information_schema` check caught FIVE gt_001 NOT-NULL columns the panel's
    SQL would have tripped on (only widget_id was flagged in the design).
  - An adversarial review (five lenses, every finding independently verified)
    found 13 real defects. Eleven fixed, including two HIGH: a double-booking
    path on ambiguous network failure, and a group deposit understated by the
    party size. Two documented follow-ups, below.
  - STILL THE SEAM: the Stripe deposit checkout call takes the slot right after
    the hold. When the three Stripe steps are cleared this is an afternoon: the
    booking is already created as `pending`, and the webhook flips it to
    `deposit_paid`. Nothing else has to move.

  Two follow-ups the review raised that were deliberately NOT rushed:
  - **Per-IP rate limiting** on the public booking action needs a shared store
    (Vercel KV, Upstash, or the estate's Redis). Infra-free mitigations are in
    already: a per-email cap of six live holds per departure, and a publish kill
    switch in the hold function. Per-IP is the real defence and an infra call.
  - **The booking reference doubles as the confirmation access token** at about
    38 bits. Fine for reading down a phone; thin as a bearer token. The proper
    fix is a separate high-entropy link token on the row, a small schema change.
    This now covers the registration flow too (same reference gate), so the
    link-token upgrade is worth a little more when it lands.

  Also added 27 Aug 2026: a **Preview** route. `/trip/preview/[id]` renders the
  real brochure for a trip in ANY status, gated like the console and never
  cached, so an operator can preview a draft and see an edit the moment they
  save it (the public page is ISR-cached, which read as a broken preview). The
  public and preview routes share one `TripView` component. Preview buttons are
  on the trip editor and on each draft in the trips list.

**Phase 3 — Payment plans.** Schedules up to 18 instalments, auto-billing on saved
payment method, reminders on the existing pipeline, a pay-balance link. Parity with
their headline feature.

**Phase 4 — The people. FULLY BUILT (document upload landed 28 Aug 2026).** `gt_travellers`,
custom forms per trip, and waivers with e-signature and the **mandatory gate at
registration** are live and on the existing (already-applied) gt_002 tables. No
Stripe needed: it all hangs off the confirmation/registration side, not payment.

  - `lib/registration.ts` is the pure authority (12 tests): sanitises an
    operator's form schema (stable unique keys, drops junk, a choose-one with no
    options is dropped), validates a traveller submission with `party_size`
    authoritative and the mandatory-waiver gate, and decides completion from the
    stored rows rather than a flag. A signature pins the exact text via a
    server-computed `body_sha256` and the waiver version, so editing a signed
    waiver spawns a NEW version rather than rewriting what was agreed.
  - Two trust models sit side by side in repo.ts: operator-gated authoring
    (through the owning trip) and reference-gated registration (the booking's
    bearer token, like the confirmation page). Every id the browser sends is
    re-resolved against the booking, never trusted.
  - Operator authoring: a Registration section on the trip editor (a question
    builder + a waiver editor). Traveller flow: `/register/[reference]`,
    operator-branded, a card per place with the custom questions and a signature
    line per traveller; reached from a "Complete your booking" CTA on the
    confirmation page. Operator manifest: `/console/bookings/[id]` shows every
    traveller, their answers, who signed, and a registration-complete banner;
    the bookings list shows "3 of 4" named and links through.

  **Document and passport upload. BUILT 28 Aug 2026, on Supabase Storage (NOT
  Vercel Blob).** The earlier plan flagged a private Vercel Blob store as an Andy
  dependency; that turned out to be unnecessary. We already run Supabase, whose
  private Storage buckets with short-lived signed URLs are the right home for
  sensitive PII and need no new provisioning. So documents are a new `'document'`
  registration field type (authored exactly like a question, per traveller or
  once per booking): the file uploads out of band through
  `POST /api/register/document` (bearer reference, size and mime capped to match
  the bucket), lands in the private `traveller-docs` bucket, and is recorded in
  `gt_documents` (gt_015). Completeness folds a present document into the answered
  set, so a required passport gates "registration complete" with no change to the
  completeness rule. The operator views one through `/api/console/document/[id]`,
  which checks ownership and 302-redirects to a 90-second signed URL — the
  traveller never holds a durable link. `lib/storage.ts` is the server-only
  Storage seam. Live-verified end to end on the deployed environment (upload →
  signed URL → fetch matched bytes → delete; the bucket rejects a disallowed mime).

  Follow-up carried over from phase 2 and relevant here too: **per-IP rate
  limiting** on the public registration and document-upload actions still wants a
  shared store; the actions guard the inet column, the booking status, and the
  bucket's size/mime limits in the meantime.

**Phase 5 — Inventory. ROOMING BUILT 27 Aug 2026.** Packages (room types /
occupancy tiers) are a real, bookable thing end to end, closing WeTravel's named
"rooming with no photos and no direct links" gap. No Stripe needed.

  - Migration **gt_007** teaches the atomic hold about packages, strictly
    additively over gt_004 (every earlier guarantee untouched): a new optional
    `p_package_id` that must belong to the departure's own trip (else 'invalid',
    so a forged or borrowed package cannot ride in), the package's per-person
    price overriding the departure's when set, and the package stamped on the
    booking and every traveller. Applied and LIVE-VERIFIED against the database:
    total priced off the package, deposit still off the departure, foreign
    package rejected.
  - Operator authoring: a Packages section on the trip editor (name, sleeps,
    per-person price, how many available, description, photo via the media
    picker, an https info link, order). A package with bookings against it is
    kept, not deleted. Public: a Room options section on the trip page (and the
    preview), each package a card with photo, price, occupancy and a link.
    Booking: a required Room option picker; the choice prices the booking. The
    chosen package shows on the confirmation and the operator's booking detail.
  - `validatePackage` + booking `package_id` are covered by 6 new tests (145
    total).

  While live-testing this, the **/book page's first-ever live render surfaced a
  pre-existing phase-2 500** (unrelated to packages): `book/actions.ts` is a
  'use server' file that also exported `const EMPTY_BOOKING_STATE`, which does
  not survive the client boundary, so the form's initial state was wrong and
  `errors.departure_id` threw. Fixed by moving the state to lib/action-state
  (the exact pattern the console already uses). Diagnosed from the live runtime
  error and the compiled bundle, not guessed.

  **Both later slices now BUILT (28 Aug 2026):**
  - **Per-package allocation** — **gt_013** rewrites the hold to count a package's
    own capacity per departure under the same row lock, returning `package_full`
    when a party would go over, while a null-capacity package is unaffected.
    Live-verified: a 2-cap package fills at party 2, a third booking returns
    package_full while the departure still has room.
  - **Options / add-ons** — **gt_014** rewrites the hold again (10th arg
    `p_option_ids`): every REQUIRED option is folded in plus any the traveller
    chose, priced per booking or per traveller, added AFTER any promo discount (a
    trip discount must not discount the airport transfer), and snapshotted onto
    the booking as `selected_options` jsonb so the record survives an edit. No
    junction table needed. The same migration FIXED a latent promo-redemption
    leak (a code was counted before the capacity/allocation checks, so a failed
    hold burned a use; it now increments only after the insert). Operator authors
    extras on the trip editor; the booking form has an extras picker; the
    confirmation and operator booking detail show them. Live-verified: base
    £3,700pp + £40pp transfer + £250 guide + folded-in £15pp required levy priced
    to £7,760 for party 2; a 20% code discounted the base only to £3,015; a failed
    hold left the code's redeemed count at 0, a successful one moved it to 1.

    Deferred within options: **option capacity capping** (the `gt_options.capacity`
    column exists but is not enforced, so it is deliberately NOT offered in the
    authoring UI — offering a limit we do not enforce would be dishonest); and a
    **per-option quantity** picker (an option is currently all-or-nothing per
    party). Both are small follow-ups when a real operator needs them.

**Phase 6 — The console.** Bookings list, per-departure manifest, payment status,
outstanding balances, supplier cost and margin, CSV and PDF export.

**Phase 7 — The traveller app.** Luna Travel takes a Trips booking reference and
becomes the participant dashboard. The pillar nobody can copy.

**Phase 8 — Self-serve.** Signup without an agency account, Stripe billing for our
own subscription, pricing page, onboarding. This is the phase that opens the retreat
host and group leader market, which is why it is late and not never.

**Embed widgets (decision 5) — CARD WIDGET BUILT 27 Aug 2026.** Trips' own
embeddable widgets, served from Trips itself. First widget shipped: a trip CARD
that opens the booking as an OVERLAY on the operator's site (Andy's two choices).

  - `public/embed.js` (v0.1.0): one container `<div data-tg-trip="TRIP_ID">` plus
    one `<script src="…/embed.js" defer>`. Resolves the API base from the
    script's own origin, reads the public CORS `GET /api/v1/trips/{id}` (counts
    only, no PII), renders an operator-branded card in Shadow DOM
    (`:host{all:initial}`), and Reserve opens `/book/{operator}/{slug}` in a
    modal iframe overlay (Esc / backdrop / close, body scroll locked). CSP-clean;
    a brand colour is hex-whitelisted and an image URL is https-and-trusted-host
    only. Optional `data-tg-cta` (button label) and `data-tg-api` (dev override).
    `public/embed-demo.html` is a stand-in operator page. Verified in headless
    Chromium against a mock (card + overlay both correct).
  - **Next embed slices** (same loader, quick to add): a **grid** of an operator's
    live trips (`data-tg-trips="<operator-slug>"`, needs a small per-operator list
    endpoint), and a **bare book button** (`data-tg-book`) for operators who
    already have their own trip page.
  - A note for go-live: the embed's fetch and the overlay iframe are public on the
    real `trips.travelify.io` domain, but on the `*.vercel.app` host they sit
    behind Vercel deployment protection, so the demo only fully works for someone
    logged in to Vercel until the custom domain is live.

**Manage Trip (once bookings arrive) — BUILT 27 Aug 2026.** Andy asked for two
management surfaces, modelled on WeTravel's Manage Trip screen.

  - **Operator**: `/console/trips/[id]/manage`. A header with the trip, a money
    summary across it (**Booked / Collected / Outstanding**, collected =
    deposits on deposit_paid plus the full total on paid), and Preview / Edit.
    Tabs: **Bookings** (the trip's bookings, each linking to its detail) and
    **Participants** (every named traveller with buyer, room, dates, status),
    with Waitlist / Messages / Promote shown as coming soon. **Export CSV** of
    participants via an operator-gated `GET /console/trips/[id]/participants.csv`.
    repo `getTripManage` inner-joins bookings to the trip through the departure;
    `lib/participants` is the shared pure flatten used by both screen and export.
    A Manage link on the trips list and a Manage-bookings button on the editor.
    Live-verified with three seeded bookings (held / deposit_paid / paid):
    £22,200 booked, £4,700 collected, £17,500 outstanding, all correct.
    **Bookings tab upgraded (P1 #7, 27 Aug 2026)** to an interactive client
    table matching WeTravel's participant table: filter by status and room,
    a Columns chooser persisted per browser, sortable headers, row selection,
    and **bulk status actions** (mark deposit paid / paid / cancelled) — the
    offline-payment equivalent of WeTravel's bulk actions until Stripe wires the
    online path. `bulkSetBookingStatus` is scoped three ways (operator, the
    trip's departures, the id list) and only permits statuses that cannot
    oversell, so the hold RPC is untouched. Live-verified.
  - **Traveller**: the `/booked/[reference]` hub now also shows the balance due
    after the deposit, so the whole money picture is in one place they return to
    with their reference (alongside what they booked, the room, and the
    update-details / register link). Real online payment is still the Stripe seam.

**The P1 sweep — ALL DONE (27–28 Aug 2026).** After the deep WeTravel teardown
(§4), the non-Stripe P1 gaps were worked straight down the list, each live-verified
and pushed on its own commit. Migrations gt_008–gt_016. In order:

  1. **Reporting** — a cross-trip money dashboard at `/console/reports`.
  2. **Waitlist** — gt_008. A full trip shows a waitlist form instead of a dead
     end; the operator gets a Waitlist tab with invite / remove.
  3. **Broadcast messaging** — gt_009. Compose to a segment (status / room) with a
     live recipient count, save/reuse templates, sent history. The real Brevo
     transport activates on `BREVO_API_KEY` + `TRIPS_EMAIL_FROM`, logging until then.
  4. **Automated emails** — gt_010. Operator new-booking notice, a confirmation
     "complete your booking" link, and a daily reminder cron (CRON_SECRET-guarded).
  5. **Promo / early-bird codes** — gt_011/012. Percent or amount, per booking or
     per person, date window and redemption cap, validated and applied inside the
     hold. (gt_014 later fixed the redemption-count ordering — see phase 5.)
  6. **Package allocation + add-ons** — gt_013/014. See phase 5 above.
  7. **Document / passport upload** — gt_015, private Supabase Storage. See phase 4.
  8. **Team roles / permissions** — gt_016. Owner / manager / viewer WITHIN an
     operator. Identity stays in tg-widgets SSO, so this is authorisation, not a
     second login: `lib/members.ts` (pure, tested) resolves a person's role from
     the operator's contact and its member list. Two invariants make it safe to
     ship — the contact_email is always owner (a team can never lock itself out),
     and until the first member is added everyone under the client stays owner (the
     deploy changes nothing until an owner opts in; then an unlisted user is
     read-only, never shut out). Server-side and fail-closed: `requireEditor` is
     null for a viewer and guards every console write (18 actions + the media write
     routes); `requireOwner` guards the Team screen (`/console/team`, add teammates
     by email, set roles). A view-only banner and hidden edit affordances for
     viewers. Live-verified (case-insensitive unique index, the Team page renders
     the contact as fixed owner). **Deferred UI polish:** the trip editor still
     renders its forms for a viewer (saves fail server-side with a view-only
     message) rather than being fully read-only — a cosmetic follow-up; the
     security boundary is the server gate, which is complete.

The test suite is **169 green** (`node --test`), typecheck and build clean.

**WeTravel gap backlog — agreed with Andy 28 Aug 2026, come back to these.** After
the P1 sweep these are the remaining things WeTravel has that Trips does not.
Andy chose to do the embed-set item (13) first; the rest are parked here in
priority-ish order so the next session picks up without re-deriving them:

  6. **Multi-currency** — price / hold / checkout in the traveller's currency, and
     cross-trip reporting that converts (needs an FX source). One currency per trip
     today. Decide: wire an FX feed and build it, or keep the "indicative" label.
  7. **Reviews** — DONE 28 Aug. gt_018 gt_reviews. Verified collection
     (/review/[reference], reference-gated so only real bookers), operator
     moderation (a Reviews tab on Manage Trip: approve / hide / remove), public
     display on the trip page with a star roll-up (lib/reviews, pure + tested),
     a public GET /api/v1/trips/{id}/reviews, a data-tg-reviews embed widget
     (embed.js v0.3.0) and a [tg_reviews] WP shortcode. Live-verified: endpoint
     returns approved-only 4.7/3 with no PII, the trip page shows the three and
     hides the pending one, the widget renders the half-star summary. FOLLOW-UP:
     an automatic post-trip review-invite email and a per-booking copy-link
     button (operators share /review/{reference} today).
  8. **Participant tasks** — DONE 28 Aug. gt_019 gt_trip_tasks + gt_task_done
     (one done-row per task+booking, unique). A per-BOOKING checklist the operator
     authors on the trip editor (label, optional detail, optional due date);
     travellers tick items off on /booked (optimistic, overdue dates flagged, a
     reference-gated tick action); the operator sees "Checklist: N of M done" on
     the booking detail. Per-traveller obligations stay in the registration +
     documents engine (not duplicated). Live-verified end to end. FOLLOW-UP:
     automated task reminders (reuse the notify seam + daily cron) and a
     per-traveller variant.
  9. **White-label / custom domain** for an operator's booking pages (Enterprise band).
  10. **Integrations** — a public WRITE API, Zapier, and accounting export
      (QuickBooks / Xero). ACCOUNTING EXPORT DONE 31 Aug: an operator downloads
      a finance ledger of every booking from the Reports page (a Download
      bookings CSV button → operator-gated GET /console/bookings.csv). One row
      per booking: reference, trip, buyer, dates, party, room, promo, status,
      currency and the money columns (total, deposit, collected, outstanding).
      lib/finance is the pure, tested core (bookingCollected / bookingOutstanding
      reuse the exact collected/outstanding model of the Reports and Manage
      screens, so the ledger reconciles on screen; poundsAmount + bookingsCsv do
      RFC 4180 quoting and CRLF); repo.listOperatorBookingsForExport joins
      package/promo/departure/trip. Live-verified on prod: the download returns
      text/csv with a slug+date filename and a deposit_paid row reconciling
      7400/1000/1000/6400. No external dependency, so it needs no env keys.
      OUTBOUND WEBHOOKS DONE 31 Aug: the real-time counterpart, and the
      primitive a future Zapier app would consume. An operator registers HTTPS
      endpoints on an owner-only /console/integrations screen; Trips POSTs a
      signed JSON event on booking.created (after a hold) and booking.updated
      (when an operator changes booking status). gt_021 gt_webhooks
      (operator-scoped endpoints, per-endpoint secret, event-subscription
      filter, last-delivery health; RLS on, no policies). lib/webhooks is the
      pure, tested core: HMAC-SHA256 signing over `${timestamp}.${body}`
      (Stripe-style, replay-aware), verify, a stable { id, type, created_at,
      data } envelope whose collected/outstanding reuse the finance rules, and
      secret mint/redact (whsec_, shown once). lib/dispatch does best-effort
      signed delivery with a 4s timeout and records status; it NEVER throws, so
      it can't break the booking it observes. A seam: no endpoints = silent
      no-op (no env key to set). Headers: x-tg-signature, x-tg-timestamp,
      x-tg-event. The console screen adds/pauses/removes endpoints and has a
      Send-test button. Live-verified on the deployed Node runtime via a
      temporary self-test (since removed): a signed POST round trip returned
      transportIntact + bodyIntact + signatureVerifies all true and the money
      reconciled (collected 20000, outstanding 80000 on a deposit_paid sample).
      7 webhook tests (204 green total). FOLLOW-UP: delivery retries/backoff and
      a payment.succeeded event once Stripe is wired. STILL OPEN in this gap:
      the public WRITE API (only /api/v1/trips read exists) and a published
      Zapier app (which would just consume these webhooks).
  11. **Abandoned-booking recovery** — DONE 28 Aug. gt_020 adds recovery_sent_at.
      A daily CRON_SECRET-guarded cron (/api/cron/abandoned-recovery, in
      vercel.json, 10:00 UTC) sweeps pending holds that lapsed without completing
      (never nudged, reachable, created within 30 days) and sends one warm
      come-back email (notify.sendAbandonedRecovery) linking to /book/{op}/{trip}.
      lib/recovery isAbandoned is the pure rule; the PostgREST filter mirrors it.
      Live-verified: a completed booking is excluded, a genuinely-abandoned one
      selected with its slugs; the endpoint refuses without CRON_SECRET. NEEDS
      (shared with the registration reminder): CRON_SECRET set in Vercel for the
      cron to run, and BREVO_API_KEY + TRIPS_EMAIL_FROM to deliver rather than
      log. Note: this recovers holds that were created; true pre-submit cart
      capture (email-on-blur before a booking exists) is a larger follow-up.
  12. **AI brochure import inside the standalone Trips app** — DONE 28 Aug. An
      operator pastes an itinerary on the New Trip page; POST /api/import calls
      claude-opus-5 (@anthropic-ai/sdk) with a proven injection-hardened
      extraction prompt (extract, do not invent; strip the letterhead) and
      creates a DRAFT trip to review. lib/import is pure and tested: draftFromImport
      runs the model's JSON back through validateTrip + sanitiseTripContent (the
      editor's own sanitiser), so a non-trip document is refused and a hostile
      field never reaches the DB. A SEAM like Stripe/email: NEEDS ANTHROPIC_API_KEY
      in the Trips env (verified absent today, so it reports not-configured until
      set). FOLLOW-UP: browser PDF text extraction (pdf.js) so an operator can
      upload a PDF, and importing departures/prices (left out for now since the
      model must never guess a price).
  13. **Full embed set** — DONE 28 Aug. `embed.js` v0.2.0 now dispatches three
      containers from one script: `data-tg-trip` (card), `data-tg-trips` (a GRID
      of an operator's trips, reading a new `GET /api/v1/operators/{slug}/trips`),
      and `data-tg-book` (a bare Book button). Plus an installable **WordPress
      plugin** (`wordpress-plugin/travelgenix-trips`) with `[tg_trip]`, `[tg_trips]`
      and `[tg_book]` shortcodes. Live-verified: the grid endpoint returns
      counts-only, brand-whitelisted data with CORS; all three render.

Stripe-blocked money features (online deposits, payment plans + auto-billing,
dunning, refunds, receipts) are tracked separately in §9 and the roadmap; they are
seams, not gaps.

Also still open (non-competitor): the reference-as-token hardening (a separate
high-entropy link token), per-IP rate limiting on the public actions (needs a
shared store), and basic observability before real bookings.

---

## 9. The blocker, and it has not moved since 7 August

**Stripe is not set up, and every money phase is behind it.** Three human steps,
none of which Claude can do:

1. Add Stripe **test** keys to Vercel: `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`
2. Enable **Stripe Connect** on the Travelgenix account
3. Register the Connect webhook and add `STRIPE_CONNECT_WEBHOOK_SECRET`

The Supabase side is fully unblocked and, as of 25 Aug 2026, fully built:
`gt_002_platform.sql` is APPLIED. Sixteen tables, RLS on with no policies on every
one, verified at zero rows. `TRIPS_SUPABASE_URL` and
`TRIPS_SUPABASE_SERVICE_ROLE_KEY` are already in Vercel.

A note so nobody panics at it later: Supabase's security advisor reports sixteen
`rls_enabled_no_policy` notices against these tables. They are INFO level and they
are the design, not a finding. Service-role-only access with no policies is exactly
what we want, and adding a policy to silence the advisor would be the bug.

This is three weeks old as of 25 Aug 2026. Phases 2, 3, 6 and 8 cannot start without
it. Phases 1, 4, 5 and 7 can, and so could all of phase 0 bar the Connect step,
which is why phase 0 is now built. But the booking engine is the product, and it
is waiting on a login to Stripe.

### The repo now exists, and phase 0 is in it

`github.com/andyspeight/travelgenix-trips`, created by Andy on 25 Aug 2026 after
the GitHub App turned out to have no repository-creation scope. Phase 0 was pushed
to `main` the same day and the staged copy has been removed from this branch, so
there is one home for the code.

**It is PUBLIC.** Andy's call, made knowingly. Two consequences that bind every
future session:

- Commercial detail was **stripped out of the public repo before the first push**:
  no pricing, no bands, no competitor analysis, no Airtable or Supabase
  identifiers. Its `CLAUDE.md` carries technical conventions only and says so at
  the top. **This document is where the strategy lives.** Keep it that way.
- Nothing sensitive goes into that repo, its commit messages or its issues. If a
  future decision needs the pricing rationale to make sense, write the rationale
  here and reference it there as "the private handover".

### A constraint worth knowing, found while building phase 0

The SSO cookie is `tg_session`, set on `.travelify.io` for cross-subdomain SSO. So
the **console must be served from a `*.travelify.io` host** or the browser simply
never sends the cookie and every visitor looks signed out. `trips.travelify.io` is
therefore not a branding preference, it is a technical requirement. The knock-on:
an operator **custom domain can only ever serve public trip pages, never the
console**, which is now written into the repo's own `CLAUDE.md`.

---

## 10. Open questions for Andy

1. **Confirm the band figures** in section 5: Start £39 to £75k, Grow £99 to £400k,
   Scale £249 above that, core product flat across all three. The band **metric** is
   settled: **volume processed**, decided 25 Aug 2026. Still open: bookings taken
   offline and marked paid by hand sit outside anything we can meter, so we need a
   stated policy. Recommend we band on volume that passes through Trips and do not
   chase the rest.
2. **Repo name and domain.** Suggest repo `travelgenix-trips`, domain
   `trips.travelify.io`, with operator custom domains in Enterprise.
3. **Do the existing widget tiles stay?** Group Trips and Escorted Tour are still
   coming-soon tiles on the client dashboard. Flip them to point at the platform, or
   retire them once phase 1 lands?
4. **Migrate or rebuild the two live tours?** Kenya and Tanzania are real client
   content. Recommend migrating them in phase 1 as the proof the model works.
5. **The two content jobs from 10 Aug are still open**: real photos for both tours,
   and Tanzania's headline price plus the hot-air-balloon cost.

---

## 11. Numbers you can quote

- WeTravel: **5,000+** companies, **$79/mo** Pro, **3.9% + $0.30** a card
  transaction, **4.9%** AMEX
- Us at £200k annual card volume: **≈ £4,377 a year cheaper, about half**
- The invariant, true whatever we charge: we are **2.4 percentage points** cheaper
  on marginal rate (Stripe 1.5% against their 3.9%)
- At the proposed £99/mo: cheaper than WeTravel **Pro** above **≈ £18,000** of
  annual card volume, and than WeTravel **Free** above **≈ £49,500**
- At **£62/mo or below** we are cheaper than WeTravel Pro at every volume
- Reported FX damage on their side: bank international fees **as high as 6%** on AUD
- We already have **40+** widgets, a **six-language** traveller PWA and a
  destination content database. None of that is on their roadmap.

## 12. Sources

- [WeTravel pricing, features and reviews, Capterra](https://www.capterra.com/p/163474/WeTravel/)
- [WeTravel for tour operators](https://product.wetravel.com/tour-operators-us)
- [WeTravel payment platform pricing, WeTravel Academy](https://academy.wetravel.com/wetravels-payment-platform-pricing)
- [WeTravel pricing, WeTravel Help Center](https://help.wetravel.com/en/articles/434422-pricing)
- [WeTravel reviews, Capterra](https://www.capterra.com/p/163474/WeTravel/reviews/)
- [WeTravel reviews, G2](https://www.g2.com/products/wetravel/reviews)
- [WeTravel reviews, TrustRadius](https://www.trustradius.com/products/wetravel/reviews)
- [8 best WeTravel alternatives, TrekkSoft](https://www.trekksoft.com/en/blog/8-best-wetravel-alternatives-2026-comparison-guide)
- [Best WeTravel alternatives, SquadTrip](https://www.squadtrip.com/guides/best-wetravel-alternatives/)
