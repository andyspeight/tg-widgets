/**
 * Travelgenix Prism Widget v1.0.0
 * An editorial hero band. A cream editorial panel on the left with full font
 * control, then a row of angled photo slices, each one able to choose which
 * part of its photo shows (focal point + zoom) and link anywhere.
 * Self-contained, zero dependencies, Shadow DOM, accessible, CSP-clean.
 *
 * Usage (remote config):
 *   <div data-tg-widget="prism" data-tg-id="YOUR_WIDGET_ID"></div>
 *   <script src="https://tg-widgets.vercel.app/widget-prism.js"></script>
 *
 * Usage (inline config):
 *   <div data-tg-widget="prism" data-tg-config='{"title":{"text":"DESTINATIONS"}}'></div>
 *   <script src="https://tg-widgets.vercel.app/widget-prism.js"></script>
 *
 * © Travelgenix. All rights reserved.
 */
(function () {
  'use strict';

  var VERSION = '1.0.0';

  function resolveBase(path, override) {
    if (typeof window === 'undefined') return path;
    if (override && window[override]) return window[override];
    try {
      var me = document.currentScript;
      if (me && me.src) return new URL(me.src).origin + path;
    } catch (e) { /* noop */ }
    return path;
  }
  var API_BASE = resolveBase('/api/widget-config', '__TG_WIDGET_API__');

  // ─── Helpers ────────────────────────────────────────────────
  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }
  function safeColor(c, fb) { return (typeof c === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c.trim())) ? c.trim() : fb; }
  function clampNum(v, min, max, fb) { var n = parseFloat(v); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fb; }
  // Only http(s), mailto, tel, relative, anchor — and image data URIs (inert in <img>).
  // Blocks javascript:, vbscript: and non-image data: (hardening rule 1).
  function safeUrl(u) {
    var s = String(u == null ? '' : u).trim();
    if (!s) return '';
    if (/^data:image\/(png|jpe?g|gif|webp|avif|svg\+xml)[;,]/i.test(s)) return s;
    if (/^\s*(javascript|vbscript|data):/i.test(s)) return '';
    if (/^(https?:|mailto:|tel:|\/|#|\.)/i.test(s)) return s;
    return '';
  }

  // Curated type set. name -> { weights (that actually exist on Google Fonts,
  // so the stylesheet request never 400s), generic fallback }.
  var FONTS = {
    'Playfair Display':  { w: '400;500;600;700', g: 'Georgia, serif' },
    'Cormorant Garamond':{ w: '400;500;600;700', g: 'Georgia, serif' },
    'EB Garamond':       { w: '400;500;600;700', g: 'Georgia, serif' },
    'Cinzel':            { w: '400;500;600;700', g: 'Georgia, serif' },
    'Marcellus':         { w: '400',             g: 'Georgia, serif' },
    'Great Vibes':       { w: '400',             g: 'cursive' },
    'Pinyon Script':     { w: '400',             g: 'cursive' },
    'Montserrat':        { w: '400;500;600;700', g: 'system-ui, sans-serif' },
    'DM Sans':           { w: '400;500;600;700', g: 'system-ui, sans-serif' }
  };
  function safeFontName(v, fb) { return (typeof v === 'string' && FONTS[v.trim()]) ? v.trim() : fb; }
  function fontStack(name) { var f = FONTS[name]; return "'" + name + "', " + (f ? f.g : 'Georgia, serif'); }

  // Load a chosen web font once per family (hardening rule 2). Name is
  // allow-listed above, so the value going into the URL is safe; encodeURIComponent
  // belt-and-braces. A CSP-locked site simply falls back to the generic.
  function ensureFont(name) {
    if (!name || !FONTS[name] || typeof document === 'undefined') return;
    var id = 'tg-font-' + name.toLowerCase().replace(/\s+/g, '-');
    if (document.getElementById(id)) return;
    var l = document.createElement('link');
    l.id = id; l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=' +
      encodeURIComponent(name).replace(/%20/g, '+') + ':wght@' + FONTS[name].w + '&display=swap';
    document.head.appendChild(l);
  }

  // ─── Default scenes (self-contained SVG "photos") ────────────
  // Wide 1600x1000 scenes used as real <img> sources, so object-position genuinely
  // crops them and a client photo drops into the same slot with no code change.
  function svg(inner) {
    return 'data:image/svg+xml,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">' + inner + '</svg>'
    );
  }
  function stopStr(s) { return '<stop offset="' + s[0] + '" stop-color="' + s[1] + '"' + (s[2] != null ? ' stop-opacity="' + s[2] + '"' : '') + '/>'; }
  function lg(id, stops) { return '<linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1">' + stops.map(stopStr).join('') + '</linearGradient>'; }
  function rg(id, cx, cy, r, stops) { return '<radialGradient id="' + id + '" cx="' + cx + '" cy="' + cy + '" r="' + r + '">' + stops.map(stopStr).join('') + '</radialGradient>'; }
  var vigDef = rg('vig', '50%', '40%', '78%', [[0.55, '#000', 0], [1, '#0a1420', 0.32]]);
  var VIG = '<rect width="1600" height="1000" fill="url(#vig)"/>';
  function palm(x, y, s, c) {
    s = s || 1; c = c || '#123'; var f = '';
    for (var a = -70; a <= 70; a += 24) { var r = a * Math.PI / 180;
      f += '<path d="M' + x + ' ' + y + ' q ' + (Math.cos(r) * 70 * s) + ' ' + (Math.sin(r) * 42 * s - 30 * s) + ' ' + (Math.cos(r) * 150 * s) + ' ' + (Math.sin(r) * 22 * s - 8 * s) + '" stroke="' + c + '" stroke-width="' + (8 * s) + '" fill="none" stroke-linecap="round"/>';
    }
    return '<g><path d="M' + x + ' ' + y + ' q ' + (12 * s) + ' ' + (120 * s) + ' ' + (2 * s) + ' ' + (240 * s) + '" stroke="' + c + '" stroke-width="' + (11 * s) + '" fill="none"/>' + f + '</g>';
  }
  var SCENES = {
    mauritius: svg('<defs>' +
      lg('sky', [[0, '#4f9fd6'], [0.5, '#93c9e8'], [1, '#dbeef9']]) +
      rg('sun', '80%', '14%', '36%', [[0, '#ffffff', 0.85], [0.45, '#fff4d9', 0.28], [1, '#ffffff', 0]]) +
      lg('sea', [[0, '#0a7c96'], [0.35, '#159fae'], [0.72, '#57c9c4'], [1, '#a6e6dc']]) +
      lg('sand', [[0, '#f3e7c6'], [1, '#e2cd9b']]) + vigDef + '</defs>' +
      '<rect width="1600" height="600" fill="url(#sky)"/><rect width="1600" height="600" fill="url(#sun)"/>' +
      '<path d="M0 600 L300 330 L560 600 Z" fill="#5fa07a" opacity="0.9"/><path d="M120 600 L360 300 L470 420 L360 600 Z" fill="#3c885f"/>' +
      '<rect y="520" width="1600" height="92" fill="#ffffff" opacity="0.16"/><rect y="560" width="1600" height="440" fill="url(#sea)"/>' +
      '<ellipse cx="1180" cy="720" rx="540" ry="26" fill="#ffffff" opacity="0.18"/>' +
      '<path d="M0 895 Q800 845 1600 905 L1600 1000 L0 1000 Z" fill="url(#sand)"/>' +
      '<path d="M0 942 Q820 905 1600 950 L1600 1000 L0 1000 Z" fill="#d8c08c" opacity="0.7"/>' +
      palm(1300, 470, 1.25, '#0e3a30') + palm(1450, 520, 1.0, '#0e3a30') + VIG),
    maldives: svg('<defs>' +
      lg('sky', [[0, '#63b3df'], [0.55, '#a8d8ef'], [1, '#e8f7fc']]) +
      rg('sun', '20%', '16%', '32%', [[0, '#ffffff', 0.8], [1, '#ffffff', 0]]) +
      lg('sea', [[0, '#0e93ab'], [0.4, '#28b1bd'], [0.75, '#6bd3cf'], [1, '#ade9df']]) + vigDef + '</defs>' +
      '<rect width="1600" height="500" fill="url(#sky)"/><rect width="1600" height="500" fill="url(#sun)"/>' +
      '<rect y="460" width="1600" height="540" fill="url(#sea)"/><rect y="460" width="1600" height="70" fill="#ffffff" opacity="0.14"/>' +
      '<g>' + [230, 560, 900, 1240].map(function (x) { return '' +
        '<path d="M' + (x - 95) + ' 500 L' + x + ' 388 L' + (x + 95) + ' 500 Z" fill="#6b4a2b"/>' +
        '<path d="M' + (x - 95) + ' 500 L' + x + ' 388 L' + x + ' 500 Z" fill="#553c22"/>' +
        '<rect x="' + (x - 74) + '" y="500" width="148" height="118" fill="#ecd6ad"/>' +
        '<rect x="' + (x - 74) + '" y="500" width="74" height="118" fill="#dcc194"/>' +
        '<rect x="' + (x - 64) + '" y="528" width="46" height="70" fill="#2f2a1e" opacity="0.5"/>' +
        '<rect x="' + (x - 60) + '" y="618" width="9" height="150" fill="#4a3a28"/>' +
        '<rect x="' + (x + 50) + '" y="618" width="9" height="150" fill="#4a3a28"/>' +
        '<rect x="' + (x - 74) + '" y="626" width="148" height="54" fill="#0f8fa6" opacity="0.22"/>'; }).join('') + '</g>' +
      '<ellipse cx="820" cy="822" rx="700" ry="30" fill="#ffffff" opacity="0.12"/>' + VIG),
    canada: svg('<defs>' +
      lg('sky', [[0, '#6fa6d6'], [0.55, '#a9cbe8'], [1, '#e6f1fa']]) +
      lg('peakFar', [[0, '#9fb0c4'], [1, '#7d91a8']]) + lg('peakNear', [[0, '#5e738b'], [1, '#43566b']]) +
      lg('lake', [[0, '#12496f'], [0.5, '#2f7ba3'], [1, '#63aacb']]) + vigDef + '</defs>' +
      '<rect width="1600" height="540" fill="url(#sky)"/>' +
      '<path d="M0 540 L260 250 L520 540 Z" fill="url(#peakFar)" opacity="0.85"/>' +
      '<path d="M420 540 L760 170 L1120 540 Z" fill="url(#peakNear)"/><path d="M760 170 L845 285 L760 350 L678 285 Z" fill="#f4f8fb"/>' +
      '<path d="M980 540 L1300 240 L1600 540 Z" fill="url(#peakFar)" opacity="0.9"/><path d="M1300 240 L1360 320 L1300 372 L1240 320 Z" fill="#eef4f8"/>' +
      '<rect y="470" width="1600" height="92" fill="#ffffff" opacity="0.12"/><rect y="500" width="1600" height="92" fill="#1f5136"/>' +
      '<g fill="#173f2a">' + [40, 150, 270, 400, 540, 700, 860, 1020, 1180, 1340, 1500, 1580].map(function (x) { return '<path d="M' + x + ' 500 l 30 84 l -60 0 Z"/><path d="M' + x + ' 528 l 40 92 l -80 0 Z"/>'; }).join('') + '</g>' +
      '<rect y="580" width="1600" height="420" fill="url(#lake)"/>' +
      '<path d="M420 580 L760 900 L1120 580 Z" fill="#3a6f92" opacity="0.35"/><rect y="580" width="1600" height="30" fill="#ffffff" opacity="0.14"/>' + VIG),
    kenya: svg('<defs>' +
      lg('sky', [[0, '#f7c268'], [0.42, '#ef9a52'], [0.72, '#d9744a'], [1, '#b1543f']]) +
      rg('sun', '52%', '52%', '27%', [[0, '#fff3cf', 1], [0.45, '#ffd98a', 0.9], [1, '#ffb457', 0]]) +
      lg('gnd', [[0, '#a9772f'], [0.5, '#8a5d26'], [1, '#5f3f1c']]) + vigDef + '</defs>' +
      '<rect width="1600" height="640" fill="url(#sky)"/><circle cx="832" cy="500" r="150" fill="#fff0c4"/><rect width="1600" height="720" fill="url(#sun)"/>' +
      '<rect y="600" width="1600" height="400" fill="url(#gnd)"/><path d="M0 620 Q800 588 1600 622 L1600 700 L0 700 Z" fill="#6e4a20" opacity="0.55"/>' +
      '<g fill="#241710"><path d="M300 640 q 8 -170 -12 -300 q 42 58 22 118 q 30 -50 72 -70 q -20 60 -52 100 q 62 -30 124 -20 q -72 42 -156 60 l 10 112 Z"/><rect x="288" y="332" width="14" height="316"/></g>' +
      '<ellipse cx="300" cy="326" rx="240" ry="56" fill="#20140b"/>' +
      '<g fill="#1e130c"><path d="M1120 655 q -18 -92 62 -122 q 92 -34 162 6 q 42 24 46 76 l 6 90 l -42 0 l -8 -60 l -30 0 l -6 60 l -48 0 l -6 -60 l -30 0 l -8 60 l -48 0 Z"/><path d="M1182 560 q -42 20 -48 92" stroke="#1e130c" stroke-width="16" fill="none"/></g>' + VIG),
    dubai: svg('<defs>' +
      lg('sky', [[0, '#0e4a66'], [0.4, '#3a8ca4'], [0.68, '#e6b374'], [1, '#f6dca8']]) +
      rg('sun', '70%', '44%', '22%', [[0, '#fff1cf', 0.95], [1, '#ffdf9f', 0]]) +
      lg('sea', [[0, '#1a6a82'], [0.5, '#124f63'], [1, '#0c3a4c']]) + vigDef + '</defs>' +
      '<rect width="1600" height="720" fill="url(#sky)"/><circle cx="1130" cy="450" r="60" fill="#fff0cc"/><rect width="1600" height="720" fill="url(#sun)"/>' +
      '<g fill="#dfe6ee" opacity="0.85"><rect x="250" y="360" width="26" height="360"/><rect x="300" y="300" width="30" height="420"/><rect x="356" y="410" width="22" height="310"/><rect x="1300" y="330" width="28" height="390"/><rect x="1350" y="390" width="22" height="330"/></g>' +
      '<path d="M760 720 L760 168 Q 902 150 982 420 Q 1012 560 1022 720 Z" fill="#f6f9fc"/>' +
      '<path d="M760 720 L760 168 Q 852 300 864 720 Z" fill="#d9e2ec"/>' +
      '<path d="M864 720 Q 902 430 982 420 Q 1012 560 1022 720 Z" fill="#eef3f8"/>' +
      '<rect y="700" width="1600" height="300" fill="url(#sea)"/><rect x="884" y="700" width="66" height="220" fill="#ffffff" opacity="0.13"/><rect y="700" width="1600" height="40" fill="#ffffff" opacity="0.12"/>' + VIG),
    caribbean: svg('<defs>' +
      lg('sky', [[0, '#66b7df'], [0.55, '#a9dcef'], [1, '#eefafd']]) +
      rg('sun', '26%', '16%', '30%', [[0, '#ffffff', 0.75], [1, '#ffffff', 0]]) +
      lg('sea', [[0, '#149eb4'], [0.45, '#33c0c2'], [0.8, '#6ad4cf'], [1, '#a9e7dd']]) +
      lg('sand', [[0, '#f6ead0'], [1, '#ecd9ad']]) + vigDef + '</defs>' +
      '<rect width="1600" height="470" fill="url(#sky)"/><rect width="1600" height="470" fill="url(#sun)"/>' +
      '<g fill="#e79aa6"><rect x="560" y="150" width="220" height="330"/><rect x="820" y="150" width="220" height="330"/><rect x="770" y="70" width="80" height="410" fill="#dd8592"/></g>' +
      '<rect x="700" y="150" width="80" height="330" fill="#d0808e" opacity="0.55"/><rect x="960" y="150" width="80" height="330" fill="#d0808e" opacity="0.55"/>' +
      '<path d="M560 150 h220 l-40 -70 h-140 Z" fill="#e79aa6"/><path d="M820 150 h220 l-40 -70 h-140 Z" fill="#e79aa6"/><rect x="795" y="20" width="30" height="60" fill="#c97d8b"/>' +
      '<g fill="#c98a95">' + [600, 660, 720, 880, 940, 1000].map(function (x) { return '<rect x="' + x + '" y="205" width="26" height="26"/><rect x="' + x + '" y="268" width="26" height="26"/><rect x="' + x + '" y="331" width="26" height="26"/>'; }).join('') + '</g>' +
      '<rect y="450" width="1600" height="205" fill="url(#sand)"/><rect y="600" width="1600" height="400" fill="url(#sea)"/>' +
      '<ellipse cx="1050" cy="720" rx="560" ry="24" fill="#ffffff" opacity="0.16"/>' +
      palm(210, 470, 1.35, '#123f34') + palm(1420, 470, 1.2, '#123f34') + VIG)
  };
  // Fallback gradient shown if a client image URL fails or is blank (hardening rule 3).
  var FALLBACKS = [
    'linear-gradient(160deg,#3aa6b0,#0c5f74)', 'linear-gradient(160deg,#37bfc4,#0d7a8f)',
    'linear-gradient(160deg,#5c7a97,#20415e)', 'linear-gradient(160deg,#e0954f,#7c3f28)',
    'linear-gradient(160deg,#2f7f9a,#0c3a4c)', 'linear-gradient(160deg,#37c0bf,#12707f)'
  ];

  var DEFAULTS = {
    title:  { text: 'DESTINATIONS', font: 'Playfair Display', size: 3.35, color: '#1E2E49', tracking: 6, weight: 700 },
    script: { text: 'Extraordinary Journeys', font: 'Great Vibes', size: 3.5, color: '#A6792F' },
    lead:   { text: 'Extraordinary stays.\nUnforgettable memories.', font: 'EB Garamond', size: 2.1, color: '#22344F', weight: 600 },
    body:   { text: "Handpicked luxuries in the world's most iconic destinations. Where every stay is designed for pure indulgence.", font: 'EB Garamond', size: 1.5, color: '#46566C', weight: 500 },
    labels: { font: 'Cinzel', size: 1.4, color: '#FFFFFF', tracking: 6 },
    panelBg: '#F4F0E7', seam: '#FFFFFF', slant: 2.7, radius: 6,
    items: [
      { label: 'MAURITIUS', image: SCENES.mauritius, href: '', newTab: false, fx: 50, fy: 52, zoom: 1.0 },
      { label: 'MALDIVES',  image: SCENES.maldives,  href: '', newTab: false, fx: 50, fy: 55, zoom: 1.0 },
      { label: 'CANADA',    image: SCENES.canada,    href: '', newTab: false, fx: 50, fy: 50, zoom: 1.0 },
      { label: 'KENYA',     image: SCENES.kenya,     href: '', newTab: false, fx: 52, fy: 48, zoom: 1.05 },
      { label: 'DUBAI',     image: SCENES.dubai,     href: '', newTab: false, fx: 55, fy: 50, zoom: 1.0 },
      { label: 'CARIBBEAN', image: SCENES.caribbean, href: '', newTab: false, fx: 50, fy: 50, zoom: 1.0 }
    ],
    previewMode: false
  };

  function styles() {
    return '' +
      ':host{all:initial;display:block}' +
      '*,*::before,*::after{box-sizing:border-box}' +
      '.prism{position:relative;container-type:inline-size;width:100%;aspect-ratio:1010/352;' +
        'background:var(--seam,#fff);border-radius:var(--radius,6px);overflow:hidden;isolation:isolate;' +
        'box-shadow:0 2px 6px rgba(20,25,40,.12),0 26px 60px rgba(20,25,40,.22)}' +
      '.panel{position:absolute;inset:0 auto 0 0;width:34cqw;z-index:2;' +
        'background-color:var(--panelBg,#F4F0E7);' +
        'background-image:radial-gradient(130% 100% at 16% 8%,color-mix(in srgb,#fff 60%,var(--panelBg)),var(--panelBg) 62%);' +
        'clip-path:polygon(0 0,100% 0,calc(100% - var(--slant)) 100%,0 100%);' +
        'padding:3.4cqw 2cqw 3.4cqw 4cqw;display:flex;flex-direction:column;justify-content:center}' +
      '.title{margin:0;align-self:flex-start;font-family:var(--titleF);font-weight:var(--titleW);' +
        'font-size:var(--titleS);letter-spacing:var(--titleL);color:var(--titleC);line-height:.98;text-transform:uppercase}' +
      '.script{margin:.3cqw 0 0 .6cqw;align-self:flex-start;font-family:var(--scriptF);font-weight:400;' +
        'font-size:var(--scriptS);color:var(--scriptC);line-height:1;white-space:nowrap}' +
      '.copy{margin-top:1.9cqw;display:flex;flex-direction:column;align-items:center;text-align:center;gap:1.4cqw}' +
      '.rule{display:flex;align-items:center;gap:.9cqw;width:12cqw}' +
      '.rule i{height:1px;flex:1;background:linear-gradient(90deg,transparent,var(--gold) 45%,var(--gold) 55%,transparent);opacity:.85}' +
      '.rule b{width:.8cqw;height:.8cqw;background:var(--gold);transform:rotate(45deg);flex:0 0 auto}' +
      '.lead{margin:0;font-family:var(--leadF);font-weight:var(--leadW);font-size:var(--leadS);color:var(--leadC);line-height:1.24;white-space:pre-line}' +
      '.body{margin:0;font-family:var(--bodyF);font-weight:var(--bodyW);font-size:var(--bodyS);color:var(--bodyC);line-height:1.4;white-space:pre-line;max-width:23cqw}' +
      '.strip{position:absolute;top:0;bottom:0;right:0;left:calc(34cqw - var(--slant));z-index:1;display:flex;background:var(--seam,#fff)}' +
      '.slice{position:relative;flex:1 1 0;min-width:0;overflow:hidden;text-decoration:none;' +
        'margin-left:calc(var(--seamw,.3cqw) - var(--slant));' +
        'clip-path:polygon(var(--slant) 0,100% 0,calc(100% - var(--slant)) 100%,0 100%)}' +
      '.slice:first-child{margin-left:0}' +
      '.slice:last-child{clip-path:polygon(var(--slant) 0,100% 0,100% 100%,0 100%)}' +
      '.slice.fb0{background:' + FALLBACKS[0] + '}.slice.fb1{background:' + FALLBACKS[1] + '}.slice.fb2{background:' + FALLBACKS[2] + '}' +
      '.slice.fb3{background:' + FALLBACKS[3] + '}.slice.fb4{background:' + FALLBACKS[4] + '}.slice.fb5{background:' + FALLBACKS[5] + '}' +
      '.ph{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transition:transform .18s ease,object-position .18s ease}' +
      '.scrim{content:"";position:absolute;inset:0;z-index:1;pointer-events:none;' +
        'background:linear-gradient(to top,rgba(6,12,22,.62) 0%,rgba(6,12,22,.16) 26%,transparent 46%)}' +
      '.label{position:absolute;left:0;right:0;bottom:2.3cqw;z-index:2;text-align:center;white-space:nowrap;' +
        'font-family:var(--labelF);font-weight:600;font-size:var(--labelS);letter-spacing:var(--labelL);color:var(--labelC);' +
        'text-transform:uppercase;text-shadow:0 1px 10px rgba(0,0,0,.55),0 1px 2px rgba(0,0,0,.5);' +
        'transform:translateX(calc(-0.42 * var(--slant)))}' +
      '.slice:last-child .label{transform:none}' +
      'a.slice:focus-visible{outline:3px solid #fff;outline-offset:-3px}' +
      '@container (max-width:560px){.prism{aspect-ratio:5/4}.body{max-width:26cqw}}' +
      '@media (prefers-reduced-motion:reduce){.ph{transition:none}}';
  }

  function TGPrismWidget(container, config) {
    this.el = container;
    this.cfg = mergeConfig(config);
    this.shadow = container.shadowRoot || (container.attachShadow ? container.attachShadow({ mode: 'open' }) : container);
    this._ro = null;
    this._onClick = this._onClick.bind(this);
    this._refit = this._refit.bind(this);
    this._build();
  }

  function mergeConfig(config) {
    var c = config || {};
    function grp(name) { return Object.assign({}, DEFAULTS[name], c[name] || {}); }
    var items = Array.isArray(c.items) && c.items.length ? c.items : DEFAULTS.items;
    return {
      title: grp('title'), script: grp('script'), lead: grp('lead'), body: grp('body'), labels: grp('labels'),
      panelBg: c.panelBg != null ? c.panelBg : DEFAULTS.panelBg,
      seam: c.seam != null ? c.seam : DEFAULTS.seam,
      slant: c.slant != null ? c.slant : DEFAULTS.slant,
      radius: c.radius != null ? c.radius : DEFAULTS.radius,
      items: items.slice(0, 12),
      previewMode: !!c.previewMode
    };
  }

  TGPrismWidget.prototype._vars = function () {
    var c = this.cfg;
    var t = c.title, s = c.script, ld = c.lead, bd = c.body, lb = c.labels;
    return [
      '--panelBg:' + safeColor(c.panelBg, '#F4F0E7'),
      '--seam:' + safeColor(c.seam, '#FFFFFF'),
      '--slant:' + clampNum(c.slant, 0, 8, 2.7) + 'cqw',
      '--radius:' + clampNum(c.radius, 0, 40, 6) + 'px',
      '--gold:' + safeColor(s.color, '#A6792F'),
      '--titleF:' + fontStack(safeFontName(t.font, 'Playfair Display')),
      '--titleS:' + clampNum(t.size, 1.5, 6, 3.35) + 'cqw',
      '--titleC:' + safeColor(t.color, '#1E2E49'),
      '--titleL:' + (clampNum(t.tracking, -4, 30, 6) / 100) + 'em',
      '--titleW:' + clampNum(t.weight, 400, 700, 700),
      '--scriptF:' + fontStack(safeFontName(s.font, 'Great Vibes')),
      '--scriptS:' + clampNum(s.size, 1.5, 6, 3.5) + 'cqw',
      '--scriptC:' + safeColor(s.color, '#A6792F'),
      '--leadF:' + fontStack(safeFontName(ld.font, 'EB Garamond')),
      '--leadS:' + clampNum(ld.size, 1, 4, 2.1) + 'cqw',
      '--leadC:' + safeColor(ld.color, '#22344F'),
      '--leadW:' + clampNum(ld.weight, 400, 700, 600),
      '--bodyF:' + fontStack(safeFontName(bd.font, 'EB Garamond')),
      '--bodyS:' + clampNum(bd.size, 0.9, 3, 1.5) + 'cqw',
      '--bodyC:' + safeColor(bd.color, '#46566C'),
      '--bodyW:' + clampNum(bd.weight, 400, 700, 500),
      '--labelF:' + fontStack(safeFontName(lb.font, 'Cinzel')),
      '--labelS:' + clampNum(lb.size, 0.8, 3, 1.4) + 'cqw',
      '--labelC:' + safeColor(lb.color, '#FFFFFF'),
      '--labelL:' + (clampNum(lb.tracking, -4, 30, 6) / 100) + 'em'
    ].join(';');
  };

  TGPrismWidget.prototype._slice = function (item, i) {
    var img = safeUrl(item.image);
    var href = this.cfg.previewMode ? '' : safeUrl(item.href);
    var fx = clampNum(item.fx, 0, 100, 50), fy = clampNum(item.fy, 0, 100, 50), z = clampNum(item.zoom, 1, 3, 1);
    var st = 'object-position:' + fx + '% ' + fy + '%;transform:scale(' + z + ');transform-origin:' + fx + '% ' + fy + '%';
    var label = esc(item.label || '');
    var inner = '<img class="ph" alt=""' + (img ? ' src="' + esc(img) + '"' : '') + ' style="' + st + '">' +
      '<span class="scrim" aria-hidden="true"></span><span class="label">' + label + '</span>';
    var cls = 'slice fb' + (i % 6);
    if (href) {
      var tgt = item.newTab ? ' target="_blank" rel="noopener"' : '';
      return '<a class="' + cls + '" href="' + esc(href) + '"' + tgt + (label ? ' aria-label="' + label + '"' : '') + '>' + inner + '</a>';
    }
    return '<div class="' + cls + '"' + (label ? ' role="img" aria-label="' + label + '"' : '') + '>' + inner + '</div>';
  };

  TGPrismWidget.prototype._build = function () {
    var c = this.cfg;
    [c.title.font, c.script.font, c.lead.font, c.body.font, c.labels.font].forEach(function (f) { ensureFont(safeFontName(f, '')); });

    var slices = c.items.map(this._slice, this).join('');
    this.shadow.innerHTML = '<style>' + styles() + '</style>' +
      '<div class="prism" part="prism" style="' + this._vars() + '">' +
        '<div class="panel">' +
          '<h2 class="title">' + esc(c.title.text) + '</h2>' +
          '<p class="script">' + esc(c.script.text) + '</p>' +
          '<div class="copy">' +
            '<div class="rule" aria-hidden="true"><i></i><b></b><i></i></div>' +
            '<p class="lead">' + esc(c.lead.text) + '</p>' +
            '<p class="body">' + esc(c.body.text) + '</p>' +
          '</div>' +
        '</div>' +
        '<div class="strip">' + slices + '</div>' +
      '</div>';

    this.root = this.shadow.querySelector('.prism');
    this.panel = this.shadow.querySelector('.panel');
    this.strip = this.shadow.querySelector('.strip');

    // Image fallback: on error, hide the photo so the slice's fallback gradient shows.
    var imgs = this.shadow.querySelectorAll('.ph');
    for (var i = 0; i < imgs.length; i++) {
      (function (im) { im.addEventListener('error', function () { im.style.display = 'none'; }, { once: true }); })(imgs[i]);
    }

    // In the editor preview, clicks must not navigate away.
    if (c.previewMode) this.strip.addEventListener('click', this._onClick);

    // Auto-fit: no font or size can clip against the diagonal.
    var self = this;
    if (window.ResizeObserver) { this._ro = new ResizeObserver(function () { self._refit(); }); this._ro.observe(this.root); }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(this._refit).catch(function () {});
    requestAnimationFrame(this._refit);
  };

  TGPrismWidget.prototype._onClick = function (e) { var a = e.target.closest && e.target.closest('a.slice'); if (a) e.preventDefault(); };

  TGPrismWidget.prototype._fit = function (el, avail) {
    if (!el) return;
    el.style.fontSize = '';
    if (!avail || avail <= 0) return;
    var w = el.getBoundingClientRect().width;
    if (w > avail) el.style.fontSize = (parseFloat(getComputedStyle(el).fontSize) * (avail / w)) + 'px';
  };
  TGPrismWidget.prototype._refit = function () {
    // Self-terminate if the host left the document without destroy() (hardening rule 4).
    if (this.el && !this.el.isConnected) { this.destroy(); return; }
    if (!this.panel || !this.root) return;
    var cs = getComputedStyle(this.panel);
    var avail = this.panel.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    this._fit(this.shadow.querySelector('.title'), avail);
    this._fit(this.shadow.querySelector('.script'), avail);
    var slantPx = this.root.clientWidth * (clampNum(this.cfg.slant, 0, 8, 2.7) / 100);
    var labels = this.shadow.querySelectorAll('.slice');
    for (var i = 0; i < labels.length; i++) {
      var lab = labels[i].querySelector('.label');
      this._fit(lab, labels[i].clientWidth - slantPx - 8);
    }
  };

  TGPrismWidget.prototype.update = function (newConfig) {
    this.cfg = mergeConfig(newConfig);
    this.destroy(true);
    this._build();
  };

  TGPrismWidget.prototype.destroy = function (keepShadow) {
    if (this._ro) { try { this._ro.disconnect(); } catch (e) {} this._ro = null; }
    if (this.strip) { try { this.strip.removeEventListener('click', this._onClick); } catch (e) {} }
    if (!keepShadow && this.shadow) this.shadow.innerHTML = '';
  };

  // ─── Boot ───────────────────────────────────────────────────
  function fetchConfig(id) {
    return fetch(API_BASE + '?id=' + encodeURIComponent(id), { method: 'GET', credentials: 'omit' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { return d && d.config ? d.config : null; })
      .catch(function () { return null; });
  }
  function initOne(el) {
    if (el.__tgInited) return;
    el.__tgInited = true;
    var inline = el.getAttribute('data-tg-config');
    if (inline) {
      var cfg = null; try { cfg = JSON.parse(inline); } catch (e) { cfg = null; }
      try { new TGPrismWidget(el, cfg || {}); } catch (e) { if (window.console) console.error('[TGPrism] init failed', e); }
      return;
    }
    var id = el.getAttribute('data-tg-id');
    if (id) { fetchConfig(id).then(function (cfg) { try { new TGPrismWidget(el, cfg || {}); } catch (e) { if (window.console) console.error('[TGPrism] init failed', e); } }); }
    else { try { new TGPrismWidget(el, {}); } catch (e) { if (window.console) console.error('[TGPrism] init failed', e); } }
  }
  function init() {
    var containers = document.querySelectorAll('[data-tg-widget="prism"]');
    for (var i = 0; i < containers.length; i++) initOne(containers[i]);
  }

  TGPrismWidget.DEFAULTS = DEFAULTS;
  TGPrismWidget.FONTS = FONTS;
  window.TGPrismWidget = TGPrismWidget;
  window.__TG_PRISM_VERSION__ = VERSION;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
