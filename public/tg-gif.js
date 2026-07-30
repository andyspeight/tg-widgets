/**
 * TG GIF — a self-contained animated-GIF89a encoder.
 *
 * Written from scratch rather than pulled from a CDN because every script this
 * platform serves has to be CSP-clean: no external hosts, no eval, no Function
 * constructor. The popular browser GIF libraries fail at least one of those
 * (most spawn a worker from a Blob URL, which a strict CSP blocks).
 *
 * Usage:
 *   const bytes = TGGif.encode({
 *     width, height,
 *     frames: [Uint8ClampedArray],   // RGBA, width*height*4, one per frame
 *     delayCs: 4,                    // hundredths of a second per frame
 *     transparent: true,             // keep alpha as a hard cut-out
 *     maxColors: 256,
 *     onProgress: (done, total) => {},
 *   });
 *   const blob = new Blob([bytes], { type: 'image/gif' });
 *
 * WHY GIF LOOKS THE WAY IT DOES, so nobody files these as bugs:
 *  - 256 colours per file, so smooth gradients get banded. The quantiser picks
 *    the best 256 for THIS animation, and dithering softens the banding.
 *  - Exactly ONE transparent colour, fully on or fully off. There is no
 *    semi-transparency in the format, so antialiased edges against a
 *    transparent background become hard edges. A matte colour avoids that.
 *  - Frame timing is in hundredths of a second, so 50fps is the practical
 *    ceiling and browsers historically clamp anything under 2cs.
 */
