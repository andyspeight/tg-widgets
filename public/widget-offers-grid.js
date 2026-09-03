/* ============================================================================
 * widget-offers-grid.js  ·  Travelgenix Widget Suite
 * Special Offers Grid — embeds a client's live hand-built offers (v0.3.0)
 *
 * Fetches a client's live offers from /api/saved-offers?client=<id> and renders
 * them as a grid of offer cards (reusing widget-offer-card.js). Each card links
 * to that offer's page (/offer?id=…), carrying the chosen page template + brand.
 * Scheduling is respected twice over: the public feed only returns live offers,
 * and each card re-checks its own window and self-hides as a backstop.
 *
 * Display: `display:"carousel"` lays the same cards on a horizontal scroll-snap
 * track (arrows, dots, swipe, optional autoplay) so any number of offers takes
 * one card of page height. `filterType` / `filterTags` show only offers of one
 * type or carrying a tag — several typed embeds can share one offer pool.
 *
 * Embed:
 *   <div data-tg-widget="offers-grid"
 *        data-tg-config='{"client":"CLIENT_ID","layout":"vertical","columns":"auto",
 *                         "template":"classic","theme":"light","accent":"#00B4D8",
 *                         "display":"carousel","filterType":"Cruise"}'></div>
 *   <script src="https://tg-widgets.vercel.app/widget-offers-grid.js"></script>
 *
 * Preview/demo: pass an inline `offers` array in the config to skip the fetch.
 * ========================================================================== */
