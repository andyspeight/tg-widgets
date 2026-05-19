/**
 * Travelgenix Team Showcase Widget v1.0.0
 * Self-contained, embeddable widget
 * Zero dependencies — works on any website via a single script tag
 *
 * Features
 *  - 4 layouts: grid, compact, carousel, spotlight
 *  - Rich member profile: photo, name, role, department, bio,
 *    specialisms, years, languages, social links, featured flag
 *  - Department filter chips (only renders if 2+ departments used)
 *  - Social icons: LinkedIn, Email, Phone, WhatsApp, Instagram, Facebook
 *  - Dark mode (`theme: "dark" | "light" | "auto"`)
 *  - Respects prefers-reduced-motion (disables carousel autoplay,
 *    spotlight fade)
 *  - Fully responsive from 320px upwards
 *  - ARIA-compliant, keyboard accessible
 *  - XSS-hardened: all user content escaped; URLs validated
 *
 * Usage (remote config):
 *   <div data-tg-widget="team" data-tg-id="YOUR_WIDGET_ID"></div>
 *   <script src="https://tg-widgets.vercel.app/widget-team.js"></script>
 *
 * Usage (inline config):
 *   <div data-tg-widget="team" data-tg-config='{"layout":"grid",...}'></div>
 *   <script src="https://tg-widgets.vercel.app/widget-team.js"></script>
 *
 * © Travelgenix. All rights reserved.
 */
