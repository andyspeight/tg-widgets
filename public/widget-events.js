/**
 * Travelgenix Event Calendar Widget v1.0.0
 * Self-contained, embeddable widget
 * Zero dependencies — works on any website via a single script tag
 *
 * Layouts:
 *   month   — grid calendar with events overlaid on dates
 *   list    — chronological list with month dividers
 *   card    — featured-card carousel of upcoming events
 *
 * Data sources:
 *   1. Travelgenix curated events (festivals, holidays, sporting events)
 *      — pulled live from the global Events Calendar at /api/events-content
 *   2. Custom events added by the client in the editor
 *
 * Usage:
 *   <div data-tg-widget="events" data-tg-id="YOUR_WIDGET_ID"></div>
 *   <script src="https://tg-widgets.vercel.app/widget-events.js"></script>
 */
(function () {
  'use strict';

  const API_BASE   = (typeof window !== 'undefined' && window.__TG_WIDGET_API__)   || '/api/widget-config';
  const EVENTS_API = (typeof window !== 'undefined' && window.__TG_EVENTS_API__)   || '/api/events-content';
  const VERSION = '1.0.0';

  // ---------- Helpers ----------
  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function safeUrl(url) {
    if (!url || typeof url !== 'string') return '';
    const t = url.trim();
    if (!t) return '';
    if (t.startsWith('/') || t.startsWith('#')) return t;
    try {
      const u = new URL(t);
      if (['https:', 'http:', 'mailto:', 'tel:'].includes(u.protocol)) return u.href;
      return '';
    } catch { return ''; }
  }

  function safeImageUrl(url) {
    if (!url || typeof url !== 'string') return '';
    const t = url.trim();
    if (!t) return '';
    try {
      const u = new URL(t);
      if (u.protocol === 'https:' || u.protocol === 'http:') return u.href;
      return '';
    } catch { return ''; }
  }

  function hexToRgb(hex) {
    if (!hex || typeof hex !== 'string') return '';
    let h = hex.trim().replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    if (!/^[0-9a-f]{6}$/i.test(h)) return '';
    const n = parseInt(h, 16);
    return ((n >> 16) & 255) + ', ' + ((n >> 8) & 255) + ', ' + (n & 255);
  }

  // Parse YYYY-MM-DD strictly, no timezone shifts. Returns Date at local midnight.
  function parseDate(s) {
    if (!s || typeof s !== 'string') return null;
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    const y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    const dt = new Date(y, mo - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
    return dt;
  }

  function fmtDate(dt) {
    if (!dt) return '';
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  }

  const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const DAY_NAMES   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const DAY_NAMES_LONG = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

  function startOfMonth(dt) { return new Date(dt.getFullYear(), dt.getMonth(), 1); }
  function endOfMonth(dt)   { return new Date(dt.getFullYear(), dt.getMonth() + 1, 0); }
  function addMonths(dt, n) { return new Date(dt.getFullYear(), dt.getMonth() + n, 1); }
  function sameDay(a, b) { return a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }

  function dateInRange(d, start, end) {
    if (!d || !start) return false;
    const s = start.getTime();
    const e = end ? end.getTime() : s;
    const t = d.getTime();
    return t >= s && t <= e;
  }

  function ordinal(n) {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  function fmtRange(startStr, endStr, locale) {
    const s = parseDate(startStr);
    const e = endStr ? parseDate(endStr) : null;
    if (!s) return '';
    if (!e || sameDay(s, e)) {
      return ordinal(s.getDate()) + ' ' + MONTH_SHORT[s.getMonth()] + ' ' + s.getFullYear();
    }
    if (s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()) {
      return s.getDate() + '–' + e.getDate() + ' ' + MONTH_SHORT[s.getMonth()] + ' ' + s.getFullYear();
    }
    if (s.getFullYear() === e.getFullYear()) {
      return s.getDate() + ' ' + MONTH_SHORT[s.getMonth()] + ' – ' + e.getDate() + ' ' + MONTH_SHORT[e.getMonth()] + ' ' + s.getFullYear();
    }
    return s.getDate() + ' ' + MONTH_SHORT[s.getMonth()] + ' ' + s.getFullYear() + ' – ' + e.getDate() + ' ' + MONTH_SHORT[e.getMonth()] + ' ' + e.getFullYear();
  }

  // ---------- Inline icons ----------
  function svgPath(d, cls) {
    return '<svg class="' + (cls || '') + '" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">'
      + '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="' + d + '"/></svg>';
  }
  const IC = {
    chevL: 'M15 19l-7-7 7-7',
    chevR: 'M9 5l7 7-7 7',
    close: 'M6 18L18 6M6 6l12 12',
    cal:   'M8 7V3M16 7V3M3.5 11h17M5 5h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2z',
    pin:   'M12 11a3 3 0 100-6 3 3 0 000 6zM12 22s-7-7-7-13a7 7 0 1114 0c0 6-7 13-7 13z',
    grid:  'M3 12h18M3 6h18M3 18h18',
    list:  'M4 6h16M4 12h16M4 18h16',
    card:  'M3 5a2 2 0 012-2h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5z',
    arrow: 'M5 12h14M12 5l7 7-7 7',
    plus:  'M12 4v16m8-8H4',
  };

  // ---------- Default config ----------
  const DEFAULTS = {
    name: 'Event Calendar',

    // Layout
    layout: 'list',            // month | list | card
    monthsAhead: 6,            // list & card view: how far forward to look
    cardCount: 6,              // card view: how many to show

    // Header
    showHeader: true,
    title: 'Upcoming events',
    subtitle: 'Festivals, holidays and travel highlights',
    showLayoutSwitcher: true,

    // Filters
    showFilters: true,
    showCategoryFilter: true,
    showCountryFilter: false,  // off by default — only meaningful for global decks
    defaultCategory: 'all',

    // Travelgenix curated events
    useCuratedEvents: true,
    curatedCountries: [],      // array of country names; empty = all
    curatedCategories: [],     // array of category names; empty = all
    curatedAudience: [],       // multipleSelects from Events Calendar

    // Custom (client-added) events
    customEvents: [
      // { id, name, startDate, endDate, category, location, description, url, image, color }
    ],

    // Behaviour
    onClick: 'modal',          // modal | link | none
    showLocations: true,
    showDescriptions: true,
    showImages: true,

    // Theme
    theme: 'light',            // light | dark | auto
    brand: '#F97316',
    accent: '#0891B2',
    bg: '#FFFFFF',
    text: '#0F172A',
    sub: '#64748B',
    border: '#E2E8F0',
    radius: 16,
    fontFamily: '',

    // Reduced motion handled via media query
    widgetId: '',
  };

  // ---------- Category metadata (deterministic colours) ----------
  // The curated table has these single-select category options (case-insensitive matched).
  // Custom events can use any of these or any free-text label.
  const CAT_PALETTE = [
    { match: ['festival', 'cultural'],            color: '#A855F7', icon: '🎉' },
    { match: ['holiday', 'public holiday'],       color: '#EF4444', icon: '🏖️' },
    { match: ['sport', 'sporting'],               color: '#10B981', icon: '🏆' },
    { match: ['music', 'concert'],                color: '#EC4899', icon: '🎵' },
    { match: ['food', 'food and drink'],          color: '#F59E0B', icon: '🍽️' },
    { match: ['religious', 'spiritual'],          color: '#6366F1', icon: '🕊️' },
    { match: ['awareness', 'observance', 'day'],  color: '#0EA5E9', icon: '📅' },
    { match: ['travel', 'event'],                 color: '#0891B2', icon: '✈️' },
    { match: ['business', 'trade'],               color: '#475569', icon: '💼' },
  ];
  function categoryMeta(cat) {
    const c = (cat || '').toLowerCase().trim();
    for (const p of CAT_PALETTE) {
      if (p.match.some(m => c.includes(m))) return { color: p.color, icon: p.icon };
    }
    // Hash-based fallback colour for any unknown category
    let h = 0;
    for (let i = 0; i < c.length; i++) h = ((h << 5) - h + c.charCodeAt(i)) | 0;
    const fallbacks = ['#0891B2', '#7C3AED', '#16A34A', '#EA580C', '#DB2777', '#0F766E'];
    return { color: fallbacks[Math.abs(h) % fallbacks.length], icon: '📅' };
  }

  // ---------- Styles ----------
  const STYLES = `
    :host { all: initial; display: block; }
    *, *::before, *::after { box-sizing: border-box; }

    .tge-root {
      --tge-brand: #F97316;
      --tge-brand-rgb: 249, 115, 22;
      --tge-accent: #0891B2;
      --tge-bg: #FFFFFF;
      --tge-bg-alt: #F8FAFC;
      --tge-text: #0F172A;
      --tge-sub: #64748B;
      --tge-border: #E2E8F0;
      --tge-border-strong: #CBD5E1;
      --tge-radius: 16px;
      --tge-radius-sm: 10px;
      --tge-shadow: 0 1px 2px rgba(15, 23, 42, .04), 0 8px 24px rgba(15, 23, 42, .06);
      --tge-shadow-md: 0 4px 12px rgba(15, 23, 42, .08), 0 16px 40px rgba(15, 23, 42, .08);
      --tge-font: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-family: var(--tge-font);
      font-size: 15px;
      line-height: 1.5;
      color: var(--tge-text);
      display: block;
      width: 100%;
    }
    .tge-root[data-theme="dark"] {
      --tge-bg: #0F172A;
      --tge-bg-alt: #1E293B;
      --tge-text: #F1F5F9;
      --tge-sub: #94A3B8;
      --tge-border: #334155;
      --tge-border-strong: #475569;
      --tge-shadow: 0 1px 2px rgba(0, 0, 0, .3), 0 8px 24px rgba(0, 0, 0, .4);
      --tge-shadow-md: 0 4px 12px rgba(0, 0, 0, .35), 0 16px 40px rgba(0, 0, 0, .5);
    }

    .tge-shell {
      background: var(--tge-bg);
      color: var(--tge-text);
      border-radius: var(--tge-radius);
      border: 1px solid var(--tge-border);
      overflow: hidden;
    }

    /* ---------- Header ---------- */
    .tge-header {
      padding: 20px 24px 16px;
      border-bottom: 1px solid var(--tge-border);
      display: flex;
      gap: 14px;
      align-items: flex-end;
      flex-wrap: wrap;
    }
    .tge-title-block { flex: 1; min-width: 200px; }
    .tge-title {
      font-size: 22px;
      font-weight: 700;
      line-height: 1.2;
      letter-spacing: -0.01em;
      margin: 0 0 4px;
    }
    .tge-subtitle {
      font-size: 14px;
      color: var(--tge-sub);
      margin: 0;
    }

    .tge-switcher {
      display: inline-flex;
      gap: 2px;
      padding: 3px;
      background: var(--tge-bg-alt);
      border: 1px solid var(--tge-border);
      border-radius: 10px;
    }
    .tge-switcher button {
      all: unset;
      cursor: pointer;
      padding: 7px 12px;
      font-size: 13px;
      font-weight: 600;
      color: var(--tge-sub);
      border-radius: 7px;
      transition: background 160ms ease, color 160ms ease;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .tge-switcher button:hover { color: var(--tge-text); }
    .tge-switcher button[aria-pressed="true"] {
      background: var(--tge-bg);
      color: var(--tge-text);
      box-shadow: 0 1px 2px rgba(15, 23, 42, .06);
    }
    .tge-switcher svg { width: 14px; height: 14px; flex-shrink: 0; }

    /* ---------- Filters bar ---------- */
    .tge-filters {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      padding: 14px 24px;
      border-bottom: 1px solid var(--tge-border);
      background: var(--tge-bg-alt);
    }
    .tge-chip {
      all: unset;
      cursor: pointer;
      padding: 6px 12px;
      font-size: 13px;
      font-weight: 500;
      color: var(--tge-sub);
      background: var(--tge-bg);
      border: 1px solid var(--tge-border);
      border-radius: 99px;
      transition: all 160ms ease;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .tge-chip:hover {
      border-color: var(--tge-border-strong);
      color: var(--tge-text);
    }
    .tge-chip[aria-pressed="true"] {
      background: var(--tge-text);
      color: var(--tge-bg);
      border-color: var(--tge-text);
    }
    .tge-chip-dot {
      width: 8px;
      height: 8px;
      border-radius: 99px;
      background: currentColor;
      opacity: 0.7;
    }

    /* ---------- LIST view ---------- */
    .tge-list { padding: 8px 0; }
    .tge-list-month {
      padding: 14px 24px 6px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--tge-sub);
      position: sticky;
      top: 0;
      background: var(--tge-bg);
      z-index: 1;
    }
    .tge-list-item {
      display: grid;
      grid-template-columns: 78px 1fr auto;
      gap: 18px;
      padding: 14px 24px;
      align-items: center;
      cursor: pointer;
      border-top: 1px solid var(--tge-border);
      transition: background 160ms ease;
    }
    .tge-list-item:first-child { border-top: 0; }
    .tge-list-item:hover { background: var(--tge-bg-alt); }

    .tge-list-date {
      text-align: center;
      padding: 8px 0;
      border-radius: var(--tge-radius-sm);
      background: var(--tge-bg-alt);
      border: 1px solid var(--tge-border);
    }
    .tge-list-day {
      font-size: 22px;
      font-weight: 800;
      line-height: 1;
      letter-spacing: -0.02em;
    }
    .tge-list-mon {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--tge-sub);
      margin-top: 4px;
    }
    .tge-list-content { min-width: 0; }
    .tge-list-name {
      font-size: 16px;
      font-weight: 600;
      line-height: 1.3;
      letter-spacing: -0.005em;
      margin: 0 0 4px;
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .tge-list-name-text {
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .tge-list-meta {
      font-size: 13px;
      color: var(--tge-sub);
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }
    .tge-list-meta svg { width: 13px; height: 13px; flex-shrink: 0; }
    .tge-list-meta-item { display: inline-flex; align-items: center; gap: 4px; }
    .tge-cat-tag {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 2px 8px;
      font-size: 11px;
      font-weight: 600;
      border-radius: 99px;
      background: rgba(var(--tge-cat-rgb, 8, 145, 178), 0.10);
      color: var(--tge-cat, var(--tge-accent));
      letter-spacing: 0.01em;
    }
    .tge-cat-tag-dot {
      width: 6px;
      height: 6px;
      border-radius: 99px;
      background: currentColor;
    }
    .tge-list-arrow {
      color: var(--tge-sub);
      transition: transform 200ms cubic-bezier(0.16, 1, 0.3, 1), color 160ms ease;
    }
    .tge-list-arrow svg { width: 18px; height: 18px; }
    .tge-list-item:hover .tge-list-arrow {
      color: var(--tge-brand);
      transform: translateX(3px);
    }

    /* ---------- MONTH view ---------- */
    .tge-month-nav {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      border-bottom: 1px solid var(--tge-border);
    }
    .tge-month-title {
      font-size: 17px;
      font-weight: 700;
      letter-spacing: -0.01em;
    }
    .tge-month-nav-btns { display: inline-flex; gap: 4px; }
    .tge-icon-btn {
      all: unset;
      cursor: pointer;
      width: 32px;
      height: 32px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 8px;
      color: var(--tge-sub);
      transition: background 160ms ease, color 160ms ease;
    }
    .tge-icon-btn:hover { background: var(--tge-bg-alt); color: var(--tge-text); }
    .tge-icon-btn svg { width: 16px; height: 16px; }
    .tge-today-btn {
      all: unset;
      cursor: pointer;
      padding: 6px 12px;
      font-size: 13px;
      font-weight: 600;
      color: var(--tge-text);
      background: var(--tge-bg);
      border: 1px solid var(--tge-border);
      border-radius: 8px;
      transition: background 160ms ease, border-color 160ms ease;
    }
    .tge-today-btn:hover {
      background: var(--tge-bg-alt);
      border-color: var(--tge-border-strong);
    }

    .tge-grid {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      background: var(--tge-border);
      gap: 1px;
      border-bottom: 1px solid var(--tge-border);
    }
    .tge-dow {
      padding: 10px 8px;
      text-align: center;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--tge-sub);
      background: var(--tge-bg-alt);
    }
    .tge-cell {
      min-height: 100px;
      padding: 8px;
      background: var(--tge-bg);
      display: flex;
      flex-direction: column;
      gap: 4px;
      cursor: default;
      transition: background 160ms ease;
    }
    .tge-cell.tge-cell--off { background: var(--tge-bg-alt); opacity: 0.55; }
    .tge-cell.tge-cell--has:hover { background: var(--tge-bg-alt); }
    .tge-cell-num {
      font-size: 13px;
      font-weight: 600;
      color: var(--tge-text);
      width: 26px;
      height: 26px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 99px;
      flex-shrink: 0;
    }
    .tge-cell--today .tge-cell-num {
      background: var(--tge-brand);
      color: #FFFFFF;
    }
    .tge-cell-pill {
      display: block;
      padding: 3px 7px;
      font-size: 11px;
      font-weight: 600;
      line-height: 1.3;
      border-radius: 5px;
      background: rgba(var(--tge-cat-rgb, 8, 145, 178), 0.12);
      color: var(--tge-cat, var(--tge-accent));
      cursor: pointer;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      border-left: 3px solid var(--tge-cat, var(--tge-accent));
      transition: background 160ms ease;
    }
    .tge-cell-pill:hover { background: rgba(var(--tge-cat-rgb, 8, 145, 178), 0.20); }
    .tge-cell-more {
      font-size: 10px;
      color: var(--tge-sub);
      font-weight: 600;
      cursor: pointer;
      padding: 2px 4px;
    }
    .tge-cell-more:hover { color: var(--tge-text); }

    /* ---------- CARD view ---------- */
    .tge-cards {
      padding: 20px 24px 24px;
      display: grid;
      gap: 16px;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    }
    .tge-card {
      background: var(--tge-bg);
      border: 1px solid var(--tge-border);
      border-radius: var(--tge-radius);
      overflow: hidden;
      cursor: pointer;
      transition: transform 220ms cubic-bezier(0.16, 1, 0.3, 1), box-shadow 220ms ease, border-color 160ms ease;
      display: flex;
      flex-direction: column;
    }
    .tge-card:hover {
      transform: translateY(-3px);
      box-shadow: var(--tge-shadow-md);
      border-color: var(--tge-border-strong);
    }
    .tge-card-img {
      aspect-ratio: 16 / 10;
      background: var(--tge-bg-alt);
      background-size: cover;
      background-position: center;
      position: relative;
    }
    .tge-card-img--placeholder {
      background-image: linear-gradient(135deg, rgba(var(--tge-cat-rgb, 8, 145, 178), 0.18), rgba(var(--tge-cat-rgb, 8, 145, 178), 0.08));
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 56px;
      filter: saturate(1.1);
    }
    .tge-card-cat-badge {
      position: absolute;
      top: 10px;
      left: 10px;
      padding: 4px 10px;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      border-radius: 99px;
      background: var(--tge-cat, var(--tge-accent));
      color: #FFFFFF;
    }
    .tge-card-date-badge {
      position: absolute;
      top: 10px;
      right: 10px;
      padding: 4px 10px;
      font-size: 11px;
      font-weight: 600;
      border-radius: 8px;
      background: rgba(15, 23, 42, 0.7);
      color: #FFFFFF;
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
    }
    .tge-card-body {
      padding: 14px 16px 16px;
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .tge-card-name {
      font-size: 16px;
      font-weight: 700;
      line-height: 1.3;
      letter-spacing: -0.005em;
      margin: 0;
    }
    .tge-card-meta {
      font-size: 13px;
      color: var(--tge-sub);
      display: flex;
      align-items: center;
      gap: 5px;
    }
    .tge-card-meta svg { width: 13px; height: 13px; }
    .tge-card-desc {
      font-size: 13px;
      color: var(--tge-sub);
      line-height: 1.5;
      margin-top: 4px;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    /* ---------- Empty / loading ---------- */
    .tge-empty {
      padding: 48px 24px;
      text-align: center;
      color: var(--tge-sub);
    }
    .tge-empty-ico {
      width: 48px;
      height: 48px;
      margin: 0 auto 12px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 99px;
      background: var(--tge-bg-alt);
      color: var(--tge-sub);
    }
    .tge-empty-ico svg { width: 24px; height: 24px; }
    .tge-empty-title {
      font-weight: 600;
      color: var(--tge-text);
      margin-bottom: 4px;
    }
    .tge-loading {
      padding: 32px;
      text-align: center;
      color: var(--tge-sub);
      font-size: 14px;
    }
    .tge-spinner {
      display: inline-block;
      width: 18px;
      height: 18px;
      border-radius: 99px;
      border: 2px solid var(--tge-border);
      border-top-color: var(--tge-brand);
      animation: tge-spin 800ms linear infinite;
      vertical-align: middle;
      margin-right: 8px;
    }
    @keyframes tge-spin { to { transform: rotate(360deg); } }

    /* ---------- Modal ---------- */
    .tge-modal-bg {
      position: fixed;
      inset: 0;
      background: rgba(15, 23, 42, 0.55);
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
      z-index: 2147483646;
      opacity: 0;
      transition: opacity 200ms ease;
    }
    .tge-modal-bg.tge-open { opacity: 1; }
    .tge-modal {
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      pointer-events: none;
    }
    .tge-modal-card {
      pointer-events: auto;
      background: var(--tge-bg);
      color: var(--tge-text);
      border-radius: var(--tge-radius);
      box-shadow: var(--tge-shadow-md);
      max-width: 520px;
      width: 100%;
      max-height: 85vh;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      transform: translateY(16px) scale(0.97);
      opacity: 0;
      transition: transform 280ms cubic-bezier(0.16, 1, 0.3, 1), opacity 200ms ease;
    }
    .tge-modal-card.tge-open { transform: translateY(0) scale(1); opacity: 1; }
    .tge-modal-img {
      width: 100%;
      aspect-ratio: 16 / 9;
      background-size: cover;
      background-position: center;
      background-color: var(--tge-bg-alt);
    }
    .tge-modal-body {
      padding: 22px 24px 24px;
      overflow-y: auto;
    }
    .tge-modal-close {
      position: absolute;
      top: 12px;
      right: 12px;
      width: 32px;
      height: 32px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 99px;
      background: rgba(15, 23, 42, 0.6);
      color: #FFFFFF;
      border: 0;
      cursor: pointer;
      transition: background 160ms ease;
    }
    .tge-modal-close:hover { background: rgba(15, 23, 42, 0.85); }
    .tge-modal-close svg { width: 16px; height: 16px; }
    .tge-modal-cat {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 99px;
      background: rgba(var(--tge-cat-rgb, 8, 145, 178), 0.12);
      color: var(--tge-cat, var(--tge-accent));
      font-size: 12px;
      font-weight: 600;
      margin-bottom: 12px;
    }
    .tge-modal-name {
      font-size: 22px;
      font-weight: 700;
      line-height: 1.25;
      letter-spacing: -0.015em;
      margin: 0 0 10px;
    }
    .tge-modal-meta {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-bottom: 14px;
      font-size: 14px;
      color: var(--tge-sub);
    }
    .tge-modal-meta-row { display: flex; align-items: center; gap: 8px; }
    .tge-modal-meta svg { width: 15px; height: 15px; flex-shrink: 0; }
    .tge-modal-desc {
      font-size: 14px;
      color: var(--tge-text);
      line-height: 1.6;
      margin-bottom: 16px;
    }
    .tge-modal-cta {
      all: unset;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 10px 18px;
      font-size: 14px;
      font-weight: 600;
      background: var(--tge-brand);
      color: #FFFFFF;
      border-radius: 10px;
      transition: filter 160ms ease, transform 160ms ease;
    }
    .tge-modal-cta:hover { filter: brightness(1.07); }
    .tge-modal-cta:active { transform: scale(0.97); }
    .tge-modal-cta svg { width: 14px; height: 14px; }

    /* ---------- Responsive ---------- */
    @media (max-width: 640px) {
      .tge-header { padding: 16px; flex-direction: column; align-items: stretch; }
      .tge-filters { padding: 12px 16px; }
      .tge-list-item { grid-template-columns: 56px 1fr auto; gap: 12px; padding: 12px 16px; }
      .tge-list-day { font-size: 18px; }
      .tge-list-month { padding: 12px 16px 4px; }
      .tge-cell { min-height: 64px; padding: 4px; }
      .tge-cell-num { font-size: 12px; width: 22px; height: 22px; }
      .tge-cell-pill { font-size: 10px; padding: 2px 5px; }
      .tge-month-nav { padding: 10px 12px; }
      .tge-month-title { font-size: 15px; }
      .tge-cards { padding: 16px; gap: 12px; }
      .tge-modal-name { font-size: 18px; }
    }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: 0.001ms !important;
        transition-duration: 0.001ms !important;
      }
    }
  `;

  // ---------- Event normalisation ----------
  // Both curated (from Airtable via API) and custom (from config) events get
  // normalised into the same shape so the renderers don't care which source they came from.
  function normaliseEvents(rawList, source) {
    if (!Array.isArray(rawList)) return [];
    const out = [];
    for (const raw of rawList) {
      if (!raw || typeof raw !== 'object') continue;
      const name = String(raw.name || raw.eventName || '').trim().slice(0, 200);
      if (!name) continue;

      const startStr = String(raw.startDate || raw.dateStart || '').slice(0, 10);
      const start = parseDate(startStr);
      if (!start) continue;

      const endStr = String(raw.endDate || raw.dateEnd || raw.startDate || '').slice(0, 10);
      const end = parseDate(endStr) || start;

      const cat = String(raw.category || '').trim().slice(0, 60) || 'Event';
      const meta = categoryMeta(cat);

      out.push({
        id: String(raw.id || (source + ':' + name + ':' + startStr)).slice(0, 100),
        source: source,
        name: name,
        startDate: fmtDate(start),
        endDate: fmtDate(end),
        startTs: start.getTime(),
        endTs: end.getTime(),
        category: cat,
        location: String(raw.location || raw.destinations || '').trim().slice(0, 200),
        countries: String(raw.countries || '').trim().slice(0, 200),
        description: String(raw.description || raw.travelAngle || '').trim().slice(0, 800),
        url: safeUrl(raw.url || raw.ctaUrl || ''),
        image: safeImageUrl(raw.image || ''),
        catColor: raw.color && /^#[0-9a-fA-F]{6}$/.test(raw.color) ? raw.color : meta.color,
        catIcon: meta.icon,
      });
    }
    out.sort((a, b) => a.startTs - b.startTs);
    return out;
  }

  // ---------- Main widget class ----------
  class TGEventsWidget {
    constructor(container, config) {
      this.el = container;
      this.cfg = Object.assign({}, DEFAULTS, config || {});
      this.shadow = container.attachShadow({ mode: 'open' });

      // Internal state
      this.layout = this.cfg.layout || 'list';
      this.activeCategory = this.cfg.defaultCategory || 'all';
      this.activeCountry  = 'all';
      this.viewedMonth = startOfMonth(new Date());
      this.curatedEvents = [];   // populated async
      this.curatedLoaded = false;
      this.curatedError = false;
      this._modalEl = null;
      this._kbdHandler = null;

      this._render();

      // Async fetch curated events
      if (this.cfg.useCuratedEvents !== false) {
        this._fetchCurated();
      } else {
        this.curatedLoaded = true;
        this._renderBody();
      }
    }

    // Combined event list, post-filters
    _allEvents() {
      const custom  = normaliseEvents(this.cfg.customEvents || [], 'custom');
      const curated = this.curatedEvents || [];
      return [...curated, ...custom].sort((a, b) => a.startTs - b.startTs);
    }

    _filtered(events) {
      const cat = (this.activeCategory || 'all').toLowerCase();
      const co  = (this.activeCountry  || 'all').toLowerCase();
      return events.filter(e => {
        if (cat !== 'all' && (e.category || '').toLowerCase() !== cat) return false;
        if (co  !== 'all' && !(e.countries || '').toLowerCase().includes(co)) return false;
        return true;
      });
    }

    _categories(events) {
      const set = new Set();
      events.forEach(e => { if (e.category) set.add(e.category); });
      return Array.from(set).sort();
    }

    async _fetchCurated() {
      if (!this.cfg.widgetId && !(this.cfg._directLevel && this.cfg._directRecord)) {
        // No widget ID — use editor-mode direct fetch via window flag, otherwise skip
        const params = this._buildCuratedQuery();
        if (!params) {
          this.curatedLoaded = true;
          this._renderBody();
          return;
        }
        try {
          const url = EVENTS_API + '?' + params.toString();
          const headers = (window.__TG_EDITOR_AUTH_HEADERS__ && typeof window.__TG_EDITOR_AUTH_HEADERS__ === 'function')
            ? window.__TG_EDITOR_AUTH_HEADERS__() : {};
          const r = await fetch(url, { headers });
          if (!r.ok) throw new Error('events-fetch-' + r.status);
          const j = await r.json();
          this.curatedEvents = normaliseEvents(j.events || [], 'curated');
        } catch (err) {
          this.curatedError = true;
        } finally {
          this.curatedLoaded = true;
          this._renderBody();
        }
        return;
      }

      try {
        const url = EVENTS_API + '?id=' + encodeURIComponent(this.cfg.widgetId);
        const r = await fetch(url);
        if (!r.ok) throw new Error('events-fetch-' + r.status);
        const j = await r.json();
        this.curatedEvents = normaliseEvents(j.events || [], 'curated');
      } catch (err) {
        this.curatedError = true;
      } finally {
        this.curatedLoaded = true;
        this._renderBody();
      }
    }

    _buildCuratedQuery() {
      // Editor-preview path: pass filters directly, requires auth header
      const cats = Array.isArray(this.cfg.curatedCategories) ? this.cfg.curatedCategories.slice(0, 12) : [];
      const cos  = Array.isArray(this.cfg.curatedCountries)  ? this.cfg.curatedCountries.slice(0, 24)  : [];
      const aud  = Array.isArray(this.cfg.curatedAudience)   ? this.cfg.curatedAudience.slice(0, 12)   : [];
      const params = new URLSearchParams();
      params.set('preview', '1');
      params.set('months', String(Math.min(24, Math.max(1, this.cfg.monthsAhead || 6))));
      cats.forEach(c => c && params.append('cat', c));
      cos.forEach(c => c && params.append('country', c));
      aud.forEach(a => a && params.append('aud', a));
      return params;
    }

    _render() {
      // Build the static skeleton with embedded styles. Body content rendered separately.
      const cfg = this.cfg;
      const fontImport = cfg.fontFamily ? `@import url('https://fonts.googleapis.com/css2?family=${encodeURIComponent(cfg.fontFamily)}:wght@400;500;600;700&display=swap');` : '';

      const brandRgb  = hexToRgb(cfg.brand) || '249, 115, 22';
      const accentHex = cfg.accent || '#0891B2';

      const inlineVars =
        '--tge-brand:' + (cfg.brand || '#F97316') + ';' +
        '--tge-brand-rgb:' + brandRgb + ';' +
        '--tge-accent:' + accentHex + ';' +
        (cfg.bg     ? '--tge-bg:' + cfg.bg + ';' : '') +
        (cfg.text   ? '--tge-text:' + cfg.text + ';' : '') +
        (cfg.sub    ? '--tge-sub:' + cfg.sub + ';' : '') +
        (cfg.border ? '--tge-border:' + cfg.border + ';' : '') +
        (cfg.radius ? '--tge-radius:' + Math.max(0, Math.min(40, cfg.radius)) + 'px;' : '') +
        (cfg.fontFamily ? "--tge-font:'" + cfg.fontFamily.replace(/'/g, "") + "', 'Inter', sans-serif;" : '');

      const theme = cfg.theme === 'dark' ? 'dark' : 'light';

      this.shadow.innerHTML = '<style>' + fontImport + STYLES + '</style>'
        + '<div class="tge-root" data-theme="' + theme + '" style="' + inlineVars + '">'
        + '<div class="tge-shell">'
        + this._renderHeader()
        + '<div class="tge-filters-mount"></div>'
        + '<div class="tge-body-mount"></div>'
        + '</div></div>';

      this._renderBody();
      this._bindHeader();
    }

    _renderHeader() {
      const cfg = this.cfg;
      if (!cfg.showHeader) return '';
      const switcher = cfg.showLayoutSwitcher
        ? '<div class="tge-switcher" role="group" aria-label="View">'
          + this._switchBtn('list',  'List',  IC.list)
          + this._switchBtn('month', 'Month', IC.cal)
          + this._switchBtn('card',  'Cards', IC.card)
          + '</div>'
        : '';
      return '<div class="tge-header">'
        + '<div class="tge-title-block">'
        + (cfg.title    ? '<h2 class="tge-title">' + esc(cfg.title) + '</h2>' : '')
        + (cfg.subtitle ? '<p class="tge-subtitle">' + esc(cfg.subtitle) + '</p>' : '')
        + '</div>'
        + switcher
        + '</div>';
    }

    _switchBtn(layout, label, iconPath) {
      const pressed = layout === this.layout;
      return '<button data-layout="' + layout + '" aria-pressed="' + pressed + '" type="button">'
        + svgPath(iconPath, '') + esc(label)
        + '</button>';
    }

    _bindHeader() {
      this.shadow.querySelectorAll('.tge-switcher button').forEach(btn => {
        btn.addEventListener('click', () => {
          const l = btn.getAttribute('data-layout');
          if (!l || l === this.layout) return;
          this.layout = l;
          this._render();
        });
      });
    }

    _renderBody() {
      const filtersMount = this.shadow.querySelector('.tge-filters-mount');
      const bodyMount    = this.shadow.querySelector('.tge-body-mount');
      if (!filtersMount || !bodyMount) return;

      if (!this.curatedLoaded && this.cfg.useCuratedEvents !== false) {
        filtersMount.innerHTML = '';
        bodyMount.innerHTML = '<div class="tge-loading"><span class="tge-spinner"></span> Loading events…</div>';
        return;
      }

      const all = this._allEvents();
      filtersMount.innerHTML = this._renderFilters(all);
      this._bindFilters();

      const filtered = this._filtered(all);

      if (this.layout === 'month') bodyMount.innerHTML = this._renderMonth(filtered);
      else if (this.layout === 'card') bodyMount.innerHTML = this._renderCards(filtered);
      else bodyMount.innerHTML = this._renderList(filtered);

      this._bindBody();
    }

    _renderFilters(events) {
      const cfg = this.cfg;
      if (!cfg.showFilters || !cfg.showCategoryFilter) return '';
      const cats = this._categories(events);
      if (cats.length <= 1) return '';
      const buttons = ['<button class="tge-chip" data-cat="all" aria-pressed="' + (this.activeCategory === 'all') + '" type="button">All events</button>']
        .concat(cats.map(c => {
          const meta = categoryMeta(c);
          const active = (this.activeCategory.toLowerCase() === c.toLowerCase());
          return '<button class="tge-chip" data-cat="' + esc(c) + '" aria-pressed="' + active + '" '
            + 'style="' + (!active ? '--tge-cat:' + meta.color + ';color:' + meta.color : '') + '" type="button">'
            + '<span class="tge-chip-dot" style="background:' + meta.color + '"></span>'
            + esc(c)
            + '</button>';
        }));
      return '<div class="tge-filters">' + buttons.join('') + '</div>';
    }

    _bindFilters() {
      this.shadow.querySelectorAll('.tge-chip[data-cat]').forEach(btn => {
        btn.addEventListener('click', () => {
          this.activeCategory = btn.getAttribute('data-cat') || 'all';
          this._renderBody();
        });
      });
    }

    _renderList(events) {
      const cfg = this.cfg;
      if (!events.length) return this._renderEmpty();

      // Group by month. Filter to those starting from today onwards if on the future-only path.
      const now = Date.now();
      const horizon = now + (cfg.monthsAhead || 6) * 31 * 86400000;
      const upcoming = events.filter(e => e.endTs >= now && e.startTs <= horizon);
      if (!upcoming.length) return this._renderEmpty();

      const out = [];
      let lastKey = '';
      for (const e of upcoming) {
        const dt = parseDate(e.startDate);
        if (!dt) continue;
        const key = dt.getFullYear() + '-' + dt.getMonth();
        if (key !== lastKey) {
          out.push('<div class="tge-list-month">' + MONTH_NAMES[dt.getMonth()] + ' ' + dt.getFullYear() + '</div>');
          lastKey = key;
        }
        const meta = categoryMeta(e.category);
        const catRgb = hexToRgb(e.catColor || meta.color) || '8, 145, 178';
        const dateRange = fmtRange(e.startDate, e.endDate);
        out.push(
          '<button class="tge-list-item" data-event-id="' + esc(e.id) + '" type="button" '
          + 'style="--tge-cat:' + (e.catColor || meta.color) + ';--tge-cat-rgb:' + catRgb + '">'
          + '<div class="tge-list-date">'
            + '<div class="tge-list-day">' + dt.getDate() + '</div>'
            + '<div class="tge-list-mon">' + MONTH_SHORT[dt.getMonth()] + '</div>'
          + '</div>'
          + '<div class="tge-list-content">'
            + '<div class="tge-list-name">'
              + '<span class="tge-list-name-text">' + esc(e.name) + '</span>'
              + '<span class="tge-cat-tag"><span class="tge-cat-tag-dot"></span>' + esc(e.category) + '</span>'
            + '</div>'
            + '<div class="tge-list-meta">'
              + '<span class="tge-list-meta-item">' + svgPath(IC.cal, '') + esc(dateRange) + '</span>'
              + (e.location && cfg.showLocations ? '<span class="tge-list-meta-item">' + svgPath(IC.pin, '') + esc(e.location) + '</span>' : '')
            + '</div>'
          + '</div>'
          + '<div class="tge-list-arrow">' + svgPath(IC.chevR, '') + '</div>'
          + '</button>'
        );
      }
      return '<div class="tge-list" role="list">' + out.join('') + '</div>';
    }

    _renderMonth(events) {
      const month = this.viewedMonth;
      const first = startOfMonth(month);
      const last  = endOfMonth(month);
      const startDow = first.getDay(); // 0 Sun
      const today = new Date(); today.setHours(0,0,0,0);

      // 6 rows × 7 cols = 42 cells. Start at first day of week before/at first.
      const gridStart = new Date(first);
      gridStart.setDate(first.getDate() - startDow);

      const cells = [];
      for (let i = 0; i < 42; i++) {
        const d = new Date(gridStart);
        d.setDate(gridStart.getDate() + i);
        cells.push(d);
      }

      // Index events by date string for quick lookup
      const evByDay = new Map();
      for (const e of events) {
        const s = parseDate(e.startDate);
        const en = parseDate(e.endDate) || s;
        if (!s) continue;
        // For each day from s to en (capped at 31 days to prevent runaway loops)
        const cap = 31;
        for (let i = 0; i < cap; i++) {
          const cur = new Date(s);
          cur.setDate(s.getDate() + i);
          if (cur > en) break;
          const k = fmtDate(cur);
          if (!evByDay.has(k)) evByDay.set(k, []);
          evByDay.get(k).push(e);
        }
      }

      const dowCells = DAY_NAMES.map(d => '<div class="tge-dow">' + d + '</div>').join('');
      const cellHtml = cells.map(d => {
        const off = d.getMonth() !== month.getMonth();
        const isToday = sameDay(d, today);
        const dayEvents = evByDay.get(fmtDate(d)) || [];
        const hasEvents = dayEvents.length > 0;
        const visible = dayEvents.slice(0, 3);
        const overflow = dayEvents.length - visible.length;
        const cls = ['tge-cell'];
        if (off) cls.push('tge-cell--off');
        if (isToday) cls.push('tge-cell--today');
        if (hasEvents) cls.push('tge-cell--has');
        return '<div class="' + cls.join(' ') + '">'
          + '<div class="tge-cell-num">' + d.getDate() + '</div>'
          + visible.map(e => {
              const meta = categoryMeta(e.category);
              const catColor = e.catColor || meta.color;
              const catRgb = hexToRgb(catColor) || '8, 145, 178';
              return '<button class="tge-cell-pill" data-event-id="' + esc(e.id) + '" '
                + 'style="--tge-cat:' + catColor + ';--tge-cat-rgb:' + catRgb + '" type="button" title="' + esc(e.name) + '">'
                + esc(e.name)
                + '</button>';
            }).join('')
          + (overflow > 0 ? '<button class="tge-cell-more" type="button" data-day="' + fmtDate(d) + '">+' + overflow + ' more</button>' : '')
          + '</div>';
      }).join('');

      return '<div class="tge-month-nav">'
        + '<div class="tge-month-title">' + MONTH_NAMES[month.getMonth()] + ' ' + month.getFullYear() + '</div>'
        + '<div class="tge-month-nav-btns">'
          + '<button class="tge-today-btn" data-month-action="today" type="button">Today</button>'
          + '<button class="tge-icon-btn" data-month-action="prev" aria-label="Previous month" type="button">' + svgPath(IC.chevL, '') + '</button>'
          + '<button class="tge-icon-btn" data-month-action="next" aria-label="Next month" type="button">' + svgPath(IC.chevR, '') + '</button>'
        + '</div>'
        + '</div>'
        + '<div class="tge-grid">' + dowCells + cellHtml + '</div>';
    }

    _renderCards(events) {
      const cfg = this.cfg;
      const now = Date.now();
      const upcoming = events.filter(e => e.endTs >= now).slice(0, Math.max(1, Math.min(36, cfg.cardCount || 6)));
      if (!upcoming.length) return this._renderEmpty();

      const cards = upcoming.map(e => {
        const meta = categoryMeta(e.category);
        const catColor = e.catColor || meta.color;
        const catRgb = hexToRgb(catColor) || '8, 145, 178';
        const img = (cfg.showImages !== false && e.image)
          ? '<div class="tge-card-img" style="background-image:url(' + esc(e.image) + ')">'
          : '<div class="tge-card-img tge-card-img--placeholder" style="--tge-cat-rgb:' + catRgb + '"><span aria-hidden="true">' + (e.catIcon || meta.icon || '📅') + '</span>';
        const dateRange = fmtRange(e.startDate, e.endDate);
        return '<button class="tge-card" data-event-id="' + esc(e.id) + '" type="button" '
          + 'style="--tge-cat:' + catColor + ';--tge-cat-rgb:' + catRgb + '">'
          + img
            + '<span class="tge-card-cat-badge">' + esc(e.category) + '</span>'
            + '<span class="tge-card-date-badge">' + esc(dateRange) + '</span>'
          + '</div>'
          + '<div class="tge-card-body">'
            + '<h3 class="tge-card-name">' + esc(e.name) + '</h3>'
            + (e.location && cfg.showLocations
                ? '<div class="tge-card-meta">' + svgPath(IC.pin, '') + esc(e.location) + '</div>'
                : '')
            + (e.description && cfg.showDescriptions
                ? '<p class="tge-card-desc">' + esc(e.description) + '</p>'
                : '')
          + '</div>'
          + '</button>';
      });
      return '<div class="tge-cards">' + cards.join('') + '</div>';
    }

    _renderEmpty() {
      const msg = this.curatedError
        ? 'We couldn\'t load events right now. Please try again shortly.'
        : 'No upcoming events to show.';
      return '<div class="tge-empty">'
        + '<div class="tge-empty-ico">' + svgPath(IC.cal, '') + '</div>'
        + '<div class="tge-empty-title">Nothing scheduled</div>'
        + '<div>' + esc(msg) + '</div>'
        + '</div>';
    }

    _bindBody() {
      // Click handlers for events
      this.shadow.querySelectorAll('[data-event-id]').forEach(el => {
        el.addEventListener('click', (ev) => {
          ev.stopPropagation();
          const id = el.getAttribute('data-event-id');
          this._handleEventClick(id);
        });
      });

      // Month navigation
      this.shadow.querySelectorAll('[data-month-action]').forEach(btn => {
        btn.addEventListener('click', () => {
          const a = btn.getAttribute('data-month-action');
          if (a === 'prev')  this.viewedMonth = addMonths(this.viewedMonth, -1);
          if (a === 'next')  this.viewedMonth = addMonths(this.viewedMonth, 1);
          if (a === 'today') this.viewedMonth = startOfMonth(new Date());
          this._renderBody();
        });
      });

      // "More" pill in month view → open list filtered to that day
      this.shadow.querySelectorAll('.tge-cell-more').forEach(btn => {
        btn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          const day = btn.getAttribute('data-day');
          if (!day) return;
          const events = this._allEvents().filter(e => {
            const s = parseDate(e.startDate); const en = parseDate(e.endDate) || s;
            const target = parseDate(day);
            return target && s && dateInRange(target, s, en);
          });
          if (events.length) this._openModalList(day, events);
        });
      });
    }

    _findEvent(id) {
      return this._allEvents().find(e => e.id === id);
    }

    _handleEventClick(id) {
      const e = this._findEvent(id);
      if (!e) return;
      const mode = this.cfg.onClick || 'modal';
      if (mode === 'link' && e.url) {
        window.open(e.url, '_blank', 'noopener,noreferrer');
        return;
      }
      if (mode === 'none') return;
      this._openModal(e);
    }

    _openModal(e) {
      this._closeModal();
      const meta = categoryMeta(e.category);
      const catColor = e.catColor || meta.color;
      const catRgb = hexToRgb(catColor) || '8, 145, 178';
      const dateRange = fmtRange(e.startDate, e.endDate);

      const root = this.shadow.querySelector('.tge-root');
      const modalHtml = ''
        + '<div class="tge-modal-bg" data-tge-modal></div>'
        + '<div class="tge-modal" role="dialog" aria-modal="true">'
          + '<div class="tge-modal-card" style="position:relative;--tge-cat:' + catColor + ';--tge-cat-rgb:' + catRgb + '">'
            + '<button class="tge-modal-close" type="button" aria-label="Close">' + svgPath(IC.close, '') + '</button>'
            + (e.image && this.cfg.showImages !== false
                ? '<div class="tge-modal-img" style="background-image:url(' + esc(e.image) + ')"></div>'
                : '')
            + '<div class="tge-modal-body">'
              + '<span class="tge-modal-cat"><span class="tge-cat-tag-dot"></span>' + esc(e.category) + '</span>'
              + '<h3 class="tge-modal-name">' + esc(e.name) + '</h3>'
              + '<div class="tge-modal-meta">'
                + '<div class="tge-modal-meta-row">' + svgPath(IC.cal, '') + '<span>' + esc(dateRange) + '</span></div>'
                + (e.location ? '<div class="tge-modal-meta-row">' + svgPath(IC.pin, '') + '<span>' + esc(e.location) + '</span></div>' : '')
              + '</div>'
              + (e.description && this.cfg.showDescriptions !== false
                  ? '<div class="tge-modal-desc">' + esc(e.description) + '</div>'
                  : '')
              + (e.url
                  ? '<a class="tge-modal-cta" href="' + esc(e.url) + '" target="_blank" rel="noopener noreferrer">'
                    + 'Find out more' + svgPath(IC.arrow, '')
                    + '</a>'
                  : '')
            + '</div>'
          + '</div>'
        + '</div>';

      const wrap = document.createElement('div');
      wrap.innerHTML = modalHtml;
      while (wrap.firstChild) root.appendChild(wrap.firstChild);

      this._modalEl = root.querySelector('.tge-modal');
      const bg = root.querySelector('.tge-modal-bg');
      const card = root.querySelector('.tge-modal-card');
      requestAnimationFrame(() => {
        bg && bg.classList.add('tge-open');
        card && card.classList.add('tge-open');
      });

      const close = () => this._closeModal();
      bg && bg.addEventListener('click', close);
      const closeBtn = root.querySelector('.tge-modal-close');
      closeBtn && closeBtn.addEventListener('click', close);
      this._kbdHandler = (ev) => { if (ev.key === 'Escape') close(); };
      document.addEventListener('keydown', this._kbdHandler);
    }

    _openModalList(dayStr, events) {
      // For "+N more" — show first event for now. Could later show a day-list popover.
      if (events.length) this._openModal(events[0]);
    }

    _closeModal() {
      if (this._modalEl) {
        const root = this.shadow.querySelector('.tge-root');
        const bg = root && root.querySelector('.tge-modal-bg');
        if (bg) bg.remove();
        this._modalEl.remove();
        this._modalEl = null;
      }
      if (this._kbdHandler) {
        document.removeEventListener('keydown', this._kbdHandler);
        this._kbdHandler = null;
      }
    }

    update(newConfig) {
      this.cfg = Object.assign({}, this.cfg, newConfig || {});
      this.layout = this.cfg.layout || this.layout;
      this._render();
      if (this.cfg.useCuratedEvents !== false) {
        this.curatedLoaded = false;
        this._fetchCurated();
      }
    }

    destroy() {
      this._closeModal();
      try { this.shadow.innerHTML = ''; } catch {}
    }
  }

  // ---------- Auto-init ----------
  async function init() {
    const containers = document.querySelectorAll('[data-tg-widget="events"]:not([data-tg-rendered])');
    for (const el of containers) {
      el.setAttribute('data-tg-rendered', '1');

      // Inline config
      const inline = el.getAttribute('data-tg-config');
      if (inline) {
        try {
          const c = JSON.parse(inline);
          new TGEventsWidget(el, c);
          continue;
        } catch (e) {
          console.error('[tg-events] Invalid inline config', e);
          continue;
        }
      }

      // Remote config
      const id = el.getAttribute('data-tg-id');
      if (!id) continue;
      try {
        const r = await fetch(API_BASE + '?id=' + encodeURIComponent(id));
        if (!r.ok) throw new Error('config-fetch-' + r.status);
        const j = await r.json();
        const cfg = (j && j.config) ? j.config : {};
        cfg.widgetId = id;
        new TGEventsWidget(el, cfg);
      } catch (err) {
        console.error('[tg-events] Failed to load widget config', err);
      }
    }
  }

  window.TGEventsWidget = TGEventsWidget;
  window.__TG_EVENTS_VERSION__ = VERSION;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
