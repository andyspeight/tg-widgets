/**
 * Travelgenix My Booking Widget v1.2.0
 * Self-contained, embeddable widget for retrieving and displaying confirmed bookings
 * Zero dependencies — works on any website via a single script tag
 *
 * v1.2.0 changes:
 *   - Two-button PDF action: 'Preview' opens an inline viewer; 'Download' saves the file
 *   - Inline PDF viewer rendered in an iframe below the action row (~840px tall)
 *   - Single fetch shared between preview and download (blob cached on instance)
 *   - Preview button toggles the viewer open/closed
 *
 * v1.1.0 changes:
 *   - PDF download wired to /api/booking-pdf (Puppeteer-rendered A4 pack)
 *   - Email action hidden (Phase 2)
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
  function deriveApiBase() {
    if (typeof window === 'undefined') return '';
    if (typeof window.__TG_WIDGET_API_BASE__ === 'string' && window.__TG_WIDGET_API_BASE__) {
      return window.__TG_WIDGET_API_BASE__.replace(/\/$/, '');
    }
    try {
      var s = document.currentScript;
      if (!s) {
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

  const API_CONFIG = (typeof window !== 'undefined' && window.__TG_WIDGET_API__) || (API_BASE + '/api/widget-config');
  const API_RETRIEVE = (typeof window !== 'undefined' && window.__TG_RETRIEVE_API__) || (API_BASE + '/api/retrieve-order');
  const API_PDF = (typeof window !== 'undefined' && window.__TG_PDF_API__) || (API_BASE + '/api/booking-pdf');
  const VERSION = '1.2.0';

  // ----- Inline SVG icons -----
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
    plane:   'M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z',
    bag:     'M16 3h-1V1h-2v2H7V1H5v2H4a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zM4 8h12v12H4V8z',
    bed:     'M2 20v-8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v8M4 10V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4M12 4v6M2 18h20',
    lounge:  'M19 7v3.5a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 5 10.5V7M3 21V11a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10M3 17h18',
    arrowR:  'M5 12h14M13 5l7 7-7 7',
    leaf:    'M11 20A7 7 0 0 1 4 13c0-2 1-4 3-6 1-1 2-3 4-5l1 4c2-1 4 1 5 3 1 3 0 5-1 6-2 2-4 5-5 5z',
    eye:     'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    x:       'M18 6L6 18M6 6l12 12',
  };
  function svg(p, sw, size) {
    sw = sw || 2;
    const s = size || 20;
    return '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" fill="none" stroke="currentColor" stroke-width="' + sw + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p.split(/(?=M)/).map(d => '<path d="' + d + '"/>').join('') + '</svg>';
  }
  function star() {
    return '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><polygon points="12 2 15 9 22 9.3 17 14 18.5 21 12 17.5 5.5 21 7 14 2 9.3 9 9 12 2"/></svg>';
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
  function fmtTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    return hh + ':' + mm;
  }
  function fmtDuration(mins) {
    if (typeof mins !== 'number' || !Number.isFinite(mins) || mins <= 0) return '';
    const h = Math.floor(mins / 60);
    const m = Math.round(mins % 60);
    if (h && m) return h + 'h ' + m + 'm';
    if (h) return h + 'h';
    return m + 'm';
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

  // ----- Styles -----
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
    .tgm-review-chip { display: inline-flex; align-items: center; gap: 6px; margin-left: 12px; padding: 3px 10px; background: rgba(255,255,255,.18); border: 1px solid rgba(255,255,255,.25); border-radius: 9999px; font-size: 12px; font-weight: 500; color: #fff; backdrop-filter: blur(4px); }
    .tgm-review-chip strong { font-weight: 700; font-variant-numeric: tabular-nums; }
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

    /* ===== PDF action row — two buttons (Preview + Download) ===== */
    .tgm-action-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px; }
    @media (max-width: 560px) { .tgm-action-row { grid-template-columns: 1fr; } }
    .tgm-action { display: flex; align-items: center; gap: 16px; padding: 18px 24px; background: var(--tgm-bg); border: 1px solid var(--tgm-border); border-radius: var(--tgm-radius-lg); cursor: pointer; text-align: left; font-family: inherit; transition: all .25s cubic-bezier(.2,.7,.2,1); width: 100%; position: relative; }
    .tgm-action:hover:not(:disabled) { border-color: var(--tgm-accent); transform: translateY(-1px); box-shadow: 0 4px 6px rgba(0,0,0,.06), 0 2px 4px rgba(0,0,0,.04); }
    .tgm-action:disabled { cursor: wait; opacity: .85; }
    .tgm-action.is-active { border-color: var(--tgm-accent); background: var(--tgm-bg-2); }
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

    /* Inline PDF viewer panel */
    .tgm-pdf-viewer { background: var(--tgm-bg); border: 1px solid var(--tgm-border); border-radius: var(--tgm-radius-lg); overflow: hidden; margin-bottom: 16px; box-shadow: 0 4px 6px rgba(0,0,0,.04), 0 2px 4px rgba(0,0,0,.02); animation: tgm-fadeup .3s cubic-bezier(.2,.7,.2,1); }
    .tgm-pdf-viewer-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px; background: var(--tgm-bg-2); border-bottom: 1px solid var(--tgm-border); }
    .tgm-pdf-viewer-title { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--tgm-text); letter-spacing: -.01em; }
    .tgm-pdf-viewer-title svg { width: 16px; height: 16px; color: var(--tgm-accent); }
    .tgm-pdf-viewer-actions { display: flex; gap: 8px; align-items: center; }
    .tgm-pdf-viewer-btn { height: 32px; padding: 0 12px; font-family: inherit; font-size: 13px; font-weight: 500; color: var(--tgm-text-2); background: transparent; border: 1px solid var(--tgm-border); border-radius: var(--tgm-radius-sm); cursor: pointer; display: inline-flex; align-items: center; gap: 6px; transition: all .15s; }
    .tgm-pdf-viewer-btn:hover { border-color: var(--tgm-accent); color: var(--tgm-text); }
    .tgm-pdf-viewer-btn svg { width: 14px; height: 14px; }
    .tgm-pdf-viewer-frame { width: 100%; height: 840px; border: none; display: block; background: var(--tgm-bg-3); }
    @media (max-width: 480px) { .tgm-pdf-viewer-frame { height: 600px; } }
    /* Mobile fallback — iOS Safari can't render <iframe src="blob:..."> for PDFs.
       We swap to a download-only state with a clear call to action. */
    .tgm-pdf-viewer-fallback { padding: 32px 24px; text-align: center; }
    .tgm-pdf-viewer-fallback p { font-size: 14px; color: var(--tgm-text-2); margin: 0 0 16px; line-height: 1.5; }

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
    .tgm-stay h3 { display: flex; align-items: center; gap: 8px; font-size: 16px; font-weight: 600; margin: 0 0 16px; color: var(--tgm-text); letter-spacing: -.01em; }
    .tgm-stay h3 svg { color: var(--tgm-accent); }
    .tgm-stay h3 .tgm-stay-meta { margin-left: auto; font-size: 13px; font-weight: 400; color: var(--tgm-text-3); }
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

    .tgm-subhead { font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--tgm-text-3); margin: 16px 0 8px; }
    .tgm-subhead:first-child { margin-top: 0; }
    .tgm-kv { display: grid; grid-template-columns: minmax(120px, 30%) 1fr; gap: 8px 16px; font-size: 14px; }
    .tgm-kv dt { color: var(--tgm-text-3); font-weight: 500; }
    .tgm-kv dd { color: var(--tgm-text); margin: 0; font-variant-numeric: tabular-nums; }
    .tgm-fee-line { display: flex; justify-content: space-between; align-items: baseline; padding: 6px 0; font-size: 14px; }
    .tgm-fee-line + .tgm-fee-line { border-top: 1px dashed var(--tgm-border-light); }
    .tgm-fee-line .name { color: var(--tgm-text-2); }
    .tgm-fee-line .name small { color: var(--tgm-text-3); display: block; font-size: 12px; margin-top: 2px; }
    .tgm-fee-line .val { font-weight: 600; color: var(--tgm-text); font-variant-numeric: tabular-nums; }
    .tgm-chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px; }
    .tgm-chip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; background: var(--tgm-bg-2); border: 1px solid var(--tgm-border-light); border-radius: 9999px; font-size: 13px; color: var(--tgm-text-2); }
    .tgm-chip svg { width: 13px; height: 13px; color: var(--tgm-text-3); }
    .tgm-pay-breakdown { padding: 12px 0; border-top: 1px dashed var(--tgm-border-light); margin-top: 8px; }
    .tgm-pay-breakdown .tgm-fee-line:first-child { padding-top: 0; }
    .tgm-pay-breakdown .tgm-fee-line:first-child + .tgm-fee-line { border-top: 1px dashed var(--tgm-border-light); }

    .tgm-flight-card { background: var(--tgm-bg); border: 1px solid var(--tgm-border); border-radius: var(--tgm-radius-lg); padding: 20px; margin-bottom: 16px; }
    .tgm-flight-card h3 { display: flex; align-items: center; gap: 8px; font-size: 16px; font-weight: 600; margin: 0 0 16px; color: var(--tgm-text); letter-spacing: -.01em; }
    .tgm-flight-card h3 svg { color: var(--tgm-accent); }
    .tgm-flight-card h3 .tgm-flight-meta { margin-left: auto; font-size: 13px; font-weight: 400; color: var(--tgm-text-3); }
    .tgm-leg { padding: 16px 0; border-top: 1px solid var(--tgm-border-light); }
    .tgm-leg:first-of-type { border-top: none; padding-top: 0; }
    .tgm-leg-dir { display: inline-flex; align-items: center; gap: 6px; padding: 2px 10px; background: var(--tgm-bg-2); border-radius: 9999px; font-size: 11px; font-weight: 500; letter-spacing: .06em; text-transform: uppercase; color: var(--tgm-text-2); margin-bottom: 12px; }
    .tgm-leg-route { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 16px; }
    .tgm-leg-end { min-width: 0; }
    .tgm-leg-end.dest { text-align: right; }
    .tgm-leg-time { font-size: 22px; font-weight: 700; color: var(--tgm-text); letter-spacing: -.02em; font-variant-numeric: tabular-nums; line-height: 1.2; }
    .tgm-leg-iata { font-size: 13px; font-weight: 600; color: var(--tgm-text-2); margin-top: 2px; letter-spacing: .04em; }
    .tgm-leg-airport { font-size: 13px; color: var(--tgm-text-3); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tgm-leg-line { display: flex; flex-direction: column; align-items: center; min-width: 100px; }
    .tgm-leg-line-dur { font-size: 11px; color: var(--tgm-text-3); margin-bottom: 4px; font-variant-numeric: tabular-nums; }
    .tgm-leg-line-bar { width: 100%; height: 2px; background: var(--tgm-border); position: relative; display: flex; align-items: center; justify-content: center; }
    .tgm-leg-line-bar::before, .tgm-leg-line-bar::after { content: ''; width: 6px; height: 6px; border-radius: 50%; background: var(--tgm-accent); position: absolute; top: 50%; transform: translateY(-50%); }
    .tgm-leg-line-bar::before { left: 0; }
    .tgm-leg-line-bar::after { right: 0; }
    .tgm-leg-line-icon { background: var(--tgm-bg); padding: 0 6px; color: var(--tgm-accent); position: relative; z-index: 1; }
    .tgm-leg-stops { font-size: 11px; color: var(--tgm-text-3); margin-top: 4px; font-variant-numeric: tabular-nums; }
    .tgm-leg-meta { display: flex; flex-wrap: wrap; gap: 16px; margin-top: 12px; padding-top: 12px; border-top: 1px dashed var(--tgm-border-light); font-size: 13px; color: var(--tgm-text-2); }
    .tgm-leg-meta-item { display: inline-flex; align-items: center; gap: 6px; }
    .tgm-leg-meta-item svg { color: var(--tgm-text-3); }
    .tgm-leg-meta-item strong { color: var(--tgm-text); font-weight: 600; }

    .tgm-segs { padding-top: 12px; margin-top: 12px; border-top: 1px solid var(--tgm-border-light); }
    .tgm-seg { display: grid; grid-template-columns: 60px 1fr 60px; gap: 12px; padding: 10px 0; align-items: center; font-size: 13px; }
    .tgm-seg + .tgm-seg { border-top: 1px dashed var(--tgm-border-light); }
    .tgm-seg-time { font-variant-numeric: tabular-nums; font-weight: 600; color: var(--tgm-text); }
    .tgm-seg-iata { font-size: 11px; color: var(--tgm-text-3); }
    .tgm-seg-route { color: var(--tgm-text-2); }
    .tgm-seg-route strong { color: var(--tgm-text); font-weight: 600; }
    .tgm-seg-flight { font-size: 11px; color: var(--tgm-text-3); margin-top: 2px; }
    .tgm-stop-marker { padding: 8px 0 8px 12px; font-size: 12px; color: var(--tgm-text-3); border-left: 2px solid var(--tgm-border); margin-left: 26px; font-style: italic; }

    @media (max-width: 480px) {
      .tgm-leg-route { grid-template-columns: 1fr; gap: 12px; }
      .tgm-leg-end.dest { text-align: left; }
      .tgm-leg-line { transform: rotate(90deg); height: 24px; min-width: 0; width: 24px; align-self: center; }
    }

    .tgm-extra-card { background: var(--tgm-bg); border: 1px solid var(--tgm-border); border-radius: var(--tgm-radius-lg); padding: 20px; margin-bottom: 16px; }
    .tgm-extra-head { display: flex; align-items: flex-start; gap: 16px; }
    .tgm-extra-icon { width: 44px; height: 44px; border-radius: var(--tgm-radius-md); background: var(--tgm-bg-2); display: flex; align-items: center; justify-content: center; color: var(--tgm-primary); flex-shrink: 0; }
    .tgm-extra-info { flex: 1; min-width: 0; }
    .tgm-extra-kind { font-size: 11px; font-weight: 500; letter-spacing: .06em; text-transform: uppercase; color: var(--tgm-text-3); }
    .tgm-extra-name { font-size: 18px; font-weight: 600; color: var(--tgm-text); margin: 2px 0 4px; letter-spacing: -.01em; }
    .tgm-extra-sub { font-size: 13px; color: var(--tgm-text-2); }
    .tgm-extra-meta { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--tgm-border-light); font-size: 13px; color: var(--tgm-text-2); }
    .tgm-extra-meta-item { display: inline-flex; align-items: center; gap: 6px; }
    .tgm-extra-meta-item strong { color: var(--tgm-text); font-weight: 600; }

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

  function renderFlightCard(item, c) {
    const f = item.flights;
    if (!f || !Array.isArray(f.routes) || f.routes.length === 0) return '';

    const carrierNames = new Set();
    for (const r of f.routes) {
      for (const s of r.segments || []) {
        if (s.marketingCarrier?.name) carrierNames.add(s.marketingCarrier.name);
      }
    }
    const carrierSummary = Array.from(carrierNames).slice(0, 3).join(', ');

    const fareInfo = Array.isArray(f.fareInformation) ? f.fareInformation : [];
    const meaningfulFareInfo = fareInfo.filter(fi => {
      if (!fi.title || !fi.text) return false;
      if ((fi.type || '').toLowerCase() === 'farebasis') return false;
      if (/fare\s*basis/i.test(fi.title)) return false;
      return true;
    });

    return `
      <div class="tgm-flight-card">
        <h3>${svg(IC.plane)}${esc(c.labels?.flights || 'Flights')}${
          carrierSummary
            ? `<span class="tgm-flight-meta">${esc(carrierSummary)}</span>`
            : ''
        }</h3>
        ${f.routes.map(route => renderFlightLeg(route)).join('')}
        ${meaningfulFareInfo.length ? `
          <div class="tgm-collapse" style="margin-top:16px; margin-bottom:0;">
            <button class="tgm-collapse-trig" type="button" aria-expanded="false">
              <div class="tgm-collapse-left">${svg(IC.info)}${esc(c.labels?.fareConditions || 'Fare conditions')}</div>
              ${svg(IC.chev)}
            </button>
            <div class="tgm-collapse-body"><div class="tgm-collapse-inner">
              <dl class="tgm-kv">
                ${meaningfulFareInfo.map(fi => `
                  <dt>${esc(fi.title)}</dt>
                  <dd>${esc(fi.text)}</dd>
                `).join('')}
              </dl>
            </div></div>
          </div>
        ` : ''}
      </div>
    `;
  }

  function renderFlightLeg(route) {
    const segs = route.segments || [];
    if (segs.length === 0) return '';

    const first = segs[0];
    const last = segs[segs.length - 1];
    const stops = segs.length - 1;

    const baggage = first.baggage?.allowance || first.baggage?.weight || '';
    const cabin = first.cabinClass || '';
    const fareName = first.fareName || '';

    const flightMins = segs.reduce((acc, s) => acc + (typeof s.duration === 'number' ? s.duration : 0), 0);

    return `
      <div class="tgm-leg">
        <div class="tgm-leg-dir">${esc(route.direction || 'Flight')}</div>
        <div class="tgm-leg-route">
          <div class="tgm-leg-end">
            <div class="tgm-leg-time">${esc(fmtTime(first.depart))}</div>
            <div class="tgm-leg-iata">${esc(first.origin?.iataCode || '')}${first.origin?.terminal ? ` · T${esc(first.origin.terminal)}` : ''}</div>
            <div class="tgm-leg-airport" title="${esc(first.origin?.name || '')}">${esc(first.origin?.name || '')}</div>
          </div>
          <div class="tgm-leg-line">
            <div class="tgm-leg-line-dur">${esc(fmtDuration(flightMins))}</div>
            <div class="tgm-leg-line-bar"><span class="tgm-leg-line-icon">${svg(IC.plane, 2, 14)}</span></div>
            <div class="tgm-leg-stops">${stops === 0 ? 'Direct' : `${stops} ${stops === 1 ? 'stop' : 'stops'}`}</div>
          </div>
          <div class="tgm-leg-end dest">
            <div class="tgm-leg-time">${esc(fmtTime(last.arrive))}</div>
            <div class="tgm-leg-iata">${esc(last.destination?.iataCode || '')}${last.destination?.terminal ? ` · T${esc(last.destination.terminal)}` : ''}</div>
            <div class="tgm-leg-airport" title="${esc(last.destination?.name || '')}">${esc(last.destination?.name || '')}</div>
          </div>
        </div>
        <div class="tgm-leg-meta">
          ${cabin ? `<span class="tgm-leg-meta-item">${svg(IC.user, 2, 14)}<span><strong>${esc(cabin)}</strong>${fareName ? ` · ${esc(fareName)}` : ''}</span></span>` : ''}
          ${baggage ? `<span class="tgm-leg-meta-item">${svg(IC.bag, 2, 14)}<span>${esc(baggage)}</span></span>` : ''}
        </div>
        ${stops > 0 ? renderSegmentDetail(segs) : ''}
      </div>
    `;
  }

  function renderSegmentDetail(segs) {
    let html = '<div class="tgm-segs">';
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      html += `
        <div class="tgm-seg">
          <div>
            <div class="tgm-seg-time">${esc(fmtTime(s.depart))}</div>
            <div class="tgm-seg-iata">${esc(s.origin?.iataCode || '')}</div>
          </div>
          <div class="tgm-seg-route">
            <strong>${esc(s.marketingCarrier?.code || '')}${esc(s.flightNo || '')}</strong>
            ${s.marketingCarrier?.name ? ` · ${esc(s.marketingCarrier.name)}` : ''}
            <div class="tgm-seg-flight">${esc(fmtDuration(s.duration))}${s.aircraft ? ` · Aircraft ${esc(s.aircraft)}` : ''}</div>
          </div>
          <div style="text-align:right">
            <div class="tgm-seg-time">${esc(fmtTime(s.arrive))}</div>
            <div class="tgm-seg-iata">${esc(s.destination?.iataCode || '')}</div>
          </div>
        </div>
      `;
      if (i < segs.length - 1) {
        const nextDep = Date.parse(segs[i + 1].depart || '');
        const thisArr = Date.parse(s.arrive || '');
        const gapMin = (Number.isFinite(nextDep) && Number.isFinite(thisArr))
          ? Math.round((nextDep - thisArr) / 60000)
          : 0;
        html += `
          <div class="tgm-stop-marker">
            ${gapMin > 0 ? `${esc(fmtDuration(gapMin))} stopover in ${esc(s.destination?.iataCode || '')}` : `Stopover in ${esc(s.destination?.iataCode || '')}`}
          </div>
        `;
      }
    }
    html += '</div>';
    return html;
  }

  function renderExtraCard(item, c) {
    const e = item.airportExtras;
    if (!e) return '';

    const kindLabel = e.type === 'Lounge' ? 'Airport lounge'
      : e.type === 'Transfer' ? 'Airport transfer'
      : e.type === 'Parking' ? 'Airport parking'
      : (e.type || 'Airport extra');

    const icon = e.type === 'Lounge' ? IC.lounge
      : e.type === 'Transfer' ? IC.plane
      : IC.bag;

    const airport = e.location?.iataCode || '';
    const terminal = e.location?.terminal ? `T${e.location.terminal}` : '';
    const startTime = fmtTime(e.startDateTime);
    const endTime = fmtTime(e.endDateTime);
    const dateLabel = e.startDateTime ? fmtDate(e.startDateTime, { day: 'numeric', month: 'short', year: 'numeric' }) : '';

    const descByType = (type) => (e.descriptions || []).find(d => d.type === type);
    const descByTitle = (title) => (e.descriptions || []).find(d => d.title === title);
    const fullDesc = descByType('Generic')?.text || descByTitle('Description')?.text || '';
    const openingTimes = descByType('OpeningTimes')?.text || descByTitle('Opening times')?.text || '';
    const dressCode = descByType('DressCode')?.text || descByTitle('Dress code')?.text || '';
    const drinks = (e.descriptions || []).find(d => /drinks?/i.test(d.title || ''))?.text || '';
    const food = (e.descriptions || []).find(d => /food|dining|cuisine/i.test(d.title || ''))?.text || '';
    const announcements = (e.descriptions || []).find(d => /announcement/i.test(d.title || ''))?.text || '';

    const featureLabels = {
      FreeDrinks: 'Drinks included',
      FreeFood: 'Food included',
      WiFi: 'Wi-fi',
      TV: 'TV',
      ChildrenAllowed: 'Children welcome',
      Newspapers: 'Newspapers',
      Showers: 'Showers',
      QuietZone: 'Quiet zone',
      Workspace: 'Workspace',
    };
    const features = (e.features || []).map(f => featureLabels[f] || f);

    const hasDetails = fullDesc || openingTimes || dressCode || drinks || food || announcements || features.length;

    return `
      <div class="tgm-extra-card">
        <div class="tgm-extra-head">
          <div class="tgm-extra-icon">${svg(icon, 2, 22)}</div>
          <div class="tgm-extra-info">
            <div class="tgm-extra-kind">${esc(kindLabel)}</div>
            <div class="tgm-extra-name">${esc(e.name || 'Airport extra')}</div>
            ${e.subTitle ? `<div class="tgm-extra-sub">${esc(e.subTitle)}</div>` : ''}
          </div>
        </div>
        <div class="tgm-extra-meta">
          ${airport ? `<span class="tgm-extra-meta-item">${svg(IC.pin, 2, 14)}<span><strong>${esc(airport)}</strong>${terminal ? ` · ${esc(terminal)}` : ''}</span></span>` : ''}
          ${dateLabel ? `<span class="tgm-extra-meta-item">${svg(IC.cal, 2, 14)}<span>${esc(dateLabel)}</span></span>` : ''}
          ${startTime ? `<span class="tgm-extra-meta-item">${svg(IC.clock, 2, 14)}<span>${esc(startTime)}${endTime ? ` – ${esc(endTime)}` : ''}</span></span>` : ''}
        </div>
        ${hasDetails ? `
          <div class="tgm-collapse" style="margin-top:16px; margin-bottom:0;">
            <button class="tgm-collapse-trig" type="button" aria-expanded="false">
              <div class="tgm-collapse-left">${svg(IC.info)}${esc(c.labels?.whatToExpect || 'What to expect')}</div>
              ${svg(IC.chev)}
            </button>
            <div class="tgm-collapse-body"><div class="tgm-collapse-inner">
              ${fullDesc ? `<p>${esc(fullDesc.slice(0, 800))}${fullDesc.length > 800 ? '…' : ''}</p>` : ''}

              ${(openingTimes || dressCode) ? `
                <div class="tgm-subhead">${esc(c.labels?.atAGlance || 'At a glance')}</div>
                <dl class="tgm-kv">
                  ${openingTimes ? `<dt>${esc(c.labels?.openingTimes || 'Opening times')}</dt><dd>${esc(openingTimes)}</dd>` : ''}
                  ${dressCode ? `<dt>${esc(c.labels?.dressCode || 'Dress code')}</dt><dd>${esc(dressCode)}</dd>` : ''}
                </dl>
              ` : ''}

              ${(drinks || food) ? `
                <div class="tgm-subhead">${esc(c.labels?.included || 'Included')}</div>
                ${drinks ? `<p><strong>${esc(c.labels?.drinks || 'Drinks')}:</strong> ${esc(drinks)}</p>` : ''}
                ${food ? `<p><strong>${esc(c.labels?.food || 'Food')}:</strong> ${esc(food)}</p>` : ''}
              ` : ''}

              ${announcements ? `
                <div class="tgm-subhead">${esc(c.labels?.flightAnnouncements || 'Flight announcements')}</div>
                <p>${esc(announcements)}</p>
              ` : ''}

              ${features.length ? `
                <div class="tgm-subhead">${esc(c.labels?.features || 'Features')}</div>
                <div class="tgm-chips">${features.map(f => `<span class="tgm-chip">${svg(IC.check)}${esc(f)}</span>`).join('')}</div>
              ` : ''}
            </div></div>
          </div>
        ` : ''}
      </div>
    `;
  }

  function renderFound(order, c) {
    const items = order.items || [];
    const summary = order.summary || {};

    const accItem = items.find(i => i.product === 'Accommodation') || null;
    const flightItems = items.filter(i => i.product === 'Flights');
    const extraItems = items.filter(i => i.product === 'AirportExtras');

    const acc = accItem?.accommodation;
    const checkin = accItem?.startDate;
    const nights = accItem?.duration || 0;
    const checkoutMs = checkin ? new Date(checkin).getTime() + nights * 86400000 : null;
    const checkout = checkoutMs ? new Date(checkoutMs).toISOString() : null;

    const tripStart = summary.earliestStart || checkin;
    const days = daysUntil(tripStart);

    const heroUrl = acc?.media?.[0]?.url || extraItems[0]?.airportExtras?.media?.[0]?.url || '';
    const thumbs = (acc?.media || []).slice(0, 4);

    const refValue = accItem?.bookingReference || flightItems[0]?.bookingReference || ('TG' + order.id);

    const starHtml = acc?.rating ? Array.from({ length: Math.round(acc.rating) }, () => star()).join('') : '';

    const travellers = (summary.travellers && summary.travellers.length)
      ? summary.travellers
      : (acc?.guests || []);

    const pricing = acc?.pricing;
    const currency = pricing?.currency || order.currency || 'GBP';
    const totalPrice = (typeof summary.totalPrice === 'number' && summary.totalPrice > 0)
      ? summary.totalPrice
      : (pricing?.memberPrice ?? pricing?.price ?? accItem?.price ?? 0);
    const inResort = pricing?.inResortFees;

    const depositOpts = pricing?.depositOptions || [];
    const installPlan = depositOpts.find(d => d.installments && d.installmentsAmount) || null;
    const standardDep = depositOpts.find(d => !d.installments) || depositOpts[0] || null;

    const rate = acc?.units?.[0]?.rates?.[0];
    const cancelDescs = (rate?.descriptions || []).filter(d => d.type === 'CancelAndAmendments');

    const hotelDesc = (acc?.descriptions || []).find(d => d.title === 'Description' || d.type === 'Generic');

    const facilitiesList = (acc?.descriptions || []).find(d => d.title === 'Facilities');
    const facilities = facilitiesList?.text ? facilitiesList.text.split(/[,•]/).map(s => s.trim()).filter(Boolean).slice(0, 12) : [];

    const descByTitle = (title) => (acc?.descriptions || []).find(d => d.title === title);

    const paymentMethodsDesc = descByTitle('Methods of payment');
    const paymentMethods = paymentMethodsDesc?.text
      ? paymentMethodsDesc.text.split(/[,•]/).map(s => s.trim()).filter(Boolean).slice(0, 8)
      : [];

    const yearBuiltText = descByTitle('Year of construction')?.text
      || descByTitle('Year built')?.text
      || '';
    const yearBuiltMatch = yearBuiltText.match(/\b(19|20)\d{2}\b/);
    const yearBuilt = yearBuiltMatch ? yearBuiltMatch[0] : '';

    const totalRoomsText = descByTitle('Total number of rooms')?.text || '';
    const totalRoomsMatch = totalRoomsText.match(/\d+/);
    const totalRooms = totalRoomsMatch ? totalRoomsMatch[0] : '';

    const roomMix = [
      ['Twin', descByTitle('Twin rooms')?.text],
      ['Double', descByTitle('Double rooms')?.text],
      ['Superior', descByTitle('Superior rooms')?.text],
      ['Family', descByTitle('Family rooms')?.text],
      ['Suite', descByTitle('Suites')?.text],
    ]
      .map(([label, text]) => {
        const m = (text || '').match(/\d+/);
        return m ? { label, count: m[0] } : null;
      })
      .filter(Boolean);

    const allImportantInfo = (acc?.descriptions || []).filter(d => d.type === 'ImportantInfo');
    let checkinTime = '';
    let checkoutTime = '';
    const importantInfoBullets = [];
    for (const info of allImportantInfo) {
      const t = info.text || '';
      const ciMatch = t.match(/Check[\s-]?in\s+(?:hour|time)?\s*[:\-]?\s*(\d{1,2}:\d{2}(?:\s*-\s*\d{1,2}:\d{2})?)/i);
      const coMatch = t.match(/Check[\s-]?out\s+(?:hour|time)?\s*[:\-]?\s*(\d{1,2}:\d{2}(?:\s*-\s*\d{1,2}:\d{2})?)/i);
      if (ciMatch && !checkinTime) checkinTime = ciMatch[1];
      if (coMatch && !checkoutTime) checkoutTime = coMatch[1];
      const isJustTimes = /^check[\s-]?(in|out)/i.test(t.trim()) && t.length < 80;
      if (!isJustTimes) importantInfoBullets.push(info);
    }
    const importantInfo = importantInfoBullets;

    const priceBreakdown = pricing?.breakdown || [];
    const payAtLocation = pricing?.payAtLocation || [];

    const docs = order.documents || [];
    const showDocs = c.display?.showDocuments !== false && docs.length > 0;

    const firstName = order.customerFirstname || 'there';
    const destCity = acc?.location?.city || '';

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
              ${(starHtml || acc?.review?.rating) ? `
                <div class="tgm-hero-rating">
                  ${starHtml}
                  ${acc?.review?.rating ? `<span class="tgm-review-chip"><strong>${acc.review.rating}</strong>/5${acc.review.reviews ? ` · ${esc(acc.review.reviews.toLocaleString('en-GB'))} reviews` : ''}${acc.review.platform ? ` · ${esc(acc.review.platform)}` : ''}</span>` : ''}
                </div>
              ` : ''}
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
          <button type="button" class="tgm-action" data-tgm-pdf-preview>
            <div class="tgm-action-icon">${svg(IC.eye)}</div>
            <div class="tgm-action-text">
              <div class="tgm-action-title">${esc(c.labels?.actionPreview || 'Preview booking pack')}</div>
              <div class="tgm-action-sub">${esc(c.labels?.actionPreviewSub || 'View your full A4 confirmation inline')}</div>
            </div>
            <div class="tgm-action-loader" aria-hidden="true"></div>
            ${svg(IC.arrow)}
          </button>
          <button type="button" class="tgm-action" data-tgm-pdf-download>
            <div class="tgm-action-icon">${svg(IC.dl)}</div>
            <div class="tgm-action-text">
              <div class="tgm-action-title">${esc(c.labels?.actionDownload || 'Download as PDF')}</div>
              <div class="tgm-action-sub">${esc(c.labels?.actionDownloadSub || 'Save the booking pack to your device')}</div>
            </div>
            <div class="tgm-action-loader" aria-hidden="true"></div>
            ${svg(IC.arrow)}
          </button>
        </div>
        <div data-tgm-pdf-viewer-mount></div>
        ` : ''}

        ${(checkin || checkout || nights || acc?.units?.[0]) ? `
        <div class="tgm-stay">
          <h3>${svg(IC.bed)}${esc(c.labels?.accommodation || 'Accommodation')}${
            acc?.name ? `<span class="tgm-stay-meta">${esc(acc.name)}</span>` : ''
          }</h3>
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
        ` : ''}

        ${flightItems.map(fItem => renderFlightCard(fItem, c)).join('')}

        ${extraItems.map(eItem => renderExtraCard(eItem, c)).join('')}

        <div class="tgm-two">
          <div class="tgm-section">
            <h3>${svg(IC.card)}${esc(c.labels?.payment || 'Payment')}</h3>
            <div class="tgm-pay-total">
              <span class="tgm-pay-label">${esc(c.labels?.totalCost || 'Total holiday cost')}</span>
              <span class="tgm-pay-total-amt">${esc(fmtMoney(totalPrice, currency))}</span>
            </div>
            ${(() => {
              const productCount = (summary.hasAccommodation ? 1 : 0) + (summary.hasFlights ? 1 : 0) + (summary.hasAirportExtras ? 1 : 0);
              if (productCount < 2) return '';
              const lines = [];
              if (accItem && typeof accItem.price === 'number') {
                lines.push({ label: c.labels?.hotelLine || 'Hotel', val: accItem.price });
              }
              const flightTotal = flightItems.reduce((a, i) => a + (typeof i.price === 'number' ? i.price : 0), 0);
              if (flightTotal > 0) lines.push({ label: c.labels?.flightsLine || 'Flights', val: flightTotal });
              const extrasTotal = extraItems.reduce((a, i) => a + (typeof i.price === 'number' ? i.price : 0), 0);
              if (extrasTotal > 0) lines.push({ label: c.labels?.extrasLine || 'Airport extras', val: extrasTotal });
              if (lines.length < 2) return '';
              return `
                <div class="tgm-pay-breakdown">
                  ${lines.map(l => `
                    <div class="tgm-fee-line">
                      <span class="name">${esc(l.label)}</span>
                      <span class="val">${esc(fmtMoney(l.val, currency))}</span>
                    </div>
                  `).join('')}
                </div>
              `;
            })()}
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
            ${travellers.length === 0 ? `
              <div class="tgm-guest">
                <div class="tgm-guest-av">${esc(initials(order.customerFirstname, order.customerSurname))}</div>
                <div class="tgm-guest-info">
                  <div class="tgm-guest-name">${esc((order.customerTitle ? order.customerTitle + ' ' : '') + (order.customerFirstname || '') + ' ' + (order.customerSurname || ''))}</div>
                  <div class="tgm-guest-meta">${esc(c.labels?.leadGuest || 'Lead guest')}</div>
                </div>
              </div>
            ` : travellers.map((g, i) => `
              <div class="tgm-guest">
                <div class="tgm-guest-av">${esc(initials(g.firstname, g.surname))}</div>
                <div class="tgm-guest-info">
                  <div class="tgm-guest-name">${esc((g.title ? g.title + ' ' : '') + (g.firstname || '') + ' ' + (g.surname || ''))}</div>
                  <div class="tgm-guest-meta">${esc(i === 0 ? (c.labels?.leadGuest || 'Lead guest') : (g.type || 'Adult'))}</div>
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

        ${(hotelDesc?.text || acc?.location?.address1 || paymentMethods.length || yearBuilt || totalRooms || roomMix.length || facilities.length) ? `
        <div class="tgm-collapse">
          <button class="tgm-collapse-trig" type="button" aria-expanded="false">
            <div class="tgm-collapse-left">${svg(IC.bed)}${esc(c.labels?.aboutHotel || 'About the hotel')}</div>
            ${svg(IC.chev)}
          </button>
          <div class="tgm-collapse-body"><div class="tgm-collapse-inner">
            ${hotelDesc?.text ? `<p>${esc(hotelDesc.text.slice(0, 800))}${hotelDesc.text.length > 800 ? '…' : ''}</p>` : ''}

            ${(acc?.location?.address1 || acc?.location?.city || acc?.location?.postalCode) ? `
              <div class="tgm-subhead">${esc(c.labels?.address || 'Address')}</div>
              <p>
                ${[
                  acc?.location?.address1,
                  acc?.location?.city,
                  acc?.location?.state,
                  acc?.location?.postalCode,
                  acc?.location?.country,
                ].filter(Boolean).map(s => esc(s)).join(', ')}
                ${(acc?.location?.latitude && acc?.location?.longitude)
                  ? ` · <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(acc.location.latitude + ',' + acc.location.longitude)}" target="_blank" rel="noopener">${esc(c.labels?.viewMap || 'View on map')}</a>`
                  : ''}
              </p>
            ` : ''}

            ${(yearBuilt || totalRooms || roomMix.length) ? `
              <div class="tgm-subhead">${esc(c.labels?.propertyDetails || 'Property details')}</div>
              <dl class="tgm-kv">
                ${yearBuilt ? `<dt>${esc(c.labels?.yearBuilt || 'Year built')}</dt><dd>${esc(yearBuilt)}</dd>` : ''}
                ${totalRooms ? `<dt>${esc(c.labels?.totalRooms || 'Total rooms')}</dt><dd>${esc(totalRooms)}</dd>` : ''}
                ${roomMix.length ? `<dt>${esc(c.labels?.roomMix || 'Room mix')}</dt><dd>${roomMix.map(r => `${esc(r.count)} ${esc(r.label.toLowerCase())}`).join(', ')}</dd>` : ''}
              </dl>
            ` : ''}

            ${facilities.length ? `
              <div class="tgm-subhead">${esc(c.labels?.facilities || 'Facilities')}</div>
              <div class="tgm-facilities">${facilities.map(f => `<span class="tgm-fac">${svg(IC.check)}${esc(f)}</span>`).join('')}</div>
            ` : ''}

            ${paymentMethods.length ? `
              <div class="tgm-subhead">${esc(c.labels?.paymentMethods || 'Accepted at the hotel')}</div>
              <div class="tgm-chips">${paymentMethods.map(p => `<span class="tgm-chip">${svg(IC.card)}${esc(p)}</span>`).join('')}</div>
            ` : ''}
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

        ${(importantInfo.length || inResort || payAtLocation.length || checkinTime || checkoutTime) ? `
        <div class="tgm-collapse">
          <button class="tgm-collapse-trig" type="button" aria-expanded="false">
            <div class="tgm-collapse-left">${svg(IC.coin)}${esc(c.labels?.localFees || 'At the hotel')}</div>
            ${svg(IC.chev)}
          </button>
          <div class="tgm-collapse-body"><div class="tgm-collapse-inner">
            ${(checkinTime || checkoutTime) ? `
              <div class="tgm-subhead">${esc(c.labels?.checkInOutTimes || 'Check-in & check-out')}</div>
              <dl class="tgm-kv">
                ${checkinTime ? `<dt>${esc(c.labels?.checkin || 'Check-in')}</dt><dd>${esc(checkinTime)}</dd>` : ''}
                ${checkoutTime ? `<dt>${esc(c.labels?.checkout || 'Check-out')}</dt><dd>${esc(checkoutTime)}</dd>` : ''}
              </dl>
            ` : ''}

            ${(payAtLocation.length || inResort) ? `
              <div class="tgm-subhead">${esc(c.labels?.payAtHotel || 'Payable at the hotel')}</div>
              ${payAtLocation.map(line => `
                <div class="tgm-fee-line">
                  <span class="name">
                    ${esc(line.name || 'Local fee')}
                    ${line.description && line.description !== line.name ? `<small>${esc(line.description)}</small>` : ''}
                    ${(typeof line.qty === 'number' && line.qty > 1) ? `<small>× ${esc(String(line.qty))}</small>` : ''}
                  </span>
                  <span class="val">${typeof line.unitPrice === 'number' ? esc(fmtMoney((line.unitPrice || 0) * (line.qty || 1), currency)) : '—'}</span>
                </div>
              `).join('')}
              ${(inResort && !payAtLocation.length) ? `
                <div class="tgm-fee-line">
                  <span class="name">${esc(c.labels?.resortFee || 'Resort fee')}</span>
                  <span class="val">${esc(fmtMoney(inResort, currency))}</span>
                </div>
              ` : ''}
            ` : ''}

            ${importantInfo.length ? `
              <div class="tgm-subhead">${esc(c.labels?.goodToKnow || 'Good to know')}</div>
              ${importantInfo.map(d => `<p>${esc(d.text)}</p>`).join('')}
            ` : ''}
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
      this.lookup = null;
      this._toastTimers = new Map();
      this._pdfBlob = null;          // cached blob, shared by preview & download
      this._pdfPreviewUrl = null;    // object URL for the inline iframe
      this._pdfViewerOpen = false;
      this._render();
    }

    _defaults(c) {
      const merged = Object.assign({
        layout: 'vertical',
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
      const lighten = (hex, amt) => this._shiftHex(hex, amt);
      const primary = c.primary || '#1B2B5B';
      const accent = c.accent || '#00B4D8';
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

      // When we re-render the found view, the previously injected iframe
      // is gone. Reset the open flag so the next Preview click rebuilds it.
      if (this.state.stage !== 'found') this._pdfViewerOpen = false;

      this.shadow.innerHTML = '<style>' + STYLES + '</style><div class="tgm-root"' + themeAttr + ' style="' + overrides + '">' + inner + '</div>';
      this._bind();
    }

    _bind() {
      const root = this.shadow.querySelector('.tgm-root');
      if (!root) return;

      const form = root.querySelector('[data-tgm-form]');
      if (form) {
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          this._submit(form);
        });
      }

      const tryAgain = root.querySelector('[data-tgm-tryagain]');
      if (tryAgain) tryAgain.addEventListener('click', () => {
        this.state = { stage: 'form', order: null, error: null };
        this._render();
      });

      const heroImg = root.querySelector('[data-tgm-hero-img]');
      root.querySelectorAll('[data-tgm-thumb]').forEach(btn => {
        btn.addEventListener('click', () => {
          root.querySelectorAll('[data-tgm-thumb]').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          if (heroImg) heroImg.style.backgroundImage = "url('" + btn.dataset.img + "')";
        });
      });

      root.querySelectorAll('.tgm-collapse-trig').forEach(t => {
        t.addEventListener('click', () => {
          const wrap = t.parentElement;
          const isOpen = wrap.classList.toggle('open');
          t.setAttribute('aria-expanded', isOpen);
        });
      });

      // PDF buttons: Preview opens inline viewer, Download triggers a file save.
      // Both share a single fetch — the blob is cached on the instance after
      // the first call so the second action reuses it.
      const previewBtn = root.querySelector('[data-tgm-pdf-preview]');
      if (previewBtn) previewBtn.addEventListener('click', () => this._handlePdfPreview(previewBtn));
      const downloadBtn = root.querySelector('[data-tgm-pdf-download]');
      if (downloadBtn) downloadBtn.addEventListener('click', () => this._handlePdfDownload(downloadBtn));
    }

    async _submit(form) {
      const data = new FormData(form);
      const email = (data.get('email') || '').toString().trim();
      const date = (data.get('date') || '').toString().trim();
      const ref = (data.get('ref') || '').toString().trim();

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

        this.lookup = { email, date, ref };

        // New booking → previously cached PDF is now stale. Discard.
        this._discardPdfCache();

        this.state = { stage: 'found', order: data.order, error: null };
        this._render();
        this._fireEvent('booking-loaded', { order: data.order });
      } catch (err) {
        this.state = { stage: 'form', order: null, error: 'Something went wrong. Please try again in a moment.' };
        this._render();
      }
    }

    // Filename derived from the booking ref, shared between preview + download.
    _pdfFilename() {
      const item = this.state.order?.items?.[0];
      const refValue = item?.bookingReference || ('TG' + (this.state.order?.id || ''));
      return 'booking-' + String(refValue).replace(/[^A-Z0-9_\-]/gi, '') + '.pdf';
    }

    // Single source of truth for the PDF blob. Returns the cached blob if one
    // exists, otherwise fetches once. All errors surface as toasts.
    async _ensurePdfBlob() {
      if (this._pdfBlob) return this._pdfBlob;

      if (!this.lookup || !this.c.widgetId) {
        this._showToast('error', 'Cannot generate PDF', 'Please look up your booking again.');
        return null;
      }

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
          return null;
        }

        const blob = await res.blob();
        this._pdfBlob = blob;
        this._dismissToast(loadingToastId);
        return blob;
      } catch (err) {
        this._dismissToast(loadingToastId);
        this._showToast('error', 'Generation failed', 'Please check your connection and try again.', 6000);
        return null;
      }
    }

    _discardPdfCache() {
      if (this._pdfPreviewUrl) {
        try { URL.revokeObjectURL(this._pdfPreviewUrl); } catch {}
        this._pdfPreviewUrl = null;
      }
      this._pdfBlob = null;
      this._pdfViewerOpen = false;
    }

    // Preview button — toggles the inline viewer. If already open, closes it.
    async _handlePdfPreview(btn) {
      if (btn.disabled) return;

      const root = this.shadow.querySelector('.tgm-root');
      const mount = root?.querySelector('[data-tgm-pdf-viewer-mount]');
      if (!mount) return;

      if (this._pdfViewerOpen) {
        this._closePdfViewer();
        return;
      }

      btn.disabled = true;
      btn.classList.add('is-loading');

      try {
        const blob = await this._ensurePdfBlob();
        if (!blob) return;

        if (!this._pdfPreviewUrl) {
          this._pdfPreviewUrl = URL.createObjectURL(blob);
        }

        // iOS Safari can't render <iframe src="blob:..."> for PDFs. Detect
        // and offer a download-only fallback so users aren't left with an
        // empty grey box and no recourse.
        const ua = navigator.userAgent || '';
        const isIosSafari = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;

        const filename = this._pdfFilename();
        if (isIosSafari) {
          mount.innerHTML = `
            <div class="tgm-pdf-viewer">
              <div class="tgm-pdf-viewer-head">
                <span class="tgm-pdf-viewer-title">${svg(IC.file)}${esc(filename)}</span>
                <div class="tgm-pdf-viewer-actions">
                  <button type="button" class="tgm-pdf-viewer-btn" data-tgm-pdf-viewer-close>${svg(IC.x)}Close</button>
                </div>
              </div>
              <div class="tgm-pdf-viewer-fallback">
                <p>Inline preview isn't supported on this browser. Tap below to open the PDF in a new tab, or use the Download button to save it.</p>
                <a class="tgm-btn-1" href="${this._pdfPreviewUrl}" target="_blank" rel="noopener">${svg(IC.arrow)}Open PDF</a>
              </div>
            </div>
          `;
        } else {
          // The #toolbar=0 hash is a hint to most desktop PDF viewers to hide
          // their built-in toolbar — keeps the chrome consistent.
          mount.innerHTML = `
            <div class="tgm-pdf-viewer">
              <div class="tgm-pdf-viewer-head">
                <span class="tgm-pdf-viewer-title">${svg(IC.file)}${esc(filename)}</span>
                <div class="tgm-pdf-viewer-actions">
                  <button type="button" class="tgm-pdf-viewer-btn" data-tgm-pdf-viewer-close>${svg(IC.x)}Close</button>
                </div>
              </div>
              <iframe class="tgm-pdf-viewer-frame" src="${this._pdfPreviewUrl}#toolbar=0" title="Booking confirmation PDF preview"></iframe>
            </div>
          `;
        }

        const closeBtn = mount.querySelector('[data-tgm-pdf-viewer-close]');
        if (closeBtn) closeBtn.addEventListener('click', () => this._closePdfViewer());

        this._pdfViewerOpen = true;
        btn.classList.add('is-active');
        this._fireEvent('pdf-previewed', { filename });

        // Smooth-scroll the viewer into view so the user sees what just happened.
        const viewer = mount.querySelector('.tgm-pdf-viewer');
        if (viewer && typeof viewer.scrollIntoView === 'function') {
          requestAnimationFrame(() => {
            viewer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          });
        }
      } finally {
        btn.disabled = false;
        btn.classList.remove('is-loading');
      }
    }

    _closePdfViewer() {
      const root = this.shadow.querySelector('.tgm-root');
      const mount = root?.querySelector('[data-tgm-pdf-viewer-mount]');
      if (mount) mount.innerHTML = '';
      const previewBtn = root?.querySelector('[data-tgm-pdf-preview]');
      if (previewBtn) previewBtn.classList.remove('is-active');
      this._pdfViewerOpen = false;
    }

    // Download button — uses the same fetch/blob as preview. If user clicks
    // Download first (without previewing), this fetches; if they previewed
    // first, this reuses the cached blob.
    async _handlePdfDownload(btn) {
      if (btn.disabled) return;

      btn.disabled = true;
      btn.classList.add('is-loading');

      try {
        const blob = await this._ensurePdfBlob();
        if (!blob) return;

        const filename = this._pdfFilename();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);

        this._showToast('success', 'PDF downloaded', filename, 4000);
        this._fireEvent('pdf-downloaded', { filename });
      } finally {
        btn.disabled = false;
        btn.classList.remove('is-loading');
      }
    }

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
        this._discardPdfCache();
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
