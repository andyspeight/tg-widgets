/**
 * Travelgenix Travel Results AI Widget v1.0.0
 * Self-contained, embeddable concierge for the Travel Results v4 widget.
 * Zero dependencies — works on any client site via a single script tag.
 *
 * Usage (drop in an HTML box on the results page):
 *   <script src="https://tg-widgets.vercel.app/widget-travel-results-ai.js"></script>
 *
 * It listens for Travelify's accommodation-results-ready event, filters and
 * scores locally (Stage 1), asks Claude for the best picks + reasons via the
 * server endpoint (Stage 2), supports conversational refinement (Stage 3), and
 * tells the results widget to display the chosen properties via the view event.
 *
 * Contract + safety: see travel-results-ai-widget-integration.md and the
 * travelgenix-security skill. All payload text is untrusted and rendered with
 * textContent only. The widget never touches the results widget's DOM.
 */
(function () {
  'use strict';

  // Stage 1 of the contract: announce presence as early as possible so the
  // Travel Results widget knows to emit the results-ready event.
  window.TravelgenixWidgets = window.TravelgenixWidgets || {};
  window.TravelgenixWidgets.travelResultsAi = true;

  var VERSION = '1.10.0';
  // The results widget emits a different ready/view pair per search type. The
  // result shape is shared; packages add flight / operator / inclusions data.
  var SEARCH_TYPES = [
    { kind: 'accommodation', ready: 'tg:travel-results-v4:accommodation-results-ready', view: 'tg:travel-results-v4:accommodation-airesults-view' },
    { kind: 'dynpack', ready: 'tg:travel-results-v4:dynpack-results-ready', view: 'tg:travel-results-v4:dynpack-airesults-view' },
    { kind: 'package', ready: 'tg:travel-results-v4:package-results-ready', view: 'tg:travel-results-v4:package-airesults-view' }
  ];
  var EV_VIEW = SEARCH_TYPES[0].view;            // default until a search arrives
  var activeView = EV_VIEW, activeKind = 'accommodation', sharedFlight = null;
  var API_BASE = (typeof window !== 'undefined' && window.__TG_TRAI_API__) ||
                 'https://tg-widgets.vercel.app/api/travel-results-ai';
  var AUTO = (typeof window !== 'undefined' && window.__TG_TRAI_AUTO__ === false) ? false : true;
  var PREVIEW = !!(typeof window !== 'undefined' && window.__TG_TRAI_PREVIEW__);
  var SHORTLIST_CAP = 18;

  // ---- config -------------------------------------------------------------
  // Backward-compatible: with no data-tg-id / data-tg-config the DEFAULTS below
  // reproduce the original look and copy exactly, so anything already embedded
  // keeps working unchanged. An editor-issued embed carries data-tg-id and the
  // widget fetches its saved config from /api/widget-config.
  var DEFAULTS = {
    enabled: true,
    title: 'AI trip assistant',
    greeting: '',                                       // '' = dynamic intro line
    placeholder: 'Ask: more central, with a pool, cheaper\u2026',
    sendLabel: 'Send',
    viewLabel: 'Show these in results',
    headerColor: '#1B2B5B',
    accent: '#00B4D8',
    theme: 'auto',                                      // 'auto' | 'light' | 'dark'
    font: '',                                           // '' = Inter default stack
    position: 'br',                                     // 'br' | 'bl' | 'mr' | 'ml' | 'float'
    maxRecs: 6,
    width: 380,
    height: 640,
    appearMode: 'suggestions',                           // 'ready' | 'delay' | 'suggestions'
    appearDelay: 3,                                      // seconds, used when appearMode==='delay'
    startMode: 'open',                                   // 'open' (full panel) | 'launcher' (collapsed pill)
    launcherText: 'Ask AI to pick your best matches',
    deferAnalysis: true,                                 // launcher: analyse on open (true) vs pre-warm (false)
    cacheResults: true,                                  // cache the analysis per search (sessionStorage)
    rememberState: true,                                 // remember open/min/dragged state for the visit
    chips: true,                                         // one-tap refine chips
    cardClick: true,                                     // click a card to show that property in results
    mobileSheet: true,                                   // bottom-sheet layout on small screens
    analytics: true,                                     // emit engagement events to dataLayer + hook
    verifyClaims: true                                   // drop rec reasons citing amenities not in the data
  };
  var CFG = Object.assign({}, DEFAULTS);

  var SELF = document.currentScript || (function () {
    var s = document.querySelectorAll('script[src*="widget-travel-results-ai"]');
    return s[s.length - 1] || null;
  })();
  function configApi() {
    try { if (SELF && SELF.src) return new URL(SELF.src).origin + '/api/widget-config'; } catch (e) {}
    return 'https://tg-widgets.vercel.app/api/widget-config';
  }
  function isHex(c) { return typeof c === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(c); }
  function str(v, max) { return typeof v === 'string' ? v.slice(0, max || 80) : undefined; }
  function sanitiseCfg(c) {
    c = c || {}; var o = {}, v;
    if (typeof c.enabled === 'boolean') o.enabled = c.enabled;
    if ((v = str(c.title, 60)) != null) o.title = v;
    if ((v = str(c.greeting, 200)) != null) o.greeting = v;
    if ((v = str(c.placeholder, 120)) != null) o.placeholder = v;
    if ((v = str(c.sendLabel, 24)) != null) o.sendLabel = v;
    if ((v = str(c.viewLabel, 40)) != null) o.viewLabel = v;
    if (isHex(c.headerColor)) o.headerColor = c.headerColor;
    if (isHex(c.accent)) o.accent = c.accent;
    if (c.theme === 'auto' || c.theme === 'light' || c.theme === 'dark') o.theme = c.theme;
    if ((v = str(c.font, 120)) == null) v = str(c.fontFamily, 120);
    if (v != null) o.font = v;
    if (['br', 'bl', 'mr', 'ml', 'float'].indexOf(c.position) !== -1) o.position = c.position;
    v = parseInt(c.maxRecs, 10); if (!isNaN(v)) o.maxRecs = Math.max(1, Math.min(6, v));
    v = parseInt(c.width, 10); if (!isNaN(v)) o.width = Math.max(300, Math.min(520, v));
    v = parseInt(c.height, 10); if (!isNaN(v)) o.height = Math.max(360, Math.min(820, v));
    if (c.appearMode === 'ready' || c.appearMode === 'delay' || c.appearMode === 'suggestions') o.appearMode = c.appearMode;
    v = parseInt(c.appearDelay, 10); if (!isNaN(v)) o.appearDelay = Math.max(1, Math.min(30, v));
    if (c.startMode === 'launcher' || c.startMode === 'open') o.startMode = c.startMode;
    if ((v = str(c.launcherText, 60)) != null) o.launcherText = v;
    if (typeof c.deferAnalysis === 'boolean') o.deferAnalysis = c.deferAnalysis;
    if (typeof c.cacheResults === 'boolean') o.cacheResults = c.cacheResults;
    if (typeof c.rememberState === 'boolean') o.rememberState = c.rememberState;
    if (typeof c.chips === 'boolean') o.chips = c.chips;
    if (typeof c.cardClick === 'boolean') o.cardClick = c.cardClick;
    if (typeof c.mobileSheet === 'boolean') o.mobileSheet = c.mobileSheet;
    if (typeof c.analytics === 'boolean') o.analytics = c.analytics;
    if (typeof c.verifyClaims === 'boolean') o.verifyClaims = c.verifyClaims;
    return o;
  }
  function findContainer() {
    try { return document.querySelector('[data-tg-widget="travel-results-ai"][data-tg-id]'); } catch (e) { return null; }
  }
  (function resolveConfig() {
    if (window.__TG_TRAI_CONFIG__) Object.assign(CFG, sanitiseCfg(window.__TG_TRAI_CONFIG__));
    var src = (SELF && SELF.getAttribute) ? SELF : null;
    var inline = src && src.getAttribute('data-tg-config');
    if (inline) { try { Object.assign(CFG, sanitiseCfg(JSON.parse(inline))); } catch (e) { console.warn('[trai] bad data-tg-config', e); } }
    // id can arrive on the script tag (header install) or on a standard
    // [data-tg-widget="travel-results-ai"] container (shell default embed).
    var id = (src && src.getAttribute('data-tg-id')) || null;
    if (!id) {
      var c = findContainer();
      if (c) {
        id = c.getAttribute('data-tg-id');
        var ci = c.getAttribute('data-tg-config');
        if (ci && !inline) { try { Object.assign(CFG, sanitiseCfg(JSON.parse(ci))); } catch (e) {} }
      }
    }
    if (id) {
      fetch(configApi() + '?id=' + encodeURIComponent(id))
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) { if (d && d.config) { Object.assign(CFG, sanitiseCfg(d.config)); applyConfig(); } })
        .catch(function (e) { console.warn('[trai] config load failed', e); });
    }
  })();

  // hex shade: amt>0 lightens toward white, amt<0 darkens toward black
  function hexToRgb(h) { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join(''); var n = parseInt(h.slice(0, 6), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function rgbToHex(r) { return '#' + r.map(function (v) { var s = Math.max(0, Math.min(255, Math.round(v))).toString(16); return s.length < 2 ? '0' + s : s; }).join(''); }
  function shade(hex, amt) { try { return rgbToHex(hexToRgb(hex).map(function (v) { return amt < 0 ? v * (1 + amt) : v + (255 - v) * amt; })); } catch (e) { return hex; } }

  // ---- state ----
  var activeSession = null;
  var criteria = null;
  var summaries = [];      // all results, summarised
  var currentRecs = [];    // [{rid, category, reason, s}]
  var history = [];        // conversational history
  var currency = 'GBP';
  var booted = false;
  var opened = false, analysed = false, lastPayload = null, awaitingReveal = false;

  // ---- helpers ----
  function money(n) {
    if (typeof n !== 'number') return '';
    var sym = { GBP: '\u00A3', EUR: '\u20AC', USD: '$' }[currency] || (currency + ' ');
    return sym + Math.round(n).toLocaleString('en-GB');
  }
  function fmtDate(iso) { try { return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); } catch (e) { return iso || ''; } }
  function toRad(v) { return v * Math.PI / 180; }
  function distKm(a, b, c, d) {
    if ([a, b, c, d].some(function (v) { return typeof v !== 'number'; })) return null;
    var R = 6371, dLa = toRad(c - a), dLo = toRad(d - b);
    var x = Math.sin(dLa / 2) * Math.sin(dLa / 2) + Math.cos(toRad(a)) * Math.cos(toRad(c)) * Math.sin(dLo / 2) * Math.sin(dLo / 2);
    return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }
  function ratesOf(r) {
    return (r.units || []).reduce(function (acc, u) {
      (u.rates || []).forEach(function (rt) {
        if (rt && typeof rt.price === 'number' && rt.price > 0) acc.push({ board: rt.board, price: rt.price, currency: rt.currency, refundability: rt.refundability, unitName: u.name });
      });
      return acc;
    }, []);
  }
  function lowest(rs) { return rs.slice().sort(function (a, b) { return a.price - b.price; })[0] || null; }
  function cityOf(addr) { var p = String(addr || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean); return p.length >= 3 ? p[p.length - 3] : (p[0] || ''); }
  function warningsOf(r, rs) {
    var t = [r.name, r.description].concat((r.units || []).map(function (u) { return u.name; })).join(' ').toLowerCase();
    var w = [];
    if (t.indexOf('shared bathroom') > -1) w.push('shared bathroom');
    if (t.indexOf('dorm') > -1) w.push('dormitory');
    if (rs.length && rs.every(function (x) { return x.refundability === 'NonRefundable'; })) w.push('non-refundable only');
    return w;
  }
  function nightly(p) { var n = (criteria && criteria.nights) || 1; return n > 0 ? p / n : p; }
  function boardLabel(b) {
    if (!b) return '';
    var key = String(b).toLowerCase().replace(/[^a-z]/g, '');
    var map = {
      roomonly: 'Room only', bedandbreakfast: 'B&B', breakfast: 'Breakfast', bb: 'B&B',
      halfboard: 'Half board', fullboard: 'Full board', allinclusive: 'All-inclusive',
      selfcatering: 'Self-catering', fullallinclusive: 'All-inclusive', any: ''
    };
    if (map[key] != null) return map[key];
    // Fallback: de-camel/underscore the raw enum, e.g. "HalfBoard" -> "Half board".
    var s = String(b).replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim().toLowerCase();
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
  }

  function flightSummary(f) {
    if (!f) return null;
    var carrier = f.carrier || (f.routes && f.routes[0] && f.routes[0].carrier) || '';
    var direct = /direct/i.test(f.stops || '') || (Array.isArray(f.routes) && f.routes.length && f.routes.every(function (r) { return (r.stops || 0) === 0; }));
    var stopTxt = direct ? 'Direct' : (f.stops || 'Connecting');
    return (carrier ? carrier + ' \u00b7 ' : '') + stopTxt;
  }
  function summarise(r) {
    var rs = ratesOf(r);
    var lo = lowest(rs);
    var loRef = lowest(rs.filter(function (x) { return x.refundability === 'Refundable'; }));
    var ownFlight = !!r.flight;
    var fl = r.flight || (activeKind === 'dynpack' ? sharedFlight : null);
    return {
      rid: String(r.rid), name: r.name || 'Property', star: r.starRating || 0,
      address: r.address || '', city: cityOf(r.address),
      lo: lo, loRef: loRef,
      distKm: distKm(criteria && criteria.latitude, criteria && criteria.longitude, r.latitude, r.longitude),
      goodFor: r.goodFor || [], amen: r.amenities || [], ta: r.tripadvisor || null,
      desc: r.description || '', warns: warningsOf(r, rs),
      op: r.operatorName || null, incl: r.inclusions || [],
      ownFlight: ownFlight, flSummary: flightSummary(fl), pkg: activeKind !== 'accommodation'
    };
  }
  function score(s) {
    var v = 0;
    if (s.lo) v += Math.max(0, 120000 / s.lo.price);
    if (s.star > 0) v += s.star * 10;
    if (s.ta && s.ta.rating) v += s.ta.rating * 12;
    if (s.ta && s.ta.reviewCount >= 100) v += 10;
    if (s.loRef) v += 8;
    if (s.distKm != null) v -= Math.min(s.distKm, 25);
    v -= (s.warns.length) * 6;
    return v;
  }
  function compact(s) {
    var o = {
      rid: s.rid, n: s.name, star: s.star, p: s.lo ? Math.round(s.lo.price) : null,
      board: s.lo ? s.lo.board : null, ref: !!s.loRef, city: s.city,
      km: s.distKm != null ? Math.round(s.distKm) : null,
      gf: s.goodFor, am: (s.amen || []).slice(0, 4),
      ta: s.ta ? [s.ta.rating, s.ta.reviewCount] : null, w: s.warns, d: (s.desc || '').slice(0, 110)
    };
    if (s.pkg) o.pkg = 1;
    if (s.op) o.op = s.op;
    if (s.ownFlight && s.flSummary) o.fl = s.flSummary;     // per-result flight (package); dynpack flight is in criteria
    if (s.incl && s.incl.length) o.inc = s.incl.slice(0, 4);
    return o;
  }
  function trimCriteria() {
    var c = {
      locationName: criteria.locationName, checkinDate: criteria.checkinDate, checkoutDate: criteria.checkoutDate,
      departDate: criteria.departDate, originName: criteria.originName,
      nights: criteria.nights, passengers: criteria.passengers, rooms: criteria.rooms,
      boardBasis: criteria.boardBasis, refundableOnly: criteria.refundableOnly,
      minStarRating: criteria.minStarRating, currency: currency
    };
    if (activeKind !== 'accommodation') { c.searchType = activeKind; c.packagePrices = true; }
    if (activeKind === 'dynpack' && sharedFlight) c.flight = flightSummary(sharedFlight);
    return c;
  }

  // Conversational pre-filter: bias the candidate shortlist towards the request,
  // so the model reasons over the most relevant set. Falls back to general score.
  function candidatesFor(message) {
    var ranked = summaries.filter(function (s) { return s.lo; });
    if (!message) return ranked.sort(function (a, b) { return score(b) - score(a); }).slice(0, SHORTLIST_CAP);
    var m = message.toLowerCase();
    var has = function (kw) { return m.indexOf(kw) > -1; };
    var amenStr = function (s) { return (s.amen || []).join(' ').toLowerCase() + ' ' + (s.goodFor || []).join(' ').toLowerCase() + ' ' + (s.desc || '').toLowerCase(); };
    function bonus(s) {
      var b = 0, a = amenStr(s);
      if ((has('pool') || has('swim')) && a.indexOf('pool') > -1) b += 60;
      if ((has('beach') || has('sea')) && (a.indexOf('beach') > -1 || (s.goodFor || []).indexOf('Beach') > -1)) b += 60;
      if ((has('central') || has('centre') || has('center') || has('close')) && s.distKm != null) b += Math.max(0, 50 - s.distKm * 3);
      if ((has('cheap') || has('budget') || has('value') || has('afford')) && s.lo) b += Math.max(0, 60 - s.lo.price / 60);
      if (has('refund') && s.loRef) b += 60;
      if ((has('family') || has('kid') || has('child')) && ((s.goodFor || []).indexOf('Families') > -1 || a.indexOf('parking') > -1 || a.indexOf('kitchen') > -1)) b += 60;
      if (has('spa') && a.indexOf('spa') > -1) b += 60;
      if (has('parking') && a.indexOf('parking') > -1) b += 50;
      if ((has('breakfast') || has('bed and breakfast') || has('b&b')) && (a.indexOf('breakfast') > -1 || (s.lo && /breakfast/i.test(s.lo.board || '')))) b += 50;
      if ((has('luxury') || has('5 star') || has('five star') || has('premium')) && s.star >= 4) b += 50;
      return b;
    }
    return ranked.map(function (s) { return { s: s, v: score(s) + bonus(s) }; })
      .sort(function (a, b) { return b.v - a.v; })
      .slice(0, SHORTLIST_CAP).map(function (x) { return x.s; });
  }

  // ---- rule-based fallback (used only if the AI endpoint is unavailable) ----
  function fallbackRecs(cands, max) {
    var byRid = {}; cands.forEach(function (s) { byRid[s.rid] = s; });
    var picks = [];
    var add = function (cat, s) { if (s && !picks.some(function (p) { return p.rid === s.rid; })) picks.push({ rid: s.rid, category: cat, reason: ruleReason(cat, s), s: s }); };
    add('Best value', cands.slice().sort(function (a, b) { return score(b) - score(a); })[0]);
    add('Top reviewed', cands.slice().filter(function (s) { return s.ta; }).sort(function (a, b) { return (b.ta.rating || 0) - (a.ta.rating || 0); })[0]);
    add('Most central', cands.slice().filter(function (s) { return s.distKm != null; }).sort(function (a, b) { return a.distKm - b.distKm; })[0]);
    add('Best refundable', cands.slice().filter(function (s) { return s.loRef; }).sort(function (a, b) { return a.loRef.price - b.loRef.price; })[0]);
    add('Premium pick', cands.slice().sort(function (a, b) { return b.star - a.star; })[0]);
    return picks.slice(0, max || 5);
  }
  function ruleReason(cat, s) {
    var bits = [];
    if (s.lo) bits.push(money(s.lo.price) + ' total (' + money(nightly(s.lo.price)) + '/night)');
    if (s.loRef) bits.push('refundable rate available');
    if (s.ta && s.ta.rating) bits.push('TripAdvisor ' + s.ta.rating + ' from ' + s.ta.reviewCount + ' reviews');
    if (s.distKm != null) bits.push(Math.round(s.distKm) + 'km from the search centre');
    if (s.star) bits.push(s.star + '-star');
    return bits.slice(0, 3).join(', ') + '.';
  }

  // ---- networking ----
  function callEndpoint(message, cands) {
    var payload = {
      version: 1, searchSession: activeSession, criteria: trimCriteria(),
      shortlist: cands.map(compact)
    };
    if (message) { payload.message = message; payload.history = history.slice(-8); }
    return fetch(API_BASE, {
      method: 'POST', mode: 'cors', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  // ===================== UI (Shadow DOM) =====================
  var host, root, els = {};
  function mount() {
    if (host) return;
    host = document.createElement('div');
    host.id = 'tg-trai-host';
    host.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483200;';
    (document.body || document.documentElement).appendChild(host);
    root = host.attachShadow({ mode: 'open' });
    root.innerHTML = STYLES + MARKUP;
    els.sub = root.getElementById('sub');
    els.body = root.getElementById('body');
    els.foot = root.getElementById('foot');
    els.input = root.getElementById('input');
    els.send = root.getElementById('send');
    els.min = root.getElementById('min');
    els.panel = root.getElementById('panel');
    els.head = root.querySelector('.hd');
    els.title = root.getElementById('title');
    els.launcher = root.getElementById('launcher');
    els.launcherText = root.getElementById('launcher-text');
    els.chips = root.getElementById('chips');
    els.live = root.getElementById('live');
    els.launcher.addEventListener('click', openPanel);
    els.min.addEventListener('click', minimise);
    els.send.addEventListener('click', sendMessage);
    els.input.addEventListener('keydown', function (e) { if (e.key === 'Enter') sendMessage(); });
    els.panel.addEventListener('keydown', function (e) { if (e.key === 'Escape') minimise(); });
    setupDrag();
    window.addEventListener('resize', layout);
    applyConfig();
    setFootEnabled(false);
  }
  // Collapse: in launcher mode return to the pill; otherwise minimise to the
  // header bar (and, in float, dock to the right-middle edge).
  function minimise() {
    if (CFG.startMode === 'launcher' && !PREVIEW) { collapseToLauncher(); return; }
    var willMin = !els.panel.classList.contains('is-min');
    els.panel.classList.toggle('is-min');
    if (CFG.position === 'float' && willMin) {
      els._docked = true; els._dragged = false; els._fx = els._fy = null;
      var s = host.style;
      s.left = 'auto'; s.bottom = 'auto'; s.right = '18px'; s.top = '50%'; s.transform = 'translateY(-50%)';
    }
    persistUI();
  }
  function applyConfig() {
    if (!host || !els.panel) return;
    layout();
    var p = els.panel.style;
    p.setProperty('--navy', CFG.headerColor);
    p.setProperty('--navy-d', shade(CFG.headerColor, -0.4));
    p.setProperty('--navy-l', shade(CFG.headerColor, 0.14));
    p.setProperty('--teal', CFG.accent);
    p.setProperty('--teal-d', shade(CFG.accent, -0.16));
    p.setProperty('--teal-l', shade(CFG.accent, 0.28));
    if (CFG.font) p.setProperty('--trai-font', CFG.font);
    els.panel.setAttribute('data-theme', CFG.theme);
    if (els.title) els.title.textContent = CFG.title;
    els.panel.setAttribute('aria-label', CFG.title);
    if (els.input) els.input.setAttribute('placeholder', CFG.placeholder);
    if (els.send) els.send.textContent = CFG.sendLabel;
    if (els.launcher) {
      var l = els.launcher.style;
      l.setProperty('--l-navy', CFG.headerColor);
      l.setProperty('--l-navy-d', shade(CFG.headerColor, -0.4));
      l.setProperty('--l-teal', CFG.accent);
      if (CFG.font) l.setProperty('--trai-font', CFG.font);
    }
    if (els.launcherText) els.launcherText.textContent = CFG.launcherText;
  }
  // Panel width + max-height from config, clamped to the viewport. Recomputed
  // on resize so it stays responsive on rotation / window changes.
  function applySize() {
    if (!els.panel) return;
    var w = Math.min(CFG.width, window.innerWidth - 24);
    var h = Math.min(CFG.height, window.innerHeight - 32);
    els.panel.style.width = Math.max(280, w) + 'px';
    els.panel.style.maxHeight = Math.max(320, h) + 'px';
  }

  // Anchor the fixed host wrapper per CFG.position. Resets every anchor each
  // call so switching positions (incl. live preview) never leaves stale values.
  function positionHost() {
    if (!host) return;
    var s = host.style;
    s.left = s.right = s.top = s.bottom = 'auto';
    s.transform = 'none';
    switch (CFG.position) {
      case 'bl': s.left = '18px'; s.bottom = '18px'; break;
      case 'mr': s.right = '18px'; s.top = '50%'; s.transform = 'translateY(-50%)'; break;
      case 'ml': s.left = '18px'; s.top = '50%'; s.transform = 'translateY(-50%)'; break;
      case 'float':
        if (els._dragged && els._fx != null) { s.left = els._fx + 'px'; s.top = els._fy + 'px'; }
        else if (els._docked) { s.right = '18px'; s.top = '50%'; s.transform = 'translateY(-50%)'; }
        else {
          // floating, offset toward the right and vertically centred
          var pw = host.offsetWidth || 380;
          var gap = Math.max(18, Math.min(Math.round(window.innerWidth * 0.08), window.innerWidth - pw - 18));
          s.right = gap + 'px'; s.top = '50%'; s.transform = 'translateY(-50%)';
        }
        break;
      default: s.right = '18px'; s.bottom = '18px'; // 'br'
    }
  }

  // Drag the panel by its header — only active in 'float' position. Pointer
  // events cover mouse + touch; the minimise button stays clickable; the panel
  // is clamped inside the viewport and re-clamped on resize.
  function setupDrag() {
    var head = els.head; if (!head) return;
    var dragging = false, ox = 0, oy = 0;
    function clamp(x, y) {
      var w = host.offsetWidth, h = host.offsetHeight;
      var maxX = Math.max(4, window.innerWidth - w - 4);
      var maxY = Math.max(4, window.innerHeight - h - 4);
      return [Math.min(maxX, Math.max(4, x)), Math.min(maxY, Math.max(4, y))];
    }
    head.addEventListener('pointerdown', function (e) {
      if (CFG.position !== 'float') return;            // only float is draggable
      if (isSheet()) return;                           // not while docked as a bottom sheet
      if (e.target.closest && e.target.closest('.mn')) return; // keep minimise clickable
      if (e.button != null && e.button !== 0) return;  // primary / touch only
      var rect = host.getBoundingClientRect();
      host.style.transform = 'none';
      host.style.right = 'auto'; host.style.bottom = 'auto';
      host.style.left = rect.left + 'px'; host.style.top = rect.top + 'px';
      ox = e.clientX - rect.left; oy = e.clientY - rect.top;
      dragging = true; els._dragged = true;
      head.classList.add('tg-grabbing');
      try { head.setPointerCapture(e.pointerId); } catch (_) {}
      e.preventDefault();
    });
    head.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var c = clamp(e.clientX - ox, e.clientY - oy);
      els._fx = c[0]; els._fy = c[1];
      host.style.left = els._fx + 'px'; host.style.top = els._fy + 'px';
      e.preventDefault();
    });
    function end(e) {
      if (!dragging) return;
      dragging = false; head.classList.remove('tg-grabbing');
      try { head.releasePointerCapture(e.pointerId); } catch (_) {}
      persistUI();
    }
    head.addEventListener('pointerup', end);
    head.addEventListener('pointercancel', end);
    window.addEventListener('resize', function () {
      if (CFG.position !== 'float' || !els._dragged || els._fx == null) return;
      var c = clamp(els._fx, els._fy);
      els._fx = c[0]; els._fy = c[1];
      host.style.left = els._fx + 'px'; host.style.top = els._fy + 'px';
    });
  }

  function setSub(t) { if (els.sub) els.sub.textContent = t; }
  function setFootEnabled(on) { if (els.foot) els.foot.style.display = on ? 'flex' : 'none'; }
  function clearBody() { if (els.body) els.body.textContent = ''; }
  function stateLine(text, think) {
    var d = document.createElement('div'); d.className = 'st';
    var dot = document.createElement('span'); dot.className = 'dot' + (think ? ' think' : ''); d.appendChild(dot);
    var s = document.createElement('span'); s.textContent = text; d.appendChild(s);
    return d;
  }
  function addBubble(role, text) {
    var b = document.createElement('div'); b.className = 'bub ' + (role === 'user' ? 'u' : 'a');
    b.textContent = text; els.body.appendChild(b); scroll();
    return b;
  }
  function scroll() { if (els.body) els.body.scrollTop = els.body.scrollHeight; }
  // Bring a node to the top of the scroll area, so a fresh result set starts at
  // the assistant's summary + first card rather than scrolled down to the last.
  function scrollToTopOf(node) {
    if (!els.body) return;
    els.body.scrollTop = node ? Math.max(0, node.offsetTop - 14) : 0;
  }

  function renderRecs(reply, recs, append) {
    if (!append) clearBody();
    var startNode = reply ? addBubble('assistant', reply) : null;
    if (!recs.length) {
      var sl = stateLine('No clear matches for that \u2014 try a different ask.');
      els.body.appendChild(sl);
      setFootEnabled(true); scrollToTopOf(startNode || sl); return;
    }
    recs.forEach(function (r) {
      var s = r.s;
      var card = document.createElement('div'); card.className = 'rec';
      if (!startNode) startNode = card;
      var cat = document.createElement('span'); cat.className = 'cat'; cat.textContent = r.category; card.appendChild(cat);
      var nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = s.name; card.appendChild(nm);
      var facts = document.createElement('div'); facts.className = 'facts';
      function fact(t, cls) { var f = document.createElement('span'); f.className = 'f' + (cls ? ' ' + cls : ''); f.textContent = t; facts.appendChild(f); }
      if (s.lo) fact(money(s.lo.price) + ' total', 'price');
      if (s.lo) fact(money(nightly(s.lo.price)) + '/night');
      if (s.star > 0) fact(s.star + '-star');
      if (s.lo && s.lo.board) { var bl = boardLabel(s.lo.board); if (bl) fact(bl); }
      if (s.ta && s.ta.rating) fact('TA ' + s.ta.rating + ' (' + s.ta.reviewCount + ')');
      if (s.distKm != null) fact(Math.round(s.distKm) + ' km from centre');
      if (s.loRef) fact('refundable');
      if (s.op) fact(s.op);
      if (s.flSummary) fact(s.flSummary);
      (s.incl || []).forEach(function (i) { if (/atol/i.test(i)) fact('ATOL', 'ok'); });
      (s.warns || []).forEach(function (w) { fact(w, 'warn'); });
      card.appendChild(facts);
      var why = document.createElement('p'); why.className = 'why'; why.textContent = r.reason; card.appendChild(why);
      if (CFG.cardClick) {
        card.classList.add('clickable');
        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', '0');
        card.setAttribute('aria-label', 'Show ' + s.name + ' in the results');
        var hint = document.createElement('span'); hint.className = 'rec-view'; hint.textContent = (CFG.viewLabel || 'Show in results') + ' \u203a'; card.appendChild(hint);
        var showOne = function () {
          track('card_view', { rid: r.rid });
          dispatchView([r.rid]);
          els.body.querySelectorAll('.rec.is-shown').forEach(function (n) { n.classList.remove('is-shown'); });
          card.classList.add('is-shown');
        };
        card.addEventListener('click', showOne);
        card.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showOne(); } });
      }
      els.body.appendChild(card);
    });
    var act = document.createElement('button'); act.className = 'go'; act.type = 'button';
    act.textContent = CFG.viewLabel;
    act.addEventListener('click', function () { track('view_all', { count: recs.length }); dispatchView(recs.map(function (r) { return r.rid; })); });
    els.body.appendChild(act);
    setFootEnabled(true);
    if (!append) { renderChips(); revealNow(); }
    track('recommendations', { count: recs.length, refine: !!append });
    announce(recs.length + ' suggestion' + (recs.length === 1 ? '' : 's') + ' ready.');
    scrollToTopOf(startNode);
  }

  // ---- refine chips ----
  function buildChips() {
    var n = summaries.length; if (!n) return [];
    var hay = summaries.map(function (s) { return ((s.amen || []).join(' ') + ' ' + (s.goodFor || []).join(' ')).toLowerCase(); });
    function frac(kw) { var c = 0; hay.forEach(function (h) { if (h.indexOf(kw) > -1) c++; }); return c / n; }
    var out = [];
    function add(label, kw) { var f = frac(kw); if (f >= 0.15 && f < 0.95) out.push(label); }
    add('Near the beach', 'beach'); add('With a pool', 'pool'); add('With a spa', 'spa');
    if (summaries.some(function (s) { return (s.goodFor || []).indexOf('Families') > -1; })) out.push('Good for families');
    out.push('Cheaper');
    if (summaries.some(function (s) { return s.ta; })) out.push('Top rated');
    if (summaries.some(function (s) { return s.distKm != null; })) out.push('More central');
    var seen = {}, res = []; out.forEach(function (x) { if (!seen[x]) { seen[x] = 1; res.push(x); } });
    return res.slice(0, 5);
  }
  function renderChips() {
    if (!els.chips) return;
    els.chips.innerHTML = '';
    if (!CFG.chips) { els.chips.style.display = 'none'; return; }
    var chips = buildChips();
    if (!chips.length) { els.chips.style.display = 'none'; return; }
    els.chips.style.display = 'flex';
    chips.forEach(function (label) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.textContent = label;
      b.addEventListener('click', function () { track('chip', { text: label }); els.input.value = label; sendMessage(); });
      els.chips.appendChild(b);
    });
  }
  function renderError() {
    clearBody();
    els.body.appendChild(stateLine('Could not analyse these results right now.'));
    setFootEnabled(true);
  }

  // ---- flows ----
  function recCacheKey(session) { return 'tgtrai:rec:' + session; }
  function readRecCache(session) {
    if (!CFG.cacheResults) return null;
    try { return JSON.parse(sessionStorage.getItem(recCacheKey(session)) || 'null'); } catch (e) { return null; }
  }
  function writeRecCache(session, reply, recommendations) {
    if (!CFG.cacheResults) return;
    try { sessionStorage.setItem(recCacheKey(session), JSON.stringify({ reply: reply || '', recommendations: recommendations || [] })); } catch (e) {}
  }
  function processInitial(payload) {
    analysed = true;
    activeSession = payload.searchSession;
    sharedFlight = payload.flight || sharedFlight || null;
    criteria = payload.criteria || {};
    currency = criteria.currency || 'GBP';
    history = [];
    summaries = (payload.results || []).filter(function (r) { return r && r.rid && Array.isArray(r.units); }).map(summarise);

    setSub('Analysing ' + (payload.results || []).length + ' results\u2026');
    clearBody();
    els.body.appendChild(stateLine('Reading ' + (payload.results || []).length + ' results, finding the best for your trip\u2026', true));
    setFootEnabled(false);

    // Edge cases: nothing comparable, or a single option — handle without an API call.
    if (!summaries.length) {
      setSub('Nothing to compare yet.');
      clearBody();
      els.body.appendChild(stateLine('I can\u2019t see any properties to compare for this search \u2014 try adjusting your filters or dates.'));
      setFootEnabled(false);
      announce('No properties to compare.');
      return;
    }
    if (summaries.length === 1) {
      var only = summaries[0];
      var single = [{ rid: only.rid, category: 'Your option', reason: safeReason(only), s: only }];
      currentRecs = single;
      setSub('One option for this search.');
      renderRecs('There\u2019s just one option for this search:', single);
      return;
    }

    var cands = candidatesFor('');
    if (PREVIEW) {
      var precs = fallbackRecs(cands, CFG.maxRecs); currentRecs = precs;
      setSub('Suggested ' + precs.length + ' option' + (precs.length === 1 ? '' : 's') + '.');
      renderRecs(introLine(), precs);
      return;
    }
    // Cached analysis for this search? Render without spending another call.
    var cached = readRecCache(payload.searchSession);
    if (cached) {
      var crecs = mapRecs(cached.recommendations, cands, CFG.maxRecs);
      if (crecs.length) {
        currentRecs = crecs;
        setSub('Suggested ' + crecs.length + ' option' + (crecs.length === 1 ? '' : 's') + '.');
        renderRecs(cached.reply || introLine(), crecs);
        return;
      }
    }
    callEndpoint('', cands).then(function (data) {
      if (payload.searchSession !== activeSession) return; // stale guard
      var recs = mapRecs(data.recommendations, cands, CFG.maxRecs);
      if (!recs.length) { recs = fallbackRecs(cands, CFG.maxRecs); data = { reply: '' }; }
      else { writeRecCache(payload.searchSession, data.reply, data.recommendations); }
      setSub('Suggested ' + recs.length + ' option' + (recs.length === 1 ? '' : 's') + '.');
      currentRecs = recs;
      renderRecs(data.reply || introLine(), recs);
    }).catch(function (e) {
      if (payload.searchSession !== activeSession) return;
      console.warn('[trai] endpoint failed, using fallback', e);
      var recs = fallbackRecs(cands, CFG.maxRecs); currentRecs = recs;
      setSub('Suggested ' + recs.length + ' option' + (recs.length === 1 ? '' : 's') + '.');
      renderRecs(introLine(), recs);
    });
  }

  function sendMessage() {
    var msg = (els.input.value || '').trim();
    if (!msg || !activeSession) return;
    els.input.value = '';
    addBubble('user', msg);
    track('message', { text: msg });
    history.push({ role: 'user', content: msg });
    var thinking = stateLine('Thinking\u2026', true); els.body.appendChild(thinking); scroll();
    var cands = candidatesFor(msg);
    if (PREVIEW) {
      if (els.body.contains(thinking)) els.body.removeChild(thinking);
      var precs = fallbackRecs(cands, CFG.maxRecs); currentRecs = precs;
      history.push({ role: 'assistant', content: 'preview' });
      renderRecs('Here are the closest matches I can see:', precs, true);
      return;
    }
    callEndpoint(msg, cands).then(function (data) {
      if (!els.body.contains(thinking)) return;
      els.body.removeChild(thinking);
      var recs = mapRecs(data.recommendations, cands, CFG.maxRecs);
      if (!recs.length) recs = fallbackRecs(cands, CFG.maxRecs);
      currentRecs = recs;
      history.push({ role: 'assistant', content: data.reply || 'Here are some options.' });
      renderRecs(data.reply || 'Here are some options that match that:', recs, true);
    }).catch(function (e) {
      if (els.body.contains(thinking)) els.body.removeChild(thinking);
      console.warn('[trai] refine failed, using fallback', e);
      var recs = fallbackRecs(cands, CFG.maxRecs); currentRecs = recs;
      renderRecs('Here are the closest matches I can see:', recs, true);
    });
  }

  function mapRecs(list, cands, max) {
    var byRid = {}; cands.forEach(function (s) { byRid[s.rid] = s; });
    return (list || []).filter(function (r) { return r && byRid[r.rid]; }).slice(0, max || 6)
      .map(function (r) {
        var s = byRid[r.rid];
        var reason = r.reason || '';
        if (CFG.verifyClaims) reason = cleanReason(reason, s);
        return { rid: r.rid, category: r.category || 'Suggested', reason: reason, s: s };
      });
  }

  // ---- claim verification (drop reason sentences that cite features not in the data) ----
  function amenHas(s, k) { return (s.amen || []).join(' ').toLowerCase().indexOf(k) > -1; }
  function gfHas(s, k) { return (s.goodFor || []).join(' ').toLowerCase().indexOf(k) > -1; }
  function boardHas(s, k) { return !!(s.lo && (s.lo.board || '').toLowerCase().indexOf(k) > -1); }
  var CLAIM_RULES = [
    { kw: ['swimming pool', 'pool'], ok: function (s) { return amenHas(s, 'pool'); } },
    { kw: ['spa'], ok: function (s) { return amenHas(s, 'spa'); } },
    { kw: ['beachfront', 'seafront', 'beach', 'seaside', 'sea view'], ok: function (s) { return amenHas(s, 'beach') || gfHas(s, 'beach'); } },
    { kw: ['wi-fi', 'wifi', 'wi fi'], ok: function (s) { return amenHas(s, 'wifi') || amenHas(s, 'wi-fi'); } },
    { kw: ['parking'], ok: function (s) { return amenHas(s, 'parking'); } },
    { kw: ['fitness', 'gym'], ok: function (s) { return amenHas(s, 'gym') || amenHas(s, 'fitness'); } },
    { kw: ['self-catering', 'self catering', 'kitchenette', 'kitchen'], ok: function (s) { return amenHas(s, 'kitchen'); } },
    { kw: ['all-inclusive', 'all inclusive'], ok: function (s) { return boardHas(s, 'all inclusive') || amenHas(s, 'all inclusive'); } },
    { kw: ['families', 'family', 'children', 'child', 'kids', 'kid'], ok: function (s) { return gfHas(s, 'famil') || amenHas(s, 'kitchen'); } },
    { kw: ['atol'], ok: function (s) { return (s.incl || []).join(' ').toLowerCase().indexOf('atol') > -1; } },
    { kw: ['transfers', 'transfer'], ok: function (s) { return (s.incl || []).join(' ').toLowerCase().indexOf('transfer') > -1; } },
    { kw: ['direct flight', 'direct flights'], ok: function (s) { return /direct/i.test(s.flSummary || ''); } }
  ];
  function safeReason(s) {
    if (s.loRef && s.star >= 4) return 'A higher-rated option with a refundable rate.';
    if (s.ta && s.ta.rating >= 4.5) return 'Among the better-reviewed options on your list.';
    if (s.distKm != null && s.distKm <= 3) return 'A well-placed option close to the centre.';
    if (s.loRef) return 'A solid pick that comes with a refundable rate.';
    if (s.ta && s.ta.rating >= 4) return 'Well rated by previous guests for a trip like yours.';
    if (s.star >= 4) return 'A comfortable ' + s.star + '-star choice for your dates.';
    return 'A solid match for your search.';
  }
  // Belt-and-braces on top of the prompt: if a reason merely restates the
  // facts already shown as chips (name + star/rating/price, no real insight),
  // swap it for a fact-based line instead.
  var INSIGHT_WORDS = ['central', 'centre', 'center', 'close', 'near', 'walk', 'beach', 'pool', 'spa', 'value', 'cheap', 'budget', 'afford', 'refundable', 'family', 'families', 'kid', 'quiet', 'transfer', 'flight', 'operator', 'breakfast', 'board', 'inclusive', 'view', 'transport', 'metro', 'station', 'airport', 'location', 'spacious', 'modern', 'renovat', 'pet', 'parking', 'best', 'only', 'most', 'cheapest', 'closest'];
  function restatesOnly(reason, s) {
    if (!reason) return false;
    var lc = reason.toLowerCase();
    var firstName = (s.name || '').toLowerCase().split(/\s+/)[0];
    var mentionsName = firstName && firstName.length > 2 && lc.indexOf(firstName) > -1;
    var mentionsChip = /\bstar\b|\brating\b|\brated\b|\bproperty\b|\bhotel\b|\breview/.test(lc);
    var hasInsight = INSIGHT_WORDS.some(function (w) { return lc.indexOf(w) > -1; });
    return mentionsName && mentionsChip && !hasInsight;
  }
  function cleanReason(reason, s) {
    if (!reason) return reason;
    // Protect decimals (e.g. "4.5" ratings, "29.50" prices) so the sentence
    // splitter never breaks mid-number and leaves a dangling "...with a 4.".
    var prot = reason.replace(/(\d)\.(\d)/g, '$1\u0001$2');
    var sentences = prot.match(/[^.!?;]+[.!?;]*/g) || [prot];
    var kept = sentences.filter(function (sentP) {
      var lc = sentP.replace(/\u0001/g, '.').toLowerCase();
      if (/\brefundable\b/.test(lc) && !/non-?\s*refundable|not\s+refundable/.test(lc) && !s.loRef) return false;
      for (var i = 0; i < CLAIM_RULES.length; i++) {
        var rule = CLAIM_RULES[i];
        var hit = false;
        for (var j = 0; j < rule.kw.length; j++) { if (lc.indexOf(rule.kw[j]) > -1) { hit = true; break; } }
        if (hit && !rule.ok(s)) return false;
      }
      return true;
    });
    var out = kept.join(' ').replace(/\u0001/g, '.').replace(/\s+/g, ' ').trim();
    // Belt-and-braces: never show a clause that ends on a hanging word/number.
    if (out.length < 8 || /\b(a|an|the|with|of|and|to|at|for|in|on)\s*\d*[.,]?$/i.test(out)) out = safeReason(s);
    // If it just restates the chips (name + star/rating, no insight), use a fact line.
    if (restatesOnly(out, s)) out = safeReason(s);
    return out || safeReason(s);
  }
  function introLine() {
    var place = criteria && criteria.locationName ? String(criteria.locationName).split(',')[0] : 'your search';
    if (CFG.greeting) return CFG.greeting.replace(/\{place\}/g, place).replace(/\{count\}/g, String(summaries.length));
    return 'From ' + summaries.length + ' properties, here are the ones worth a look for ' + place + ':';
  }

  // Stage 3 of the contract: tell the results widget to show only these rids.
  function dispatchView(rids) {
    var ids = (rids || []).map(function (x) { return String(x).trim(); }).filter(Boolean);
    if (!activeSession || !ids.length) return;
    window.dispatchEvent(new CustomEvent(activeView, { detail: { version: 1, searchSession: activeSession, rids: ids } }));
  }

  // Engagement analytics: push to window.dataLayer (GTM/GA-friendly) and an
  // optional TravelgenixWidgets.onTravelResultsAiEvent(name, detail) hook.
  function track(name, detail) {
    if (!CFG.analytics) return;
    detail = detail || {};
    try { window.dataLayer = window.dataLayer || []; window.dataLayer.push({ event: 'tg_trai_' + name, tgTraiWidget: 'travel-results-ai', tgTrai: detail }); } catch (e) {}
    try { var ns = window.TravelgenixWidgets; if (ns && typeof ns.onTravelResultsAiEvent === 'function') ns.onTravelResultsAiEvent(name, detail); } catch (e) {}
  }

  // Mobile bottom-sheet vs anchored panel.
  function isSheet() { return CFG.mobileSheet && (window.innerWidth || 9999) <= 560; }
  function layout() {
    if (!host || !els.panel) return;
    var panelVisible = els.panel.style.display !== 'none';
    if (isSheet() && panelVisible) {
      els.panel.setAttribute('data-pos', 'sheet');
      var s = host.style;
      s.left = '0'; s.right = '0'; s.bottom = '0'; s.top = 'auto'; s.transform = 'none';
      els.panel.style.width = '100%';
      els.panel.style.maxHeight = Math.min(CFG.height, Math.round((window.innerHeight || 640) * 0.85)) + 'px';
    } else {
      els.panel.setAttribute('data-pos', CFG.position);
      positionHost();
      applySize();
    }
  }

  // ---- event wiring ----
  var pendingAppear = null;
  function onReady(ev, t) {
    if (CFG.enabled === false) return;
    var p = ev && ev.detail;
    if (!p || typeof p !== 'object' || !Array.isArray(p.results) || !p.criteria) return;
    if (t) { activeKind = t.kind; activeView = t.view; }
    // Appearance timing: show as soon as the results are ready, or hold back for
    // a configured number of seconds. A fresh results event cancels a pending one.
    if (pendingAppear) { clearTimeout(pendingAppear); pendingAppear = null; }
    if (CFG.appearMode === 'delay' && CFG.appearDelay > 0 && !PREVIEW) {
      pendingAppear = setTimeout(function () { pendingAppear = null; startWith(p); }, CFG.appearDelay * 1000);
    } else {
      startWith(p);
    }
  }
  function prepNonAuto(p) {
    setSub('Results ready — ask me anything.'); clearBody();
    criteria = p.criteria; currency = p.criteria.currency || 'GBP'; activeSession = p.searchSession;
    summaries = p.results.filter(function (r) { return r && r.rid && Array.isArray(r.units); }).map(summarise);
    setFootEnabled(true);
  }
  function startWith(p) {
    lastPayload = p; analysed = false; opened = false; awaitingReveal = false;
    sharedFlight = p.flight || null;
    mount();
    var saved = restoreUI();
    var launcher = CFG.startMode === 'launcher' && !PREVIEW;

    // "Appear when suggestions are ready": stay hidden, analyse in the
    // background, and let renderRecs reveal the widget once it has picks.
    // (Nothing shows for an empty/no-suggestion result.)
    if (CFG.appearMode === 'suggestions' && CFG.startMode === 'open' && AUTO && !PREVIEW) {
      awaitingReveal = true;
      if (els.panel) els.panel.style.display = 'none';
      if (els.launcher) els.launcher.style.display = 'none';
      if (saved) applySavedState(saved);
      processInitial(p);
      return;
    }

    track('appear', { mode: launcher ? 'launcher' : 'open' });
    if (launcher) {
      showLauncher();
      if (!AUTO) prepNonAuto(p);
      else if (!CFG.deferAnalysis) processInitial(p);   // pre-warm into the hidden panel
      if (saved) applySavedState(saved);
      if (saved && saved.opened) openPanel();
    } else {
      showPanel(); opened = true; track('open', {});
      if (!AUTO) prepNonAuto(p);
      else processInitial(p);
      if (saved) applySavedState(saved);
    }
  }
  // Reveal the widget once suggestions are ready (appearMode='suggestions').
  function revealNow() {
    if (!awaitingReveal) return;
    awaitingReveal = false;
    var launcher = CFG.startMode === 'launcher' && !PREVIEW;
    track('appear', { mode: launcher ? 'launcher' : 'open', when: 'suggestions' });
    if (launcher) { showLauncher(); }
    else { showPanel(); opened = true; track('open', {}); }
  }

  // ---- launcher / open-state helpers ----
  function announce(msg) { if (els.live) { els.live.textContent = ''; els.live.textContent = msg; } }
  function showPanel() { if (els.launcher) els.launcher.style.display = 'none'; if (els.panel) els.panel.style.display = 'flex'; layout(); }
  function showLauncher() { if (els.panel) els.panel.style.display = 'none'; if (els.launcher) els.launcher.style.display = 'inline-flex'; layout(); }
  function openPanel() {
    opened = true; showPanel();
    if (els.launcher) els.launcher.setAttribute('aria-expanded', 'true');
    if (AUTO && !analysed && lastPayload) processInitial(lastPayload);
    if (els.input) { try { els.input.focus(); } catch (e) {} }
    track('open', {}); persistUI();
  }
  function collapseToLauncher() {
    opened = false; showLauncher();
    if (els.launcher) { els.launcher.setAttribute('aria-expanded', 'false'); try { els.launcher.focus(); } catch (e) {} }
    persistUI();
  }
  function uiKey() { return 'tgtrai:ui'; }
  function persistUI() {
    if (!CFG.rememberState) return;
    try {
      sessionStorage.setItem(uiKey(), JSON.stringify({
        opened: opened,
        min: !!(els.panel && els.panel.classList.contains('is-min')),
        docked: !!els._docked,
        fx: els._fx == null ? null : els._fx,
        fy: els._fy == null ? null : els._fy
      }));
    } catch (e) {}
  }
  function restoreUI() {
    if (!CFG.rememberState) return null;
    try { return JSON.parse(sessionStorage.getItem(uiKey()) || 'null'); } catch (e) { return null; }
  }
  function applySavedState(s) {
    if (!s) return;
    if (CFG.position === 'float') {
      if (s.fx != null && s.fy != null) { els._dragged = true; els._fx = s.fx; els._fy = s.fy; }
      else if (s.docked) { els._docked = true; }
      positionHost();
    }
    if (s.min && els.panel) els.panel.classList.add('is-min');
  }

  function boot() {
    if (booted) return; booted = true;
    SEARCH_TYPES.forEach(function (t) {
      window.addEventListener(t.ready, function (ev) { onReady(ev, t); });
    });
  }
  // Register immediately — the presence flag and the results-ready listener must
  // be live as early as possible (the results event can arrive any time after).
  // DOM access is deferred to mount(), which runs only when the event fires.
  boot();

  // Per the integration contract: expose only under the documented
  // TravelgenixWidgets namespace, never as new top-level globals.
  window.TravelgenixWidgets.travelResultsAiVersion = VERSION;
  window.TravelgenixWidgets.travelResultsAiViewSelected = function (rids) { dispatchView(rids); };

  // ===================== styles + markup =====================
  var STYLES = '<style>' +
    ':host{all:initial}' +
    '.sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}' +
    '*{box-sizing:border-box;font-family:var(--trai-font,Inter,-apple-system,"Segoe UI",sans-serif)}' +
    '#panel{' +
      '--navy:#1B2B5B;--navy-l:#2A3F7A;--teal:#00B4D8;--teal-d:#0096B7;--teal-l:#48CAE4;--ok:#10B981;' +
      '--warnbg:#FEF6E7;--warnbd:#FCD9A6;--warnink:#B45309;' +
      '--bg:#F5F8FB;--card:#FFFFFF;--well:#F1F5F9;--bd:#E2E8F0;--bd-l:#EEF2F7;' +
      '--ink:#0F172A;--ink-2:#475569;--ink-3:#94A3B8;--bub-a-bg:#EDF4FA;--bub-a-bd:#D4E3EF;' +
      'width:min(380px,calc(100vw - 24px));max-height:min(78vh,640px);display:flex;flex-direction:column;overflow:hidden;' +
      'border-radius:14px;background:var(--card);color:var(--ink);border:1px solid var(--bd);box-shadow:0 20px 44px -16px rgba(27,43,91,.34)}' +
    '#panel.is-min #body,#panel.is-min #foot{display:none}' +
    '.hd{display:flex;align-items:center;gap:11px;padding:13px 15px;background:linear-gradient(135deg,var(--navy),var(--navy-d,#111D3E));color:#fff}' +
    '.spark{width:30px;height:30px;border-radius:8px;background:rgba(255,255,255,.13);display:grid;place-items:center;flex:none}' +
    '.spark svg{width:16px;height:16px;stroke:#fff;fill:none;stroke-width:1.8;stroke-linejoin:round}' +
    '.spark{position:relative;animation:tgSparkRing 2.4s ease-out infinite}' +
    '.spark svg{transform-origin:center;animation:tgSparkPulse 2.4s ease-in-out infinite}' +
    '@keyframes tgSparkPulse{0%,100%{transform:scale(1) rotate(0)}45%{transform:scale(1.16) rotate(5deg)}55%{transform:scale(1.16) rotate(-5deg)}}' +
    '@keyframes tgSparkRing{0%{box-shadow:0 0 0 0 rgba(0,180,216,.55)}70%,100%{box-shadow:0 0 0 9px rgba(0,180,216,0)}}' +
    '.grip{display:none}' +
    '#panel[data-pos="sheet"] .hd{position:relative;padding-top:18px}' +
    '#panel[data-pos="sheet"] .grip{display:block;position:absolute;top:7px;left:50%;transform:translateX(-50%);width:36px;height:4px;border-radius:999px;background:rgba(255,255,255,.5)}' +
    '.hd h2{margin:0;font-size:.96rem;font-weight:800}.hd p{margin:1px 0 0;font-size:.74rem;color:#bcd3e6}' +
    '.mn{margin-left:auto;cursor:pointer;display:grid;place-items:center;width:30px;height:30px;color:#bcd3e6;background:none;border:none;border-radius:7px}' +
    '.mn svg{width:16px;height:16px;stroke:currentColor;stroke-width:2;fill:none;stroke-linecap:round}' +
    '.mn:hover{color:#fff;background:rgba(255,255,255,.1)}.mn:focus-visible{outline:2px solid #85b6ee;outline-offset:2px}' +
    '#panel[data-pos="float"] .hd{cursor:grab;touch-action:none;user-select:none}' +
    '#panel[data-pos="float"] .hd.tg-grabbing{cursor:grabbing}' +
    '#launcher{display:none;align-items:center;gap:9px;border:none;cursor:pointer;font:inherit;font-weight:700;font-size:.9rem;color:#fff;background:linear-gradient(135deg,var(--l-navy,#1B2B5B),var(--l-navy-d,#111D3E));padding:11px 16px 11px 12px;border-radius:999px;box-shadow:0 16px 36px -12px rgba(27,43,91,.42);max-width:min(320px,calc(100vw - 28px));transition:transform .12s ease,box-shadow .12s ease}' +
    '#launcher:hover{transform:translateY(-1px);box-shadow:0 22px 42px -12px rgba(27,43,91,.5)}' +
    '#launcher:focus-visible{outline:2px solid var(--l-teal,#00B4D8);outline-offset:3px}' +
    '#launcher .spark{width:28px;height:28px;background:rgba(255,255,255,.16)}' +
    '#launcher #launcher-text{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '@media(prefers-reduced-motion:reduce){#launcher{transition:none}#launcher:hover{transform:none}.spark,.spark svg{animation:none}}' +
    '#body{position:relative;padding:14px 15px;overflow:auto;background:var(--bg);display:flex;flex-direction:column;gap:9px;min-height:120px}' +
    '.st{display:flex;align-items:center;gap:9px;color:var(--ink-2);font-size:.85rem;padding:4px 0}' +
    '.dot{width:9px;height:9px;border-radius:50%;background:var(--teal);flex:none}' +
    '.dot.think{animation:tgp 1.4s infinite}' +
    '@keyframes tgp{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--teal) 50%,transparent)}70%{box-shadow:0 0 0 9px transparent}100%{box-shadow:0 0 0 0 transparent}}' +
    '@media(prefers-reduced-motion:reduce){.dot.think{animation:none}}' +
    '.bub{max-width:92%;padding:9px 12px;border-radius:11px;font-size:.86rem;line-height:1.45;border:1px solid var(--bd);background:var(--card)}' +
    '.bub.a{color:var(--ink-2);background:var(--bub-a-bg);border-color:var(--bub-a-bd);align-self:flex-start}' +
    '.bub.u{color:#fff;background:var(--navy);border-color:var(--navy);align-self:flex-end}' +
    '.rec{border:1px solid var(--bd);border-radius:12px;padding:11px 12px;background:var(--card)}' +
    '.cat{display:inline-block;font-size:.64rem;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--teal-d);background:color-mix(in srgb,var(--teal) 14%,transparent);border-radius:6px;padding:3px 7px;margin-bottom:6px}' +
    '.nm{font-weight:800;font-size:.94rem;line-height:1.25;color:var(--ink)}' +
    '.facts{display:flex;flex-wrap:wrap;gap:5px;margin:7px 0}' +
    '.f{font-size:.71rem;font-weight:600;color:var(--ink-2);background:var(--well);border:1px solid var(--bd-l);border-radius:6px;padding:2px 7px}' +
    '.f.price{color:var(--navy);font-weight:800}.f.warn{color:var(--warnink);border-color:var(--warnbd);background:var(--warnbg)}' +
    '.f.ok{color:#047857;border-color:rgba(16,185,129,.35);background:rgba(16,185,129,.12);font-weight:700}' +
    '.why{font-size:.82rem;line-height:1.5;color:var(--ink-2);margin:5px 0 0}' +
    '.go{margin-top:2px;min-height:44px;border:none;border-radius:10px;background:var(--teal);color:#fff;font:inherit;font-weight:800;font-size:.86rem;padding:11px;cursor:pointer}' +
    '.go:hover{filter:brightness(.96)}.go:focus-visible{outline:2px solid var(--teal);outline-offset:2px}' +
    '#foot{display:flex;flex-direction:column;gap:8px;padding:11px 13px;border-top:1px solid var(--bd);background:var(--card)}' +
    '#inrow{display:flex;gap:8px}' +
    '#chips{display:none;flex-wrap:wrap;gap:6px}' +
    '.chip{border:1px solid var(--bd);background:var(--well);color:var(--ink-2);border-radius:999px;padding:6px 11px;font:inherit;font-size:.76rem;font-weight:600;cursor:pointer;white-space:nowrap}' +
    '.chip:hover{border-color:var(--teal);color:var(--teal-d)}' +
    '.chip:focus-visible{outline:2px solid var(--teal);outline-offset:2px}' +
    '.rec.clickable{cursor:pointer;transition:border-color .12s ease,box-shadow .12s ease}' +
    '.rec.clickable:hover{border-color:var(--teal);box-shadow:0 6px 18px -10px rgba(27,43,91,.4)}' +
    '.rec.clickable:focus-visible{outline:2px solid var(--teal);outline-offset:2px}' +
    '.rec.is-shown{border-color:var(--teal)}' +
    '.rec-view{display:inline-flex;align-items:center;gap:3px;margin-top:8px;font-size:.74rem;font-weight:800;color:var(--teal-d)}' +
    '#panel[data-pos="sheet"]{width:100%;border-radius:16px 16px 0 0}' +
    '@media(prefers-reduced-motion:reduce){.rec.clickable{transition:none}}' +
    '#input{flex:1;min-height:44px;border:1px solid var(--bd);border-radius:9px;padding:9px 11px;font:inherit;font-size:.86rem;color:var(--ink);background:var(--card);outline:none}' +
    '#input:focus{border-color:var(--teal);box-shadow:0 0 0 3px color-mix(in srgb,var(--teal) 18%,transparent)}' +
    '#send{min-height:44px;border:none;border-radius:9px;background:var(--navy);color:#fff;font:inherit;font-weight:800;font-size:.84rem;padding:0 14px;cursor:pointer}' +
    '#send:hover{background:var(--navy-l)}#send:focus-visible{outline:2px solid var(--teal);outline-offset:2px}' +
    '#panel[data-theme="dark"]{--bg:#0F1828;--card:#141E33;--well:#0F1828;--bd:#243049;--bd-l:#243049;--ink:#E8EDF5;--ink-2:#A9B6CC;--ink-3:#697892;--bub-a-bg:#14233F;--bub-a-bd:#243049}' +
    '@media(prefers-color-scheme:dark){#panel[data-theme="auto"]{--bg:#0F1828;--card:#141E33;--well:#0F1828;--bd:#243049;--bd-l:#243049;--ink:#E8EDF5;--ink-2:#A9B6CC;--ink-3:#697892;--bub-a-bg:#14233F;--bub-a-bd:#243049}}' +
    '</style>';

  var MARKUP =
    '<button id="launcher" type="button" aria-label="Open the AI trip assistant" aria-haspopup="dialog" aria-controls="panel" aria-expanded="false">' +
      '<span class="spark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 2.5l2.2 6.3 6.3 2.2-6.3 2.2L12 19.5l-2.2-6.3L3.5 11l6.3-2.2z"/></svg></span>' +
      '<span id="launcher-text">Ask AI to pick your best matches</span>' +
    '</button>' +
    '<section id="panel" data-theme="auto" role="complementary" aria-label="AI trip assistant">' +
      '<div id="live" class="sr" aria-live="polite"></div>' +
      '<header class="hd">' +
        '<span class="grip" aria-hidden="true"></span>' +
        '<span class="spark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 2.5l2.2 6.3 6.3 2.2-6.3 2.2L12 19.5l-2.2-6.3L3.5 11l6.3-2.2z"/></svg></span>' +
        '<div><h2 id="title">AI trip assistant</h2><p id="sub">Waiting for results\u2026</p></div>' +
        '<button class="mn" id="min" type="button" aria-label="Minimise assistant"><svg viewBox="0 0 24 24" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/></svg></button>' +
      '</header>' +
      '<div id="body"></div>' +
      '<div id="foot">' +
        '<div id="chips" role="group" aria-label="Quick refinements"></div>' +
        '<div id="inrow">' +
          '<input id="input" type="text" aria-label="Ask the assistant for something different" placeholder="Ask: more central, with a pool, cheaper\u2026" maxlength="200" autocomplete="off" />' +
          '<button id="send" type="button">Send</button>' +
        '</div>' +
      '</div>' +
    '</section>';
})();
