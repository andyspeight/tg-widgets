/**
 * Travelgenix Event Menu Widget v1.0.0
 * Self-contained, embeddable widget
 * Zero dependencies — works on any website via a single script tag
 *
 * The navigation for a whole ticket section: categories, competitions, clubs,
 * grounds and artists, as a sidebar on desktop and a drawer on a phone.
 *
 * ON WHERE A CHOICE GOES (v1.2.0, 8 Sep 2026)
 * Choosing a competition, club, venue or artist lists its upcoming events
 * INSIDE the widget: beside the menu on a desktop, under the Browse events
 * button on a phone. The cards and their Book buttons (ticket, ticket +
 * hotel, ticket + flight and hotel) are the Event Tickets widget's own code,
 * carried here verbatim (see the booking kit below), so a client needs no
 * other page and no other widget. Until this version the menu could only
 * link out, which meant building a page per competition first.
 *
 * A client who HAS their own pages keeps them: set a page address pattern
 * (/tickets/{type}/{slug} or whatever their pages are called) and every row
 * links there instead, never to Travelgenix. Either way each row fires a
 * tg:eventmenu:select event on the host element first, and preventDefault()
 * on it hands the choice to the client's own script.
 *
 * ON REQUESTS
 * One call to the feed index, at mount, and then nothing. The index already
 * carries every category, every competition with its country, and the leading
 * clubs, grounds and artists, so the whole menu is local from that point on
 * and filtering is instant. Typing does reach the network, but only to search
 * BEYOND the menu — the 900-odd clubs the index does not carry.
 *
 * Usage:
 *   <div data-tg-widget="eventmenu" data-tg-id="YOUR_WIDGET_ID"></div>
 *   <script src="https://tg-widgets.vercel.app/widget-eventmenu.js" defer></script>
 */
