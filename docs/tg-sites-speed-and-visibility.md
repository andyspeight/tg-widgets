# Page speed and visibility (tg-sites)

**Written 23 Aug 2026, after Andy asked to go deeper on the strategic axes:
performance, page speed, Core Web Vitals and being found.** Companion to
`duda-gap-analysis.md`, and it SUPERSEDES that document's ordering.

Rendered version:
https://claude.ai/code/artifact/ce35153c-32a4-4a7a-b761-f30ac57aff18

Everything here is read and measured from the repository. Nothing is a timing.
See "What could not be measured" at the bottom before quoting any of it.

---

## The two findings

**Speed.** Every published page view runs the same six database reads twice,
renders fresh with no CDN cache, then blocks on 81 KB of gzipped CSS before it
can paint. Image work cannot fix any of that, because LCP is measured from the
start of the navigation and TTFB sits inside it.

**Visibility.** A published widget renders as an empty div. Every offer, tour,
spotlight and review arrives later by script, so AI crawlers (which mostly do
not run JavaScript) see a hole where the travel content should be. We shipped
llms.txt on 22 Aug to invite them in.

---

## Performance

### 1. The same six reads run twice per page view. Fix this first.

`generateMetadata` calls `load(host, path)` at
`app/site/[host]/[[...path]]/page.tsx:221`, and the page component calls the same
`load()` at `:335`. Next runs both in one request and nothing deduplicates them:
no React `cache()` anywhere in that file, and the `cache()` in `lib/db/client.ts`
is a CONNECTION POOL, not query memoisation. Verified, not assumed.

So page, theme, font faces, settings, regions and nav are each fetched twice.
Every one is its own transaction: `db(role).begin(...)`, then
`select set_config('app.current_tenant_id', ...)`, then the query, then commit
(`lib/db/withTenant.ts:91`). Twelve transactions where six would do, to
eu-west-2, before a byte of HTML.

Fix: wrap `load()` in React's `cache()`. One import, one wrapper, no behaviour
change. About an hour.

Credit where due: `resolveTenantByHostname` already has its own in-process TTL
cache, so tenant resolution is NOT part of the doubling.

### 2. No published page is ever cached. This is the ceiling.

`export const dynamic = 'force-dynamic'` at `page.tsx:71`. No `Cache-Control`
for the site route (`next.config.ts` scopes its only `no-store` correctly to
`/editor`). No revalidation window, no edge cache. Duda serves a static file
from a CDN.

A perfect image pipeline behind a 700ms first byte still scores badly, and no
image work moves that number. We already have the invalidation signal: publishing
is an explicit act that writes a row, so cache-until-published fits naturally
rather than guessing a revalidation window.

Settle alongside it whether we ever want server-side personalisation, because
caching and per-visitor rendering pull against each other and it is far easier to
decide now than to unpick later.

### 3. Every page carries the stylesheet for all 53 blocks.

`app/globals.css` is 302 KB raw, 81 KB gzipped, 1,374 rules, imported at
`app/layout.tsx:2`, which the site route sits under. A homepage using six block
types downloads the rules for fifty-three, render-blocking.

Honest caveat: Next minifies in production, so what a visitor receives is below
the 81 KB measured off the raw file. The scope problem is structural and does not
improve with minification.

### 4. Images: one size for every device, and no hero marked as the hero.

**A correction to the 23 Aug gap analysis.** That document said every image ships
lazy including the hero. Reading the background path properly, that is WRONG:

- `PageRenderer.tsx:583` sets `loading={i === 0 ? 'eager' : 'lazy'}` on a
  background slideshow, so the first slide is eager.
- `PageRenderer.tsx:590`, the single section background, sets no `loading`
  attribute at all, so it defaults to eager.

The full-bleed hero is handled correctly. What IS wrong is narrower:

- **No `fetchpriority` and no image preload anywhere in the renderer.** The only
  preloads on a published page are fonts. An eager background image still starts
  at low priority until layout proves it is in view.
- A hero built from an Image block rather than a section background gets
  `loading="lazy"` with no opt-out, across nineteen call sites in `blocks.tsx`.
- One file per image, capped at ~2400px by `lib/media/downscale.ts`. No `srcset`,
  no `sizes`, no WebP or AVIF. A 390px phone downloads the 2400px original.
