# Brief — build the Travelgenix Trips product section on the Travelgenix website

For the Claude Code session that will add a "Travelgenix Trips" section (or page)
to the Travelgenix marketing website. Written 31 Aug 2026. Read this first, then
the sources in section 0. The product facts here are the truth to write from; do
not invent capabilities, and respect the claims guardrails in section 5.

---

## 0. Before you write a line

**The site is built in Framer.** So there is no repo to push to, and most of a Framer
marketing page is assembled visually by Andy inside Framer. That shapes what a Claude
Code session actually hands over. It changes HOW, not WHAT — the copy, positioning,
feature list and guardrails below are identical regardless. Agree with Andy which of
these the section is delivered as (they combine well):

1. **Copy plus a design spec** Andy builds visually in Framer. Always useful, and for
   a plain content section it may be the whole job. Give him section-by-section copy
   and a layout/structure he can drop into Framer's own components.
2. **A Framer code component** (`.tsx`). Framer code components are React and
   TypeScript with `addPropertyControls` for editable props and `framer-motion`
   available — this is the part most in a code session's wheelhouse. Use it for
   anything custom or interactive: the cost-comparison panel, an animated pillar row,
   a live Trips embed. Andy adds it as a new code component in the Framer project.
3. **An Embed of the live Trips widget.** Framer has an Embed element. The product
   already ships embeddable trip cards/grids (`embed.js` on trips.travelify.io), so a
   real Trips widget can sit on the marketing page as the live demo, via Embed or an
   iframe to a demo page. Confirm the widget behaves inside Framer's embed sandbox.

Ask Andy: is the section content-only (route 1), or does he want a custom/interactive
piece (route 2), or a live product demo on the page (route 3)? And how does he prefer
to receive a Framer code component (pasted into a new code component, or a file)?
The substance below is the same whichever we pick; only the packaging in section 7/10
differs.

**Read before building:**
- `docs/trips-platform-handover.md` — the product truth: what is built, what is a
  seam, the decisions locked, the pricing, the WeTravel comparison. Sections 1, 4
  and 5 are the spine of this brief.
- `docs/wetravel-teardown.md` — the competitor detail and the parity matrix.
- Skills: **travelgenix-design** and **travelgenix-taste** (brand law, tokens,
  accessibility, taste dials) BEFORE any UI; **travelgenix-humanizer** on all copy.
- The live product to reference and screenshot: **https://trips.travelify.io**
  (alias of travelgenix-trips.vercel.app). A published demo trip to link/screenshot:
  `https://trips.travelify.io/trip/global-travel-solution/kenya-johari-na-bahari-safari`.

---

## 1. The goal

One section or page on the Travelgenix site that introduces Travelgenix Trips: what
it is, who it is for, why it beats WeTravel, and a single clear call to action
(start the free trial, or book a demo).

**Audience, in order:** UK and Ireland travel agents first (the existing base), then
retreat hosts and group leaders in phase 2. Write for an agent who already sells
group trips and may already be paying WeTravel.

---

## 2. What the product is

A standalone platform for selling group trips and escorted tours: build the trip
page, take bookings and deposits, manage the travellers, and the money lands in the
operator's **own** Stripe account. It is software, not a payment service — we never
hold traveller money.

**The positioning line (use it, or a close variant):**

> WeTravel is a payments company that added trip pages. Travelgenix Trips is a
> travel platform that leaves your money alone.

---

## 3. The three pillars — the spine of the copy

Everything on the page should serve one of these (from handover section 4).

1. **Your money is yours.** Stripe Connect Standard: the operator is the merchant,
   funds land in their own Stripe account, on their own payout schedule, at their own
   Stripe rate. We take nothing per transaction. Roughly half the annual cost of
   WeTravel, and 2.4 percentage points cheaper on every pound that moves whatever we
   charge. (Numbers and caveats in section 5.)
2. **The trip sells itself.** A real brochure-quality trip builder, AI brochure
   import (drop in the PDF you already have, get a trip page back), destination
   content, and embeddable widgets so the trip sells on the operator's own site.
3. **The traveller gets an app, not a receipt.** Luna Travel: a branded PWA with an
   offline itinerary, trip map, documents, languages and push. (Confirm current
   status with Andy before featuring as shipping — see guardrails.)

---

## 4. Feature set to showcase (all built and verified in the app)

Draw the feature grid from this. All of it is live in the product today:

- Brochure-quality **trip pages** with itinerary (stacked or timeline), hero media,
  packages and priced add-ons.
- **Bookings and holds** that never oversell, **deposits**, custom **registration
  forms**, **waivers** with signature, **passport/ID document upload**.
- **Participant checklists**, **reviews** (collected from real bookers, moderated),
  **waitlists** on sold-out dates, **broadcast messaging** to a trip.
- **Automated emails** (confirmation, reminder, abandoned-booking recovery),
  **promo / early-bird codes**.
- **Reporting** across trips and a **bookings CSV export** for accounting.
- **Team roles** (owner / manager / viewer).
- **Embeddable widgets** — trip card, grid, book button, reviews — for the operator's
  own site.
