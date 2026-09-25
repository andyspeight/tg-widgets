# Passport details (FOID) on My Booking

Built 25 Sep 2026 from the spec "My Booking widget: passenger FOID (passport)
capture for flights". A customer looking at their booking can add or change the
passport details of the people on each flight, and we send them to Travelify's
`updatepaxfoid` endpoint. FOID is Travelify's name for a form of identification.
The type is always `Passport`.

## Where it lives

| Piece | File |
|---|---|
| The rules (one copy, read everywhere) | `public/_passport-rules.js` |
| Its verbatim copy in the widget | `public/widget-mybooking.js`, between `// >>> passport rules` and `// <<< passport rules` |
| What the page is told per flight | `passportState()` in `api/_lib/passport-foid.js`, attached by `api/retrieve-order.js` as `item.passports` |
| The save | `api/update-passport.js` (POST `/api/update-passport`) |
| The request body and the Travelify call | `passengerBody()` and `callUpdatePaxFoid()` in `api/_lib/passport-foid.js` |
| The form | `renderPassportSection()` and the `_pp*` / `_submitPassport` methods in `public/widget-mybooking.js` |
| Staff check of a real booking | `passports` in `/api/admin/order-shape` |

Edit the rules in the module, copy the block into the widget, then run
`npm run test:passport-rules-drift`. Never edit the widget's copy alone.

## The rules

- **Flights items only**, each on its own `itemId`. A package's flights are not
  a Flights item and get nothing, as the spec says.
- **Offered only when** `dataObject.canEditFOID` is boolean `true` (not the
  string, not 1) **and** today is at least one day before the outbound
  departure. Calendar days: the day before departure is the last day; departure
  day is too late.
- **Today** is the UTC calendar day, the same one the upsell rule uses. Booking
  days are the first ten characters of the supplier's own value, never a `Date`
  parsed from it (the booking-dates rule in CLAUDE.md). The spec left UK time
  against airport time open and said to use the platform's own handling; this
  is it.
- **Infants** (type `Infant`, any case) get no block and are never sent, even
  if a request asks. A flight with only infants on it offers nothing.
- **Fields**: number (letters and digits, 5 to 20, stored upper case, no inner
  spaces), issuing country (ISO 3166-1 alpha-2, from a list of all 249 codes,
  named in the page's language by the browser), issue date (before today),
  expiry date (after the day they fly home, or after the last outbound arrival
  on a one-way flight, and after the issue date).
- **Only changes are sent.** A person whose details are untouched, or put back
  to what the booking holds, is left out. Nothing changed means no call at all,
  from the page or from the server.
- Every field name is read either way round (`canEditFOID` / `CanEditFOID`,
  `foidNumber` / `FOIDNumber`), as the Travelify API treats them.

## What the server does that the page cannot be trusted to

`/api/update-passport` takes the customer's three details (email, departure
date, booking reference), the flight's item id and, per person, their index in
that flight's travellers list plus the four fields. It then:

1. finds the booking again from those three details and reads its id and
   order key itself (the key never goes to or comes from the browser);
2. checks the item is a Flights item on that booking;
3. checks eligibility again on today's date, so a page left open past the
   cut-off cannot submit;
4. drops infants, validates every field again and drops unchanged people;
5. builds each passenger from **its own fetch of the order**: every field the
   order holds for them, as it holds it, under PascalCase names, plus the five
   FOID fields. A name or date of birth in the request is ignored;
6. posts to `https://api.travelify.io/updatepaxfoid/{orderId}/{orderKey}/{itemId}`
   with `travelifyAuthHeaders()` (Token, and the `https://localhost/` Referer).

Travelify's `success: false` error text is shown to the customer as it came.
A 5xx, a timeout or a body that is not JSON shows our own message. Entered
values stay in the form either way.

## Data handling

- A passport number reaches the page in full only while it can still be
  edited (the form opens pre-filled). Once editing has closed, the page gets
  the last four characters (`••••8776`), the country and the expiry date.
- Nothing is written to browser storage, cookies or the address bar. What the
  customer types lives on the widget instance and is dropped once a save has
  landed and the refreshed booking is on screen.
- The widget's `tg-mybooking:booking-loaded` event, which the client's own page
  (and its analytics) can read, gets a copy of the order with the passport
  block removed.
- No passport number is logged. `retrieve-order`'s demo debug preview of the
  raw order blanks every `foid*` value.
- `retrieve-order` and `update-passport` answer with `Cache-Control: no-store`.

## The spec's open points, settled 25 Sep 2026

Andy put the spec's open points to Darren at Travelify on 25 Sep 2026, the day
this went live. His answers:

1. **The FOID property names on a traveller who already has passport
   details** are `foidNumber`, `foidIssuingCountry`, `foidStartDate` and
   `foidExpiryDate`, the names the code already reads (in any case). Darren:
   "yes, those are the field names".
2. **A partial passenger list clears nobody.** Sending one passenger leaves
   the other passengers' passport details as they were. Darren: "Yes". This is
   what lets us send only the people who changed.
3. **`canEditFOID` on the flight is the only switch.** Nothing else needs
   turning on per application before `updatepaxfoid` accepts a call. Darren:
   "Just look for the canEditFOID on the flight, nothing else is needed". So
   when a customer asks why they cannot see the form, read `canEditFOID` on
   that flight first (the staff inspector below shows it).
4. **UK time or airport time for "the day before".** We chose the UTC calendar
   day, the platform's existing handling (see The rules). During British Summer
   Time that puts the cut-off at 1am UK time on departure day, not midnight.
   Darren was told and raised no objection.

`/api/admin/order-shape` still reports each flight's `canEditFOID`, its
passport field names (`passports[].foidKeys`) and who has a number
(`withPassportValue`), never a value. It is now a support check rather than an
open question.

## Tests

- `npm run test:mybooking-passport`: the spec's twelve acceptance criteria,
  numbered [1] to [12] in the output, through the rules module (on the spec's
  own dates), the real `retrieve-order` and `update-passport` handlers against
  a stand-in Travelify, and the real widget in jsdom. Also the privacy points
  above and the staff inspector.
- `npm run test:passport-rules-drift`: the widget's copy of the rules is the
  module's, byte for byte.
