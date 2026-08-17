/* ============================================================================
 * widget-offer-card.js  ·  Travelgenix Widget Suite
 * Special Offer Card — the display card for a hand-built offer (v0.1.0)
 *
 * Renders one offer (the object the Special Offer Builder form emits) as a
 * card, in one of two layouts:
 *   - vertical   : image on top, body, price + CTA footer (grid-friendly)
 *   - horizontal : image left, body middle, price + CTA rail right (list/banner)
 *
 * It is layout only. Clicking the card (or its CTA) goes to ctaHref, which will
 * be the public offer page once that is built. Matches the house card anatomy
 * and --tgo-* tokens from widget-offers.js so hand-built cards sit beside the
 * live cached offers.
 *
 * Embed:
 *   <div data-tg-widget="offer-card" data-tg-id="YOUR_WIDGET_ID"></div>
 * or inline (demo / preview), offer + card options together in the config:
 *   <div data-tg-widget="offer-card"
 *        data-tg-config='{"layout":"vertical","offer":{...}}'></div>
 *
 * The offer shape is exactly the builder output:
 *   { fields:{title,teaser,country,region,resort,property,stars,board,style,
 *             type,nights,price,was,basis,badge,badgeAmount,urgency,image,...},
 *     includes:[...], tags:[...], currency:'GBP' }
 * Flat objects (no `fields` wrapper) are also accepted.
 * ========================================================================== */
