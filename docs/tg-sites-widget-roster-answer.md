# Answer to the tg-sites handover: the widget roster question

**Date:** 29 July 2026
**From:** the tg-widgets session
**For:** tg-sites WP0, `tools/usage-audit/REPORT.md`
**Status:** answers to all five questions, plus one finding that needs Andy's decision before the porting order is set

---

## 1. The short version

The handover was right that the audit was pointed at the wrong list. It was
wrong about which way.

There are not two widget populations. There are three, and the estate-wide
usage numbers already exist. Darren produced them on 9 June 2026 and shared
them with Andy the same day. They live in a Google Sheet called **Widget
Installs**. WP0's widget table does not need a crawl and it does not need a
query. It needs opening.

The numbers in it change the shape of the porting decision:

| Layer | Types | Installs | Share |
|---|---|---|---|
| Booking engine (`travel-*`) | 24 | 5,307 | 83.9% |
| Member and account (`member-*`, login) | 8 | 277 | 4.4% |
| Marketing and content (the Widgio-style library) | 27 | 740 | 11.7% |
| **Total** | **59** | **6,324** | |

Three widgets are three quarters of the whole estate: Travel Offers (2,520),
Travel Searchbox (1,341) and Travel Offers New (866). That is 74.7% of every
widget install across the client base.

The V1 thesis says clients barely use the incumbent's depth but use the
drag-and-drop widgets heavily. That is true. What the numbers add is that the
widgets they use heavily are **the booking engine**, and the booking engine is
interactive, personalised and live-priced. It is the least portable thing we
own and the least useful thing to server-render.

The spec's Track B porting order is drawn entirely from the marketing layer,
which is 11.7% of installs. That is not automatically wrong, because SEO value
and install count are different things. But it does mean the porting order is
currently ranked against a population nobody has counted, and section 7 below
sets out what I think it should be instead. That is a recommendation, not a
change. Per the handover's rules it goes to you, not into the spec.

---

## 2. Question 1: the travelify-elements roster

**Answered, with one gap I could not close.**

I could not read `travelify-elements-v2.4.min.js` for its `customElements.define`
calls. This session's egress policy blocks every external host, including
`static.travelify.io`, `api.travelify.io` and all client domains. The proxy
returns 403 on CONNECT and the guidance is to report the block rather than
route around it, so I did not try. If you want the definitive tag list, that
one file read from an unrestricted machine gives it in about a minute.

What I do have is better for the actual decision: the **product names**, from
the Widget Installs sheet, which is a direct query against the platform rather
than a guess. Fifty-nine live widget types, ranked, in section 5.

Confirmed custom element tags, from the handover's own crawl plus embed codes
Andy has sent clients by email and the template document in Drive:

`travel-searchbox`, `travel-slim-searchbox`, `travel-results`,
`travel-avail-extras`, `travel-offers`, `travel-offers-v2`, `travel-accheader`,
`travel-hotlist`, `travel-chatbot`, `travel-dealbook`, `travel-deal-map`,
`tglgn-buttons`, `tg-login`.

Tag to product mapping is partly inferred. The product names are solid.

**One thing worth knowing.** The Drive document "Embed Codes For Travel Widget
Templates (By Andy)" carries the same `<travel-*>` tags but with
`class="widgio-widget"`, not `travelify-widget`. So this runtime is the Widgio
element library, rebranded. That matters because Widgio is a general widget
platform with roughly 90 types across social, reviews, chat, ecommerce, forms,
images, video and audio, and the travel elements are one category inside it.
The new tg-widgets suite is, to a large extent, a re-implementation of the
Widgio marketing library. Section 4 shows how closely.

---

## 3. Question 2: the registry behind the numeric widgetid

**This was the highest-value question and the answer is yes.**

The registry exists, it is Travelgenix's own, and it is already being queried.

The key correction to the handover: **Travelify is not a third-party vendor.**
`travelify.io` is Travelgenix's own domain and `api.travelify.io` is the
Travelgenix mid-office platform, the one Andy calls the mothership in client
emails. The numeric `widgetid` is a record in that platform. Widgets are
created there by Travelgenix staff, who hand the client the HTML. Andy does
this himself in email, for example creating an Attractions search box and an
Airport Extras search box for travelco.co.uk in early July.

Evidence that it is queryable, in order of strength:

1. **The Widget Installs sheet.** Fifty-nine widget types with install counts,
   produced by Darren on 9 June 2026. You do not produce that by crawling. That
   is a `GROUP BY` against the widget table.
