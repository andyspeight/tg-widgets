/* ============================================================================
   World Map — editor onboarding  v2.0.0
   ----------------------------------------------------------------------------
   A complete reset from v1. Instead of illustrating the widget, this guide
   RUNS THE REAL WIDGET live inside it — the same TGWorldMapWidget that ships
   to clients, with real MapTiler tiles, real offer data and full interactivity.

   Requires:
     - editor-onboarding.js  (v1.2+, adds tgse.onboarding + onLeave hook)
     - widget-worldmap.js     (exposes window.TGWorldMapWidget)

   Six chapters, sized to the widget's real depth:
     1  Hero        the real, live, interactive map (the wow)
     2  Explore      region selector — how visitors browse by area
     3  Drill in     country -> resorts -> live "Latest deals" cards
     4  Filter       budget + star filters, immersive fullscreen
     5  Curate       SETUP: choose which destinations appear
     6  Brand + ship SETUP: colours, font, heading, then the embed code

   Chapters 1-4 mount a real widget instance; the instance is torn down on
   leave/close via the engine's onLeave hook so nothing leaks.
   ============================================================================ */
(function () {
  'use strict';

  // ── art styles (only the scaffolding around the live widget + setup mocks) ──
  var STYLE_ID = 'wm-onb2-styles';
  function injectArtStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var css = `
    /* live widget mount — fills the full-width art frame */
    .wmL-mount{ position:absolute; inset:0; border-radius:13px; overflow:hidden; background:color-mix(in srgb, var(--tgse-text,#fff) 4%, transparent); }
    .wmL-mount > [data-tg-widget]{ display:block; width:100%; height:100%; }
    .wmL-loading{ position:absolute; inset:0; display:flex; flex-direction:column; gap:12px; align-items:center; justify-content:center;
      color:var(--tgse-text-muted,#94a3b8); font-family:Inter,sans-serif; font-size:12.5px; }
    .wmL-spin{ width:30px; height:30px; border-radius:50%;
      border:2.5px solid color-mix(in srgb, var(--tgse-brand,#0891B2) 22%, transparent);
      border-top-color:var(--tgse-brand,#0891B2); animation:wmL-spin .8s linear infinite; }
    @keyframes wmL-spin{ to{ transform:rotate(360deg); } }

    /* ── SETUP chapter mocks — centred in the wide frame ── */
    .wmS{ position:absolute; inset:0; display:flex; flex-direction:column; gap:12px; justify-content:center; align-items:center; padding:16px; }
    .wmS-panel{ width:100%; max-width:560px; border:1px solid var(--tgse-border,#334155); border-radius:13px; overflow:hidden;
      background:color-mix(in srgb, var(--tgse-text,#fff) 3%, transparent); }
    .wmS-head{ display:flex; align-items:center; gap:9px; padding:11px 14px; border-bottom:1px solid var(--tgse-border,#334155);
      font-family:Inter,sans-serif; font-size:12.5px; font-weight:700; color:var(--tgse-text,#e6edf6); }
    .wmS-head svg{ width:15px; height:15px; stroke:var(--tgse-brand,#0891B2); stroke-width:2; fill:none; stroke-linecap:round; stroke-linejoin:round; }
    .wmS-body{ padding:12px 14px; }

    /* curation */
    .wmS-pills{ display:flex; gap:7px; margin-bottom:11px; flex-wrap:wrap; }
    .wmS-pill{ font-family:Inter,sans-serif; font-size:11.5px; font-weight:700; padding:5px 12px; border-radius:999px;
      border:1.5px solid var(--tgse-brand,#0891B2); color:var(--tgse-brand,#0891B2); background:transparent; }
    .wmS-pill.on{ background:var(--tgse-brand,#0891B2); color:#fff; }
    .wmS-grid{ display:grid; grid-template-columns:1fr 1fr; gap:8px 14px; }
    .wmS-row{ display:flex; align-items:center; gap:8px; font-family:Inter,sans-serif; font-size:12.5px; color:var(--tgse-text,#e6edf6); }
    .wmS-box{ width:15px; height:15px; border-radius:4px; border:1.5px solid var(--tgse-border-strong,#475569); flex:0 0 auto; position:relative; }
    .wmS-box.on{ background:var(--tgse-brand,#0891B2); border-color:var(--tgse-brand,#0891B2); }
    .wmS-box svg{ position:absolute; inset:0; width:100%; height:100%; }
    .wmS-box svg path{ stroke:#fff; stroke-width:2.4; fill:none; stroke-linecap:round; stroke-linejoin:round; }
    .wmS-hint{ margin:11px 0 0; font-family:Inter,sans-serif; font-size:11px; line-height:1.5; color:var(--tgse-text-muted,#94a3b8); }

    /* brand row */
    .wmS-swrow{ display:flex; gap:18px; align-items:flex-start; }
    .wmS-sw{ display:flex; flex-direction:column; gap:6px; align-items:flex-start; }
    .wmS-chip{ width:46px; height:46px; border-radius:11px; box-shadow:0 6px 14px -7px rgba(0,0,0,.4); }
    .wmS-chip.accent{ background:var(--tgse-brand,#0891B2); }
    .wmS-chip.primary{ background:#13315c; display:flex; align-items:center; justify-content:center; color:#fff; font-family:Inter,sans-serif; font-weight:800; font-size:14px; }
    .wmS-swlab{ font-family:Inter,sans-serif; font-size:10.5px; font-weight:600; color:var(--tgse-text-muted,#94a3b8); }
    .wmS-font{ flex:1 1 auto; }
    .wmS-select{ display:flex; align-items:center; justify-content:space-between; padding:9px 12px; border-radius:9px;
      border:1px solid var(--tgse-border-strong,#475569); font-family:Inter,sans-serif; font-size:12.5px; color:var(--tgse-text,#e6edf6); }
    .wmS-select svg{ width:14px; height:14px; stroke:var(--tgse-text-muted,#94a3b8); stroke-width:2; fill:none; }

    /* embed */
    .wmS-code{ display:flex; align-items:center; gap:10px; padding:11px 13px; border-radius:10px;
      background:#0b1220; border:1px solid var(--tgse-border,#334155); }
    .wmS-code-text{ font-family:'JetBrains Mono',monospace; font-size:10.5px; color:var(--tgse-brand,#22D3EE); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; flex:1 1 auto; }
    .wmS-copy{ flex:0 0 auto; font:inherit; font-family:Inter,sans-serif; font-size:11px; font-weight:600; cursor:pointer; color:#fff; border:none;
      padding:6px 11px; border-radius:7px; background:var(--tgse-brand,#0891B2); transition:filter .14s; }
    .wmS-copy:hover{ filter:brightness(1.08); }
    `;
    var el = document.createElement('style');
    el.id = STYLE_ID; el.textContent = css;
    document.head.appendChild(el);
  }

  // ── live-widget mount helpers ───────────────────────────────────────────────
  // We keep at most one live instance alive at a time. Each chapter that wants
  // the live map calls mountLive(frame, cfg, tip); leaveLive(frame) tears it down.
  function liveArt() {
    return '<div class="wmL-mount" data-wm-live>' +
             '<div class="wmL-loading"><span class="wmL-spin"></span><span>Loading your live map…</span></div>' +
           '</div>';
  }

  function mountLive(frame, cfg) {
    if (!frame) return;
    var mount = frame.querySelector('[data-wm-live]');
    if (!mount) return;

    if (typeof window.TGWorldMapWidget !== 'function') {
      mount.innerHTML = '<div class="wmL-loading"><span>Live map needs widget-worldmap.js</span></div>';
      return;
    }
    var host = document.createElement('div');
    host.setAttribute('data-tg-widget', 'worldmap');
    try {
      var inst = new window.TGWorldMapWidget(host, cfg || {});
      mount._tgInst = inst;
    } catch (e) {
      mount.innerHTML = '<div class="wmL-loading"><span>Map unavailable right now</span></div>';
      return;
    }
    var loader = mount.querySelector('.wmL-loading');
    mount.appendChild(host);
    setTimeout(function () { if (loader && loader.parentNode) loader.parentNode.removeChild(loader); }, 650);
  }

  function leaveLive(frame) {
    if (!frame) return;
    var mount = frame.querySelector('[data-wm-live]');
    if (!mount) return;
    var inst = mount._tgInst;
    // best-effort teardown: the widget owns a shadow DOM + key handlers.
    try { if (inst && typeof inst.destroy === 'function') inst.destroy(); } catch (e) {}
    try { if (inst && typeof inst._closeOverlay === 'function') inst._closeOverlay(); } catch (e) {}
    mount._tgInst = null;
    mount.innerHTML = '';
  }

  // shared base config for the in-guide widget. No countries allow-list, so the
  // map opens on the genuine world view a client sees by default, showing the
  // full spread of live offers.
  function baseCfg(extra) {
    return Object.assign({
      theme: 'dark',
      title: 'Where will you go next?',
      subtitle: 'Browse our latest offers from around the world',
      showFullscreenButton: true,
      maxPins: 16
    }, extra || {});
  }

  // ── SETUP chapter art ───────────────────────────────────────────────────────
  var ICON_PIN = '<svg viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>';
  var ICON_BRUSH = '<svg viewBox="0 0 24 24"><path d="M9.06 11.9l8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08"/><path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z"/></svg>';
  var ICON_CODE = '<svg viewBox="0 0 24 24"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>';
  var TICK = '<svg viewBox="0 0 16 16"><path d="M3.5 8.2 L6.6 11.3 L12.5 4.8"/></svg>';
  var CHEV = '<svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>';

  function curationRow(label, on, order) {
    var d = (0.16 + order * 0.06).toFixed(2);
    var box = on
      ? '<span class="wmS-box on tgob-a-pop" style="animation-delay:' + (0.16 + order * 0.06 + 0.1).toFixed(2) + 's">' + TICK + '</span>'
      : '<span class="wmS-box"></span>';
    return '<div class="wmS-row tgob-a-rise" style="animation-delay:' + d + 's">' + box + '<span>' + label + '</span></div>';
  }

  var ART_CURATE =
    '<div class="wmS">' +
      '<div class="wmS-panel tgob-a-rise">' +
        '<div class="wmS-head">' + ICON_PIN + ' Destinations shown</div>' +
        '<div class="wmS-body">' +
          '<div class="wmS-pills">' +
            '<span class="wmS-pill on tgob-sweep-host tgob-a-rise" style="animation-delay:.04s">Europe<span class="tgob-sweep" style="animation-delay:.55s"></span></span>' +
            '<span class="wmS-pill tgob-a-rise" style="animation-delay:.1s">Caribbean</span>' +
            '<span class="wmS-pill tgob-a-rise" style="animation-delay:.16s">Asia</span>' +
          '</div>' +
          '<div class="wmS-grid">' +
            curationRow('Spain', true, 0) + curationRow('Greece', true, 1) +
            curationRow('Portugal', true, 2) + curationRow('Italy', true, 3) +
            curationRow('Turkey', true, 4) + curationRow('Croatia', false, 5) +
          '</div>' +
          '<p class="wmS-hint">Tick a region to switch on all its countries, or choose individually. Leave everything unticked and the map shows every destination you have offers for.</p>' +
        '</div>' +
      '</div>' +
    '</div>';

  var ART_BRAND =
    '<div class="wmS">' +
      '<div class="wmS-panel tgob-a-rise">' +
        '<div class="wmS-head">' + ICON_BRUSH + ' Colours &amp; type</div>' +
        '<div class="wmS-body">' +
          '<div class="wmS-swrow">' +
            '<div class="wmS-sw"><div class="wmS-chip accent tgob-a-pop" style="animation-delay:.1s"></div><span class="wmS-swlab">Accent</span></div>' +
            '<div class="wmS-sw"><div class="wmS-chip primary tgob-a-pop" style="animation-delay:.18s">\u00A3</div><span class="wmS-swlab">Primary</span></div>' +
            '<div class="wmS-sw wmS-font"><div class="wmS-select tgob-a-rise" style="animation-delay:.26s"><span>Inter</span>' + CHEV + '</div><span class="wmS-swlab">Font</span></div>' +
          '</div>' +
          '<p class="wmS-hint">Accent drives the active pins and highlights. Primary is the structural colour behind price tags and buttons. We warn you if a shade is too light to read white text on. Pick a font that matches your site and the map looks like part of your brand.</p>' +
        '</div>' +
      '</div>' +
    '</div>';

  var EMBED = '<div data-tg-widget="worldmap" data-tg-id="YOUR_WIDGET_ID"></div>';
  var ART_SHIP =
    '<div class="wmS">' +
      '<div class="wmS-panel tgob-a-rise">' +
        '<div class="wmS-head">' + ICON_CODE + ' Your embed code</div>' +
        '<div class="wmS-body">' +
          '<div class="wmS-code tgob-a-rise" style="animation-delay:.1s">' +
            '<span class="wmS-code-text" data-embed></span>' +
            '<button type="button" class="wmS-copy" data-copy>Copy</button>' +
          '</div>' +
          '<p class="wmS-hint">Save your widget, drop this one line wherever you want the map to appear, and add the widget script once per page. That is the whole job. The map fills with your live offers the moment it loads.</p>' +
        '</div>' +
      '</div>' +
    '</div>';

  function shipHook(frame) {
    if (!frame) return;
    var out = frame.querySelector('[data-embed]');
    var btn = frame.querySelector('[data-copy]');
    if (out) {
      var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduce) { out.textContent = EMBED; }
      else {
        out.textContent = '';
        var caret = document.createElement('span'); caret.className = 'tgob-caret';
        out.after(caret);
        var i = 0;
        (function step() {
          if (!out.isConnected) return;
          out.textContent = EMBED.slice(0, i); i++;
          if (i <= EMBED.length) setTimeout(step, 22);
          else setTimeout(function () { if (caret.isConnected) caret.remove(); }, 700);
        })();
      }
    }
    if (btn) btn.addEventListener('click', function () {
      try { navigator.clipboard.writeText(EMBED); } catch (e) {}
      btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = 'Copy'; }, 1400);
    });
  }

  // ── chapters ────────────────────────────────────────────────────────────────
  var CHAPTERS = [
    {
      kicker: 'Chapter 1',
      titleHtml: 'This is your map. <em>Live, right now.</em>',
      body: 'Everything below is the real widget on real data. Your latest holiday offers, plotted where they go, with genuine prices per person. It refreshes itself in the background, so it never goes stale.',
      hint: 'Drag it, zoom it, click a pin. It is all live.',
      art: liveArt,
      onArt: function (f) { mountLive(f, baseCfg()); },
      onLeave: leaveLive
    },
    {
      kicker: 'Chapter 2',
      titleHtml: 'Your customers <em>browse by region</em>.',
      body: 'Open the map up and a region selector appears. Worldwide gives the clustered overview, then one tap reframes to Europe, the Caribbean, Asia, wherever they fancy.',
      hint: 'Tap View fullscreen to see the regions.',
      art: liveArt,
      onArt: function (f) { mountLive(f, baseCfg()); },
      onLeave: leaveLive
    },
    {
      kicker: 'Chapter 3',
      titleHtml: 'Every pin <em>opens right up</em>.',
      body: 'Tap a country and the map drills into its resorts while a deals panel fills with real, bookable offers. Photos, hotels, star ratings, prices, straight through to book.',
      hint: 'In fullscreen, tap a price pin.',
      art: liveArt,
      onArt: function (f) { mountLive(f, baseCfg()); },
      onLeave: leaveLive
    },
    {
      kicker: 'Chapter 4',
      titleHtml: 'They <em>filter to what fits</em>.',
      body: 'Inside the immersive fullscreen view, visitors filter the deals by budget per person and by star rating, so every kind of traveller finds their trip fast.',
      hint: 'Look for Rating and Max budget.',
      art: liveArt,
      onArt: function (f) { mountLive(f, baseCfg()); },
      onLeave: leaveLive
    },
    {
      kicker: 'Chapter 5  ·  Setup',
      titleHtml: 'Choose <em>what goes on your map</em>.',
      body: 'Now the easy part. Under "Destinations shown" you pick what appears. Show only the Greek islands, or leave it open and every destination you have offers for is pinned automatically. You never edit pins by hand.',
      art: ART_CURATE
    },
    {
      kicker: 'Chapter 6  ·  Setup',
      titleHtml: 'Brand it, then <em>go live</em>.',
      body: 'Set your colours, font and heading so the map looks built for your site. Then copy the one-line embed and paste it anywhere. The map fills with your live offers the moment it loads.',
      art: ART_SHIP,
      onArt: shipHook
    }
  ];

  var _instance = null;
  window.initWorldMapOnboarding = function () {
    if (_instance) return _instance;
    if (!window.tgse || typeof window.tgse.onboarding !== 'function') {
      console.warn('[worldmap-onboarding] tgse.onboarding not available — load editor-onboarding.js');
      return;
    }
    injectArtStyles();
    _instance = window.tgse.onboarding({ id: 'worldmap', chapters: CHAPTERS });
    return _instance;
  };

})();
