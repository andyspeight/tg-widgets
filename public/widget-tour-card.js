/* ============================================================================
 * widget-tour-card.js  ·  Travelgenix Widget Suite
 * Escorted Tour — compact summary card (v0.1.0)
 *
 * A grid-friendly card view of an Escorted Tour: hero, title, a one-line
 * summary, dates or duration, location and a "from" price. Built to sit
 * two-up (or more) in a grid, each card linking through to the tour's full
 * page (widget-tour.js). Reads the SAME saved Escorted Tour config as the
 * full page — tour.* + design.* — so one record drives both.
 *
 * The host is an inline-block by default, so two adjacent embeds flow side by
 * side on a normal page and stack on a phone with no CSS on the host page.
 *
 * Embed:
 *   <div data-tg-widget="tour-card" data-tg-id="YOUR_WIDGET_ID"></div>
 *   <script src="https://widgets.travelify.io/widget-tour-card.js" defer></script>
 * or inline (demo / preview):
 *   <div data-tg-widget="tour-card" data-tg-config='{"tour":{...},"design":{...}}'></div>
 *
 * Nothing here talks to Stripe. Live "places left" comes from the counts-only
 * /api/trip-availability endpoint (the same one the trips card uses; it reads
 * tour.capacity), and only for a real saved embed.
 * ========================================================================== */
