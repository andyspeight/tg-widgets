/**
 * Travelgenix Appointment / Callback Scheduler Widget v1.0.0
 * Lets a visitor pick a day and time for a consultation or callback, then sends
 * the request to the agency. Generates its own availability from working hours,
 * slot length and lead time. Self-contained, zero dependencies, Shadow DOM,
 * accessible, CSP-clean (no inline handlers).
 *
 * This is a scheduling REQUEST form — it captures a preferred slot and the
 * visitor's details and hands them to a human, it does not hold live calendar
 * availability. By default the request is posted to <origin>/api/contact; set
 * `submitUrl` to route it elsewhere (e.g. an enquiry-routing endpoint).
 *
 * Usage (remote config):
 *   <div data-tg-widget="appointment" data-tg-id="YOUR_WIDGET_ID"></div>
 *   <script src="https://tg-widgets.vercel.app/widget-appointment.js"></script>
 *
 * Usage (inline config):
 *   <div data-tg-widget="appointment" data-tg-config='{"heading":"Book a call"}'></div>
 *   <script src="https://tg-widgets.vercel.app/widget-appointment.js"></script>
 *
 * © Travelgenix. All rights reserved.
 */
(function () {
  'use strict';

  const VERSION = '1.0.0';

  function resolveOrigin() {
    if (typeof window === 'undefined') return '';
    try { const me = document.currentScript; if (me && me.src) return new URL(me.src).origin; } catch (e) { /* noop */ }
    return '';
  }
  const SCRIPT_ORIGIN = resolveOrigin();
  const API_BASE = (typeof window !== 'undefined' && window.__TG_WIDGET_API__) || (SCRIPT_ORIGIN + '/api/widget-config');

  // ─── Helpers ────────────────────────────────────────────────
  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }
  function safeColor(c, fb) { return (typeof c === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c.trim())) ? c.trim() : fb; }
  function safeFont(f) { return (typeof f === 'string' && /^[\w \-]{1,40}$/.test(f.trim())) ? f.trim() : 'DM Sans'; }
  function clampNum(v, min, max, fb) { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fb; }
  function emailOk(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim()) && String(v).length <= 150; }
  function inkFor(hex) {
    let h = (hex || '#000').replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const r = parseInt(h.slice(0, 2), 16) / 255, g = parseInt(h.slice(2, 4), 16) / 255, b = parseInt(h.slice(4, 6), 16) / 255;
    const lin = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    return L > 0.5 ? '#0F172A' : '#FFFFFF';
  }

  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function fmtTime(mins) {
    let h = Math.floor(mins / 60), m = mins % 60;
    const ap = h < 12 ? 'am' : 'pm';
    let hh = h % 12; if (hh === 0) hh = 12;
    return hh + (m ? ':' + String(m).padStart(2, '0') : '') + ap;
  }

  const MODES = {
    callback: { verb: 'call you back', icon: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.81.36 1.6.7 2.34a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.74-1.27a2 2 0 0 1 2.11-.45c.74.34 1.53.57 2.34.7A2 2 0 0 1 22 16.92z"/>' },
    phone: { verb: 'call you', icon: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.81.36 1.6.7 2.34a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.74-1.27a2 2 0 0 1 2.11-.45c.74.34 1.53.57 2.34.7A2 2 0 0 1 22 16.92z"/>' },
    video: { verb: 'video call you', icon: '<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>' },
    inperson: { verb: 'see you', icon: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>' },
  };

  const DEFAULTS = {
    heading: 'Book a free consultation',
    subheading: 'Pick a time that suits you and one of our travel experts will be in touch.',
    mode: 'callback',                 // callback | phone | video | inperson
    // Availability
    daysAhead: 14,                    // calendar days of window to offer
    workingDays: [1, 2, 3, 4, 5],     // 0=Sun .. 6=Sat
    startHour: 9,
    endHour: 17,
    slotMins: 30,                     // 15 | 30 | 45 | 60
    leadTimeHours: 24,                // earliest bookable from now
    timezoneNote: 'All times shown are UK time.',
    // Fields
    askPhone: true,
    askNotes: true,
    askTopic: true,
    topics: ['Tailor-made holiday', 'Cruise', 'Honeymoon', 'Family holiday', 'Something else'],
    requireConsent: true,
    consentText: 'I am happy to be contacted about my enquiry.',
    // Style
    accent: '#0891B2',
    bg: '#FFFFFF',
    textColor: '#0F172A',
    radius: 16,
    font: 'DM Sans',
    // Submit
    submitUrl: '',                    // '' = <script origin>/api/contact
    buttonLabel: 'Request this time',
    successTitle: 'Thank you, that is booked in',
    successBody: 'We have your preferred time and will confirm by email shortly.',
    previewMode: false,               // editor/demo: never actually posts
  };

  function styles() {
    return `
      :host { all: initial; }
      *, *::before, *::after { box-sizing: border-box; }
      .tga {
        font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        background: var(--tga-bg, #fff); color: var(--tga-ink, #0F172A);
        border: 1px solid color-mix(in srgb, var(--tga-ink, #0F172A) 12%, transparent);
        border-radius: var(--tga-radius, 16px); padding: 26px 26px 24px;
        max-width: 560px; box-shadow: 0 1px 2px rgba(15,23,42,.04), 0 12px 40px rgba(15,23,42,.07);
      }
      .tga-head { display: flex; gap: 13px; align-items: flex-start; margin-bottom: 20px; }
      .tga-badge { flex: 0 0 auto; width: 42px; height: 42px; border-radius: 12px;
        background: color-mix(in srgb, var(--tga-accent, #0891B2) 14%, transparent);
        display: inline-flex; align-items: center; justify-content: center; }
      .tga-badge svg { width: 21px; height: 21px; fill: none; stroke: var(--tga-accent, #0891B2); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
      .tga-title { font-size: 19px; font-weight: 700; letter-spacing: -.01em; margin: 1px 0 4px; }
      .tga-sub { font-size: 13.5px; line-height: 1.5; opacity: .72; }
      .tga-step { margin-top: 18px; }
      .tga-step-label { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; opacity: .55; margin-bottom: 9px; display: flex; align-items: center; gap: 7px; }
      .tga-step-num { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 999px; background: var(--tga-accent, #0891B2); color: #fff; font-size: 11px; }
      .tga-days { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 4px; scrollbar-width: thin; }
      .tga-day { flex: 0 0 auto; min-width: 62px; padding: 9px 6px; border-radius: 11px; cursor: pointer;
        border: 1.5px solid color-mix(in srgb, var(--tga-ink, #0F172A) 12%, transparent); background: transparent;
        color: inherit; font: inherit; text-align: center; transition: border-color .14s ease, background .14s ease; }
      .tga-day:hover { background: color-mix(in srgb, var(--tga-ink, #0F172A) 4%, transparent); }
      .tga-day.is-on { border-color: var(--tga-accent, #0891B2); background: color-mix(in srgb, var(--tga-accent, #0891B2) 12%, transparent); }
      .tga-day-wd { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; opacity: .6; }
      .tga-day-dm { font-size: 18px; font-weight: 700; line-height: 1.15; }
      .tga-day-mo { font-size: 10.5px; opacity: .55; }
      .tga-slots { display: grid; grid-template-columns: repeat(auto-fill, minmax(82px, 1fr)); gap: 8px; }
      .tga-slot { padding: 9px 4px; border-radius: 9px; cursor: pointer; font: inherit; font-size: 13px; font-weight: 600;
        border: 1.5px solid color-mix(in srgb, var(--tga-ink, #0F172A) 12%, transparent); background: transparent; color: inherit;
        transition: border-color .14s ease, background .14s ease; }
      .tga-slot:hover { background: color-mix(in srgb, var(--tga-ink, #0F172A) 4%, transparent); }
      .tga-slot.is-on { border-color: var(--tga-accent, #0891B2); background: var(--tga-accent, #0891B2); color: var(--tga-accent-ink, #fff); }
      .tga-empty { font-size: 13px; opacity: .6; padding: 6px 0; }
      .tga-tz { font-size: 11.5px; opacity: .55; margin-top: 9px; }
      .tga-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
      .tga-field { display: flex; flex-direction: column; gap: 5px; }
      .tga-field.full { grid-column: 1 / -1; }
      .tga-field label { font-size: 12px; font-weight: 600; opacity: .75; }
      .tga-field input, .tga-field select, .tga-field textarea {
        width: 100%; padding: 9px 11px; font: inherit; font-size: 13.5px;
        border: 1px solid color-mix(in srgb, var(--tga-ink, #0F172A) 16%, transparent);
        border-radius: 9px; background: var(--tga-bg, #fff); color: inherit; }
      .tga-field textarea { resize: vertical; min-height: 60px; line-height: 1.5; }
      .tga-field input:focus, .tga-field select:focus, .tga-field textarea:focus {
        outline: none; border-color: var(--tga-accent, #0891B2);
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--tga-accent, #0891B2) 22%, transparent); }
      .tga-field.has-err input, .tga-field.has-err select { border-color: #DC2626; }
      .tga-err { font-size: 11.5px; color: #DC2626; display: none; }
      .tga-field.has-err .tga-err { display: block; }
      .tga-consent { display: flex; gap: 9px; align-items: flex-start; font-size: 12.5px; line-height: 1.45; opacity: .85; margin-top: 14px; }
      .tga-consent input { margin-top: 2px; flex: 0 0 auto; width: 16px; height: 16px; accent-color: var(--tga-accent, #0891B2); }
      .tga-summary { margin-top: 16px; font-size: 13.5px; padding: 11px 13px; border-radius: 10px;
        background: color-mix(in srgb, var(--tga-accent, #0891B2) 9%, transparent); display: none; }
      .tga-summary.is-shown { display: block; }
      .tga-summary strong { font-weight: 700; }
      .tga-submit { margin-top: 16px; width: 100%; padding: 13px 18px; border: 0; border-radius: 11px; cursor: pointer;
        font: inherit; font-size: 15px; font-weight: 700; letter-spacing: .01em;
        background: var(--tga-accent, #0891B2); color: var(--tga-accent-ink, #fff);
        transition: filter .16s ease, transform .16s ease; }
      .tga-submit:hover:not(:disabled) { filter: brightness(1.05); transform: translateY(-1px); }
      .tga-submit:disabled { opacity: .55; cursor: not-allowed; }
      .tga-form-err { margin-top: 11px; font-size: 13px; color: #DC2626; display: none; }
      .tga-form-err.is-shown { display: block; }
      .tga-success { text-align: center; padding: 18px 6px 10px; }
      .tga-success-ico { width: 54px; height: 54px; border-radius: 999px; margin: 0 auto 14px;
        background: color-mix(in srgb, var(--tga-accent, #0891B2) 14%, transparent);
        display: inline-flex; align-items: center; justify-content: center; }
      .tga-success-ico svg { width: 26px; height: 26px; fill: none; stroke: var(--tga-accent, #0891B2); stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
      .tga-success h3 { font-size: 18px; font-weight: 700; margin: 0 0 7px; }
      .tga-success p { font-size: 14px; line-height: 1.55; opacity: .75; margin: 0; }
      .tga-success .tga-when { margin-top: 12px; font-weight: 600; }
      .tga-hidden { display: none !important; }
      @media (max-width: 480px) { .tga { padding: 20px 18px; } .tga-fields { grid-template-columns: 1fr; } }
    `;
  }

  class TGAppointmentWidget {
    constructor(container, config) {
      this.el = container;
      this.cfg = Object.assign({}, DEFAULTS, config || {});
      this.shadow = container.shadowRoot || (container.attachShadow ? container.attachShadow({ mode: 'open' }) : container);
      this.selectedDayIdx = -1;
      this.selectedSlot = null;       // { iso, mins }
      this._build();
    }

    _buildAvailability() {
      const c = this.cfg;
      const windowDays = clampNum(c.daysAhead, 1, 60, 14);
      const startHour = clampNum(c.startHour, 0, 23, 9);
      let endHour = clampNum(c.endHour, 1, 24, 17);
      if (endHour <= startHour) endHour = Math.min(24, startHour + 1);
      const step = [15, 30, 45, 60].includes(parseInt(c.slotMins, 10)) ? parseInt(c.slotMins, 10) : 30;
      const lead = Math.max(0, Number(c.leadTimeHours) || 0);
      const working = Array.isArray(c.workingDays) && c.workingDays.length ? c.workingDays.map(Number) : [1, 2, 3, 4, 5];
      const earliest = Date.now() + lead * 3600 * 1000;

      const days = [];
      const base = new Date(); base.setHours(0, 0, 0, 0);
      for (let off = 0; off < windowDays && days.length < 14; off++) {
        const d = new Date(base.getTime()); d.setDate(d.getDate() + off);
        if (!working.includes(d.getDay())) continue;
        const slots = [];
        for (let t = startHour * 60; t < endHour * 60; t += step) {
          const slotDate = new Date(d.getTime()); slotDate.setHours(0, t, 0, 0);
          if (slotDate.getTime() >= earliest) slots.push({ mins: t, iso: slotDate.toISOString() });
        }
        if (slots.length) days.push({ date: d, slots });
      }
      this.days = days;
    }

    _build() {
      const c = this.cfg;
      this._buildAvailability();
      const accent = safeColor(c.accent, '#0891B2');
      const bg = safeColor(c.bg, '#FFFFFF');
      const ink = safeColor(c.textColor, '#0F172A');
      const font = safeFont(c.font || c.fontFamily);
      const radius = clampNum(c.radius, 0, 30, 16);
      const mode = MODES[c.mode] ? c.mode : 'callback';

      const vars = [
        `--tga-accent:${accent}`,
        `--tga-accent-ink:${inkFor(accent)}`,
        `--tga-bg:${bg}`,
        `--tga-ink:${ink}`,
        `--tga-radius:${radius}px`,
        `font-family:'${font}', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`,
      ].join(';');

      // Topic options
      let topicHtml = '';
      if (c.askTopic) {
        const topics = Array.isArray(c.topics) ? c.topics.filter(t => String(t || '').trim()).slice(0, 20) : [];
        const opts = ['<option value="">Please choose…</option>']
          .concat(topics.map(t => `<option value="${esc(t)}">${esc(t)}</option>`)).join('');
        topicHtml = `<div class="tga-field full">
          <label for="tga-topic">What is it about?</label>
          <select id="tga-topic">${opts}</select>
        </div>`;
      }
      const phoneHtml = c.askPhone ? `<div class="tga-field">
          <label for="tga-phone">Phone</label>
          <input id="tga-phone" type="tel" autocomplete="tel" placeholder="Your number">
        </div>` : '';
      const notesHtml = c.askNotes ? `<div class="tga-field full">
          <label for="tga-notes">Anything we should know? (optional)</label>
          <textarea id="tga-notes" maxlength="600" placeholder="Where you fancy, rough dates, who is travelling…"></textarea>
        </div>` : '';
      const consentHtml = c.requireConsent ? `<label class="tga-consent">
          <input type="checkbox" id="tga-consent">
          <span>${esc(c.consentText)}</span>
        </label>` : '';

      const daysMarkup = this.days.length
        ? this.days.map((d, i) => `<button type="button" class="tga-day" data-day="${i}">
            <span class="tga-day-wd">${WEEKDAYS[d.date.getDay()]}</span>
            <span class="tga-day-dm">${d.date.getDate()}</span>
            <span class="tga-day-mo">${MONTHS[d.date.getMonth()]}</span>
          </button>`).join('')
        : '<div class="tga-empty">No times are available just now. Please check back soon.</div>';

      this.shadow.innerHTML = `<style>${styles()}</style>
        <section class="tga" style="${vars}" role="form" aria-label="${esc(c.heading)}">
          <div class="tga-view" id="tga-view">
            <div class="tga-head">
              <span class="tga-badge" aria-hidden="true"><svg viewBox="0 0 24 24">${MODES[mode].icon}</svg></span>
              <div>
                <div class="tga-title">${esc(c.heading)}</div>
                <div class="tga-sub">${esc(c.subheading)}</div>
              </div>
            </div>

            <div class="tga-step">
              <div class="tga-step-label"><span class="tga-step-num">1</span> Choose a day</div>
              <div class="tga-days" id="tga-days">${daysMarkup}</div>
            </div>

            <div class="tga-step tga-hidden" id="tga-time-step">
              <div class="tga-step-label"><span class="tga-step-num">2</span> Choose a time</div>
              <div class="tga-slots" id="tga-slots"></div>
              <div class="tga-tz">${esc(c.timezoneNote || '')}</div>
            </div>

            <div class="tga-summary" id="tga-summary"></div>

            <div class="tga-step tga-hidden" id="tga-form-step">
              <div class="tga-step-label"><span class="tga-step-num">3</span> Your details</div>
              <div class="tga-fields">
                <div class="tga-field">
                  <label for="tga-name">Name</label>
                  <input id="tga-name" type="text" autocomplete="name" placeholder="Your name">
                  <span class="tga-err">Please add your name.</span>
                </div>
                <div class="tga-field">
                  <label for="tga-email">Email</label>
                  <input id="tga-email" type="email" autocomplete="email" placeholder="you@example.com">
                  <span class="tga-err">Please add a valid email.</span>
                </div>
                ${phoneHtml}
                ${topicHtml}
                ${notesHtml}
              </div>
              ${consentHtml}
              <div class="tga-form-err" id="tga-form-err"></div>
              <button type="button" class="tga-submit" id="tga-submit">${esc(c.buttonLabel)}</button>
            </div>
          </div>

          <div class="tga-success tga-hidden" id="tga-success" role="status" aria-live="polite">
            <span class="tga-success-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg></span>
            <h3>${esc(c.successTitle)}</h3>
            <p>${esc(c.successBody)}</p>
            <p class="tga-when" id="tga-when"></p>
          </div>
        </section>`;

      this._wire();
    }

    _wire() {
      const sh = this.shadow;
      const days = sh.getElementById('tga-days');
      if (days) days.addEventListener('click', (e) => {
        const b = e.target.closest('[data-day]'); if (!b) return;
        this._selectDay(parseInt(b.getAttribute('data-day'), 10));
      });
      const slots = sh.getElementById('tga-slots');
      if (slots) slots.addEventListener('click', (e) => {
        const b = e.target.closest('[data-slot]'); if (!b) return;
        this._selectSlot(b.getAttribute('data-slot'), parseInt(b.getAttribute('data-mins'), 10), b);
      });
      const submit = sh.getElementById('tga-submit');
      if (submit) submit.addEventListener('click', () => this._submit());
    }

    _selectDay(idx) {
      if (!this.days[idx]) return;
      this.selectedDayIdx = idx;
      this.selectedSlot = null;
      this.shadow.querySelectorAll('#tga-days [data-day]').forEach(b => b.classList.toggle('is-on', parseInt(b.getAttribute('data-day'), 10) === idx));
      const slotsWrap = this.shadow.getElementById('tga-slots');
      slotsWrap.innerHTML = this.days[idx].slots.map(s => `<button type="button" class="tga-slot" data-slot="${esc(s.iso)}" data-mins="${s.mins}">${fmtTime(s.mins)}</button>`).join('');
      this.shadow.getElementById('tga-time-step').classList.remove('tga-hidden');
      this.shadow.getElementById('tga-form-step').classList.add('tga-hidden');
      this._renderSummary();
    }

    _selectSlot(iso, mins, btn) {
      this.selectedSlot = { iso, mins };
      this.shadow.querySelectorAll('#tga-slots [data-slot]').forEach(b => b.classList.toggle('is-on', b === btn));
      this.shadow.getElementById('tga-form-step').classList.remove('tga-hidden');
      this._renderSummary();
    }

    _whenText() {
      if (this.selectedDayIdx < 0 || !this.selectedSlot) return '';
      const d = this.days[this.selectedDayIdx].date;
      return `${WEEKDAYS_LONG[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} at ${fmtTime(this.selectedSlot.mins)}`;
    }

    _renderSummary() {
      const el = this.shadow.getElementById('tga-summary');
      const when = this._whenText();
      if (when) { el.innerHTML = `Your slot: <strong>${esc(when)}</strong>`; el.classList.add('is-shown'); }
      else { el.classList.remove('is-shown'); }
    }

    _fieldErr(id, on) {
      const input = this.shadow.getElementById(id);
      if (input && input.closest('.tga-field')) input.closest('.tga-field').classList.toggle('has-err', !!on);
    }

    _submit() {
      const sh = this.shadow, c = this.cfg;
      const formErr = sh.getElementById('tga-form-err');
      formErr.classList.remove('is-shown');
      ['tga-name', 'tga-email'].forEach(id => this._fieldErr(id, false));

      if (!this.selectedSlot) { formErr.textContent = 'Please choose a day and time first.'; formErr.classList.add('is-shown'); return; }

      const name = (sh.getElementById('tga-name').value || '').trim();
      const email = (sh.getElementById('tga-email').value || '').trim();
      const phoneEl = sh.getElementById('tga-phone');
      const topicEl = sh.getElementById('tga-topic');
      const notesEl = sh.getElementById('tga-notes');
      const consentEl = sh.getElementById('tga-consent');

      let bad = false;
      if (!name) { this._fieldErr('tga-name', true); bad = true; }
      if (!emailOk(email)) { this._fieldErr('tga-email', true); bad = true; }
      if (bad) { formErr.textContent = 'Please check the highlighted fields.'; formErr.classList.add('is-shown'); return; }
      if (c.requireConsent && consentEl && !consentEl.checked) {
        formErr.textContent = 'Please tick the box to say we can contact you.'; formErr.classList.add('is-shown'); return;
      }

      const when = this._whenText();
      const topic = topicEl ? topicEl.value : '';
      const notes = notesEl ? (notesEl.value || '').trim() : '';
      const phone = phoneEl ? (phoneEl.value || '').trim() : '';

      const messageLines = [
        'Appointment request via website widget.',
        'Preferred time: ' + when + '.',
        'Type: ' + (MODES[c.mode] ? c.mode : 'callback') + '.',
      ];
      if (topic) messageLines.push('Topic: ' + topic + '.');
      if (notes) messageLines.push('Notes: ' + notes);

      const payload = {
        name: name,
        email: email,
        phone: phone,
        message: messageLines.join('\n'),
        // structured copy for routing endpoints that understand it
        appointment: { whenISO: this.selectedSlot.iso, whenText: when, mode: c.mode, topic: topic, notes: notes },
        widgetId: (this.el.getAttribute && this.el.getAttribute('data-tg-id')) || '',
        sourceUrl: (typeof window !== 'undefined' && window.location) ? window.location.href : '',
        website: '',                  // honeypot, intentionally empty
        ts: this._mountedAt || Date.now(),
      };

      const btn = sh.getElementById('tga-submit');

      if (c.previewMode) { this._showSuccess(when); return; }

      btn.disabled = true; const orig = btn.textContent; btn.textContent = 'Sending…';
      const url = (c.submitUrl && /^https?:\/\//i.test(c.submitUrl)) ? c.submitUrl : (SCRIPT_ORIGIN + '/api/contact');
      fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        .then(r => r.json().then(b => ({ ok: r.ok, body: b })).catch(() => ({ ok: r.ok, body: {} })))
        .then(res => {
          if (res.ok && (res.body.ok === undefined || res.body.ok)) { this._showSuccess(when); }
          else {
            btn.disabled = false; btn.textContent = orig;
            formErr.textContent = (res.body && res.body.error) || 'Something went wrong. Please try again.';
            formErr.classList.add('is-shown');
          }
        })
        .catch(() => {
          btn.disabled = false; btn.textContent = orig;
          formErr.textContent = 'Network error. Please try again.'; formErr.classList.add('is-shown');
        });
    }

    _showSuccess(when) {
      this.shadow.getElementById('tga-view').classList.add('tga-hidden');
      const ok = this.shadow.getElementById('tga-success');
      this.shadow.getElementById('tga-when').textContent = when || '';
      ok.classList.remove('tga-hidden');
    }

    update(newConfig) {
      this.cfg = Object.assign({}, this.cfg, newConfig || {});
      this.selectedDayIdx = -1; this.selectedSlot = null;
      this._build();
    }

    destroy(keepShadow) {
      if (!keepShadow && this.shadow) this.shadow.innerHTML = '';
    }
  }

  // ─── Boot ───────────────────────────────────────────────────
  async function fetchConfig(id) {
    try {
      const r = await fetch(API_BASE + '?id=' + encodeURIComponent(id), { method: 'GET', credentials: 'omit' });
      if (!r.ok) return null;
      const data = await r.json();
      return data && data.config ? data.config : null;
    } catch (e) { return null; }
  }
  async function init() {
    const containers = document.querySelectorAll('[data-tg-widget="appointment"]');
    for (const el of containers) {
      if (el.__tgInited) continue;
      el.__tgInited = true;
      let cfg = null;
      const inline = el.getAttribute('data-tg-config');
      if (inline) { try { cfg = JSON.parse(inline); } catch (e) { cfg = null; } }
      else { const id = el.getAttribute('data-tg-id'); if (id) cfg = await fetchConfig(id); }
      try { const w = new TGAppointmentWidget(el, cfg || {}); w._mountedAt = Date.now(); }
      catch (e) { if (window.console) console.error('[TGAppointment] init failed', e); }
    }
  }

  window.TGAppointmentWidget = TGAppointmentWidget;
  window.__TG_APPOINTMENT_VERSION__ = VERSION;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
