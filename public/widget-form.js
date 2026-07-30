/**
 * Travelgenix Form Widget v1.1.1
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
 *   v1.1.1 (Jul 2026) — Second design pass, this time reviewed by SCREENSHOTTING
 *     the rendered widget in Chromium rather than reading the CSS. Three things
 *     only a rendered view showed:
 *     • The action row was double-padded. It sits inside the already-padded
 *       stage and carried its own horizontal padding, so OK sat 32px proud of
 *       the question's left edge. Everything now shares one left edge.
 *     • An empty answer line read as a broken field: a rule floating under dead
 *       space. Single-line answers now carry a default placeholder per type, so
 *       an empty state reads as an invitation.
 *     • The rating stars used the border colour and looked disabled.
 *     Also: the answer is an underline rather than a boxed field, so it reads as
 *     writing rather than paperwork; the answer line tracks the question's
 *     measure instead of overshooting it; and the card is no longer bottom-heavy.
 *   v1.1.0 (Jul 2026) — Design pass. The first cut used ad-hoc spacing and type
 *     sizes, which reads as unconsidered. Rebuilt against the Travelgenix design
 *     system: a 4px spacing grid, the type scale, tokenised colour/radius/
 *     elevation with a brand-tinted navy shadow, 44px minimum touch targets
 *     everywhere (the opinion scale was 42px and the stars had no hit area at
 *     all), focus rings that shift the border and add a 3px ring rather than a
 *     bare outline, a deliberate question-to-answer rhythm, balanced headline
 *     wrapping, tabular numerals, and a full dark theme. Accent ink is now
 *     derived from the client's colour by relative luminance, so a pale brand
 *     colour no longer ships unreadable white text.
 *   v1.0.0 (Jul 2026) — Phase 1: 13 generic question types, conversational
 *     renderer, keyboard navigation, validation, welcome/thank-you screens,
 *     progress bar. Branching logic is Phase 2 and is deliberately absent.
 */
