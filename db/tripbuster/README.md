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
npm run test:tripbuster           # 188 assertions, no network needed
npm run test:tripbuster-import    # 54 assertions, drives the import UI in Chromium
```

`test:tripbuster` covers six layers:

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

Both stand-ins are **real HTTP servers on localhost** — PostgREST and Upstash REST
— rather than stubbed modules, so the code under test runs its own fetch, parse
and error paths. The PostgREST stand-in enforces the UNIQUE
`(agent_id, external_ref)` index from migration 006, so duplicate handling is
exercised rather than taken on trust.

`test:tripbuster-import` drives the whole import journey in a real browser:
template download, a genuine file upload through `FileReader`, mapping an
unrecognised heading, the preview, the commit, a re-upload that updates instead of
duplicating, the publish switch, the non-Travelgenix upsell, the connected offer
browser, an import, a resync, and the history list. It asserts no uncaught
JavaScript anywhere in the journey. Screenshots go to a temporary directory, or to
`TB_SHOT_DIR` if you set one.

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

## Demo data

```
db/tripbuster/seed-demo.sql
```

Three invented agencies, 34 deals (26 live, 6 draft, 2 paused) across 11
countries, and 30 days of traffic. Safe to re-run: it clears and rebuilds only
what belongs to those three agencies, so it doubles as a reset button.

Four properties are advertised by more than one agency on purpose, because the
multi-agent price compare is the thing worth showing:

| Property | Advertised by |
|---|---|
| Sol Pelicanos Ocean, Benidorm | all three, at £329 / £342 / £355 |
| Balaia Golf Village, Albufeira | Sunseeker, Coastline |
| Louis Phaethon Beach, Paphos | Coastline, Jetaway |
| Melia Costa del Sol, Torremolinos | Sunseeker, Coastline |

Each agency is set up to show a different part of the product: Coastline carries
a `tg_client_email` so the live-feed import is connected for them and the upsell
panel shows for the other two, and Jetaway sits on Boost with exactly its 5 live
deals used so the plan limit is demonstrable rather than described.

**Clicks are expanded from `deal_daily_stats`, never invented alongside it.**
`tb_agent_stats` reads impressions and clicks from the daily table and billable
clicks from `click_events`, so generating the two independently produces an
impossible click-through rate — which is exactly what happened the first time
this was seeded. Randomness comes from hashes of each row rather than `random()`,
so re-running gives the same demo and a screenshot stays true.

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
- **`click_events`** — one row per click-out. This is the billable event, so it is
  stored per event rather than aggregated. **No raw IP addresses**: only a salted
  hash, for de-duplication and abuse detection, per UK GDPR data minimisation.
- **`deal_daily_stats`** — impressions run orders of magnitude higher than clicks
  and are only ever read in aggregate, so they are upserted into a daily counter
  instead of stored per event.
- **`import_runs`** — one row per bulk import, with what it created, updated,
  skipped and refused. Counts are stored rather than derived because deals can be
  edited or deleted afterwards and the run should still say what happened at the
  time. Andy relies on the dashboard as an external record, so an import has to
  be readable back later rather than living only in a toast that has gone.

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

## Seed data

The project currently holds development seed data: three agents
(Sunseeker Travel on Boost, Coastline Holidays on Ignite, Jetaway Travel on Spark)
and five live deals. Two details are deliberate:

- Three deals are the **same hotel** (Sol Beach Benidorm) at different prices, so
  the multi-agent compare can be exercised.
- Jetaway is on Spark, whose allowance is one live deal, and already has one — so
  it is the account that exercises the plan-limit path.

All three seed agents share a throwaway development password. **Rotate or clear it
before anything goes public**; it is not recorded in this repo.

Clear the seed with:

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
