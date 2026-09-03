# Love2Shop heart loader

An animated GIF loader built from the Love2Shop Holidays logo. The O from the
wordmark, a solid disc with the heart knocked out of it, swings slowly along a
track: out to the right, then back to the left, on a loop, with the heart
beating as it goes. A blue trail stretches out behind it as it picks up speed
and fades away as it slows into each turn.

The disc and heart are the logo's own paths, lifted verbatim from the master
SVG (`love2shop-holidays-logo.svg`, "L2S Holidays Logo_Master 2023", sent by
Kevin Doyle on 16 Jul 2026), so the shape matches the logo exactly.

| Colour | Use |
| --- | --- |
| `#E10054` Secondary | the O |
| `#2F49EA` Primary | the trail (and a light tint of it for the track) |

## Files

The finished GIFs live in `public/loaders/`, so they are served by Vercel:

- `love2shop-loader.gif` (240×80) and `love2shop-loader@2x.gif` (480×160)

Each is 100 frames at 25 fps, a 4 second loop (2 seconds each way), looping
forever, on a pure white background.

In this folder:

- `loader.html` is the animation. Open it in a browser to watch it live.
  `window.setTime(t)` draws any moment of the loop, which is how the frames
  are captured. It also carries two other colourways that are not built by
  default: `?theme=white` (blue O, pink trail) and `?theme=blue` (reversed
  out in white on the primary blue).
- `logo-o.js` holds the O and heart paths from the logo.
- `love2shop-holidays-logo.svg` is the master logo those paths came from.
- `build.mjs` renders the frames with Playwright and calls `make-gif.py`.
- `make-gif.py` assembles the PNG frames into a GIF with one shared palette,
  pinning the exact brand colours and pure white so the background never
  shows as a faint box. Needs Python 3 with Pillow.

## Rebuilding

```
pip install pillow
node scripts/loaders/love2shop/build.mjs
```

To change the look, edit the geometry block at the top of `loader.html`
(circle size, track length, trail length, loop length), then rebuild. To
build the other colourways, add them to `variants` in `build.mjs`.
