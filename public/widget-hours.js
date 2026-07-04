/**
 * Travelgenix Opening Hours Widget v1.0.0
 * Self-contained, embeddable widget
 * Zero dependencies — works on any website via a single script tag
 *
 * Usage:
 *   <div data-tg-widget="hours" data-tg-id="YOUR_WIDGET_ID"></div>
 *   <script src="https://tg-widgets.vercel.app/widget-hours.js"></script>
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
        if (/\/widget\-hours\.js(\?|$|#)/.test(s)) {
          return new URL(s).origin + '/api/widget-config';
        }
      }
    } catch (e) { /* fall through */ }
    return '/api/widget-config';
  }

  const API_BASE = resolveApiBase();
  const VERSION = '1.0.4';

  // ─── i18n ───────────────────────────────────────────────────
  // Fixed UI chrome only (day names, status words, opening-time phrases). The
  // author-set title and timezone note are author content with a localised
  // default. English is the source + fallback.
  const MESSAGES = {
    en: {
      mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday',
      monShort: 'Mon', tueShort: 'Tue', wedShort: 'Wed', thuShort: 'Thu', friShort: 'Fri', satShort: 'Sat', sunShort: 'Sun',
      openNow: 'Open now', closed: 'Closed', closedToday: 'Closed today', open24: 'Open 24 hours',
      hours: 'Hours', openingHours: 'Opening hours', holiday: 'Holiday', tomorrow: 'tomorrow',
      openUntil: 'Open until {time}', opensTodayAt: 'Opens today at {time}', opensDayAt: 'Opens {day} at {time}',
    },
    fr: {
      mon: 'Lundi', tue: 'Mardi', wed: 'Mercredi', thu: 'Jeudi', fri: 'Vendredi', sat: 'Samedi', sun: 'Dimanche',
      monShort: 'Lun', tueShort: 'Mar', wedShort: 'Mer', thuShort: 'Jeu', friShort: 'Ven', satShort: 'Sam', sunShort: 'Dim',
      openNow: 'Ouvert', closed: 'Fermé', closedToday: 'Fermé aujourd\'hui', open24: 'Ouvert 24h/24',
      hours: 'Horaires', openingHours: 'Horaires d\'ouverture', holiday: 'Jour férié', tomorrow: 'demain',
      openUntil: 'Ouvert jusqu\'à {time}', opensTodayAt: 'Ouvre aujourd\'hui à {time}', opensDayAt: 'Ouvre {day} à {time}',
    },
    de: {
      mon: 'Montag', tue: 'Dienstag', wed: 'Mittwoch', thu: 'Donnerstag', fri: 'Freitag', sat: 'Samstag', sun: 'Sonntag',
      monShort: 'Mo', tueShort: 'Di', wedShort: 'Mi', thuShort: 'Do', friShort: 'Fr', satShort: 'Sa', sunShort: 'So',
      openNow: 'Jetzt geöffnet', closed: 'Geschlossen', closedToday: 'Heute geschlossen', open24: '24 Stunden geöffnet',
      hours: 'Öffnungszeiten', openingHours: 'Öffnungszeiten', holiday: 'Feiertag', tomorrow: 'morgen',
      openUntil: 'Geöffnet bis {time}', opensTodayAt: 'Öffnet heute um {time}', opensDayAt: 'Öffnet {day} um {time}',
    },
    es: {
      mon: 'Lunes', tue: 'Martes', wed: 'Miércoles', thu: 'Jueves', fri: 'Viernes', sat: 'Sábado', sun: 'Domingo',
      monShort: 'Lun', tueShort: 'Mar', wedShort: 'Mié', thuShort: 'Jue', friShort: 'Vie', satShort: 'Sáb', sunShort: 'Dom',
      openNow: 'Abierto ahora', closed: 'Cerrado', closedToday: 'Cerrado hoy', open24: 'Abierto 24 horas',
      hours: 'Horario', openingHours: 'Horario de apertura', holiday: 'Festivo', tomorrow: 'mañana',
      openUntil: 'Abierto hasta las {time}', opensTodayAt: 'Abre hoy a las {time}', opensDayAt: 'Abre el {day} a las {time}',
    },
    it: {
      mon: 'Lunedì', tue: 'Martedì', wed: 'Mercoledì', thu: 'Giovedì', fri: 'Venerdì', sat: 'Sabato', sun: 'Domenica',
      monShort: 'Lun', tueShort: 'Mar', wedShort: 'Mer', thuShort: 'Gio', friShort: 'Ven', satShort: 'Sab', sunShort: 'Dom',
      openNow: 'Aperto ora', closed: 'Chiuso', closedToday: 'Chiuso oggi', open24: 'Aperto 24 ore',
      hours: 'Orari', openingHours: 'Orari di apertura', holiday: 'Festività', tomorrow: 'domani',
      openUntil: 'Aperto fino alle {time}', opensTodayAt: 'Apre oggi alle {time}', opensDayAt: 'Apre {day} alle {time}',
    },
    ro: {
      mon: 'Luni', tue: 'Marți', wed: 'Miercuri', thu: 'Joi', fri: 'Vineri', sat: 'Sâmbătă', sun: 'Duminică',
      monShort: 'Lun', tueShort: 'Mar', wedShort: 'Mie', thuShort: 'Joi', friShort: 'Vin', satShort: 'Sâm', sunShort: 'Dum',
      openNow: 'Deschis acum', closed: 'Închis', closedToday: 'Închis azi', open24: 'Deschis 24 de ore',
      hours: 'Program', openingHours: 'Program de funcționare', holiday: 'Sărbătoare', tomorrow: 'mâine',
      openUntil: 'Deschis până la {time}', opensTodayAt: 'Se deschide azi la {time}', opensDayAt: 'Se deschide {day} la {time}',
    },
  };
  // Uses the shared TGi18n core when present; otherwise an identical inline
  // resolver keeps the widget self-contained.
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

  // Config accent and font reach the root style attribute — validate at source
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

  function cleanPhone(p) {
    if (!p) return '';
    return String(p).replace(/[^\d+]/g, '');
  }

  // ---------- Time helpers ----------
  const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const DAY_LABELS_FULL = {
    sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday',
    thu: 'Thursday', fri: 'Friday', sat: 'Saturday',
  };
  const DAY_LABELS_SHORT = {
    sun: 'Sun', mon: 'Mon', tue: 'Tue', wed: 'Wed',
    thu: 'Thu', fri: 'Fri', sat: 'Sat',
  };

  function parseHHMM(s) {
    if (!s) return null;
    const m = String(s).match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const h = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
    return h * 60 + mm;
  }

  function formatTime(minutes, fmt) {
    if (minutes === null || minutes === undefined) return '';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    const mm = String(m).padStart(2, '0');
    if (fmt === '12') {
      const ampm = h >= 12 ? 'pm' : 'am';
      let h12 = h % 12;
      if (h12 === 0) h12 = 12;
      return m === 0 ? `${h12}${ampm}` : `${h12}:${mm}${ampm}`;
    }
    return `${String(h).padStart(2, '0')}:${mm}`;
  }

  function formatSlot(slot, fmt) {
    if (!Array.isArray(slot) || slot.length !== 2) return '';
    const a = parseHHMM(slot[0]);
    const b = parseHHMM(slot[1]);
    if (a === null || b === null) return '';
    return formatTime(a, fmt) + ' – ' + formatTime(b, fmt);
  }

  function formatSlots(slots, fmt) {
    if (!Array.isArray(slots) || !slots.length) return '';
    return slots.map(s => formatSlot(s, fmt)).filter(Boolean).join(', ');
  }

  // YYYY-MM-DD for the visitor's local date
  function ymd(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  // Return a Date whose LOCAL wall-clock components (year, month, day, hours,
  // minutes) equal the current time in the given IANA timezone. The whole
  // schedule engine reads getFullYear/getMonth/getDate/getDay/getHours/
  // getMinutes, so feeding it this makes "open now" evaluate in the business's
  // timezone rather than the visitor's. An empty or invalid timezone falls back
  // to the visitor's own local time — the default, feature off.
  function nowInZone(timeZone) {
    if (!timeZone || typeof timeZone !== 'string') return new Date();
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: timeZone,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      }).formatToParts(new Date());
      const get = (type) => {
        const p = parts.find(x => x.type === type);
        return p ? parseInt(p.value, 10) : 0;
      };
      let hour = get('hour');
      if (hour === 24) hour = 0; // some engines emit "24" for midnight
      return new Date(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'));
    } catch (e) {
      return new Date(); // unknown timezone name — fall back to visitor local
    }
  }

  // Look up the schedule for a given date — returns either {closed: true, label}, or {slots: [...], label}
  function scheduleForDate(d, hours, holidays) {
    const dateStr = ymd(d);
    if (Array.isArray(holidays)) {
      const match = holidays.find(h => h && h.date === dateStr);
      if (match) {
        return {
          isHoliday: true,
          label: match.label || 'Holiday',
          closed: !!match.closed || !Array.isArray(match.slots) || !match.slots.length,
          slots: Array.isArray(match.slots) ? match.slots : [],
        };
      }
    }
    const dayKey = DAY_KEYS[d.getDay()];
    const slots = (hours && Array.isArray(hours[dayKey])) ? hours[dayKey] : [];
    return { isHoliday: false, closed: !slots.length, slots };
  }

  // Build the live status: {open, nextOpen, label}
  // `t` is the i18n resolver. `nextOpen` is true when the label is a future
  // opening message (used by the render layer instead of string-comparing).
  function evalStatus(hours, holidays, now, fmt, t) {
    const tf = (fmt === '24') ? '24' : '12';
    const d = now || new Date();
    const today = scheduleForDate(d, hours, holidays);
    const minutesNow = d.getHours() * 60 + d.getMinutes();

    if (!today.closed) {
      for (const slot of today.slots) {
        const a = parseHHMM(slot[0]);
        const b = parseHHMM(slot[1]);
        if (a !== null && b !== null && minutesNow >= a && minutesNow < b) {
          return {
            open: true,
            nextOpen: false,
            closingAt: b,
            label: t('openUntil', { time: formatTime(b, tf) }),
          };
        }
      }
      // Closed right now but might open later today
      const todayLater = today.slots
        .map(s => parseHHMM(s[0]))
        .filter(m => m !== null && m > minutesNow)
        .sort((a, b) => a - b)[0];
      if (todayLater !== undefined) {
        return {
          open: false,
          nextOpen: true,
          openingAt: todayLater,
          label: t('opensTodayAt', { time: formatTime(todayLater, tf) }),
        };
      }
    }

    // Look ahead up to 7 days
    for (let i = 1; i <= 7; i++) {
      const next = new Date(d.getTime() + i * 86400000);
      const sch = scheduleForDate(next, hours, holidays);
      if (sch.closed) continue;
      const opens = sch.slots
        .map(s => parseHHMM(s[0]))
        .filter(m => m !== null)
        .sort((a, b) => a - b)[0];
      if (opens === undefined) continue;
      const isTomorrow = i === 1;
      const dayLabel = isTomorrow ? t('tomorrow') : t(DAY_KEYS[next.getDay()]);
      return {
        open: false,
        nextOpen: true,
        openingAt: opens,
        nextDayOffset: i,
        label: t('opensDayAt', { day: dayLabel, time: formatTime(opens, tf) }),
      };
    }

    return { open: false, nextOpen: false, label: t('closed') };
  }

  // ---------- Icons ----------
  const ICONS = {
    clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
    chevron: '<polyline points="6 9 12 15 18 9"/>',
  };
  function svg(name, size) {
    const s = size || 16;
    return `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  }

  // ---------- Styles ----------
  const STYLES = `
    :host { all: initial; display: block; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    *, *::before, *::after { box-sizing: border-box; }

    .tgho-root {
      --tgho-bg: #FFFFFF;
      --tgho-card: #FFFFFF;
      --tgho-text: #0F172A;
      --tgho-text-2: #475569;
      --tgho-sub: #64748B;
      --tgho-muted: #94A3B8;
      --tgho-border: #E5E7EB;
      --tgho-border-light: #F1F5F9;
      --tgho-row-bg: #F8FAFC;
      --tgho-accent: #1B2B5B;
      --tgho-open: #16A34A;
      --tgho-open-bg: #DCFCE7;
      --tgho-closed: #DC2626;
      --tgho-closed-bg: #FEE2E2;
      --tgho-radius: 14px;
      color: var(--tgho-text);
      font-size: 14px;
      line-height: 1.5;
    }

    .tgho-root[data-theme="dark"] {
      --tgho-bg: #0F172A;
      --tgho-card: #1E293B;
      --tgho-text: #F1F5F9;
      --tgho-text-2: #CBD5E1;
      --tgho-sub: #94A3B8;
      --tgho-muted: #64748B;
      --tgho-border: #334155;
      --tgho-border-light: #1E293B;
      --tgho-row-bg: rgba(255,255,255,0.03);
      --tgho-open-bg: rgba(34, 197, 94, 0.15);
      --tgho-closed-bg: rgba(220, 38, 38, 0.18);
    }

    /* ============== Status pill (shared) ============== */
    .tgho-status {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px 4px 9px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: -0.005em;
      line-height: 1.2;
    }
    .tgho-status[data-open="true"] {
      background: var(--tgho-open-bg);
      color: var(--tgho-open);
    }
    .tgho-status[data-open="false"] {
      background: var(--tgho-closed-bg);
      color: var(--tgho-closed);
    }
    .tgho-status-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: currentColor;
      position: relative;
      flex-shrink: 0;
    }
    .tgho-status[data-open="true"] .tgho-status-dot::after {
      content: '';
      position: absolute;
      inset: -3px;
      border-radius: 50%;
      background: currentColor;
      opacity: 0.4;
      animation: tgho-pulse 2s ease-out infinite;
      z-index: -1;
    }
    @keyframes tgho-pulse {
      0%   { transform: scale(0.6); opacity: 0.5; }
      80%  { transform: scale(1.6); opacity: 0; }
      100% { transform: scale(1.6); opacity: 0; }
    }

    /* ============== CARD layout ============== */
    .tgho-card {
      background: var(--tgho-card);
      border: 1px solid var(--tgho-border);
      border-radius: var(--tgho-radius);
      padding: 18px 20px;
      max-width: 380px;
    }
    .tgho-card-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 14px;
    }
    .tgho-card-title {
      font-size: 15px;
      font-weight: 700;
      letter-spacing: -0.01em;
      color: var(--tgho-text);
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .tgho-card-title svg { color: var(--tgho-muted); flex-shrink: 0; }

    /* ============== LIST layout ============== */
    .tgho-list {
      max-width: 380px;
    }
    .tgho-list-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 10px;
      padding-bottom: 10px;
      border-bottom: 1px solid var(--tgho-border-light);
    }
    .tgho-list-title {
      font-size: 13px;
      font-weight: 600;
      color: var(--tgho-text);
      letter-spacing: -0.005em;
    }

    /* ============== Day rows (shared by card and list) ============== */
    .tgho-rows {
      display: flex;
      flex-direction: column;
    }
    .tgho-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 8px 0;
      border-bottom: 1px solid var(--tgho-border-light);
      font-size: 14px;
    }
    .tgho-row:last-child { border-bottom: none; }
    .tgho-row[data-today="true"] {
      font-weight: 700;
      color: var(--tgho-text);
    }
    .tgho-row[data-today="true"] .tgho-row-time {
      color: var(--tgho-text);
    }
    .tgho-row-day {
      color: var(--tgho-text-2);
      letter-spacing: -0.005em;
    }
    .tgho-row-time {
      color: var(--tgho-sub);
      font-variant-numeric: tabular-nums;
      font-size: 13px;
    }
    .tgho-row-time[data-closed="true"] {
      color: var(--tgho-muted);
      font-style: italic;
    }
    .tgho-row[data-today="true"] .tgho-row-time[data-closed="true"] {
      color: var(--tgho-closed);
      font-style: normal;
    }
    .tgho-row-holiday {
      display: inline-block;
      font-size: 11px;
      font-weight: 500;
      color: var(--tgho-muted);
      margin-left: 6px;
      letter-spacing: -0.005em;
    }

    /* ============== Footer (phone, timezone) ============== */
    .tgho-foot {
      margin-top: 14px;
      padding-top: 12px;
      border-top: 1px solid var(--tgho-border-light);
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .tgho-phone {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      font-weight: 600;
      color: var(--tgho-accent);
      text-decoration: none;
      letter-spacing: -0.005em;
      transition: color 0.15s ease;
    }
    .tgho-phone:hover {
      color: var(--tgho-text);
      text-decoration: underline;
    }
    .tgho-phone svg { color: var(--tgho-muted); flex-shrink: 0; }
    .tgho-tz {
      font-size: 11px;
      color: var(--tgho-muted);
    }

    /* ============== COMPACT layout ============== */
    .tgho-compact {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      letter-spacing: -0.005em;
    }
    .tgho-compact-label {
      color: var(--tgho-sub);
      font-weight: 500;
    }
    .tgho-compact-status {
      font-weight: 600;
      color: var(--tgho-text);
    }
    .tgho-compact-status[data-open="true"] { color: var(--tgho-open); }
    .tgho-compact-status[data-open="false"] { color: var(--tgho-closed); }

    .tgho-compact-pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 12px 6px 10px;
      background: var(--tgho-card);
      border: 1px solid var(--tgho-border);
      border-radius: 999px;
      font-size: 13px;
      letter-spacing: -0.005em;
    }

    /* ============== Expandable compact pill ============== */
    .tgho-compact-wrap {
      position: relative;
      display: inline-block;
    }
    .tgho-compact-pill-trigger {
      appearance: none;
      cursor: pointer;
      font-family: inherit;
      color: inherit;
      transition: background 150ms ease, border-color 150ms ease, transform 150ms ease;
    }
    .tgho-compact-pill-trigger:hover {
      background: var(--tgho-row-bg);
      border-color: var(--tgho-muted);
    }
    .tgho-compact-pill-trigger:focus-visible {
      outline: 3px solid color-mix(in srgb, var(--tgho-accent) 40%, transparent);
      outline-offset: 2px;
    }
    .tgho-compact-pill-trigger:active {
      transform: scale(0.98);
    }
    .tgho-compact-chev {
      color: var(--tgho-sub);
      transition: transform 200ms cubic-bezier(.2,.8,.2,1);
      margin-left: 2px;
      flex-shrink: 0;
    }
    .tgho-compact-wrap[data-panel-open="true"] .tgho-compact-chev {
      transform: rotate(180deg);
    }

    .tgho-compact-panel {
      position: absolute;
      top: calc(100% + 8px);
      left: 0;
      width: 320px;
      max-width: calc(100vw - 32px);
      background: var(--tgho-card);
      border: 1px solid var(--tgho-border);
      border-radius: var(--tgho-radius);
      box-shadow: 0 12px 32px -8px rgba(15, 23, 42, 0.18), 0 4px 12px -4px rgba(15, 23, 42, 0.08);
      padding: 16px;
      opacity: 0;
      visibility: hidden;
      transform: translateY(-4px);
      pointer-events: none;
      transition: opacity 200ms ease, transform 220ms cubic-bezier(.2,.8,.2,1), visibility 0ms linear 220ms;
      z-index: 100;
    }
    .tgho-compact-panel[data-open="true"] {
      opacity: 1;
      visibility: visible;
      transform: translateY(0);
      pointer-events: auto;
      transition: opacity 200ms ease, transform 220ms cubic-bezier(.2,.8,.2,1), visibility 0ms linear 0ms;
    }
    .tgho-compact-panel-next {
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px solid var(--tgho-border);
      font-size: 12px;
      color: var(--tgho-sub);
      font-weight: 500;
      letter-spacing: -0.005em;
    }
    /* If the foot is rendered, the next-open line shouldn't have the bottom-border-of-rows look */
    .tgho-compact-panel .tgho-foot {
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px solid var(--tgho-border);
    }
    .tgho-compact-panel-next + .tgho-foot {
      margin-top: 8px;
      padding-top: 8px;
      border-top: none;
    }

    /* On the right edge of the viewport, flip the panel to the right side */
    .tgho-compact-wrap[data-align="right"] .tgho-compact-panel {
      left: auto;
      right: 0;
    }

    /* ============== Responsive ============== */
    @media (max-width: 480px) {
      .tgho-card, .tgho-list { max-width: 100%; }
      .tgho-card { padding: 16px; }
      .tgho-compact-panel { width: calc(100vw - 32px); max-width: 320px; }
    }

    @media (prefers-reduced-motion: reduce) {
      .tgho-status[data-open="true"] .tgho-status-dot::after {
        animation: none;
        opacity: 0;
      }
      .tgho-compact-pill-trigger, .tgho-compact-chev, .tgho-compact-panel {
        transition: none !important;
      }
    }
  `;

  // ---------- Widget Class ----------
  class TGHoursWidget {
    constructor(container, config) {
      this.el = container;
      this.c = this._defaults(config);
      this.t = makeT(this.c);   // resolve viewer language + UI strings
      this.shadow = container.attachShadow({ mode: 'open' });
      this._tickTimer = null;
      this._compactOpen = false;
      this._docClickHandler = null;
      this._docKeyHandler = null;
      this._render();
      this._scheduleTick();
    }

    _defaults(c) {
      const cfg = c || {};
      const layoutVal = cfg.layout;
      const compactStyleVal = cfg.compactStyle;
      const def = {
        layout: (layoutVal === 'list' || layoutVal === 'compact' || layoutVal === 'card') ? layoutVal : 'card',
        compactStyle: compactStyleVal === 'inline' ? 'inline' : 'pill',
        compactExpandable: cfg.compactExpandable !== false, // default ON
        title: typeof cfg.title === 'string' ? cfg.title : '', // '' = use localised 'Opening hours' fallback at render

        showStatus: cfg.showStatus !== false,
        highlightToday: cfg.highlightToday !== false,
        timeFormat: cfg.timeFormat === '24' ? '24' : '12', // 12 | 24
        showTimezoneNote: cfg.showTimezoneNote === true,
        timezoneLabel: cfg.timezoneLabel || 'Times shown in UK time',
        // IANA timezone the schedule is defined in (e.g. 'Europe/London'). Empty
        // = off: "open now" is computed in the visitor's own local time (the
        // long-standing behaviour). Set it so the business's hours read correctly
        // for a visitor in another timezone. Validated at use via Intl try/catch.
        timezone: typeof cfg.timezone === 'string' ? cfg.timezone.trim() : '',
        dayLabels: cfg.dayLabels === 'short' ? 'short' : 'full', // full | short
        startWeekOn: cfg.startWeekOn === 'sun' ? 'sun' : 'mon',  // mon | sun

        hours: cfg.hours || {
          mon: [['09:00', '17:30']],
          tue: [['09:00', '17:30']],
          wed: [['09:00', '17:30']],
          thu: [['09:00', '17:30']],
          fri: [['09:00', '17:30']],
          sat: [['10:00', '14:00']],
          sun: [],
        },
        holidays: Array.isArray(cfg.holidays) ? cfg.holidays : [],

        phone: cfg.phone || '',
        phoneLabel: cfg.phoneLabel || '',

        widgetId: cfg.widgetId || cfg._id || '',
        fontFamily: typeof cfg.fontFamily === 'string' ? cfg.fontFamily : '',
        theme: {
          mode: cfg.theme && cfg.theme.mode === 'dark' ? 'dark' : 'light',
          accent: safeColor(cfg.theme && cfg.theme.accent, '#1B2B5B'),
          radius: cfg.theme && Number.isFinite(Number(cfg.theme.radius)) ? Number(cfg.theme.radius) : 14,
        },
      };
      return def;
    }

    _themeStyle() {
      const t = this.c.theme;
      const parts = [];
      if (t.accent) parts.push(`--tgho-accent:${t.accent}`);
      if (Number.isFinite(t.radius)) parts.push(`--tgho-radius:${t.radius}px`);
      const safe = safeFontStack(this.c.fontFamily, '');
      if (safe) {
        parts.push(`font-family:'${safe.replace(/'/g, '')}', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`);
      }
      return parts.join(';');
    }

    _orderedDays() {
      const start = this.c.startWeekOn === 'sun' ? 0 : 1;
      const out = [];
      for (let i = 0; i < 7; i++) out.push(DAY_KEYS[(start + i) % 7]);
      return out;
    }

    _render() {
      const cfg = this.c;
      const status = cfg.showStatus ? evalStatus(cfg.hours, cfg.holidays, nowInZone(cfg.timezone), cfg.timeFormat, this.t) : null;
      const themeStyle = esc(this._themeStyle());

      let inner = '';
      if (cfg.layout === 'list') inner = this._renderList(status);
      else if (cfg.layout === 'compact') inner = this._renderCompact(status);
      else inner = this._renderCard(status);

      this.shadow.innerHTML = `
        <style>${STYLES}</style>
        <div class="tgho-root" data-theme="${cfg.theme.mode}" style="${themeStyle}">
          ${inner}
        </div>
      `;
      this._bind();
    }

    _bind() {
      const cfg = this.c;

      // Only the expandable compact pill needs binding
      if (cfg.layout !== 'compact' || cfg.compactStyle !== 'pill' || !cfg.compactExpandable) {
        // Make sure no stale document listeners persist if we switched away
        this._unbindDoc();
        return;
      }

      const trigger = this.shadow.querySelector('#compactTrigger');
      const panel = this.shadow.querySelector('#compactPanel');
      const wrap = this.shadow.querySelector('.tgho-compact-wrap');
      if (!trigger || !panel || !wrap) return;

      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        this._compactOpen = !this._compactOpen;
        wrap.setAttribute('data-panel-open', String(this._compactOpen));
        panel.setAttribute('data-open', String(this._compactOpen));
        trigger.setAttribute('aria-expanded', String(this._compactOpen));
        this._syncDocListeners();
      });

      // Stop clicks inside the panel from being treated as outside-clicks
      panel.addEventListener('click', (e) => {
        e.stopPropagation();
      });

      // Make sure listeners reflect current state after re-render (minute tick, theme change, etc)
      this._syncDocListeners();
    }

    _syncDocListeners() {
      if (this._compactOpen) {
        if (!this._docClickHandler) {
          this._docClickHandler = (e) => {
            // Composed event from inside Shadow DOM stops at the host element.
            // If the click landed on our host, the panel.click handler already stopped it.
            // Anything else is genuine outside-click.
            if (e.composedPath && e.composedPath().includes(this.el)) return;
            if (this.el.contains(e.target)) return;
            this._closeCompact();
          };
          document.addEventListener('click', this._docClickHandler, true);
        }
        if (!this._docKeyHandler) {
          this._docKeyHandler = (e) => {
            if (e.key === 'Escape' || e.key === 'Esc') {
              this._closeCompact();
            }
          };
          document.addEventListener('keydown', this._docKeyHandler);
        }
      } else {
        this._unbindDoc();
      }
    }

    _unbindDoc() {
      if (this._docClickHandler) {
        document.removeEventListener('click', this._docClickHandler, true);
        this._docClickHandler = null;
      }
      if (this._docKeyHandler) {
        document.removeEventListener('keydown', this._docKeyHandler);
        this._docKeyHandler = null;
      }
    }

    _closeCompact() {
      if (!this._compactOpen) return;
      this._compactOpen = false;
      const wrap = this.shadow.querySelector('.tgho-compact-wrap');
      const panel = this.shadow.querySelector('#compactPanel');
      const trigger = this.shadow.querySelector('#compactTrigger');
      if (wrap) wrap.setAttribute('data-panel-open', 'false');
      if (panel) panel.setAttribute('data-open', 'false');
      if (trigger) trigger.setAttribute('aria-expanded', 'false');
      this._unbindDoc();
    }

    _renderStatus(status) {
      if (!status) return '';
      return `
        <span class="tgho-status" data-open="${status.open}">
          <span class="tgho-status-dot"></span>
          <span>${esc(status.open ? this.t('openNow') : this.t('closed'))}</span>
        </span>
      `;
    }

    _renderRows() {
      const cfg = this.c;
      // Use the business timezone (if set) so the highlighted "today" row agrees
      // with the open-now status across a midnight boundary.
      const today = nowInZone(cfg.timezone);
      const todayKey = DAY_KEYS[today.getDay()];
      const todayDateStr = ymd(today);
      const useShort = cfg.dayLabels === 'short';
      const dayLabel = (key) => useShort ? this.t(key + 'Short') : this.t(key);

      // Build a map of dayKey → next-7-days holiday override (for today's row primarily)
      const todayHoliday = (Array.isArray(cfg.holidays))
        ? cfg.holidays.find(h => h && h.date === todayDateStr)
        : null;

      const rows = this._orderedDays().map(key => {
        const isToday = (key === todayKey) && cfg.highlightToday;
        let slots = Array.isArray(cfg.hours[key]) ? cfg.hours[key] : [];
        let holidayLabel = '';

        // Only show holiday override label on TODAY's row
        if (isToday && todayHoliday) {
          slots = Array.isArray(todayHoliday.slots) && todayHoliday.slots.length ? todayHoliday.slots : [];
          if (todayHoliday.closed) slots = [];
          holidayLabel = todayHoliday.label || '';
        }

        const closed = !slots.length;
        const timeText = closed ? this.t('closed') : formatSlots(slots, cfg.timeFormat);

        return `
          <div class="tgho-row" data-today="${isToday}">
            <div class="tgho-row-day">
              ${esc(dayLabel(key))}${holidayLabel ? `<span class="tgho-row-holiday">· ${esc(holidayLabel)}</span>` : ''}
            </div>
            <div class="tgho-row-time" data-closed="${closed}">${esc(timeText)}</div>
          </div>
        `;
      }).join('');

      return `<div class="tgho-rows">${rows}</div>`;
    }

    _renderFoot() {
      const cfg = this.c;
      const phoneClean = cleanPhone(cfg.phone);
      const phoneVisible = cfg.phone || '';
      const showPhone = !!phoneClean;
      const showTz = !!cfg.showTimezoneNote && !!cfg.timezoneLabel;
      if (!showPhone && !showTz) return '';
      return `
        <div class="tgho-foot">
          ${showPhone ? `
            <a class="tgho-phone" href="tel:${esc(phoneClean)}">
              ${svg('phone', 14)}
              <span>${esc(cfg.phoneLabel || phoneVisible)}</span>
            </a>
          ` : ''}
          ${showTz ? `<div class="tgho-tz">${esc(cfg.timezoneLabel)}</div>` : ''}
        </div>
      `;
    }

    _renderCard(status) {
      const cfg = this.c;
      return `
        <div class="tgho-card">
          <div class="tgho-card-head">
            <div class="tgho-card-title">
              ${svg('clock', 16)}
              <span>${esc(cfg.title || this.t('openingHours'))}</span>
            </div>
            ${cfg.showStatus ? this._renderStatus(status) : ''}
          </div>
          ${this._renderRows()}
          ${cfg.showStatus && status && status.nextOpen && status.label ? `
            <div style="margin-top:10px;font-size:12px;color:var(--tgho-sub);font-weight:500;letter-spacing:-0.005em;">
              ${esc(status.label)}
            </div>
          ` : ''}
          ${this._renderFoot()}
        </div>
      `;
    }

    _renderList(status) {
      const cfg = this.c;
      return `
        <div class="tgho-list">
          ${cfg.title || cfg.showStatus ? `
            <div class="tgho-list-head">
              <div class="tgho-list-title">${esc(cfg.title || this.t('openingHours'))}</div>
              ${cfg.showStatus ? this._renderStatus(status) : ''}
            </div>
          ` : ''}
          ${this._renderRows()}
          ${this._renderFoot()}
        </div>
      `;
    }

    _renderCompact(status) {
      const cfg = this.c;
      const label = status ? status.label : '';
      const open = status ? status.open : false;
      if (cfg.compactStyle === 'inline') {
        // Inline style is text-only — never expandable, no obvious affordance for it
        return `
          <div class="tgho-compact">
            <span class="tgho-compact-label">${esc(cfg.title || this.t('hours'))}:</span>
            <span class="tgho-compact-status" data-open="${open}">${esc(label)}</span>
          </div>
        `;
      }
      // Pill style — expandable when compactExpandable is on
      if (cfg.compactExpandable) {
        const panelOpen = this._compactOpen;
        return `
          <div class="tgho-compact-wrap" data-panel-open="${panelOpen}">
            <button
              class="tgho-compact-pill tgho-compact-pill-trigger"
              type="button"
              id="compactTrigger"
              aria-expanded="${panelOpen}"
              aria-haspopup="true"
              aria-controls="compactPanel"
            >
              <span class="tgho-status" data-open="${open}" style="padding:0;background:transparent;">
                <span class="tgho-status-dot"></span>
              </span>
              <span class="tgho-compact-status" data-open="${open}">${esc(label)}</span>
              <svg class="tgho-compact-chev" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            <div class="tgho-compact-panel" id="compactPanel" role="region" aria-label="${esc(cfg.title || this.t('openingHours'))}" data-open="${panelOpen}">
              ${this._renderCompactPanel(status)}
            </div>
          </div>
        `;
      }
      // Non-expandable pill — original render
      return `
        <div class="tgho-compact-pill">
          <span class="tgho-status" data-open="${open}" style="padding:0;background:transparent;">
            <span class="tgho-status-dot"></span>
          </span>
          <span class="tgho-compact-status" data-open="${open}">${esc(label)}</span>
        </div>
      `;
    }

    _renderCompactPanel(status) {
      // Content of the popped-out card: schedule rows + next-open line if closed + phone/timezone foot.
      // Deliberately no title (the pill IS the title) and no status pill (already in the trigger).
      const cfg = this.c;
      const showNextOpen = cfg.showStatus && status && status.nextOpen && status.label;
      return `
        ${this._renderRows()}
        ${showNextOpen ? `
          <div class="tgho-compact-panel-next">${esc(status.label)}</div>
        ` : ''}
        ${this._renderFoot()}
      `;
    }

    _scheduleTick() {
      // Re-render every minute so the live status stays accurate.
      // Aligned to the next minute boundary so all open/close transitions land on time.
      if (this._tickTimer) clearTimeout(this._tickTimer);
      const now = new Date();
      const msUntilNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds();
      this._tickTimer = setTimeout(() => {
        // Stop the minute loop (and the document listeners destroy() removes) if
        // the host was removed without destroy() (SPA client sites).
        if (this.el && !this.el.isConnected) { this.destroy(); return; }
        this._render();
        this._scheduleTick();
      }, Math.max(1000, msUntilNextMinute));
    }

    update(newConfig) {
      this.c = this._defaults(Object.assign({}, this.c, newConfig));
      this.t = makeT(this.c);
      this._render();
    }

    destroy() {
      if (this._tickTimer) clearTimeout(this._tickTimer);
      this._tickTimer = null;
      this._unbindDoc();
      this.shadow.innerHTML = '';
    }
  }

  // ---------- Auto-initializer ----------
  async function init() {
    const containers = document.querySelectorAll('[data-tg-widget="hours"]');
    for (const el of containers) {
      if (el.__tgInited) continue;
      el.__tgInited = true;

      const inline = el.getAttribute('data-tg-config');
      if (inline) {
        try {
          const cfg = JSON.parse(inline);
          new TGHoursWidget(el, cfg);
          continue;
        } catch (e) {
          console.warn('[TG Hours] invalid data-tg-config', e);
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
          new TGHoursWidget(el, cfg);
        } catch (e) {
          console.warn('[TG Hours] remote config error', e);
          el.textContent = '';
        }
      }
    }
  }

  // Expose
  window.TGHoursWidget = TGHoursWidget;
  window.__TG_HOURS_VERSION__ = VERSION;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
