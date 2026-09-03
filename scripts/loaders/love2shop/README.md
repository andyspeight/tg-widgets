# Love2Shop heart loader

An animated GIF loader built from the Love2Shop Holidays logo. The O from the
wordmark, a solid disc with the heart knocked out of it, travels left to right
along a track that fills behind it, the heart beating as it goes. At the end
the bar drains into the O, which pops away, and a fresh one settles in at the
start, so the loop is seamless.

The disc and heart are the logo's own paths, lifted verbatim from the master
SVG (`love2shop-holidays-logo.svg`, "L2S Holidays Logo_Master 2023", sent by
Kevin Doyle on 16 Jul 2026), so the shape matches the logo exactly.

| Colour | Use |
| --- | --- |
| `#2F49EA` Primary | the O on white (as the master logo), the blue background variant |
| `#E10054` Secondary | the bar on white, the O in the pink variant |

## Files

The finished GIFs live in `public/loaders/`, so they are served by Vercel.
Each is 50 frames at 25 fps, a 2 second loop, looping forever, at 1x (240×80)
and 2x (480×160):

- `love2shop-loader.gif` and `love2shop-loader@2x.gif`: the O in the primary
  blue on white, the bar in pink
- `love2shop-loader-pink.gif` and `love2shop-loader-pink@2x.gif`: the O in the
  secondary pink on white, the bar in blue
- `love2shop-loader-blue.gif` and `love2shop-loader-blue@2x.gif`: reversed out
  in white on the primary blue

In this folder:

- `loader.html` is the animation. Open it in a browser to watch it live
  (`?theme=pink` or `?theme=blue` for the other colourways). `window.setTime(t)`
  draws any moment of the loop, which is how the frames are captured.
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
(circle size, track length) or the timeline constants further down, then
rebuild.