2. **The platform has a widget manager UI.** From Andy to a client on 21 July:
   "If you click on the widgets box, at the bottom in More Tools in Travelify,
   it will take you to the new dashboard."
3. **Support works in numeric IDs.** Ticket #7256 is titled "widget 17694".
4. **This repo already calls the widget service.** `api/offers.js:18` and
   `public/widget-offers.js:149` both point at
   `https://api.travelify.io/widgetsvc/traveloffers`, authenticated with
   `Token {appId}:{publicApiKey}`. There is a `widgetsvc` namespace and we hold
   working credentials for it. `api/admin/suppliers.js:18` shows an `/admin/`
   namespace too.

So estate-wide widget usage is a query, not a crawl, exactly as the handover
hoped. The route is Darren and the Travelify database, not the Duda API and not
a 300-site fetch.

**What I could not confirm:** whether `widgetsvc` exposes a widget-by-ID or
widget-list endpoint we could call directly, which would let tg-sites resolve a
`widgetid` at render time rather than storing a snapshot. Egress is blocked, so
this is a question for Darren rather than something I can probe. It matters for
the bridge block design, so it is in the open questions.

---

## 4. Question 3: how the two populations map

Set the booking engine and member widgets aside. Nothing in tg-widgets
duplicates them, and nothing should.

For the marketing layer the overlap is close to total. tg-widgets has already
rebuilt most of the live estate's marketing widgets:

| Live estate widget | Installs | tg-widgets equivalent | Verdict |
|---|---|---|---|
| Weather | 187 | Weather | Superseded |
| Monthly Weather Averages | 180 | Weather (averages mode) | Superseded |
| Form Builder | 79 | Enquiry Form / Enquiry Pro | Superseded |
| Google Maps | 46 | Maps | Superseded |
| Popup | 40 | Popup | Superseded |
| Logo Showcase | 39 | Logo Showcase | Superseded |
| All-In-One Chat | 26 | WhatsApp Chat (partial) | Partial |
| Countdown Timer | 18 | Countdown Timer | Superseded |
| Google Reviews | 13 | Google Reviews | Superseded |
| Trustpilot Reviews | 10 | Google Reviews (other platforms in progress) | Partial |
| RSS News Feed | 9 | RSS Feed | Superseded |
| Email Signup | 8 | Newsletter Signup | Superseded |
| File Embed | 7 | none | Live only |
| Venue and Events Lister | 6 | Event Calendar | Superseded |
| WhatsApp Chat | 4 | WhatsApp Chat | Superseded |
| Back To Top | 4 | Back to Top | Superseded |
| Pricing Table | 3 | Pricing Table | Superseded |
| YouTube Social Feed / Gallery | 39 | YouTube | Superseded |
| Video Gallery | 2 | Carousel (partial) | Partial |
| Team Showcase | 2 | Team Showcase | Superseded |
| Testimonials Slider | 2 | Testimonials | Superseded |
| Tabs, Coupon, PayPal Buttons | 6 | none | Live only |
| Travelgenix Site Menu | 8 | none (Widgio Mega Menu base exists) | Live only |

Twenty of the twenty-seven marketing types already have a tg-widgets successor.
The stragglers are File Embed, Tabs, Coupon, PayPal Buttons, Site Menu and the
non-Google review platforms, and they total under 30 installs between them.

The other direction is worth noting too. tg-widgets has 43 types and a lot of
them have no live-estate counterpart at all: Destination Spotlight, Airport
Spotlight, Attraction Spotlight, My Booking, Quote PDF, Smart Section, Prism,
Text FX, World Map, Flight Time, Spin Wheel, Travel Results AI, Email
Signature, Cookie Consent. Those are new capability rather than replacements.

**The single hardest mapping fact, and the useful one:** the live
`<travel-offers-v2>` element and the tg-widgets Travel Offers widget consume
**the same upstream endpoint**, `api.travelify.io/widgetsvc/traveloffers`. Same
data, same auth shape, two front ends. A native server-rendered port of Travel
Offers for tg-sites is therefore not a rebuild, it is a third renderer over a
data path we already proxy server-side in `api/offers.js`. That is the cheapest
high-value port on the board.

---

## 5. Question 4: estate coverage

**Yes, and it already exists.** Google Sheet "Widget Installs", owned by
darren.swan@agendas.group, created 9 June 2026, shared with Andy that day.

Two columns: `TotalInstalls` and `ApplicationsWithMultipleInstalls`.

Marketing and content layer, ranked. This is the population the tg-sites widget
tray and the porting order actually concern:

