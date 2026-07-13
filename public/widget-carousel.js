/**
 * Travelgenix Destination Carousel Widget v1.0.0
 * Cinematic conveyor carousel: destination cards enter small on the right,
 * travel left growing through fanned, leaning positions, and arrive on the
 * left as a full-size hero scene with title, copy and CTA.
 * Self-contained, zero dependencies, Shadow DOM, accessible.
 *
 * Usage (remote config):
 *   <div data-tg-widget="carousel" data-tg-id="YOUR_WIDGET_ID"></div>
 *   <script src="https://tg-widgets.vercel.app/widget-carousel.js"></script>
 *
 * Usage (inline config):
 *   <div data-tg-widget="carousel" data-tg-config='{"slides":[...]}'></div>
 *   <script src="https://tg-widgets.vercel.app/widget-carousel.js"></script>
 *
 * © Travelgenix. All rights reserved.
 */
(function () {
  'use strict';

  const VERSION = '1.3.5';

  // ─── i18n ───────────────────────────────────────────────────
  // Fixed UI chrome only (navigation controls and structural aria-labels).
  // Slide titles, subtitles, body copy and CTA labels are author content and
  // are never translated here. English is the source + fallback. The default
  // region aria-label ('Destination carousel') is exposed via the localised
  // default pattern below so an author-set ariaLabel always wins.
  const MESSAGES = {
    en: { prevSlide: 'Previous slide', nextSlide: 'Next slide', goToSlide: 'Go to slide {n}', chooseSlide: 'Choose slide', pause: 'Pause', play: 'Play', carouselLabel: 'Destination carousel' },
    fr: { prevSlide: 'Diapositive précédente', nextSlide: 'Diapositive suivante', goToSlide: 'Aller à la diapositive {n}', chooseSlide: 'Choisir une diapositive', pause: 'Pause', play: 'Lecture', carouselLabel: 'Carrousel de destinations' },
    de: { prevSlide: 'Vorherige Folie', nextSlide: 'Nächste Folie', goToSlide: 'Zu Folie {n}', chooseSlide: 'Folie auswählen', pause: 'Pause', play: 'Wiedergabe', carouselLabel: 'Reiseziel-Karussell' },
    es: { prevSlide: 'Diapositiva anterior', nextSlide: 'Diapositiva siguiente', goToSlide: 'Ir a la diapositiva {n}', chooseSlide: 'Elegir diapositiva', pause: 'Pausar', play: 'Reproducir', carouselLabel: 'Carrusel de destinos' },
    it: { prevSlide: 'Diapositiva precedente', nextSlide: 'Diapositiva successiva', goToSlide: 'Vai alla diapositiva {n}', chooseSlide: 'Scegli diapositiva', pause: 'Pausa', play: 'Riproduci', carouselLabel: 'Carosello di destinazioni' },
    ro: { prevSlide: 'Diapozitivul anterior', nextSlide: 'Diapozitivul următor', goToSlide: 'Mergi la diapozitivul {n}', chooseSlide: 'Alege diapozitivul', pause: 'Pauză', play: 'Redare', carouselLabel: 'Carusel de destinații' },
  };
  // Uses the shared TGi18n core when present; otherwise an identical inline
  // resolver keeps the widget self-contained.
  function makeT(cfg) {
    if (typeof window !== 'undefined' && window.TGi18n && typeof window.TGi18n.make === 'function') return window.TGi18n.make(MESSAGES, cfg);
    const supported = Object.keys(MESSAGES);
    const baseOf = (r) => (r ? String(r).toLowerCase().replace(/_/g, '-').split('-')[0] : '');
    let cands = [];
    if (cfg) cands.push(cfg.lang, cfg.language, cfg.locale);
    try { cands.push(document.documentElement.getAttribute('lang')); } catch (e) { /* noop */ }
    try { if (navigator.languages) cands = cands.concat(navigator.languages); cands.push(navigator.language); } catch (e) { /* noop */ }
    let lang = 'en';
    for (let i = 0; i < cands.length; i++) { const b = baseOf(cands[i]); if (b && supported.indexOf(b) !== -1) { lang = b; break; } }
    const dict = MESSAGES[lang] || MESSAGES.en;
    const t = (k, vars) => {
      let s = Object.prototype.hasOwnProperty.call(dict, k) ? dict[k] : (MESSAGES.en[k] || k);
      if (vars) s = String(s).replace(/\{(\w+)\}/g, (m, n) => (vars[n] != null ? vars[n] : m));
      return s;
    };
    t.lang = lang; t.dir = 'ltr';
    return t;
  }

  function resolveBase(path, override) {
    if (typeof window === 'undefined') return path;
    if (override && window[override]) return window[override];
    try {
      const me = document.currentScript;
      if (me && me.src) return new URL(me.src).origin + path;
      // currentScript is null for async/defer/module or tag-manager injected
      // loads — scan for this widget's own script tag so the fetch still targets
      // the widget host rather than falling back to the relative path (which
      // resolves to the client's own origin and 404s).
      const scripts = document.getElementsByTagName('script');
      for (let i = scripts.length - 1; i >= 0; i--) {
        const s = scripts[i].src || '';
        if (/\/widget-carousel\.js(\?|$|#)/.test(s)) return new URL(s).origin + path;
      }
    } catch (e) { /* noop */ }
    return path;
  }
  const API_BASE = resolveBase('/api/widget-config', '__TG_WIDGET_API__');

  // ─── Helpers ────────────────────────────────────────────────
  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }
  function safeColor(c, fb) { return (typeof c === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c.trim())) ? c.trim() : fb; }
  function safeFont(f, fb) { return (typeof f === 'string' && /^[\w \-]{1,40}$/.test(f.trim())) ? f.trim() : fb; }
  function clampNum(v, min, max, fb) { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fb; }
  function prefersReducedMotion() { return typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }

  // Only http(s), site-relative, hash and mailto links survive. Anything else → '#'.
  function safeUrl(u) {
    const s = String(u || '').trim();
    if (!s) return '#';
    if (/^(https?:\/\/|\/|#|mailto:)/i.test(s) && !/[<>"']/.test(s)) return s;
    return '#';
  }
  // Images must be absolute http(s).
  function safeImg(u) {
    const s = String(u || '').trim();
    return /^https?:\/\//i.test(s) && !/[<>"']/.test(s) ? s : '';
  }

  // Build a clip polygon with a sloped top edge and rounded corners.
  // topL / topR  = top-edge height at the left / right side, as percentages (the slope).
  // radL / radR  = corner radius (px) for the left / right corners.
  // % positions keep it responsive; px radii keep the rounding uniform across cards of
  // different sizes. Always emits 12 points (3 per corner) so clip-path tweens smoothly
  // as a card travels between positions — even when a radius is 0 (points collapse, count holds).
  function clipShape(topL, topR, radL, radR) {
    const RL = radL + 'px', kL = (radL * 0.293).toFixed(2) + 'px';
    const RR = radR + 'px', kR = (radR * 0.293).toFixed(2) + 'px';
    return 'polygon(' + [
      '0% calc(' + topL + '% + ' + RL + ')',                 // TL — down the left edge
      'calc(0% + ' + kL + ') calc(' + topL + '% + ' + kL + ')', // TL — arc
      'calc(0% + ' + RL + ') ' + topL + '%',                 // TL — onto the top edge
      'calc(100% - ' + RR + ') ' + topR + '%',               // TR — along the top edge
      'calc(100% - ' + kR + ') calc(' + topR + '% + ' + kR + ')', // TR — arc
      '100% calc(' + topR + '% + ' + RR + ')',               // TR — down the right edge
      '100% calc(100% - ' + RR + ')',                        // BR — up the right edge
      'calc(100% - ' + kR + ') calc(100% - ' + kR + ')',     // BR — arc
      'calc(100% - ' + RR + ') 100%',                        // BR — along the bottom
      'calc(0% + ' + RL + ') 100%',                          // BL — along the bottom
      'calc(0% + ' + kL + ') calc(100% - ' + kL + ')',       // BL — arc
      '0% calc(100% - ' + RL + ')'                           // BL — up the left edge
    ].join(', ') + ')';
  }

  // Inject a Google Font once per page (editors/host pages may already have it).
  function ensureFont(family) {
    if (!family || typeof document === 'undefined') return;
    const id = 'tg-font-' + family.toLowerCase().replace(/\s+/g, '-');
    if (document.getElementById(id)) return;
    const l = document.createElement('link');
    l.id = id;
    l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=' + encodeURIComponent(family).replace(/%20/g, '+') + ':ital,wght@0,400;0,500;0,600;1,400&display=swap';
    document.head.appendChild(l);
  }

  const ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>';
  const ARROW_L = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>';
  const ARROW_R = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>';
  const PALM = '<svg class="tgcar-deco" viewBox="0 0 240 200" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" aria-hidden="true">'
    + '<path d="M10 8 C 60 30, 105 75, 130 140"/><path d="M10 8 C 70 18, 130 50, 168 105"/>'
    + '<path d="M10 8 C 40 48, 60 105, 64 165"/><path d="M52 42 C 80 56, 104 84, 118 118"/>'
    + '<path d="M30 70 C 50 92, 62 122, 66 152"/><path d="M78 30 C 112 48, 142 80, 158 118"/>'
    + '<path d="M10 8 C 26 60, 30 120, 22 176"/></svg>';

  const DEFAULTS = {
    // Content
    intro: '',
    showIntro: true,
    slides: [],
    // Design
    bg: '#060A14',            // widget background (deep navy)
    accent: '#D9B36A',        // gold
    textColor: '#F5F1E8',     // warm off-white
    headingFont: 'Cinzel',    // serif display
    subtitleFont: 'Cormorant Garamond',
    bodyFont: 'Inter',
    cardRadius: 18,           // travelling card corner radius (px)
    lean: 4,                  // max card lean in degrees (0 = flat)
    height: 430,              // stage height (px, desktop)
    showDeco: true,           // palm frond decoration
    // Behaviour
    autoplay: true,
    interval: 6,              // seconds per slide
    pauseOnHover: true,
    showArrows: true,
    showDots: true,
    ariaLabel: '',             // empty = localised default ('Destination carousel')
    fontFamily: '',           // legacy alias for headingFont (shell font picker)
  };

  function styles(c) {
    const speed = prefersReducedMotion() ? '0s' : '1s';
    // lean drives a gentle dimensional tilt: the middle card stays near-upright (it is the
    // feature — raised and on top); the last card tucks back further; the queued card most.
    const ryMid = (c.lean * 0.6).toFixed(2);
    const rzMid = (c.lean * 0.3).toFixed(2);
    const ryLast = (c.lean * 1.6).toFixed(2);
    const rzLast = (c.lean * 0.9).toFixed(2);
    const ryQ = (c.lean * 1.9).toFixed(2);
    const rzQ = (c.lean * 1.15).toFixed(2);
    // SHAPE — sloped tops with soft, rounded corners, cut with clip-path.
    // The slope reads as the angled top edge; the radius (your Corner-radius control) softens
    // the corners. Hero keeps SQUARE left corners (it bleeds off the left edge) and rounded
    // right corners; middle and last are rounded all round. The top edge slopes down to the
    // right on every card, gentlest on the middle so its top sits cleanly over the hero.
    const rad = clampNum(c.cardRadius, 0, 32, 18);
    const clipHero = clipShape(0, 15, 0, rad);
    const clipMid  = clipShape(0, 10, rad, rad);
    const clipLast = clipShape(2, 14, rad, rad);
    return `
      :host { all: initial; display: block; }
      *, *::before, *::after { box-sizing: border-box; }
      .tgcar {
        --tgcar-bg: ${c.bg};
        --tgcar-gold: ${c.accent};
        --tgcar-text: ${c.textColor};
        --tgcar-ease: cubic-bezier(0.45, 0, 0.15, 1);
        --tgcar-speed: ${speed};
        position: relative;
        width: 100%;
        background: var(--tgcar-bg);
        border-radius: 20px;
        padding: 22px 0 18px;
        overflow: hidden;
        font-family: '${c.bodyFont}', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        color: var(--tgcar-text);
      }
      .tgcar-deco {
        position: absolute; top: -28px; left: -24px;
        width: 240px; height: 200px;
        color: var(--tgcar-gold);
        opacity: .1;
        pointer-events: none;
        z-index: 6;
      }
      .tgcar-intro {
        text-align: center;
        color: color-mix(in srgb, var(--tgcar-text) 80%, transparent);
        font-size: 13px;
        line-height: 1.65;
        max-width: 560px;
        margin: 0 auto 16px;
        letter-spacing: .015em;
        position: relative;
        z-index: 7;
        padding: 0 24px;
      }
      .tgcar-stage { position: relative; height: ${clampNum(c.height, 320, 640, 430)}px; }

      .tgcar-card {
        position: absolute;
        top: auto;
        bottom: 0;
        transform-origin: bottom center;
        overflow: hidden;
        cursor: pointer;
        isolation: isolate;
        border: 0; padding: 0; background: var(--tgcar-bg); text-align: left;
        font: inherit; color: inherit;
        transition:
          left var(--tgcar-speed) var(--tgcar-ease),
          width var(--tgcar-speed) var(--tgcar-ease),
          height var(--tgcar-speed) var(--tgcar-ease),
          bottom var(--tgcar-speed) var(--tgcar-ease),
          transform var(--tgcar-speed) var(--tgcar-ease),
          clip-path var(--tgcar-speed) var(--tgcar-ease),
          opacity .6s var(--tgcar-ease);
        -webkit-tap-highlight-color: transparent;
      }
      .tgcar-card.no-anim { transition: none !important; }
      .tgcar-card:focus-visible { outline: 2px solid var(--tgcar-gold); outline-offset: 3px; }

      /* Conveyor positions.
         All cards share a common BASELINE — their bottoms line up — and are similar heights,
         so the stagger happens at the TOP (the sloped edges), matching the design. The hero is
         tallest and bleeds off the left; the middle is a touch shorter, lifted a few px and on
         the top layer (highest z) so it reads as raised and sitting OVER its neighbours; the
         last card is shortest and tucks BEHIND the middle (lowest z), clipping off the right. */
      .tgcar-card.pos0 {
        left: 0; width: 53%; height: 100%; bottom: 0;
        transform: none;
        clip-path: ${clipHero};
        z-index: 4; cursor: default;
      }
      .tgcar-card.pos1 {
        left: 50.5%; width: 28%; height: 90%; bottom: 8px;
        transform: perspective(1200px) rotateY(-${ryMid}deg) rotate(${rzMid}deg);
        clip-path: ${clipMid};
        z-index: 6;
      }
      .tgcar-card.pos2 {
        left: 75.5%; width: 25%; height: 82%; bottom: 0;
        transform: perspective(1200px) rotateY(-${ryLast}deg) rotate(${rzLast}deg);
        clip-path: ${clipLast};
        z-index: 3;
      }
      .tgcar-card.posQ {
        left: 103%; width: 24%; height: 78%; bottom: 0;
        transform: perspective(1200px) rotateY(-${ryQ}deg) rotate(${rzQ}deg);
        clip-path: ${clipLast};
        opacity: 0; z-index: 1; pointer-events: none;
      }
      .tgcar-card.posX {
        left: -56%; width: 53%; height: 100%; bottom: 0;
        transform: none;
        clip-path: ${clipHero};
        opacity: 0; z-index: 5; pointer-events: none;
      }

      .tgcar-img {
        position: absolute; inset: 0;
        width: 100%; height: 100%;
        object-fit: cover;
        z-index: -2;
        transition: transform 7s linear;
      }
      .tgcar-card.pos0 .tgcar-img { transform: scale(1.04); }
      .tgcar-noimg { position: absolute; inset: 0; z-index: -2; background:
        radial-gradient(120% 90% at 30% 20%, color-mix(in srgb, var(--tgcar-gold) 22%, var(--tgcar-bg)), var(--tgcar-bg)); }

      /* Every card gets a left haze + bottom darkening so the bottom-left text stays legible. */
      .tgcar-scrim {
        position: absolute; inset: 0; z-index: -1;
        background:
          linear-gradient(90deg, color-mix(in srgb, var(--tgcar-bg) 78%, transparent) 0%, color-mix(in srgb, var(--tgcar-bg) 32%, transparent) 42%, transparent 72%),
          linear-gradient(180deg, transparent 40%, color-mix(in srgb, var(--tgcar-bg) 82%, transparent) 100%);
      }
      .tgcar-card.pos0 .tgcar-scrim {
        background:
          linear-gradient(90deg, color-mix(in srgb, var(--tgcar-bg) 92%, transparent) 0%, color-mix(in srgb, var(--tgcar-bg) 55%, transparent) 36%, transparent 64%),
          linear-gradient(180deg, color-mix(in srgb, var(--tgcar-bg) 45%, transparent) 0%, transparent 22%, transparent 70%, color-mix(in srgb, var(--tgcar-bg) 50%, transparent) 100%);
        box-shadow: inset 0 0 72px 18px color-mix(in srgb, var(--tgcar-bg) 55%, transparent);
      }

      /* (Gold hairline removed: a rectangular border clips to 3 sides under the sloped polygon,
         which reads as broken. The slope + left haze define each card cleanly on the dark field.) */

      .tgcar-content {
        position: absolute;
        left: 0; right: 0; bottom: 0;
        padding: 20px 18px;
        display: flex; flex-direction: column; justify-content: flex-end;
        transition: padding var(--tgcar-speed) var(--tgcar-ease);
      }
      .tgcar-card.pos0 .tgcar-content {
        top: 0;
        justify-content: center;
        padding: 36px 48px;
        max-width: 470px;
      }

      .tgcar-title {
        font-family: '${c.headingFont}', 'Times New Roman', serif;
        font-weight: 500;
        color: var(--tgcar-gold);
        letter-spacing: .14em;
        text-transform: uppercase;
        font-size: 15px;
        line-height: 1.15;
        margin: 0 0 2px;
        transition: font-size var(--tgcar-speed) var(--tgcar-ease);
      }
      .tgcar-card.pos1 .tgcar-title { font-size: 20px; }
      .tgcar-card.pos0 .tgcar-title { font-size: 40px; margin-bottom: 4px; letter-spacing: .12em; }

      .tgcar-sub {
        font-family: '${c.subtitleFont}', Georgia, serif;
        font-weight: 500;
        font-size: 15px;
        margin: 0;
        letter-spacing: .02em;
        transition: font-size var(--tgcar-speed) var(--tgcar-ease);
      }
      .tgcar-card.pos1 .tgcar-sub { font-size: 17px; }
      .tgcar-card.pos0 .tgcar-sub {
        font-size: 23px;
        padding-bottom: 14px;
        margin-bottom: 16px;
        position: relative;
      }
      .tgcar-card.pos0 .tgcar-sub::after {
        content: '';
        position: absolute; left: 0; bottom: 0;
        width: 180px; height: 1px;
        background: linear-gradient(90deg, var(--tgcar-gold), transparent);
        opacity: .65;
      }

      .tgcar-body {
        font-size: 11.5px;
        line-height: 1.65;
        color: color-mix(in srgb, var(--tgcar-text) 80%, transparent);
        margin: 8px 0 0;
        display: -webkit-box;
        -webkit-line-clamp: 3;
        -webkit-box-orient: vertical;
        overflow: hidden;
        transition: font-size var(--tgcar-speed) var(--tgcar-ease);
      }
      .tgcar-card.pos1 .tgcar-body { font-size: 12.5px; -webkit-line-clamp: 4; }
      .tgcar-card.pos0 .tgcar-body {
        font-size: 14px;
        -webkit-line-clamp: unset;
        display: block;
        margin: 0 0 24px;
        max-width: 38ch;
      }

      .tgcar-cta-row {
        opacity: 0; max-height: 0; overflow: hidden;
        transform: translateY(8px);
        transition: opacity .45s var(--tgcar-ease) .35s, transform .45s var(--tgcar-ease) .35s, max-height var(--tgcar-speed) var(--tgcar-ease);
      }
      .tgcar-card.pos0 .tgcar-cta-row { opacity: 1; transform: none; max-height: 70px; }
      .tgcar-cta {
        display: inline-flex; align-items: center; gap: 10px;
        height: 40px; padding: 0 20px;
        border: 1px solid var(--tgcar-gold);
        border-radius: 4px;
        background: transparent;
        color: var(--tgcar-gold);
        font-family: inherit;
        font-size: 10.5px; font-weight: 600;
        letter-spacing: .18em;
        text-transform: uppercase;
        text-decoration: none;
        cursor: pointer;
        transition: background .25s ease, color .25s ease, transform .15s ease;
      }
      .tgcar-cta:hover { background: var(--tgcar-gold); color: ${c.bg}; }
      .tgcar-cta:active { transform: translateY(1px); }
      .tgcar-cta:focus-visible { outline: 2px solid var(--tgcar-gold); outline-offset: 3px; }
      .tgcar-cta svg { width: 14px; height: 14px; transition: transform .25s ease; }
      .tgcar-cta:hover svg { transform: translateX(3px); }

      .tgcar-teaser-cta {
        display: inline-flex; align-items: center; gap: 7px;
        margin-top: 12px;
        color: var(--tgcar-gold);
        font-size: 9.5px; font-weight: 600;
        letter-spacing: .16em;
        text-transform: uppercase;
        opacity: .92;
      }
      .tgcar-teaser-cta svg { width: 13px; height: 13px; }
      .tgcar-card.pos0 .tgcar-teaser-cta { display: none; }

      /* Controls */
      .tgcar-controls { display: flex; align-items: center; justify-content: space-between; margin-top: 18px; padding: 0 36px; position: relative; z-index: 7; }
      .tgcar-dots { display: flex; gap: 10px; }
      .tgcar-dot {
        width: 36px; height: 3px; border-radius: 2px; border: 0; padding: 0;
        background: color-mix(in srgb, var(--tgcar-text) 20%, transparent);
        cursor: pointer; position: relative; overflow: hidden;
      }
      .tgcar-dot:focus-visible { outline: 2px solid var(--tgcar-gold); outline-offset: 3px; }
      .tgcar-dot-fill {
        position: absolute; inset: 0; background: var(--tgcar-gold);
        transform: scaleX(0); transform-origin: left;
      }
      .tgcar-dot.is-active .tgcar-dot-fill { animation: tgcarFill ${clampNum(c.interval, 3, 15, 6)}s linear forwards; }
      .tgcar.is-paused .tgcar-dot.is-active .tgcar-dot-fill,
      .tgcar.no-autoplay .tgcar-dot.is-active .tgcar-dot-fill { animation-play-state: paused; }
      .tgcar.no-autoplay .tgcar-dot.is-active { background: var(--tgcar-gold); }
      .tgcar.no-autoplay .tgcar-dot.is-active .tgcar-dot-fill { display: none; }
      @keyframes tgcarFill { from { transform: scaleX(0); } to { transform: scaleX(1); } }

      .tgcar-arrows { display: flex; gap: 10px; }
      .tgcar-arrow {
        width: 42px; height: 42px; border-radius: 50%;
        border: 1px solid color-mix(in srgb, var(--tgcar-gold) 45%, transparent);
        background: transparent; color: var(--tgcar-gold); cursor: pointer;
        display: inline-flex; align-items: center; justify-content: center;
        transition: background .25s ease, color .25s ease, border-color .25s ease, transform .15s ease;
      }
      .tgcar-arrow svg { width: 17px; height: 17px; }
      .tgcar-arrow:hover { background: var(--tgcar-gold); color: ${c.bg}; border-color: var(--tgcar-gold); }
      .tgcar-arrow:active { transform: scale(.96); }
      .tgcar-arrow:focus-visible { outline: 2px solid var(--tgcar-gold); outline-offset: 3px; }

      /* Compact (container-responsive, toggled by ResizeObserver): single full-bleed slide */
      .tgcar.is-compact { padding: 18px 0 16px; }
      .tgcar.is-compact .tgcar-stage { height: ${clampNum(c.height, 320, 640, 430) + 40}px; }
      .tgcar.is-compact .tgcar-intro { font-size: 12.5px; margin-bottom: 14px; }
      .tgcar.is-compact .tgcar-deco { width: 160px; height: 130px; }
      .tgcar.is-compact .tgcar-card.pos0 { left: 0; width: 100%; height: 100%; clip-path: none; }
      .tgcar.is-compact .tgcar-card.pos0 .tgcar-content { padding: 26px 24px; max-width: none; justify-content: flex-end; top: auto; }
      .tgcar.is-compact .tgcar-card.pos0 .tgcar-title { font-size: 28px; }
      .tgcar.is-compact .tgcar-card.pos0 .tgcar-sub { font-size: 19px; }
      .tgcar.is-compact .tgcar-card.pos1, .tgcar.is-compact .tgcar-card.pos2 {
        left: 112%; width: 80%; height: 90%; bottom: 0; opacity: 0; pointer-events: none;
        transform: rotate(${rzMid}deg);
      }
      .tgcar.is-compact .tgcar-card.posX { left: -110%; width: 100%; clip-path: none; }
      .tgcar.is-compact .tgcar-controls { padding: 0 20px; }

      @media (prefers-reduced-motion: reduce) {
        .tgcar-card, .tgcar-content, .tgcar-title, .tgcar-sub, .tgcar-body, .tgcar-cta-row, .tgcar-img, .tgcar-scrim {
          transition: none !important;
          animation: none !important;
        }
        .tgcar-card.pos0 .tgcar-img { transform: none; }
        .tgcar-dot.is-active .tgcar-dot-fill { animation: none; transform: scaleX(1); }
      }
    `;
  }

  class TGCarouselWidget {
    constructor(container, config) {
      this.el = container;
      this.cfg = this._sanitise(Object.assign({}, DEFAULTS, config || {}));
      this.t = makeT(this.cfg);   // resolve viewer language + UI strings
      this.shadow = container.shadowRoot || (container.attachShadow ? container.attachShadow({ mode: 'open' }) : container);
      this.queue = [];
      this.timer = null;
      this.animating = false;
      this._reduced = prefersReducedMotion();
      this._speedMs = this._reduced ? 0 : 1000;
      this._inView = true;
      this._listeners = [];
      ensureFont(this.cfg.headingFont);
      ensureFont(this.cfg.subtitleFont);
      if (this.cfg.bodyFont !== 'Inter') ensureFont(this.cfg.bodyFont);
      this._build();
    }

    _sanitise(c) {
      c.bg = safeColor(c.bg, DEFAULTS.bg);
      c.accent = safeColor(c.accent, DEFAULTS.accent);
      c.textColor = safeColor(c.textColor, DEFAULTS.textColor);
      // Shell font picker writes fontFamily — treat it as the heading font.
      if (c.fontFamily) c.headingFont = c.fontFamily;
      c.headingFont = safeFont(c.headingFont, DEFAULTS.headingFont);
      c.subtitleFont = safeFont(c.subtitleFont, DEFAULTS.subtitleFont);
      c.bodyFont = safeFont(c.bodyFont, DEFAULTS.bodyFont);
      c.cardRadius = clampNum(c.cardRadius, 0, 32, DEFAULTS.cardRadius);
      c.lean = clampNum(c.lean, 0, 8, DEFAULTS.lean);
      c.height = clampNum(c.height, 320, 640, DEFAULTS.height);
      c.interval = clampNum(c.interval, 3, 15, DEFAULTS.interval);
      c.slides = (Array.isArray(c.slides) ? c.slides : []).slice(0, 10).map(function (s) {
        s = s || {};
        return {
          title: String(s.title || '').slice(0, 60),
          subtitle: String(s.subtitle || '').slice(0, 80),
          body: String(s.body || '').slice(0, 400),
          ctaLabel: String(s.ctaLabel || '').slice(0, 40),
          ctaUrl: safeUrl(s.ctaUrl),
          image: safeImg(s.image),
        };
      }).filter(function (s) { return s.title; });
      return c;
    }

    _slideHtml(s, i) {
      const img = s.image
        ? '<img class="tgcar-img" src="' + esc(s.image) + '" alt="" loading="' + (i === 0 ? 'eager' : 'lazy') + '">'
        : '<div class="tgcar-noimg"></div>';
      const cta = s.ctaLabel
        ? '<div class="tgcar-cta-row"><a class="tgcar-cta" href="' + esc(s.ctaUrl) + '">' + esc(s.ctaLabel) + ARROW + '</a></div>'
          + '<span class="tgcar-teaser-cta">' + esc(s.ctaLabel) + ARROW + '</span>'
        : '';
      return img
        + '<div class="tgcar-scrim"></div>'
        + '<div class="tgcar-content">'
        +   '<h3 class="tgcar-title">' + esc(s.title) + '</h3>'
        +   (s.subtitle ? '<p class="tgcar-sub">' + esc(s.subtitle) + '</p>' : '')
        +   (s.body ? '<p class="tgcar-body">' + esc(s.body) + '</p>' : '')
        +   cta
        + '</div>';
    }

    _build() {
      const c = this.cfg;
      const self = this;
      const multi = c.slides.length > 1;

      let html = '<style>' + styles(c) + '</style>';
      html += '<section class="tgcar' + (c.autoplay && multi ? '' : ' no-autoplay') + '" aria-roledescription="carousel" aria-label="' + esc(c.ariaLabel || this.t('carouselLabel')) + '">';
      if (c.showDeco) html += PALM;
      if (c.showIntro && c.intro) html += '<p class="tgcar-intro">' + esc(c.intro) + '</p>';
      html += '<div class="tgcar-stage"></div>';
      if (multi && (c.showDots || c.showArrows)) {
        html += '<div class="tgcar-controls">';
        html += c.showDots ? '<div class="tgcar-dots" role="tablist" aria-label="' + esc(this.t('chooseSlide')) + '"></div>' : '<span></span>';
        if (c.showArrows) {
          html += '<div class="tgcar-arrows">'
            + '<button type="button" class="tgcar-arrow tgcar-prev" aria-label="' + esc(this.t('prevSlide')) + '">' + ARROW_L + '</button>'
            + '<button type="button" class="tgcar-arrow tgcar-next" aria-label="' + esc(this.t('nextSlide')) + '">' + ARROW_R + '</button>'
            + '</div>';
        }
        html += '</div>';
      }
      html += '</section>';
      this.shadow.innerHTML = html;

      this.root = this.shadow.querySelector('.tgcar');
      this.stage = this.shadow.querySelector('.tgcar-stage');
      const dotsWrap = this.shadow.querySelector('.tgcar-dots');

      // Empty state (editor sees this before slides exist)
      if (!c.slides.length) {
        this.stage.innerHTML = '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:24px;">'
          + '<p style="margin:0;font-size:14px;line-height:1.6;color:color-mix(in srgb, ' + c.textColor + ' 65%, transparent);max-width:38ch;">'
          + 'No destinations yet. Add your first slide and this space becomes a cinematic destination showcase.</p></div>';
        return;
      }

      this.cards = c.slides.map(function (s, i) {
        const card = document.createElement('button');
        card.className = 'tgcar-card';
        card.type = 'button';
        card.dataset.slide = i;
        card.setAttribute('aria-label', s.title + (s.subtitle ? ' \u2014 ' + s.subtitle : ''));
        card.innerHTML = self._slideHtml(s, i);
        self._on(card, 'click', function (e) {
          if (e.target.closest('.tgcar-cta')) return;
          const steps = self.queue.indexOf(card);
          if (steps > 0) self._advanceBy(steps);
        });
        self.stage.appendChild(card);

        if (dotsWrap) {
          const dot = document.createElement('button');
          dot.className = 'tgcar-dot';
          dot.type = 'button';
          dot.setAttribute('role', 'tab');
          dot.setAttribute('aria-label', self.t('goToSlide', { n: i + 1 }));
          dot.innerHTML = '<span class="tgcar-dot-fill"></span>';
          self._on(dot, 'click', function () {
            const steps = self.queue.findIndex(function (x) { return +x.dataset.slide === i; });
            if (steps > 0) { self._advanceBy(steps); self._restart(); }
          });
          dotsWrap.appendChild(dot);
        }
        return card;
      });
      this.dotEls = dotsWrap ? dotsWrap.querySelectorAll('.tgcar-dot') : [];
      this.queue = this.cards.slice();

      if (multi) {
        const prevBtn = this.shadow.querySelector('.tgcar-prev');
        const nextBtn = this.shadow.querySelector('.tgcar-next');
        if (nextBtn) this._on(nextBtn, 'click', function () { self._next(); self._restart(); });
        if (prevBtn) this._on(prevBtn, 'click', function () { self._prev(); self._restart(); });

        this._on(this.root, 'keydown', function (e) {
          if (e.key === 'ArrowRight') { self._next(); self._restart(); }
          if (e.key === 'ArrowLeft')  { self._prev(); self._restart(); }
        });

        let touchX = null;
        this._on(this.root, 'touchstart', function (e) { touchX = e.touches[0].clientX; }, { passive: true });
        this._on(this.root, 'touchend', function (e) {
          if (touchX == null) return;
          const dx = e.changedTouches[0].clientX - touchX;
          if (Math.abs(dx) > 48) { if (dx < 0) { self._next(); } else { self._prev(); } self._restart(); }
          touchX = null;
        }, { passive: true });

        if (c.pauseOnHover) {
          this._on(this.root, 'mouseenter', function () { self._stop(); self.root.classList.add('is-paused'); });
          this._on(this.root, 'mouseleave', function () { self._start(); self.root.classList.remove('is-paused'); });
        }

        // Be a good guest: only autoplay while on screen and the tab is visible.
        if ('IntersectionObserver' in window) {
          this._io = new IntersectionObserver(function (entries) {
            self._inView = !!(entries[0] && entries[0].isIntersecting);
            if (self._inView) self._start(); else self._stop();
          }, { threshold: 0.15 });
          this._io.observe(this.el);
        }
        this._onVis = function () { if (document.hidden) self._stop(); else self._start(); };
        document.addEventListener('visibilitychange', this._onVis);
      }

      // Container-responsive: compact below 720px of CONTAINER width (not viewport).
      if ('ResizeObserver' in window) {
        this._ro = new ResizeObserver(function (entries) {
          const w = entries[0] ? entries[0].contentRect.width : self.el.clientWidth;
          self.root.classList.toggle('is-compact', w < 720);
        });
        this._ro.observe(this.el);
      } else {
        this.root.classList.toggle('is-compact', this.el.clientWidth < 720);
      }

      this._layout(true);
      this._start();
    }

    _on(el, ev, fn, opts) { el.addEventListener(ev, fn, opts); this._listeners.push([el, ev, fn]); }

    _posClass(i) { return i === 0 ? 'pos0' : i === 1 ? 'pos1' : i === 2 ? 'pos2' : 'posQ'; }

    _setPos(card, cls, instant) {
      ['pos0', 'pos1', 'pos2', 'posQ', 'posX'].forEach(function (p) { card.classList.remove(p); });
      // Off-screen queued (posQ) and leaving (posX) cards sit at opacity 0 with the
      // focus ring clipped by overflow:hidden. Keep them — and the CTA link inside —
      // out of the tab order and the a11y tree so keyboard users don't tab through
      // dead invisible stops before reaching the real controls. inert covers both.
      const hidden = (cls === 'posQ' || cls === 'posX');
      card.inert = hidden;
      if (hidden) card.setAttribute('aria-hidden', 'true');
      else card.removeAttribute('aria-hidden');
      if (instant) {
        card.classList.add('no-anim');
        card.classList.add(cls);
        void card.offsetWidth;
        card.classList.remove('no-anim');
      } else {
        card.classList.add(cls);
      }
    }

    _layout(instant) {
      const self = this;
      this.queue.forEach(function (card, i) { self._setPos(card, self._posClass(i), instant); });
      this._syncDots();
    }

    _syncDots() {
      if (!this.dotEls || !this.dotEls.length) return;
      const heroSlide = +this.queue[0].dataset.slide;
      this.dotEls.forEach(function (d, i) {
        d.classList.toggle('is-active', i === heroSlide);
        d.setAttribute('aria-selected', i === heroSlide ? 'true' : 'false');
        if (i === heroSlide) {
          const fill = d.querySelector('.tgcar-dot-fill');
          fill.style.animation = 'none';
          void fill.offsetWidth;
          fill.style.animation = '';
        }
      });
    }

    _next() {
      if (this.animating || this.queue.length < 2) return;
      this.animating = true;
      const self = this;
      const leaving = this.queue.shift();
      this.queue.push(leaving);
      this._setPos(leaving, 'posX', false);
      this.queue.forEach(function (card, i) {
        if (card === leaving) return;
        self._setPos(card, self._posClass(i), false);
      });
      this._syncDots();
      this._t1 = setTimeout(function () {
        self._setPos(leaving, 'posQ', true);
        self.animating = false;
      }, this._speedMs + 50);
    }

    _prev() {
      if (this.animating || this.queue.length < 2) return;
      this.animating = true;
      const self = this;
      const entering = this.queue.pop();
      this.queue.unshift(entering);
      this._setPos(entering, 'posX', true);
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          self._layout(false);
          self._t1 = setTimeout(function () { self.animating = false; }, self._speedMs + 50);
        });
      });
    }

    _advanceBy(steps) {
      const self = this;
      // Clear any stepper still draining from a previous multi-step jump. Without
      // this, a second far-dot click starts a new interval over this._t2 and
      // orphans the first, which then advances the carousel every 180ms forever —
      // _stop(), pause-on-hover and destroy() would never reach it.
      if (this._t2) { clearInterval(this._t2); this._t2 = null; }
      this._next();
      let remaining = steps - 1;
      if (remaining > 0) {
        // Capture our own id in a local so the termination branch can only ever
        // clear THIS interval, never whatever this._t2 currently points at.
        const id = setInterval(function () {
          if (!self.animating) {
            self._next();
            remaining--;
            if (remaining <= 0) { clearInterval(id); if (self._t2 === id) self._t2 = null; }
          }
        }, 180);
        this._t2 = id;
      }
      this._restart();
    }

    _start() {
      if (!this.cfg.autoplay || this._reduced || !this._inView || document.hidden) return;
      if (!this.queue || this.queue.length < 2) return;
      this._stop();
      const self = this;
      this.timer = setInterval(function () {
        // Stop autoplay if the host was removed without destroy() (SPA sites).
        if (self.el && !self.el.isConnected) { self.destroy(); return; }
        self._next();
      }, this.cfg.interval * 1000);
    }
    _stop() { if (this.timer) { clearInterval(this.timer); this.timer = null; } }
    _restart() { this._stop(); this._start(); }

    update(newConfig) {
      this.destroy(true);
      this.cfg = this._sanitise(Object.assign({}, this.cfg, newConfig || {}));
      this.t = makeT(this.cfg);
      ensureFont(this.cfg.headingFont);
      ensureFont(this.cfg.subtitleFont);
      this._build();
    }

    destroy(keepShadow) {
      this._stop();
      if (this._t1) clearTimeout(this._t1);
      if (this._t2) clearInterval(this._t2);
      if (this._io) { try { this._io.disconnect(); } catch (e) {} this._io = null; }
      if (this._ro) { try { this._ro.disconnect(); } catch (e) {} this._ro = null; }
      if (this._onVis) { document.removeEventListener('visibilitychange', this._onVis); this._onVis = null; }
      this._listeners.forEach(function (l) { try { l[0].removeEventListener(l[1], l[2]); } catch (e) {} });
      this._listeners = [];
      this.queue = [];
      this.animating = false;
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
    const containers = document.querySelectorAll('[data-tg-widget="carousel"]');
    for (const el of containers) {
      if (el.__tgInited) continue;
      el.__tgInited = true;
      let cfg = null;
      const inline = el.getAttribute('data-tg-config');
      if (inline) { try { cfg = JSON.parse(inline); } catch (e) { cfg = null; } }
      else { const id = el.getAttribute('data-tg-id'); if (id) cfg = await fetchConfig(id); }
      try { new TGCarouselWidget(el, cfg || {}); }
      catch (e) { if (window.console) console.error('[TGCarousel] init failed', e); }
    }
  }

  window.TGCarouselWidget = TGCarouselWidget;
  window.__TG_CAROUSEL_VERSION__ = VERSION;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
