/**
 * Travelgenix Back to Top Widget v1.0.1
 * A floating "scroll to top" button that fades in once the visitor has scrolled
 * a configurable percentage down the page, and smooth-scrolls back to the top
 * on click. Self-contained, zero dependencies, Shadow DOM, accessible.
 *
 * Usage (remote config):
 *   <div data-tg-widget="backtotop" data-tg-id="YOUR_WIDGET_ID"></div>
 *   <script src="https://tg-widgets.vercel.app/widget-backtotop.js"></script>
 *
 * Usage (inline config):
 *   <div data-tg-widget="backtotop" data-tg-config='{"showAfter":25}'></div>
 *   <script src="https://tg-widgets.vercel.app/widget-backtotop.js"></script>
 *
 * © Travelgenix. All rights reserved.
 */
(function () {
  'use strict';

  const VERSION = '1.1.2';

  function resolveBase(path, override) {
    if (typeof window === 'undefined') return path;
    if (override && window[override]) return window[override];
    try {
      const me = document.currentScript;
      if (me && me.src) return new URL(me.src).origin + path;
      // currentScript is null for async/defer/module or tag-manager injected
      // loads — scan for this widget's own script tag so the fetch still targets
      // the widget host rather than falling back to the relative path (which
      // resolves to the client's own origin and 404s, dropping the client's
      // saved colour, label and position).
      const scripts = document.getElementsByTagName('script');
      for (let i = scripts.length - 1; i >= 0; i--) {
        const s = scripts[i].src || '';
        if (/\/widget-backtotop\.js(\?|$|#)/.test(s)) return new URL(s).origin + path;
      }
    } catch (e) { /* noop */ }
    return path;
  }
  const API_BASE = resolveBase('/api/widget-config', '__TG_WIDGET_API__');

  // ─── Helpers ────────────────────────────────────────────────
  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }
  function safeColor(c, fb) { return (typeof c === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c.trim())) ? c.trim() : fb; }
  function safeFont(f) { return (typeof f === 'string' && /^[\w \-]{1,40}$/.test(f.trim())) ? f.trim() : 'Inter'; }
  function clampNum(v, min, max, fb) { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fb; }
  function prefersReducedMotion() { return typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }

  // Pick a legible icon colour for a given background (luminance test).
  function inkFor(hex) {
    let h = hex.replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const r = parseInt(h.slice(0, 2), 16) / 255, g = parseInt(h.slice(2, 4), 16) / 255, b = parseInt(h.slice(4, 6), 16) / 255;
    const lin = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    return L > 0.5 ? '#0F172A' : '#FFFFFF';
  }

  const ICONS = {
    chevron: '<polyline points="6 15 12 9 18 15"/>',
    arrow: '<line x1="12" y1="19" x2="12" y2="6"/><polyline points="6 12 12 6 18 12"/>',
    double: '<polyline points="6 17 12 11 18 17"/><polyline points="6 11 12 5 18 11"/>',
  };

  // ─── i18n ───────────────────────────────────────────────────
  // UI strings, per language. English is the source + fallback. The author can
  // still override labelText / ariaLabel per widget; when they leave them blank
  // the visitor sees the localized default for their language.
  const MESSAGES = {
    en: { top: 'Top', backToTop: 'Back to top' },
    fr: { top: 'Haut', backToTop: 'Retour en haut' },
    de: { top: 'Oben', backToTop: 'Nach oben' },
    es: { top: 'Arriba', backToTop: 'Volver arriba' },
    it: { top: 'Su', backToTop: 'Torna su' },
    ro: { top: 'Sus', backToTop: 'Înapoi sus' },
  };
  // Use the shared TGi18n core when it is present on the page; otherwise a tiny
  // self-contained resolver keeps this widget dependency-free. Same logic either
  // way, so the result is identical.
  function makeT(cfg) {
    if (window.TGi18n && typeof window.TGi18n.make === 'function') return window.TGi18n.make(MESSAGES, cfg);
    const supported = Object.keys(MESSAGES);
    const baseOf = (r) => (r ? String(r).toLowerCase().replace(/_/g, '-').split('-')[0] : '');
    let cands = [];
    if (cfg) cands.push(cfg.lang, cfg.language, cfg.locale);
    try { cands.push(document.documentElement.getAttribute('lang')); } catch (e) { /* noop */ }
    try { if (navigator.languages) cands = cands.concat(navigator.languages); cands.push(navigator.language); } catch (e) { /* noop */ }
    let lang = 'en';
    for (let i = 0; i < cands.length; i++) { const b = baseOf(cands[i]); if (b && supported.indexOf(b) !== -1) { lang = b; break; } }
    const dict = MESSAGES[lang] || MESSAGES.en;
    const t = (k) => (Object.prototype.hasOwnProperty.call(dict, k) ? dict[k] : (MESSAGES.en[k] || k));
    t.lang = lang; t.dir = 'ltr';
    return t;
  }

  const DEFAULTS = {
    showAfter: 25,                 // % scrolled before the button appears
    position: 'bottom-right',      // bottom-right | bottom-left | bottom-center
    offset: 24,                    // px from the page edges
    shape: 'circle',               // circle | rounded | square
    size: 52,                      // px (button side)
    radius: 16,                    // px (rounded shape only)
    accent: '#0891B2',
    iconColor: '',                 // '' = auto-contrast from accent
    icon: 'chevron',               // chevron | arrow | double
    showLabel: false,
    labelText: '',                 // '' = localized default ("Top") for the viewer's language
    smoothScroll: true,
    shadow: true,
    theme: 'light',
    font: 'Inter',
    lang: '',                      // '' = auto-detect (page lang / browser); or force e.g. 'fr'
    ariaLabel: '',                 // '' = localized default ("Back to top")
    previewMode: false,            // editor-only: force visible, no scroll/scroll-action
  };

  function styles() {
    return `
      :host { all: initial; }
      *, *::before, *::after { box-sizing: border-box; }
      .tgbt-btn {
        position: fixed; z-index: 2147483600;
        display: inline-flex; align-items: center; justify-content: center; gap: 8px;
        border: 0; margin: 0; padding: 0; cursor: pointer;
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 13px; font-weight: 700; letter-spacing: .01em; line-height: 1;
        background: var(--tgbt-accent, #0891B2); color: var(--tgbt-ink, #fff);
        width: var(--tgbt-size, 52px); height: var(--tgbt-size, 52px);
        border-radius: var(--tgbt-bradius, 999px);
        box-shadow: var(--tgbt-shadow, 0 6px 20px rgba(15,23,42,.22));
        opacity: 0; visibility: hidden; pointer-events: none;
        transform: translateX(var(--tgbt-tx, 0)) translateY(12px) scale(.96);
        transition: opacity .22s ease, transform .22s cubic-bezier(.34,1.56,.64,1), box-shadow .18s ease, background .18s ease;
        -webkit-tap-highlight-color: transparent;
      }
      .tgbt-btn.has-label { width: auto; min-width: var(--tgbt-size, 52px); padding: 0 18px; border-radius: var(--tgbt-bradius, 999px); }
      .tgbt-btn.is-visible { opacity: 1; visibility: visible; pointer-events: auto; transform: translateX(var(--tgbt-tx, 0)) translateY(0) scale(1); }
      .tgbt-btn:hover { filter: brightness(1.05); box-shadow: var(--tgbt-shadow-hover, 0 10px 28px rgba(15,23,42,.3)); transform: translateX(var(--tgbt-tx, 0)) translateY(-2px) scale(1); }
      .tgbt-btn:active { transform: translateX(var(--tgbt-tx, 0)) translateY(0) scale(.97); }
      .tgbt-btn:focus-visible { outline: 3px solid var(--tgbt-accent, #0891B2); outline-offset: 3px; }
      .tgbt-btn svg { width: 44%; height: 44%; max-width: 26px; max-height: 26px; fill: none; stroke: currentColor; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; display: block; }
      .tgbt-btn.has-label svg { width: 18px; height: 18px; }
      .tgbt-label { white-space: nowrap; }

      /* Position */
      .pos-bottom-right { right: var(--tgbt-offset, 24px); bottom: var(--tgbt-offset, 24px); --tgbt-tx: 0; }
      .pos-bottom-left  { left:  var(--tgbt-offset, 24px); bottom: var(--tgbt-offset, 24px); --tgbt-tx: 0; }
      .pos-bottom-center{ left: 50%; bottom: var(--tgbt-offset, 24px); --tgbt-tx: -50%; }

      @media (prefers-reduced-motion: reduce) {
        .tgbt-btn { transition: opacity .15s linear; transform: translateX(var(--tgbt-tx,0)) translateY(0) scale(1); }
        .tgbt-btn.is-visible { transform: translateX(var(--tgbt-tx,0)) translateY(0) scale(1); }
        .tgbt-btn:hover, .tgbt-btn:active { transform: translateX(var(--tgbt-tx,0)) translateY(0) scale(1); }
      }
    `;
  }

  class TGBackToTopWidget {
    constructor(container, config) {
      this.el = container;
      this.cfg = Object.assign({}, DEFAULTS, config || {});
      this.shadow = container.shadowRoot || (container.attachShadow ? container.attachShadow({ mode: 'open' }) : container);
      this._onScroll = this._onScroll.bind(this);
      this._onClick = this._onClick.bind(this);
      this._ticking = false;
      this._build();
      if (this.cfg.previewMode) {
        this._setVisible(true);
      } else {
        window.addEventListener('scroll', this._onScroll, { passive: true });
        window.addEventListener('resize', this._onScroll, { passive: true });
        this._evaluate();
      }
    }

    _build() {
      const c = this.cfg;
      const t = makeT(c);                                  // resolve language + strings
      const labelText = String(c.labelText || '').trim() || t('top');
      const ariaLabel = String(c.ariaLabel || '').trim() || t('backToTop');
      const accent = safeColor(c.accent, '#0891B2');
      const ink = c.iconColor && safeColor(c.iconColor, '') ? safeColor(c.iconColor, '#fff') : inkFor(accent);
      const size = clampNum(c.size, 36, 80, 52);
      const offset = clampNum(c.offset, 0, 80, 24);
      const shape = ['circle', 'rounded', 'square'].includes(c.shape) ? c.shape : 'circle';
      const bradius = shape === 'circle' ? '999px' : (shape === 'square' ? '8px' : clampNum(c.radius, 0, 28, 16) + 'px');
      const pos = ['bottom-right', 'bottom-left', 'bottom-center'].includes(c.position) ? c.position : 'bottom-right';
      const icon = ICONS[c.icon] ? c.icon : 'chevron';
      const font = safeFont(c.font || c.fontFamily);
      const showLabel = !!c.showLabel && !!labelText;
      const shadow = c.shadow === false ? 'none' : '0 6px 20px rgba(15,23,42,.22)';
      const shadowHover = c.shadow === false ? 'none' : '0 10px 28px rgba(15,23,42,.3)';

      const vars = [
        `--tgbt-accent:${accent}`,
        `--tgbt-ink:${ink}`,
        `--tgbt-size:${size}px`,
        `--tgbt-offset:${offset}px`,
        `--tgbt-bradius:${bradius}`,
        `--tgbt-shadow:${shadow}`,
        `--tgbt-shadow-hover:${shadowHover}`,
        `font-family:'${font}', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`,
      ].join(';');

      const label = showLabel ? `<span class="tgbt-label">${esc(labelText)}</span>` : '';

      this.shadow.innerHTML = `<style>${styles()}</style>
        <button type="button" part="button"
          class="tgbt-btn pos-${pos}${showLabel ? ' has-label' : ''}"
          style="${vars}"
          aria-label="${esc(ariaLabel)}"
          title="${esc(ariaLabel)}"
          aria-hidden="true" tabindex="-1">
          <svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[icon]}</svg>${label}
        </button>`;

      this.btn = this.shadow.querySelector('.tgbt-btn');
      this.btn.addEventListener('click', this._onClick);
    }

    _scrolledPercent() {
      const d = document.documentElement;
      const st = window.scrollY || window.pageYOffset || d.scrollTop || 0;
      const max = (d.scrollHeight || 0) - (d.clientHeight || window.innerHeight || 0);
      if (max <= 0) return 0;
      return (st / max) * 100;
    }

    _onScroll() {
      if (this._ticking) return;
      this._ticking = true;
      window.requestAnimationFrame(() => { this._evaluate(); this._ticking = false; });
    }

    _evaluate() {
      const threshold = clampNum(this.cfg.showAfter, 1, 95, 25);
      this._setVisible(this._scrolledPercent() >= threshold);
    }

    _setVisible(on) {
      if (!this.btn) return;
      this.btn.classList.toggle('is-visible', on);
      this.btn.setAttribute('aria-hidden', on ? 'false' : 'true');
      this.btn.setAttribute('tabindex', on ? '0' : '-1');
    }

    _onClick(e) {
      e.preventDefault();
      if (this.cfg.previewMode) return;
      const smooth = this.cfg.smoothScroll !== false && !prefersReducedMotion();
      try { window.scrollTo({ top: 0, behavior: smooth ? 'smooth' : 'auto' }); }
      catch (err) { window.scrollTo(0, 0); }
    }

    update(newConfig) {
      this.cfg = Object.assign({}, this.cfg, newConfig || {});
      this.destroy(true);
      this._build();
      if (this.cfg.previewMode) {
        this._setVisible(true);
      } else {
        window.addEventListener('scroll', this._onScroll, { passive: true });
        window.addEventListener('resize', this._onScroll, { passive: true });
        this._evaluate();
      }
    }

    destroy(keepShadow) {
      window.removeEventListener('scroll', this._onScroll);
      window.removeEventListener('resize', this._onScroll);
      if (this.btn) { try { this.btn.removeEventListener('click', this._onClick); } catch (e) {} }
      if (!keepShadow && this.shadow) this.shadow.innerHTML = '';
    }
  }

  // ─── Boot ───────────────────────────────────────────────────
  async function fetchConfig(id) {
    try {
      const r = await fetch(API_BASE + '?id=' + encodeURIComponent(id), { method: 'GET', credentials: 'omit' });
      if (!r.ok) return null;
      const data = await r.json();
      return data && data.config ? data.config : null;
    } catch (e) { return null; }
  }
  async function init() {
    const containers = document.querySelectorAll('[data-tg-widget="backtotop"]');
    for (const el of containers) {
      if (el.__tgInited) continue;
      el.__tgInited = true;
      let cfg = null;
      const inline = el.getAttribute('data-tg-config');
      if (inline) { try { cfg = JSON.parse(inline); } catch (e) { cfg = null; } }
      else { const id = el.getAttribute('data-tg-id'); if (id) cfg = await fetchConfig(id); }
      try { new TGBackToTopWidget(el, cfg || {}); }
      catch (e) { if (window.console) console.error('[TGBackToTop] init failed', e); }
    }
  }

  window.TGBackToTopWidget = TGBackToTopWidget;
  window.__TG_BACKTOTOP_VERSION__ = VERSION;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
