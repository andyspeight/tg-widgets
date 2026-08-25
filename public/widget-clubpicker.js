/**
 * Travelgenix Club Picker Widget v1.0.0
 * Self-contained, embeddable widget
 * Zero dependencies — works on any website via a single script tag
 *
 * A grid of badges. Click one and that club's fixtures open underneath, in the
 * same embed. The original brief — a Premier League page listing every club,
 * click a badge, book a game — as one line of HTML.
 *
 * It works for clubs in a competition, artists in a category, or venues in a
 * category, because a grid of things you pick from is the same shape whatever
 * the things are.
 *
 * ON THE BADGES
 * Generated monograms on a colour hashed from the entity key, not club crests.
 * Real crests are licensed artwork the feed does not carry. The hash matches
 * the server's, so a club is the same colour in every widget and on every page.
 *
 * WHY THIS IS NOT A SETTING ON EVENT TICKETS
 * It is a navigation shape, not a list: two states, and the second state is the
 * point. Folding it into the list widget would give one editor two unrelated
 * jobs and one config object two unrelated halves.
 *
 * Usage:
 *   <div data-tg-widget="clubpicker" data-tg-id="YOUR_WIDGET_ID"></div>
 *   <script src="https://tg-widgets.vercel.app/widget-clubpicker.js" defer></script>
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
        if (/\/widget-clubpicker\.js(\?|$|#)/.test(scripts[i].src || '')) return new URL(scripts[i].src).origin;
      }
    } catch (e) { /* fall through */ }
    return '';
  }

  var ORIGIN = resolveOrigin();
  var CONFIG_API = (typeof window !== 'undefined' && window.__TG_WIDGET_API__) || (ORIGIN + '/api/widget-config');
  var FEED_API = (typeof window !== 'undefined' && window.__TG_EVENTS_API__) || (ORIGIN + '/api/events-feed');

  var DEFAULTS = {
    gridOf: 'team',            // team | performer | venue
    competition: 'english-premier-league',
    category: '',
    heading: '',
    subheading: '',
    prompt: 'Pick a badge to see their fixtures',
    selectorMode: 'grid',      // grid | dropdown | both
    columns: 0,                // 0 = auto-fill
    showBadges: true,
    showHomeVenue: true,
    showCounts: true,
    maxEntities: 40,
    eventLimit: 8,
    daysAhead: 365,
    side: 'both',              // applied to the expanded club
    showVenue: true,
    showTime: true,
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
    clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 6v6l4 2',
    pin: 'M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0ZM12 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
    ext: 'M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6',
    cal: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z',
    back: 'M19 12H5M12 19l-7-7 7-7',
    chev: 'M6 9l6 6 6-6',
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
    var root = w.shadow.querySelector('.tgcp-root');
    if (!root) return;

    var box = document.createElement('div');
    box.className = 'tgcp-fly';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Choose your departure airport');
    box.innerHTML = '<div class="tgcp-fly-t">Where are you flying from?</div>'
      + '<input class="tgcp-fly-in" type="text" placeholder="Type an airport or code"'
      + ' autocomplete="off" spellcheck="false" aria-label="Search airports">'
      + '<div class="tgcp-fly-list" role="listbox"></div>'
      + '<div class="tgcp-fly-note">Loading airports&hellip;</div>';
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

    var input = box.querySelector('.tgcp-fly-in');
    var list = box.querySelector('.tgcp-fly-list');
    var note = box.querySelector('.tgcp-fly-note');
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
        html += '<button type="button" class="tgcp-fly-opt' + (i === state.active ? ' is-active' : '') + '"'
          + ' role="option" aria-selected="' + (i === state.active) + '" data-iata="' + esc(a[0]) + '">'
          + '<span class="tgcp-fly-code">' + esc(a[0]) + '</span>'
          + '<span class="tgcp-fly-name">' + esc(a[1]) + '</span></button>';
      }
      list.innerHTML = html;
      if (state.all) note.textContent = state.list.length ? '' : 'No airport matches that. Try the three-letter code.';
    }

    list.addEventListener('click', function (e) {
      var opt = e.target && e.target.closest ? e.target.closest('.tgcp-fly-opt') : null;
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

  var FLY_CSS = '.tgcp-root{position:relative}'
    + 'button.tgcp-btn{border:0;font:inherit;cursor:pointer}'
    + '.tgcp-fly{position:absolute;z-index:40;background:#fff;color:#1a2733;border:1px solid #dde4ea;'
    + 'border-radius:12px;box-shadow:0 12px 32px rgba(10,30,50,.18);padding:12px;box-sizing:border-box;'
    + 'font-size:14px;line-height:1.4;text-align:left}'
    + '.tgcp-fly-t{font-weight:600;margin:0 0 8px;font-size:14px}'
    + '.tgcp-fly-in{width:100%;box-sizing:border-box;padding:8px 10px;font:inherit;color:inherit;'
    + 'background:transparent;border:1.5px solid #cfd8e0;border-radius:8px;outline:none}'
    + '.tgcp-fly-in:focus{border-color:currentColor}'
    + '.tgcp-fly-list{margin-top:8px;max-height:224px;overflow-y:auto}'
    + '.tgcp-fly-opt{display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:8px 10px;'
    + 'font:inherit;color:inherit;background:none;border:0;border-radius:8px;cursor:pointer}'
    + '.tgcp-fly-opt.is-active,.tgcp-fly-opt:hover{background:rgba(0,0,0,.07)}'
    + '.tgcp-fly-code{font-weight:700;font-size:12px;letter-spacing:.04em;min-width:38px}'
    + '.tgcp-fly-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
    + '.tgcp-fly-note{color:#5b6b7b;font-size:12px;margin-top:6px}'
    + '.tgcp-fly-note:empty{display:none}'
    + '.tgcp-root[data-theme="dark"] .tgcp-fly{background:#16202c;color:#e8eef4;border-color:#263442;'
    + 'box-shadow:0 12px 32px rgba(0,0,0,.55)}'
    + '.tgcp-root[data-theme="dark"] .tgcp-fly-in{border-color:#3a4a5a}'
    + '.tgcp-root[data-theme="dark"] .tgcp-fly-opt.is-active,'
    + '.tgcp-root[data-theme="dark"] .tgcp-fly-opt:hover{background:rgba(255,255,255,.09)}'
    + '.tgcp-root[data-theme="dark"] .tgcp-fly-note{color:#93a4b5}';
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

  // Which side of a fixture the queried team is on. The feed tags every event
  // with homeTeamKey / awayTeamKey (lowercased, same space as the entity keys),
  // so a visitor Home/Away filter needs no extra fetch. Returns '' if neither
  // matches (never expected on a team view, but then the game shows under "All").
  function sideOf(ev, teamKey) {
    if (!teamKey || !ev) return '';
    if (ev.homeTeamKey && ev.homeTeamKey === teamKey) return 'home';
    if (ev.awayTeamKey && ev.awayTeamKey === teamKey) return 'away';
    return '';
  }

  function styles(cfg) {
    var accent = safeColour(cfg.accent, DEFAULTS.accent);
    var radius = clampInt(cfg.radius, 0, 28, DEFAULTS.radius);
    var cols = clampInt(cfg.columns, 0, 8, 0);
    var font = safeFont(cfg.fontFamily);
    var stack = (font ? '"' + font + '", ' : '')
      + "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
    var grid = cols
      ? 'repeat(' + cols + ',minmax(0,1fr))'
      : 'repeat(auto-fill,minmax(190px,1fr))';

    return ':host{all:initial;display:block;}'
      // container-type makes the breakpoint below a @container query rather than
      // @media. A widget sits in whatever column the client gives it, and a
      // viewport query cannot see that the column is 240px wide on a 1500px
      // screen: that is how the club grid ended up writing names one letter per
      // line on the dashboard card.
      + '.tgcp-root{container-type:inline-size;font-family:' + stack + ';'
      + '--tgcp-accent:' + accent + ';--tgcp-radius:' + radius + 'px;'
      + '--tgcp-bg:#FFFFFF;--tgcp-bg2:#F8FAFC;--tgcp-bg3:#F1F5F9;--tgcp-border:#E2E8F0;'
      + '--tgcp-text:#0F172A;--tgcp-sub:#475569;--tgcp-mute:#64748B;--tgcp-on-accent:#04212B;'
      + '--tgcp-badge-l:92%;--tgcp-badge-t:34%;'
      + 'font-size:15px;line-height:1.6;color:var(--tgcp-text);box-sizing:border-box;'
      + '-webkit-font-smoothing:antialiased;}'
      + '.tgcp-root *,.tgcp-root *::before,.tgcp-root *::after{box-sizing:border-box;}'
      + '.tgcp-root[data-theme="dark"]{--tgcp-bg:#0F172A;--tgcp-bg2:#1E293B;--tgcp-bg3:#334155;'
      + '--tgcp-border:#334155;--tgcp-text:#F8FAFC;--tgcp-sub:#CBD5E1;--tgcp-mute:#94A3B8;'
      + '--tgcp-badge-l:24%;--tgcp-badge-t:74%;}'

      + '.tgcp-head{margin:0 0 6px;}'
      + '.tgcp-h{margin:0;font-size:22px;font-weight:700;line-height:1.25;letter-spacing:-.01em;}'
      + '.tgcp-sub{margin:4px 0 0;font-size:15px;color:var(--tgcp-sub);}'
      + '.tgcp-prompt{margin:0 0 14px;font-size:13px;color:var(--tgcp-mute);}'

      // Dropdown selector (an alternative or companion to the grid).
      + '.tgcp-selwrap{position:relative;max-width:420px;margin:0 0 14px;}'
      + '.tgcp-select{width:100%;min-height:46px;padding:0 40px 0 14px;appearance:none;-webkit-appearance:none;'
      + 'background:var(--tgcp-bg);border:1px solid var(--tgcp-border);border-radius:var(--tgcp-radius);'
      + 'font:inherit;font-size:15px;color:var(--tgcp-text);cursor:pointer;line-height:1.3;'
      + 'transition:border-color .18s ease-out;}'
      + '.tgcp-select:hover{border-color:var(--tgcp-accent);}'
      + '.tgcp-select:focus-visible{outline:2px solid var(--tgcp-accent);outline-offset:2px;}'
      + '.tgcp-selchev{position:absolute;right:13px;top:50%;transform:translateY(-50%);width:16px;height:16px;'
      + 'color:var(--tgcp-mute);pointer-events:none;}'

      + '.tgcp-grid{display:grid;grid-template-columns:' + grid + ';gap:10px;}'
      // min-width:0 on the tile is load-bearing. A grid item defaults to
      // min-width:auto, so the nowrap meta line inside it sets the track's
      // minimum and pushes the whole grid past a phone's viewport.
      + '.tgcp-tile{min-width:0;display:flex;align-items:center;gap:11px;width:100%;min-height:72px;padding:12px;'
      + 'background:var(--tgcp-bg);border:1px solid var(--tgcp-border);border-radius:var(--tgcp-radius);'
      + 'font:inherit;text-align:left;cursor:pointer;color:inherit;'
      + 'transition:border-color .18s ease-out,box-shadow .18s ease-out,transform .18s ease-out;}'
      + '.tgcp-tile:hover{border-color:var(--tgcp-accent);transform:translateY(-1px);'
      + 'box-shadow:0 4px 10px rgba(15,23,42,.07);}'
      + '.tgcp-tile:active{transform:translateY(0) scale(.99);}'
      + '.tgcp-tile:focus-visible{outline:2px solid var(--tgcp-accent);outline-offset:2px;}'
      + '.tgcp-tile[aria-expanded="true"]{border-color:var(--tgcp-accent);'
      + 'box-shadow:0 0 0 3px color-mix(in srgb,var(--tgcp-accent) 20%,transparent);}'
      + '.tgcp-badge{flex:none;width:44px;height:44px;border-radius:50%;'
      + 'display:inline-flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;}'
      + '.tgcp-tbody{flex:1 1 auto;min-width:0;max-width:100%;}'
      // display:block is the fix, not decoration. These are spans inside a
      // button, and their parent is a plain block rather than a flex box, so
      // they stay INLINE — where overflow:hidden and text-overflow:ellipsis do
      // nothing at all and the nowrap meta line simply runs off the page.
      + '.tgcp-tname{display:block;font-size:14.5px;font-weight:600;line-height:1.3;overflow-wrap:anywhere;}'
      + '.tgcp-tmeta{display:block;font-size:12px;color:var(--tgcp-mute);'
      + 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}'

      // The expanded panel. It sits under the grid rather than replacing it, so
      // a visitor can compare clubs without losing their place.
      + '.tgcp-panel{margin-top:16px;padding:16px;background:var(--tgcp-bg2);'
      + 'border:1px solid var(--tgcp-border);border-radius:var(--tgcp-radius);}'
      + '.tgcp-phead{display:flex;align-items:center;gap:12px;margin-bottom:14px;flex-wrap:wrap;}'
      + '.tgcp-ptitle{flex:1;min-width:0;font-size:17px;font-weight:700;letter-spacing:-.01em;}'
      + '.tgcp-pmeta{font-size:12.5px;color:var(--tgcp-mute);font-weight:400;}'
      + '.tgcp-close{flex:none;display:inline-flex;align-items:center;gap:6px;min-height:36px;padding:0 12px;'
      + 'border:1px solid var(--tgcp-border);border-radius:calc(var(--tgcp-radius) - 4px);'
      + 'background:var(--tgcp-bg);color:var(--tgcp-sub);font:inherit;font-size:12.5px;cursor:pointer;}'
      + '.tgcp-close:hover{color:var(--tgcp-text);}'
      + '.tgcp-close svg{width:14px;height:14px;}'

      // Visitor Home/Away filter (segmented, shown only when a team has both).
      + '.tgcp-hafilter{display:inline-flex;margin:0 0 12px;border:1px solid var(--tgcp-border);'
      + 'border-radius:calc(var(--tgcp-radius) - 4px);overflow:hidden;background:var(--tgcp-bg);}'
      + '.tgcp-hf{padding:0 14px;min-height:36px;font:inherit;font-size:12.5px;font-weight:600;'
      + 'color:var(--tgcp-sub);background:transparent;border:0;border-right:1px solid var(--tgcp-border);'
      + 'cursor:pointer;white-space:nowrap;transition:background .15s ease-out,color .15s ease-out;}'
      + '.tgcp-hf:last-child{border-right:0;}'
      + '.tgcp-hf:hover{color:var(--tgcp-text);}'
      + '.tgcp-hf.is-on{background:var(--tgcp-accent);color:var(--tgcp-on-accent);}'
      + '.tgcp-hf:focus-visible{outline:2px solid var(--tgcp-accent);outline-offset:-2px;}'

      + '.tgcp-list{display:flex;flex-direction:column;gap:8px;}'
      + '.tgcp-row{min-width:0;display:grid;grid-template-columns:56px minmax(0,1fr) auto;gap:12px;align-items:center;'
      + 'padding:11px 12px;background:var(--tgcp-bg);border:1px solid var(--tgcp-border);'
      + 'border-radius:calc(var(--tgcp-radius) - 2px);}'
      + '.tgcp-date{text-align:center;padding:4px 0;background:var(--tgcp-bg3);'
      + 'border-radius:calc(var(--tgcp-radius) - 6px);line-height:1.15;font-variant-numeric:tabular-nums;}'
      + '.tgcp-dow{display:block;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--tgcp-mute);}'
      + '.tgcp-day{display:block;font-size:19px;font-weight:700;}'
      + '.tgcp-mon{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--tgcp-sub);}'
      + '.tgcp-rmain{min-width:0;}'
      + '.tgcp-rtitle{margin:0 0 2px;font-size:14.5px;font-weight:600;line-height:1.3;overflow-wrap:anywhere;}'
      + '.tgcp-rmeta{display:flex;flex-wrap:wrap;gap:4px 12px;align-items:center;font-size:12.5px;color:var(--tgcp-sub);}'
      + '.tgcp-rmeta svg{width:13px;height:13px;flex:none;color:var(--tgcp-mute);vertical-align:-2px;}'
      + '.tgcp-rmeta span{display:inline-flex;align-items:center;gap:4px;}'
      + '.tgcp-chip{display:inline-flex;padding:1px 8px;border-radius:999px;background:var(--tgcp-bg3);'
      + 'color:var(--tgcp-sub);font-size:11px;font-weight:500;white-space:nowrap;}'

      + '.tgcp-actions{display:flex;flex-wrap:wrap;gap:6px;}'
      + '.tgcp-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:42px;'
      + 'padding:0 14px;border-radius:calc(var(--tgcp-radius) - 4px);border:1px solid transparent;'
      + 'background:var(--tgcp-accent);color:var(--tgcp-on-accent);font:inherit;font-size:13px;font-weight:600;'
      + 'text-decoration:none;cursor:pointer;white-space:nowrap;transition:filter .16s ease-out;}'
      + '.tgcp-btn:hover{filter:brightness(.93);}'
      + '.tgcp-btn svg{width:13px;height:13px;}'
      + '.tgcp-btn2{background:var(--tgcp-bg);border-color:var(--tgcp-border);color:var(--tgcp-text);}'
      + '.tgcp-btn2:hover{background:var(--tgcp-bg3);filter:none;}'
      + '.tgcp-btn:focus-visible,.tgcp-close:focus-visible{outline:2px solid var(--tgcp-accent);outline-offset:2px;}'

      + '.tgcp-state{padding:26px 18px;text-align:center;color:var(--tgcp-sub);background:var(--tgcp-bg);'
      + 'border:1px dashed var(--tgcp-border);border-radius:var(--tgcp-radius);}'
      + '.tgcp-state svg{width:24px;height:24px;color:var(--tgcp-mute);margin-bottom:6px;}'
      + '.tgcp-state p{margin:0;}'
      + '.tgcp-skel{height:72px;border-radius:var(--tgcp-radius);'
      + 'background:linear-gradient(90deg,var(--tgcp-bg3) 25%,var(--tgcp-bg2) 50%,var(--tgcp-bg3) 75%);'
      + 'background-size:200% 100%;animation:tgcp-sh 1.4s ease-in-out infinite;}'
      + '@keyframes tgcp-sh{0%{background-position:200% 0}100%{background-position:-200% 0}}'

      + '@container (max-width:520px){'
      + '.tgcp-grid{grid-template-columns:minmax(0,1fr);}'
      + '.tgcp-row{grid-template-columns:48px minmax(0,1fr);row-gap:9px;}'
      + '.tgcp-actions{grid-column:1/-1;}.tgcp-btn{flex:1 1 auto;}}'
      + '@media (prefers-reduced-motion:reduce){.tgcp-root *{animation-duration:.01ms !important;'
      + 'animation-iteration-count:1 !important;transition-duration:.01ms !important;}}';
  }

  function TGClubPickerWidget(container, config) {
    this.el = container;
    this.cfg = Object.assign({}, DEFAULTS, config || {});
    this.shadow = container.shadowRoot || container.attachShadow({ mode: 'open' });
    flyInit(this);
    this.entities = null;
    this.gridState = 'loading';
    this.openKey = null;
    this.openLabel = '';
    this.events = null;
    this.eventsState = 'idle';
    this._side = 'all';           // visitor Home/Away filter (client-side)
    this._gridReq = 0;
    this._eventsReq = 0;
    this._render();
    this._loadGrid();
  }

  TGClubPickerWidget.prototype._theme = function () {
    var t = this.cfg.theme;
    if (t === 'dark') return 'dark';
    if (t === 'auto') {
      try { return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; }
      catch (e) { return 'light'; }
    }
    return 'light';
  };

  /** The grid query. Only the things that change it belong here. */
  TGClubPickerWidget.prototype._gridQuery = function () {
    var c = this.cfg;
    var view = c.gridOf === 'performer' ? 'performers' : c.gridOf === 'venue' ? 'venues' : 'teams';
    var q = { view: view, limit: String(clampInt(c.maxEntities, 1, 200, 40)) };
    // Only the team directory can be narrowed by competition; the others have
    // no competition to be narrowed by.
    if (c.gridOf === 'team' && c.competition) q.competition = c.competition;
    return q;
  };

  TGClubPickerWidget.prototype._loadGrid = function () {
    var self = this;
    var mine = ++this._gridReq;
    var q = this._gridQuery();

    if (this.cfg.gridOf === 'team' && !this.cfg.competition) {
      this.entities = [];
      this.gridState = 'unset';
      this._render();
      return;
    }

    this.gridState = 'loading';
    this._render();

    var qs = Object.keys(q).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(q[k]); }).join('&');
    fetch(FEED_API + '?' + qs, { headers: { Accept: 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error('failed'); return r.json(); })
      .then(function (d) {
        if (mine !== self._gridReq) return;
        var items = (d && d.items) || [];
        // A category filter on artists or venues is applied client-side: the
        // directory endpoints do not take one, and the alternative is a second
        // round trip for a filter most embeds will not use.
        if (self.cfg.category && self.cfg.gridOf !== 'team') {
          items = items.filter(function (x) {
            return (x.categories || []).indexOf(self.cfg.category) !== -1;
          });
        }
        self.entities = items;
        self.gridState = items.length ? 'ready' : 'empty';
        self._render();
      })
      .catch(function () {
        if (mine !== self._gridReq) return;
        self.entities = [];
        self.gridState = 'error';
        self._render();
      });
  };

  TGClubPickerWidget.prototype._loadEvents = function (key) {
    var self = this;
    var mine = ++this._eventsReq;
    var c = this.cfg;
    var view = c.gridOf === 'performer' ? 'performer' : c.gridOf === 'venue' ? 'venue' : 'team';

    var q = {
      view: view, key: key,
      limit: String(clampInt(c.eventLimit, 1, 50, 8)),
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
    if (view === 'team') {
      if (c.side === 'home' || c.side === 'away') q.side = c.side;
      if (c.competition) q.competition = c.competition;
    }

    this.eventsState = 'loading';
    this._render();

    var qs = Object.keys(q).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(q[k]); }).join('&');
    fetch(FEED_API + '?' + qs, { headers: { Accept: 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error('failed'); return r.json(); })
      .then(function (d) {
        if (mine !== self._eventsReq) return;
        self.events = (d && d.events) || [];
        self.eventsState = self.events.length ? 'ready' : 'empty';
        self._render();
      })
      .catch(function () {
        if (mine !== self._eventsReq) return;
        self.events = [];
        self.eventsState = 'error';
        self._render();
      });
  };

  TGClubPickerWidget.prototype._tileHtml = function (x) {
    var c = this.cfg;
    var open = this.openKey === x.key;
    var h = typeof x.hue === 'number' ? x.hue : 210;
    var badge = c.showBadges
      ? '<span class="tgcp-badge" aria-hidden="true" style="background:hsl(' + h + ' 48% var(--tgcp-badge-l));'
        + 'color:hsl(' + h + ' 62% var(--tgcp-badge-t))">' + esc(x.initials || '??') + '</span>'
      : '';

    var meta = [];
    if (c.showCounts) {
      var n = c.gridOf === 'performer' ? x.events + ' dates'
        : c.gridOf === 'venue' ? x.events + ' events'
          : (x.home + x.away) + ' games';
      meta.push(n);
    }
    if (c.showHomeVenue && c.gridOf === 'team' && x.homeVenueName) meta.push(x.homeVenueName);
    if (c.showHomeVenue && c.gridOf === 'performer' && x.topLocation) meta.push(x.topLocation);

    return '<button class="tgcp-tile" type="button" data-key="' + esc(x.key) + '"'
      + ' aria-expanded="' + (open ? 'true' : 'false') + '"'
      + ' aria-controls="tgcp-panel"'
      + ' title="' + esc(x.name + (meta.length ? ' — ' + meta.join(' · ') : '')) + '">'
      + badge
      + '<span class="tgcp-tbody"><span class="tgcp-tname">' + esc(x.name) + '</span>'
      + (meta.length ? '<span class="tgcp-tmeta">' + esc(meta.join(' · ')) + '</span>' : '')
      + '</span></button>';
  };

  TGClubPickerWidget.prototype._rowHtml = function (ev) {
    var c = this.cfg;
    var p = dateParts(ev.startDate);
    var meta = [];
    if (c.showTime) {
      if (ev.timeKnown && ev.startTime) meta.push('<span>' + icon('clock') + esc(ev.startTime) + '</span>');
      else meta.push('<span class="tgcp-chip">Time TBC</span>');
    }
    if (c.showVenue && ev.venue && ev.venue.name) meta.push('<span>' + icon('pin') + esc(ev.venue.name) + '</span>');
    if (ev.competitionLabel) meta.push('<span class="tgcp-chip">' + esc(ev.competitionLabel) + '</span>');

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
        return '<button type="button" class="tgcp-btn' + (i > 0 ? ' tgcp-btn2' : '') + '"'
          + ' data-fly="' + esc(o.fly) + '" aria-haspopup="dialog"'
          + ' aria-label="' + esc(label + ': ' + (ev.title || 'event')) + '">'
          + esc(label) + icon('ext') + '</button>';
      }
      return '<a class="tgcp-btn' + (i > 0 ? ' tgcp-btn2' : '') + '" href="' + esc(safeUrl(o.url)) + '"'
        + ' target="_blank" rel="noopener noreferrer"'
        + ' aria-label="' + esc(label + ': ' + (ev.title || 'event')) + '">' + esc(label) + icon('ext') + '</a>';
    }).join('');

    return '<article class="tgcp-row">'
      + (p ? '<div class="tgcp-date"><span class="tgcp-dow">' + esc(p.dow) + '</span>'
        + '<span class="tgcp-day">' + esc(String(p.d)) + '</span>'
        + '<span class="tgcp-mon">' + esc(p.mon) + '</span></div>'
        : '<div class="tgcp-date"><span class="tgcp-mon">TBC</span></div>')
      + '<div class="tgcp-rmain"><h4 class="tgcp-rtitle">' + esc(ev.title || 'Event') + '</h4>'
      + '<div class="tgcp-rmeta">' + meta.join('') + '</div></div>'
      + (actions ? '<div class="tgcp-actions">' + actions + '</div>' : '')
      + '</article>';
  };

  TGClubPickerWidget.prototype._panelHtml = function () {
    if (!this.openKey) return '';
    var body;

    if (this.eventsState === 'loading') {
      body = '<div class="tgcp-list" aria-busy="true"><div class="tgcp-skel"></div><div class="tgcp-skel"></div></div>';
    } else if (this.eventsState === 'error') {
      body = '<div class="tgcp-state" role="status">' + icon('cal') + '<p>Could not load those events. Please try again shortly.</p></div>';
    } else if (!this.events || !this.events.length) {
      body = '<div class="tgcp-state" role="status">' + icon('cal') + '<p>Nothing coming up for them just yet.</p></div>';
    } else {
      var self = this;
      var evs = this.events;
      var filterHtml = '';
      // Home/Away filter — only for a team, and only when there is actually a
      // split to filter (both home AND away games are present in the loaded set).
      if (this.cfg.gridOf === 'team' && this.openKey) {
        var tk = this.openKey, homeN = 0, awayN = 0;
        for (var i = 0; i < evs.length; i++) {
          var s = sideOf(evs[i], tk);
          if (s === 'home') homeN++; else if (s === 'away') awayN++;
        }
        if (homeN > 0 && awayN > 0) {
          var sv = (this._side === 'home' || this._side === 'away') ? this._side : 'all';
          var hf = function (v, label, on) {
            return '<button type="button" class="tgcp-hf' + (on ? ' is-on' : '') + '" data-side="' + v + '"'
              + ' aria-pressed="' + (on ? 'true' : 'false') + '">' + label + '</button>';
          };
          filterHtml = '<div class="tgcp-hafilter" role="group" aria-label="Home or away">'
            + hf('all', 'All', sv === 'all')
            + hf('home', 'Home (' + homeN + ')', sv === 'home')
            + hf('away', 'Away (' + awayN + ')', sv === 'away')
            + '</div>';
          if (sv === 'home') evs = evs.filter(function (e) { return sideOf(e, tk) === 'home'; });
          else if (sv === 'away') evs = evs.filter(function (e) { return sideOf(e, tk) === 'away'; });
        }
      }
      body = filterHtml + '<div class="tgcp-list">' + evs.map(function (e) { return self._rowHtml(e); }).join('') + '</div>';
    }

    var count = (this.events && this.events.length)
      ? '<span class="tgcp-pmeta">' + esc(this.events.length + (this.events.length === 1 ? ' event' : ' events')) + '</span>'
      : '';

    return '<section class="tgcp-panel" id="tgcp-panel" tabindex="-1" aria-live="polite">'
      + '<div class="tgcp-phead">'
      + '<h3 class="tgcp-ptitle">' + esc(this.openLabel) + ' ' + count + '</h3>'
      + '<button class="tgcp-close" type="button" data-close="1">' + icon('back') + 'All ' + esc(this._noun()) + '</button>'
      + '</div>' + body + '</section>';
  };

  TGClubPickerWidget.prototype._noun = function () {
    return this.cfg.gridOf === 'performer' ? 'artists' : this.cfg.gridOf === 'venue' ? 'venues' : 'clubs';
  };

  /** The count line for an entity, shared by the grid tile and the dropdown. */
  TGClubPickerWidget.prototype._countLabel = function (x) {
    return this.cfg.gridOf === 'performer' ? x.events + ' dates'
      : this.cfg.gridOf === 'venue' ? x.events + ' events'
        : (x.home + x.away) + ' games';
  };

  /** The dropdown selector — an alternative (or companion) to the badge grid. */
  TGClubPickerWidget.prototype._selectHtml = function () {
    var c = this.cfg;
    var self = this;
    var placeholder = c.prompt || ('Choose a ' + this._noun().replace(/s$/, ''));
    var opts = '<option value="" disabled' + (this.openKey ? '' : ' selected') + '>' + esc(placeholder) + '</option>';
    opts += (this.entities || []).map(function (x) {
      var label = x.name + (c.showCounts ? ' (' + self._countLabel(x) + ')' : '');
      return '<option value="' + esc(x.key) + '"' + (self.openKey === x.key ? ' selected' : '') + '>' + esc(label) + '</option>';
    }).join('');
    return '<div class="tgcp-selwrap"><select class="tgcp-select" aria-label="' + esc(placeholder) + '">'
      + opts + '</select>' + icon('chev', 'tgcp-selchev') + '</div>';
  };

  TGClubPickerWidget.prototype._render = function () {
    var c = this.cfg;
    var head = '';
    if (c.heading || c.subheading) {
      head = '<div class="tgcp-head">'
        + (c.heading ? '<h2 class="tgcp-h">' + esc(c.heading) + '</h2>' : '')
        + (c.subheading ? '<p class="tgcp-sub">' + esc(c.subheading) + '</p>' : '')
        + '</div>';
    }

    var grid;
    if (this.gridState === 'loading') {
      grid = '<div class="tgcp-grid" aria-busy="true">'
        + '<div class="tgcp-skel"></div><div class="tgcp-skel"></div><div class="tgcp-skel"></div>'
        + '<div class="tgcp-skel"></div><div class="tgcp-skel"></div><div class="tgcp-skel"></div></div>';
    } else if (this.gridState === 'unset') {
      grid = '<div class="tgcp-state" role="status">' + icon('cal')
        + '<p>Choose a competition and its clubs will appear here.</p></div>';
    } else if (this.gridState === 'error') {
      grid = '<div class="tgcp-state" role="status">' + icon('cal')
        + '<p>Could not load the list. Please try again shortly.</p></div>';
    } else if (!this.entities || !this.entities.length) {
      grid = '<div class="tgcp-state" role="status">' + icon('cal')
        + '<p>Nothing to show here just yet.</p></div>';
    } else {
      var self = this;
      var mode = (c.selectorMode === 'dropdown' || c.selectorMode === 'both') ? c.selectorMode : 'grid';
      var gridHtml = '<div class="tgcp-grid">' + this.entities.map(function (x) { return self._tileHtml(x); }).join('') + '</div>';
      if (mode === 'dropdown') {
        // The dropdown's placeholder option carries the prompt, so no paragraph.
        grid = this._selectHtml();
      } else if (mode === 'both') {
        grid = this._selectHtml() + gridHtml;
      } else {
        grid = (c.prompt ? '<p class="tgcp-prompt">' + esc(c.prompt) + '</p>' : '') + gridHtml;
      }
    }

    this.shadow.innerHTML = '<style>' + styles(c) + FLY_CSS + '</style>'
      + '<div class="tgcp-root" data-theme="' + esc(this._theme()) + '">'
      + head + grid + this._panelHtml() + '</div>';

    this._bind();
  };

  // Open an entity's fixtures by key. Shared by a grid-tile click and a dropdown
  // change so both selectors behave identically. Focus moves to the panel ONLY
  // from a real user action here — never a passive re-render (an editor calls
  // update() per keystroke and a focus grab would steal the cursor).
  TGClubPickerWidget.prototype._openEntity = function (key) {
    this._side = 'all';           // a fresh club starts on "All games"
    var found = null;
    for (var j = 0; j < (this.entities || []).length; j++) {
      if (this.entities[j].key === key) { found = this.entities[j]; break; }
    }
    this.openKey = key;
    this.openLabel = found ? found.name : key;
    this.events = null;
    this._loadEvents(key);
    this._focusPanel();
  };

  TGClubPickerWidget.prototype._bind = function () {
    var self = this;
    var tiles = this.shadow.querySelectorAll('.tgcp-tile');
    for (var i = 0; i < tiles.length; i++) {
      tiles[i].addEventListener('click', function () {
        var key = this.getAttribute('data-key');
        if (self.openKey === key) { self._close(); return; }
        self._openEntity(key);
      });
    }
    var sel = this.shadow.querySelector('.tgcp-select');
    if (sel) sel.addEventListener('change', function () {
      var key = this.value;
      if (key && self.openKey !== key) self._openEntity(key);
    });
    var hfs = this.shadow.querySelectorAll('.tgcp-hf');
    for (var h = 0; h < hfs.length; h++) {
      hfs[h].addEventListener('click', function () {
        var side = this.getAttribute('data-side') || 'all';
        if (self._side === side) return;
        self._side = side;
        self._render();   // client-side re-filter of the already-loaded events, no refetch
      });
    }
    var close = this.shadow.querySelector('[data-close]');
    if (close) close.addEventListener('click', function () { self._close(); });
  };

  TGClubPickerWidget.prototype._focusPanel = function () {
    var self = this;
    setTimeout(function () {
      var panel = self.shadow.getElementById ? self.shadow.getElementById('tgcp-panel')
        : self.shadow.querySelector('#tgcp-panel');
      if (panel && typeof panel.focus === 'function') panel.focus({ preventScroll: true });
    }, 0);
  };

  TGClubPickerWidget.prototype._close = function () {
    var key = this.openKey;
    this.openKey = null;
    this.events = null;
    this.eventsState = 'idle';
    this._side = 'all';
    this._eventsReq++;
    this._render();
    // Send focus back to the badge they came from, not to the top of the page.
    var tile = this.shadow.querySelector('.tgcp-tile[data-key="' + (key || '').replace(/"/g, '') + '"]');
    if (tile && typeof tile.focus === 'function') tile.focus({ preventScroll: true });
  };

  TGClubPickerWidget.prototype.update = function (next) {
    var beforeGrid = JSON.stringify(this._gridQuery());
    var prevOpen = this.openKey;
    this.cfg = Object.assign({}, this.cfg, next || {});
    var afterGrid = JSON.stringify(this._gridQuery());

    if (beforeGrid !== afterGrid) {
      // A different grid means the open entity may not even be in it.
      this.openKey = null;
      this.events = null;
      this.eventsState = 'idle';
      this._loadGrid();
      return;
    }
    if (prevOpen) { this._loadEvents(prevOpen); return; }
    this._render();
  };

  TGClubPickerWidget.prototype.destroy = function () {
    this._gridReq++;
    this._eventsReq++;
    try { this.shadow.innerHTML = ''; } catch (e) { /* detached */ }
  };

  function initOne(node) {
    if (node.getAttribute('data-tg-clubpicker-init') === '1') return;
    node.setAttribute('data-tg-clubpicker-init', '1');
    var inline = node.getAttribute('data-tg-config');
    if (inline) {
      var parsed = null;
      try { parsed = JSON.parse(inline); } catch (e) { parsed = null; }
      new TGClubPickerWidget(node, parsed || {});
      return;
    }
    var id = node.getAttribute('data-tg-id');
    if (!id) { new TGClubPickerWidget(node, {}); return; }
    fetch(CONFIG_API + '?id=' + encodeURIComponent(id), { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { new TGClubPickerWidget(node, (d && (d.config || d)) || {}); })
      .catch(function () { new TGClubPickerWidget(node, {}); });
  }

  function init() {
    var nodes = document.querySelectorAll('[data-tg-widget="clubpicker"]');
    for (var i = 0; i < nodes.length; i++) initOne(nodes[i]);
  }

  window.TGClubPickerWidget = TGClubPickerWidget;
  window.__TG_CLUBPICKER_VERSION__ = VERSION;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}());
