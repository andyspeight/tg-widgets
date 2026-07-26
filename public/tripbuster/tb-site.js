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
    people: '<circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0"/>',
    phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z"/>'
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

  // ── ringing the agency ────────────────────────────────────────────────────

  /**
   * Can this device actually place a call?
   *
   * A coarse pointer with no hover is a phone or a tablet. Deliberately not
   * user-agent sniffing, which is wrong about new devices roughly as soon as
   * they ship. If the answer is no we reveal the number instead of dialling it.
   */
  function dialer() {
    try {
      return window.matchMedia('(hover: none) and (pointer: coarse)').matches;
    } catch (e) {
      return false;
    }
  }

  /** Strip a phone number down to something `tel:` will accept. */
  function telHref(phone) {
    var digits = String(phone || '').replace(/[^\d+]/g, '');
    return digits ? 'tel:' + digits : '';
  }

  /**
   * Report that a traveller went to ring an agency.
   *
   * Fired on the deliberate act — the tap that dials, or the click that reveals
   * the number. Both count, because both mean somebody wants to speak to this
   * agency about this holiday. What we cannot see is whether the phone was
   * answered: we do not own the number.
   */
  function reportCall(dealId, surface) {
    if (!dealId) return;
    beacon('/click', { dealId: dealId, eventType: 'call', surface: surface || 'site' });
  }

  /**
   * The call button.
   *
   * On a phone it is a `tel:` link, so a tap dials and a long press still offers
   * copy and save the way people expect. On a desktop it is a plain button with
   * no href, because "Show number" that reveals itself on hover would be a lie.
   */
  function callCta(entry, opts) {
    var o = opts || {};
    var phone = (entry && entry.phone) || '';
    if (!phone) return '';
    var cls = o.className || 'btn btn-call';
    var id = (entry && (entry.dealId || entry.id)) || '';
    if (dialer()) {
      return '<a class="' + cls + '" data-call="' + esc(id) + '" href="' + esc(telHref(phone)) + '">'
        + svg(IC.phone) + (o.label || 'Call us') + '</a>';
    }
    return '<button class="' + cls + '" type="button" data-call="' + esc(id) + '"'
      + ' data-phone="' + esc(phone) + '">' + svg(IC.phone) + (o.label || 'Show number') + '</button>';
  }

  /**
   * Wire every call button inside `root`.
   *
   * One delegated listener, so buttons added by a later render are covered
   * without re-binding. The event is reported before anything else happens,
   * because on a phone the browser is about to leave for the dialler.
   */
  function wireCalls(root, surface) {
    if (!root || root._tbCallsWired) return;
    root._tbCallsWired = true;
    root.addEventListener('click', function (e) {
      var el = e.target.closest('[data-call]');
      if (!el) return;
      var id = el.getAttribute('data-call');
      reportCall(id, surface);

      var phone = el.getAttribute('data-phone');
      if (!phone) return; // the `tel:` anchor: let the browser dial

      // Desktop: swap the button for the number itself, still as a tel: link so
      // a laptop with a softphone can use it.
      e.preventDefault();
      var shown = document.createElement('a');
      shown.className = el.className + ' is-revealed';
      shown.href = telHref(phone);
      shown.textContent = phone;
      el.replaceWith(shown);
    });
  }

  /** POST a callback request. Resolves with the response, or throws. */
  async function submitLead(payload) {
    var res = await fetch(API + '/lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    var data = null;
    try { data = await res.json(); } catch (e) { /* empty body */ }
    if (!res.ok) {
      var err = new Error((data && data.error) || 'Could not send that just now');
      err.status = res.status;
      err.fieldErrors = (data && data.errors) || null;
      throw err;
    }
    return data || {};
  }

  /**
   * The "ask us to ring you" form.
   *
   * Either a phone number or an email address will do, which is the whole point:
   * plenty of people would rather be emailed, and refusing them loses the
   * enquiry. The line naming the agency is not decoration — someone handing over
   * their number deserves to know exactly who receives it.
   */
  function callbackForm(deal) {
    var agent = (deal.agent && deal.agent.name) || 'the agency';
    return '<form class="cbf" novalidate>'
      + '<h3>Prefer a call back?</h3>'
      + '<p class="cbf-lead">Leave your details and <b>' + esc(agent)
      + '</b> will get in touch about this holiday.</p>'
      + '<div class="cbf-err" role="alert" hidden></div>'
      + '<div class="cbf-row"><label>Your name'
      + '<input name="name" autocomplete="name" required></label></div>'
      + '<div class="cbf-grid">'
      + '<label>Phone<input name="phone" type="tel" autocomplete="tel" '
      + 'placeholder="07700 900123"></label>'
      + '<label>Email<input name="email" type="email" autocomplete="email" '
      + 'placeholder="you@example.co.uk"></label>'
      + '</div>'
      + '<p class="cbf-hint">Either is fine, or both if you like.</p>'
      + '<div class="cbf-row"><label>Best time to call '
      + '<span class="cbf-opt">optional</span>'
      + '<input name="preferredTime" placeholder="Evenings, or weekends"></label></div>'
      + '<div class="cbf-row"><label>Anything else? <span class="cbf-opt">optional</span>'
      + '<textarea name="message" rows="2" placeholder="Dates, how many of you, questions"></textarea>'
      + '</label></div>'
      // Hidden from people, irresistible to bots that fill in every input.
      + '<div class="cbf-hp" aria-hidden="true">'
      + '<label>Website<input name="website" tabindex="-1" autocomplete="off"></label></div>'
      + '<button class="btn btn-primary cbf-go" type="submit">Ask ' + esc(agent) + ' to call me</button>'
      + '<p class="cbf-privacy">Your details go to ' + esc(agent)
      + ' so they can reply about this holiday. Tripbuster does not use them for anything else.</p>'
      + '</form>';
  }

  /** Wire a callback form: validate lightly, submit, and confirm in place. */
  function wireCallback(form, deal, surface) {
    if (!form || form._tbWired) return;
    form._tbWired = true;
    var errBox = form.querySelector('.cbf-err');
    var go = form.querySelector('.cbf-go');

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      errBox.hidden = true;
      var fd = new FormData(form);
      var payload = {
        dealId: deal.id,
        surface: surface || 'site',
        name: (fd.get('name') || '').trim(),
        phone: (fd.get('phone') || '').trim(),
        email: (fd.get('email') || '').trim(),
        message: (fd.get('message') || '').trim(),
        preferredTime: (fd.get('preferredTime') || '').trim(),
        website: (fd.get('website') || '').trim(),
      };

      // Checked here only to save a round trip and give an instant answer. The
      // server checks the same thing and is the one that decides.
      if (!payload.phone && !payload.email) {
        errBox.textContent = 'Leave a phone number or an email address so they can reply.';
        errBox.hidden = false;
        return;
      }

      go.disabled = true;
      go.textContent = 'Sending…';
      try {
        var out = await submitLead(payload);
        form.innerHTML = '<div class="cbf-done">' + svg('<path d="M20 6 9 17l-5-5"/>')
          + '<h3>That is on its way</h3><p>'
          + esc(out.agentName || 'The agency') + ' has your details and will be in touch.</p></div>';
      } catch (err) {
        errBox.textContent = ((err.fieldErrors || [])[0] || {}).message || err.message;
        errBox.hidden = false;
        go.disabled = false;
        go.textContent = 'Ask ' + ((deal.agent && deal.agent.name) || 'them') + ' to call me';
      }
    });
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
    dialer: dialer, telHref: telHref, reportCall: reportCall, callCta: callCta, wireCalls: wireCalls,
    submitLead: submitLead, callbackForm: callbackForm, wireCallback: wireCallback,
    chipsFor: chipsFor, priceBlock: priceBlock, dealCard: dealCard,
    header: header, footer: footer,
  };
})();
