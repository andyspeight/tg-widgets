# Framer brief: the "What we have built, and what is next" timeline page

Written 3 Sep 2026 for the Framer session that builds the page. The page is
a public timeline on the Travelgenix marketing site (Framer project "Scary
Wealth", `vna1Dww9wfns4nJSst1v`, https://framer.com/projects/Scary-Wealth--vna1Dww9wfns4nJSst1v-dfckl):
what Travelgenix has shipped since the start of 2026, then what is on the
roadmap. The audience is travel agency owners, so every item is a plain
capability in warm UK English, not a commit message.

Sources: this repo's full git history (first commit 16 Apr 2026, about 2,650
commits to 3 Sep 2026), the docs/ handovers, and the Airtable Projects table
(base `appj9tksreHOwkhYg`, table `tblpyhPNhiQg3XkkT`, 51 records) whose
Current Focus and Next Steps fields carry the roadmap. Projects that live in
other repos (Luna Chat, Luna Work CRM, Luna Travel, Luna Agents, Tripbuster,
Support Desk, Onboarding) are dated from their Airtable session logs.

## Assumptions Andy should confirm

- **Public page.** Everything below is worded for prospects. Items marked
  INTERNAL are internal tooling (a CRM to replace Monday, QA audits, a
  screenshot-to-code helper) and are listed only so Andy can veto or keep.
- **January to March 2026 is a gap.** Neither this repo nor the Airtable
  table reaches back before April (the earliest dated project row is Luna
  Work CRM, 10 Apr 2026; Luna Brain UI design notes are "April 2026"). Luna
  Chat, Luna Marketing and the original widget suite pre-date the repo. Andy
  supplies those Q1 milestones from memory or the old GitHub web-UI history.
- **Naming.** Use the product names on the live site: Luna Chat, Luna
  Contracting, Luna Travel App, Booking Widgets, Travel Websites. Never the
  word "concierge" (Luna is an "AI travel assistant").

## Page structure (proposed)

1. Hero: one line that this is the year so far, and one line that the roadmap
   half is honest about what is not built yet. No eyebrow label, no count-up
   stats (count-ups are not native in Framer; build static and flag).
2. A vertical timeline, one node per month April to September 2026, each with
   4 to 6 headline capabilities. Native Framer scroll appear effects are fine
   for the reveal; one motion moment, not one per section.
3. A "Now", "Next", "Later" roadmap band. Each card names the capability, the
   product it belongs to and a one-line "why it matters to an agency".
4. A closing call to action to book a demo (the existing button component,
   set the variant by ID because of the duplicate "Navy" variant).

## What shipped, month by month

Dates are the day the code landed in the repo, not the day a feature was
announced. The bracketed evidence is for the builder's checking only and must
not appear on the page. Pick 4 to 6 per month for the timeline nodes; the rest
can sit in an expandable "and also" list or be dropped.

### April 2026

- 16 Apr: The first Travelgenix widget, a pricing table an agency adds to any website with one line of code (public/widget.js)
- 17 Apr: The Widget Suite home and the first self-serve editors, with Reviews, FAQ and Testimonials (index.html, widget-reviews.js, widget-faq.js, widget-testimonials.js)
- 21 Apr: Destination Spotlight, a researched destination page backed by our own content library (widget-spotlight.js, api/destination-content.js)
- 22 Apr: Weather for any destination (widget-weather.js)
- 23 Apr: The Enquiry Form, with email routing, automatic customer replies, Google Sheets and an enquiry inbox for the agent (widget-enquiry.js, inbox-enquiry.html)
- 25 Apr: My Booking, so a traveller can look up their own booking on the agency's website (widget-mybooking.js, api/retrieve-order.js)
- 26 Apr: Branded booking confirmation documents as a PDF and as an email (api/booking-pdf.js, api/booking-email.js)
- 27 Apr: Logo Showcase, Countdown and the first interactive World Map (widget-logos.js, widget-countdown.js, widget-worldmap.js)
- 28 Apr: Text FX, and one shared editor look and feel across every widget (widget-textfx.js, editor-shell.js)
- 30 Apr: Travel Offers, live holiday deals on the agency's own site (widget-offers.js, api/offers.js)

### May 2026

