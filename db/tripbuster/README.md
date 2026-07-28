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

One more, optional today and **required before anything is indexed**:

```
TRIPBUSTER_SITE_ORIGIN                = https://tripbuster.co.uk
```

Every canonical URL, every `og:url` and every entry in the sitemap is written
against it. Left unset it falls back to whichever host answered the request,
which is honest but means `tg-widgets.vercel.app`, `widgets.travelify.io` and
each preview deployment all canonicalise to themselves. Two hosts serving the
same pages with no shared canonical is the textbook way to split one page's
ranking in half, so set this the moment Tripbuster has a domain.

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

### Email

Sign-up and enquiry notifications both send mail, through the same SendGrid
wrapper the widget suite uses:

```
SENDGRID_API_KEY          shared with the widget suite
SENDGRID_FROM_EMAIL       verified sender on a domain we control
TRIPBUSTER_FROM_EMAIL     optional, once Tripbuster has its own verified domain
TRIPBUSTER_ADMIN_EMAIL    where new sign-ups go for approval
TRIPBUSTER_AGENT_APPROVAL 'auto' to skip approval. Anything else means manual.
TRIPBUSTER_FREE_UNTIL     YYYY-MM-DD. New sign-ups advertise free until this day.
TRIPBUSTER_ADMIN_PASSWORD Opens the owner console at /tripbuster/admin. Min 12 chars.
```

**Set `TRIPBUSTER_ADMIN_EMAIL`.** Without it a new agency can confirm its email
address and then sit in `pending` with nobody told it is waiting. The code logs
loudly when this happens, but a log is not a person.

Mail is always sent **from our own verified sender**, never from the agency's
address, with Reply-To carrying the address that should get the reply. Sending as
a domain we do not control fails SPF and DKIM and lands in spam, which for "a
customer is waiting for your call" is the worst possible outcome.

Optional rate-limit overrides (defaults in brackets):

