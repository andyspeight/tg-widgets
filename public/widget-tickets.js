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

  var VERSION = '1.0.0';

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
    currency: 'GBP',
    adults: 2,
    emptyText: '',
    theme: 'light',
    accent: '#00B4D8',
    radius: 12,
    fontFamily: '',
    appId: '',
  };

  // ── Icons, as path strings. No external requests, and never an emoji. ──────
  var IC = {
    clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 6v6l4 2',
    pin: 'M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0ZM12 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
    ext: 'M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6',
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
      + '.tgtk-root{container-type:inline-size;'
      + 'font-family:' + stack + ';'
      + '--tgtk-accent:' + accent + ';'
      + '--tgtk-radius:' + radius + 'px;'
      + '--tgtk-bg:#FFFFFF;--tgtk-bg2:#F8FAFC;--tgtk-bg3:#F1F5F9;'
      + '--tgtk-border:#E2E8F0;--tgtk-text:#0F172A;--tgtk-sub:#475569;--tgtk-mute:#64748B;'
      + '--tgtk-on-accent:#04212B;'
      + 'font-size:15px;line-height:1.6;color:var(--tgtk-text);box-sizing:border-box;'
      + '-webkit-font-smoothing:antialiased;}'
      + '.tgtk-root *,.tgtk-root *::before,.tgtk-root *::after{box-sizing:border-box;}'
      + '.tgtk-root[data-theme="dark"]{'
      + '--tgtk-bg:#0F172A;--tgtk-bg2:#1E293B;--tgtk-bg3:#334155;'
      + '--tgtk-border:#334155;--tgtk-text:#F8FAFC;--tgtk-sub:#CBD5E1;--tgtk-mute:#94A3B8;'
      + '--tgtk-on-accent:#04212B;}'

      + '.tgtk-head{margin:0 0 16px;}'
      + '.tgtk-h{margin:0;font-size:22px;line-height:1.25;font-weight:700;letter-spacing:-.01em;}'
      + '.tgtk-sub{margin:4px 0 0;font-size:15px;color:var(--tgtk-sub);}'

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
      + '.tgtk-btn:hover{filter:brightness(.93);}'
      + '.tgtk-btn:active{transform:scale(.97);}'
      + '.tgtk-btn svg{width:14px;height:14px;}'
      + '.tgtk-btn2{background:var(--tgtk-bg);border-color:var(--tgtk-border);color:var(--tgtk-text);}'
      + '.tgtk-btn2:hover{background:var(--tgtk-bg3);filter:none;}'
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
  }

  // ── The widget ────────────────────────────────────────────────────────────

  function TGTicketsWidget(container, config) {
    this.el = container;
    this.cfg = Object.assign({}, DEFAULTS, config || {});
    this.shadow = container.shadowRoot || container.attachShadow({ mode: 'open' });
    this.events = null;
    this.total = 0;
    this.error = null;
    this.loading = true;
    this._reqId = 0;
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
    if (kinds.length) q.booking = kinds.join(',');

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
    var usable = opts.filter(function (o) { return safeUrl(o.url); });
    if (!usable.length && ev.booking && safeUrl(ev.booking.url)) {
      usable = [{ kind: 'ticket', short: c.bookLabel, url: ev.booking.url }];
    }

    var actions;
    if (usable.length) {
      actions = usable.map(function (o, i) {
        var label = usable.length === 1 ? c.bookLabel : (o.short || o.label || c.bookLabel);
        return '<a class="tgtk-btn' + (i > 0 ? ' tgtk-btn2' : '') + '"'
          + ' href="' + esc(safeUrl(o.url)) + '" target="_blank" rel="noopener noreferrer"'
          + ' aria-label="' + esc(label + ': ' + (ev.title || 'event')) + '">'
          + esc(label) + icon('ext') + '</a>';
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
    var cards = this.events.map(function (ev) { return self._cardHtml(ev); }).join('');
    var cls = c.layout === 'cards' ? 'tgtk-grid' : 'tgtk-list';
    return '<div class="' + cls + '">' + cards + '</div>';
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

    this.shadow.innerHTML = '<style>' + styles(c) + '</style>'
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
