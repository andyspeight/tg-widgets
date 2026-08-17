# TG Slicer — quick start

An internal accelerator. Capture any component off any live website and send it
to Travelgenix Sites as an editable section. Not a product to sell, not a
slicer.dev competitor.

## The loop (all local, no network)

```
  [ Live website ]
        |  point, lock, capture
        v
  capture.js       clean slice { html, css, meta }
        |  Send to Travelgenix Sites (outbox)
        v
  bridge.js        on the Sites editor domain, hands it over
        v
  Import tab       one click adds it
        v
  CMS import       native blocks, AI rebuild or an imported section
```

## Run it

1. Load `tg-slicer` unpacked at `chrome://extensions` (Developer mode, Load
   unpacked). No endpoint or secret to set.
2. On any site, slice a component, hit **Send to Travelgenix Sites**.
3. In an open Sites editor, add it from the **Import** tab.

## Locked decisions

1. Internal accelerator, not a standalone product.
2. Output is an editable Travelgenix Sites section, reached through the CMS
   import. The slicer captures; it does not emit or rebuild.
3. No AI and no network in the slicer. The capture is deterministic.
4. Legitimate use: sites the client or prospect owns, or a well-known reference
   site as a live throwaway demo. No permanent published clones.