(function () {
  'use strict';

  // ═══════════════════════════════════════════════════════════
  // API base resolution
  // ═══════════════════════════════════════════════════════════
  function resolveApiBase() {
    if (typeof window === 'undefined') return '/api/widget-config';
    if (window.__TG_WIDGET_API__) return window.__TG_WIDGET_API__;
    try {
      const me = document.currentScript;
      if (me && me.src) return new URL(me.src).origin + '/api/widget-config';
      const scripts = document.getElementsByTagName('script');
      for (let i = scripts.length - 1; i >= 0; i--) {
        const s = scripts[i].src || '';
        if (/\/widget\-team\.js(\?|$|#)/.test(s)) {
          return new URL(s).origin + '/api/widget-config';
        }
      }
    } catch (e) { /* fall through */ }
    return '/api/widget-config';
  }

  const API_BASE = resolveApiBase();
  const VERSION = '1.0.0';

  // ═══════════════════════════════════════════════════════════
  // Utilities
  // ═══════════════════════════════════════════════════════════

  /** HTML-escape user content before interpolating into innerHTML. */
  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Allowlist URLs. Blocks javascript:, vbscript:, data: (except data:image/*),
   * and other dangerous schemes. Returns '' for anything not on the allowlist.
   */
  function safeUrl(u) {
    if (!u) return '';
    const s = String(u).trim();
    if (!s) return '';
    if (/^javascript:/i.test(s) || /^vbscript:/i.test(s)) return '';
    if (/^data:/i.test(s)) return '';
    // Allow http, https, mailto, tel, anchors and relative paths
    if (/^(https?:|mailto:|tel:|#|\/|\?)/i.test(s)) return s;
    // Bare domain (e.g. "linkedin.com/in/jane") — prepend https
    if (/^[a-z0-9.-]+\.[a-z]{2,}/i.test(s)) return 'https://' + s;
    return '';
  }

  /** Image URLs: allow data:image/* for inline placeholders, block scripts. */
  function safeImageUrl(u) {
    if (!u) return '';
    const s = String(u).trim();
    if (!s) return '';
    if (/^javascript:/i.test(s) || /^vbscript:/i.test(s)) return '';
    if (/^data:/i.test(s) && !/^data:image\//i.test(s)) return '';
    return s;
  }

  /** Build a WhatsApp URL from a phone number (digits + optional + prefix). */
  function whatsappUrl(phone) {
    if (!phone) return '';
    const digits = String(phone).replace(/[^\d+]/g, '').replace(/^\+/, '');
    if (!digits || digits.length < 5) return '';
    return 'https://wa.me/' + digits;
  }

  /** Build a tel: URL safely. */
  function telUrl(phone) {
    if (!phone) return '';
    const digits = String(phone).replace(/[^\d+]/g, '');
    if (!digits) return '';
    return 'tel:' + digits;
  }

  /** Build a mailto: URL with basic email validation. */
  function mailtoUrl(email) {
    if (!email) return '';
    const s = String(email).trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return '';
    return 'mailto:' + s;
  }

  /** Generate stable initials from a name for the avatar fallback. */
  function initials(name) {
    if (!name) return '?';
    const parts = String(name).trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  }

  /** Hash a string to a deterministic colour for avatar fallbacks. */
  function avatarColor(name) {
    const palette = [
      '#0891B2', '#6366F1', '#8B5CF6', '#EC4899', '#F59E0B',
      '#10B981', '#3B82F6', '#EF4444', '#14B8A6', '#F97316',
    ];
    let h = 0;
    const s = String(name || '');
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return palette[Math.abs(h) % palette.length];
  }

  // ═══════════════════════════════════════════════════════════
  // Icons (inline SVG strings — no external deps)
  // ═══════════════════════════════════════════════════════════
  const IC = {
    linkedin: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.5 2h-17A1.5 1.5 0 002 3.5v17A1.5 1.5 0 003.5 22h17a1.5 1.5 0 001.5-1.5v-17A1.5 1.5 0 0020.5 2zM8 19H5v-9h3zM6.5 8.25A1.75 1.75 0 118.3 6.5a1.78 1.78 0 01-1.8 1.75zM19 19h-3v-4.74c0-1.42-.6-1.93-1.38-1.93A1.74 1.74 0 0013 14.19a.66.66 0 000 .14V19h-3v-9h2.9v1.3a3.11 3.11 0 012.7-1.4c1.55 0 3.36.86 3.36 3.66z"/></svg>',
    mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>',
    phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
    whatsapp: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.5 14.4c-.3-.1-1.7-.8-2-.9-.3-.1-.5-.1-.7.1-.2.3-.7.9-.9 1.1-.2.2-.3.2-.6.1-.3-.1-1.2-.5-2.3-1.5-.9-.8-1.4-1.7-1.6-2-.2-.3 0-.5.1-.6.1-.1.3-.3.4-.5.1-.2.2-.3.3-.5.1-.2 0-.4 0-.5 0-.1-.7-1.7-.9-2.3-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.4 0 1.4 1 2.8 1.2 3 .1.2 2 3 4.8 4.2.7.3 1.2.5 1.6.6.7.2 1.3.2 1.8.1.5-.1 1.7-.7 1.9-1.4.2-.7.2-1.2.2-1.4-.1-.1-.3-.2-.6-.3zM12 2C6.5 2 2 6.5 2 12c0 1.8.5 3.5 1.3 4.9L2 22l5.3-1.4c1.4.8 3 1.2 4.7 1.2 5.5 0 10-4.5 10-10S17.5 2 12 2zm0 18c-1.5 0-3-.4-4.3-1.1l-.3-.2-3.2.8.9-3.1-.2-.3C4.3 14.7 4 13.4 4 12 4 7.6 7.6 4 12 4s8 3.6 8 8-3.6 8-8 8z"/></svg>',
    instagram: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>',
    facebook: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M22 12c0-5.52-4.48-10-10-10S2 6.48 2 12c0 4.84 3.44 8.87 8 9.8V15H8v-3h2V9.5C10 7.57 11.57 6 13.5 6H16v3h-2c-.55 0-1 .45-1 1v2h3v3h-3v6.95c5.05-.5 9-4.76 9-9.95z"/></svg>',
    globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
    star: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
    chevronLeft: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>',
    chevronRight: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>',
  };

  // ═══════════════════════════════════════════════════════════
  // Defaults
  // ═══════════════════════════════════════════════════════════
  const DEFAULTS = {
    layout: 'grid',           // grid | compact | carousel | spotlight
    columns: 3,               // grid: 2 | 3 | 4
    theme: 'light',           // light | dark | auto
    brand: '#0891B2',
    accent: '#6366F1',
    radius: 16,
    fontFamily: 'Inter',

    // Heading block
    showHeading: true,
    eyebrow: 'Our Team',
    title: 'Meet the experts behind your trip',
    subtitle: 'Decades of travel experience, ready to plan your perfect getaway.',

    // Department filter
    showDepartmentFilter: true,

    // Contact icons row on each card
    showContactIcons: true,

    // Carousel-specific
    carouselAutoplay: false,
    carouselInterval: 5000,

    // Members
    members: [],
  };

  // ═══════════════════════════════════════════════════════════
  // Styles (injected into Shadow DOM)
  // ═══════════════════════════════════════════════════════════
  const STYLES = `
    :host {
      all: initial;
      display: block;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    *, *::before, *::after { box-sizing: border-box; }

    .tgt-root {
      --tgt-brand: #0891B2;
      --tgt-accent: #6366F1;
      --tgt-bg: #FFFFFF;
      --tgt-card: #F8FAFC;
      --tgt-card-hover: #F1F5F9;
      --tgt-text: #0F172A;
      --tgt-sub: #64748B;
      --tgt-muted: #94A3B8;
      --tgt-border: #E2E8F0;
      --tgt-radius: 16px;
      --tgt-radius-sm: 10px;
      --tgt-shadow: 0 1px 2px rgba(15, 23, 42, 0.04), 0 1px 3px rgba(15, 23, 42, 0.06);
      --tgt-shadow-hover: 0 4px 6px rgba(15, 23, 42, 0.06), 0 10px 15px rgba(15, 23, 42, 0.08);
      color: var(--tgt-text);
      background: var(--tgt-bg);
      padding: 32px 24px;
      border-radius: var(--tgt-radius);
      /* Container queries — respond to widget width, not viewport.
         Critical for Shadow DOM: viewport-based @media doesn't react to
         the editor's tablet/mobile preview frames, nor to clients who
         embed the widget in a narrow column. */
      container-type: inline-size;
      container-name: tgt;
    }
    .tgt-root[data-theme="dark"] {
      --tgt-bg: #0F172A;
      --tgt-card: #1E293B;
      --tgt-card-hover: #283449;
      --tgt-text: #F1F5F9;
      --tgt-sub: #94A3B8;
      --tgt-muted: #64748B;
      --tgt-border: #334155;
      --tgt-shadow: 0 1px 2px rgba(0, 0, 0, 0.2), 0 1px 3px rgba(0, 0, 0, 0.3);
      --tgt-shadow-hover: 0 4px 6px rgba(0, 0, 0, 0.3), 0 10px 15px rgba(0, 0, 0, 0.4);
    }

    /* ───── Heading ───── */
    .tgt-heading {
      text-align: center;
      max-width: 720px;
      margin: 0 auto 32px;
    }
    .tgt-eyebrow {
      display: inline-block;
      font-size: 13px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--tgt-brand);
      margin-bottom: 12px;
    }
    .tgt-title {
      font-size: 28px;
      font-weight: 700;
      line-height: 1.2;
      margin: 0 0 12px;
      color: var(--tgt-text);
    }
    .tgt-subtitle {
      font-size: 16px;
      line-height: 1.55;
      color: var(--tgt-sub);
      margin: 0;
    }
    @container tgt (min-width: 720px) {
      .tgt-title { font-size: 32px; }
    }

    /* ───── Department filter chips ───── */
    .tgt-filter {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      justify-content: center;
      margin-bottom: 32px;
    }
    .tgt-chip {
      appearance: none;
      border: 1px solid var(--tgt-border);
      background: var(--tgt-card);
      color: var(--tgt-sub);
      padding: 8px 16px;
      border-radius: 999px;
      font-size: 13px;
      font-weight: 500;
      font-family: inherit;
      cursor: pointer;
      transition: background 160ms ease, color 160ms ease, border-color 160ms ease;
    }
    .tgt-chip:hover { background: var(--tgt-card-hover); color: var(--tgt-text); }
    .tgt-chip.is-on {
      background: var(--tgt-brand);
      border-color: var(--tgt-brand);
      color: #FFFFFF;
    }
    .tgt-chip:focus-visible {
      outline: 2px solid var(--tgt-accent);
      outline-offset: 2px;
    }

    /* ───── Card primitives (shared) ───── */
    .tgt-card {
      background: var(--tgt-card);
      border: 1px solid var(--tgt-border);
      border-radius: var(--tgt-radius);
      box-shadow: var(--tgt-shadow);
      overflow: hidden;
      transition: transform 220ms ease, box-shadow 220ms ease;
      display: flex;
      flex-direction: column;
    }
    .tgt-card:hover {
      transform: translateY(-2px);
      box-shadow: var(--tgt-shadow-hover);
    }
    @media (prefers-reduced-motion: reduce) {
      .tgt-card:hover { transform: none; }
    }

    .tgt-photo {
      position: relative;
      width: 100%;
      aspect-ratio: 4 / 5;
      background: var(--tgt-card-hover);
      overflow: hidden;
      flex-shrink: 0;
    }
    .tgt-photo img {
      width: 100%; height: 100%;
      object-fit: cover;
      display: block;
    }
    .tgt-photo--fallback {
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 48px;
      font-weight: 700;
      color: #FFFFFF;
      letter-spacing: 0.02em;
    }

    .tgt-body {
      padding: 18px 20px 20px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      flex: 1;
      min-width: 0;
    }
    .tgt-name {
      font-size: 16px;
      font-weight: 600;
      color: var(--tgt-text);
      margin: 0;
      line-height: 1.3;
      letter-spacing: -0.01em;
    }
    .tgt-role {
      font-size: 13px;
      font-weight: 500;
      color: var(--tgt-brand);
      margin: 0 0 8px;
      line-height: 1.4;
    }
    .tgt-bio {
      font-size: 13.5px;
      color: var(--tgt-sub);
      line-height: 1.55;
      margin: 0 0 10px;
      /* Cap at 3 lines so cards stay aligned even with varying bio lengths */
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    .tgt-badges {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
      margin-top: auto;
      padding-top: 4px;
    }
    .tgt-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px 9px;
      background: rgba(8, 145, 178, 0.08);
      color: var(--tgt-brand);
      border-radius: 999px;
      font-size: 11.5px;
      font-weight: 500;
      line-height: 1.4;
      white-space: nowrap;
    }
    .tgt-badge svg { width: 11px; height: 11px; flex-shrink: 0; }
    .tgt-badge--accent {
      background: rgba(99, 102, 241, 0.08);
      color: var(--tgt-accent);
    }
    .tgt-badge--years {
      background: rgba(245, 158, 11, 0.1);
      color: #B45309;
    }
    .tgt-root[data-theme="dark"] .tgt-badge--years {
      background: rgba(245, 158, 11, 0.15);
      color: #FBBF24;
    }

    .tgt-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      font-size: 11.5px;
      color: var(--tgt-muted);
      margin-top: 8px;
    }
    .tgt-meta-item {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      min-width: 0;
    }
    .tgt-meta-item svg {
      width: 11px;
      height: 11px;
      flex-shrink: 0;
    }

    .tgt-socials {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 10px 16px;
      border-top: 1px solid var(--tgt-border);
      background: transparent;
      min-height: 52px;
    }
    .tgt-social {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border-radius: 8px;
      background: transparent;
      color: var(--tgt-sub);
      text-decoration: none;
      transition: background 160ms ease, color 160ms ease;
    }
    .tgt-social svg { width: 15px; height: 15px; }
    .tgt-social:hover {
      background: var(--tgt-card-hover);
      color: var(--tgt-brand);
    }
    .tgt-social:focus-visible {
      outline: 2px solid var(--tgt-accent);
      outline-offset: 2px;
    }

    /* ───── GRID layout ───── */
    .tgt-grid {
      display: grid;
      grid-template-columns: repeat(var(--tgt-cols, 3), minmax(0, 1fr));
      gap: 20px;
    }
    /* Container queries — respond to widget width, not viewport. */
    @container tgt (max-width: 880px) {
      .tgt-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @container tgt (max-width: 540px) {
      .tgt-grid { grid-template-columns: 1fr; gap: 14px; }
    }

    /* ───── COMPACT layout ───── */
    .tgt-compact {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 20px;
    }
    .tgt-compact-card {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 14px;
      background: var(--tgt-card);
      border: 1px solid var(--tgt-border);
      border-radius: var(--tgt-radius-sm);
      transition: background 160ms ease, border-color 160ms ease;
    }
    .tgt-compact-card:hover {
      background: var(--tgt-card-hover);
      border-color: var(--tgt-brand);
    }
    .tgt-compact-photo {
      flex: 0 0 56px;
      width: 56px;
      height: 56px;
      border-radius: 999px;
      overflow: hidden;
      background: var(--tgt-card-hover);
    }
    .tgt-compact-photo img {
      width: 100%; height: 100%;
      object-fit: cover;
      display: block;
    }
    .tgt-compact-photo--fallback {
      display: flex;
      align-items: center;
      justify-content: center;
      color: #FFFFFF;
      font-weight: 700;
      font-size: 18px;
    }
    .tgt-compact-body { min-width: 0; flex: 1; }
    .tgt-compact-name {
      font-size: 15px;
      font-weight: 600;
      color: var(--tgt-text);
      margin: 0 0 2px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .tgt-compact-role {
      font-size: 13px;
      color: var(--tgt-sub);
      margin: 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* ───── CAROUSEL layout ───── */
    .tgt-carousel-wrap {
      position: relative;
    }
    .tgt-carousel {
      display: flex;
      gap: 20px;
      overflow-x: auto;
      scroll-snap-type: x mandatory;
      scroll-behavior: smooth;
      scrollbar-width: none;
      -webkit-overflow-scrolling: touch;
      padding: 4px 4px 16px;
    }
    .tgt-carousel::-webkit-scrollbar { display: none; }
    .tgt-carousel > .tgt-card {
      flex: 0 0 calc((100% - 40px) / 3);
      scroll-snap-align: start;
      min-width: 260px;
    }
    @container tgt (max-width: 880px) {
      .tgt-carousel > .tgt-card { flex: 0 0 calc((100% - 20px) / 2); }
    }
    @container tgt (max-width: 540px) {
      .tgt-carousel > .tgt-card { flex: 0 0 85%; }
    }
    .tgt-arrow {
      position: absolute;
      top: 40%;
      width: 44px;
      height: 44px;
      border-radius: 999px;
      background: var(--tgt-bg);
      border: 1px solid var(--tgt-border);
      box-shadow: var(--tgt-shadow);
      color: var(--tgt-text);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: background 160ms ease, transform 160ms ease;
      z-index: 2;
    }
    .tgt-arrow svg { width: 18px; height: 18px; }
    .tgt-arrow:hover { background: var(--tgt-card-hover); transform: scale(1.05); }
    .tgt-arrow:focus-visible { outline: 2px solid var(--tgt-accent); outline-offset: 2px; }
    .tgt-arrow:disabled { opacity: 0.4; cursor: not-allowed; }
    .tgt-arrow--prev { left: -8px; }
    .tgt-arrow--next { right: -8px; }
    @container tgt (max-width: 540px) {
      .tgt-arrow { display: none; }
    }
    .tgt-dots {
      display: flex;
      gap: 6px;
      justify-content: center;
      margin-top: 12px;
    }
    .tgt-dot {
      width: 8px; height: 8px;
      border-radius: 999px;
      background: var(--tgt-border);
      border: 0;
      padding: 0;
      cursor: pointer;
      transition: background 160ms ease, width 160ms ease;
    }
    .tgt-dot.is-on { background: var(--tgt-brand); width: 24px; }
    .tgt-dot:focus-visible { outline: 2px solid var(--tgt-accent); outline-offset: 2px; }

    /* ───── SPOTLIGHT layout ───── */
    .tgt-spotlight {
      display: grid;
      grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
      gap: 32px;
      align-items: start;
    }
    @container tgt (max-width: 880px) {
      .tgt-spotlight { grid-template-columns: 1fr; }
    }
    .tgt-spotlight-feature {
      background: var(--tgt-card);
      border: 1px solid var(--tgt-border);
      border-radius: var(--tgt-radius);
      box-shadow: var(--tgt-shadow);
      overflow: hidden;
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr);
      transition: opacity 220ms ease;
    }
    @container tgt (max-width: 680px) {
      .tgt-spotlight-feature { grid-template-columns: 1fr; }
    }
    .tgt-spotlight-photo {
      aspect-ratio: 4 / 5;
      background: var(--tgt-card-hover);
      overflow: hidden;
    }
    .tgt-spotlight-photo img {
      width: 100%; height: 100%; object-fit: cover; display: block;
    }
    .tgt-spotlight-photo--fallback {
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 72px;
      font-weight: 700;
      color: #FFFFFF;
    }
    .tgt-spotlight-body {
      padding: 28px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .tgt-spotlight-name {
      font-size: 24px;
      font-weight: 700;
      margin: 0;
      line-height: 1.2;
    }
    .tgt-spotlight-role {
      font-size: 15px;
      font-weight: 500;
      color: var(--tgt-brand);
      margin: 0 0 8px;
    }
    .tgt-spotlight-bio {
      font-size: 15px;
      line-height: 1.6;
      color: var(--tgt-sub);
      margin: 8px 0;
    }
    .tgt-spotlight-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
      max-height: 520px;
      overflow-y: auto;
      padding-right: 4px;
    }
    .tgt-spotlight-list::-webkit-scrollbar { width: 6px; }
    .tgt-spotlight-list::-webkit-scrollbar-thumb {
      background: var(--tgt-border); border-radius: 999px;
    }
    .tgt-spotlight-item {
      appearance: none;
      text-align: left;
      width: 100%;
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px;
      background: var(--tgt-card);
      border: 1px solid var(--tgt-border);
      border-radius: var(--tgt-radius-sm);
      cursor: pointer;
      font-family: inherit;
      color: inherit;
      transition: background 160ms ease, border-color 160ms ease;
    }
    .tgt-spotlight-item:hover {
      background: var(--tgt-card-hover);
      border-color: var(--tgt-brand);
    }
    .tgt-spotlight-item.is-on {
      background: var(--tgt-card-hover);
      border-color: var(--tgt-brand);
    }
    .tgt-spotlight-item:focus-visible {
      outline: 2px solid var(--tgt-accent);
      outline-offset: 2px;
    }
    .tgt-spotlight-item-photo {
      flex: 0 0 48px;
      width: 48px; height: 48px;
      border-radius: 999px;
      overflow: hidden;
      background: var(--tgt-card-hover);
    }
    .tgt-spotlight-item-photo img { width: 100%; height: 100%; object-fit: cover; }
    .tgt-spotlight-item-photo--fallback {
      display: flex; align-items: center; justify-content: center;
      color: #FFFFFF; font-weight: 700; font-size: 16px;
    }
    .tgt-spotlight-item-body { min-width: 0; flex: 1; }
    .tgt-spotlight-item-name {
      font-size: 14px; font-weight: 600; margin: 0 0 2px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .tgt-spotlight-item-role {
      font-size: 12px; color: var(--tgt-sub); margin: 0;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }

    /* ───── Empty state ───── */
    .tgt-empty {
      text-align: center;
      padding: 48px 24px;
      color: var(--tgt-muted);
      border: 2px dashed var(--tgt-border);
      border-radius: var(--tgt-radius);
    }
  `;

  // ═══════════════════════════════════════════════════════════
  // Main widget class
  // ═══════════════════════════════════════════════════════════
  class TGTeamWidget {
    constructor(container, config) {
      if (!container) throw new Error('[TGTeam] no container');
      this.el = container;
      this.cfg = this._mergeConfig(config);
      this.activeDept = '__all__';
      this.activeIdx = 0;
      this._autoplayTimer = null;
      this.shadow = container.shadowRoot || container.attachShadow({ mode: 'open' });
      this._render();
    }

    _mergeConfig(c) {
      const merged = Object.assign({}, DEFAULTS, c || {});
      // Sanitise members array — must be array of objects
      if (!Array.isArray(merged.members)) merged.members = [];
      return merged;
    }

    update(newConfig) {
      this.cfg = this._mergeConfig(Object.assign({}, this.cfg, newConfig));
      this.activeDept = '__all__';
      this.activeIdx = 0;
      this._stopAutoplay();
      this._render();
    }

    destroy() {
      this._stopAutoplay();
      if (this.shadow) this.shadow.innerHTML = '';
    }

    _render() {
      const cfg = this.cfg;
      const themeAttr = cfg.theme === 'dark' ? 'dark' : 'light';
      const cssVars = [
        `--tgt-brand: ${esc(cfg.brand || '#0891B2')}`,
        `--tgt-accent: ${esc(cfg.accent || '#6366F1')}`,
        `--tgt-radius: ${Math.max(0, Math.min(40, parseInt(cfg.radius, 10) || 16))}px`,
        `--tgt-cols: ${Math.max(2, Math.min(4, parseInt(cfg.columns, 10) || 3))}`,
      ].join('; ');
      const fontFamily = cfg.fontFamily
        ? `'${esc(cfg.fontFamily)}', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`
        : '';

      const layout = ['grid', 'compact', 'carousel', 'spotlight'].includes(cfg.layout)
        ? cfg.layout : 'grid';

      const heading = cfg.showHeading ? this._renderHeading() : '';
      const filter = (cfg.showDepartmentFilter && this._departments().length >= 2)
        ? this._renderFilter() : '';
      const body = this._renderLayout(layout);

      this.shadow.innerHTML = `
        <style>${STYLES}${fontFamily ? `:host{font-family:${fontFamily};}` : ''}</style>
        <div class="tgt-root" data-theme="${themeAttr}" data-layout="${layout}" style="${cssVars}">
          ${heading}
          ${filter}
          ${body}
        </div>
      `;
      this._bind();
      if (layout === 'carousel' && cfg.carouselAutoplay) this._startAutoplay();
    }

    _renderHeading() {
      const c = this.cfg;
      const eyebrow = c.eyebrow ? `<div class="tgt-eyebrow">${esc(c.eyebrow)}</div>` : '';
      const title = c.title ? `<h2 class="tgt-title">${esc(c.title)}</h2>` : '';
      const sub = c.subtitle ? `<p class="tgt-subtitle">${esc(c.subtitle)}</p>` : '';
      if (!eyebrow && !title && !sub) return '';
      return `<div class="tgt-heading">${eyebrow}${title}${sub}</div>`;
    }

    _departments() {
      const seen = new Set();
      const out = [];
      this.cfg.members.forEach(m => {
        const d = (m && m.department) ? String(m.department).trim() : '';
        if (d && !seen.has(d)) { seen.add(d); out.push(d); }
      });
      return out;
    }

    _renderFilter() {
      const depts = this._departments();
      const chips = ['__all__'].concat(depts).map(d => {
        const isOn = this.activeDept === d;
        const label = d === '__all__' ? 'All' : esc(d);
        return `<button class="tgt-chip ${isOn ? 'is-on' : ''}" data-dept="${esc(d)}" type="button">${label}</button>`;
      }).join('');
      return `<div class="tgt-filter" role="group" aria-label="Filter by department">${chips}</div>`;
    }

    _visibleMembers() {
      if (this.activeDept === '__all__') return this.cfg.members.slice();
      return this.cfg.members.filter(m => {
        const d = (m && m.department) ? String(m.department).trim() : '';
        return d === this.activeDept;
      });
    }

    _renderLayout(layout) {
      const members = this._visibleMembers();
      if (members.length === 0) {
        return `<div class="tgt-empty">No team members to display.</div>`;
      }
      if (layout === 'compact')   return this._renderCompact(members);
      if (layout === 'carousel')  return this._renderCarousel(members);
      if (layout === 'spotlight') return this._renderSpotlight(members);
      return this._renderGrid(members);
    }

    _renderGrid(members) {
      const cards = members.map(m => this._renderCard(m)).join('');
      return `<div class="tgt-grid" role="list">${cards}</div>`;
    }

    _renderCompact(members) {
      const cards = members.map(m => this._renderCompactCard(m)).join('');
      return `<div class="tgt-compact" role="list">${cards}</div>`;
    }

    _renderCarousel(members) {
      const cards = members.map(m => this._renderCard(m)).join('');
      const dots = members.map((_, i) =>
        `<button class="tgt-dot ${i === 0 ? 'is-on' : ''}" data-idx="${i}" aria-label="Go to slide ${i + 1}" type="button"></button>`
      ).join('');
      return `
        <div class="tgt-carousel-wrap">
          <button class="tgt-arrow tgt-arrow--prev" type="button" aria-label="Previous">${IC.chevronLeft}</button>
          <div class="tgt-carousel" role="list">${cards}</div>
          <button class="tgt-arrow tgt-arrow--next" type="button" aria-label="Next">${IC.chevronRight}</button>
        </div>
        <div class="tgt-dots" role="tablist" aria-label="Slide indicators">${dots}</div>
      `;
    }

    _renderSpotlight(members) {
      // Pick initial featured member: first featured, else first
      let idx = members.findIndex(m => m && m.featured);
      if (idx < 0) idx = 0;
      this.activeIdx = idx;
      const featured = members[idx];
      const list = members.map((m, i) => this._renderSpotlightItem(m, i, i === idx)).join('');
      return `
        <div class="tgt-spotlight">
          <div class="tgt-spotlight-feature" data-spotlight-feature>${this._renderSpotlightFeature(featured)}</div>
          <div class="tgt-spotlight-list" role="list">${list}</div>
        </div>
      `;
    }

    _renderSpotlightFeature(m) {
      if (!m) return '';
      const photo = this._renderSpotlightPhoto(m);
      const name = `<h3 class="tgt-spotlight-name">${esc(m.name || 'Unnamed')}</h3>`;
      const role = m.role ? `<p class="tgt-spotlight-role">${esc(m.role)}</p>` : '';
      const bio = m.bio ? `<p class="tgt-spotlight-bio">${esc(m.bio)}</p>` : '';
      const badges = this._renderBadges(m);
      const meta = this._renderMeta(m);
      const socials = this.cfg.showContactIcons ? this._renderSocials(m) : '';
      return `
        ${photo}
        <div class="tgt-spotlight-body">
          ${name}${role}${bio}
          ${badges}${meta}
          ${socials}
        </div>
      `;
    }

    _renderSpotlightPhoto(m) {
      const photo = safeImageUrl(m && m.photo);
      if (photo) {
        return `<div class="tgt-spotlight-photo"><img src="${esc(photo)}" alt="${esc(m.name || '')}" loading="lazy"></div>`;
      }
      const init = initials(m && m.name);
      const bg = avatarColor(m && m.name);
      return `<div class="tgt-spotlight-photo tgt-spotlight-photo--fallback" style="background:${esc(bg)}">${esc(init)}</div>`;
    }

    _renderSpotlightItem(m, i, isOn) {
      if (!m) return '';
      const photo = safeImageUrl(m.photo);
      const photoHtml = photo
        ? `<div class="tgt-spotlight-item-photo"><img src="${esc(photo)}" alt="" loading="lazy"></div>`
        : `<div class="tgt-spotlight-item-photo tgt-spotlight-item-photo--fallback" style="background:${esc(avatarColor(m.name))}">${esc(initials(m.name))}</div>`;
      return `
        <button type="button" class="tgt-spotlight-item ${isOn ? 'is-on' : ''}" data-spotlight-idx="${i}" role="listitem">
          ${photoHtml}
          <div class="tgt-spotlight-item-body">
            <div class="tgt-spotlight-item-name">${esc(m.name || 'Unnamed')}</div>
            <div class="tgt-spotlight-item-role">${esc(m.role || '')}</div>
          </div>
        </button>
      `;
    }

    _renderCard(m) {
      if (!m) return '';
      const photo = safeImageUrl(m.photo);
      const photoHtml = photo
        ? `<div class="tgt-photo"><img src="${esc(photo)}" alt="${esc(m.name || '')}" loading="lazy"></div>`
        : `<div class="tgt-photo tgt-photo--fallback" style="background:${esc(avatarColor(m.name))}">${esc(initials(m.name))}</div>`;
      const name = `<h3 class="tgt-name">${esc(m.name || 'Unnamed')}</h3>`;
      const role = m.role ? `<p class="tgt-role">${esc(m.role)}</p>` : '';
      const bio = m.bio ? `<p class="tgt-bio">${esc(m.bio)}</p>` : '';
      const badges = this._renderBadges(m);
      const meta = this._renderMeta(m);
      const socials = this.cfg.showContactIcons ? this._renderSocials(m) : '';
      return `
        <article class="tgt-card" role="listitem">
          ${photoHtml}
          <div class="tgt-body">
            ${name}${role}${bio}${badges}${meta}
          </div>
          ${socials}
        </article>
      `;
    }

    _renderCompactCard(m) {
      if (!m) return '';
      const photo = safeImageUrl(m.photo);
      const photoHtml = photo
        ? `<div class="tgt-compact-photo"><img src="${esc(photo)}" alt="${esc(m.name || '')}" loading="lazy"></div>`
        : `<div class="tgt-compact-photo tgt-compact-photo--fallback" style="background:${esc(avatarColor(m.name))}">${esc(initials(m.name))}</div>`;
      return `
        <div class="tgt-compact-card" role="listitem">
          ${photoHtml}
          <div class="tgt-compact-body">
            <p class="tgt-compact-name">${esc(m.name || 'Unnamed')}</p>
            <p class="tgt-compact-role">${esc(m.role || '')}</p>
          </div>
        </div>
      `;
    }

    _renderBadges(m) {
      const out = [];
      // Years of experience
      const years = parseInt(m.years, 10);
      if (years && years > 0 && years < 80) {
        out.push(`<span class="tgt-badge tgt-badge--years">${IC.star}${esc(years)}+ yrs</span>`);
      }
      // Specialisms (limit to first 4 to avoid overwhelm)
      if (Array.isArray(m.specialisms)) {
        m.specialisms.slice(0, 4).forEach(s => {
          const t = String(s || '').trim();
          if (t) out.push(`<span class="tgt-badge">${esc(t)}</span>`);
        });
      } else if (typeof m.specialisms === 'string' && m.specialisms.trim()) {
        // Tolerate comma-separated string
        m.specialisms.split(',').slice(0, 4).forEach(s => {
          const t = s.trim();
          if (t) out.push(`<span class="tgt-badge">${esc(t)}</span>`);
        });
      }
      if (!out.length) return '';
      return `<div class="tgt-badges">${out.join('')}</div>`;
    }

    _renderMeta(m) {
      const out = [];
      // Languages
      const langs = Array.isArray(m.languages)
        ? m.languages.filter(Boolean).map(s => String(s).trim()).filter(Boolean)
        : (typeof m.languages === 'string'
            ? m.languages.split(',').map(s => s.trim()).filter(Boolean)
            : []);
      if (langs.length) {
        out.push(`<span class="tgt-meta-item">${IC.globe}${esc(langs.slice(0, 5).join(', '))}</span>`);
      }
      if (!out.length) return '';
      return `<div class="tgt-meta">${out.join('')}</div>`;
    }

    _renderSocials(m) {
      const out = [];
      if (m.linkedin) {
        const u = safeUrl(m.linkedin);
        if (u) out.push(`<a class="tgt-social" href="${esc(u)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(m.name || '')} on LinkedIn">${IC.linkedin}</a>`);
      }
      if (m.email) {
        const u = mailtoUrl(m.email);
        if (u) out.push(`<a class="tgt-social" href="${esc(u)}" aria-label="Email ${esc(m.name || '')}">${IC.mail}</a>`);
      }
      if (m.phone) {
        const u = telUrl(m.phone);
        if (u) out.push(`<a class="tgt-social" href="${esc(u)}" aria-label="Call ${esc(m.name || '')}">${IC.phone}</a>`);
      }
      if (m.whatsapp) {
        const u = whatsappUrl(m.whatsapp);
        if (u) out.push(`<a class="tgt-social" href="${esc(u)}" target="_blank" rel="noopener noreferrer" aria-label="WhatsApp ${esc(m.name || '')}">${IC.whatsapp}</a>`);
      }
      if (m.instagram) {
        const u = safeUrl(m.instagram);
        if (u) out.push(`<a class="tgt-social" href="${esc(u)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(m.name || '')} on Instagram">${IC.instagram}</a>`);
      }
      if (m.facebook) {
        const u = safeUrl(m.facebook);
        if (u) out.push(`<a class="tgt-social" href="${esc(u)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(m.name || '')} on Facebook">${IC.facebook}</a>`);
      }
      if (!out.length) return '';
      return `<div class="tgt-socials">${out.join('')}</div>`;
    }

    // ─── Event binding ───
    _bind() {
      const root = this.shadow.querySelector('.tgt-root');
      if (!root) return;

      // Filter chips
      root.querySelectorAll('.tgt-chip').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const dept = e.currentTarget.getAttribute('data-dept');
          if (dept === this.activeDept) return;
          this.activeDept = dept;
          this._render();
        });
      });

      // Carousel
      const carousel = root.querySelector('.tgt-carousel');
      if (carousel) {
        const prev = root.querySelector('.tgt-arrow--prev');
        const next = root.querySelector('.tgt-arrow--next');
        const dots = root.querySelectorAll('.tgt-dot');
        const cards = carousel.querySelectorAll('.tgt-card');

        const goTo = (idx) => {
          if (!cards.length) return;
          const i = Math.max(0, Math.min(cards.length - 1, idx));
          const card = cards[i];
          if (card) {
            carousel.scrollTo({
              left: card.offsetLeft - carousel.offsetLeft,
              behavior: 'smooth'
            });
          }
          dots.forEach((d, di) => d.classList.toggle('is-on', di === i));
          this.activeIdx = i;
        };

        if (prev) prev.addEventListener('click', () => goTo(this.activeIdx - 1));
        if (next) next.addEventListener('click', () => goTo(this.activeIdx + 1));
        dots.forEach((d, i) => d.addEventListener('click', () => {
          this._stopAutoplay();
          goTo(i);
        }));

        // Update active dot on manual scroll
        let scrollTimer = null;
        carousel.addEventListener('scroll', () => {
          if (scrollTimer) clearTimeout(scrollTimer);
          scrollTimer = setTimeout(() => {
            let bestIdx = 0;
            let bestDist = Infinity;
            cards.forEach((c, i) => {
              const dist = Math.abs(c.offsetLeft - carousel.scrollLeft - carousel.offsetLeft);
              if (dist < bestDist) { bestDist = dist; bestIdx = i; }
            });
            if (bestIdx !== this.activeIdx) {
              this.activeIdx = bestIdx;
              dots.forEach((d, di) => d.classList.toggle('is-on', di === bestIdx));
            }
          }, 80);
        }, { passive: true });

        // Pause autoplay on hover/focus
        carousel.addEventListener('mouseenter', () => this._stopAutoplay());
        carousel.addEventListener('focusin', () => this._stopAutoplay());
      }

      // Spotlight items
      root.querySelectorAll('.tgt-spotlight-item').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const idx = parseInt(e.currentTarget.getAttribute('data-spotlight-idx'), 10);
          if (isNaN(idx)) return;
          this._swapSpotlight(idx);
        });
      });
    }

    _swapSpotlight(idx) {
      const members = this._visibleMembers();
      if (!members[idx]) return;
      this.activeIdx = idx;
      const featureEl = this.shadow.querySelector('[data-spotlight-feature]');
      const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const swap = () => {
        if (featureEl) featureEl.innerHTML = this._renderSpotlightFeature(members[idx]);
      };
      if (featureEl && !reduceMotion) {
        featureEl.style.opacity = '0';
        setTimeout(() => { swap(); featureEl.style.opacity = '1'; }, 180);
      } else {
        swap();
      }
      this.shadow.querySelectorAll('.tgt-spotlight-item').forEach((el, i) => {
        el.classList.toggle('is-on', i === idx);
      });
    }

    _startAutoplay() {
      const interval = Math.max(2000, parseInt(this.cfg.carouselInterval, 10) || 5000);
      const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduceMotion) return;
      const root = this.shadow.querySelector('.tgt-root');
      const carousel = root && root.querySelector('.tgt-carousel');
      const cards = carousel ? carousel.querySelectorAll('.tgt-card') : null;
      if (!carousel || !cards || cards.length < 2) return;
      this._autoplayTimer = setInterval(() => {
        const nextIdx = (this.activeIdx + 1) % cards.length;
        const card = cards[nextIdx];
        if (card) {
          carousel.scrollTo({ left: card.offsetLeft - carousel.offsetLeft, behavior: 'smooth' });
          this.activeIdx = nextIdx;
          this.shadow.querySelectorAll('.tgt-dot').forEach((d, di) => d.classList.toggle('is-on', di === nextIdx));
        }
      }, interval);
    }

    _stopAutoplay() {
      if (this._autoplayTimer) {
        clearInterval(this._autoplayTimer);
        this._autoplayTimer = null;
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Auto-initialiser
  // ═══════════════════════════════════════════════════════════
  async function fetchConfig(id) {
    try {
      const r = await fetch(API_BASE + '?id=' + encodeURIComponent(id), {
        method: 'GET',
        credentials: 'omit',
      });
      if (!r.ok) return null;
      const data = await r.json();
      return data && data.config ? data.config : null;
    } catch (e) {
      return null;
    }
  }

  async function init() {
    const containers = document.querySelectorAll('[data-tg-widget="team"]');
    for (const el of containers) {
      if (el.__tgInited) continue;
      el.__tgInited = true;
      let cfg = null;
      const inline = el.getAttribute('data-tg-config');
      if (inline) {
        try { cfg = JSON.parse(inline); } catch (e) { cfg = null; }
      } else {
        const id = el.getAttribute('data-tg-id');
        if (id) cfg = await fetchConfig(id);
      }
      try {
        new TGTeamWidget(el, cfg || {});
      } catch (e) {
        if (window.console) console.error('[TGTeam] init failed', e);
      }
    }
  }

  // Expose globally
  window.TGTeamWidget = TGTeamWidget;
  window.__TG_TEAM_VERSION__ = VERSION;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
