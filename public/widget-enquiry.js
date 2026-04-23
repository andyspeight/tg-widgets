/**
 * Travelgenix Enquiry Form Widget v1.0.0
 * Self-contained, embeddable form widget — part of the Travelgenix Widget Suite
 * Zero dependencies — works on any website via a single script tag
 *
 * Usage (live embed):
 *   <div data-tg-widget="enquiry" data-tg-id="YOUR_WIDGET_ID"></div>
 *   <script src="https://tg-widgets.vercel.app/widget-enquiry.js"></script>
 *
 * Usage (programmatic, e.g. from the editor preview):
 *   <script src="https://tg-widgets.vercel.app/widget-enquiry.js"></script>
 *   <script>
 *     const widget = new TGEnquiryWidget(mountEl, configObject);
 *     // later, to update:
 *     widget.update(newConfigObject);
 *     // or:
 *     widget.destroy();
 *   </script>
 *
 * The class and auto-mount both exist in parallel — live embeds use auto-mount
 * to fetch config from the API, the editor uses the class to pass config
 * directly so changes render instantly without a network round-trip.
 *
 * CONFIG SHAPE EXPECTED BY THE CLASS
 * -----------------------------------
 * {
 *   formId:       'EF-0001',              // used in submissions
 *   widgetId:     'tgw_123_abc',           // dashboard linkage
 *   name:         'Holiday Enquiry Form',
 *   header:       { title, subtitle },
 *   submitText:   'Send my enquiry',
 *   thankYou:     { mode, message, redirectUrl },
 *   branding:     { buttonColour, accentColour, theme },
 *   fieldsJSON:   '[{type, ...}, ...]',    // or array already
 *   security:     { honeypot, turnstile, turnstileSiteKey },
 * }
 */
