# Tripbuster — database

Tripbuster is an **advertising platform**, not a travel company. Independent UK
travel agents advertise holiday deals; travellers click through and book on the
agent's own site under the agent's own financial protection. Tripbuster never
takes a booking, never holds customer money, and needs no ATOL of its own.

It is a **separate product** from the Travelgenix widget suite, so it has its own
Postgres project rather than sharing the Widgets Airtable base.

## Project

| | |
|---|---|
| Supabase project | `tripbuster` |
| Ref | `kdaavrqqapizashvlecb` |
| Region | `eu-west-2` (London) |
| URL | `https://kdaavrqqapizashvlecb.supabase.co` |

## Required environment variables (Vercel)

All three are **server-side only** and must never reach the browser.

```
TRIPBUSTER_SUPABASE_URL               = https://kdaavrqqapizashvlecb.supabase.co
TRIPBUSTER_SUPABASE_SERVICE_ROLE_KEY  = <service_role key>
TRIPBUSTER_SESSION_SECRET             = <random string, min 32 chars>
```

Get the service role key from the Supabase dashboard:
**Project settings → API keys → `service_role`**. It is deliberately not recorded
in this repo or in any chat transcript.

`TRIPBUSTER_SESSION_SECRET` signs agent session tokens. It is **separate from
`TG_SESSION_SECRET` on purpose**: a leaked Travelgenix secret must not be able to
mint Tripbuster agent sessions, or the reverse. Generate one with
`openssl rand -base64 48`.

Until these are set the endpoints degrade honestly rather than erroring:
`/api/tripbuster/deals` returns a clean `503` with an empty deal list, and sign-in
returns `503`. Deploying ahead of them is harmless.

Optional rate-limit overrides (defaults in brackets):

```
RL_TB_DEALS_PER_MIN (90)   RL_TB_DEALS_PER_HR (1500)
RL_TB_CLICK_PER_MIN (30)   RL_TB_CLICK_PER_HR (400)
RL_TB_LOGIN_PER_MIN (6)    RL_TB_LOGIN_PER_HR (40)
RL_TB_IMPRESSION_PER_MIN (60)  RL_TB_IMPRESSION_PER_HR (900)
```

Optional:

```
TRIPBUSTER_IP_SALT — dedicated salt for hashing visitor IPs.
```

When it is absent one is derived from `TRIPBUSTER_SESSION_SECRET` under a fixed
label, so the salt is never the signing secret itself and tracking works without a
second variable to set. Set a dedicated salt if you ever want to rotate the
session secret without resetting click de-duplication.

## Endpoints

| Endpoint | Auth | Notes |
|---|---|---|
| `GET /api/tripbuster/deals` | public | Consumer search, widget feed, compare panel. CDN-cached. |
| `POST /api/tripbuster/login` | public | Agent sign-in, returns a 24-hour bearer token. |
| `GET/POST/PATCH/DELETE /api/tripbuster/my-deals` | agent token | Agent-scoped deal management. `?days=` sets the stats window. |
| `POST /api/tripbuster/click` | public | Records a click-out and returns the agent's booking URL. |
| `POST /api/tripbuster/impressions` | public | Batched impression counts, one call per widget render. |
| `GET/POST /api/tripbuster/import` | agent token | Spreadsheet import. `?format=csv` is the template, `?history=1` past runs. `mode=preview` writes nothing. |
| `GET/POST /api/tripbuster/offer-import` | agent token | Live offer cache. `GET` browses, `POST` imports chosen refs, `{resync:true}` refreshes prices. |
| `GET/PATCH /api/tripbuster/account` | agent token | Billing mode, phone, opening hours, special days, extra numbers. Deliberately cannot touch plan, status or the Travelgenix link. |
| `POST /api/tripbuster/lead` | public | A callback request. Needs a name plus a phone number or an email address. |
| `GET/PATCH /api/tripbuster/my-leads` | agent token | The agency's enquiry inbox, and marking an outcome against one. |

Public read endpoints send a wildcard CORS origin because the widget runs on
customer sites and the data is deliberately public. The authenticated endpoints
send **no** CORS headers at all, so they are same-origin only.

`my-deals` takes `agent_id` from the token and never from the body, and its
updates and deletes filter on `agent_id` as well as `id`. A valid session plus a
guessed deal id returns `404`, the same as a deal that does not exist — there is
nothing to probe.

