/**
 * Travelgenix Inspirator Widget v1.0.0
 * Swipe-to-discover holiday ideas for customers who do not know where yet.
 * Zero dependencies. Shadow DOM isolation. Works on any website via a single script tag.
 *
 * Usage:
 *   <div data-tg-widget="inspirator" data-tg-id="YOUR_WIDGET_ID"></div>
 *   <script src="https://tg-widgets.vercel.app/widget-inspirator.js" defer></script>
 *
 * What it is for
 *   A visitor who cannot answer "where do you want to go?" can usually answer
 *   "do you like the look of this?". They swipe a deck of real destinations,
 *   keep the ones they like, and the widget hands the agent a shortlist with
 *   the taste behind it. The agent opens a lead that already says "beach,
 *   luxury, honeymoons: Santorini, Grace Bay, Positano" instead of an email
 *   address and a blank box.
 *
 * What it deliberately does NOT do
 *   It never shows a price and never triggers a search. Offers are cache-only
 *   (30 Jul 2026) and a swipe deck cannot make a live Travelify search per
 *   card. The shortlist goes to a human, who quotes it. The reward at the end
 *   is the shortlist and the taste read, not points, badges or a prize — a
 *   visitor does not return to a travel agency's site to keep a streak, and
 *   the Spin Wheel widget already covers prize mechanics.
 *
 * Data
 *   Cards are dealt from a pool served by /api/destination-deck, drawn live
 *   from the Travelgenix destination content base. Only live records that carry
 *   a hero photo are ever dealt: a swipe card is a photograph with a name on
 *   it. Nothing is snapshotted into the widget config.
 *
 * Interaction
 *   Drag with a pointer, or use the Pass and Save buttons, or the arrow keys.
 *   The buttons are the primary control and the drag is the flourish, not the
 *   other way round: a deck that can only be swiped is unusable with a keyboard
 *   and invisible to a screen reader. Every deal is announced on a live region,
 *   and prefers-reduced-motion drops the animation without changing behaviour.
 */
