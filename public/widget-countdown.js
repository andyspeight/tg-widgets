/**
 * Travelgenix Countdown Timer Widget v1.0.0
 * Self-contained, embeddable widget
 * Zero dependencies — works on any website via a single script tag
 *
 * Usage:
 *   <div data-tg-widget="countdown" data-tg-id="YOUR_WIDGET_ID"></div>
 *   <script src="https://tg-widgets.vercel.app/widget-countdown.js"></script>
 *
 * Or with inline config:
 *   <div data-tg-widget="countdown" data-tg-config='{"targetDate":"2026-12-31T23:59:59Z", ...}'></div>
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
      .replace(/'/g, '&#39;');
  }

  // Strict URL validation: allow https://, http:// (with warning), relative paths, anchors. Block anything else.
  function safeUrl(url) {
    if (!url || typeof url !== 'string') return '';
    const trimmed = url.trim();
    if (!trimmed) return '';
    if (trimmed.startsWith('/') || trimmed.startsWith('#')) return trimmed;
    try {
      const u = new URL(trimmed);
      if (u.protocol === 'https:' || u.protocol === 'http:' || u.protocol === 'mailto:' || u.protocol === 'tel:') {
        return u.href;
      }
      return '';
    } catch {
      return '';
    }
  }

  function pad2(n) {
    return n < 10 ? '0' + n : '' + n;
  }

  // Parse ISO target date safely. Returns ms-since-epoch, or null if invalid.
  function parseTarget(iso) {
    if (!iso) return null;
    const t = Date.parse(iso);
    return Number.isFinite(t) ? t : null;
  }

  // Compute remaining time. Returns { total, days, hours, minutes, seconds, expired }.
  function computeRemaining(targetMs) {
    const now = Date.now();
    const diff = Math.max(0, targetMs - now);
    const expired = diff === 0;
    const totalSec = Math.floor(diff / 1000);
    const days = Math.floor(totalSec / 86400);
    const hours = Math.floor((totalSec % 86400) / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);
    const seconds = totalSec % 60;
    return { total: diff, days, hours, minutes, seconds, expired };
  }

  // Compute next occurrence for repeating mode. Returns ms-since-epoch.
  function nextRepeatingTarget(currentTargetMs, freq, dayOfWeek, timeStr) {
    const now = Date.now();
    if (currentTargetMs > now) return currentTargetMs;

    const [hh, mm] = (timeStr || '17:00').split(':').map(Number);
    const next = new Date();
    next.setHours(hh || 0, mm || 0, 0, 0);

    if (freq === 'daily') {
      if (next.getTime() <= now) next.setDate(next.getDate() + 1);
      return next.getTime();
    }
    // weekly
    const target = ((dayOfWeek == null ? 5 : dayOfWeek) % 7); // 0=Sun..6=Sat, default Fri
    const diff = (target - next.getDay() + 7) % 7;
    next.setDate(next.getDate() + diff);
    if (next.getTime() <= now) next.setDate(next.getDate() + 7);
    return next.getTime();
  }

  // ---------- Styles ----------
  const STYLES = `
    :host { all: initial; display: block; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    *, *::before, *::after { box-sizing: border-box; }

    .tgcd-root {
      /* Theme tokens (overridable via config) */
      --tgcd-brand: #1B2B5B;
      --tgcd-accent: #00B4D8;
      --tgcd-bg: transparent;
      --tgcd-card: #FFFFFF;
      --tgcd-text: #0F172A;
      --tgcd-sub: #475569;
      --tgcd-muted: #94A3B8;
      --tgcd-border: #E2E8F0;
      --tgcd-radius: 16px;
      --tgcd-radius-sm: 10px;
      --tgcd-shadow: 0 1px 2px rgba(15,23,42,.04), 0 4px 12px rgba(15,23,42,.06);
      --tgcd-digit-bg: #F8FAFC;
      --tgcd-digit-text: var(--tgcd-text);
      --tgcd-cta-bg: var(--tgcd-brand);
      --tgcd-cta-text: #FFFFFF;
      color: var(--tgcd-text);
      background: var(--tgcd-bg);
      width: 100%;
    }
    .tgcd-root[data-theme="dark"] {
      --tgcd-card: #1E293B;
      --tgcd-text: #F1F5F9;
      --tgcd-sub: #CBD5E1;
      --tgcd-muted: #64748B;
      --tgcd-border: #334155;
      --tgcd-digit-bg: #0F172A;
      --tgcd-digit-text: #F1F5F9;
      --tgcd-shadow: 0 1px 2px rgba(0,0,0,.2), 0 4px 12px rgba(0,0,0,.3);
    }

    /* ---------- Shared digits ---------- */
    .tgcd-units {
      display: flex;
      gap: 12px;
      align-items: flex-end;
      justify-content: center;
      flex-wrap: wrap;
    }
    .tgcd-unit {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
    }
    .tgcd-digits {
      font-feature-settings: 'tnum' 1, 'lnum' 1;
      font-variant-numeric: tabular-nums lining-nums;
      font-weight: 800;
      letter-spacing: -0.02em;
      line-height: 1;
      color: var(--tgcd-digit-text);
      background: var(--tgcd-digit-bg);
      border: 1px solid var(--tgcd-border);
      border-radius: var(--tgcd-radius-sm);
      padding: 14px 16px;
      min-width: 76px;
      text-align: center;
      font-size: 36px;
      transition: color .25s ease, background-color .25s ease, border-color .25s ease;
    }
    .tgcd-label {
      font-size: 11px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      font-weight: 600;
      color: var(--tgcd-sub);
    }
    .tgcd-sep {
      font-size: 32px;
      font-weight: 700;
      color: var(--tgcd-muted);
      padding: 0 2px;
      align-self: center;
      transform: translateY(-9px);
      user-select: none;
    }

    /* Tick animation — only applied when not reduced-motion */
    @media (prefers-reduced-motion: no-preference) {
      .tgcd-digits.tgcd-tick {
        animation: tgcd-tick-anim .35s ease;
      }
      @keyframes tgcd-tick-anim {
        0%   { transform: translateY(0);    opacity: 1; }
        45%  { transform: translateY(-3px); opacity: 0.55; }
        100% { transform: translateY(0);    opacity: 1; }
      }
    }

    /* Urgency styling */
    .tgcd-root.tgcd-urgent .tgcd-digits {
      color: var(--tgcd-accent);
      border-color: var(--tgcd-accent);
    }
    @media (prefers-reduced-motion: no-preference) {
      .tgcd-root.tgcd-urgent .tgcd-unit-seconds .tgcd-digits {
        animation: tgcd-pulse 1s ease-in-out infinite;
      }
      @keyframes tgcd-pulse {
        0%, 100% { box-shadow: 0 0 0 0 rgba(0,180,216,0); }
        50%      { box-shadow: 0 0 0 4px rgba(0,180,216,.18); }
      }
    }

    /* ---------- Heading + sub ---------- */
    .tgcd-heading {
      font-size: 18px;
      font-weight: 700;
      color: var(--tgcd-text);
      margin: 0;
      line-height: 1.3;
      letter-spacing: -0.01em;
    }
    .tgcd-sub {
      font-size: 14px;
      font-weight: 400;
      color: var(--tgcd-sub);
      margin: 0;
      line-height: 1.5;
    }

    /* ---------- CTA ---------- */
    .tgcd-cta {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 12px 22px;
      font-size: 15px;
      font-weight: 600;
      line-height: 1;
      color: var(--tgcd-cta-text);
      background: var(--tgcd-cta-bg);
      border: 1px solid transparent;
      border-radius: var(--tgcd-radius-sm);
      text-decoration: none;
      cursor: pointer;
      transition: transform .15s ease, filter .15s ease, box-shadow .15s ease;
      min-height: 44px;
      white-space: nowrap;
    }
    .tgcd-cta:hover { filter: brightness(1.08); transform: translateY(-1px); }
    .tgcd-cta:active { transform: translateY(0); filter: brightness(0.96); }
    .tgcd-cta:focus-visible { outline: 2px solid var(--tgcd-accent); outline-offset: 2px; }

    /* ---------- BANNER LAYOUT ---------- */
    .tgcd-banner {
      display: flex;
      align-items: center;
      gap: 24px;
      padding: 16px 24px;
      background: var(--tgcd-card);
      border: 1px solid var(--tgcd-border);
      border-radius: var(--tgcd-radius);
      box-shadow: var(--tgcd-shadow);
      flex-wrap: wrap;
      justify-content: center;
    }
    .tgcd-banner .tgcd-banner-text {
      flex: 1;
      min-width: 200px;
    }
    .tgcd-banner .tgcd-heading { font-size: 17px; }
    .tgcd-banner .tgcd-sub { font-size: 13px; margin-top: 2px; }
    .tgcd-banner .tgcd-units { gap: 8px; justify-content: flex-start; }
    .tgcd-banner .tgcd-digits { font-size: 24px; padding: 8px 12px; min-width: 56px; }
    .tgcd-banner .tgcd-label { font-size: 10px; }
    .tgcd-banner .tgcd-sep { font-size: 22px; transform: translateY(-7px); }
    .tgcd-banner .tgcd-cta { padding: 10px 18px; font-size: 14px; min-height: 40px; }

    /* ---------- CARD LAYOUT ---------- */
    .tgcd-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 16px;
      padding: 28px 24px;
      background: var(--tgcd-card);
      border: 1px solid var(--tgcd-border);
      border-radius: var(--tgcd-radius);
      box-shadow: var(--tgcd-shadow);
      text-align: center;
    }
    .tgcd-card .tgcd-heading { font-size: 20px; }
    .tgcd-card .tgcd-sub { font-size: 14px; max-width: 480px; }
    .tgcd-card .tgcd-units { margin-top: 4px; }

    /* ---------- INLINE LAYOUT ---------- */
    .tgcd-inline {
      display: inline-flex;
      align-items: baseline;
      gap: 8px;
      flex-wrap: wrap;
      padding: 6px 12px;
      background: transparent;
      font-size: 15px;
      color: var(--tgcd-text);
    }
    .tgcd-inline .tgcd-heading {
      font-size: 15px;
      font-weight: 500;
      color: var(--tgcd-sub);
      margin-right: 4px;
    }
    .tgcd-inline .tgcd-units { gap: 6px; align-items: baseline; }
    .tgcd-inline .tgcd-unit { flex-direction: row; align-items: baseline; gap: 2px; }
    .tgcd-inline .tgcd-digits {
      background: transparent;
      border: none;
      padding: 0;
      min-width: 0;
      font-size: 16px;
      font-weight: 700;
      color: var(--tgcd-text);
    }
    .tgcd-inline .tgcd-label {
      font-size: 13px;
      font-weight: 500;
      text-transform: lowercase;
      letter-spacing: 0;
      color: var(--tgcd-sub);
    }
    .tgcd-inline .tgcd-sep { display: none; }
    .tgcd-inline .tgcd-cta {
      padding: 4px 10px;
      font-size: 13px;
      min-height: 28px;
      margin-left: 4px;
    }

    /* ---------- HERO LAYOUT ---------- */
    .tgcd-hero {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 24px;
      padding: 48px 32px;
      background: var(--tgcd-card);
      border: 1px solid var(--tgcd-border);
      border-radius: var(--tgcd-radius);
      box-shadow: var(--tgcd-shadow);
      text-align: center;
    }
    .tgcd-hero .tgcd-heading {
      font-size: 36px;
      font-weight: 800;
      letter-spacing: -0.02em;
      line-height: 1.15;
      max-width: 720px;
    }
    .tgcd-hero .tgcd-sub {
      font-size: 17px;
      max-width: 600px;
      line-height: 1.6;
    }
    .tgcd-hero .tgcd-units { gap: 16px; margin: 12px 0; }
    .tgcd-hero .tgcd-digits {
      font-size: 64px;
      padding: 24px 22px;
      min-width: 120px;
      border-radius: 14px;
    }
    .tgcd-hero .tgcd-label { font-size: 12px; }
    .tgcd-hero .tgcd-sep { font-size: 56px; transform: translateY(-16px); }
    .tgcd-hero .tgcd-cta {
      padding: 16px 32px;
      font-size: 16px;
      min-height: 52px;
    }

    /* ---------- Expired ---------- */
    .tgcd-expired {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
      padding: 32px 24px;
      background: var(--tgcd-card);
      border: 1px solid var(--tgcd-border);
      border-radius: var(--tgcd-radius);
      box-shadow: var(--tgcd-shadow);
      text-align: center;
    }
    .tgcd-expired .tgcd-heading { font-size: 18px; }
    .tgcd-expired .tgcd-sub { font-size: 14px; }

    /* ---------- Responsive ---------- */
    @media (max-width: 600px) {
      .tgcd-banner { flex-direction: column; text-align: center; padding: 16px; }
      .tgcd-banner .tgcd-banner-text { text-align: center; }
      .tgcd-banner .tgcd-units { justify-content: center; }
      .tgcd-card { padding: 24px 16px; }
      .tgcd-hero { padding: 32px 20px; }
      .tgcd-hero .tgcd-heading { font-size: 26px; }
      .tgcd-hero .tgcd-digits { font-size: 40px; padding: 16px 14px; min-width: 80px; }
      .tgcd-hero .tgcd-sep { font-size: 36px; transform: translateY(-10px); }
      .tgcd-digits { font-size: 28px; padding: 10px 12px; min-width: 60px; }
      .tgcd-sep { font-size: 24px; transform: translateY(-7px); }
    }
    @media (max-width: 360px) {
      .tgcd-units { gap: 6px; }
      .tgcd-digits { font-size: 24px; padding: 8px 10px; min-width: 52px; }
      .tgcd-hero .tgcd-digits { font-size: 32px; min-width: 64px; }
    }
  `;

  // ---------- Defaults ----------
  function defaults() {
    return {
      layout: 'card', // banner | card | inline | hero
      theme: 'light', // light | dark
      targetDate: null, // ISO string
      timezone: 'Europe/London', // display label only; the ISO above is the source of truth
      heading: 'Sale ends in',
      subheading: '',
      cta: { text: '', url: '', openInNewTab: true },
      expiry: { behaviour: 'message', message: 'This offer has now ended.' }, // hide | message | cta-only
      display: { showDays: true, showHours: true, showMinutes: true, showSeconds: true },
      repeating: { enabled: false, frequency: 'weekly', dayOfWeek: 5, time: '17:00' },
      urgency: { enabled: true, thresholdHours: 24 },
      animation: { tick: true },
      colours: {
        brand: '#1B2B5B',
        accent: '#00B4D8',
        bg: 'transparent',
        card: '#FFFFFF',
        text: '#0F172A',
        digitBg: '#F8FAFC',
        ctaBg: '',     // empty = use brand
        ctaText: '#FFFFFF'
      },
      radius: 16
    };
  }

  function mergeConfig(d, c) {
    if (!c) return d;
    const out = JSON.parse(JSON.stringify(d));
    for (const k of Object.keys(c)) {
      if (c[k] && typeof c[k] === 'object' && !Array.isArray(c[k]) && out[k] && typeof out[k] === 'object') {
        out[k] = Object.assign({}, out[k], c[k]);
      } else if (c[k] !== undefined) {
        out[k] = c[k];
      }
    }
    return out;
  }

  // ---------- Widget class ----------
  class TGCountdownWidget {
    constructor(container, config) {
      this.el = container;
      this.c = mergeConfig(defaults(), config);
      this.shadow = container.attachShadow({ mode: 'open' });
      this._lastValues = {};
      this._timerId = null;
      this._render();
    }

    update(newConfig) {
      this.c = mergeConfig(defaults(), newConfig);
      this._lastValues = {};
      this._stop();
      this._render();
    }

    destroy() {
      this._stop();
      try { this.shadow.innerHTML = ''; } catch {}
    }

    _stop() {
      if (this._timerId) { clearInterval(this._timerId); this._timerId = null; }
    }

    _resolveTarget() {
      let t = parseTarget(this.c.targetDate);
      if (this.c.repeating && this.c.repeating.enabled) {
        // If repeating, always use the next occurrence (rolls over silently when expired)
        const base = t || Date.now();
        if (Date.now() >= base) {
          t = nextRepeatingTarget(base, this.c.repeating.frequency, this.c.repeating.dayOfWeek, this.c.repeating.time);
        }
      }
      return t;
    }

    _render() {
      const c = this.c;
      const targetMs = this._resolveTarget();

      // Build root
      const root = document.createElement('div');
      root.className = 'tgcd-root';
      root.setAttribute('data-theme', c.theme === 'dark' ? 'dark' : 'light');

      // Apply config-driven CSS vars
      const cs = c.colours || {};
      if (cs.brand)   root.style.setProperty('--tgcd-brand',   cs.brand);
      if (cs.accent)  root.style.setProperty('--tgcd-accent',  cs.accent);
      if (cs.bg !== undefined) root.style.setProperty('--tgcd-bg', cs.bg);
      if (cs.card)    root.style.setProperty('--tgcd-card',    cs.card);
      if (cs.text)    root.style.setProperty('--tgcd-text',    cs.text);
      if (cs.digitBg) root.style.setProperty('--tgcd-digit-bg', cs.digitBg);
      root.style.setProperty('--tgcd-cta-bg', cs.ctaBg || cs.brand || '#1B2B5B');
      if (cs.ctaText) root.style.setProperty('--tgcd-cta-text', cs.ctaText);
      if (typeof c.radius === 'number') {
        root.style.setProperty('--tgcd-radius', c.radius + 'px');
        root.style.setProperty('--tgcd-radius-sm', Math.max(4, c.radius - 6) + 'px');
      }

      // Style block
      const style = document.createElement('style');
      style.textContent = STYLES;

      // Decide what to render
      const remaining = targetMs ? computeRemaining(targetMs) : null;
      const isExpired = !targetMs || (remaining && remaining.expired);

      if (isExpired && !(c.repeating && c.repeating.enabled)) {
        const node = this._buildExpired();
        root.appendChild(node);
      } else {
        const node = this._buildLayout(remaining || { days: 0, hours: 0, minutes: 0, seconds: 0, total: 0 });
        root.appendChild(node);
      }

      // Mount
      this.shadow.innerHTML = '';
      this.shadow.appendChild(style);
      this.shadow.appendChild(root);
      this._root = root;

      // Start ticking only if there's a live countdown
      if (!isExpired || (c.repeating && c.repeating.enabled)) {
        this._tick(true);
        this._timerId = setInterval(() => this._tick(false), 1000);
      }
    }

    _buildExpired() {
      const c = this.c;
      const wrap = document.createElement('div');
      wrap.className = 'tgcd-expired';

      if (c.expiry.behaviour === 'hide') {
        wrap.style.display = 'none';
        return wrap;
      }

      if (c.expiry.behaviour === 'cta-only' && c.cta && c.cta.text && safeUrl(c.cta.url)) {
        const cta = this._buildCta();
        if (cta) wrap.appendChild(cta);
        return wrap;
      }

      // message
      const h = document.createElement('p');
      h.className = 'tgcd-heading';
      h.textContent = c.expiry.message || 'This offer has now ended.';
      wrap.appendChild(h);
      if (c.cta && c.cta.text && safeUrl(c.cta.url)) {
        const cta = this._buildCta();
        if (cta) wrap.appendChild(cta);
      }
      return wrap;
    }

    _buildLayout(remaining) {
      switch (this.c.layout) {
        case 'banner': return this._buildBanner(remaining);
        case 'inline': return this._buildInline(remaining);
        case 'hero':   return this._buildHero(remaining);
        case 'card':
        default:       return this._buildCard(remaining);
      }
    }

    _buildBanner(remaining) {
      const c = this.c;
      const wrap = document.createElement('div');
      wrap.className = 'tgcd-banner';

      const text = document.createElement('div');
      text.className = 'tgcd-banner-text';
      if (c.heading) {
        const h = document.createElement('p');
        h.className = 'tgcd-heading';
        h.textContent = c.heading;
        text.appendChild(h);
      }
      if (c.subheading) {
        const s = document.createElement('p');
        s.className = 'tgcd-sub';
        s.textContent = c.subheading;
        text.appendChild(s);
      }
      wrap.appendChild(text);
      wrap.appendChild(this._buildUnits(remaining));

      const cta = this._buildCta();
      if (cta) wrap.appendChild(cta);

      return wrap;
    }

    _buildCard(remaining) {
      const c = this.c;
      const wrap = document.createElement('div');
      wrap.className = 'tgcd-card';

      if (c.heading) {
        const h = document.createElement('p');
        h.className = 'tgcd-heading';
        h.textContent = c.heading;
        wrap.appendChild(h);
      }
      wrap.appendChild(this._buildUnits(remaining));
      if (c.subheading) {
        const s = document.createElement('p');
        s.className = 'tgcd-sub';
        s.textContent = c.subheading;
        wrap.appendChild(s);
      }
      const cta = this._buildCta();
      if (cta) wrap.appendChild(cta);
      return wrap;
    }

    _buildInline(remaining) {
      const c = this.c;
      const wrap = document.createElement('span');
      wrap.className = 'tgcd-inline';

      if (c.heading) {
        const h = document.createElement('span');
        h.className = 'tgcd-heading';
        h.textContent = c.heading;
        wrap.appendChild(h);
      }
      wrap.appendChild(this._buildUnits(remaining));
      const cta = this._buildCta();
      if (cta) wrap.appendChild(cta);
      return wrap;
    }

    _buildHero(remaining) {
      const c = this.c;
      const wrap = document.createElement('div');
      wrap.className = 'tgcd-hero';

      if (c.heading) {
        const h = document.createElement('h2');
        h.className = 'tgcd-heading';
        h.textContent = c.heading;
        wrap.appendChild(h);
      }
      if (c.subheading) {
        const s = document.createElement('p');
        s.className = 'tgcd-sub';
        s.textContent = c.subheading;
        wrap.appendChild(s);
      }
      wrap.appendChild(this._buildUnits(remaining));
      const cta = this._buildCta();
      if (cta) wrap.appendChild(cta);
      return wrap;
    }

    _buildUnits(remaining) {
      const c = this.c;
      const units = document.createElement('div');
      units.className = 'tgcd-units';
      units.setAttribute('role', 'timer');
      units.setAttribute('aria-live', 'off'); // reduces SR noise on tick
      units.setAttribute('aria-atomic', 'true');

      const list = [];
      if (c.display.showDays)    list.push(['days',    'Days',    remaining.days]);
      if (c.display.showHours)   list.push(['hours',   'Hours',   remaining.hours]);
      if (c.display.showMinutes) list.push(['minutes', 'Minutes', remaining.minutes]);
      if (c.display.showSeconds) list.push(['seconds', 'Seconds', remaining.seconds]);

      list.forEach((item, idx) => {
        const [key, label, val] = item;
        const unit = document.createElement('div');
        unit.className = 'tgcd-unit tgcd-unit-' + key;

        const dig = document.createElement('div');
        dig.className = 'tgcd-digits';
        dig.setAttribute('data-unit', key);
        // Days can exceed 99 — let it grow naturally
        dig.textContent = key === 'days' ? String(val) : pad2(val);
        unit.appendChild(dig);

        const lab = document.createElement('div');
        lab.className = 'tgcd-label';
        lab.textContent = label;
        unit.appendChild(lab);

        units.appendChild(unit);

        if (idx < list.length - 1 && c.layout !== 'inline') {
          const sep = document.createElement('div');
          sep.className = 'tgcd-sep';
          sep.setAttribute('aria-hidden', 'true');
          sep.textContent = ':';
          units.appendChild(sep);
        }
      });

      return units;
    }

    _buildCta() {
      const c = this.c;
      if (!c.cta || !c.cta.text) return null;
      const url = safeUrl(c.cta.url);
      if (!url) return null;
      const a = document.createElement('a');
      a.className = 'tgcd-cta';
      a.textContent = c.cta.text;
      a.setAttribute('href', url);
      if (c.cta.openInNewTab) {
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener noreferrer');
      }
      return a;
    }

    _tick(initial) {
      const targetMs = this._resolveTarget();
      if (!targetMs) return;
      const r = computeRemaining(targetMs);

      // Update each digit cell + apply tick animation only when value changed
      const c = this.c;
      const root = this._root;
      if (!root) return;

      const map = { days: r.days, hours: r.hours, minutes: r.minutes, seconds: r.seconds };
      Object.keys(map).forEach((key) => {
        const cell = root.querySelector('.tgcd-digits[data-unit="' + key + '"]');
        if (!cell) return;
        const newText = key === 'days' ? String(map[key]) : pad2(map[key]);
        if (cell.textContent !== newText) {
          cell.textContent = newText;
          if (!initial && c.animation && c.animation.tick) {
            cell.classList.remove('tgcd-tick');
            // Force reflow so the animation restarts
            void cell.offsetWidth;
            cell.classList.add('tgcd-tick');
          }
        }
      });

      // Urgency mode
      if (c.urgency && c.urgency.enabled) {
        const thresholdMs = (c.urgency.thresholdHours || 24) * 3600 * 1000;
        if (r.total > 0 && r.total <= thresholdMs) {
          root.classList.add('tgcd-urgent');
        } else {
          root.classList.remove('tgcd-urgent');
        }
      }

      // Expired
      if (r.expired) {
        if (c.repeating && c.repeating.enabled) {
          // Roll over to next occurrence — re-render
          this._stop();
          this._render();
        } else {
          this._stop();
          this._render(); // re-render into expired state
        }
      }
    }
  }

  // ---------- Auto-init ----------
  async function fetchConfig(id) {
    try {
      const res = await fetch(API_BASE + '?id=' + encodeURIComponent(id), { method: 'GET' });
      if (!res.ok) return null;
      const data = await res.json();
      return data && data.config ? data.config : null;
    } catch {
      return null;
    }
  }

  async function initOne(el) {
    if (el.__tgcdInit) return;
    el.__tgcdInit = true;
    let cfg = null;
    const inline = el.getAttribute('data-tg-config');
    if (inline) {
      try { cfg = JSON.parse(inline); } catch { cfg = null; }
    } else {
      const id = el.getAttribute('data-tg-id');
      if (id) cfg = await fetchConfig(id);
    }
    try {
      const w = new TGCountdownWidget(el, cfg || {});
      el.__tgcd = w;
    } catch (e) {
      // Fail safe — empty widget if anything goes wrong
      try { console.warn('[TGCountdown] init failed', e); } catch {}
    }
  }

  function init() {
    const els = document.querySelectorAll('[data-tg-widget="countdown"]');
    els.forEach(initOne);
  }

  window.TGCountdownWidget = TGCountdownWidget;
  window.__TG_COUNTDOWN_VERSION__ = VERSION;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
