/**
 * Travelgenix Pricing Widget v1.0.0
 * Self-contained, embeddable pricing table widget
 * Zero dependencies — works on any website via a single script tag
 * 
 * Usage:
 *   <div data-tg-widget="pricing" data-tg-id="YOUR_WIDGET_ID"></div>
 *   <script src="https://cdn.travelgenix.io/widgets/pricing/v1.js"></script>
 * 
 * Or with inline config:
 *   <div data-tg-widget="pricing" data-tg-config='{ ... }'></div>
 */
(function () {
  'use strict';

  const API_BASE = (typeof window !== 'undefined' && window.__TG_WIDGET_API__) || '/api/widget-config';
  const VERSION = '1.0.0';

  /* ━━━ CSS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
  const STYLES = `
    :host {
      all: initial;
      display: block;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      color: var(--tgp-text);
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }

    *, *::before, *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    .tgp-root {
      --tgp-brand: #0891B2;
      --tgp-accent: #6366F1;
      --tgp-bg: #F8FAFC;
      --tgp-card-bg: #FFFFFF;
      --tgp-text: #0F172A;
      --tgp-subtext: #64748B;
      --tgp-border: #E2E8F0;
      --tgp-radius: 16px;
      --tgp-radius-inner: 12px;

      width: 100%;
      padding: 48px 24px;
      background: var(--tgp-bg);
      transition: background-color 0.3s ease;
    }

    .tgp-root[data-theme="dark"] {
      --tgp-bg: #0F172A;
      --tgp-card-bg: #1E293B;
      --tgp-text: #F1F5F9;
      --tgp-subtext: #94A3B8;
      --tgp-border: #334155;
    }

    /* Header */
    .tgp-header {
      text-align: center;
      max-width: 560px;
      margin: 0 auto 12px;
    }

    .tgp-title {
      font-size: 28px;
      font-weight: 700;
      color: var(--tgp-text);
      line-height: 1.2;
      margin-bottom: 8px;
      letter-spacing: -0.02em;
    }

    .tgp-subtitle {
      font-size: 15px;
      color: var(--tgp-subtext);
      line-height: 1.6;
    }

    /* Billing Toggle */
    .tgp-toggle-wrap {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      margin-bottom: 40px;
    }

    .tgp-toggle-label {
      font-size: 14px;
      font-weight: 600;
      color: var(--tgp-subtext);
      transition: color 0.2s ease;
      cursor: pointer;
      user-select: none;
    }

    .tgp-toggle-label.active {
      color: var(--tgp-brand);
    }

    .tgp-toggle-track {
      position: relative;
      width: 52px;
      height: 28px;
      background: #CBD5E1;
      border-radius: 14px;
      cursor: pointer;
      transition: background-color 0.3s ease;
      border: none;
      outline: none;
      padding: 0;
    }

    .tgp-toggle-track:focus-visible {
      box-shadow: 0 0 0 3px rgba(8, 145, 178, 0.3);
    }

    .tgp-toggle-track.on {
      background: var(--tgp-brand);
    }

    .tgp-toggle-thumb {
      position: absolute;
      top: 2px;
      left: 2px;
      width: 24px;
      height: 24px;
      background: white;
      border-radius: 12px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.15);
      transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
    }

    .tgp-toggle-track.on .tgp-toggle-thumb {
      transform: translateX(24px);
    }

    .tgp-savings-badge {
      font-size: 12px;
      font-weight: 700;
      padding: 4px 12px;
      border-radius: 20px;
      background: transparent;
      color: transparent;
      transition: all 0.3s ease;
    }

    .tgp-savings-badge.visible {
      background: color-mix(in srgb, var(--tgp-brand) 12%, transparent);
      color: var(--tgp-brand);
    }

    /* Cards Grid */
    .tgp-grid {
      display: grid;
      gap: 24px;
      max-width: 1120px;
      margin: 0 auto;
    }

    .tgp-grid[data-cols="1"] { grid-template-columns: 1fr; max-width: 400px; }
    .tgp-grid[data-cols="2"] { grid-template-columns: repeat(2, 1fr); max-width: 720px; }
    .tgp-grid[data-cols="3"] { grid-template-columns: repeat(3, 1fr); }
    .tgp-grid[data-cols="4"] { grid-template-columns: repeat(4, 1fr); }

    @media (max-width: 900px) {
      .tgp-grid[data-cols="3"],
      .tgp-grid[data-cols="4"] {
        grid-template-columns: repeat(2, 1fr);
      }
    }

    @media (max-width: 600px) {
      .tgp-grid[data-cols="2"],
      .tgp-grid[data-cols="3"],
      .tgp-grid[data-cols="4"] {
        grid-template-columns: 1fr;
      }
      .tgp-root { padding: 32px 16px; }
      .tgp-title { font-size: 22px; }
    }

    /* Card */
    .tgp-card {
      position: relative;
      display: flex;
      flex-direction: column;
      background: var(--tgp-card-bg);
      border: 1px solid var(--tgp-border);
      border-radius: var(--tgp-radius);
      padding: 28px;
      transition: transform 0.3s ease, box-shadow 0.3s ease;
      box-shadow: 0 1px 3px rgba(0,0,0,0.04);
    }

    .tgp-card:hover {
      transform: translateY(-4px);
      box-shadow: 0 12px 28px rgba(0,0,0,0.07), 0 4px 8px rgba(0,0,0,0.03);
    }

    .tgp-card.featured {
      border: 2px solid var(--tgp-brand);
      box-shadow: 0 4px 16px color-mix(in srgb, var(--tgp-brand) 12%, transparent);
    }

    .tgp-card.featured:hover {
      box-shadow: 0 20px 40px color-mix(in srgb, var(--tgp-brand) 16%, transparent),
                  0 8px 16px rgba(0,0,0,0.05);
    }

    @media (prefers-reduced-motion: reduce) {
      .tgp-card:hover { transform: none; }
      .tgp-toggle-thumb { transition: none; }
      .tgp-price-value { transition: none; }
    }

    /* Badge */
    .tgp-badge {
      position: absolute;
      top: -13px;
      left: 50%;
      transform: translateX(-50%);
      padding: 4px 16px;
      font-size: 12px;
      font-weight: 700;
      color: white;
      border-radius: 20px;
      white-space: nowrap;
      letter-spacing: 0.02em;
      background: linear-gradient(135deg, var(--tgp-brand), var(--tgp-accent));
    }

    /* Plan Header */
    .tgp-plan-header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 6px;
    }

    .tgp-plan-icon {
      width: 40px;
      height: 40px;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--tgp-border);
      transition: background-color 0.2s ease, transform 0.2s ease;
    }

    .tgp-card.featured .tgp-plan-icon {
      background: color-mix(in srgb, var(--tgp-brand) 12%, transparent);
    }

    .tgp-card:hover .tgp-plan-icon {
      transform: rotate(-3deg) scale(1.05);
    }

    .tgp-plan-icon svg {
      width: 18px;
      height: 18px;
      stroke: var(--tgp-subtext);
      fill: none;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .tgp-card.featured .tgp-plan-icon svg {
      stroke: var(--tgp-brand);
    }

    .tgp-plan-name {
      font-size: 18px;
      font-weight: 700;
      color: var(--tgp-text);
    }

    .tgp-plan-desc {
      font-size: 14px;
      color: var(--tgp-subtext);
      line-height: 1.5;
      margin-bottom: 20px;
    }

    /* Pricing */
    .tgp-price {
      margin-bottom: 24px;
    }

    .tgp-price-row {
      display: flex;
      align-items: baseline;
      gap: 2px;
    }

    .tgp-price-currency {
      font-size: 18px;
      font-weight: 500;
      opacity: 0.6;
      color: var(--tgp-text);
    }

    .tgp-price-value {
      font-size: 40px;
      font-weight: 800;
      letter-spacing: -0.03em;
      color: var(--tgp-text);
      font-variant-numeric: tabular-nums;
      transition: opacity 0.2s ease, transform 0.2s ease;
    }

    .tgp-price-value.switching {
      opacity: 0;
      transform: translateY(-8px);
    }

    .tgp-price-period {
      font-size: 14px;
      font-weight: 500;
      color: var(--tgp-subtext);
      margin-left: 4px;
    }

    .tgp-price-savings {
      margin-top: 4px;
      font-size: 13px;
    }

    .tgp-price-savings .old {
      text-decoration: line-through;
      color: var(--tgp-subtext);
      margin-right: 6px;
    }

    .tgp-price-savings .save {
      font-weight: 700;
      color: var(--tgp-brand);
    }

    /* Features */
    .tgp-features {
      list-style: none;
      flex: 1;
      margin-bottom: 28px;
    }

    .tgp-feature {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 6px 0;
    }

    .tgp-feature-icon {
      width: 20px;
      height: 20px;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      margin-top: 1px;
    }

    .tgp-feature-icon.included {
      background: color-mix(in srgb, var(--tgp-brand) 10%, transparent);
    }

    .tgp-feature-icon.excluded {
      background: var(--tgp-border);
    }

    .tgp-feature-icon svg {
      width: 11px;
      height: 11px;
      stroke-width: 3;
      stroke-linecap: round;
      stroke-linejoin: round;
      fill: none;
    }

    .tgp-feature-icon.included svg { stroke: var(--tgp-brand); }
    .tgp-feature-icon.excluded svg { stroke: #CBD5E1; }

    .tgp-root[data-theme="dark"] .tgp-feature-icon.excluded svg { stroke: #475569; }

    .tgp-feature-text {
      font-size: 14px;
      color: var(--tgp-text);
      line-height: 1.4;
    }

    .tgp-feature.excluded .tgp-feature-text {
      color: var(--tgp-subtext);
    }

    .tgp-feature-hint {
      position: relative;
      display: inline-flex;
      align-items: center;
      margin-left: 4px;
      cursor: help;
    }

    .tgp-feature-hint svg {
      width: 12px;
      height: 12px;
      stroke: var(--tgp-subtext);
      opacity: 0.5;
      fill: none;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .tgp-tooltip {
      position: absolute;
      bottom: calc(100% + 8px);
      left: 50%;
      transform: translateX(-50%);
      padding: 6px 12px;
      background: #1E293B;
      color: white;
      font-size: 12px;
      border-radius: 8px;
      white-space: normal;
      max-width: 200px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.15s ease;
      z-index: 10;
      line-height: 1.4;
    }

    .tgp-tooltip::after {
      content: '';
      position: absolute;
      top: 100%;
      left: 50%;
      transform: translateX(-50%);
      border: 5px solid transparent;
      border-top-color: #1E293B;
    }

    .tgp-feature-hint:hover .tgp-tooltip {
      opacity: 1;
    }

    /* CTA Button */
    .tgp-cta {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      width: 100%;
      padding: 12px 16px;
      font-size: 14px;
      font-weight: 600;
      font-family: inherit;
      border-radius: var(--tgp-radius-inner);
      cursor: pointer;
      transition: all 0.2s ease;
      text-decoration: none;
      border: none;
      outline: none;
    }

    .tgp-cta:focus-visible {
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--tgp-brand) 30%, transparent);
    }

    .tgp-cta.primary {
      background: linear-gradient(135deg, var(--tgp-brand), var(--tgp-accent));
      color: white;
    }

    .tgp-cta.primary:hover {
      box-shadow: 0 6px 16px color-mix(in srgb, var(--tgp-brand) 35%, transparent);
      transform: scale(1.02);
    }

    .tgp-cta.secondary {
      background: transparent;
      color: var(--tgp-brand);
      border: 1.5px solid color-mix(in srgb, var(--tgp-brand) 25%, transparent);
    }

    .tgp-cta.secondary:hover {
      background: color-mix(in srgb, var(--tgp-brand) 5%, transparent);
      transform: scale(1.02);
    }

    .tgp-cta svg {
      width: 14px;
      height: 14px;
      stroke: currentColor;
      fill: none;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
      transition: transform 0.2s ease;
    }

    .tgp-cta:hover svg {
      transform: translateX(3px);
    }

    /* Trust Strip */
    .tgp-trust {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      margin-top: 32px;
      opacity: 0.5;
    }

    .tgp-trust svg {
      width: 14px;
      height: 14px;
      stroke: var(--tgp-subtext);
      fill: none;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .tgp-trust-text {
      font-size: 12px;
      font-weight: 500;
      color: var(--tgp-subtext);
    }
  `;

  /* ━━━ SVG ICONS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
  const ICONS = {
    check: '<path d="M20 6L9 17l-5-5"/>',
    x: '<path d="M18 6L6 18M6 6l12 12"/>',
    zap: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
    star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
    crown: '<path d="M2 4l3 12h14l3-12-6 7-4-7-4 7-6-7z"/><path d="M5 16h14v2H5z"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    sparkles: '<path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z"/><path d="M19 13l.75 2.25L22 16l-2.25.75L19 19l-.75-2.25L16 16l2.25-.75L19 13z"/>',
    award: '<circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/>',
    arrowRight: '<path d="M5 12h14M12 5l7 7-7 7"/>',
    helpCircle: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    shieldCheck: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>',
  };

  function icon(name, cls) {
    return `<svg class="${cls || ''}" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">${ICONS[name] || ICONS.zap}</svg>`;
  }

  function iconForPlan(name) {
    const map = { Zap: 'zap', Star: 'star', Crown: 'crown', Shield: 'shield', Sparkles: 'sparkles', Award: 'award' };
    return map[name] || 'zap';
  }

  /* ━━━ WIDGET CLASS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
  class TGPricingWidget {
    constructor(container, config) {
      this.container = container;
      this.config = this._defaults(config);
      this.isYearly = false;
      this.shadow = container.attachShadow({ mode: 'open' });
      this._render();
    }

    _defaults(cfg) {
      return Object.assign({
        header: { title: 'Choose Your Plan', subtitle: 'Start free, upgrade anytime.' },
        brandColor: '#0891B2',
        accentColor: '#6366F1',
        pageBg: '#F8FAFC',
        cardBg: '#FFFFFF',
        textColor: '#0F172A',
        subtextColor: '#64748B',
        borderRadius: 16,
        showToggle: true,
        showBadge: true,
        showIcons: true,
        showDescription: true,
        showHints: true,
        showTrustStrip: true,
        trustText: '30-day money-back guarantee · No contracts · Cancel anytime',
        savingsLabel: 'Save {pct}%',
        theme: 'light',
        plans: [],
      }, cfg || {});
    }

    _render() {
      const c = this.config;
      const hasYearly = c.plans.some(p => p.yearlyPrice > 0);

      let html = `<style>${STYLES}</style>`;
      html += `<div class="tgp-root" data-theme="${c.theme}" style="
        --tgp-brand: ${c.brandColor};
        --tgp-accent: ${c.accentColor};
        --tgp-bg: ${c.theme === 'dark' ? '#0F172A' : c.pageBg};
        --tgp-card-bg: ${c.theme === 'dark' ? '#1E293B' : c.cardBg};
        --tgp-text: ${c.theme === 'dark' ? '#F1F5F9' : c.textColor};
        --tgp-subtext: ${c.theme === 'dark' ? '#94A3B8' : c.subtextColor};
        --tgp-border: ${c.theme === 'dark' ? '#334155' : '#E2E8F0'};
        --tgp-radius: ${c.borderRadius}px;
        --tgp-radius-inner: ${Math.max(c.borderRadius - 4, 8)}px;
      ">`;

      // Header
      html += `<div class="tgp-header">
        <h2 class="tgp-title">${this._esc(c.header.title)}</h2>
        <p class="tgp-subtitle">${this._esc(c.header.subtitle)}</p>
      </div>`;

      // Toggle
      if (c.showToggle && hasYearly) {
        html += `<div class="tgp-toggle-wrap">
          <span class="tgp-toggle-label active" data-period="monthly">Monthly</span>
          <button class="tgp-toggle-track" role="switch" aria-checked="false" aria-label="Toggle billing period">
            <span class="tgp-toggle-thumb"></span>
          </button>
          <span class="tgp-toggle-label" data-period="yearly">Yearly</span>
          <span class="tgp-savings-badge">${this._esc(c.savingsLabel.replace('{pct}', '17'))}</span>
        </div>`;
      }

      // Cards
      const cols = Math.min(c.plans.length, 4);
      html += `<div class="tgp-grid" data-cols="${cols}">`;
      c.plans.forEach((plan, i) => {
        html += this._renderCard(plan, i);
      });
      html += `</div>`;

      // Trust strip
      if (c.showTrustStrip && c.trustText) {
        html += `<div class="tgp-trust">
          ${icon('shieldCheck')}
          <span class="tgp-trust-text">${this._esc(c.trustText)}</span>
        </div>`;
      }

      html += `</div>`;
      this.shadow.innerHTML = html;
      this._bindEvents();
    }

    _renderCard(plan, index) {
      const c = this.config;
      const price = this.isYearly && plan.yearlyPrice > 0 ? plan.yearlyPrice : plan.monthlyPrice;
      const period = plan.yearlyPrice === 0 ? '/person' : (this.isYearly ? '/year' : '/month');
      const currency = plan.currency || '£';
      const featured = plan.highlighted ? ' featured' : '';
      const ctaClass = plan.highlighted ? 'primary' : 'secondary';
      const ctaUrl = plan.ctaUrl || '#';

      let cardHtml = `<div class="tgp-card${featured}" data-index="${index}">`;

      // Badge
      if (plan.highlighted && c.showBadge && plan.badge) {
        cardHtml += `<div class="tgp-badge">${this._esc(plan.badge)}</div>`;
      }

      // Icon + Name
      cardHtml += `<div class="tgp-plan-header">`;
      if (c.showIcons) {
        cardHtml += `<div class="tgp-plan-icon">${icon(iconForPlan(plan.icon))}</div>`;
      }
      cardHtml += `<h3 class="tgp-plan-name">${this._esc(plan.name)}</h3>`;
      cardHtml += `</div>`;

      // Description
      if (c.showDescription && plan.description) {
        cardHtml += `<p class="tgp-plan-desc">${this._esc(plan.description)}</p>`;
      }

      // Price
      cardHtml += `<div class="tgp-price">
        <div class="tgp-price-row">
          <span class="tgp-price-currency">${this._esc(currency)}</span>
          <span class="tgp-price-value" data-monthly="${plan.monthlyPrice}" data-yearly="${plan.yearlyPrice}">${price}</span>
          <span class="tgp-price-period">${period}</span>
        </div>`;

      // Savings line
      if (this.isYearly && plan.yearlyPrice > 0 && plan.monthlyPrice > 0) {
        const fullYear = plan.monthlyPrice * 12;
        const saved = fullYear - plan.yearlyPrice;
        if (saved > 0) {
          cardHtml += `<div class="tgp-price-savings">
            <span class="old">${currency}${fullYear}/yr</span>
            <span class="save">Save ${currency}${saved}</span>
          </div>`;
        }
      }
      cardHtml += `</div>`;

      // Features
      cardHtml += `<ul class="tgp-features">`;
      (plan.features || []).forEach(f => {
        const incCls = f.included ? 'included' : 'excluded';
        const iconName = f.included ? 'check' : 'x';
        cardHtml += `<li class="tgp-feature ${incCls}">
          <span class="tgp-feature-icon ${incCls}">${icon(iconName)}</span>
          <span class="tgp-feature-text">${this._esc(f.text)}`;
        if (c.showHints && f.hint) {
          cardHtml += `<span class="tgp-feature-hint">${icon('helpCircle')}<span class="tgp-tooltip">${this._esc(f.hint)}</span></span>`;
        }
        cardHtml += `</span></li>`;
      });
      cardHtml += `</ul>`;

      // CTA
      cardHtml += `<a href="${this._esc(ctaUrl)}" class="tgp-cta ${ctaClass}" target="_blank" rel="noopener">
        ${this._esc(plan.cta)}${icon('arrowRight')}
      </a>`;

      cardHtml += `</div>`;
      return cardHtml;
    }

    _bindEvents() {
      const track = this.shadow.querySelector('.tgp-toggle-track');
      if (!track) return;

      const labels = this.shadow.querySelectorAll('.tgp-toggle-label');
      const badge = this.shadow.querySelector('.tgp-savings-badge');

      track.addEventListener('click', () => {
        this.isYearly = !this.isYearly;
        track.classList.toggle('on', this.isYearly);
        track.setAttribute('aria-checked', this.isYearly);

        labels.forEach(l => {
          const isActive = (l.dataset.period === 'yearly') === this.isYearly ||
                           (l.dataset.period === 'monthly') === !this.isYearly;
          l.classList.toggle('active', (l.dataset.period === 'monthly' && !this.isYearly) ||
                                       (l.dataset.period === 'yearly' && this.isYearly));
        });

        if (badge) badge.classList.toggle('visible', this.isYearly);

        // Animate prices
        const priceEls = this.shadow.querySelectorAll('.tgp-price-value');
        priceEls.forEach(el => {
          el.classList.add('switching');
          setTimeout(() => {
            const m = parseInt(el.dataset.monthly) || 0;
            const y = parseInt(el.dataset.yearly) || 0;
            el.textContent = (this.isYearly && y > 0) ? y : m;
            el.classList.remove('switching');
          }, 180);
        });

        // Re-render savings lines
        this._updateSavings();
      });

      labels.forEach(l => {
        l.addEventListener('click', () => {
          const wantYearly = l.dataset.period === 'yearly';
          if (wantYearly !== this.isYearly) track.click();
        });
      });
    }

    _updateSavings() {
      const cards = this.shadow.querySelectorAll('.tgp-card');
      cards.forEach((card, i) => {
        const plan = this.config.plans[i];
        if (!plan) return;
        let savingsEl = card.querySelector('.tgp-price-savings');
        const currency = plan.currency || '£';

        if (this.isYearly && plan.yearlyPrice > 0 && plan.monthlyPrice > 0) {
          const fullYear = plan.monthlyPrice * 12;
          const saved = fullYear - plan.yearlyPrice;
          if (saved > 0) {
            if (!savingsEl) {
              savingsEl = document.createElement('div');
              savingsEl.className = 'tgp-price-savings';
              card.querySelector('.tgp-price').appendChild(savingsEl);
            }
            savingsEl.innerHTML = `<span class="old">${currency}${fullYear}/yr</span><span class="save">Save ${currency}${saved}</span>`;
          }
        } else if (savingsEl) {
          savingsEl.remove();
        }
      });

      // Update period labels
      const periodEls = this.shadow.querySelectorAll('.tgp-price-period');
      periodEls.forEach((el, i) => {
        const plan = this.config.plans[i];
        if (!plan) return;
        if (plan.yearlyPrice === 0) return;
        el.textContent = this.isYearly ? '/year' : '/month';
      });
    }

    _esc(str) {
      const div = document.createElement('div');
      div.textContent = str || '';
      return div.innerHTML;
    }

    update(newConfig) {
      this.config = this._defaults(newConfig);
      this.isYearly = false;
      this._render();
    }

    destroy() {
      this.shadow.innerHTML = '';
    }
  }

  /* ━━━ INITIALIZER ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
  async function init() {
    const containers = document.querySelectorAll('[data-tg-widget="pricing"]');
    for (const el of containers) {
      // Inline config
      const inlineConfig = el.dataset.tgConfig;
      if (inlineConfig) {
        try {
          const config = JSON.parse(inlineConfig);
          new TGPricingWidget(el, config);
        } catch (e) {
          console.error('[TG Pricing] Invalid inline config:', e);
        }
        continue;
      }

      // Remote config via widget ID
      const widgetId = el.dataset.tgId;
      if (widgetId) {
        try {
          const resp = await fetch(`${API_BASE}?id=${encodeURIComponent(widgetId)}`);
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const config = await resp.json();
          new TGPricingWidget(el, config);
        } catch (e) {
          console.error('[TG Pricing] Failed to load config:', e);
        }
        continue;
      }

      console.warn('[TG Pricing] Container missing data-tg-id or data-tg-config');
    }
  }

  // Expose for programmatic use
  window.TGPricingWidget = TGPricingWidget;
  window.__TG_PRICING_VERSION__ = VERSION;

  // Auto-init
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