## Tracking, and what is deliberately not stored

Click-outs are the billable event. Impressions exist so click-through rate means
something. Under UK GDPR data minimisation, neither stores more than it needs:

- **No raw IP addresses.** Only a salted SHA-256, truncated. The salt matters: an
  unsalted hash of the IPv4 space is small enough to reverse by brute force.
- **No full user-agent strings.** Only a coarse family (`chrome`, `safari`, `bot`).
- **No full referrer URLs.** Only the host, so a referrer carrying an email
  address or session token in its query string cannot leak into the database.
- **Impressions store nothing per visitor at all** — they are a counter.

`leads` is the one deliberate exception, and a different thing entirely: a person
typed their name and contact details in and asked to be rung back, so storing
them is the whole purpose rather than a side effect. The form says which agency
receives them and that they are not used for anything else, and the row carries
the same minimised tracking fields as everything else — which the agency is not
shown.

Two behaviours worth knowing:

- A repeat click on the same deal from the same hashed IP within 30 minutes is
  **recorded but flagged not billable**. Keeping the row means refresh-happy
  visitors and click fraud stay visible; the agent is billed once. `billableClicks`
  in `tb_agent_stats` is the figure to bill on, not `clicks`.
- **Bots are treated asymmetrically on purpose.** A bot's click is recorded and
  flagged (it happened, and the pattern is worth seeing) but a bot's impression is
  dropped entirely, because counting it would dilute a real agent's click-through
  rate. Crawlers get a `200` so they have no reason to retry.

The widget never intercepts the CTA. The anchor points at the agent's own URL and
the click is reported with `sendBeacon` alongside it, so middle-click, copy-link
and a JS-blocked browser all still reach the agent — a tracking failure costs a
count, never the visit. Set `track: false` on the widget for previews; the
dashboard's editor preview does exactly that so an agent cannot inflate its own
impressions.

## Tests

```
npm run test:tripbuster           # 277 assertions, no network needed
npm run test:tripbuster-import    # 90 assertions, drives the dashboard in Chromium
npm run test:tripbuster-call      # 42 assertions, drives the call journey in Chromium
```

`test:tripbuster` covers seven layers:

- payload validation (whitelisting, enums, URL and date rules)
- token handling (tampering, expiry, scope confusion)
- the HTTP handlers against an in-memory PostgREST stand-in — which is what lets
  the suite prove one agent cannot read, edit or delete another's deals
- tracking and privacy: that a raw IP never reaches a stored row, that the hash is
  salted, that a repeat click is recorded but not billable, and that a crawler's
  impressions are not counted
- the spreadsheet parser: quoted fields, embedded newlines, doubled quotes, BOMs,
  CRLF, tab and semicolon delimiters, European decimal commas, Excel date serials,
  day-first dates, and the header synonyms agents actually type
- the live offer cache: staleness, filtering, dedupe across pools, the
  non-Travelgenix gate, and that a resync refreshes prices without touching copy
- pay per call: mode resolution in both directions, what each mode needs before
  it can go live, the `both` fallback, and that the settings screen cannot be
  used to upgrade a plan or unsuspend an account
- calls and callback requests: that a tap with no telephony detail is charged,
  that only an explicit non-connection or a short duration takes that away, the
  24 hour de-duplication, the phone-or-email rule, the honeypot, and that the
  enquiry inbox never hands an agency the visitor tracking columns
- opening hours, including the boundary cases that actually bite: the closing
  instant, a split shift's lunch gap, a special day that closes outright, a
  24-hour day stored as `00:00`-`24:00`, and **the same weekday time in January
  and in July**, which is the test that proves storing local wall-clock times
  rather than UTC offsets was the right call

Both stand-ins are **real HTTP servers on localhost** — PostgREST and Upstash REST
— rather than stubbed modules, so the code under test runs its own fetch, parse
and error paths. The PostgREST stand-in enforces the UNIQUE
`(agent_id, external_ref)` index from migration 006, so duplicate handling is
exercised rather than taken on trust.

`test:tripbuster-import` drives the whole import journey in a real browser:
template download, a genuine file upload through `FileReader`, mapping an
unrecognised heading, the preview, the commit, a re-upload that updates instead of
duplicating, the publish switch, the non-Travelgenix upsell, the connected offer
browser, an import, a resync, and the history list. It also covers the billing
screen: choosing a mode, being refused a switch to calls with no number, and the
performance tiles swapping click-through rate for calls. It asserts no uncaught
JavaScript anywhere in the journey. Screenshots go to a temporary directory, or to
`TB_SHOT_DIR` if you set one.

