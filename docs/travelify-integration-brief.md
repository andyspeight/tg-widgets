# Travelgenix widget platform: integration brief for Travelify

**For:** Darren, Travelify
**From:** Travelgenix
**Date:** 14 September 2026
**Against:** your "Widget platform integration API specification"

Everything in your spec is built. This brief is what you need to consume it,
plus two things we would like your answer on and answers to the open assumptions
you listed.

Nothing is live yet. The one thing standing between here and live is the shared
API key, covered under "Go live checklist" at the end.

## Base URL

```
https://widgets.travelify.io
```

`https://tg-widgets.vercel.app` is the same platform and works too, but please
use the `widgets.travelify.io` form.

All endpoints are HTTPS only, TLS 1.2 or higher. Plain HTTP is refused.

## Authentication

Every request carries the shared secret in an `X-Api-Key` header.

```
X-Api-Key: <the shared secret>
```

One secret for the whole integration, not per user and not per application, as
you specified. We compare it in constant time. A missing, malformed or
unrecognised key returns `401` and no widget data.

Once your key validates we trust the caller, so you may request any Application
ID. We still check that the application exists.

Please keep these calls backend to backend. The key must never reach a browser.

## Application ID

Your Application ID maps to a field we already hold against each client, and it
is the same value your SSO already sends us as `primarysid`. No new identifier
was needed on either side.

One thing to know: a client record only exists on our platform once somebody has
signed in through the existing SSO at least once. An application you know about
that has never signed into the widget platform returns `404`. See "Two things we
need from you" below, because this changes what your UI should do with a 404.

## Endpoint 1: widget directory

```
GET /api/v1/applications/{applicationId}/widget-directory
```

Every widget the application is entitled to use, installed or not.

```json
{
  "applicationId": 12345,
  "widgets": [
    {
      "widgetId": "faq",
      "name": "FAQ Accordion",
      "category": "Content",
      "description": "Beautiful, searchable FAQs in four layouts — accordion, two-column, tabs, or searchable. Markdown answers, categories, SEO schema built-in.",
      "imageUrl": "https://widgets.travelify.io/previews/faq.png"
    },
    {
      "widgetId": "spotlight",
      "name": "Destination Spotlight",
      "category": "Travel",
      "description": "Editorial destination showcase in three layouts: the full guide with climate chart and highlights, an essentials strip to sit under your own hero, and a card for sidebars. Live from the Travelgenix destination content database and updated as content is refreshed.",
      "imageUrl": "https://widgets.travelify.io/previews/spotlight.png"
    }
  ]
}
```

| Field | Type | Always present | Notes |
|---|---|---|---|
| `widgetId` | string | yes | Stable URL-safe slug. The same value across all three touchpoints |
| `name` | string | yes | Display name |
| `category` | string | yes | Exactly one value from your controlled list |
| `description` | string | yes | Plain text |
| `imageUrl` | string | yes | Absolute HTTPS, 1400x680 PNG, safe to render directly |

**Entitled** means two things on our side: the widget is included in the client's
plan, and the widget is released rather than still in development. We
deliberately do not send widgets the client cannot create. Our save API enforces
plan limits, so listing one would let a user click through and then hit a refusal
inside our editor. Your contract has no field to mark a widget as locked, so
withholding it is the only way to avoid that dead end.

A valid application entitled to nothing returns `200` with an empty `widgets`
array. The full list comes back in one response, no pagination.

## Endpoint 2: my widgets

```
GET /api/v1/applications/{applicationId}/my-widgets
```

Same shape plus `instanceCount`, and only widgets with at least one configured
instance.

```json
{
  "applicationId": 12345,
  "widgets": [
    {
      "widgetId": "enquiry",
      "name": "Enquiry Form",
      "category": "Forms",
      "description": "Custom enquiry forms your clients actually fill in — 13 travel-native fields (destinations, airports, travellers with ages, board basis, star rating, budget slider), drag-and-drop builder, branded thank-you, and routing to email, Google Sheets, webhooks and your CRM.",
      "imageUrl": "https://widgets.travelify.io/previews/enquiry.png",
      "instanceCount": 12
    }
  ]
}
```

