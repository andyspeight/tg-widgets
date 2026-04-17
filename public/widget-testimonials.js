/**
 * Travelgenix Testimonials Widget v1.0.0
 * Self-contained, embeddable testimonials widget.
 * Zero dependencies — works on any website via a single script tag.
 *
 * Features
 *  - 6 layouts: featured, grid, masonry, carousel, marquee, spotlight
 *  - Rich data: destination, tripType, travelDate, source badge, verified, video
 *  - Source logos (Google, Facebook, Trustpilot, TripAdvisor) + verified tick
 *  - Optional trip-type chip filter on grid / masonry
 *  - Video testimonials (YouTube, Vimeo, MP4) with click-to-play
 *  - Dark mode (`theme: "dark" | "light" | "auto"`)
 *  - Respects prefers-reduced-motion (disables marquee, carousel autoplay, spotlight fade)
 *  - Fully responsive from 320px upwards
 *  - ARIA-compliant, keyboard accessible
 *  - XSS-hardened: all user content escaped; URLs validated
 *
 * Usage (remote config):
 *   <div data-tg-widget="testimonials" data-tg-id="YOUR_WIDGET_ID"></div>
 *   <script src="https://tg-widgets.vercel.app/widget-testimonials.js"></script>
 *
 * Usage (inline config):
 *   <div data-tg-widget="testimonials" data-tg-config='{"layout":"grid",...}'></div>
 *   <script src="https://tg-widgets.vercel.app/widget-testimonials.js"></script>
 *
 * © Travelgenix. All rights reserved.
 */