(function () {
  'use strict';

  const VERSION = '0.1.0';

  function resolveApiBase() {
    if (typeof window === 'undefined') return '/api/widget-config';
    if (window.__TG_WIDGET_API__) return window.__TG_WIDGET_API__;
    try {
      const me = document.currentScript;
      if (me && me.src) return new URL(me.src).origin + '/api/widget-config';
      const scripts = document.getElementsByTagName('script');
      for (let i = scripts.length - 1; i >= 0; i--) {
        const s = scripts[i].src || '';
        if (/\/widget-tour-card\.js(\?|$|#)/.test(s)) return new URL(s).origin + '/api/widget-config';
      }
    } catch (e) { /* fall through */ }
    return '/api/widget-config';
  }
  const API_BASE = resolveApiBase();
  const AVAIL_URL = API_BASE.replace(/\/widget-config(\/)?$/, '/trip-availability');
  // The full-tour script, on the SAME origin as this one. The card opens the
  // full tour in an overlay and loads this on demand (once, shared across every
  // card on the page) so the site owner only ever embeds the card.
  const TOUR_SCRIPT = API_BASE.replace(/\/api\/widget-config(\/)?$/, '') + '/widget-tour.js';
  let tourScriptPromise = null;
  function loadTourScript() {
    if (typeof window !== 'undefined' && window.TGTourWidget) return Promise.resolve();
    if (tourScriptPromise) return tourScriptPromise;
    tourScriptPromise = new Promise(function (resolve, reject) {
      const done = () => (window.TGTourWidget ? resolve() : reject(new Error('tour script loaded but no widget')));
      const existing = Array.prototype.find.call(document.scripts || [], (s) => /\/widget-tour\.js(\?|$|#)/.test(s.src || ''));
      if (existing) {
        if (window.TGTourWidget) return resolve();
        existing.addEventListener('load', done);
        existing.addEventListener('error', reject);
        return;
      }
      const s = document.createElement('script');
      s.src = TOUR_SCRIPT; s.defer = true;
      s.addEventListener('load', done);
      s.addEventListener('error', reject);
      document.head.appendChild(s);
    });
    return tourScriptPromise;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function safeUrl(u) {
    if (!u) return '';
    const s = String(u).trim();
    if (/^(https?:)?\/\//i.test(s) || s.startsWith('/') || s.startsWith('#')) return s;
    return '';
  }
  function safeHex(v, fb) {
    return (typeof v === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(v.trim())) ? v.trim() : fb;
  }

  const FONTS = {
    'DM Sans':           { w: '400;500;600;700', g: 'system-ui, sans-serif' },
    'Inter':             { w: '400;500;600;700', g: 'system-ui, sans-serif' },
    'Poppins':           { w: '400;500;600;700', g: 'system-ui, sans-serif' },
    'Montserrat':        { w: '400;500;600;700', g: 'system-ui, sans-serif' },
    'Plus Jakarta Sans': { w: '400;500;600;700', g: 'system-ui, sans-serif' },
    'Manrope':           { w: '400;500;600;700', g: 'system-ui, sans-serif' },
    'Sora':              { w: '400;500;600;700', g: 'system-ui, sans-serif' },
    'Outfit':            { w: '400;500;600;700', g: 'system-ui, sans-serif' },
    'Work Sans':         { w: '400;500;600;700', g: 'system-ui, sans-serif' },
    'Cormorant Garamond':{ w: '400;500;600;700', g: 'Georgia, serif' },
    'EB Garamond':       { w: '400;500;600;700', g: 'Georgia, serif' },
  };
  function safeFontName(v, fb) { return (typeof v === 'string' && FONTS[v.trim()]) ? v.trim() : fb; }
  function fontStack(name) { const f = FONTS[name]; return "'" + name + "', " + (f ? f.g : 'system-ui, sans-serif'); }
  function ensureFont(name) {
    if (!name || !FONTS[name] || typeof document === 'undefined') return;
    const id = 'tg-font-' + name.toLowerCase().replace(/\s+/g, '-');
    if (document.getElementById(id)) return;
    const l = document.createElement('link');
    l.id = id; l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=' +
      encodeURIComponent(name).replace(/%20/g, '+') + ':wght@' + FONTS[name].w + '&display=swap';
    document.head.appendChild(l);
  }

  const CURRENCIES = { gbp: '£', eur: '€', usd: '$' };
  function currencySymbol(code) { return CURRENCIES[String(code || 'gbp').toLowerCase()] || '£'; }
  function money(sym, pence) {
    const n = Number(pence);
    // 0 = "not priced yet" (blank in the source), not "free" — hide it so the
    // card shows no "from £0 pp" until a real figure exists.
    if (!isFinite(n) || n <= 0) return '';
    const major = n / 100;
    const whole = Math.round(major) === major;
    return sym + major.toLocaleString('en-GB', {
      minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2,
    });
  }

  function parseDay(s) {
    const m = String(s || '').trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!m) return null;
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    return isNaN(d.getTime()) ? null : d;
  }
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmtDay(d) { return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear(); }
  function fmtRange(a, b) {
    if (!a && !b) return '';
    if (!b) return fmtDay(a);
    if (!a) return fmtDay(b);
    if (a.getFullYear() === b.getFullYear()) {
      if (a.getMonth() === b.getMonth()) return a.getDate() + '–' + b.getDate() + ' ' + MONTHS[a.getMonth()] + ' ' + a.getFullYear();
      return a.getDate() + ' ' + MONTHS[a.getMonth()] + ' – ' + b.getDate() + ' ' + MONTHS[b.getMonth()] + ' ' + a.getFullYear();
    }
    return fmtDay(a) + ' – ' + fmtDay(b);
  }

  const IC = {
    pin: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
    cal: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
    clock: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>',
  };

  // ── Scoped styles (Shadow DOM, --tgtc-* tokens) ───────────────────────────
  const STYLES = `
    :host { all: initial; display: inline-block; vertical-align: top; width: 420px; max-width: 100%; margin: 0 16px 20px 0; }
    * { box-sizing: border-box; }
    .tgtc-root {
      --tgtc-brand: #1B2B5B; --tgtc-accent: #C2410C;
      --tgtc-bg: #FFFFFF; --tgtc-alt: #F8FAFC; --tgtc-text: #0F172A;
      --tgtc-sub: #475569; --tgtc-muted: #94A3B8; --tgtc-border: #E2E8F0;
      --tgtc-radius: 16px; --tgtc-shadow: 0 1px 2px rgba(15,23,42,0.05);
      --tgtc-font: 'DM Sans', system-ui, sans-serif;
      font-family: var(--tgtc-font); color: var(--tgtc-text); line-height: 1.5;
    }
    .tgtc-root[data-theme="dark"] {
      --tgtc-bg: #1E293B; --tgtc-alt: #0F172A; --tgtc-text: #F1F5F9;
      --tgtc-sub: #94A3B8; --tgtc-muted: #64748B; --tgtc-border: #334155;
      --tgtc-shadow: 0 1px 2px rgba(0,0,0,0.3);
    }

    .tgtc-card {
      display: block; background: var(--tgtc-bg); color: inherit; text-decoration: none;
      border: 1px solid var(--tgtc-border); border-radius: var(--tgtc-radius);
      overflow: hidden; box-shadow: var(--tgtc-shadow);
    }
    a.tgtc-card, button.tgtc-card { cursor: pointer; transition: box-shadow .16s ease, transform .16s ease; }
    button.tgtc-card { width: 100%; text-align: left; font: inherit; -webkit-appearance: none; appearance: none; }
    a.tgtc-card:hover, button.tgtc-card:hover { box-shadow: 0 8px 24px rgba(15,23,42,0.13); transform: translateY(-2px); }
    a.tgtc-card:focus-visible, button.tgtc-card:focus-visible { outline: 3px solid var(--tgtc-accent); outline-offset: 2px; }

    .tgtc-hero { position: relative; aspect-ratio: 16 / 10; background: var(--tgtc-alt); }
    .tgtc-hero img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .tgtc-hero-ph {
      position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
      background: linear-gradient(135deg, var(--tgtc-brand), var(--tgtc-accent));
      color: rgba(255,255,255,0.94); font-size: 15px; font-weight: 700;
      text-align: center; padding: 16px;
    }

    .tgtc-body { padding: 16px 18px 18px; }
    .tgtc-meta {
      display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: center;
      font-size: 12.5px; color: var(--tgtc-sub); margin: 0 0 7px;
    }
    .tgtc-meta span { display: inline-flex; align-items: center; gap: 5px; }
    .tgtc-meta svg { color: var(--tgtc-accent); flex-shrink: 0; }
    .tgtc-title {
      margin: 0 0 6px; font-size: clamp(18px, 3.2vw, 21px); font-weight: 700;
      line-height: 1.22; letter-spacing: -0.3px; color: var(--tgtc-text);
    }
    .tgtc-sum {
      margin: 0; font-size: 14px; color: var(--tgtc-sub);
      display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden;
    }

    .tgtc-foot {
      display: flex; align-items: baseline; gap: 4px 10px; flex-wrap: wrap;
      margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--tgtc-border);
    }
    .tgtc-from { font-size: 12.5px; color: var(--tgtc-sub); }
    .tgtc-price { font-size: 21px; font-weight: 800; line-height: 1; color: var(--tgtc-text); }
    .tgtc-pp { font-size: 12.5px; font-weight: 500; color: var(--tgtc-sub); }
    .tgtc-cta {
      margin-left: auto; display: inline-flex; align-items: center; gap: 5px;
      font-size: 13px; font-weight: 700; color: var(--tgtc-accent);
    }

    .tgtc-avail { margin-top: 9px; font-size: 12.5px; font-weight: 600; color: var(--tgtc-sub); }
    .tgtc-avail.is-low { color: var(--tgtc-accent); }
    .tgtc-avail.is-sold { display: inline-block; color: #fff; background: var(--tgtc-muted); padding: 3px 10px; border-radius: 999px; font-size: 12px; }

    .tgtc-closed {
      margin-top: 12px; padding: 10px 12px; border-radius: 10px;
      background: var(--tgtc-alt); border: 1px solid var(--tgtc-border);
      font-size: 13px; color: var(--tgtc-sub);
    }

    @media (prefers-reduced-motion: reduce) {
      a.tgtc-card, button.tgtc-card { transition: none; }
      a.tgtc-card:hover, button.tgtc-card:hover { transform: none; }
    }
  `;

  // ── Overlay styles (its own shadow host on <body>) ────────────────────────
  // The full tour renders inside .ov-mount (its own isolated Shadow DOM), so
  // these only style the dialog chrome around it.
  const OVERLAY_STYLES = `
    .ov { position: fixed; inset: 0; z-index: 2147483000; }
    .ov[hidden] { display: none; }
    .ov-backdrop { position: absolute; inset: 0; background: rgba(15,23,42,0.55); }
    .ov-panel {
      position: relative; width: min(940px, 94vw); max-height: 92vh; margin: 4vh auto;
      overflow-y: auto; -webkit-overflow-scrolling: touch; background: #fff;
      border-radius: 16px; box-shadow: 0 24px 70px rgba(0,0,0,0.40);
    }
    .ov-close {
      position: sticky; top: 12px; float: right; margin: 12px 12px -52px 0; z-index: 5;
      width: 40px; height: 40px; display: inline-flex; align-items: center; justify-content: center;
      border: 0; border-radius: 999px; background: rgba(255,255,255,0.92); color: #0F172A;
      box-shadow: 0 2px 10px rgba(0,0,0,0.2); cursor: pointer;
    }
    .ov-close:hover { background: #fff; }
    .ov-close:focus-visible { outline: 3px solid #C2410C; outline-offset: 2px; }
    .ov-mount { display: block; }
    @media (max-width: 640px) { .ov-panel { width: 100vw; max-height: 100vh; margin: 0; border-radius: 0; } }
    @media (prefers-reduced-motion: no-preference) {
      .ov-panel { animation: tgtc-ov-in .18s ease both; }
      @keyframes tgtc-ov-in { from { transform: translateY(14px); opacity: .5 } to { transform: none; opacity: 1 } }
    }
  `;

  // ── Widget class ──────────────────────────────────────────────────────────
  class TGTourCardWidget {
    constructor(container, config) {
      this.el = container;
      container._tgInitialised = true;
      container._tgWidget = this;
      this.cfg = this._defaults(config);
      this.widgetId = this.cfg._widgetId || container.getAttribute('data-tg-id') || '';
      // Keep the WHOLE config (days, sections, gallery…) so the click-to-open
      // overlay can render the full tour from the same record. The card face
      // only uses the summary fields; the rest rides along for the overlay.
      this._raw = (config && typeof config === 'object') ? config : {};
      if (this.widgetId && !this._raw._widgetId) this._raw._widgetId = this.widgetId;
      this.shadow = container.attachShadow({ mode: 'open' });
      this._render();
    }

    _defaults(c) {
      c = c || {};
      const tour = (c.tour && typeof c.tour === 'object') ? c.tour : {};
      const design = (c.design && typeof c.design === 'object') ? c.design : {};
      return {
        tour: {
          title: typeof tour.title === 'string' ? tour.title : '',
          subtitle: typeof tour.subtitle === 'string' ? tour.subtitle : '',
          heroImage: safeUrl(tour.heroImage),
          location: typeof tour.location === 'string' ? tour.location : '',
          startDate: typeof tour.startDate === 'string' ? tour.startDate : '',
          endDate: typeof tour.endDate === 'string' ? tour.endDate : '',
          durationText: typeof tour.durationText === 'string' ? tour.durationText : '',
          currency: typeof tour.currency === 'string' ? tour.currency : 'gbp',
          capacity: Math.max(0, Math.min(500, parseInt(tour.capacity, 10) || 0)),
          pricePerPersonPence: Math.max(0, parseInt(tour.pricePerPersonPence, 10) || 0),
          pageUrl: safeUrl(tour.pageUrl),
        },
        design: {
          brandColor: safeHex(design.brandColor, ''),
          accentColor: safeHex(design.accentColor, ''),
          theme: design.theme === 'dark' ? 'dark' : 'light',
          radius: typeof design.radius === 'number' ? Math.max(0, Math.min(32, design.radius)) : 16,
          fontFamily: safeFontName(design.fontFamily, 'DM Sans'),
        },
        _widgetId: typeof c._widgetId === 'string' ? c._widgetId : '',
      };
    }

    _render() {
      const t = this.cfg.tour;
      const d = this.cfg.design;

      // Unconfigured: render nothing, quietly.
      if (!t.title) {
        this.shadow.innerHTML = '';
        this.el.setAttribute('data-tg-hidden', 'unconfigured');
        return;
      }
      this.el.removeAttribute('data-tg-hidden');

      ensureFont(d.fontFamily);

      const start = parseDay(t.startDate);
      const end = parseDay(t.endDate);
      const dates = fmtRange(start, end);
      const sym = currencySymbol(t.currency);
      const price = money(sym, t.pricePerPersonPence);

      const today = new Date(); today.setHours(0, 0, 0, 0);
      const departed = !!((end || start) && (end || start).getTime() < today.getTime());

      // Date/duration chip: real dates when we have them, otherwise the
      // free-text duration (e.g. "11 days / 10 nights"). Location alongside.
      const dateChip = dates
        ? '<span data-role="dates">' + IC.cal + esc(dates) + '</span>'
        : (t.durationText ? '<span data-role="duration">' + IC.clock + esc(t.durationText) + '</span>' : '');
      const meta = [
        dateChip,
        t.location ? '<span data-role="location">' + IC.pin + esc(t.location) + '</span>' : '',
      ].join('');

      const heroImg = t.heroImage
        ? '<img src="' + esc(t.heroImage) + '" alt="" loading="lazy">'
        : '<div class="tgtc-hero-ph">' + esc(t.location || t.title) + '</div>';

      let foot = '';
      if (departed) {
        foot = '<div class="tgtc-closed" data-role="departed">This tour has departed. Ask us about the next date.</div>';
      } else {
        const priceBlock = price
          ? '<span class="tgtc-from">from</span>'
            + '<span class="tgtc-price" data-role="price">' + esc(price) + '</span>'
            + '<span class="tgtc-pp">pp</span>'
          : '';
        const cta = '<span class="tgtc-cta">View tour' + IC.arrow + '</span>';
        foot = '<div class="tgtc-foot">' + priceBlock + cta + '</div>';
      }

      this.root = document.createElement('div');
      this.root.className = 'tgtc-root';
      this.root.setAttribute('data-theme', d.theme);
      if (d.brandColor) this.root.style.setProperty('--tgtc-brand', d.brandColor);
      if (d.accentColor) this.root.style.setProperty('--tgtc-accent', d.accentColor);
      this.root.style.setProperty('--tgtc-radius', d.radius + 'px');
      this.root.style.setProperty('--tgtc-font', fontStack(d.fontFamily));

      // Default: a button that opens the full tour in an overlay, so the site
      // owner embeds ONLY the card and nothing else. When a pageUrl is set it
      // becomes an <a> to that page instead — the explicit override. The href
      // is whitelisted (http/https/relative) by safeUrl.
      const overlayMode = !t.pageUrl;
      const tag = t.pageUrl ? 'a' : 'button';
      const attrs = t.pageUrl
        ? ' href="' + esc(t.pageUrl) + '" aria-label="' + esc(t.title) + '"'
        : ' type="button" aria-label="' + esc('View the ' + t.title + ' tour') + '"';

      this.root.innerHTML =
        '<' + tag + ' class="tgtc-card"' + attrs + '>'
        + '<div class="tgtc-hero">' + heroImg + '</div>'
        + '<div class="tgtc-body">'
          + (meta ? '<div class="tgtc-meta">' + meta + '</div>' : '')
          + '<h3 class="tgtc-title" data-role="title">' + esc(t.title) + '</h3>'
          + (t.subtitle ? '<p class="tgtc-sum" data-role="summary">' + esc(t.subtitle) + '</p>' : '')
          + foot
          + (departed ? '' : '<div class="tgtc-avail" data-role="avail" hidden></div>')
        + '</div>'
        + '</' + tag + '>';

      this.shadow.innerHTML = '<style>' + STYLES + '</style>';
      this.shadow.appendChild(this.root);

      // Overlay mode: the card is a button that opens the full tour on click.
      if (overlayMode) {
        const card = this.root.querySelector('.tgtc-card');
        if (card) card.addEventListener('click', () => this._openOverlay());
      }

      this._loadAvailability(departed);
    }

    // ── Click-to-open overlay ──────────────────────────────────────────────
    // A real user action, so moving focus + locking scroll here is allowed
    // (never on render). Loads the full-tour script on demand the first time.
    _openOverlay() {
      const card = this.root && this.root.querySelector('.tgtc-card');
      const go = () => { if (card) card.removeAttribute('aria-busy'); this._buildOverlay(); this._showOverlay(); };
      if (typeof window !== 'undefined' && window.TGTourWidget) return go();
      if (card) card.setAttribute('aria-busy', 'true');
      loadTourScript().then(go).catch(() => { if (card) card.removeAttribute('aria-busy'); });
    }

    _buildOverlay() {
      if (this._ov || typeof window === 'undefined' || !window.TGTourWidget) return;
      const host = document.createElement('div');
      host.setAttribute('data-tg-tour-overlay', '');
      const sh = host.attachShadow({ mode: 'open' });
      sh.innerHTML = '<style>' + OVERLAY_STYLES + '</style>'
        + '<div class="ov" role="dialog" aria-modal="true" aria-label="' + esc(this.cfg.tour.title) + '" hidden>'
        +   '<div class="ov-backdrop" data-close></div>'
        +   '<div class="ov-panel">'
        +     '<button class="ov-close" type="button" data-close aria-label="Close">'
        +       '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
        +     '</button>'
        +     '<div class="ov-mount"></div>'
        +   '</div>'
        + '</div>';
      document.body.appendChild(host);
      const ov = sh.querySelector('.ov');
      // Mount the full tour once, from the whole config (no data-tg-widget on
      // the mount, so the tour script's auto-init never double-claims it).
      try { new window.TGTourWidget(sh.querySelector('.ov-mount'), this._raw); } catch (e) { /* leave empty */ }
      sh.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', () => this._closeOverlay()));
      this._onKey = (e) => { if (e.key === 'Escape') this._closeOverlay(); };
      this._ov = { host, ov, closeBtn: sh.querySelector('.ov-close') };
    }

    _showOverlay() {
      if (!this._ov) return;
      this._prevFocus = document.activeElement;
      this._ov.ov.hidden = false;
      this._prevBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      document.addEventListener('keydown', this._onKey, true);
      try { this._ov.closeBtn.focus(); } catch (e) { /* ignore */ }
    }

    _closeOverlay() {
      if (!this._ov) return;
      this._ov.ov.hidden = true;
      document.body.style.overflow = this._prevBodyOverflow || '';
      document.removeEventListener('keydown', this._onKey, true);
      try { if (this._prevFocus && this._prevFocus.focus) this._prevFocus.focus(); } catch (e) { /* ignore */ }
    }

    _teardownOverlay() {
      if (!this._ov) return;
      try { document.removeEventListener('keydown', this._onKey, true); } catch (e) { /* ignore */ }
      try { document.body.style.overflow = this._prevBodyOverflow || ''; } catch (e) { /* ignore */ }
      try { this._ov.host.remove(); } catch (e) { /* ignore */ }
      this._ov = null;
    }

    _loadAvailability(departed) {
      if (departed || !this.widgetId) return;
      const node = this.root && this.root.querySelector('[data-role="avail"]');
      if (!node) return;
      const token = (this._availToken = (this._availToken || 0) + 1);
      fetch(AVAIL_URL + '?widgetId=' + encodeURIComponent(this.widgetId))
        .then(function (r) { return r.ok ? r.json() : null; })
        .then((dd) => {
          if (token !== this._availToken) return;
          if (!dd || !dd.ok || !dd.available) return;
          if (dd.soldOut) {
            node.textContent = 'Sold out'; node.className = 'tgtc-avail is-sold'; node.hidden = false;
          } else if (typeof dd.remaining === 'number' && dd.remaining > 0) {
            node.textContent = (dd.remaining <= 5 ? 'Only ' : '') + dd.remaining + (dd.remaining === 1 ? ' place left' : ' places left');
            node.className = 'tgtc-avail' + (dd.remaining <= 5 ? ' is-low' : ''); node.hidden = false;
          }
        })
        .catch(function () { /* network hiccup — stay silent */ });
    }

    // Public: apply new config and re-render in place. Side-effect-free for the
    // host page (no focus, no scroll), per the suite render rule.
    update(config) {
      // Keep the full config in step so a rebuilt overlay reflects edits.
      this._raw = Object.assign({}, this._raw, config, {
        tour: Object.assign({}, this._raw.tour, config && config.tour),
        design: Object.assign({}, this._raw.design, config && config.design),
      });
      this._teardownOverlay();
      this.cfg = this._defaults(Object.assign({}, {
        tour: Object.assign({}, this.cfg.tour, config && config.tour),
        design: Object.assign({}, this.cfg.design, config && config.design),
        _widgetId: (config && config._widgetId) || this.cfg._widgetId,
      }));
      this._render();
    }

    destroy() {
      this._teardownOverlay();
      this.shadow.innerHTML = '';
      this.el.removeAttribute('data-tg-hidden');
    }
  }

  // ── Auto-init ───────────────────────────────────────────────────────────────
  async function loadConfigFromApi(widgetId) {
    try {
      const res = await fetch(API_BASE + '?id=' + encodeURIComponent(widgetId));
      if (!res.ok) throw new Error('Config load failed: ' + res.status);
      const data = await res.json();
      if (data && data.config) return Object.assign({}, data.config, { _widgetId: widgetId });
      throw new Error('No config returned');
    } catch (err) {
      console.error('[TGTourCard] Config load error:', err);
      return null;
    }
  }

  async function init() {
    const containers = document.querySelectorAll('[data-tg-widget="tour-card"]');
    for (const el of containers) {
      if (el._tgInitialised || el.shadowRoot) continue;
      el._tgInitialised = true;
      let config = null;
      const inline = el.getAttribute('data-tg-config');
      const widgetId = el.getAttribute('data-tg-id');
      if (inline) {
        try { config = JSON.parse(inline); } catch (e) { console.error('[TGTourCard] Invalid inline config:', e); continue; }
      } else if (widgetId) {
        config = await loadConfigFromApi(widgetId);
        if (!config) continue;
      } else {
        config = {};
      }
      new TGTourCardWidget(el, config);
    }
  }

  if (typeof window !== 'undefined') {
    window.TGTourCardWidget = TGTourCardWidget;
    window.__TG_TOUR_CARD_VERSION__ = VERSION;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }
})();
