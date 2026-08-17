/* ============================================================================
 * widget-offers-grid.js  ·  Travelgenix Widget Suite
 * Special Offers Grid — embeds a client's live hand-built offers (v0.1.0)
 *
 * Fetches a client's live offers from /api/saved-offers?client=<id> and renders
 * them as a grid of offer cards (reusing widget-offer-card.js). Each card links
 * to that offer's page (/offer?id=…), carrying the chosen page template + brand.
 * Scheduling is respected twice over: the public feed only returns live offers,
 * and each card re-checks its own window and self-hides as a backstop.
 *
 * Embed:
 *   <div data-tg-widget="offers-grid"
 *        data-tg-config='{"client":"CLIENT_ID","layout":"vertical","columns":"auto",
 *                         "template":"classic","theme":"light","accent":"#00B4D8"}'></div>
 *   <script src="https://tg-widgets.vercel.app/widget-offers-grid.js"></script>
 *
 * Preview/demo: pass an inline `offers` array in the config to skip the fetch.
 * ========================================================================== */
(function () {
  'use strict';

  const VERSION = '0.1.4';

  // ─── i18n ───────────────────────────────────────────────────
  // Fixed UI chrome only (the empty-state line and the default card CTA). The
  // author's offer data — titles, destinations, hotel names, prices, dates — is
  // never translated, nor are brand names or ATOL/ABTA wording. English is the
  // source + fallback.
  const MESSAGES = {
    en: { viewDeal: 'View deal', empty: 'No offers available right now.' },
    fr: { viewDeal: "Voir l'offre", empty: 'Aucune offre disponible pour le moment.' },
    de: { viewDeal: 'Angebot ansehen', empty: 'Derzeit keine Angebote verfügbar.' },
    es: { viewDeal: 'Ver oferta', empty: 'No hay ofertas disponibles ahora mismo.' },
    it: { viewDeal: 'Vedi offerta', empty: 'Nessuna offerta disponibile al momento.' },
    ro: { viewDeal: 'Vezi oferta', empty: 'Nicio ofertă disponibilă momentan.' },
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

  // Base URL this script was served from, to load the card widget + build links.
  // The widget runs on customer sites, so document.currentScript can be null when
  // the tag is injected async — fall back to scanning for our own script tag, then
  // this page's origin, so we never leave a bare '/' that would resolve to the
  // customer's own origin (and 404 the offers feed).
  const SCRIPT_BASE = (function () {
    try { const s = document.currentScript && document.currentScript.src; if (s) return s.replace(/[^/]+$/, ''); } catch (e) {}
    try {
      const scripts = document.getElementsByTagName('script');
      for (let i = scripts.length - 1; i >= 0; i--) {
        const s = scripts[i].src || '';
        if (/\/widget-offers-grid\.js(\?|#|$)/.test(s)) return s.replace(/[^/]+$/, '');
      }
    } catch (e) {}
    try { if (typeof window !== 'undefined' && window.location && window.location.origin) return window.location.origin + '/'; } catch (e) {}
    return '/';
  })();

  // API base for the offers feed. Honours an explicit opt-in override first, then
  // the script's own origin — never a relative '/api', which on a customer site
  // targets the customer origin and 404s.
  function resolveApiBase() {
    // __TG_WIDGET_API__ is the full config URL (…/api/widget-config); this base
    // is joined with 'api/saved-offers', so take its ORIGIN, not the raw value,
    // or the path would double-nest (…/api/widget-config/api/saved-offers).
    try { if (typeof window !== 'undefined' && window.__TG_WIDGET_API__) return new URL(window.__TG_WIDGET_API__).origin + '/'; } catch (e) {}
    return SCRIPT_BASE;
  }

  let _cardPromise = null;
  function ensureCard() {
    if (typeof window !== 'undefined' && window.TGOfferCardWidget) return Promise.resolve();
    if (_cardPromise) return _cardPromise;
    _cardPromise = new Promise(function (resolve, reject) {
      const s = document.createElement('script');
      s.src = SCRIPT_BASE + 'widget-offer-card.js';
      s.async = true;
      s.onload = resolve;
      s.onerror = function () { reject(new Error('card-load-failed')); };
      document.head.appendChild(s);
    });
    return _cardPromise;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  const STYLES = `
    :host { all: initial; display: block; }
    * { box-sizing: border-box; }
    .tgog {
      --tgog-text: #0F172A; --tgog-sub: #64748B; --tgog-muted: #94A3B8; --tgog-border: #E2E8F0;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      color: var(--tgog-text); width: 100%;
    }
    .tgog[data-theme="dark"] { --tgog-text: #F1F5F9; --tgog-sub: #94A3B8; --tgog-border: #334155; }
    .tgog-head { margin: 0 0 18px; }
    .tgog-title { font-size: 24px; font-weight: 800; letter-spacing: -0.4px; margin: 0; }
    .tgog-sub { font-size: 14px; color: var(--tgog-sub); margin: 4px 0 0; }

    /* Vertical cards → responsive grid. Other layouts → full-width stack. */
    .tgog-items { display: grid; gap: 20px; }
    .tgog-items.grid { grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); }
    .tgog-items.grid.cols-2 { grid-template-columns: repeat(2, 1fr); }
    .tgog-items.grid.cols-3 { grid-template-columns: repeat(3, 1fr); }
    .tgog-items.grid.cols-4 { grid-template-columns: repeat(4, 1fr); }
    .tgog-items.stack { grid-template-columns: 1fr; }
    @media (max-width: 720px) { .tgog-items.grid, .tgog-items.grid.cols-2, .tgog-items.grid.cols-3, .tgog-items.grid.cols-4 { grid-template-columns: 1fr; } }

    /* Loading skeletons */
    .tgog-skel { border: 1px solid var(--tgog-border); border-radius: 14px; overflow: hidden; }
    .tgog-skel .img { aspect-ratio: 16/10; background: linear-gradient(90deg, #eef2f7 0%, #e2e8f0 50%, #eef2f7 100%); background-size: 200% 100%; animation: tgog-sh 1.4s ease-in-out infinite; }
    .tgog[data-theme="dark"] .tgog-skel .img { background: linear-gradient(90deg, #1e293b 0%, #334155 50%, #1e293b 100%); background-size: 200% 100%; }
    .tgog-skel .line { height: 12px; margin: 12px 14px; border-radius: 6px; background: var(--tgog-border); }
    .tgog-skel .line.s { width: 50%; }
    @keyframes tgog-sh { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
    @media (prefers-reduced-motion: reduce) { .tgog-skel .img { animation: none; } }

    .tgog-empty { text-align: center; padding: 40px 20px; color: var(--tgog-muted); border: 1px dashed var(--tgog-border); border-radius: 14px; font-size: 14px; }
  `;

  function liveLocally(offer) {
    const f = (offer && offer.fields) || offer || {};
    const day = function (s) {
      if (!s) return null;
      const m = String(s).match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
      if (m) return new Date(+m[1], +m[2] - 1, +m[3]).getTime();
      const t = Date.parse(s); return isFinite(t) ? new Date(t).setHours(0, 0, 0, 0) : null;
    };
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const from = day(f.showFrom), until = day(f.showUntil);
    if (from !== null && today < from) return false;
    if (until !== null && today > until) return false;
    return true;
  }

  class TGOffersGridWidget {
    constructor(container, config) {
      this.el = container;
      container._tgInitialised = true;
      this.t = makeT(config);   // resolve viewer language + UI strings
      this.cfg = this._defaults(config);
      this.shadow = container.attachShadow({ mode: 'open' });
      this._render(this.cfg.offers ? 'ready' : 'loading');
      if (this.cfg.offers) this._fill(this.cfg.offers);
      else this._load();
    }

    _defaults(c) {
      c = c || {};
      const layouts = ['vertical', 'horizontal', 'banner', 'split', 'cruise'];
      return {
        client: c.client || '',
        layout: layouts.indexOf(c.layout) !== -1 ? c.layout : 'vertical',
        // Whitelist to the CSS's known column tokens — this value is concatenated
        // into a class attribute (cols-<n>), so an unvalidated string is an
        // innerHTML injection vector.
        columns: ['2', '3', '4'].indexOf(String(c.columns)) !== -1 ? String(c.columns) : 'auto',
        template: c.template || 'classic',
        theme: c.theme === 'dark' ? 'dark' : 'light',
        accentColor: c.accentColor || c.accent || '',
        brandColor: c.brandColor || c.brand || '',
        radius: typeof c.radius === 'number' ? c.radius : 14,
        currency: c.currency || 'GBP',
        heading: c.heading || '',
        subheading: c.subheading || '',
        max: typeof c.max === 'number' ? c.max : 0,
        emptyText: c.emptyText || this.t('empty'),
        offerPage: c.offerPage || '',           // override the offer-page base if needed
        ctaText: c.ctaText || this.t('viewDeal'),
        offers: Array.isArray(c.offers) ? c.offers : null   // inline (demo/preview)
      };
    }

    // Where each card links — carries the page template + brand as query params,
    // so the card appends &id=<offerId>.
    _offerPageBase() {
      if (this.cfg.offerPage) return this.cfg.offerPage;
      let base = SCRIPT_BASE + 'offer';
      const q = [];
      if (this.cfg.template && this.cfg.template !== 'classic') q.push('template=' + encodeURIComponent(this.cfg.template));
      if (this.cfg.theme === 'dark') q.push('theme=dark');
      if (this.cfg.accentColor) q.push('accent=' + encodeURIComponent(this.cfg.accentColor));
      // Carry the feed key so the offer page can show a few of the client's other
      // offers (the cruise template's "More deals" strip). Public feed key.
      if (this.cfg.client) q.push('client=' + encodeURIComponent(this.cfg.client));
      return q.length ? base + '?' + q.join('&') : base;
    }

    _render(state) {
      const cfg = this.cfg;
      const root = document.createElement('div');
      root.className = 'tgog';
      root.setAttribute('data-theme', cfg.theme);

      const head = (cfg.heading || cfg.subheading)
        ? '<div class="tgog-head">' + (cfg.heading ? '<h2 class="tgog-title">' + esc(cfg.heading) + '</h2>' : '')
          + (cfg.subheading ? '<p class="tgog-sub">' + esc(cfg.subheading) + '</p>' : '') + '</div>'
        : '';

      const gridCls = cfg.layout === 'vertical'
        ? 'grid' + (cfg.columns !== 'auto' ? ' cols-' + cfg.columns : '')
        : 'stack';

      let body;
      if (state === 'loading') {
        body = '<div class="tgog-items ' + gridCls + '">'
          + new Array(cfg.layout === 'vertical' ? 6 : 3).fill(0).map(function () {
              return '<div class="tgog-skel"><div class="img"></div><div class="line"></div><div class="line s"></div></div>';
            }).join('')
          + '</div>';
      } else if (state === 'empty') {
        body = '<div class="tgog-empty">' + esc(cfg.emptyText) + '</div>';
      } else {
        body = '<div class="tgog-items ' + gridCls + '" data-items></div>';
      }

      root.innerHTML = head + body;
      this.shadow.innerHTML = '<style>' + STYLES + '</style>';
      this.shadow.appendChild(root);
      this.root = root;
    }

    _load() {
      const cfg = this.cfg;
      if (!cfg.client) { this._render('empty'); return; }
      const url = resolveApiBase() + 'api/saved-offers?client=' + encodeURIComponent(cfg.client);
      fetch(url)
        .then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
        .then((d) => this._fill((d && d.offers) || []))
        .catch(() => this._render('empty'));
    }

    _fill(list) {
      // Keep only live offers (the feed already filters; this guards inline data).
      let items = (list || []).filter((it) => liveLocally(it.offer || it));
      if (this.cfg.max > 0) items = items.slice(0, this.cfg.max);
      if (!items.length) { this._render('empty'); return; }

      this._render('ready');
      const holder = this.root.querySelector('[data-items]');
      const cfg = this.cfg;
      const pageBase = this._offerPageBase();

      ensureCard().then(() => {
        items.forEach((it) => {
          const offer = it.offer || it;
          const id = it.id || (offer && offer.id) || '';
          const cell = document.createElement('div');
          holder.appendChild(cell);
          new window.TGOfferCardWidget(cell, {
            lang: this.t.lang,   // forward the resolved viewer language so the card overlays offer.i18n for the same language
            // Cruise is one design: a cruise page template implies cruise cards,
            // so the two never drift apart even on a hand-written embed.
            layout: cfg.template === 'cruise' ? 'cruise' : cfg.layout,
            theme: cfg.theme,
            accentColor: cfg.accentColor,
            brandColor: cfg.brandColor,
            radius: cfg.radius,
            currency: cfg.currency || (offer && offer.currency) || 'GBP',
            ctaText: cfg.ctaText,
            offerPage: pageBase,
            offerId: id,
            offer: offer
          });
        });
      }).catch(() => { /* card script failed to load — leave skeletons cleared */ this._render('empty'); });
    }
  }

  // ── Auto-init ───────────────────────────────────────────────────────────────
  function init() {
    const containers = document.querySelectorAll('[data-tg-widget="offers-grid"]');
    for (const el of containers) {
      if (el._tgInitialised || el.shadowRoot) continue;
      el._tgInitialised = true;

      // Inline config wins and skips the network (preview/demo, and hand-written
      // embeds that already carry their own `client` feed key).
      const inline = el.getAttribute('data-tg-config');
      if (inline) {
        let config = {};
        try { config = JSON.parse(inline); } catch (e) { console.error('[TGOffersGrid] Invalid inline config:', e); continue; }
        new TGOffersGridWidget(el, config);
        continue;
      }

      // Standard embed: fetch this widget's saved config by id. The API injects
      // the `client` feed key for Special Offers, which the grid needs to load
      // the client's offers. Without this, the data-tg-id embed the dashboard
      // generates mounted with an EMPTY config and bailed straight to the
      // "no offers" state — the config was never fetched at all.
      const id = el.getAttribute('data-tg-id');
      if (id) {
        fetch(resolveApiBase() + 'api/widget-config?id=' + encodeURIComponent(id))
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => { new TGOffersGridWidget(el, (d && (d.config || d)) || {}); })
          .catch(() => { new TGOffersGridWidget(el, {}); });
        continue;
      }

      // Neither inline config nor an id — nothing to render from.
      new TGOffersGridWidget(el, {});
    }
  }

  if (typeof window !== 'undefined') {
    window.TGOffersGridWidget = TGOffersGridWidget;
    window.TGOffersGridWidget.version = VERSION;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }
})();
