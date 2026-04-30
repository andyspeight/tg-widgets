/**
 * Travelgenix Travel Offers Widget v1.1.0
 * Self-contained, embeddable widget pulling live data from the Travelify offers cache.
 *
 * Usage:
 *   <div data-tg-widget="offers" data-tg-id="YOUR_WIDGET_ID"></div>
 *   <script src="https://tg-widgets.vercel.app/widget-offers.js"></script>
 *
 * Travelify Offers API is public — credentials are safe to expose per Travelify devs.
 *
 * Data shape (CRITICAL):
 *   - Accommodation:  o.accommodation.{...}
 *   - Flights:        o.flight.{...}
 *   - Packages:       o.flight.{...} AND o.accommodation.{...}  (top level, NOT nested in o.package)
 *                     o.packageType === 'DynamicPackages' | 'PackageHolidays'
 *   - PackageHoliday operator: o.accommodation.operator.{code, name, message}
 *   - TripAdvisor:    o.accommodation.{reviewRating, reviewCount, reviewImgUrl}
 *   - BothPackages:   send packageType:'Any' (omitting returns DynamicPackages only)
 */
(function () {
  'use strict';

  const API_BASE = (typeof window !== 'undefined' && window.__TG_WIDGET_API__) || '/api/widget-config';
  const TRAVELIFY_ENDPOINT = 'https://api.travelify.io/widgetsvc/traveloffers';
  const VERSION = '1.1.0';
  const CACHE_PREFIX = 'tgo_cache_';

  // ── XSS-safe helpers ──────────────────────────────────────────────

  function esc(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function safeUrl(url) {
    if (!url) return '#';
    const s = String(url).trim();
    if (/^(javascript|data|vbscript|file):/i.test(s)) return '#';
    return s;
  }

  function safeImgUrl(url) {
    if (!url) return '';
    const s = String(url).trim();
    if (!/^https?:\/\//i.test(s)) return '';
    return s;
  }

  // Build a safe background-image style attribute. The URL goes inside
  // CSS url(), wrapped in single quotes, with single quotes and backslashes
  // in the URL escaped so it can't break out. The whole thing then sits
  // inside an HTML attribute value that uses double quotes — which is fine
  // because we never use raw double quotes in the value. This was previously
  // built with JSON.stringify which embedded literal double quotes inside
  // the style attribute and broke every image.
  function cssBgUrl(url) {
    if (!url) return '';
    const safe = String(url).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    return 'style="background-image:url(\'' + safe + '\')"';
  }

  function formatEnum(s) {
    if (!s) return '';
    return String(s).replace(/([A-Z])/g, ' $1').trim();
  }

  function formatDate(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return iso;
      return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch { return iso; }
  }

  function formatDateTime(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return iso;
      const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
      const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      return date + ', ' + time;
    } catch { return iso; }
  }

  function formatDuration(minutes) {
    if (!minutes || isNaN(minutes)) return '';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h && m) return h + 'h ' + m + 'm';
    if (h) return h + 'h';
    return m + 'm';
  }

  function paxString(o) {
    const a = o.adults || 0;
    const c = o.children || 0;
    const i = o.infants || 0;
    const parts = [];
    if (a) parts.push(a + ' adult' + (a === 1 ? '' : 's'));
    if (c) parts.push(c + ' child' + (c === 1 ? '' : 'ren'));
    if (i) parts.push(i + ' infant' + (i === 1 ? '' : 's'));
    return parts.join(', ');
  }

  function getNumericPrice(o) {
    const candidates = [
      o.accommodation && o.accommodation.pricing && o.accommodation.pricing.price,
      o.flight && o.flight.pricing && o.flight.pricing.price,
      o.pricing && o.pricing.price,
    ];
    for (const c of candidates) if (typeof c === 'number') return c;
    const formatted = o.formattedPPPrice || o.formattedPrice || '';
    const match = String(formatted).replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
    return match ? parseFloat(match[1]) : Infinity;
  }

  // Pull the currency symbol out of a formatted price string like "£476" or "€1,200"
  function currencySymbol(str) {
    if (!str) return '£';
    const m = String(str).match(/^[^\d\-.,\s]+/);
    return m ? m[0] : '£';
  }

  // Format a numeric value back into a formatted-price string using the same symbol.
  // We round to the nearest whole — Travelify's formattedPrice always shows whole numbers.
  function formatMoney(amount, sym) {
    if (!isFinite(amount)) return '';
    const rounded = Math.round(amount);
    return (sym || '£') + rounded.toLocaleString('en-GB');
  }

  // Pax count — adults + children (infants don't count toward per-person pricing)
  function paxCount(o) {
    return Math.max(1, (o.adults || 0) + (o.children || 0));
  }

  // Number of nights from accommodation.nights — flights alone have none
  function nightsCount(o) {
    return (o.accommodation && o.accommodation.nights) || 0;
  }

  // Compute the price to display based on cfg.priceDisplay mode.
  // Returns { primary, sub } where primary is the prominent price string and
  // sub is the small label underneath (e.g. "per person", "per night").
  // Auto mode preserves the existing behaviour: formattedPPPrice if available,
  // otherwise formattedPrice. Other modes derive from raw numeric where possible.
  function computeDisplayPrice(o, mode) {
    const totalStr = o.formattedPrice || '';
    const ppStr = o.formattedPPPrice || '';
    const sym = currencySymbol(totalStr || ppStr);
    const numeric = getNumericPrice(o);
    const pax = paxCount(o);
    const nights = nightsCount(o);
    // Determine the currency-aware total in raw numbers.
    // formattedPPPrice is per person; multiply by pax to derive total.
    // formattedPrice is total; if ppStr missing, divide by pax for per-person.
    let total = null, perPerson = null;
    if (totalStr) {
      const m = totalStr.replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
      if (m) total = parseFloat(m[1]);
    }
    if (ppStr) {
      const m = ppStr.replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
      if (m) perPerson = parseFloat(m[1]);
    }
    // Fallbacks
    if (total == null && perPerson != null) total = perPerson * pax;
    if (perPerson == null && total != null) perPerson = total / pax;
    if (total == null && perPerson == null && isFinite(numeric)) {
      total = numeric;
      perPerson = numeric / pax;
    }

    const m = (mode || 'auto').toLowerCase();

    // Per-night requires nights > 0 — fall back gracefully when absent (e.g. flight-only)
    if ((m === 'pernight' || m === 'perpersonpernight') && !nights) {
      // Fall through to perperson or total
      if (m === 'perpersonpernight' && perPerson != null) return { primary: formatMoney(perPerson, sym), sub: 'per person' };
      if (total != null) return { primary: formatMoney(total, sym), sub: 'total' };
    }

    if (m === 'total') {
      return { primary: total != null ? formatMoney(total, sym) : (totalStr || ppStr), sub: 'total' };
    }
    if (m === 'perperson') {
      return { primary: perPerson != null ? formatMoney(perPerson, sym) : (ppStr || totalStr), sub: 'per person' };
    }
    if (m === 'pernight') {
      const v = total != null && nights ? total / nights : null;
      return { primary: v != null ? formatMoney(v, sym) : (totalStr || ppStr), sub: 'per night' };
    }
    if (m === 'perpersonpernight') {
      const v = perPerson != null && nights ? perPerson / nights : null;
      return { primary: v != null ? formatMoney(v, sym) : (ppStr || totalStr), sub: 'per person, per night' };
    }
    // auto
    return {
      primary: ppStr || totalStr,
      sub: ppStr ? 'per person' : (totalStr ? 'total' : ''),
    };
  }

  function paxBasisLabel(o) {
    const a = o.adults || 0;
    const c = o.children || 0;
    const i = o.infants || 0;
    const parts = [];
    if (a) parts.push(a + ' adult' + (a === 1 ? '' : 's'));
    if (c) parts.push(c + ' child' + (c === 1 ? '' : 'ren'));
    if (i) parts.push(i + ' infant' + (i === 1 ? '' : 's'));
    if (!parts.length) return '';
    // Only say "sharing" when there's a hotel involved (more than 1 person stays in a room)
    const sharing = (o.accommodation && (a + c) > 1);
    return 'Based on ' + parts.join(', ') + (sharing ? ' sharing' : '');
  }

  function getPackageType(o) {
    return o.packageType || null;
  }

  function isAtolMessage(msg) {
    return !!msg && /atol|abta/i.test(String(msg));
  }

  // ── Inline SVG icon set (Lucide-flavoured) ────────────────────────

  const ICONS = {
    plane: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/></svg>',
    hotel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 22V8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14"/><path d="M3 22h18"/><path d="M7 10h.01"/><path d="M11 10h.01"/><path d="M15 10h.01"/><path d="M7 14h.01"/><path d="M11 14h.01"/><path d="M15 14h.01"/><path d="M7 18h.01"/><path d="M11 18h.01"/><path d="M15 18h.01"/></svg>',
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    star: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
    mapPin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
    calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
    utensils: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2v0a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    badge: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"/><path d="m9 12 2 2 4-4"/></svg>',
  };

  function icon(name, size) {
    size = size || 14;
    const svg = ICONS[name] || '';
    if (!svg) return '';
    return svg.replace('<svg ', '<svg width="' + size + '" height="' + size + '" ');
  }

  // ── Cache ─────────────────────────────────────────────────────────

  function cacheKey(widgetId, payload) {
    const str = JSON.stringify(payload);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return CACHE_PREFIX + (widgetId || 'inline') + '_' + Math.abs(hash).toString(36);
  }

  function cacheGet(key, ttlMs) {
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.t || !parsed.d) return null;
      if (Date.now() - parsed.t > ttlMs) {
        sessionStorage.removeItem(key);
        return null;
      }
      return parsed.d;
    } catch { return null; }
  }

  function cacheSet(key, data) {
    try {
      sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), d: data }));
    } catch { /* quota or disabled — fine */ }
  }

  // ── Font loader ───────────────────────────────────────────────────

  const SYSTEM_FONTS = new Set([
    'inter', 'system-ui', '-apple-system', 'sans-serif', 'serif', 'monospace',
    'arial', 'helvetica', 'georgia', 'times', 'times new roman', 'verdana',
    'courier', 'courier new'
  ]);

  function loadFontFamily(name) {
    if (!name || typeof name !== 'string') return;
    const trimmed = name.trim();
    if (!trimmed) return;
    const lower = trimmed.toLowerCase();
    if (SYSTEM_FONTS.has(lower)) return;
    const id = 'tgo-font-' + lower.replace(/[^a-z0-9]+/g, '-');
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family='
      + encodeURIComponent(trimmed).replace(/%20/g, '+')
      + ':wght@400;500;600;700&display=swap';
    document.head.appendChild(link);
  }

  function fontStack(name) {
    if (!name || !name.trim()) return '';
    const trimmed = name.trim();
    return "'" + trimmed.replace(/'/g, '') + "', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
  }

  // ── Dedupe ────────────────────────────────────────────────────────

  function getDedupeKey(offer, strategy) {
    const acc = offer.accommodation || {};
    const flight = offer.flight || {};
    const dest = acc.destination || flight.destination || {};
    const hotelKey = (acc.name || '').toLowerCase().trim() + '|' + (dest.countryCode || dest.name || '').toLowerCase().trim();
    const routeKey = (flight.origin && flight.origin.iataCode || '') + '|' + (flight.destination && flight.destination.iataCode || '');
    const carrierKey = (flight.carrier && flight.carrier.code) || '';
    const board = (acc.boardBasis || '').toLowerCase();
    const nights = acc.nights || '';
    const departure = (flight.outboundDate || '').slice(0, 10);
    switch (strategy) {
      case 'none': return offer.id || (Math.random() + '');
      case 'hotel': return hotelKey || (offer.id + '');
      case 'hotel-board': return (hotelKey || (offer.id + '')) + '|' + board;
      case 'hotel-duration': return (hotelKey || (offer.id + '')) + '|' + nights;
      case 'hotel-departure': return (hotelKey || (offer.id + '')) + '|' + departure;
      case 'route': return routeKey || (offer.id + '');
      case 'route-carrier': return (routeKey || (offer.id + '')) + '|' + carrierKey;
      default: return hotelKey || (offer.id + '');
    }
  }

  function dedupeOffers(offers, strategy, sortPref) {
    if (!offers || !offers.length) return [];
    if (strategy === 'none') return offers.map(o => Object.assign({}, o, { _variantCount: 1 }));

    const groups = new Map();
    offers.forEach(o => {
      const k = getDedupeKey(o, strategy);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(o);
    });

    const out = [];
    groups.forEach(group => {
      group.sort((a, b) => getNumericPrice(a) - getNumericPrice(b));
      out.push(Object.assign({}, group[0], { _variantCount: group.length }));
    });

    if (sortPref === 'price:asc') out.sort((a, b) => getNumericPrice(a) - getNumericPrice(b));
    else if (sortPref === 'price:desc') out.sort((a, b) => getNumericPrice(b) - getNumericPrice(a));
    else if (sortPref === 'random') out.sort(() => Math.random() - 0.5);
    return out;
  }

  function dedupeBreakdown(offers) {
    const strategies = ['none','hotel','hotel-board','hotel-duration','hotel-departure','route','route-carrier'];
    const out = {};
    for (const s of strategies) {
      out[s] = dedupeOffers(offers, s, null).length;
    }
    return out;
  }

  // ── Styles ────────────────────────────────────────────────────────

  const STYLES = `
    :host {
      all: initial;
      display: block;
      font-family: var(--tgo-font-family, 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
      color: var(--tgo-text);
      box-sizing: border-box;
    }
    *, *::before, *::after { box-sizing: border-box; }

    /* Host element fills its container but never exceeds it. */
    :host {
      display: block;
      width: 100%;
      max-width: 100%;
      box-sizing: border-box;
    }
    .tgo-root {
      --tgo-brand: #1B2B5B;
      --tgo-accent: #00B4D8;
      --tgo-accent-hover: #0096B7;
      --tgo-accent-soft: #E0F4FA;
      --tgo-bg: transparent;
      --tgo-card: #FFFFFF;
      --tgo-card-alt: #FAFBFC;
      --tgo-text: #0F172A;
      --tgo-sub: #64748B;
      --tgo-muted: #94A3B8;
      --tgo-border: #E2E8F0;
      --tgo-success: #10B981;
      --tgo-success-soft: #D1FAE5;
      --tgo-warn: #D97706;
      --tgo-warn-soft: #FEF3C7;
      --tgo-error: #DC2626;
      --tgo-strike: #94A3B8;
      --tgo-package-holiday: #059669;
      --tgo-package-dynamic: #1857C4;
      --tgo-radius: 14px;
      --tgo-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
      --tgo-shadow-hover: 0 8px 24px rgba(15, 23, 42, 0.08);
      background: var(--tgo-bg);
      color: var(--tgo-text);
      /* Critical: never exceed parent width. Without this the carousel can
         push the root wider than its parent in unconstrained layouts. */
      width: 100%;
      max-width: 100%;
      box-sizing: border-box;
    }

    .tgo-root[data-theme="dark"] {
      --tgo-brand: #4A6FE0;
      --tgo-accent: #38BDF8;
      --tgo-accent-hover: #7DD3FC;
      --tgo-accent-soft: rgba(56, 189, 248, 0.12);
      --tgo-card: #1E293B;
      --tgo-card-alt: #0F172A;
      --tgo-text: #F1F5F9;
      --tgo-sub: #94A3B8;
      --tgo-muted: #64748B;
      --tgo-border: #334155;
      --tgo-success: #34D399;
      --tgo-success-soft: rgba(52, 211, 153, 0.15);
      --tgo-warn: #FBBF24;
      --tgo-warn-soft: rgba(251, 191, 36, 0.15);
      --tgo-strike: #64748B;
      --tgo-package-holiday: #34D399;
      --tgo-package-dynamic: #60A5FA;
      --tgo-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
      --tgo-shadow-hover: 0 8px 24px rgba(0, 0, 0, 0.4);
    }

    /* Loading skeleton */
    .tgo-loading {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(var(--tgo-card-min, 320px), 1fr));
      gap: 16px;
    }
    .tgo-skel-card {
      background: var(--tgo-card);
      border: 1px solid var(--tgo-border);
      border-radius: var(--tgo-radius);
      overflow: hidden;
      box-shadow: var(--tgo-shadow);
    }
    .tgo-skel-img {
      aspect-ratio: 16 / 10;
      background: linear-gradient(90deg, var(--tgo-card-alt) 0%, var(--tgo-border) 50%, var(--tgo-card-alt) 100%);
      background-size: 200% 100%;
      animation: tgo-shimmer 1.4s ease-in-out infinite;
    }
    .tgo-skel-line {
      height: 12px;
      margin: 12px 14px;
      background: var(--tgo-card-alt);
      border-radius: 6px;
    }
    .tgo-skel-line.short { width: 50%; }
    .tgo-skel-line.med { width: 75%; }
    @keyframes tgo-shimmer {
      0% { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }
    @media (prefers-reduced-motion: reduce) {
      .tgo-skel-img { animation: none; }
    }

    /* Empty state */
    .tgo-empty {
      text-align: center;
      padding: 48px 24px;
      background: var(--tgo-card);
      border: 1px dashed var(--tgo-border);
      border-radius: var(--tgo-radius);
      color: var(--tgo-sub);
    }
    .tgo-empty-icon {
      width: 56px;
      height: 56px;
      margin: 0 auto 16px;
      border-radius: 50%;
      background: var(--tgo-accent-soft);
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--tgo-accent);
    }
    .tgo-empty-heading {
      font-size: 17px;
      font-weight: 600;
      color: var(--tgo-text);
      margin: 0 0 6px;
    }
    .tgo-empty-body {
      font-size: 14px;
      line-height: 1.5;
      max-width: 420px;
      margin: 0 auto 16px;
    }
    .tgo-empty-cta {
      display: inline-block;
      padding: 9px 18px;
      background: var(--tgo-accent);
      color: white;
      border-radius: 8px;
      text-decoration: none;
      font-size: 13px;
      font-weight: 600;
      transition: background 0.15s;
    }
    .tgo-empty-cta:hover { background: var(--tgo-accent-hover); }

    /* Error state */
    .tgo-error {
      padding: 16px 20px;
      background: var(--tgo-warn-soft);
      border: 1px solid var(--tgo-warn);
      border-radius: var(--tgo-radius);
      color: var(--tgo-warn);
      font-size: 13px;
      line-height: 1.5;
    }

    /* Grid */
    .tgo-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(var(--tgo-card-min, 320px), 1fr));
      gap: 16px;
    }
    .tgo-grid[data-cols="2"] { grid-template-columns: repeat(2, 1fr); }
    .tgo-grid[data-cols="3"] { grid-template-columns: repeat(3, 1fr); }
    .tgo-grid[data-cols="4"] { grid-template-columns: repeat(4, 1fr); }
    @media (max-width: 900px) {
      .tgo-grid[data-cols="3"], .tgo-grid[data-cols="4"] { grid-template-columns: repeat(2, 1fr); }
    }
    @media (max-width: 600px) {
      .tgo-grid[data-cols="2"], .tgo-grid[data-cols="3"], .tgo-grid[data-cols="4"] {
        grid-template-columns: 1fr;
      }
    }

    /* ===== Carousel =====
       JS computes the exact pixel width for each card based on the carousel's
       own width and the cards-per-view count. This avoids the circular sizing
       problem where percentage-based widths interact badly with overflow-x:auto
       in containers without an explicit width constraint. */
    .tgo-carousel {
      position: relative;
      /* Container padding gives arrows room outside the track on desktop */
      padding: 0 44px;
      /* Hard width constraint — prevents the carousel from growing wider than
         its parent. min-width:0 + width:100% breaks circular sizing chains. */
      width: 100%;
      max-width: 100%;
      min-width: 0;
      box-sizing: border-box;
    }
    @media (max-width: 640px) {
      .tgo-carousel {
        padding: 0;
      }
    }
    .tgo-carousel-track {
      display: flex;
      gap: 16px;
      overflow-x: auto;
      overflow-y: hidden;
      scroll-snap-type: x mandatory;
      scroll-behavior: smooth;
      /* Hide native scrollbar — we have dots and arrows instead */
      scrollbar-width: none;
      -ms-overflow-style: none;
      /* Compensate for shadow clipping at top/bottom by adding padding */
      padding: 4px 0 12px;
      /* Same width constraint as carousel — never grow beyond parent */
      width: 100%;
      min-width: 0;
      box-sizing: border-box;
    }
    .tgo-carousel-track::-webkit-scrollbar { display: none; }

    .tgo-carousel-track > .tgo-card {
      /* Width is set by JS via inline style. Fallback flex-basis lets the
         widget render sanely even if JS hasn't run yet (e.g. SSR / no JS). */
      flex: 0 0 320px;
      min-width: 0;
      max-width: 100%;
      scroll-snap-align: start;
      scroll-snap-stop: always;
    }

    /* On mobile, give cards a subtle edge peek so users see there's more */
    @media (max-width: 640px) {
      .tgo-carousel-track {
        padding-left: 16px;
        padding-right: 16px;
        gap: 12px;
      }
    }

    /* Arrows */
    .tgo-carousel-arrow {
      position: absolute;
      top: 50%;
      transform: translateY(-50%);
      width: 40px;
      height: 40px;
      border-radius: 999px;
      border: 1px solid var(--tgo-border);
      background: var(--tgo-card);
      color: var(--tgo-text);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      z-index: 2;
      box-shadow: 0 4px 12px rgba(15, 23, 42, 0.10);
      transition: background 0.15s ease, transform 0.12s ease, opacity 0.2s ease;
    }
    .tgo-carousel-arrow:hover:not(:disabled) {
      background: var(--tgo-card-alt);
      transform: translateY(-50%) scale(1.06);
    }
    .tgo-carousel-arrow:focus-visible {
      outline: 2px solid var(--tgo-accent);
      outline-offset: 2px;
    }
    .tgo-carousel-arrow:disabled {
      opacity: 0.35;
      cursor: not-allowed;
    }
    .tgo-carousel-arrow svg {
      width: 18px;
      height: 18px;
    }
    .tgo-carousel-arrow[data-dir="prev"] { left: 0; }
    .tgo-carousel-arrow[data-dir="next"] { right: 0; }

    /* Hide arrows on mobile — touch swipe is the navigation */
    @media (max-width: 640px) {
      .tgo-carousel-arrow { display: none; }
    }

    /* Page dots */
    .tgo-carousel-dots {
      display: flex;
      justify-content: center;
      gap: 6px;
      margin-top: 14px;
      padding: 0;
      list-style: none;
    }
    .tgo-carousel-dot {
      width: 8px;
      height: 8px;
      border-radius: 999px;
      border: 0;
      padding: 0;
      background: var(--tgo-border);
      cursor: pointer;
      transition: background 0.18s ease, width 0.2s ease;
    }
    .tgo-carousel-dot:hover { background: var(--tgo-sub); }
    .tgo-carousel-dot[aria-current="true"] {
      background: var(--tgo-accent);
      width: 22px;
    }
    .tgo-carousel-dot:focus-visible {
      outline: 2px solid var(--tgo-accent);
      outline-offset: 2px;
    }

    @media (prefers-reduced-motion: reduce) {
      .tgo-carousel-track { scroll-behavior: auto; }
      .tgo-carousel-arrow { transition: none; }
      .tgo-carousel-arrow:hover:not(:disabled) { transform: translateY(-50%); }
      .tgo-carousel-dot { transition: none; }
    }

    /* Card */
    .tgo-card {
      background: var(--tgo-card);
      border: 1px solid var(--tgo-border);
      border-radius: var(--tgo-radius);
      overflow: hidden;
      display: flex;
      flex-direction: column;
      box-shadow: var(--tgo-shadow);
      transition: transform 0.15s ease, box-shadow 0.15s ease;
    }
    .tgo-card:hover {
      transform: translateY(-2px);
      box-shadow: var(--tgo-shadow-hover);
    }
    @media (prefers-reduced-motion: reduce) {
      .tgo-card { transition: none; }
      .tgo-card:hover { transform: none; }
    }

    .tgo-card-image {
      aspect-ratio: 16 / 10;
      background: var(--tgo-card-alt) center/cover no-repeat;
      position: relative;
    }
    .tgo-card-image.flight { aspect-ratio: 16 / 9; }

    .tgo-card-stars {
      position: absolute; top: 10px; left: 10px;
      background: rgba(0,0,0,0.7); color: #FFD166;
      padding: 4px 10px; border-radius: 6px;
      font-size: 12px; font-weight: 600;
      backdrop-filter: blur(4px);
      display: inline-flex; align-items: center; gap: 4px;
    }
    .tgo-card-stars svg { width: 12px; height: 12px; }

    .tgo-card-type-badge {
      position: absolute; top: 10px; right: 10px;
      background: var(--tgo-accent); color: white;
      padding: 4px 10px; border-radius: 6px;
      font-size: 11px; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.5px;
    }
    .tgo-card-type-badge.package-holiday { background: var(--tgo-package-holiday); }
    .tgo-card-type-badge.package-dynamic { background: var(--tgo-package-dynamic); }
    .tgo-card-pill {
      position: absolute; bottom: 10px; left: 10px;
      background: var(--tgo-success); color: white;
      padding: 4px 10px; border-radius: 999px;
      font-size: 11px; font-weight: 700;
    }
    .tgo-card-variants {
      position: absolute; top: 10px; right: 10px;
      background: rgba(0,0,0,0.7); color: white;
      padding: 3px 9px; border-radius: 999px;
      font-size: 10px; font-weight: 600;
      letter-spacing: 0.3px;
    }
    /* When the type badge is present, variants sits just under it */
    .tgo-card-image .tgo-card-type-badge + .tgo-card-variants {
      top: 42px;
    }
    /* TripAdvisor chip on the image bottom-right — white background so the
       TripAdvisor logo and rating are clearly readable on any photo */
    .tgo-trip-chip {
      position: absolute; bottom: 10px; right: 10px;
      background: #FFFFFF; color: #0F172A;
      padding: 5px 10px;
      border-radius: 6px;
      display: inline-flex; align-items: center; gap: 8px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
    }
    .tgo-trip-chip-img { height: 16px; width: auto; display: block; }
    .tgo-trip-chip-score {
      font-size: 12px; font-weight: 700; color: #0F172A;
      font-variant-numeric: tabular-nums; line-height: 1;
    }
    .tgo-trip-chip-count {
      font-size: 10px; color: #64748B;
      font-weight: 500;
    }

    .tgo-card-body { padding: 14px 16px; display: flex; flex-direction: column; gap: 6px; }
    .tgo-card-property-type {
      font-size: 10px; color: var(--tgo-accent); font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.6px;
    }
    .tgo-card-name {
      font-weight: 700; font-size: 16px; line-height: 1.3;
      color: var(--tgo-text); margin: 0;
    }
    .tgo-card-chain {
      font-size: 12px; color: var(--tgo-sub); font-weight: 500;
    }
    .tgo-card-location {
      font-size: 13px; color: var(--tgo-sub);
      display: inline-flex; align-items: center; gap: 4px;
    }
    .tgo-card-location svg { color: var(--tgo-muted); flex-shrink: 0; }
    .tgo-card-summary {
      font-size: 12px; color: var(--tgo-sub); line-height: 1.5;
      margin-top: 4px;
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .tgo-card-meta { font-size: 12px; color: var(--tgo-sub); }

    /* Section (stay details, schedule, etc.) */
    .tgo-section {
      padding: 10px 16px;
      border-top: 1px solid var(--tgo-border);
      background: var(--tgo-card-alt);
    }
    .tgo-section.accent { background: var(--tgo-accent-soft); }
    .tgo-section-title {
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      color: var(--tgo-muted);
      font-weight: 700;
      margin-bottom: 6px;
    }
    .tgo-data-row {
      display: grid;
      grid-template-columns: auto 1fr auto;
      gap: 8px;
      font-size: 12px;
      padding: 3px 0;
      align-items: center;
    }
    .tgo-data-row svg { color: var(--tgo-muted); }
    .tgo-data-label { color: var(--tgo-sub); }
    .tgo-data-value { color: var(--tgo-text); font-weight: 500; text-align: right; }
    .tgo-data-value.warn { color: var(--tgo-warn); font-weight: 700; }
    .tgo-data-value.success { color: var(--tgo-success); font-weight: 700; }

    /* Amenities */
    .tgo-amenities { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
    .tgo-amenity {
      background: var(--tgo-card); border: 1px solid var(--tgo-border);
      padding: 3px 8px; border-radius: 999px;
      font-size: 10px; color: var(--tgo-text); font-weight: 500;
    }

    /* Flight route bar */
    .tgo-route {
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      align-items: center;
      gap: 12px;
      padding: 14px 16px 12px;
      background: var(--tgo-accent-soft);
      border-bottom: 1px solid var(--tgo-border);
    }
    .tgo-airport { display: flex; flex-direction: column; gap: 2px; }
    .tgo-airport.right { text-align: right; }
    .tgo-iata {
      font-weight: 800; color: var(--tgo-accent); font-size: 22px;
      letter-spacing: 1px; line-height: 1;
    }
    .tgo-airport-name { font-size: 11px; color: var(--tgo-sub); line-height: 1.2; }
    .tgo-arrow { display: flex; flex-direction: column; align-items: center; gap: 4px; }
    .tgo-arrow-line {
      position: relative;
      width: 50px; height: 1px;
      background: var(--tgo-accent);
    }
    .tgo-arrow-icon {
      position: absolute;
      top: -10px; left: 50%;
      transform: translateX(-50%);
      background: var(--tgo-accent-soft);
      color: var(--tgo-accent);
      padding: 0 4px;
      display: flex;
      align-items: center;
    }
    .tgo-stops-label {
      font-size: 9px; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.5px;
      color: var(--tgo-sub);
    }
    .tgo-stops-label.direct { color: var(--tgo-success); }
    .tgo-flight-duration-row {
      text-align: center;
      font-size: 11px;
      color: var(--tgo-sub);
      padding: 6px 16px;
      background: var(--tgo-accent-soft);
      border-bottom: 1px solid var(--tgo-border);
    }
    .tgo-carrier-row {
      display: flex; align-items: center; gap: 8px;
      padding: 12px 16px; border-bottom: 1px solid var(--tgo-border);
      background: var(--tgo-card);
      font-size: 13px;
    }
    .tgo-carrier-code {
      background: var(--tgo-text); color: var(--tgo-card);
      font-weight: 700; padding: 4px 8px; border-radius: 4px;
      font-size: 11px; letter-spacing: 1px;
    }
    .tgo-carrier-name { font-weight: 600; flex: 1; }
    .tgo-pax {
      font-size: 11px; color: var(--tgo-sub);
      display: inline-flex; align-items: center; gap: 4px;
    }
    .tgo-pax svg { color: var(--tgo-muted); }

    /* Package summary */
    .tgo-package-summary {
      padding: 12px 16px;
      border-top: 1px solid var(--tgo-border);
      display: flex; flex-direction: column; gap: 10px;
      background: var(--tgo-accent-soft);
    }
    .tgo-package-line {
      display: grid; grid-template-columns: auto 1fr; gap: 10px;
      align-items: flex-start;
      font-size: 12px; color: var(--tgo-text); line-height: 1.4;
    }
    .tgo-package-icon {
      flex: 0 0 18px;
      width: 18px; height: 18px;
      color: var(--tgo-accent);
      display: flex; align-items: center; justify-content: center;
    }
    .tgo-package-line strong { font-weight: 700; }
    .tgo-package-line-detail { font-size: 11px; color: var(--tgo-sub); margin-top: 2px; }

    .tgo-package-operator {
      display: flex; align-items: center; gap: 8px;
      padding: 10px 16px;
      background: var(--tgo-success-soft);
      border-bottom: 1px solid var(--tgo-border);
      font-size: 12px;
    }
    .tgo-package-operator svg { color: var(--tgo-success); flex-shrink: 0; }
    .tgo-operator-label {
      font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px;
      color: var(--tgo-success); font-weight: 700;
    }
    .tgo-operator-name { font-weight: 700; color: var(--tgo-text); }
    .tgo-operator-atol {
      margin-left: auto;
      background: var(--tgo-success); color: white;
      font-size: 10px; font-weight: 700;
      padding: 2px 6px; border-radius: 4px;
      letter-spacing: 0.5px;
    }

    /* Footer */
    .tgo-card-footer {
      padding: 12px 16px;
      border-top: 1px solid var(--tgo-border);
      display: flex; justify-content: space-between; align-items: flex-end;
      gap: 12px;
      background: var(--tgo-card);
      margin-top: auto;
    }
    .tgo-price-block { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .tgo-price {
      font-weight: 800; font-size: 22px; color: var(--tgo-text);
      line-height: 1;
    }
    .tgo-price-was {
      font-size: 12px; color: var(--tgo-strike);
      text-decoration: line-through;
    }
    .tgo-price-sub { font-size: 11px; color: var(--tgo-sub); }

    /* Pax-basis trigger — dotted underline marks it as interactive */
    .tgo-pax-basis {
      background: transparent; border: 0; padding: 4px 0 0;
      font: inherit; cursor: pointer; text-align: left;
      font-size: 11px; color: var(--tgo-sub);
      text-decoration: underline dotted; text-underline-offset: 3px;
      transition: color 0.15s ease;
    }
    .tgo-pax-basis:hover { color: var(--tgo-accent); }
    .tgo-pax-basis:focus-visible {
      outline: 2px solid var(--tgo-accent); outline-offset: 2px;
      border-radius: 2px;
    }

    /* Pax popover — anchored to the trigger button (not centred). Sits above
       the button by default, repositions if it would overflow viewport. */
    .tgo-popover-layer {
      position: fixed;
      inset: 0;
      z-index: 2147483647; /* Top of the stacking world — beat anything */
      pointer-events: none;
      isolation: isolate;
    }
    .tgo-popover-clickaway {
      position: absolute;
      inset: 0;
      background: transparent;
      pointer-events: auto;
    }
    .tgo-popover {
      position: absolute;
      pointer-events: auto;
      /* Solid background — never inherit transparency from host */
      background-color: #FFFFFF;
      background-image: none;
      border: 1px solid #E2E8F0;
      border-radius: 12px;
      box-shadow: 0 16px 36px rgba(15, 23, 42, 0.22), 0 4px 8px rgba(15, 23, 42, 0.08);
      width: 280px;
      max-width: calc(100vw - 24px);
      padding: 14px 16px 12px;
      color: #0F172A;
      isolation: isolate;
      /* Animate transform only — opacity transitions can look like transparency */
      animation: tgo-popover-in 0.18s cubic-bezier(0.16, 1, 0.3, 1);
    }
    /* Dark theme — solid dark background, never see-through */
    :host([data-theme="dark"]) .tgo-popover,
    .tgo-root[data-theme="dark"] ~ .tgo-popover-layer .tgo-popover {
      background-color: #1E293B;
      border-color: #334155;
      color: #F1F5F9;
    }
    @keyframes tgo-popover-in {
      from { transform: translateY(4px); }
      to   { transform: translateY(0); }
    }
    @media (prefers-reduced-motion: reduce) {
      .tgo-popover { animation: none; }
    }
    /* Arrow pointer — direction set by data-arrow="up|down". Match popover bg. */
    .tgo-popover[data-arrow="down"]::after {
      content: '';
      position: absolute;
      bottom: -6px;
      left: var(--tgo-arrow-x, 50%);
      transform: translateX(-50%) rotate(45deg);
      width: 12px; height: 12px;
      background-color: #FFFFFF;
      border-right: 1px solid #E2E8F0;
      border-bottom: 1px solid #E2E8F0;
    }
    .tgo-popover[data-arrow="up"]::after {
      content: '';
      position: absolute;
      top: -6px;
      left: var(--tgo-arrow-x, 50%);
      transform: translateX(-50%) rotate(45deg);
      width: 12px; height: 12px;
      background-color: #FFFFFF;
      border-left: 1px solid #E2E8F0;
      border-top: 1px solid #E2E8F0;
    }
    .tgo-popover-title {
      font-size: 13px; font-weight: 700; margin: 0 0 2px;
      color: inherit;
    }
    .tgo-popover-sub {
      font-size: 11px; color: #64748B; margin: 0 0 10px;
      line-height: 1.4;
    }
    .tgo-pax-row {
      display: flex; align-items: center; justify-content: space-between;
      padding: 8px 0; border-top: 1px solid #E2E8F0;
    }
    .tgo-pax-row:first-of-type { border-top: 0; padding-top: 4px; }
    .tgo-pax-row-label { font-size: 13px; font-weight: 600; color: inherit; }
    .tgo-pax-row-help { font-size: 10px; color: #64748B; display: block; margin-top: 1px; }
    .tgo-pax-stepper {
      display: inline-flex; align-items: center; gap: 0;
      border: 1px solid #E2E8F0; border-radius: 8px;
      overflow: hidden; background-color: #FFFFFF;
    }
    .tgo-pax-stepper button {
      width: 28px; height: 28px;
      background: transparent; border: 0; padding: 0;
      font-size: 16px; font-weight: 700; color: inherit;
      cursor: pointer;
      transition: background 0.12s ease;
      display: flex; align-items: center; justify-content: center;
    }
    .tgo-pax-stepper button:hover:not(:disabled) { background: #F1F5F9; }
    .tgo-pax-stepper button:disabled { color: #CBD5E1; cursor: not-allowed; }
    .tgo-pax-stepper-value {
      min-width: 28px; text-align: center;
      font-size: 13px; font-weight: 600;
      font-variant-numeric: tabular-nums;
      padding: 0 4px;
      color: inherit;
    }
    .tgo-popover-actions {
      display: flex; gap: 8px; justify-content: flex-end;
      margin-top: 10px; padding-top: 10px;
      border-top: 1px solid #E2E8F0;
    }
    .tgo-popover-btn {
      padding: 7px 13px; font: inherit; font-size: 12px; font-weight: 600;
      border-radius: 7px; cursor: pointer;
      border: 1px solid #E2E8F0; background-color: #FFFFFF;
      color: inherit;
      transition: background 0.15s ease, border-color 0.15s ease;
    }
    .tgo-popover-btn:hover { background: #F1F5F9; }
    .tgo-popover-btn--primary {
      background-color: var(--tgo-accent); color: #FFFFFF; border-color: var(--tgo-accent);
    }
    .tgo-popover-btn--primary:hover { background-color: var(--tgo-accent-hover); border-color: var(--tgo-accent-hover); }
    .tgo-cta {
      color: white;
      background: var(--tgo-accent);
      padding: 9px 16px;
      border-radius: 8px;
      text-decoration: none;
      font-size: 13px;
      font-weight: 600;
      white-space: nowrap;
      transition: background 0.15s ease;
    }
    .tgo-cta:hover { background: var(--tgo-accent-hover); }
    @media (prefers-reduced-motion: reduce) {
      .tgo-cta { transition: none; }
    }

    /* Powered-by ribbon (optional) */
    .tgo-powered {
      text-align: center;
      padding: 12px 0 0;
      font-size: 10px;
      color: var(--tgo-muted);
      letter-spacing: 0.5px;
    }
  `;

  // ── Widget Class ──────────────────────────────────────────────────

  class TGOffersWidget {
    constructor(container, config) {
      this.el = container;
      this.cfg = this._defaults(config);
      this.shadow = container.attachShadow({ mode: 'open' });
      this.root = null;
      this.rawOffers = [];
      this._render();
    }

    _defaults(c) {
      c = c || {};
      // CRITICAL: Show toggles default to TRUE, density NEVER overrides them.
      const defaultShow = {
        propertyType: true,
        chain: true,
        location: true,
        summary: true,
        stayDetails: true,
        amenities: true,
        reviews: true,
        variantCount: true,
        leadInPill: true,
        wasPrice: true,
        refundability: true,
        flightImage: true,
        flightSchedule: true,
        flightDuration: true,
        cabinClass: true,
        packageOperator: true,
        packageSummary: true,
        paxBasis: true,
        poweredBy: false,
      };
      return {
        appId: c.appId || '',
        apiKey: c.apiKey || '',

        type: c.type || 'Accommodation',
        origins: Array.isArray(c.origins) ? c.origins : [],
        destinations: Array.isArray(c.destinations) ? c.destinations : [],
        boardBases: Array.isArray(c.boardBases) ? c.boardBases : [],
        cabinClasses: Array.isArray(c.cabinClasses) ? c.cabinClasses : [],
        ratingMin: typeof c.ratingMin === 'number' ? c.ratingMin : 0,
        budgetMin: typeof c.budgetMin === 'number' ? c.budgetMin : 0,
        budgetMax: typeof c.budgetMax === 'number' ? c.budgetMax : 0,
        durationMin: typeof c.durationMin === 'number' ? c.durationMin : 0,
        durationMax: typeof c.durationMax === 'number' ? c.durationMax : 0,
        DatesMin: typeof c.DatesMin === 'number' ? c.DatesMin : 7,
        DatesMax: typeof c.DatesMax === 'number' ? c.DatesMax : 90,
        maxOffers: typeof c.maxOffers === 'number' ? c.maxOffers : 50,
        sort: c.sort || 'price:asc',
        currency: c.currency || 'GBP',
        language: c.language || 'en',
        nationality: c.nationality || 'GB',

        layout: c.layout || 'grid',
        columns: c.columns || 'auto',
        density: c.density || 'standard',
        theme: c.theme || 'light',
        brandColor: c.brandColor || '',
        accentColor: c.accentColor || '',
        radius: typeof c.radius === 'number' ? c.radius : 14,
        fontFamily: c.fontFamily || '',

        priceDisplay: c.priceDisplay || 'auto',

        // Carousel-specific
        carouselAutoplay: !!c.carouselAutoplay,
        carouselInterval: typeof c.carouselInterval === 'number' ? c.carouselInterval : 6,

        show: Object.assign({}, defaultShow, c.show || {}),

        dedupeStrategy: c.dedupeStrategy || 'hotel',
        cacheMinutes: typeof c.cacheMinutes === 'number' ? c.cacheMinutes : 15,
        emptyBehaviour: c.emptyBehaviour || 'show',
        emptyHeading: c.emptyHeading || 'No offers available right now',
        emptyBody: c.emptyBody || 'We couldn\'t find any matching offers in the current cache. Try our search to find more deals.',
        emptyCtaText: c.emptyCtaText || '',
        emptyCtaUrl: c.emptyCtaUrl || '',

        _widgetId: c._widgetId || '',
      };
    }

    _applyHostStyles() {
      this.root.setAttribute('data-theme', this.cfg.theme === 'dark' ? 'dark' : 'light');
      if (this.cfg.brandColor) this.root.style.setProperty('--tgo-brand', this.cfg.brandColor);
      if (this.cfg.accentColor) {
        this.root.style.setProperty('--tgo-accent', this.cfg.accentColor);
        this.root.style.setProperty('--tgo-accent-hover', this.cfg.accentColor);
      }
      if (this.cfg.radius) this.root.style.setProperty('--tgo-radius', this.cfg.radius + 'px');
      if (this.cfg.fontFamily) {
        loadFontFamily(this.cfg.fontFamily);
        const stack = fontStack(this.cfg.fontFamily);
        if (stack) this.el.style.setProperty('--tgo-font-family', stack);
      } else {
        this.el.style.removeProperty('--tgo-font-family');
      }
      // Density only sets the card minimum width — it NEVER overrides show.* toggles.
      const cardMin = this.cfg.density === 'compact' ? '260px'
        : this.cfg.density === 'detailed' ? '380px'
        : '320px';
      this.root.style.setProperty('--tgo-card-min', cardMin);
    }

    _render() {
      this.shadow.innerHTML = '<style>' + STYLES + '</style>';
      this.root = document.createElement('div');
      this.root.className = 'tgo-root';
      this._applyHostStyles();
      this.shadow.appendChild(this.root);
      this._wireShadowEvents();
      this._showLoading();
      this._fetchAndRender();
    }

    // Delegated click handler inside the shadow root — pax-basis chip opens
    // the popover so the user can adjust adults / children / infants for the
    // click-through URL.
    _wireShadowEvents() {
      this.root.addEventListener('click', (ev) => {
        const paxBtn = ev.target.closest('[data-tgo-pax]');
        if (paxBtn) {
          ev.preventDefault();
          ev.stopPropagation();
          let data;
          try { data = JSON.parse(paxBtn.getAttribute('data-tgo-pax') || '{}'); }
          catch { return; }
          this._openPaxPopover(data, paxBtn);
          return;
        }
      });
    }

    // Open the pax popover, anchored to the trigger button. Prefilled with
    // the offer's pax. On confirm, opens the click-through URL with adt/chd/inf
    // query params appended.
    //
    // Positioning rules:
    //   1. Find the parent .tgo-card so we can clamp horizontally to its bounds
    //      (a popover should never escape its card visually).
    //   2. Place above the trigger by default. Flip below if no space above.
    //   3. Clamp left/right to the card's horizontal range, falling back to
    //      viewport if that would still cut off the popover (e.g. very narrow card).
    //   4. The arrow always points back at the trigger button's centre.
    _openPaxPopover(data, triggerEl) {
      const existing = this.shadow.querySelector('.tgo-popover-layer');
      if (existing) existing.remove();

      const adults = Math.max(1, data.adults || 2);
      const children = Math.max(0, data.children || 0);
      const infants = Math.max(0, data.infants || 0);
      const url = data.url || '';

      const layer = document.createElement('div');
      layer.className = 'tgo-popover-layer';
      layer.innerHTML = '<div class="tgo-popover-clickaway"></div>'
        + '<div class="tgo-popover" role="dialog" aria-modal="false" aria-labelledby="tgoPaxTitle">'
        + '<h3 class="tgo-popover-title" id="tgoPaxTitle">Travellers</h3>'
        + '<p class="tgo-popover-sub">Set your group for this enquiry. We\'ll pass it through to the search.</p>'
        + this._paxRow('adults', 'Adults', '16+ years', adults, 1, 9)
        + this._paxRow('children', 'Children', '2 to 15 years', children, 0, 8)
        + this._paxRow('infants', 'Infants', 'Under 2', infants, 0, 4)
        + '<div class="tgo-popover-actions">'
        + '<button type="button" class="tgo-popover-btn" data-tgo-popover-cancel>Cancel</button>'
        + '<button type="button" class="tgo-popover-btn tgo-popover-btn--primary" data-tgo-popover-confirm>View deal</button>'
        + '</div>'
        + '</div>';

      this.shadow.appendChild(layer);
      const popover = layer.querySelector('.tgo-popover');

      // Find the parent card to clamp within
      const cardEl = triggerEl ? triggerEl.closest('.tgo-card') : null;

      const positionPopover = () => {
        if (!triggerEl) {
          // Fallback: centre in viewport
          const popW = popover.offsetWidth;
          const popH = popover.offsetHeight;
          popover.style.left = ((window.innerWidth - popW) / 2) + 'px';
          popover.style.top = ((window.innerHeight - popH) / 2) + 'px';
          return;
        }
        const trig = triggerEl.getBoundingClientRect();
        const popW = popover.offsetWidth;
        const popH = popover.offsetHeight;
        const arrowOffset = 12;
        const edgeMargin = 8;

        // ── Vertical: above by default, flip below if no room ─────
        const spaceAbove = trig.top;
        const spaceBelow = window.innerHeight - trig.bottom;
        const placeBelow = (spaceAbove < popH + arrowOffset + edgeMargin) && (spaceBelow > spaceAbove);
        const top = placeBelow
          ? trig.bottom + arrowOffset
          : trig.top - popH - arrowOffset;
        const arrow = placeBelow ? 'up' : 'down';

        // ── Horizontal: clamp to card bounds, then to viewport ────
        const trigCentre = trig.left + (trig.width / 2);
        let left = trigCentre - (popW / 2);

        // Constrain to card width if we have a card and the card is wide enough
        if (cardEl) {
          const cardRect = cardEl.getBoundingClientRect();
          if (cardRect.width >= popW) {
            // Card wider than popover — keep popover fully inside card
            const cardLeft = cardRect.left + edgeMargin;
            const cardRight = cardRect.right - edgeMargin;
            left = Math.max(cardLeft, Math.min(cardRight - popW, left));
          } else {
            // Card narrower than popover — centre popover on card centre
            left = cardRect.left + (cardRect.width / 2) - (popW / 2);
          }
        }

        // Final viewport clamp as a safety net (catches edge cases like
        // mobile where viewport is narrow and card sits at page edge)
        left = Math.max(edgeMargin, Math.min(window.innerWidth - popW - edgeMargin, left));

        // Arrow x within the popover — points back at the trigger centre
        const arrowX = Math.max(16, Math.min(popW - 16, trigCentre - left));

        popover.style.left = left + 'px';
        popover.style.top = top + 'px';
        popover.setAttribute('data-arrow', arrow);
        popover.style.setProperty('--tgo-arrow-x', arrowX + 'px');
      };

      requestAnimationFrame(positionPopover);

      const repositionOnScroll = () => positionPopover();
      window.addEventListener('scroll', repositionOnScroll, true);
      window.addEventListener('resize', repositionOnScroll);

      // ── Stepper state ───────────────────────────────────────────
      const state = { adults, children, infants };
      const limits = { adults: [1, 9], children: [0, 8], infants: [0, 4] };

      const update = (kind, delta) => {
        const [min, max] = limits[kind];
        state[kind] = Math.max(min, Math.min(max, state[kind] + delta));
        const valEl = layer.querySelector('[data-tgo-pax-val="' + kind + '"]');
        if (valEl) valEl.textContent = state[kind];
        layer.querySelectorAll('[data-tgo-pax-btn]').forEach((b) => {
          const [k, dir] = b.getAttribute('data-tgo-pax-btn').split(':');
          if (dir === 'minus') b.disabled = state[k] <= limits[k][0];
          else b.disabled = state[k] >= limits[k][1];
        });
      };

      const close = () => {
        window.removeEventListener('scroll', repositionOnScroll, true);
        window.removeEventListener('resize', repositionOnScroll);
        document.removeEventListener('keydown', escHandler);
        layer.remove();
      };

      const escHandler = (ev) => {
        if (ev.key === 'Escape') { ev.preventDefault(); close(); }
      };
      document.addEventListener('keydown', escHandler);

      layer.addEventListener('click', (ev) => {
        const btn = ev.target.closest('[data-tgo-pax-btn]');
        if (btn) {
          const [kind, dir] = btn.getAttribute('data-tgo-pax-btn').split(':');
          update(kind, dir === 'minus' ? -1 : 1);
          return;
        }
        if (ev.target.matches('[data-tgo-popover-cancel]')) {
          close();
          return;
        }
        if (ev.target.matches('[data-tgo-popover-confirm]')) {
          const sep = url.indexOf('?') >= 0 ? '&' : '?';
          const newUrl = url + sep + 'adt=' + state.adults + '&chd=' + state.children + '&inf=' + state.infants;
          window.open(safeUrl(newUrl), '_blank', 'noopener,noreferrer');
          close();
          return;
        }
        if (ev.target.classList.contains('tgo-popover-clickaway')) {
          close();
        }
      });

      update('adults', 0);
      update('children', 0);
      update('infants', 0);
    }

    _paxRow(kind, label, help, value, min, max) {
      return '<div class="tgo-pax-row">'
        + '<div>'
        + '<div class="tgo-pax-row-label">' + esc(label) + '</div>'
        + '<small class="tgo-pax-row-help">' + esc(help) + '</small>'
        + '</div>'
        + '<div class="tgo-pax-stepper">'
        + '<button type="button" data-tgo-pax-btn="' + kind + ':minus" aria-label="Decrease ' + label + '">−</button>'
        + '<span class="tgo-pax-stepper-value" data-tgo-pax-val="' + kind + '">' + value + '</span>'
        + '<button type="button" data-tgo-pax-btn="' + kind + ':plus" aria-label="Increase ' + label + '">+</button>'
        + '</div>'
        + '</div>';
    }

    _showLoading() {
      const cardMin = this.cfg.density === 'compact' ? '260px'
        : this.cfg.density === 'detailed' ? '380px'
        : '320px';
      const skeletonCount = 6;
      let html = '<div class="tgo-loading" style="--tgo-card-min:' + cardMin + '">';
      for (let i = 0; i < skeletonCount; i++) {
        html += '<div class="tgo-skel-card">'
          + '<div class="tgo-skel-img"></div>'
          + '<div class="tgo-skel-line med"></div>'
          + '<div class="tgo-skel-line short"></div>'
          + '<div class="tgo-skel-line"></div>'
          + '</div>';
      }
      html += '</div>';
      this.root.innerHTML = html;
    }

    _showError(msg) {
      this.root.innerHTML = '<div class="tgo-error">'
        + '<strong>Could not load offers.</strong> ' + esc(msg)
        + '</div>';
    }

    _showEmpty() {
      if (this.cfg.emptyBehaviour === 'hide') {
        this.root.innerHTML = '';
        this.el.style.display = 'none';
        return;
      }
      const cta = (this.cfg.emptyCtaText && this.cfg.emptyCtaUrl)
        ? '<a class="tgo-empty-cta" href="' + esc(safeUrl(this.cfg.emptyCtaUrl)) + '" target="_blank" rel="noopener noreferrer">' + esc(this.cfg.emptyCtaText) + '</a>'
        : '';
      this.root.innerHTML = '<div class="tgo-empty">'
        + '<div class="tgo-empty-icon">' + icon('badge', 24) + '</div>'
        + '<h3 class="tgo-empty-heading">' + esc(this.cfg.emptyHeading) + '</h3>'
        + '<p class="tgo-empty-body">' + esc(this.cfg.emptyBody) + '</p>'
        + cta
        + '</div>';
    }

    _buildPayload() {
      // Map our config 'type' to API 'type' + optional packageType.
      // CRITICAL: BothPackages must send packageType:'Any' — omitting returns DynamicPackages only.
      let apiType = this.cfg.type;
      let packageType = null;
      if (apiType === 'DynamicPackages') {
        apiType = 'Packages';
        packageType = 'DynamicPackages';
      } else if (apiType === 'PackageHolidays') {
        apiType = 'Packages';
        packageType = 'PackageHolidays';
      } else if (apiType === 'BothPackages') {
        apiType = 'Packages';
        packageType = 'Any';
      }

      const p = {
        type: apiType,
        deduping: 'None',
        currency: this.cfg.currency,
        language: this.cfg.language,
        nationality: this.cfg.nationality,
        maxOffers: this.cfg.maxOffers,
        rollingDates: true,
        DatesMin: this.cfg.DatesMin,
        DatesMax: this.cfg.DatesMax,
        sort: this.cfg.sort,
        pricingByType: 'Person',
      };
      if (packageType) p.packageType = packageType;
      if (this.cfg.budgetMin) p.budgetMin = this.cfg.budgetMin;
      if (this.cfg.budgetMax) p.budgetMax = this.cfg.budgetMax;
      if (this.cfg.ratingMin) p.ratingMin = this.cfg.ratingMin;
      if (this.cfg.durationMin) p.durationMin = this.cfg.durationMin;
      if (this.cfg.durationMax) p.durationMax = this.cfg.durationMax;
      if (this.cfg.origins.length) p.origins = this.cfg.origins;
      if (this.cfg.destinations.length) p.destinations = this.cfg.destinations;
      if (this.cfg.boardBases.length) p.boardBases = this.cfg.boardBases;
      if (this.cfg.cabinClasses.length) p.cabinClasses = this.cfg.cabinClasses;
      return p;
    }

    async _fetchAndRender() {
      if (!this.cfg.appId || !this.cfg.apiKey) {
        this._showError('Missing Travelify credentials. Configure in the editor.');
        return;
      }

      const payload = this._buildPayload();
      const ttlMs = (this.cfg.cacheMinutes || 0) * 60 * 1000;
      const ck = cacheKey(this.cfg._widgetId, payload);

      if (ttlMs > 0) {
        const cached = cacheGet(ck, ttlMs);
        if (cached) {
          this.rawOffers = cached;
          this._renderOffers();
          this._fireDataLoaded();
          return;
        }
      }

      try {
        const res = await fetch(TRAVELIFY_ENDPOINT, {
          method: 'POST',
          headers: {
            'Authorization': 'Token ' + this.cfg.appId + ':' + this.cfg.apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!data.success) {
          this._showError(data.error || 'Travelify returned an error.');
          return;
        }
        this.rawOffers = data.data || [];
        if (ttlMs > 0) cacheSet(ck, this.rawOffers);
        this._renderOffers();
        this._fireDataLoaded();
      } catch (err) {
        this._showError(err.message || 'Network error.');
      }
    }

    // Fire a custom event so the editor can listen and display dedupe breakdown.
    _fireDataLoaded() {
      try {
        const ev = new CustomEvent('tgo:dataLoaded', {
          bubbles: true, composed: true,
          detail: {
            rawCount: this.rawOffers.length,
            breakdown: dedupeBreakdown(this.rawOffers),
          },
        });
        this.el.dispatchEvent(ev);
      } catch { /* CustomEvent may fail in very old browsers — non-critical */ }
    }

    _renderOffers() {
      const deduped = dedupeOffers(this.rawOffers, this.cfg.dedupeStrategy, this.cfg.sort);

      if (!deduped.length) {
        this._showEmpty();
        return;
      }

      const isCarousel = this.cfg.layout === 'carousel';

      let html;
      if (isCarousel) {
        html = this._renderCarousel(deduped);
      } else {
        const cols = this.cfg.columns === 'auto' ? '' : ' data-cols="' + esc(this.cfg.columns) + '"';
        html = '<div class="tgo-grid"' + cols + '>';
        for (const o of deduped) {
          html += this._renderOfferCard(o);
        }
        html += '</div>';
      }

      if (this.cfg.show.poweredBy) {
        html += '<div class="tgo-powered">Powered by Travelgenix</div>';
      }
      this.root.innerHTML = html;

      // Wire carousel interactivity now that DOM exists
      if (isCarousel) {
        this._wireCarousel(deduped.length);
      }
    }

    _renderOfferCard(o) {
      switch (o.type) {
        case 'Accommodation': return this._renderAccommodation(o);
        case 'Flights':
        case 'Flight': return this._renderFlight(o);
        case 'Packages':
        case 'Package': return this._renderPackage(o);
        default: return this._renderUnknown(o);
      }
    }

    // Carousel layout — native scroll-snap track with arrows and dots overlay.
    // Page count is computed at wire time from the actual cards-per-view (which
    // depends on container width), not from the initial config — so resizing
    // the viewport recalculates pages correctly.
    _renderCarousel(offers) {
      let html = '<div class="tgo-carousel" data-tgo-carousel>';
      html += '<button type="button" class="tgo-carousel-arrow" data-dir="prev" aria-label="Previous offers">'
        + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>'
        + '</button>';
      html += '<div class="tgo-carousel-track" data-tgo-track tabindex="0" aria-label="Travel offers">';
      for (const o of offers) html += this._renderOfferCard(o);
      html += '</div>';
      html += '<button type="button" class="tgo-carousel-arrow" data-dir="next" aria-label="More offers">'
        + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>'
        + '</button>';
      // Dot rail rendered as empty container; populated in _wireCarousel
      // because the page count depends on cards-per-view.
      html += '<ul class="tgo-carousel-dots" data-tgo-dots role="tablist" aria-label="Carousel pages"></ul>';
      html += '</div>';
      return html;
    }

    // Wire up the carousel after render: figure out cards-per-view based on
    // container width, set explicit pixel widths on each card (much more
    // reliable than percentage flex-basis in unconstrained parents), build
    // dot rail, attach arrow handlers, attach scroll listener for active-dot
    // tracking, and start autoplay.
    _wireCarousel(totalOffers) {
      const carousel = this.root.querySelector('[data-tgo-carousel]');
      const track = this.root.querySelector('[data-tgo-track]');
      const dotRail = this.root.querySelector('[data-tgo-dots]');
      const prevBtn = this.root.querySelector('.tgo-carousel-arrow[data-dir="prev"]');
      const nextBtn = this.root.querySelector('.tgo-carousel-arrow[data-dir="next"]');
      if (!track || !dotRail || !carousel) return;

      // Measure the carousel's available width — but only use it if it's sane.
      // If the carousel reports an enormous width (because its parent is
      // unconstrained), fall back to the host element or a sensible default.
      const measureWidth = () => {
        let w = carousel.clientWidth;
        // If carousel is somehow huge (>3000px), the parent isn't constraining.
        // Fall back to host element width, then to a sensible default.
        if (w > 3000 || w < 1) {
          const hostWidth = this.el.clientWidth;
          if (hostWidth > 0 && hostWidth <= 3000) {
            w = hostWidth;
          } else {
            // Last-resort fallback — assume a desktop width
            w = Math.min(window.innerWidth || 1280, 1280);
          }
        }
        return w;
      };

      const computeCardsPerView = (width) => {
        if (width >= 1024) return 3;
        if (width >= 640) return 2;
        return 1;
      };

      const computePageCount = (cpv) => {
        return Math.max(1, Math.ceil(totalOffers / cpv));
      };

      // Set explicit pixel widths on every card based on the carousel's actual
      // width. This is bulletproof: cards can never push the carousel wider
      // than its parent because their width is calculated from the parent.
      const applyCardWidths = () => {
        const carouselWidth = measureWidth();
        const cpv = computeCardsPerView(carouselWidth);
        // The padding on .tgo-carousel is 44px each side on desktop, 0 on mobile
        const isMobile = carouselWidth < 640;
        const padding = isMobile ? 0 : 88; // 44px × 2
        const gap = isMobile ? 12 : 16;
        const trackWidth = carouselWidth - padding;
        const cardWidth = (trackWidth - gap * (cpv - 1)) / cpv;
        // Apply to every card
        track.querySelectorAll(':scope > .tgo-card').forEach((card) => {
          card.style.flex = '0 0 ' + cardWidth + 'px';
          card.style.width = cardWidth + 'px';
        });
        return { cpv, cardWidth, gap };
      };

      // Build dot rail for the given page count
      const buildDots = (pageCount) => {
        let html = '';
        for (let i = 0; i < pageCount; i++) {
          html += '<li><button type="button" class="tgo-carousel-dot"'
            + ' data-tgo-dot="' + i + '"'
            + ' role="tab"'
            + ' aria-label="Page ' + (i + 1) + ' of ' + pageCount + '"'
            + (i === 0 ? ' aria-current="true"' : '')
            + '></button></li>';
        }
        dotRail.innerHTML = html;
        // Hide the rail entirely if there's only one page
        dotRail.style.display = pageCount > 1 ? 'flex' : 'none';
      };

      // Get current page index from scroll position
      const getCurrentPage = () => {
        const carouselWidth = measureWidth();
        const cpv = computeCardsPerView(carouselWidth);
        const cards = track.querySelectorAll(':scope > .tgo-card');
        if (!cards.length) return 0;
        const cardWidth = cards[0].offsetWidth + parseFloat(getComputedStyle(track).gap || 16);
        const cardsScrolled = Math.round(track.scrollLeft / cardWidth);
        return Math.min(computePageCount(cpv) - 1, Math.floor(cardsScrolled / cpv));
      };

      // Update which dot is active and which arrows are enabled
      const updateState = () => {
        const current = getCurrentPage();
        dotRail.querySelectorAll('[data-tgo-dot]').forEach((el, i) => {
          if (i === current) el.setAttribute('aria-current', 'true');
          else el.removeAttribute('aria-current');
        });
        const atStart = track.scrollLeft <= 1;
        const atEnd = (track.scrollLeft + track.clientWidth) >= (track.scrollWidth - 1);
        if (prevBtn) prevBtn.disabled = atStart;
        if (nextBtn) nextBtn.disabled = atEnd;
      };

      // Scroll the track by one page (cardsPerView cards)
      const scrollByPage = (direction) => {
        const carouselWidth = measureWidth();
        const cpv = computeCardsPerView(carouselWidth);
        const cards = track.querySelectorAll(':scope > .tgo-card');
        if (!cards.length) return;
        const cardWidth = cards[0].offsetWidth + parseFloat(getComputedStyle(track).gap || 16);
        track.scrollBy({ left: cardWidth * cpv * direction, behavior: 'smooth' });
      };

      // Scroll to a specific page
      const scrollToPage = (pageIndex) => {
        const carouselWidth = measureWidth();
        const cpv = computeCardsPerView(carouselWidth);
        const cards = track.querySelectorAll(':scope > .tgo-card');
        if (!cards.length) return;
        const cardWidth = cards[0].offsetWidth + parseFloat(getComputedStyle(track).gap || 16);
        track.scrollTo({ left: cardWidth * cpv * pageIndex, behavior: 'smooth' });
      };

      // Apply sizing + dots on initial wire and on every resize
      const applyAll = () => {
        const { cpv } = applyCardWidths();
        buildDots(computePageCount(cpv));
        updateState();
      };
      applyAll();

      // Event listeners
      if (prevBtn) prevBtn.addEventListener('click', () => { stopAutoplay(); scrollByPage(-1); });
      if (nextBtn) nextBtn.addEventListener('click', () => { stopAutoplay(); scrollByPage(1); });

      dotRail.addEventListener('click', (ev) => {
        const dot = ev.target.closest('[data-tgo-dot]');
        if (!dot) return;
        stopAutoplay();
        scrollToPage(parseInt(dot.getAttribute('data-tgo-dot'), 10));
      });

      let scrollRaf = 0;
      track.addEventListener('scroll', () => {
        if (scrollRaf) return;
        scrollRaf = requestAnimationFrame(() => {
          updateState();
          scrollRaf = 0;
        });
      });

      // Resize handling — recompute card widths + dots
      // We observe the host element (this.el) rather than the carousel itself,
      // because the carousel's width is derived from the host. If we observed
      // the carousel, a feedback loop could form.
      let resizeRaf = 0;
      const ro = new ResizeObserver(() => {
        if (resizeRaf) return;
        resizeRaf = requestAnimationFrame(() => {
          applyAll();
          resizeRaf = 0;
        });
      });
      ro.observe(this.el);
      this._carouselResizeObserver = ro;

      // Keyboard navigation when the track has focus
      track.addEventListener('keydown', (ev) => {
        if (ev.key === 'ArrowLeft') { ev.preventDefault(); stopAutoplay(); scrollByPage(-1); }
        else if (ev.key === 'ArrowRight') { ev.preventDefault(); stopAutoplay(); scrollByPage(1); }
        else if (ev.key === 'Home') { ev.preventDefault(); stopAutoplay(); scrollToPage(0); }
        else if (ev.key === 'End') {
          ev.preventDefault(); stopAutoplay();
          scrollToPage(computePageCount(computeCardsPerView(measureWidth())) - 1);
        }
      });

      // ── Autoplay ────────────────────────────────────────
      const autoplayOn = !!this.cfg.carouselAutoplay;
      const intervalMs = Math.max(2, Math.min(20, this.cfg.carouselInterval || 6)) * 1000;
      let autoplayTimer = null;

      const startAutoplay = () => {
        if (!autoplayOn || autoplayTimer) return;
        autoplayTimer = setInterval(() => {
          const atEnd = (track.scrollLeft + track.clientWidth) >= (track.scrollWidth - 1);
          if (atEnd) {
            track.scrollTo({ left: 0, behavior: 'smooth' });
          } else {
            scrollByPage(1);
          }
        }, intervalMs);
      };

      const stopAutoplay = () => {
        if (autoplayTimer) { clearInterval(autoplayTimer); autoplayTimer = null; }
      };

      if (autoplayOn) {
        carousel.addEventListener('mouseenter', stopAutoplay);
        carousel.addEventListener('mouseleave', startAutoplay);
        carousel.addEventListener('focusin', stopAutoplay);
        carousel.addEventListener('focusout', () => {
          if (!carousel.contains(this.shadow.activeElement || document.activeElement)) {
            startAutoplay();
          }
        });
        carousel.addEventListener('touchstart', stopAutoplay, { passive: true });
        document.addEventListener('visibilitychange', () => {
          if (document.hidden) stopAutoplay();
          else if (!carousel.matches(':hover')) startAutoplay();
        });
        startAutoplay();
        this._carouselAutoplayStop = stopAutoplay;
      }
    }

    // ── Card renderers ────────────────────────────────────────────

    _variantBadge(o) {
      if (!this.cfg.show.variantCount) return '';
      if (!o._variantCount || o._variantCount <= 1) return '';
      return '<div class="tgo-card-variants">+' + (o._variantCount - 1) + ' more</div>';
    }

    _starsBadge(rating) {
      if (!rating) return '';
      const n = Math.round(rating);
      let stars = '';
      for (let i = 0; i < n; i++) stars += icon('star', 12);
      return '<div class="tgo-card-stars">' + stars + '</div>';
    }

    // TripAdvisor chip — sits on the bottom-right of the image overlay.
    // Renders nothing unless we have a valid TripAdvisor image URL from
    // Travelify (the official tripadvisor-X.X.svg badge). If the image fails
    // to load (404, network), an onerror handler removes the chip entirely
    // so we never show a broken-image placeholder.
    _renderTripAdvisorChip(acc) {
      if (!this.cfg.show.reviews) return '';
      const reviewImg = safeImgUrl(acc.reviewImgUrl || '');
      // Require the official TripAdvisor SVG — without it, there's no logo
      // and the chip is meaningless. Bare scores or counts don't earn a pill.
      if (!reviewImg || !/tripadvisor/i.test(reviewImg)) return '';

      const count = acc.reviewCount;
      // If image fails to load, hide the whole chip (parent <div>) so the
      // user doesn't see a broken-image icon on the photo.
      const onerror = "this.parentElement && (this.parentElement.style.display='none')";

      let inner = '<img class="tgo-trip-chip-img" src="' + esc(reviewImg)
        + '" alt="TripAdvisor rating" loading="lazy"'
        + ' onerror="' + onerror + '" />';
      if (count) {
        inner += '<span class="tgo-trip-chip-count">' + esc(count.toLocaleString()) + '</span>';
      }
      return '<div class="tgo-trip-chip" title="TripAdvisor rating">' + inner + '</div>';
    }

    _renderRefundability(refundability) {
      if (!this.cfg.show.refundability) return '';
      if (!refundability) return '';
      const pretty = formatEnum(refundability);
      const isGood = /partial|refundable/i.test(refundability) && !/non/i.test(refundability);
      const cls = isGood ? 'success' : (/non/i.test(refundability) ? 'warn' : '');
      return '<div class="tgo-data-row">'
        + icon('shield', 12)
        + '<span class="tgo-data-label">Refundability</span>'
        + '<span class="tgo-data-value ' + cls + '">' + esc(pretty) + '</span>'
        + '</div>';
    }

    _renderPriceFooter(o, wasPrice) {
      const display = computeDisplayPrice(o, this.cfg.priceDisplay || 'auto');
      const url = safeUrl(o.url || '#');
      const wasHtml = (this.cfg.show.wasPrice && wasPrice) ? '<div class="tgo-price-was">' + esc(wasPrice) + '</div>' : '';

      // Pax-basis trigger — opens the popover. Encoded as a button so keyboard users
      // can tab to it. The full popover only shows on click; the underline + tooltip
      // hint that it's interactive.
      let basisHtml = '';
      if (this.cfg.show.paxBasis) {
        const label = paxBasisLabel(o);
        if (label) {
          // Encode the offer's pax + URL into data attributes so the popover opens
          // with the right values preloaded and can rewrite the click-through URL
          // with the user's chosen pax on confirm.
          const paxData = JSON.stringify({
            adults: o.adults || 0,
            children: o.children || 0,
            infants: o.infants || 0,
            url: o.url || '',
          });
          basisHtml = '<button type="button" class="tgo-pax-basis" data-tgo-pax="' + esc(paxData) + '">'
            + esc(label) + '</button>';
        }
      }

      return '<div class="tgo-card-footer">'
        + '<div class="tgo-price-block">'
        + wasHtml
        + '<div class="tgo-price">' + esc(display.primary) + '</div>'
        + (display.sub ? '<div class="tgo-price-sub">' + esc(display.sub) + '</div>' : '')
        + basisHtml
        + '</div>'
        + '<a class="tgo-cta" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">View deal</a>'
        + '</div>';
    }

    _renderAccommodation(o) {
      const acc = o.accommodation || {};
      const dest = acc.destination || {};
      const pricing = acc.pricing || {};
      const img = safeImgUrl((acc.image && acc.image.url) || '');
      const amenities = Array.isArray(acc.amenities) ? acc.amenities : [];
      const isLeadIn = pricing.isLeadIn === true;

      let html = '<div class="tgo-card">';

      // Image
      const imgStyle = cssBgUrl(img);
      html += '<div class="tgo-card-image" ' + imgStyle + '>';
      if (acc.rating) html += this._starsBadge(acc.rating);
      html += '<div class="tgo-card-type-badge">Hotel</div>';
      html += this._variantBadge(o);
      if (this.cfg.show.leadInPill && isLeadIn) {
        html += ('<div class="tgo-card-pill">Lead-in price</div>');
      }
      const trip = this._renderTripAdvisorChip(acc);
      if (trip) html += (trip);
      html += '</div>';

      // Body
      html += '<div class="tgo-card-body">';
      if (this.cfg.show.propertyType && acc.propertyType) {
        html += ('<div class="tgo-card-property-type">' + esc(formatEnum(acc.propertyType)) + '</div>');
      }
      html += '<h3 class="tgo-card-name">' + esc(acc.name || 'Hotel') + '</h3>';
      if (this.cfg.show.chain && acc.chain) {
        html += ('<div class="tgo-card-chain">' + esc(acc.chain) + '</div>');
      }
      if (this.cfg.show.location) {
        html += ('<div class="tgo-card-location">' + icon('mapPin', 12)
          + '<span>' + esc(dest.name || '') + (dest.countryCode ? ', ' + esc(dest.countryCode) : '') + '</span></div>');
      }
      if (this.cfg.show.summary && acc.summary) {
        html += ('<div class="tgo-card-summary">' + esc(acc.summary) + '</div>');
      }
      html += '</div>';

      // Stay details
      if (this.cfg.show.stayDetails) {
        html += ('<div class="tgo-section">'
          + '<div class="tgo-section-title">Stay details</div>'
          + this._row('calendar', 'Check-in', formatDate(acc.checkinDate))
          + this._row('moon', 'Nights', acc.nights ? String(acc.nights) : '')
          + this._row('utensils', 'Board', formatEnum(acc.boardBasis))
          + this._row('users', 'Travelling', paxString(o))
          + this._renderRefundability(pricing.refundability)
          + '</div>');
      }

      // Amenities
      if (this.cfg.show.amenities && amenities.length) {
        const visible = amenities.slice(0, 10);
        const extras = amenities.length - visible.length;
        let amenHtml = '<div class="tgo-section"><div class="tgo-section-title">Amenities</div><div class="tgo-amenities">';
        for (const a of visible) amenHtml += '<span class="tgo-amenity">' + esc(formatEnum(a)) + '</span>';
        if (extras > 0) amenHtml += '<span class="tgo-amenity">+' + extras + '</span>';
        amenHtml += '</div></div>';
        html += (amenHtml);
      }

      const wasPrice = (pricing.priceChanged && pricing.priceBeforeChange) ? '£' + Math.round(pricing.priceBeforeChange) : null;
      html += this._renderPriceFooter(o, wasPrice);
      html += '</div>';
      return html;
    }

    _renderFlight(o) {
      const f = o.flight || {};
      const og = f.origin || {};
      const dest = f.destination || {};
      const carrier = f.carrier || {};
      const pricing = f.pricing || {};
      const img = safeImgUrl((f.image && f.image.url) || '');
      const isDirect = f.direct === true;
      const stops = f.stops || 0;
      const stopsLabel = isDirect ? 'Direct' : (stops === 1 ? '1 stop' : stops + ' stops');
      const tripType = f.returnDate ? 'Return' : 'One-way';
      const priceChanged = pricing.priceChanged === true && pricing.priceBeforeChange;
      const isLeadIn = pricing.isLeadIn === true;

      let html = '<div class="tgo-card">';

      // Hero image (destination shot)
      if (this.cfg.show.flightImage && img) {
        let imgInner = '<div class="tgo-card-image flight" ' + cssBgUrl(img) + '>'
          + '<div class="tgo-card-type-badge">Flight</div>'
          + this._variantBadge(o);
        if (this.cfg.show.leadInPill && isLeadIn) {
          imgInner += ('<div class="tgo-card-pill">Lead-in price</div>');
        }
        imgInner += '</div>';
        html += (imgInner);
      }

      // Route bar (always shown — core info, not user-hideable)
      html += '<div class="tgo-route">'
        + '<div class="tgo-airport">'
        + '<div class="tgo-iata">' + esc(og.iataCode || '???') + '</div>'
        + '<div class="tgo-airport-name">' + esc(og.name || '') + '</div>'
        + '</div>'
        + '<div class="tgo-arrow">'
        + '<div class="tgo-arrow-line">'
        + '<span class="tgo-arrow-icon">' + icon('plane', 14) + '</span>'
        + '</div>'
        + '<div class="tgo-stops-label ' + (isDirect ? 'direct' : '') + '">' + esc(stopsLabel) + '</div>'
        + '</div>'
        + '<div class="tgo-airport right">'
        + '<div class="tgo-iata">' + esc(dest.iataCode || '???') + '</div>'
        + '<div class="tgo-airport-name">' + esc(dest.name || '') + '</div>'
        + '</div>'
        + '</div>';

      // Duration row
      if (this.cfg.show.flightDuration && f.duration) {
        html += ('<div class="tgo-flight-duration-row">'
          + esc(formatDuration(f.duration))
          + ' · ' + esc(tripType)
          + (this.cfg.show.cabinClass && f.cabinClass ? ' · ' + esc(formatEnum(f.cabinClass)) : '')
          + '</div>');
      }

      // Carrier row (core)
      html += '<div class="tgo-carrier-row">'
        + (carrier.code ? '<span class="tgo-carrier-code">' + esc(carrier.code) + '</span>' : '')
        + '<span class="tgo-carrier-name">' + esc(carrier.name || 'Carrier') + '</span>'
        + '<span class="tgo-pax">' + icon('users', 12) + esc(paxString(o)) + '</span>'
        + '</div>';

      // Schedule
      if (this.cfg.show.flightSchedule) {
        html += ('<div class="tgo-section">'
          + '<div class="tgo-section-title">Schedule</div>'
          + this._row('calendar', 'Outbound', formatDateTime(f.outboundDate))
          + (f.returnDate ? this._row('calendar', 'Return', formatDateTime(f.returnDate)) : '')
          + this._renderRefundability(pricing.refundability)
          + '</div>');
      }

      const wasPrice = priceChanged ? '£' + Math.round(pricing.priceBeforeChange) : null;
      html += this._renderPriceFooter(o, wasPrice);
      html += '</div>';
      return html;
    }

    _renderPackage(o) {
      // CRITICAL: data is at o.flight and o.accommodation (top level), NOT nested in o.package.
      const acc = o.accommodation || {};
      const f = o.flight || {};
      const dest = acc.destination || f.destination || {};
      const accPricing = acc.pricing || {};
      const flightPricing = f.pricing || {};
      const img = safeImgUrl((acc.image && acc.image.url) || (f.image && f.image.url) || '');
      const amenities = Array.isArray(acc.amenities) ? acc.amenities : [];
      const fromCode = (f.origin && f.origin.iataCode) || '';
      const toCode = (f.destination && f.destination.iataCode) || '';
      const carrierName = (f.carrier && f.carrier.name) || '';
      const isDirect = f.direct === true;
      const stops = (f.stops != null) ? f.stops : null;
      const stopsLabel = isDirect ? 'Direct' : (stops === 1 ? '1 stop' : (stops > 0 ? stops + ' stops' : ''));

      // PackageHoliday operator lives at acc.operator
      const operator = acc.operator || null;
      const operatorName = operator ? operator.name : '';
      const operatorMessage = operator ? operator.message : '';
      const atol = isAtolMessage(operatorMessage);

      // Determine packageType from top-level field
      const pkgType = getPackageType(o);
      const isHoliday = pkgType === 'PackageHolidays';
      const isDynamic = pkgType === 'DynamicPackages';

      const priceChanged = (flightPricing.priceChanged && flightPricing.priceBeforeChange);
      const wasPrice = priceChanged ? '£' + Math.round(flightPricing.priceBeforeChange) : null;
      const isLeadIn = (accPricing.isLeadIn === true) || (flightPricing.isLeadIn === true);

      const badgeText = isHoliday ? 'Package Holiday' : (isDynamic ? 'Flight + Hotel' : 'Package');
      const badgeClass = isHoliday ? 'package-holiday' : (isDynamic ? 'package-dynamic' : '');

      let html = '<div class="tgo-card">';

      // Hero image
      const imgStyle = cssBgUrl(img);
      html += '<div class="tgo-card-image" ' + imgStyle + '>';
      if (acc.rating) html += this._starsBadge(acc.rating);
      html += '<div class="tgo-card-type-badge ' + badgeClass + '">' + esc(badgeText) + '</div>';
      html += this._variantBadge(o);
      if (this.cfg.show.leadInPill && isLeadIn) {
        html += ('<div class="tgo-card-pill">Lead-in price</div>');
      }
      const trip = this._renderTripAdvisorChip(acc);
      if (trip) html += (trip);
      html += '</div>';

      // Operator strip — PackageHoliday only
      if (this.cfg.show.packageOperator && isHoliday && operatorName) {
        let opHtml = '<div class="tgo-package-operator">'
          + '<span class="tgo-operator-label">Operator</span>'
          + '<span class="tgo-operator-name">' + esc(operatorName) + '</span>';
        if (atol) opHtml += '<span class="tgo-operator-atol">ATOL</span>';
        opHtml += '</div>';
        html += (opHtml);
      }

      // Body
      html += '<div class="tgo-card-body">';
      if (this.cfg.show.propertyType && acc.propertyType) {
        html += ('<div class="tgo-card-property-type">' + esc(formatEnum(acc.propertyType)) + '</div>');
      }
      html += '<h3 class="tgo-card-name">' + esc(acc.name || 'Package holiday') + '</h3>';
      if (this.cfg.show.chain && acc.chain) {
        html += ('<div class="tgo-card-chain">' + esc(acc.chain) + '</div>');
      }
      if (this.cfg.show.location) {
        html += ('<div class="tgo-card-location">' + icon('mapPin', 12)
          + '<span>' + esc(dest.name || '') + (dest.countryCode ? ', ' + esc(dest.countryCode) : '') + '</span></div>');
      }
      if (this.cfg.show.summary && acc.summary) {
        html += ('<div class="tgo-card-summary">' + esc(acc.summary) + '</div>');
      }
      html += '</div>';

      // Package summary — flight + hotel + pax
      if (this.cfg.show.packageSummary) {
        const flightLineParts = [];
        if (fromCode && toCode) flightLineParts.push(fromCode + ' → ' + toCode);
        if (carrierName) flightLineParts.push(carrierName);
        if (stopsLabel) flightLineParts.push(stopsLabel);
        const flightLine = flightLineParts.join(' · ');

        const hotelLineParts = [];
        if (acc.nights) hotelLineParts.push(acc.nights + ' night' + (acc.nights === 1 ? '' : 's'));
        if (acc.boardBasis) hotelLineParts.push(formatEnum(acc.boardBasis));
        const hotelLine = hotelLineParts.join(' · ');

        if (flightLine || hotelLine) {
          let psHtml = '<div class="tgo-package-summary">';
          if (flightLine) {
            psHtml += '<div class="tgo-package-line">'
              + '<span class="tgo-package-icon">' + icon('plane', 16) + '</span>'
              + '<span><strong>' + esc(flightLine) + '</strong>';
            if (f.outboundDate) {
              psHtml += '<div class="tgo-package-line-detail">Departs ' + esc(formatDate(f.outboundDate));
              if (f.returnDate) psHtml += ' · Returns ' + esc(formatDate(f.returnDate));
              if (f.duration) psHtml += ' · ' + esc(formatDuration(f.duration));
              if (this.cfg.show.cabinClass && f.cabinClass) psHtml += ' · ' + esc(formatEnum(f.cabinClass));
              psHtml += '</div>';
            }
            psHtml += '</span></div>';
          }
          if (hotelLine) {
            psHtml += '<div class="tgo-package-line">'
              + '<span class="tgo-package-icon">' + icon('hotel', 16) + '</span>'
              + '<span><strong>' + esc(hotelLine) + '</strong>';
            if (acc.checkinDate) psHtml += '<div class="tgo-package-line-detail">Check-in ' + esc(formatDate(acc.checkinDate)) + '</div>';
            psHtml += '</span></div>';
          }
          psHtml += '<div class="tgo-package-line">'
            + '<span class="tgo-package-icon">' + icon('users', 16) + '</span>'
            + '<span>' + esc(paxString(o) || 'Travellers') + '</span></div>';
          psHtml += '</div>';
          html += (psHtml);
        }
      }

      // Refundability
      if (this.cfg.show.refundability && (flightPricing.refundability || accPricing.refundability)) {
        const r = flightPricing.refundability || accPricing.refundability;
        html += ('<div class="tgo-section">' + this._renderRefundability(r) + '</div>');
      }

      // Amenities
      if (this.cfg.show.amenities && amenities.length) {
        const visible = amenities.slice(0, 10);
        const extras = amenities.length - visible.length;
        let amenHtml = '<div class="tgo-section"><div class="tgo-section-title">Amenities</div><div class="tgo-amenities">';
        for (const a of visible) amenHtml += '<span class="tgo-amenity">' + esc(formatEnum(a)) + '</span>';
        if (extras > 0) amenHtml += '<span class="tgo-amenity">+' + extras + '</span>';
        amenHtml += '</div></div>';
        html += (amenHtml);
      }

      html += this._renderPriceFooter(o, wasPrice);
      html += '</div>';
      return html;
    }

    _renderUnknown(o) {
      return '<div class="tgo-card"><div class="tgo-card-body">'
        + '<h3 class="tgo-card-name">Offer</h3>'
        + '<div class="tgo-card-meta">' + esc(o.type || 'Unknown type') + '</div>'
        + '</div>' + this._renderPriceFooter(o) + '</div>';
    }

    _row(iconName, label, value) {
      if (value === null || value === undefined || value === '') return '';
      return '<div class="tgo-data-row">'
        + (iconName ? icon(iconName, 12) : '<span></span>')
        + '<span class="tgo-data-label">' + esc(label) + '</span>'
        + '<span class="tgo-data-value">' + esc(String(value)) + '</span>'
        + '</div>';
    }

    update(newConfig) {
      // Clean up any active carousel resources before tearing down the DOM
      this._cleanupCarousel();

      this.cfg = this._defaults(Object.assign({}, this.cfg, newConfig));
      this.shadow.innerHTML = '<style>' + STYLES + '</style>';
      this.root = document.createElement('div');
      this.root.className = 'tgo-root';
      this._applyHostStyles();
      this.shadow.appendChild(this.root);
      this._wireShadowEvents();
      this._showLoading();
      this._fetchAndRender();
    }

    _cleanupCarousel() {
      if (this._carouselResizeObserver) {
        try { this._carouselResizeObserver.disconnect(); } catch {}
        this._carouselResizeObserver = null;
      }
      if (this._carouselAutoplayStop) {
        try { this._carouselAutoplayStop(); } catch {}
        this._carouselAutoplayStop = null;
      }
    }
  }

  // ── Auto-init ─────────────────────────────────────────────────────

  async function loadConfigFromApi(widgetId) {
    try {
      const res = await fetch(API_BASE + '?id=' + encodeURIComponent(widgetId));
      if (!res.ok) throw new Error('Config load failed: ' + res.status);
      const data = await res.json();
      if (data && data.config) {
        return Object.assign({}, data.config, { _widgetId: widgetId });
      }
      throw new Error('No config returned');
    } catch (err) {
      console.error('[TGOffers] Config load error:', err);
      return null;
    }
  }

  async function init() {
    const containers = document.querySelectorAll('[data-tg-widget="offers"]');
    for (const el of containers) {
      if (el._tgInitialised) continue;
      el._tgInitialised = true;

      let config = null;
      const inline = el.getAttribute('data-tg-config');
      const widgetId = el.getAttribute('data-tg-id');

      if (inline) {
        try { config = JSON.parse(inline); } catch (e) {
          console.error('[TGOffers] Invalid inline config:', e);
          continue;
        }
      } else if (widgetId) {
        config = await loadConfigFromApi(widgetId);
        if (!config) continue;
      } else {
        console.warn('[TGOffers] Widget container has no data-tg-id or data-tg-config');
        continue;
      }

      new TGOffersWidget(el, config);
    }
  }

  if (typeof window !== 'undefined') {
    window.TGOffersWidget = TGOffersWidget;
    window.TGOffersWidget.version = VERSION;
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  }
})();
