/**
 * Travelgenix Event Menu Widget v1.0.0
 * Self-contained, embeddable widget
 * Zero dependencies — works on any website via a single script tag
 *
 * The navigation for a whole ticket section: categories, competitions, clubs,
 * grounds and artists, as a sidebar on desktop and a drawer on a phone.
 *
 * ON LINKS
 * This widget does NOT link to Travelgenix. It links into the CLIENT's own
 * site, using a pattern they set once (/tickets/{type}/{slug} or whatever
 * their pages are called). A menu that navigated away from the site it sits
 * on would be a menu no one would fit. Where a client has no pages yet, the
 * items still work: each one fires a tg:eventmenu:select event on the host
 * element so their own script can take over.
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

  var VERSION = '1.1.0';

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
    linkPattern: '/tickets/{type}/{slug}',
    newTab: false,
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

    this._watchWidth();
    this._render();
    this._load();
  }

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
    return {
      type: type, key: key, name: name, meta: meta, count: count,
      href: href, active: this._isActive(href),
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

  function styles(c) {
    var accent = safeColour(c.accent, '#00B4D8');
    var trigText = safeColour(c.triggerTextColor, '');
    var radius = clamp(c.radius, 0, 24, 12);
    var font = safeFont(c.fontFamily);
    return ':host{all:initial;display:block;}'
      + '*,*::before,*::after{box-sizing:border-box;}'
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
      c.showSearch, c.triggerLabel, c.triggerTextColor].join('~');
  };

  TGEventMenuWidget.prototype._render = function () {
    if (this.mountedKey === this._shellKey()) { this._paint(); return; }
    var c = this.cfg;
    var drawer = this._mode() === 'drawer';

    this.shadow.innerHTML = '<style>' + styles(c) + '</style>'
      + '<div class="tgmn-root" data-theme="' + esc(this._theme()) + '">'
      + (drawer
        ? '<button class="tgmn-trigger" type="button" data-open aria-haspopup="dialog" aria-expanded="false">'
          + icon('menu') + esc(c.triggerLabel || 'Browse events') + '</button>'
        : '<nav class="tgmn-panel" aria-label="' + esc(c.heading || 'Browse events') + '">'
          + this._panelHtml(false) + '</nav>')
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
    this.cfg = Object.assign({}, this.cfg, next || {});
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
