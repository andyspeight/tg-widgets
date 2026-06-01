/**
 * Travelgenix Enquiry Pro Widget v1.0.0
 * A best-in-class, multi-step travel enquiry form — part of the Travelgenix Widget Suite.
 * Zero dependencies. Works on any website via a single script tag.
 *
 * It is a NEW front-end that branches off the original Enquiry Form. It does NOT
 * replace it and does NOT change its pipeline. Leads land in the SAME inbox because
 * Enquiry Pro posts the SAME canonical payload to the SAME endpoint (/api/enquiry/submit)
 * using the agent's existing formId. No new backend, no routing changes.
 *
 * Usage (live embed — point it at the SAME widget id as the agent's enquiry form):
 *   <div data-tg-widget="enquirypro" data-tg-id="YOUR_WIDGET_ID"></div>
 *   <script src="https://tg-widgets.vercel.app/widget-enquirypro.js"></script>
 *
 * Usage (programmatic / preview):
 *   const w = new TGEnquiryProWidget(mountEl, configObject);
 *   w.update(newConfig); w.destroy();
 *
 * CONFIG SHAPE (same as /api/enquiry-form-config returns for the enquiry form):
 *   {
 *     formId:     'EF-0001',                 // REQUIRED for live submit; routes to the inbox
 *     widgetId:   'tgw_123_abc',
 *     name:       'Holiday Enquiry',
 *     header:     { title, subtitle },
 *     thankYou:   { mode, message, redirectUrl },
 *     branding:   { buttonColour, accentColour, theme },   // theme: 'light'|'dark'|'auto'
 *     security:   { honeypot, turnstile, turnstileSiteKey },
 *     agencyName: 'Blue Horizon Travel',     // optional, used in the success copy
 *     responseTime: 'one working day'        // optional
 *   }
 */
