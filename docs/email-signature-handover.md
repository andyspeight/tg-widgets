# Email Signature — project handover

This is the living handover for the Email Signature widget. Read it together
with the repo-wide conventions in `CLAUDE.md`. The Airtable project record is
base `appj9tksreHOwkhYg`, table `tblpyhPNhiQg3XkkT`, record `recYKgvuON4dFQWfa` —
keep it updated at each milestone.

## What Email Signature is

A self-serve email signature builder. The client designs a branded signature in
the editor and copies it into Gmail, Outlook or Apple Mail. Output is
email-safe inline-table HTML (no JavaScript, no `<style>` blocks) so it renders
across every major client, with step-by-step install guides per provider. It
works for travel brands (photo or logo, book-now CTA, ABTA/ATOL and Trustpilot
trust line, social links) and generic professionals alike, across three
templates: classic, modern, compact.

Two hosted, updatable extras survive inside email (where scripts and most CSS
are stripped): a promo banner served through Travelgenix so the offer can be
swapped later without re-pasting, and a 1x1 open-tracking pixel.

Positioning: premium only. Ignite and Bespoke unlimited, Spark and Boost locked
— same tiering as Smart Section. The upsell story is "a branded, trackable
signature in every inbox, that you control centrally".

## The key architectural fact

Email clients strip JavaScript and most CSS. So this is NOT a normal
`widget-*.js` embed that renders on a customer site. It breaks into three
pieces:

1. **The builder** — a pure function that produces the exact inline-table HTML
   the user pastes. It lives in `public/widget-emailsig.js` and is exposed as
   `window.TGEmailSigWidget.buildSignatureHtml(config, { origin, widgetId })`
   so the editor and demo reuse it with no DOM.
2. **The preview + copy UI** — a Shadow-DOM card (`:host{all:initial}`) that
   renders the signature, offers rich Copy signature (keeps formatting when
   pasted), Copy HTML code, Download .htm, and the per-provider install guides.
   The editor instantiates this widget as its live preview.
3. **The hosted extras** — anything that must stay live after paste is an
   `<img src>` pointing at `/api`, because that is the only dynamic thing that
   survives in email.

## Security (the builder is critical)

The builder output is pasted verbatim into a mail client, so every value is
validated at source and escaped at injection: `esc()` on all text, URLs
whitelisted to http/https/mailto/tel (`safeUrl`), colours to hex (`safeColor`),
fonts to an email-safe char whitelist (`safeFontStack`), numbers clamped. Never
interpolate a raw config string. `tests/test-emailsig.cjs` covers this heavily.

## Files

- `public/widget-emailsig.js` — builder + Shadow-DOM preview/copy UI + auto-init.
  Globals `window.TGEmailSigWidget` and `window.__TG_EMAILSIG_VERSION__`.
- `public/editor-emailsig.html` — editor on the tgse shell. Note: it does NOT
  use the shell font picker (which offers web fonts); it uses an email-safe font
  `<select>` feeding `theme.font`.
- `public/demo-emailsig.html` — standalone demo, embeds via inline
  `data-tg-config` so it needs no saved id.
- `api/emailsig-banner.js` — `GET ?id=` → 302 to the current banner image
  (updatable), else a transparent 1x1.
- `api/emailsig-click.js` — `GET ?id=` → logs the click, 302 to the banner
  destination (falls back to the company website).
- `api/emailsig-pixel.js` — `GET ?id=` → 1x1 GIF, logs the open. Always returns
  the image (never a 4xx that would break in the inbox).
- `api/_lib/emailsig.js` — shared helpers (`TRANSPARENT_GIF`, `safeWidgetId`,
  `safeHttpUrl`, `fetchWidgetConfig`, `selfOrigin`, `clientIp`).
- `tests/test-emailsig.cjs` — 30 tests, plain Node via `vm` (no jsdom needed).

## Config schema (stored in the Widgets record's Config JSON)

```
{
  template: 'classic' | 'modern' | 'compact',
  theme:   { accent, text, muted (hex), font (email-safe stack), fontSize },
  person:  { name, title, company, photoUrl, logoUrl },
  contact: { phone, mobile, email, website, address },
  cta:     { enabled, label, url },
  socials: [ { network, url } ],   // whitelisted networks only, rendered as text
  banner:  { enabled, imageUrl, linkUrl, width, updatable },
  travel:  { showBadges, abta, atol, trustpilotRating, trustpilotUrl },
  tracking:{ openPixel },
  disclaimer
}
```

`normalise(config)` in the widget applies defaults and all validation; it is
the single source of truth for the shape.

## Hosted endpoints (Phase 1 = stdout logging)

The banner and pixel endpoints currently log structured lines to stdout
(`[emailsig-banner]`, `[emailsig-click]`, `[emailsig-open]`) and do not write to
Airtable, mirroring `api/share-track.js`. Phase 2 is a per-event Airtable table.
The banner/click endpoints resolve the target from the widget's own saved config
(never the request), so there is no open-redirect surface. Updatability is
bounded by email image-proxy caching (short cache headers, ~5 min).

## Registration (the five places + vercel.json)

- `api/widget-config.js`: `ALLOWED_WIDGET_TYPES` has `Email Signature`;
  `PLAN_WIDGET_LIMITS` has `{ Spark: 0, Boost: 0, Ignite: -1, Bespoke: -1 }`;
  aliases `emailsig` / `email-signature` / `signature` etc.
- `public/index.html`: `WIDGETS` entry (`id: 'emailsig'`) with matching
  `access`, plus a static mini-preview branch in `loadMiniPreview` (no dashboard
  script tag needed — it is a copy/generate widget).
- `vercel.json`: `/demo-emailsig` and `/editor-emailsig` rewrites and the
  `/widget-emailsig.js` headers block.
- Airtable **WidgetType** singleSelect option `Email Signature` — MANUAL, the
  API rejects unknown select options. Until it is added, saving fails.
- Airtable **Catalogue** row `widget-emailsig` (`recPXBQniOZt4trIX`), Active,
  plus **Package Catalogue** defaults for Ignite (`recD1rJJQQE4r35bn`) and
  Bespoke (`recbksRnFB5ZRFoMP`). Active-without-package-links would wrongly block
  Ignite/Bespoke via the entitlement gate, so those two links are load-bearing.

## Decisions locked (8 Jul 2026)

- Scope: generator + hosted updatable banner + open pixel. NOT a full
  server-side management platform (the Exclaimer/Xink/Opensense/Symprex model).
- Audience: both travel-branded and generic professional.
- Tiers: premium only, same as Smart Section.
- Social links and ABTA/ATOL/Trustpilot render as text — email clients block SVG
  icons and we ship no PNGs.

## Next steps

1. Add the `Email Signature` WidgetType option in Airtable (manual, required).
2. Merge to `main`; Vercel deploys `/editor-emailsig` and `/demo-emailsig`.
3. Phase 2: persist banner-click and open events to an Airtable table.
4. Optional: logo/photo upload via the existing `upload-logo` / `upload-photo`
   endpoints instead of URL paste.

## Testing

`node tests/test-emailsig.cjs` — 30 tests, no dependencies. Add a test whenever
you extend the builder and re-run.
