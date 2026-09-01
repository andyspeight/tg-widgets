/**
 * Travelgenix Next Event Widget v1.0.0
 * Self-contained, embeddable widget
 * Zero dependencies — works on any website via a single script tag
 *
 * One event, not a list: the next fixture for a club, the next night at a
 * venue, the next date on a tour. Countdown, kick-off, ground, book.
 *
 * Sized for a sidebar or a hero strip. This is the widget a client will give
 * space to when they will not give up a whole page section, and it is the
 * highest conversion per pixel in the set.
 *
 * ON THE COUNTDOWN
 * The feed's times carry no timezone, so the countdown treats the event's time
 * as the VIEWER'S local clock. For a UK agent selling UK football to UK
 * customers that is exactly right. For an MLB game it will be out by the
 * transatlantic offset until the venue-to-timezone question is settled, which
 * is why the countdown can be switched off and why it never claims a precision
 * it does not have — it stops at minutes, never seconds.
 *
 * Usage:
 *   <div data-tg-widget="nextevent" data-tg-id="YOUR_WIDGET_ID"></div>
 *   <script src="https://tg-widgets.vercel.app/widget-nextevent.js" defer></script>
 */
(function () {
  'use strict';

  var VERSION = '1.1.0';

  function resolveOrigin() {
    if (typeof window === 'undefined') return '';
    if (window.__TG_WIDGET_ORIGIN__) return String(window.__TG_WIDGET_ORIGIN__);
    try {
      var me = document.currentScript;
      if (me && me.src) return new URL(me.src).origin;
      var scripts = document.getElementsByTagName('script');
      for (var i = scripts.length - 1; i >= 0; i--) {
        if (/\/widget-nextevent\.js(\?|$|#)/.test(scripts[i].src || '')) return new URL(scripts[i].src).origin;
      }
    } catch (e) { /* fall through */ }
    return '';
  }

  var ORIGIN = resolveOrigin();
  var CONFIG_API = (typeof window !== 'undefined' && window.__TG_WIDGET_API__) || (ORIGIN + '/api/widget-config');
  var FEED_API = (typeof window !== 'undefined' && window.__TG_EVENTS_API__) || (ORIGIN + '/api/events-feed');

  var DEFAULTS = {
    sourceType: 'team',
    sourceValue: 'arsenal',
    side: 'home',
    competition: '',
    layout: 'card',           // card | banner | minimal
    label: 'Next up',
    showCountdown: true,
    showVenue: true,
    showCompetition: true,
    bookLabel: 'Book tickets',
    bookingKinds: ['ticket'],
    packageBgColor: '',       // '' = the standard secondary look
    packageTextColor: '',
    currency: 'GBP',
    adults: 2,
    fallbackText: '',
    theme: 'light',
    accent: '#00B4D8',
    bookTextColor: '',
    radius: 16,
    fontFamily: '',
    appId: '',
  };

  var IC = {
    clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 6v6l4 2',
    pin: 'M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0ZM12 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
    ext: 'M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6',
    ticket: 'M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2ZM13 5v14',
    bed: 'M2 4v16M2 8h18a2 2 0 0 1 2 2v10M2 17h20M6 8v9',
    plane: 'M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2Z',
    cal: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z',
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
    var root = w.shadow.querySelector('.tgne-root');
    if (!root) return;

    var box = document.createElement('div');
    box.className = 'tgne-fly';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Choose your departure airport');
    box.innerHTML = '<div class="tgne-fly-t">Where are you flying from?</div>'
      + '<input class="tgne-fly-in" type="text" placeholder="Type an airport or code"'
      + ' autocomplete="off" spellcheck="false" aria-label="Search airports">'
      + '<div class="tgne-fly-list" role="listbox"></div>'
      + '<div class="tgne-fly-note">Loading airports&hellip;</div>';
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

    var input = box.querySelector('.tgne-fly-in');
    var list = box.querySelector('.tgne-fly-list');
    var note = box.querySelector('.tgne-fly-note');
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
        html += '<button type="button" class="tgne-fly-opt' + (i === state.active ? ' is-active' : '') + '"'
          + ' role="option" aria-selected="' + (i === state.active) + '" data-iata="' + esc(a[0]) + '">'
          + '<span class="tgne-fly-code">' + esc(a[0]) + '</span>'
          + '<span class="tgne-fly-name">' + esc(a[1]) + '</span></button>';
      }
      list.innerHTML = html;
      if (state.all) note.textContent = state.list.length ? '' : 'No airport matches that. Try the three-letter code.';
    }

    list.addEventListener('click', function (e) {
      var opt = e.target && e.target.closest ? e.target.closest('.tgne-fly-opt') : null;
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
    var root = w.shadow.querySelector('.tgne-root');
    if (!root) return;

    var box = document.createElement('div');
    box.className = 'tgne-fly';
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
      var html = '<div class="tgne-fly-t">When would you like to stay?</div>'
        + '<div class="tgne-stay-head">'
        + '<button type="button" class="tgne-stay-nav" data-nav="-1"' + (canPrev ? '' : ' disabled')
        + ' aria-label="Previous month">&lsaquo;</button>'
        + '<span class="tgne-stay-month">' + esc(STAY_MONTHS[mo] + ' ' + y) + '</span>'
        + '<button type="button" class="tgne-stay-nav" data-nav="1"' + (canNext ? '' : ' disabled')
        + ' aria-label="Next month">&rsaquo;</button>'
        + '</div><div class="tgne-stay-grid">';
      for (var i = 0; i < 7; i++) html += '<span class="tgne-stay-dow">' + STAY_DAYS[i] + '</span>';
      for (var b = 0; b < startCol; b++) html += '<span></span>';
      for (var day = 1; day <= dim; day++) {
        var d = new Date(y, mo, day);
        var ok = state.checkIn ? (canOut(d) || canIn(d)) : canIn(d);
        var cls = 'tgne-stay-day';
        if (+d === +eventDay) cls += ' is-event';
        if (state.checkIn && +d === +state.checkIn) cls += ' is-pick';
        else if (state.checkIn && d > state.checkIn && d <= eventDay) cls += ' is-span';
        html += ok
          ? '<button type="button" class="' + cls + '" data-d="' + stayIso(d) + '">' + day + '</button>'
          : '<span class="' + cls + ' is-off">' + day + '</span>';
      }
      html += '</div><div class="tgne-fly-note">' + esc(state.checkIn
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

  var STAY_CSS = '.tgne-stay-head{display:flex;align-items:center;justify-content:space-between;margin:2px 0 6px}'
    + '.tgne-stay-month{font-weight:600;font-size:13px}'
    + '.tgne-stay-nav{width:28px;height:28px;border:0;background:none;font:inherit;font-size:16px;'
    + 'color:inherit;cursor:pointer;border-radius:8px}'
    + '.tgne-stay-nav:hover{background:rgba(0,0,0,.07)}'
    + '.tgne-stay-nav[disabled]{opacity:.3;cursor:default;background:none}'
    + '.tgne-stay-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:2px;text-align:center}'
    + '.tgne-stay-dow{font-size:10px;font-weight:600;color:#5b6b7b;text-transform:uppercase;'
    + 'letter-spacing:.04em;padding:2px 0}'
    + '.tgne-stay-day{border:0;background:none;font:inherit;font-size:12.5px;color:inherit;padding:0;'
    + 'height:32px;border-radius:8px;cursor:pointer}'
    + '.tgne-stay-day:hover{background:rgba(0,0,0,.07)}'
    + '.tgne-stay-day.is-off{opacity:.28;cursor:default}'
    + '.tgne-stay-day.is-off:hover{background:none}'
    + '.tgne-stay-day.is-event{box-shadow:inset 0 0 0 1.5px currentColor}'
    + '.tgne-stay-day.is-pick{background:#1a2733;color:#fff}'
    + '.tgne-stay-day.is-span{background:rgba(0,0,0,.08)}'
    + '.tgne-root[data-theme="dark"] .tgne-stay-dow{color:#93a4b5}'
    + '.tgne-root[data-theme="dark"] .tgne-stay-nav:hover{background:rgba(255,255,255,.09)}'
    + '.tgne-root[data-theme="dark"] .tgne-stay-day:hover{background:rgba(255,255,255,.09)}'
    + '.tgne-root[data-theme="dark"] .tgne-stay-day.is-off:hover{background:none}'
    + '.tgne-root[data-theme="dark"] .tgne-stay-day.is-pick{background:#e8eef4;color:#16202c}'
    + '.tgne-root[data-theme="dark"] .tgne-stay-day.is-span{background:rgba(255,255,255,.1)}';

  var FLY_CSS = '.tgne-root{position:relative}'
    + 'button.tgne-btn{appearance:none;-webkit-appearance:none;margin:0}'
    + '.tgne-fly{position:absolute;z-index:40;background:#fff;color:#1a2733;border:1px solid #dde4ea;'
    + 'border-radius:12px;box-shadow:0 12px 32px rgba(10,30,50,.18);padding:12px;box-sizing:border-box;'
    + 'font-size:14px;line-height:1.4;text-align:left}'
    + '.tgne-fly-t{font-weight:600;margin:0 0 8px;font-size:14px}'
    + '.tgne-fly-in{width:100%;box-sizing:border-box;padding:8px 10px;font:inherit;color:inherit;'
    + 'background:transparent;border:1.5px solid #cfd8e0;border-radius:8px;outline:none}'
    + '.tgne-fly-in:focus{border-color:currentColor}'
    + '.tgne-fly-list{margin-top:8px;max-height:224px;overflow-y:auto}'
    + '.tgne-fly-opt{display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:8px 10px;'
    + 'font:inherit;color:inherit;background:none;border:0;border-radius:8px;cursor:pointer}'
    + '.tgne-fly-opt.is-active,.tgne-fly-opt:hover{background:rgba(0,0,0,.07)}'
    + '.tgne-fly-code{font-weight:700;font-size:12px;letter-spacing:.04em;min-width:38px}'
    + '.tgne-fly-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
    + '.tgne-fly-note{color:#5b6b7b;font-size:12px;margin-top:6px}'
    + '.tgne-fly-note:empty{display:none}'
    + '.tgne-root[data-theme="dark"] .tgne-fly{background:#16202c;color:#e8eef4;border-color:#263442;'
    + 'box-shadow:0 12px 32px rgba(0,0,0,.55)}'
    + '.tgne-root[data-theme="dark"] .tgne-fly-in{border-color:#3a4a5a}'
    + '.tgne-root[data-theme="dark"] .tgne-fly-opt.is-active,'
    + '.tgne-root[data-theme="dark"] .tgne-fly-opt:hover{background:rgba(255,255,255,.09)}'
    + '.tgne-root[data-theme="dark"] .tgne-fly-note{color:#93a4b5}';
  function safeColour(c, fallback) {
    var s = String(c == null ? '' : c).trim();
    if (/^#[0-9a-f]{3}$/i.test(s) || /^#[0-9a-f]{6}$/i.test(s)) return s;
    return fallback;
  }
  function safeFont(f) {
    var s = String(f == null ? '' : f).trim();
    return /^[A-Za-z0-9 ,'"-]{1,120}$/.test(s) ? s : '';
  }
  function clampInt(v, min, max, fallback) {
    var n = parseInt(v, 10);
    return isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
  }

  var DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MON = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  /** Split by hand — new Date('2026-08-22') is UTC and shifts the day west. */
  function parts(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(String(iso || ''));
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    return {
      y: y, m: mo, d: d,
      hh: m[4] ? +m[4] : 0, mm: m[5] ? +m[5] : 0,
      dow: DOW[new Date(y, mo - 1, d).getDay()],
      mon: MON[mo - 1],
    };
  }

  function localToday(offsetDays) {
    var t = new Date();
    if (offsetDays) t.setDate(t.getDate() + offsetDays);
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return t.getFullYear() + '-' + p(t.getMonth() + 1) + '-' + p(t.getDate());
  }

  /** Whole days, hours and minutes until the event, or null once it has begun. */
  function untilParts(iso) {
    var p = parts(iso);
    if (!p) return null;
    var target = new Date(p.y, p.m - 1, p.d, p.hh, p.mm, 0, 0).getTime();
    var diff = target - Date.now();
    if (diff <= 0) return null;
    var mins = Math.floor(diff / 60000);
    return { days: Math.floor(mins / 1440), hours: Math.floor((mins % 1440) / 60), mins: mins % 60 };
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
      ? '.tgne-btn.tgne-btn-pkg{'
        + (pkgBg ? 'background:' + pkgBg + ';border-color:' + pkgBg + ';box-shadow:none;' : '')
        + 'color:' + (pkgInk || inkOn(pkgBg)) + ';}'
        + (pkgBg ? '.tgne-btn.tgne-btn-pkg:hover{background:' + pkgBg + ';filter:brightness(.93);}' : '')
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
      + '.tgne-root{container-type:inline-size;font-family:' + stack + ';'
      + '--tgne-accent:' + accent + ';--tgne-radius:' + radius + 'px;'
      + '--tgne-bg:#FFFFFF;--tgne-bg2:#F8FAFC;--tgne-bg3:#F1F5F9;--tgne-border:#E2E8F0;'
      + '--tgne-text:#0F172A;--tgne-sub:#475569;--tgne-mute:#64748B;--tgne-on-accent:' + btnText + ';'
      + 'font-size:15px;line-height:1.6;color:var(--tgne-text);box-sizing:border-box;'
      + '-webkit-font-smoothing:antialiased;}'
      + '.tgne-root *,.tgne-root *::before,.tgne-root *::after{box-sizing:border-box;}'
      + '.tgne-root[data-theme="dark"]{--tgne-bg:#0F172A;--tgne-bg2:#1E293B;--tgne-bg3:#334155;'
      + '--tgne-border:#334155;--tgne-text:#F8FAFC;--tgne-sub:#CBD5E1;--tgne-mute:#94A3B8;}'

      + '.tgne-card{background:var(--tgne-bg);border:1px solid var(--tgne-border);'
      + 'border-radius:var(--tgne-radius);padding:20px;display:flex;flex-direction:column;gap:14px;}'

      + '.tgne-label{font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;'
      + 'color:var(--tgne-accent);}'

      + '.tgne-title{margin:0;font-size:21px;font-weight:700;line-height:1.25;letter-spacing:-.01em;'
      + 'overflow-wrap:anywhere;}'
      + '.tgne-when{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;font-size:14px;color:var(--tgne-sub);}'
      + '.tgne-when svg{width:15px;height:15px;flex:none;color:var(--tgne-mute);vertical-align:-2px;}'
      + '.tgne-when span{display:inline-flex;align-items:center;gap:5px;}'
      + '.tgne-dot{color:var(--tgne-mute);}'
      + '.tgne-chip{display:inline-flex;align-items:center;padding:2px 9px;border-radius:999px;'
      + 'background:var(--tgne-bg3);color:var(--tgne-sub);font-size:11.5px;font-weight:500;}'

      // The countdown is the reason this widget exists, so it gets the weight.
      + '.tgne-count{display:flex;gap:8px;}'
      + '.tgne-unit{flex:1;text-align:center;background:var(--tgne-bg2);border:1px solid var(--tgne-border);'
      + 'border-radius:calc(var(--tgne-radius) - 6px);padding:10px 4px;}'
      + '.tgne-num{display:block;font-size:26px;font-weight:700;line-height:1;'
      + 'font-variant-numeric:tabular-nums;letter-spacing:-.02em;}'
      + '.tgne-uname{display:block;margin-top:3px;font-size:10.5px;text-transform:uppercase;'
      + 'letter-spacing:.08em;color:var(--tgne-mute);}'

      + '.tgne-actions{display:flex;flex-wrap:wrap;gap:8px;}'
      + '.tgne-btn{flex:1 1 auto;display:inline-flex;align-items:center;justify-content:center;gap:6px;'
      + 'min-height:46px;padding:0 18px;border-radius:calc(var(--tgne-radius) - 6px);'
      + 'border:1px solid transparent;background:var(--tgne-accent);color:var(--tgne-on-accent);'
      + 'font:inherit;font-size:14px;font-weight:600;text-decoration:none;cursor:pointer;white-space:nowrap;'
      + 'transition:filter .16s ease-out,transform .12s ease-out;}'
      + '.tgne-btn{font-weight:700;letter-spacing:.01em;'
      + 'box-shadow:0 2px 7px color-mix(in srgb,var(--tgne-accent) 34%,transparent);'
      + 'transition:transform .16s ease-out,box-shadow .16s ease-out,filter .16s ease-out;}'
      + '.tgne-btn:hover{transform:translateY(-1px);filter:brightness(1.05);'
      + 'box-shadow:0 8px 20px color-mix(in srgb,var(--tgne-accent) 46%,transparent);}'
      + '.tgne-btn:active{transform:translateY(0) scale(.98);}'
      + '.tgne-btn svg{width:22px;height:22px;}'
      + '.tgne-btn2{background:var(--tgne-bg);border-color:var(--tgne-border);color:var(--tgne-text);box-shadow:none;}'
      + '.tgne-btn2:hover{background:var(--tgne-bg3);filter:none;transform:translateY(-1px);'
      + 'border-color:var(--tgne-accent);box-shadow:0 4px 10px rgba(15,23,42,.08);}'
      + '.tgne-btn:focus-visible{outline:2px solid var(--tgne-accent);outline-offset:2px;}'

      // Banner: one wide strip, for above or below a hero.
      + '.tgne-banner .tgne-card{flex-direction:row;align-items:center;gap:20px;flex-wrap:wrap;}'
      + '.tgne-banner .tgne-main{flex:1 1 260px;min-width:0;}'
      + '.tgne-banner .tgne-count{flex:0 0 auto;}'
      + '.tgne-banner .tgne-unit{min-width:60px;}'
      + '.tgne-banner .tgne-actions{flex:0 0 auto;}'
      + '.tgne-banner .tgne-btn{flex:0 0 auto;}'

      // Minimal: no countdown furniture, for a tight sidebar.
      + '.tgne-minimal .tgne-card{padding:16px;gap:10px;}'
      + '.tgne-minimal .tgne-title{font-size:17px;}'
      + '.tgne-minimal .tgne-count{display:none;}'

      + '.tgne-state{padding:24px 18px;text-align:center;color:var(--tgne-sub);'
      + 'background:var(--tgne-bg);border:1px dashed var(--tgne-border);border-radius:var(--tgne-radius);}'
      + '.tgne-state svg{width:24px;height:24px;color:var(--tgne-mute);margin-bottom:6px;}'
      + '.tgne-state p{margin:0;}'
      + '.tgne-skel{height:190px;border-radius:var(--tgne-radius);'
      + 'background:linear-gradient(90deg,var(--tgne-bg3) 25%,var(--tgne-bg2) 50%,var(--tgne-bg3) 75%);'
      + 'background-size:200% 100%;animation:tgne-sh 1.4s ease-in-out infinite;}'
      + '@keyframes tgne-sh{0%{background-position:200% 0}100%{background-position:-200% 0}}'

      + '@container (max-width:480px){.tgne-banner .tgne-card{flex-direction:column;align-items:stretch;}'
      // In a column the row flex-basis (260px) becomes a HEIGHT and opens a
      // void under the event details, so it resets when the banner stacks.
      + '.tgne-banner .tgne-main{flex:1 1 auto;}'
      + '.tgne-banner .tgne-count{justify-content:stretch;}'
      + '.tgne-banner .tgne-unit{flex:1 1 0;}'
      + '.tgne-banner .tgne-btn{flex:1 1 auto;}}'
      + '@media (prefers-reduced-motion:reduce){.tgne-root *{animation-duration:.01ms !important;'
      + 'animation-iteration-count:1 !important;transition-duration:.01ms !important;}}'
      + pkgCss;
  }

  function needsValue(t) {
    return t === 'competition' || t === 'team' || t === 'venue' || t === 'performer' || t === 'category';
  }

  function TGNextEventWidget(container, config) {
    this.el = container;
    this.cfg = Object.assign({}, DEFAULTS, config || {});
    this.shadow = container.shadowRoot || container.attachShadow({ mode: 'open' });
    flyInit(this);
    stayInit(this);
    this.event = null;
    this.state = 'loading';
    this._reqId = 0;
    this._timer = null;
    this._render();
    this._load();
  }

  TGNextEventWidget.prototype._theme = function () {
    var t = this.cfg.theme;
    if (t === 'dark') return 'dark';
    if (t === 'auto') {
      try { return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; }
      catch (e) { return 'light'; }
    }
    return 'light';
  };

  TGNextEventWidget.prototype._query = function () {
    var c = this.cfg;
    var q = {
      limit: '1',
      from: localToday(0),
      currency: c.currency,
      adults: String(clampInt(c.adults, 1, 20, 2)),
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
      case 'venue':     q.view = 'venue'; q.key = v; break;
      case 'performer': q.view = 'performer'; q.key = v; break;
      case 'category':  q.view = 'browse'; q.category = v; break;
      case 'search':    q.view = 'browse'; q.q = v; break;
      case 'competition': q.view = 'competition'; q.slug = v; break;
      case 'team':
      default:
        q.view = 'team'; q.key = v;
        if (c.side === 'home' || c.side === 'away') q.side = c.side;
        if (c.competition) q.competition = c.competition;
        break;
    }
    return q;
  };

  TGNextEventWidget.prototype._load = function () {
    var self = this;
    var mine = ++this._reqId;
    this._stopTimer();

    if (needsValue(this.cfg.sourceType) && !String(this.cfg.sourceValue || '').trim()) {
      this.event = null;
      this.state = 'unset';
      this._render();
      return;
    }

    var q = this._query();
    var parts2 = [];
    for (var k in q) {
      if (Object.prototype.hasOwnProperty.call(q, k) && q[k] !== '' && q[k] != null) {
        parts2.push(encodeURIComponent(k) + '=' + encodeURIComponent(q[k]));
      }
    }

    this.state = 'loading';
    this._render();

    fetch(FEED_API + '?' + parts2.join('&'), { headers: { Accept: 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error(r.status === 404 ? 'not-found' : 'failed'); return r.json(); })
      .then(function (d) {
        if (mine !== self._reqId) return;
        var list = (d && d.events) || [];
        self.event = list.length ? list[0] : null;
        self.state = self.event ? 'ready' : 'empty';
        self._render();
        if (self.event && self.cfg.showCountdown) self._startTimer();
      })
      .catch(function (err) {
        if (mine !== self._reqId) return;
        self.event = null;
        self.state = err && err.message === 'not-found' ? 'empty' : 'error';
        self._render();
      });
  };

  /**
   * Re-render once a minute. Not once a second: the countdown stops at minutes,
   * so a per-second timer would burn a client's battery redrawing the same text.
   */
  TGNextEventWidget.prototype._startTimer = function () {
    var self = this;
    this._stopTimer();
    this._timer = setInterval(function () {
      if (!self.event) { self._stopTimer(); return; }
      if (!untilParts(self.event.startsAtLocal)) {
        // Kick-off has passed. Fetch the next one rather than counting to zero
        // forever on a page nobody has reloaded since yesterday.
        self._load();
        return;
      }
      self._render();
    }, 60000);
  };

  TGNextEventWidget.prototype._stopTimer = function () {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  };

  TGNextEventWidget.prototype._bodyHtml = function () {
    var c = this.cfg;

    if (this.state === 'loading') return '<div class="tgne-skel" aria-busy="true"></div>';
    if (this.state === 'unset') {
      return '<div class="tgne-state" role="status">' + icon('cal')
        + '<p>' + esc('Choose what to show and the next event will appear here.') + '</p></div>';
    }
    if (this.state === 'error') {
      return '<div class="tgne-state" role="status">' + icon('cal')
        + '<p>' + esc('Could not load the next event. Please try again shortly.') + '</p></div>';
    }
    if (this.state === 'empty' || !this.event) {
      return '<div class="tgne-state" role="status">' + icon('cal')
        + '<p>' + esc(c.fallbackText || 'Nothing coming up just yet. Check back soon.') + '</p></div>';
    }

    var ev = this.event;
    var p = parts(ev.startsAtLocal);
    var when = [];
    if (p) {
      when.push('<span>' + icon('cal') + esc(p.dow + ' ' + p.d + ' ' + p.mon) + '</span>');
      if (c.showTime !== false) {
        if (ev.timeKnown && ev.startTime) when.push('<span>' + icon('clock') + esc(ev.startTime) + '</span>');
        else when.push('<span class="tgne-chip">Time TBC</span>');
      }
    }
    if (c.showVenue && ev.venue && ev.venue.name) {
      when.push('<span>' + icon('pin') + esc(ev.venue.name) + '</span>');
    }
    if (c.showCompetition && ev.competitionLabel) {
      when.push('<span class="tgne-chip">' + esc(ev.competitionLabel) + '</span>');
    }

    var count = '';
    if (c.showCountdown) {
      var u = untilParts(ev.startsAtLocal);
      if (u) {
        var unit = function (n, name) {
          return '<div class="tgne-unit"><span class="tgne-num">' + esc(String(n)) + '</span>'
            + '<span class="tgne-uname">' + esc(n === 1 ? name : name + 's') + '</span></div>';
        };
        count = '<div class="tgne-count" aria-label="' + esc('Starts in ' + u.days + ' days, ' + u.hours + ' hours and ' + u.mins + ' minutes') + '">'
          + unit(u.days, 'day') + unit(u.hours, 'hour') + unit(u.mins, 'min') + '</div>';
      }
    }

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
    var actions = usable.map(function (o, i) {
      // The agent's custom label belongs to the plain ticket button; a lone
      // package button keeps its own name, or "+ Hotel" would read "Book".
      var label = usable.length === 1 && o.kind === 'ticket'
        ? c.bookLabel
        : (o.short || o.label || c.bookLabel);
      if (o.stay) {
        return '<button type="button" class="tgne-btn' + (i > 0 ? ' tgne-btn2' : '') + (o.kind === 'ticket' ? '' : ' tgne-btn-pkg') + '"'
          + ' data-stay="' + esc(o.stay) + '" aria-haspopup="dialog"'
          + ' aria-label="' + esc(label + ': ' + (ev.title || 'event')) + '">'
          + esc(label) + icon(kindIcon(o.kind)) + '</button>';
      }
      if (o.fly) {
        return '<button type="button" class="tgne-btn' + (i > 0 ? ' tgne-btn2' : '') + (o.kind === 'ticket' ? '' : ' tgne-btn-pkg') + '"'
          + ' data-fly="' + esc(o.fly) + '" aria-haspopup="dialog"'
          + ' aria-label="' + esc(label + ': ' + (ev.title || 'event')) + '">'
          + esc(label) + icon(kindIcon(o.kind)) + '</button>';
      }
      return '<a class="tgne-btn' + (i > 0 ? ' tgne-btn2' : '') + (o.kind === 'ticket' ? '' : ' tgne-btn-pkg') + '" href="' + esc(safeUrl(o.url)) + '"'
        + ' target="_blank" rel="noopener noreferrer"'
        + ' aria-label="' + esc(label + ': ' + (ev.title || 'event')) + '">'
        + esc(label) + icon(kindIcon(o.kind)) + '</a>';
    }).join('');

    return '<div class="tgne-card">'
      + (c.label ? '<div class="tgne-label">' + esc(c.label) + '</div>' : '')
      + '<div class="tgne-main">'
      + '<h3 class="tgne-title">' + esc(ev.title || 'Event') + '</h3>'
      + '<div class="tgne-when">' + when.join('') + '</div>'
      + '</div>'
      + count
      + (actions ? '<div class="tgne-actions">' + actions + '</div>' : '')
      + '</div>';
  };

  TGNextEventWidget.prototype._render = function () {
    var c = this.cfg;
    var layout = c.layout === 'banner' ? ' tgne-banner' : c.layout === 'minimal' ? ' tgne-minimal' : '';
    this.shadow.innerHTML = '<style>' + styles(c) + FLY_CSS + STAY_CSS + '</style>'
      + '<div class="tgne-root' + layout + '" data-theme="' + esc(this._theme()) + '">'
      + this._bodyHtml() + '</div>';
  };

  TGNextEventWidget.prototype.update = function (next) {
    var before = JSON.stringify(this._query());
    this.cfg = Object.assign({}, this.cfg, next || {});
    var after = JSON.stringify(this._query());
    if (before !== after) { this._load(); return; }
    this._render();
    if (this.event && this.cfg.showCountdown) this._startTimer(); else this._stopTimer();
  };

  TGNextEventWidget.prototype.destroy = function () {
    this._reqId++;
    this._stopTimer();
    try { this.shadow.innerHTML = ''; } catch (e) { /* detached */ }
  };

  function initOne(node) {
    if (node.getAttribute('data-tg-nextevent-init') === '1') return;
    node.setAttribute('data-tg-nextevent-init', '1');

    var inline = node.getAttribute('data-tg-config');
    if (inline) {
      var parsed = null;
      try { parsed = JSON.parse(inline); } catch (e) { parsed = null; }
      new TGNextEventWidget(node, parsed || {});
      return;
    }
    var id = node.getAttribute('data-tg-id');
    if (!id) { new TGNextEventWidget(node, {}); return; }
    fetch(CONFIG_API + '?id=' + encodeURIComponent(id), { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { new TGNextEventWidget(node, (d && (d.config || d)) || {}); })
      .catch(function () { new TGNextEventWidget(node, {}); });
  }

  function init() {
    var nodes = document.querySelectorAll('[data-tg-widget="nextevent"]');
    for (var i = 0; i < nodes.length; i++) initOne(nodes[i]);
  }

  window.TGNextEventWidget = TGNextEventWidget;
  window.__TG_NEXTEVENT_VERSION__ = VERSION;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}());
