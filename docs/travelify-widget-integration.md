# Travelify widget platform integration

**Status:** built, not yet live. Waiting on one environment variable and one
answer from Travelify.
**Started:** 14 Sep 2026
**Spec:** "Widget platform integration API specification", supplied by Travelify.
**Airtable record:** `recm4J71rCjUs9MU2`

## What this is

Travelify has its own Widget Directory and My Widgets pages. Until now the only
route to our widget platform was More Tools, which SSO'd the user onto our
dashboard homepage and left them to find their own way. This work merges our 56
widgets into Travelify's existing lists so the user sees one combined set, and
lets a click on one of our widgets land them straight in its editor.

Three touchpoints, all keyed on the same `widgetId`:

1. `GET /api/v1/applications/{applicationId}/widget-directory`
2. `GET /api/v1/applications/{applicationId}/my-widgets`
3. `GET /api/auth/sso?ssotoken=...&widgetId=<slug>`

Travelify's backend calls the two read endpoints server to server and renders
the results itself. It holds no widget data of its own for us, so every field it
shows comes from these responses.

## Before this can go live

**Set `TRAVELIFY_PLATFORM_API_KEY` in Vercel** (Production and Preview) to the
shared secret agreed with Travelify, and have them store the same value in their
Azure Key Vault. Until it is set, both endpoints return 500 and log
`TRAVELIFY_PLATFORM_API_KEY is not configured`. They refuse rather than fall
open on purpose.

## Authentication

Every request carries the shared secret in an `X-Api-Key` header. One secret for
the whole integration, not per user and not per application. The comparison is
constant time. Once the key validates the caller may ask about any Application
ID, so the only remaining check is that the application exists.

The key must never reach a browser. These are backend-to-backend endpoints.

## Application ID

Travelify's Application ID is our `Travelify App ID` on the Clients table, which
already exists, is already unique, and is already the value the SSO reads from
the JWT's `primarysid`. No new identity mapping was needed.

A client row is created the first time somebody signs into the widget platform
through SSO. An application Travelify knows about that has never signed in here
has no row, so it returns **404**. That is deliberate (Andy, 14 Sep 2026): we
cannot filter a directory by plan until SSO has told us what plan they are on.
**Travelify should treat a 404 as "not set up yet" and show its existing More
Tools SSO link**, rather than as an error. The first sign-in provisions the
client and the directory works from then on.

## Endpoint 1: widget directory

Returns every widget the application is entitled to use. Entitled means both:

- the widget is included in the client's plan (Spark / Boost / Ignite /
  Bespoke), and
- the widget is released, not coming-soon.

Andy's call (14 Sep 2026): show only what they can actually have. The contract
has no field to mark a widget as locked, and our save API gates on plan, so
listing a widget they cannot create would walk them into a refusal inside our
editor.

```json
{
  "applicationId": 12345,
  "widgets": [
    {
      "widgetId": "faq",
      "name": "FAQ Accordion",
      "category": "Content",
      "description": "Beautiful, searchable FAQs in four layouts ...",
      "imageUrl": "https://widgets.travelify.io/previews/faq.png"
    }
  ]
}
```

Carries an `ETag` and `Cache-Control: private, max-age=300`. A conditional
request with `If-None-Match` gets a 304.

## Endpoint 2: my widgets

Same shape plus `instanceCount`, and only widgets with at least one configured
instance. Not filtered by plan or release status: this answers "what have they
got", not "what may they add", so a widget installed before a plan change still
appears with its manage link.

Counts come from the same scope rule the client's own dashboard uses
(`buildScopeFormula`, exported from `api/widget-list.js`), including their
legacy widgets, which predate the `ClientRecordId` owner field. Roughly a
quarter of all widgets are legacy, so restating the rule here would have made
Travelify's count disagree with ours.

`Cache-Control: private, max-age=30`, since it changes whenever someone adds a
widget.

## Errors

```json
{ "error": { "code": "invalid_application", "message": "Application 12345 was not found." } }
```

| Status | Code | When |
|--------|------|------|
| 400 | `invalid_application_id` | Not an integer of 1 to 10 digits |
| 400 | `https_required` | Reached us over plain HTTP |
| 401 | `invalid_api_key` | Key missing, malformed or wrong |
| 404 | `invalid_application` | Valid integer, no such client here |
| 405 | `method_not_allowed` | Anything but GET |
| 429 | `rate_limited` | Over 600 calls per 15 minutes per key |
| 500 | `server_error` | Anything unhandled, or the key is not configured |

No widget data ever accompanies an error, and no internal record id or stack
trace reaches the message.

## SSO deep link

`widgetId` is optional and additive. Present and valid, the user lands on that
widget's editor. Absent, behaviour is exactly as before and they land on the
dashboard. Unknown, or not included in their plan, they land on the dashboard
rather than seeing an error, so a stale link in Travelify's directory can never
block a sign-in.

**No signature change is needed on Travelify's side.** Our SSO signs the JWT
only; `next` and `widgetId` are ordinary query parameters outside the signed
payload.

