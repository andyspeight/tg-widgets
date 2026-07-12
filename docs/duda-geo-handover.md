# Handover: Duda GEO/AEO remediation tooling

**Owner:** Andy Speight (Travelgenix)
**Started:** 12 Jul 2026
**Related:** AI Search Readiness project `rec4AZPRwNTw7rKyG`; the GEO workstream
handover this implements.
**Test target:** https://www.traveldemo.site/ (Duda site)

---

## What this is

Site-level GEO/AEO remediation for the Duda travel-site estate, driven through
the Duda Partner API so there is no page-by-page manual work. Adds structured
data, site-wide SEO defaults and an llms.txt, proves it on traveldemo.site,
then generalises to the estate.

This is a **switch-on-and-populate** job, not a platform fight. Duda supports
auto-generated schema and site-wide code injection natively; the demo simply
has none of it enabled or populated.

## What is in the repo now (this workstream)

| File | Purpose |
|---|---|
| `api/_lib/duda/geo.js` | Pure, offline builders + validators. Turns a business profile into JSON-LD, `site_seo`, `content.update` payload and `llms.txt`. Every output string is injection-safe. |
| `api/_lib/duda/client.js` | Thin Duda Partner REST client (Basic auth from env, retry/backoff, secrets never logged). Sites, content, schema toggle, site-wide HTML injection, publish. |
| `scripts/duda-geo-remediate.js` | Orchestration CLI. Dry-run by default; `--apply` to write + publish. `--emit` builds assets offline with no creds. `--list` resolves site names. |
| `scripts/duda-geo-verify.js` | Read-only verification probe (§9): AI-crawler UA checks, JSON-LD presence + parse, robots/sitemap. No creds. |
| `scripts/duda-geo-profile.example.json` | Example per-site profile (the traveldemo.site placeholder values — replace with real business data). |
| `test/duda-geo-smoke.mjs` | 63 offline assertions. `npm run test:dudageo`. Proves injection safety and every builder. |

## Decisions locked (do NOT re-litigate)

- No auto-published AI content on client sites. This workstream is
  structured-data + SEO only; it does not publish articles.
- No backlink network.
- Fixes are site-level via the Duda API, not page-by-page.
- Reuse the existing Luna Marketing Duda credentials. Do NOT mint new ones.
- Prove on traveldemo.site, verify, then roll to the estate. Run AI Search
  Readiness across the estate first to find Cloudflare-blocked sites.

## Credentials + environment

The client reads Duda creds from env only — nothing hardcoded, nothing logged:

```
DUDA_API_USER      Partner API username (Basic auth)
DUDA_API_PASS      Partner API password (Basic auth)
DUDA_API_ENDPOINT  Regional host. EU: https://api.eu.duda.co (default)
                                   US: https://api.duda.co
DUDA_APP_UUID      Only if the site-wide HTML injection runs through an
                   Integration Hub app context (white-label).
```

These are the **same** credentials the Luna Marketing blog-publishing
integration already uses. That module lives in a **different repo** (not
`andyspeight/tg-widgets`), so its env values must be copied into this
environment (or the run must happen where they already exist) before an
`--apply` run. The per-client Duda key can also live encrypted in the
`ClientIntegrations` Airtable table (service `Duda`) — `api/_crypto.js`
`decrypt()` unwraps it and it can be passed to `new DudaClient({ user, pass })`.

## How to run

```bash
# 1. Offline: build + eyeball every asset for a site (no creds, no network)
node scripts/duda-geo-remediate.js --profile=scripts/duda-geo-profile.example.json --emit

# 2. Resolve the demo's Duda site_name
node scripts/duda-geo-remediate.js --list

# 3. Dry-run the full remediation (prints each step it WOULD take)
node scripts/duda-geo-remediate.js --site=<siteName> --profile=<profile.json>

# 4. Apply for real (writes content, enables schema, injects JSON-LD,
#    sets site_seo, publishes)
node scripts/duda-geo-remediate.js --site=<siteName> --profile=<profile.json> --apply

# 5. Verify (read-only)
node scripts/duda-geo-verify.js https://www.traveldemo.site/
```

Flags: `--no-publish` stages without going live; `--no-inject` / `--no-schema`
/ `--no-seo` / `--no-content` skip individual steps.

## Order of operations (what `--apply` does)

1. `content.update` — populate the content library business info first, because
   Duda builds its native LocalBusiness schema from it.
2. `updateSite` — enable `schemas.local_business`.
3. `injectSiteWideHtml` — inject the custom JSON-LD (TravelAgency + WebSite +
   SearchAction) at end of BODY, on every page.
4. `updateSite` — set `site_seo` defaults (page-level SEO still overrides).
5. Re-read Site Details and assert `schemas.local_business.status == VALID`.
6. `publish` — nothing is live until this runs.
7. Print the `llms.txt` to host at the site root.

## Verification (§9)

`duda-geo-verify.js` probes the live URL as GPTBot, ClaudeBot, PerplexityBot,
Google-Extended, Googlebot and a browser baseline; each AI crawler must return
200 with a body within 20% of the browser size (guards against silent block
pages / JS shells served only to bots). It then confirms a
`<script type="application/ld+json">` block is present and parses, and checks
robots + sitemap. Google Rich Results Test remains a manual final step (no
public no-auth API) — the tool prints the URL.

## Current state / blockers (12 Jul 2026)

The tooling is complete and unit-tested (63/63 offline assertions pass). It has
**not** been run against the live demo from this session because:

- **No Duda credentials in this environment.** The Luna Duda integration and
  its env live in another repo not in this session's scope.
- **No outbound network egress.** This sandbox's proxy allowlists only package
  registries + Anthropic hosts, so both `api.duda.co` and `traveldemo.site`
  return CONNECT 403. The verify probe ran and faithfully reported the block;
  it was the proxy, not the site.

So the remaining work is an **operational run in an environment that has the
Duda creds and open egress**: `--list` to get the site_name, fill a real
profile, dry-run, `--apply`, then `verify`. The 12 Jul manual audit (in the GEO
handover) still stands as the baseline: crawlers 200, robots open, server-
rendered content present; the only real gaps are the semantic layer (zero
JSON-LD), one placeholder H1, and a missing llms.txt.

## Gotchas

- Site-wide HTML injection renders at end of BODY — fine for JSON-LD.
- Page-level SEO overrides `site_seo`. Expected.
- `content.update`'s exact field schema should be confirmed against the live
  Luna integration's usage before the first `--apply` — `buildContentUpdate`
  mirrors the documented fields and only sends populated keys, but Duda's real
  payload shape is the one source of truth.
- Content injection (`data-inject`) is not used here; the placeholder H1 is a
  one-off editor fix.
- White-label: if injection runs through an Integration Hub app, do not surface
  the Duda name anywhere client-facing.
- Nothing is live until `publish`.

## Estate rollout (after the demo passes)

Same script, parameterised over site IDs. Sequence: (1) run AI Search Readiness
across the estate first and fix any Cloudflare AI-bot blocks — a schema-perfect
site AI crawlers cannot reach is worthless; (2) pilot on a few opt-in client
sites; (3) run the script across the estate, publishing each; (4) only then
promote GEO as a client capability or lead-gen hook.

## Security

- Creds from env only; never in the script, repo, or logs (`client.js` masks
  identifiers and never echoes request bodies on error).
- All business data is validated/clamped and URLs whitelisted to http(s) before
  it reaches JSON-LD; the block is HTML-escaped so a stray `</script>` in
  business data cannot break out. This is the property `test/duda-geo-smoke.mjs`
  locks in.
