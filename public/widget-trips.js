/* ============================================================================
 * widget-trips.js  ·  Travelgenix Widget Suite
 * Group Trips — group booking engine for tailor-made tours (v0.1.0)
 *
 * GT-1 scaffold: renders the trip hero (image, title, dates, location),
 * the description and the pricing strip (price per person, deposit, balance
 * due date) from config. Booking form, live availability and Stripe Checkout
 * arrive in later tickets (GT-3, GT-5, GT-7) — nothing here talks to Stripe
 * or Supabase, and no traveller data exists client-side.
 *
 * Embed:
 *   <div data-tg-widget="trips" data-tg-id="YOUR_WIDGET_ID"></div>
 *   <script src="https://widgets.travelify.io/widget-trips.js" defer></script>
 * or inline (demo / preview):
 *   <div data-tg-widget="trips" data-tg-config='{"trip":{...},"design":{...}}'></div>
 *
 * Config shape (see docs/group-trips — Airtable Config JSON):
 *   {
 *     trip: { title, heroImage, description, startDate, endDate, location,
 *             capacity, currency, pricePence, depositPence, balanceDueDate,
 *             spotsHeldMinutes },
 *     payments: { stripeAccountId, applicationFeePence },   // server-side use
 *     design: { brandColor, accentColor, theme, radius, fontFamily },
 *     emails: { fromName, replyTo, footer }                 // server-side use
 *   }
 * ========================================================================== */
