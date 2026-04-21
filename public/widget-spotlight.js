/**
 * Travelgenix Destination Spotlight Widget v1.0.0
 * Self-contained, embeddable editorial destination showcase.
 * Zero dependencies. Shadow DOM isolation. Works on any website via a single script tag.
 *
 * Data is fetched live at render-time from the Travelgenix Destination Content
 * database via /api/destination-content — never snapshotted into config.
 *
 * Features
 *  - Full-bleed editorial hero with destination name + tagline
 *  - 12-month climate chart, colour-coded by season, with rainfall strip and
 *    best-time-to-visit callout (the "nobody else does this" hook)
 *  - Quick facts bar (flight time, time zone, currency, language, voltage)
 *  - Highlights grid (3-6 cards with 17-icon vocabulary)
 *  - Best For tags (pill row with icons, 20-option vocabulary)
 *  - Events / "What's on" section (optional)
 *  - Agent-brandable CTA (protocol-validated URL)
 *  - 7 sections, each individually toggleable
 *  - Light default + full dark mode
 *  - Responsive 320px → 1440px
 *  - ARIA-labelled, focus-visible, prefers-reduced-motion honoured
 *  - Screen-reader description for the climate chart
 *
 * Usage (remote config, default):
 *   <div data-tg-widget="spotlight" data-tg-id="YOUR_WIDGET_ID"></div>
 *   <script src="https://tg-widgets.vercel.app/widget-spotlight.js"></script>
 *
 * Usage (inline config, editor preview):
 *   <div data-tg-widget="spotlight" data-tg-config='{...}'></div>
 *   <script src="https://tg-widgets.vercel.app/widget-spotlight.js"></script>
 *
 * Inline config may also pass `destinationData` to bypass the live fetch,
 * which the editor uses to render a live preview without round-tripping
 * through the API on every config change.
 */
