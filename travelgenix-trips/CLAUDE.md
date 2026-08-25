# travelgenix-trips — repo conventions for Claude Code

Read this first in every session. Owner: Andy Speight, CEO, Travelgenix.

## What this repo is

**Travelgenix Trips**, the standalone group travel booking and payments platform.
Operators sell trips, travellers book and pay, and the money lands in the
operator's own Stripe account. It is our answer to WeTravel.

The strategy, the competitive teardown, the economics and the nine build phases
live in **`docs/trips-platform-handover.md` in the `tg-widgets` repo**. Read that
before doing product work here. The Airtable project record is
`recLlu3Y30QX6vOsr` (base `appj9tksreHOwkhYg`, table `tblpyhPNhiQg3XkkT`), still
titled "Group Trips". Read it at the start of a session and update it at the end.

## Where it sits in the estate

```
  travelgenix-trips   this repo. Next.js 15 App Router on Vercel.
    +-- auth      cookie SSO against tg-widgets. We do NOT have our own login.
    +-- data      Supabase project `group-trips` (uzyckitibyfudnboaezm).
    +-- money     Stripe Connect Standard, application fee ZERO.
    |
  tg-widgets          the widget suite. Our embed and distribution channel.
  luna-travel         the traveller PWA. Becomes our participant dashboard.
```

## The decisions that are locked

Do not re-open these without Andy saying so. Dates matter, he relies on them.

- **26 Jul 2026 / confirmed 25 Aug.** Stripe Connect **Standard**, application fee
  **zero**. The operator is the merchant of record. We never hold traveller funds,
  which is why Trips is software rather than a payment service: no FCA
  authorisation, no safeguarding, no client-money account. Do not add an
  application fee. It would change what this company is.
- **25 Aug 2026.** Pricing bands on **volume**, not trip count. Start £39 to £75k,
  Grow £99 to £400k, Scale £249 above. Never a percentage and never a
  per-transaction fee: inside a band the marginal pound must cost nothing. Bands
  assessed on trailing twelve months. The **core product does not move between
  bands** - payment plans, waivers, forms, rooming and the traveller app are in
  all three. Gate on scale only.
- **25 Aug 2026.** Market is both, agents first. Brand is a Travelgenix
  sub-brand, so travelgenix-design and travelgenix-taste apply as-is.
- **25 Aug 2026.** Supplier payments are deliberately **not built**. Moving
  operator money to third parties is regulated. We do cost tracking and margin.
- **7 Aug 2026.** The capacity rule, ported into `src/lib/capacity.ts`. A place is
  taken by `deposit_paid` and `paid` always, and by `pending` only while the hold
  has not expired. `cancelled` and `expired` never count. Keep it pure and keep
  it tested.
- **10 Aug 2026.** A zero price means "not priced yet" and is **hidden**, never
  rendered as £0 or free. `money.format()` returns `null` for anything at or
  below zero and callers render "Price on request".
- **10 Aug 2026.** Uploads store the returned **https URL only**, never base64 and
  never the bytes.

## Rules that must hold

- **One identity.** `src/lib/auth.ts` asks tg-widgets `/api/auth/me` who is signed
  in, forwarding the `tg_session` cookie. Never build a second login. Never set a
  manual `Authorization` header: tg-widgets prefers Bearer over cookie, and a
  stale token silently outranking the live session is the act-as bug fixed on
  2 Aug 2026.
- **The domain is load-bearing.** `tg_session` is set on `.travelify.io`, so the
  console must be served from a `*.travelify.io` host or nobody is ever signed in.
  Operator custom domains serve **public trip pages only**, never the console.
- **The browser never touches Supabase.** RLS is on with no policies. Service role
  only, server side only. `src/lib/supabase.ts` imports `server-only` so a stray
  client import fails the build rather than leaking the key.
- **A trip belongs to an operator, never to a person.** Ownership resolves through
  `gt_operators.client_record_id`, never by matching the email of whoever built
  it. That bug cost us 65 uneditable widgets on 2 Aug 2026.
- **Traveller PII lives in `gt_bookings` and `gt_travellers` only.** Public
  endpoints return counts. When you query availability the select list is
  `party_size,status,hold_expires_at` and nothing is ever added to it.
- **Never trust an amount from the browser.** Price is resolved server side from
  the departure, every time, on every charge.
- **Money is integer pence.** Never a float.
- **Ownership checks fail closed.** No session, or a session with no operator,
  owns nothing.

## Design

- The **console** is Travelgenix-branded: travelgenix-design and
  travelgenix-taste govern it.
- **Public trip pages are operator-branded.** They take their palette from
  `gt_operators.brand` at render time, not from our tokens, and they follow the
  client-site craft floor in the tg-widgets root `CLAUDE.md`. A page that reads
  as a form is the exact WeTravel weakness we are attacking.

## Working style

- Andy has memory challenges and relies on the assistant as an external brain.
  Restate context, anchor with dates, keep the Airtable record current.
- Never rebuild from scratch, always upgrade what is there. If unsure, ask.
- Diagnose before patching. Evidence before hypothesis. Hard stop after two
  failed fixes and rethink.
- Brand voice for any copy: warm, plain, UK English, no em dashes, no Oxford
  comma, no AI cliche.

## Layout

```
  src/lib/         supabase.ts  auth.ts  capacity.ts  money.ts  types.ts
  src/app/         console/          the operator console, Travelgenix-branded
                   trip/[operator]/[slug]/   public trip page, operator-branded
                   api/
  supabase/migrations/   gt_002_platform.sql onwards. gt_001 lives in tg-widgets.
  test/            node:test, TypeScript run through Node type stripping
```

## Testing

`npm test` runs `node --experimental-strip-types --test`, so tests import the
real `.ts` sources rather than a build artefact. Node 22.6+ required.

Every capability ships with a test that exercises it, and the whole suite is
re-run. The capacity and money suites are not optional: between them they decide
whether we oversell a trip and whether we advertise a free safari.