```
RL_TB_DEALS_PER_MIN (90)   RL_TB_DEALS_PER_HR (1500)
RL_TB_CLICK_PER_MIN (30)   RL_TB_CLICK_PER_HR (400)
RL_TB_LOGIN_PER_MIN (6)    RL_TB_LOGIN_PER_HR (40)
RL_TB_IMPRESSION_PER_MIN (60)  RL_TB_IMPRESSION_PER_HR (900)
RL_TB_REGISTER_PER_MIN (3)     RL_TB_REGISTER_PER_HR (12)
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
| `GET /api/tripbuster/page` | public | Renders the front page, deal pages and destination pages. Reached through the rewrites in `vercel.json`, never directly. |
| `GET /api/tripbuster/sitemap` | public | `/tripbuster/sitemap.xml`, generated from the live catalogue. |
| `GET /api/robots` | public | `/robots.txt`. A function, not a static file, so the `Sitemap:` line names whichever host answered. |
| `POST /api/tripbuster/register` | public | Agent sign-up. Answers identically whatever happened. |
| `GET /tripbuster/verify` | link | The confirmation link from the sign-up email. Works once. |
| `GET/POST /tripbuster/approve` | signed link | Approve a new agency. The GET only asks; the POST does it. |
| `GET/POST/PATCH /api/tripbuster/admin` | owner password | The owner console: every agency, what they generate, what it is worth, and their free period, rate tier and status. |

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
npm run test:tripbuster-seo       # 42 assertions, the indexable surface
npm run test:tripbuster-signup    # 49 assertions, sign-up, enquiry emails, owner console
npm run test:tripbuster-rates     # 25 assertions, the rate card, free access and disclosure
npm run test:tripbuster-import    # 112 assertions, drives the dashboard in Chromium
npm run test:tripbuster-call      # 43 assertions, drives the call journey in Chromium
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

## Public URLs, and why they are rendered on the server

| URL | What it is |
|---|---|
| `/tripbuster` | Front page |
| `/tripbuster/destinations` | Hub linking to every country and resort |
| `/tripbuster/holidays/<country>` | Country landing page |
| `/tripbuster/holidays/<country>/<resort>` | Resort landing page |
| `/tripbuster/holiday/<slug>` | One deal, and every agent advertising the same hotel |
| `/tripbuster/agents` | Directory of every agency with something live |
| `/tripbuster/agent/<slug>` | One agency: who they are, how to reach them, everything they advertise |
| `/tripbuster/search` | Filter UI. `noindex, follow` on purpose |
| `/tripbuster/sitemap.xml` | Generated from the live catalogue |
| `/robots.txt` | Generated, so the `Sitemap:` line names the right host |

All except `/tripbuster/search` and `/tripbuster/dashboard` are produced by
`api/tripbuster/page.js`. They used to be static files that rendered their whole
body from JavaScript after two round trips, and every deal page carried a
`noindex`. For a comparison site that is not one channel missing, it is the
channel missing.

**Search results are deliberately not indexed.** Every combination of `q`,
`board`, `airport`, `maxPrice` and `sort` is a distinct URL, and letting a crawler
into that space spends the whole crawl budget on near-duplicates of pages we
already publish properly as destination landing pages. `follow` is kept so the
crawler still walks the deal links out of it, and `robots.txt` does **not**
disallow it — a page has to be fetchable for its `noindex` to be readable.

### The markup is not written twice

`public/tripbuster/tb-site.js` is an **ES module**, loaded by the browser with
`<script type="module">` and imported directly by the renderer. One file produces
the HTML on both sides. It was an IIFE assigning `window.TB` until the SEO work;
the alternative to converting it was a second copy of every piece of markup on
the server, and the opening-hours rules already show where that leads.

The constraint that comes with it: **nothing in that file may touch `window`,
`document`, `navigator` or `fetch` at module scope.** Every browser-only call sits
inside a function body the server never reaches. The test suite imports it, which
is what makes a violation fail immediately rather than in production.

### What the browser still does

`bookingPanel()` is re-rendered on load, because that block depends on the clock
(is this agency open) and on the device (does a tap dial or reveal a number) and
the page is cached at the edge for five minutes. Everything above it reads the
same at any hour and is left exactly as the server sent it.

`dialer()` returns `null` on the server rather than guessing, and `callCta()` then
emits both shapes wrapped in `.tb-onphone` / `.tb-ondesk` for a media query to
pick. That way a phone gets a dialable number out of cached HTML with no
JavaScript at all, and never flashes the wrong one first.

### Deal slugs are stable

A slug is minted **once**, when a deal first goes live, and never rewritten. If an
agent corrects a hotel's spelling afterwards the URL stays put, because a URL that
moves loses every link and every ranking pointing at it. Draft deals get no slug:
they have no public page to name. The eight hex characters on the end are the
deal's own id, which is what lets two agents advertise the same hotel in the same
resort and still get one page each.

`/tripbuster/deal?id=<uuid>` still works and **301s** to the real URL. A rewrite
would have left two URLs serving one page, which is the duplicate-content split
the slugs were introduced to avoid.

### One hotel, one page, one URL

A deal page shows every agent advertising the same hotel, so three agents share
one page — and therefore have to share one URL. Each deal carries a
`canonical_slug`: the slug of the **earliest published** deal in its group.
Requesting any other member's slug 301s there, and the sitemap lists one URL per
hotel rather than one per deal. On the demo data that is 21 pages from 26 deals.

**Earliest published, deliberately not cheapest.** The read path returns the
cheapest agent first, so taking the canonical from "whichever row came back"
would move a page's URL every time somebody undercut somebody else. Publication
dates and ids never change; prices change all day. A canonical that moves undoes
the entire point of a stable slug, and the suite has a test that fails if it
starts following the price again.

### What the structured data deliberately does not claim

No `aggregateRating` and no `review`. Deals carry a `guest_score`, but that number
is typed in by the advertising agent and we have not verified it or collected a
single review ourselves. Publishing it as review markup would tell Google we hold
ratings we do not hold: a manual-action risk, and a consumer-protection risk under
the DMCC Act. Showing the agent's score on the page as the agent's score is fine.
Star ratings in the search results have to be earned by collecting real reviews.

## Agent profiles

Added 28 July 2026, migration 016. Until then an agency existed on this site as
a name in small type under a price, and that text went nowhere. The independent
agent is the entire reason to use Tripbuster instead of Icelolly, so leaving them
anonymous was giving away the only thing we have that the big comparison sites
do not.

`/tripbuster/agent/<slug>` shows who they are, where they are, how long they have
been trading, how to reach them, what protection they hold, and everything they
currently advertise. `/tripbuster/agents` lists every agency with something live.
Both are server-rendered like the rest of the public site, both are in the
sitemap, and the agency name on a deal's booking panel now links to the profile.

The name is **not** linked on a deal card in the results list, because the whole
card is already a link and an anchor inside an anchor is invalid HTML.

### The select list is the security boundary

An agency row holds the sign-in address, the password hash, the Travelgenix link,
the rate tier, what they have spent, when their free period ends and a hash of the
IP they signed up from. None of that may reach a traveller.

So `tb_agent_profile` and `tb_agents_public` **name every column they return**.
No `to_jsonb(a)`, no `a.*`, no "everything except". A whitelist fails safe when
somebody adds a column later; a blacklist publishes it. There is a test that reads
a profile and fails if any private column name appears anywhere in the response,
and the same check is written out at the top of the migration for whoever adds the
next field.

A profile returns `null` for an agency that is not `active`, so a paused or
suspended agency 404s rather than lingering with stale deals on it. The directory
only lists agencies with at least one live deal, because an agency with nothing on
is an empty page for a crawler to find.

### What an agency may write about itself, and what it may not

The settings screen accepts `about`, `town`, `region`, `website` and
`foundedYear`. It does **not** accept the ATOL number, the ABTA number, the
protection type, the rate tier, the free period, the plan or the status. The whole
value of an ATOL number on an agency page is that we checked it, so a screen where
an agency types its own is worth nothing.

`about` is plain text on purpose, capped at 1200 characters. The page escapes
everything it renders, and offering markup would mean either trusting agent-written
HTML or writing a sanitiser for the sake of one paragraph.

The structured data is `TravelAgency` — the agency, not Tripbuster. Tripbuster is
not the seller and must not appear as one anywhere in that markup. Still no
`aggregateRating`, for the same reason deal pages carry none.

## The rate card

Decided 28 July 2026.

| | Standard | Premium |
|---|---|---|
| Click-through | 10p | 25p |
| Call | £1 | £2 |
| Details left | £1 | £2 |

Premium also buys **position**: top five in the results, and the headline agency
on a compare card.

Those are defaults, overridable three ways. **Most specific wins:**

| Scope | Beats | Example |
|---|---|---|
| Client + product | everything | Sunseeker pays 50p a click on cruises |
| Client | product, default | Sunseeker pays 30p a click on everything |
| Product | default | everyone pays 4p a click on flight-only |
| Default | — | everyone pays 10p a click |

**A client rate beats a product rate.** If flights are 4p for everyone and
Sunseeker has an agreed 30p, Sunseeker pays 30p on flights. To make one product
cheap for one client, set a client-and-product rate. This surprises people, so it
has its own test.

There is no separate defaults table. The defaults are rows with `agent_id` and
`holiday_type` both null, which makes them the least specific match, so there is
one table, one lookup and one precedence rule rather than a constant in the code
plus three kinds of override to keep in step with it.

### The price is frozen onto the event

`tb_record_click` resolves the rate as the event happens and writes the pence to
`click_events.charged_pence`, alongside the tier and which scope the rate came
from. An invoice sums that column; it never re-runs the rate card.

**So changing a rate only affects events from that moment on.** That is the
intended behaviour and it is what makes a bill defensible in an argument. The
alternative — working the charge out at invoice time — means a rate change
silently re-prices months an agency has already paid for.

The rate is resolved even when the event is **not** billable, and stores zero.
"This call was worth £2 and we did not charge for it" is a different fact from
"we have no idea what this call was worth", and the first is the one an agency
rings up about.

### What an event cost never reaches a browser

`tb_record_click` returns `chargedPence`, and `api/tripbuster/click.js` picks out
only the click-out URL and the phone number. Returning the charge would publish
the rate card one event at a time, and let any agency read every other agency's
rates. There is a test that reads the response construction and fails if it ever
carries a charge.

## Everything here is advertising, and the site says so

Standard agents pay per click, per call and per enquiry. Premium agents pay more
and get position for it. **All of it is advertising**, which shapes the
disclosure into three parts:

| Where | What it says |
|---|---|
| Footer, every page | the whole site is advertising, agents pay when you get in touch, we never add anything to the price |
| `rankingNote()`, any page listing deals | agents can pay to appear higher, and those are marked |
| The `Promoted` badge | this individual listing paid for position |

**The badge says "Promoted", not "Sponsored", deliberately.** On a site where
every listing is paid for, badging five of them "Sponsored" implies the other
twenty are editorial picks — misleading in the opposite direction, and its own
compliance problem. "Promoted" carries the narrower, accurate claim: this one
paid to be higher up than it otherwise would be.

The note appears on every listing page whether or not anything on it is promoted,
because the first half is always true and a disclosure that comes and goes
teaches people that its absence means something.

**The compare list stays cheapest-first regardless of who paid.** A promoted
agency takes the headline slot on a card, but every agent selling the same hotel
is listed underneath in price order, so the cheaper option is always one glance
away. That is the line between advertising and burying the cheaper option, and
it is not a line to move for revenue.

## The owner console

`/tripbuster/admin`, behind `TRIPBUSTER_ADMIN_PASSWORD`. Every agency, what they
are generating, what it is worth, and the three commercial levers: **a free
period, a rate tier, and whether they are trading**.

**A password rather than accounts, for now.** There is one owner, and a users
table with invitations and roles is real work in service of one person. The thing
that actually matters — that this cannot be reached by an agency or by the public
— comes from a separate token **scope**, not from the login mechanism. An agent
token presented here is a 401, and an owner token presented to `/account` is a
401 too. Both directions have tests. When a second person needs this, it wants
turning into proper accounts.

The session is eight hours rather than an agent's twenty-four, because this token
can change what every agency on the platform is charged.

**The free period is set here**, per agency, with a date picker and a "start
charging now" button. That was the only way to set one before this existed short
of writing SQL.

## Free access

Early advertisers get in for nothing. That is a property of the **account**, not
of the rate card: `agents.free_until` is the inclusive last day, and null means
charge normally.

Doing it with zero-pence client overrides would have worked and been worse —
three rows per agency, no expiry, and nothing anywhere saying "free until
January", only a rate that happens to be zero and that somebody has to remember
to delete. A date expires on its own.

`TRIPBUSTER_FREE_UNTIL=2027-01-31` puts every new sign-up on the same terms
ending on the same day. A **date rather than a duration** because the early-days
offer is "free until we go live", which is one moment for everybody, not a
rolling ninety days starting whenever somebody happens to join. Unset, or once
past, new agencies are charged from their first click — no code change needed to
get there, the date simply goes by.

### Every event records what it was worth as well as what it cost

```
list_pence     what the event was worth at that agency's rate
charged_pence  what we actually charged — 0 while free, 0 when not billable
free_period    whether the free period was the reason
```

A free period that shows an agency **£0** teaches them the platform is worth
nothing. So the dashboard says *"142 enquiries this month, worth £186, free until
31 January"*. That sentence is the whole argument for staying when billing
starts, and it cannot be reconstructed later if the number was not kept at the
time.

`free_period` is stamped on the row rather than worked out later from
`free_until`, because free periods get extended. An agency whose trial is
lengthened in March must not have February's charges retrospectively wiped.

`list_pence` is filled in for the ordinary non-billable reasons too — a bot, a
repeat inside the window, a call under the minimum. "This was worth £2 and we did
not charge for it" is the fact an agency rings up about.

### Expected volumes

Andy's expectation at launch is **no more than 100 chargeable events per agency
per week**, mixed across clicks, calls and enquiries. At the standard rates that
is roughly **£160 a month**, or **£340** on premium.

The demo seed is sized against exactly that. Everything downstream is derived
from impressions, so `base_imp` in `seed-demo.sql` is the only dial: change it and
clicks, calls, enquiries and the bill all move together and stay in proportion.

As seeded, over 30 days:

| Agency | Chargeable a week | Worth | Charged |
|---|---|---|---|
| Coastline, premium | 105 | £138.75 | £138.75 |
| Sunseeker, standard, clicks only | 94 | £41.20 | £41.20 |
| Jetaway, standard, on a free run | 32 | £139.00 | £0.00 |

Worth reading the last two rows together: Sunseeker generates three times the
events of Jetaway and is worth a third as much, because clicks are 10p and calls
are £1. That contrast is the argument for the call model, and it is why the demo
carries one agency on each.

## Signing up, and who is allowed to advertise

```
sign up  ──►  pending, unverified
                 │  clicks the emailed link
                 ▼
             pending, verified   ──►  Tripbuster approves  ──►  active
                 │
                 └─ or straight to active, if TRIPBUSTER_AGENT_APPROVAL=auto