(function () {
  'use strict';

  var VERSION = '1.2.0';

  function resolveOrigin() {
    if (typeof window === 'undefined') return '';
    if (window.__TG_WIDGET_ORIGIN__) return String(window.__TG_WIDGET_ORIGIN__);
    try {
      var me = document.currentScript;
      if (me && me.src) return new URL(me.src).origin;
      var scripts = document.getElementsByTagName('script');
      for (var i = scripts.length - 1; i >= 0; i--) {
        if (/\/widget-eventmenu\.js(\?|$|#)/.test(scripts[i].src || '')) return new URL(scripts[i].src).origin;
      }
    } catch (e) { /* fall through */ }
    return '';
  }

  var ORIGIN = resolveOrigin();
  var CONFIG_API = (typeof window !== 'undefined' && window.__TG_WIDGET_API__) || (ORIGIN + '/api/widget-config');
  var FEED_API = (typeof window !== 'undefined' && window.__TG_EVENTS_API__) || (ORIGIN + '/api/events-feed');

  var DEFAULTS = {
    heading: 'Browse events',
    layout: 'auto',                 // sidebar | drawer | auto
    drawerBelow: 900,               // px, only used by layout:auto
    triggerLabel: 'Browse events',
    triggerTextColor: '',           // "Browse events" icon + text; '' = theme default
    groupBy: 'category',            // category | country | none
    sections: ['competitions'],     // competitions | teams | venues | performers
    linkPattern: '',                // blank = events listed inside the widget; set = the client's own pages
    newTab: false,
    // The events panel (used when linkPattern is blank). Same keys as the
    // Event Tickets widget, since it is the same code.
    startWith: 'browse',            // browse = what's on before anything is chosen | none = a prompt
    limit: 12,
    daysAhead: 365,
    resultsLayout: 'list',          // list | cards
    showTime: true,
    showVenue: true,
    showCompetition: true,
    bookLabel: 'Book',
    bookingKinds: ['ticket'],
    packageBgColor: '',
    packageTextColor: '',
    bookTextColor: '',
    currency: 'GBP',
    adults: 2,
    emptyText: '',
    appId: '',                      // injected server-side from the owning client, never typed
    showSearch: true,
    showCounts: true,
    showCountries: true,
    maxPerGroup: 8,
    openFirstGroup: true,
    onlyCategories: [],             // empty = every category
    activePath: '',                 // blank = read location.pathname
    theme: 'light',
    accent: '#00B4D8',
    radius: 12,
    fontFamily: '',
  };

  var IC = {
    chev: 'M9 18l6-6-6-6',
    down: 'M6 9l6 6 6-6',
    search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.3-4.3',
    menu: 'M4 6h16M4 12h16M4 18h16',
    close: 'M6 6l12 12M18 6L6 18',
    cal: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z',
    // The events panel's cards (the same paths the Event Tickets widget draws).
    clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 6v6l4 2',
    pin: 'M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0ZM12 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
    ext: 'M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6',
    ticket: 'M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2ZM13 5v14',
    bed: 'M2 4v16M2 8h18a2 2 0 0 1 2 2v10M2 17h20M6 8v9',
    plane: 'M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2Z',
    warn: 'M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z',
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

  function hexColour(v, fallback) {
    var s = String(v == null ? '' : v).trim();
    return /^#[0-9a-fA-F]{3}$|^#[0-9a-fA-F]{6}$/.test(s) ? s : fallback;
  }

  function clamp(n, lo, hi, fallback) {
    var v = parseInt(n, 10);
    if (isNaN(v)) return fallback;
    return Math.max(lo, Math.min(hi, v));
  }

  function fontStack(v) {
    var s = String(v == null ? '' : v).trim();
    if (!s) return '';
    // A font name off a config field goes straight into a style block, so it is
    // whitelisted to letters, digits, spaces and hyphens. No quotes, no commas,
    // no semicolons, nothing that could close the declaration.
    if (!/^[A-Za-z0-9 -]{1,48}$/.test(s)) return '';
    return '"' + s + '", ';
  }

  /**
   * A link pattern is a client's own URL shape, but it is still a string from a
   * config record, so it is checked before it is ever put in an href.
   * Site-relative, hash and absolute http(s) only. javascript:, data: and
   * anything else resolve to nothing and the item becomes a button instead.
   */
  function safePattern(v) {
    var s = String(v == null ? '' : v).trim();
    if (!s) return '';
    if (/^(\/|\.\/|#)/.test(s)) return s;
    if (/^https?:\/\//i.test(s)) return s;
    return '';
  }

  function slugify(s) {
    return String(s || '').toLowerCase().normalize('NFD')
      .replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-');
  }

  // >>> events booking kit (verbatim copy lives in public/widget-eventmenu.js)
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
      if (btn) { stayOpen(w, btn); return; } // dates first, then the chooser
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

  function flyOpen(w, btn, tplOverride) {
    if (w._fly && w._fly.btn === btn) { flyClose(w); return; }
    flyClose(w);
    stayClose(w);
    var tpl = tplOverride || String(btn.getAttribute('data-fly') || '');
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
  // two weeks after. Only the Travelify booking host is ever opened. The
  // flight package opens this calendar first, preselected to a two-night
  // stay from the event day, then hands the dates to the airport chooser.
  var STAY_BEFORE = 7;
  var STAY_AFTER = 14;
  var STAY_PKG_NIGHTS = 2; // the flight package preselects this many nights
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
      if (t && t.closest && t.closest('[data-fly]')) return; // flyInit routes that click
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
    var pkg = !url; // a flight button carries a template; the chooser follows
    if (pkg) url = String(btn.getAttribute('data-fly') || '');
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

    var state = { box: box, btn: btn, checkIn: pkg ? eventDay : null,
      checkOut: pkg ? stayShift(eventDay, STAY_PKG_NIGHTS) : null,
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

    function goPkg() {
      var nights = Math.round((state.checkOut - state.checkIn) / 86400000);
      if (nights < 1 || nights > STAY_BEFORE + STAY_AFTER) return;
      var u;
      try { u = new URL(url); } catch (e) { return; }
      u.searchParams.set('fr', stayIso(state.checkIn));
      u.searchParams.set('to', stayIso(state.checkOut));
      u.searchParams.set('dur', String(nights));
      var tpl = u.toString();
      if (!FLY_TPL_OK.test(tpl)) return;
      stayClose(w);
      // Deferred a tick: the click that pressed this button is still
      // bubbling, and the widget's own outside-click checks would close a
      // chooser opened during the same dispatch.
      setTimeout(function () { flyOpen(w, btn, tpl); }, 0);
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
        if (state.checkIn && (+d === +state.checkIn || (state.checkOut && +d === +state.checkOut))) cls += ' is-pick';
        else if (state.checkIn && d > state.checkIn && d <= (state.checkOut || eventDay)) cls += ' is-span';
        html += ok
          ? '<button type="button" class="' + cls + '" data-d="' + stayIso(d) + '">' + day + '</button>'
          : '<span class="' + cls + ' is-off">' + day + '</span>';
      }
      var nights = pkg ? Math.round((state.checkOut - state.checkIn) / 86400000) : 0;
      html += '</div><div class="tgtk-fly-note">' + esc(pkg
        ? stayLabel(state.checkIn) + ' to ' + stayLabel(state.checkOut) + '. Change the days, or carry on.'
        : (state.checkIn
          ? 'Check-in ' + stayLabel(state.checkIn) + '. Now pick your check-out day.'
          : 'Pick your check-in day. The event night is ringed.')) + '</div>'
        + (pkg ? '<button type="button" class="tgtk-stay-go">Choose airport &middot; '
          + nights + (nights === 1 ? ' night' : ' nights') + '</button>' : '');
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
      var goBtn = e.target && e.target.closest ? e.target.closest('.tgtk-stay-go') : null;
      if (goBtn) { goPkg(); return; }
      var cell = e.target && e.target.closest ? e.target.closest('[data-d]') : null;
      if (!cell) return;
      var d = stayParse(cell.getAttribute('data-d'));
      if (!d) return;
      if (pkg) {
        if (canOut(d)) { state.checkOut = d; draw(); return; }
        if (canIn(d)) { state.checkIn = d; draw(); }
        return;
      }
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
    + '.tgtk-root[data-theme="dark"] .tgtk-stay-day.is-span{background:rgba(255,255,255,.1)}'
    + '.tgtk-stay-go{display:block;width:100%;margin-top:8px;padding:9px 10px;border:0;border-radius:8px;'
    + 'font:inherit;font-size:13px;font-weight:600;cursor:pointer;background:#1a2733;color:#fff}'
    + '.tgtk-stay-go:hover{filter:brightness(1.15)}'
    + '.tgtk-root[data-theme="dark"] .tgtk-stay-go{background:#e8eef4;color:#16202c}'
    + '.tgtk-root[data-theme="dark"] .tgtk-stay-go:hover{filter:brightness(.93)}';

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

  // ── Shared with the Event Menu (verbatim, see test/events-kit-drift-smoke) ──
  //
  // Everything from safeUrl above to listHtml below is the events booking
  // kit: the card with its Book buttons, the departure airport chooser, the
  // stay calendar, the feed query and the styles they need. The Event Menu
  // lists events beside its menu with this exact code, copied verbatim
  // because a widget is one file on a customer's site and cannot import. Edit
  // it here, copy the block there, and the drift test holds them together.

  /**
   * The .tgtk-root token block for a config: accent, button ink, radius, font
   * and the optional package button colours. `fb` carries the widget's own
   * default accent and radius.
   */
  function kitRoot(cfg, fb) {
    var accent = safeColour(cfg.accent, fb.accent);
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
    var radius = clampInt(cfg.radius, 0, 28, fb.radius);
    var font = safeFont(cfg.fontFamily);
    var stack = (font ? '"' + font + '", ' : '')
      + "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
    var root = ''
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
      + '--tgtk-on-accent:' + btnText + ';}';
    return { root: root, pkg: pkgCss };
  }

  /** The list, card, button, state and skeleton rules. Static. */
  var KIT_CSS = ''
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
    + 'transition-duration:.01ms !important;}}';

  /** The feed call a source means, with the booking kinds and the client's AppID. */
  function feedQuery(c, source) {
    var q = {
      limit: String(clampInt(c.limit, 1, 100, 6)),
      from: localToday(0),
      to: localToday(clampInt(c.daysAhead, 1, 730, 365)),
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

    var src = source || {};
    var v = String(src.value || '').trim();
    switch (src.type) {
      case 'team':
        q.view = 'team'; q.key = v;
        if (src.side === 'home' || src.side === 'away') q.side = src.side;
        if (src.competition) q.competition = src.competition;
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
  }

  /** Sources that mean nothing without a value chosen. */
  function needsValue(t) {
    return t === 'competition' || t === 'team' || t === 'venue' || t === 'performer' || t === 'category';
  }

  function feedUrl(q) {
    var parts = [];
    for (var k in q) {
      if (Object.prototype.hasOwnProperty.call(q, k) && q[k] !== '' && q[k] != null) {
        parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(q[k]));
      }
    }
    return FEED_API + (parts.length ? '?' + parts.join('&') : '');
  }

  /** The events a query returns, or a rejection named not-found / request-failed. */
  function fetchEvents(q) {
    return fetch(feedUrl(q), { headers: { Accept: 'application/json' } })
      .then(function (r) {
        if (!r.ok) throw new Error(r.status === 404 ? 'not-found' : 'request-failed');
        return r.json();
      })
      .then(function (data) {
        var events = Array.isArray(data.events) ? data.events : [];
        return { events: events, total: data.total || events.length };
      });
  }

  /** One event as a card: date, title, the meta line and its Book buttons. */
  function cardHtml(c, ev) {
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
  }

  /**
   * The list for a load state: skeleton while loading, a calm state for an
   * unset or missing source, the Home/Away filter for a team, then the cards.
   * `st` is { loading, error, events, side, sourceType, sourceValue }.
   */
  function listHtml(c, st) {

    if (st.loading) {
      var n = Math.min(clampInt(c.limit, 1, 100, 6), 4);
      var rows = '';
      for (var i = 0; i < n; i++) rows += '<div class="tgtk-skel"></div>';
      return '<div class="tgtk-list" aria-busy="true">' + rows + '</div>';
    }

    if (st.error) {
      // Only a genuine failure gets the warning icon. A source that is unset or
      // no longer in the feed is configuration, and reads as a calm empty slot.
      if (st.error === 'unset') {
        return '<div class="tgtk-state" role="status">' + icon('cal')
          + '<p>' + esc('Choose what to show and the events will appear here.') + '</p></div>';
      }
      if (st.error === 'not-found') {
        return '<div class="tgtk-state" role="status">' + icon('cal')
          + '<p>' + esc(c.emptyText || 'Nothing to show here just yet.') + '</p></div>';
      }
      return '<div class="tgtk-state" role="status">' + icon('warn')
        + '<p>' + esc('Events could not be loaded. Please try again shortly.') + '</p></div>';
    }

    if (!st.events || !st.events.length) {
      return '<div class="tgtk-state" role="status">' + icon('cal')
        + '<p>' + esc(c.emptyText || 'No upcoming events to show.') + '</p></div>';
    }

    var evs = st.events;
    var filterHtml = '';
    // Home/Away filter — only when sourced by a team and there is a real split
    // (both home AND away games loaded).
    if (st.sourceType === 'team') {
      var tk = String(st.sourceValue || '').trim();
      var homeN = 0, awayN = 0;
      for (var i = 0; i < evs.length; i++) {
        var s = sideOf(evs[i], tk);
        if (s === 'home') homeN++; else if (s === 'away') awayN++;
      }
      if (homeN > 0 && awayN > 0) {
        var sv = (st.side === 'home' || st.side === 'away') ? st.side : 'all';
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
    var cards = evs.map(function (ev) { return cardHtml(c, ev); }).join('');
    var cls = c.layout === 'cards' ? 'tgtk-grid' : 'tgtk-list';
    return filterHtml + '<div class="' + cls + '">' + cards + '</div>';
  }
  // <<< events booking kit

  // ── Element ───────────────────────────────────────────────────────────────

  function TGEventMenuWidget(el, config) {
    if (!el || el.__tgEventMenu) return el && el.__tgEventMenu;
    el.__tgEventMenu = this;

    this.el = el;
    this.cfg = Object.assign({}, DEFAULTS, config || {});
    this.shadow = el.attachShadow ? el.attachShadow({ mode: 'open' }) : el;
    this.data = null;
    this.error = false;
    this.query = '';
    this.remote = null;         // teams/venues/performers found beyond the index
    this.remoteBusy = false;
    this.openGroups = {};
    this.drawerOpen = false;
    this.isNarrow = false;
    this.mountedKey = null;
    this.lastFocus = null;
    // The events panel: what is chosen and what the feed said about it.
    this.sel = null;
    this.res = { loading: false, error: null, events: null, total: 0, side: 'all', reqId: 0 };
    flyInit(this);
    stayInit(this);
    var self = this;
    // Delegated on the shadow root, which survives every repaint: the
    // Home/Away filter on a club's events.
    this.shadow.addEventListener('click', function (e) {
      var hf = e.target && e.target.closest ? e.target.closest('.tgtk-hf') : null;
      if (!hf) return;
      var side = hf.getAttribute('data-side') || 'all';
      if (self.res.side !== side) { self.res.side = side; self._paintResults(); }
    });
    this._watchWidth();
    this._render();
    this._load();
    this._loadResults();
  }

  /** Blank page address: choices open inside the widget rather than a page. */
  TGEventMenuWidget.prototype._showsResults = function () {
    return !safePattern(this.cfg.linkPattern);
  };

  /** The events panel's config in the booking kit's terms. */
  TGEventMenuWidget.prototype._kitCfg = function () {
    var c = this.cfg;
    return {
      layout: c.resultsLayout === 'cards' ? 'cards' : 'list',
      limit: c.limit, daysAhead: c.daysAhead, emptyText: c.emptyText,
      showTime: c.showTime !== false, showVenue: c.showVenue !== false, showCompetition: c.showCompetition !== false,
      bookLabel: c.bookLabel || 'Book', bookingKinds: c.bookingKinds,
      currency: c.currency || 'GBP', adults: c.adults, appId: c.appId,
      accent: c.accent, bookTextColor: c.bookTextColor, packageBgColor: c.packageBgColor,
      packageTextColor: c.packageTextColor, radius: c.radius, fontFamily: c.fontFamily,
    };
  };

  /** What the panel lists: the choice, or what's on before one is made. */
  TGEventMenuWidget.prototype._resultsSource = function () {
    if (!this._showsResults()) return null;
    if (this.sel) return { type: this.sel.type, value: this.sel.key };
    if (this.cfg.startWith === 'none') return null;
    var only = Array.isArray(this.cfg.onlyCategories) ? this.cfg.onlyCategories.filter(Boolean) : [];
    return only.length === 1 ? { type: 'category', value: only[0] } : { type: 'all' };
  };

  TGEventMenuWidget.prototype._loadResults = function () {
    var self = this;
    var source = this._resultsSource();
    var mine = ++this.res.reqId;
    if (!source) {
      this.res.loading = false; this.res.error = null; this.res.events = null; this.res.total = 0;
      this._paintResults();
      return;
    }
    this.res.loading = true;
    this.res.error = null;
    this._paintResults();
    // Home/Away is a client-side filter on the loaded fixtures, so the query
    // itself never carries the side.
    fetchEvents(feedQuery(this._kitCfg(), source))
      .then(function (got) {
        if (mine !== self.res.reqId) return;
        self.res.events = got.events;
        self.res.total = got.total;
        self.res.loading = false;
        self._paintResults();
      })
      .catch(function (err) {
        if (mine !== self.res.reqId) return;
        self.res.events = [];
        self.res.error = err && err.message === 'not-found' ? 'not-found' : 'failed';
        self.res.loading = false;
        self._paintResults();
      });
  };

  TGEventMenuWidget.prototype._resultsHtml = function () {
    var source = this._resultsSource();
    if (!source) {
      return '<div class="tgtk-state" role="status">' + icon('cal')
        + '<p>' + esc('Choose a competition, club, venue or artist to see what is on.') + '</p></div>';
    }
    var title = this.sel ? this.sel.name : 'What\'s on';
    var n = this.res.total;
    var count = (!this.res.loading && !this.res.error && n > 0)
      ? '<span class="tgmn-rn">' + esc(n + (n === 1 ? ' event' : ' events')) + '</span>' : '';
    var head = '<div class="tgmn-rhead"><h2 class="tgmn-rh">' + esc(title) + '</h2>' + count + '</div>';
    var st = {
      loading: this.res.loading, error: this.res.error, events: this.res.events, side: this.res.side,
      sourceType: source.type, sourceValue: source.value,
    };
    return head + '<div class="tgmn-rbody">' + listHtml(this._kitCfg(), st) + '</div>';
  };

  /** Repaint only the events panel; the menu, and any caret in it, survive. */
  TGEventMenuWidget.prototype._paintResults = function () {
    var pane = this.shadow.querySelector('.tgmn-results');
    if (pane) pane.innerHTML = this._resultsHtml();
  };

  TGEventMenuWidget.prototype._theme = function () {
    return this.cfg.theme === 'dark' ? 'dark' : 'light';
  };

  /** Drawer or sidebar, for the current viewport. */
  TGEventMenuWidget.prototype._mode = function () {
    if (this.cfg.layout === 'sidebar') return 'sidebar';
    if (this.cfg.layout === 'drawer') return 'drawer';
    return this.isNarrow ? 'drawer' : 'sidebar';
  };

  TGEventMenuWidget.prototype._watchWidth = function () {
    var self = this;
    if (typeof window === 'undefined' || !window.matchMedia) return;
    var px = clamp(this.cfg.drawerBelow, 320, 1600, 900);
    this._mq = window.matchMedia('(max-width: ' + px + 'px)');
    this.isNarrow = this._mq.matches;
    this._onMq = function () {
      var was = self._mode();
      self.isNarrow = self._mq.matches;
      if (self._mode() !== was) {
        // Leaving drawer mode with the drawer open would strand the scroll lock
        // on the host page, so it is released before the layout changes.
        if (self._mode() === 'sidebar' && self.drawerOpen) self._closeDrawer(true);
        self.mountedKey = null;
        self._render();
      }
    };
    if (this._mq.addEventListener) this._mq.addEventListener('change', this._onMq);
    else if (this._mq.addListener) this._mq.addListener(this._onMq);
  };

  TGEventMenuWidget.prototype._load = function () {
    var self = this;
    fetch(FEED_API, { credentials: 'omit' })
      .then(function (r) { if (!r.ok) throw new Error('feed ' + r.status); return r.json(); })
      .then(function (d) {
        self.data = d;
        self.error = false;
        self._loadTops();
        self._seedOpenGroups();
        self.mountedKey = null;
        self._render();
      })
      .catch(function () {
        self.error = true;
        self.mountedKey = null;
        self._render();
      });
  };

  /**
   * Which groups exist, in the order they render. Anything that changes this
   * list has to re-seed, or the menu is left with every group shut.
   */
  TGEventMenuWidget.prototype._shape = function () {
    var c = this.cfg;
    return [c.groupBy, (c.sections || []).join(','), (c.onlyCategories || []).join(',')].join('~');
  };

  TGEventMenuWidget.prototype._seedOpenGroups = function () {
    this.shape = this._shape();
    if (!this.cfg.openFirstGroup) return;
    var want = Array.isArray(this.cfg.sections) ? this.cfg.sections : [];
    var comps = want.indexOf('competitions') !== -1 ? this._groups() : [];
    var groups = comps.concat(this._extras());
    // Open the group the visitor is already inside, if any, so a sidebar on a
    // Premier League page does not start collapsed over the page you are on.
    for (var i = 0; i < groups.length; i++) {
      for (var j = 0; j < groups[i].items.length; j++) {
        if (groups[i].items[j].active) { this.openGroups[groups[i].key] = true; return; }
      }
    }
    // Otherwise the biggest, not the first. Grouped by sport those are the
    // same thing, but grouped by country the list is alphabetical, so opening
    // the first would greet everyone with Argentina and its one competition.
    // Competitions are the primary navigation, so the open group is chosen from
    // them when there are any. Popular clubs holds two dozen rows and would
    // otherwise win on size alone and push the leagues out of sight.
    var pool = comps.length ? comps : groups;
    var best = null;
    for (var g = 0; g < pool.length; g++) {
      // Worldwide is the biggest country group and the least useful one to
      // greet someone with, so it only wins if it is all there is.
      if (pool[g].key === 'worldwide' && pool.length > 1) continue;
      if (!best || pool[g].items.length > best.items.length) best = pool[g];
    }
    if (!best && pool.length) best = pool[0];
    if (best) this.openGroups[best.key] = true;
  };

  // ── Links ─────────────────────────────────────────────────────────────────

  TGEventMenuWidget.prototype._href = function (type, slug, name) {
    var pat = safePattern(this.cfg.linkPattern);
    if (!pat) return '';
    return pat
      .replace(/\{type\}/g, encodeURIComponent(type))
      .replace(/\{slug\}/g, encodeURIComponent(slug))
      .replace(/\{name\}/g, encodeURIComponent(slugify(name)));
  };

  TGEventMenuWidget.prototype._currentPath = function () {
    if (this.cfg.activePath) return String(this.cfg.activePath);
    try { return window.location.pathname + window.location.search; } catch (e) { return ''; }
  };

  /**
   * Is this the page we are on? Compared as paths, not strings, so a menu built
   * with a relative pattern still matches an absolute address bar.
   */
  TGEventMenuWidget.prototype._isActive = function (href) {
    if (!href || href === '#') return false;
    var here = this._currentPath();
    if (!here) return false;
    var a, b;
    try {
      a = new URL(href, window.location.href);
      b = new URL(here, window.location.href);
    } catch (e) { return false; }
    if (a.origin !== b.origin) return false;
    return a.pathname.replace(/\/+$/, '') === b.pathname.replace(/\/+$/, '');
  };

  // ── Model ─────────────────────────────────────────────────────────────────

  function matches(term, text) {
    return String(text || '').toLowerCase().indexOf(term) !== -1;
  }

  TGEventMenuWidget.prototype._item = function (type, key, name, meta, count) {
    var href = this._href(type, key, name);
    var active = href
      ? this._isActive(href)
      : !!(this.sel && this.sel.type === type && this.sel.key === key);
    return {
      type: type, key: key, name: name, meta: meta, count: count,
      href: href, active: active,
    };
  };

  /** The competitions the config allows, filtered by the search box. */
  TGEventMenuWidget.prototype._competitions = function () {
    var self = this;
    var d = this.data;
    if (!d || !d.competitions) return [];
    var only = Array.isArray(this.cfg.onlyCategories) ? this.cfg.onlyCategories : [];
    var term = this.query.trim().toLowerCase();
    return d.competitions.filter(function (c) {
      if (only.length && only.indexOf(c.category) === -1) return false;
      if (!term) return true;
      return matches(term, c.label) || matches(term, c.country) || matches(term, c.categoryLabel);
    }).map(function (c) {
      var it = self._item('competition', c.slug, c.label,
        self.cfg.showCountries && c.country ? c.country : '', c.events);
      it.category = c.category;
      it.categoryLabel = c.categoryLabel;
      it.country = c.country || 'Worldwide';
      return it;
    });
  };

  /** Competitions arranged under headings, or one flat list. */
  TGEventMenuWidget.prototype._groups = function () {
    var items = this._competitions();
    if (this.cfg.groupBy === 'none') {
      return items.length ? [{ key: 'all', label: 'Competitions', items: items }] : [];
    }
    var by = this.cfg.groupBy === 'country' ? 'country' : 'categoryLabel';
    var order = [];
    var map = {};
    items.forEach(function (it) {
      var label = it[by] || 'Other';
      var key = slugify(label) || 'other';
      if (!map[key]) { map[key] = { key: key, label: label, items: [] }; order.push(key); }
      map[key].items.push(it);
    });
    if (by === 'country') {
      // Alphabetical, because that is how someone looks up their own country,
      // with the global competitions last rather than filed under W.
      order.sort(function (a, b) {
        if (a === 'worldwide') return 1;
        if (b === 'worldwide') return -1;
        return map[a].label.localeCompare(map[b].label);
      });
    } else {
      // The index lists categories busiest first, and that is the order a menu
      // wants: Football has 5,704 events and Entertainment 1,174, so a menu
      // that opened on Entertainment because it happened to appear first in the
      // competition array would be leading with the wrong thing.
      var rank = {};
      ((this.data && this.data.categories) || []).forEach(function (cat, i) {
        rank[slugify(cat.label) || cat.slug] = i;
      });
      order.sort(function (a, b) {
        var ra = rank[a] == null ? 999 : rank[a];
        var rb = rank[b] == null ? 999 : rank[b];
        return ra - rb;
      });
    }
    return order.map(function (k) { return map[k]; });
  };

  /**
   * Popular clubs / grounds / artists.
   *
   * Normally straight off the index. When the menu is restricted to a sport it
   * uses the per-sport lists fetched by _loadTops instead, because the index's
   * global top 24 is all baseball and ice hockey — those sides play 162 and 82
   * games a season, so no football club is anywhere near it and a football-only
   * menu asking for popular clubs would come back empty.
   */
  TGEventMenuWidget.prototype._extras = function () {
    var self = this;
    var d = this.data;
    if (!d) return [];
    var term = this.query.trim().toLowerCase();
    var want = Array.isArray(this.cfg.sections) ? this.cfg.sections : [];
    var tops = this.tops || {};
    var defs = [
      { id: 'teams', label: 'Popular clubs', src: tops.teams || d.topTeams, type: 'team',
        meta: function (x) { return x.homeVenueName || ''; } },
      { id: 'venues', label: 'Popular venues', src: tops.venues || d.topVenues, type: 'venue',
        meta: function () { return ''; } },
      { id: 'performers', label: 'Popular artists', src: d.topPerformers, type: 'performer',
        meta: function (x) { return x.topLocation || ''; } },
    ];
    var only = Array.isArray(this.cfg.onlyCategories) ? this.cfg.onlyCategories : [];
    return defs.filter(function (s) {
      if (want.indexOf(s.id) === -1 || !Array.isArray(s.src)) return false;
      // Artists are all entertainment and carry no category of their own, so
      // they are kept or dropped as a whole rather than filtered row by row.
      if (s.id === 'performers' && only.length && only.indexOf('entertainment') === -1) return false;
      return true;
    })
      .map(function (s) {
        var items = s.src.filter(function (x) {
          if (term && !matches(term, x.name)) return false;
          // A football-only menu was listing the Arizona Diamondbacks, because
          // the sport restriction was applied to competitions and nothing else.
          // Performers carry no categories, so they are never excluded on a
          // field they do not have.
          if (!only.length || !Array.isArray(x.categories)) return true;
          return x.categories.some(function (cat) { return only.indexOf(cat) !== -1; });
        }).map(function (x) { return self._item(s.type, x.key, x.name, s.meta(x), x.events); });
        return { key: s.id, label: s.label, items: items };
      })
      .filter(function (s) { return s.items.length; });
  };

  /**
   * Fetch the busiest clubs and venues for the sports this menu is limited to.
   *
   * Only runs when there IS a restriction. Without one the index's own lists
   * are already the right answer and cost nothing.
   */
  TGEventMenuWidget.prototype._loadTops = function () {
    var self = this;
    var only = Array.isArray(this.cfg.onlyCategories) ? this.cfg.onlyCategories : [];
    var want = Array.isArray(this.cfg.sections) ? this.cfg.sections : [];
    var sig = only.join(',');
    if (this.topsSig === sig) return;
    this.topsSig = sig;

    if (!only.length) { this.tops = null; this._paint(); return; }
    var views = [];
    if (want.indexOf('teams') !== -1) views.push(['teams', 'teams']);
    if (want.indexOf('venues') !== -1) views.push(['venues', 'venues']);
    if (!views.length) return;

    var cats = only.filter(function (x) { return /^[a-z0-9-]{1,40}$/.test(x); }).join(',');
    Promise.all(views.map(function (v) {
      return fetch(FEED_API + '?view=' + v[0] + '&limit=24&category=' + encodeURIComponent(cats),
        { credentials: 'omit' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) { return [v[1], (d && d.items) || []]; })
        .catch(function () { return [v[1], []]; });
    })).then(function (pairs) {
      if (self.topsSig !== sig) return;
      var out = {};
      pairs.forEach(function (pr) { out[pr[0]] = pr[1]; });
      self.tops = out;
      self._seedOpenGroups();
      self._paint();
    });
  };

  /**
   * Search past the index.
   *
   * The index carries 24 clubs. There are 903. Someone typing "brentford" into
   * a menu means it, so the search goes to the feed for the ones the menu does
   * not already hold — but only for the lists the client turned on.
   */
  TGEventMenuWidget.prototype._searchRemote = function (term) {
    var self = this;
    // Every list is searched, not only the ones the menu browses. A client who
    // lists competitions only still has visitors who type "brentford", and we
    // hold the club. What the sections setting decides is what you can BROWSE;
    // it was never meant to decide what you can find.
    var views = [['teams', 'team', 'Clubs'], ['venues', 'venue', 'Venues'],
      ['performers', 'performer', 'Artists']];
    if (term.length < 2) { this.remote = null; this._paint(); return; }

    var mine = ++this._seq;
    this.remoteBusy = true;
    this._paint();

    Promise.all(views.map(function (v) {
      return fetch(FEED_API + '?view=' + v[0] + '&limit=8&q=' + encodeURIComponent(term), { credentials: 'omit' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          var only = Array.isArray(self.cfg.onlyCategories) ? self.cfg.onlyCategories : [];
          var items = ((d && d.items) || []).filter(function (x) {
            // A football-only menu should not surface an ice hockey arena.
            // Performers carry no categories, so they are never excluded on a
            // field they do not have.
            if (!only.length || !Array.isArray(x.categories)) return true;
            return x.categories.some(function (cat) { return only.indexOf(cat) !== -1; });
          });
          return { key: v[1], label: v[2], items: items.map(function (x) {
            return self._item(v[1], x.key, x.name,
              x.homeVenueName || x.topLocation || '', x.events);
          }) };
        })
        .catch(function () { return { key: v[1], label: v[2], items: [] }; });
    })).then(function (groups) {
      if (mine !== self._seq) return;
      self.remoteBusy = false;
      self.remote = groups.filter(function (g) { return g.items.length; });
      self._paint();
    });
  };
  TGEventMenuWidget.prototype._seq = 0;

  // ── Markup ────────────────────────────────────────────────────────────────

  function styles(c, kitCfg) {
    var accent = hexColour(c.accent, '#00B4D8');
    var trigText = hexColour(c.triggerTextColor, '');
    var radius = clamp(c.radius, 0, 24, 12);
    var font = fontStack(c.fontFamily);
    var kit = kitRoot(kitCfg || {}, { accent: '#00B4D8', radius: 12 });
    return ':host{all:initial;display:block;width:100%;min-width:0;}:host::before{content:"";display:block;width:280px;max-width:100%;height:0;}'
      + '*,*::before,*::after{box-sizing:border-box;}'
      // the events panel: the menu beside it on a desktop, under the button on a phone
      + '.tgmn-root{container-type:inline-size;}'
      + '.tgmn-split{display:grid;grid-template-columns:minmax(230px,300px) minmax(0,1fr);gap:20px;align-items:start;}'
      + '.tgmn-split > *{min-width:0;}'
      + '@container (max-width:640px){.tgmn-split{grid-template-columns:1fr;}}'
      + '.tgmn-stack .tgmn-results{margin-top:14px;}'
      + '.tgmn-rhead{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin:0 0 12px;}'
      + '.tgmn-rh{margin:0;font-size:20px;line-height:1.25;font-weight:700;letter-spacing:-.01em;color:var(--tgtk-text);}'
      + '.tgmn-rn{font-size:12.5px;color:var(--tgtk-mute);white-space:nowrap;}'
      + kit.root + KIT_CSS + kit.pkg
      + '.tgmn-root{--tgmn-accent:' + accent + ';--tgmn-radius:' + radius + 'px;'
      + (trigText ? '--tgmn-trigger-text:' + trigText + ';' : '')
      + 'font-family:' + font + '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;'
      + '-webkit-font-smoothing:antialiased;text-align:left;line-height:1.45;}'
      + '.tgmn-root[data-theme="light"]{--tgmn-bg:#fff;--tgmn-bg2:#f6f8fa;--tgmn-bg3:#eef1f5;'
      + '--tgmn-text:#0f1720;--tgmn-mute:#5b6875;--tgmn-border:#e3e8ee;--tgmn-on-accent:#fff;'
      + '--tgmn-scrim:rgba(15,23,32,.44);}'
      + '.tgmn-root[data-theme="dark"]{--tgmn-bg:#12171d;--tgmn-bg2:#171d24;--tgmn-bg3:#1e252e;'
      + '--tgmn-text:#eef2f6;--tgmn-mute:#9aa7b4;--tgmn-border:#28313b;--tgmn-on-accent:#06121a;'
      + '--tgmn-scrim:rgba(0,0,0,.6);}'

      // panel
      + '.tgmn-panel{background:var(--tgmn-bg);color:var(--tgmn-text);border:1px solid var(--tgmn-border);'
      + 'border-radius:var(--tgmn-radius);overflow:hidden;}'
      + '.tgmn-head{padding:14px 16px 12px;border-bottom:1px solid var(--tgmn-border);'
      + 'display:flex;align-items:center;gap:10px;}'
      + '.tgmn-h{margin:0;font-size:14px;font-weight:700;letter-spacing:.01em;flex:1;min-width:0;}'
      + '.tgmn-body{padding:8px;max-height:none;overflow:visible;}'

      // search
      + '.tgmn-find{position:relative;padding:10px 12px 6px;}'
      + '.tgmn-find svg{position:absolute;left:22px;top:19px;width:15px;height:15px;color:var(--tgmn-mute);'
      + 'pointer-events:none;}'
      + '.tgmn-input{width:100%;height:38px;padding:0 12px 0 34px;font:inherit;font-size:13.5px;'
      + 'color:var(--tgmn-text);background:var(--tgmn-bg2);border:1px solid var(--tgmn-border);'
      + 'border-radius:calc(var(--tgmn-radius) * .66);outline:none;-webkit-appearance:none;appearance:none;}'
      + '.tgmn-input::placeholder{color:var(--tgmn-mute);}'
      + '.tgmn-input:focus{border-color:var(--tgmn-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--tgmn-accent) 18%,transparent);}'
      + '.tgmn-input::-webkit-search-cancel-button{-webkit-appearance:none;}'

      // groups
      + '.tgmn-group{border-top:1px solid var(--tgmn-border);}'
      + '.tgmn-group:first-child{border-top:0;}'
      + '.tgmn-gh{display:flex;align-items:center;gap:8px;width:100%;padding:10px 12px;'
      + 'font:inherit;font-size:11.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;'
      + 'color:var(--tgmn-mute);background:none;border:0;cursor:pointer;text-align:left;}'
      + '.tgmn-gh:hover{color:var(--tgmn-text);}'
      + '.tgmn-gh:focus-visible{outline:2px solid var(--tgmn-accent);outline-offset:-2px;border-radius:6px;}'
      + '.tgmn-gh svg{flex:none;width:14px;height:14px;transition:transform .18s ease;}'
      + '.tgmn-gh[aria-expanded="true"] svg{transform:rotate(90deg);}'
      + '.tgmn-gh-label{flex:1;min-width:0;}'
      + '.tgmn-gh-n{font-size:11px;font-weight:600;letter-spacing:0;text-transform:none;'
      + 'color:var(--tgmn-mute);}'
      + '.tgmn-list{list-style:none;margin:0;padding:0 6px 8px;}'

      // rows
      + '.tgmn-item{display:flex;align-items:center;gap:10px;width:100%;padding:9px 10px;'
      + 'font:inherit;font-size:13.5px;color:var(--tgmn-text);text-decoration:none;background:none;'
      + 'border:0;border-radius:calc(var(--tgmn-radius) * .58);cursor:pointer;text-align:left;}'
      + '.tgmn-item:hover{background:var(--tgmn-bg2);}'
      + '.tgmn-item:focus-visible{outline:2px solid var(--tgmn-accent);outline-offset:-2px;}'
      + '.tgmn-item[aria-current="page"]{background:color-mix(in srgb,var(--tgmn-accent) 13%,transparent);'
      + 'font-weight:650;box-shadow:inset 2px 0 0 var(--tgmn-accent);}'
      + '.tgmn-imain{flex:1;min-width:0;}'
      + '.tgmn-iname{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}'
      + '.tgmn-imeta{display:block;font-size:11.5px;color:var(--tgmn-mute);overflow:hidden;'
      + 'text-overflow:ellipsis;white-space:nowrap;}'
      + '.tgmn-n{flex:none;font-size:11px;font-weight:600;color:var(--tgmn-mute);'
      + 'background:var(--tgmn-bg3);border-radius:999px;padding:2px 7px;}'
      + '.tgmn-chev{flex:none;width:14px;height:14px;color:var(--tgmn-mute);}'
      + '.tgmn-more{display:block;width:100%;padding:7px 10px;font:inherit;font-size:12px;font-weight:600;'
      + 'color:var(--tgmn-accent);background:none;border:0;cursor:pointer;text-align:left;'
      + 'border-radius:calc(var(--tgmn-radius) * .58);}'
      + '.tgmn-more:hover{background:var(--tgmn-bg2);}'
      + '.tgmn-more:focus-visible{outline:2px solid var(--tgmn-accent);outline-offset:-2px;}'

      // states
      + '.tgmn-state{padding:22px 16px;text-align:center;color:var(--tgmn-mute);font-size:13px;}'
      + '.tgmn-skel{padding:10px 12px;}'
      + '.tgmn-bar{height:12px;margin:10px 0;border-radius:6px;background:var(--tgmn-bg3);'
      + 'animation:tgmn-pulse 1.4s ease-in-out infinite;}'
      + '@keyframes tgmn-pulse{0%,100%{opacity:1;}50%{opacity:.45;}}'
      + '@media (prefers-reduced-motion: reduce){.tgmn-bar{animation:none;}'
      + '.tgmn-gh svg{transition:none;}.tgmn-drawer{transition:none !important;}}'

      // trigger + drawer
      + '.tgmn-trigger{display:inline-flex;align-items:center;gap:9px;padding:11px 16px;font:inherit;'
      + 'font-size:14px;font-weight:600;color:var(--tgmn-trigger-text, var(--tgmn-on-accent));background:var(--tgmn-accent);'
      + 'border:0;border-radius:var(--tgmn-radius);cursor:pointer;}'
      + '.tgmn-trigger svg{width:17px;height:17px;}'
      + '.tgmn-trigger:focus-visible{outline:2px solid var(--tgmn-accent);outline-offset:3px;}'
      + '.tgmn-scrim{position:fixed;inset:0;background:var(--tgmn-scrim);z-index:2147483000;'
      + 'opacity:0;transition:opacity .22s ease;}'
      + '.tgmn-scrim.is-open{opacity:1;}'
      + '.tgmn-drawer{position:fixed;top:0;left:0;bottom:0;width:min(340px,88vw);z-index:2147483001;'
      + 'background:var(--tgmn-bg);color:var(--tgmn-text);border-right:1px solid var(--tgmn-border);'
      + 'display:flex;flex-direction:column;transform:translateX(-100%);transition:transform .26s cubic-bezier(.22,1,.36,1);}'
      + '.tgmn-drawer.is-open{transform:translateX(0);}'
      + '.tgmn-drawer .tgmn-body{flex:1;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;}'
      + '.tgmn-x{flex:none;width:32px;height:32px;display:inline-flex;align-items:center;justify-content:center;'
      + 'color:var(--tgmn-mute);background:none;border:0;border-radius:8px;cursor:pointer;}'
      + '.tgmn-x:hover{background:var(--tgmn-bg2);color:var(--tgmn-text);}'
      + '.tgmn-x:focus-visible{outline:2px solid var(--tgmn-accent);outline-offset:1px;}'
      + '.tgmn-x svg{width:16px;height:16px;}'
      + '.tgmn-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;'
      + 'clip:rect(0 0 0 0);white-space:nowrap;border:0;}';
  }

  TGEventMenuWidget.prototype._itemHtml = function (it) {
    var c = this.cfg;
    var inner = '<span class="tgmn-imain"><span class="tgmn-iname">' + esc(it.name) + '</span>'
      + (it.meta ? '<span class="tgmn-imeta">' + esc(it.meta) + '</span>' : '') + '</span>'
      + (c.showCounts && it.count ? '<span class="tgmn-n">' + esc(String(it.count)) + '</span>' : '')
      + icon('chev', 'tgmn-chev');
    var attrs = 'class="tgmn-item" data-type="' + esc(it.type) + '" data-key="' + esc(it.key) + '"'
      + ' data-name="' + esc(it.name) + '"' + (it.active ? ' aria-current="page"' : '');
    if (it.href) {
      return '<li><a ' + attrs + ' href="' + esc(it.href) + '"'
        + (c.newTab ? ' target="_blank" rel="noopener noreferrer"' : '') + '>' + inner + '</a></li>';
    }
    // No pattern set: still usable, just as an event rather than a navigation.
    return '<li><button type="button" ' + attrs + '>' + inner + '</button></li>';
  };

  TGEventMenuWidget.prototype._groupHtml = function (g, collapsible) {
    var c = this.cfg;
    var open = !collapsible || !!this.openGroups[g.key] || !!this.query;
    var cap = clamp(c.maxPerGroup, 1, 200, 8);
    var showAll = !!this.openGroups['all:' + g.key] || !!this.query;
    var items = showAll ? g.items : g.items.slice(0, cap);
    var hidden = g.items.length - items.length;

    var list = open
      ? '<ul class="tgmn-list">' + items.map(this._itemHtml, this).join('')
        + (hidden > 0
          ? '<li><button class="tgmn-more" type="button" data-all="' + esc(g.key) + '">Show '
            + hidden + ' more</button></li>' : '')
        + '</ul>'
      : '';

    var head = collapsible
      ? '<button class="tgmn-gh" type="button" data-group="' + esc(g.key) + '"'
        + ' aria-expanded="' + (open ? 'true' : 'false') + '">'
        + icon('chev') + '<span class="tgmn-gh-label">' + esc(g.label) + '</span>'
        + (c.showCounts ? '<span class="tgmn-gh-n">' + g.items.length + '</span>' : '') + '</button>'
      : '<div class="tgmn-gh"><span class="tgmn-gh-label">' + esc(g.label) + '</span></div>';

    return '<div class="tgmn-group">' + head + list + '</div>';
  };

  /** Everything inside the panel below the header. Repainted on its own. */
  TGEventMenuWidget.prototype._bodyHtml = function () {
    var c = this.cfg;

    if (this.error) {
      return '<div class="tgmn-state">The event menu could not be loaded just now.</div>';
    }
    if (!this.data) {
      return '<div class="tgmn-skel" aria-hidden="true">'
        + '<div class="tgmn-bar" style="width:52%"></div>'
        + '<div class="tgmn-bar" style="width:88%"></div>'
        + '<div class="tgmn-bar" style="width:74%"></div>'
        + '<div class="tgmn-bar" style="width:90%"></div>'
        + '<div class="tgmn-bar" style="width:63%"></div></div>';
    }

    var want = Array.isArray(c.sections) ? c.sections : [];
    var out = '';
    if (want.indexOf('competitions') !== -1) {
      var groups = this._groups();
      var collapsible = c.groupBy !== 'none';
      out += groups.map(function (g) { return this._groupHtml(g, collapsible); }, this).join('');
    }
    out += this._extras().map(function (g) { return this._groupHtml(g, true); }, this).join('');

    if (this.query && this.remote && this.remote.length) {
      out += this.remote.map(function (g) {
        return this._groupHtml({ key: 'r-' + g.key, label: 'More ' + g.label.toLowerCase(), items: g.items }, true);
      }, this).join('');
    }
    if (this.query && this.remoteBusy && !out) {
      out = '<div class="tgmn-state">Searching…</div>';
    }
    if (!out) {
      out = '<div class="tgmn-state">'
        + (this.query ? 'Nothing matches “' + esc(this.query) + '”.' : 'Nothing to show yet.')
        + '</div>';
    }
    return out;
  };

  TGEventMenuWidget.prototype._panelHtml = function (isDrawer) {
    var c = this.cfg;
    var find = c.showSearch
      ? '<div class="tgmn-find">' + icon('search')
        + '<input class="tgmn-input" type="search" autocomplete="off" spellcheck="false"'
        + ' aria-label="Filter the menu" placeholder="Search leagues, clubs, venues">'
        + '</div>'
      : '';
    var head = (c.heading || isDrawer)
      ? '<div class="tgmn-head"><h2 class="tgmn-h">' + esc(c.heading || 'Browse events') + '</h2>'
        + (isDrawer ? '<button class="tgmn-x" type="button" data-close aria-label="Close menu">'
          + icon('close') + '</button>' : '')
        + '</div>'
      : '';
    return head + find + '<div class="tgmn-body">' + this._bodyHtml() + '</div>';
  };

  /**
   * What forces a full re-mount rather than a repaint.
   *
   * Everything a keystroke touches is deliberately absent: retyping must never
   * tear out the input the visitor is typing into. That mistake cost the Ticket
   * Search widget its caret once already.
   */
  TGEventMenuWidget.prototype._shellKey = function () {
    var c = this.cfg;
    return [this._mode(), c.theme, c.accent, c.radius, c.fontFamily, c.heading,
      c.showSearch, c.triggerLabel, c.triggerTextColor, this._showsResults() ? 'panel' : 'links',
      c.bookTextColor, c.packageBgColor, c.packageTextColor].join('~');
  };

  TGEventMenuWidget.prototype._render = function () {
    if (this.mountedKey === this._shellKey()) { this._paint(); return; }
    var c = this.cfg;
    var drawer = this._mode() === 'drawer';
    var panel = this._showsResults();
    var theme = esc(this._theme());
    // The events panel is a .tgtk-root of its own inside the menu's root, so
    // the booking kit's styles and modals find it exactly as they do in the
    // Event Tickets widget.
    var results = panel
      ? '<div class="tgtk-root tgmn-results" data-theme="' + theme + '" aria-live="polite">' + this._resultsHtml() + '</div>'
      : '';
    var menu = drawer
      ? '<button class="tgmn-trigger" type="button" data-open aria-haspopup="dialog" aria-expanded="false">'
        + icon('menu') + esc(c.triggerLabel || 'Browse events') + '</button>'
      : '<nav class="tgmn-panel" aria-label="' + esc(c.heading || 'Browse events') + '">'
        + this._panelHtml(false) + '</nav>';
    this.shadow.innerHTML = '<style>' + styles(c, this._kitCfg()) + FLY_CSS + STAY_CSS + '</style>'
      + '<div class="tgmn-root' + (panel ? (drawer ? ' tgmn-stack' : ' tgmn-has-panel') : '') + '" data-theme="' + theme + '">'
      + (panel && !drawer ? '<div class="tgmn-split">' + menu + results + '</div>' : menu + results)
      + '</div>';
    this.mountedKey = this._shellKey();
    this._bindShell();
    if (drawer && this.drawerOpen) this._openDrawer(true);
  };

  /** Repaint only the list. The input, and the caret in it, survive. */
  TGEventMenuWidget.prototype._paint = function () {
    var bodies = this.shadow.querySelectorAll('.tgmn-body');
    for (var i = 0; i < bodies.length; i++) bodies[i].innerHTML = this._bodyHtml();
  };

  // ── Behaviour ─────────────────────────────────────────────────────────────

  TGEventMenuWidget.prototype._bindShell = function () {
    var self = this;
    var root = this.shadow.querySelector('.tgmn-root');
    if (!root) return;

    var trigger = root.querySelector('[data-open]');
    if (trigger) trigger.addEventListener('click', function () { self._openDrawer(); });

    // Bind the panel handler on root ONLY for the sidebar, whose panel lives in
    // root. In drawer mode root holds just the trigger; the drawer panel gets its
    // OWN handler in _openDrawer, and since it is a child of root, a root handler
    // here would catch the same click too — toggling a group open then shut in
    // one press (the "clicking a group does nothing" bug).
    if (root.querySelector('.tgmn-panel')) this._bindPanel(root);
  };

  /** Wired once per panel, on the container, so a repaint keeps every handler. */
  TGEventMenuWidget.prototype._bindPanel = function (scope) {
    var self = this;

    var input = scope.querySelector('.tgmn-input');
    if (input) {
      input.value = this.query;
      input.addEventListener('input', function () {
        self.query = input.value;
        self._paint();
        clearTimeout(self._t);
        self._t = setTimeout(function () { self._searchRemote(self.query.trim().toLowerCase()); }, 260);
      });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && input.value) {
          e.stopPropagation();
          input.value = '';
          self.query = '';
          self.remote = null;
          self._paint();
        }
      });
    }

    scope.addEventListener('click', function (e) {
      var more = e.target.closest('[data-all]');
      if (more) { self.openGroups['all:' + more.getAttribute('data-all')] = true; self._paint(); return; }

      var gh = e.target.closest('[data-group]');
      if (gh) {
        var k = gh.getAttribute('data-group');
        self.openGroups[k] = !self.openGroups[k];
        self._paint();
        return;
      }

      var x = e.target.closest('[data-close]');
      if (x) { self._closeDrawer(); return; }

      var item = e.target.closest('.tgmn-item');
      if (item) self._pick(item, e);
    });
  };

  /**
   * A chosen item. The host page hears about it either way, so a client can
   * intercept a link (to render in place) or handle a patternless menu entirely
   * themselves. Preventing the default on the event stops the navigation.
   */
  TGEventMenuWidget.prototype._pick = function (item, ev) {
    var detail = {
      type: item.getAttribute('data-type'),
      key: item.getAttribute('data-key'),
      name: item.getAttribute('data-name'),
      href: item.getAttribute('href') || '',
    };
    var out = new CustomEvent('tg:eventmenu:select', { detail: detail, bubbles: true, cancelable: true });
    var proceed = this.el.dispatchEvent(out);
    if (!proceed && ev) ev.preventDefault();
    // No page address: the choice opens in the widget's own events panel,
    // unless the host's script took it (preventDefault) to render elsewhere.
    if (proceed && this._showsResults()) {
      if (ev) ev.preventDefault();
      this.sel = { type: detail.type, key: detail.key, name: detail.name };
      this.res.side = 'all';
      this._loadResults();
      this._paint();
      if (this.drawerOpen) this._closeDrawer();
      var pane = this.shadow.querySelector('.tgmn-results');
      // A real choice moves the reader to what they asked for. Never on a
      // render, only here, on the click itself.
      if (pane && this._mode() === 'drawer' && pane.scrollIntoView) {
        try { pane.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (e) { /* older engines */ }
      }
      return;
    }
    if (this.drawerOpen && proceed) this._closeDrawer();
  };

  TGEventMenuWidget.prototype._openDrawer = function (silent) {
    if (this.drawerOpen && !silent) return;
    var self = this;
    var root = this.shadow.querySelector('.tgmn-root');
    if (!root) return;

    if (!silent) this.lastFocus = document.activeElement;
    this.drawerOpen = true;

    var trigger = root.querySelector('[data-open]');
    if (trigger) trigger.setAttribute('aria-expanded', 'true');

    var scrim = document.createElement('div');
    scrim.className = 'tgmn-scrim';
    scrim.addEventListener('click', function () { self._closeDrawer(); });

    var panel = document.createElement('div');
    panel.className = 'tgmn-drawer';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', this.cfg.heading || 'Browse events');
    panel.innerHTML = this._panelHtml(true);

    root.appendChild(scrim);
    root.appendChild(panel);
    this._bindPanel(panel);

    // The host page must not scroll behind an open drawer. The previous value
    // is kept rather than assumed, so a site that sets its own overflow gets it
    // back instead of being reset to empty.
    // Captured only on a genuine open. A re-mount with the drawer already up
    // (a theme change in the editor) would otherwise record 'hidden' as the
    // page's own value and never give the site its scrolling back.
    if (!silent) this._prevOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';

    this._onKey = function (e) {
      if (e.key === 'Escape') { self._closeDrawer(); return; }
      if (e.key === 'Tab') self._trap(e, panel);
    };
    document.addEventListener('keydown', this._onKey, true);

    requestAnimationFrame(function () {
      scrim.classList.add('is-open');
      panel.classList.add('is-open');
      // Focus moves only because a click opened this. Never on a render.
      if (silent) return;
      var first = panel.querySelector('.tgmn-input') || panel.querySelector('[data-close]');
      if (first) first.focus();
    });
  };

  /** Keep Tab inside the drawer while it is modal. */
  TGEventMenuWidget.prototype._trap = function (e, panel) {
    var f = panel.querySelectorAll('a[href],button:not([disabled]),input,[tabindex]:not([tabindex="-1"])');
    if (!f.length) return;
    var first = f[0];
    var last = f[f.length - 1];
    var active = this.shadow.activeElement || document.activeElement;
    if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
  };

  TGEventMenuWidget.prototype._closeDrawer = function (immediate) {
    if (!this.drawerOpen) return;
    var self = this;
    this.drawerOpen = false;

    if (this._onKey) { document.removeEventListener('keydown', this._onKey, true); this._onKey = null; }
    document.documentElement.style.overflow = this._prevOverflow || '';

    var root = this.shadow.querySelector('.tgmn-root');
    var trigger = root && root.querySelector('[data-open]');
    if (trigger) trigger.setAttribute('aria-expanded', 'false');

    var scrim = root && root.querySelector('.tgmn-scrim');
    var panel = root && root.querySelector('.tgmn-drawer');
    var drop = function () {
      if (scrim && scrim.parentNode) scrim.parentNode.removeChild(scrim);
      if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
    };
    if (immediate) drop();
    else {
      if (scrim) scrim.classList.remove('is-open');
      if (panel) panel.classList.remove('is-open');
      setTimeout(drop, 260);
    }

    // Focus returns to the trigger, which is the thing that was clicked and the
    // thing a keyboard user expects to land back on. document.activeElement at
    // open time is no use here: the click came from inside the shadow root, so
    // it was the host div, which is not focusable and swallows the call.
    if (trigger) trigger.focus();
    else if (this.lastFocus && this.lastFocus.focus) {
      try { this.lastFocus.focus(); } catch (e) { /* the page moved on */ }
    }
    self.lastFocus = null;
  };

  // ── Public API ────────────────────────────────────────────────────────────

  TGEventMenuWidget.prototype.update = function (next) {
    var prevBelow = this.cfg.drawerBelow;
    var prevSource = this._resultsSource();
    var prevQuery = prevSource ? JSON.stringify(feedQuery(this._kitCfg(), prevSource)) : '';
    this.cfg = Object.assign({}, this.cfg, next || {});
    // Refetch the panel only when something the QUERY depends on changed. An
    // editor calls this on every keystroke, and a heading edit must not hit
    // the feed or flicker the list.
    var nextSource = this._resultsSource();
    var nextQuery = nextSource ? JSON.stringify(feedQuery(this._kitCfg(), nextSource)) : '';
    if (nextQuery !== prevQuery) this._loadResults();
    // Switching from sport to country replaces every group key, so the groups
    // the visitor had open no longer exist and the menu would come back fully
    // collapsed. Re-seed, but only when the group list itself changed, so a
    // colour change never reopens something someone deliberately shut.
    if (this.data) this._loadTops();
    if (this.data && this.shape !== this._shape()) this._seedOpenGroups();
    if (this.cfg.drawerBelow !== prevBelow && this._mq) {
      if (this._mq.removeEventListener) this._mq.removeEventListener('change', this._onMq);
      else if (this._mq.removeListener) this._mq.removeListener(this._onMq);
      this._watchWidth();
    }
    this.mountedKey = null;
    this._render();
  };

  TGEventMenuWidget.prototype.open = function () { this._openDrawer(); };
  TGEventMenuWidget.prototype.close = function () { this._closeDrawer(); };

  TGEventMenuWidget.prototype.destroy = function () {
    this._closeDrawer(true);
    flyClose(this);
    stayClose(this);
    this.res.reqId++;
    if (this._mq && this._onMq) {
      if (this._mq.removeEventListener) this._mq.removeEventListener('change', this._onMq);
      else if (this._mq.removeListener) this._mq.removeListener(this._onMq);
    }
    clearTimeout(this._t);
    this.shadow.innerHTML = '';
    if (this.el) delete this.el.__tgEventMenu;
  };

  // ── Auto-init ─────────────────────────────────────────────────────────────

  function boot(el) {
    if (el.__tgEventMenu) return;
    var inline = el.getAttribute('data-tg-config');
    if (inline) {
      var parsed = null;
      try { parsed = JSON.parse(inline); } catch (e) { parsed = null; }
      new TGEventMenuWidget(el, parsed || {});
      return;
    }
    var id = el.getAttribute('data-tg-id');
    if (!id) { new TGEventMenuWidget(el, {}); return; }
    fetch(CONFIG_API + '?id=' + encodeURIComponent(id))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { new TGEventMenuWidget(el, (d && d.config) || {}); })
      .catch(function () { new TGEventMenuWidget(el, {}); });
  }

  function initAll() {
    var nodes = document.querySelectorAll('[data-tg-widget="eventmenu"]');
    for (var i = 0; i < nodes.length; i++) boot(nodes[i]);
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initAll);
    else initAll();
  }

  if (typeof window !== 'undefined') {
    window.TGEventMenuWidget = TGEventMenuWidget;
    window.__TG_EVENTMENU_VERSION__ = VERSION;
  }
}());
