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
| 3 | **Architecture: new repo, reuse the plumbing** | A fresh Next.js app in its own repo and its own Vercel project, on the already-provisioned `group-trips` Supabase. tg-widgets stays as the embed and distribution channel. |
| 4 | **Brand: Travelgenix sub-brand** | Working product name **Travelgenix Trips**. Uses travelgenix-design and travelgenix-taste as-is. No separate design world to invent. |

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
| Packages, options, add-ons | yes | display only | **build** |
| Payment plans, up to 18 instalments | yes | no | **build** |
| Auto-billing and reminders | yes | reminder pipeline exists | wire up |
| Waivers with e-signature | yes | no | **build** |
| Document and ID collection | yes | Luna viewer only | **build** |
| Participant dashboard | yes | Luna Travel | wire up |
| Inventory and rooming | yes | no | **build** |
| Multi-currency | yes | no | **build** |
| Custom booking forms | yes | enquiry engine exists | adapt |
| CRM | integration | Airtable, native | done |
| Supplier payments | yes | **not building** | see below |
| AI brochure import | no | **yes** | ours |
| Traveller PWA | no | **yes** | ours |
| Destination content | no | **yes** | ours |
| Embeddable widgets | no | **yes** | ours |
| Site builder | no | **yes**, tg-sites | ours |

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
    |
  tg-widgets  (unchanged, stays the distribution channel)
    widget-trips.js / widget-trips-page.js / widget-tour.js / widget-tour-card.js
      read the platform API instead of Airtable widget config
    |
  luna-travel  (the traveller PWA, post-booking)
```

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
- `gt_options` — add-ons and priced extras, per booking or per traveller.
- `gt_travellers` — a person on a booking. A party of six is six rows.
- `gt_payment_plans` and `gt_instalments` — the schedule and each due amount.
- `gt_forms` and `gt_form_responses` — custom questions per trip.
- `gt_waivers` and `gt_signatures` — the document, its version, and who signed what
  and when. Version matters, a signature must point at the exact text signed.
- `gt_documents` — traveller uploads, passports and insurance.

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

1. **Repointing the live widgets.** `widget-trips.js`, `widget-trips-page.js`,
   `widget-tour.js` and `widget-tour-card.js` still read Airtable widget config.
   The API they need exists, but changing them touches embeds already on customer
   sites, so it wants a careful migration with the old path kept working. That is
   what `legacy_widget_id` and the dual-lookup in the API are for.
2. **Migrating the Kenya and Tanzania tours.** Needs an operator record for GLOBAL
   TRAVEL SOLUTION and a one-off script to move the two saved configs across. Worth
   doing as the proof the model holds, and it will expose whatever the `content`
   jsonb shape gets wrong.

**Phase 2 — Take the money.** Deposit checkout through Connect Standard, the
webhook, the transactional hold on capacity, the confirmation email. This is the old
GT-4 to GT-7, finally unblocked.

**Phase 3 — Payment plans.** Schedules up to 18 instalments, auto-billing on saved
payment method, reminders on the existing pipeline, a pay-balance link. Parity with
their headline feature.

**Phase 4 — The people.** `gt_travellers`, custom forms per trip, waivers with
e-signature and a **mandatory gate at registration**, document and passport upload.
Three of their named gaps closed in one phase.

**Phase 5 — Inventory.** Packages and rooming with photos and links, add-ons,
per-departure capacity, allocation.

**Phase 6 — The console.** Bookings list, per-departure manifest, payment status,
outstanding balances, supplier cost and margin, CSV and PDF export.

**Phase 7 — The traveller app.** Luna Travel takes a Trips booking reference and
becomes the participant dashboard. The pillar nobody can copy.

**Phase 8 — Self-serve.** Signup without an agency account, Stripe billing for our
own subscription, pricing page, onboarding. This is the phase that opens the retreat
host and group leader market, which is why it is late and not never.

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
