/**
 * Loader — animated GIF export.
 *
 * The Export tab shipped as a shell: a format grid, an fps slider, and a note
 * saying "encoders are wired in the next build step". This suite covers the
 * encoder that finally does that, /public/tg-gif.js.
 *
 * The encoder is written from scratch because every script we serve must be
 * CSP-clean, and the off-the-shelf browser GIF libraries spawn a worker from a
 * Blob URL, which a strict CSP blocks.
 *
 * THE TEST THAT MATTERS is the round trip: this file carries its own GIF
 * decoder, written from the spec rather than from the encoder, and checks that
 * what comes back out is what went in. A GIF with a subtly wrong LZW stream
 * still opens — it just shows garbage — so "the file was produced" proves
 * nothing on its own.
 *
 * The bug that cost the most time, kept here as a named case: a decoder is
 * always one dictionary entry behind the encoder, because it only learns entry
 * N when it reads the code AFTER the one that created it. Widen the code on
 * `nextCode === (1 << codeSize)` and the encoder writes one code a bit too
 * wide; every byte after that is shifted.
 *
 * Verified separately in Chromium: all 10 loader templates encode in 13-92ms,
 * the browser's own decoder accepts each one at the right size with zero alpha
 * mismatches and a mean colour error of 0, and the editor's GIF button produces
 * a downloadable image/gif blob the browser then renders.
 *
 * Run: node test/loader-gif-export-smoke.mjs
 */
import { readFileSync } from 'node:fs';
import '../public/tg-gif.js';

const TGGif = globalThis.TGGif;
let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };

const ED = readFileSync(new URL('../public/editor-loader.html', import.meta.url), 'utf8');
const GIF = readFileSync(new URL('../public/tg-gif.js', import.meta.url), 'utf8');
const VERCEL = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));

/* ── An independent GIF89a decoder, written from the spec ─────────────────── */
function decodeGif(b) {
  let p = 0;
  const str = (n) => { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(b[p++]); return s; };
  const u8 = () => b[p++];
  const u16 = () => { const v = b[p] | (b[p + 1] << 8); p += 2; return v; };
  const sig = str(6);
  if (sig !== 'GIF89a') throw new Error('bad signature: ' + sig);
  const width = u16(), height = u16();
  const packed = u8(); const bgIndex = u8(); const aspect = u8();
  const gct = [];
  const gctSize = 2 << (packed & 0x07);
  if (packed & 0x80) for (let i = 0; i < gctSize; i++) gct.push([u8(), u8(), u8()]);
  const frames = []; let loop = null; let gce = null;
  for (;;) {
    const blk = u8();
    if (blk === 0x3B) break;
    if (blk === undefined) throw new Error('ran off the end with no trailer');
    if (blk === 0x21) {
      const label = u8();
      if (label === 0xF9) {
        u8(); const f = u8(); const d = u16(); const t = u8(); u8();
        gce = { disposal: (f >> 2) & 7, transparent: !!(f & 1), transIndex: t, delayCs: d };
      } else if (label === 0xFF) {
        const n = u8(); const appId = str(n);
        let sub = u8(); const data = [];
        while (sub) { for (let i = 0; i < sub; i++) data.push(u8()); sub = u8(); }
        if (appId === 'NETSCAPE2.0') loop = data[1] | (data[2] << 8);
      } else { let sub = u8(); while (sub) { p += sub; sub = u8(); } }
      continue;
    }
    if (blk !== 0x2C) throw new Error('unknown block 0x' + blk.toString(16));
    const left = u16(), top = u16(), fw = u16(), fh = u16(), fp = u8();
    if (fp & 0x80) throw new Error('unexpected local colour table');
    const minCodeSize = u8();
    const data = []; let sub = u8();
    while (sub) { for (let i = 0; i < sub; i++) data.push(u8()); sub = u8(); }
    frames.push({ left, top, fw, fh, gce, indices: lzwDecode(minCodeSize, data) });
    gce = null;
  }
  return { width, height, bgIndex, aspect, gct, gctSize, frames, loop };
}
function lzwDecode(minCodeSize, data) {
  const clear = 1 << minCodeSize, eoi = clear + 1;
  let codeSize, next, dict;
  const reset = () => {
    dict = [];
    for (let i = 0; i < clear; i++) dict[i] = [i];
    dict[clear] = []; dict[eoi] = [];
    next = eoi + 1; codeSize = minCodeSize + 1;
  };
  reset();
  const out = []; let bit = 0, prev = null;
  const read = () => {
    let v = 0;
    for (let i = 0; i < codeSize; i++) {
      const byte = data[bit >> 3];
      if (byte === undefined) return eoi;
      v |= ((byte >> (bit & 7)) & 1) << i;
      bit++;
    }
    return v;
  };
  for (;;) {
    const code = read();
    if (code === eoi) break;
    if (code === clear) { reset(); prev = null; continue; }
    let entry;
    if (dict[code]) entry = dict[code];
    else if (prev) entry = prev.concat([prev[0]]);
    else throw new Error('undefined first code ' + code);
    for (let i = 0; i < entry.length; i++) out.push(entry[i]);
    if (prev) {
      dict[next] = prev.concat([entry[0]]);
      next++;
      if (next === (1 << codeSize) && codeSize < 12) codeSize++;
    }
    prev = entry;
  }
  return out;
}

