# TG Slicer — build map and quick start

An internal accelerator. Capture any component off any live website and turn it
into a reusable Travelgenix Duda widget, editable through Duda's own panels.

Not a product to sell, not a Slicer competitor. A Slicer-shaped tool pointed
inward, to speed up every client site and widget build.

## The three stages (v0.3.0, all local)

```
  [ Live website ]
        |  point, lock, capture
        v
  STAGE 1  capture.js        clean slice { html, css, meta }
        |
        v
  STAGE 2  emit-local.js     Duda build sheet, built locally, no network
        |
        v
  STAGE 3  review tab        preview, per-field copy, full preview, export
        |
        v
  Duda Widget Builder  ->  reusable section on every client site
```

The earlier AI emit step (Vercel plus Claude) is now optional and off the default
path. See `AI-EMIT-ENDPOINT.md` if you ever wire it up.

## Run it

1. Load `tg-slicer` unpacked at `chrome://extensions` (Developer mode, Load
   unpacked). Leave the popup endpoint and secret blank.
2. On any site, slice a component, hit **Make Duda widget**, and the review tab
   opens with the build sheet and a preview.
3. Hit **Open full preview** and compare it to the original.
4. Build one into Duda Widget Builder (see `SHOW-RUNBOOK.md`), publish, and
   confirm a non-coder can drop it on a site and restyle it through Duda's panels,
   and that it picks up the site theme colour.

## The five decisions locked (so we do not re-argue them)

1. Internal accelerator, not a standalone product.
2. Output is a Duda Custom Widget via Widget Builder, for reuse, native styling,
   versioning and theme-colour match.
3. Lives in the existing `tg-widgets` repo.
4. Stage 1 does not capture hover, focus or `@media`. The build rebuilds
   responsive behaviour to our tokens.
5. Debrand by default, never carry source logos, trademarks or photography.

## Open questions for later

1. Does Duda's Partner API allow programmatic widget creation, so we could
   auto-install instead of pasting once per component?
2. Internal-only forever, or eventually a client-facing portal feature?
3. Is copy-paste-from-review enough, or do we want a saved slice library?
