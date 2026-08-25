# Travelgenix Trips

The standalone group travel booking and payments platform. Operators sell trips,
travellers book and pay, and the money lands in the operator's own Stripe
account.

> WeTravel is a payments company that added trip pages. Travelgenix Trips is a
> travel platform that leaves your money alone.

## Why it exists

WeTravel charges 1% platform plus 2.9% processing plus $0.30 on every card
transaction, so 3.9%, and 4.9% on AMEX. We charge a flat monthly fee and take
nothing per transaction, because the operator is the merchant of record on
Stripe Connect Standard. On £200,000 of annual card volume that is roughly half
their cost.

The full case, the parity table, the economics and the build phases are in
`docs/trips-platform-handover.md` in the `tg-widgets` repo.

## Status

**Phase 0, foundations.** The app boots, resolves a real session over the
existing Travelgenix SSO, and reads the Trips database. There is no booking
engine yet: phases 2 and 3 are blocked on Stripe setup.

| Phase | | Status |
|---|---|---|
| 0 | Foundations | this repo |
| 1 | A trip is a real thing | ready to start |
| 2 | Take the money | blocked on Stripe |
| 3 | Payment plans | blocked on Stripe |
| 4 | The people: travellers, forms, waivers | ready to start |
| 5 | Inventory: packages and rooming | ready to start |
| 6 | The console | blocked on Stripe |
| 7 | The traveller app | ready to start |
| 8 | Self-serve | blocked on Stripe |

## Running it

```bash
npm install
cp .env.example .env.local     # then fill it in
npm run dev
```

`GET /api/health` reports what is wired without revealing any value:

```json
{ "ok": true, "phase": 0, "database": "configured", "stripe": "missing" }
```

```bash
npm test        # node:test over the real TypeScript sources
npm run typecheck
```

## The database

Supabase project `group-trips` (`uzyckitibyfudnboaezm`). `gt_001` created
bookings, payments and reminders for the widget. `gt_002_platform.sql` in this
repo turns that into a platform schema: operators, trips, departures, packages,
options, payment plans, instalments, travellers, forms, waivers, signatures and
documents.

RLS is on for every table with no policies. The service role is the only way in
and the browser never connects.

## Conventions

`CLAUDE.md` carries the locked decisions and the rules that must hold. Read it
before changing anything, particularly the ones about who owns a trip, where
traveller data may live and why we never take a cut of a payment.
