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

  const API_BASE = (typeof window !== 'undefined' && window.__TG_WIDGET_API__) || '/api/widget-config';
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

  // Build the live status: {open, label, nextOpen}
  function evalStatus(hours, holidays, now) {
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
            closingAt: b,
            label: 'Open until ' + formatTime(b, '12'),
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
          openingAt: todayLater,
          label: 'Opens today at ' + formatTime(todayLater, '12'),
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
      const dayLabel = isTomorrow ? 'tomorrow' : DAY_LABELS_FULL[DAY_KEYS[next.getDay()]];
      return {
        open: false,
        openingAt: opens,
        nextDayOffset: i,
        label: 'Opens ' + dayLabel + ' at ' + formatTime(opens, '12'),
      };
    }

    return { open: false, label: 'Closed' };
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

    /* ============== Responsive ============== */
    @media (max-width: 480px) {
      .tgho-card, .tgho-list { max-width: 100%; }
      .tgho-card { padding: 16px; }
    }

    @media (prefers-reduced-motion: reduce) {
      .tgho-status[data-open="true"] .tgho-status-dot::after {
        animation: none;
        opacity: 0;
      }
    }
  `;

  // ---------- Widget Class ----------
  class TGHoursWidget {
    constructor(container, config) {
      this.el = container;
      this.c = this._defaults(config);
      this.shadow = container.attachShadow({ mode: 'open' });
      this._tickTimer = null;
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
        title: typeof cfg.title === 'string' ? cfg.title : 'Opening hours',
        showStatus: cfg.showStatus !== false,
        highlightToday: cfg.highlightToday !== false,
        timeFormat: cfg.timeFormat === '24' ? '24' : '12', // 12 | 24
        showTimezoneNote: cfg.showTimezoneNote === true,
        timezoneLabel: cfg.timezoneLabel || 'Times shown in UK time',
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
          accent: (cfg.theme && cfg.theme.accent) || '#1B2B5B',
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
      if (this.c.fontFamily && typeof this.c.fontFamily === 'string') {
        const safe = this.c.fontFamily.replace(/'/g, '');
        parts.push(`font-family:'${safe}', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`);
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
      const status = cfg.showStatus ? evalStatus(cfg.hours, cfg.holidays, new Date()) : null;
      const themeStyle = this._themeStyle();

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
    }

    _renderStatus(status) {
      if (!status) return '';
      return `
        <span class="tgho-status" data-open="${status.open}">
          <span class="tgho-status-dot"></span>
          <span>${esc(status.open ? 'Open now' : 'Closed')}</span>
        </span>
      `;
    }

    _renderRows() {
      const cfg = this.c;
      const today = new Date();
      const todayKey = DAY_KEYS[today.getDay()];
      const todayDateStr = ymd(today);
      const labelMap = cfg.dayLabels === 'short' ? DAY_LABELS_SHORT : DAY_LABELS_FULL;

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
        const timeText = closed ? 'Closed' : formatSlots(slots, cfg.timeFormat);

        return `
          <div class="tgho-row" data-today="${isToday}">
            <div class="tgho-row-day">
              ${esc(labelMap[key])}${holidayLabel ? `<span class="tgho-row-holiday">· ${esc(holidayLabel)}</span>` : ''}
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
              <span>${esc(cfg.title)}</span>
            </div>
            ${cfg.showStatus ? this._renderStatus(status) : ''}
          </div>
          ${this._renderRows()}
          ${cfg.showStatus && status && status.label && status.label !== 'Closed' && status.label !== 'Open' ? `
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
              <div class="tgho-list-title">${esc(cfg.title || '')}</div>
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
        return `
          <div class="tgho-compact">
            <span class="tgho-compact-label">${esc(cfg.title || 'Hours')}:</span>
            <span class="tgho-compact-status" data-open="${open}">${esc(label)}</span>
          </div>
        `;
      }
      return `
        <div class="tgho-compact-pill">
          <span class="tgho-status" data-open="${open}" style="padding:0;background:transparent;">
            <span class="tgho-status-dot"></span>
          </span>
          <span class="tgho-compact-status" data-open="${open}">${esc(label)}</span>
        </div>
      `;
    }

    _scheduleTick() {
      // Re-render every minute so the live status stays accurate.
      // Aligned to the next minute boundary so all open/close transitions land on time.
      if (this._tickTimer) clearTimeout(this._tickTimer);
      const now = new Date();
      const msUntilNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds();
      this._tickTimer = setTimeout(() => {
        this._render();
        this._scheduleTick();
      }, Math.max(1000, msUntilNextMinute));
    }

    update(newConfig) {
      this.c = this._defaults(Object.assign({}, this.c, newConfig));
      this._render();
    }

    destroy() {
      if (this._tickTimer) clearTimeout(this._tickTimer);
      this._tickTimer = null;
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
