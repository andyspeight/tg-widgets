/* ============================================================================
 * widget-group-trips.js  ·  Travelgenix Widget Suite
 * Group Trips — the cinematic tour page + booking module for a group departure.
 *
 * A fork of the Special Offer page (widget-offer-page.js). Same premium,
 * conversion-led landing page, but the content model is a tailor-made TOUR
 * (dates, price pp, deposit, min/max pax, itinerary) and the sticky enquiry
 * card is replaced by a BOOKING MODULE: a traveller registers, picks a
 * departure and party size, agrees the consent, and is taken to a hosted
 * deposit checkout. Setting booking.mode to "enquiry" falls back to the
 * inherited enquiry form (no payments).
 *
 * This stage is layout + capture only. The register flow validates and fires a
 * `tg-group-register` event; the deposit checkout is wired to the server in a
 * later ticket (GT-6). No card data ever touches this widget.
 *
 * WOW, all CSP-clean and dependency-free:
 *   - full-bleed hero with a slow Ken Burns zoom and layered gradient
 *   - glass sticky booking bar that slides in once the hero scrolls away
 *   - quick-facts tiles overlapping the hero
 *   - reveal-on-scroll sections (IntersectionObserver)
 *   - photo gallery with a keyboard-navigable lightbox
 *   - live "places left" progress in the booking module
 *   - sticky booking card with inline validation and a success state
 *   - honours prefers-reduced-motion
 *
 * Embed:
 *   <div data-tg-widget="group-trips" data-tg-id="YOUR_WIDGET_ID"></div>
 * or inline:
 *   <div data-tg-widget="group-trips" data-tg-config='{"tour":{...}}'></div>
 *
 * Config shape (stored in Airtable, snapshotted to gt_trips on publish):
 *   { theme, brand, accentColor, template, agencyName,
 *     tour:    { title, destination, summary, heroImage, gallery[], mapQuery,
 *                mapLat, mapLng, videoUrl, highlights[], included[],
 *                notIncluded[], departures[{date,label}], pricePerPerson,
 *                deposit, currency, balanceDueDate, minPax, maxPax, spotsTaken },
 *     booking: { mode: "booking"|"enquiry", showSpotsLeft, consentText },
 *     card:    { style } }
 * ========================================================================== */
