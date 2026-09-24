# ATOL certificates in My Booking

Built 24 Sep 2026. Airtable project record `recEqxD9kk0uG4UYK` (My Booking: ATOL certificates).

## What it does

When a Travelgenix client holds its own ATOL, a customer's booking comes with
the correct CAA ATOL Certificate:

- **On the booking page**, an "ATOL Certificate" button beside the PDF buttons
  (on its own row if the client has hidden those) downloads it.
- **In the confirmation email** it is attached beside the booking pack, and the
  pack note says so. That includes the automatic confirmation sent when a
  booking arrives from Travelify (webhook, then the cron worker, then
  `/api/booking-email`). The CAA's rule for a booking made at a distance is to
  send the certificate by email "immediately after the payment is taken".

Andy's brief, 24 Sep 2026: "When a booking is 'ATOL Protected' and the travel
company is a Travelgenix client, we must attach the correct ATOL certificate to
the booking ... produce these exactly as they are, plus the relevant booking
details", then "a toggle in My Booking that turns each ATOL receipt on/off" and
"an area where the client can add their ATOL details".

## Which bookings (Andy's decision, 24 Sep 2026: "every flight they sell")

A booking gets a certificate when ALL of these hold:

1. The client has entered **both** its legal name ("ATOL Certificate Issuer")
   and its ATOL number in the My Booking editor.
2. The booking has a flight the **client** sold: a `Flights` item. A flight
   inside a `Packages` item (Jet2 Holidays, TUI) is the tour operator's, sold
   under the operator's licence, and the operator issues that certificate.
3. The booking and that flight are not cancelled.
4. The matching certificate is switched on:
   - flights alone get **Flight-only**;
   - flights sold with accommodation or car hire get a **Package** certificate,
     single- or multi-contract as the client has chosen (the two package
     switches are one choice: switching one on switches the other off).

Every switch is **off** by default. It is a legal document and is never issued
unless the client asked for it.

Nothing in the Travelify order we read says a booking is protected under the
agency's OWN licence (the one flag we know, a `Packages` item's
`inclusions: ['ATOLProtection']`, is the operator's). That is why the rule is
the client's switches plus "a flight they sold". The staff order inspector
(`/api/admin/order-shape`) now reports an `atolTrail`: every ATOL-ish field on a
real order. If Travelify turns out to mark agency-ATOL bookings, run it on one
and tighten the rule to that flag.

**Known limit of the rule.** A flight sold as the airline's agent with the
ticket issued at once is not ATOL-licensable. A client who sells some flights
that way and switches Flight-only on would issue a certificate for those too.
The editor's Flight-only switch says so ("Leave it off if you sell flights as
the airline's agent with the ticket issued there and then"); whether they sell
any exempt flights is theirs to know.

## Exactly as the CAA publishes them

The three templates are the CAA's own, dated 1 July 2018 (`010718`), still
current in September 2026 (the 1 Apr 2026 ORS3 changes did not touch the
certificate). They live, byte for byte as supplied, in `api/_data/atol/`:

| Type | File |
|---|---|
| Flight-only | `ATOLCert_FlightOnly_010718.pdf` |
| Package (Single-contract) | `ATOLCert_PackageSingle_010718.pdf` |
| Package (Multi-contract) | `ATOLCert_PackageMulti_010718.pdf` |

The CAA: "Individual certificates must follow the format exactly", and the
yellow background "must be included on any electronic versions". So nothing
redraws the certificate. `api/_lib/atol-certificate.js` opens the CAA's file,
removes the SAMPLE watermark (an Acrobat watermark the CAA laid over its
samples: a form XObject marked `/PieceInfo /ADBE_CompoundType /Private
/Watermark`, removed by deleting the one operator that paints it, so no line of
the design is touched) and writes the booking into the blanks with pdf-lib, in
the certificate's own ink (#2C2E35) and Helvetica, which is Arial-metric.

The editor's **preview** keeps the SAMPLE watermark on purpose, so a specimen
made with a real ATOL number can never pass as a certificate.

## What goes in each blank

From the CAA's "Guidance on completion of an ATOL Certificate" (ATOL Policy and
Regulations 2019/01), read through search excerpts because the CAA site is
blocked from the development sandbox:

