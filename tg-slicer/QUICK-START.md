# TG Slicer — build map and quick start

An internal accelerator. Capture any component off any live website and turn it into a reusable Travelgenix Duda widget, restyled to our brand and editable through Duda's own panels.

Not a product to sell, not a Slicer competitor. A Slicer-shaped tool pointed inward, to speed up every client site and widget build.

## The three stages

```
  [ Live website ]
        │  point, lock, capture
        ▼
  STAGE 1  TG Slicer extension (capture engine)
        │  clean slice JSON { html, css, meta }
        ▼
  STAGE 2  /api/slice-emit  (Vercel + Claude)
        │  strict-JSON Duda build sheet
        ▼
  STAGE 3  Review tab (in the extension)
        │  preview, per-field copy, full export
        ▼
  Duda Widget Builder  →  reusable section on every client site
```

## What to deploy, in order

1. **Endpoint.** Copy `slice-emit.js` into `andyspeight/tg-widgets` at `api/slice-emit.js`. Set the env vars in `SLICE-EMIT-DEPLOY.md` (`ANTHROPIC_API_KEY`, `TGS_SHARED_SECRET`, and optionally `TGS_MODEL`, `TGS_ALLOWED_ORIGIN`, `UPSTASH_*`). Push, Vercel auto-deploys.
2. **Extension.** Load `tg-slicer-v2` unpacked at `chrome://extensions`. In the popup set the endpoint URL and the same shared secret.
3. **Test.** On any site, slice a component, hit **Make Duda widget**, and confirm the review tab opens with a build sheet and preview.
4. **Build one in Duda.** Follow the review tab to create the inputs and paste the HTML/CSS into Widget Builder. Publish. Confirm a non-coder can drop it on a site and restyle it through Duda's panels, and that it picks up the site theme colour automatically.

## Files in this delivery

| File | What it is |
|------|------------|
| `tg-slicer-extension-v0.2.zip` | The full extension: capture + send + review (Stages 1 & 3) |
| `slice-emit.js` | The Stage 2 Vercel endpoint for `tg-widgets/api/` |
| `SLICE-EMIT-DEPLOY.md` | Endpoint deploy, env vars, smoke test, wiring |
| `tg-slicer-v2-README.md` | How the extension works end to end |
| `tg-why-book-band-duda-widget.md` | The hand-made proof widget (reference for what good output looks like) |

## The five decisions locked (so we don't re-argue them)

1. Internal accelerator, not a standalone product.
2. Output target is a Duda Custom Widget via Widget Builder, for reuse + native styling + versioning + theme-colour match.
3. Lives in the existing `tg-widgets` repo.
4. Stage 1 doesn't capture hover/focus/`@media`; the emit step rebuilds responsive behaviour to our tokens.
5. Debrand by default, never carry source logos, trademarks or photography.

## Open questions for later

1. Does Duda's Partner API allow programmatic widget creation, so we could auto-install instead of pasting once per component?
2. Internal-only forever, or eventually a client-facing portal feature? (Sets how hard to harden.)
3. Is the copy-paste-from-review flow enough, or do we want a saved slice library?