- **Integrations**: outbound **webhooks** and an authenticated **API** with keys.
- **White-label**: the whole traveller journey and the emails wear the operator's
  brand, and the "Powered by" credit can be switched off.

---

## 5. Claims guardrails — READ, do not overclaim

The product is strong but some pieces are seams or roadmap. The website must not
present these as live without Andy's sign-off. Get section-5 claims checked by Andy
before publishing.

- **Online card payment is not wired yet.** Stripe Connect Standard is the model and
  the architecture (true, and the whole "your money is yours" story rests on it), but
  live checkout is not built — bookings are held and reconciled today. Frame the money
  story as the model and the economics, not as "take card payments right now", unless
  Andy confirms otherwise.
- **Emails send only when a provider key (Brevo) is set** — a seam. The branding and
  content are done; delivery turns on with the key.
- **AI brochure import needs the Anthropic key set** — a seam; works when enabled.
- **Custom booking domain and custom email sending domain are not built** (both need
  DNS). White-label covers everything except those.
- **Multi-currency is not built** — one currency per trip today.
- **Pricing is a recommendation, not published policy.** The bands (Trial free 14
  days no card; Start £39; Grow £99; Scale £249; Enterprise custom, banded on trailing
  12-month volume) are proposed in the handover and must be confirmed by Andy before
  any pricing appears on the site.
- **Every quoted number carries assumptions.** The "about half the cost" / "£4,377 a
  year" / "2.4 points cheaper" figures assume UK Stripe rates and $79 ≈ £62.50.
  Present as a range with the assumption stated, never a single hard number. The one
  claim that is pricing-independent and always safe: our marginal rate is Stripe's
  ~1.5% versus WeTravel's ~3.9%, so we are cheaper on every pound that moves.
- **Luna Travel PWA** — confirm current availability before featuring it as shipping.

---

## 6. Brand voice and design

- **Voice:** warm, plain, UK English, no em dashes, no Oxford comma, no AI cliche.
  Short sentences. Run every line through **travelgenix-humanizer** before it ships.
- **Design:** governed by **travelgenix-design** (brand tokens, accessibility) and
  **travelgenix-taste** (taste dials, motion). Match the existing Travelgenix site so
  the section reads as part of it, not a bolt-on. Craft floor: real hover/focus
  states, one authored motion moment (not the same entrance on every block), no
  kicker/eyebrow labels above headings, body/placeholder contrast at least 4.5:1.
- If delivered as an HTML block or widget: CSP-clean, self-contained, responsive,
  keyboard-accessible, and it must not scroll the page sideways on mobile.

---

## 7. Suggested shape of the section

1. **Hero** — the positioning line, a one-sentence what-it-is, primary CTA.
2. **The three pillars** (section 3), one panel each.
3. **Feature grid** from section 4 — grouped, scannable, honest.
4. **The cost story** — a simple side-by-side (WeTravel vs Trips) with the range
   caveat visible, or just the pillar-1 line if a full table feels heavy for the site.
5. **How it works** — three steps: build the trip, share it (hosted page or embed),
   travellers book and register.
6. **A live proof point** — link or embed the demo trip; a real Trips widget in a
   Framer Embed here shows the product instead of describing it.
7. **Pricing** — only if Andy has confirmed the bands; otherwise a "get in touch" CTA.
8. **Closing CTA** — start the free trial, or book a demo.

---

## 8. CTAs and links

- **Primary CTA:** start a 14-day free trial, no card. **Confirm the real signup URL
  with Andy** — where does an operator actually start? (The Trips app onboarding
  route.) Do not guess the link.
- **Secondary CTA:** book a demo, or "see a live trip" linking the demo trip URL.
- Live product: https://trips.travelify.io. Demo trip URL is in section 0.

---

## 9. Assets

- Screenshot source: the live app and the demo trip (section 0).
- Logos: the `tg-logo-library` repo.
- If the site can take an embed, the Trips `embed.js` widgets are the strongest asset
  — a live trip card on the marketing page shows the product instead of describing it.

---

## 10. Definition of done

- Copy approved and voice-checked (humanizer run), no overclaim past section 5,
  numbers shown as ranges with assumptions.
- Design matches the Travelgenix brand and passes the craft floor.
- CTAs point at real, confirmed destinations.
- Responsive and accessible.
- Delivered in the form Andy can actually publish in Framer (copy + layout spec, a
  Framer code component, or a Trips Embed — per the section 0 decision), and handed
  to Andy with a one-line note on how to place it in the Framer project.

---

## 11. Open questions for Andy (resolve at the start)

1. The site is in Framer. Which delivery does Andy want: copy + a layout spec he
   builds visually, a Framer code component for a custom/interactive piece, or a live
   Trips Embed on the page? (They can combine.)
2. Is this a section on an existing page, or its own page? Where in the nav?
3. Are the pricing bands from handover section 5 approved to publish?
4. What is the real trial-signup URL, and is self-serve signup live yet?
5. How much of the money story may we state as live versus "coming" (ties to the
   Stripe-not-yet-wired guardrail)?
6. Is Luna Travel ready to feature as shipping?