`test:tripbuster-call` runs the deal page twice, once as a laptop and once as a
phone, using Chromium's **real touch and pointer emulation** rather than a faked
user agent, so the page's own capability test is what decides. It covers the
desktop reveal and the mobile dial, both being recorded, the compare drawer
offering each agency its own route, a click-first agency showing no call button
at all, and the callback form including its phone-or-email refusal and its bot
trap. It also measures that the revealed number sits on one line — counted with
a Range over the text node, which gives one rectangle per line box, because
dividing the element's height by its line height just measures the padding.

The advertiser dashboard is additionally driven in a real browser with puppeteer
(33 assertions), covering sign-in, publishing, the plan limit, and the widget's
impression and click beacons actually firing.

## Access model — fail closed

Every table has **RLS enabled with no policies**, and `anon`/`authenticated` have
all privileges revoked. The anon key can do nothing at all. Reads and writes only
work with the service role, which lives in the Vercel API layer. Supabase's linter
reports four `rls_enabled_no_policy` INFO notices for this — that is the intended
design, not an oversight.

All consumer reads go through `tb_search_deals`, whose arguments are bound typed
parameters, so query-string input cannot alter the query shape.

## Migrations

Apply in order. They are idempotent enough to run on a fresh project.

| File | What it does |
|---|---|
| `001_init.sql` | `agents`, `deals`, `click_events`, `deal_daily_stats`; indexes; RLS lockdown |
| `002_move_pg_trgm.sql` | Moves `pg_trgm` out of `public` into `extensions` |
| `003_search_function.sql` | `tb_search_deals` — the single consumer read path |
| `004_agent_auth.sql` | `password_hash` / `last_login_at` on agents; `tb_agent_deal_counts` |
| `005_tracking.sql` | `tb_record_click`, `tb_record_impressions`, `tb_agent_stats` |
| `006_import.sql` | UNIQUE `(agent_id, external_ref)`; `deals.synced_at`; `import_runs`; `tb_agent_source_counts` |
| `007_pay_per_call.sql` | `billing_mode` on agents and deals; call columns on `click_events`; `deal_daily_stats.calls`; relaxed live-deal constraint |
| `008_calls_and_leads.sql` | Corrects the call billing rule to "billable unless"; `leads` table; `tb_record_lead`; `tb_agent_lead_counts`; `deal_daily_stats.leads` |
| `009_hours_and_numbers.sql` | `agent_hours`, `agent_special_days`, `agent_phones`; `tb_agent_is_open`; `tb_agent_contact`; `tb_save_agent_settings`; `click_events.out_of_hours`; drops the database's route check |

Migration 008 replaces `tb_record_click` rather than altering it. Adding
parameters to a Postgres function creates an **overload**, and with defaults in
play a call can then match both signatures and fail with "function is not
unique", so the old signature is dropped first. Re-running the file is safe.

## Demo data

```
db/tripbuster/seed-demo.sql
```

Three invented agencies, 34 deals (26 live, 6 draft, 2 paused) across 11
countries, and 30 days of traffic: roughly 124,000 cards shown, 3,000
click-throughs, 440 calls and 100 callback requests. Safe to re-run: it clears
and rebuilds only what belongs to those three agencies, so it doubles as a reset
button.

Four properties are advertised by more than one agency on purpose, because the
multi-agent price compare is the thing worth showing:

| Property | Advertised by |
|---|---|
| Sol Pelicanos Ocean, Benidorm | all three, at £329 / £342 / £355 |
| Balaia Golf Village, Albufeira | Sunseeker, Coastline |
| Louis Phaethon Beach, Paphos | Coastline, Jetaway |
| Melia Costa del Sol, Torremolinos | Sunseeker, Coastline |

Each agency is set up to show a different part of the product. Coastline carries
a `tg_client_email` so the live-feed import is connected for them and the upsell
panel shows for the other two. Jetaway sits on Boost with exactly its 5 live
deals used, so the plan limit is demonstrable rather than described. And each is
on a different billing mode:

| Agency | Charges for | Qualifying call length |
|---|---|---|
| Sunseeker | clicks | n/a |
| Jetaway | calls | 60 seconds |
| Coastline | both | 90 seconds |

