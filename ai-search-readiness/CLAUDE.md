# CLAUDE.md: ai-search-readiness

Repo rules for Claude Code. Read this before touching anything. The full background lives in `PROJECT-START-ai-search-readiness.md`.

---

## What this is

A free, public, no-login tool that scores whether AI search engines can find and understand a website. Internal name **AI Search Readiness**, public name **AI Visibility Score**. Built by Travelgenix for the SME travel market.

The differentiating check is whether the site silently blocks AI crawlers at the network edge, usually Cloudflare Bot Fight Mode. No competitor tool does this. If the crawler cannot reach the page, schema and content do not matter.

Standalone repo, own Vercel project, no auth. Not part of tg-widgets.

---

## The credibility principle

This is the governing rule of the whole codebase. Locked by Andy, 25 May 2026.

**TRUE.** No claim a knowledgeable prospect could debunk.
**USEFUL.** Every finding carries a specific fix.

In practice:

- A browser-UA control probe runs on every scan, before the bot probes, and is passed into every verdict.
- robots.txt is authoritative. A `Disallow` is a definitive block.
- A bot-UA 403 only counts as a block if the control probe **succeeded**. If the control probe also got 403, the verdict is inconclusive.
- Inconclusive pillars are excluded from the score, never counted as fails.
- A clean probe is a pass, not a guarantee. Say so, because Cloudflare can fingerprint beyond UA.
- Share-of-model is never fabricated. In the free tool it is a visibly locked teaser.

Zero false positives is a hard requirement. If a change could introduce one, do not make it.

**This rule outranks everything else in this file.** Where a presentation decision and the credibility principle pull against each other, credibility wins. One worked example already in the code: decision 13 says marketing chips use consumer engine names front of house. The page shows consumer names for the six engines we actually probe and leaves Copilot off, because listing an engine we do not test is exactly the kind of claim a knowledgeable prospect could debunk.

---

## Architecture

Flat, no framework, no runtime dependencies, Node 18+.

```
api/check.js       public scan endpoint: method check, CORS allowlist, validation, rate limit, then the scan
lib/net.js         SSRF guard and safe fetch: connect-time IP validation, timeout, 1.5MB cap, per-hop redirect re-validation
lib/access.js      Pillar 1: robots.txt plus bot-UA probes vs browser control, 6 canonical crawlers
lib/onpage.js      Pillars 2 to 4 from ONE fetch: schema coverage, answer-ready content, on-page authority
lib/score.js       combine, verdict bands, humanised findings and fixes, locked presence teaser
lib/ratelimit.js   Upstash REST, in-memory sliding window underneath, fails open on a Redis outage
lib/engine.js      orchestration, so a scan can be run and tested without an HTTP layer
public/index.html  front end, four pillars plus the paid teaser, light and dark
public/styles.css  control room, variance 7 / motion 6 / density 4
public/app.js      wired to /api/check, 28s timeout, minimum scan time, honest preview fallback
test-engine.js     the suite. SSRF first, offline, so a broken network cannot hide a broken guard
scripts/benchmarks.js  the three live regression targets
```

`lib/engine.js` is the one addition to the original module spec. It exists so `api/check.js` stays a transport layer and the scan itself is testable without HTTP.

Four pillars, equal weight: AI crawler access, structured data, answer-ready content, on-page authority.

Canonical crawlers: OAI-SearchBot, ChatGPT-User, PerplexityBot, ClaudeBot, Google-Extended, Googlebot. Probe with each bot's real UA string. Never spoof a browser UA to get past a block.

Note on Google-Extended: it is a robots.txt control token, not a crawler with its own user agent. Google fetches with Googlebot and applies the token afterwards. The live probe therefore uses the Googlebot UA and the report says so on the row. Do not "fix" this by inventing a Google-Extended UA string.

The whole scan is one page fetch plus robots.txt plus six bot probes. The browser control probe doubles as the page fetch, which is why the on-page pillars read from `accessResult.page` rather than going back to the site.

---

## Security, all ship-blockers

