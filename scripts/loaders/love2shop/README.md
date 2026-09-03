# Love2Shop heart loader

An animated GIF loader in the Love2Shop colours: the O from the wordmark (a
bold pink ring with the pink heart inside it) travels left to right along a
track that fills in the primary blue, the heart beating as it goes. At the end
the bar drains into the O, which pops away, and a fresh one settles in at the
start, so the loop is seamless.

| Colour | Use |
| --- | --- |
| `#2F49EA` Primary | track fill, blue background variant |
| `#E10054` Secondary | the O ring and the heart |

## Files

The finished GIFs live in `public/loaders/`, so they are served by Vercel:

- `love2shop-loader.gif` (240×80) and `love2shop-loader@2x.gif` (480×160), on white
- `love2shop-loader-blue.gif` and `love2shop-loader-blue@2x.gif`, reversed out on the primary blue

Each is 50 frames at 25 fps, a 2 second loop, looping forever.

In this folder:

- `loader.html` is the animation. Open it in a browser to watch it live
  (`?theme=blue` for the blue version). `window.setTime(t)` draws any moment
  of the loop, which is how the frames are captured.
- `heart.js` draws the heart from geometry (two round lobes, a soft notch,
  gently convex sides meeting in a point), so it stays crisp at any size.
- `build.mjs` renders the frames with Playwright and calls `make-gif.py`.
- `make-gif.py` assembles the PNG frames into a GIF with one shared palette,
  so nothing flickers between frames. Needs Python 3 with Pillow.

## Rebuilding

```
pip install pillow
node scripts/loaders/love2shop/build.mjs
```

To change the look, edit the geometry block at the top of `loader.html`
(circle size, ring weight, track length) or the timeline constants further
down, then rebuild.