(function () {
  'use strict';

  const VERSION = '0.3.0';

  // ─── i18n ───────────────────────────────────────────────────
  // Fixed UI chrome only (the empty-state line and the default card CTA). The
  // author's offer data — titles, destinations, hotel names, prices, dates — is
  // never translated, nor are brand names or ATOL/ABTA wording. English is the
  // source + fallback.
  const MESSAGES = {
    en: { viewDeal: 'View deal', empty: 'No offers available right now.', offersLabel: 'Special offers', prevOffers: 'Previous offers', nextOffers: 'More offers', carouselPages: 'Carousel pages', pageOf: 'Page {n} of {total}' },
    fr: { viewDeal: "Voir l'offre", empty: 'Aucune offre disponible pour le moment.', offersLabel: 'Offres spéciales', prevOffers: 'Offres précédentes', nextOffers: "Plus d'offres", carouselPages: 'Pages du carrousel', pageOf: 'Page {n} sur {total}' },
    de: { viewDeal: 'Angebot ansehen', empty: 'Derzeit keine Angebote verfügbar.', offersLabel: 'Sonderangebote', prevOffers: 'Vorherige Angebote', nextOffers: 'Weitere Angebote', carouselPages: 'Karussell-Seiten', pageOf: 'Seite {n} von {total}' },
    es: { viewDeal: 'Ver oferta', empty: 'No hay ofertas disponibles ahora mismo.', offersLabel: 'Ofertas especiales', prevOffers: 'Ofertas anteriores', nextOffers: 'Más ofertas', carouselPages: 'Páginas del carrusel', pageOf: 'Página {n} de {total}' },
    it: { viewDeal: 'Vedi offerta', empty: 'Nessuna offerta disponibile al momento.', offersLabel: 'Offerte speciali', prevOffers: 'Offerte precedenti', nextOffers: 'Altre offerte', carouselPages: 'Pagine del carosello', pageOf: 'Pagina {n} di {total}' },
    ro: { viewDeal: 'Vezi oferta', empty: 'Nicio ofertă disponibilă momentan.', offersLabel: 'Oferte speciale', prevOffers: 'Oferte anterioare', nextOffers: 'Mai multe oferte', carouselPages: 'Pagini carusel', pageOf: 'Pagina {n} din {total}' },
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
    /* auto-fit (not auto-fill) collapses the empty phantom columns that left a
       short row of cards packed to the left on a wide page; the 380px cap
       matches the card's own max-width so tracks never stretch past a card, and
       justify-content centres the row as a group. Explicit cols-N below still
       fill the width. */
    .tgog-items.grid { grid-template-columns: repeat(auto-fit, minmax(300px, 380px)); justify-content: center; }
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

    /* ===== Carousel display =====
       The same offer cards on a horizontal scroll-snap track, so any number of
       live offers takes one card of page height. JS sets explicit pixel widths
       per card from the measured container (percentage flex-basis misbehaves
       inside overflow-x tracks whose parents have no width constraint); the
       flex-basis below is only the no-JS fallback. */
    .tgog-car { position: relative; padding: 0 44px; width: 100%; max-width: 100%; min-width: 0; }
    @media (max-width: 640px) { .tgog-car { padding: 0; } }
    .tgog-car-track {
      display: flex; gap: 16px;
      overflow-x: auto; overflow-y: hidden;
      scroll-snap-type: x mandatory; scroll-behavior: smooth;
      scrollbar-width: none; -ms-overflow-style: none;
      padding: 4px 0 12px;
      width: 100%; min-width: 0;
    }
    .tgog-car-track::-webkit-scrollbar { display: none; }
    .tgog-car-track > div { flex: 0 0 320px; min-width: 0; max-width: 100%; scroll-snap-align: start; scroll-snap-stop: always; }
    @media (max-width: 640px) { .tgog-car-track { padding-left: 16px; padding-right: 16px; gap: 12px; } }
    .tgog-car-arrow {
      position: absolute; top: 50%; transform: translateY(-50%);
      width: 40px; height: 40px; border-radius: 999px;
      border: 1px solid var(--tgog-border); background: #FFFFFF; color: var(--tgog-text);
      display: flex; align-items: center; justify-content: center;
      cursor: pointer; z-index: 2; box-shadow: 0 4px 12px rgba(15, 23, 42, 0.10);
      transition: transform 0.12s ease, opacity 0.2s ease;
    }
    .tgog[data-theme="dark"] .tgog-car-arrow { background: #1E293B; }
    .tgog-car-arrow:hover:not([aria-disabled="true"]) { transform: translateY(-50%) scale(1.06); }
    .tgog-car-arrow:focus-visible { outline: 2px solid var(--tgog-accent, #00B4D8); outline-offset: 2px; }
    /* aria-disabled, not disabled: a native disabled attribute would throw a
       keyboard user's focus to the page body the moment the arrow they are on
       reaches the end of the track. */
    .tgog-car-arrow[aria-disabled="true"] { opacity: 0.35; cursor: not-allowed; }
    .tgog-car-arrow svg { width: 18px; height: 18px; }
    .tgog-car-arrow[data-dir="prev"] { left: 0; }
    .tgog-car-arrow[data-dir="next"] { right: 0; }
    @media (max-width: 640px) { .tgog-car-arrow { display: none; } }
    .tgog-car-dots { display: flex; justify-content: center; gap: 6px; margin: 14px 0 0; padding: 0; list-style: none; }
    .tgog-car-dot { width: 8px; height: 8px; border-radius: 999px; border: 0; padding: 0; background: var(--tgog-border); cursor: pointer; transition: background 0.18s ease, width 0.2s ease; }
    .tgog-car-dot:hover { background: var(--tgog-sub); }
    .tgog-car-dot[aria-current="true"] { background: var(--tgog-accent, #00B4D8); width: 22px; }
    .tgog-car-dot:focus-visible { outline: 2px solid var(--tgog-accent, #00B4D8); outline-offset: 2px; }
    @media (prefers-reduced-motion: reduce) {
      .tgog-car-track { scroll-behavior: auto; }
      .tgog-car-arrow { transition: none; }
      .tgog-car-arrow:hover:not([aria-disabled="true"]) { transform: translateY(-50%); }
      .tgog-car-dot { transition: none; }
    }
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

  // Optional display filter: show only offers of one type (the builder's fixed
  // "Offer type" select, matched case-insensitively) and/or carrying at least
  // one of the given tags. This is what lets one offer pool feed several typed
  // embeds — a Cruise carousel on the cruise page, a Ski one on the ski page.
  // cfg.filterType and cfg.filterTags arrive pre-lowercased from _defaults.
  function matchesFilter(item, cfg) {
    const offer = (item && item.offer) || item || {};
    const f = offer.fields || offer || {};
    if (cfg.filterType) {
      if (String(f.type || '').trim().toLowerCase() !== cfg.filterType) return false;
    }
    if (cfg.filterTags.length) {
      const tags = Array.isArray(offer.tags) ? offer.tags : [];
      let hit = false;
      for (let i = 0; i < tags.length && !hit; i++) {
        hit = cfg.filterTags.indexOf(String(tags[i]).trim().toLowerCase()) !== -1;
      }
      if (!hit) return false;
    }
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
        // Display axis (independent of the card `layout`): 'grid' keeps the
        // classic arrangement; 'carousel' puts the same cards on a horizontal
        // scroll-snap track. Whitelisted — anything else falls back to grid.
        display: c.display === 'carousel' ? 'carousel' : 'grid',
        // Show only offers of one builder type and/or carrying one of these
        // tags. Normalised to lower case here so matching is one comparison.
        filterType: String(c.filterType || '').trim().toLowerCase(),
        filterTags: Array.isArray(c.filterTags)
          ? c.filterTags.map(function (t) { return String(t).trim().toLowerCase(); }).filter(Boolean).slice(0, 30)
          : [],
        carouselAutoplay: !!c.carouselAutoplay,
        carouselInterval: typeof c.carouselInterval === 'number' ? c.carouselInterval : 6,
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

    // The carousel frame: arrows either side of the track, dot rail below. The
    // dot rail is populated at wire time because the page count depends on the
    // measured cards-per-view.
    _carFrame(inner) {
      return '<div class="tgog-car" data-car>'
        + '<button type="button" class="tgog-car-arrow" data-dir="prev" aria-label="' + esc(this.t('prevOffers')) + '">'
        + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg></button>'
        + inner
        + '<button type="button" class="tgog-car-arrow" data-dir="next" aria-label="' + esc(this.t('nextOffers')) + '">'
        + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></button>'
        + '<ul class="tgog-car-dots" data-dots role="tablist" aria-label="' + esc(this.t('carouselPages')) + '"></ul>'
        + '</div>';
    }

    _render(state) {
      const cfg = this.cfg;
      const isCar = cfg.display === 'carousel';
      const root = document.createElement('div');
      root.className = 'tgog';
      root.setAttribute('data-theme', cfg.theme);
      // Active-dot / focus-ring accent. Hex only — whitelisting here means a
      // config string can never smuggle anything past the declaration.
      if (/^#[0-9a-fA-F]{3,8}$/.test(cfg.accentColor)) root.style.setProperty('--tgog-accent', cfg.accentColor);

      const head = (cfg.heading || cfg.subheading)
        ? '<div class="tgog-head">' + (cfg.heading ? '<h2 class="tgog-title">' + esc(cfg.heading) + '</h2>' : '')
          + (cfg.subheading ? '<p class="tgog-sub">' + esc(cfg.subheading) + '</p>' : '') + '</div>'
        : '';

      const gridCls = cfg.layout === 'vertical'
        ? 'grid' + (cfg.columns !== 'auto' ? ' cols-' + cfg.columns : '')
        : 'stack';

      const skel = '<div class="tgog-skel"><div class="img"></div><div class="line"></div><div class="line s"></div></div>';

      let body;
      if (state === 'loading') {
        body = isCar
          ? this._carFrame('<div class="tgog-car-track">'
              + new Array(3).fill(0).map(function () { return '<div>' + skel + '</div>'; }).join('')
              + '</div>')
          : '<div class="tgog-items ' + gridCls + '">'
            + new Array(cfg.layout === 'vertical' ? 6 : 3).fill(0).map(function () { return skel; }).join('')
            + '</div>';
      } else if (state === 'empty') {
        body = '<div class="tgog-empty">' + esc(cfg.emptyText) + '</div>';
      } else {
        body = isCar
          ? this._carFrame('<div class="tgog-car-track" data-items data-track tabindex="0" role="group" aria-roledescription="carousel" aria-label="' + esc(this.t('offersLabel')) + '"></div>')
          : '<div class="tgog-items ' + gridCls + '" data-items></div>';
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
      // Keep only live offers (the feed already filters; this guards inline data),
      // then apply the optional type/tag display filter. Filtering to nothing is
      // the calm empty state, same as an empty feed.
      let items = (list || []).filter((it) => liveLocally(it.offer || it));
      items = items.filter((it) => matchesFilter(it, this.cfg));
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
            // In the carousel WE size each slot from the measured row, so the
            // card must fill it — its usual 380px vertical cap would leave the
            // slack as ugly gaps between cards on wide pages.
            fluid: cfg.display === 'carousel',
            theme: cfg.theme,
            accentColor: cfg.accentColor,
            brandColor: cfg.brandColor,
            radius: cfg.radius,
            currency: (offer && offer.currency) || cfg.currency || 'GBP',
            ctaText: cfg.ctaText,
            offerPage: pageBase,
            offerId: id,
            offer: offer
          });
        });
        if (cfg.display === 'carousel') this._wireCarousel(items.length);
      }).catch(() => { /* card script failed to load — leave skeletons cleared */ this._render('empty'); });
    }

    // Wire the carousel once the cards exist: explicit pixel widths per card
    // (computed from the measured container — percentage flex-basis is circular
    // in unconstrained parents), a dot rail sized from the real cards-per-view,
    // arrows, scroll tracking, resize handling and opt-in autoplay. Nothing in
    // here scrolls or focuses at wire time — movement only follows a real user
    // action or the autoplay timer, so editor previews stay calm.
    _wireCarousel(totalOffers) {
      const car = this.root.querySelector('[data-car]');
      const track = this.root.querySelector('[data-track]');
      const dotRail = this.root.querySelector('[data-dots]');
      const prevBtn = this.root.querySelector('.tgog-car-arrow[data-dir="prev"]');
      const nextBtn = this.root.querySelector('.tgog-car-arrow[data-dir="next"]');
      if (!car || !track || !dotRail) return;
      if (this._carRO) { try { this._carRO.disconnect(); } catch (e) { /* noop */ } this._carRO = null; }
      if (this._carStop) { this._carStop(); this._carStop = null; }
      const self = this;

      // Wide card styles (horizontal, banner, split, cruise) are full-width
      // designs, so they page one at a time; vertical cards fit 1/2/3 by width.
      const cardLayout = this.cfg.template === 'cruise' ? 'cruise' : this.cfg.layout;
      const wideCards = cardLayout !== 'vertical';

      // Measure the available width, but only trust a sane answer — an
      // unconstrained parent can report an enormous clientWidth.
      const measureWidth = () => {
        let w = car.clientWidth;
        if (w > 3000 || w < 1) {
          const hostW = this.el.clientWidth;
          w = (hostW > 0 && hostW <= 3000) ? hostW : Math.min((typeof window !== 'undefined' && window.innerWidth) || 1280, 1280);
        }
        return w;
      };
      // Cards-per-view: the client's columns choice (2/3/4) when set, clamped
      // down on smaller screens so a 4-up never squeezes onto a phone;
      // otherwise responsive 1/2/3. Wide card styles are full-width designs and
      // always page one at a time.
      const chosen = (!wideCards && this.cfg.columns !== 'auto') ? parseInt(this.cfg.columns, 10) : 0;
      const cardsPerView = (w) => {
        if (wideCards) return 1;
        if (chosen) return w < 640 ? 1 : (w < 1024 ? Math.min(chosen, 2) : chosen);
        return w >= 1024 ? 3 : (w >= 640 ? 2 : 1);
      };
      const pageCount = (cpv) => Math.max(1, Math.ceil(totalOffers / cpv));
      const cells = () => Array.prototype.slice.call(track.children);

      const applyCardWidths = () => {
        const w = measureWidth();
        const cpv = cardsPerView(w);
        const isMobile = w < 640;
        const padding = isMobile ? 0 : 88;   // .tgog-car side padding ×2
        const gap = isMobile ? 12 : 16;
        const cardWidth = ((w - padding) - gap * (cpv - 1)) / cpv;
        cells().forEach((cell) => {
          cell.style.flex = '0 0 ' + cardWidth + 'px';
          cell.style.width = cardWidth + 'px';
        });
        return cpv;
      };

      const buildDots = (pages) => {
        let html = '';
        for (let i = 0; i < pages; i++) {
          html += '<li><button type="button" class="tgog-car-dot" data-dot="' + i + '" role="tab" aria-label="'
            + esc(self.t('pageOf', { n: i + 1, total: pages })) + '"' + (i === 0 ? ' aria-current="true"' : '') + '></button></li>';
        }
        dotRail.innerHTML = html;
        dotRail.style.display = pages > 1 ? 'flex' : 'none';
      };

      const trackGap = () => { const g = parseFloat(getComputedStyle(track).gap); return isFinite(g) ? g : 16; };
      const stepWidth = () => { const c = cells(); return c.length ? c[0].offsetWidth + trackGap() : 0; };

      // Reduced motion governs every programmatic scroll, not just autoplay: an
      // explicit behavior:'smooth' would override the track's reduced-motion
      // scroll-behavior CSS, so the behaviour itself must be conditional.
      let reduce = false;
      try { reduce = !!(typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { /* noop */ }
      const scrollBehavior = reduce ? 'auto' : 'smooth';

      const atTrackEnd = () => (track.scrollLeft + track.clientWidth) >= (track.scrollWidth - 1);

      const currentPage = () => {
        const cpv = cardsPerView(measureWidth());
        const pages = pageCount(cpv);
        const sw = stepWidth();
        if (!sw) return 0;
        // The browser clamps the final scroll position, so a partial last page
        // never rests on an exact page multiple — being at the end IS the last
        // page (5 offers at 3-up must light dot 2 of 2, not dot 1).
        if (track.scrollLeft > 0 && atTrackEnd()) return pages - 1;
        return Math.min(pages - 1, Math.round(track.scrollLeft / (sw * cpv)));
      };

      // aria-disabled rather than the native attribute: disabling the button a
      // keyboard user is focused on would dump their focus to the page body.
      const setDisabled = (btn, on) => {
        if (!btn) return;
        if (on) btn.setAttribute('aria-disabled', 'true');
        else btn.removeAttribute('aria-disabled');
      };
      const isDisabled = (btn) => !!btn && btn.getAttribute('aria-disabled') === 'true';

      const updateState = () => {
        const cur = currentPage();
        dotRail.querySelectorAll('[data-dot]').forEach((el, i) => {
          if (i === cur) el.setAttribute('aria-current', 'true');
          else el.removeAttribute('aria-current');
        });
        setDisabled(prevBtn, track.scrollLeft <= 1);
        setDisabled(nextBtn, atTrackEnd());
      };

      const scrollByPage = (dir) => {
        const sw = stepWidth();
        if (sw && typeof track.scrollBy === 'function') track.scrollBy({ left: sw * cardsPerView(measureWidth()) * dir, behavior: scrollBehavior });
      };
      const scrollToPage = (i) => {
        const sw = stepWidth();
        if (sw && typeof track.scrollTo === 'function') track.scrollTo({ left: sw * cardsPerView(measureWidth()) * i, behavior: scrollBehavior });
      };

      const applyAll = () => { buildDots(pageCount(applyCardWidths())); updateState(); };
      applyAll();

      // Autoplay is opt-in, never runs for reduced-motion visitors, pauses on
      // hover/focus/touch, and stops FOR GOOD once the visitor navigates
      // deliberately (arrow, dot or keyboard) — a pause the visitor chose must
      // not undo itself the moment their pointer leaves the carousel.
      const autoplayOn = !!this.cfg.carouselAutoplay && !reduce;
      const intervalMs = Math.max(2, Math.min(20, this.cfg.carouselInterval || 6)) * 1000;
      let timer = null;
      let userStopped = false;
      const startAutoplay = () => {
        if (!autoplayOn || userStopped || timer) return;
        timer = setInterval(() => {
          // The host may have thrown this instance away (demo controls and SPA
          // embeds rebuild the widget) — a tick against a detached track ends
          // the timer instead of scrolling a ghost forever.
          if (!track.isConnected) { stopAutoplay(); return; }
          if (atTrackEnd()) { if (typeof track.scrollTo === 'function') track.scrollTo({ left: 0, behavior: scrollBehavior }); }
          else scrollByPage(1);
        }, intervalMs);
      };
      const stopAutoplay = () => { if (timer) { clearInterval(timer); timer = null; } };
      const userStop = () => { userStopped = true; stopAutoplay(); };
      this._carStop = stopAutoplay;

      if (prevBtn) prevBtn.addEventListener('click', () => { if (isDisabled(prevBtn)) return; userStop(); scrollByPage(-1); });
      if (nextBtn) nextBtn.addEventListener('click', () => { if (isDisabled(nextBtn)) return; userStop(); scrollByPage(1); });
      dotRail.addEventListener('click', (ev) => {
        const dot = ev.target && ev.target.closest ? ev.target.closest('[data-dot]') : null;
        if (!dot) return;
        userStop();
        scrollToPage(parseInt(dot.getAttribute('data-dot'), 10) || 0);
      });
      let raf = 0;
      track.addEventListener('scroll', () => {
        if (raf) return;
        raf = requestAnimationFrame(() => { updateState(); raf = 0; });
      });
      // Keyboard navigation when the track has focus.
      track.addEventListener('keydown', (ev) => {
        if (ev.key === 'ArrowLeft') { ev.preventDefault(); userStop(); scrollByPage(-1); }
        else if (ev.key === 'ArrowRight') { ev.preventDefault(); userStop(); scrollByPage(1); }
        else if (ev.key === 'Home') { ev.preventDefault(); userStop(); scrollToPage(0); }
        else if (ev.key === 'End') { ev.preventDefault(); userStop(); scrollToPage(pageCount(cardsPerView(measureWidth())) - 1); }
      });

      // Re-measure on host resize (observing the host, not the carousel — the
      // carousel derives its width from the host, so observing itself loops).
      if (typeof ResizeObserver !== 'undefined') {
        let rraf = 0;
        const ro = new ResizeObserver(() => {
          if (rraf) return;
          rraf = requestAnimationFrame(() => { applyAll(); rraf = 0; });
        });
        ro.observe(this.el);
        this._carRO = ro;
      }

      if (autoplayOn) {
        car.addEventListener('mouseenter', stopAutoplay);
        car.addEventListener('mouseleave', startAutoplay);
        car.addEventListener('focusin', stopAutoplay);
        car.addEventListener('touchstart', stopAutoplay, { passive: true });
        // Document-level, so it removes itself once the widget's DOM has been
        // discarded — otherwise every rebuild would leave a live listener
        // pinning a detached shadow tree.
        const onVisibility = () => {
          if (!track.isConnected) { stopAutoplay(); document.removeEventListener('visibilitychange', onVisibility); return; }
          if (document.hidden) stopAutoplay(); else startAutoplay();
        };
        document.addEventListener('visibilitychange', onVisibility);
        startAutoplay();
      }
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
