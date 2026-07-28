# AI Visibility Score

A free, public, no-login tool that tells a travel business whether AI search
engines can find and understand its website, scores it out of 100 and gives it
the fixes.

Internal project name: **AI Search Readiness**. Public name: **AI Visibility
Score**. Built by Travelgenix.

---

## The one thing it does that nothing else does

It probes whether a site is silently blocking AI crawlers at the network edge.

Cloudflare's Bot Fight Mode is on by default for new domains and it turns AI
retrieval bots away without telling anyone. The site looks perfectly healthy in
a browser. If the crawler cannot reach the page, schema and content are
irrelevant, so this is the check that has to come first.

Every other tool in this space measures. Travelgenix measures and fixes,
because it owns the rendering layer on the client estate.

---

## How it works

One page fetch, one robots.txt fetch, six crawler probes.

1. **The browser control probe runs first.** It fetches the home page with a
   real browser user agent. Everything downstream is judged against it, and its
   response body is what the on-page pillars read, so the whole scan is a single
   page fetch rather than four.
2. **robots.txt is parsed** with the real matching rules. A group naming a bot
   beats the wildcard group outright, and inside a group the longest matching
   pattern wins with a tie going to Allow.
3. **Six crawlers are probed in parallel**, each with its own honest user agent.
   We never spoof a browser to get past a block, because the whole point is to
   watch how a site treats a request that says what it is.

### The verdict rules

| What happened | Verdict |
|---|---|
| robots.txt `Disallow` matches | **Blocked.** Definitive, whatever the wire says. |
| Bot got 403 or a challenge page, browser control succeeded | **Blocked at the edge.** This is the smoking gun. |
| Bot got 403, browser control also got 403 | **Inconclusive.** Never a block. This is the false-positive guard. |
| 429, timeout, redirect loop, 5xx | **Warning.** Intermittent visibility, not a block. |
| Clean response | **Pass**, and the report says a pass is not a guarantee. |
| Browser control itself blocked | **The whole scan is inconclusive.** |

### The score

Four pillars, equal weight, out of 100.

| Pillar | What it measures |
|---|---|
| AI crawler access | Can the six canonical bots reach the site |
| Structured data | JSON-LD and microdata coverage and validity |
| Answer-ready content | Is the content extractable and answer-shaped |
| Authority signals | On-page trust markers. On-page only in v1, by decision |

A pillar that cannot be honestly assessed is marked inconclusive and **excluded
from the average**. It is never scored as a fail. That single rule is what makes
the tool defensible in front of somebody who knows what they are looking at.

Below the four pillars sits a visibly locked panel for live AI presence and
share of model. It is the paid layer. It never shows a fabricated result.

### Bands

| Score | Band |
|---|---|
| 85 to 100 | Strong |
| 70 to 84 | Good |
| 50 to 69 | Needs work |
| 30 to 49 | At risk |
| 0 to 29 | Invisible |

---

## The canonical crawler set

| Label | Engine | robots token |
|---|---|---|
| ChatGPT Search | OpenAI | `OAI-SearchBot` |
| ChatGPT live fetch | OpenAI | `ChatGPT-User` |
| Perplexity | Perplexity | `PerplexityBot` |
| Claude | Anthropic | `ClaudeBot` |
| Gemini and AI Overviews | Google | `Google-Extended` |
| Google index | Google | `Googlebot` |

`Google-Extended` is a robots.txt control token rather than a crawler with its
own user agent. Google fetches with Googlebot and applies the token afterwards,
so the live probe uses the Googlebot user agent and the report says so on that
row.

---

## Running it

Node 18 or newer. There are no runtime dependencies and no build step.

```bash
node test-engine.js          # the full offline suite, SSRF first
node scripts/benchmarks.js   # the three live regression targets
node scripts/benchmarks.js https://somesite.co.uk/   # any site
```

The suite needs no network. The benchmarks do.

---

## Layout

```
api/check.js            public scan endpoint
lib/net.js              SSRF guard and safe fetch
lib/access.js           Pillar 1
lib/onpage.js           Pillars 2 to 4, from the one page fetch
lib/score.js            combine, bands, findings, fixes, locked teaser
lib/ratelimit.js        Upstash REST with an in-memory floor
lib/engine.js           orchestration
public/                 the front end
test-engine.js          the suite
scripts/benchmarks.js   live regression targets
```

---

## Security

This endpoint is public, unauthenticated and fetches arbitrary URLs on request.
That is the highest-risk shape we ship, so the guards are not optional and the
order they run in is part of the design.

- **SSRF guard on every fetch and every redirect hop.** IPs are validated at
  connect time through a custom DNS lookup rather than resolved-then-fetched,
  which closes the rebinding window. If a hostname resolves to several
  addresses, all of them must be public.
- **Rate limited before the fetch**, 8 a minute and 40 an hour per IP.
  Otherwise the tool becomes a free scanning proxy.
- **CORS is an allowlist**, never `*`.
- **Generic errors.** Nothing upstream, no stack, no hostname reaches the client.
- **No secrets client-side.** `public/` ships to the browser.
- **CSP has no `unsafe-inline` on scripts**, so the front end carries no inline
  handlers and no inline `<script>`.

`npm audit` is trivially clean because there are no dependencies. Keep it that
way if you can.

---

## API

```
GET  /api/check?url=example.co.uk
POST /api/check   {"url": "example.co.uk"}
```

Success is `200` with `{ ok: true, overall, band, pillars, crawlers, findings,
presence, ... }`. `overall` is `null` when the scan was inconclusive, which is a
real answer rather than an error.

Failures are `400` with `{ ok: false, error }` for anything the caller can fix,
`429` with a `Retry-After` when rate limited, and `405` for the wrong method.
Successful `GET` responses carry a five minute edge cache.

---

## Related

- `PROJECT-START-ai-search-readiness.md`, the full background and the locked
  decisions.
- `CLAUDE.md`, the rules for anyone working in here.
- `DEPLOY.md`, first deploy and the pre-ship checklist.
- Airtable project row `rec4AZPRwNTw7rKyG`, base `appj9tksreHOwkhYg`.
