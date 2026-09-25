# Booking confirmation emails

**Started 16 Sep 2026.** Travelgenix pushes us a webhook when a booking is
made, we fetch the booking and email the customer their confirmation with the
A4 pack attached. Travelify used to send this email; we are taking it over,
client by client.

Read this before touching anything under `api/v1/booking-webhook.js`,
`api/v1/booking-confirmations.js`, `api/cron/booking-confirmations.js`,
`api/_lib/booking-confirmations.js` or the block vocabulary in
`public/_booking-email-template.js`.

**Two ways in, one email (25 Sep 2026).** A confirmation can now be asked for in
two ways: the signed Travelgenix webhook each client connects in Travelify (the
original route, below), or a direct request from the Travelify core to
`POST /api/v1/booking-confirmations`, built the way `/api/v1/payment-reminders`
is. Both land in the same table and are sent by the same worker. See **The
direct request** below.

## The decisions, and who made them

Andy, 16 Sep 2026, answering the four questions that changed the shape of the
work:

1. **Travelify keeps its own switch.** "It will be a setting in Travelify as not
   everyone will move over to the new version." So both ends have a switch and
   the changeover is per client. The failure we are guarding against is a
   customer getting two confirmations for one booking, which is why ours is off
   by default twice over (see The two switches).
2. **Per client** — "as the booking gets notified to us". Each client turns it
   on in their own My Booking editor.
3. **New bookings only, to start with.** `order.complete` sends.
   `order.update` and `order.cancel` are accepted and recorded so the
   connection stays healthy and the traffic is visible, then skipped.
4. **The PDF is attached**, as it already is when a customer emails themselves
   their booking.
5. **So is the client's ATOL certificate** (24 Sep 2026), when the client holds
   an ATOL, has switched the certificate on and the booking has a flight they
   sold. `/api/booking-email` asks `/api/booking-pdf` for `document: 'atol'`
   beside the pack, and the pack note says it is attached. A failed certificate
   is logged and the email still goes. See `docs/atol-certificates.md`.

## How it fits together

```
Travelgenix                 us
────────────────────────────────────────────────────────────────────────
order.complete  ──POST──▶  /api/v1/booking-webhook
                            verify signature over the RAW body
                            appid → client
                            already have this booking? → 200 duplicate
                            write one Airtable row → 200 accepted  (<5s)
                            kick the worker
                                    │
                            /api/cron/booking-confirmations  (also every 5 min)
                              fetch the order by id + key
                              is it switched on for this client?
                              work out email + departure date + reference
                              POST /api/booking-email  ← the SAME endpoint a
                                                          customer's own Email
                                                          button uses
                              stamp the row Sent
```

**Why the worker composes nothing.** `/api/booking-email` already retrieves the
order, renders the client's layout, draws the PDF and hands both to SendGrid
with the right sender identity. A confirmation we send off a webhook must be
the same email a customer gets when they press Email, so the worker works out
the three details that endpoint needs and calls it. One send path, whoever
asked for it.

**Why the order is fetched first.** The webhook carries an order id and a
security key but no departure date, and every booking lookup we have takes
email + departure date + reference. The fetch is where those come from.

## The direct request (25 Sep 2026)

Andy: "We did an balance reminder API endpoint and now we want to add similar
functionality for sending the booking confirmation. We need an endpoint that
Darren can post to and then we will send the email." Darren is on the Travelify
side; the contract he builds against is published at
`https://widgets.travelify.io/booking-confirmations-api`
(`public/booking-confirmations-api.html`).

```
Travelify core              us
────────────────────────────────────────────────────────────────────────
"confirm order N" ──POST──▶  /api/v1/booking-confirmations
  X-Api-Key                  key checked before anything else
  { applicationId,           validate; applicationId → client (400 if unknown)
    orderId, orderKey,       write one Airtable row (EventType api.confirmation,
    email? }                   the address in ToEmail)
                             → 202 { status, reference, receivedAtUtc }
                             kick the worker
                                    │
                             the SAME worker, the SAME switches, the SAME send
```

