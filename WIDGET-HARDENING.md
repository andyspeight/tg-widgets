# Widget hardening rules

House rules every embeddable widget in `public/widget-*.js` and every editor in
`public/editor-*.html` must follow. Each rule here comes from a real bug that
shipped and reached client sites, most of them in the post-launch QA pass of
3 to 4 July 2026. Treat this as the checklist when building a new widget or
reviewing a change. It is the practical companion to the `tg-widget-suite`
skill.

The one sentence to remember: **a widget runs on the client's own page, its
config is hostile input, and nobody calls `destroy()` for you.**

## 1. Config is hostile input. Validate at source.

The config API (`sanitiseConfig` in `api/_auth.js`) only strips `<script>`
tags. Everything else reaches the widget as-is, and the widget interpolates it
into a shadow `<style>` block, `style`/`class` attributes and `innerHTML`. So
every value must be validated in the widget before it is used, never trusted.

- **Colours**: hex only. `safeColor(v, fallback)` with
  `/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/`. Anything else falls back.
- **Font family**: a raw `fontFamily` in a `<style>` block is a stored-XSS sink
  (`x}</style><img onerror=...>` breaks out). Guard with `safeFontStack`:

  ```js
  function safeFontStack(v, fb) {
    const s = String(v == null ? '' : v).trim();
    return (s && s.length <= 120 && /^[A-Za-z0-9 ,"'-]+$/.test(s)) ? s : fb;
  }
  ```

- **URLs**: block `javascript:`, `vbscript:` and non-image `data:` URIs. Images
  may allow `data:image/*`; everything else is http(s) only.
- **Numbers**: `clamp(n, min, max)` with an `isFinite` guard.
- **Enums** (layout, theme, position): allow-list, else default.
- **Class slugs** built from config: `[a-z0-9-]` only.

This is the same lesson as the May credential audit at a different layer: never
trust an upstream layer to have cleaned the value for you.

## 2. Load a client-chosen web font, do not just name it

Naming a font in CSS does nothing if the font is not on the page. Inject the
stylesheet into `document.head` (it applies inside shadow roots too), once per
family, skipping Inter and empty values. A CSP-locked site simply falls back to
system fonts, no worse than before.

```js
function ensureFont(family) {
  if (!family || family === 'Inter' || typeof document === 'undefined') return;
  const id = 'tg-font-' + String(family).toLowerCase().replace(/\s+/g, '-');
  if (document.getElementById(id)) return;
  const l = document.createElement('link');
  l.id = id; l.rel = 'stylesheet';
  l.href = 'https://fonts.googleapis.com/css2?family=' +
    encodeURIComponent(family).replace(/%20/g, '+') +
    ':ital,wght@0,400;0,500;0,600;1,400&display=swap';
  document.head.appendChild(l);
}
```

Call it once in the constructor after config is resolved. Validate the family
with `safeFontStack` first (rule 1) so the value going into `<style>` is safe;
`ensureFont` itself is safe because it `encodeURIComponent`s the name.

## 3. Any image can fail. Fall back, do not show a broken glyph.

A photo or logo URL can 404, be a relative path that does not resolve on the
client's site, or be hotlink-blocked. Never leave the browser's broken-image
glyph on a client page. Attach an error handler **after render** (CSP forbids
inline `onerror`) that swaps the image for a sensible fallback (initials avatar,
placeholder, or hide).

```js
img.addEventListener('error', () => { /* swap to fallback */ }, { once: true });
```

Carry whatever the fallback needs on `data-` attributes on the `<img>` so the
handler has no external state. Re-bind after any partial re-render that replaces
`innerHTML` without a full rebuild.

## 4. Timers and animation frames must self-terminate

Nobody calls `destroy()` on a client SPA that swaps pages or removes the widget
container. A `setInterval` or `requestAnimationFrame` loop then runs forever
against a detached shadow tree, wasting CPU and pinning memory. Every repeating
callback checks the host and tears itself down the first time it fires after the
host has left the document.

```js
if (this.el && !this.el.isConnected) { this.destroy(); return; }
```

