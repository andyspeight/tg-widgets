/**
 * Travelgenix Popup Widget v1.1.0
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
 *   announcement, email-capture, discount, image, two-step, video, travel-offers
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
 *
 * Changelog:
 *   v1.1.0 (May 2026) — travel-offers content type:
 *     • New 'travel-offers' content type renders live Travelify offers inside
 *       any popup layout
 *     • Three render modes: compact (cards list), single (one offer with hero),
 *       mini (text-only banner pills) — auto-picked from layout, overridable
 *     • Verified-data-only — every field defensively checked, no fabricated data
 *     • Async fetch from Travelify before showing the popup; popup stays hidden
 *       if the fetch returns nothing
 *   v1.0.0 — Initial release
 */
(function () {
  'use strict';

  const API_BASE = (typeof window !== 'undefined' && window.__TG_WIDGET_API__) || '/api/widget-config';
  const LEAD_API = (typeof window !== 'undefined' && window.__TG_POPUP_LEAD_API__) || '/api/popup-lead';
  const TRAVELIFY_ENDPOINT = 'https://api.travelify.io/widgetsvc/traveloffers';
  const VERSION = '1.1.0';
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

  // ---------- Travel-offers helpers (only used when contentType='travel-offers') ----------
  // Format an ISO date as "14 May" (no year — popup space is precious).
  function offersFormatDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return d.getDate() + ' ' + months[d.getMonth()];
  }

  // Convert API enum-ish strings ("HalfBoard") to readable labels ("Half board").
  function offersFormatEnum(s) {
    if (!s) return '';
    const known = {
      RoomOnly: 'Room only',
      BedAndBreakfast: 'B&B',
      HalfBoard: 'Half board',
      FullBoard: 'Full board',
      AllInclusive: 'All inclusive',
      Economy: 'Economy',
      PremiumEconomy: 'Premium economy',
      Business: 'Business',
      First: 'First class'
    };
    if (known[s]) return known[s];
    // Fallback: split CamelCase, lowercase the rest
    const result = String(s).replace(/([A-Z])/g, ' $1').trim();
    return result.charAt(0).toUpperCase() + result.slice(1).toLowerCase();
  }

  // Get the package type from an offer, defending against shape variation.
  function offersGetPackageType(o) {
    if (!o) return null;
    return o.packageType || (o.package && o.package.type) || null;
  }

  // Compute a display price object with primary + sub strings.
  // Mirrors the inline offers widget's behaviour but simpler — popups don't
  // need per-night/per-person variants since space is too tight.
  function offersDisplayPrice(o) {
    if (!o) return { primary: '', sub: '' };
    const acc = o.accommodation || {};
    const f = o.flight || {};
    const accPrice = acc.pricing && acc.pricing.price;
    const flightPrice = f.pricing && f.pricing.price;
    const price = accPrice || flightPrice || 0;
    if (!price) return { primary: '', sub: '' };
    return {
      primary: '£' + Math.round(price).toLocaleString('en-GB'),
      sub: '/pp'
    };
  }

  // Compute the "was" price (strike-through) if the offer has a verified discount.
  // Returns null if no verified before-price exists.
  function offersWasPrice(o) {
    if (!o) return null;
    const acc = o.accommodation || {};
    const f = o.flight || {};
    const accP = acc.pricing || {};
    const flP = f.pricing || {};
    if (accP.priceChanged && accP.priceBeforeChange) {
      return '£' + Math.round(accP.priceBeforeChange).toLocaleString('en-GB');
    }
    if (flP.priceChanged && flP.priceBeforeChange) {
      return '£' + Math.round(flP.priceBeforeChange).toLocaleString('en-GB');
    }
    return null;
  }

  // Compute discount percentage if both before and current price are present.
  // Returns null if either is missing or the calculation isn't meaningful.
  function offersDiscountPercent(o) {
    if (!o) return null;
    const acc = o.accommodation || {};
    const f = o.flight || {};
    const accP = acc.pricing || {};
    const flP = f.pricing || {};
    let before = 0, now = 0;
    if (accP.priceChanged && accP.priceBeforeChange) {
      before = accP.priceBeforeChange;
      now = accP.price;
    } else if (flP.priceChanged && flP.priceBeforeChange) {
      before = flP.priceBeforeChange;
      now = flP.price;
    }
    if (!before || !now || before <= now) return null;
    return Math.round(((before - now) / before) * 100);
  }

  // Pick a usable image URL. Returns empty string if nothing safe found.
  function offersImageUrl(o) {
    if (!o) return '';
    const acc = o.accommodation || {};
    const f = o.flight || {};
    const u = (acc.image && acc.image.url) || (f.image && f.image.url) || '';
    if (!u) return '';
    // Defensive — only allow https URLs
    if (typeof u !== 'string') return '';
    if (!u.startsWith('https://') && !u.startsWith('//')) return '';
    return u;
  }

  // Map UI offer type to API type + packageType, mirroring inline widget.
  function offersBuildPayload(cfg) {
    let apiType = cfg.offersType || 'Accommodation';
    let packageType = null;
    if (apiType === 'DynamicPackages') {
      apiType = 'Packages';
      packageType = 'DynamicPackages';
    } else if (apiType === 'PackageHolidays') {
      apiType = 'Packages';
      packageType = 'PackageHolidays';
    } else if (apiType === 'BothPackages') {
      apiType = 'Packages';
      packageType = 'Any';
    }
    const p = {
      type: apiType,
      deduping: 'None',
      currency: cfg.offersCurrency || 'GBP',
      language: cfg.offersLanguage || 'en-GB',
      nationality: cfg.offersNationality || 'GB',
      maxOffers: Math.max(1, Math.min(50, cfg.offersMaxOffers || 10)),
      rollingDates: true,
      DatesMin: cfg.offersDatesMin || 7,
      DatesMax: cfg.offersDatesMax || 180,
      sort: cfg.offersSort || 'price:asc',
      pricingByType: 'Person'
    };
    if (packageType) p.packageType = packageType;
    if (cfg.offersBudgetMin) p.budgetMin = cfg.offersBudgetMin;
    if (cfg.offersBudgetMax) p.budgetMax = cfg.offersBudgetMax;
    if (cfg.offersRatingMin) p.ratingMin = cfg.offersRatingMin;
    if (cfg.offersDurationMin) p.durationMin = cfg.offersDurationMin;
    if (cfg.offersDurationMax) p.durationMax = cfg.offersDurationMax;
    if (Array.isArray(cfg.offersOrigins) && cfg.offersOrigins.length) p.origins = cfg.offersOrigins;
    if (Array.isArray(cfg.offersDestinations) && cfg.offersDestinations.length) p.destinations = cfg.offersDestinations;
    if (Array.isArray(cfg.offersBoardBases) && cfg.offersBoardBases.length) p.boardBases = cfg.offersBoardBases;
    if (Array.isArray(cfg.offersCabinClasses) && cfg.offersCabinClasses.length) p.cabinClasses = cfg.offersCabinClasses;
    return p;
  }

  // Cache offers per config payload — sessionStorage so it stays for the visit
  // but doesn't persist across days. TTL in minutes.
  const OFFERS_CACHE_PREFIX = 'tgp_offers_';
  function offersCacheKey(widgetId, payload) {
    const str = JSON.stringify(payload);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return OFFERS_CACHE_PREFIX + (widgetId || 'inline') + '_' + Math.abs(hash).toString(36);
  }
  function offersCacheGet(key, ttlMs) {
    if (!ttlMs) return null;
    try {
      const raw = window.sessionStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.t || Date.now() - parsed.t > ttlMs) return null;
      return parsed.d || null;
    } catch { return null; }
  }
  function offersCacheSet(key, data) {
    try {
      window.sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), d: data }));
    } catch {}
  }

  // Plane SVG used in flight strips and route pills.
  function offersPlaneIcon(size) {
    size = size || 12;
    return '<svg class="tgp-offers-plane" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">'
      + '<path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/>'
      + '</svg>';
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

    // Travel offers — used when contentType === 'travel-offers'
    // Renders live Travelify offers inside the popup. Same payload shape
    // as the inline offers widget. Render mode auto-picks from layout
    // unless overridden via offersRenderMode.
    offersAppId: '',         // Travelify app ID — required
    offersApiKey: '',        // Travelify API key — required
    offersType: 'Accommodation', // Accommodation | Flights | DynamicPackages | PackageHolidays | BothPackages
    offersOrigins: [],       // origin filter (IATA codes or country codes)
    offersDestinations: [],  // destination filter (IATA codes or country codes)
    offersBoardBases: [],    // BB | HB | FB | AI etc.
    offersCabinClasses: [],
    offersBudgetMin: 0,
    offersBudgetMax: 0,
    offersRatingMin: 0,
    offersDurationMin: 0,
    offersDurationMax: 0,
    offersDatesMin: 7,
    offersDatesMax: 180,
    offersMaxOffers: 10,     // cap — popups should be small lists, default smaller than inline widget
    offersSort: 'price:asc',
    offersCurrency: 'GBP',
    offersLanguage: 'en-GB',
    offersNationality: 'GB',
    offersCacheMinutes: 15,
    offersRenderMode: 'auto',// auto | compact | single | mini
    offersHeading: '',       // optional heading text inside popup ("Live deals")
    offersShowPulse: true,   // show the green-pulse "live" indicator
    offersFooterText: '',    // optional bottom strip text — left blank means no strip
    offersFooterCtaText: '', // optional bottom CTA — blank means no CTA
    offersFooterCtaUrl: '',
    offersRotateInterval: 8000, // ms — single-mode auto-rotate interval (0 = no rotation)

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

    /* ============================================================
       TRAVEL-OFFERS CONTENT TYPE
       Three render modes — compact (cards), single (one offer hero),
       mini (banner pills). All sit inside the popup card chassis.
       ============================================================ */
    .tgp-offers {
      display: flex;
      flex-direction: column;
      max-width: 100%;
    }

    /* Shared header bar (compact + single without image) */
    .tgp-offers-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 14px 18px;
      border-bottom: 1px solid rgba(var(--tgp-brand-rgb), 0.1);
    }
    .tgp-offers-header {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--tgp-brand);
    }
    .tgp-offers-pulse {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #10B981;
      box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.5);
      animation: tgp-offers-pulse 2s ease-out infinite;
      flex-shrink: 0;
    }
    @keyframes tgp-offers-pulse {
      0%   { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.5); }
      100% { box-shadow: 0 0 0 8px rgba(16, 185, 129, 0); }
    }
    @media (prefers-reduced-motion: reduce) {
      .tgp-offers-pulse { animation: none; }
    }
    .tgp-offers-close {
      width: 28px;
      height: 28px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: rgba(var(--tgp-brand-rgb), 0.06);
      border: 0;
      border-radius: 50%;
      color: var(--tgp-text);
      cursor: pointer;
      flex-shrink: 0;
      transition: background 0.15s ease;
    }
    .tgp-offers-close:hover { background: rgba(var(--tgp-brand-rgb), 0.12); }
    .tgp-offers-close svg { width: 14px; height: 14px; }
    .tgp-offers-empty {
      padding: 28px 24px;
      text-align: center;
      font-size: 13px;
      color: rgba(var(--tgp-brand-rgb), 0.6);
    }

    /* ---------- COMPACT MODE ---------- */
    .tgp-offers-list {
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      max-height: 480px;
      overflow-y: auto;
    }
    /* Custom scrollbar for the offer list */
    .tgp-offers-list::-webkit-scrollbar { width: 6px; }
    .tgp-offers-list::-webkit-scrollbar-track { background: transparent; }
    .tgp-offers-list::-webkit-scrollbar-thumb {
      background: rgba(var(--tgp-brand-rgb), 0.15);
      border-radius: 3px;
    }
    .tgp-offers-card {
      display: flex;
      gap: 12px;
      padding: 10px;
      border: 1px solid rgba(var(--tgp-brand-rgb), 0.12);
      border-radius: 12px;
      text-decoration: none;
      color: inherit;
      transition: border-color 0.15s ease, background 0.15s ease;
    }
    .tgp-offers-card:hover {
      border-color: var(--tgp-accent);
      background: rgba(var(--tgp-accent-rgb), 0.04);
    }
    .tgp-offers-card-img {
      width: 84px;
      height: 84px;
      flex-shrink: 0;
      border-radius: 8px;
      background-size: cover;
      background-position: center;
      background-color: rgba(var(--tgp-brand-rgb), 0.08);
    }
    .tgp-offers-card-img-placeholder {
      background-image: linear-gradient(135deg, rgba(var(--tgp-accent-rgb), 0.15), rgba(var(--tgp-brand-rgb), 0.15));
    }
    .tgp-offers-card-body {
      flex: 1;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      min-width: 0;
    }
    .tgp-offers-card-kicker {
      font-size: 9px;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: rgba(var(--tgp-brand-rgb), 0.55);
      margin-bottom: 2px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .tgp-offers-card-name {
      font-size: 14px;
      font-weight: 600;
      letter-spacing: -0.005em;
      line-height: 1.3;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      color: var(--tgp-text);
    }
    .tgp-offers-card-meta {
      font-size: 11px;
      color: rgba(var(--tgp-brand-rgb), 0.6);
      margin-top: 4px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .tgp-offers-card-foot {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 8px;
      margin-top: 6px;
    }
    .tgp-offers-card-price {
      font-size: 16px;
      font-weight: 700;
      letter-spacing: -0.015em;
      color: var(--tgp-text);
      display: inline-flex;
      align-items: baseline;
      gap: 6px;
    }
    .tgp-offers-card-was {
      font-size: 11px;
      font-weight: 500;
      color: rgba(var(--tgp-brand-rgb), 0.5);
      text-decoration: line-through;
    }
    .tgp-offers-card-price small {
      font-size: 9px;
      font-weight: 500;
      color: rgba(var(--tgp-brand-rgb), 0.5);
      margin-left: 1px;
    }
    .tgp-offers-card-cta {
      font-size: 11px;
      font-weight: 600;
      color: var(--tgp-accent);
    }
    .tgp-offers-foot {
      padding: 12px 16px;
      border-top: 1px solid rgba(var(--tgp-brand-rgb), 0.1);
      background: rgba(var(--tgp-brand-rgb), 0.03);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      font-size: 11px;
    }
    .tgp-offers-foot-text {
      color: rgba(var(--tgp-brand-rgb), 0.6);
    }
    .tgp-offers-foot-cta {
      background: var(--tgp-brand);
      color: var(--tgp-text-on-brand);
      font-size: 12px;
      font-weight: 600;
      padding: 8px 14px;
      border-radius: 8px;
      text-decoration: none;
      flex-shrink: 0;
    }

    /* ---------- SINGLE MODE ---------- */
    .tgp-offers-single { position: relative; }
    .tgp-offers-rot {
      position: absolute;
      top: 12px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      gap: 5px;
      z-index: 4;
    }
    .tgp-offers-rot-dot {
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.5);
      border: 0;
      padding: 0;
      cursor: pointer;
      transition: background 0.2s ease, width 0.2s ease;
    }
    .tgp-offers-rot-dot:hover { background: rgba(255, 255, 255, 0.8); }
    .tgp-offers-rot-active {
      background: white;
      width: 16px;
      border-radius: 4px;
    }
    .tgp-offers-single-hero {
      height: 180px;
      background-size: cover;
      background-position: center;
      background-color: rgba(var(--tgp-brand-rgb), 0.08);
      position: relative;
    }
    .tgp-offers-single-hero-overlay {
      position: absolute;
      inset: 0;
      background: linear-gradient(to top, rgba(15, 23, 42, 0.55) 0%, transparent 50%);
    }
    .tgp-offers-single-discount {
      position: absolute;
      top: 12px;
      right: 12px;
      background: #10B981;
      color: white;
      font-size: 11px;
      font-weight: 800;
      padding: 5px 9px;
      border-radius: 999px;
      letter-spacing: -0.01em;
      z-index: 3;
    }
    .tgp-offers-single-close-wrap {
      position: absolute;
      top: 12px;
      right: 12px;
      z-index: 3;
    }
    /* If both discount and close present, push close down — actually we always show close
       so swap: discount goes top-left if no rotation present */
    .tgp-offers-single .tgp-offers-rot ~ .tgp-offers-single-hero .tgp-offers-single-discount { right: 12px; top: 32px; }
    /* When there's no rotation we want close at top-right and discount can stay too —
       in practice the single popup with no rotation = no discount conflict; if both,
       the close stays on top-right (outer) and discount overlays beneath. Acceptable. */
    .tgp-offers-single-close-wrap .tgp-offers-close {
      background: rgba(0, 0, 0, 0.45);
      backdrop-filter: blur(8px);
      color: white;
    }
    .tgp-offers-single-close-wrap .tgp-offers-close:hover { background: rgba(0, 0, 0, 0.65); }

    .tgp-offers-single-body {
      padding: 16px 18px 18px;
    }
    .tgp-offers-single-kicker {
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: rgba(var(--tgp-brand-rgb), 0.55);
      margin-bottom: 6px;
    }
    .tgp-offers-single-name {
      font-size: 18px;
      font-weight: 700;
      letter-spacing: -0.015em;
      line-height: 1.2;
      margin: 0 0 10px;
      color: var(--tgp-text);
    }
    .tgp-offers-single-flight {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      color: rgba(var(--tgp-brand-rgb), 0.7);
      margin-bottom: 12px;
      padding: 8px 10px;
      background: rgba(var(--tgp-brand-rgb), 0.05);
      border-radius: 6px;
    }
    .tgp-offers-single-flight .tgp-offers-plane {
      color: var(--tgp-accent);
      flex-shrink: 0;
    }
    .tgp-offers-single-foot {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding-top: 12px;
      border-top: 1px solid rgba(var(--tgp-brand-rgb), 0.1);
    }
    .tgp-offers-single-price {
      display: flex;
      flex-direction: column;
      line-height: 1.1;
    }
    .tgp-offers-single-was {
      font-size: 11px;
      color: rgba(var(--tgp-brand-rgb), 0.5);
      text-decoration: line-through;
      margin-bottom: 2px;
    }
    .tgp-offers-single-now {
      font-size: 22px;
      font-weight: 800;
      letter-spacing: -0.02em;
      color: var(--tgp-text);
    }
    .tgp-offers-single-now small {
      font-size: 10px;
      font-weight: 500;
      color: rgba(var(--tgp-brand-rgb), 0.55);
      margin-left: 3px;
    }
    .tgp-offers-single-cta {
      background: var(--tgp-brand);
      color: var(--tgp-text-on-brand);
      font-size: 13px;
      font-weight: 600;
      padding: 11px 18px;
      border-radius: 8px;
      text-decoration: none;
      flex-shrink: 0;
    }

    /* ---------- MINI MODE (top-bar / bottom-bar) ---------- */
    .tgp-offers-mini {
      flex-direction: row;
      align-items: stretch;
      background: var(--tgp-brand);
      color: var(--tgp-text-on-brand);
      overflow: hidden;
      width: 100%;
    }
    .tgp-offers-mini-stamp {
      flex-shrink: 0;
      padding: 12px 24px 12px 16px;
      background: rgba(0, 0, 0, 0.18);
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      clip-path: polygon(0 0, 100% 0, calc(100% - 12px) 100%, 0 100%);
    }
    .tgp-offers-mini-list {
      flex: 1;
      display: flex;
      align-items: center;
      gap: 0;
      padding: 0 8px;
      min-width: 0;
      overflow-x: auto;
      scrollbar-width: none;
    }
    .tgp-offers-mini-list::-webkit-scrollbar { display: none; }
    .tgp-offers-mini-pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 12px 14px;
      color: var(--tgp-text-on-brand);
      text-decoration: none;
      font-size: 12px;
      white-space: nowrap;
      position: relative;
      flex-shrink: 0;
      transition: opacity 0.15s ease;
    }
    .tgp-offers-mini-pill:hover { opacity: 0.85; }
    .tgp-offers-mini-pill:not(:last-child)::after {
      content: '';
      position: absolute;
      right: 0;
      top: 50%;
      height: 14px;
      width: 1px;
      background: rgba(255, 255, 255, 0.18);
      transform: translateY(-50%);
    }
    .tgp-offers-mini-pill-route {
      font-weight: 700;
      letter-spacing: 0.04em;
      font-variant-numeric: tabular-nums;
    }
    .tgp-offers-mini-pill-name {
      font-weight: 600;
      max-width: 160px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .tgp-offers-mini-pill-meta {
      color: rgba(255, 255, 255, 0.65);
      font-size: 11px;
    }
    .tgp-offers-mini-pill-price {
      color: var(--tgp-accent);
      font-weight: 700;
    }
    .tgp-offers-mini-cta {
      flex-shrink: 0;
      background: var(--tgp-accent);
      color: white;
      text-decoration: none;
      font-size: 12px;
      font-weight: 600;
      padding: 12px 20px;
      display: inline-flex;
      align-items: center;
      border-left: 1px solid rgba(255, 255, 255, 0.1);
    }
    .tgp-offers-mini-close {
      flex-shrink: 0;
      width: 36px;
      background: transparent;
      border: 0;
      color: rgba(255, 255, 255, 0.7);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: color 0.15s ease;
    }
    .tgp-offers-mini-close:hover { color: white; }
    .tgp-offers-mini-close svg { width: 14px; height: 14px; }
    .tgp-offers-mini-empty {
      flex: 1;
      padding: 14px 20px;
      font-size: 12px;
      opacity: 0.7;
    }

    /* The mini mode card needs to fill the bar width, override card defaults */
    .tgp-layout-top-bar .tgp-card,
    .tgp-layout-bottom-bar .tgp-card {
      padding: 0;
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

  // ---------- Travel-offers content rendering ----------
  // Three render modes — compact, single, mini. Auto-picked from layout
  // unless overridden via offersRenderMode. All three follow the
  // verified-data-only rule: every field defensively checked before render,
  // missing pieces simply omitted (no fabricated defaults).

  // Pick the right render mode for the current layout, with override.
  function offersPickRenderMode(cfg) {
    const override = cfg.offersRenderMode;
    if (override === 'compact' || override === 'single' || override === 'mini') return override;
    const layout = cfg.layout || 'centered';
    if (layout === 'top-bar' || layout === 'bottom-bar') return 'mini';
    if (layout === 'floating-card') return 'single';
    // centered, slide-in, side-drawer, fullscreen, inline → compact
    return 'compact';
  }

  // Build the kicker line for an offer based on its type. Each piece is only
  // included if the underlying field exists. Returns empty string if nothing
  // useful was found.
  function offersKickerText(o) {
    if (!o) return '';
    const acc = o.accommodation || {};
    const f = o.flight || {};
    const dest = acc.destination || f.destination || {};
    const isAcc = o.type === 'Accommodation';
    const isFlight = o.type === 'Flight' || o.type === 'Flights';
    const isPkg = o.type === 'Package' || o.type === 'Packages';
    const parts = [];
    if (isAcc || isPkg) {
      if (dest.name) parts.push(dest.name);
      if (acc.nights) parts.push(acc.nights + ' night' + (acc.nights === 1 ? '' : 's'));
      if (acc.boardBasis) parts.push(offersFormatEnum(acc.boardBasis));
    } else if (isFlight) {
      if (f.origin && f.origin.iataCode && f.destination && f.destination.iataCode) {
        parts.push(f.origin.iataCode + ' → ' + f.destination.iataCode);
      }
      if (f.direct === true) parts.push('Direct');
      if (f.carrier && f.carrier.name) parts.push(f.carrier.name);
    }
    return parts.join(' · ');
  }

  // Build the headline for an offer. For accommodation/packages this is the
  // hotel name; for flights it's the destination name (or IATA if no name).
  // Returns empty string if no headline can be built (caller should skip the offer).
  function offersHeadlineText(o) {
    if (!o) return '';
    const acc = o.accommodation || {};
    const f = o.flight || {};
    const isFlight = o.type === 'Flight' || o.type === 'Flights';
    if (isFlight) {
      const dest = f.destination || {};
      if (dest.name) return dest.name;
      if (dest.iataCode) return dest.iataCode;
      return '';
    }
    return acc.name || '';
  }

  // Build the flight info strip for packages — same logic as inline widget.
  // Returns empty string for non-packages or when no flight info present.
  function offersFlightStripText(o) {
    if (!o) return '';
    const isPkg = o.type === 'Package' || o.type === 'Packages';
    if (!isPkg) return '';
    const f = o.flight || {};
    const og = f.origin || {};
    const dest = f.destination || {};
    const parts = [];
    if (og.iataCode && dest.iataCode) parts.push(og.iataCode + ' → ' + dest.iataCode);
    if (f.carrier && f.carrier.name) parts.push(f.carrier.name);
    if (f.direct === true) parts.push('Direct');
    if (f.outboundDate) parts.push('Departs ' + offersFormatDate(f.outboundDate));
    return parts.join(' · ');
  }

  // Render the close button (used in all offer render modes).
  function offersCloseBtn() {
    return '<button class="tgp-offers-close" data-tgp-close aria-label="Close">'
      + svg(IC.close) + '</button>';
  }

  // Render the optional pulse + heading label.
  function offersHeader(cfg) {
    const showPulse = cfg.offersShowPulse !== false;
    const heading = cfg.offersHeading || 'Live deals';
    if (!heading && !showPulse) return '';
    let html = '<div class="tgp-offers-header">';
    if (showPulse) html += '<span class="tgp-offers-pulse"></span>';
    if (heading) html += '<span class="tgp-offers-heading">' + esc(heading) + '</span>';
    html += '</div>';
    return html;
  }

  // ---------- COMPACT MODE — multi-card vertical list ----------
  // For: centered, slide-in, side-drawer, fullscreen, inline
  function renderTravelOffersCompact(cfg, state) {
    const offers = (state.offersData || []).filter(offersHeadlineText); // skip ones with no headline

    // The compact mode renders nothing if no offers — caller should keep popup hidden,
    // but defend with friendly empty state in case state still gets here.
    let html = '<div class="tgp-offers tgp-offers-compact">';
    html += '<div class="tgp-offers-bar">';
    html += offersHeader(cfg);
    html += offersCloseBtn();
    html += '</div>';

    if (!offers.length) {
      html += '<div class="tgp-offers-empty">No offers available right now</div>';
      html += '</div>';
      return html;
    }

    html += '<div class="tgp-offers-list" data-tgp-offers-list>';
    for (const o of offers) {
      html += renderCompactCard(o);
    }
    html += '</div>';

    // Optional bottom strip — only rendered if both text and CTA present
    if (cfg.offersFooterText && cfg.offersFooterCtaText && cfg.offersFooterCtaUrl) {
      html += '<div class="tgp-offers-foot">';
      html += '<span class="tgp-offers-foot-text">' + esc(cfg.offersFooterText) + '</span>';
      html += '<a class="tgp-offers-foot-cta" href="' + esc(safeUrl(cfg.offersFooterCtaUrl)) + '" target="_blank" rel="noopener">'
        + esc(cfg.offersFooterCtaText) + '</a>';
      html += '</div>';
    }

    html += '</div>';
    return html;
  }

  function renderCompactCard(o) {
    const headline = offersHeadlineText(o);
    if (!headline) return '';
    const kicker = offersKickerText(o);
    const flightStrip = offersFlightStripText(o);
    const img = offersImageUrl(o);
    const display = offersDisplayPrice(o);
    const url = safeUrl(o.url || '#');
    const wasPrice = offersWasPrice(o);

    let html = '<a class="tgp-offers-card" href="' + esc(url) + '" target="_blank" rel="noopener" data-tgp-offer>';
    if (img) {
      html += '<div class="tgp-offers-card-img" style="background-image:url(\'' + esc(img) + '\')"></div>';
    } else {
      // No image → render a flat coloured tile so layout doesn't shift
      html += '<div class="tgp-offers-card-img tgp-offers-card-img-placeholder"></div>';
    }
    html += '<div class="tgp-offers-card-body">';
    html += '<div class="tgp-offers-card-top">';
    if (kicker) html += '<div class="tgp-offers-card-kicker">' + esc(kicker) + '</div>';
    html += '<div class="tgp-offers-card-name">' + esc(headline) + '</div>';
    if (flightStrip) html += '<div class="tgp-offers-card-meta">' + esc(flightStrip) + '</div>';
    html += '</div>';
    html += '<div class="tgp-offers-card-foot">';
    if (display.primary) {
      html += '<span class="tgp-offers-card-price">';
      if (wasPrice) html += '<span class="tgp-offers-card-was">' + esc(wasPrice) + '</span>';
      html += esc(display.primary);
      if (display.sub) html += '<small>' + esc(display.sub) + '</small>';
      html += '</span>';
    }
    html += '<span class="tgp-offers-card-cta">View →</span>';
    html += '</div>';
    html += '</div>';
    html += '</a>';
    return html;
  }

  // ---------- SINGLE MODE — one offer, hero treatment, optional rotation ----------
  // For: floating-card, centered (exit-intent), slide-in (single mode)
  function renderTravelOffersSingle(cfg, state) {
    const offers = (state.offersData || []).filter(offersHeadlineText);
    if (!offers.length) {
      return '<div class="tgp-offers tgp-offers-single">'
        + '<div class="tgp-offers-bar">' + offersHeader(cfg) + offersCloseBtn() + '</div>'
        + '<div class="tgp-offers-empty">No offers available right now</div>'
        + '</div>';
    }

    const idx = state.offersIndex || 0;
    const o = offers[idx % offers.length];
    const headline = offersHeadlineText(o);
    const kicker = offersKickerText(o);
    const flightStrip = offersFlightStripText(o);
    const img = offersImageUrl(o);
    const display = offersDisplayPrice(o);
    const wasPrice = offersWasPrice(o);
    const discount = offersDiscountPercent(o);
    const url = safeUrl(o.url || '#');

    let html = '<div class="tgp-offers tgp-offers-single">';

    // Rotation indicator — only if more than one offer
    if (offers.length > 1) {
      html += '<div class="tgp-offers-rot">';
      for (let i = 0; i < offers.length; i++) {
        const active = (i === idx % offers.length) ? ' tgp-offers-rot-active' : '';
        html += '<button class="tgp-offers-rot-dot' + active + '" data-tgp-rot-dot="' + i + '" aria-label="Show offer ' + (i + 1) + '"></button>';
      }
      html += '</div>';
    }

    // Hero image with optional overlay badges
    if (img) {
      html += '<div class="tgp-offers-single-hero" style="background-image:url(\'' + esc(img) + '\')">';
      html += '<div class="tgp-offers-single-hero-overlay"></div>';
      // Discount badge top-right (only when verifiable)
      if (discount && discount > 0) {
        html += '<span class="tgp-offers-single-discount">-' + discount + '%</span>';
      }
      // Close button sits on top of the hero
      html += '<div class="tgp-offers-single-close-wrap">' + offersCloseBtn() + '</div>';
      html += '</div>';
    } else {
      // No image → still need the close button
      html += '<div class="tgp-offers-bar">' + offersHeader(cfg) + offersCloseBtn() + '</div>';
    }

    // Body
    html += '<div class="tgp-offers-single-body">';
    if (kicker) html += '<div class="tgp-offers-single-kicker">' + esc(kicker) + '</div>';
    html += '<h3 class="tgp-offers-single-name">' + esc(headline) + '</h3>';
    if (flightStrip) {
      html += '<div class="tgp-offers-single-flight">' + offersPlaneIcon(12)
        + '<span>' + esc(flightStrip) + '</span></div>';
    }

    html += '<div class="tgp-offers-single-foot">';
    html += '<div class="tgp-offers-single-price">';
    if (wasPrice) html += '<span class="tgp-offers-single-was">' + esc(wasPrice) + '</span>';
    if (display.primary) {
      html += '<span class="tgp-offers-single-now">' + esc(display.primary);
      if (display.sub) html += '<small>' + esc(display.sub) + '</small>';
      html += '</span>';
    }
    html += '</div>';
    html += '<a class="tgp-offers-single-cta" href="' + esc(url) + '" target="_blank" rel="noopener" data-tgp-offer>View deal</a>';
    html += '</div>';

    html += '</div>'; // /body
    html += '</div>'; // /tgp-offers-single
    return html;
  }

  // ---------- MINI MODE — text-first banner pills ----------
  // For: top-bar, bottom-bar
  function renderTravelOffersMini(cfg, state) {
    const offers = (state.offersData || []).filter(offersHeadlineText);
    if (!offers.length) {
      return '<div class="tgp-offers tgp-offers-mini">'
        + '<div class="tgp-offers-mini-empty">No offers available</div>'
        + '</div>';
    }

    let html = '<div class="tgp-offers tgp-offers-mini">';

    // Persistent left-side stamp
    html += '<div class="tgp-offers-mini-stamp">';
    if (cfg.offersShowPulse !== false) html += '<span class="tgp-offers-pulse"></span>';
    html += '<span>' + esc(cfg.offersHeading || 'Live deals') + '</span>';
    html += '</div>';

    // Pills list
    html += '<div class="tgp-offers-mini-list">';
    for (const o of offers) {
      html += renderMiniPill(o);
    }
    html += '</div>';

    // Optional CTA
    if (cfg.offersFooterCtaText && cfg.offersFooterCtaUrl) {
      html += '<a class="tgp-offers-mini-cta" href="' + esc(safeUrl(cfg.offersFooterCtaUrl)) + '" target="_blank" rel="noopener">'
        + esc(cfg.offersFooterCtaText) + '</a>';
    }

    // Close button
    html += '<button class="tgp-offers-mini-close" data-tgp-close aria-label="Close">' + svg(IC.close) + '</button>';

    html += '</div>';
    return html;
  }

  function renderMiniPill(o) {
    const isFlight = o.type === 'Flight' || o.type === 'Flights';
    const isPkg = o.type === 'Package' || o.type === 'Packages';
    const url = safeUrl(o.url || '#');
    const display = offersDisplayPrice(o);
    if (!display.primary) return ''; // no price → no pill

    let html = '<a class="tgp-offers-mini-pill" href="' + esc(url) + '" target="_blank" rel="noopener" data-tgp-offer>';

    if (isFlight) {
      // Flight pill: route + airline (if both present)
      const f = o.flight || {};
      const og = f.origin || {};
      const dest = f.destination || {};
      if (og.iataCode && dest.iataCode) {
        html += '<span class="tgp-offers-mini-pill-route">' + esc(og.iataCode + ' → ' + dest.iataCode) + '</span>';
      }
      if (f.carrier && f.carrier.code) {
        html += '<span class="tgp-offers-mini-pill-meta">' + esc(f.carrier.code) + '</span>';
      } else if (f.carrier && f.carrier.name) {
        html += '<span class="tgp-offers-mini-pill-meta">' + esc(f.carrier.name) + '</span>';
      }
    } else {
      // Hotel/package pill: name + meta (destination + nights)
      const headline = offersHeadlineText(o);
      if (!headline) return '';
      html += '<span class="tgp-offers-mini-pill-name">' + esc(headline) + '</span>';
      const acc = o.accommodation || {};
      const dest = (acc.destination && acc.destination.name) || '';
      const nights = acc.nights ? acc.nights + ' nt' + (acc.nights === 1 ? '' : 's') : '';
      const metaParts = [];
      if (dest) metaParts.push(dest);
      if (nights) metaParts.push(nights);
      // For packages, add the route hint if present
      if (isPkg) {
        const f = o.flight || {};
        if (f.origin && f.origin.iataCode && f.destination && f.destination.iataCode) {
          metaParts.unshift(f.origin.iataCode + '→' + f.destination.iataCode);
        }
      }
      if (metaParts.length) {
        html += '<span class="tgp-offers-mini-pill-meta">' + esc(metaParts.join(' · ')) + '</span>';
      }
    }

    html += '<span class="tgp-offers-mini-pill-price">' + esc(display.primary) + '</span>';
    html += '</a>';
    return html;
  }

  // Top-level dispatcher for travel-offers content
  function renderTravelOffers(cfg, state) {
    if (!state.offersLoaded) {
      // Should not happen — open() awaits the fetch — but render a defensive
      // empty state if it does.
      return '<div class="tgp-offers"><div class="tgp-offers-empty">Loading…</div></div>';
    }
    const mode = offersPickRenderMode(cfg);
    if (mode === 'mini') return renderTravelOffersMini(cfg, state);
    if (mode === 'single') return renderTravelOffersSingle(cfg, state);
    return renderTravelOffersCompact(cfg, state);
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
    if (ct === 'travel-offers') return renderTravelOffers(cfg, state);
    return renderAnnouncement(cfg);
  }

  // ---------- Widget class ----------
  class TGPopupWidget {
    constructor(container, config) {
      this.el = container;
      this.cfg = Object.assign({}, DEFAULTS, config || {});
      this.state = {
        submitted: false,
        twoStepAccepted: false,
        isOpen: false,
        // Travel-offers state
        offersLoaded: false,
        offersData: [],
        offersIndex: 0
      };
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

    async open() {
      if (this.state.isOpen) return;

      // Travel-offers content needs the data fetched before we render.
      // If the fetch fails or returns nothing, we don't open at all —
      // an empty deals popup is worse than no popup. The visitor never
      // sees broken UI.
      if (this.cfg.contentType === 'travel-offers' && !this.state.offersLoaded) {
        const ok = await this._fetchOffers();
        if (!ok) {
          if (window.console && console.debug) console.debug('[TG Popup] Offers fetch failed or empty — staying hidden');
          return;
        }
      }

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

      // Start single-mode rotation if enabled
      if (this.cfg.contentType === 'travel-offers') {
        this._startOffersRotation();
      }

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

    // Fetch offers from Travelify. Returns true if data is usable, false otherwise.
    // Called before opening when contentType === 'travel-offers'.
    async _fetchOffers() {
      const cfg = this.cfg;
      if (!cfg.offersAppId || !cfg.offersApiKey) {
        if (window.console && console.warn) console.warn('[TG Popup] travel-offers content type requires offersAppId and offersApiKey');
        return false;
      }

      const payload = offersBuildPayload(cfg);
      const ttlMs = (cfg.offersCacheMinutes || 0) * 60 * 1000;
      const ck = offersCacheKey(cfg.widgetId || cfg._widgetId, payload);

      // Try cache first
      if (ttlMs > 0) {
        const cached = offersCacheGet(ck, ttlMs);
        if (Array.isArray(cached) && cached.length) {
          this.state.offersData = cached;
          this.state.offersLoaded = true;
          return true;
        }
      }

      try {
        const res = await fetch(TRAVELIFY_ENDPOINT, {
          method: 'POST',
          headers: {
            'Authorization': 'Token ' + cfg.offersAppId + ':' + cfg.offersApiKey,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });
        if (!res.ok) return false;
        const data = await res.json();
        if (!data || !data.success) return false;
        const offers = Array.isArray(data.data) ? data.data : [];
        if (!offers.length) return false;
        this.state.offersData = offers;
        this.state.offersLoaded = true;
        if (ttlMs > 0) offersCacheSet(ck, offers);
        return true;
      } catch (err) {
        if (window.console && console.debug) console.debug('[TG Popup] Travelify fetch error:', err);
        return false;
      }
    }

    // Auto-rotate single-mode offers if interval > 0 and we have multiple offers.
    _startOffersRotation() {
      const cfg = this.cfg;
      const interval = Math.max(0, cfg.offersRotateInterval || 0);
      if (!interval) return;
      // Only rotate in single render mode
      const mode = offersPickRenderMode(cfg);
      if (mode !== 'single') return;
      if (!this.state.offersData || this.state.offersData.length < 2) return;

      // Honour reduced-motion preference — don't auto-rotate
      try {
        if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      } catch {}

      const tick = () => {
        if (!this.state.isOpen) return;
        this.state.offersIndex = (this.state.offersIndex + 1) % this.state.offersData.length;
        this._rerenderContent();
      };
      this._offersRotateTimer = setInterval(tick, interval);
      this.cleanupFns.push(() => {
        if (this._offersRotateTimer) {
          clearInterval(this._offersRotateTimer);
          this._offersRotateTimer = null;
        }
      });
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

      // Travel-offers — rotation dots (single mode) and click-tracking on each offer link
      const rotDots = root.querySelectorAll('[data-tgp-rot-dot]');
      rotDots.forEach((dot) => {
        dot.addEventListener('click', (e) => {
          e.preventDefault();
          const i = parseInt(dot.getAttribute('data-tgp-rot-dot'), 10) || 0;
          self.state.offersIndex = i;
          // Pause auto-rotation when the visitor takes manual control
          if (self._offersRotateTimer) {
            clearInterval(self._offersRotateTimer);
            self._offersRotateTimer = null;
          }
          self._rerenderContent();
        });
      });
      // Any offer link click counts as conversion
      const offerLinks = root.querySelectorAll('[data-tgp-offer]');
      offerLinks.forEach((link) => {
        link.addEventListener('click', () => {
          recordConverted(cfg);
        });
      });
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
