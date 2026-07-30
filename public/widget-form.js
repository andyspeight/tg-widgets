/**
 * Travelgenix Form Widget v1.0.0
 * A general-purpose (non travel) conversational form: one question at a time,
 * keyboard-first, with a welcome screen, progress and a custom thank-you.
 *
 * Usage:
 *   <div data-tg-widget="form" data-tg-id="tgw_..."></div>
 *   <script src="https://tg-widgets.vercel.app/widget-form.js" defer></script>
 *
 * WHY THIS EXISTS (and is not the Enquiry Form): Enquiry's 13 field types are
 * travel COMPOSITES (destination picker, departure airport, travellers, board
 * basis) and its submit pipeline is travel-locked. This widget owns generic
 * question primitives and posts to /api/form-submit, which hands answers to the
 * shared lead router (Sheets / email / auto-reply / webhook / the ESPs).
 *
 * ACCESSIBILITY IS A FEATURE HERE, not an afterthought. The best-known
 * conversational form has documented screen-reader problems, so every question
 * is a real labelled control, choices are real radio/checkbox inputs in a
 * fieldset with a legend, errors are announced via a live region, and the step
 * change moves focus deliberately (see the focus rule below).
 *
 * FOCUS/SCROLL RULE (repo-wide, learned the hard way on Enquiry Pro 23 Jul 2026):
 * a render must never grab the page. The editor calls update() on EVERY
 * keystroke, so focusing on render steals the cursor out of the field being
 * typed into. Focus moves ONLY when the step index actually changes, and never
 * on first mount. See _renderStep / _focusStep.
 *
 * Changelog:
 *   v1.0.0 (Jul 2026) — Phase 1: 13 generic question types, conversational
 *     renderer, keyboard navigation, validation, welcome/thank-you screens,
 *     progress bar. Branching logic is Phase 2 and is deliberately absent.
 */