`instanceCount` is always 1 or more, since only installed widgets appear. The
count matches what the client sees in their own Travelgenix dashboard, including
older widgets created before we introduced our current ownership field.

This response is deliberately NOT filtered by plan. It answers what they have,
not what they may add, so a widget installed before a plan change keeps its
manage link rather than vanishing.

Nothing installed returns `200` with an empty array.

The full field set is returned even though you only render name, icon and count
today, so you can surface more later without us changing anything.

## Errors

```json
{
  "error": {
    "code": "invalid_application",
    "message": "Application 12345 was not found."
  }
}
```

| Status | `code` | When |
|---|---|---|
| 400 | `invalid_application_id` | Not an integer of 1 to 10 digits |
| 400 | `https_required` | Request arrived over plain HTTP |
| 401 | `invalid_api_key` | Key missing, malformed or unrecognised |
| 404 | `invalid_application` | Valid integer, but no such application on our side |
| 405 | `method_not_allowed` | Anything other than GET |
| 429 | `rate_limited` | Over the rate limit, with `Retry-After` |
| 500 | `server_error` | Anything unhandled |

No widget data ever accompanies an error, and we never put an internal
identifier or a stack trace in `message`.

## SSO deep link

Add an optional `widgetId` to the SSO request you already make:

```
GET /api/auth/sso?ssotoken=<JWT>&widgetId=faq
```

- Present and valid: the authenticated user lands on that widget's page.
- Absent: exactly the behaviour you have today, landing on the homepage.
- Unknown, or not included in the client's plan: the user lands on the homepage.
  No error, so a stale identifier in your directory can never block a sign in.

`widgetId` takes the same value the two endpoints return.

We resolve it only against our internal widget route map, so an arbitrary path or
URL passed through this parameter cannot redirect anywhere. That is covered by
tests against absolute URLs, protocol-relative URLs, traversal and encoded paths.

The link starts a new widget of that type, which is the behaviour we want from a
directory click.

## Caching and limits

| | Directory | My widgets |
|---|---|---|
| `Cache-Control` | `private, max-age=300` | `private, max-age=30` |
| `ETag` | yes | yes |

Both endpoints honour `If-None-Match` and answer `304` when your copy is current,
so revalidation is cheap. The directory is close to static per application, so
please do cache it. My widgets changes whenever a user adds a widget, hence the
tighter window.

Rate limit is 600 requests per 15 minutes per key, returning `429` with
`Retry-After`. Tell us if that is tight for your traffic and we will raise it.

We log every call with Application ID, endpoint and outcome for support. We never
log the key.

## Categories

Every widget carries exactly one value from your controlled list, matched exactly
so you can bucket into your existing tabs with no translation layer. `All
Widgets` is never returned.

Here is where all 56 of our widgets currently land.

**Travel** (25)

| widgetId | Name |
|---|---|
| `airport` | Airport Spotlight |
| `attraction` | Attraction Spotlight |
| `clubpicker` | Club Picker |
| `currency` | Currency Converter |
| `dealbar` | Deal Bar |
| `carousel` | Destination Carousel |
| `spotlight` | Destination Spotlight |
| `tour` | Escorted Tour |
| `eventmenu` | Event Menu |
| `tickets` | Event Tickets |
| `flighttime` | Flight Time & Distance |
| `trips` | Group Trips |
| `maps` | Maps |
| `mybooking` | My Booking |
| `nextevent` | Next Event |
| `prayer` | Prayer Times |
| `special-offers` | Special Offers |
| `ticketmonth` | Ticket Month |
| `ticketsearch` | Ticket Search |
| `offers` | Travel Offers |
| `tti-offers` | TTI Offers |
| `venueguide` | Venue Guide |
| `weather` | Weather |
| `worldclock` | World Clock |
| `worldmap` | World Map |

**Travel Quotes** (2)

| widgetId | Name |
|---|---|
| `quote-pdf` | Quote PDF |
| `travel-results-ai` | Travel Results AI |

**Reviews** (2)

