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

  var VERSION = '1.0.0';

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

  function styles(cfg) {
    var accent = safeColour(cfg.accent, DEFAULTS.accent);
    var radius = clampInt(cfg.radius, 0, 28, DEFAULTS.radius);
    var font = safeFont(cfg.fontFamily);
    var stack = (font ? '"' + font + '", ' : '')
      + "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

    return ':host{all:initial;display:block;}'
      + '.tgtm-root{font-family:' + stack + ';'
      + '--tgtm-accent:' + accent + ';--tgtm-radius:' + radius + 'px;'
      + '--tgtm-bg:#FFFFFF;--tgtm-bg2:#F8FAFC;--tgtm-bg3:#F1F5F9;--tgtm-border:#E2E8F0;'
      + '--tgtm-text:#0F172A;--tgtm-sub:#475569;--tgtm-mute:#64748B;--tgtm-on-accent:#04212B;'
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
      + '.tgtm-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:42px;'
      + 'padding:0 14px;border-radius:calc(var(--tgtm-radius) - 4px);border:1px solid transparent;'
      + 'background:var(--tgtm-accent);color:var(--tgtm-on-accent);font:inherit;font-size:13px;'
      + 'font-weight:600;text-decoration:none;cursor:pointer;white-space:nowrap;transition:filter .16s ease-out;}'
      + '.tgtm-btn:hover{filter:brightness(.93);}'
      + '.tgtm-btn svg{width:13px;height:13px;}'
      + '.tgtm-btn2{background:var(--tgtm-bg);border-color:var(--tgtm-border);color:var(--tgtm-text);}'
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
      + '@media (max-width:560px){'
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
    var t = todayParts();
    this.view = { y: t.y, m: t.m };
    this.today = t;
    this.byDay = {};
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
    if (kinds.length) q.booking = kinds.join(',');

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
        var map = {};
        (d.events || []).forEach(function (e) {
          var day = parseInt(String(e.startDate).slice(8, 10), 10);
          if (!map[day]) map[day] = [];
          map[day].push(e);
        });
        self.byDay = map;
        self.state = 'ready';
        // Keep the open day only if it still has anything in it.
        if (self.openDay && !map[self.openDay]) self.openDay = null;
        self._render();
      })
      .catch(function (err) {
        if (mine !== self._reqId) return;
        self.byDay = {};
        self.state = err && err.message === 'not-found' ? 'empty' : 'error';
        self._render();
      });
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
    var usable = opts.filter(function (o) { return safeUrl(o.url); });
    if (!usable.length && ev.booking && safeUrl(ev.booking.url)) {
      usable = [{ kind: 'ticket', short: c.bookLabel, url: ev.booking.url }];
    }
    var actions = usable.map(function (o, i) {
      var label = usable.length === 1 ? c.bookLabel : (o.short || o.label || c.bookLabel);
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
      var open = this.openDay === d;
      var cls = 'tgtm-cell' + (list.length ? ' has-events' : '') + (isToday ? ' is-today' : '');
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
      body = this._gridHtml();
      var any = Object.keys(this.byDay).length;
      if (!any) {
        body += '<div class="tgtm-state" style="margin-top:12px" role="status">'
          + '<p>' + esc(c.emptyText || 'Nothing on this month. Try the next one.') + '</p></div>';
      }
    }

    this.shadow.innerHTML = '<style>' + styles(c) + '</style>'
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