The qualifying lengths are stored and shown but change nothing in the figures,
because no tracked number is feeding durations in. That is the point: the demo
shows the setting existing without pretending it is doing work.

**Opening hours are set on the two that take calls, and deliberately differently:**

| Agency | Hours | Extra numbers |
|---|---|---|
| Sunseeker | always available (they sell on clicks, so hours would be noise) | — |
| Jetaway | weekdays 9–5:30, Saturday morning, **shut Sundays** | an out-of-hours mobile |
| Coastline | seven days, late on Thursdays | Brighton shop, cruise desk, evenings mobile |

That contrast is the demonstration. Jetaway loses about a quarter of its calls to
being closed and takes most of its callback requests then; Coastline, open all
week, loses under a tenth. Same feature, very different effect, which is a more
honest thing to show than two agencies that both look the same.

**Call times are drawn from a weighted spread, not a flat one.** Most people ring
a travel agent during the working day with a tail into the evening. A flat
8am-to-10pm spread put 62% of Jetaway's calls outside their own opening hours,
which is not a figure any real agency would recognise and would have undersold the
product on a demo.

**Most out-of-hours calls are then dropped**, because of what the site actually
does: faced with a closed shop the page leads with the callback form, so the
majority of those people leave their details instead of pressing a number nobody
will answer. One in three is kept — the real minority who ring anyway.

That dropping is why **`deal_daily_stats.calls` is recomputed from the events**
afterwards rather than the events being expanded from it. The counter it started
from is no longer the number the events add up to, and those two disagreeing is
precisely the bug that produced a 350% click-through rate the first time this was
written. Deriving one from the other makes them equal by construction.

Two deals deliberately disagree with their agency, so the per-deal override is
something you can point at — it is why a click-first Sunseeker still takes a few
calls. Jetaway earns no click-throughs at all, because a call-first card shows a
number rather than a booking link.

**Clicks, calls and enquiries are all expanded from `deal_daily_stats`, never
invented alongside it.** `tb_agent_stats` reads impressions and clicks from the
daily table and billable clicks from `click_events`, so generating the two
independently produces an impossible click-through rate — which is exactly what
happened the first time this was seeded.

**Calls are seeded with `call_seconds` and `call_connected` left null**, because
that is what the real code path produces. An earlier version wrote qualified
calls straight into the table and so demonstrated a capability the platform does
not have.

Randomness comes from hashes of each deal's own REFERENCE **and the date**,
rather than from `random()` or the row id, so re-running gives exactly the same
demo and a screenshot stays true. Both halves of that key were learned the hard
way: keying on the id broke reproducibility, because deal ids are regenerated on
every run, and leaving the date out gave a deal with one call a day the same
hour, the same browser and the same billable answer on all thirty days, which
showed up as whole deals earning nothing at all.

Sign-in is **not** part of the seed: no working credential belongs in the repo.
The file ends with the one statement to run afterwards, and the one to clear the
hashes again before anything is exposed publicly.

## Tables

- **`agents`** — the advertisers. Slug, contact details, their own ATOL/ABTA
  numbers (displayed as a trust badge only, never verified by us), plan tier, and
  `default_clickout_url` used as a fallback for imported deals. `tg_client_email`
  links an agent to a Travelgenix client, which unlocks the live-offer-cache
  import route.
- **`deals`** — field groups mirror the nine sections of the advertiser deal
  editor. Three generated columns do work the application would otherwise
  duplicate and get wrong:
  - `discount_pct` — derived from `was_price` / `price_from`, so the saving on a
    card can never drift from the prices.
  - `property_key` — normalised `accommodation|resort`, which groups the same
    hotel advertised by different agents. This is what powers the multi-agent
    price compare without asking agents to match a central property record. A
    canonical `properties` table can replace it later without breaking anything.
  - `search_vector` — full-text index over the fields travellers actually type.
  A CHECK constraint refuses to let a deal go `live` without both a price and a
  click-out URL, so a broken card can never reach a traveller.
- **`click_events`** — one row per billable event, which despite the name now
  means a click-out, a call or a callback request: `event_type` says which. They
  share a table because they are the same thing commercially, they de-duplicate
  the same way, and a bill has to be able to add them up. Stored per event rather
  than aggregated, because that is what an agency queries when it disputes a
  charge. **No raw IP addresses**: only a salted hash, for de-duplication and
  abuse detection, per UK GDPR data minimisation.
