/**
 * Travelgenix Countdown Timer Widget v1.2.0
 * Self-contained, embeddable widget
 * Zero dependencies — works on any website via a single script tag
 *
 * v1.1.0 added the "wow" effects: sliding digit reels, gradient digit cells,
 * brand glow, final-minute progress ring, hero aurora, banner pulse dot.
 * All effects respect prefers-reduced-motion.
 *
 * v1.2.0 adds:
 *   - Redirect on expiry (alongside hide / message / cta-only)
 *   - Optional frozen 00:00:00 counters above the expiry message
 *   - Sticky top / sticky bottom Banner positioning + dismiss button
 *   - Scheduled-start (widget hidden until a chosen date)
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
  const VERSION = '1.2.0';

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

  // Convert "#1B2B5B" → "27, 43, 91" for use in rgba() CSS vars.
  // Returns empty string for invalid input — caller falls back to defaults in CSS.
  function hexToRgb(hex) {
    if (!hex || typeof hex !== 'string') return '';
    let h = hex.trim().replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    if (!/^[0-9a-f]{6}$/i.test(h)) return '';
    const n = parseInt(h, 16);
    return ((n >> 16) & 255) + ', ' + ((n >> 8) & 255) + ', ' + (n & 255);
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
      --tgcd-brand-rgb: 27, 43, 91;
      --tgcd-accent: #00B4D8;
      --tgcd-accent-rgb: 0, 180, 216;
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
      position: relative;
    }

    /* Digit cell — gradient surface with subtle inner highlight */
    .tgcd-digits {
      position: relative;
      font-feature-settings: 'tnum' 1, 'lnum' 1;
      font-variant-numeric: tabular-nums lining-nums;
      font-weight: 800;
      letter-spacing: -0.02em;
      line-height: 1;
      color: var(--tgcd-digit-text);
      background:
        linear-gradient(180deg, rgba(255,255,255,.55) 0%, transparent 35%),
        linear-gradient(180deg, var(--tgcd-digit-bg) 0%, color-mix(in srgb, var(--tgcd-digit-bg) 88%, var(--tgcd-brand) 12%) 100%);
      border: 1px solid var(--tgcd-border);
      border-radius: var(--tgcd-radius-sm);
      padding: 14px 16px;
      min-width: 76px;
      text-align: center;
      font-size: 36px;
      transition: color .25s ease, border-color .25s ease, box-shadow .35s ease, transform .15s ease;
      overflow: hidden;
      isolation: isolate;
    }
    /* Soft brand glow (gated behind .tgcd-glow on root) */
    .tgcd-root.tgcd-glow .tgcd-digits {
      box-shadow:
        0 1px 0 rgba(255,255,255,.5) inset,
        0 -1px 0 rgba(0,0,0,.04) inset,
        0 6px 18px -8px rgba(var(--tgcd-brand-rgb), .35),
        0 2px 4px rgba(15,23,42,.04);
    }
    .tgcd-root[data-theme="dark"] .tgcd-digits {
      background:
        linear-gradient(180deg, rgba(255,255,255,.04) 0%, transparent 50%),
        linear-gradient(180deg, var(--tgcd-digit-bg) 0%, color-mix(in srgb, var(--tgcd-digit-bg) 80%, var(--tgcd-brand) 20%) 100%);
    }
    .tgcd-root[data-theme="dark"].tgcd-glow .tgcd-digits {
      box-shadow:
        0 1px 0 rgba(255,255,255,.06) inset,
        0 -1px 0 rgba(0,0,0,.3) inset,
        0 8px 22px -10px rgba(var(--tgcd-accent-rgb), .35),
        0 2px 6px rgba(0,0,0,.3);
    }

    /* Sliding digit reels */
    .tgcd-reel {
      display: inline-flex;
      flex-direction: column;
      vertical-align: middle;
      height: 1em;
      line-height: 1;
      overflow: hidden;
      position: relative;
    }
    .tgcd-reel-cur, .tgcd-reel-nxt {
      display: block;
      height: 1em;
      line-height: 1;
    }
    /* Default: no transition (set on first paint) */
    .tgcd-reel.is-animating .tgcd-reel-cur,
    .tgcd-reel.is-animating .tgcd-reel-nxt {
      transition: transform .45s cubic-bezier(.2,.7,.2,1), opacity .45s ease;
    }
    .tgcd-reel.is-animating .tgcd-reel-cur { transform: translateY(-100%); opacity: 0; }
    .tgcd-reel.is-animating .tgcd-reel-nxt { transform: translateY(-100%); opacity: 1; }
    /* Reduced motion fallback — instant swap */
    @media (prefers-reduced-motion: reduce) {
      .tgcd-reel.is-animating .tgcd-reel-cur,
      .tgcd-reel.is-animating .tgcd-reel-nxt {
        transition: none !important;
      }
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

    /* Final-minute progress ring around the seconds cell */
    .tgcd-ring {
      position: absolute;
      inset: -6px;
      pointer-events: none;
      opacity: 0;
      transition: opacity .3s ease;
    }
    .tgcd-root.tgcd-final-min .tgcd-ring {
      opacity: 1;
    }
    .tgcd-ring circle {
      fill: none;
      stroke-width: 2.5;
      stroke-linecap: round;
      transform: rotate(-90deg);
      transform-origin: center;
    }
    .tgcd-ring .tgcd-ring-track { stroke: var(--tgcd-border); }
    .tgcd-ring .tgcd-ring-fill  { stroke: var(--tgcd-accent); transition: stroke-dashoffset .95s linear; }

    /* Urgency styling */
    .tgcd-root.tgcd-urgent .tgcd-digits {
      color: var(--tgcd-accent);
      border-color: color-mix(in srgb, var(--tgcd-accent) 60%, var(--tgcd-border));
    }
    .tgcd-root.tgcd-urgent.tgcd-glow .tgcd-digits {
      box-shadow:
        0 1px 0 rgba(255,255,255,.5) inset,
        0 -1px 0 rgba(0,0,0,.04) inset,
        0 8px 24px -6px rgba(var(--tgcd-accent-rgb), .55),
        0 2px 4px rgba(15,23,42,.06);
    }
    @media (prefers-reduced-motion: no-preference) {
      .tgcd-root.tgcd-urgent .tgcd-unit-seconds .tgcd-digits {
        animation: tgcd-pulse 1.4s ease-in-out infinite;
      }
      @keyframes tgcd-pulse {
        0%, 100% { box-shadow:
          0 1px 0 rgba(255,255,255,.5) inset,
          0 -1px 0 rgba(0,0,0,.04) inset,
          0 0 0 0 rgba(var(--tgcd-accent-rgb), 0); }
        50%      { box-shadow:
          0 1px 0 rgba(255,255,255,.5) inset,
          0 -1px 0 rgba(0,0,0,.04) inset,
          0 0 0 6px rgba(var(--tgcd-accent-rgb), .15); }
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
      position: relative;
      overflow: hidden;
    }
    .tgcd-banner .tgcd-banner-text {
      flex: 1;
      min-width: 200px;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .tgcd-banner .tgcd-heading { font-size: 17px; }
    .tgcd-banner .tgcd-sub { font-size: 13px; margin-top: 2px; }
    .tgcd-banner .tgcd-units { gap: 8px; justify-content: flex-start; }
    .tgcd-banner .tgcd-digits { font-size: 24px; padding: 8px 12px; min-width: 56px; }
    .tgcd-banner .tgcd-label { font-size: 10px; }
    .tgcd-banner .tgcd-sep { font-size: 22px; transform: translateY(-7px); }
    .tgcd-banner .tgcd-cta { padding: 10px 18px; font-size: 14px; min-height: 40px; }

    /* Sticky-bar variants — pin to top or bottom of viewport.
       Position: fixed inside Shadow DOM still resolves against the viewport,
       not the host element. Tested in Chrome/Safari/Firefox. */
    .tgcd-banner-sticky-top, .tgcd-banner-sticky-bottom {
      position: fixed;
      left: 0; right: 0;
      width: 100%;
      max-width: 100%;
      border-radius: 0;
      border-left: none;
      border-right: none;
      z-index: 9998;
    }
    .tgcd-banner-sticky-top  { top: 0;    border-top: none; }
    .tgcd-banner-sticky-bottom { bottom: 0; border-bottom: none; }

    /* Close button on dismissible sticky bars */
    .tgcd-banner-close {
      appearance: none;
      background: transparent;
      border: none;
      color: var(--tgcd-sub, #475569);
      font-size: 22px;
      line-height: 1;
      width: 32px; height: 32px;
      border-radius: 6px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      padding: 0;
      transition: background-color .15s ease, color .15s ease;
    }
    .tgcd-banner-close:hover { background: rgba(0,0,0,.06); color: var(--tgcd-text); }
    .tgcd-banner-close:focus-visible { outline: 2px solid var(--tgcd-accent); outline-offset: 2px; }
    .tgcd-root[data-theme="dark"] .tgcd-banner-close:hover { background: rgba(255,255,255,.08); }
    /* Banner ticker dot — pulses next to the heading */
    .tgcd-banner-dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: var(--tgcd-accent);
      flex-shrink: 0;
      box-shadow: 0 0 0 0 rgba(var(--tgcd-accent-rgb), .5);
    }
    @media (prefers-reduced-motion: no-preference) {
      .tgcd-banner-dot {
        animation: tgcd-dot-pulse 2.2s ease-in-out infinite;
      }
      @keyframes tgcd-dot-pulse {
        0%, 100% { box-shadow: 0 0 0 0 rgba(var(--tgcd-accent-rgb), .5); }
        50%      { box-shadow: 0 0 0 6px rgba(var(--tgcd-accent-rgb), 0); }
      }
    }

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
      position: relative;
      overflow: hidden;
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
      box-shadow: none !important;
      overflow: visible;
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
    .tgcd-inline .tgcd-ring { display: none; }

    /* ---------- HERO LAYOUT ---------- */
    .tgcd-hero {
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 24px;
      padding: 56px 32px;
      background: var(--tgcd-card);
      border: 1px solid var(--tgcd-border);
      border-radius: var(--tgcd-radius);
      box-shadow: var(--tgcd-shadow);
      text-align: center;
      overflow: hidden;
      isolation: isolate;
    }
    /* Aurora — gated behind .tgcd-aurora on the hero element */
    .tgcd-hero.tgcd-aurora::before {
      content: '';
      position: absolute;
      inset: -20%;
      z-index: -1;
      background:
        radial-gradient(40% 50% at 20% 30%, rgba(var(--tgcd-brand-rgb), .35) 0%, transparent 60%),
        radial-gradient(45% 55% at 80% 25%, rgba(var(--tgcd-accent-rgb), .35) 0%, transparent 65%),
        radial-gradient(50% 60% at 70% 80%, rgba(var(--tgcd-brand-rgb), .25) 0%, transparent 60%),
        radial-gradient(35% 45% at 25% 75%, rgba(var(--tgcd-accent-rgb), .25) 0%, transparent 60%);
      filter: blur(40px);
      opacity: .9;
    }
    @media (prefers-reduced-motion: no-preference) {
      .tgcd-hero.tgcd-aurora::before {
        animation: tgcd-aurora 18s ease-in-out infinite alternate;
      }
      @keyframes tgcd-aurora {
        0%   { transform: translate(0%, 0%) rotate(0deg) scale(1); }
        50%  { transform: translate(-3%, 2%) rotate(8deg) scale(1.05); }
        100% { transform: translate(2%, -2%) rotate(-6deg) scale(1.02); }
      }
    }
    .tgcd-hero.tgcd-aurora::after {
      /* Soft inner vignette so aurora doesn't overwhelm the centre content */
      content: '';
      position: absolute;
      inset: 0;
      z-index: -1;
      background: radial-gradient(60% 50% at 50% 50%, transparent 0%, rgba(255,255,255,.5) 100%);
      pointer-events: none;
    }
    .tgcd-root[data-theme="dark"] .tgcd-hero.tgcd-aurora::after {
      background: radial-gradient(60% 50% at 50% 50%, transparent 0%, rgba(15,23,42,.5) 100%);
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
      .tgcd-banner .tgcd-banner-text { justify-content: center; text-align: center; }
      .tgcd-banner .tgcd-units { justify-content: center; }
      .tgcd-card { padding: 24px 16px; }
      .tgcd-hero { padding: 40px 20px; }
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
      expiry: {
        behaviour: 'message', // hide | message | cta-only | redirect
        message: 'This offer has now ended.',
        redirectUrl: '', // for behaviour: 'redirect' — must be safe URL
        keepCounters: false // when true, show 00:00:00 digits above the expired message/CTA
      },
      banner: {
        position: 'static', // static | sticky-top | sticky-bottom — applies to Banner layout only
        dismissible: false  // adds a × close button on sticky bars (and only sticky bars)
      },
      scheduledStart: null, // ISO string — widget stays hidden until this date passes (null = always visible)
      display: { showDays: true, showHours: true, showMinutes: true, showSeconds: true },
      repeating: { enabled: false, frequency: 'weekly', dayOfWeek: 5, time: '17:00' },
      urgency: { enabled: true, thresholdHours: 24 },
      animation: { tick: true },
      wow: {
        slidingDigits: true,    // digits slide up reel-style on change
        gradientCells: true,    // brand-tinted gradient on digit cells (vs flat colour)
        glow: true,             // soft brand-coloured glow under digit cells
        finalMinuteRing: true,  // SVG progress ring around seconds in final 60s
        heroAurora: true,       // animated aurora background behind the Hero layout
        bannerDot: true         // pulsing dot next to the heading on Banner layout
      },
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
      this._dismissed = false;
      this._redirected = false;

      // Honour a previous dismissal on a sticky bar (only Banner can be
      // dismissed, but the check is cheap and harmless for other layouts).
      try {
        const id = container.getAttribute('data-tg-id');
        if (id && localStorage.getItem('tgcd-dismissed-' + id) === '1') {
          this._dismissed = true;
        }
      } catch {}

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
      if (this._timerId) {
        // _timerId may be from setInterval (normal tick) or setTimeout
        // (waiting for scheduledStart). Clear both to be safe.
        clearInterval(this._timerId);
        clearTimeout(this._timerId);
        this._timerId = null;
      }
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

      // Mount style block once per render (Shadow DOM is wiped each time)
      const style = document.createElement('style');
      style.textContent = STYLES;
      this.shadow.innerHTML = '';
      this.shadow.appendChild(style);

      // ── Scheduled start: render nothing until the start date arrives ──
      // Useful for "set up the Black Friday banner in October, leave it on the
      // site, it appears on its own". Re-render is scheduled via setTimeout so
      // the widget wakes up exactly when it should.
      if (c.scheduledStart) {
        const startMs = parseTarget(c.scheduledStart);
        if (startMs && startMs > Date.now()) {
          // Stay invisible. Schedule a wake-up — but cap setTimeout at
          // 24 days because some browsers cap the int32 setTimeout argument.
          const waitMs = Math.min(startMs - Date.now(), 24 * 24 * 60 * 60 * 1000);
          this._stop();
          this._timerId = setTimeout(() => this._render(), waitMs);
          return;
        }
      }

      // ── Dismissed: if the user closed a sticky bar, stay hidden ──
      if (this._dismissed) return;

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
      // RGB tokens for rgba() in CSS — used by glow + aurora
      const brandRgb = hexToRgb(cs.brand || '#1B2B5B');
      const accentRgb = hexToRgb(cs.accent || '#00B4D8');
      if (brandRgb)  root.style.setProperty('--tgcd-brand-rgb',  brandRgb);
      if (accentRgb) root.style.setProperty('--tgcd-accent-rgb', accentRgb);
      if (typeof c.radius === 'number') {
        root.style.setProperty('--tgcd-radius', c.radius + 'px');
        root.style.setProperty('--tgcd-radius-sm', Math.max(4, c.radius - 6) + 'px');
      }
      // Wow flags — opt-in CSS classes on the root
      const wow = c.wow || {};
      if (wow.glow) root.classList.add('tgcd-glow');

      // Decide what to render
      const remaining = targetMs ? computeRemaining(targetMs) : null;
      const isExpired = !targetMs || (remaining && remaining.expired);
      const repeating = !!(c.repeating && c.repeating.enabled);

      // ── Redirect on expiry — fire once, never in repeating mode, never
      //    if scheduledStart hasn't passed (already returned above) ──
      if (isExpired && !repeating && c.expiry && c.expiry.behaviour === 'redirect') {
        const url = safeUrl(c.expiry.redirectUrl || '');
        if (url && !this._redirected) {
          this._redirected = true;
          // Brief delay so any analytics tags can fire and so the page doesn't
          // navigate from underneath an open form. Hidden during the wait.
          try { setTimeout(() => { window.location.href = url; }, 250); } catch {}
          return; // render nothing
        }
        // No valid URL → silently fall through to a hidden state
        return;
      }

      if (isExpired && !repeating) {
        const node = this._buildExpired(remaining);
        root.appendChild(node);
      } else {
        const node = this._buildLayout(remaining || { days: 0, hours: 0, minutes: 0, seconds: 0, total: 0 });
        root.appendChild(node);
      }

      this.shadow.appendChild(root);
      this._root = root;

      // Start ticking only if there's a live countdown
      if (!isExpired || repeating) {
        this._tick(true);
        this._timerId = setInterval(() => this._tick(false), 1000);
      }
    }

    _buildExpired(remaining) {
      const c = this.c;
      const wrap = document.createElement('div');
      wrap.className = 'tgcd-expired';

      if (c.expiry.behaviour === 'hide') {
        wrap.style.display = 'none';
        return wrap;
      }

      // Optionally render frozen 00:00:00 digits above the expired UI
      if (c.expiry.keepCounters) {
        const frozen = { days: 0, hours: 0, minutes: 0, seconds: 0, total: 0 };
        wrap.appendChild(this._buildUnits(frozen));
      }

      if (c.expiry.behaviour === 'cta-only' && c.cta && c.cta.text && safeUrl(c.cta.url)) {
        const cta = this._buildCta();
        if (cta) wrap.appendChild(cta);
        return wrap;
      }

      // message (default fallback for any unknown behaviour like 'redirect'
      // that didn't hit because of a missing/bad URL)
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

      // Sticky bar positioning. Only Banner supports this — the other
      // layouts (Card/Inline/Hero) are designed to live inside the page flow.
      const pos = (c.banner && c.banner.position) || 'static';
      if (pos === 'sticky-top') wrap.classList.add('tgcd-banner-sticky-top');
      else if (pos === 'sticky-bottom') wrap.classList.add('tgcd-banner-sticky-bottom');

      const text = document.createElement('div');
      text.className = 'tgcd-banner-text';
      if (c.wow && c.wow.bannerDot && c.heading) {
        const dot = document.createElement('span');
        dot.className = 'tgcd-banner-dot';
        dot.setAttribute('aria-hidden', 'true');
        text.appendChild(dot);
      }
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

      // Dismiss button — only when sticky AND dismissible
      // (a static banner doesn't need a close button — it's part of the page)
      const isSticky = pos === 'sticky-top' || pos === 'sticky-bottom';
      if (isSticky && c.banner && c.banner.dismissible) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'tgcd-banner-close';
        btn.setAttribute('aria-label', 'Dismiss');
        btn.textContent = '\u00D7'; // ×
        btn.addEventListener('click', () => {
          this._dismissed = true;
          this._stop();
          this.shadow.innerHTML = '';
          // Persist across reloads using a per-widget key. Falls back silently
          // if storage isn't available (private browsing, etc.).
          try {
            const key = 'tgcd-dismissed-' + (this.el.getAttribute('data-tg-id') || 'inline');
            localStorage.setItem(key, '1');
          } catch {}
        });
        wrap.appendChild(btn);
      }

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
      if (c.wow && c.wow.heroAurora) wrap.classList.add('tgcd-aurora');

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
      const useReels = !!(c.wow && c.wow.slidingDigits);
      const useRing  = !!(c.wow && c.wow.finalMinuteRing);

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

        const formatted = key === 'days' ? String(val) : pad2(val);

        if (useReels && c.layout !== 'inline') {
          // Reel: a clip-masked container with two stacked digit spans.
          // .tgcd-reel-cur shows the current value; .tgcd-reel-nxt is hidden below.
          // On tick we set the next value into .tgcd-reel-nxt, then trigger the slide.
          const reel = document.createElement('span');
          reel.className = 'tgcd-reel';
          reel.setAttribute('data-reel', key);

          const cur = document.createElement('span');
          cur.className = 'tgcd-reel-cur';
          cur.textContent = formatted;

          const nxt = document.createElement('span');
          nxt.className = 'tgcd-reel-nxt';
          nxt.setAttribute('aria-hidden', 'true');
          nxt.textContent = formatted;

          reel.appendChild(cur);
          reel.appendChild(nxt);
          dig.appendChild(reel);
        } else {
          // Plain text — used by inline layout, or when sliding digits is off
          dig.textContent = formatted;
        }

        unit.appendChild(dig);

        // Final-minute progress ring on the seconds cell
        if (useRing && key === 'seconds' && c.layout !== 'inline') {
          const svgNs = 'http://www.w3.org/2000/svg';
          const ring = document.createElementNS(svgNs, 'svg');
          ring.setAttribute('class', 'tgcd-ring');
          ring.setAttribute('viewBox', '0 0 100 100');
          ring.setAttribute('aria-hidden', 'true');
          const track = document.createElementNS(svgNs, 'circle');
          track.setAttribute('class', 'tgcd-ring-track');
          track.setAttribute('cx', '50'); track.setAttribute('cy', '50'); track.setAttribute('r', '46');
          const fill  = document.createElementNS(svgNs, 'circle');
          fill.setAttribute('class', 'tgcd-ring-fill');
          fill.setAttribute('cx', '50'); fill.setAttribute('cy', '50'); fill.setAttribute('r', '46');
          // Circumference for r=46 is ~289 — used as dasharray; offset will animate
          fill.setAttribute('stroke-dasharray', '289');
          fill.setAttribute('stroke-dashoffset', '289'); // start empty; _tick fills it in
          ring.appendChild(track);
          ring.appendChild(fill);
          unit.appendChild(ring);
        }

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

      const c = this.c;
      const root = this._root;
      if (!root) return;

      const useReels = !!(c.wow && c.wow.slidingDigits) && c.layout !== 'inline';
      const map = { days: r.days, hours: r.hours, minutes: r.minutes, seconds: r.seconds };

      Object.keys(map).forEach((key) => {
        const cell = root.querySelector('.tgcd-digits[data-unit="' + key + '"]');
        if (!cell) return;
        const newText = key === 'days' ? String(map[key]) : pad2(map[key]);

        if (useReels) {
          const reel = cell.querySelector('.tgcd-reel');
          const cur = reel && reel.querySelector('.tgcd-reel-cur');
          const nxt = reel && reel.querySelector('.tgcd-reel-nxt');
          if (!reel || !cur || !nxt) return;

          if (cur.textContent === newText) return; // no change
          if (initial) {
            cur.textContent = newText;
            nxt.textContent = newText;
            return;
          }
          // Set up the slide: nxt has the new value, cur still has the old one.
          nxt.textContent = newText;
          // Reset to baseline (no transition) before triggering the slide
          reel.classList.remove('is-animating');
          // Force reflow so removing the class actually takes effect before re-adding
          void reel.offsetWidth;
          reel.classList.add('is-animating');
          // After the animation completes, snap to the new value with no transition
          // and clear the animating class so the next tick can replay cleanly.
          const onEnd = () => {
            reel.classList.remove('is-animating');
            cur.textContent = newText;
            nxt.textContent = newText;
            cur.removeEventListener('transitionend', onEnd);
          };
          cur.addEventListener('transitionend', onEnd, { once: true });
          // Safety net — if transitionend doesn't fire (e.g. reduced-motion), still resolve
          setTimeout(() => {
            if (cur.textContent !== newText) {
              reel.classList.remove('is-animating');
              cur.textContent = newText;
              nxt.textContent = newText;
            }
          }, 700);
        } else {
          // Plain mode: just swap the text
          if (cell.textContent !== newText) cell.textContent = newText;
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

      // Final-minute progress ring
      if (c.wow && c.wow.finalMinuteRing) {
        const inFinalMinute = r.total > 0 && r.total <= 60 * 1000;
        if (inFinalMinute) {
          root.classList.add('tgcd-final-min');
          const fill = root.querySelector('.tgcd-ring-fill');
          if (fill) {
            // Drain anticlockwise: at 60s remaining, offset = 0 (full ring); at 0s, offset = 289 (empty)
            const elapsed = 60 - r.seconds; // 0..59
            const offset = (elapsed / 60) * 289;
            fill.setAttribute('stroke-dashoffset', String(offset.toFixed(1)));
          }
        } else {
          root.classList.remove('tgcd-final-min');
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