(function () {
  'use strict';

  const VERSION = '0.1.0';

  // Resolve the API base off THIS script's origin. The widget is hosted on
  // widgets.travelify.io and embedded on customer sites, so a relative
  // '/api/...' resolves to the customer origin and 404s. Order: explicit
  // opt-in, then document.currentScript, then a scan for our own script tag.
  function resolveApiBase() {
    if (typeof window === 'undefined') return '/api/widget-config';
    if (window.__TG_WIDGET_API__) return window.__TG_WIDGET_API__;
    try {
      const me = document.currentScript;
      if (me && me.src) return new URL(me.src).origin + '/api/widget-config';
      const scripts = document.getElementsByTagName('script');
      for (let i = scripts.length - 1; i >= 0; i--) {
        const s = scripts[i].src || '';
        if (/\/widget-trips\.js(\?|$|#)/.test(s)) return new URL(s).origin + '/api/widget-config';
      }
    } catch (e) { /* fall through */ }
    return '/api/widget-config';
  }
  const API_BASE = resolveApiBase();
  const AVAIL_URL = API_BASE.replace(/\/widget-config(\/)?$/, '/trip-availability');

  // ── Helpers ────────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Only allow http(s) / protocol-relative / relative URLs through to src.
  function safeUrl(u) {
    if (!u) return '';
    const s = String(u).trim();
    if (/^(https?:)?\/\//i.test(s) || s.startsWith('/') || s.startsWith('#')) return s;
    return '';
  }

  // Colours from config are whitelisted to hex before touching CSSOM.
  function safeHex(v, fb) {
    return (typeof v === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(v.trim())) ? v.trim() : fb;
  }

  // Web-font allowlist — same shape as the suite's other widgets. The name
  // gates the Google Fonts URL, so nothing from config reaches the URL raw.
  const FONTS = {
    'DM Sans':           { w: '400;500;600;700', g: 'system-ui, sans-serif' },
    'Inter':             { w: '400;500;600;700', g: 'system-ui, sans-serif' },
    'Poppins':           { w: '400;500;600;700', g: 'system-ui, sans-serif' },
    'Montserrat':        { w: '400;500;600;700', g: 'system-ui, sans-serif' },
    'Plus Jakarta Sans': { w: '400;500;600;700', g: 'system-ui, sans-serif' },
    'Manrope':           { w: '400;500;600;700', g: 'system-ui, sans-serif' },
    'Sora':              { w: '400;500;600;700', g: 'system-ui, sans-serif' },
    'Outfit':            { w: '400;500;600;700', g: 'system-ui, sans-serif' },
    'Work Sans':         { w: '400;500;600;700', g: 'system-ui, sans-serif' },
    'Cormorant Garamond':{ w: '400;500;600;700', g: 'Georgia, serif' },
    'EB Garamond':       { w: '400;500;600;700', g: 'Georgia, serif' },
  };
  function safeFontName(v, fb) { return (typeof v === 'string' && FONTS[v.trim()]) ? v.trim() : fb; }
  function fontStack(name) { const f = FONTS[name]; return "'" + name + "', " + (f ? f.g : 'system-ui, sans-serif'); }
  function ensureFont(name) {
    if (!name || !FONTS[name] || typeof document === 'undefined') return;
    const id = 'tg-font-' + name.toLowerCase().replace(/\s+/g, '-');
    if (document.getElementById(id)) return;
    const l = document.createElement('link');
    l.id = id; l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=' +
      encodeURIComponent(name).replace(/%20/g, '+') + ':wght@' + FONTS[name].w + '&display=swap';
    document.head.appendChild(l);
  }

  const CURRENCIES = { gbp: '£', eur: '€', usd: '$' };
  function currencySymbol(code) {
    return CURRENCIES[String(code || 'gbp').toLowerCase()] || '£';
  }

  // Pence (integer, clamped) → "£1,899". Fractional pence render as e.g.
  // "£1,899.50" only when the amount isn't whole pounds.
  function money(sym, pence) {
    const n = Number(pence);
    if (!isFinite(n) || n < 0) return '';
    const major = n / 100;
    const whole = Math.round(major) === major;
    return sym + major.toLocaleString('en-GB', {
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: 2,
    });
  }

  // 'YYYY-MM-DD' → local Date at midnight (no UTC parsing surprises), or null.
  function parseDay(s) {
    const m = String(s || '').trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!m) return null;
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    return isNaN(d.getTime()) ? null : d;
  }
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmtDay(d) { return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear(); }
  // "10–17 May 2027" / "28 May – 4 Jun 2027" / "28 Dec 2027 – 4 Jan 2028"
  function fmtRange(a, b) {
    if (!a && !b) return '';
    if (!b) return fmtDay(a);
    if (!a) return fmtDay(b);
    if (a.getFullYear() === b.getFullYear()) {
      if (a.getMonth() === b.getMonth()) {
        return a.getDate() + '–' + b.getDate() + ' ' + MONTHS[a.getMonth()] + ' ' + a.getFullYear();
      }
      return a.getDate() + ' ' + MONTHS[a.getMonth()] + ' – ' + b.getDate() + ' ' + MONTHS[b.getMonth()] + ' ' + a.getFullYear();
    }
    return fmtDay(a) + ' – ' + fmtDay(b);
  }

  const IC = {
    pin: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
    cal: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
    users: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  };

  // ── Scoped styles (Shadow DOM, --tgtr-* tokens) ───────────────────────────
  const STYLES = `
    :host { all: initial; display: block; }
    * { box-sizing: border-box; }
    .tgtr-root {
      --tgtr-brand: #EA580C; --tgtr-brand-hover: #C2410C;
      --tgtr-bg: #FFFFFF; --tgtr-alt: #FAFAF9; --tgtr-text: #0F172A;
      --tgtr-sub: #64748B; --tgtr-muted: #94A3B8; --tgtr-border: #E2E8F0;
      --tgtr-success: #10B981; --tgtr-radius: 16px;
      --tgtr-shadow: 0 1px 2px rgba(15,23,42,0.05);
      --tgtr-font: 'DM Sans', system-ui, sans-serif;
      font-family: var(--tgtr-font);
      color: var(--tgtr-text); line-height: 1.55;
      width: 100%; max-width: 100%;
    }
    .tgtr-root[data-theme="dark"] {
      --tgtr-bg: #1E293B; --tgtr-alt: #0F172A; --tgtr-text: #F1F5F9;
      --tgtr-sub: #94A3B8; --tgtr-muted: #64748B; --tgtr-border: #334155;
      --tgtr-shadow: 0 1px 2px rgba(0,0,0,0.3);
    }

    .tgtr-card {
      max-width: 680px; margin: 0 auto; background: var(--tgtr-bg);
      border: 1px solid var(--tgtr-border); border-radius: var(--tgtr-radius);
      overflow: hidden; box-shadow: var(--tgtr-shadow);
    }

    /* Hero image */
    .tgtr-hero { position: relative; aspect-ratio: 16 / 9; background: var(--tgtr-alt); }
    .tgtr-hero img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .tgtr-hero-ph {
      position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
      background: linear-gradient(135deg, var(--tgtr-brand), #F59E0B);
      color: rgba(255,255,255,0.94); font-size: 17px; font-weight: 700;
      letter-spacing: 0.4px; text-align: center; padding: 16px;
    }

    /* Body */
    .tgtr-body { padding: 22px 24px 24px; }
    .tgtr-meta {
      display: flex; flex-wrap: wrap; gap: 6px 16px; align-items: center;
      font-size: 13.5px; color: var(--tgtr-sub); margin: 0 0 8px;
    }
    .tgtr-meta span { display: inline-flex; align-items: center; gap: 6px; }
    .tgtr-meta svg { color: var(--tgtr-brand); flex-shrink: 0; }
    .tgtr-title {
      margin: 0 0 10px; font-size: clamp(22px, 4vw, 28px); font-weight: 700;
      line-height: 1.2; letter-spacing: -0.4px; color: var(--tgtr-text);
    }
    .tgtr-desc { margin: 0; font-size: 15px; color: var(--tgtr-sub); white-space: pre-line; }

    /* Pricing strip */
    .tgtr-pricing {
      display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 14px;
      margin-top: 18px; padding-top: 18px; border-top: 1px solid var(--tgtr-border);
    }
    .tgtr-price { font-size: 26px; font-weight: 800; line-height: 1; color: var(--tgtr-text); }
    .tgtr-price-unit { font-size: 13px; font-weight: 500; color: var(--tgtr-sub); }
    .tgtr-deposit {
      flex-basis: 100%; margin-top: 6px; font-size: 13.5px; color: var(--tgtr-sub);
    }
    .tgtr-deposit strong { color: var(--tgtr-text); font-weight: 600; }

    /* Live availability line (filled in after render, hidden until known) */
    .tgtr-avail { margin-top: 10px; font-size: 13px; font-weight: 600; color: var(--tgtr-sub); }
    .tgtr-avail.is-low { color: var(--tgtr-brand); }
    .tgtr-avail.is-sold { display: inline-block; color: #fff; background: var(--tgtr-muted); padding: 3px 11px; border-radius: 999px; font-size: 12px; letter-spacing: 0.02em; }

    /* Honest closed state: the trip has departed */
    .tgtr-closed {
      margin-top: 16px; padding: 12px 14px; border-radius: 10px;
      background: var(--tgtr-alt); border: 1px solid var(--tgtr-border);
      font-size: 14px; color: var(--tgtr-sub);
    }

    @media (max-width: 420px) {
      .tgtr-body { padding: 18px 16px 20px; }
      .tgtr-price { font-size: 23px; }
    }
    @media (prefers-reduced-motion: reduce) {
      .tgtr-root * { transition: none !important; animation: none !important; }
    }
  `;

  // ── Widget class ──────────────────────────────────────────────────────────
  class TGTripsWidget {
    constructor(container, config) {
      this.el = container;
      container._tgInitialised = true;
      container._tgWidget = this;   // host pages can reach update() after auto-init
      this.cfg = this._defaults(config);
      // The public widget id — used to look up live availability. From
      // data-tg-id (real embed) or config._widgetId (loader). Absent in
      // inline/demo/editor-preview mode, where availability simply isn't shown.
      this.widgetId = this.cfg._widgetId || container.getAttribute('data-tg-id') || '';
      this.shadow = container.attachShadow({ mode: 'open' });
      this._render();
    }

    _defaults(c) {
      c = c || {};
      const trip = (c.trip && typeof c.trip === 'object') ? c.trip : {};
      const design = (c.design && typeof c.design === 'object') ? c.design : {};
      return {
        trip: {
          title: typeof trip.title === 'string' ? trip.title : '',
          heroImage: safeUrl(trip.heroImage),
          description: typeof trip.description === 'string' ? trip.description : '',
          startDate: typeof trip.startDate === 'string' ? trip.startDate : '',
          endDate: typeof trip.endDate === 'string' ? trip.endDate : '',
          location: typeof trip.location === 'string' ? trip.location : '',
          capacity: Math.max(0, Math.min(500, parseInt(trip.capacity, 10) || 0)),
          currency: typeof trip.currency === 'string' ? trip.currency : 'gbp',
          pricePence: Math.max(0, parseInt(trip.pricePence, 10) || 0),
          depositPence: Math.max(0, parseInt(trip.depositPence, 10) || 0),
          balanceDueDate: typeof trip.balanceDueDate === 'string' ? trip.balanceDueDate : '',
          spotsHeldMinutes: Math.max(5, Math.min(1440, parseInt(trip.spotsHeldMinutes, 10) || 30)),
        },
        design: {
          brandColor: safeHex(design.brandColor, ''),
          theme: design.theme === 'dark' ? 'dark' : 'light',
          radius: typeof design.radius === 'number' ? Math.max(0, Math.min(32, design.radius)) : 16,
          fontFamily: safeFontName(design.fontFamily, 'DM Sans'),
        },
        _widgetId: typeof c._widgetId === 'string' ? c._widgetId : '',
      };
    }

    _render() {
      const t = this.cfg.trip;
      const d = this.cfg.design;

      // Unconfigured: render nothing, quietly. A half-empty booking card on a
      // live customer page helps nobody — the editor preview supplies real
      // config, and the API always returns the saved trip.
      if (!t.title) {
        this.shadow.innerHTML = '';
        this.el.setAttribute('data-tg-hidden', 'unconfigured');
        return;
      }
      this.el.removeAttribute('data-tg-hidden');

      ensureFont(d.fontFamily);

      const start = parseDay(t.startDate);
      const end = parseDay(t.endDate);
      const dates = fmtRange(start, end);
      const sym = currencySymbol(t.currency);
      const price = money(sym, t.pricePence);
      const deposit = money(sym, t.depositPence);
      const balancePence = Math.max(0, t.pricePence - t.depositPence);
      const balance = money(sym, balancePence);
      const balanceDue = parseDay(t.balanceDueDate);

      // The trip has departed once its end date (or start date if no end) is
      // behind today. Render honestly — no booking chrome, no false urgency.
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const departed = !!((end || start) && (end || start).getTime() < today.getTime());

      const meta = [
        dates ? '<span data-role="dates">' + IC.cal + esc(dates) + '</span>' : '',
        t.location ? '<span data-role="location">' + IC.pin + esc(t.location) + '</span>' : '',
        t.capacity ? '<span data-role="capacity">' + IC.users + esc('Group of ' + t.capacity) + '</span>' : '',
      ].join('');

      const heroImg = t.heroImage
        ? '<img src="' + esc(t.heroImage) + '" alt="" loading="lazy">'
        : '<div class="tgtr-hero-ph">' + esc(t.location || t.title) + '</div>';

      let pricing = '';
      if (departed) {
        pricing = '<div class="tgtr-closed" data-role="departed">This trip has now departed. Ask us about the next one.</div>';
      } else if (price) {
        const depositLine = deposit
          ? '<div class="tgtr-deposit" data-role="deposit"><strong>' + esc(deposit) + ' deposit</strong> to book'
            + (balance && balanceDue ? ', then ' + esc(balance) + ' by ' + esc(fmtDay(balanceDue)) : '')
            + '</div>'
          : '';
        pricing = '<div class="tgtr-pricing">'
          + '<span class="tgtr-price" data-role="price">' + esc(price) + '</span>'
          + '<span class="tgtr-price-unit">per person</span>'
          + depositLine
          + '</div>';
      }

      this.root = document.createElement('div');
      this.root.className = 'tgtr-root';
      this.root.setAttribute('data-theme', d.theme);
      // Colours and radius go through CSSOM only — never string-built styles.
      if (d.brandColor) {
        this.root.style.setProperty('--tgtr-brand', d.brandColor);
        this.root.style.setProperty('--tgtr-brand-hover', d.brandColor);
      }
      this.root.style.setProperty('--tgtr-radius', d.radius + 'px');
      this.root.style.setProperty('--tgtr-font', fontStack(d.fontFamily));

      this.root.innerHTML =
        '<section class="tgtr-card" aria-label="' + esc(t.title) + '">'
        + '<div class="tgtr-hero">' + heroImg + '</div>'
        + '<div class="tgtr-body">'
          + (meta ? '<div class="tgtr-meta">' + meta + '</div>' : '')
          + '<h2 class="tgtr-title" data-role="title">' + esc(t.title) + '</h2>'
          + (t.description ? '<p class="tgtr-desc" data-role="description">' + esc(t.description) + '</p>' : '')
          + pricing
          + (departed ? '' : '<div class="tgtr-avail" data-role="avail" hidden></div>')
        + '</div>'
        + '</section>';

      this.shadow.innerHTML = '<style>' + STYLES + '</style>';
      this.shadow.appendChild(this.root);

      // Live "places left" — only for a real, saved embed (never in a preview,
      // which has no widget id). Patched in after render; the card never waits
      // on it, and a failure stays silent.
      this._loadAvailability(departed);
    }

    // Fetch counts-only availability and patch the "places left" node. Calm by
    // design: shows nothing unless the endpoint returns a usable count, so the
    // card is never wrong and never blank on a hiccup.
    _loadAvailability(departed) {
      if (departed || !this.widgetId) return;
      const node = this.root && this.root.querySelector('[data-role="avail"]');
      if (!node) return;
      const token = (this._availToken = (this._availToken || 0) + 1);
      fetch(AVAIL_URL + '?widgetId=' + encodeURIComponent(this.widgetId))
        .then(function (r) { return r.ok ? r.json() : null; })
        .then((d) => {
          if (token !== this._availToken) return;   // superseded by a newer render
          if (!d || !d.ok || !d.available) return;   // calm: show nothing
          if (d.soldOut) {
            node.textContent = 'Sold out';
            node.className = 'tgtr-avail is-sold';
            node.hidden = false;
          } else if (typeof d.remaining === 'number' && d.remaining > 0) {
            node.textContent = (d.remaining <= 5 ? 'Only ' : '') + d.remaining + (d.remaining === 1 ? ' place left' : ' places left');
            node.className = 'tgtr-avail' + (d.remaining <= 5 ? ' is-low' : '');
            node.hidden = false;
          }
        })
        .catch(function () { /* network hiccup — stay silent, never block the card */ });
    }

    // Public: apply new config and re-render in place. Called by the editor
    // preview on every keystroke — must stay free of page side effects
    // (no focus, no scroll), per the suite render rule.
    update(config) {
      this.cfg = this._defaults(Object.assign({}, {
        trip: Object.assign({}, this.cfg.trip, config && config.trip),
        design: Object.assign({}, this.cfg.design, config && config.design),
        _widgetId: (config && config._widgetId) || this.cfg._widgetId,
      }));
      this._render();
    }

    destroy() {
      this.shadow.innerHTML = '';
      this.el.removeAttribute('data-tg-hidden');
    }
  }

  // ── Auto-init ───────────────────────────────────────────────────────────────
  async function loadConfigFromApi(widgetId) {
    try {
      const res = await fetch(API_BASE + '?id=' + encodeURIComponent(widgetId));
      if (!res.ok) throw new Error('Config load failed: ' + res.status);
      const data = await res.json();
      if (data && data.config) return Object.assign({}, data.config, { _widgetId: widgetId });
      throw new Error('No config returned');
    } catch (err) {
      console.error('[TGTrips] Config load error:', err);
      return null;
    }
  }

  async function init() {
    const containers = document.querySelectorAll('[data-tg-widget="trips"]');
    for (const el of containers) {
      if (el._tgInitialised || el.shadowRoot) continue;
      el._tgInitialised = true;
      let config = null;
      const inline = el.getAttribute('data-tg-config');
      const widgetId = el.getAttribute('data-tg-id');
      if (inline) {
        try { config = JSON.parse(inline); } catch (e) { console.error('[TGTrips] Invalid inline config:', e); continue; }
      } else if (widgetId) {
        config = await loadConfigFromApi(widgetId);
        if (!config) continue;
      } else {
        config = {};
      }
      new TGTripsWidget(el, config);
    }
  }

  if (typeof window !== 'undefined') {
    window.TGTripsWidget = TGTripsWidget;
    window.__TG_TRIPS_VERSION__ = VERSION;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }
})();