| Installs | Apps w/ multi | Widget |
|---|---|---|
| 187 | 4 | Weather |
| 180 | 3 | Monthly Weather Averages |
| 79 | 15 | Form Builder |
| 46 | 2 | Google Maps |
| 40 | 9 | Popup |
| 39 | 8 | Logo Showcase |
| 36 | 1 | YouTube Social Feed |
| 26 | 12 | All-In-One Chat |
| 18 | 5 | Countdown Timer |
| 13 | 4 | Google Reviews |
| 10 | 4 | Trustpilot Reviews (not supported) |
| 9 | 1 | RSS News Feed |
| 8 | 2 | Email Signup |
| 8 | 2 | Travelgenix Site Menu |
| 7 | 2 | File Embed |
| 6 | 3 | Venue and Events Lister |
| 4 | 2 | WhatsApp Chat |
| 4 | 2 | Back To Top |
| 3 | 1 | Pricing Table |
| 3 | 1 | YouTube Gallery |
| 2 | 1 | Video Gallery, PayPal Buttons, Tabs, Team Showcase, Testimonials Slider, Coupon, All-In-One Reviews |

Booking engine layer, ranked: Travel Offers 2,520, Travel Searchbox 1,341,
Travel Offers New 866, Travel Results 147, Travel Availability Extras 78,
Travel Basket 57, Travel Ticket Searchbox 53, Travel Custom Deal 37, Travel
Hotlist 33, Travel Last Searches 33, Travel Web Ref Lookup 28, Travel Order
Viewer 23, Travel Event Ticket Results 18, Travel Sell Products and Gift
Vouchers 13, Travel Tour Origin Calendar 11, Travel B2B Account 11, Travel
Multi-City Results 10, Travel Chatbot (Luna) 7, Travel Deal Booker 6, Travel
Destination Guide 4, Travel Availability Extras New Beta 4, Travel Deal Map 3,
Travel Searchbox New Accomm Only 2, Travel Balance Payment Form 2.

Member layer: Member Sign-In 115, Member Account Header 57, Member Account
Summary 37, Member Registration Form 25, Member Login Buttons 18, Member Login
Checker 15, Member Account Manager 8, Travelgenix SSO Provider 2.

### Read this before using the table

- **The second column is not a site count.** `ApplicationsWithMultipleInstalls`
  reads literally as the number of applications carrying more than one install.
  If that is what it is, we still have no denominator, and the brief's "under 5%
  of sites is excluded" rule still cannot be applied. **Ask Darren to re-run
  with a distinct application count per widget type.** That is a one-line change
  to a query he has already written and it is the last missing number in WP0.
- **The three-way split into booking, member and marketing is mine**, not a
  column in the source. It is a judgement about what each widget is for.
- **Install counts are configuration, not engagement.** Same caveat the handover
  raised about the Airtable numbers. Nobody has view or interaction data.
- Some rows look like historical build-up rather than live use. Travel Offers
  at 2,520 installs across an estate of roughly 300 sites is an average of eight
  per site, which is plausible given the tabbed offer panels seen on
  exclusivelytravel, but worth a sanity check before it anchors anything.
- The sheet is seven weeks old. Fine for ranking, not for exact figures.

---

## 6. Question 5: SEO relevance, and what Track B should contain

The test is whether the widget renders content a search engine should index. On
that test most of the estate fails, and it fails for a good reason rather than a
fixable one.

**Never port. Bridge indefinitely.** Everything in the booking engine layer
except offers: searchbox, results, basket, availability extras, hotlist, last
searches, web ref lookup, order viewer, deal booker, multi-city results, event
ticket results, B2B account, balance payment, chatbot. All of it is either
query-dependent, session-dependent or live-priced. Several of these pages should
arguably carry `noindex` rather than be optimised. The entire member layer is
behind auth and the same applies, more strongly. On the marketing side: Form
Builder, Popup, Countdown, All-In-One Chat, WhatsApp, Maps, Back to Top, Tabs,
File Embed, Coupon, PayPal, video galleries. No SEO argument for any of them.

**Genuine Track B candidates, in the order I would do them.**

1. **Travel Offers.** The one place volume and SEO value meet. Pricing and
   inventory should be crawlable, it is the biggest widget in the estate by a
   distance, and the server-side data path already exists in `api/offers.js`. If
   only one thing gets ported, this is it.
2. **Reviews, with aggregate rating markup.** Low install count, 27 across all
   platforms, but rich snippets are a direct search-results win and it is a
   small component. Value over volume.
