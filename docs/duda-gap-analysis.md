# The Duda gap analysis (tg-sites, platform level)

**Written 23 Aug 2026. Read `duda-element-audit.md` first if the question is
about ELEMENTS: that audit is closed and this document deliberately does not
repeat it.**

Andy asked for a full gap analysis between us and Duda. The element audit closed
on 21 Aug with every Duda category built, so the answer to "what are we missing"
is no longer a list of elements. It is three things underneath them: how fast a
page arrives, where its content comes from, and what runs across a whole site.

A rendered version of this, with the comparison matrix, is published at
https://claude.ai/code/artifact/3af43bb5-ee83-4474-bbf5-f24d33de06c8

---

## The short version

On what a client can put on a page we are at parity: 53 blocks, every Duda
element category checked off, and a motion layer Duda has no answer to. On what
happens around the page we are behind in three places, and each has a business
consequence rather than a feature-list consequence.

1. We ship one large photograph to every device. Duda ships a resized WebP per
   screen.
2. Collections can only be typed in by hand, so the travel data that is our whole
   advantage reaches a page through a client-side widget and is invisible to
   Google and to the AI engines.
3. Seven widgets that belong across a whole site have nowhere to live, one of
   which is the cookie banner a site with Google Analytics switched on is
   expected to have.

Everything else Duda sells and we do not (the store, memberships, white label,
client billing) is a decision already recorded rather than a gap.

---

## The gaps that are real, ranked by what they cost us

### 1. Every device gets the same large photograph

`lib/media/downscale.ts` shrinks an upload in the browser to about 2400px, which
stops a six-megabyte phone photo reaching a visitor. After that, nothing. Each
image is a plain `<img>` with `loading="lazy"`, one file, one size, no `srcset`
and no WebP, so a 390px phone downloads the 2400px file. The renderer says so
itself at `components/render/blocks.tsx:763`: the media pipeline with its own
variants lands in a later package, and that package has not landed.

The hero photograph on a travel homepage is also its Largest Contentful Paint, so
this is the biggest measurable difference between the platforms on the exact
metric Google ranks on, in the same week we shipped the rest of that story.

Also relevant: `app/site/[host]/[[...path]]/page.tsx:71` sets `force-dynamic`, so
published HTML is never CDN-cached either.

Duda: WebP by default, per-device resizing, lazy loading, CSS minified and
non-critical CSS deferred, critical assets preloaded, CDN. They claim 82% of
Duda sites pass all three Core Web Vitals (their figure, May 2025).

In our favour: a published page ships no JavaScript for its content at all, so we
start ahead on the interaction metrics. The gap is bytes, not scripts.

### 2. Collections can only be filled in by hand

Collections already do the hard part: fields declared and typed, items generating
their own pages, cards reading declared fields, and as of this week filtering and
sorting. What is missing is any way to fill one from outside.

Duda connects a collection to an endpoint URL or an Airtable base, maps the field
types and re-syncs hourly by default, then generates one page per row. Restricted
to their Custom plans.

**This is the strategic one.** Travel data is the advantage and today it reaches a
page through a widget, which is a script, so a crawler and an AI engine see an
empty container where the tours are. Feed the same supplier data into a collection
and every tour becomes a server-rendered page in the client's own design, with its
own structured data, its own sitemap entry and its own line in llms.txt. That
turns the thing we are best at from invisible into indexable, and it is the
natural next move after the SEO and AEO work of 21 to 23 Aug.

### 3. Seven site-wide widgets have nowhere to live

`lib/content/widgets.ts` offers 38 widgets and names eight it deliberately
excludes: Back to Top, Loader, Popup, Cookie Consent, WhatsApp Chat, Deal Bar,
Smart Section and Email Signature. The reasoning is sound and written down, and
it also says what should happen instead: they want a site-wide setting, and that
is a different job. The different job has not been done.

**Cookie Consent is the sharp end.** `lib/settings/schema.ts` accepts a GA4
measurement id and a GTM id, so a client can switch on visitor tracking today,
and there is no consent mechanism anywhere in the product. For a UK travel
business that is PECR and UK GDPR territory.

The workaround should not count: `headHtml`/`bodyHtml` can carry a consent script
but is owner-or-staff only, so a client on the content-only permission preset
cannot reach it, and pasting a script into a settings box is not a product.

Cheapest item on the list by a distance. The widgets are built and tested; what is
missing is one settings panel.

### 4. Personalisation, where we could beat them rather than match them

Duda pairs a trigger (time and date, visit count, geolocation, device, campaign
URL, and language on multilingual sites) with an action (popup, notification bar,
injected content, seasonal effect). We have none of it.

The interesting part is how theirs works. Duda's own documentation says the
content is added through JavaScript after the page has loaded, and a rule re-fires
at most once every thirty minutes. That means a flash of the default page, and
nothing a crawler will ever see.

Our published pages already render on the server for every request, so we could
resolve location, device, campaign and time before a byte is sent and ship one
correct document with no client JavaScript and no flash. The rule vocabulary is
designed already in `public/tgse-rules.js` (`evaluate`, `armTrigger`).

Check before building: server-side personalisation and HTTP caching pull against
each other. We do not cache published HTML today so the cost is already paid, but
that is exactly what makes gap 1 harder. Decide the two together.

### 5. One language per site (ask Andy first)

Settings carry a single `locale`. Duda offers 55+ languages with editable
automatic translations, plus a language trigger in personalisation.