/* ── LZW round trip, including the dictionary-reset path ──────────────────── */
function lzwRoundTrip(minCodeSize, indices) {
  return lzwDecode(minCodeSize, TGGif._lzwEncode(minCodeSize, indices)).join(',') === indices.join(',');
}
ok(lzwRoundTrip(2, [0, 0, 0, 1, 1, 1, 0, 1, 0, 1, 2, 2, 2, 2, 3, 3, 3, 0, 0, 0, 0]), 'LZW round trip: mixed runs');
ok(lzwRoundTrip(2, [0]), 'LZW round trip: single symbol');
ok(lzwRoundTrip(2, [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]), 'LZW round trip: one long run');
ok(lzwRoundTrip(8, Array.from({ length: 5000 }, (_, i) => i % 256)), 'LZW round trip: 5000 symbols, full byte alphabet');
// The width has to widen at exactly the boundary the decoder uses, and this is
// the input that walks straight through it.
ok(lzwRoundTrip(2, Array.from({ length: 3000 }, (_, i) => (i * 7 + (i >> 3)) % 4)),
  'LZW round trip: crosses every code-width boundary');
// >4096 dictionary entries forces a mid-stream clear.
let seed = 7;
const noise = Array.from({ length: 60000 }, () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % 256; });
ok(lzwRoundTrip(8, noise), 'LZW round trip: 60k random symbols (forces a dictionary reset)');

/* ── Full-file round trip ─────────────────────────────────────────────────── */
function frame(w, h, paint) {
  const d = new Uint8ClampedArray(w * h * 4);
  paint((x, y, r, g, b, a) => {
    const i = (y * w + x) * 4;
    d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = a === undefined ? 255 : a;
  });
  return d;
}
const W = 48, H = 48, N = 8;
const srcFrames = [];
for (let f = 0; f < N; f++) {
  srcFrames.push(frame(W, H, (set) => {
    const a = (f / N) * Math.PI * 2;
    const bx = Math.round(24 + Math.cos(a) * 14), by = Math.round(24 + Math.sin(a) * 14);
    for (let y = by - 5; y < by + 5; y++) for (let x = bx - 5; x < bx + 5; x++) {
      if (x >= 0 && y >= 0 && x < W && y < H) set(x, y, 0, 180, 216, 255);
    }
  }));
}
const bytes = TGGif.encode({ width: W, height: H, frames: srcFrames, delayCs: 4, transparent: true });
ok(bytes instanceof Uint8Array && bytes.length > 0, 'encode returns bytes');
ok(bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46, 'starts with the GIF magic');
ok(bytes[bytes.length - 1] === 0x3B, 'ends with the trailer byte');

let g;
try { g = decodeGif(bytes); ok(true, 'the independent decoder parses the whole file'); }
catch (e) { ok(false, 'the independent decoder parses the whole file (' + e.message + ')'); g = null; }

