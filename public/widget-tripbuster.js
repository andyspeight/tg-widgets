/**
 * Tripbuster Deals Widget v1.0.0
 * Self-contained, embeddable widget — renders a travel agent's holiday deals
 * as cards that click through to the agent's own booking page.
 *
 * Part of the Tripbuster advertising platform (a Travelgenix product). The
 * agent never sells through the widget; each deal links out to the agent's
 * own site where they complete the booking under their own protection.
 *
 * Usage:
 *   <div data-tg-widget="tripbuster" data-tg-id="YOUR_WIDGET_ID"></div>
 *   <script src="https://tg-widgets.vercel.app/widget-tripbuster.js" defer></script>
 *
 * Or with inline config (skips the remote fetch):
 *   <div data-tg-widget="tripbuster" data-tg-config='{"deals":[...]}'></div>
 *
 * Config shape:
 *   {
 *     title:    "Our latest holiday deals",   // optional heading
 *     layout:   "grid" | "list",              // default "grid"
 *     columns:  2 | 3 | 4,                     // grid columns on desktop, default 3
 *     theme:    "light" | "dark",             // default "light"
 *     accent:   "#FF5C39",                     // brand colour (hex), default coral
 *     showAtol: true,                          // show the agent's protection badge
 *     ctaLabel: "View deal",                   // button label
 *     deals: [
 *       {
 *         title, destination, country, board, nights, airport, dates,
 *         priceFrom, wasPrice, currency ("GBP"|"EUR"|"USD"),
 *         image, clickoutUrl, atol, discount (optional), badge (optional)
 *       }
 *     ]
 *   }
 *
 * Live deals:
 *   Add data-tg-agent="<agent-slug>" (or agentSlug in config) and the widget
 *   pulls that agent's live deals from /api/tripbuster/deals instead of needing
 *   them embedded in the config. An explicit `deals` array always wins, so
 *   inline config stays useful for previews and tests.
 *
 *   <div data-tg-widget="tripbuster" data-tg-agent="sunseeker-travel"></div>
 *
 * Changelog:
 *   v1.1.0 (Jul 2026) — Live deal feed: data-tg-agent / config.agentSlug fetches
 *     the agent's live deals from the Tripbuster API, with maxDeals to cap them.
 *   v1.0.0 (Jul 2026) — First cut. Grid + list layouts, discount auto-calc,
 *     protection badge, CSP-safe click-out, Shadow DOM isolation, light/dark.
 */