(function () {
  'use strict';

  const VERSION = '1.1.1';

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

  /**
   * Pick readable text for whatever accent the client chose.
   * A client can set any brand colour, including a pale yellow or lime, and
   * white text on those is unreadable — a contrast failure we would be shipping
   * on their behalf. Relative luminance (WCAG) decides ink vs paper.
   */
  function inkFor(hex) {
    let h = String(hex || '').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (h.length < 6) return '#FFFFFF';
    const chan = (i) => {
      const c = parseInt(h.slice(i, i + 2), 16) / 255;
      return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    const L = 0.2126 * chan(0) + 0.7152 * chan(2) + 0.0722 * chan(4);
    // Contrast against white vs against near-black; pick the better one.
    return (1.05 / (L + 0.05)) >= ((L + 0.05) / 0.0947) ? '#FFFFFF' : '#0F172A';
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

  /**
   * Default placeholder per question type. An underline answer with no
   * placeholder looks like a floating rule under dead space; giving it a prompt
   * makes an empty state read as an invitation. A client-set placeholder always
   * wins.
   */
  const PLACEHOLDERS = {
    'short-text': 'Type your answer',
    'long-text': 'Type your answer',
    email: 'name@example.com',
    phone: '07700 900000',
    number: 'Enter a number',
  };
  function placeholderFor(q, type) {
    if (typeof q.placeholder === 'string' && q.placeholder.trim()) return q.placeholder;
    return PLACEHOLDERS[type] || '';
  }

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
        ' placeholder="' + esc(placeholderFor(q, 'short-text')) + '"' +
        ' maxlength="' + clampInt(q.maxLength, 1, 1000, 200) + '">',
      read: (w) => (w.querySelector('input') || {}).value || '',
      validate: (v, q) => (q.required && !String(v).trim() ? 'Please answer this question.' : ''),
    },
    'long-text': {
      focusSel: 'textarea',
      // Enter inserts a newline here, so the hint tells the visitor how to move
      // on. _onKeydown honours Cmd/Ctrl+Enter for this type only.
      input: (q, id) => '<textarea id="' + esc(id) + '" class="tgf-input tgf-textarea" rows="4"' +
        ' placeholder="' + esc(placeholderFor(q, 'long-text')) + '"' +
        ' maxlength="' + clampInt(q.maxLength, 1, 5000, 1000) + '"></textarea>',
      read: (w) => (w.querySelector('textarea') || {}).value || '',
      validate: (v, q) => (q.required && !String(v).trim() ? 'Please answer this question.' : ''),
    },
    email: {
      focusSel: 'input',
      input: (q, id) => '<input type="email" id="' + esc(id) + '" class="tgf-input" autocomplete="email" inputmode="email"' +
        ' placeholder="' + esc(placeholderFor(q, 'email')) + '">',
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
        ' placeholder="' + esc(placeholderFor(q, 'phone')) + '">',
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
        ' placeholder="' + esc(placeholderFor(q, 'number')) + '">',
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
      /* ── Brand (client-overridable) ── */
      --tgf-accent: #1B2B5B;
      --tgf-accent-ink: #FFFFFF;

      /* ── Surfaces + text ── */
      --tgf-bg: #FFFFFF;
      --tgf-bg-sunken: #F8FAFC;
      --tgf-ink: #0F172A;
      --tgf-ink-2: #475569;
      --tgf-ink-3: #94A3B8;
      --tgf-border: #E2E8F0;
      --tgf-border-strong: #CBD5E1;
      --tgf-danger: #DC2626;

      /* ── 4px spacing grid ── */
      --tgf-s1: 4px;  --tgf-s2: 8px;  --tgf-s3: 12px; --tgf-s4: 16px;
      --tgf-s5: 20px; --tgf-s6: 24px; --tgf-s8: 32px; --tgf-s10: 40px;

      /* ── Radius + elevation ── */
      --tgf-r-sm: 8px;
      --tgf-r-md: 12px;
      --tgf-r-lg: 16px;
      /* Navy-tinted, not a default grey drop shadow. */
      --tgf-shadow: 0 1px 2px rgba(15,23,42,.04), 0 12px 32px -16px rgba(27,43,91,.18);

      --tgf-ease: cubic-bezier(.22,.61,.36,1);

      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      font-size: 16px;
      line-height: 1.5;
      color: var(--tgf-ink);
      background: var(--tgf-bg);
      border: 1px solid var(--tgf-border);
      border-radius: var(--tgf-r-lg);
      box-shadow: var(--tgf-shadow);
      position: relative;
      overflow: hidden;
      /* Contain our own stacking so nothing here can paint over a host page's
         sticky header (the World Map lesson, 29 Jul 2026). */
      isolation: isolate;
    }

    .tgf-root[data-theme="dark"] {
      --tgf-bg: #0F172A;
      --tgf-bg-sunken: #1E293B;
      --tgf-ink: #F8FAFC;
      --tgf-ink-2: #CBD5E1;
      --tgf-ink-3: #64748B;
      --tgf-border: #334155;
      --tgf-border-strong: #475569;
      --tgf-danger: #FCA5A5;
      --tgf-shadow: 0 1px 2px rgba(0,0,0,.2), 0 12px 32px -16px rgba(0,0,0,.5);
    }

    /* ── Progress ─────────────────────────────────────────────────── */
    .tgf-progress { height: 3px; background: var(--tgf-border); }
    .tgf-progress-bar {
      height: 100%; width: 0%;
      background: var(--tgf-accent);
      border-radius: 0 999px 999px 0;
      transition: width 320ms var(--tgf-ease);
    }

    /* ── Stage ────────────────────────────────────────────────────── */
    /* A conversational form is one question at a time, so the stage is
       deliberately generous. Density dial: 3. */
    .tgf-stage {
      padding: var(--tgf-s10) var(--tgf-s8);
      min-height: 232px;
      display: flex;
      flex-direction: column;
      justify-content: center;
    }
    .tgf-step { animation: tgf-in 320ms var(--tgf-ease) both; }
    @keyframes tgf-in {
      from { opacity: 0; transform: translateY(8px); }
      to   { opacity: 1; transform: none; }
    }

    /* ── Question head ────────────────────────────────────────────── */
    .tgf-count {
      margin: 0 0 var(--tgf-s2);
      font-size: 11px;
      font-weight: 600;
      line-height: 1.4;
      letter-spacing: .06em;
      text-transform: uppercase;
      color: var(--tgf-ink-3);
      font-variant-numeric: tabular-nums;
    }
    .tgf-q {
      display: block;
      margin: 0 0 var(--tgf-s2);
      font-size: 22px;
      font-weight: 600;
      line-height: 1.3;
      letter-spacing: -.015em;
      color: var(--tgf-ink);
      /* Questions read as prose, so hold them to a comfortable measure. */
      max-width: 34ch;
      text-wrap: balance;
    }
    .tgf-optional { font-size: 15px; font-weight: 400; color: var(--tgf-ink-3); letter-spacing: 0; }
    .tgf-help {
      margin: 0 0 var(--tgf-s2);
      font-size: 15px;
      line-height: 1.6;
      color: var(--tgf-ink-2);
      max-width: 56ch;
    }
    /* The gap between the question block and the answer is the main rhythm
       cue: it separates "what we asked" from "what you do". */
    .tgf-answer { margin-top: var(--tgf-s5); }

    /* ── Text inputs ──────────────────────────────────────────────── */
    /* A boxed field makes this read as paperwork. The answer should read as a
       continuation of the question, so a single-line answer is a RULE, not a
       box: no border, no fill, larger type, and the rule lights up on focus.
       This is the difference between "fill in the form" and "write your
       answer". (Andy, 30 Jul 2026.) */
    .tgf-input {
      width: 100%;
      /* Tracks the question's measure so the rule does not overshoot it. */
      max-width: 440px;
      min-height: 44px;
      padding: var(--tgf-s1) 0;
      font: inherit;
      font-size: 22px;              /* comfortably above the 16px iOS zoom floor */
      font-weight: 400;
      line-height: 1.4;
      letter-spacing: -.01em;
      color: var(--tgf-ink);
      background: transparent;
      border: 0;
      border-bottom: 2px solid var(--tgf-border-strong);
      border-radius: 0;
      transition: border-color 160ms var(--tgf-ease);
    }
    .tgf-input::placeholder { color: var(--tgf-ink-3); font-weight: 400; }
    .tgf-input:hover { border-bottom-color: var(--tgf-ink-3); }
    .tgf-input:focus { outline: none; }
    .tgf-input:focus-visible {
      outline: none;
      border-bottom-color: var(--tgf-accent);
    }
    /* A multi-line answer still needs an edge to show its size, but a quiet one:
       a sunken panel rather than a hard-bordered field. */
    .tgf-textarea {
      font-size: 17px;
      min-height: 112px;
      max-width: 480px;
      padding: var(--tgf-s3) var(--tgf-s4);
      resize: vertical;
      background: var(--tgf-bg-sunken);
      border: 1px solid transparent;
      border-bottom: 2px solid var(--tgf-border-strong);
      border-radius: var(--tgf-r-sm) var(--tgf-r-sm) 0 0;
    }
    .tgf-textarea:focus-visible { border-bottom-color: var(--tgf-accent); }
    /* A select must still look pressable, so it keeps a light chrome. */
    .tgf-select {
      font-size: 18px;
      max-width: 400px;
      padding: var(--tgf-s3) var(--tgf-s10) var(--tgf-s3) var(--tgf-s4);
      appearance: none;
      cursor: pointer;
      background: var(--tgf-bg-sunken);
      border: 1px solid transparent;
      border-bottom: 2px solid var(--tgf-border-strong);
      border-radius: var(--tgf-r-sm) var(--tgf-r-sm) 0 0;
    }
    .tgf-select:focus-visible { border-bottom-color: var(--tgf-accent); }

    /* ── Choices ──────────────────────────────────────────────────── */
    .tgf-fieldset { border: 0; margin: 0; padding: 0; min-width: 0; }
    .tgf-choices { display: flex; flex-direction: column; gap: var(--tgf-s2); max-width: 480px; }
    .tgf-choice {
      position: relative;
      display: flex;
      align-items: center;
      gap: var(--tgf-s3);
      min-height: 52px;
      padding: var(--tgf-s3) var(--tgf-s4);
      cursor: pointer;
      font-size: 15px;
      line-height: 1.4;
      background: var(--tgf-bg);
      border: 1px solid var(--tgf-border-strong);
      border-radius: var(--tgf-r-sm);
      transition: border-color 140ms var(--tgf-ease), background-color 140ms var(--tgf-ease), transform 100ms var(--tgf-ease);
    }
    .tgf-choice:hover { border-color: var(--tgf-accent); background: var(--tgf-bg-sunken); }
    .tgf-choice:active { transform: scale(.99); }
    .tgf-choice:has(.tgf-choice-input:checked) {
      border-color: var(--tgf-accent);
      background: color-mix(in srgb, var(--tgf-accent) 7%, var(--tgf-bg));
      box-shadow: inset 0 0 0 1px var(--tgf-accent);
    }
    .tgf-choice:has(.tgf-choice-input:focus-visible) {
      border-color: var(--tgf-accent);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--tgf-accent) 18%, transparent);
    }
    /* The native control is the accessible source of truth; the letter badge is
       the visible affordance. */
    .tgf-choice-input { position: absolute; opacity: 0; width: 1px; height: 1px; margin: 0; }
    .tgf-choice-key {
      flex: none;
      width: 24px; height: 24px;
      display: grid; place-items: center;
      border: 1px solid var(--tgf-border-strong);
      border-radius: 6px;
      font-size: 11px; font-weight: 600; line-height: 1;
      color: var(--tgf-ink-3);
      background: var(--tgf-bg);
      transition: border-color 140ms var(--tgf-ease), color 140ms var(--tgf-ease), background-color 140ms var(--tgf-ease);
    }
    .tgf-choice:has(.tgf-choice-input:checked) .tgf-choice-key {
      border-color: var(--tgf-accent);
      background: var(--tgf-accent);
      color: var(--tgf-accent-ink);
    }
    .tgf-choice-label { flex: 1 1 auto; color: var(--tgf-ink); }

    /* ── Rating ───────────────────────────────────────────────────── */
    .tgf-stars { display: flex; gap: var(--tgf-s1); }
    .tgf-star {
      position: relative;
      /* 44px hit area even though the glyph is smaller. */
      width: 44px; height: 44px;
      display: grid; place-items: center;
      cursor: pointer;
      border-radius: var(--tgf-r-sm);
      transition: transform 120ms var(--tgf-ease);
    }
    .tgf-star:hover { transform: translateY(-1px); }
    .tgf-star:active { transform: scale(.94); }
    .tgf-star-mark { font-size: 32px; line-height: 1; color: var(--tgf-ink-3); transition: color 120ms var(--tgf-ease); }
    .tgf-star.is-on .tgf-star-mark { color: var(--tgf-accent); }
    .tgf-star:has(.tgf-choice-input:focus-visible) {
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--tgf-accent) 18%, transparent);
    }

    /* ── Opinion scale ────────────────────────────────────────────── */
    .tgf-scale { display: flex; flex-wrap: wrap; gap: var(--tgf-s1); }
    .tgf-scale-item { position: relative; cursor: pointer; }
    .tgf-scale-num {
      display: grid; place-items: center;
      min-width: 44px; height: 44px;
      padding: 0 var(--tgf-s2);
      background: var(--tgf-bg);
      border: 1px solid var(--tgf-border-strong);
      border-radius: var(--tgf-r-sm);
      font-size: 15px; font-weight: 500;
      font-variant-numeric: tabular-nums;
      color: var(--tgf-ink);
      transition: border-color 140ms var(--tgf-ease), background-color 140ms var(--tgf-ease), color 140ms var(--tgf-ease), transform 100ms var(--tgf-ease);
    }
    .tgf-scale-item:hover .tgf-scale-num { border-color: var(--tgf-accent); }
    .tgf-scale-item:active .tgf-scale-num { transform: scale(.96); }
    .tgf-scale-item:has(.tgf-choice-input:checked) .tgf-scale-num {
      background: var(--tgf-accent);
      border-color: var(--tgf-accent);
      color: var(--tgf-accent-ink);
    }
    .tgf-scale-item:has(.tgf-choice-input:focus-visible) .tgf-scale-num {
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--tgf-accent) 18%, transparent);
    }
    .tgf-scale-labels {
      display: flex; justify-content: space-between;
      max-width: 480px; margin-top: var(--tgf-s2);
      font-size: 13px; color: var(--tgf-ink-3);
    }

    /* ── Consent ──────────────────────────────────────────────────── */
    .tgf-consent {
      display: flex; gap: var(--tgf-s3); align-items: flex-start;
      max-width: 520px; min-height: 44px; padding: var(--tgf-s2) 0;
      font-size: 15px; line-height: 1.6; color: var(--tgf-ink-2); cursor: pointer;
    }
    .tgf-consent-input {
      flex: none; width: 20px; height: 20px; margin: 2px 0 0;
      accent-color: var(--tgf-accent); cursor: pointer;
    }
    .tgf-consent-input:focus-visible {
      outline: none;
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--tgf-accent) 18%, transparent);
      border-radius: 4px;
    }

    /* ── Error ────────────────────────────────────────────────────── */
    /* Reserves no space when empty, so the layout does not jump. */
    .tgf-err {
      margin: 0;
      font-size: 13px;
      font-weight: 500;
      line-height: 1.5;
      color: var(--tgf-danger);
    }
    .tgf-err:not(:empty) { margin-top: var(--tgf-s2); }

    /* ── Footer ───────────────────────────────────────────────────── */
    .tgf-foot {
      display: flex; align-items: center; gap: var(--tgf-s3); flex-wrap: wrap;
      /* The actions need real air above them: the answer was breathing and the
         buttons were crowding it. NO horizontal padding — this sits inside the
         already-padded stage, and its own padding was indenting the buttons a
         further 32px, so OK sat proud of the question's left edge. */
      margin-top: var(--tgf-s8);
      padding: 0;
    }
    .tgf-foot--inline { margin-top: var(--tgf-s6); padding: 0; }
    .tgf-btn {
      font: inherit;
      font-size: 15px; font-weight: 600; line-height: 1;
      min-height: 44px;
      padding: 0 var(--tgf-s5);
      display: inline-flex; align-items: center; justify-content: center; gap: var(--tgf-s2);
      border: 1px solid transparent;
      border-radius: var(--tgf-r-sm);
      background: var(--tgf-accent);
      color: var(--tgf-accent-ink);
      cursor: pointer;
      text-decoration: none;
      transition: filter 140ms var(--tgf-ease), transform 100ms var(--tgf-ease), box-shadow 140ms var(--tgf-ease);
    }
    .tgf-btn:hover { filter: brightness(1.08); }
    .tgf-btn:active { transform: translateY(1px); }
    .tgf-btn:focus-visible {
      outline: none;
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--tgf-accent) 28%, transparent);
    }
    .tgf-btn[disabled] { opacity: .55; cursor: default; pointer-events: none; }
    .tgf-btn--ghost {
      background: transparent;
      color: var(--tgf-ink-2);
      border-color: var(--tgf-border-strong);
    }
    .tgf-btn--ghost:hover { filter: none; border-color: var(--tgf-accent); color: var(--tgf-ink); }
    /* Sits immediately after the button it describes. Pushed to the far edge it
       read as an orphaned label belonging to nothing. */
    .tgf-hint {
      font-size: 13px;
      color: var(--tgf-ink-3);
      white-space: nowrap;
    }
    .tgf-hint b { font-weight: 600; color: var(--tgf-ink-2); }

    /* ── Mobile ───────────────────────────────────────────────────── */
    @media (max-width: 560px) {
      .tgf-stage { padding: var(--tgf-s6) var(--tgf-s5); min-height: 200px; }
      .tgf-foot { margin-top: var(--tgf-s6); }
      .tgf-q { font-size: 20px; max-width: none; }
      .tgf-hint { display: none; }
      .tgf-btn { flex: 1 1 auto; }
      .tgf-btn--ghost { flex: 0 0 auto; }
    }

    /* ── Reduced motion ───────────────────────────────────────────── */
    @media (prefers-reduced-motion: reduce) {
      .tgf-step { animation: none; }
      .tgf-progress-bar, .tgf-input, .tgf-choice, .tgf-choice-key,
      .tgf-star, .tgf-star-mark, .tgf-scale-num, .tgf-btn { transition: none; }
      .tgf-choice:active, .tgf-btn:active, .tgf-star:hover,
      .tgf-star:active, .tgf-scale-item:active .tgf-scale-num { transform: none; }
    }

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
      const accentInk = inkFor(accent);
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
        '<div class="tgf-root" data-theme="' + esc(theme) + '" style="--tgf-accent:' + esc(accent) + ';--tgf-accent-ink:' + esc(accentInk) + '">' +
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
        '<div class="tgf-foot tgf-foot--inline">' +
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
          ? '<div class="tgf-foot tgf-foot--inline"><a class="tgf-btn" data-cta href="#">' + esc(this.cfg.thankYouCtaText) + '</a></div>'
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
        // The answer sits in its own block: the gap above it is the rhythm cue
        // separating "what we asked" from "what you do".
        '<div class="tgf-answer" data-input>' + spec.input(q, id) + '</div>' +
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
