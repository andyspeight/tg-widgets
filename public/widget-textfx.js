/**
 * Travelgenix Text FX Widget v1.0.0
 * Self-contained, embeddable widget — kinetic typography for hero headlines, stats, and accents
 * Zero dependencies — works on any website via a single script tag
 *
 * Phase 1 modes: typewriter, rotating, counter, gradient
 *
 * Usage:
 *   <div data-tg-widget="textfx" data-tg-id="YOUR_WIDGET_ID"></div>
 *   <script src="https://tg-widgets.vercel.app/widget-textfx.js"></script>
 */
(function () {
  'use strict';

  const API_BASE = (typeof window !== 'undefined' && window.__TG_WIDGET_API__) || '/api/widget-config';
  const VERSION = '1.0.0';

  // ---------- Helpers ----------
  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function clamp(n, min, max) {
    n = Number(n);
    if (!isFinite(n)) return min;
    return Math.max(min, Math.min(max, n));
  }

  function safeColor(c, fallback) {
    if (!c) return fallback;
    const s = String(c).trim();
    // Allow hex, rgb/rgba, hsl/hsla, named colours
    if (/^#[0-9a-f]{3,8}$/i.test(s)) return s;
    if (/^rgba?\(/i.test(s) && !/[<>"'`]/.test(s)) return s;
    if (/^hsla?\(/i.test(s) && !/[<>"'`]/.test(s)) return s;
    if (/^[a-z]+$/i.test(s)) return s;
    return fallback;
  }

  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  function easeOutQuart(t) { return 1 - Math.pow(1 - t, 4); }

  // ---------- Styles ----------
  const STYLES = `
    :host { all: initial; display: block; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }

    *, *::before, *::after { box-sizing: border-box; }

    .tgx-root {
      --tgx-brand: #0891B2;
      --tgx-accent: #6366F1;
      --tgx-bg: transparent;
      --tgx-text: #0F172A;
      --tgx-radius: 16px;
      color: var(--tgx-text);
      background: var(--tgx-bg);
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      padding: var(--tgx-pad-y, 24px) var(--tgx-pad-x, 16px);
      border-radius: var(--tgx-radius);
      overflow: hidden;
      position: relative;
    }

    .tgx-root[data-theme="dark"] {
      --tgx-text: #F1F5F9;
    }

    .tgx-stage {
      width: 100%;
      max-width: 100%;
      text-align: var(--tgx-align, center);
      font-family: var(--tgx-font, inherit);
      font-size: clamp(20px, var(--tgx-size-vw, 5vw), var(--tgx-size, 64px));
      font-weight: var(--tgx-weight, 700);
      line-height: var(--tgx-leading, 1.15);
      letter-spacing: var(--tgx-tracking, -0.02em);
      color: var(--tgx-text);
    }

    /* Cursor for typewriter */
    .tgx-cursor {
      display: inline-block;
      width: 0.08em;
      background: currentColor;
      margin-left: 0.04em;
      vertical-align: baseline;
      height: 0.95em;
      transform: translateY(0.1em);
      animation: tgx-blink 1.05s steps(2, start) infinite;
    }
    .tgx-cursor[data-style="bar"] { width: 0.12em; }
    .tgx-cursor[data-style="block"] { width: 0.55em; height: 1em; transform: translateY(0.15em); }
    .tgx-cursor[data-style="underscore"] { width: 0.55em; height: 0.08em; transform: translateY(0); margin-bottom: 0.05em; }
    .tgx-cursor[data-style="none"] { display: none; }

    @keyframes tgx-blink {
      to { visibility: hidden; }
    }

    /* Rotating words */
    .tgx-rot-wrap {
      display: inline-block;
      position: relative;
      vertical-align: baseline;
    }
    .tgx-rot-measure {
      visibility: hidden;
      white-space: nowrap;
      pointer-events: none;
    }
    .tgx-rot-track {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }
    .tgx-rot-word {
      position: absolute;
      white-space: nowrap;
      color: var(--tgx-rot-color, var(--tgx-accent));
      transition: transform 480ms cubic-bezier(0.22, 1, 0.36, 1), opacity 320ms ease;
      will-change: transform, opacity;
    }
    /* Slide */
    .tgx-rot-track[data-anim="slide"] .tgx-rot-word { transform: translateY(110%); opacity: 0; }
    .tgx-rot-track[data-anim="slide"] .tgx-rot-word.is-active { transform: translateY(0); opacity: 1; }
    .tgx-rot-track[data-anim="slide"] .tgx-rot-word.is-leaving { transform: translateY(-110%); opacity: 0; }
    /* Fade */
    .tgx-rot-track[data-anim="fade"] .tgx-rot-word { opacity: 0; transform: translateY(0); }
    .tgx-rot-track[data-anim="fade"] .tgx-rot-word.is-active { opacity: 1; }
    .tgx-rot-track[data-anim="fade"] .tgx-rot-word.is-leaving { opacity: 0; }
    /* Flip */
    .tgx-rot-track[data-anim="flip"] .tgx-rot-word {
      transform: rotateX(90deg);
      opacity: 0;
      transform-origin: center bottom;
      backface-visibility: hidden;
    }
    .tgx-rot-track[data-anim="flip"] .tgx-rot-word.is-active { transform: rotateX(0); opacity: 1; }
    .tgx-rot-track[data-anim="flip"] .tgx-rot-word.is-leaving { transform: rotateX(-90deg); opacity: 0; transform-origin: center top; }

    /* Counter */
    .tgx-counter-num { font-variant-numeric: tabular-nums; font-feature-settings: "tnum" 1; }

    /* Gradient mode */
    .tgx-gradient {
      background: linear-gradient(var(--tgx-grad-angle, 90deg),
        var(--tgx-grad-1, #0891B2),
        var(--tgx-grad-2, #6366F1),
        var(--tgx-grad-3, #0891B2));
      background-size: 200% 100%;
      -webkit-background-clip: text;
      background-clip: text;
      -webkit-text-fill-color: transparent;
      color: transparent;
      animation: tgx-grad var(--tgx-grad-speed, 6s) linear infinite;
    }
    .tgx-gradient[data-static="1"] {
      background-size: 100% 100%;
      animation: none;
    }
    @keyframes tgx-grad {
      to { background-position: -200% 0; }
    }

    /* Word Reveal mode */
    .tgx-reveal-piece {
      display: inline-block;
      opacity: 0;
      will-change: transform, opacity, filter;
    }
    .tgx-reveal-piece[data-anim="fade-up"] { transform: translateY(0.4em); }
    .tgx-reveal-piece[data-anim="fade-up"].is-visible {
      opacity: 1;
      transform: translateY(0);
      transition: opacity 600ms cubic-bezier(0.22, 1, 0.36, 1), transform 700ms cubic-bezier(0.22, 1, 0.36, 1);
    }
    .tgx-reveal-piece[data-anim="fade"].is-visible {
      opacity: 1;
      transition: opacity 700ms ease-out;
    }
    .tgx-reveal-piece[data-anim="blur"] { filter: blur(8px); }
    .tgx-reveal-piece[data-anim="blur"].is-visible {
      opacity: 1;
      filter: blur(0);
      transition: opacity 700ms ease-out, filter 700ms ease-out;
    }
    .tgx-reveal-piece[data-anim="slide"] { transform: translateX(-1em); }
    .tgx-reveal-piece[data-anim="slide"].is-visible {
      opacity: 1;
      transform: translateX(0);
      transition: opacity 600ms ease-out, transform 700ms cubic-bezier(0.22, 1, 0.36, 1);
    }
    /* Add a small gap after each word piece (but not letters) */
    .tgx-reveal-piece[data-unit="word"] + .tgx-reveal-piece[data-unit="word"]::before {
      content: " ";
    }

    /* Marquee mode */
    .tgx-marquee {
      display: flex;
      overflow: hidden;
      width: 100%;
      mask-image: linear-gradient(to right, transparent, #000 var(--tgx-mq-fade, 4%), #000 calc(100% - var(--tgx-mq-fade, 4%)), transparent);
      -webkit-mask-image: linear-gradient(to right, transparent, #000 var(--tgx-mq-fade, 4%), #000 calc(100% - var(--tgx-mq-fade, 4%)), transparent);
    }
    .tgx-marquee[data-fade="0"] {
      mask-image: none;
      -webkit-mask-image: none;
    }
    .tgx-marquee-track {
      display: flex;
      flex-shrink: 0;
      align-items: center;
      gap: var(--tgx-mq-gap, 1.5em);
      animation: tgx-mq-scroll var(--tgx-mq-duration, 25s) linear infinite;
      will-change: transform;
    }
    .tgx-marquee[data-direction="right"] .tgx-marquee-track {
      animation-direction: reverse;
    }
    .tgx-marquee[data-pause-hover="1"]:hover .tgx-marquee-track {
      animation-play-state: paused;
    }
    .tgx-marquee-item {
      flex-shrink: 0;
      white-space: nowrap;
    }
    .tgx-marquee-sep {
      flex-shrink: 0;
      opacity: 0.4;
      align-self: center;
    }
    @keyframes tgx-mq-scroll {
      from { transform: translateX(0); }
      to { transform: translateX(-50%); }
    }

    /* Outlined mode */
    .tgx-outlined {
      color: var(--tgx-outline-fill, transparent);
      -webkit-text-stroke: var(--tgx-outline-width, 2px) var(--tgx-outline-color, currentColor);
      text-stroke: var(--tgx-outline-width, 2px) var(--tgx-outline-color, currentColor);
      transition: color 350ms ease, -webkit-text-stroke-color 350ms ease;
      display: inline-block;
    }
    .tgx-outlined[data-hover-fill="1"]:hover {
      color: var(--tgx-outline-hover, var(--tgx-outline-color));
    }

    /* Split Colour mode — horizontal */
    .tgx-split-h {
      background: linear-gradient(
        to bottom,
        var(--tgx-split-1, #0F172A) 0%,
        var(--tgx-split-1, #0F172A) var(--tgx-split-pos, 50%),
        var(--tgx-split-2, #0891B2) var(--tgx-split-pos, 50%),
        var(--tgx-split-2, #0891B2) 100%
      );
      -webkit-background-clip: text;
      background-clip: text;
      -webkit-text-fill-color: transparent;
      color: transparent;
      display: inline-block;
    }
    /* Split Colour mode — alternate words */
    .tgx-split-alt-word {
      display: inline-block;
    }
    .tgx-split-alt-word[data-tone="1"] { color: var(--tgx-split-1, #0F172A); }
    .tgx-split-alt-word[data-tone="2"] { color: var(--tgx-split-2, #0891B2); }

    /* Spotlight Follow mode */
    .tgx-spotlight {
      position: relative;
      display: inline-block;
    }
    .tgx-spotlight-base {
      color: var(--tgx-spot-base, #CBD5E1);
    }
    .tgx-spotlight-top {
      position: absolute;
      inset: 0;
      color: var(--tgx-spot-active, #0891B2);
      pointer-events: none;
      mask-image: radial-gradient(circle var(--tgx-spot-radius, 140px) at var(--tgx-spot-x, 50%) var(--tgx-spot-y, 50%),
        rgba(0,0,0,1) 0%,
        rgba(0,0,0,0.95) 30%,
        rgba(0,0,0,0) 70%);
      -webkit-mask-image: radial-gradient(circle var(--tgx-spot-radius, 140px) at var(--tgx-spot-x, 50%) var(--tgx-spot-y, 50%),
        rgba(0,0,0,1) 0%,
        rgba(0,0,0,0.95) 30%,
        rgba(0,0,0,0) 70%);
      transition: -webkit-mask-position 80ms linear, mask-position 80ms linear;
    }

    /* Stacked Editorial mode */
    .tgx-stacked {
      display: flex;
      flex-direction: column;
      gap: var(--tgx-stk-gap, 0.1em);
      align-items: var(--tgx-stk-align-items, center);
    }
    .tgx-stk-line {
      display: block;
      line-height: 1;
    }
    .tgx-stk-line[data-italic="1"] { font-style: italic; }
    .tgx-stk-line[data-uppercase="1"] {
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }

    /* Split Block mode */
    .tgx-splitblock {
      display: grid;
      width: 100%;
      gap: var(--tgx-sb-gap, 24px);
      align-items: center;
    }
    .tgx-splitblock[data-text-side="left"] {
      grid-template-columns: var(--tgx-sb-text-frac, 1fr) var(--tgx-sb-block-frac, 1fr);
    }
    .tgx-splitblock[data-text-side="right"] {
      grid-template-columns: var(--tgx-sb-block-frac, 1fr) var(--tgx-sb-text-frac, 1fr);
    }
    .tgx-sb-text {
      text-align: var(--tgx-sb-text-align, left);
      line-height: 1.1;
    }
    .tgx-sb-block {
      background: var(--tgx-sb-block-bg, #0891B2);
      color: var(--tgx-sb-block-text, #FFFFFF);
      border-radius: var(--tgx-sb-radius, 16px);
      padding: var(--tgx-sb-block-pad, 32px);
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
      min-height: var(--tgx-sb-block-min, 120px);
      line-height: 1.15;
      font-size: var(--tgx-sb-block-size, 1em);
      font-weight: var(--tgx-sb-block-weight, 600);
    }
    /* When text side is "right", swap the visual order so block comes first */
    .tgx-splitblock[data-text-side="right"] .tgx-sb-text { order: 2; }
    .tgx-splitblock[data-text-side="right"] .tgx-sb-block { order: 1; }
    @media (max-width: 640px) {
      .tgx-splitblock {
        grid-template-columns: 1fr !important;
      }
      .tgx-splitblock[data-text-side="right"] .tgx-sb-text { order: 1; }
      .tgx-splitblock[data-text-side="right"] .tgx-sb-block { order: 2; }
    }

    /* Vertical mode */
    .tgx-vertical-wrap {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      min-height: var(--tgx-vt-height, 200px);
      overflow: visible;
      padding: 16px 0;
    }
    .tgx-vertical {
      display: inline-block;
      white-space: nowrap;
      letter-spacing: var(--tgx-vt-tracking, 0.15em);
      text-transform: var(--tgx-vt-case, none);
      line-height: 1;
      transform-origin: center center;
    }
    .tgx-vertical[data-direction="ccw"] { transform: rotate(-90deg); }
    .tgx-vertical[data-direction="cw"] { transform: rotate(90deg); }

    @media (prefers-reduced-motion: reduce) {
      .tgx-root[data-respect-reduced-motion="1"] .tgx-cursor { animation: none; }
      .tgx-root[data-respect-reduced-motion="1"] .tgx-rot-word { transition: none; }
      .tgx-root[data-respect-reduced-motion="1"] .tgx-gradient { animation: none; background-size: 100% 100%; }
      .tgx-root[data-respect-reduced-motion="1"] .tgx-reveal-piece {
        opacity: 1; transform: none; filter: none; transition: none;
      }
      .tgx-root[data-respect-reduced-motion="1"] .tgx-marquee-track { animation: none; }
    }

    /* Responsive size scaling */
    @media (max-width: 640px) {
      .tgx-stage {
        font-size: clamp(18px, var(--tgx-size-vw-mobile, 8vw), var(--tgx-size, 64px));
      }
    }
  `;

  // ---------- Widget ----------
  class TGTextFxWidget {
    constructor(container, config) {
      this.el = container;
      this.c = this._defaults(config);
      this.shadow = container.attachShadow({ mode: 'open' });
      this._timers = [];
      this._raf = null;
      this._render();
    }

    _defaults(c) {
      c = c || {};
      return Object.assign({
        mode: 'typewriter',           // typewriter | rotating | counter | gradient
        theme: 'light',
        align: 'center',
        // Typography
        fontFamily: 'Inter',
        fontWeight: 700,
        fontSize: 64,
        letterSpacing: -0.02,
        lineHeight: 1.15,
        textColor: '#0F172A',
        // Container
        background: 'transparent',
        paddingY: 24,
        paddingX: 16,
        radius: 16,
        // Motion behaviour
        respectReducedMotion: true,    // default ON per accessibility skill, but Andy chose motion-on by default — this still allows OS-level override
        // Mode-specific
        typewriter: {
          phrases: ['Find your perfect holiday', 'Find your perfect city break', 'Find your perfect adventure'],
          typeSpeed: 70,             // ms per char
          deleteSpeed: 40,
          holdDuration: 1600,         // ms to hold full phrase
          loop: true,
          cursorStyle: 'bar',         // bar | block | underscore | none
          cursorColor: '',            // empty = inherit
          startDelay: 200
        },
        rotating: {
          prefix: 'Holidays for ',
          words: ['families', 'couples', 'explorers', 'foodies'],
          suffix: '',
          interval: 2200,
          animation: 'slide',         // slide | fade | flip
          wordColor: '#6366F1'
        },
        counter: {
          prefix: '',
          suffix: '',
          from: 0,
          to: 1000,
          duration: 2000,
          decimals: 0,
          thousandsSeparator: ',',
          easing: 'cubic',            // cubic | quart | linear
          startOnView: true
        },
        gradient: {
          text: 'Made for travel professionals',
          colors: ['#0891B2', '#6366F1', '#0891B2'],
          angle: 90,
          speed: 6,                   // seconds per cycle
          static: false
        },
        wordreveal: {
          text: 'Holidays handpicked by people who love travel.',
          unit: 'word',                // word | letter
          animation: 'fade-up',        // fade-up | fade | blur | slide
          stagger: 80,                 // ms between pieces
          duration: 700,               // total reveal time per piece (CSS handles, this is informational)
          startDelay: 100,
          startOnView: true,
          loop: false                  // if true, hide and re-reveal on a cycle
        },
        marquee: {
          items: ['Travel Smarter', 'Book Faster', 'Earn More', 'Stay Supported'],
          separator: '•',              // single char or short string between items
          speed: 60,                   // pixels per second
          direction: 'left',           // left | right
          pauseOnHover: true,
          fade: true                   // edge fade mask
        },
        outlined: {
          text: 'Outlined for impact',
          strokeWidth: 2,              // px
          strokeColor: '#0F172A',
          fillColor: 'transparent',    // 'transparent' or a hex
          hoverFill: false,            // when true, text fills with strokeColor on hover
          hoverFillColor: ''           // optional explicit hover fill
        },
        splitcolor: {
          text: 'Two tones, one statement',
          style: 'horizontal',         // horizontal | alternate
          color1: '#0F172A',
          color2: '#0891B2',
          splitPos: 50                 // % for horizontal style only
        },
        spotlight: {
          text: 'Hover over me',
          baseColor: '#CBD5E1',        // dim/ghost colour for resting state
          activeColor: '#0891B2',      // vivid colour shown under the spotlight
          radius: 140,                 // pixels
          followCursor: true,          // false = static centred spotlight
          fallbackPosition: 'center'   // center | left | right (for static or reduced-motion)
        },
        stacked: {
          // Up to 4 independently-styled lines for editorial layouts
          lines: [
            { text: 'Bournemouth', size: 18, weight: 600, color: '#0891B2', italic: false, uppercase: true, align: 'center' },
            { text: 'Travel agent', size: 96, weight: 800, color: '#0F172A', italic: false, uppercase: false, align: 'center' },
            { text: 'of the year', size: 96, weight: 300, color: '#0F172A', italic: true, uppercase: false, align: 'center' }
          ],
          gap: 4,                      // pixels between lines
          alignItems: 'center'         // overall alignment of the stack
        },
        splitblock: {
          textContent: 'Travel\nbooking,\nreimagined.',
          blockText: 'Try it free',
          blockColor: '#0891B2',
          blockTextColor: '#FFFFFF',
          textSide: 'left',            // left | right
          ratio: '50/50',              // 40/60 | 50/50 | 60/40
          gap: 24,
          blockRadius: 16,
          blockPadding: 32,
          textAlign: 'left',
          blockSize: 22,               // px font size for the block label
          blockWeight: 700
        },
        vertical: {
          text: 'TRAVELGENIX',
          direction: 'ccw',            // ccw (counter-clockwise, reads bottom-up) | cw (clockwise, reads top-down)
          tracking: 0.15,              // em letter-spacing
          uppercase: true,
          height: 200                  // px container height to give the rotated text room
        }
      }, c);
    }

    _render() {
      this._teardown();
      const c = this.c;

      // Build CSS variable overrides
      const rootStyle = [
        `--tgx-brand: ${safeColor(c.brand, '#0891B2')}`,
        `--tgx-accent: ${safeColor(c.accent, '#6366F1')}`,
        `--tgx-text: ${safeColor(c.textColor, '#0F172A')}`,
        `--tgx-bg: ${c.background === 'transparent' ? 'transparent' : safeColor(c.background, 'transparent')}`,
        `--tgx-radius: ${clamp(c.radius, 0, 48)}px`,
        `--tgx-pad-y: ${clamp(c.paddingY, 0, 200)}px`,
        `--tgx-pad-x: ${clamp(c.paddingX, 0, 200)}px`,
        `--tgx-size: ${clamp(c.fontSize, 12, 240)}px`,
        `--tgx-weight: ${clamp(c.fontWeight, 100, 900)}`,
        `--tgx-tracking: ${Number(c.letterSpacing).toFixed(3)}em`,
        `--tgx-leading: ${clamp(c.lineHeight, 0.8, 2.5)}`,
        `--tgx-align: ${['left','center','right'].includes(c.align) ? c.align : 'center'}`,
        `--tgx-font: ${c.fontFamily ? `'${esc(c.fontFamily)}', Inter, sans-serif` : 'Inter, sans-serif'}`
      ].join('; ');

      const themeAttr = c.theme === 'dark' ? 'dark' : 'light';
      const reducedAttr = c.respectReducedMotion ? '1' : '0';

      this.shadow.innerHTML = `
        <style>${STYLES}</style>
        <div class="tgx-root" data-theme="${themeAttr}" data-respect-reduced-motion="${reducedAttr}" style="${rootStyle}">
          <div class="tgx-stage" data-mode="${esc(c.mode)}"></div>
        </div>
      `;

      this.stage = this.shadow.querySelector('.tgx-stage');
      this.root = this.shadow.querySelector('.tgx-root');

      switch (c.mode) {
        case 'typewriter': this._renderTypewriter(); break;
        case 'rotating':   this._renderRotating();   break;
        case 'counter':    this._renderCounter();    break;
        case 'gradient':   this._renderGradient();   break;
        case 'wordreveal': this._renderWordReveal(); break;
        case 'marquee':    this._renderMarquee();    break;
        case 'outlined':   this._renderOutlined();   break;
        case 'splitcolor': this._renderSplitColor(); break;
        case 'spotlight':  this._renderSpotlight();  break;
        case 'stacked':    this._renderStacked();    break;
        case 'splitblock': this._renderSplitBlock(); break;
        case 'vertical':   this._renderVertical();   break;
        default:           this._renderFallback();
      }
    }

    _teardown() {
      this._timers.forEach(t => clearTimeout(t));
      this._timers = [];
      if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
      if (this._observer) { this._observer.disconnect(); this._observer = null; }
      if (this._spotlightHandler) {
        this.el.removeEventListener('mousemove', this._spotlightHandler);
        this.el.removeEventListener('mouseleave', this._spotlightLeaveHandler);
        this._spotlightHandler = null;
        this._spotlightLeaveHandler = null;
      }
    }

    _setTimer(fn, delay) {
      const t = setTimeout(fn, delay);
      this._timers.push(t);
      return t;
    }

    _prefersReduced() {
      return this.c.respectReducedMotion &&
        window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    // ---------- Typewriter ----------
    _renderTypewriter() {
      const cfg = this.c.typewriter;
      const phrases = (Array.isArray(cfg.phrases) ? cfg.phrases : [])
        .map(String).filter(p => p.length > 0);

      if (phrases.length === 0) {
        this.stage.innerHTML = '<span class="tgx-tw-text"></span>';
        return;
      }

      // Reduced motion: show first phrase static, no animation
      if (this._prefersReduced()) {
        this.stage.innerHTML = `<span class="tgx-tw-text">${esc(phrases[0])}</span>`;
        return;
      }

      const cursorStyle = ['bar','block','underscore','none'].includes(cfg.cursorStyle) ? cfg.cursorStyle : 'bar';
      const cursorColor = cfg.cursorColor ? `style="color: ${safeColor(cfg.cursorColor, 'currentColor')}"` : '';

      this.stage.innerHTML = `
        <span class="tgx-tw-text"></span><span class="tgx-cursor" data-style="${cursorStyle}" ${cursorColor}></span>
      `;
      const textEl = this.stage.querySelector('.tgx-tw-text');

      const typeSpeed = clamp(cfg.typeSpeed, 10, 500);
      const deleteSpeed = clamp(cfg.deleteSpeed, 10, 500);
      const holdDuration = clamp(cfg.holdDuration, 200, 10000);
      const startDelay = clamp(cfg.startDelay, 0, 5000);
      const loop = cfg.loop !== false;

      let phraseIdx = 0;
      let charIdx = 0;
      let typing = true;

      const tick = () => {
        const phrase = phrases[phraseIdx];

        if (typing) {
          charIdx++;
          textEl.textContent = phrase.slice(0, charIdx);
          if (charIdx >= phrase.length) {
            typing = false;
            // Last phrase, no loop: stop here
            if (!loop && phraseIdx === phrases.length - 1) return;
            this._setTimer(tick, holdDuration);
            return;
          }
          this._setTimer(tick, typeSpeed);
        } else {
          charIdx--;
          textEl.textContent = phrase.slice(0, charIdx);
          if (charIdx <= 0) {
            typing = true;
            phraseIdx = (phraseIdx + 1) % phrases.length;
            this._setTimer(tick, typeSpeed);
            return;
          }
          this._setTimer(tick, deleteSpeed);
        }
      };

      this._setTimer(tick, startDelay);
    }

    // ---------- Rotating words ----------
    _renderRotating() {
      const cfg = this.c.rotating;
      const words = (Array.isArray(cfg.words) ? cfg.words : []).map(String).filter(w => w.length > 0);

      if (words.length === 0) {
        this.stage.innerHTML = `<span>${esc(cfg.prefix || '')}${esc(cfg.suffix || '')}</span>`;
        return;
      }

      // Reduced motion: render first word, no rotation
      if (this._prefersReduced()) {
        const wColor = safeColor(cfg.wordColor, '#6366F1');
        this.stage.innerHTML = `<span>${esc(cfg.prefix || '')}<span style="color:${wColor}">${esc(words[0])}</span>${esc(cfg.suffix || '')}</span>`;
        return;
      }

      const anim = ['slide','fade','flip'].includes(cfg.animation) ? cfg.animation : 'slide';
      const interval = clamp(cfg.interval, 600, 20000);
      const wColor = safeColor(cfg.wordColor, '#6366F1');

      // Find longest word to size the wrapper
      const longest = words.reduce((a, b) => b.length > a.length ? b : a, '');

      this.stage.innerHTML = `
        <span>${esc(cfg.prefix || '')}<span class="tgx-rot-wrap"><span class="tgx-rot-measure">${esc(longest)}</span><span class="tgx-rot-track" data-anim="${anim}" style="--tgx-rot-color:${wColor}"></span></span>${esc(cfg.suffix || '')}</span>
      `;

      const track = this.stage.querySelector('.tgx-rot-track');
      let idx = 0;

      const renderWord = (i) => {
        // Remove leaving words after transition completes
        const existing = Array.from(track.querySelectorAll('.tgx-rot-word'));
        existing.forEach(w => {
          if (w.classList.contains('is-active')) {
            w.classList.remove('is-active');
            w.classList.add('is-leaving');
            setTimeout(() => { if (w.parentNode) w.parentNode.removeChild(w); }, 600);
          }
        });

        const word = document.createElement('span');
        word.className = 'tgx-rot-word';
        word.textContent = words[i];
        track.appendChild(word);
        // Force reflow then add active class for transition to fire
        // eslint-disable-next-line no-unused-expressions
        word.offsetHeight;
        requestAnimationFrame(() => word.classList.add('is-active'));
      };

      renderWord(idx);

      const cycle = () => {
        idx = (idx + 1) % words.length;
        renderWord(idx);
        this._setTimer(cycle, interval);
      };
      this._setTimer(cycle, interval);
    }

    // ---------- Counter ----------
    _renderCounter() {
      const cfg = this.c.counter;
      const from = Number(cfg.from) || 0;
      const to = Number(cfg.to) || 0;
      const decimals = clamp(cfg.decimals, 0, 6);
      const sep = typeof cfg.thousandsSeparator === 'string' ? cfg.thousandsSeparator.slice(0, 2) : ',';
      const duration = clamp(cfg.duration, 200, 10000);
      const easing = cfg.easing === 'quart' ? easeOutQuart : (cfg.easing === 'linear' ? (t => t) : easeOutCubic);

      const format = (val) => {
        const fixed = val.toFixed(decimals);
        if (!sep) return fixed;
        const [whole, frac] = fixed.split('.');
        const withSep = whole.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
        return frac ? `${withSep}.${frac}` : withSep;
      };

      this.stage.innerHTML = `
        <span>${esc(cfg.prefix || '')}<span class="tgx-counter-num">${esc(format(from))}</span>${esc(cfg.suffix || '')}</span>
      `;
      const numEl = this.stage.querySelector('.tgx-counter-num');

      // Reduced motion: snap to final value
      if (this._prefersReduced()) {
        numEl.textContent = format(to);
        return;
      }

      const animate = () => {
        const start = performance.now();
        const step = (now) => {
          const t = Math.min(1, (now - start) / duration);
          const eased = easing(t);
          const val = from + (to - from) * eased;
          numEl.textContent = format(val);
          if (t < 1) {
            this._raf = requestAnimationFrame(step);
          } else {
            numEl.textContent = format(to);
          }
        };
        this._raf = requestAnimationFrame(step);
      };

      if (cfg.startOnView && 'IntersectionObserver' in window) {
        this._observer = new IntersectionObserver((entries) => {
          entries.forEach(e => {
            if (e.isIntersecting) {
              animate();
              this._observer.disconnect();
            }
          });
        }, { threshold: 0.4 });
        this._observer.observe(this.el);
      } else {
        animate();
      }
    }

    // ---------- Gradient ----------
    _renderGradient() {
      const cfg = this.c.gradient;
      const colors = (Array.isArray(cfg.colors) ? cfg.colors : ['#0891B2', '#6366F1', '#0891B2'])
        .slice(0, 4)
        .map(c => safeColor(c, '#0891B2'));
      while (colors.length < 2) colors.push('#0891B2');

      const angle = clamp(cfg.angle, 0, 360);
      const speed = clamp(cfg.speed, 1, 30);
      const isStatic = cfg.static === true;

      const colorVars = colors.map((c, i) => `--tgx-grad-${i + 1}: ${c}`).join('; ');
      const gradientStops = colors.join(', ');

      this.stage.innerHTML = `
        <span class="tgx-gradient" data-static="${isStatic ? '1' : '0'}" style="${colorVars}; --tgx-grad-angle: ${angle}deg; --tgx-grad-speed: ${speed}s; background-image: linear-gradient(${angle}deg, ${gradientStops});">${esc(cfg.text || '')}</span>
      `;
    }

    // ---------- Word Reveal ----------
    _renderWordReveal() {
      const cfg = this.c.wordreveal;
      const text = String(cfg.text || '');
      if (!text) {
        this.stage.innerHTML = '';
        return;
      }
      const unit = cfg.unit === 'letter' ? 'letter' : 'word';
      const anim = ['fade-up', 'fade', 'blur', 'slide'].includes(cfg.animation) ? cfg.animation : 'fade-up';
      const stagger = clamp(cfg.stagger, 10, 1000);
      const startDelay = clamp(cfg.startDelay, 0, 5000);

      // Split into pieces
      const pieces = unit === 'letter'
        ? Array.from(text).map(ch => ({ unit: 'letter', text: ch }))
        : text.split(/(\s+)/).filter(s => s.length > 0).map(s => ({ unit: /\s/.test(s) ? 'space' : 'word', text: s }));

      // Build HTML
      const html = pieces.map(p => {
        if (p.unit === 'space') return p.text; // preserve whitespace as-is
        // For letters, render non-breaking-ish: \u00a0 not needed here, just render the char
        return `<span class="tgx-reveal-piece" data-unit="${p.unit}" data-anim="${anim}">${esc(p.text)}</span>`;
      }).join('');

      this.stage.innerHTML = `<span>${html}</span>`;

      // Reduced motion: snap visible
      if (this._prefersReduced()) {
        this.stage.querySelectorAll('.tgx-reveal-piece').forEach(p => p.classList.add('is-visible'));
        return;
      }

      const playReveal = () => {
        const all = Array.from(this.stage.querySelectorAll('.tgx-reveal-piece'));
        all.forEach((p, i) => {
          this._setTimer(() => p.classList.add('is-visible'), startDelay + i * stagger);
        });

        // Optional loop: hide all and re-reveal after total + 2.5s
        if (cfg.loop) {
          const totalMs = startDelay + all.length * stagger + 700; // 700 = ~CSS duration
          this._setTimer(() => {
            all.forEach(p => p.classList.remove('is-visible'));
            this._setTimer(playReveal, 600);
          }, totalMs + 2500);
        }
      };

      if (cfg.startOnView && 'IntersectionObserver' in window) {
        this._observer = new IntersectionObserver((entries) => {
          entries.forEach(e => {
            if (e.isIntersecting) {
              playReveal();
              this._observer.disconnect();
            }
          });
        }, { threshold: 0.3 });
        this._observer.observe(this.el);
      } else {
        playReveal();
      }
    }

    // ---------- Marquee ----------
    _renderMarquee() {
      const cfg = this.c.marquee;
      const items = (Array.isArray(cfg.items) ? cfg.items : []).map(String).filter(s => s.length > 0);
      if (items.length === 0) {
        this.stage.innerHTML = '';
        return;
      }

      const sep = String(cfg.separator || '').slice(0, 6);
      const speed = clamp(cfg.speed, 10, 400);          // px/sec
      const direction = cfg.direction === 'right' ? 'right' : 'left';
      const pauseHover = cfg.pauseOnHover !== false;
      const fade = cfg.fade !== false;

      // Build a flat list of items + separators (sep between, not after last).
      // Then duplicate the whole list for seamless loop. All elements are direct
      // flex children so `gap` spaces them evenly.
      const buildList = () => {
        const parts = [];
        items.forEach((it, i) => {
          parts.push(`<span class="tgx-marquee-item">${esc(it)}</span>`);
          if (sep && i < items.length - 1) {
            parts.push(`<span class="tgx-marquee-sep" aria-hidden="true">${esc(sep)}</span>`);
          }
        });
        return parts.join('');
      };
      const oneCopy = buildList();
      // For the second copy, wrap items as aria-hidden so screen readers don't read twice.
      // Use a fragment-style approach: same elements, just marked aria-hidden via attribute on the wrapper.
      const buildListAriaHidden = () => {
        const parts = [];
        items.forEach((it, i) => {
          parts.push(`<span class="tgx-marquee-item" aria-hidden="true">${esc(it)}</span>`);
          if (sep && i < items.length - 1) {
            parts.push(`<span class="tgx-marquee-sep" aria-hidden="true">${esc(sep)}</span>`);
          }
        });
        return parts.join('');
      };
      const secondCopy = buildListAriaHidden();

      this.stage.innerHTML = `
        <div class="tgx-marquee" data-direction="${direction}" data-pause-hover="${pauseHover ? '1' : '0'}" data-fade="${fade ? '1' : '0'}" style="--tgx-mq-fade: ${fade ? '4%' : '0'}">
          <div class="tgx-marquee-track" id="tgx-mq-track">${oneCopy}${sep ? `<span class="tgx-marquee-sep" aria-hidden="true">${esc(sep)}</span>` : ''}${secondCopy}</div>
        </div>
      `;

      // Compute duration from track width and speed (px/sec)
      requestAnimationFrame(() => {
        const track = this.stage.querySelector('.tgx-marquee-track');
        if (!track) return;
        // Track is 2x the items + 1 bridging sep, so single-cycle distance is half scrollWidth
        const fullW = track.scrollWidth;
        const cycleDistance = fullW / 2;
        const duration = Math.max(2, cycleDistance / speed);
        track.style.setProperty('--tgx-mq-duration', duration + 's');
      });
    }

    // ---------- Outlined ----------
    _renderOutlined() {
      const cfg = this.c.outlined;
      const text = String(cfg.text || '');
      const strokeWidth = clamp(cfg.strokeWidth, 0.5, 10);
      const strokeColor = safeColor(cfg.strokeColor, '#0F172A');
      const fillColor = cfg.fillColor === 'transparent' ? 'transparent' : safeColor(cfg.fillColor, 'transparent');
      const hoverFill = cfg.hoverFill === true;
      const hoverFillColor = cfg.hoverFillColor ? safeColor(cfg.hoverFillColor, strokeColor) : strokeColor;

      const styleVars = [
        `--tgx-outline-width: ${strokeWidth}px`,
        `--tgx-outline-color: ${strokeColor}`,
        `--tgx-outline-fill: ${fillColor}`,
        `--tgx-outline-hover: ${hoverFillColor}`
      ].join('; ');

      this.stage.innerHTML = `
        <span class="tgx-outlined" data-hover-fill="${hoverFill ? '1' : '0'}" style="${styleVars}">${esc(text)}</span>
      `;
    }

    // ---------- Split Colour ----------
    _renderSplitColor() {
      const cfg = this.c.splitcolor;
      const text = String(cfg.text || '');
      const color1 = safeColor(cfg.color1, '#0F172A');
      const color2 = safeColor(cfg.color2, '#0891B2');
      const style = cfg.style === 'alternate' ? 'alternate' : 'horizontal';

      const styleVars = `--tgx-split-1: ${color1}; --tgx-split-2: ${color2}`;

      if (style === 'horizontal') {
        const splitPos = clamp(cfg.splitPos, 10, 90);
        this.stage.innerHTML = `
          <span class="tgx-split-h" style="${styleVars}; --tgx-split-pos: ${splitPos}%">${esc(text)}</span>
        `;
      } else {
        // Alternate: split into words, alternate tone 1 / tone 2
        const words = text.split(/(\s+)/); // keep whitespace tokens
        let toneToggle = 1;
        const html = words.map(w => {
          if (/^\s+$/.test(w)) return w;
          if (w.length === 0) return '';
          const tone = toneToggle;
          toneToggle = toneToggle === 1 ? 2 : 1;
          return `<span class="tgx-split-alt-word" data-tone="${tone}">${esc(w)}</span>`;
        }).join('');
        this.stage.innerHTML = `<span style="${styleVars}">${html}</span>`;
      }
    }

    // ---------- Spotlight Follow ----------
    _renderSpotlight() {
      const cfg = this.c.spotlight;
      const text = String(cfg.text || '');
      const baseColor = safeColor(cfg.baseColor, '#CBD5E1');
      const activeColor = safeColor(cfg.activeColor, '#0891B2');
      const radius = clamp(cfg.radius, 40, 500);
      const followCursor = cfg.followCursor !== false;
      const fallbackPos = ['center', 'left', 'right'].includes(cfg.fallbackPosition) ? cfg.fallbackPosition : 'center';

      const styleVars = [
        `--tgx-spot-base: ${baseColor}`,
        `--tgx-spot-active: ${activeColor}`,
        `--tgx-spot-radius: ${radius}px`
      ].join('; ');

      // Set initial spotlight position based on fallback (used when reduced-motion or follow disabled)
      const initialX = fallbackPos === 'left' ? '20%' : fallbackPos === 'right' ? '80%' : '50%';
      const positionVars = `--tgx-spot-x: ${initialX}; --tgx-spot-y: 50%`;

      this.stage.innerHTML = `
        <span class="tgx-spotlight" style="${styleVars}; ${positionVars}">
          <span class="tgx-spotlight-base">${esc(text)}</span>
          <span class="tgx-spotlight-top" aria-hidden="true">${esc(text)}</span>
        </span>
      `;

      // If reduced-motion is respected and active, OR follow is disabled, leave spotlight static
      if (this._prefersReduced() || !followCursor) return;

      // Track cursor on the host element. Use throttling via rAF for smoothness.
      const spotlight = this.shadow.querySelector('.tgx-spotlight');
      if (!spotlight) return;

      let pendingFrame = false;
      let lastEvent = null;

      this._spotlightHandler = (e) => {
        lastEvent = e;
        if (pendingFrame) return;
        pendingFrame = true;
        requestAnimationFrame(() => {
          pendingFrame = false;
          if (!lastEvent) return;
          const rect = spotlight.getBoundingClientRect();
          const x = lastEvent.clientX - rect.left;
          const y = lastEvent.clientY - rect.top;
          spotlight.style.setProperty('--tgx-spot-x', x + 'px');
          spotlight.style.setProperty('--tgx-spot-y', y + 'px');
        });
      };

      this._spotlightLeaveHandler = () => {
        // Snap back to centre on mouse leave
        spotlight.style.setProperty('--tgx-spot-x', initialX);
        spotlight.style.setProperty('--tgx-spot-y', '50%');
      };

      this.el.addEventListener('mousemove', this._spotlightHandler);
      this.el.addEventListener('mouseleave', this._spotlightLeaveHandler);
    }

    // ---------- Stacked Editorial ----------
    _renderStacked() {
      const cfg = this.c.stacked;
      const lines = (Array.isArray(cfg.lines) ? cfg.lines : []).slice(0, 6);
      const gap = clamp(cfg.gap, 0, 40);
      const alignItems = ['left', 'center', 'right'].includes(cfg.alignItems) ? cfg.alignItems : 'center';
      const flexAlign = alignItems === 'left' ? 'flex-start' : alignItems === 'right' ? 'flex-end' : 'center';

      const styleVars = `--tgx-stk-gap: ${gap}px; --tgx-stk-align-items: ${flexAlign}`;

      const linesHtml = lines.map(line => {
        const txt = String(line.text || '');
        const size = clamp(line.size, 8, 240);
        const weight = clamp(line.weight, 100, 900);
        const color = safeColor(line.color, '#0F172A');
        const italic = line.italic === true ? '1' : '0';
        const upper = line.uppercase === true ? '1' : '0';
        const align = ['left', 'center', 'right'].includes(line.align) ? line.align : 'center';
        const lineStyle = [
          `font-size: ${size}px`,
          `font-weight: ${weight}`,
          `color: ${color}`,
          `text-align: ${align}`
        ].join('; ');
        return `<span class="tgx-stk-line" data-italic="${italic}" data-uppercase="${upper}" style="${lineStyle}">${esc(txt)}</span>`;
      }).join('');

      this.stage.innerHTML = `
        <div class="tgx-stacked" style="${styleVars}">${linesHtml}</div>
      `;
    }

    // ---------- Split Block ----------
    _renderSplitBlock() {
      const cfg = this.c.splitblock;
      const text = String(cfg.textContent || '');
      const blockText = String(cfg.blockText || '');
      const blockColor = safeColor(cfg.blockColor, '#0891B2');
      const blockTextColor = safeColor(cfg.blockTextColor, '#FFFFFF');
      const textSide = cfg.textSide === 'right' ? 'right' : 'left';
      const ratio = ['40/60', '50/50', '60/40'].includes(cfg.ratio) ? cfg.ratio : '50/50';
      const gap = clamp(cfg.gap, 0, 80);
      const blockRadius = clamp(cfg.blockRadius, 0, 48);
      const blockPadding = clamp(cfg.blockPadding, 8, 80);
      const textAlign = ['left', 'center', 'right'].includes(cfg.textAlign) ? cfg.textAlign : 'left';
      const blockSize = clamp(cfg.blockSize, 12, 80);
      const blockWeight = clamp(cfg.blockWeight, 100, 900);

      // Map ratio to grid template fractions
      const ratioMap = {
        '40/60': { text: '2fr', block: '3fr' },
        '50/50': { text: '1fr', block: '1fr' },
        '60/40': { text: '3fr', block: '2fr' }
      };
      const r = ratioMap[ratio];

      const styleVars = [
        `--tgx-sb-gap: ${gap}px`,
        `--tgx-sb-text-frac: ${r.text}`,
        `--tgx-sb-block-frac: ${r.block}`,
        `--tgx-sb-block-bg: ${blockColor}`,
        `--tgx-sb-block-text: ${blockTextColor}`,
        `--tgx-sb-radius: ${blockRadius}px`,
        `--tgx-sb-block-pad: ${blockPadding}px`,
        `--tgx-sb-text-align: ${textAlign}`,
        `--tgx-sb-block-size: ${blockSize}px`,
        `--tgx-sb-block-weight: ${blockWeight}`
      ].join('; ');

      // Preserve newlines in text content using <br>
      const textHtml = esc(text).replace(/\n/g, '<br>');
      const blockHtml = esc(blockText).replace(/\n/g, '<br>');

      this.stage.innerHTML = `
        <div class="tgx-splitblock" data-text-side="${textSide}" style="${styleVars}">
          <div class="tgx-sb-text">${textHtml}</div>
          <div class="tgx-sb-block">${blockHtml}</div>
        </div>
      `;
    }

    // ---------- Vertical ----------
    _renderVertical() {
      const cfg = this.c.vertical;
      const text = String(cfg.text || '');
      const direction = cfg.direction === 'cw' ? 'cw' : 'ccw';
      const tracking = clamp(cfg.tracking, 0, 0.5);
      const uppercase = cfg.uppercase !== false;
      const height = clamp(cfg.height, 80, 600);

      this.stage.innerHTML = `
        <div class="tgx-vertical-wrap" id="tgx-vt-wrap" style="--tgx-vt-height: ${height}px">
          <span class="tgx-vertical" id="tgx-vt-text" data-direction="${direction}" style="--tgx-vt-tracking: ${tracking}em; --tgx-vt-case: ${uppercase ? 'uppercase' : 'none'}">${esc(text)}</span>
        </div>
      `;

      // After layout: measure the unrotated text's natural width and grow the wrap's
      // min-height to fit, plus a 32px buffer. Without this, long strings get clipped.
      requestAnimationFrame(() => {
        const wrap = this.stage.querySelector('#tgx-vt-wrap');
        const txt = this.stage.querySelector('#tgx-vt-text');
        if (!wrap || !txt) return;
        // The text element's natural width (before transform applies visually) is the
        // length we need vertically. getBoundingClientRect() returns post-transform
        // dimensions, so we use offsetWidth which is the pre-transform width.
        const naturalW = txt.offsetWidth;
        const required = naturalW + 32; // small buffer
        if (required > height) {
          wrap.style.minHeight = required + 'px';
        }
      });
    }

    _renderFallback() {
      this.stage.innerHTML = `<span>Text FX</span>`;
    }

    update(newConfig) {
      this.c = this._defaults(Object.assign({}, this.c, newConfig));
      this._render();
    }

    destroy() {
      this._teardown();
      this.shadow.innerHTML = '';
    }
  }

  // ---------- Auto-initializer ----------
  async function init() {
    const containers = document.querySelectorAll('[data-tg-widget="textfx"]');
    for (const el of containers) {
      if (el.__tgInited) continue;
      el.__tgInited = true;

      const inline = el.getAttribute('data-tg-config');
      if (inline) {
        try {
          const cfg = JSON.parse(inline);
          new TGTextFxWidget(el, cfg);
          continue;
        } catch (e) {
          console.warn('[TG TextFx] invalid data-tg-config', e);
        }
      }

      const id = el.getAttribute('data-tg-id');
      if (id) {
        try {
          const url = `${API_BASE}?id=${encodeURIComponent(id)}`;
          const res = await fetch(url);
          if (!res.ok) throw new Error('Config load failed');
          const data = await res.json();
          const cfg = data && data.config ? data.config : data;
          new TGTextFxWidget(el, cfg);
        } catch (e) {
          console.warn('[TG TextFx] remote config error', e);
          el.textContent = '';
        }
      }
    }
  }

  window.TGTextFxWidget = TGTextFxWidget;
  window.__TG_TEXTFX_VERSION__ = VERSION;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
