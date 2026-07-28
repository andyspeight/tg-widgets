# Deploying AI Visibility Score

First deploy, the checks that have to pass before it, and the two things that
were still open when the code was written on 28 July 2026.

---

## Still open

Both of these were blocked by the build environment, not by the code.

### 1. The three live benchmarks have not been run

The environment this was rebuilt in blocks outbound requests to arbitrary hosts
(`Host not in allowlist`), so no real site could be scanned. Everything that can
be checked without the network is checked and green, including the SSRF suite,
the verdict logic, the scoring arithmetic and the endpoint guard ordering.

Worth noting what happened when the benchmarks were attempted against the
blocked network: every site came back **fully inconclusive** rather than
reporting a false block. That is the false-positive guard doing exactly its job
under the worst input it will ever see. It is not a substitute for the real run.

**Run them first thing after deploy** (see the checklist below).

### 2. The public subdomain is not chosen

Two candidates, Andy's call at deploy time:

- `aivisibility.travelify.io`
- `geo.travelify.io`

---

## First deploy

### 1. Get it into its own repo

This is a standalone product with its own security posture. It does not go in
`tg-widgets`. See `STAGING.md` if you are reading this from the staging branch.

```bash
git clone git@github.com:andyspeight/ai-search-readiness.git
# copy the contents of this directory in, keeping CLAUDE.md at the root
git add . && git commit -m "AI Visibility Score: initial build"
git push -u origin main
```

Before that first push, confirm nothing sensitive is going with it. Git history
is permanent.

```bash
git ls-files | grep -E '^\.env' || echo "clean"
node test-engine.js
```

### 2. Create the Vercel project

New project in team `agendasgroup` (`team_60GtIq862EeN5iuKz2mbafeR`). Framework
preset **Other**. No build command. Output directory `public`, which
`vercel.json` already sets.

Do **not** attach this to the tg-widgets project.

### 3. Set the environment variables

In Vercel project settings, for Production and Preview:

| Name | Needed | Notes |
|---|---|---|
| `UPSTASH_REDIS_REST_URL` | yes | Upstash Redis REST endpoint |
| `UPSTASH_REDIS_REST_TOKEN` | yes | server side only, never in `public/` |
| `ALLOWED_ORIGINS` | optional | comma separated. Leave empty for same origin only. Never `*` |

Without the Upstash pair the limiter still works, but only per serverless
instance rather than shared across them. That is a real reduction in protection
on a public URL-fetching endpoint, so treat it as required rather than optional.

### 4. Point the domain

Add whichever subdomain Andy picks in Vercel, then the CNAME in DNS.

### 5. Register the Tool Hub tile

Once the URL is live.

---

## Pre-ship checklist

Every line is a ship-blocker.

### The suite

- [ ] `node test-engine.js` green. The SSRF section runs first and offline.

### The benchmarks

- [ ] `node scripts/benchmarks.js` against the live deploy.
- [ ] `travelgenix.io` lands around **69**, band "Needs work".
- [ ] `example.com` lands around **36**, with content **inconclusive**, not a fake fail.
- [ ] `bbc.co.uk` comes back **fully inconclusive**, because the browser control probe is also refused.

If a figure is a few points off, check the heuristic is honest and then update
the expected figure. **Do not bend the scoring to hit a remembered number.**
Those figures were written down from memory of a build that no longer exists.
Tuning a heuristic to match them would be a credibility failure in itself, which
is the one thing this tool cannot afford.

If a figure is *materially* off, or `bbc.co.uk` returns a confident score, or
`example.com` returns a content fail rather than inconclusive, something in the
credibility chain has broken. Find it before shipping.

### Security

- [ ] SSRF attempts return 400. Try `http://169.254.169.254/latest/meta-data/`, `http://127.0.0.1/`, `http://10.0.0.1/`, `javascript:alert(1)`, `ftp://example.com/`, `http://example.com:6379/`.
- [ ] Rate limit returns 429 with `Retry-After` after 8 requests in a minute.
- [ ] No `Access-Control-Allow-Origin: *` on any response.
- [ ] No secret in any response body. `curl` a few error paths and read them.
- [ ] No secret in the Vercel runtime logs.
- [ ] `curl -sI https://<domain>/` shows HSTS, CSP, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`.
- [ ] The page loads with no CSP violations in the console.

### The front end

- [ ] Light and dark both correct, including the theme toggle and the system default.
- [ ] Keyboard only: tab to the input, submit, reach every link in the report.
- [ ] Reduced motion on: no perpetual animation, no smooth scroll.
- [ ] Narrow viewport: single column, no horizontal scroll.
- [ ] The preview fallback shows its banner. Test it by blocking `/api/check` in devtools, then confirm the banner reads as a preview and the band reads "Example only".

### Copy

- [ ] Read the findings out loud. No em dashes, no Oxford commas, UK spelling, every non-pass carries a fix.

---

## Smoke tests once it is live

```bash
DOMAIN=https://aivisibility.travelify.io   # or geo.travelify.io

# a real scan
curl -s "$DOMAIN/api/check?url=travelgenix.io" | head -c 600

# SSRF attempts, all should be 400
for u in "http://169.254.169.254/latest/meta-data/" "http://127.0.0.1/" \
         "http://10.0.0.1/" "javascript:alert(1)" "ftp://example.com/" \
         "http://example.com:6379/"; do
  printf '%s -> ' "$u"
  curl -s -o /dev/null -w '%{http_code}\n' "$DOMAIN/api/check?url=$(printf %s "$u" | jq -sRr @uri)"
done

# rate limit
for i in $(seq 1 12); do
  curl -s -o /dev/null -w '%{http_code} ' "$DOMAIN/api/check?url=example.com"
done; echo

# headers
curl -sI "$DOMAIN/" | grep -iE 'strict-transport|content-security|x-frame|x-content-type'

# wrong method
curl -s -o /dev/null -w '%{http_code}\n' -X PUT "$DOMAIN/api/check"
```

---

## Rollback

There is no database and no state, so rollback is a Vercel instant rollback to
the previous deployment. Nothing to migrate, nothing to clean up.