- **`leads`** — the callback requests themselves, with the contact details the
  agency needs to reply and an outcome the agency sets. Separate from
  `click_events` because it holds personal data on a different footing and has a
  life after the charge: the agency works through it, marks people contacted or
  booked, and comes back to it.
- **`deal_daily_stats`** — impressions run orders of magnitude higher than clicks
  and are only ever read in aggregate, so they are upserted into a daily counter
  instead of stored per event. It also carries the daily click, call and lead
  counts, and every one of those is expanded from here rather than counted
  independently, so the meters cannot disagree.
- **`import_runs`** — one row per bulk import, with what it created, updated,
  skipped and refused. Counts are stored rather than derived because deals can be
  edited or deleted afterwards and the run should still say what happened at the
  time. Andy relies on the dashboard as an external record, so an import has to
  be readable back later rather than living only in a toast that has gone.

## Pay per click, pay per call, or both

Many independent agencies are phone-first, and a few have no booking engine at
all. Those are exactly the agencies the big comparison sites shut out, so the
call is arguably the more natural billable event for part of this market.

Set at two levels: `agents.billing_mode` is the agency default, and
`deals.billing_mode` overrides it. **The override resolves on READ**, which is
deliberately the opposite of how protection and booking links work. Those are
content, copied onto the deal when it is written. Billing mode is a commercial
setting, so switching an agency from click to call has to take effect across
every one of their deals at once rather than needing hundreds of rows rewritten.
A null on the deal means inherit.

The same `coalesce` appears in `tb_search_deals`, `tb_record_click` and
`resolveBillingMode` in `deal-write.js`. Change one, change all three.

**What each mode needs before it can go live** is enforced in `publishBlockers`,
not in a constraint, because the resolved mode depends on the agents row and a
CHECK cannot see it. The database keeps the weaker "a price plus at least one
route" rule as a backstop.

| Mode | Needs | If a route is missing |
|---|---|---|
| `click` | a booking link | refused |
| `call` | a phone number | refused |
| `both` | either one | publishes, showing whatever it has |

That last row is the fallback: a `both` deal with no booking link simply becomes
a call-only card rather than being blocked.

### What counts as a call, and what is charged for

**We do not own the agency's phone number.** The traveller rings the agency
directly, so nothing tells us whether the phone was answered or how long the
conversation lasted. The billable event is therefore the **deliberate act**, the
same as it is for a click:

- **On a phone**, the call button is a `tel:` link. A tap dials and is charged.
- **On a desktop**, it is a "Show number" button. Pressing it reveals the number
  and is charged, because nobody presses it by accident. The revealed number is
  still a `tel:` link so a laptop with a softphone can use it.

Which one a visitor gets is decided by `matchMedia('(hover: none) and
(pointer: coarse)')` — what the device can actually do, not what its user agent
claims to be.

`tb_record_click` starts from "billable unless we have a reason it is not", and
the reasons are the same two that apply to clicks: it looked automated, or it
repeats a recent event from the same visitor. **Telephony detail, if a tracked
number ever supplies it, can only take billing away** — an explicit
`call_connected = false`, or a duration under the agency's `call_min_seconds`,
marks a call unbillable. It can never add billing back, so a call is never
charged for twice and the missing detail never blocks a genuine one.

Calls de-duplicate over 24 hours rather than 30 minutes, keyed on the caller
where we have them: the same person ringing twice in a day is one enquiry.

`agents.tracked_number` and `call_min_seconds` exist for the day tracked numbers
are added. Until then `call_min_seconds` is stored and shown but never fires,
which is the honest position — the earlier version of this rule required proof
of connection and so quietly made **every** call unbillable.

### Opening hours

The corrected call rule above has one uncomfortable edge: a traveller tapping at
eleven at night gets no answer, and that tap is still a deliberate act. Opening
hours close it, and they close it by **keeping the enquiry rather than throwing it
away**:

| | Out of hours |
|---|---|
| A call | recorded, flagged `out_of_hours`, **not charged for** |
| A callback request | recorded, flagged, **still charged for** |

That asymmetry is the whole design. A call to a shut shop is worth nothing to the
agency, so they should not pay for it. A callback left at midnight is worth *more*
than a ring into an empty room: it arrives with a name and a way to reply, and it
is the enquiry that would otherwise have been lost. So the closed state does not
remove the call to action, it **changes** it — which is why the default
`closed_behaviour` is `callback` rather than `hide`.

