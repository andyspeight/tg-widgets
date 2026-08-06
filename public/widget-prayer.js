/**
 * Travelgenix Prayer Times Widget v1.0.0
 * Self-contained, embeddable Islamic prayer times widget.
 * Zero dependencies. Shadow DOM isolation. Works on any website via a single script tag.
 *
 * Daily prayer times for any location, always current, powered by the Aladhan
 * API (free, no key, CORS-enabled). Built for Travelgenix clients selling Umrah,
 * Hajj and halal-friendly travel.
 *
 * Fetch strategy (v1): the widget calls Aladhan directly from the browser and
 * caches the day's response in localStorage, keyed by location + method + school
 * + date, so repeat pageviews make zero API calls. On a fetch failure it renders
 * the last cached day with a subtle "times may be outdated" note; if there is no
 * cache it hides silently.
 *
 * Times parsed from the `timings` string values (local "HH:MM"), never the ISO
 * variants (Aladhan has occasionally shipped ISO timestamps with wrong date
 * components). All "now" comparisons run in the location's own timezone, so the
 * next-prayer countdown is correct even when the visitor is elsewhere.
 *
 * Usage (remote config, default):
 *   <div data-tg-widget="prayer" data-tg-id="YOUR_WIDGET_ID"></div>
 *   <script src="https://tg-widgets.vercel.app/widget-prayer.js"></script>
 *
 * Usage (inline config, editor preview):
 *   <div data-tg-widget="prayer" data-tg-config='{...}'></div>
 *   <script src="https://tg-widgets.vercel.app/widget-prayer.js"></script>
 */