- 4 May: Popup, with lead capture built in (widget-popup.js, api/popup-lead.js)
- 5 May: Client accounts with secure sign-in, password resets and invitations, and the Events widget (api/auth/signin.js, widget-events.js)
- 6 May: The client portal, with a product catalogue, packages and the first Client Control screens (catalogue.html, clients.html, dashboard.html)
- 8 May: Opening Hours, Social Share, WhatsApp and Newsletter signup, with Mailchimp, Brevo, MailerLite, Klaviyo and Constant Contact connected (widget-hours.js, widget-share.js, widget-whatsapp.js, widget-newsletter.js)
- 11 May: Airport Spotlight and the Contact Card (widget-airport.js, widget-contact.js)
- 12 May: Staff and user management, and single sign-on so Travelify users sign straight in (api/admin/users.js, api/auth/sso.js)
- 19 May: Team Showcase (widget-team.js)
- 21 May: A nightly deal cache behind the World Map so holiday prices appear instantly (api/cron/refresh-map-offers.js)
- 26 May: Quote PDF, a branded quote an agent sends in a click (widget-quote-pdf.js, api/generate-pdf.js)
- 29 May: Guided setup tours inside the editors, walking a new client through their first widget (editor-tour.js)

### June 2026

- 1 Jun: Enquiry Pro, the richer multi-step enquiry form, and the Loading Animation widget (widget-enquirypro.js, widget-loader.js)
- 2 Jun: Customers can pay a balance and cancel online (api/pay-balance.js, api/cancel-product.js)
- 9 Jun: Google Maps, YouTube and RSS widgets, then Back to Top and Carousel the next day (widget-maps.js, widget-youtube.js, widget-rss.js, widget-backtotop.js, widget-carousel.js)
- 11 Jun: TG Slicer, a browser tool that captures a design from any web page (tg-slicer/)
- 13 Jun: The Appointment Scheduler, with Google and Outlook calendars, reminders and rescheduling, launched with Deal Bar, Currency Converter, World Clock, Flight Time, Stats Counter and Spin the Wheel (widget-appointment.js and six others)
- 15 Jun: Travel Results AI (widget-travel-results-ai.js)
- 22 Jun: Attraction Spotlight, and a launchpad that greets every client after sign-in (widget-attraction.js)
- 24 Jun: Luna Brain, the self-checking knowledge base behind our AI answers (#2)
- 28 Jun: The Special Offers suite, four widgets for building and showing an agency's own deals (widget-offer-builder.js, widget-offer-card.js, widget-offer-page.js, widget-offers-grid.js)
- 29 Jun: Multi-lingual widgets across the whole suite, with offer and enquiry wording translated too (#4 to #16)

### July 2026

- 2 Jul: Holiday deals served from the Travelgenix cache rather than a live search, so offer boxes load fast and stay up (api/cached-offers.js)
- 3 Jul: Every video appointment gets its own real Zoom meeting, plus a booking drawer and a browser extension for sending times from Gmail
- 5 Jul: Cookie Consent, geo-aware and wired to Consent Mode v2 (widget-consent.js)
- 5 Jul: Smart Section, which shows different content to different visitors with no developer needed (widget-smartsection.js)
- 6 Jul: Prism, an editorial hero band with angled photo slices (widget-prism.js)
- 8 Jul: The Email Signature builder, with a ten-template gallery and a hosted banner (widget-emailsig.js)
- 9 Jul: A full quality sweep of all 47 widgets, every high and medium finding fixed (docs/widget-suite-qa-2026-07-09.md)
- 21 Jul: One-click Google Sheets for leads, and the first Payment Reminders release (#77, #85)
- 29 Jul: Travelgenix Sites, our own website builder, with pages, sections and a visual editor (tg-sites/)
- 30 Jul: The conversational Form widget, and client websites on their own domain (widget-form.js)

### August 2026

- 1 Aug: The Being Found report, an SEO and AI visibility audit for a client site, with sitemaps, structured data and an alt-text assistant
- 3 Aug: The AI section builder (describe a section and have it built), and TG Slicer captures flow straight into Sites
- 6 Aug: Prayer Times, with a next-prayer countdown and worldwide city search (widget-prayer.js)
- 7 Aug: Group Trips and Escorted Tour, full tour landing pages with availability and enquiry capture, plus a spreadsheet view for Special Offers (widget-trips.js, widget-trips-page.js, widget-tour.js)
- 11 Aug: Styling per screen size, and content that reveals itself on scroll (tg-sites)
- 17 Aug: Custom domains, site duplication and an activity log showing who changed what (tg-sites)
- 19 Aug: Ten designed homepages ready to adopt, per-person permissions and a site search that needs no JavaScript (tg-sites)
- 21 Aug: The Event Tickets family, seven widgets for selling match and event tickets, with researched venue guides (widget-tickets.js and six others)
- 24 Aug: Cruise route maps that follow the sea rather than crossing land, and live Google reviews pulled into the Reviews widget (#235, #240)
- 26 Aug: The site builder: describe a business and have a whole website planned, written and published (tg-sites)
- 30 Aug: A site-wide floating widgets panel, visitor personalisation by country, language and campaign, and a monthly report for every client site (tg-sites)

### September 2026 (to 3 Sep)

- 1 Sep: The Event Tickets family goes live to clients, with booking buttons on venue guides and a stay calendar for hotels
- 1 Sep: The Collection Loop editor, so a client can repeat a designed card over their own content (tg-sites)
- 1 Sep: Popup gains the full set of triggers and a page rule
- 2 Sep: Payment reminders get a safe test mode and caller-driven sends, with a public integration doc for partners (#261, #267, #268)
- 2 Sep: My Booking balance reminders become opt-in per client, with emails the client writes themselves (#262, #265)

### Numbers, if a stat is wanted (static text, no count-up)

Month | Commits
--- | ---
April | 436
May | 741
June | 308
July | 457
August | 682
September (to 3 Sep) | 24
Total | 2,648

Embeddable widgets today: 61 (60 `public/widget-*.js` plus the original pricing widget).

### Known gaps in this list

- January to March 2026 is missing (see the assumptions above).
- Luna Chat, Luna Work CRM, Luna Travel App and Luna Marketing are built in other repos; only their wiring shows here. Dated highlights from Airtable: Luna Chat Ship 1 faster replies (21 May), Luna Travel App 0.14.11 with in-app Luna chat and agent handoff (3 Jun), Luna Chat agent copilot Stage 1 (5 Jun), Luna Agents Stage 1 proven (22 Jun), TG Support Desk client portal (22 Jun), Luna Chat Booking Assist Stage 1 live (20 Jul), Luna Work CRM full blueprint shipped (24 Jul), Tripbuster built (26 Jul), Client Onboarding Tool phase 2 (Aug).
- YesAware (20 Jul) is an internal tool and is left off.


## Roadmap: Now (in build, September 2026)

Product area | Capability, in client words | Evidence
--- | --- | ---
Booking Widgets | Destination, Airport and Attraction Spotlight redesign: new Essentials strip and Card layouts, hero photos, preset layouts | Airtable "Destination, Airport and Attraction widgets", branch awaiting review 3 Sep
Booking Widgets | Event Tickets family (seven widgets: Event Tickets, Next Event, Club Picker, Ticket Search, Ticket Month, Event Menu, Venue Guide) went live to Ignite and Bespoke clients on 1 Sep; package booking options are the next layer | Airtable "Event Tickets widget family"
Booking Widgets | Payment reminders and My Booking: client-editable reminder emails, instalment tags, balance chasing, a public Payment Reminders API for partners | commits 1 to 2 Sep (#260 to #268)
Booking Widgets | Appointment Scheduler: SMS reminders (needs Twilio), booking analytics, multi-calendar busy checking | Airtable "Appointment Scheduler"
Booking Widgets | Group Trips: card payments through Stripe Connect (deposit and balance), the trips console on its own domain | Airtable "Group Trips"
Travel Websites (tg-sites) | Collection loop: design one card, repeat it over a collection, with a loop editor (slices 1 to 3 landed 31 Aug to 1 Sep); next is collections fed from an external source | commits, docs/elementor-gap-analysis.md
Travel Websites (tg-sites) | Form actions: a form that reaches a webhook, a CRM or a mailing list, not just an inbox | docs/elementor-gap-analysis.md gap 2
Travel Websites (tg-sites) | Site-wide widgets panel with cookie consent first | docs/tg-sites-handover.md open queue 7
Travel Websites (tg-sites) | Faster published pages: edge caching and inlined CSS, plus real-user analytics switched on | docs/tg-sites-handover.md open queue 1 and 2
Travel Websites (tg-sites) | Gallery and section layouts photographed on insert so a client sees the layout, not grey frames (needs the Pexels and blob store keys connected) | Airtable "Travelgenix Sites"

## Roadmap: Next (agreed, not started or partly built)

Product area | Capability, in client words | Evidence
--- | --- | ---
Luna Chat | Booking Assist: Luna offers to take an enquiry mid-chat and hands it to the agent dashboard with an alert (Stage 1 live 20 Jul, live end-to-end check pending) | Airtable "Luna Chat Booking Assist"
Luna Chat | Returning-visitor memory across days, and the agent AI copilot in the dashboard | Airtable "Luna Chat, Agent Copilot and Live Resilience"
Luna Travel App | Wire the real Luna AI into the traveller app instead of the deterministic in-app answers | Airtable "Luna Travel"
Luna Work CRM | Multi-agency tenancy with per-user scoping and encrypted passport fields, then forecasting and WhatsApp | Airtable "Luna Work CRM"
Luna Agents | First autonomous agent: a supplier rate and schedule-change monitor, with an approve, edit or reject review loop | Airtable "Luna Agents"
Luna Contracting | Contract Loader now reads each client's real entitlements from Control; remove the temporary bridge | Airtable "Contract Loader"
Client onboarding | Go-live of the client onboarding tool (access codes, Luna-composed emails, shared rate limiting), then Phase 3 | Airtable "Client Onboarding Tool"
Support | TG Support Desk go-live once the support inbox is connected; self-learning knowledge base | Airtable "TG Support Desk"
Booking Widgets | Translation widget: on-the-fly translation of live search results (English to Romanian first) | Airtable "Translation Widget"
Booking Widgets | Email Signature generator phase 2: banner click and open analytics | Airtable "Email Signature Widget"
Booking Widgets | Extend Google Reviews to more review platforms | Airtable "Back to Top Widget" next step
Tripbuster | Self-serve deal advertising for independent UK agents: advertiser sign-up is live, owner console and launch config outstanding | Airtable "Tripbuster"
TG Slicer | Slice any section of any site straight into a Travelgenix Sites page (Duda path retired 17 Aug; real-site validation next) | Airtable "TG Slicer"
AI Search Readiness | A tool that scores a travel site for AI search visibility (rebuilt 28 Jul, 214 tests green, needs its own repo and deploy) | Airtable "AI Search Readiness"
INTERNAL | TG B2B CRM to replace Monday (brief written, Stage 1 not started) | Airtable "TG B2B CRM"
INTERNAL | YesAware email tracking extension (built 20 Jul, one surface unverified) | Airtable "YesAware"

## Roadmap: Later (parked or design stage)

Product area | Capability | Evidence
--- | --- | ---
Booking Widgets | Inspirator, swipe-to-discover holiday ideas ("Tinder for travel") | Airtable "Inspirator", design stage since May
Booking Widgets | Top 10 destination widgets driven by the destination content base | Airtable "Top 10 Destination Widgets"
Travel Websites (tg-sites) | Multi-language sites (parked, ask Andy first) | docs/duda-gap-analysis.md gap 5
Travel Websites (tg-sites) | Pages behind a login, and site-level version history | docs/duda-gap-analysis.md gaps 6 and 8
Luna | Luna Brain admin UI for managing agency knowledge (paused while the widget suite progresses) | Airtable "Luna Brain UI"
Luna Chat | Faster two-pass replies (Ship 2, disabled pending a fix) | Airtable "Luna Chat Ship 2"

## Standing rules for the Framer session (from the July 2026 record)

- Work on a NEW BRANCH for this page. Never publish. Verify with screenshots
  (geometry from `$rect` is unreliable). Merge to main only when Andy says.
- Call `getActiveBranch()` before editing; `session new` silently ignores
  `?branch=`. `mergeBranch(target)` merges the ACTIVE branch into target and
  consumes the source; merge one at a time and verify after.
- Breakpoints must not lose design: every section gets Desktop, Tablet and
  Phone. The shared layout template is "Travelgenix Layout" `GRBJqpwl7`.
- Tokens: navy `#1B2B5B`, teal `#00B4D8`, Inter. No new styles, fonts or
  colours. Teal on white fails contrast for text; use it for accents only.
- Copy: UK English, no em dashes, no Oxford comma, straight quotes, sentence
  case headings, never "concierge".
- Decorative photos must earn their place. The live product pages carry no
  photographs in content sections; use the teal radial glow instead.
- Known gotchas: `loopEffect.rotate` defaults to 360 (set it explicitly);
  icon colour is `$control__color` not `fill`; set text and `textColor` in
  separate SETs on a fresh TextRun; link nodes need an existing page.
- Count-ups, typewriter effects and live countdowns need code components.
  Build static and flag.
- Andy edits the Framer canvas while Claude works. When reality differs from
  what was built, suspect his edits first.


## Build status, 3 Sep 2026 (afternoon session, Claude Code in the cloud)

The page is BUILT in Framer on the branch `timeline-roadmap` (branch id
`qze2h9phe`), created from main. Nothing is published and nothing has been
merged. Open it with the branch link:
https://framer.com/projects/Scary-Wealth--vna1Dww9wfns4nJSst1v-dfckl?node=JblnZB_PD&branch=qze2h9phe

### What is on the page

Path `/roadmap`, title "What we've been working on, and what's coming soon"
(Andy's change of direction on 3 Sep: recent work and what is coming, nothing
before the start of May). On the shared "Travelgenix Layout" template, with
Desktop, Tablet and Phone breakpoints, screenshots checked at all three after
every pass.

1. Hero on the teal radial glow: the site's tri-colour bar, the Display
   heading, a two-line Body intro and a white stat card with three large
   static numbers ("5 months of shipping", "2,212 updates shipped", "61
   embeddable widgets"; the commit count is from full git history, 1 May to
   3 Sep). No eyebrow badge, no count-up. On Phone the card stacks.
2. "Since May, month by month" on white: one continuous rail with a navy
   medallion per month carrying a Lucide icon (Users, Calendar Days, Globe,
   Sparkles, Ticket). Five month cards, May to September. Each card is a
   white tile split in two on Desktop: copy on the left (a headline launch
   in bold, a one-line blurb, a divider, four to six check-marked items in
   one column) and a browser-framed MOCKUP on the right (400px wide, 4:3, a
   real screenshot). On Tablet and Phone the mockup drops below the copy at
   full width. The January to March note and the April node are gone.
   Headlines and mockups: May "Client accounts and the client portal" (the
   widget catalogue at tg-widgets.vercel.app); June "The Appointment
   Scheduler" (demo-appointment); July "Travelgenix Sites"
   (coastwise.travelgenixsites.com); August "Group Trips and Escorted Tours"
   (demo-trips-page, the Santorini retreat), with the site builder in the
   blurb; September "Event Tickets go live" (demo-venueguide, Wembley).
3. "What's coming soon" on the light gradient band: three lanes headed by a
   pill (Now in navy, Next in teal tint, Later outlined) and a one-line
   meaning. Now has 7 cards, Next 8 and Later 5. Each card is a white tile
   with a product icon in a teal-tinted square, the product name in small
   caps navy, the capability in bold and one line on why it matters. Cards
   lift 3px on hover. The lanes container carries the page's ONE scroll
   reveal; nothing else animates.
4. Closing call to action on the second glow: "Want to see any of this
   running?", one line, the Travelgenix Button in its Primary variant to
   /contact, and a "See pricing" text link using the site's Navigation Link
   preset.

The five mockup screenshots were taken by Framer's own screenshot service
(a `readProject` screenshot query with a `url`), cropped to 1200x900 here,
and uploaded to the project as image assets named roadmap-may.jpg to
roadmap-sep.jpg with alt text. They are real pages as they rendered on 3 Sep;
re-shoot them when the products change.

### Node ids for the next session

Page `JblnZB_PD`. Breakpoints Desktop `dj9AZu4uB`, Tablet `wDPei4RnY`,
Phone `LKNmhTH7h` (replica descendants are the breakpoint id followed by the
desktop id). Sections: Hero `K2lxtp5u5` (stat card `noCscvzV5`), Timeline
`aFg_kTUuv` (rail list `WijLReGZu`, maxWidth 1040; month rows May
`OAwtpba0y`, June `bZy2gANM8`, July `OfCz4AtNz`, August `wZxCOm2xY`,
September `WoCfe2lng`; month cards `MvqVSKDoQ`, `OIqPfcZXh`, `NlYbzUhJV`,
`MldJNtNDk`, `MN158hOzJ`, each holding a "Copy" column and a "Mockup"
frame), Roadmap `pl4u5N4a2` (lanes `Tiqqt69cj`; pills `oOswmJklt`,
`hTKyZfB8o`, `ANaATYAvm`; card containers `cUHo79m5m`, `pFu6prN6W`,
`xoXuxp4rI`), Closing CTA `xut44Oqjg`.

### Left out and why

- The remaining month items (Text FX, Logo Showcase, Countdown, Weather, the
  confirmation PDFs, Airport Spotlight, Contact Card, Team Showcase, the
  nightly deal cache, Google Maps, YouTube, RSS, Back to Top, Carousel, TG
  Slicer, Travel Results AI, Attraction Spotlight, Luna Brain, the Email
  Signature builder, Prism, the QA sweep, Google Sheets for leads, the Form
  widget, Prayer Times, the Special Offers spreadsheet view, per-screen
  styling, the ten homepages, cruise maps, live Google reviews, the monthly
  client report and the floating widgets panel) were dropped to keep each
  month at four to six lines. Nothing needs to stay out; they are a copy
  change away.
- Roadmap trims: the two INTERNAL rows (TG B2B CRM, YesAware) are off the
  page. "Client onboarding" and "TG Support Desk" share one Next card. Email
  Signature analytics is off. AI Search Readiness is folded into the
  Tripbuster and TG Slicer card. Group Trips, the Appointment Scheduler and
  the Spotlight redesign each have their own Now card.
- Copy uses straight apostrophes as typed; Framer renders them as
  typographic apostrophes, which matches the rest of the site.
- Second pass on Andy's "make it more visually appealing": the chips became
  the stat card, the flat check lists became month cards with a headline and
  two columns, the dots became icon medallions, and the roadmap gained lane
  pills, card icons and hover. Same tokens, presets and components; nothing
  new was introduced.

### Still open for Andy

- Whether "2,212 updates shipped" is the number he wants on a public page
  (it is the commit count since 1 May), and whether the stat card stays.
- The page is NOT a draft, so merging the branch and publishing would put it
  live as is. Nothing on it is marked internal any more.
- The site has grown since July: the product pages now live under
  /what-we-do/, and there are /insights, /compare and /customers sections.
  The July Airtable notes about "11 pages" are out of date.

### How the cloud session reached Framer (for next time)

- The claude.ai/code environment must have Network access set to Full (or
  Custom with framer.com and *.framer.com), and the session must be started
  AFTER the change. Verify with a curl to https://api.framer.com/ (302 is
  good).
- `npx @framer/agent@latest setup` installs the `framer` skill. Node 22 is
  enough (the package says >=22).
- `project auth <url>` prints a browser approval link whose callback points
  at 127.0.0.1 INSIDE the container, so the approval cannot land on its own.
  Either paste the address the browser fails to open (it carries the key) or
  create a key under Site Settings, General, API Keys, then run
  `project auth vna1Dww9wfns4nJSst1v <key>`. The key is stored only in the
  container and dies with it; revoke it afterwards in the same screen.
- `session new vna1Dww9wfns4nJSst1v` returns session id 1. Then
  `framer.agent.createBranch("timeline-roadmap")` switched the session onto
  the branch; `getActiveBranch()` confirmed it before every edit.
- Screenshots come back as a `framerusercontent.com` image URL from a
  `readProject` screenshot query; curl it and view. Section-level screenshots
  draw the sticky header over the top of the section, so use the breakpoint
  id for a true full-page shot.
- The lint warning "visible siblings in a stack might be too close" with
  negative spacing on the page breakpoint was a stale measurement, not an
  overlap; the screenshots showed the sections stacked correctly.
- `height="1fr"` cannot be set on a replica (breakpoint) descendant; use
  `height="100%"` for a grid child that should fill its row.
- Inline text styles (fontSize, fontWeight, lineHeight) are IGNORED while a
  text style preset is set on the node, and the command reports an error.
  Detach first with `textStylePreset="null"` in its own command (this inlines
  the preset's styles), then set the overrides. Colour overrides on a preset
  node are allowed.
- SETTING `text` ON A RICH TEXT NODE RESETS ITS STYLES to the defaults (16px,
  weight 400, black, start-aligned) and drops its preset. For a copy change
  use `framer.agent.replaceText`, or re-apply the preset and inline styles in
  a second command without `text`. Cost today: five headings and two stat
  numbers went plain until restyled.
- Chromium in this container cannot reach the web: the TLS-inspecting proxy
  closes the tunnel on the browser's hello (both with and without the
  post-quantum key share). Do not spend time on it. Framer's screenshot
  service takes screenshots of public URLs from Framer's side and returns a
  framerusercontent.com image; use that for mockups.
- `framer.uploadImage({ image: { bytes: <Node Buffer>, mimeType }, name,
  altText, resolution: "large" })` works from an exec script (pass the
  Buffer itself, not a `new Uint8Array` made inside the sandbox) and returns
  the asset `url` to use as a frame `fill`.
- A `CountUp` code component now exists in the project (CountUp.tsx), so the
  July note that count-ups need a code component that does not exist is out
  of date. The chips stayed static anyway, per the brief.
