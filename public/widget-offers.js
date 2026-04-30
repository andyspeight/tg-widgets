/**
 * Travelgenix Travel Offers Widget v1.0.0
 * Self-contained, embeddable widget pulling live data from the Travelify offers cache.
 *
 * Usage:
 *   <div data-tg-widget="offers" data-tg-id="YOUR_WIDGET_ID"></div>
 *   <script src="https://tg-widgets.vercel.app/widget-offers.js"></script>
 *
 * Or with inline config (testing):
 *   <div data-tg-widget="offers" data-tg-config='{"appId":"250","apiKey":"...","type":"Accommodation",...}'></div>
 *
 * Travelify Offers API is public — credentials are safe to expose per Travelify devs.
 */
(function () {
  'use strict';

  const API_BASE = (typeof window !== 'undefined' && window.__TG_WIDGET_API__) || '/api/widget-config';
  const TRAVELIFY_ENDPOINT = 'https://api.travelify.io/widgetsvc/traveloffers';
  const VERSION = '1.0.0';
  const CACHE_PREFIX = 'tgo_cache_';

  // ── Helpers ───────────────────────────────────────────────────────

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
      o.package && o.package.pricing && o.package.pricing.price,
      o.pricing && o.pricing.price,
    ];
    for (const c of candidates) if (typeof c === 'number') return c;
    const formatted = o.formattedPPPrice || o.formattedPrice || '';
    const match = String(formatted).replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
    return match ? parseFloat(match[1]) : Infinity;
  }

  function detectPackageType(o) {
    const direct = o.packageType || (o.package && (o.package.packageType || o.package.type));
    if (direct === 'PackageHolidays' || direct === 'PackageHoliday') return 'PackageHolidays';
    if (direct === 'DynamicPackages' || direct === 'DynamicPackage' || direct === 'Dynamic') return 'DynamicPackages';
    const operator = (o.package && (o.package.operator || o.package.operatorName || o.package.supplier)) || o.operator || o.supplier;
    if (operator) return 'PackageHolidays';
    if ((o.flight || o.outbound) && o.accommodation) return 'DynamicPackages';
    return null;
  }

  // ── Cache (sessionStorage with 15-min default TTL) ────────────────

  function cacheKey(widgetId, payload) {
    // Hash the payload to a short key — different filters = different cache entries
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
    } catch { /* quota or disabled — fine, just don't cache */ }
  }

  // ── Font loader ───────────────────────────────────────────────────
  // Injects a Google Fonts stylesheet for the chosen font once per page,
  // regardless of how many widgets are mounted. System / generic fonts
  // are skipped (no stylesheet needed).

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
    const acc = offer.accommodation || (offer.package && offer.package.accommodation) || {};
    const flight = offer.flight || (offer.package && offer.package.flight) || {};
    const dest = acc.destination || flight.destination || {};
    const hotelKey = (acc.name || '').toLowerCase().trim() + '|' + (dest.countryCode || dest.name || '').toLowerCase().trim();
    const routeKey = (flight.origin && flight.origin.iataCode || '') + '|' + (flight.destination && flight.destination.iataCode || '');
    const carrierKey = (flight.carrier && flight.carrier.code) || '';
    const board = (acc.boardBasis || '').toLowerCase();
    const nights = acc.nights || '';
    const departure = (flight.outboundDate || '').slice(0, 10);
    switch (strategy) {
      case 'none': return offer.id || (Math.random() + '');
      case 'hotel': return hotelKey;
      case 'hotel-board': return hotelKey + '|' + board;
      case 'hotel-duration': return hotelKey + '|' + nights;
      case 'hotel-departure': return hotelKey + '|' + departure;
      case 'route': return routeKey;
      case 'route-carrier': return routeKey + '|' + carrierKey;
      default: return hotelKey;
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
      font-size: 24px;
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

    .tgo-card-badge {
      position: absolute; top: 10px; left: 10px;
      background: rgba(0,0,0,0.7); color: white;
      padding: 4px 10px; border-radius: 6px;
      font-size: 12px; font-weight: 600;
      backdrop-filter: blur(4px);
    }
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
      position: absolute; bottom: 10px; right: 10px;
      background: rgba(0,0,0,0.7); color: white;
      padding: 3px 9px; border-radius: 999px;
      font-size: 10px; font-weight: 600;
      letter-spacing: 0.3px;
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
    .tgo-card-location {
      font-size: 13px; color: var(--tgo-sub);
      display: flex; align-items: center; gap: 4px;
    }
    .tgo-card-summary {
      font-size: 12px; color: var(--tgo-sub); line-height: 1.5;
      margin-top: 4px;
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .tgo-card-meta { font-size: 12px; color: var(--tgo-sub); }

    /* Section */
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
      grid-template-columns: 1fr auto;
      gap: 8px;
      font-size: 12px;
      padding: 3px 0;
      align-items: center;
    }
    .tgo-data-label { color: var(--tgo-sub); }
    .tgo-data-value { color: var(--tgo-text); font-weight: 500; text-align: right; }
    .tgo-data-value.warn { color: var(--tgo-warn); font-weight: 700; }

    /* Amenities */
    .tgo-amenities { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
    .tgo-amenity {
      background: var(--tgo-card); border: 1px solid var(--tgo-border);
      padding: 3px 8px; border-radius: 999px;
      font-size: 10px; color: var(--tgo-text); font-weight: 500;
    }

    /* Reviews row */
    .tgo-reviews {
      display: flex; align-items: center; gap: 10px;
      padding: 10px 16px; border-top: 1px solid var(--tgo-border);
    }
    .tgo-review-score {
      background: var(--tgo-accent); color: white; font-weight: 700;
      padding: 5px 9px; border-radius: 6px; font-size: 13px;
      min-width: 40px; text-align: center;
    }
    .tgo-review-score.high { background: var(--tgo-success); }
    .tgo-review-score.mid { background: var(--tgo-warn); }
    .tgo-review-text { flex: 1; font-size: 12px; color: var(--tgo-text); }
    .tgo-review-count { font-size: 11px; color: var(--tgo-sub); }

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
    .tgo-arrow { display: flex; flex-direction: column; align-items: center; gap: 2px; }
    .tgo-arrow-line {
      width: 50px; height: 1px; background: var(--tgo-accent); position: relative;
    }
    .tgo-arrow-line::after {
      content: '✈';
      position: absolute;
      top: -8px;
      left: 50%;
      transform: translateX(-50%);
      background: var(--tgo-accent-soft);
      color: var(--tgo-accent);
      padding: 0 4px;
      font-size: 14px;
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
    .tgo-pax { font-size: 11px; color: var(--tgo-sub); }

    /* Package summary */
    .tgo-package-summary {
      padding: 12px 16px;
      border-top: 1px solid var(--tgo-border);
      display: flex; flex-direction: column; gap: 8px;
      background: var(--tgo-accent-soft);
    }
    .tgo-package-line {
      display: flex; align-items: flex-start; gap: 10px;
      font-size: 12px; color: var(--tgo-text); line-height: 1.4;
    }
    .tgo-package-icon {
      flex: 0 0 18px; color: var(--tgo-accent); font-size: 14px; text-align: center;
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
    .tgo-price-block { display: flex; flex-direction: column; gap: 2px; }
    .tgo-price {
      font-weight: 800; font-size: 22px; color: var(--tgo-text);
      line-height: 1;
    }
    .tgo-price-was {
      font-size: 12px; color: var(--tgo-strike);
      text-decoration: line-through;
    }
    .tgo-price-sub { font-size: 11px; color: var(--tgo-sub); }
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
      return {
        // Travelify creds — embedded in config (Travelify confirmed safe)
        appId: c.appId || '',
        apiKey: c.apiKey || '',

        // What to fetch
        type: c.type || 'Accommodation',         // Accommodation, Flights, DynamicPackages, PackageHolidays, Any
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

        // Display
        layout: c.layout || 'grid',
        columns: c.columns || 'auto',           // 'auto', '2', '3', '4'
        density: c.density || 'standard',       // 'compact', 'standard', 'detailed'
        theme: c.theme || 'light',              // 'light', 'dark'
        brandColor: c.brandColor || '',
        accentColor: c.accentColor || '',
        radius: typeof c.radius === 'number' ? c.radius : 14,
        fontFamily: c.fontFamily || '',

        // Show/hide toggles
        show: Object.assign({
          summary: true,
          propertyType: true,
          amenities: true,
          reviews: true,
          variantCount: true,
          leadInPill: true,
          wasPrice: true,
          carrierImage: true,
          packageOperator: true,
          flightSchedule: true,
          poweredBy: false,
        }, c.show || {}),

        // Behaviour
        dedupeStrategy: c.dedupeStrategy || 'hotel',
        cacheMinutes: typeof c.cacheMinutes === 'number' ? c.cacheMinutes : 15,
        emptyBehaviour: c.emptyBehaviour || 'show',  // 'show' | 'hide'
        emptyHeading: c.emptyHeading || 'No offers available right now',
        emptyBody: c.emptyBody || 'We couldn\'t find any matching offers in the current cache. Try our search to find more deals.',
        emptyCtaText: c.emptyCtaText || '',
        emptyCtaUrl: c.emptyCtaUrl || '',

        // Internal — for inline embed/testing only
        _widgetId: c._widgetId || '',
      };
    }

    _render() {
      this.shadow.innerHTML = '<style>' + STYLES + '</style>';
      this.root = document.createElement('div');
      this.root.className = 'tgo-root';
      this.root.setAttribute('data-theme', this.cfg.theme === 'dark' ? 'dark' : 'light');

      // Apply brand/accent overrides if present
      if (this.cfg.brandColor) this.root.style.setProperty('--tgo-brand', this.cfg.brandColor);
      if (this.cfg.accentColor) {
        this.root.style.setProperty('--tgo-accent', this.cfg.accentColor);
        this.root.style.setProperty('--tgo-accent-hover', this.cfg.accentColor);
      }
      if (this.cfg.radius) this.root.style.setProperty('--tgo-radius', this.cfg.radius + 'px');

      // Font family — load Google Font once per page, apply via :host variable
      if (this.cfg.fontFamily) {
        loadFontFamily(this.cfg.fontFamily);
        const stack = fontStack(this.cfg.fontFamily);
        if (stack) this.el.style.setProperty('--tgo-font-family', stack);
      }

      // Density → card min-width
      const cardMin = this.cfg.density === 'compact' ? '260px'
        : this.cfg.density === 'detailed' ? '380px'
        : '320px';
      this.root.style.setProperty('--tgo-card-min', cardMin);

      this.shadow.appendChild(this.root);
      this._showLoading();
      this._fetchAndRender();
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
        + '<div class="tgo-empty-icon">○</div>'
        + '<h3 class="tgo-empty-heading">' + esc(this.cfg.emptyHeading) + '</h3>'
        + '<p class="tgo-empty-body">' + esc(this.cfg.emptyBody) + '</p>'
        + cta
        + '</div>';
    }

    _buildPayload() {
      // Map our config 'type' to API 'type' + optional packageType
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
        packageType = null;
      }

      const p = {
        type: apiType,
        deduping: 'None',  // ALWAYS — we dedupe client-side
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

      // Try cache
      if (ttlMs > 0) {
        const cached = cacheGet(ck, ttlMs);
        if (cached) {
          this.rawOffers = cached;
          this._renderOffers();
          return;
        }
      }

      // Live call
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
      } catch (err) {
        this._showError(err.message || 'Network error.');
      }
    }

    _renderOffers() {
      const deduped = dedupeOffers(this.rawOffers, this.cfg.dedupeStrategy, this.cfg.sort);

      if (!deduped.length) {
        this._showEmpty();
        return;
      }

      const cols = this.cfg.columns === 'auto' ? '' : ' data-cols="' + esc(this.cfg.columns) + '"';
      let html = '<div class="tgo-grid"' + cols + '>';
      for (const o of deduped) {
        switch (o.type) {
          case 'Accommodation': html += this._renderAccommodation(o); break;
          case 'Flights':
          case 'Flight': html += this._renderFlight(o); break;
          case 'Packages':
          case 'Package': html += this._renderPackage(o); break;
          default: html += this._renderUnknown(o);
        }
      }
      html += '</div>';
      if (this.cfg.show.poweredBy) {
        html += '<div class="tgo-powered">Powered by Travelgenix</div>';
      }
      this.root.innerHTML = html;
    }

    _variantBadge(o) {
      if (!this.cfg.show.variantCount) return '';
      if (!o._variantCount || o._variantCount <= 1) return '';
      return '<div class="tgo-card-variants">+' + (o._variantCount - 1) + ' more</div>';
    }

    _reviewScoreClass(score) {
      if (!score) return '';
      if (score >= 8) return 'high';
      if (score >= 6) return 'mid';
      return '';
    }

    _renderPriceFooter(o, wasPrice) {
      const price = o.formattedPPPrice || o.formattedPrice || '';
      const sub = o.formattedPPPrice ? 'per person' : (o.formattedPrice ? 'total' : '');
      const url = safeUrl(o.url || '#');
      const wasHtml = (this.cfg.show.wasPrice && wasPrice) ? '<div class="tgo-price-was">' + esc(wasPrice) + '</div>' : '';
      return '<div class="tgo-card-footer">'
        + '<div class="tgo-price-block">'
        + wasHtml
        + '<div class="tgo-price">' + esc(price) + '</div>'
        + (sub ? '<div class="tgo-price-sub">' + esc(sub) + '</div>' : '')
        + '</div>'
        + '<a class="tgo-cta" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">View deal</a>'
        + '</div>';
    }

    _renderAccommodation(o) {
      const acc = o.accommodation || {};
      const dest = acc.destination || {};
      const pricing = acc.pricing || {};
      const img = (acc.image && acc.image.url) || '';
      const ratingStars = acc.rating ? '★'.repeat(Math.round(acc.rating)) : '';
      const reviewScore = acc.reviewRating;
      const reviewCount = acc.reviewCount;
      const amenities = Array.isArray(acc.amenities) ? acc.amenities : [];
      const isLeadIn = pricing.isLeadIn === true;
      const showSummary = this.cfg.show.summary && acc.summary;
      const showAmenities = this.cfg.show.amenities && amenities.length > 0;
      const showReviews = this.cfg.show.reviews && (reviewScore || reviewCount);
      const showPropType = this.cfg.show.propertyType && acc.propertyType;
      const dense = this.cfg.density === 'compact';

      let html = '<div class="tgo-card">';
      html += '<div class="tgo-card-image" style="background-image:url(' + JSON.stringify(safeUrl(img)) + ')">';
      if (ratingStars) html += '<div class="tgo-card-badge">' + esc(ratingStars) + '</div>';
      html += '<div class="tgo-card-type-badge">Hotel</div>';
      html += this._variantBadge(o);
      if (this.cfg.show.leadInPill && isLeadIn) html += '<div class="tgo-card-pill">Lead-in price</div>';
      html += '</div>';

      html += '<div class="tgo-card-body">';
      if (showPropType) html += '<div class="tgo-card-property-type">' + esc(formatEnum(acc.propertyType)) + '</div>';
      html += '<h3 class="tgo-card-name">' + esc(acc.name || 'Hotel') + '</h3>';
      if (acc.chain) html += '<div class="tgo-card-meta">' + esc(acc.chain) + '</div>';
      html += '<div class="tgo-card-location">' + esc(dest.name || '') + (dest.countryCode ? ', ' + esc(dest.countryCode) : '') + '</div>';
      if (showSummary && !dense) html += '<div class="tgo-card-summary">' + esc(acc.summary) + '</div>';
      html += '</div>';

      if (showReviews) {
        html += '<div class="tgo-reviews">';
        if (reviewScore) html += '<div class="tgo-review-score ' + this._reviewScoreClass(reviewScore) + '">' + esc(reviewScore.toFixed(1)) + '</div>';
        html += '<div class="tgo-review-text">';
        if (reviewCount) html += '<div>' + esc(reviewCount.toLocaleString()) + ' reviews</div>';
        html += '</div></div>';
      }

      if (this.cfg.density !== 'compact') {
        html += '<div class="tgo-section">'
          + '<div class="tgo-section-title">Stay details</div>'
          + this._row('Check-in', formatDate(acc.checkinDate))
          + this._row('Nights', acc.nights ? String(acc.nights) : '')
          + this._row('Board', formatEnum(acc.boardBasis))
          + this._row('Travelling', paxString(o))
          + '</div>';
      }

      if (showAmenities && this.cfg.density === 'detailed') {
        const visible = amenities.slice(0, 10);
        const extras = amenities.length - visible.length;
        html += '<div class="tgo-section"><div class="tgo-section-title">Amenities</div><div class="tgo-amenities">';
        for (const a of visible) html += '<span class="tgo-amenity">' + esc(formatEnum(a)) + '</span>';
        if (extras > 0) html += '<span class="tgo-amenity">+' + extras + '</span>';
        html += '</div></div>';
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
      const img = (f.image && f.image.url) || '';
      const isDirect = f.direct === true;
      const stops = f.stops || 0;
      const stopsLabel = isDirect ? 'Direct' : (stops === 1 ? '1 stop' : stops + ' stops');
      const tripType = f.returnDate ? 'Return' : 'One-way';
      const priceChanged = pricing.priceChanged === true && pricing.priceBeforeChange;
      const isLeadIn = pricing.isLeadIn === true;
      const showCarrierImg = this.cfg.show.carrierImage && img;
      const dense = this.cfg.density === 'compact';

      let html = '<div class="tgo-card">';
      if (showCarrierImg) {
        html += '<div class="tgo-card-image flight" style="background-image:url(' + JSON.stringify(safeUrl(img)) + ')">'
          + '<div class="tgo-card-type-badge">Flight</div>'
          + this._variantBadge(o)
          + (this.cfg.show.leadInPill && isLeadIn ? '<div class="tgo-card-pill">Lead-in price</div>' : '')
          + '</div>';
      }
      html += '<div class="tgo-route">'
        + '<div class="tgo-airport">'
        + '<div class="tgo-iata">' + esc(og.iataCode || '???') + '</div>'
        + '<div class="tgo-airport-name">' + esc(og.name || '') + '</div>'
        + '</div>'
        + '<div class="tgo-arrow">'
        + '<div class="tgo-arrow-line"></div>'
        + '<div class="tgo-stops-label ' + (isDirect ? 'direct' : '') + '">' + esc(stopsLabel) + '</div>'
        + '</div>'
        + '<div class="tgo-airport right">'
        + '<div class="tgo-iata">' + esc(dest.iataCode || '???') + '</div>'
        + '<div class="tgo-airport-name">' + esc(dest.name || '') + '</div>'
        + '</div>'
        + '</div>';

      if (f.duration) {
        html += '<div class="tgo-flight-duration-row">'
          + esc(formatDuration(f.duration))
          + ' · ' + esc(tripType)
          + (f.cabinClass ? ' · ' + esc(formatEnum(f.cabinClass)) : '')
          + '</div>';
      }

      html += '<div class="tgo-carrier-row">'
        + (carrier.code ? '<span class="tgo-carrier-code">' + esc(carrier.code) + '</span>' : '')
        + '<span class="tgo-carrier-name">' + esc(carrier.name || 'Carrier') + '</span>'
        + '<span class="tgo-pax">' + esc(paxString(o)) + '</span>'
        + '</div>';

      if (this.cfg.show.flightSchedule && !dense) {
        html += '<div class="tgo-section">'
          + '<div class="tgo-section-title">Schedule</div>'
          + this._row('Outbound', formatDateTime(f.outboundDate))
          + (f.returnDate ? this._row('Return', formatDateTime(f.returnDate)) : '')
          + this._row('Fare', formatEnum(pricing.refundability))
          + '</div>';
      }

      const wasPrice = priceChanged ? '£' + Math.round(pricing.priceBeforeChange) : null;
      html += this._renderPriceFooter(o, wasPrice);
      html += '</div>';
      return html;
    }

    _renderPackage(o) {
      const pkg = o.package || {};
      const acc = pkg.accommodation || o.accommodation || {};
      const f = pkg.flight || o.flight || {};
      const ob = pkg.outbound || o.outbound || f.outbound || {};
      const dest = acc.destination || pkg.destination || f.destination || {};
      const accPricing = acc.pricing || {};
      const flightPricing = f.pricing || {};
      const img = (acc.image && acc.image.url) || (pkg.image && pkg.image.url) || (f.image && f.image.url) || '';
      const ratingStars = acc.rating ? '★'.repeat(Math.round(acc.rating)) : '';
      const reviewScore = acc.reviewRating;
      const reviewCount = acc.reviewCount;
      const amenities = Array.isArray(acc.amenities) ? acc.amenities : [];
      const fromCode = (f.origin && f.origin.iataCode) || (ob.origin && ob.origin.iataCode) || ob.iataCode || '';
      const toCode = (f.destination && f.destination.iataCode) || (ob.destination && ob.destination.iataCode) || dest.iataCode || '';
      const carrierName = (f.carrier && f.carrier.name) || (ob.carrier && ob.carrier.name) || '';
      const carrierCode = (f.carrier && f.carrier.code) || (ob.carrier && ob.carrier.code) || '';
      const isDirect = f.direct === true || ob.direct === true;
      const stops = (f.stops != null) ? f.stops : (ob.stops != null ? ob.stops : null);
      const stopsLabel = isDirect ? 'Direct' : (stops === 1 ? '1 stop' : (stops > 1 ? stops + ' stops' : ''));
      const outboundDate = f.outboundDate || ob.outboundDate || ob.departureDate || ob.departureTime || '';
      const returnDate = f.returnDate || ob.returnDate || '';
      const flightDuration = f.duration || ob.duration;
      const cabin = f.cabinClass || ob.cabinClass;
      const packageType = detectPackageType(o);
      const operator = pkg.operator || pkg.operatorName || pkg.supplier || o.operator || o.supplier || '';
      const atol = pkg.atolProtected === true || pkg.isAtolProtected === true || o.atolProtected === true;
      const isHoliday = packageType === 'PackageHolidays';
      const pricing = o.pricing || pkg.pricing || accPricing || flightPricing || {};
      const priceChanged = pricing.priceChanged === true && pricing.priceBeforeChange;
      const isLeadIn = (accPricing.isLeadIn || flightPricing.isLeadIn || pricing.isLeadIn) === true;
      const badgeText = isHoliday ? 'Package Holiday' : (packageType === 'DynamicPackages' ? 'Flight + Hotel' : 'Package');
      const badgeClass = isHoliday ? 'package-holiday' : (packageType === 'DynamicPackages' ? 'package-dynamic' : '');
      const showOperator = this.cfg.show.packageOperator && isHoliday && operator;
      const dense = this.cfg.density === 'compact';

      let html = '<div class="tgo-card">';
      html += '<div class="tgo-card-image" style="background-image:url(' + JSON.stringify(safeUrl(img)) + ')">';
      if (ratingStars) html += '<div class="tgo-card-badge">' + esc(ratingStars) + '</div>';
      html += '<div class="tgo-card-type-badge ' + badgeClass + '">' + esc(badgeText) + '</div>';
      html += this._variantBadge(o);
      if (this.cfg.show.leadInPill && isLeadIn) html += '<div class="tgo-card-pill">Lead-in price</div>';
      html += '</div>';

      if (showOperator) {
        html += '<div class="tgo-package-operator">'
          + '<span class="tgo-operator-label">Operator</span>'
          + '<span class="tgo-operator-name">' + esc(operator) + '</span>'
          + (atol ? '<span class="tgo-operator-atol">ATOL</span>' : '')
          + '</div>';
      }

      html += '<div class="tgo-card-body">';
      if (this.cfg.show.propertyType && acc.propertyType) {
        html += '<div class="tgo-card-property-type">' + esc(formatEnum(acc.propertyType)) + '</div>';
      }
      html += '<h3 class="tgo-card-name">' + esc(acc.name || pkg.name || 'Package holiday') + '</h3>';
      html += '<div class="tgo-card-location">' + esc(dest.name || '') + (dest.countryCode ? ', ' + esc(dest.countryCode) : '') + '</div>';
      if (this.cfg.show.summary && !dense && acc.summary) {
        html += '<div class="tgo-card-summary">' + esc(acc.summary) + '</div>';
      }
      html += '</div>';

      // Inline package summary — flight + hotel + pax
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
        html += '<div class="tgo-package-summary">';
        if (flightLine) {
          html += '<div class="tgo-package-line">'
            + '<span class="tgo-package-icon">✈</span>'
            + '<span><strong>' + esc(flightLine) + '</strong>'
            + (outboundDate ? '<div class="tgo-package-line-detail">Departs ' + esc(formatDate(outboundDate))
              + (returnDate ? ' · Returns ' + esc(formatDate(returnDate)) : '')
              + (flightDuration ? ' · ' + esc(formatDuration(flightDuration)) : '')
              + (cabin ? ' · ' + esc(formatEnum(cabin)) : '')
              + '</div>' : '')
            + '</span></div>';
        }
        if (hotelLine) {
          html += '<div class="tgo-package-line">'
            + '<span class="tgo-package-icon">🏨</span>'
            + '<span><strong>' + esc(hotelLine) + '</strong>'
            + (acc.checkinDate ? '<div class="tgo-package-line-detail">Check-in ' + esc(formatDate(acc.checkinDate)) + '</div>' : '')
            + '</span></div>';
        }
        html += '<div class="tgo-package-line">'
          + '<span class="tgo-package-icon">👥</span>'
          + '<span>' + esc(paxString(o) || 'Travellers') + '</span></div>';
        html += '</div>';
      }

      if (this.cfg.show.reviews && (reviewScore || reviewCount)) {
        html += '<div class="tgo-reviews">';
        if (reviewScore) html += '<div class="tgo-review-score ' + this._reviewScoreClass(reviewScore) + '">' + esc(reviewScore.toFixed(1)) + '</div>';
        html += '<div class="tgo-review-text">';
        if (reviewCount) html += '<div>' + esc(reviewCount.toLocaleString()) + ' reviews</div>';
        html += '</div></div>';
      }

      if (this.cfg.show.amenities && this.cfg.density === 'detailed' && amenities.length) {
        const visible = amenities.slice(0, 10);
        const extras = amenities.length - visible.length;
        html += '<div class="tgo-section"><div class="tgo-section-title">Amenities</div><div class="tgo-amenities">';
        for (const a of visible) html += '<span class="tgo-amenity">' + esc(formatEnum(a)) + '</span>';
        if (extras > 0) html += '<span class="tgo-amenity">+' + extras + '</span>';
        html += '</div></div>';
      }

      const wasPrice = priceChanged ? '£' + Math.round(pricing.priceBeforeChange) : null;
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

    _row(label, value) {
      if (value === null || value === undefined || value === '') return '';
      return '<div class="tgo-data-row">'
        + '<span class="tgo-data-label">' + esc(label) + '</span>'
        + '<span class="tgo-data-value">' + esc(String(value)) + '</span>'
        + '</div>';
    }

    // Public API for re-rendering after config change (used in editor preview)
    update(newConfig) {
      this.cfg = this._defaults(Object.assign({}, this.cfg, newConfig));
      this.shadow.innerHTML = '<style>' + STYLES + '</style>';
      this.root = document.createElement('div');
      this.root.className = 'tgo-root';
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
      const cardMin = this.cfg.density === 'compact' ? '260px'
        : this.cfg.density === 'detailed' ? '380px'
        : '320px';
      this.root.style.setProperty('--tgo-card-min', cardMin);
      this.shadow.appendChild(this.root);
      this._showLoading();
      this._fetchAndRender();
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

  // Expose class globally for editors / programmatic use
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