3. **Monthly Weather Averages.** I want to push back on the spec here. It
   dismisses Weather as interactive-only, but monthly averages are static
   per-destination content, genuinely indexable, and at 180 installs it is the
   second most-installed marketing widget in the estate. Live weather stays on
   the bridge. The averages table is worth server-rendering.

**Then a structural point, which is the one I would most like a decision on.**
Four of the spec's seven Track B candidates should not be widget ports at all.
Logo Showcase, Pricing Table, Testimonials and FAQ are all static, content-only
and already have homes in the fourteen-section library as `logo-wall`,
`accordion` and friends. Building them as sections is less work than porting
them, gives better markup, gets `FAQPage` schema for free, and means the client
edits them in the properties pane like everything else rather than in a separate
widget editor. Team Showcase is the same case.

Destination Spotlight is the fifth. It is the spec's number one Track B
candidate and I would take it off the list entirely, because tg-widgets already
has a destination content pipeline in the Destination Content Airtable base
covering countries, cities and regions, resorts and areas, and airports. For
tg-sites that is a native `collection`, not a ported widget. Same content,
better fit, and it lands the SEO win the spec wanted from it.

That would leave Track B at three items rather than seven, with the two biggest
wins kept and the rest solved more cheaply somewhere else.

---

## 7. What this means for the porting order

Raising, not deciding, as instructed. Three things contradict the spec.

1. **The spec's Track B list is ranked against the marketing layer, which is
   11.7% of estate installs.** Not wrong on its own, since SEO value is not
   install count, but it should be a stated choice rather than an accident of
   which list was to hand.
2. **Destination Spotlight is ranked first and I think it should not be on the
   list.** It has 32 instances in tg-widgets and 4 in the live estate as Travel
   Destination Guide. The content pipeline already exists, so it belongs in
   collections.
3. **Weather is dismissed and half of it should not be.** 367 installs across
   the two weather widgets makes it the biggest marketing category in the
   estate.

Nothing here touches the fourteen-section library, which the numbers broadly
support. If anything the numbers strengthen `logo-wall`, `accordion`,
`collection-list` and `widget-band`, and add weight to `hero-widget` given how
dominant the search box is.

---

## 8. Method and data quality

- **Everything was read-only.** No writes to Airtable, to any client site or to
  any production system. The one exception is the Travelgenix Projects tracker
  row for this project, which the project-handover protocol requires.
- **Sources:** this repo (`api/offers.js`, `api/_lib/travelify.js`,
  `api/admin/suppliers.js`, `api/widget-config.js`, `public/widget-offers.js`),
  the Travelgenix Widgets Airtable base `appAYzWZxvK6qlwXK`, Google Drive
  ("Widget Installs", "Travelgenix Widget Categories", "Embed Codes For Travel
  Widget Templates"), and Andy's Gmail for real embed codes and support tickets.
- **Blocked:** all outbound HTTPS. `static.travelify.io`, `api.travelify.io`,
  client domains and `www.travelgenix.io` all fail CONNECT with 403 at the
  egress proxy. So no runtime bundle read, no live-site crawl, no API probe.
  Anything in this document about the element tags or the `widgetsvc` surface is
  from code, documents and email, not from touching the live system.
- **Not attempted:** the Duda API. On this evidence it is the wrong tree
  entirely. Widget data lives in Travelify, not Duda. Duda hosts the pages the
  widgets sit on.

---

## 9. For Andy

1. **Ask Darren to re-run the Widget Installs query with a distinct application
   count per widget type.** One line, and it is the last missing number in WP0.
   Everything else about widget usage is now answered.
2. **Do you want Track B cut from seven to three?** Travel Offers, Reviews,
   Monthly Weather Averages, with Logo Showcase, Pricing Table, Testimonials,
   FAQ and Team Showcase built as sections instead and Destination Spotlight
   moved to collections.
3. **Does `widgetsvc` expose a widget-by-ID or widget-list endpoint?** Darren
   will know. It decides whether the tg-sites bridge block resolves a widget
   live or stores a snapshot, and whether the widget tray can list a client's
   legacy widgets alongside their tg-widgets ones.
4. **Is the booking engine in scope for the tg-sites widget tray at all?** It is
   84% of what clients actually run. If a tg-sites page cannot carry a search
   box and an offers panel, it cannot replace a client site. I have assumed it
   is in scope via the bridge, but the spec never says so explicitly.
5. **Someone should read `travelify-elements-v2.4.min.js` from an unrestricted
   machine** and paste the `customElements.define` list into the WP0 report, to
   close the one gap in question 1.
