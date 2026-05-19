/**
 * Travelgenix Contact Card Widget v1.0.0
 * Self-contained, embeddable widget — display phone, email, WhatsApp, address and socials
 * with click-to-call, click-to-email, get directions, and save-to-phone vCard.
 *
 * Zero dependencies. Shadow DOM isolated. Works on any website via a single script tag.
 *
 * Layouts: panel (default — vertical card), card (compact horizontal), strip (full-width bar)
 *
 * Usage:
 *   <div data-tg-widget="contact" data-tg-id="YOUR_WIDGET_ID"></div>
 *   <script src="https://tg-widgets.vercel.app/widget-contact.js"></script>
 *
 * Or inline config:
 *   <div data-tg-widget="contact" data-tg-config='{"businessName":"...","phone":"..."}'></div>
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
        if (/\/widget\-contact\.js(\?|$|#)/.test(s)) {
          return new URL(s).origin + '/api/widget-config';
        }
      }
    } catch (e) { /* fall through */ }
    return '/api/widget-config';
  }

  const API_BASE = resolveApiBase();
  const VERSION = '1.0.0';

  /* ─────────────────────────────────────────────────────────────
     Helpers — escaping, safe URLs, vCard
     ───────────────────────────────────────────────────────────── */

  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function safeColor(c, fallback) {
    if (!c) return fallback;
    const s = String(c).trim();
    if (/^#[0-9a-f]{3,8}$/i.test(s)) return s;
    if (/^rgba?\([0-9.,\s%]+\)$/i.test(s)) return s;
    if (/^hsla?\([0-9.,\s%deg]+\)$/i.test(s)) return s;
    if (/^[a-z]{3,20}$/i.test(s)) return s;
    return fallback;
  }

  // URL allowlist: http(s), tel, mailto, sms, anchors, relative paths.
  // Returns '' for anything dangerous (javascript:, data: etc.) so href gets empty.
  function safeUrl(u) {
    if (!u) return '';
    const s = String(u).trim();
    if (!s) return '';
    if (s.startsWith('#') || s.startsWith('/')) return s;
    if (/^(https?:|mailto:|tel:|sms:)/i.test(s)) return s;
    return '';
  }

  // Phone normalisation — strip everything except digits and leading +
  function telHref(phone) {
    if (!phone) return '';
    const s = String(phone).trim();
    const cleaned = s.replace(/[^\d+]/g, '');
    if (!cleaned) return '';
    return 'tel:' + cleaned;
  }

  // WhatsApp link — needs digits-only, no +
  function whatsappHref(num, msg) {
    if (!num) return '';
    const digits = String(num).replace(/\D/g, '');
    if (!digits) return '';
    const base = 'https://wa.me/' + digits;
    if (msg) return base + '?text=' + encodeURIComponent(msg);
    return base;
  }

  // Google Maps directions
  function mapsHref(address) {
    if (!address) return '';
    return 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(address);
  }

  // vCard 3.0 — broadly supported on iOS, Android, macOS, Windows
  function buildVCard(cfg) {
    const lines = ['BEGIN:VCARD', 'VERSION:3.0'];
    const name = cfg.contactName || cfg.businessName || '';
    if (name) {
      // FN is full display name; N is structured (lastname;firstname;..)
      lines.push('FN:' + vEscape(name));
      lines.push('N:' + vEscape(name) + ';;;;');
    }
    if (cfg.businessName) lines.push('ORG:' + vEscape(cfg.businessName));
    if (cfg.jobTitle) lines.push('TITLE:' + vEscape(cfg.jobTitle));
    if (cfg.phone) lines.push('TEL;TYPE=WORK,VOICE:' + vEscape(cfg.phone));
    if (cfg.whatsapp) lines.push('TEL;TYPE=CELL:' + vEscape(cfg.whatsapp));
    if (cfg.email) lines.push('EMAIL;TYPE=WORK:' + vEscape(cfg.email));
    if (cfg.website) lines.push('URL:' + vEscape(cfg.website));
    if (cfg.address) lines.push('ADR;TYPE=WORK:;;' + vEscape(cfg.address) + ';;;;');
    if (Array.isArray(cfg.socials)) {
      cfg.socials.forEach(s => {
        if (s && s.url) lines.push('URL:' + vEscape(s.url));
      });
    }
    lines.push('END:VCARD');
    return lines.join('\r\n');
  }

  // vCard escaping: backslash, newline, comma, semicolon
  function vEscape(s) {
    return String(s == null ? '' : s)
      .replace(/\\/g, '\\\\')
      .replace(/\n/g, '\\n')
      .replace(/,/g, '\\,')
      .replace(/;/g, '\\;');
  }

  // Trigger a vCard download — works on every modern browser
  function downloadVCard(cfg) {
    const text = buildVCard(cfg);
    const blob = new Blob([text], { type: 'text/vcard;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const fname = (cfg.businessName || cfg.contactName || 'contact')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    a.href = url;
    a.download = (fname || 'contact') + '.vcf';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      try { document.body.removeChild(a); URL.revokeObjectURL(url); } catch (e) {}
    }, 100);
  }

  /* ─────────────────────────────────────────────────────────────
     Icons — inline SVG path strings, no external dependencies
     ───────────────────────────────────────────────────────────── */

  const ICONS = {
    phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.72 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.35 1.85.59 2.81.72A2 2 0 0 1 22 16.92z"/>',
    mail: '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>',
    whatsapp: '<path d="M16.6 13.4c-.3-.1-1.7-.8-1.9-.9-.3-.1-.4-.1-.6.1-.2.2-.7.9-.8 1-.1.2-.3.2-.6.1-1.6-.8-2.7-1.4-3.8-3.2-.3-.5.3-.5.8-1.5.1-.2 0-.4 0-.5-.1-.1-.6-1.5-.8-2-.2-.5-.4-.5-.6-.5h-.6c-.2 0-.5.1-.7.3-.2.2-.9.9-.9 2.3 0 1.3 1 2.7 1.1 2.8.1.2 1.9 3 4.7 4.2 1.8.7 2.5.8 3.3.7.5-.1 1.7-.7 1.9-1.3.2-.7.2-1.2.2-1.3-.1-.1-.3-.2-.6-.3z"/><path d="M20.5 3.5C18.2 1.2 15.2 0 12 0 5.4 0 0 5.4 0 12c0 2.1.6 4.2 1.6 6L0 24l6.2-1.6c1.7 1 3.7 1.5 5.8 1.5 6.6 0 12-5.4 12-12 0-3.2-1.3-6.2-3.5-8.4zM12 22c-1.9 0-3.7-.5-5.3-1.5l-.4-.2-3.9 1 1-3.8-.2-.4c-1.1-1.7-1.6-3.7-1.6-5.7C1.6 6.4 6.3 1.7 12 1.7c2.8 0 5.4 1.1 7.3 3 1.9 1.9 3 4.5 3 7.3 0 5.7-4.6 10-10.3 10z"/>',
    map: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
    globe: '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    facebook: '<path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/>',
    instagram: '<rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/>',
    twitter: '<path d="M23 3a10.9 10.9 0 0 1-3.14 1.53 4.48 4.48 0 0 0-7.86 3v1A10.66 10.66 0 0 1 3 4s-4 9 5 13a11.64 11.64 0 0 1-7 2c9 5 20 0 20-11.5a4.5 4.5 0 0 0-.08-.83A7.72 7.72 0 0 0 23 3z"/>',
    linkedin: '<path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6z"/><rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/>',
    youtube: '<path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z"/><polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02"/>',
    tiktok: '<path d="M9 12a4 4 0 1 0 4 4V4a5 5 0 0 0 5 5"/>',
    pinterest: '<circle cx="12" cy="12" r="10"/><path d="M8 11.2c0-2.6 2-4.2 4.2-4.2 2.2 0 3.8 1.5 3.8 3.6 0 2.4-1.5 4.2-3.3 4.2-.7 0-1.3-.4-1.1-1.2.2-.9.7-1.9.7-2.6 0-.6-.3-1.1-1-1.1-.8 0-1.5.8-1.5 2 0 .7.2 1.2.2 1.2L8.7 17"/>'
  };

  function icon(name, cls) {
    const path = ICONS[name];
    if (!path) return '';
    const c = cls ? ' class="' + esc(cls) + '"' : '';
    return '<svg' + c + ' viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + path + '</svg>';
  }

  /* ─────────────────────────────────────────────────────────────
     Default config
     ───────────────────────────────────────────────────────────── */

  const DEFAULTS = {
    // Layout: 'panel' (default, vertical), 'card' (compact), 'strip' (horizontal bar)
    layout: 'panel',
    theme: 'light',                 // 'light' | 'dark'
    brandColor: '#1B2B5B',          // Primary CTA / accents
    accentColor: '#00B4D8',         // Secondary highlights
    radius: 16,                     // Container border radius (px)
    fontFamily: '',                 // Empty = inherit host page font

    // Business details
    businessName: '',
    contactName: '',                // Optional named person for vCard
    jobTitle: '',                   // Optional
    intro: '',                      // Optional one-liner under the title

    // Channels (each can be blank)
    phone: '',
    email: '',
    whatsapp: '',                   // Number with country code
    whatsappMessage: '',            // Optional pre-filled message
    address: '',                    // Free text — used for Google Maps directions
    website: '',                    // Full https URL

    // Socials — array of { platform, url } objects
    // platform: facebook|instagram|twitter|linkedin|youtube|tiktok|pinterest
    socials: [],

    // Display toggles
    showVCard: true,                // Save to phone button
    showLabels: true,               // Show "Call us" / "Email" labels next to icons (panel & card only)
    headings: {
      contact: 'Get in touch',
      vcard: 'Save to phone',
    },

    // Strip layout extras
    stripCompact: false,            // If true, hide labels in strip layout — icons only
  };

  /* ─────────────────────────────────────────────────────────────
     Styles — injected into Shadow DOM, all scoped with --tgc-*
     ───────────────────────────────────────────────────────────── */

  const STYLES = `
    :host {
      all: initial;
      display: block;
      font-family: var(--tgc-font, 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      color: var(--tgc-text);
    }
    *, *::before, *::after { box-sizing: border-box; }

    .tgc-root {
      --tgc-brand: #1B2B5B;
      --tgc-accent: #00B4D8;
      --tgc-radius: 16px;
      --tgc-bg: #FFFFFF;
      --tgc-bg-2: #F8FAFC;
      --tgc-border: #E2E8F0;
      --tgc-text: #0F172A;
      --tgc-text-2: #475569;
      --tgc-text-3: #94A3B8;
      --tgc-shadow: 0 1px 3px rgba(15,23,42,.08), 0 1px 2px rgba(15,23,42,.04);
      --tgc-shadow-hover: 0 10px 24px rgba(15,23,42,.10), 0 2px 6px rgba(15,23,42,.06);

      width: 100%;
      color: var(--tgc-text);
    }

    .tgc-root[data-theme="dark"] {
      --tgc-bg: #0F172A;
      --tgc-bg-2: #1E293B;
      --tgc-border: #334155;
      --tgc-text: #F8FAFC;
      --tgc-text-2: #CBD5E1;
      --tgc-text-3: #64748B;
      --tgc-shadow: 0 1px 3px rgba(0,0,0,.4), 0 1px 2px rgba(0,0,0,.3);
      --tgc-shadow-hover: 0 10px 24px rgba(0,0,0,.5), 0 2px 6px rgba(0,0,0,.3);
    }

    /* ─────────────── PANEL LAYOUT (default) ─────────────── */
    .tgc-panel {
      background: var(--tgc-bg);
      border: 1px solid var(--tgc-border);
      border-radius: var(--tgc-radius);
      box-shadow: var(--tgc-shadow);
      padding: 24px;
      max-width: 100%;
    }
    .tgc-header {
      margin-bottom: 16px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--tgc-border);
    }
    .tgc-eyebrow {
      font-size: 11px;
      font-weight: 600;
      letter-spacing: .08em;
      text-transform: uppercase;
      color: var(--tgc-accent);
      margin: 0 0 6px;
    }
    .tgc-title {
      font-size: 20px;
      font-weight: 700;
      line-height: 1.25;
      color: var(--tgc-text);
      margin: 0;
    }
    .tgc-intro {
      font-size: 14px;
      line-height: 1.55;
      color: var(--tgc-text-2);
      margin: 6px 0 0;
    }

    .tgc-channels {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .tgc-channel {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 12px;
      margin: 0 -12px;
      border-radius: 10px;
      color: var(--tgc-text);
      text-decoration: none;
      transition: background .14s ease, transform .14s ease;
      min-height: 44px;
    }
    .tgc-channel:hover {
      background: var(--tgc-bg-2);
    }
    .tgc-channel:active {
      transform: translateY(1px);
    }
    .tgc-channel:focus-visible {
      outline: 2px solid var(--tgc-accent);
      outline-offset: 2px;
    }
    .tgc-ico {
      flex-shrink: 0;
      width: 38px;
      height: 38px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 10px;
      background: color-mix(in srgb, var(--tgc-brand) 10%, transparent);
      color: var(--tgc-brand);
    }
    .tgc-ico svg { width: 18px; height: 18px; }
    .tgc-meta { flex: 1; min-width: 0; }
    .tgc-label {
      font-size: 11px;
      font-weight: 500;
      letter-spacing: .04em;
      text-transform: uppercase;
      color: var(--tgc-text-3);
      margin: 0 0 2px;
    }
    .tgc-value {
      font-size: 14px;
      font-weight: 500;
      color: var(--tgc-text);
      margin: 0;
      word-break: break-word;
    }

    .tgc-socials {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-top: 16px;
      padding-top: 16px;
      border-top: 1px solid var(--tgc-border);
    }
    .tgc-social {
      width: 36px;
      height: 36px;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 1px solid var(--tgc-border);
      border-radius: 10px;
      color: var(--tgc-text-2);
      text-decoration: none;
      transition: all .14s ease;
    }
    .tgc-social:hover {
      color: var(--tgc-brand);
      border-color: var(--tgc-brand);
      transform: translateY(-1px);
    }
    .tgc-social:focus-visible {
      outline: 2px solid var(--tgc-accent);
      outline-offset: 2px;
    }
    .tgc-social svg { width: 16px; height: 16px; }

    .tgc-vcard {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      width: 100%;
      margin-top: 16px;
      padding: 12px 16px;
      background: var(--tgc-brand);
      color: #ffffff;
      border: 0;
      border-radius: 10px;
      font-family: inherit;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: all .14s ease;
      min-height: 44px;
    }
    .tgc-vcard:hover {
      filter: brightness(1.08);
      box-shadow: var(--tgc-shadow-hover);
      transform: translateY(-1px);
    }
    .tgc-vcard:active { transform: translateY(0); }
    .tgc-vcard:focus-visible {
      outline: 2px solid var(--tgc-accent);
      outline-offset: 2px;
    }
    .tgc-vcard svg { width: 16px; height: 16px; }

    /* ─────────────── CARD LAYOUT (compact horizontal) ─────────────── */
    .tgc-card {
      background: var(--tgc-bg);
      border: 1px solid var(--tgc-border);
      border-radius: var(--tgc-radius);
      box-shadow: var(--tgc-shadow);
      padding: 20px;
      display: grid;
      grid-template-columns: 1fr;
      gap: 16px;
    }
    @media (min-width: 560px) {
      .tgc-card { grid-template-columns: minmax(0, 1fr) auto; align-items: center; }
    }
    .tgc-card .tgc-header {
      margin: 0;
      padding: 0;
      border: 0;
    }
    .tgc-card-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      align-items: center;
    }
    .tgc-action {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      background: var(--tgc-bg-2);
      border: 1px solid var(--tgc-border);
      border-radius: 10px;
      color: var(--tgc-text);
      text-decoration: none;
      font-size: 13px;
      font-weight: 500;
      transition: all .14s ease;
      min-height: 44px;
    }
    .tgc-action:hover {
      border-color: var(--tgc-brand);
      color: var(--tgc-brand);
      transform: translateY(-1px);
    }
    .tgc-action:focus-visible {
      outline: 2px solid var(--tgc-accent);
      outline-offset: 2px;
    }
    .tgc-action svg { width: 16px; height: 16px; }
    .tgc-action.is-primary {
      background: var(--tgc-brand);
      border-color: var(--tgc-brand);
      color: #ffffff;
    }
    .tgc-action.is-primary:hover {
      filter: brightness(1.08);
      color: #ffffff;
    }

    /* ─────────────── STRIP LAYOUT (horizontal bar) ─────────────── */
    .tgc-strip {
      background: var(--tgc-bg);
      border: 1px solid var(--tgc-border);
      border-radius: var(--tgc-radius);
      box-shadow: var(--tgc-shadow);
      padding: 12px 16px;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 16px;
    }
    .tgc-strip-brand {
      font-size: 14px;
      font-weight: 600;
      color: var(--tgc-text);
      margin-right: auto;
      padding-right: 8px;
    }
    .tgc-strip-actions {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      align-items: center;
    }
    .tgc-strip-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 12px;
      background: transparent;
      border: 1px solid var(--tgc-border);
      border-radius: 8px;
      color: var(--tgc-text-2);
      text-decoration: none;
      font-size: 13px;
      font-weight: 500;
      font-family: inherit;
      cursor: pointer;
      transition: all .14s ease;
      min-height: 36px;
    }
    .tgc-strip-btn:hover {
      color: var(--tgc-brand);
      border-color: var(--tgc-brand);
    }
    .tgc-strip-btn:focus-visible {
      outline: 2px solid var(--tgc-accent);
      outline-offset: 2px;
    }
    .tgc-strip-btn svg { width: 14px; height: 14px; }
    .tgc-strip-btn.is-primary {
      background: var(--tgc-brand);
      border-color: var(--tgc-brand);
      color: #ffffff;
    }
    .tgc-strip-btn.is-primary:hover {
      filter: brightness(1.08);
      color: #ffffff;
    }
    .tgc-strip[data-compact="true"] .tgc-strip-label { display: none; }
    .tgc-strip[data-compact="true"] .tgc-strip-btn { padding: 8px 10px; gap: 0; }
    .tgc-strip[data-compact="true"] .tgc-strip-btn svg { width: 16px; height: 16px; }

    /* ─────────────── Reduced motion ─────────────── */
    @media (prefers-reduced-motion: reduce) {
      .tgc-channel, .tgc-social, .tgc-vcard, .tgc-action, .tgc-strip-btn {
        transition: none !important;
      }
      .tgc-channel:active, .tgc-social:hover, .tgc-vcard:hover,
      .tgc-action:hover, .tgc-vcard:active {
        transform: none !important;
      }
    }

    /* ─────────────── Small screens ─────────────── */
    @media (max-width: 480px) {
      .tgc-panel { padding: 20px; }
      .tgc-title { font-size: 18px; }
      .tgc-strip-brand { width: 100%; margin-right: 0; }
    }

    /* color-mix fallback for older browsers */
    @supports not (background: color-mix(in srgb, red, blue)) {
      .tgc-ico { background: rgba(27, 43, 91, 0.10); }
    }
  `;

  /* ─────────────────────────────────────────────────────────────
     Widget class
     ───────────────────────────────────────────────────────────── */

  class TGContactWidget {
    constructor(container, config) {
      if (!container) throw new Error('TGContactWidget: container required');
      this.el = container;
      this.cfg = this._mergeConfig(config);
      this.shadow = container.attachShadow ? container.attachShadow({ mode: 'open' }) : null;
      if (!this.shadow) {
        // Defensive — extremely old browsers without Shadow DOM. Fall back to inline.
        container.innerHTML = '';
        return;
      }
      this._render();
    }

    _mergeConfig(c) {
      const out = Object.assign({}, DEFAULTS, c || {});
      out.headings = Object.assign({}, DEFAULTS.headings, (c && c.headings) || {});
      // Defensive: sanitise the socials array
      out.socials = Array.isArray(out.socials)
        ? out.socials.filter(s => s && typeof s === 'object' && s.platform && s.url)
        : [];
      return out;
    }

    update(newConfig) {
      this.cfg = this._mergeConfig(Object.assign({}, this.cfg, newConfig));
      this._render();
    }

    destroy() {
      if (this.shadow) {
        // Detach listeners by clearing innerHTML
        this.shadow.innerHTML = '';
      }
    }

    _render() {
      const c = this.cfg;
      const brand = safeColor(c.brandColor, '#1B2B5B');
      const accent = safeColor(c.accentColor, '#00B4D8');
      const radius = Math.max(0, Math.min(40, Number(c.radius) || 16));
      const fontFamily = c.fontFamily
        ? `'${String(c.fontFamily).replace(/'/g, '')}', 'Inter', -apple-system, sans-serif`
        : `'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`;
      const theme = c.theme === 'dark' ? 'dark' : 'light';
      const layout = ['panel', 'card', 'strip'].indexOf(c.layout) >= 0 ? c.layout : 'panel';

      const rootStyle = [
        '--tgc-brand:' + brand,
        '--tgc-accent:' + accent,
        '--tgc-radius:' + radius + 'px',
        '--tgc-font:' + fontFamily,
      ].join(';');

      let body = '';
      if (layout === 'strip') body = this._renderStrip(c);
      else if (layout === 'card') body = this._renderCard(c);
      else body = this._renderPanel(c);

      this.shadow.innerHTML = `
        <style>${STYLES}</style>
        <div class="tgc-root" data-theme="${theme}" style="${rootStyle}">
          ${body}
        </div>
      `;

      this._bind();
    }

    _renderPanel(c) {
      const channels = this._renderChannels(c);
      if (!channels && !c.businessName && !c.intro) return '';

      const showHeader = !!(c.businessName || c.intro);
      return `
        <div class="tgc-panel" role="region" aria-label="${esc(c.headings.contact)}">
          ${showHeader ? `
            <div class="tgc-header">
              <p class="tgc-eyebrow">${esc(c.headings.contact)}</p>
              ${c.businessName ? `<h2 class="tgc-title">${esc(c.businessName)}</h2>` : ''}
              ${c.intro ? `<p class="tgc-intro">${esc(c.intro)}</p>` : ''}
            </div>
          ` : ''}
          <div class="tgc-channels">${channels}</div>
          ${this._renderSocials(c)}
          ${this._renderVCard(c)}
        </div>
      `;
    }

    _renderCard(c) {
      const actions = this._renderCardActions(c);
      const showHeader = !!(c.businessName || c.intro);
      if (!actions && !showHeader) return '';
      return `
        <div class="tgc-card" role="region" aria-label="${esc(c.headings.contact)}">
          ${showHeader ? `
            <div class="tgc-header">
              <p class="tgc-eyebrow">${esc(c.headings.contact)}</p>
              ${c.businessName ? `<h2 class="tgc-title">${esc(c.businessName)}</h2>` : ''}
              ${c.intro ? `<p class="tgc-intro">${esc(c.intro)}</p>` : ''}
            </div>
          ` : ''}
          <div class="tgc-card-actions">${actions}</div>
        </div>
      `;
    }

    _renderStrip(c) {
      const actions = this._renderStripActions(c);
      if (!actions) return '';
      return `
        <div class="tgc-strip" data-compact="${c.stripCompact ? 'true' : 'false'}" role="region" aria-label="${esc(c.headings.contact)}">
          ${c.businessName ? `<span class="tgc-strip-brand">${esc(c.businessName)}</span>` : ''}
          <div class="tgc-strip-actions">${actions}</div>
        </div>
      `;
    }

    _renderChannels(c) {
      const parts = [];
      if (c.phone) {
        parts.push(this._channelRow('phone', 'Call', c.phone, telHref(c.phone), 'Call ' + c.phone));
      }
      if (c.email) {
        const href = 'mailto:' + encodeURIComponent(c.email).replace(/%40/g, '@');
        parts.push(this._channelRow('mail', 'Email', c.email, safeUrl(href), 'Email ' + c.email));
      }
      if (c.whatsapp) {
        const href = whatsappHref(c.whatsapp, c.whatsappMessage);
        parts.push(this._channelRow('whatsapp', 'WhatsApp', this._fmtWhatsAppValue(c.whatsapp), href, 'Open WhatsApp chat'));
      }
      if (c.address) {
        parts.push(this._channelRow('map', 'Visit us', c.address, mapsHref(c.address), 'Get directions to ' + c.address, '_blank'));
      }
      if (c.website) {
        const safeWeb = safeUrl(c.website);
        if (safeWeb) parts.push(this._channelRow('globe', 'Website', this._fmtWebsite(c.website), safeWeb, 'Visit website', '_blank'));
      }
      return parts.join('');
    }

    _channelRow(iconName, label, value, href, ariaLabel, target) {
      const safeHref = safeUrl(href);
      if (!safeHref) return '';
      const targetAttr = target === '_blank' ? ' target="_blank" rel="noopener noreferrer"' : '';
      const showLabel = this.cfg.showLabels !== false;
      return `
        <a class="tgc-channel" href="${esc(safeHref)}"${targetAttr} aria-label="${esc(ariaLabel)}">
          <span class="tgc-ico">${icon(iconName)}</span>
          <div class="tgc-meta">
            ${showLabel ? `<p class="tgc-label">${esc(label)}</p>` : ''}
            <p class="tgc-value">${esc(value)}</p>
          </div>
        </a>
      `;
    }

    _renderCardActions(c) {
      const out = [];
      if (c.phone) {
        const href = telHref(c.phone);
        if (href) out.push(`<a class="tgc-action is-primary" href="${esc(href)}" aria-label="Call ${esc(c.phone)}">${icon('phone')}<span>Call</span></a>`);
      }
      if (c.email) {
        const href = safeUrl('mailto:' + encodeURIComponent(c.email).replace(/%40/g, '@'));
        if (href) out.push(`<a class="tgc-action" href="${esc(href)}" aria-label="Email ${esc(c.email)}">${icon('mail')}<span>Email</span></a>`);
      }
      if (c.whatsapp) {
        const href = safeUrl(whatsappHref(c.whatsapp, c.whatsappMessage));
        if (href) out.push(`<a class="tgc-action" href="${esc(href)}" target="_blank" rel="noopener noreferrer" aria-label="Open WhatsApp">${icon('whatsapp')}<span>WhatsApp</span></a>`);
      }
      if (c.address) {
        const href = safeUrl(mapsHref(c.address));
        if (href) out.push(`<a class="tgc-action" href="${esc(href)}" target="_blank" rel="noopener noreferrer" aria-label="Get directions">${icon('map')}<span>Directions</span></a>`);
      }
      if (c.showVCard !== false && this._hasAnySavableField(c)) {
        out.push(`<button class="tgc-action" type="button" data-vcard="1" aria-label="${esc(c.headings.vcard)}">${icon('download')}<span>${esc(c.headings.vcard)}</span></button>`);
      }
      return out.join('');
    }

    _renderStripActions(c) {
      const out = [];
      const compact = !!c.stripCompact;
      function btn(iconName, label, href, isPrimary, isButton, target, ariaLabel) {
        const safeHref = isButton ? '#' : safeUrl(href);
        if (!safeHref && !isButton) return '';
        const tag = isButton ? 'button' : 'a';
        const attrs = isButton
          ? 'type="button" data-vcard="1"'
          : `href="${esc(safeHref)}"${target === '_blank' ? ' target="_blank" rel="noopener noreferrer"' : ''}`;
        return `<${tag} class="tgc-strip-btn${isPrimary ? ' is-primary' : ''}" ${attrs} aria-label="${esc(ariaLabel || label)}">
          ${icon(iconName)}${compact ? '' : `<span class="tgc-strip-label">${esc(label)}</span>`}
        </${tag}>`;
      }
      if (c.phone) out.push(btn('phone', 'Call', telHref(c.phone), true, false, null, 'Call ' + c.phone));
      if (c.email) out.push(btn('mail', 'Email', 'mailto:' + encodeURIComponent(c.email).replace(/%40/g, '@'), false, false, null, 'Email ' + c.email));
      if (c.whatsapp) out.push(btn('whatsapp', 'WhatsApp', whatsappHref(c.whatsapp, c.whatsappMessage), false, false, '_blank', 'Open WhatsApp'));
      if (c.address) out.push(btn('map', 'Directions', mapsHref(c.address), false, false, '_blank', 'Get directions'));
      if (c.showVCard !== false && this._hasAnySavableField(c)) {
        out.push(btn('download', c.headings.vcard, '#', false, true, null, c.headings.vcard));
      }
      return out.join('');
    }

    _renderSocials(c) {
      if (!Array.isArray(c.socials) || !c.socials.length) return '';
      const items = c.socials.map(s => {
        const safe = safeUrl(s.url);
        if (!safe) return '';
        const platform = String(s.platform || '').toLowerCase();
        const ico = ICONS[platform] ? icon(platform) : icon('globe');
        return `<a class="tgc-social" href="${esc(safe)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(platform || 'Social link')}">${ico}</a>`;
      }).filter(Boolean).join('');
      if (!items) return '';
      return `<div class="tgc-socials" role="list">${items}</div>`;
    }

    _renderVCard(c) {
      if (c.showVCard === false) return '';
      if (!this._hasAnySavableField(c)) return '';
      return `
        <button class="tgc-vcard" type="button" data-vcard="1" aria-label="${esc(c.headings.vcard)}">
          ${icon('download')}<span>${esc(c.headings.vcard)}</span>
        </button>
      `;
    }

    _hasAnySavableField(c) {
      return !!(c.phone || c.email || c.whatsapp || c.address || c.website || c.businessName || c.contactName);
    }

    _fmtWhatsAppValue(num) {
      // Show as +44 7700 900000 — keep what they entered, but trim noise
      const s = String(num).trim();
      return s || '';
    }

    _fmtWebsite(url) {
      try {
        return String(url).replace(/^https?:\/\//i, '').replace(/\/$/, '');
      } catch (e) {
        return String(url);
      }
    }

    _bind() {
      if (!this.shadow) return;
      const vcardBtns = this.shadow.querySelectorAll('[data-vcard="1"]');
      vcardBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          try {
            downloadVCard(this.cfg);
          } catch (err) {
            console.warn('[TG Contact] vCard download failed', err);
          }
        });
      });
    }
  }

  /* ─────────────────────────────────────────────────────────────
     Auto-init
     ───────────────────────────────────────────────────────────── */

  async function init() {
    const els = document.querySelectorAll('[data-tg-widget="contact"]');
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      if (el.__tgContactInit) continue;
      el.__tgContactInit = true;

      // Inline config wins
      const inlineCfg = el.getAttribute('data-tg-config');
      if (inlineCfg) {
        try {
          const cfg = JSON.parse(inlineCfg);
          new TGContactWidget(el, cfg);
          continue;
        } catch (e) {
          console.warn('[TG Contact] invalid data-tg-config JSON', e);
        }
      }

      const id = el.getAttribute('data-tg-id');
      if (!id) continue;

      try {
        const url = API_BASE + '?id=' + encodeURIComponent(id);
        const res = await fetch(url);
        if (!res.ok) throw new Error('Config load failed: ' + res.status);
        const data = await res.json();
        const cfg = data && data.config ? data.config : data;
        new TGContactWidget(el, cfg);
      } catch (e) {
        console.warn('[TG Contact] remote config error', e);
        // Fail silently — empty container is preferable to a broken render on the host site
      }
    }
  }

  window.TGContactWidget = TGContactWidget;
  window.__TG_CONTACT_VERSION__ = VERSION;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