(function () {
  'use strict';

  /**
   * Resolve the widget-config API base URL.
   *
   * The script is hosted on widgets.travelify.io and embedded on customer sites.
   * A relative '/api/...' resolves to the CUSTOMER origin and 404s, so we anchor
   * to the script's own origin. Resolution order:
   *   1. window.__TG_WIDGET_API__ — explicit opt-in for advanced embeds
   *   2. Origin of document.currentScript at module-init time
   *   3. Scan script tags for the widget filename (handles async/defer)
   *   4. Relative URL — last resort, only works on same-origin pages
   */
  function resolveApiBase() {
    if (typeof window === 'undefined') return '/api/widget-config';
    if (window.__TG_WIDGET_API__) return window.__TG_WIDGET_API__;
    try {
      const me = document.currentScript;
      if (me && me.src) return new URL(me.src).origin + '/api/widget-config';
      const scripts = document.getElementsByTagName('script');
      for (let i = scripts.length - 1; i >= 0; i--) {
        const s = scripts[i].src || '';
        if (/\/widget\-prayer\.js(\?|$|#)/.test(s)) {
          return new URL(s).origin + '/api/widget-config';
        }
      }
    } catch (e) { /* fall through */ }
    return '/api/widget-config';
  }

  const API_BASE = resolveApiBase();
  const ALADHAN_BASE = 'https://api.aladhan.com/v1';
  const VERSION = '1.0.0';
  const STORE_PREFIX = 'tgpt_';           // storage keys are prefixed + JSON-encoded
  const FETCH_TIMEOUT = 9000;

  /* ------------------------------------------------------------------
   * Aladhan constants — the whitelists the widget will accept. Anything
   * off these lists is clamped to a safe default before it reaches a URL,
   * so a tampered config can never inject arbitrary query values.
   * ------------------------------------------------------------------ */
  // Calculation method IDs Aladhan recognises (0-23 plus 99 custom).
  const VALID_METHODS = [0,1,2,3,4,5,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,99];
  const VALID_SCHOOLS = [0, 1];               // 0 Shafi, 1 Hanafi
  const VALID_LAT_ADJ = [0, 1, 2, 3];         // 0 none, 1 middle of night, 2 one-seventh, 3 angle based

  // The five daily prayers plus Sunrise (a marker, optional). Order matters —
  // it is the day's timeline and drives "next prayer" detection.
  const PRAYER_ROWS = [
    { key: 'Fajr',    label: 'Fajr',    icon: 'fajr',    prayer: true },
    { key: 'Sunrise', label: 'Sunrise', icon: 'sunrise', prayer: false },
    { key: 'Dhuhr',   label: 'Dhuhr',   icon: 'sun',     prayer: true },
    { key: 'Asr',     label: 'Asr',     icon: 'asr',     prayer: true },
    { key: 'Maghrib', label: 'Maghrib', icon: 'maghrib', prayer: true },
    { key: 'Isha',    label: 'Isha',    icon: 'isha',    prayer: true },
  ];

  /* ------------------------------------------------------------------
   * Icon library — inline SVG path strings (no external deps).
   * ------------------------------------------------------------------ */
  const IC = {
    fajr:    '<path d="M17 18a5 5 0 0 0-10 0"/><line x1="12" y1="9" x2="12" y2="2"/><line x1="4.22" y1="10.22" x2="5.64" y2="11.64"/><line x1="1" y1="18" x2="3" y2="18"/><line x1="21" y1="18" x2="23" y2="18"/><line x1="18.36" y1="11.64" x2="19.78" y2="10.22"/><line x1="23" y1="22" x2="1" y2="22"/><polyline points="8 6 12 2 16 6"/>',
    sunrise: '<path d="M12 2v6"/><path d="m4.93 10.93 1.41 1.41"/><path d="M2 18h2"/><path d="M20 18h2"/><path d="m19.07 10.93-1.41 1.41"/><path d="M22 22H2"/><path d="m8 6 4-4 4 4"/><path d="M16 18a4 4 0 0 0-8 0"/>',
    sun:     '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
    asr:     '<path d="M12 2v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="M20 12h2"/><path d="m19.07 4.93-1.41 1.41"/><path d="M15.947 12.65a4 4 0 0 0-5.925-4.128"/><path d="M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6Z"/>',
    maghrib: '<path d="M12 10V2"/><path d="m4.93 10.93 1.41 1.41"/><path d="M2 18h2"/><path d="M20 18h2"/><path d="m19.07 10.93-1.41 1.41"/><path d="M22 22H2"/><path d="m16 6-4 4-4-4"/><path d="M16 18a4 4 0 0 0-8 0"/>',
    isha:    '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    pin:     '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
    clock:   '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    moon:    '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    alert:   '<path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    info:    '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  };

  function icon(name, size) {
    const path = IC[name] || IC.clock;
    const s = size || 16;
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + s + '" height="' + s +
           '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"' +
           ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + path + '</svg>';
  }

  /* ------------------------------------------------------------------
   * Safety helpers.
   * ------------------------------------------------------------------ */
  function esc(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function clampInt(v, lo, hi, fallback) {
    const n = parseInt(v, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(lo, Math.min(hi, n));
  }

  function ensureFont(family) {
    if (!family || family === 'Inter' || typeof document === 'undefined') return;
    const id = 'tg-font-' + String(family).toLowerCase().replace(/\s+/g, '-');
    if (document.getElementById(id)) return;
    const l = document.createElement('link');
    l.id = id;
    l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=' + encodeURIComponent(family).replace(/%20/g, '+') + ':wght@400;500;600;700&display=swap';
    document.head.appendChild(l);
  }

  // hex → rgba for soft-tint derivations
  function hexToRgba(hex, alpha) {
    if (typeof hex !== 'string') return 'rgba(0,0,0,' + alpha + ')';
    let h = hex.replace('#', '').trim();
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    if (h.length !== 6 || !/^[0-9a-f]{6}$/i.test(h)) return 'rgba(0,0,0,' + alpha + ')';
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  // Darken a hex colour by `amt` (0..1). Used for the hero gradient's far stop
  // so we avoid CSS color-mix(), which some older customer browsers drop —
  // taking the whole gradient (and the hero's background) with it.
  function darken(hex, amt) {
    if (typeof hex !== 'string') return hex;
    let h = hex.replace('#', '').trim();
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    if (h.length !== 6 || !/^[0-9a-f]{6}$/i.test(h)) return hex;
    const f = (i) => {
      const v = Math.max(0, Math.round(parseInt(h.slice(i, i + 2), 16) * (1 - amt)));
      return (v < 16 ? '0' : '') + v.toString(16);
    };
    return '#' + f(0) + f(2) + f(4);
  }

  // Parse an Aladhan timing string ("05:12" or "05:12 (BST)") to {h, m}.
  // Returns null for anything that is not a plausible clock value — we never
  // trust the API blindly.
  function parseHM(str) {
    if (typeof str !== 'string') return null;
    const m = str.match(/(\d{1,2}):(\d{2})/);
    if (!m) return null;
    const h = parseInt(m[1], 10);
    const mi = parseInt(m[2], 10);
    if (!Number.isFinite(h) || !Number.isFinite(mi) || h < 0 || h > 23 || mi < 0 || mi > 59) return null;
    return { h: h, m: mi };
  }

  function fmtTime(h, m, fmt) {
    if (fmt === '12') {
      const hour12 = ((h + 11) % 12) + 1;
      const ampm = h < 12 ? 'am' : 'pm';
      return hour12 + ':' + pad2(m) + ' ' + ampm;
    }
    return pad2(h) + ':' + pad2(m);
  }

  // "1h 23m" / "23m" / "1m" for a positive second count. Under a minute → 'now'.
  function fmtCountdown(sec) {
    if (sec <= 45) return 'now';
    const total = Math.round(sec / 60);
    const h = Math.floor(total / 60);
    const m = total % 60;
    if (h > 0) return h + 'h ' + (m > 0 ? m + 'm' : '00m');
    return m + 'm';
  }

  // Current wall-clock in a named IANA timezone, to the second, plus a
  // YYYY-MM-DD date key. Falls back to the visitor's local clock if the zone
  // is missing or unsupported.
  function zonedNow(tz) {
    const d = new Date();
    if (tz) {
      try {
        const parts = new Intl.DateTimeFormat('en-GB', {
          timeZone: tz, hourCycle: 'h23',
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', second: '2-digit',
        }).formatToParts(d);
        const g = {};
        for (const p of parts) g[p.type] = p.value;
        let hh = parseInt(g.hour, 10) % 24;
        return {
          h: hh, m: parseInt(g.minute, 10), s: parseInt(g.second, 10),
          dateKey: g.year + '-' + g.month + '-' + g.day,
        };
      } catch (e) { /* fall through to local */ }
    }
    return {
      h: d.getHours(), m: d.getMinutes(), s: d.getSeconds(),
      dateKey: d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()),
    };
  }

  // DD-MM-YYYY for the Aladhan path, from a YYYY-MM-DD key.
  function pathDateFromKey(dateKey) {
    const p = dateKey.split('-');
    return p[2] + '-' + p[1] + '-' + p[0];
  }

  /* ------------------------------------------------------------------
   * CSS — scoped inside Shadow DOM. --tgpt-* custom properties.
   * (tgpt-, NOT tgp- — Popup already owns tgp-.)
   * ------------------------------------------------------------------ */
  const STYLES = `
    :host { all: initial; display: block; box-sizing: border-box; }
    :host *, :host *::before, :host *::after { box-sizing: border-box; }

    .tgpt-root {
      --tgpt-brand: #13614C;
      --tgpt-brand-strong: #0C4536;
      --tgpt-accent: #C39A3B;
      --tgpt-bg: #FFFFFF;
      --tgpt-card: #FFFFFF;
      --tgpt-surface: #F6F8F7;
      --tgpt-text: #0F1F1A;
      --tgpt-sub: #4B5D57;
      --tgpt-muted: #8A9A94;
      --tgpt-border: #E4EAE7;
      --tgpt-border-soft: #F0F4F2;
      --tgpt-brand-soft: rgba(19,97,76,0.08);
      --tgpt-accent-soft: rgba(195,154,59,0.14);

      --tgpt-radius: 16px;
      --tgpt-radius-sm: 10px;
      --tgpt-radius-xs: 8px;

      --tgpt-shadow-sm: 0 1px 2px rgba(15,31,26,0.04), 0 1px 3px rgba(15,31,26,0.06);
      --tgpt-shadow-md: 0 4px 16px rgba(15,31,26,0.08), 0 2px 4px rgba(15,31,26,0.04);

      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      color: var(--tgpt-text);
      background: var(--tgpt-bg);
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }

    .tgpt-root[data-theme="dark"] {
      --tgpt-bg: #0E1613;
      --tgpt-card: #16211D;
      --tgpt-surface: #1B2924;
      --tgpt-text: #F2F7F5;
      --tgpt-sub: #B9C7C1;
      --tgpt-muted: #6E7E78;
      --tgpt-border: #263530;
      --tgpt-border-soft: #1B2924;
      --tgpt-brand-soft: rgba(52,168,131,0.14);
      --tgpt-accent-soft: rgba(203,161,53,0.18);
      --tgpt-shadow-sm: 0 1px 2px rgba(0,0,0,0.28);
      --tgpt-shadow-md: 0 4px 16px rgba(0,0,0,0.4);
    }

    /* ─── CARD SHELL ─────────────────────────────────── */
    .tgpt-card {
      background: var(--tgpt-card);
      border: 1px solid var(--tgpt-border);
      border-radius: var(--tgpt-radius);
      box-shadow: var(--tgpt-shadow-sm);
      overflow: hidden;
      width: 100%;
    }

    /* ─── HEADER ─────────────────────────────────────── */
    .tgpt-head {
      display: flex; align-items: flex-start; justify-content: space-between;
      gap: 12px;
      padding: 18px 20px 14px;
    }
    .tgpt-loc {
      display: inline-flex; align-items: center; gap: 6px;
      font-size: 13px; font-weight: 600; color: var(--tgpt-text);
      min-width: 0;
    }
    .tgpt-loc svg { color: var(--tgpt-accent); flex: 0 0 auto; }
    .tgpt-loc-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tgpt-dates { text-align: right; flex: 0 0 auto; }
    .tgpt-hijri {
      margin: 0; font-size: 13px; font-weight: 700; color: var(--tgpt-text);
      letter-spacing: -0.01em; white-space: nowrap;
    }
    .tgpt-greg {
      margin: 2px 0 0; font-size: 11px; color: var(--tgpt-muted);
      white-space: nowrap;
    }

    /* ─── NEXT-PRAYER HERO ───────────────────────────── */
    .tgpt-hero {
      margin: 0 20px 16px;
      padding: 16px 18px;
      border-radius: var(--tgpt-radius-sm);
      background: var(--tgpt-brand);
      background: linear-gradient(135deg, var(--tgpt-brand), var(--tgpt-brand-strong));
      color: #fff;
      display: flex; align-items: center; gap: 16px;
    }
    .tgpt-hero-icon {
      width: 44px; height: 44px; flex: 0 0 44px;
      border-radius: 12px;
      background: rgba(255,255,255,0.14);
      color: #fff;
      display: flex; align-items: center; justify-content: center;
    }
    .tgpt-hero-body { min-width: 0; flex: 1; }
    .tgpt-hero-eyebrow {
      display: inline-flex; align-items: center; gap: 6px;
      margin: 0 0 3px;
      font-size: 10px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase;
      color: rgba(255,255,255,0.72);
    }
    .tgpt-hero-dot {
      width: 6px; height: 6px; border-radius: 50%;
      background: var(--tgpt-accent);
      box-shadow: 0 0 0 0 var(--tgpt-accent);
      animation: tgpt-pulse 2.4s ease-out infinite;
    }
    .tgpt-hero-count {
      margin: 0;
      font-size: 26px; font-weight: 800; letter-spacing: -0.02em;
      line-height: 1.05;
      font-variant-numeric: tabular-nums;
    }
    .tgpt-hero-count .tgpt-hero-until {
      font-size: 13px; font-weight: 600; color: rgba(255,255,255,0.82);
      letter-spacing: 0;
    }
    .tgpt-hero-time {
      flex: 0 0 auto; text-align: right;
    }
    .tgpt-hero-time-val {
      margin: 0; font-size: 20px; font-weight: 700; color: #fff;
      font-variant-numeric: tabular-nums; letter-spacing: -0.01em;
    }
    .tgpt-hero-time-lbl {
      margin: 2px 0 0; font-size: 10px; font-weight: 600;
      letter-spacing: 0.08em; text-transform: uppercase;
      color: rgba(255,255,255,0.66);
    }

    @keyframes tgpt-pulse {
      0%   { box-shadow: 0 0 0 0 var(--tgpt-accent-soft); }
      70%  { box-shadow: 0 0 0 6px rgba(0,0,0,0); }
      100% { box-shadow: 0 0 0 0 rgba(0,0,0,0); }
    }

    /* ─── PRAYER LIST ────────────────────────────────── */
    .tgpt-list { padding: 0 12px 8px; }
    .tgpt-row {
      display: flex; align-items: center; gap: 12px;
      padding: 11px 8px;
      border-radius: var(--tgpt-radius-xs);
      border-bottom: 1px solid var(--tgpt-border-soft);
      transition: background 150ms ease;
    }
    .tgpt-row:last-child { border-bottom: 0; }
    .tgpt-row-icon {
      width: 30px; height: 30px; flex: 0 0 30px;
      border-radius: 8px;
      background: var(--tgpt-surface);
      color: var(--tgpt-sub);
      display: flex; align-items: center; justify-content: center;
    }
    .tgpt-row-name {
      flex: 1; min-width: 0;
      font-size: 14px; font-weight: 600; color: var(--tgpt-text);
    }
    .tgpt-row-sub {
      display: block; font-size: 11px; font-weight: 500; color: var(--tgpt-muted);
      margin-top: 1px;
    }
    .tgpt-row-time {
      flex: 0 0 auto;
      font-size: 15px; font-weight: 700; color: var(--tgpt-text);
      font-variant-numeric: tabular-nums; letter-spacing: -0.01em;
    }
    .tgpt-row[data-sunrise="true"] .tgpt-row-name,
    .tgpt-row[data-sunrise="true"] .tgpt-row-time { font-weight: 500; color: var(--tgpt-sub); }
    .tgpt-row[data-passed="true"] { opacity: 0.5; }
    .tgpt-row[data-next="true"] {
      background: var(--tgpt-accent-soft);
      opacity: 1;
    }
    .tgpt-row[data-next="true"] .tgpt-row-icon {
      background: var(--tgpt-accent);
      color: #fff;
    }
    .tgpt-row[data-next="true"] .tgpt-row-time { color: var(--tgpt-text); }
    .tgpt-next-tag {
      display: inline-flex; align-items: center;
      margin-left: 8px; padding: 2px 7px;
      border-radius: 999px;
      background: var(--tgpt-accent); color: #fff;
      font-size: 9px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
      vertical-align: 1px;
    }

    /* ─── FOOTER / ATTRIBUTION ───────────────────────── */
    .tgpt-foot {
      display: flex; align-items: center; justify-content: space-between;
      gap: 10px;
      padding: 10px 20px 14px;
      border-top: 1px solid var(--tgpt-border-soft);
    }
    .tgpt-stale {
      display: inline-flex; align-items: center; gap: 6px;
      font-size: 11px; color: var(--tgpt-muted);
    }
    .tgpt-stale svg { color: var(--tgpt-accent); }
    .tgpt-attr {
      font-size: 11px; color: var(--tgpt-muted); text-decoration: none;
      margin-left: auto;
    }
    .tgpt-attr:hover { color: var(--tgpt-sub); text-decoration: underline; }

    /* ─── EMPTY / ERROR STATE ────────────────────────── */
    .tgpt-notice {
      padding: 30px 24px; text-align: center;
      background: var(--tgpt-card);
      border: 1px dashed var(--tgpt-border);
      border-radius: var(--tgpt-radius);
      color: var(--tgpt-sub);
    }
    .tgpt-notice-icon {
      width: 40px; height: 40px; border-radius: 50%;
      background: var(--tgpt-brand-soft); color: var(--tgpt-brand);
      display: inline-flex; align-items: center; justify-content: center;
      margin-bottom: 10px;
    }
    .tgpt-notice-title { margin: 0 0 4px; font-size: 15px; font-weight: 600; color: var(--tgpt-text); }
    .tgpt-notice-body { margin: 0 auto; font-size: 13px; color: var(--tgpt-sub); max-width: 320px; }

    /* ─── LOADING SKELETON ───────────────────────────── */
    .tgpt-skel {
      width: 100%; min-height: 300px;
      background: linear-gradient(90deg, var(--tgpt-card) 0%, var(--tgpt-border-soft) 50%, var(--tgpt-card) 100%);
      background-size: 200% 100%;
      animation: tgpt-shimmer 1.5s infinite;
      border-radius: var(--tgpt-radius);
    }
    @keyframes tgpt-shimmer {
      0% { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }

    /* ─── FOCUS ──────────────────────────────────────── */
    .tgpt-root a:focus-visible {
      outline: 2px solid var(--tgpt-accent); outline-offset: 3px; border-radius: 4px;
    }

    /* ─── CARD LAYOUT WIDTH ──────────────────────────── */
    .tgpt-root[data-layout="card"] .tgpt-card { max-width: 380px; }

    /* ─── STRIP LAYOUT ───────────────────────────────── */
    .tgpt-root[data-layout="strip"] .tgpt-card { max-width: 100%; }
    .tgpt-root[data-layout="strip"] .tgpt-strip {
      display: flex; align-items: stretch; flex-wrap: wrap;
      gap: 1px;
      background: var(--tgpt-border-soft);
    }
    .tgpt-strip-lead {
      flex: 1 1 220px;
      background: var(--tgpt-brand);
      color: #fff;
      padding: 14px 18px;
      display: flex; flex-direction: column; justify-content: center; gap: 4px;
    }
    .tgpt-strip-lead-loc {
      display: inline-flex; align-items: center; gap: 6px;
      font-size: 13px; font-weight: 700;
    }
    .tgpt-strip-lead-loc svg { color: var(--tgpt-accent); }
    .tgpt-strip-lead-date { font-size: 11px; color: rgba(255,255,255,0.78); }
    .tgpt-strip-lead-next {
      margin-top: 4px; font-size: 12px; font-weight: 600; color: #fff;
      font-variant-numeric: tabular-nums;
    }
    .tgpt-strip-lead-next b { color: var(--tgpt-accent); }
    .tgpt-strip-cells {
      flex: 3 1 480px;
      display: grid; grid-template-columns: repeat(5, 1fr);
      gap: 1px;
    }
    .tgpt-strip-cells[data-cols="6"] { grid-template-columns: repeat(6, 1fr); }
    .tgpt-cell {
      background: var(--tgpt-card);
      padding: 12px 8px; text-align: center;
      display: flex; flex-direction: column; align-items: center; gap: 4px;
      min-width: 0;
    }
    .tgpt-cell-icon { color: var(--tgpt-muted); height: 18px; }
    .tgpt-cell-name {
      font-size: 10px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase;
      color: var(--tgpt-sub);
    }
    .tgpt-cell-time {
      font-size: 15px; font-weight: 700; color: var(--tgpt-text);
      font-variant-numeric: tabular-nums; letter-spacing: -0.01em;
    }
    .tgpt-cell[data-sunrise="true"] .tgpt-cell-time { font-weight: 500; color: var(--tgpt-sub); }
    .tgpt-cell[data-passed="true"] { opacity: 0.5; }
    .tgpt-cell[data-next="true"] { background: var(--tgpt-accent-soft); opacity: 1; }
    .tgpt-cell[data-next="true"] .tgpt-cell-icon { color: var(--tgpt-accent); }
    .tgpt-cell[data-next="true"] .tgpt-cell-name { color: var(--tgpt-text); }
    .tgpt-root[data-layout="strip"] .tgpt-foot { padding: 10px 18px; }

    /* ─── RESPONSIVE ─────────────────────────────────── */
    @media (max-width: 640px) {
      .tgpt-root[data-layout="strip"] .tgpt-strip-cells { flex-basis: 100%; }
    }
    @media (max-width: 420px) {
      .tgpt-head { padding: 16px 16px 12px; }
      .tgpt-hero { margin: 0 16px 14px; padding: 14px; gap: 12px; }
      .tgpt-hero-count { font-size: 22px; }
      .tgpt-list { padding: 0 8px 6px; }
      .tgpt-root[data-layout="strip"] .tgpt-strip-cells { grid-template-columns: repeat(3, 1fr); }
      .tgpt-root[data-layout="strip"] .tgpt-strip-cells[data-cols="6"] { grid-template-columns: repeat(3, 1fr); }
    }

    @media (prefers-reduced-motion: reduce) {
      .tgpt-root *, .tgpt-root *::before, .tgpt-root *::after {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.01ms !important;
      }
      .tgpt-hero-dot { animation: none; }
    }
  `;

  /* ------------------------------------------------------------------
   * Main widget class
   * ------------------------------------------------------------------ */
  class TGPrayerWidget {
    constructor(container, config) {
      if (!container) throw new Error('TGPrayerWidget: container required');
      this.el = container;
      this.c = this._defaults(config);
      ensureFont(this.c.fontFamily);
      this.shadow = container.attachShadow ? container.attachShadow({ mode: 'open' }) : container;

      this._model = null;      // parsed timings model for the current day
      this._tz = null;         // resolved location timezone (from Aladhan meta)
      this._stale = false;     // rendering a cached day after a failed refresh
      this._geoTried = false;  // geolocation prompted once per instance
      this._resolvedLoc = null;// { mode, lat, lng, city, country } actually used
      this._timer = null;
      this._timeout = null;
      this._abort = null;
      this._sig = null;        // data signature — reload only when it changes

      this._renderShell();
      this._boot();
      container.setAttribute('data-tg-initialised', 'true');
    }

    _defaults(c) {
      const base = {
        widgetId: null,
        theme: 'light',
        brandColor: '#13614C',
        accentColor: '#C39A3B',
        radius: 16,
        fontFamily: '',
        layout: 'card',                 // 'card' | 'strip'
        location: {
          mode: 'city',                 // 'city' | 'coords'
          city: 'London',
          country: 'United Kingdom',
          lat: null,
          lng: null,
          label: '',
        },
        useVisitorLocation: false,
        method: 3,                      // 3 = Muslim World League
        school: 0,                      // 0 = Shafi
        latitudeAdjustment: 3,          // 3 = Angle Based (best for UK/high latitudes)
        hourFormat: '24',               // '12' | '24'
        showSunrise: true,
        showHijri: true,
        showCountdown: true,
        attribution: true,
        tune: { Fajr: 0, Sunrise: 0, Dhuhr: 0, Asr: 0, Maghrib: 0, Isha: 0 },
      };
      const merged = Object.assign({}, base, (c && typeof c === 'object') ? c : {});
      merged.location = Object.assign({}, base.location, (c && c.location) || {});
      merged.tune = Object.assign({}, base.tune, (c && c.tune) || {});
      // Normalise + clamp the values that reach the network.
      merged.method = VALID_METHODS.indexOf(parseInt(merged.method, 10)) !== -1 ? parseInt(merged.method, 10) : 3;
      merged.school = VALID_SCHOOLS.indexOf(parseInt(merged.school, 10)) !== -1 ? parseInt(merged.school, 10) : 0;
      merged.latitudeAdjustment = VALID_LAT_ADJ.indexOf(parseInt(merged.latitudeAdjustment, 10)) !== -1 ? parseInt(merged.latitudeAdjustment, 10) : 3;
      merged.layout = merged.layout === 'strip' ? 'strip' : 'card';
      merged.hourFormat = merged.hourFormat === '12' ? '12' : '24';
      return merged;
    }

    _renderShell() {
      while (this.shadow.firstChild) this.shadow.removeChild(this.shadow.firstChild);
      const style = document.createElement('style');
      style.textContent = STYLES;
      this.shadow.appendChild(style);

      this.root = document.createElement('div');
      this.root.className = 'tgpt-root';
      this.root.setAttribute('data-theme', this.c.theme === 'dark' ? 'dark' : 'light');
      this.root.setAttribute('data-layout', this.c.layout);
      this._applyThemeVars();
      this.root.innerHTML = '<div class="tgpt-skel" aria-hidden="true"></div>';
      this.shadow.appendChild(this.root);
    }

    _applyThemeVars() {
      const r = this.root;
      if (!r) return;
      if (this.c.brandColor) {
        r.style.setProperty('--tgpt-brand', this.c.brandColor);
        r.style.setProperty('--tgpt-brand-strong', darken(this.c.brandColor, 0.28));
        r.style.setProperty('--tgpt-brand-soft', hexToRgba(this.c.brandColor, 0.10));
      }
      if (this.c.accentColor) {
        r.style.setProperty('--tgpt-accent', this.c.accentColor);
        r.style.setProperty('--tgpt-accent-soft', hexToRgba(this.c.accentColor, 0.16));
      }
      if (this.c.radius != null) {
        const n = clampInt(this.c.radius, 0, 28, 16);
        r.style.setProperty('--tgpt-radius', n + 'px');
        r.style.setProperty('--tgpt-radius-sm', Math.max(6, n - 6) + 'px');
        r.style.setProperty('--tgpt-radius-xs', Math.max(4, n - 8) + 'px');
      }
      if (this.c.fontFamily) {
        r.style.fontFamily = this.c.fontFamily + ", 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
      }
    }

    // Signature of everything that changes the actual times — reload only when
    // one of these changes, so colour/format/layout tweaks never hit the API.
    _dataSig() {
      const l = this.c.location || {};
      return JSON.stringify({
        v: this.c.useVisitorLocation ? 'geo' : 'fixed',
        mode: l.mode, city: l.city, country: l.country, lat: l.lat, lng: l.lng,
        method: this.c.method, school: this.c.school, latAdj: this.c.latitudeAdjustment,
        tune: this.c.tune,
      });
    }

    _boot() {
      this._sig = this._dataSig();

      if (this.c.useVisitorLocation) {
        // Already have the visitor's coords from an earlier prompt — reuse them
        // (a later config change must not clobber them with the fixed fallback).
        if (this._geoTried && this._resolvedLoc && this._resolvedLoc.mode === 'coords') {
          this._loadTimings();
          return;
        }
        if (!this._geoTried && typeof navigator !== 'undefined' && navigator.geolocation) {
          this._geoTried = true;
          let settled = false;
          const fallback = () => { if (settled) return; settled = true; this._resolveFixed(); this._loadTimings(); };
          // Guard the permission prompt so an ignored dialog still resolves.
          const geoTimer = setTimeout(fallback, 8000);
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              if (settled) return; settled = true; clearTimeout(geoTimer);
              this._resolvedLoc = {
                mode: 'coords',
                lat: pos.coords.latitude, lng: pos.coords.longitude,
                label: this.c.location.label || 'Your location',
              };
              this._loadTimings();
            },
            () => { clearTimeout(geoTimer); fallback(); },
            { timeout: 7000, maximumAge: 3600000 }
          );
          return;
        }
        // Geolocation denied earlier or unsupported — fall back to the fixed location.
        this._resolveFixed();
        this._loadTimings();
        return;
      }

      this._resolveFixed();
      this._loadTimings();
    }

    _resolveFixed() {
      const l = this.c.location || {};
      const lat = (l.lat != null && l.lat !== '') ? Number(l.lat) : null;
      const lng = (l.lng != null && l.lng !== '') ? Number(l.lng) : null;
      if (l.mode === 'coords' && Number.isFinite(lat) && Number.isFinite(lng)) {
        this._resolvedLoc = { mode: 'coords', lat: lat, lng: lng, label: l.label || '' };
      } else {
        this._resolvedLoc = {
          mode: 'city',
          city: (l.city || '').toString().trim(),
          country: (l.country || '').toString().trim(),
          label: l.label || '',
        };
      }
    }

    _cacheKey(dateKey) {
      const loc = this._resolvedLoc || {};
      const who = loc.mode === 'coords'
        ? 'c:' + Number(loc.lat).toFixed(3) + ',' + Number(loc.lng).toFixed(3)
        : 'n:' + (loc.city || '').toLowerCase() + '|' + (loc.country || '').toLowerCase();
      const tuneKey = Object.keys(this.c.tune || {}).map(k => this.c.tune[k] || 0).join(',');
      return STORE_PREFIX + [who, this.c.method, this.c.school, this.c.latitudeAdjustment, tuneKey, dateKey].join('_');
    }

    _readCache(key) {
      try {
        const raw = window.localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
      } catch (e) { return null; }
    }
    _writeCache(key, data) {
      try {
        window.localStorage.setItem(key, JSON.stringify(data));
        window.localStorage.setItem(STORE_PREFIX + 'last', JSON.stringify({ key: key, data: data }));
      } catch (e) { /* private mode / quota — non-fatal */ }
    }
    _readLastGood() {
      try {
        const raw = window.localStorage.getItem(STORE_PREFIX + 'last');
        const obj = raw ? JSON.parse(raw) : null;
        return obj && obj.data ? obj.data : null;
      } catch (e) { return null; }
    }

    _buildTune() {
      // Aladhan `tune` order: Imsak,Fajr,Sunrise,Dhuhr,Asr,Maghrib,Sunset,Isha,Midnight
      const t = this.c.tune || {};
      const g = (k) => clampInt(t[k], -60, 60, 0);
      const arr = [0, g('Fajr'), g('Sunrise'), g('Dhuhr'), g('Asr'), g('Maghrib'), 0, g('Isha'), 0];
      return arr.some(v => v !== 0) ? arr.join(',') : null;
    }

    _buildUrl(dateKey) {
      const loc = this._resolvedLoc || {};
      const pathDate = pathDateFromKey(dateKey);
      const qs = [];
      qs.push('method=' + encodeURIComponent(this.c.method));
      qs.push('school=' + encodeURIComponent(this.c.school));
      if (this.c.latitudeAdjustment) qs.push('latitudeAdjustmentMethod=' + encodeURIComponent(this.c.latitudeAdjustment));
      const tune = this._buildTune();
      if (tune) qs.push('tune=' + encodeURIComponent(tune));

      if (loc.mode === 'coords' && Number.isFinite(loc.lat) && Number.isFinite(loc.lng)) {
        qs.unshift('longitude=' + encodeURIComponent(loc.lng));
        qs.unshift('latitude=' + encodeURIComponent(loc.lat));
        return ALADHAN_BASE + '/timings/' + pathDate + '?' + qs.join('&');
      }
      qs.unshift('country=' + encodeURIComponent(loc.country || ''));
      qs.unshift('city=' + encodeURIComponent(loc.city || ''));
      return ALADHAN_BASE + '/timingsByCity/' + pathDate + '?' + qs.join('&');
    }

    _hasLocation() {
      const loc = this._resolvedLoc || {};
      if (loc.mode === 'coords') return Number.isFinite(loc.lat) && Number.isFinite(loc.lng);
      return !!(loc.city && loc.city.length);
    }

    async _loadTimings() {
      if (!this._hasLocation()) return this._renderHidden();

      // Use the location timezone (learned from a prior fetch) to pick "today";
      // otherwise the visitor's local date. Rollover self-corrects at midnight.
      const dateKey = zonedNow(this._tz).dateKey;
      const key = this._cacheKey(dateKey);

      const cached = this._readCache(key);
      if (cached) {
        this._stale = false;
        this._ingest(cached);
        return;
      }

      const url = this._buildUrl(dateKey);
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      if (this._abort) { try { this._abort.abort(); } catch (e) { /* noop */ } }
      this._abort = ctrl;
      const timer = ctrl ? setTimeout(() => { try { ctrl.abort(); } catch (e) { /* noop */ } }, FETCH_TIMEOUT) : null;
      try {
        const res = await fetch(url, ctrl ? { credentials: 'omit', signal: ctrl.signal } : { credentials: 'omit' });
        if (timer) clearTimeout(timer);
        if (!res.ok) throw new Error('Aladhan fetch failed (' + res.status + ')');
        const json = await res.json();
        if (!json || json.code !== 200 || !json.data || !json.data.timings) {
          throw new Error('Aladhan returned no timings');
        }
        this._writeCache(key, json.data);
        this._stale = false;
        this._ingest(json.data);
      } catch (err) {
        if (timer) clearTimeout(timer);
        if (err && err.name === 'AbortError') return;   // superseded by a newer request
        console.error('[TG Prayer] Failed to load prayer times:', err);
        // Graceful degradation — render the last good day, flagged stale.
        const last = this._readLastGood();
        if (last) { this._stale = true; this._ingest(last); }
        else this._renderHidden();
      }
    }

    // Turn an Aladhan `data` object into the render model, then render.
    _ingest(data) {
      const model = this._parse(data);
      if (!model) return this._renderHidden();
      this._model = model;
      this._tz = model.timezone || this._tz;
      this._render();
      this._startClock();
    }

    _parse(data) {
      if (!data || !data.timings) return null;
      const times = {};
      for (const row of PRAYER_ROWS) {
        const hm = parseHM(data.timings[row.key]);
        times[row.key] = hm; // may be null
      }
      // Fajr, Dhuhr, Asr, Maghrib, Isha must all be present to be usable.
      const essential = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];
      if (essential.some(k => !times[k])) return null;

      const date = data.date || {};
      const hijri = date.hijri || {};
      const greg = date.gregorian || {};
      const hijriMonth = (hijri.month && hijri.month.en) ? hijri.month.en : '';
      const hijriDesignation = (hijri.designation && hijri.designation.abbreviated) ? hijri.designation.abbreviated : 'AH';
      const gregWeekday = (greg.weekday && greg.weekday.en) ? greg.weekday.en : '';
      const gregMonth = (greg.month && greg.month.en) ? greg.month.en : '';

      const tz = (data.meta && data.meta.timezone) ? String(data.meta.timezone) : '';

      return {
        times: times,
        timezone: tz,
        hijri: {
          text: (hijri.day ? hijri.day + ' ' : '') + hijriMonth + (hijri.year ? ' ' + hijri.year : '') + ' ' + hijriDesignation,
        },
        greg: {
          text: (gregWeekday ? gregWeekday + ', ' : '') + (greg.day ? greg.day + ' ' : '') + gregMonth + (greg.year ? ' ' + greg.year : ''),
        },
      };
    }

    // Rows the current config actually shows, with parsed times.
    _visibleRows() {
      return PRAYER_ROWS.filter(r => r.prayer || (r.key === 'Sunrise' && this.c.showSunrise))
        .map(r => {
          const hm = this._model.times[r.key];
          return hm ? Object.assign({}, r, { h: hm.h, m: hm.m, minutes: hm.h * 60 + hm.m } ) : null;
        })
        .filter(Boolean);
    }

    // Which prayer is next, and how long until it. Runs in the location tz.
    _computeNext() {
      const rows = this._visibleRows().filter(r => r.prayer);
      const now = zonedNow(this._tz);
      const nowSec = now.h * 3600 + now.m * 60 + now.s;
      let next = null;
      for (const r of rows) {
        const sec = r.minutes * 60;
        if (sec > nowSec) { next = { row: r, remaining: sec - nowSec, tomorrow: false }; break; }
      }
      if (!next && rows.length) {
        // All of today's prayers have passed — next is tomorrow's Fajr.
        const first = rows[0];
        next = { row: first, remaining: (first.minutes * 60 + 86400) - nowSec, tomorrow: true };
      }
      return next;
    }

    _render() {
      if (!this._model) return this._renderHidden();
      const html = this.c.layout === 'strip' ? this._renderStrip() : this._renderCard();
      this.root.innerHTML = html;
      this._updateDynamic();
    }

    _footer() {
      const stale = this._stale
        ? '<span class="tgpt-stale">' + icon('info', 13) + 'Times may be outdated</span>'
        : '';
      const attr = this.c.attribution
        ? '<a class="tgpt-attr" href="https://aladhan.com" target="_blank" rel="noopener noreferrer">Times by Aladhan</a>'
        : '';
      if (!stale && !attr) return '';
      return '<div class="tgpt-foot">' + stale + attr + '</div>';
    }

    _locName() {
      const loc = this._resolvedLoc || {};
      if (loc.label) return loc.label;
      if (loc.mode === 'coords') return 'Prayer times';
      return loc.city || 'Prayer times';
    }

    _renderCard() {
      const rows = this._visibleRows();
      const rowsHtml = rows.map(r => {
        const timeStr = fmtTime(r.h, r.m, this.c.hourFormat);
        const sunriseAttr = r.prayer ? '' : ' data-sunrise="true"';
        return (
          '<div class="tgpt-row" data-key="' + esc(r.key) + '"' + sunriseAttr + '>' +
            '<span class="tgpt-row-icon">' + icon(r.icon, 16) + '</span>' +
            '<span class="tgpt-row-name">' + esc(r.label) + '</span>' +
            '<span class="tgpt-row-time">' + esc(timeStr) + '</span>' +
          '</div>'
        );
      }).join('');

      const datesHtml =
        '<div class="tgpt-dates">' +
          (this.c.showHijri ? '<p class="tgpt-hijri">' + esc(this._model.hijri.text) + '</p>' : '') +
          '<p class="tgpt-greg">' + esc(this._model.greg.text) + '</p>' +
        '</div>';

      const hero = this.c.showCountdown ? this._heroHtml() : '';

      return (
        '<div class="tgpt-card">' +
          '<div class="tgpt-head">' +
            '<span class="tgpt-loc">' + icon('pin', 14) + '<span class="tgpt-loc-name">' + esc(this._locName()) + '</span></span>' +
            datesHtml +
          '</div>' +
          hero +
          '<div class="tgpt-list">' + rowsHtml + '</div>' +
          this._footer() +
        '</div>'
      );
    }

    _heroHtml() {
      // Filled in by _updateDynamic — rendered once, updated in place each tick.
      return (
        '<div class="tgpt-hero" data-hero="1">' +
          '<div class="tgpt-hero-icon" data-hero-icon>' + icon('clock', 22) + '</div>' +
          '<div class="tgpt-hero-body">' +
            '<p class="tgpt-hero-eyebrow"><span class="tgpt-hero-dot"></span> Next prayer</p>' +
            '<p class="tgpt-hero-count" data-hero-count></p>' +
          '</div>' +
          '<div class="tgpt-hero-time">' +
            '<p class="tgpt-hero-time-val" data-hero-time></p>' +
            '<p class="tgpt-hero-time-lbl" data-hero-name></p>' +
          '</div>' +
        '</div>'
      );
    }

    _renderStrip() {
      const rows = this._visibleRows();
      const cols = rows.length;
      const cellsHtml = rows.map(r => {
        const timeStr = fmtTime(r.h, r.m, this.c.hourFormat);
        const sunriseAttr = r.prayer ? '' : ' data-sunrise="true"';
        return (
          '<div class="tgpt-cell" data-key="' + esc(r.key) + '"' + sunriseAttr + '>' +
            '<span class="tgpt-cell-icon">' + icon(r.icon, 16) + '</span>' +
            '<span class="tgpt-cell-name">' + esc(r.label) + '</span>' +
            '<span class="tgpt-cell-time">' + esc(timeStr) + '</span>' +
          '</div>'
        );
      }).join('');

      const dateLine = (this.c.showHijri ? esc(this._model.hijri.text) + ' · ' : '') + esc(this._model.greg.text);

      return (
        '<div class="tgpt-card">' +
          '<div class="tgpt-strip">' +
            '<div class="tgpt-strip-lead">' +
              '<span class="tgpt-strip-lead-loc">' + icon('pin', 14) + esc(this._locName()) + '</span>' +
              '<span class="tgpt-strip-lead-date">' + dateLine + '</span>' +
              (this.c.showCountdown ? '<span class="tgpt-strip-lead-next" data-hero-count></span>' : '') +
            '</div>' +
            '<div class="tgpt-strip-cells" data-cols="' + cols + '">' + cellsHtml + '</div>' +
          '</div>' +
          this._footer() +
        '</div>'
      );
    }

    // Recompute the countdown + next/passed states and write them into the
    // already-rendered DOM. Text-only — never grabs focus or scrolls.
    _updateDynamic() {
      if (!this._model || !this.root) return;
      const now = zonedNow(this._tz);
      const next = this.c.showCountdown ? this._computeNext() : null;
      const nowSec = now.h * 3600 + now.m * 60 + now.s;

      // Row / cell states.
      const items = this.root.querySelectorAll('.tgpt-row, .tgpt-cell');
      items.forEach(node => {
        const key = node.getAttribute('data-key');
        const row = this._visibleRows().find(r => r.key === key);
        if (!row) return;
        const isPrayer = row.prayer;
        const passed = row.minutes * 60 <= nowSec;
        const isNext = next && next.row.key === key && !next.tomorrow;
        node.setAttribute('data-passed', (isPrayer && passed && !isNext) ? 'true' : 'false');
        node.setAttribute('data-next', isNext ? 'true' : 'false');
      });

      // Hero / lead countdown.
      const countEl = this.root.querySelector('[data-hero-count]');
      if (next) {
        const cd = fmtCountdown(next.remaining);
        const nm = next.row.label;
        const tm = fmtTime(next.row.h, next.row.m, this.c.hourFormat);
        if (this.c.layout === 'strip') {
          if (countEl) countEl.innerHTML = '<b>' + esc(nm) + '</b> ' + (cd === 'now' ? 'now' : 'in ' + esc(cd)) + ' · ' + esc(tm);
        } else {
          if (countEl) {
            countEl.innerHTML = (cd === 'now' ? esc(nm) + ' now' : esc(cd)) +
              (cd === 'now' ? '' : ' <span class="tgpt-hero-until">until ' + esc(nm) + '</span>');
          }
          const timeEl = this.root.querySelector('[data-hero-time]');
          const nameEl = this.root.querySelector('[data-hero-name]');
          const heroIcon = this.root.querySelector('[data-hero-icon]');
          if (timeEl) timeEl.textContent = tm;
          if (nameEl) nameEl.textContent = next.tomorrow ? 'Tomorrow' : 'Today';
          if (heroIcon) heroIcon.innerHTML = icon(next.row.icon, 22);
        }
      }
    }

    _startClock() {
      this._stopClock();
      if (this._model) this._model._dateKey = zonedNow(this._tz).dateKey;
      const tick = () => {
        // Refetch on a genuine day change (tab left open past midnight).
        const todayKey = zonedNow(this._tz).dateKey;
        if (this._model && this._model._dateKey && this._model._dateKey !== todayKey) {
          this._loadTimings();
          return;
        }
        this._updateDynamic();
      };
      // Align to the minute boundary using the visitor clock (drives setInterval).
      const msToMinute = (60 - new Date().getSeconds()) * 1000 - new Date().getMilliseconds();
      this._timeout = setTimeout(() => {
        tick();
        this._timer = setInterval(tick, 60000);
      }, Math.max(250, msToMinute));
    }

    _stopClock() {
      if (this._timer) { clearInterval(this._timer); this._timer = null; }
      if (this._timeout) { clearTimeout(this._timeout); this._timeout = null; }
    }

    _renderHidden() {
      // No data and no cache: hide silently on a live page, but show a calm
      // notice inside the editor/dashboard preview so the agent sees something.
      this._stopClock();
      const isPreview = typeof window !== 'undefined' && window.__TG_PREVIEW__;
      if (!isPreview) {
        try { this.root.innerHTML = ''; this.el.style.display = 'none'; } catch (e) { /* noop */ }
        return;
      }
      this.root.innerHTML =
        '<div class="tgpt-notice">' +
          '<div class="tgpt-notice-icon">' + icon('info', 18) + '</div>' +
          '<h2 class="tgpt-notice-title">Prayer times unavailable</h2>' +
          '<p class="tgpt-notice-body">Set a city and country (or coordinates) for this widget. Times load live from Aladhan.</p>' +
        '</div>';
    }

    update(newConfig) {
      const prevSig = this._sig;
      this.c = this._defaults(Object.assign({}, this.c, newConfig || {}));
      ensureFont(this.c.fontFamily);
      this._renderShell();
      this._sig = this._dataSig();

      if (this._sig !== prevSig || !this._model) {
        // Location / method / school / tune changed — re-resolve and reload.
        this._geoTried = this.c.useVisitorLocation ? this._geoTried : false;
        this._boot();
      } else {
        // Pure presentation change — reuse the model, just redraw.
        this._render();
        this._startClock();
      }
    }

    destroy() {
      this._stopClock();
      if (this._abort) { try { this._abort.abort(); } catch (e) { /* noop */ } }
      try { while (this.shadow.firstChild) this.shadow.removeChild(this.shadow.firstChild); } catch (e) { /* noop */ }
      try { this.el.removeAttribute('data-tg-initialised'); } catch (e) { /* noop */ }
      this.el.__tgPrayer = null;
    }
  }

  /* ------------------------------------------------------------------
   * Auto-initialiser
   * ------------------------------------------------------------------ */
  async function init() {
    const containers = document.querySelectorAll('[data-tg-widget="prayer"]:not([data-tg-initialised])');
    for (const el of containers) {
      try {
        const inline = el.getAttribute('data-tg-config');
        if (inline) {
          let cfg = {};
          try { cfg = JSON.parse(inline); } catch { cfg = {}; }
          el.__tgPrayer = new TGPrayerWidget(el, cfg);
          continue;
        }
        const id = el.getAttribute('data-tg-id');
        if (id) {
          const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
          const timer = ctrl ? setTimeout(() => ctrl.abort(), FETCH_TIMEOUT) : null;
          const res = await fetch(API_BASE + '?id=' + encodeURIComponent(id),
            ctrl ? { credentials: 'omit', signal: ctrl.signal } : { credentials: 'omit' });
          if (timer) clearTimeout(timer);
          if (!res.ok) throw new Error('Widget config fetch failed (' + res.status + ')');
          const data = await res.json();
          const cfg = (data && (data.config || data)) || {};
          cfg.widgetId = id;
          el.__tgPrayer = new TGPrayerWidget(el, cfg);
          continue;
        }
        console.warn('[TG Prayer] Container has neither data-tg-id nor data-tg-config');
      } catch (err) {
        console.error('[TG Prayer] Failed to initialise:', err);
        try { el.innerHTML = ''; el.style.display = 'none'; } catch (e) { /* noop */ }
      }
    }
  }

  if (typeof window !== 'undefined') {
    window.TGPrayerWidget = TGPrayerWidget;
    window.__TG_PRAYER_VERSION__ = VERSION;
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
    if (typeof MutationObserver !== 'undefined') {
      try {
        let scheduled = false;
        const scheduleInit = () => {
          if (scheduled) return;
          scheduled = true;
          setTimeout(() => { scheduled = false; init(); }, 120);
        };
        const mo = new MutationObserver((records) => {
          for (const r of records) {
            for (const node of r.addedNodes) {
              if (node.nodeType !== 1) continue;
              if (node.matches && node.matches('[data-tg-widget="prayer"]:not([data-tg-initialised])')) { scheduleInit(); return; }
              if (node.querySelector && node.querySelector('[data-tg-widget="prayer"]:not([data-tg-initialised])')) { scheduleInit(); return; }
            }
          }
        });
        mo.observe(document.body || document.documentElement, { childList: true, subtree: true });
      } catch (e) { /* noop */ }
    }
  }
})();
