/**
 * Travelgenix Ticket Month Widget v1.0.0
 * Self-contained, embeddable widget
 * Zero dependencies — works on any website via a single script tag
 *
 * A month grid with events on their dates, and a day panel underneath. The view
 * for a customer who knows WHEN they can travel but not what they want to see —
 * the opposite question to every other widget in the set, which all start from
 * a club, a ground or an act.
 *
 * ON THE CALENDAR MATHS
 * Dates are handled as calendar dates, never as instants. new Date('2026-08-22')
 * parses as UTC midnight and renders a day earlier west of Greenwich, which
 * would put a Saturday fixture in the Friday cell for every visitor in the
 * Americas. Every date here is built from explicit local parts.
 *
 * Usage:
 *   <div data-tg-widget="ticketmonth" data-tg-id="YOUR_WIDGET_ID"></div>
 *   <script src="https://tg-widgets.vercel.app/widget-ticketmonth.js" defer></script>
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
        if (/\/widget-ticketmonth\.js(\?|$|#)/.test(scripts[i].src || '')) return new URL(scripts[i].src).origin;
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
    heading: '',
    subheading: '',
    weekStart: 1,              // 1 = Monday, 0 = Sunday
    showDayTitles: true,       // event names in the cell, not just a dot
    maxPerCell: 2,
    dayLimit: 12,
    showVenue: true,
    showTime: true,
    showCompetition: true,
    bookLabel: 'Book',
    bookingKinds: ['ticket'],
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

  var IC = {
    clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 6v6l4 2',
    pin: 'M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0ZM12 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
    ext: 'M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6',
    cal: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z',
    prev: 'M15 18l-6-6 6-6',
    next: 'M9 18l6-6-6-6',
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
    var tpl = String(btn.getAttribute('data-fly') || '');
    if (!FLY_TPL_OK.test(tpl)) return;
    var root = w.shadow.querySelector('.tgtm-root');
    if (!root) return;

    var box = document.createElement('div');
    box.className = 'tgtm-fly';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Choose your departure airport');
    box.innerHTML = '<div class="tgtm-fly-t">Where are you flying from?</div>'
      + '<input class="tgtm-fly-in" type="text" placeholder="Type an airport or code"'
      + ' autocomplete="off" spellcheck="false" aria-label="Search airports">'
      + '<div class="tgtm-fly-list" role="listbox"></div>'
      + '<div class="tgtm-fly-note">Loading airports&hellip;</div>';
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

    var input = box.querySelector('.tgtm-fly-in');
    var list = box.querySelector('.tgtm-fly-list');
    var note = box.querySelector('.tgtm-fly-note');
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
        html += '<button type="button" class="tgtm-fly-opt' + (i === state.active ? ' is-active' : '') + '"'
          + ' role="option" aria-selected="' + (i === state.active) + '" data-iata="' + esc(a[0]) + '">'
          + '<span class="tgtm-fly-code">' + esc(a[0]) + '</span>'
          + '<span class="tgtm-fly-name">' + esc(a[1]) + '</span></button>';
      }
      list.innerHTML = html;
      if (state.all) note.textContent = state.list.length ? '' : 'No airport matches that. Try the three-letter code.';
    }

    list.addEventListener('click', function (e) {
      var opt = e.target && e.target.closest ? e.target.closest('.tgtm-fly-opt') : null;
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

  var FLY_CSS = '.tgtm-root{position:relative}'
    + 'button.tgtm-btn{border:0;font:inherit;cursor:pointer}'
    + '.tgtm-fly{position:absolute;z-index:40;background:#fff;color:#1a2733;border:1px solid #dde4ea;'
    + 'border-radius:12px;box-shadow:0 12px 32px rgba(10,30,50,.18);padding:12px;box-sizing:border-box;'
    + 'font-size:14px;line-height:1.4;text-align:left}'
    + '.tgtm-fly-t{font-weight:600;margin:0 0 8px;font-size:14px}'
    + '.tgtm-fly-in{width:100%;box-sizing:border-box;padding:8px 10px;font:inherit;color:inherit;'
    + 'background:transparent;border:1.5px solid #cfd8e0;border-radius:8px;outline:none}'
    + '.tgtm-fly-in:focus{border-color:currentColor}'
    + '.tgtm-fly-list{margin-top:8px;max-height:224px;overflow-y:auto}'
    + '.tgtm-fly-opt{display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:8px 10px;'
    + 'font:inherit;color:inherit;background:none;border:0;border-radius:8px;cursor:pointer}'
    + '.tgtm-fly-opt.is-active,.tgtm-fly-opt:hover{background:rgba(0,0,0,.07)}'
    + '.tgtm-fly-code{font-weight:700;font-size:12px;letter-spacing:.04em;min-width:38px}'
    + '.tgtm-fly-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
    + '.tgtm-fly-note{color:#5b6b7b;font-size:12px;margin-top:6px}'
    + '.tgtm-fly-note:empty{display:none}'
    + '.tgtm-root[data-theme="dark"] .tgtm-fly{background:#16202c;color:#e8eef4;border-color:#263442;'
    + 'box-shadow:0 12px 32px rgba(0,0,0,.55)}'
    + '.tgtm-root[data-theme="dark"] .tgtm-fly-in{border-color:#3a4a5a}'
    + '.tgtm-root[data-theme="dark"] .tgtm-fly-opt.is-active,'
    + '.tgtm-root[data-theme="dark"] .tgtm-fly-opt:hover{background:rgba(255,255,255,.09)}'
    + '.tgtm-root[data-theme="dark"] .tgtm-fly-note{color:#93a4b5}';
  function safeColour(c, fallback) {
    var s = String(c == null ? '' : c).trim();
    return (/^#[0-9a-f]{3}$/i.test(s) || /^#[0-9a-f]{6}$/i.test(s)) ? s : fallback;
  }
  function safeFont(f) {
    var s = String(f == null ? '' : f).trim();
    return /^[A-Za-z0-9 ,'"-]{1,120}$/.test(s) ? s : '';
  }
  function clampInt(v, min, max, fallback) {
    var n = parseInt(v, 10);
    return isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
  }

  var DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var DOW_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MON_LONG = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  var ymd = function (y, m, d) { return y + '-' + pad(m) + '-' + pad(d); };

  function todayParts() {
    var t = new Date();
    return { y: t.getFullYear(), m: t.getMonth() + 1, d: t.getDate() };
  }

  function daysInMonth(y, m) { return new Date(y, m, 0).getDate(); }

  /** Which column a date falls in, given the configured first day of the week. */
  function columnOf(y, m, d, weekStart) {
    var dow = new Date(y, m - 1, d).getDay();
    return (dow - weekStart + 7) % 7;
  }

  function addMonths(y, m, delta) {
    var i = (y * 12) + (m - 1) + delta;
    return { y: Math.floor(i / 12), m: (i % 12) + 1 };
  }

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
    var btnText = safeColour(cfg.bookTextColor, '#04212B');
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
      + '.tgtm-root{container-type:inline-size;font-family:' + stack + ';'
      + '--tgtm-accent:' + accent + ';--tgtm-radius:' + radius + 'px;'
      + '--tgtm-bg:#FFFFFF;--tgtm-bg2:#F8FAFC;--tgtm-bg3:#F1F5F9;--tgtm-border:#E2E8F0;'
      + '--tgtm-text:#0F172A;--tgtm-sub:#475569;--tgtm-mute:#64748B;--tgtm-on-accent:' + btnText + ';'
      + 'font-size:15px;line-height:1.6;color:var(--tgtm-text);box-sizing:border-box;'
      + '-webkit-font-smoothing:antialiased;}'
      + '.tgtm-root *,.tgtm-root *::before,.tgtm-root *::after{box-sizing:border-box;}'
      + '.tgtm-root[data-theme="dark"]{--tgtm-bg:#0F172A;--tgtm-bg2:#1E293B;--tgtm-bg3:#334155;'
      + '--tgtm-border:#334155;--tgtm-text:#F8FAFC;--tgtm-sub:#CBD5E1;--tgtm-mute:#94A3B8;}'

      + '.tgtm-head{margin:0 0 12px;}'
      + '.tgtm-h{margin:0;font-size:22px;font-weight:700;line-height:1.25;letter-spacing:-.01em;}'
      + '.tgtm-sub{margin:4px 0 0;font-size:15px;color:var(--tgtm-sub);}'

      + '.tgtm-bar{display:flex;align-items:center;gap:10px;margin-bottom:10px;}'
      + '.tgtm-month{flex:1;min-width:0;font-size:17px;font-weight:700;letter-spacing:-.01em;}'
      + '.tgtm-nav{flex:none;width:38px;height:38px;display:inline-flex;align-items:center;justify-content:center;'
      + 'border:1px solid var(--tgtm-border);border-radius:calc(var(--tgtm-radius) - 4px);'
      + 'background:var(--tgtm-bg);color:var(--tgtm-sub);cursor:pointer;font:inherit;}'
      + '.tgtm-nav:hover:not([disabled]){background:var(--tgtm-bg3);color:var(--tgtm-text);}'
      + '.tgtm-nav[disabled]{opacity:.4;cursor:not-allowed;}'
      + '.tgtm-nav svg{width:16px;height:16px;}'
      + '.tgtm-nav:focus-visible{outline:2px solid var(--tgtm-accent);outline-offset:2px;}'

      + '.tgtm-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px;}'
      + '.tgtm-dow{text-align:center;font-size:11px;font-weight:600;text-transform:uppercase;'
      + 'letter-spacing:.06em;color:var(--tgtm-mute);padding:4px 0;}'
      + '.tgtm-cell{min-width:0;min-height:76px;padding:6px;border:1px solid var(--tgtm-border);'
      + 'border-radius:calc(var(--tgtm-radius) - 4px);background:var(--tgtm-bg);'
      + 'display:flex;flex-direction:column;gap:3px;text-align:left;font:inherit;color:inherit;}'
      + '.tgtm-cell.is-blank{border-color:transparent;background:transparent;}'
      + '.tgtm-cell.is-past{background:transparent;}'
      + '.tgtm-cell.is-past .tgtm-num{color:var(--tgtm-mute);opacity:.45;}'
      + '.tgtm-cell.has-events{cursor:pointer;}'
      + '.tgtm-cell.has-events:hover{border-color:var(--tgtm-accent);}'
      + '.tgtm-cell[aria-pressed="true"]{border-color:var(--tgtm-accent);'
      + 'box-shadow:0 0 0 2px color-mix(in srgb,var(--tgtm-accent) 22%,transparent);}'
      + '.tgtm-cell:focus-visible{outline:2px solid var(--tgtm-accent);outline-offset:1px;}'
      + '.tgtm-num{font-size:12.5px;font-weight:600;font-variant-numeric:tabular-nums;color:var(--tgtm-sub);}'
      + '.tgtm-cell.is-today .tgtm-num{color:var(--tgtm-accent);}'
      + '.tgtm-pip{display:block;font-size:10.5px;line-height:1.3;padding:2px 4px;border-radius:4px;'
      + 'background:color-mix(in srgb,var(--tgtm-accent) 14%,transparent);color:var(--tgtm-text);'
      + 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}'
      + '.tgtm-more{display:block;font-size:10px;color:var(--tgtm-mute);padding-left:4px;}'
      + '.tgtm-dots{display:flex;gap:3px;flex-wrap:wrap;padding-left:2px;}'
      + '.tgtm-dot{width:6px;height:6px;border-radius:50%;background:var(--tgtm-accent);}'

      + '.tgtm-panel{margin-top:14px;padding:14px;background:var(--tgtm-bg2);'
      + 'border:1px solid var(--tgtm-border);border-radius:var(--tgtm-radius);}'
      + '.tgtm-ptitle{margin:0 0 10px;font-size:16px;font-weight:700;letter-spacing:-.01em;}'
      + '.tgtm-list{display:flex;flex-direction:column;gap:8px;}'
      + '.tgtm-row{min-width:0;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center;'
      + 'padding:11px 12px;background:var(--tgtm-bg);border:1px solid var(--tgtm-border);'
      + 'border-radius:calc(var(--tgtm-radius) - 2px);}'
      + '.tgtm-rmain{min-width:0;}'
      + '.tgtm-rtitle{margin:0 0 2px;font-size:14.5px;font-weight:600;line-height:1.3;overflow-wrap:anywhere;}'
      + '.tgtm-rmeta{display:flex;flex-wrap:wrap;gap:4px 12px;align-items:center;font-size:12.5px;color:var(--tgtm-sub);}'
      + '.tgtm-rmeta svg{width:13px;height:13px;flex:none;color:var(--tgtm-mute);vertical-align:-2px;}'
      + '.tgtm-rmeta span{display:inline-flex;align-items:center;gap:4px;}'
      + '.tgtm-chip{display:inline-flex;padding:1px 8px;border-radius:999px;background:var(--tgtm-bg3);'
      + 'color:var(--tgtm-sub);font-size:11px;font-weight:500;white-space:nowrap;}'

      + '.tgtm-actions{display:flex;flex-wrap:wrap;gap:6px;}'
      + '.tgtm-hafilter{display:inline-flex;margin:0 0 12px;border:1px solid var(--tgtm-border);'
      + 'border-radius:calc(var(--tgtm-radius) - 4px);overflow:hidden;background:var(--tgtm-bg);}'
      + '.tgtm-hf{padding:0 14px;min-height:36px;font:inherit;font-size:12.5px;font-weight:600;'
      + 'color:var(--tgtm-sub);background:transparent;border:0;border-right:1px solid var(--tgtm-border);'
      + 'cursor:pointer;white-space:nowrap;transition:background .15s ease-out,color .15s ease-out;}'
      + '.tgtm-hf:last-child{border-right:0;}'
      + '.tgtm-hf:hover{color:var(--tgtm-text);}'
      + '.tgtm-hf.is-on{background:var(--tgtm-accent);color:var(--tgtm-on-accent);}'
      + '.tgtm-hf:focus-visible{outline:2px solid var(--tgtm-accent);outline-offset:-2px;}'
      + '.tgtm-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:42px;'
      + 'padding:0 14px;border-radius:calc(var(--tgtm-radius) - 4px);border:1px solid transparent;'
      + 'background:var(--tgtm-accent);color:var(--tgtm-on-accent);font:inherit;font-size:13px;'
      + 'font-weight:600;text-decoration:none;cursor:pointer;white-space:nowrap;transition:filter .16s ease-out;}'
      + '.tgtm-btn{font-weight:700;letter-spacing:.01em;'
      + 'box-shadow:0 2px 6px color-mix(in srgb,var(--tgtm-accent) 34%,transparent);'
      + 'transition:transform .16s ease-out,box-shadow .16s ease-out,filter .16s ease-out;}'
      + '.tgtm-btn:hover{transform:translateY(-1px);filter:brightness(1.05);'
      + 'box-shadow:0 7px 18px color-mix(in srgb,var(--tgtm-accent) 44%,transparent);}'
      + '.tgtm-btn:active{transform:translateY(0) scale(.99);}'
      + '.tgtm-btn svg{width:13px;height:13px;}'
      + '.tgtm-btn2{background:var(--tgtm-bg);border-color:var(--tgtm-border);color:var(--tgtm-text);box-shadow:none;}'
      + '.tgtm-btn2:hover{transform:translateY(-1px);border-color:var(--tgtm-accent);'
      + 'background:var(--tgtm-bg3);box-shadow:0 4px 10px rgba(15,23,42,.08);}'
      + '.tgtm-btn:focus-visible{outline:2px solid var(--tgtm-accent);outline-offset:2px;}'

      + '.tgtm-state{padding:22px 16px;text-align:center;color:var(--tgtm-sub);background:var(--tgtm-bg);'
      + 'border:1px dashed var(--tgtm-border);border-radius:var(--tgtm-radius);}'
      + '.tgtm-state svg{width:22px;height:22px;color:var(--tgtm-mute);margin-bottom:6px;}'
      + '.tgtm-state p{margin:0;}'
      + '.tgtm-skel{height:76px;border-radius:calc(var(--tgtm-radius) - 4px);'
      + 'background:linear-gradient(90deg,var(--tgtm-bg3) 25%,var(--tgtm-bg2) 50%,var(--tgtm-bg3) 75%);'
      + 'background-size:200% 100%;animation:tgtm-sh 1.4s ease-in-out infinite;}'
      + '@keyframes tgtm-sh{0%{background-position:200% 0}100%{background-position:-200% 0}}'

      // Below 560 the cells cannot hold a title, so they fall back to dots and
      // the day panel does the reading. A seven-column grid is kept, because a
      // calendar that stops being a calendar is not a smaller calendar.
      + '@container (max-width:560px){'
      + '.tgtm-cell{min-height:52px;padding:4px;}'
      + '.tgtm-pip{display:none;}'
      + '.tgtm-more{display:none;}'
      + '.tgtm-row{grid-template-columns:minmax(0,1fr);row-gap:9px;}'
      + '.tgtm-btn{flex:1 1 auto;}}'
      + '@media (prefers-reduced-motion:reduce){.tgtm-root *{animation-duration:.01ms !important;'
      + 'animation-iteration-count:1 !important;transition-duration:.01ms !important;}}';
  }

  function needsValue(t) {
    return t === 'competition' || t === 'team' || t === 'venue' || t === 'performer' || t === 'category';
  }

  function TGTicketMonthWidget(container, config) {
    this.el = container;
    this.cfg = Object.assign({}, DEFAULTS, config || {});
    this.shadow = container.shadowRoot || container.attachShadow({ mode: 'open' });
    flyInit(this);
    var t = todayParts();
    this.view = { y: t.y, m: t.m };
    this.today = t;
    this.byDay = {};
    this._all = [];               // raw events for the month (unfiltered)
    this._side = 'all';           // visitor Home/Away filter (client-side)
    this.state = 'loading';
    this.openDay = null;
    this._reqId = 0;
    this._render();
    this._load();
  }

  TGTicketMonthWidget.prototype._theme = function () {
    var t = this.cfg.theme;
    if (t === 'dark') return 'dark';
    if (t === 'auto') {
      try { return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; }
      catch (e) { return 'light'; }
    }
    return 'light';
  };

  TGTicketMonthWidget.prototype._query = function () {
    var c = this.cfg;
    var last = daysInMonth(this.view.y, this.view.m);
    var q = {
      // A month of one competition can exceed a page, and a calendar that
      // silently drops the last week is worse than no calendar.
      limit: '100',
      from: ymd(this.view.y, this.view.m, 1),
      to: ymd(this.view.y, this.view.m, last),
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
      case 'team':
        q.view = 'team'; q.key = v;
        if (c.side === 'home' || c.side === 'away') q.side = c.side;
        if (c.competition) q.competition = c.competition;
        break;
      case 'venue':     q.view = 'venue'; q.key = v; break;
      case 'performer': q.view = 'performer'; q.key = v; break;
      case 'category':  q.view = 'browse'; q.category = v; break;
      case 'search':    q.view = 'browse'; q.q = v; break;
      case 'all':       q.view = 'browse'; break;
      case 'competition':
      default:          q.view = 'competition'; q.slug = v; break;
    }
    return q;
  };

  TGTicketMonthWidget.prototype._load = function () {
    var self = this;
    var mine = ++this._reqId;

    if (needsValue(this.cfg.sourceType) && !String(this.cfg.sourceValue || '').trim()) {
      this.byDay = {};
      this.state = 'unset';
      this._render();
      return;
    }

    var q = this._query();
    var qs = Object.keys(q).filter(function (k) { return q[k] !== '' && q[k] != null; })
      .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(q[k]); }).join('&');

    this.state = 'loading';
    this._render();

    fetch(FEED_API + '?' + qs, { headers: { Accept: 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error(r.status === 404 ? 'not-found' : 'failed'); return r.json(); })
      .then(function (d) {
        if (mine !== self._reqId) return;
        self._all = d.events || [];
        self._side = 'all';         // a fresh month starts on "All games"
        self._buildByDay();         // lays events on days, honouring the filter
        self.state = 'ready';
        self._render();
      })
      .catch(function (err) {
        if (mine !== self._reqId) return;
        self.byDay = {};
        self.state = err && err.message === 'not-found' ? 'empty' : 'error';
        self._render();
      });
  };

  // Lay the month's events onto their days, dropping the ones the Home/Away
  // filter excludes (only when sourced by a team).
  TGTicketMonthWidget.prototype._buildByDay = function () {
    var c = this.cfg;
    var tk = c.sourceType === 'team' ? String(c.sourceValue || '').trim() : '';
    var side = (this._side === 'home' || this._side === 'away') ? this._side : '';
    var map = {};
    (this._all || []).forEach(function (e) {
      if (tk && side && sideOf(e, tk) !== side) return;
      var day = parseInt(String(e.startDate).slice(8, 10), 10);
      if (!map[day]) map[day] = [];
      map[day].push(e);
    });
    this.byDay = map;
    if (this.openDay && !map[this.openDay]) this.openDay = null;
  };

  // The Home/Away toggle, shown only for a team month with a real split (both
  // home AND away games this month). Counts come from the full month, not the
  // filtered view, so they stay stable.
  TGTicketMonthWidget.prototype._haFilterHtml = function () {
    var c = this.cfg;
    if (c.sourceType !== 'team') return '';
    var tk = String(c.sourceValue || '').trim();
    var all = this._all || [], homeN = 0, awayN = 0;
    for (var i = 0; i < all.length; i++) {
      var s = sideOf(all[i], tk);
      if (s === 'home') homeN++; else if (s === 'away') awayN++;
    }
    if (!(homeN > 0 && awayN > 0)) return '';
    var sv = (this._side === 'home' || this._side === 'away') ? this._side : 'all';
    var hf = function (v, label, on) {
      return '<button type="button" class="tgtm-hf' + (on ? ' is-on' : '') + '" data-side="' + v + '"'
        + ' aria-pressed="' + (on ? 'true' : 'false') + '">' + label + '</button>';
    };
    return '<div class="tgtm-hafilter" role="group" aria-label="Home or away">'
      + hf('all', 'All', sv === 'all')
      + hf('home', 'Home (' + homeN + ')', sv === 'home')
      + hf('away', 'Away (' + awayN + ')', sv === 'away')
      + '</div>';
  };

  TGTicketMonthWidget.prototype._rowHtml = function (ev) {
    var c = this.cfg;
    var meta = [];
    if (c.showTime) {
      if (ev.timeKnown && ev.startTime) meta.push('<span>' + icon('clock') + esc(ev.startTime) + '</span>');
      else meta.push('<span class="tgtm-chip">Time TBC</span>');
    }
    if (c.showVenue && ev.venue && ev.venue.name) meta.push('<span>' + icon('pin') + esc(ev.venue.name) + '</span>');
    if (c.showCompetition && ev.competitionLabel) meta.push('<span class="tgtm-chip">' + esc(ev.competitionLabel) + '</span>');

    var opts = Array.isArray(ev.bookingOptions) ? ev.bookingOptions : [];
    var usable = opts.map(function (o) {
      var direct = safeUrl(o.url);
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
      if (o.fly) {
        return '<button type="button" class="tgtm-btn' + (i > 0 ? ' tgtm-btn2' : '') + '"'
          + ' data-fly="' + esc(o.fly) + '" aria-haspopup="dialog"'
          + ' aria-label="' + esc(label + ': ' + (ev.title || 'event')) + '">'
          + esc(label) + icon('ext') + '</button>';
      }
      return '<a class="tgtm-btn' + (i > 0 ? ' tgtm-btn2' : '') + '" href="' + esc(safeUrl(o.url)) + '"'
        + ' target="_blank" rel="noopener noreferrer"'
        + ' aria-label="' + esc(label + ': ' + (ev.title || 'event')) + '">' + esc(label) + icon('ext') + '</a>';
    }).join('');

    return '<article class="tgtm-row">'
      + '<div class="tgtm-rmain"><h4 class="tgtm-rtitle">' + esc(ev.title || 'Event') + '</h4>'
      + '<div class="tgtm-rmeta">' + meta.join('') + '</div></div>'
      + (actions ? '<div class="tgtm-actions">' + actions + '</div>' : '')
      + '</article>';
  };

  TGTicketMonthWidget.prototype._gridHtml = function () {
    var c = this.cfg;
    var weekStart = clampInt(c.weekStart, 0, 1, 1);
    var y = this.view.y, m = this.view.m;
    var last = daysInMonth(y, m);
    var lead = columnOf(y, m, 1, weekStart);
    var maxPer = clampInt(c.maxPerCell, 1, 4, 2);

    var heads = '';
    for (var i = 0; i < 7; i++) {
      heads += '<div class="tgtm-dow">' + esc(DOW_SHORT[(weekStart + i) % 7]) + '</div>';
    }

    var cells = '';
    for (var b = 0; b < lead; b++) cells += '<div class="tgtm-cell is-blank"></div>';

    for (var d = 1; d <= last; d++) {
      var list = this.byDay[d] || [];
      var isToday = (y === this.today.y && m === this.today.m && d === this.today.d);
      // Days already gone. The feed no longer returns their events (nothing in
      // the past is bookable), so all they can do is read as what they are.
      var isPast = y === this.today.y && m === this.today.m && d < this.today.d;
      var open = this.openDay === d;
      var cls = 'tgtm-cell' + (list.length ? ' has-events' : '') + (isToday ? ' is-today' : '')
        + (isPast ? ' is-past' : '');
      var inner = '<span class="tgtm-num">' + d + '</span>';

      if (list.length) {
        if (c.showDayTitles) {
          for (var k = 0; k < Math.min(list.length, maxPer); k++) {
            inner += '<span class="tgtm-pip">' + esc(list[k].title || 'Event') + '</span>';
          }
          if (list.length > maxPer) {
            inner += '<span class="tgtm-more">+' + (list.length - maxPer) + ' more</span>';
          }
        } else {
          var dots = '';
          for (var q2 = 0; q2 < Math.min(list.length, 5); q2++) dots += '<span class="tgtm-dot"></span>';
          inner += '<span class="tgtm-dots">' + dots + '</span>';
        }
      }

      var label = DOW_LONG[new Date(y, m - 1, d).getDay()] + ' ' + d + ' ' + MON_LONG[m - 1]
        + ', ' + (list.length ? list.length + (list.length === 1 ? ' event' : ' events') : 'nothing on');

      cells += list.length
        ? '<button class="' + cls + '" type="button" data-day="' + d + '"'
          + ' aria-pressed="' + (open ? 'true' : 'false') + '"'
          + ' aria-label="' + esc(label) + '">' + inner + '</button>'
        : '<div class="' + cls + '" aria-label="' + esc(label) + '">' + inner + '</div>';
    }

    var trail = (7 - ((lead + last) % 7)) % 7;
    for (var t2 = 0; t2 < trail; t2++) cells += '<div class="tgtm-cell is-blank"></div>';

    return '<div class="tgtm-grid" role="grid">' + heads + cells + '</div>';
  };

  TGTicketMonthWidget.prototype._panelHtml = function () {
    if (!this.openDay) return '';
    var list = this.byDay[this.openDay] || [];
    if (!list.length) return '';
    var y = this.view.y, m = this.view.m, d = this.openDay;
    var title = DOW_LONG[new Date(y, m - 1, d).getDay()] + ' ' + d + ' ' + MON_LONG[m - 1];
    var self = this;
    return '<section class="tgtm-panel" aria-live="polite">'
      + '<h3 class="tgtm-ptitle">' + esc(title) + '</h3>'
      + '<div class="tgtm-list">'
      + list.slice(0, clampInt(this.cfg.dayLimit, 1, 50, 12)).map(function (e) { return self._rowHtml(e); }).join('')
      + '</div></section>';
  };

  TGTicketMonthWidget.prototype._render = function () {
    var c = this.cfg;
    var head = '';
    if (c.heading || c.subheading) {
      head = '<div class="tgtm-head">'
        + (c.heading ? '<h2 class="tgtm-h">' + esc(c.heading) + '</h2>' : '')
        + (c.subheading ? '<p class="tgtm-sub">' + esc(c.subheading) + '</p>' : '')
        + '</div>';
    }

    // Never navigate into the past: the feed has nothing there and an empty
    // September 2019 is not a useful place for a visitor to end up.
    var atFloor = (this.view.y === this.today.y && this.view.m === this.today.m);
    var bar = '<div class="tgtm-bar">'
      + '<div class="tgtm-month" aria-live="polite">' + esc(MON_LONG[this.view.m - 1] + ' ' + this.view.y) + '</div>'
      + '<button class="tgtm-nav" type="button" data-nav="-1" aria-label="Previous month"'
      + (atFloor ? ' disabled' : '') + '>' + icon('prev') + '</button>'
      + '<button class="tgtm-nav" type="button" data-nav="1" aria-label="Next month">' + icon('next') + '</button>'
      + '</div>';

    var body;
    if (this.state === 'unset') {
      body = '<div class="tgtm-state" role="status">' + icon('cal')
        + '<p>Choose what to show and the month will fill in.</p></div>';
    } else if (this.state === 'error') {
      body = '<div class="tgtm-state" role="status">' + icon('cal')
        + '<p>Could not load this month. Please try again shortly.</p></div>';
    } else if (this.state === 'loading') {
      var sk = '';
      for (var i = 0; i < 35; i++) sk += '<div class="tgtm-skel"></div>';
      body = '<div class="tgtm-grid" aria-busy="true">' + sk + '</div>';
    } else {
      body = this._haFilterHtml() + this._gridHtml();
      var any = Object.keys(this.byDay).length;
      if (!any) {
        body += '<div class="tgtm-state" style="margin-top:12px" role="status">'
          + '<p>' + esc(c.emptyText || 'Nothing on this month. Try the next one.') + '</p></div>';
      }
    }

    this.shadow.innerHTML = '<style>' + styles(c) + FLY_CSS + '</style>'
      + '<div class="tgtm-root" data-theme="' + esc(this._theme()) + '">'
      + head + bar + body + this._panelHtml() + '</div>';

    this._bind();
  };

  TGTicketMonthWidget.prototype._bind = function () {
    var self = this;
    var navs = this.shadow.querySelectorAll('[data-nav]');
    for (var i = 0; i < navs.length; i++) {
      navs[i].addEventListener('click', function () {
        var delta = parseInt(this.getAttribute('data-nav'), 10);
        var next = addMonths(self.view.y, self.view.m, delta);
        if (delta < 0 && (next.y < self.today.y
          || (next.y === self.today.y && next.m < self.today.m))) return;
        self.view = next;
        self.openDay = null;
        self._load();
      });
    }
    var cells = this.shadow.querySelectorAll('[data-day]');
    for (var j = 0; j < cells.length; j++) {
      cells[j].addEventListener('click', function () {
        var d = parseInt(this.getAttribute('data-day'), 10);
        self.openDay = (self.openDay === d) ? null : d;
        self._render();
      });
    }
    var hfs = this.shadow.querySelectorAll('.tgtm-hf');
    for (var k = 0; k < hfs.length; k++) {
      hfs[k].addEventListener('click', function () {
        var side = this.getAttribute('data-side') || 'all';
        if (self._side === side) return;
        self._side = side;
        self._buildByDay();   // re-lay the month for the chosen side, no refetch
        self._render();
      });
    }
  };

  TGTicketMonthWidget.prototype.update = function (next) {
    var before = JSON.stringify(this._query());
    this.cfg = Object.assign({}, this.cfg, next || {});
    var after = JSON.stringify(this._query());
    if (before !== after) { this.openDay = null; this._load(); return; }
    this._render();
  };

  TGTicketMonthWidget.prototype.destroy = function () {
    this._reqId++;
    try { this.shadow.innerHTML = ''; } catch (e) { /* detached */ }
  };

  function initOne(node) {
    if (node.getAttribute('data-tg-ticketmonth-init') === '1') return;
    node.setAttribute('data-tg-ticketmonth-init', '1');
    var inline = node.getAttribute('data-tg-config');
    if (inline) {
      var parsed = null;
      try { parsed = JSON.parse(inline); } catch (e) { parsed = null; }
      new TGTicketMonthWidget(node, parsed || {});
      return;
    }
    var id = node.getAttribute('data-tg-id');
    if (!id) { new TGTicketMonthWidget(node, {}); return; }
    fetch(CONFIG_API + '?id=' + encodeURIComponent(id), { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { new TGTicketMonthWidget(node, (d && (d.config || d)) || {}); })
      .catch(function () { new TGTicketMonthWidget(node, {}); });
  }

  function init() {
    var nodes = document.querySelectorAll('[data-tg-widget="ticketmonth"]');
    for (var i = 0; i < nodes.length; i++) initOne(nodes[i]);
  }

  window.TGTicketMonthWidget = TGTicketMonthWidget;
  window.__TG_TICKETMONTH_VERSION__ = VERSION;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}());