| Blank | What we print | Rule |
|---|---|---|
| Who is protected? | Everyone travelling on the protected parts, lead first | Flight-only: "all known names (including infants) must be specified". Packages may be limited to the lead name; we print everyone. |
| Number of passengers | Count excluding infants | CAA |
| What is protected? | Each flight (day, airports, flight number); for packages also the stays, car hire, transfers and tickets | "only list components protected together as a licensable booking" |
| Who is protecting your flight/trip? | Legal name, ATOL number | The ATOL holder |
| ATOL protected cost (Flight-only) | The flights' price | Not confirmed by the CAA text we could reach; the certificate's own wording reads as the total protected price |
| "If ___ stops trading" (twice) | Legal name | The ATOL holder |
| "confirmation you will receive from ___" (packages) | Legal name | The issuer |
| "By issuing ... ___ confirms" | Legal name | The issuer ("the business which interacts with the consumer") |
| "ATOL held by ___" (Flight-only) | Legal name | The ATOL holder |
| Unique reference number | Booking reference + 5-character fingerprint of what the certificate says, e.g. `ET122149-XWVVS` | One per certificate. A new certificate is required "each time any of the details on the booking changes", so changed details give a new reference and unchanged details the same one |
| Date of issue | The day this reference was first issued (the register) | |
| ATOL Certificate Issuer | Legal name | |
| ATOL number | As entered | |

Long names shrink, then wrap within the gap the form leaves; nothing may
overprint the CAA's wording. Letters Helvetica cannot draw lose their accent
(Łukasz prints as Lukasz) rather than failing the certificate.

## The register: ATOL Certificates table

Airtable, widgets base, table `tblnoLpQhP9G1cHDG`, written by
`api/_lib/atol-issue-log.js`. One row per certificate reference: reference,
booking reference, widget, client, type, date issued, passenger count,
protected cost, ATOL number. **No passenger names.** The first row for a
reference fixes its date of issue, so a certificate given in June still says
June when it is downloaded in September. It is also the list an agent can be
asked for by the CAA ("the unique reference number of each ATOL Certificate
supplied by it along with the corresponding Principal's reference number").
If Airtable cannot be reached the certificate is still issued, dated today.

## Where the code is

| Piece | File |
|---|---|
| Rules, fields, drawing | `api/_lib/atol-certificate.js` |
| Register | `api/_lib/atol-issue-log.js` |
| The certificate | `POST /api/booking-pdf` with `document: 'atol'` (no Chromium) |
| Does this booking have one? | `/api/retrieve-order` returns `atol: { type, label }` |
| Email attachment | `api/booking-email.js`; the pack note in `public/_booking-email-template.js` (`atolCertificate` option) |
| Button | `public/widget-mybooking.js` 1.15.0, `renderAtolAction`, `_handleAtolDownload` |
| Settings and switches | `public/editor-mybooking.html`, Settings tab, "ATOL certificates"; saved as `config.atol` `{ holderName, atolNumber, flightOnly, packageSingle, packageMulti }` |
| Preview | `POST /api/atol-certificate-preview` (signed in, SAMPLE kept) |
| Templates shipped to the functions | `vercel.json` `includeFiles` on `api/booking-pdf.js` and `api/atol-certificate-preview.js` |

Tests: `npm run test:atol-certificate` (94 checks, including the editor in a
real browser) and `npm run test:order-shape-atol`.

## Not built (yet)

- **Sending the reissued certificate when a booking changes.** The certificate
  always reflects the booking as it stands, with a new reference when its
  details change, and the customer gets it from the page and any later email.
  Nothing pushes it to them the moment an amendment lands.
- The CAA's optional page 2 for Multi-contract, and the Flight-inclusive day
  trip certificate.
- **6 April 2027**: the Package Travel (Amendment) Regulations 2026 abolish
  linked travel arrangements. Watch for new CAA templates around then.
- The exact CAA wording could not be opened from the sandbox. To check it,
  allow `www.caa.co.uk` and `www.atol.org` in the environment's network
  settings. ATOL holders can also ask ATOLOnline@caa.co.uk for the form-field
  versions of the certificates.
