/**
 * Travelgenix Airport Spotlight Widget v1.0.0
 * Self-contained, embeddable airport information showcase.
 * Zero hard dependencies (Leaflet loaded on-demand for the map only,
 * with SRI-pinned hashes from unpkg).
 * Shadow DOM isolation. Works on any website via a single script tag.
 *
 * Data is fetched live at render-time from the Travelgenix Destination
 * Content database via /api/airport-content — never snapshotted into config.
 *
 * Role-aware single widget. Behaviour adapts to the Airport record's role:
 *   - 'origin'      → Serves strip hidden, city pin on map, commuter tabs,
 *                     "Search flights" CTA
 *   - 'destination' → Serves strip shown, multi-resort pins on map,
 *                     traveller-side tabs, "Browse resorts" CTA
 *   - 'both'        → Both sets rendered; Serves strip shows if linked
 *                     resorts present
 *
 * Render order, each individually toggleable via config.sections:
 *   hero · serves · facts · overview · terminals · located · facilities
 *   · arrival · tips · cta
 *
 * Usage (remote config, default):
 *   <div data-tg-widget="airport" data-tg-id="YOUR_WIDGET_ID"></div>
 *   <script src="https://tg-widgets.vercel.app/widget-airport.js"></script>
 *
 * Usage (inline config, editor preview):
 *   <div data-tg-widget="airport" data-tg-config='{...}'></div>
 *   <script src="https://tg-widgets.vercel.app/widget-airport.js"></script>
 */
