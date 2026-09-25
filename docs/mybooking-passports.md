# Passport details (FOID) on My Booking

Built 25 Sep 2026 from the spec "My Booking widget: passenger FOID (passport)
capture for flights". A customer looking at their booking can add or change the
passport details of the people on each flight, and we send them to Travelify's
`updatepaxfoid` endpoint. FOID is Travelify's name for a form of identification.
The type is always `Passport`.

The spec was revised the same day, after client feedback, to add an emergency
contact: one email address and one telephone number per flight's form, sent
with every save. See "The emergency contact" below. Widget 1.17.0.

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

## The emergency contact

Added by the spec's second revision (25 Sep 2026). One block at the top of
each flight's form, above the passengers, not one per person:

- **Email address**: required, a real email format, trimmed, kept as written
  (no lower-casing).
- **Country code**: a list of every country's dialling code, shown as
  "United Kingdom (+44)" in the page's language. The value sent is the digits
  only, `44`. The list is `DIAL_CODES` in `public/_passport-rules.js`: 244
  entries, generated from libphonenumber-js 1.13.14 on 25 Sep 2026 (the
  platform had no list of its own). Ascension Island and Kosovo are in it; the
  seven passport countries with no code of their own (AQ BV GS HM PN TF UM)
  are not.
- **Telephone number**: required, digits only, 4 to 15 of them, sent exactly as
  entered, a leading zero included. A typed letter or symbol never lands, a
  pasted "+44 (0)7777 777 72" arrives as `440777777772`, and anything that gets
  past both (autofill, a drop) is cut to digits.

**Where it starts from.** Email and telephone are decided separately. Each is
the primary passenger's own (`travellers[0].emailAddress`, and
`travellers[0].telephone` with its `countryPrefix` and `number`, counted only
when the number is filled), otherwise the booking's (`customerEmail`,
`customerTelPrefix`, `customerTelNum`). Several countries share a code, so a
code alone pre-selects the principal one (`DIAL_PRINCIPAL`: 1 is the United
States, 44 the United Kingdom, 7 Russia and so on); the code sent is the same
whichever the customer picks. A code no country has leaves the list unselected.

**What is sent.** `EmailAddress` and `Telephone { CountryPrefix, Number }`, both
parts strings, with every save, whether or not the customer changed them, in
front of `Passengers`. They are never a reason to save on their own: with no
passport change, nothing is sent, and the customer is told the contact is saved
together with passport details. The server answers "nothing to save" in that
case whatever the contact says, and only marks contact mistakes when there is a
passenger to send.

**A page from before the contact existed** (a cached widget, for the few minutes
the old script lives on) sends no `contact` at all. The server then sends the
contact the form would have started from, when the booking holds a complete
one, and the passengers alone when it does not.

**Privacy**, as for the passport: the contact reaches the page only while the
form can be used (it rides inside the passport block, which the host page's
`booking-loaded` event never carries), it is never written to browser storage
or a log, and the typed values are dropped once a save has landed. The demo
account's debug preview of the raw order now blanks `emailAddress`,
`customerEmail`, `customerTel*` and the whole `telephone` object as well as
every `foid*` value.

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

## The spec's open points

Andy put the first version's open points to Darren at Travelify on 25 Sep 2026,
the day it went live. His answers:

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

The second revision (the emergency contact) added two open points of its own.
Andy put them to Darren the same day, and both answers matched what was built:

5. **The primary passenger's `telephone` is `{ countryPrefix, number }`**, the
   keys `ppContactExisting` reads (in any case). Darren: "Yes". The inspector's
   `passports[].emergencyContact.primaryTelephone` still lists the keys really
   there on any booking, and whether each email and number is filled, never a
   value.
6. **A contact change alone is not savable.** Darren: "No, it is sent as part
   of the passport updates, you can't update one and not the other". So the
   contact always rides with a passenger change and never goes alone, which is
   what `_submitPassport` in the widget and the "nothing to save" line in
   `api/update-passport.js` do, and what the tests pin. Do not add a
   contact-only save.

## Tests

- `npm run test:mybooking-passport`: the spec's nineteen acceptance criteria,
  numbered [1] to [19] in the output ([13] to [19] are the emergency contact,
  and [17] also runs with real keys and a real paste in Chromium), through the rules module (on the spec's
  own dates), the real `retrieve-order` and `update-passport` handlers against
  a stand-in Travelify, and the real widget in jsdom. Also the privacy points
  above and the staff inspector.
- `npm run test:passport-rules-drift`: the widget's copy of the rules is the
  module's, byte for byte.
