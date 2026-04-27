/**
 * Travelgenix Logo Showcase Widget v1.0.0
 * Self-contained, embeddable widget
 * Zero dependencies — works on any website via a single script tag
 *
 * Usage:
 *   <div data-tg-widget="logos" data-tg-id="YOUR_WIDGET_ID"></div>
 *   <script src="https://tg-widgets.vercel.app/widget-logos.js"></script>
 */
(function () {
  'use strict';

  const API_BASE = (typeof window !== 'undefined' && window.__TG_WIDGET_API__) || '/api/widget-config';
  const VERSION = '1.0.0';

  // ---------- Helpers ----------
  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function safeUrl(u) {
    if (!u) return '';
    const s = String(u).trim();
    if (/^javascript:/i.test(s) || /^data:/i.test(s) || /^vbscript:/i.test(s)) return '';
    return s;
  }

  // ---------- Styles ----------
  const STYLES = `
    :host { all: initial; display: block; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }

    *, *::before, *::after { box-sizing: border-box; }

    .tgl-root {
      --tgl-brand: #0891B2;
      --tgl-accent: #6366F1;
      --tgl-bg: #FFFFFF;
      --tgl-card: #F8FAFC;
      --tgl-text: #0F172A;
      --tgl-sub: #64748B;
      --tgl-muted: #94A3B8;
      --tgl-border: #E2E8F0;
      --tgl-radius: 16px;
      --tgl-radius-sm: 12px;
      --tgl-shadow: 0 1px 2px rgba(15, 23, 42, 0.04), 0 1px 3px rgba(15, 23, 42, 0.06);
      --tgl-shadow-hover: 0 4px 6px rgba(15, 23, 42, 0.06), 0 10px 15px rgba(15, 23, 42, 0.08);
      color: var(--tgl-text);
      background: var(--tgl-bg);
      padding: 32px 24px;
      border-radius: var(--tgl-radius);
    }

    .tgl-root[data-theme="dark"] {
      --tgl-bg: #0F172A;
      --tgl-card: #1E293B;
      --tgl-text: #F1F5F9;
      --tgl-sub: #94A3B8;
      --tgl-muted: #64748B;
      --tgl-border: #334155;
      --tgl-shadow: 0 1px 2px rgba(0, 0, 0, 0.2), 0 1px 3px rgba(0, 0, 0, 0.3);
      --tgl-shadow-hover: 0 4px 6px rgba(0, 0, 0, 0.3), 0 10px 15px rgba(0, 0, 0, 0.4);
    }

    /* ----- Heading ----- */
    .tgl-heading {
      text-align: center;
      max-width: 720px;
      margin: 0 auto 32px;
    }
    .tgl-eyebrow {
      font-size: 13px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--tgl-brand);
      margin-bottom: 8px;
    }
    .tgl-title {
      font-size: 28px;
      font-weight: 700;
      line-height: 1.2;
      margin: 0 0 8px;
      letter-spacing: -0.02em;
      color: var(--tgl-text);
    }
    .tgl-subtitle {
      font-size: 16px;
      line-height: 1.55;
      color: var(--tgl-sub);
      margin: 0;
    }

    /* ----- Filter tabs ----- */
    .tgl-tabs {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 8px;
      margin: 0 0 28px;
    }
    .tgl-tab {
      appearance: none;
      border: 1px solid var(--tgl-border);
      background: var(--tgl-card);
      color: var(--tgl-sub);
      font: inherit;
      font-size: 14px;
      font-weight: 500;
      padding: 8px 16px;
      border-radius: 999px;
      cursor: pointer;
      transition: background 0.18s ease, color 0.18s ease, border-color 0.18s ease;
    }
    .tgl-tab:hover { color: var(--tgl-text); border-color: var(--tgl-muted); }
    .tgl-tab[aria-pressed="true"] {
      background: var(--tgl-brand);
      color: #fff;
      border-color: var(--tgl-brand);
    }
    .tgl-tab:focus-visible {
      outline: none;
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--tgl-brand) 30%, transparent);
    }

    /* ----- Logos container ----- */
    .tgl-logos { width: 100%; }

    /* ----- Single logo cell ----- */
    .tgl-cell {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 20px 16px;
      background: var(--tgl-card);
      border: 1px solid var(--tgl-border);
      border-radius: var(--tgl-radius-sm);
      transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
      text-decoration: none;
      color: inherit;
      min-height: 100px;
    }
    .tgl-cell.is-link { cursor: pointer; }
    .tgl-cell.is-link:hover {
      transform: translateY(-2px);
      box-shadow: var(--tgl-shadow-hover);
      border-color: var(--tgl-brand);
    }
    .tgl-cell:focus-visible {
      outline: none;
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--tgl-brand) 30%, transparent);
    }

    .tgl-img-wrap {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 56px;
    }
    .tgl-img {
      max-width: 100%;
      max-height: 100%;
      width: auto;
      height: auto;
      object-fit: contain;
      transition: filter 0.25s ease, opacity 0.25s ease;
    }

    /* Grayscale effect */
    .tgl-root[data-grayscale="true"] .tgl-img {
      filter: grayscale(100%);
      opacity: 0.7;
    }
    .tgl-root[data-grayscale="true"] .tgl-cell:hover .tgl-img {
      filter: grayscale(0);
      opacity: 1;
    }

    .tgl-caption {
      font-size: 12px;
      font-weight: 500;
      color: var(--tgl-sub);
      text-align: center;
      letter-spacing: 0.01em;
      line-height: 1.3;
    }

    /* ----- Layout: Grid ----- */
    .tgl-grid {
      display: grid;
      gap: 16px;
      grid-template-columns: repeat(var(--tgl-cols, 4), 1fr);
    }
    @media (max-width: 900px) {
      .tgl-grid { grid-template-columns: repeat(min(var(--tgl-cols, 4), 3), 1fr); }
    }
    @media (max-width: 640px) {
      .tgl-grid { grid-template-columns: repeat(2, 1fr); gap: 12px; }
    }
    @media (max-width: 380px) {
      .tgl-grid { grid-template-columns: 1fr 1fr; }
    }

    /* ----- Layout: Strip ----- */
    .tgl-strip {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: center;
      gap: 32px 48px;
      padding: 8px 0;
    }
    .tgl-strip .tgl-cell {
      background: transparent;
      border: none;
      padding: 8px 0;
      min-height: auto;
      flex: 0 0 auto;
    }
    .tgl-strip .tgl-cell.is-link:hover {
      transform: translateY(-2px);
      box-shadow: none;
    }
    .tgl-strip .tgl-img-wrap { height: 44px; min-width: 100px; max-width: 160px; }
    @media (max-width: 640px) {
      .tgl-strip { gap: 24px 32px; }
      .tgl-strip .tgl-img-wrap { height: 36px; min-width: 80px; max-width: 130px; }
    }

    /* ----- Layout: Marquee ----- */
    .tgl-marquee {
      position: relative;
      width: 100%;
      overflow: hidden;
      mask-image: linear-gradient(90deg, transparent 0, #000 60px, #000 calc(100% - 60px), transparent 100%);
      -webkit-mask-image: linear-gradient(90deg, transparent 0, #000 60px, #000 calc(100% - 60px), transparent 100%);
    }
    .tgl-marquee-track {
      display: flex;
      gap: 48px;
      width: max-content;
      animation: tgl-scroll var(--tgl-marquee-speed, 40s) linear infinite;
    }
    .tgl-marquee:hover .tgl-marquee-track { animation-play-state: paused; }
    .tgl-marquee .tgl-cell {
      background: transparent;
      border: none;
      padding: 8px 0;
      min-height: auto;
      flex: 0 0 auto;
    }
    .tgl-marquee .tgl-cell.is-link:hover { transform: none; box-shadow: none; }
    .tgl-marquee .tgl-img-wrap { height: 48px; min-width: 120px; max-width: 180px; }
    @keyframes tgl-scroll {
      from { transform: translateX(0); }
      to { transform: translateX(-50%); }
    }

    /* ----- Layout: Spotlight ----- */
    .tgl-spotlight {
      display: grid;
      grid-template-columns: 1.4fr 1fr;
      gap: 24px;
      align-items: stretch;
    }
    .tgl-spotlight-featured {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      gap: 12px;
      padding: 40px 32px;
      background: var(--tgl-card);
      border: 1px solid var(--tgl-border);
      border-radius: var(--tgl-radius);
      min-height: 240px;
    }
    .tgl-spotlight-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      padding: 4px 10px;
      background: color-mix(in srgb, var(--tgl-brand) 12%, transparent);
      color: var(--tgl-brand);
      border-radius: 999px;
    }
    .tgl-spotlight-img-wrap {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      max-width: 280px;
      height: 90px;
      margin: 8px 0;
    }
    .tgl-spotlight-img {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
    }
    .tgl-spotlight-name {
      font-size: 18px;
      font-weight: 600;
      color: var(--tgl-text);
      margin: 0;
    }
    .tgl-spotlight-tagline {
      font-size: 14px;
      color: var(--tgl-sub);
      line-height: 1.5;
      margin: 0;
      max-width: 320px;
    }
    .tgl-spotlight-link {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
      font-weight: 600;
      color: var(--tgl-brand);
      text-decoration: none;
      margin-top: 4px;
    }
    .tgl-spotlight-link:hover { text-decoration: underline; }
    .tgl-spotlight-others {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 12px;
    }
    @media (max-width: 760px) {
      .tgl-spotlight { grid-template-columns: 1fr; }
      .tgl-spotlight-others { grid-template-columns: repeat(3, 1fr); }
    }
    @media (max-width: 480px) {
      .tgl-spotlight-others { grid-template-columns: repeat(2, 1fr); }
    }

    /* ----- Empty state ----- */
    .tgl-empty {
      text-align: center;
      padding: 48px 24px;
      color: var(--tgl-muted);
      font-size: 14px;
    }

    /* ----- Reduced motion ----- */
    @media (prefers-reduced-motion: reduce) {
      .tgl-marquee-track { animation: none; }
      .tgl-cell, .tgl-img, .tgl-tab { transition: none; }
    }
  `;

  // ---------- Widget Class ----------
  class TGLogosWidget {
    constructor(container, config) {
      this.el = container;
      this.c = this._defaults(config);
      this.shadow = container.attachShadow({ mode: 'open' });
      this._activeGroup = 'all';
      this._render();
    }

    _defaults(c) {
      const cfg = c || {};
      return {
        layout: cfg.layout || 'grid',                 // grid | strip | marquee | spotlight
        columns: Number(cfg.columns) || 4,            // grid only: 3, 4, 5, 6
        marqueeSpeed: Number(cfg.marqueeSpeed) || 40, // marquee only: seconds per loop
        grayscale: cfg.grayscale === true,
        showHeading: cfg.showHeading !== false,
        eyebrow: cfg.eyebrow || '',
        title: cfg.title || 'Trusted partners',
        subtitle: cfg.subtitle || '',
        showCaptions: cfg.showCaptions === true,
        showFilters: cfg.showFilters === true,
        spotlightTagline: cfg.spotlightTagline || '',
        spotlightCta: cfg.spotlightCta || '',
        logos: Array.isArray(cfg.logos) ? cfg.logos : [],
        theme: {
          mode: cfg.theme && cfg.theme.mode === 'dark' ? 'dark' : 'light',
          brand: (cfg.theme && cfg.theme.brand) || '#0891B2',
          accent: (cfg.theme && cfg.theme.accent) || '#6366F1',
          bg: (cfg.theme && cfg.theme.bg) || '',
          card: (cfg.theme && cfg.theme.card) || '',
          text: (cfg.theme && cfg.theme.text) || '',
          radius: cfg.theme && Number.isFinite(Number(cfg.theme.radius)) ? Number(cfg.theme.radius) : 16,
        },
      };
    }

    _render() {
      const cfg = this.c;
      const themeStyle = this._themeStyle();
      const heading = cfg.showHeading ? this._renderHeading() : '';
      const tabs = (cfg.showFilters && this._groups().length > 1) ? this._renderTabs() : '';
      const body = this._renderBody();

      this.shadow.innerHTML = `
        <style>${STYLES}</style>
        <div class="tgl-root" data-theme="${cfg.theme.mode}" data-grayscale="${cfg.grayscale}" style="${themeStyle}">
          ${heading}
          ${tabs}
          <div class="tgl-logos" role="list" aria-label="${esc(cfg.title || 'Logos')}">
            ${body}
          </div>
        </div>
      `;
      this._bind();
    }

    _themeStyle() {
      const t = this.c.theme;
      const parts = [];
      if (t.brand) parts.push(`--tgl-brand:${t.brand}`);
      if (t.accent) parts.push(`--tgl-accent:${t.accent}`);
      if (t.bg) parts.push(`--tgl-bg:${t.bg}`);
      if (t.card) parts.push(`--tgl-card:${t.card}`);
      if (t.text) parts.push(`--tgl-text:${t.text}`);
      if (Number.isFinite(t.radius)) {
        parts.push(`--tgl-radius:${t.radius}px`);
        parts.push(`--tgl-radius-sm:${Math.max(0, t.radius - 4)}px`);
      }
      if (this.c.layout === 'grid') parts.push(`--tgl-cols:${this.c.columns}`);
      if (this.c.layout === 'marquee') parts.push(`--tgl-marquee-speed:${this.c.marqueeSpeed}s`);
      return parts.join(';');
    }

    _renderHeading() {
      const cfg = this.c;
      if (!cfg.title && !cfg.subtitle && !cfg.eyebrow) return '';
      return `
        <div class="tgl-heading">
          ${cfg.eyebrow ? `<div class="tgl-eyebrow">${esc(cfg.eyebrow)}</div>` : ''}
          ${cfg.title ? `<h2 class="tgl-title">${esc(cfg.title)}</h2>` : ''}
          ${cfg.subtitle ? `<p class="tgl-subtitle">${esc(cfg.subtitle)}</p>` : ''}
        </div>
      `;
    }

    _groups() {
      const set = new Set();
      this.c.logos.forEach(l => { if (l && l.group) set.add(l.group); });
      return Array.from(set);
    }

    _renderTabs() {
      const groups = this._groups();
      const allActive = this._activeGroup === 'all';
      return `
        <div class="tgl-tabs" role="tablist">
          <button class="tgl-tab" data-group="all" aria-pressed="${allActive}">All</button>
          ${groups.map(g => `
            <button class="tgl-tab" data-group="${esc(g)}" aria-pressed="${this._activeGroup === g}">${esc(g)}</button>
          `).join('')}
        </div>
      `;
    }

    _filteredLogos() {
      const all = this.c.logos.filter(l => l && l.image);
      if (!this.c.showFilters || this._activeGroup === 'all') return all;
      return all.filter(l => l.group === this._activeGroup);
    }

    _renderBody() {
      const logos = this._filteredLogos();
      if (logos.length === 0) {
        return `<div class="tgl-empty">No logos to display</div>`;
      }
      switch (this.c.layout) {
        case 'strip': return this._renderStrip(logos);
        case 'marquee': return this._renderMarquee(logos);
        case 'spotlight': return this._renderSpotlight(logos);
        case 'grid':
        default: return this._renderGrid(logos);
      }
    }

    _renderCell(logo) {
      const url = safeUrl(logo.url);
      const tag = url ? 'a' : 'div';
      const linkAttrs = url
        ? `href="${esc(url)}" target="_blank" rel="noopener noreferrer"`
        : 'role="listitem"';
      const linkClass = url ? ' is-link' : '';
      const name = logo.name || '';
      const altText = logo.alt || name || 'Logo';
      const caption = (this.c.showCaptions && name) ? `<div class="tgl-caption">${esc(name)}</div>` : '';
      return `
        <${tag} class="tgl-cell${linkClass}" ${linkAttrs} aria-label="${esc(name || 'Logo')}">
          <div class="tgl-img-wrap">
            <img class="tgl-img" src="${esc(safeUrl(logo.image))}" alt="${esc(altText)}" loading="lazy" decoding="async" />
          </div>
          ${caption}
        </${tag}>
      `;
    }

    _renderGrid(logos) {
      return `<div class="tgl-grid">${logos.map(l => this._renderCell(l)).join('')}</div>`;
    }

    _renderStrip(logos) {
      return `<div class="tgl-strip">${logos.map(l => this._renderCell(l)).join('')}</div>`;
    }

    _renderMarquee(logos) {
      // Duplicate the set so the loop is seamless
      const cells = logos.map(l => this._renderCell(l)).join('');
      return `
        <div class="tgl-marquee">
          <div class="tgl-marquee-track">
            ${cells}${cells}
          </div>
        </div>
      `;
    }

    _renderSpotlight(logos) {
      const featured = logos.find(l => l.featured) || logos[0];
      const others = logos.filter(l => l !== featured).slice(0, 8);
      const featuredUrl = safeUrl(featured.url);
      const featuredCta = this.c.spotlightCta || 'Visit website';
      return `
        <div class="tgl-spotlight">
          <div class="tgl-spotlight-featured">
            <span class="tgl-spotlight-badge">Featured Partner</span>
            <div class="tgl-spotlight-img-wrap">
              <img class="tgl-spotlight-img" src="${esc(safeUrl(featured.image))}" alt="${esc(featured.alt || featured.name || 'Featured logo')}" loading="lazy" decoding="async" />
            </div>
            ${featured.name ? `<h3 class="tgl-spotlight-name">${esc(featured.name)}</h3>` : ''}
            ${this.c.spotlightTagline ? `<p class="tgl-spotlight-tagline">${esc(this.c.spotlightTagline)}</p>` : ''}
            ${featuredUrl ? `<a class="tgl-spotlight-link" href="${esc(featuredUrl)}" target="_blank" rel="noopener noreferrer">${esc(featuredCta)} →</a>` : ''}
          </div>
          <div class="tgl-spotlight-others">
            ${others.map(l => this._renderCell(l)).join('')}
          </div>
        </div>
      `;
    }

    _bind() {
      const tabs = this.shadow.querySelectorAll('.tgl-tab');
      tabs.forEach(t => {
        t.addEventListener('click', () => {
          this._activeGroup = t.getAttribute('data-group') || 'all';
          this._render();
        });
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

  // ---------- Auto-initializer ----------
  async function init() {
    const containers = document.querySelectorAll('[data-tg-widget="logos"]');
    for (const el of containers) {
      if (el.__tgInited) continue;
      el.__tgInited = true;

      // Inline config first
      const inline = el.getAttribute('data-tg-config');
      if (inline) {
        try {
          const cfg = JSON.parse(inline);
          new TGLogosWidget(el, cfg);
          continue;
        } catch (e) {
          console.warn('[TG Logos] invalid data-tg-config', e);
        }
      }

      // Remote config
      const id = el.getAttribute('data-tg-id');
      if (id) {
        try {
          const url = `${API_BASE}?id=${encodeURIComponent(id)}`;
          const res = await fetch(url);
          if (!res.ok) throw new Error('Config load failed');
          const data = await res.json();
          const cfg = data && data.config ? data.config : data;
          new TGLogosWidget(el, cfg);
        } catch (e) {
          console.warn('[TG Logos] remote config error', e);
          el.textContent = '';
        }
      }
    }
  }

  // Expose
  window.TGLogosWidget = TGLogosWidget;
  window.__TG_LOGOS_VERSION__ = VERSION;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