Public unauthenticated endpoint that fetches arbitrary URLs. Highest-risk shape Travelgenix ships.

- SSRF guard on every fetch **and every redirect hop**. Build and test this first.
- The guard validates at **connect time** through a custom `lookup`, not by resolving then fetching by hostname. That is deliberate. A resolve-then-fetch design leaves a DNS rebinding window open.
- If a hostname resolves to several addresses, **all** of them must be public. One private record poisons the lot.
- Rate limit **before** the fetch, not after. Otherwise this becomes a free scanning proxy for attackers.
- CORS allowlist, never `*`.
- Generic errors only. No stack traces, no internal hostnames, no upstream error text.
- No secrets client-side. `public/` is public.
- `.env*` in `.gitignore`. Verify before the first push, git history is permanent.
- No secret in any response body or log line.
- HTTPS only, security headers in `vercel.json`. CSP has no `unsafe-inline` on scripts, so keep the front end free of inline handlers and inline `<script>`.

---

## Design

Inter only. Travelgenix navy `#1B2B5B` and teal `#00B4D8` tokens. Light and dark parity. The approved look is the 28 May 2026 mockup, control-room concept, Variance 7 / Motion 6 / Density 4. No generic three-equal-card layouts. Respect `prefers-reduced-motion`.

Inter is used where the visitor already has it, with a system stack behind it, because the CSP is `font-src 'self'` and there is no build step. If you want Inter guaranteed, self-host the woff2 files rather than widening the CSP to a font CDN.

---

## Writing voice for client-facing copy

Warm, direct, plain, confident, human. UK English. No em dashes. No Oxford commas. No AI filler. Every non-pass carries a fix.

The suite enforces some of this. `test-engine.js` fails the build on an em dash, an en dash used as punctuation, US spelling of "optimise", or a finding without a fix.

---

## Env

Now:

```
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
ALLOWED_ORIGINS      # optional
```

Later: `AIRTABLE_API_KEY` and `AIRTABLE_BASE_ID` (leads), `ANTHROPIC_API_KEY` (tracker), `DUDA_API_USERNAME` and `DUDA_API_PASSWORD` (Phase 3 remediation only, copy names and values from the luna-marketing Vercel project, never mint new).

---

## Verify before any deploy

1. `node test-engine.js`, all green. 214 checks as of 28 July 2026, SSRF suite first.
2. Live scan of the three benchmarks: `travelgenix.io` around 69 "Needs work", `example.com` around 36 with content inconclusive not a fake fail, `bbc.co.uk` fully inconclusive because the control probe is also blocked.
3. Rate limit returns 429 after threshold. SSRF attempts return 400.
4. No secret in any response or log line.

Material drift on any benchmark means the credibility principle has broken somewhere. Find it before shipping.

**Do not tune a heuristic to make a benchmark hit its number.** The benchmark figures were recorded from a build that no longer exists and were written down from memory. If a scan comes back a few points off, check the heuristic is honest and then update the expected figure. Bending the scoring to match a remembered number is itself a credibility failure.

---

## Hard noes

- No auto-published AI content on client sites. Ever.
- No backlink-exchange network. Ever. Considered after reviewing BabyLoveGrowth and rejected: QA and support load the lean team cannot carry, client-penalty risk, brand risk, and it is radioactive in acquisition diligence.
- No Duda API in the auditor. It needs none. Duda belongs to the separate Phase 3 remediation project, row `rec4KpeSWtbrUlNWL`.
- Do not upgrade the authority pillar to off-site signals without asking Andy. It is an on-page proxy in v1 by decision, not by oversight.
- Do not move this into tg-widgets. Standalone was decided 28 May 2026.
- Do not add a runtime dependency without asking. The whole thing runs on Node built-ins today and that is worth keeping.

---

## Handover

State lives in Airtable, not in chat memory.

- Base `appj9tksreHOwkhYg`, table `tblpyhPNhiQg3XkkT`, record `rec4AZPRwNTw7rKyG`.
- Read the row at the start of every session. Update at the end and bump Session Count.
- Session count was 5 as of 28 July 2026.
