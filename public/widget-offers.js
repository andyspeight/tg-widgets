/**
 * Travelgenix Travel Offers Widget v1.4.0
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
 *
 * Changelog:
 *   v1.4.0 (May 2026) — Magazine mosaic + departure-board status pills:
 *     • Magazine template redesigned as editorial mosaic — hero, banner row,
 *       3-up with pull-quote card in middle, then more tiles
 *     • Pull-quote source 3-tier fallback: o.editorialQuote → o.accommodation.summary → fall back to standard tile
 *     • Editorial dividers (small caps typography) between sections
 *     • Departure board: three new status pills — Tomorrow (orange), Going soon
 *       (teal, configurable threshold), Premium cabin (purple)
 *     • Pill priority: Cheapest > Premium > Today > Tomorrow > This week > Going soon
 *     • New config keys: boardShowTomorrow, boardShowGoingSoon, boardGoingSoonDays,
 *       boardShowPremiumCabin, magazineShowQuote, magazineShowDividers
 *   v1.3.0 — Hyper-realistic Solari split-flap departure board
 *   v1.2.0 — Added three new visual options: List layout, Magazine template,
 *     Boarding-pass template
 *   v1.1.0 — Carousel layout + departure-board template + pax popover.
 */
(function () {
  'use strict';

  const API_BASE = (typeof window !== 'undefined' && window.__TG_WIDGET_API__) || '/api/widget-config';
  const TRAVELIFY_ENDPOINT = 'https://api.travelify.io/widgetsvc/traveloffers';
  const VERSION = '1.4.0';
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

  // ── Departure-board template helpers ─────────────────────────────────
  //
  // The departure-board template renders flights as an airport-style board.
  // It needs: airport lookup with coordinates (for nearest-airport detection),
  // haversine distance, IP geolocation, and time/date formatters specific to
  // a board look. These constants and helpers live here so the template can
  // reference them.

  const GEO_API_URL = 'https://ipapi.co/json/';
  const GEO_CACHE_KEY = 'tgo_db_geo_v1';

  // UK + Ireland airports with lat/lng for haversine nearest-airport.
  // Weighted toward airports UK leisure travellers actually use.
  const UK_AIRPORTS = [
    { code: 'LHR', name: 'Heathrow', city: 'London', lat: 51.4700, lng: -0.4543 },
    { code: 'LGW', name: 'Gatwick', city: 'London', lat: 51.1481, lng: -0.1903 },
    { code: 'STN', name: 'Stansted', city: 'London', lat: 51.8860, lng: 0.2389 },
    { code: 'LTN', name: 'Luton', city: 'London', lat: 51.8747, lng: -0.3683 },
    { code: 'LCY', name: 'City', city: 'London', lat: 51.5048, lng: 0.0495 },
    { code: 'SEN', name: 'Southend', city: 'Southend', lat: 51.5714, lng: 0.6956 },
    { code: 'MAN', name: 'Manchester', city: 'Manchester', lat: 53.3537, lng: -2.2750 },
    { code: 'BHX', name: 'Birmingham', city: 'Birmingham', lat: 52.4539, lng: -1.7480 },
    { code: 'EMA', name: 'East Midlands', city: 'Nottingham', lat: 52.8311, lng: -1.3281 },
    { code: 'EDI', name: 'Edinburgh', city: 'Edinburgh', lat: 55.9500, lng: -3.3725 },
    { code: 'GLA', name: 'Glasgow', city: 'Glasgow', lat: 55.8642, lng: -4.4331 },
    { code: 'PIK', name: 'Prestwick', city: 'Glasgow', lat: 55.5094, lng: -4.5867 },
    { code: 'NCL', name: 'Newcastle', city: 'Newcastle', lat: 55.0375, lng: -1.6917 },
    { code: 'LBA', name: 'Leeds Bradford', city: 'Leeds', lat: 53.8659, lng: -1.6605 },
    { code: 'BRS', name: 'Bristol', city: 'Bristol', lat: 51.3827, lng: -2.7191 },
    { code: 'CWL', name: 'Cardiff', city: 'Cardiff', lat: 51.3967, lng: -3.3433 },
    { code: 'LPL', name: 'Liverpool', city: 'Liverpool', lat: 53.3336, lng: -2.8497 },
    { code: 'BFS', name: 'Belfast Intl', city: 'Belfast', lat: 54.6575, lng: -6.2158 },
    { code: 'BHD', name: 'Belfast City', city: 'Belfast', lat: 54.6181, lng: -5.8725 },
    { code: 'ABZ', name: 'Aberdeen', city: 'Aberdeen', lat: 57.2019, lng: -2.1978 },
    { code: 'INV', name: 'Inverness', city: 'Inverness', lat: 57.5425, lng: -4.0475 },
    { code: 'SOU', name: 'Southampton', city: 'Southampton', lat: 50.9503, lng: -1.3568 },
    { code: 'EXT', name: 'Exeter', city: 'Exeter', lat: 50.7344, lng: -3.4139 },
    { code: 'BOH', name: 'Bournemouth', city: 'Bournemouth', lat: 50.7800, lng: -1.8425 },
    { code: 'NWI', name: 'Norwich', city: 'Norwich', lat: 52.6758, lng: 1.2828 },
    { code: 'HUY', name: 'Humberside', city: 'Hull', lat: 53.5744, lng: -0.3508 },
    { code: 'DUB', name: 'Dublin', city: 'Dublin', lat: 53.4214, lng: -6.2700 },
    { code: 'ORK', name: 'Cork', city: 'Cork', lat: 51.8413, lng: -8.4911 },
    { code: 'JER', name: 'Jersey', city: 'Jersey', lat: 49.2079, lng: -2.1955 },
    { code: 'GCI', name: 'Guernsey', city: 'Guernsey', lat: 49.4350, lng: -2.6020 },
  ];
  const AIRPORT_BY_CODE = UK_AIRPORTS.reduce((m, a) => { m[a.code] = a; return m; }, {});

  function haversine(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2
      + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function nearestAirport(lat, lng) {
    let best = null, bestDist = Infinity;
    for (const a of UK_AIRPORTS) {
      const d = haversine(lat, lng, a.lat, a.lng);
      if (d < bestDist) { bestDist = d; best = a; }
    }
    return best;
  }

  // Try to find the visitor's nearest airport via IP geolocation. Cached in
  // sessionStorage so we only call once per visit. Falls back to the supplied
  // default if anything goes wrong (offline, blocked, non-UK visitor).
  async function detectAirport(defaultCode) {
    try {
      const cached = sessionStorage.getItem(GEO_CACHE_KEY);
      if (cached) {
        const obj = JSON.parse(cached);
        if (obj && obj.code && AIRPORT_BY_CODE[obj.code]) return AIRPORT_BY_CODE[obj.code];
      }
    } catch { /* ignore */ }

    try {
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 3000);
      const res = await fetch(GEO_API_URL, { signal: ctrl.signal });
      clearTimeout(timeout);
      if (!res.ok) throw new Error('geo failed');
      const json = await res.json();
      const lat = parseFloat(json.latitude);
      const lng = parseFloat(json.longitude);
      if (!isFinite(lat) || !isFinite(lng)) throw new Error('no coords');
      const airport = nearestAirport(lat, lng);
      if (airport) {
        try { sessionStorage.setItem(GEO_CACHE_KEY, JSON.stringify({ code: airport.code })); } catch { /* ignore */ }
        return airport;
      }
    } catch { /* ignore */ }

    return AIRPORT_BY_CODE[defaultCode] || AIRPORT_BY_CODE.LHR || UK_AIRPORTS[0];
  }

  // Format an outbound ISO date as the board's "TIME" column (HH:MM 24-hour)
  function formatBoardTime(iso) {
    if (!iso) return '--:--';
    try {
      const d = new Date(iso);
      const h = String(d.getUTCHours()).padStart(2, '0');
      const m = String(d.getUTCMinutes()).padStart(2, '0');
      return h + ':' + m;
    } catch { return '--:--'; }
  }

  function formatBoardDate(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }).toUpperCase();
    } catch { return ''; }
  }

  function formatBoardNow() {
    const d = new Date();
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  // Returns { category, days } where category is 'today' / 'tomorrow' /
  // 'thisWeek' / 'soon' / 'later' for status pill logic, and days is the
  // raw days-from-now (used when callers need a configurable threshold).
  // Negative days = past departures (treated as 'later').
  function dateProximity(iso) {
    if (!iso) return { category: 'later', days: Infinity };
    const dep = new Date(iso);
    const diffMs = dep.getTime() - Date.now();
    const diffDays = diffMs / 86400000;
    if (diffDays < 0) return { category: 'later', days: diffDays };
    if (diffDays < 1) return { category: 'today', days: diffDays };
    if (diffDays < 2) return { category: 'tomorrow', days: diffDays };
    if (diffDays < 7) return { category: 'thisWeek', days: diffDays };
    if (diffDays < 30) return { category: 'soon', days: diffDays };
    return { category: 'later', days: diffDays };
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

    /* ═══════════════════════════════════════════════════════════════════
       DEPARTURE-BOARD TEMPLATE
       Uses tdb- prefix throughout to avoid colliding with the cards
       template's tgo- classes. Has its own theme (dark/light) and font
       stack (monospace columns are essential to the airport-board look).
       ═══════════════════════════════════════════════════════════════════ */
    .tdb-root {
      width: 100%;
      max-width: 100%;
      box-sizing: border-box;
      font-family: var(--tdb-font-body, 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif);
      color: var(--tdb-text);
      background: var(--tdb-bg);
      border-radius: var(--tdb-radius, 14px);
      overflow: hidden;
      isolation: isolate;
    }
    .tdb-root[data-theme="dark"] {
      --tdb-bg: #0A0E14;
      --tdb-surface: #11161F;
      --tdb-text: #E8EAED;
      --tdb-text-dim: #94A3B8;
      --tdb-accent: #FFB400;
      --tdb-accent-soft: rgba(255, 180, 0, 0.12);
      --tdb-border: rgba(255, 255, 255, 0.08);
      --tdb-row-alt: rgba(255, 255, 255, 0.02);
      --tdb-pill-cheap-bg: rgba(255, 180, 0, 0.18);
      --tdb-pill-cheap-fg: #FFD15C;
      --tdb-pill-today-bg: rgba(239, 68, 68, 0.18);
      --tdb-pill-today-fg: #FCA5A5;
      --tdb-pill-tomorrow-bg: rgba(245, 158, 11, 0.18);
      --tdb-pill-tomorrow-fg: #FCD34D;
      --tdb-pill-week-bg: rgba(56, 189, 248, 0.16);
      --tdb-pill-week-fg: #7DD3FC;
      --tdb-pill-soon-bg: rgba(20, 184, 166, 0.18);
      --tdb-pill-soon-fg: #5EEAD4;
      --tdb-pill-premium-bg: rgba(168, 85, 247, 0.18);
      --tdb-pill-premium-fg: #D8B4FE;
      --tdb-live: #4ADE80;
    }
    .tdb-root[data-theme="light"] {
      --tdb-bg: #FFFFFF;
      --tdb-surface: #F8FAFC;
      --tdb-text: #0F172A;
      --tdb-text-dim: #64748B;
      --tdb-accent: #1B2B5B;
      --tdb-accent-soft: rgba(27, 43, 91, 0.08);
      --tdb-border: #E2E8F0;
      --tdb-row-alt: #F8FAFC;
      --tdb-pill-cheap-bg: #FEF3C7;
      --tdb-pill-cheap-fg: #92400E;
      --tdb-pill-today-bg: #FEE2E2;
      --tdb-pill-today-fg: #B91C1C;
      --tdb-pill-tomorrow-bg: #FED7AA;
      --tdb-pill-tomorrow-fg: #9A3412;
      --tdb-pill-week-bg: #DBEAFE;
      --tdb-pill-week-fg: #1E40AF;
      --tdb-pill-soon-bg: #CCFBF1;
      --tdb-pill-soon-fg: #115E59;
      --tdb-pill-premium-bg: #F3E8FF;
      --tdb-pill-premium-fg: #6B21A8;
      --tdb-live: #10B981;
    }
    .tdb-header {
      display: flex; align-items: center; justify-content: space-between;
      gap: 16px;
      padding: 18px 22px;
      background: var(--tdb-surface);
      border-bottom: 1px solid var(--tdb-border);
    }
    .tdb-header-left {
      display: flex; align-items: center; gap: 14px;
      min-width: 0;
    }
    .tdb-icon {
      width: 38px; height: 38px;
      display: flex; align-items: center; justify-content: center;
      background: var(--tdb-accent-soft);
      color: var(--tdb-accent);
      border-radius: 10px;
      flex-shrink: 0;
    }
    .tdb-icon svg { width: 20px; height: 20px; }
    .tdb-title-block { min-width: 0; }
    .tdb-title {
      font-family: var(--tdb-font-mono, 'JetBrains Mono', 'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, monospace);
      font-size: 14px;
      font-weight: 700;
      color: var(--tdb-text);
      letter-spacing: 0.04em;
      text-transform: uppercase;
      margin: 0;
      line-height: 1.2;
    }
    .tdb-airport-pick {
      display: inline-flex; align-items: center; gap: 4px;
      background: transparent; border: 0; padding: 0;
      font: inherit; cursor: pointer; color: inherit;
    }
    .tdb-airport-pick:hover { color: var(--tdb-accent); }
    .tdb-airport-pick svg { width: 12px; height: 12px; transition: transform 0.15s ease; }
    .tdb-airport-pick[aria-expanded="true"] svg { transform: rotate(180deg); }
    .tdb-subtitle {
      font-size: 11px; color: var(--tdb-text-dim);
      margin: 3px 0 0;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .tdb-now {
      display: flex; align-items: center; gap: 8px;
      font-family: var(--tdb-font-mono, 'JetBrains Mono', monospace);
      font-size: 12px;
      font-weight: 600;
      color: var(--tdb-text-dim);
      letter-spacing: 0.05em;
      text-transform: uppercase;
      flex-shrink: 0;
      white-space: nowrap;
    }
    .tdb-live-dot {
      width: 8px; height: 8px;
      border-radius: 999px;
      background: var(--tdb-live);
      box-shadow: 0 0 0 0 currentColor;
      animation: tdb-pulse 2s infinite;
      color: var(--tdb-live);
    }
    @keyframes tdb-pulse {
      0%   { box-shadow: 0 0 0 0 currentColor; }
      70%  { box-shadow: 0 0 0 6px transparent; }
      100% { box-shadow: 0 0 0 0 transparent; }
    }
    @media (prefers-reduced-motion: reduce) {
      .tdb-live-dot { animation: none; }
    }

    /* Airport switcher */
    .tdb-switcher { position: relative; }
    .tdb-switcher-menu {
      position: absolute;
      top: calc(100% + 6px); left: 0;
      z-index: 10;
      min-width: 240px;
      max-height: 260px;
      overflow-y: auto;
      background: var(--tdb-surface);
      border: 1px solid var(--tdb-border);
      border-radius: 10px;
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.25);
      padding: 4px;
      list-style: none;
      margin: 0;
    }
    .tdb-switcher-menu[hidden] { display: none; }
    .tdb-switcher-item {
      width: 100%;
      display: flex; align-items: center; justify-content: space-between;
      gap: 12px;
      padding: 8px 10px;
      background: transparent; border: 0;
      border-radius: 6px;
      font: inherit; font-size: 13px;
      color: var(--tdb-text);
      cursor: pointer;
      text-align: left;
    }
    .tdb-switcher-item:hover { background: var(--tdb-accent-soft); }
    .tdb-switcher-item[aria-current="true"] {
      background: var(--tdb-accent-soft);
      color: var(--tdb-accent);
    }
    .tdb-switcher-code {
      font-family: var(--tdb-font-mono, monospace);
      font-weight: 700;
      font-size: 11px;
      letter-spacing: 0.05em;
      color: var(--tdb-text-dim);
    }

    /* Table */
    .tdb-table {
      font-family: var(--tdb-font-mono, 'JetBrains Mono', 'IBM Plex Mono', ui-monospace, monospace);
      font-size: 13px;
    }
    .tdb-row {
      display: grid;
      grid-template-columns: 64px 1fr 1.2fr 60px 90px 90px 96px;
      gap: 12px;
      padding: 14px 22px;
      align-items: center;
      border-bottom: 1px solid var(--tdb-border);
    }
    .tdb-row:last-child { border-bottom: 0; }
    .tdb-row.tdb-head {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--tdb-text-dim);
      padding-top: 12px; padding-bottom: 12px;
      background: var(--tdb-row-alt);
    }
    .tdb-row.tdb-data:nth-child(odd) { background: var(--tdb-row-alt); }
    .tdb-time {
      font-weight: 700; font-size: 16px;
      letter-spacing: 0.05em;
      color: var(--tdb-text);
    }
    .tdb-route {
      font-weight: 700; font-size: 14px;
      letter-spacing: 0.04em;
      min-width: 0;
    }
    .tdb-route-codes {
      display: flex; align-items: center; gap: 6px;
      color: var(--tdb-text);
    }
    .tdb-route-codes .tdb-arrow { color: var(--tdb-accent); font-weight: 400; }
    .tdb-route-cities {
      font-size: 10px;
      font-weight: 400;
      color: var(--tdb-text-dim);
      letter-spacing: 0.04em;
      margin-top: 3px;
      text-transform: uppercase;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .tdb-carrier {
      font-size: 12px;
      color: var(--tdb-text);
      letter-spacing: 0.03em;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .tdb-carrier-code {
      display: inline-block;
      font-weight: 700;
      color: var(--tdb-accent);
      margin-right: 6px;
      font-size: 11px;
      letter-spacing: 0.05em;
    }
    .tdb-stops {
      text-align: center;
      font-size: 12px;
      color: var(--tdb-text-dim);
      letter-spacing: 0.04em;
    }
    .tdb-stops.tdb-direct { color: var(--tdb-live); font-weight: 600; }
    .tdb-date {
      font-size: 11px;
      color: var(--tdb-text-dim);
      letter-spacing: 0.06em;
      white-space: nowrap;
    }
    .tdb-status { display: flex; justify-content: flex-start; }
    .tdb-pill {
      display: inline-flex; align-items: center;
      padding: 4px 9px;
      border-radius: 999px;
      font-family: var(--tdb-font-body, 'Inter', system-ui, sans-serif);
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      white-space: nowrap;
    }
    .tdb-pill[data-kind="cheapest"] { background: var(--tdb-pill-cheap-bg); color: var(--tdb-pill-cheap-fg); }
    .tdb-pill[data-kind="today"]    { background: var(--tdb-pill-today-bg); color: var(--tdb-pill-today-fg); }
    .tdb-pill[data-kind="tomorrow"] { background: var(--tdb-pill-tomorrow-bg); color: var(--tdb-pill-tomorrow-fg); }
    .tdb-pill[data-kind="week"]     { background: var(--tdb-pill-week-bg); color: var(--tdb-pill-week-fg); }
    .tdb-pill[data-kind="soon"]     { background: var(--tdb-pill-soon-bg); color: var(--tdb-pill-soon-fg); }
    .tdb-pill[data-kind="premium"]  { background: var(--tdb-pill-premium-bg); color: var(--tdb-pill-premium-fg); }
    .tdb-fare {
      text-align: right;
      font-weight: 800; font-size: 16px;
      letter-spacing: 0.02em;
      color: var(--tdb-text);
    }
    .tdb-row.tdb-data {
      cursor: pointer;
      transition: background 0.15s ease;
    }
    .tdb-row.tdb-data:hover { background: var(--tdb-accent-soft); }

    /* ═══════════════════════════════════════════════════════════════════
       SOLARI SPLIT-FLAP MECHANISM
       Each animatable cell becomes a "flap stack" with three layers:
         .tdb-sf-top     — the static top half showing the CURRENT or NEW glyph
         .tdb-sf-bottom  — the static bottom half showing the OLD glyph
         .tdb-sf-flap    — the falling flap, animates rotateX from 0deg to 90deg,
                           with the OLD glyph on its front face and a hinge to
                           reveal the new bottom half once it lands.
       After each flap lands, the JS scheduler advances to the next glyph in
       the scramble path until the target glyph is reached.
       ═══════════════════════════════════════════════════════════════════ */
    .tdb-sf {
      display: inline-block;
      vertical-align: middle;
      perspective: 200px;
      line-height: 1;
      /* Each flap-stack cell holds its own width — match the mono digit em. */
      width: 0.7em;
      height: 1.15em;
      position: relative;
      /* The wrapper has the glyph background colour so the seam between
         halves looks like a single tile, not two stacked elements. */
      background: var(--tdb-flap-bg, var(--tdb-surface));
      border-radius: 2px;
      margin: 0 0.5px;
      overflow: hidden;
      /* GPU compositing — flat tiles never paint while their neighbours animate */
      contain: layout paint;
    }
    /* Multi-character flap (used for IATA codes — 3 chars per cell as one unit) */
    .tdb-sf-wide {
      width: auto;
      padding: 0 4px;
    }
    /* Glyph half — top and bottom each show the right half of the same character.
       The split is achieved by clipping at 50% height and offsetting the bottom
       half so both halves draw the same character but only one half is visible. */
    .tdb-sf-half {
      position: absolute;
      left: 0;
      right: 0;
      height: 50%;
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--tdb-flap-bg, var(--tdb-surface));
      color: var(--tdb-text);
      font-family: inherit;
      font-weight: inherit;
      font-size: inherit;
      letter-spacing: inherit;
      backface-visibility: hidden;
    }
    .tdb-sf-top {
      top: 0;
      align-items: flex-end;
      padding-bottom: 1px;
      /* Subtle top highlight — incoming light on a real flap */
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
    }
    .tdb-sf-bottom {
      bottom: 0;
      align-items: flex-start;
      padding-top: 1px;
      /* Centring trick: render full character but clip top half so we see the
         bottom half of the glyph in this half of the tile. */
    }
    .tdb-sf-half-inner {
      /* The glyph itself rendered at full height — the parent half clips */
      display: block;
      transform-origin: center center;
      will-change: transform;
    }
    .tdb-sf-top .tdb-sf-half-inner {
      transform: translateY(50%);
    }
    .tdb-sf-bottom .tdb-sf-half-inner {
      transform: translateY(-50%);
    }
    /* The falling flap — top half of the OLD glyph that rotates down to reveal
       the new bottom half. Pinned to top, hinged at its bottom edge. */
    .tdb-sf-flap {
      position: absolute;
      left: 0;
      right: 0;
      top: 0;
      height: 50%;
      transform-origin: center bottom;
      transform: rotateX(0deg);
      background: var(--tdb-flap-bg, var(--tdb-surface));
      color: var(--tdb-text);
      display: flex;
      align-items: flex-end;
      justify-content: center;
      padding-bottom: 1px;
      overflow: hidden;
      pointer-events: none;
      backface-visibility: hidden;
      /* Light/shadow gradient sells the 3D — top of flap catches light, bottom
         picks up shadow from the seam below. */
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
    }
    .tdb-sf-flap .tdb-sf-half-inner {
      transform: translateY(50%);
    }
    .tdb-sf-flap.is-falling {
      animation: tdb-sf-fall 80ms cubic-bezier(0.4, 0, 0.6, 1) forwards;
    }
    @keyframes tdb-sf-fall {
      0%   { transform: rotateX(0deg);   }
      100% { transform: rotateX(-90deg); }
    }
    /* Centre seam — the dividing line between the two halves. Real boards
       have a tiny gap with a shadow that catches the light. */
    .tdb-sf::after {
      content: '';
      position: absolute;
      left: 0;
      right: 0;
      top: 50%;
      height: 1px;
      background: rgba(0, 0, 0, 0.35);
      transform: translateY(-0.5px);
      z-index: 4;
      pointer-events: none;
    }
    .tdb-root[data-theme="light"] .tdb-sf::after {
      background: rgba(0, 0, 0, 0.18);
    }
    /* Theme-specific flap surface — slightly different from the row background
       so each tile reads as a distinct mechanical element. */
    .tdb-root[data-theme="dark"] {
      --tdb-flap-bg: #161D2A;
    }
    .tdb-root[data-theme="light"] {
      --tdb-flap-bg: #F1F5F9;
    }
    /* Reduced-motion: short-circuit to instant text replacement. The widget JS
       checks the same media query and skips the scrambler — this CSS is just
       belt-and-braces in case JS doesn't catch it. */
    @media (prefers-reduced-motion: reduce) {
      .tdb-sf-flap.is-falling {
        animation: none;
      }
    }

    /* Footer */
    .tdb-footer {
      display: flex; align-items: center; justify-content: space-between;
      gap: 12px;
      padding: 14px 22px;
      background: var(--tdb-surface);
      border-top: 1px solid var(--tdb-border);
      font-size: 11px;
      color: var(--tdb-text-dim);
      letter-spacing: 0.04em;
    }
    .tdb-footer-meta {
      font-family: var(--tdb-font-mono, monospace);
      text-transform: uppercase;
    }
    .tdb-refresh {
      background: transparent; border: 1px solid var(--tdb-border);
      padding: 6px 12px; border-radius: 6px;
      font: inherit; font-size: 11px; font-weight: 600;
      color: var(--tdb-text); cursor: pointer;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      transition: background 0.15s ease, border-color 0.15s ease;
      display: inline-flex; align-items: center; gap: 6px;
    }
    .tdb-refresh:hover {
      background: var(--tdb-accent-soft);
      border-color: var(--tdb-accent);
      color: var(--tdb-accent);
    }
    .tdb-refresh svg { width: 12px; height: 12px; transition: transform 0.4s ease; }
    .tdb-refresh.is-loading svg { animation: tdb-spin 0.8s linear infinite; }
    @keyframes tdb-spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) {
      .tdb-refresh.is-loading svg { animation: none; }
    }

    /* Empty state */
    .tdb-empty {
      padding: 60px 22px;
      text-align: center;
      font-family: var(--tdb-font-mono, monospace);
      font-size: 12px;
      color: var(--tdb-text-dim);
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .tdb-empty-title {
      font-size: 14px;
      color: var(--tdb-text);
      margin-bottom: 8px;
      font-weight: 700;
    }

    /* Responsive */
    @media (max-width: 760px) {
      .tdb-header { padding: 14px 16px; }
      .tdb-row { padding: 12px 16px; gap: 8px; grid-template-columns: 52px 1fr 1fr 70px 84px; }
      .tdb-row .tdb-stops, .tdb-row .tdb-date { display: none; }
      .tdb-row.tdb-head .tdb-stops, .tdb-row.tdb-head .tdb-date { display: none; }
      .tdb-route-cities { font-size: 9px; }
      .tdb-time { font-size: 14px; }
      .tdb-fare { font-size: 14px; }
      .tdb-footer { padding: 12px 16px; flex-direction: column; align-items: stretch; gap: 8px; }
    }
    @media (max-width: 460px) {
      .tdb-row { grid-template-columns: 48px 1fr 70px; }
      .tdb-row .tdb-carrier, .tdb-row .tdb-status { display: none; }
      .tdb-row.tdb-head .tdb-carrier, .tdb-row.tdb-head .tdb-status { display: none; }
    }

    /* ═══════════════════════════════════════════════════════════════════
       LIST LAYOUT (within Cards template)
       Compact horizontal rows. Image left, body middle, price right.
       Uses tgo- prefix because it shares variables with the cards template.
       ═══════════════════════════════════════════════════════════════════ */
    .tgo-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .tgo-list-row {
      display: grid;
      grid-template-columns: 220px 1fr 200px;
      gap: 0;
      background: var(--tgo-card);
      border: 1px solid var(--tgo-border);
      border-radius: var(--tgo-radius);
      overflow: hidden;
      transition: border-color 0.15s ease, transform 0.15s ease, box-shadow 0.15s ease;
    }
    .tgo-list-row:hover {
      border-color: var(--tgo-accent);
      transform: translateY(-1px);
      box-shadow: var(--tgo-shadow-hover);
    }
    @media (prefers-reduced-motion: reduce) {
      .tgo-list-row { transition: none; }
      .tgo-list-row:hover { transform: none; }
    }
    .tgo-list-img {
      position: relative;
      background: var(--tgo-card-alt) center/cover no-repeat;
      min-height: 160px;
    }
    .tgo-list-img-badge {
      position: absolute;
      top: 12px;
      left: 12px;
      background: var(--tgo-card);
      color: var(--tgo-text);
      font-size: 11px;
      font-weight: 600;
      padding: 4px 10px;
      border-radius: 999px;
      box-shadow: var(--tgo-shadow);
    }
    .tgo-list-img-badge.lead-in {
      background: var(--tgo-accent);
      color: white;
    }
    .tgo-list-body {
      padding: 18px 20px;
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 10px;
      min-width: 0;
    }
    .tgo-list-title {
      font-size: 16px;
      font-weight: 700;
      letter-spacing: -0.01em;
      margin: 0 0 4px;
      color: var(--tgo-text);
      line-height: 1.3;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .tgo-list-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 6px 14px;
      font-size: 12px;
      color: var(--tgo-sub);
    }
    .tgo-list-meta span {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .tgo-list-meta svg {
      color: var(--tgo-muted);
      flex-shrink: 0;
    }
    .tgo-list-stars {
      display: inline-flex;
      gap: 2px;
      color: #FFB400;
    }
    .tgo-list-stars svg {
      width: 13px;
      height: 13px;
      color: #FFB400;
    }
    .tgo-list-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
    }
    .tgo-list-tag {
      font-size: 10px;
      font-weight: 500;
      color: var(--tgo-sub);
      background: var(--tgo-card-alt);
      border: 1px solid var(--tgo-border);
      padding: 2px 7px;
      border-radius: 4px;
    }
    .tgo-list-price {
      padding: 18px 20px;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: flex-end;
      gap: 4px;
      border-left: 1px solid var(--tgo-border);
      background: var(--tgo-card-alt);
    }
    .tgo-list-was {
      font-size: 12px;
      color: var(--tgo-strike);
      text-decoration: line-through;
    }
    .tgo-list-now {
      font-size: 24px;
      font-weight: 800;
      letter-spacing: -0.02em;
      color: var(--tgo-text);
      line-height: 1;
    }
    .tgo-list-sub {
      font-size: 11px;
      color: var(--tgo-sub);
    }
    .tgo-list-cta {
      margin-top: 8px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: var(--tgo-accent);
      color: white;
      font-size: 13px;
      font-weight: 600;
      padding: 9px 16px;
      border-radius: 8px;
      text-decoration: none;
      transition: background 0.15s ease;
      white-space: nowrap;
    }
    .tgo-list-cta:hover { background: var(--tgo-accent-hover); }
    @media (prefers-reduced-motion: reduce) {
      .tgo-list-cta { transition: none; }
    }
    @media (max-width: 768px) {
      .tgo-list-row {
        grid-template-columns: 1fr;
      }
      .tgo-list-img {
        min-height: 180px;
      }
      .tgo-list-body {
        padding: 16px;
      }
      .tgo-list-price {
        padding: 14px 16px;
        border-left: 0;
        border-top: 1px solid var(--tgo-border);
        align-items: stretch;
        flex-direction: row;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 8px;
      }
      .tgo-list-cta {
        margin-top: 0;
        margin-left: auto;
        justify-content: center;
      }
    }

    /* ═══════════════════════════════════════════════════════════════════
       MAGAZINE TEMPLATE — editorial mosaic
       Hero on top, then editorial divider, then full-width banner card,
       then a 3-up mosaic where the centre cell can be a navy pull-quote
       card instead of a tile. Then optional further rows of standard tiles.
       Reuses .tgo-card for standard tiles so they look identical to grid mode.
       ═══════════════════════════════════════════════════════════════════ */
    .tgo-mag {
      display: grid;
      grid-template-columns: 1fr;
      gap: 24px;
    }

    /* Editorial divider — small typographic moment between sections */
    .tgo-mag-divider {
      display: flex;
      align-items: center;
      gap: 16px;
      margin: 8px 0 -4px;
    }
    .tgo-mag-divider::before,
    .tgo-mag-divider::after {
      content: '';
      flex: 1;
      height: 1px;
      background: var(--tgo-border);
    }
    .tgo-mag-divider-label {
      font-family: var(--tgo-font-mono, 'JetBrains Mono', 'IBM Plex Mono', ui-monospace, monospace);
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--tgo-muted);
      white-space: nowrap;
    }
    .tgo-mag-divider-label strong {
      color: var(--tgo-text);
      font-weight: 600;
    }

    /* Full-width banner card — second-billing offer below the hero */
    .tgo-mag-banner {
      display: grid;
      grid-template-columns: 1.2fr 1fr;
      background: var(--tgo-card);
      border: 1px solid var(--tgo-border);
      border-radius: var(--tgo-radius);
      overflow: hidden;
      min-height: 220px;
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
      text-decoration: none;
      color: inherit;
    }
    .tgo-mag-banner:hover {
      border-color: var(--tgo-accent);
      box-shadow: var(--tgo-shadow-hover);
    }
    .tgo-mag-banner-img {
      background: var(--tgo-card-alt) center/cover no-repeat;
      position: relative;
      min-height: 180px;
    }
    .tgo-mag-banner-overlay {
      position: absolute;
      top: 16px;
      left: 16px;
      background: var(--tgo-accent);
      color: #fff;
      font-family: var(--tgo-font-mono, 'JetBrains Mono', ui-monospace, monospace);
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      padding: 4px 10px;
      border-radius: 999px;
    }
    .tgo-mag-banner-body {
      padding: 28px 32px;
      display: flex;
      flex-direction: column;
      justify-content: center;
    }
    .tgo-mag-banner-kicker {
      font-family: var(--tgo-font-mono, 'JetBrains Mono', ui-monospace, monospace);
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--tgo-muted);
      margin-bottom: 8px;
    }
    .tgo-mag-banner-body h3 {
      font-size: 22px;
      font-weight: 700;
      letter-spacing: -0.015em;
      margin: 0 0 10px;
      line-height: 1.2;
      color: var(--tgo-text);
    }
    .tgo-mag-banner-body p {
      font-size: 13px;
      color: var(--tgo-sub);
      margin: 0 0 16px;
      line-height: 1.55;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .tgo-mag-banner-foot {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
    }
    .tgo-mag-banner-foot .price {
      font-size: 26px;
      font-weight: 800;
      letter-spacing: -0.02em;
      color: var(--tgo-text);
    }
    .tgo-mag-banner-foot .price small {
      font-size: 11px;
      font-weight: 500;
      color: var(--tgo-muted);
      margin-left: 4px;
    }
    .tgo-mag-banner-foot .cta {
      background: var(--tgo-brand);
      color: #fff;
      font-size: 13px;
      font-weight: 600;
      padding: 10px 16px;
      border-radius: 8px;
      text-decoration: none;
      transition: background 0.15s ease;
    }
    .tgo-mag-banner-foot .cta:hover {
      background: var(--tgo-brand-hover, var(--tgo-accent-hover));
    }

    /* Mosaic 3-up grid — standard tiles + an optional pull-quote card in the centre */
    .tgo-mag-mosaic {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 16px;
    }

    /* Pull-quote card — sits in the centre cell of the mosaic.
       Navy background, oversized italic quote, no image. */
    .tgo-mag-quote {
      background: var(--tgo-brand);
      color: #fff;
      padding: 28px;
      border-radius: var(--tgo-radius);
      display: flex;
      flex-direction: column;
      justify-content: center;
      position: relative;
      overflow: hidden;
      text-decoration: none;
      transition: transform 0.15s ease, box-shadow 0.15s ease;
    }
    .tgo-mag-quote:hover {
      transform: translateY(-2px);
      box-shadow: var(--tgo-shadow-hover);
    }
    .tgo-mag-quote::before {
      content: '"';
      position: absolute;
      top: -20px;
      left: 16px;
      font-family: 'Georgia', 'Times New Roman', serif;
      font-style: italic;
      font-size: 140px;
      color: rgba(255, 255, 255, 0.08);
      line-height: 1;
      font-weight: 600;
      pointer-events: none;
    }
    .tgo-mag-quote-kicker {
      font-family: var(--tgo-font-mono, 'JetBrains Mono', ui-monospace, monospace);
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--tgo-accent-light, #48CAE4);
      margin-bottom: 12px;
      position: relative;
    }
    .tgo-mag-quote blockquote {
      font-family: 'Georgia', 'Times New Roman', serif;
      font-style: italic;
      font-size: 18px;
      line-height: 1.4;
      margin: 0 0 16px;
      font-weight: 500;
      color: #fff;
      position: relative;
      display: -webkit-box;
      -webkit-line-clamp: 5;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .tgo-mag-quote-foot {
      margin-top: auto;
      padding-top: 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-top: 1px solid rgba(255, 255, 255, 0.15);
      gap: 8px;
    }
    .tgo-mag-quote-foot .price {
      font-size: 18px;
      font-weight: 700;
      color: #fff;
    }
    .tgo-mag-quote-foot .price small {
      font-size: 10px;
      font-weight: 500;
      opacity: 0.7;
      margin-left: 4px;
    }
    .tgo-mag-quote-foot .cta {
      font-size: 12px;
      font-weight: 600;
      color: var(--tgo-accent-light, #48CAE4);
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      white-space: nowrap;
    }

    /* Responsive: collapse mosaic and banner gracefully */
    @media (max-width: 900px) {
      .tgo-mag-mosaic { grid-template-columns: repeat(2, 1fr); }
      .tgo-mag-banner { grid-template-columns: 1fr; min-height: 0; }
      .tgo-mag-banner-img { min-height: 200px; }
      .tgo-mag-banner-body { padding: 20px 24px; }
      .tgo-mag-banner-body h3 { font-size: 18px; }
    }
    @media (max-width: 600px) {
      .tgo-mag-mosaic { grid-template-columns: 1fr; }
    }

    /* Hero (unchanged from previous version — kept inline for completeness) */
    .tgo-mag-hero {
      position: relative;
      border-radius: var(--tgo-radius);
      overflow: hidden;
      aspect-ratio: 21 / 9;
      background: var(--tgo-card-alt) center/cover no-repeat;
      box-shadow: var(--tgo-shadow);
      transition: box-shadow 0.15s ease;
    }
    .tgo-mag-hero:hover { box-shadow: var(--tgo-shadow-hover); }
    .tgo-mag-hero::after {
      content: '';
      position: absolute;
      inset: 0;
      background: linear-gradient(180deg, transparent 30%, rgba(15, 23, 42, 0.85) 100%);
      pointer-events: none;
    }
    .tgo-mag-hero-badge {
      position: absolute;
      top: 24px;
      left: 24px;
      z-index: 2;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: rgba(255, 255, 255, 0.95);
      color: var(--tgo-text);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      padding: 6px 12px;
      border-radius: 999px;
      backdrop-filter: blur(8px);
    }
    .tgo-mag-hero-badge::before {
      content: '';
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--tgo-accent);
    }
    .tgo-mag-hero-content {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      z-index: 2;
      padding: 32px;
      color: #fff;
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 24px;
      align-items: end;
    }
    .tgo-mag-hero-kicker {
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: rgba(255, 255, 255, 0.7);
      margin-bottom: 8px;
    }
    .tgo-mag-hero-title {
      font-size: 30px;
      font-weight: 800;
      letter-spacing: -0.025em;
      margin: 0 0 12px;
      line-height: 1.1;
      color: #fff;
      max-width: 600px;
    }
    .tgo-mag-hero-summary {
      font-size: 14px;
      line-height: 1.55;
      color: rgba(255, 255, 255, 0.85);
      max-width: 540px;
      margin: 0;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .tgo-mag-hero-price {
      text-align: right;
      color: #fff;
      display: flex;
      flex-direction: column;
      gap: 4px;
      align-items: flex-end;
    }
    .tgo-mag-hero-from {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: rgba(255, 255, 255, 0.7);
    }
    .tgo-mag-hero-was {
      font-size: 14px;
      color: rgba(255, 255, 255, 0.7);
      text-decoration: line-through;
    }
    .tgo-mag-hero-now {
      font-size: 38px;
      font-weight: 800;
      letter-spacing: -0.03em;
      line-height: 1;
      color: #fff;
    }
    .tgo-mag-hero-sub {
      font-size: 11px;
      color: rgba(255, 255, 255, 0.7);
      margin-bottom: 12px;
    }
    .tgo-mag-hero-cta {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: var(--tgo-accent);
      color: white;
      font-size: 14px;
      font-weight: 700;
      padding: 12px 20px;
      border-radius: 10px;
      text-decoration: none;
      transition: background 0.15s ease;
      margin-top: 4px;
    }
    .tgo-mag-hero-cta:hover { background: var(--tgo-accent-hover); }
    @media (max-width: 768px) {
      .tgo-mag-hero { aspect-ratio: 4 / 5; }
      .tgo-mag-hero-content {
        grid-template-columns: 1fr;
        padding: 20px;
      }
      .tgo-mag-hero-title { font-size: 22px; }
      .tgo-mag-hero-price { text-align: left; align-items: flex-start; }
      .tgo-mag-hero-now { font-size: 28px; }
    }

    /* ═══════════════════════════════════════════════════════════════════
       BOARDING-PASS TEMPLATE (FLIGHTS ONLY)
       Paper boarding-pass shape with perforated stub and CSS barcode.
       Uses tgbp- prefix to avoid colliding with other templates.
       ═══════════════════════════════════════════════════════════════════ */
    .tgbp-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 20px;
    }
    .tgbp-grid[data-cols="1"] { grid-template-columns: 1fr; }
    @media (max-width: 900px) {
      .tgbp-grid, .tgbp-grid[data-cols="2"] { grid-template-columns: 1fr; }
    }

    .tgbp {
      display: grid;
      grid-template-columns: 1fr 110px;
      background: var(--tgo-card);
      border-radius: var(--tgo-radius);
      box-shadow: var(--tgo-shadow);
      overflow: hidden;
      position: relative;
      transition: transform 0.2s ease, box-shadow 0.2s ease;
      border: 1px solid var(--tgo-border);
    }
    .tgbp:hover {
      transform: translateY(-2px);
      box-shadow: var(--tgo-shadow-hover);
    }
    @media (prefers-reduced-motion: reduce) {
      .tgbp { transition: none; }
      .tgbp:hover { transform: none; }
    }

    /* Perforation between main and stub — pure CSS, no images */
    .tgbp::before {
      content: '';
      position: absolute;
      top: 0;
      bottom: 0;
      right: 110px;
      width: 1px;
      background-image: linear-gradient(to bottom, var(--tgo-border) 50%, transparent 50%);
      background-size: 1px 8px;
      z-index: 2;
    }
    .tgbp::after {
      content: '';
      position: absolute;
      top: -8px;
      bottom: -8px;
      right: 102px;
      width: 16px;
      background-image:
        radial-gradient(circle at 8px 8px, var(--tgo-bg, transparent) 7px, transparent 8px),
        radial-gradient(circle at 8px calc(100% - 8px), var(--tgo-bg, transparent) 7px, transparent 8px);
      background-repeat: no-repeat;
      z-index: 1;
      pointer-events: none;
    }
    /* When the host doesn't set --tgo-bg (transparent default), the perforation
       half-circles need a real colour or they'll look like grey blobs against
       a coloured page background. Use the body-equivalent surface colour. */
    .tgo-root[data-theme="light"] .tgbp::after {
      background-image:
        radial-gradient(circle at 8px 8px, #F7F9FB 7px, transparent 8px),
        radial-gradient(circle at 8px calc(100% - 8px), #F7F9FB 7px, transparent 8px);
    }
    .tgo-root[data-theme="dark"] .tgbp::after {
      background-image:
        radial-gradient(circle at 8px 8px, #0B1220 7px, transparent 8px),
        radial-gradient(circle at 8px calc(100% - 8px), #0B1220 7px, transparent 8px);
    }

    .tgbp-main {
      padding: 18px 22px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .tgbp-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--tgo-border);
    }
    .tgbp-airline {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
    }
    .tgbp-mark {
      width: 34px;
      height: 34px;
      border-radius: 6px;
      background: var(--tgo-brand);
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: 'JetBrains Mono', 'IBM Plex Mono', ui-monospace, 'SF Mono', monospace;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.05em;
      flex-shrink: 0;
    }
    .tgbp-airline-text {
      min-width: 0;
    }
    .tgbp-airline-name {
      font-size: 13px;
      font-weight: 700;
      color: var(--tgo-text);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .tgbp-airline-sub {
      font-family: 'JetBrains Mono', 'IBM Plex Mono', ui-monospace, monospace;
      font-size: 11px;
      color: var(--tgo-muted);
      letter-spacing: 0.04em;
    }
    .tgbp-class {
      font-family: 'JetBrains Mono', 'IBM Plex Mono', ui-monospace, monospace;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--tgo-muted);
      padding: 4px 8px;
      border: 1px solid var(--tgo-border);
      border-radius: 4px;
      flex-shrink: 0;
    }

    .tgbp-route {
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      gap: 16px;
      align-items: center;
    }
    .tgbp-route-end { min-width: 0; }
    .tgbp-route-end.right { text-align: right; }
    .tgbp-iata {
      font-family: 'JetBrains Mono', 'IBM Plex Mono', ui-monospace, monospace;
      font-size: 30px;
      font-weight: 700;
      letter-spacing: 0.05em;
      color: var(--tgo-text);
      line-height: 1;
      margin-bottom: 4px;
    }
    .tgbp-airport-name {
      font-size: 11px;
      color: var(--tgo-muted);
      text-transform: uppercase;
      letter-spacing: 0.06em;
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .tgbp-plane {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      color: var(--tgo-accent);
    }
    .tgbp-plane-icon {
      transform: rotate(90deg);
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .tgbp-plane-line {
      width: 56px;
      height: 1px;
      background: linear-gradient(to right, transparent, var(--tgo-accent), transparent);
    }

    .tgbp-detail-row {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 10px;
    }
    .tgbp-detail {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }
    .tgbp-detail-label {
      font-family: 'JetBrains Mono', 'IBM Plex Mono', ui-monospace, monospace;
      font-size: 9px;
      font-weight: 600;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--tgo-muted);
    }
    .tgbp-detail-value {
      font-family: 'JetBrains Mono', 'IBM Plex Mono', ui-monospace, monospace;
      font-size: 13px;
      font-weight: 700;
      color: var(--tgo-text);
      letter-spacing: 0.02em;
    }

    /* Stub */
    .tgbp-stub {
      background: var(--tgo-card-alt);
      padding: 18px 14px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
      text-align: center;
    }
    .tgbp-stub-top {
      display: flex;
      flex-direction: column;
      gap: 2px;
      align-items: center;
    }
    .tgbp-stub-label {
      font-family: 'JetBrains Mono', 'IBM Plex Mono', ui-monospace, monospace;
      font-size: 9px;
      font-weight: 600;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--tgo-muted);
    }
    .tgbp-stub-was {
      font-family: 'JetBrains Mono', 'IBM Plex Mono', ui-monospace, monospace;
      font-size: 11px;
      color: var(--tgo-strike);
      text-decoration: line-through;
    }
    .tgbp-stub-price {
      font-family: 'JetBrains Mono', 'IBM Plex Mono', ui-monospace, monospace;
      font-size: 20px;
      font-weight: 800;
      letter-spacing: -0.01em;
      color: var(--tgo-text);
      line-height: 1;
    }
    .tgbp-barcode {
      display: flex;
      flex-direction: column;
      gap: 5px;
      align-items: center;
      width: 100%;
    }
    .tgbp-barcode-bars {
      width: 100%;
      height: 32px;
      background-image: repeating-linear-gradient(
        90deg,
        var(--tgo-text) 0,
        var(--tgo-text) 1px,
        transparent 1px,
        transparent 3px,
        var(--tgo-text) 3px,
        var(--tgo-text) 5px,
        transparent 5px,
        transparent 6px,
        var(--tgo-text) 6px,
        var(--tgo-text) 9px,
        transparent 9px,
        transparent 11px
      );
      opacity: 0.85;
    }
    .tgbp-barcode-num {
      font-family: 'JetBrains Mono', 'IBM Plex Mono', ui-monospace, monospace;
      font-size: 8px;
      font-weight: 500;
      color: var(--tgo-muted);
      letter-spacing: 0.06em;
    }
    .tgbp-cta {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      background: var(--tgo-accent);
      color: white;
      font-size: 12px;
      font-weight: 700;
      padding: 9px 12px;
      border-radius: 6px;
      text-decoration: none;
      width: 100%;
      transition: background 0.15s ease;
    }
    .tgbp-cta:hover { background: var(--tgo-accent-hover); }
    @media (prefers-reduced-motion: reduce) {
      .tgbp-cta { transition: none; }
    }

    @media (max-width: 600px) {
      .tgbp {
        grid-template-columns: 1fr;
      }
      .tgbp::before, .tgbp::after { display: none; }
      .tgbp-stub {
        flex-direction: row;
        justify-content: space-between;
        flex-wrap: wrap;
        border-top: 1px dashed var(--tgo-border);
        padding: 14px 18px;
      }
      .tgbp-stub-top { flex-direction: row; gap: 10px; align-items: center; }
      .tgbp-barcode { width: auto; flex: 1 1 100%; }
      .tgbp-barcode-bars { width: 100%; height: 24px; }
      .tgbp-cta { width: auto; flex: 1; }
      .tgbp-iata { font-size: 24px; }
    }
  `;

  // ── Solari split-flap mechanism ───────────────────────────────────
  //
  // Per-cell character scrambler. Each instance owns the DOM for one
  // animatable cell on the departure board and knows how to flip from
  // its current glyph to a new target glyph using the Grafana-style
  // shortest-path scramble: characters rotate forward through their
  // glyph set (numbers through 0–9, letters through A–Z) one flap at a
  // time at 80ms per flap, until they land on the target.
  //
  // The scheduler that orchestrates row/column cascade lives on the
  // widget class as _runBoardFlipAnimation. SolariFlap itself only
  // knows how to animate one cell.

  // Glyph paths — what each character cell can flip through, in order.
  // Real Solari boards always rotate forward (the drum can only turn one
  // direction), so we always go forward through the path until we hit
  // the target — but we wrap from the end back to the start.
  const SF_DIGITS = '0123456789'.split('');
  const SF_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  // Mixed alphanumeric for fare strings like £1,289 — preserve the
  // currency symbol and comma, only flip the digits.
  // We treat "non-flippable" chars (£, comma, space, colon) as static.
  function sfPathFor(ch) {
    if (/[0-9]/.test(ch)) return SF_DIGITS;
    if (/[A-Z]/.test(ch)) return SF_LETTERS;
    return null;  // Static — no flipping
  }

  // Click sound — created lazily on first play because AudioContext
  // construction can throw on iOS Safari before user interaction.
  let _sfAudioCtx = null;
  function sfClick() {
    try {
      if (!_sfAudioCtx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        _sfAudioCtx = new Ctx();
      }
      const ctx = _sfAudioCtx;
      // Short percussive click — square-wave burst into a tight envelope.
      // Frequency picked to evoke a flap landing on a hinge stop.
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = 1800 + Math.random() * 200;  // tiny pitch variation per click
      gain.gain.setValueAtTime(0.06, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.04);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.05);
    } catch { /* sound is opt-in, never let it break the board */ }
  }

  class SolariFlap {
    // Build the DOM for one animatable cell. `initial` is the starting
    // glyph (single character), or empty string for "blank, ready to
    // flip in". Returns a root element to be inserted into the row HTML.
    constructor(initial) {
      this.current = initial || ' ';
      this.target = this.current;
      this.timer = null;
      this.soundEnabled = false;

      this.root = document.createElement('span');
      this.root.className = 'tdb-sf';

      this.topHalf = document.createElement('span');
      this.topHalf.className = 'tdb-sf-half tdb-sf-top';
      this.topInner = document.createElement('span');
      this.topInner.className = 'tdb-sf-half-inner';
      this.topInner.textContent = this.current;
      this.topHalf.appendChild(this.topInner);

      this.bottomHalf = document.createElement('span');
      this.bottomHalf.className = 'tdb-sf-half tdb-sf-bottom';
      this.bottomInner = document.createElement('span');
      this.bottomInner.className = 'tdb-sf-half-inner';
      this.bottomInner.textContent = this.current;
      this.bottomHalf.appendChild(this.bottomInner);

      // The falling flap — sits on top, animates rotateX, shows the OLD
      // top-half glyph during the fall.
      this.flap = document.createElement('span');
      this.flap.className = 'tdb-sf-flap';
      this.flapInner = document.createElement('span');
      this.flapInner.className = 'tdb-sf-half-inner';
      this.flapInner.textContent = this.current;
      this.flap.appendChild(this.flapInner);

      this.root.appendChild(this.bottomHalf);
      this.root.appendChild(this.flap);
      this.root.appendChild(this.topHalf);
    }

    // Reset to a known glyph without animation (used when the row data
    // changes type — e.g. switching airports — so we don't try to scramble
    // through 26 letters from a cached state).
    setInstant(ch) {
      this.current = ch || ' ';
      this.target = this.current;
      this.topInner.textContent = this.current;
      this.bottomInner.textContent = this.current;
      this.flapInner.textContent = this.current;
      this.flap.classList.remove('is-falling');
    }

    // Schedule the next flap. Calls `onSettle` once the cell reaches its
    // target glyph. `delay` is the delay before the FIRST flap starts.
    scrambleTo(target, delay, onSettle) {
      target = (target || ' ').toUpperCase();
      this.target = target;
      // Static (non-flippable) glyph — just swap instantly after delay
      const path = sfPathFor(this.current === ' ' ? target : this.current) || sfPathFor(target);
      if (!path) {
        this.timer = setTimeout(() => {
          this.setInstant(target);
          if (onSettle) onSettle();
        }, delay);
        return;
      }
      // If already at target, settle immediately
      if (this.current === target) {
        if (onSettle) onSettle();
        return;
      }
      this.timer = setTimeout(() => this._flipOne(path, onSettle), delay);
    }

    // Animate one flap from current → next-glyph-in-path. When the flap
    // finishes falling, we either keep going (if we haven't hit target)
    // or call onSettle.
    _flipOne(path, onSettle) {
      const FLAP_MS = 80;

      // Find next glyph in the path
      const idx = path.indexOf(this.current);
      const nextIdx = (idx === -1) ? 0 : (idx + 1) % path.length;
      const nextGlyph = path[nextIdx];

      // The OLD glyph stays on the flap front face and on the bottom half
      // until the flap covers it. The NEW glyph is already on the top half
      // (revealed immediately as the flap starts falling).
      this.topInner.textContent = nextGlyph;
      this.flapInner.textContent = this.current;
      // Bottom half stays on OLD glyph; the falling flap covers it visually
      // until rotateX > 90deg, at which point we swap.

      // Force a reflow so the animation restart actually fires
      // (without this, removing+adding the class in the same frame is a no-op)
      this.flap.classList.remove('is-falling');
      void this.flap.offsetHeight;
      this.flap.classList.add('is-falling');

      // Halfway through the fall (40ms), swap the bottom half to the new
      // glyph so when the flap finishes falling and disappears, the bottom
      // half already shows the new value.
      const halfwaySwap = setTimeout(() => {
        this.bottomInner.textContent = nextGlyph;
      }, FLAP_MS / 2);

      // After the full flap duration, reset the flap and either continue
      // scrambling or settle.
      this.timer = setTimeout(() => {
        clearTimeout(halfwaySwap);
        this.flap.classList.remove('is-falling');
        this.flapInner.textContent = nextGlyph;
        this.current = nextGlyph;

        if (this.soundEnabled) sfClick();

        if (this.current === this.target) {
          if (onSettle) onSettle();
        } else {
          this._flipOne(path, onSettle);
        }
      }, FLAP_MS);
    }

    cancel() {
      if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    }
  }

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

        // Template — picks the visual layout. 'cards' is the existing
        // grid/carousel render. 'departure-board' is the airport-style table.
        // Default 'cards' preserves existing widget behaviour exactly.
        template: c.template || 'cards',

        // Carousel-specific (used when template='cards' and layout='carousel')
        carouselAutoplay: !!c.carouselAutoplay,
        carouselInterval: typeof c.carouselInterval === 'number' ? c.carouselInterval : 6,

        // Departure-board-specific (used when template='departure-board')
        // Each template gets its own namespace so switching templates doesn't
        // collapse state. The widget reads these only when the matching
        // template is active.
        boardTheme: c.boardTheme || 'dark',
        boardDefaultAirport: (c.boardDefaultAirport || 'LHR').toUpperCase(),
        boardAutoDetect: c.boardAutoDetect !== false,
        boardAllowSwitcher: c.boardAllowSwitcher !== false,
        boardAnimate: c.boardAnimate !== false,
        boardSound: c.boardSound === true,  // Web Audio click on each flap. Default OFF (intrusive on host sites).
        boardAutoRefresh: c.boardAutoRefresh !== false,
        boardRefreshSeconds: typeof c.boardRefreshSeconds === 'number' ? c.boardRefreshSeconds : 300,
        boardDateRange: typeof c.boardDateRange === 'number' ? c.boardDateRange : 30,

        // List-layout options (used when template='cards' AND layout='list')
        // Same data shape as grid/carousel cards, just rendered as horizontal
        // rows. Toggles let clients dial density without dropping back to grid.
        listShowMeta: c.listShowMeta !== false,
        listShowAmenities: c.listShowAmenities !== false,

        // Magazine template config (used only when template='magazine')
        // Mosaic layout: hero → banner → 3-up with quote → more tiles
        magazineHeroStrategy: c.magazineHeroStrategy || 'discount',
        magazineShowQuote: c.magazineShowQuote !== false,       // pull-quote card in mosaic centre
        magazineShowDividers: c.magazineShowDividers !== false, // editorial divider strips between sections
        // Boarding-pass template config (used only when template='boarding-pass')
        boardingPassColumns: typeof c.boardingPassColumns === 'number' ? c.boardingPassColumns : 2,
        boardingPassShowBarcode: c.boardingPassShowBarcode !== false,

        // Departure-board status pill toggles. Cheapest, Today, This week
        // are always-on (foundational signals). Tomorrow, Going soon, and
        // Premium cabin are opt-in but default ON. Going-soon threshold is
        // configurable so different brand tones (luxury vs budget) can
        // tune what "going soon" means for their audience.
        boardShowTomorrow: c.boardShowTomorrow !== false,
        boardShowGoingSoon: c.boardShowGoingSoon !== false,
        boardGoingSoonDays: typeof c.boardGoingSoonDays === 'number' ? c.boardGoingSoonDays : 14,
        boardShowPremiumCabin: c.boardShowPremiumCabin !== false,

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

      // The departure-board AND boarding-pass templates are flight-only by
      // definition. Override whatever offer-type the user picked — the
      // template implies the data.
      if (this.cfg.template === 'departure-board' || this.cfg.template === 'boarding-pass') {
        apiType = 'Flights';
        packageType = null;
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

      // Departure-board template: filter to the chosen origin airport,
      // widen date window per cfg.boardDateRange, and tighten maxOffers
      // to fit the visible row cap (the template sets its own cap).
      if (this.cfg.template === 'departure-board' && this._boardAirport) {
        p.origin = this._boardAirport.code;
        p.DatesMin = 1;
        p.DatesMax = this.cfg.boardDateRange || 30;
        // Sort by price ascending — board shows cheapest first
        p.sort = 'price:asc';
      }

      return p;
    }

    async _fetchAndRender() {
      if (!this.cfg.appId || !this.cfg.apiKey) {
        this._showError('Missing Travelify credentials. Configure in the editor.');
        return;
      }

      // Departure-board template runs its own fetch flow because the request
      // depends on the detected/picked airport. Hand off here.
      if (this.cfg.template === 'departure-board') {
        this._renderDepartureBoard();
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
      // Departure-board template doesn't dedupe (it's a fares list, not a
      // shop-around grid), so pass raw offers straight in.
      if (this.cfg.template === 'departure-board') {
        this._renderDepartureBoard();
        return;
      }
      // Magazine + boarding-pass + cards all dedupe per the user's strategy
      // before rendering — same data path, different visual templates.
      if (this.cfg.template === 'magazine') {
        this._renderMagazineTemplate();
        return;
      }
      if (this.cfg.template === 'boarding-pass') {
        this._renderBoardingPassTemplate();
        return;
      }
      this._renderCardsTemplate();
    }

    _renderCardsTemplate() {
      const deduped = dedupeOffers(this.rawOffers, this.cfg.dedupeStrategy, this.cfg.sort);

      if (!deduped.length) {
        this._showEmpty();
        return;
      }

      const isCarousel = this.cfg.layout === 'carousel';
      const isList = this.cfg.layout === 'list';

      let html;
      if (isCarousel) {
        html = this._renderCarousel(deduped);
      } else if (isList) {
        html = this._renderListLayout(deduped);
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

    /* ═══════════════════════════════════════════════════════════════════
       LIST LAYOUT (within the Cards template)
       Compact horizontal rows: image left, content middle, price right.
       Reuses the same offer data shape as grid/carousel — no separate
       data path. Each renderer below knows how to lay itself out as a row
       given the offer's type. Falls back to stacked layout below 768px.
       ═══════════════════════════════════════════════════════════════════ */
    _renderListLayout(offers) {
      let html = '<div class="tgo-list">';
      for (const o of offers) html += this._renderListRow(o);
      html += '</div>';
      return html;
    }

    _renderListRow(o) {
      switch (o.type) {
        case 'Accommodation': return this._renderListAccommodation(o);
        case 'Flights':
        case 'Flight': return this._renderListFlight(o);
        case 'Packages':
        case 'Package': return this._renderListPackage(o);
        default: return this._renderListUnknown(o);
      }
    }

    // List-row equivalent of _renderAccommodation. Content is a slimmed-down
    // version: image + name + meta row (location, stars, nights, board) +
    // optional amenities tags. Price column on the right.
    _renderListAccommodation(o) {
      const acc = o.accommodation || {};
      const dest = acc.destination || {};
      const pricing = acc.pricing || {};
      const img = safeImgUrl((acc.image && acc.image.url) || '');
      const amenities = Array.isArray(acc.amenities) ? acc.amenities : [];
      const isLeadIn = pricing.isLeadIn === true;
      const wasPrice = (pricing.priceChanged && pricing.priceBeforeChange) ? '£' + Math.round(pricing.priceBeforeChange) : null;

      let html = '<article class="tgo-list-row">';
      html += '<div class="tgo-list-img" ' + cssBgUrl(img) + '>';
      if (this.cfg.show.leadInPill && isLeadIn) {
        html += '<span class="tgo-list-img-badge lead-in">Lead-in price</span>';
      }
      html += '</div>';

      html += '<div class="tgo-list-body">';
      html += '<div>';
      html += '<h3 class="tgo-list-title">' + esc(acc.name || 'Hotel') + '</h3>';

      if (this.cfg.listShowMeta) {
        html += '<div class="tgo-list-meta">';
        if (acc.rating) {
          let stars = '';
          const n = Math.round(acc.rating);
          for (let i = 0; i < n; i++) stars += icon('star', 12);
          html += '<span class="tgo-list-stars">' + stars + '</span>';
        }
        if (this.cfg.show.location) {
          html += '<span>' + icon('mapPin', 12)
            + esc(dest.name || '') + (dest.countryCode ? ', ' + esc(dest.countryCode) : '')
            + '</span>';
        }
        if (acc.nights) {
          html += '<span>' + icon('moon', 12) + acc.nights + ' night' + (acc.nights === 1 ? '' : 's') + '</span>';
        }
        if (acc.boardBasis) {
          html += '<span>' + icon('utensils', 12) + esc(formatEnum(acc.boardBasis)) + '</span>';
        }
        html += '</div>';
      }
      html += '</div>';

      if (this.cfg.listShowAmenities && this.cfg.show.amenities && amenities.length) {
        const visible = amenities.slice(0, 4);
        const extras = amenities.length - visible.length;
        html += '<div class="tgo-list-tags">';
        for (const a of visible) html += '<span class="tgo-list-tag">' + esc(formatEnum(a)) + '</span>';
        if (extras > 0) html += '<span class="tgo-list-tag">+' + extras + '</span>';
        html += '</div>';
      }
      html += '</div>'; // /tgo-list-body

      html += this._renderListPrice(o, wasPrice);
      html += '</article>';
      return html;
    }

    _renderListFlight(o) {
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
      const isLeadIn = pricing.isLeadIn === true;
      const wasPrice = (pricing.priceChanged && pricing.priceBeforeChange) ? '£' + Math.round(pricing.priceBeforeChange) : null;

      let html = '<article class="tgo-list-row">';
      html += '<div class="tgo-list-img" ' + cssBgUrl(img) + '>';
      if (this.cfg.show.leadInPill && isLeadIn) {
        html += '<span class="tgo-list-img-badge lead-in">Lead-in price</span>';
      } else if (isDirect) {
        html += '<span class="tgo-list-img-badge">Direct</span>';
      }
      html += '</div>';

      html += '<div class="tgo-list-body">';
      html += '<div>';
      html += '<h3 class="tgo-list-title">'
        + esc((og.iataCode || '???') + ' → ' + (dest.iataCode || '???'))
        + (carrier.name ? ' · ' + esc(carrier.name) : '')
        + '</h3>';

      if (this.cfg.listShowMeta) {
        html += '<div class="tgo-list-meta">';
        html += '<span>' + icon('plane', 12) + esc(stopsLabel) + '</span>';
        if (this.cfg.show.flightDuration && f.duration) {
          html += '<span>' + icon('clock', 12) + esc(formatDuration(f.duration)) + '</span>';
        }
        if (this.cfg.show.flightSchedule && f.outboundDate) {
          html += '<span>' + icon('calendar', 12) + esc(formatDateTime(f.outboundDate)) + '</span>';
        }
        if (tripType) {
          html += '<span>' + esc(tripType) + '</span>';
        }
        if (this.cfg.show.cabinClass && f.cabinClass) {
          html += '<span>' + esc(formatEnum(f.cabinClass)) + '</span>';
        }
        html += '</div>';
      }
      html += '</div>';
      html += '</div>'; // /tgo-list-body

      html += this._renderListPrice(o, wasPrice);
      html += '</article>';
      return html;
    }

    _renderListPackage(o) {
      const acc = o.accommodation || {};
      const f = o.flight || {};
      const dest = acc.destination || f.destination || {};
      const accPricing = acc.pricing || {};
      const flightPricing = f.pricing || {};
      const img = safeImgUrl((acc.image && acc.image.url) || (f.image && f.image.url) || '');
      const fromCode = (f.origin && f.origin.iataCode) || '';
      const toCode = (f.destination && f.destination.iataCode) || '';
      const operator = acc.operator || null;
      const operatorName = operator ? operator.name : '';
      const atol = isAtolMessage(operator ? operator.message : '');
      const pkgType = getPackageType(o);
      const isHoliday = pkgType === 'PackageHolidays';
      const isLeadIn = (accPricing.isLeadIn === true) || (flightPricing.isLeadIn === true);
      const wasPrice = (flightPricing.priceChanged && flightPricing.priceBeforeChange)
        ? '£' + Math.round(flightPricing.priceBeforeChange) : null;

      let html = '<article class="tgo-list-row">';
      html += '<div class="tgo-list-img" ' + cssBgUrl(img) + '>';
      if (operatorName && this.cfg.show.packageOperator) {
        html += '<span class="tgo-list-img-badge">' + esc(operatorName) + '</span>';
      } else if (this.cfg.show.leadInPill && isLeadIn) {
        html += '<span class="tgo-list-img-badge lead-in">Lead-in price</span>';
      }
      html += '</div>';

      html += '<div class="tgo-list-body">';
      html += '<div>';
      html += '<h3 class="tgo-list-title">' + esc(acc.name || 'Package holiday') + '</h3>';

      if (this.cfg.listShowMeta) {
        html += '<div class="tgo-list-meta">';
        if (acc.rating) {
          let stars = '';
          const n = Math.round(acc.rating);
          for (let i = 0; i < n; i++) stars += icon('star', 12);
          html += '<span class="tgo-list-stars">' + stars + '</span>';
        }
        if (this.cfg.show.location) {
          html += '<span>' + icon('mapPin', 12)
            + esc(dest.name || '') + (dest.countryCode ? ', ' + esc(dest.countryCode) : '')
            + '</span>';
        }
        if (fromCode && toCode) {
          html += '<span>' + icon('plane', 12) + esc(fromCode + ' → ' + toCode) + '</span>';
        }
        if (acc.nights) {
          html += '<span>' + icon('moon', 12) + acc.nights + ' nt' + '</span>';
        }
        if (acc.boardBasis) {
          html += '<span>' + icon('utensils', 12) + esc(formatEnum(acc.boardBasis)) + '</span>';
        }
        html += '</div>';
      }
      html += '</div>';

      if (this.cfg.listShowAmenities) {
        const tags = [];
        if (atol && isHoliday) tags.push('ATOL');
        if (isHoliday) tags.push('Package');
        else tags.push('Flight + Hotel');
        if (tags.length) {
          html += '<div class="tgo-list-tags">';
          for (const t of tags) html += '<span class="tgo-list-tag">' + esc(t) + '</span>';
          html += '</div>';
        }
      }
      html += '</div>'; // /tgo-list-body

      html += this._renderListPrice(o, wasPrice);
      html += '</article>';
      return html;
    }

    _renderListUnknown(o) {
      let html = '<article class="tgo-list-row">';
      html += '<div class="tgo-list-img"></div>';
      html += '<div class="tgo-list-body"><div>';
      html += '<h3 class="tgo-list-title">Offer</h3>';
      html += '<div class="tgo-list-meta"><span>' + esc(o.type || 'Unknown type') + '</span></div>';
      html += '</div></div>';
      html += this._renderListPrice(o, null);
      html += '</article>';
      return html;
    }

    // Price column for the list layout. Same logic as _renderPriceFooter but
    // restyled for a vertical right-side column.
    _renderListPrice(o, wasPrice) {
      const display = computeDisplayPrice(o, this.cfg.priceDisplay || 'auto');
      const url = safeUrl(o.url || '#');
      const wasHtml = (this.cfg.show.wasPrice && wasPrice)
        ? '<span class="tgo-list-was">' + esc(wasPrice) + '</span>' : '';

      let basisHtml = '';
      if (this.cfg.show.paxBasis) {
        const label = paxBasisLabel(o);
        if (label) {
          const paxData = JSON.stringify({
            adults: o.adults || 0,
            children: o.children || 0,
            infants: o.infants || 0,
            url: o.url || '',
          });
          basisHtml = '<button type="button" class="tgo-pax-basis" data-tgo-pax="' + esc(paxData) + '" style="font-size:10px;padding-top:2px;">'
            + esc(label) + '</button>';
        }
      }

      return '<div class="tgo-list-price">'
        + wasHtml
        + '<span class="tgo-list-now">' + esc(display.primary) + '</span>'
        + (display.sub ? '<span class="tgo-list-sub">' + esc(display.sub) + '</span>' : '')
        + basisHtml
        + '<a class="tgo-list-cta" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">View deal</a>'
        + '</div>';
    }
    /* ═══════════════════════════════════════════════════════════════════
       END LIST LAYOUT
       ═══════════════════════════════════════════════════════════════════ */

    /* ═══════════════════════════════════════════════════════════════════
       MAGAZINE TEMPLATE — editorial mosaic
       Layout sequence (when enough offers):
         1. Hero               (full-width, 21:9, picked by magazineHeroStrategy)
         2. Editorial divider  (small caps "EIGHT MORE STAYS · UP TO 22% OFF")
         3. Banner             (full-width, second-billing offer)
         4. Mosaic 3-up        (tile + quote-card + tile)
         5. Mosaic 3-up        (tile + tile + tile, repeating until offers exhausted)
       Hero strategy:
         featured  — first offer with o.featured=true (falls back if none)
         discount  — biggest absolute discount (priceBeforeChange - price)
         cheapest  — lowest numeric price
         first     — whatever Travelify returned first
       Pull-quote source (3-tier fallback):
         o.editorialQuote        (curated field — wins if present)
         o.accommodation.summary (default — usually populated)
         null                    → cell falls back to a regular tile
       ═══════════════════════════════════════════════════════════════════ */
    _renderMagazineTemplate() {
      const deduped = dedupeOffers(this.rawOffers, this.cfg.dedupeStrategy, this.cfg.sort);

      if (!deduped.length) {
        this._showEmpty();
        return;
      }

      // Pick hero
      const heroIdx = this._pickMagazineHero(deduped);
      const hero = deduped[heroIdx];
      const remaining = deduped.slice(0, heroIdx).concat(deduped.slice(heroIdx + 1));

      // Pick banner — second-best offer (highest discount after hero, else cheapest)
      // Only shown if we have at least 2 offers total (i.e. at least 1 remaining)
      const bannerIdx = remaining.length ? this._pickMagazineBanner(remaining) : -1;
      const banner = bannerIdx >= 0 ? remaining[bannerIdx] : null;
      const mosaicOffers = bannerIdx >= 0
        ? remaining.slice(0, bannerIdx).concat(remaining.slice(bannerIdx + 1))
        : remaining;

      // Pick the offer for the pull-quote card (if enabled). Walks mosaicOffers
      // looking for the first one with a usable quote source. If found, that
      // offer is removed from mosaicOffers and slotted into position 1 of the
      // first mosaic row instead.
      let quoteOffer = null;
      let quoteIdx = -1;
      const showQuote = this.cfg.magazineShowQuote !== false;
      if (showQuote && mosaicOffers.length >= 3) {
        // Need at least 3 mosaic offers for a 3-up row; quote takes one of them.
        for (let i = 0; i < mosaicOffers.length; i++) {
          if (this._magQuoteText(mosaicOffers[i])) {
            quoteOffer = mosaicOffers[i];
            quoteIdx = i;
            break;
          }
        }
      }

      // Build HTML
      let html = '<div class="tgo-mag">';

      // 1. Hero
      html += this._renderMagazineHero(hero);

      // 2. Editorial divider (only if we have more content below)
      if (this.cfg.magazineShowDividers !== false && (banner || mosaicOffers.length)) {
        const totalRemaining = (banner ? 1 : 0) + mosaicOffers.length;
        const label = totalRemaining + ' more handpicked '
          + (totalRemaining === 1 ? 'stay' : 'stays');
        html += this._renderMagazineDivider(label);
      }

      // 3. Banner
      if (banner) {
        html += this._renderMagazineBanner(banner);
      }

      // 4 + 5. Mosaic rows
      // The first row contains [tile, quote, tile] if we have a quote, else [tile, tile, tile]
      // Subsequent rows are all [tile, tile, tile] continuing through the offers
      if (mosaicOffers.length) {
        // Pull the quote out of the offer pool so it doesn't appear twice
        const remainingForMosaic = quoteIdx >= 0
          ? mosaicOffers.slice(0, quoteIdx).concat(mosaicOffers.slice(quoteIdx + 1))
          : mosaicOffers;

        if (quoteOffer && remainingForMosaic.length >= 2) {
          // First row with quote in centre
          html += '<div class="tgo-mag-mosaic">';
          html += this._renderOfferCard(remainingForMosaic[0]);
          html += this._renderMagazineQuoteCard(quoteOffer);
          html += this._renderOfferCard(remainingForMosaic[1]);
          html += '</div>';

          // Subsequent rows
          if (remainingForMosaic.length > 2) {
            const more = remainingForMosaic.slice(2);
            html += '<div class="tgo-mag-mosaic">';
            for (const o of more) html += this._renderOfferCard(o);
            html += '</div>';
          }
        } else {
          // No quote, or quote eaten too much — straight mosaic
          html += '<div class="tgo-mag-mosaic">';
          for (const o of remainingForMosaic) html += this._renderOfferCard(o);
          html += '</div>';
        }
      }

      html += '</div>';  // /tgo-mag

      if (this.cfg.show.poweredBy) {
        html += '<div class="tgo-powered">Powered by Travelgenix</div>';
      }
      this.root.innerHTML = html;
    }

    _pickMagazineHero(offers) {
      const strat = this.cfg.magazineHeroStrategy || 'discount';

      if (strat === 'featured') {
        const idx = offers.findIndex(o => o && o.featured === true);
        if (idx >= 0) return idx;
        // Fall through to discount when no featured offer found
      }

      if (strat === 'first' || !offers.length) return 0;

      if (strat === 'cheapest') {
        let bestIdx = 0, bestPrice = Infinity;
        offers.forEach((o, i) => {
          const p = getNumericPrice(o);
          if (p < bestPrice) { bestPrice = p; bestIdx = i; }
        });
        return bestIdx;
      }

      // discount (default)
      let bestIdx = 0, bestSaving = -Infinity;
      offers.forEach((o, i) => {
        const acc = (o.accommodation && o.accommodation.pricing) || {};
        const fl = (o.flight && o.flight.pricing) || {};
        const before = (acc.priceChanged && acc.priceBeforeChange) || (fl.priceChanged && fl.priceBeforeChange) || 0;
        const now = getNumericPrice(o);
        const saving = (before && isFinite(now)) ? (before - now) : 0;
        if (saving > bestSaving) { bestSaving = saving; bestIdx = i; }
      });
      // If no offer has a recorded saving, fall back to first
      if (bestSaving <= 0) return 0;
      return bestIdx;
    }

    // The banner is the second-billing offer below the hero. Same picking
    // strategy as the hero would use, but applied to the remaining offers
    // pool (so it never duplicates the hero).
    _pickMagazineBanner(offers) {
      // Use the same strategy as the hero so the user's preference applies
      // to the banner too — the banner is the "runner-up" by the same metric.
      return this._pickMagazineHero(offers);
    }

    // Returns the quote text for an offer, or null if no usable source.
    // Three-tier fallback: editorialQuote → accommodation.summary → null.
    _magQuoteText(o) {
      if (!o) return null;
      // Tier 1 — manually curated quote (optional Airtable field)
      if (typeof o.editorialQuote === 'string' && o.editorialQuote.trim().length > 20) {
        return o.editorialQuote.trim();
      }
      // Tier 2 — accommodation summary (Travelify field)
      const acc = o.accommodation || {};
      if (typeof acc.summary === 'string' && acc.summary.trim().length > 30) {
        return acc.summary.trim();
      }
      // Tier 3 — no usable quote, this offer can't be the quote-card
      return null;
    }

    // The hero card. Picks the right hero variant for the offer's type so
    // the headline reads naturally (hotel name vs route vs operator+hotel).
    _renderMagazineHero(o) {
      const acc = o.accommodation || {};
      const f = o.flight || {};
      const dest = acc.destination || f.destination || {};
      const isAcc = o.type === 'Accommodation';
      const isFlight = o.type === 'Flight' || o.type === 'Flights';
      const isPkg = o.type === 'Package' || o.type === 'Packages';

      const img = safeImgUrl(
        (acc.image && acc.image.url)
        || (f.image && f.image.url)
        || ''
      );

      // Headline + kicker
      let kicker = '';
      let headline = '';
      let summary = '';
      if (isAcc) {
        const bits = [];
        if (dest.name) bits.push(dest.name);
        if (acc.nights) bits.push(acc.nights + ' night' + (acc.nights === 1 ? '' : 's'));
        if (acc.boardBasis) bits.push(formatEnum(acc.boardBasis));
        kicker = bits.join(' · ');
        headline = acc.name || 'Featured stay';
        summary = acc.summary || '';
      } else if (isFlight) {
        const og = f.origin || {};
        const fd = f.destination || {};
        const bits = [];
        if (og.iataCode && fd.iataCode) bits.push(og.iataCode + ' → ' + fd.iataCode);
        if (f.direct) bits.push('Direct');
        if (f.duration) bits.push(formatDuration(f.duration));
        kicker = bits.join(' · ');
        headline = (f.carrier && f.carrier.name) ? f.carrier.name + ' to ' + (fd.name || fd.iataCode || 'destination') : 'Featured flight';
        summary = '';
      } else if (isPkg) {
        const pkgType = getPackageType(o);
        const isHoliday = pkgType === 'PackageHolidays';
        const bits = [];
        if (dest.name) bits.push(dest.name);
        if (acc.nights) bits.push(acc.nights + ' night' + (acc.nights === 1 ? '' : 's'));
        if (acc.boardBasis) bits.push(formatEnum(acc.boardBasis));
        if (isHoliday && acc.operator && acc.operator.name) bits.push('with ' + acc.operator.name);
        kicker = bits.join(' · ');
        headline = acc.name || 'Featured package';
        summary = acc.summary || '';
      } else {
        kicker = '';
        headline = 'Featured offer';
        summary = '';
      }

      // Price block on the right of the hero
      const display = computeDisplayPrice(o, this.cfg.priceDisplay || 'auto');
      const url = safeUrl(o.url || '#');
      const accPricing = acc.pricing || {};
      const flightPricing = f.pricing || {};
      const wasPrice = (accPricing.priceChanged && accPricing.priceBeforeChange)
        ? '£' + Math.round(accPricing.priceBeforeChange)
        : (flightPricing.priceChanged && flightPricing.priceBeforeChange)
          ? '£' + Math.round(flightPricing.priceBeforeChange)
          : null;

      let html = '<article class="tgo-mag-hero" ' + cssBgUrl(img) + '>';
      html += '<span class="tgo-mag-hero-badge">Featured</span>';
      html += '<div class="tgo-mag-hero-content">';
      html += '<div>';
      if (kicker) html += '<div class="tgo-mag-hero-kicker">' + esc(kicker) + '</div>';
      html += '<h3 class="tgo-mag-hero-title">' + esc(headline) + '</h3>';
      if (summary && this.cfg.show.summary) {
        html += '<p class="tgo-mag-hero-summary">' + esc(summary) + '</p>';
      }
      html += '</div>';

      html += '<div class="tgo-mag-hero-price">';
      html += '<span class="tgo-mag-hero-from">From</span>';
      if (this.cfg.show.wasPrice && wasPrice) {
        html += '<span class="tgo-mag-hero-was">' + esc(wasPrice) + '</span>';
      }
      html += '<span class="tgo-mag-hero-now">' + esc(display.primary) + '</span>';
      if (display.sub) html += '<span class="tgo-mag-hero-sub">' + esc(display.sub) + '</span>';
      html += '<a class="tgo-mag-hero-cta" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">Reserve this trip</a>';
      html += '</div>';
      html += '</div>'; // /tgo-mag-hero-content
      html += '</article>';
      return html;
    }

    // The full-width banner card. Image left, content right. Reads like a
    // "second cover story" below the hero — gives the runner-up offer
    // weight without competing with the hero for attention.
    _renderMagazineBanner(o) {
      const acc = o.accommodation || {};
      const f = o.flight || {};
      const dest = acc.destination || f.destination || {};
      const isAcc = o.type === 'Accommodation';
      const isFlight = o.type === 'Flight' || o.type === 'Flights';
      const isPkg = o.type === 'Package' || o.type === 'Packages';

      const img = safeImgUrl(
        (acc.image && acc.image.url)
        || (f.image && f.image.url)
        || ''
      );

      // Optional overlay tag — uses operator name on packages, "Direct" on flights, etc.
      let overlay = '';
      if (isPkg && acc.operator && acc.operator.name) {
        overlay = acc.operator.name;
      } else if (isFlight && f.direct) {
        overlay = 'Direct';
      } else if (isAcc && acc.rating >= 5) {
        overlay = '5★';
      }

      // Headline + kicker
      let kicker = '';
      let headline = '';
      let summary = '';
      if (isAcc) {
        const bits = [];
        if (dest.name) bits.push(dest.name);
        if (acc.nights) bits.push(acc.nights + ' night' + (acc.nights === 1 ? '' : 's'));
        if (acc.boardBasis) bits.push(formatEnum(acc.boardBasis));
        kicker = bits.join(' · ');
        headline = acc.name || 'Featured stay';
        summary = acc.summary || '';
      } else if (isFlight) {
        const og = f.origin || {};
        const fd = f.destination || {};
        const bits = [];
        if (og.iataCode && fd.iataCode) bits.push(og.iataCode + ' → ' + fd.iataCode);
        if (f.duration) bits.push(formatDuration(f.duration));
        if ((f.carrier || {}).name) bits.push(f.carrier.name);
        kicker = bits.join(' · ');
        headline = ((fd.name || fd.iataCode || '') + (f.direct ? ' direct' : '')).trim() || 'Featured flight';
        summary = '';
      } else if (isPkg) {
        const bits = [];
        if (dest.name) bits.push(dest.name);
        if (acc.nights) bits.push(acc.nights + ' night' + (acc.nights === 1 ? '' : 's'));
        if (acc.boardBasis) bits.push(formatEnum(acc.boardBasis));
        kicker = bits.join(' · ');
        headline = acc.name || 'Featured package';
        summary = acc.summary || '';
      } else {
        headline = 'Featured offer';
      }

      const display = computeDisplayPrice(o, this.cfg.priceDisplay || 'auto');
      const url = safeUrl(o.url || '#');

      let html = '<a class="tgo-mag-banner" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">';
      html += '<div class="tgo-mag-banner-img" ' + cssBgUrl(img) + '>';
      if (overlay) {
        html += '<span class="tgo-mag-banner-overlay">' + esc(overlay) + '</span>';
      }
      html += '</div>';
      html += '<div class="tgo-mag-banner-body">';
      if (kicker) html += '<div class="tgo-mag-banner-kicker">' + esc(kicker) + '</div>';
      html += '<h3>' + esc(headline) + '</h3>';
      if (summary && this.cfg.show.summary) {
        html += '<p>' + esc(summary) + '</p>';
      }
      html += '<div class="tgo-mag-banner-foot">';
      html += '<span class="price">' + esc(display.primary)
        + (display.sub ? '<small>' + esc(display.sub) + '</small>' : '')
        + '</span>';
      html += '<span class="cta">View deal →</span>';
      html += '</div>';
      html += '</div>';  // /tgo-mag-banner-body
      html += '</a>';
      return html;
    }

    // The pull-quote card. Sits in the centre cell of the first mosaic row.
    // Navy background, oversized italic quote, no image. The whole card is
    // a link to the offer.
    _renderMagazineQuoteCard(o) {
      const acc = o.accommodation || {};
      const dest = acc.destination || (o.flight && o.flight.destination) || {};
      const quote = this._magQuoteText(o);
      // Caller has already verified quote is present, but defend anyway
      if (!quote) return this._renderOfferCard(o);

      // Truncate for visual consistency — anything over ~160 chars looks
      // unbalanced in the card. Add ellipsis.
      const truncated = quote.length > 160
        ? quote.slice(0, 160).replace(/\s+\S*$/, '') + '…'
        : quote;

      // Kicker — use destination name + nights/board if available, else "Editor's pick"
      let kicker = "Editor's pick";
      if (dest.name && acc.nights) {
        kicker = dest.name + ' · ' + acc.nights + ' nt';
        if (acc.boardBasis) kicker += ' · ' + formatEnum(acc.boardBasis);
      } else if (dest.name) {
        kicker = dest.name;
      }

      const display = computeDisplayPrice(o, this.cfg.priceDisplay || 'auto');
      const url = safeUrl(o.url || '#');

      let html = '<a class="tgo-mag-quote" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">';
      html += '<div class="tgo-mag-quote-kicker">' + esc(kicker) + '</div>';
      html += '<blockquote>' + esc(truncated) + '</blockquote>';
      html += '<div class="tgo-mag-quote-foot">';
      html += '<span class="price">' + esc(display.primary)
        + (display.sub ? '<small>' + esc(display.sub) + '</small>' : '')
        + '</span>';
      html += '<span class="cta">Book →</span>';
      html += '</div>';
      html += '</a>';
      return html;
    }

    // Editorial divider between sections. Small caps typography with horizontal
    // rules either side. Optional <strong> for stat emphasis (passed in label).
    _renderMagazineDivider(label) {
      return '<div class="tgo-mag-divider">'
        + '<span class="tgo-mag-divider-label">' + esc(label) + '</span>'
        + '</div>';
    }
    /* ═══════════════════════════════════════════════════════════════════
       END MAGAZINE TEMPLATE
       ═══════════════════════════════════════════════════════════════════ */

    /* ═══════════════════════════════════════════════════════════════════
       BOARDING-PASS TEMPLATE (FLIGHTS ONLY)
       Paper boarding-pass shape with perforated stub, mono flight numbers
       and a CSS-rendered barcode strip. Forced to flights-only via
       _buildPayload's type override (see departure-board precedent).
       Uses tgbp- prefix to avoid colliding with cards (tgo-) or board (tdb-).
       ═══════════════════════════════════════════════════════════════════ */
    _renderBoardingPassTemplate() {
      const deduped = dedupeOffers(this.rawOffers, this.cfg.dedupeStrategy, this.cfg.sort);

      // Filter strictly to flights (defensive — the API should only return
      // flights given the type override, but guard anyway).
      const flights = deduped.filter((o) => o.type === 'Flight' || o.type === 'Flights');

      if (!flights.length) {
        this._showEmpty();
        return;
      }

      const cols = Math.min(2, Math.max(1, this.cfg.boardingPassColumns || 2));
      let html = '<div class="tgbp-grid" data-cols="' + cols + '">';
      for (const o of flights) html += this._renderBoardingPass(o);
      html += '</div>';

      if (this.cfg.show.poweredBy) {
        html += '<div class="tgo-powered">Powered by Travelgenix</div>';
      }
      this.root.innerHTML = html;
    }

    _renderBoardingPass(o) {
      const f = o.flight || {};
      const og = f.origin || {};
      const dest = f.destination || {};
      const carrier = f.carrier || {};
      const pricing = f.pricing || {};

      const url = safeUrl(o.url || '#');
      const carrierCode = (carrier.code || '').slice(0, 2).toUpperCase() || 'XX';
      const carrierName = carrier.name || 'Carrier';
      const flightNumber = (carrier.code && f.flightNumber) ? carrier.code + ' ' + f.flightNumber : (carrier.code || '');
      const cabinClass = f.cabinClass ? formatEnum(f.cabinClass) : 'Economy';
      const isDirect = f.direct === true;
      const stops = f.stops || 0;
      const stopsLabel = isDirect ? 'Direct' : (stops === 1 ? '1 stop' : (stops > 0 ? stops + ' stops' : 'Direct'));

      // Format depart/arrive times
      const depart = formatBoardTime(f.outboundDate);
      const arrive = formatBoardTime(f.arrivalDate || f.outboundArrivalDate);
      const date = formatBoardDate(f.outboundDate);
      const duration = f.duration ? formatDuration(f.duration) : '';

      // Price
      const display = computeDisplayPrice(o, this.cfg.priceDisplay || 'auto');
      const wasPrice = (pricing.priceChanged && pricing.priceBeforeChange)
        ? '£' + Math.round(pricing.priceBeforeChange) : null;

      // Barcode "number" — synthetic, derived from carrier + flight + date
      const barcodeNum = (carrier.code || 'XX') + (f.flightNumber || '0000') + '·' + (date || '').replace(/\s/g, '');

      let html = '<article class="tgbp">';

      // Main panel
      html += '<div class="tgbp-main">';

      // Header: airline + cabin class
      html += '<div class="tgbp-head">';
      html += '<div class="tgbp-airline">';
      html += '<div class="tgbp-mark">' + esc(carrierCode) + '</div>';
      html += '<div class="tgbp-airline-text">';
      html += '<div class="tgbp-airline-name">' + esc(carrierName) + '</div>';
      html += '<div class="tgbp-airline-sub">' + esc(flightNumber || stopsLabel) + (flightNumber && stopsLabel ? ' · ' + esc(stopsLabel) : '') + '</div>';
      html += '</div>';
      html += '</div>';
      if (this.cfg.show.cabinClass) {
        html += '<span class="tgbp-class">' + esc(cabinClass) + '</span>';
      }
      html += '</div>';

      // Route block: ORIGIN → DEST
      html += '<div class="tgbp-route">';
      html += '<div class="tgbp-route-end">';
      html += '<div class="tgbp-iata">' + esc(og.iataCode || '???') + '</div>';
      html += '<div class="tgbp-airport-name">' + esc((og.name || '').replace(/\s*\([A-Z]{3}\)\s*$/, '')) + '</div>';
      html += '</div>';
      html += '<div class="tgbp-plane">';
      html += '<div class="tgbp-plane-line"></div>';
      html += '<div class="tgbp-plane-icon">' + icon('plane', 18) + '</div>';
      html += '<div class="tgbp-plane-line"></div>';
      html += '</div>';
      html += '<div class="tgbp-route-end right">';
      html += '<div class="tgbp-iata">' + esc(dest.iataCode || '???') + '</div>';
      html += '<div class="tgbp-airport-name">' + esc((dest.name || '').replace(/\s*\([A-Z]{3}\)\s*$/, '')) + '</div>';
      html += '</div>';
      html += '</div>';

      // Detail row: date / depart / arrive / duration
      html += '<div class="tgbp-detail-row">';
      html += '<div class="tgbp-detail"><span class="tgbp-detail-label">Date</span><span class="tgbp-detail-value">' + esc(date || '—') + '</span></div>';
      html += '<div class="tgbp-detail"><span class="tgbp-detail-label">Depart</span><span class="tgbp-detail-value">' + esc(depart) + '</span></div>';
      html += '<div class="tgbp-detail"><span class="tgbp-detail-label">Arrive</span><span class="tgbp-detail-value">' + esc(arrive) + '</span></div>';
      html += '<div class="tgbp-detail"><span class="tgbp-detail-label">Duration</span><span class="tgbp-detail-value">' + esc(duration || '—') + '</span></div>';
      html += '</div>';

      html += '</div>'; // /tgbp-main

      // Stub
      html += '<div class="tgbp-stub">';
      html += '<div class="tgbp-stub-top">';
      html += '<span class="tgbp-stub-label">Fare</span>';
      if (this.cfg.show.wasPrice && wasPrice) {
        html += '<span class="tgbp-stub-was">' + esc(wasPrice) + '</span>';
      }
      html += '<span class="tgbp-stub-price">' + esc(display.primary) + '</span>';
      html += '</div>';

      if (this.cfg.boardingPassShowBarcode) {
        html += '<div class="tgbp-barcode">';
        html += '<div class="tgbp-barcode-bars" aria-hidden="true"></div>';
        html += '<div class="tgbp-barcode-num">' + esc(barcodeNum) + '</div>';
        html += '</div>';
      }

      html += '<a class="tgbp-cta" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">Book</a>';
      html += '</div>'; // /tgbp-stub

      html += '</article>';
      return html;
    }
    /* ═══════════════════════════════════════════════════════════════════
       END BOARDING-PASS TEMPLATE
       ═══════════════════════════════════════════════════════════════════ */


    /* ═══════════════════════════════════════════════════════════════════
       DEPARTURE-BOARD TEMPLATE METHODS
       Flight-only template that styles like an airport board. Auto-detects
       visitor's nearest airport, refetches on a timer, animates with
       split-flap fade. Self-contained — uses tdb- classes throughout to
       avoid touching the cards template's tgo- classes.
       ═══════════════════════════════════════════════════════════════════ */
    async _renderDepartureBoard() {
      // First call: detect airport then refetch with the right origin filter.
      // Subsequent calls (refresh button, auto-refresh) skip detection.
      if (!this._boardAirport) {
        if (this.cfg.boardAutoDetect) {
          this._boardAirport = await detectAirport(this.cfg.boardDefaultAirport);
        } else {
          this._boardAirport = AIRPORT_BY_CODE[this.cfg.boardDefaultAirport] || AIRPORT_BY_CODE.LHR;
        }
        // Re-fetch with the correct origin filter — _buildPayload now sees
        // _boardAirport and adds origin to the request body.
        if (this._boardAirport) {
          await this._fetchAndRenderBoard();
          return;
        }
      }

      this._renderBoardShell();
      this._renderBoardRows();
      this._wireBoardEvents();
      this._startBoardClock();
      this._scheduleBoardRefresh();
      if (this.cfg.boardAnimate) this._runBoardFlipAnimation();
    }

    // Re-runs the Travelify fetch with the board-specific filters and
    // re-renders. Used when switching airports or hitting refresh.
    async _fetchAndRenderBoard() {
      try {
        const payload = this._buildPayload();
        const res = await fetch(TRAVELIFY_ENDPOINT, {
          method: 'POST',
          headers: {
            'Authorization': 'Token ' + this.cfg.appId + ':' + this.cfg.apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error('API ' + res.status);
        const data = await res.json();
        this.rawOffers = (data && data.data) ? data.data : [];
      } catch (err) {
        console.warn('[TGOffers/board]', err);
      }
      this._renderBoardShell();
      this._renderBoardRows();
      this._wireBoardEvents();
      this._startBoardClock();
      this._scheduleBoardRefresh();
      if (this.cfg.boardAnimate) this._runBoardFlipAnimation();
    }

    _renderBoardShell() {
      const a = this._boardAirport || AIRPORT_BY_CODE.LHR;
      const radius = (typeof this.cfg.radius === 'number' ? this.cfg.radius : 14) + 'px';
      const fontFamily = this.cfg.fontFamily || '';
      const switcherChev = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
      const refreshIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>';

      // Wipe any prior tgo-root content and redraw root with the tdb- classes.
      // We keep this.root pointing at the same shadow-attached div, just
      // change its class + style so tdb- CSS applies.
      this.root.className = 'tdb-root';
      this.root.setAttribute('data-theme', this.cfg.boardTheme === 'light' ? 'light' : 'dark');
      this.root.style.setProperty('--tdb-radius', radius);
      if (fontFamily) this.root.style.setProperty('--tdb-font-body', fontFamily);

      let html = '<div class="tdb-header">'
        + '<div class="tdb-header-left">'
        + '<div class="tdb-icon">'
        + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/></svg>'
        + '</div>'
        + '<div class="tdb-title-block">'
        + '<div class="tdb-title">Departures from '
        + (this.cfg.boardAllowSwitcher
          ? '<span class="tdb-switcher">'
          + '<button type="button" class="tdb-airport-pick" data-tdb-switcher aria-haspopup="listbox" aria-expanded="false">'
          + '<span data-tdb-airport-label>' + esc(a.city + ' (' + a.code + ')') + '</span>'
          + switcherChev
          + '</button>'
          + '<ul class="tdb-switcher-menu" role="listbox" hidden></ul>'
          + '</span>'
          : '<span>' + esc(a.city + ' (' + a.code + ')') + '</span>')
        + '</div>'
        + '<div class="tdb-subtitle">Cheapest fares · next ' + (this.cfg.boardDateRange || 30) + ' days</div>'
        + '</div></div>'
        + '<div class="tdb-now">'
        + '<span class="tdb-live-dot" aria-hidden="true"></span>'
        + 'Live · <span data-tdb-clock>' + formatBoardNow() + '</span>'
        + '</div>'
        + '</div>';

      html += '<div class="tdb-table">'
        + '<div class="tdb-row tdb-head">'
        + '<span>Time</span>'
        + '<span>Route</span>'
        + '<span class="tdb-carrier">Carrier</span>'
        + '<span class="tdb-stops">Stops</span>'
        + '<span class="tdb-date">Date</span>'
        + '<span class="tdb-status">Status</span>'
        + '<span class="tdb-fare" style="text-align:right;">Fare</span>'
        + '</div>'
        + '<div data-tdb-rows></div>'
        + '</div>';

      html += '<div class="tdb-footer">'
        + '<div class="tdb-footer-meta" data-tdb-meta>—</div>'
        + '<button type="button" class="tdb-refresh" data-tdb-refresh>'
        + refreshIcon
        + '<span>Refresh</span>'
        + '</button>'
        + '</div>';

      this.root.innerHTML = html;
      this._populateBoardSwitcher();
    }

    _renderBoardRows() {
      const rowsEl = this.root.querySelector('[data-tdb-rows]');
      if (!rowsEl) return;

      // Sort by visible price ascending — formattedPrice is what the user sees
      const parsePrice = (s) => {
        if (!s) return Infinity;
        const m = String(s).replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
        return m ? parseFloat(m[1]) : Infinity;
      };
      const cap = Math.max(5, Math.min(15, this.cfg.maxOffers || 8));
      const flights = (this.rawOffers || [])
        .filter((o) => o.flight && o.flight.pricing)
        .sort((a, b) => parsePrice(a.formattedPrice || a.formattedPPPrice)
                      - parsePrice(b.formattedPrice || b.formattedPPPrice))
        .slice(0, cap);

      if (!flights.length) {
        rowsEl.innerHTML = '<div class="tdb-empty">'
          + '<div class="tdb-empty-title">No flights found</div>'
          + 'Try widening the date range or changing the departure airport.'
          + '</div>';
        this._updateBoardMeta(0);
        // No rows to animate — make sure any prior flap registry is cleared
        this._sfRows = [];
        return;
      }

      // Cheapest gets the gold pill
      let cheapestPrice = Infinity, cheapestId = null;
      for (const o of flights) {
        const p = parsePrice(o.formattedPrice || o.formattedPPPrice);
        if (p < cheapestPrice) { cheapestPrice = p; cheapestId = o.id; }
      }

      // Build each row's HTML with placeholders for the animatable cells.
      // The placeholder format: <span class="tdb-sf-cell" data-sf-target="LHR"></span>
      // After insertion, the scheduler walks every .tdb-sf-cell, populates
      // it with SolariFlap instances (one per character), and runs the cascade.
      let html = '';
      const rowTargets = [];  // collect per-row target strings for the scheduler

      for (const o of flights) {
        const f = o.flight || {};
        const og = f.origin || {};
        const dest = f.destination || {};
        const carrier = f.carrier || {};
        const url = safeUrl(o.url || '#');
        const time = formatBoardTime(f.outboundDate);                    // "12:35"
        const date = formatBoardDate(f.outboundDate);                    // "12 MAY"
        const fromIata = (og.iataCode || '???').toUpperCase();
        const toIata = (dest.iataCode || '???').toUpperCase();
        const fareText = o.formattedPrice || o.formattedPPPrice || '—';
        const stops = f.direct || f.stops === 0
          ? '<span class="tdb-direct">DIRECT</span>'
          : (f.stops === 1 ? '1 STOP' : (f.stops || 1) + ' STOPS');
        const isCheapest = (o.id === cheapestId);
        const pillHtml = this._pickBoardPill(o, isCheapest);

        const cityLine = (og.name ? og.name.replace(/\s*\([A-Z]{3}\)\s*$/, '') : '')
          + ' → '
          + (dest.name ? dest.name.replace(/\s*\([A-Z]{3}\)\s*$/, '') : '');

        // Per-row targets in the order they appear left-to-right.
        // The scheduler reads these, the keys must match the placeholder
        // class on each cell.
        rowTargets.push({
          time: time,
          fromIata: fromIata,
          toIata: toIata,
          date: date,
          fare: fareText,
        });

        html += '<a class="tdb-row tdb-data" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer" style="text-decoration:none;color:inherit;">'
          + '<div class="tdb-time"><span class="tdb-sf-cell" data-sf-key="time" data-sf-target="' + esc(time) + '"></span></div>'
          + '<div class="tdb-route">'
          + '<div class="tdb-route-codes">'
          + '<span class="tdb-sf-cell" data-sf-key="fromIata" data-sf-target="' + esc(fromIata) + '"></span>'
          + '<span class="tdb-arrow">→</span>'
          + '<span class="tdb-sf-cell" data-sf-key="toIata" data-sf-target="' + esc(toIata) + '"></span>'
          + '</div>'
          + '<div class="tdb-route-cities">' + esc(cityLine) + '</div>'
          + '</div>'
          + '<div class="tdb-carrier">'
          + (carrier.code ? '<span class="tdb-carrier-code">' + esc(carrier.code) + '</span>' : '')
          + '<span>' + esc(carrier.name || '—') + '</span>'
          + '</div>'
          + '<div class="tdb-stops ' + (f.direct ? 'tdb-direct' : '') + '">' + stops + '</div>'
          + '<div class="tdb-date"><span class="tdb-sf-cell" data-sf-key="date" data-sf-target="' + esc(date) + '"></span></div>'
          + '<div class="tdb-status">' + pillHtml + '</div>'
          + '<div class="tdb-fare"><span class="tdb-sf-cell" data-sf-key="fare" data-sf-target="' + esc(fareText) + '"></span></div>'
          + '</a>';
      }
      rowsEl.innerHTML = html;

      // Stash row target data on the instance for the scheduler. Each entry
      // pairs the target dict with the row DOM element.
      this._sfRowTargets = rowTargets;
      this._updateBoardMeta(flights.length);
    }

    // Pick at most ONE status pill per row, by priority order.
    // Priority (highest to lowest):
    //   Cheapest          (★ gold, always-on)
    //   Premium cabin     (purple, opt-in via boardShowPremiumCabin)
    //   Today             (red, always-on)
    //   Tomorrow          (orange, opt-in via boardShowTomorrow)
    //   This week         (blue, always-on)
    //   Going soon        (teal, opt-in via boardShowGoingSoon, threshold = boardGoingSoonDays)
    //   null              (most rows show no pill — the default state)
    _pickBoardPill(o, isCheapest) {
      const f = o.flight || {};
      const cabin = (f.cabinClass || '').toLowerCase();
      const proximity = dateProximity(f.outboundDate);
      const days = proximity.days;

      // 1. Cheapest — always wins
      if (isCheapest) {
        return '<span class="tdb-pill" data-kind="cheapest">★ Cheapest</span>';
      }

      // 2. Premium cabin — opt-in. Beats date proximity because cabin is a
      // quality signal that's relevant regardless of when the flight is.
      if (this.cfg.boardShowPremiumCabin
          && (cabin === 'business' || cabin === 'first' || cabin === 'businessclass' || cabin === 'firstclass')) {
        const label = (cabin === 'first' || cabin === 'firstclass') ? 'First class' : 'Business';
        return '<span class="tdb-pill" data-kind="premium">' + esc(label) + '</span>';
      }

      // 3. Today — always-on. Departing in less than 24 hours.
      if (proximity.category === 'today') {
        return '<span class="tdb-pill" data-kind="today">Today</span>';
      }

      // 4. Tomorrow — opt-in. 24-48 hours from now.
      if (this.cfg.boardShowTomorrow && proximity.category === 'tomorrow') {
        return '<span class="tdb-pill" data-kind="tomorrow">Tomorrow</span>';
      }

      // 5. This week — always-on. 2-7 days from now.
      if (proximity.category === 'thisWeek') {
        return '<span class="tdb-pill" data-kind="week">This week</span>';
      }

      // 6. Going soon — opt-in, configurable threshold (default 14 days).
      // Triggers when the flight is past 'thisWeek' (so 7+ days) and
      // within boardGoingSoonDays of departure.
      if (this.cfg.boardShowGoingSoon) {
        const threshold = this.cfg.boardGoingSoonDays || 14;
        if (days >= 7 && days <= threshold) {
          return '<span class="tdb-pill" data-kind="soon">Going soon</span>';
        }
      }

      return '';
    }

    _populateBoardSwitcher() {
      const menu = this.root.querySelector('.tdb-switcher-menu');
      if (!menu) return;
      const current = this._boardAirport ? this._boardAirport.code : '';
      let html = '';
      for (const a of UK_AIRPORTS) {
        html += '<li>'
          + '<button type="button" class="tdb-switcher-item"'
          + ' data-tdb-airport="' + a.code + '"'
          + (a.code === current ? ' aria-current="true"' : '')
          + '>'
          + '<span>' + esc(a.city) + ' · ' + esc(a.name) + '</span>'
          + '<span class="tdb-switcher-code">' + esc(a.code) + '</span>'
          + '</button>'
          + '</li>';
      }
      menu.innerHTML = html;
    }

    _wireBoardEvents() {
      if (this._boardWired) return;
      this._boardWired = true;

      this.shadow.addEventListener('click', async (ev) => {
        // Only handle when the departure-board template is active
        if (this.cfg.template !== 'departure-board') return;

        const trigger = ev.target.closest('[data-tdb-switcher]');
        if (trigger) {
          ev.preventDefault();
          const menu = this.root.querySelector('.tdb-switcher-menu');
          const open = trigger.getAttribute('aria-expanded') === 'true';
          trigger.setAttribute('aria-expanded', open ? 'false' : 'true');
          if (menu) menu.hidden = open;
          return;
        }
        const item = ev.target.closest('[data-tdb-airport]');
        if (item) {
          ev.preventDefault();
          const code = item.getAttribute('data-tdb-airport');
          if (AIRPORT_BY_CODE[code]) {
            this._boardAirport = AIRPORT_BY_CODE[code];
            try { sessionStorage.setItem(GEO_CACHE_KEY, JSON.stringify({ code })); } catch { /* ignore */ }
            await this._fetchAndRenderBoard();
          }
          return;
        }
        const refresh = ev.target.closest('[data-tdb-refresh]');
        if (refresh) {
          ev.preventDefault();
          refresh.classList.add('is-loading');
          await this._fetchAndRenderBoard();
          refresh.classList.remove('is-loading');
          return;
        }
        // Click outside closes any open switcher
        if (!ev.target.closest('.tdb-switcher')) {
          const trig = this.root.querySelector('[data-tdb-switcher]');
          const menu = this.root.querySelector('.tdb-switcher-menu');
          if (trig) trig.setAttribute('aria-expanded', 'false');
          if (menu) menu.hidden = true;
        }
      });
    }

    _startBoardClock() {
      if (this._boardClockTimer) clearInterval(this._boardClockTimer);
      const tick = () => {
        const el = this.root.querySelector('[data-tdb-clock]');
        if (el) el.textContent = formatBoardNow();
      };
      tick();
      this._boardClockTimer = setInterval(tick, 30000);
    }

    _updateBoardMeta(count) {
      const meta = this.root.querySelector('[data-tdb-meta]');
      if (!meta) return;
      meta.textContent = count + ' flight' + (count === 1 ? '' : 's')
        + ' · updated ' + formatBoardNow();
    }

    _scheduleBoardRefresh() {
      if (this._boardRefreshTimer) { clearInterval(this._boardRefreshTimer); this._boardRefreshTimer = null; }
      if (!this.cfg.boardAutoRefresh) return;
      const ms = Math.max(60, this.cfg.boardRefreshSeconds || 300) * 1000;
      this._boardRefreshTimer = setInterval(() => {
        if (document.hidden) return;
        this._fetchAndRenderBoard();
      }, ms);
      if (!this._boardVisHandler) {
        this._boardVisHandler = () => {
          if (!document.hidden && this.cfg.template === 'departure-board') {
            this._fetchAndRenderBoard();
          }
        };
        document.addEventListener('visibilitychange', this._boardVisHandler);
      }
    }

    // Real Solari split-flap scheduler.
    //
    // For each row, walk the placeholder cells (.tdb-sf-cell), instantiate
    // a SolariFlap per character, and schedule each character's scramble
    // with a row+column cascade so the board updates like a real
    // mechanical display.
    //
    // Cascade timing (researched from real Solari boards + Grafana panel):
    //   Per-flap duration: 80ms (one rotation of one drum step)
    //   Row stagger: 120ms (board updates top-down)
    //   Column stagger within row: 40ms (left-to-right ripple)
    //   Per-character jitter: ±15ms (avoid metronome regularity)
    //
    // If `boardSound` is on and the AudioContext is available, each flap
    // landing plays a short percussive click. If `prefers-reduced-motion`
    // is set, the scheduler skips animation entirely and just updates text.
    _runBoardFlipAnimation() {
      // Cancel any in-flight scramble from a prior render
      this._cancelBoardFlaps();

      // Honour prefers-reduced-motion — no animation, just settle the values
      const prefersReducedMotion = window.matchMedia
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      const cells = this.root.querySelectorAll('[data-tdb-rows] .tdb-sf-cell');
      if (!cells.length) return;

      // Build a registry of SolariFlap instances per cell.
      // Structure: this._sfFlaps = [ [flap, flap, ...], [flap, flap, ...], ... ]
      // outer = row index, inner = flat list of every character flap in the row,
      // ordered left-to-right across all cells in that row.
      this._sfFlaps = [];

      const rowEls = this.root.querySelectorAll('[data-tdb-rows] .tdb-row.tdb-data');
      rowEls.forEach((rowEl, rowIdx) => {
        const rowFlaps = [];
        const rowCells = rowEl.querySelectorAll('.tdb-sf-cell');

        rowCells.forEach((cellEl) => {
          const target = (cellEl.getAttribute('data-sf-target') || '').toUpperCase();
          // Build one SolariFlap per character of the target.
          // We use an empty initial state so first render scrambles in.
          // (On subsequent renders, we'll preserve previous chars — see below.)
          const prevFlaps = this._sfPrevFlaps && this._sfPrevFlaps[rowIdx];
          // Find a previous flap for this cell (matched by data-sf-key) so we
          // can carry over its current glyph and only flip the diff.
          // For now, simple approach: always start blank if no previous.
          const chars = target.split('');
          const cellFlaps = [];
          // Clear placeholder content
          cellEl.innerHTML = '';
          chars.forEach((ch) => {
            // Try to match a previous flap at the same character position
            // in the same cell, so re-renders only flip the chars that
            // actually changed.
            let initial = ' ';
            if (prevFlaps) {
              const prev = prevFlaps.find(p =>
                p.cellKey === cellEl.getAttribute('data-sf-key')
                && p.charIdx === cellFlaps.length
              );
              if (prev) initial = prev.flap.current;
            }
            const flap = new SolariFlap(initial);
            flap.soundEnabled = !!this.cfg.boardSound && !prefersReducedMotion;
            cellEl.appendChild(flap.root);
            cellFlaps.push({
              flap: flap,
              cellKey: cellEl.getAttribute('data-sf-key'),
              charIdx: cellFlaps.length,
              target: ch,
            });
          });
          rowFlaps.push(...cellFlaps);
        });

        this._sfFlaps.push(rowFlaps);
      });

      // Reduced-motion: short-circuit. Just set every flap to its target
      // instantly without animation.
      if (prefersReducedMotion) {
        this._sfFlaps.forEach(rowFlaps => {
          rowFlaps.forEach(({ flap, target }) => flap.setInstant(target));
        });
        // Save state so future re-renders can compare
        this._sfPrevFlaps = this._sfFlaps;
        return;
      }

      // Schedule the cascade.
      const ROW_STAGGER = 120;   // ms between row starts
      const COL_STAGGER = 40;    // ms between character starts within a row
      const JITTER = 15;         // ±ms per-character random jitter

      this._sfFlaps.forEach((rowFlaps, rowIdx) => {
        rowFlaps.forEach(({ flap, target }, colIdx) => {
          const baseDelay = (rowIdx * ROW_STAGGER) + (colIdx * COL_STAGGER);
          const jitter = (Math.random() * 2 - 1) * JITTER;
          const delay = Math.max(0, baseDelay + jitter);
          flap.scrambleTo(target, delay, null);
        });
      });

      // Save state so future re-renders can do diff-based animation.
      // Each entry: { flap, cellKey, charIdx, target }
      this._sfPrevFlaps = this._sfFlaps;
    }

    // Cancel any pending flap timers — used on cleanup or before re-rendering
    _cancelBoardFlaps() {
      if (!this._sfFlaps) return;
      this._sfFlaps.forEach(row => {
        row.forEach(({ flap }) => flap.cancel());
      });
    }

    _cleanupDepartureBoard() {
      if (this._boardClockTimer) { clearInterval(this._boardClockTimer); this._boardClockTimer = null; }
      if (this._boardRefreshTimer) { clearInterval(this._boardRefreshTimer); this._boardRefreshTimer = null; }
      if (this._boardFlipTimers) { this._boardFlipTimers.forEach(clearTimeout); this._boardFlipTimers = []; }
      // Cancel any in-flight Solari flap animations
      this._cancelBoardFlaps();
      this._sfFlaps = null;
      this._sfPrevFlaps = null;
      this._sfRowTargets = null;
      if (this._boardVisHandler) {
        document.removeEventListener('visibilitychange', this._boardVisHandler);
        this._boardVisHandler = null;
      }
    }
    /* ═══════════════════════════════════════════════════════════════════
       END DEPARTURE-BOARD TEMPLATE METHODS
       ═══════════════════════════════════════════════════════════════════ */

    update(newConfig) {
      // Clean up resources from any active templates before tearing down DOM
      this._cleanupCarousel();
      this._cleanupDepartureBoard();

      // Detect template change so we know whether to reset board state
      const prevTemplate = this.cfg && this.cfg.template;
      this.cfg = this._defaults(Object.assign({}, this.cfg, newConfig));
      // If template changed away from or to departure-board, drop the cached
      // airport so detection happens fresh next time
      if (prevTemplate !== this.cfg.template) {
        this._boardAirport = null;
        this._boardWired = false;
      }

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