(function () {
  'use strict';

  // ── API base ────────────────────────────────────────────────
  // The widget runs on customer sites, so a relative /api path can't be
  // trusted. Honour an explicit override, then the script's own origin.
  function resolveApiBase() {
    if (typeof window === 'undefined') return '/api/widget-config';
    if (window.__TG_WIDGET_API__) return window.__TG_WIDGET_API__;
    try {
      const me = document.currentScript;
      if (me && me.src) return new URL(me.src).origin + '/api/widget-config';
      const scripts = document.getElementsByTagName('script');
      for (let i = scripts.length - 1; i >= 0; i--) {
        const s = scripts[i].src || '';
        if (s.indexOf('widget-tripbuster.js') !== -1) return new URL(s).origin + '/api/widget-config';
      }
    } catch (e) { /* fall through */ }
    return '/api/widget-config';
  }

  // The deals feed lives alongside the config API on the same deployment, so it
  // is derived from the same origin rather than configured twice.
  function resolveDealsApi() {
    if (typeof window !== 'undefined' && window.__TG_TRIPBUSTER_API__) return window.__TG_TRIPBUSTER_API__;
    try {
      const origin = new URL(resolveApiBase(), (typeof location !== 'undefined' ? location.href : undefined)).origin;
      return origin + '/api/tripbuster/deals';
    } catch (e) {
      return '/api/tripbuster/deals';
    }
  }

  const API_BASE = resolveApiBase();
  const DEALS_API = resolveDealsApi();
  const VERSION = '1.1.0';

  // ── Helpers ─────────────────────────────────────────────────
  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Allowlist, not denylist: only http(s)/mailto/tel/anchor/site-relative
  // survive. A denylist misses obfuscations like `java\tscript:`.
  function safeUrl(u) {
    if (!u) return '';
    const s = String(u).trim();
    if (s.startsWith('#') || s.startsWith('/')) return s;
    return /^(https?:|mailto:|tel:)/i.test(s) ? s : '';
  }

  // Config colours reach the root style attribute — validate at source.
  // Accept #rgb / #rrggbb only; anything else falls back to the default.
  function safeColor(c, fallback) {
    if (typeof c === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c.trim())) return c.trim();
    return fallback;
  }

  // Clamp a config number into a sane range; non-numbers return the fallback.
  function num(v, min, max, fallback) {
    const n = Number(v);
    if (!isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, Math.round(n)));
  }

  // Money is shown as-is (agents type "329"); we only pick the symbol and add
  // thousands separators. No arithmetic on user-entered prices beyond display.
  const CURRENCIES = { GBP: '£', EUR: '€', USD: '$' };
  function money(sym, amount) {
    const n = Number(String(amount).replace(/[^0-9.]/g, ''));
    if (!isFinite(n)) return '';
    return sym + n.toLocaleString('en-GB');
  }

  // Deterministic gradient per destination so cards without a photo still look
  // intentional. Six brand-toned gradients defined as CSS classes.
  function gradIndex(seed) {
    const s = String(seed || '');
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h + s.charCodeAt(i)) % 6;
    return h;
  }

  const IC = {
    pin: '<path d="M21 10c0 7-9 12-9 12s-9-5-9-12a9 9 0 0 1 18 0Z"/><circle cx="12" cy="10" r="3"/>',
    moon: '<path d="M12 2v4M12 18v4M2 12h4M18 12h4"/><circle cx="12" cy="12" r="4"/>',
    plane: '<path d="M2 22h20M6 18l14-4M6 18l-2-6 3-1 4 3 5-1L9 3l2-1 8 8"/>',
    board: '<path d="M3 11h18M5 11V7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v4M4 11v7M20 11v7"/>',
    cal: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    shield: '<path d="M12 2 4 5v6c0 5 3.5 8.5 8 11 4.5-2.5 8-6 8-11V5l-8-3Z"/><path d="m9 12 2 2 4-4"/>',
    arrow: '<path d="M7 17 17 7M9 7h8v8"/>'
  };
  function svg(paths, cls) {
    return '<svg class="' + cls + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>';
  }

  // ── Styles (all inside the Shadow DOM) ──────────────────────
  const STYLES = `
    :host { all: initial; display: block; }
    * { box-sizing: border-box; }
    .tgtb-root {
      --tgtb-accent: #FF5C39;
      --tgtb-accent-ink: #E5451F;
      --tgtb-bg: transparent;
      --tgtb-card: #FFFFFF;
      --tgtb-card-2: #EFF6FB;
      --tgtb-border: #E3EDF3;
      --tgtb-text: #123249;
      --tgtb-sub: #52707F;
      --tgtb-muted: #8AA3B0;
      --tgtb-live: #0CA678;
      --tgtb-live-bg: #E3F7F0;
      --tgtb-radius: 16px;
      --tgtb-shadow: 0 1px 2px rgba(18,50,73,.06);
      --tgtb-shadow-h: 0 10px 26px rgba(18,50,73,.12);
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      color: var(--tgtb-text);
      background: var(--tgtb-bg);
      -webkit-font-smoothing: antialiased;
      line-height: 1.5;
    }
    .tgtb-root[data-theme="dark"] {
      --tgtb-card: #1F2937;
      --tgtb-card-2: #111827;
      --tgtb-border: #334155;
      --tgtb-text: #F1F5F9;
      --tgtb-sub: #B7C2CE;
      --tgtb-muted: #7E8C9A;
      --tgtb-live: #26C08A;
      --tgtb-live-bg: #123027;
      --tgtb-shadow: 0 1px 2px rgba(0,0,0,.4);
      --tgtb-shadow-h: 0 12px 28px rgba(0,0,0,.5);
    }

    .tgtb-head { margin: 0 0 16px; }
    .tgtb-title { margin: 0; font-size: 22px; font-weight: 800; letter-spacing: -.02em; }

    .tgtb-grid { display: grid; gap: 16px; grid-template-columns: repeat(var(--tgtb-cols, 3), 1fr); }
    .tgtb-list { display: flex; flex-direction: column; gap: 14px; }

    .tgtb-card {
      background: var(--tgtb-card); border: 1px solid var(--tgtb-border);
      border-radius: var(--tgtb-radius); overflow: hidden; box-shadow: var(--tgtb-shadow);
      display: flex; flex-direction: column; transition: transform .2s ease, box-shadow .2s ease;
    }
    .tgtb-card:hover { transform: translateY(-3px); box-shadow: var(--tgtb-shadow-h); }
    .tgtb-list .tgtb-card { flex-direction: row; }

    .tgtb-img { position: relative; height: 168px; flex: none; overflow: hidden; }
    .tgtb-list .tgtb-img { width: 210px; height: auto; min-height: 150px; }
    .tgtb-img img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .tgtb-img.g0 { background: linear-gradient(135deg,#2E9BD6,#7ED0E8); }
    .tgtb-img.g1 { background: linear-gradient(135deg,#F0883E,#F6C445); }
    .tgtb-img.g2 { background: linear-gradient(135deg,#1F9E8E,#67D6B5); }
    .tgtb-img.g3 { background: linear-gradient(135deg,#2A6FD6,#5AC8E8); }
    .tgtb-img.g4 { background: linear-gradient(135deg,#C9612F,#F0A85C); }
    .tgtb-img.g5 { background: linear-gradient(135deg,#12A5B0,#7BE0C4); }
    .tgtb-img::after { content: ""; position: absolute; inset: 0; background: linear-gradient(to top, rgba(0,0,0,.28), transparent 46%); }

    .tgtb-tag {
      position: absolute; z-index: 2; top: 11px; left: 11px; background: var(--tgtb-accent);
      color: #fff; font-size: 11.5px; font-weight: 800; padding: 4px 10px; border-radius: 999px;
      box-shadow: 0 3px 10px rgba(255,92,57,.4);
    }
    .tgtb-badge {
      position: absolute; z-index: 2; top: 11px; right: 11px; background: rgba(0,0,0,.5);
      color: #fff; font-size: 11px; font-weight: 700; padding: 4px 9px; border-radius: 999px;
    }

    .tgtb-body { padding: 14px 15px 0; flex: 1 1 auto; min-width: 0; }
    .tgtb-dest {
      font-size: 11px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase;
      color: var(--tgtb-accent-ink); display: flex; align-items: center; gap: 5px;
    }
    .tgtb-dest svg { width: 12px; height: 12px; }
    .tgtb-name { font-size: 15.5px; font-weight: 800; letter-spacing: -.02em; line-height: 1.25; margin: 5px 0 10px; }
    .tgtb-meta { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 11px; }
    .tgtb-chip {
      font-size: 11.5px; font-weight: 700; color: var(--tgtb-sub); background: var(--tgtb-card-2);
      border: 1px solid var(--tgtb-border); padding: 3px 8px; border-radius: 7px;
      display: inline-flex; align-items: center; gap: 4px;
    }
    .tgtb-chip svg { width: 11px; height: 11px; color: var(--tgtb-muted); }
    .tgtb-atol {
      display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; font-weight: 800;
      color: var(--tgtb-live); padding-top: 10px; border-top: 1px dashed var(--tgtb-border);
    }
    .tgtb-atol svg { width: 13px; height: 13px; }

    .tgtb-foot { display: flex; align-items: flex-end; justify-content: space-between; gap: 10px; padding: 12px 15px 15px; }
    .tgtb-was { font-size: 12px; color: var(--tgtb-muted); text-decoration: line-through; }
    .tgtb-price { font-size: 22px; font-weight: 800; letter-spacing: -.03em; line-height: 1.1; }
    .tgtb-price small { font-size: 12px; color: var(--tgtb-muted); font-weight: 700; }
    .tgtb-go {
      background: var(--tgtb-accent); color: #fff; font-weight: 800; font-size: 13px;
      padding: 10px 15px; border-radius: 10px; border: 0; cursor: pointer; text-decoration: none;
      display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; font-family: inherit;
    }
    .tgtb-go:hover { background: var(--tgtb-accent-ink); }
    .tgtb-go svg { width: 14px; height: 14px; }

    .tgtb-empty { padding: 34px 18px; text-align: center; color: var(--tgtb-muted); font-size: 14px;
      border: 1px dashed var(--tgtb-border); border-radius: var(--tgtb-radius); }

    .tgtb-credit { margin: 14px 0 0; text-align: center; font-size: 11px; color: var(--tgtb-muted); }
    .tgtb-credit b { color: var(--tgtb-accent-ink); font-weight: 800; }

    @media (max-width: 900px) { .tgtb-grid { grid-template-columns: repeat(2, 1fr); } }
    @media (max-width: 560px) {
      .tgtb-grid { grid-template-columns: 1fr; }
      .tgtb-list .tgtb-card { flex-direction: column; }
      .tgtb-list .tgtb-img { width: 100%; height: 168px; }
    }
    @media (prefers-reduced-motion: reduce) {
      .tgtb-card { transition: none; }
      .tgtb-card:hover { transform: none; }
    }
  `;

  const DEFAULTS = {
    title: '',
    layout: 'grid',
    columns: 3,
    theme: 'light',
    accent: '#FF5C39',
    showAtol: true,
    ctaLabel: 'View deal',
    credit: true,
    agentSlug: '',
    maxDeals: 6,
    deals: []
  };

  // ── Widget ──────────────────────────────────────────────────
  class TGTripbusterWidget {
    constructor(container, config) {
      this.el = container;
      this.c = this._defaults(config);
      this.shadow = container.attachShadow({ mode: 'open' });
      this._render();
    }

    _defaults(config) {
      const c = Object.assign({}, DEFAULTS, config || {});
      c.layout = c.layout === 'list' ? 'list' : 'grid';
      c.columns = num(c.columns, 2, 4, 3);
      c.theme = c.theme === 'dark' ? 'dark' : 'light';
      c.accent = safeColor(c.accent, '#FF5C39');
      c.deals = Array.isArray(c.deals) ? c.deals : [];
      return c;
    }

    // Compute the discount % from was/from prices when the agent hasn't set one.
    _discount(d) {
      const explicit = Number(d.discount);
      if (isFinite(explicit) && explicit > 0) return Math.round(explicit);
      const from = Number(String(d.priceFrom).replace(/[^0-9.]/g, ''));
      const was = Number(String(d.wasPrice).replace(/[^0-9.]/g, ''));
      if (isFinite(from) && isFinite(was) && was > from && was > 0) return Math.round((1 - from / was) * 100);
      return 0;
    }

    _card(d) {
      const sym = CURRENCIES[String(d.currency || 'GBP').toUpperCase()] || CURRENCIES.GBP;
      const img = safeUrl(d.image);
      const gi = gradIndex(d.destination || d.title);
      const disc = this._discount(d);
      const href = safeUrl(d.clickoutUrl);
      const chips = [];
      if (d.nights) chips.push('<span class="tgtb-chip">' + svg(IC.moon, '') + esc(d.nights) + ' nights</span>');
      if (d.board) chips.push('<span class="tgtb-chip">' + svg(IC.board, '') + esc(d.board) + '</span>');
      if (d.airport) chips.push('<span class="tgtb-chip">' + svg(IC.plane, '') + esc(d.airport) + '</span>');
      if (d.dates) chips.push('<span class="tgtb-chip">' + svg(IC.cal, '') + esc(d.dates) + '</span>');

      const badge = d.badge ? '<span class="tgtb-badge">' + esc(d.badge) + '</span>' : '';
      const discTag = disc > 0 ? '<span class="tgtb-tag">-' + disc + '%</span>' : '';
      const imgInner = img
        ? '<img src="' + esc(img) + '" alt="' + esc(d.title || d.destination || '') + '" loading="lazy" data-fb>'
        : '';
      const was = d.wasPrice ? '<div class="tgtb-was">' + esc(money(sym, d.wasPrice)) + '</div>' : '';
      const price = d.priceFrom
        ? '<div class="tgtb-price">' + esc(money(sym, d.priceFrom)) + '<small> pp</small></div>'
        : '';
      const atol = (this.c.showAtol && d.atol)
        ? '<div class="tgtb-atol">' + svg(IC.shield, '') + 'ATOL ' + esc(d.atol) + '</div>'
        : '';

      // CTA is an anchor so it works without JS and stays keyboard-accessible.
      // rel=noopener strips window.opener; target=_blank so the host page stays.
      const cta = href
        ? '<a class="tgtb-go" href="' + esc(href) + '" target="_blank" rel="noopener nofollow" data-clickout>' +
          esc(this.c.ctaLabel) + svg(IC.arrow, '') + '</a>'
        : '';

      return '' +
        '<article class="tgtb-card">' +
          '<div class="tgtb-img g' + gi + '">' + discTag + badge + imgInner + '</div>' +
          '<div class="tgtb-body">' +
            (d.destination ? '<div class="tgtb-dest">' + svg(IC.pin, '') + esc(d.destination) + '</div>' : '') +
            '<h3 class="tgtb-name">' + esc(d.title || d.destination || 'Holiday deal') + '</h3>' +
            (chips.length ? '<div class="tgtb-meta">' + chips.join('') + '</div>' : '') +
            atol +
          '</div>' +
          '<div class="tgtb-foot">' +
            '<div>' + was + price + '</div>' + cta +
          '</div>' +
        '</article>';
    }

    _render() {
      const c = this.c;
      const head = c.title ? '<div class="tgtb-head"><h2 class="tgtb-title">' + esc(c.title) + '</h2></div>' : '';
      let inner;
      if (!c.deals.length) {
        inner = '<div class="tgtb-empty">No deals to show just yet. Check back soon.</div>';
      } else {
        const cards = c.deals.map((d) => this._card(d)).join('');
        inner = c.layout === 'list'
          ? '<div class="tgtb-list">' + cards + '</div>'
          : '<div class="tgtb-grid" style="--tgtb-cols:' + c.columns + '">' + cards + '</div>';
      }
      const credit = c.credit
        ? '<p class="tgtb-credit">Deals by <b>Tripbuster</b></p>'
        : '';

      this.shadow.innerHTML =
        '<style>' + STYLES + '</style>' +
        '<div class="tgtb-root" data-theme="' + c.theme + '" style="--tgtb-accent:' + c.accent + '">' +
          head + inner + credit +
        '</div>';
      this._bind();
    }

    _bind() {
      // Image fallback: on load error, drop the <img> so the gradient shows,
      // rather than the host page's broken-image glyph. Bound here (not inline)
      // so the widget stays CSP-clean.
      this.shadow.querySelectorAll('img[data-fb]').forEach((img) => {
        img.addEventListener('error', () => { if (img.parentNode) img.remove(); }, { once: true });
      });
    }

    update(newConfig) {
      this.c = this._defaults(Object.assign({}, this.c, newConfig));
      this._render();
    }

    destroy() {
      this.shadow.innerHTML = '';
    }
  }

  // ── Auto-initializer ────────────────────────────────────────
  /**
   * Mount one container. Deals come from whichever source is available, in
   * priority order: an explicit `deals` array in the config, otherwise the live
   * feed for the agent named by data-tg-agent / config.agentSlug.
   */
  async function mount(el, cfg) {
    const config = Object.assign({}, cfg || {});
    const slug = el.getAttribute('data-tg-agent') || config.agentSlug || '';
    const hasOwnDeals = Array.isArray(config.deals) && config.deals.length > 0;

    if (slug && !hasOwnDeals) {
      const limit = num(config.maxDeals, 1, 60, 6);
      try {
        const res = await fetch(DEALS_API + '?agent=' + encodeURIComponent(slug) + '&limit=' + limit);
        if (res.ok) {
          const data = await res.json();
          config.deals = (data && Array.isArray(data.deals)) ? data.deals : [];
        } else {
          console.warn('[TG Tripbuster] deals feed returned', res.status);
          config.deals = [];
        }
      } catch (e) {
        // A failed feed shows the empty state rather than breaking the host page.
        console.warn('[TG Tripbuster] deals feed error', e && e.message);
        config.deals = [];
      }
    }
    new TGTripbusterWidget(el, config);
  }

  async function init() {
    const containers = document.querySelectorAll('[data-tg-widget="tripbuster"]');
    for (const el of containers) {
      if (el.__tgInited) continue;
      el.__tgInited = true;

      const inline = el.getAttribute('data-tg-config');
      if (inline) {
        try {
          await mount(el, JSON.parse(inline));
          continue;
        } catch (e) {
          console.warn('[TG Tripbuster] invalid data-tg-config', e);
        }
      }

      const id = el.getAttribute('data-tg-id');
      if (id) {
        try {
          const res = await fetch(API_BASE + '?id=' + encodeURIComponent(id));
          if (!res.ok) throw new Error('Config load failed');
          const data = await res.json();
          await mount(el, (data && data.config) ? data.config : data);
        } catch (e) {
          console.warn('[TG Tripbuster] remote config error', e);
          el.textContent = '';
        }
        continue;
      }

      // No inline config and no id: still valid if the agent is named directly.
      if (el.getAttribute('data-tg-agent')) await mount(el, {});
    }
  }

  // Expose
  window.TGTripbusterWidget = TGTripbusterWidget;
  window.__TG_TRIPBUSTER_VERSION__ = VERSION;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