(function (root) {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Byte sink                                                           *
   * ------------------------------------------------------------------ */
  function Bytes() {
    this.buf = new Uint8Array(1024);
    this.len = 0;
  }
  Bytes.prototype._room = function (n) {
    if (this.len + n <= this.buf.length) return;
    var cap = this.buf.length;
    while (cap < this.len + n) cap *= 2;
    var next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  };
  Bytes.prototype.u8 = function (v) { this._room(1); this.buf[this.len++] = v & 0xFF; };
  Bytes.prototype.u16 = function (v) { this.u8(v & 0xFF); this.u8((v >> 8) & 0xFF); };
  Bytes.prototype.str = function (s) { for (var i = 0; i < s.length; i++) this.u8(s.charCodeAt(i)); };
  Bytes.prototype.raw = function (arr) { this._room(arr.length); this.buf.set(arr, this.len); this.len += arr.length; };
  Bytes.prototype.done = function () { return this.buf.subarray(0, this.len); };

  /* ------------------------------------------------------------------ *
   * Colour quantisation — median cut over a histogram                   *
   * ------------------------------------------------------------------ */

  /** Histogram of packed RGB → count, across every frame at once.
   *  ONE palette for the whole animation, deliberately: a per-frame palette
   *  makes colours shimmer between frames, which on a spinner reads as a
   *  rendering fault rather than a compression artefact. */
  function histogram(frames, alphaCut) {
    var hist = new Map();
    for (var f = 0; f < frames.length; f++) {
      var d = frames[f];
      for (var i = 0; i < d.length; i += 4) {
        if (d[i + 3] < alphaCut) continue;         // transparent, not a colour
        var key = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
        hist.set(key, (hist.get(key) || 0) + 1);
      }
    }
    return hist;
  }

  function boxBounds(box) {
    var rMin = 255, rMax = 0, gMin = 255, gMax = 0, bMin = 255, bMax = 0;
    for (var i = 0; i < box.items.length; i++) {
      var c = box.items[i];
      if (c.r < rMin) rMin = c.r; if (c.r > rMax) rMax = c.r;
      if (c.g < gMin) gMin = c.g; if (c.g > gMax) gMax = c.g;
      if (c.b < bMin) bMin = c.b; if (c.b > bMax) bMax = c.b;
    }
    box.rMin = rMin; box.rMax = rMax;
    box.gMin = gMin; box.gMax = gMax;
    box.bMin = bMin; box.bMax = bMax;
    // Weighted by how the eye actually sees each channel, so a box that varies
    // in green is split before one that varies as much in blue.
    box.range = Math.max((rMax - rMin) * 0.30, (gMax - gMin) * 0.59, (bMax - bMin) * 0.11);
    return box;
  }

  function splitBox(box) {
    var dr = (box.rMax - box.rMin) * 0.30;
    var dg = (box.gMax - box.gMin) * 0.59;
    var db = (box.bMax - box.bMin) * 0.11;
    var ch = (dg >= dr && dg >= db) ? 'g' : (dr >= db ? 'r' : 'b');
    box.items.sort(function (a, b) { return a[ch] - b[ch]; });
    // Split at the POPULATION median, not the midpoint: a colour used by half
    // the pixels deserves half the palette, however narrow its range.
    var half = box.count / 2, run = 0, cut = 0;
    for (var i = 0; i < box.items.length; i++) {
      run += box.items[i].n;
      if (run >= half) { cut = i; break; }
    }
    if (cut < 1) cut = 1;
    if (cut >= box.items.length) cut = box.items.length - 1;
    var loItems = box.items.slice(0, cut);
    var hiItems = box.items.slice(cut);
    var sum = function (arr) { var s = 0; for (var j = 0; j < arr.length; j++) s += arr[j].n; return s; };
    return [
      boxBounds({ items: loItems, count: sum(loItems) }),
      boxBounds({ items: hiItems, count: sum(hiItems) }),
    ];
  }

  function averageColor(box) {
    var r = 0, g = 0, b = 0, n = 0;
    for (var i = 0; i < box.items.length; i++) {
      var c = box.items[i];
      r += c.r * c.n; g += c.g * c.n; b += c.b * c.n; n += c.n;
    }
    if (!n) return [0, 0, 0];
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
  }

  /** Median-cut palette. Returns an array of [r,g,b]. */
  function buildPalette(hist, maxColors) {
    var items = [];
    hist.forEach(function (n, key) {
      items.push({ r: (key >> 16) & 0xFF, g: (key >> 8) & 0xFF, b: key & 0xFF, n: n });
    });
    if (!items.length) return [[0, 0, 0]];
    if (items.length <= maxColors) {
      return items.map(function (c) { return [c.r, c.g, c.b]; });
    }
    var total = 0;
    for (var i = 0; i < items.length; i++) total += items[i].n;
    var boxes = [boxBounds({ items: items, count: total })];
    while (boxes.length < maxColors) {
      // Split the box that is both busy and wide. Population alone gives a flat
      // background the whole palette; range alone spends it on stray pixels.
      var best = -1, bestScore = 0;
      for (var b = 0; b < boxes.length; b++) {
        if (boxes[b].items.length < 2) continue;
        var score = boxes[b].range * Math.sqrt(boxes[b].count);
        if (score > bestScore) { bestScore = score; best = b; }
      }
      if (best < 0) break;                       // nothing left worth splitting
      var pair = splitBox(boxes[best]);
      boxes.splice(best, 1, pair[0], pair[1]);
    }
    return boxes.map(averageColor);
  }

  /** Nearest palette entry, memoised. A loader repeats the same few colours
   *  across every pixel of every frame, so the cache does nearly all the work. */
  function makeMatcher(palette) {
    var cache = new Map();
    return function (r, g, b) {
      var key = (r << 16) | (g << 8) | b;
      var hit = cache.get(key);
      if (hit !== undefined) return hit;
      var best = 0, bestD = Infinity;
      for (var i = 0; i < palette.length; i++) {
        var p = palette[i];
        var dr = r - p[0], dg = g - p[1], db = b - p[2];
        // Same luminance weighting as the split, so "nearest" means nearest to
        // the eye rather than nearest in raw RGB space.
        var d = dr * dr * 0.30 + dg * dg * 0.59 + db * db * 0.11;
        if (d < bestD) { bestD = d; best = i; if (d === 0) break; }
      }
      cache.set(key, best);
      return best;
    };
  }

  /* ------------------------------------------------------------------ *
   * Frame → palette indices                                             *
   * ------------------------------------------------------------------ */
  function indexFrame(rgba, w, h, match, palette, transIndex, alphaCut, dither) {
    var out = new Uint8Array(w * h);
    if (!dither) {
      for (var i = 0, p = 0; i < rgba.length; i += 4, p++) {
        out[p] = (transIndex >= 0 && rgba[i + 3] < alphaCut)
          ? transIndex
          : match(rgba[i], rgba[i + 1], rgba[i + 2]);
      }
      return out;
    }
    // Floyd-Steinberg. Errors are carried in a float buffer so a gradient
    // reduced to a handful of palette entries reads as a gradient rather than
    // as stripes. Never diffuse INTO a transparent pixel: that colours pixels
    // the viewer will never see and bleeds error across the cut-out edge.
    var err = new Float32Array(w * h * 3);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var p2 = y * w + x, i2 = p2 * 4, e = p2 * 3;
        if (transIndex >= 0 && rgba[i2 + 3] < alphaCut) { out[p2] = transIndex; continue; }
        var r = clamp255(rgba[i2] + err[e]);
        var g = clamp255(rgba[i2 + 1] + err[e + 1]);
        var b = clamp255(rgba[i2 + 2] + err[e + 2]);
        var idx = match(r, g, b);
        out[p2] = idx;
        var pal = palette[idx];
        var dr = r - pal[0], dg = g - pal[1], db = b - pal[2];
        spread(err, rgba, w, h, x + 1, y, dr, dg, db, 7 / 16, transIndex, alphaCut);
        spread(err, rgba, w, h, x - 1, y + 1, dr, dg, db, 3 / 16, transIndex, alphaCut);
        spread(err, rgba, w, h, x, y + 1, dr, dg, db, 5 / 16, transIndex, alphaCut);
        spread(err, rgba, w, h, x + 1, y + 1, dr, dg, db, 1 / 16, transIndex, alphaCut);
      }
    }
    return out;
  }
  function clamp255(v) { return v < 0 ? 0 : (v > 255 ? 255 : v); }
  function spread(err, rgba, w, h, x, y, dr, dg, db, f, transIndex, alphaCut) {
    if (x < 0 || x >= w || y >= h) return;
    var p = y * w + x;
    if (transIndex >= 0 && rgba[p * 4 + 3] < alphaCut) return;
    var e = p * 3;
    err[e] += dr * f; err[e + 1] += dg * f; err[e + 2] += db * f;
  }

  /* ------------------------------------------------------------------ *
   * LZW (the GIF variant)                                               *
   * ------------------------------------------------------------------ */
  function lzwEncode(minCodeSize, indices) {
    var clearCode = 1 << minCodeSize;
    var eoiCode = clearCode + 1;
    var codeSize = minCodeSize + 1;
    var nextCode = eoiCode + 1;
    var dict = new Map();
    var out = [];
    var cur = 0, curBits = 0;

    function emit(code) {
      cur |= code << curBits;
      curBits += codeSize;
      while (curBits >= 8) { out.push(cur & 0xFF); cur >>>= 8; curBits -= 8; }
    }

    emit(clearCode);
    if (!indices.length) { emit(eoiCode); if (curBits > 0) out.push(cur & 0xFF); return out; }

    var prefix = indices[0];
    for (var i = 1; i < indices.length; i++) {
      var k = indices[i];
      var key = (prefix << 8) | k;
      var found = dict.get(key);
      if (found !== undefined) { prefix = found; continue; }
      // Emit the run so far USING THE CURRENT CODE SIZE, then grow the
      // dictionary. Growing first would emit the code at a width the decoder
      // has not switched to yet, and the whole stream shears from that byte on.
      emit(prefix);
      dict.set(key, nextCode);
      nextCode++;
      if (nextCode === 4096) {
        // The dictionary is full. Tell the decoder to reset so both sides stay
        // in step, rather than silently overflowing 12-bit codes.
        emit(clearCode);
        dict = new Map();
        codeSize = minCodeSize + 1;
        nextCode = eoiCode + 1;
      } else if (nextCode === (1 << codeSize) + 1 && codeSize < 12) {
        // THE +1 IS THE WHOLE GAME. A decoder is always one entry behind: it
        // only learns entry N when it reads the code AFTER the one that
        // created it. So the encoder must keep writing at the narrower width
        // for one more code than a symmetric rule suggests. Widening on
        // `nextCode === (1 << codeSize)` writes that code one bit too wide,
        // the decoder reads it at the old width, and every byte from there on
        // is shifted — the file still opens, and shows garbage.
        codeSize++;
      }
      prefix = k;
    }
    emit(prefix);
    emit(eoiCode);
    if (curBits > 0) out.push(cur & 0xFF);
    return out;
  }

  /** GIF carries image data in sub-blocks of at most 255 bytes, each led by its
   *  own length, and closed with a zero-length block. */
  function writeSubBlocks(bytes, data) {
    var i = 0;
    while (i < data.length) {
      var n = Math.min(255, data.length - i);
      bytes.u8(n);
      for (var j = 0; j < n; j++) bytes.u8(data[i + j]);
      i += n;
    }
    bytes.u8(0);
  }

  /* ------------------------------------------------------------------ *
   * Encode                                                              *
   * ------------------------------------------------------------------ */
  function encode(opts) {
    var o = opts || {};
    var w = Math.max(1, Math.round(o.width || 0));
    var h = Math.max(1, Math.round(o.height || 0));
    var frames = o.frames || [];
    if (!frames.length) throw new Error('TGGif: no frames');
    // Browsers historically clamp delays under 2cs up to 10cs, which would make
    // a fast loader crawl. Refuse to write a delay we know gets rewritten.
    var delayCs = Math.max(2, Math.min(655, Math.round(o.delayCs || 4)));
    var transparent = o.transparent !== false;
    var alphaCut = typeof o.alphaCut === 'number' ? o.alphaCut : 128;
    var dither = o.dither !== false;
    var loop = typeof o.loop === 'number' ? o.loop : 0;   // 0 = forever
    var onProgress = typeof o.onProgress === 'function' ? o.onProgress : null;

    // One slot goes to transparency, so the colours share what is left.
    var maxColors = Math.max(2, Math.min(256, Math.round(o.maxColors || 256)));
    var colorBudget = transparent ? maxColors - 1 : maxColors;

    var hist = histogram(frames, transparent ? alphaCut : 0);
    var palette = buildPalette(hist, colorBudget);

    var transIndex = -1;
    if (transparent) {
      // Index 0 is the cut-out. Its RGB is never painted, but it must not be a
      // colour the image also uses, or a decoder that ignores the transparency
      // flag paints holes in the artwork.
      transIndex = 0;
      palette = [[0, 0, 0]].concat(palette);
    }

    // A GIF colour table is a power of two, 2..256, and it is padded not
    // trimmed — dropping entries would reindex every pixel.
    var tableSize = 2;
    while (tableSize < palette.length) tableSize *= 2;
    if (tableSize > 256) tableSize = 256;
    var gctBits = Math.round(Math.log(tableSize) / Math.LN2) - 1;   // 0..7

    var match = makeMatcher(palette);
    var minCodeSize = Math.max(2, gctBits + 1);

    var bytes = new Bytes();
    bytes.str('GIF89a');
    bytes.u16(w); bytes.u16(h);
    bytes.u8(0x80 | (0x07 << 4) | gctBits);   // GCT present, 8-bit colour resolution
    bytes.u8(transparent ? transIndex : 0);   // background colour index
    bytes.u8(0);                              // pixel aspect ratio: square

    for (var i = 0; i < tableSize; i++) {
      var c = palette[i] || [0, 0, 0];
      bytes.u8(c[0]); bytes.u8(c[1]); bytes.u8(c[2]);
    }

    // Netscape application extension — the only way to say "loop".
    // Without it the animation plays once and stops on the last frame.
    bytes.u8(0x21); bytes.u8(0xFF); bytes.u8(0x0B);
    bytes.str('NETSCAPE2.0');
    bytes.u8(0x03); bytes.u8(0x01); bytes.u16(loop); bytes.u8(0x00);

    // Disposal 2 (restore to background) when transparent: every frame here is
    // a full redraw, and with disposal 1 the transparent pixels would keep
    // showing the previous frame, so a spinner smears into a solid disc.
    var disposal = transparent ? 2 : 1;

    for (var f = 0; f < frames.length; f++) {
      var indices = indexFrame(frames[f], w, h, match, palette, transIndex, alphaCut, dither);

      bytes.u8(0x21); bytes.u8(0xF9); bytes.u8(0x04);
      bytes.u8((disposal << 2) | (transparent ? 0x01 : 0x00));
      bytes.u16(delayCs);
      bytes.u8(transparent ? transIndex : 0);
      bytes.u8(0x00);

      bytes.u8(0x2C);                 // image descriptor
      bytes.u16(0); bytes.u16(0);     // left, top
      bytes.u16(w); bytes.u16(h);
      bytes.u8(0x00);                 // no local colour table, not interlaced

      bytes.u8(minCodeSize);
      writeSubBlocks(bytes, lzwEncode(minCodeSize, indices));

      if (onProgress) onProgress(f + 1, frames.length);
    }

    bytes.u8(0x3B);                   // trailer
    return bytes.done();
  }

  var api = {
    encode: encode,
    // Exposed for tests: these are the parts with real algorithms in them.
    _buildPalette: buildPalette,
    _lzwEncode: lzwEncode,
    _histogram: histogram,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TGGif = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