(function () {
  'use strict';

    /**
   * Resolve the API base URL.
   *
   * BACKGROUND: This widget script is hosted on widgets.travelify.io and
   * embedded on customer sites. The widget must call back to its host
   * (widgets.travelify.io/api/widget-config) — NOT to the customer's
   * site. A relative '/api/...' URL resolves to the customer's origin
   * and 404s.
   *
   * Resolution order:
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
        if (/\/widget\-airport\.js(\?|$|#)/.test(s)) {
          return new URL(s).origin + '/api/widget-config';
        }
      }
    } catch (e) { /* fall through */ }
    return '/api/widget-config';
  }

  const API_BASE = resolveApiBase();
  const CONTENT_API = (function () {
    /* Resolve the CONTENT_API URL. Yesterday's fix patched widget-config but this
       secondary API was left with a relative default ('/api/airport-content'), which
       on customer sites resolves to the customer's domain and 404s. Same
       resolution strategy as the API_BASE resolver above. */
    if (typeof window === 'undefined') return '/api/airport-content';
    if (window.__TG_AIRPORT_CONTENT_API__) return window.__TG_AIRPORT_CONTENT_API__;
    try {
      var me = document.currentScript;
      if (me && me.src) return new URL(me.src).origin + '/api/airport-content';
      var scripts = document.getElementsByTagName('script');
      for (var i = scripts.length - 1; i >= 0; i--) {
        var s = scripts[i].src || '';
        if (/\/widget\-airport\.js(\?|$|#)/.test(s)) {
          return new URL(s).origin + '/api/airport-content';
        }
      }
    } catch (e) { /* fall through */ }
    return '/api/airport-content';
  })();
  const VERSION = '1.0.0';

  const LEAFLET_JS  = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
  const LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
  const LEAFLET_JS_SRI  = 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';
  const LEAFLET_CSS_SRI = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=';

  /* ===== Icons (Lucide-style inline SVG paths) ===================== */
  const IC = {
    plane:    '<path d="M17.8 19.2 16 11l3.5-3.5c.5-.5 1-2.5.5-3-1-.5-3 0-3.5.5L13 8.5 4.8 6.5c-.5-.1-.9.2-.9.7v.4c0 .3.2.6.5.8L8 10.5 6 14H3l-.5 1.5L5 17l1.5 2.5L8 19v-3l3.5-2 2.8 3.5c.2.3.5.5.8.5h.4c.5 0 .8-.4.7-.9z"/>',
    clock:    '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    pin:      '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
    building: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M12 6h.01"/><path d="M16 6h.01"/><path d="M8 10h.01"/><path d="M12 10h.01"/><path d="M16 10h.01"/>',
    luggage:  '<rect x="3" y="11" width="18" height="11" rx="2"/><circle cx="12" cy="16" r="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    map:      '<path d="M9 3 4 5v16l5-2 6 2 5-2V3l-5 2-6-2z"/><path d="M9 3v16"/><path d="M15 5v16"/>',
    compass:  '<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>',
    car:      '<path d="M14 16H9m10 0h3v-3.15a1 1 0 0 0-.84-.99L16 11l-2.7-3.6a1 1 0 0 0-.8-.4H5.24a2 2 0 0 0-1.8 1.1l-.8 1.63A6 6 0 0 0 2 12.42V16h2"/><circle cx="6.5" cy="16.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/>',
    taxi:     '<path d="M10 2h4"/><path d="m5 7 1-3h12l1 3"/><path d="M5 7h14v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7Z"/><circle cx="8.5" cy="14.5" r="1.5"/><circle cx="15.5" cy="14.5" r="1.5"/>',
    train:    '<rect x="4" y="3" width="16" height="16" rx="2"/><path d="M4 11h16"/><path d="M12 3v8"/><circle cx="8" cy="15" r="1"/><circle cx="16" cy="15" r="1"/><path d="m8 19-2 3"/><path d="m18 22-2-3"/>',
    coach:    '<path d="M8 6h8"/><path d="M8 10h8"/><rect x="4" y="3" width="16" height="14" rx="2"/><circle cx="8" cy="19" r="2"/><circle cx="16" cy="19" r="2"/>',
    parking:  '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 17V7h4a3 3 0 0 1 0 6H9"/>',
    transfer: '<path d="M8 6v6"/><path d="M16 6v6"/><circle cx="8" cy="18" r="2"/><circle cx="16" cy="18" r="2"/><path d="M6 4h12l1 2v8l-1 2H6l-1-2V6z"/>',
    lounge:   '<path d="M3 11h18"/><path d="M12 11V3"/><path d="M8 11V3"/><path d="M16 11V3"/><path d="M5 11v5a7 7 0 0 0 14 0v-5"/>',
    family:   '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7z"/>',
    assist:   '<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
    info:     '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    alert:    '<path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    arrow:    '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    arrow_out:'<path d="M7 7h10v10"/><path d="M7 17 17 7"/>',
    check:    '<path d="M20 6 9 17l-5-5"/>',
    star:     '<path d="M11.48 3.5a.55.55 0 0 1 1 0l2.14 6.58h6.92a.55.55 0 0 1 .32.99l-5.6 4.07 2.14 6.58a.55.55 0 0 1-.85.61L12 17.27l-5.6 4.06a.55.55 0 0 1-.85-.61l2.14-6.58-5.6-4.07a.55.55 0 0 1 .32-.99h6.92z"/>',
    speed:    '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  };

  function icon(name, size) {
    const path = IC[name] || IC.info;
    const s = size || 18;
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + s + '" height="' + s +
      '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"' +
      ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + path + '</svg>';
  }

  /* ===== Safety helpers ============================================ */
  function esc(str) {
    if (str == null) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function safeUrl(url, allowMailtoTel) {
    if (typeof url !== 'string') return '';
    const trimmed = url.trim();
    if (!trimmed) return '';
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    if (allowMailtoTel && /^(mailto|tel):/i.test(trimmed)) return trimmed;
    if (/^\/[^/]/.test(trimmed)) return trimmed;
    return '';
  }

  function safeIata(code) {
    if (typeof code !== 'string') return '';
    const t = code.trim().toUpperCase();
    return /^[A-Z]{3}$/.test(t) ? t : '';
  }

  function normaliseRole(role) {
    if (typeof role !== 'string') return 'origin';
    const r = role.trim().toLowerCase();
    if (r === 'destination') return 'destination';
    if (r === 'both') return 'both';
    return 'origin';
  }

  function safeLatLng(lat, lng) {
    // Reject null/undefined/empty explicitly — Number(null) is 0, which is
    // finite and in-range, so without this check we'd silently render a pin
    // at (0, 0) in the Gulf of Guinea whenever cityLat/cityLng are missing.
    if (lat == null || lng == null || lat === '' || lng === '') return null;
    const a = Number(lat), b = Number(lng);
    if (!isFinite(a) || !isFinite(b)) return null;
    if (a === 0 && b === 0) return null;
    if (a < -90 || a > 90 || b < -180 || b > 180) return null;
    return [a, b];
  }

  function fmtMinutes(mins) {
    const n = Number(mins);
    if (!isFinite(n) || n <= 0) return '';
    if (n < 60) return n + ' min';
    const h = Math.floor(n / 60), m = n % 60;
    return m ? h + 'h ' + m + 'm' : h + 'h';
  }

  // Pull a tile-sized headline out of multilineText: first sentence if short
  // enough, otherwise hard-truncate to the char limit + ellipsis. Used for
  // facts grid where each cell only has ~25% width.
  function firstSentence(text, max) {
    const s = String(text || '').trim();
    if (!s) return '';
    const dot = s.search(/[.!?](\s|$)/);
    const candidate = (dot > 0 && dot < (max || 80)) ? s.slice(0, dot + 1) : s;
    if (candidate.length <= (max || 80)) return candidate;
    return s.slice(0, (max || 80) - 1).trimEnd() + '…';
  }

  function fmtCoords(lat, lng) {
    return lat.toFixed(4) + '&deg; ' + (lat >= 0 ? 'N' : 'S') + ', ' +
      Math.abs(lng).toFixed(4) + '&deg; ' + (lng >= 0 ? 'E' : 'W');
  }

  function renderTemplate(str, vars) {
    if (typeof str !== 'string' || !str) return '';
    if (!vars || typeof vars !== 'object') return str;
    return str.replace(/\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g, (_, key) => {
      const v = vars[key];
      return (v == null) ? '' : String(v);
    }).replace(/\s{2,}/g, ' ').trim();
  }

  /* ===== Leaflet loader ============================================ */
  let _leafletPromise = null;
  function loadLeaflet() {
    if (window.L && window.L.map) return Promise.resolve(window.L);
    if (_leafletPromise) return _leafletPromise;
    _leafletPromise = new Promise((resolve, reject) => {
      if (!document.querySelector('link[data-tga-leaflet]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = LEAFLET_CSS;
        link.integrity = LEAFLET_CSS_SRI;
        link.crossOrigin = '';
        link.setAttribute('data-tga-leaflet', '1');
        document.head.appendChild(link);
      }
      const s = document.createElement('script');
      s.src = LEAFLET_JS;
      s.integrity = LEAFLET_JS_SRI;
      s.crossOrigin = '';
      s.async = true;
      s.onload = () => resolve(window.L);
      s.onerror = () => reject(new Error('Failed to load Leaflet'));
      document.head.appendChild(s);
    });
    return _leafletPromise;
  }

  /* ===== STYLES ==================================================== */
  const STYLES = `
:host { all: initial; display: block; box-sizing: border-box; }
:host *, :host *::before, :host *::after { box-sizing: border-box; }

.tga-root {
  --tga-brand: #1B2B5B;
  --tga-brand-light: #2A3F7A;
  --tga-accent: #00B4D8;
  --tga-bg: #FFFFFF;
  --tga-bg-2: #F8FAFC;
  --tga-card: #F8FAFC;
  --tga-text: #0F172A;
  --tga-sub: #475569;
  --tga-muted: #94A3B8;
  --tga-border: #E2E8F0;
  --tga-border-soft: #F1F5F9;
  --tga-brand-soft: rgba(27,43,91,0.08);
  --tga-accent-soft: rgba(0,180,216,0.12);
  --tga-success: #10B981;
  --tga-radius: 16px;
  --tga-radius-sm: 10px;
  --tga-shadow-sm: 0 1px 2px rgba(15,23,42,0.04), 0 1px 3px rgba(15,23,42,0.06);
  --tga-shadow-md: 0 4px 16px rgba(15,23,42,0.08), 0 2px 4px rgba(15,23,42,0.04);
  --tga-shadow-lg: 0 20px 40px rgba(15,23,42,0.12), 0 8px 16px rgba(15,23,42,0.06);
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  color: var(--tga-text);
  background: var(--tga-bg);
  line-height: 1.55;
  max-width: 1100px;
  margin: 0 auto;
  border-radius: var(--tga-radius);
  overflow: hidden;
  box-shadow: var(--tga-shadow-lg);
  -webkit-font-smoothing: antialiased;
}
.tga-root[data-theme="dark"] {
  --tga-bg: #0F172A;
  --tga-bg-2: #1E293B;
  --tga-card: #1E293B;
  --tga-text: #F8FAFC;
  --tga-sub: #CBD5E1;
  --tga-muted: #64748B;
  --tga-border: #334155;
  --tga-border-soft: #1E293B;
  --tga-brand-soft: rgba(0,180,216,0.10);
}

.tga-hero {
  position: relative;
  min-height: 380px;
  padding: 56px 56px 48px;
  color: #FFFFFF;
  background:
    linear-gradient(135deg, rgba(27,43,91,0.86) 0%, rgba(27,43,91,0.62) 55%, rgba(0,180,216,0.55) 100%),
    var(--tga-hero-img, linear-gradient(135deg, #1B2B5B, #00B4D8));
  background-size: cover;
  background-position: center;
  overflow: hidden;
}
.tga-hero::after {
  content: '';
  position: absolute; inset: 0;
  background-image:
    linear-gradient(to right, rgba(255,255,255,0.04) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(255,255,255,0.04) 1px, transparent 1px);
  background-size: 60px 60px;
  pointer-events: none;
}
.tga-eyebrow {
  position: relative;
  display: inline-flex; align-items: center; gap: 8px;
  font-size: 12px; font-weight: 600;
  letter-spacing: 0.08em; text-transform: uppercase;
  opacity: 0.92; margin-bottom: 16px;
}
.tga-eyebrow .dot { width: 4px; height: 4px; border-radius: 50%; background: var(--tga-accent); }
.tga-title-row {
  position: relative;
  display: flex; align-items: flex-start; gap: 20px;
  flex-wrap: wrap; margin-bottom: 16px;
}
.tga-name { font-size: 56px; font-weight: 800; line-height: 1.04; letter-spacing: -0.02em; margin: 0; }
.tga-iata {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 96px; height: 64px; padding: 0 20px;
  font-family: 'Inter', monospace;
  font-size: 32px; font-weight: 700; letter-spacing: 0.06em;
  font-variant-numeric: tabular-nums;
  color: var(--tga-brand);
  background: #FFFFFF;
  border-radius: 12px;
  box-shadow: 0 8px 24px rgba(15,23,42,0.25);
  flex-shrink: 0; margin-top: 4px;
}
.tga-tagline {
  position: relative;
  font-size: 19px; line-height: 1.5;
  max-width: 680px; opacity: 0.94;
  margin: 0 0 28px;
}
.tga-hero-meta {
  position: relative;
  display: flex; gap: 24px; flex-wrap: wrap;
  font-size: 13px; opacity: 0.95;
}
.tga-hero-meta .item { display: inline-flex; align-items: center; gap: 8px; }
.tga-hero-meta .item svg { opacity: 0.85; }
.tga-hero-badges {
  position: relative;
  display: flex; gap: 8px; flex-wrap: wrap;
  margin-top: 24px;
}
.tga-badge {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 12px;
  border-radius: 9999px;
  background: rgba(255,255,255,0.14);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255,255,255,0.22);
  font-size: 12px; font-weight: 500;
}
.tga-badge.is-on { background: rgba(16,185,129,0.25); border-color: rgba(16,185,129,0.5); }

.tga-serves {
  display: flex; align-items: center; gap: 20px;
  padding: 20px 56px;
  background: var(--tga-brand);
  color: #FFFFFF; flex-wrap: wrap;
}
.tga-serves-label {
  display: inline-flex; align-items: center; gap: 8px;
  font-size: 11px; font-weight: 700;
  letter-spacing: 0.08em; text-transform: uppercase;
  color: rgba(255,255,255,0.7);
  flex-shrink: 0;
}
.tga-serves-chips { display: flex; gap: 8px; flex-wrap: wrap; }
.tga-chip {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 8px 14px;
  background: rgba(255,255,255,0.10);
  border: 1px solid rgba(255,255,255,0.18);
  border-radius: 9999px;
  color: #FFFFFF; text-decoration: none;
  font-size: 13px; font-weight: 600;
  transition: background .15s ease-out, border-color .15s ease-out, transform .15s ease-out;
  min-height: 32px;
}
.tga-chip:hover, .tga-chip:focus-visible {
  background: var(--tga-accent);
  border-color: var(--tga-accent);
  transform: translateY(-1px);
  outline: none;
}
.tga-chip:focus-visible { box-shadow: 0 0 0 3px rgba(0,180,216,0.4); }
.tga-chip-meta {
  font-size: 11px; font-weight: 500;
  opacity: 0.75;
  padding-left: 8px;
  border-left: 1px solid rgba(255,255,255,0.25);
}

.tga-facts {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  background: var(--tga-card);
  border-bottom: 1px solid var(--tga-border);
}
.tga-facts[data-count="1"] { grid-template-columns: 1fr; }
.tga-facts[data-count="2"] { grid-template-columns: repeat(2, 1fr); }
.tga-facts[data-count="3"] { grid-template-columns: repeat(3, 1fr); }
.tga-fact {
  padding: 24px 28px;
  border-right: 1px solid var(--tga-border);
  display: flex; align-items: flex-start; gap: 14px;
}
.tga-fact:last-child { border-right: none; }
.tga-fact-icon {
  width: 40px; height: 40px;
  border-radius: 10px;
  background: var(--tga-accent-soft);
  color: var(--tga-accent);
  display: inline-flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.tga-fact-label {
  font-size: 11px; font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--tga-muted);
  margin-bottom: 4px;
}
.tga-fact-value { font-size: 15px; font-weight: 600; color: var(--tga-text); line-height: 1.35; }
.tga-fact-sub { font-size: 12px; color: var(--tga-sub); margin-top: 2px; }

.tga-section {
  padding: 48px 56px;
  border-bottom: 1px solid var(--tga-border-soft);
}
.tga-section:last-child { border-bottom: none; }
.tga-section-head { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
.tga-section-icon {
  width: 32px; height: 32px;
  border-radius: 8px;
  background: var(--tga-brand-soft);
  color: var(--tga-brand);
  display: inline-flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.tga-root[data-theme="dark"] .tga-section-icon { background: rgba(0,180,216,0.10); color: var(--tga-accent); }
.tga-section-title {
  font-size: 13px; font-weight: 700;
  letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--tga-brand);
  margin: 0;
}
.tga-root[data-theme="dark"] .tga-section-title { color: var(--tga-accent); }
.tga-section-h2 {
  font-size: 28px; font-weight: 700;
  line-height: 1.2; letter-spacing: -0.01em;
  margin: 0 0 16px;
  color: var(--tga-text);
}
.tga-prose { font-size: 16px; line-height: 1.65; color: var(--tga-sub); max-width: 780px; }
.tga-prose p { margin: 0 0 16px; }
.tga-prose p:last-child { margin: 0; }
.tga-prose strong { color: var(--tga-text); font-weight: 600; }

.tga-locate { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; align-items: start; }
.tga-map-wrap {
  position: relative;
  border-radius: var(--tga-radius-sm);
  overflow: hidden;
  border: 1px solid var(--tga-border);
  background: var(--tga-card);
  box-shadow: var(--tga-shadow-sm);
}
.tga-map { width: 100%; height: 320px; background: #E8EEF4; }
.tga-map .leaflet-control-attribution {
  font-family: 'Inter', sans-serif;
  font-size: 10px;
  background: rgba(255,255,255,0.85);
  color: var(--tga-muted);
  padding: 2px 6px;
}
.tga-map .leaflet-control-attribution a { color: var(--tga-sub); }
.tga-map .leaflet-control-zoom a {
  background: #FFFFFF;
  color: var(--tga-brand);
  border-color: var(--tga-border);
  font-family: 'Inter', sans-serif;
  font-weight: 600;
}
.tga-pin {
  display: flex; align-items: center; justify-content: center;
  width: 36px; height: 36px;
  border-radius: 50% 50% 50% 0;
  transform: rotate(-45deg);
  box-shadow: 0 4px 12px rgba(15,23,42,0.35);
  border: 3px solid #FFFFFF;
  font-weight: 700;
  color: #FFFFFF;
  font-family: 'Inter', sans-serif;
}
.tga-pin svg, .tga-pin span { transform: rotate(45deg); }
.tga-pin-airport { background: var(--tga-accent); font-size: 11px; letter-spacing: 0.04em; }
.tga-pin-city   { background: var(--tga-brand); width: 28px; height: 28px; }
.tga-map-foot {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  background: var(--tga-card);
  border-top: 1px solid var(--tga-border);
  font-size: 13px;
  flex-wrap: wrap;
}
.tga-map-foot-coords {
  color: var(--tga-muted);
  font-variant-numeric: tabular-nums;
  display: inline-flex; align-items: center; gap: 6px;
}
.tga-map-links { display: inline-flex; gap: 14px; }
.tga-map-link {
  display: inline-flex; align-items: center; gap: 4px;
  color: var(--tga-brand);
  text-decoration: none;
  font-weight: 600;
  font-size: 13px;
}
.tga-map-link:hover { color: var(--tga-accent); }
.tga-root[data-theme="dark"] .tga-map-link { color: var(--tga-accent); }

.tga-tabs {
  display: flex; gap: 4px;
  border-bottom: 1px solid var(--tga-border);
  margin-bottom: 20px;
  overflow-x: auto;
}
.tga-tab {
  appearance: none;
  background: none; border: none;
  padding: 12px 18px;
  font-family: inherit;
  font-size: 14px; font-weight: 500;
  color: var(--tga-sub);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  display: inline-flex; align-items: center; gap: 8px;
  white-space: nowrap;
  transition: color .15s ease-out, border-color .15s ease-out;
  min-height: 44px;
}
.tga-tab:hover { color: var(--tga-text); }
.tga-tab.is-active { color: var(--tga-brand); border-bottom-color: var(--tga-accent); font-weight: 600; }
.tga-root[data-theme="dark"] .tga-tab.is-active { color: var(--tga-accent); }
.tga-tab:focus-visible { outline: 2px solid var(--tga-accent); outline-offset: 2px; border-radius: 4px; }
.tga-tab-panel { display: none; }
.tga-tab-panel.is-active { display: block; }

.tga-cards { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; }
.tga-card {
  padding: 24px;
  background: var(--tga-card);
  border: 1px solid var(--tga-border);
  border-radius: var(--tga-radius-sm);
  transition: border-color .15s ease-out, box-shadow .15s ease-out, transform .15s ease-out;
}
.tga-card:hover {
  border-color: var(--tga-accent);
  box-shadow: var(--tga-shadow-md);
  transform: translateY(-2px);
}
.tga-card-head { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.tga-card-icon {
  width: 32px; height: 32px;
  border-radius: 8px;
  background: var(--tga-brand);
  color: #FFFFFF;
  display: inline-flex; align-items: center; justify-content: center;
}
.tga-card-title { font-size: 16px; font-weight: 600; color: var(--tga-text); margin: 0; }
.tga-card-body { font-size: 14px; line-height: 1.6; color: var(--tga-sub); }

.tga-callout {
  display: flex; gap: 18px;
  padding: 24px 28px;
  background: linear-gradient(135deg, rgba(0,180,216,0.08), rgba(0,180,216,0.02));
  border: 1px solid rgba(0,180,216,0.25);
  border-left: 4px solid var(--tga-accent);
  border-radius: var(--tga-radius-sm);
}
.tga-callout-icon {
  width: 44px; height: 44px;
  border-radius: 12px;
  background: var(--tga-accent);
  color: #FFFFFF;
  display: inline-flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.tga-callout-title {
  font-size: 11px; font-weight: 700;
  letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--tga-accent);
  margin: 0 0 4px;
}
.tga-callout-text { font-size: 15px; line-height: 1.55; color: var(--tga-text); margin: 0; }

.tga-tips {
  position: relative;
  padding: 28px 32px 28px 60px;
  background: var(--tga-brand);
  color: #E6EAF4;
  border-radius: var(--tga-radius-sm);
  font-size: 15px;
  line-height: 1.65;
}
.tga-tips::before {
  content: '';
  position: absolute; top: 24px; left: 24px;
  width: 4px; height: calc(100% - 48px);
  background: var(--tga-accent);
  border-radius: 2px;
}
.tga-tips strong { color: #FFFFFF; }

.tga-cta {
  display: flex; align-items: center; justify-content: space-between;
  gap: 32px; padding: 32px 56px;
  background: linear-gradient(135deg, var(--tga-brand) 0%, var(--tga-brand-light) 100%);
  color: #FFFFFF;
  flex-wrap: wrap;
}
.tga-cta-text { flex: 1; min-width: 260px; }
.tga-cta-title { font-size: 20px; font-weight: 700; margin: 0 0 4px; }
.tga-cta-sub { font-size: 14px; opacity: 0.85; margin: 0; }
.tga-cta-actions { display: flex; gap: 12px; }
.tga-btn {
  appearance: none; border: none;
  padding: 12px 22px;
  border-radius: 10px;
  font-family: inherit;
  font-size: 14px; font-weight: 600;
  cursor: pointer;
  display: inline-flex; align-items: center; gap: 8px;
  text-decoration: none;
  transition: transform .15s ease-out, background .15s ease-out;
  min-height: 44px;
}
.tga-btn-primary { background: var(--tga-accent); color: #FFFFFF; }
.tga-btn-primary:hover, .tga-btn-primary:focus-visible { background: #00C4EA; transform: translateY(-1px); outline: none; }
.tga-btn-primary:focus-visible { box-shadow: 0 0 0 3px rgba(0,180,216,0.35); }
.tga-btn-ghost { background: rgba(255,255,255,0.10); color: #FFFFFF; border: 1px solid rgba(255,255,255,0.25); }
.tga-btn-ghost:hover, .tga-btn-ghost:focus-visible { background: rgba(255,255,255,0.18); outline: none; }
.tga-btn-ghost:focus-visible { box-shadow: 0 0 0 3px rgba(255,255,255,0.35); }

.tga-empty { padding: 56px; text-align: center; color: var(--tga-sub); }
.tga-empty p { margin: 0; font-size: 15px; }

@media (max-width: 880px) {
  .tga-hero { padding: 40px 28px 36px; }
  .tga-name { font-size: 40px; }
  .tga-iata { min-width: 78px; height: 52px; font-size: 26px; }
  .tga-section { padding: 36px 28px; }
  .tga-cta { padding: 28px; }
  .tga-serves { padding: 16px 28px; flex-direction: column; align-items: flex-start; gap: 12px; }
  .tga-facts { grid-template-columns: repeat(2, 1fr); }
  .tga-fact { border-right: 1px solid var(--tga-border); border-bottom: 1px solid var(--tga-border); }
  .tga-fact:nth-child(2n) { border-right: none; }
  .tga-fact:nth-last-child(-n+2) { border-bottom: none; }
  .tga-cards { grid-template-columns: 1fr; }
  .tga-locate { grid-template-columns: 1fr; }
  .tga-map { height: 280px; }
}
@media (max-width: 560px) {
  .tga-name { font-size: 32px; }
  .tga-tagline { font-size: 16px; }
  .tga-section-h2 { font-size: 22px; }
  .tga-facts { grid-template-columns: 1fr; }
  .tga-fact { border-right: none; }
  .tga-fact:last-child { border-bottom: none; }
  .tga-cta { flex-direction: column; align-items: stretch; }
  .tga-cta-actions { width: 100%; }
  .tga-btn { flex: 1; justify-content: center; }
}

@media (prefers-reduced-motion: reduce) {
  .tga-chip, .tga-tab, .tga-card, .tga-btn, .tga-map-link { transition: none !important; }
  .tga-chip:hover, .tga-card:hover, .tga-btn-primary:hover { transform: none !important; }
}
`;

  /* ===== Widget class =============================================== */
  class TGAirportWidget {
    constructor(container, config) {
      if (!container) throw new Error('TGAirportWidget: container required');
      this.el = container;
      this.c = this._defaults(config);
      // Reuse an existing shadow root if one is already attached — this happens
      // when the editor re-instantiates the widget after the user picks an
      // airport (the auto-init below has already attached a shadow root on
      // page load). Calling attachShadow() twice on the same element throws.
      if (container.shadowRoot) {
        this.shadow = container.shadowRoot;
        while (this.shadow.firstChild) this.shadow.removeChild(this.shadow.firstChild);
      } else if (container.attachShadow) {
        this.shadow = container.attachShadow({ mode: 'open' });
      } else {
        this.shadow = container;
      }
      this._mapInst = null;
      this._renderShell();

      if (this.c.airportData && typeof this.c.airportData === 'object') {
        this._airport = this.c.airportData;
        this._renderContent();
      } else if (this.c.widgetId) {
        this._loadAirport();
      } else {
        this._renderNotFound();
      }
      container.setAttribute('data-tg-initialised', 'true');
    }

    _defaults(c) {
      const base = {
        widgetId: null, theme: 'light',
        brandColor: '#1B2B5B', accentColor: '#00B4D8', radius: 16, fontFamily: '',
        sections: {
          hero: true, serves: true, facts: true, overview: true,
          terminals: true, located: true, facilities: true,
          arrival: true, tips: true, cta: true,
        },
        showMap: true, showAttribution: true, heroImageUrl: '',
        cta: {
          originTitle: 'Flying from {{airportName}}?',
          originSubtitle: 'Search flights, hotels and transfers from {{iata}}',
          originButtonLabel: 'Search flights', originButtonUrl: '',
          destinationTitle: 'Plan a holiday near {{airportName}}',
          destinationSubtitle: 'Explore the resorts served by {{iata}}',
          destinationButtonLabel: 'Browse resorts', destinationButtonUrl: '',
        },
        airport: null, airportData: null,
      };
      if (!c || typeof c !== 'object') return base;
      const m = Object.assign({}, base, c);
      m.sections = Object.assign({}, base.sections, c.sections || {});
      m.cta = Object.assign({}, base.cta, c.cta || {});
      return m;
    }

    _loadAirport() {
      const url = CONTENT_API + '?widgetId=' + encodeURIComponent(this.c.widgetId);
      fetch(url, { credentials: 'omit' })
        .then(r => {
          if (r.status === 404) { this._renderNotFound(); return null; }
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        })
        .then(d => {
          if (!d) return;
          if (d.found === false) { this._renderHidden(); return; }
          this._airport = d.airport || null;
          this._renderContent();
        })
        .catch(() => this._renderError());
    }

    _renderShell() {
      while (this.shadow.firstChild) this.shadow.removeChild(this.shadow.firstChild);
      const styleEl = document.createElement('style');
      styleEl.textContent = STYLES;
      this.shadow.appendChild(styleEl);
      const root = document.createElement('div');
      root.className = 'tga-root';
      root.setAttribute('data-theme', this.c.theme === 'dark' ? 'dark' : 'light');
      if (this.c.fontFamily) {
        root.style.fontFamily = "'" + String(this.c.fontFamily).replace(/'/g, '') + "', sans-serif";
      }
      this.shadow.appendChild(root);
      this._root = root;
      this.el.style.display = '';
    }

    _renderContent() {
      const d = this._airport;
      if (!d || !d.name) return this._renderNotFound();
      const s = this.c.sections;
      const role = normaliseRole(d.role);
      const isDest = role === 'destination' || role === 'both';

      const html = [];
      if (s.hero)       html.push(this._renderHero(d, role));
      if (s.serves && isDest && this._hasServes(d)) html.push(this._renderServes(d));
      if (s.facts)      html.push(this._renderFacts(d, role));
      if (s.overview)   html.push(this._renderOverview(d));
      if (s.terminals)  html.push(this._renderTerminals(d));
      if (s.located)    html.push(this._renderLocated(d, role));
      if (s.facilities) html.push(this._renderFacilities(d));
      if (s.arrival)    html.push(this._renderArrival(d));
      if (s.tips)       html.push(this._renderTips(d));
      if (s.cta)        html.push(this._renderCta(d, role));

      this._root.innerHTML = html.join('');
      this._bind();

      if (s.located && this.c.showMap && safeLatLng(d.lat, d.lng)) {
        this._initMap(d, isDest);
      }
    }

    _hasServes(d) {
      return (Array.isArray(d.resorts) && d.resorts.length) ||
             (Array.isArray(d.cities)  && d.cities.length);
    }

    _renderHero(d, role) {
      const iata = safeIata(d.iata);
      const heroImg = safeUrl(d.heroImageUrl || this.c.heroImageUrl);
      const eyebrow = [d.cityServed, d.country, d.type].filter(Boolean).map(esc).join(' &middot; ');
      const tagline = esc((d.tagline || '').slice(0, 240));
      const style = heroImg ? ' style="--tga-hero-img:url(' + esc(heroImg) + ')"' : '';
      return '' +
        '<header class="tga-hero"' + style + '>' +
          (eyebrow ? '<div class="tga-eyebrow"><span class="dot"></span>' + eyebrow + '</div>' : '') +
          '<div class="tga-title-row">' +
            '<h1 class="tga-name">' + esc(d.name) + '</h1>' +
            (iata ? '<span class="tga-iata" aria-label="IATA code ' + iata + '">' + iata + '</span>' : '') +
          '</div>' +
          (tagline ? '<p class="tga-tagline">' + tagline + '</p>' : '') +
          this._heroMetaBlock(d, role) +
          this._heroBadgesBlock(d, role) +
        '</header>';
    }

    _heroMetaBlock(d, role) {
      const items = [];
      const ll = safeLatLng(d.lat, d.lng);
      if (role === 'origin' || role === 'both') {
        if (d.distanceToCity) items.push('<span class="item">' + icon('map', 16) + ' ' + esc(d.distanceToCity) + '</span>');
        if (d.driveTimeSummary) items.push('<span class="item">' + icon('clock', 16) + ' ' + esc(d.driveTimeSummary) + '</span>');
      }
      if (role === 'destination' || role === 'both') {
        const resorts = (Array.isArray(d.resorts) ? d.resorts : []).slice(0, 3);
        if (resorts.length) {
          const parts = resorts.map(r => {
            const m = fmtMinutes(r.transferMinutes);
            return m ? esc(r.name) + ' ' + esc(m) : esc(r.name);
          });
          items.push('<span class="item">' + icon('clock', 16) + ' ' + parts.join(' &middot; ') + '</span>');
        }
      }
      if (ll) items.push('<span class="item">' + icon('pin', 16) + ' ' + fmtCoords(ll[0], ll[1]) + '</span>');
      return items.length ? '<div class="tga-hero-meta">' + items.join('') + '</div>' : '';
    }

    _heroBadgesBlock(d, role) {
      const out = [];
      if (d.hasLounges)   out.push('<span class="tga-badge is-on">' + icon('check', 14) + ' Lounges</span>');
      if (d.hasFastTrack) out.push('<span class="tga-badge is-on">' + icon('check', 14) + ' Fast Track</span>');
      if (role === 'origin')      out.push('<span class="tga-badge">UK Origin</span>');
      if (role === 'destination') out.push('<span class="tga-badge">Destination</span>');
      if (role === 'both')        out.push('<span class="tga-badge">UK Origin &middot; Destination</span>');
      if (d.type) out.push('<span class="tga-badge">' + esc(d.type) + '</span>');
      return out.length ? '<div class="tga-hero-badges">' + out.join('') + '</div>' : '';
    }

    _renderServes(d) {
      const items = [];
      (d.resorts || []).forEach(r => {
        if (!r.name) return;
        const href = safeUrl(r.url) || '#';
        const meta = fmtMinutes(r.transferMinutes);
        items.push(
          '<a href="' + esc(href) + '" class="tga-chip">' +
            esc(r.name) +
            (meta ? '<span class="tga-chip-meta">' + esc(meta) + '</span>' : '') +
          '</a>'
        );
      });
      if (!items.length) return '';
      return '<div class="tga-serves">' +
        '<div class="tga-serves-label">' + icon('luggage', 14) + ' Serves these destinations</div>' +
        '<div class="tga-serves-chips">' + items.join('') + '</div>' +
      '</div>';
    }

    _renderFacts(d, role) {
      const tiles = [];
      if (d.checkInSummary) tiles.push(this._fact('luggage', 'Check-in', d.checkInSummary, d.checkInDetail));
      if (d.terminalsCount) {
        const n = Number(d.terminalsCount);
        tiles.push(this._fact('building', 'Terminals', n + ' terminal' + (n > 1 ? 's' : ''), d.terminalsNote));
      }
      if (d.keyAirlines) {
        tiles.push(this._fact('plane', role === 'destination' ? 'UK airlines' : 'Key airlines',
          d.keyAirlines, d.keyAirlinesNote));
      }
      if ((role === 'destination' || role === 'both') && d.flightTimeFromUK) {
        tiles.push(this._fact('speed', 'Flight from UK', d.flightTimeFromUK, d.flightTimeNote));
      } else if (d.distanceToCity) {
        // distanceToCity is multilineText in Airtable so editors sometimes
        // paste a paragraph in there. Tiles only have ~25% width in the 4-up
        // grid — take the first sentence (or first ~60 chars) for the value,
        // leave the rest available to the longer "Getting there" tabs.
        const short = firstSentence(d.distanceToCity, 60);
        tiles.push(this._fact('pin', 'From ' + (d.cityServed || 'city'), short, d.driveTimeSummary));
      }
      const sliced = tiles.slice(0, 4);
      if (!sliced.length) return '';
      return '<div class="tga-facts" data-count="' + sliced.length + '">' + sliced.join('') + '</div>';
    }

    _fact(ico, label, value, sub) {
      return '<div class="tga-fact">' +
        '<span class="tga-fact-icon">' + icon(ico, 20) + '</span>' +
        '<div>' +
          '<div class="tga-fact-label">' + esc(label) + '</div>' +
          '<div class="tga-fact-value">' + esc(value) + '</div>' +
          (sub ? '<div class="tga-fact-sub">' + esc(sub) + '</div>' : '') +
        '</div>' +
      '</div>';
    }

    _renderOverview(d) {
      if (!d.overview) return '';
      const paras = String(d.overview).split(/\n\n+/).slice(0, 4)
        .map(p => p.trim()).filter(Boolean)
        .map(p => '<p>' + esc(p) + '</p>').join('');
      if (!paras) return '';
      return this._section('info', 'Overview', d.overviewHeading || 'The airport in brief',
        '<div class="tga-prose">' + paras + '</div>');
    }

    _renderTerminals(d) {
      if (!d.terminalsAndAirlines) return '';
      return this._section('building', 'Terminals & Airlines', '',
        '<div class="tga-prose"><p>' + esc(d.terminalsAndAirlines) + '</p></div>');
    }

    _renderLocated(d, role) {
      const isDest = role === 'destination' || role === 'both';
      const tabs = this._locatedTabs(d, isDest);
      const ll = safeLatLng(d.lat, d.lng);
      if (!tabs.length && !ll) return '';

      const tabBar = tabs.map((t, i) =>
        '<button class="tga-tab' + (i === 0 ? ' is-active' : '') +
        '" role="tab" aria-selected="' + (i === 0 ? 'true' : 'false') +
        '" data-target="tga-tab-' + esc(t.id) + '">' +
          icon(t.icon, 16) + ' ' + esc(t.label) +
        '</button>'
      ).join('');

      const panels = tabs.map((t, i) =>
        '<div class="tga-tab-panel' + (i === 0 ? ' is-active' : '') +
        '" id="tga-tab-' + esc(t.id) + '" role="tabpanel">' +
          '<div class="tga-prose">' + this._proseBlocks(t.body) + '</div>' +
        '</div>'
      ).join('');

      const mapBlock = this._renderMapBlock(d);
      const h2 = isDest ? 'Onward to your resort' : 'Getting there';
      const inner = '<div class="tga-locate">' +
        '<div>' + mapBlock + '</div>' +
        '<div>' +
          (tabs.length ? '<div class="tga-tabs" role="tablist">' + tabBar + '</div>' : '') +
          panels +
        '</div>' +
      '</div>';
      return this._section('compass', 'Located', h2, inner);
    }

    _locatedTabs(d, isDest) {
      const T = (id, ic, label, body) => body ? { id, icon: ic, label, body } : null;
      const t = isDest ? [
        T('transfer', 'transfer', 'Resort transfers', d.transferInfo),
        T('car',      'car',      'Car hire',         d.carHireInfo),
        T('taxi',     'taxi',     'Taxi',             d.taxiInfo),
        T('coach',    'coach',    'Public coach',     d.coachInfo),
      ] : [
        T('train',   'train',   'Train',   d.gettingThereByTrain),
        T('car',     'car',     'Car',     d.gettingThereByCar),
        T('taxi',    'taxi',    'Taxi',    d.taxiAndRideshare),
        T('coach',   'coach',   'Coach',   d.gettingThereByCoach),
        T('parking', 'parking', 'Parking', d.parking),
      ];
      return t.filter(Boolean);
    }

    _proseBlocks(text) {
      return String(text || '').split(/\n\n+/)
        .map(p => p.trim()).filter(Boolean)
        .map(p => '<p>' + esc(p) + '</p>').join('');
    }

    _renderMapBlock(d) {
      const ll = safeLatLng(d.lat, d.lng);
      if (!ll || !this.c.showMap) return '';
      const g = 'https://www.google.com/maps/?q=' + ll[0] + ',' + ll[1];
      const a = 'https://maps.apple.com/?ll=' + ll[0] + ',' + ll[1] +
                '&q=' + encodeURIComponent(d.name || '');
      return '<div class="tga-map-wrap">' +
        '<div class="tga-map" data-tga-map="1" role="region" aria-label="Map showing ' + esc(d.name) + '"></div>' +
        '<div class="tga-map-foot">' +
          '<span class="tga-map-foot-coords">' + icon('pin', 13) + ' ' + fmtCoords(ll[0], ll[1]) + '</span>' +
          '<span class="tga-map-links">' +
            '<a class="tga-map-link" href="' + esc(g) + '" target="_blank" rel="noopener noreferrer">Google Maps' + icon('arrow_out', 11) + '</a>' +
            '<a class="tga-map-link" href="' + esc(a) + '" target="_blank" rel="noopener noreferrer">Apple Maps' + icon('arrow_out', 11) + '</a>' +
          '</span>' +
        '</div>' +
      '</div>';
    }

    _renderFacilities(d) {
      const cards = [];
      if (d.loungesInfo) cards.push(this._card('lounge', 'Lounges', d.loungesInfo));
      if (d.familyInfo)  cards.push(this._card('family', 'Family facilities', d.familyInfo));
      if (d.assistInfo)  cards.push(this._card('assist', 'Special assistance', d.assistInfo));
      if (d.hotelsInfo)  cards.push(this._card('building', 'Airport hotels', d.hotelsInfo));
      if (!cards.length) return '';
      return this._section('star', 'Facilities', "What's at the airport",
        '<div class="tga-cards">' + cards.join('') + '</div>');
    }

    _card(ico, title, body) {
      return '<div class="tga-card">' +
        '<div class="tga-card-head">' +
          '<span class="tga-card-icon">' + icon(ico, 18) + '</span>' +
          '<h4 class="tga-card-title">' + esc(title) + '</h4>' +
        '</div>' +
        '<div class="tga-card-body">' + esc(body) + '</div>' +
      '</div>';
    }

    _renderArrival(d) {
      if (!d.recommendedArrival) return '';
      return '<section class="tga-section">' +
        '<div class="tga-callout">' +
          '<span class="tga-callout-icon" aria-hidden="true">' + icon('clock', 22) + '</span>' +
          '<div>' +
            '<p class="tga-callout-title">Recommended arrival time</p>' +
            '<p class="tga-callout-text">' + esc(d.recommendedArrival) + '</p>' +
          '</div>' +
        '</div>' +
      '</section>';
    }

    _renderTips(d) {
      if (!d.tips) return '';
      return this._section('alert', 'Quirks & insider tips', 'Things that catch first-timers out',
        '<div class="tga-tips">' + esc(d.tips) + '</div>');
    }

    _renderCta(d, role) {
      const isDest = role === 'destination' || role === 'both';
      const cta = this.c.cta || {};
      const vars = {
        airportName: d.name || '', iata: safeIata(d.iata),
        cityServed: d.cityServed || '', country: d.country || '',
      };
      const title = renderTemplate(isDest ? cta.destinationTitle : cta.originTitle, vars);
      const sub   = renderTemplate(isDest ? cta.destinationSubtitle : cta.originSubtitle, vars);
      const label = isDest ? cta.destinationButtonLabel : cta.originButtonLabel;
      const url   = safeUrl(isDest ? cta.destinationButtonUrl : cta.originButtonUrl);
      const official = safeUrl(d.officialWebsite);
      if (!title && !sub && !label && !official) return '';
      return '<div class="tga-cta">' +
        '<div class="tga-cta-text">' +
          (title ? '<h3 class="tga-cta-title">' + esc(title) + '</h3>' : '') +
          (sub ? '<p class="tga-cta-sub">' + esc(sub) + '</p>' : '') +
        '</div>' +
        '<div class="tga-cta-actions">' +
          (official ? '<a href="' + esc(official) + '" target="_blank" rel="noopener noreferrer" class="tga-btn tga-btn-ghost">Official website' + icon('arrow', 14) + '</a>' : '') +
          (url ? '<a href="' + esc(url) + '" class="tga-btn tga-btn-primary">' + esc(label || 'Find out more') + icon('arrow', 14) + '</a>' : '') +
        '</div>' +
      '</div>';
    }

    _section(ico, kicker, h2, inner) {
      return '<section class="tga-section">' +
        '<div class="tga-section-head">' +
          '<span class="tga-section-icon" aria-hidden="true">' + icon(ico, 18) + '</span>' +
          '<h3 class="tga-section-title">' + esc(kicker) + '</h3>' +
        '</div>' +
        (h2 ? '<h2 class="tga-section-h2">' + esc(h2) + '</h2>' : '') +
        inner +
      '</section>';
    }

    _initMap(d, isDest) {
      const host = this.shadow.querySelector('[data-tga-map]');
      if (!host) return;
      // Leaflet's stylesheet is loaded into document.head by loadLeaflet(),
      // but Shadow DOM is style-encapsulated so head styles don't apply to
      // elements inside this.shadow. Without this, the tile layer renders
      // as a stack of broken <img> tags and zoom controls are unstyled.
      // Add the same link inside the shadow root (idempotent).
      if (!this.shadow.querySelector('link[data-tga-leaflet-shadow]')) {
        const shadowLink = document.createElement('link');
        shadowLink.rel = 'stylesheet';
        shadowLink.href = LEAFLET_CSS;
        shadowLink.integrity = LEAFLET_CSS_SRI;
        shadowLink.crossOrigin = '';
        shadowLink.setAttribute('data-tga-leaflet-shadow', '1');
        this.shadow.appendChild(shadowLink);
      }
      loadLeaflet().then(L => {
        const airportLL = safeLatLng(d.lat, d.lng);
        if (!airportLL) return;
        if (this._mapInst) { try { this._mapInst.remove(); } catch (e) { /* */ } this._mapInst = null; }

        const map = L.map(host, {
          zoomControl: true, scrollWheelZoom: false,
          attributionControl: this.c.showAttribution !== false,
        });
        this._mapInst = map;

        L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
          subdomains: 'abcd', maxZoom: 19,
        }).addTo(map);

        const makePin = (kind, label) => L.divIcon({
          className: '',
          html: '<div class="tga-pin tga-pin-' + kind + '"><span>' + esc(label || '') + '</span></div>',
          iconSize: kind === 'airport' ? [36, 36] : [28, 28],
          iconAnchor: kind === 'airport' ? [18, 36] : [14, 28],
        });

        const points = [airportLL];
        L.marker(airportLL, { icon: makePin('airport', safeIata(d.iata) || '') })
          .addTo(map)
          .bindPopup('<strong>' + esc(d.name) + '</strong>' +
            (d.cityServed ? '<br>' + esc(d.cityServed) : ''));

        if (isDest) {
          (d.resorts || []).forEach(r => {
            const ll = safeLatLng(r.lat, r.lng);
            if (!ll) return;
            const mins = fmtMinutes(r.transferMinutes);
            const url = safeUrl(r.url);
            L.marker(ll, { icon: makePin('city', '') })
              .addTo(map)
              .bindPopup('<strong>' + esc(r.name) + '</strong>' +
                (mins ? '<br>~' + esc(mins) + ' transfer' : '') +
                (url ? '<br><a href="' + esc(url) + '">View resort guide</a>' : ''));
            points.push(ll);
          });
        } else {
          const cityLL = safeLatLng(d.cityLat, d.cityLng);
          if (cityLL) {
            L.marker(cityLL, { icon: makePin('city', '') })
              .addTo(map)
              .bindPopup('<strong>' + esc(d.cityServed || 'City centre') + '</strong>');
            points.push(cityLL);
          }
        }

        if (points.length > 1) map.fitBounds(points, { padding: [40, 40] });
        else map.setView(airportLL, 11);

        map.on('click', () => map.scrollWheelZoom.enable());
        map.on('mouseout', () => map.scrollWheelZoom.disable());
      }).catch(() => { /* silent */ });
    }

    _bind() {
      const tabs = this.shadow.querySelectorAll('.tga-tab');
      tabs.forEach(tab => {
        const h = () => {
          const targetId = tab.getAttribute('data-target');
          const bar = tab.parentElement;
          bar.querySelectorAll('.tga-tab').forEach(t => {
            t.classList.remove('is-active');
            t.setAttribute('aria-selected', 'false');
          });
          this.shadow.querySelectorAll('.tga-tab-panel').forEach(p => p.classList.remove('is-active'));
          tab.classList.add('is-active');
          tab.setAttribute('aria-selected', 'true');
          const panel = this.shadow.querySelector('#' + targetId);
          if (panel) panel.classList.add('is-active');
        };
        tab.addEventListener('click', h);
        tab.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); h(); }
        });
      });
    }

    _renderNotFound() { this._root.innerHTML = '<div class="tga-empty"><p>Airport not found.</p></div>'; }
    _renderError()    { this._root.innerHTML = '<div class="tga-empty"><p>Could not load airport details. Please try again.</p></div>'; }
    _renderHidden() {
      while (this.shadow.firstChild) this.shadow.removeChild(this.shadow.firstChild);
      this.el.style.display = 'none';
    }

    update(newConfig) {
      this.c = this._defaults(Object.assign({}, this.c, newConfig || {}));
      this._renderShell();
      if (this.c.airportData) { this._airport = this.c.airportData; this._renderContent(); }
      else if (this._airport) { this._renderContent(); }
      else if (this.c.widgetId) { this._loadAirport(); }
      else { this._renderNotFound(); }
    }

    destroy() {
      if (this._mapInst) { try { this._mapInst.remove(); } catch (e) { /* */ } }
      this._mapInst = null;
      if (this.shadow && this.shadow.firstChild) {
        while (this.shadow.firstChild) this.shadow.removeChild(this.shadow.firstChild);
      }
      this.el.removeAttribute('data-tg-initialised');
    }
  }

  function init() {
    const containers = document.querySelectorAll('[data-tg-widget="airport"]:not([data-tg-initialised])');
    containers.forEach(el => {
      // Skip elements that opt out of auto-init. The editor uses this so it
      // can control widget instantiation itself — auto-init with empty config
      // would otherwise render "Airport not found" and lock the mount before
      // the editor has a chance to provide the picked airport's data.
      if (el.hasAttribute('data-tg-no-autoinit')) return;
      let cfg = {};
      const inline = el.getAttribute('data-tg-config');
      if (inline) { try { cfg = JSON.parse(inline); } catch (e) { /* */ } }
      const wid = el.getAttribute('data-tg-id');
      if (wid) cfg.widgetId = wid;
      new TGAirportWidget(el, cfg);
    });
  }

  window.TGAirportWidget = TGAirportWidget;
  window.__TG_AIRPORT_VERSION__ = VERSION;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
