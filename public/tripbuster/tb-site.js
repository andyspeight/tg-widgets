/*
 * Tripbuster consumer site — shared helpers.
 *
 * Used by index.html, search.html and deal.html. One place for the API calls,
 * escaping, money formatting and card markup, so a fix on one page fixes all
 * three.
 *
 * Everything that reaches innerHTML goes through esc() first. Deal text is
 * written by travel agents, so these pages treat it as untrusted even though an
 * agent had to sign in to enter it.
 */
(function () {
  'use strict';

  var API = '/api/tripbuster';

  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  // Only absolute http(s) links leave these pages, and they always carry
  // rel="noopener nofollow" — the destination is a third-party site.
  function safeUrl(u) {
    if (!u) return '';
    try {
      var url = new URL(String(u).trim());
      return (url.protocol === 'http:' || url.protocol === 'https:') ? url.toString() : '';
    } catch (e) {
      return '';
    }
  }

  var SYMBOLS = { GBP: '£', EUR: '€', USD: '$' };
  function money(amount, currency) {
    var n = Number(amount);
    if (!isFinite(n)) return '';
    return (SYMBOLS[currency] || SYMBOLS.GBP) + n.toLocaleString('en-GB');
  }
  function num(n) { return Number(n || 0).toLocaleString('en-GB'); }

  // Deterministic gradient per destination, so a deal with no photo still looks
  // deliberate and looks the same on every page.
  function gradClass(seed) {
    var s = String(seed || '');
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (h + s.charCodeAt(i)) % 6;
    return 'g' + h;
  }

  var IC = {
    pin: '<path d="M21 10c0 7-9 12-9 12s-9-5-9-12a9 9 0 0 1 18 0Z"/><circle cx="12" cy="10" r="3"/>',
    moon: '<path d="M12 2v4M12 18v4M2 12h4M18 12h4"/><circle cx="12" cy="12" r="4"/>',
    plane: '<path d="M2 22h20M6 18l14-4M6 18l-2-6 3-1 4 3 5-1L9 3l2-1 8 8"/>',
    board: '<path d="M3 11h18M5 11V7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v4M4 11v7M20 11v7"/>',
    cal: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    shield: '<path d="M12 2 4 5v6c0 5 3.5 8.5 8 11 4.5-2.5 8-6 8-11V5l-8-3Z"/><path d="m9 12 2 2 4-4"/>',
    arrow: '<path d="M7 17 17 7M9 7h8v8"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    chev: '<path d="m6 9 6 6 6-6"/>',
    people: '<circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0"/>'
  };
  function svg(paths, extra) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"' +
      (extra ? ' ' + extra : '') + '>' + paths + '</svg>';
  }
  function starsMarkup(n) {
    var out = '';
    for (var i = 0; i < (Number(n) || 0); i++) {
      out += '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z"/></svg>';
    }
    return out ? '<span class="stars" role="img" aria-label="' + Number(n) + ' star hotel">' + out + '</span>' : '';
  }
  function scoreColour(s) { return s >= 9 ? '#0CA678' : s >= 8 ? '#12A0D4' : '#5B93B0'; }
  function scoreWord(s) { return s >= 9 ? 'Superb' : s >= 8.5 ? 'Excellent' : s >= 8 ? 'Very good' : 'Good'; }

  /** GET the public deals feed. Returns { deals, total, ... } or throws. */
  async function fetchDeals(params) {
    var qs = new URLSearchParams();
    Object.keys(params || {}).forEach(function (k) {
      var v = params[k];
      if (v !== '' && v !== null && v !== undefined) qs.append(k, v);
    });
    var res = await fetch(API + '/deals?' + qs.toString(), { headers: { Accept: 'application/json' } });
    var data = null;
    try { data = await res.json(); } catch (e) { /* empty body */ }
    if (!res.ok) {
      var err = new Error((data && data.error) || 'Could not load deals');
      err.status = res.status;
      throw err;
    }
    return data || { deals: [], total: 0 };
  }

  /**
   * Report a click-out, then hand back so the caller can navigate.
   *
   * Fired at the moment the traveller commits to leaving, NOT when an
   * interstitial opens — counting a click the agent never received would
   * over-bill them. sendBeacon is used because the browser delivers it even as
   * the page unloads, which is exactly what happens next.
   */
  function reportClick(dealId, surface) {
    if (!dealId) return;
    beacon('/click', { dealId: dealId, surface: surface || 'site' });
  }

  /** Report that a set of deals was shown. Batched: one call per page render. */
  function reportImpressions(deals, surface) {
    var ids = (deals || []).map(function (d) { return d && d.id; }).filter(Boolean);
    if (!ids.length) return;
    beacon('/impressions', { dealIds: ids, surface: surface || 'site' });
  }

  function beacon(path, payload) {
    try {
      var body = JSON.stringify(payload);
      if (navigator.sendBeacon) {
        // text/plain avoids a CORS preflight a beacon cannot complete; the
        // endpoint parses either shape.
        if (navigator.sendBeacon(API + path, new Blob([body], { type: 'text/plain;charset=UTF-8' }))) return;
      }
      fetch(API + path, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true,
      }).catch(function () {});
    } catch (e) { /* tracking must never break the journey */ }
  }

  function chipsFor(d) {
    var out = [];
    if (d.nights) out.push('<span class="chip">' + svg(IC.moon) + esc(d.nights) + ' nights</span>');
    if (d.board) out.push('<span class="chip">' + svg(IC.board) + esc(d.board) + '</span>');
    if (d.airport) out.push('<span class="chip">' + svg(IC.plane) + esc(d.airport) + '</span>');
    if (d.dates) out.push('<span class="chip">' + svg(IC.cal) + esc(d.dates) + '</span>');
    return out.join('');
  }

  function priceBlock(d) {
    return '<div class="price">' +
      (d.wasPrice ? '<div class="strike tnum">' + esc(money(d.wasPrice, d.currency)) + '</div>' : '') +
      (d.priceFrom != null
        ? '<div class="amt tnum">' + esc(money(d.priceFrom, d.currency)) + '<small> pp</small></div>'
        : '<div class="amt">Ask the agent</div>') +
      '</div>';
  }

  function bgStyle(d) {
    var img = safeUrl(d.image);
    return img ? ' style="background-image:url(' + esc(img) + ')"' : '';
  }

  /** Grid card, used on the front page. Links through to the deal page. */
  function dealCard(d) {
    var href = '/tripbuster/deal?id=' + encodeURIComponent(d.id || '');
    return '<a class="dc" href="' + esc(href) + '">' +
      '<div class="dc-img ' + gradClass(d.resort || d.title) + '"' + bgStyle(d) + '>' +
        (d.discount ? '<span class="tag">-' + esc(d.discount) + '%</span>' : '') +
        (d.badge ? '<span class="tag-dark">' + esc(d.badge) + '</span>' : '') +
        '<span class="dc-place">' + esc(d.resort || '') +
          (d.country ? '<small>' + esc(d.country) + '</small>' : '') + '</span>' +
      '</div>' +
      '<div class="dc-body">' +
        '<h3 class="dc-title">' + esc(d.title) + '</h3>' +
        '<div class="chips">' + chipsFor(d) + '</div>' +
        '<div class="byagent">by <b>' + esc(d.agent && d.agent.name) + '</b>' +
          (d.atol ? '<span class="prot">' + svg(IC.shield) + 'ATOL ' + esc(d.atol) + '</span>' : '') +
          (d.agentCount > 1
            ? '<span>+' + (d.agentCount - 1) + ' more agent' + (d.agentCount > 2 ? 's' : '') + '</span>'
            : '') +
        '</div>' +
      '</div>' +
      '<div class="dc-foot">' + priceBlock(d) +
        '<span class="btn btn-dark">View deal ' + svg(IC.arrow) + '</span>' +
      '</div>' +
    '</a>';
  }

  /** Shared page chrome, so the header and footer cannot drift between pages. */
  function header(active) {
    var link = function (href, label) {
      return '<a href="' + href + '"' + (active === label ? ' aria-current="page"' : '') + '>' + label + '</a>';
    };
    return '<a class="skip" href="#main">Skip to content</a>' +
      '<nav class="nav"><div class="wrap nav-in">' +
      '<a class="brand" href="/tripbuster" aria-label="Tripbuster home">' +
        '<span class="ticket">' + svg('<path d="M2 12h20M14 5l7 7-7 7M6 8v8"/>') + '</span>' +
        '<span class="brand-name">Trip<b>buster</b></span></a>' +
      '<div class="nav-links">' +
        link('/tripbuster/search?board=All+inclusive', 'All inclusive') +
        link('/tripbuster/search?maxPrice=299', 'Under £299') +
        link('/tripbuster/search?sort=discount', 'Biggest savings') +
      '</div>' +
      '<div class="nav-right"><a class="nav-cta" href="/tripbuster/dashboard">List your deals</a></div>' +
      '</div></nav>';
  }

  function footer() {
    return '<footer class="foot"><div class="wrap foot-in">' +
      '<span class="atol">' + svg(IC.shield) +
      ' Holidays are sold and financially protected by the advertising agent, not by Tripbuster.</span>' +
      '<span>&copy; 2026 Tripbuster &middot; a Travelgenix product</span>' +
      '</div></footer>';
  }

  window.TB = {
    API: API,
    esc: esc, safeUrl: safeUrl, money: money, num: num, gradClass: gradClass, bgStyle: bgStyle,
    IC: IC, svg: svg, starsMarkup: starsMarkup, scoreColour: scoreColour, scoreWord: scoreWord,
    fetchDeals: fetchDeals, reportClick: reportClick, reportImpressions: reportImpressions,
    chipsFor: chipsFor, priceBlock: priceBlock, dealCard: dealCard,
    header: header, footer: footer,
  };
})();