(function () {
  'use strict';

  const VERSION = '0.2.3';

  // Resolve the API base off THIS script's origin. The widget is hosted on
  // widgets.travelify.io and embedded on customer sites, so a relative
  // '/api/...' resolves to the customer origin and 404s. Order: explicit
  // opt-in, then document.currentScript, then a scan for our own script tag.
  function resolveApiBase() {
    if (typeof window === 'undefined') return '/api/widget-config';
    if (window.__TG_WIDGET_API__) return window.__TG_WIDGET_API__;
    try {
      const me = document.currentScript;
      if (me && me.src) return new URL(me.src).origin + '/api/widget-config';
      const scripts = document.getElementsByTagName('script');
      for (let i = scripts.length - 1; i >= 0; i--) {
        const s = scripts[i].src || '';
        if (/\/widget-offer-card\.js(\?|$|#)/.test(s)) return new URL(s).origin + '/api/widget-config';
      }
    } catch (e) { /* fall through */ }
    return '/api/widget-config';
  }
  const API_BASE = resolveApiBase();

  // ─── i18n ───────────────────────────────────────────────────
  // Fixed UI chrome only (the CTA label, the Save badge word, the nights label,
  // the untitled fallback). The offer's own data — title, teaser, place names,
  // prices, dates, board/type labels, ATOL/ABTA wording — is author content and
  // is never translated here. English is the source + fallback.
  const MESSAGES = {
    en: { viewDeal: 'View deal', save: 'Save', nights: 'nights', untitled: 'Untitled offer', from: 'From', viewHolidayDetails: 'View holiday details' },
    fr: { viewDeal: "Voir l'offre", save: 'Économisez', nights: 'nuits', untitled: 'Offre sans titre' },
    de: { viewDeal: 'Angebot ansehen', save: 'Sparen', nights: 'Nächte', untitled: 'Angebot ohne Titel' },
    es: { viewDeal: 'Ver oferta', save: 'Ahorra', nights: 'noches', untitled: 'Oferta sin título' },
    it: { viewDeal: 'Vedi offerta', save: 'Risparmia', nights: 'notti', untitled: 'Offerta senza titolo' },
    ro: { viewDeal: 'Vezi oferta', save: 'Economisește', nights: 'nopți', untitled: 'Ofertă fără titlu' },
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

  // ── Helpers ────────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function currencySymbol(code) {
    return { GBP: '£', EUR: '€', USD: '$', AUD: '$', CAD: '$' }[code] || '£';
  }
  // Format a price value (string or number) with thousands separators.
  function money(sym, val) {
    if (val == null || val === '') return '';
    const n = Number(String(val).replace(/[^0-9.]/g, ''));
    if (!isFinite(n) || n === 0) return '';
    return sym + n.toLocaleString('en-GB');
  }
  // '5 star' -> 5
  function parseStars(s) {
    const m = String(s || '').match(/\d/);
    return m ? Math.min(5, parseInt(m[0], 10)) : 0;
  }
  // 'Package holiday (flight + hotel)' -> 'Package holiday'; 'Hotel / accommodation only' -> 'Hotel'
  function shortType(t) {
    if (!t) return '';
    return String(t).split('(')[0].split('/')[0].replace(/\s+only$/i, '').trim();
  }
  // ── Scheduling: an offer shows only within its [showFrom, showUntil] window.
  // Either bound may be absent. Dates are compared at day granularity in the
  // viewer's local time, so a "show until" date is inclusive of that whole day.
  function parseDay(s) {
    if (!s) return null;
    const m = String(s).trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]).getTime();
    const t = Date.parse(s);
    if (!isFinite(t)) return null;
    const dt = new Date(t);
    return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime();
  }
  function offerWindow(fromStr, untilStr) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const from = parseDay(fromStr), until = parseDay(untilStr);
    if (from !== null && today < from) return { live: false, state: 'upcoming', from: from, until: until };
    if (until !== null && today > until) return { live: false, state: 'ended', from: from, until: until };
    return { live: true, state: 'live', from: from, until: until };
  }

  // URL-safe base64 of a (possibly unicode) string — used to carry a whole
  // offer to the /offer page when there is no saved id yet.
  function b64urlEncode(str) {
    const utf8 = unescape(encodeURIComponent(str));
    return btoa(utf8).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  // Cosmetic slug from the offer title (matches the server's slugify), used to
  // build the readable /offer/<slug>-<id> link.
  function slugify(s) {
    return String(s == null ? '' : s)
      .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
  }

  // Only allow http(s) / relative URLs through to href + background-image.
  function safeUrl(u) {
    if (!u) return '';
    const s = String(u).trim();
    if (/^(https?:)?\/\//i.test(s) || s.startsWith('/') || s.startsWith('#')) return s;
    return '';
  }
  // A URL safe to drop inside a CSS url('...') value. esc() cannot neutralise
  // the characters that break out of url() — ( ) ' " ; whitespace \ — so reject
  // any value that carries one. Runs the safeUrl allowlist first.
  function safeCssUrl(u) {
    const s = safeUrl(u);
    if (!s || /[()'"\\;\s]/.test(s)) return '';
    return s;
  }

  const PIN = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>';

  // Icons for the cruise card: ribbon glyphs + the rotating feature-row markers.
  const ICO = {
    ship: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 21c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2c1.3 0 1.9.5 2.5 1"/><path d="M19.38 20A11.6 11.6 0 0 0 21 14l-9-4-9 4c0 2.9.94 5.34 2.81 7.76"/><path d="M12 10V4"/><path d="M12 2v2"/><path d="M6 10V7a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v3"/></svg>',
    anchor: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="3"/><line x1="12" y1="22" x2="12" y2="8"/><path d="M5 12H2a10 10 0 0 0 20 0h-3"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    map: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>',
    calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    star: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
    gem: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12l4 6-10 13L2 9z"/><path d="M11 3 8 9l4 13 4-13-3-6"/><path d="M2 9h20"/></svg>',
    chev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>'
  };
  const FEAT_ICONS = [ICO.ship, ICO.clock, ICO.anchor, ICO.map, ICO.calendar];

  // ── Scoped styles (shadow DOM, --tgo-* tokens shared with widget-offers) ──
  const STYLES = `
    :host { all: initial; display: block; }
    * { box-sizing: border-box; }
    .tgoc-root {
      --tgo-brand: #1B2B5B; --tgo-accent: #00B4D8; --tgo-accent-hover: #0096B7;
      --tgo-card: #FFFFFF; --tgo-card-alt: #FAFBFC; --tgo-text: #0F172A;
      --tgo-sub: #64748B; --tgo-muted: #94A3B8; --tgo-border: #E2E8F0;
      --tgo-success: #10B981; --tgo-warn: #D97706; --tgo-strike: #94A3B8;
      --tgo-radius: 14px; --tgo-shadow: 0 1px 2px rgba(15,23,42,0.04);
      --tgo-shadow-hover: 0 8px 24px rgba(15,23,42,0.08);
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      color: var(--tgo-text); line-height: 1.5; width: 100%; max-width: 100%;
    }
    .tgoc-root[data-theme="dark"] {
      --tgo-card: #1E293B; --tgo-card-alt: #0F172A; --tgo-text: #F1F5F9;
      --tgo-sub: #94A3B8; --tgo-muted: #64748B; --tgo-border: #334155;
      --tgo-strike: #64748B; --tgo-shadow: 0 1px 2px rgba(0,0,0,0.3);
      --tgo-shadow-hover: 0 8px 24px rgba(0,0,0,0.4);
    }

    .tgoc-card {
      background: var(--tgo-card); border: 1px solid var(--tgo-border);
      border-radius: var(--tgo-radius); overflow: hidden; box-shadow: var(--tgo-shadow);
      transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
      text-decoration: none; color: inherit; cursor: pointer; display: flex;
    }
    .tgoc-card:hover { transform: translateY(-2px); box-shadow: var(--tgo-shadow-hover); border-color: var(--tgo-accent); }
    @media (prefers-reduced-motion: reduce) { .tgoc-card { transition: none; } .tgoc-card:hover { transform: none; } }

    /* Image */
    .tgoc-img { position: relative; background: var(--tgo-card-alt) center/cover no-repeat; flex-shrink: 0; }
    .tgoc-img-ph {
      position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
      background: linear-gradient(135deg, var(--tgo-brand), var(--tgo-accent));
      color: rgba(255,255,255,0.92); font-size: 15px; font-weight: 700; letter-spacing: 0.5px;
      text-align: center; padding: 12px;
    }
    .tgoc-stars {
      position: absolute; top: 10px; left: 10px; background: rgba(0,0,0,0.7); color: #FFD166;
      padding: 4px 10px; border-radius: 6px; font-size: 12px; font-weight: 600;
      backdrop-filter: blur(4px); letter-spacing: 1px;
    }
    .tgoc-badge {
      position: absolute; top: 10px; right: 10px; background: var(--tgo-warn); color: #fff;
      padding: 4px 11px; border-radius: 6px; font-size: 11px; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.5px;
    }
    .tgoc-pill {
      position: absolute; bottom: 10px; left: 10px; background: var(--tgo-success); color: #fff;
      padding: 4px 11px; border-radius: 999px; font-size: 11px; font-weight: 700;
    }

    /* Body */
    .tgoc-body { padding: 14px 16px; display: flex; flex-direction: column; gap: 6px; min-width: 0; }
    .tgoc-eyebrow { font-size: 10px; color: var(--tgo-accent); font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; }
    .tgoc-title { font-weight: 700; font-size: 17px; line-height: 1.3; margin: 0; color: var(--tgo-text); }
    .tgoc-loc { font-size: 13px; color: var(--tgo-sub); display: inline-flex; align-items: center; gap: 5px; }
    .tgoc-loc svg { color: var(--tgo-muted); flex-shrink: 0; }
    .tgoc-teaser {
      font-size: 12px; color: var(--tgo-sub); line-height: 1.5; margin: 2px 0 0;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
    }
    .tgoc-tags { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 4px; }
    .tgoc-tag {
      font-size: 10px; font-weight: 600; background: var(--tgo-card-alt); border: 1px solid var(--tgo-border);
      color: var(--tgo-sub); padding: 3px 8px; border-radius: 999px;
    }
    .tgoc-includes { list-style: none; margin: 4px 0 0; padding: 0; display: flex; flex-direction: column; gap: 3px; }
    .tgoc-include { font-size: 12px; color: var(--tgo-sub); line-height: 1.4; padding-left: 16px; position: relative; }
    .tgoc-include::before { content: '✓'; position: absolute; left: 0; color: var(--tgo-success); font-weight: 700; }

    /* Price block + CTA */
    .tgoc-price-block { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
    .tgoc-was { font-size: 12px; color: var(--tgo-strike); text-decoration: line-through; }
    .tgoc-price { font-weight: 800; font-size: 23px; line-height: 1; color: var(--tgo-text); }
    .tgoc-price-sub { font-size: 11px; color: var(--tgo-sub); margin-top: 2px; }
    .tgoc-cta {
      background: var(--tgo-accent); color: #fff; border: 0; border-radius: 9px; padding: 10px 16px;
      font-weight: 700; font-size: 13px; cursor: pointer; white-space: nowrap; text-decoration: none;
      display: inline-flex; align-items: center; justify-content: center; font-family: inherit;
    }
    .tgoc-cta:hover { background: var(--tgo-accent-hover); }
    .tgoc-cta--disabled { background: var(--tgo-muted); cursor: default; opacity: 0.65; pointer-events: none; }
    .tgoc-cta--disabled:hover { background: var(--tgo-muted); }

    /* ── Vertical layout ── */
    .tgoc-card--vertical { flex-direction: column; max-width: 380px; }
    .tgoc-card--vertical .tgoc-img { aspect-ratio: 16 / 10; width: 100%; }
    .tgoc-card--vertical .tgoc-body { flex: 1; }
    .tgoc-card--vertical .tgoc-foot {
      display: flex; justify-content: space-between; align-items: flex-end; gap: 12px;
      padding: 12px 16px 16px; margin-top: auto;
    }

    /* ── Horizontal layout ── */
    .tgoc-card--horizontal { flex-direction: row; align-items: stretch; width: 100%; }
    .tgoc-card--horizontal .tgoc-img { width: 240px; min-height: 170px; align-self: stretch; }
    .tgoc-card--horizontal .tgoc-body { flex: 1; justify-content: center; padding: 18px 20px; }
    .tgoc-card--horizontal .tgoc-rail {
      flex-shrink: 0; width: 200px; border-left: 1px solid var(--tgo-border);
      padding: 18px 20px; display: flex; flex-direction: column; justify-content: center;
      align-items: flex-start; gap: 14px; background: var(--tgo-card-alt);
    }
    .tgoc-card--horizontal .tgoc-rail .tgoc-cta { width: 100%; }

    /* Horizontal collapses to a stacked card on narrow hosts */
    @media (max-width: 560px) {
      .tgoc-card--horizontal { flex-direction: column; }
      .tgoc-card--horizontal .tgoc-img { width: 100%; aspect-ratio: 16 / 10; min-height: 0; }
      .tgoc-card--horizontal .tgoc-rail {
        width: 100%; border-left: 0; border-top: 1px solid var(--tgo-border);
        flex-direction: row; justify-content: space-between; align-items: center;
      }
      .tgoc-card--horizontal .tgoc-rail .tgoc-cta { width: auto; }
    }

    /* ── Banner layout — full-bleed image, offer overlaid ── */
    .tgoc-card--banner { position: relative; flex-direction: column; justify-content: flex-end; width: 100%; min-height: 300px; color: #fff; overflow: hidden; }
    .tgoc-card--banner .tgoc-bimg { position: absolute; inset: 0; background-size: cover; background-position: center; transition: transform 0.4s ease; }
    .tgoc-card--banner:hover .tgoc-bimg { transform: scale(1.04); }
    .tgoc-card--banner .tgoc-bimg.ph { background: linear-gradient(135deg, var(--tgo-brand), var(--tgo-accent)); }
    .tgoc-card--banner::after {
      content: ''; position: absolute; inset: 0; pointer-events: none;
      background: linear-gradient(90deg, rgba(7,12,24,0.82) 0%, rgba(7,12,24,0.5) 42%, rgba(7,12,24,0.12) 100%),
                  linear-gradient(0deg, rgba(7,12,24,0.55) 0%, rgba(7,12,24,0) 55%);
    }
    .tgoc-card--banner.tgoc-flip::after {
      background: linear-gradient(270deg, rgba(7,12,24,0.82) 0%, rgba(7,12,24,0.5) 42%, rgba(7,12,24,0.12) 100%),
                  linear-gradient(0deg, rgba(7,12,24,0.55) 0%, rgba(7,12,24,0) 55%);
    }
    .tgoc-card--banner .tgoc-badge, .tgoc-card--banner .tgoc-pill { z-index: 3; }
    .tgoc-card--banner .tgoc-bwrap {
      position: relative; z-index: 2; display: flex; align-items: flex-end; justify-content: space-between;
      gap: 28px; padding: 26px 30px; width: 100%;
    }
    .tgoc-card--banner.tgoc-flip .tgoc-bwrap { flex-direction: row-reverse; text-align: right; }
    .tgoc-card--banner.tgoc-flip .tgoc-b-meta, .tgoc-card--banner.tgoc-flip .tgoc-tags { justify-content: flex-end; }
    .tgoc-b-text { min-width: 0; }
    .tgoc-b-eyebrow { font-size: 11px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: rgba(255,255,255,0.85); }
    .tgoc-b-title { font-size: clamp(22px, 3vw, 30px); font-weight: 800; line-height: 1.15; letter-spacing: -0.5px; margin: 6px 0 8px; text-shadow: 0 2px 18px rgba(0,0,0,0.4); }
    .tgoc-b-meta { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; font-size: 14px; }
    .tgoc-b-meta .tgoc-loc { color: rgba(255,255,255,0.92); }
    .tgoc-b-meta .tgoc-loc svg { color: rgba(255,255,255,0.8); }
    .tgoc-b-stars { color: var(--tgo-gold, #FFD166); letter-spacing: 1px; }
    .tgoc-card--banner .tgoc-tags { margin-top: 10px; }
    .tgoc-card--banner .tgoc-tag { background: rgba(255,255,255,0.16); border-color: rgba(255,255,255,0.28); color: #fff; }
    .tgoc-b-buy { flex-shrink: 0; display: flex; flex-direction: column; align-items: flex-end; gap: 12px; text-align: right; }
    .tgoc-card--banner .tgoc-price { color: #fff; font-size: 30px; }
    .tgoc-card--banner .tgoc-was { color: rgba(255,255,255,0.72); }
    .tgoc-card--banner .tgoc-price-sub { color: rgba(255,255,255,0.82); }
    .tgoc-card--banner .tgoc-price-block { align-items: flex-end; }
    .tgoc-card--banner .tgoc-cta { padding: 12px 22px; font-size: 14px; box-shadow: 0 8px 22px rgba(0,0,0,0.3); }

    @media (max-width: 600px) {
      .tgoc-card--banner { min-height: 0; }
      .tgoc-card--banner .tgoc-bwrap, .tgoc-card--banner.tgoc-flip .tgoc-bwrap {
        flex-direction: column; align-items: flex-start; text-align: left; gap: 16px; padding: 20px;
      }
      .tgoc-card--banner .tgoc-b-buy { align-items: flex-start; text-align: left; flex-direction: row; align-items: center; gap: 16px; }
      .tgoc-card--banner .tgoc-price-block { align-items: flex-start; }
    }

    /* ── Split layout — editorial 50/50 with a big price ── */
    .tgoc-card--split { flex-direction: row; width: 100%; min-height: 320px; }
    .tgoc-card--split.tgoc-flip { flex-direction: row-reverse; }
    .tgoc-card--split .tgoc-img { width: 46%; min-height: 320px; align-self: stretch; }
    .tgoc-card--split .tgoc-sbody { flex: 1; padding: 30px 36px; display: flex; flex-direction: column; justify-content: center; gap: 8px; min-width: 0; }
    .tgoc-card--split .tgoc-eyebrow { font-size: 11px; }
    .tgoc-s-title { font-size: clamp(22px, 2.4vw, 28px); font-weight: 800; line-height: 1.2; letter-spacing: -0.5px; margin: 4px 0 2px; }
    .tgoc-s-meta { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
    .tgoc-s-meta .tgoc-loc { font-size: 14px; }
    .tgoc-s-stars { color: var(--tgo-gold, #FFB703); letter-spacing: 1px; }
    .tgoc-s-teaser { font-size: 14.5px; color: var(--tgo-sub); line-height: 1.6; margin: 8px 0 0; max-width: 60ch; }
    .tgoc-card--split .tgoc-tags { margin-top: 12px; }
    .tgoc-sfoot { display: flex; align-items: flex-end; justify-content: space-between; gap: 18px; margin-top: 20px; padding-top: 18px; border-top: 1px solid var(--tgo-border); }
    .tgoc-card--split .tgoc-price { font-size: 30px; }
    .tgoc-card--split .tgoc-cta { padding: 12px 24px; font-size: 14px; }

    @media (max-width: 620px) {
      .tgoc-card--split, .tgoc-card--split.tgoc-flip { flex-direction: column; }
      .tgoc-card--split .tgoc-img { width: 100%; aspect-ratio: 16 / 10; min-height: 0; }
      .tgoc-card--split .tgoc-sbody { padding: 22px; }
    }

    /* ── Cruise layout — client-branded: ribbon flags, icon feature rows, details link ── */
    .tgoc-card--cruise { flex-direction: column; }
    .tgoc-card--cruise .tgoc-c-img { position: relative; width: 100%; aspect-ratio: 16 / 11; }
    .tgoc-ribbons { position: absolute; top: 14px; left: 0; display: flex; flex-direction: column; gap: 9px; align-items: flex-start; z-index: 2; }
    .tgoc-ribbon {
      display: inline-flex; align-items: center; gap: 7px;
      padding: 7px 20px 7px 15px; color: #fff;
      font-size: 12px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; line-height: 1;
      clip-path: polygon(0 0, 100% 0, calc(100% - 9px) 50%, 100% 100%, 0 100%);
      box-shadow: 0 3px 8px rgba(0,0,0,0.22);
    }
    .tgoc-ribbon svg { width: 14px; height: 14px; }
    .tgoc-ribbon--featured { background: var(--tgo-accent, #E11D2A); }
    .tgoc-ribbon--type { background: #1E88C7; }
    .tgoc-ribbon--luxury { background: linear-gradient(180deg, #CBA43C, #B6891D); }
    .tgoc-cbody { padding: 22px 22px 6px; display: flex; flex-direction: column; gap: 14px; flex: 1; }
    .tgoc-c-title { margin: 0; font-size: clamp(19px, 2vw, 22px); font-weight: 800; line-height: 1.22; letter-spacing: -0.3px; }
    .tgoc-c-ship { margin: -8px 0 0; display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 700; color: var(--tgo-accent); min-width: 0; }
    .tgoc-c-ship svg { width: 15px; height: 15px; flex: 0 0 15px; }
    .tgoc-c-ship span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tgoc-c-price { margin: 0; font-size: 16px; font-weight: 800; }
    .tgoc-c-feats { list-style: none; margin: 2px 0 0; padding: 0; display: flex; flex-direction: column; gap: 11px; }
    .tgoc-c-feat { display: flex; gap: 11px; align-items: flex-start; font-size: 14px; color: var(--tgo-sub); line-height: 1.45; }
    .tgoc-c-feat svg { width: 17px; height: 17px; flex: 0 0 17px; margin-top: 1px; color: var(--tgo-muted, #94A3B8); }
    .tgoc-c-cta {
      margin-top: auto; padding: 16px 22px; border-top: 1px solid var(--tgo-border);
      display: flex; align-items: center; gap: 7px;
      font-size: 13px; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase;
      color: var(--tgo-accent, #E11D2A);
    }
    .tgoc-c-cta svg { width: 15px; height: 15px; }
    .tgoc-card--cruise:hover .tgoc-c-cta { gap: 11px; }
    .tgoc-c-cta.tgoc-cta--disabled { color: var(--tgo-muted); }
  `;

  // ── Widget class ──────────────────────────────────────────────────────────
  class TGOfferCardWidget {
    constructor(container, config) {
      this.el = container;
      container._tgInitialised = true;
      this.cfg = this._defaults(config);
      this.t = makeT(this.cfg);   // resolve viewer language + UI strings
      this.shadow = container.attachShadow({ mode: 'open' });
      this._render();
    }

    _defaults(c) {
      c = c || {};
      const layouts = ['vertical', 'horizontal', 'banner', 'split', 'cruise'];
      return {
        layout: layouts.indexOf(c.layout) !== -1 ? c.layout : 'vertical',
        imageSide: c.imageSide === 'right' ? 'right' : 'left',  // split + banner text alignment
        theme: c.theme === 'dark' ? 'dark' : 'light',
        brandColor: c.brandColor || '',
        accentColor: c.accentColor || '',
        radius: typeof c.radius === 'number' ? c.radius : 14,
        currency: c.currency || '',
        ctaText: c.ctaText || '',   // empty = use the localised default at render time
        ctaHref: safeUrl(c.ctaHref) || '',
        // Offer-page linking. When ctaHref is not set explicitly, the card links
        // to offerPage, carrying the offer's saved id when there is one, else the
        // whole offer encoded in the URL so it works before offers are stored.
        offerPage: c.offerPage || '',
        offerId: c.offerId || '',
        ctaTarget: c.ctaTarget === '_blank' ? '_blank' : '',
        // Carry the viewer language through so a parent (e.g. the offers grid)
        // can pin the card to the language it resolved. Falls back to
        // <html lang>/navigator inside makeT when not set.
        lang: c.lang || c.language || c.locale || '',
        offer: c.offer && typeof c.offer === 'object' ? c.offer : {}
      };
    }

    // Resolve the destination for the card + its CTA.
    _href() {
      if (this.cfg.ctaHref) return this.cfg.ctaHref;
      const base = this.cfg.offerPage;
      if (!base) return '';
      const o = this.cfg.offer || {};
      const id = this.cfg.offerId || o.id || (o.fields && o.fields.id) || '';
      // Split the base into path + query so a saved offer becomes the readable
      // /offer/<slug>-<id> path while any template/theme query is preserved.
      const qi = base.indexOf('?');
      const path = qi >= 0 ? base.slice(0, qi) : base;
      const query = qi >= 0 ? base.slice(qi) : '';
      if (id) {
        // Slug is built from the SOURCE title so the /offer link stays stable and
        // matches the server's slug regardless of the viewer's language.
        const srcTitle = (o.fields && o.fields.title) || o.title || '';
        const slug = slugify(srcTitle);
        return path.replace(/\/$/, '') + '/' + (slug ? slug + '-' : '') + encodeURIComponent(id) + query;
      }
      const sep = query ? '&' : '?';
      try { return base + sep + 'data=' + b64urlEncode(JSON.stringify(o)); }
      catch (e) { return base; }
    }

    // Build the language-localised VIEW of the offer for the resolved viewer
    // language. The author writes the offer once in the source language (English);
    // offer.i18n holds per-language overlays produced on save by /api/offer-translate.
    // Here we lay the overlay for the viewer's language over the source, field by
    // field, so a missing translation always falls back to the original — never a
    // blank. Only the FIVE translatable copy fields plus the includes/tags lists are
    // overlaid. Place names, price, dates and every other field come straight from
    // the source untouched, so the offer is never mistranslated on a number or a town.
    _localizedOffer(offer) {
      if (!offer || typeof offer !== 'object') return offer;
      const lang = this.t && this.t.lang;
      if (!lang || lang === 'en') return offer;
      const i18n = offer.i18n;
      if (!i18n || typeof i18n !== 'object') return offer;
      const tr = i18n[lang];
      if (!tr || typeof tr !== 'object') return offer;

      // Use the translated value only when it is a non-empty string, else keep source.
      const pick = (base, over) => (typeof over === 'string' && over.trim()) ? over : base;
      const out = Object.assign({}, offer);

      // Only these five copy fields are ever translated. Everything else in
      // `fields` (price, was, country, resort, dates, board, etc.) is left as the
      // source value.
      const TRANSLATABLE = ['title', 'teaser', 'description', 'urgency', 'avail'];
      const srcFields = (offer.fields && typeof offer.fields === 'object') ? offer.fields : null;
      if (srcFields) {
        const trFields = (tr.fields && typeof tr.fields === 'object') ? tr.fields : {};
        const fields = Object.assign({}, srcFields);
        for (let i = 0; i < TRANSLATABLE.length; i++) {
          const k = TRANSLATABLE[i];
          fields[k] = pick(srcFields[k], trFields[k]);
        }
        out.fields = fields;
      }

      if (Array.isArray(tr.includes) && tr.includes.length) out.includes = tr.includes;
      if (Array.isArray(tr.tags) && tr.tags.length) out.tags = tr.tags;

      return out;
    }

    // Pull a value from the offer, whether it is wrapped in `fields` or flat.
    // Reads from the localised view (this.lo) so the viewer sees translated copy,
    // falling back to the raw config offer before the first render resolves it.
    _f(key) {
      const o = this.lo || this.cfg.offer || {};
      if (o.fields && o.fields[key] != null && o.fields[key] !== '') return o.fields[key];
      if (o[key] != null && o[key] !== '') return o[key];
      return '';
    }

    _derive() {
      const o = this.lo || this.cfg.offer || {};
      const sym = currencySymbol(this.cfg.currency || o.currency || 'GBP');
      const stars = parseStars(this._f('stars'));
      const eyebrow = [this._f('style'), shortType(this._f('type'))].filter(Boolean).join(' · ');
      const loc = [this._f('resort'), this._f('country')].filter(Boolean).join(', ') || this._f('region');
      const nights = this._f('nights');
      const priceSub = [this._f('basis'), nights ? nights + ' ' + this.t('nights') : ''].filter(Boolean).join(' · ');

      // Promo badge — 'Save' uses the amount, 'Custom text' uses the free-text
      // field (for things like "€90 onboard spend per cabin"), others show their
      // own label. A Custom badge with no text shows nothing.
      const badge = this._f('badge');
      let badgeText = '';
      if (badge && badge !== 'No badge') {
        if (badge === 'Custom text') {
          badgeText = this._f('badgeText') || '';
        } else {
          const amt = money(sym, this._f('badgeAmount'));
          badgeText = (badge === 'Save' && amt) ? this.t('save') + ' ' + amt : badge;
        }
      }

      const tags = Array.isArray(o.tags) ? o.tags.slice(0, 3) : [];
      const includes = Array.isArray(o.includes) ? o.includes.filter(function (x) { return typeof x === 'string' && x.trim(); }) : [];

      return {
        sym: sym,
        stars: stars,
        eyebrow: eyebrow,
        title: this._f('title') || this.t('untitled'),
        loc: loc,
        teaser: this._f('teaser'),
        tags: tags,
        includes: includes,
        price: money(sym, this._f('price')),
        was: money(sym, this._f('was')),
        priceSub: priceSub,
        badgeText: badgeText,
        urgency: this._f('urgency'),
        // The builder stores photos in offer.images[] (first = the cover); only
        // older/flat offers used a single fields.image. Read both so a card
        // always finds its cover — without the images[] fallback, every
        // builder-made offer dropped to the gradient placeholder. The offer page
        // already reads images[] the same way.
        image: safeUrl(this._f('image') || o.image || (Array.isArray(o.images) ? o.images[0] : ''))
      };
    }

    // Absolutely-positioned overlay chips (stars, promo badge, urgency pill),
    // shared by the image block and the banner layout.
    _chips(d) {
      const stars = d.stars ? '<span class="tgoc-stars">' + '★'.repeat(d.stars) + '</span>' : '';
      const badge = d.badgeText ? '<span class="tgoc-badge">' + esc(d.badgeText) + '</span>' : '';
      const pill = d.urgency ? '<span class="tgoc-pill">' + esc(d.urgency) + '</span>' : '';
      return stars + badge + pill;
    }

    _imageBlock(d) {
      const cssUrl = safeCssUrl(d.image);
      const bg = cssUrl ? ' style="background-image:url(\'' + cssUrl + '\')"' : '';
      const ph = cssUrl ? '' : '<div class="tgoc-img-ph">' + esc(d.loc || d.title) + '</div>';
      return '<div class="tgoc-img"' + bg + '>' + ph + this._chips(d) + '</div>';
    }

    _bodyBlock(d) {
      const eyebrow = d.eyebrow ? '<span class="tgoc-eyebrow">' + esc(d.eyebrow) + '</span>' : '';
      const loc = d.loc ? '<span class="tgoc-loc">' + PIN + esc(d.loc) + '</span>' : '';
      const teaser = d.teaser ? '<p class="tgoc-teaser">' + esc(d.teaser) + '</p>' : '';
      const tags = d.tags.length
        ? '<div class="tgoc-tags">' + d.tags.map(function (t) { return '<span class="tgoc-tag">' + esc(t) + '</span>'; }).join('') + '</div>'
        : '';
      const includes = this._includesBlock(d);
      return '<div class="tgoc-body">' + eyebrow
        + '<h3 class="tgoc-title">' + esc(d.title) + '</h3>'
        + loc + teaser + includes + tags + '</div>';
    }

    // What's included list. Only rendered when the offer carries includes, so
    // offers without them are unchanged.
    _includesBlock(d) {
      if (!d.includes || !d.includes.length) return '';
      return '<ul class="tgoc-includes">'
        + d.includes.map(function (t) { return '<li class="tgoc-include">' + esc(t) + '</li>'; }).join('')
        + '</ul>';
    }

    _priceBlock(d) {
      const was = d.was ? '<span class="tgoc-was">' + esc(d.was) + '</span>' : '';
      const price = d.price ? '<div class="tgoc-price">' + esc(d.price) + '</div>' : '<div class="tgoc-price">POA</div>';
      const sub = d.priceSub ? '<span class="tgoc-price-sub">' + esc(d.priceSub) + '</span>' : '';
      return '<div class="tgoc-price-block">' + was + price + sub + '</div>';
    }

    _cta() {
      const label = this.cfg.ctaText || this.t('viewDeal');
      // The whole card is the <a> when a destination exists (see _render), so the
      // CTA renders as a visual-only span — never an anchor nested in an anchor.
      if (this._linkHref) {
        return '<span class="tgoc-cta">' + esc(label) + '</span>';
      }
      // No destination at all: show the CTA as a visibly disabled control rather
      // than a dead '#' link that just jumps the page to the top.
      return '<span class="tgoc-cta tgoc-cta--disabled" role="button" aria-disabled="true">' + esc(label) + '</span>';
    }

    // Banner: full-bleed image with the offer overlaid. Punchy and promotional.
    _bannerCard(d) {
      const cssUrl = safeCssUrl(d.image);
      const bg = cssUrl ? ' style="background-image:url(\'' + cssUrl + '\')"' : '';
      const phCls = cssUrl ? '' : ' ph';
      const eyebrow = d.eyebrow ? '<span class="tgoc-b-eyebrow">' + esc(d.eyebrow) + '</span>' : '';
      const loc = d.loc ? '<span class="tgoc-loc">' + PIN + esc(d.loc) + '</span>' : '';
      const stars = d.stars ? '<span class="tgoc-b-stars">' + '★'.repeat(d.stars) + '</span>' : '';
      const tags = d.tags.length
        ? '<div class="tgoc-tags">' + d.tags.map(function (t) { return '<span class="tgoc-tag">' + esc(t) + '</span>'; }).join('') + '</div>'
        : '';
      const badge = d.badgeText ? '<span class="tgoc-badge">' + esc(d.badgeText) + '</span>' : '';
      const pill = d.urgency ? '<span class="tgoc-pill">' + esc(d.urgency) + '</span>' : '';
      return '<div class="tgoc-bimg' + phCls + '"' + bg + '></div>' + badge + pill
        + '<div class="tgoc-bwrap">'
          + '<div class="tgoc-b-text">' + eyebrow
            + '<h3 class="tgoc-b-title">' + esc(d.title) + '</h3>'
            + '<div class="tgoc-b-meta">' + loc + stars + '</div>' + tags
          + '</div>'
          + '<div class="tgoc-b-buy">' + this._priceBlock(d) + this._cta() + '</div>'
        + '</div>';
    }

    // Split: editorial 50/50 with a big price. For a featured deal.
    _splitCard(d) {
      const eyebrow = d.eyebrow ? '<span class="tgoc-eyebrow">' + esc(d.eyebrow) + '</span>' : '';
      const loc = d.loc ? '<span class="tgoc-loc">' + PIN + esc(d.loc) + '</span>' : '';
      const stars = d.stars ? '<span class="tgoc-s-stars">' + '★'.repeat(d.stars) + '</span>' : '';
      const teaser = d.teaser ? '<p class="tgoc-s-teaser">' + esc(d.teaser) + '</p>' : '';
      const tags = d.tags.length
        ? '<div class="tgoc-tags">' + d.tags.map(function (t) { return '<span class="tgoc-tag">' + esc(t) + '</span>'; }).join('') + '</div>'
        : '';
      return this._imageBlock(d)
        + '<div class="tgoc-sbody">' + eyebrow
          + '<h3 class="tgoc-s-title">' + esc(d.title) + '</h3>'
          + '<div class="tgoc-s-meta">' + loc + stars + '</div>'
          + teaser + this._includesBlock(d) + tags
          + '<div class="tgoc-sfoot">' + this._priceBlock(d) + this._cta() + '</div>'
        + '</div>';
    }

    // Cruise: the client-branded layout — stacked ribbon flags (promo / type /
    // style), a "N Nights From £X per person" headline, up to three icon feature
    // rows drawn from the includes, and a "View holiday details" link. Uses only
    // existing offer fields, so any offer can wear it; it just suits cruises.
    _cruiseCard(d) {
      // Ribbons, top to bottom: promo badge (brand), the type (e.g. Cruise), the
      // style (e.g. Luxury). Each only shows when its field is set.
      const type = shortType(this._f('type'));
      const style = this._f('style');
      const ribbons = [];
      if (d.badgeText) ribbons.push('<span class="tgoc-ribbon tgoc-ribbon--featured">' + ICO.star + esc(d.badgeText) + '</span>');
      if (type) ribbons.push('<span class="tgoc-ribbon tgoc-ribbon--type">' + ICO.ship + esc(type) + '</span>');
      if (style) ribbons.push('<span class="tgoc-ribbon tgoc-ribbon--luxury">' + ICO.gem + esc(style) + '</span>');
      const ribbonWrap = ribbons.length ? '<div class="tgoc-ribbons">' + ribbons.join('') + '</div>' : '';

      const cssUrl = safeCssUrl(d.image);
      const bg = cssUrl ? ' style="background-image:url(\'' + cssUrl + '\')"' : '';
      const ph = cssUrl ? '' : '<div class="tgoc-img-ph">' + esc(d.loc || d.title) + '</div>';
      const img = '<div class="tgoc-img tgoc-c-img"' + bg + '>' + ph + ribbonWrap + '</div>';

      // "14 Nights From £2299 per person" — nights + price + basis, all optional.
      const nights = this._f('nights');
      const basis = this._f('basis');
      const nw = this.t('nights');
      const nightsCap = nw ? nw.charAt(0).toUpperCase() + nw.slice(1) : nw;
      const priceStr = d.price || 'POA';
      const headParts = [];
      if (nights) headParts.push(esc(nights) + ' ' + esc(nightsCap));
      headParts.push(esc(this.t('from')) + ' ' + esc(priceStr));
      const headline = '<p class="tgoc-c-price">' + headParts.join(' ') + (basis ? ' ' + esc(basis) : '') + '</p>';

      // Up to three feature rows from the includes, each with a rotating icon.
      const feats = (d.includes || []).slice(0, 3);
      const featList = feats.length
        ? '<ul class="tgoc-c-feats">' + feats.map(function (f, i) {
            return '<li class="tgoc-c-feat">' + FEAT_ICONS[i % FEAT_ICONS.length] + '<span>' + esc(f) + '</span></li>';
          }).join('') + '</ul>'
        : '';

      // Ship name with an anchor (e.g. ⚓ Celebrity Infinity) — cruise offers
      // carry a shipName field, so it sits under the title when present.
      const ship = this._f('shipName');
      const shipLine = ship ? '<p class="tgoc-c-ship">' + ICO.anchor + '<span>' + esc(ship) + '</span></p>' : '';

      const ctaLabel = this.cfg.ctaText || this.t('viewHolidayDetails');
      const ctaCls = 'tgoc-c-cta' + (this._linkHref ? '' : ' tgoc-cta--disabled');
      const cta = '<span class="' + ctaCls + '"' + (this._linkHref ? '' : ' role="button" aria-disabled="true"') + '>'
        + esc(ctaLabel) + ICO.chev + '</span>';

      return img
        + '<div class="tgoc-cbody">'
          + '<h3 class="tgoc-c-title">' + esc(d.title) + '</h3>'
          + shipLine
          + headline + featList
        + '</div>'
        + cta;
    }

    _render() {
      const cfg = this.cfg;

      // Resolve the language-localised view of the offer once per render, after
      // this.t (and so this.t.lang) is known. The render path reads copy, includes
      // and tags from this.lo via _f / _derive; price, place and dates are never
      // overlaid, so they always come from the source offer.
      this.lo = this._localizedOffer(cfg.offer);

      // Scheduling: outside its show window the card renders nothing, so it
      // simply disappears from a listing until (and only while) it is live.
      this._window = offerWindow(this._f('showFrom'), this._f('showUntil'));
      if (!this._window.live) {
        this.shadow.innerHTML = '';
        this.el.setAttribute('data-tg-hidden', this._window.state);
        return;
      }
      this.el.removeAttribute('data-tg-hidden');

      const d = this._derive();

      this.root = document.createElement('div');
      this.root.className = 'tgoc-root';
      this.root.setAttribute('data-theme', cfg.theme);
      if (cfg.brandColor) this.root.style.setProperty('--tgo-brand', cfg.brandColor);
      if (cfg.accentColor) {
        this.root.style.setProperty('--tgo-accent', cfg.accentColor);
        this.root.style.setProperty('--tgo-accent-hover', cfg.accentColor);
      }
      if (cfg.radius) this.root.style.setProperty('--tgo-radius', cfg.radius + 'px');

      this._linkHref = this._href();

      let inner;
      if (cfg.layout === 'cruise') {
        inner = this._cruiseCard(d);
      } else if (cfg.layout === 'banner') {
        inner = this._bannerCard(d);
      } else if (cfg.layout === 'split') {
        inner = this._splitCard(d);
      } else if (cfg.layout === 'horizontal') {
        inner = this._imageBlock(d) + this._bodyBlock(d)
          + '<div class="tgoc-rail">' + this._priceBlock(d) + this._cta() + '</div>';
      } else {
        inner = this._imageBlock(d) + this._bodyBlock(d)
          + '<div class="tgoc-foot">' + this._priceBlock(d) + this._cta() + '</div>';
      }

      // The whole card is an <a> when a destination is set, else a div.
      const tag = this._linkHref ? 'a' : 'div';
      const card = document.createElement(tag);
      card.className = 'tgoc-card tgoc-card--' + cfg.layout
        + (cfg.imageSide === 'right' ? ' tgoc-flip' : '');
      if (this._linkHref) {
        card.setAttribute('href', this._linkHref);
        if (cfg.ctaTarget) { card.setAttribute('target', '_blank'); card.setAttribute('rel', 'noopener'); }
      }
      card.innerHTML = inner;
      this.root.appendChild(card);

      this.shadow.innerHTML = '<style>' + STYLES + '</style>';
      this.shadow.appendChild(this.root);
    }

    // Public: update the offer and/or card options and re-render in place.
    update(config) {
      this.cfg = this._defaults(Object.assign({}, this.cfg, config));
      this.t = makeT(this.cfg);
      this._render();
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
      console.error('[TGOfferCard] Config load error:', err);
      return null;
    }
  }

  async function init() {
    const containers = document.querySelectorAll('[data-tg-widget="offer-card"]');
    for (const el of containers) {
      if (el._tgInitialised || el.shadowRoot) continue;
      el._tgInitialised = true;
      let config = null;
      const inline = el.getAttribute('data-tg-config');
      const offerAttr = el.getAttribute('data-tg-offer');
      const widgetId = el.getAttribute('data-tg-id');
      if (inline) {
        try { config = JSON.parse(inline); } catch (e) { console.error('[TGOfferCard] Invalid inline config:', e); continue; }
      } else if (widgetId) {
        config = await loadConfigFromApi(widgetId);
        if (!config) continue;
      } else {
        config = {};
      }
      if (offerAttr && !config.offer) {
        try { config.offer = JSON.parse(offerAttr); } catch (e) { console.error('[TGOfferCard] Invalid data-tg-offer:', e); }
      }
      new TGOfferCardWidget(el, config);
    }
  }

  if (typeof window !== 'undefined') {
    window.TGOfferCardWidget = TGOfferCardWidget;
    window.TGOfferCardWidget.version = VERSION;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }
})();