Honest read: worth nothing to most of our clients and everything to a few. A UK
agency selling UK-outbound needs one language. An agency selling into Ireland,
Wales or a European source market needs routing, hreflang, translated collections,
translated navigation and per-locale SEO. Large build on a hunch. Wait for a real
client asking, then scope against that client rather than against Duda's number.

### 6. No way to put a page behind a login

Duda sells membership plans, free or paid, with pages gated per plan. Our auth is
for people who edit a site, never for people who visit it.

The most valuable travel use is answered already and answered better: the My
Booking widget looks a traveller's booking up against Travelify rather than asking
them to keep a second password for their travel agent's website. Revisit only if a
client asks for gated content that is not a booking.

### 7. The client never hears what their site did

Duda sends clients scheduled emails carrying site performance. We store a GA4 id
and stop there.

Most of this is assembly, not new capability: the SEO audit engine scores a site,
form submissions are stored and listed on Enquiries, the activity log knows what
changed and the publish history knows when it went live. A monthly note is a query
and a template on top of four things that exist, and it is the item a client is
most likely to actually notice.

### 8. Version history covers a page, not a site

Every publish writes the whole page into `publish_events` and a rollback reads
that log back through `parsePage` and `sanitisePage`. For "somebody published
something wrong on Tuesday and wants Monday back" that beats a nightly backup.

Two things it does not do: restore a whole site to a point in time, and capture a
draft that was never published. Duda runs automatic backups instead, which is
worse at the first and better at the second. Small enough to leave, but worth
knowing which question we can answer.

---

## Decided, not missing

A naive comparison files these as gaps. Each has a decision with a date and a
place it is written down. Re-open them if the business changes, not because
Duda's pricing page lists them.

- **Billing and self-serve signup.** PRODUCT.md, Andy, 17 Aug 2026: no billing and
  no self-serve onboarding, everyone is a managed client.
- **White label and reseller.** Duda's $149 tier exists so an agency can pretend it
  built the platform. Travelgenix IS the agency. Only a question if we ever sell
  the CMS to other agencies.
- **eCommerce, bookings and apps.** Written into `lib/auth/permissions.ts`: the
  capability list is mapped to what tg-sites actually has, "so Duda's eCommerce,
  bookings and apps are not here". Booking is what Travelify does.
- **An app store.** We run a closed allowlist, a sealed frame for third-party
  embeds and a parser-backed sanitiser admitting scripts only from our own widget
  origin. That is why a travel agent can add a widget without raising a ticket. A
  bet rather than an omission, though Duda generating custom widgets from a prompt
  (July 2026) is worth watching.
- **Thirteen Duda elements**, skipped on Andy's word 20 to 21 Aug. Listed in
  `duda-element-audit.md`. Facebook Feed is the one still open.

---

## Where we are ahead

- **Motion.** PRODUCT.md says it outright: motion on a client homepage is a large
  part of why an agency leaves Duda for us. A designed layer with a recipe
  catalogue, a named cost against a page budget, and reduced motion as a second
  designed version rather than an animation switched off.
- **Content in the HTML.** No `'use client'` anywhere in `components/render`
  (verified by search, not by trusting the comment that says so), so Next ships no
  bundle for page content. Works with JavaScript off, and a crawler sees what a
  visitor sees. Four small scripts exist at all, each conditional.
- **A world per client.** A committed `designs/<slug>/DESIGN.md` per tenant. Duda
  ships templates, and two sites from one template are the same site reskinned.
- **AI visibility.** llms.txt, JSON-LD on every page, search listings written on
  publish, alt text described by a model. Duda has AI meta and bulk alt text too.
  The llms.txt and the AEO framing are ours.
- **Travel.** 38 travel and trade widgets in the picker, destination content,
  cached offers. The only part of the comparison a competitor cannot buy into.
- **Moving a site over.** The Slicer and the HTML import rebuild an existing site
  as native editable blocks. Duda's answer is to build it again.
- **Permissions.** Nine capabilities ticked independently per person, enforced on
  the server. Duda is role-based.
- **Isolation.** RLS with a read-only renderer role that cannot see a draft even
  when asked correctly.

---

## Recommended order

1. **A site-wide widgets panel, cookie consent first.** Days not weeks, the
   widgets exist, and it closes a compliance exposure we carry today.
2. **The image pipeline.** Responsive variants and modern formats, with the
   caching question answered at the same time. Biggest measurable effect on the
   metric that feeds everything shipped this week.
3. **Collections fed from outside.** The one that stops our best data being
   invisible, and a genuinely different pitch rather than a Duda feature copied.

**Explicitly parked:** multilingual, memberships, eCommerce, white label. Building
any of them on a hunch is building for Duda's client base instead of ours.

---

## Basis, and what to distrust

- **Our side is read from the code** on `claude/travelgenix-sites-handover-py1mx0`
  on 23 Aug 2026. Every claim has a file behind it. Where a code comment asserted
  something, the fact was checked separately: the no-JavaScript claim was verified
  by searching the render tree, not by trusting the comment.
- **Duda's side is from web search, not from Duda.** duda.co is blocked by the
  session's network egress policy, so nothing here was read from their own site
  directly. Treat plan tiers and feature availability as indicative and check the
  live pricing page before quoting any of it to a client.
- **The 82% Core Web Vitals figure is Duda's own**, published by Duda, dated May
  2025. A fair signal of intent and a poor one of fact.
- **Nobody has yet read real AI output** from the SEO and alt-text work shipped 22
  and 23 Aug. Everything is tested against mocked models, so the "ahead on AI
  visibility" claim rests on the plumbing rather than on the words. Andy is doing
  that testing on 24 Aug.
