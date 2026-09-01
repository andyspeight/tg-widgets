# The Elementor gap analysis (tg-sites, platform level)

**Written 31 Aug 2026. Companion to `duda-gap-analysis.md`. Read that one for the
Duda comparison, this one for Elementor. They flag different things because the two
products are different shapes.**

Duda is a hosted CMS, so the Duda comparison was about the stuff around a page:
speed, where content comes from, what runs site-wide. Elementor is a page BUILDER
that lives inside WordPress, so its strengths are further into the page itself: an
enormous widget library, a Theme Builder, a Loop Builder that repeats a designed
template over a query, Dynamic Tags that bind any element to a field, a Form widget
with integrations, a Popup Builder, and per-element custom CSS. Its famous weakness
is the output: div-heavy, jQuery, a stylesheet per widget, and Core Web Vitals you
have to fight for. That weakness is the exact thing tg-sites is built to avoid, so
the honest read is that we lose to Elementor on a handful of authoring powers and
beat it comfortably on everything the visitor actually receives.

Our side of this is read from the code on 31 Aug 2026, every claim with a file
behind it. Elementor's side is from knowledge of the product, not from
elementor.com (duda.co was blocked by the session egress last time and their site
is likely the same), so treat plan tiers and exact feature availability as
indicative and check before quoting.

A rendered version, with the capability matrix, is published at
https://claude.ai/code/artifact/d296cd17-fdcf-4127-93ca-23b9a90d4dbc

---

## The short version

On what a client can drop on a page we are close to parity: 53 blocks against
Elementor's free set, a real global theme, a percentage-width column model with a
separate CSS grid, responsive overrides, a shared box model on every element, and a
motion layer Elementor cannot touch. On the powers that make Elementor Pro worth
paying for we are behind in four places, and one of them is the same strategic point
the Duda analysis raised from the other direction.

1. ~~There is no way to design one card and repeat it over a collection.~~ **SHIPPED
   (1 Sep 2026): the Collection loop block. Design one card from the block library
   with tokens where an item's data goes, repeated over a collection query, server
   rendered. See lib/content/loop.ts and the loop block.**
2. A form stops at an email and a stored row. No webhook, no CRM, no mailing list.
3. No element can carry its own CSS or a class of its own, so the one thing a
   determined client cannot do is the last five per cent of a design.
4. Popups are a site-wide widget rather than something you build on the canvas with
   triggers and rules, so the rich popup engine we already own is only half exposed.

Everything else Elementor sells and we do not, the WooCommerce builder, the plugin
API, memberships, a marketplace of third-party addons, is a decision already
recorded rather than a gap.

---

## The gaps that are real, ranked by what they cost us

### 1. No loop over a collection, and no single template behind the items

This is the big one, and it is the same data-visibility point the Duda analysis
made, seen from Elementor's side.

What we have is most of the way there. Collections are real: typed custom fields up
to 24 a collection (`lib/content/collection-fields.ts`), an auto-generated page per
item at `/{collection}/{slug}` and a tag archive, filtering and sorting
(`lib/content/collection-filter.ts`, `listings.ts`). The `cards` block with
`source: 'collection'` already repeats over a query with a filter, a sort and a
count (`listings.ts:139`), server rendered, so those cards are indexable rather than
drawn by a script.

Two things are missing on top of that.

- **The card is a fixed template.** `itemAsCard` (`listings.ts:267`) builds one shape:
  image, date, title, summary, tags, a formatted fact line, Read more. A client
  cannot design their own card and have the loop wear it. Elementor's Loop Grid, the
  single feature most people buy Pro for, is exactly this: design one item template,
  point it at a query, get a grid or a carousel of them.
- **Each item is authored by hand.** A collection item's body is its own page tree
  (`lib/content/collection-page.ts`), so a client with two hundred tours designs two
  hundred pages. Elementor's Theme Builder designs the single-item template once and
  every item inherits it.

The mechanism both of these want is the third missing piece: **dynamic binding**,
the equivalent of Elementor's Dynamic Tags. Today a block's text, image or link is
typed in; there is no way to say "this heading is the item's title, this image is
the item's photo". A search of the code for a `dynamic` or `binding` layer finds
nothing.

