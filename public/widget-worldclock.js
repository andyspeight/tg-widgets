/**
 * Travelgenix World Clock Widget v1.0.0
 * Self-contained, embeddable destination-time widget. Zero dependencies,
 * Shadow DOM isolation, works on any site via a single script tag.
 *
 * No API and no key: timezones come from the browser's built-in IANA database
 * via Intl.DateTimeFormat, so every clock is accurate and updates live with no
 * network calls. Shows the local time (and date, and a day/night marker) for
 * any set of destinations.
 *
 * Usage (remote config, default):
 *   <div data-tg-widget="worldclock" data-tg-id="YOUR_WIDGET_ID"></div>
 *   <script src="https://tg-widgets.vercel.app/widget-worldclock.js"></script>
 *
 * Usage (inline config, editor preview):
 *   <div data-tg-widget="worldclock" data-tg-config='{...}'></div>
 *   <script src="https://tg-widgets.vercel.app/widget-worldclock.js"></script>
 */
(function () {
  'use strict';

  const VERSION = '1.0.2';

  // ─── i18n ───────────────────────────────────────────────────
  // Fixed UI chrome only (the default heading and the "same time" offset label).
  // City/place names and IANA timezone IDs are author content / identifiers and
  // are never translated. Time and date formatting stays with Intl. English is
  // the source + fallback.
  const MESSAGES = {
    en: { heading: 'Destination times', sameTime: 'same time' },
    fr: { heading: 'Heures des destinations', sameTime: 'même heure' },
    de: { heading: 'Zeiten der Reiseziele', sameTime: 'gleiche Zeit' },
    es: { heading: 'Horas de los destinos', sameTime: 'misma hora' },
    it: { heading: 'Orari delle destinazioni', sameTime: 'stessa ora' },
    ro: { heading: 'Orele destinațiilor', sameTime: 'aceeași oră' },
  };
  // Uses the shared TGi18n core when present; otherwise an identical inline
  // resolver keeps the widget self-contained.
  function makeT(cfg) {
    if (typeof window !== 'undefined' && window.TGi18n && typeof window.TGi18n.make === 'function') return window.TGi18n.make(MESSAGES, cfg);
    const supported = Object.keys(MESSAGES);
    const baseOf = (r) => (r ? String(r).toLowerCase().replace(/_/g, '-').split('-')[0] : '');
    let cands = [];
    if (cfg) cands.push(cfg.lang, cfg.language, cfg.locale);
    try { cands.push(document.documentElement.getAttribute('lang')); } catch (e) { /* noop */ }
    try { if (navigator.languages) cands = cands.concat(navigator.languages); cands.push(navigator.language); } catch (e) { /* noop */ }
    let lang = 'en';
    for (let i = 0; i < cands.length; i++) { const b = baseOf(cands[i]); if (b && supported.indexOf(b) !== -1) { lang = b; break; } }
    const dict = MESSAGES[lang] || MESSAGES.en;
    const t = (k, vars) => {
      let s = Object.prototype.hasOwnProperty.call(dict, k) ? dict[k] : (MESSAGES.en[k] || k);
      if (vars) s = String(s).replace(/\{(\w+)\}/g, (m, n) => (vars[n] != null ? vars[n] : m));
      return s;
    };
    t.lang = lang; t.dir = 'ltr';
    return t;
  }

  function resolveConfigApi() {
    if (typeof window === 'undefined') return '/api/widget-config';
    if (window.__TG_WIDGET_API__) return window.__TG_WIDGET_API__;
    try {
      const me = document.currentScript;
      if (me && me.src) return new URL(me.src).origin + '/api/widget-config';
      const scripts = document.getElementsByTagName('script');
      for (let i = scripts.length - 1; i >= 0; i--) {
        const s = scripts[i].src || '';
        if (/\/widget-worldclock\.js(\?|$|#)/.test(s)) return new URL(s).origin + '/api/widget-config';
      }
    } catch (e) { /* fall through */ }
    return '/api/widget-config';
  }
  const CONFIG_API = resolveConfigApi();

  // Curated travel destinations the editor offers. The widget will also accept
  // any valid IANA tz in a saved config.
  const DEFAULT_DESTS = [
    { label: 'London', tz: 'Europe/London', cc: 'GB' },
    { label: 'New York', tz: 'America/New_York', cc: 'US' },
    { label: 'Dubai', tz: 'Asia/Dubai', cc: 'AE' },
    { label: 'Sydney', tz: 'Australia/Sydney', cc: 'AU' },
  ];

  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hexOk = (v) => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(v || '').trim());
  // A font-family value is interpolated into the shadow <style> block, so it must
  // never carry CSS-breakout characters ( < > { } ; : ( ) etc). Allow only what a
  // real font-family stack needs — names, spaces, commas and quotes — otherwise
  // fall back. Prevents a saved fontFamily like `x}</style><img onerror=...>` from
  // escaping the style element and executing on the client's page.
  const safeFontStack = (v, fb) => {
    const s = String(v == null ? '' : v).trim();
    return (s && s.length <= 120 && /^[A-Za-z0-9 ,"'-]+$/.test(s)) ? s : fb;
  };

  function flagFor(cc) {
    const c = String(cc || '').slice(0, 2).toUpperCase();
    if (!/^[A-Z]{2}$/.test(c)) return '';
    return String.fromCodePoint(...[...c].map(ch => 0x1F1E6 + ch.charCodeAt(0) - 65));
  }

  // Validate an IANA zone by trying to format with it.
  function tzValid(tz) {
    try { new Intl.DateTimeFormat('en-GB', { timeZone: tz }); return true; }
    catch (e) { return false; }
  }

  // Minutes a zone is offset from UTC at the given instant.
  function tzOffsetMin(tz, date) {
    const dtf = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const p = dtf.formatToParts(date).reduce((a, x) => { a[x.type] = x.value; return a; }, {});
    const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    return Math.round((asUTC - date.getTime()) / 60000);
  }

  const SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  const MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';

  class TGWorldClockWidget {
    constructor(el, config) {
      this.el = el;
      this.cfg = this._defaults(config || {});
      this.t = makeT(this.cfg);   // resolve viewer language + UI strings
      this.rows = [];
      this._timer = null;
      this.shadow = el.attachShadow ? el.attachShadow({ mode: 'open' }) : el;
      el.setAttribute('data-tg-initialised', '1');
      this._build();
      this._tick();
      // Update once a second when seconds are shown, otherwise every 10s.
      this._timer = setInterval(() => this._tick(), this.cfg.showSeconds ? 1000 : 10000);
    }

    _defaults(c) {
      let dests = Array.isArray(c.destinations) ? c.destinations : null;
      if (dests) {
        dests = dests
          .filter(d => d && typeof d.tz === 'string' && tzValid(d.tz))
          .map(d => ({ label: String(d.label || d.tz).slice(0, 40), tz: d.tz, cc: String(d.cc || '').slice(0, 2).toUpperCase() }))
          .slice(0, 12);
      }
      if (!dests || !dests.length) dests = DEFAULT_DESTS.slice();
      return {
        heading: typeof c.heading === 'string' ? c.heading : '',
        destinations: dests,
        use24h: !!c.use24h,
        showDate: c.showDate !== false,
        showSeconds: !!c.showSeconds,
        showDayNight: c.showDayNight !== false,
        showOffset: !!c.showOffset,
        layout: ['grid', 'card', 'list'].includes(c.layout) ? c.layout : 'list',
        accent: hexOk(c.accent) ? c.accent : '#0891B2',
        showFlags: c.showFlags !== false,
        theme: c.theme === 'dark' ? 'dark' : 'light',
        fontFamily: safeFontStack(c.fontFamily, 'Inter, system-ui, sans-serif'),
        previewMode: !!c.previewMode,
      };
    }

    _build() {
      const c = this.cfg;
      const dark = c.theme === 'dark';
      const ink = dark ? '#F1F5F9' : '#0F172A';
      const ink2 = dark ? '#94A3B8' : '#64748B';
      const panel = dark ? '#0B1220' : '#FFFFFF';
      const border = dark ? '#1E293B' : '#E2E8F0';
      const rowbg = dark ? '#0F172A' : '#F8FAFC';
      const grid = c.layout === 'grid';
      const card = c.layout === 'card';
      const heading = c.heading || this.t('heading');

      this.shadow.innerHTML = `
        <style>
          :host { all: initial; }
          * { box-sizing: border-box; }
          .wc { font-family: ${c.fontFamily}; color: ${ink}; ${card ? `background:${panel};border:1px solid ${border};border-radius:16px;padding:22px;box-shadow:0 1px 3px rgba(15,23,42,.06),0 10px 30px rgba(15,23,42,.04);` : ''} max-width: 520px; }
          .wc-head { font-size: 17px; font-weight: 700; margin: 0 0 14px; letter-spacing: -.01em; }
          .wc-list { display: ${grid ? 'grid' : 'flex'}; ${grid ? 'grid-template-columns:repeat(auto-fill,minmax(150px,1fr));' : 'flex-direction:column;'} gap: 10px; }
          .wc-row { display: flex; align-items: center; gap: 12px; padding: 12px 14px; background: ${rowbg}; border: 1px solid ${border}; border-radius: 12px; ${grid ? 'flex-direction:column;align-items:flex-start;gap:6px;' : ''} }
          .wc-place { display: flex; align-items: center; gap: 8px; min-width: 0; ${grid ? '' : 'flex:1;'} }
          .wc-flag { font-size: 18px; line-height: 1; }
          .wc-label { font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
          .wc-meta { display: flex; align-items: baseline; gap: 8px; ${grid ? '' : 'text-align:right;'} }
          .wc-time { font-size: 20px; font-weight: 800; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
          .wc-sub { font-size: 11px; color: ${ink2}; }
          .wc-dn { width: 15px; height: 15px; color: ${c.accent}; flex-shrink: 0; }
          .wc-dn svg { width: 15px; height: 15px; }
          .wc-right { display: flex; align-items: center; gap: 10px; ${grid ? 'width:100%;justify-content:space-between;' : ''} }
          .wc-off { font-size: 11px; color: ${ink2}; font-variant-numeric: tabular-nums; }
        </style>
        <div class="wc">
          ${heading ? `<h3 class="wc-head">${esc(heading)}</h3>` : ''}
          <div class="wc-list" id="list"></div>
        </div>`;

      const list = this.shadow.getElementById('list');
      this.rows = c.destinations.map(d => {
        const row = document.createElement('div');
        row.className = 'wc-row';
        const flag = (c.showFlags && d.cc) ? `<span class="wc-flag">${flagFor(d.cc)}</span>` : '';
        row.innerHTML = `
          <div class="wc-place">${flag}<span class="wc-label">${esc(d.label)}</span></div>
          <div class="wc-right">
            ${c.showOffset ? '<span class="wc-off" data-role="off"></span>' : ''}
            <div class="wc-meta">
              <span class="wc-time" data-role="time">--:--</span>
              ${c.showDayNight ? '<span class="wc-dn" data-role="dn"></span>' : ''}
            </div>
            ${c.showDate ? '<span class="wc-sub" data-role="date"></span>' : ''}
          </div>`;
        list.appendChild(row);
        return {
          d,
          time: row.querySelector('[data-role="time"]'),
          date: row.querySelector('[data-role="date"]'),
          dn: row.querySelector('[data-role="dn"]'),
          off: row.querySelector('[data-role="off"]'),
        };
      });
    }

    _tick() {
      const c = this.cfg;
      const now = new Date();
      const viewerOff = -now.getTimezoneOffset();
      for (const r of this.rows) {
        const tz = r.d.tz;
        try {
          r.time.textContent = new Intl.DateTimeFormat([], {
            timeZone: tz, hour: '2-digit', minute: '2-digit',
            ...(c.showSeconds ? { second: '2-digit' } : {}), hour12: !c.use24h,
          }).format(now);
          if (r.date) r.date.textContent = new Intl.DateTimeFormat([], { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' }).format(now);
          if (r.dn) {
            const h = parseInt(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(now), 10);
            r.dn.innerHTML = (h >= 6 && h < 19) ? SUN : MOON;
          }
          if (r.off) {
            const diff = (tzOffsetMin(tz, now) - viewerOff) / 60;
            r.off.textContent = Math.abs(diff) < 0.001 ? this.t('sameTime')
              : (diff > 0 ? '+' : '') + (Number.isInteger(diff) ? diff : diff.toFixed(1)) + 'h';
          }
        } catch (e) { r.time.textContent = '--:--'; }
      }
    }

    update(config) {
      if (this._timer) { clearInterval(this._timer); this._timer = null; }
      this.cfg = this._defaults(config || {});
      this.t = makeT(this.cfg);
      this._build();
      this._tick();
      this._timer = setInterval(() => this._tick(), this.cfg.showSeconds ? 1000 : 10000);
    }

    destroy() {
      if (this._timer) { clearInterval(this._timer); this._timer = null; }
      try { this.shadow.innerHTML = ''; } catch (e) {}
      try { this.el.removeAttribute('data-tg-initialised'); } catch (e) {}
    }
  }

  async function init() {
    if (typeof document === 'undefined') return;
    const nodes = document.querySelectorAll('[data-tg-widget="worldclock"]:not([data-tg-initialised])');
    for (const el of nodes) {
      try {
        const inline = el.getAttribute('data-tg-config');
        if (inline) { let cfg = {}; try { cfg = JSON.parse(inline); } catch { cfg = {}; } new TGWorldClockWidget(el, cfg); continue; }
        const id = el.getAttribute('data-tg-id');
        if (id) {
          const res = await fetch(CONFIG_API + '?id=' + encodeURIComponent(id), { credentials: 'omit' });
          if (!res.ok) throw new Error('config ' + res.status);
          const data = await res.json();
          const cfg = (data && (data.config || data)) || {};
          cfg.widgetId = id;
          new TGWorldClockWidget(el, cfg);
          continue;
        }
        console.warn('[TG World Clock] Container has neither data-tg-id nor data-tg-config');
      } catch (err) {
        console.error('[TG World Clock] Failed to initialise:', err);
        try { el.innerHTML = '<p style="color:#64748b;font:14px/1.5 system-ui,sans-serif;padding:16px;text-align:center;border:1px dashed #e2e8f0;border-radius:8px;margin:0">Unable to load World Clock widget</p>'; } catch (e) {}
      }
    }
  }

  if (typeof window !== 'undefined') { window.TGWorldClockWidget = TGWorldClockWidget; window.__TG_WORLDCLOCK_VERSION__ = VERSION; }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
    if (typeof MutationObserver !== 'undefined') {
      try {
        let scheduled = false;
        const schedule = () => { if (scheduled) return; scheduled = true; setTimeout(() => { scheduled = false; init(); }, 120); };
        const mo = new MutationObserver((records) => {
          for (const r of records) for (const node of r.addedNodes) {
            if (node.nodeType !== 1) continue;
            if ((node.matches && node.matches('[data-tg-widget="worldclock"]:not([data-tg-initialised])')) ||
                (node.querySelector && node.querySelector('[data-tg-widget="worldclock"]:not([data-tg-initialised])'))) { schedule(); return; }
          }
        });
        mo.observe(document.body || document.documentElement, { childList: true, subtree: true });
      } catch (e) { /* noop */ }
    }
  }
})();
