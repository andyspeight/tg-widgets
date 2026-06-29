/**
 * Travelgenix Loader Widget v1.0.0
 * Self-contained, embeddable animated loading-graphic widget.
 * Zero dependencies — works on any website via a single script tag.
 *
 * Usage:
 *   <div data-tg-widget="loader" data-tg-id="YOUR_WIDGET_ID"></div>
 *   <script src="https://tg-widgets.vercel.app/widget-loader.js"></script>
 *
 * Or inline:
 *   <div data-tg-widget="loader" data-tg-config='{"template":"plane-path"}'></div>
 *
 * The same render engine that powers the live embed below is exposed as
 * window.TGLoader.draw(ctx, t, cfg, w, h) so the editor can rasterise the
 * exact same animation to GIF / WebM / APNG, frame for frame.
 */
(function () {
  'use strict';

  var API_BASE = (typeof window !== 'undefined' && window.__TG_WIDGET_API__) || '/api/widget-config';
  var VERSION = '1.0.1';
  var TAU = Math.PI * 2;

  // ─── i18n ───────────────────────────────────────────────────
  // Fixed UI chrome only: the accessible status label and the localised-default
  // loading caption. The author-set label (cfg.label) is content and overrides
  // the localised default. English is the source + fallback. The template names
  // in TEMPLATES are config identifiers, not chrome, and are not translated.
  var MESSAGES = {
    en: { loading: 'Loading…', loadingShort: 'Loading' },
    fr: { loading: 'Chargement…', loadingShort: 'Chargement' },
    de: { loading: 'Wird geladen…', loadingShort: 'Wird geladen' },
    es: { loading: 'Cargando…', loadingShort: 'Cargando' },
    it: { loading: 'Caricamento…', loadingShort: 'Caricamento' },
    ro: { loading: 'Se încarcă…', loadingShort: 'Se încarcă' }
  };
  // Uses the shared TGi18n core when present; otherwise an identical inline
  // resolver keeps the widget self-contained.
  function makeT(cfg) {
    if (typeof window !== 'undefined' && window.TGi18n && typeof window.TGi18n.make === 'function') return window.TGi18n.make(MESSAGES, cfg);
    var supported = Object.keys(MESSAGES);
    var baseOf = function (r) { return (r ? String(r).toLowerCase().replace(/_/g, '-').split('-')[0] : ''); };
    var cands = [];
    if (cfg) cands.push(cfg.lang, cfg.language, cfg.locale);
    try { cands.push(document.documentElement.getAttribute('lang')); } catch (e) { /* noop */ }
    try { if (navigator.languages) cands = cands.concat(navigator.languages); cands.push(navigator.language); } catch (e) { /* noop */ }
    var lang = 'en';
    for (var i = 0; i < cands.length; i++) { var b = baseOf(cands[i]); if (b && supported.indexOf(b) !== -1) { lang = b; break; } }
    var dict = MESSAGES[lang] || MESSAGES.en;
    var t = function (k, vars) {
      var s = Object.prototype.hasOwnProperty.call(dict, k) ? dict[k] : (MESSAGES.en[k] || k);
      if (vars) s = String(s).replace(/\{(\w+)\}/g, function (m, n) { return (vars[n] != null ? vars[n] : m); });
      return s;
    };
    t.lang = lang; t.dir = 'ltr';
    return t;
  }

  /* ---------------------------------------------------------------------- *
   * Defaults                                                                *
   * ---------------------------------------------------------------------- */
  var DEFAULTS = {
    template: 'plane-path',
    size: 140,            // logical px on the major axis
    speed: 1,             // duration multiplier (higher = faster)
    durationMs: 1800,     // base loop length at speed 1
    colors: {
      primary: '#00B4D8', // brand teal
      secondary: '#1B2B5B', // brand navy
      track: '#E2E8F0'    // neutral track
    },
    background: 'transparent', // 'transparent' or a hex
    opacity: 1,           // overall 0..1
    label: '',            // optional caption under the loader
    labelColor: '#475569',
    labelSize: 14,
    fps: 30,              // export hint (unused by the live embed)
    theme: 'light'
  };

  /* ---------------------------------------------------------------------- *
   * Helpers                                                                 *
   * ---------------------------------------------------------------------- */
  function clamp(n, lo, hi) {
    n = Number(n);
    if (!isFinite(n)) return lo;
    return n < lo ? lo : (n > hi ? hi : n);
  }
  function isHex(s) {
    return typeof s === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s);
  }
  // cubic ease-in-out, wraps cleanly (ease(0)=0, ease(1)=1)
  function ease(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }
  function withAlpha(hex, a) {
    var h = String(hex).replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    if (!isFinite(n)) return 'rgba(0,0,0,' + a + ')';
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }
  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function qbez(p0, p1, p2, t) {
    var u = 1 - t;
    return {
      x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
      y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y
    };
  }
  function qtan(p0, p1, p2, t) {
    var x = 2 * (1 - t) * (p1.x - p0.x) + 2 * t * (p2.x - p1.x);
    var y = 2 * (1 - t) * (p1.y - p0.y) + 2 * t * (p2.y - p1.y);
    return Math.atan2(y, x);
  }
  function drawPin(ctx, x, y, r, color) {
    var cy = y - 1.7 * r;
    ctx.fillStyle = color;
    // tip
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - r * 0.7, cy + r * 0.25);
    ctx.lineTo(x + r * 0.7, cy + r * 0.25);
    ctx.closePath();
    ctx.fill();
    // head
    ctx.beginPath();
    ctx.arc(x, cy, r, 0, TAU);
    ctx.fill();
    // punch a transparent hole
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(x, cy, r * 0.38, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  /* ---------------------------------------------------------------------- *
   * Template registry                                                       *
   * Each template: { name, aspect (w:h), render(ctx, t, cfg, w, h) }         *
   * t is in [0,1) for one loop. Draw within [0..w] x [0..h] (logical px).    *
   * ---------------------------------------------------------------------- */
  var TEMPLATES = {

    'bar-sweep': {
      name: 'Progress bar (sweep)', aspect: 5,
      render: function (ctx, t, c, w, h) {
        var r = h / 2;
        ctx.fillStyle = c.colors.track;
        roundRect(ctx, 0, 0, w, h, r); ctx.fill();
        roundRect(ctx, 0, 0, w, h, r); ctx.save(); ctx.clip();
        var segW = w * 0.4;
        var x = -segW + (w + segW) * ease(t);
        var g = ctx.createLinearGradient(x, 0, x + segW, 0);
        g.addColorStop(0, c.colors.primary);
        g.addColorStop(1, c.colors.secondary);
        ctx.fillStyle = g;
        roundRect(ctx, x, 0, segW, h, r); ctx.fill();
        ctx.restore();
      }
    },

    'bar-progress': {
      name: 'Progress bar (fill)', aspect: 5,
      render: function (ctx, t, c, w, h) {
        var r = h / 2;
        ctx.fillStyle = c.colors.track;
        roundRect(ctx, 0, 0, w, h, r); ctx.fill();
        var fw = Math.max(h, w * ease(t));
        ctx.fillStyle = c.colors.primary;
        roundRect(ctx, 0, 0, fw, h, r); ctx.fill();
      }
    },

    'spinner': {
      name: 'Spinner', aspect: 1,
      render: function (ctx, t, c, w, h) {
        var cx = w / 2, cy = h / 2;
        var lw = Math.max(3, Math.min(w, h) * 0.1);
        var rad = Math.min(w, h) / 2 - lw;
        ctx.lineWidth = lw; ctx.lineCap = 'round';
        ctx.strokeStyle = c.colors.track;
        ctx.beginPath(); ctx.arc(cx, cy, rad, 0, TAU); ctx.stroke();
        var start = t * TAU;
        ctx.strokeStyle = c.colors.primary;
        ctx.beginPath(); ctx.arc(cx, cy, rad, start, start + TAU * 0.75); ctx.stroke();
      }
    },

    'dual-ring': {
      name: 'Dual ring', aspect: 1,
      render: function (ctx, t, c, w, h) {
        var cx = w / 2, cy = h / 2;
        var lw = Math.max(3, Math.min(w, h) * 0.08);
        var r1 = Math.min(w, h) / 2 - lw;
        var r2 = r1 - lw * 2.2;
        ctx.lineCap = 'round'; ctx.lineWidth = lw;
        var s = t * TAU;
        ctx.strokeStyle = c.colors.primary;
        ctx.beginPath(); ctx.arc(cx, cy, r1, s, s + TAU * 0.7); ctx.stroke();
        var s2 = -t * TAU;
        ctx.strokeStyle = c.colors.secondary;
        ctx.beginPath(); ctx.arc(cx, cy, Math.max(2, r2), s2, s2 + TAU * 0.7); ctx.stroke();
      }
    },

    'dots-bounce': {
      name: 'Bouncing dots', aspect: 2.6,
      render: function (ctx, t, c, w, h) {
        var n = 3, gap = w / (n + 1);
        var r = Math.min(gap * 0.32, h * 0.2);
        var baseY = h / 2;
        for (var i = 0; i < n; i++) {
          var tt = (((t - i * 0.15) % 1) + 1) % 1;
          var bounce = Math.sin(tt * Math.PI); // 0..1..0
          var y = baseY - bounce * h * 0.22;
          var sc = 0.7 + 0.3 * bounce;
          ctx.fillStyle = (i === 1) ? c.colors.secondary : c.colors.primary;
          ctx.globalAlpha = 0.5 + 0.5 * bounce;
          ctx.beginPath(); ctx.arc(gap * (i + 1), y, r * sc, 0, TAU); ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
    },

    'plane-path': {
      name: 'Plane flight path', aspect: 1.6,
      render: function (ctx, t, c, w, h) {
        var pad = Math.min(w, h) * 0.16;
        var p0 = { x: pad, y: h - pad };
        var p2 = { x: w - pad, y: pad };
        var p1 = { x: w * 0.5, y: pad * 0.4 };
        var SEG = 60, i, pt;
        // full route, faint dashed
        ctx.save();
        ctx.setLineDash([6, 7]); ctx.lineCap = 'round';
        ctx.lineWidth = Math.max(2, h * 0.02);
        ctx.strokeStyle = c.colors.track;
        ctx.beginPath(); ctx.moveTo(p0.x, p0.y);
        for (i = 1; i <= SEG; i++) { pt = qbez(p0, p1, p2, i / SEG); ctx.lineTo(pt.x, pt.y); }
        ctx.stroke();
        ctx.restore();
        // travelled portion, solid dashed primary
        var e = ease(t);
        ctx.save();
        ctx.setLineDash([6, 7]); ctx.lineCap = 'round';
        ctx.lineWidth = Math.max(2.5, h * 0.025);
        ctx.strokeStyle = c.colors.primary;
        ctx.beginPath(); ctx.moveTo(p0.x, p0.y);
        var steps = Math.max(1, Math.round(SEG * e));
        for (i = 1; i <= steps; i++) { pt = qbez(p0, p1, p2, i / SEG); ctx.lineTo(pt.x, pt.y); }
        var pe = qbez(p0, p1, p2, e);
        ctx.lineTo(pe.x, pe.y); ctx.stroke();
        ctx.restore();
        // start dot
        ctx.fillStyle = c.colors.track;
        ctx.beginPath(); ctx.arc(p0.x, p0.y, h * 0.03, 0, TAU); ctx.fill();
        // plane glyph at the head, rotated to the tangent
        var ang = qtan(p0, p1, p2, e);
        ctx.save();
        ctx.translate(pe.x, pe.y); ctx.rotate(ang);
        var s = h * 0.14;
        ctx.fillStyle = c.colors.secondary;
        ctx.beginPath();
        ctx.moveTo(s, 0);
        ctx.lineTo(-s * 0.7, s * 0.55);
        ctx.lineTo(-s * 0.32, 0);
        ctx.lineTo(-s * 0.7, -s * 0.55);
        ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    },

    'globe-spin': {
      name: 'Spinning globe', aspect: 1,
      render: function (ctx, t, c, w, h) {
        var cx = w / 2, cy = h / 2;
        var R = Math.min(w, h) / 2 - Math.max(2, h * 0.04);
        ctx.save();
        ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.clip();
        ctx.fillStyle = withAlpha(c.colors.primary, 0.08);
        ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);
        ctx.lineWidth = Math.max(1, h * 0.012);
        ctx.strokeStyle = withAlpha(c.colors.primary, 0.35);
        // latitudes
        for (var i = 1; i < 5; i++) {
          var y = cy - R + (2 * R) * i / 5;
          ctx.beginPath(); ctx.moveTo(cx - R, y); ctx.lineTo(cx + R, y); ctx.stroke();
        }
        // meridians sweeping to fake rotation
        var M = 5;
        for (var m = 0; m < M; m++) {
          var phase = (t + m / M) * TAU;
          var rx = Math.abs(Math.cos(phase)) * R;
          ctx.globalAlpha = 0.25 + 0.5 * Math.abs(Math.cos(phase));
          ctx.beginPath(); ctx.ellipse(cx, cy, Math.max(0.5, rx), R, 0, 0, TAU); ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.restore();
        ctx.strokeStyle = c.colors.primary;
        ctx.lineWidth = Math.max(2, h * 0.02);
        ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.stroke();
      }
    },

    'luggage': {
      name: 'Hopping suitcase', aspect: 0.85,
      render: function (ctx, t, c, w, h) {
        var lift = h * 0.12;
        var hop = Math.abs(Math.sin(t * TAU)); // smooth at wrap
        var dy = -lift * hop;
        var bw = w * 0.5, bh = h * 0.46;
        var bx = (w - bw) / 2;
        var by = (h - bh) / 2 + h * 0.08 + dy;
        // shadow
        ctx.fillStyle = withAlpha(c.colors.secondary, 0.18);
        var shScale = 1 - hop * 0.4;
        ctx.beginPath();
        ctx.ellipse(w / 2, h - h * 0.12, bw * 0.45 * shScale, h * 0.035, 0, 0, TAU);
        ctx.fill();
        // handle
        ctx.strokeStyle = c.colors.secondary;
        ctx.lineWidth = Math.max(3, h * 0.03); ctx.lineCap = 'round';
        ctx.beginPath(); ctx.arc(w / 2, by, bw * 0.22, Math.PI, 0); ctx.stroke();
        // body
        ctx.fillStyle = c.colors.primary;
        roundRect(ctx, bx, by, bw, bh, h * 0.05); ctx.fill();
        // bands
        ctx.fillStyle = withAlpha(c.colors.secondary, 0.85);
        ctx.fillRect(bx + bw * 0.18, by, bw * 0.1, bh);
        ctx.fillRect(bx + bw * 0.72, by, bw * 0.1, bh);
      }
    },

    'route-pins': {
      name: 'Route between pins', aspect: 1.9,
      render: function (ctx, t, c, w, h) {
        var pad = Math.min(w, h) * 0.2;
        var A = { x: pad, y: h * 0.62 };
        var B = { x: w - pad, y: h * 0.4 };
        var e = ease(t);
        ctx.save();
        ctx.setLineDash([5, 6]); ctx.lineCap = 'round';
        ctx.lineWidth = Math.max(2, h * 0.022);
        ctx.strokeStyle = c.colors.track;
        ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
        ctx.strokeStyle = c.colors.primary;
        ctx.beginPath(); ctx.moveTo(A.x, A.y);
        ctx.lineTo(A.x + (B.x - A.x) * e, A.y + (B.y - A.y) * e); ctx.stroke();
        ctx.restore();
        drawPin(ctx, A.x, A.y, h * 0.13, c.colors.primary);
        drawPin(ctx, B.x, B.y, h * 0.13, c.colors.secondary);
      }
    },

    'balloon': {
      name: 'Hot air balloon', aspect: 0.7,
      render: function (ctx, t, c, w, h) {
        var sway = Math.sin(t * TAU) * w * 0.04;
        var bob = Math.sin(t * TAU) * h * 0.04;
        var ecx = w / 2 + sway;
        var R = Math.min(w * 0.5, h * 0.34);
        var ecy = h * 0.12 + bob + R;
        // envelope
        ctx.fillStyle = c.colors.primary;
        ctx.beginPath();
        ctx.moveTo(ecx - R, ecy);
        ctx.bezierCurveTo(ecx - R, ecy - R * 1.4, ecx + R, ecy - R * 1.4, ecx + R, ecy);
        ctx.bezierCurveTo(ecx + R * 0.6, ecy + R * 0.9, ecx + R * 0.2, ecy + R * 1.05, ecx, ecy + R * 1.15);
        ctx.bezierCurveTo(ecx - R * 0.2, ecy + R * 1.05, ecx - R * 0.6, ecy + R * 0.9, ecx - R, ecy);
        ctx.closePath(); ctx.fill();
        // centre gore stripe
        ctx.fillStyle = withAlpha(c.colors.secondary, 0.85);
        ctx.beginPath();
        ctx.moveTo(ecx - R * 0.18, ecy - R * 0.9);
        ctx.bezierCurveTo(ecx - R * 0.18, ecy + R * 0.4, ecx - R * 0.18, ecy + R * 0.9, ecx, ecy + R * 1.15);
        ctx.bezierCurveTo(ecx + R * 0.18, ecy + R * 0.9, ecx + R * 0.18, ecy + R * 0.4, ecx + R * 0.18, ecy - R * 0.9);
        ctx.bezierCurveTo(ecx + R * 0.1, ecy - R * 1.05, ecx - R * 0.1, ecy - R * 1.05, ecx - R * 0.18, ecy - R * 0.9);
        ctx.closePath(); ctx.fill();
        // ropes + basket
        var basketY = ecy + R * 1.15 + h * 0.12;
        var bw = R * 0.5;
        ctx.strokeStyle = withAlpha(c.colors.secondary, 0.7);
        ctx.lineWidth = Math.max(1, h * 0.008);
        ctx.beginPath();
        ctx.moveTo(ecx - R * 0.5, ecy + R * 0.9); ctx.lineTo(ecx - bw * 0.4, basketY);
        ctx.moveTo(ecx + R * 0.5, ecy + R * 0.9); ctx.lineTo(ecx + bw * 0.4, basketY);
        ctx.stroke();
        ctx.fillStyle = c.colors.secondary;
        roundRect(ctx, ecx - bw * 0.45, basketY, bw * 0.9, h * 0.08, h * 0.012); ctx.fill();
      }
    }

  };

  /* ---------------------------------------------------------------------- *
   * Sanitise + core draw (shared by the embed AND the editor's exporter)    *
   * ---------------------------------------------------------------------- */
  function sanitize(input) {
    var c = {};
    var src = input || {};
    for (var k in DEFAULTS) { if (DEFAULTS.hasOwnProperty(k)) c[k] = src[k] != null ? src[k] : DEFAULTS[k]; }
    c.colors = {
      primary: (src.colors && src.colors.primary) || DEFAULTS.colors.primary,
      secondary: (src.colors && src.colors.secondary) || DEFAULTS.colors.secondary,
      track: (src.colors && src.colors.track) || DEFAULTS.colors.track
    };
    if (!TEMPLATES[c.template]) c.template = DEFAULTS.template;
    c.size = clamp(c.size, 24, 600);
    c.speed = clamp(c.speed, 0.1, 5);
    c.durationMs = clamp(c.durationMs, 200, 10000);
    c.fps = clamp(c.fps, 5, 60);
    c.opacity = clamp(c.opacity, 0, 1);
    c.labelSize = clamp(c.labelSize, 8, 48);
    ['primary', 'secondary', 'track'].forEach(function (key) {
      if (!isHex(c.colors[key])) c.colors[key] = DEFAULTS.colors[key];
    });
    if (c.background !== 'transparent' && !isHex(c.background)) c.background = 'transparent';
    if (!isHex(c.labelColor)) c.labelColor = DEFAULTS.labelColor;
    c.label = String(c.label == null ? '' : c.label).slice(0, 80);
    c.theme = c.theme === 'dark' ? 'dark' : 'light';
    return c;
  }

  function dimsFor(aspect, size) {
    if (aspect >= 1) return { w: Math.round(size), h: Math.round(size / aspect) };
    return { w: Math.round(size * aspect), h: Math.round(size) };
  }

  // Pure: renders one frame at parameter t into ctx, sized w x h (logical px).
  function draw(ctx, t, cfg, w, h) {
    var c = (cfg && cfg.__clean) ? cfg : sanitize(cfg);
    ctx.clearRect(0, 0, w, h);
    if (c.background && c.background !== 'transparent' && isHex(c.background)) {
      ctx.fillStyle = c.background;
      ctx.fillRect(0, 0, w, h);
    }
    var tpl = TEMPLATES[c.template] || TEMPLATES.spinner;
    var tt = (((t % 1) + 1) % 1);
    ctx.save();
    tpl.render(ctx, tt, c, w, h);
    ctx.restore();
  }

  /* ---------------------------------------------------------------------- *
   * Embeddable widget                                                       *
   * ---------------------------------------------------------------------- */
  var STYLES =
    ':host{all:initial;display:inline-block;}' +
    '.tgld-root{display:inline-flex;flex-direction:column;align-items:center;gap:10px;' +
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Inter,sans-serif;}" +
    '.tgld-canvas{display:block;}' +
    '.tgld-label{font-weight:500;letter-spacing:.01em;text-align:center;line-height:1.3;}' +
    '.tgld-label[hidden]{display:none !important;}' +
    '.tgld-sr{position:absolute !important;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0;}';

  function TGLoaderWidget(container, config) {
    if (!container) return;
    this.el = container;
    this.cfg = sanitize(config || {});
    this.cfg.__clean = true;
    this.t = makeT(this.cfg);   // resolve viewer language + UI chrome strings
    this.tpl = TEMPLATES[this.cfg.template];
    this._raf = 0;
    this._start = 0;

    this.shadow = container.shadowRoot || container.attachShadow({ mode: 'open' });
    this.shadow.innerHTML =
      '<style>' + STYLES + '</style>' +
      '<div class="tgld-root" part="root" role="status" aria-live="polite">' +
      '<canvas class="tgld-canvas" aria-hidden="true"></canvas>' +
      '<span class="tgld-sr"></span>' +
      '<div class="tgld-label" hidden></div>' +
      '</div>';

    this.root = this.shadow.querySelector('.tgld-root');
    this.canvas = this.shadow.querySelector('.tgld-canvas');
    this.srEl = this.shadow.querySelector('.tgld-sr');
    this.labelEl = this.shadow.querySelector('.tgld-label');
    this.ctx = this.canvas.getContext('2d');

    var self = this;
    this._mql = (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)')) || null;
    this._reduce = !!(this._mql && this._mql.matches);
    this._onMql = function () { self._reduce = !!self._mql.matches; self._run(); };
    if (this._mql && this._mql.addEventListener) this._mql.addEventListener('change', this._onMql);
    else if (this._mql && this._mql.addListener) this._mql.addListener(this._onMql);

    this._frame = this._frame.bind(this);
    this._apply();
    this._run();
  }

  TGLoaderWidget.prototype._apply = function () {
    var c = this.cfg;
    this.root.style.opacity = String(c.opacity);
    // Accessible status text — always present so screen readers announce a
    // loading state even when no visible caption is set. Uses the author's
    // caption when given, otherwise the localised default.
    var srText = c.label || this.t('loadingShort');
    if (this.srEl) this.srEl.textContent = srText; // textContent — XSS-safe
    this.root.setAttribute('aria-label', srText);
    if (c.label) {
      this.labelEl.textContent = c.label; // textContent — XSS-safe
      this.labelEl.hidden = false;
    } else {
      this.labelEl.textContent = '';
      this.labelEl.hidden = true;
    }
    this.labelEl.style.color = c.labelColor;
    this.labelEl.style.fontSize = c.labelSize + 'px';
    this._layout();
  };

  TGLoaderWidget.prototype._layout = function () {
    var d = dimsFor(this.tpl.aspect, this.cfg.size);
    this.dispW = d.w; this.dispH = d.h;
    var dpr = Math.min((window.devicePixelRatio || 1), 3);
    this.canvas.style.width = d.w + 'px';
    this.canvas.style.height = d.h + 'px';
    this.canvas.width = Math.round(d.w * dpr);
    this.canvas.height = Math.round(d.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  TGLoaderWidget.prototype._frame = function (now) {
    if (!this._start) this._start = now;
    var dur = this.cfg.durationMs / this.cfg.speed;
    var t = ((now - this._start) % dur) / dur;
    draw(this.ctx, t, this.cfg, this.dispW, this.dispH);
    this._raf = requestAnimationFrame(this._frame);
  };

  TGLoaderWidget.prototype._run = function () {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0; this._start = 0;
    if (this._reduce) {
      draw(this.ctx, 0.25, this.cfg, this.dispW, this.dispH); // representative static frame
    } else {
      this._raf = requestAnimationFrame(this._frame);
    }
  };

  TGLoaderWidget.prototype.update = function (newConfig) {
    var merged = {};
    for (var k in this.cfg) { if (this.cfg.hasOwnProperty(k) && k !== '__clean') merged[k] = this.cfg[k]; }
    if (newConfig) {
      for (var j in newConfig) {
        if (!newConfig.hasOwnProperty(j)) continue;
        if (j === 'colors') merged.colors = Object.assign({}, merged.colors, newConfig.colors);
        else merged[j] = newConfig[j];
      }
    }
    this.cfg = sanitize(merged); this.cfg.__clean = true;
    this.t = makeT(this.cfg);
    this.tpl = TEMPLATES[this.cfg.template];
    this._apply();
    this._run();
  };

  TGLoaderWidget.prototype.destroy = function () {
    if (this._raf) cancelAnimationFrame(this._raf);
    if (this._mql && this._mql.removeEventListener) this._mql.removeEventListener('change', this._onMql);
    else if (this._mql && this._mql.removeListener) this._mql.removeListener(this._onMql);
    try { this.shadow.innerHTML = ''; } catch (e) {}
  };

  /* ---------------------------------------------------------------------- *
   * Auto-init                                                               *
   * ---------------------------------------------------------------------- */
  function hydrate(el) {
    if (el.__tgld) return;
    var inline = el.getAttribute('data-tg-config');
    var id = el.getAttribute('data-tg-id');
    if (inline) {
      var cfg = {};
      try { cfg = JSON.parse(inline); } catch (e) { cfg = {}; }
      el.__tgld = new TGLoaderWidget(el, cfg);
      return;
    }
    if (id) {
      fetch(API_BASE + '?id=' + encodeURIComponent(id))
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) { el.__tgld = new TGLoaderWidget(el, (d && d.config) || {}); })
        .catch(function () { el.__tgld = new TGLoaderWidget(el, {}); });
      return;
    }
    el.__tgld = new TGLoaderWidget(el, {});
  }

  function init() {
    var nodes = document.querySelectorAll('[data-tg-widget="loader"]');
    for (var i = 0; i < nodes.length; i++) hydrate(nodes[i]);
  }

  // Expose
  window.TGLoaderWidget = TGLoaderWidget;
  window.TGLoader = {
    VERSION: VERSION,
    TEMPLATES: TEMPLATES,
    DEFAULTS: DEFAULTS,
    sanitize: sanitize,
    dimsFor: dimsFor,
    draw: draw
  };
  window.__TG_LOADER_VERSION__ = VERSION;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