What it shares with the reminders, and where it differs:

| | Payment reminders | Direct confirmation |
|---|---|---|
| Auth | `X-Api-Key` = `PAYMENT_REMINDER_API_KEY` | `X-Api-Key` = `BOOKING_CONFIRMATION_API_KEY`, or the reminder key while that is unset |
| Body | applicationId, orderId, orderKey, reminderType, amountDue, currency, dueDate? | applicationId, orderId, orderKey, email? |
| Sent to | the customer email on the order | `email` when given, else the customer email on the order |
| Unknown application | 400 `Unknown applicationId` | the same |
| A repeat | sends again: the caller decides | sends again: the caller decides |
| Answer | 202 accepted + reference | the same |

**Every request sends (Andy, 25 Sep 2026: "The email confirmation can get sent
multiple times, but you have limited to only send once - this needs
changing").** The first version answered a repeat 409; that is gone. Like the
reminders, the caller decides when a confirmation is wanted, so every accepted
request is a row and an email, a booking already confirmed included (a resend
after an amendment, or for a customer who lost it). Each row still carries the
webhook's own key, `applicationId|orderId|order.complete`, stored rather than
enforced, for audit and for one reason: the WEBHOOK checks it, so a client wired
up both ways does not get an automatic second email from the webhook for a
booking the core has already asked us to confirm. The webhook's own
one-per-push rule is unchanged.

**The address to send to (Andy, 25 Sep 2026: "Darren will send you the email
address to send to - so you need to accommodate that in the API as well").**
The request takes an optional `email`, one plain address. It is stored in the
`ToEmail` field (added to the table the same day) and the worker sends there;
without it, the customer email on the order, as before. The booking is still
looked up by the ORDER's email, departure date and reference, because that is
what `/api/booking-email` finds it by, so an order with no customer email is
still skipped. Order of precedence for the recipient: a test application's
redirect (`BOOKING_CONFIRMATION_TEST_RECIPIENT`), then `ToEmail`, then the
order's email. The send endpoint accepts a recipient other than the booking's
customer only from our own worker (the internal key).

**Everything after intake is unchanged.** `api.confirmation` is a sending event;
the worker fetches the order, checks the global switch, the client's own switch
and the twelve-hour age limit exactly as for a webhook row, and sends through
`/api/booking-email`.

**Testing it end to end: app 250 sends (25 Sep 2026).** Andy: "on App 250, set
it up to send so we can do a full test - please make sure there are no other
blocks to sending". A request or push for app 250 now runs the whole chain AND
emails; see **Testing with the demo application (250)** below for the four
blocks that were taken away.

## The five-second rule

Travelgenix marks a push failed if we have not answered in five seconds. The
endpoint therefore verifies, writes one row and replies. Fetching an order,
drawing a PDF and handing it to SendGrid does not fit in that budget and must
never be attempted on the request. Anything slower belongs in the worker.

## The two switches

Nothing emails anyone until BOTH are on:

| Switch | Where | Who |
|---|---|---|
| `BOOKING_CONFIRMATION_SEND_ENABLED=true` | Vercel env | Andy, once |
| Booking confirmation emails → On | the client's My Booking editor, Settings | per client |

A test application (`BOOKING_CONFIRMATION_TEST_APP_IDS`) and the demo application
(250) pass the first switch; the client's own switch applies to everyone.

While the global switch is off, a real booking still arrives, is fetched and
parked at **Fetched**. That is the state to watch during the changeover: it
proves the whole chain works for a client without a single email leaving.

### Testing with the demo application (250)

**App 250 sends (Andy, 25 Sep 2026: "on App 250, set it up to send so we can do
a full test - please make sure there are no other blocks to sending").** A
booking on the demo application, by the webhook or the direct request, is
fetched AND emailed. Four things stood in the way, and all four are gone:

1. **The worker stopped the demo application at Fetched** ("demo application
   250: fetched, never emailed"), by design from 17 Sep. It is now treated as a
   test application: it sends while `BOOKING_CONFIRMATION_SEND_ENABLED` is off,
   and `BOOKING_CONFIRMATION_TEST_RECIPIENT`, when set, redirects it.
2. **App 250 resolved to the wrong client.** It is held by **two** Clients rows,
   "Travelgenix" (`recRCZl6afFpBFSW6`) and "Travel Demo Tes Ltd"
   (`recZNjh3ME4gOg9F0`), with the same Travelify key.
   `lookupClientCredentialsByAppId` takes the first, which is Travelgenix, and
   only Travel Demo Tes Ltd has a My Booking widget (`My Booking test`,
   `tgw_1777215362250_tlpgd4`), so every row stopped at "client has no My
   Booking widget". The worker now falls through to another Clients row with the
   same App ID that has one (`resolveSiblingClient`), preferring one whose
   confirmations are on. That is general, not a special case for 250.
3. **Confirmations were not switched on** for "My Booking test". Its saved
   config now carries `confirmationEmail: { enabled: true, layout: [] }` (the
   built-in layout), exactly what ticking the switch in its editor writes.
4. **The send endpoint refused a redirected test.** `/api/booking-email` insists
   the booking's customer is a recipient (the guard against a stranger with a
   booking's lookup details mailing it to anyone), so a send to the test inbox
   came back `recipient_mismatch`. Our own worker, identified by
   `TG_INTERNAL_KEY`, may now send elsewhere; a public caller still may not.

What is left is ordinary: the order must carry a customer email, a departure
date and a booking reference, and the request must be processed within twelve
hours. `test:booking-confirmation-api` drives app 250 exactly as it sits in
Airtable (both Clients rows, the widget on the second) with the global switch
off and no test settings, and it sends.

For end-to-end testing before the global flip:

- `BOOKING_CONFIRMATION_TEST_APP_IDS` — comma-separated Travelify App IDs that
  may send while the switch is off.
- `BOOKING_CONFIRMATION_TEST_RECIPIENT` — every email from those apps goes here
  instead of to the real customer.

Both empty by default, so nothing changes for anyone until they are set.

## Setting up a client

1. In **Travelify → Suppliers Directory → CRM, Marketing & Backoffice → Add**:
   - Endpoint URL: `https://widgets.travelify.io/api/v1/booking-webhook`
   - "Specify Custom endpoint": **on**
   - Events: **Order Complete** (Order Update and Order Cancel may be ticked
     too; they are recorded and never emailed)
   - Security Key: the value of `BOOKING_WEBHOOK_SECRET` in Vercel
2. Turn the client's own confirmation **off** in Travelify.
3. In their My Booking editor: Settings → **Booking confirmation emails → On**,
   and build the email under **Customer emails → Booking confirmation**.
4. Make a test booking. Watch the **Booking Confirmations** table
   (`tbl9aTotenNERAKXa`, base `appAYzWZxvK6qlwXK`).

Do 2 and 3 close together. Between them the customer gets two confirmations;
the other way round they get none.

## Env vars

| Name | What it is |
|---|---|
| `BOOKING_CONFIRMATION_API_KEY` | Optional. The `X-Api-Key` for the direct request. While unset, the direct request accepts `PAYMENT_REMINDER_API_KEY`, the key the Travelify core already holds. Set it to give confirmations a key of their own; the reminder key then stops opening this door. |
| `BOOKING_WEBHOOK_SECRET` | The Security Key set on every webhook connection. One platform key today; `resolveWebhookSecret` takes the application id so per-client keys can arrive later without the endpoint changing. |
| `BOOKING_CONFIRMATION_SEND_ENABLED` | `true` to let emails leave. |
| `BOOKING_CONFIRMATION_TEST_APP_IDS` | App IDs that may send while the above is off. |
| `BOOKING_CONFIRMATION_TEST_RECIPIENT` | Redirect address for those apps. |
| `TG_INTERNAL_KEY` | Already set. Lets the worker through `/api/booking-email`'s per-visitor rate cap. |
| `CRON_SECRET` | Already set. Guards the worker and the endpoint's kick. |

## Things that will bite you

- **The signature covers the RAW bytes.** `config.api.bodyParser = false` and
  we read the stream ourselves. Re-serialising the parsed JSON changes the
  whitespace and never verifies. Do not "tidy" that.
- **The order fetch by id + key** (`fetchOrderByIdKey` in
  `api/_lib/payment-reminders.js`) is the one piece of the Travelify contract
  never confirmed against a live call. It is isolated in one function, and it is
  what the first real test booking proves. If it turns out to be wrong, that is
  a one-line change.
- **An unknown application gets 200, not 500.** A 500 makes Travelgenix retry a
  message that can never be processed and eventually mark a healthy connection
  failed.
- **appid 100 is not the demo app.** Every sample payload in the webhook
  documentation uses it, but the platform's demo application is 250
  (`DEMO_APP_ID`). Treating 100 as a demo would silently swallow every
  confirmation for a real client holding that App ID.
- **A booking date is a calendar date.** `departureDateOf` takes the first ten
  characters of `2027-02-03T00:00:00` rather than parsing it, because parsing
  reads it in the server's zone and hands back the day before for anyone behind
  UTC. See the rule in CLAUDE.md.
- **A push older than twelve hours is skipped**, not retried. A queue drained
  late must not become a surprise email about a trip already taken.

## The email itself

The confirmation is an ordered list of blocks (`EMAIL_BLOCKS` in
`public/_booking-email-template.js`), arranged by the client in the My Booking
editor. The editor builds its palette from that same export, so a block cannot
exist in one and not the other. An empty, missing or unrecognisable layout
falls back to the built-in one, which is byte-for-byte the email we have always
sent.

### Starter styles (17 Sep 2026)

Andy, having been shown four mockups: "i liked them all please". So
`EMAIL_STYLES` carries four layouts a client can start from, and the editor's
layout builder shows them as a "Start from" row above the list:

| Style | What it is |
|---|---|
| Standard | The built-in layout. Everything in one summary card, no pictures. |
| Postcard | Opens on a full-width picture of the destination, then the details. |
| Magazine | Picture, the hotel on its own card, then the destination write-up, three things to do, what is on and the facts strip. |
| Itinerary | Everything on one timeline in the order it happens, practical bits underneath. |

Picking one REPLACES the layout. It is a starting point, not a theme that keeps
applying, and once there is something to lose the editor asks first (through its
own modal, via the field's `confirmStyle` hook, not `window.confirm`). Because
Standard IS `DEFAULT_EMAIL_LAYOUT`, there is no separate "copy ours in" link:
one list, one way to it.

### The blocks the styles are built from

Seven blocks were added with the styles, and they follow one rule: **a block
with nothing to say says nothing.** A client can pick Magazine for a hotel with
no photograph and a destination we hold no content for, and gets a shorter email
rather than a row of empty boxes. `test:confirmation-blocks` asserts both halves
of that, block by block.

- `hero` — full-width picture with the destination and dates on a band beneath.
  Takes an optional `url`; otherwise it uses the hotel photo, then a destination
  photo. It names the destination our content base knows ("The Maldives") in
  preference to the airport city the supplier filed the hotel under ("Male").
- `hotelcard` — the property with its photo, star rating, room and board. Room
  and board come from `roomLabel()` and `boardLabel()` in
  `public/_order-stays.js`, the same answers the My Booking page gives, so a
  booking cannot read one way on the page and another in the email.
- `itinerary` — flights, transfers, check-ins and tickets on one timeline. Sorted
  with `bookingMoment`, and a leg with no clock on it (a check-in is a date, not
  an instant) sorts to the END of its day — at midnight it sorted above the
  flight that gets you there, which is what it did on the first run.
- `destination`, `knowbefore`, `whatson`, `thingstodo` — read `opts.destination`,
  the pack in the shape `/api/destination-content` returns. The renderer is
  runtime-neutral and cannot look anything up, so the caller passes it in.
- `upsell` (24 Sep 2026) — "Add to your trip", the things the customer could add
  to this booking. Reads `opts.upsell`, the tiles `/api/retrieve-order` has
  ALREADY built for the My Booking page, links and all: `api/booking-email.js`
  passes `retrieveData.upsell` straight through and works nothing out itself.
  Travelify's upsellsActive spec asks for the same upsells in the email as on
  the page, and handing over the page's own list is the only way that is true
  by construction. The rules live in `public/_order-upsell.js`; every link ends
  `&orderRef={id}/{key}`. **In `DEFAULT_EMAIL_LAYOUT` and all four starter
  styles**, just before `support` (Andy, 24 Sep 2026, reversing the 16 Sep
  "never change the default" rule for this one block). A booking with nothing to
  offer still gets the email we have always sent, which `test:confirmation-blocks`
  checks. A client who had already SAVED their own layout keeps it exactly as
  they arranged it; the block is in their palette to add.

### Where the destination pack comes from

`api/_lib/booking-destination.js` resolves it on the server. A Travelify order
carries no destination slug, only whatever the supplier filed the products
under, so it builds a candidate list most specific first — hotel state (usually
the resort), hotel city, tickets city, transfer dropoff, then the country — and
tries each through `lookupDestination()` in `api/destination-content.js`. That
is the same `resolveSlug` walk, the same `shapePayload` and the same memory
cache the public endpoint uses; the HTTP slug mode is scoped to a Spotlight
widget's lookup order, and a confirmation email has no widget to scope to, so
the export takes the order directly and defaults to the same
`resort -> city -> country`.

Three rules it keeps:

- **A country code is not a name.** Travelify files country as `MV` on one
  booking and `Maldives` on another. A code is turned into a name, and a code we
  cannot name is DROPPED rather than guessed at — including `ZZ`, which CLDR
  answers with the literal "Unknown Region".
- **Only a layout that uses the pack pays for it.** `layoutWantsDestination()`
  is checked before any lookup, so every client on the built-in layout (and on
  Standard) costs nothing at all.
- **Nothing here can lose a confirmation.** No credentials, no match, an error
  or a slow Airtable all mean no pack, and the blocks then draw nothing. There
  is a 2.5 second ceiling on the whole resolution, because the webhook has five
  seconds to answer and the worker sends inside it.

The editor preview passes a sample Dubai pack (`MOCK_DESTINATION` in
`editor-mybooking.html`) alongside the sample booking, so a client picking
Magazine sees what those blocks do.

## Tests

| Command | What it holds |
|---|---|
| `npm run test:booking-webhook` | The published payloads, the signature, the endpoint's answers, and every reason the worker does or does not send. |
| `npm run test:booking-confirmation-api` | The direct request: the key, the body, the 202, every repeat sending (with no lookup made to refuse it), the webhook still not adding a second email for a booking the core confirmed, the worker sending it like a webhook row, and the published page matching the code. |
| `npm run test:confirmation-blocks` | The block vocabulary, the four starter styles, and that every block draws from a booking that has its material and draws nothing from one that does not. |
| `npm run test:confirmation-layout` | The layout builder in the editor, driven for real. |
| `npm run test:booking-email-drift` | One renderer for the preview and the send. |
| `npm run test:payment-reminders` | The pipeline this one reuses. |
| `npm run test:booking-destination` | The destination lookup: the candidate order, that only a layout needing it pays for it, and that nothing in it can lose an email. |
| `npm run test:order-stays-drift` | Among other things, that the board-basis list in the widget and the one in `_order-stays.js` have not drifted apart. |

## Still to do

- The first real test booking, which is what proves the id + key order fetch,
  and with it the first real destination lookup. The candidate order is a
  reasonable guess from the fixtures; a real Maldives or Dubai booking will show
  whether the hotel's `state` really carries the resort.
- Decide whether `order.cancel` should send the cancellation email we already
  have a renderer for. Andy asked for new bookings first; the rows are being
  recorded either way, so the traffic will be there when we want it.
