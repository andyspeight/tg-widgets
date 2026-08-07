/* ============================================================================
 * widget-offer-builder.js  ·  Travelgenix Widget Suite
 * Special Offer Builder — the creation form (v0.1.0)
 *
 * An embeddable, shadow-DOM widget that lets a travel agent build a single
 * special offer by filling a simple form, optionally drafted for them by AI
 * from a plain-English description. This file is ONLY the form: it collects
 * and validates the offer, then fires a `tg-offer-created` event with the
 * structured offer object. The card output and the public offer page are
 * deliberately not built yet (see roadmap), so on submit the widget shows a
 * success panel and hands the data back to the host.
 *
 * Embed:
 *   <div data-tg-widget="offer-builder" data-tg-id="YOUR_WIDGET_ID"></div>
 * or inline (demo / preview):
 *   <div data-tg-widget="offer-builder" data-tg-config='{...}'></div>
 *
 * Conventions match widget-offers.js: IIFE, Shadow DOM, scoped --tgo-* tokens,
 * theme + brand config, CSP-clean (no inline handlers), auto-init.
 * ========================================================================== */
(function () {
  'use strict';

  const VERSION = '0.1.2';

  // Resolve the API base off THIS script's origin so a remote-config embed on a
  // customer domain does not fetch the customer's own '/api/...' (404 → blank).
  function resolveApiBase() {
    if (typeof window === 'undefined') return '/api/widget-config';
    if (window.__TG_WIDGET_API__) return window.__TG_WIDGET_API__;
    try {
      const me = document.currentScript;
      if (me && me.src) return new URL(me.src).origin + '/api/widget-config';
      const scripts = document.getElementsByTagName('script');
      for (let i = scripts.length - 1; i >= 0; i--) {
        const s = scripts[i].src || '';
        if (/\/widget-offer-builder\.js(\?|$|#)/.test(s)) return new URL(s).origin + '/api/widget-config';
      }
    } catch (e) { /* fall through */ }
    return '/api/widget-config';
  }
  const API_BASE = resolveApiBase();

  // ── Small helpers ─────────────────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function currencySymbol(code) {
    return { GBP: '£', EUR: '€', USD: '$', AUD: '$', CAD: '$' }[code] || '£';
  }
  // Build an <option> list, marking `selected` when it matches.
  function options(list, selected) {
    return list.map(function (o) {
      const v = typeof o === 'string' ? o : o.value;
      return '<option' + (v === selected ? ' selected' : '') + '>' + esc(v) + '</option>';
    }).join('');
  }

  // Lazy-load the Vercel Blob client SDK (ESM from CDN — widgets have no
  // bundler). Cached after first load. Mirrors editor-quote-pdf.html.
  let _blobClient = null;
  function getBlobClient() {
    if (_blobClient) return Promise.resolve(_blobClient);
    return import('https://esm.sh/@vercel/blob@0.27.0/client').then(function (m) { _blobClient = m; return m; });
  }
  // Accept only plain http(s) image URLs with no characters that could break out
  // of a CSS url('…') context. Uploaded Blob URLs and pasted links both pass here
  // before we ever interpolate them into a style attribute.
  function safePhotoUrl(u) {
    u = String(u == null ? '' : u).trim();
    if (!/^https?:\/\//i.test(u)) return '';
    if (/[\s"'()<>\\]/.test(u)) return '';
    if (u.length > 600) return '';
    return u;
  }
  function safeFileName(name) {
    const base = String(name || 'photo').replace(/[^a-zA-Z0-9._ -]/g, '').trim().slice(0, 80) || 'photo';
    return base;
  }

  // ── Default option lists (host-overridable via config) ────────────────────
  const OFFER_TYPES = [
    'Package holiday (flight + hotel)', 'Hotel / accommodation only', 'Flight only',
    'City break', 'Cruise', 'Escorted tour', 'Multi-centre', 'Ski holiday',
    'Rail holiday', 'Excursion / day trip'
  ];
  const HOLIDAY_STYLES = [
    'All inclusive', 'Beach & resort', 'Family', 'Adults only', 'Luxury',
    'Honeymoon', 'Adventure', 'Culture & sightseeing'
  ];
  const STAR_RATINGS = ['5 star', '4 star', '3 star', 'Unrated / villa'];
  const BOARD_BASES = ['All inclusive', 'Full board', 'Half board', 'Bed & breakfast', 'Room only', 'Self catering'];
  const DATE_MODES = ['Selected dates in a period', 'Fixed departure date', 'Flexible / call for dates'];
  const FLIGHT_TYPES = ['Direct', 'Connecting', 'Not included'];
  const PRICE_BASES = ['per person', 'per couple', 'per night', 'total holiday price'];
  // Type-specific option lists, used by the per-type field layouts below.
  const CRUISE_CABINS = ['Inside', 'Ocean view', 'Balcony', 'Suite'];
  const CRUISE_FLIGHTS = ['Flights included', 'Cruise only', 'Fly-cruise'];
  const FLIGHT_CLASSES = ['Economy', 'Premium economy', 'Business', 'First'];
  const RAIL_CLASSES = ['Standard', 'First class', 'Sleeper', 'Observation car'];
  const BADGES = ['Save', 'Last minute', 'Exclusive', 'Best seller', 'Selling fast', 'Free child place', 'No badge'];
  const PROTECTIONS = ['ATOL protected', 'ABTA member', 'Both', 'Neither'];
  const DEFAULT_INCLUDES = [
    'Return flights', 'Airport transfers', '23kg luggage', 'All meals & drinks',
    'ABTA / ATOL protection', 'Rep service', 'Kids stay free', 'Free cancellation'
  ];
  const DEFAULT_TAGS = [
    'Family friendly', 'Adults only', 'Beachfront', 'Honeymoon', 'Last minute',
    'Early bird', 'Spa', 'Kids club', 'Swim-up rooms'
  ];

  // ── Long-text content sections ────────────────────────────────────────────
  // Which appear depends on the offer type (TYPE_CONTENT below), so a cruise
  // talks about the ship and its ports and a hotel about the hotel and resort.
  // Each is optional; a blank one simply won't appear on the offer page. The
  // `description` key is the existing overview field, kept for back-compat.
  const CONTENT_SECTIONS = {
    description: { label: 'Overview',              hint: 'The headline write-up near the top of the offer page.', ph: 'A warm, plain paragraph or two on why this deal is worth booking.' },
    hotelDesc:   { label: 'About the hotel',       hint: 'The property itself: rooms, pools, restaurants, the feel of the place.', ph: 'Describe the hotel and what makes it special...' },
    resortDesc:  { label: 'About the resort',      hint: 'The resort or area around the hotel: beaches, the town, what is nearby.', ph: 'Describe the resort or area...' },
    countryDesc: { label: 'About the country',     hint: 'A short guide to the destination: climate, culture, why go.', ph: 'Describe the destination...' },
    shipDesc:    { label: 'About the ship',        hint: 'The cruise ship: cabins, dining, bars, pools, entertainment.', ph: 'Describe the ship...' },
    itinerary:   { label: 'Itinerary / ports of call', hint: 'Where it goes, port by port or day by day.', ph: 'List the ports or the day-by-day plan...' },
    highlights:  { label: 'Highlights',            hint: 'The stand-out moments and included excursions.', ph: 'The highlights of the trip...' },
    skiArea:     { label: 'The resort & ski area', hint: 'The slopes, the lifts, ski school and après.', ph: 'Describe the ski resort and the area...' }
  };
  // Offer type → the content sections shown, in order. Anything not listed uses _default.
  const TYPE_CONTENT = {
    'Cruise':               ['description', 'shipDesc', 'itinerary', 'countryDesc'],
    'Escorted tour':        ['description', 'itinerary', 'highlights', 'countryDesc'],
    'Multi-centre':         ['description', 'itinerary', 'countryDesc'],
    'Rail holiday':         ['description', 'itinerary', 'countryDesc'],
    'Ski holiday':          ['description', 'skiArea', 'hotelDesc', 'countryDesc'],
    'Flight only':          ['description'],
    'Excursion / day trip': ['description', 'highlights'],
    'City break':           ['description', 'hotelDesc', 'resortDesc', 'countryDesc'],
    _default:               ['description', 'hotelDesc', 'resortDesc', 'countryDesc']
  };
  function contentKeysFor(type) { return TYPE_CONTENT[type] || TYPE_CONTENT._default; }

  // ── Type-aware structured fields ──────────────────────────────────────────
  // The two field sections between "The basics" and "Price" change with the
  // offer type, so a cruise asks for the ship, the cabin and the ports and a
  // flight-only asks for the route and cabin class, not a hotel and a board
  // basis. Each type maps to exactly two sections (a "where" block and a core
  // block) so the numbering (2 and 3) stays put. A key not in FIELDS below, or
  // a type not in TYPE_FORM, falls back sensibly.
  //
  // FIELDS: the base spec for each field key. kind: 'text' | 'select' | 'num'
  // (number with a unit suffix) | 'money'. list is the option set for selects,
  // suffix the unit for 'num'. Layout entries may override label/ph/list.
  const FIELDS = {
    country:      { label: 'Country',              kind: 'text',   ph: 'Mexico' },
    region:       { label: 'Region / area',        kind: 'text',   ph: 'Riviera Maya' },
    resort:       { label: 'Resort / city',        kind: 'text',   ph: 'Costa Mujeres, Cancun' },
    destination:  { label: 'Destination',          kind: 'text',   ph: 'Cancun (CUN)' },
    origin:       { label: 'Departure airport(s)', kind: 'text',   ph: 'London Gatwick, Manchester' },
    departurePort:{ label: 'Departure port',       kind: 'text',   ph: 'Southampton' },
    station:      { label: 'Departure station',    kind: 'text',   ph: 'London St Pancras' },
    property:     { label: 'Property name',         kind: 'text',   ph: 'Riu Palace Costa Mujeres' },
    shipName:     { label: 'Ship',                  kind: 'text',   ph: 'Wonder of the Seas' },
    cruiseLine:   { label: 'Cruise line',           kind: 'text',   ph: 'Royal Caribbean' },
    operator:     { label: 'Tour operator',         kind: 'text',   ph: 'Riviera Travel' },
    railOperator: { label: 'Rail operator',         kind: 'text',   ph: 'Eurostar, Belmond' },
    stars:        { label: 'Star rating',           kind: 'select', list: STAR_RATINGS },
    board:        { label: 'Board basis',           kind: 'select', list: BOARD_BASES },
    cabinType:    { label: 'Cabin',                 kind: 'select', list: CRUISE_CABINS },
    cabinClass:   { label: 'Cabin class',           kind: 'select', list: FLIGHT_CLASSES },
    railClass:    { label: 'Class',                 kind: 'select', list: RAIL_CLASSES },
    nights:       { label: 'Duration',              kind: 'num',    ph: '7', suffix: 'nights' },
    days:         { label: 'Duration',              kind: 'num',    ph: '1', suffix: 'days' },
    groupSize:    { label: 'Group size',            kind: 'text',   ph: 'Max 24 guests' },
    datemode:     { label: 'Travel dates',          kind: 'select', list: DATE_MODES },
    period:       { label: 'Travel period',         kind: 'text',   ph: 'Sep 2026 to Apr 2027' },
    airline:      { label: 'Airline',               kind: 'text',   ph: 'TUI Airways' },
    flighttype:   { label: 'Flights',               kind: 'select', list: FLIGHT_TYPES }
  };

  // Each type → [ whereSection, coreSection ]. A section is
  // { h: heading, hint, keys: [ 'key' | { key, label?, ph?, list? } ] }.
  const TYPE_FORM = {
    'Package holiday (flight + hotel)': [
      { h: 'Where & from where', hint: 'Destination plus the departure points this price is valid from.', keys: ['country', 'region', 'resort', 'origin'] },
      { h: 'Stay & travel', hint: 'The property, the flights and how long the holiday is.', keys: ['property', 'stars', 'board', 'nights', 'datemode', 'period', 'airline', 'flighttype'] }
    ],
    'Hotel / accommodation only': [
      { h: 'Where', hint: 'The destination for this stay.', keys: ['country', 'region', 'resort'] },
      { h: 'The stay', hint: 'The property, the board and how long the stay is.', keys: ['property', 'stars', 'board', 'nights', 'datemode', 'period'] }
    ],
    'Flight only': [
      { h: 'Route', hint: 'Where the flights go from and to.', keys: ['origin', { key: 'destination', label: 'Destination airport(s)', ph: 'Cancun (CUN)' }] },
      { h: 'The flights', hint: 'The airline, the type of flight and the cabin.', keys: ['airline', { key: 'flighttype', label: 'Flight type' }, 'cabinClass', 'datemode', 'period'] }
    ],
    'City break': [
      { h: 'Where & from where', hint: 'The city plus the departure points this price is valid from.', keys: ['country', { key: 'resort', label: 'City', ph: 'Rome' }, 'origin'] },
      { h: 'Stay & travel', hint: 'The hotel, the flights and how many nights.', keys: ['property', 'stars', 'board', 'nights', 'datemode', 'period', 'airline', 'flighttype'] }
    ],
    'Cruise': [
      { h: 'Sailing & from where', hint: 'The sailing area and where it leaves from.', keys: [{ key: 'region', label: 'Sailing area', ph: 'Western Mediterranean' }, 'departurePort', { key: 'origin', label: 'Flights from', ph: 'London Heathrow' }] },
      { h: 'The ship & voyage', hint: 'The ship, the cabin and how long you are at sea.', keys: ['cruiseLine', 'shipName', 'cabinType', { key: 'nights', label: 'Nights at sea' }, 'datemode', 'period', { key: 'flighttype', label: 'Flights', list: CRUISE_FLIGHTS }] }
    ],
    'Escorted tour': [
      { h: 'Where & from where', hint: 'The countries the tour covers and the departure points.', keys: [{ key: 'country', label: 'Countries', ph: 'Italy' }, { key: 'region', label: 'Route / area', ph: 'Rome, Florence, Venice' }, 'origin'] },
      { h: 'The tour', hint: 'Who runs it, how long it is and the flights.', keys: ['operator', { key: 'nights', label: 'Duration', suffix: 'days' }, 'groupSize', 'datemode', 'period', 'airline', 'flighttype'] }
    ],
    'Multi-centre': [
      { h: 'Where & from where', hint: 'The centres this holiday combines and the departure points.', keys: [{ key: 'country', label: 'Countries', ph: 'Thailand' }, { key: 'region', label: 'Centres', ph: 'Bangkok, Phuket' }, 'origin'] },
      { h: 'Stay & travel', hint: 'The stay, the flights and how long in total.', keys: ['property', 'stars', 'board', { key: 'nights', label: 'Total nights' }, 'datemode', 'period', 'airline', 'flighttype'] }
    ],
    'Ski holiday': [
      { h: 'Where & from where', hint: 'The ski resort and the departure points.', keys: ['country', { key: 'region', label: 'Ski area', ph: 'Three Valleys' }, { key: 'resort', label: 'Ski resort', ph: 'Meribel' }, 'origin'] },
      { h: 'Stay & travel', hint: 'The property, the board, the flights and how long.', keys: ['property', 'stars', 'board', 'nights', 'datemode', 'period', 'airline', 'flighttype'] }
    ],
    'Rail holiday': [
      { h: 'Where & from where', hint: 'The route and where it starts.', keys: [{ key: 'country', label: 'Countries', ph: 'Switzerland' }, { key: 'region', label: 'Route', ph: 'Glacier Express' }, 'station'] },
      { h: 'The journey', hint: 'The operator, the class and how long it is.', keys: ['railOperator', 'railClass', { key: 'nights', label: 'Duration' }, 'datemode', 'period'] }
    ],
    'Excursion / day trip': [
      { h: 'Where', hint: 'Where the trip takes place.', keys: ['country', 'region', { key: 'resort', label: 'Location', ph: 'Pompeii' }] },
      { h: 'The trip', hint: 'How long it lasts and when it runs.', keys: [{ key: 'days', label: 'Duration' }, { key: 'datemode', label: 'Dates' }, 'period'] }
    ]
  };
  function formSectionsFor(type) { return TYPE_FORM[type] || TYPE_FORM['Package holiday (flight + hotel)']; }
  // Resolve a layout entry (string key or override object) to a full spec.
  function fieldSpec(entry) {
    const key = typeof entry === 'string' ? entry : entry.key;
    const base = FIELDS[key] || { label: key, kind: 'text', ph: '' };
    const spec = { key: key, label: base.label, kind: base.kind, ph: base.ph, list: base.list, suffix: base.suffix };
    if (entry && typeof entry === 'object') {
      if (entry.label != null) spec.label = entry.label;
      if (entry.ph != null) spec.ph = entry.ph;
      if (entry.list != null) spec.list = entry.list;
      if (entry.suffix != null) spec.suffix = entry.suffix;
    }
    return spec;
  }
  // Every structured key that can appear in the form, for prefill/preserve.
  const ALL_FIELD_KEYS = Object.keys(FIELDS);

  // The lean, type-specific columns the dashboard "Sheet" (quick loader) shows
  // inline per row — the differentiators, not every field. The Sheet also shows
  // Type, Title, Country, Travel dates, Price, Was, Show from/until for all
  // types. Exposed via window.TGOfferBuilderWidget.offerMeta so the editor keeps
  // a single source of truth for the type -> field mapping.
  const SHEET_TYPE_COLS = {
    'Package holiday (flight + hotel)': ['resort', 'nights', 'board'],
    'Hotel / accommodation only':      ['resort', 'nights', 'board'],
    'Flight only':                     ['destination', 'cabinClass'],
    'City break':                      ['resort', 'nights', 'board'],
    'Cruise':                          ['cruiseLine', 'shipName', 'cabinType', 'nights'],
    'Escorted tour':                   ['operator', 'nights'],
    'Multi-centre':                    ['resort', 'nights', 'board'],
    'Ski holiday':                     ['resort', 'nights', 'board'],
    'Rail holiday':                    ['railOperator', 'railClass', 'nights'],
    'Excursion / day trip':            ['resort'],
    _default:                          ['resort', 'nights', 'board']
  };
  // A stable master order for the union of type-specific sheet columns, plus
  // short labels for the header (the full form labels are longer).
  const SHEET_COL_ORDER = ['resort', 'board', 'nights', 'destination', 'cabinClass', 'cruiseLine', 'shipName', 'cabinType', 'operator', 'railOperator', 'railClass'];
  const SHEET_COL_LABELS = {
    resort: 'Resort', board: 'Board', nights: 'Nights', destination: 'Destination',
    cabinClass: 'Cabin class', cruiseLine: 'Cruise line', shipName: 'Ship',
    cabinType: 'Cabin', operator: 'Operator', railOperator: 'Rail operator', railClass: 'Class'
  };
  function sheetColsFor(type) { return SHEET_TYPE_COLS[type] || SHEET_TYPE_COLS._default; }

  // ── Audience languages (content layer, Layer 2) ───────────────────────────
  // English is always the source. The agent toggles the languages their
  // customers read, then "Translate" sends the offer's author content to
  // /api/offer-translate and stores the per-language overlay on offer.i18n.
  // Keep this list in step with api/offer-translate.js LANG_NAMES and the
  // offer widgets' MESSAGES. Prices, ATOL/ABTA wording, place and brand names
  // are never translated (enforced server-side; the UI copy says so too).
  const AUDIENCE_LANGS = [
    { code: 'fr', label: 'French' },
    { code: 'de', label: 'German' },
    { code: 'es', label: 'Spanish' },
    { code: 'it', label: 'Italian' },
    { code: 'ro', label: 'Romanian' }
  ];

  // Canned AI draft used for previews/demos when cfg.aiMock is true. The real
  // build posts the description to cfg.aiEndpoint and uses its response.
  const DEMO_DRAFT = {
    fields: {
      title: '7 nights all inclusive in Cancun',
      type: 'Package holiday (flight + hotel)',
      style: 'All inclusive',
      teaser: 'Beachfront five star on the white sands of Costa Mujeres',
      country: 'Mexico', region: 'Riviera Maya', resort: 'Costa Mujeres, Cancun',
      origin: 'London Gatwick', property: 'Riu Palace Costa Mujeres', stars: '5 star',
      board: 'All inclusive', nights: '7', datemode: 'Selected dates in a period',
      period: 'Sep 2026 to Apr 2027', airline: 'TUI Airways', flighttype: 'Direct',
      price: '899', basis: 'per person', was: '1299', deposit: '60',
      badge: 'Save', urgency: 'Only 4 left at this price',
      bookby: '31 July 2026', avail: 'Limited rooms at this price',
      mapAddress: 'Costa Mujeres, Cancun, Mexico', mapLat: '21.0419', mapLng: '-86.8126', mapStyle: 'streets',
      video: 'https://www.youtube.com/watch?v=Scxs7L0vhZ4',
      description: 'Wake up to white sand and turquoise sea at the Riu Palace Costa Mujeres, a five star beachfront resort on one of the quietest stretches of the Mexican Caribbean. This all inclusive deal covers your direct flights from Gatwick plus every meal, drink and snack once you arrive.\n\nWith four pools, a spa, a kids club and a string of restaurants, it suits couples and families alike. Children stay free on selected dates. Book by 31 July to lock in the saving.'
    },
    includes: ['Return flights', 'Airport transfers', '23kg luggage', 'All meals & drinks', 'ABTA / ATOL protection', 'Rep service', 'Kids stay free'],
    tags: ['Family friendly', 'Beachfront', 'Kids club']
  };

  // ── Scoped styles (shadow DOM, --tgo-* tokens shared with widget-offers) ──
  const STYLES = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .ob-root {
      --tgo-brand: #1B2B5B; --tgo-accent: #00B4D8; --tgo-accent-hover: #0096B7;
      --tgo-accent-soft: #E0F4FA; --tgo-ai: #7C3AED; --tgo-ai-soft: #F3E8FF;
      --tgo-bg: transparent; --tgo-card: #FFFFFF; --tgo-card-alt: #FAFBFC;
      --tgo-text: #0F172A; --tgo-sub: #475569; --tgo-muted: #94A3B8;
      --tgo-border: #E2E8F0; --tgo-success: #10B981; --tgo-success-soft: #D1FAE5;
      --tgo-warn: #D97706; --tgo-error: #DC2626; --tgo-radius: 14px;
      --tgo-shadow: 0 1px 2px rgba(15,23,42,0.04);
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      color: var(--tgo-text); line-height: 1.5; background: var(--tgo-bg);
      width: 100%; max-width: 920px; margin: 0 auto; display: block;
    }
    .ob-root[data-theme="dark"] {
      --tgo-card: #1E293B; --tgo-card-alt: #0F172A; --tgo-text: #F1F5F9;
      --tgo-sub: #94A3B8; --tgo-muted: #64748B; --tgo-border: #334155;
      --tgo-accent-soft: rgba(56,189,248,0.12); --tgo-ai-soft: rgba(124,58,237,0.18);
    }
    .ob-head h2 { font-size: 24px; font-weight: 800; margin: 0 0 6px; letter-spacing: -0.4px; }
    .ob-head p { color: var(--tgo-sub); font-size: 15px; margin: 0 0 22px; }

    /* AI box */
    .ob-ai {
      background: linear-gradient(135deg, var(--tgo-ai-soft) 0%, var(--tgo-accent-soft) 100%);
      border: 1px solid var(--tgo-ai-soft); border-radius: var(--tgo-radius);
      padding: 18px; margin-bottom: 22px;
    }
    .ob-ai-head { display: flex; align-items: center; gap: 10px; margin-bottom: 4px; }
    .ob-ai-spark {
      width: 30px; height: 30px; border-radius: 8px; flex-shrink: 0; color: #fff;
      background: linear-gradient(135deg, var(--tgo-ai), var(--tgo-accent));
      display: flex; align-items: center; justify-content: center; font-size: 16px;
    }
    .ob-ai-head h3 { margin: 0; font-size: 16px; font-weight: 700; }
    .ob-ai-sub { font-size: 13px; color: var(--tgo-sub); margin: 0 0 14px 40px; }
    .ob-ai-row { display: flex; gap: 10px; align-items: stretch; }
    .ob-ai-row textarea {
      flex: 1; resize: vertical; min-height: 56px; border: 1px solid var(--tgo-border);
      border-radius: 10px; padding: 12px 14px; font: inherit; font-size: 14px;
      background: var(--tgo-card); color: var(--tgo-text);
    }
    .ob-ai-row textarea:focus { outline: 2px solid var(--tgo-ai); border-color: var(--tgo-ai); }
    .ob-ai-go {
      background: var(--tgo-ai); color: #fff; border: 0; border-radius: 10px;
      padding: 0 22px; font: inherit; font-weight: 700; font-size: 14px; cursor: pointer;
      white-space: nowrap; display: inline-flex; align-items: center; gap: 8px;
    }
    .ob-ai-go:hover { background: #6d28d9; }
    .ob-ai-go:disabled { opacity: 0.6; cursor: default; }
    .ob-ai-status { font-size: 13px; font-weight: 600; margin: 12px 0 0 40px; display: none; }
    .ob-ai-status.show { display: block; }
    .ob-ai-status.ok { color: var(--tgo-success); }
    .ob-ai-status.err { color: var(--tgo-error); }
    .ob-ai-status.busy { color: var(--tgo-ai); }

    /* Audience languages */
    .ob-langs { display: flex; flex-direction: column; gap: 2px; }
    .ob-lang-row {
      display: flex; align-items: center; gap: 12px; padding: 9px 0;
      border-bottom: 1px solid var(--tgo-border);
    }
    .ob-lang-row:last-child { border-bottom: 0; }
    .ob-lang-main { flex: 1; min-width: 0; }
    .ob-lang-name { font-size: 14px; font-weight: 600; }
    .ob-lang-status { font-size: 12px; margin-top: 2px; }
    .ob-lang-status.muted { color: var(--tgo-muted); }
    .ob-lang-status.ok { color: var(--tgo-success); }
    .ob-lang-status.warn { color: var(--tgo-warn); }
    .ob-lang-toggle {
      width: 40px; height: 22px; position: relative; flex-shrink: 0;
      background: var(--tgo-border); border: 0; border-radius: 999px; padding: 0; cursor: pointer;
      transition: background .15s ease;
    }
    .ob-lang-toggle::before {
      content: ''; position: absolute; top: 2px; left: 2px; width: 18px; height: 18px;
      border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgba(15,23,42,0.2);
      transition: transform .2s ease;
    }
    .ob-lang-toggle[aria-pressed="true"] { background: var(--tgo-accent); }
    .ob-lang-toggle[aria-pressed="true"]::before { transform: translateX(18px); }
    .ob-lang-actions { margin-top: 14px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .ob-lang-go {
      background: var(--tgo-accent); color: #fff; border: 0; border-radius: 10px;
      padding: 10px 18px; font: inherit; font-weight: 700; font-size: 14px; cursor: pointer;
      display: inline-flex; align-items: center; gap: 8px;
    }
    .ob-lang-go:hover { background: var(--tgo-accent-hover); }
    .ob-lang-go:disabled { opacity: 0.55; cursor: default; }
    .ob-lang-go-status { font-size: 13px; font-weight: 600; }
    .ob-lang-go-status.busy { color: var(--tgo-accent-hover); }
    .ob-lang-go-status.ok { color: var(--tgo-success); }
    .ob-lang-go-status.err { color: var(--tgo-error); }
    .ob-lang-spin { animation: ob-spin 1s linear infinite; display: inline-block; }
    @keyframes ob-spin { to { transform: rotate(360deg); } }

    /* Fieldsets */
    .ob-fs {
      background: var(--tgo-card); border: 1px solid var(--tgo-border);
      border-radius: var(--tgo-radius); padding: 18px; margin-bottom: 18px;
      box-shadow: var(--tgo-shadow);
    }
    .ob-fs h4 { font-size: 15px; font-weight: 700; margin: 0 0 3px; }
    .ob-fs .hint { font-size: 12px; color: var(--tgo-muted); margin: 0 0 14px; }
    .ob-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 14px; }
    .ob-field { display: flex; flex-direction: column; gap: 5px; }
    .ob-field.wide { grid-column: 1 / -1; }
    .ob-field label {
      font-size: 11px; color: var(--tgo-sub); font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.5px; display: flex; align-items: center; gap: 6px;
    }
    .ob-field .opt { text-transform: none; color: var(--tgo-muted); font-weight: 500; letter-spacing: 0; }
    .ob-field input, .ob-field select, .ob-field textarea {
      padding: 9px 11px; border: 1px solid var(--tgo-border); border-radius: 9px;
      font: inherit; font-size: 14px; background: var(--tgo-card); color: var(--tgo-text); width: 100%;
    }
    .ob-field textarea { resize: vertical; min-height: 70px; }
    .ob-field input:focus, .ob-field select:focus, .ob-field textarea:focus {
      outline: 2px solid var(--tgo-accent); outline-offset: 1px; border-color: var(--tgo-accent);
    }
    .ob-field.invalid input, .ob-field.invalid select { border-color: var(--tgo-error); }
    .ob-err { font-size: 11px; color: var(--tgo-error); font-weight: 600; display: none; }
    .ob-field.invalid .ob-err { display: block; }
    .ob-save-error { display: none; margin-top: 12px; padding: 11px 14px; border-radius: var(--tgo-radius);
      font-size: 13px; font-weight: 600; line-height: 1.45; color: var(--tgo-error);
      border: 1px solid var(--tgo-error); background: rgba(220, 38, 38, 0.08); }
    .ob-prefix { position: relative; }
    .ob-prefix .sym { position: absolute; left: 11px; top: 50%; transform: translateY(-50%); color: var(--tgo-muted); pointer-events: none; }
    .ob-prefix input { padding-left: 24px; }
    .ob-suffix { position: absolute; right: 11px; top: 50%; transform: translateY(-50%); color: var(--tgo-muted); font-size: 13px; pointer-events: none; }

    /* AI-filled marker */
    .ob-field.ai input, .ob-field.ai select, .ob-field.ai textarea {
      border-left: 3px solid var(--tgo-ai); background: color-mix(in srgb, var(--tgo-ai) 4%, var(--tgo-card));
    }
    .ob-chip {
      font-size: 9px; font-weight: 700; letter-spacing: 0.4px; text-transform: uppercase;
      background: var(--tgo-ai-soft); color: var(--tgo-ai); padding: 2px 6px; border-radius: 999px;
    }

    /* Chips + includes */
    .ob-chips { display: flex; flex-wrap: wrap; gap: 8px; }
    .ob-toggle {
      border: 1px solid var(--tgo-border); background: var(--tgo-card); color: var(--tgo-sub);
      border-radius: 999px; padding: 7px 14px; font: inherit; font-size: 13px; cursor: pointer;
    }
    .ob-toggle:hover { border-color: var(--tgo-accent); }
    .ob-toggle.on { background: var(--tgo-accent-soft); border-color: var(--tgo-accent); color: var(--tgo-accent-hover); font-weight: 600; }
    .ob-toggle.on::before { content: '✓ '; }
    .ob-incl { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; }
    .ob-incl label {
      display: flex; align-items: center; gap: 9px; font-size: 14px; padding: 9px 12px;
      border: 1px solid var(--tgo-border); border-radius: 9px; background: var(--tgo-card-alt); cursor: pointer;
    }
    .ob-incl label.on { background: var(--tgo-success-soft); border-color: var(--tgo-success); }
    .ob-incl input { width: auto; }

    /* Free-text include pills */
    .ob-pills { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; min-height: 4px; }
    .ob-pill { display: inline-flex; align-items: center; gap: 8px; padding: 6px 8px 6px 12px; border-radius: 999px;
      background: var(--tgo-success-soft); border: 1px solid var(--tgo-success); color: var(--tgo-ink); font-size: 13.5px; font-weight: 500; }
    .ob-pill button { border: 0; background: rgba(0,0,0,0.06); color: inherit; width: 18px; height: 18px; border-radius: 50%;
      cursor: pointer; font-size: 14px; line-height: 1; display: inline-flex; align-items: center; justify-content: center; }
    .ob-pill button:hover { background: rgba(0,0,0,0.14); }
    .ob-pill-empty { font-size: 13px; color: var(--tgo-muted); }
    .ob-pill-add { display: flex; gap: 8px; margin-bottom: 12px; }
    .ob-pill-input { flex: 1; padding: 10px 12px; border: 1px solid var(--tgo-border); border-radius: 9px; font: inherit; font-size: 14px;
      background: var(--tgo-card); color: var(--tgo-ink); }
    .ob-pill-input:focus { outline: 2px solid var(--tgo-accent); border-color: var(--tgo-accent); }
    .ob-pill-suggest { display: flex; flex-wrap: wrap; gap: 7px; }
    .ob-chip-suggest { border: 1px dashed var(--tgo-border); background: var(--tgo-card-alt); color: var(--tgo-sub); border-radius: 999px;
      padding: 5px 11px; font: inherit; font-size: 12.5px; cursor: pointer; }
    .ob-chip-suggest:hover { border-color: var(--tgo-accent); color: var(--tgo-accent-hover); }

    /* Type-aware long-text content sections */
    .ob-content { display: flex; flex-direction: column; gap: 20px; }
    .ob-content-sec { border: 1px solid var(--tgo-border); border-radius: 12px; padding: 14px 14px 16px; background: var(--tgo-card-alt); }
    .ob-content-sec.ai { border-color: var(--tgo-ai); }
    .ob-content-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 4px; }
    .ob-content-head label { font-size: 14px; font-weight: 700; color: var(--tgo-ink); }
    .ob-content-hint { font-size: 12.5px; color: var(--tgo-muted); margin: 0 0 10px; line-height: 1.5; }
    .ob-content-sec textarea { width: 100%; padding: 11px 12px; border: 1px solid var(--tgo-border); border-radius: 9px; font: inherit;
      font-size: 14px; line-height: 1.6; background: var(--tgo-card); color: var(--tgo-ink); resize: vertical; min-height: 90px; }
    .ob-content-sec textarea:focus { outline: 2px solid var(--tgo-accent); border-color: var(--tgo-accent); }
    .ob-ai-write { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--tgo-ai); background: var(--tgo-ai-soft, rgba(124,58,237,0.08));
      color: var(--tgo-ai); border-radius: 8px; padding: 6px 11px; font: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer; white-space: nowrap; }
    .ob-ai-write:hover { background: var(--tgo-ai); color: #fff; }
    .ob-ai-write:disabled { opacity: 0.6; cursor: default; }
    .ob-write-status { font-size: 12px; margin-top: 8px; display: none; }
    .ob-write-status.show { display: block; }
    .ob-write-status.busy { color: var(--tgo-muted); }
    .ob-write-status.ok { color: var(--tgo-success); }
    .ob-write-status.err { color: var(--tgo-danger, #DC2626); }

    /* Photos */
    .ob-upload {
      border: 2px dashed var(--tgo-border); border-radius: 10px; padding: 22px 20px; text-align: center;
      color: var(--tgo-muted); font-size: 13px; background: var(--tgo-card-alt); cursor: pointer;
      transition: border-color .15s, background .15s;
    }
    .ob-upload b { color: var(--tgo-accent); }
    .ob-upload span { display: block; margin-top: 4px; font-size: 12px; }
    .ob-upload.drag { border-color: var(--tgo-accent); background: var(--tgo-accent-soft); color: var(--tgo-text); }
    .ob-upload.busy { opacity: 0.7; pointer-events: none; }
    .ob-url-row { display: flex; gap: 8px; margin-top: 12px; }
    .ob-url-row input { flex: 1; padding: 9px 11px; border: 1px solid var(--tgo-border); border-radius: 9px; font: inherit; font-size: 14px; background: var(--tgo-card); color: var(--tgo-text); }
    .ob-url-row input:focus { outline: 2px solid var(--tgo-accent); border-color: var(--tgo-accent); }
    .ob-url-add { white-space: nowrap; padding: 9px 18px; }
    .ob-photo-err { font-size: 12px; color: var(--tgo-error); font-weight: 600; margin: 8px 0 0; display: none; }
    .ob-photo-err.show { display: block; }
    .ob-thumbs { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 14px; }
    .ob-thumb {
      position: relative; width: 104px; height: 78px; border-radius: 9px; overflow: hidden;
      border: 1px solid var(--tgo-border); background: var(--tgo-card-alt) center/cover no-repeat;
    }
    .ob-thumb.cover { border: 2px solid var(--tgo-accent); }
    .ob-thumb-tag {
      position: absolute; left: 0; bottom: 0; font-size: 9px; font-weight: 700; letter-spacing: 0.4px;
      text-transform: uppercase; background: var(--tgo-accent); color: #fff; padding: 2px 7px; border-top-right-radius: 7px;
    }
    .ob-thumb-x {
      position: absolute; top: 4px; right: 4px; width: 22px; height: 22px; border: 0; border-radius: 50%;
      background: rgba(15,23,42,0.72); color: #fff; font-size: 13px; line-height: 1; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
    }
    .ob-thumb-x:hover { background: var(--tgo-error); }
    .ob-thumb-cover-btn {
      position: absolute; top: 4px; left: 4px; border: 0; border-radius: 6px; cursor: pointer;
      background: rgba(15,23,42,0.72); color: #fff; font-size: 10px; font-weight: 600; padding: 3px 7px;
    }
    .ob-thumb-cover-btn:hover { background: var(--tgo-accent); }
    .ob-thumb.cover .ob-thumb-cover-btn { display: none; }

    /* Actions */
    .ob-actions { display: flex; gap: 12px; justify-content: flex-end; flex-wrap: wrap; margin-top: 4px; }
    .ob-btn {
      border-radius: 10px; padding: 12px 22px; font: inherit; font-weight: 700; font-size: 14px;
      cursor: pointer; border: 1px solid var(--tgo-border); background: var(--tgo-card); color: var(--tgo-sub);
    }
    .ob-btn:hover { border-color: var(--tgo-accent); color: var(--tgo-text); }
    .ob-btn.primary { background: var(--tgo-accent); border-color: var(--tgo-accent); color: #fff; }
    .ob-btn.primary:hover { background: var(--tgo-accent-hover); }

    /* Success panel */
    .ob-success { text-align: center; padding: 40px 24px; }
    .ob-success .tick {
      width: 64px; height: 64px; border-radius: 50%; margin: 0 auto 16px;
      background: var(--tgo-success-soft); color: var(--tgo-success);
      display: flex; align-items: center; justify-content: center; font-size: 30px;
    }
    .ob-success h3 { font-size: 20px; font-weight: 700; margin: 0 0 6px; }
    .ob-success p { color: var(--tgo-sub); margin: 0 0 18px; }
    .ob-summary {
      text-align: left; background: var(--tgo-card-alt); border: 1px solid var(--tgo-border);
      border-radius: 10px; padding: 14px 16px; max-width: 560px; margin: 0 auto 18px;
      font-size: 13px; color: var(--tgo-sub); max-height: 220px; overflow: auto;
      white-space: pre-wrap; font-family: ui-monospace, 'JetBrains Mono', monospace;
    }
    /* Saved-offer link block on the success panel */
    .ob-saved { max-width: 560px; margin: 0 auto 16px; text-align: left; }
    .ob-saved-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: var(--tgo-muted); margin-bottom: 6px; }
    .ob-saved-row { display: flex; gap: 8px; }
    .ob-saved-link { flex: 1; min-width: 0; padding: 9px 11px; border: 1px solid var(--tgo-border); border-radius: 9px; font-size: 13px; background: var(--tgo-card-alt); color: var(--tgo-text); font-family: ui-monospace, 'JetBrains Mono', monospace; }
    .ob-saved.err { background: color-mix(in srgb, var(--tgo-error) 8%, transparent); border: 1px solid color-mix(in srgb, var(--tgo-error) 30%, transparent); border-radius: 10px; padding: 12px 14px; font-size: 13px; color: var(--tgo-text); }
    @media (max-width: 560px) { .ob-ai-row { flex-direction: column; } .ob-ai-go { padding: 12px; } .ob-saved-row { flex-wrap: wrap; } }
  `;

  // ── Widget class ──────────────────────────────────────────────────────────
  class TGOfferBuilderWidget {
    constructor(container, config) {
      this.el = container;
      // Mark the host so auto-init won't construct a second instance on a div
      // that was already wired up manually (e.g. in the demo / editor preview).
      container._tgInitialised = true;
      this.cfg = this._defaults(config);
      this.shadow = container.attachShadow({ mode: 'open' });
      this.root = null;
      this._images = []; // offer photo URLs, first is the cover
      // Content-layer translation state (Layer 2). Seeded from an existing offer
      // in _prefillOffer; carried into the save payload by _collect.
      this._i18n = {};                 // { fr: { fields, includes, tags }, … }
      this._i18nMeta = {};             // { fr: { sig, at } } — staleness tracking
      this._audienceLanguages = [];    // chosen language codes
      this._render();
    }

    _defaults(c) {
      c = c || {};
      const bool = function (v, d) { return typeof v === 'boolean' ? v : d; };
      return {
        // Branding
        theme: c.theme === 'dark' ? 'dark' : 'light',
        brandColor: c.brandColor || '',
        accentColor: c.accentColor || '',
        radius: typeof c.radius === 'number' ? c.radius : 14,

        // Copy
        title: c.title || 'Create a special offer',
        intro: c.intro || 'Fill the form yourself, or describe the deal in a sentence and let AI draft it for you. Every AI suggestion is editable before you publish.',
        submitLabel: c.submitLabel || 'Save offer',
        successHeading: c.successHeading || 'Offer captured',
        successBody: c.successBody || 'Your special offer is ready. The card and offer page come next.',

        // AI assist
        aiEnabled: bool(c.aiEnabled, true),
        aiEndpoint: c.aiEndpoint || '',           // POST { description } → { fields, includes, tags }
        aiMock: bool(c.aiMock, false),            // preview/demo only: use the canned draft
        aiPlaceholder: c.aiPlaceholder || 'e.g. 7 nights all inclusive at the Riu Palace in Cancun, flying from Gatwick, was 1299 now from 899pp, kids stay free, book by end of July',

        // Saving: when on, submit persists the offer (needs a signed-in session)
        // and shows a shareable /offer page link. Off by default (fires the
        // tg-offer-created event only).
        save: bool(c.save, false),
        saveEndpoint: c.saveEndpoint || API_BASE.replace('/widget-config', '/saved-offers'),
        offerId: c.offerId || '',                 // set when editing an existing saved offer
        offerBaseUrl: c.offerBaseUrl || '',        // optional absolute base for the shareable link

        // Photo upload: when set, the Photos section gets a real uploader that
        // streams files straight to Vercel Blob via this token route. Without it
        // only URL-paste is offered (so the unauthenticated demo still works).
        uploadEndpoint: c.uploadEndpoint || '',

        // Currency
        currency: c.currency || 'GBP',

        // Section visibility
        showDestination: bool(c.showDestination, true),
        showStayTravel: bool(c.showStayTravel, true),
        showPrice: bool(c.showPrice, true),
        showIncludes: bool(c.showIncludes, true),
        showTags: bool(c.showTags, true),
        showValidity: bool(c.showValidity, true),
        showImages: bool(c.showImages, true),
        showMap: bool(c.showMap, true),
        showDescription: bool(c.showDescription, true),
        showEnquiry: bool(c.showEnquiry, true),
        // Audience languages / translate. On by default; the host can hide it
        // (e.g. the unauthenticated demo, where translate would 401).
        showLanguages: bool(c.showLanguages, true),
        translateEndpoint: c.translateEndpoint || API_BASE.replace('/widget-config', '/offer-translate'),

        // Required fields
        requireTitle: bool(c.requireTitle, true),
        requirePrice: bool(c.requirePrice, true),

        // Editable option lists
        offerTypes: Array.isArray(c.offerTypes) && c.offerTypes.length ? c.offerTypes : OFFER_TYPES,
        includeOptions: Array.isArray(c.includeOptions) && c.includeOptions.length ? c.includeOptions : DEFAULT_INCLUDES,
        tagOptions: Array.isArray(c.tagOptions) && c.tagOptions.length ? c.tagOptions : DEFAULT_TAGS,

        // Enquiry routing defaults
        enquiryEmail: c.enquiryEmail || '',
        enquiryPhone: c.enquiryPhone || '',
        protection: c.protection || 'ATOL protected',

        // An existing offer to edit (prefills the form). Shape = builder output.
        offer: c.offer && typeof c.offer === 'object' ? c.offer : null,

        _widgetId: c._widgetId || ''
      };
    }

    // Populate the form from an existing offer (edit mode).
    _prefillOffer(offer) {
      if (!offer) return;
      const fields = (offer.fields && typeof offer.fields === 'object') ? offer.fields : offer;
      // Fill the static fields (and the type select) that are already in the DOM.
      this.root.querySelectorAll('[data-key]').forEach((el) => {
        const v = fields[el.dataset.key];
        if (v != null && v !== '') el.value = v;
      });
      // Structured fields (sections 2 & 3) are drawn by _renderFields from this
      // store; the type select above now holds the offer's type, so the right
      // set is drawn next with these values in place.
      this._fieldVals = {};
      ALL_FIELD_KEYS.forEach((k) => { if (fields[k] != null && fields[k] !== '') this._fieldVals[k] = fields[k]; });
      // Long-text sections live in a store; _renderContent draws the right set.
      this._contentVals = {};
      Object.keys(CONTENT_SECTIONS).forEach((k) => { if (fields[k] != null && fields[k] !== '') this._contentVals[k] = fields[k]; });
      // Includes are free-text pills now.
      this._includes = Array.isArray(offer.includes) ? offer.includes.slice() : [];
      const tags = Array.isArray(offer.tags) ? offer.tags : [];
      this.root.querySelectorAll('.ob-toggle').forEach((c) => {
        if (tags.indexOf(c.dataset.tag) !== -1) c.classList.add('on');
      });
      this._images = (Array.isArray(offer.images) ? offer.images : []).map(safePhotoUrl).filter(Boolean);
      this._renderThumbs();

      // Content-layer translation state. i18n holds the per-language overlays;
      // i18nMeta records the source signature each was translated from so a
      // later source edit can be flagged "Source changed — re-translate".
      this._i18n = (offer.i18n && typeof offer.i18n === 'object' && !Array.isArray(offer.i18n)) ? offer.i18n : {};
      this._i18nMeta = (offer.i18nMeta && typeof offer.i18nMeta === 'object' && !Array.isArray(offer.i18nMeta)) ? offer.i18nMeta : {};
      this._audienceLanguages = Array.isArray(offer.audienceLanguages)
        ? offer.audienceLanguages.filter((c) => AUDIENCE_LANGS.some((l) => l.code === c))
        : [];
      this._renderLanguages();
    }

    _render() {
      const cfg = this.cfg;
      const sym = currencySymbol(cfg.currency);

      this.root = document.createElement('div');
      this.root.className = 'ob-root';
      this.root.setAttribute('data-theme', cfg.theme);
      if (cfg.brandColor) this.root.style.setProperty('--tgo-brand', cfg.brandColor);
      if (cfg.accentColor) {
        this.root.style.setProperty('--tgo-accent', cfg.accentColor);
        this.root.style.setProperty('--tgo-accent-hover', cfg.accentColor);
      }
      if (cfg.radius) this.root.style.setProperty('--tgo-radius', cfg.radius + 'px');

      // The whole-offer "describe it in a sentence" draft has been replaced by a
      // "Write with AI" button on each long section (see _writeSection), so the
      // big box is gone.
      const aiBox = '';

      function field(key, label, control, opt, wide) {
        return '<div class="ob-field' + (wide ? ' wide' : '') + '" data-field="' + key + '">'
          + '<label>' + esc(label) + (opt ? ' <span class="opt">' + esc(opt) + '</span>' : '') + '</label>'
          + control
          + '<span class="ob-err">Required</span></div>';
      }
      const input = function (key, ph, type) {
        return '<input type="' + (type || 'text') + '" data-key="' + key + '" placeholder="' + esc(ph || '') + '" />';
      };
      const select = function (key, list, sel) {
        return '<select data-key="' + key + '">' + options(list, sel) + '</select>';
      };
      const money = function (key, ph) {
        return '<div class="ob-prefix"><span class="sym">' + sym + '</span>' + input(key, ph, 'number') + '</div>';
      };

      // ── Section: basics (always shown) ──
      let html = '<div class="ob-fs"><h4>1 · The basics</h4><p class="hint">What the offer is and the headline that grabs attention.</p><div class="ob-grid">'
        + field('title', 'Offer title', input('title', 'e.g. 7 nights all inclusive in Cancun'), '', true)
        + field('type', 'Offer type', select('type', cfg.offerTypes, cfg.offerTypes[0]))
        + field('style', 'Holiday style', select('style', HOLIDAY_STYLES, HOLIDAY_STYLES[0]))
        + field('teaser', 'Card teaser', input('teaser', 'One line shown on the card'), '(shown on the card)', true)
        + '</div></div>';

      // Sections 2 and 3 are drawn by _renderFields() and swap with the offer
      // type, so a cruise asks for the ship and the ports and a flight-only for
      // the route and cabin class. (showDestination / showStayTravel still gate
      // whether the block appears at all, for anyone who turned it off.)
      if (cfg.showDestination || cfg.showStayTravel) {
        html += '<div class="ob-fields" data-fields></div>';
      }

      if (cfg.showPrice) {
        html += '<div class="ob-fs"><h4>4 · Price</h4><p class="hint">The lead-in price and the saving you want to shout about.</p><div class="ob-grid">'
          + field('price', 'Price from', money('price', '899'))
          + field('basis', 'Price basis', select('basis', PRICE_BASES, PRICE_BASES[0]))
          + field('was', 'Was price', money('was', '1299'), '(optional)')
          + field('deposit', 'Deposit from', money('deposit', '60'), '(optional)')
          + '</div></div>';
      }

      if (cfg.showIncludes) {
        html += '<div class="ob-fs"><h4>5 · What\'s included</h4><p class="hint">Type what the price covers and press Enter. Tap a suggestion to add it. Add anything you like.</p>'
          + '<div class="ob-pills" data-pills></div>'
          + '<div class="ob-pill-add"><input type="text" class="ob-pill-input" placeholder="e.g. Return flights, free room upgrade, kids stay free" /><button type="button" class="ob-btn ob-pill-go">Add</button></div>'
          + '<div class="ob-pill-suggest">'
          + cfg.includeOptions.map(function (i) { return '<button type="button" class="ob-chip-suggest" data-suggest="' + esc(i) + '">+ ' + esc(i) + '</button>'; }).join('')
          + '</div></div>';
      }

      if (cfg.showTags) {
        html += '<div class="ob-fs"><h4>6 · Tags &amp; promo badge</h4><p class="hint">Tags help people filter. The badge is the coloured flash on the card.</p>'
          + '<div class="ob-field" style="margin-bottom:14px"><label>Tags</label><div class="ob-chips">'
          + cfg.tagOptions.map(function (t) { return '<button type="button" class="ob-toggle" data-tag="' + esc(t) + '">' + esc(t) + '</button>'; }).join('')
          + '</div></div><div class="ob-grid">'
          + field('badge', 'Promo badge', select('badge', BADGES, BADGES[0]))
          + field('badgeAmount', 'Badge amount', money('badgeAmount', '400'), '(for "Save")')
          + field('urgency', 'Urgency pill', input('urgency', 'Only 4 left at this price'), '(green flash)')
          + '</div></div>';
      }

      if (cfg.showValidity) {
        html += '<div class="ob-fs"><h4>7 · Validity &amp; availability</h4><p class="hint">When the deal expires and how tight availability is.</p><div class="ob-grid">'
          + field('bookby', 'Book by', input('bookby', '31 July 2026'))
          + field('avail', 'Availability note', input('avail', 'Limited rooms at this price'))
          + field('showFrom', 'Show from', input('showFrom', '', 'date'), '(optional)')
          + field('showUntil', 'Show until', input('showUntil', '', 'date'), '(optional)')
          + '</div><p class="hint" style="margin-top:10px">Show from / until control when the offer appears. Set either, neither or both. With no dates the offer always shows. "Show until" includes that whole day.</p></div>';
      }

      if (cfg.showImages) {
        const canUpload = !!cfg.uploadEndpoint;
        html += '<div class="ob-fs"><h4>8 · Photos</h4><p class="hint">The images people will see on the card and offer page. The first photo is the cover.</p>'
          + '<div class="ob-photos">'
          + (canUpload
              ? '<div class="ob-upload" tabindex="0" role="button">🖼️ <b>Click to choose photos</b> or drag them here<span>JPG, PNG, WebP or GIF, up to 8MB each</span></div>'
                + '<input type="file" class="ob-file" accept="image/*" multiple hidden />'
              : '')
          + '<div class="ob-url-row"><input type="url" class="ob-url-input" placeholder="Paste an image URL (https://…)" /><button type="button" class="ob-btn ob-url-add">Add photo</button></div>'
          + '<p class="ob-photo-err"></p>'
          + '<div class="ob-thumbs"></div>'
          + '</div></div>';
      }

      if (cfg.showMap) {
        html += '<div class="ob-fs"><h4>9 · Map &amp; video</h4><p class="hint">Show the resort on a map and add a video tour. Both appear on the offer page.</p><div class="ob-grid">'
          + field('mapAddress', 'Map location', input('mapAddress', 'Costa Mujeres, Cancun, Mexico'), '(shown above the map)', true)
          + field('mapLat', 'Latitude', input('mapLat', 'e.g. 21.0419', 'text'), '(from Google Maps)')
          + field('mapLng', 'Longitude', input('mapLng', 'e.g. -86.8126', 'text'), '(from Google Maps)')
          + field('mapStyle', 'Map style', select('mapStyle', ['streets', 'minimal', 'muted', 'dark', 'satellite'], 'streets'))
          + field('video', 'Video link', input('video', 'YouTube, Vimeo or MP4 URL', 'text'), '(optional)', true)
          + '</div><p class="hint" style="margin-top:10px">Tip: in Google Maps, right-click the resort and click the coordinates to copy them. Leave the map blank to hide it.</p></div>';
      }

      if (cfg.showDescription) {
        html += '<div class="ob-fs"><h4>10 · Words for the offer page</h4><p class="hint">The write-ups shown on the offer page. They change with the offer type so the right things are covered — a cruise is about the ship and its ports, a hotel about the hotel and the resort. Leave any blank and it simply won\'t show. Use <b>Write with AI</b>, then edit.</p>'
          + '<div class="ob-content" data-content></div></div>';
      }

      if (cfg.showEnquiry) {
        html += '<div class="ob-fs"><h4>11 · Where enquiries go</h4><p class="hint">Each offer page carries an enquiry form. Tell us who picks it up.</p><div class="ob-grid">'
          + field('enquiryEmail', 'Enquiry email', input('enquiryEmail', 'sales@youragency.co.uk', 'email'))
          + field('enquiryPhone', 'Phone shown on page', input('enquiryPhone', '0161 123 4567', 'tel'))
          + field('reference', 'Offer reference', input('reference', 'TG-CUN-0926'))
          + field('protection', 'Financial protection', select('protection', PROTECTIONS, cfg.protection))
          + '</div></div>';
      }

      if (cfg.showLanguages) {
        html += '<div class="ob-fs ob-lang-fs"><h4>12 · Audience languages</h4>'
          + '<p class="hint">Write the offer once in English, then translate it for the languages your customers read. Each visitor sees their own language automatically, falling back to English for anything not yet translated. Prices, ATOL and ABTA wording, place and brand names are never translated.</p>'
          + '<div class="ob-lang-body"></div></div>';
      }

      html += '<div class="ob-actions">'
        + '<button type="button" class="ob-btn ob-reset">Clear form</button>'
        + '<button type="button" class="ob-btn primary ob-submit">' + esc(cfg.submitLabel) + '</button>'
        + '</div>';

      this.root.innerHTML =
        '<div class="ob-head"><h2>' + esc(cfg.title) + '</h2><p>' + esc(cfg.intro) + '</p></div>'
        + aiBox
        + '<form class="ob-form">' + html + '</form>';

      // Pre-fill enquiry routing defaults from config
      this.shadow.innerHTML = '<style>' + STYLES + '</style>';
      this.shadow.appendChild(this.root);
      if (!Array.isArray(this._includes)) this._includes = [];
      if (!this._contentVals || typeof this._contentVals !== 'object') this._contentVals = {};
      if (!this._fieldVals || typeof this._fieldVals !== 'object') this._fieldVals = {};

      this._prefill();
      this._bind();
      this._renderLanguages();
      if (this.cfg.offer) this._prefillOffer(this.cfg.offer);
      this._renderFields();   // type-aware structured fields (sections 2 & 3)
      this._renderContent();  // type-aware long-text sections
      this._renderPills();    // free-text includes
      this._renderThumbs();
    }

    _prefill() {
      const cfg = this.cfg;
      const set = (k, v) => { const el = this.root.querySelector('[data-key="' + k + '"]'); if (el && v) el.value = v; };
      set('enquiryEmail', cfg.enquiryEmail);
      set('enquiryPhone', cfg.enquiryPhone);
    }

    _bind() {
      const root = this.root;

      // Tag chips
      root.querySelectorAll('.ob-toggle').forEach((c) =>
        c.addEventListener('click', () => c.classList.toggle('on')));

      // Includes — free-text pills plus one-tap suggestions
      const pillInput = root.querySelector('.ob-pill-input');
      const pillGo = root.querySelector('.ob-pill-go');
      const addFromInput = () => { if (pillInput) { this._addPill(pillInput.value); pillInput.value = ''; pillInput.focus(); } };
      if (pillInput) pillInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addFromInput(); } });
      if (pillGo) pillGo.addEventListener('click', addFromInput);
      root.querySelectorAll('.ob-chip-suggest').forEach((b) =>
        b.addEventListener('click', () => this._addPill(b.dataset.suggest)));

      // Structured fields and content sections swap to suit the chosen type.
      const typeSel = root.querySelector('[data-key="type"]');
      if (typeSel) typeSel.addEventListener('change', () => { this._renderFields(); this._renderContent(); });

      // Clear validation as the user types
      root.querySelectorAll('[data-key]').forEach((el) =>
        el.addEventListener('input', () => { const f = el.closest('.ob-field'); if (f) f.classList.remove('invalid'); }));

      root.querySelector('.ob-submit').addEventListener('click', () => this._submit());
      root.querySelector('.ob-reset').addEventListener('click', () => {
        // A cleared form has no source content, so its translations no longer
        // apply — drop them too rather than leaving orphaned overlays.
        this._images = []; this._i18n = {}; this._i18nMeta = {}; this._audienceLanguages = [];
        this._includes = []; this._contentVals = {}; this._fieldVals = {};
        this._render();
      });

      this._bindPhotos();
    }

    // ── Structured fields (type-aware) ───────────────────────────────────────
    // Draws sections 2 and 3 for the current offer type. Values are preserved
    // across a type switch in this._fieldVals, so shared fields (country, dates,
    // price is elsewhere) survive and hidden ones return if you switch back.
    _renderFields() {
      const wrap = this.root && this.root.querySelector('[data-fields]');
      if (!wrap) return;
      const cfg = this.cfg;
      const sym = currencySymbol(cfg.currency);
      // Keep anything typed before swapping the visible set.
      wrap.querySelectorAll('[data-key]').forEach((el) => { this._fieldVals[el.dataset.key] = el.value; });
      const typeSel = this.root.querySelector('[data-key="type"]');
      const type = typeSel ? typeSel.value : (cfg.offerTypes && cfg.offerTypes[0]) || '';

      const control = (spec) => {
        const val = this._fieldVals[spec.key];
        if (spec.kind === 'select') {
          const list = spec.list || [];
          const sel = (val != null && list.indexOf(val) !== -1) ? val : list[0];
          return '<select data-key="' + spec.key + '">' + options(list, sel) + '</select>';
        }
        const v = (val != null) ? ' value="' + esc(val) + '"' : '';
        if (spec.kind === 'num') {
          return '<div class="ob-prefix"><input type="number" data-key="' + spec.key + '" placeholder="' + esc(spec.ph || '') + '"' + v + ' />'
            + '<span class="ob-suffix">' + esc(spec.suffix || '') + '</span></div>';
        }
        if (spec.kind === 'money') {
          return '<div class="ob-prefix"><span class="sym">' + sym + '</span><input type="number" data-key="' + spec.key + '" placeholder="' + esc(spec.ph || '') + '"' + v + ' /></div>';
        }
        return '<input type="text" data-key="' + spec.key + '" placeholder="' + esc(spec.ph || '') + '"' + v + ' />';
      };
      const fieldHtml = (spec) =>
        '<div class="ob-field" data-field="' + spec.key + '"><label>' + esc(spec.label) + '</label>'
        + control(spec) + '<span class="ob-err">Required</span></div>';

      const sections = formSectionsFor(type);
      const showWhere = cfg.showDestination, showCore = cfg.showStayTravel;
      const wanted = [showWhere, showCore];
      wrap.innerHTML = sections.map((sec, i) => {
        if (!wanted[i]) return '';
        const n = i + 2; // sections 2 and 3
        const body = sec.keys.map((entry) => fieldHtml(fieldSpec(entry))).join('');
        return '<div class="ob-fs"><h4>' + n + ' · ' + esc(sec.h) + '</h4><p class="hint">' + esc(sec.hint) + '</p><div class="ob-grid">' + body + '</div></div>';
      }).join('');

      // Keep the field-value store in step as the user types, and clear the
      // "Required" flag on input (mirrors the static fields' behaviour).
      wrap.querySelectorAll('[data-key]').forEach((el) => {
        el.addEventListener('input', () => {
          this._fieldVals[el.dataset.key] = el.value;
          const f = el.closest('.ob-field'); if (f) f.classList.remove('invalid');
        });
        el.addEventListener('change', () => { this._fieldVals[el.dataset.key] = el.value; });
      });
    }

    // ── Content sections (type-aware, per-section AI) ────────────────────────
    _renderContent() {
      const wrap = this.root && this.root.querySelector('[data-content]');
      if (!wrap) return;
      // Preserve anything typed before swapping the visible set.
      wrap.querySelectorAll('textarea[data-key]').forEach((ta) => { this._contentVals[ta.dataset.key] = ta.value; });
      const typeSel = this.root.querySelector('[data-key="type"]');
      const type = typeSel ? typeSel.value : '';
      const ai = this.cfg.aiEnabled && (this.cfg.aiEndpoint || this.cfg.aiMock);
      wrap.innerHTML = contentKeysFor(type).map((k) => {
        const s = CONTENT_SECTIONS[k];
        if (!s) return '';
        const val = this._contentVals[k] || '';
        return '<div class="ob-content-sec" data-field="' + k + '">'
          + '<div class="ob-content-head"><label>' + esc(s.label) + '</label>'
          + (ai ? '<button type="button" class="ob-ai-write" data-write="' + k + '"><span class="spark">✨</span> Write with AI</button>' : '')
          + '</div>'
          + '<p class="ob-content-hint">' + esc(s.hint) + '</p>'
          + '<textarea data-key="' + k + '" rows="4" placeholder="' + esc(s.ph) + '">' + esc(val) + '</textarea>'
          + '<div class="ob-write-status"></div></div>';
      }).join('');
      wrap.querySelectorAll('textarea[data-key]').forEach((ta) => {
        ta.addEventListener('input', () => { this._contentVals[ta.dataset.key] = ta.value; });
      });
      wrap.querySelectorAll('.ob-ai-write').forEach((b) => {
        b.addEventListener('click', () => this._writeSection(b.dataset.write, b));
      });
    }

    _renderPills() {
      const wrap = this.root && this.root.querySelector('[data-pills]');
      if (!wrap) return;
      const list = this._includes || [];
      wrap.innerHTML = list.length
        ? list.map((v, i) => '<span class="ob-pill">' + esc(v) + '<button type="button" data-rm="' + i + '" aria-label="Remove">×</button></span>').join('')
        : '<span class="ob-pill-empty">Nothing added yet.</span>';
      wrap.querySelectorAll('[data-rm]').forEach((b) => {
        b.addEventListener('click', () => { this._includes.splice(parseInt(b.dataset.rm, 10), 1); this._renderPills(); });
      });
    }
    _addPill(v) {
      v = (v || '').trim();
      if (!v) return;
      if (!this._includes) this._includes = [];
      if (this._includes.indexOf(v) === -1) this._includes.push(v.slice(0, 80));
      this._renderPills();
    }

    async _writeSection(key, btn) {
      const sec = this.root.querySelector('.ob-content-sec[data-field="' + key + '"]');
      const ta = sec && sec.querySelector('textarea[data-key="' + key + '"]');
      const status = sec && sec.querySelector('.ob-write-status');
      if (!ta) return;
      const setStatus = (cls, msg) => { if (status) { status.className = 'ob-write-status show ' + cls; status.textContent = msg; } };
      const ctx = {};
      // Static basics plus every structured field the current type can carry, so
      // a cruise ship write-up has the ship and the ports and a flight the route.
      ['title', 'type', 'style'].concat(ALL_FIELD_KEYS).forEach((k) => {
        const el = this.root.querySelector('[data-key="' + k + '"]');
        let v = el ? (el.value || '').trim() : '';
        if (!v && this._fieldVals && this._fieldVals[k]) v = String(this._fieldVals[k]).trim();
        if (v) ctx[k] = v;
      });
      if (!ctx.title && !ctx.resort && !ctx.country && !ctx.property && !ctx.shipName && !ctx.destination && !ctx.region) {
        setStatus('err', 'Fill in a few details first — a title, hotel, ship or destination — so the AI has something to work with.');
        return;
      }
      btn.disabled = true;
      setStatus('busy', 'Writing…');
      try {
        let text;
        if (this.cfg.aiMock) {
          await new Promise((r) => setTimeout(r, 500));
          text = 'A warm, plain sample paragraph for the "' + (CONTENT_SECTIONS[key] ? CONTENT_SECTIONS[key].label : key) + '" section. Edit me to suit the offer.';
        } else {
          if (!this.cfg.aiEndpoint) throw new Error('No aiEndpoint');
          const r = await fetch(this.cfg.aiEndpoint, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ section: key, context: ctx, widgetId: this.cfg._widgetId })
          });
          if (!r.ok) throw new Error('HTTP ' + r.status);
          const j = await r.json();
          text = (j && j.text) || '';
        }
        if (!text) throw new Error('empty');
        ta.value = text;
        this._contentVals[key] = text;
        sec.classList.add('ai');
        setStatus('ok', 'Drafted in your brand voice. Edit it to suit.');
      } catch (err) {
        setStatus('err', 'AI write is not available right now. You can type it yourself.');
        // eslint-disable-next-line no-console
        console.warn('[TGOfferBuilder] section write failed:', err && err.message);
      } finally {
        btn.disabled = false;
      }
    }

    // ── Photos ───────────────────────────────────────────────────────────────
    _bindPhotos() {
      const root = this.root;
      const drop = root.querySelector('.ob-upload');
      const fileInput = root.querySelector('.ob-file');
      const urlInput = root.querySelector('.ob-url-input');
      const addBtn = root.querySelector('.ob-url-add');

      // Upload-from-disk (only present when an upload endpoint is configured).
      if (drop && fileInput) {
        const openPicker = () => fileInput.click();
        drop.addEventListener('click', openPicker);
        drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPicker(); } });
        fileInput.addEventListener('change', (e) => {
          const files = Array.from(e.target.files || []);
          e.target.value = '';
          this._uploadFiles(files);
        });
        ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('drag'); }));
        ['dragleave', 'dragend'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('drag')));
        drop.addEventListener('drop', (e) => {
          e.preventDefault(); drop.classList.remove('drag');
          this._uploadFiles(Array.from((e.dataTransfer && e.dataTransfer.files) || []));
        });
      }

      // Paste an image URL (works with no backend, so the demo can use it too).
      if (addBtn && urlInput) {
        const add = () => {
          const safe = safePhotoUrl(urlInput.value);
          if (!safe) { this._photoError('That does not look like a valid image URL. It should start with https://'); return; }
          this._images.push(safe);
          urlInput.value = '';
          this._photoError('');
          this._renderThumbs();
        };
        addBtn.addEventListener('click', add);
        urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
      }
    }

    _photoError(msg) {
      const el = this.root.querySelector('.ob-photo-err');
      if (!el) return;
      el.textContent = msg || '';
      el.classList.toggle('show', !!msg);
    }

    async _uploadFiles(files) {
      const imgs = files.filter((f) => f && /^image\//.test(f.type));
      if (!imgs.length) return;
      if (!this.cfg.uploadEndpoint) { this._photoError('Photo upload is not available here. Paste an image URL instead.'); return; }
      const drop = this.root.querySelector('.ob-upload');
      const original = drop ? drop.innerHTML : '';
      if (drop) { drop.classList.add('busy'); drop.textContent = 'Uploading…'; }
      this._photoError('');
      let added = 0;
      for (const f of imgs) {
        if (f.size > 8 * 1024 * 1024) { this._photoError(safeFileName(f.name) + ' is over 8MB. Please use a smaller image.'); continue; }
        const url = await this._uploadOne(f);
        if (url) { this._images.push(url); added++; this._renderThumbs(); }
      }
      if (drop) { drop.classList.remove('busy'); drop.innerHTML = original; }
      if (!added && !this.root.querySelector('.ob-photo-err.show')) {
        this._photoError('Could not upload those photos. If you are signed out, sign in and try again, or paste an image URL.');
      }
    }

    async _uploadOne(file) {
      try {
        const mod = await getBlobClient();
        const pathname = 'offer-photos/' + Date.now() + '-' + safeFileName(file.name);
        const blob = await mod.upload(pathname, file, {
          access: 'public',
          contentType: file.type,
          handleUploadUrl: this.cfg.uploadEndpoint
        });
        return safePhotoUrl(blob && blob.url);
      } catch (err) {
        console.warn('[TGOfferBuilder] photo upload failed:', err && err.message);
        return '';
      }
    }

    _renderThumbs() {
      const wrap = this.root && this.root.querySelector('.ob-thumbs');
      if (!wrap) return;
      this._images = (this._images || []).map(safePhotoUrl).filter(Boolean);
      wrap.innerHTML = this._images.map((url, i) =>
        '<div class="ob-thumb' + (i === 0 ? ' cover' : '') + '" style="background-image:url(\'' + url + '\')">'
        + (i === 0 ? '<span class="ob-thumb-tag">Cover</span>' : '<button type="button" class="ob-thumb-cover-btn" data-i="' + i + '">Make cover</button>')
        + '<button type="button" class="ob-thumb-x" data-i="' + i + '" aria-label="Remove photo">✕</button>'
        + '</div>'
      ).join('');
      wrap.querySelectorAll('.ob-thumb-x').forEach((b) =>
        b.addEventListener('click', () => { this._images.splice(Number(b.dataset.i), 1); this._renderThumbs(); }));
      wrap.querySelectorAll('.ob-thumb-cover-btn').forEach((b) =>
        b.addEventListener('click', () => {
          const i = Number(b.dataset.i);
          const [chosen] = this._images.splice(i, 1);
          this._images.unshift(chosen);
          this._renderThumbs();
        }));
    }

    // ── AI assist ────────────────────────────────────────────────────────────
    async _runAI() {
      const root = this.root;
      const input = root.querySelector('.ob-ai-input');
      const status = root.querySelector('.ob-ai-status');
      const btn = root.querySelector('.ob-ai-go');
      const desc = (input.value || '').trim();

      if (desc.length < 8) {
        status.className = 'ob-ai-status show err';
        status.textContent = 'Add a sentence or two describing the offer first.';
        return;
      }
      btn.disabled = true;
      status.className = 'ob-ai-status show busy';
      status.textContent = '⏳ Reading your offer and filling the form…';

      try {
        const draft = await this._fetchDraft(desc);
        this._applyDraft(draft);
        const n = Object.keys(draft.fields || {}).length;
        status.className = 'ob-ai-status show ok';
        status.innerHTML = '✓ Done. Filled ' + n + ' fields. Check anything marked <span class="ob-chip">✨ AI</span> before you save.';
      } catch (err) {
        status.className = 'ob-ai-status show err';
        status.textContent = 'AI draft is not available right now. You can still fill the form by hand.';
        // eslint-disable-next-line no-console
        console.warn('[TGOfferBuilder] AI draft failed:', err && err.message);
      } finally {
        btn.disabled = false;
      }
    }

    _fetchDraft(description) {
      // Preview/demo path — resolve the canned draft without a backend.
      if (this.cfg.aiMock) {
        return new Promise((res) => setTimeout(() => res(DEMO_DRAFT), 900));
      }
      if (!this.cfg.aiEndpoint) return Promise.reject(new Error('No aiEndpoint configured'));
      return fetch(this.cfg.aiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: description, widgetId: this.cfg._widgetId })
      }).then((r) => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      });
    }

    _applyDraft(draft) {
      const root = this.root;
      const fields = (draft && draft.fields) || {};
      Object.keys(fields).forEach((k) => {
        const el = root.querySelector('[data-key="' + k + '"]');
        if (!el) return;
        el.value = fields[k];
        const f = el.closest('.ob-field');
        if (f && !f.classList.contains('ai')) {
          f.classList.add('ai');
          const label = f.querySelector('label');
          if (label && !label.querySelector('.ob-chip')) {
            const chip = document.createElement('span');
            chip.className = 'ob-chip';
            chip.textContent = '✨ AI';
            label.appendChild(chip);
          }
        }
      });
      const includes = (draft && draft.includes) || [];
      root.querySelectorAll('.ob-incl input').forEach((i) => {
        if (includes.indexOf(i.dataset.incl) !== -1) { i.checked = true; i.closest('label').classList.add('on'); }
      });
      const tags = (draft && draft.tags) || [];
      root.querySelectorAll('.ob-toggle').forEach((c) => {
        if (tags.indexOf(c.dataset.tag) !== -1) c.classList.add('on');
      });
    }

    // ── Audience languages / translate (content layer) ───────────────────────
    // The translatable content pulled straight off the CURRENT form, in the
    // exact shape /api/offer-translate expects. Empty keys are omitted so the
    // signature and the request stay tight. Operational fields (prices, dates,
    // map, video, enquiry, references) are deliberately never sent.
    _collectTranslatable() {
      const root = this.root;
      const get = (k) => {
        const el = root.querySelector('[data-key="' + k + '"]');
        return el ? (el.value || '').trim() : '';
      };
      const fields = {};
      ['title', 'teaser', 'description', 'urgency', 'avail'].forEach((k) => {
        const v = get(k);
        if (v) fields[k] = v;
      });
      const includes = (this._includes || []).slice();
      const tags = [];
      root.querySelectorAll('.ob-toggle.on').forEach((c) => tags.push(c.dataset.tag));
      const out = {};
      if (Object.keys(fields).length) out.fields = fields;
      if (includes.length) out.includes = includes;
      if (tags.length) out.tags = tags;
      return out;
    }

    // A stable signature of the translatable source. When this changes after a
    // language was translated, that language is flagged stale.
    _contentSignature() {
      try { return JSON.stringify(this._collectTranslatable()); } catch (e) { return ''; }
    }

    // Status of one audience language relative to the current source content.
    _langStatus(code) {
      const tr = this._i18n && this._i18n[code];
      const has = tr && typeof tr === 'object' && Object.keys(tr).length;
      if (!has) return { state: 'none', label: 'Not translated', tone: 'muted' };
      const sig = (this._i18nMeta && this._i18nMeta[code] && this._i18nMeta[code].sig) || '';
      if (sig && sig !== this._contentSignature()) {
        return { state: 'stale', label: 'Source changed — re-translate', tone: 'warn' };
      }
      return { state: 'ok', label: 'Up to date', tone: 'ok' };
    }

    // Render (or re-render) the Languages section body: a toggle per language
    // with its live status, plus the Translate button. Re-rendered on toggle,
    // after a translation, and whenever the form is prefilled.
    _renderLanguages() {
      if (!this.root) return;
      const body = this.root.querySelector('.ob-lang-body');
      if (!body) return;
      const selected = this._audienceLanguages || [];
      const anyTranslated = AUDIENCE_LANGS.some((l) =>
        this._i18n && this._i18n[l.code] && Object.keys(this._i18n[l.code]).length);

      const rows = AUDIENCE_LANGS.map((l) => {
        const on = selected.indexOf(l.code) !== -1;
        const st = this._langStatus(l.code);
        return '<div class="ob-lang-row">'
          + '<div class="ob-lang-main"><div class="ob-lang-name">' + esc(l.label) + '</div>'
          + '<div class="ob-lang-status ' + st.tone + '">' + esc(st.label) + '</div></div>'
          + '<button type="button" class="ob-lang-toggle" role="switch" data-lang-toggle="'
          + l.code + '" aria-pressed="' + (on ? 'true' : 'false') + '" aria-label="' + esc(l.label) + '"></button>'
          + '</div>';
      }).join('');

      body.innerHTML = '<div class="ob-langs">' + rows + '</div>'
        + '<div class="ob-lang-actions">'
        + '<button type="button" class="ob-lang-go"' + (selected.length ? '' : ' disabled') + '>'
        + '✨ ' + (anyTranslated ? 'Update translations' : 'Translate for my audience')
        + '</button>'
        + '<span class="ob-lang-go-status"></span>'
        + '</div>';

      body.querySelectorAll('[data-lang-toggle]').forEach((b) =>
        b.addEventListener('click', () => {
          const code = b.dataset.langToggle;
          const i = this._audienceLanguages.indexOf(code);
          if (i === -1) this._audienceLanguages.push(code); else this._audienceLanguages.splice(i, 1);
          this._renderLanguages();
        }));
      const go = body.querySelector('.ob-lang-go');
      if (go) go.addEventListener('click', () => this._translateAudience());
    }

    async _translateAudience() {
      const body = this.root.querySelector('.ob-lang-body');
      const btn = body && body.querySelector('.ob-lang-go');
      const status = body && body.querySelector('.ob-lang-go-status');
      const setStatus = (msg, tone) => { if (status) { status.className = 'ob-lang-go-status' + (tone ? ' ' + tone : ''); status.textContent = msg || ''; } };

      const targets = (this._audienceLanguages || []).slice();
      if (!targets.length) { setStatus('Pick at least one language first.', 'err'); return; }

      const content = this._collectTranslatable();
      if (!content.fields && !content.includes && !content.tags) {
        setStatus('Add some offer content to translate first.', 'err');
        return;
      }

      if (btn) { btn.disabled = true; btn.innerHTML = '<span class="ob-lang-spin">✨</span> Translating…'; }
      setStatus('Translating, usually 10 to 20 seconds…', 'busy');

      try {
        // Same auth the builder uses for /api/saved-offers: the session cookie,
        // sent with credentials:'include'. requireAuth accepts the tg_session
        // cookie, so no Bearer header is needed.
        const res = await fetch(this.cfg.translateEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ content: content, targetLangs: targets, sourceLang: 'en' })
        });

        if (res.status === 401) { setStatus('Your session has expired. Please sign in again, then retry.', 'err'); return; }
        if (res.status === 429) { setStatus('Too many translations just now. Please wait a moment and try again.', 'err'); return; }
        if (!res.ok) {
          let msg = 'Translation failed. Please try again.';
          try { const j = await res.json(); if (j && j.error) msg = j.error; } catch (e) {}
          throw new Error(msg);
        }

        const data = await res.json();
        const i18n = data && data.i18n;
        if (!i18n || typeof i18n !== 'object' || !Object.keys(i18n).length) {
          throw new Error('No translations came back. Please try again.');
        }

        // Merge per language and stamp each with the source signature it was
        // translated from, so a later edit flags it stale.
        const sig = this._contentSignature();
        if (!this._i18n || typeof this._i18n !== 'object') this._i18n = {};
        if (!this._i18nMeta || typeof this._i18nMeta !== 'object') this._i18nMeta = {};
        const done = [];
        Object.keys(i18n).forEach((code) => {
          this._i18n[code] = i18n[code];
          this._i18nMeta[code] = { sig: sig, at: new Date().toISOString() };
          const l = AUDIENCE_LANGS.find((x) => x.code === code);
          done.push(l ? l.label : code);
        });

        this._renderLanguages();
        const st2 = this.root.querySelector('.ob-lang-go-status');
        if (st2) { st2.className = 'ob-lang-go-status ok'; st2.textContent = 'Translated into ' + done.join(', ') + '. Save the offer to keep it.'; }
      } catch (err) {
        setStatus((err && err.message) || 'Translation failed.', 'err');
        if (btn) { btn.disabled = false; }
        this._renderLanguages();
        const st3 = this.root.querySelector('.ob-lang-go-status');
        if (st3) { st3.className = 'ob-lang-go-status err'; st3.textContent = (err && err.message) || 'Translation failed.'; }
        // eslint-disable-next-line no-console
        console.warn('[TGOfferBuilder] translate failed:', err && err.message);
      }
    }

    // ── Collect, validate, submit ────────────────────────────────────────────
    _collect() {
      const root = this.root;
      const offer = { fields: {}, includes: [], tags: [], currency: this.cfg.currency };
      root.querySelectorAll('[data-key]').forEach((el) => {
        const v = (el.value || '').trim();
        if (v) offer.fields[el.dataset.key] = v;
      });
      offer.includes = (this._includes || []).slice();
      root.querySelectorAll('.ob-toggle.on').forEach((c) => offer.tags.push(c.dataset.tag));
      const imgs = (this._images || []).map(safePhotoUrl).filter(Boolean);
      if (imgs.length) offer.images = imgs;

      // Content-layer translations. i18n is whitelisted by /api/saved-offers and
      // read by the card/page at render time. audienceLanguages and i18nMeta ride
      // along so the chosen set and staleness signatures round-trip while editing
      // (the save API only persists i18n, which is all the public render needs).
      if (this._audienceLanguages && this._audienceLanguages.length) {
        offer.audienceLanguages = this._audienceLanguages.slice();
      }
      if (this._i18n && Object.keys(this._i18n).length) offer.i18n = this._i18n;
      if (this._i18nMeta && Object.keys(this._i18nMeta).length) offer.i18nMeta = this._i18nMeta;
      return offer;
    }

    _validate(offer) {
      const root = this.root;
      let ok = true;
      const flag = (key) => {
        const f = root.querySelector('.ob-field[data-field="' + key + '"]');
        if (f) f.classList.add('invalid');
        ok = false;
      };
      root.querySelectorAll('.ob-field.invalid').forEach((f) => f.classList.remove('invalid'));
      if (this.cfg.requireTitle && !offer.fields.title) flag('title');
      if (this.cfg.requirePrice && !offer.fields.price) flag('price');
      if (!ok) {
        const first = root.querySelector('.ob-field.invalid');
        if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      return ok;
    }

    _submit() {
      const offer = this._collect();
      if (!this._validate(offer)) return;

      // Fire the event the host (or a card/page renderer) listens for.
      this.el.dispatchEvent(new CustomEvent('tg-offer-created', {
        bubbles: true, composed: true, detail: offer
      }));

      if (this.cfg.save) this._saveOffer(offer);
      else this._success(offer);
    }

    // Persist the offer to the account and get back a shareable id + URL.
    _saveOffer(offer) {
      const btn = this.root.querySelector('.ob-submit');
      if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
      const prevErr = this.root.querySelector('.ob-save-error');
      if (prevErr) prevErr.style.display = 'none';
      fetch(this.cfg.saveEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ id: this.cfg.offerId || undefined, offer: offer })
      })
        .then((r) => r.json().then((j) => ({ ok: r.ok, j: j })))
        .then((res) => {
          if (!res.ok) throw new Error((res.j && res.j.error) || 'Save failed');
          this.cfg.offerId = res.j.id;
          this.el.dispatchEvent(new CustomEvent('tg-offer-saved', { bubbles: true, composed: true, detail: { id: res.j.id, url: res.j.url, offer: offer } }));
          this._success(offer, res.j);
        })
        .catch((err) => { this._saveError(String(err && err.message || err)); });
    }

    // Save failed: keep the filled-in form intact, re-enable the submit button
    // and surface the error inline so the user can re-authenticate and retry
    // without losing any input. (Previously this tore down to the success panel,
    // discarding every entry on a transient 401/network blip.)
    _saveError(msg) {
      const btn = this.root.querySelector('.ob-submit');
      if (btn) { btn.disabled = false; btn.textContent = this.cfg.submitLabel; }
      const actions = this.root.querySelector('.ob-actions');
      if (!actions) return;
      let box = this.root.querySelector('.ob-save-error');
      if (!box) {
        box = document.createElement('div');
        box.className = 'ob-save-error';
        box.setAttribute('role', 'alert');
        actions.parentNode.insertBefore(box, actions);
      }
      box.textContent = 'Could not save the offer (' + msg + '). Your entries are safe. '
        + 'Check you are still signed in, then press ' + this.cfg.submitLabel + ' again.';
      box.style.display = 'block';
      try { box.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) { /* noop */ }
    }

    _success(offer, saved, err) {
      const cfg = this.cfg;
      let extra = '';
      if (saved && saved.id) {
        const link = (cfg.offerBaseUrl || '') + (saved.url || ('/offer?id=' + saved.id));
        extra = '<div class="ob-saved"><div class="ob-saved-label">Shareable offer page</div>'
          + '<div class="ob-saved-row"><input class="ob-saved-link" type="text" readonly value="' + esc(link) + '" />'
          + '<button type="button" class="ob-btn ob-copy">Copy</button>'
          + '<a class="ob-btn primary" href="' + esc(link) + '" target="_blank" rel="noopener">Open</a></div></div>';
      } else if (err) {
        extra = '<div class="ob-saved err">Could not save the offer (' + esc(err) + '). You can still copy the details below.</div>';
      }
      this.root.innerHTML =
        '<div class="ob-success"><div class="tick">✓</div>'
        + '<h3>' + esc(cfg.successHeading) + '</h3>'
        + '<p>' + esc(cfg.successBody) + '</p>'
        + extra
        + '<div class="ob-summary">' + esc(JSON.stringify(offer, null, 2)) + '</div>'
        + '<button type="button" class="ob-btn primary ob-again">Create another offer</button></div>';
      this.root.querySelector('.ob-again').addEventListener('click', () => this._render());
      const copy = this.root.querySelector('.ob-copy');
      if (copy) copy.addEventListener('click', () => {
        const inp = this.root.querySelector('.ob-saved-link');
        inp.select();
        try { navigator.clipboard.writeText(inp.value); } catch (e) { document.execCommand('copy'); }
        copy.textContent = 'Copied';
        setTimeout(() => { copy.textContent = 'Copy'; }, 1500);
      });
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
      console.error('[TGOfferBuilder] Config load error:', err);
      return null;
    }
  }

  async function init() {
    const containers = document.querySelectorAll('[data-tg-widget="offer-builder"]');
    for (const el of containers) {
      // Skip anything already wired (flag set) or already hosting a shadow root
      // (manual construction in a demo/editor that also carries the attribute).
      if (el._tgInitialised || el.shadowRoot) continue;
      el._tgInitialised = true;
      let config = null;
      const inline = el.getAttribute('data-tg-config');
      const widgetId = el.getAttribute('data-tg-id');
      if (inline) {
        try { config = JSON.parse(inline); } catch (e) { console.error('[TGOfferBuilder] Invalid inline config:', e); continue; }
      } else if (widgetId) {
        config = await loadConfigFromApi(widgetId);
        if (!config) continue;
      } else {
        config = {};
      }
      new TGOfferBuilderWidget(el, config);
    }
  }

  if (typeof window !== 'undefined') {
    window.TGOfferBuilderWidget = TGOfferBuilderWidget;
    window.TGOfferBuilderWidget.version = VERSION;
    // Single source of truth for the type -> field mapping, reused by the
    // dashboard Sheet (quick loader) so its columns match this form.
    window.TGOfferBuilderWidget.offerMeta = {
      types: OFFER_TYPES.slice(),
      sheetColsFor: sheetColsFor,
      sheetColOrder: SHEET_COL_ORDER.slice(),
      sheetColLabels: Object.assign({}, SHEET_COL_LABELS),
      numericKeys: ['nights']
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }
})();