- `width`/`height` only emitted when `measured` (`blocks.tsx:771`), so an image a
  client simply dropped in ships with no intrinsic dimensions.

### 5. Two things that are already right, and are easy to lose

**Fonts.** `components/render/FontHead.tsx` puts preload links before the
`@font-face` rules, inlines the rules rather than serving a blocking stylesheet
route, sets `crossorigin` on the preload (missing it is the most common way a
font preload silently downloads the file twice), and emits nothing at all when
the theme is on a system stack. This is textbook.

**No JavaScript for content.** Four scripts exist in total (`no-right-click.js`,
`slideshow.js`, `tg-motion.js`, `theme-toggle.js`), 9.5 KB gzipped for all four,
each conditional on the page using the feature. Duda cannot match this on the
interaction metrics. Whatever caching or personalisation lands must not quietly
turn a published page into a client-rendered one.

---

## Visibility

### 6. The plumbing is genuinely strong

Canonical URL on every page and entry. Ten JSON-LD types including
`TravelAgency`, `Article`, `FAQPage`, `BreadcrumbList`, `WebSite` and
`OpeningHoursSpecification`. A sitemap that includes collection entries, not just
pages. robots.txt, llms.txt, search listings written on publish, AI alt text. The
search results page correctly `noindex, follow`. Server-rendered HTML with no
client bundle for content, so a crawler gets the same document a visitor does.

### 7. A published widget is an empty div. This undoes much of the above.

The entire body of the widget block on a published page
(`components/render/blocks.tsx`):

```
return <div className="tgs-widget" data-tg-widget={kind.tag} data-tg-id={id} />;
```

Content arrives afterwards from a deferred script. No `noscript` fallback; the
only one on the page belongs to the tag manager.

Google runs the script, but on a deferred second pass that is slower and less
reliable than indexing HTML. The AI crawlers are the sharper problem: most do not
execute JavaScript at all.

**Nineteen of the thirty-eight widgets in the picker are the Travel and Trust
groups** (offers, tours, destination and airport spotlights, carousels, reviews,
testimonials). That is precisely the content a travel agency most wants found,
and none of it is in the document.

This is why collections fed from the supplier feed is not "a Duda feature to
copy". It is the only route by which this content becomes visible: the same data
as a server-rendered page per tour, in the client's own design, carrying its own
structured data and its own sitemap line.

---

## The order of work, replacing the gap analysis's order

Referred to by NAME rather than task number: the session task list reset on
23 Aug and the old numbers no longer resolve. Match on the subject line.

1. **"Memoise load() so a page view stops doing every read twice."** React
   `cache()` around `load()`. About an hour, no behaviour change.
2. **"Decide whether published HTML is cached at the edge."** A decision, then a
   sprint. The ceiling on every speed number we will ever report, and it needs
   deciding together with the personalisation question.
3. **"Mark the LCP image: fetchpriority, preload and a lazy opt-out."** The small
   half of the image work, and it helps immediately. Responsive variants and
   modern formats are the larger second half and come after.
4. **"Stop sending 53 blocks of CSS to a page that uses six."** The registry
   already knows what a page holds.
5. **"Collections fed from an external source."** Still the strategic one, and
   the argument is stronger than it was: it is the fix for finding 7.

**"Site-wide widgets panel, cookie consent first"** stays worth doing on its own
terms. It is a compliance exposure rather than a performance one, so it is
unaffected by this reordering.

---

## What could not be measured, and the one thing Andy can do

- **Nothing here is a timing.** Every number is measured from files in the repo:
  byte counts, gzip sizes, rule counts, call sites, query counts. I could not
  load a live client page (the sandbox blocks the deployment) and could not run
  it locally (no dependencies installed, no database). The diagram in the
  rendered version shows sequence and relative weight, never milliseconds.
- **The 30-second version Andy can do:** run PageSpeed Insights on a live client
  site. Real lab numbers, plus real field data from Chrome users if the site has
  traffic. It would confirm or kill the ranking above in one go, and a high TTFB
  settles item 2 without further argument.
- **Duda comparisons** come from the same web sources as the gap analysis,
  flagged there as dated and indicative. Their 82% Core Web Vitals figure is
  their own, dated May 2025.
