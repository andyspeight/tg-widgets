/**
 * Travelgenix Popup Widget v1.0.0
 * Self-contained, embeddable popup / modal / banner widget
 * Zero dependencies — works on any website via a single script tag
 *
 * Layouts:
 *   centered, slide-in, top-bar, bottom-bar, fullscreen, side-drawer, floating-card, inline
 *
 * Triggers:
 *   load, scroll, exit-intent, time, click, inactivity, pageviews
 *
 * Content types:
 *   announcement, email-capture, discount, image, two-step, video
 *
 * Frequency rules:
 *   session, visitor, every-visit, every-n-days
 *   suppress-after-dismiss, suppress-after-conversion
 *
 * Targeting:
 *   page URLs (include / exclude, exact / pattern)
 *   device (desktop / mobile / tablet)
 *
 * Usage:
 *   <div data-tg-widget="popup" data-tg-id="YOUR_WIDGET_ID"></div>
 *   <script src="https://tg-widgets.vercel.app/widget-popup.js"></script>
 */
(function () {
  'use strict';

  const API_BASE = (typeof window !== 'undefined' && window.__TG_WIDGET_API__) || '/api/widget-config';
  const LEAD_API = (typeof window !== 'undefined' && window.__TG_POPUP_LEAD_API__) || '/api/popup-lead';
  const VERSION = '1.0.0';
  const STORAGE_PREFIX = 'tgp_';

  // ---------- Utilities ----------
  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function safeUrl(url) {
    if (!url || typeof url !== 'string') return '';
    const t = url.trim();
    if (!t) return '';
    if (t.startsWith('/') || t.startsWith('#')) return t;
    try {
      const u = new URL(t);
      if (['https:', 'http:', 'mailto:', 'tel:', 'whatsapp:'].includes(u.protocol)) return u.href;
      return '';
    } catch { return ''; }
  }

  function hexToRgb(hex) {
    if (!hex || typeof hex !== 'string') return '';
    let h = hex.trim().replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    if (!/^[0-9a-f]{6}$/i.test(h)) return '';
    const n = parseInt(h, 16);
    return ((n >> 16) & 255) + ', ' + ((n >> 8) & 255) + ', ' + (n & 255);
  }

  function getStorage(type) {
    try {
      return type === 'local' ? window.localStorage : window.sessionStorage;
    } catch { return null; }
  }

  function readKey(key, type) {
    const s = getStorage(type);
    if (!s) return null;
    try { return JSON.parse(s.getItem(STORAGE_PREFIX + key) || 'null'); } catch { return null; }
  }

  function writeKey(key, val, type) {
    const s = getStorage(type);
    if (!s) return;
    try { s.setItem(STORAGE_PREFIX + key, JSON.stringify(val)); } catch {}
  }

  function getDeviceType() {
    const w = window.innerWidth;
    const ua = navigator.userAgent || '';
    const isTabletUA = /iPad|Tablet|PlayBook|Silk/i.test(ua);
    if (w < 640 && !isTabletUA) return 'mobile';
    if (w < 1024 || isTabletUA) return 'tablet';
    return 'desktop';
  }

  function urlMatches(pattern, url) {
    if (!pattern) return false;
    const p = pattern.trim();
    if (!p) return false;
    if (p === '*' || p === '/*') return true;
    // Wildcard support: /blog/* matches /blog/anything
    if (p.includes('*')) {
      const re = new RegExp('^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
      return re.test(url);
    }
    return url === p || url.startsWith(p);
  }

  function isValidEmail(s) {
    return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
  }

  // ---------- Inline SVG icons (no external deps) ----------
  const IC = {
    close: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 6l12 12M6 18L18 6"/>',
    check: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>',
    copy: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3"/>',
    play: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>',
    spark: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 3v4M3 5h4M6 17v4M4 19h4M13 3l3.5 7.5L24 14l-7.5 3.5L13 25l-3.5-7.5L2 14l7.5-3.5L13 3z"/>'
  };

  function svg(path, cls) {
    return '<svg class="' + (cls || '') + '" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">' + path + '</svg>';
  }

  // ---------- Default config ----------
  const DEFAULTS = {
    // Identity
    name: 'Popup',

    // Layout
    layout: 'centered', // centered | slide-in | top-bar | bottom-bar | fullscreen | side-drawer | floating-card | inline
    position: 'bottom-right', // for slide-in / floating-card: top-left | top-right | bottom-left | bottom-right
    sideDrawerSide: 'right', // for side-drawer: left | right
    inlineTarget: '', // CSS selector for inline layout, falls back to the original container

    // Content type
    contentType: 'announcement', // announcement | email-capture | discount | image | two-step | video

    // Common content
    title: 'Welcome aboard!',
    body: 'Sign up to get exclusive travel deals straight to your inbox.',
    image: '', // Optional hero image URL
    imageAlt: '',
    ctaText: 'Find out more',
    ctaUrl: '#',
    secondaryCtaText: '',
    secondaryCtaUrl: '',

    // Email capture
    emailNameLabel: 'Your name',
    emailNamePlaceholder: 'Sarah Smith',
    emailEmailLabel: 'Email address',
    emailEmailPlaceholder: 'you@example.com',
    emailSubmitLabel: 'Subscribe',
    emailRequireName: true,
    emailSuccessTitle: 'You\'re on the list',
    emailSuccessMessage: 'Thanks for signing up — we\'ll be in touch.',
    emailConsentText: '',

    // Discount
    discountCode: 'TRAVEL10',
    discountCopyLabel: 'Copy code',
    discountCopiedLabel: 'Copied!',
    discountTerms: '',

    // Two-step
    twoStepQuestion: 'Want £100 off your next holiday?',
    twoStepYesLabel: 'Yes please',
    twoStepNoLabel: 'No thanks',

    // Video
    videoUrl: '', // YouTube or Vimeo URL
    videoAutoplay: true,

    // Triggers
    trigger: 'load', // load | scroll | exit-intent | time | click | inactivity | pageviews
    triggerDelay: 0, // ms — for 'load' and 'time'
    triggerScrollPercent: 50, // for 'scroll'
    triggerInactivitySeconds: 30, // for 'inactivity'
    triggerPageviews: 2, // for 'pageviews'
    triggerSelector: '', // CSS selector for 'click'

    // Frequency
    frequency: 'session', // session | visitor | every-visit | every-n-days
    frequencyDays: 7, // for 'every-n-days'
    suppressAfterDismissDays: 0, // 0 = no extra suppression
    suppressAfterConversionDays: 30, // suppress after form submit / discount copy

    // Page targeting
    pageInclude: [], // empty = all pages
    pageExclude: [],

    // Device targeting
    devices: { desktop: true, tablet: true, mobile: true },

    // Behaviour
    closeOnEscape: true,
    closeOnBackdropClick: true,
    showCloseButton: true,
    overlay: true, // backdrop on overlay layouts
    overlayOpacity: 60, // 0-100

    // Theme
    theme: 'light', // light | dark | auto
    brand: '#1B2B5B',
    accent: '#00B4D8',
    bg: '#FFFFFF',
    text: '#0F172A',
    textOnBrand: '#FFFFFF',
    radius: 16,
    fontFamily: '',

    // Animation
    animation: 'fade-up', // fade | fade-up | scale | slide

    // SEO/tracking
    widgetId: '' // populated by API loader
  };

  // ---------- Trigger registry ----------
  // Each trigger returns a Promise that resolves when the trigger fires.
  // It also receives an "abort" callback so we can cancel pending triggers.
  function attachTrigger(cfg, onFire) {
    const trigger = cfg.trigger || 'load';
    let aborted = false;
    let cleanup = () => { aborted = true; };

    function fire() {
      if (aborted) return;
      aborted = true;
      onFire();
    }

    if (trigger === 'load') {
      const t = setTimeout(fire, Math.max(0, cfg.triggerDelay || 0));
      cleanup = () => { aborted = true; clearTimeout(t); };
    } else if (trigger === 'time') {
      const t = setTimeout(fire, Math.max(0, (cfg.triggerDelay || 5000)));
      cleanup = () => { aborted = true; clearTimeout(t); };
    } else if (trigger === 'scroll') {
      const pct = Math.max(1, Math.min(100, cfg.triggerScrollPercent || 50));
      function check() {
        if (aborted) return;
        const docH = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight) - window.innerHeight;
        if (docH <= 0) return;
        const scrolled = (window.scrollY || window.pageYOffset) / docH * 100;
        if (scrolled >= pct) fire();
      }
      window.addEventListener('scroll', check, { passive: true });
      check();
      cleanup = () => { aborted = true; window.removeEventListener('scroll', check); };
    } else if (trigger === 'exit-intent') {
      const isMobile = getDeviceType() === 'mobile';
      let lastY = window.scrollY || 0;
      function onMouseLeave(e) {
        if (aborted) return;
        if (e.clientY <= 0 && (e.relatedTarget === null || e.relatedTarget === undefined)) fire();
      }
      function onScrollMobile() {
        if (aborted) return;
        const y = window.scrollY || 0;
        if (y < lastY - 50 && y < 200) fire();
        lastY = y;
      }
      if (isMobile) {
        window.addEventListener('scroll', onScrollMobile, { passive: true });
        cleanup = () => { aborted = true; window.removeEventListener('scroll', onScrollMobile); };
      } else {
        document.addEventListener('mouseout', onMouseLeave);
        cleanup = () => { aborted = true; document.removeEventListener('mouseout', onMouseLeave); };
      }
    } else if (trigger === 'click') {
      const sel = (cfg.triggerSelector || '').trim();
      if (!sel) return cleanup;
      function onClick(e) {
        if (aborted) return;
        try {
          if (e.target && e.target.closest && e.target.closest(sel)) {
            e.preventDefault();
            fire();
          }
        } catch {}
      }
      document.addEventListener('click', onClick, true);
      cleanup = () => { aborted = true; document.removeEventListener('click', onClick, true); };
    } else if (trigger === 'inactivity') {
      const secs = Math.max(5, cfg.triggerInactivitySeconds || 30);
      let timeout;
      function reset() {
        if (aborted) return;
        clearTimeout(timeout);
        timeout = setTimeout(fire, secs * 1000);
      }
      ['mousemove', 'keydown', 'scroll', 'touchstart'].forEach(ev =>
        document.addEventListener(ev, reset, { passive: true })
      );
      reset();
      cleanup = () => {
        aborted = true;
        clearTimeout(timeout);
        ['mousemove', 'keydown', 'scroll', 'touchstart'].forEach(ev =>
          document.removeEventListener(ev, reset)
        );
      };
    } else if (trigger === 'pageviews') {
      const required = Math.max(1, cfg.triggerPageviews || 2);
      const key = 'pv_' + (cfg.widgetId || 'default');
      const current = (readKey(key, 'session') || 0) + 1;
      writeKey(key, current, 'session');
      if (current >= required) fire();
    }

    return cleanup;
  }

  // ---------- Eligibility check ----------
  function shouldShow(cfg) {
    // Page targeting
    const path = window.location.pathname + window.location.search;
    if (Array.isArray(cfg.pageInclude) && cfg.pageInclude.length > 0) {
      const matchAny = cfg.pageInclude.some(p => urlMatches(p, path));
      if (!matchAny) return { show: false, reason: 'page-not-included' };
    }
    if (Array.isArray(cfg.pageExclude) && cfg.pageExclude.length > 0) {
      const matchAny = cfg.pageExclude.some(p => urlMatches(p, path));
      if (matchAny) return { show: false, reason: 'page-excluded' };
    }

    // Device targeting
    const dev = getDeviceType();
    const dt = cfg.devices || {};
    if (dt[dev] === false) return { show: false, reason: 'device-excluded' };

    // Frequency
    const id = cfg.widgetId || 'default';
    const stateKey = 'state_' + id;

    // Check conversion suppression
    const conv = readKey(stateKey + '_conv', 'local');
    if (conv && conv.expires && Date.now() < conv.expires) {
      return { show: false, reason: 'converted' };
    }

    // Check dismissal suppression
    const dismiss = readKey(stateKey + '_dismiss', 'local');
    if (dismiss && dismiss.expires && Date.now() < dismiss.expires) {
      return { show: false, reason: 'dismissed' };
    }

    // Frequency rule
    const freq = cfg.frequency || 'session';
    if (freq === 'session') {
      if (readKey(stateKey + '_shown', 'session')) return { show: false, reason: 'shown-this-session' };
    } else if (freq === 'visitor') {
      if (readKey(stateKey + '_shown', 'local')) return { show: false, reason: 'shown-already' };
    } else if (freq === 'every-n-days') {
      const lastShown = readKey(stateKey + '_lastShown', 'local');
      if (lastShown && Date.now() - lastShown < (cfg.frequencyDays || 7) * 86400000) {
        return { show: false, reason: 'shown-recently' };
      }
    }
    // 'every-visit' = no check

    return { show: true };
  }

  function recordShown(cfg) {
    const id = cfg.widgetId || 'default';
    const stateKey = 'state_' + id;
    const freq = cfg.frequency || 'session';
    if (freq === 'session') writeKey(stateKey + '_shown', true, 'session');
    if (freq === 'visitor') writeKey(stateKey + '_shown', true, 'local');
    if (freq === 'every-n-days') writeKey(stateKey + '_lastShown', Date.now(), 'local');
  }

  function recordDismissed(cfg) {
    const days = cfg.suppressAfterDismissDays || 0;
    if (days <= 0) return;
    const id = cfg.widgetId || 'default';
    writeKey('state_' + id + '_dismiss', { expires: Date.now() + days * 86400000 }, 'local');
  }

  function recordConverted(cfg) {
    const days = cfg.suppressAfterConversionDays || 30;
    const id = cfg.widgetId || 'default';
    writeKey('state_' + id + '_conv', { expires: Date.now() + days * 86400000 }, 'local');
  }

  // ---------- Styles ----------
  const STYLES = `
    :host { all: initial; display: block; }
    *, *::before, *::after { box-sizing: border-box; }

    .tgp-root {
      --tgp-brand: #1B2B5B;
      --tgp-brand-rgb: 27, 43, 91;
      --tgp-accent: #00B4D8;
      --tgp-accent-rgb: 0, 180, 216;
      --tgp-bg: #FFFFFF;
      --tgp-text: #0F172A;
      --tgp-sub: #475569;
      --tgp-text-on-brand: #FFFFFF;
      --tgp-border: #E2E8F0;
      --tgp-radius: 16px;
      --tgp-radius-sm: 12px;
      --tgp-shadow: 0 20px 60px rgba(15, 23, 42, 0.18), 0 4px 12px rgba(15, 23, 42, 0.08);
      --tgp-overlay: rgba(15, 23, 42, 0.6);
      --tgp-font: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-family: var(--tgp-font);
      font-size: 15px;
      line-height: 1.5;
      color: var(--tgp-text);
    }

    .tgp-root[data-theme="dark"] {
      --tgp-bg: #1E293B;
      --tgp-text: #F8FAFC;
      --tgp-sub: #CBD5E1;
      --tgp-border: #334155;
      --tgp-shadow: 0 20px 60px rgba(0, 0, 0, 0.5), 0 4px 12px rgba(0, 0, 0, 0.3);
    }

    /* Backdrop */
    .tgp-backdrop {
      position: fixed; inset: 0; z-index: 2147483646;
      background: var(--tgp-overlay);
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
      opacity: 0; transition: opacity 240ms ease;
    }
    .tgp-backdrop.tgp-open { opacity: 1; }

    /* Container — different per layout */
    .tgp-container {
      position: fixed; z-index: 2147483647;
      pointer-events: none;
    }

    .tgp-card {
      pointer-events: auto;
      background: var(--tgp-bg);
      color: var(--tgp-text);
      border-radius: var(--tgp-radius);
      box-shadow: var(--tgp-shadow);
      max-width: 100%;
      overflow: hidden;
      transform: translateY(20px) scale(0.96);
      opacity: 0;
      transition: transform 320ms cubic-bezier(0.16, 1, 0.3, 1), opacity 240ms ease;
    }
    .tgp-card.tgp-open { transform: translateY(0) scale(1); opacity: 1; }

    /* Layout: centered */
    .tgp-layout-centered .tgp-container {
      inset: 0; display: flex; align-items: center; justify-content: center; padding: 16px;
    }
    .tgp-layout-centered .tgp-card { width: 460px; max-width: 100%; }

    /* Layout: slide-in */
    .tgp-layout-slide-in .tgp-container { padding: 16px; }
    .tgp-layout-slide-in.tgp-pos-bottom-right .tgp-container { right: 0; bottom: 0; }
    .tgp-layout-slide-in.tgp-pos-bottom-left .tgp-container { left: 0; bottom: 0; }
    .tgp-layout-slide-in.tgp-pos-top-right .tgp-container { right: 0; top: 0; }
    .tgp-layout-slide-in.tgp-pos-top-left .tgp-container { left: 0; top: 0; }
    .tgp-layout-slide-in .tgp-card { width: 360px; max-width: calc(100vw - 32px); transform: translateY(40px); }
    .tgp-layout-slide-in.tgp-pos-top-right .tgp-card,
    .tgp-layout-slide-in.tgp-pos-top-left .tgp-card { transform: translateY(-40px); }
    .tgp-layout-slide-in .tgp-card.tgp-open { transform: translateY(0); }

    /* Layout: floating-card — same positions as slide-in but no backdrop */
    .tgp-layout-floating-card .tgp-container { padding: 16px; }
    .tgp-layout-floating-card.tgp-pos-bottom-right .tgp-container { right: 0; bottom: 0; }
    .tgp-layout-floating-card.tgp-pos-bottom-left .tgp-container { left: 0; bottom: 0; }
    .tgp-layout-floating-card.tgp-pos-top-right .tgp-container { right: 0; top: 0; }
    .tgp-layout-floating-card.tgp-pos-top-left .tgp-container { left: 0; top: 0; }
    .tgp-layout-floating-card .tgp-card { width: 320px; max-width: calc(100vw - 32px); }

    /* Layout: top-bar */
    .tgp-layout-top-bar .tgp-container { top: 0; left: 0; right: 0; }
    .tgp-layout-top-bar .tgp-card {
      width: 100%; max-width: none; border-radius: 0;
      transform: translateY(-100%); opacity: 1;
    }
    .tgp-layout-top-bar .tgp-card.tgp-open { transform: translateY(0); }

    /* Layout: bottom-bar */
    .tgp-layout-bottom-bar .tgp-container { bottom: 0; left: 0; right: 0; }
    .tgp-layout-bottom-bar .tgp-card {
      width: 100%; max-width: none; border-radius: 0;
      transform: translateY(100%); opacity: 1;
    }
    .tgp-layout-bottom-bar .tgp-card.tgp-open { transform: translateY(0); }

    /* Layout: fullscreen */
    .tgp-layout-fullscreen .tgp-container { inset: 0; display: flex; align-items: stretch; justify-content: stretch; }
    .tgp-layout-fullscreen .tgp-card {
      width: 100%; max-width: none; height: 100%; border-radius: 0;
      display: flex; align-items: center; justify-content: center;
    }

    /* Layout: side-drawer */
    .tgp-layout-side-drawer .tgp-container { top: 0; bottom: 0; }
    .tgp-layout-side-drawer.tgp-pos-right .tgp-container { right: 0; }
    .tgp-layout-side-drawer.tgp-pos-left .tgp-container { left: 0; }
    .tgp-layout-side-drawer .tgp-card {
      width: 420px; max-width: 100vw; height: 100%;
      border-radius: 0; transform: translateX(100%);
    }
    .tgp-layout-side-drawer.tgp-pos-left .tgp-card { transform: translateX(-100%); }
    .tgp-layout-side-drawer .tgp-card.tgp-open { transform: translateX(0); }

    /* Layout: inline */
    .tgp-layout-inline { position: relative; display: block; }
    .tgp-layout-inline .tgp-container { position: relative; }
    .tgp-layout-inline .tgp-card {
      width: 100%; max-width: 720px; margin: 0 auto;
      transform: translateY(0) scale(1); opacity: 1;
    }

    /* Card body */
    .tgp-body { padding: 28px; position: relative; }
    .tgp-layout-top-bar .tgp-body, .tgp-layout-bottom-bar .tgp-body {
      padding: 14px 56px 14px 20px;
      display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
    }
    .tgp-layout-fullscreen .tgp-body { padding: 48px; max-width: 640px; text-align: center; }

    /* Hero image */
    .tgp-hero {
      width: 100%; aspect-ratio: 16 / 9; object-fit: cover; display: block;
      background: linear-gradient(135deg, var(--tgp-brand), var(--tgp-accent));
    }

    /* Close button */
    .tgp-close {
      position: absolute; top: 12px; right: 12px;
      width: 36px; height: 36px; border-radius: 50%;
      background: rgba(15, 23, 42, 0.06);
      border: none; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      color: var(--tgp-text);
      transition: background 160ms ease, transform 160ms ease;
      z-index: 5;
    }
    .tgp-close:hover { background: rgba(15, 23, 42, 0.12); }
    .tgp-close:active { transform: scale(0.94); }
    .tgp-close:focus-visible { outline: 2px solid var(--tgp-accent); outline-offset: 2px; }
    .tgp-close svg { width: 18px; height: 18px; }
    .tgp-layout-top-bar .tgp-close, .tgp-layout-bottom-bar .tgp-close {
      top: 50%; transform: translateY(-50%); right: 12px;
    }

    /* Typography */
    .tgp-title {
      font-size: 22px; font-weight: 700; line-height: 1.25;
      margin: 0 0 8px; color: var(--tgp-text); letter-spacing: -0.01em;
    }
    .tgp-layout-fullscreen .tgp-title { font-size: 36px; }
    .tgp-layout-top-bar .tgp-title, .tgp-layout-bottom-bar .tgp-title {
      font-size: 16px; margin: 0; flex: 1; min-width: 200px;
    }
    .tgp-text {
      font-size: 15px; line-height: 1.55;
      color: var(--tgp-sub); margin: 0 0 20px;
    }
    .tgp-layout-top-bar .tgp-text, .tgp-layout-bottom-bar .tgp-text { display: none; }

    /* CTA buttons */
    .tgp-actions { display: flex; gap: 10px; flex-wrap: wrap; }
    .tgp-layout-top-bar .tgp-actions, .tgp-layout-bottom-bar .tgp-actions { margin: 0; }
    .tgp-btn {
      display: inline-flex; align-items: center; justify-content: center; gap: 8px;
      padding: 0 22px; height: 44px; min-width: 120px;
      border-radius: var(--tgp-radius-sm); border: none;
      font-family: inherit; font-size: 15px; font-weight: 600;
      cursor: pointer; text-decoration: none;
      transition: transform 160ms ease, box-shadow 160ms ease, background 160ms ease;
    }
    .tgp-btn-primary {
      background: var(--tgp-brand); color: var(--tgp-text-on-brand);
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
    }
    .tgp-btn-primary:hover {
      background: var(--tgp-brand);
      filter: brightness(1.08);
      box-shadow: 0 4px 12px rgba(var(--tgp-brand-rgb), 0.3);
    }
    .tgp-btn-primary:active { transform: translateY(1px); }
    .tgp-btn-secondary {
      background: transparent; color: var(--tgp-text);
      border: 1px solid var(--tgp-border);
    }
    .tgp-btn-secondary:hover { background: rgba(var(--tgp-brand-rgb), 0.05); }
    .tgp-btn:focus-visible { outline: 2px solid var(--tgp-accent); outline-offset: 2px; }
    .tgp-btn-block { width: 100%; }

    /* Form */
    .tgp-form { display: flex; flex-direction: column; gap: 14px; }
    .tgp-field { display: flex; flex-direction: column; gap: 6px; }
    .tgp-label {
      font-size: 13px; font-weight: 500; color: var(--tgp-text);
    }
    .tgp-input {
      height: 44px; padding: 0 14px;
      font-family: inherit; font-size: 15px; color: var(--tgp-text);
      background: var(--tgp-bg);
      border: 1px solid var(--tgp-border); border-radius: var(--tgp-radius-sm);
      outline: none; transition: border-color 160ms ease, box-shadow 160ms ease;
    }
    .tgp-input:focus {
      border-color: var(--tgp-accent);
      box-shadow: 0 0 0 3px rgba(var(--tgp-accent-rgb), 0.18);
    }
    .tgp-input.tgp-error { border-color: #EF4444; }
    .tgp-error-msg {
      font-size: 13px; color: #EF4444; margin-top: 4px;
    }
    .tgp-consent {
      font-size: 12px; color: var(--tgp-sub); line-height: 1.5;
    }

    /* Discount code */
    .tgp-discount {
      display: flex; align-items: center; gap: 0;
      background: rgba(var(--tgp-brand-rgb), 0.06);
      border: 2px dashed rgba(var(--tgp-brand-rgb), 0.4);
      border-radius: var(--tgp-radius-sm);
      padding: 14px 18px; margin-bottom: 16px;
    }
    .tgp-discount-code {
      font-family: 'JetBrains Mono', 'SF Mono', Menlo, monospace;
      font-size: 22px; font-weight: 700; letter-spacing: 0.08em;
      color: var(--tgp-brand); flex: 1;
    }
    .tgp-discount-copy {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 8px 14px; height: 36px; border-radius: 999px;
      background: var(--tgp-brand); color: var(--tgp-text-on-brand);
      border: none; cursor: pointer; font-family: inherit;
      font-size: 13px; font-weight: 600;
      transition: filter 160ms ease, transform 160ms ease;
    }
    .tgp-discount-copy:hover { filter: brightness(1.1); }
    .tgp-discount-copy.tgp-copied { background: #10B981; }
    .tgp-discount-copy svg { width: 14px; height: 14px; }
    .tgp-terms {
      font-size: 12px; color: var(--tgp-sub); margin: 0;
    }

    /* Two-step */
    .tgp-twostep-q {
      font-size: 19px; font-weight: 600; text-align: center;
      margin: 0 0 20px; color: var(--tgp-text);
    }
    .tgp-twostep-actions { display: flex; gap: 10px; }
    .tgp-twostep-actions .tgp-btn { flex: 1; }

    /* Video */
    .tgp-video-wrap {
      position: relative; aspect-ratio: 16 / 9; width: 100%;
      background: #000; overflow: hidden;
    }
    .tgp-video-wrap iframe {
      position: absolute; inset: 0; width: 100%; height: 100%; border: 0;
    }

    /* Success state */
    .tgp-success {
      text-align: center; padding: 8px 0;
    }
    .tgp-success-icon {
      width: 56px; height: 56px; border-radius: 50%;
      background: rgba(16, 185, 129, 0.15); color: #10B981;
      display: flex; align-items: center; justify-content: center;
      margin: 0 auto 16px;
    }
    .tgp-success-icon svg { width: 28px; height: 28px; }

    /* Image content */
    .tgp-image-link { display: block; line-height: 0; }
    .tgp-image-content {
      width: 100%; height: auto; display: block;
    }

    /* Responsive */
    @media (max-width: 640px) {
      .tgp-layout-centered .tgp-card { width: 100%; }
      .tgp-layout-side-drawer .tgp-card { width: 100vw; }
      .tgp-body { padding: 22px; }
      .tgp-layout-fullscreen .tgp-body { padding: 24px; }
      .tgp-layout-fullscreen .tgp-title { font-size: 26px; }
      .tgp-title { font-size: 20px; }
      .tgp-actions { flex-direction: column; }
      .tgp-btn { width: 100%; }
      .tgp-layout-top-bar .tgp-body, .tgp-layout-bottom-bar .tgp-body {
        flex-direction: column; align-items: flex-start; padding: 16px 48px 16px 16px;
      }
      .tgp-layout-top-bar .tgp-actions, .tgp-layout-bottom-bar .tgp-actions { width: 100%; }
    }

    /* Reduced motion */
    @media (prefers-reduced-motion: reduce) {
      .tgp-card, .tgp-backdrop { transition: opacity 100ms ease !important; }
      .tgp-card { transform: none !important; }
    }
  `;

  // ---------- Content renderers ----------
  function renderCloseBtn(cfg) {
    if (!cfg.showCloseButton) return '';
    return '<button type="button" class="tgp-close" data-tgp-close aria-label="Close">' + svg(IC.close) + '</button>';
  }

  function renderHero(cfg) {
    if (!cfg.image) return '';
    const url = safeUrl(cfg.image);
    if (!url) return '';
    return '<img class="tgp-hero" src="' + esc(url) + '" alt="' + esc(cfg.imageAlt || '') + '" loading="lazy" />';
  }

  function renderAnnouncement(cfg) {
    let html = '';
    html += renderHero(cfg);
    html += '<div class="tgp-body">';
    html += renderCloseBtn(cfg);
    if (cfg.title) html += '<h2 class="tgp-title">' + esc(cfg.title) + '</h2>';
    if (cfg.body) html += '<p class="tgp-text">' + esc(cfg.body) + '</p>';
    html += '<div class="tgp-actions">';
    if (cfg.ctaText) {
      const url = safeUrl(cfg.ctaUrl) || '#';
      html += '<a class="tgp-btn tgp-btn-primary" href="' + esc(url) + '" data-tgp-cta>' + esc(cfg.ctaText) + '</a>';
    }
    if (cfg.secondaryCtaText) {
      const url = safeUrl(cfg.secondaryCtaUrl) || '#';
      html += '<a class="tgp-btn tgp-btn-secondary" href="' + esc(url) + '">' + esc(cfg.secondaryCtaText) + '</a>';
    }
    html += '</div></div>';
    return html;
  }

  function renderEmailCapture(cfg) {
    let html = '';
    html += renderHero(cfg);
    html += '<div class="tgp-body" data-tgp-form-wrap>';
    html += renderCloseBtn(cfg);
    if (cfg.title) html += '<h2 class="tgp-title">' + esc(cfg.title) + '</h2>';
    if (cfg.body) html += '<p class="tgp-text">' + esc(cfg.body) + '</p>';
    html += '<form class="tgp-form" data-tgp-form novalidate>';
    if (cfg.emailRequireName) {
      html += '<div class="tgp-field">';
      html += '<label class="tgp-label" for="tgp-name">' + esc(cfg.emailNameLabel || 'Name') + '</label>';
      html += '<input class="tgp-input" type="text" id="tgp-name" name="name" placeholder="' + esc(cfg.emailNamePlaceholder || '') + '" autocomplete="name" required />';
      html += '</div>';
    }
    html += '<div class="tgp-field">';
    html += '<label class="tgp-label" for="tgp-email">' + esc(cfg.emailEmailLabel || 'Email') + '</label>';
    html += '<input class="tgp-input" type="email" id="tgp-email" name="email" placeholder="' + esc(cfg.emailEmailPlaceholder || '') + '" autocomplete="email" required />';
    html += '<div class="tgp-error-msg" data-tgp-error hidden></div>';
    html += '</div>';
    html += '<button type="submit" class="tgp-btn tgp-btn-primary tgp-btn-block" data-tgp-submit>' + esc(cfg.emailSubmitLabel || 'Subscribe') + '</button>';
    if (cfg.emailConsentText) {
      html += '<p class="tgp-consent">' + esc(cfg.emailConsentText) + '</p>';
    }
    html += '</form>';
    html += '</div>';
    return html;
  }

  function renderEmailSuccess(cfg) {
    let html = '<div class="tgp-body">';
    html += renderCloseBtn(cfg);
    html += '<div class="tgp-success">';
    html += '<div class="tgp-success-icon">' + svg(IC.check) + '</div>';
    html += '<h2 class="tgp-title">' + esc(cfg.emailSuccessTitle || 'Thanks!') + '</h2>';
    html += '<p class="tgp-text">' + esc(cfg.emailSuccessMessage || '') + '</p>';
    html += '</div></div>';
    return html;
  }

  function renderDiscount(cfg) {
    let html = '';
    html += renderHero(cfg);
    html += '<div class="tgp-body">';
    html += renderCloseBtn(cfg);
    if (cfg.title) html += '<h2 class="tgp-title">' + esc(cfg.title) + '</h2>';
    if (cfg.body) html += '<p class="tgp-text">' + esc(cfg.body) + '</p>';
    html += '<div class="tgp-discount">';
    html += '<span class="tgp-discount-code">' + esc(cfg.discountCode || 'CODE') + '</span>';
    html += '<button type="button" class="tgp-discount-copy" data-tgp-copy>' + svg(IC.copy) + '<span data-tgp-copy-label>' + esc(cfg.discountCopyLabel || 'Copy') + '</span></button>';
    html += '</div>';
    if (cfg.discountTerms) html += '<p class="tgp-terms">' + esc(cfg.discountTerms) + '</p>';
    if (cfg.ctaText) {
      const url = safeUrl(cfg.ctaUrl) || '#';
      html += '<div class="tgp-actions" style="margin-top:14px"><a class="tgp-btn tgp-btn-primary tgp-btn-block" href="' + esc(url) + '" data-tgp-cta>' + esc(cfg.ctaText) + '</a></div>';
    }
    html += '</div>';
    return html;
  }

  function renderImage(cfg) {
    const url = safeUrl(cfg.image);
    if (!url) return renderAnnouncement(cfg);
    let html = '<div class="tgp-body" style="padding:0">';
    html += renderCloseBtn(cfg);
    if (cfg.ctaUrl) {
      const link = safeUrl(cfg.ctaUrl);
      if (link) {
        html += '<a class="tgp-image-link" href="' + esc(link) + '" data-tgp-cta target="_blank" rel="noopener">';
        html += '<img class="tgp-image-content" src="' + esc(url) + '" alt="' + esc(cfg.imageAlt || '') + '" />';
        html += '</a>';
      } else {
        html += '<img class="tgp-image-content" src="' + esc(url) + '" alt="' + esc(cfg.imageAlt || '') + '" />';
      }
    } else {
      html += '<img class="tgp-image-content" src="' + esc(url) + '" alt="' + esc(cfg.imageAlt || '') + '" />';
    }
    html += '</div>';
    return html;
  }

  function renderTwoStepQuestion(cfg) {
    let html = '<div class="tgp-body">';
    html += renderCloseBtn(cfg);
    html += '<p class="tgp-twostep-q">' + esc(cfg.twoStepQuestion || 'Interested?') + '</p>';
    html += '<div class="tgp-twostep-actions">';
    html += '<button type="button" class="tgp-btn tgp-btn-secondary" data-tgp-twostep-no>' + esc(cfg.twoStepNoLabel || 'No thanks') + '</button>';
    html += '<button type="button" class="tgp-btn tgp-btn-primary" data-tgp-twostep-yes>' + esc(cfg.twoStepYesLabel || 'Yes please') + '</button>';
    html += '</div></div>';
    return html;
  }

  function getVideoEmbedUrl(url) {
    if (!url) return '';
    const safe = safeUrl(url);
    if (!safe) return '';
    // YouTube
    let m = safe.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([A-Za-z0-9_-]{11})/);
    if (m) return 'https://www.youtube.com/embed/' + m[1] + '?rel=0&modestbranding=1';
    // Vimeo
    m = safe.match(/vimeo\.com\/(\d+)/);
    if (m) return 'https://player.vimeo.com/video/' + m[1];
    return '';
  }

  function renderVideo(cfg) {
    const embed = getVideoEmbedUrl(cfg.videoUrl);
    let html = '<div class="tgp-body" style="padding:0">';
    html += renderCloseBtn(cfg);
    if (embed) {
      const auto = cfg.videoAutoplay ? '&autoplay=1' : '';
      html += '<div class="tgp-video-wrap">';
      html += '<iframe src="' + esc(embed + auto) + '" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>';
      html += '</div>';
    } else {
      html += '<div style="padding:40px;text-align:center;color:var(--tgp-sub)">No video URL configured</div>';
    }
    if (cfg.title || cfg.body) {
      html += '<div style="padding:20px 24px">';
      if (cfg.title) html += '<h2 class="tgp-title">' + esc(cfg.title) + '</h2>';
      if (cfg.body) html += '<p class="tgp-text">' + esc(cfg.body) + '</p>';
      html += '</div>';
    }
    html += '</div>';
    return html;
  }

  function renderContent(cfg, state) {
    const ct = cfg.contentType || 'announcement';
    if (ct === 'announcement') return renderAnnouncement(cfg);
    if (ct === 'email-capture') {
      return state.submitted ? renderEmailSuccess(cfg) : renderEmailCapture(cfg);
    }
    if (ct === 'discount') return renderDiscount(cfg);
    if (ct === 'image') return renderImage(cfg);
    if (ct === 'two-step') {
      if (state.twoStepAccepted) return renderEmailCapture(cfg);
      return renderTwoStepQuestion(cfg);
    }
    if (ct === 'video') return renderVideo(cfg);
    return renderAnnouncement(cfg);
  }

  // ---------- Widget class ----------
  class TGPopupWidget {
    constructor(container, config) {
      this.el = container;
      this.cfg = Object.assign({}, DEFAULTS, config || {});
      this.state = { submitted: false, twoStepAccepted: false, isOpen: false };
      this.shadow = container.attachShadow({ mode: 'open' });
      this.cleanupFns = [];
      this._init();
    }

    _init() {
      const eligibility = shouldShow(this.cfg);
      if (!eligibility.show) {
        if (window.console && console.debug) console.debug('[TG Popup] Not shown:', eligibility.reason);
        return;
      }

      const cleanup = attachTrigger(this.cfg, () => this.open());
      this.cleanupFns.push(cleanup);
    }

    _cssVars() {
      const c = this.cfg;
      const brandRgb = hexToRgb(c.brand) || '27, 43, 91';
      const accentRgb = hexToRgb(c.accent) || '0, 180, 216';
      const opacity = Math.max(0, Math.min(100, c.overlayOpacity || 60)) / 100;
      let theme = c.theme || 'light';
      if (theme === 'auto') {
        theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      }
      const isDark = theme === 'dark';
      const bg = c.bg || (isDark ? '#1E293B' : '#FFFFFF');
      const text = c.text || (isDark ? '#F8FAFC' : '#0F172A');
      return {
        theme,
        styles: [
          '--tgp-brand:' + (c.brand || '#1B2B5B'),
          '--tgp-brand-rgb:' + brandRgb,
          '--tgp-accent:' + (c.accent || '#00B4D8'),
          '--tgp-accent-rgb:' + accentRgb,
          '--tgp-bg:' + bg,
          '--tgp-text:' + text,
          '--tgp-text-on-brand:' + (c.textOnBrand || '#FFFFFF'),
          '--tgp-radius:' + (c.radius != null ? c.radius : 16) + 'px',
          '--tgp-overlay:rgba(15, 23, 42,' + opacity + ')',
          c.fontFamily ? '--tgp-font:' + c.fontFamily + ', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' : ''
        ].filter(Boolean).join(';')
      };
    }

    _layoutClass() {
      const c = this.cfg;
      const layout = c.layout || 'centered';
      let pos = '';
      if (layout === 'slide-in' || layout === 'floating-card') {
        pos = ' tgp-pos-' + (c.position || 'bottom-right');
      } else if (layout === 'side-drawer') {
        pos = ' tgp-pos-' + (c.sideDrawerSide || 'right');
      }
      return 'tgp-layout-' + layout + pos;
    }

    _showBackdrop() {
      const c = this.cfg;
      const layout = c.layout || 'centered';
      const overlayLayouts = ['centered', 'fullscreen', 'side-drawer'];
      return c.overlay && overlayLayouts.includes(layout);
    }

    _render() {
      const css = this._cssVars();
      const layoutClass = this._layoutClass();
      const showBackdrop = this._showBackdrop();

      let html = '<style>' + STYLES + '</style>';
      html += '<div class="tgp-root ' + layoutClass + '" data-theme="' + css.theme + '" style="' + css.styles + '">';
      if (showBackdrop) html += '<div class="tgp-backdrop" data-tgp-backdrop></div>';
      html += '<div class="tgp-container" role="dialog" aria-modal="' + (showBackdrop ? 'true' : 'false') + '" aria-label="' + esc(this.cfg.title || 'Notification') + '">';
      html += '<div class="tgp-card" data-tgp-card>';
      html += renderContent(this.cfg, this.state);
      html += '</div></div></div>';

      this.shadow.innerHTML = html;
    }

    open() {
      if (this.state.isOpen) return;
      this.state.isOpen = true;
      this._render();
      recordShown(this.cfg);

      // Animate in on next frame
      requestAnimationFrame(() => {
        const card = this.shadow.querySelector('[data-tgp-card]');
        const backdrop = this.shadow.querySelector('[data-tgp-backdrop]');
        if (card) card.classList.add('tgp-open');
        if (backdrop) backdrop.classList.add('tgp-open');
      });

      this._bind();

      // Lock body scroll for overlay layouts
      if (this._showBackdrop()) {
        this._origOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
      }

      // Focus management
      setTimeout(() => {
        const focusable = this.shadow.querySelector('input, button, a[href]');
        if (focusable) focusable.focus();
      }, 100);
    }

    close(reason) {
      if (!this.state.isOpen) return;
      this.state.isOpen = false;

      const card = this.shadow.querySelector('[data-tgp-card]');
      const backdrop = this.shadow.querySelector('[data-tgp-backdrop]');
      if (card) card.classList.remove('tgp-open');
      if (backdrop) backdrop.classList.remove('tgp-open');

      // Restore body scroll
      if (this._origOverflow !== undefined) {
        document.body.style.overflow = this._origOverflow;
      }

      // Track dismissal vs conversion
      if (reason === 'converted') {
        recordConverted(this.cfg);
      } else {
        recordDismissed(this.cfg);
      }

      // Cleanup after animation
      setTimeout(() => {
        this.shadow.innerHTML = '';
        this.cleanupFns.forEach(fn => { try { fn(); } catch {} });
        this.cleanupFns = [];
      }, 320);
    }

    _bind() {
      const root = this.shadow.querySelector('.tgp-root');
      if (!root) return;
      const cfg = this.cfg;
      const self = this;

      // Close button
      const closeBtn = root.querySelector('[data-tgp-close]');
      if (closeBtn) closeBtn.addEventListener('click', () => self.close('dismissed'));

      // Backdrop click
      if (cfg.closeOnBackdropClick) {
        const backdrop = root.querySelector('[data-tgp-backdrop]');
        if (backdrop) backdrop.addEventListener('click', () => self.close('dismissed'));
      }

      // Escape key
      if (cfg.closeOnEscape) {
        const onEsc = (e) => { if (e.key === 'Escape') self.close('dismissed'); };
        document.addEventListener('keydown', onEsc);
        this.cleanupFns.push(() => document.removeEventListener('keydown', onEsc));
      }

      // CTA click → counts as conversion for non-form content
      const cta = root.querySelector('[data-tgp-cta]');
      if (cta && cfg.contentType !== 'email-capture') {
        cta.addEventListener('click', () => {
          recordConverted(cfg);
        });
      }

      // Email form submit
      const form = root.querySelector('[data-tgp-form]');
      if (form) {
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          self._submitEmail(form);
        });
      }

      // Discount code copy
      const copyBtn = root.querySelector('[data-tgp-copy]');
      if (copyBtn) {
        copyBtn.addEventListener('click', () => {
          const code = cfg.discountCode || '';
          self._copyToClipboard(code);
          copyBtn.classList.add('tgp-copied');
          const labelSpan = copyBtn.querySelector('[data-tgp-copy-label]');
          if (labelSpan) labelSpan.textContent = cfg.discountCopiedLabel || 'Copied!';
          recordConverted(cfg);
        });
      }

      // Two-step yes/no
      const yes = root.querySelector('[data-tgp-twostep-yes]');
      const no = root.querySelector('[data-tgp-twostep-no]');
      if (yes) yes.addEventListener('click', () => {
        self.state.twoStepAccepted = true;
        self._rerenderContent();
      });
      if (no) no.addEventListener('click', () => self.close('dismissed'));
    }

    _rerenderContent() {
      const card = this.shadow.querySelector('[data-tgp-card]');
      if (!card) return;
      card.innerHTML = renderContent(this.cfg, this.state);
      this._bind();
    }

    _copyToClipboard(text) {
      if (!text) return;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text);
          return;
        }
      } catch {}
      // Fallback
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      } catch {}
    }

    async _submitEmail(form) {
      const cfg = this.cfg;
      const root = this.shadow.querySelector('.tgp-root');
      const errorEl = root.querySelector('[data-tgp-error]');
      const submitBtn = root.querySelector('[data-tgp-submit]');
      const emailInput = form.querySelector('input[name="email"]');
      const nameInput = form.querySelector('input[name="name"]');

      // Validate
      const email = (emailInput && emailInput.value || '').trim();
      const name = (nameInput && nameInput.value || '').trim();

      if (errorEl) { errorEl.hidden = true; errorEl.textContent = ''; }
      if (emailInput) emailInput.classList.remove('tgp-error');

      if (!isValidEmail(email)) {
        if (errorEl) { errorEl.hidden = false; errorEl.textContent = 'Please enter a valid email address'; }
        if (emailInput) emailInput.classList.add('tgp-error');
        if (emailInput) emailInput.focus();
        return;
      }

      if (cfg.emailRequireName && !name) {
        if (nameInput) nameInput.classList.add('tgp-error');
        if (nameInput) nameInput.focus();
        return;
      }

      // Disable submit
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Sending…';
      }

      try {
        const resp = await fetch(LEAD_API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            widgetId: cfg.widgetId || '',
            name,
            email,
            sourceUrl: window.location.href,
            referrer: document.referrer || ''
          })
        });
        if (!resp.ok) throw new Error('Submit failed');
        // Success
        this.state.submitted = true;
        recordConverted(cfg);
        this._rerenderContent();
      } catch (err) {
        if (errorEl) { errorEl.hidden = false; errorEl.textContent = 'Something went wrong. Please try again.'; }
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = cfg.emailSubmitLabel || 'Subscribe';
        }
      }
    }

    update(newConfig) {
      this.cfg = Object.assign({}, DEFAULTS, newConfig || {});
      if (this.state.isOpen) this._render(), this._bind();
    }

    destroy() {
      this.cleanupFns.forEach(fn => { try { fn(); } catch {} });
      this.cleanupFns = [];
      this.shadow.innerHTML = '';
    }
  }

  // ---------- Auto-init ----------
  async function init() {
    const containers = document.querySelectorAll('[data-tg-widget="popup"]:not([data-tgp-init])');
    for (const el of containers) {
      el.setAttribute('data-tgp-init', '1');
      try {
        let config = null;
        const inline = el.getAttribute('data-tg-config');
        if (inline) {
          try { config = JSON.parse(inline); } catch {}
        }
        if (!config) {
          const id = el.getAttribute('data-tg-id');
          if (id) {
            const resp = await fetch(API_BASE + '?id=' + encodeURIComponent(id));
            if (resp.ok) {
              const data = await resp.json();
              config = data && data.config ? data.config : data;
              if (config) config.widgetId = id;
            }
          }
        }
        if (!config) continue;
        new TGPopupWidget(el, config);
      } catch (e) {
        if (window.console && console.warn) console.warn('[TG Popup] Init failed:', e);
      }
    }
  }

  // Expose globally
  window.TGPopupWidget = TGPopupWidget;
  window.__TG_POPUP_VERSION__ = VERSION;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