(function () {
  'use strict';

  var WIDGET_VERSION = '1.0.0';
  var VISITOR_ID_KEY = 'tg_visitor_id_v1';
  var INSTANCE_COUNTER = 0;
  // Turnstile runs inside an iframe on OUR whitelisted domain (sitekeys are
  // hostname-bound, so we can't render directly on client sites). The iframe
  // solves the challenge and postMessages the token back. See turnstile-frame.html.
  var TURNSTILE_FRAME_PATH = '/turnstile-frame.html';

  // Deduce API base from this script's own src (same pattern as the rest of the suite).
  var API_BASE = (function () {
    try {
      var s = document.getElementsByTagName('script');
      for (var i = 0; i < s.length; i++) {
        var src = s[i].getAttribute('src') || '';
        if (src.indexOf('/widget-enquirypro.js') !== -1) {
          var a = document.createElement('a'); a.href = src;
          return a.protocol + '//' + a.host;
        }
      }
    } catch (e) {}
    return 'https://tg-widgets.vercel.app';
  })();

  // ===========================================================================
  //  Reference data
  // ===========================================================================
  var TRIPS = [
    { k: 'Beach holiday',     i: 'beach'  },
    { k: 'City break',        i: 'city'   },
    { k: 'Family holiday',    i: 'family' },
    { k: 'Honeymoon',         i: 'heart'  },
    { k: 'Cruise',            i: 'cruise' },
    { k: 'Ski trip',          i: 'ski'    },
    { k: 'Tailor-made tour',  i: 'map'    },
    { k: 'Something else',    i: 'spark'  }
  ];
  var DEST_SUGGEST = ['Algarve', 'Greek Islands', 'Maldives', 'Dubai', 'Caribbean', 'Italy', 'Tenerife', 'New York'];
  var AIRPORTS = ['London Gatwick', 'London Heathrow', 'Manchester', 'Birmingham', 'Bristol', 'Edinburgh', 'Other'];
  // Board basis — labels shown to the traveller, codes emitted to the pipeline (RO/BB/HB/FB/AI).
  var BOARD = [
    { label: 'Room only',        code: 'RO' },
    { label: 'Bed & breakfast',  code: 'BB' },
    { label: 'Half board',       code: 'HB' },
    { label: 'Full board',       code: 'FB' },
    { label: 'All-inclusive',    code: 'AI' }
  ];
  var STEPS = [
    { label: 'Trip' }, { label: 'Where & when' }, { label: 'Travellers' },
    { label: 'Details' }, { label: 'Contact' }
  ];

  var ICONS = {
    spark:  'M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8',
    beach:  'M12 4a4 4 0 0 1 4 4M3 20c2-3 5-4 9-4s7 1 9 4',
    city:   'M3 21h18M5 21V8l5-3v16M14 21V11l5-2v12M8 9h.01M8 12h.01M8 15h.01',
    family: 'M3 21v-2a4 4 0 0 1 4-4h2a4 4 0 0 1 4 4v2M15 21v-1a3 3 0 0 1 3-3',
    heart:  'M12 20s-7-4.6-9.2-9C1.3 7.9 3 5 6 5c2 0 3.2 1.3 4 2.5C10.8 6.3 12 5 14 5c3 0 4.7 2.9 3.2 6-2.2 4.4-9.2 9-9.2 9z',
    cruise: 'M3 18l1.5-5h15L21 18M5 13V8h10l4 5M9 8V5h3M2 21c1.5 0 1.5-1 3-1s1.5 1 3 1 1.5-1 3-1 1.5 1 3 1 1.5-1 3-1 1.5 1 3 1',
    ski:    'M3 20l18-7M7 11l3 7M5 5l9 12',
    map:    'M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14',
    chev:   'M9 6l6 6-6 6',
    back:   'M15 18l-6-6 6-6',
    tick:   'M20 6L9 17l-5-5',
    lock:   'M5 11h14v9H5zM8 11V8a4 4 0 0 1 8 0v3',
    warn:   'M12 3l9 16H3zM12 9v4M12 17h.01',
    send:   'M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z',
    plane:  'M22 16.92v3a2 2 0 0 1-2 2 19.8 19.8 0 0 1-17-17 2 2 0 0 1 2-2h3M10.5 13.5L21 3M15 3h6v6',
    pin:    'M12 21s-7-6.4-7-11a7 7 0 0 1 14 0c0 4.6-7 11-7 11zM12 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3',
    search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
    spin:   'M21 12a9 9 0 1 1-6.2-8.6'
  };

  // ===========================================================================
  //  Utilities
  // ===========================================================================
  function escAttr(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  // Validate/normalise a hex colour before it touches CSS. Falls back if dodgy.
  function safeHex(v, fallback) {
    if (typeof v !== 'string') return fallback;
    var m = v.trim().match(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
    if (!m) return fallback;
    var h = m[1];
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return '#' + h.toLowerCase();
  }
  function darken(hex, amt) {
    var h = safeHex(hex, '#0891b2').slice(1);
    var r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    r = Math.max(0, Math.round(r * (1 - amt)));
    g = Math.max(0, Math.round(g * (1 - amt)));
    b = Math.max(0, Math.round(b * (1 - amt)));
    return '#' + [r, g, b].map(function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
  }
  function rgbTint(hex, a) {
    var h = safeHex(hex, '#0891b2').slice(1);
    return 'rgba(' + parseInt(h.slice(0, 2), 16) + ',' + parseInt(h.slice(2, 4), 16) + ',' + parseInt(h.slice(4, 6), 16) + ',' + a + ')';
  }
  function svgEl(pathData, size) {
    var s = size || 24;
    // Icon path data is developer-authored constant — never user/Airtable content.
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', s); svg.setAttribute('height', s);
    svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
    pathData.split('M').forEach(function (seg) {
      if (!seg) return;
      var p = document.createElementNS(ns, 'path'); p.setAttribute('d', 'M' + seg); svg.appendChild(p);
    });
    return svg;
  }
  function getVisitorId() {
    try {
      var id = localStorage.getItem(VISITOR_ID_KEY);
      if (id) return id;
      id = 'v_' + (window.crypto && crypto.randomUUID ? crypto.randomUUID() : (Date.now() + '_' + Math.random().toString(36).slice(2)));
      try { localStorage.setItem(VISITOR_ID_KEY, id); } catch (e) {}
      return id;
    } catch (e) {
      return 'v_anon_' + Math.random().toString(36).slice(2);
    }
  }
  function validEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }
  function validPhone(v) { var d = String(v).replace(/\D/g, ''); return d.length >= 7 && d.length <= 15; }
  function debounce(fn, ms) { var t; return function () { var a = arguments, c = this; clearTimeout(t); t = setTimeout(function () { fn.apply(c, a); }, ms); }; }

  // Turnstile iframe controller. Returns { iframe, getToken, reset, destroy }.
  // Mirrors the original enquiry widget: strict origin check on every message.
  function createTurnstileFrame(sitekey, theme, onTokenChange) {
    var frameOrigin = (function () { try { var a = document.createElement('a'); a.href = API_BASE; return a.protocol + '//' + a.host; } catch (e) { return null; } })();
    var qs = new URLSearchParams(); qs.set('sitekey', sitekey); qs.set('theme', theme === 'dark' ? 'dark' : 'light');
    var frame = document.createElement('iframe');
    frame.src = API_BASE + TURNSTILE_FRAME_PATH + '?' + qs.toString();
    frame.setAttribute('title', 'Security check'); frame.setAttribute('aria-label', 'Security check');
    frame.setAttribute('scrolling', 'no'); frame.setAttribute('frameborder', '0');
    frame.style.cssText = 'border:0;width:300px;height:65px;background:transparent;color-scheme:normal';
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    var token = null;
    function onMessage(event) {
      if (!frameOrigin || event.origin !== frameOrigin) return;       // strict origin check
      var d = event.data; if (!d || d.source !== 'tg-turnstile') return;
      if (d.type === 'token' && typeof d.token === 'string') { token = d.token; if (onTokenChange) onTokenChange(token); }
      else if (d.type === 'expired' || d.type === 'timeout' || d.type === 'error') { token = null; if (onTokenChange) onTokenChange(null); }
    }
    window.addEventListener('message', onMessage);
    return {
      iframe: frame,
      getToken: function () { return token; },
      reset: function () {
        if (!frame.contentWindow || !frameOrigin) return;
        try { frame.contentWindow.postMessage({ source: 'tg-enquiry-widget', type: 'reset' }, frameOrigin); token = null; if (onTokenChange) onTokenChange(null); } catch (e) {}
      },
      destroy: function () { window.removeEventListener('message', onMessage); if (frame.parentNode) frame.parentNode.removeChild(frame); token = null; }
    };
  }

  // Inject the brand fonts into the host document once (Google Fonts, already used across the suite).
  function ensureFonts() {
    if (document.getElementById('tgep-fonts')) return;
    var l = document.createElement('link');
    l.id = 'tgep-fonts'; l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap';
    document.head.appendChild(l);
  }

  // ===========================================================================
  //  Styles (scoped inside the shadow root)
  // ===========================================================================
  function styleText() {
    return [
      ":host{all:initial}",
      "*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}",
      ".ep-root{",
      "--brand:#0891B2;--brand-dark:#0E7490;--brand-tint:rgba(8,145,178,.10);",
      "--accent:#F97316;--accent-tint:rgba(249,115,22,.12);",
      "--bg:#F6F7F5;--card:#FFFFFF;--ink:#0F172A;--ink-2:#475569;--ink-3:#64748B;",
      "--muted:#94A3B8;--border:#E6E8EC;--border-strong:#CBD5E1;--hover:#F1F5F9;",
      "--success:#10B981;--error:#E11D48;--error-tint:rgba(225,29,72,.08);",
      "--radius:18px;--radius-sm:12px;--radius-pill:999px;",
      "--shadow:0 1px 2px rgba(15,23,42,.04),0 12px 32px -12px rgba(15,23,42,.18);",
      "--ff-display:'Fraunces',Georgia,serif;--ff-body:'Plus Jakarta Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;",
      "--ease:cubic-bezier(.22,.61,.36,1);",
      "font-family:var(--ff-body);color:var(--ink);line-height:1.5;-webkit-font-smoothing:antialiased;text-align:left}",
      ".ep-root.is-dark{--bg:#0B1220;--card:#111A2B;--ink:#F1F5F9;--ink-2:#CBD5E1;--ink-3:#94A3B8;--muted:#64748B;--border:#243043;--border-strong:#334155;--hover:#1A2436;--brand-tint:rgba(8,145,178,.18);--accent-tint:rgba(249,115,22,.16);--error-tint:rgba(225,29,72,.16);--shadow:0 1px 2px rgba(0,0,0,.3),0 16px 40px -14px rgba(0,0,0,.6)}",

      ".ep{width:100%;max-width:540px;margin:0 auto;background:var(--card);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden}",
      ".ep-head{padding:22px 24px 0}",
      ".ep-eyebrow{display:inline-flex;align-items:center;gap:7px;font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--brand);margin-bottom:10px}",
      ".ep-title{font-family:var(--ff-display);font-weight:600;font-size:20px;line-height:1.2;margin:2px 0 0}",
      ".ep-prog{display:flex;gap:6px;margin:14px 0 2px}",
      ".ep-prog-step{flex:1;display:flex;flex-direction:column;gap:6px}",
      ".ep-prog-bar{height:5px;border-radius:var(--radius-pill);background:var(--border);overflow:hidden;position:relative}",
      ".ep-prog-bar i{position:absolute;inset:0;width:0;background:var(--brand);border-radius:inherit;transition:width .5s var(--ease)}",
      ".ep-prog-step.done .ep-prog-bar i,.ep-prog-step.active .ep-prog-bar i{width:100%}",
      ".ep-prog-step.active .ep-prog-bar i{background:linear-gradient(90deg,var(--brand),var(--brand-dark))}",
      ".ep-prog-label{font-size:10.5px;font-weight:600;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".ep-prog-step.active .ep-prog-label,.ep-prog-step.done .ep-prog-label{color:var(--ink-2)}",
      "@media (max-width:460px){.ep-prog-label{display:none}}",

      ".ep-body{padding:20px 24px 8px;min-height:200px}",
      ".ep-q{font-family:var(--ff-display);font-weight:600;font-size:clamp(22px,5.4vw,27px);line-height:1.15;letter-spacing:-.01em;margin-bottom:6px}",
      ".ep-sub{color:var(--ink-3);font-size:14px;margin-bottom:20px}",
      ".ep-step{animation:ep-rise .45s var(--ease) both}",
      "@keyframes ep-rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}",
      "@keyframes ep-pop{0%{transform:scale(.5);opacity:0}60%{transform:scale(1.08)}100%{transform:scale(1);opacity:1}}",
      "@keyframes ep-shake{0%,100%{transform:none}25%{transform:translateX(-5px)}75%{transform:translateX(5px)}}",
      "@keyframes ep-spin{to{transform:rotate(360deg)}}",

      ".ep-tiles{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}",
      "@media (min-width:480px){.ep-tiles{grid-template-columns:repeat(4,1fr)}}",
      ".ep-tile{display:flex;flex-direction:column;align-items:center;gap:9px;text-align:center;padding:16px 8px;background:var(--card);border:1.5px solid var(--border);border-radius:var(--radius-sm);cursor:pointer;transition:transform .15s var(--ease),border-color .15s,background .15s;font:inherit;color:var(--ink)}",
      ".ep-tile:hover{border-color:var(--brand);transform:translateY(-2px)}",
      ".ep-tile:active{transform:translateY(0) scale(.98)}",
      ".ep-tile.sel{border-color:var(--brand);background:var(--brand-tint)}",
      ".ep-tile .ic{color:var(--brand);height:34px;display:grid;place-items:center}",
      ".ep-tile span{font-size:12.5px;font-weight:600;line-height:1.25}",

      ".ep-field{margin-bottom:16px}",
      ".ep-label{display:block;font-size:13px;font-weight:600;color:var(--ink-2);margin-bottom:7px}",
      ".ep-label .opt{color:var(--muted);font-weight:500}",
      ".ep-input,.ep-select,.ep-textarea{width:100%;min-height:48px;padding:12px 14px;font:inherit;font-size:15px;color:var(--ink);background:var(--card);border:1.5px solid var(--border);border-radius:var(--radius-sm);transition:border-color .15s,box-shadow .15s;-webkit-appearance:none;appearance:none}",
      ".ep-textarea{min-height:88px;resize:vertical;line-height:1.5}",
      ".ep-input::placeholder,.ep-textarea::placeholder{color:var(--muted)}",
      ".ep-input:focus,.ep-select:focus,.ep-textarea:focus{outline:none;border-color:var(--brand);box-shadow:0 0 0 3px var(--brand-tint)}",
      ".ep-input.err,.ep-select.err{border-color:var(--error);box-shadow:0 0 0 3px var(--error-tint)}",
      ".ep-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}",
      ".ep-hint{font-size:12px;color:var(--muted);margin-top:6px}",
      ".ep-error{font-size:12.5px;color:var(--error);margin-top:6px;font-weight:500;display:flex;align-items:center;gap:5px}",

      ".ep-chips{display:flex;flex-wrap:wrap;gap:8px}",
      ".ep-chip{padding:9px 15px;border:1.5px solid var(--border);background:var(--card);color:var(--ink-2);border-radius:var(--radius-pill);font:inherit;font-size:13.5px;font-weight:600;cursor:pointer;transition:all .14s var(--ease)}",
      ".ep-chip:hover{border-color:var(--brand-dark);color:var(--ink)}",
      ".ep-chip:active{transform:scale(.97)}",
      ".ep-chip.sel{border-color:var(--brand);background:var(--brand);color:#fff}",

      ".ep-dest-wrap{position:relative}",
      ".ep-dest-results{margin-top:8px;border:1.5px solid var(--border);border-radius:var(--radius-sm);overflow:hidden;background:var(--card)}",
      ".ep-dest-grp{padding:6px 12px 4px;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);background:var(--hover)}",
      ".ep-dest-item{display:flex;align-items:center;gap:9px;padding:11px 13px;cursor:pointer;font-size:14px;color:var(--ink);border-top:1px solid var(--border)}",
      ".ep-dest-item:hover{background:var(--brand-tint)}",
      ".ep-dest-item .ic{color:var(--brand);flex:none;display:grid;place-items:center}",
      ".ep-dest-item small{color:var(--ink-3);font-size:12px}",
      ".ep-dest-item.free .ic{color:var(--accent)}",
      ".ep-selected{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}",
      ".ep-token{display:inline-flex;align-items:center;gap:7px;background:var(--brand-tint);color:var(--brand-dark);border:1px solid var(--brand);border-radius:var(--radius-pill);padding:6px 10px 6px 12px;font-size:13px;font-weight:600}",
      ".ep-token button{background:none;border:none;color:inherit;cursor:pointer;font-size:16px;line-height:1;display:grid;place-items:center;width:18px;height:18px;border-radius:50%}",
      ".ep-token button:hover{background:rgba(0,0,0,.08)}",

      ".ep-stepper{display:flex;align-items:center;justify-content:space-between;gap:12px;border:1.5px solid var(--border);border-radius:var(--radius-sm);padding:8px 8px 8px 16px}",
      ".ep-stepper .lab{display:flex;flex-direction:column}",
      ".ep-stepper .lab b{font-size:14.5px;font-weight:600}",
      ".ep-stepper .lab small{font-size:12px;color:var(--muted)}",
      ".ep-stepper .ctl{display:flex;align-items:center;gap:4px}",
      ".ep-rnd{width:38px;height:38px;border-radius:50%;border:1.5px solid var(--border-strong);background:var(--card);color:var(--ink);font-size:20px;cursor:pointer;display:grid;place-items:center;transition:all .14s var(--ease)}",
      ".ep-rnd:hover:not(:disabled){border-color:var(--brand);color:var(--brand)}",
      ".ep-rnd:active:not(:disabled){transform:scale(.92)}",
      ".ep-rnd:disabled{opacity:.4;cursor:not-allowed}",
      ".ep-rnd-val{min-width:30px;text-align:center;font-size:16px;font-weight:700;font-variant-numeric:tabular-nums}",
      ".ep-children{margin-top:12px;display:grid;gap:8px}",
      ".ep-childrow{display:flex;align-items:center;gap:10px;animation:ep-rise .3s var(--ease) both}",
      ".ep-childrow label{font-size:13px;color:var(--ink-2);min-width:64px}",
      ".ep-select{background-image:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='%2364748B' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E\");background-repeat:no-repeat;background-position:right 12px center;padding-right:40px}",

      ".ep-slider-top{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:10px}",
      ".ep-slider-val{font-family:var(--ff-display);font-size:26px;font-weight:600;color:var(--brand)}",
      ".ep-slider-val small{font-family:var(--ff-body);font-size:13px;color:var(--ink-3);font-weight:600}",
      ".ep-range{-webkit-appearance:none;appearance:none;width:100%;height:6px;border-radius:var(--radius-pill);background:var(--border);outline:none;cursor:pointer}",
      ".ep-range::-webkit-slider-thumb{-webkit-appearance:none;width:26px;height:26px;border-radius:50%;background:var(--brand);border:3px solid var(--card);box-shadow:0 2px 6px var(--brand-tint);cursor:pointer}",
      ".ep-range::-moz-range-thumb{width:26px;height:26px;border-radius:50%;background:var(--brand);border:3px solid var(--card);cursor:pointer}",
      ".ep-range:disabled{opacity:.5}",
      ".ep-range-ends{display:flex;justify-content:space-between;font-size:11.5px;color:var(--muted);margin-top:8px}",

      ".ep-check{display:flex;gap:11px;align-items:flex-start;padding:13px 14px;border:1.5px solid var(--border);border-radius:var(--radius-sm);cursor:pointer;transition:border-color .15s,background .15s}",
      ".ep-check:hover{border-color:var(--border-strong)}",
      ".ep-check.sel{border-color:var(--brand);background:var(--brand-tint)}",
      ".ep-check input{width:20px;height:20px;margin-top:1px;accent-color:var(--brand);flex:none;cursor:pointer}",
      ".ep-check .ct{font-size:13.5px;color:var(--ink-2);line-height:1.45}",
      ".ep-check .ct b{color:var(--ink);font-weight:600}",
      ".ep-check+.ep-check{margin-top:10px}",

      ".ep-toggle-row{display:flex;align-items:center;justify-content:space-between;gap:12px;border:1.5px solid var(--border);border-radius:var(--radius-sm);padding:13px 16px}",
      ".ep-toggle-row .lab{display:flex;align-items:center;gap:10px}",
      ".ep-toggle-row .lab .ic{color:var(--brand);display:grid;place-items:center}",
      ".ep-toggle-row .lab b{font-size:14.5px;font-weight:600;display:block}",
      ".ep-toggle-row .lab small{font-size:12px;color:var(--muted)}",
      ".ep-switch{width:50px;height:30px;border-radius:var(--radius-pill);border:none;background:var(--border-strong);position:relative;cursor:pointer;transition:background .2s var(--ease);flex:none}",
      ".ep-switch::after{content:'';position:absolute;top:3px;left:3px;width:24px;height:24px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.3);transition:transform .2s var(--ease)}",
      ".ep-switch.on{background:var(--brand)}",
      ".ep-switch.on::after{transform:translateX(20px)}",

      ".ep-cond{margin-top:4px;margin-bottom:16px;padding:16px;border-radius:var(--radius-sm);background:var(--accent-tint);border:1px dashed rgba(249,115,22,.35);animation:ep-rise .4s var(--ease) both}",
      ".ep-cond .ep-q-sm{font-family:var(--ff-display);font-size:17px;font-weight:600;margin-bottom:4px}",
      ".ep-cond .ep-sub{margin-bottom:14px;font-size:13px}",

      ".ep-foot{display:flex;align-items:center;gap:12px;padding:16px 24px 22px;border-top:1px solid var(--border);margin-top:8px}",
      ".ep-back{background:none;border:none;color:var(--ink-3);font:inherit;font-size:14px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:5px;padding:8px;border-radius:var(--radius-sm)}",
      ".ep-back:hover{color:var(--ink)}",
      ".ep-sp{flex:1}",
      ".ep-trust{font-size:11.5px;color:var(--muted);display:flex;align-items:center;gap:5px}",
      ".ep-next{background:var(--brand);color:#fff;border:none;font:inherit;font-size:15px;font-weight:700;padding:13px 26px;border-radius:var(--radius-pill);cursor:pointer;display:inline-flex;align-items:center;gap:8px;box-shadow:0 4px 14px -4px var(--brand-tint);transition:transform .14s var(--ease),background .14s}",
      ".ep-next:hover{background:var(--brand-dark)}",
      ".ep-next:active{transform:translateY(1px) scale(.99)}",
      ".ep-next[disabled]{opacity:.55;cursor:default;box-shadow:none}",
      ".ep-spin{animation:ep-spin 1s linear infinite}",

      ".ep-done{padding:40px 28px 44px;text-align:center;animation:ep-rise .5s var(--ease) both}",
      ".ep-done .tick{width:74px;height:74px;border-radius:50%;margin:0 auto 18px;display:grid;place-items:center;background:var(--brand-tint);color:var(--brand);animation:ep-pop .55s var(--ease) both}",
      ".ep-done h2{font-family:var(--ff-display);font-size:27px;font-weight:600;margin-bottom:10px;letter-spacing:-.01em}",
      ".ep-done p{color:var(--ink-2);font-size:15px;max-width:380px;margin:0 auto 22px}",
      ".ep-done p b{color:var(--ink);font-weight:600}",
      ".ep-summary{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-bottom:26px}",
      ".ep-sumchip{font-size:12.5px;font-weight:600;color:var(--ink-2);background:var(--hover);border:1px solid var(--border);padding:6px 12px;border-radius:var(--radius-pill)}",
      ".ep-restart{background:none;border:none;color:var(--brand);font:inherit;font-size:14px;font-weight:700;cursor:pointer;text-decoration:underline;text-underline-offset:3px}",
      ".ep-brand{text-align:center;font-size:11px;color:var(--muted);padding:0 0 16px;letter-spacing:.02em}",
      ".ep-brand b{color:var(--ink-3);font-weight:600}",
      ".ep-hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}",
      ".ep-turnstile{margin:4px 0 16px;min-height:65px;display:flex;align-items:center;justify-content:center}",
      ".ep-oops{padding:48px 32px;text-align:center}",
      ".ep-oops h3{font-family:var(--ff-display);font-size:18px;margin:0 0 8px}",
      ".ep-oops p{color:var(--ink-2);font-size:14px}",
      "@media (prefers-reduced-motion:reduce){.ep-root *{animation:none!important;transition:none!important}}"
    ].join('');
  }

  // ===========================================================================
  //  Widget class
  // ===========================================================================
  function TGEnquiryProWidget(container, config) {
    this.instance = ++INSTANCE_COUNTER;
    this.container = container;
    this.shadow = container.attachShadow ? container.attachShadow({ mode: 'open' }) : container;
    this.config = this._normalise(config || {});
    this._resetState();
    this._render();
  }

  TGEnquiryProWidget.prototype._normalise = function (c) {
    c = c || {};
    var b = c.branding || {};
    return {
      formId: c.formId || (c.config && c.config.formId) || '',
      header: c.header || { title: 'Plan your trip', subtitle: '' },
      thankYou: c.thankYou || {},
      branding: {
        buttonColour: safeHex(b.buttonColour, '#0891B2'),
        accentColour: safeHex(b.accentColour, '#F97316'),
        theme: (b.theme === 'dark' || b.theme === 'auto') ? b.theme : 'light'
      },
      security: c.security || {},
      agencyName: c.agencyName || (c.header && c.header.title) || 'our travel team',
      responseTime: c.responseTime || 'one working day'
    };
  };

  TGEnquiryProWidget.prototype._resetState = function () {
    this.S = {
      step: 0, tripType: '', destinations: [], destQuery: '',
      dateMode: '', departDate: '', returnDate: '', month: '', nights: 7,
      adults: 2, children: 0, childAges: [], rooms: 1,
      budget: 1500, budgetFlex: false,
      departAirport: '', board: '', boardLabel: '', flights: true,
      weddingDate: '', skiLevel: '',
      firstName: '', lastName: '', email: '', phone: '',
      contactPref: '', contactTime: '', message: '',
      consent: false, marketing: false, hp: ''
    };
  };

  TGEnquiryProWidget.prototype.update = function (config) {
    this.config = this._normalise(config || {});
    this._applyTheme();
    this._render();
  };
  TGEnquiryProWidget.prototype.destroy = function () {
    if (this._turnstile) { try { this._turnstile.destroy(); } catch (e) {} this._turnstile = null; }
    try { while (this.shadow.firstChild) this.shadow.removeChild(this.shadow.firstChild); } catch (e) {}
    if (this.container) this.container.__tgWidget = null;
  };

  TGEnquiryProWidget.prototype._applyTheme = function () {
    if (!this.root) return;
    var t = this.config.branding.theme, dark = t === 'dark' ||
      (t === 'auto' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
    this.root.classList.toggle('is-dark', !!dark);
    var bc = this.config.branding.buttonColour, ac = this.config.branding.accentColour;
    this.root.style.setProperty('--brand', bc);
    this.root.style.setProperty('--brand-dark', darken(bc, 0.18));
    this.root.style.setProperty('--brand-tint', rgbTint(bc, dark ? 0.18 : 0.10));
    this.root.style.setProperty('--accent', ac);
    this.root.style.setProperty('--accent-tint', rgbTint(ac, dark ? 0.16 : 0.12));
  };

  // ---- shell ----------------------------------------------------------------
  TGEnquiryProWidget.prototype._render = function () {
    ensureFonts();
    var sh = this.shadow;
    while (sh.firstChild) sh.removeChild(sh.firstChild);
    var style = document.createElement('style'); style.textContent = styleText(); sh.appendChild(style);

    this.root = document.createElement('div'); this.root.className = 'ep-root';
    this._applyTheme();
    this.card = document.createElement('div'); this.card.className = 'ep'; this.card.setAttribute('role', 'form');
    this.card.setAttribute('aria-label', 'Travel enquiry');
    this.root.appendChild(this.card);
    sh.appendChild(this.root);

    this._renderStep();
  };

  TGEnquiryProWidget.prototype._progress = function () {
    var S = this.S, wrap = document.createElement('div'); wrap.className = 'ep-prog';
    for (var i = 0; i < STEPS.length; i++) {
      var st = document.createElement('div');
      st.className = 'ep-prog-step ' + (i < S.step ? 'done' : (i === S.step ? 'active' : ''));
      var bar = document.createElement('div'); bar.className = 'ep-prog-bar';
      var fill = document.createElement('i'); bar.appendChild(fill);
      var lab = document.createElement('div'); lab.className = 'ep-prog-label'; lab.textContent = STEPS[i].label;
      st.appendChild(bar); st.appendChild(lab); wrap.appendChild(st);
    }
    return wrap;
  };

  TGEnquiryProWidget.prototype._renderStep = function () {
    var self = this, S = this.S, c = this.config;
    while (this.card.firstChild) this.card.removeChild(this.card.firstChild);

    // head
    var head = document.createElement('div'); head.className = 'ep-head';
    var eb = document.createElement('div'); eb.className = 'ep-eyebrow';
    eb.appendChild(svgEl(ICONS.spark, 15));
    eb.appendChild(document.createTextNode(' Plan your trip'));
    head.appendChild(eb);
    if (c.header && c.header.title && S.step === 0) {
      var ti = document.createElement('h2'); ti.className = 'ep-title'; ti.textContent = c.header.title; head.appendChild(ti);
    }
    head.appendChild(this._progress());
    this.card.appendChild(head);

    // body
    var body = document.createElement('div'); body.className = 'ep-body';
    var step = document.createElement('div'); step.className = 'ep-step';
    this.stepEl = step;
    ([this._stepTrip, this._stepWhere, this._stepWho, this._stepDetails, this._stepContact][S.step]).call(this, step);
    body.appendChild(step); this.card.appendChild(body);

    // footer
    var isLast = S.step === STEPS.length - 1;
    var foot = document.createElement('div'); foot.className = 'ep-foot';
    if (S.step > 0) {
      var back = document.createElement('button'); back.type = 'button'; back.className = 'ep-back';
      back.appendChild(svgEl(ICONS.back, 16)); back.appendChild(document.createTextNode(' Back'));
      back.addEventListener('click', function () { if (self.S.step > 0) { if (self._turnstile) { try { self._turnstile.destroy(); } catch (e) {} self._turnstile = null; } self.S.step--; self._renderStep(); } });
      foot.appendChild(back);
    } else {
      var trust = document.createElement('span'); trust.className = 'ep-trust';
      trust.appendChild(svgEl(ICONS.lock, 13)); trust.appendChild(document.createTextNode(' Secure')); foot.appendChild(trust);
    }
    var sp = document.createElement('span'); sp.className = 'ep-sp'; foot.appendChild(sp);
    if (isLast) {
      var gp = document.createElement('span'); gp.className = 'ep-trust'; gp.style.marginRight = '4px';
      gp.appendChild(svgEl(ICONS.lock, 13)); gp.appendChild(document.createTextNode(' GDPR safe')); foot.appendChild(gp);
    }
    var next = document.createElement('button'); next.type = 'button'; next.className = 'ep-next'; this.nextBtn = next;
    next.appendChild(document.createTextNode(isLast ? 'Send my enquiry' : 'Continue'));
    next.appendChild(svgEl(isLast ? ICONS.send : ICONS.chev, isLast ? 18 : 18));
    next.addEventListener('click', function () { self._onNext(); });
    foot.appendChild(next);
    this.card.appendChild(foot);

    var brand = document.createElement('div'); brand.className = 'ep-brand';
    brand.appendChild(document.createTextNode('Powered by '));
    var b = document.createElement('b'); b.textContent = 'Travelgenix'; brand.appendChild(b);
    this.card.appendChild(brand);
  };

  // ---- helpers for building controls ----------------------------------------
  function fieldWrap(labelText, optional) {
    var f = document.createElement('div'); f.className = 'ep-field';
    if (labelText) {
      var l = document.createElement('label'); l.className = 'ep-label'; l.textContent = labelText;
      if (optional) { var o = document.createElement('span'); o.className = 'opt'; o.textContent = ' (optional)'; l.appendChild(o); }
      f.appendChild(l);
    }
    return f;
  }
  function errEl() { var e = document.createElement('div'); e.className = 'ep-error'; e.hidden = true; return e; }
  function setErr(e, msg) { if (!e) return; e.hidden = false; while (e.firstChild) e.removeChild(e.firstChild); e.appendChild(svgEl(ICONS.warn, 14)); e.appendChild(document.createTextNode(' ' + msg)); }
  function clrErr(e) { if (e) e.hidden = true; }
  function chip(label, selected, onClick) {
    var b = document.createElement('button'); b.type = 'button'; b.className = 'ep-chip' + (selected ? ' sel' : '');
    b.textContent = label; b.addEventListener('click', onClick); return b;
  }
  function stepperRow(title, sub, val, dec, inc, atMin, atMax) {
    var w = document.createElement('div'); w.className = 'ep-stepper';
    var lab = document.createElement('div'); lab.className = 'lab';
    var bb = document.createElement('b'); bb.textContent = title; var ss = document.createElement('small'); ss.textContent = sub;
    lab.appendChild(bb); lab.appendChild(ss); w.appendChild(lab);
    var ctl = document.createElement('div'); ctl.className = 'ctl';
    var minus = document.createElement('button'); minus.type = 'button'; minus.className = 'ep-rnd'; minus.textContent = '\u2212'; minus.disabled = atMin; minus.addEventListener('click', dec);
    var v = document.createElement('span'); v.className = 'ep-rnd-val'; v.textContent = val;
    var plus = document.createElement('button'); plus.type = 'button'; plus.className = 'ep-rnd'; plus.textContent = '+'; plus.disabled = atMax; plus.addEventListener('click', inc);
    ctl.appendChild(minus); ctl.appendChild(v); ctl.appendChild(plus); w.appendChild(ctl); return w;
  }

  // ---- Step 1: trip ----------------------------------------------------------
  TGEnquiryProWidget.prototype._stepTrip = function (root) {
    var self = this, S = this.S;
    var q = document.createElement('div'); q.className = 'ep-q'; q.textContent = 'Where shall we take you?'; root.appendChild(q);
    var sub = document.createElement('div'); sub.className = 'ep-sub'; sub.textContent = 'Pick the kind of trip you have in mind. Takes about a minute, no obligation.'; root.appendChild(sub);
    var tiles = document.createElement('div'); tiles.className = 'ep-tiles';
    TRIPS.forEach(function (o) {
      var t = document.createElement('button'); t.type = 'button'; t.className = 'ep-tile' + (S.tripType === o.k ? ' sel' : '');
      var ic = document.createElement('span'); ic.className = 'ic'; ic.appendChild(svgEl(ICONS[o.i], 28));
      var sp = document.createElement('span'); sp.textContent = o.k;
      t.appendChild(ic); t.appendChild(sp);
      t.addEventListener('click', function () {
        S.tripType = o.k;
        self._renderStep();
        setTimeout(function () { if (self.S.step === 0) { self.S.step = 1; self._renderStep(); } }, 220);
      });
      tiles.appendChild(t);
    });
    root.appendChild(tiles);
  };

  // ---- Step 2: where & when --------------------------------------------------
  TGEnquiryProWidget.prototype._stepWhere = function (root) {
    var self = this, S = this.S;
    var q = document.createElement('div'); q.className = 'ep-q'; q.textContent = 'Lovely. Where to, and when?'; root.appendChild(q);
    var sub = document.createElement('div'); sub.className = 'ep-sub'; sub.textContent = 'Start typing a destination, or just describe the vibe. We will shape the rest with you.'; root.appendChild(sub);

    // destination picker (DB-backed + free text)
    var f = fieldWrap('Destination');
    var wrap = document.createElement('div'); wrap.className = 'ep-dest-wrap';
    var input = document.createElement('input'); input.className = 'ep-input'; input.type = 'text';
    input.placeholder = 'e.g. the Algarve, or somewhere sunny'; input.setAttribute('autocomplete', 'off');
    input.value = S.destQuery || '';
    wrap.appendChild(input);
    var results = document.createElement('div'); results.className = 'ep-dest-results'; results.hidden = true; wrap.appendChild(results);
    f.appendChild(wrap);

    // suggestion chips (only before typing)
    var sugg = document.createElement('div'); sugg.className = 'ep-chips'; sugg.style.marginTop = '10px';
    DEST_SUGGEST.forEach(function (d) {
      sugg.appendChild(chip(d, false, function () { self._addDestination({ name: d, type: 'free-text', id: '' }); input.value = ''; self._renderStep(); }));
    });
    f.appendChild(sugg);

    // selected tokens
    var sel = document.createElement('div'); sel.className = 'ep-selected';
    this._renderDestTokens(sel);
    f.appendChild(sel);
    var derr = errEl(); this._destErr = derr; f.appendChild(derr);
    root.appendChild(f);

    var doSearch = debounce(function (qv) {
      if (!qv || qv.length < 2) { results.hidden = true; return; }
      fetch(API_BASE + '/api/destinations/search?q=' + encodeURIComponent(qv) + '&limit=6', { credentials: 'omit' })
        .then(function (r) { return r.ok ? r.json() : { groups: [] }; })
        .then(function (data) { self._renderDestResults(results, input, data, qv); })
        .catch(function () { self._renderDestResults(results, input, { groups: [] }, qv); });
    }, 260);
    input.addEventListener('input', function () { S.destQuery = input.value; clrErr(derr); doSearch(input.value.trim()); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && input.value.trim()) { e.preventDefault(); self._addDestination({ name: input.value.trim(), type: 'free-text', id: '' }); input.value = ''; self._renderStep(); }
    });

    // when
    var wf = fieldWrap('When?');
    var dm = document.createElement('div'); dm.className = 'ep-chips';
    [['exact', 'I have dates'], ['month', 'Just the month'], ['flexible', "I'm flexible"]].forEach(function (m) {
      dm.appendChild(chip(m[1], S.dateMode === m[0], function () { S.dateMode = m[0]; clrErr(self._dateErr); self._renderStep(); }));
    });
    wf.appendChild(dm);
    var dateErr = errEl(); this._dateErr = dateErr; wf.appendChild(dateErr);
    root.appendChild(wf);

    if (S.dateMode === 'exact') {
      var rowf = fieldWrap('');
      var row = document.createElement('div'); row.className = 'ep-row';
      row.appendChild(this._dateCol('Departure', 'departDate'));
      row.appendChild(this._dateCol('Return', 'returnDate'));
      rowf.appendChild(row); root.appendChild(rowf);
    } else if (S.dateMode === 'month') {
      var mf = fieldWrap('Which month?');
      var mi = document.createElement('input'); mi.className = 'ep-input'; mi.type = 'month'; mi.value = S.month;
      mi.addEventListener('input', function () { S.month = mi.value; }); mf.appendChild(mi); root.appendChild(mf);
      root.appendChild(this._nightsField());
    } else if (S.dateMode === 'flexible') {
      root.appendChild(this._nightsField());
    }
  };
  TGEnquiryProWidget.prototype._dateCol = function (label, key) {
    var self = this, col = document.createElement('div');
    var l = document.createElement('label'); l.className = 'ep-label'; l.textContent = label; col.appendChild(l);
    var inp = document.createElement('input'); inp.className = 'ep-input'; inp.type = 'date'; inp.value = this.S[key] || '';
    inp.addEventListener('input', function () { self.S[key] = inp.value; }); col.appendChild(inp); return col;
  };
  TGEnquiryProWidget.prototype._nightsField = function () {
    var self = this, S = this.S;
    var f = fieldWrap('');
    f.appendChild(stepperRow('How many nights?', 'Roughly is fine', S.nights,
      function () { S.nights = Math.max(2, S.nights - 1); self._renderStep(); },
      function () { S.nights = Math.min(28, S.nights + 1); self._renderStep(); },
      S.nights <= 2, S.nights >= 28));
    return f;
  };
  TGEnquiryProWidget.prototype._renderDestResults = function (box, input, data, qv) {
    var self = this; while (box.firstChild) box.removeChild(box.firstChild);
    var any = false;
    (data.groups || []).forEach(function (g) {
      if (!g.results || !g.results.length) return;
      var h = document.createElement('div'); h.className = 'ep-dest-grp'; h.textContent = g.label || g.type; box.appendChild(h);
      g.results.forEach(function (r) {
        any = true;
        var it = document.createElement('div'); it.className = 'ep-dest-item';
        var ic = document.createElement('span'); ic.className = 'ic'; ic.appendChild(svgEl(ICONS.pin, 16)); it.appendChild(ic);
        var name = document.createElement('span'); name.textContent = r.name;
        var ctx = r.parentCity || r.parentCountry;
        if (ctx) { var s = document.createElement('small'); s.textContent = '  ' + ctx; name.appendChild(s); }
        it.appendChild(name);
        it.addEventListener('click', function () {
          self._addDestination({ id: r.id || '', name: r.name, type: r.type || 'free-text', parentCity: r.parentCity || null, parentCountry: r.parentCountry || null });
          input.value = ''; box.hidden = true; self._renderStep();
        });
        box.appendChild(it);
      });
    });
    // free-text fallback row
    var free = document.createElement('div'); free.className = 'ep-dest-item free';
    var fic = document.createElement('span'); fic.className = 'ic'; fic.appendChild(svgEl(ICONS.search, 16)); free.appendChild(fic);
    var fl = document.createElement('span'); fl.textContent = 'Use \u201C' + qv + '\u201D'; free.appendChild(fl);
    free.addEventListener('click', function () { self._addDestination({ name: qv, type: 'free-text', id: '' }); input.value = ''; box.hidden = true; self._renderStep(); });
    box.appendChild(free);
    box.hidden = false; return any;
  };
  TGEnquiryProWidget.prototype._addDestination = function (d) {
    if (!d || !d.name) return;
    var exists = this.S.destinations.some(function (x) { return x.name.toLowerCase() === d.name.toLowerCase(); });
    if (exists || this.S.destinations.length >= 5) return;
    this.S.destinations.push(d); this.S.destQuery = '';
  };
  TGEnquiryProWidget.prototype._renderDestTokens = function (box) {
    var self = this; while (box.firstChild) box.removeChild(box.firstChild);
    this.S.destinations.forEach(function (d, idx) {
      var t = document.createElement('span'); t.className = 'ep-token';
      t.appendChild(document.createTextNode(d.name));
      var x = document.createElement('button'); x.type = 'button'; x.setAttribute('aria-label', 'Remove'); x.textContent = '\u00d7';
      x.addEventListener('click', function () { self.S.destinations.splice(idx, 1); self._renderStep(); });
      t.appendChild(x); box.appendChild(t);
    });
  };

  // ---- Step 3: travellers ----------------------------------------------------
  TGEnquiryProWidget.prototype._stepWho = function (root) {
    var self = this, S = this.S;
    var q = document.createElement('div'); q.className = 'ep-q'; q.textContent = 'Who is coming along?'; root.appendChild(q);
    var sub = document.createElement('div'); sub.className = 'ep-sub'; sub.textContent = 'Ages help us quote the right rooms and any child prices.'; root.appendChild(sub);

    root.appendChild(stepperRow('Adults', '16 and over', S.adults,
      function () { S.adults = Math.max(1, S.adults - 1); self._renderStep(); },
      function () { S.adults = Math.min(12, S.adults + 1); self._renderStep(); }, S.adults <= 1, S.adults >= 12));
    var g1 = document.createElement('div'); g1.style.height = '10px'; root.appendChild(g1);

    root.appendChild(stepperRow('Children', 'Under 16', S.children,
      function () { S.children = Math.max(0, S.children - 1); S.childAges = S.childAges.slice(0, S.children); self._renderStep(); },
      function () { S.children = Math.min(8, S.children + 1); self._renderStep(); }, S.children <= 0, S.children >= 8));

    if (S.children > 0) {
      var kids = document.createElement('div'); kids.className = 'ep-children';
      for (var i = 0; i < S.children; i++) {
        (function (idx) {
          var row = document.createElement('div'); row.className = 'ep-childrow';
          var l = document.createElement('label'); l.textContent = 'Child ' + (idx + 1); row.appendChild(l);
          var sel = document.createElement('select'); sel.className = 'ep-select';
          var o0 = document.createElement('option'); o0.value = ''; o0.textContent = 'Age'; sel.appendChild(o0);
          for (var a = 0; a <= 15; a++) { var op = document.createElement('option'); op.value = a; op.textContent = a === 0 ? 'Under 1' : a; if (String(S.childAges[idx]) === String(a)) op.selected = true; sel.appendChild(op); }
          sel.addEventListener('change', function () { S.childAges[idx] = sel.value; });
          row.appendChild(sel); kids.appendChild(row);
        })(i);
      }
      root.appendChild(kids);
    }
    var g2 = document.createElement('div'); g2.style.height = '10px'; root.appendChild(g2);
    root.appendChild(stepperRow('Rooms', 'If you have a preference', S.rooms,
      function () { S.rooms = Math.max(1, S.rooms - 1); self._renderStep(); },
      function () { S.rooms = Math.min(6, S.rooms + 1); self._renderStep(); }, S.rooms <= 1, S.rooms >= 6));
  };

  // ---- Step 4: details -------------------------------------------------------
  TGEnquiryProWidget.prototype._stepDetails = function (root) {
    var self = this, S = this.S;
    var q = document.createElement('div'); q.className = 'ep-q'; q.textContent = 'A few details to tailor it'; root.appendChild(q);
    var sub = document.createElement('div'); sub.className = 'ep-sub'; sub.textContent = 'All optional. The more you share, the closer our first idea lands.'; root.appendChild(sub);

    // budget
    var bf = fieldWrap('Budget, per person');
    var top = document.createElement('div'); top.className = 'ep-slider-top';
    var val = document.createElement('span'); val.className = 'ep-slider-val';
    this._setBudgetLabel(val);
    top.appendChild(val); bf.appendChild(top);
    var range = document.createElement('input'); range.type = 'range'; range.className = 'ep-range';
    range.min = 250; range.max = 6000; range.step = 50; range.value = S.budget; range.disabled = S.budgetFlex;
    range.addEventListener('input', function () { S.budget = parseInt(range.value, 10); self._setBudgetLabel(val); });
    bf.appendChild(range);
    var ends = document.createElement('div'); ends.className = 'ep-range-ends';
    var e1 = document.createElement('span'); e1.textContent = '\u00a3250'; var e2 = document.createElement('span'); e2.textContent = '\u00a36,000+';
    ends.appendChild(e1); ends.appendChild(e2); bf.appendChild(ends);
    var flexChk = document.createElement('label'); flexChk.className = 'ep-check' + (S.budgetFlex ? ' sel' : ''); flexChk.style.marginTop = '12px';
    var fci = document.createElement('input'); fci.type = 'checkbox'; fci.checked = S.budgetFlex;
    fci.addEventListener('change', function () { S.budgetFlex = fci.checked; self._renderStep(); });
    var fct = document.createElement('span'); fct.className = 'ct'; fct.textContent = 'I would rather see options across a range';
    flexChk.appendChild(fci); flexChk.appendChild(fct); bf.appendChild(flexChk);
    root.appendChild(bf);

    // FLIGHTS INCLUDED toggle (requested addition)
    var tf = fieldWrap('');
    var trow = document.createElement('div'); trow.className = 'ep-toggle-row';
    var lab = document.createElement('div'); lab.className = 'lab';
    var ic = document.createElement('span'); ic.className = 'ic'; ic.appendChild(svgEl(ICONS.plane, 22)); lab.appendChild(ic);
    var txt = document.createElement('div');
    var b = document.createElement('b'); b.textContent = 'Include flights?'; var s = document.createElement('small'); s.textContent = S.flights ? 'Yes, please quote flights too' : 'No, land arrangements only';
    txt.appendChild(b); txt.appendChild(s); lab.appendChild(txt); trow.appendChild(lab);
    var sw = document.createElement('button'); sw.type = 'button'; sw.className = 'ep-switch' + (S.flights ? ' on' : '');
    sw.setAttribute('role', 'switch'); sw.setAttribute('aria-checked', S.flights ? 'true' : 'false'); sw.setAttribute('aria-label', 'Include flights');
    sw.addEventListener('click', function () { S.flights = !S.flights; self._renderStep(); });
    trow.appendChild(sw); tf.appendChild(trow); root.appendChild(tf);

    // departure airport (hidden for cruise)
    if (this._tripType() !== 'Cruise') {
      var af = fieldWrap('Departure airport', true);
      var ac = document.createElement('div'); ac.className = 'ep-chips';
      AIRPORTS.forEach(function (a) {
        ac.appendChild(chip(a, S.departAirport === a, function () { S.departAirport = (S.departAirport === a) ? '' : a; self._renderStep(); }));
      });
      af.appendChild(ac); root.appendChild(af);
    }
    // board basis (hidden for cruise/ski/city)
    if (['Cruise', 'Ski trip', 'City break'].indexOf(this._tripType()) === -1) {
      var brf = fieldWrap('Board basis', true);
      var bc = document.createElement('div'); bc.className = 'ep-chips';
      BOARD.forEach(function (o) {
        bc.appendChild(chip(o.label, S.board === o.code, function () {
          if (S.board === o.code) { S.board = ''; S.boardLabel = ''; } else { S.board = o.code; S.boardLabel = o.label; }
          self._renderStep();
        }));
      });
      brf.appendChild(bc); root.appendChild(brf);
    }
    // conditional: honeymoon
    if (this._tripType() === 'Honeymoon') {
      var cond = document.createElement('div'); cond.className = 'ep-cond';
      var cq = document.createElement('div'); cq.className = 'ep-q-sm'; cq.textContent = 'When is the big day?'; cond.appendChild(cq);
      var cs = document.createElement('div'); cs.className = 'ep-sub'; cs.textContent = 'So we can make sure the timing is perfect.'; cond.appendChild(cs);
      var wi = document.createElement('input'); wi.className = 'ep-input'; wi.type = 'date'; wi.value = S.weddingDate;
      wi.addEventListener('input', function () { S.weddingDate = wi.value; }); cond.appendChild(wi); root.appendChild(cond);
    }
    // conditional: ski
    if (this._tripType() === 'Ski trip') {
      var cond2 = document.createElement('div'); cond2.className = 'ep-cond';
      var cq2 = document.createElement('div'); cq2.className = 'ep-q-sm'; cq2.textContent = 'How confident on the slopes?'; cond2.appendChild(cq2);
      var cs2 = document.createElement('div'); cs2.className = 'ep-sub'; cs2.textContent = 'Helps us match the resort to the group.'; cond2.appendChild(cs2);
      var lc = document.createElement('div'); lc.className = 'ep-chips';
      ['First timers', 'Beginner', 'Intermediate', 'Advanced', 'Mixed group'].forEach(function (lv) {
        lc.appendChild(chip(lv, S.skiLevel === lv, function () { S.skiLevel = (S.skiLevel === lv) ? '' : lv; self._renderStep(); }));
      });
      cond2.appendChild(lc); root.appendChild(cond2);
    }
  };
  TGEnquiryProWidget.prototype._tripType = function () { return this.S.tripType; };
  TGEnquiryProWidget.prototype._setBudgetLabel = function (el) {
    while (el.firstChild) el.removeChild(el.firstChild);
    if (this.S.budgetFlex) { el.textContent = 'Flexible'; return; }
    el.appendChild(document.createTextNode('\u00a3' + this.S.budget.toLocaleString()));
    var sm = document.createElement('small'); sm.textContent = ' pp'; el.appendChild(sm);
  };

  // ---- Step 5: contact -------------------------------------------------------
  TGEnquiryProWidget.prototype._stepContact = function (root) {
    var self = this, S = this.S;
    if (this._turnstile) { try { this._turnstile.destroy(); } catch (e) {} this._turnstile = null; }
    var q = document.createElement('div'); q.className = 'ep-q'; q.textContent = 'Almost there. How do we reach you?'; root.appendChild(q);
    var sub = document.createElement('div'); sub.className = 'ep-sub'; sub.textContent = 'One of our travel experts will be in touch personally, no call centre.'; root.appendChild(sub);

    var nameF = fieldWrap(''); var row = document.createElement('div'); row.className = 'ep-row';
    var fnCol = this._textCol('First name', 'firstName', 'given-name'); var lnCol = this._textCol('Last name', 'lastName', 'family-name');
    this._fnErr = fnCol._err; row.appendChild(fnCol); row.appendChild(lnCol); nameF.appendChild(row); root.appendChild(nameF);

    var emCol = this._textCol('Email', 'email', 'email', 'email', 'you@email.com'); this._emErr = emCol._err; root.appendChild(emCol);
    var phCol = this._textCol('Phone', 'phone', 'tel', 'tel', '07700 900000'); this._phErr = phCol._err; root.appendChild(phCol);

    var pf = fieldWrap('Best way to reach you', true); var pc = document.createElement('div'); pc.className = 'ep-chips';
    ['Email', 'Phone', 'WhatsApp'].forEach(function (p) { pc.appendChild(self._inPlaceChip(p, 'contactPref', pc)); });
    pf.appendChild(pc); root.appendChild(pf);
    var tf = fieldWrap('Best time', true); var tc = document.createElement('div'); tc.className = 'ep-chips';
    ['Morning', 'Afternoon', 'Evening'].forEach(function (t) { tc.appendChild(self._inPlaceChip(t, 'contactTime', tc)); });
    tf.appendChild(tc); root.appendChild(tf);

    var mf = fieldWrap('Anything else we should know?', true);
    var ta = document.createElement('textarea'); ta.className = 'ep-textarea'; ta.placeholder = 'Special occasions, must-haves, questions...'; ta.value = S.message;
    ta.addEventListener('input', function () { S.message = ta.value; }); mf.appendChild(ta); root.appendChild(mf);

    // honeypot
    var hp = document.createElement('div'); hp.className = 'ep-hp'; hp.setAttribute('aria-hidden', 'true');
    var hpl = document.createElement('label'); hpl.textContent = 'Leave blank';
    var hpi = document.createElement('input'); hpi.tabIndex = -1; hpi.setAttribute('autocomplete', 'off'); hpi.value = S.hp;
    hpi.addEventListener('input', function () { S.hp = hpi.value; }); hpl.appendChild(hpi); hp.appendChild(hpl); root.appendChild(hp);

    // consent (required)
    var consent = document.createElement('label'); consent.className = 'ep-check' + (S.consent ? ' sel' : '');
    var ci = document.createElement('input'); ci.type = 'checkbox'; ci.checked = S.consent;
    ci.addEventListener('change', function () { S.consent = ci.checked; consent.classList.toggle('sel', ci.checked); clrErr(self._consErr); });
    var ct = document.createElement('span'); ct.className = 'ct';
    var b1 = document.createElement('b'); b1.textContent = this.config.agencyName; ct.appendChild(b1);
    ct.appendChild(document.createTextNode(' can contact me about this enquiry. We will never share your details. *'));
    consent.appendChild(ci); consent.appendChild(ct); root.appendChild(consent);
    var consErr = errEl(); this._consErr = consErr; consErr.style.margin = '8px 2px 0'; root.appendChild(consErr);

    var mk = document.createElement('label'); mk.className = 'ep-check' + (S.marketing ? ' sel' : '');
    var mi = document.createElement('input'); mi.type = 'checkbox'; mi.checked = S.marketing;
    mi.addEventListener('change', function () { S.marketing = mi.checked; mk.classList.toggle('sel', mi.checked); });
    var mt = document.createElement('span'); mt.className = 'ct'; mt.textContent = 'Send me occasional travel ideas and offers';
    var mo = document.createElement('span'); mo.className = 'opt'; mo.textContent = ' (optional)'; mt.appendChild(mo);
    mk.appendChild(mi); mk.appendChild(mt); root.appendChild(mk);

    // Turnstile — only when the agent's form config enables it and supplies a sitekey.
    var sec = this.config.security || {};
    if (sec.turnstile && sec.turnstileSiteKey) {
      var tsWrap = document.createElement('div'); tsWrap.className = 'ep-turnstile';
      var theme = this.root && this.root.classList.contains('is-dark') ? 'dark' : 'light';
      this._turnstile = createTurnstileFrame(sec.turnstileSiteKey, theme, function () { clrErr(self._consErr); });
      tsWrap.appendChild(this._turnstile.iframe);
      root.appendChild(tsWrap);
    }
  };
  TGEnquiryProWidget.prototype._inPlaceChip = function (label, key, group) {
    var self = this, sel = this.S[key] === label;
    var b = document.createElement('button'); b.type = 'button'; b.className = 'ep-chip' + (sel ? ' sel' : ''); b.textContent = label;
    b.addEventListener('click', function () {
      self.S[key] = (self.S[key] === label) ? '' : label;
      Array.prototype.forEach.call(group.children, function (c) { c.classList.remove('sel'); });
      if (self.S[key] === label) b.classList.add('sel');
    });
    return b;
  };
  TGEnquiryProWidget.prototype._textCol = function (label, key, autocomplete, type, placeholder) {
    var self = this, col = document.createElement('div');
    var l = document.createElement('label'); l.className = 'ep-label'; l.textContent = label; col.appendChild(l);
    var inp = document.createElement('input'); inp.className = 'ep-input'; inp.type = type || 'text';
    if (autocomplete) inp.setAttribute('autocomplete', autocomplete);
    if (type === 'email') inp.setAttribute('inputmode', 'email'); if (type === 'tel') inp.setAttribute('inputmode', 'tel');
    if (placeholder) inp.placeholder = placeholder;
    inp.value = self.S[key] || '';
    inp.addEventListener('input', function () { self.S[key] = inp.value; inp.classList.remove('err'); });
    inp.addEventListener('blur', function () {
      if (key === 'email' && self.S.email && !validEmail(self.S.email)) setErr(col._err, 'Enter a valid email so we can reply'); else if (key === 'email') clrErr(col._err);
      if (key === 'phone' && self.S.phone && !validPhone(self.S.phone)) setErr(col._err, 'Enter a valid phone number'); else if (key === 'phone') clrErr(col._err);
    });
    col.appendChild(inp);
    var e = errEl(); col._err = e; col._input = inp; col.appendChild(e);
    return col;
  };

  // ---- navigation + validation ----------------------------------------------
  TGEnquiryProWidget.prototype._onNext = function () {
    var S = this.S;
    if (!this._validateStep()) { this._shakeNext(); return; }
    if (S.step === STEPS.length - 1) { this._submit(); }
    else { S.step++; this._renderStep(); }
  };
  TGEnquiryProWidget.prototype._shakeNext = function () {
    var n = this.nextBtn; if (!n) return; n.style.animation = 'ep-shake .4s'; setTimeout(function () { n.style.animation = ''; }, 400);
  };
  TGEnquiryProWidget.prototype._validateStep = function () {
    var S = this.S, ok = true;
    if (S.step === 0) { if (!S.tripType) ok = false; }
    if (S.step === 1) {
      if (!S.destinations.length) { setErr(this._destErr, 'Add a destination, or a rough idea'); ok = false; }
      if (!S.dateMode) { setErr(this._dateErr, 'Let us know roughly when'); ok = false; }
    }
    if (S.step === 4) {
      if (!S.firstName.trim()) { setErr(this._fnErr, 'We need a name'); ok = false; }
      if (!validEmail(S.email)) { setErr(this._emErr, 'Enter a valid email so we can reply'); ok = false; }
      if (!validPhone(S.phone)) { setErr(this._phErr, 'Enter a valid phone number'); ok = false; }
      if (!S.consent) { setErr(this._consErr, 'Please tick to let us reply'); ok = false; }
      var sec = this.config.security || {};
      if (sec.turnstile && sec.turnstileSiteKey && this._turnstile && !this._turnstile.getToken()) {
        setErr(this._consErr, 'Please complete the security check above'); ok = false;
      }
      if (S.hp) { ok = false; } // honeypot tripped — fail silently
    }
    return ok;
  };

  // ---- build canonical payload + submit (same contract as the enquiry form) --
  TGEnquiryProWidget.prototype._buildFields = function () {
    var S = this.S;
    var fields = {
      first_name: S.firstName.trim(),
      last_name: S.lastName.trim(),
      email: S.email.trim(),
      phone: S.phone.trim(),
      contact_consent: !!S.consent,
      marketing_consent: !!S.marketing
    };

    // destinations[] — DB picks carry id/type/parents; free text is type 'free-text'
    if (S.destinations.length) {
      fields.destinations = S.destinations.map(function (d) {
        var o = { id: d.id || '', name: d.name, type: d.type || 'free-text' };
        if (d.parentCity) o.parentCity = d.parentCity;
        if (d.parentCountry) o.parentCountry = d.parentCountry;
        return o;
      });
    }

    // dates / duration
    var td = {};
    if (S.dateMode === 'exact') { if (S.departDate) td.depart = S.departDate; if (S.returnDate) td.return = S.returnDate; td.flexible = false; }
    else if (S.dateMode === 'month') { td.flexible = true; }
    else if (S.dateMode === 'flexible') { td.flexible = true; }
    fields.travel_dates = td;
    if (S.dateMode !== 'exact') { fields.duration = { nights: S.nights }; }

    // travellers (rooms ride along; preserved in rawPayloadJSON)
    var trav = { adults: S.adults, children: S.children };
    if (S.children > 0) trav.childAges = S.childAges.map(function (a) { return parseInt(a, 10) || 0; }).slice(0, S.children);
    trav.rooms = S.rooms;
    fields.travellers = trav;

    // budget
    if (!S.budgetFlex) fields.budget_pp = S.budget;

    // airport / board
    if (S.departAirport && S.departAirport !== 'Other') fields.departure_airport = [S.departAirport];
    if (S.board) fields.board = S.board;

    // flights toggle (captured in rawPayloadJSON) + surfaced via interests for visibility
    fields.flights_included = !!S.flights;

    // interests[] — qualification tags that show in the inbox without backend changes
    var interests = [];
    if (S.tripType) interests.push(S.tripType);
    if (S.budgetFlex) interests.push('Flexible budget');
    if (S.skiLevel) interests.push('Ski level: ' + S.skiLevel);
    fields.interests = interests;

    // notes — user message plus structured extras that have no dedicated column
    var extra = [];
    if (S.dateMode === 'month' && S.month) extra.push('Preferred month: ' + S.month);
    if (S.weddingDate) extra.push('Wedding date: ' + S.weddingDate);
    if (S.rooms > 1) extra.push('Rooms: ' + S.rooms);
    if (S.contactPref) extra.push('Prefers contact by: ' + S.contactPref);
    if (S.contactTime) extra.push('Best time: ' + S.contactTime);
    if (S.departAirport === 'Other') extra.push('Departure airport: other / not listed');
    var notes = (S.message || '').trim();
    if (extra.length) notes = (notes ? notes + '\n\n' : '') + extra.join('\n');
    if (notes) fields.notes = notes.slice(0, 2000);

    return fields;
  };

  TGEnquiryProWidget.prototype._submit = function () {
    var self = this, S = this.S, c = this.config;
    var fields = this._buildFields();

    // Preview / no formId — flash success without hitting the pipeline.
    if (!c.formId || c.formId === 'preview') {
      this._renderDone();
      return;
    }

    var payload = {
      formId: c.formId,
      visitorId: getVisitorId(),
      sourceUrl: location.href,
      locale: (navigator.language || 'en-GB').slice(0, 16),
      honeypot: S.hp,
      turnstileToken: (this._turnstile && this._turnstile.getToken()) || '',
      submittedAt: new Date().toISOString(),
      fields: fields
    };

    var n = this.nextBtn; n.disabled = true;
    while (n.firstChild) n.removeChild(n.firstChild);
    n.appendChild(svgEl(ICONS.spin, 16)); n.lastChild.classList && n.lastChild.classList.add('ep-spin');
    n.appendChild(document.createTextNode(' Sending...'));

    fetch(API_BASE + '/api/enquiry/submit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    }).then(function (r) { return r.json().then(function (body) { return { ok: r.ok, body: body }; }); })
      .then(function (res) {
        if (res.ok && res.body && res.body.ok) { self._renderDone(res.body); }
        else { self._submitError((res.body && res.body.message) || 'Something went wrong. Please try again.'); }
      })
      .catch(function () { self._submitError('Could not reach the server. Please try again.'); });
  };
  TGEnquiryProWidget.prototype._submitError = function (msg) {
    var n = this.nextBtn; if (n) { n.disabled = false; while (n.firstChild) n.removeChild(n.firstChild); n.appendChild(document.createTextNode('Send my enquiry')); n.appendChild(svgEl(ICONS.send, 18)); }
    if (this._turnstile) { try { this._turnstile.reset(); } catch (e) {} }
    if (this._consErr) setErr(this._consErr, msg);
  };

  // ---- success ---------------------------------------------------------------
  TGEnquiryProWidget.prototype._renderDone = function (body) {
    var S = this.S, c = this.config;
    // custom redirect
    if (c.thankYou && c.thankYou.mode === 'redirect' && c.thankYou.redirectUrl) {
      try { location.href = c.thankYou.redirectUrl; return; } catch (e) {}
    }
    while (this.card.firstChild) this.card.removeChild(this.card.firstChild);
    var done = document.createElement('div'); done.className = 'ep-done';
    var tick = document.createElement('div'); tick.className = 'tick'; tick.appendChild(svgEl(ICONS.tick, 40)); done.appendChild(tick);
    var h = document.createElement('h2'); h.textContent = 'Brilliant, ' + (S.firstName || 'that'); done.appendChild(h);

    var p = document.createElement('p');
    if (c.thankYou && c.thankYou.mode === 'message' && c.thankYou.message) {
      p.textContent = c.thankYou.message;
    } else {
      p.appendChild(document.createTextNode('Your enquiry is on its way. '));
      var bn = document.createElement('b'); bn.textContent = c.agencyName; p.appendChild(bn);
      p.appendChild(document.createTextNode(' will be in touch within '));
      var rt = document.createElement('b'); rt.textContent = c.responseTime; p.appendChild(rt);
      var destName = S.destinations.length ? (' with a few ideas for ' + S.destinations[0].name) : ' with a few ideas for your trip';
      p.appendChild(document.createTextNode(destName + '.'));
    }
    done.appendChild(p);

    var bits = [];
    if (S.tripType) bits.push(S.tripType);
    S.destinations.forEach(function (d) { bits.push(d.name); });
    var who = S.adults + (S.adults === 1 ? ' adult' : ' adults') + (S.children > 0 ? ', ' + S.children + (S.children === 1 ? ' child' : ' children') : '');
    bits.push(who);
    if (S.dateMode === 'flexible') bits.push('Flexible dates'); else if (S.dateMode === 'month' && S.month) bits.push(S.month); else if (S.departDate) bits.push(S.departDate);
    var sumWrap = document.createElement('div'); sumWrap.className = 'ep-summary';
    bits.forEach(function (b) { var c2 = document.createElement('span'); c2.className = 'ep-sumchip'; c2.textContent = b; sumWrap.appendChild(c2); });
    done.appendChild(sumWrap);

    var self = this;
    var restart = document.createElement('button'); restart.type = 'button'; restart.className = 'ep-restart'; restart.textContent = 'Start another enquiry';
    restart.addEventListener('click', function () { self._resetState(); self._renderStep(); });
    done.appendChild(restart);
    this.card.appendChild(done);

    var brand = document.createElement('div'); brand.className = 'ep-brand';
    brand.appendChild(document.createTextNode('Powered by ')); var bb = document.createElement('b'); bb.textContent = 'Travelgenix'; brand.appendChild(bb);
    this.card.appendChild(brand);
  };

  // ===========================================================================
  //  Auto-mount
  // ===========================================================================
  function renderOops(shadow, msg) {
    while (shadow.firstChild) shadow.removeChild(shadow.firstChild);
    var st = document.createElement('style'); st.textContent = styleText(); shadow.appendChild(st);
    var root = document.createElement('div'); root.className = 'ep-root';
    var card = document.createElement('div'); card.className = 'ep';
    var o = document.createElement('div'); o.className = 'ep-oops'; o.setAttribute('role', 'alert');
    var h = document.createElement('h3'); h.textContent = 'Form unavailable'; var p = document.createElement('p'); p.textContent = msg;
    o.appendChild(h); o.appendChild(p); card.appendChild(o); root.appendChild(card); shadow.appendChild(root);
  }

  function initContainer(container) {
    if (container.__tgMounted) return; container.__tgMounted = true;
    var widgetId = container.getAttribute('data-tg-id');
    var inline = container.getAttribute('data-tg-config');
    if (inline) {
      try { new TGEnquiryProWidget(container, JSON.parse(inline)); return; }
      catch (e) { console.error('[TGEnquiryProWidget] Invalid data-tg-config JSON:', e); }
    }
    if (!widgetId) { console.error('[TGEnquiryProWidget] Container missing data-tg-id'); return; }

    var shadow = container.attachShadow ? container.attachShadow({ mode: 'open' }) : container;
    var st = document.createElement('style'); st.textContent = styleText() + '.ep-load{padding:48px;text-align:center;color:var(--muted);font-family:var(--ff-body);font-size:14px}.ep-load svg{animation:ep-spin 1s linear infinite}'; shadow.appendChild(st);
    var root = document.createElement('div'); root.className = 'ep-root';
    var load = document.createElement('div'); load.className = 'ep-load'; load.setAttribute('role', 'status');
    load.appendChild(svgEl(ICONS.spin, 24)); load.appendChild(document.createElement('div')).textContent = 'Loading form...';
    root.appendChild(load); shadow.appendChild(root);

    fetch(API_BASE + '/api/enquiry-form-config?id=' + encodeURIComponent(widgetId), { credentials: 'omit' })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        while (shadow.firstChild) shadow.removeChild(shadow.firstChild);
        if (!res.ok) { renderOops(shadow, (res.d && res.d.error) || 'Unable to load this form.'); return; }
        var w = Object.create(TGEnquiryProWidget.prototype);
        w.instance = ++INSTANCE_COUNTER; w.container = container; w.shadow = shadow;
        w.config = w._normalise(res.d); w._resetState(); w._render();
        container.__tgWidget = w;
      })
      .catch(function (err) { console.error('[TGEnquiryProWidget] config load failed:', err); renderOops(shadow, 'Unable to reach the Travelgenix widget service.'); });
  }

  function autoInit() {
    var nodes = document.querySelectorAll('[data-tg-widget="enquirypro"]');
    for (var i = 0; i < nodes.length; i++) initContainer(nodes[i]);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', autoInit);
  else autoInit();

  window.TGEnquiryProWidget = TGEnquiryProWidget;
})();
