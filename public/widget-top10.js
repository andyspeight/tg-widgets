/**
 * Travelgenix Top 10 Destinations Widget v1.0.0
 * Self-contained, embeddable ranked destination list.
 * Zero dependencies. Shadow DOM isolation. Works on any website via a single script tag.
 *
 * Usage:
 *   <div data-tg-widget="top10" data-tg-id="YOUR_WIDGET_ID"></div>
 *   <script src="https://tg-widgets.vercel.app/widget-top10.js" defer></script>
 *
 * Part of the Spotlight family, so it follows the shared compact editorial
 * system locked on 3 Sep 2026: hero type, Best For chips, hairline rails, and
 * container queries on the WIDGET's own width rather than the viewport.
 *
 * Data
 *   The config stores an ORDERED list of references (level + recordId + slug),
 *   never a snapshot of the content. Names, photos, taglines, tags, flight times
 *   and best months are fetched live from /api/destination-list, so an editorial
 *   fix in the Destination Content base reaches every embedded Top 10 without
 *   anyone re-saving a widget. An agent's own title and subtitle are theirs and
 *   do live in the config.
 *
 * Ranking
 *   The order is editorial. It comes from the curated list the widget was seeded
 *   with, or from the order the agent dragged the items into. Nothing in the
 *   destination database ranks destinations, and this widget does not pretend
 *   otherwise: it renders the order it is given.
 *
 * Features
 *  - Three layouts: list (ranked rows), grid (cards), feature (a lead card for
 *    number one, then rows) — config.layout
 *  - Per-item links templated from the agent's own URL structure, e.g.
 *    /destinations/{{slug}} — so the list feeds their own destination pages
 *  - Optional photo, tagline, Best For chips, best months and flight time,
 *    each individually toggleable
 *  - A destination with no photo gets the brand gradient and a compass
 *    watermark rather than a broken image
 *  - Light default + full dark mode, themed from two config colours
 *  - Responsive 320px -> 1200px on container queries, not viewport queries
 *  - ARIA: an ordered list is marked up as an ordered list
 *  - prefers-reduced-motion honoured
 */