`hours_mode` defaults to `always`, so nothing changes for any agency until they
actually fill the form in.

**Times are stored as local wall-clock times** against `agents.time_zone`, never
as offsets from UTC. That is the whole reason British Summer Time needs no thought
anywhere in the system: nine in the morning is nine in the morning in January and
in July, and `at time zone` does the work. Storing offsets would have meant
editing every agency's hours twice a year. There is a test for exactly this.

Structure:

- **`agent_hours`** — one row per period, so a shop that shuts for lunch is two
  rows rather than a special case. **No rows for a day means closed that day**,
  which is why a missing Sunday needs no "closed" flag beside it. `day_of_week`
  matches `extract(dow)` and JavaScript's `getDay()` (0 = Sunday) so neither side
  has to shift it. A period runs from `opens` **inclusive** to `closes`
  **exclusive**, so a 17:30 close is shut at 17:30 rather than charging for a call
  as the door is locked. `time '24:00'` is a real Postgres value and means end of
  day, so a genuinely round-the-clock Saturday is `00:00`–`24:00` rather than a
  magic flag. Periods that wrap past midnight are deliberately refused: no travel
  agency is open 23:00–01:00, and allowing it would make "when do you next open"
  ambiguous for the sake of nobody.
- **`agent_special_days`** — bank holidays, the Christmas shutdown, a late night.
  A special day **replaces** the weekly pattern for that date rather than adding to
  it, because "closed on Boxing Day" has to override "open Fridays". Null times
  mean closed all day.
- **`agent_phones`** — the extras. `agents.phone` stays **the** primary number:
  it is what every deal falls back to and what the write path and settings screen
  already reference, and duplicating it into this table would create two places to
  change it and one of them to forget. `tb_agent_contact` returns the primary
  first, then these. `when_shown` is `always`, `open` or `closed`, resolved against
  the same hours — an out-of-hours mobile shown at ten in the morning is simply the
  wrong number.

**`click_events.out_of_hours` records WHY a call was not charged for**, rather
than leaving it to be worked out later from the hours. Hours change: an agency that
starts opening on Sundays must not retrospectively turn last month's unbilled
Sunday calls into billed ones, and an auditor asking "why was this one free"
deserves an answer from the row itself. `tb_agent_stats` reports it as
`afterHoursCalls` and `afterHoursLeads`, and the dashboard shows it, because the
demand an agency is currently turning away is the number it needs in order to
decide whether Saturday is worth staffing.

#### The rules live in three places, on purpose

| Copy | Asks the question to decide | Authority |
|---|---|---|
| `tb_agent_is_open` (migration 009) | what to **charge** | **yes** |
| `isOpenAt` in `api/_lib/tripbuster/hours.js` | validate, and answer the API | no |
| `openState` in `public/tripbuster/tb-site.js` | what to **show** | no |

The duplication is deliberate and is not free. It exists because
`GET /api/tripbuster/deals` is **CDN-cached**, so the response cannot carry a
computed "open right now" — a cached yes would still read yes an hour after
closing time. `tb_agent_contact` therefore hands out the **schedule**, which
cannot go stale, and the page evaluates it. The database then evaluates it again
from its own clock when there is money involved, so a page that was cached, left
open overnight or edited by hand cannot mint a chargeable out-of-hours call.

`tb-site.js` is a classic script rather than a module, so it cannot import the
API's copy. The mitigation is a test that runs **both JavaScript copies against
the same table of cases** and fails if they ever disagree; that same table was
checked against the SQL copy by hand when 009 was applied. Change a rule in one
place and that test will tell you about the other.

#### A deal's phone is now an override, not a copy

Before 009, saving a deal copied the agency's number onto it. With one number that
was invisible. With several it would pin every deal to whichever number happened
to be primary that day, and no amount of hours routing would ever reach it.

`booking_phone` now means "this deal rings somewhere different"; null means "use
whichever of the agency's numbers applies right now". The read path already
coalesced in that order, so nothing about a single-number agency changed.

