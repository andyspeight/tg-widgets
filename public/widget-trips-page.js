/* ============================================================================
 * widget-trips-page.js  ·  Travelgenix Widget Suite
 * Group Trips — full tour landing page (v0.1.0)
 *
 * The rich, full-width page an agent embeds on their own site (e.g. their
 * /tours/santorini page) to sell one group trip. Renders the whole story —
 * hero, overview, highlights, what's included, day-by-day itinerary, gallery,
 * a trip-facts panel — and an ENQUIRY form. It reads the SAME widget config as
 * the compact booking card (widget-trips.js), plus an optional `details` block
 * for the long-form content.
 *
 * Enquiry only for now: a traveller asks about the trip and becomes a lead
 * (POST /api/trip-enquiry -> the suite's unified lead router). No money moves
 * here. The deposit/booking button arrives with the Stripe work (GT-5/GT-7).
 *
 * Embed:
 *   <div data-tg-widget="trips-page" data-tg-id="YOUR_WIDGET_ID"></div>
 *   <script src="https://widgets.travelify.io/widget-trips-page.js" defer></script>
 * or inline (demo / preview):
 *   <div data-tg-widget="trips-page" data-tg-config='{"trip":{...},"details":{...}}'></div>
 * ========================================================================== */
(function () {
  'use strict';

  const VERSION = '0.1.0';

  // Resolve the API base off THIS script's origin (customer sites can't use a
  // relative /api path). window.__TG_WIDGET_API__ overrides, same as the suite.
  function resolveApiBase() {
    if (typeof window === 'undefined') return '/api/widget-config';
    if (window.__TG_WIDGET_API__) return window.__TG_WIDGET_API__;
    try {
      const me = document.currentScript;
      if (me && me.src) return new URL(me.src).origin + '/api/widget-config';
      const scripts = document.getElementsByTagName('script');
      for (let i = scripts.length - 1; i >= 0; i--) {
        const s = scripts[i].src || '';
        if (/\/widget-trips-page\.js(\?|$|#)/.test(s)) return new URL(s).origin + '/api/widget-config';
      }
    } catch (e) { /* fall through */ }
    return '/api/widget-config';
  }
  const API_BASE = resolveApiBase();
  const ENQUIRY_URL = API_BASE.replace(/\/widget-config(\/)?$/, '/trip-enquiry');

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
  function isEmail(s) { return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim()) && s.length <= 254; }

  const FONTS = {
    'DM Sans':            { w: '400;500;600;700', g: 'system-ui, sans-serif' },
    'Inter':              { w: '400;500;600;700', g: 'system-ui, sans-serif' },
    'Poppins':            { w: '400;500;600;700', g: 'system-ui, sans-serif' },
    'Montserrat':         { w: '400;500;600;700', g: 'system-ui, sans-serif' },
    'Plus Jakarta Sans':  { w: '400;500;600;700', g: 'system-ui, sans-serif' },
    'Manrope':            { w: '400;500;600;700', g: 'system-ui, sans-serif' },
    'Sora':               { w: '400;500;600;700', g: 'system-ui, sans-serif' },
    'Outfit':             { w: '400;500;600;700', g: 'system-ui, sans-serif' },
    'Work Sans':          { w: '400;500;600;700', g: 'system-ui, sans-serif' },
    'Cormorant Garamond': { w: '400;500;600;700', g: 'Georgia, serif' },
    'EB Garamond':        { w: '400;500;600;700', g: 'Georgia, serif' },
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
    if (!isFinite(n) || n < 0) return '';
    const major = n / 100;
    const whole = Math.round(major) === major;
    return sym + major.toLocaleString('en-GB', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
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
  function nightsBetween(a, b) {
    if (!a || !b) return 0;
    return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86400000));
  }
  function cleanList(arr, max, len) {
    if (!Array.isArray(arr)) return [];
    return arr.slice(0, max || 40)
      .map(v => (typeof v === 'string' ? v.slice(0, len || 300) : ''))
      .filter(v => v && v.trim());
  }

  const IC = {
    pin: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
    cal: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
    users: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    moon: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
    check: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>',
    cross: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  };

  const STYLES = `
    :host { all: initial; display: block; }
    * { box-sizing: border-box; }
    .tgtp-root {
      --tgtp-brand: #EA580C; --tgtp-brand-hover: #C2410C;
      --tgtp-bg: #FFFFFF; --tgtp-alt: #F8FAFC; --tgtp-text: #0F172A;
      --tgtp-sub: #475569; --tgtp-muted: #94A3B8; --tgtp-border: #E2E8F0;
      --tgtp-success: #10B981; --tgtp-danger: #EF4444; --tgtp-radius: 16px;
      --tgtp-shadow: 0 1px 2px rgba(15,23,42,0.05);
      --tgtp-shadow-lg: 0 12px 32px rgba(15,23,42,0.10);
      --tgtp-font: 'DM Sans', system-ui, sans-serif;
      font-family: var(--tgtp-font); color: var(--tgtp-text); line-height: 1.6;
      background: var(--tgtp-bg); width: 100%; max-width: 100%;
    }
    .tgtp-root[data-theme="dark"] {
      --tgtp-bg: #0F172A; --tgtp-alt: #1E293B; --tgtp-text: #F1F5F9;
      --tgtp-sub: #CBD5E1; --tgtp-muted: #64748B; --tgtp-border: #334155;
      --tgtp-shadow: 0 1px 2px rgba(0,0,0,0.3); --tgtp-shadow-lg: 0 12px 32px rgba(0,0,0,0.45);
    }
    .tgtp-wrap { max-width: 1080px; margin: 0 auto; padding: 0 20px 64px; }
    .tgtp-h2 { font-size: clamp(20px, 3vw, 26px); font-weight: 700; letter-spacing: -0.3px; margin: 0 0 14px; }
    .tgtp-p { font-size: 16px; color: var(--tgtp-sub); margin: 0 0 14px; white-space: pre-line; }
    .tgtp-section { margin-top: 40px; }

    /* Hero */
    .tgtp-hero { position: relative; width: 100%; aspect-ratio: 21 / 9; min-height: 320px; max-height: 520px; overflow: hidden; background: var(--tgtp-alt); }
    .tgtp-hero img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .tgtp-hero-ph { position: absolute; inset: 0; background: linear-gradient(135deg, var(--tgtp-brand), #F59E0B); }
    .tgtp-hero::after { content: ''; position: absolute; inset: 0; background: linear-gradient(0deg, rgba(7,12,24,0.78) 0%, rgba(7,12,24,0.30) 42%, rgba(7,12,24,0.05) 72%); }
    .tgtp-hero-in { position: absolute; left: 0; right: 0; bottom: 0; z-index: 2; max-width: 1080px; margin: 0 auto; padding: 28px 20px; color: #fff; }
    .tgtp-hero-title { font-size: clamp(26px, 5vw, 44px); font-weight: 800; line-height: 1.1; letter-spacing: -0.6px; margin: 0 0 12px; text-shadow: 0 2px 18px rgba(0,0,0,0.35); }
    .tgtp-hero-meta { display: flex; flex-wrap: wrap; gap: 8px 20px; font-size: 15px; }
    .tgtp-hero-meta span { display: inline-flex; align-items: center; gap: 7px; }
    .tgtp-fromchip { display: inline-flex; align-items: baseline; gap: 6px; margin-top: 14px; background: rgba(255,255,255,0.16); backdrop-filter: blur(6px); border: 1px solid rgba(255,255,255,0.25); padding: 8px 14px; border-radius: 999px; font-size: 14px; }
    .tgtp-fromchip b { font-size: 20px; font-weight: 800; }

    /* Body grid */
    .tgtp-grid { display: grid; grid-template-columns: 1fr 340px; gap: 40px; align-items: start; margin-top: 36px; }
    @media (max-width: 860px) { .tgtp-grid { grid-template-columns: 1fr; gap: 8px; } }

    /* Highlights */
    .tgtp-highlights { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 12px 22px; }
    @media (max-width: 560px) { .tgtp-highlights { grid-template-columns: 1fr; } }
    .tgtp-highlights li { position: relative; padding-left: 28px; font-size: 15.5px; color: var(--tgtp-text); }
    .tgtp-highlights li::before { content: ''; position: absolute; left: 0; top: 8px; width: 14px; height: 14px; border-radius: 50%; background: var(--tgtp-brand); opacity: 0.18; }
    .tgtp-highlights li::after { content: ''; position: absolute; left: 5px; top: 13px; width: 4px; height: 4px; border-radius: 50%; background: var(--tgtp-brand); }

    /* Included / excluded */
    .tgtp-incex { display: grid; grid-template-columns: 1fr 1fr; gap: 26px; }
    @media (max-width: 560px) { .tgtp-incex { grid-template-columns: 1fr; gap: 18px; } }
    .tgtp-incex h3 { font-size: 15px; font-weight: 700; margin: 0 0 12px; }
    .tgtp-incex ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 9px; }
    .tgtp-incex li { display: flex; align-items: flex-start; gap: 9px; font-size: 15px; color: var(--tgtp-sub); }
    .tgtp-incex .tgtp-inc svg { color: var(--tgtp-success); flex-shrink: 0; margin-top: 1px; }
    .tgtp-incex .tgtp-exc svg { color: var(--tgtp-muted); flex-shrink: 0; margin-top: 1px; }

    /* Itinerary */
    .tgtp-itin { list-style: none; margin: 0; padding: 0; }
    .tgtp-itin li { position: relative; padding: 0 0 22px 30px; }
    .tgtp-itin li::before { content: ''; position: absolute; left: 6px; top: 4px; bottom: -4px; width: 2px; background: var(--tgtp-border); }
    .tgtp-itin li:last-child::before { display: none; }
    .tgtp-itin li::after { content: ''; position: absolute; left: 0; top: 4px; width: 14px; height: 14px; border-radius: 50%; background: var(--tgtp-bg); border: 3px solid var(--tgtp-brand); }
    .tgtp-itin h4 { font-size: 16px; font-weight: 700; margin: 0 0 4px; }
    .tgtp-itin p { font-size: 15px; color: var(--tgtp-sub); margin: 0; white-space: pre-line; }

    /* Gallery */
    .tgtp-gallery { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
    @media (max-width: 560px) { .tgtp-gallery { grid-template-columns: 1fr 1fr; } }
    .tgtp-gallery img { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; border-radius: 10px; display: block; background: var(--tgtp-alt); }

    /* Facts aside */
    .tgtp-aside { position: sticky; top: 20px; }
    @media (max-width: 860px) { .tgtp-aside { position: static; } }
    .tgtp-facts { background: var(--tgtp-alt); border: 1px solid var(--tgtp-border); border-radius: var(--tgtp-radius); padding: 20px; box-shadow: var(--tgtp-shadow); }
    .tgtp-facts-price { font-size: 30px; font-weight: 800; line-height: 1; }
    .tgtp-facts-price small { font-size: 14px; font-weight: 500; color: var(--tgtp-sub); }
    .tgtp-facts-row { display: flex; align-items: center; gap: 10px; padding: 12px 0; border-top: 1px solid var(--tgtp-border); font-size: 14.5px; }
    .tgtp-facts-row:first-of-type { margin-top: 16px; }
    .tgtp-facts-row svg { color: var(--tgtp-brand); flex-shrink: 0; }
    .tgtp-facts-row b { font-weight: 600; }
    .tgtp-deposit-note { margin-top: 14px; font-size: 13px; color: var(--tgtp-sub); background: var(--tgtp-bg); border: 1px dashed var(--tgtp-border); border-radius: 10px; padding: 10px 12px; }
    .tgtp-cta { display: block; width: 100%; margin-top: 16px; background: var(--tgtp-brand); color: #fff; border: 0; border-radius: 12px; padding: 14px 18px; font: inherit; font-size: 16px; font-weight: 700; cursor: pointer; text-align: center; transition: background 0.15s ease; }
    .tgtp-cta:hover { background: var(--tgtp-brand-hover); }
    .tgtp-cta:focus-visible { outline: 3px solid var(--tgtp-brand); outline-offset: 2px; }

    /* Enquiry form */
    .tgtp-enquire { margin-top: 48px; background: var(--tgtp-alt); border: 1px solid var(--tgtp-border); border-radius: var(--tgtp-radius); padding: 28px; }
    .tgtp-enquire h2 { margin-top: 0; }
    .tgtp-form { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 8px; }
    @media (max-width: 560px) { .tgtp-form { grid-template-columns: 1fr; } }
    .tgtp-field { display: flex; flex-direction: column; gap: 6px; }
    .tgtp-field.tgtp-span2 { grid-column: 1 / -1; }
    .tgtp-field label { font-size: 13px; font-weight: 600; color: var(--tgtp-text); }
    .tgtp-field .req { color: var(--tgtp-danger); }
    .tgtp-input, .tgtp-textarea, .tgtp-select {
      width: 100%; padding: 11px 13px; font: inherit; font-size: 15px;
      border: 1px solid var(--tgtp-border); border-radius: 10px;
      background: var(--tgtp-bg); color: var(--tgtp-text);
    }
    .tgtp-input:focus, .tgtp-textarea:focus, .tgtp-select:focus { outline: none; border-color: var(--tgtp-brand); box-shadow: 0 0 0 3px rgba(234,88,12,0.14); }
    .tgtp-textarea { resize: vertical; min-height: 110px; line-height: 1.5; }
    .tgtp-hp { position: absolute !important; left: -9999px !important; width: 1px; height: 1px; overflow: hidden; }
    .tgtp-consent { display: flex; align-items: flex-start; gap: 9px; font-size: 13.5px; color: var(--tgtp-sub); }
    .tgtp-consent input { margin-top: 3px; }
    .tgtp-submit { background: var(--tgtp-brand); color: #fff; border: 0; border-radius: 12px; padding: 13px 22px; font: inherit; font-size: 16px; font-weight: 700; cursor: pointer; transition: background 0.15s ease; }
    .tgtp-submit:hover:not(:disabled) { background: var(--tgtp-brand-hover); }
    .tgtp-submit:disabled { opacity: 0.6; cursor: default; }
    .tgtp-status { font-size: 14px; margin-top: 4px; min-height: 20px; }
    .tgtp-status.ok { color: var(--tgtp-success); font-weight: 600; }
    .tgtp-status.err { color: var(--tgtp-danger); }
    .tgtp-thanks { text-align: center; padding: 20px; }
    .tgtp-thanks svg { color: var(--tgtp-success); }
    .tgtp-thanks h3 { margin: 10px 0 4px; font-size: 20px; }
    .tgtp-thanks p { margin: 0; color: var(--tgtp-sub); }

    @media (prefers-reduced-motion: reduce) { .tgtp-root * { transition: none !important; animation: none !important; scroll-behavior: auto !important; } }
  `;

  // ── Widget class ──────────────────────────────────────────────────────────
  class TGTripsPageWidget {
    constructor(container, config) {
      this.el = container;
      container._tgInitialised = true;
      container._tgWidget = this;
      this.cfg = this._defaults(config);
      // The public widget id — needed to POST an enquiry. From data-tg-id, or
      // config._widgetId when the loader set it. Absent in inline/demo mode.
      this.widgetId = (config && config._widgetId) || container.getAttribute('data-tg-id') || '';
      this.shadow = container.attachShadow({ mode: 'open' });
      this._submitting = false;
      this._render();
    }

    _defaults(c) {
      c = c || {};
      const trip = (c.trip && typeof c.trip === 'object') ? c.trip : {};
      const details = (c.details && typeof c.details === 'object') ? c.details : {};
      const enquiry = (c.enquiry && typeof c.enquiry === 'object') ? c.enquiry : {};
      const design = (c.design && typeof c.design === 'object') ? c.design : {};
      const itinerary = Array.isArray(details.itinerary) ? details.itinerary.slice(0, 40).map(it => ({
        title: typeof (it && it.title) === 'string' ? it.title.slice(0, 160) : '',
        text: typeof (it && it.text) === 'string' ? it.text.slice(0, 1200) : '',
      })).filter(it => it.title || it.text) : [];
      return {
        trip: {
          title: typeof trip.title === 'string' ? trip.title : '',
          heroImage: safeUrl(trip.heroImage),
          description: typeof trip.description === 'string' ? trip.description : '',
          startDate: typeof trip.startDate === 'string' ? trip.startDate : '',
          endDate: typeof trip.endDate === 'string' ? trip.endDate : '',
          location: typeof trip.location === 'string' ? trip.location : '',
          capacity: Math.max(0, Math.min(500, parseInt(trip.capacity, 10) || 0)),
          currency: typeof trip.currency === 'string' ? trip.currency : 'gbp',
          pricePence: Math.max(0, parseInt(trip.pricePence, 10) || 0),
          depositPence: Math.max(0, parseInt(trip.depositPence, 10) || 0),
          balanceDueDate: typeof trip.balanceDueDate === 'string' ? trip.balanceDueDate : '',
        },
        details: {
          overview: typeof details.overview === 'string' ? details.overview.slice(0, 6000) : '',
          highlights: cleanList(details.highlights, 12, 200),
          included: cleanList(details.included, 30, 200),
          excluded: cleanList(details.excluded, 30, 200),
          itinerary,
          gallery: (Array.isArray(details.gallery) ? details.gallery : []).map(safeUrl).filter(Boolean).slice(0, 12),
        },
        enquiry: {
          heading: typeof enquiry.heading === 'string' && enquiry.heading.trim() ? enquiry.heading.slice(0, 120) : 'Enquire about this trip',
          intro: typeof enquiry.intro === 'string' ? enquiry.intro.slice(0, 400) : 'Leave your details and we will be in touch about availability and any questions.',
          buttonText: typeof enquiry.buttonText === 'string' && enquiry.buttonText.trim() ? enquiry.buttonText.slice(0, 40) : 'Send enquiry',
          successMessage: typeof enquiry.successMessage === 'string' && enquiry.successMessage.trim() ? enquiry.successMessage.slice(0, 300) : 'Thank you. Your enquiry is on its way and we will get back to you shortly.',
        },
        design: {
          brandColor: safeHex(design.brandColor, ''),
          theme: design.theme === 'dark' ? 'dark' : 'light',
          radius: typeof design.radius === 'number' ? Math.max(0, Math.min(32, design.radius)) : 16,
          fontFamily: safeFontName(design.fontFamily, 'DM Sans'),
        },
      };
    }

    // ── Section builders (all output esc()'d) ──
    _hero(t, sym) {
      const start = parseDay(t.startDate), end = parseDay(t.endDate);
      const dates = fmtRange(start, end);
      const price = money(sym, t.pricePence);
      const img = t.heroImage
        ? '<img src="' + esc(t.heroImage) + '" alt="" loading="lazy">'
        : '<div class="tgtp-hero-ph"></div>';
      const meta = [
        dates ? '<span data-role="dates">' + IC.cal + esc(dates) + '</span>' : '',
        t.location ? '<span data-role="location">' + IC.pin + esc(t.location) + '</span>' : '',
      ].join('');
      const chip = price ? '<div class="tgtp-fromchip">from <b data-role="price">' + esc(price) + '</b> per person</div>' : '';
      return '<div class="tgtp-hero">' + img
        + '<div class="tgtp-hero-in">'
        + '<h1 class="tgtp-hero-title" data-role="title">' + esc(t.title) + '</h1>'
        + (meta ? '<div class="tgtp-hero-meta">' + meta + '</div>' : '')
        + chip
        + '</div></div>';
    }

    _overview(d, t) {
      const text = d.overview || t.description;
      if (!text) return '';
      return '<section class="tgtp-section" data-role="overview"><h2 class="tgtp-h2">About this trip</h2>'
        + '<p class="tgtp-p">' + esc(text) + '</p></section>';
    }

    _highlights(d) {
      if (!d.highlights.length) return '';
      return '<section class="tgtp-section"><h2 class="tgtp-h2">Highlights</h2>'
        + '<ul class="tgtp-highlights">'
        + d.highlights.map(h => '<li>' + esc(h) + '</li>').join('')
        + '</ul></section>';
    }

    _incex(d) {
      if (!d.included.length && !d.excluded.length) return '';
      const inc = d.included.length
        ? '<div class="tgtp-inc"><h3>What’s included</h3><ul>'
          + d.included.map(x => '<li>' + IC.check + '<span>' + esc(x) + '</span></li>').join('')
          + '</ul></div>' : '';
      const exc = d.excluded.length
        ? '<div class="tgtp-exc"><h3>Not included</h3><ul>'
          + d.excluded.map(x => '<li>' + IC.cross + '<span>' + esc(x) + '</span></li>').join('')
          + '</ul></div>' : '';
      return '<section class="tgtp-section"><div class="tgtp-incex">' + inc + exc + '</div></section>';
    }

    _itinerary(d) {
      if (!d.itinerary.length) return '';
      return '<section class="tgtp-section"><h2 class="tgtp-h2">Day by day</h2>'
        + '<ul class="tgtp-itin">'
        + d.itinerary.map(it =>
            '<li>' + (it.title ? '<h4>' + esc(it.title) + '</h4>' : '')
            + (it.text ? '<p>' + esc(it.text) + '</p>' : '') + '</li>').join('')
        + '</ul></section>';
    }

    _gallery(d) {
      if (!d.gallery.length) return '';
      return '<section class="tgtp-section"><h2 class="tgtp-h2">Gallery</h2>'
        + '<div class="tgtp-gallery">'
        + d.gallery.map(u => '<img src="' + esc(u) + '" alt="" loading="lazy">').join('')
        + '</div></section>';
    }

    _facts(t, sym) {
      const start = parseDay(t.startDate), end = parseDay(t.endDate);
      const dates = fmtRange(start, end);
      const nights = nightsBetween(start, end);
      const price = money(sym, t.pricePence);
      const deposit = money(sym, t.depositPence);
      const balancePence = Math.max(0, t.pricePence - t.depositPence);
      const balance = money(sym, balancePence);
      const balanceDue = parseDay(t.balanceDueDate);

      const rows = [
        dates ? '<div class="tgtp-facts-row">' + IC.cal + '<span>' + esc(dates) + '</span></div>' : '',
        nights ? '<div class="tgtp-facts-row">' + IC.moon + '<span><b>' + nights + '</b> nights</span></div>' : '',
        t.location ? '<div class="tgtp-facts-row">' + IC.pin + '<span>' + esc(t.location) + '</span></div>' : '',
        t.capacity ? '<div class="tgtp-facts-row">' + IC.users + '<span>Group of <b>' + t.capacity + '</b></span></div>' : '',
      ].join('');

      const priceBlock = price
        ? '<div class="tgtp-facts-price">' + esc(price) + ' <small>per person</small></div>'
        : '';
      const depositNote = (deposit)
        ? '<div class="tgtp-deposit-note" data-role="deposit-note"><b>' + esc(deposit) + ' deposit</b> secures a place'
          + (balance && balanceDue ? ', with the ' + esc(balance) + ' balance due by ' + esc(fmtDay(balanceDue)) : '')
          + '. Online deposit booking is coming soon — enquire now to reserve.</div>'
        : '';

      return '<aside class="tgtp-aside"><div class="tgtp-facts">'
        + priceBlock + rows + depositNote
        + '<button type="button" class="tgtp-cta" data-role="enquire-cta">Enquire about this trip</button>'
        + '</div></aside>';
    }

    _form(e) {
      // No autofocus / no scrolling here — this is render, not a user action.
      return '<section class="tgtp-enquire" data-role="enquiry">'
        + '<h2 class="tgtp-h2" data-role="enquiry-heading">' + esc(e.heading) + '</h2>'
        + (e.intro ? '<p class="tgtp-p">' + esc(e.intro) + '</p>' : '')
        + '<form class="tgtp-form" data-role="form" novalidate>'
        + '<div class="tgtp-field"><label for="tgtp-name">Name <span class="req">*</span></label>'
        + '<input class="tgtp-input" id="tgtp-name" name="name" type="text" maxlength="80" autocomplete="name" required></div>'
        + '<div class="tgtp-field"><label for="tgtp-email">Email <span class="req">*</span></label>'
        + '<input class="tgtp-input" id="tgtp-email" name="email" type="email" maxlength="254" autocomplete="email" required></div>'
        + '<div class="tgtp-field"><label for="tgtp-phone">Phone</label>'
        + '<input class="tgtp-input" id="tgtp-phone" name="phone" type="tel" maxlength="30" autocomplete="tel"></div>'
        + '<div class="tgtp-field"><label for="tgtp-party">How many travelling</label>'
        + '<select class="tgtp-select" id="tgtp-party" name="partySize">'
        + Array.from({ length: 20 }, (_, i) => '<option value="' + (i + 1) + '">' + (i + 1) + (i === 0 ? ' person' : ' people') + '</option>').join('')
        + '</select></div>'
        + '<div class="tgtp-field tgtp-span2"><label for="tgtp-message">Your message</label>'
        + '<textarea class="tgtp-textarea" id="tgtp-message" name="message" maxlength="2000" placeholder="Tell us what you would like to know"></textarea></div>'
        // Honeypot — visually hidden, real people never fill it.
        + '<div class="tgtp-hp" aria-hidden="true"><label>Do not fill this in<input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>'
        + '<div class="tgtp-field tgtp-span2"><label class="tgtp-consent"><input type="checkbox" name="marketingConsent" value="1"><span>Keep me posted about this and similar trips.</span></label></div>'
        + '<div class="tgtp-field tgtp-span2">'
        + '<button type="submit" class="tgtp-submit" data-role="submit">' + esc(e.buttonText) + '</button>'
        + '<div class="tgtp-status" data-role="status" role="status" aria-live="polite"></div>'
        + '</div>'
        + '</form></section>';
    }

    _render() {
      const t = this.cfg.trip, d = this.cfg.details, e = this.cfg.enquiry, dz = this.cfg.design;

      if (!t.title) {
        this.shadow.innerHTML = '';
        this.el.setAttribute('data-tg-hidden', 'unconfigured');
        return;
      }
      this.el.removeAttribute('data-tg-hidden');
      ensureFont(dz.fontFamily);

      const sym = currencySymbol(t.currency);

      this.root = document.createElement('div');
      this.root.className = 'tgtp-root';
      this.root.setAttribute('data-theme', dz.theme);
      if (dz.brandColor) {
        this.root.style.setProperty('--tgtp-brand', dz.brandColor);
        this.root.style.setProperty('--tgtp-brand-hover', dz.brandColor);
      }
      this.root.style.setProperty('--tgtp-radius', dz.radius + 'px');
      this.root.style.setProperty('--tgtp-font', fontStack(dz.fontFamily));

      const main = this._overview(d, t) + this._highlights(d) + this._incex(d) + this._itinerary(d) + this._gallery(d);

      this.root.innerHTML =
        this._hero(t, sym)
        + '<div class="tgtp-wrap">'
        + '<div class="tgtp-grid">'
        + '<div class="tgtp-main">' + main + '</div>'
        + this._facts(t, sym)
        + '</div>'
        + this._form(e)
        + '</div>';

      this.shadow.innerHTML = '<style>' + STYLES + '</style>';
      this.shadow.appendChild(this.root);
      this._bind();
    }

    _bind() {
      const cta = this.root.querySelector('[data-role="enquire-cta"]');
      const form = this.root.querySelector('[data-role="form"]');
      const enquiry = this.root.querySelector('[data-role="enquiry"]');

      // A real click may scroll/focus — that is a user action, not a render.
      if (cta && enquiry) {
        cta.addEventListener('click', () => {
          try { enquiry.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch { enquiry.scrollIntoView(); }
          const nameEl = this.root.querySelector('#tgtp-name');
          if (nameEl) { try { nameEl.focus({ preventScroll: true }); } catch { nameEl.focus(); } }
        });
      }

      if (form) form.addEventListener('submit', (ev) => { ev.preventDefault(); this._submit(form); });
    }

    async _submit(form) {
      if (this._submitting) return;
      const statusEl = this.root.querySelector('[data-role="status"]');
      const submitEl = this.root.querySelector('[data-role="submit"]');
      const setStatus = (msg, cls) => { if (statusEl) { statusEl.textContent = msg; statusEl.className = 'tgtp-status' + (cls ? ' ' + cls : ''); } };

      const data = new FormData(form);
      // Honeypot — pretend success, do nothing.
      if (data.get('website')) { this._thanks(); return; }

      const name = String(data.get('name') || '').trim();
      const email = String(data.get('email') || '').trim();
      if (!name) { setStatus('Please add your name.', 'err'); return; }
      if (!isEmail(email)) { setStatus('Please enter a valid email address.', 'err'); return; }

      // Inline/demo mode: no real widget id, so there is nothing to post to.
      if (!this.widgetId) {
        setStatus('This is a preview — enquiries are only sent from a saved, embedded trip.', 'ok');
        return;
      }

      const payload = {
        widgetId: this.widgetId,
        name,
        email,
        phone: String(data.get('phone') || '').trim(),
        partySize: parseInt(data.get('partySize'), 10) || 1,
        message: String(data.get('message') || '').trim(),
        marketingConsent: !!data.get('marketingConsent'),
        website: '', // honeypot, always empty from a real submit
        sourceUrl: (typeof location !== 'undefined' ? location.href : '').slice(0, 1000),
        referrer: (typeof document !== 'undefined' ? document.referrer : '').slice(0, 500),
      };

      this._submitting = true;
      if (submitEl) submitEl.disabled = true;
      setStatus('Sending your enquiry…', '');

      try {
        const res = await fetch(ENQUIRY_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const out = await res.json().catch(() => ({}));
        if (res.ok && out.ok) {
          this._thanks();
        } else {
          setStatus(out.error || 'Something went wrong. Please try again.', 'err');
          this._submitting = false;
          if (submitEl) submitEl.disabled = false;
        }
      } catch (err) {
        setStatus('Could not send just now. Please try again in a moment.', 'err');
        this._submitting = false;
        if (submitEl) submitEl.disabled = false;
      }
    }

    _thanks() {
      const wrap = this.root.querySelector('[data-role="enquiry"]');
      if (!wrap) return;
      const msg = this.cfg.enquiry.successMessage;
      wrap.innerHTML = '<div class="tgtp-thanks" data-role="thanks">' + IC.check
        + '<h3>Enquiry sent</h3><p>' + esc(msg) + '</p></div>';
    }

    update(config) {
      this.cfg = this._defaults(Object.assign({}, {
        trip: Object.assign({}, this.cfg.trip, config && config.trip),
        details: Object.assign({}, this.cfg.details, config && config.details),
        enquiry: Object.assign({}, this.cfg.enquiry, config && config.enquiry),
        design: Object.assign({}, this.cfg.design, config && config.design),
      }));
      if (config && config._widgetId) this.widgetId = config._widgetId;
      this._submitting = false;
      this._render();
    }

    destroy() {
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
      console.error('[TGTripsPage] Config load error:', err);
      return null;
    }
  }

  async function init() {
    const containers = document.querySelectorAll('[data-tg-widget="trips-page"]');
    for (const el of containers) {
      if (el._tgInitialised || el.shadowRoot) continue;
      el._tgInitialised = true;
      let config = null;
      const inline = el.getAttribute('data-tg-config');
      const widgetId = el.getAttribute('data-tg-id');
      if (inline) {
        try { config = JSON.parse(inline); } catch (e) { console.error('[TGTripsPage] Invalid inline config:', e); continue; }
      } else if (widgetId) {
        config = await loadConfigFromApi(widgetId);
        if (!config) continue;
      } else {
        config = {};
      }
      new TGTripsPageWidget(el, config);
    }
  }

  if (typeof window !== 'undefined') {
    window.TGTripsPageWidget = TGTripsPageWidget;
    window.__TG_TRIPS_PAGE_VERSION__ = VERSION;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }
})();