(function () {
  'use strict';

  var WIDGET_VERSION = '1.0.0';
  var VISITOR_ID_KEY = 'tg_visitor_id_v1';
  var TURNSTILE_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js';

  // Deduce API base from this script's src, fallback to the production host.
  // Same pattern as every other widget in the suite.
  var API_BASE = (function () {
    try {
      var scripts = document.getElementsByTagName('script');
      for (var i = 0; i < scripts.length; i++) {
        var src = scripts[i].getAttribute('src') || '';
        if (src.indexOf('/widget-enquiry.js') !== -1) {
          var a = document.createElement('a');
          a.href = src;
          return a.protocol + '//' + a.host;
        }
      }
    } catch (e) {}
    return 'https://tg-widgets.vercel.app';
  })();

  // Unique ID prefix per widget instance — multiple widgets on the same page
  // must not collide on generated element IDs (aria-describedby etc.)
  var INSTANCE_COUNTER = 0;

  // ============================================================================
  //  Utilities
  // ============================================================================

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
        var v = attrs[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k.indexOf('on') === 0 && typeof v === 'function') {
          node.addEventListener(k.slice(2), v);
        } else if (k === 'style' && typeof v === 'object') {
          for (var s in v) node.style[s] = v[s];
        } else if (v === true) {
          node.setAttribute(k, '');
        } else {
          node.setAttribute(k, String(v));
        }
      }
    }
    if (children) {
      if (!Array.isArray(children)) children = [children];
      for (var j = 0; j < children.length; j++) {
        var c = children[j];
        if (c === null || c === undefined || c === false) continue;
        if (typeof c === 'string' || typeof c === 'number') {
          node.appendChild(document.createTextNode(String(c)));
        } else if (c.nodeType) {
          node.appendChild(c);
        }
      }
    }
    return node;
  }

  function svg(paths, attrs) {
    attrs = attrs || {};
    var svgNs = 'http://www.w3.org/2000/svg';
    var node = document.createElementNS(svgNs, 'svg');
    node.setAttribute('viewBox', attrs.viewBox || '0 0 24 24');
    node.setAttribute('fill', attrs.fill || 'none');
    node.setAttribute('stroke', attrs.stroke || 'currentColor');
    node.setAttribute('stroke-width', attrs.strokeWidth || '2');
    node.setAttribute('stroke-linecap', 'round');
    node.setAttribute('stroke-linejoin', 'round');
    node.setAttribute('width', attrs.size || '16');
    node.setAttribute('height', attrs.size || '16');
    node.setAttribute('aria-hidden', 'true');
    if (attrs.class) node.setAttribute('class', attrs.class);
    if (typeof paths === 'string') paths = [paths];
    for (var i = 0; i < paths.length; i++) {
      var p = document.createElementNS(svgNs, 'path');
      p.setAttribute('d', paths[i]);
      node.appendChild(p);
    }
    return node;
  }

  function starIcon(size) {
    var svgNs = 'http://www.w3.org/2000/svg';
    var node = document.createElementNS(svgNs, 'svg');
    node.setAttribute('viewBox', '0 0 24 24');
    node.setAttribute('fill', 'currentColor');
    node.setAttribute('width', size || 14);
    node.setAttribute('height', size || 14);
    node.setAttribute('aria-hidden', 'true');
    var p = document.createElementNS(svgNs, 'polygon');
    p.setAttribute('points', '12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2');
    node.appendChild(p);
    return node;
  }

  var ICONS = {
    pin:      'M20 10c0 7-8 12-8 12s-8-5-8-12a8 8 0 0116 0zm-8 3a3 3 0 100-6 3 3 0 000 6z',
    clock:    'M12 2a10 10 0 100 20 10 10 0 000-20zm0 4v6l4 2',
    check:    'M20 6L9 17l-5-5',
    x:        'M18 6L6 18M6 6l12 12',
    plus:     'M12 5v14M5 12h14',
    minus:    'M5 12h14',
    spinner:  'M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83',
    arrow:    'M5 12h14M12 5l7 7-7 7',
    heart:    'M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z',
    wave:     'M2 12c2 0 2-4 4-4s2 4 4 4 2-4 4-4 2 4 4 4 2-4 4-4',
    building: 'M6 22V4a2 2 0 012-2h8a2 2 0 012 2v18M6 12h12M6 7h12',
    museum:   'M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z',
    utensils: 'M6 2v7m0 0c0 3 2 4 6 4s6-1 6-4V2M12 13v9',
    compass:  'M8 3v3M16 3v3M3 9l2 12h14l2-12H3z',
    users:    'M9 7a4 4 0 110 8 4 4 0 010-8zm8 14v-2a4 4 0 00-3-3.87M17 3.13a4 4 0 010 7.75',
    alert:    'M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z'
  };

  function getVisitorId() {
    try {
      var existing = localStorage.getItem(VISITOR_ID_KEY);
      if (existing && /^v_[a-f0-9]{24,}$/.test(existing)) return existing;
      var rnd = new Uint8Array(16);
      (window.crypto || window.msCrypto).getRandomValues(rnd);
      var hex = Array.prototype.map.call(rnd, function (b) {
        return b.toString(16).padStart(2, '0');
      }).join('');
      var id = 'v_' + hex;
      try { localStorage.setItem(VISITOR_ID_KEY, id); } catch (e) {}
      return id;
    } catch (e) {
      return 'v_' + Math.random().toString(16).slice(2) + Date.now().toString(16);
    }
  }

  // ============================================================================
  //  Turnstile loader (shared across instances on the same page)
  // ============================================================================

  var turnstileReady = null;
  function loadTurnstile() {
    if (turnstileReady) return turnstileReady;
    turnstileReady = new Promise(function (resolve, reject) {
      if (window.turnstile) return resolve(window.turnstile);
      var existing = document.querySelector('script[src*="challenges.cloudflare.com/turnstile"]');
      if (existing) {
        existing.addEventListener('load', function () { resolve(window.turnstile); });
        existing.addEventListener('error', function () { reject(new Error('Turnstile script failed to load')); });
        return;
      }
      var script = document.createElement('script');
      script.src = TURNSTILE_SCRIPT_URL;
      script.async = true;
      script.defer = true;
      script.addEventListener('load', function () { resolve(window.turnstile); });
      script.addEventListener('error', function () { reject(new Error('Turnstile script failed to load')); });
      document.head.appendChild(script);
    });
    return turnstileReady;
  }

  // ============================================================================
  //  Reference data — session 1 static seed. Session 3+ will fetch from Luna Brain.
  // ============================================================================

  var DESTINATIONS = [
    { group: 'Popular right now', items: [
      { id: 'maldives',    name: 'Maldives',       meta: 'Country' },
      { id: 'santorini',   name: 'Santorini',      meta: 'Island · Greece' },
      { id: 'mykonos',     name: 'Mykonos',        meta: 'Island · Greece' },
      { id: 'dubai',       name: 'Dubai',          meta: 'City · UAE' },
      { id: 'barbados',    name: 'Barbados',       meta: 'Caribbean' }
    ]},
    { group: 'Europe', items: [
      { id: 'algarve',     name: 'Algarve',        meta: 'Region · Portugal' },
      { id: 'amalfi',      name: 'Amalfi Coast',   meta: 'Region · Italy' },
      { id: 'ibiza',       name: 'Ibiza',          meta: 'Island · Spain' },
      { id: 'crete',       name: 'Crete',          meta: 'Island · Greece' },
      { id: 'tenerife',    name: 'Tenerife',       meta: 'Island · Spain' },
      { id: 'lanzarote',   name: 'Lanzarote',      meta: 'Island · Spain' }
    ]},
    { group: 'Long haul', items: [
      { id: 'bali',        name: 'Bali',           meta: 'Island · Indonesia' },
      { id: 'mauritius',   name: 'Mauritius',      meta: 'Country' },
      { id: 'thailand',    name: 'Thailand',       meta: 'Country' },
      { id: 'mexico',      name: 'Mexico',         meta: 'Country' },
      { id: 'florida',     name: 'Florida',        meta: 'Region · USA' }
    ]}
  ];

  var AIRPORTS = [
    { region: 'London & South', codes: [
      { code: 'LHR', name: 'London Heathrow' }, { code: 'LGW', name: 'London Gatwick' },
      { code: 'STN', name: 'London Stansted' }, { code: 'LTN', name: 'London Luton' },
      { code: 'LCY', name: 'London City' },     { code: 'SOU', name: 'Southampton' }
    ]},
    { region: 'Midlands & North', codes: [
      { code: 'MAN', name: 'Manchester' }, { code: 'BHX', name: 'Birmingham' },
      { code: 'EMA', name: 'East Midlands' }, { code: 'LBA', name: 'Leeds Bradford' },
      { code: 'NCL', name: 'Newcastle' }, { code: 'LPL', name: 'Liverpool' }
    ]},
    { region: 'Scotland', codes: [
      { code: 'EDI', name: 'Edinburgh' }, { code: 'GLA', name: 'Glasgow' }, { code: 'ABZ', name: 'Aberdeen' }
    ]},
    { region: 'Southwest, Wales & NI', codes: [
      { code: 'BRS', name: 'Bristol' }, { code: 'CWL', name: 'Cardiff' }, { code: 'BFS', name: 'Belfast' }
    ]}
  ];

  var INTEREST_OPTIONS = [
    { value: 'beach',     label: 'Beach',       icon: 'wave' },
    { value: 'city',      label: 'City',        icon: 'building' },
    { value: 'culture',   label: 'Culture',     icon: 'museum' },
    { value: 'food',      label: 'Food & wine', icon: 'utensils' },
    { value: 'adventure', label: 'Adventure',   icon: 'compass' },
    { value: 'family',    label: 'Family',      icon: 'users' },
    { value: 'wellness',  label: 'Wellness',    icon: 'pin' },
    { value: 'honeymoon', label: 'Honeymoon',   icon: 'heart' }
  ];

  var BOARD_OPTIONS = [
    { value: 'RO', label: 'Room only' }, { value: 'BB', label: 'B&B' },
    { value: 'HB', label: 'Half board' }, { value: 'FB', label: 'Full board' },
    { value: 'AI', label: 'All inclusive' }
  ];

  var STAR_OPTIONS = [
    { stars: 3, label: 'Comfortable', desc: '3-star. Great value.' },
    { stars: 4, label: 'Superior',    desc: '4-star. The sweet spot.', preselect: true },
    { stars: 5, label: 'Luxury',      desc: '5-star. The full treatment.', luxury: true }
  ];

  // ============================================================================
  //  Default field set — used when config has no fieldsJSON
  // ============================================================================

  function defaultFieldSet() {
    return [
      { id: 'destination',       type: 'destination',       label: 'Where are you dreaming of?', required: true,  visible: true },
      { id: 'departure_airport', type: 'airport',           label: 'Departure airport',          required: true,  visible: true },
      { id: 'travel_dates',      type: 'daterange',         label: 'Travel dates',               required: true,  visible: true },
      { id: 'duration',          type: 'duration',          label: 'Duration',                   required: false, visible: true },
      { id: 'travellers',        type: 'travellers',        label: "Who's travelling?",          required: true,  visible: true },
      { id: 'budget_pp',         type: 'budget',            label: 'Approximate total budget',   required: false, visible: true },
      { id: 'stars',             type: 'stars',             label: 'Star rating preference',     required: false, visible: true },
      { id: 'board',             type: 'board',             label: 'Board basis',                required: false, visible: true },
      { id: 'interests',         type: 'interests',         label: 'Interests',                  required: false, visible: true },
      { id: 'name',              type: 'name',              label: 'Your name',                  required: true,  visible: true },
      { id: 'contact',           type: 'contact',           label: 'How to reach you',           required: true,  visible: true },
      { id: 'notes',             type: 'notes',             label: 'Anything else?',             required: false, visible: true },
      { id: 'consent',           type: 'consent',           label: 'Consent',                    required: true,  visible: true }
    ];
  }

  // ============================================================================
  //  Styles — scoped to shadow DOM (same CSS as v0.3.0)
  // ============================================================================

  function buildStyles(brand) {
    var accent = (brand && brand.accentColour) || '#00B4D8';
    var primary = (brand && brand.buttonColour) || '#1B2B5B';
    var isDark = (brand && brand.theme) === 'dark';

    var c = isDark ? {
      bg: '#0F172A', bgAlt: '#1E293B', bgTile: '#334155',
      border: '#334155', borderLight: '#1E293B',
      text: '#F8FAFC', textSecondary: '#CBD5E1', textTertiary: '#64748B'
    } : {
      bg: '#FFFFFF', bgAlt: '#F8FAFC', bgTile: '#F1F5F9',
      border: '#E2E8F0', borderLight: '#F1F5F9',
      text: '#0F172A', textSecondary: '#475569', textTertiary: '#94A3B8'
    };

    return [
      ':host{all:initial;display:block;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;font-size:15px;line-height:1.6;color:' + c.text + ';}',
      '*,*::before,*::after{box-sizing:border-box}',
      'button{font-family:inherit;font-size:inherit;cursor:pointer}',
      'input,select,textarea{font-family:inherit;font-size:inherit;color:inherit}',
      '.tg-card{background:' + c.bg + ';border:1px solid ' + c.border + ';border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,.06)}',
      '.tg-hero{padding:28px 32px 24px;border-bottom:1px solid ' + c.borderLight + '}',
      '.tg-hero h2{margin:0 0 6px;font-size:22px;font-weight:600;color:' + c.text + '}',
      '.tg-hero p{margin:0;color:' + c.textSecondary + ';font-size:14px}',
      '.tg-section{padding:24px 32px;border-bottom:1px solid ' + c.borderLight + '}',
      '.tg-section:last-of-type{border-bottom:none}',
      '.tg-field{margin-bottom:18px}',
      '.tg-field:last-child{margin-bottom:0}',
      '.tg-row{display:grid;grid-template-columns:1fr 1fr;gap:14px}',
      '@media(max-width:540px){.tg-row{grid-template-columns:1fr}}',
      '.tg-label{display:block;font-size:13px;font-weight:500;margin-bottom:6px;color:' + c.text + '}',
      '.tg-label .tg-opt{color:' + c.textTertiary + ';font-weight:400;margin-left:4px}',
      '.tg-help{font-size:12px;color:' + c.textTertiary + ';margin-top:6px}',
      '.tg-field-error{display:none;font-size:12px;color:#DC2626;margin-top:6px;align-items:center;gap:6px}',
      '.tg-field-error.is-shown{display:flex}',
      '.tg-field-error svg{flex-shrink:0;width:14px;height:14px}',
      '.tg-field.has-error .tg-input,.tg-field.has-error .tg-textarea,.tg-field.has-error .tg-dest-box{border-color:#DC2626}',
      '.tg-summary-error{display:none;margin:0 32px 0;padding:12px 14px;background:#FEF2F2;border:1px solid #FECACA;border-radius:8px;color:#991B1B;font-size:13px;align-items:flex-start;gap:10px}',
      '.tg-summary-error.is-shown{display:flex}',
      '.tg-summary-error svg{flex-shrink:0;margin-top:2px;color:#DC2626}',
      '.tg-input{width:100%;height:44px;padding:0 14px;border:1px solid ' + c.border + ';border-radius:8px;background:' + c.bg + ';color:' + c.text + ';transition:border-color .15s,box-shadow .15s;outline:none}',
      '.tg-input:focus{border-color:' + accent + ';box-shadow:0 0 0 3px ' + accent + '26}',
      '.tg-input::placeholder{color:' + c.textTertiary + '}',
      '.tg-textarea{width:100%;min-height:96px;padding:12px 14px;border:1px solid ' + c.border + ';border-radius:8px;background:' + c.bg + ';color:' + c.text + ';line-height:1.55;resize:vertical;outline:none;transition:border-color .15s,box-shadow .15s;font-family:inherit;font-size:15px}',
      '.tg-textarea:focus{border-color:' + accent + ';box-shadow:0 0 0 3px ' + accent + '26}',
      '.tg-textarea::placeholder{color:' + c.textTertiary + '}',
      '.tg-dest{position:relative}',
      '.tg-dest-box{min-height:44px;padding:6px 8px 6px 14px;border:1px solid ' + c.border + ';border-radius:8px;background:' + c.bg + ';display:flex;flex-wrap:wrap;gap:6px;align-items:center;cursor:text;transition:border-color .15s,box-shadow .15s}',
      '.tg-dest-box.is-focus{border-color:' + accent + ';box-shadow:0 0 0 3px ' + accent + '26}',
      '.tg-chip{display:inline-flex;align-items:center;gap:6px;padding:4px 6px 4px 10px;border-radius:999px;background:' + accent + '1A;color:' + accent + ';font-size:13px;font-weight:500}',
      '.tg-chip svg{width:12px;height:12px}',
      '.tg-chip-close{background:none;border:none;padding:2px;cursor:pointer;color:inherit;opacity:.7;display:flex;border-radius:50%}',
      '.tg-chip-close:hover,.tg-chip-close:focus{opacity:1;background:' + accent + '26;outline:none}',
      '.tg-chip-close svg{width:10px;height:10px}',
      '.tg-dest-input{flex:1;min-width:120px;border:none;outline:none;background:transparent;padding:6px 4px;height:auto}',
      '.tg-dest-drop{position:absolute;top:calc(100% + 4px);left:0;right:0;background:' + c.bg + ';border:1px solid ' + c.border + ';border-radius:8px;box-shadow:0 12px 28px rgba(15,23,42,.12);max-height:280px;overflow-y:auto;z-index:10;display:none}',
      '.tg-dest-drop.is-open{display:block}',
      '.tg-dest-grouplabel{padding:10px 14px 4px;font-size:11px;font-weight:600;color:' + c.textTertiary + ';text-transform:uppercase;letter-spacing:.06em}',
      '.tg-dest-option{padding:10px 14px;cursor:pointer;font-size:14px;display:flex;align-items:center;gap:10px;color:' + c.text + ';border:none;background:none;width:100%;text-align:left}',
      '.tg-dest-option:hover,.tg-dest-option.is-active{background:' + c.bgTile + ';outline:none}',
      '.tg-dest-option-meta{color:' + c.textTertiary + ';font-size:12px;margin-left:auto}',
      '.tg-chips{display:flex;flex-wrap:wrap;gap:8px}',
      '.tg-pill{height:40px;padding:0 16px;border-radius:999px;border:1px solid ' + c.border + ';background:' + c.bg + ';color:' + c.textSecondary + ';font-size:14px;font-weight:500;display:inline-flex;align-items:center;gap:6px;transition:all .15s;cursor:pointer}',
      '.tg-pill:hover{border-color:' + accent + ';color:' + c.text + '}',
      '.tg-pill:focus-visible{outline:none;box-shadow:0 0 0 3px ' + accent + '33}',
      '.tg-pill.is-active{background:' + primary + ';border-color:' + primary + ';color:#fff}',
      '.tg-pill.is-active svg{color:#fff}',
      '.tg-pill svg{width:14px;height:14px}',
      '.tg-trav-row{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border:1px solid ' + c.border + ';border-radius:8px;background:' + c.bg + ';margin-bottom:8px}',
      '.tg-trav-row:last-of-type{margin-bottom:0}',
      '.tg-trav-meta h4{font-size:14px;font-weight:600;margin:0;color:' + c.text + '}',
      '.tg-trav-meta p{font-size:12px;color:' + c.textTertiary + ';margin:2px 0 0}',
      '.tg-stepper{display:inline-flex;align-items:center;gap:4px;background:' + c.bgTile + ';padding:4px;border-radius:8px}',
      '.tg-step-btn{width:28px;height:28px;border:none;background:' + c.bg + ';border-radius:6px;display:flex;align-items:center;justify-content:center;color:' + c.textSecondary + ';box-shadow:0 1px 2px rgba(15,23,42,.06);cursor:pointer;transition:all .15s}',
      '.tg-step-btn:hover:not(:disabled){color:' + accent + '}',
      '.tg-step-btn:focus-visible{outline:none;box-shadow:0 0 0 2px ' + accent + '}',
      '.tg-step-btn:disabled{opacity:.35;cursor:not-allowed}',
      '.tg-step-val{min-width:26px;text-align:center;font-variant-numeric:tabular-nums;font-weight:600;font-size:14px;color:' + c.text + '}',
      '.tg-child-ages{margin-top:14px;padding:14px;border:1px dashed ' + c.border + ';border-radius:8px;background:' + c.bgAlt + '}',
      '.tg-child-ages-title{font-size:13px;font-weight:500;margin:0 0 10px;color:' + c.text + '}',
      '.tg-child-ages-grid{display:flex;flex-wrap:wrap;gap:10px}',
      '.tg-child-age-item{display:flex;flex-direction:column;gap:4px;min-width:110px}',
      '.tg-child-age-item label{font-size:11px;color:' + c.textTertiary + ';font-weight:500;text-transform:uppercase;letter-spacing:.04em}',
      '.tg-child-age-item select{height:36px;padding:0 10px;border:1px solid ' + c.border + ';border-radius:6px;background:' + c.bg + ';color:' + c.text + ';font-size:13px;outline:none}',
      '.tg-child-age-item select:focus{border-color:' + accent + ';box-shadow:0 0 0 2px ' + accent + '26}',
      '.tg-flex-toggle{display:inline-flex;align-items:center;gap:10px;margin-top:12px;font-size:13px;color:' + c.textSecondary + ';cursor:pointer;user-select:none;position:relative}',
      '.tg-flex-toggle input{position:absolute;opacity:0;pointer-events:none}',
      '.tg-flex-track{width:34px;height:20px;background:' + c.bgTile + ';border-radius:999px;position:relative;transition:background-color .2s;flex-shrink:0}',
      '.tg-flex-track::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;background:#fff;border-radius:50%;box-shadow:0 1px 3px rgba(15,23,42,.15);transition:transform .2s}',
      '.tg-flex-toggle input:checked ~ .tg-flex-track{background:' + accent + '}',
      '.tg-flex-toggle input:checked ~ .tg-flex-track::after{transform:translateX(14px)}',
      '.tg-flex-toggle input:focus-visible ~ .tg-flex-track{box-shadow:0 0 0 3px ' + accent + '33}',
      '.tg-budget-display{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:10px}',
      '.tg-budget-amount{font-size:24px;font-weight:700;color:' + accent + ';font-variant-numeric:tabular-nums}',
      '.tg-budget-pp{font-size:13px;color:' + c.textSecondary + '}',
      '.tg-range{-webkit-appearance:none;appearance:none;width:100%;height:6px;background:' + c.bgTile + ';border-radius:999px;outline:none;margin:0}',
      '.tg-range::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:22px;height:22px;background:' + accent + ';border-radius:50%;cursor:pointer;border:3px solid ' + c.bg + ';box-shadow:0 2px 6px rgba(15,23,42,.15);transition:transform .15s}',
      '.tg-range::-webkit-slider-thumb:hover{transform:scale(1.1)}',
      '.tg-range::-moz-range-thumb{width:22px;height:22px;background:' + accent + ';border-radius:50%;cursor:pointer;border:3px solid ' + c.bg + ';box-shadow:0 2px 6px rgba(15,23,42,.15)}',
      '.tg-range:focus{outline:none}',
      '.tg-range:focus::-webkit-slider-thumb{box-shadow:0 0 0 4px ' + accent + '33,0 2px 6px rgba(15,23,42,.15)}',
      '.tg-budget-markers{display:flex;justify-content:space-between;margin-top:8px;font-size:11px;color:' + c.textTertiary + ';font-variant-numeric:tabular-nums}',
      '.tg-star-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}',
      '@media(max-width:700px){.tg-star-grid{grid-template-columns:repeat(2,1fr)}}',
      '@media(max-width:420px){.tg-star-grid{grid-template-columns:1fr}}',
      '.tg-star-card{padding:14px;border:1px solid ' + c.border + ';border-radius:8px;background:' + c.bg + ';cursor:pointer;text-align:left;transition:all .15s;font-family:inherit;color:inherit}',
      '.tg-star-card:hover{border-color:' + accent + '}',
      '.tg-star-card:focus-visible{outline:none;border-color:' + accent + ';box-shadow:0 0 0 3px ' + accent + '33}',
      '.tg-star-card.is-active{border-color:' + accent + ';background:' + accent + '0D;box-shadow:0 0 0 3px ' + accent + '1A}',
      '.tg-star-icons{display:flex;gap:2px;margin-bottom:8px;color:#F59E0B}',
      '.tg-star-card.luxury .tg-star-icons{color:' + accent + '}',
      '.tg-star-card h4{font-size:14px;font-weight:600;margin:0 0 2px;color:' + c.text + '}',
      '.tg-star-card p{font-size:12px;color:' + c.textTertiary + ';margin:0}',
      '.tg-seg{display:flex;padding:4px;background:' + c.bgTile + ';border-radius:8px;width:100%;gap:2px}',
      '.tg-seg-btn{flex:1;height:36px;padding:0 10px;border:none;background:transparent;border-radius:6px;font-weight:500;font-size:13px;color:' + c.textSecondary + ';cursor:pointer;transition:all .15s;white-space:nowrap}',
      '.tg-seg-btn:hover{color:' + c.text + '}',
      '.tg-seg-btn:focus-visible{outline:none;box-shadow:0 0 0 2px ' + accent + ' inset}',
      '.tg-seg-btn.is-active{background:' + c.bg + ';color:' + c.text + ';box-shadow:0 1px 3px rgba(15,23,42,.08)}',
      '@media(max-width:540px){.tg-seg-btn{font-size:12px;padding:0 6px}}',
      '.tg-turnstile{margin:0 32px 16px;min-height:65px;display:flex;align-items:center;justify-content:center}',
      '.tg-footer{padding:20px 32px 24px;background:' + c.bgAlt + ';display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}',
      '.tg-submit{height:48px;padding:0 22px;border:none;border-radius:8px;background:' + primary + ';color:#fff;font-size:15px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:8px;transition:all .15s;box-shadow:0 1px 0 rgba(0,0,0,.08),0 1px 3px rgba(15,23,42,.06)}',
      '.tg-submit:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 4px 12px rgba(15,23,42,.12)}',
      '.tg-submit:focus-visible{outline:none;box-shadow:0 0 0 3px ' + accent + '66}',
      '.tg-submit:disabled{opacity:.6;cursor:not-allowed;transform:none}',
      '.tg-submit .tg-spin{animation:tg-spin 1s linear infinite}',
      '@keyframes tg-spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}',
      '.tg-trust{display:flex;gap:12px;font-size:11px;color:' + c.textTertiary + '}',
      '.tg-trust span{display:inline-flex;align-items:center;gap:4px}',
      '.tg-honeypot{position:absolute!important;left:-9999px!important;width:1px!important;height:1px!important;overflow:hidden!important;opacity:0!important;pointer-events:none!important}',
      '.tg-check{display:flex;align-items:flex-start;gap:12px;padding:12px 14px;border:1px solid ' + c.border + ';border-radius:8px;cursor:pointer;transition:border-color .15s}',
      '.tg-check:hover{border-color:' + accent + '}',
      '.tg-check:focus-within{border-color:' + accent + ';box-shadow:0 0 0 3px ' + accent + '26}',
      '.tg-check input{width:18px;height:18px;accent-color:' + accent + ';margin:2px 0 0;flex-shrink:0;cursor:pointer}',
      '.tg-check-text{font-size:13px;color:' + c.textSecondary + ';line-height:1.5}',
      '.tg-check-text strong{color:' + c.text + ';font-weight:500}',
      '.tg-loading{padding:48px;text-align:center;color:' + c.textTertiary + '}',
      '.tg-loading svg{animation:tg-spin 1s linear infinite;margin-bottom:8px}',
      '.tg-oops{padding:48px 32px;text-align:center}',
      '.tg-oops h3{font-size:18px;font-weight:600;margin:0 0 8px;color:' + c.text + '}',
      '.tg-oops p{color:' + c.textSecondary + ';margin:0 0 16px;font-size:14px}',
      '.tg-ty{padding:48px 32px;text-align:center}',
      '.tg-ty-hero{width:64px;height:64px;margin:0 auto 18px;border-radius:50%;background:linear-gradient(135deg,#10B981,#059669);display:flex;align-items:center;justify-content:center;color:#fff;box-shadow:0 8px 24px rgba(16,185,129,.3)}',
      '.tg-ty-hero svg{width:28px;height:28px}',
      '.tg-ty h2{font-size:26px;font-weight:600;margin:0 0 6px;color:' + c.text + '}',
      '.tg-ty-ref{display:inline-block;padding:4px 12px;margin-top:12px;background:' + c.bgTile + ';border-radius:999px;font-size:12px;font-weight:500;color:' + c.textSecondary + ';font-variant-numeric:tabular-nums;letter-spacing:.04em}',
      '.tg-ty > p{font-size:15px;color:' + c.textSecondary + ';max-width:420px;margin:12px auto 0}',
      '.tg-brand{text-align:center;padding:16px 0 0;font-size:11px;color:' + c.textTertiary + '}',
      '.tg-brand strong{color:' + c.textSecondary + ';font-weight:500}',
      '.tg-brand a{color:' + c.textTertiary + ';text-decoration:none}',
      '.tg-brand a:hover{color:' + c.textSecondary + '}',
      '.tg-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}',
      '@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}'
    ].join('\n');
  }

  // ============================================================================
  //  Field renderers
  //
  //  Each renderer returns:
  //    { node, writeTo(fields), validate(), showError(msg), clearError(), focus(), type }
  //
  //  The `type` marker identifies which renderer this is, used by the editor's
  //  field inspector to know what config options to show.
  // ============================================================================

  function createFieldShell(instance, labelText, labelExtras) {
    var errorId = 'tg-' + instance + '-err-' + (++INSTANCE_COUNTER);
    var errorNode = el('div', { class: 'tg-field-error', id: errorId, role: 'alert' }, [
      svg(ICONS.alert, { size: 14 }),
      el('span', { class: 'tg-field-error-text' })
    ]);
    var labelChildren = [labelText];
    if (labelExtras) labelChildren = labelChildren.concat(labelExtras);
    var fieldNode = el('div', { class: 'tg-field' }, [
      labelText ? el('label', { class: 'tg-label' }, labelChildren) : null
    ]);
    return {
      fieldNode: fieldNode,
      errorNode: errorNode,
      errorId: errorId,
      show: function (msg) {
        fieldNode.classList.add('has-error');
        errorNode.classList.add('is-shown');
        errorNode.querySelector('.tg-field-error-text').textContent = msg;
      },
      clear: function () {
        fieldNode.classList.remove('has-error');
        errorNode.classList.remove('is-shown');
      }
    };
  }

  // NOTE: All 12 renderer implementations (destination, airport, daterange,
  // duration, travellers, budget, stars, board, interests, name, contact,
  // notes, consent) are identical to widget v0.3.0 — lifted byte-for-byte.
  // Only the outer shell (class wrapper, mount, update) has been refactored.

  function renderDestination(instance, fieldSpec) {
    var destinations = [];
    var shell = createFieldShell(instance, fieldSpec.label || 'Where are you dreaming of?');
    var input = el('input', {
      class: 'tg-dest-input', type: 'text',
      placeholder: 'Search countries, cities, resorts...',
      autocomplete: 'off',
      'aria-label': 'Search destinations',
      'aria-expanded': 'false',
      'aria-autocomplete': 'list',
      role: 'combobox'
    });
    var box = el('div', { class: 'tg-dest-box' }, [input]);
    var drop = el('div', { class: 'tg-dest-drop', role: 'listbox' });
    var activeIndex = -1;
    var visibleOptions = [];

    function renderChips() {
      Array.prototype.slice.call(box.querySelectorAll('.tg-chip')).forEach(function (c) { c.remove(); });
      destinations.forEach(function (d) {
        var closeBtn = el('button', {
          class: 'tg-chip-close', type: 'button',
          'aria-label': 'Remove ' + d.name,
          onclick: function (e) {
            e.stopPropagation();
            destinations = destinations.filter(function (x) { return x.id !== d.id; });
            renderChips();
            shell.clear();
          }
        }, [svg(ICONS.x)]);
        var chip = el('span', { class: 'tg-chip', role: 'listitem' }, [svg(ICONS.pin), d.name, closeBtn]);
        box.insertBefore(chip, input);
      });
    }

    function renderDrop(query) {
      drop.innerHTML = '';
      visibleOptions = [];
      activeIndex = -1;
      var q = (query || '').toLowerCase().trim();
      var any = false;
      DESTINATIONS.forEach(function (group) {
        var matching = group.items.filter(function (item) {
          if (destinations.find(function (d) { return d.id === item.id; })) return false;
          if (!q) return true;
          return item.name.toLowerCase().indexOf(q) !== -1 ||
                 (item.meta || '').toLowerCase().indexOf(q) !== -1;
        });
        if (!matching.length) return;
        any = true;
        drop.appendChild(el('div', { class: 'tg-dest-grouplabel', 'aria-hidden': 'true', text: group.group }));
        matching.forEach(function (item) {
          var opt = el('button', {
            class: 'tg-dest-option', type: 'button',
            role: 'option',
            'aria-selected': 'false',
            onmousedown: function (e) { e.preventDefault(); },
            onclick: function () { selectDestination(item); }
          }, [
            el('span', { text: item.name }),
            el('span', { class: 'tg-dest-option-meta', text: item.meta })
          ]);
          drop.appendChild(opt);
          visibleOptions.push({ node: opt, item: item });
        });
      });
      if (!any) {
        drop.appendChild(el('div', { style: { padding: '14px', fontSize: '13px' }, text: 'No matches' }));
      }
    }

    function selectDestination(item) {
      destinations.push({ id: item.id, name: item.name, region: item.meta });
      input.value = '';
      renderChips();
      renderDrop('');
      shell.clear();
      input.focus();
    }

    function setActiveOption(idx) {
      visibleOptions.forEach(function (o, i) {
        o.node.classList.toggle('is-active', i === idx);
        o.node.setAttribute('aria-selected', i === idx ? 'true' : 'false');
      });
      if (idx >= 0 && visibleOptions[idx]) {
        var elt = visibleOptions[idx].node;
        var elRect = elt.getBoundingClientRect();
        var dropRect = drop.getBoundingClientRect();
        if (elRect.bottom > dropRect.bottom) elt.scrollIntoView({ block: 'end' });
        else if (elRect.top < dropRect.top) elt.scrollIntoView({ block: 'start' });
      }
      activeIndex = idx;
    }

    box.addEventListener('click', function () { input.focus(); });
    input.addEventListener('focus', function () {
      box.classList.add('is-focus');
      drop.classList.add('is-open');
      input.setAttribute('aria-expanded', 'true');
      renderDrop(input.value);
    });
    input.addEventListener('blur', function () {
      setTimeout(function () {
        box.classList.remove('is-focus');
        drop.classList.remove('is-open');
        input.setAttribute('aria-expanded', 'false');
        setActiveOption(-1);
      }, 150);
    });
    input.addEventListener('input', function () { renderDrop(input.value); });
    input.addEventListener('keydown', function (e) {
      if (!visibleOptions.length) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); setActiveOption(Math.min(activeIndex + 1, visibleOptions.length - 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveOption(Math.max(activeIndex - 1, 0)); }
      else if (e.key === 'Enter' && activeIndex >= 0) { e.preventDefault(); selectDestination(visibleOptions[activeIndex].item); }
      else if (e.key === 'Escape') { input.blur(); }
    });

    shell.fieldNode.appendChild(el('div', { class: 'tg-dest' }, [box, drop]));
    if (fieldSpec.help !== false) {
      shell.fieldNode.appendChild(el('div', { class: 'tg-help', text: fieldSpec.help || 'Add one, or multiple for a twin-centre trip.' }));
    }
    shell.fieldNode.appendChild(shell.errorNode);
    input.setAttribute('aria-describedby', shell.errorId);

    return {
      type: 'destination',
      node: shell.fieldNode,
      writeTo: function (fields) { fields.destinations = destinations.slice(); },
      validate: function () {
        if (fieldSpec.required === false) return null;
        return destinations.length > 0 ? null : 'Please add at least one destination.';
      },
      showError: function (msg) { shell.show(msg); input.setAttribute('aria-invalid', 'true'); },
      clearError: function () { shell.clear(); input.removeAttribute('aria-invalid'); },
      focus: function () { input.focus(); }
    };
  }

  function renderAirport(instance, fieldSpec) {
    var shell = createFieldShell(instance, fieldSpec.label || 'Departure airport');
    var select = el('select', {
      class: 'tg-input',
      'aria-label': 'Departure airport',
      'aria-describedby': shell.errorId,
      onchange: function () { shell.clear(); select.removeAttribute('aria-invalid'); }
    }, [el('option', { value: '', text: 'Select your preferred airport' })]);
    AIRPORTS.forEach(function (region) {
      var group = document.createElement('optgroup');
      group.label = region.region;
      region.codes.forEach(function (a) {
        group.appendChild(el('option', { value: a.name + ' (' + a.code + ')', text: a.name + ' (' + a.code + ')' }));
      });
      select.appendChild(group);
    });
    var flexGroup = document.createElement('optgroup');
    flexGroup.label = 'Flexible';
    flexGroup.appendChild(el('option', { value: 'Flexible on airport', text: "I'm flexible on airport" }));
    select.appendChild(flexGroup);

    shell.fieldNode.appendChild(select);
    shell.fieldNode.appendChild(shell.errorNode);
    return {
      type: 'airport',
      node: shell.fieldNode,
      writeTo: function (fields) { fields.departure_airport = select.value; },
      validate: function () {
        if (fieldSpec.required === false) return null;
        return select.value ? null : 'Please select a departure airport.';
      },
      showError: function (msg) { shell.show(msg); select.setAttribute('aria-invalid', 'true'); },
      clearError: function () { shell.clear(); select.removeAttribute('aria-invalid'); },
      focus: function () { select.focus(); }
    };
  }

  function renderDateRange(instance, fieldSpec) {
    var shell = createFieldShell(instance, null);
    var today = new Date();
    var minDate = today.toISOString().slice(0, 10);
    var departId = 'tg-' + instance + '-depart'; var returnId = 'tg-' + instance + '-return';
    var depart = el('input', { id: departId, class: 'tg-input', type: 'date', min: minDate, 'aria-label': 'Depart on', 'aria-describedby': shell.errorId, onchange: function () { shell.clear(); depart.removeAttribute('aria-invalid'); } });
    var ret = el('input', { id: returnId, class: 'tg-input', type: 'date', min: minDate, 'aria-label': 'Return on', 'aria-describedby': shell.errorId, onchange: function () { shell.clear(); ret.removeAttribute('aria-invalid'); } });
    var flexInput = el('input', { type: 'checkbox', 'aria-label': 'Flexible by a week either side' });
    var flexTrack = el('span', { class: 'tg-flex-track', 'aria-hidden': 'true' });

    depart.addEventListener('change', function () {
      if (depart.value) { ret.min = depart.value; if (ret.value && ret.value < depart.value) ret.value = ''; }
    });

    shell.fieldNode.appendChild(el('div', { class: 'tg-row' }, [
      el('div', {}, [el('label', { class: 'tg-label', for: departId, text: 'Depart on' }), depart]),
      el('div', {}, [el('label', { class: 'tg-label', for: returnId, text: 'Return on' }), ret])
    ]));
    shell.fieldNode.appendChild(el('label', { class: 'tg-flex-toggle' }, [flexInput, flexTrack, el('span', { text: "I'm flexible by a week either side" })]));
    shell.fieldNode.appendChild(shell.errorNode);

    return {
      type: 'daterange',
      node: shell.fieldNode,
      writeTo: function (fields) {
        fields.travel_dates = { depart: depart.value || null, 'return': ret.value || null, flexible: !!flexInput.checked };
      },
      validate: function () {
        if (fieldSpec.required === false) return null;
        if (!depart.value) return 'Please choose a departure date.';
        if (ret.value && ret.value < depart.value) return 'Return date must be after departure.';
        return null;
      },
      showError: function (msg) { shell.show(msg); depart.setAttribute('aria-invalid', 'true'); },
      clearError: function () { shell.clear(); depart.removeAttribute('aria-invalid'); ret.removeAttribute('aria-invalid'); },
      focus: function () { (depart.value ? ret : depart).focus(); }
    };
  }

  function renderDuration(instance, fieldSpec) {
    var shell = createFieldShell(instance, fieldSpec.label || 'Duration');
    var selected = 7;
    var options = [3, 5, 7, 10, 14];
    var buttons = [];
    function setActive(n) {
      selected = n;
      buttons.forEach(function (b) {
        var match = parseInt(b.getAttribute('data-n'), 10) === n;
        b.classList.toggle('is-active', match);
        b.setAttribute('aria-pressed', match ? 'true' : 'false');
      });
    }
    options.forEach(function (n) {
      var btn = el('button', { class: 'tg-pill' + (n === 7 ? ' is-active' : ''), type: 'button', 'data-n': String(n), 'aria-pressed': (n === 7 ? 'true' : 'false'), text: n + ' nights', onclick: function () { setActive(n); } });
      buttons.push(btn);
    });
    shell.fieldNode.appendChild(el('div', { class: 'tg-chips', role: 'group', 'aria-label': 'Duration options' }, buttons));
    shell.fieldNode.appendChild(shell.errorNode);
    return {
      type: 'duration',
      node: shell.fieldNode,
      writeTo: function (fields) { fields.duration = { nights: selected }; },
      validate: function () { return null; },
      showError: function (msg) { shell.show(msg); },
      clearError: function () { shell.clear(); },
      focus: function () { buttons[0].focus(); }
    };
  }

  function renderTravellers(instance, fieldSpec) {
    var shell = createFieldShell(instance, fieldSpec.label || "Who's travelling?");
    var values = { adults: 2, children: 0, infants: 0, childAges: [] };
    var childAgesPanel = el('div', { class: 'tg-child-ages', style: { display: 'none' }, role: 'group', 'aria-label': 'Children ages' }, [
      el('p', { class: 'tg-child-ages-title', text: 'How old will each child be when they travel?' }),
      el('div', { class: 'tg-child-ages-grid' })
    ]);
    var agesGrid = childAgesPanel.querySelector('.tg-child-ages-grid');

    function renderChildAges() {
      agesGrid.innerHTML = '';
      for (var i = 0; i < values.children; i++) {
        var sel = el('select', { 'data-idx': String(i), onchange: (function (idx) { return function (e) { values.childAges[idx] = parseInt(e.target.value, 10); }; })(i) });
        for (var age = 2; age <= 15; age++) {
          var opt = el('option', { value: String(age), text: age + (age === 2 ? ' (youngest)' : '') + (age === 15 ? ' (oldest)' : '') });
          if (values.childAges[i] === age) opt.selected = true;
          sel.appendChild(opt);
        }
        if (values.childAges[i] === undefined) values.childAges[i] = 2;
        var id = 'tg-' + instance + '-cage-' + i;
        agesGrid.appendChild(el('div', { class: 'tg-child-age-item' }, [
          el('label', { for: id, text: 'Child ' + (i + 1) }),
          (function () { sel.setAttribute('id', id); return sel; })()
        ]));
      }
      values.childAges = values.childAges.slice(0, values.children);
      childAgesPanel.style.display = values.children > 0 ? 'block' : 'none';
    }

    function stepperRow(label, sub, key, min, max) {
      var valEl = el('span', { class: 'tg-step-val', 'aria-live': 'polite', text: String(values[key]) });
      function update() {
        valEl.textContent = String(values[key]);
        minusBtn.disabled = values[key] <= min;
        plusBtn.disabled = values[key] >= max;
        minusBtn.setAttribute('aria-label', 'Decrease ' + label + ' (currently ' + values[key] + ')');
        plusBtn.setAttribute('aria-label', 'Increase ' + label + ' (currently ' + values[key] + ')');
        if (key === 'children') renderChildAges();
        if (key === 'adults') shell.clear();
      }
      var minusBtn = el('button', { class: 'tg-step-btn', type: 'button', onclick: function () { if (values[key] > min) { values[key]--; update(); } } }, [svg(ICONS.minus, { size: 14 })]);
      var plusBtn = el('button', { class: 'tg-step-btn', type: 'button', onclick: function () { if (values[key] < max) { values[key]++; update(); } } }, [svg(ICONS.plus, { size: 14 })]);
      update();
      return el('div', { class: 'tg-trav-row' }, [
        el('div', { class: 'tg-trav-meta' }, [el('h4', { text: label }), el('p', { text: sub })]),
        el('div', { class: 'tg-stepper' }, [minusBtn, valEl, plusBtn])
      ]);
    }

    shell.fieldNode.appendChild(stepperRow('Adults', 'Age 16+', 'adults', 1, 9));
    shell.fieldNode.appendChild(stepperRow('Children', 'Age 2–15', 'children', 0, 6));
    shell.fieldNode.appendChild(stepperRow('Infants', 'Under 2', 'infants', 0, 3));
    shell.fieldNode.appendChild(childAgesPanel);
    shell.fieldNode.appendChild(shell.errorNode);

    return {
      type: 'travellers',
      node: shell.fieldNode,
      writeTo: function (fields) {
        fields.travellers = { adults: values.adults, children: values.children, infants: values.infants, childAges: values.childAges.slice(0, values.children) };
      },
      validate: function () {
        if (fieldSpec.required === false) return null;
        return values.adults > 0 ? null : 'At least one adult required.';
      },
      showError: function (msg) { shell.show(msg); },
      clearError: function () { shell.clear(); },
      focus: function () { shell.fieldNode.querySelector('.tg-step-btn').focus(); }
    };
  }

  function renderBudget(instance, fieldSpec) {
    var shell = createFieldShell(instance, fieldSpec.label || 'Approximate total budget');
    function sliderToBudget(v) {
      if (v < 25) return 250 + (v / 25) * (1500 - 250);
      if (v < 50) return 1500 + ((v - 25) / 25) * (3000 - 1500);
      if (v < 75) return 3000 + ((v - 50) / 25) * (5000 - 3000);
      return 5000 + ((v - 75) / 25) * (10000 - 5000);
    }
    var amountEl = el('span', { class: 'tg-budget-amount', 'aria-live': 'polite', text: '£3,000' });
    var range = el('input', { class: 'tg-range', type: 'range', min: '0', max: '100', value: '45', 'aria-label': 'Budget per person', 'aria-valuemin': '250', 'aria-valuemax': '10000', 'aria-valuenow': '3000', 'aria-valuetext': '£3,000 per person' });
    var currentBudget = 3000;
    function update() {
      var v = parseInt(range.value, 10);
      currentBudget = Math.round(sliderToBudget(v) / 50) * 50;
      var displayText;
      if (v >= 97) { displayText = '£10,000+'; currentBudget = 10000; }
      else displayText = '£' + currentBudget.toLocaleString('en-GB');
      amountEl.textContent = displayText;
      range.setAttribute('aria-valuenow', String(currentBudget));
      range.setAttribute('aria-valuetext', displayText + ' per person');
    }
    range.addEventListener('input', update);
    shell.fieldNode.appendChild(el('div', { class: 'tg-budget-display' }, [amountEl, el('span', { class: 'tg-budget-pp', text: 'per person' })]));
    shell.fieldNode.appendChild(range);
    shell.fieldNode.appendChild(el('div', { class: 'tg-budget-markers', 'aria-hidden': 'true' }, [
      el('span', { text: '£250' }), el('span', { text: '£1.5k' }), el('span', { text: '£3k' }), el('span', { text: '£5k+' })
    ]));
    shell.fieldNode.appendChild(shell.errorNode);
    return {
      type: 'budget',
      node: shell.fieldNode,
      writeTo: function (fields) { fields.budget_pp = currentBudget; },
      validate: function () { return null; },
      showError: function (msg) { shell.show(msg); },
      clearError: function () { shell.clear(); },
      focus: function () { range.focus(); }
    };
  }

  function renderStars(instance, fieldSpec) {
    var shell = createFieldShell(instance, fieldSpec.label || 'Star rating preference');
    var selected = 4;
    var cards = [];
    function setActive(stars) {
      selected = stars;
      cards.forEach(function (card) {
        var match = parseInt(card.getAttribute('data-stars'), 10) === stars;
        card.classList.toggle('is-active', match);
        card.setAttribute('aria-pressed', match ? 'true' : 'false');
      });
    }
    STAR_OPTIONS.forEach(function (opt) {
      var icons = el('div', { class: 'tg-star-icons', 'aria-hidden': 'true' });
      for (var i = 0; i < opt.stars; i++) icons.appendChild(starIcon(14));
      var card = el('button', {
        class: 'tg-star-card' + (opt.luxury ? ' luxury' : '') + (opt.preselect ? ' is-active' : ''),
        type: 'button', 'data-stars': String(opt.stars),
        'aria-pressed': opt.preselect ? 'true' : 'false',
        'aria-label': opt.stars + '-star — ' + opt.label + '. ' + opt.desc,
        onclick: function () { setActive(opt.stars); }
      }, [icons, el('h4', { text: opt.label }), el('p', { text: opt.desc })]);
      cards.push(card);
    });
    shell.fieldNode.appendChild(el('div', { class: 'tg-star-grid', role: 'group', 'aria-label': 'Star rating options' }, cards));
    shell.fieldNode.appendChild(shell.errorNode);
    return {
      type: 'stars',
      node: shell.fieldNode,
      writeTo: function (fields) { fields.stars = selected; },
      validate: function () { return null; },
      showError: function (msg) { shell.show(msg); },
      clearError: function () { shell.clear(); },
      focus: function () { cards[0].focus(); }
    };
  }

  function renderBoard(instance, fieldSpec) {
    var shell = createFieldShell(instance, fieldSpec.label || 'Board basis');
    var selected = 'RO';
    var buttons = [];
    function setActive(value) {
      selected = value;
      buttons.forEach(function (btn) {
        var match = btn.getAttribute('data-value') === value;
        btn.classList.toggle('is-active', match);
        btn.setAttribute('aria-pressed', match ? 'true' : 'false');
      });
    }
    BOARD_OPTIONS.forEach(function (opt) {
      var btn = el('button', {
        class: 'tg-seg-btn' + (opt.value === 'RO' ? ' is-active' : ''),
        type: 'button', 'data-value': opt.value,
        'aria-pressed': opt.value === 'RO' ? 'true' : 'false',
        'aria-label': opt.label, text: opt.label,
        onclick: function () { setActive(opt.value); }
      });
      buttons.push(btn);
    });
    shell.fieldNode.appendChild(el('div', { class: 'tg-seg', role: 'group', 'aria-label': 'Board basis options' }, buttons));
    shell.fieldNode.appendChild(shell.errorNode);
    return {
      type: 'board',
      node: shell.fieldNode,
      writeTo: function (fields) { fields.board = selected; },
      validate: function () { return null; },
      showError: function (msg) { shell.show(msg); },
      clearError: function () { shell.clear(); },
      focus: function () { buttons[0].focus(); }
    };
  }

  function renderInterests(instance, fieldSpec) {
    var shell = createFieldShell(instance, fieldSpec.label || 'Interests', [' ', el('span', { class: 'tg-opt', text: '(pick as many as apply)' })]);
    var selected = [];
    var buttons = [];
    INTEREST_OPTIONS.forEach(function (opt) {
      var btn = el('button', {
        class: 'tg-pill', type: 'button', 'data-value': opt.value,
        'aria-pressed': 'false', 'aria-label': opt.label,
        onclick: function () {
          var idx = selected.indexOf(opt.value);
          if (idx >= 0) { selected.splice(idx, 1); btn.classList.remove('is-active'); btn.setAttribute('aria-pressed', 'false'); }
          else { selected.push(opt.value); btn.classList.add('is-active'); btn.setAttribute('aria-pressed', 'true'); }
        }
      }, [svg(ICONS[opt.icon] || ICONS.pin, { size: 14 }), opt.label]);
      buttons.push(btn);
    });
    shell.fieldNode.appendChild(el('div', { class: 'tg-chips', role: 'group', 'aria-label': 'Interest options' }, buttons));
    shell.fieldNode.appendChild(shell.errorNode);
    return {
      type: 'interests',
      node: shell.fieldNode,
      writeTo: function (fields) { fields.interests = selected.slice(); },
      validate: function () { return null; },
      showError: function (msg) { shell.show(msg); },
      clearError: function () { shell.clear(); },
      focus: function () { buttons[0].focus(); }
    };
  }

  function renderName(instance, fieldSpec) {
    var shell = createFieldShell(instance, null);
    var firstId = 'tg-' + instance + '-first'; var lastId = 'tg-' + instance + '-last';
    var first = el('input', { id: firstId, class: 'tg-input', type: 'text', placeholder: 'Jane', 'aria-label': 'First name', autocomplete: 'given-name', 'aria-describedby': shell.errorId, oninput: function () { shell.clear(); first.removeAttribute('aria-invalid'); last.removeAttribute('aria-invalid'); } });
    var last = el('input', { id: lastId, class: 'tg-input', type: 'text', placeholder: 'Smith', 'aria-label': 'Last name', autocomplete: 'family-name', 'aria-describedby': shell.errorId, oninput: function () { shell.clear(); first.removeAttribute('aria-invalid'); last.removeAttribute('aria-invalid'); } });
    shell.fieldNode.appendChild(el('div', { class: 'tg-row' }, [
      el('div', {}, [el('label', { class: 'tg-label', for: firstId, text: 'First name' }), first]),
      el('div', {}, [el('label', { class: 'tg-label', for: lastId, text: 'Last name' }), last])
    ]));
    shell.fieldNode.appendChild(shell.errorNode);
    return {
      type: 'name',
      node: shell.fieldNode,
      writeTo: function (fields) { fields.first_name = first.value.trim(); fields.last_name = last.value.trim(); },
      validate: function () {
        if (fieldSpec.required === false) return null;
        if (!first.value.trim()) return 'First name required.';
        if (!last.value.trim()) return 'Last name required.';
        return null;
      },
      showError: function (msg) { shell.show(msg); if (!first.value.trim()) first.setAttribute('aria-invalid', 'true'); if (!last.value.trim()) last.setAttribute('aria-invalid', 'true'); },
      clearError: function () { shell.clear(); first.removeAttribute('aria-invalid'); last.removeAttribute('aria-invalid'); },
      focus: function () { (first.value.trim() ? last : first).focus(); }
    };
  }

  function renderContact(instance, fieldSpec) {
    var shell = createFieldShell(instance, null);
    var emailId = 'tg-' + instance + '-email'; var phoneId = 'tg-' + instance + '-phone';
    var email = el('input', { id: emailId, class: 'tg-input', type: 'email', placeholder: 'jane@example.com', 'aria-label': 'Email address', autocomplete: 'email', required: true, 'aria-describedby': shell.errorId, oninput: function () { shell.clear(); email.removeAttribute('aria-invalid'); } });
    var phone = el('input', { id: phoneId, class: 'tg-input', type: 'tel', placeholder: '07700 900000', 'aria-label': 'Phone number', autocomplete: 'tel' });
    shell.fieldNode.appendChild(el('div', { class: 'tg-row' }, [
      el('div', {}, [el('label', { class: 'tg-label', for: emailId, text: 'Email address' }), email]),
      el('div', {}, [el('label', { class: 'tg-label', for: phoneId }, ['Phone ', el('span', { class: 'tg-opt', text: '(optional)' })]), phone])
    ]));
    shell.fieldNode.appendChild(shell.errorNode);
    return {
      type: 'contact',
      node: shell.fieldNode,
      writeTo: function (fields) { fields.email = email.value.trim(); fields.phone = phone.value.trim(); },
      validate: function () {
        if (fieldSpec.required === false) return null;
        var e = email.value.trim();
        if (!e) return 'Email required.';
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return 'Please enter a valid email address.';
        return null;
      },
      showError: function (msg) { shell.show(msg); email.setAttribute('aria-invalid', 'true'); },
      clearError: function () { shell.clear(); email.removeAttribute('aria-invalid'); },
      focus: function () { email.focus(); }
    };
  }

  function renderNotes(instance, fieldSpec) {
    var shell = createFieldShell(instance, fieldSpec.label || 'Anything else we should know?', [' ', el('span', { class: 'tg-opt', text: '(optional)' })]);
    var textareaId = 'tg-' + instance + '-notes';
    var textarea = el('textarea', { id: textareaId, class: 'tg-textarea', 'aria-label': 'Notes', placeholder: fieldSpec.placeholder || 'Dietary requirements, accessibility needs, special occasions, specific resorts or hotels you have had your eye on...', maxlength: '2000' });
    var labelEl = shell.fieldNode.querySelector('.tg-label');
    if (labelEl) labelEl.setAttribute('for', textareaId);
    shell.fieldNode.appendChild(textarea);
    shell.fieldNode.appendChild(shell.errorNode);
    return {
      type: 'notes',
      node: shell.fieldNode,
      writeTo: function (fields) { var v = textarea.value.trim(); if (v) fields.notes = v; },
      validate: function () { return null; },
      showError: function (msg) { shell.show(msg); },
      clearError: function () { shell.clear(); },
      focus: function () { textarea.focus(); }
    };
  }

  function renderConsent(instance, fieldSpec) {
    var shell = createFieldShell(instance, null);
    var contactInput = el('input', { type: 'checkbox', 'aria-label': 'Agree to be contacted', onchange: function () { shell.clear(); contactInput.removeAttribute('aria-invalid'); } });
    var marketingInput = el('input', { type: 'checkbox', 'aria-label': 'Receive marketing updates' });
    shell.fieldNode.appendChild(el('label', { class: 'tg-check' }, [
      contactInput,
      el('span', { class: 'tg-check-text' }, [
        el('strong', { text: fieldSpec.contactLabel || 'I agree to be contacted about this enquiry. ' }),
        fieldSpec.contactSub || "We'll only use your details to respond to your enquiry."
      ])
    ]));
    shell.fieldNode.appendChild(el('div', { style: { height: '8px' } }));
    shell.fieldNode.appendChild(el('label', { class: 'tg-check' }, [
      marketingInput,
      el('span', { class: 'tg-check-text' }, [
        fieldSpec.marketingLabel || 'Send me occasional holiday inspiration and exclusive offers.'
      ])
    ]));
    shell.fieldNode.appendChild(shell.errorNode);
    contactInput.setAttribute('aria-describedby', shell.errorId);
    return {
      type: 'consent',
      node: shell.fieldNode,
      writeTo: function (fields) { fields.contact_consent = !!contactInput.checked; fields.marketing_consent = !!marketingInput.checked; },
      validate: function () {
        if (fieldSpec.required === false) return null;
        return contactInput.checked ? null : 'Please tick the consent box to continue.';
      },
      showError: function (msg) { shell.show(msg); contactInput.setAttribute('aria-invalid', 'true'); },
      clearError: function () { shell.clear(); contactInput.removeAttribute('aria-invalid'); },
      focus: function () { contactInput.focus(); }
    };
  }

  // Dispatch table — maps field.type string to renderer function
  var RENDERERS = {
    destination: renderDestination,
    airport:     renderAirport,
    daterange:   renderDateRange,
    duration:    renderDuration,
    travellers:  renderTravellers,
    budget:      renderBudget,
    stars:       renderStars,
    board:       renderBoard,
    interests:   renderInterests,
    name:        renderName,
    contact:     renderContact,
    notes:       renderNotes,
    consent:     renderConsent
  };

  // ============================================================================
  //  TGEnquiryWidget class — the suite-convention programmatic interface
  // ============================================================================

  function TGEnquiryWidget(container, config) {
    if (!container) {
      console.error('[TGEnquiryWidget] No container element provided');
      return;
    }
    this.instance = ++INSTANCE_COUNTER;
    this.container = container;
    this.config = this._normalise(config || {});
    this.shadow = container.attachShadow ? container.attachShadow({ mode: 'open' }) : container;
    this._render();
  }

  // Convert the API response / editor config shape into a normalised form
  // the renderers can consume. Tolerates missing or partial input.
  TGEnquiryWidget.prototype._normalise = function (config) {
    var normalised = {
      formId:     config.formId || '',
      widgetId:   config.widgetId || '',
      name:       config.name || 'Enquiry form',
      header:     config.header || { title: 'Tell us about your dream holiday', subtitle: 'Share a few details and one of our travel specialists will come back within 24 hours.' },
      submitText: config.submitText || 'Send my enquiry',
      thankYou:   config.thankYou || { mode: 'inline', message: "Thanks {firstName} — we're on it" },
      branding:   config.branding || { buttonColour: '#1B2B5B', accentColour: '#00B4D8', theme: 'light' },
      security:   config.security || { honeypot: true, turnstile: false }
    };
    // fieldsJSON might arrive as a JSON string or a plain array
    var fields = config.fieldsJSON;
    if (typeof fields === 'string') {
      try { fields = JSON.parse(fields); }
      catch (e) { console.warn('[TGEnquiryWidget] fieldsJSON parse failed, falling back to defaults'); fields = null; }
    }
    if (!Array.isArray(fields) || fields.length === 0) fields = defaultFieldSet();
    normalised.fields = fields;
    return normalised;
  };

  // Clear shadow DOM and rebuild from config. Used by update() + initial render.
  TGEnquiryWidget.prototype._render = function () {
    var shadow = this.shadow;
    while (shadow.firstChild) shadow.removeChild(shadow.firstChild);

    var config = this.config;
    var instance = this.instance;
    var fields = [];
    var self = this;

    // Inject styles
    shadow.appendChild(el('style', { text: buildStyles(config.branding) }));

    // Build card
    var card = el('div', { class: 'tg-card' });
    card.appendChild(el('div', { class: 'tg-hero' }, [
      el('h2', { text: config.header.title || '' }),
      el('p', { text: config.header.subtitle || '' })
    ]));

    // Section for all fields — for now, all fields in one section. Post-MVP the
    // editor will support organising into multiple sections.
    var section = el('div', { class: 'tg-section' });
    config.fields.forEach(function (fieldSpec) {
      if (fieldSpec.visible === false) return;
      var renderer = RENDERERS[fieldSpec.type];
      if (!renderer) {
        console.warn('[TGEnquiryWidget] Unknown field type:', fieldSpec.type);
        return;
      }
      var inst = renderer(instance, fieldSpec);
      fields.push(inst);
      section.appendChild(inst.node);
    });
    card.appendChild(section);

    // Honeypot — always present, visually hidden
    var honeypot = el('input', {
      class: 'tg-honeypot', type: 'text', name: 'website_url',
      tabindex: '-1', autocomplete: 'off', 'aria-hidden': 'true'
    });
    card.appendChild(honeypot);

    // Summary error banner (multiple errors)
    var summaryError = el('div', { class: 'tg-summary-error', role: 'alert', 'aria-live': 'assertive' }, [
      svg(ICONS.alert, { size: 16 }),
      el('span', { class: 'tg-summary-error-text' })
    ]);
    card.appendChild(summaryError);

    // Turnstile container — rendered only if security.turnstile === true
    var turnstileContainer = null;
    var turnstileToken = null;
    var turnstileWidgetId = null;
    if (config.security && config.security.turnstile) {
      turnstileContainer = el('div', { class: 'tg-turnstile' });
      card.appendChild(turnstileContainer);
    }

    // Submit button
    var submitBtn = el('button', { class: 'tg-submit', type: 'button', onclick: function () { self._handleSubmit(fields, honeypot, summaryError, submitBtn, function () { return turnstileToken; }); } }, [
      el('span', { text: config.submitText }),
      svg(ICONS.arrow, { size: 16 })
    ]);
    card.appendChild(el('div', { class: 'tg-footer' }, [
      el('div', { class: 'tg-trust' }, [
        el('span', {}, [svg(ICONS.check, { size: 12 }), 'Secure']),
        el('span', {}, [svg(ICONS.check, { size: 12 }), 'GDPR']),
        el('span', {}, [svg(ICONS.clock, { size: 12 }), '24hr reply'])
      ]),
      submitBtn
    ]));

    shadow.appendChild(card);
    shadow.appendChild(el('div', { class: 'tg-brand' }, [
      'Powered by ',
      el('strong', {}, [el('a', { href: 'https://travelgenix.io', target: '_blank', rel: 'noopener', text: 'Travelgenix' })])
    ]));

    // Stash refs for submit handler
    this._fields = fields;
    this._submitBtn = submitBtn;
    this._summaryError = summaryError;
    this._honeypot = honeypot;
    this._turnstileToken = function () { return turnstileToken; };

    // Render Turnstile after DOM is in place
    if (turnstileContainer && config.security.turnstileSiteKey) {
      loadTurnstile().then(function (turnstile) {
        turnstileWidgetId = turnstile.render(turnstileContainer, {
          sitekey: config.security.turnstileSiteKey,
          theme: config.branding.theme === 'dark' ? 'dark' : 'light',
          callback: function (token) { turnstileToken = token; },
          'expired-callback': function () { turnstileToken = null; },
          'error-callback': function () { turnstileToken = null; }
        });
        self._turnstileWidgetId = turnstileWidgetId;
      }).catch(function (err) {
        console.error('[TGEnquiryWidget] Turnstile failed to load:', err);
      });
    }
  };

  TGEnquiryWidget.prototype._handleSubmit = function (fields, honeypot, summaryError, submitBtn, getToken) {
    var self = this;
    var config = this.config;

    // Validate every field
    var failedFields = [];
    fields.forEach(function (f) {
      var err = f.validate();
      if (err) { f.showError(err); failedFields.push(f); }
      else f.clearError();
    });

    if (failedFields.length > 0) {
      if (failedFields.length === 1) {
        summaryError.classList.remove('is-shown');
      } else {
        summaryError.classList.add('is-shown');
        summaryError.querySelector('.tg-summary-error-text').textContent = 'Please check the ' + failedFields.length + ' highlighted fields above and try again.';
      }
      setTimeout(function () {
        if (failedFields[0].focus) failedFields[0].focus();
        var rect = failedFields[0].node.getBoundingClientRect();
        if (rect.top < 0 || rect.bottom > window.innerHeight) {
          failedFields[0].node.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 50);
      return;
    }

    summaryError.classList.remove('is-shown');

    var turnstileToken = getToken();
    if (config.security && config.security.turnstile && !turnstileToken) {
      summaryError.classList.add('is-shown');
      summaryError.querySelector('.tg-summary-error-text').textContent = 'Please complete the security check above before submitting.';
      return;
    }

    // Preview mode — if the widget is running inside the editor (no formId),
    // don't actually submit. Just flash a success state so the agent knows
    // validation passed.
    if (!config.formId || config.formId === 'preview') {
      submitBtn.disabled = true;
      var origHtml = submitBtn.innerHTML;
      submitBtn.innerHTML = '';
      submitBtn.appendChild(svg(ICONS.check, { size: 16 }));
      submitBtn.appendChild(document.createTextNode(' Looks good!'));
      setTimeout(function () {
        submitBtn.disabled = false;
        submitBtn.innerHTML = origHtml;
      }, 1500);
      return;
    }

    var fieldValues = {};
    fields.forEach(function (f) { f.writeTo(fieldValues); });
    var firstNameForTy = fieldValues.first_name || '';

    var payload = {
      formId: config.formId,
      visitorId: getVisitorId(),
      sourceUrl: window.location.href,
      locale: (navigator.language || 'en-GB').slice(0, 16),
      honeypot: honeypot.value,
      turnstileToken: turnstileToken,
      submittedAt: new Date().toISOString(),
      fields: fieldValues
    };

    submitBtn.disabled = true;
    submitBtn.innerHTML = '';
    submitBtn.appendChild(svg(ICONS.spinner, { size: 16, class: 'tg-spin' }));
    submitBtn.appendChild(document.createTextNode(' Sending...'));

    fetch(API_BASE + '/api/enquiry/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (r) {
      return r.json().then(function (body) { return { ok: r.ok, body: body }; });
    }).then(function (result) {
      if (result.ok && result.body.ok) {
        self._renderThankYou(result.body, firstNameForTy);
      } else {
        self._showSubmitError(submitBtn, summaryError, result.body);
      }
    }).catch(function () {
      self._showSubmitError(submitBtn, summaryError, { message: 'Something went wrong. Please try again.' });
    });
  };

  TGEnquiryWidget.prototype._showSubmitError = function (submitBtn, summaryError, body) {
    submitBtn.disabled = false;
    submitBtn.innerHTML = '';
    submitBtn.appendChild(el('span', { text: this.config.submitText }));
    submitBtn.appendChild(svg(ICONS.arrow, { size: 16 }));
    summaryError.classList.add('is-shown');
    summaryError.querySelector('.tg-summary-error-text').textContent = (body && body.message) || 'Something went wrong. Please try again.';
    if (this.config.security && this.config.security.turnstile && window.turnstile && this._turnstileWidgetId) {
      window.turnstile.reset(this._turnstileWidgetId);
    }
  };

  TGEnquiryWidget.prototype._renderThankYou = function (response, firstName) {
    var shadow = this.shadow;
    // Preserve the style element so we don't lose theming
    var styleEl = shadow.querySelector('style');
    while (shadow.firstChild) shadow.removeChild(shadow.firstChild);
    if (styleEl) shadow.appendChild(styleEl);
    else shadow.appendChild(el('style', { text: buildStyles(this.config.branding) }));

    var message = (response.thankYou && response.thankYou.message) ||
                  (this.config.thankYou && this.config.thankYou.message) ||
                  ('Thanks' + (firstName ? ', ' + firstName : '') + " — we're on it");
    message = message.replace(/\{firstName\}/g, firstName || '');

    var card = el('div', { class: 'tg-card' }, [
      el('div', { class: 'tg-ty', role: 'status', 'aria-live': 'polite' }, [
        el('div', { class: 'tg-ty-hero', 'aria-hidden': 'true' }, [svg(ICONS.check, { size: 28, strokeWidth: 2.5 })]),
        el('h2', { text: message }),
        el('p', { text: "One of our travel specialists will be in touch within 24 hours. We've also sent a confirmation to your email." }),
        el('div', { class: 'tg-ty-ref', text: 'Reference ' + (response.reference || '—') })
      ])
    ]);
    shadow.appendChild(card);
    shadow.appendChild(el('div', { class: 'tg-brand' }, [
      'Powered by ',
      el('strong', {}, [el('a', { href: 'https://travelgenix.io', target: '_blank', rel: 'noopener', text: 'Travelgenix' })])
    ]));

    setTimeout(function () {
      var h2 = card.querySelector('h2');
      if (h2) { h2.setAttribute('tabindex', '-1'); h2.focus(); }
    }, 100);
  };

  // PUBLIC: update the widget with a new config. Used by the editor preview.
  TGEnquiryWidget.prototype.update = function (newConfig) {
    this.config = this._normalise(newConfig || {});
    this._render();
  };

  // PUBLIC: destroy the widget (cleanup for editor unmount etc.)
  TGEnquiryWidget.prototype.destroy = function () {
    if (this.shadow) {
      while (this.shadow.firstChild) this.shadow.removeChild(this.shadow.firstChild);
    }
    this._fields = null;
  };

  // Expose the class globally — same pattern as TGFaqWidget etc.
  window.TGEnquiryWidget = TGEnquiryWidget;
  window.__TG_ENQUIRY_VERSION__ = WIDGET_VERSION;

  // ============================================================================
  //  Auto-init for live embeds
  //  Finds all [data-tg-widget="enquiry"] elements, fetches their config by
  //  widgetId from the API, and mounts a widget instance.
  // ============================================================================

  function renderError(shadow, msg) {
    while (shadow.firstChild) shadow.removeChild(shadow.firstChild);
    shadow.appendChild(el('style', {
      text: '.tg-oops{padding:48px 32px;text-align:center;font-family:-apple-system,sans-serif}.tg-oops h3{font-size:18px;margin:0 0 8px}.tg-oops p{color:#475569;font-size:14px}'
    }));
    shadow.appendChild(el('div', { class: 'tg-oops', role: 'alert' }, [
      el('h3', { text: 'Form unavailable' }),
      el('p', { text: msg })
    ]));
  }

  async function initContainer(container) {
    if (container.__tgMounted) return;
    container.__tgMounted = true;

    var widgetId = container.getAttribute('data-tg-id');
    var inlineConfig = container.getAttribute('data-tg-config');

    // Inline config path (rare, mostly for testing/demo)
    if (inlineConfig) {
      try {
        var parsed = JSON.parse(inlineConfig);
        new TGEnquiryWidget(container, parsed);
        return;
      } catch (e) {
        console.error('[TGEnquiryWidget] Invalid data-tg-config JSON:', e);
      }
    }

    if (!widgetId) {
      console.error('[TGEnquiryWidget] Container missing data-tg-id');
      return;
    }

    // Attach shadow and show loading state while fetching
    var shadow = container.attachShadow ? container.attachShadow({ mode: 'open' }) : container;
    shadow.appendChild(el('style', {
      text: '.tg-loading{padding:48px;text-align:center;color:#94A3B8;font-family:-apple-system,sans-serif;font-size:14px}.tg-loading svg{animation:tg-spin 1s linear infinite;margin-bottom:8px}@keyframes tg-spin{to{transform:rotate(360deg)}}'
    }));
    var loading = el('div', { class: 'tg-loading', role: 'status', 'aria-live': 'polite' }, [
      svg(ICONS.spinner, { size: 24 }),
      el('div', { text: 'Loading form...' })
    ]);
    shadow.appendChild(loading);

    try {
      var response = await fetch(API_BASE + '/api/enquiry-form-config?id=' + encodeURIComponent(widgetId), {
        credentials: 'omit'
      });
      var data = await response.json();

      // Clear loading — we're going to let the widget take over the shadow
      while (shadow.firstChild) shadow.removeChild(shadow.firstChild);

      if (!response.ok) {
        renderError(shadow, (data && data.error) || 'Unable to load this form.');
        return;
      }

      // The widget constructor calls attachShadow again — undo our attempt
      // by rebuilding the container. For embedded containers, shadow is already
      // attached so we pass a fresh container won't work. Instead, build the
      // widget UI *into the existing shadow* by calling _render on a bare
      // TGEnquiryWidget that we construct by hand.
      var widget = Object.create(TGEnquiryWidget.prototype);
      widget.instance = ++INSTANCE_COUNTER;
      widget.container = container;
      widget.shadow = shadow;
      widget.config = widget._normalise(data);
      widget._render();

      // Stash for potential programmatic access
      container.__tgWidget = widget;
    } catch (err) {
      console.error('[TGEnquiryWidget] Failed to load config:', err);
      renderError(shadow, 'Unable to reach the Travelgenix widget service. Please try again later.');
    }
  }

  function autoInit() {
    var containers = document.querySelectorAll('[data-tg-widget="enquiry"]');
    for (var i = 0; i < containers.length; i++) initContainer(containers[i]);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInit);
  } else {
    autoInit();
  }
})();