`destroy()` must clear every timer, cancel every rAF, and remove every listener
it added to `document`/`window`/`matchMedia`.

## 5. Resolve the API base from the script's own origin

The widget is hosted on `widgets.travelify.io` and embedded on customer sites. A
relative `/api/...` resolves to the customer's origin and 404s. Resolve from,
in order: `window.__TG_WIDGET_API__`, `document.currentScript.src` origin, a
scan of script tags for the widget filename, then relative as a last resort.
This applies to every endpoint the widget calls, not just the config fetch.

## 6. Lead capture never silently drops a lead

Lead widgets (Newsletter, Popup, Enquiry) are the ones where a bug loses real
money. Rules proven in this suite:

- The master Submissions record is the lead's home; ESP destinations are
  fan-out. Return `ok:false` to the visitor **only on total loss** (no
  Submissions record AND zero destinations delivered). A lead safely in the
  inbox is a success even if a destination failed.
- **Never cache a transient failure as a negative result.** A widget-lookup
  that caches `null` on a `429`/`5xx` poisons the warm serverless instance and
  drops every later submission until it recycles. Cache positive resolutions
  only; re-query on any miss.
- Preserve what the visitor typed across an error re-render. Rebuilding the
  shadow tree must not empty the form they are trying to submit.
- Success copy must be honest. Do not promise a "welcome email" the pipeline
  does not send.
- Consent: show the checkbox on every layout, never pre-tick it (UK GDPR/PECR),
  and when consent is required keep submit blocked until it is ticked.

## 7. Editors must not clobber a live widget on a failed load

An editor sets the widget id from the URL, then fetches its config. If that
fetch fails (transient `5xx`/`429` or a network blip) the editor is left holding
default config while still pointing at the real record, and the next save
overwrites the live widget with blank defaults. Guard it: track a `loadError`
flag on any failed load, and veto the save through the shell's opt-in
`canSave()` hook.

```js
// editor tgse.init({...})
canSave: () => {
  if (loadError) { tgse.toast('Not saving — reload to try again.', 'err'); return false; }
  return true;
},
```

The shell's `doSave` calls `opts.canSave()` before reading config or changing
save state; returning `false` aborts cleanly. Editors that do not provide the
hook are unaffected.

## 8. Format for the viewer, in the viewer's language

The widgets localise UI chrome to en/fr/de/es/it/ro via `makeT`. Numbers and
dates must follow. Format numbers with `Intl.NumberFormat(this.t.lang, ...)` so
grouping and decimal separators match the locale (1 234,5 in French, 1.234,5 in
German), not hardcoded comma-and-dot. Cache the formatter if it runs per frame.
Carry the `lang` config override through `_defaults` so a config-set language is
honoured, not only the browser's.

## 9. Credentials resolve from the owning client, never a guessed email

(From the May credential audit, still binding.) A widget belongs to a client,
not the staff user who created it. Any endpoint that touches client
credentials resolves them from the widget's `ClientRecordId` (captured at save
from the session's `clientId`), never from a guessed `ClientEmail` (one staff
email maps to many clients and resolves the wrong account). `canModifyWidget`
must not deny the real owner when the session lacks a `clientId` claim; fall
back to the email match rather than hard-denying.

## Pre-ship checklist

- [ ] Every config value validated at source (colour, font, URL, number, enum).
- [ ] `fontFamily` passed through `safeFontStack` before any `<style>` block.
- [ ] Chosen web font loaded via `ensureFont`.
- [ ] Images have a CSP-safe error fallback.
- [ ] Every timer/rAF self-terminates on `!isConnected`; `destroy()` clears all.
- [ ] API base resolved from the script origin, not a relative path.
- [ ] Lead path: `ok:false` only on total loss; no negative caching; form state
      preserved on error; honest success copy; consent correct.
- [ ] Editor guards a save behind `canSave()` when a load failed.
- [ ] Numbers and dates formatted in the viewer's locale.
- [ ] Credential resolution keyed on `ClientRecordId`, not a guessed email.
- [ ] A headless Playwright test with a negative control ships with the fix.