(function () {
  'use strict';

  const VERSION = '0.1.0';

  // Resolve the API base off THIS script's origin. The widget is hosted on
  // widgets.travelify.io and embedded on customer sites, so a relative
  // '/api/...' resolves to the customer origin and 404s (blank render).
  function resolveApiBase() {
    if (typeof window === 'undefined') return '/api/widget-config';
    if (window.__TG_WIDGET_API__) return window.__TG_WIDGET_API__;
    try {
      const me = document.currentScript;
      if (me && me.src) return new URL(me.src).origin + '/api/widget-config';
      const scripts = document.getElementsByTagName('script');
      for (let i = scripts.length - 1; i >= 0; i--) {
        const s = scripts[i].src || '';
        if (/\/widget-group-trips\.js(\?|$|#)/.test(s)) return new URL(s).origin + '/api/widget-config';
      }
    } catch (e) { /* fall through */ }
    return '/api/widget-config';
  }
  const API_BASE = resolveApiBase();

  // ─── i18n ───────────────────────────────────────────────────
  // Fixed UI chrome only (section headings, fact labels, CTA copy, booking-bar
  // and form chrome, success states, aria-labels). The tour's own data — title,
  // summary, place names, prices, dates — is author content and is never
  // translated. English is the source and fallback. UK English, MVP is GBP only.
  const MESSAGES = {
    en: {
      defaultTitle: 'Your next group adventure',
      from: 'From', poa: 'POA', perPerson: 'per person',
      deposit: 'Deposit', depositPp: 'deposit per person',
      duration: 'Duration', groupSize: 'Group size', travellersUpTo: 'Up to {n} travellers',
      travellersRange: '{min} to {max} travellers', travellersFrom: 'From {min} travellers',
      destination: 'Destination', departures: 'Departures', dates: 'dates', oneDate: '1 date',
      balanceDue: 'Balance due by {date}',
      aboutTrip: 'About this trip', highlights: 'Trip highlights',
      whatsIncluded: "What's included", whatsNotIncluded: "What's not included",
      photos: 'Photos', takeALook: 'Take a look', whereYoullBe: "Where you're going",
      theDetail: 'The detail', itinerary: 'Itinerary',
      // Booking module
      reserveHeading: 'Reserve your place', bookNow: 'Reserve your place',
      chooseDeparture: 'Choose your departure', partySize: 'How many travellers?',
      traveller: 'traveller', travellers: 'travellers',
      fullName: 'Full name', addName: 'Please add your name',
      email: 'Email', validEmail: 'Valid email please', phone: 'Phone',
      consentRequired: 'Please tick to continue',
      payToday: "You'll pay {amount} today", depositEach: '{amount} deposit each',
      reserveCta: 'Reserve and pay deposit', continueCta: 'Continue',
      trustLine: 'Secure checkout. You only pay the deposit now, the balance is due later.',
      placesLeft: '{left} of {total} places left', soldOut: 'This departure is full',
      reservedHeading: "You're on the list", reservedBody: "Thanks {name}. We've held {n} for {departure}. Next you'll head to secure checkout to pay your {amount} deposit.",
      // Enquiry fallback
      enquireHeading: 'Enquire about this trip', sendEnquiry: 'Send my enquiry',
      messagePlaceholder: 'Anything else we should know? (dates, group size, questions)',
      enquiryTrust: 'No payment taken now. A travel expert replies within one working hour.',
      enquirySent: 'Enquiry sent', thanksName: 'Thanks {name}. A travel expert will be in touch within one working hour.',
      // Bands + chrome
      readyWhenYouAre: 'Ready to travel together?',
      ctaCopy: 'Reserve your place with a deposit and pay the balance closer to departure.',
      likeTheLook: 'Like the look of it?',
      bandCopy: 'Reserve your place now with a small deposit and we will hold it while your group decides.',
      tourRef: 'Trip ref', poweredBy: 'Powered by Travelgenix',
      openPhoto: 'Open photo {n}', video: 'Video',
      closePhoto: 'Close photo viewer', prevPhoto: 'Previous photo', nextPhoto: 'Next photo',
      photoAlt: '{title}, photo {n} of {total}',
      loading: 'Loading trip…', loadError: 'We could not load this trip.', retry: 'Try again',
      reserveNow: 'Reserve now'
    }
  };
  function makeT(cfg) {
    if (typeof window !== 'undefined' && window.TGi18n && typeof window.TGi18n.make === 'function') return window.TGi18n.make(MESSAGES, cfg);
    const dict = MESSAGES.en;
    const t = (k, vars) => {
      let s = Object.prototype.hasOwnProperty.call(dict, k) ? dict[k] : k;
      if (vars) s = String(s).replace(/\{(\w+)\}/g, (m, n) => (vars[n] != null ? vars[n] : m));
      return s;
    };
    t.lang = 'en'; t.dir = 'ltr';
    return t;
  }

  // Base URL this script was served from, so we can load sibling widgets
  // (widget-maps.js) from the same origin whether on tg-widgets or a client site.
  const SCRIPT_BASE = (function () {
    try {
      const s = document.currentScript && document.currentScript.src;
      if (s) return s.replace(/[^/]+$/, '');
    } catch (e) {}
    return '/';
  })();

  // Reuse the suite's map widget (Leaflet + MapTiler). Loaded on demand, once.
  let _mapsPromise = null;
  function ensureMaps() {
    if (typeof window !== 'undefined' && window.TGMapsWidget) return Promise.resolve();
    if (_mapsPromise) return _mapsPromise;
    _mapsPromise = new Promise(function (resolve, reject) {
      const s = document.createElement('script');
      s.src = SCRIPT_BASE + 'widget-maps.js';
      s.async = true;
      s.onload = resolve;
      s.onerror = function () { reject(new Error('maps-load-failed')); };
      document.head.appendChild(s);
    });
    return _mapsPromise;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function currencySymbol(code) {
    return { GBP: '£', EUR: '€', USD: '$', AUD: '$', CAD: '$' }[code] || '£';
  }
  function num(val) {
    if (val == null || val === '') return 0;
    const n = Number(String(val).replace(/[^0-9.]/g, ''));
    return isFinite(n) ? n : 0;
  }
  function money(sym, val) {
    const n = num(val);
    if (!n) return '';
    return sym + n.toLocaleString('en-GB');
  }
  function safeUrl(u) {
    if (!u) return '';
    const s = String(u).trim();
    if (/^(https?:)?\/\//i.test(s) || s.startsWith('/') || s.startsWith('#')) return s;
    return '';
  }
  function isEmail(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim()); }
  function fnum(v) {
    if (v == null || v === '') return null;
    const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
    return isFinite(n) ? n : null;
  }
  function clampInt(v, lo, hi) {
    let n = parseInt(v, 10);
    if (!isFinite(n)) n = lo;
    if (n < lo) n = lo;
    if (hi != null && n > hi) n = hi;
    return n;
  }

  // Parse a video URL into something embeddable (YouTube, Vimeo or a direct file).
  function parseVideo(url) {
    if (!url) return null;
    const u = String(url).trim();
    let m;
    if ((m = u.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|v\/)|youtu\.be\/)([\w-]{6,})/i))) return { type: 'youtube', id: m[1] };
    if ((m = u.match(/vimeo\.com\/(?:video\/)?(\d+)/i))) return { type: 'vimeo', id: m[1] };
    if (/\.(mp4|webm|ogg)(\?|#|$)/i.test(u) && safeUrl(u)) return { type: 'file', url: safeUrl(u) };
    return null;
  }
  function videoEmbed(v) {
    if (!v) return '';
    if (v.type === 'youtube') return '<iframe src="https://www.youtube-nocookie.com/embed/' + esc(v.id) + '?rel=0" title="Video" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>';
    if (v.type === 'vimeo') return '<iframe src="https://player.vimeo.com/video/' + esc(v.id) + '" title="Video" loading="lazy" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>';
    if (v.type === 'file') return '<video controls preload="metadata" src="' + esc(v.url) + '"></video>';
    return '';
  }

  // Scheduling window — a trip renders nothing outside its show window.
  function parseDay(s) {
    if (!s) return null;
    const m = String(s).trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]).getTime();
    const t = Date.parse(s);
    if (!isFinite(t)) return null;
    const dt = new Date(t);
    return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime();
  }
  function offerWindow(fromStr, untilStr) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const from = parseDay(fromStr), until = parseDay(untilStr);
    if (from !== null && today < from) return { live: false, state: 'upcoming', from: from, until: until };
    if (until !== null && today > until) return { live: false, state: 'ended', from: from, until: until };
    return { live: true, state: 'live', from: from, until: until };
  }
  // Format a departure into a friendly label, falling back to the raw date.
  function departureLabel(dep) {
    if (!dep) return '';
    if (typeof dep === 'string') return dep;
    if (dep.label) return String(dep.label);
    const ms = parseDay(dep.date);
    if (ms == null) return String(dep.date || '');
    try {
      return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    } catch (e) { return String(dep.date || ''); }
  }

  // Small inline icon set (stroke icons, currentColor)
  const I = {
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
    coin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M14.8 9a2.5 2.5 0 0 0-2.3-1.5c-1.4 0-2.5.9-2.5 2s1 1.7 2.5 2 2.5.9 2.5 2-1.1 2-2.5 2A2.5 2.5 0 0 1 9.2 15M12 6v1.5M12 16.5V18"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    dash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>',
    chevDown: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>'
  };

  // ── Styles ───────────────────────────────────────────────────────────────
  const STYLES = `
    :host { all: initial; display: block; }
    * { box-sizing: border-box; }
    .tggt {
      --tggt-brand: #1B2B5B; --tggt-accent: #0891B2; --tggt-accent-hover: #0E7490;
      --tggt-ink: #0F172A; --tggt-sub: #475569; --tggt-muted: #94A3B8;
      --tggt-bg: #FFFFFF; --tggt-surface: #FFFFFF; --tggt-alt: #F7F9FB; --tggt-border: #E8EDF3;
      --tggt-success: #10B981; --tggt-success-soft: #D1FAE5; --tggt-warn: #E8893A;
      --tggt-strike: #94A3B8; --tggt-gold: #FFB703; --tggt-radius: 18px;
      --tggt-shadow: 0 1px 2px rgba(15,23,42,0.05);
      --tggt-shadow-md: 0 10px 30px rgba(15,23,42,0.10);
      --tggt-shadow-lg: 0 30px 70px rgba(15,23,42,0.20);
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      color: var(--tggt-ink); line-height: 1.6; background: var(--tggt-bg);
      -webkit-font-smoothing: antialiased; display: block;
    }
    .tggt[data-theme="dark"] {
      --tggt-ink: #F1F5F9; --tggt-sub: #B6C2D4; --tggt-muted: #7C8AA0;
      --tggt-bg: #0B1220; --tggt-surface: #111B2E; --tggt-alt: #0E1626; --tggt-border: #243043;
      --tggt-success-soft: rgba(16,185,129,0.16);
      --tggt-shadow-md: 0 10px 30px rgba(0,0,0,0.5); --tggt-shadow-lg: 0 30px 70px rgba(0,0,0,0.6);
    }
    a { color: inherit; }
    .tggt-wrap { max-width: 1180px; margin: 0 auto; padding: 0 24px; }

    /* ── Sticky booking bar ── */
    .tggt-bar {
      position: fixed; top: 0; left: 0; right: 0; z-index: 60;
      background: color-mix(in srgb, var(--tggt-surface) 82%, transparent);
      backdrop-filter: saturate(180%) blur(14px); -webkit-backdrop-filter: saturate(180%) blur(14px);
      border-bottom: 1px solid var(--tggt-border);
      transform: translateY(-105%); transition: transform 0.35s cubic-bezier(.2,.8,.2,1);
      box-shadow: var(--tggt-shadow);
    }
    .tggt-bar.show { transform: translateY(0); }
    .tggt-bar-inner { max-width: 1180px; margin: 0 auto; padding: 10px 24px; display: flex; align-items: center; gap: 16px; }
    .tggt-bar-title { font-weight: 700; font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .tggt-bar-spacer { flex: 1; }
    .tggt-bar-price { font-weight: 800; font-size: 18px; white-space: nowrap; }
    .tggt-bar-price small { font-weight: 500; font-size: 12px; color: var(--tggt-sub); }

    /* ── Hero ── */
    .tggt-hero { position: relative; height: min(88vh, 760px); min-height: 520px; overflow: hidden; }
    .tggt-hero-img {
      position: absolute; inset: -4%; background-size: cover; background-position: center;
      animation: tggt-kenburns 26s ease-in-out infinite alternate; will-change: transform;
    }
    .tggt-hero-img.ph { background: linear-gradient(135deg, var(--tggt-brand), var(--tggt-accent)); animation: none; }
    @keyframes tggt-kenburns { from { transform: scale(1); } to { transform: scale(1.12); } }
    .tggt-hero::after {
      content: ''; position: absolute; inset: 0;
      background: linear-gradient(180deg, rgba(7,12,24,0.30) 0%, rgba(7,12,24,0.05) 32%, rgba(7,12,24,0.20) 60%, rgba(7,12,24,0.86) 100%);
    }
    .tggt-hero-inner {
      position: absolute; inset: 0; z-index: 2; max-width: 1180px; margin: 0 auto; padding: 0 24px 120px;
      display: flex; flex-direction: column; justify-content: flex-end; color: #fff;
    }
    .tggt-badges { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }
    .tggt-badge {
      font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.6px;
      padding: 6px 13px; border-radius: 999px; color: #fff; display: inline-flex; align-items: center; gap: 6px;
    }
    .tggt-badge svg { width: 13px; height: 13px; }
    .tggt-badge.accent { background: linear-gradient(120deg, var(--tggt-accent), var(--tggt-brand)); box-shadow: 0 6px 18px color-mix(in srgb, var(--tggt-accent) 45%, transparent); }
    .tggt-badge.glass { background: rgba(255,255,255,0.16); backdrop-filter: blur(6px); border: 1px solid rgba(255,255,255,0.25); }
    .tggt-badge.glass.light { background: var(--tggt-alt); border: 1px solid var(--tggt-border); color: var(--tggt-sub); }
    .tggt-eyebrow { font-size: 13px; font-weight: 700; letter-spacing: 1.4px; text-transform: uppercase; color: rgba(255,255,255,0.85); margin-bottom: 8px; }
    .tggt-h1 {
      font-size: clamp(34px, 5.4vw, 60px); font-weight: 800; line-height: 1.04; letter-spacing: -1px;
      margin: 0 0 14px; max-width: 16ch; text-shadow: 0 2px 30px rgba(0,0,0,0.35);
    }
    .tggt-hero-meta { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; font-size: 16px; }
    .tggt-hero-loc { display: inline-flex; align-items: center; gap: 7px; }
    .tggt-hero-loc svg { width: 17px; height: 17px; opacity: 0.9; }
    .tggt-scroll-cue {
      position: absolute; bottom: 22px; left: 50%; transform: translateX(-50%); z-index: 3;
      color: rgba(255,255,255,0.8); animation: tggt-bob 2s ease-in-out infinite;
    }
    .tggt-scroll-cue svg { width: 26px; height: 26px; }
    @keyframes tggt-bob { 0%,100% { transform: translate(-50%, 0); } 50% { transform: translate(-50%, 7px); } }

    /* ── Quick facts (overlap the hero) ── */
    .tggt-facts-wrap { position: relative; z-index: 5; margin-top: -64px; }
    .tggt-facts {
      background: var(--tggt-surface); border: 1px solid var(--tggt-border); border-radius: var(--tggt-radius);
      box-shadow: var(--tggt-shadow-lg); padding: 8px;
      display: grid; grid-template-columns: repeat(5, 1fr); gap: 4px;
    }
    .tggt-facts[data-n="4"] { grid-template-columns: repeat(4, 1fr); }
    .tggt-facts[data-n="3"] { grid-template-columns: repeat(3, 1fr); }
    .tggt-facts[data-n="2"] { grid-template-columns: repeat(2, 1fr); }
    .tggt-fact { text-align: center; padding: 16px 10px; border-radius: 12px; transition: background 0.15s ease; }
    .tggt-fact:hover { background: var(--tggt-alt); }
    .tggt-fact-ic { width: 26px; height: 26px; margin: 0 auto 8px; color: var(--tggt-accent); }
    .tggt-fact-ic svg { width: 100%; height: 100%; }
    .tggt-fact-lab { font-size: 10px; text-transform: uppercase; letter-spacing: 0.7px; color: var(--tggt-muted); font-weight: 700; }
    .tggt-fact-val { font-size: 15px; font-weight: 700; margin-top: 3px; }

    /* ── Body grid ── */
    .tggt-body { display: grid; grid-template-columns: 1fr 380px; gap: 44px; align-items: start; padding: 52px 0 70px; }
    .tggt-main { min-width: 0; }
    .tggt-section { margin-bottom: 46px; }
    .tggt-h2 { font-size: 26px; font-weight: 800; letter-spacing: -0.5px; margin: 0 0 16px; }
    .tggt-prose p { font-size: 16.5px; color: var(--tggt-sub); line-height: 1.8; margin: 0 0 14px; }

    .tggt-incl { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px 20px; }
    .tggt-incl li { display: flex; align-items: center; gap: 12px; font-size: 15.5px; font-weight: 500; }
    .tggt-incl .tick {
      flex-shrink: 0; width: 26px; height: 26px; border-radius: 50%; background: var(--tggt-success-soft);
      color: var(--tggt-success); display: flex; align-items: center; justify-content: center;
    }
    .tggt-incl .tick svg { width: 14px; height: 14px; }
    .tggt-incl.excl .tick { background: color-mix(in srgb, var(--tggt-muted) 18%, transparent); color: var(--tggt-muted); }
    .tggt-incl.excl li { color: var(--tggt-sub); }

    /* Highlights chips */
    .tggt-tags { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 4px; }
    .tggt-tag { font-size: 12px; font-weight: 600; background: var(--tggt-alt); border: 1px solid var(--tggt-border); color: var(--tggt-sub); padding: 6px 12px; border-radius: 999px; }

    /* Gallery */
    .tggt-gallery { display: grid; grid-template-columns: repeat(4, 1fr); grid-auto-rows: 150px; gap: 10px; }
    .tggt-gallery .g {
      border-radius: 14px; background-size: cover; background-position: center; cursor: pointer;
      position: relative; overflow: hidden; transition: transform 0.3s ease; border: 0; padding: 0;
    }
    .tggt-gallery .g:hover { transform: scale(1.02); }
    .tggt-gallery .g:first-child { grid-column: span 2; grid-row: span 2; }
    .tggt-gallery .g::after { content: ''; position: absolute; inset: 0; background: rgba(15,23,42,0); transition: background 0.2s ease; }
    .tggt-gallery .g:hover::after { background: rgba(15,23,42,0.12); }

    /* Departures table */
    .tggt-table { width: 100%; border-collapse: collapse; font-size: 15px; }
    .tggt-table td { padding: 13px 0; border-bottom: 1px solid var(--tggt-border); }
    .tggt-table td:first-child { color: var(--tggt-muted); font-weight: 600; width: 40%; }
    .tggt-table td:last-child { font-weight: 600; }

    /* ── Booking / enquiry card ── */
    .tggt-aside { position: sticky; top: 84px; }
    .tggt-book {
      background: var(--tggt-surface); border: 1px solid var(--tggt-border); border-radius: var(--tggt-radius);
      box-shadow: var(--tggt-shadow-md); overflow: hidden;
    }
    .tggt-book-top { padding: 22px 24px 20px; border-bottom: 1px solid var(--tggt-border); }
    .tggt-book-from { font-size: 12px; text-transform: uppercase; letter-spacing: 0.7px; color: var(--tggt-muted); font-weight: 700; }
    .tggt-price-row { display: flex; align-items: baseline; gap: 10px; margin: 4px 0 2px; }
    .tggt-price { font-size: 42px; font-weight: 800; letter-spacing: -1px; line-height: 1; }
    .tggt-price small { font-size: 14px; font-weight: 500; color: var(--tggt-sub); }
    .tggt-deposit { margin-top: 14px; font-size: 13.5px; color: var(--tggt-ink); background: color-mix(in srgb, var(--tggt-accent) 10%, transparent); border: 1px solid color-mix(in srgb, var(--tggt-accent) 22%, transparent); border-radius: 12px; padding: 11px 14px; display: flex; gap: 9px; align-items: center; }
    .tggt-deposit svg { width: 17px; height: 17px; color: var(--tggt-accent); flex-shrink: 0; }

    /* Places-left progress */
    .tggt-spots { margin-top: 14px; }
    .tggt-spots-row { display: flex; align-items: center; justify-content: space-between; font-size: 13px; font-weight: 700; margin-bottom: 7px; }
    .tggt-spots-left { color: var(--tggt-warn); }
    .tggt-spots-left.plenty { color: var(--tggt-success); }
    .tggt-spots-total { color: var(--tggt-muted); font-weight: 600; }
    .tggt-spots-track { height: 8px; border-radius: 999px; background: var(--tggt-alt); overflow: hidden; border: 1px solid var(--tggt-border); }
    .tggt-spots-fill { height: 100%; border-radius: 999px; background: linear-gradient(90deg, var(--tggt-accent), var(--tggt-brand)); transition: width 0.4s ease; }

    .tggt-form { padding: 20px 24px 24px; display: flex; flex-direction: column; gap: 11px; }
    .tggt-form-h { font-weight: 800; font-size: 17px; }
    .tggt-form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 11px; }
    .tggt-field { display: flex; flex-direction: column; gap: 5px; }
    .tggt-label { font-size: 12px; font-weight: 700; color: var(--tggt-sub); }
    .tggt-input {
      width: 100%; padding: 11px 13px; border: 1px solid var(--tggt-border); border-radius: 11px;
      font: inherit; font-size: 14.5px; background: var(--tggt-bg); color: var(--tggt-ink); transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }
    .tggt-input:focus { outline: none; border-color: var(--tggt-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--tggt-accent) 18%, transparent); }
    textarea.tggt-input { resize: vertical; min-height: 72px; }
    .tggt-field.bad .tggt-input { border-color: #DC2626; }
    .tggt-field-err { font-size: 11px; color: #DC2626; font-weight: 600; display: none; }
    .tggt-field.bad .tggt-field-err { display: block; }

    /* Consent */
    .tggt-consent { display: flex; gap: 10px; align-items: flex-start; font-size: 12.5px; color: var(--tggt-sub); line-height: 1.5; margin-top: 2px; }
    .tggt-consent input { margin-top: 2px; width: 16px; height: 16px; flex-shrink: 0; accent-color: var(--tggt-accent); }
    .tggt-consent.bad { color: #DC2626; }
    .tggt-consent.bad input { outline: 2px solid #DC2626; outline-offset: 1px; }

    .tggt-paytoday { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-top: 4px; font-size: 13.5px; color: var(--tggt-sub); }
    .tggt-paytoday b { font-size: 17px; font-weight: 800; color: var(--tggt-ink); }

    .tggt-submit {
      margin-top: 4px; border: 0; border-radius: 12px; padding: 15px; cursor: pointer; font: inherit;
      font-weight: 800; font-size: 15.5px; color: #fff;
      background: linear-gradient(120deg, var(--tggt-accent), var(--tggt-brand));
      background-size: 160% 100%; transition: background-position 0.4s ease, transform 0.1s ease;
      box-shadow: 0 10px 24px color-mix(in srgb, var(--tggt-accent) 35%, transparent);
      display: inline-flex; align-items: center; justify-content: center; gap: 9px;
    }
    .tggt-submit svg { width: 17px; height: 17px; }
    .tggt-submit:hover { background-position: 100% 0; }
    .tggt-submit:active { transform: translateY(1px); }
    .tggt-submit:disabled { opacity: 0.55; cursor: not-allowed; box-shadow: none; }
    .tggt-trust { font-size: 11.5px; color: var(--tggt-muted); text-align: center; margin-top: 4px; line-height: 1.6; display: flex; align-items: center; justify-content: center; gap: 6px; }
    .tggt-trust svg { width: 13px; height: 13px; color: var(--tggt-success); flex-shrink: 0; }
    .tggt-book-success { padding: 36px 24px; text-align: center; }
    .tggt-book-success .tick { width: 60px; height: 60px; border-radius: 50%; background: var(--tggt-success-soft); color: var(--tggt-success); display: flex; align-items: center; justify-content: center; margin: 0 auto 14px; }
    .tggt-book-success .tick svg { width: 28px; height: 28px; }
    .tggt-book-success h4 { margin: 0 0 6px; font-size: 18px; font-weight: 800; }
    .tggt-book-success p { margin: 0; color: var(--tggt-sub); font-size: 14px; line-height: 1.6; }

    /* ── Final CTA band ── */
    .tggt-cta-band { background: linear-gradient(120deg, var(--tggt-brand), color-mix(in srgb, var(--tggt-brand) 60%, var(--tggt-accent))); color: #fff; }
    .tggt-cta-inner { max-width: 1180px; margin: 0 auto; padding: 48px 24px; display: flex; align-items: center; gap: 24px; flex-wrap: wrap; }
    .tggt-cta-inner h3 { font-size: 26px; font-weight: 800; margin: 0 0 4px; }
    .tggt-cta-inner p { margin: 0; color: rgba(255,255,255,0.85); }
    .tggt-cta-spacer { flex: 1; }
    .tggt-btn {
      display: inline-flex; align-items: center; gap: 9px; border: 0; border-radius: 12px; cursor: pointer;
      font: inherit; font-weight: 800; font-size: 15px; padding: 14px 24px; text-decoration: none; white-space: nowrap;
    }
    .tggt-btn.primary { background: #fff; color: var(--tggt-brand); }
    .tggt-btn.primary svg { width: 17px; height: 17px; }
    .tggt-btn.ghost { background: rgba(255,255,255,0.14); color: #fff; border: 1px solid rgba(255,255,255,0.3); }
    .tggt-btn.sm { padding: 9px 16px; font-size: 14px; }
    .tggt-btn.accent { background: var(--tggt-accent); color: #fff; }
    .tggt-btn.accent:hover { background: var(--tggt-accent-hover); }

    /* Footer trust */
    .tggt-foot { background: var(--tggt-alt); border-top: 1px solid var(--tggt-border); }
    .tggt-foot-inner { max-width: 1180px; margin: 0 auto; padding: 26px 24px; display: flex; align-items: center; gap: 16px; flex-wrap: wrap; font-size: 13px; color: var(--tggt-muted); }
    .tggt-foot-inner svg { width: 16px; height: 16px; color: var(--tggt-success); }
    .tggt-foot-trust { display: inline-flex; align-items: center; gap: 8px; font-weight: 600; color: var(--tggt-sub); }

    /* ── Lightbox ── */
    .tggt-lb { position: fixed; inset: 0; z-index: 90; background: rgba(7,12,24,0.94); display: none; align-items: center; justify-content: center; }
    .tggt-lb.open { display: flex; }
    .tggt-lb-img { max-width: 92vw; max-height: 86vh; border-radius: 10px; box-shadow: 0 30px 80px rgba(0,0,0,0.6); }
    .tggt-lb-btn { position: absolute; background: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.25); color: #fff; width: 48px; height: 48px; border-radius: 50%; cursor: pointer; display: flex; align-items: center; justify-content: center; }
    .tggt-lb-btn svg { width: 22px; height: 22px; }
    .tggt-lb-btn.close { top: 22px; right: 22px; }
    .tggt-lb-btn.prev { left: 18px; top: 50%; transform: translateY(-50%); }
    .tggt-lb-btn.next { right: 18px; top: 50%; transform: translateY(-50%); }

    /* ── Video ── */
    .tggt-video { position: relative; width: 100%; aspect-ratio: 16 / 9; border-radius: 16px; overflow: hidden; background: #000; box-shadow: var(--tggt-shadow-md); }
    .tggt-video iframe, .tggt-video video { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; display: block; object-fit: cover; }

    /* ── Map ── */
    .tggt-map-addr { display: flex; align-items: center; gap: 8px; font-size: 15px; color: var(--tggt-sub); margin: 0 0 14px; }
    .tggt-map-addr svg { width: 16px; height: 16px; color: var(--tggt-accent); }
    .tggt-map { width: 100%; border-radius: 16px; overflow: hidden; box-shadow: var(--tggt-shadow-md); min-height: 120px; }
    .tggt-map.tggt-map-failed { display: none; }

    /* ── Split hero (immersive template) ── */
    .tggt-hero--split { display: grid; grid-template-columns: 1.05fr 1fr; height: min(82vh, 680px); min-height: 500px; }
    .tggt-hero--split::after { display: none; }
    .tggt-hsplit-img { position: relative; inset: auto; background-size: cover; background-position: center; animation: none; }
    .tggt-hsplit-img.ph { background: linear-gradient(135deg, var(--tggt-brand), var(--tggt-accent)); }
    .tggt-hsplit-panel { background: var(--tggt-surface); display: flex; align-items: center; padding: 0 clamp(28px, 5vw, 72px); }
    .tggt-hsplit-inner { max-width: 460px; }
    .tggt-eyebrow.alt { color: var(--tggt-accent); }
    .tggt-h1.alt { color: var(--tggt-ink); text-shadow: none; font-size: clamp(30px, 3.6vw, 46px); }
    .tggt-hero-meta.alt { color: var(--tggt-sub); }
    .tggt-hsplit-panel .tggt-hero-loc { color: var(--tggt-sub); }
    .tggt-hsplit-panel .tggt-hero-loc svg { color: var(--tggt-muted); }
    .tggt-hsplit-teaser { font-size: 16px; color: var(--tggt-sub); line-height: 1.7; margin: 16px 0 0; }
    .tggt-hsplit-buy { display: flex; align-items: center; gap: 18px; margin-top: 26px; flex-wrap: wrap; }
    .tggt-hsplit-price { font-size: 26px; font-weight: 800; letter-spacing: -0.5px; }
    .tggt-hsplit-price span { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; color: var(--tggt-muted); display: block; }
    .tggt-hsplit-price small { font-size: 13px; font-weight: 500; color: var(--tggt-sub); }
    @media (max-width: 820px) {
      .tggt-hero--split { grid-template-columns: 1fr; height: auto; min-height: 0; }
      .tggt-hsplit-img { min-height: 300px; }
      .tggt-hsplit-panel { padding: 32px 24px 38px; }
      .tggt-hsplit-inner { max-width: none; }
    }

    /* ── Editorial template ── */
    .tggt-editorial { max-width: 780px; padding-top: 52px; padding-bottom: 10px; }
    .tggt[data-template="editorial"] .tggt-h2 { font-size: 30px; }
    .tggt[data-template="editorial"] .tggt-prose p { font-size: 18px; line-height: 1.85; }
    .tggt[data-template="editorial"] .tggt-section { margin-bottom: 52px; }
    .tggt-band { background: var(--tggt-alt); border-top: 1px solid var(--tggt-border); border-bottom: 1px solid var(--tggt-border); }
    .tggt-band-inner { display: grid; grid-template-columns: 1fr 420px; gap: 44px; align-items: center; padding-top: 56px; padding-bottom: 56px; }
    .tggt-band-copy h2 { margin: 0 0 10px; }
    .tggt-band-copy p { font-size: 17px; color: var(--tggt-sub); margin: 0; max-width: 42ch; }
    .tggt-band-card .tggt-aside, .tggt-band-card { position: static; }
    @media (max-width: 820px) {
      .tggt-band-inner { grid-template-columns: 1fr; gap: 24px; }
    }

    /* Reveal on scroll — gated by [data-anim] so content is visible if JS or
       IntersectionObserver is unavailable (progressive enhancement). */
    .tggt[data-anim="1"] .tggt-reveal { opacity: 0; transform: translateY(26px); transition: opacity 0.7s cubic-bezier(.2,.7,.2,1), transform 0.7s cubic-bezier(.2,.7,.2,1); }
    .tggt[data-anim="1"] .tggt-reveal.in { opacity: 1; transform: none; }

    /* Honeypot — offscreen, never seen by a real visitor */
    .tggt-hp { position: absolute !important; left: -9999px !important; width: 1px; height: 1px; opacity: 0; }

    @media (max-width: 900px) {
      .tggt-body { grid-template-columns: 1fr; gap: 8px; }
      .tggt-aside { position: static; margin-top: 8px; }
      .tggt-facts, .tggt-facts[data-n] { grid-template-columns: repeat(3, 1fr); }
      .tggt-facts .tggt-fact:nth-child(4), .tggt-facts .tggt-fact:nth-child(5) { display: none; }
    }
    @media (max-width: 600px) {
      .tggt-incl { grid-template-columns: 1fr; }
      .tggt-gallery { grid-template-columns: repeat(2, 1fr); grid-auto-rows: 120px; }
      .tggt-gallery .g:first-child { grid-column: span 2; grid-row: span 1; }
      .tggt-facts-wrap { margin-top: -36px; }
      .tggt-form-row { grid-template-columns: 1fr; }
    }
    @media (prefers-reduced-motion: reduce) {
      .tggt-hero-img { animation: none; }
      .tggt-scroll-cue { animation: none; }
      .tggt-reveal { opacity: 1; transform: none; transition: none; }
    }
  `;

  // ── Widget ─────────────────────────────────────────────────────────────────
  class TGGroupTripsWidget {
    constructor(container, config) {
      this.el = container;
      container._tgInitialised = true;
      this.cfg = this._defaults(config);
      this.t = makeT(this.cfg);
      this.shadow = container.attachShadow({ mode: 'open' });
      this._timers = [];
      this._io = null;
      this._render();
    }

    _defaults(c) {
      c = c || {};
      const tour = c.tour && typeof c.tour === 'object' ? c.tour : {};
      const booking = c.booking && typeof c.booking === 'object' ? c.booking : {};
      const templates = ['classic', 'editorial', 'immersive'];
      return {
        template: templates.indexOf(c.template) !== -1 ? c.template : 'classic',
        theme: c.theme === 'dark' ? 'dark' : 'light',
        brandColor: c.brand || c.brandColor || '',
        accentColor: c.accentColor || '',
        radius: typeof c.radius === 'number' ? c.radius : 18,
        currency: c.currency || tour.currency || '',
        agencyName: c.agencyName || '',
        widgetId: c.widgetId || c._widgetId || '',
        registerEndpoint: c.registerEndpoint || (SCRIPT_BASE + 'api/trip-register'),
        booking: {
          mode: booking.mode === 'enquiry' ? 'enquiry' : 'booking',
          showSpotsLeft: booking.showSpotsLeft !== false,
          consentText: booking.consentText || 'I agree to be contacted about this trip and accept the booking terms.'
        },
        tour: tour
      };
    }

    _f(key) {
      const o = this.cfg.tour || {};
      if (o[key] != null && o[key] !== '') return o[key];
      return '';
    }

    _images() {
      const o = this.cfg.tour || {};
      let imgs = [];
      if (Array.isArray(o.gallery)) imgs = o.gallery.slice();
      const hero = this._f('heroImage');
      if (hero && imgs.indexOf(hero) === -1) imgs.unshift(hero);
      return imgs.map(safeUrl).filter(Boolean);
    }

    _departures() {
      const o = this.cfg.tour || {};
      if (!Array.isArray(o.departures)) return [];
      return o.departures
        .map(function (d) { return { date: (d && d.date) || '', label: departureLabel(d) }; })
        .filter(function (d) { return d.label; });
    }

    _derive() {
      const o = this.cfg.tour || {};
      const sym = currencySymbol(this.cfg.currency || o.currency || 'GBP');
      const imgs = this._images();
      const priceN = num(this._f('pricePerPerson'));
      const depositN = num(this._f('deposit'));
      const minPax = fnum(this._f('minPax'));
      const maxPax = fnum(this._f('maxPax'));
      const spotsTaken = Math.max(0, fnum(this._f('spotsTaken')) || 0);
      const departures = this._departures();

      const lat = fnum(this._f('mapLat')), lng = fnum(this._f('mapLng'));
      const map = (lat !== null && lng !== null && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180)
        ? { lat: lat, lng: lng, address: this._f('mapQuery'), style: this._f('mapStyle') || 'streets' }
        : (this._f('mapQuery') ? { lat: null, lng: null, address: this._f('mapQuery'), style: 'streets' } : null);

      return {
        sym: sym, images: imgs,
        title: this._f('title') || this.t('defaultTitle'),
        destination: this._f('destination'),
        summary: this._f('summary'),
        highlights: Array.isArray(o.highlights) ? o.highlights.filter(Boolean) : [],
        included: Array.isArray(o.included) ? o.included.filter(Boolean) : [],
        notIncluded: Array.isArray(o.notIncluded) ? o.notIncluded.filter(Boolean) : [],
        departures: departures,
        price: money(sym, priceN), priceN: priceN,
        deposit: money(sym, depositN), depositN: depositN,
        balanceDueDate: this._f('balanceDueDate'),
        minPax: minPax, maxPax: maxPax, spotsTaken: spotsTaken,
        video: parseVideo(this._f('videoUrl')),
        map: map,
        currency: sym
      };
    }

    _groupSizeLabel(d) {
      const t = this.t;
      if (d.maxPax && d.minPax && d.minPax > 1) return t('travellersRange', { min: d.minPax, max: d.maxPax });
      if (d.maxPax) return t('travellersUpTo', { n: d.maxPax });
      if (d.minPax && d.minPax > 1) return t('travellersFrom', { min: d.minPax });
      return '';
    }

    _facts(d) {
      const t = this.t;
      const items = [];
      if (d.destination) items.push([I.pin, t('destination'), esc(d.destination)]);
      if (d.departures.length) {
        const val = d.departures.length === 1 ? esc(d.departures[0].label) : (d.departures.length + ' ' + esc(t('dates')));
        items.push([I.calendar, t('departures'), val]);
      }
      const gs = this._groupSizeLabel(d);
      if (gs) items.push([I.users, t('groupSize'), esc(gs)]);
      if (d.deposit) items.push([I.shield, t('deposit'), esc(d.deposit) + ' <small style="font-weight:500;color:var(--tggt-muted)">pp</small>']);
      if (d.price) items.push([I.coin, t('from'), esc(d.price) + ' <small style="font-weight:500;color:var(--tggt-muted)">pp</small>']);
      return items.slice(0, 5);
    }

    _factsHtml(d) {
      const items = this._facts(d);
      if (!items.length) return '';
      const inner = items.map(function (f) {
        return '<div class="tggt-fact"><div class="tggt-fact-ic">' + f[0] + '</div>'
          + '<div class="tggt-fact-lab">' + f[1] + '</div><div class="tggt-fact-val">' + f[2] + '</div></div>';
      }).join('');
      return '<div class="tggt-wrap tggt-facts-wrap"><div class="tggt-facts" data-n="' + items.length + '">' + inner + '</div></div>';
    }

    _departureTable(d) {
      if (!d.departures.length) return '';
      const t = this.t;
      const rows = d.departures.map(function (dep) {
        return '<tr><td>' + esc(t('departures')) + '</td><td>' + esc(dep.label) + '</td></tr>';
      }).join('');
      return '<div class="tggt-section tggt-reveal"><h2 class="tggt-h2">' + esc(t('itinerary')) + '</h2><table class="tggt-table"><tbody>'
        + rows
        + (d.balanceDueDate ? '<tr><td>' + esc(t('deposit')) + '</td><td>' + esc(d.deposit) + ' ' + esc(t('depositPp')) + '</td></tr>' : '')
        + '</tbody></table></div>';
    }

    // ── Booking module (replaces the enquiry card) ──
    _bookingCard(d) {
      if (this.cfg.booking.mode === 'enquiry') return this._enquiryCard(d);
      const t = this.t;

      // Places-left progress
      let spots = '';
      if (this.cfg.booking.showSpotsLeft && d.maxPax) {
        const left = Math.max(0, d.maxPax - d.spotsTaken);
        const pct = Math.min(100, Math.round((d.spotsTaken / d.maxPax) * 100));
        const plenty = left > Math.max(3, d.maxPax * 0.25);
        spots = '<div class="tggt-spots">'
          + '<div class="tggt-spots-row"><span class="tggt-spots-left' + (plenty ? ' plenty' : '') + '">'
          + (left > 0 ? esc(t('placesLeft', { left: left, total: d.maxPax })) : esc(t('soldOut'))) + '</span></div>'
          + '<div class="tggt-spots-track"><div class="tggt-spots-fill" style="width:' + pct + '%"></div></div>'
          + '</div>';
      }

      const balance = d.balanceDueDate ? '<div class="tggt-deposit">' + I.clock + '<span>' + esc(t('balanceDue', { date: d.balanceDueDate })) + '</span></div>' : '';
      const deposit = d.deposit ? '<div class="tggt-deposit">' + I.shield + '<span>' + esc(d.deposit) + ' ' + esc(t('depositPp')) + '</span></div>' : '';

      // Party size — cap by places left where known
      const left = d.maxPax ? Math.max(1, d.maxPax - d.spotsTaken) : 8;
      const maxParty = Math.max(1, Math.min(left, 12));
      let partyOpts = '';
      for (let i = 1; i <= maxParty; i++) {
        partyOpts += '<option value="' + i + '"' + (i === 2 ? ' selected' : '') + '>' + i + ' ' + esc(i === 1 ? t('traveller') : t('travellers')) + '</option>';
      }

      // Departure select (only when there is a choice)
      let departureField = '';
      if (d.departures.length > 1) {
        const opts = d.departures.map(function (dep) { return '<option value="' + esc(dep.label) + '">' + esc(dep.label) + '</option>'; }).join('');
        departureField = '<div class="tggt-field"><label class="tggt-label">' + esc(t('chooseDeparture')) + '</label>'
          + '<select class="tggt-input" name="departure">' + opts + '</select></div>';
      } else if (d.departures.length === 1) {
        departureField = '<input type="hidden" name="departure" value="' + esc(d.departures[0].label) + '">';
      }

      const depEach = d.depositN ? '<span>' + esc(t('depositEach', { amount: d.deposit })) + '</span>' : '<span></span>';
      const payToday = d.depositN
        ? '<div class="tggt-paytoday">' + depEach + '<span>' + esc(t('payToday', { amount: '' })).replace('{amount}', '') + ' <b data-paytoday>' + esc(money(d.sym, d.depositN * 2)) + '</b></span></div>'
        : '';

      return '<div class="tggt-book">'
        + '<div class="tggt-book-top">'
          + '<div class="tggt-book-from">' + esc(t('from')) + '</div>'
          + '<div class="tggt-price-row"><div class="tggt-price">' + (d.price || esc(t('poa'))) + '</div>' + (d.price ? '<small>' + esc(t('perPerson')) + '</small>' : '') + '</div>'
          + deposit + balance + spots
        + '</div>'
        + '<form class="tggt-form" data-mode="booking" novalidate>'
          + '<div class="tggt-form-h">' + esc(t('reserveHeading')) + '</div>'
          + '<div class="tggt-field" data-req="name"><input class="tggt-input" name="name" placeholder="' + esc(t('fullName')) + '" autocomplete="name"><span class="tggt-field-err">' + esc(t('addName')) + '</span></div>'
          + '<div class="tggt-form-row">'
            + '<div class="tggt-field" data-req="email"><input class="tggt-input" name="email" type="email" placeholder="' + esc(t('email')) + '" autocomplete="email"><span class="tggt-field-err">' + esc(t('validEmail')) + '</span></div>'
            + '<div class="tggt-field"><input class="tggt-input" name="phone" type="tel" placeholder="' + esc(t('phone')) + '" autocomplete="tel"></div>'
          + '</div>'
          + '<div class="tggt-form-row">'
            + '<div class="tggt-field"><label class="tggt-label">' + esc(t('partySize')) + '</label><select class="tggt-input" name="party" data-party>' + partyOpts + '</select></div>'
            + (d.departures.length > 1 ? departureField : '<div class="tggt-field"><label class="tggt-label">' + esc(t('chooseDeparture')) + '</label><input class="tggt-input" value="' + esc(d.departures.length ? d.departures[0].label : '—') + '" disabled></div>')
          + '</div>'
          + (d.departures.length <= 1 ? departureField : '')
          + payToday
          + '<label class="tggt-consent" data-consent><input type="checkbox" name="consent"><span>' + esc(this.cfg.booking.consentText) + '</span></label>'
          + '<input class="tggt-hp" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">'
          + '<button type="submit" class="tggt-submit">' + esc(t('reserveCta')) + ' ' + I.arrow + '</button>'
          + '<p class="tggt-trust">' + I.shield + '<span>' + esc(t('trustLine')) + '</span></p>'
        + '</form>'
      + '</div>';
    }

    _enquiryCard(d) {
      const t = this.t;
      const deposit = d.deposit ? '<div class="tggt-deposit">' + I.shield + '<span>' + esc(d.deposit) + ' ' + esc(t('depositPp')) + '</span></div>' : '';
      return '<div class="tggt-book">'
        + '<div class="tggt-book-top">'
          + '<div class="tggt-book-from">' + esc(t('from')) + '</div>'
          + '<div class="tggt-price-row"><div class="tggt-price">' + (d.price || esc(t('poa'))) + '</div>' + (d.price ? '<small>' + esc(t('perPerson')) + '</small>' : '') + '</div>'
          + deposit
        + '</div>'
        + '<form class="tggt-form" data-mode="enquiry" novalidate>'
          + '<div class="tggt-form-h">' + esc(t('enquireHeading')) + '</div>'
          + '<div class="tggt-field" data-req="name"><input class="tggt-input" name="name" placeholder="' + esc(t('fullName')) + '" autocomplete="name"><span class="tggt-field-err">' + esc(t('addName')) + '</span></div>'
          + '<div class="tggt-form-row">'
            + '<div class="tggt-field" data-req="email"><input class="tggt-input" name="email" type="email" placeholder="' + esc(t('email')) + '" autocomplete="email"><span class="tggt-field-err">' + esc(t('validEmail')) + '</span></div>'
            + '<div class="tggt-field"><input class="tggt-input" name="phone" type="tel" placeholder="' + esc(t('phone')) + '" autocomplete="tel"></div>'
          + '</div>'
          + '<div class="tggt-field"><textarea class="tggt-input" name="message" placeholder="' + esc(t('messagePlaceholder')) + '"></textarea></div>'
          + '<input class="tggt-hp" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">'
          + '<button type="submit" class="tggt-submit">' + esc(t('sendEnquiry')) + '</button>'
          + '<p class="tggt-trust">' + I.shield + '<span>' + esc(t('enquiryTrust')) + '</span></p>'
        + '</form>'
      + '</div>';
    }

    _render() {
      this._timers.forEach(clearInterval); this._timers = [];
      if (this._io) { try { this._io.disconnect(); } catch (e) {} this._io = null; }

      this._window = offerWindow(this._f('showFrom'), this._f('showUntil'));
      if (!this._window.live) {
        this.shadow.innerHTML = '';
        this.el.setAttribute('data-tg-hidden', this._window.state);
        this.root = null;
        return;
      }
      this.el.removeAttribute('data-tg-hidden');
      this._renderedAt = Date.now();

      const cfg = this.cfg;
      const t = this.t;
      const d = this._derive();

      const root = document.createElement('div');
      root.className = 'tggt';
      root.setAttribute('data-theme', cfg.theme);
      if (cfg.brandColor) root.style.setProperty('--tggt-brand', cfg.brandColor);
      if (cfg.accentColor) { root.style.setProperty('--tggt-accent', cfg.accentColor); root.style.setProperty('--tggt-accent-hover', cfg.accentColor); }
      if (cfg.radius) root.style.setProperty('--tggt-radius', cfg.radius + 'px');

      const hero = d.images[0];
      const heroBg = hero ? ' style="background-image:url(' + esc(hero) + ')"' : '';
      const heroCls = hero ? '' : ' ph';

      // Highlights chips
      const highlights = d.highlights.length
        ? '<div class="tggt-tags">' + d.highlights.map(function (h) { return '<span class="tggt-tag">' + esc(h) + '</span>'; }).join('') + '</div>'
        : '';
      const descParas = String(d.summary || '').split(/\n+/).filter(Boolean)
        .map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('');
      const fAbout = (descParas || highlights)
        ? '<div class="tggt-section tggt-reveal"><h2 class="tggt-h2">' + esc(t('aboutTrip')) + '</h2>'
          + (descParas ? '<div class="tggt-prose">' + descParas + '</div>' : '')
          + (highlights ? '<div style="margin-top:16px"><div class="tggt-fact-lab" style="margin-bottom:8px">' + esc(t('highlights')) + '</div>' + highlights + '</div>' : '')
          + '</div>'
        : '';

      const fIncluded = d.included.length
        ? '<div class="tggt-section tggt-reveal"><h2 class="tggt-h2">' + esc(t('whatsIncluded')) + '</h2><ul class="tggt-incl">'
          + d.included.map(function (x) { return '<li><span class="tick">' + I.check + '</span>' + esc(x) + '</li>'; }).join('')
          + '</ul></div>'
        : '';

      const fNotIncluded = d.notIncluded.length
        ? '<div class="tggt-section tggt-reveal"><h2 class="tggt-h2">' + esc(t('whatsNotIncluded')) + '</h2><ul class="tggt-incl excl">'
          + d.notIncluded.map(function (x) { return '<li><span class="tick">' + I.dash + '</span>' + esc(x) + '</li>'; }).join('')
          + '</ul></div>'
        : '';

      const fGallery = d.images.length > 1
        ? '<div class="tggt-section tggt-reveal"><h2 class="tggt-h2">' + esc(t('photos')) + '</h2><div class="tggt-gallery" data-gallery>'
          + d.images.slice(0, 5).map(function (src, i) { return '<button type="button" class="g" data-idx="' + i + '" style="background-image:url(' + esc(src) + ')" aria-label="' + esc(t('openPhoto', { n: i + 1 })) + '"></button>'; }).join('')
          + '</div></div>'
        : '';

      const fVideo = d.video
        ? '<div class="tggt-section tggt-reveal"><h2 class="tggt-h2">' + esc(t('takeALook')) + '</h2><div class="tggt-video">' + videoEmbed(d.video) + '</div></div>'
        : '';

      const fMap = d.map
        ? '<div class="tggt-section tggt-reveal"><h2 class="tggt-h2">' + esc(t('whereYoullBe')) + '</h2>'
          + (d.map.address ? '<p class="tggt-map-addr">' + I.pin + esc(d.map.address) + '</p>' : '')
          + (d.map.lat !== null ? '<div class="tggt-map" data-map></div>' : '')
          + '</div>'
        : '';

      const fDetail = this._departureTable(d);

      const fBar = '<div class="tggt-bar" data-bar><div class="tggt-bar-inner">'
        + '<span class="tggt-bar-title">' + esc(d.title) + '</span><span class="tggt-bar-spacer"></span>'
        + (d.price ? '<span class="tggt-bar-price">' + d.price + ' <small>' + esc(t('perPerson')) + '</small></span>' : '')
        + '<button type="button" class="tggt-btn accent sm" data-book>' + esc(t('reserveNow')) + '</button>'
      + '</div></div>';

      const starsStr = '';
      const fHero = '<div class="tggt-hero">'
        + '<div class="tggt-hero-img' + heroCls + '"' + heroBg + '></div>'
        + '<div class="tggt-hero-inner"><div>'
          + '<div class="tggt-badges"><span class="tggt-badge accent">' + I.users + ' Group departure</span></div>'
          + '<h1 class="tggt-h1">' + esc(d.title) + '</h1>'
          + '<div class="tggt-hero-meta">'
            + (d.destination ? '<span class="tggt-hero-loc">' + I.pin + esc(d.destination) + '</span>' : '') + starsStr
          + '</div>'
        + '</div></div>'
        + '<div class="tggt-scroll-cue">' + I.chevDown + '</div>'
      + '</div>';

      const fHeroSplit = '<div class="tggt-hero tggt-hero--split">'
        + '<div class="tggt-hsplit-img' + heroCls + '"' + heroBg + '></div>'
        + '<div class="tggt-hsplit-panel"><div class="tggt-hsplit-inner">'
          + '<div class="tggt-badges"><span class="tggt-badge glass light">' + I.users + ' Group departure</span></div>'
          + '<h1 class="tggt-h1 alt">' + esc(d.title) + '</h1>'
          + '<div class="tggt-hero-meta alt">'
            + (d.destination ? '<span class="tggt-hero-loc">' + I.pin + esc(d.destination) + '</span>' : '')
          + '</div>'
          + (d.summary ? '<p class="tggt-hsplit-teaser">' + esc(String(d.summary).split(/\n+/)[0]) + '</p>' : '')
          + '<div class="tggt-hsplit-buy">'
            + (d.price ? '<div class="tggt-hsplit-price"><span>' + esc(t('from')) + '</span> ' + d.price + ' <small>' + esc(t('perPerson')) + '</small></div>' : '')
            + '<button type="button" class="tggt-btn accent" data-book>' + esc(t('reserveNow')) + ' ' + I.arrow + '</button>'
          + '</div>'
        + '</div></div>'
      + '</div>';

      const fFacts = this._factsHtml(d);

      const fCta = '<div class="tggt-cta-band"><div class="tggt-cta-inner">'
        + '<div><h3>' + esc(t('readyWhenYouAre')) + '</h3><p>' + esc(t('ctaCopy')) + '</p></div>'
        + '<span class="tggt-cta-spacer"></span>'
        + '<button type="button" class="tggt-btn primary" data-book>' + esc(t('reserveNow')) + ' ' + I.arrow + '</button>'
      + '</div></div>';

      const fFooter = '<div class="tggt-foot"><div class="tggt-foot-inner">'
        + (this.cfg.agencyName ? '<span class="tggt-foot-trust">' + I.shield + esc(this.cfg.agencyName) + '</span>' : '')
        + '<span class="tggt-bar-spacer"></span><span>' + esc(t('poweredBy')) + '</span>'
      + '</div></div>';

      const fLightbox = '<div class="tggt-lb" data-lb role="dialog" aria-modal="true" aria-label="' + esc(t('photos')) + '">'
        + '<button type="button" class="tggt-lb-btn close" data-lb-close aria-label="' + esc(t('closePhoto')) + '">' + I.x + '</button>'
        + '<button type="button" class="tggt-lb-btn prev" data-lb-prev aria-label="' + esc(t('prevPhoto')) + '">' + I.chevDown + '</button>'
        + '<img class="tggt-lb-img" data-lb-img alt="">'
        + '<button type="button" class="tggt-lb-btn next" data-lb-next aria-label="' + esc(t('nextPhoto')) + '">' + I.chevDown + '</button></div>';

      const mainCol = fAbout + fIncluded + fNotIncluded + fVideo + fGallery + fMap + fDetail;

      let html;
      if (cfg.template === 'editorial') {
        html = fBar + fHero + fFacts
          + '<div class="tggt-wrap tggt-editorial">' + fAbout + fIncluded + fNotIncluded + fGallery + fVideo + fMap + fDetail + '</div>'
          + '<div class="tggt-band"><div class="tggt-wrap tggt-band-inner">'
            + '<div class="tggt-band-copy"><h2 class="tggt-h2">' + esc(t('likeTheLook')) + '</h2><p>' + esc(t('bandCopy')) + '</p></div>'
            + '<div class="tggt-band-card">' + this._bookingCard(d) + '</div>'
          + '</div></div>'
          + fCta + fFooter + fLightbox;
      } else if (cfg.template === 'immersive') {
        html = fBar + fHeroSplit + fFacts
          + '<div class="tggt-wrap"><div class="tggt-body">'
            + '<div class="tggt-main">' + mainCol + '</div>'
            + '<aside class="tggt-aside">' + this._bookingCard(d) + '</aside>'
          + '</div></div>'
          + fCta + fFooter + fLightbox;
      } else {
        html = fBar + fHero + fFacts
          + '<div class="tggt-wrap"><div class="tggt-body">'
            + '<div class="tggt-main">' + mainCol + '</div>'
            + '<aside class="tggt-aside">' + this._bookingCard(d) + '</aside>'
          + '</div></div>'
          + fCta + fFooter + fLightbox;
      }

      root.setAttribute('data-template', cfg.template);
      root.innerHTML = html;

      this.shadow.innerHTML = '<style>' + STYLES + '</style>';
      this.shadow.appendChild(root);
      this.root = root;
      this._bind(d);
    }

    _bind(d) {
      const root = this.root;

      const hero = root.querySelector('.tggt-hero');
      const bar = root.querySelector('[data-bar]');
      const onScroll = function () {
        const past = hero.getBoundingClientRect().bottom < 80;
        bar.classList.toggle('show', past);
      };
      window.addEventListener('scroll', onScroll, { passive: true });
      this._onScroll = onScroll;
      onScroll();

      const reveals = root.querySelectorAll('.tggt-reveal');
      const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if ('IntersectionObserver' in window && !reduce) {
        root.setAttribute('data-anim', '1');
        this._io = new IntersectionObserver(function (entries) {
          entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('in'); } });
        }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
        reveals.forEach((el) => this._io.observe(el));
      }

      const form = root.querySelector('.tggt-form');
      root.querySelectorAll('[data-book]').forEach((b) => b.addEventListener('click', function () {
        const aside = root.querySelector('.tggt-aside, .tggt-band-card');
        (aside || form).scrollIntoView({ behavior: 'smooth', block: 'start' });
        const first = form && form.querySelector('input[name="name"]');
        if (first) setTimeout(function () { first.focus(); }, 420);
      }));

      // Live "pay today" total as the party size changes
      if (form && d.depositN) {
        const party = form.querySelector('[data-party]');
        const payEl = form.querySelector('[data-paytoday]');
        if (party && payEl) {
          const upd = () => { payEl.textContent = money(d.sym, d.depositN * clampInt(party.value, 1, 99)); };
          party.addEventListener('change', upd);
          upd();
        }
      }

      this._initLightbox(d);
      this._mountMap(d);

      if (form) form.addEventListener('submit', (e) => { e.preventDefault(); this._submit(form, d); });
    }

    _mountMap(d) {
      if (!d.map || d.map.lat === null) return;
      const holder = this.root.querySelector('[data-map]');
      if (!holder) return;
      const accent = this.cfg.accentColor || '#0891B2';
      const mapCfg = {
        mapStyle: d.map.style || 'streets', zoom: 11, autoFit: false,
        center: { lat: d.map.lat, lng: d.map.lng }, height: 360,
        accent: accent, theme: this.cfg.theme, showList: 'never',
        scrollWheel: false, directionsButton: true, showInfoCard: false,
        locations: [{ title: d.title, address: d.map.address || d.destination, lat: d.map.lat, lng: d.map.lng, color: accent }]
      };
      const mount = function (W) {
        try { const div = document.createElement('div'); holder.innerHTML = ''; holder.appendChild(div); new W(div, mapCfg); }
        catch (e) { /* leave the address text as the fallback */ }
      };
      if (window.TGMapsWidget) { mount(window.TGMapsWidget); return; }
      ensureMaps().then(function () { if (window.TGMapsWidget) mount(window.TGMapsWidget); })
        .catch(function () { holder.classList.add('tggt-map-failed'); });
    }

    _initLightbox(d) {
      const root = this.root;
      const shadow = this.shadow;
      const t = this.t;
      const title = d.title || '';
      const lb = root.querySelector('[data-lb]');
      const img = root.querySelector('[data-lb-img]');
      const gallery = root.querySelector('[data-gallery]');
      if (!lb || !gallery) return;
      const closeBtn = root.querySelector('[data-lb-close]');
      const prevBtn = root.querySelector('[data-lb-prev]');
      const nextBtn = root.querySelector('[data-lb-next]');
      const imgs = d.images;
      let idx = 0;
      let lastFocus = null;
      const show = function (i) {
        idx = (i + imgs.length) % imgs.length;
        img.src = imgs[idx];
        img.alt = t('photoAlt', { title: title, n: idx + 1, total: imgs.length });
      };
      const open = function (i, trigger) { lastFocus = trigger || null; show(i); lb.classList.add('open'); closeBtn.focus(); };
      const close = function () { lb.classList.remove('open'); img.src = ''; if (lastFocus) { try { lastFocus.focus(); } catch (e) {} lastFocus = null; } };
      gallery.querySelectorAll('.g').forEach((g) => g.addEventListener('click', function () { open(parseInt(g.dataset.idx, 10) || 0, g); }));
      closeBtn.addEventListener('click', close);
      prevBtn.addEventListener('click', function () { show(idx - 1); });
      nextBtn.addEventListener('click', function () { show(idx + 1); });
      lb.addEventListener('click', function (e) { if (e.target === lb) close(); });
      const onKey = function (e) {
        if (!lb.classList.contains('open')) return;
        if (e.key === 'Escape') { close(); }
        else if (e.key === 'ArrowLeft') { show(idx - 1); }
        else if (e.key === 'ArrowRight') { show(idx + 1); }
        else if (e.key === 'Tab') {
          const order = [closeBtn, prevBtn, nextBtn];
          let pos = order.indexOf(shadow.activeElement);
          if (pos === -1) pos = 0;
          const to = e.shiftKey ? (pos + order.length - 1) % order.length : (pos + 1) % order.length;
          e.preventDefault(); order[to].focus();
        }
      };
      window.addEventListener('keydown', onKey);
      this._onKey = onKey;
      prevBtn.style.transform = 'translateY(-50%) rotate(90deg)';
      nextBtn.style.transform = 'translateY(-50%) rotate(-90deg)';
    }

    _submit(form, d) {
      const mode = form.getAttribute('data-mode');
      let ok = true;
      form.querySelectorAll('.tggt-field').forEach(function (f) { f.classList.remove('bad'); });
      const consentWrap = form.querySelector('[data-consent]');
      if (consentWrap) consentWrap.classList.remove('bad');
      const nameF = form.querySelector('[data-req="name"]');
      const emailF = form.querySelector('[data-req="email"]');
      if (!form.name.value.trim()) { nameF.classList.add('bad'); ok = false; }
      if (!isEmail(form.email.value)) { emailF.classList.add('bad'); ok = false; }
      if (mode === 'booking' && consentWrap && form.consent && !form.consent.checked) { consentWrap.classList.add('bad'); ok = false; }
      if (!ok) {
        const bad = form.querySelector('.tggt-field.bad input');
        if (bad) bad.focus();
        return;
      }

      const first = form.name.value.trim().split(' ')[0];
      if (mode === 'enquiry') {
        const detail = {
          tourTitle: d.title,
          enquiry: {
            name: form.name.value.trim(), email: form.email.value.trim(),
            phone: form.phone.value.trim(), message: form.message.value.trim()
          }
        };
        this.el.dispatchEvent(new CustomEvent('tg-group-enquiry', { bubbles: true, composed: true, detail: detail }));
        this._success(form, this.t('enquirySent'), this.t('thanksName', { name: first }));
        return;
      }

      // Booking mode — capture the registration. The deposit checkout redirect
      // is wired to /api/trip-checkout in a later ticket; here we only capture.
      const party = clampInt((form.party && form.party.value) || 1, 1, 99);
      const departure = (form.departure && form.departure.value) || (d.departures[0] && d.departures[0].label) || '';
      const depositTotal = money(d.sym, d.depositN * party);
      const detail = {
        widgetId: this.cfg.widgetId,
        tourTitle: d.title,
        registration: {
          name: form.name.value.trim(), email: form.email.value.trim(), phone: form.phone.value.trim(),
          partySize: party, departure: departure, consent: !!(form.consent && form.consent.checked)
        }
      };
      this.el.dispatchEvent(new CustomEvent('tg-group-register', { bubbles: true, composed: true, detail: detail }));

      const nTravellers = party + ' ' + (party === 1 ? this.t('traveller') : this.t('travellers'));
      this._success(form, this.t('reservedHeading'),
        this.t('reservedBody', { name: first, n: nTravellers, departure: departure || d.title, amount: depositTotal }));
    }

    _success(form, heading, body) {
      form.outerHTML =
        '<div class="tggt-book-success"><div class="tick">' + I.check + '</div>'
        + '<h4>' + esc(heading) + '</h4><p>' + esc(body) + '</p></div>';
    }

    update(config) {
      this.destroy();
      this.cfg = this._defaults(Object.assign({}, this.cfg, config));
      this.t = makeT(this.cfg);
      this._render();
    }

    destroy() {
      this._timers.forEach(clearInterval); this._timers = [];
      if (this._io) { try { this._io.disconnect(); } catch (e) {} this._io = null; }
      if (this._onScroll) window.removeEventListener('scroll', this._onScroll);
      if (this._onKey) window.removeEventListener('keydown', this._onKey);
    }
  }

  // ── Auto-init ───────────────────────────────────────────────────────────────
  async function loadConfigFromApi(widgetId) {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 10000) : null;
    try {
      const res = await fetch(API_BASE + '?id=' + encodeURIComponent(widgetId), ctrl ? { signal: ctrl.signal } : undefined);
      if (!res.ok) throw new Error('Config load failed: ' + res.status);
      const data = await res.json();
      if (data && data.config) return Object.assign({}, data.config, { _widgetId: widgetId });
      throw new Error('No config returned');
    } catch (err) { console.error('[TGGroupTrips] Config load error:', err); return null; }
    finally { if (timer) clearTimeout(timer); }
  }

  function renderPlaceholder(el, message, onRetry) {
    const tt = makeT();
    const box = document.createElement('div');
    box.setAttribute('role', 'status');
    box.setAttribute('aria-live', 'polite');
    box.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;min-height:220px;padding:32px 20px;box-sizing:border-box;font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#475569;text-align:center;';
    const p = document.createElement('p');
    p.style.cssText = 'margin:0;';
    p.textContent = message;
    box.appendChild(p);
    if (typeof onRetry === 'function') {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = tt('retry');
      btn.style.cssText = 'appearance:none;border:1px solid #cbd5e1;background:#fff;color:#0f172a;border-radius:10px;padding:9px 18px;font:inherit;font-weight:600;cursor:pointer;';
      btn.addEventListener('click', function () { btn.disabled = true; onRetry(); });
      box.appendChild(btn);
    }
    el.innerHTML = '';
    el.appendChild(box);
  }

  async function mountRemote(el, widgetId) {
    const tt = makeT();
    renderPlaceholder(el, tt('loading'));
    const config = await loadConfigFromApi(widgetId);
    if (!config) {
      renderPlaceholder(el, tt('loadError'), function () { mountRemote(el, widgetId); });
      return;
    }
    el.innerHTML = '';
    new TGGroupTripsWidget(el, config);
  }

  function init() {
    const containers = document.querySelectorAll('[data-tg-widget="group-trips"]');
    for (const el of containers) {
      if (el._tgInitialised || el.shadowRoot) continue;
      el._tgInitialised = true;
      const inline = el.getAttribute('data-tg-config');
      const widgetId = el.getAttribute('data-tg-id');
      if (widgetId && !inline) { mountRemote(el, widgetId); continue; }
      let config = {};
      if (inline) {
        try { config = JSON.parse(inline); } catch (e) { console.error('[TGGroupTrips] Invalid inline config:', e); continue; }
      }
      new TGGroupTripsWidget(el, config);
    }
  }

  if (typeof window !== 'undefined') {
    window.TGGroupTripsWidget = TGGroupTripsWidget;
    window.TGGroupTripsWidget.version = VERSION;
    window.__TG_GROUP_TRIPS_VERSION__ = VERSION;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }
})();
