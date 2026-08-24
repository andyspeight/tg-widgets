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

  // A flight package the visitor still needs a departure airport for links
  // via our /fly chooser, which asks and then continues to Travelify.
  function flyUrl(o) {
    if (!o || o.status !== 'needs-origin' || typeof o.urlTemplate !== 'string') return '';
    if (o.urlTemplate.indexOf('https://dl.tvllnk.com/deeplink/') !== 0) return '';
    return ORIGIN + '/fly?d=' + encodeURIComponent(o.urlTemplate);
  }

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
      + '&booking=' + encodeURIComponent((Array.isArray(c.bookingKinds) ? c.bookingKinds : ['ticket']).join(','));
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
      + '--tgvg-text:#0f1720;--tgvg-mute:#5b6875;--tgvg-border:#e3e8ee;--tgvg-on-accent:#fff;}'
      + '.tgvg-root[data-theme="dark"]{--tgvg-bg:#12171d;--tgvg-bg2:#171d24;--tgvg-bg3:#1e252e;'
      + '--tgvg-text:#eef2f6;--tgvg-mute:#9aa7b4;--tgvg-border:#28313b;--tgvg-on-accent:#06121a;}'

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
      + '.tgvg-btn{display:inline-flex;align-items:center;gap:6px;padding:8px 14px;font-size:13px;'
      + 'font-weight:650;color:var(--tgvg-on-accent);background:var(--tgvg-accent);border-radius:10px;'
      + 'text-decoration:none;white-space:nowrap;}'
      + '.tgvg-btn:hover{filter:brightness(.93);}'
      + '.tgvg-btn svg{width:13px;height:13px;}'
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
            var u = safeUrl(o.url) || flyUrl(o);
            return u ? { short: o.short, url: u } : null;
          }).filter(Boolean);
          if (!usable.length && e.booking && safeUrl(e.booking.url)) {
            usable = [{ short: c.bookLabel, url: e.booking.url }];
          }
          out += '<div class="tgvg-ev">'
            + '<div class="tgvg-date"><b>' + esc(e.startDate ? String(+e.startDate.slice(8, 10)) : '') + '</b>'
            + '<span>' + esc(mon.slice(mon.lastIndexOf(' ') + 1)) + '</span></div>'
            + '<div class="tgvg-ev-main"><div class="tgvg-ev-t">' + esc(e.title || 'Event') + '</div>'
            + '<div class="tgvg-ev-m">' + esc(mon) + (meta.length ? ' · ' + meta.join(' · ') : '') + '</div></div>'
            + (usable.length
              ? '<a class="tgvg-btn" href="' + esc(safeUrl(usable[0].url)) + '" target="_blank" rel="noopener noreferrer">'
                + esc(c.bookLabel || usable[0].short || 'Book') + icon('ext') + '</a>'
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
    this.shadow.innerHTML = '<style>' + styles(this.cfg) + '</style>'
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
