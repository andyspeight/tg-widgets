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

<!-- MILESTONES -->

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