This is also why **009 drops the database's route check**. The old constraint
required a live deal to carry a link or a phone *on its own row*, and a valid
call-only deal now carries neither — so the check would refuse it, and would have
refused the migration itself on any agency whose only route was the inherited
number. That check was never able to judge a route correctly anyway: the resolved
billing mode and the agency's numbers both live on the agents row, and a CHECK
cannot see them. `publishBlockers` can, and does. The database keeps the half it
can verify, which is that a live deal needs a price.

### Callback requests

A traveller who does not want to ring can leave their details instead, and
`leads` holds those. The constraint that matters is
`coalesce(phone,'') <> '' or coalesce(email,'') <> ''`: **a name plus a phone
number or an email address**, either one on its own being enough. Insisting on a
phone number would lose the people who would rather be emailed, which for a
phone-first agency is exactly the wrong trade.

A lead is recorded as a `lead` event in `click_events` too, so the enquiry
inbox and the meter cannot disagree. The form carries a honeypot field, and a
bot that fills it in gets a cheerful `200` and is dropped. The endpoint never
echoes back what was submitted, so it cannot be used to reflect content at
anyone. `my-leads` hands the agency the contact details it needs to reply and
deliberately withholds the visitor tracking columns — `ip_hash`, `ua_family`
and `referrer_host` are ours for abuse detection, not the agency's to browse.

## The three ingestion routes

Every route ends in the same `deals` table and every route applies the same
publish rules, which is why those rules live in
`api/_lib/tripbuster/deal-write.js` rather than in any one handler. `source`
records which route created a deal and is always set server-side — a caller
cannot forge it.

| `source` | Route | Dedupe key |
|---|---|---|
| `manual` | the deal form in the dashboard | none |
| `spreadsheet` | CSV upload | `external_ref` = `sheet:<reference>` |
| `live_cache` | the Travelgenix offer cache | `external_ref` = `cache:<id>\|<origin>\|<type>` |

`external_ref` is UNIQUE per agent (migration 006). That is what makes
re-uploading the same sheet an **update** rather than a second copy of every
deal, and it turns two simultaneous uploads into a reported conflict instead of
silent duplicates. The two namespaces cannot collide.

**The spreadsheet route always previews before it writes.** The preview shows the
dates and prices we read back, because a spreadsheet is a blunt instrument and
`01/02/2027` needs to be visibly 1 February before anything is saved. Dates are
read **day first**, and a row with more cells than the header is reported rather
than guessed at — that pattern almost always means an unquoted comma in a price,
which would otherwise import `£1,299` as `1`. **Commit re-parses the raw text**
and never trusts the normalised rows the preview returned.

**The live-cache route reads Redis directly** rather than calling
`GET /api/cached-offers`. That endpoint is public and rate-limited per IP, so a
server-to-server call would put every agent behind one Vercel egress IP and spend
the budget that exists to protect customer widgets. The contract is the stored
offer shape written by `normaliseOffer` in `api/cron/refresh-map-offers.js`, and
the same 70-hour staleness rule is enforced independently on read so a stalled
cron can never let a stale price reach a traveller.

The client sends only the **references** of the offers it wants; the deal itself
is rebuilt server-side from the cache. A hand-edited request can choose which
offers to import but never what they say.

**A resync refreshes prices, not copy.** Only the fields in `RESYNC_FIELDS` move
(price, was-price, currency, travel window, nights, board). An agent who rewrote a
headline or added selling points keeps that work. An offer that has left the feed
gets its deal **paused, not deleted** — the holiday is off sale, but the agent's
edits are still worth keeping.

## Plan limits are deliberately not in the schema

Per-plan deal limits (Spark / Boost / Ignite / Bespoke) are enforced in the API,
not the database, because the pricing model is still an open decision. Keeping
them out means the numbers can change without a migration.

## Clearing the seed

The development project holds the demo data described above and nothing else.
All three seed agents share a throwaway development password. **Rotate or clear
it before anything goes public**; it is not recorded in this repo, and the last
statement in `seed-demo.sql` is the one that clears it.

Re-running `seed-demo.sql` is the normal reset, since it rebuilds only what
belongs to the three demo agencies and leaves the password hashes alone. To
remove them altogether:

```sql
delete from public.deals;
delete from public.agents;
```

## Registration is not built yet

There is no self-service sign-up endpoint. Agents are created directly in the
database and a password hash is set for them. Registration needs its own thinking
(email verification, abuse control, which plan a new account lands on) and that
last part depends on the pricing decision, so it is deliberately a later piece of
work rather than something half-built here.