Why it is worth the build and not just a copy of a rival's headline feature: travel
data is the thing we are best at, and a designed loop plus a single-item template
turns a supplier feed into a wall of server-rendered pages in the client's own
design, each with its own structured data, its own sitemap line and its own entry in
llms.txt. It is the natural next move after collections and after the SEO and AEO
work, and it is a genuinely different pitch rather than a feature ticked off a list.

### 2. A form stops at an email

The `form` block is real and decent: a repeater of fields (text, email, phone,
textarea, select, checkbox, up to twelve, `blocks.ts:3682`), the submission stored
in the database, an Enquiries dashboard to read them (`app/enquiries`), and an email
notification with a reply-to (`lib/forms/notify.ts`). For a small agency that is a
working lead capture.

What it does not do is hand the lead anywhere else. Elementor Pro's Form widget
fires actions after submit: a webhook, MailChimp, ActiveCampaign, HubSpot, Slack,
redirect, multi-step. For a travel business the common one is "put this enquiry
straight into the CRM or the mailing list", and today the answer is to read the
Enquiries screen and retype it. A single webhook action, plus one or two named
integrations, is a small build with an outsized effect on how the tool fits a
working agency.

### 3. No element can carry its own CSS or class

Every block, column and section carries a shared box model, and it is a good one:
four-side padding, background, radius, border, shadow, a backdrop blur and a
two-stop gradient (`BoxSchema`, `schema.ts:227`), colours drawn from the theme so
they re-tint live. That covers most of what most clients want.

What is not there is the escape hatch. A search for `customCss`, `cssClass` or
`customClass` returns nothing. Elementor gives every widget a Custom CSS box and a
CSS-ID and class field, which is how a power user does the last five per cent a
settings pane never covers. For a managed platform this matters less than it does
for Elementor's self-serve base, and it cuts against the "a client cannot break the
design" promise, so it is a real gap but a low priority one, and it may be better
answered by staff-only per-element CSS than by handing it to every client.

### 4. Popups are an embed, not a surface you build

We already own a rich popup engine: the Popup widget has eight layouts, six content
types, device and page targeting and scheduling (`lib/content/widgets.ts`). But in
the CMS it arrives as a site-wide floating widget configured through a settings panel
(`components/settings/FloatingWidgetsPanel.tsx`), and that panel exposes only the
common announcement subset.

Elementor's Popup Builder is a first-class canvas: you design the popup like a page,
then attach triggers (page load, scroll depth, exit intent, inactivity, click) and
conditions (which pages, how often, after how many sessions). The trigger vocabulary
already exists in `public/tgse-rules.js` (`armTrigger`), so this is less "build a
popup engine" and more "expose the one we have properly", which puts it above gap 3
on effort-to-value even though it sits lower on raw importance.

### 5. Layout nests one level deep, and per-screen control is partial

Two smaller shape differences, grouped because neither is worth its own build yet.

- **Nesting.** Only the `container` and `grid` blocks hold inner columns
  (`lib/content/inner-columns.ts`), so layout goes one level deep. Elementor's
  flexbox containers nest arbitrarily. In practice the container and the grid cover
  the great majority of real layouts, so this is a note, not a gap.
- **Responsive.** Three fixed tiers, desktop, tablet and phone, with fixed
  breakpoints (`lib/content/responsive.ts`), and only a limited set of properties
  overridable per screen (font size, line height, letter spacing, alignment, padding,
  and hide-on). Elementor lets you set custom breakpoints and override almost any
  property per device. Ours is truthful where it counts, the editor reflows on real
  container queries rather than faking it, but a client who wants a different padding
  on tablet than the desktop-first inheritance gives them cannot always get it.

### 6. One language per site (park it, same as Duda)

`lib/content/languages.ts` is only a list for the audience language rule; there is no
multi-locale rendering, no translation and no hreflang. Elementor plus WPML or
Polylang does all of it. The honest read is unchanged from the Duda analysis: worth
nothing to most of our clients and everything to a few, a large build on a hunch, so
wait for a real client asking and scope against them.

---

## Decided, not missing

The same discipline as the Duda doc: a naive feature-count files these as gaps, and
each is a decision with a place it is written down. Re-open them if the business
changes, not because Elementor's pricing page lists them.

- **The WooCommerce builder, the store, the cart.** Booking is what Travelify does,
  written into `lib/auth/permissions.ts`. A store is not the product.
