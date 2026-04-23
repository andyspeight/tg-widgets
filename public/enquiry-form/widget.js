/*!
 * Travelgenix Enquiry Form Widget
 * Version: 0.2.0 (session 2 — full field set + notes + improved payload collection)
 * Licence: Proprietary — Travelgenix / Agendas Group
 *
 * Embed on any website:
 *   <script src="https://tg-widgets.vercel.app/enquiry-form/widget.js"
 *           data-form-id="EF-0001"
 *           defer></script>
 *   <div data-tg-enquiry-form></div>
 *
 * Or programmatic:
 *   <script src="https://tg-widgets.vercel.app/enquiry-form/widget.js" defer></script>
 *   <div id="my-form"></div>
 *   <script>
 *     window.TGEnquiryForm.mount('#my-form', { formId: 'EF-0001' });
 *   </script>
 *
 * Session 2 scope: destination, airport, date range + flexibility toggle,
 * duration chips, travellers, budget slider, star rating cards, board basis,
 * interest chips, name/email/phone, notes, consent. Submit handler with
 * explicit payload key mapping (no more shape sniffing).
 *
 * Remaining for session 3: full a11y pass (aria-invalid, aria-describedby),
 * Turnstile integration, conditional logic support, child age inputs when
 * children > 0.
 */
