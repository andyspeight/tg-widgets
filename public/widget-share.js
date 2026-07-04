/**
 * Travelgenix Social Share Widget v1.0.0
 * Self-contained, embeddable widget
 * Zero dependencies — works on any website via a single script tag
 *
 * Usage:
 *   <div data-tg-widget="share" data-tg-id="YOUR_WIDGET_ID"></div>
 *   <script src="https://tg-widgets.vercel.app/widget-share.js"></script>
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
        if (/\/widget\-share\.js(\?|$|#)/.test(s)) {
          return new URL(s).origin + '/api/widget-config';
        }
      }
    } catch (e) { /* fall through */ }
    return '/api/widget-config';
  }

  const API_BASE = resolveApiBase();
  const TRACK_BASE = (function () {
    /* Resolve the TRACK_BASE URL. Yesterday's fix patched widget-config but this
       secondary API was left with a relative default ('/api/share-track'), which
       on customer sites resolves to the customer's domain and 404s. Same
       resolution strategy as the API_BASE resolver above. */
    if (typeof window === 'undefined') return '/api/share-track';
    if (window.__TG_SHARE_TRACK_API__) return window.__TG_SHARE_TRACK_API__;
    try {
      var me = document.currentScript;
      if (me && me.src) return new URL(me.src).origin + '/api/share-track';
      var scripts = document.getElementsByTagName('script');
      for (var i = scripts.length - 1; i >= 0; i--) {
        var s = scripts[i].src || '';
        if (/\/widget\-share\.js(\?|$|#)/.test(s)) {
          return new URL(s).origin + '/api/share-track';
        }
      }
    } catch (e) { /* fall through */ }
    return '/api/share-track';
  })();
  const VERSION = '1.0.3';

  // ─── i18n ───────────────────────────────────────────────────
  // Fixed UI chrome only. Platform names (WhatsApp, Facebook, X…) are brand
  // names and are never translated. English is the source + fallback.
  const MESSAGES = {
    en: { share: 'Share', copyLink: 'Copy link', copied: 'Copied!', shareOn: 'Share on {platform}', shareThisPage: 'Share this page', shareOptions: 'Share options', shareColon: 'Share:' },
    fr: { share: 'Partager', copyLink: 'Copier le lien', copied: 'Copié !', shareOn: 'Partager sur {platform}', shareThisPage: 'Partager cette page', shareOptions: 'Options de partage', shareColon: 'Partager :' },
    de: { share: 'Teilen', copyLink: 'Link kopieren', copied: 'Kopiert!', shareOn: 'Auf {platform} teilen', shareThisPage: 'Diese Seite teilen', shareOptions: 'Teilen-Optionen', shareColon: 'Teilen:' },
    es: { share: 'Compartir', copyLink: 'Copiar enlace', copied: '¡Copiado!', shareOn: 'Compartir en {platform}', shareThisPage: 'Compartir esta página', shareOptions: 'Opciones para compartir', shareColon: 'Compartir:' },
    it: { share: 'Condividi', copyLink: 'Copia link', copied: 'Copiato!', shareOn: 'Condividi su {platform}', shareThisPage: 'Condividi questa pagina', shareOptions: 'Opzioni di condivisione', shareColon: 'Condividi:' },
    ro: { share: 'Distribuie', copyLink: 'Copiază linkul', copied: 'Copiat!', shareOn: 'Distribuie pe {platform}', shareThisPage: 'Distribuie această pagină', shareOptions: 'Opțiuni de distribuire', shareColon: 'Distribuie:' },
  };
  // Uses the shared TGi18n core when present; otherwise an identical inline resolver.
  function makeT(cfg) {
    if (typeof window !== 'undefined' && window.TGi18n && typeof window.TGi18n.make === 'function') return window.TGi18n.make(MESSAGES, cfg);
    const supported = Object.keys(MESSAGES);
    const baseOf = (r) => (r ? String(r).toLowerCase().replace(/_/g, '-').split('-')[0] : '');
    let cands = [];
    if (cfg) cands.push(cfg.lang, cfg.language, cfg.locale);
    try { cands.push(document.documentElement.getAttribute('lang')); } catch (e) { /* noop */ }
    try { if (navigator.languages) cands = cands.concat(navigator.languages); cands.push(navigator.language); } catch (e) { /* noop */ }
    let lang = 'en';
    for (let i = 0; i < cands.length; i++) { const b = baseOf(cands[i]); if (b && supported.indexOf(b) !== -1) { lang = b; break; } }
    const dict = MESSAGES[lang] || MESSAGES.en;
    const t = (k, vars) => {
      let s = Object.prototype.hasOwnProperty.call(dict, k) ? dict[k] : (MESSAGES.en[k] || k);
      if (vars) s = String(s).replace(/\{(\w+)\}/g, (m, n) => (vars[n] != null ? vars[n] : m));
      return s;
    };
    t.lang = lang; t.dir = 'ltr';
    return t;
  }

  // ---------- Helpers ----------
  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Config colours and font reach the root style attribute — validate at source
  // so they can't add declarations or break out; the string is also esc()'d at
  // injection as a second layer.
  function safeColor(v, fb) {
    const s = String(v == null ? '' : v).trim();
    return /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(s) ? s : fb;
  }
  function safeFontStack(v, fb) {
    const s = String(v == null ? '' : v).trim();
    return (s && s.length <= 120 && /^[A-Za-z0-9 ,"'-]+$/.test(s)) ? s : fb;
  }

  function safeUrl(u) {
    if (!u) return '';
    const s = String(u).trim();
    if (/^javascript:/i.test(s) || /^data:/i.test(s) || /^vbscript:/i.test(s)) return '';
    return s;
  }

  function getOg(name) {
    try {
      const m = document.querySelector(
        `meta[property="og:${name}"], meta[name="og:${name}"], meta[name="${name}"]`
      );
      return m ? (m.getAttribute('content') || '') : '';
    } catch (e) { return ''; }
  }

  function getPageMeta(cfg) {
    const url = (cfg.shareUrl && safeUrl(cfg.shareUrl))
      ? cfg.shareUrl
      : (typeof location !== 'undefined' ? location.href : '');
    const ogTitle = getOg('title');
    const docTitle = (typeof document !== 'undefined' && document.title) || '';
    const title = (cfg.shareText && cfg.shareText.trim())
      ? cfg.shareText
      : (ogTitle || docTitle || '');
    const description = getOg('description') || '';
    return { url, title, description };
  }

  function buildShareLink(platform, meta) {
    const u = encodeURIComponent(meta.url || '');
    const t = encodeURIComponent(meta.title || '');
    const d = encodeURIComponent(meta.description || '');
    const ut = (meta.title ? meta.title + ' ' : '') + (meta.url || '');
    switch (platform) {
      case 'whatsapp':
        return 'https://wa.me/?text=' + encodeURIComponent(ut);
      case 'facebook':
        return 'https://www.facebook.com/sharer/sharer.php?u=' + u;
      case 'twitter':
        return 'https://twitter.com/intent/tweet?url=' + u + '&text=' + t;
      case 'linkedin':
        return 'https://www.linkedin.com/sharing/share-offsite/?url=' + u;
      case 'pinterest':
        return 'https://pinterest.com/pin/create/button/?url=' + u + '&description=' + t;
      case 'reddit':
        return 'https://www.reddit.com/submit?url=' + u + '&title=' + t;
      case 'email':
        return 'mailto:?subject=' + t + '&body=' + encodeURIComponent((meta.title ? meta.title + '\n\n' : '') + (meta.url || ''));
      case 'sms':
        return 'sms:?&body=' + encodeURIComponent(ut);
      default:
        return '';
    }
  }

  // Brand colours for icons (when colourMode === 'brand')
  const BRAND_COLOURS = {
    whatsapp: '#25D366',
    facebook: '#1877F2',
    twitter:  '#000000',
    linkedin: '#0A66C2',
    pinterest:'#E60023',
    reddit:   '#FF4500',
    email:    '#64748B',
    sms:      '#10B981',
    copy:     '#6366F1',
    native:   '#8B5CF6',
  };

  const PLATFORM_LABELS = {
    whatsapp: 'WhatsApp',
    facebook: 'Facebook',
    twitter:  'X',
    linkedin: 'LinkedIn',
    pinterest:'Pinterest',
    reddit:   'Reddit',
    email:    'Email',
    sms:      'Text',
    copy:     'Copy link',
    native:   'Share',
  };

  // Inline SVG paths for each platform — keep these small, single-path where possible
  const ICONS = {
    whatsapp: '<path d="M16.6 14.1c-.3-.1-1.6-.8-1.9-.9-.3-.1-.5-.1-.7.1-.2.3-.7.9-.9 1.1-.2.2-.3.2-.6.1-1.6-.8-2.7-1.5-3.7-3.4-.3-.5.3-.4.7-1.5.1-.2 0-.4 0-.5 0-.1-.7-1.6-.9-2.2-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.2.2 2.1 3.2 5.2 4.5 1.9.8 2.7.9 3.6.7.6-.1 1.6-.7 1.9-1.3.2-.7.2-1.2.2-1.3-.1-.1-.3-.2-.5-.3zM12 2C6.5 2 2 6.5 2 12c0 1.7.4 3.4 1.3 4.9L2 22l5.3-1.4c1.4.8 3 1.2 4.7 1.2 5.5 0 10-4.5 10-10S17.5 2 12 2z"/>',
    facebook: '<path d="M22 12c0-5.5-4.5-10-10-10S2 6.5 2 12c0 5 3.7 9.1 8.4 9.9V14.9H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.5h-1.3c-1.2 0-1.6.8-1.6 1.6V12h2.8l-.4 2.9h-2.3v7c4.7-.8 8.4-4.9 8.4-9.9z"/>',
    twitter:  '<path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>',
    linkedin: '<path d="M20.5 2h-17A1.5 1.5 0 002 3.5v17A1.5 1.5 0 003.5 22h17a1.5 1.5 0 001.5-1.5v-17A1.5 1.5 0 0020.5 2zM8 19H5v-9h3zM6.5 8.25A1.75 1.75 0 118.3 6.5a1.78 1.78 0 01-1.8 1.75zM19 19h-3v-4.74c0-1.42-.6-1.93-1.38-1.93A1.74 1.74 0 0013 14.19a.66.66 0 000 .14V19h-3v-9h2.9v1.3a3.11 3.11 0 012.7-1.4c1.55 0 3.36.86 3.36 3.66z"/>',
    pinterest:'<path d="M12 2C6.48 2 2 6.48 2 12c0 4.24 2.64 7.85 6.36 9.31-.08-.79-.16-2 .03-2.86.18-.78 1.16-4.97 1.16-4.97s-.3-.59-.3-1.46c0-1.37.79-2.39 1.78-2.39.84 0 1.25.63 1.25 1.39 0 .85-.54 2.11-.82 3.29-.23.98.49 1.79 1.46 1.79 1.75 0 3.1-1.85 3.1-4.51 0-2.36-1.7-4.01-4.12-4.01-2.81 0-4.46 2.11-4.46 4.29 0 .85.33 1.76.74 2.25.08.1.09.18.07.28-.08.32-.25 1.01-.28 1.15-.04.18-.15.22-.34.13-1.27-.59-2.06-2.44-2.06-3.93 0-3.2 2.32-6.13 6.7-6.13 3.51 0 6.25 2.5 6.25 5.85 0 3.49-2.2 6.31-5.26 6.31-1.03 0-2-.54-2.33-1.17 0 0-.51 1.93-.63 2.41-.23.88-.84 1.97-1.26 2.64A10 10 0 0012 22c5.52 0 10-4.48 10-10S17.52 2 12 2z"/>',
    reddit:   '<path d="M22 12.07a2.08 2.08 0 00-3.53-1.46 10.43 10.43 0 00-5.62-1.78l1-4.51 3.16.71v.07a1.65 1.65 0 101.7-1.61 1.66 1.66 0 00-1.49 1l-3.51-.78a.41.41 0 00-.31.05.42.42 0 00-.18.26l-1.07 5a10.4 10.4 0 00-5.7 1.78A2.07 2.07 0 002 12.07a2 2 0 001.21 1.89 4.81 4.81 0 00-.06.66c0 3.31 3.85 6 8.6 6s8.6-2.69 8.6-6a4.81 4.81 0 00-.06-.66A2 2 0 0022 12.07zM7.85 13.5a1.5 1.5 0 113 0 1.5 1.5 0 01-3 0zm8.42 4a5.71 5.71 0 01-3.66 1.13H12.2a5.71 5.71 0 01-3.66-1.13.42.42 0 01.59-.59 4.93 4.93 0 003.07.93h.18a4.93 4.93 0 003.07-.93.42.42 0 01.59.59zm0-2.45a1.5 1.5 0 111.5-1.5 1.5 1.5 0 01-1.5 1.5z"/>',
    email:    '<path d="M22 6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2zm-2 0l-8 5-8-5zm0 12H4V8l8 5 8-5z"/>',
    sms:      '<path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM7 9h10v2H7zm6 4H7v-2h6zm4-6H7V5h10z"/>',
    copy:     '<path d="M16 1H4a2 2 0 00-2 2v14h2V3h12zm3 4H8a2 2 0 00-2 2v14a2 2 0 002 2h11a2 2 0 002-2V7a2 2 0 00-2-2zm0 16H8V7h11z"/>',
    native:   '<path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11A3 3 0 1015 5c0 .24.04.47.09.7L8.04 9.81A3 3 0 103 12a3 3 0 005.04 2.19l7.12 4.16a2.79 2.79 0 00-.08.65 2.92 2.92 0 102.92-2.92z"/>',
    check:    '<polyline points="20 6 9 17 4 12"/>',
    chevron:  '<polyline points="6 9 12 15 18 9"/>',
    share:    '<path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/>',
    close:    '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  };

  function svg(name, size) {
    const s = size || 18;
    const sw = name === 'check' || name === 'chevron' || name === 'share' || name === 'close' ? 'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"' : 'fill="currentColor"';
    return `<svg viewBox="0 0 24 24" width="${s}" height="${s}" ${sw} aria-hidden="true">${ICONS[name] || ''}</svg>`;
  }

  // ---------- Styles ----------
  const STYLES = `
    :host { all: initial; display: block; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    *, *::before, *::after { box-sizing: border-box; }

    .tgsh-root {
      --tgsh-brand: #0891B2;
      --tgsh-bg: #FFFFFF;
      --tgsh-card: #FFFFFF;
      --tgsh-text: #0F172A;
      --tgsh-sub: #64748B;
      --tgsh-border: #E2E8F0;
      --tgsh-shadow: 0 6px 24px rgba(15, 23, 42, 0.08), 0 2px 6px rgba(15, 23, 42, 0.04);
      --tgsh-shadow-hover: 0 12px 32px rgba(15, 23, 42, 0.12), 0 4px 8px rgba(15, 23, 42, 0.06);
      --tgsh-radius: 14px;
      --tgsh-icon-size: 40px;
      --tgsh-gap: 8px;
      color: var(--tgsh-text);
    }

    .tgsh-root[data-theme="dark"] {
      --tgsh-bg: #0F172A;
      --tgsh-card: #1E293B;
      --tgsh-text: #F1F5F9;
      --tgsh-sub: #94A3B8;
      --tgsh-border: #334155;
      --tgsh-shadow: 0 6px 24px rgba(0, 0, 0, 0.4), 0 2px 6px rgba(0, 0, 0, 0.3);
      --tgsh-shadow-hover: 0 12px 32px rgba(0, 0, 0, 0.5), 0 4px 8px rgba(0, 0, 0, 0.4);
    }

    /* ----- Buttons (shared) ----- */
    .tgsh-btn {
      width: var(--tgsh-icon-size);
      height: var(--tgsh-icon-size);
      border-radius: 50%;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: var(--tgsh-card);
      color: var(--tgsh-text);
      border: 1px solid var(--tgsh-border);
      box-shadow: var(--tgsh-shadow);
      cursor: pointer;
      transition: transform 200ms cubic-bezier(.2,.8,.2,1), box-shadow 200ms ease, background 150ms ease, color 150ms ease;
      text-decoration: none;
      position: relative;
      flex-shrink: 0;
    }
    .tgsh-btn:hover {
      transform: translateY(-2px) scale(1.06);
      box-shadow: var(--tgsh-shadow-hover);
    }
    .tgsh-btn:focus-visible {
      outline: 2px solid var(--tgsh-brand);
      outline-offset: 3px;
    }
    .tgsh-btn:active { transform: translateY(0) scale(0.96); }

    .tgsh-btn[data-shape="square"] { border-radius: 12px; }
    .tgsh-btn[data-shape="pill"] { border-radius: 999px; width: auto; padding: 0 14px 0 12px; gap: 8px; }
    .tgsh-btn[data-shape="pill"] .tgsh-btn-label {
      font-size: 13px; font-weight: 600; letter-spacing: -0.01em;
    }

    /* ----- Colour modes ----- */
    .tgsh-root[data-colour="brand"] .tgsh-btn { color: var(--btn-brand, var(--tgsh-text)); }
    .tgsh-root[data-colour="filled"] .tgsh-btn {
      background: var(--btn-brand, var(--tgsh-brand));
      color: #FFFFFF;
      border-color: transparent;
    }
    .tgsh-root[data-colour="filled"] .tgsh-btn[data-platform="twitter"] { background: #000000; }
    .tgsh-root[data-colour="filled"] .tgsh-btn[data-platform="email"] { background: #475569; }
    .tgsh-root[data-colour="mono"] .tgsh-btn { color: var(--tgsh-sub); }
    .tgsh-root[data-colour="mono"] .tgsh-btn:hover { color: var(--tgsh-text); }
    .tgsh-root[data-colour="accent"] .tgsh-btn { color: var(--tgsh-brand); }

    /* ----- Layout: floating rail (vertical, edge-pinned) ----- */
    .tgsh-rail {
      position: fixed;
      top: 50%;
      transform: translateY(-50%);
      display: flex;
      flex-direction: column;
      gap: var(--tgsh-gap);
      padding: 10px;
      background: var(--tgsh-card);
      border-radius: var(--tgsh-radius);
      border: 1px solid var(--tgsh-border);
      box-shadow: var(--tgsh-shadow);
      z-index: 9000;
      transition: opacity 300ms ease, transform 300ms cubic-bezier(.2,.8,.2,1);
    }
    .tgsh-rail[data-side="left"] { left: 16px; }
    .tgsh-rail[data-side="right"] { right: 16px; }
    .tgsh-rail.is-hidden { opacity: 0; pointer-events: none; transform: translateY(-50%) translateX(20px); }
    .tgsh-rail[data-side="left"].is-hidden { transform: translateY(-50%) translateX(-20px); }

    /* ----- Layout: floating dock (horizontal, bottom) ----- */
    .tgsh-dock {
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      gap: var(--tgsh-gap);
      padding: 10px 14px;
      background: var(--tgsh-card);
      border-radius: 999px;
      border: 1px solid var(--tgsh-border);
      box-shadow: var(--tgsh-shadow);
      z-index: 9000;
      transition: opacity 300ms ease, transform 300ms cubic-bezier(.2,.8,.2,1);
      max-width: calc(100vw - 32px);
      overflow-x: auto;
      scrollbar-width: none;
    }
    .tgsh-dock::-webkit-scrollbar { display: none; }
    .tgsh-dock.is-hidden { opacity: 0; pointer-events: none; transform: translateX(-50%) translateY(20px); }

    /* ----- Layout: inline strip ----- */
    .tgsh-inline {
      display: flex;
      flex-wrap: wrap;
      gap: var(--tgsh-gap);
      align-items: center;
    }
    .tgsh-inline .tgsh-label {
      font-size: 13px; font-weight: 600; color: var(--tgsh-sub);
      margin-right: 6px;
    }

    /* ----- Layout: compact (single button + popover) ----- */
    .tgsh-compact-wrap {
      position: relative;
      display: inline-block;
    }
    .tgsh-compact-trigger {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      height: var(--tgsh-icon-size);
      padding: 0 16px 0 14px;
      border-radius: 999px;
      background: var(--tgsh-brand);
      color: #FFFFFF;
      border: none;
      box-shadow: var(--tgsh-shadow);
      cursor: pointer;
      font-family: inherit;
      font-size: 14px;
      font-weight: 600;
      letter-spacing: -0.01em;
      transition: transform 200ms cubic-bezier(.2,.8,.2,1), box-shadow 200ms ease;
    }
    .tgsh-compact-trigger:hover { transform: translateY(-1px); box-shadow: var(--tgsh-shadow-hover); }
    .tgsh-compact-trigger:focus-visible { outline: 2px solid var(--tgsh-brand); outline-offset: 3px; }

    .tgsh-compact-pop {
      position: absolute;
      bottom: calc(100% + 10px);
      left: 50%;
      transform: translateX(-50%) translateY(6px);
      display: flex;
      gap: var(--tgsh-gap);
      padding: 10px;
      background: var(--tgsh-card);
      border-radius: var(--tgsh-radius);
      border: 1px solid var(--tgsh-border);
      box-shadow: var(--tgsh-shadow-hover);
      opacity: 0;
      pointer-events: none;
      transition: opacity 200ms ease, transform 200ms cubic-bezier(.2,.8,.2,1);
      white-space: nowrap;
      z-index: 10;
    }
    .tgsh-compact-pop[data-open="true"] {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
      pointer-events: auto;
    }
    .tgsh-compact-pop::after {
      content: '';
      position: absolute;
      top: 100%;
      left: 50%;
      transform: translateX(-50%);
      border: 6px solid transparent;
      border-top-color: var(--tgsh-card);
    }

    /* ----- Tooltip on hover ----- */
    .tgsh-btn[data-tooltip]::before {
      content: attr(data-tooltip);
      position: absolute;
      bottom: calc(100% + 8px);
      left: 50%;
      transform: translateX(-50%);
      background: #0F172A;
      color: #F1F5F9;
      font-size: 11px;
      font-weight: 600;
      padding: 4px 8px;
      border-radius: 6px;
      white-space: nowrap;
      opacity: 0;
      pointer-events: none;
      transition: opacity 150ms ease;
    }
    .tgsh-btn[data-tooltip]:hover::before {
      opacity: 1;
    }
    .tgsh-rail .tgsh-btn[data-tooltip]::before {
      bottom: 50%;
      left: auto;
      right: calc(100% + 8px);
      transform: translateY(50%);
    }
    .tgsh-rail[data-side="left"] .tgsh-btn[data-tooltip]::before {
      right: auto;
      left: calc(100% + 8px);
    }

    /* ----- "Copied" toast ----- */
    .tgsh-copied {
      position: absolute;
      top: -28px;
      left: 50%;
      transform: translateX(-50%);
      background: #10B981;
      color: #FFFFFF;
      font-size: 11px;
      font-weight: 700;
      padding: 4px 10px;
      border-radius: 999px;
      pointer-events: none;
      opacity: 0;
      transition: opacity 200ms ease, transform 200ms ease;
      white-space: nowrap;
      z-index: 11;
    }
    .tgsh-copied[data-show="true"] {
      opacity: 1;
      transform: translateX(-50%) translateY(-2px);
    }

    /* ----- Responsive ----- */
    @media (max-width: 600px) {
      .tgsh-rail { display: none; }
      .tgsh-dock {
        bottom: 12px;
        padding: 8px 10px;
        gap: 6px;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .tgsh-rail, .tgsh-dock, .tgsh-btn, .tgsh-compact-pop, .tgsh-compact-trigger, .tgsh-copied {
        transition: none !important;
      }
      .tgsh-btn:hover { transform: none; }
    }
  `;

  // ---------- Widget Class ----------
  class TGShareWidget {
    constructor(container, config) {
      this.el = container;
      this.c = this._defaults(config);
      this.t = makeT(this.c);   // resolve viewer language + UI strings
      this.shadow = container.attachShadow({ mode: 'open' });
      this._lastScrollY = (typeof window !== 'undefined') ? window.scrollY : 0;
      this._scrollHandler = null;
      this._render();
    }

    _defaults(c) {
      const cfg = c || {};
      const platforms = Array.isArray(cfg.platforms) && cfg.platforms.length
        ? cfg.platforms
        : ['whatsapp', 'facebook', 'twitter', 'linkedin', 'email', 'copy'];

      return {
        layout: cfg.layout || 'rail',                // rail | dock | inline | compact
        side: cfg.side === 'left' ? 'left' : 'right', // rail only
        platforms: platforms,
        colourMode: cfg.colourMode || 'brand',        // brand | filled | mono | accent
        shape: cfg.shape || 'circle',                 // circle | square | pill
        iconSize: Number(cfg.iconSize) || 40,
        showLabels: cfg.showLabels === true,          // show platform name next to icon
        showTooltips: cfg.showTooltips !== false,
        triggerLabel: cfg.triggerLabel || '',         // compact mode trigger text ('' = localized "Share")
        showAfterScroll: Number(cfg.showAfterScroll) || 0, // px scrolled before showing
        smartHide: cfg.smartHide === true,            // hide on scroll down, show on scroll up
        shareText: cfg.shareText || '',               // custom share copy override
        shareUrl: cfg.shareUrl || '',                 // custom URL override
        widgetId: cfg.widgetId || cfg._id || '',      // for click tracking
        trackClicks: cfg.trackClicks !== false,
        fontFamily: typeof cfg.fontFamily === 'string' ? cfg.fontFamily : '',
        theme: {
          mode: cfg.theme && cfg.theme.mode === 'dark' ? 'dark' : 'light',
          brand: safeColor(cfg.theme && cfg.theme.brand, '#0891B2'),
          card: safeColor(cfg.theme && cfg.theme.card, ''),
          text: safeColor(cfg.theme && cfg.theme.text, ''),
          radius: cfg.theme && Number.isFinite(Number(cfg.theme.radius)) ? Number(cfg.theme.radius) : 14,
        },
      };
    }

    _themeStyle() {
      const t = this.c.theme;
      const parts = [];
      if (t.brand) parts.push(`--tgsh-brand:${t.brand}`);
      if (t.card) parts.push(`--tgsh-card:${t.card}`);
      if (t.text) parts.push(`--tgsh-text:${t.text}`);
      if (Number.isFinite(t.radius)) parts.push(`--tgsh-radius:${t.radius}px`);
      if (Number.isFinite(this.c.iconSize)) parts.push(`--tgsh-icon-size:${this.c.iconSize}px`);
      const safe = safeFontStack(this.c.fontFamily, '');
      if (safe) {
        parts.push(`font-family:'${safe.replace(/'/g, '')}', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`);
      }
      return parts.join(';');
    }

    _renderButton(platform) {
      const meta = getPageMeta(this.c);
      // Platform names stay as brands; only copy/native are localizable chrome.
      let label = PLATFORM_LABELS[platform] || platform;
      if (platform === 'copy') label = this.t('copyLink');
      else if (platform === 'native') label = this.t('share');
      const tooltip = (this.c.showTooltips && !this.c.showLabels) ? ` data-tooltip="${esc(label)}"` : '';
      const colour = BRAND_COLOURS[platform] || '#64748B';
      const styleVar = ` style="--btn-brand:${colour}"`;
      const shape = this.c.showLabels ? 'pill' : (this.c.shape === 'square' ? 'square' : 'circle');
      const labelHtml = this.c.showLabels ? `<span class="tgsh-btn-label">${esc(label)}</span>` : '';

      // Native share button — uses navigator.share when available
      if (platform === 'native') {
        return `
          <button type="button" class="tgsh-btn" data-platform="native" data-shape="${shape}"${tooltip}${styleVar} aria-label="${esc(label)}">
            ${svg('native', 18)}
            ${labelHtml}
          </button>
        `;
      }

      // Copy link button
      if (platform === 'copy') {
        return `
          <button type="button" class="tgsh-btn" data-platform="copy" data-shape="${shape}"${tooltip}${styleVar} aria-label="${esc(label)}">
            ${svg('copy', 18)}
            ${labelHtml}
            <span class="tgsh-copied" data-copied>${esc(this.t('copied'))}</span>
          </button>
        `;
      }

      // Standard share link
      const href = buildShareLink(platform, meta);
      if (!href) return '';
      return `
        <a class="tgsh-btn" href="${esc(href)}" target="_blank" rel="noopener noreferrer" data-platform="${esc(platform)}" data-shape="${shape}"${tooltip}${styleVar} aria-label="${esc(this.t('shareOn', { platform: label }))}">
          ${svg(platform, 18)}
          ${labelHtml}
        </a>
      `;
    }

    _renderButtons() {
      // Filter native if not supported, copy is always usable
      const supportsNative = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
      return this.c.platforms
        .filter(p => p !== 'native' || supportsNative)
        .map(p => this._renderButton(p))
        .join('');
    }

    _render() {
      const cfg = this.c;
      const themeStyle = esc(this._themeStyle());
      let inner = '';

      switch (cfg.layout) {
        case 'dock':
          inner = `<div class="tgsh-dock" role="group" aria-label="${esc(this.t('shareThisPage'))}">${this._renderButtons()}</div>`;
          break;
        case 'inline':
          inner = `
            <div class="tgsh-inline" role="group" aria-label="${esc(this.t('shareThisPage'))}">
              ${cfg.showLabels ? '' : `<span class="tgsh-label">${esc(this.t('shareColon'))}</span>`}
              ${this._renderButtons()}
            </div>
          `;
          break;
        case 'compact':
          inner = `
            <div class="tgsh-compact-wrap">
              <button type="button" class="tgsh-compact-trigger" aria-haspopup="true" aria-expanded="false">
                ${svg('share', 16)}
                <span>${esc(cfg.triggerLabel || this.t('share'))}</span>
              </button>
              <div class="tgsh-compact-pop" role="menu" aria-label="${esc(this.t('shareOptions'))}" data-open="false">
                ${this._renderButtons()}
              </div>
            </div>
          `;
          break;
        case 'rail':
        default:
          inner = `<div class="tgsh-rail" data-side="${esc(cfg.side)}" role="group" aria-label="${esc(this.t('shareThisPage'))}">${this._renderButtons()}</div>`;
      }

      this.shadow.innerHTML = `
        <style>${STYLES}</style>
        <div class="tgsh-root" data-theme="${cfg.theme.mode}" data-colour="${esc(cfg.colourMode)}" style="${themeStyle}">
          ${inner}
        </div>
      `;
      this._bind();
    }

    _bind() {
      const root = this.shadow.querySelector('.tgsh-root');
      if (!root) return;

      // Compact trigger toggling
      const trig = this.shadow.querySelector('.tgsh-compact-trigger');
      const pop = this.shadow.querySelector('.tgsh-compact-pop');
      if (trig && pop) {
        trig.addEventListener('click', (e) => {
          e.stopPropagation();
          const isOpen = pop.getAttribute('data-open') === 'true';
          pop.setAttribute('data-open', String(!isOpen));
          trig.setAttribute('aria-expanded', String(!isOpen));
        });
        // Close on outside click
        if (typeof document !== 'undefined') {
          // Store + remove the previous handler so a re-render (update()) doesn't
          // stack duplicate document listeners, and tear down if the host was
          // removed without destroy() (SPA client sites).
          if (this._docClickHandler) document.removeEventListener('click', this._docClickHandler);
          this._docClickHandler = () => {
            if (this.el && !this.el.isConnected) { this.destroy(); return; }
            if (pop.getAttribute('data-open') === 'true') {
              pop.setAttribute('data-open', 'false');
              trig.setAttribute('aria-expanded', 'false');
            }
          };
          document.addEventListener('click', this._docClickHandler);
        }
      }

      // Button clicks: track + native share + copy
      const btns = this.shadow.querySelectorAll('.tgsh-btn');
      btns.forEach(b => {
        b.addEventListener('click', (e) => {
          const platform = b.getAttribute('data-platform');
          if (platform === 'native') {
            e.preventDefault();
            this._nativeShare();
          } else if (platform === 'copy') {
            e.preventDefault();
            this._copyLink(b);
          }
          this._track(platform);
        });
      });

      // Smart hide / show after scroll for floating layouts
      if (this.c.layout === 'rail' || this.c.layout === 'dock') {
        this._setupScrollBehaviour();
      }
    }

    _setupScrollBehaviour() {
      const floater = this.shadow.querySelector('.tgsh-rail, .tgsh-dock');
      if (!floater) return;
      const cfg = this.c;

      // Apply initial scroll-threshold visibility
      const applyVisibility = () => {
        if (this.el && !this.el.isConnected) { this.destroy(); return; }
        const y = window.scrollY || 0;
        const aboveThreshold = y >= (cfg.showAfterScroll || 0);
        if (!aboveThreshold) {
          floater.classList.add('is-hidden');
          this._lastScrollY = y;
          return;
        }
        if (cfg.smartHide) {
          if (y > this._lastScrollY + 4) {
            floater.classList.add('is-hidden');
          } else if (y < this._lastScrollY - 4) {
            floater.classList.remove('is-hidden');
          }
        } else {
          floater.classList.remove('is-hidden');
        }
        this._lastScrollY = y;
      };

      applyVisibility();

      // Remove any previous handler
      if (this._scrollHandler) {
        window.removeEventListener('scroll', this._scrollHandler);
      }
      let raf = false;
      this._scrollHandler = () => {
        if (raf) return;
        raf = true;
        requestAnimationFrame(() => { applyVisibility(); raf = false; });
      };
      window.addEventListener('scroll', this._scrollHandler, { passive: true });
    }

    _nativeShare() {
      const meta = getPageMeta(this.c);
      try {
        if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
          navigator.share({ title: meta.title, text: meta.title, url: meta.url }).catch(() => {});
        }
      } catch (e) { /* noop */ }
    }

    _copyLink(btn) {
      const meta = getPageMeta(this.c);
      const url = meta.url || '';
      const showCopied = () => {
        const tag = btn.querySelector('[data-copied]');
        if (!tag) return;
        tag.setAttribute('data-show', 'true');
        setTimeout(() => tag.setAttribute('data-show', 'false'), 1500);
      };
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(showCopied).catch(() => this._fallbackCopy(url, showCopied));
        } else {
          this._fallbackCopy(url, showCopied);
        }
      } catch (e) {
        this._fallbackCopy(url, showCopied);
      }
    }

    _fallbackCopy(text, cb) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        if (cb) cb();
      } catch (e) { /* noop */ }
    }

    _track(platform) {
      if (!this.c.trackClicks || !this.c.widgetId || !platform) return;
      try {
        const body = JSON.stringify({
          widgetId: this.c.widgetId,
          platform,
          pageUrl: (typeof location !== 'undefined') ? location.href : '',
        });
        // Use sendBeacon when possible to avoid blocking the share action
        if (navigator.sendBeacon && typeof Blob !== 'undefined') {
          navigator.sendBeacon(TRACK_BASE, new Blob([body], { type: 'application/json' }));
        } else {
          fetch(TRACK_BASE, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body, keepalive: true,
          }).catch(() => {});
        }
      } catch (e) { /* noop */ }
    }

    update(newConfig) {
      if (this._scrollHandler) {
        window.removeEventListener('scroll', this._scrollHandler);
        this._scrollHandler = null;
      }
      this.c = this._defaults(Object.assign({}, this.c, newConfig));
      this.t = makeT(this.c);
      this._render();
    }

    destroy() {
      if (this._docClickHandler) {
        document.removeEventListener('click', this._docClickHandler);
        this._docClickHandler = null;
      }
      if (this._scrollHandler) {
        window.removeEventListener('scroll', this._scrollHandler);
        this._scrollHandler = null;
      }
      this.shadow.innerHTML = '';
    }
  }

  // ---------- Auto-initializer ----------
  async function init() {
    const containers = document.querySelectorAll('[data-tg-widget="share"]');
    for (const el of containers) {
      if (el.__tgInited) continue;
      el.__tgInited = true;

      // Inline config first
      const inline = el.getAttribute('data-tg-config');
      if (inline) {
        try {
          const cfg = JSON.parse(inline);
          new TGShareWidget(el, cfg);
          continue;
        } catch (e) {
          console.warn('[TG Share] invalid data-tg-config', e);
        }
      }

      // Remote config
      const id = el.getAttribute('data-tg-id');
      if (id) {
        try {
          const url = `${API_BASE}?id=${encodeURIComponent(id)}`;
          const res = await fetch(url);
          if (!res.ok) throw new Error('Config load failed');
          const data = await res.json();
          const cfg = (data && data.config) ? Object.assign({}, data.config, { widgetId: id }) : { widgetId: id };
          new TGShareWidget(el, cfg);
        } catch (e) {
          console.warn('[TG Share] remote config error', e);
          el.textContent = '';
        }
      }
    }
  }

  // Expose
  window.TGShareWidget = TGShareWidget;
  window.__TG_SHARE_VERSION__ = VERSION;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