- **A plugin API and a third-party addon marketplace.** We run a closed widget
  allowlist, a sealed frame for third-party embeds and a sanitiser that admits
  scripts only from our own widget origin. That is the bet that lets a travel agent
  add a widget without a ticket and without a security review, and it is the same
  decision recorded in the Duda doc's app-store note. Elementor's ecosystem is its
  moat and also the source of half its performance and security problems.
- **Membership and login-gated content.** Our auth is for people who edit a site, not
  for visitors. The valuable travel case, a traveller seeing their booking, is
  answered better by the My Booking widget against Travelify than by a second
  password.
- **Self-serve for anyone, and breadth for its own sake.** Elementor ships a hundred
  and more generic widgets because it sells to everyone. We ship a curated 53 blocks
  and a travel widget suite because we sell to travel agencies. More generic widgets
  is not the goal; the right travel ones are.

---

## Where we are ahead

- **The output.** No `'use client'` anywhere in `components/render`, so a published
  page ships no JavaScript for its content, works with scripts off and shows a
  crawler what a visitor sees. This is the precise opposite of Elementor's
  reputation: div-soup, jQuery, a stylesheet per widget. On the metric that feeds
  ranking and the one clients feel, we start ahead by design, not by tuning.
- **Motion.** Twelve recipes including a hand-written WebGL sea and a pinned
  itinerary, reduced motion as a second designed page rather than an animation
  switched off, and a named cost against a page budget. Elementor has motion effects,
  and every one of them adds to the weight. It has nothing like a bespoke shader hero.
- **Personalisation, server-side.** Audience rules on sections AND individual blocks,
  by country, language, campaign, source, device and returning visitor
  (`lib/content/audience.ts`), resolved before a byte is sent and pruned from the
  tree (`lib/content/personalise.ts`). Elementor Pro's display conditions run in the
  browser after load, so a crawler never sees them and the visitor sees a flash. Ours
  do neither.
- **Travel.** A 42-widget suite that is heavily travel-specific, destination content,
  cached offers, a My Booking lookup. The part of the comparison a competitor cannot
  buy into.
- **The theme, and a world per client.** Global colours and fonts as `--tgs-*`
  tokens on a Theme screen, plus a committed `designs/<slug>/DESIGN.md` per tenant.
  Elementor has global styles too; it does not have a per-client design world.
- **Site plumbing as first-party.** Consent Mode v2, GA4 and GTM, JSON-LD for five
  schema types, llms.txt, sitemap, robots, redirects on rename and custom domains,
  all native. On WordPress most of that is a plugin each, and each plugin is more
  weight and another thing to keep patched.
- **The move over.** The Slicer and the HTML import rebuild an existing site as
  native editable blocks. Elementor's answer is to build it again.

---

## Recommended order

1. **A designed loop over a collection, with a single-item template and dynamic
   binding.** One coherent build with three parts: bind a block to a field, design a
   card or a page template once, repeat it over a collection query, all server
   rendered. It closes the biggest Elementor gap, it is the same strategic move the
   Duda analysis pointed at from the SEO side, and it turns our best data from a
   fixed card into a design the client controls. Start here.
2. **Form actions.** A webhook plus one or two named integrations. Small, and it is
   the difference between a lead sitting on a dashboard and a lead landing in the
   client's CRM.
3. ~~**Expose the popup engine properly.**~~ **SHIPPED (1 Sep 2026): the popup panel
   now authors the full trigger vocabulary (load, delay, scroll, exit intent,
   inactivity, pageviews, a click on a named element) and a page rule (show on or
   hide from named paths), on top of the audience targeting it already had. See
   lib/settings/floating-widgets.ts and FloatingWidgetsPanel.tsx.**

**Explicitly parked:** per-element custom CSS beyond a staff tool, arbitrary nesting,
custom breakpoints, multilingual, the store, memberships, a plugin API. Building any
of them chases Elementor's client base instead of ours.

---

## Basis, and what to distrust

- **Our side is read from the code on 31 Aug 2026**, every axis checked against files
  and cited. Where a comment asserted something the fact was checked separately, the
  no-JavaScript claim by searching the render tree rather than trusting the comment.
- **Elementor's side is from product knowledge, not from elementor.com.** Feature
  availability and which tier a feature sits on move over time; treat the specifics as
  indicative and check the live product before quoting a client.
- **This is a platform read, not a client one.** No real agency has been asked which
  of these gaps they would actually feel. The ranking is by our read of value to a
  travel business, and the first real client conversation should be allowed to move
  it.
