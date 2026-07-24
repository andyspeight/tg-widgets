/**
 * Travelgenix Stats Counter Widget v1.0.0
 * Self-contained, embeddable animated statistics. Big numbers that count up
 * when they scroll into view. Zero dependencies, Shadow DOM isolation, no API.
 * Respects prefers-reduced-motion (shows the final figures with no animation).
 *
 * Usage (remote config, default):
 *   <div data-tg-widget="statscounter" data-tg-id="YOUR_WIDGET_ID"></div>
 *   <script src="https://tg-widgets.vercel.app/widget-statscounter.js"></script>
 *
 * Usage (inline config, editor preview):
 *   <div data-tg-widget="statscounter" data-tg-config='{...}'></div>
 *   <script src="https://tg-widgets.vercel.app/widget-statscounter.js"></script>
 */
(function () {
  'use strict';

  const VERSION = '1.0.5';

  // ─── i18n ───────────────────────────────────────────────────
  // Fixed UI chrome only (the localised default stat labels used when the
  // author hasn't set their own, plus the load-error message). Stat numbers,
  // author-entered labels, prefixes and suffixes are data, never translated.
  // English is the source + fallback.
  const MESSAGES = {
    en: { happyCustomers: 'Happy customers', wouldRecommend: 'Would recommend', yearsExperience: 'Years of experience', averageRating: 'Average rating', loadError: 'Unable to load Stats widget' },
    fr: { happyCustomers: 'Clients satisfaits', wouldRecommend: 'Nous recommandent', yearsExperience: 'Ans d\'expérience', averageRating: 'Note moyenne', loadError: 'Impossible de charger le widget Stats' },
    de: { happyCustomers: 'Zufriedene Kunden', wouldRecommend: 'Würden uns weiterempfehlen', yearsExperience: 'Jahre Erfahrung', averageRating: 'Durchschnittsbewertung', loadError: 'Stats-Widget kann nicht geladen werden' },
    es: { happyCustomers: 'Clientes satisfechos', wouldRecommend: 'Nos recomendarían', yearsExperience: 'Años de experiencia', averageRating: 'Valoración media', loadError: 'No se pudo cargar el widget de estadísticas' },
    it: { happyCustomers: 'Clienti soddisfatti', wouldRecommend: 'Ci consiglierebbero', yearsExperience: 'Anni di esperienza', averageRating: 'Valutazione media', loadError: 'Impossibile caricare il widget Statistiche' },
    ro: { happyCustomers: 'Clienți mulțumiți', wouldRecommend: 'Ne-ar recomanda', yearsExperience: 'Ani de experiență', averageRating: 'Evaluare medie', loadError: 'Widgetul Statistici nu poate fi încărcat' },
  };
  // Uses the shared TGi18n core when present; otherwise an identical inline
  // resolver keeps the widget self-contained.
  function makeT(cfg) {
    if (typeof window !== 'undefined' && window.TGi18n && typeof window.TGi18n.make === 'function') return window.TGi18n.make(MESSAGES, cfg);
    const supported = Object.keys(MESSAGES);
    const baseOf = (r) => (r ? String(r).toLowerCase().replace(/_/g, '-').split('-')[0] : '');
    let cands = [];
    if (cfg) cands.push(cfg.lang, cfg.language, cfg.locale);
    try { cands.push(document.documentElement.getAttribute('lang')); } catch (e) { /* noop */ }
    try { if (navigator.languages) cands = cands.concat(navigator.languages); cands.push(navigator.language); } catch (e) { /* noop */ }
    let lang = 'en';
    for (let i = 0; i < cands.length; i++) { const b = baseOf(cands[i]); if (b && supported.indexOf(b) !== -1) { lang = b; break; } }
    const dict = MESSAGES[lang] || MESSAGES.en;
    const t = (k, vars) => {
      let s = Object.prototype.hasOwnProperty.call(dict, k) ? dict[k] : (MESSAGES.en[k] || k);
      if (vars) s = String(s).replace(/\{(\w+)\}/g, (m, n) => (vars[n] != null ? vars[n] : m));
      return s;
    };
    t.lang = lang; t.dir = 'ltr';
    return t;
  }

  function resolveConfigApi() {
    if (typeof window === 'undefined') return '/api/widget-config';
    if (window.__TG_WIDGET_API__) return window.__TG_WIDGET_API__;
    try {
      const me = document.currentScript;
      if (me && me.src) return new URL(me.src).origin + '/api/widget-config';
      const scripts = document.getElementsByTagName('script');
      for (let i = scripts.length - 1; i >= 0; i--) {
        const s = scripts[i].src || '';
        if (/\/widget-statscounter\.js(\?|$|#)/.test(s)) return new URL(s).origin + '/api/widget-config';
      }
    } catch (e) { /* fall through */ }
    return '/api/widget-config';
  }
  const CONFIG_API = resolveConfigApi();

  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hexOk = (v) => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(v || '').trim());
  // A font-family value is interpolated into the shadow <style> block, so it must
  // never carry CSS-breakout characters ( < > { } ; : ( ) etc). Allow only what a
  // real font-family stack needs — names, spaces, commas and quotes — otherwise
  // fall back. Prevents a saved fontFamily like `x}</style><img onerror=...>` from
  // escaping the style element and executing on the client's page.
  const safeFontStack = (v, fb) => {
    const s = String(v == null ? '' : v).trim();
    return (s && s.length <= 120 && /^[A-Za-z0-9 ,"'-]+$/.test(s)) ? s : fb;
  };
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

  // Cache one Intl.NumberFormat per locale+decimals combo — _render calls this
  // every animation frame, so rebuilding the formatter each time would be waste.
  const _nfCache = {};
  function fmtNumber(n, decimals, locale) {
    const d = Math.max(0, Math.min(2, decimals | 0));
    // Format in the viewer's language so grouping and decimal separators match
    // their locale (e.g. 1 234,5 in French, 1.234,5 in German), consistent with
    // the rest of the widget's i18n. Falls back to comma-grouped en formatting.
    try {
      if (typeof Intl !== 'undefined' && Intl.NumberFormat) {
        const key = (locale || 'en') + '|' + d;
        const nf = _nfCache[key] || (_nfCache[key] = new Intl.NumberFormat(locale || undefined, { minimumFractionDigits: d, maximumFractionDigits: d }));
        return nf.format(n);
      }
    } catch (e) { /* fall through to manual grouping */ }
    const fixed = d > 0 ? n.toFixed(d) : String(Math.round(n));
    const parts = fixed.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts.join('.');
  }

  const reducedMotion = () => {
    try { return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch (e) { return false; }
  };

  class TGStatsCounterWidget {
    constructor(el, config) {
      this.el = el;
      this.cfg = this._defaults(config || {});
      this.t = makeT(this.cfg);   // resolve viewer language + UI strings
      this._raf = null;
      this._io = null;
      this._fallback = null;
      this._done = false;
      this.shadow = el.attachShadow ? el.attachShadow({ mode: 'open' }) : el;
      el.setAttribute('data-tg-initialised', '1');
      this._build();
      this._arm();
    }

    _defaults(c) {
      let stats = Array.isArray(c.stats) ? c.stats : null;
      if (stats) {
        stats = stats
          .filter(s => s && (s.value != null && s.value !== ''))
          .map(s => ({
            value: Number(s.value) || 0,
            label: String(s.label || '').slice(0, 60),
            prefix: String(s.prefix || '').slice(0, 6),
            suffix: String(s.suffix || '').slice(0, 6),
            decimals: Math.max(0, Math.min(2, Number(s.decimals) || 0)),
          }))
          .slice(0, 6);
      }
      if (!stats || !stats.length) stats = [
        // Default sample stats. Labels are blank so the localised default
        // (resolved via labelKey at render time) shows until the author sets
        // their own label, which always wins.
        { value: 12000, label: '', labelKey: 'happyCustomers', prefix: '', suffix: '+', decimals: 0 },
        { value: 98, label: '', labelKey: 'wouldRecommend', prefix: '', suffix: '%', decimals: 0 },
        { value: 25, label: '', labelKey: 'yearsExperience', prefix: '', suffix: '', decimals: 0 },
        { value: 4.9, label: '', labelKey: 'averageRating', prefix: '', suffix: '/5', decimals: 1 },
      ];
      let cols = Number(c.columns);
      if (![2, 3, 4].includes(cols)) cols = Math.min(stats.length, 4) || 1;
      return {
        heading: typeof c.heading === 'string' ? c.heading : '',
        stats,
        columns: cols,
        duration: Math.max(300, Math.min(5000, Number(c.duration) || 1800)),
        accent: hexOk(c.accent) ? c.accent : '#0891B2',
        layout: c.layout === 'card' ? 'card' : 'inline',
        dividers: c.dividers !== false,
        align: c.align === 'left' ? 'left' : 'center',
        animate: c.animate !== false,
        theme: c.theme === 'dark' ? 'dark' : 'light',
        fontFamily: safeFontStack(c.fontFamily, 'Inter, system-ui, sans-serif'),
        previewMode: !!c.previewMode,
        // Carry the language override through so makeT (and the locale-aware
        // number formatter) honour a config-set language. Empty = auto-detect
        // from the viewer's browser, unchanged from before.
        lang: typeof c.lang === 'string' ? c.lang : '',
      };
    }

    _build() {
      const c = this.cfg;
      const dark = c.theme === 'dark';
      const ink = dark ? '#F1F5F9' : '#0F172A';
      const ink2 = dark ? '#94A3B8' : '#64748B';
      const panel = dark ? '#0B1220' : '#FFFFFF';
      const border = dark ? '#1E293B' : '#E2E8F0';
      const card = c.layout === 'card';
      const cols = Math.min(c.columns, c.stats.length) || 1;

      this.shadow.innerHTML = `
        <style>
          :host { all: initial; }
          * { box-sizing: border-box; }
          .sc { font-family: ${c.fontFamily}; color: ${ink}; ${card ? `background:${panel};border:1px solid ${border};border-radius:16px;padding:28px 22px;box-shadow:0 1px 3px rgba(15,23,42,.06),0 10px 30px rgba(15,23,42,.04);` : ''} }
          .sc-head { font-size: 18px; font-weight: 700; margin: 0 0 18px; letter-spacing: -.01em; text-align: ${c.align}; }
          .sc-grid { display: grid; grid-template-columns: repeat(${cols}, 1fr); gap: 8px 12px; }
          .sc-item { padding: 10px 14px; text-align: ${c.align}; ${c.dividers ? `border-left: 1px solid ${border};` : ''} }
          .sc-item:first-child { border-left: 0; }
          .sc-num { font-size: 38px; font-weight: 800; letter-spacing: -.03em; line-height: 1.05; color: ${ink}; font-variant-numeric: tabular-nums; }
          .sc-num .sc-affix { color: ${c.accent}; }
          .sc-label { margin-top: 6px; font-size: 13px; color: ${ink2}; font-weight: 500; }
          @media (max-width: 560px){ .sc-grid { grid-template-columns: repeat(${cols >= 2 ? 2 : 1}, 1fr); } .sc-item { border-left: 0; } }
          @media (max-width: 360px){ .sc-grid { grid-template-columns: 1fr; } }
        </style>
        <div class="sc">
          ${c.heading ? `<h3 class="sc-head">${esc(c.heading)}</h3>` : ''}
          <div class="sc-grid" id="grid"></div>
        </div>`;

      const grid = this.shadow.getElementById('grid');
      this.nums = c.stats.map(s => {
        // Author label wins; otherwise fall back to the localised default for
        // this sample stat (labelKey only present on the built-in defaults).
        const label = s.label || (s.labelKey ? this.t(s.labelKey) : '');
        const item = document.createElement('div');
        item.className = 'sc-item';
        item.innerHTML = `<div class="sc-num"><span class="sc-affix">${esc(s.prefix)}</span><span data-role="n">0</span><span class="sc-affix">${esc(s.suffix)}</span></div>${label ? `<div class="sc-label">${esc(label)}</div>` : ''}`;
        grid.appendChild(item);
        return item.querySelector('[data-role="n"]');
      });
      this._render(c.animate ? 0 : 1);
    }

    _render(progress) {
      const e = easeOutCubic(Math.max(0, Math.min(1, progress)));
      this.cfg.stats.forEach((s, i) => {
        if (this.nums[i]) this.nums[i].textContent = fmtNumber(s.value * e, s.decimals, this.t.lang);
      });
    }

    _arm() {
      const c = this.cfg;
      if (!c.animate || reducedMotion()) { this._render(1); this._done = true; return; }
      // Single entry point for starting the count-up, safe to call more than
      // once. Tears down the observer and fail-safe timer so nothing lingers.
      const kick = () => {
        if (this._done) return;
        this._done = true;
        if (this._io) { try { this._io.disconnect(); } catch (e) {} this._io = null; }
        if (this._fallback) { clearTimeout(this._fallback); this._fallback = null; }
        this._play();
      };
      // Animate when scrolled into view; if IO is unavailable, animate now.
      if (typeof IntersectionObserver === 'function') {
        // threshold 0 fires on ANY intersection. A stats block taller than a
        // short viewport can never reach a higher ratio, so a stricter
        // threshold would strand every figure at 0 for the whole session.
        this._io = new IntersectionObserver((entries) => {
          for (const en of entries) {
            if (en.isIntersecting) { kick(); return; }
          }
        }, { threshold: 0 });
        this._io.observe(this.el);
        // If the element is already partly on screen at arm time, start now —
        // the observer may not report an initial intersection on some engines.
        try {
          const r = this.el.getBoundingClientRect();
          const vh = window.innerHeight || document.documentElement.clientHeight || 0;
          const vw = window.innerWidth || document.documentElement.clientWidth || 0;
          if (r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw) kick();
        } catch (e) { /* noop */ }
        // Fail-safe: never leave the figures stuck at 0. If no intersection is
        // ever reported, animate anyway after a short delay.
        this._fallback = setTimeout(kick, 2500);
      } else {
        kick();
      }
    }

    _play() {
      const start = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      const dur = this.cfg.duration;
      const step = (now) => {
        const t = (now - start) / dur;
        this._render(t);
        if (t < 1) this._raf = requestAnimationFrame(step);
        else this._render(1);
      };
      this._raf = requestAnimationFrame(step);
    }

    update(config) {
      if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
      if (this._io) { try { this._io.disconnect(); } catch (e) {} this._io = null; }
      if (this._fallback) { clearTimeout(this._fallback); this._fallback = null; }
      this.cfg = this._defaults(config || {});
      this.t = makeT(this.cfg);
      this._done = true;        // editor updates show finals, no re-animation
      this._build();
      this._render(1);
    }

    destroy() {
      if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
      if (this._io) { try { this._io.disconnect(); } catch (e) {} this._io = null; }
      if (this._fallback) { clearTimeout(this._fallback); this._fallback = null; }
      try { this.shadow.innerHTML = ''; } catch (e) {}
      try { this.el.removeAttribute('data-tg-initialised'); } catch (e) {}
    }
  }

  async function init() {
    if (typeof document === 'undefined') return;
    const nodes = document.querySelectorAll('[data-tg-widget="statscounter"]:not([data-tg-initialised])');
    for (const el of nodes) {
      try {
        const inline = el.getAttribute('data-tg-config');
        if (inline) { let cfg = {}; try { cfg = JSON.parse(inline); } catch { cfg = {}; } new TGStatsCounterWidget(el, cfg); continue; }
        const id = el.getAttribute('data-tg-id');
        if (id) {
          const res = await fetch(CONFIG_API + '?id=' + encodeURIComponent(id), { credentials: 'omit' });
          if (!res.ok) throw new Error('config ' + res.status);
          const data = await res.json();
          const cfg = (data && (data.config || data)) || {};
          cfg.widgetId = id;
          new TGStatsCounterWidget(el, cfg);
          continue;
        }
        console.warn('[TG Stats] Container has neither data-tg-id nor data-tg-config');
      } catch (err) {
        console.error('[TG Stats] Failed to initialise:', err);
        try { el.innerHTML = ''; el.style.display = 'none'; } catch (e) {} // fail quiet — never paint an error box on a client page
      }
    }
  }

  if (typeof window !== 'undefined') { window.TGStatsCounterWidget = TGStatsCounterWidget; window.__TG_STATSCOUNTER_VERSION__ = VERSION; }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
    if (typeof MutationObserver !== 'undefined') {
      try {
        let scheduled = false;
        const schedule = () => { if (scheduled) return; scheduled = true; setTimeout(() => { scheduled = false; init(); }, 120); };
        const mo = new MutationObserver((records) => {
          for (const r of records) for (const node of r.addedNodes) {
            if (node.nodeType !== 1) continue;
            if ((node.matches && node.matches('[data-tg-widget="statscounter"]:not([data-tg-initialised])')) ||
                (node.querySelector && node.querySelector('[data-tg-widget="statscounter"]:not([data-tg-initialised])'))) { schedule(); return; }
          }
        });
        mo.observe(document.body || document.documentElement, { childList: true, subtree: true });
      } catch (e) { /* noop */ }
    }
  }
})();
