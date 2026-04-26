/**
 * Travelgenix My Booking Widget v1.1.0
 * Self-contained, embeddable widget for retrieving and displaying confirmed bookings
 * Zero dependencies — works on any website via a single script tag
 *
 * v1.1.0 changes:
 *   - PDF download wired to /api/booking-pdf (Puppeteer-rendered A4 pack)
 *   - Email action hidden (Phase 2)
 *   - Single full-width PDF action button replaces 2-column action grid
 *   - Lookup credentials cached on widget instance for PDF re-lookup
 *   - Spinner-on-button + toast notifications during PDF generation
 *
 * Usage:
 *   <div data-tg-widget="mybooking" data-tg-id="YOUR_WIDGET_ID"></div>
 *   <script src="https://tg-widgets.vercel.app/widget-mybooking.js"></script>
 */
(function () {
  'use strict';

  // Derive the API base from this script's own src. When the widget is
  // loaded directly on widgets.travelify.io a relative "/api/..." works
  // fine, but when embedded cross-origin (e.g. inside Luna chat on a
  // client website) the relative path resolves against the host page
  // and 403s. Computing the base from document.currentScript ensures
  // we always hit the origin the widget was actually served from.
  //
  // Resolution order:
  //   1. window.__TG_WIDGET_API_BASE__ (explicit override, full origin)
  //   2. document.currentScript.src origin
  //   3. <script src*="widget-mybooking"> match in DOM
  //   4. Empty string (relative paths, original behaviour)
  function deriveApiBase() {
    if (typeof window === 'undefined') return '';
    if (typeof window.__TG_WIDGET_API_BASE__ === 'string' && window.__TG_WIDGET_API_BASE__) {
      return window.__TG_WIDGET_API_BASE__.replace(/\/$/, '');
    }
    try {
      var s = document.currentScript;
      if (!s) {
        // currentScript is null inside async callbacks; find by src match
        var scripts = document.getElementsByTagName('script');
        for (var i = 0; i < scripts.length; i++) {
          if (scripts[i].src && scripts[i].src.indexOf('widget-mybooking') !== -1) {
            s = scripts[i];
            break;
          }
        }
      }
      if (s && s.src) {
        var u = new URL(s.src, window.location.href);
        return u.origin;
      }
    } catch (_) {}
    return '';
  }

  var API_BASE = deriveApiBase();

  // Per-endpoint overrides still win — handy for local dev or when the
  // host wants to proxy via their own domain. Default behaviour is to
  // join the auto-detected origin with the standard path.
  const API_CONFIG = (typeof window !== 'undefined' && window.__TG_WIDGET_API__) || (API_BASE + '/api/widget-config');
  const API_RETRIEVE = (typeof window !== 'undefined' && window.__TG_RETRIEVE_API__) || (API_BASE + '/api/retrieve-order');
  const API_PDF = (typeof window !== 'undefined' && window.__TG_PDF_API__) || (API_BASE + '/api/booking-pdf');
  const VERSION = '1.1.0';

  // ----- Inline SVG icons (no external deps) -----
  const IC = {
    mail:    'M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2zM22 6L12 13 2 6',
    cal:     'M3 4h18v18H3zM3 10h18M16 2v6M8 2v6',
    pin:     'M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0zM12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    arrow:   'M5 12h14M12 5l7 7-7 7',
    shield:  'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
    check:   'M20 6L9 17 4 12',
    chev:    'M6 9l6 6 6-6',
    moon:    'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z',
    user:    'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
    users:   'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
    card:    'M2 5h20v14H2zM2 10h20',
    file:    'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6',
    dl:      'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
    home:    'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
    info:    'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 8v4M12 16h.01',
    coin:    'M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
    search:  'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35',
    clock:   'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
    phone:   'M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7a2 2 0 0 1 1.72 2z',
    booking: 'M3 8l7.89 5.26a2 2 0 0 0 2.22 0L21 8M3 5h18v14H3z',
    ref:     'M3 3h18v18H3zM9 9h6M9 13h6M9 17h4',
    refresh: 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-7.07 3M3 4v5h5',
    alert:   'M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01',
  };
  function svg(p, sw) {
    sw = sw || 2;
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + sw + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p.split(/(?=M)/).map(d => '<path d="' + d + '"/>').join('') + '</svg>';
  }
  function star() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="12 2 15 9 22 9.3 17 14 18.5 21 12 17.5 5.5 21 7 14 2 9.3 9 9 12 2"/></svg>';
  }

  // ----- Helpers -----
  function esc(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  function fmtMoney(amount, currency) {
    if (typeof amount !== 'number' || !Number.isFinite(amount)) return '';
    const cur = currency || 'GBP';
    try {
      return new Intl.NumberFormat('en-GB', { style: 'currency', currency: cur, minimumFractionDigits: 2 }).format(amount);
    } catch {
      return '£' + amount.toFixed(2);
    }
  }
  function fmtDate(iso, opts) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-GB', opts || { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function fmtDayMonth(iso) {
    return fmtDate(iso, { day: 'numeric', month: 'short' });
  }
  function fmtWeekday(iso) {
    return fmtDate(iso, { weekday: 'short' });
  }
  function fmtYear(iso) {
    return fmtDate(iso, { year: 'numeric' });
  }
  function daysUntil(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    const ms = d.getTime() - Date.now();
    return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
  }
  function initials(first, last) {
    const a = (first || '').trim();
    const b = (last || '').trim();
    return ((a[0] || '') + (b[0] || '')).toUpperCase() || '?';
  }
  function fileIconForExt(ext) {
    return svg(IC.file);
  }
  function fmtFileSize(bytes) {
    if (typeof bytes !== 'number' || !Number.isFinite(bytes)) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  // ----- Styles (injected into Shadow DOM) -----
  const STYLES = `
    :host { all: initial; display: block; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; }
    *, *::before, *::after { box-sizing: border-box; }

    .tgm-root {
      --tgm-primary: #1B2B5B;
      --tgm-primary-light: #2A3F7A;
      --tgm-primary-dark: #111D3E;
      --tgm-accent: #00B4D8;
      --tgm-accent-light: #48CAE4;
      --tgm-accent-dark: #0096B7;
      --tgm-success: #10B981;
      --tgm-warning: #F59E0B;
      --tgm-error: #EF4444;
      --tgm-bg: #FFFFFF;
      --tgm-bg-2: #F8FAFC;
      --tgm-bg-3: #F1F5F9;
      --tgm-border: #E2E8F0;
      --tgm-border-light: #F1F5F9;
      --tgm-text: #0F172A;
      --tgm-text-2: #475569;
      --tgm-text-3: #94A3B8;
      --tgm-radius: 16px;
      --tgm-radius-sm: 6px;
      --tgm-radius-md: 8px;
      --tgm-radius-lg: 12px;
      --tgm-radius-xl: 16px;
      --tgm-radius-2xl: 20px;
      font-size: 15px;
      color: var(--tgm-text);
      line-height: 1.6;
      position: relative;
    }
    .tgm-root[data-theme="dark"] {
      --tgm-bg: #0F172A;
      --tgm-bg-2: #1E293B;
      --tgm-bg-3: #334155;
      --tgm-border: #334155;
      --tgm-border-light: #1E293B;
      --tgm-text: #F8FAFC;
      --tgm-text-2: #CBD5E1;
      --tgm-text-3: #64748B;
    }
    .tgm-num { font-variant-numeric: tabular-nums; font-feature-settings: 'tnum' 1; }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.01ms !important;
      }
    }

    button { font-family: inherit; cursor: pointer; }
    a { color: inherit; }

    /* ===== VERTICAL FORM ===== */
    .tgm-form { background: var(--tgm-bg); border: 1px solid var(--tgm-border); border-radius: var(--tgm-radius-2xl); overflow: hidden; box-shadow: 0 10px 15px rgba(0,0,0,.08), 0 4px 6px rgba(0,0,0,.04); max-width: 560px; margin: 0 auto; }
    .tgm-hero-form { position: relative; padding: 48px 32px 32px; background: radial-gradient(circle at 20% 0%, rgba(0,180,216,.18), transparent 50%), radial-gradient(circle at 100% 100%, rgba(72,202,228,.10), transparent 50%), linear-gradient(135deg, var(--tgm-primary) 0%, var(--tgm-primary-dark) 100%); color: #fff; }
    .tgm-eyebrow { display: inline-flex; align-items: center; gap: 8px; font-size: 11px; font-weight: 500; letter-spacing: .08em; text-transform: uppercase; color: var(--tgm-accent-light); margin-bottom: 12px; }
    .tgm-eyebrow-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--tgm-accent); box-shadow: 0 0 12px var(--tgm-accent); }
    .tgm-form-title { font-size: 32px; font-weight: 700; line-height: 1.1; letter-spacing: -.02em; margin: 0 0 12px; color: #fff; }
    .tgm-form-sub { font-size: 16px; line-height: 1.5; color: rgba(248,250,252,.78); margin: 0; max-width: 52ch; }
    .tgm-form-body { padding: 32px; }
    .tgm-field { margin-bottom: 20px; }
    .tgm-label { display: block; font-size: 13px; font-weight: 500; color: var(--tgm-text-2); margin-bottom: 4px; }
    .tgm-input-wrap { position: relative; display: flex; align-items: center; }
    .tgm-input-wrap > svg { position: absolute; left: 12px; width: 18px; height: 18px; color: var(--tgm-text-3); pointer-events: none; }
    .tgm-input { width: 100%; height: 48px; padding: 0 12px 0 40px; font-family: inherit; font-size: 15px; color: var(--tgm-text); background: var(--tgm-bg); border: 1px solid var(--tgm-border); border-radius: var(--tgm-radius-md); outline: none; transition: border-color .15s, box-shadow .15s; }
    .tgm-input:focus { border-color: var(--tgm-accent); box-shadow: 0 0 0 3px rgba(0,180,216,.15); }
    .tgm-input::placeholder { color: var(--tgm-text-3); }
    .tgm-input.code { letter-spacing: .04em; font-variant-numeric: tabular-nums; }
    .tgm-cta { width: 100%; height: 48px; font-family: inherit; font-size: 16px; font-weight: 600; color: #fff; background: var(--tgm-primary); border: none; border-radius: var(--tgm-radius-md); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 8px; transition: background .15s, transform .1s, box-shadow .15s; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
    .tgm-cta:hover { background: var(--tgm-primary-light); box-shadow: 0 4px 6px rgba(0,0,0,.06); }
    .tgm-cta:active { transform: scale(.98); }
    .tgm-cta:disabled { opacity: .6; cursor: not-allowed; transform: none; }
    .tgm-cta svg { width: 18px; height: 18px; }
    .tgm-trust { margin-top: 16px; display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 13px; color: var(--tgm-text-3); }
    .tgm-trust svg { width: 14px; height: 14px; }

    .tgm-error-msg { margin-top: 12px; padding: 10px 12px; background: rgba(239,68,68,.08); border: 1px solid rgba(239,68,68,.2); border-radius: var(--tgm-radius-md); color: var(--tgm-error); font-size: 13px; line-height: 1.5; display: flex; align-items: center; gap: 8px; }
    .tgm-error-msg svg { width: 14px; height: 14px; flex-shrink: 0; }

    /* ===== HORIZONTAL FORM ===== */
    /* HORIZONTAL form — light by default, dark variant via [data-theme="dark"] below. */
    .tgm-hform { position: relative; padding: 24px; background: var(--tgm-bg); border: 1px solid var(--tgm-border); border-radius: var(--tgm-radius-2xl); overflow: hidden; box-shadow: 0 10px 15px rgba(0,0,0,.08), 0 4px 6px rgba(0,0,0,.04); }
    .tgm-hform::before { content: ''; position: absolute; inset: 0; background: radial-gradient(circle at 10% 20%, rgba(0,180,216,.06), transparent 50%); pointer-events: none; }
    .tgm-hform-top { position: relative; display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 20px; flex-wrap: wrap; }
    .tgm-hform-heading { display: flex; align-items: center; gap: 12px; }
    .tgm-hform-icon { width: 40px; height: 40px; background: var(--tgm-bg-2); border: 1px solid var(--tgm-border); border-radius: var(--tgm-radius-md); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .tgm-hform-icon svg { width: 20px; height: 20px; color: var(--tgm-accent); }
    .tgm-hform-title { font-size: 18px; font-weight: 700; letter-spacing: -.01em; margin: 0 0 2px; color: var(--tgm-text); line-height: 1.2; }
    .tgm-hform-sub { font-size: 13px; color: var(--tgm-text-2); margin: 0; }
    .tgm-hform-trust { display: inline-flex; align-items: center; gap: 8px; font-size: 11px; color: var(--tgm-text-2); padding: 8px 12px; background: var(--tgm-bg-2); border: 1px solid var(--tgm-border); border-radius: 9999px; }
    .tgm-hform-trust svg { width: 12px; height: 12px; }
    .tgm-hform-row { position: relative; display: grid; grid-template-columns: 1.2fr 1fr 1fr auto; gap: 12px; align-items: end; }
    .tgm-hform-field { display: flex; flex-direction: column; }
    .tgm-hform-field label { font-size: 11px; font-weight: 500; letter-spacing: .04em; text-transform: uppercase; color: var(--tgm-text-2); margin-bottom: 4px; }
    .tgm-hform-iw { position: relative; display: flex; align-items: center; }
    .tgm-hform-iw svg { position: absolute; left: 12px; width: 16px; height: 16px; color: var(--tgm-text-3); pointer-events: none; }
    .tgm-hform-input { width: 100%; height: 44px; padding: 0 12px 0 36px; font-family: inherit; font-size: 15px; color: var(--tgm-text); background: var(--tgm-bg); border: 1px solid var(--tgm-border); border-radius: var(--tgm-radius-md); outline: none; transition: all .15s; }
    .tgm-hform-input::placeholder { color: var(--tgm-text-3); }
    .tgm-hform-input:focus { border-color: var(--tgm-accent); box-shadow: 0 0 0 3px rgba(0,180,216,.15); }
    .tgm-hform-cta { height: 44px; padding: 0 20px; font-family: inherit; font-size: 15px; font-weight: 600; color: #fff; background: var(--tgm-primary); border: none; border-radius: var(--tgm-radius-md); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 8px; transition: background .15s, transform .1s; box-shadow: 0 4px 12px rgba(15,23,42,.15); white-space: nowrap; }
    .tgm-hform-cta:hover { background: var(--tgm-primary-light); }
    .tgm-hform-cta:active { transform: scale(.97); }
    .tgm-hform-cta:disabled { opacity: .6; cursor: not-allowed; }
    .tgm-hform-cta svg { width: 16px; height: 16px; }

    /* HORIZONTAL form — dark theme override */
    .tgm-root[data-theme="dark"] .tgm-hform { background: linear-gradient(135deg, var(--tgm-primary) 0%, var(--tgm-primary-dark) 100%); border-color: transparent; }
    .tgm-root[data-theme="dark"] .tgm-hform::before { background: radial-gradient(circle at 10% 20%, rgba(0,180,216,.15), transparent 50%), radial-gradient(circle at 90% 80%, rgba(72,202,228,.08), transparent 50%); }
    .tgm-root[data-theme="dark"] .tgm-hform-icon { background: rgba(255,255,255,.12); border-color: rgba(255,255,255,.2); }
    .tgm-root[data-theme="dark"] .tgm-hform-icon svg { color: var(--tgm-accent-light); }
    .tgm-root[data-theme="dark"] .tgm-hform-title { color: #fff; }
    .tgm-root[data-theme="dark"] .tgm-hform-sub { color: rgba(248,250,252,.7); }
    .tgm-root[data-theme="dark"] .tgm-hform-trust { color: rgba(248,250,252,.7); background: rgba(255,255,255,.08); border-color: rgba(255,255,255,.12); }
    .tgm-root[data-theme="dark"] .tgm-hform-field label { color: rgba(248,250,252,.7); }
    .tgm-root[data-theme="dark"] .tgm-hform-iw svg { color: rgba(255,255,255,.5); }
    .tgm-root[data-theme="dark"] .tgm-hform-input { color: #fff; background: rgba(255,255,255,.08); border-color: rgba(255,255,255,.15); }
    .tgm-root[data-theme="dark"] .tgm-hform-input::placeholder { color: rgba(255,255,255,.4); }
    .tgm-root[data-theme="dark"] .tgm-hform-input:focus { background: rgba(255,255,255,.12); border-color: var(--tgm-accent); box-shadow: 0 0 0 3px rgba(0,180,216,.25); }
    .tgm-root[data-theme="dark"] .tgm-hform-input::-webkit-calendar-picker-indicator { filter: invert(1) opacity(.6); }
    .tgm-root[data-theme="dark"] .tgm-hform-cta { color: var(--tgm-primary); background: var(--tgm-accent); box-shadow: 0 4px 12px rgba(0,180,216,.25); }
    .tgm-root[data-theme="dark"] .tgm-hform-cta:hover { background: var(--tgm-accent-light); }

    @media (max-width: 860px) {
      .tgm-hform-row { grid-template-columns: 1fr 1fr; }
      .tgm-hform-cta { grid-column: 1 / -1; width: 100%; }
    }
    @media (max-width: 480px) {
      .tgm-hform { padding: 16px; }
      .tgm-hform-row { grid-template-columns: 1fr; }
      .tgm-hform-top { flex-direction: column; align-items: flex-start; }
    }
    .tgm-hform.compact { padding: 16px; }
    .tgm-hform.compact .tgm-hform-top { margin-bottom: 12px; }
    .tgm-hform.compact .tgm-hform-icon { width: 32px; height: 32px; }
    .tgm-hform.compact .tgm-hform-title { font-size: 16px; }
    .tgm-hform.compact .tgm-hform-row { grid-template-columns: 1fr; }
    .tgm-hform.compact .tgm-hform-cta { width: 100%; grid-column: auto; }

    /* ===== LOADING ===== */
    .tgm-loading { background: var(--tgm-bg); border: 1px solid var(--tgm-border); border-radius: var(--tgm-radius-2xl); padding: 64px 32px; text-align: center; box-shadow: 0 10px 15px rgba(0,0,0,.08), 0 4px 6px rgba(0,0,0,.04); max-width: 560px; margin: 0 auto; }
    .tgm-spinner { width: 40px; height: 40px; margin: 0 auto 24px; border: 2.5px solid var(--tgm-bg-3); border-top-color: var(--tgm-accent); border-radius: 50%; animation: tgm-spin .8s linear infinite; }
    @keyframes tgm-spin { to { transform: rotate(360deg); } }
    .tgm-loading h2 { font-size: 18px; font-weight: 600; margin: 0 0 4px; letter-spacing: -.01em; }
    .tgm-loading p { font-size: 15px; color: var(--tgm-text-2); margin: 0; }

    /* ===== FOUND ===== */
    .tgm-found { animation: tgm-fadeup .4s cubic-bezier(.2,.7,.2,1); }
    @keyframes tgm-fadeup { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
    .tgm-hero { position: relative; height: 380px; border-radius: var(--tgm-radius-2xl); overflow: hidden; box-shadow: 0 20px 25px rgba(0,0,0,.08), 0 10px 10px rgba(0,0,0,.04); margin-bottom: 16px; }
    .tgm-hero-img { position: absolute; inset: 0; background-size: cover; background-position: center; transform: scale(1.04); animation: tgm-zoom 24s ease-in-out infinite alternate; }
    @keyframes tgm-zoom { to { transform: scale(1.1); } }
    .tgm-hero-overlay { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(15,23,42,.10) 0%, rgba(15,23,42,.20) 40%, rgba(15,23,42,.85) 100%); }
    .tgm-hero-content { position: absolute; inset: 0; padding: 32px; display: flex; flex-direction: column; justify-content: space-between; color: #fff; }
    .tgm-hero-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
    .tgm-confirmed { display: inline-flex; align-items: center; gap: 8px; padding: 4px 12px; background: rgba(16,185,129,.95); backdrop-filter: blur(8px); border-radius: 9999px; font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: #fff; box-shadow: 0 2px 8px rgba(16,185,129,.3); }
    .tgm-confirmed svg { width: 13px; height: 13px; stroke-width: 3; }
    .tgm-ref { padding: 4px 12px; background: rgba(255,255,255,.12); backdrop-filter: blur(10px); border: 1px solid rgba(255,255,255,.18); border-radius: var(--tgm-radius-md); font-size: 11px; font-weight: 500; color: rgba(255,255,255,.92); letter-spacing: .04em; }
    .tgm-ref strong { color: #fff; margin-left: 8px; font-weight: 700; letter-spacing: .02em; font-variant-numeric: tabular-nums; }
    .tgm-hero-rating { display: inline-flex; gap: 2px; align-items: center; margin-bottom: 12px; }
    .tgm-hero-rating svg { width: 14px; height: 14px; fill: #FFD166; color: #FFD166; }
    .tgm-hero-name { font-size: 32px; font-weight: 700; letter-spacing: -.02em; line-height: 1.05; margin: 0 0 4px; text-shadow: 0 2px 12px rgba(0,0,0,.3); }
    .tgm-hero-loc { display: inline-flex; align-items: center; gap: 8px; font-size: 15px; color: rgba(255,255,255,.88); margin: 0; }
    .tgm-hero-loc svg { width: 14px; height: 14px; }
    .tgm-hero-thumbs { position: absolute; bottom: 16px; right: 16px; display: flex; gap: 8px; }
    .tgm-hero-thumbs button { width: 48px; height: 48px; border-radius: var(--tgm-radius-md); background-size: cover; background-position: center; border: 2px solid rgba(255,255,255,.3); cursor: pointer; padding: 0; transition: transform .15s, border-color .15s; }
    .tgm-hero-thumbs button:hover { transform: translateY(-2px); border-color: #fff; }
    .tgm-hero-thumbs button.active { border-color: #fff; }

    .tgm-greeting { display: flex; justify-content: space-between; align-items: center; padding: 16px 20px; background: var(--tgm-bg); border: 1px solid var(--tgm-border); border-radius: var(--tgm-radius-lg); margin-bottom: 16px; flex-wrap: wrap; gap: 12px; }
    .tgm-greeting-text { font-size: 15px; }
    .tgm-greeting-text strong { font-weight: 600; }
    .tgm-countdown { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; color: var(--tgm-text-2); padding: 4px 12px; background: var(--tgm-bg-2); border-radius: 9999px; font-weight: 500; }
    .tgm-countdown svg { width: 14px; height: 14px; }
    .tgm-countdown strong { color: var(--tgm-accent-dark); font-weight: 700; font-variant-numeric: tabular-nums; }

    /* Single full-width PDF action button */
    .tgm-action-row { margin-bottom: 16px; }
    .tgm-action { display: flex; align-items: center; gap: 16px; padding: 18px 24px; background: var(--tgm-bg); border: 1px solid var(--tgm-border); border-radius: var(--tgm-radius-lg); cursor: pointer; text-align: left; font-family: inherit; transition: all .25s cubic-bezier(.2,.7,.2,1); width: 100%; position: relative; }
    .tgm-action:hover:not(:disabled) { border-color: var(--tgm-accent); transform: translateY(-1px); box-shadow: 0 4px 6px rgba(0,0,0,.06), 0 2px 4px rgba(0,0,0,.04); }
    .tgm-action:disabled { cursor: wait; opacity: .85; }
    .tgm-action-icon { width: 44px; height: 44px; border-radius: var(--tgm-radius-md); background: linear-gradient(135deg, var(--tgm-accent) 0%, var(--tgm-accent-dark) 100%); display: flex; align-items: center; justify-content: center; color: #fff; flex-shrink: 0; }
    .tgm-action-icon svg { width: 20px; height: 20px; }
    .tgm-action-text { flex: 1; min-width: 0; }
    .tgm-action-title { font-size: 16px; font-weight: 600; color: var(--tgm-text); margin-bottom: 2px; letter-spacing: -.01em; }
    .tgm-action-sub { font-size: 13px; color: var(--tgm-text-2); }
    .tgm-action-arrow { width: 20px; height: 20px; color: var(--tgm-text-3); transition: transform .15s, color .15s; flex-shrink: 0; }
    .tgm-action:hover:not(:disabled) .tgm-action-arrow { transform: translateX(2px); color: var(--tgm-accent); }
    .tgm-action.is-loading .tgm-action-arrow { display: none; }
    .tgm-action-loader { width: 20px; height: 20px; border: 2px solid var(--tgm-bg-3); border-top-color: var(--tgm-accent); border-radius: 50%; animation: tgm-spin .7s linear infinite; flex-shrink: 0; display: none; }
    .tgm-action.is-loading .tgm-action-loader { display: block; }

    /* Toast notifications */
    .tgm-toast-stack { position: fixed; top: 20px; right: 20px; display: flex; flex-direction: column; gap: 8px; pointer-events: none; z-index: 999999; max-width: 380px; }
    .tgm-toast { display: flex; align-items: center; gap: 12px; padding: 12px 16px; background: var(--tgm-bg); border: 1px solid var(--tgm-border); border-radius: var(--tgm-radius-lg); box-shadow: 0 10px 25px rgba(0,0,0,.12), 0 4px 10px rgba(0,0,0,.06); font-size: 14px; color: var(--tgm-text); pointer-events: auto; animation: tgm-toast-in .35s cubic-bezier(.2,.7,.2,1); min-width: 280px; }
    .tgm-toast.is-leaving { animation: tgm-toast-out .25s cubic-bezier(.4,0,1,1) forwards; }
    @keyframes tgm-toast-in { from { opacity: 0; transform: translateX(20px); } to { opacity: 1; transform: none; } }
    @keyframes tgm-toast-out { to { opacity: 0; transform: translateX(20px); } }
    .tgm-toast-icon { width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0; color: #fff; }
    .tgm-toast-icon svg { width: 16px; height: 16px; stroke-width: 2.5; }
    .tgm-toast.is-loading .tgm-toast-icon { background: var(--tgm-accent); }
    .tgm-toast.is-success .tgm-toast-icon { background: var(--tgm-success); }
    .tgm-toast.is-error .tgm-toast-icon { background: var(--tgm-error); }
    .tgm-toast.is-loading .tgm-toast-icon::before { content: ''; width: 14px; height: 14px; border: 2px solid rgba(255,255,255,.4); border-top-color: #fff; border-radius: 50%; animation: tgm-spin .7s linear infinite; }
    .tgm-toast.is-loading .tgm-toast-icon svg { display: none; }
    .tgm-toast-content { flex: 1; min-width: 0; }
    .tgm-toast-title { font-weight: 600; font-size: 14px; color: var(--tgm-text); }
    .tgm-toast-sub { font-size: 12px; color: var(--tgm-text-2); margin-top: 1px; }

    .tgm-stay { background: var(--tgm-bg); border: 1px solid var(--tgm-border); border-radius: var(--tgm-radius-lg); padding: 20px; margin-bottom: 16px; }
    .tgm-stay-grid { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 16px; }
    .tgm-stay-cell { padding: 0 16px; border-right: 1px solid var(--tgm-border-light); }
    .tgm-stay-cell:first-child { padding-left: 0; }
    .tgm-stay-cell:last-child { border-right: none; padding-right: 0; }
    .tgm-stay-label { display: flex; align-items: center; gap: 8px; font-size: 11px; font-weight: 500; letter-spacing: .06em; text-transform: uppercase; color: var(--tgm-text-3); margin-bottom: 8px; }
    .tgm-stay-label svg { width: 13px; height: 13px; }
    .tgm-stay-value { font-size: 18px; font-weight: 600; color: var(--tgm-text); letter-spacing: -.01em; font-variant-numeric: tabular-nums; }
    .tgm-stay-sub { font-size: 13px; color: var(--tgm-text-2); margin-top: 2px; }
    @media (max-width: 780px) {
      .tgm-stay-grid { grid-template-columns: 1fr 1fr; }
      .tgm-stay-cell { padding: 0; border-right: none; border-bottom: 1px solid var(--tgm-border-light); padding-bottom: 12px; }
      .tgm-stay-cell:nth-last-child(-n+2) { border-bottom: none; padding-bottom: 0; padding-top: 12px; }
    }

    .tgm-two { display: grid; grid-template-columns: 1.5fr 1fr; gap: 16px; margin-bottom: 16px; }
    @media (max-width: 780px) { .tgm-two { grid-template-columns: 1fr; } }

    .tgm-section { background: var(--tgm-bg); border: 1px solid var(--tgm-border); border-radius: var(--tgm-radius-lg); padding: 20px; margin-bottom: 16px; }
    .tgm-section h3 { display: flex; align-items: center; gap: 8px; font-size: 16px; font-weight: 600; margin: 0 0 16px; color: var(--tgm-text); letter-spacing: -.01em; }
    .tgm-section h3 svg { width: 16px; height: 16px; color: var(--tgm-accent); }

    .tgm-pay-total { display: flex; align-items: baseline; justify-content: space-between; padding-bottom: 16px; border-bottom: 1px solid var(--tgm-border-light); margin-bottom: 16px; }
    .tgm-pay-label { font-size: 13px; color: var(--tgm-text-2); }
    .tgm-pay-total-amt { font-size: 28px; font-weight: 700; color: var(--tgm-text); letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
    .tgm-pay-row { display: flex; justify-content: space-between; font-size: 15px; padding: 8px 0; }
    .tgm-pay-row .v { font-weight: 500; color: var(--tgm-text); font-variant-numeric: tabular-nums; }
    .tgm-pay-row .v.paid { color: var(--tgm-success); }
    .tgm-pay-row .v.due { color: var(--tgm-warning); }
    .tgm-pay-sched { margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--tgm-border-light); }
    .tgm-pay-sched-title { font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--tgm-text-3); margin-bottom: 12px; }
    .tgm-inst { display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; margin-bottom: 4px; border-radius: var(--tgm-radius-sm); font-size: 13px; transition: background .15s; }
    .tgm-inst:hover { background: var(--tgm-bg-2); }
    .tgm-inst .date { color: var(--tgm-text-2); font-variant-numeric: tabular-nums; }
    .tgm-inst .amt { font-weight: 600; color: var(--tgm-text); font-variant-numeric: tabular-nums; }

    .tgm-guest { display: flex; align-items: center; gap: 12px; }
    .tgm-guest-av { width: 40px; height: 40px; border-radius: 50%; background: linear-gradient(135deg, var(--tgm-accent), var(--tgm-accent-dark)); display: flex; align-items: center; justify-content: center; color: #fff; font-weight: 600; font-size: 13px; letter-spacing: .04em; flex-shrink: 0; }
    .tgm-guest-info { flex: 1; min-width: 0; }
    .tgm-guest-name { font-size: 15px; font-weight: 500; color: var(--tgm-text); }
    .tgm-guest-meta { font-size: 13px; color: var(--tgm-text-3); }
    .tgm-guest + .tgm-guest { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--tgm-border-light); }

    .tgm-collapse { background: var(--tgm-bg); border: 1px solid var(--tgm-border); border-radius: var(--tgm-radius-lg); margin-bottom: 8px; overflow: hidden; }
    .tgm-collapse-trig { width: 100%; display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; background: transparent; border: none; cursor: pointer; text-align: left; font-family: inherit; font-size: 16px; font-weight: 500; color: var(--tgm-text); transition: background .15s; }
    .tgm-collapse-trig:hover { background: var(--tgm-bg-2); }
    .tgm-collapse-trig .chev { width: 18px; height: 18px; color: var(--tgm-text-3); transition: transform .25s; }
    .tgm-collapse.open .chev { transform: rotate(180deg); }
    .tgm-collapse-left { display: flex; align-items: center; gap: 12px; }
    .tgm-collapse-left > svg:first-child { width: 18px; height: 18px; color: var(--tgm-accent); }
    .tgm-collapse-body { max-height: 0; overflow: hidden; transition: max-height .4s cubic-bezier(.2,.7,.2,1); }
    .tgm-collapse.open .tgm-collapse-body { max-height: 1200px; }
    .tgm-collapse-inner { padding: 0 20px 20px; font-size: 15px; color: var(--tgm-text-2); line-height: 1.6; }
    .tgm-collapse-inner p { margin: 0 0 12px; }
    .tgm-collapse-inner p:last-child { margin-bottom: 0; }
    .tgm-collapse-inner strong { color: var(--tgm-text); font-weight: 600; }

    .tgm-docs { display: flex; flex-direction: column; gap: 8px; }
    .tgm-doc { display: flex; align-items: center; gap: 12px; padding: 12px; border: 1px solid var(--tgm-border); border-radius: var(--tgm-radius-md); text-decoration: none; color: inherit; transition: all .15s; }
    .tgm-doc:hover { border-color: var(--tgm-accent); background: var(--tgm-bg-2); transform: translateX(2px); }
    .tgm-doc-icon { width: 36px; height: 36px; border-radius: var(--tgm-radius-sm); background: var(--tgm-bg-3); display: flex; align-items: center; justify-content: center; color: var(--tgm-primary); flex-shrink: 0; }
    .tgm-doc-icon svg { width: 18px; height: 18px; }
    .tgm-doc-info { flex: 1; min-width: 0; }
    .tgm-doc-name { font-size: 15px; font-weight: 500; color: var(--tgm-text); }
    .tgm-doc-meta { font-size: 13px; color: var(--tgm-text-3); }
    .tgm-doc-dl { width: 18px; height: 18px; color: var(--tgm-text-3); flex-shrink: 0; }

    .tgm-facilities { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
    .tgm-fac { display: inline-flex; align-items: center; gap: 8px; padding: 4px 12px; background: var(--tgm-bg-2); border: 1px solid var(--tgm-border-light); border-radius: 9999px; font-size: 13px; color: var(--tgm-text-2); }
    .tgm-fac svg { width: 13px; height: 13px; color: var(--tgm-success); }

    .tgm-help { background: linear-gradient(135deg, var(--tgm-primary) 0%, var(--tgm-primary-dark) 100%); color: #fff; padding: 20px; border-radius: var(--tgm-radius-lg); display: flex; justify-content: space-between; align-items: center; gap: 16px; flex-wrap: wrap; margin-top: 24px; }
    .tgm-help h3 { font-size: 16px; font-weight: 600; margin: 0 0 4px; letter-spacing: -.01em; color: #fff; }
    .tgm-help p { font-size: 13px; color: rgba(248,250,252,.78); margin: 0; }
    .tgm-help-actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .tgm-help-btn { padding: 8px 16px; background: rgba(255,255,255,.1); border: 1px solid rgba(255,255,255,.2); color: #fff; font-size: 13px; font-weight: 500; border-radius: var(--tgm-radius-md); cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; gap: 8px; transition: background .15s; }
    .tgm-help-btn:hover { background: rgba(255,255,255,.18); }
    .tgm-help-btn svg { width: 14px; height: 14px; }

    .tgm-h-eyebrow { font-size: 16px; font-weight: 600; margin: 32px 0 12px; color: var(--tgm-text); letter-spacing: -.01em; }

    /* ===== NOT FOUND ===== */
    .tgm-nf { background: var(--tgm-bg); border: 1px solid var(--tgm-border); border-radius: var(--tgm-radius-2xl); padding: 48px 32px; text-align: center; box-shadow: 0 4px 6px rgba(0,0,0,.06), 0 2px 4px rgba(0,0,0,.04); max-width: 560px; margin: 0 auto; }
    .tgm-nf-icon { width: 64px; height: 64px; margin: 0 auto 20px; background: var(--tgm-bg-3); border-radius: 50%; display: flex; align-items: center; justify-content: center; color: var(--tgm-text-3); }
    .tgm-nf-icon svg { width: 28px; height: 28px; }
    .tgm-nf h2 { font-size: 22px; font-weight: 600; margin: 0 0 8px; letter-spacing: -.01em; color: var(--tgm-text); }
    .tgm-nf p { font-size: 15px; color: var(--tgm-text-2); max-width: 48ch; margin: 0 auto 24px; line-height: 1.6; }
    .tgm-nf-actions { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
    .tgm-btn-2 { height: 44px; padding: 0 20px; background: var(--tgm-bg); border: 1px solid var(--tgm-border); border-radius: var(--tgm-radius-md); font-family: inherit; font-size: 15px; font-weight: 500; color: var(--tgm-text); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 8px; text-decoration: none; transition: all .15s; }
    .tgm-btn-2:hover { border-color: var(--tgm-accent); }
    .tgm-btn-1 { height: 44px; padding: 0 20px; background: var(--tgm-primary); border: 1px solid var(--tgm-primary); border-radius: var(--tgm-radius-md); font-family: inherit; font-size: 15px; font-weight: 500; color: #fff; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 8px; text-decoration: none; transition: all .15s; }
    .tgm-btn-1:hover { background: var(--tgm-primary-light); }
    .tgm-btn-1 svg, .tgm-btn-2 svg { width: 16px; height: 16px; }

    @media (max-width: 480px) {
      .tgm-hero { height: 320px; }
      .tgm-hero-name { font-size: 24px; }
      .tgm-hero-content { padding: 20px; }
      .tgm-hero-thumbs { display: none; }
      .tgm-form-title { font-size: 24px; }
      .tgm-form-hero { padding: 32px 20px 24px; }
      .tgm-form-body { padding: 20px; }
      .tgm-section, .tgm-stay { padding: 16px; }
      .tgm-toast-stack { left: 16px; right: 16px; max-width: none; }
      .tgm-toast { min-width: 0; }
    }
  `;

  // ----- Templates -----

  function renderForm(c, state) {
    const layout = c.layout || 'vertical';
    if (layout === 'horizontal' || layout === 'compact') {
      return renderFormHorizontal(c, state, layout === 'compact');
    }
    return renderFormVertical(c, state);
  }

  function renderFormVertical(c, state) {
    const errMsg = state && state.error
      ? '<div class="tgm-error-msg" role="alert">' + svg(IC.info) + esc(state.error) + '</div>'
      : '';
    return `
      <div class="tgm-form">
        <div class="tgm-hero-form">
          <span class="tgm-eyebrow"><span class="tgm-eyebrow-dot"></span>${esc(c.eyebrow || 'Secure booking lookup')}</span>
          <h1 class="tgm-form-title">${esc(c.title || 'My Booking')}</h1>
          <p class="tgm-form-sub">${esc(c.subtitle || 'Welcome back. Enter your details to view everything about your upcoming trip.')}</p>
        </div>
        <form class="tgm-form-body" data-tgm-form>
          <div class="tgm-field">
            <label class="tgm-label" for="tgm-email">${esc(c.labels?.email || 'Email address')}</label>
            <div class="tgm-input-wrap">
              ${svg(IC.mail)}
              <input type="email" class="tgm-input" id="tgm-email" name="email" placeholder="you@example.com" autocomplete="email" required>
            </div>
          </div>
          <div class="tgm-field">
            <label class="tgm-label" for="tgm-date">${esc(c.labels?.date || 'Departure date')}</label>
            <div class="tgm-input-wrap">
              ${svg(IC.cal)}
              <input type="date" class="tgm-input" id="tgm-date" name="date" required>
            </div>
          </div>
          <div class="tgm-field">
            <label class="tgm-label" for="tgm-ref">${esc(c.labels?.ref || 'Booking reference')}</label>
            <div class="tgm-input-wrap">
              ${svg(IC.ref)}
              <input type="text" class="tgm-input code" id="tgm-ref" name="ref" placeholder="${esc(c.labels?.refPlaceholder || 'e.g. ABC12345')}" autocomplete="off" required>
            </div>
          </div>
          <button type="submit" class="tgm-cta" data-tgm-submit>${esc(c.labels?.submit || 'Find my booking')}${svg(IC.arrow)}</button>
          <div class="tgm-trust">${svg(IC.shield)}${esc(c.labels?.trust || 'Your details are encrypted and never stored.')}</div>
          ${errMsg}
        </form>
      </div>
    `;
  }

  function renderFormHorizontal(c, state, isCompact) {
    const errMsg = state && state.error
      ? '<div class="tgm-error-msg" role="alert" style="margin-top:16px; background:rgba(255,255,255,.08); border-color:rgba(239,68,68,.4); color:#fca5a5;">' + svg(IC.info) + esc(state.error) + '</div>'
      : '';
    return `
      <div class="tgm-hform${isCompact ? ' compact' : ''}">
        <div class="tgm-hform-top">
          <div class="tgm-hform-heading">
            <div class="tgm-hform-icon">${svg(IC.booking)}</div>
            <div>
              <h2 class="tgm-hform-title">${esc(c.title || 'My Booking')}</h2>
              <p class="tgm-hform-sub">${esc(c.subtitleShort || 'Look up your trip in seconds')}</p>
            </div>
          </div>
          ${!isCompact ? `<span class="tgm-hform-trust">${svg(IC.shield)}${esc(c.labels?.trustShort || 'Secure lookup')}</span>` : ''}
        </div>
        <form class="tgm-hform-row" data-tgm-form>
          <div class="tgm-hform-field">
            <label>${esc(c.labels?.email || 'Email address')}</label>
            <div class="tgm-hform-iw">${svg(IC.mail)}
              <input type="email" class="tgm-hform-input" name="email" placeholder="you@example.com" autocomplete="email" required>
            </div>
          </div>
          <div class="tgm-hform-field">
            <label>${esc(c.labels?.date || 'Departure date')}</label>
            <div class="tgm-hform-iw">${svg(IC.cal)}
              <input type="date" class="tgm-hform-input" name="date" required>
            </div>
          </div>
          <div class="tgm-hform-field">
            <label>${esc(c.labels?.refShort || 'Reference')}</label>
            <div class="tgm-hform-iw">${svg(IC.ref)}
              <input type="text" class="tgm-hform-input" name="ref" placeholder="${esc(c.labels?.refPlaceholder || 'e.g. ABC12345')}" style="letter-spacing:.04em; font-variant-numeric:tabular-nums;" autocomplete="off" required>
            </div>
          </div>
          <button type="submit" class="tgm-hform-cta" data-tgm-submit>${esc(c.labels?.submitShort || 'Find booking')}${svg(IC.arrow, 2.5)}</button>
        </form>
        ${errMsg}
      </div>
    `;
  }

  function renderLoading(c) {
    return `
      <div class="tgm-loading" role="status" aria-live="polite">
        <div class="tgm-spinner" aria-hidden="true"></div>
        <h2>${esc(c.labels?.loadingTitle || 'Finding your booking')}</h2>
        <p>${esc(c.labels?.loadingSub || 'This usually takes a couple of seconds.')}</p>
      </div>
    `;
  }

  function renderNotFound(c) {
    return `
      <div class="tgm-nf">
        <div class="tgm-nf-icon">${svg(IC.search)}</div>
        <h2>${esc(c.labels?.nfTitle || "We couldn't find that booking")}</h2>
        <p>${esc(c.labels?.nfBody || "Please double-check your email address, departure date and booking reference. If the details look right, get in touch and we'll help you straight away.")}</p>
        <div class="tgm-nf-actions">
          <button type="button" class="tgm-btn-2" data-tgm-tryagain>${svg(IC.refresh)}${esc(c.labels?.nfRetry || 'Try again')}</button>
          ${c.support?.email ? `<a class="tgm-btn-1" href="mailto:${esc(c.support.email)}">${svg(IC.mail)}${esc(c.labels?.nfContact || 'Contact support')}</a>` : ''}
        </div>
      </div>
    `;
  }

  function renderFound(order, c) {
    const item = order.items?.[0];
    const acc = item?.accommodation;
    const checkin = item?.startDate;
    const nights = item?.duration || 0;
    const checkoutMs = checkin ? new Date(checkin).getTime() + nights * 86400000 : null;
    const checkout = checkoutMs ? new Date(checkoutMs).toISOString() : null;
    const days = daysUntil(checkin);

    // Hero image
    const heroUrl = acc?.media?.[0]?.url || '';
    const thumbs = (acc?.media || []).slice(0, 4);

    // Confirm pill + ref
    const refValue = item?.bookingReference || ('TG' + order.id);

    // Stars
    const starHtml = acc?.rating ? Array.from({ length: Math.round(acc.rating) }, () => star()).join('') : '';

    // Guests
    const guests = acc?.guests || [];

    // Pricing
    const pricing = acc?.pricing;
    const totalPrice = pricing?.memberPrice ?? pricing?.price ?? item?.price ?? 0;
    const currency = pricing?.currency || order.currency || 'GBP';
    const inResort = pricing?.inResortFees;

    // Deposit options - pick first one with installments, else first one
    const depositOpts = pricing?.depositOptions || [];
    const installPlan = depositOpts.find(d => d.installments && d.installmentsAmount) || null;
    const standardDep = depositOpts.find(d => !d.installments) || depositOpts[0] || null;

    // Cancellation policy from rate descriptions
    const rate = acc?.units?.[0]?.rates?.[0];
    const cancelDescs = (rate?.descriptions || []).filter(d => d.type === 'CancelAndAmendments');

    // Hotel description
    const hotelDesc = (acc?.descriptions || []).find(d => d.title === 'Description' || d.type === 'Generic');

    // Facilities
    const facilitiesList = (acc?.descriptions || []).find(d => d.title === 'Facilities');
    const facilities = facilitiesList?.text ? facilitiesList.text.split(/[,•]/).map(s => s.trim()).filter(Boolean).slice(0, 12) : [];

    // Documents
    const docs = order.documents || [];
    const showDocs = c.display?.showDocuments !== false && docs.length > 0;

    // Greeting
    const firstName = order.customerFirstname || 'there';
    const destCity = acc?.location?.city || '';

    // City tax / local fees
    const importantInfo = (acc?.descriptions || []).filter(d => d.type === 'ImportantInfo');

    return `
      <div class="tgm-found">
        ${heroUrl ? `
        <div class="tgm-hero">
          <div class="tgm-hero-img" data-tgm-hero-img style="background-image:url('${esc(heroUrl)}')"></div>
          <div class="tgm-hero-overlay"></div>
          <div class="tgm-hero-content">
            <div class="tgm-hero-top">
              <span class="tgm-confirmed">${svg(IC.check, 3)}${esc(c.labels?.confirmed || 'Confirmed')}</span>
              <span class="tgm-ref">${esc(c.labels?.ref || 'Ref')}<strong>${esc(refValue)}</strong></span>
            </div>
            <div>
              ${starHtml ? `<div class="tgm-hero-rating">${starHtml}</div>` : ''}
              <h1 class="tgm-hero-name">${esc(acc?.name || 'Your booking')}</h1>
              ${acc?.location?.city ? `<p class="tgm-hero-loc">${svg(IC.pin)}${esc(acc.location.city)}${acc.location.country ? ', ' + esc(acc.location.country) : ''}</p>` : ''}
            </div>
          </div>
          ${thumbs.length > 1 ? `<div class="tgm-hero-thumbs">${thumbs.map((m, i) => `<button class="${i === 0 ? 'active' : ''}" data-tgm-thumb data-img="${esc(m.url)}" style="background-image:url('${esc(m.url)}')" aria-label="View image ${i + 1}"></button>`).join('')}</div>` : ''}
        </div>
        ` : ''}

        <div class="tgm-greeting">
          <div class="tgm-greeting-text">${esc((c.labels?.greetingPrefix || 'Welcome back'))}, <strong>${esc(firstName)}</strong>${destCity ? ` — your ${esc(destCity)} escape is almost here.` : '.'}</div>
          ${days != null && days > 0 ? `<div class="tgm-countdown">${svg(IC.clock)}<span><strong class="tgm-num">${days} ${days === 1 ? 'day' : 'days'}</strong> ${esc(c.labels?.countdown || 'until you fly')}</span></div>` : ''}
        </div>

        ${(c.display?.showActions !== false) ? `
        <div class="tgm-action-row">
          <button type="button" class="tgm-action" data-tgm-pdf-action>
            <div class="tgm-action-icon">${svg(IC.dl)}</div>
            <div class="tgm-action-text">
              <div class="tgm-action-title">${esc(c.labels?.actionPdf || 'Download as PDF')}</div>
              <div class="tgm-action-sub">${esc(c.labels?.actionPdfSub || 'A4 confirmation pack with all your booking details')}</div>
            </div>
            <div class="tgm-action-loader" aria-hidden="true"></div>
            ${svg(IC.arrow)}
          </button>
        </div>
        ` : ''}

        <div class="tgm-stay">
          <div class="tgm-stay-grid">
            ${checkin ? `
            <div class="tgm-stay-cell">
              <div class="tgm-stay-label">${svg(IC.cal)}${esc(c.labels?.checkin || 'Check-in')}</div>
              <div class="tgm-stay-value">${esc(fmtDayMonth(checkin))}</div>
              <div class="tgm-stay-sub">${esc(fmtWeekday(checkin))} · ${esc(fmtYear(checkin))}</div>
            </div>` : ''}
            ${checkout ? `
            <div class="tgm-stay-cell">
              <div class="tgm-stay-label">${svg(IC.cal)}${esc(c.labels?.checkout || 'Check-out')}</div>
              <div class="tgm-stay-value">${esc(fmtDayMonth(checkout))}</div>
              <div class="tgm-stay-sub">${esc(fmtWeekday(checkout))} · ${esc(fmtYear(checkout))}</div>
            </div>` : ''}
            ${nights ? `
            <div class="tgm-stay-cell">
              <div class="tgm-stay-label">${svg(IC.moon)}${esc(c.labels?.nights || 'Nights')}</div>
              <div class="tgm-stay-value">${nights}</div>
              <div class="tgm-stay-sub">${nights === 1 ? '1 night' : (nights === 7 ? '1 week' : nights + ' nights')}</div>
            </div>` : ''}
            ${acc?.units?.[0] ? `
            <div class="tgm-stay-cell">
              <div class="tgm-stay-label">${svg(IC.user)}${esc(c.labels?.room || 'Room')}</div>
              <div class="tgm-stay-value">${esc((acc.units[0].roomType !== 'Unknown' && acc.units[0].roomType) || 'Deluxe')}</div>
              <div class="tgm-stay-sub">${esc(rate?.board || 'Room only')}${(acc.units[0].sleepsAdults != null) ? ` · ${acc.units[0].sleepsAdults} guest${acc.units[0].sleepsAdults === 1 ? '' : 's'}` : ''}</div>
            </div>` : ''}
          </div>
        </div>

        <div class="tgm-two">
          <div class="tgm-section">
            <h3>${svg(IC.card)}${esc(c.labels?.payment || 'Payment')}</h3>
            <div class="tgm-pay-total">
              <span class="tgm-pay-label">${esc(c.labels?.totalCost || 'Total holiday cost')}</span>
              <span class="tgm-pay-total-amt">${esc(fmtMoney(totalPrice, currency))}</span>
            </div>
            ${standardDep ? `
              <div class="tgm-pay-row">
                <span class="tgm-pay-label">${esc(c.labels?.depositPaid || 'Deposit paid')}</span>
                <span class="v paid">${esc(fmtMoney(standardDep.amount, currency))}</span>
              </div>
              ${standardDep.breakdown?.[0] ? `
              <div class="tgm-pay-row">
                <span class="tgm-pay-label">${esc(c.labels?.balanceDue || 'Balance due')}</span>
                <span class="v due">${esc(fmtMoney(standardDep.breakdown[0].amount, currency))}</span>
              </div>
              <div class="tgm-pay-row">
                <span class="tgm-pay-label">${esc(c.labels?.dueDate || 'Due date')}</span>
                <span class="v">${esc(fmtDate(standardDep.breakdown[0].dueDate))}</span>
              </div>
              ` : ''}
            ` : ''}
            ${installPlan ? `
              <div class="tgm-pay-sched">
                <div class="tgm-pay-sched-title">${esc(c.labels?.instalmentPlan || 'Instalment plan')} · ${installPlan.installments} ${esc(c.labels?.payments || 'payments')}</div>
                ${(installPlan.breakdown || []).map(b => `
                  <div class="tgm-inst">
                    <span class="date">${esc(fmtDate(b.dueDate))}</span>
                    <span class="amt">${esc(fmtMoney(b.amount, currency))}</span>
                  </div>
                `).join('')}
              </div>
            ` : ''}
          </div>

          <div class="tgm-section">
            <h3>${svg(IC.users)}${esc(c.labels?.travelling || "Who's travelling")}</h3>
            ${guests.length === 0 ? `
              <div class="tgm-guest">
                <div class="tgm-guest-av">${esc(initials(order.customerFirstname, order.customerSurname))}</div>
                <div class="tgm-guest-info">
                  <div class="tgm-guest-name">${esc((order.customerTitle ? order.customerTitle + ' ' : '') + (order.customerFirstname || '') + ' ' + (order.customerSurname || ''))}</div>
                  <div class="tgm-guest-meta">${esc(c.labels?.leadGuest || 'Lead guest')}</div>
                </div>
              </div>
            ` : guests.map((g, i) => `
              <div class="tgm-guest">
                <div class="tgm-guest-av">${esc(initials(g.firstname, g.surname))}</div>
                <div class="tgm-guest-info">
                  <div class="tgm-guest-name">${esc((g.title ? g.title + ' ' : '') + (g.firstname || '') + ' ' + (g.surname || ''))}</div>
                  <div class="tgm-guest-meta">${esc(i === 0 ? (c.labels?.leadGuest || 'Lead guest') : (g.type || 'Adult'))}${g.type ? ` · ${esc(g.type)}` : ''}</div>
                </div>
              </div>
            `).join('')}
            ${order.specialRequests ? `
              <div style="margin-top:16px; padding-top:16px; border-top:1px solid var(--tgm-border-light);">
                <div class="tgm-pay-sched-title">${esc(c.labels?.specialRequests || 'Special requests')}</div>
                <p style="font-size:13px; color:var(--tgm-text-2); margin:8px 0 0; font-style:italic;">"${esc(order.specialRequests)}"</p>
              </div>
            ` : ''}
          </div>
        </div>

        ${showDocs ? `
        <div class="tgm-section">
          <h3>${svg(IC.file)}${esc(c.labels?.documents || 'Your documents')}</h3>
          <div class="tgm-docs">
            ${docs.map(d => `
              <a class="tgm-doc" href="${esc(d.url)}" target="_blank" rel="noopener">
                <div class="tgm-doc-icon">${fileIconForExt(d.ext)}</div>
                <div class="tgm-doc-info">
                  <div class="tgm-doc-name">${esc(d.name)}</div>
                  <div class="tgm-doc-meta">${esc((d.ext || 'FILE').toUpperCase())}${d.size ? ' · ' + esc(fmtFileSize(d.size)) : ''}</div>
                </div>
                ${svg(IC.dl)}
              </a>
            `).join('')}
          </div>
        </div>
        ` : ''}

        <h3 class="tgm-h-eyebrow">${esc(c.labels?.thingsToKnow || 'Things to know')}</h3>

        ${hotelDesc?.text ? `
        <div class="tgm-collapse">
          <button class="tgm-collapse-trig" type="button" aria-expanded="false">
            <div class="tgm-collapse-left">${svg(IC.home)}${esc(c.labels?.aboutHotel || 'About the hotel')}</div>
            ${svg(IC.chev)}
          </button>
          <div class="tgm-collapse-body"><div class="tgm-collapse-inner">
            <p>${esc(hotelDesc.text.slice(0, 800))}${hotelDesc.text.length > 800 ? '…' : ''}</p>
            ${facilities.length ? `<div class="tgm-facilities">${facilities.map(f => `<span class="tgm-fac">${svg(IC.check)}${esc(f)}</span>`).join('')}</div>` : ''}
          </div></div>
        </div>` : ''}

        ${cancelDescs.length ? `
        <div class="tgm-collapse">
          <button class="tgm-collapse-trig" type="button" aria-expanded="false">
            <div class="tgm-collapse-left">${svg(IC.info)}${esc(c.labels?.cancellation || 'Cancellation policy')}</div>
            ${svg(IC.chev)}
          </button>
          <div class="tgm-collapse-body"><div class="tgm-collapse-inner">
            ${cancelDescs.map(d => `<p>${esc(d.text)}</p>`).join('')}
          </div></div>
        </div>` : ''}

        ${importantInfo.length || inResort ? `
        <div class="tgm-collapse">
          <button class="tgm-collapse-trig" type="button" aria-expanded="false">
            <div class="tgm-collapse-left">${svg(IC.coin)}${esc(c.labels?.localFees || 'Local fees')}</div>
            ${svg(IC.chev)}
          </button>
          <div class="tgm-collapse-body"><div class="tgm-collapse-inner">
            ${inResort ? `<p>A <strong>resort fee of ${esc(fmtMoney(inResort, currency))}</strong> is payable at the hotel on arrival.</p>` : ''}
            ${importantInfo.map(d => `<p>${esc(d.text)}</p>`).join('')}
          </div></div>
        </div>` : ''}

        ${(c.support?.email || c.support?.phone) ? `
        <div class="tgm-help">
          <div>
            <h3>${esc(c.labels?.helpTitle || 'Need a hand?')}</h3>
            <p>${esc(c.labels?.helpBody || "Our team's here if anything about your booking needs attention.")}</p>
          </div>
          <div class="tgm-help-actions">
            ${c.support?.email ? `<a class="tgm-help-btn" href="mailto:${esc(c.support.email)}">${svg(IC.mail)}${esc(c.labels?.emailUs || 'Email us')}</a>` : ''}
            ${c.support?.phone ? `<a class="tgm-help-btn" href="tel:${esc(c.support.phone.replace(/[^+0-9]/g, ''))}">${svg(IC.phone)}${esc(c.labels?.callUs || 'Call us')}</a>` : ''}
          </div>
        </div>` : ''}

        <div class="tgm-toast-stack" data-tgm-toast-stack></div>
      </div>
    `;
  }

  // ----- Widget class -----

  class TGMyBookingWidget {
    constructor(container, config) {
      this.el = container;
      this.c = this._defaults(config);
      this.shadow = container.attachShadow({ mode: 'open' });
      this.state = { stage: 'form', order: null, error: null };
      this.lookup = null; // cached { email, date, ref } for PDF re-lookup
      this._toastTimers = new Map();
      this._render();
    }

    _defaults(c) {
      const merged = Object.assign({
        layout: 'vertical', // vertical | horizontal | compact
        theme: 'light',
        title: 'My Booking',
        subtitle: 'Welcome back. Enter your details to view everything about your upcoming trip.',
        subtitleShort: 'Look up your trip in seconds',
        eyebrow: 'Secure booking lookup',
        labels: {},
        brand: { name: '' },
        colors: {},
        radius: 12,
        support: {},
        display: { showActions: true, showDocuments: true, showFacilities: true, showHotelDescription: true, showCancellation: true, showLocalFees: true },
        widgetId: c?.widgetId || null,
      }, c || {});
      // Make sure colors object is always complete
      merged.colors = Object.assign({
        primary: '#1B2B5B',
        accent:  '#00B4D8',
        success: '#10B981',
        warning: '#F59E0B',
        text:    '#0F172A',
      }, merged.colors || {});
      if (typeof merged.radius !== 'number') merged.radius = 12;
      return merged;
    }

    _buildOverrides() {
      const c = this.c.colors || {};
      // Derive light/dark variants of primary for hover and gradient
      const lighten = (hex, amt) => this._shiftHex(hex, amt);
      const primary = c.primary || '#1B2B5B';
      const accent = c.accent || '#00B4D8';
      // Note: don't use `|| 12` — that would treat 0 (Sharp) as falsy and
      // substitute 12. Default only when the value is missing or NaN.
      const parsed = parseInt(this.c.radius, 10);
      const radius = Math.max(0, Math.min(28, Number.isFinite(parsed) ? parsed : 12));
      const overrides = {
        '--tgm-primary': primary,
        '--tgm-primary-light': lighten(primary, 18),
        '--tgm-primary-dark': lighten(primary, -18),
        '--tgm-accent': accent,
        '--tgm-accent-light': lighten(accent, 16),
        '--tgm-accent-dark': lighten(accent, -16),
        '--tgm-success': c.success || '#10B981',
        '--tgm-warning': c.warning || '#F59E0B',
        '--tgm-text': c.text || '#0F172A',
        // Radius scale derived from a single base value
        '--tgm-radius-sm': Math.round(radius * 0.5) + 'px',
        '--tgm-radius-md': Math.round(radius * 0.66) + 'px',
        '--tgm-radius-lg': radius + 'px',
        '--tgm-radius-xl': Math.round(radius * 1.33) + 'px',
        '--tgm-radius-2xl': Math.round(radius * 1.66) + 'px',
      };
      return Object.entries(overrides)
        .map(([k, v]) => k + ':' + v + ';')
        .join('');
    }

    _shiftHex(hex, percent) {
      // Lighten if percent > 0, darken if < 0. Clamps to [0, 255].
      const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
      if (!m) return hex;
      const n = parseInt(m[1], 16);
      const r = (n >> 16) & 0xff;
      const g = (n >> 8) & 0xff;
      const b = n & 0xff;
      const adjust = (c) => {
        const target = percent >= 0 ? 255 : 0;
        const ratio = Math.abs(percent) / 100;
        return Math.round(c + (target - c) * ratio);
      };
      const out = (adjust(r) << 16) | (adjust(g) << 8) | adjust(b);
      return '#' + out.toString(16).padStart(6, '0');
    }

    _render() {
      const themeAttr = this.c.theme === 'dark' ? ' data-theme="dark"' : '';
      const overrides = this._buildOverrides();
      let inner;
      if (this.state.stage === 'loading') inner = renderLoading(this.c);
      else if (this.state.stage === 'found') inner = renderFound(this.state.order, this.c);
      else if (this.state.stage === 'notfound') inner = renderNotFound(this.c);
      else inner = renderForm(this.c, this.state);

      this.shadow.innerHTML = '<style>' + STYLES + '</style><div class="tgm-root"' + themeAttr + ' style="' + overrides + '">' + inner + '</div>';
      this._bind();
    }

    _bind() {
      const root = this.shadow.querySelector('.tgm-root');
      if (!root) return;

      // Form submit
      const form = root.querySelector('[data-tgm-form]');
      if (form) {
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          this._submit(form);
        });
      }

      // Try-again button
      const tryAgain = root.querySelector('[data-tgm-tryagain]');
      if (tryAgain) tryAgain.addEventListener('click', () => {
        this.state = { stage: 'form', order: null, error: null };
        this._render();
      });

      // Hero thumbs
      const heroImg = root.querySelector('[data-tgm-hero-img]');
      root.querySelectorAll('[data-tgm-thumb]').forEach(btn => {
        btn.addEventListener('click', () => {
          root.querySelectorAll('[data-tgm-thumb]').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          if (heroImg) heroImg.style.backgroundImage = "url('" + btn.dataset.img + "')";
        });
      });

      // Collapsibles
      root.querySelectorAll('.tgm-collapse-trig').forEach(t => {
        t.addEventListener('click', () => {
          const wrap = t.parentElement;
          const isOpen = wrap.classList.toggle('open');
          t.setAttribute('aria-expanded', isOpen);
        });
      });

      // PDF download button
      const pdfBtn = root.querySelector('[data-tgm-pdf-action]');
      if (pdfBtn) pdfBtn.addEventListener('click', () => this._downloadPdf(pdfBtn));
    }

    async _submit(form) {
      const data = new FormData(form);
      const email = (data.get('email') || '').toString().trim();
      const date = (data.get('date') || '').toString().trim();
      const ref = (data.get('ref') || '').toString().trim();

      // Client-side validation
      if (!email || !date || !ref) {
        this.state.error = 'Please fill in all three fields.';
        this._render();
        return;
      }
      if (!this.c.widgetId) {
        this.state.error = 'This widget is not configured yet. Please contact support.';
        this._render();
        return;
      }

      this.state = { stage: 'loading', order: null, error: null };
      this._render();

      try {
        const res = await fetch(API_RETRIEVE, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            widgetId: this.c.widgetId,
            emailAddress: email,
            departDate: date,
            orderRef: ref,
          }),
        });

        if (res.status === 429) {
          this.state = { stage: 'form', order: null, error: 'Too many attempts. Please wait a few minutes and try again.' };
          this._render();
          return;
        }
        if (res.status === 404) {
          this.state = { stage: 'notfound', order: null, error: null };
          this._render();
          return;
        }
        if (!res.ok) {
          this.state = { stage: 'notfound', order: null, error: null };
          this._render();
          return;
        }

        const data = await res.json();
        if (!data.order) {
          this.state = { stage: 'notfound', order: null, error: null };
          this._render();
          return;
        }

        // Cache lookup credentials so we can call /booking-pdf later
        this.lookup = { email, date, ref };

        this.state = { stage: 'found', order: data.order, error: null };
        this._render();
        this._fireEvent('booking-loaded', { order: data.order });
      } catch (err) {
        this.state = { stage: 'form', order: null, error: 'Something went wrong. Please try again in a moment.' };
        this._render();
      }
    }

    async _downloadPdf(btn) {
      if (!this.lookup || !this.c.widgetId) {
        this._showToast('error', 'Cannot generate PDF', 'Please look up your booking again.');
        return;
      }
      if (btn.disabled) return;

      // Spinner on button
      btn.disabled = true;
      btn.classList.add('is-loading');

      // Loading toast
      const loadingToastId = this._showToast('loading', 'Generating your PDF', 'This usually takes a few seconds.');

      try {
        const res = await fetch(API_PDF, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            widgetId: this.c.widgetId,
            emailAddress: this.lookup.email,
            departDate: this.lookup.date,
            orderRef: this.lookup.ref,
          }),
        });

        if (!res.ok) {
          this._dismissToast(loadingToastId);
          if (res.status === 429) {
            this._showToast('error', 'Too many requests', 'Please wait a few minutes and try again.', 6000);
          } else if (res.status === 404) {
            this._showToast('error', "We couldn't generate that PDF", 'Please look up your booking again.', 6000);
          } else {
            this._showToast('error', 'Something went wrong', 'Please try again in a moment.', 6000);
          }
          return;
        }

        const blob = await res.blob();

        // Trigger download
        const item = this.state.order?.items?.[0];
        const refValue = item?.bookingReference || ('TG' + (this.state.order?.id || ''));
        const filename = 'booking-' + String(refValue).replace(/[^A-Z0-9_\-]/gi, '') + '.pdf';

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        // Revoke after a tick so the browser has time to start the download
        setTimeout(() => URL.revokeObjectURL(url), 1000);

        this._dismissToast(loadingToastId);
        this._showToast('success', 'PDF downloaded', filename, 4000);
        this._fireEvent('pdf-downloaded', { filename });
      } catch (err) {
        this._dismissToast(loadingToastId);
        this._showToast('error', 'Download failed', 'Please check your connection and try again.', 6000);
      } finally {
        btn.disabled = false;
        btn.classList.remove('is-loading');
      }
    }

    // ----- Toast helpers -----

    _showToast(type, title, sub, autoDismissMs) {
      const stack = this.shadow.querySelector('[data-tgm-toast-stack]');
      if (!stack) return null;

      const id = 'toast-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
      const iconPath = type === 'success' ? IC.check : (type === 'error' ? IC.alert : '');
      const node = document.createElement('div');
      node.className = 'tgm-toast is-' + type;
      node.setAttribute('data-toast-id', id);
      node.setAttribute('role', type === 'error' ? 'alert' : 'status');
      node.innerHTML = `
        <div class="tgm-toast-icon">${iconPath ? svg(iconPath, 2.5) : ''}</div>
        <div class="tgm-toast-content">
          <div class="tgm-toast-title">${esc(title)}</div>
          ${sub ? `<div class="tgm-toast-sub">${esc(sub)}</div>` : ''}
        </div>
      `;
      stack.appendChild(node);

      if (autoDismissMs && autoDismissMs > 0) {
        const timer = setTimeout(() => this._dismissToast(id), autoDismissMs);
        this._toastTimers.set(id, timer);
      }

      return id;
    }

    _dismissToast(id) {
      if (!id) return;
      const timer = this._toastTimers.get(id);
      if (timer) {
        clearTimeout(timer);
        this._toastTimers.delete(id);
      }
      const stack = this.shadow.querySelector('[data-tgm-toast-stack]');
      if (!stack) return;
      const node = stack.querySelector('[data-toast-id="' + id + '"]');
      if (!node) return;
      node.classList.add('is-leaving');
      setTimeout(() => { try { node.remove(); } catch {} }, 250);
    }

    _fireEvent(name, detail) {
      try {
        this.el.dispatchEvent(new CustomEvent('tg-mybooking:' + name, { detail, bubbles: true }));
      } catch {}
    }

    update(newConfig) {
      this.c = this._defaults(Object.assign({}, this.c, newConfig));
      this._render();
    }

    destroy() {
      try {
        for (const t of this._toastTimers.values()) clearTimeout(t);
        this._toastTimers.clear();
        this.shadow.innerHTML = '';
      } catch {}
    }
  }

  // ----- Auto init -----
  async function loadConfig(widgetId) {
    const url = API_CONFIG + '?id=' + encodeURIComponent(widgetId);
    const res = await fetch(url);
    if (!res.ok) throw new Error('Config load failed');
    const data = await res.json();
    const config = data.config || {};
    config.widgetId = widgetId;
    return config;
  }

  async function init() {
    const containers = document.querySelectorAll('[data-tg-widget="mybooking"]');
    for (const el of containers) {
      if (el.__tgmInitialised) continue;
      el.__tgmInitialised = true;
      try {
        const inlineConfig = el.getAttribute('data-tg-config');
        const widgetId = el.getAttribute('data-tg-id');
        let config;
        if (inlineConfig) {
          try {
            config = JSON.parse(inlineConfig);
            if (widgetId && !config.widgetId) config.widgetId = widgetId;
          } catch {
            config = {};
          }
        } else if (widgetId) {
          config = await loadConfig(widgetId);
        } else {
          config = {};
        }
        new TGMyBookingWidget(el, config);
      } catch (err) {
        console.warn('[TG My Booking] init failed:', err.message);
      }
    }
  }

  window.TGMyBookingWidget = TGMyBookingWidget;
  window.__TG_MYBOOKING_VERSION__ = VERSION;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
