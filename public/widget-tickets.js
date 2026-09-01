/**
 * Travelgenix Event Tickets Widget v1.0.0
 * Self-contained, embeddable widget
 * Zero dependencies — works on any website via a single script tag
 *
 * Shows upcoming bookable events from the supplier ticket feed, each with a
 * booking link into the CLIENT'S OWN Travelify application.
 *
 * The source is a setting rather than a separate widget. A club page, a venue
 * page, an artist page and a what's-on page are the same component pointed at
 * different data, so one widget serves all four:
 *
 *   competition   every fixture in the Premier League
 *   team          Arsenal, optionally home only or away only
 *   venue         what is on at Wembley, football and concerts alike
 *   performer     an act's tour dates
 *   category      all football, or all entertainment
 *   search        anything matching a saved term
 *   all           the whole feed
 *
 * Booking is not one button. An agent earns far more on a ticket sold with a
 * hotel than on a ticket alone, so the widget asks the API for every
 * combination it is configured for and renders the ones that can actually be
 * built. Ticket-only works today; ticket + hotel and ticket + flight + hotel
 * light up here with no change to this file once their Travelify specs land.
 *
 * Usage:
 *   <div data-tg-widget="tickets" data-tg-id="YOUR_WIDGET_ID"></div>
 *   <script src="https://tg-widgets.vercel.app/widget-tickets.js" defer></script>
 */
