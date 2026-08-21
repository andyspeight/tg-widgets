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

  var VERSION = '1.0.0';

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
    currency: 'GBP',
    adults: 2,
    fallbackText: '',
    theme: 'light',
    accent: '#00B4D8',
    radius: 16,
    fontFamily: '',
    appId: '',
  };

  var IC = {
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
    var radius = clampInt(cfg.radius, 0, 28, DEFAULTS.radius);
    var font = safeFont(cfg.fontFamily);
    var stack = (font ? '"' + font + '", ' : '')
      + "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

    return ':host{all:initial;display:block;}'
      + '.tgne-root{font-family:' + stack + ';'
      + '--tgne-accent:' + accent + ';--tgne-radius:' + radius + 'px;'
      + '--tgne-bg:#FFFFFF;--tgne-bg2:#F8FAFC;--tgne-bg3:#F1F5F9;--tgne-border:#E2E8F0;'
      + '--tgne-text:#0F172A;--tgne-sub:#475569;--tgne-mute:#64748B;--tgne-on-accent:#04212B;'
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
      + '.tgne-btn:hover{filter:brightness(.93);}'
      + '.tgne-btn:active{transform:scale(.98);}'
      + '.tgne-btn svg{width:15px;height:15px;}'
      + '.tgne-btn2{background:var(--tgne-bg);border-color:var(--tgne-border);color:var(--tgne-text);}'
      + '.tgne-btn2:hover{background:var(--tgne-bg3);filter:none;}'
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

      + '@media (max-width:480px){.tgne-banner .tgne-card{flex-direction:column;align-items:stretch;}'
      + '.tgne-banner .tgne-btn{flex:1 1 auto;}}'
      + '@media (prefers-reduced-motion:reduce){.tgne-root *{animation-duration:.01ms !important;'
      + 'animation-iteration-count:1 !important;transition-duration:.01ms !important;}}';
  }

  function needsValue(t) {
    return t === 'competition' || t === 'team' || t === 'venue' || t === 'performer' || t === 'category';
  }

  function TGNextEventWidget(container, config) {
    this.el = container;
    this.cfg = Object.assign({}, DEFAULTS, config || {});
    this.shadow = container.shadowRoot || container.attachShadow({ mode: 'open' });
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
    if (kinds.length) q.booking = kinds.join(',');

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
    var usable = opts.filter(function (o) { return safeUrl(o.url); });
    if (!usable.length && ev.booking && safeUrl(ev.booking.url)) {
      usable = [{ kind: 'ticket', short: c.bookLabel, url: ev.booking.url }];
    }
    var actions = usable.map(function (o, i) {
      var label = usable.length === 1 ? c.bookLabel : (o.short || o.label || c.bookLabel);
      return '<a class="tgne-btn' + (i > 0 ? ' tgne-btn2' : '') + '" href="' + esc(safeUrl(o.url)) + '"'
        + ' target="_blank" rel="noopener noreferrer"'
        + ' aria-label="' + esc(label + ': ' + (ev.title || 'event')) + '">'
        + esc(label) + icon('ext') + '</a>';
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
    this.shadow.innerHTML = '<style>' + styles(c) + '</style>'
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