(function () {
  'use strict';

  const VERSION = '1.0.0';

  // ---- API base -----------------------------------------------------------
  // The script runs on customer sites, so a relative /api path would resolve
  // against THEIR origin. Always resolve against our own script's origin unless
  // the host page has explicitly overridden it.
  function resolveOrigin() {
    if (typeof window === 'undefined') return '';
    if (window.__TG_WIDGET_API__) {
      try { return new URL(window.__TG_WIDGET_API__, location.href).origin; }
      catch (e) { /* fall through */ }
    }
    try {
      const me = document.currentScript;
      if (me && me.src) return new URL(me.src).origin;
      const scripts = document.getElementsByTagName('script');
      for (let i = scripts.length - 1; i >= 0; i--) {
        const s = scripts[i].src || '';
        if (/\/widget-top10\.js(\?|$|#)/.test(s)) return new URL(s).origin;
      }
    } catch (e) { /* fall through */ }
    return '';
  }

  const ORIGIN = resolveOrigin();
  const CONFIG_API = ORIGIN + '/api/widget-config';
  const LIST_API = ORIGIN + '/api/destination-list';

  // ---- Defaults -----------------------------------------------------------
  const DEFAULTS = {
    title: 'Top 10 Beach Escapes',
    subtitle: '',
    listId: '',
    items: [],
    layout: 'list',            // list | grid | feature
    maxItems: 10,

    showRank: true,
    showPhoto: true,
    showTagline: true,
    showTags: true,
    showBestMonths: true,
    showFlightTime: true,

    linkPattern: '',           // e.g. /destinations/{{slug}} — blank means no per-item link
    linkTarget: 'same',        // same | new

    ctaEnabled: false,
    ctaText: '',
    ctaLabel: 'Talk to us',
    ctaUrl: '',

    theme: 'light',
    brandColour: '#1B2B5B',
    accentColour: '#00B4D8',
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  };

  // ---- Helpers ------------------------------------------------------------
  function esc(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Only ever emit a URL we recognise. Relative paths are allowed because an
  // agent's own destination pages are almost always relative to their site.
  function safeUrl(url, allowMailtoTel) {
    if (typeof url !== 'string') return '';
    const t = url.trim();
    if (!t) return '';
    if (/^https?:\/\//i.test(t)) return t;
    if (allowMailtoTel && /^(mailto:|tel:)/i.test(t)) return t;
    if (/^\/[^/]/.test(t) || t === '/') return t;   // site-relative, not protocol-relative
    if (/^[#?]/.test(t)) return t;
    return '';
  }

  function safeColour(c, fallback) {
    if (typeof c !== 'string') return fallback;
    const t = c.trim();
    return /^#[0-9a-f]{3}$|^#[0-9a-f]{6}$/i.test(t) ? t : fallback;
  }

  // The font stack is written straight into the root element's style attribute,
  // so it is a CSS injection point. Stripping angle brackets is NOT enough: a
  // semicolon ends the declaration and lets the next one through, and a value
  // like "Arial; background:url(https://evil.test/x.png)" would then beacon
  // every visitor's IP to a third party from the agency's own page. Allow only
  // the characters a real font stack needs, and fall back whole rather than
  // trying to repair a value that contains anything else.
  function safeFont(f, fallback) {
    if (typeof f !== 'string') return fallback;
    const t = f.trim();
    if (!t || t.length > 200) return fallback;
    return /^[A-Za-z0-9 ,'"._-]+$/.test(t) ? t : fallback;
  }

  function clampInt(v, min, max, fallback) {
    const n = parseInt(v, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  // Turn '#1B2B5B' into '27,43,91' so it can drive rgba() in the stylesheet.
  function hexToRgb(hex) {
    let h = String(hex || '').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h, 16);
    if (!Number.isFinite(n)) return '27,43,91';
    return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
  }

  /**
   * Substitute {{slug}}, {{name}} and {{level}} into the agent's link pattern.
   * The result goes through safeUrl() and then esc(), so a hostile value in the
   * pattern or in the destination name cannot break out of the attribute.
   */
  function renderPattern(pattern, item) {
    if (typeof pattern !== 'string' || !pattern) return '';
    return pattern.replace(/\{\{\s*(slug|name|level)\s*\}\}/g, (_, key) => {
      const v = item && item[key];
      return typeof v === 'string' ? encodeURIComponent(v) : '';
    });
  }

  // ---- Icons (inline, no external requests) -------------------------------
  const IC = {
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/>',
    compass: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  };

  function icon(name, cls) {
    const paths = IC[name];
    if (!paths) return '';
    return '<svg class="' + (cls || '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
      + 'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
      + paths + '</svg>';
  }

  // ---- Styles -------------------------------------------------------------
  const STYLES = `
    :host { all: initial; display: block; }
    *, *::before, *::after { box-sizing: border-box; }

    .tg10-root {
      --tg10-brand: #1B2B5B;
      --tg10-accent: #00B4D8;
      --tg10-brand-rgb: 27,43,91;
      --tg10-accent-rgb: 0,180,216;

      --tg10-bg: #FFFFFF;
      --tg10-card: #F8FAFC;
      --tg10-text: #0F172A;
      --tg10-sub: #475569;
      --tg10-muted: #64748B;
      --tg10-faint: #94A3B8;
      --tg10-border: #E2E8F0;
      --tg10-border-soft: #F1F5F9;
      --tg10-brand-ink: var(--tg10-brand);

      --tg10-radius: 16px;
      --tg10-radius-sm: 10px;
      --tg10-radius-xs: 6px;

      --tg10-shadow-sm: 0 1px 2px rgba(15,23,42,0.05), 0 1px 3px rgba(var(--tg10-brand-rgb),0.06);
      --tg10-shadow-md: 0 12px 32px -12px rgba(var(--tg10-brand-rgb),0.18), 0 2px 6px rgba(15,23,42,0.05);

      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 15px;
      line-height: 1.5;
      color: var(--tg10-text);
      background: var(--tg10-bg);
      max-width: 1200px;
      margin: 0 auto;
      /* Respond to the WIDGET's own width. Embedded on a customer page this
         often sits in a column far narrower than the viewport, so every
         breakpoint below is @container, never @media. */
      container-type: inline-size;
      container-name: tg10;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }

    .tg10-root[data-theme="dark"] {
      --tg10-bg: #0B1220;
      --tg10-card: #131C2E;
      --tg10-text: #F1F5F9;
      --tg10-sub: #CBD5E1;
      --tg10-muted: #94A3B8;
      --tg10-faint: #64748B;
      --tg10-border: #1E293B;
      --tg10-border-soft: #172033;
      /* A navy brand disappears on a navy ground, so small ink switches to the
         accent in dark mode. Same rule as the Spotlight family. */
      --tg10-brand-ink: var(--tg10-accent);
    }

    /* ---- Header ---- */
    .tg10-head { margin: 0 0 22px; }
    .tg10-title {
      margin: 0;
      font-size: 30px;
      line-height: 1.15;
      font-weight: 700;
      letter-spacing: -0.02em;
      color: var(--tg10-text);
    }
    .tg10-sub {
      margin: 10px 0 0;
      font-size: 15px;
      line-height: 1.6;
      color: var(--tg10-sub);
      max-width: 62ch;
    }

    /* ---- Shared list reset ---- */
    .tg10-list { list-style: none; margin: 0; padding: 0; }

    /* ---- Layout: list (ranked rows) ---- */
    .tg10-row {
      display: grid;
      grid-template-columns: auto auto 1fr;
      align-items: center;
      gap: 18px;
      padding: 16px 0;
      border-top: 1px solid var(--tg10-border-soft);
    }
    .tg10-row:first-child { border-top: 1px solid var(--tg10-border); }
    .tg10-row:last-child { border-bottom: 1px solid var(--tg10-border); }
    .tg10-list[data-norank="1"] .tg10-row { grid-template-columns: auto 1fr; }
    .tg10-list[data-nophoto="1"] .tg10-row { grid-template-columns: auto 1fr; }
    .tg10-list[data-norank="1"][data-nophoto="1"] .tg10-row { grid-template-columns: 1fr; }

    .tg10-rank {
      font-size: 30px;
      font-weight: 700;
      line-height: 1;
      font-variant-numeric: tabular-nums;
      letter-spacing: -0.03em;
      color: var(--tg10-brand-ink);
      opacity: 0.32;
      min-width: 1.6em;
      text-align: right;
    }
    .tg10-row:first-child .tg10-rank { opacity: 0.75; }

    .tg10-thumb {
      width: 92px;
      height: 68px;
      border-radius: var(--tg10-radius-sm);
      overflow: hidden;
      position: relative;
      background: var(--tg10-card);
      flex: none;
    }
    .tg10-thumb img {
      width: 100%; height: 100%;
      object-fit: cover;
      display: block;
    }

    .tg10-body { min-width: 0; }
    .tg10-name {
      margin: 0;
      font-size: 17px;
      font-weight: 650;
      line-height: 1.3;
      letter-spacing: -0.01em;
      color: var(--tg10-text);
    }
    .tg10-name a { color: inherit; text-decoration: none; }
    .tg10-name a:hover { color: var(--tg10-brand-ink); text-decoration: underline; text-underline-offset: 3px; }
    .tg10-name a:focus-visible {
      outline: 2px solid var(--tg10-accent);
      outline-offset: 3px;
      border-radius: 3px;
    }
    .tg10-region {
      margin: 2px 0 0;
      font-size: 12px;
      font-weight: 550;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--tg10-faint);
    }
    .tg10-tag-line {
      margin: 6px 0 0;
      font-size: 14px;
      line-height: 1.55;
      color: var(--tg10-sub);
    }

    /* ---- Meta rail (best months, flight time) ---- */
    .tg10-meta {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px 16px;
      margin: 8px 0 0;
    }
    .tg10-fact {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 12.5px;
      font-weight: 550;
      color: var(--tg10-muted);
      white-space: nowrap;
    }
    .tg10-fact svg { width: 13px; height: 13px; color: var(--tg10-brand-ink); flex: none; }

    /* ---- Best For chips ---- */
    .tg10-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin: 9px 0 0;
      padding: 0;
      list-style: none;
    }
    .tg10-chip {
      font-size: 11.5px;
      font-weight: 600;
      letter-spacing: 0.01em;
      padding: 3px 9px;
      border-radius: 999px;
      color: var(--tg10-brand-ink);
      background: rgba(var(--tg10-accent-rgb), 0.10);
      border: 1px solid rgba(var(--tg10-accent-rgb), 0.22);
      white-space: nowrap;
    }

    /* ---- Layout: grid (cards) ---- */
    .tg10-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 20px;
    }
    .tg10-card {
      background: var(--tg10-bg);
      border: 1px solid var(--tg10-border);
      border-radius: var(--tg10-radius);
      overflow: hidden;
      display: flex;
      flex-direction: column;
      transition: box-shadow .22s ease, transform .22s ease;
    }
    .tg10-card:hover { box-shadow: var(--tg10-shadow-md); transform: translateY(-2px); }
    .tg10-card-media {
      position: relative;
      aspect-ratio: 3 / 2;
      background: var(--tg10-card);
      overflow: hidden;
    }
    .tg10-card-media img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .tg10-badge {
      position: absolute;
      top: 10px; left: 10px;
      min-width: 30px;
      height: 30px;
      padding: 0 8px;
      border-radius: 999px;
      background: var(--tg10-brand);
      color: #FFFFFF;
      font-size: 14px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 2px 8px rgba(15,23,42,0.28);
    }
    .tg10-card-body { padding: 14px 16px 16px; flex: 1 1 auto; }

    /* ---- Layout: feature (lead card + rows) ---- */
    .tg10-feature {
      display: grid;
      grid-template-columns: 1fr;
      gap: 16px;
      margin: 0 0 22px;
      border: 1px solid var(--tg10-border);
      border-radius: var(--tg10-radius);
      overflow: hidden;
      background: var(--tg10-bg);
    }
    .tg10-feature-media {
      position: relative;
      aspect-ratio: 16 / 9;
      background: var(--tg10-card);
      overflow: hidden;
    }
    .tg10-feature-media img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .tg10-feature-body { padding: 4px 20px 22px; }
    .tg10-feature .tg10-name { font-size: 24px; }
    .tg10-eyebrow {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 11.5px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--tg10-brand-ink);
      margin: 0 0 8px;
    }

    /* ---- No-photo fallback: brand gradient + compass watermark ---- */
    .tg10-nophoto {
      position: absolute;
      inset: 0;
      background: linear-gradient(135deg,
        rgba(var(--tg10-brand-rgb), 0.92) 0%,
        rgba(var(--tg10-accent-rgb), 0.72) 100%);
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .tg10-nophoto svg {
      width: 38%;
      max-width: 64px;
      height: auto;
      color: #FFFFFF;
      opacity: 0.28;
      stroke-width: 1.1;
    }

    /* ---- Photo credit ---- */
    .tg10-credit {
      margin: 14px 0 0;
      font-size: 11px;
      line-height: 1.5;
      color: var(--tg10-faint);
    }

    /* ---- CTA ---- */
    .tg10-cta {
      margin: 24px 0 0;
      padding: 20px 22px;
      border-radius: var(--tg10-radius);
      background: var(--tg10-card);
      border: 1px solid var(--tg10-border);
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
    }
    .tg10-cta-text { margin: 0; font-size: 15px; color: var(--tg10-sub); max-width: 52ch; }
    .tg10-btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 11px 20px;
      border-radius: 999px;
      background: var(--tg10-brand);
      color: #FFFFFF;
      font-size: 14.5px;
      font-weight: 600;
      text-decoration: none;
      white-space: nowrap;
      transition: filter .18s ease, transform .18s ease;
    }
    .tg10-btn:hover { filter: brightness(1.12); transform: translateY(-1px); }
    .tg10-btn:focus-visible { outline: 2px solid var(--tg10-accent); outline-offset: 3px; }
    .tg10-btn svg { width: 16px; height: 16px; }

    /* ---- States ---- */
    .tg10-state {
      padding: 28px 20px;
      text-align: center;
      color: var(--tg10-muted);
      font-size: 14px;
      border: 1px dashed var(--tg10-border);
      border-radius: var(--tg10-radius);
    }
    .tg10-skeleton { padding: 0; }
    .tg10-sk-row {
      display: grid;
      grid-template-columns: 46px 92px 1fr;
      gap: 18px;
      align-items: center;
      padding: 16px 0;
      border-top: 1px solid var(--tg10-border-soft);
    }
    .tg10-sk-box { background: var(--tg10-card); border-radius: var(--tg10-radius-xs); }
    .tg10-sk-thumb { height: 68px; border-radius: var(--tg10-radius-sm); }
    .tg10-sk-line { height: 13px; }
    .tg10-sk-line + .tg10-sk-line { margin-top: 9px; width: 62%; }
    .tg10-pulse { animation: tg10-pulse 1.5s ease-in-out infinite; }
    @keyframes tg10-pulse { 0%,100% { opacity: 1 } 50% { opacity: .55 } }

    /* ---- Container breakpoints (widget width, not viewport) ---- */
    @container tg10 (min-width: 560px) {
      .tg10-grid { grid-template-columns: repeat(2, 1fr); }
      .tg10-feature { grid-template-columns: 1.15fr 1fr; align-items: stretch; }
      .tg10-feature-media { aspect-ratio: auto; height: 100%; min-height: 240px; }
      .tg10-feature-body { padding: 24px 24px 24px 4px; align-self: center; }
    }
    @container tg10 (min-width: 900px) {
      .tg10-grid { grid-template-columns: repeat(3, 1fr); }
      .tg10-title { font-size: 34px; }
    }
    @container tg10 (max-width: 479px) {
      .tg10-title { font-size: 24px; }
      .tg10-row { gap: 12px; padding: 14px 0; }
      .tg10-rank { font-size: 22px; min-width: 1.3em; }
      .tg10-thumb { width: 64px; height: 52px; }
      .tg10-name { font-size: 15.5px; }
      .tg10-tag-line { font-size: 13.5px; }
      .tg10-cta { padding: 16px; }
      .tg10-feature .tg10-name { font-size: 20px; }
      .tg10-feature-body { padding: 4px 16px 18px; }
    }

    @media (prefers-reduced-motion: reduce) {
      .tg10-card, .tg10-btn { transition: none; }
      .tg10-card:hover, .tg10-btn:hover { transform: none; }
      .tg10-pulse { animation: none; }
    }
  `;

  // ---- Widget -------------------------------------------------------------
  class TGTop10Widget {
    constructor(container, config) {
      if (!container) throw new Error('TGTop10Widget: container required');
      this.el = container;
      this.cfg = Object.assign({}, DEFAULTS, config || {});
      this.items = null;      // null = still loading, [] = loaded but empty
      this.error = false;
      this.destroyed = false;

      this.shadow = container.shadowRoot || container.attachShadow({ mode: 'open' });
      container.setAttribute('data-tg-initialised', '1');

      // Pre-hydrated items (the editor injects these so its preview does not
      // need a saved widget id).
      if (Array.isArray(this.cfg.__items)) {
        this.items = this.cfg.__items;
        this._render();
      } else {
        this._render();       // skeleton first, so the block reserves its space
        this._load();
      }
    }

    // ---- Data ----
    _listUrl() {
      if (this.cfg.widgetId) return LIST_API + '?id=' + encodeURIComponent(this.cfg.widgetId);
      if (this.cfg.listId) return LIST_API + '?list=' + encodeURIComponent(this.cfg.listId);
      return '';
    }

    async _load() {
      const url = this._listUrl();
      if (!url) { this.items = []; this._render(); return; }
      // A 9s abort budget, matching the rest of the content family. Without it
      // a hung upstream leaves the visitor on the loading skeleton forever
      // instead of reaching the error state. Guarded by test:timeout-guards.
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), 9000) : null;
      try {
        const res = await fetch(url,
          Object.assign({ credentials: 'omit' }, ctrl ? { signal: ctrl.signal } : {}));
        if (!res.ok) throw new Error('List fetch failed (' + res.status + ')');
        const data = await res.json();
        if (this.destroyed) return;
        this.items = Array.isArray(data.items) ? data.items : [];
        // A curated list carries its own title and subtitle. The agent's own
        // wording, once they have set any, always wins.
        if (data.title && !this.cfg.title) this.cfg.title = data.title;
        if (data.subtitle && !this.cfg.subtitle) this.cfg.subtitle = data.subtitle;
      } catch (err) {
        if (this.destroyed) return;
        console.error('[TG Top 10] ' + (err && err.message ? err.message : err));
        this.error = true;
        this.items = [];
      } finally {
        if (timer) clearTimeout(timer);
      }
      this._render();
    }

    // ---- Render ----
    // Note: this method is called on EVERY keystroke by the editor preview, so
    // it must stay side-effect-free for the host page. No focus(), no
    // scrollIntoView(), no autofocus anywhere in here.
    _render() {
      const c = this.cfg;
      const brand = safeColour(c.brandColour, DEFAULTS.brandColour);
      const accent = safeColour(c.accentColour, DEFAULTS.accentColour);
      const theme = c.theme === 'dark' ? 'dark' : 'light';
      const font = safeFont(c.fontFamily, DEFAULTS.fontFamily);

      const styleVars = [
        '--tg10-brand:' + brand,
        '--tg10-accent:' + accent,
        '--tg10-brand-rgb:' + hexToRgb(brand),
        '--tg10-accent-rgb:' + hexToRgb(accent),
        'font-family:' + font,
      ].join(';');

      let inner;
      if (this.items === null) inner = this._skeleton();
      else if (this.error) inner = '<div class="tg10-state">This list is unavailable right now.</div>';
      else if (!this.items.length) inner = '<div class="tg10-state">No destinations have been added to this list yet.</div>';
      else inner = this._content();

      this.shadow.innerHTML =
        '<style>' + STYLES + '</style>' +
        '<div class="tg10-root" data-theme="' + theme + '" style="' + esc(styleVars) + '">' +
          this._header() +
          inner +
        '</div>';
    }

    _header() {
      const t = typeof this.cfg.title === 'string' ? this.cfg.title.trim() : '';
      const s = typeof this.cfg.subtitle === 'string' ? this.cfg.subtitle.trim() : '';
      if (!t && !s) return '';
      return '<header class="tg10-head">'
        + (t ? '<h2 class="tg10-title">' + esc(t) + '</h2>' : '')
        + (s ? '<p class="tg10-sub">' + esc(s) + '</p>' : '')
        + '</header>';
    }

    _skeleton() {
      let rows = '';
      for (let i = 0; i < 5; i++) {
        rows += '<div class="tg10-sk-row">'
          + '<div class="tg10-sk-box tg10-sk-line tg10-pulse" style="height:26px"></div>'
          + '<div class="tg10-sk-box tg10-sk-thumb tg10-pulse"></div>'
          + '<div><div class="tg10-sk-box tg10-sk-line tg10-pulse"></div>'
          + '<div class="tg10-sk-box tg10-sk-line tg10-pulse"></div></div>'
          + '</div>';
      }
      return '<div class="tg10-skeleton" aria-hidden="true">' + rows + '</div>';
    }

    _visibleItems() {
      const max = clampInt(this.cfg.maxItems, 1, 12, 10);
      return this.items.slice(0, max);
    }

    _content() {
      const layout = ['list', 'grid', 'feature'].indexOf(this.cfg.layout) >= 0 ? this.cfg.layout : 'list';
      const items = this._visibleItems();
      let body;
      if (layout === 'grid') body = this._grid(items);
      else if (layout === 'feature') body = this._featureLayout(items);
      else body = this._rows(items);
      return body + this._credits(items) + this._cta();
    }

    // -- link wrapper --
    _link(item, inner) {
      const url = safeUrl(renderPattern(this.cfg.linkPattern, item));
      if (!url) return inner;
      const target = this.cfg.linkTarget === 'new'
        ? ' target="_blank" rel="noopener noreferrer"' : '';
      return '<a href="' + esc(url) + '"' + target + '>' + inner + '</a>';
    }

    _media(item, cls) {
      const url = safeUrl(item.image);
      if (!url) {
        return '<div class="' + cls + '"><div class="tg10-nophoto">'
          + icon('compass') + '</div></div>';
      }
      // A destination name is the honest alt text here: the photo illustrates
      // the place, and the rank is already in the text next to it.
      return '<div class="' + cls + '">'
        + '<img src="' + esc(url) + '" alt="' + esc(item.name || '') + '" '
        + 'loading="lazy" decoding="async" referrerpolicy="no-referrer">'
        + '</div>';
    }

    _facts(item) {
      const bits = [];
      if (this.cfg.showBestMonths && item.bestMonths) {
        bits.push('<span class="tg10-fact">' + icon('sun') + esc(item.bestMonths) + '</span>');
      }
      if (this.cfg.showFlightTime && item.flightTime) {
        bits.push('<span class="tg10-fact">' + icon('clock') + esc(item.flightTime) + ' from the UK</span>');
      }
      return bits.length ? '<div class="tg10-meta">' + bits.join('') + '</div>' : '';
    }

    _chips(item) {
      if (!this.cfg.showTags || !Array.isArray(item.tags) || !item.tags.length) return '';
      const chips = item.tags.slice(0, 4)
        .map(t => '<li class="tg10-chip">' + esc(t) + '</li>').join('');
      return '<ul class="tg10-chips">' + chips + '</ul>';
    }

    _details(item) {
      const name = '<h3 class="tg10-name">' + this._link(item, esc(item.name || '')) + '</h3>';
      const region = item.region ? '<p class="tg10-region">' + esc(item.region) + '</p>' : '';
      const tagline = (this.cfg.showTagline && item.tagline)
        ? '<p class="tg10-tag-line">' + esc(item.tagline) + '</p>' : '';
      return name + region + tagline + this._facts(item) + this._chips(item);
    }

    _rows(items) {
      const rows = items.map(item => {
        let cells = '';
        if (this.cfg.showRank) {
          cells += '<div class="tg10-rank" aria-hidden="true">' + esc(String(item.rank)) + '</div>';
        }
        if (this.cfg.showPhoto) {
          cells += this._link(item, this._media(item, 'tg10-thumb'));
        }
        cells += '<div class="tg10-body">' + this._details(item) + '</div>';
        return '<li class="tg10-row">' + cells + '</li>';
      }).join('');

      return '<ol class="tg10-list"'
        + (this.cfg.showRank ? '' : ' data-norank="1"')
        + (this.cfg.showPhoto ? '' : ' data-nophoto="1"')
        + '>' + rows + '</ol>';
    }

    _grid(items) {
      const cards = items.map(item => {
        let media = '';
        if (this.cfg.showPhoto) {
          const badge = this.cfg.showRank
            ? '<span class="tg10-badge">' + esc(String(item.rank)) + '</span>' : '';
          media = this._link(item, this._media(item, 'tg10-card-media') + badge);
        }
        return '<li class="tg10-card">' + media
          + '<div class="tg10-card-body">' + this._details(item) + '</div></li>';
      }).join('');
      return '<ol class="tg10-list tg10-grid">' + cards + '</ol>';
    }

    _featureLayout(items) {
      if (!items.length) return '';
      const [lead, ...rest] = items;
      const media = this.cfg.showPhoto ? this._link(lead, this._media(lead, 'tg10-feature-media')) : '';
      const eyebrow = this.cfg.showRank
        ? '<p class="tg10-eyebrow">Our number one</p>' : '';
      const feature = '<div class="tg10-feature">' + media
        + '<div class="tg10-feature-body">' + eyebrow + this._details(lead) + '</div></div>';
      return feature + (rest.length ? this._rows(rest) : '');
    }

    // Unsplash asks that photographers are credited. The Spotlight family shows
    // the credit line under the content rather than over each photo.
    _credits(items) {
      if (!this.cfg.showPhoto) return '';
      const names = [];
      for (const it of items) {
        if (it.attribution && safeUrl(it.image) && names.indexOf(it.attribution) < 0) {
          names.push(it.attribution);
        }
      }
      if (!names.length) return '';
      return '<p class="tg10-credit">Photography: ' + esc(names.slice(0, 10).join(', ')) + '</p>';
    }

    _cta() {
      if (!this.cfg.ctaEnabled) return '';
      const url = safeUrl(this.cfg.ctaUrl, true);
      const label = typeof this.cfg.ctaLabel === 'string' ? this.cfg.ctaLabel.trim() : '';
      const text = typeof this.cfg.ctaText === 'string' ? this.cfg.ctaText.trim() : '';
      if (!text && !(url && label)) return '';
      const btn = (url && label)
        ? '<a class="tg10-btn" href="' + esc(url) + '">' + esc(label) + icon('arrow') + '</a>'
        : '';
      return '<div class="tg10-cta">'
        + (text ? '<p class="tg10-cta-text">' + esc(text) + '</p>' : '<span></span>')
        + btn + '</div>';
    }

    // ---- Public API ----
    update(newConfig) {
      const prev = this.cfg;
      this.cfg = Object.assign({}, this.cfg, newConfig || {});
      if (Array.isArray(this.cfg.__items)) {
        this.items = this.cfg.__items;
        this._render();
        return;
      }
      // Only go back to the network when the SOURCE of the list changed.
      // Styling and toggle changes must never refetch: the editor calls this on
      // every keystroke.
      const sourceChanged = prev.widgetId !== this.cfg.widgetId || prev.listId !== this.cfg.listId;
      if (sourceChanged) {
        this.items = null;
        this.error = false;
        this._render();
        this._load();
      } else {
        this._render();
      }
    }

    destroy() {
      this.destroyed = true;
      try { this.shadow.innerHTML = ''; } catch (e) { /* noop */ }
      try { this.el.removeAttribute('data-tg-initialised'); } catch (e) { /* noop */ }
    }
  }

  // ---- Auto-init ----------------------------------------------------------
  async function init() {
    const containers = document.querySelectorAll('[data-tg-widget="top10"]:not([data-tg-initialised])');
    for (const el of containers) {
      try {
        const inline = el.getAttribute('data-tg-config');
        if (inline) {
          let cfg = {};
          try { cfg = JSON.parse(inline); } catch { cfg = {}; }
          el.__tgTop10 = new TGTop10Widget(el, cfg);
          continue;
        }

        const id = el.getAttribute('data-tg-id');
        if (id) {
          const res = await fetch(CONFIG_API + '?id=' + encodeURIComponent(id), { credentials: 'omit' });
          if (!res.ok) throw new Error('Widget config fetch failed (' + res.status + ')');
          const data = await res.json();
          const cfg = (data && (data.config || data)) || {};
          cfg.widgetId = id;
          el.__tgTop10 = new TGTop10Widget(el, cfg);
          continue;
        }

        console.warn('[TG Top 10] Container has neither data-tg-id nor data-tg-config');
      } catch (err) {
        console.error('[TG Top 10] Failed to initialise:', err);
      }
    }
  }

  window.TGTop10Widget = TGTop10Widget;
  window.__TG_TOP10_VERSION__ = VERSION;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
