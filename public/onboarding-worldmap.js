/* ============================================================================
   World Map — editor onboarding chapters  v1.1.0
   ----------------------------------------------------------------------------
   The four-chapter "Getting started" guide for the World Map editor.
   Requires editor-onboarding.js (adds tgse.onboarding + animation library).

   v1.1: the illustrations now MOVE — each one demonstrates the feature it
   describes, using the engine's generic animation classes:
     Ch1  pins drop onto a live map and pulse; price tags pop in
     Ch2  region pills light up, country ticks cascade on
     Ch3  brand colours pop in and sweep across a sample heading
     Ch4  browser + map assemble, fullscreen pulses, embed code self-types

   Copy is matched to the real editor labels (Heading & intro / Destinations
   shown / Colours / Typography / Show fullscreen button). No em dashes.
   ============================================================================ */
(function () {
  'use strict';

  var STYLE_ID = 'wm-onb-styles';
  function injectArtStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var css = `
    /* ── shared art canvas ─────────────────────────────────────────────── */
    .wm-stage{ position:absolute; inset:0; }

    /* ── Ch1: living map ──────────────────────────────────────────────── */
    .wm-map{ position:absolute; inset:0; }
    .wm-map svg{ width:100%; height:100%; display:block; }
    .wm-land{ fill:color-mix(in srgb, var(--tgse-text,#fff) 11%, transparent); }
    .wm-pin{ position:absolute; transform:translate(-50%,-100%); }
    .wm-pin-inner{ position:relative; display:block; }
    .wm-pin-svg{ display:block; width:30px; height:40px; position:relative; z-index:2;
      filter:drop-shadow(0 4px 8px rgba(0,0,0,.35)); }
    .wm-pin-svg path, .wm-pin-svg circle.head{ fill:var(--tgse-brand,#0891B2); }
    .wm-pin-svg circle.dot{ fill:#fff; }
    .wm-pulse{ position:absolute; top:3px; left:50%; width:22px; height:22px; margin-left:-11px;
      border-radius:50%; background:color-mix(in srgb, var(--tgse-brand,#0891B2) 55%, transparent); z-index:1; }
    .wm-tagwrap{ position:absolute; bottom:100%; left:50%; transform:translateX(-50%); margin-bottom:8px; z-index:3; }
    .wm-tag{ display:inline-block; white-space:nowrap; font-family:Inter,sans-serif; font-size:11px; font-weight:700;
      color:var(--tgse-text,#e6edf6); background:var(--tgse-surface,#0e1726);
      border:1px solid var(--tgse-border,#334155); border-radius:7px; padding:3px 8px;
      box-shadow:0 6px 14px -6px rgba(0,0,0,.5); }

    /* ── Ch2: curation ─────────────────────────────────────────────────── */
    .wm-cur{ position:absolute; inset:0; display:flex; flex-direction:column; gap:13px; justify-content:center; }
    .wm-pills{ display:flex; gap:8px; }
    .wm-pill{ font-family:Inter,sans-serif; font-size:12px; font-weight:700; padding:5px 13px; border-radius:999px;
      border:1.5px solid var(--tgse-brand,#0891B2); color:var(--tgse-brand,#0891B2); background:transparent; }
    .wm-pill.on{ background:var(--tgse-brand,#0891B2); color:#fff; }
    .wm-grid{ display:grid; grid-template-columns:1fr 1fr; gap:9px 14px; }
    .wm-row{ display:flex; align-items:center; gap:9px; font-family:Inter,sans-serif; font-size:13px; color:var(--tgse-text,#e6edf6); }
    .wm-box{ width:16px; height:16px; border-radius:5px; border:1.5px solid var(--tgse-border-strong,#475569);
      flex:0 0 auto; position:relative; }
    .wm-box.on{ background:var(--tgse-brand,#0891B2); border-color:var(--tgse-brand,#0891B2); }
    .wm-box svg{ position:absolute; inset:0; width:100%; height:100%; }
    .wm-box svg path{ stroke:#fff; stroke-width:2.4; fill:none; stroke-linecap:round; stroke-linejoin:round; }

    /* ── Ch3: design ──────────────────────────────────────────────────── */
    .wm-design{ position:absolute; inset:0; display:flex; flex-direction:column; gap:18px; justify-content:center; }
    .wm-swatches{ display:flex; gap:14px; }
    .wm-sw{ display:flex; flex-direction:column; gap:7px; align-items:flex-start; }
    .wm-sw-chip{ width:54px; height:54px; border-radius:13px; box-shadow:0 8px 18px -8px rgba(0,0,0,.4); }
    .wm-sw-chip.accent{ background:var(--tgse-brand,#0891B2); }
    .wm-sw-chip.primary{ background:#0f2236; display:flex; align-items:center; justify-content:center;
      color:#fff; font-family:Inter,sans-serif; font-weight:800; font-size:15px; }
    .wm-sw-label{ font-family:Inter,sans-serif; font-size:11px; font-weight:600; color:var(--tgse-text-muted,#94a3b8); }
    .wm-sample{ border:1px solid var(--tgse-border,#334155); border-radius:13px; padding:16px 18px;
      background:color-mix(in srgb, var(--tgse-text,#fff) 4%, transparent); }
    .wm-sample h4{ margin:0 0 5px; font-family:Inter,sans-serif; font-size:18px; font-weight:800; letter-spacing:-.01em;
      color:var(--tgse-text,#e6edf6); }
    .wm-sample h4 em{ font-style:normal; color:var(--tgse-brand,#0891B2); }
    .wm-sample p{ margin:0; font-family:Inter,sans-serif; font-size:12px; color:var(--tgse-text-muted,#94a3b8); }

    /* ── Ch4: ship ────────────────────────────────────────────────────── */
    .wm-ship{ position:absolute; inset:0; display:flex; flex-direction:column; gap:14px; justify-content:center; }
    .wm-browser{ border:1px solid var(--tgse-border,#334155); border-radius:13px; overflow:hidden;
      background:color-mix(in srgb, var(--tgse-text,#fff) 4%, transparent); }
    .wm-browser-bar{ display:flex; gap:6px; align-items:center; padding:9px 12px;
      border-bottom:1px solid var(--tgse-border,#334155); }
    .wm-dot{ width:8px; height:8px; border-radius:50%; background:var(--tgse-border-strong,#475569); }
    .wm-mini{ position:relative; height:96px; margin:12px;
      border-radius:9px; background:color-mix(in srgb, var(--tgse-brand,#0891B2) 12%, transparent); overflow:hidden; }
    .wm-mini-pin{ position:absolute; width:11px; height:11px; border-radius:50%; background:var(--tgse-brand,#0891B2);
      transform:translate(-50%,-50%); }
    .wm-mini-pulse{ position:absolute; width:11px; height:11px; border-radius:50%; transform:translate(-50%,-50%);
      background:color-mix(in srgb, var(--tgse-brand,#0891B2) 55%, transparent); }
    .wm-fs{ position:absolute; top:8px; right:8px; width:24px; height:24px; border-radius:6px;
      background:var(--tgse-surface,#0e1726); border:1px solid var(--tgse-brand,#0891B2);
      display:flex; align-items:center; justify-content:center; }
    .wm-fs svg{ width:13px; height:13px; stroke:var(--tgse-brand,#0891B2); stroke-width:2; fill:none;
      stroke-linecap:round; stroke-linejoin:round; }
    .wm-code{ display:flex; align-items:center; min-height:34px; padding:0 14px; border-radius:9px;
      background:#0b1220; border:1px solid var(--tgse-border,#334155);
      font-family:'JetBrains Mono',monospace; font-size:11px; color:var(--tgse-brand,#22D3EE); }
    .wm-code-text{ white-space:nowrap; }
    `;
    var el = document.createElement('style');
    el.id = STYLE_ID; el.textContent = css;
    document.head.appendChild(el);
  }

  // ── art builders ────────────────────────────────────────────────────────
  var TEARDROP =
    '<svg class="wm-pin-svg" viewBox="0 0 30 40" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M15 39 C6 27 1 21 1 13 A14 14 0 0 1 29 13 C29 21 24 27 15 39 Z"/>' +
      '<circle class="dot" cx="15" cy="13" r="5.2"/>' +
    '</svg>';

  function pin(leftPct, topPct, price, order) {
    var dropDelay = (0.12 + order * 0.14).toFixed(2);
    var tagDelay = (0.12 + order * 0.14 + 0.32).toFixed(2);
    var pulseDelay = (0.12 + order * 0.14 + 0.45).toFixed(2);
    return '<div class="wm-pin" style="left:' + leftPct + '%;top:' + topPct + '%">' +
      '<div class="wm-pin-inner tgob-a-drop" style="animation-delay:' + dropDelay + 's">' +
        '<div class="wm-tagwrap"><span class="wm-tag tgob-a-pop" style="animation-delay:' + tagDelay + 's">' + price + '</span></div>' +
        '<span class="wm-pulse tgob-pulse" style="animation-delay:' + pulseDelay + 's"></span>' +
        TEARDROP +
      '</div>' +
    '</div>';
  }

  var ART_MAP =
    '<div class="wm-stage">' +
      '<div class="wm-map"><svg viewBox="0 0 340 340" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">' +
        '<path class="wm-land" d="M30 96 q34-22 78-15 q40 8 52 33 q-14 28-58 30 q-52 3-72-20 q-8-12 -2-25 z"/>' +
        '<path class="wm-land" d="M186 80 q50-18 96-6 q42 12 44 42 q-24 30-84 28 q-58-2-66-32 q-2-20 6-32 z"/>' +
        '<path class="wm-land" d="M120 188 q44-16 90-8 q50 10 62 34 q-26 28-90 28 q-66 0-72-30 q-2-16 8-24 z"/>' +
        '<path class="wm-land" d="M232 226 q28-8 50 2 q20 10 18 30 q-18 18-52 14 q-30-4-36-24 q-2-14 12-20 z"/>' +
      '</svg></div>' +
      pin(24, 50, '\u00A3289', 0) +
      pin(62, 44, '\u00A3412', 1) +
      pin(78, 72, '\u00A3199', 2) +
      pin(42, 84, '\u00A3540', 3) +
    '</div>';

  var TICK = '<svg viewBox="0 0 16 16"><path d="M3.5 8.2 L6.6 11.3 L12.5 4.8"/></svg>';
  function row(label, on, order) {
    var d = (0.18 + order * 0.07).toFixed(2);
    var box = on
      ? '<span class="wm-box on tgob-a-pop" style="animation-delay:' + (0.18 + order * 0.07 + 0.12).toFixed(2) + 's">' + TICK + '</span>'
      : '<span class="wm-box"></span>';
    return '<div class="wm-row tgob-a-rise" style="animation-delay:' + d + 's">' + box + '<span>' + label + '</span></div>';
  }
  var ART_CURATE =
    '<div class="wm-cur">' +
      '<div class="wm-pills">' +
        '<span class="wm-pill on tgob-a-rise tgob-sweep-host" style="animation-delay:.02s">Europe<span class="tgob-sweep" style="animation-delay:.5s"></span></span>' +
        '<span class="wm-pill tgob-a-rise" style="animation-delay:.09s">Americas</span>' +
      '</div>' +
      '<div class="wm-grid">' +
        row('Spain', true, 0) + row('Greece', true, 1) +
        row('Portugal', true, 2) + row('Italy', false, 3) +
        row('Turkey', true, 4) + row('Croatia', false, 5) +
      '</div>' +
    '</div>';

  var ART_DESIGN =
    '<div class="wm-design">' +
      '<div class="wm-swatches">' +
        '<div class="wm-sw"><div class="wm-sw-chip accent tgob-a-pop" style="animation-delay:.1s"></div><span class="wm-sw-label">Accent</span></div>' +
        '<div class="wm-sw"><div class="wm-sw-chip primary tgob-a-pop" style="animation-delay:.2s">\u00A3</div><span class="wm-sw-label">Primary</span></div>' +
      '</div>' +
      '<div class="wm-sample tgob-a-rise tgob-sweep-host" style="animation-delay:.3s">' +
        '<h4>Where will you go <em>next?</em></h4>' +
        '<p>Your latest holiday offers, live</p>' +
        '<span class="tgob-sweep" style="animation-delay:.7s"></span>' +
      '</div>' +
    '</div>';

  var FS_GLYPH = '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
  var ART_SHIP =
    '<div class="wm-ship">' +
      '<div class="wm-browser tgob-a-rise" style="animation-delay:.05s">' +
        '<div class="wm-browser-bar"><span class="wm-dot"></span><span class="wm-dot"></span><span class="wm-dot"></span></div>' +
        '<div class="wm-mini">' +
          '<span class="wm-mini-pulse tgob-pulse" style="left:28%;top:54%;animation-delay:.9s"></span>' +
          '<span class="wm-mini-pin tgob-a-pop" style="left:28%;top:54%;animation-delay:.45s"></span>' +
          '<span class="wm-mini-pulse tgob-pulse" style="left:56%;top:40%;animation-delay:1.1s"></span>' +
          '<span class="wm-mini-pin tgob-a-pop" style="left:56%;top:40%;animation-delay:.6s"></span>' +
          '<span class="wm-mini-pin tgob-a-pop" style="left:78%;top:62%;animation-delay:.75s"></span>' +
          '<span class="wm-fs tgob-a-pop tgob-pulse" style="animation-delay:.9s">' + FS_GLYPH + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="wm-code tgob-a-rise" style="animation-delay:.35s"><span class="wm-code-text"></span></div>' +
    '</div>';

  // typewriter hook for the embed line (Ch4)
  var EMBED_SNIPPET = '<script src="widget-worldmap.js">';
  function typeEmbed(frame) {
    if (!frame) return;
    var elText = frame.querySelector('.wm-code-text');
    if (!elText) return;
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { elText.textContent = EMBED_SNIPPET; return; }
    elText.textContent = '';
    var caret = document.createElement('span');
    caret.className = 'tgob-caret';
    elText.after(caret);
    var i = 0;
    (function step() {
      if (!elText.isConnected) return;          // chapter changed; stop
      elText.textContent = EMBED_SNIPPET.slice(0, i);
      i++;
      if (i <= EMBED_SNIPPET.length) setTimeout(step, 26);
      else setTimeout(function () { if (caret.isConnected) caret.remove(); }, 900);
    })();
  }

  var CHAPTERS = [
    {
      kicker: 'Chapter 1',
      titleHtml: 'A living map of <em>every deal you sell</em>.',
      body: 'The World Map plots your latest holiday offers where they actually go, with live prices on every pin. Visitors hover, see the fare, and click straight through to book. It refreshes itself in the background, so it is always showing real, current deals, never a stale brochure.',
      art: ART_MAP
    },
    {
      kicker: 'Chapter 2',
      titleHtml: 'Show the <em>whole world</em>, or just your patch.',
      body: 'Under "Destinations shown" you choose what appears. Tick a region to switch on all its countries at once, or pick them one by one. Specialise in the Med? Show only that. Leave everything unticked and the map simply shows every destination you have offers for.',
      art: ART_CURATE
    },
    {
      kicker: 'Chapter 3',
      titleHtml: 'Make it <em>unmistakably yours</em>.',
      body: 'Set your Accent colour for pins and highlights, and a dark Primary colour for the price tags and buttons. We will warn you if a shade is too light to read. Add your heading and intro, pick a font that matches your site, and the map looks like it was built for your brand.',
      art: ART_DESIGN
    },
    {
      kicker: 'Chapter 4',
      titleHtml: 'Go full screen, then <em>go live</em>.',
      body: 'Turn on the fullscreen button to let visitors open an immersive, filterable map of every deal. When it looks right, hit Save, copy your one-line embed code, and paste it anywhere on your site. That is it. Your offers are on the map.',
      art: ART_SHIP,
      onArt: typeEmbed
    }
  ];

  window.initWorldMapOnboarding = function () {
    if (!window.tgse || typeof window.tgse.onboarding !== 'function') {
      console.warn('[worldmap-onboarding] tgse.onboarding not available — load editor-onboarding.js');
      return;
    }
    injectArtStyles();
    return window.tgse.onboarding({ id: 'worldmap', chapters: CHAPTERS });
  };

})();