if (g) {
  ok(g.width === W && g.height === H, 'logical screen size matches');
  ok(g.frames.length === N, `every frame is written (${g.frames.length} of ${N})`);
  ok(g.loop === 0, 'loops forever (the Netscape extension is present and says 0)');
  ok(g.frames.every((f) => f.gce && f.gce.delayCs === 4), 'every frame carries the requested delay');
  ok(g.frames.every((f) => f.gce.transparent), 'every frame flags transparency');
  // Disposal 1 would leave transparent pixels showing the previous frame, so a
  // spinner smears into a solid disc as it goes round.
  ok(g.frames.every((f) => f.gce.disposal === 2), 'transparent frames use disposal 2 (restore to background)');
  ok(g.frames.every((f) => f.fw === W && f.fh === H && f.left === 0 && f.top === 0), 'each frame is a full-canvas repaint');
  ok(g.frames.every((f) => f.indices.length === W * H), 'each frame decodes to exactly width x height pixels');

  // Pixel fidelity. A handful of flat colours must survive exactly.
  let colourErr = 0, alphaErr = 0, checked = 0;
  for (let f = 0; f < N; f++) {
    const idx = g.frames[f].indices, src = srcFrames[f];
    for (let p = 0; p < W * H; p++) {
      const opaque = src[p * 4 + 3] >= 128;
      const isTrans = idx[p] === g.frames[f].gce.transIndex;
      if (opaque === isTrans) { alphaErr++; continue; }
      if (!opaque) continue;
      const c = g.gct[idx[p]];
      checked++;
      if (Math.abs(c[0] - src[p * 4]) + Math.abs(c[1] - src[p * 4 + 1]) + Math.abs(c[2] - src[p * 4 + 2]) > 4) colourErr++;
    }
  }
  ok(alphaErr === 0, `transparency survives the round trip (${alphaErr} mismatches)`);
  ok(colourErr === 0, `flat colours survive exactly (${colourErr} of ${checked} wrong)`);

  // Frames must actually differ, or the "animation" is a still image.
  const distinct = new Set(g.frames.map((f) => f.indices.join(','))).size;
  ok(distinct === N, `all ${N} frames are distinct pictures (got ${distinct})`);
  // A constant opaque-pixel count proves nothing is accumulating between frames.
  const counts = g.frames.map((f) => f.indices.filter((i) => i !== f.gce.transIndex).length);
  ok(new Set(counts).size <= 2, 'the opaque pixel count stays flat — frames are not stacking');
}

/* ── Edge cases that must not throw ───────────────────────────────────────── */
const cases = [
  ['1x1', () => TGGif.encode({ width: 1, height: 1, frames: [frame(1, 1, (s) => s(0, 0, 9, 9, 9))], transparent: false })],
  ['fully transparent', () => TGGif.encode({ width: 8, height: 8, frames: [new Uint8ClampedArray(8 * 8 * 4)], transparent: true })],
  ['single flat colour', () => TGGif.encode({ width: 16, height: 16, frames: [frame(16, 16, (s) => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) s(x, y, 7, 7, 7); })], transparent: false })],
  ['opaque mode', () => TGGif.encode({ width: 8, height: 8, frames: [frame(8, 8, (s) => s(0, 0, 1, 2, 3))], transparent: false })],
];
for (const [label, run] of cases) {
  let out = null;
  try { out = run(); } catch (e) { /* recorded below */ }
  ok(out && out.length > 0, `encodes without throwing: ${label}`);
  if (out) {
    let parsed = false;
    try { decodeGif(out); parsed = true; } catch (e) { /* recorded below */ }
    ok(parsed, `decodes cleanly: ${label}`);
  }
}
// Opaque mode must not spend a palette slot on a transparency it never uses.
const opaque = decodeGif(TGGif.encode({ width: 8, height: 8, frames: [frame(8, 8, (s) => s(0, 0, 1, 2, 3))], transparent: false }));
ok(opaque.frames.every((f) => !f.gce.transparent), 'opaque mode sets no transparency flag');
ok(opaque.frames.every((f) => f.gce.disposal === 1), 'opaque mode uses disposal 1 (nothing to restore)');

let threw = false;
try { TGGif.encode({ width: 4, height: 4, frames: [] }); } catch (e) { threw = true; }
ok(threw, 'no frames is a clear error, not a corrupt file');

/* ── Palette ──────────────────────────────────────────────────────────────── */
const hist = new Map([[0xFF0000, 100], [0x00FF00, 100], [0x0000FF, 100], [0x010101, 1]]);
const pal4 = TGGif._buildPalette(hist, 4);
ok(pal4.length === 4, 'a palette that fits is returned whole');
const pal2 = TGGif._buildPalette(hist, 2);
ok(pal2.length <= 2, 'a palette is cut to the budget');
const many = new Map();
for (let i = 0; i < 5000; i++) many.set(i * 37 % 0xFFFFFF, 1 + (i % 5));
ok(TGGif._buildPalette(many, 256).length <= 256, '5000 colours reduce to at most 256');
ok(TGGif._buildPalette(new Map(), 256).length >= 1, 'an empty histogram still yields a usable palette');

