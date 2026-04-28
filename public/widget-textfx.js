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

    @media (prefers-reduced-motion: reduce) {
      .tgx-root[data-respect-reduced-motion="1"] .tgx-cursor { animation: none; }
      .tgx-root[data-respect-reduced-motion="1"] .tgx-rot-word { transition: none; }
      .tgx-root[data-respect-reduced-motion="1"] .tgx-gradient { animation: none; background-size: 100% 100%; }
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
        default:           this._renderFallback();
      }
    }

    _teardown() {
      this._timers.forEach(t => clearTimeout(t));
      this._timers = [];
      if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
      if (this._observer) { this._observer.disconnect(); this._observer = null; }
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