The deep link starts a **new** widget of that type (Andy, 14 Sep 2026), which is
what `/editor-<tag>` with no `?id=` does.

Open-redirect safety: `widgetId` is resolved only against the widget registry,
and the path we redirect to is the registry's own `editorUrl`. Nothing from the
query string is ever echoed into the `Location` header. The test suite pins this
against absolute URLs, protocol-relative URLs, traversal and encoded paths.

## Categories

Travelify filters its directory by exact string match against its own controlled
list, so every widget we expose carries exactly one of those strings. Our
dashboard categories are a different taxonomy and only "Content" appears in
both, so `api/_lib/widget-public-categories.js` maps each widget id to a
Travelify category. The dashboard keeps its own categories.

Current distribution:

| Travelify category | Widgets |
|---|---|
| Travel | 25 |
| Content | 9 |
| Other Tools | 8 |
| Forms | 6 |
| Reviews | 2 |
| Travel Quotes | 2 |
| Chat, E-Commerce, Social, Video | 1 each |
| Audio | 0 |

**Open with Travelify:** their list has no home for our Bookings (9 widgets) or
Events (7) families, so both currently land in Travel, which now holds 25 of the
56. We have asked them to add `Bookings` and `Events` to their filter tabs. If
they agree, move those ids in the map and add the two strings to
`TRAVELIFY_CATEGORIES`. Nothing else changes.

## Preview images

The contract requires an absolute HTTPS `imageUrl` per widget and we had no
preview art, so we screenshot the live mini previews the dashboard already
renders for every widget and commit the results to `public/previews/<id>.png`
at 1400x680.

```bash
node scripts/serve-public.mjs --port 8123          # static server, /api passed through to production
npm run build:widget-previews -- --base http://127.0.0.1:8123
```

Serving locally and proxying `/api` upstream is deliberate: the data-backed
widgets (offers, events, spotlight) need real content to photograph well, and a
headless browser pointed straight at the deployed site loses its connection
behind a policy proxy.

Two widgets cannot be photographed. Prayer Times fetches a third-party API
directly from the browser, and the Loader is an animation that catches as an
almost empty frame. The generator measures ink coverage and substitutes a
branded card (the widget's own icon and colour, matching the dashboard's
"Coming Soon" placeholder) for anything under 1.2%. That is automatic, so any
future widget that will not photograph gets a decent tile rather than a blank
one.

## Files

| File | What |
|---|---|
| `api/v1/applications/[applicationId]/widget-directory.js` | Endpoint 1 |
| `api/v1/applications/[applicationId]/my-widgets.js` | Endpoint 2 |
| `api/_lib/v1/platform-api.js` | Shared key auth, error envelope, app lookup, caching, audit log |
| `api/_lib/v1/widget-view.js` | Registry entry to contract object, plan gating |
| `api/_lib/widget-registry.js` | GENERATED from `public/index.html` |
| `api/_lib/widget-public-categories.js` | Widget id to Travelify category (hand-maintained) |
| `api/_lib/widget-catalogue-status.js` | Shared live / coming-soon read, extracted from `api/widget-catalogue.js` |
| `scripts/build-widget-registry.mjs` | Regenerates the registry |
| `scripts/generate-widget-previews.mjs` | Regenerates the preview images |
| `scripts/serve-public.mjs` | Local static server with `/api` passthrough |
| `public/previews/*.png` | 56 preview images |

## Adding a widget after this

The five places in CLAUDE.md still apply, plus:

1. `npm run build:widget-registry`
2. Add the widget to `api/_lib/widget-public-categories.js`
3. `npm run build:widget-previews -- --only <id>`

`npm run test:travelify` fails on any of the three being missed, and also fails
if a widget's editor path has no rewrite in `vercel.json`, which would 404 a
deep link straight after a successful sign-in.

## Tests

```bash
npm run test:travelify              # 104 checks across both suites
npm run test:widget-registry-drift  # generated registry is current
```

The behavioural suite drives the real handlers against a mocked Airtable and
pins every acceptance criterion in the spec, including that a bad key returns
401 **with no widget data**, that the directory never offers a widget the save
API would refuse, and that all three touchpoints describe a widget identically.

## Decisions locked (Andy, 14 Sep 2026)

- Preview images come from the dashboard's existing mini previews.
- Map onto Travelify's controlled category list as written, and separately ask
  them for `Bookings` and `Events`.
- The directory shows only what the client's plan includes.
- The deep link starts a new widget.
- An unrecognised Application ID means they have not signed in yet, so they go
  through the existing SSO first.

## Still open

- `TRAVELIFY_PLATFORM_API_KEY` needs setting in Vercel and sharing with
  Travelify.
- Travelify to confirm whether they will add `Bookings` and `Events` categories.
- Travelify to treat a 404 as "not set up yet" and fall back to their More Tools
  SSO link.
- Widget descriptions are the dashboard's own copy and some contain em dashes,
  which are against our brand voice. They now appear on a partner platform, so
  they are worth a pass.
