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
npm run test:tripbuster
```

86 assertions across four layers:

- payload validation (whitelisting, enums, URL and date rules)
- token handling (tampering, expiry, scope confusion)
- the HTTP handlers against an in-memory PostgREST stand-in — which is what lets
  the suite prove one agent cannot read, edit or delete another's deals
- tracking and privacy: that a raw IP never reaches a stored row, that the hash is
  salted, that a repeat click is recorded but not billable, and that a crawler's
  impressions are not counted

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
