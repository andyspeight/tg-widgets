/**
 * Travelgenix Ticket Search Widget v1.0.0
 * Self-contained, embeddable widget
 * Zero dependencies — works on any website via a single script tag
 *
 * One box over everything. "Wembley" returns the ground, the football at it and
 * the concerts at it. "Arsenal" returns the club and every game home and away.
 * "Madrid" returns two clubs and three grounds, because that is the honest
 * answer to an ambiguous word.
 *
 * Results are GROUPED rather than interleaved. A visitor typing "Madrid" wants
 * to be asked which Madrid, not handed 136 rows in date order.
 *
 * WHY THIS IS NOT A SETTING ON EVENT TICKETS
 * It is an input, not an output, and it is the only widget in the family that
 * works on a page with no subject of its own — a homepage, or a header.
 *
 * Usage:
 *   <div data-tg-widget="ticketsearch" data-tg-id="YOUR_WIDGET_ID"></div>
 *   <script src="https://tg-widgets.vercel.app/widget-ticketsearch.js" defer></script>
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
        if (/\/widget-ticketsearch\.js(\?|$|#)/.test(scripts[i].src || '')) return new URL(scripts[i].src).origin;
      }
    } catch (e) { /* fall through */ }
    return '';
  }

  var ORIGIN = resolveOrigin();
  var CONFIG_API = (typeof window !== 'undefined' && window.__TG_WIDGET_API__) || (ORIGIN + '/api/widget-config');
  var FEED_API = (typeof window !== 'undefined' && window.__TG_EVENTS_API__) || (ORIGIN + '/api/events-feed');

  var DEFAULTS = {
    heading: '',
    subheading: '',
    placeholder: 'Search a club, a ground, an act…',
    initialQuery: '',
    suggestions: ['Arsenal', 'Wembley', 'Premier League', 'Olivia Rodrigo'],
    category: '',              // narrow every search to one category
    competition: '',           // or to one competition
    showGroups: true,          // the entity cards above the events
    eventLimit: 10,
    daysAhead: 365,
    showVenue: true,
    showTime: true,
    showCompetition: true,
    bookLabel: 'Book',
    bookingKinds: ['ticket'],
    currency: 'GBP',
    adults: 2,
    theme: 'light',
    accent: '#00B4D8',
    radius: 12,
    fontFamily: '',
    appId: '',
  };

  var IC = {
    search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.3-4.3',
    clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 6v6l4 2',
    pin: 'M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0ZM12 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
    ext: 'M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6',
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
    var root = w.shadow.querySelector('.tgts-root');
    if (!root) return;

    var box = document.createElement('div');
    box.className = 'tgts-fly';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Choose your departure airport');
    box.innerHTML = '<div class="tgts-fly-t">Where are you flying from?</div>'
      + '<input class="tgts-fly-in" type="text" placeholder="Type an airport or code"'
      + ' autocomplete="off" spellcheck="false" aria-label="Search airports">'
      + '<div class="tgts-fly-list" role="listbox"></div>'
      + '<div class="tgts-fly-note">Loading airports&hellip;</div>';
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

    var input = box.querySelector('.tgts-fly-in');
    var list = box.querySelector('.tgts-fly-list');
    var note = box.querySelector('.tgts-fly-note');
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
        html += '<button type="button" class="tgts-fly-opt' + (i === state.active ? ' is-active' : '') + '"'
          + ' role="option" aria-selected="' + (i === state.active) + '" data-iata="' + esc(a[0]) + '">'
          + '<span class="tgts-fly-code">' + esc(a[0]) + '</span>'
          + '<span class="tgts-fly-name">' + esc(a[1]) + '</span></button>';
      }
      list.innerHTML = html;
      if (state.all) note.textContent = state.list.length ? '' : 'No airport matches that. Try the three-letter code.';
    }

    list.addEventListener('click', function (e) {
      var opt = e.target && e.target.closest ? e.target.closest('.tgts-fly-opt') : null;
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

  var FLY_CSS = '.tgts-root{position:relative}'
    + 'button.tgts-btn{border:0;font:inherit;cursor:pointer}'
    + '.tgts-fly{position:absolute;z-index:40;background:#fff;color:#1a2733;border:1px solid #dde4ea;'
    + 'border-radius:12px;box-shadow:0 12px 32px rgba(10,30,50,.18);padding:12px;box-sizing:border-box;'
    + 'font-size:14px;line-height:1.4;text-align:left}'
    + '.tgts-fly-t{font-weight:600;margin:0 0 8px;font-size:14px}'
    + '.tgts-fly-in{width:100%;box-sizing:border-box;padding:8px 10px;font:inherit;color:inherit;'
    + 'background:transparent;border:1.5px solid #cfd8e0;border-radius:8px;outline:none}'
    + '.tgts-fly-in:focus{border-color:currentColor}'
    + '.tgts-fly-list{margin-top:8px;max-height:224px;overflow-y:auto}'
    + '.tgts-fly-opt{display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:8px 10px;'
    + 'font:inherit;color:inherit;background:none;border:0;border-radius:8px;cursor:pointer}'
    + '.tgts-fly-opt.is-active,.tgts-fly-opt:hover{background:rgba(0,0,0,.07)}'
    + '.tgts-fly-code{font-weight:700;font-size:12px;letter-spacing:.04em;min-width:38px}'
    + '.tgts-fly-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
    + '.tgts-fly-note{color:#5b6b7b;font-size:12px;margin-top:6px}'
    + '.tgts-fly-note:empty{display:none}'
    + '.tgts-root[data-theme="dark"] .tgts-fly{background:#16202c;color:#e8eef4;border-color:#263442;'
    + 'box-shadow:0 12px 32px rgba(0,0,0,.55)}'
    + '.tgts-root[data-theme="dark"] .tgts-fly-in{border-color:#3a4a5a}'
    + '.tgts-root[data-theme="dark"] .tgts-fly-opt.is-active,'
    + '.tgts-root[data-theme="dark"] .tgts-fly-opt:hover{background:rgba(255,255,255,.09)}'
    + '.tgts-root[data-theme="dark"] .tgts-fly-note{color:#93a4b5}';
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

  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function dateParts(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    return { d: d, dow: DOW[new Date(y, mo - 1, d).getDay()], mon: MON[mo - 1] };
  }

  function localToday(offsetDays) {
    var t = new Date();
    if (offsetDays) t.setDate(t.getDate() + offsetDays);
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return t.getFullYear() + '-' + p(t.getMonth() + 1) + '-' + p(t.getDate());
  }

  function styles(cfg) {
    var accent = safeColour(cfg.accent, DEFAULTS.accent);
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
      + '.tgts-root{container-type:inline-size;font-family:' + stack + ';'
      + '--tgts-accent:' + accent + ';--tgts-radius:' + radius + 'px;'
      + '--tgts-bg:#FFFFFF;--tgts-bg2:#F8FAFC;--tgts-bg3:#F1F5F9;--tgts-border:#E2E8F0;'
      + '--tgts-text:#0F172A;--tgts-sub:#475569;--tgts-mute:#64748B;--tgts-on-accent:#04212B;'
      + '--tgts-badge-l:92%;--tgts-badge-t:34%;'
      + 'font-size:15px;line-height:1.6;color:var(--tgts-text);box-sizing:border-box;'
      + '-webkit-font-smoothing:antialiased;}'
      + '.tgts-root *,.tgts-root *::before,.tgts-root *::after{box-sizing:border-box;}'
      + '.tgts-root[data-theme="dark"]{--tgts-bg:#0F172A;--tgts-bg2:#1E293B;--tgts-bg3:#334155;'
      + '--tgts-border:#334155;--tgts-text:#F8FAFC;--tgts-sub:#CBD5E1;--tgts-mute:#94A3B8;'
      + '--tgts-badge-l:24%;--tgts-badge-t:74%;}'

      + '.tgts-head{margin:0 0 14px;}'
      + '.tgts-h{margin:0;font-size:22px;font-weight:700;line-height:1.25;letter-spacing:-.01em;}'
      + '.tgts-sub{margin:4px 0 0;font-size:15px;color:var(--tgts-sub);}'

      + '.tgts-form{position:relative;display:flex;align-items:center;}'
      + '.tgts-form svg{position:absolute;left:14px;width:18px;height:18px;color:var(--tgts-mute);pointer-events:none;}'
      + '.tgts-input{width:100%;min-height:52px;padding:0 46px 0 44px;font:inherit;font-size:16px;'
      + 'color:var(--tgts-text);background:var(--tgts-bg);border:1px solid var(--tgts-border);'
      + 'border-radius:var(--tgts-radius);}'
      + '.tgts-input::placeholder{color:var(--tgts-mute);}'
      + '.tgts-input:focus{outline:none;border-color:var(--tgts-accent);'
      + 'box-shadow:0 0 0 3px color-mix(in srgb,var(--tgts-accent) 22%,transparent);}'
      + '.tgts-clear{position:absolute;right:8px;width:34px;height:34px;border:0;border-radius:50%;'
      + 'background:none;color:var(--tgts-mute);font:inherit;font-size:18px;line-height:1;cursor:pointer;}'
      + '.tgts-clear:hover{background:var(--tgts-bg3);color:var(--tgts-text);}'
      + '.tgts-clear:focus-visible{outline:2px solid var(--tgts-accent);outline-offset:2px;}'

      + '.tgts-quick{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;}'
      + '.tgts-quick button{min-height:34px;padding:0 12px;border:1px solid var(--tgts-border);'
      + 'border-radius:999px;background:var(--tgts-bg);color:var(--tgts-sub);'
      + 'font:inherit;font-size:12.5px;cursor:pointer;}'
      + '.tgts-quick button:hover{border-color:var(--tgts-accent);color:var(--tgts-text);}'
      + '.tgts-quick button:focus-visible{outline:2px solid var(--tgts-accent);outline-offset:2px;}'

      + '.tgts-results{margin-top:18px;}'
      + '.tgts-summary{font-size:13.5px;color:var(--tgts-mute);margin:0 0 14px;}'
      + '.tgts-gtitle{font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;'
      + 'color:var(--tgts-mute);margin:18px 0 8px;}'
      + '.tgts-gtitle:first-child{margin-top:0;}'

      + '.tgts-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:8px;}'
      + '.tgts-card{min-width:0;display:flex;align-items:center;gap:10px;padding:10px 12px;'
      + 'background:var(--tgts-bg);border:1px solid var(--tgts-border);border-radius:var(--tgts-radius);'
      + 'text-decoration:none;color:inherit;font:inherit;text-align:left;cursor:pointer;width:100%;'
      + 'transition:border-color .16s ease-out;}'
      + '.tgts-card:hover{border-color:var(--tgts-accent);}'
      + '.tgts-card:focus-visible{outline:2px solid var(--tgts-accent);outline-offset:2px;}'
      + '.tgts-badge{flex:none;width:32px;height:32px;border-radius:50%;display:inline-flex;'
      + 'align-items:center;justify-content:center;font-size:11px;font-weight:700;}'
      + '.tgts-cbody{flex:1 1 auto;min-width:0;}'
      // Block, not inline: ellipsis does nothing to an inline box.
      + '.tgts-cname{display:block;font-size:13.5px;font-weight:600;line-height:1.3;'
      + 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}'
      + '.tgts-cmeta{display:block;font-size:11.5px;color:var(--tgts-mute);'
      + 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}'

      + '.tgts-list{display:flex;flex-direction:column;gap:8px;}'
      + '.tgts-row{min-width:0;display:grid;grid-template-columns:56px minmax(0,1fr) auto;gap:12px;'
      + 'align-items:center;padding:11px 12px;background:var(--tgts-bg);'
      + 'border:1px solid var(--tgts-border);border-radius:var(--tgts-radius);}'
      + '.tgts-date{text-align:center;padding:4px 0;background:var(--tgts-bg3);'
      + 'border-radius:calc(var(--tgts-radius) - 6px);line-height:1.15;font-variant-numeric:tabular-nums;}'
      + '.tgts-dow{display:block;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--tgts-mute);}'
      + '.tgts-day{display:block;font-size:19px;font-weight:700;}'
      + '.tgts-mon{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--tgts-sub);}'
      + '.tgts-rmain{min-width:0;}'
      + '.tgts-rtitle{margin:0 0 2px;font-size:14.5px;font-weight:600;line-height:1.3;overflow-wrap:anywhere;}'
      + '.tgts-rmeta{display:flex;flex-wrap:wrap;gap:4px 12px;align-items:center;font-size:12.5px;color:var(--tgts-sub);}'
      + '.tgts-rmeta svg{width:13px;height:13px;flex:none;color:var(--tgts-mute);vertical-align:-2px;}'
      + '.tgts-rmeta span{display:inline-flex;align-items:center;gap:4px;}'
      + '.tgts-chip{display:inline-flex;padding:1px 8px;border-radius:999px;background:var(--tgts-bg3);'
      + 'color:var(--tgts-sub);font-size:11px;font-weight:500;white-space:nowrap;}'

      + '.tgts-actions{display:flex;flex-wrap:wrap;gap:6px;}'
      + '.tgts-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:42px;'
      + 'padding:0 14px;border-radius:calc(var(--tgts-radius) - 4px);border:1px solid transparent;'
      + 'background:var(--tgts-accent);color:var(--tgts-on-accent);font:inherit;font-size:13px;'
      + 'font-weight:600;text-decoration:none;cursor:pointer;white-space:nowrap;transition:filter .16s ease-out;}'
      + '.tgts-btn:hover{filter:brightness(.93);}'
      + '.tgts-btn svg{width:13px;height:13px;}'
      + '.tgts-btn2{background:var(--tgts-bg);border-color:var(--tgts-border);color:var(--tgts-text);}'
      + '.tgts-btn:focus-visible{outline:2px solid var(--tgts-accent);outline-offset:2px;}'

      + '.tgts-state{padding:26px 18px;text-align:center;color:var(--tgts-sub);background:var(--tgts-bg2);'
      + 'border:1px dashed var(--tgts-border);border-radius:var(--tgts-radius);}'
      + '.tgts-state svg{width:24px;height:24px;color:var(--tgts-mute);margin-bottom:6px;}'
      + '.tgts-state p{margin:0;}'
      + '.tgts-skel{height:64px;border-radius:var(--tgts-radius);'
      + 'background:linear-gradient(90deg,var(--tgts-bg3) 25%,var(--tgts-bg2) 50%,var(--tgts-bg3) 75%);'
      + 'background-size:200% 100%;animation:tgts-sh 1.4s ease-in-out infinite;}'
      + '@keyframes tgts-sh{0%{background-position:200% 0}100%{background-position:-200% 0}}'

      + '@container (max-width:520px){'
      + '.tgts-cards{grid-template-columns:minmax(0,1fr);}'
      + '.tgts-row{grid-template-columns:48px minmax(0,1fr);row-gap:9px;}'
      + '.tgts-actions{grid-column:1/-1;}.tgts-btn{flex:1 1 auto;}}'
      + '@media (prefers-reduced-motion:reduce){.tgts-root *{animation-duration:.01ms !important;'
      + 'animation-iteration-count:1 !important;transition-duration:.01ms !important;}}';
  }

  function TGTicketSearchWidget(container, config) {
    this.el = container;
    this.cfg = Object.assign({}, DEFAULTS, config || {});
    this.shadow = container.shadowRoot || container.attachShadow({ mode: 'open' });
    flyInit(this);
    this.query = String(this.cfg.initialQuery || '');
    this.data = null;
    this.state = this.query ? 'loading' : 'idle';
    this._reqId = 0;
    this._debounce = null;
    this._render();
    if (this.query) this._search(this.query);
  }

  TGTicketSearchWidget.prototype._theme = function () {
    var t = this.cfg.theme;
    if (t === 'dark') return 'dark';
    if (t === 'auto') {
      try { return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; }
      catch (e) { return 'light'; }
    }
    return 'light';
  };

  TGTicketSearchWidget.prototype._search = function (term) {
    var self = this;
    var mine = ++this._reqId;
    var c = this.cfg;

    if (!term || term.trim().length < 2) {
      this.data = null;
      this.state = 'idle';
      this._render();
      return;
    }

    var q = {
      view: 'search', q: term.trim(),
      limit: String(clampInt(c.eventLimit, 1, 50, 10)),
      currency: c.currency,
      adults: String(clampInt(c.adults, 1, 20, 2)),
    };
    if (c.appId) q.appId = c.appId;
    // Narrowing goes to the API, not to the response. Filtering the returned
    // page here would empty the list whenever the first N matches happened to
    // be the wrong category, even with plenty of matching events further down.
    if (c.category) q.category = c.category;
    if (c.competition) q.competition = c.competition;
    var kinds = Array.isArray(c.bookingKinds) ? c.bookingKinds.filter(Boolean) : [];
    if (kinds.length) q.booking = kinds.join(',');

    this.state = 'loading';
    this._render();

    var qs = Object.keys(q).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(q[k]); }).join('&');
    fetch(FEED_API + '?' + qs, { headers: { Accept: 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error('failed'); return r.json(); })
      .then(function (d) {
        if (mine !== self._reqId) return;
        self.data = d;
        self.state = 'ready';
        self._render();
      })
      .catch(function () {
        if (mine !== self._reqId) return;
        self.data = null;
        self.state = 'error';
        self._render();
      });
  };

  TGTicketSearchWidget.prototype._cardHtml = function (name, meta, hue, href) {
    var h = typeof hue === 'number' ? hue : 210;
    var ini = String(name || '?').replace(/\([^)]*\)/g, ' ').split(/[^A-Za-z0-9]+/)
      .filter(function (w) { return w && !/^(fc|afc|the|of|and)$/i.test(w); });
    var initials = ini.length > 1 ? (ini[0][0] + ini[1][0]) : (ini[0] || '?').slice(0, 2);
    var body = '<span class="tgts-badge" aria-hidden="true" style="background:hsl(' + h + ' 48% var(--tgts-badge-l));'
      + 'color:hsl(' + h + ' 62% var(--tgts-badge-t))">' + esc(initials.toUpperCase()) + '</span>'
      + '<span class="tgts-cbody"><span class="tgts-cname">' + esc(name) + '</span>'
      + '<span class="tgts-cmeta">' + esc(meta) + '</span></span>';
    // A card only becomes a link when the client gave us somewhere to send
    // people. Otherwise it is a plain tile — never a link to nowhere.
    return href
      ? '<a class="tgts-card" href="' + esc(safeUrl(href)) + '">' + body + '</a>'
      : '<div class="tgts-card" style="cursor:default">' + body + '</div>';
  };

  TGTicketSearchWidget.prototype._rowHtml = function (ev) {
    var c = this.cfg;
    var p = dateParts(ev.startDate);
    var meta = [];
    if (c.showTime) {
      if (ev.timeKnown && ev.startTime) meta.push('<span>' + icon('clock') + esc(ev.startTime) + '</span>');
      else meta.push('<span class="tgts-chip">Time TBC</span>');
    }
    if (c.showVenue && ev.venue && ev.venue.name) meta.push('<span>' + icon('pin') + esc(ev.venue.name) + '</span>');
    if (c.showCompetition && ev.competitionLabel) meta.push('<span class="tgts-chip">' + esc(ev.competitionLabel) + '</span>');

    var opts = Array.isArray(ev.bookingOptions) ? ev.bookingOptions : [];
    var usable = opts.map(function (o) {
      var direct = safeUrl(o.url);
      if (direct) return { kind: o.kind, label: o.label, short: o.short, url: direct };
      var tpl = flyTpl(o);
      if (tpl) return { kind: o.kind, label: o.label, short: o.short, fly: tpl };
      return null;
    }).filter(Boolean);
    if (!usable.length && ev.booking && safeUrl(ev.booking.url)) {
      usable = [{ kind: 'ticket', short: c.bookLabel, url: ev.booking.url }];
    }
    var actions = usable.map(function (o, i) {
      var label = usable.length === 1 ? c.bookLabel : (o.short || o.label || c.bookLabel);
      if (o.fly) {
        return '<button type="button" class="tgts-btn' + (i > 0 ? ' tgts-btn2' : '') + '"'
          + ' data-fly="' + esc(o.fly) + '" aria-haspopup="dialog"'
          + ' aria-label="' + esc(label + ': ' + (ev.title || 'event')) + '">'
          + esc(label) + icon('ext') + '</button>';
      }
      return '<a class="tgts-btn' + (i > 0 ? ' tgts-btn2' : '') + '" href="' + esc(safeUrl(o.url)) + '"'
        + ' target="_blank" rel="noopener noreferrer"'
        + ' aria-label="' + esc(label + ': ' + (ev.title || 'event')) + '">' + esc(label) + icon('ext') + '</a>';
    }).join('');

    return '<article class="tgts-row">'
      + (p ? '<div class="tgts-date"><span class="tgts-dow">' + esc(p.dow) + '</span>'
        + '<span class="tgts-day">' + esc(String(p.d)) + '</span>'
        + '<span class="tgts-mon">' + esc(p.mon) + '</span></div>'
        : '<div class="tgts-date"><span class="tgts-mon">TBC</span></div>')
      + '<div class="tgts-rmain"><h4 class="tgts-rtitle">' + esc(ev.title || 'Event') + '</h4>'
      + '<div class="tgts-rmeta">' + meta.join('') + '</div></div>'
      + (actions ? '<div class="tgts-actions">' + actions + '</div>' : '')
      + '</article>';
  };

  TGTicketSearchWidget.prototype._resultsHtml = function () {
    var c = this.cfg;

    if (this.state === 'idle') {
      return '<div class="tgts-state" role="status">' + icon('search')
        + '<p>' + esc('Type a club, a ground, an act or a league. Two letters is enough.') + '</p></div>';
    }
    if (this.state === 'loading') {
      return '<div aria-busy="true"><div class="tgts-skel"></div>'
        + '<div class="tgts-skel" style="margin-top:8px"></div>'
        + '<div class="tgts-skel" style="margin-top:8px"></div></div>';
    }
    if (this.state === 'error') {
      return '<div class="tgts-state" role="status">' + icon('cal')
        + '<p>' + esc('Search is unavailable right now. Please try again shortly.') + '</p></div>';
    }

    var d = this.data || {};
    var events = d.events || [];
    var groups = '';
    var counted = 0;

    if (c.showGroups) {
      var self = this;
      var section = function (title, items, mapper) {
        if (!items || !items.length) return '';
        counted += items.length;
        return '<div class="tgts-gtitle">' + esc(title) + '</div><div class="tgts-cards">'
          + items.map(mapper).join('') + '</div>';
      };
      groups += section('Competitions', d.competitions, function (x) {
        return self._cardHtml(x.label + (x.country ? ' - ' + x.country : ''),
          x.events + ' events', null, '');
      });
      groups += section('Clubs', d.teams, function (x) {
        return self._cardHtml(x.name, x.events + ' games · ' + x.home + ' home', x.hue, '');
      });
      groups += section('Venues', d.venues, function (x) {
        return self._cardHtml(x.name, x.events + ' events', x.hue, '');
      });
      groups += section('Artists', d.performers, function (x) {
        return self._cardHtml(x.name, x.events + ' dates', x.hue, '');
      });
    }

    if (!events.length && !counted) {
      return '<div class="tgts-state" role="status">' + icon('search')
        + '<p>' + esc('Nothing matches “' + this.query + '”. Try a shorter term, or part of a name.') + '</p></div>';
    }

    var bits = [];
    if (events.length) bits.push(events.length + (events.length === 1 ? ' event' : ' events'));
    if (d.teamsTotal) bits.push(d.teamsTotal + (d.teamsTotal === 1 ? ' club' : ' clubs'));
    if (d.venuesTotal) bits.push(d.venuesTotal + (d.venuesTotal === 1 ? ' venue' : ' venues'));
    if (d.performersTotal) bits.push(d.performersTotal + (d.performersTotal === 1 ? ' artist' : ' artists'));

    var self2 = this;
    var list = events.length
      ? '<div class="tgts-gtitle">Events</div><div class="tgts-list">'
        + events.map(function (e) { return self2._rowHtml(e); }).join('') + '</div>'
      : '';

    return '<p class="tgts-summary">' + esc(bits.join(' · ') + ' matching “' + this.query + '”') + '</p>'
      + groups + list;
  };

  /**
   * The chrome — everything except the results — is built ONCE.
   *
   * The first version re-rendered the whole shadow root on every keystroke,
   * which destroyed and recreated the input. Restoring focus afterwards does
   * not work: tearing the old input out fires blur, so any "was it focused"
   * flag is already false by the time the new one exists. The fix is not to
   * destroy it. Only .tgts-results is repainted, so the caret is never at risk.
   */
  TGTicketSearchWidget.prototype._shellKey = function () {
    var c = this.cfg;
    return [c.theme, c.accent, c.radius, c.fontFamily, c.heading, c.subheading,
      c.placeholder, (c.suggestions || []).join('|')].join('~');
  };

  TGTicketSearchWidget.prototype._mount = function () {
    var c = this.cfg;
    var head = '';
    if (c.heading || c.subheading) {
      head = '<div class="tgts-head">'
        + (c.heading ? '<h2 class="tgts-h">' + esc(c.heading) + '</h2>' : '')
        + (c.subheading ? '<p class="tgts-sub">' + esc(c.subheading) + '</p>' : '')
        + '</div>';
    }
    var sugg = Array.isArray(c.suggestions) ? c.suggestions.filter(Boolean).slice(0, 6) : [];
    var quick = sugg.length
      ? '<div class="tgts-quick">' + sugg.map(function (x) {
        return '<button type="button" data-q="' + esc(x) + '">' + esc(x) + '</button>';
      }).join('') + '</div>'
      : '';

    this.shadow.innerHTML = '<style>' + styles(c) + FLY_CSS + '</style>'
      + '<div class="tgts-root" data-theme="' + esc(this._theme()) + '">'
      + head
      + '<div class="tgts-form">' + icon('search')
      + '<input class="tgts-input" type="search" autocomplete="off"'
      + ' aria-label="' + esc(c.placeholder || 'Search events') + '"'
      + ' placeholder="' + esc(c.placeholder || '') + '">'
      + '<button class="tgts-clear" type="button" aria-label="Clear search" hidden>&#215;</button>'
      + '</div>' + quick
      + '<div class="tgts-results" aria-live="polite"></div>'
      + '</div>';

    var self = this;
    var input = this.shadow.querySelector('.tgts-input');
    input.value = this.query;
    input.addEventListener('input', function () {
      self.query = input.value;
      self._syncForm();
      clearTimeout(self._debounce);
      self._debounce = setTimeout(function () { self._search(self.query); }, 280);
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); clearTimeout(self._debounce); self._search(self.query); }
      if (e.key === 'Escape') { input.value = ''; self.query = ''; self._syncForm(); self._search(''); }
    });

    this.shadow.querySelector('.tgts-clear').addEventListener('click', function () {
      input.value = '';
      self.query = '';
      self._syncForm();
      input.focus();
      self._search('');
    });

    var chips = this.shadow.querySelectorAll('.tgts-quick button');
    for (var i = 0; i < chips.length; i++) {
      chips[i].addEventListener('click', function () {
        self.query = this.getAttribute('data-q') || '';
        input.value = self.query;
        self._syncForm();
        self._search(self.query);
      });
    }

    this._mountedKey = this._shellKey();
  };

  /** The two bits of chrome that depend on whether there is a query. */
  TGTicketSearchWidget.prototype._syncForm = function () {
    var clear = this.shadow.querySelector('.tgts-clear');
    if (clear) clear.hidden = !this.query;
    var quick = this.shadow.querySelector('.tgts-quick');
    if (quick) quick.hidden = !!this.query;
  };

  TGTicketSearchWidget.prototype._render = function () {
    if (this._mountedKey !== this._shellKey()) this._mount();
    var results = this.shadow.querySelector('.tgts-results');
    if (!results) { this._mount(); results = this.shadow.querySelector('.tgts-results'); }
    var input = this.shadow.querySelector('.tgts-input');
    if (input && input.value !== this.query) input.value = this.query;
    this._syncForm();
    results.innerHTML = this._resultsHtml();
  };

  TGTicketSearchWidget.prototype.update = function (next) {
    var prev = this.cfg;
    this.cfg = Object.assign({}, this.cfg, next || {});
    var requery = prev.category !== this.cfg.category
      || prev.competition !== this.cfg.competition
      || prev.eventLimit !== this.cfg.eventLimit
      || prev.appId !== this.cfg.appId
      || prev.currency !== this.cfg.currency
      || prev.adults !== this.cfg.adults
      || String(prev.bookingKinds) !== String(this.cfg.bookingKinds);
    if (next && typeof next.initialQuery === 'string' && next.initialQuery !== prev.initialQuery) {
      this.query = next.initialQuery;
      this._search(this.query);
      return;
    }
    if (requery && this.query) { this._search(this.query); return; }
    this._render();
  };

  TGTicketSearchWidget.prototype.destroy = function () {
    this._reqId++;
    clearTimeout(this._debounce);
    try { this.shadow.innerHTML = ''; } catch (e) { /* detached */ }
  };

  function initOne(node) {
    if (node.getAttribute('data-tg-ticketsearch-init') === '1') return;
    node.setAttribute('data-tg-ticketsearch-init', '1');
    var inline = node.getAttribute('data-tg-config');
    if (inline) {
      var parsed = null;
      try { parsed = JSON.parse(inline); } catch (e) { parsed = null; }
      new TGTicketSearchWidget(node, parsed || {});
      return;
    }
    var id = node.getAttribute('data-tg-id');
    if (!id) { new TGTicketSearchWidget(node, {}); return; }
    fetch(CONFIG_API + '?id=' + encodeURIComponent(id), { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { new TGTicketSearchWidget(node, (d && (d.config || d)) || {}); })
      .catch(function () { new TGTicketSearchWidget(node, {}); });
  }

  function init() {
    var nodes = document.querySelectorAll('[data-tg-widget="ticketsearch"]');
    for (var i = 0; i < nodes.length; i++) initOne(nodes[i]);
  }

  window.TGTicketSearchWidget = TGTicketSearchWidget;
  window.__TG_TICKETSEARCH_VERSION__ = VERSION;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}());
