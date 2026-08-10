/* ============================================================================
 * widget-tour.js  ·  Travelgenix Widget Suite
 * Escorted Tour — long-form multi-day tour page (v0.1.0)
 *
 * The richer sibling of the Group Trips tour page, for full escorted / guided
 * multi-day tours (safaris, cultural tours, coach tours). It renders the whole
 * brochure in the Travelgenix house style — agency letterhead, hero, an
 * itinerary-at-a-glance table, highlights, a rich day-by-day itinerary (each
 * day with its own facts, photos and priced optional activities), tour-wide
 * optional extras, what's included / excluded, flexible practical sections
 * (footnotes, visa & baggage, a two-column packing list, the vehicle) and a
 * gallery — plus the shared enquiry form and live availability.
 *
 * Enquiry only for now: a traveller becomes a lead (POST /api/trip-enquiry).
 * Optional extras are displayed with prices; choosing/paying for them is later.
 *
 * Embed:
 *   <div data-tg-widget="tour" data-tg-id="YOUR_WIDGET_ID"></div>
 *   <script src="https://widgets.travelify.io/widget-tour.js" defer></script>
 * or inline (demo / preview):
 *   <div data-tg-widget="tour" data-tg-config='{"tour":{...},"days":[...]}'></div>
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
        if (/\/widget-tour\.js(\?|$|#)/.test(s)) return new URL(s).origin + '/api/widget-config';
      }
    } catch (e) { /* fall through */ }
    return '/api/widget-config';
  }
  const API_BASE = resolveApiBase();
  const ENQUIRY_URL = API_BASE.replace(/\/widget-config(\/)?$/, '/trip-enquiry');
  const AVAIL_URL = API_BASE.replace(/\/widget-config(\/)?$/, '/trip-availability');

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
  function isEmail(s) { return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim()) && s.length <= 254; }
  function safeHex(v, fb) { return (typeof v === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(v.trim())) ? v.trim() : fb; }
  function str(v, max) { return typeof v === 'string' ? v.slice(0, max || 400) : ''; }
  function cleanList(arr, max, len) {
    if (!Array.isArray(arr)) return [];
    return arr.slice(0, max || 60).map(v => (typeof v === 'string' ? v.slice(0, len || 300) : '')).filter(v => v && v.trim());
  }

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
    l.href = 'https://fonts.googleapis.com/css2?family=' + encodeURIComponent(name).replace(/%20/g, '+') + ':wght@' + FONTS[name].w + '&display=swap';
    document.head.appendChild(l);
  }

  const CURRENCIES = { gbp: '£', eur: '€', usd: '$' };
  function currencySymbol(code) { return CURRENCIES[String(code || 'gbp').toLowerCase()] || '£'; }
  function money(sym, pence) {
    const n = Number(pence);
    // 0 means "not priced yet" (blank in the source), not "free" — so it shows
    // nothing rather than "£0", which lets the price bar and zero-priced extras
    // hide cleanly until a real figure is entered.
    if (!isFinite(n) || n <= 0) return '';
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

  const IC = {
    pin: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
    cal: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
    clock: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    check: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>',
    cross: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    star: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26"/></svg>',
  };

  const STYLES = `
    :host { all: initial; display: block; }
    * { box-sizing: border-box; }
    .tgto-root {
      --tgto-brand: #1B2B5B; --tgto-brand-hover: #142146; --tgto-accent: #C2410C;
      --tgto-bg: #FFFFFF; --tgto-alt: #F8FAFC; --tgto-text: #0F172A;
      --tgto-sub: #475569; --tgto-muted: #94A3B8; --tgto-border: #E2E8F0;
      --tgto-success: #10B981; --tgto-danger: #EF4444; --tgto-radius: 16px;
      --tgto-shadow: 0 1px 2px rgba(15,23,42,0.05);
      --tgto-font: 'DM Sans', system-ui, sans-serif;
      font-family: var(--tgto-font); color: var(--tgto-text); line-height: 1.6;
      background: var(--tgto-bg); width: 100%; max-width: 100%;
    }
    .tgto-root[data-theme="dark"] {
      --tgto-bg: #0F172A; --tgto-alt: #1E293B; --tgto-text: #F1F5F9;
      --tgto-sub: #CBD5E1; --tgto-muted: #64748B; --tgto-border: #334155;
      --tgto-shadow: 0 1px 2px rgba(0,0,0,0.3);
    }
    .tgto-wrap { max-width: 1000px; margin: 0 auto; padding: 0 20px; }
    .tgto-section { margin-top: 44px; }
    .tgto-h2 { font-size: clamp(20px, 3vw, 27px); font-weight: 700; letter-spacing: -0.3px; margin: 0 0 16px; }
    .tgto-eyebrow { font-size: 12px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--tgto-accent); margin: 0 0 6px; }
    .tgto-p { font-size: 16px; color: var(--tgto-sub); margin: 0 0 14px; white-space: pre-line; }

    /* Hero */
    .tgto-hero { position: relative; width: 100%; aspect-ratio: 21 / 9; min-height: 300px; max-height: 480px; overflow: hidden; background: var(--tgto-alt); border-radius: var(--tgto-radius); margin-top: 16px; }
    .tgto-hero img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .tgto-hero-ph { position: absolute; inset: 0; background: linear-gradient(135deg, var(--tgto-brand), var(--tgto-accent)); }
    .tgto-hero::after { content: ''; position: absolute; inset: 0; background: linear-gradient(0deg, rgba(7,12,24,0.78) 0%, rgba(7,12,24,0.28) 46%, rgba(7,12,24,0.05) 74%); }
    .tgto-hero-in { position: absolute; left: 0; right: 0; bottom: 0; z-index: 2; padding: 26px; color: #fff; }
    .tgto-hero-title { font-size: clamp(24px, 4.6vw, 42px); font-weight: 800; line-height: 1.1; letter-spacing: -0.6px; margin: 0 0 10px; text-shadow: 0 2px 18px rgba(0,0,0,0.35); }
    .tgto-hero-sub { font-size: clamp(15px, 2vw, 18px); margin: 0 0 12px; max-width: 60ch; color: rgba(255,255,255,0.94); }
    .tgto-hero-chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
    .tgto-chip { display: inline-flex; align-items: center; gap: 7px; background: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.30); backdrop-filter: blur(6px); padding: 7px 13px; border-radius: 999px; font-size: 14px; font-weight: 500; color: #fff; line-height: 1; }
    .tgto-chip svg { opacity: 0.9; flex-shrink: 0; }
    .tgto-chip--price { background: #fff; border-color: #fff; color: var(--tgto-brand); font-weight: 600; }
    .tgto-chip--price b { font-weight: 800; }

    /* At a glance table */
    .tgto-glance-wrap { overflow-x: auto; border: 1px solid var(--tgto-border); border-radius: var(--tgto-radius); }
    table.tgto-glance { width: 100%; border-collapse: collapse; font-size: 14.5px; min-width: 520px; }
    .tgto-glance thead th { background: var(--tgto-alt); text-align: left; font-weight: 700; padding: 12px 16px; color: var(--tgto-text); border-bottom: 1px solid var(--tgto-border); }
    .tgto-glance td { padding: 11px 16px; border-bottom: 1px solid var(--tgto-border); color: var(--tgto-sub); }
    .tgto-glance tr:last-child td { border-bottom: 0; }
    .tgto-glance td:first-child { font-weight: 600; color: var(--tgto-text); white-space: nowrap; }

    /* Highlights */
    .tgto-highlights { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 12px 22px; }
    @media (max-width: 560px) { .tgto-highlights { grid-template-columns: 1fr; } }
    .tgto-highlights li { position: relative; padding-left: 26px; font-size: 15.5px; }
    .tgto-highlights li svg { position: absolute; left: 0; top: 3px; color: var(--tgto-accent); }

    /* Day-by-day (collapsible — all closed by default) */
    .tgto-day { border: 1px solid var(--tgto-border); border-radius: var(--tgto-radius); overflow: hidden; margin-bottom: 12px; background: var(--tgto-bg); box-shadow: var(--tgto-shadow); }
    .tgto-day-head { display: flex; align-items: center; gap: 12px; width: 100%; text-align: left; padding: 15px 18px; background: var(--tgto-alt); border: 0; border-bottom: 1px solid transparent; cursor: pointer; font: inherit; color: inherit; }
    .tgto-day.is-open .tgto-day-head { border-bottom-color: var(--tgto-border); }
    .tgto-day-head:hover { filter: brightness(0.97); }
    .tgto-day-head:focus-visible { outline: 2px solid var(--tgto-accent); outline-offset: -2px; }
    .tgto-day-label { font-size: 12px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: #fff; background: var(--tgto-brand); padding: 4px 10px; border-radius: 6px; flex-shrink: 0; }
    .tgto-day-title { font-size: 16.5px; font-weight: 700; }
    .tgto-day-date { margin-left: auto; font-size: 13px; color: var(--tgto-muted); white-space: nowrap; }
    .tgto-day-chev { margin-left: auto; color: var(--tgto-muted); flex-shrink: 0; transition: transform 0.18s ease; }
    .tgto-day-date + .tgto-day-chev { margin-left: 10px; }
    .tgto-day.is-open .tgto-day-chev { transform: rotate(180deg); }
    .tgto-day-body { padding: 18px 20px; display: none; }
    .tgto-day.is-open .tgto-day-body { display: block; }
    .tgto-day-body > .tgto-p:last-child { margin-bottom: 0; }
    .tgto-day-imgs { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 8px; margin-bottom: 16px; }
    .tgto-day-imgs img { width: 100%; height: 200px; object-fit: cover; border-radius: 10px; display: block; background: var(--tgto-alt); }
    .tgto-facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin: 4px 0 4px; padding: 14px; background: var(--tgto-alt); border-radius: 12px; }
    .tgto-fact-l { font-size: 11px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: var(--tgto-muted); }
    .tgto-fact-v { font-size: 14.5px; font-weight: 600; margin-top: 2px; }
    .tgto-optional { margin-top: 16px; border-top: 1px dashed var(--tgto-border); padding-top: 14px; }
    .tgto-optional-h { font-size: 13px; font-weight: 700; margin: 0 0 8px; color: var(--tgto-text); }
    .tgto-opt-row { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; font-size: 14px; padding: 5px 0; }
    .tgto-opt-row .n { color: var(--tgto-sub); }
    .tgto-opt-row .p { font-weight: 700; white-space: nowrap; color: var(--tgto-text); }

    /* Extras */
    .tgto-extras { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    @media (max-width: 620px) { .tgto-extras { grid-template-columns: 1fr; } }
    .tgto-extra { border: 1px solid var(--tgto-border); border-radius: 12px; padding: 14px 16px; }
    .tgto-extra.rec { border-color: var(--tgto-accent); box-shadow: 0 0 0 1px var(--tgto-accent); }
    .tgto-extra-top { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
    .tgto-extra-name { font-weight: 700; font-size: 15px; }
    .tgto-extra-price { font-weight: 800; white-space: nowrap; }
    .tgto-extra-note { font-size: 13px; color: var(--tgto-sub); margin-top: 4px; }
    .tgto-recpill { display: inline-block; font-size: 10px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--tgto-accent); background: rgba(194,65,12,0.1); padding: 2px 8px; border-radius: 999px; margin-bottom: 6px; }

    /* Includes / excludes */
    .tgto-incex { display: grid; grid-template-columns: 1fr 1fr; gap: 26px; }
    @media (max-width: 620px) { .tgto-incex { grid-template-columns: 1fr; gap: 18px; } }
    .tgto-incex h3 { font-size: 15px; font-weight: 700; margin: 0 0 12px; }
    .tgto-incex ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 9px; }
    .tgto-incex li { display: flex; align-items: flex-start; gap: 9px; font-size: 15px; color: var(--tgto-sub); }
    .tgto-inc svg { color: var(--tgto-success); flex-shrink: 0; margin-top: 1px; }
    .tgto-exc svg { color: var(--tgto-muted); flex-shrink: 0; margin-top: 1px; }

    /* Flexible sections */
    .tgto-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 26px; }
    @media (max-width: 620px) { .tgto-cols { grid-template-columns: 1fr; gap: 18px; } }
    .tgto-cols h3 { font-size: 15px; font-weight: 700; margin: 0 0 10px; }
    .tgto-cols ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 7px; }
    .tgto-cols li { font-size: 15px; color: var(--tgto-sub); padding-left: 18px; position: relative; }
    .tgto-cols li::before { content: ''; position: absolute; left: 2px; top: 9px; width: 5px; height: 5px; border-radius: 50%; background: var(--tgto-accent); }
    .tgto-checklist { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .tgto-checklist li { display: flex; gap: 9px; font-size: 15px; color: var(--tgto-sub); }
    .tgto-checklist svg { color: var(--tgto-accent); flex-shrink: 0; margin-top: 2px; }
    .tgto-feature { display: grid; grid-template-columns: 1fr 1fr; gap: 22px; align-items: center; }
    @media (max-width: 620px) { .tgto-feature { grid-template-columns: 1fr; } }
    .tgto-feature img { width: 100%; border-radius: var(--tgto-radius); display: block; }
    .tgto-note { background: var(--tgto-alt); border: 1px solid var(--tgto-border); border-radius: 12px; padding: 16px 18px; font-size: 14.5px; color: var(--tgto-sub); white-space: pre-line; }

    /* Gallery */
    .tgto-gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px; }
    .tgto-gallery img { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; border-radius: 10px; display: block; background: var(--tgto-alt); }

    /* Price + availability */
    .tgto-pricebar { margin-top: 44px; background: var(--tgto-alt); border: 1px solid var(--tgto-border); border-radius: var(--tgto-radius); padding: 22px; display: flex; flex-wrap: wrap; align-items: center; gap: 8px 24px; }
    .tgto-price { font-size: 30px; font-weight: 800; line-height: 1; }
    .tgto-price small { font-size: 14px; font-weight: 500; color: var(--tgto-sub); }
    .tgto-price-note { flex-basis: 100%; font-size: 13px; color: var(--tgto-sub); }
    .tgto-avail { font-size: 14px; font-weight: 700; color: var(--tgto-sub); }
    .tgto-avail.is-low { color: var(--tgto-accent); }
    .tgto-avail.is-sold { display: inline-block; color: #fff; background: var(--tgto-muted); padding: 4px 12px; border-radius: 999px; font-size: 13px; }
    .tgto-pricebar .tgto-cta { margin-left: auto; }
    .tgto-cta { background: var(--tgto-accent); color: #fff; border: 0; border-radius: 12px; padding: 13px 22px; font: inherit; font-size: 16px; font-weight: 700; cursor: pointer; text-align: center; }
    .tgto-cta:hover { filter: brightness(0.94); }
    .tgto-cta:focus-visible { outline: 3px solid var(--tgto-accent); outline-offset: 2px; }

    /* Enquiry */
    .tgto-enquire { margin-top: 28px; background: var(--tgto-alt); border: 1px solid var(--tgto-border); border-radius: var(--tgto-radius); padding: 28px; }
    .tgto-enquire h2 { margin-top: 0; }
    .tgto-form { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 8px; }
    @media (max-width: 560px) { .tgto-form { grid-template-columns: 1fr; } }
    .tgto-field { display: flex; flex-direction: column; gap: 6px; }
    .tgto-field.tgto-span2 { grid-column: 1 / -1; }
    .tgto-field label { font-size: 13px; font-weight: 600; }
    .tgto-field .req { color: var(--tgto-danger); }
    .tgto-input, .tgto-textarea, .tgto-select { width: 100%; padding: 11px 13px; font: inherit; font-size: 15px; border: 1px solid var(--tgto-border); border-radius: 10px; background: var(--tgto-bg); color: var(--tgto-text); }
    .tgto-input:focus, .tgto-textarea:focus, .tgto-select:focus { outline: none; border-color: var(--tgto-accent); box-shadow: 0 0 0 3px rgba(194,65,12,0.14); }
    .tgto-textarea { resize: vertical; min-height: 110px; line-height: 1.5; }
    .tgto-hp { position: absolute !important; left: -9999px !important; width: 1px; height: 1px; overflow: hidden; }
    .tgto-consent { display: flex; align-items: flex-start; gap: 9px; font-size: 13.5px; color: var(--tgto-sub); }
    .tgto-consent input { margin-top: 3px; }
    .tgto-submit { background: var(--tgto-accent); color: #fff; border: 0; border-radius: 12px; padding: 13px 22px; font: inherit; font-size: 16px; font-weight: 700; cursor: pointer; }
    .tgto-submit:disabled { opacity: 0.6; cursor: default; }
    .tgto-status { font-size: 14px; margin-top: 4px; min-height: 20px; }
    .tgto-status.ok { color: var(--tgto-success); font-weight: 600; }
    .tgto-status.err { color: var(--tgto-danger); }
    .tgto-thanks { text-align: center; padding: 20px; }
    .tgto-thanks svg { color: var(--tgto-success); }
    .tgto-thanks h3 { margin: 10px 0 4px; font-size: 20px; }

    .tgto-foot { margin: 40px 0 8px; text-align: center; font-size: 13px; color: var(--tgto-muted); }

    @media (prefers-reduced-motion: reduce) { .tgto-root * { transition: none !important; animation: none !important; scroll-behavior: auto !important; } }
  `;

  // ── Widget class ──────────────────────────────────────────────────────────
  class TGTourWidget {
    constructor(container, config) {
      this.el = container;
      container._tgInitialised = true;
      container._tgWidget = this;
      this.cfg = this._defaults(config);
      this.widgetId = (config && config._widgetId) || container.getAttribute('data-tg-id') || '';
      this.shadow = container.attachShadow({ mode: 'open' });
      this._submitting = false;
      this._render();
    }

    _defaults(c) {
      c = c || {};
      const o = (k) => (c[k] && typeof c[k] === 'object' && !Array.isArray(c[k])) ? c[k] : {};
      const tour = o('tour'), enquiry = o('enquiry'), design = o('design');

      const facts = (arr) => (Array.isArray(arr) ? arr : []).slice(0, 10)
        .map(f => ({ label: str(f && f.label, 60), value: str(f && f.value, 200) }))
        .filter(f => f.label || f.value);
      const priced = (arr, max) => (Array.isArray(arr) ? arr : []).slice(0, max || 20)
        .map(x => ({
          name: str(x && x.name, 200),
          pricePence: Math.max(0, parseInt(x && x.pricePence, 10) || 0),
          note: str(x && x.note, 300),
          recommended: !!(x && x.recommended),
        })).filter(x => x.name);

      const days = (Array.isArray(c.days) ? c.days : []).slice(0, 60).map(d => ({
        label: str(d && d.label, 40),
        date: str(d && d.date, 40),
        title: str(d && d.title, 200),
        body: str(d && d.body, 4000),
        facts: facts(d && d.facts),
        images: (Array.isArray(d && d.images) ? d.images : []).map(safeUrl).filter(Boolean).slice(0, 8),
        optionalActivities: priced(d && d.optionalActivities, 20),
      })).filter(d => d.label || d.title || d.body);

      const glance = (Array.isArray(c.glance) ? c.glance : []).slice(0, 60).map(g => ({
        day: str(g && g.day, 40), date: str(g && g.date, 40),
        destination: str(g && g.destination, 120), accommodation: str(g && g.accommodation, 160),
      })).filter(g => g.day || g.destination || g.accommodation);

      const sections = (Array.isArray(c.sections) ? c.sections : []).slice(0, 20).map(s => {
        const type = ['text', 'checklist', 'columns', 'feature'].indexOf(s && s.type) !== -1 ? s.type : 'text';
        return {
          type,
          heading: str(s && s.heading, 160),
          body: str(s && s.body, 6000),
          items: cleanList(s && s.items, 40, 300),
          columns: (Array.isArray(s && s.columns) ? s.columns : []).slice(0, 4).map(col => ({
            heading: str(col && col.heading, 120), items: cleanList(col && col.items, 40, 300),
          })).filter(col => col.heading || col.items.length),
          image: safeUrl(s && s.image),
        };
      }).filter(s => s.heading || s.body || s.items.length || s.columns.length);

      return {
        tour: {
          title: str(tour.title, 200),
          subtitle: str(tour.subtitle, 400),
          location: str(tour.location, 120),
          heroImage: safeUrl(tour.heroImage),
          currency: str(tour.currency, 8) || 'gbp',
          startDate: str(tour.startDate, 20),
          endDate: str(tour.endDate, 20),
          durationText: str(tour.durationText, 60),
          capacity: Math.max(0, Math.min(500, parseInt(tour.capacity, 10) || 0)),
          pricePerPersonPence: Math.max(0, parseInt(tour.pricePerPersonPence, 10) || 0),
          singleSupplementPence: Math.max(0, parseInt(tour.singleSupplementPence, 10) || 0),
          depositPence: Math.max(0, parseInt(tour.depositPence, 10) || 0),
          balanceDueDate: str(tour.balanceDueDate, 20),
          priceNote: str(tour.priceNote, 300),
          // Read by the compact tour card (widget-tour-card.js) so a grid of
          // cards can link through to this tour's full page. The page itself
          // ignores it; kept here so it round-trips through save.
          pageUrl: safeUrl(tour.pageUrl),
        },
        glance,
        highlights: cleanList(c.highlights, 16, 200),
        days,
        extras: priced(c.extras, 24),
        included: cleanList(c.included, 40, 200),
        excluded: cleanList(c.excluded, 40, 200),
        sections,
        gallery: (Array.isArray(c.gallery) ? c.gallery : []).map(safeUrl).filter(Boolean).slice(0, 24),
        enquiry: {
          heading: str(enquiry.heading, 120) || 'Enquire about this tour',
          intro: str(enquiry.intro, 400) || 'Leave your details and we will be in touch about dates, availability and any questions.',
          buttonText: str(enquiry.buttonText, 40) || 'Send enquiry',
          successMessage: str(enquiry.successMessage, 300) || 'Thank you. Your enquiry is on its way and we will get back to you shortly.',
        },
        design: {
          brandColor: safeHex(design.brandColor, ''),
          accentColor: safeHex(design.accentColor, ''),
          theme: design.theme === 'dark' ? 'dark' : 'light',
          radius: typeof design.radius === 'number' ? Math.max(0, Math.min(32, design.radius)) : 16,
          fontFamily: safeFontName(design.fontFamily, 'DM Sans'),
        },
      };
    }

    // ── Section builders ──
    _hero(t, sym) {
      const start = parseDay(t.startDate), end = parseDay(t.endDate);
      const dates = fmtRange(start, end);
      const price = money(sym, t.pricePerPersonPence);
      const img = t.heroImage ? '<img src="' + esc(t.heroImage) + '" alt="" loading="lazy">' : '<div class="tgto-hero-ph"></div>';
      // Dates, duration and location render as consistent frosted chips beside
      // an inverted price chip, so the hero reads as one designed cluster.
      const chip = (icon, text, role) => '<span class="tgto-chip"' + (role ? ' data-role="' + role + '"' : '') + '>' + icon + esc(text) + '</span>';
      const chips = [
        dates ? chip(IC.cal, dates, 'dates') : '',
        t.durationText ? chip(IC.clock, t.durationText) : '',
        t.location ? chip(IC.pin, t.location, 'location') : '',
        price ? '<span class="tgto-chip tgto-chip--price">from <b data-role="price">' + esc(price) + '</b> pp</span>' : '',
      ].join('');
      return '<div class="tgto-hero">' + img
        + '<div class="tgto-hero-in">'
        + '<h1 class="tgto-hero-title" data-role="title">' + esc(t.title) + '</h1>'
        + (t.subtitle ? '<p class="tgto-hero-sub">' + esc(t.subtitle) + '</p>' : '')
        + (chips ? '<div class="tgto-hero-chips">' + chips + '</div>' : '')
        + '</div></div>';
    }

    _glance(rows) {
      if (!rows.length) return '';
      const body = rows.map(r =>
        '<tr><td>' + esc(r.day) + '</td><td>' + esc(r.date) + '</td><td>' + esc(r.destination) + '</td><td>' + esc(r.accommodation) + '</td></tr>'
      ).join('');
      return '<section class="tgto-section" data-role="glance"><h2 class="tgto-h2">Itinerary at a glance</h2>'
        + '<div class="tgto-glance-wrap"><table class="tgto-glance">'
        + '<thead><tr><th>Day</th><th>Date</th><th>Destination</th><th>Accommodation</th></tr></thead>'
        + '<tbody>' + body + '</tbody></table></div></section>';
    }

    _highlights(hl) {
      if (!hl.length) return '';
      return '<section class="tgto-section"><h2 class="tgto-h2">Highlights</h2>'
        + '<ul class="tgto-highlights">' + hl.map(h => '<li>' + IC.star + esc(h) + '</li>').join('') + '</ul></section>';
    }

    _days(days, sym) {
      if (!days.length) return '';
      const one = (d) => {
        const imgs = d.images.length ? '<div class="tgto-day-imgs">' + d.images.map(u => '<img src="' + esc(u) + '" alt="" loading="lazy">').join('') + '</div>' : '';
        const facts = d.facts.length
          ? '<div class="tgto-facts">' + d.facts.map(f => '<div><div class="tgto-fact-l">' + esc(f.label) + '</div><div class="tgto-fact-v">' + esc(f.value) + '</div></div>').join('') + '</div>'
          : '';
        const opts = d.optionalActivities.length
          ? '<div class="tgto-optional"><p class="tgto-optional-h">Optional activities</p>'
            + d.optionalActivities.map(a => {
                const p = money(sym, a.pricePence);
                return '<div class="tgto-opt-row"><span class="n">' + esc(a.name) + '</span><span class="p">' + (p ? esc(p) + ' pp' : '') + '</span></div>';
              }).join('')
            + '</div>'
          : '';
        // The head is a real <button> (native keyboard + focus) that toggles the
        // body. All days start collapsed; the chevron rotates when open.
        return '<div class="tgto-day" data-role="day">'
          + '<button type="button" class="tgto-day-head" aria-expanded="false">'
            + (d.label ? '<span class="tgto-day-label">' + esc(d.label) + '</span>' : '')
            + (d.title ? '<span class="tgto-day-title">' + esc(d.title) + '</span>' : '')
            + (d.date ? '<span class="tgto-day-date">' + esc(d.date) + '</span>' : '')
            + '<svg class="tgto-day-chev" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>'
          + '</button>'
          + '<div class="tgto-day-body">' + imgs
            + (d.body ? '<p class="tgto-p">' + esc(d.body) + '</p>' : '')
            + facts + opts
          + '</div></div>';
      };
      return '<section class="tgto-section"><h2 class="tgto-h2">Your day by day</h2>' + days.map(one).join('') + '</section>';
    }

    _extras(extras, sym) {
      if (!extras.length) return '';
      const one = (x) => {
        const p = money(sym, x.pricePence);
        return '<div class="tgto-extra' + (x.recommended ? ' rec' : '') + '">'
          + (x.recommended ? '<span class="tgto-recpill">Recommended</span>' : '')
          + '<div class="tgto-extra-top"><span class="tgto-extra-name">' + esc(x.name) + '</span>'
          + (p ? '<span class="tgto-extra-price">' + esc(p) + ' pp</span>' : '') + '</div>'
          + (x.note ? '<div class="tgto-extra-note">' + esc(x.note) + '</div>' : '')
          + '</div>';
      };
      return '<section class="tgto-section" data-role="extras"><h2 class="tgto-h2">Optional extras</h2>'
        + '<div class="tgto-extras">' + extras.map(one).join('') + '</div></section>';
    }

    _incex(inc, exc) {
      if (!inc.length && !exc.length) return '';
      const incBlock = inc.length ? '<div class="tgto-inc"><h3>What’s included</h3><ul>'
        + inc.map(x => '<li>' + IC.check + '<span>' + esc(x) + '</span></li>').join('') + '</ul></div>' : '';
      const excBlock = exc.length ? '<div class="tgto-exc"><h3>Not included</h3><ul>'
        + exc.map(x => '<li>' + IC.cross + '<span>' + esc(x) + '</span></li>').join('') + '</ul></div>' : '';
      return '<section class="tgto-section" data-role="incex"><div class="tgto-incex">' + incBlock + excBlock + '</div></section>';
    }

    _sections(secs) {
      if (!secs.length) return '';
      const one = (s) => {
        let inner = '';
        if (s.type === 'columns' && s.columns.length) {
          inner = '<div class="tgto-cols">' + s.columns.map(col =>
            '<div>' + (col.heading ? '<h3>' + esc(col.heading) + '</h3>' : '')
            + '<ul>' + col.items.map(i => '<li>' + esc(i) + '</li>').join('') + '</ul></div>').join('') + '</div>';
        } else if (s.type === 'checklist' && s.items.length) {
          inner = '<ul class="tgto-checklist">' + s.items.map(i => '<li>' + IC.check + '<span>' + esc(i) + '</span></li>').join('') + '</ul>';
        } else if (s.type === 'feature') {
          const img = s.image ? '<img src="' + esc(s.image) + '" alt="" loading="lazy">' : '';
          inner = '<div class="tgto-feature">' + (s.body ? '<div class="tgto-p">' + esc(s.body) + '</div>' : '') + img + '</div>';
        } else {
          // text (default) — body in a calm note card
          inner = s.body ? '<div class="tgto-note">' + esc(s.body) + '</div>' : '';
        }
        return '<section class="tgto-section" data-role="section">'
          + (s.heading ? '<h2 class="tgto-h2">' + esc(s.heading) + '</h2>' : '') + inner + '</section>';
      };
      return secs.map(one).join('');
    }

    _gallery(g) {
      if (!g.length) return '';
      return '<section class="tgto-section"><h2 class="tgto-h2">Gallery</h2>'
        + '<div class="tgto-gallery">' + g.map(u => '<img src="' + esc(u) + '" alt="" loading="lazy">').join('') + '</div></section>';
    }

    _pricebar(t, sym) {
      const price = money(sym, t.pricePerPersonPence);
      if (!price) return '';
      const single = money(sym, t.singleSupplementPence);
      const deposit = money(sym, t.depositPence);
      const balanceDue = parseDay(t.balanceDueDate);
      const notes = [
        single ? single + ' single supplement' : '',
        deposit ? deposit + ' deposit to reserve' + (balanceDue ? ', balance by ' + fmtDay(balanceDue) : '') : '',
        t.priceNote,
      ].filter(Boolean).join(' · ');
      return '<div class="tgto-pricebar">'
        + '<div class="tgto-price" data-role="pricebar">' + esc(price) + ' <small>per person sharing</small></div>'
        + '<div class="tgto-avail" data-role="avail" hidden></div>'
        + '<button type="button" class="tgto-cta" data-role="enquire-cta">Enquire now</button>'
        + (notes ? '<div class="tgto-price-note">' + esc(notes) + '</div>' : '')
        + '</div>';
    }

    _form(e) {
      return '<section class="tgto-enquire" data-role="enquiry">'
        + '<h2 class="tgto-h2" data-role="enquiry-heading">' + esc(e.heading) + '</h2>'
        + (e.intro ? '<p class="tgto-p">' + esc(e.intro) + '</p>' : '')
        + '<form class="tgto-form" data-role="form" novalidate>'
        + '<div class="tgto-field"><label for="tgto-name">Name <span class="req">*</span></label>'
        + '<input class="tgto-input" id="tgto-name" name="name" type="text" maxlength="80" autocomplete="name" required></div>'
        + '<div class="tgto-field"><label for="tgto-email">Email <span class="req">*</span></label>'
        + '<input class="tgto-input" id="tgto-email" name="email" type="email" maxlength="254" autocomplete="email" required></div>'
        + '<div class="tgto-field"><label for="tgto-phone">Phone</label>'
        + '<input class="tgto-input" id="tgto-phone" name="phone" type="tel" maxlength="30" autocomplete="tel"></div>'
        + '<div class="tgto-field"><label for="tgto-party">How many travelling</label>'
        + '<select class="tgto-select" id="tgto-party" name="partySize">'
        + Array.from({ length: 20 }, (_, i) => '<option value="' + (i + 1) + '">' + (i + 1) + (i === 0 ? ' person' : ' people') + '</option>').join('')
        + '</select></div>'
        + '<div class="tgto-field tgto-span2"><label for="tgto-message">Your message</label>'
        + '<textarea class="tgto-textarea" id="tgto-message" name="message" maxlength="2000" placeholder="Tell us your preferred dates or any questions"></textarea></div>'
        + '<div class="tgto-hp" aria-hidden="true"><label>Do not fill this in<input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>'
        + '<div class="tgto-field tgto-span2"><label class="tgto-consent"><input type="checkbox" name="marketingConsent" value="1"><span>Keep me posted about this and similar tours.</span></label></div>'
        + '<div class="tgto-field tgto-span2">'
        + '<button type="submit" class="tgto-submit" data-role="submit">' + esc(e.buttonText) + '</button>'
        + '<div class="tgto-status" data-role="status" role="status" aria-live="polite"></div>'
        + '</div></form></section>';
    }

    _render() {
      const c = this.cfg, t = c.tour, dz = c.design;
      if (!t.title) {
        this.shadow.innerHTML = '';
        this.el.setAttribute('data-tg-hidden', 'unconfigured');
        return;
      }
      this.el.removeAttribute('data-tg-hidden');
      ensureFont(dz.fontFamily);
      const sym = currencySymbol(t.currency);

      this.root = document.createElement('div');
      this.root.className = 'tgto-root';
      this.root.setAttribute('data-theme', dz.theme);
      if (dz.brandColor) { this.root.style.setProperty('--tgto-brand', dz.brandColor); this.root.style.setProperty('--tgto-brand-hover', dz.brandColor); }
      if (dz.accentColor) this.root.style.setProperty('--tgto-accent', dz.accentColor);
      this.root.style.setProperty('--tgto-radius', dz.radius + 'px');
      this.root.style.setProperty('--tgto-font', fontStack(dz.fontFamily));

      this.root.innerHTML =
        '<div class="tgto-wrap">'
        + this._hero(t, sym)
        + this._glance(c.glance)
        + this._highlights(c.highlights)
        + this._days(c.days, sym)
        + this._extras(c.extras, sym)
        + this._incex(c.included, c.excluded)
        + this._sections(c.sections)
        + this._gallery(c.gallery)
        + this._pricebar(t, sym)
        + this._form(c.enquiry)
        + '<div class="tgto-foot">Prices and availability confirmed at time of enquiry.</div>'
        + '</div>';

      this.shadow.innerHTML = '<style>' + STYLES + '</style>';
      this.shadow.appendChild(this.root);
      this._bind();
    }

    _bind() {
      const cta = this.root.querySelector('[data-role="enquire-cta"]');
      const form = this.root.querySelector('[data-role="form"]');
      const enquiry = this.root.querySelector('[data-role="enquiry"]');
      if (cta && enquiry) {
        cta.addEventListener('click', () => {
          try { enquiry.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch { enquiry.scrollIntoView(); }
          const nameEl = this.root.querySelector('#tgto-name');
          if (nameEl) { try { nameEl.focus({ preventScroll: true }); } catch { nameEl.focus(); } }
        });
      }
      if (form) form.addEventListener('submit', (ev) => { ev.preventDefault(); this._submit(form); });

      // Collapsible days — click (or Enter/Space via native button) to toggle.
      this.root.querySelectorAll('.tgto-day-head').forEach((head) => {
        head.addEventListener('click', () => {
          const day = head.closest('.tgto-day');
          const open = day.classList.toggle('is-open');
          head.setAttribute('aria-expanded', open ? 'true' : 'false');
        });
      });

      this._loadAvailability();
    }

    _loadAvailability() {
      if (!this.widgetId) return;
      const node = this.root && this.root.querySelector('[data-role="avail"]');
      if (!node) return;
      const token = (this._availToken = (this._availToken || 0) + 1);
      fetch(AVAIL_URL + '?widgetId=' + encodeURIComponent(this.widgetId))
        .then(function (r) { return r.ok ? r.json() : null; })
        .then((d) => {
          if (token !== this._availToken) return;
          if (!d || !d.ok || !d.available) return;
          if (d.soldOut) { node.textContent = 'Sold out'; node.className = 'tgto-avail is-sold'; node.hidden = false; }
          else if (typeof d.remaining === 'number' && d.remaining > 0) {
            node.textContent = (d.remaining <= 5 ? 'Only ' : '') + d.remaining + (d.remaining === 1 ? ' place left' : ' places left');
            node.className = 'tgto-avail' + (d.remaining <= 5 ? ' is-low' : ''); node.hidden = false;
          }
        })
        .catch(function () { /* stay silent */ });
    }

    async _submit(form) {
      if (this._submitting) return;
      const statusEl = this.root.querySelector('[data-role="status"]');
      const submitEl = this.root.querySelector('[data-role="submit"]');
      const setStatus = (msg, cls) => { if (statusEl) { statusEl.textContent = msg; statusEl.className = 'tgto-status' + (cls ? ' ' + cls : ''); } };
      const data = new FormData(form);
      if (data.get('website')) { this._thanks(); return; }
      const name = String(data.get('name') || '').trim();
      const email = String(data.get('email') || '').trim();
      if (!name) { setStatus('Please add your name.', 'err'); return; }
      if (!isEmail(email)) { setStatus('Please enter a valid email address.', 'err'); return; }
      if (!this.widgetId) { setStatus('This is a preview — enquiries are only sent from a saved, embedded tour.', 'ok'); return; }

      const payload = {
        widgetId: this.widgetId, name, email,
        phone: String(data.get('phone') || '').trim(),
        partySize: parseInt(data.get('partySize'), 10) || 1,
        message: String(data.get('message') || '').trim(),
        marketingConsent: !!data.get('marketingConsent'),
        website: '',
        sourceUrl: (typeof location !== 'undefined' ? location.href : '').slice(0, 1000),
        referrer: (typeof document !== 'undefined' ? document.referrer : '').slice(0, 500),
      };
      this._submitting = true;
      if (submitEl) submitEl.disabled = true;
      setStatus('Sending your enquiry…', '');
      try {
        const res = await fetch(ENQUIRY_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const out = await res.json().catch(() => ({}));
        if (res.ok && out.ok) { this._thanks(); }
        else { setStatus(out.error || 'Something went wrong. Please try again.', 'err'); this._submitting = false; if (submitEl) submitEl.disabled = false; }
      } catch (err) {
        setStatus('Could not send just now. Please try again in a moment.', 'err');
        this._submitting = false; if (submitEl) submitEl.disabled = false;
      }
    }

    _thanks() {
      const wrap = this.root.querySelector('[data-role="enquiry"]');
      if (!wrap) return;
      wrap.innerHTML = '<div class="tgto-thanks" data-role="thanks">' + IC.check
        + '<h3>Enquiry sent</h3><p class="tgto-p" style="margin:0">' + esc(this.cfg.enquiry.successMessage) + '</p></div>';
    }

    update(config) {
      const merged = {};
      const keys = ['tour', 'enquiry', 'design'];
      for (const k of keys) merged[k] = Object.assign({}, this.cfg[k], config && config[k]);
      for (const k of ['glance', 'highlights', 'days', 'extras', 'included', 'excluded', 'sections', 'gallery']) {
        merged[k] = (config && config[k] !== undefined) ? config[k] : this.cfg[k];
      }
      this.cfg = this._defaults(merged);
      if (config && config._widgetId) this.widgetId = config._widgetId;
      this._submitting = false;
      this._render();
    }

    destroy() { this.shadow.innerHTML = ''; this.el.removeAttribute('data-tg-hidden'); }
  }

  // ── Auto-init ───────────────────────────────────────────────────────────────
  async function loadConfigFromApi(widgetId) {
    try {
      const res = await fetch(API_BASE + '?id=' + encodeURIComponent(widgetId));
      if (!res.ok) throw new Error('Config load failed: ' + res.status);
      const data = await res.json();
      if (data && data.config) return Object.assign({}, data.config, { _widgetId: widgetId });
      throw new Error('No config returned');
    } catch (err) { console.error('[TGTour] Config load error:', err); return null; }
  }

  async function init() {
    const containers = document.querySelectorAll('[data-tg-widget="tour"]');
    for (const el of containers) {
      if (el._tgInitialised || el.shadowRoot) continue;
      el._tgInitialised = true;
      let config = null;
      const inline = el.getAttribute('data-tg-config');
      const widgetId = el.getAttribute('data-tg-id');
      if (inline) {
        try { config = JSON.parse(inline); } catch (e) { console.error('[TGTour] Invalid inline config:', e); continue; }
      } else if (widgetId) {
        config = await loadConfigFromApi(widgetId);
        if (!config) continue;
      } else { config = {}; }
      new TGTourWidget(el, config);
    }
  }

  if (typeof window !== 'undefined') {
    window.TGTourWidget = TGTourWidget;
    window.__TG_TOUR_VERSION__ = VERSION;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }
})();