(function () {
  'use strict';

  const VERSION = '1.0.0';

  // ---- API base -----------------------------------------------------------
  // The script runs on customer sites, so a relative /api path would resolve
  // against THEIR origin. Always resolve against our own script's origin.
  function resolveOrigin() {
    if (typeof window === 'undefined') return '';
    if (window.__TG_WIDGET_API__) {
      try { return new URL(window.__TG_WIDGET_API__, location.href).origin; }
      catch (e) { /* fall through */ }
    }
    try {
      const me = document.currentScript;
      if (me && me.src) return new URL(me.src).origin;
      const scripts = document.getElementsByTagName('script');
      for (let i = scripts.length - 1; i >= 0; i--) {
        const s = scripts[i].src || '';
        if (/\/widget-inspirator\.js(\?|$|#)/.test(s)) return new URL(s).origin;
      }
    } catch (e) { /* fall through */ }
    return '';
  }

  const ORIGIN = resolveOrigin();
  const CONFIG_API = ORIGIN + '/api/widget-config';
  const DECK_API = ORIGIN + '/api/destination-deck';
  const LEAD_API = ORIGIN + '/api/inspirator-lead';

  // ---- Defaults -----------------------------------------------------------
  const DEFAULTS = {
    headline: 'Not sure where to go?',
    intro: 'Swipe through a few ideas and keep the ones you like. We will turn your shortlist into a proper suggestion.',
    startLabel: 'Start swiping',

    levels: ['resort'],
    tags: [],
    deckSize: 12,

    showTagline: true,
    showTags: true,
    showBestMonths: true,
    showFlightTime: true,

    resultHeadline: 'Here is your shortlist',
    resultBody: 'Send it over and we will come back with somewhere that fits.',
    sendLabel: 'Send my shortlist',
    collectPhone: false,
    messageLabel: 'Anything else we should know?',
    showMessage: true,
    marketingOptIn: true,
    marketingLabel: 'Email me holiday ideas now and then',
    privacyUrl: '',
    successMessage: 'Thanks. Your shortlist is with us and we will be in touch shortly.',

    theme: 'light',
    brandColour: '#1B2B5B',
    accentColour: '#00B4D8',
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  };

  // ---- Helpers ------------------------------------------------------------
  function esc(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function safeUrl(url, allowMailtoTel) {
    if (typeof url !== 'string') return '';
    const t = url.trim();
    if (!t) return '';
    if (/^https?:\/\//i.test(t)) return t;
    if (allowMailtoTel && /^(mailto:|tel:)/i.test(t)) return t;
    if (/^\/[^/]/.test(t) || t === '/') return t;   // site-relative, not protocol-relative
    if (/^[#?]/.test(t)) return t;
    return '';
  }

  function safeColour(c, fallback) {
    if (typeof c !== 'string') return fallback;
    const t = c.trim();
    return /^#[0-9a-f]{3}$|^#[0-9a-f]{6}$/i.test(t) ? t : fallback;
  }

  // The font stack is written into the root element's style attribute, so it is
  // a CSS injection point. Stripping angle brackets is not enough: a semicolon
  // ends the declaration and lets the next one through, so a value like
  // "Arial; background:url(https://evil.test/x.png)" would beacon every
  // visitor's IP to a third party from the agency's own page. (Found in the
  // Top 10 pre-deploy review, 4 Sep 2026.)
  function safeFont(f, fallback) {
    if (typeof f !== 'string') return fallback;
    const t = f.trim();
    if (!t || t.length > 200) return fallback;
    return /^[A-Za-z0-9 ,'"._-]+$/.test(t) ? t : fallback;
  }

  function hexToRgb(hex) {
    let h = String(hex || '').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h, 16);
    if (!Number.isFinite(n)) return '27,43,91';
    return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
  }

  function clampInt(v, min, max, fallback) {
    const n = parseInt(v, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function isEmail(v) {
    return typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
  }

  // Fisher-Yates. The pool arrives in Airtable's own order and is edge-cached,
  // so the shuffle is what makes two visitors see a different deck.
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /**
   * Read a taste profile off the kept cards: the tags that came up most often.
   * Ties break towards the tag seen on the earliest-kept card, so the answer is
   * stable for a given set of swipes rather than reshuffling on a redraw.
   */
  function tasteFrom(cards) {
    const counts = new Map();
    const firstSeen = new Map();
    cards.forEach((c, idx) => {
      (Array.isArray(c.tags) ? c.tags : []).forEach(t => {
        counts.set(t, (counts.get(t) || 0) + 1);
        if (!firstSeen.has(t)) firstSeen.set(t, idx);
      });
    });
    return Array.from(counts.entries())
      .sort((a, b) => (b[1] - a[1]) || (firstSeen.get(a[0]) - firstSeen.get(b[0])))
      .slice(0, 3)
      .map(e => e[0]);
  }

  // "Beach, Luxury and Honeymoons" — an Oxford comma would be against house style.
  function joinWords(list) {
    const a = list.filter(Boolean);
    if (!a.length) return '';
    if (a.length === 1) return a[0];
    return a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
  }

  // ---- Icons --------------------------------------------------------------
  const IC = {
    heart: '<path d="M20.8 5.6a5.5 5.5 0 0 0-7.8 0L12 6.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 22l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/>',
    cross: '<path d="M18 6 6 18M6 6l12 12"/>',
    undo: '<path d="M3 7v6h6"/><path d="M3.5 13a9 9 0 1 0 2.1-5.7L3 10"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    compass: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
    spark: '<path d="M12 3l1.9 4.7L18.6 9.6l-4.7 1.9L12 16.2l-1.9-4.7L5.4 9.6l4.7-1.9z"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
  };

  function icon(name, cls) {
    const p = IC[name];
    if (!p) return '';
    return '<svg class="' + (cls || '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
      + 'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>';
  }

  // ---- Styles -------------------------------------------------------------
  const STYLES = `
    :host { all: initial; display: block; }
    *, *::before, *::after { box-sizing: border-box; }

    .tgi-root {
      --tgi-brand: #1B2B5B;
      --tgi-accent: #00B4D8;
      --tgi-brand-rgb: 27,43,91;
      --tgi-accent-rgb: 0,180,216;
      --tgi-yes: #0E9F6E;
      --tgi-no: #E4573D;

      --tgi-bg: #FFFFFF;
      --tgi-card: #F8FAFC;
      --tgi-text: #0F172A;
      --tgi-sub: #475569;
      --tgi-muted: #64748B;
      --tgi-faint: #94A3B8;
      --tgi-border: #E2E8F0;
      --tgi-border-soft: #F1F5F9;
      --tgi-brand-ink: var(--tgi-brand);
      --tgi-on-brand: #FFFFFF;

      --tgi-radius: 20px;
      --tgi-radius-sm: 12px;
      --tgi-shadow-card: 0 18px 40px -16px rgba(var(--tgi-brand-rgb),0.35), 0 2px 8px rgba(15,23,42,0.06);
      --tgi-shadow-sm: 0 1px 2px rgba(15,23,42,0.05), 0 1px 3px rgba(var(--tgi-brand-rgb),0.06);

      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 15px;
      line-height: 1.5;
      color: var(--tgi-text);
      background: var(--tgi-bg);
      max-width: 520px;
      margin: 0 auto;
      container-type: inline-size;
      container-name: tgi;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }

    .tgi-root[data-theme="dark"] {
      --tgi-bg: #0B1220;
      --tgi-card: #131C2E;
      --tgi-text: #F1F5F9;
      --tgi-sub: #CBD5E1;
      --tgi-muted: #94A3B8;
      --tgi-faint: #64748B;
      --tgi-border: #1E293B;
      --tgi-border-soft: #172033;
      --tgi-brand-ink: var(--tgi-accent);
    }

    /* ---- Shared type ---- */
    .tgi-h {
      margin: 0;
      font-size: 25px;
      line-height: 1.2;
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .tgi-p { margin: 10px 0 0; color: var(--tgi-sub); font-size: 15px; line-height: 1.6; }

    /* ---- Panels (intro, result, form, sent) ---- */
    .tgi-panel {
      border: 1px solid var(--tgi-border);
      border-radius: var(--tgi-radius);
      padding: 26px 24px;
      background: var(--tgi-bg);
    }
    .tgi-panel-ico {
      width: 42px; height: 42px;
      border-radius: 12px;
      display: inline-flex; align-items: center; justify-content: center;
      background: rgba(var(--tgi-accent-rgb), 0.12);
      color: var(--tgi-brand-ink);
      margin: 0 0 14px;
    }
    .tgi-panel-ico svg { width: 22px; height: 22px; }

    /* ---- Buttons ---- */
    .tgi-btn {
      display: inline-flex; align-items: center; justify-content: center; gap: 8px;
      padding: 12px 22px;
      border: 1px solid transparent;
      border-radius: 999px;
      background: var(--tgi-brand);
      color: var(--tgi-on-brand);
      font: inherit; font-size: 15px; font-weight: 600;
      cursor: pointer;
      text-decoration: none;
      transition: filter .18s ease, transform .18s ease;
    }
    .tgi-btn:hover { filter: brightness(1.12); transform: translateY(-1px); }
    .tgi-btn:focus-visible { outline: 2px solid var(--tgi-accent); outline-offset: 3px; }
    .tgi-btn[disabled] { opacity: .55; cursor: default; transform: none; filter: none; }
    .tgi-btn--ghost {
      background: transparent;
      color: var(--tgi-sub);
      border-color: var(--tgi-border);
    }
    .tgi-btn--ghost:hover { background: var(--tgi-card); filter: none; }
    .tgi-btn svg { width: 17px; height: 17px; }

    /* ---- The deck ---- */
    .tgi-deck { position: relative; }
    .tgi-progress {
      display: flex; align-items: center; justify-content: space-between;
      gap: 12px; margin: 0 0 12px;
      font-size: 12.5px; font-weight: 550; color: var(--tgi-muted);
    }
    .tgi-bar { flex: 1; height: 4px; border-radius: 999px; background: var(--tgi-border); overflow: hidden; }
    .tgi-bar span {
      display: block; height: 100%;
      background: var(--tgi-accent);
      border-radius: 999px;
      transition: width .3s ease;
    }
    .tgi-kept { white-space: nowrap; }

    .tgi-stack {
      position: relative;
      aspect-ratio: 3 / 4;
      max-height: 560px;
      touch-action: pan-y;
      user-select: none;
      -webkit-user-select: none;
    }

    .tgi-card {
      position: absolute;
      inset: 0;
      border-radius: var(--tgi-radius);
      overflow: hidden;
      background: var(--tgi-card);
      box-shadow: var(--tgi-shadow-card);
      will-change: transform;
      cursor: grab;
    }
    .tgi-card:active { cursor: grabbing; }
    /* The two cards behind the top one are decoration only. */
    .tgi-card[data-depth="1"] { transform: translateY(10px) scale(.955); filter: brightness(.97); }
    .tgi-card[data-depth="2"] { transform: translateY(20px) scale(.91); filter: brightness(.94); }
    .tgi-card[data-depth="1"], .tgi-card[data-depth="2"] { pointer-events: none; }

    .tgi-card img {
      position: absolute; inset: 0;
      width: 100%; height: 100%;
      object-fit: cover;
      display: block;
      pointer-events: none;
    }
    .tgi-scrim {
      position: absolute; inset: 0;
      background: linear-gradient(to top,
        rgba(6,10,20,0.92) 0%,
        rgba(6,10,20,0.72) 26%,
        rgba(6,10,20,0.16) 56%,
        rgba(6,10,20,0.04) 100%);
      pointer-events: none;
    }
    .tgi-card-body {
      position: absolute;
      left: 0; right: 0; bottom: 0;
      padding: 20px 20px 22px;
      color: #FFFFFF;
      pointer-events: none;
    }
    .tgi-eyebrow {
      margin: 0 0 5px;
      font-size: 11.5px; font-weight: 650;
      letter-spacing: 0.09em; text-transform: uppercase;
      color: rgba(255,255,255,0.82);
    }
    .tgi-name {
      margin: 0;
      font-size: 27px; line-height: 1.15; font-weight: 700;
      letter-spacing: -0.02em;
      text-shadow: 0 1px 12px rgba(0,0,0,0.4);
    }
    .tgi-tagline {
      margin: 8px 0 0;
      font-size: 14.5px; line-height: 1.5;
      color: rgba(255,255,255,0.92);
    }
    .tgi-facts { display: flex; flex-wrap: wrap; gap: 6px 16px; margin: 12px 0 0; }
    .tgi-fact {
      display: inline-flex; align-items: center; gap: 5px;
      font-size: 12.5px; font-weight: 550;
      color: rgba(255,255,255,0.9);
      white-space: nowrap;
    }
    .tgi-fact svg { width: 13px; height: 13px; }
    .tgi-chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0 0; padding: 0; list-style: none; }
    .tgi-chip {
      font-size: 11.5px; font-weight: 600;
      padding: 3px 10px;
      border-radius: 999px;
      color: #FFFFFF;
      background: rgba(255,255,255,0.16);
      border: 1px solid rgba(255,255,255,0.26);
      backdrop-filter: blur(6px);
      white-space: nowrap;
    }

    /* Drag verdict stamps */
    .tgi-stamp {
      position: absolute;
      top: 22px;
      padding: 7px 16px;
      border-radius: 10px;
      border: 3px solid currentColor;
      font-size: 15px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase;
      opacity: 0;
      pointer-events: none;
      transition: opacity .12s linear;
    }
    .tgi-stamp--yes { left: 20px; color: #34D399; transform: rotate(-11deg); }
    .tgi-stamp--no { right: 20px; color: #FCA5A5; transform: rotate(11deg); }

    /* ---- Deck controls ---- */
    .tgi-controls {
      display: flex; align-items: center; justify-content: center; gap: 14px;
      margin: 18px 0 0;
    }
    .tgi-round {
      width: 60px; height: 60px;
      border-radius: 50%;
      border: 1px solid var(--tgi-border);
      background: var(--tgi-bg);
      color: var(--tgi-text);
      cursor: pointer;
      display: inline-flex; align-items: center; justify-content: center;
      box-shadow: var(--tgi-shadow-sm);
      transition: transform .16s ease, border-color .16s ease, color .16s ease;
    }
    .tgi-round svg { width: 25px; height: 25px; }
    .tgi-round:hover:not([disabled]) { transform: translateY(-2px); }
    .tgi-round:focus-visible { outline: 2px solid var(--tgi-accent); outline-offset: 3px; }
    .tgi-round[disabled] { opacity: .4; cursor: default; }
    .tgi-round--no:hover:not([disabled]) { color: var(--tgi-no); border-color: var(--tgi-no); }
    .tgi-round--yes:hover:not([disabled]) { color: var(--tgi-yes); border-color: var(--tgi-yes); }
    .tgi-round--sm { width: 44px; height: 44px; }
    .tgi-round--sm svg { width: 18px; height: 18px; }

    .tgi-hint {
      margin: 12px 0 0;
      text-align: center;
      font-size: 12px;
      color: var(--tgi-faint);
    }

    /* ---- Result ---- */
    .tgi-taste {
      margin: 16px 0 0;
      padding: 16px 18px;
      border-radius: var(--tgi-radius-sm);
      background: var(--tgi-card);
      border: 1px solid var(--tgi-border);
    }
    .tgi-taste-label {
      margin: 0 0 8px;
      font-size: 11.5px; font-weight: 650;
      letter-spacing: 0.08em; text-transform: uppercase;
      color: var(--tgi-brand-ink);
    }
    .tgi-taste-chips { display: flex; flex-wrap: wrap; gap: 6px; padding: 0; margin: 0; list-style: none; }
    .tgi-taste-chip {
      font-size: 12.5px; font-weight: 600;
      padding: 4px 11px;
      border-radius: 999px;
      color: var(--tgi-brand-ink);
      background: rgba(var(--tgi-accent-rgb), 0.12);
      border: 1px solid rgba(var(--tgi-accent-rgb), 0.26);
    }
    .tgi-taste-line { margin: 10px 0 0; font-size: 13.5px; color: var(--tgi-sub); }

    .tgi-shortlist { list-style: none; margin: 16px 0 0; padding: 0; }
    .tgi-item {
      display: flex; align-items: center; gap: 12px;
      padding: 9px 0;
      border-top: 1px solid var(--tgi-border-soft);
    }
    .tgi-item:first-child { border-top: 1px solid var(--tgi-border); }
    .tgi-item:last-child { border-bottom: 1px solid var(--tgi-border); }
    .tgi-thumb {
      width: 52px; height: 40px; flex: none;
      border-radius: 8px; object-fit: cover; display: block;
      background: var(--tgi-card);
    }
    .tgi-item-body { min-width: 0; flex: 1; }
    .tgi-item-name { font-size: 14.5px; font-weight: 600; }
    .tgi-item-meta { font-size: 12px; color: var(--tgi-muted); }
    .tgi-drop {
      flex: none; border: 0; background: none; cursor: pointer;
      color: var(--tgi-faint); padding: 6px;
      border-radius: 6px;
      display: inline-flex;
    }
    .tgi-drop svg { width: 15px; height: 15px; }
    .tgi-drop:hover { color: var(--tgi-no); }
    .tgi-drop:focus-visible { outline: 2px solid var(--tgi-accent); outline-offset: 1px; }

    .tgi-actions { display: flex; flex-wrap: wrap; gap: 10px; margin: 20px 0 0; }

    /* ---- Form ---- */
    .tgi-field { margin: 14px 0 0; }
    .tgi-label { display: block; font-size: 13px; font-weight: 600; margin: 0 0 5px; }
    .tgi-input, .tgi-textarea {
      width: 100%;
      padding: 11px 13px;
      font: inherit; font-size: 15px;
      color: var(--tgi-text);
      background: var(--tgi-bg);
      border: 1px solid var(--tgi-border);
      border-radius: 10px;
    }
    .tgi-textarea { min-height: 82px; resize: vertical; }
    .tgi-input:focus, .tgi-textarea:focus {
      outline: none;
      border-color: var(--tgi-accent);
      box-shadow: 0 0 0 3px rgba(var(--tgi-accent-rgb), 0.18);
    }
    .tgi-check { display: flex; align-items: flex-start; gap: 9px; margin: 14px 0 0; font-size: 13.5px; color: var(--tgi-sub); }
    .tgi-check input { margin-top: 3px; width: 16px; height: 16px; accent-color: var(--tgi-brand); flex: none; }
    .tgi-legal { margin: 12px 0 0; font-size: 11.5px; color: var(--tgi-faint); }
    .tgi-legal a { color: inherit; }
    .tgi-err {
      margin: 12px 0 0;
      padding: 10px 12px;
      border-radius: 8px;
      font-size: 13.5px;
      color: #B42318;
      background: rgba(228,87,61,0.10);
      border: 1px solid rgba(228,87,61,0.28);
    }
    .tgi-root[data-theme="dark"] .tgi-err { color: #FCA5A5; }

    /* ---- Credit + states ---- */
    .tgi-credit { margin: 12px 0 0; font-size: 11px; color: var(--tgi-faint); text-align: center; }
    .tgi-state {
      padding: 30px 22px;
      text-align: center;
      color: var(--tgi-muted);
      font-size: 14px;
      border: 1px dashed var(--tgi-border);
      border-radius: var(--tgi-radius);
    }
    .tgi-sk {
      aspect-ratio: 3 / 4; max-height: 560px;
      border-radius: var(--tgi-radius);
      background: var(--tgi-card);
    }
    .tgi-pulse { animation: tgi-pulse 1.5s ease-in-out infinite; }
    @keyframes tgi-pulse { 0%,100% { opacity: 1 } 50% { opacity: .55 } }

    .tgi-sr {
      position: absolute; width: 1px; height: 1px;
      padding: 0; margin: -1px; overflow: hidden;
      clip: rect(0 0 0 0); white-space: nowrap; border: 0;
    }

    /* ---- Container breakpoints (widget width, not viewport) ---- */
    @container tgi (max-width: 379px) {
      .tgi-h { font-size: 21px; }
      .tgi-name { font-size: 22px; }
      .tgi-panel { padding: 20px 18px; }
      .tgi-card-body { padding: 16px 16px 18px; }
      .tgi-round { width: 52px; height: 52px; }
      .tgi-round svg { width: 22px; height: 22px; }
      .tgi-round--sm { width: 40px; height: 40px; }
    }

    @media (prefers-reduced-motion: reduce) {
      .tgi-btn, .tgi-round, .tgi-bar span { transition: none; }
      .tgi-btn:hover, .tgi-round:hover:not([disabled]) { transform: none; }
      .tgi-pulse { animation: none; }
    }
  `;

  // ---- Widget -------------------------------------------------------------
  class TGInspiratorWidget {
    constructor(container, config) {
      if (!container) throw new Error('TGInspiratorWidget: container required');
      this.el = container;
      this.cfg = Object.assign({}, DEFAULTS, config || {});

      this.phase = 'loading';   // loading | intro | deck | result | form | sent | empty | error
      this.deck = [];           // cards not yet dealt (top of deck is index 0)
      this.kept = [];
      this.history = [];        // { card, verdict } for undo
      this.seen = 0;
      this.dealt = 0;
      this.sending = false;
      this.formError = '';
      this.destroyed = false;
      this.drag = null;

      this.shadow = container.shadowRoot || container.attachShadow({ mode: 'open' });
      container.setAttribute('data-tg-initialised', '1');

      // Pre-supplied cards (the editor preview and the demo use this door, so
      // neither needs a saved widget id or a network round trip).
      if (Array.isArray(this.cfg.__cards)) {
        this._setPool(this.cfg.__cards);
        this.phase = this.deck.length ? 'intro' : 'empty';
        this._render();
      } else {
        this._render();
        this._loadDeck();
      }
    }

    // ---- Data ----
    _deckUrl() {
      if (this.cfg.widgetId) return DECK_API + '?id=' + encodeURIComponent(this.cfg.widgetId);
      const levels = Array.isArray(this.cfg.levels) ? this.cfg.levels.join(',') : 'resort';
      const tags = Array.isArray(this.cfg.tags) ? this.cfg.tags.join(',') : '';
      return DECK_API + '?levels=' + encodeURIComponent(levels)
        + (tags ? '&tags=' + encodeURIComponent(tags) : '');
    }

    _setPool(cards) {
      const size = clampInt(this.cfg.deckSize, 4, 30, 12);
      // A card is a photograph with a name on it, so both are required. The
      // image is tested through the SAME allowlist that render uses, not merely
      // for truthiness: a card whose url is rejected at render would otherwise
      // be dealt and shown as a blank rectangle. The deck endpoint drops these
      // server-side too, but __cards arrives straight from the editor and the
      // demo, so the widget cannot rely on that.
      const usable = (Array.isArray(cards) ? cards : [])
        .filter(c => c && c.name && safeUrl(c.image));
      // Keep the whole pool so "Start again" can reshuffle from everything the
      // API sent, not just the dozen already dealt.
      this._pool = usable;
      this.deck = shuffle(usable).slice(0, size);
      this.total = this.deck.length;
    }

    async _loadDeck() {
      // A 9s abort budget, matching the rest of the content family. Without it
      // a hung upstream leaves the visitor on the loading skeleton forever
      // instead of reaching the error state. Guarded by test:timeout-guards.
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), 9000) : null;
      try {
        const res = await fetch(this._deckUrl(),
          Object.assign({ credentials: 'omit' }, ctrl ? { signal: ctrl.signal } : {}));
        if (!res.ok) throw new Error('Deck fetch failed (' + res.status + ')');
        const data = await res.json();
        if (this.destroyed) return;
        this._setPool(data && data.cards);
        this.phase = this.deck.length ? 'intro' : 'empty';
      } catch (err) {
        if (this.destroyed) return;
        console.error('[TG Inspirator] ' + (err && err.message ? err.message : err));
        this.phase = 'error';
      } finally {
        if (timer) clearTimeout(timer);
      }
      this._render();
    }

    // ---- Phase transitions ----
    _go(phase) {
      this.phase = phase;
      this._render();
    }

    _start() {
      this.kept = [];
      this.history = [];
      this.seen = 0;
      this._go('deck');
      this._preloadNext();
    }

    _restart() {
      this._setPool(this._pool || []);
      if (!this.deck.length) { this.phase = 'empty'; this._render(); return; }
      this._start();
    }

    /**
     * Commit a verdict on the top card.
     * `verdict` is 'yes' or 'no'. This is the only place the deck advances.
     */
    _decide(verdict) {
      const card = this.deck[0];
      if (!card || this.phase !== 'deck') return;
      this.deck = this.deck.slice(1);
      this.seen++;
      this.history.push({ card, verdict });
      if (verdict === 'yes') this.kept = this.kept.concat([card]);

      this._announce((verdict === 'yes' ? 'Saved ' : 'Passed on ') + card.name
        + '. ' + this.seen + ' of ' + this.total + '.');

      if (!this.deck.length) {
        this._go('result');
        return;
      }
      this._paintDeck();
      this._preloadNext();
    }

    _undo() {
      if (!this.history.length || this.phase !== 'deck') return;
      const last = this.history.pop();
      this.deck = [last.card].concat(this.deck);
      this.seen = Math.max(0, this.seen - 1);
      if (last.verdict === 'yes') {
        const i = this.kept.lastIndexOf(last.card);
        if (i >= 0) this.kept = this.kept.slice(0, i).concat(this.kept.slice(i + 1));
      }
      this._announce('Undone. ' + last.card.name + ' is back.');
      this._paintDeck();
    }

    _drop(recordId) {
      this.kept = this.kept.filter(c => c.recordId !== recordId);
      this._render();
    }

    // ---- Rendering ----
    // Rendering must be side-effect-free for the host page: the editor preview
    // calls update() on every keystroke. Nothing here calls focus(), select()
    // or scrollIntoView(), and there is no autofocus anywhere.
    _render() {
      const c = this.cfg;
      const brand = safeColour(c.brandColour, DEFAULTS.brandColour);
      const accent = safeColour(c.accentColour, DEFAULTS.accentColour);
      const theme = c.theme === 'dark' ? 'dark' : 'light';
      const font = safeFont(c.fontFamily, DEFAULTS.fontFamily);

      const styleVars = [
        '--tgi-brand:' + brand,
        '--tgi-accent:' + accent,
        '--tgi-brand-rgb:' + hexToRgb(brand),
        '--tgi-accent-rgb:' + hexToRgb(accent),
        'font-family:' + font,
      ].join(';');

      let body;
      switch (this.phase) {
        case 'loading': body = '<div class="tgi-sk tgi-pulse" aria-hidden="true"></div>'; break;
        case 'intro': body = this._intro(); break;
        case 'deck': body = this._deckView(); break;
        case 'result': body = this._result(); break;
        case 'form': body = this._form(); break;
        case 'sent': body = this._sent(); break;
        case 'empty': body = '<div class="tgi-state">There are no ideas to show here just yet.</div>'; break;
        default: body = '<div class="tgi-state">This is unavailable right now. Please try again shortly.</div>';
      }

      this.shadow.innerHTML =
        '<style>' + STYLES + '</style>'
        + '<div class="tgi-root" data-theme="' + theme + '" style="' + esc(styleVars) + '">'
        + body
        + '<p class="tgi-sr" role="status" aria-live="polite" id="tgi-live"></p>'
        + '</div>';

      this._bind();
    }

    _intro() {
      return '<section class="tgi-panel">'
        + '<span class="tgi-panel-ico">' + icon('spark') + '</span>'
        + '<h2 class="tgi-h">' + esc(this.cfg.headline) + '</h2>'
        + '<p class="tgi-p">' + esc(this.cfg.intro) + '</p>'
        + '<div class="tgi-actions">'
        + '<button type="button" class="tgi-btn" data-act="start">' + esc(this.cfg.startLabel) + '</button>'
        + '</div>'
        + '<p class="tgi-hint">' + this.total + ' ideas. Takes about a minute.</p>'
        + '</section>';
    }

    _deckView() {
      const pct = this.total ? Math.round((this.seen / this.total) * 100) : 0;
      return '<div class="tgi-deck">'
        + '<div class="tgi-progress">'
        + '<span>' + Math.min(this.seen + 1, this.total) + ' of ' + this.total + '</span>'
        + '<span class="tgi-bar"><span style="width:' + pct + '%"></span></span>'
        + '<span class="tgi-kept">' + this.kept.length + ' saved</span>'
        + '</div>'
        + '<div class="tgi-stack" id="tgi-stack">' + this._cards() + '</div>'
        + '<div class="tgi-controls">'
        + '<button type="button" class="tgi-round tgi-round--no" data-act="no" aria-label="Not for me">' + icon('cross') + '</button>'
        + '<button type="button" class="tgi-round tgi-round--sm" data-act="undo" aria-label="Undo the last one"'
        + (this.history.length ? '' : ' disabled') + '>' + icon('undo') + '</button>'
        + '<button type="button" class="tgi-round tgi-round--yes" data-act="yes" aria-label="Save this one">' + icon('heart') + '</button>'
        + '</div>'
        + '<p class="tgi-hint">Drag the card, use the buttons, or press the left and right arrow keys.</p>'
        + '<div class="tgi-actions" style="justify-content:center">'
        + '<button type="button" class="tgi-btn tgi-btn--ghost" data-act="finish">'
        + (this.kept.length ? 'Done, show my shortlist' : 'Skip to the end') + '</button>'
        + '</div>'
        + '</div>';
    }

    // Only ever three cards in the DOM: the live one and two for depth.
    _cards() {
      return this.deck.slice(0, 3).map((card, i) => {
        const facts = [];
        if (this.cfg.showBestMonths && card.bestMonths) {
          facts.push('<span class="tgi-fact">' + icon('sun') + esc(card.bestMonths) + '</span>');
        }
        if (this.cfg.showFlightTime && card.flightTime) {
          facts.push('<span class="tgi-fact">' + icon('clock') + esc(card.flightTime) + ' from the UK</span>');
        }
        const chips = (this.cfg.showTags && Array.isArray(card.tags) && card.tags.length)
          ? '<ul class="tgi-chips">' + card.tags.slice(0, 3)
            .map(t => '<li class="tgi-chip">' + esc(t) + '</li>').join('') + '</ul>'
          : '';

        // Only the top card is exposed to assistive tech; the two behind it are
        // decoration, and announcing three destinations at once would be noise.
        const hidden = i === 0 ? '' : ' aria-hidden="true"';
        return '<article class="tgi-card" data-depth="' + i + '"' + hidden
          + (i === 0 ? ' data-top="1"' : '') + '>'
          + '<img src="' + esc(safeUrl(card.image)) + '" alt="" decoding="async"'
          + (i === 0 ? '' : ' loading="lazy"') + ' referrerpolicy="no-referrer">'
          + '<div class="tgi-scrim"></div>'
          + '<span class="tgi-stamp tgi-stamp--yes" data-stamp="yes">Save</span>'
          + '<span class="tgi-stamp tgi-stamp--no" data-stamp="no">Pass</span>'
          + '<div class="tgi-card-body">'
          + (card.region ? '<p class="tgi-eyebrow">' + esc(card.region) + '</p>' : '')
          + '<h3 class="tgi-name">' + esc(card.name) + '</h3>'
          + (this.cfg.showTagline && card.tagline ? '<p class="tgi-tagline">' + esc(card.tagline) + '</p>' : '')
          + (facts.length ? '<div class="tgi-facts">' + facts.join('') + '</div>' : '')
          + chips
          + '</div></article>';
      }).join('');
    }

    _result() {
      const taste = tasteFrom(this.kept);
      const none = !this.kept.length;

      const list = this.kept.map(card =>
        '<li class="tgi-item">'
        + '<img class="tgi-thumb" src="' + esc(safeUrl(card.image)) + '" alt="" loading="lazy" referrerpolicy="no-referrer">'
        + '<span class="tgi-item-body">'
        + '<span class="tgi-item-name">' + esc(card.name) + '</span>'
        + (card.region ? '<span class="tgi-item-meta">' + esc(card.region) + '</span>' : '')
        + '</span>'
        + '<button type="button" class="tgi-drop" data-drop="' + esc(card.recordId) + '" '
        + 'aria-label="Remove ' + esc(card.name) + ' from the shortlist">' + icon('cross') + '</button>'
        + '</li>').join('');

      const tasteBlock = taste.length
        ? '<div class="tgi-taste">'
          + '<p class="tgi-taste-label">What you leaned towards</p>'
          + '<ul class="tgi-taste-chips">' + taste.map(t => '<li class="tgi-taste-chip">' + esc(t) + '</li>').join('') + '</ul>'
          + '<p class="tgi-taste-line">Most of what you kept is about ' + esc(joinWords(taste).toLowerCase()) + '.</p>'
          + '</div>'
        : '';

      return '<section class="tgi-panel">'
        + '<span class="tgi-panel-ico">' + icon('heart') + '</span>'
        + '<h2 class="tgi-h">' + esc(none ? 'Nothing caught your eye' : this.cfg.resultHeadline) + '</h2>'
        + '<p class="tgi-p">' + esc(none
          ? 'That is useful too. Start again for a fresh set, or tell us what you had in mind and we will work from that.'
          : this.cfg.resultBody) + '</p>'
        + tasteBlock
        + (none ? '' : '<ul class="tgi-shortlist">' + list + '</ul>')
        + '<div class="tgi-actions">'
        + (none ? '' : '<button type="button" class="tgi-btn" data-act="toform">' + esc(this.cfg.sendLabel) + '</button>')
        + '<button type="button" class="tgi-btn tgi-btn--ghost" data-act="restart">Start again</button>'
        + '</div>'
        + this._credit(this.kept)
        + '</section>';
    }

    _form() {
      const taste = tasteFrom(this.kept);
      return '<section class="tgi-panel">'
        + '<h2 class="tgi-h">Where shall we send it?</h2>'
        + '<p class="tgi-p">' + this.kept.length + ' '
        + (this.kept.length === 1 ? 'destination' : 'destinations')
        + (taste.length ? ', leaning towards ' + esc(joinWords(taste).toLowerCase()) : '') + '.</p>'
        + '<form novalidate>'
        + '<div class="tgi-field"><label class="tgi-label" for="tgi-name">Your name</label>'
        + '<input class="tgi-input" type="text" id="tgi-name" name="name" maxlength="80" autocomplete="name"></div>'
        + '<div class="tgi-field"><label class="tgi-label" for="tgi-email">Email address</label>'
        + '<input class="tgi-input" type="email" id="tgi-email" name="email" maxlength="254" autocomplete="email" required></div>'
        + (this.cfg.collectPhone
          ? '<div class="tgi-field"><label class="tgi-label" for="tgi-phone">Phone (optional)</label>'
            + '<input class="tgi-input" type="tel" id="tgi-phone" name="phone" maxlength="30" autocomplete="tel"></div>'
          : '')
        + (this.cfg.showMessage
          ? '<div class="tgi-field"><label class="tgi-label" for="tgi-msg">' + esc(this.cfg.messageLabel) + '</label>'
            + '<textarea class="tgi-textarea" id="tgi-msg" name="message" maxlength="1000"></textarea></div>'
          : '')
        // Honeypot. Hidden from sight and from assistive tech, so only a bot fills it.
        + '<div class="tgi-sr" aria-hidden="true">'
        + '<label for="tgi-website">Leave this empty</label>'
        + '<input type="text" id="tgi-website" name="website" tabindex="-1" autocomplete="off"></div>'
        + (this.cfg.marketingOptIn
          ? '<label class="tgi-check"><input type="checkbox" id="tgi-mkt">'
            + '<span>' + esc(this.cfg.marketingLabel) + '</span></label>'
          : '')
        + (this.formError ? '<p class="tgi-err" role="alert">' + esc(this.formError) + '</p>' : '')
        + '<div class="tgi-actions">'
        + '<button type="submit" class="tgi-btn" data-act="send"' + (this.sending ? ' disabled' : '') + '>'
        + (this.sending ? 'Sending…' : esc(this.cfg.sendLabel)) + '</button>'
        + '<button type="button" class="tgi-btn tgi-btn--ghost" data-act="back">Back</button>'
        + '</div>'
        + this._legal()
        + '</form></section>';
    }

    _legal() {
      const url = safeUrl(this.cfg.privacyUrl);
      if (!url) return '';
      return '<p class="tgi-legal">We will only use your details to answer this enquiry. '
        + '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">Privacy policy</a>.</p>';
    }

    _sent() {
      return '<section class="tgi-panel">'
        + '<span class="tgi-panel-ico">' + icon('check') + '</span>'
        + '<h2 class="tgi-h">Shortlist sent</h2>'
        + '<p class="tgi-p">' + esc(this.cfg.successMessage) + '</p>'
        + '</section>';
    }

    _credit(cards) {
      const names = [];
      for (const c of cards) {
        if (c.attribution && names.indexOf(c.attribution) < 0) names.push(c.attribution);
      }
      if (!names.length) return '';
      return '<p class="tgi-credit">Photography: ' + esc(names.slice(0, 10).join(', ')) + '</p>';
    }

    _announce(msg) {
      const live = this.shadow.getElementById && this.shadow.getElementById('tgi-live');
      if (live) live.textContent = msg;
    }

    // Repaint only the stack, the progress line and the undo button, so the
    // control buttons keep DOM identity and the keyboard focus stays on the
    // button the visitor is repeatedly pressing.
    _paintDeck() {
      const root = this.shadow.querySelector('.tgi-deck');
      if (!root) { this._render(); return; }
      const stack = root.querySelector('#tgi-stack');
      if (stack) stack.innerHTML = this._cards();
      const prog = root.querySelector('.tgi-progress');
      if (prog) {
        const pct = this.total ? Math.round((this.seen / this.total) * 100) : 0;
        const spans = prog.children;
        if (spans[0]) spans[0].textContent = Math.min(this.seen + 1, this.total) + ' of ' + this.total;
        const fill = spans[1] && spans[1].firstElementChild;
        if (fill) fill.style.width = pct + '%';
        if (spans[2]) spans[2].textContent = this.kept.length + ' saved';
      }
      const undo = root.querySelector('[data-act="undo"]');
      if (undo) undo.disabled = !this.history.length;
      const finish = root.querySelector('[data-act="finish"]');
      if (finish) finish.textContent = this.kept.length ? 'Done, show my shortlist' : 'Skip to the end';
      this.drag = null;
    }

    // Warm the next card's photo so a swipe does not reveal a blank rectangle.
    _preloadNext() {
      try {
        const next = this.deck[1];
        if (!next || !next.image || typeof Image === 'undefined') return;
        const img = new Image();
        img.referrerPolicy = 'no-referrer';
        img.src = safeUrl(next.image);
      } catch (e) { /* preloading is a nicety, never a failure */ }
    }

    // ---- Events ----
    _bind() {
      const root = this.shadow.querySelector('.tgi-root');
      if (!root) return;

      root.addEventListener('click', (e) => {
        const drop = e.target.closest && e.target.closest('[data-drop]');
        if (drop) { this._drop(drop.getAttribute('data-drop')); return; }

        const btn = e.target.closest && e.target.closest('[data-act]');
        if (!btn) return;
        const act = btn.getAttribute('data-act');
        if (act === 'start') this._start();
        else if (act === 'yes') this._flyOut('yes');
        else if (act === 'no') this._flyOut('no');
        else if (act === 'undo') this._undo();
        else if (act === 'finish') this._go('result');
        else if (act === 'toform') { this.formError = ''; this._go('form'); }
        else if (act === 'back') this._go('result');
        else if (act === 'restart') this._restart();
      });

      const form = root.querySelector('form');
      if (form) form.addEventListener('submit', (e) => { e.preventDefault(); this._send(); });

      if (this.phase === 'deck') {
        this._bindDrag(root);
        // Arrow keys are scoped to the widget, never the document, so the
        // widget cannot hijack arrow keys on the agency's own page.
        root.addEventListener('keydown', (e) => {
          if (e.key === 'ArrowLeft') { e.preventDefault(); this._flyOut('no'); }
          else if (e.key === 'ArrowRight') { e.preventDefault(); this._flyOut('yes'); }
          else if (e.key === 'ArrowDown' || e.key === 'Backspace') { e.preventDefault(); this._undo(); }
        });
      }
    }

    /** Animate the top card away, then commit. Respects reduced motion. */
    _flyOut(verdict) {
      if (this.phase !== 'deck' || !this.deck.length) return;
      const card = this.shadow.querySelector('.tgi-card[data-top="1"]');
      const reduce = typeof matchMedia === 'function'
        && matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (!card || reduce) { this._decide(verdict); return; }

      const dir = verdict === 'yes' ? 1 : -1;
      card.style.transition = 'transform .32s cubic-bezier(.3,.1,.3,1), opacity .32s linear';
      card.style.transform = 'translateX(' + (dir * 120) + '%) rotate(' + (dir * 18) + 'deg)';
      card.style.opacity = '0';
      const stamp = card.querySelector('[data-stamp="' + verdict + '"]');
      if (stamp) stamp.style.opacity = '1';
      setTimeout(() => { if (!this.destroyed) this._decide(verdict); }, 300);
    }

    _bindDrag(root) {
      const stack = root.querySelector('#tgi-stack');
      if (!stack || typeof PointerEvent === 'undefined') return;

      const threshold = 90;

      stack.addEventListener('pointerdown', (e) => {
        const card = e.target.closest && e.target.closest('.tgi-card[data-top="1"]');
        if (!card || this.phase !== 'deck') return;
        this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, card, moved: false };
        try { card.setPointerCapture(e.pointerId); } catch (err) { /* not fatal */ }
      });

      stack.addEventListener('pointermove', (e) => {
        const d = this.drag;
        if (!d || d.id !== e.pointerId) return;
        const dx = e.clientX - d.x;
        const dy = e.clientY - d.y;
        if (!d.moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
        d.moved = true;
        d.dx = dx;
        d.card.style.transition = 'none';
        d.card.style.transform = 'translate(' + dx + 'px,' + (dy * 0.25) + 'px) rotate(' + (dx / 18) + 'deg)';
        const yes = d.card.querySelector('[data-stamp="yes"]');
        const no = d.card.querySelector('[data-stamp="no"]');
        const p = Math.min(1, Math.abs(dx) / threshold);
        if (yes) yes.style.opacity = dx > 0 ? String(p) : '0';
        if (no) no.style.opacity = dx < 0 ? String(p) : '0';
      });

      const end = (e) => {
        const d = this.drag;
        if (!d || d.id !== e.pointerId) return;
        this.drag = null;
        const dx = d.dx || 0;
        if (Math.abs(dx) >= threshold) {
          this._flyOut(dx > 0 ? 'yes' : 'no');
          return;
        }
        // Below the threshold: spring back, and commit nothing.
        d.card.style.transition = 'transform .26s cubic-bezier(.2,.8,.3,1)';
        d.card.style.transform = '';
        const yes = d.card.querySelector('[data-stamp="yes"]');
        const no = d.card.querySelector('[data-stamp="no"]');
        if (yes) yes.style.opacity = '0';
        if (no) no.style.opacity = '0';
      };
      stack.addEventListener('pointerup', end);
      stack.addEventListener('pointercancel', end);
    }

    // ---- Submit ----
    async _send() {
      if (this.sending) return;
      const root = this.shadow.querySelector('.tgi-root');
      if (!root) return;

      const val = id => {
        const el = root.querySelector('#' + id);
        return el ? String(el.value || '').trim() : '';
      };
      const email = val('tgi-email');
      if (!isEmail(email)) {
        this.formError = 'Please enter a valid email address.';
        this._render();
        return;
      }
      // A filled honeypot is a bot. Show the success screen and send nothing.
      if (val('tgi-website')) { this._go('sent'); return; }

      // No widget id means this is the demo page or an editor preview that has
      // not been saved yet. There is no client to route the lead to, so say so
      // plainly rather than posting and surfacing "Invalid widget ID" to
      // someone who is only looking.
      if (!this.cfg.widgetId) {
        this.formError = 'This is a preview, so nothing was sent. On a live page this reaches your inbox.';
        this._render();
        return;
      }

      const mkt = root.querySelector('#tgi-mkt');
      const taste = tasteFrom(this.kept);

      this.sending = true;
      this.formError = '';
      this._render();

      const payload = {
        widgetId: this.cfg.widgetId || '',
        email,
        name: val('tgi-name'),
        phone: this.cfg.collectPhone ? val('tgi-phone') : '',
        message: this.cfg.showMessage ? val('tgi-msg') : '',
        shortlist: this.kept.map(c => c.name).slice(0, 10),
        interests: taste,
        travelType: joinWords(taste),
        seen: this.seen,
        passed: this.seen - this.kept.length,
        marketingConsent: !!(mkt && mkt.checked),
        sourceUrl: (typeof location !== 'undefined' && location.href) || '',
        referrer: (typeof document !== 'undefined' && document.referrer) || '',
      };

      try {
        const res = await fetch(LEAD_API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'omit',
          body: JSON.stringify(payload),
        });
        if (this.destroyed) return;
        if (!res.ok) {
          let msg = 'Something went wrong. Please try again.';
          try {
            const d = await res.json();
            if (d && typeof d.error === 'string') msg = d.error;
          } catch (e) { /* keep the generic message */ }
          throw new Error(msg);
        }
        this.sending = false;
        this._go('sent');
      } catch (err) {
        if (this.destroyed) return;
        this.sending = false;
        this.formError = (err && err.message) || 'Something went wrong. Please try again.';
        this._render();
      }
    }

    // ---- Public API ----
    update(newConfig) {
      const prev = this.cfg;
      this.cfg = Object.assign({}, this.cfg, newConfig || {});

      if (Array.isArray(this.cfg.__cards)) {
        // The editor drives the preview through __cards. Only reset the deck
        // when the CARDS changed; a colour tweak must not throw away the
        // agent's place in the preview.
        if (this.cfg.__cards !== prev.__cards) {
          this._setPool(this.cfg.__cards);
          this.phase = this.deck.length ? 'intro' : 'empty';
          this.kept = [];
          this.history = [];
          this.seen = 0;
        }
        this._render();
        return;
      }

      // Only go back to the network when the SOURCE of the deck changed.
      // Styling and copy changes must never refetch: the editor calls this on
      // every keystroke.
      const srcChanged = prev.widgetId !== this.cfg.widgetId
        || String(prev.levels) !== String(this.cfg.levels)
        || String(prev.tags) !== String(this.cfg.tags);
      if (srcChanged) {
        this.phase = 'loading';
        this._render();
        this._loadDeck();
      } else {
        this._render();
      }
    }

    destroy() {
      this.destroyed = true;
      try { this.shadow.innerHTML = ''; } catch (e) { /* noop */ }
      try { this.el.removeAttribute('data-tg-initialised'); } catch (e) { /* noop */ }
    }
  }

  // ---- Auto-init ----------------------------------------------------------
  async function init() {
    const containers = document.querySelectorAll('[data-tg-widget="inspirator"]:not([data-tg-initialised])');
    for (const el of containers) {
      try {
        const inline = el.getAttribute('data-tg-config');
        if (inline) {
          let cfg = {};
          try { cfg = JSON.parse(inline); } catch { cfg = {}; }
          el.__tgInspirator = new TGInspiratorWidget(el, cfg);
          continue;
        }

        const id = el.getAttribute('data-tg-id');
        if (id) {
          const res = await fetch(CONFIG_API + '?id=' + encodeURIComponent(id), { credentials: 'omit' });
          if (!res.ok) throw new Error('Widget config fetch failed (' + res.status + ')');
          const data = await res.json();
          const cfg = (data && (data.config || data)) || {};
          cfg.widgetId = id;
          el.__tgInspirator = new TGInspiratorWidget(el, cfg);
          continue;
        }

        console.warn('[TG Inspirator] Container has neither data-tg-id nor data-tg-config');
      } catch (err) {
        console.error('[TG Inspirator] Failed to initialise:', err);
      }
    }
  }

  window.TGInspiratorWidget = TGInspiratorWidget;
  window.__TG_INSPIRATOR_VERSION__ = VERSION;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