(function () {
  'use strict';

  var VERSION = '1.1.0';

  /**
   * Resolve our own origin.
   *
   * This script is hosted on widgets.travelify.io and embedded on customer
   * sites. A relative '/api/...' would resolve to the CUSTOMER'S domain and
   * 404, so the origin is taken from the script tag that loaded us.
   */
  function resolveOrigin() {
    if (typeof window === 'undefined') return '';
    if (window.__TG_WIDGET_ORIGIN__) return String(window.__TG_WIDGET_ORIGIN__);
    try {
      var me = document.currentScript;
      if (me && me.src) return new URL(me.src).origin;
      var scripts = document.getElementsByTagName('script');
      for (var i = scripts.length - 1; i >= 0; i--) {
        var src = scripts[i].src || '';
        if (/\/widget-tickets\.js(\?|$|#)/.test(src)) return new URL(src).origin;
      }
    } catch (e) { /* fall through */ }
    return '';
  }

  var ORIGIN = resolveOrigin();
  var CONFIG_API = (typeof window !== 'undefined' && window.__TG_WIDGET_API__) || (ORIGIN + '/api/widget-config');
  var FEED_API = (typeof window !== 'undefined' && window.__TG_EVENTS_API__) || (ORIGIN + '/api/events-feed');

  var DEFAULTS = {
    sourceType: 'competition',
    sourceValue: 'english-premier-league',
    side: 'both',
    competition: '',
    limit: 6,
    daysAhead: 365,
    layout: 'list',
    heading: '',
    subheading: '',
    showVenue: true,
    showCompetition: true,
    showTime: true,
    showBadge: true,
    bookLabel: 'Book',
    bookingKinds: ['ticket'],
    packageBgColor: '',       // '' = the standard secondary look
    packageTextColor: '',
    currency: 'GBP',
    adults: 2,
    emptyText: '',
    theme: 'light',
    accent: '#00B4D8',
    bookTextColor: '',
    radius: 12,
    fontFamily: '',
    appId: '',
  };

  // ── Icons, as path strings. No external requests, and never an emoji. ──────
  var IC = {
    clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 6v6l4 2',
    pin: 'M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0ZM12 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
    ext: 'M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6',
    ticket: 'M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2ZM13 5v14',
    bed: 'M2 4v16M2 8h18a2 2 0 0 1 2 2v10M2 17h20M6 8v9',
    plane: 'M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2Z',
    cal: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z',
    warn: 'M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z',
  };

  function icon(name, cls) {
    var d = IC[name] || '';
    var paths = d.split('M').filter(Boolean).map(function (seg) {
      return '<path d="M' + esc(seg) + '"/>';
    }).join('');
    return '<svg class="' + esc(cls || '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor"'
      + ' stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>';
  }

  // ── Safety ────────────────────────────────────────────────────────────────

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** Only ever emit a link we recognise. Everything else becomes empty. */
  function safeUrl(u) {
    var s = String(u == null ? '' : u).trim();
    if (!s) return '';
    if (/^(https?:|mailto:|tel:)/i.test(s)) return s;
    if (/^[/#?]/.test(s)) return s;
    return '';
  }

  // ── Flight package: the departure airport chooser ─────────────────────────
  // The one thing only the visitor knows is where they fly from, so the
  // "+ Flight & hotel" button opens a small chooser anchored to itself. The
  // airport comes ONLY from the suite's own list (view=airports), picked from
  // the dropdown, never free text — so org always matches the database — and
  // the link template must be the Travelify booking host before anything
  // opens.
  var FLY_TPL_OK = /^https:\/\/dl\.tvllnk\.com\/deeplink\//;
  var FLY_IATA = /^[A-Z]{3}$/;
  var flyAirports = null;

  /**
   * White or the house dark ink, whichever reads better on the given colour.
   * The crossover is where both give equal WCAG contrast, so a dark accent
   * gets white text and icons, and the default cyan keeps dark ones.
   */
  function inkOn(hex) {
    var h = String(hex || '').replace('#', '');
    if (h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return '#04212B';
    var lin = function (i) {
      var c = parseInt(h.substr(i, 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    var L = 0.2126 * lin(0) + 0.7152 * lin(2) + 0.0722 * lin(4);
    return L > 0.21 ? '#04212B' : '#FFFFFF';
  }

  /** The product each booking type sells, as its button icon. */
  function kindIcon(kind) {
    if (kind === 'ticket-hotel') return 'bed';
    if (kind === 'ticket-flight-hotel') return 'plane';
    return 'ticket';
  }

  function flyTpl(o) {
    if (!o || o.status !== 'needs-origin' || typeof o.urlTemplate !== 'string') return '';
    return FLY_TPL_OK.test(o.urlTemplate) ? o.urlTemplate : '';
  }

  function flyLoadAirports() {
    if (flyAirports) return flyAirports;
    flyAirports = fetch(FEED_API + '?view=airports', { credentials: 'omit' })
      .then(function (r) { if (!r.ok) throw new Error('airports ' + r.status); return r.json(); })
      .then(function (d) {
        var rows = Array.isArray(d.airports) ? d.airports : [];
        return rows.filter(function (a) { return Array.isArray(a) && FLY_IATA.test(String(a[0] || '')); });
      })
      .catch(function () { flyAirports = null; return []; });
    return flyAirports;
  }

  function flyRemember(code) {
    try { localStorage.setItem('tgev_org', JSON.stringify(code)); } catch (e) { /* private mode */ }
  }
  function flyRemembered() {
    try { return JSON.parse(localStorage.getItem('tgev_org') || 'null'); } catch (e) { return null; }
  }

  function flyInit(w) {
    w.shadow.addEventListener('click', function (e) {
      var t = e.target;
      var btn = t && t.closest ? t.closest('[data-fly]') : null;
      if (btn) { flyOpen(w, btn); return; }
      if (w._fly && (!e.composedPath || e.composedPath().indexOf(w._fly.box) === -1)) flyClose(w);
    });
  }

  function flyClose(w) {
    var f = w._fly;
    if (!f) return;
    w._fly = null;
    if (f.box.parentNode) f.box.parentNode.removeChild(f.box);
    document.removeEventListener('keydown', f.onKey, true);
    document.removeEventListener('click', f.onDoc, true);
    if (f.btn && f.btn.isConnected) try { f.btn.focus(); } catch (e) { /* gone */ }
  }

  function flyOpen(w, btn) {
    if (w._fly && w._fly.btn === btn) { flyClose(w); return; }
    flyClose(w);
    stayClose(w);
    var tpl = String(btn.getAttribute('data-fly') || '');
    if (!FLY_TPL_OK.test(tpl)) return;
    var root = w.shadow.querySelector('.tgtk-root');
    if (!root) return;

    var box = document.createElement('div');
    box.className = 'tgtk-fly';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Choose your departure airport');
    box.innerHTML = '<div class="tgtk-fly-t">Where are you flying from?</div>'
      + '<input class="tgtk-fly-in" type="text" placeholder="Type an airport or code"'
      + ' autocomplete="off" spellcheck="false" aria-label="Search airports">'
      + '<div class="tgtk-fly-list" role="listbox"></div>'
      + '<div class="tgtk-fly-note">Loading airports&hellip;</div>';
    root.appendChild(box);

    // Anchored to the button, kept inside the widget, flipped above when the
    // room below is short.
    var rr = root.getBoundingClientRect();
    var br = btn.getBoundingClientRect();
    var width = Math.min(300, Math.max(230, rr.width - 16));
    box.style.width = width + 'px';
    box.style.left = Math.max(8, Math.min(br.left - rr.left, rr.width - width - 8)) + 'px';
    if (window.innerHeight - br.bottom < 330 && br.top > 330) {
      box.style.bottom = (rr.bottom - br.top + 6) + 'px';
    } else {
      box.style.top = (br.bottom - rr.top + 6) + 'px';
    }

    var input = box.querySelector('.tgtk-fly-in');
    var list = box.querySelector('.tgtk-fly-list');
    var note = box.querySelector('.tgtk-fly-note');
    var state = { box: box, btn: btn, all: null, list: [], active: 0, onKey: null, onDoc: null };
    w._fly = state;

    function choose(code) {
      if (!FLY_IATA.test(code)) return;
      if (!state.all || !state.all.some(function (a) { return a[0] === code; })) return;
      flyRemember(code);
      var url = tpl.replace('__ORG__', code);
      if (!FLY_TPL_OK.test(url) || url.indexOf('__ORG__') !== -1) return;
      flyClose(w);
      window.open(url, '_blank', 'noopener');
    }

    function matches(q) {
      var f = String(q || '').trim().toLowerCase();
      var out = [];
      var all = state.all || [];
      var last = flyRemembered();
      if (!f && FLY_IATA.test(String(last || ''))) {
        for (var j = 0; j < all.length; j++) if (all[j][0] === last) { out.push(all[j]); break; }
      }
      for (var i = 0; i < all.length && out.length < 8; i++) {
        var a = all[i];
        if (out.length && out[0][0] === a[0] && out.length === 1 && !f) continue;
        if (out.some(function (b) { return b[0] === a[0]; })) continue;
        if (!f || a[0].toLowerCase().indexOf(f) === 0 || a[1].toLowerCase().indexOf(f) !== -1) out.push(a);
      }
      return out;
    }

    function draw() {
      state.list = matches(input.value);
      if (state.active >= state.list.length) state.active = 0;
      var html = '';
      for (var i = 0; i < state.list.length; i++) {
        var a = state.list[i];
        html += '<button type="button" class="tgtk-fly-opt' + (i === state.active ? ' is-active' : '') + '"'
          + ' role="option" aria-selected="' + (i === state.active) + '" data-iata="' + esc(a[0]) + '">'
          + '<span class="tgtk-fly-code">' + esc(a[0]) + '</span>'
          + '<span class="tgtk-fly-name">' + esc(a[1]) + '</span></button>';
      }
      list.innerHTML = html;
      if (state.all) note.textContent = state.list.length ? '' : 'No airport matches that. Try the three-letter code.';
    }

    list.addEventListener('click', function (e) {
      var opt = e.target && e.target.closest ? e.target.closest('.tgtk-fly-opt') : null;
      if (opt) choose(opt.getAttribute('data-iata'));
    });
    input.addEventListener('input', function () { state.active = 0; draw(); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); if (state.active < state.list.length - 1) { state.active++; draw(); } }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (state.active > 0) { state.active--; draw(); } }
      else if (e.key === 'Enter') { e.preventDefault(); if (state.list[state.active]) choose(state.list[state.active][0]); }
      else if (e.key === 'Escape') { flyClose(w); }
    });

    state.onKey = function (e) { if (e.key === 'Escape') flyClose(w); };
    state.onDoc = function (e) {
      var path = e.composedPath ? e.composedPath() : [];
      if (path.indexOf(box) === -1 && path.indexOf(btn) === -1) flyClose(w);
    };
    document.addEventListener('keydown', state.onKey, true);
    document.addEventListener('click', state.onDoc, true);

    flyLoadAirports().then(function (all) {
      if (w._fly !== state) return;
      state.all = all;
      if (!all.length) { note.textContent = 'The airport list did not load. Please try again.'; return; }
      note.textContent = '';
      draw();
    });
    input.focus();
  }

  // ── Ticket + hotel: the stay calendar ─────────────────────────────────────
  // The hotel package needs the visitor's own dates, so the "+ Hotel" button
  // opens a small calendar anchored to itself: pick check-in, pick check-out,
  // and the booking opens with fr, to and dur rewritten to that stay. The
  // stay must cover the event night; arrive up to a week before, leave up to
  // two weeks after. Only the Travelify booking host is ever opened.
  var STAY_BEFORE = 7;
  var STAY_AFTER = 14;
  var STAY_DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
  var STAY_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  var STAY_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function stayIso(d) {
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function stayParse(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }
  function stayShift(d, n) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  }
  function stayLabel(d) {
    return STAY_DAYS[(d.getDay() + 6) % 7] + ' ' + d.getDate() + ' ' + STAY_SHORT[d.getMonth()];
  }

  function stayInit(w) {
    w.shadow.addEventListener('click', function (e) {
      var t = e.target;
      var btn = t && t.closest ? t.closest('[data-stay]') : null;
      if (btn) { stayOpen(w, btn); return; }
      if (w._stayUi && (!e.composedPath || e.composedPath().indexOf(w._stayUi.box) === -1)) stayClose(w);
    });
  }

  function stayClose(w) {
    var s = w._stayUi;
    if (!s) return;
    w._stayUi = null;
    if (s.box.parentNode) s.box.parentNode.removeChild(s.box);
    document.removeEventListener('keydown', s.onKey, true);
    document.removeEventListener('click', s.onDoc, true);
    if (s.btn && s.btn.isConnected) try { s.btn.focus(); } catch (e) { /* gone */ }
  }

  function stayOpen(w, btn) {
    if (w._stayUi && w._stayUi.btn === btn) { stayClose(w); return; }
    stayClose(w);
    flyClose(w);
    var url = String(btn.getAttribute('data-stay') || '');
    if (!FLY_TPL_OK.test(url)) return;
    var fr = /[?&]fr=(\d{4}-\d{2}-\d{2})/.exec(url);
    var eventDay = fr && stayParse(fr[1]);
    if (!eventDay) return;
    var now = new Date();
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var minIn = stayShift(eventDay, -STAY_BEFORE);
    if (minIn < today) minIn = today;
    if (eventDay < minIn) return;
    var maxOut = stayShift(eventDay, STAY_AFTER);
    var root = w.shadow.querySelector('.tgtk-root');
    if (!root) return;

    var box = document.createElement('div');
    box.className = 'tgtk-fly';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Choose your stay');
    root.appendChild(box);
    var rr = root.getBoundingClientRect();
    var br = btn.getBoundingClientRect();
    var width = Math.min(300, Math.max(250, rr.width - 16));
    box.style.width = width + 'px';
    box.style.left = Math.max(8, Math.min(br.left - rr.left, rr.width - width - 8)) + 'px';
    if (window.innerHeight - br.bottom < 370 && br.top > 370) {
      box.style.bottom = (rr.bottom - br.top + 6) + 'px';
    } else {
      box.style.top = (br.bottom - rr.top + 6) + 'px';
    }

    var state = { box: box, btn: btn, checkIn: null,
      view: new Date(eventDay.getFullYear(), eventDay.getMonth(), 1), onKey: null, onDoc: null };
    w._stayUi = state;

    function canIn(d) { return d >= minIn && d <= eventDay; }
    function canOut(d) { return !!state.checkIn && d > eventDay && d <= maxOut; }

    function go(out) {
      var nights = Math.round((out - state.checkIn) / 86400000);
      if (nights < 1 || nights > STAY_BEFORE + STAY_AFTER) return;
      var u;
      try { u = new URL(url); } catch (e) { return; }
      u.searchParams.set('fr', stayIso(state.checkIn));
      u.searchParams.set('to', stayIso(out));
      u.searchParams.set('dur', String(nights));
      var finalUrl = u.toString();
      if (!FLY_TPL_OK.test(finalUrl)) return;
      stayClose(w);
      window.open(finalUrl, '_blank', 'noopener');
    }

    function draw() {
      var y = state.view.getFullYear();
      var mo = state.view.getMonth();
      var startCol = (new Date(y, mo, 1).getDay() + 6) % 7;
      var dim = new Date(y, mo + 1, 0).getDate();
      var canPrev = new Date(y, mo, 1) > new Date(minIn.getFullYear(), minIn.getMonth(), 1);
      var canNext = new Date(y, mo + 1, 1) <= new Date(maxOut.getFullYear(), maxOut.getMonth(), 1);
      var html = '<div class="tgtk-fly-t">When would you like to stay?</div>'
        + '<div class="tgtk-stay-head">'
        + '<button type="button" class="tgtk-stay-nav" data-nav="-1"' + (canPrev ? '' : ' disabled')
        + ' aria-label="Previous month">&lsaquo;</button>'
        + '<span class="tgtk-stay-month">' + esc(STAY_MONTHS[mo] + ' ' + y) + '</span>'
        + '<button type="button" class="tgtk-stay-nav" data-nav="1"' + (canNext ? '' : ' disabled')
        + ' aria-label="Next month">&rsaquo;</button>'
        + '</div><div class="tgtk-stay-grid">';
      for (var i = 0; i < 7; i++) html += '<span class="tgtk-stay-dow">' + STAY_DAYS[i] + '</span>';
      for (var b = 0; b < startCol; b++) html += '<span></span>';
      for (var day = 1; day <= dim; day++) {
        var d = new Date(y, mo, day);
        var ok = state.checkIn ? (canOut(d) || canIn(d)) : canIn(d);
        var cls = 'tgtk-stay-day';
        if (+d === +eventDay) cls += ' is-event';
        if (state.checkIn && +d === +state.checkIn) cls += ' is-pick';
        else if (state.checkIn && d > state.checkIn && d <= eventDay) cls += ' is-span';
        html += ok
          ? '<button type="button" class="' + cls + '" data-d="' + stayIso(d) + '">' + day + '</button>'
          : '<span class="' + cls + ' is-off">' + day + '</span>';
      }
      html += '</div><div class="tgtk-fly-note">' + esc(state.checkIn
        ? 'Check-in ' + stayLabel(state.checkIn) + '. Now pick your check-out day.'
        : 'Pick your check-in day. The event night is ringed.') + '</div>';
      box.innerHTML = html;
    }

    box.addEventListener('click', function (e) {
      var nav = e.target && e.target.closest ? e.target.closest('[data-nav]') : null;
      if (nav && !nav.disabled) {
        state.view = new Date(state.view.getFullYear(),
          state.view.getMonth() + parseInt(nav.getAttribute('data-nav'), 10), 1);
        draw();
        return;
      }
      var cell = e.target && e.target.closest ? e.target.closest('[data-d]') : null;
      if (!cell) return;
      var d = stayParse(cell.getAttribute('data-d'));
      if (!d) return;
      if (state.checkIn && canOut(d)) { go(d); return; }
      if (canIn(d)) { state.checkIn = d; draw(); }
    });
    state.onKey = function (e) { if (e.key === 'Escape') stayClose(w); };
    state.onDoc = function (e) {
      var path = e.composedPath ? e.composedPath() : [];
      if (path.indexOf(box) === -1 && path.indexOf(btn) === -1) stayClose(w);
    };
    document.addEventListener('keydown', state.onKey, true);
    document.addEventListener('click', state.onDoc, true);
    draw();
  }

  var STAY_CSS = '.tgtk-stay-head{display:flex;align-items:center;justify-content:space-between;margin:2px 0 6px}'
    + '.tgtk-stay-month{font-weight:600;font-size:13px}'
    + '.tgtk-stay-nav{width:28px;height:28px;border:0;background:none;font:inherit;font-size:16px;'
    + 'color:inherit;cursor:pointer;border-radius:8px}'
    + '.tgtk-stay-nav:hover{background:rgba(0,0,0,.07)}'
    + '.tgtk-stay-nav[disabled]{opacity:.3;cursor:default;background:none}'
    + '.tgtk-stay-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:2px;text-align:center}'
    + '.tgtk-stay-dow{font-size:10px;font-weight:600;color:#5b6b7b;text-transform:uppercase;'
    + 'letter-spacing:.04em;padding:2px 0}'
    + '.tgtk-stay-day{border:0;background:none;font:inherit;font-size:12.5px;color:inherit;padding:0;'
    + 'height:32px;border-radius:8px;cursor:pointer}'
    + '.tgtk-stay-day:hover{background:rgba(0,0,0,.07)}'
    + '.tgtk-stay-day.is-off{opacity:.28;cursor:default}'
    + '.tgtk-stay-day.is-off:hover{background:none}'
    + '.tgtk-stay-day.is-event{box-shadow:inset 0 0 0 1.5px currentColor}'
    + '.tgtk-stay-day.is-pick{background:#1a2733;color:#fff}'
    + '.tgtk-stay-day.is-span{background:rgba(0,0,0,.08)}'
    + '.tgtk-root[data-theme="dark"] .tgtk-stay-dow{color:#93a4b5}'
    + '.tgtk-root[data-theme="dark"] .tgtk-stay-nav:hover{background:rgba(255,255,255,.09)}'
    + '.tgtk-root[data-theme="dark"] .tgtk-stay-day:hover{background:rgba(255,255,255,.09)}'
    + '.tgtk-root[data-theme="dark"] .tgtk-stay-day.is-off:hover{background:none}'
    + '.tgtk-root[data-theme="dark"] .tgtk-stay-day.is-pick{background:#e8eef4;color:#16202c}'
    + '.tgtk-root[data-theme="dark"] .tgtk-stay-day.is-span{background:rgba(255,255,255,.1)}';

  var FLY_CSS = '.tgtk-root{position:relative}'
    + 'button.tgtk-btn{appearance:none;-webkit-appearance:none;margin:0}'
    + '.tgtk-fly{position:absolute;z-index:40;background:#fff;color:#1a2733;border:1px solid #dde4ea;'
    + 'border-radius:12px;box-shadow:0 12px 32px rgba(10,30,50,.18);padding:12px;box-sizing:border-box;'
    + 'font-size:14px;line-height:1.4;text-align:left}'
    + '.tgtk-fly-t{font-weight:600;margin:0 0 8px;font-size:14px}'
    + '.tgtk-fly-in{width:100%;box-sizing:border-box;padding:8px 10px;font:inherit;color:inherit;'
    + 'background:transparent;border:1.5px solid #cfd8e0;border-radius:8px;outline:none}'
    + '.tgtk-fly-in:focus{border-color:currentColor}'
    + '.tgtk-fly-list{margin-top:8px;max-height:224px;overflow-y:auto}'
    + '.tgtk-fly-opt{display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:8px 10px;'
    + 'font:inherit;color:inherit;background:none;border:0;border-radius:8px;cursor:pointer}'
    + '.tgtk-fly-opt.is-active,.tgtk-fly-opt:hover{background:rgba(0,0,0,.07)}'
    + '.tgtk-fly-code{font-weight:700;font-size:12px;letter-spacing:.04em;min-width:38px}'
    + '.tgtk-fly-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
    + '.tgtk-fly-note{color:#5b6b7b;font-size:12px;margin-top:6px}'
    + '.tgtk-fly-note:empty{display:none}'
    + '.tgtk-root[data-theme="dark"] .tgtk-fly{background:#16202c;color:#e8eef4;border-color:#263442;'
    + 'box-shadow:0 12px 32px rgba(0,0,0,.55)}'
    + '.tgtk-root[data-theme="dark"] .tgtk-fly-in{border-color:#3a4a5a}'
    + '.tgtk-root[data-theme="dark"] .tgtk-fly-opt.is-active,'
    + '.tgtk-root[data-theme="dark"] .tgtk-fly-opt:hover{background:rgba(255,255,255,.09)}'
    + '.tgtk-root[data-theme="dark"] .tgtk-fly-note{color:#93a4b5}';

  /** A colour we are willing to put in a stylesheet. */
  function safeColour(c, fallback) {
    var s = String(c == null ? '' : c).trim();
    if (/^#[0-9a-f]{3}$/i.test(s) || /^#[0-9a-f]{6}$/i.test(s)) return s;
    if (/^rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(,\s*[\d.]+\s*)?\)$/i.test(s)) return s;
    return fallback;
  }

  /** A font stack we are willing to put in a stylesheet. */
  function safeFont(f) {
    var s = String(f == null ? '' : f).trim();
    if (!s) return '';
    if (!/^[A-Za-z0-9 ,'"-]{1,120}$/.test(s)) return '';
    return s;
  }

  function clampInt(v, min, max, fallback) {
    var n = parseInt(v, 10);
    if (!isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  // ── Dates ─────────────────────────────────────────────────────────────────
  //
  // The feed's dates carry no timezone, so they are calendar dates and are
  // formatted as calendar dates. new Date('2026-08-22') parses as UTC midnight
  // and renders in the viewer's zone, which shows an evening kick-off in Los
  // Angeles as the day before — so the string is split by hand instead.

  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function dateParts(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    return { y: y, m: mo, d: d, dow: DOW[new Date(y, mo - 1, d).getDay()], mon: MON[mo - 1] };
  }

  /** Today, in the VIEWER'S local calendar. Not toISOString, which is UTC. */
  function localToday(offsetDays) {
    var t = new Date();
    if (offsetDays) t.setDate(t.getDate() + offsetDays);
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return t.getFullYear() + '-' + p(t.getMonth() + 1) + '-' + p(t.getDate());
  }

  // ── Styles ────────────────────────────────────────────────────────────────

  // Which side of a fixture the queried team is on (feed tags every event with
  // homeTeamKey / awayTeamKey), so a visitor Home/Away filter needs no refetch.
  function sideOf(ev, teamKey) {
    if (!teamKey || !ev) return '';
    if (ev.homeTeamKey && ev.homeTeamKey === teamKey) return 'home';
    if (ev.awayTeamKey && ev.awayTeamKey === teamKey) return 'away';
    return '';
  }

  function styles(cfg) {
    var accent = safeColour(cfg.accent, DEFAULTS.accent);
    var btnText = safeColour(cfg.bookTextColor, inkOn(accent));
    // QA ask: the package buttons take their own colours when set; blank
    // keeps the standard outline look. Text defaults to whichever ink
    // reads better on the chosen background.
    var pkgBg = safeColour(cfg.packageBgColor, '');
    var pkgInk = safeColour(cfg.packageTextColor, '');
    var pkgCss = pkgBg || pkgInk
      ? '.tgtk-btn.tgtk-btn-pkg{'
        + (pkgBg ? 'background:' + pkgBg + ';border-color:' + pkgBg + ';box-shadow:none;' : '')
        + 'color:' + (pkgInk || inkOn(pkgBg)) + ';}'
        + (pkgBg ? '.tgtk-btn.tgtk-btn-pkg:hover{background:' + pkgBg + ';filter:brightness(.93);}' : '')
      : '';
    var radius = clampInt(cfg.radius, 0, 28, DEFAULTS.radius);
    var font = safeFont(cfg.fontFamily);
    var stack = (font ? '"' + font + '", ' : '')
      + "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

    return ':host{all:initial;display:block;}'
      // container-type makes the breakpoint below a @container query rather than
      // @media. A widget sits in whatever column the client gives it, and a
      // viewport query cannot see that the column is 240px wide on a 1500px
      // screen: that is how the club grid ended up writing names one letter per
      // line on the dashboard card.
      + '.tgtk-root{container-type:inline-size;'
      + 'font-family:' + stack + ';'
      + '--tgtk-accent:' + accent + ';'
      + '--tgtk-radius:' + radius + 'px;'
      + '--tgtk-bg:#FFFFFF;--tgtk-bg2:#F8FAFC;--tgtk-bg3:#F1F5F9;'
      + '--tgtk-border:#E2E8F0;--tgtk-text:#0F172A;--tgtk-sub:#475569;--tgtk-mute:#64748B;'
      + '--tgtk-on-accent:' + btnText + ';'
      + 'font-size:15px;line-height:1.6;color:var(--tgtk-text);box-sizing:border-box;'
      + '-webkit-font-smoothing:antialiased;}'
      + '.tgtk-root *,.tgtk-root *::before,.tgtk-root *::after{box-sizing:border-box;}'
      + '.tgtk-root[data-theme="dark"]{'
      + '--tgtk-bg:#0F172A;--tgtk-bg2:#1E293B;--tgtk-bg3:#334155;'
      + '--tgtk-border:#334155;--tgtk-text:#F8FAFC;--tgtk-sub:#CBD5E1;--tgtk-mute:#94A3B8;'
      + '--tgtk-on-accent:' + btnText + ';}'

      + '.tgtk-head{margin:0 0 16px;}'
      + '.tgtk-h{margin:0;font-size:22px;line-height:1.25;font-weight:700;letter-spacing:-.01em;}'
      + '.tgtk-sub{margin:4px 0 0;font-size:15px;color:var(--tgtk-sub);}'

      // Visitor Home/Away filter (segmented, shown only when a team has both).
      + '.tgtk-hafilter{display:inline-flex;margin:0 0 12px;border:1px solid var(--tgtk-border);'
      + 'border-radius:calc(var(--tgtk-radius) - 4px);overflow:hidden;background:var(--tgtk-bg);}'
      + '.tgtk-hf{padding:0 14px;min-height:36px;font:inherit;font-size:12.5px;font-weight:600;'
      + 'color:var(--tgtk-sub);background:transparent;border:0;border-right:1px solid var(--tgtk-border);'
      + 'cursor:pointer;white-space:nowrap;transition:background .15s ease-out,color .15s ease-out;}'
      + '.tgtk-hf:last-child{border-right:0;}'
      + '.tgtk-hf:hover{color:var(--tgtk-text);}'
      + '.tgtk-hf.is-on{background:var(--tgtk-accent);color:var(--tgtk-on-accent);}'
      + '.tgtk-hf:focus-visible{outline:2px solid var(--tgtk-accent);outline-offset:-2px;}'

      + '.tgtk-list{display:flex;flex-direction:column;gap:8px;}'
      + '.tgtk-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px;}'

      + '.tgtk-card{background:var(--tgtk-bg);border:1px solid var(--tgtk-border);'
      + 'border-radius:var(--tgtk-radius);padding:14px;display:grid;gap:14px;align-items:center;'
      + 'grid-template-columns:64px minmax(0,1fr) auto;transition:border-color .2s ease-out,box-shadow .2s ease-out;}'
      + '.tgtk-card:hover{border-color:var(--tgtk-accent);}'

      + '.tgtk-grid .tgtk-card{grid-template-columns:1fr;align-items:stretch;gap:10px;}'
      + '.tgtk-grid .tgtk-date{width:64px;}'

      + '.tgtk-compact .tgtk-card{grid-template-columns:minmax(0,1fr) auto;padding:10px 12px;gap:10px;}'
      + '.tgtk-compact .tgtk-date{display:none;}'
      + '.tgtk-compact .tgtk-title{font-size:15px;}'

      + '.tgtk-date{text-align:center;padding:6px 0;background:var(--tgtk-bg3);'
      + 'border-radius:calc(var(--tgtk-radius) - 4px);line-height:1.15;font-variant-numeric:tabular-nums;}'
      + '.tgtk-dow{display:block;font-size:11px;font-weight:600;text-transform:uppercase;'
      + 'letter-spacing:.06em;color:var(--tgtk-mute);}'
      + '.tgtk-day{display:block;font-size:22px;font-weight:700;}'
      + '.tgtk-mon{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--tgtk-sub);}'

      + '.tgtk-main{min-width:0;}'
      + '.tgtk-title{margin:0 0 2px;font-size:16px;font-weight:600;line-height:1.35;overflow-wrap:anywhere;}'
      + '.tgtk-meta{display:flex;flex-wrap:wrap;align-items:center;gap:8px;font-size:13px;color:var(--tgtk-sub);}'
      + '.tgtk-meta svg{width:14px;height:14px;flex:none;color:var(--tgtk-mute);vertical-align:-2px;}'
      + '.tgtk-meta span{display:inline-flex;align-items:center;gap:4px;}'
      + '.tgtk-dot{color:var(--tgtk-mute);}'
      + '.tgtk-chip{display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;'
      + 'background:var(--tgtk-bg3);color:var(--tgtk-sub);font-size:11px;font-weight:500;white-space:nowrap;}'

      + '.tgtk-actions{display:flex;flex-wrap:wrap;gap:6px;align-items:center;}'
      + '.tgtk-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;'
      + 'min-height:44px;padding:0 16px;border-radius:calc(var(--tgtk-radius) - 4px);'
      + 'border:1px solid transparent;background:var(--tgtk-accent);color:var(--tgtk-on-accent);'
      + 'font:inherit;font-size:13px;font-weight:600;text-decoration:none;cursor:pointer;white-space:nowrap;'
      + 'transition:filter .16s ease-out,transform .12s ease-out;}'
      + '.tgtk-btn{font-weight:700;letter-spacing:.01em;'
      + 'box-shadow:0 2px 6px color-mix(in srgb,var(--tgtk-accent) 34%,transparent);'
      + 'transition:transform .16s ease-out,box-shadow .16s ease-out,filter .16s ease-out;}'
      + '.tgtk-btn:hover{transform:translateY(-1px);filter:brightness(1.05);'
      + 'box-shadow:0 7px 18px color-mix(in srgb,var(--tgtk-accent) 44%,transparent);}'
      + '.tgtk-btn:active{transform:translateY(0) scale(.98);}'
      + '.tgtk-btn svg{width:21px;height:21px;}'
      + '.tgtk-btn2{background:var(--tgtk-bg);border-color:var(--tgtk-border);color:var(--tgtk-text);box-shadow:none;}'
      + '.tgtk-btn2:hover{background:var(--tgtk-bg3);filter:none;transform:translateY(-1px);'
      + 'border-color:var(--tgtk-accent);box-shadow:0 4px 10px rgba(15,23,42,.08);}'
      + '.tgtk-btn:focus-visible,.tgtk-more:focus-visible{outline:2px solid var(--tgtk-accent);outline-offset:2px;}'

      + '.tgtk-state{padding:32px 20px;text-align:center;color:var(--tgtk-sub);'
      + 'background:var(--tgtk-bg);border:1px dashed var(--tgtk-border);border-radius:var(--tgtk-radius);}'
      + '.tgtk-state svg{width:26px;height:26px;color:var(--tgtk-mute);margin-bottom:6px;}'
      + '.tgtk-state p{margin:0;}'

      + '.tgtk-skel{height:78px;border-radius:var(--tgtk-radius);'
      + 'background:linear-gradient(90deg,var(--tgtk-bg3) 25%,var(--tgtk-bg2) 50%,var(--tgtk-bg3) 75%);'
      + 'background-size:200% 100%;animation:tgtk-sh 1.4s ease-in-out infinite;}'
      + '@keyframes tgtk-sh{0%{background-position:200% 0}100%{background-position:-200% 0}}'

      + '.tgtk-more{display:block;margin:14px auto 0;background:none;border:0;padding:8px 12px;'
      + 'font:inherit;font-size:13px;font-weight:600;color:var(--tgtk-accent);cursor:pointer;}'

      + '@container (max-width:520px){'
      + '.tgtk-card{grid-template-columns:56px minmax(0,1fr);row-gap:10px;}'
      + '.tgtk-actions{grid-column:1/-1;}'
      + '.tgtk-btn{flex:1 1 auto;}'
      + '.tgtk-compact .tgtk-card{grid-template-columns:minmax(0,1fr);}'
      + '}'

      + '@media (prefers-reduced-motion:reduce){'
      + '.tgtk-root *{animation-duration:.01ms !important;animation-iteration-count:1 !important;'
      + 'transition-duration:.01ms !important;}}'
      + pkgCss;
  }

  // ── The widget ────────────────────────────────────────────────────────────

  function TGTicketsWidget(container, config) {
    this.el = container;
    this.cfg = Object.assign({}, DEFAULTS, config || {});
    this.shadow = container.shadowRoot || container.attachShadow({ mode: 'open' });
    flyInit(this);
    stayInit(this);
    this.events = null;
    this.total = 0;
    this.error = null;
    this.loading = true;
    this._side = 'all';           // visitor Home/Away filter (client-side)
    this._reqId = 0;
    // Delegated: the shadow root survives each innerHTML re-render, so one
    // listener here keeps the Home/Away toggle working without re-binding.
    var self = this;
    this.shadow.addEventListener('click', function (e) {
      var hf = e.target && e.target.closest ? e.target.closest('.tgtk-hf') : null;
      if (!hf) return;
      var side = hf.getAttribute('data-side') || 'all';
      if (self._side !== side) { self._side = side; self._render(); }
    });
    this._render();
    this._load();
  }

  TGTicketsWidget.prototype._theme = function () {
    var t = this.cfg.theme;
    if (t === 'dark') return 'dark';
    if (t === 'auto') {
      try {
        return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      } catch (e) { return 'light'; }
    }
    return 'light';
  };

  /** Turn the source setting into the API call it means. */
  TGTicketsWidget.prototype._query = function () {
    var c = this.cfg;
    var q = {
      limit: String(clampInt(c.limit, 1, 100, DEFAULTS.limit)),
      from: localToday(0),
      to: localToday(clampInt(c.daysAhead, 1, 730, DEFAULTS.daysAhead)),
      currency: c.currency,
      adults: String(clampInt(c.adults, 1, 20, DEFAULTS.adults)),
    };
    if (c.appId) q.appId = c.appId;
    var kinds = Array.isArray(c.bookingKinds) ? c.bookingKinds.filter(Boolean) : [];
    // Always explicit: an agent who unticked every booking type means NO
    // buttons, and an absent parameter would fall back to the server's
    // default of every ready kind - the exact opposite. 'none' is not a
    // kind, so the API builds zero options for it.
    q.booking = kinds.length ? kinds.join(',') : 'none';

    var v = String(c.sourceValue || '').trim();
    switch (c.sourceType) {
      case 'team':
        q.view = 'team'; q.key = v;
        if (c.side === 'home' || c.side === 'away') q.side = c.side;
        if (c.competition) q.competition = c.competition;
        break;
      case 'venue':      q.view = 'venue'; q.key = v; break;
      case 'performer':  q.view = 'performer'; q.key = v; break;
      case 'category':   q.view = 'browse'; q.category = v; break;
      case 'search':     q.view = 'browse'; q.q = v; break;
      case 'all':        q.view = 'browse'; break;
      case 'competition':
      default:           q.view = 'competition'; q.slug = v; break;
    }
    return q;
  };

  /** Sources that mean nothing without a value chosen. */
  function needsValue(t) {
    return t === 'competition' || t === 'team' || t === 'venue' || t === 'performer' || t === 'category';
  }

  TGTicketsWidget.prototype._load = function () {
    var self = this;
    var mine = ++this._reqId;
    this._side = 'all';           // a fresh query starts on "All games"

    // No source picked yet. That is a half-finished embed, not an outage, so
    // it must not call the API (which would 400) and must not shout an error
    // at a visitor. Editors sit in this state every time someone hits Change.
    if (needsValue(this.cfg.sourceType) && !String(this.cfg.sourceValue || '').trim()) {
      this.events = [];
      this.total = 0;
      this.error = 'unset';
      this.loading = false;
      this._render();
      return;
    }

    var q = this._query();
    var parts = [];
    for (var k in q) {
      if (Object.prototype.hasOwnProperty.call(q, k) && q[k] !== '' && q[k] != null) {
        parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(q[k]));
      }
    }
    var url = FEED_API + (parts.length ? '?' + parts.join('&') : '');

    this.loading = true;
    this.error = null;
    this._render();

    fetch(url, { headers: { Accept: 'application/json' } })
      .then(function (r) {
        if (!r.ok) throw new Error(r.status === 404 ? 'not-found' : 'request-failed');
        return r.json();
      })
      .then(function (data) {
        if (mine !== self._reqId) return;      // a later load won
        self.events = Array.isArray(data.events) ? data.events : [];
        self.total = data.total || self.events.length;
        self.loading = false;
        self._render();
      })
      .catch(function (err) {
        if (mine !== self._reqId) return;
        self.events = [];
        self.error = err && err.message === 'not-found' ? 'not-found' : 'failed';
        self.loading = false;
        self._render();
      });
  };

  TGTicketsWidget.prototype._cardHtml = function (ev) {
    var c = this.cfg;
    var p = dateParts(ev.startDate);
    var title = esc(ev.title || 'Event') + (ev.phase ? ' <span class="tgtk-chip">' + esc(ev.phase) + '</span>' : '');

    var meta = [];
    if (c.showTime) {
      if (ev.timeKnown && ev.startTime) meta.push('<span>' + icon('clock') + esc(ev.startTime) + '</span>');
      else meta.push('<span class="tgtk-chip">Time TBC</span>');
    }
    if (c.showVenue && ev.venue && ev.venue.name) {
      if (meta.length) meta.push('<span class="tgtk-dot" aria-hidden="true">&middot;</span>');
      meta.push('<span>' + icon('pin') + esc(ev.venue.name) + '</span>');
    }
    if (c.showCompetition && ev.competitionLabel) {
      if (meta.length) meta.push('<span class="tgtk-dot" aria-hidden="true">&middot;</span>');
      meta.push('<span>' + esc(ev.competitionLabel) + '</span>');
    }
    if (ev.hasPlaceholderTeams) meta.push('<span class="tgtk-chip">Opponent TBC</span>');

    // Only options the API could actually build. An option awaiting its spec
    // comes back without a url and is simply not offered.
    var opts = Array.isArray(ev.bookingOptions) ? ev.bookingOptions : [];
    var usable = opts.map(function (o) {
      var direct = safeUrl(o.url);
      // The hotel package asks for the visitor's stay first, so its ready
      // link opens the calendar rather than Travelify straight away.
      if (o.kind === 'ticket-hotel' && direct && FLY_TPL_OK.test(direct)) {
        return { kind: o.kind, label: o.label, short: o.short, stay: direct };
      }
      if (direct) return { kind: o.kind, label: o.label, short: o.short, url: direct };
      var tpl = flyTpl(o);
      if (tpl) return { kind: o.kind, label: o.label, short: o.short, fly: tpl };
      return null;
    }).filter(Boolean);
    // The plain ticket link is only a fallback where the agent still offers
    // tickets; with every type turned off, no button is the point.
    var wantsTicket = !Array.isArray(c.bookingKinds) || c.bookingKinds.indexOf('ticket') !== -1;
    if (!usable.length && wantsTicket && ev.booking && safeUrl(ev.booking.url)) {
      usable = [{ kind: 'ticket', short: c.bookLabel, url: ev.booking.url }];
    }

    var actions;
    if (usable.length) {
      actions = usable.map(function (o, i) {
        // The agent's custom label belongs to the plain ticket button; a lone
        // package button keeps its own name, or "+ Hotel" would read "Book".
        var label = usable.length === 1 && o.kind === 'ticket'
          ? c.bookLabel
          : (o.short || o.label || c.bookLabel);
        if (o.stay) {
          return '<button type="button" class="tgtk-btn' + (i > 0 ? ' tgtk-btn2' : '') + (o.kind === 'ticket' ? '' : ' tgtk-btn-pkg') + '"'
            + ' data-stay="' + esc(o.stay) + '" aria-haspopup="dialog"'
            + ' aria-label="' + esc(label + ': ' + (ev.title || 'event')) + '">'
            + esc(label) + icon(kindIcon(o.kind)) + '</button>';
        }
        if (o.fly) {
          return '<button type="button" class="tgtk-btn' + (i > 0 ? ' tgtk-btn2' : '') + (o.kind === 'ticket' ? '' : ' tgtk-btn-pkg') + '"'
            + ' data-fly="' + esc(o.fly) + '" aria-haspopup="dialog"'
            + ' aria-label="' + esc(label + ': ' + (ev.title || 'event')) + '">'
            + esc(label) + icon(kindIcon(o.kind)) + '</button>';
        }
        return '<a class="tgtk-btn' + (i > 0 ? ' tgtk-btn2' : '') + (o.kind === 'ticket' ? '' : ' tgtk-btn-pkg') + '"'
          + ' href="' + esc(safeUrl(o.url)) + '" target="_blank" rel="noopener noreferrer"'
          + ' aria-label="' + esc(label + ': ' + (ev.title || 'event')) + '">'
          + esc(label) + icon(kindIcon(o.kind)) + '</a>';
      }).join('');
    } else {
      actions = '';
    }

    var dateBlock = p
      ? '<div class="tgtk-date"><span class="tgtk-dow">' + esc(p.dow) + '</span>'
        + '<span class="tgtk-day">' + esc(String(p.d)) + '</span>'
        + '<span class="tgtk-mon">' + esc(p.mon) + '</span></div>'
      : '<div class="tgtk-date"><span class="tgtk-mon">TBC</span></div>';

    return '<article class="tgtk-card">'
      + dateBlock
      + '<div class="tgtk-main"><h3 class="tgtk-title">' + title + '</h3>'
      + '<div class="tgtk-meta">' + meta.join('') + '</div></div>'
      + (actions ? '<div class="tgtk-actions">' + actions + '</div>' : '')
      + '</article>';
  };

  TGTicketsWidget.prototype._bodyHtml = function () {
    var c = this.cfg;

    if (this.loading) {
      var n = Math.min(clampInt(c.limit, 1, 100, DEFAULTS.limit), 4);
      var rows = '';
      for (var i = 0; i < n; i++) rows += '<div class="tgtk-skel"></div>';
      return '<div class="tgtk-list" aria-busy="true">' + rows + '</div>';
    }

    if (this.error) {
      // Only a genuine failure gets the warning icon. A source that is unset or
      // no longer in the feed is configuration, and reads as a calm empty slot.
      if (this.error === 'unset') {
        return '<div class="tgtk-state" role="status">' + icon('cal')
          + '<p>' + esc('Choose what to show and the events will appear here.') + '</p></div>';
      }
      if (this.error === 'not-found') {
        return '<div class="tgtk-state" role="status">' + icon('cal')
          + '<p>' + esc(c.emptyText || 'Nothing to show here just yet.') + '</p></div>';
      }
      return '<div class="tgtk-state" role="status">' + icon('warn')
        + '<p>' + esc('Events could not be loaded. Please try again shortly.') + '</p></div>';
    }

    if (!this.events || !this.events.length) {
      return '<div class="tgtk-state" role="status">' + icon('cal')
        + '<p>' + esc(c.emptyText || 'No upcoming events to show.') + '</p></div>';
    }

    var self = this;
    var evs = this.events;
    var filterHtml = '';
    // Home/Away filter — only when sourced by a team and there is a real split
    // (both home AND away games loaded).
    if (c.sourceType === 'team') {
      var tk = String(c.sourceValue || '').trim();
      var homeN = 0, awayN = 0;
      for (var i = 0; i < evs.length; i++) {
        var s = sideOf(evs[i], tk);
        if (s === 'home') homeN++; else if (s === 'away') awayN++;
      }
      if (homeN > 0 && awayN > 0) {
        var sv = (this._side === 'home' || this._side === 'away') ? this._side : 'all';
        var hf = function (v, label, on) {
          return '<button type="button" class="tgtk-hf' + (on ? ' is-on' : '') + '" data-side="' + v + '"'
            + ' aria-pressed="' + (on ? 'true' : 'false') + '">' + label + '</button>';
        };
        filterHtml = '<div class="tgtk-hafilter" role="group" aria-label="Home or away">'
          + hf('all', 'All', sv === 'all')
          + hf('home', 'Home (' + homeN + ')', sv === 'home')
          + hf('away', 'Away (' + awayN + ')', sv === 'away')
          + '</div>';
        if (sv === 'home') evs = evs.filter(function (e) { return sideOf(e, tk) === 'home'; });
        else if (sv === 'away') evs = evs.filter(function (e) { return sideOf(e, tk) === 'away'; });
      }
    }
    var cards = evs.map(function (ev) { return self._cardHtml(ev); }).join('');
    var cls = c.layout === 'cards' ? 'tgtk-grid' : 'tgtk-list';
    return filterHtml + '<div class="' + cls + '">' + cards + '</div>';
  };

  TGTicketsWidget.prototype._render = function () {
    var c = this.cfg;
    var head = '';
    if (c.heading || c.subheading) {
      head = '<div class="tgtk-head">'
        + (c.heading ? '<h2 class="tgtk-h">' + esc(c.heading) + '</h2>' : '')
        + (c.subheading ? '<p class="tgtk-sub">' + esc(c.subheading) + '</p>' : '')
        + '</div>';
    }
    var wrapCls = 'tgtk-root' + (c.layout === 'compact' ? ' tgtk-compact' : '');

    this.shadow.innerHTML = '<style>' + styles(c) + FLY_CSS + STAY_CSS + '</style>'
      + '<div class="' + wrapCls + '" data-theme="' + esc(this._theme()) + '">'
      + head + this._bodyHtml() + '</div>';
  };

  /**
   * Re-render with new config.
   *
   * Only refetches when something the QUERY depends on changed. An editor calls
   * this on every keystroke, and refetching because someone typed a heading
   * would hammer the API and make the preview flicker.
   */
  TGTicketsWidget.prototype.update = function (next) {
    var before = JSON.stringify(this._query());
    this.cfg = Object.assign({}, this.cfg, next || {});
    var after = JSON.stringify(this._query());
    if (before !== after) this._load();
    else this._render();
  };

  TGTicketsWidget.prototype.destroy = function () {
    this._reqId++;                       // orphan any in-flight response
    try { this.shadow.innerHTML = ''; } catch (e) { /* detached */ }
  };

  // ── Auto-init ─────────────────────────────────────────────────────────────

  function initOne(node) {
    if (node.getAttribute('data-tg-tickets-init') === '1') return;
    node.setAttribute('data-tg-tickets-init', '1');

    var inline = node.getAttribute('data-tg-config');
    if (inline) {
      var parsed = null;
      try { parsed = JSON.parse(inline); } catch (e) { parsed = null; }
      new TGTicketsWidget(node, parsed || {});
      return;
    }

    var id = node.getAttribute('data-tg-id');
    if (!id) { new TGTicketsWidget(node, {}); return; }

    fetch(CONFIG_API + '?id=' + encodeURIComponent(id), { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        new TGTicketsWidget(node, (d && (d.config || d)) || {});
      })
      .catch(function () { new TGTicketsWidget(node, {}); });
  }

  function init() {
    var nodes = document.querySelectorAll('[data-tg-widget="tickets"]');
    for (var i = 0; i < nodes.length; i++) initOne(nodes[i]);
  }

  window.TGTicketsWidget = TGTicketsWidget;
  window.__TG_TICKETS_VERSION__ = VERSION;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}());
