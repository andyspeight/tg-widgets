/**
 * Travelgenix WhatsApp Chat Widget v1.0.0
 * Self-contained, embeddable widget
 * Zero dependencies — works on any website via a single script tag
 *
 * Usage:
 *   <div data-tg-widget="whatsapp" data-tg-id="YOUR_WIDGET_ID"></div>
 *   <script src="https://tg-widgets.vercel.app/widget-whatsapp.js"></script>
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
        if (/\/widget\-whatsapp\.js(\?|$|#)/.test(s)) {
          return new URL(s).origin + '/api/widget-config';
        }
      }
    } catch (e) { /* fall through */ }
    return '/api/widget-config';
  }

  const API_BASE = resolveApiBase();
  const TRACK_BASE = (function () {
    /* Resolve the TRACK_BASE URL. Yesterday's fix patched widget-config but this
       secondary API was left with a relative default ('/api/whatsapp-track'), which
       on customer sites resolves to the customer's domain and 404s. Same
       resolution strategy as the API_BASE resolver above. */
    if (typeof window === 'undefined') return '/api/whatsapp-track';
    if (window.__TG_WHATSAPP_TRACK_API__) return window.__TG_WHATSAPP_TRACK_API__;
    try {
      var me = document.currentScript;
      if (me && me.src) return new URL(me.src).origin + '/api/whatsapp-track';
      var scripts = document.getElementsByTagName('script');
      for (var i = scripts.length - 1; i >= 0; i--) {
        var s = scripts[i].src || '';
        if (/\/widget\-whatsapp\.js(\?|$|#)/.test(s)) {
          return new URL(s).origin + '/api/whatsapp-track';
        }
      }
    } catch (e) { /* fall through */ }
    return '/api/whatsapp-track';
  })();
  const VERSION = '1.0.0';

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

  function safeUrl(u) {
    if (!u) return '';
    const s = String(u).trim();
    if (/^javascript:/i.test(s) || /^data:/i.test(s) || /^vbscript:/i.test(s)) return '';
    return s;
  }

  function safeImageUrl(u) {
    if (!u) return '';
    const s = String(u).trim();
    if (/^javascript:/i.test(s) || /^vbscript:/i.test(s)) return '';
    if (/^data:/i.test(s) && !/^data:image\//i.test(s)) return '';
    return s;
  }

  // Strip everything that isn't a digit. WhatsApp expects E.164 without the +.
  function cleanPhone(p) {
    if (!p) return '';
    return String(p).replace(/[^\d]/g, '');
  }

  function getOg(name) {
    try {
      const m = document.querySelector(
        `meta[property="og:${name}"], meta[name="og:${name}"], meta[name="${name}"]`
      );
      return m ? (m.getAttribute('content') || '') : '';
    } catch (e) { return ''; }
  }

  function expandTokens(template, ctx) {
    if (!template) return '';
    const safeCtx = ctx || {};
    return String(template)
      .replace(/\{page_url\}/gi, safeCtx.url || '')
      .replace(/\{page_title\}/gi, safeCtx.title || '')
      .replace(/\{site_name\}/gi, safeCtx.site || '');
  }

  function buildWaLink(phone, message) {
    const p = cleanPhone(phone);
    if (!p) return '';
    const msg = encodeURIComponent(message || '');
    return 'https://wa.me/' + p + (msg ? ('?text=' + msg) : '');
  }

  // ---------- Office hours ----------
  // hours = { mon: [['09:00','17:30']], tue: [...], ... }, timezone unused (uses visitor local)
  // Returns { open: bool, nextOpen: string|null }
  const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  function parseHHMM(s) {
    if (!s) return null;
    const m = String(s).match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const h = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
    return h * 60 + mm;
  }

  function evalOfficeHours(hours, now) {
    if (!hours || typeof hours !== 'object') return { open: true, nextOpen: null };
    const d = now || new Date();
    const dayIdx = d.getDay();
    const dayKey = DAY_KEYS[dayIdx];
    const todays = Array.isArray(hours[dayKey]) ? hours[dayKey] : [];
    const minutesNow = d.getHours() * 60 + d.getMinutes();

    // Open right now?
    for (const slot of todays) {
      if (!Array.isArray(slot) || slot.length !== 2) continue;
      const a = parseHHMM(slot[0]);
      const b = parseHHMM(slot[1]);
      if (a !== null && b !== null && minutesNow >= a && minutesNow < b) {
        return { open: true, nextOpen: null };
      }
    }

    // Find the next opening slot (today later, or next available day in the week)
    const todayLater = todays
      .map(s => Array.isArray(s) ? parseHHMM(s[0]) : null)
      .filter(m => m !== null && m > minutesNow)
      .sort((a, b) => a - b)[0];
    if (todayLater !== undefined) {
      const hh = String(Math.floor(todayLater / 60)).padStart(2, '0');
      const mm = String(todayLater % 60).padStart(2, '0');
      return { open: false, nextOpen: 'today at ' + hh + ':' + mm };
    }

    // Look ahead up to 7 days
    for (let i = 1; i <= 7; i++) {
      const k = DAY_KEYS[(dayIdx + i) % 7];
      const slots = Array.isArray(hours[k]) ? hours[k] : [];
      const opens = slots
        .map(s => Array.isArray(s) ? parseHHMM(s[0]) : null)
        .filter(m => m !== null)
        .sort((a, b) => a - b)[0];
      if (opens !== undefined) {
        const hh = String(Math.floor(opens / 60)).padStart(2, '0');
        const mm = String(opens % 60).padStart(2, '0');
        const dayLabel = ({ sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday' })[k];
        return { open: false, nextOpen: dayLabel + ' at ' + hh + ':' + mm };
      }
    }
    return { open: false, nextOpen: null };
  }

  // ---------- Icons ----------
  const ICONS = {
    whatsapp: '<path d="M16.6 14.1c-.3-.1-1.6-.8-1.9-.9-.3-.1-.5-.1-.7.1-.2.3-.7.9-.9 1.1-.2.2-.3.2-.6.1-1.6-.8-2.7-1.5-3.7-3.4-.3-.5.3-.4.7-1.5.1-.2 0-.4 0-.5 0-.1-.7-1.6-.9-2.2-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.2.2 2.1 3.2 5.2 4.5 1.9.8 2.7.9 3.6.7.6-.1 1.6-.7 1.9-1.3.2-.7.2-1.2.2-1.3-.1-.1-.3-.2-.5-.3zM12 2C6.5 2 2 6.5 2 12c0 1.7.4 3.4 1.3 4.9L2 22l5.3-1.4c1.4.8 3 1.2 4.7 1.2 5.5 0 10-4.5 10-10S17.5 2 12 2z"/>',
    send: '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
    close: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    chevron: '<polyline points="6 9 12 15 18 9"/>',
    check: '<polyline points="20 6 9 17 4 12"/>',
  };

  function svg(name, size) {
    const s = size || 18;
    const isLine = name === 'send' || name === 'close' || name === 'chevron' || name === 'check';
    const attrs = isLine
      ? `stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"`
      : `fill="currentColor"`;
    return `<svg viewBox="0 0 24 24" width="${s}" height="${s}" ${attrs} aria-hidden="true">${ICONS[name] || ''}</svg>`;
  }

  // ---------- Styles ----------
  const STYLES = `
    :host { all: initial; display: block; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    *, *::before, *::after { box-sizing: border-box; }

    .tgwa-root {
      --tgwa-brand: #25D366;
      --tgwa-brand-dark: #128C7E;
      --tgwa-bg: #FFFFFF;
      --tgwa-card: #FFFFFF;
      --tgwa-text: #0F172A;
      --tgwa-sub: #64748B;
      --tgwa-muted: #94A3B8;
      --tgwa-border: #E5E7EB;
      --tgwa-bg-chat: #ECE5DD;
      --tgwa-bubble-them: #FFFFFF;
      --tgwa-radius: 16px;
      --tgwa-shadow: 0 8px 24px rgba(15, 23, 42, 0.12), 0 2px 6px rgba(15, 23, 42, 0.06);
      --tgwa-shadow-hover: 0 14px 36px rgba(15, 23, 42, 0.18), 0 4px 10px rgba(15, 23, 42, 0.08);
      color: var(--tgwa-text);
    }

    .tgwa-root[data-theme="dark"] {
      --tgwa-bg: #0F172A;
      --tgwa-card: #1E293B;
      --tgwa-text: #F1F5F9;
      --tgwa-sub: #94A3B8;
      --tgwa-muted: #64748B;
      --tgwa-border: #334155;
      --tgwa-bg-chat: #0B141A;
      --tgwa-bubble-them: #202C33;
      --tgwa-shadow: 0 8px 24px rgba(0, 0, 0, 0.5), 0 2px 6px rgba(0, 0, 0, 0.3);
      --tgwa-shadow-hover: 0 14px 36px rgba(0, 0, 0, 0.6), 0 4px 10px rgba(0, 0, 0, 0.4);
    }

    /* ========== FLOATING LAYOUT ========== */
    .tgwa-floating {
      position: fixed;
      z-index: 9000;
      display: flex;
      flex-direction: column;
      gap: 12px;
      pointer-events: none;
    }

    /* Bottom corners — stack flows upward (greeting above FAB) */
    .tgwa-floating[data-position="bottom-right"]  { right: 20px; bottom: 20px; align-items: flex-end; flex-direction: column; }
    .tgwa-floating[data-position="bottom-left"]   { left: 20px;  bottom: 20px; align-items: flex-start; flex-direction: column; }

    /* Top corners — stack flows downward (greeting below FAB) */
    .tgwa-floating[data-position="top-right"]     { right: 20px; top: 20px; align-items: flex-end; flex-direction: column-reverse; }
    .tgwa-floating[data-position="top-left"]      { left: 20px;  top: 20px; align-items: flex-start; flex-direction: column-reverse; }

    /* Middle — vertically centred */
    .tgwa-floating[data-position="middle-right"]  { right: 20px; top: 50%; transform: translateY(-50%); align-items: flex-end; flex-direction: column; }
    .tgwa-floating[data-position="middle-left"]   { left: 20px;  top: 50%; transform: translateY(-50%); align-items: flex-start; flex-direction: column; }

    .tgwa-floating > * { pointer-events: auto; }

    /* ----- Greeting bubble ----- */
    .tgwa-greeting {
      max-width: 260px;
      background: var(--tgwa-card);
      color: var(--tgwa-text);
      border: 1px solid var(--tgwa-border);
      border-radius: 14px;
      padding: 12px 36px 12px 14px;
      font-size: 14px;
      line-height: 1.4;
      box-shadow: var(--tgwa-shadow);
      position: relative;
      opacity: 0;
      transform: translateY(8px) scale(0.95);
      pointer-events: none;
      transition: opacity 280ms ease, transform 280ms cubic-bezier(.2,.8,.2,1);
    }
    .tgwa-greeting[data-show="true"] {
      opacity: 1;
      transform: translateY(0) scale(1);
      pointer-events: auto;
    }
    .tgwa-greeting::after {
      content: '';
      position: absolute;
      width: 12px;
      height: 12px;
      background: var(--tgwa-card);
      border: 1px solid var(--tgwa-border);
      transform: rotate(45deg);
    }
    /* Bottom positions — tail on bottom edge of bubble */
    .tgwa-floating[data-position="bottom-right"] .tgwa-greeting::after { bottom: -6px; right: 28px; border-top: none; border-left: none; }
    .tgwa-floating[data-position="bottom-left"]  .tgwa-greeting::after { bottom: -6px; left: 28px;  border-top: none; border-left: none; }
    /* Top positions — tail on top edge of bubble */
    .tgwa-floating[data-position="top-right"] .tgwa-greeting::after { top: -6px; right: 28px; border-bottom: none; border-right: none; }
    .tgwa-floating[data-position="top-left"]  .tgwa-greeting::after { top: -6px; left: 28px;  border-bottom: none; border-right: none; }
    /* Middle positions — tail on the inside edge (pointing toward FAB) */
    .tgwa-floating[data-position="middle-right"] .tgwa-greeting::after { bottom: -6px; right: 28px; border-top: none; border-left: none; }
    .tgwa-floating[data-position="middle-left"]  .tgwa-greeting::after { bottom: -6px; left: 28px;  border-top: none; border-left: none; }

    .tgwa-greeting-close {
      position: absolute;
      top: 6px; right: 6px;
      width: 22px; height: 22px;
      border: none;
      background: transparent;
      color: var(--tgwa-muted);
      cursor: pointer;
      border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      transition: all 150ms ease;
    }
    .tgwa-greeting-close:hover { background: rgba(0,0,0,0.06); color: var(--tgwa-text); }

    /* ----- Floating button ----- */
    .tgwa-fab {
      position: relative;
      width: 60px;
      height: 60px;
      border-radius: 50%;
      border: none;
      background: var(--tgwa-brand);
      color: #FFFFFF;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: var(--tgwa-shadow);
      transition: transform 220ms cubic-bezier(.2,.8,.2,1), box-shadow 220ms ease;
    }
    .tgwa-fab:hover {
      transform: translateY(-3px) scale(1.04);
      box-shadow: var(--tgwa-shadow-hover);
    }
    .tgwa-fab:focus-visible {
      outline: 3px solid color-mix(in srgb, var(--tgwa-brand) 50%, transparent);
      outline-offset: 3px;
    }
    .tgwa-fab:active { transform: scale(0.95); }
    .tgwa-fab svg { width: 30px; height: 30px; fill: currentColor; }

    .tgwa-fab[data-pulse="true"]::before {
      content: '';
      position: absolute;
      inset: 0;
      border-radius: 50%;
      background: var(--tgwa-brand);
      opacity: 0.45;
      animation: tgwa-pulse 2.4s ease-out infinite;
      z-index: -1;
    }
    @keyframes tgwa-pulse {
      0%   { transform: scale(1);   opacity: 0.45; }
      80%  { transform: scale(1.6); opacity: 0; }
      100% { transform: scale(1.6); opacity: 0; }
    }

    /* Online dot */
    .tgwa-fab .tgwa-dot {
      position: absolute;
      top: 4px; right: 4px;
      width: 14px; height: 14px;
      border-radius: 50%;
      background: #22C55E;
      border: 2px solid #FFFFFF;
    }
    .tgwa-fab .tgwa-dot[data-state="offline"] { background: #94A3B8; }

    /* ----- Popover panel (opened from FAB) ----- */
    .tgwa-panel {
      position: absolute;
      width: 340px;
      max-width: calc(100vw - 32px);
      background: var(--tgwa-card);
      border-radius: var(--tgwa-radius);
      box-shadow: var(--tgwa-shadow-hover);
      overflow: hidden;
      opacity: 0;
      visibility: hidden;
      transform: translateY(8px) scale(0.96);
      transform-origin: bottom right;
      pointer-events: none;
      transition: opacity 220ms ease, transform 220ms cubic-bezier(.2,.8,.2,1), visibility 0ms linear 220ms;
      display: flex;
      flex-direction: column;
      max-height: min(560px, calc(100vh - 120px));
    }
    /* Bottom positions: panel sits ABOVE the FAB */
    .tgwa-floating[data-position="bottom-right"]  .tgwa-panel { transform-origin: bottom right; bottom: 76px; right: 0; }
    .tgwa-floating[data-position="bottom-left"]   .tgwa-panel { transform-origin: bottom left;  bottom: 76px; left: 0; }
    /* Top positions: panel sits BELOW the FAB */
    .tgwa-floating[data-position="top-right"]     .tgwa-panel { transform-origin: top right;    top: 76px;    right: 0; }
    .tgwa-floating[data-position="top-left"]      .tgwa-panel { transform-origin: top left;     top: 76px;    left: 0; }
    /* Middle positions: panel sits BESIDE the FAB on the inside */
    .tgwa-floating[data-position="middle-right"]  .tgwa-panel { transform-origin: center right; right: 76px;  top: 50%; transform: translateY(-50%) translateX(8px) scale(0.96); }
    .tgwa-floating[data-position="middle-left"]   .tgwa-panel { transform-origin: center left;  left: 76px;   top: 50%; transform: translateY(-50%) translateX(-8px) scale(0.96); }

    .tgwa-panel[data-open="true"] {
      opacity: 1;
      visibility: visible;
      transform: translateY(0) scale(1);
      pointer-events: auto;
      transition: opacity 220ms ease, transform 220ms cubic-bezier(.2,.8,.2,1), visibility 0ms linear 0ms;
    }
    .tgwa-floating[data-position="middle-right"] .tgwa-panel[data-open="true"],
    .tgwa-floating[data-position="middle-left"]  .tgwa-panel[data-open="true"] {
      transform: translateY(-50%) translateX(0) scale(1);
    }

    .tgwa-panel-head {
      background: var(--tgwa-brand-dark);
      color: #FFFFFF;
      padding: 16px 18px;
      display: flex;
      align-items: center;
      gap: 12px;
      position: relative;
    }
    .tgwa-panel-head-icon {
      width: 38px; height: 38px;
      border-radius: 50%;
      background: rgba(255,255,255,0.15);
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
    }
    .tgwa-panel-head-icon svg { width: 22px; height: 22px; fill: #FFFFFF; }
    .tgwa-panel-head-meta { flex: 1; min-width: 0; }
    .tgwa-panel-head-title { font-size: 15px; font-weight: 600; line-height: 1.2; }
    .tgwa-panel-head-status {
      font-size: 12px; opacity: 0.85; line-height: 1.3;
      display: flex; align-items: center; gap: 6px;
      margin-top: 2px;
    }
    .tgwa-panel-head-status::before {
      content: ''; width: 6px; height: 6px; border-radius: 50%;
      background: #22C55E;
    }
    .tgwa-panel-head-status[data-state="offline"]::before { background: #FCA5A5; }
    .tgwa-panel-head-close {
      width: 28px; height: 28px;
      background: transparent;
      border: none;
      color: rgba(255,255,255,0.85);
      cursor: pointer;
      border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      transition: all 150ms ease;
      flex-shrink: 0;
    }
    .tgwa-panel-head-close:hover {
      background: rgba(255,255,255,0.15);
      color: #FFFFFF;
    }

    .tgwa-panel-body {
      flex: 1;
      overflow-y: auto;
      background: var(--tgwa-bg-chat);
      padding: 18px 16px;
      position: relative;
      background-image: radial-gradient(circle at 20% 30%, rgba(255,255,255,0.04) 1px, transparent 1px),
                        radial-gradient(circle at 80% 60%, rgba(255,255,255,0.04) 1px, transparent 1px);
      background-size: 80px 80px, 100px 100px;
    }

    .tgwa-bubble {
      background: var(--tgwa-bubble-them);
      color: var(--tgwa-text);
      border-radius: 12px;
      padding: 10px 12px;
      font-size: 14px;
      line-height: 1.45;
      box-shadow: 0 1px 1px rgba(15, 23, 42, 0.08);
      max-width: 85%;
      margin-bottom: 8px;
      position: relative;
      animation: tgwa-fade-in 320ms ease;
    }
    .tgwa-bubble::before {
      content: '';
      position: absolute;
      left: -6px; top: 0;
      border: 6px solid transparent;
      border-right-color: var(--tgwa-bubble-them);
      border-top-color: var(--tgwa-bubble-them);
    }
    .tgwa-bubble-meta {
      font-size: 11px;
      color: var(--tgwa-muted);
      margin-bottom: 4px;
    }
    @keyframes tgwa-fade-in {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .tgwa-out-of-hours {
      background: rgba(248, 250, 252, 0.95);
      border: 1px solid var(--tgwa-border);
      border-radius: 10px;
      padding: 10px 12px;
      font-size: 12px;
      color: var(--tgwa-sub);
      line-height: 1.45;
      margin-top: 4px;
    }
    .tgwa-root[data-theme="dark"] .tgwa-out-of-hours {
      background: rgba(30, 41, 59, 0.85);
    }

    /* Agents grid */
    .tgwa-agents {
      display: flex; flex-direction: column;
      gap: 8px;
      margin-top: 10px;
    }
    .tgwa-agent {
      background: var(--tgwa-card);
      border: 1px solid var(--tgwa-border);
      border-radius: 10px;
      padding: 10px;
      display: flex;
      align-items: center;
      gap: 10px;
      cursor: pointer;
      transition: all 180ms ease;
      text-decoration: none;
      color: inherit;
    }
    .tgwa-agent:hover {
      border-color: var(--tgwa-brand);
      transform: translateY(-1px);
      box-shadow: 0 2px 6px rgba(15, 23, 42, 0.08);
    }
    .tgwa-agent-photo {
      width: 38px; height: 38px;
      border-radius: 50%;
      background: var(--tgwa-brand);
      color: #FFFFFF;
      display: flex; align-items: center; justify-content: center;
      font-weight: 600;
      font-size: 14px;
      flex-shrink: 0;
      overflow: hidden;
      position: relative;
    }
    .tgwa-agent-photo img { width: 100%; height: 100%; object-fit: cover; }
    .tgwa-agent-photo[data-online="true"]::after {
      content: '';
      position: absolute;
      bottom: 0; right: 0;
      width: 10px; height: 10px;
      border-radius: 50%;
      background: #22C55E;
      border: 2px solid var(--tgwa-card);
    }
    .tgwa-agent-meta { flex: 1; min-width: 0; }
    .tgwa-agent-name { font-size: 13px; font-weight: 600; line-height: 1.2; color: var(--tgwa-text); }
    .tgwa-agent-role { font-size: 11px; color: var(--tgwa-sub); margin-top: 2px; line-height: 1.2; }
    .tgwa-agent-cta {
      background: var(--tgwa-brand);
      color: #FFFFFF;
      border-radius: 50%;
      width: 30px; height: 30px;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
    }
    .tgwa-agent-cta svg { width: 14px; height: 14px; fill: #FFFFFF; }

    /* Footer with single CTA */
    .tgwa-panel-foot {
      padding: 12px 14px;
      border-top: 1px solid var(--tgwa-border);
      background: var(--tgwa-card);
    }
    .tgwa-cta {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      width: 100%;
      height: 44px;
      border-radius: 999px;
      background: var(--tgwa-brand);
      color: #FFFFFF;
      border: none;
      font-family: inherit;
      font-size: 14px;
      font-weight: 600;
      letter-spacing: -0.01em;
      cursor: pointer;
      text-decoration: none;
      transition: transform 180ms cubic-bezier(.2,.8,.2,1), box-shadow 180ms ease, background 150ms ease;
    }
    .tgwa-cta:hover {
      background: var(--tgwa-brand-dark);
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(37, 211, 102, 0.35);
    }
    .tgwa-cta:focus-visible {
      outline: 3px solid color-mix(in srgb, var(--tgwa-brand) 50%, transparent);
      outline-offset: 2px;
    }
    .tgwa-cta svg { width: 18px; height: 18px; fill: #FFFFFF; }
    .tgwa-cta[data-disabled="true"] {
      background: var(--tgwa-muted);
      cursor: not-allowed;
      pointer-events: none;
      opacity: 0.7;
    }

    .tgwa-fineprint {
      text-align: center;
      font-size: 11px;
      color: var(--tgwa-muted);
      margin-top: 8px;
    }

    /* ========== INLINE LAYOUT ========== */
    .tgwa-inline {
      display: inline-flex;
      align-items: center;
      gap: 12px;
      padding: 12px 18px 12px 14px;
      background: var(--tgwa-brand);
      color: #FFFFFF;
      border-radius: 999px;
      text-decoration: none;
      font-weight: 600;
      font-size: 15px;
      letter-spacing: -0.01em;
      box-shadow: 0 2px 6px rgba(37, 211, 102, 0.3);
      transition: transform 180ms cubic-bezier(.2,.8,.2,1), box-shadow 180ms ease, background 150ms ease;
      cursor: pointer;
      border: none;
      font-family: inherit;
    }
    .tgwa-inline:hover {
      background: var(--tgwa-brand-dark);
      transform: translateY(-2px);
      box-shadow: 0 6px 14px rgba(37, 211, 102, 0.4);
    }
    .tgwa-inline:focus-visible {
      outline: 3px solid color-mix(in srgb, var(--tgwa-brand) 50%, transparent);
      outline-offset: 2px;
    }
    .tgwa-inline svg { width: 22px; height: 22px; fill: #FFFFFF; flex-shrink: 0; }
    .tgwa-inline-meta { display: flex; flex-direction: column; align-items: flex-start; line-height: 1.2; }
    .tgwa-inline-meta-sub { font-size: 11px; opacity: 0.85; font-weight: 500; }

    .tgwa-inline-card {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 14px 16px;
      background: var(--tgwa-card);
      border: 1px solid var(--tgwa-border);
      border-radius: 14px;
      max-width: 420px;
    }
    .tgwa-inline-card-photo {
      width: 48px; height: 48px;
      border-radius: 50%;
      background: var(--tgwa-brand);
      color: #FFFFFF;
      display: flex; align-items: center; justify-content: center;
      font-weight: 700; font-size: 16px;
      flex-shrink: 0;
      overflow: hidden;
      position: relative;
    }
    .tgwa-inline-card-photo img { width: 100%; height: 100%; object-fit: cover; }
    .tgwa-inline-card-meta { flex: 1; min-width: 0; }
    .tgwa-inline-card-meta-name { font-size: 14px; font-weight: 600; color: var(--tgwa-text); line-height: 1.2; }
    .tgwa-inline-card-meta-role { font-size: 12px; color: var(--tgwa-sub); margin-top: 2px; }
    .tgwa-inline-card-meta-status {
      font-size: 11px;
      color: #22C55E;
      margin-top: 4px;
      display: flex; align-items: center; gap: 4px;
    }
    .tgwa-inline-card-meta-status::before {
      content: ''; width: 6px; height: 6px; border-radius: 50%; background: #22C55E;
    }
    .tgwa-inline-card-meta-status[data-state="offline"] { color: var(--tgwa-muted); }
    .tgwa-inline-card-meta-status[data-state="offline"]::before { background: var(--tgwa-muted); }
    .tgwa-inline-card-cta {
      background: var(--tgwa-brand);
      color: #FFFFFF;
      border-radius: 999px;
      padding: 8px 14px;
      font-size: 13px;
      font-weight: 600;
      text-decoration: none;
      transition: background 150ms ease;
      display: inline-flex; align-items: center; gap: 6px;
      flex-shrink: 0;
    }
    .tgwa-inline-card-cta:hover { background: var(--tgwa-brand-dark); }
    .tgwa-inline-card-cta svg { width: 14px; height: 14px; fill: #FFFFFF; }

    /* ========== VERTICAL TAB LAYOUT ========== */
    /* A slim tall pill stuck to the side of the viewport, vertically centred.
       The tab itself is a fixed element; the panel pops out from the inside edge.
       Best paired with middle-left or middle-right positions. */
    .tgwa-vertical {
      position: fixed;
      z-index: 9000;
      top: 50%;
      transform: translateY(-50%);
      pointer-events: none;
      display: flex;
      align-items: center;
    }
    .tgwa-vertical[data-side="right"] { right: 0; flex-direction: row-reverse; }
    .tgwa-vertical[data-side="left"]  { left: 0;  flex-direction: row; }

    .tgwa-vertical > * { pointer-events: auto; }

    .tgwa-tab {
      background: var(--tgwa-brand);
      color: #FFFFFF;
      border: none;
      cursor: pointer;
      padding: 18px 12px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 10px;
      box-shadow: -4px 0 14px rgba(15, 23, 42, 0.12);
      transition: padding 220ms cubic-bezier(.2,.8,.2,1), background 150ms ease;
      font-family: inherit;
      position: relative;
    }
    .tgwa-vertical[data-side="right"] .tgwa-tab {
      border-radius: 14px 0 0 14px;
      box-shadow: -4px 0 14px rgba(15, 23, 42, 0.12);
    }
    .tgwa-vertical[data-side="left"] .tgwa-tab {
      border-radius: 0 14px 14px 0;
      box-shadow: 4px 0 14px rgba(15, 23, 42, 0.12);
    }
    .tgwa-tab:hover { padding-left: 16px; padding-right: 16px; background: var(--tgwa-brand-dark); }
    .tgwa-tab:focus-visible {
      outline: 3px solid color-mix(in srgb, var(--tgwa-brand) 50%, transparent);
      outline-offset: -3px;
    }
    .tgwa-tab svg { width: 22px; height: 22px; fill: currentColor; }

    .tgwa-tab-label {
      writing-mode: vertical-rl;
      text-orientation: mixed;
      font-weight: 600;
      font-size: 13px;
      letter-spacing: 0.02em;
      white-space: nowrap;
    }
    /* On the left side, flip the text so it reads bottom-to-top (more natural) */
    .tgwa-vertical[data-side="left"] .tgwa-tab-label {
      writing-mode: vertical-lr;
      transform: rotate(180deg);
    }

    .tgwa-tab .tgwa-dot {
      position: absolute;
      top: 6px; right: 6px;
      width: 10px; height: 10px;
      border-radius: 50%;
      background: #22C55E;
      border: 2px solid var(--tgwa-brand);
    }
    .tgwa-tab .tgwa-dot[data-state="offline"] { background: #94A3B8; }

    /* Pulse on the tab — softer than the FAB */
    .tgwa-tab[data-pulse="true"]::before {
      content: '';
      position: absolute;
      inset: 0;
      background: var(--tgwa-brand);
      opacity: 0.35;
      animation: tgwa-pulse-tab 2.4s ease-out infinite;
      z-index: -1;
    }
    .tgwa-vertical[data-side="right"] .tgwa-tab[data-pulse="true"]::before { border-radius: 14px 0 0 14px; }
    .tgwa-vertical[data-side="left"]  .tgwa-tab[data-pulse="true"]::before { border-radius: 0 14px 14px 0; }
    @keyframes tgwa-pulse-tab {
      0%   { transform: translateX(0);    opacity: 0.35; }
      80%  { transform: translateX(0);    opacity: 0; }
      100% { transform: translateX(0);    opacity: 0; }
    }

    /* Panel: pops out from the inside edge of the tab */
    .tgwa-vertical .tgwa-panel {
      position: relative;
      margin: 0 8px;
      transform-origin: center;
    }
    .tgwa-vertical[data-side="right"] .tgwa-panel { transform-origin: center right; }
    .tgwa-vertical[data-side="left"]  .tgwa-panel { transform-origin: center left; }

    /* ========== Responsive ========== */
    @media (max-width: 480px) {
      .tgwa-floating[data-position="bottom-right"]  { right: 14px; bottom: 14px; }
      .tgwa-floating[data-position="bottom-left"]   { left: 14px;  bottom: 14px; }
      .tgwa-floating[data-position="top-right"]     { right: 14px; top: 14px; }
      .tgwa-floating[data-position="top-left"]      { left: 14px;  top: 14px; }
      .tgwa-floating[data-position="middle-right"]  { right: 14px; }
      .tgwa-floating[data-position="middle-left"]   { left: 14px; }
      .tgwa-panel { width: calc(100vw - 28px); max-width: 360px; }
      .tgwa-greeting { max-width: 220px; }
      /* Vertical tab: shrink padding on mobile */
      .tgwa-tab { padding: 14px 10px; }
      .tgwa-tab-label { font-size: 12px; }
    }

    @media (prefers-reduced-motion: reduce) {
      .tgwa-fab, .tgwa-cta, .tgwa-inline, .tgwa-inline-card-cta, .tgwa-greeting, .tgwa-panel, .tgwa-bubble, .tgwa-agent, .tgwa-tab {
        transition: none !important;
        animation: none !important;
      }
      .tgwa-fab[data-pulse="true"]::before, .tgwa-tab[data-pulse="true"]::before { animation: none !important; opacity: 0; }
      .tgwa-fab:hover, .tgwa-cta:hover, .tgwa-inline:hover, .tgwa-agent:hover, .tgwa-tab:hover { transform: none; padding: 18px 12px; }
    }
  `;

  // ---------- Widget Class ----------
  class TGWhatsAppWidget {
    constructor(container, config) {
      this.el = container;
      this.c = this._defaults(config);
      this.shadow = container.attachShadow({ mode: 'open' });
      this._open = false;
      this._greetingDismissed = false;
      this._greetingTimer = null;
      this._render();
    }

    _defaults(c) {
      const cfg = c || {};
      const agentsRaw = Array.isArray(cfg.agents) ? cfg.agents : [];
      const agents = agentsRaw.map(a => ({
        name: typeof a.name === 'string' ? a.name : '',
        role: typeof a.role === 'string' ? a.role : '',
        phone: typeof a.phone === 'string' ? a.phone : '',
        photo: typeof a.photo === 'string' ? a.photo : '',
        online: a.online !== false,
      })).filter(a => a.phone);

      // Single-agent fallback if no agents array provided
      const fallbackPhone = typeof cfg.phone === 'string' ? cfg.phone : '';
      if (!agents.length && fallbackPhone) {
        agents.push({
          name: cfg.name || 'Travel Team',
          role: cfg.role || 'Online now',
          phone: fallbackPhone,
          photo: cfg.photo || '',
          online: cfg.online !== false,
        });
      }

      const validLayouts = ['floating', 'inline', 'card', 'vertical'];
      const validPositions = ['bottom-right', 'bottom-left', 'top-right', 'top-left', 'middle-right', 'middle-left'];
      // Backwards compat: cfg.corner is the old name for cfg.position
      const requestedPosition = cfg.position || cfg.corner || 'bottom-right';

      return {
        layout: validLayouts.includes(cfg.layout) ? cfg.layout : 'floating',
        // For vertical layout we only allow middle-left or middle-right; default middle-right
        position: cfg.layout === 'vertical'
          ? (requestedPosition === 'middle-left' ? 'middle-left' : 'middle-right')
          : (validPositions.includes(requestedPosition) ? requestedPosition : 'bottom-right'),
        mode: cfg.mode === 'multi' ? 'multi' : 'single',          // single | multi
        agents: agents,

        // Single-mode shortcut fields
        phone: fallbackPhone,
        name: cfg.name || 'Travel Team',
        role: cfg.role || 'Online now',
        photo: cfg.photo || '',
        online: cfg.online !== false,

        // Pre-filled message
        message: typeof cfg.message === 'string' ? cfg.message : 'Hi! I have a question about your travel services.',
        appendPageUrl: cfg.appendPageUrl !== false,

        // Header content (panel)
        headerTitle: cfg.headerTitle || 'Chat with us on WhatsApp',
        headerSubtitle: cfg.headerSubtitle || 'Typically replies in a few minutes',

        // Bubble (panel) — first message agent says
        chatIntro: cfg.chatIntro || 'Hi there! 👋 How can we help with your next trip?',

        // CTA label
        ctaLabel: cfg.ctaLabel || 'Start chat',

        // Vertical tab label (used when layout='vertical')
        tabLabel: cfg.tabLabel || 'Chat with us',

        // Inline label
        inlineLabel: cfg.inlineLabel || 'Chat on WhatsApp',
        inlineSubLabel: cfg.inlineSubLabel || 'Typically replies in a few minutes',

        // Greeting bubble (floating)
        greetingEnabled: cfg.greetingEnabled === true,
        greetingText: cfg.greetingText || 'Need help finding your perfect trip?',
        greetingDelay: Number.isFinite(Number(cfg.greetingDelay)) ? Number(cfg.greetingDelay) : 8,

        // Pulse animation on the fab
        pulse: cfg.pulse !== false,

        // Office hours
        hoursEnabled: cfg.hoursEnabled === true,
        hours: cfg.hours || {
          mon: [['09:00', '17:30']],
          tue: [['09:00', '17:30']],
          wed: [['09:00', '17:30']],
          thu: [['09:00', '17:30']],
          fri: [['09:00', '17:30']],
          sat: [],
          sun: [],
        },
        offlineMessage: cfg.offlineMessage || 'We\'re closed at the moment. Leave a message and we\'ll get back to you when we\'re open.',
        hideWhenClosed: cfg.hideWhenClosed === true,

        // Tracking
        trackClicks: cfg.trackClicks !== false,
        widgetId: cfg.widgetId || cfg._id || '',

        // Theme
        fontFamily: typeof cfg.fontFamily === 'string' ? cfg.fontFamily : '',
        theme: {
          mode: cfg.theme && cfg.theme.mode === 'dark' ? 'dark' : 'light',
          brand: (cfg.theme && cfg.theme.brand) || '#25D366',
          brandDark: (cfg.theme && cfg.theme.brandDark) || '#128C7E',
          radius: cfg.theme && Number.isFinite(Number(cfg.theme.radius)) ? Number(cfg.theme.radius) : 16,
        },
      };
    }

    _themeStyle() {
      const t = this.c.theme;
      const parts = [];
      if (t.brand) parts.push(`--tgwa-brand:${t.brand}`);
      if (t.brandDark) parts.push(`--tgwa-brand-dark:${t.brandDark}`);
      if (Number.isFinite(t.radius)) parts.push(`--tgwa-radius:${t.radius}px`);
      if (this.c.fontFamily && typeof this.c.fontFamily === 'string') {
        const safe = this.c.fontFamily.replace(/'/g, '');
        parts.push(`font-family:'${safe}', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`);
      }
      return parts.join(';');
    }

    _hoursStatus() {
      if (!this.c.hoursEnabled) return { open: true, nextOpen: null };
      return evalOfficeHours(this.c.hours, new Date());
    }

    _ctx() {
      let url = (typeof location !== 'undefined') ? location.href : '';
      let title = '';
      try {
        title = getOg('title') || (typeof document !== 'undefined' ? document.title : '') || '';
      } catch (e) {}
      let site = '';
      try {
        site = getOg('site_name') || (typeof location !== 'undefined' ? location.hostname : '') || '';
      } catch (e) {}
      return { url, title, site };
    }

    _composedMessage() {
      const ctx = this._ctx();
      let msg = expandTokens(this.c.message, ctx);
      if (this.c.appendPageUrl && ctx.url && msg.indexOf(ctx.url) === -1) {
        msg = (msg ? msg + '\n\n' : '') + 'Page: ' + ctx.url;
      }
      return msg;
    }

    _waLink(phone) {
      return buildWaLink(phone, this._composedMessage());
    }

    _initials(name) {
      if (!name) return '';
      const parts = String(name).trim().split(/\s+/).filter(Boolean);
      if (!parts.length) return '';
      if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }

    _renderAgentPhoto(agent, size, showOnlineDot) {
      const sz = size || 38;
      if (agent.photo) {
        const url = safeImageUrl(agent.photo);
        return `<div class="tgwa-agent-photo" data-online="${!!showOnlineDot && agent.online}" style="width:${sz}px;height:${sz}px"><img src="${esc(url)}" alt="${esc(agent.name || '')}" loading="lazy" decoding="async" /></div>`;
      }
      return `<div class="tgwa-agent-photo" data-online="${!!showOnlineDot && agent.online}" style="width:${sz}px;height:${sz}px;font-size:${Math.round(sz * 0.36)}px">${esc(this._initials(agent.name))}</div>`;
    }

    _render() {
      const cfg = this.c;
      const status = this._hoursStatus();
      const themeStyle = this._themeStyle();

      // Hide floating/vertical widget entirely when closed and hideWhenClosed is on
      const isFloatingType = cfg.layout === 'floating' || cfg.layout === 'vertical';
      if (isFloatingType && cfg.hoursEnabled && !status.open && cfg.hideWhenClosed) {
        this.shadow.innerHTML = `<style>${STYLES}</style><div class="tgwa-root" data-theme="${cfg.theme.mode}" style="${themeStyle}"></div>`;
        return;
      }

      let inner = '';
      if (cfg.layout === 'inline') inner = this._renderInline(status);
      else if (cfg.layout === 'card') inner = this._renderInlineCard(status);
      else if (cfg.layout === 'vertical') inner = this._renderVertical(status);
      else inner = this._renderFloating(status);

      this.shadow.innerHTML = `
        <style>${STYLES}</style>
        <div class="tgwa-root" data-theme="${cfg.theme.mode}" style="${themeStyle}">
          ${inner}
        </div>
      `;
      this._bind();
      if (cfg.layout === 'floating' && cfg.greetingEnabled && !this._greetingDismissed) {
        this._scheduleGreeting();
      }
    }

    _renderFloating(status) {
      const cfg = this.c;
      const isOpen = this._open;
      const isMulti = cfg.mode === 'multi' && cfg.agents.length > 1;
      const greeting = (cfg.greetingEnabled && !this._greetingDismissed && !isOpen)
        ? `
          <div class="tgwa-greeting" data-show="false" id="greeting">
            ${esc(cfg.greetingText)}
            <button class="tgwa-greeting-close" type="button" id="greetingClose" aria-label="Dismiss">
              ${svg('close', 12)}
            </button>
          </div>
        `
        : '';

      return `
        <div class="tgwa-floating" data-position="${esc(cfg.position)}">
          ${greeting}
          <div class="tgwa-panel" data-open="${isOpen}" id="panel" role="dialog" aria-label="WhatsApp chat">
            ${this._renderPanelHead(status)}
            <div class="tgwa-panel-body">
              ${this._renderPanelBody(status, isMulti)}
            </div>
            ${this._renderPanelFoot(status, isMulti)}
          </div>
          <button class="tgwa-fab" type="button" id="fab" data-pulse="${cfg.pulse}" aria-label="${esc(cfg.headerTitle)}" aria-expanded="${isOpen}">
            ${svg('whatsapp', 30)}
            <span class="tgwa-dot" data-state="${status.open ? 'online' : 'offline'}"></span>
          </button>
        </div>
      `;
    }

    _renderVertical(status) {
      const cfg = this.c;
      const isOpen = this._open;
      const isMulti = cfg.mode === 'multi' && cfg.agents.length > 1;
      // Vertical only supports middle-left or middle-right; map position → side
      const side = cfg.position === 'middle-left' ? 'left' : 'right';
      const tabLabel = cfg.tabLabel || 'Chat with us';

      return `
        <div class="tgwa-vertical" data-side="${side}">
          ${isOpen ? `
            <div class="tgwa-panel" data-open="true" id="panel" role="dialog" aria-label="WhatsApp chat">
              ${this._renderPanelHead(status)}
              <div class="tgwa-panel-body">
                ${this._renderPanelBody(status, isMulti)}
              </div>
              ${this._renderPanelFoot(status, isMulti)}
            </div>
          ` : ''}
          <button class="tgwa-tab" type="button" id="fab" data-pulse="${cfg.pulse && !isOpen}" aria-label="${esc(cfg.headerTitle)}" aria-expanded="${isOpen}">
            ${svg('whatsapp', 22)}
            <span class="tgwa-tab-label">${esc(tabLabel)}</span>
            <span class="tgwa-dot" data-state="${status.open ? 'online' : 'offline'}"></span>
          </button>
        </div>
      `;
    }

    _renderPanelHead(status) {
      const cfg = this.c;
      const sub = (cfg.hoursEnabled && !status.open)
        ? (status.nextOpen ? 'Back online ' + status.nextOpen : 'Currently offline')
        : cfg.headerSubtitle;
      return `
        <div class="tgwa-panel-head">
          <div class="tgwa-panel-head-icon">${svg('whatsapp', 22)}</div>
          <div class="tgwa-panel-head-meta">
            <div class="tgwa-panel-head-title">${esc(cfg.headerTitle)}</div>
            <div class="tgwa-panel-head-status" data-state="${status.open ? 'online' : 'offline'}">${esc(sub)}</div>
          </div>
          <button class="tgwa-panel-head-close" type="button" id="panelClose" aria-label="Close">
            ${svg('close', 18)}
          </button>
        </div>
      `;
    }

    _renderPanelBody(status, isMulti) {
      const cfg = this.c;
      const intro = `
        <div class="tgwa-bubble-meta">${esc(cfg.headerTitle)}</div>
        <div class="tgwa-bubble">${esc(cfg.chatIntro)}</div>
      `;
      const offline = (cfg.hoursEnabled && !status.open)
        ? `<div class="tgwa-out-of-hours">${esc(cfg.offlineMessage)}${status.nextOpen ? ` We're back ${esc(status.nextOpen)}.` : ''}</div>`
        : '';

      if (isMulti) {
        const link = (this._composedMessage());
        const rows = cfg.agents.map((a, i) => `
          <a class="tgwa-agent" href="${esc(this._waLink(a.phone))}" target="_blank" rel="noopener noreferrer" data-platform="whatsapp" data-agent-index="${i}">
            ${this._renderAgentPhoto(a, 38, true)}
            <div class="tgwa-agent-meta">
              <div class="tgwa-agent-name">${esc(a.name || 'Travel Specialist')}</div>
              <div class="tgwa-agent-role">${esc(a.role || (a.online ? 'Online' : 'Reply later'))}</div>
            </div>
            <div class="tgwa-agent-cta">${svg('send', 14)}</div>
          </a>
        `).join('');
        return intro + offline + `<div class="tgwa-agents">${rows}</div>`;
      }
      return intro + offline;
    }

    _renderPanelFoot(status, isMulti) {
      if (isMulti) return '';
      const cfg = this.c;
      const phone = (cfg.agents[0] && cfg.agents[0].phone) || cfg.phone;
      const isOffline = cfg.hoursEnabled && !status.open;
      const link = isOffline ? '#' : this._waLink(phone);
      return `
        <div class="tgwa-panel-foot">
          <a class="tgwa-cta" href="${esc(link)}" target="_blank" rel="noopener noreferrer" data-platform="whatsapp" data-disabled="${isOffline}">
            ${svg('whatsapp', 18)}
            <span>${esc(isOffline ? 'Currently offline' : cfg.ctaLabel)}</span>
          </a>
          <div class="tgwa-fineprint">Opens in WhatsApp · End-to-end encrypted</div>
        </div>
      `;
    }

    _renderInline(status) {
      const cfg = this.c;
      const phone = (cfg.agents[0] && cfg.agents[0].phone) || cfg.phone;
      const isOffline = cfg.hoursEnabled && !status.open;
      const link = isOffline ? '#' : this._waLink(phone);
      const subLabel = isOffline
        ? (status.nextOpen ? 'Back online ' + status.nextOpen : 'Currently offline')
        : cfg.inlineSubLabel;
      return `
        <a class="tgwa-inline" href="${esc(link)}" target="_blank" rel="noopener noreferrer" data-platform="whatsapp" data-disabled="${isOffline}">
          ${svg('whatsapp', 22)}
          <span class="tgwa-inline-meta">
            <span>${esc(cfg.inlineLabel)}</span>
            <span class="tgwa-inline-meta-sub">${esc(subLabel)}</span>
          </span>
        </a>
      `;
    }

    _renderInlineCard(status) {
      const cfg = this.c;
      const agent = cfg.agents[0] || { name: cfg.name, role: cfg.role, phone: cfg.phone, photo: cfg.photo, online: cfg.online };
      const isOffline = cfg.hoursEnabled && !status.open;
      const link = isOffline ? '#' : this._waLink(agent.phone);
      return `
        <div class="tgwa-inline-card">
          ${this._renderAgentPhoto(agent, 48, !isOffline && agent.online)}
          <div class="tgwa-inline-card-meta">
            <div class="tgwa-inline-card-meta-name">${esc(agent.name || 'Travel Team')}</div>
            <div class="tgwa-inline-card-meta-role">${esc(agent.role || '')}</div>
            <div class="tgwa-inline-card-meta-status" data-state="${isOffline ? 'offline' : 'online'}">${isOffline ? 'Reply when we\'re back' : 'Reply within minutes'}</div>
          </div>
          <a class="tgwa-inline-card-cta" href="${esc(link)}" target="_blank" rel="noopener noreferrer" data-platform="whatsapp" data-disabled="${isOffline}">
            ${svg('whatsapp', 14)}
            <span>${esc(isOffline ? 'Closed' : 'Chat')}</span>
          </a>
        </div>
      `;
    }

    _bind() {
      const root = this.shadow.querySelector('.tgwa-root');
      if (!root) return;

      // Floating: FAB + close + greeting close + click-through
      const fab = this.shadow.querySelector('#fab');
      const panel = this.shadow.querySelector('#panel');
      const closeBtn = this.shadow.querySelector('#panelClose');
      const greetingClose = this.shadow.querySelector('#greetingClose');
      const greeting = this.shadow.querySelector('#greeting');

      // Debug: log binding state to help diagnose click issues
      if (window.__TG_WHATSAPP_DEBUG__) {
        console.log('[TG WhatsApp] bind:', {
          fab: !!fab,
          panel: !!panel,
          layout: this.c.layout,
          position: this.c.position,
        });
      }

      if (fab) {
        const handler = (e) => {
          e.stopPropagation();
          this._open = !this._open;
          if (window.__TG_WHATSAPP_DEBUG__) {
            console.log('[TG WhatsApp] FAB clicked, _open =', this._open);
          }
          if (panel) panel.setAttribute('data-open', String(this._open));
          fab.setAttribute('aria-expanded', String(this._open));
          if (this._open && greeting) {
            greeting.setAttribute('data-show', 'false');
          }
          // Vertical layout needs a re-render because the panel renders conditionally
          if (this.c.layout === 'vertical') this._render();
        };
        fab.addEventListener('click', handler);
      }
      if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this._open = false;
          if (window.__TG_WHATSAPP_DEBUG__) {
            console.log('[TG WhatsApp] close button clicked');
          }
          // Vertical layout renders the panel conditionally — full re-render so the tab returns
          if (this.c.layout === 'vertical') {
            this._render();
          } else {
            if (panel) panel.setAttribute('data-open', 'false');
            if (fab) fab.setAttribute('aria-expanded', 'false');
          }
        });
      }
      if (greetingClose && greeting) {
        greetingClose.addEventListener('click', (e) => {
          e.stopPropagation();
          this._greetingDismissed = true;
          greeting.setAttribute('data-show', 'false');
        });
        // Click greeting body itself opens the panel
        greeting.addEventListener('click', (e) => {
          if (e.target === greetingClose || greetingClose.contains(e.target)) return;
          if (fab) fab.click();
        });
      }

      // Track clicks on any WhatsApp link
      this.shadow.querySelectorAll('[data-platform="whatsapp"]').forEach(el => {
        el.addEventListener('click', (e) => {
          if (el.getAttribute('data-disabled') === 'true') {
            e.preventDefault();
            return;
          }
          const idx = el.getAttribute('data-agent-index');
          this._track(idx !== null ? Number(idx) : 0);
        });
      });
    }

    _scheduleGreeting() {
      if (this._greetingTimer) clearTimeout(this._greetingTimer);
      const delaySec = Math.max(0, Number(this.c.greetingDelay) || 0);
      this._greetingTimer = setTimeout(() => {
        const g = this.shadow.querySelector('#greeting');
        if (g && !this._open) g.setAttribute('data-show', 'true');
      }, delaySec * 1000);
    }

    _track(agentIndex) {
      if (!this.c.trackClicks || !this.c.widgetId) return;
      try {
        const body = JSON.stringify({
          widgetId: this.c.widgetId,
          agentIndex: agentIndex || 0,
          pageUrl: (typeof location !== 'undefined') ? location.href : '',
        });
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
      if (this._greetingTimer) clearTimeout(this._greetingTimer);
      this.c = this._defaults(Object.assign({}, this.c, newConfig));
      this._render();
    }

    /**
     * Programmatically open the chat panel.
     * Works for floating and vertical layouts. No-op for inline/card.
     */
    open() {
      if (this.c.layout !== 'floating' && this.c.layout !== 'vertical') return;
      if (this._open) return;
      this._open = true;
      this._greetingDismissed = true;
      // Vertical layout renders the panel conditionally so a full re-render is needed.
      // Floating keeps the panel in DOM and just toggles data-open.
      if (this.c.layout === 'vertical') {
        this._render();
      } else {
        const panel = this.shadow.querySelector('#panel');
        const fab = this.shadow.querySelector('#fab');
        const greeting = this.shadow.querySelector('#greeting');
        if (panel) panel.setAttribute('data-open', 'true');
        if (fab) fab.setAttribute('aria-expanded', 'true');
        if (greeting) greeting.setAttribute('data-show', 'false');
      }
    }

    close() {
      if (this.c.layout !== 'floating' && this.c.layout !== 'vertical') return;
      if (!this._open) return;
      this._open = false;
      if (this.c.layout === 'vertical') {
        this._render();
      } else {
        const panel = this.shadow.querySelector('#panel');
        const fab = this.shadow.querySelector('#fab');
        if (panel) panel.setAttribute('data-open', 'false');
        if (fab) fab.setAttribute('aria-expanded', 'false');
      }
    }

    toggle() {
      this._open ? this.close() : this.open();
    }

    /** Inspect current open state — handy for tests/demos. */
    isOpen() { return !!this._open; }

    destroy() {
      if (this._greetingTimer) clearTimeout(this._greetingTimer);
      this.shadow.innerHTML = '';
    }
  }

  // ---------- Auto-initializer ----------
  async function init() {
    const containers = document.querySelectorAll('[data-tg-widget="whatsapp"]');
    for (const el of containers) {
      if (el.__tgInited) continue;
      el.__tgInited = true;

      const inline = el.getAttribute('data-tg-config');
      if (inline) {
        try {
          const cfg = JSON.parse(inline);
          new TGWhatsAppWidget(el, cfg);
          continue;
        } catch (e) {
          console.warn('[TG WhatsApp] invalid data-tg-config', e);
        }
      }

      const id = el.getAttribute('data-tg-id');
      if (id) {
        try {
          const url = `${API_BASE}?id=${encodeURIComponent(id)}`;
          const res = await fetch(url);
          if (!res.ok) throw new Error('Config load failed');
          const data = await res.json();
          const cfg = (data && data.config) ? Object.assign({}, data.config, { widgetId: id }) : { widgetId: id };
          new TGWhatsAppWidget(el, cfg);
        } catch (e) {
          console.warn('[TG WhatsApp] remote config error', e);
          el.textContent = '';
        }
      }
    }
  }

  // Expose
  window.TGWhatsAppWidget = TGWhatsAppWidget;
  window.__TG_WHATSAPP_VERSION__ = VERSION;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