```

`verified_at` and `approved_at` are **separate columns because they are separate
facts**: one says the agent owns the mailbox, the other says a human at
Tripbuster said yes. Only `status = 'active'` puts anything in front of a
traveller.

**Manual approval is the default, deliberately.** A verified mailbox is proof of
a mailbox, not of a travel agency, and what gets published here is a holiday
advert with a phone number on it. Approval is a click in an email rather than a
database query, so the friction lands on us rather than on the agency. Set
`TRIPBUSTER_AGENT_APPROVAL=auto` to remove the step entirely.

New agencies land on **Spark**, which allows one live deal. Enough to set
themselves up and prove the thing works, and it bounds what a sign-up that turns
out to be a nuisance can put in front of anybody.

### The sign-up form never says whether an address is taken

Every outcome — brand new, half-registered, or a live agency — returns the same
200 and the same sentence. A form that says "that email is already registered" is
a way to ask, one address at a time, which travel agencies advertise here.

The difference is in which email goes out. A real person who forgot they had
signed up gets told; the person at the keyboard does not.

### The approval link asks before it acts

`GET /tripbuster/approve` renders a page with a button. `POST` does the work.
Mail providers, security appliances and link previewers all follow links in email
before a person sees them, so a GET that approved would mean every agency was
approved by a scanner within seconds and the review step existed only on paper.

The link is HMAC-signed with the session secret under its own purpose string and
expires in a fortnight, so it authorises one thing, for one agency, for a bounded
time, and cannot be replayed as a session. When there is a proper admin area this
should move behind it.

## Enquiry notifications

A callback request used to sit in the database until an agency happened to log in
and find it. That was worst for exactly the enquiries that matter most: out of
hours the callback form IS the call to action, so the ones most likely to go
stale overnight are the ones we deliberately steer people towards.

**The send is awaited, not fired and forgotten.** A serverless function can be
frozen the instant it responds, so work left running after the response may never
happen at all. The traveller waits a few hundred milliseconds longer and the
agency gets told, which is the right way round for the one event on this platform
where a real person is expecting a phone call.

**Claimed before sending.** `tb_claim_lead_notification` stamps `notified_at` and
returns the details in one statement, so two concurrent attempts cannot both
decide they are the one sending — an agency ringing the same customer twice is
worse than a slow email. If the send then fails the claim is released, leaving
the enquiry owed an email rather than silently marked as handled.

**A mail failure never loses the enquiry.** It is already stored and already in
the agency's inbox. The email is the second-best copy of it.

Agencies control this under Settings: an on/off switch, and an optional separate
address, because whoever signs in is often not whoever rings customers back.

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
| `010_all_calls_chargeable.sql` | Every call is billable whatever the hour; `out_of_hours` becomes a reporting flag only |
| `011_seo_slugs_and_destinations.sql` | `tb_slugify`; a stable unique `deals.slug` minted at first publish; `p_deal_slug` and `p_holiday_type` on `tb_search_deals`; `tb_destinations`, `tb_destination`, `tb_sitemap` |
| `012_canonical_deal_page.sql` | `canonical_slug` on every returned row, so one hotel is one page; the sitemap lists pages rather than deals |
| `013_registration_and_notifications.sql` | Verification, approval and notification columns; `tb_unique_agent_slug`, `tb_register_agent`, `tb_verify_agent`, `tb_approve_agent`, `tb_claim_lead_notification` |
| `014_rate_card.sql` | `agents.rate_tier`; the `rate_card` table; `tb_resolve_rate`; the charge stamped onto `click_events`; costs in `tb_agent_stats`; premium placement in `tb_search_deals` |
| `015_free_access.sql` | `agents.free_until`; `list_pence` and `free_period` on every event; `tb_resolve_rate` returns the list price plus a free flag |
| `016_agent_profiles.sql` | `agents.about` and `agents.founded_year`; `tb_agent_profile` and `tb_agents_public`, both on a strict column whitelist; agencies added to `tb_sitemap` |

Migration 008 replaces `tb_record_click` rather than altering it. Adding
parameters to a Postgres function creates an **overload**, and with defaults in
play a call can then match both signatures and fail with "function is not
unique", so the old signature is dropped first. Re-running the file is safe.

## After applying a migration, check it actually landed

Migration 009 taught this the hard way. The file was correct and committed, but
it was applied to the live database in two chunks and one section fell in the
gap: `tb_search_deals` never got its `agent_contact` column. Everything still
worked — no error anywhere — except every deal came back with `contact: null`, so
opening hours and extra numbers were silently inert on the live site while
passing every test locally. It was only caught by reading an actual API response.

Anything that replaces a function can fail this way, because `create or replace`
leaves the old version happily in place if you never run the new one. So after
applying, ask the database what it actually has:

```sql
select p.proname, pg_get_function_identity_arguments(p.oid) as args,
       md5(pg_get_functiondef(p.oid)) as body
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'tb\\_%'
order by p.proname;
```

Then grep the migration for something distinctive the new version contains and
confirm the live definition has it:

```sql
select position('agent_contact' in pg_get_functiondef(p.oid)) > 0
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'tb_search_deals';
```

A `false` there means the migration is in git but not in the database.

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
| Jetaway | weekdays 9–5:30, Saturday morning, **shut Sundays**, asks for a message when closed | an out-of-hours mobile |
| Coastline | seven days, late on Thursdays, **takes calls when closed** | Brighton shop, cruise desk, evenings mobile |

The contrast is the demonstration, and it is now a contrast of CHOICES rather
than of billing. Jetaway asks for a message out of hours, so most of its evening
demand arrives as callback requests rather than as calls. Coastline takes the
calls anyway and is charged for them like any other. Both are legitimate ways to
run a shop, and the point of showing them side by side is that the platform does
not decide which is right.

**Call times are drawn from a weighted spread, not a flat one.** Most people ring
a travel agent during the working day with a tail into the evening. A flat
8am-to-10pm spread put 62% of Jetaway's calls outside their own opening hours,
which is not a figure any real agency would recognise and would have undersold the
product on a demo.

**Most out-of-hours calls are then dropped**, because of what the site actually
does: under "leave us a message" a closed shop shows no call button at all, so
those people leave their details instead. One in three is kept, standing in for
the calls that still arrive through a widget on somebody else's site or a page
left open since the afternoon. When they do arrive they are charged for, exactly
like any other call.

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

**Every call is chargeable, whatever the time.** Opening hours do not change
that, and an earlier version of this that made out-of-hours calls free was wrong
for a reason worth remembering: it took the decision away from the agency. We
were guessing on their behalf that a call at half five was worthless, when plenty
of shops answer after the door is locked, divert to a mobile, or would simply
rather have the enquiry than not.

What hours actually control is **whether a call can happen at all**, and that is
the agency's choice:

| `closed_behaviour` | Out of hours the traveller gets | Charged? |
|---|---|---|
| `callback` (default) | the call-back form, and the number as **plain text** | nothing to charge |
| `show` | the ordinary call button | yes, like any other call |
| `hide` | nothing at all | nothing to charge |

The `callback` row matters more than it looks. Because every call counts, that
state must not render a tappable number: doing so would bill an agency for calls
it explicitly chose not to invite, which is the complaint this whole area exists
to prevent. So out of hours under `callback` the number is a `<span>` with no
`href` and no `data-call` - readable for tomorrow, not a call to action, and never
reported. There is a browser assertion for exactly that.

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

**`click_events.out_of_hours` is a REPORTING flag, not a billing one.** It is
recorded on the row rather than worked out later from the hours, because hours
change and a row should still be able to explain itself long after the schedule
that produced it was edited. `tb_agent_stats` reports it as `afterHoursCalls` and
`afterHoursLeads`, and the dashboard shows it, because "nineteen of your enquiries
arrived while you were closed" is exactly the figure an agency needs in order to
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

## Nobody is capped on how many deals they list

Andy's decision, 28 July 2026: "there is no limit for anyone, the more deals the
more clicks the more we earn." Every plan in `LIVE_DEAL_LIMITS` is `-1`.

That follows from the rate card rather than fighting it. Tripbuster is paid per
click, per call and per enquiry, so a deal an agency cannot publish is revenue
neither of us earns. The old Spark 1 / Boost 5 numbers came from the mockups,
back when the model still looked like a monthly subscription and the cap was the
thing you paid to lift. Once the money moved onto the event, the cap was only
ever throttling our own income.

**The machinery is kept, not deleted.** `allowanceFor` and `publishHeadroom` still
run on all three ingestion routes, they simply never refuse anything, and one
number in `api/_lib/tripbuster/deal-write.js` reimposes a limit if an agency ever
floods the index. Because code that can never fire is code nobody notices has
broken, the suite exercises it directly with a temporary cap as well as asserting
that no cap applies today.

An unknown plan still gets `0` and fails closed. That is unreachable while the
database's CHECK constraint holds the four names, and it stays as the backstop
for the day somebody adds a fifth.

The limits live in the API and not the database, so changing a number never needs
a migration.

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

## There is still no password reset

Sign-up exists; forgetting your password does not. Today the only route back is
to email us. The pieces are already here — a token column, a hash-only pattern, a
mailer and a notice page — so it is a small piece of work rather than a new
mechanism, but it is genuinely missing and the first agency to forget a password
will find it.