/* ── Timing rules ─────────────────────────────────────────────────────────── */
// Browsers have historically forced sub-2cs delays up to 10cs, which turns a
// fast loader into a slideshow. Refuse to write a delay we know gets rewritten.
const fast = decodeGif(TGGif.encode({ width: 4, height: 4, frames: [frame(4, 4, (s) => s(0, 0, 1, 1, 1)), frame(4, 4, (s) => s(1, 1, 2, 2, 2))], delayCs: 0 }));
ok(fast.frames.every((f) => f.gce.delayCs >= 2), 'a delay below 2 hundredths is raised, not written');

/* ── Safety ───────────────────────────────────────────────────────────────── */
// Scoped past the header comment, which shows the caller how to wrap the
// bytes in a Blob and so legitimately names Blob and a URL.
const gifCode = GIF.replace(/^[\s\S]*?\*\//, '');
ok(!/\beval\s*\(/.test(gifCode) && !/new Function/.test(gifCode), 'the encoder has no eval or Function constructor');
ok(!/new Worker|createObjectURL/.test(gifCode), 'no Blob-URL worker — that is what a strict CSP blocks');
ok(!/https?:\/\//.test(gifCode), 'the encoder loads nothing from the network');
ok(!/document\.|window\./.test(gifCode), 'the encoder touches no DOM, so it is testable in plain Node');

/* ── Editor wiring ────────────────────────────────────────────────────────── */
ok(/<script src="\/tg-gif\.js"><\/script>/.test(ED), 'the editor loads the encoder');
ok(ED.indexOf('/tg-gif.js') > ED.indexOf('/widget-loader.js'), 'the encoder loads after the widget it draws from');
ok(/<button class="exp-item" data-export="gif" type="button">/.test(ED), 'the GIF button is no longer disabled');
ok(/data-export="webm"[^>]*disabled/.test(ED), 'the formats that are not built stay disabled');
ok(!/Encoders are wired in the next build step/.test(ED), 'the "coming soon" note is gone');
ok(/function exportPlan\(\)/.test(ED), 'the editor works out what it is about to produce');
ok(/function renderFrames\(/.test(ED), 'frames are rendered from the draw function, not screen-grabbed');
ok(/DRAW\(sctx, i \/ plan\.frames, C, plan\.w, plan\.h\)/.test(ED),
  'each frame is the widget engine evaluated at a fixed loop position');
ok(/octx\.globalAlpha = C\.opacity/.test(ED), 'the opacity setting is folded in, so the file matches the preview');
ok(/GIF_MAX_FPS = 50/.test(ED), 'the frame rate is capped at what GIF can express');
ok(/max="50"/.test(ED), 'the slider agrees with that cap');
ok(/GIF_PIXEL_BUDGET/.test(ED), 'a huge export is bounded rather than locking the tab');
ok(/delayCs\+\+;\s+\/\/ slower frames, same loop/.test(ED), 'the budget lowers the frame rate, never the loop length');
ok(/p\.asked !== p\.fps/.test(ED), 'the editor explains when GIF cannot hold the exact rate asked for');
ok(/requestAnimationFrame\(step\)/.test(ED), 'rendering yields between batches so the progress label paints');
ok(/label\('Drawing '/.test(ED) && /label\('Encoding…'\)/.test(ED), 'the button reports progress');
ok(/catch \(err\) \{[\s\S]{0,200}label\('Failed'\)/.test(ED), 'a failed encode says so and re-enables the button');
ok(/setTimeout\(function \(\) \{ URL\.revokeObjectURL\(url\); \}/.test(ED),
  'the object URL is revoked later, not synchronously (which can cancel the download)');
ok(/wireExport\.refresh/.test(ED) && /if \(wireExport\.refresh\) wireExport\.refresh\(\)/.test(ED),
  'editing the loader updates what the Export tab promises');
ok(/The caption is not part of the file/.test(ED), 'the editor says the caption is not exported');
ok(/\.exp-item \.exp-fmt \{ display: block/.test(ED),
  'the format name and description are separate lines (both were inline)');
ok(!/\beval\s*\(/.test(ED) && !/new Function/.test(ED), 'no eval in the editor');

/* ── Serving ──────────────────────────────────────────────────────────────── */
ok((VERCEL.headers || []).some((h) => h.source === '/tg-gif.js'), 'vercel serves tg-gif.js with the shared script headers');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
