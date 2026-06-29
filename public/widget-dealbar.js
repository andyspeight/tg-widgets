/**
 * Travelgenix Announcement / Deal Bar Widget v1.0.0
 * A slim sticky bar for promotions, late deals and announcements. Sits at the
 * top or bottom of the page, optionally with a live countdown and a call to
 * action. Self-contained, zero dependencies, Shadow DOM, accessible, CSP-clean.
 *
 * Usage (remote config):
 *   <div data-tg-widget="dealbar" data-tg-id="YOUR_WIDGET_ID"></div>
 *   <script src="https://tg-widgets.vercel.app/widget-dealbar.js"></script>
 *
 * Usage (inline config):
 *   <div data-tg-widget="dealbar" data-tg-config='{"message":"Late deals out now"}'></div>
 *   <script src="https://tg-widgets.vercel.app/widget-dealbar.js"></script>
 *
 * © Travelgenix. All rights reserved.
 */
(function () {
  'use strict';

  const VERSION = '1.0.1';

  // ─── i18n ───────────────────────────────────────────────────
  // Fixed UI chrome and localized defaults. The CTA label is author content and
  // is left untranslated here. English is the source + fallback.
  const MESSAGES = {
    en: { endsIn: 'Ends in', offerEnded: 'Offer ended', dismissAnnouncement: 'Dismiss announcement', siteAnnouncement: 'Site announcement' },
    fr: { endsIn: 'Se termine dans', offerEnded: 'Offre terminée', dismissAnnouncement: 'Fermer l\'annonce', siteAnnouncement: 'Annonce du site' },
    de: { endsIn: 'Endet in', offerEnded: 'Angebot beendet', dismissAnnouncement: 'Ankündigung schließen', siteAnnouncement: 'Website-Ankündigung' },
    es: { endsIn: 'Termina en', offerEnded: 'Oferta finalizada', dismissAnnouncement: 'Cerrar anuncio', siteAnnouncement: 'Anuncio del sitio' },
    it: { endsIn: 'Termina tra', offerEnded: 'Offerta terminata', dismissAnnouncement: 'Chiudi annuncio', siteAnnouncement: 'Annuncio del sito' },
    ro: { endsIn: 'Se termină în', offerEnded: 'Ofertă încheiată', dismissAnnouncement: 'Închide anunțul', siteAnnouncement: 'Anunț al site-ului' },
  };
  // Uses the shared TGi18n core when present; otherwise an identical inline resolver.
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

  function resolveBase(path, override) {
    if (typeof window === 'undefined') return path;
    if (override && window[override]) return window[override];
    try {
      const me = document.currentScript;
      if (me && me.src) return new URL(me.src).origin + path;
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
  function safeFont(f) { return (typeof f === 'string' && /^[\w \-]{1,40}$/.test(f.trim())) ? f.trim() : 'DM Sans'; }
  function clampNum(v, min, max, fb) { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fb; }
  // Only allow safe link schemes. Blocks javascript:, data:, etc. Relative and
  // anchor links pass through unchanged.
  function safeUrl(u) {
    const s = String(u == null ? '' : u).trim();
    if (!s) return '';
    if (/^(https?:|mailto:|tel:|\/|#|\.)/i.test(s)) {
      if (/^\s*javascript:/i.test(s)) return '';
      return s;
    }
    return '';
  }
  // Pick a legible ink for a given background (luminance test).
  function inkFor(hex) {
    let h = (hex || '#000').replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const r = parseInt(h.slice(0, 2), 16) / 255, g = parseInt(h.slice(2, 4), 16) / 255, b = parseInt(h.slice(4, 6), 16) / 255;
    const lin = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    return L > 0.5 ? '#0F172A' : '#FFFFFF';
  }
  // Tiny stable hash for the dismissal key when no widget id is present.
  function hashKey(str) {
    let h = 5381; const s = String(str || '');
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return 'tgdb_' + (h >>> 0).toString(36);
  }
  function parseDate(v) {
    if (!v) return null;
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }

  const DEFAULTS = {
    message: 'Late deals out now. Save up to 40% on selected summer breaks.',
    emoji: '',                         // optional leading glyph, e.g. ✈️
    position: 'top',                   // top | bottom
    sticky: true,                      // fixed to the viewport vs flows in place
    pushPage: true,                    // nudge the page so the bar never covers content
    bg: '#0F2742',
    textColor: '',                     // '' = auto-contrast from bg
    // Call to action
    ctaShow: true,
    ctaLabel: 'See the deals',
    ctaUrl: '#',
    ctaNewTab: true,
    ctaBg: '#F59E0B',
    ctaText: '',                       // '' = auto-contrast from ctaBg
    // Dismiss
    dismissible: true,
    rememberDismiss: true,             // remember the close in localStorage
    // Countdown
    showCountdown: false,
    countdownTo: '',                   // ISO datetime, e.g. 2026-07-31T23:59:00
    countdownLabel: '',                // '' = localized "Ends in"
    hideOnExpire: false,
    expiredText: '',                   // '' = localized "Offer ended"
    // Scheduling window (the bar only shows inside it)
    startAt: '',
    endAt: '',
    font: 'DM Sans',
    previewMode: false,                // editor-only: always visible, no dismiss/schedule
  };

  function styles() {
    return `
      :host { all: initial; }
      *, *::before, *::after { box-sizing: border-box; }
      .tgdb {
        position: fixed; left: 0; right: 0; z-index: 2147483601;
        display: flex; align-items: center; justify-content: center; gap: 14px;
        padding: 10px 18px; min-height: 44px;
        font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 14px; line-height: 1.35;
        background: var(--tgdb-bg, #0F2742); color: var(--tgdb-ink, #fff);
        box-shadow: 0 2px 14px rgba(15,23,42,.18);
        transform: translateY(var(--tgdb-hide, 0));
        transition: transform .32s cubic-bezier(.4,0,.2,1);
      }
      .tgdb.pos-top { top: 0; --tgdb-hide: -110%; }
      .tgdb.pos-bottom { bottom: 0; box-shadow: 0 -2px 14px rgba(15,23,42,.18); --tgdb-hide: 110%; }
      .tgdb.is-static { position: static; transform: none; }
      .tgdb.is-in { transform: translateY(0); }
      .tgdb-inner { display: flex; align-items: center; justify-content: center; gap: 14px 18px; flex-wrap: wrap; max-width: 1180px; }
      .tgdb-msg { font-weight: 600; letter-spacing: .005em; }
      .tgdb-emoji { margin-right: 7px; }
      .tgdb-cd { display: inline-flex; align-items: center; gap: 8px; font-weight: 600; white-space: nowrap; }
      .tgdb-cd-label { opacity: .82; font-weight: 500; }
      .tgdb-cd-clock { display: inline-flex; gap: 5px; font-variant-numeric: tabular-nums; }
      .tgdb-cd-cell { display: inline-flex; flex-direction: column; align-items: center; min-width: 30px;
        background: rgba(255,255,255,.14); border-radius: 7px; padding: 3px 6px 4px; }
      .tgdb-cd-num { font-size: 14px; font-weight: 700; line-height: 1; }
      .tgdb-cd-unit { font-size: 8.5px; text-transform: uppercase; letter-spacing: .06em; opacity: .75; margin-top: 2px; }
      .tgdb-cta {
        display: inline-flex; align-items: center; gap: 7px; flex-shrink: 0;
        padding: 8px 16px; border-radius: 999px; cursor: pointer; text-decoration: none;
        font-weight: 700; font-size: 13px; letter-spacing: .01em;
        background: var(--tgdb-cta-bg, #F59E0B); color: var(--tgdb-cta-ink, #0F172A);
        transition: filter .16s ease, transform .16s ease;
      }
      .tgdb-cta:hover { filter: brightness(1.05); transform: translateY(-1px); }
      .tgdb-cta:active { transform: translateY(0); }
      .tgdb-cta svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
      .tgdb-close {
        position: absolute; right: 10px; top: 50%; transform: translateY(-50%);
        width: 30px; height: 30px; display: inline-flex; align-items: center; justify-content: center;
        border: 0; background: transparent; color: inherit; cursor: pointer; border-radius: 8px;
        opacity: .7; transition: opacity .16s ease, background .16s ease;
      }
      .tgdb-close:hover { opacity: 1; background: rgba(255,255,255,.14); }
      .tgdb-close:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
      .tgdb-close svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
      .tgdb.is-static .tgdb-close { position: static; transform: none; margin-left: 4px; }
      @media (max-width: 560px) {
        .tgdb { padding: 9px 40px 9px 14px; font-size: 13px; }
        .tgdb-inner { gap: 8px 12px; }
        .tgdb-cd-cell { min-width: 26px; }
      }
      @media (prefers-reduced-motion: reduce) {
        .tgdb { transition: none; }
      }
    `;
  }

  class TGDealBarWidget {
    constructor(container, config) {
      this.el = container;
      this.cfg = Object.assign({}, DEFAULTS, config || {});
      this.t = makeT(this.cfg);   // resolve viewer language + UI strings
      this.shadow = container.shadowRoot || (container.attachShadow ? container.attachShadow({ mode: 'open' }) : container);
      this._onResize = this._onResize.bind(this);
      this._tick = this._tick.bind(this);
      this._timer = null;
      this._pushedProp = null;   // remembers which body margin we adjusted
      this._prevMargin = '';
      this._dismissed = false;
      this._boot();
    }

    _storageKey() {
      const id = this.el.getAttribute && this.el.getAttribute('data-tg-id');
      return id ? 'tgdb_' + id : hashKey(this.cfg.message + '|' + this.cfg.ctaUrl);
    }

    _boot() {
      const c = this.cfg;
      if (!c.previewMode) {
        // Scheduling window
        const now = Date.now();
        const start = parseDate(c.startAt), end = parseDate(c.endAt);
        if (start && now < start) return;
        if (end && now > end) return;
        // Remembered dismissal
        if (c.dismissible && c.rememberDismiss) {
          try { if (localStorage.getItem(this._storageKey()) === '1') return; } catch (e) { /* noop */ }
        }
        // Countdown already expired and set to hide
        const cdTo = c.showCountdown ? parseDate(c.countdownTo) : null;
        if (cdTo && now >= cdTo && c.hideOnExpire) return;
      }
      this._build();
    }

    _build() {
      const c = this.cfg;
      const bg = safeColor(c.bg, '#0F2742');
      const ink = c.textColor && safeColor(c.textColor, '') ? safeColor(c.textColor, '#fff') : inkFor(bg);
      const ctaBg = safeColor(c.ctaBg, '#F59E0B');
      const ctaInk = c.ctaText && safeColor(c.ctaText, '') ? safeColor(c.ctaText, '#0F172A') : inkFor(ctaBg);
      const font = safeFont(c.font || c.fontFamily);
      const pos = c.position === 'bottom' ? 'bottom' : 'top';
      const sticky = c.sticky !== false;

      const vars = [
        `--tgdb-bg:${bg}`,
        `--tgdb-ink:${ink}`,
        `--tgdb-cta-bg:${ctaBg}`,
        `--tgdb-cta-ink:${ctaInk}`,
        `font-family:'${font}', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`,
      ].join(';');

      const emoji = String(c.emoji || '').trim();
      const emojiHtml = emoji ? `<span class="tgdb-emoji" aria-hidden="true">${esc(emoji.slice(0, 4))}</span>` : '';
      const msgHtml = `<span class="tgdb-msg">${emojiHtml}${esc(c.message)}</span>`;

      // Countdown
      let cdHtml = '';
      this._cdTo = c.showCountdown ? parseDate(c.countdownTo) : null;
      if (this._cdTo) {
        cdHtml = `<span class="tgdb-cd" role="timer" aria-live="off">
          <span class="tgdb-cd-label">${esc(c.countdownLabel || this.t('endsIn'))}</span>
          <span class="tgdb-cd-clock" id="tgdb-clock"></span>
        </span>`;
      }

      // CTA
      let ctaHtml = '';
      const ctaUrl = safeUrl(c.ctaUrl);
      if (c.ctaShow && String(c.ctaLabel || '').trim() && ctaUrl) {
        const tgt = c.ctaNewTab ? ' target="_blank" rel="noopener"' : '';
        ctaHtml = `<a class="tgdb-cta" href="${esc(ctaUrl)}"${tgt}>${esc(c.ctaLabel)}<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg></a>`;
      }

      const closeHtml = c.dismissible
        ? `<button class="tgdb-close" type="button" id="tgdb-close" aria-label="${esc(this.t('dismissAnnouncement'))}"><svg viewBox="0 0 24 24" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`
        : '';

      this.shadow.innerHTML = `<style>${styles()}</style>
        <aside class="tgdb pos-${pos}${sticky ? '' : ' is-static'}" role="region" aria-label="${esc(this.t('siteAnnouncement'))}" style="${vars}">
          <div class="tgdb-inner">${msgHtml}${cdHtml}${ctaHtml}</div>
          ${closeHtml}
        </aside>`;

      this.bar = this.shadow.querySelector('.tgdb');
      this.clock = this.shadow.getElementById('tgdb-clock');

      const closeBtn = this.shadow.getElementById('tgdb-close');
      if (closeBtn) closeBtn.addEventListener('click', () => this.dismiss());

      // Slide in
      requestAnimationFrame(() => { if (this.bar) this.bar.classList.add('is-in'); });

      // Push the page so a sticky bar never covers content
      if (sticky && c.pushPage && !c.previewMode) {
        this._pushPage(pos);
        window.addEventListener('resize', this._onResize, { passive: true });
      }

      // Countdown loop
      if (this._cdTo) { this._renderClock(); this._timer = setInterval(this._tick, 1000); }
    }

    _pushPage(pos) {
      try {
        const h = (this.bar && this.bar.offsetHeight) || 44;
        this._pushedProp = pos === 'bottom' ? 'marginBottom' : 'marginTop';
        this._prevMargin = document.body.style[this._pushedProp] || '';
        document.body.style[this._pushedProp] = h + 'px';
      } catch (e) { /* noop */ }
    }

    _onResize() {
      if (!this._pushedProp || !this.bar) return;
      try { document.body.style[this._pushedProp] = this.bar.offsetHeight + 'px'; } catch (e) { /* noop */ }
    }

    _renderClock() {
      if (!this.clock) return;
      const c = this.cfg;
      let diff = this._cdTo - Date.now();
      if (diff <= 0) {
        if (c.hideOnExpire) { this.dismiss(true); return; }
        this.clock.innerHTML = `<span class="tgdb-cd-num">${esc(c.expiredText || this.t('offerEnded'))}</span>`;
        if (this._timer) { clearInterval(this._timer); this._timer = null; }
        return;
      }
      const s = Math.floor(diff / 1000);
      const days = Math.floor(s / 86400);
      const hours = Math.floor((s % 86400) / 3600);
      const mins = Math.floor((s % 3600) / 60);
      const secs = s % 60;
      const cell = (n, u) => `<span class="tgdb-cd-cell"><span class="tgdb-cd-num">${String(n).padStart(2, '0')}</span><span class="tgdb-cd-unit">${u}</span></span>`;
      const parts = [];
      if (days > 0) parts.push(cell(days, 'days'));
      parts.push(cell(hours, 'hrs'), cell(mins, 'min'), cell(secs, 'sec'));
      this.clock.innerHTML = parts.join('');
    }

    _tick() { this._renderClock(); }

    dismiss(silent) {
      if (this._dismissed) return;
      this._dismissed = true;
      if (this.bar) this.bar.classList.remove('is-in');
      if (!silent && this.cfg.dismissible && this.cfg.rememberDismiss && !this.cfg.previewMode) {
        try { localStorage.setItem(this._storageKey(), '1'); } catch (e) { /* noop */ }
      }
      // Release the page push once the slide-out finishes
      const restore = () => {
        if (this._pushedProp) { try { document.body.style[this._pushedProp] = this._prevMargin; } catch (e) {} this._pushedProp = null; }
      };
      if (this._pushedProp) setTimeout(restore, 340);
      if (this._timer) { clearInterval(this._timer); this._timer = null; }
    }

    update(newConfig) {
      this.cfg = Object.assign({}, this.cfg, newConfig || {});
      this.t = makeT(this.cfg);
      this.destroy(true);
      this._dismissed = false;
      this._boot();
    }

    destroy(keepShadow) {
      if (this._timer) { clearInterval(this._timer); this._timer = null; }
      window.removeEventListener('resize', this._onResize);
      if (this._pushedProp) { try { document.body.style[this._pushedProp] = this._prevMargin; } catch (e) {} this._pushedProp = null; }
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
    const containers = document.querySelectorAll('[data-tg-widget="dealbar"]');
    for (const el of containers) {
      if (el.__tgInited) continue;
      el.__tgInited = true;
      let cfg = null;
      const inline = el.getAttribute('data-tg-config');
      if (inline) { try { cfg = JSON.parse(inline); } catch (e) { cfg = null; } }
      else { const id = el.getAttribute('data-tg-id'); if (id) cfg = await fetchConfig(id); }
      try { new TGDealBarWidget(el, cfg || {}); }
      catch (e) { if (window.console) console.error('[TGDealBar] init failed', e); }
    }
  }

  window.TGDealBarWidget = TGDealBarWidget;
  window.__TG_DEALBAR_VERSION__ = VERSION;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