(function () {
  'use strict';

  const API_BASE = (typeof window !== 'undefined' && window.__TG_WIDGET_API__) || '/api/widget-config';
  const CONTENT_API = (typeof window !== 'undefined' && window.__TG_DEST_CONTENT_API__) || '/api/destination-content';
  const VERSION = '1.0.0';

  /* ------------------------------------------------------------------
   * Icon library — inline SVG path strings (Lucide-style).
   * Covers the 17-icon Highlights vocabulary plus UI glyphs.
   * ------------------------------------------------------------------ */
  const IC = {
    // Highlights vocabulary (17)
    mountain:    '<path d="m8 3 4 8 5-5 5 15H2L8 3z"/>',
    sunset:      '<path d="M12 10V2"/><path d="m4.93 10.93 1.41 1.41"/><path d="M2 18h2"/><path d="M20 18h2"/><path d="m19.07 10.93-1.41 1.41"/><path d="M22 22H2"/><path d="m16 6-4 4-4-4"/><path d="M16 18a4 4 0 0 0-8 0"/>',
    wine:        '<path d="M8 22h8"/><path d="M7 10h10"/><path d="M12 15v7"/><path d="M12 15a5 5 0 0 0 5-5c0-2-.5-4-2-8H9c-1.5 4-2 6-2 8a5 5 0 0 0 5 5Z"/>',
    water:       '<path d="M12 2v6"/><path d="M5 15a7 7 0 1 0 14 0c0-5-7-13-7-13S5 10 5 15z"/>',
    palm:        '<path d="M13 8c0-2.76-2.46-5-5.5-5S2 5.24 2 8h2l1-1 1 1h4"/><path d="M13 7.14A5.82 5.82 0 0 1 16.5 6c3.04 0 5.5 2.24 5.5 5h-3l-1-1-1 1h-3"/><path d="M5.89 9.71c-2.15 2.15-2.3 5.47-.35 7.43l4.24-4.25z"/><path d="M11 15.5c.5 2.5-.17 4.5-1 6.5h4c2-5.5-.5-12-1-14"/>',
    city:        '<path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4"/><path d="M10 10h4"/><path d="M10 14h4"/><path d="M10 18h4"/>',
    temple:      '<path d="M3 22V10l9-7 9 7v12"/><path d="M3 10h18"/><path d="M9 22v-7h6v7"/><path d="M12 3v4"/>',
    beach:       '<path d="M12 21a9 9 0 0 0 9-9 9 9 0 0 0-3-6.7L3 21h18"/><path d="M8 4v.01"/><path d="M16 6 20 2"/>',
    food:        '<path d="M3 11h18"/><path d="M12 11V3"/><path d="M8 11V3"/><path d="M16 11V3"/><path d="M5 11v5a7 7 0 0 0 14 0v-5"/>',
    star:        '<path d="M11.48 3.5a.55.55 0 0 1 1 0l2.14 6.58h6.92a.55.55 0 0 1 .32.99l-5.6 4.07 2.14 6.58a.55.55 0 0 1-.85.61L12 17.27l-5.6 4.06a.55.55 0 0 1-.85-.61l2.14-6.58-5.6-4.07a.55.55 0 0 1 .32-.99h6.92z"/>',
    camera:      '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
    heart:       '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7z"/>',
    building:    '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M12 6h.01"/><path d="M12 10h.01"/><path d="M8 10h.01"/><path d="M16 10h.01"/><path d="M8 14h.01"/><path d="M12 14h.01"/><path d="M16 14h.01"/>',
    map:         '<path d="M9 3 4 5v16l5-2 6 2 5-2V3l-5 2-6-2z"/><path d="M9 3v16"/><path d="M15 5v16"/>',
    compass:     '<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>',
    sun:         '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
    snowflake:   '<path d="M2 12h20"/><path d="M12 2v20"/><path d="m20 16-4-4 4-4"/><path d="m4 8 4 4-4 4"/><path d="m16 4-4 4-4-4"/><path d="m8 20 4-4 4 4"/>',

    // UI glyphs
    plane:       '<path d="M17.8 19.2 16 11l3.5-3.5c.5-.5 1-2.5.5-3-1-.5-3 0-3.5.5L13 8.5 4.8 6.5c-.5-.1-.9.2-.9.7v.4c0 .3.2.6.5.8L8 10.5 6 14H3l-.5 1.5L5 17l1.5 2.5L8 19v-3l3.5-2 2.8 3.5c.2.3.5.5.8.5h.4c.5 0 .8-.4.7-.9z"/>',
    clock:       '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    coin:        '<circle cx="12" cy="12" r="9"/><path d="M14.8 9a2 2 0 0 0-1.8-1h-2a2 2 0 0 0 0 4h2a2 2 0 0 1 0 4h-2a2 2 0 0 1-1.8-1"/><path d="M12 6v2"/><path d="M12 16v2"/>',
    languages:   '<path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/>',
    zap:         '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
    arrow:       '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    calendar:    '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    info:        '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    alert:       '<path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  };

  function icon(name, size) {
    const path = IC[name] || IC.star;
    const s = size || 18;
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + s + '" height="' + s +
           '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"' +
           ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + path + '</svg>';
  }

  // Pick a quick-facts icon based on the fact type
  function factIcon(kind) {
    switch (kind) {
      case 'flight':   return 'plane';
      case 'timezone': return 'clock';
      case 'currency': return 'coin';
      case 'language': return 'languages';
      case 'voltage':  return 'zap';
      default:         return 'info';
    }
  }

  // Icon for Best For tags — maps each of the 20 tag vocabulary options to an
  // icon from IC. Undefined tags fall back to 'star'.
  const TAG_ICONS = {
    'Couples':          'heart',
    'Honeymoons':       'heart',
    'Families':         'sun',
    'Food and Wine':    'wine',
    'Photography':      'camera',
    'Beach':            'beach',
    'Adventure':        'compass',
    'Luxury':           'star',
    'Budget':           'coin',
    'City Break':       'city',
    'Culture':          'temple',
    'Nightlife':        'zap',
    'Wellness':         'heart',
    'Wildlife':         'compass',
    'Winter Sun':       'sun',
    'Summer Sun':       'sun',
    'Skiing':           'snowflake',
    'Multi Generation': 'sun',
    'Solo Travel':      'map',
    'Romance':          'heart',
  };

  /* ------------------------------------------------------------------
   * Safety helpers
   * ------------------------------------------------------------------ */

  // HTML-escape a string for safe interpolation into innerHTML.
  // Used for values we render into markup; for raw text nodes we prefer
  // textContent, but the escape is defence-in-depth.
  function esc(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // URL protocol allowlist. Rejects javascript:, data:, vbscript:, relative.
  function safeUrl(url, allowMailtoTel) {
    if (typeof url !== 'string') return '';
    const trimmed = url.trim();
    if (!trimmed) return '';
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    if (allowMailtoTel && /^(mailto|tel):/i.test(trimmed)) return trimmed;
    return '';
  }

  // Month labels used throughout
  const MONTH_LABELS = ['J','F','M','A','M','J','J','A','S','O','N','D'];
  const MONTH_NAMES_FULL = ['January','February','March','April','May','June',
                            'July','August','September','October','November','December'];

  /* ------------------------------------------------------------------
   * CSS — scoped inside Shadow DOM.
   * Uses CSS custom properties for theming. Everything a client would want
   * to brand (brand colour, accent, radius, fonts) is a CSS var.
   * ------------------------------------------------------------------ */
  const STYLES = `
    :host { all: initial; display: block; box-sizing: border-box; }
    :host *, :host *::before, :host *::after { box-sizing: border-box; }

    .tgs-root {
      --tgs-brand: #1B2B5B;
      --tgs-accent: #00B4D8;
      --tgs-bg: #FFFFFF;
      --tgs-card: #F8FAFC;
      --tgs-text: #0F172A;
      --tgs-sub: #475569;
      --tgs-muted: #94A3B8;
      --tgs-border: #E2E8F0;
      --tgs-border-soft: #F1F5F9;
      --tgs-brand-soft: rgba(27,43,91,0.08);
      --tgs-accent-soft: rgba(0,180,216,0.12);

      --tgs-season-best: #00B4D8;
      --tgs-season-shoulder: #F59E0B;
      --tgs-season-off: #CBD5E1;
      --tgs-rain: rgba(15,23,42,0.18);

      --tgs-radius: 16px;
      --tgs-radius-sm: 10px;
      --tgs-radius-xs: 6px;

      --tgs-shadow-sm: 0 1px 2px rgba(15,23,42,0.04), 0 1px 3px rgba(15,23,42,0.06);
      --tgs-shadow-md: 0 4px 16px rgba(15,23,42,0.08), 0 2px 4px rgba(15,23,42,0.04);
      --tgs-shadow-lg: 0 20px 40px rgba(15,23,42,0.12), 0 8px 16px rgba(15,23,42,0.06);

      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      color: var(--tgs-text);
      background: var(--tgs-bg);
      line-height: 1.55;
      max-width: 1440px;
      margin: 0 auto;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }

    .tgs-root[data-theme="dark"] {
      --tgs-bg: #0F172A;
      --tgs-card: #1E293B;
      --tgs-text: #F8FAFC;
      --tgs-sub: #CBD5E1;
      --tgs-muted: #64748B;
      --tgs-border: #334155;
      --tgs-border-soft: #1E293B;
      --tgs-brand-soft: rgba(0,180,216,0.12);
      --tgs-accent-soft: rgba(0,180,216,0.18);
      --tgs-season-off: #475569;
      --tgs-rain: rgba(203,213,225,0.25);
      --tgs-shadow-sm: 0 1px 2px rgba(0,0,0,0.25);
      --tgs-shadow-md: 0 4px 16px rgba(0,0,0,0.35);
      --tgs-shadow-lg: 0 20px 40px rgba(0,0,0,0.45);
    }

    /* ─── HERO ───────────────────────────────────────── */
    .tgs-hero {
      position: relative;
      width: 100%;
      aspect-ratio: 16 / 9;
      overflow: hidden;
      border-radius: var(--tgs-radius);
      background: var(--tgs-card);
      box-shadow: var(--tgs-shadow-md);
    }
    .tgs-hero-img {
      position: absolute; inset: 0;
      width: 100%; height: 100%;
      object-fit: cover;
      transform: scale(1.01); /* hides hairline edge on scale */
    }
    .tgs-hero-scrim {
      position: absolute; inset: 0;
      background: linear-gradient(180deg, rgba(0,0,0,0) 30%, rgba(0,0,0,0.55) 85%, rgba(0,0,0,0.75) 100%);
    }
    .tgs-hero-content {
      position: absolute; left: 0; right: 0; bottom: 0;
      padding: 40px 48px;
      color: #fff;
    }
    .tgs-hero-eyebrow {
      display: inline-flex; align-items: center; gap: 6px;
      font-size: 11px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase;
      background: rgba(255,255,255,0.18);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      padding: 6px 12px; border-radius: 999px;
      margin-bottom: 16px;
    }
    .tgs-hero-title {
      margin: 0;
      font-size: clamp(40px, 6vw, 72px);
      font-weight: 700;
      letter-spacing: -0.025em;
      line-height: 1.02;
      text-shadow: 0 2px 24px rgba(0,0,0,0.4);
    }
    .tgs-hero-tagline {
      margin: 14px 0 0;
      font-size: clamp(16px, 1.6vw, 22px);
      font-weight: 400;
      color: rgba(255,255,255,0.92);
      max-width: 640px;
      line-height: 1.4;
      text-shadow: 0 1px 12px rgba(0,0,0,0.35);
    }
    .tgs-hero-attribution {
      position: absolute; right: 16px; bottom: 12px;
      font-size: 10px;
      color: rgba(255,255,255,0.65);
      letter-spacing: 0.02em;
      max-width: 60%;
      text-align: right;
      line-height: 1.3;
    }

    /* ─── SECTION FRAMING ─────────────────────────────── */
    .tgs-section { margin: 48px 0; }
    .tgs-section:first-child { margin-top: 0; }
    .tgs-section-hero { margin: 0 0 48px; }

    .tgs-section-head {
      display: flex; align-items: center; justify-content: space-between;
      gap: 16px; margin: 0 0 20px;
    }
    .tgs-section-title {
      margin: 0;
      font-size: 22px; font-weight: 700; letter-spacing: -0.015em;
      color: var(--tgs-text);
    }
    .tgs-section-sub {
      font-size: 13px; color: var(--tgs-sub); margin: 4px 0 0;
    }

    /* ─── UNIT TOGGLE (C/F in climate chart header) ──── */
    .tgs-climate-units {
      display: inline-flex; gap: 2px;
      padding: 3px;
      background: var(--tgs-border-soft);
      border-radius: 999px;
    }
    .tgs-climate-unit {
      border: 0; background: transparent;
      font: inherit; font-size: 12px; font-weight: 600;
      color: var(--tgs-sub);
      padding: 6px 12px;
      border-radius: 999px;
      cursor: pointer;
      min-width: 40px;
      transition: background 150ms ease, color 150ms ease, box-shadow 150ms ease;
      min-height: 28px;
    }
    .tgs-climate-unit:hover { color: var(--tgs-text); }
    .tgs-climate-unit[aria-pressed="true"] {
      background: var(--tgs-card);
      color: var(--tgs-text);
      box-shadow: 0 1px 2px rgba(15,23,42,0.08);
    }
    .tgs-root[data-theme="dark"] .tgs-climate-unit[aria-pressed="true"] {
      background: var(--tgs-bg);
      box-shadow: 0 1px 3px rgba(0,0,0,0.3);
    }

    /* ─── CLIMATE CHART ───────────────────────────────── */
    .tgs-climate {
      background: var(--tgs-card);
      border: 1px solid var(--tgs-border);
      border-radius: var(--tgs-radius);
      padding: 24px 28px;
    }
    .tgs-climate-topline {
      display: flex; align-items: center; justify-content: space-between;
      gap: 16px; flex-wrap: wrap;
      margin-bottom: 18px;
    }
    .tgs-climate-current-label {
      font-size: 12px; color: var(--tgs-sub);
    }
    .tgs-climate-current-label strong {
      color: var(--tgs-text);
      font-weight: 600;
    }
    .tgs-climate-callout {
      display: inline-flex; align-items: center; gap: 8px;
      background: var(--tgs-accent-soft);
      color: var(--tgs-accent);
      padding: 6px 12px; border-radius: 999px;
      font-size: 12px; font-weight: 600;
    }
    .tgs-climate-callout[data-theme-dark] { color: var(--tgs-accent); }
    .tgs-climate-chart {
      display: grid;
      grid-template-columns: repeat(12, 1fr);
      gap: 6px;
      align-items: end;
      height: 180px;
      margin: 0 0 6px;
    }
    .tgs-climate-col {
      position: relative;
      display: flex; flex-direction: column; align-items: center;
      height: 100%;
    }
    /* Current month — the "you are here" cue. */
    .tgs-climate-col[data-current="true"] .tgs-climate-bar {
      box-shadow: 0 0 0 2px var(--tgs-bg), 0 0 0 4px var(--tgs-text);
    }
    .tgs-climate-col[data-current="true"] .tgs-climate-temp {
      color: var(--tgs-text);
      font-weight: 700;
    }
    .tgs-climate-rain-cell[data-current="true"] {
      background: var(--tgs-text);
      opacity: 0.6;
    }
    .tgs-climate-month[data-current="true"] {
      color: var(--tgs-text);
      font-weight: 700;
    }
    .tgs-climate-bar {
      width: 100%;
      border-radius: 4px 4px 0 0;
      position: relative;
      transition: height 700ms cubic-bezier(.22,1,.36,1);
      background: var(--tgs-season-off);
    }
    .tgs-climate-bar[data-season="best"] { background: var(--tgs-season-best); }
    .tgs-climate-bar[data-season="shoulder"] { background: var(--tgs-season-shoulder); }
    .tgs-climate-bar[data-season="off"] { background: var(--tgs-season-off); }
    .tgs-climate-temp {
      font-size: 11px; font-weight: 600; color: var(--tgs-text);
      margin-bottom: 4px;
      white-space: nowrap;
    }
    .tgs-climate-rain {
      height: 36px;
      display: grid;
      grid-template-columns: repeat(12, 1fr);
      gap: 6px;
      margin: 8px 0 6px;
      align-items: end;
    }
    .tgs-climate-rain-cell {
      background: var(--tgs-rain);
      border-radius: 2px 2px 0 0;
      min-height: 2px;
    }
    .tgs-climate-months {
      display: grid;
      grid-template-columns: repeat(12, 1fr);
      gap: 6px;
      text-align: center;
    }
    .tgs-climate-month {
      font-size: 11px; font-weight: 500; color: var(--tgs-muted);
      letter-spacing: 0.04em;
    }
    .tgs-climate-legend {
      display: flex; gap: 18px; flex-wrap: wrap;
      margin-top: 18px;
      padding-top: 16px;
      border-top: 1px solid var(--tgs-border-soft);
      font-size: 12px; color: var(--tgs-sub);
    }
    .tgs-climate-legend-item { display: inline-flex; align-items: center; gap: 6px; }
    .tgs-climate-legend-swatch {
      width: 10px; height: 10px; border-radius: 2px;
    }
    .tgs-climate-sr-only {
      position: absolute;
      width: 1px; height: 1px;
      padding: 0; margin: -1px;
      overflow: hidden;
      clip: rect(0,0,0,0);
      white-space: nowrap;
      border: 0;
    }

    /* ─── QUICK FACTS ─────────────────────────────────── */
    .tgs-facts {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 16px;
    }
    .tgs-fact {
      display: flex;
      gap: 14px;
      align-items: flex-start;
      padding: 20px;
      background: var(--tgs-card);
      border: 1px solid var(--tgs-border);
      border-radius: var(--tgs-radius-sm);
    }
    .tgs-fact-icon {
      width: 40px; height: 40px;
      flex: 0 0 40px;
      border-radius: 10px;
      background: var(--tgs-brand-soft);
      color: var(--tgs-brand);
      display: flex; align-items: center; justify-content: center;
    }
    .tgs-fact-body { min-width: 0; flex: 1; }
    .tgs-fact-label {
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--tgs-muted);
      margin: 0 0 4px;
    }
    .tgs-fact-value {
      margin: 0;
      font-size: 15px; font-weight: 600; color: var(--tgs-text);
      line-height: 1.3;
      word-break: break-word;
    }

    /* ─── HIGHLIGHTS GRID ─────────────────────────────── */
    .tgs-highlights {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 20px;
    }
    .tgs-highlight {
      background: var(--tgs-card);
      border: 1px solid var(--tgs-border);
      border-radius: var(--tgs-radius);
      padding: 24px;
      transition: transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease;
      overflow: hidden;
      display: flex; flex-direction: column;
    }
    .tgs-highlight--has-media {
      padding: 0;
    }
    .tgs-highlight:hover {
      transform: translateY(-2px);
      box-shadow: var(--tgs-shadow-md);
      border-color: var(--tgs-brand);
    }
    .tgs-highlight-media {
      position: relative;
      width: 100%;
      aspect-ratio: 16 / 10;
      overflow: hidden;
      background: var(--tgs-border-soft);
    }
    .tgs-highlight-media img {
      width: 100%; height: 100%;
      object-fit: cover;
      display: block;
      transition: transform 400ms cubic-bezier(.22,1,.36,1);
    }
    .tgs-highlight--has-media:hover .tgs-highlight-media img {
      transform: scale(1.03);
    }
    .tgs-highlight-body {
      padding: 0;
      display: flex; flex-direction: column;
    }
    .tgs-highlight--has-media .tgs-highlight-body {
      padding: 20px 22px 22px;
      flex: 1;
    }
    .tgs-highlight-icon {
      width: 44px; height: 44px;
      border-radius: 12px;
      background: var(--tgs-brand-soft);
      color: var(--tgs-brand);
      display: flex; align-items: center; justify-content: center;
      margin-bottom: 14px;
      flex-shrink: 0;
    }
    .tgs-highlight-icon--inline {
      width: 32px; height: 32px;
      border-radius: 8px;
      margin-bottom: 10px;
    }
    .tgs-highlight-title {
      margin: 0 0 8px;
      font-size: 17px; font-weight: 600;
      color: var(--tgs-text);
      letter-spacing: -0.005em;
    }
    .tgs-highlight-desc {
      margin: 0;
      font-size: 14px; color: var(--tgs-sub);
      line-height: 1.55;
    }

    /* ─── BEST FOR TAGS ──────────────────────────────── */
    .tgs-tags {
      display: flex; flex-wrap: wrap; gap: 10px;
    }
    .tgs-tag {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 8px 14px;
      background: var(--tgs-card);
      border: 1px solid var(--tgs-border);
      border-radius: 999px;
      font-size: 13px; font-weight: 500;
      color: var(--tgs-text);
    }
    .tgs-tag svg { color: var(--tgs-accent); flex-shrink: 0; }

    /* ─── EVENTS ─────────────────────────────────────── */
    .tgs-events { display: flex; flex-direction: column; gap: 12px; }
    .tgs-event {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 20px;
      align-items: center;
      padding: 18px 20px;
      background: var(--tgs-card);
      border: 1px solid var(--tgs-border);
      border-radius: var(--tgs-radius-sm);
    }
    .tgs-event-month {
      font-size: 11px; font-weight: 700;
      letter-spacing: 0.1em;
      color: var(--tgs-brand);
      background: var(--tgs-brand-soft);
      padding: 8px 12px;
      border-radius: 8px;
      text-transform: uppercase;
      white-space: nowrap;
      min-width: 80px;
      text-align: center;
    }
    .tgs-event-body {}
    .tgs-event-name {
      margin: 0 0 4px;
      font-size: 15px; font-weight: 600;
      color: var(--tgs-text);
    }
    .tgs-event-desc {
      margin: 0;
      font-size: 13px; color: var(--tgs-sub);
      line-height: 1.5;
    }

    /* ─── CTA ────────────────────────────────────────── */
    .tgs-cta {
      background: var(--tgs-brand);
      color: #fff;
      border-radius: var(--tgs-radius);
      padding: 40px 48px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 24px;
      flex-wrap: wrap;
      box-shadow: var(--tgs-shadow-md);
    }
    .tgs-cta-body { flex: 1 1 300px; min-width: 0; }
    .tgs-cta-title {
      margin: 0 0 6px;
      font-size: clamp(20px, 2vw, 26px);
      font-weight: 600;
      color: #fff;
      letter-spacing: -0.015em;
      line-height: 1.25;
    }
    .tgs-cta-subtitle {
      margin: 0;
      font-size: 15px;
      color: rgba(255,255,255,0.8);
      line-height: 1.45;
    }
    .tgs-cta-btn {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 14px 24px;
      background: var(--tgs-accent);
      color: #fff;
      text-decoration: none;
      border-radius: 10px;
      font-size: 15px; font-weight: 600;
      transition: transform 150ms ease, box-shadow 150ms ease, background 150ms ease;
      min-height: 44px;
      white-space: nowrap;
      border: none;
      cursor: pointer;
    }
    .tgs-cta-btn:hover { transform: translateY(-1px); box-shadow: 0 8px 16px rgba(0,0,0,0.2); }
    .tgs-cta-btn:focus-visible { outline: 2px solid #fff; outline-offset: 3px; }

    /* ─── EMPTY / ERROR STATES ───────────────────────── */
    .tgs-notice {
      padding: 40px 28px;
      text-align: center;
      background: var(--tgs-card);
      border: 1px dashed var(--tgs-border);
      border-radius: var(--tgs-radius);
      color: var(--tgs-sub);
    }
    .tgs-notice-icon {
      width: 48px; height: 48px;
      border-radius: 50%;
      background: var(--tgs-brand-soft);
      color: var(--tgs-brand);
      display: inline-flex; align-items: center; justify-content: center;
      margin-bottom: 14px;
    }
    .tgs-notice-title {
      margin: 0 0 6px;
      font-size: 17px; font-weight: 600; color: var(--tgs-text);
    }
    .tgs-notice-body {
      margin: 0;
      font-size: 14px; color: var(--tgs-sub);
      max-width: 480px; margin-left: auto; margin-right: auto;
    }

    /* ─── LOADING SKELETON ───────────────────────────── */
    .tgs-skel-hero {
      width: 100%; aspect-ratio: 16 / 9;
      background: linear-gradient(90deg, var(--tgs-card) 0%, var(--tgs-border-soft) 50%, var(--tgs-card) 100%);
      background-size: 200% 100%;
      animation: tgs-shimmer 1.5s infinite;
      border-radius: var(--tgs-radius);
    }
    @keyframes tgs-shimmer {
      0% { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }

    /* ─── FOCUS ──────────────────────────────────────── */
    .tgs-root a:focus-visible,
    .tgs-root button:focus-visible {
      outline: 2px solid var(--tgs-accent);
      outline-offset: 3px;
      border-radius: 4px;
    }

    /* ─── RESPONSIVE ─────────────────────────────────── */
    @media (max-width: 1023px) {
      .tgs-hero-content { padding: 32px; }
      .tgs-highlights { grid-template-columns: repeat(2, 1fr); }
      .tgs-facts { grid-template-columns: repeat(3, 1fr); }
    }
    @media (max-width: 767px) {
      .tgs-hero { aspect-ratio: 4 / 3; }
      .tgs-hero-content { padding: 24px 20px; }
      .tgs-section { margin: 36px 0; }
      .tgs-section-hero { margin: 0 0 36px; }
      .tgs-section-head { flex-wrap: wrap; }
      .tgs-section-title { font-size: 20px; }
      .tgs-climate { padding: 18px; }
      .tgs-climate-topline { gap: 10px; }
      .tgs-climate-current-label { order: 2; }
      .tgs-climate-chart { height: 140px; }
      .tgs-climate-temp { font-size: 9px; }
      .tgs-climate-unit { padding: 5px 10px; min-width: 34px; font-size: 11px; }
      .tgs-highlights { grid-template-columns: 1fr; }
      .tgs-facts { grid-template-columns: repeat(2, 1fr); }
      .tgs-fact { padding: 16px; gap: 12px; }
      .tgs-fact-icon { width: 36px; height: 36px; flex-basis: 36px; border-radius: 8px; }
      .tgs-cta { padding: 28px; flex-direction: column; align-items: stretch; text-align: center; }
      .tgs-cta-btn { justify-content: center; }
      .tgs-event { grid-template-columns: 1fr; gap: 10px; }
      .tgs-event-month { justify-self: start; }
    }
    @media (max-width: 380px) {
      .tgs-hero-content { padding: 20px 16px; }
      .tgs-facts { grid-template-columns: 1fr; }
      .tgs-climate-chart { gap: 3px; height: 120px; }
      .tgs-climate-months, .tgs-climate-rain { gap: 3px; }
      .tgs-climate-temp { font-size: 8px; }
    }

    @media (prefers-reduced-motion: reduce) {
      .tgs-root *, .tgs-root *::before, .tgs-root *::after {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.01ms !important;
      }
      .tgs-highlight:hover { transform: none; }
    }
  `;

  /* ------------------------------------------------------------------
   * Climate chart helpers
   * ------------------------------------------------------------------ */

  // Given the season array, return a human-readable best-time phrase.
  // "May to September" if those months are contiguously 'best', or
  // "May, July, August" if fragmented, or null if no 'best' months.
  function formatBestMonths(seasonArr) {
    if (!Array.isArray(seasonArr) || seasonArr.length !== 12) return null;
    const bestIndexes = [];
    seasonArr.forEach((s, i) => { if (s === 'best') bestIndexes.push(i); });
    if (bestIndexes.length === 0) return null;

    // Group into runs
    const runs = [];
    let run = [bestIndexes[0]];
    for (let i = 1; i < bestIndexes.length; i++) {
      if (bestIndexes[i] === bestIndexes[i - 1] + 1) run.push(bestIndexes[i]);
      else { runs.push(run); run = [bestIndexes[i]]; }
    }
    runs.push(run);

    // Also consider wrap-around (e.g. Nov, Dec, Jan, Feb)
    if (runs.length >= 2 && runs[0][0] === 0 && runs[runs.length - 1][runs[runs.length - 1].length - 1] === 11) {
      const last = runs.pop();
      runs[0] = last.concat(runs[0]);
    }

    return runs.map(r => {
      if (r.length === 1) return MONTH_NAMES_FULL[r[0]];
      return MONTH_NAMES_FULL[r[0]] + ' to ' + MONTH_NAMES_FULL[r[r.length - 1]];
    }).join(', ');
  }

  // Build a screen-reader description of the whole climate chart.
  function climateSrDescription(name, temps, season) {
    if (!Array.isArray(temps) || temps.length !== 12) return '';
    const parts = temps.map((t, i) => {
      const s = season[i] || 'unknown';
      return MONTH_NAMES_FULL[i] + ' ' + t + '°C (' + (s === 'best' ? 'best season' : s === 'shoulder' ? 'shoulder season' : 'off season') + ')';
    });
    return 'Average daytime temperatures for ' + name + ', January through December: ' + parts.join(', ') + '.';
  }

  /* ------------------------------------------------------------------
   * Main widget class
   * ------------------------------------------------------------------ */
  class TGSpotlightWidget {
    constructor(container, config) {
      if (!container) throw new Error('TGSpotlightWidget: container required');
      this.el = container;
      this.c = this._defaults(config);
      this.shadow = container.attachShadow ? container.attachShadow({ mode: 'open' }) : container;
      this._renderShell();

      // If inline destinationData was supplied, use it immediately.
      // Otherwise, fetch live from the content API.
      if (this.c.destinationData && typeof this.c.destinationData === 'object') {
        this._destination = this.c.destinationData;
        this._renderContent();
      } else if (this.c.widgetId) {
        this._loadDestination();
      } else {
        this._renderNotFound();
      }

      container.setAttribute('data-tg-initialised', 'true');
    }

    _defaults(c) {
      const base = {
        widgetId: null,
        theme: 'light',          // 'light' | 'dark'
        brandColor: '#1B2B5B',
        accentColor: '#00B4D8',
        radius: 16,
        fontFamily: '',          // optional override
        temperatureUnit: 'C',    // 'C' | 'F' — default for climate chart; readers can flip
        sections: {
          hero: true, climate: true, facts: true, highlights: true,
          tags: true, events: true, cta: true,
        },
        showAttribution: true,
        showBestTimeCallout: true,
        eventsHeading: "What's on",
        highlightsHeading: 'Highlights',
        tagsHeading: 'Best for',
        climateHeading: 'Climate',
        factsHeading: 'At a glance',
        cta: {
          title: 'Speak to our destination specialist',
          subtitle: '',
          buttonLabel: 'Start your enquiry',
          url: '',
        },
        destination: null,       // {level, recordId}
        destinationData: null,   // optional inline preview payload
      };
      if (!c || typeof c !== 'object') return base;
      const merged = Object.assign({}, base, c);
      merged.sections = Object.assign({}, base.sections, c.sections || {});
      merged.cta = Object.assign({}, base.cta, c.cta || {});
      return merged;
    }

    _renderShell() {
      // Clear any previous content
      while (this.shadow.firstChild) this.shadow.removeChild(this.shadow.firstChild);

      const style = document.createElement('style');
      style.textContent = STYLES;
      this.shadow.appendChild(style);

      this.root = document.createElement('div');
      this.root.className = 'tgs-root';
      this.root.setAttribute('data-theme', this.c.theme === 'dark' ? 'dark' : 'light');
      this._applyThemeVars();
      this.root.innerHTML =
        '<div class="tgs-loading">' +
        '<div class="tgs-skel-hero"></div>' +
        '</div>';
      this.shadow.appendChild(this.root);
    }

    _applyThemeVars() {
      const r = this.root;
      if (!r) return;
      // Client-configurable
      if (this.c.brandColor) r.style.setProperty('--tgs-brand', this.c.brandColor);
      if (this.c.accentColor) r.style.setProperty('--tgs-accent', this.c.accentColor);
      if (this.c.radius != null) {
        const n = Math.max(0, Math.min(24, parseInt(this.c.radius, 10) || 16));
        r.style.setProperty('--tgs-radius', n + 'px');
        r.style.setProperty('--tgs-radius-sm', Math.max(4, n - 6) + 'px');
      }
      if (this.c.accentColor) {
        // Derive soft tints
        r.style.setProperty('--tgs-accent-soft', hexToRgba(this.c.accentColor, 0.14));
        r.style.setProperty('--tgs-season-best', this.c.accentColor);
      }
      if (this.c.brandColor) {
        r.style.setProperty('--tgs-brand-soft', hexToRgba(this.c.brandColor, 0.10));
      }
      if (this.c.fontFamily) {
        r.style.fontFamily = this.c.fontFamily + ", 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
      }
    }

    async _loadDestination() {
      try {
        const url = CONTENT_API + '?id=' + encodeURIComponent(this.c.widgetId);
        const res = await fetch(url, { credentials: 'omit' });
        if (!res.ok) {
          if (res.status === 404) return this._renderNotFound();
          throw new Error('Content fetch failed (' + res.status + ')');
        }
        this._destination = await res.json();
        this._renderContent();
      } catch (err) {
        console.error('[TG Spotlight] Failed to load destination:', err);
        this._renderError();
      }
    }

    _renderContent() {
      const d = this._destination;
      if (!d || !d.name) return this._renderNotFound();

      const s = this.c.sections;
      const html = [];

      // Section order (v1.1): hero → tags → climate → facts → highlights → events → cta
      // Tags moved up because they're the most scannable "at a glance" read for agents' visitors.
      if (s.hero) html.push(this._renderHero(d));
      if (s.tags) html.push(this._renderTags(d));
      if (s.climate) html.push(this._renderClimate(d));
      if (s.facts) html.push(this._renderFacts(d));
      if (s.highlights) html.push(this._renderHighlights(d));
      if (s.events) html.push(this._renderEvents(d));
      if (s.cta) html.push(this._renderCta());

      this.root.innerHTML = html.filter(Boolean).join('');
      this._bind();
    }

    _renderHero(d) {
      if (!d.name) return '';
      const imgUrl = (d.images && d.images[0]) ? safeUrl(d.images[0]) : '';
      const attribution = (this.c.showAttribution && d.attributions && d.attributions[0])
        ? esc(d.attributions[0]) : '';
      const tagline = d.tagline || d.heroIntro || '';
      const levelLabel = d.level === 'country' ? 'Country' : d.level === 'city' ? 'City / Region' : 'Resort';
      // Compose eyebrow: if a Region is set on the destination, show "Country · Region".
      // The middle dot is the standard editorial separator used elsewhere in the brand.
      const eyebrowText = d.region ? levelLabel + ' · ' + d.region : levelLabel;
      const altText = d.name + (d.tagline ? ' — ' + d.tagline : '');

      return (
        '<section class="tgs-section tgs-section-hero" aria-labelledby="tgs-hero-title">' +
          '<div class="tgs-hero">' +
            (imgUrl
              ? '<img class="tgs-hero-img" src="' + esc(imgUrl) + '" alt="' + esc(altText) + '" loading="eager" />'
              : '<div class="tgs-hero-img" style="background:linear-gradient(135deg,var(--tgs-brand),var(--tgs-accent));"></div>') +
            '<div class="tgs-hero-scrim" aria-hidden="true"></div>' +
            '<div class="tgs-hero-content">' +
              '<span class="tgs-hero-eyebrow">' + esc(eyebrowText) + '</span>' +
              '<h1 class="tgs-hero-title" id="tgs-hero-title">' + esc(d.name) + '</h1>' +
              (tagline ? '<p class="tgs-hero-tagline">' + esc(tagline) + '</p>' : '') +
            '</div>' +
            (attribution ? '<div class="tgs-hero-attribution">' + attribution + '</div>' : '') +
          '</div>' +
        '</section>'
      );
    }

    _renderClimate(d) {
      const temps = d.climate && d.climate.temps;
      const rain = d.climate && d.climate.rainfall;
      const season = d.climate && d.climate.season;
      if (!Array.isArray(temps) || temps.length !== 12) return '';
      if (!Array.isArray(season) || season.length !== 12) return '';

      // Current month — used to highlight the "you are here" column.
      const currentMonth = new Date().getMonth(); // 0-11

      // Unit — defaults to what the widget config says, but readers can flip
      // via the toggle. We store the chosen unit on the widget instance so
      // subsequent re-renders preserve it.
      if (!this._tempUnit) this._tempUnit = this.c.temperatureUnit === 'F' ? 'F' : 'C';
      const unit = this._tempUnit;
      const conv = (c) => unit === 'F' ? Math.round(c * 9 / 5 + 32) : c;

      const displayTemps = temps.map(conv);
      const maxDisplay = Math.max.apply(null, displayTemps.filter(n => typeof n === 'number'));
      const minTempForScaling = unit === 'F' ? 32 : 0; // scale bars from a sensible baseline
      const range = Math.max(maxDisplay - minTempForScaling, 1);

      const maxRain = Array.isArray(rain) ? Math.max.apply(null, rain.filter(n => typeof n === 'number')) || 1 : 1;

      const bars = displayTemps.map((t, i) => {
        const h = Math.max(6, Math.round(((t - minTempForScaling) / range) * 100));
        const s = season[i] || 'off';
        const isCurrent = i === currentMonth;
        const currentAttr = isCurrent ? ' data-current="true"' : '';
        return (
          '<div class="tgs-climate-col"' + currentAttr + '>' +
            '<span class="tgs-climate-temp">' + t + '°</span>' +
            '<div class="tgs-climate-bar" data-season="' + esc(s) + '" style="height:' + h + '%;" aria-hidden="true"></div>' +
          '</div>'
        );
      }).join('');

      const rainCells = Array.isArray(rain) && rain.length === 12 ? rain.map((r, i) => {
        const h = Math.max(2, Math.round((r / maxRain) * 100));
        const currentAttr = i === currentMonth ? ' data-current="true"' : '';
        return '<div class="tgs-climate-rain-cell"' + currentAttr + ' style="height:' + h + '%;" aria-hidden="true"></div>';
      }).join('') : '';

      const months = MONTH_LABELS.map((m, i) => {
        const isCurrent = i === currentMonth;
        return '<span class="tgs-climate-month"' + (isCurrent ? ' data-current="true"' : '') + '>' + esc(m) + '</span>';
      }).join('');

      const bestPhrase = formatBestMonths(season);
      const callout = (this.c.showBestTimeCallout && bestPhrase)
        ? '<div class="tgs-climate-callout">' + icon('sun', 14) + '<span>Best time to visit: ' + esc(bestPhrase) + '</span></div>'
        : '';

      // Unit toggle — renders two pill buttons. The bind step attaches listeners.
      const unitToggle = (
        '<div class="tgs-climate-units" role="group" aria-label="Temperature units">' +
          '<button type="button" class="tgs-climate-unit" data-unit="C" aria-pressed="' + (unit === 'C' ? 'true' : 'false') + '">°C</button>' +
          '<button type="button" class="tgs-climate-unit" data-unit="F" aria-pressed="' + (unit === 'F' ? 'true' : 'false') + '">°F</button>' +
        '</div>'
      );

      const srDesc = climateSrDescription(d.name || 'this destination', temps, season);
      const currentLabel = MONTH_NAMES_FULL[currentMonth];

      return (
        '<section class="tgs-section" aria-labelledby="tgs-climate-heading">' +
          '<div class="tgs-section-head">' +
            '<h2 class="tgs-section-title" id="tgs-climate-heading">' + esc(this.c.climateHeading) + '</h2>' +
            unitToggle +
          '</div>' +
          '<div class="tgs-climate">' +
            '<div class="tgs-climate-topline">' +
              callout +
              '<span class="tgs-climate-current-label" aria-hidden="true">You are here: <strong>' + esc(currentLabel) + '</strong></span>' +
            '</div>' +
            '<p class="tgs-climate-sr-only">' + esc(srDesc) + '</p>' +
            '<div class="tgs-climate-chart" role="img" aria-label="' + esc(srDesc) + '">' + bars + '</div>' +
            (rainCells ? '<div class="tgs-climate-rain" aria-hidden="true">' + rainCells + '</div>' : '') +
            '<div class="tgs-climate-months" aria-hidden="true">' + months + '</div>' +
            '<div class="tgs-climate-legend" aria-hidden="true">' +
              '<span class="tgs-climate-legend-item"><span class="tgs-climate-legend-swatch" style="background:var(--tgs-season-best);"></span>Best season</span>' +
              '<span class="tgs-climate-legend-item"><span class="tgs-climate-legend-swatch" style="background:var(--tgs-season-shoulder);"></span>Shoulder</span>' +
              '<span class="tgs-climate-legend-item"><span class="tgs-climate-legend-swatch" style="background:var(--tgs-season-off);"></span>Off season</span>' +
              (rainCells ? '<span class="tgs-climate-legend-item"><span class="tgs-climate-legend-swatch" style="background:var(--tgs-rain);"></span>Rainfall</span>' : '') +
            '</div>' +
          '</div>' +
        '</section>'
      );
    }

    _renderFacts(d) {
      const f = d.facts || {};
      const items = [
        { kind: 'flight',   label: 'Flight from UK', value: f.flightTime },
        { kind: 'timezone', label: 'Time zone',      value: f.timeZone },
        { kind: 'currency', label: 'Currency',       value: f.currency },
        { kind: 'language', label: 'Language',       value: f.language },
        { kind: 'voltage',  label: 'Electricity',    value: f.voltage },
      ].filter(it => it.value && String(it.value).trim());

      if (items.length === 0) return '';

      const cards = items.map(it => (
        '<div class="tgs-fact">' +
          '<div class="tgs-fact-icon">' + icon(factIcon(it.kind), 20) + '</div>' +
          '<div class="tgs-fact-body">' +
            '<div class="tgs-fact-label">' + esc(it.label) + '</div>' +
            '<p class="tgs-fact-value">' + esc(it.value) + '</p>' +
          '</div>' +
        '</div>'
      )).join('');

      return (
        '<section class="tgs-section" aria-labelledby="tgs-facts-heading">' +
          '<div class="tgs-section-head">' +
            '<h2 class="tgs-section-title" id="tgs-facts-heading">' + esc(this.c.factsHeading) + '</h2>' +
          '</div>' +
          '<div class="tgs-facts">' + cards + '</div>' +
        '</section>'
      );
    }

    _renderHighlights(d) {
      const list = Array.isArray(d.highlights) ? d.highlights : [];
      if (list.length === 0) return '';

      // The first image in d.images is the hero — subsequent images (if any)
      // are used as thumbnails on highlight cards 1, 2, 3... in order.
      // If we run out of images, remaining cards fall back to icon-only.
      const thumbs = Array.isArray(d.images) ? d.images.slice(1) : [];

      const cards = list.slice(0, 6).map((h, i) => {
        if (!h || !h.title) return '';
        const thumbUrl = thumbs[i] ? safeUrl(thumbs[i]) : '';
        const mediaBlock = thumbUrl
          ? '<div class="tgs-highlight-media"><img src="' + esc(thumbUrl) + '" alt="" loading="lazy" /></div>'
          : '<div class="tgs-highlight-icon">' + icon(h.icon || 'star', 22) + '</div>';
        return (
          '<article class="tgs-highlight' + (thumbUrl ? ' tgs-highlight--has-media' : '') + '">' +
            mediaBlock +
            '<div class="tgs-highlight-body">' +
              (thumbUrl ? '<div class="tgs-highlight-icon tgs-highlight-icon--inline">' + icon(h.icon || 'star', 18) + '</div>' : '') +
              '<h3 class="tgs-highlight-title">' + esc(h.title) + '</h3>' +
              (h.description ? '<p class="tgs-highlight-desc">' + esc(h.description) + '</p>' : '') +
            '</div>' +
          '</article>'
        );
      }).join('');

      return (
        '<section class="tgs-section" aria-labelledby="tgs-highlights-heading">' +
          '<div class="tgs-section-head">' +
            '<h2 class="tgs-section-title" id="tgs-highlights-heading">' + esc(this.c.highlightsHeading) + '</h2>' +
          '</div>' +
          '<div class="tgs-highlights">' + cards + '</div>' +
        '</section>'
      );
    }

    _renderTags(d) {
      const tags = Array.isArray(d.bestForTags) ? d.bestForTags : [];
      if (tags.length === 0) return '';

      const pills = tags.map(t => {
        const iconName = TAG_ICONS[t] || 'star';
        return (
          '<span class="tgs-tag">' +
            icon(iconName, 14) +
            '<span>' + esc(t) + '</span>' +
          '</span>'
        );
      }).join('');

      return (
        '<section class="tgs-section" aria-labelledby="tgs-tags-heading">' +
          '<div class="tgs-section-head">' +
            '<h2 class="tgs-section-title" id="tgs-tags-heading">' + esc(this.c.tagsHeading) + '</h2>' +
          '</div>' +
          '<div class="tgs-tags">' + pills + '</div>' +
        '</section>'
      );
    }

    _renderEvents(d) {
      const events = Array.isArray(d.events) ? d.events : [];
      if (events.length === 0) return '';

      const rows = events.slice(0, 6).map(e => {
        if (!e || !e.name) return '';
        return (
          '<div class="tgs-event">' +
            '<div class="tgs-event-month">' + esc(e.month || '—') + '</div>' +
            '<div class="tgs-event-body">' +
              '<h3 class="tgs-event-name">' + esc(e.name) + '</h3>' +
              (e.description ? '<p class="tgs-event-desc">' + esc(e.description) + '</p>' : '') +
            '</div>' +
          '</div>'
        );
      }).join('');

      return (
        '<section class="tgs-section" aria-labelledby="tgs-events-heading">' +
          '<div class="tgs-section-head">' +
            '<h2 class="tgs-section-title" id="tgs-events-heading">' + esc(this.c.eventsHeading) + '</h2>' +
          '</div>' +
          '<div class="tgs-events">' + rows + '</div>' +
        '</section>'
      );
    }

    _renderCta() {
      const cta = this.c.cta || {};
      const url = safeUrl(cta.url, true);
      // Even without a URL, we still render the CTA panel — but as a no-op
      // visually-complete block. An editor preview with no URL yet is still
      // useful.
      const buttonHtml = url
        ? '<a class="tgs-cta-btn" href="' + esc(url) + '" rel="noopener">' + esc(cta.buttonLabel || 'Enquire') + icon('arrow', 16) + '</a>'
        : '<button class="tgs-cta-btn" type="button" disabled aria-disabled="true" style="opacity:0.8;cursor:not-allowed;">' + esc(cta.buttonLabel || 'Enquire') + icon('arrow', 16) + '</button>';

      return (
        '<section class="tgs-section" aria-labelledby="tgs-cta-heading">' +
          '<div class="tgs-cta">' +
            '<div class="tgs-cta-body">' +
              '<h2 class="tgs-cta-title" id="tgs-cta-heading">' + esc(cta.title || '') + '</h2>' +
              (cta.subtitle ? '<p class="tgs-cta-subtitle">' + esc(cta.subtitle) + '</p>' : '') +
            '</div>' +
            buttonHtml +
          '</div>' +
        '</section>'
      );
    }

    _renderNotFound() {
      this.root.innerHTML =
        '<div class="tgs-notice">' +
          '<div class="tgs-notice-icon">' + icon('info', 22) + '</div>' +
          '<h2 class="tgs-notice-title">Destination not found</h2>' +
          '<p class="tgs-notice-body">Please check the page configuration. This widget is looking for a destination that does not exist in the content database yet.</p>' +
        '</div>';
    }

    _renderError() {
      this.root.innerHTML =
        '<div class="tgs-notice">' +
          '<div class="tgs-notice-icon">' + icon('alert', 22) + '</div>' +
          '<h2 class="tgs-notice-title">Unable to load destination</h2>' +
          '<p class="tgs-notice-body">The destination content is temporarily unavailable. Please try again in a moment.</p>' +
        '</div>';
    }

    // Wire up interactive controls inside the Shadow DOM. Called after every
    // _renderContent so listeners attach to the fresh markup.
    _bind() {
      const r = this.root;
      if (!r) return;
      // Temperature unit toggle in the climate chart header
      const unitBtns = r.querySelectorAll('.tgs-climate-unit');
      unitBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          const unit = btn.getAttribute('data-unit');
          if (!unit || unit === this._tempUnit) return;
          this._tempUnit = unit;
          // Only re-render content (not shell) so fonts/theme stay stable
          this._renderContent();
        });
      });
    }

    // Public API
    update(newConfig) {
      this.c = this._defaults(Object.assign({}, this.c, newConfig));
      this._renderShell();
      if (this.c.destinationData) {
        this._destination = this.c.destinationData;
        this._renderContent();
      } else if (this.c.widgetId) {
        this._loadDestination();
      } else if (this._destination) {
        this._renderContent();
      } else {
        this._renderNotFound();
      }
    }

    destroy() {
      try { while (this.shadow.firstChild) this.shadow.removeChild(this.shadow.firstChild); } catch (e) { /* noop */ }
      this.el.removeAttribute('data-tg-initialised');
      this.el.__tgSpotlight = null;
    }
  }

  /* ------------------------------------------------------------------
   * hex → rgba helper for deriving tints.
   * Accepts 3 or 6 digit hex; returns fallback if invalid.
   * ------------------------------------------------------------------ */
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

  /* ------------------------------------------------------------------
   * Auto-initialiser
   * ------------------------------------------------------------------ */
  async function init() {
    const containers = document.querySelectorAll('[data-tg-widget="spotlight"]:not([data-tg-initialised])');
    for (const el of containers) {
      try {
        // Inline config takes priority
        const inline = el.getAttribute('data-tg-config');
        if (inline) {
          let cfg = {};
          try { cfg = JSON.parse(inline); } catch { cfg = {}; }
          const w = new TGSpotlightWidget(el, cfg);
          el.__tgSpotlight = w;
          continue;
        }

        const id = el.getAttribute('data-tg-id');
        if (id) {
          // Fetch the widget config from /api/widget-config then hand that
          // config (plus the widgetId) to the widget. The widget will then
          // fetch the live destination content separately.
          const res = await fetch(API_BASE + '?id=' + encodeURIComponent(id), {
            credentials: 'omit'
          });
          if (!res.ok) throw new Error('Widget config fetch failed (' + res.status + ')');
          const data = await res.json();
          const cfg = data && (data.config || data);
          cfg.widgetId = id;
          const w = new TGSpotlightWidget(el, cfg);
          el.__tgSpotlight = w;
          continue;
        }
        console.warn('[TG Spotlight] Container has neither data-tg-id nor data-tg-config');
      } catch (err) {
        console.error('[TG Spotlight] Failed to initialise:', err);
        try {
          el.innerHTML = '<p style="color:#64748b;font:14px/1.5 -apple-system,sans-serif;padding:16px;text-align:center;border:1px dashed #e2e8f0;border-radius:8px;margin:0">Unable to load Destination Spotlight widget</p>';
        } catch (e) { /* noop */ }
      }
    }
  }

  // Expose globally
  if (typeof window !== 'undefined') {
    window.TGSpotlightWidget = TGSpotlightWidget;
    window.__TG_SPOTLIGHT_VERSION__ = VERSION;
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
    // Re-init when new widget nodes are added (common with dynamic page builders like Duda).
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
              if (node.matches && node.matches('[data-tg-widget="spotlight"]:not([data-tg-initialised])')) {
                scheduleInit(); return;
              }
              if (node.querySelector && node.querySelector('[data-tg-widget="spotlight"]:not([data-tg-initialised])')) {
                scheduleInit(); return;
              }
            }
          }
        });
        mo.observe(document.body || document.documentElement, { childList: true, subtree: true });
      } catch (e) { /* noop */ }
    }
  }
})();