(function () {
  'use strict';

  // ============================================================================
  //  Config
  // ============================================================================

  var API_BASE = (function () {
    try {
      var scripts = document.getElementsByTagName('script');
      for (var i = 0; i < scripts.length; i++) {
        var src = scripts[i].getAttribute('src') || '';
        if (src.indexOf('/enquiry-form/widget.js') !== -1) {
          var a = document.createElement('a');
          a.href = src;
          return a.protocol + '//' + a.host;
        }
      }
    } catch (e) {}
    return 'https://tg-widgets.vercel.app';
  })();

  var VISITOR_ID_KEY = 'tg_visitor_id_v1';
  var WIDGET_VERSION = '0.2.0';

  // ============================================================================
  //  Utilities
  // ============================================================================

  function $(tag, attrs, children) {
    var el = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
        var v = attrs[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'html') { /* deliberately not supported */ }
        else if (k.indexOf('on') === 0 && typeof v === 'function') {
          el.addEventListener(k.slice(2), v);
        } else if (k === 'style' && typeof v === 'object') {
          for (var s in v) el.style[s] = v[s];
        } else if (v === true) {
          el.setAttribute(k, '');
        } else {
          el.setAttribute(k, String(v));
        }
      }
    }
    if (children) {
      if (!Array.isArray(children)) children = [children];
      for (var j = 0; j < children.length; j++) {
        var c = children[j];
        if (c === null || c === undefined || c === false) continue;
        if (typeof c === 'string' || typeof c === 'number') {
          el.appendChild(document.createTextNode(String(c)));
        } else if (c.nodeType) {
          el.appendChild(c);
        }
      }
    }
    return el;
  }

  function svg(paths, attrs) {
    attrs = attrs || {};
    var svgNs = 'http://www.w3.org/2000/svg';
    var el = document.createElementNS(svgNs, 'svg');
    el.setAttribute('viewBox', attrs.viewBox || '0 0 24 24');
    el.setAttribute('fill', attrs.fill || 'none');
    el.setAttribute('stroke', attrs.stroke || 'currentColor');
    el.setAttribute('stroke-width', attrs.strokeWidth || '2');
    el.setAttribute('stroke-linecap', 'round');
    el.setAttribute('stroke-linejoin', 'round');
    el.setAttribute('width', attrs.size || '16');
    el.setAttribute('height', attrs.size || '16');
    el.setAttribute('aria-hidden', 'true');
    if (attrs.class) el.setAttribute('class', attrs.class);
    if (typeof paths === 'string') paths = [paths];
    for (var i = 0; i < paths.length; i++) {
      var p = document.createElementNS(svgNs, 'path');
      p.setAttribute('d', paths[i]);
      el.appendChild(p);
    }
    return el;
  }

  // Solid-fill SVG for star icons (filled shape, not a stroke)
  function starIcon(size) {
    var svgNs = 'http://www.w3.org/2000/svg';
    var el = document.createElementNS(svgNs, 'svg');
    el.setAttribute('viewBox', '0 0 24 24');
    el.setAttribute('fill', 'currentColor');
    el.setAttribute('width', size || 14);
    el.setAttribute('height', size || 14);
    el.setAttribute('aria-hidden', 'true');
    var p = document.createElementNS(svgNs, 'polygon');
    p.setAttribute('points', '12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2');
    el.appendChild(p);
    return el;
  }

  // Icon paths — Lucide style
  var ICONS = {
    pin:      'M20 10c0 7-8 12-8 12s-8-5-8-12a8 8 0 0116 0zm-8 3a3 3 0 100-6 3 3 0 000 6z',
    clock:    'M12 2a10 10 0 100 20 10 10 0 000-20zm0 4v6l4 2',
    check:    'M20 6L9 17l-5-5',
    x:        'M18 6L6 18M6 6l12 12',
    plus:     'M12 5v14M5 12h14',
    minus:    'M5 12h14',
    chevron:  'M6 9l6 6 6-6',
    spinner:  'M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83',
    arrow:    'M5 12h14M12 5l7 7-7 7',
    heart:    'M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z',
    wave:     'M2 12c2 0 2-4 4-4s2 4 4 4 2-4 4-4 2 4 4 4 2-4 4-4',
    building: 'M6 22V4a2 2 0 012-2h8a2 2 0 012 2v18M6 12h12M6 7h12',
    museum:   'M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z',
    utensils: 'M6 2v7m0 0c0 3 2 4 6 4s6-1 6-4V2M12 13v9',
    compass:  'M8 3v3M16 3v3M3 9l2 12h14l2-12H3z',
    users:    'M9 7a4 4 0 110 8 4 4 0 010-8zm8 14v-2a4 4 0 00-3-3.87M17 3.13a4 4 0 010 7.75',
    sparkles: 'M12 2l2 6 6 2-6 2-2 6-2-6-6-2 6-2z'
  };

  // ============================================================================
  //  Visitor identity (opaque, non-PII)
  // ============================================================================

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
  //  Destination data — static seed list for session 2.
  //  Session 3+ will fetch from Luna Brain / Destination Content base.
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
      { code: 'LHR', name: 'London Heathrow' },
      { code: 'LGW', name: 'London Gatwick' },
      { code: 'STN', name: 'London Stansted' },
      { code: 'LTN', name: 'London Luton' },
      { code: 'LCY', name: 'London City' },
      { code: 'SOU', name: 'Southampton' }
    ]},
    { region: 'Midlands & North', codes: [
      { code: 'MAN', name: 'Manchester' },
      { code: 'BHX', name: 'Birmingham' },
      { code: 'EMA', name: 'East Midlands' },
      { code: 'LBA', name: 'Leeds Bradford' },
      { code: 'NCL', name: 'Newcastle' },
      { code: 'LPL', name: 'Liverpool' }
    ]},
    { region: 'Scotland', codes: [
      { code: 'EDI', name: 'Edinburgh' },
      { code: 'GLA', name: 'Glasgow' },
      { code: 'ABZ', name: 'Aberdeen' }
    ]},
    { region: 'Southwest, Wales & NI', codes: [
      { code: 'BRS', name: 'Bristol' },
      { code: 'CWL', name: 'Cardiff' },
      { code: 'BFS', name: 'Belfast' }
    ]}
  ];

  var INTERESTS = [
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
    { value: 'RO', label: 'Room only' },
    { value: 'BB', label: 'B&B' },
    { value: 'HB', label: 'Half board' },
    { value: 'FB', label: 'Full board' },
    { value: 'AI', label: 'All inclusive' }
  ];

  var STAR_OPTIONS = [
    { stars: 3, label: 'Comfortable', desc: '3-star. Great value.' },
    { stars: 4, label: 'Superior',    desc: '4-star. The sweet spot.', preselect: true },
    { stars: 5, label: 'Luxury',      desc: '5-star. The full treatment.', luxury: true }
  ];

  // ============================================================================
  //  Styles — scoped to shadow DOM
  // ============================================================================

  function buildStyles(brand) {
    var accent = brand.accent || '#00B4D8';
    var primary = brand.primary || '#1B2B5B';
    var isDark = brand.theme === 'dark';

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
      '.tg-section-head{display:flex;align-items:center;gap:12px;margin-bottom:18px}',
      '.tg-section-num{width:26px;height:26px;border-radius:8px;background:' + c.bgTile + ';color:' + c.textSecondary + ';display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:600;flex-shrink:0}',
      '.tg-section-title{font-size:17px;font-weight:600;margin:0;color:' + c.text + '}',
      '.tg-section-sub{font-size:13px;color:' + c.textTertiary + ';margin:2px 0 0}',

      '.tg-field{margin-bottom:18px}',
      '.tg-field:last-child{margin-bottom:0}',
      '.tg-row{display:grid;grid-template-columns:1fr 1fr;gap:14px}',
      '@media(max-width:540px){.tg-row{grid-template-columns:1fr}}',

      '.tg-label{display:block;font-size:13px;font-weight:500;margin-bottom:6px;color:' + c.text + '}',
      '.tg-label .tg-opt{color:' + c.textTertiary + ';font-weight:400;margin-left:4px}',
      '.tg-help{font-size:12px;color:' + c.textTertiary + ';margin-top:6px}',
      '.tg-error{font-size:12px;color:#EF4444;margin-top:6px}',

      '.tg-input{width:100%;height:44px;padding:0 14px;border:1px solid ' + c.border + ';border-radius:8px;background:' + c.bg + ';color:' + c.text + ';transition:border-color .15s,box-shadow .15s;outline:none}',
      '.tg-input:focus{border-color:' + accent + ';box-shadow:0 0 0 3px ' + accent + '26}',
      '.tg-input::placeholder{color:' + c.textTertiary + '}',
      '.tg-textarea{width:100%;min-height:96px;padding:12px 14px;border:1px solid ' + c.border + ';border-radius:8px;background:' + c.bg + ';color:' + c.text + ';line-height:1.55;resize:vertical;outline:none;transition:border-color .15s,box-shadow .15s;font-family:inherit;font-size:15px}',
      '.tg-textarea:focus{border-color:' + accent + ';box-shadow:0 0 0 3px ' + accent + '26}',
      '.tg-textarea::placeholder{color:' + c.textTertiary + '}',

      /* Destination autocomplete */
      '.tg-dest{position:relative}',
      '.tg-dest-box{min-height:44px;padding:6px 8px 6px 14px;border:1px solid ' + c.border + ';border-radius:8px;background:' + c.bg + ';display:flex;flex-wrap:wrap;gap:6px;align-items:center;cursor:text;transition:border-color .15s,box-shadow .15s}',
      '.tg-dest-box.is-focus{border-color:' + accent + ';box-shadow:0 0 0 3px ' + accent + '26}',
      '.tg-chip{display:inline-flex;align-items:center;gap:6px;padding:4px 6px 4px 10px;border-radius:999px;background:' + accent + '1A;color:' + accent + ';font-size:13px;font-weight:500}',
      '.tg-chip svg{width:12px;height:12px}',
      '.tg-chip-close{background:none;border:none;padding:2px;cursor:pointer;color:inherit;opacity:.7;display:flex;border-radius:50%}',
      '.tg-chip-close:hover{opacity:1;background:' + accent + '26}',
      '.tg-chip-close svg{width:10px;height:10px}',
      '.tg-dest-input{flex:1;min-width:120px;border:none;outline:none;background:transparent;padding:6px 4px;height:auto}',
      '.tg-dest-drop{position:absolute;top:calc(100% + 4px);left:0;right:0;background:' + c.bg + ';border:1px solid ' + c.border + ';border-radius:8px;box-shadow:0 12px 28px rgba(15,23,42,.12);max-height:280px;overflow-y:auto;z-index:10;display:none}',
      '.tg-dest-drop.is-open{display:block}',
      '.tg-dest-grouplabel{padding:10px 14px 4px;font-size:11px;font-weight:600;color:' + c.textTertiary + ';text-transform:uppercase;letter-spacing:.06em}',
      '.tg-dest-option{padding:10px 14px;cursor:pointer;font-size:14px;display:flex;align-items:center;gap:10px;color:' + c.text + ';border:none;background:none;width:100%;text-align:left}',
      '.tg-dest-option:hover,.tg-dest-option:focus{background:' + c.bgTile + ';outline:none}',
      '.tg-dest-option-meta{color:' + c.textTertiary + ';font-size:12px;margin-left:auto}',

      /* Chips (duration + interest) */
      '.tg-chips{display:flex;flex-wrap:wrap;gap:8px}',
      '.tg-pill{height:40px;padding:0 16px;border-radius:999px;border:1px solid ' + c.border + ';background:' + c.bg + ';color:' + c.textSecondary + ';font-size:14px;font-weight:500;display:inline-flex;align-items:center;gap:6px;transition:all .15s;cursor:pointer}',
      '.tg-pill:hover{border-color:' + accent + ';color:' + c.text + '}',
      '.tg-pill.is-active{background:' + primary + ';border-color:' + primary + ';color:#fff}',
      '.tg-pill.is-active svg{color:#fff}',
      '.tg-pill svg{width:14px;height:14px}',

      /* Traveller group */
      '.tg-trav-row{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border:1px solid ' + c.border + ';border-radius:8px;background:' + c.bg + ';margin-bottom:8px}',
      '.tg-trav-row:last-of-type{margin-bottom:0}',
      '.tg-trav-meta h4{font-size:14px;font-weight:600;margin:0;color:' + c.text + '}',
      '.tg-trav-meta p{font-size:12px;color:' + c.textTertiary + ';margin:2px 0 0}',
      '.tg-stepper{display:inline-flex;align-items:center;gap:4px;background:' + c.bgTile + ';padding:4px;border-radius:8px}',
      '.tg-step-btn{width:28px;height:28px;border:none;background:' + c.bg + ';border-radius:6px;display:flex;align-items:center;justify-content:center;color:' + c.textSecondary + ';box-shadow:0 1px 2px rgba(15,23,42,.06);cursor:pointer;transition:all .15s}',
      '.tg-step-btn:hover:not(:disabled){color:' + accent + '}',
      '.tg-step-btn:disabled{opacity:.35;cursor:not-allowed}',
      '.tg-step-val{min-width:26px;text-align:center;font-variant-numeric:tabular-nums;font-weight:600;font-size:14px;color:' + c.text + '}',

      /* Date range + flex toggle */
      '.tg-flex-toggle{display:inline-flex;align-items:center;gap:10px;margin-top:12px;font-size:13px;color:' + c.textSecondary + ';cursor:pointer;user-select:none}',
      '.tg-flex-toggle input{position:absolute;opacity:0;pointer-events:none}',
      '.tg-flex-track{width:34px;height:20px;background:' + c.bgTile + ';border-radius:999px;position:relative;transition:background-color .2s;flex-shrink:0}',
      '.tg-flex-track::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;background:#fff;border-radius:50%;box-shadow:0 1px 3px rgba(15,23,42,.15);transition:transform .2s}',
      '.tg-flex-toggle input:checked ~ .tg-flex-track{background:' + accent + '}',
      '.tg-flex-toggle input:checked ~ .tg-flex-track::after{transform:translateX(14px)}',

      /* Budget slider */
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

      /* Star rating cards */
      '.tg-star-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}',
      '@media(max-width:700px){.tg-star-grid{grid-template-columns:repeat(2,1fr)}}',
      '@media(max-width:420px){.tg-star-grid{grid-template-columns:1fr}}',
      '.tg-star-card{padding:14px;border:1px solid ' + c.border + ';border-radius:8px;background:' + c.bg + ';cursor:pointer;text-align:left;transition:all .15s;font-family:inherit;color:inherit}',
      '.tg-star-card:hover{border-color:' + accent + '}',
      '.tg-star-card.is-active{border-color:' + accent + ';background:' + accent + '0D;box-shadow:0 0 0 3px ' + accent + '1A}',
      '.tg-star-icons{display:flex;gap:2px;margin-bottom:8px;color:#F59E0B}',
      '.tg-star-card.luxury .tg-star-icons{color:' + accent + '}',
      '.tg-star-card h4{font-size:14px;font-weight:600;margin:0 0 2px;color:' + c.text + '}',
      '.tg-star-card p{font-size:12px;color:' + c.textTertiary + ';margin:0}',

      /* Board basis segmented */
      '.tg-seg{display:flex;padding:4px;background:' + c.bgTile + ';border-radius:8px;width:100%;gap:2px}',
      '.tg-seg-btn{flex:1;height:36px;padding:0 10px;border:none;background:transparent;border-radius:6px;font-weight:500;font-size:13px;color:' + c.textSecondary + ';cursor:pointer;transition:all .15s;white-space:nowrap}',
      '.tg-seg-btn:hover{color:' + c.text + '}',
      '.tg-seg-btn.is-active{background:' + c.bg + ';color:' + c.text + ';box-shadow:0 1px 3px rgba(15,23,42,.08)}',
      '@media(max-width:540px){.tg-seg-btn{font-size:12px;padding:0 6px}}',

      /* Submit */
      '.tg-footer{padding:20px 32px 24px;background:' + c.bgAlt + ';display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}',
      '.tg-submit{height:48px;padding:0 22px;border:none;border-radius:8px;background:' + primary + ';color:#fff;font-size:15px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:8px;transition:all .15s;box-shadow:0 1px 0 rgba(0,0,0,.08),0 1px 3px rgba(15,23,42,.06)}',
      '.tg-submit:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 4px 12px rgba(15,23,42,.12)}',
      '.tg-submit:disabled{opacity:.6;cursor:not-allowed;transform:none}',
      '.tg-submit .tg-spin{animation:tg-spin 1s linear infinite}',
      '@keyframes tg-spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}',
      '.tg-trust{display:flex;gap:12px;font-size:11px;color:' + c.textTertiary + '}',
      '.tg-trust span{display:inline-flex;align-items:center;gap:4px}',

      /* Honeypot */
      '.tg-honeypot{position:absolute!important;left:-9999px!important;width:1px!important;height:1px!important;overflow:hidden!important;opacity:0!important;pointer-events:none!important}',

      /* Consent */
      '.tg-check{display:flex;align-items:flex-start;gap:12px;padding:12px 14px;border:1px solid ' + c.border + ';border-radius:8px;cursor:pointer;transition:border-color .15s}',
      '.tg-check:hover{border-color:' + accent + '}',
      '.tg-check input{width:18px;height:18px;accent-color:' + accent + ';margin:2px 0 0;flex-shrink:0;cursor:pointer}',
      '.tg-check-text{font-size:13px;color:' + c.textSecondary + ';line-height:1.5}',
      '.tg-check-text strong{color:' + c.text + ';font-weight:500}',

      /* Loading */
      '.tg-loading{padding:48px;text-align:center;color:' + c.textTertiary + '}',
      '.tg-loading svg{animation:tg-spin 1s linear infinite;margin-bottom:8px}',

      /* Error */
      '.tg-oops{padding:48px 32px;text-align:center}',
      '.tg-oops h3{font-size:18px;font-weight:600;margin:0 0 8px;color:' + c.text + '}',
      '.tg-oops p{color:' + c.textSecondary + ';margin:0 0 16px;font-size:14px}',

      /* Thank-you */
      '.tg-ty{padding:48px 32px;text-align:center}',
      '.tg-ty-hero{width:64px;height:64px;margin:0 auto 18px;border-radius:50%;background:linear-gradient(135deg,#10B981,#059669);display:flex;align-items:center;justify-content:center;color:#fff;box-shadow:0 8px 24px rgba(16,185,129,.3)}',
      '.tg-ty-hero svg{width:28px;height:28px}',
      '.tg-ty h2{font-size:26px;font-weight:600;margin:0 0 6px;color:' + c.text + '}',
      '.tg-ty-ref{display:inline-block;padding:4px 12px;margin-top:12px;background:' + c.bgTile + ';border-radius:999px;font-size:12px;font-weight:500;color:' + c.textSecondary + ';font-variant-numeric:tabular-nums;letter-spacing:.04em}',
      '.tg-ty > p{font-size:15px;color:' + c.textSecondary + ';max-width:420px;margin:12px auto 0}',

      /* Brand footer */
      '.tg-brand{text-align:center;padding:16px 0 0;font-size:11px;color:' + c.textTertiary + '}',
      '.tg-brand strong{color:' + c.textSecondary + ';font-weight:500}',
      '.tg-brand a{color:' + c.textTertiary + ';text-decoration:none}',
      '.tg-brand a:hover{color:' + c.textSecondary + '}',

      '@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}'
    ].join('\n');
  }

  // ============================================================================
  //  Payload contract — every renderer declares where its value lives
  // ============================================================================
  //
  //  Each renderer returns:
  //    {
  //      node:     DOM node to mount in the form
  //      writeTo:  function(fieldsObj) { /* write value(s) into fieldsObj */ }
  //      validate: function() { return errorString | null }
  //    }
  //
  //  This replaces session 1's shape-sniffing with an explicit contract.
  //  Each renderer knows exactly where in the payload its data belongs.
  //
  // ============================================================================

  // --- Destination autocomplete -----------------------------------------------
  function renderDestination() {
    var destinations = [];

    var input = $('input', {
      class: 'tg-dest-input', type: 'text',
      placeholder: 'Search countries, cities, resorts...',
      autocomplete: 'off', 'aria-label': 'Search destinations'
    });
    var box = $('div', { class: 'tg-dest-box' }, [input]);
    var drop = $('div', { class: 'tg-dest-drop' });

    function renderChips() {
      Array.prototype.slice.call(box.querySelectorAll('.tg-chip')).forEach(function (c) { c.remove(); });
      destinations.forEach(function (d) {
        var closeBtn = $('button', {
          class: 'tg-chip-close', type: 'button',
          'aria-label': 'Remove ' + d.name,
          onclick: function (e) {
            e.stopPropagation();
            destinations = destinations.filter(function (x) { return x.id !== d.id; });
            renderChips();
          }
        }, [svg(ICONS.x)]);
        var chip = $('span', { class: 'tg-chip' }, [svg(ICONS.pin), d.name, closeBtn]);
        box.insertBefore(chip, input);
      });
    }

    function renderDrop(query) {
      drop.innerHTML = '';
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
        drop.appendChild($('div', { class: 'tg-dest-grouplabel', text: group.group }));
        matching.forEach(function (item) {
          var opt = $('button', {
            class: 'tg-dest-option', type: 'button',
            onmousedown: function (e) { e.preventDefault(); },
            onclick: function () {
              destinations.push({ id: item.id, name: item.name, region: item.meta });
              input.value = '';
              renderChips();
              renderDrop('');
              input.focus();
            }
          }, [
            $('span', { text: item.name }),
            $('span', { class: 'tg-dest-option-meta', text: item.meta })
          ]);
          drop.appendChild(opt);
        });
      });
      if (!any) {
        drop.appendChild($('div', {
          style: { padding: '14px', fontSize: '13px' },
          text: 'No matches'
        }));
      }
    }

    box.addEventListener('click', function () { input.focus(); });
    input.addEventListener('focus', function () {
      box.classList.add('is-focus');
      drop.classList.add('is-open');
      renderDrop(input.value);
    });
    input.addEventListener('blur', function () {
      setTimeout(function () {
        box.classList.remove('is-focus');
        drop.classList.remove('is-open');
      }, 150);
    });
    input.addEventListener('input', function () { renderDrop(input.value); });

    return {
      node: $('div', { class: 'tg-field' }, [
        $('label', { class: 'tg-label', text: 'Where are you dreaming of?' }),
        $('div', { class: 'tg-dest' }, [box, drop]),
        $('div', { class: 'tg-help', text: 'Add one, or multiple for a twin-centre trip.' })
      ]),
      writeTo: function (fields) { fields.destinations = destinations.slice(); },
      validate: function () {
        return destinations.length > 0 ? null : 'Please add at least one destination.';
      }
    };
  }

  // --- Airport picker --------------------------------------------------------
  function renderAirport() {
    var select = $('select', {
      class: 'tg-input', 'aria-label': 'Departure airport'
    }, [$('option', { value: '', text: 'Select your preferred airport' })]);

    AIRPORTS.forEach(function (region) {
      var group = document.createElement('optgroup');
      group.label = region.region;
      region.codes.forEach(function (a) {
        group.appendChild($('option', {
          value: a.name + ' (' + a.code + ')',
          text: a.name + ' (' + a.code + ')'
        }));
      });
      select.appendChild(group);
    });

    var flexGroup = document.createElement('optgroup');
    flexGroup.label = 'Flexible';
    flexGroup.appendChild($('option', {
      value: 'Flexible on airport',
      text: "I'm flexible on airport"
    }));
    select.appendChild(flexGroup);

    return {
      node: $('div', { class: 'tg-field' }, [
        $('label', { class: 'tg-label', text: 'Departure airport' }),
        select
      ]),
      writeTo: function (fields) { fields.departure_airport = select.value; },
      validate: function () {
        return select.value ? null : 'Please select a departure airport.';
      }
    };
  }

  // --- Date range + flexibility toggle ---------------------------------------
  function renderDateRange() {
    var today = new Date();
    var minDate = today.toISOString().slice(0, 10);

    var depart = $('input', {
      class: 'tg-input', type: 'date', min: minDate,
      'aria-label': 'Depart on'
    });
    var ret = $('input', {
      class: 'tg-input', type: 'date', min: minDate,
      'aria-label': 'Return on'
    });
    var flexInput = $('input', { type: 'checkbox', 'aria-label': 'Flexible dates' });
    var flexTrack = $('span', { class: 'tg-flex-track', 'aria-hidden': 'true' });

    // Keep return min date in sync with depart
    depart.addEventListener('change', function () {
      if (depart.value) {
        ret.min = depart.value;
        if (ret.value && ret.value < depart.value) ret.value = '';
      }
    });

    return {
      node: $('div', { class: 'tg-field' }, [
        $('div', { class: 'tg-row' }, [
          $('div', {}, [$('label', { class: 'tg-label', text: 'Depart on' }), depart]),
          $('div', {}, [$('label', { class: 'tg-label', text: 'Return on' }), ret])
        ]),
        $('label', { class: 'tg-flex-toggle' }, [
          flexInput, flexTrack,
          $('span', { text: "I'm flexible by a week either side" })
        ])
      ]),
      writeTo: function (fields) {
        fields.travel_dates = {
          depart: depart.value || null,
          'return': ret.value || null,
          flexible: !!flexInput.checked
        };
      },
      validate: function () {
        if (!depart.value) return 'Please choose a departure date.';
        if (ret.value && ret.value < depart.value) return 'Return date must be after departure.';
        return null;
      }
    };
  }

  // --- Duration chips --------------------------------------------------------
  function renderDuration() {
    var selected = 7;
    var options = [3, 5, 7, 10, 14];
    var buttons = [];

    function setActive(n) {
      selected = n;
      buttons.forEach(function (b) {
        if (parseInt(b.getAttribute('data-n'), 10) === n) b.classList.add('is-active');
        else b.classList.remove('is-active');
      });
    }

    options.forEach(function (n) {
      var btn = $('button', {
        class: 'tg-pill' + (n === 7 ? ' is-active' : ''),
        type: 'button', 'data-n': String(n),
        text: n + ' nights',
        onclick: function () { setActive(n); }
      });
      buttons.push(btn);
    });

    return {
      node: $('div', { class: 'tg-field' }, [
        $('label', { class: 'tg-label', text: 'Duration' }),
        $('div', { class: 'tg-chips' }, buttons)
      ]),
      writeTo: function (fields) { fields.duration = { nights: selected }; },
      validate: function () { return null; }
    };
  }

  // --- Traveller group -------------------------------------------------------
  function renderTravellers() {
    var values = { adults: 2, children: 0, infants: 0 };

    function stepperRow(label, sub, key, min, max) {
      var valEl = $('span', { class: 'tg-step-val', text: String(values[key]) });
      function update() {
        valEl.textContent = String(values[key]);
        minusBtn.disabled = values[key] <= min;
        plusBtn.disabled = values[key] >= max;
      }
      var minusBtn = $('button', {
        class: 'tg-step-btn', type: 'button',
        'aria-label': 'Decrease ' + label,
        onclick: function () { if (values[key] > min) { values[key]--; update(); } }
      }, [svg(ICONS.minus, { size: 14 })]);
      var plusBtn = $('button', {
        class: 'tg-step-btn', type: 'button',
        'aria-label': 'Increase ' + label,
        onclick: function () { if (values[key] < max) { values[key]++; update(); } }
      }, [svg(ICONS.plus, { size: 14 })]);
      update();
      return $('div', { class: 'tg-trav-row' }, [
        $('div', { class: 'tg-trav-meta' }, [$('h4', { text: label }), $('p', { text: sub })]),
        $('div', { class: 'tg-stepper' }, [minusBtn, valEl, plusBtn])
      ]);
    }

    return {
      node: $('div', { class: 'tg-field' }, [
        $('label', { class: 'tg-label', text: "Who's travelling?" }),
        stepperRow('Adults', 'Age 16+', 'adults', 1, 9),
        stepperRow('Children', 'Age 2–15', 'children', 0, 6),
        stepperRow('Infants', 'Under 2', 'infants', 0, 3)
      ]),
      writeTo: function (fields) {
        fields.travellers = {
          adults: values.adults,
          children: values.children,
          infants: values.infants,
          childAges: [] // session 3: child age chips when children > 0
        };
      },
      validate: function () {
        return values.adults > 0 ? null : 'At least one adult required.';
      }
    };
  }

  // --- Budget slider ---------------------------------------------------------
  function renderBudget() {
    // Non-linear curve: 0-25 → £250-£1500, 25-50 → £1500-£3000,
    // 50-75 → £3000-£5000, 75-100 → £5000-£10000
    function sliderToBudget(v) {
      if (v < 25) return 250 + (v / 25) * (1500 - 250);
      if (v < 50) return 1500 + ((v - 25) / 25) * (3000 - 1500);
      if (v < 75) return 3000 + ((v - 50) / 25) * (5000 - 3000);
      return 5000 + ((v - 75) / 25) * (10000 - 5000);
    }

    var amountEl = $('span', { class: 'tg-budget-amount', text: '£3,000' });
    var range = $('input', {
      class: 'tg-range', type: 'range', min: '0', max: '100', value: '45',
      'aria-label': 'Budget per person'
    });
    var currentBudget = 3000;

    function update() {
      var v = parseInt(range.value, 10);
      currentBudget = Math.round(sliderToBudget(v) / 50) * 50;
      if (v >= 97) {
        amountEl.textContent = '£10,000+';
      } else {
        amountEl.textContent = '£' + currentBudget.toLocaleString('en-GB');
      }
    }
    range.addEventListener('input', update);

    return {
      node: $('div', { class: 'tg-field' }, [
        $('label', { class: 'tg-label', text: 'Approximate total budget' }),
        $('div', { class: 'tg-budget-display' }, [
          amountEl,
          $('span', { class: 'tg-budget-pp', text: 'per person' })
        ]),
        range,
        $('div', { class: 'tg-budget-markers' }, [
          $('span', { text: '£250' }),
          $('span', { text: '£1.5k' }),
          $('span', { text: '£3k' }),
          $('span', { text: '£5k+' })
        ])
      ]),
      writeTo: function (fields) { fields.budget_pp = currentBudget; },
      validate: function () { return null; }
    };
  }

  // --- Star rating cards -----------------------------------------------------
  function renderStars() {
    var selected = 4;
    var cards = [];

    function setActive(stars) {
      selected = stars;
      cards.forEach(function (card) {
        if (parseInt(card.getAttribute('data-stars'), 10) === stars) {
          card.classList.add('is-active');
        } else {
          card.classList.remove('is-active');
        }
      });
    }

    STAR_OPTIONS.forEach(function (opt) {
      var icons = $('div', { class: 'tg-star-icons' });
      for (var i = 0; i < opt.stars; i++) icons.appendChild(starIcon(14));

      var card = $('button', {
        class: 'tg-star-card' + (opt.luxury ? ' luxury' : '') + (opt.preselect ? ' is-active' : ''),
        type: 'button',
        'data-stars': String(opt.stars),
        'aria-label': opt.stars + '-star, ' + opt.label,
        onclick: function () { setActive(opt.stars); }
      }, [
        icons,
        $('h4', { text: opt.label }),
        $('p', { text: opt.desc })
      ]);
      cards.push(card);
    });

    return {
      node: $('div', { class: 'tg-field' }, [
        $('label', { class: 'tg-label', text: 'Star rating preference' }),
        $('div', { class: 'tg-star-grid' }, cards)
      ]),
      writeTo: function (fields) { fields.stars = selected; },
      validate: function () { return null; }
    };
  }

  // --- Board basis segmented control -----------------------------------------
  function renderBoard() {
    var selected = 'RO';
    var buttons = [];

    function setActive(value) {
      selected = value;
      buttons.forEach(function (btn) {
        if (btn.getAttribute('data-value') === value) btn.classList.add('is-active');
        else btn.classList.remove('is-active');
      });
    }

    BOARD_OPTIONS.forEach(function (opt) {
      var btn = $('button', {
        class: 'tg-seg-btn' + (opt.value === 'RO' ? ' is-active' : ''),
        type: 'button',
        'data-value': opt.value,
        'aria-label': opt.label,
        text: opt.label,
        onclick: function () { setActive(opt.value); }
      });
      buttons.push(btn);
    });

    return {
      node: $('div', { class: 'tg-field' }, [
        $('label', { class: 'tg-label', text: 'Board basis' }),
        $('div', { class: 'tg-seg' }, buttons)
      ]),
      writeTo: function (fields) { fields.board = selected; },
      validate: function () { return null; }
    };
  }

  // --- Interest chips --------------------------------------------------------
  function renderInterests() {
    var selected = [];
    var buttons = [];

    INTERESTS.forEach(function (opt) {
      var btn = $('button', {
        class: 'tg-pill',
        type: 'button',
        'data-value': opt.value,
        'aria-pressed': 'false',
        onclick: function () {
          var idx = selected.indexOf(opt.value);
          if (idx >= 0) {
            selected.splice(idx, 1);
            btn.classList.remove('is-active');
            btn.setAttribute('aria-pressed', 'false');
          } else {
            selected.push(opt.value);
            btn.classList.add('is-active');
            btn.setAttribute('aria-pressed', 'true');
          }
        }
      }, [
        svg(ICONS[opt.icon] || ICONS.pin, { size: 14 }),
        opt.label
      ]);
      buttons.push(btn);
    });

    return {
      node: $('div', { class: 'tg-field' }, [
        $('label', { class: 'tg-label' }, [
          'Interests ',
          $('span', { class: 'tg-opt', text: '(pick as many as apply)' })
        ]),
        $('div', { class: 'tg-chips' }, buttons)
      ]),
      writeTo: function (fields) { fields.interests = selected.slice(); },
      validate: function () { return null; }
    };
  }

  // --- Name ------------------------------------------------------------------
  function renderName() {
    var first = $('input', {
      class: 'tg-input', type: 'text', placeholder: 'Jane',
      'aria-label': 'First name', autocomplete: 'given-name'
    });
    var last = $('input', {
      class: 'tg-input', type: 'text', placeholder: 'Smith',
      'aria-label': 'Last name', autocomplete: 'family-name'
    });
    return {
      node: $('div', { class: 'tg-field' }, [
        $('div', { class: 'tg-row' }, [
          $('div', {}, [$('label', { class: 'tg-label', text: 'First name' }), first]),
          $('div', {}, [$('label', { class: 'tg-label', text: 'Last name' }), last])
        ])
      ]),
      writeTo: function (fields) {
        fields.first_name = first.value.trim();
        fields.last_name = last.value.trim();
      },
      validate: function () {
        if (!first.value.trim()) return 'First name required.';
        if (!last.value.trim()) return 'Last name required.';
        return null;
      }
    };
  }

  // --- Email + phone ---------------------------------------------------------
  function renderContact() {
    var email = $('input', {
      class: 'tg-input', type: 'email', placeholder: 'jane@example.com',
      'aria-label': 'Email address', autocomplete: 'email', required: true
    });
    var phone = $('input', {
      class: 'tg-input', type: 'tel', placeholder: '07700 900000',
      'aria-label': 'Phone number', autocomplete: 'tel'
    });
    return {
      node: $('div', { class: 'tg-field' }, [
        $('div', { class: 'tg-row' }, [
          $('div', {}, [$('label', { class: 'tg-label', text: 'Email address' }), email]),
          $('div', {}, [
            $('label', { class: 'tg-label' }, [
              'Phone ',
              $('span', { class: 'tg-opt', text: '(optional)' })
            ]),
            phone
          ])
        ])
      ]),
      writeTo: function (fields) {
        fields.email = email.value.trim();
        fields.phone = phone.value.trim();
      },
      validate: function () {
        var e = email.value.trim();
        if (!e) return 'Email required.';
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return 'Please enter a valid email address.';
        return null;
      }
    };
  }

  // --- Notes (free-text) -----------------------------------------------------
  function renderNotes() {
    var textarea = $('textarea', {
      class: 'tg-textarea',
      'aria-label': 'Notes',
      placeholder: 'Dietary requirements, accessibility needs, special occasions, specific resorts or hotels you have had your eye on...',
      maxlength: '2000'
    });
    return {
      node: $('div', { class: 'tg-field' }, [
        $('label', { class: 'tg-label' }, [
          'Anything else we should know? ',
          $('span', { class: 'tg-opt', text: '(optional)' })
        ]),
        textarea
      ]),
      writeTo: function (fields) {
        var v = textarea.value.trim();
        if (v) fields.notes = v;
      },
      validate: function () { return null; }
    };
  }

  // --- Consent ---------------------------------------------------------------
  function renderConsent() {
    var contactInput = $('input', {
      type: 'checkbox', 'aria-label': 'Agree to be contacted'
    });
    var marketingInput = $('input', {
      type: 'checkbox', 'aria-label': 'Receive marketing updates'
    });
    return {
      node: $('div', { class: 'tg-field' }, [
        $('label', { class: 'tg-check' }, [
          contactInput,
          $('span', { class: 'tg-check-text' }, [
            $('strong', { text: 'I agree to be contacted about this enquiry. ' }),
            "We'll only use your details to respond to your enquiry."
          ])
        ]),
        $('div', { style: { height: '8px' } }),
        $('label', { class: 'tg-check' }, [
          marketingInput,
          $('span', { class: 'tg-check-text' }, [
            'Send me occasional holiday inspiration and exclusive offers.'
          ])
        ])
      ]),
      writeTo: function (fields) {
        fields.contact_consent = !!contactInput.checked;
        fields.marketing_consent = !!marketingInput.checked;
      },
      validate: function () {
        return contactInput.checked ? null : 'Please tick the consent box to continue.';
      }
    };
  }

  // ============================================================================
  //  Form builder
  // ============================================================================

  function buildForm(root, config) {
    var fields = [];

    var hero = $('div', { class: 'tg-hero' }, [
      $('h2', { text: (config.header && config.header.title) || 'Tell us about your dream holiday' }),
      $('p', { text: (config.header && config.header.subtitle) || 'Share a few details and one of our travel specialists will come back within 24 hours.' })
    ]);

    var honeypot = $('input', {
      class: 'tg-honeypot', type: 'text', name: 'website_url',
      tabindex: '-1', autocomplete: 'off', 'aria-hidden': 'true'
    });

    function section(num, title, sub, renderers) {
      var body = $('div', {});
      renderers.forEach(function (r) {
        var inst = r();
        fields.push(inst);
        body.appendChild(inst.node);
      });
      return $('section', { class: 'tg-section' }, [
        $('div', { class: 'tg-section-head' }, [
          $('div', { class: 'tg-section-num', text: String(num) }),
          $('div', {}, [
            $('h3', { class: 'tg-section-title', text: title }),
            sub ? $('p', { class: 'tg-section-sub', text: sub }) : null
          ])
        ]),
        body
      ]);
    }

    var errorBar = $('div', { class: 'tg-error', style: { display: 'none', padding: '0 32px', marginTop: '8px' } });

    var submitBtn = $('button', {
      class: 'tg-submit', type: 'button',
      onclick: function () { handleSubmit(); }
    }, [
      $('span', { text: (config.submit && config.submit.text) || 'Send my enquiry' }),
      svg(ICONS.arrow, { size: 16 })
    ]);

    var footer = $('div', { class: 'tg-footer' }, [
      $('div', { class: 'tg-trust' }, [
        $('span', {}, [svg(ICONS.check, { size: 12 }), 'Secure']),
        $('span', {}, [svg(ICONS.check, { size: 12 }), 'GDPR']),
        $('span', {}, [svg(ICONS.clock, { size: 12 }), '24hr reply'])
      ]),
      submitBtn
    ]);

    var card = $('div', { class: 'tg-card' }, [
      hero,
      section(1, 'Where are you dreaming of?', 'Pick one, or add multiple.',
              [renderDestination, renderAirport]),
      section(2, 'When would you like to travel?', 'Exact dates or flexible — we work around you.',
              [renderDateRange, renderDuration]),
      section(3, "Who's travelling?", "We'll tailor suggestions to suit your group.",
              [renderTravellers]),
      section(4, "What's your style?", 'Helps us narrow down the perfect property.',
              [renderBudget, renderStars, renderBoard, renderInterests]),
      section(5, 'About you', 'So we know who to get in touch with.',
              [renderName, renderContact, renderNotes, renderConsent]),
      errorBar,
      footer,
      honeypot
    ]);

    root.appendChild(card);
    root.appendChild($('div', { class: 'tg-brand' }, [
      'Powered by ',
      $('strong', {}, [$('a', {
        href: 'https://travelgenix.io', target: '_blank', rel: 'noopener',
        text: 'Travelgenix'
      })])
    ]));

    function handleSubmit() {
      var firstError = null;
      fields.forEach(function (f) {
        var err = f.validate();
        if (err && !firstError) firstError = err;
      });

      if (firstError) {
        errorBar.textContent = firstError;
        errorBar.style.display = 'block';
        return;
      }
      errorBar.style.display = 'none';

      // Collect payload using each field's writeTo contract
      var fieldValues = {};
      fields.forEach(function (f) { f.writeTo(fieldValues); });

      // Stash first_name locally so thank-you state can personalise
      var firstNameForTy = fieldValues.first_name || '';

      var payload = {
        formId: config.formId,
        visitorId: getVisitorId(),
        sourceUrl: window.location.href,
        locale: (navigator.language || 'en-GB').slice(0, 16),
        honeypot: honeypot.value,
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
          renderThankYou(root, config, result.body, firstNameForTy);
        } else {
          showError(result.body);
        }
      }).catch(function () {
        showError({ message: 'Something went wrong. Please try again.' });
      });

      function showError(body) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '';
        submitBtn.appendChild($('span', { text: (config.submit && config.submit.text) || 'Send my enquiry' }));
        submitBtn.appendChild(svg(ICONS.arrow, { size: 16 }));
        errorBar.textContent = (body && body.message) || 'Something went wrong. Please try again.';
        errorBar.style.display = 'block';
      }
    }
  }

  // ============================================================================
  //  Thank-you view
  // ============================================================================

  function renderThankYou(root, config, response, firstName) {
    while (root.firstChild) root.removeChild(root.firstChild);

    var message = (response.thankYou && response.thankYou.message) ||
                  ('Thanks' + (firstName ? ', ' + firstName : '') + " — we're on it");

    root.appendChild($('div', { class: 'tg-card' }, [
      $('div', { class: 'tg-ty' }, [
        $('div', { class: 'tg-ty-hero' }, [svg(ICONS.check, { size: 28, strokeWidth: 2.5 })]),
        $('h2', { text: message }),
        $('p', { text: "One of our travel specialists will be in touch within 24 hours. We've also sent a confirmation to your email." }),
        $('div', { class: 'tg-ty-ref', text: 'Reference ' + (response.reference || '—') })
      ])
    ]));
    root.appendChild($('div', { class: 'tg-brand' }, [
      'Powered by ',
      $('strong', {}, [$('a', {
        href: 'https://travelgenix.io', target: '_blank', rel: 'noopener',
        text: 'Travelgenix'
      })])
    ]));
  }

  // ============================================================================
  //  Mount + public API
  // ============================================================================

  function mount(selector, options) {
    var host = typeof selector === 'string' ? document.querySelector(selector) : selector;
    if (!host) {
      console.error('[TG Enquiry Form] Mount target not found:', selector);
      return null;
    }
    if (!options || !options.formId) {
      console.error('[TG Enquiry Form] formId is required');
      return null;
    }

    var shadow = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;

    var loading = $('div', { class: 'tg-loading' }, [
      svg(ICONS.spinner, { size: 24 }),
      $('div', { text: 'Loading form...' })
    ]);
    var tempStyle = $('style', {
      text: '.tg-loading{padding:48px;text-align:center;color:#94A3B8;font-family:-apple-system,sans-serif;font-size:14px}.tg-loading svg{animation:tg-spin 1s linear infinite;margin-bottom:8px}@keyframes tg-spin{to{transform:rotate(360deg)}}'
    });
    shadow.appendChild(tempStyle);
    shadow.appendChild(loading);

    fetch(API_BASE + '/api/enquiry/config?formId=' + encodeURIComponent(options.formId), {
      credentials: 'omit'
    }).then(function (r) {
      return r.json().then(function (body) { return { ok: r.ok, body: body }; });
    }).then(function (result) {
      while (shadow.firstChild) shadow.removeChild(shadow.firstChild);

      if (!result.ok || !result.body.ok) {
        var msg = (result.body && result.body.message) || 'Unable to load this form.';
        shadow.appendChild($('style', {
          text: '.tg-oops{padding:48px 32px;text-align:center;font-family:-apple-system,sans-serif}.tg-oops h3{font-size:18px;margin:0 0 8px}.tg-oops p{color:#475569;font-size:14px}'
        }));
        shadow.appendChild($('div', { class: 'tg-oops' }, [
          $('h3', { text: 'Form unavailable' }),
          $('p', { text: msg })
        ]));
        return;
      }

      var form = result.body.form;
      form.formId = options.formId;

      var brand = form.branding || {};
      shadow.appendChild($('style', { text: buildStyles({
        primary: brand.buttonColour,
        accent: brand.accentColour,
        theme: brand.theme
      })}));

      var container = $('div', {});
      shadow.appendChild(container);
      buildForm(container, form);
    }).catch(function () {
      while (shadow.firstChild) shadow.removeChild(shadow.firstChild);
      shadow.appendChild($('style', {
        text: '.tg-oops{padding:48px 32px;text-align:center;font-family:-apple-system,sans-serif}.tg-oops h3{font-size:18px;margin:0 0 8px}.tg-oops p{color:#475569;font-size:14px}'
      }));
      shadow.appendChild($('div', { class: 'tg-oops' }, [
        $('h3', { text: 'Form unavailable' }),
        $('p', { text: 'Unable to reach the Travelgenix widget service. Please try again later.' })
      ]));
    });

    return { destroy: function () {} };
  }

  function autoMount() {
    var nodes = document.querySelectorAll('[data-tg-enquiry-form]');
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (node.__tgMounted) continue;
      node.__tgMounted = true;
      var formId = node.getAttribute('data-form-id');
      if (!formId) {
        var scripts = document.querySelectorAll('script[data-form-id]');
        if (scripts.length > 0) formId = scripts[scripts.length - 1].getAttribute('data-form-id');
      }
      if (formId) mount(node, { formId: formId });
    }
  }

  window.TGEnquiryForm = { mount: mount, version: WIDGET_VERSION };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoMount);
  } else {
    autoMount();
  }
})();
