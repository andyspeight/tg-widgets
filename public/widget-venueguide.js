/**
 * Travelgenix Venue Guide Widget v1.0.0
 * Self-contained, embeddable widget
 * Zero dependencies — works on any website via a single script tag
 *
 * One venue, presented for someone actually going: a map with the ground
 * pinned, a photo, the facts that matter on the day (capacity, opened, city,
 * time zone, nearest airports), what is on there next with Book buttons, and
 * the official links. Everything on the sheet is sourced — the map and
 * coordinates from the supplier feed, the facts from Wikidata matched against
 * those coordinates, airports from the suite's own list — and a fact the
 * sources do not carry is left off, never guessed.
 *
 * The map is a single static image (MapTiler), not a script library: nothing
 * is injected into the host page, and the pin is drawn by CSS dead-centre,
 * which is exact because the map is centred on the venue.
 *
 * Usage:
 *   <div data-tg-widget="venueguide" data-tg-id="YOUR_WIDGET_ID"></div>
 *   <script src="https://tg-widgets.vercel.app/widget-venueguide.js" defer></script>
 */
(function () {
  'use strict';

  var VERSION = '1.0.0';

  function resolveOrigin() {
    if (typeof window === 'undefined') return '';
    if (window.__TG_WIDGET_ORIGIN__) return String(window.__TG_WIDGET_ORIGIN__);
    try {
      var me = document.currentScript;
      if (me && me.src) return new URL(me.src).origin;
      var scripts = document.getElementsByTagName('script');
      for (var i = scripts.length - 1; i >= 0; i--) {
        if (/\/widget-venueguide\.js(\?|$|#)/.test(scripts[i].src || '')) return new URL(scripts[i].src).origin;
      }
    } catch (e) { /* fall through */ }
    return '';
  }

  var ORIGIN = resolveOrigin();
  var CONFIG_API = (typeof window !== 'undefined' && window.__TG_WIDGET_API__) || (ORIGIN + '/api/widget-config');
  var FEED_API = (typeof window !== 'undefined' && window.__TG_EVENTS_API__) || (ORIGIN + '/api/events-feed');

  // The suite's shared MapTiler key (domain-restricted), same as the World Map
  // widget. A client can pass their own via cfg.mapKey.
  var MAPTILER_KEY = 'zSDRMRY6Fi2YzknQVzXf';

  var DEFAULTS = {
    venue: 'wembleystadium',
    venueLabel: '',
    heading: '',               // blank = the venue's name
    subheading: '',
    showPhoto: true,
    showMap: true,
    showFacts: true,
    showEvents: true,
    eventLimit: 4,
    showLinks: true,
    bookLabel: 'Book',
    bookingKinds: ['ticket'],
    currency: 'GBP',
    adults: 2,
    mapZoom: 14,
    mapKey: '',
    theme: 'light',
    accent: '#00B4D8',
    radius: 14,
    fontFamily: '',
    appId: '',
  };

  var IC = {
    cal: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z',
    pin: 'M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0ZM12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
    ext: 'M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6',
    ticket: 'M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2ZM13 5v14',
    bed: 'M2 4v16M2 8h18a2 2 0 0 1 2 2v10M2 17h20M6 8v9',
    plane: 'M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2Z',
    clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 6v6l4 2',
    users: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  };

  function icon(name, cls) {
    var paths = (IC[name] || '').split('M').filter(Boolean).map(function (seg) {
      return '<path d="M' + esc(seg) + '"/>';
    }).join('');
    return '<svg class="' + esc(cls || '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor"'
      + ' stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>';
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function safeColour(v, fallback) {
    var s = String(v == null ? '' : v).trim();
    return /^#[0-9a-fA-F]{3}$|^#[0-9a-fA-F]{6}$/.test(s) ? s : fallback;
  }

  function clamp(n, lo, hi, fallback) {
    var v = parseInt(n, 10);
    if (isNaN(v)) return fallback;
    return Math.max(lo, Math.min(hi, v));
  }

  function safeFont(v) {
    var s = String(v == null ? '' : v).trim();
    if (!s) return '';
    if (!/^[A-Za-z0-9 -]{1,48}$/.test(s)) return '';
    return '"' + s + '", ';
  }

  /** Only http(s) URLs from the API reach an href or src. */
  function safeUrl(v) {
    var s = String(v == null ? '' : v).trim();
    return /^https?:\/\//i.test(s) ? s : '';
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
    var root = w.shadow.querySelector('.tgvg-root');
    if (!root) return;

    var box = document.createElement('div');
    box.className = 'tgvg-fly';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Choose your departure airport');
    box.innerHTML = '<div class="tgvg-fly-t">Where are you flying from?</div>'
      + '<input class="tgvg-fly-in" type="text" placeholder="Type an airport or code"'
      + ' autocomplete="off" spellcheck="false" aria-label="Search airports">'
      + '<div class="tgvg-fly-list" role="listbox"></div>'
      + '<div class="tgvg-fly-note">Loading airports&hellip;</div>';
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

    var input = box.querySelector('.tgvg-fly-in');
    var list = box.querySelector('.tgvg-fly-list');
    var note = box.querySelector('.tgvg-fly-note');
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
        html += '<button type="button" class="tgvg-fly-opt' + (i === state.active ? ' is-active' : '') + '"'
          + ' role="option" aria-selected="' + (i === state.active) + '" data-iata="' + esc(a[0]) + '">'
          + '<span class="tgvg-fly-code">' + esc(a[0]) + '</span>'
          + '<span class="tgvg-fly-name">' + esc(a[1]) + '</span></button>';
      }
      list.innerHTML = html;
      if (state.all) note.textContent = state.list.length ? '' : 'No airport matches that. Try the three-letter code.';
    }

    list.addEventListener('click', function (e) {
      var opt = e.target && e.target.closest ? e.target.closest('.tgvg-fly-opt') : null;
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
    var root = w.shadow.querySelector('.tgvg-root');
    if (!root) return;

    var box = document.createElement('div');
    box.className = 'tgvg-fly';
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
      var html = '<div class="tgvg-fly-t">When would you like to stay?</div>'
        + '<div class="tgvg-stay-head">'
        + '<button type="button" class="tgvg-stay-nav" data-nav="-1"' + (canPrev ? '' : ' disabled')
        + ' aria-label="Previous month">&lsaquo;</button>'
        + '<span class="tgvg-stay-month">' + esc(STAY_MONTHS[mo] + ' ' + y) + '</span>'
        + '<button type="button" class="tgvg-stay-nav" data-nav="1"' + (canNext ? '' : ' disabled')
        + ' aria-label="Next month">&rsaquo;</button>'
        + '</div><div class="tgvg-stay-grid">';
      for (var i = 0; i < 7; i++) html += '<span class="tgvg-stay-dow">' + STAY_DAYS[i] + '</span>';
      for (var b = 0; b < startCol; b++) html += '<span></span>';
      for (var day = 1; day <= dim; day++) {
        var d = new Date(y, mo, day);
        var ok = state.checkIn ? (canOut(d) || canIn(d)) : canIn(d);
        var cls = 'tgvg-stay-day';
        if (+d === +eventDay) cls += ' is-event';
        if (state.checkIn && +d === +state.checkIn) cls += ' is-pick';
        else if (state.checkIn && d > state.checkIn && d <= eventDay) cls += ' is-span';
        html += ok
          ? '<button type="button" class="' + cls + '" data-d="' + stayIso(d) + '">' + day + '</button>'
          : '<span class="' + cls + ' is-off">' + day + '</span>';
      }
      html += '</div><div class="tgvg-fly-note">' + esc(state.checkIn
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

  var STAY_CSS = '.tgvg-stay-head{display:flex;align-items:center;justify-content:space-between;margin:2px 0 6px}'
    + '.tgvg-stay-month{font-weight:600;font-size:13px}'
    + '.tgvg-stay-nav{width:28px;height:28px;border:0;background:none;font:inherit;font-size:16px;'
    + 'color:inherit;cursor:pointer;border-radius:8px}'
    + '.tgvg-stay-nav:hover{background:rgba(0,0,0,.07)}'
    + '.tgvg-stay-nav[disabled]{opacity:.3;cursor:default;background:none}'
    + '.tgvg-stay-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:2px;text-align:center}'
    + '.tgvg-stay-dow{font-size:10px;font-weight:600;color:#5b6b7b;text-transform:uppercase;'
    + 'letter-spacing:.04em;padding:2px 0}'
    + '.tgvg-stay-day{border:0;background:none;font:inherit;font-size:12.5px;color:inherit;padding:0;'
    + 'height:32px;border-radius:8px;cursor:pointer}'
    + '.tgvg-stay-day:hover{background:rgba(0,0,0,.07)}'
    + '.tgvg-stay-day.is-off{opacity:.28;cursor:default}'
    + '.tgvg-stay-day.is-off:hover{background:none}'
    + '.tgvg-stay-day.is-event{box-shadow:inset 0 0 0 1.5px currentColor}'
    + '.tgvg-stay-day.is-pick{background:#1a2733;color:#fff}'
    + '.tgvg-stay-day.is-span{background:rgba(0,0,0,.08)}'
    + '.tgvg-root[data-theme="dark"] .tgvg-stay-dow{color:#93a4b5}'
    + '.tgvg-root[data-theme="dark"] .tgvg-stay-nav:hover{background:rgba(255,255,255,.09)}'
    + '.tgvg-root[data-theme="dark"] .tgvg-stay-day:hover{background:rgba(255,255,255,.09)}'
    + '.tgvg-root[data-theme="dark"] .tgvg-stay-day.is-off:hover{background:none}'
    + '.tgvg-root[data-theme="dark"] .tgvg-stay-day.is-pick{background:#e8eef4;color:#16202c}'
    + '.tgvg-root[data-theme="dark"] .tgvg-stay-day.is-span{background:rgba(255,255,255,.1)}';

  var FLY_CSS = '.tgvg-root{position:relative}'
    + 'button.tgvg-btn{appearance:none;-webkit-appearance:none;margin:0;border:0}'
    + '.tgvg-fly{position:absolute;z-index:40;background:#fff;color:#1a2733;border:1px solid #dde4ea;'
    + 'border-radius:12px;box-shadow:0 12px 32px rgba(10,30,50,.18);padding:12px;box-sizing:border-box;'
    + 'font-size:14px;line-height:1.4;text-align:left}'
    + '.tgvg-fly-t{font-weight:600;margin:0 0 8px;font-size:14px}'
    + '.tgvg-fly-in{width:100%;box-sizing:border-box;padding:8px 10px;font:inherit;color:inherit;'
    + 'background:transparent;border:1.5px solid #cfd8e0;border-radius:8px;outline:none}'
    + '.tgvg-fly-in:focus{border-color:currentColor}'
    + '.tgvg-fly-list{margin-top:8px;max-height:224px;overflow-y:auto}'
    + '.tgvg-fly-opt{display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:8px 10px;'
    + 'font:inherit;color:inherit;background:none;border:0;border-radius:8px;cursor:pointer}'
    + '.tgvg-fly-opt.is-active,.tgvg-fly-opt:hover{background:rgba(0,0,0,.07)}'
    + '.tgvg-fly-code{font-weight:700;font-size:12px;letter-spacing:.04em;min-width:38px}'
    + '.tgvg-fly-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
    + '.tgvg-fly-note{color:#5b6b7b;font-size:12px;margin-top:6px}'
    + '.tgvg-fly-note:empty{display:none}'
    + '.tgvg-root[data-theme="dark"] .tgvg-fly{background:#16202c;color:#e8eef4;border-color:#263442;'
    + 'box-shadow:0 12px 32px rgba(0,0,0,.55)}'
    + '.tgvg-root[data-theme="dark"] .tgvg-fly-in{border-color:#3a4a5a}'
    + '.tgvg-root[data-theme="dark"] .tgvg-fly-opt.is-active,'
    + '.tgvg-root[data-theme="dark"] .tgvg-fly-opt:hover{background:rgba(255,255,255,.09)}'
    + '.tgvg-root[data-theme="dark"] .tgvg-fly-note{color:#93a4b5}';

  function fmtDate(iso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''))) return '';
    var p = iso.split('-');
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return DOW[d.getDay()] + ' ' + d.getDate() + ' ' + MON[d.getMonth()];
  }

  // ── Element ───────────────────────────────────────────────────────────────

  function TGVenueGuideWidget(el, config) {
    if (!el || el.__tgVenueGuide) return el && el.__tgVenueGuide;
    el.__tgVenueGuide = this;

    this.el = el;
    this.cfg = Object.assign({}, DEFAULTS, config || {});
    this.shadow = el.attachShadow ? el.attachShadow({ mode: 'open' }) : el;
    flyInit(this);
    stayInit(this);
    this.data = null;
    this.error = false;

    this._render();
    this._load();
  }

  TGVenueGuideWidget.prototype._theme = function () {
    return this.cfg.theme === 'dark' ? 'dark' : 'light';
  };

  TGVenueGuideWidget.prototype._load = function () {
    var self = this;
    var c = this.cfg;
    var key = String(c.venue || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (!key) { this.data = null; this.error = false; this._render(); return; }

    var q = FEED_API + '?view=venue&key=' + encodeURIComponent(key)
      + '&limit=' + clamp(c.eventLimit, 1, 12, 4)
      + '&currency=' + encodeURIComponent(/^[A-Z]{3}$/.test(c.currency) ? c.currency : 'GBP')
      + '&adults=' + clamp(c.adults, 1, 9, 2)
      + '&booking=' + encodeURIComponent(
        // Explicit 'none' when every type is off: an absent parameter would
        // fall back to the server's default of every ready kind.
        (Array.isArray(c.bookingKinds) && c.bookingKinds.filter(Boolean).length
          ? c.bookingKinds.filter(Boolean)
          : (Array.isArray(c.bookingKinds) ? ['none'] : ['ticket'])).join(','));
    if (c.appId) q += '&appId=' + encodeURIComponent(String(c.appId).slice(0, 32));

    this._seq = (this._seq || 0) + 1;
    var mine = this._seq;
    fetch(q, { credentials: 'omit' })
      .then(function (r) { if (!r.ok) throw new Error('feed ' + r.status); return r.json(); })
      .then(function (d) {
        if (mine !== self._seq) return;
        self.data = d;
        self.error = false;
        self._render();
      })
      .catch(function () {
        if (mine !== self._seq) return;
        self.error = true;
        self._render();
      });
  };

  // ── Styles ────────────────────────────────────────────────────────────────

  function styles(c) {
    var accent = safeColour(c.accent, DEFAULTS.accent);
    var radius = clamp(c.radius, 0, 28, DEFAULTS.radius);
    var font = safeFont(c.fontFamily);
    return ':host{all:initial;display:block;}'
      + '*,*::before,*::after{box-sizing:border-box;}'
      // container-type makes the breakpoint below a @container query rather
      // than @media: the widget sits in whatever column the client gives it.
      + '.tgvg-root{container-type:inline-size;'
      + '--tgvg-accent:' + accent + ';--tgvg-radius:' + radius + 'px;'
      + 'font-family:' + font + '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;'
      + '-webkit-font-smoothing:antialiased;text-align:left;line-height:1.45;}'
      + '.tgvg-root[data-theme="light"]{--tgvg-bg:#fff;--tgvg-bg2:#f6f8fa;--tgvg-bg3:#eef1f5;'
      + '--tgvg-text:#0f1720;--tgvg-mute:#5b6875;--tgvg-border:#e3e8ee;--tgvg-on-accent:' + inkOn(accent) + ';}'
      + '.tgvg-root[data-theme="dark"]{--tgvg-bg:#12171d;--tgvg-bg2:#171d24;--tgvg-bg3:#1e252e;'
      + '--tgvg-text:#eef2f6;--tgvg-mute:#9aa7b4;--tgvg-border:#28313b;--tgvg-on-accent:' + inkOn(accent) + ';}'

      + '.tgvg-card{background:var(--tgvg-bg);color:var(--tgvg-text);border:1px solid var(--tgvg-border);'
      + 'border-radius:var(--tgvg-radius);overflow:hidden;}'
      + '.tgvg-head{padding:16px 18px 4px;}'
      + '.tgvg-h{margin:0;font-size:19px;font-weight:750;letter-spacing:-.01em;}'
      + '.tgvg-sub{margin:4px 0 0;font-size:13.5px;color:var(--tgvg-mute);}'

      + '.tgvg-media{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px;padding:14px 18px 0;}'
      + '.tgvg-media > *{min-width:0;}'
      + '.tgvg-media.is-single{grid-template-columns:minmax(0,1fr);}'
      + '.tgvg-map,.tgvg-photo{position:relative;border-radius:calc(var(--tgvg-radius) * .7);overflow:hidden;'
      + 'border:1px solid var(--tgvg-border);background:var(--tgvg-bg3);}'
      + '.tgvg-map img,.tgvg-photo img{display:block;width:100%;height:100%;min-height:150px;'
      + 'aspect-ratio:4/3;object-fit:cover;}'
      + '.tgvg-pin{position:absolute;left:50%;top:50%;width:14px;height:14px;'
      + 'transform:translate(-50%,-100%);background:var(--tgvg-accent);border:3px solid #fff;'
      + 'border-radius:50% 50% 50% 0;rotate:-45deg;box-shadow:0 2px 6px rgba(0,0,0,.35);}'
      + '.tgvg-credit{position:absolute;left:0;right:0;bottom:0;padding:3px 8px;font-size:9.5px;'
      + 'color:#fff;background:linear-gradient(transparent,rgba(0,0,0,.55));text-align:right;}'
      + '.tgvg-credit a{color:#fff;text-decoration:none;}'

      + '.tgvg-facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;padding:14px 18px 0;}'
      + '.tgvg-fact{display:flex;align-items:flex-start;gap:9px;padding:10px 12px;'
      + 'background:var(--tgvg-bg2);border-radius:calc(var(--tgvg-radius) * .6);}'
      + '.tgvg-fact svg{flex:none;width:16px;height:16px;color:var(--tgvg-accent);margin-top:2px;}'
      + '.tgvg-fact-body{min-width:0;}'
      + '.tgvg-fact-k{font-size:10.5px;font-weight:750;letter-spacing:.06em;text-transform:uppercase;'
      + 'color:var(--tgvg-mute);}'
      + '.tgvg-fact-v{font-size:13.5px;font-weight:600;overflow-wrap:break-word;}'
      + '.tgvg-fact-v small{display:block;font-weight:500;color:var(--tgvg-mute);}'

      + '.tgvg-events{padding:16px 18px 4px;}'
      + '.tgvg-events-h{margin:0 0 8px;font-size:12px;font-weight:750;letter-spacing:.06em;'
      + 'text-transform:uppercase;color:var(--tgvg-mute);}'
      + '.tgvg-ev{display:grid;grid-template-columns:52px minmax(0,1fr) auto;gap:12px;align-items:center;'
      + 'padding:10px 0;border-top:1px solid var(--tgvg-border);}'
      + '.tgvg-ev:first-of-type{border-top:0;}'
      + '.tgvg-date{text-align:center;background:var(--tgvg-bg2);border-radius:10px;padding:6px 4px;}'
      + '.tgvg-date b{display:block;font-size:16px;line-height:1.1;}'
      + '.tgvg-date span{display:block;font-size:10px;font-weight:700;letter-spacing:.05em;'
      + 'text-transform:uppercase;color:var(--tgvg-mute);}'
      + '.tgvg-ev-main{min-width:0;}'
      + '.tgvg-ev-t{font-size:14px;font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}'
      + '.tgvg-ev-m{font-size:12px;color:var(--tgvg-mute);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}'
      + '.tgvg-ev-btns{display:flex;flex-direction:column;gap:5px;align-items:stretch;}'
      + '.tgvg-ev-btns .tgvg-btn{justify-content:center;}'
      + '.tgvg-btn{display:inline-flex;align-items:center;gap:6px;padding:8px 14px;font-size:13px;'
      + 'font-weight:650;color:var(--tgvg-on-accent);background:var(--tgvg-accent);border-radius:10px;'
      + 'text-decoration:none;white-space:nowrap;}'
      + '.tgvg-btn:hover{filter:brightness(.93);}'
      + '.tgvg-btn svg{width:20px;height:20px;}'
      + '.tgvg-btn:focus-visible{outline:2px solid var(--tgvg-accent);outline-offset:2px;}'

      + '.tgvg-links{display:flex;flex-wrap:wrap;gap:8px;padding:14px 18px 18px;}'
      + '.tgvg-link{display:inline-flex;align-items:center;gap:6px;padding:8px 13px;font-size:12.5px;'
      + 'font-weight:650;color:var(--tgvg-text);background:var(--tgvg-bg);'
      + 'border:1px solid var(--tgvg-border);border-radius:10px;text-decoration:none;}'
      + '.tgvg-link:hover{border-color:var(--tgvg-accent);color:var(--tgvg-accent);}'
      + '.tgvg-link svg{width:13px;height:13px;}'
      + '.tgvg-note{padding:0 18px 14px;font-size:10.5px;color:var(--tgvg-mute);}'

      + '.tgvg-state{padding:34px 18px;text-align:center;color:var(--tgvg-mute);font-size:13.5px;}'
      + '.tgvg-skel{padding:18px;}'
      + '.tgvg-bar{height:12px;margin:10px 0;border-radius:6px;background:var(--tgvg-bg3);'
      + 'animation:tgvg-pulse 1.4s ease-in-out infinite;}'
      + '@keyframes tgvg-pulse{0%,100%{opacity:1;}50%{opacity:.45;}}'
      + '@media (prefers-reduced-motion:reduce){.tgvg-bar{animation:none;}}'

      + '@container (max-width:520px){'
      + '.tgvg-media{grid-template-columns:minmax(0,1fr);}'
      + '.tgvg-facts{grid-template-columns:minmax(0,1fr);}'
      + '.tgvg-ev{grid-template-columns:44px minmax(0,1fr);}'
      + '.tgvg-ev .tgvg-btn{grid-column:2;justify-self:start;}'
      + '}';
  }

  // ── Markup ────────────────────────────────────────────────────────────────

  TGVenueGuideWidget.prototype._mapUrl = function (geo) {
    var c = this.cfg;
    var key = /^[A-Za-z0-9]{6,40}$/.test(String(c.mapKey || '')) ? c.mapKey : MAPTILER_KEY;
    var zoom = clamp(c.mapZoom, 3, 18, 14);
    return 'https://api.maptiler.com/maps/streets-v2/static/'
      + geo.lng + ',' + geo.lat + ',' + zoom + '/600x450@2x.png?key=' + key + '&attribution=bottomleft';
  };

  TGVenueGuideWidget.prototype._html = function () {
    var c = this.cfg;

    if (this.error) return '<div class="tgvg-state">The venue guide could not be loaded just now.</div>';
    if (!c.venue) return '<div class="tgvg-state">Pick a venue in the editor to build its guide.</div>';
    if (!this.data) {
      return '<div class="tgvg-skel" aria-hidden="true">'
        + '<div class="tgvg-bar" style="width:46%"></div>'
        + '<div class="tgvg-bar" style="width:92%;height:120px;border-radius:12px"></div>'
        + '<div class="tgvg-bar" style="width:70%"></div>'
        + '<div class="tgvg-bar" style="width:84%"></div></div>';
    }

    var v = this.data.venue || {};
    var facts = v.facts || {};
    var geo = v.geo || null;
    var out = '';

    out += '<div class="tgvg-head">'
      + '<h2 class="tgvg-h">' + esc(c.heading || v.name || 'Venue') + '</h2>';
    var subBits = [];
    if (c.subheading) subBits.push(esc(c.subheading));
    else {
      var place = [facts.city, facts.country].filter(Boolean).join(', ');
      if (place) subBits.push(esc(place));
      if (v.aliases && v.aliases.length) subBits.push('also known as ' + esc(v.aliases[0]));
    }
    if (subBits.length) out += '<p class="tgvg-sub">' + subBits.join(' · ') + '</p>';
    out += '</div>';

    var mapOn = c.showMap && geo;
    var photoOn = c.showPhoto && facts.img && safeUrl(facts.img.u);
    if (mapOn || photoOn) {
      out += '<div class="tgvg-media' + ((mapOn && photoOn) ? '' : ' is-single') + '">';
      if (mapOn) {
        out += '<div class="tgvg-map">'
          + '<img src="' + esc(this._mapUrl(geo)) + '" alt="Map of ' + esc(v.name || 'the venue') + '" loading="lazy">'
          + '<span class="tgvg-pin" aria-hidden="true"></span>'
          + '<div class="tgvg-credit">&copy; MapTiler &copy; OpenStreetMap</div>'
          + '</div>';
      }
      if (photoOn) {
        var credit = 'Photo' + (facts.img.by ? ': ' + esc(facts.img.by) : '')
          + (facts.img.lic ? ' (' + esc(facts.img.lic) + ')' : '');
        out += '<div class="tgvg-photo">'
          + '<img src="' + esc(safeUrl(facts.img.u)) + '" alt="' + esc(v.name || 'The venue') + '" loading="lazy">'
          + '<div class="tgvg-credit">'
          + (safeUrl(facts.img.page)
            ? '<a href="' + esc(safeUrl(facts.img.page)) + '" target="_blank" rel="noopener noreferrer">' + credit + '</a>'
            : credit)
          + '</div></div>';
      }
      out += '</div>';
    }

    if (c.showFacts) {
      var cells = '';
      var fact = function (ic, k, v2, small) {
        cells += '<div class="tgvg-fact">' + icon(ic)
          + '<div class="tgvg-fact-body"><div class="tgvg-fact-k">' + esc(k) + '</div>'
          + '<div class="tgvg-fact-v">' + v2 + (small ? '<small>' + small + '</small>' : '') + '</div></div></div>';
      };
      if (facts.cap) fact('users', 'Capacity', esc(Number(facts.cap).toLocaleString('en-GB')));
      if (facts.opened) fact('cal', 'Opened', esc(String(facts.opened)));
      if (facts.tz) fact('clock', 'Time zone', esc(String(facts.tz).replace(/_/g, ' ')));
      if (facts.air && facts.air.length) {
        var a = facts.air[0];
        fact('plane', 'Nearest airport', esc(a[1]) + ' (' + esc(a[0]) + ')',
          esc(a[2]) + ' km away' + (facts.air[1] ? ' · then ' + esc(facts.air[1][1]) + ', ' + esc(facts.air[1][2]) + ' km' : ''));
      }
      if (cells) out += '<div class="tgvg-facts">' + cells + '</div>';
    }

    if (c.showEvents) {
      var evs = (this.data.events || []).slice(0, clamp(c.eventLimit, 1, 12, 4));
      if (evs.length) {
        out += '<div class="tgvg-events"><h3 class="tgvg-events-h">What&#39;s on here</h3>';
        for (var i = 0; i < evs.length; i++) {
          var e = evs[i];
          var mon = fmtDate(e.startDate);
          var meta = [];
          if (e.timeKnown && e.startTime) meta.push(esc(e.startTime));
          if (e.competitionLabel) meta.push(esc(e.competitionLabel));
          else if (e.categoryLabel) meta.push(esc(e.categoryLabel));
          var usable = (e.bookingOptions || []).map(function (o) {
            var direct = safeUrl(o.url);
            if (o.kind === 'ticket-hotel' && direct && FLY_TPL_OK.test(direct)) {
              return { kind: o.kind, short: o.short, stay: direct };
            }
            if (direct) return { kind: o.kind, short: o.short, url: direct };
            var tpl = flyTpl(o);
            if (tpl) return { kind: o.kind, short: o.short, fly: tpl };
            return null;
          }).filter(Boolean);
          var wantsTicket = !Array.isArray(c.bookingKinds) || c.bookingKinds.indexOf('ticket') !== -1;
          if (!usable.length && wantsTicket && e.booking && safeUrl(e.booking.url)) {
            usable = [{ kind: 'ticket', short: c.bookLabel, url: e.booking.url }];
          }
          out += '<div class="tgvg-ev">'
            + '<div class="tgvg-date"><b>' + esc(e.startDate ? String(+e.startDate.slice(8, 10)) : '') + '</b>'
            + '<span>' + esc(mon.slice(mon.lastIndexOf(' ') + 1)) + '</span></div>'
            + '<div class="tgvg-ev-main"><div class="tgvg-ev-t">' + esc(e.title || 'Event') + '</div>'
            + '<div class="tgvg-ev-m">' + esc(mon) + (meta.length ? ' · ' + meta.join(' · ') : '') + '</div></div>'
            + (usable.length
              ? '<div class="tgvg-ev-btns">' + usable.map(function (o) {
                var label = usable.length === 1 && o.kind === 'ticket'
                  ? (c.bookLabel || o.short || 'Book')
                  : (o.short || c.bookLabel || 'Book');
                if (o.stay) {
                  return '<button type="button" class="tgvg-btn" data-stay="' + esc(o.stay) + '"'
                    + ' aria-haspopup="dialog">' + esc(label) + icon(kindIcon(o.kind)) + '</button>';
                }
                if (o.fly) {
                  return '<button type="button" class="tgvg-btn" data-fly="' + esc(o.fly) + '"'
                    + ' aria-haspopup="dialog">' + esc(label) + icon(kindIcon(o.kind)) + '</button>';
                }
                return '<a class="tgvg-btn" href="' + esc(safeUrl(o.url)) + '" target="_blank"'
                  + ' rel="noopener noreferrer">' + esc(label) + icon(kindIcon(o.kind)) + '</a>';
              }).join('') + '</div>'
              : '');
          out += '</div>';
        }
        out += '</div>';
      }
    }

    if (c.showLinks) {
      var links = '';
      if (safeUrl(facts.web)) {
        links += '<a class="tgvg-link" href="' + esc(safeUrl(facts.web)) + '" target="_blank" rel="noopener noreferrer">'
          + icon('ext') + 'Official site</a>';
      }
      if (geo) {
        links += '<a class="tgvg-link" href="https://www.google.com/maps/dir/?api=1&amp;destination='
          + esc(geo.lat + ',' + geo.lng) + '" target="_blank" rel="noopener noreferrer">'
          + icon('pin') + 'Directions</a>';
      }
      if (safeUrl(facts.wiki)) {
        links += '<a class="tgvg-link" href="' + esc(safeUrl(facts.wiki)) + '" target="_blank" rel="noopener noreferrer">'
          + icon('ext') + 'Wikipedia</a>';
      }
      if (links) out += '<div class="tgvg-links">' + links + '</div>';
    }

    if ((c.showFacts && facts.air && facts.air.length) || (c.showMap && geo)) {
      out += '<div class="tgvg-note">Airport distances are straight-line. Venue facts are shown only when two independent sources agree.</div>';
    }

    return out;
  };

  TGVenueGuideWidget.prototype._render = function () {
    this.shadow.innerHTML = '<style>' + styles(this.cfg) + FLY_CSS + STAY_CSS + '</style>'
      + '<div class="tgvg-root" data-theme="' + esc(this._theme()) + '">'
      + '<div class="tgvg-card">' + this._html() + '</div></div>';
  };

  // ── Public API ────────────────────────────────────────────────────────────

  TGVenueGuideWidget.prototype.update = function (next) {
    var prevVenue = this.cfg.venue;
    var prevData = [this.cfg.eventLimit, this.cfg.currency, this.cfg.adults,
      (this.cfg.bookingKinds || []).join(','), this.cfg.appId].join('~');
    this.cfg = Object.assign({}, this.cfg, next || {});
    var nowData = [this.cfg.eventLimit, this.cfg.currency, this.cfg.adults,
      (this.cfg.bookingKinds || []).join(','), this.cfg.appId].join('~');
    if (this.cfg.venue !== prevVenue || nowData !== prevData) {
      this.data = null;
      this._render();
      this._load();
    } else {
      this._render();
    }
  };

  TGVenueGuideWidget.prototype.destroy = function () {
    this._seq = (this._seq || 0) + 1;
    this.shadow.innerHTML = '';
    if (this.el) delete this.el.__tgVenueGuide;
  };

  // ── Auto-init ─────────────────────────────────────────────────────────────

  function boot(el) {
    if (el.__tgVenueGuide) return;
    var inline = el.getAttribute('data-tg-config');
    if (inline) {
      var parsed = null;
      try { parsed = JSON.parse(inline); } catch (e) { parsed = null; }
      new TGVenueGuideWidget(el, parsed || {});
      return;
    }
    var id = el.getAttribute('data-tg-id');
    if (!id) { new TGVenueGuideWidget(el, {}); return; }
    fetch(CONFIG_API + '?id=' + encodeURIComponent(id))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { new TGVenueGuideWidget(el, (d && d.config) || {}); })
      .catch(function () { new TGVenueGuideWidget(el, {}); });
  }

  function initAll() {
    var nodes = document.querySelectorAll('[data-tg-widget="venueguide"]');
    for (var i = 0; i < nodes.length; i++) boot(nodes[i]);
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initAll);
    else initAll();
  }

  if (typeof window !== 'undefined') {
    window.TGVenueGuideWidget = TGVenueGuideWidget;
    window.__TG_VENUEGUIDE_VERSION__ = VERSION;
  }
}());