| widgetId | Name |
|---|---|
| `reviews` | Reviews |
| `testimonials` | Testimonials |

**E-Commerce** (1)

| widgetId | Name |
|---|---|
| `pricing` | Pricing Table |

**Chat** (1)

| widgetId | Name |
|---|---|
| `whatsapp` | WhatsApp Chat |

**Forms** (6)

| widgetId | Name |
|---|---|
| `appointment` | Appointment Scheduler |
| `enquiry` | Enquiry Form |
| `enquirypro` | Enquiry Pro |
| `form` | Form |
| `newsletter` | Newsletter Signup |
| `popup` | Popup |

**Social** (1)

| widgetId | Name |
|---|---|
| `share` | Social Share |

**Content** (9)

| widgetId | Name |
|---|---|
| `event-calendar` | Event Calendar |
| `faq` | FAQ Accordion |
| `logos` | Logo Showcase |
| `prism` | Prism |
| `rss` | RSS News Feed |
| `smartsection` | Smart Section |
| `statscounter` | Stats Counter |
| `team` | Team Showcase |
| `textfx` | Text FX |

**Video** (1)

| widgetId | Name |
|---|---|
| `youtube` | YouTube |

**Audio** (0)

_Nothing in this category today._

**Other Tools** (8)

| widgetId | Name |
|---|---|
| `backtotop` | Back to Top |
| `contact` | Contact Card |
| `consent` | Cookie Consent |
| `countdown` | Countdown Timer |
| `emailsig` | Email Signature |
| `loader` | Loader |
| `hours` | Opening Hours |
| `spinwheel` | Spin the Wheel |

## Two things we need from you

**1. Please consider adding `Bookings` and `Events` to your category list.**

As you can see above, 25 of our 56 widgets land in `Travel`. That is because your
list has no home for two families that are distinct products for us: nine booking
and quoting widgets, and seven event ticketing widgets built on a supplier event
feed. Bucketed as they are, our suite reads as one big undifferentiated `Travel`
pile in your directory, which undersells it and makes the tab hard to browse.

If you add the two categories we can move those widgets over in minutes, and it
needs no change to the contract. If you would rather not, everything works as it
stands and we will leave it.

**2. Please treat a `404` as "not set up yet" rather than an error.**

This is the one place we have deviated from your spec, and it follows from how
provisioning works. A client only exists on our platform after their first SSO
sign in, which is also what tells us their plan. Without a plan we cannot decide
what they are entitled to, so we cannot return a meaningful directory.

So for an application we have never seen, the useful thing for your UI to do is
show your existing More Tools SSO link rather than an error or an empty state.
The first sign in provisions them, and from then on both endpoints work normally.

## Your open assumptions, answered

**"The existing SSO mechanism can carry one extra parameter without a signature
or contract change."** Confirmed, it can. Our SSO signs the JWT only. `next` and
now `widgetId` are ordinary query parameters outside the signed payload, so you
need no change to what you sign.

**"Confirm whether the new platform already has a stable public identifier per
widget type."** It does, and it predates this work. All 56 are unique, lowercase
and URL safe, and they are already the public key for each widget type on our
side. The list above is the complete set. They are stable, so you can store them.

**"Whether any widget legitimately needs more than one category at launch."** No.
Every widget has one clear best category, so a single-value `category` is right
for v1. The only tension is the bucketing question above, which more categories
would solve better than multiple categories per widget.

## Go live checklist

1. **Generate the shared secret and send it to us securely.** We will hold it in
   our Vercel environment, you in your Azure Key Vault. Until it is set our
   endpoints return `500` by design, because they refuse rather than fall open.
2. We deploy. The endpoints and the preview images go live together.
3. You point a test call at a real Application ID for a client who has signed
   into the widget platform before, and confirm both shapes.
4. You confirm the 404 behaviour in your UI, per item 2 above.
5. Let us know on the category question whenever suits.

Any questions, or anything in the shapes you want changed, just say. Adding
fields is non breaking, so `iconUrl`, `isInstalled` and `sortOrder` can all
arrive within v1 whenever you want them.