(function () {
  'use strict';

  const VERSION = '1.0.0';

  // ─── API base ────────────────────────────────────────────────────────
  // The widget runs on CUSTOMER sites, so a relative '/api' path would resolve
  // against the customer's origin. Always resolve against our own script origin
  // (or an explicit override). Same contract as every other widget.
  function resolveApiBase() {
    if (typeof window === 'undefined') return '/api/widget-config';
    if (window.__TG_WIDGET_API__) return window.__TG_WIDGET_API__;
    try {
      const me = document.currentScript;
      if (me && me.src) return new URL(me.src).origin + '/api/widget-config';
      const scripts = document.getElementsByTagName('script');
      for (let i = scripts.length - 1; i >= 0; i--) {
        const s = scripts[i].src || '';
        if (s.indexOf('widget-form.js') !== -1) return new URL(s).origin + '/api/widget-config';
      }
    } catch (e) { /* fall through */ }
    return '/api/widget-config';
  }
  const API_BASE = resolveApiBase();
  const SUBMIT_URL = API_BASE.replace('/widget-config', '/form-submit');
  const LOG_URL = API_BASE.replace('/widget-config', '/widget-log');

  // ─── Utilities ───────────────────────────────────────────────────────

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  /** Whitelist a colour before it reaches a style attribute. */
  function safeColour(v, fallback) {
    return /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(String(v || '').trim())
      ? String(v).trim() : fallback;
  }

  function clampInt(v, min, max, fallback) {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
  }

  /** Telemetry beacon. Never throws, never blocks a render. */
  function tgReport(event, widgetId, message, detail) {
    try {
      const body = JSON.stringify({ event, widget: 'form', widgetId: widgetId || '', message: message || '', detail: detail || '' });
      fetch(LOG_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body, keepalive: true, credentials: 'omit' }).catch(function () {});
    } catch (e) { /* never break the page for telemetry */ }
  }

  /** A network/abort error means a navigate-away or a blip, not a broken form. */
  function isNavAwayError(message) {
    return /failed to fetch|load failed|networkerror|the user aborted|aborted|signal is aborted/i.test(String(message || ''));
  }

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  // Letters used for keyboard choice selection (Typeform's A/B/C affordance).
  const CHOICE_KEYS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  // ─── Question type registry ──────────────────────────────────────────
  //
  // Each type is pure data + pure functions, so a question can never carry
  // executable code (CSP rule: no eval, no Function constructor, no inline
  // handlers). Adding a type means adding one entry here.
  //
  //   input(q, id)      → HTML for the control (already escaped)
  //   read(wrap, q)     → the answer value from the DOM
  //   validate(v, q)    → error string, or '' when valid
  //   autoAdvance       → true when picking an option should move on by itself
  //   focusSel          → selector for the control that receives focus

  function optionList(q) {
    const raw = Array.isArray(q.options) ? q.options : [];
    return raw.slice(0, 26).map((o) => String(o == null ? '' : o)).filter((o) => o !== '');
  }

  function choiceHtml(q, id, multi) {
    const opts = optionList(q);
    const type = multi ? 'checkbox' : 'radio';
    const rows = opts.map((opt, i) => {
      const oid = id + '_o' + i;
      const key = CHOICE_KEYS[i] || '';
      return (
        '<label class="tgf-choice" for="' + esc(oid) + '">' +
          '<input type="' + type + '" id="' + esc(oid) + '" name="' + esc(id) + '" value="' + esc(opt) + '" class="tgf-choice-input">' +
          (key ? '<span class="tgf-choice-key" aria-hidden="true">' + esc(key) + '</span>' : '') +
          '<span class="tgf-choice-label">' + esc(opt) + '</span>' +
        '</label>'
      );
    }).join('');
    // A real fieldset+legend, so a screen reader announces the question with
    // each option rather than reading orphaned inputs.
    return (
      '<fieldset class="tgf-fieldset">' +
        '<legend class="tgf-sr-only">' + esc(q.label || 'Choose an option') + '</legend>' +
        '<div class="tgf-choices">' + rows + '</div>' +
      '</fieldset>'
    );
  }

  function readChoices(wrap, multi) {
    const inputs = wrap.querySelectorAll('.tgf-choice-input');
    if (multi) {
      const out = [];
      inputs.forEach((i) => { if (i.checked) out.push(i.value); });
      return out;
    }
    let v = '';
    inputs.forEach((i) => { if (i.checked) v = i.value; });
    return v;
  }

  const TYPES = {
    'short-text': {
      focusSel: 'input',
      input: (q, id) => '<input type="text" id="' + esc(id) + '" class="tgf-input" autocomplete="off"' +
        (q.placeholder ? ' placeholder="' + esc(q.placeholder) + '"' : '') +
        ' maxlength="' + clampInt(q.maxLength, 1, 1000, 200) + '">',
      read: (w) => (w.querySelector('input') || {}).value || '',
      validate: (v, q) => (q.required && !String(v).trim() ? 'Please answer this question.' : ''),
    },
    'long-text': {
      focusSel: 'textarea',
      // Enter inserts a newline here, so the hint tells the visitor how to move
      // on. _onKeydown honours Cmd/Ctrl+Enter for this type only.
      input: (q, id) => '<textarea id="' + esc(id) + '" class="tgf-input tgf-textarea" rows="4"' +
        (q.placeholder ? ' placeholder="' + esc(q.placeholder) + '"' : '') +
        ' maxlength="' + clampInt(q.maxLength, 1, 5000, 1000) + '"></textarea>',
      read: (w) => (w.querySelector('textarea') || {}).value || '',
      validate: (v, q) => (q.required && !String(v).trim() ? 'Please answer this question.' : ''),
    },
    email: {
      focusSel: 'input',
      input: (q, id) => '<input type="email" id="' + esc(id) + '" class="tgf-input" autocomplete="email" inputmode="email"' +
        (q.placeholder ? ' placeholder="' + esc(q.placeholder) + '"' : '') + '>',
      read: (w) => (w.querySelector('input') || {}).value || '',
      validate: (v, q) => {
        const s = String(v || '').trim();
        if (!s) return q.required ? 'Please enter your email address.' : '';
        return EMAIL_RE.test(s) ? '' : 'Please check that email address.';
      },
    },
    phone: {
      focusSel: 'input',
      input: (q, id) => '<input type="tel" id="' + esc(id) + '" class="tgf-input" autocomplete="tel" inputmode="tel"' +
        (q.placeholder ? ' placeholder="' + esc(q.placeholder) + '"' : '') + '>',
      read: (w) => (w.querySelector('input') || {}).value || '',
      validate: (v, q) => {
        const s = String(v || '').trim();
        if (!s) return q.required ? 'Please enter a phone number.' : '';
        return /^[0-9+()\-.\s]{6,30}$/.test(s) ? '' : 'Please check that phone number.';
      },
    },
    number: {
      focusSel: 'input',
      input: (q, id) => '<input type="number" id="' + esc(id) + '" class="tgf-input" inputmode="numeric"' +
        (q.min != null ? ' min="' + esc(q.min) + '"' : '') +
        (q.max != null ? ' max="' + esc(q.max) + '"' : '') +
        (q.placeholder ? ' placeholder="' + esc(q.placeholder) + '"' : '') + '>',
      read: (w) => {
        const raw = (w.querySelector('input') || {}).value;
        if (raw === '' || raw == null) return '';
        const n = Number(raw);
        return Number.isFinite(n) ? n : '';
      },
      validate: (v, q) => {
        if (v === '' || v == null) return q.required ? 'Please enter a number.' : '';
        const n = Number(v);
        if (!Number.isFinite(n)) return 'Please enter a number.';
        if (q.min != null && n < Number(q.min)) return 'Please enter ' + q.min + ' or more.';
        if (q.max != null && n > Number(q.max)) return 'Please enter ' + q.max + ' or less.';
        return '';
      },
    },
    'multiple-choice': {
      focusSel: '.tgf-choice-input',
      autoAdvance: true,
      input: (q, id) => choiceHtml(q, id, false),
      read: (w) => readChoices(w, false),
      validate: (v, q) => (q.required && !v ? 'Please choose an option.' : ''),
    },
    'multi-select': {
      focusSel: '.tgf-choice-input',
      input: (q, id) => choiceHtml(q, id, true),
      read: (w) => readChoices(w, true),
      validate: (v, q) => (q.required && (!Array.isArray(v) || !v.length) ? 'Please choose at least one option.' : ''),
    },
    dropdown: {
      focusSel: 'select',
      input: (q, id) => {
        const opts = optionList(q).map((o) => '<option value="' + esc(o) + '">' + esc(o) + '</option>').join('');
        return '<select id="' + esc(id) + '" class="tgf-input tgf-select">' +
          '<option value="">' + esc(q.placeholder || 'Choose…') + '</option>' + opts + '</select>';
      },
      read: (w) => (w.querySelector('select') || {}).value || '',
      validate: (v, q) => (q.required && !v ? 'Please choose an option.' : ''),
    },
    'yes-no': {
      focusSel: '.tgf-choice-input',
      autoAdvance: true,
      input: (q, id) => choiceHtml({ ...q, options: [q.yesLabel || 'Yes', q.noLabel || 'No'] }, id, false),
      read: (w) => readChoices(w, false),
      validate: (v, q) => (q.required && !v ? 'Please choose an option.' : ''),
    },
    rating: {
      focusSel: '.tgf-choice-input',
      autoAdvance: true,
      input: (q, id) => {
        const max = clampInt(q.max, 3, 10, 5);
        let rows = '';
        for (let i = 1; i <= max; i++) {
          const oid = id + '_r' + i;
          rows += '<label class="tgf-star" for="' + esc(oid) + '">' +
            '<input type="radio" id="' + esc(oid) + '" name="' + esc(id) + '" value="' + i + '" class="tgf-choice-input tgf-sr-only">' +
            '<span class="tgf-star-mark" aria-hidden="true">★</span>' +
            '<span class="tgf-sr-only">' + i + ' out of ' + max + '</span>' +
            '</label>';
        }
        return '<fieldset class="tgf-fieldset"><legend class="tgf-sr-only">' + esc(q.label || 'Rating') + '</legend>' +
          '<div class="tgf-stars">' + rows + '</div></fieldset>';
      },
      read: (w) => { const v = readChoices(w, false); return v ? Number(v) : ''; },
      validate: (v, q) => (q.required && !v ? 'Please choose a rating.' : ''),
    },
    'opinion-scale': {
      focusSel: '.tgf-choice-input',
      autoAdvance: true,
      input: (q, id) => {
        const min = clampInt(q.min, 0, 1, 0);
        const max = clampInt(q.max, 5, 10, 10);
        let rows = '';
        for (let i = min; i <= max; i++) {
          const oid = id + '_s' + i;
          rows += '<label class="tgf-scale-item" for="' + esc(oid) + '">' +
            '<input type="radio" id="' + esc(oid) + '" name="' + esc(id) + '" value="' + i + '" class="tgf-choice-input tgf-sr-only">' +
            '<span class="tgf-scale-num">' + i + '</span></label>';
        }
        const labels = (q.minLabel || q.maxLabel)
          ? '<div class="tgf-scale-labels"><span>' + esc(q.minLabel || '') + '</span><span>' + esc(q.maxLabel || '') + '</span></div>'
          : '';
        return '<fieldset class="tgf-fieldset"><legend class="tgf-sr-only">' + esc(q.label || 'Scale') + '</legend>' +
          '<div class="tgf-scale">' + rows + '</div>' + labels + '</fieldset>';
      },
      read: (w) => { const v = readChoices(w, false); return v === '' ? '' : Number(v); },
      validate: (v, q) => (q.required && v === '' ? 'Please choose a number.' : ''),
    },
    date: {
      focusSel: 'input',
      input: (q, id) => '<input type="date" id="' + esc(id) + '" class="tgf-input"' +
        (q.minDate ? ' min="' + esc(q.minDate) + '"' : '') +
        (q.maxDate ? ' max="' + esc(q.maxDate) + '"' : '') + '>',
      read: (w) => (w.querySelector('input') || {}).value || '',
      validate: (v, q) => (q.required && !v ? 'Please choose a date.' : ''),
    },
    consent: {
      focusSel: 'input',
      input: (q, id) => '<label class="tgf-consent" for="' + esc(id) + '">' +
        '<input type="checkbox" id="' + esc(id) + '" class="tgf-consent-input">' +
        '<span>' + esc(q.consentText || q.label || 'I agree') + '</span></label>',
      read: (w) => !!(w.querySelector('input') || {}).checked,
      // Consent has legal weight: a required consent must be actively ticked.
      validate: (v, q) => (q.required && !v ? 'Please tick this box to continue.' : ''),
    },
  };

  const DEFAULT_TYPE = 'short-text';
  function typeOf(q) { return TYPES[q && q.type] ? q.type : DEFAULT_TYPE; }

  // ─── Styles ──────────────────────────────────────────────────────────
  // Shadow DOM + :host{all:initial} so the customer's CSS cannot bleed in.

  const STYLES = `
    :host { all: initial; display: block; }
    *, *::before, *::after { box-sizing: border-box; }
    .tgf-root {
      --tgf-accent: #1B2B5B;
      --tgf-accent-ink: #FFFFFF;
      --tgf-ink: #0F172A;
      --tgf-muted: #64748B;
      --tgf-border: #E2E8F0;
      --tgf-bg: #FFFFFF;
      --tgf-radius: 12px;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      color: var(--tgf-ink);
      background: var(--tgf-bg);
      border: 1px solid var(--tgf-border);
      border-radius: var(--tgf-radius);
      position: relative;
      overflow: hidden;
      /* Contain our own stacking so nothing here can paint over a host page's
         sticky header (the World Map lesson, 29 Jul 2026). */
      isolation: isolate;
    }
    .tgf-root[data-theme="dark"] {
      --tgf-ink: #F8FAFC; --tgf-muted: #CBD5E1; --tgf-border: #334155; --tgf-bg: #0F172A;
    }
    .tgf-progress { height: 4px; background: var(--tgf-border); }
    .tgf-progress-bar { height: 100%; width: 0%; background: var(--tgf-accent); transition: width 280ms cubic-bezier(.22,.61,.36,1); }
    @media (prefers-reduced-motion: reduce) { .tgf-progress-bar { transition: none; } }

    .tgf-stage { padding: 32px 28px 24px; min-height: 260px; display: flex; flex-direction: column; justify-content: center; }
    @media (max-width: 520px) { .tgf-stage { padding: 24px 18px 20px; min-height: 220px; } }

    .tgf-step { animation: tgf-in 280ms cubic-bezier(.22,.61,.36,1); }
    @keyframes tgf-in { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
    @media (prefers-reduced-motion: reduce) { .tgf-step { animation: none; } }

    .tgf-count { font-size: 12px; font-weight: 600; color: var(--tgf-accent); letter-spacing: .02em; margin: 0 0 8px; }
    .tgf-q { margin: 0 0 6px; font-size: 20px; line-height: 1.3; font-weight: 700; letter-spacing: -.01em; }
    .tgf-help { margin: 0 0 16px; font-size: 14px; color: var(--tgf-muted); line-height: 1.5; }
    .tgf-optional { font-weight: 500; color: var(--tgf-muted); font-size: 14px; }

    .tgf-input {
      width: 100%; padding: 12px 14px; font: inherit; font-size: 16px; color: var(--tgf-ink);
      background: transparent; border: 1px solid var(--tgf-border); border-radius: 10px;
    }
    .tgf-input:focus-visible { outline: 2px solid var(--tgf-accent); outline-offset: 2px; border-color: var(--tgf-accent); }
    .tgf-textarea { resize: vertical; min-height: 96px; }
    .tgf-select { appearance: none; background-image: none; }

    .tgf-fieldset { border: 0; margin: 0; padding: 0; min-width: 0; }
    .tgf-choices { display: flex; flex-direction: column; gap: 8px; }
    .tgf-choice {
      display: flex; align-items: center; gap: 10px; padding: 12px 14px; cursor: pointer;
      border: 1px solid var(--tgf-border); border-radius: 10px; font-size: 15px; line-height: 1.4;
      transition: border-color 140ms, background-color 140ms;
    }
    .tgf-choice:hover { border-color: var(--tgf-accent); }
    .tgf-choice-input { margin: 0; accent-color: var(--tgf-accent); }
    .tgf-choice:has(.tgf-choice-input:checked) { border-color: var(--tgf-accent); background: color-mix(in srgb, var(--tgf-accent) 8%, transparent); }
    .tgf-choice:has(.tgf-choice-input:focus-visible) { outline: 2px solid var(--tgf-accent); outline-offset: 2px; }
    .tgf-choice-key {
      flex: none; width: 22px; height: 22px; display: grid; place-items: center;
      border: 1px solid var(--tgf-border); border-radius: 5px; font-size: 11px; font-weight: 700; color: var(--tgf-muted);
    }
    .tgf-choice-label { flex: 1 1 auto; }

    .tgf-stars { display: flex; gap: 6px; }
    .tgf-star { cursor: pointer; line-height: 1; }
    .tgf-star-mark { font-size: 30px; color: var(--tgf-border); transition: color 120ms; }
    .tgf-star:hover .tgf-star-mark { color: var(--tgf-accent); }
    .tgf-star.is-on .tgf-star-mark { color: var(--tgf-accent); }
    .tgf-star:has(.tgf-choice-input:focus-visible) .tgf-star-mark { outline: 2px solid var(--tgf-accent); outline-offset: 2px; }

    .tgf-scale { display: flex; flex-wrap: wrap; gap: 6px; }
    .tgf-scale-item { cursor: pointer; }
    .tgf-scale-num {
      display: grid; place-items: center; min-width: 42px; height: 42px; padding: 0 6px;
      border: 1px solid var(--tgf-border); border-radius: 8px; font-size: 15px; font-weight: 600;
      transition: border-color 140ms, background-color 140ms;
    }
    .tgf-scale-item:hover .tgf-scale-num { border-color: var(--tgf-accent); }
    .tgf-scale-item:has(.tgf-choice-input:checked) .tgf-scale-num { background: var(--tgf-accent); color: var(--tgf-accent-ink); border-color: var(--tgf-accent); }
    .tgf-scale-item:has(.tgf-choice-input:focus-visible) .tgf-scale-num { outline: 2px solid var(--tgf-accent); outline-offset: 2px; }
    .tgf-scale-labels { display: flex; justify-content: space-between; margin-top: 6px; font-size: 12px; color: var(--tgf-muted); }

    .tgf-consent { display: flex; gap: 10px; align-items: flex-start; font-size: 14px; line-height: 1.5; cursor: pointer; }
    .tgf-consent-input { margin-top: 3px; accent-color: var(--tgf-accent); }

    .tgf-err { margin: 10px 0 0; font-size: 13px; font-weight: 600; color: #B91C1C; }
    .tgf-root[data-theme="dark"] .tgf-err { color: #FCA5A5; }

    .tgf-foot { display: flex; align-items: center; gap: 12px; padding: 0 28px 24px; }
    @media (max-width: 520px) { .tgf-foot { padding: 0 18px 20px; } }
    .tgf-btn {
      font: inherit; font-size: 15px; font-weight: 600; padding: 11px 20px; border-radius: 10px;
      border: 1px solid transparent; cursor: pointer; background: var(--tgf-accent); color: var(--tgf-accent-ink);
    }
    .tgf-btn:focus-visible { outline: 2px solid var(--tgf-accent); outline-offset: 2px; }
    .tgf-btn[disabled] { opacity: .6; cursor: default; }
    .tgf-btn--ghost { background: transparent; color: var(--tgf-muted); border-color: var(--tgf-border); }
    .tgf-hint { font-size: 12px; color: var(--tgf-muted); margin-left: auto; }
    @media (max-width: 520px) { .tgf-hint { display: none; } }

    .tgf-sr-only {
      position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
      overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
    }
  `;

  // ─── Widget ──────────────────────────────────────────────────────────

  class TGFormWidget {
    constructor(el, cfg) {
      this.el = el;
      this.cfg = cfg || {};
      this.questions = (Array.isArray(this.cfg.questions) ? this.cfg.questions : []).filter((q) => q && q.label);
      this.answers = {};
      this.idx = 0;               // -1 = welcome, questions.length = thank-you
      this._lastRenderedIdx = null; // drives the focus rule (see _focusStep)
      this.submitting = false;
      this.done = false;
      this.shadow = el.attachShadow({ mode: 'open' });
      this._boot();
    }

    _boot() {
      if (this.cfg.showWelcome !== false && (this.cfg.welcomeTitle || this.cfg.welcomeBody)) this.idx = -1;
      this._render();
    }

    /** Public: re-apply a config (the editor calls this on every keystroke). */
    update(cfg) {
      this.cfg = Object.assign({}, this.cfg, cfg || {});
      this.questions = (Array.isArray(this.cfg.questions) ? this.cfg.questions : []).filter((q) => q && q.label);
      if (this.idx > this.questions.length) this.idx = this.questions.length;
      this._render();
    }

    _t(key, fallback) {
      const s = this.cfg[key];
      return typeof s === 'string' && s.trim() ? s : fallback;
    }

    // ── Render ────────────────────────────────────────────────────────
    _render() {
      const accent = safeColour(this.cfg.accentColor, '#1B2B5B');
      const theme = this.cfg.theme === 'dark' ? 'dark' : 'light';
      const total = this.questions.length;

      let bodyHtml;
      if (this.done) bodyHtml = this._thankYouHtml();
      else if (this.idx === -1) bodyHtml = this._welcomeHtml();
      else if (!total) bodyHtml = this._emptyHtml();
      else bodyHtml = this._stepHtml(this.questions[this.idx], this.idx, total);

      const pct = this.done ? 100 : (total ? Math.round((Math.max(0, this.idx) / total) * 100) : 0);

      this.shadow.innerHTML =
        '<style>' + STYLES + '</style>' +
        '<div class="tgf-root" data-theme="' + esc(theme) + '" style="--tgf-accent:' + esc(accent) + '">' +
          (this.cfg.showProgress === false || this.done ? '' :
            '<div class="tgf-progress"><div class="tgf-progress-bar" style="width:' + pct + '%"></div></div>') +
          '<div class="tgf-stage">' + bodyHtml + '</div>' +
        '</div>';

      this._bind();
      this._focusStep();
    }

    _welcomeHtml() {
      return '<div class="tgf-step">' +
        '<h2 class="tgf-q">' + esc(this._t('welcomeTitle', 'Hello')) + '</h2>' +
        (this.cfg.welcomeBody ? '<p class="tgf-help">' + esc(this.cfg.welcomeBody) + '</p>' : '') +
        '<div class="tgf-foot" style="padding:16px 0 0">' +
          '<button type="button" class="tgf-btn" data-start>' + esc(this._t('startLabel', 'Start')) + '</button>' +
          '<span class="tgf-hint">press <b>Enter</b></span>' +
        '</div></div>';
    }

    _emptyHtml() {
      return '<div class="tgf-step"><p class="tgf-help">' +
        esc(this._t('emptyText', 'This form has no questions yet.')) + '</p></div>';
    }

    _thankYouHtml() {
      return '<div class="tgf-step" role="status">' +
        '<h2 class="tgf-q">' + esc(this._t('thankYouTitle', 'Thank you')) + '</h2>' +
        '<p class="tgf-help">' + esc(this._t('thankYouBody', 'Your answers have been sent.')) + '</p>' +
        (this.cfg.thankYouCtaUrl && this.cfg.thankYouCtaText
          ? '<div class="tgf-foot" style="padding:16px 0 0"><a class="tgf-btn" data-cta href="#">' + esc(this.cfg.thankYouCtaText) + '</a></div>'
          : '') +
        '</div>';
    }

    _stepHtml(q, i, total) {
      const t = typeOf(q);
      const spec = TYPES[t];
      const id = 'q_' + i;
      const optional = q.required === false || !q.required;
      return '<div class="tgf-step">' +
        '<p class="tgf-count">' + (i + 1) + ' of ' + total + '</p>' +
        '<label class="tgf-q" for="' + esc(id) + '">' + esc(q.label) +
          (optional ? ' <span class="tgf-optional">(optional)</span>' : '') + '</label>' +
        (q.help ? '<p class="tgf-help">' + esc(q.help) + '</p>' : '') +
        '<div data-input>' + spec.input(q, id) + '</div>' +
        // Errors are announced, not just shown, or a screen-reader user never
        // learns why the form refused to advance.
        '<p class="tgf-err" data-err role="alert" aria-live="assertive"></p>' +
      '</div>' +
      '<div class="tgf-foot">' +
        (i > 0 ? '<button type="button" class="tgf-btn tgf-btn--ghost" data-back>' + esc(this._t('backLabel', 'Back')) + '</button>' : '') +
        '<button type="button" class="tgf-btn" data-next>' +
          esc(i === total - 1 ? this._t('submitLabel', 'Submit') : this._t('nextLabel', 'OK')) + '</button>' +
        '<span class="tgf-hint">' + (spec.autoAdvance ? 'press a letter or <b>Enter</b>' : 'press <b>Enter</b>') + '</span>' +
      '</div>';
    }

    // ── Focus ─────────────────────────────────────────────────────────
    /**
     * Move focus ONLY when the step actually changed, and never on first mount.
     * A render must not grab the host page: the editor calls update() on every
     * keystroke, so focusing unconditionally steals the cursor out of the field
     * being typed into, and a visitor's page would jump to the form on load.
     */
    _focusStep() {
      const changed = this._lastRenderedIdx !== null && this._lastRenderedIdx !== this.idx;
      const first = this._lastRenderedIdx === null;
      this._lastRenderedIdx = this.idx;
      if (first || !changed) return;

      const q = this.questions[this.idx];
      const sel = q && TYPES[typeOf(q)] ? TYPES[typeOf(q)].focusSel : null;
      const target = sel ? this.shadow.querySelector(sel) : this.shadow.querySelector('[data-start],[data-next]');
      if (target && typeof target.focus === 'function') {
        try { target.focus({ preventScroll: true }); } catch (e) { try { target.focus(); } catch (e2) {} }
      }
    }

    // ── Binding ───────────────────────────────────────────────────────
    _bind() {
      const root = this.shadow.querySelector('.tgf-root');
      if (!root) return;

      const start = this.shadow.querySelector('[data-start]');
      if (start) start.addEventListener('click', () => { this.idx = 0; this._render(); });

      const back = this.shadow.querySelector('[data-back]');
      if (back) back.addEventListener('click', () => this._back());

      const next = this.shadow.querySelector('[data-next]');
      if (next) next.addEventListener('click', () => this._next());

      const cta = this.shadow.querySelector('[data-cta]');
      if (cta) {
        const url = String(this.cfg.thankYouCtaUrl || '');
        // Only ever follow an http(s) link — never javascript: or data:.
        if (/^https?:\/\//i.test(url)) cta.setAttribute('href', url);
        else cta.removeAttribute('href');
      }

      // Choice types advance as soon as an option is picked, which is what makes
      // the form feel conversational rather than like a survey.
      const q = this.questions[this.idx];
      if (q && TYPES[typeOf(q)] && TYPES[typeOf(q)].autoAdvance) {
        this.shadow.querySelectorAll('.tgf-choice-input').forEach((input) => {
          input.addEventListener('change', () => {
            this._paintStars();
            setTimeout(() => this._next(), 160);
          });
        });
      }
      this.shadow.querySelectorAll('.tgf-choice-input').forEach((input) => {
        input.addEventListener('change', () => this._paintStars());
      });

      root.addEventListener('keydown', (e) => this._onKeydown(e));
    }

    /** Fill stars up to the chosen one (a rating reads as a bar, not a set). */
    _paintStars() {
      const stars = this.shadow.querySelectorAll('.tgf-star');
      if (!stars.length) return;
      let chosen = -1;
      stars.forEach((s, i) => { const inp = s.querySelector('input'); if (inp && inp.checked) chosen = i; });
      stars.forEach((s, i) => s.classList.toggle('is-on', i <= chosen));
    }

    _onKeydown(e) {
      if (this.done) return;
      const q = this.questions[this.idx];
      const t = q ? typeOf(q) : null;

      // Enter advances. In a long-text answer Enter must insert a newline, so
      // there it takes Cmd/Ctrl+Enter instead.
      if (e.key === 'Enter') {
        if (t === 'long-text' && !(e.metaKey || e.ctrlKey)) return;
        e.preventDefault();
        if (this.idx === -1) { this.idx = 0; this._render(); return; }
        this._next();
        return;
      }

      if (!q) return;

      // Letter keys pick an option (A, B, C…), the Typeform affordance.
      if ((t === 'multiple-choice' || t === 'multi-select' || t === 'yes-no') && /^[a-zA-Z]$/.test(e.key)) {
        const i = CHOICE_KEYS.indexOf(e.key.toUpperCase());
        const inputs = this.shadow.querySelectorAll('.tgf-choice-input');
        if (i >= 0 && i < inputs.length) {
          e.preventDefault();
          const input = inputs[i];
          input.checked = t === 'multi-select' ? !input.checked : true;
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
        return;
      }

      // Number keys pick a rating / scale point.
      if ((t === 'rating' || t === 'opinion-scale') && /^[0-9]$/.test(e.key)) {
        const inputs = this.shadow.querySelectorAll('.tgf-choice-input');
        let match = null;
        inputs.forEach((inp) => { if (inp.value === e.key) match = inp; });
        if (match) {
          e.preventDefault();
          match.checked = true;
          match.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    }

    // ── Navigation ────────────────────────────────────────────────────
    _readCurrent() {
      const wrap = this.shadow.querySelector('[data-input]');
      const q = this.questions[this.idx];
      if (!wrap || !q) return '';
      return TYPES[typeOf(q)].read(wrap, q);
    }

    _showError(msg) {
      const el = this.shadow.querySelector('[data-err]');
      if (el) el.textContent = msg || '';
    }

    _back() {
      if (this.idx <= 0) return;
      this.answers[this.idx] = this._readCurrent();
      this.idx -= 1;
      this._render();
      this._restore();
    }

    /** Put a previously given answer back on screen when navigating back. */
    _restore() {
      const q = this.questions[this.idx];
      const prev = this.answers[this.idx];
      if (!q || prev === undefined || prev === '') return;
      const wrap = this.shadow.querySelector('[data-input]');
      if (!wrap) return;
      const t = typeOf(q);
      if (t === 'multi-select') {
        const vals = Array.isArray(prev) ? prev : [];
        wrap.querySelectorAll('.tgf-choice-input').forEach((i) => { i.checked = vals.indexOf(i.value) !== -1; });
      } else if (wrap.querySelector('.tgf-choice-input')) {
        wrap.querySelectorAll('.tgf-choice-input').forEach((i) => { i.checked = String(i.value) === String(prev); });
        this._paintStars();
      } else if (t === 'consent') {
        const c = wrap.querySelector('input'); if (c) c.checked = !!prev;
      } else {
        const f = wrap.querySelector('input, textarea, select'); if (f) f.value = prev;
      }
    }

    _next() {
      if (this.submitting || this.done) return;
      const q = this.questions[this.idx];
      if (!q) return;
      const value = this._readCurrent();
      const err = TYPES[typeOf(q)].validate(value, q);
      if (err) { this._showError(err); return; }
      this._showError('');
      this.answers[this.idx] = value;

      if (this.idx < this.questions.length - 1) {
        this.idx += 1;
        this._render();
        this._restore();
        return;
      }
      this._submit();
    }

    // ── Submit ────────────────────────────────────────────────────────
    _payload() {
      const answers = this.questions.map((q, i) => ({
        id: q.id || 'q' + i,
        label: q.label,
        type: typeOf(q),
        value: this.answers[i] === undefined ? '' : this.answers[i],
        mapTo: q.mapTo || undefined,
      }));
      return {
        widgetId: this.cfg._widgetId || '',
        answers,
        sourceUrl: (typeof location !== 'undefined' && location.href) ? location.href.slice(0, 1000) : '',
        referrer: (typeof document !== 'undefined' && document.referrer) ? document.referrer.slice(0, 500) : '',
      };
    }

    async _submit() {
      this.submitting = true;
      const btn = this.shadow.querySelector('[data-next]');
      if (btn) { btn.disabled = true; btn.textContent = this._t('submittingLabel', 'Sending…'); }

      try {
        const res = await fetch(SUBMIT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this._payload()),
        });
        let data = null;
        try { data = await res.json(); } catch (e) { data = null; }

        if (res.ok && data && data.ok) {
          this.done = true;
          this._render();
          try {
            this.el.dispatchEvent(new CustomEvent('tgf:submitted', {
              bubbles: true, composed: true, detail: { leadId: data.leadId },
            }));
          } catch (e) {}
          return;
        }

        // A real rejection (bad config, missing email question) is worth telling
        // us about; the visitor just sees a retryable message.
        this._showError((data && data.error) || this._t('errorText', 'Sorry, something went wrong. Please try again.'));
        tgReport('error', this.cfg._widgetId, 'form submit failed', (data && data.error) || ('HTTP ' + res.status));
      } catch (err) {
        this._showError(this._t('errorText', 'Sorry, something went wrong. Please try again.'));
        // A navigate-away or a dropped connection is not a fault worth paging
        // about; a genuine reachability problem on a visible page still is.
        let hidden = false;
        try { hidden = (typeof document !== 'undefined' && document.visibilityState === 'hidden'); } catch (e) {}
        if (!hidden && !isNavAwayError(err && err.message)) {
          tgReport('error', this.cfg._widgetId, 'form unreachable', err && err.message);
        }
      } finally {
        this.submitting = false;
        const b = this.shadow.querySelector('[data-next]');
        if (b) { b.disabled = false; b.textContent = this._t('submitLabel', 'Submit'); }
      }
    }
  }

  // ─── Config load + auto-init ─────────────────────────────────────────

  async function loadConfig(widgetId) {
    const url = API_BASE + '?id=' + encodeURIComponent(widgetId);
    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 400 * attempt));
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error('Config load failed: ' + res.status);
        const data = await res.json();
        const cfg = (data && data.config) ? data.config : data;
        if (cfg) return Object.assign({}, cfg, { _widgetId: widgetId });
        throw new Error('No config returned');
      } catch (err) {
        lastErr = err;
        // An HTTP error will not self-heal, so stop retrying immediately.
        if (err && /^Config load failed: \d/.test(String(err.message))) break;
      }
    }
    let hidden = false;
    try { hidden = (document.visibilityState === 'hidden'); } catch (e) {}
    if (!hidden) tgReport('error', widgetId, 'config load failed', lastErr && lastErr.message);
    return null;
  }

  async function initOne(el) {
    if (el.__tgForm) return;              // double-init guard
    el.__tgForm = true;
    try {
      const inline = el.getAttribute('data-tg-config');
      let cfg = null;
      if (inline) {
        try { cfg = JSON.parse(inline); } catch (e) { cfg = null; }
      }
      if (!cfg) {
        const id = el.getAttribute('data-tg-id');
        if (!id) return;
        cfg = await loadConfig(id);
        if (!cfg) return;                 // stay silent rather than show a broken shell
      }
      el.__tgFormInstance = new TGFormWidget(el, cfg);
      tgReport('load', cfg._widgetId || '', '');
    } catch (err) {
      console.error('[TGForm] init failed:', err);
    }
  }

  function init() {
    const els = document.querySelectorAll('[data-tg-widget="form"]');
    for (let i = 0; i < els.length; i++) initOne(els[i]);
  }

  if (typeof window !== 'undefined') {
    window.TGFormWidget = TGFormWidget;
    window.__TG_FORM_VERSION__ = VERSION;
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }
})();