(function () {
  'use strict';

  // ═══════════════════════════════════════════════════════════
  // Constants
  // ═══════════════════════════════════════════════════════════

  const API_BASE =
    (typeof window !== 'undefined' && window.TG_WIDGETS_API_BASE) ||
    'https://tg-widgets.vercel.app';

  const VERSION = '1.0.0';

  // Canonical source labels (strict allowlist — anything else becomes 'Direct')
  const KNOWN_SOURCES = ['Google', 'Facebook', 'Trustpilot', 'TripAdvisor', 'Direct'];

  // ═══════════════════════════════════════════════════════════
  // Utilities
  // ═══════════════════════════════════════════════════════════

  /** HTML-escape user content before interpolating into innerHTML. */
  function esc(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** Only allow http(s) URLs; reject javascript:, data:, etc. */
  function isSafeUrl(u) {
    if (!u || typeof u !== 'string') return false;
    try {
      const url = new URL(u, 'https://example.com');
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (e) {
      return false;
    }
  }

  /** Validate hex colours (6-char or 3-char), fallback to a safe default. */
  function safeColor(c, fallback) {
    if (typeof c !== 'string') return fallback;
    return /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(c.trim()) ? c.trim() : fallback;
  }

  /** Clamp a number between min and max. */
  function clamp(n, min, max) {
    n = Number(n);
    if (!isFinite(n)) return min;
    return Math.max(min, Math.min(max, n));
  }

  /** Get initials from a name for the avatar fallback. */
  function initials(name) {
    if (!name) return '?';
    const parts = String(name).trim().split(/\s+/).slice(0, 2);
    return parts.map(p => p[0] || '').join('').toUpperCase() || '?';
  }

  /** Deterministic pastel colour from a string (for avatar backgrounds). */
  function avatarColor(seed) {
    const s = String(seed || '');
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return `hsl(${h % 360}, 55%, 60%)`;
  }

  /**
   * Convert a video URL into an embeddable iframe src.
   * Supports: YouTube (watch?v=, youtu.be/, /shorts/), Vimeo, direct MP4.
   * Returns { type: 'iframe' | 'video' | null, src }.
   */
  function parseVideo(url) {
    if (!isSafeUrl(url)) return { type: null, src: '' };
    try {
      const u = new URL(url);
      // YouTube
      if (/(?:^|\.)youtube\.com$/i.test(u.hostname)) {
        const v = u.searchParams.get('v');
        if (v) return { type: 'iframe', src: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(v)}?rel=0&modestbranding=1&autoplay=1` };
        const m = u.pathname.match(/^\/(?:shorts|embed)\/([\w-]{6,})/);
        if (m) return { type: 'iframe', src: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(m[1])}?rel=0&modestbranding=1&autoplay=1` };
      }
      if (/^youtu\.be$/i.test(u.hostname)) {
        const id = u.pathname.slice(1);
        if (id) return { type: 'iframe', src: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?rel=0&modestbranding=1&autoplay=1` };
      }
      // Vimeo
      if (/(?:^|\.)vimeo\.com$/i.test(u.hostname)) {
        const m = u.pathname.match(/^\/(?:video\/)?(\d+)/);
        if (m) return { type: 'iframe', src: `https://player.vimeo.com/video/${encodeURIComponent(m[1])}?autoplay=1&title=0&byline=0` };
      }
      // Direct MP4 / WebM
      if (/\.(mp4|webm)(\?.*)?$/i.test(u.pathname)) {
        return { type: 'video', src: u.href };
      }
    } catch (e) { /* fall through */ }
    return { type: null, src: '' };
  }

  /** Canonicalise source name to one of KNOWN_SOURCES (case-insensitive). */
  function normaliseSource(s) {
    if (!s) return '';
    const lc = String(s).trim().toLowerCase();
    for (const known of KNOWN_SOURCES) {
      if (known.toLowerCase() === lc) return known;
    }
    return 'Direct';
  }

  // ═══════════════════════════════════════════════════════════
  // Inline SVG icon set
  // ═══════════════════════════════════════════════════════════

  function icon(name, size = 16) {
    const S = Number(size) || 16;
    const I = {
      quote: `<svg viewBox="0 0 32 32" width="${S}" height="${S}" fill="currentColor" aria-hidden="true"><path d="M10.72 24.32c-2.27 0-4.1-.78-5.5-2.34-1.4-1.56-2.1-3.76-2.1-6.58 0-2.83.77-5.38 2.3-7.66 1.54-2.28 3.92-4.3 7.14-6.06l1.4 2.1c-1.9 1.06-3.4 2.22-4.52 3.48-1.12 1.26-1.78 2.58-1.98 3.96 1.2-.4 2.28-.6 3.24-.6 1.97 0 3.58.6 4.82 1.82 1.24 1.2 1.86 2.78 1.86 4.72 0 2.08-.66 3.77-1.98 5.06-1.32 1.4-3.03 2.1-5.12 2.1zm14 0c-2.27 0-4.1-.78-5.5-2.34-1.4-1.56-2.1-3.76-2.1-6.58 0-2.83.77-5.38 2.3-7.66 1.54-2.28 3.92-4.3 7.14-6.06l1.4 2.1c-1.9 1.06-3.4 2.22-4.52 3.48-1.12 1.26-1.78 2.58-1.98 3.96 1.2-.4 2.28-.6 3.24-.6 1.97 0 3.58.6 4.82 1.82 1.24 1.2 1.86 2.78 1.86 4.72 0 2.08-.66 3.77-1.98 5.06-1.32 1.4-3.03 2.1-5.12 2.1z"/></svg>`,
      star: `<svg viewBox="0 0 24 24" width="${S}" height="${S}" fill="currentColor" aria-hidden="true"><path d="M12 .587l3.668 7.431 8.2 1.192-5.934 5.782 1.4 8.168L12 18.896l-7.334 3.868 1.4-8.168L.132 9.21l8.2-1.192z"/></svg>`,
      verified: `<svg viewBox="0 0 24 24" width="${S}" height="${S}" aria-hidden="true"><path d="M12 2l2.4 2.1 3.2-.4 1 3 2.7 1.6-1 3 1 3-2.7 1.6-1 3-3.2-.4L12 22l-2.4-2.1-3.2.4-1-3L2.7 15.7l1-3-1-3 2.7-1.6 1-3 3.2.4z" fill="currentColor"/><path d="M9 12l2 2 4-4" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>`,
      mapPin: `<svg viewBox="0 0 24 24" width="${S}" height="${S}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`,
      calendar: `<svg viewBox="0 0 24 24" width="${S}" height="${S}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
      tag: `<svg viewBox="0 0 24 24" width="${S}" height="${S}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>`,
      play: `<svg viewBox="0 0 24 24" width="${S}" height="${S}" fill="currentColor" aria-hidden="true"><polygon points="6 4 20 12 6 20 6 4"/></svg>`,
      chevL: `<svg viewBox="0 0 24 24" width="${S}" height="${S}" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>`,
      chevR: `<svg viewBox="0 0 24 24" width="${S}" height="${S}" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>`,
      close: `<svg viewBox="0 0 24 24" width="${S}" height="${S}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
    };
    return I[name] || '';
  }

  /**
   * Tiny, recognisable source-logo glyphs. Using simple branded letterforms
   * rather than trademark logos to stay on the right side of brand policy.
   */
  function sourceLogo(src, size = 14) {
    const S = Number(size) || 14;
    const L = {
      Google: `<svg viewBox="0 0 24 24" width="${S}" height="${S}" aria-hidden="true"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C4 20.98 7.7 23 12 23z"/><path fill="#FBBC04" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.21.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 4 3.02 2.18 6.07l3.66 2.84C6.71 6.31 9.14 5.38 12 5.38z"/></svg>`,
      Facebook: `<svg viewBox="0 0 24 24" width="${S}" height="${S}" aria-hidden="true"><path fill="#1877F2" d="M24 12a12 12 0 1 0-13.88 11.86v-8.39H7.08V12h3.04V9.36c0-3 1.79-4.66 4.53-4.66 1.31 0 2.68.23 2.68.23v2.95h-1.51c-1.49 0-1.95.92-1.95 1.87V12h3.32l-.53 3.47h-2.79v8.39A12 12 0 0 0 24 12z"/></svg>`,
      Trustpilot: `<svg viewBox="0 0 24 24" width="${S}" height="${S}" aria-hidden="true"><polygon fill="#00B67A" points="12 2 14.6 9 22 9 16 13.5 18.3 21 12 16.5 5.7 21 8 13.5 2 9 9.4 9"/></svg>`,
      TripAdvisor: `<svg viewBox="0 0 24 24" width="${S}" height="${S}" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#000" /><circle cx="8.2" cy="12" r="3.3" fill="#34E0A1"/><circle cx="15.8" cy="12" r="3.3" fill="#34E0A1"/><circle cx="8.2" cy="12" r="1" fill="#000"/><circle cx="15.8" cy="12" r="1" fill="#000"/></svg>`,
      Direct: `<svg viewBox="0 0 24 24" width="${S}" height="${S}" fill="currentColor" aria-hidden="true"><path d="M12 2L2 7v6c0 5 4 9 10 11 6-2 10-6 10-11V7L12 2z"/></svg>`,
    };
    return L[src] || '';
  }

  // ═══════════════════════════════════════════════════════════
  // Default configuration
  // ═══════════════════════════════════════════════════════════

  const DEFAULT_CONFIG = {
    layout: 'grid',        // featured | grid | masonry | carousel | marquee | spotlight
    header: {
      show: true,
      eyebrow: 'Testimonials',
      title: 'Loved by travellers',
      subtitle: 'Real stories from customers who took the trip of a lifetime.',
    },
    testimonials: [],
    // Display toggles
    showRating: true,
    showSource: true,
    showDestination: true,
    showTripType: true,
    showTravelDate: true,
    showVideo: true,
    showFilters: false,         // chip filter on grid / masonry
    // Grid
    gridCols: 3,                 // 2 or 3
    // Carousel
    carousel: { autoplay: false, interval: 6000, dots: true, arrows: true },
    // Marquee
    marquee: { speed: 40, rows: 2 },
    // Theme
    theme: 'auto',               // light | dark | auto
    brandColor: '#EC4899',
    accentColor: '#8B5CF6',
    radius: 16,
    // Meta
    fontFamily: '', // empty = inherit host site
  };

  // ═══════════════════════════════════════════════════════════
  // Styles (one big string, inlined into shadow DOM)
  // ═══════════════════════════════════════════════════════════

  function buildStyles(c) {
    const brand = safeColor(c.brandColor, '#EC4899');
    const accent = safeColor(c.accentColor, '#8B5CF6');
    const radius = clamp(c.radius, 0, 32);
    const fontStack = c.fontFamily
      ? `${c.fontFamily}, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`
      : `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;

    return `
      :host {
        /* Colour tokens */
        --tgt-brand: ${brand};
        --tgt-accent: ${accent};
        --tgt-star: #F59E0B;
        --tgt-verified: #10B981;

        --tgt-bg: transparent;
        --tgt-card: #FFFFFF;
        --tgt-text: #0F172A;
        --tgt-sub: #475569;
        --tgt-muted: #94A3B8;
        --tgt-border: #E2E8F0;
        --tgt-hover: #F8FAFC;
        --tgt-chip: #F1F5F9;

        /* Shape */
        --tgt-radius: ${radius}px;
        --tgt-radius-sm: ${Math.max(6, radius - 6)}px;
        --tgt-radius-xs: ${Math.max(4, radius - 10)}px;

        /* Shadows */
        --tgt-shadow: 0 1px 2px rgba(15, 23, 42, .04), 0 4px 12px rgba(15, 23, 42, .05);
        --tgt-shadow-lg: 0 8px 30px rgba(15, 23, 42, .08);

        /* Typography */
        --tgt-font: ${fontStack};

        display: block;
        color: var(--tgt-text);
        font-family: var(--tgt-font);
        line-height: 1.55;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
      }

      :host([data-theme="dark"]) {
        --tgt-card: #1E293B;
        --tgt-text: #F1F5F9;
        --tgt-sub: #CBD5E1;
        --tgt-muted: #94A3B8;
        --tgt-border: #334155;
        --tgt-hover: #0F172A;
        --tgt-chip: #334155;
      }
      @media (prefers-color-scheme: dark) {
        :host([data-theme="auto"]) {
          --tgt-card: #1E293B;
          --tgt-text: #F1F5F9;
          --tgt-sub: #CBD5E1;
          --tgt-muted: #94A3B8;
          --tgt-border: #334155;
          --tgt-hover: #0F172A;
          --tgt-chip: #334155;
        }
      }

      *, *::before, *::after { box-sizing: border-box; }

      .tgt-root { width: 100%; max-width: 100%; }

      /* ── Header ───────────────────────────────── */
      .tgt-header { text-align: center; margin: 0 0 32px; }
      .tgt-eyebrow {
        display: inline-block; font-size: 12px; font-weight: 700;
        letter-spacing: .12em; text-transform: uppercase;
        color: var(--tgt-brand); margin: 0 0 10px;
      }
      .tgt-title {
        font-size: clamp(24px, 3.5vw, 36px); font-weight: 800; line-height: 1.15;
        letter-spacing: -0.02em; margin: 0 0 10px; color: var(--tgt-text);
      }
      .tgt-subtitle {
        font-size: 16px; color: var(--tgt-sub);
        margin: 0 auto; max-width: 640px;
      }

      /* ── Filter chips (grid / masonry only) ──── */
      .tgt-filters {
        display: flex; flex-wrap: wrap; justify-content: center; gap: 8px;
        margin: 0 0 28px;
      }
      .tgt-chip {
        font: inherit; font-size: 13px; font-weight: 600;
        padding: 7px 14px; border-radius: 999px;
        background: var(--tgt-chip); color: var(--tgt-sub);
        border: 1px solid transparent; cursor: pointer;
        transition: background 150ms, color 150ms, border-color 150ms;
      }
      .tgt-chip:hover { background: var(--tgt-hover); }
      .tgt-chip[aria-pressed="true"] {
        background: var(--tgt-brand); color: #fff;
      }

      /* ── Card (shared) ────────────────────────── */
      .tgt-card {
        background: var(--tgt-card);
        border: 1px solid var(--tgt-border);
        border-radius: var(--tgt-radius);
        padding: 24px;
        box-shadow: var(--tgt-shadow);
        display: flex; flex-direction: column; gap: 16px;
        position: relative;
        transition: transform 200ms cubic-bezier(.4,0,.2,1), box-shadow 200ms;
      }
      .tgt-card:hover {
        transform: translateY(-2px);
        box-shadow: var(--tgt-shadow-lg);
      }
      @media (prefers-reduced-motion: reduce) {
        .tgt-card { transition: none; }
        .tgt-card:hover { transform: none; }
      }

      .tgt-quote-mark {
        color: var(--tgt-brand); opacity: .2;
        position: absolute; top: 14px; right: 16px;
        pointer-events: none;
      }

      .tgt-quote {
        font-size: 15px; line-height: 1.65; color: var(--tgt-text);
        margin: 0; font-weight: 500;
      }

      .tgt-rating {
        display: inline-flex; align-items: center; gap: 2px;
        color: var(--tgt-star);
      }
      .tgt-rating-empty { color: var(--tgt-border); }

      .tgt-badges {
        display: flex; flex-wrap: wrap; gap: 6px; margin-top: -4px;
      }
      .tgt-badge {
        display: inline-flex; align-items: center; gap: 4px;
        font-size: 12px; font-weight: 600; padding: 4px 10px;
        border-radius: 999px; background: var(--tgt-chip); color: var(--tgt-sub);
      }
      .tgt-badge--trip { background: color-mix(in srgb, var(--tgt-brand) 12%, transparent); color: var(--tgt-brand); }
      .tgt-badge--dest { background: color-mix(in srgb, var(--tgt-accent) 12%, transparent); color: var(--tgt-accent); }
      @supports not (background: color-mix(in srgb, red 50%, blue)) {
        .tgt-badge--trip, .tgt-badge--dest { background: var(--tgt-chip); color: var(--tgt-sub); }
      }

      .tgt-footer {
        display: flex; align-items: center; gap: 12px;
        padding-top: 12px; border-top: 1px solid var(--tgt-border);
      }
      .tgt-avatar {
        width: 44px; height: 44px; border-radius: 50%;
        display: inline-flex; align-items: center; justify-content: center;
        color: #fff; font-weight: 700; font-size: 15px;
        background-size: cover; background-position: center;
        flex-shrink: 0;
      }
      .tgt-author { flex: 1 1 0; min-width: 0; }
      .tgt-author-name {
        font-size: 14px; font-weight: 700; color: var(--tgt-text);
        display: flex; align-items: center; gap: 6px;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .tgt-verified-tick { color: var(--tgt-verified); display: inline-flex; flex-shrink: 0; }
      .tgt-author-meta {
        font-size: 12px; color: var(--tgt-muted);
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .tgt-source {
        display: inline-flex; align-items: center; gap: 4px;
        font-size: 11px; font-weight: 600; color: var(--tgt-muted);
        flex-shrink: 0;
      }
      .tgt-source svg { display: block; }

      /* ── Video ────────────────────────────────── */
      .tgt-video {
        position: relative; border-radius: var(--tgt-radius-sm);
        overflow: hidden; background: #000; cursor: pointer;
        aspect-ratio: 16 / 9;
      }
      .tgt-video-poster {
        position: absolute; inset: 0; width: 100%; height: 100%;
        object-fit: cover; display: block;
      }
      .tgt-video-placeholder {
        position: absolute; inset: 0;
        background: linear-gradient(135deg, var(--tgt-brand), var(--tgt-accent));
      }
      .tgt-video-play {
        position: absolute; inset: 0;
        display: flex; align-items: center; justify-content: center;
        background: linear-gradient(180deg, transparent, rgba(0,0,0,.35));
        transition: background 200ms;
      }
      .tgt-video:hover .tgt-video-play { background: linear-gradient(180deg, transparent, rgba(0,0,0,.55)); }
      .tgt-video-play-btn {
        width: 56px; height: 56px; border-radius: 50%;
        background: rgba(255,255,255,.95); color: var(--tgt-brand);
        display: flex; align-items: center; justify-content: center;
        box-shadow: 0 10px 30px rgba(0,0,0,.3);
      }
      .tgt-video-play-btn svg { margin-left: 4px; }
      .tgt-video iframe, .tgt-video video {
        position: absolute; inset: 0; width: 100%; height: 100%; border: 0;
      }

      /* ═══════════════════════════════════════════════
         LAYOUTS
         ═══════════════════════════════════════════════ */

      /* ── Featured (hero) ──────────────────────── */
      .tgt-featured {
        max-width: 820px; margin: 0 auto; padding: 48px 32px;
        background: linear-gradient(135deg,
          color-mix(in srgb, var(--tgt-brand) 4%, var(--tgt-card)),
          color-mix(in srgb, var(--tgt-accent) 4%, var(--tgt-card)));
        border: 1px solid var(--tgt-border);
        border-radius: var(--tgt-radius);
        text-align: center;
        position: relative;
        overflow: hidden;
      }
      @supports not (background: color-mix(in srgb, red 50%, blue)) {
        .tgt-featured { background: var(--tgt-card); }
      }
      .tgt-featured-mark {
        color: var(--tgt-brand); opacity: .15;
        position: absolute; top: 20px; left: 30px; font-size: 80px; line-height: 1;
      }
      .tgt-featured-quote {
        font-size: clamp(18px, 2.6vw, 24px); line-height: 1.5;
        font-weight: 500; color: var(--tgt-text);
        margin: 0 0 28px; max-width: 680px; margin-left: auto; margin-right: auto;
        position: relative;
      }
      .tgt-featured-footer {
        display: inline-flex; align-items: center; gap: 14px;
      }
      .tgt-featured-footer .tgt-avatar { width: 54px; height: 54px; font-size: 17px; }
      .tgt-featured-author {
        font-size: 16px; font-weight: 700; color: var(--tgt-text);
        display: flex; align-items: center; gap: 6px;
      }
      .tgt-featured-meta { font-size: 13px; color: var(--tgt-sub); margin-top: 2px; }
      .tgt-featured-badges { justify-content: center; margin-top: 20px; }
      .tgt-featured-rating { margin: 0 0 16px; display: inline-flex; gap: 3px; }
      .tgt-featured-dots {
        display: flex; justify-content: center; gap: 8px; margin-top: 32px;
      }
      .tgt-featured-dot {
        width: 8px; height: 8px; border-radius: 50%;
        background: var(--tgt-border); border: none; cursor: pointer; padding: 0;
        transition: background 200ms, transform 200ms;
      }
      .tgt-featured-dot[aria-current="true"] { background: var(--tgt-brand); transform: scale(1.3); }

      /* ── Grid ─────────────────────────────────── */
      .tgt-grid {
        display: grid;
        grid-template-columns: 1fr;
        gap: 20px;
      }
      @media (min-width: 640px) { .tgt-grid--2 { grid-template-columns: repeat(2, 1fr); } }
      @media (min-width: 900px) {
        .tgt-grid--2 { grid-template-columns: repeat(2, 1fr); }
        .tgt-grid--3 { grid-template-columns: repeat(3, 1fr); }
      }

      /* ── Masonry (independent columns, break-inside avoid) ── */
      .tgt-masonry {
        column-count: 1;
        column-gap: 20px;
      }
      @media (min-width: 640px) { .tgt-masonry { column-count: 2; } }
      @media (min-width: 1024px) { .tgt-masonry { column-count: 3; } }
      .tgt-masonry .tgt-card {
        break-inside: avoid;
        -webkit-column-break-inside: avoid;
        page-break-inside: avoid;
        margin-bottom: 20px;
        /* Hover translate inside column layout can cause paint quirks */
        transition: box-shadow 200ms;
      }
      .tgt-masonry .tgt-card:hover { transform: none; }

      /* ── Carousel ─────────────────────────────── */
      .tgt-carousel { position: relative; }
      .tgt-carousel-track {
        display: flex; gap: 20px;
        overflow-x: auto; scroll-snap-type: x mandatory;
        scroll-behavior: smooth;
        padding: 4px 4px 20px;
        scrollbar-width: none;           /* Firefox */
      }
      .tgt-carousel-track::-webkit-scrollbar { display: none; }
      .tgt-carousel-track .tgt-card {
        flex: 0 0 calc(100% - 8px);
        scroll-snap-align: start;
      }
      @media (min-width: 640px) {
        .tgt-carousel-track .tgt-card { flex: 0 0 calc(50% - 10px); }
      }
      @media (min-width: 1024px) {
        .tgt-carousel-track .tgt-card { flex: 0 0 calc(33.333% - 14px); }
      }
      .tgt-carousel-nav {
        display: flex; align-items: center; justify-content: center; gap: 16px;
        margin-top: 8px;
      }
      .tgt-carousel-btn {
        width: 40px; height: 40px; border-radius: 50%; border: 1px solid var(--tgt-border);
        background: var(--tgt-card); color: var(--tgt-text); cursor: pointer;
        display: inline-flex; align-items: center; justify-content: center;
        transition: background 150ms, border-color 150ms, transform 150ms;
      }
      .tgt-carousel-btn:hover { background: var(--tgt-hover); border-color: var(--tgt-brand); }
      .tgt-carousel-btn:disabled { opacity: .4; cursor: not-allowed; }
      .tgt-carousel-dots { display: flex; gap: 8px; }
      .tgt-carousel-dot {
        width: 8px; height: 8px; border-radius: 50%; border: none; padding: 0;
        background: var(--tgt-border); cursor: pointer;
        transition: background 200ms, transform 200ms;
      }
      .tgt-carousel-dot[aria-current="true"] { background: var(--tgt-brand); transform: scale(1.3); }

      /* ── Marquee ──────────────────────────────── */
      .tgt-marquee {
        display: flex; flex-direction: column; gap: 16px;
        overflow: hidden;
        mask-image: linear-gradient(90deg, transparent, black 5%, black 95%, transparent);
        -webkit-mask-image: linear-gradient(90deg, transparent, black 5%, black 95%, transparent);
      }
      .tgt-marquee-row {
        display: flex; gap: 16px; width: max-content;
        animation: tgt-marquee-scroll linear infinite;
      }
      .tgt-marquee-row--reverse { animation-direction: reverse; }
      .tgt-marquee:hover .tgt-marquee-row { animation-play-state: paused; }
      .tgt-marquee .tgt-card {
        width: 360px; flex-shrink: 0;
        transition: none;
      }
      .tgt-marquee .tgt-card:hover { transform: none; }
      @keyframes tgt-marquee-scroll {
        from { transform: translateX(0); }
        to   { transform: translateX(-50%); }
      }
      @media (prefers-reduced-motion: reduce) {
        .tgt-marquee-row { animation: none; flex-wrap: wrap; width: 100%; }
      }

      /* ── Spotlight ────────────────────────────── */
      .tgt-spotlight { display: flex; flex-direction: column; gap: 20px; }
      .tgt-spotlight-main {
        position: relative; min-height: 220px;
      }
      .tgt-spotlight-thumbs {
        display: flex; gap: 10px; overflow-x: auto;
        padding: 4px; scrollbar-width: thin;
      }
      .tgt-spotlight-thumb {
        flex: 0 0 auto;
        display: flex; align-items: center; gap: 10px;
        padding: 10px 16px; border-radius: var(--tgt-radius-sm);
        border: 2px solid var(--tgt-border); background: var(--tgt-card);
        cursor: pointer; font: inherit; color: var(--tgt-sub);
        transition: border-color 150ms, color 150ms;
        max-width: 240px;
      }
      .tgt-spotlight-thumb:hover { border-color: var(--tgt-brand); color: var(--tgt-text); }
      .tgt-spotlight-thumb[aria-pressed="true"] {
        border-color: var(--tgt-brand); color: var(--tgt-text);
      }
      .tgt-spotlight-thumb .tgt-avatar { width: 32px; height: 32px; font-size: 12px; }
      .tgt-spotlight-thumb-text {
        font-size: 13px; font-weight: 600; text-align: left;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }

      /* ── Empty state ──────────────────────────── */
      .tgt-empty {
        text-align: center; padding: 48px 24px;
        background: var(--tgt-card); border: 1px dashed var(--tgt-border);
        border-radius: var(--tgt-radius); color: var(--tgt-muted);
      }
      .tgt-empty-title { font-size: 16px; font-weight: 700; color: var(--tgt-text); margin: 0 0 6px; }
      .tgt-empty-text { font-size: 14px; margin: 0; }

      /* ── Error ──────────────────────────────── */
      .tgt-error {
        padding: 16px; border-radius: var(--tgt-radius-sm);
        background: #FEF2F2; border: 1px solid #FECACA; color: #991B1B;
        font-size: 13px; font-family: var(--tgt-font);
      }
    `;
  }

  // ═══════════════════════════════════════════════════════════
  // Testimonials Widget class
  // ═══════════════════════════════════════════════════════════

  class TestimonialsWidget {
    constructor(host, config) {
      this.host = host;
      this.c = this._mergeConfig(config);
      this.state = {
        activeFilter: 'all',    // trip-type chip filter
        featuredIndex: 0,        // featured layout rotation
        spotlightIndex: 0,       // spotlight main index
        featuredTimer: null,
      };
      this._init();
    }

    // ── Config merge ─────────────────────────────
    _mergeConfig(user) {
      const u = user || {};
      // Back-compat: accept FAQ-editor-style colors.brand / colors.accent as aliases
      // for brandColor / accentColor at the top level. Editor uses colors.* shape
      // for rich palette management; widget internally uses *Color.
      if (u.colors && typeof u.colors === 'object') {
        if (u.colors.brand && !u.brandColor) u.brandColor = u.colors.brand;
        if (u.colors.accent && !u.accentColor) u.accentColor = u.colors.accent;
      }
      const merged = {
        ...DEFAULT_CONFIG,
        ...u,
        header: { ...DEFAULT_CONFIG.header, ...(u.header || {}) },
        carousel: { ...DEFAULT_CONFIG.carousel, ...(u.carousel || {}) },
        marquee: { ...DEFAULT_CONFIG.marquee, ...(u.marquee || {}) },
      };
      // Sanitise enums
      const L = ['featured', 'grid', 'masonry', 'carousel', 'marquee', 'spotlight'];
      if (!L.includes(merged.layout)) merged.layout = 'grid';
      const T = ['light', 'dark', 'auto'];
      if (!T.includes(merged.theme)) merged.theme = 'auto';
      merged.gridCols = clamp(merged.gridCols, 2, 3);
      // Normalise testimonials array
      merged.testimonials = Array.isArray(merged.testimonials)
        ? merged.testimonials.map((t, i) => this._normaliseTestimonial(t, i)).filter(Boolean)
        : [];
      return merged;
    }

    _normaliseTestimonial(t, i) {
      if (!t || typeof t !== 'object') return null;
      if (t.hidden) return null;
      const quote = String(t.quote || '').trim();
      const author = String(t.author || '').trim();
      if (!quote || !author) return null;
      return {
        id: String(t.id || ('t' + i)),
        quote,
        author,
        role: String(t.role || '').trim(),
        location: String(t.location || '').trim(),
        avatar: isSafeUrl(t.avatar) ? t.avatar : '',
        rating: Number.isFinite(Number(t.rating)) ? clamp(Number(t.rating), 0, 5) : 0,
        destination: String(t.destination || '').trim(),
        tripType: String(t.tripType || '').trim(),
        travelDate: String(t.travelDate || '').trim(),
        source: normaliseSource(t.source),
        verified: !!t.verified,
        video: isSafeUrl(t.video) ? t.video : '',
        featured: !!t.featured,
      };
    }

    // ── Init ─────────────────────────────────────
    _init() {
      // Shadow DOM
      this.root = this.host.attachShadow({ mode: 'open' });
      // Theme
      this.root.host.setAttribute('data-theme', this.c.theme);
      // Style
      const style = document.createElement('style');
      style.textContent = buildStyles(this.c);
      this.root.appendChild(style);
      // Container
      this.container = document.createElement('div');
      this.container.className = 'tgt-root';
      this.root.appendChild(this.container);
      // Render
      this.render();
    }

    // ── Public render ────────────────────────────
    render() {
      this._clearTimers();
      const list = this._filtered();
      const header = this._renderHeader();
      const filters = this._shouldShowFilters() ? this._renderFilters() : '';
      let body;
      if (!list.length) {
        body = `<div class="tgt-empty">
          <p class="tgt-empty-title">No testimonials to show</p>
          <p class="tgt-empty-text">Testimonials will appear here once added.</p>
        </div>`;
      } else {
        switch (this.c.layout) {
          case 'featured':  body = this._renderFeatured(list);  break;
          case 'masonry':   body = this._renderMasonry(list);   break;
          case 'carousel':  body = this._renderCarousel(list);  break;
          case 'marquee':   body = this._renderMarquee(list);   break;
          case 'spotlight': body = this._renderSpotlight(list); break;
          case 'grid':
          default:          body = this._renderGrid(list);      break;
        }
      }
      this.container.innerHTML = header + filters + body;
      this._bind();
    }

    _filtered() {
      const items = this.c.testimonials.slice();
      if (this.state.activeFilter === 'all' || !this._shouldShowFilters()) {
        // Featured-first sort for grid/masonry; others use source order
        if (this.c.layout === 'grid' || this.c.layout === 'masonry') {
          items.sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0));
        }
        return items;
      }
      return items.filter(t => t.tripType === this.state.activeFilter);
    }

    _shouldShowFilters() {
      if (!this.c.showFilters) return false;
      if (this.c.layout !== 'grid' && this.c.layout !== 'masonry') return false;
      return this._tripTypes().length > 1;
    }

    _tripTypes() {
      const seen = new Set();
      const out = [];
      for (const t of this.c.testimonials) {
        if (t.tripType && !seen.has(t.tripType)) {
          seen.add(t.tripType);
          out.push(t.tripType);
        }
      }
      return out;
    }

    // ── Header + filters ─────────────────────────
    _renderHeader() {
      if (!this.c.header || !this.c.header.show) return '';
      const h = this.c.header;
      const parts = [];
      if (h.eyebrow) parts.push(`<div class="tgt-eyebrow">${esc(h.eyebrow)}</div>`);
      if (h.title)   parts.push(`<h2 class="tgt-title">${esc(h.title)}</h2>`);
      if (h.subtitle) parts.push(`<p class="tgt-subtitle">${esc(h.subtitle)}</p>`);
      if (!parts.length) return '';
      return `<div class="tgt-header">${parts.join('')}</div>`;
    }

    _renderFilters() {
      const types = this._tripTypes();
      const all = `<button class="tgt-chip" type="button" data-filter="all" aria-pressed="${this.state.activeFilter === 'all'}">All</button>`;
      const chips = types.map(t => `<button class="tgt-chip" type="button" data-filter="${esc(t)}" aria-pressed="${this.state.activeFilter === t}">${esc(t)}</button>`).join('');
      return `<div class="tgt-filters" role="group" aria-label="Filter by trip type">${all}${chips}</div>`;
    }

    // ── Shared card renderer ─────────────────────
    _card(t, opts) {
      opts = opts || {};
      const videoEl = (this.c.showVideo && t.video) ? this._videoHTML(t) : '';
      const quoteEl = `<p class="tgt-quote">${esc(t.quote)}</p>`;
      const ratingEl = (this.c.showRating && t.rating > 0) ? this._ratingHTML(t.rating) : '';
      const badges = this._badgesHTML(t);
      const footer = this._footerHTML(t);
      const quoteMark = !videoEl ? `<span class="tgt-quote-mark">${icon('quote', 40)}</span>` : '';
      return `<article class="tgt-card" data-id="${esc(t.id)}">
        ${quoteMark}
        ${videoEl}
        ${ratingEl}
        ${quoteEl}
        ${badges}
        ${footer}
      </article>`;
    }

    _ratingHTML(n) {
      const full = Math.round(Number(n) || 0);
      let out = '<div class="tgt-rating" aria-label="Rated ' + full + ' out of 5">';
      for (let i = 1; i <= 5; i++) {
        out += i <= full ? icon('star', 16) : `<span class="tgt-rating-empty">${icon('star', 16)}</span>`;
      }
      return out + '</div>';
    }

    _badgesHTML(t) {
      const parts = [];
      if (this.c.showTripType && t.tripType) {
        parts.push(`<span class="tgt-badge tgt-badge--trip">${icon('tag', 11)}${esc(t.tripType)}</span>`);
      }
      if (this.c.showDestination && t.destination) {
        parts.push(`<span class="tgt-badge tgt-badge--dest">${icon('mapPin', 11)}${esc(t.destination)}</span>`);
      }
      if (this.c.showTravelDate && t.travelDate) {
        parts.push(`<span class="tgt-badge">${icon('calendar', 11)}${esc(t.travelDate)}</span>`);
      }
      if (!parts.length) return '';
      return `<div class="tgt-badges">${parts.join('')}</div>`;
    }

    _avatarHTML(t, size) {
      const s = size || 44;
      if (t.avatar) {
        return `<div class="tgt-avatar" style="background-image:url('${esc(t.avatar)}');width:${s}px;height:${s}px"></div>`;
      }
      return `<div class="tgt-avatar" style="background:${avatarColor(t.author)};width:${s}px;height:${s}px">${esc(initials(t.author))}</div>`;
    }

    _footerHTML(t) {
      const avatar = this._avatarHTML(t);
      const nameBits = [esc(t.author)];
      const verifiedTick = t.verified ? `<span class="tgt-verified-tick" title="Verified">${icon('verified', 14)}</span>` : '';
      const metaBits = [t.role, t.location].filter(Boolean).map(esc);
      const sourceEl = (this.c.showSource && t.source)
        ? `<span class="tgt-source" title="${esc(t.source)}">${sourceLogo(t.source, 14)}</span>`
        : '';
      return `<div class="tgt-footer">
        ${avatar}
        <div class="tgt-author">
          <div class="tgt-author-name">${nameBits.join('')}${verifiedTick}</div>
          ${metaBits.length ? `<div class="tgt-author-meta">${metaBits.join(' · ')}</div>` : ''}
        </div>
        ${sourceEl}
      </div>`;
    }

    _videoHTML(t) {
      const v = parseVideo(t.video);
      if (!v.type) return '';
      const hasPoster = t.avatar && isSafeUrl(t.avatar);
      return `<div class="tgt-video" data-video="${esc(t.video)}" role="button" tabindex="0" aria-label="Play video testimonial from ${esc(t.author)}">
        ${hasPoster
          ? `<img class="tgt-video-poster" src="${esc(t.avatar)}" alt="">`
          : `<div class="tgt-video-placeholder"></div>`
        }
        <div class="tgt-video-play">
          <div class="tgt-video-play-btn">${icon('play', 22)}</div>
        </div>
      </div>`;
    }

    // ═══════════════════════════════════════════════
    // Layout renderers
    // ═══════════════════════════════════════════════

    _renderFeatured(list) {
      const i = clamp(this.state.featuredIndex, 0, list.length - 1);
      const t = list[i];
      const ratingEl = (this.c.showRating && t.rating > 0) ? `<div class="tgt-featured-rating">${this._ratingHTML(t.rating).replace('class="tgt-rating"', 'class="tgt-rating" style="font-size:18px"')}</div>` : '';
      const dotsEl = list.length > 1
        ? `<div class="tgt-featured-dots" role="tablist" aria-label="Testimonial slide">
            ${list.map((_, idx) => `<button class="tgt-featured-dot" type="button" role="tab" data-slide="${idx}" aria-current="${idx === i}" aria-label="Show testimonial ${idx + 1}"></button>`).join('')}
          </div>`
        : '';
      const badges = this._badgesHTML(t);
      const verifiedTick = t.verified ? `<span class="tgt-verified-tick">${icon('verified', 16)}</span>` : '';
      const metaBits = [t.role, t.location, t.travelDate].filter(Boolean).map(esc);
      const sourceEl = (this.c.showSource && t.source)
        ? `<span class="tgt-source">${sourceLogo(t.source, 14)} ${esc(t.source)}</span>`
        : '';

      return `<section class="tgt-featured" aria-roledescription="testimonial">
        <span class="tgt-featured-mark" aria-hidden="true">${icon('quote', 70)}</span>
        ${ratingEl}
        <blockquote class="tgt-featured-quote">${esc(t.quote)}</blockquote>
        ${badges ? badges.replace('class="tgt-badges"', 'class="tgt-badges tgt-featured-badges"') : ''}
        <div class="tgt-featured-footer">
          ${this._avatarHTML(t, 54)}
          <div style="text-align:left">
            <div class="tgt-featured-author">${esc(t.author)}${verifiedTick}</div>
            ${metaBits.length ? `<div class="tgt-featured-meta">${metaBits.join(' · ')} ${sourceEl}</div>` : (sourceEl ? `<div class="tgt-featured-meta">${sourceEl}</div>` : '')}
          </div>
        </div>
        ${dotsEl}
      </section>`;
    }

    _renderGrid(list) {
      const cls = `tgt-grid tgt-grid--${this.c.gridCols}`;
      return `<div class="${cls}">${list.map(t => this._card(t)).join('')}</div>`;
    }

    _renderMasonry(list) {
      return `<div class="tgt-masonry">${list.map(t => this._card(t)).join('')}</div>`;
    }

    _renderCarousel(list) {
      const cards = list.map(t => this._card(t)).join('');
      const showArrows = !!this.c.carousel.arrows && list.length > 1;
      const showDots = !!this.c.carousel.dots && list.length > 1;
      const dotsEl = showDots
        ? `<div class="tgt-carousel-dots" role="tablist" aria-label="Testimonial navigation">
            ${list.map((_, i) => `<button class="tgt-carousel-dot" type="button" role="tab" data-slide="${i}" aria-current="${i === 0}" aria-label="Go to testimonial ${i + 1}"></button>`).join('')}
          </div>`
        : '';
      const prevBtn = showArrows ? `<button class="tgt-carousel-btn" type="button" data-dir="prev" aria-label="Previous">${icon('chevL', 18)}</button>` : '';
      const nextBtn = showArrows ? `<button class="tgt-carousel-btn" type="button" data-dir="next" aria-label="Next">${icon('chevR', 18)}</button>` : '';
      const navEl = (showArrows || showDots)
        ? `<div class="tgt-carousel-nav">${prevBtn}${dotsEl}${nextBtn}</div>`
        : '';
      return `<div class="tgt-carousel">
        <div class="tgt-carousel-track" role="region" aria-label="Testimonials">${cards}</div>
        ${navEl}
      </div>`;
    }

    _renderMarquee(list) {
      const speed = clamp(this.c.marquee.speed, 10, 120);
      const duration = Math.round((list.length * 360) / speed);
      const rows = clamp(this.c.marquee.rows, 1, 2);
      const mkRow = (items, reverse) => {
        const cards = items.map(t => this._card(t)).join('');
        return `<div class="tgt-marquee-row${reverse ? ' tgt-marquee-row--reverse' : ''}" style="animation-duration:${duration}s">
          ${cards}${cards}
        </div>`;
      };
      if (rows === 1 || list.length < 2) {
        return `<div class="tgt-marquee">${mkRow(list, false)}</div>`;
      }
      // Two rows: split first-half / second-half. If either half ends up empty
      // (shouldn't happen since list.length >= 2), fall back to the full list.
      const half = Math.ceil(list.length / 2);
      const a = list.slice(0, half);
      const b = list.slice(half);
      return `<div class="tgt-marquee">
        ${mkRow(a.length ? a : list, false)}
        ${mkRow(b.length ? b : list, true)}
      </div>`;
    }

    _renderSpotlight(list) {
      const i = clamp(this.state.spotlightIndex, 0, list.length - 1);
      const active = list[i];
      const main = `<div class="tgt-spotlight-main">${this._card(active)}</div>`;
      const thumbs = list.length > 1
        ? `<div class="tgt-spotlight-thumbs" role="tablist" aria-label="Testimonial selector">
            ${list.map((t, idx) => `<button class="tgt-spotlight-thumb" type="button" role="tab" data-slide="${idx}" aria-pressed="${idx === i}">
              ${this._avatarHTML(t, 32)}
              <span class="tgt-spotlight-thumb-text">${esc(t.author)}</span>
            </button>`).join('')}
          </div>`
        : '';
      return `<div class="tgt-spotlight">${main}${thumbs}</div>`;
    }

    // ═══════════════════════════════════════════════
    // Event binding
    // ═══════════════════════════════════════════════

    _bind() {
      // Filter chips
      this.root.querySelectorAll('.tgt-chip').forEach(btn => {
        btn.addEventListener('click', () => {
          const f = btn.getAttribute('data-filter');
          if (!f || f === this.state.activeFilter) return;
          this.state.activeFilter = f;
          this.render();
        });
      });

      // Featured dots
      this.root.querySelectorAll('.tgt-featured-dot').forEach(dot => {
        dot.addEventListener('click', () => {
          const n = Number(dot.getAttribute('data-slide'));
          if (!Number.isFinite(n)) return;
          this.state.featuredIndex = n;
          this.render();
        });
      });

      // Featured auto-rotate (respect reduced motion)
      if (this.c.layout === 'featured' && this.c.testimonials.length > 1 && !this._prefersReducedMotion()) {
        const total = this._filtered().length;
        if (total > 1) {
          this.state.featuredTimer = setInterval(() => {
            this.state.featuredIndex = (this.state.featuredIndex + 1) % total;
            this.render();
          }, 6500);
        }
      }

      // Carousel arrows
      this.root.querySelectorAll('.tgt-carousel-btn').forEach(btn => {
        btn.addEventListener('click', () => this._carouselStep(btn.getAttribute('data-dir')));
      });
      // Carousel dots
      this.root.querySelectorAll('.tgt-carousel-dot').forEach(dot => {
        dot.addEventListener('click', () => this._carouselGoTo(Number(dot.getAttribute('data-slide'))));
      });
      // Carousel scroll → update dots
      const track = this.root.querySelector('.tgt-carousel-track');
      if (track) {
        track.addEventListener('scroll', () => this._carouselUpdateDots(), { passive: true });
      }
      // Carousel autoplay
      if (this.c.layout === 'carousel' && this.c.carousel.autoplay && !this._prefersReducedMotion()) {
        const interval = clamp(this.c.carousel.interval, 2000, 20000);
        this.state.carouselTimer = setInterval(() => this._carouselStep('next'), interval);
        if (track) {
          track.addEventListener('mouseenter', () => clearInterval(this.state.carouselTimer));
        }
      }

      // Spotlight thumbs
      this.root.querySelectorAll('.tgt-spotlight-thumb').forEach(btn => {
        btn.addEventListener('click', () => {
          const n = Number(btn.getAttribute('data-slide'));
          if (!Number.isFinite(n)) return;
          this.state.spotlightIndex = n;
          this.render();
        });
      });

      // Video click-to-play
      this.root.querySelectorAll('.tgt-video').forEach(box => {
        const play = () => this._playVideo(box);
        box.addEventListener('click', play);
        box.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); play(); }
        });
      });
    }

    _carouselStep(dir) {
      const track = this.root.querySelector('.tgt-carousel-track');
      if (!track) return;
      const card = track.querySelector('.tgt-card');
      if (!card) return;
      const step = card.getBoundingClientRect().width + 20;
      track.scrollBy({ left: dir === 'next' ? step : -step, behavior: 'smooth' });
    }

    _carouselGoTo(n) {
      const track = this.root.querySelector('.tgt-carousel-track');
      if (!track) return;
      const cards = track.querySelectorAll('.tgt-card');
      const target = cards[n];
      if (!target) return;
      track.scrollTo({ left: target.offsetLeft - track.offsetLeft, behavior: 'smooth' });
    }

    _carouselUpdateDots() {
      const track = this.root.querySelector('.tgt-carousel-track');
      if (!track) return;
      const cards = track.querySelectorAll('.tgt-card');
      if (!cards.length) return;
      const trackLeft = track.scrollLeft;
      let best = 0, bestDist = Infinity;
      cards.forEach((c, i) => {
        const d = Math.abs(c.offsetLeft - track.offsetLeft - trackLeft);
        if (d < bestDist) { bestDist = d; best = i; }
      });
      this.root.querySelectorAll('.tgt-carousel-dot').forEach((dot, i) => {
        dot.setAttribute('aria-current', i === best ? 'true' : 'false');
      });
    }

    _playVideo(box) {
      const url = box.getAttribute('data-video');
      const v = parseVideo(url);
      if (!v.type) return;
      if (v.type === 'iframe') {
        box.innerHTML = `<iframe src="${esc(v.src)}" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen title="Video testimonial"></iframe>`;
      } else {
        box.innerHTML = `<video src="${esc(v.src)}" controls autoplay playsinline></video>`;
      }
      box.removeAttribute('role');
      box.removeAttribute('tabindex');
    }

    _prefersReducedMotion() {
      try {
        return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      } catch (e) { return false; }
    }

    _clearTimers() {
      if (this.state.featuredTimer) { clearInterval(this.state.featuredTimer); this.state.featuredTimer = null; }
      if (this.state.carouselTimer) { clearInterval(this.state.carouselTimer); this.state.carouselTimer = null; }
    }

    destroy() {
      this._clearTimers();
      if (this.root && this.root.host === this.host) {
        this.host.innerHTML = '';
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Auto-init
  // ═══════════════════════════════════════════════════════════

  async function loadConfig(widgetId) {
    const url = `${API_BASE}/api/widget-config?id=${encodeURIComponent(widgetId)}`;
    const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!r.ok) throw new Error(`Failed to load widget config (HTTP ${r.status})`);
    return r.json();
  }

  function initHost(host) {
    if (host._tgtInit) return; // guard against double-init
    host._tgtInit = true;

    // Inline config takes precedence
    const inline = host.getAttribute('data-tg-config');
    if (inline) {
      try {
        const cfg = JSON.parse(inline);
        new TestimonialsWidget(host, cfg);
        return;
      } catch (e) {
        console.error('[tg-testimonials] Invalid data-tg-config JSON:', e);
        host.innerHTML = `<div style="padding:16px;border:1px solid #FECACA;border-radius:8px;background:#FEF2F2;color:#991B1B;font-family:sans-serif;font-size:13px">Testimonials widget: invalid configuration.</div>`;
        return;
      }
    }

    // Remote config by widget ID
    const id = host.getAttribute('data-tg-id');
    if (!id) {
      console.warn('[tg-testimonials] Host missing data-tg-id or data-tg-config');
      return;
    }

    loadConfig(id)
      .then(cfg => { new TestimonialsWidget(host, cfg); })
      .catch(err => {
        console.error('[tg-testimonials]', err);
        host.innerHTML = `<div style="padding:16px;border:1px solid #FECACA;border-radius:8px;background:#FEF2F2;color:#991B1B;font-family:sans-serif;font-size:13px">Testimonials widget failed to load.</div>`;
      });
  }

  function autoInit() {
    document.querySelectorAll('[data-tg-widget="testimonials"]').forEach(initHost);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInit);
  } else {
    autoInit();
  }

  // Expose for programmatic use (editor preview, debugging)
  window.TGTestimonials = {
    init: initHost,
    version: VERSION,
    Widget: TestimonialsWidget,
  };
})();
