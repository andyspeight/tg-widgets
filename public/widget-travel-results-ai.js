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

  var VERSION = '1.1.0';
  var EV_READY = 'tg:travel-results-v4:accommodation-results-ready';
  var EV_VIEW = 'tg:travel-results-v4:accommodation-airesults-view';
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
    position: 'br',                                     // 'br' | 'bl'
    maxRecs: 6
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
    if (c.position === 'br' || c.position === 'bl') o.position = c.position;
    v = parseInt(c.maxRecs, 10); if (!isNaN(v)) o.maxRecs = Math.max(1, Math.min(6, v));
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

  function summarise(r) {
    var rs = ratesOf(r);
    var lo = lowest(rs);
    var loRef = lowest(rs.filter(function (x) { return x.refundability === 'Refundable'; }));
    return {
      rid: String(r.rid), name: r.name || 'Property', star: r.starRating || 0,
      address: r.address || '', city: cityOf(r.address),
      lo: lo, loRef: loRef,
      distKm: distKm(criteria && criteria.latitude, criteria && criteria.longitude, r.latitude, r.longitude),
      goodFor: r.goodFor || [], amen: r.amenities || [], ta: r.tripadvisor || null,
      desc: r.description || '', warns: warningsOf(r, rs)
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
    return {
      rid: s.rid, n: s.name, star: s.star, p: s.lo ? Math.round(s.lo.price) : null,
      board: s.lo ? s.lo.board : null, ref: !!s.loRef, city: s.city,
      km: s.distKm != null ? Math.round(s.distKm) : null,
      gf: s.goodFor, am: (s.amen || []).slice(0, 4),
      ta: s.ta ? [s.ta.rating, s.ta.reviewCount] : null, w: s.warns, d: (s.desc || '').slice(0, 110)
    };
  }
  function trimCriteria() {
    return {
      locationName: criteria.locationName, checkinDate: criteria.checkinDate, checkoutDate: criteria.checkoutDate,
      nights: criteria.nights, passengers: criteria.passengers, rooms: criteria.rooms,
      boardBasis: criteria.boardBasis, refundableOnly: criteria.refundableOnly,
      minStarRating: criteria.minStarRating, currency: currency
    };
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
    els.title = root.getElementById('title');
    els.min.addEventListener('click', function () { els.panel.classList.toggle('is-min'); });
    els.send.addEventListener('click', sendMessage);
    els.input.addEventListener('keydown', function (e) { if (e.key === 'Enter') sendMessage(); });
    applyConfig();
    setFootEnabled(false);
  }
  function applyConfig() {
    if (!host || !els.panel) return;
    host.style.right = CFG.position === 'bl' ? 'auto' : '18px';
    host.style.left = CFG.position === 'bl' ? '18px' : 'auto';
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
  }
  function scroll() { if (els.body) els.body.scrollTop = els.body.scrollHeight; }

  function renderRecs(reply, recs, append) {
    if (!append) clearBody();
    if (reply) addBubble('assistant', reply);
    if (!recs.length) {
      els.body.appendChild(stateLine('No clear matches for that \u2014 try a different ask.'));
      setFootEnabled(true); scroll(); return;
    }
    recs.forEach(function (r) {
      var s = r.s;
      var card = document.createElement('div'); card.className = 'rec';
      var cat = document.createElement('span'); cat.className = 'cat'; cat.textContent = r.category; card.appendChild(cat);
      var nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = s.name; card.appendChild(nm);
      var facts = document.createElement('div'); facts.className = 'facts';
      function fact(t, cls) { var f = document.createElement('span'); f.className = 'f' + (cls ? ' ' + cls : ''); f.textContent = t; facts.appendChild(f); }
      if (s.lo) fact(money(s.lo.price) + ' total', 'price');
      if (s.lo) fact(money(nightly(s.lo.price)) + '/night');
      if (s.star > 0) fact(s.star + '-star');
      if (s.ta && s.ta.rating) fact('TA ' + s.ta.rating + ' (' + s.ta.reviewCount + ')');
      if (s.distKm != null) fact(Math.round(s.distKm) + ' km');
      if (s.loRef) fact('refundable');
      (s.warns || []).forEach(function (w) { fact(w, 'warn'); });
      card.appendChild(facts);
      var why = document.createElement('p'); why.className = 'why'; why.textContent = r.reason; card.appendChild(why);
      els.body.appendChild(card);
    });
    var act = document.createElement('button'); act.className = 'go'; act.type = 'button';
    act.textContent = CFG.viewLabel;
    act.addEventListener('click', function () { dispatchView(recs.map(function (r) { return r.rid; })); });
    els.body.appendChild(act);
    setFootEnabled(true);
    scroll();
  }
  function renderError() {
    clearBody();
    els.body.appendChild(stateLine('Could not analyse these results right now.'));
    setFootEnabled(true);
  }

  // ---- flows ----
  function processInitial(payload) {
    activeSession = payload.searchSession;
    criteria = payload.criteria || {};
    currency = criteria.currency || 'GBP';
    history = [];
    summaries = (payload.results || []).filter(function (r) { return r && r.rid && Array.isArray(r.units); }).map(summarise);

    setSub('Analysing ' + (payload.results || []).length + ' results\u2026');
    clearBody();
    els.body.appendChild(stateLine('Reading ' + (payload.results || []).length + ' results, finding the best for your trip\u2026', true));
    setFootEnabled(false);

    var cands = candidatesFor('');
    if (PREVIEW) {
      var precs = fallbackRecs(cands, CFG.maxRecs); currentRecs = precs;
      setSub('Suggested ' + precs.length + ' option' + (precs.length === 1 ? '' : 's') + '.');
      renderRecs(introLine(), precs);
      return;
    }
    callEndpoint('', cands).then(function (data) {
      if (payload.searchSession !== activeSession) return; // stale guard
      var recs = mapRecs(data.recommendations, cands, CFG.maxRecs);
      if (!recs.length) { recs = fallbackRecs(cands, CFG.maxRecs); data = { reply: '' }; }
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
    // also allow any summary (in case the model picked from the broader set is prevented server-side; here cands only)
    return (list || []).filter(function (r) { return r && byRid[r.rid]; }).slice(0, max || 6)
      .map(function (r) { return { rid: r.rid, category: r.category || 'Suggested', reason: r.reason || '', s: byRid[r.rid] }; });
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
    window.dispatchEvent(new CustomEvent(EV_VIEW, { detail: { version: 1, searchSession: activeSession, rids: ids } }));
  }

  // ---- event wiring ----
  function onReady(ev) {
    if (CFG.enabled === false) return;
    var p = ev && ev.detail;
    if (!p || typeof p !== 'object' || !Array.isArray(p.results) || !p.criteria) return;
    mount();
    if (!AUTO) { setSub('Results ready — ask me anything.'); clearBody(); criteria = p.criteria; currency = p.criteria.currency || 'GBP'; activeSession = p.searchSession; summaries = p.results.filter(function (r) { return r && r.rid && Array.isArray(r.units); }).map(summarise); setFootEnabled(true); return; }
    processInitial(p);
  }

  function boot() {
    if (booted) return; booted = true;
    window.addEventListener(EV_READY, onReady);
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
    '.hd h2{margin:0;font-size:.96rem;font-weight:800}.hd p{margin:1px 0 0;font-size:.74rem;color:#bcd3e6}' +
    '.mn{margin-left:auto;cursor:pointer;display:grid;place-items:center;width:30px;height:30px;color:#bcd3e6;background:none;border:none;border-radius:7px}' +
    '.mn svg{width:16px;height:16px;stroke:currentColor;stroke-width:2;fill:none;stroke-linecap:round}' +
    '.mn:hover{color:#fff;background:rgba(255,255,255,.1)}.mn:focus-visible{outline:2px solid #85b6ee;outline-offset:2px}' +
    '#body{padding:14px 15px;overflow:auto;background:var(--bg);display:flex;flex-direction:column;gap:9px;min-height:120px}' +
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
    '.why{font-size:.82rem;line-height:1.5;color:var(--ink-2);margin:5px 0 0}' +
    '.go{margin-top:2px;min-height:44px;border:none;border-radius:10px;background:var(--teal);color:#fff;font:inherit;font-weight:800;font-size:.86rem;padding:11px;cursor:pointer}' +
    '.go:hover{filter:brightness(.96)}.go:focus-visible{outline:2px solid var(--teal);outline-offset:2px}' +
    '#foot{display:flex;gap:8px;padding:11px 13px;border-top:1px solid var(--bd);background:var(--card)}' +
    '#input{flex:1;min-height:44px;border:1px solid var(--bd);border-radius:9px;padding:9px 11px;font:inherit;font-size:.86rem;color:var(--ink);background:var(--card);outline:none}' +
    '#input:focus{border-color:var(--teal);box-shadow:0 0 0 3px color-mix(in srgb,var(--teal) 18%,transparent)}' +
    '#send{min-height:44px;border:none;border-radius:9px;background:var(--navy);color:#fff;font:inherit;font-weight:800;font-size:.84rem;padding:0 14px;cursor:pointer}' +
    '#send:hover{background:var(--navy-l)}#send:focus-visible{outline:2px solid var(--teal);outline-offset:2px}' +
    '#panel[data-theme="dark"]{--bg:#0F1828;--card:#141E33;--well:#0F1828;--bd:#243049;--bd-l:#243049;--ink:#E8EDF5;--ink-2:#A9B6CC;--ink-3:#697892;--bub-a-bg:#14233F;--bub-a-bd:#243049}' +
    '@media(prefers-color-scheme:dark){#panel[data-theme="auto"]{--bg:#0F1828;--card:#141E33;--well:#0F1828;--bd:#243049;--bd-l:#243049;--ink:#E8EDF5;--ink-2:#A9B6CC;--ink-3:#697892;--bub-a-bg:#14233F;--bub-a-bd:#243049}}' +
    '</style>';

  var MARKUP =
    '<section id="panel" data-theme="auto" role="complementary" aria-label="AI trip assistant" aria-live="polite">' +
      '<header class="hd">' +
        '<span class="spark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 2.5l2.2 6.3 6.3 2.2-6.3 2.2L12 19.5l-2.2-6.3L3.5 11l6.3-2.2z"/></svg></span>' +
        '<div><h2 id="title">AI trip assistant</h2><p id="sub">Waiting for results\u2026</p></div>' +
        '<button class="mn" id="min" type="button" aria-label="Minimise assistant"><svg viewBox="0 0 24 24" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/></svg></button>' +
      '</header>' +
      '<div id="body"></div>' +
      '<div id="foot">' +
        '<input id="input" type="text" aria-label="Ask the assistant for something different" placeholder="Ask: more central, with a pool, cheaper\u2026" maxlength="200" autocomplete="off" />' +
        '<button id="send" type="button">Send</button>' +
      '</div>' +
    '</section>';
})();
