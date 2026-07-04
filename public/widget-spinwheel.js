/**
 * Travelgenix Spin the Wheel Widget v1.0.0
 * Self-contained, embeddable prize wheel. Spin to land on a destination or
 * prize, then show a result and a call to action. Zero dependencies, Shadow DOM
 * isolation, no API. Weighted segments, optional one-spin-per-visitor lock,
 * respects prefers-reduced-motion.
 *
 * Usage (remote config, default):
 *   <div data-tg-widget="spinwheel" data-tg-id="YOUR_WIDGET_ID"></div>
 *   <script src="https://tg-widgets.vercel.app/widget-spinwheel.js"></script>
 *
 * Usage (inline config, editor preview):
 *   <div data-tg-widget="spinwheel" data-tg-config='{...}'></div>
 *   <script src="https://tg-widgets.vercel.app/widget-spinwheel.js"></script>
 */
(function () {
  'use strict';

  const VERSION = '1.2.2';

  // ─── i18n ───────────────────────────────────────────────────
  // Fixed UI chrome only (the spin button, result flow, lead-capture labels and
  // the prize-wheel aria label). Author content (segment/prize labels, promo
  // codes) is never translated. English is the source + fallback.
  const MESSAGES = {
    en: {
      spin: 'Spin', heading: 'Spin to win your next trip', cta: 'Enquire now',
      congrats: 'Congratulations!', youWon: 'Your destination: {prize}', spinAgain: 'Spin again',
      betterLuck: 'Better luck next time', name: 'Name', email: 'Email address',
      copyCode: 'Copy code', copied: 'Copied!', invalidEmail: 'Please enter a valid email address.',
      close: 'Close', wheelLabel: 'Prize wheel',
    },
    fr: {
      spin: 'Tourner', heading: 'Tournez pour gagner votre prochain voyage', cta: 'Faire une demande',
      congrats: 'Félicitations !', youWon: 'Votre destination : {prize}', spinAgain: 'Retourner',
      betterLuck: 'Plus de chance la prochaine fois', name: 'Nom', email: 'Adresse e-mail',
      copyCode: 'Copier le code', copied: 'Copié !', invalidEmail: 'Veuillez saisir une adresse e-mail valide.',
      close: 'Fermer', wheelLabel: 'Roue des prix',
    },
    de: {
      spin: 'Drehen', heading: 'Drehen und Ihre nächste Reise gewinnen', cta: 'Jetzt anfragen',
      congrats: 'Glückwunsch!', youWon: 'Ihr Reiseziel: {prize}', spinAgain: 'Nochmal drehen',
      betterLuck: 'Mehr Glück beim nächsten Mal', name: 'Name', email: 'E-Mail-Adresse',
      copyCode: 'Code kopieren', copied: 'Kopiert!', invalidEmail: 'Bitte geben Sie eine gültige E-Mail-Adresse ein.',
      close: 'Schließen', wheelLabel: 'Gewinnrad',
    },
    es: {
      spin: 'Girar', heading: 'Gira para ganar tu próximo viaje', cta: 'Consultar ahora',
      congrats: '¡Enhorabuena!', youWon: 'Tu destino: {prize}', spinAgain: 'Girar de nuevo',
      betterLuck: 'Más suerte la próxima vez', name: 'Nombre', email: 'Correo electrónico',
      copyCode: 'Copiar código', copied: '¡Copiado!', invalidEmail: 'Introduce una dirección de correo electrónico válida.',
      close: 'Cerrar', wheelLabel: 'Rueda de premios',
    },
    it: {
      spin: 'Gira', heading: 'Gira e vinci il tuo prossimo viaggio', cta: 'Richiedi ora',
      congrats: 'Congratulazioni!', youWon: 'La tua destinazione: {prize}', spinAgain: 'Gira di nuovo',
      betterLuck: 'Più fortuna la prossima volta', name: 'Nome', email: 'Indirizzo email',
      copyCode: 'Copia codice', copied: 'Copiato!', invalidEmail: 'Inserisci un indirizzo email valido.',
      close: 'Chiudi', wheelLabel: 'Ruota dei premi',
    },
    ro: {
      spin: 'Învârte', heading: 'Învârte ca să câștigi următoarea călătorie', cta: 'Solicită acum',
      congrats: 'Felicitări!', youWon: 'Destinația ta: {prize}', spinAgain: 'Învârte din nou',
      betterLuck: 'Mai mult noroc data viitoare', name: 'Nume', email: 'Adresă de e-mail',
      copyCode: 'Copiază codul', copied: 'Copiat!', invalidEmail: 'Introduceți o adresă de e-mail validă.',
      close: 'Închide', wheelLabel: 'Roata premiilor',
    },
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

  function resolveConfigApi() {
    if (typeof window === 'undefined') return '/api/widget-config';
    if (window.__TG_WIDGET_API__) return window.__TG_WIDGET_API__;
    try {
      const me = document.currentScript;
      if (me && me.src) return new URL(me.src).origin + '/api/widget-config';
      const scripts = document.getElementsByTagName('script');
      for (let i = scripts.length - 1; i >= 0; i--) {
        const s = scripts[i].src || '';
        if (/\/widget-spinwheel\.js(\?|$|#)/.test(s)) return new URL(s).origin + '/api/widget-config';
      }
    } catch (e) { /* fall through */ }
    return '/api/widget-config';
  }
  const CONFIG_API = resolveConfigApi();

  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hexOk = (v) => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(v || '').trim());
  // fontFamily is interpolated raw into the shadow <style> block, so it must not
  // carry CSS/HTML-breakout characters (< > { } ; : etc). Allow only what a real
  // font-family stack needs, else fall back. Stops a saved fontFamily like
  // `x}</style><img onerror=...>` escaping the style element on the client page.
  const safeFontStack = (v, fb) => {
    const s = String(v == null ? '' : v).trim();
    return (s && s.length <= 120 && /^[A-Za-z0-9 ,"'-]+$/.test(s)) ? s : fb;
  };
  const reducedMotion = () => { try { return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };

  // Only allow safe href schemes for the CTA.
  function safeUrl(u) {
    const s = String(u || '').trim();
    if (!s) return '';
    if (/^(https?:|mailto:|tel:|\/)/i.test(s)) return s;
    return '';
  }

  function hexToHue(hex) {
    let h = String(hex || '#0891B2').replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const r = parseInt(h.slice(0, 2), 16) / 255, g = parseInt(h.slice(2, 4), 16) / 255, b = parseInt(h.slice(4, 6), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    if (!d) return 200;
    let hue;
    if (max === r) hue = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    return Math.round(hue * 60);
  }

  // Point on the wheel: angle measured clockwise from the top (12 o'clock).
  function pt(angleDeg, rFrac) {
    const r = 50 * rFrac;
    const rad = (angleDeg - 90) * Math.PI / 180;
    return [50 + r * Math.cos(rad), 50 + r * Math.sin(rad)];
  }

  function hexToRgb(hex) {
    let h = String(hex || '').replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    if (!/^[0-9a-f]{6}$/i.test(h)) return null;
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  // Relative luminance (0..1). Handles hex and hsl() (lightness proxy).
  function lumOf(color) {
    const rgb = hexToRgb(color);
    if (rgb) { const a = rgb.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2]; }
    const m = String(color).match(/hsl\(\s*[\d.]+\s*,\s*[\d.]+%\s*,\s*([\d.]+)%/i);
    if (m) return (+m[1]) / 100;
    return 0.5;
  }
  // Text colour that reads on a given fill.
  function textColorOn(fill) { return lumOf(fill) > 0.55 ? '#111418' : '#ffffff'; }

  class TGSpinWheelWidget {
    constructor(el, config) {
      this.el = el;
      this.cfg = this._defaults(config || {});
      this.t = makeT(this.cfg);   // resolve viewer language + UI strings
      this._rot = 0;
      this._spinning = false;
      this._won = null;
      this.shadow = el.attachShadow ? el.attachShadow({ mode: 'open' }) : el;
      el.setAttribute('data-tg-initialised', '1');
      this._build();
      this._restoreLock();
    }

    _lockKey() {
      const base = this.cfg.widgetId || this.cfg.segments.map(s => s.label).join('|');
      let h = 0; for (let i = 0; i < base.length; i++) { h = (h * 31 + base.charCodeAt(i)) | 0; }
      return 'tgsw_' + (h >>> 0).toString(36);
    }

    _defaults(c) {
      let segs = Array.isArray(c.segments) ? c.segments : null;
      if (segs) {
        segs = segs
          .filter(s => s && String(s.label || '').trim())
          .map(s => ({ label: String(s.label).slice(0, 28), description: String(s.description || '').slice(0, 40), weight: Math.max(0, Number(s.weight) || 1), color: hexOk(s.color) ? s.color : '' }))
          .slice(0, 12);
      }
      if (!segs || segs.length < 2) segs = [
        { label: 'Bali', weight: 1, color: '' }, { label: 'Maldives', weight: 1, color: '' },
        { label: 'Dubai', weight: 1, color: '' }, { label: 'New York', weight: 1, color: '' },
        { label: 'Barbados', weight: 1, color: '' }, { label: 'Rome', weight: 1, color: '' },
      ];
      if (segs.every(s => s.weight === 0)) segs.forEach(s => s.weight = 1);
      return {
        // Author-configurable copy. Empty string means "use the localised
        // default", resolved against the viewer language at render time
        // (this.t) so an unconfigured widget speaks the visitor's language.
        heading: typeof c.heading === 'string' ? c.heading : '',
        subheading: typeof c.subheading === 'string' ? c.subheading : '',
        logo: safeUrl(c.logo) || '',
        segments: segs,
        buttonText: typeof c.buttonText === 'string' && c.buttonText ? String(c.buttonText).slice(0, 18) : '',
        buttonPlacement: c.buttonPlacement === 'top' ? 'top' : 'hub',
        resultTitle: typeof c.resultTitle === 'string' ? c.resultTitle : '',
        resultText: typeof c.resultText === 'string' ? c.resultText : 'Quote this when you enquire and we will build it around you.',
        ctaText: typeof c.ctaText === 'string' && c.ctaText ? String(c.ctaText).slice(0, 24) : '',
        ctaUrl: safeUrl(c.ctaUrl) || '',
        oncePerVisitor: !!c.oncePerVisitor,
        spinDuration: Math.max(1500, Math.min(8000, Number(c.spinDuration) || 4500)),
        size: Math.max(240, Math.min(560, Math.round(Number(c.size) || 360))),
        style: c.style === 'flat' ? 'flat' : 'premium',
        accent: hexOk(c.accent) ? c.accent : '#0891B2',
        spinColor: hexOk(c.spinColor) ? c.spinColor : '',
        spinTextColor: hexOk(c.spinTextColor) ? c.spinTextColor : '',
        headingColor: hexOk(c.headingColor) ? c.headingColor : '',
        cardBg: hexOk(c.cardBg) ? c.cardBg : '',
        cardTransparent: !!c.cardTransparent,
        segment2: hexOk(c.segment2) ? c.segment2 : '',
        pointerColor: hexOk(c.pointerColor) ? c.pointerColor : '',
        peek: !!c.peek,
        layout: c.layout === 'inline' ? 'inline' : 'card',
        theme: c.theme === 'dark' ? 'dark' : 'light',
        fontFamily: safeFontStack(c.fontFamily, 'Inter, system-ui, sans-serif'),
        previewMode: !!c.previewMode,
        widgetId: c.widgetId || '',
      };
    }

    _segColor(i) {
      const s = this.cfg.segments[i];
      if (s.color) return s.color;
      if (i % 2 === 0) return this.cfg.accent;
      if (this.cfg.segment2) return this.cfg.segment2;
      // Default odd tone: a deep tint of the accent (premium two-tone).
      const h = hexToHue(this.cfg.accent);
      return `hsl(${h}, 38%, 17%)`;
    }

    _wheelSvg() {
      const c = this.cfg, segs = c.segments, n = segs.length, seg = 360 / n;
      const flat = c.style === 'flat';
      const R = flat ? 0.92 : 0.86;
      const arcR = (R * 50).toFixed(2);
      let paths = '', dividers = '', labels = '';
      for (let i = 0; i < n; i++) {
        const a0 = i * seg, a1 = (i + 1) * seg;
        const [x0, y0] = pt(a0, R), [x1, y1] = pt(a1, R);
        const large = seg > 180 ? 1 : 0;
        const fill = this._segColor(i);
        paths += `<path d="M50,50 L${x0.toFixed(2)},${y0.toFixed(2)} A${arcR},${arcR} 0 ${large},1 ${x1.toFixed(2)},${y1.toFixed(2)} Z" fill="${fill}"/>`;
        dividers += `<line x1="50" y1="50" x2="${x0.toFixed(2)}" y2="${y0.toFixed(2)}" stroke="${flat ? 'rgba(255,255,255,.85)' : 'rgba(255,255,255,.5)'}" stroke-width="${flat ? 0.5 : 0.45}"/>`;
        // Label colour adapts to the slice so black-on-white and white-on-black both read.
        const tcol = textColorOn(fill);
        const tstroke = tcol === '#ffffff' ? 'rgba(0,0,0,.28)' : 'rgba(255,255,255,.4)';
        const mid = a0 + seg / 2;
        let rot = mid; if (mid > 90 && mid < 270) rot = mid + 180;
        const hasSub = !!segs[i].description;
        // Push labels outward into the wide part of each slice so long words
        // (e.g. "Cape Town", "Welcome drinks") clear the centre hub and stop merging.
        const mainR = hasSub ? (flat ? 0.69 : 0.66) : (flat ? 0.64 : 0.6);
        const [mx, my] = pt(mid, mainR);
        const mainFs = flat ? 5.4 : 4.6;
        const label = segs[i].label.length > 16 ? segs[i].label.slice(0, 15) + '…' : segs[i].label;
        labels += `<text x="${mx.toFixed(2)}" y="${my.toFixed(2)}" transform="rotate(${rot.toFixed(1)} ${mx.toFixed(2)} ${my.toFixed(2)})" text-anchor="middle" dominant-baseline="middle" font-size="${mainFs}" font-weight="800" letter-spacing="${flat ? '-0.02' : '0.03'}" fill="${tcol}" style="paint-order:stroke;stroke:${tstroke};stroke-width:.55px">${esc(label)}</text>`;
        if (hasSub) {
          const [sx, sy] = pt(mid, flat ? 0.54 : 0.49);
          const subFs = flat ? 2.7 : 2.4;
          const sub = segs[i].description.length > 26 ? segs[i].description.slice(0, 25) + '…' : segs[i].description;
          labels += `<text x="${sx.toFixed(2)}" y="${sy.toFixed(2)}" transform="rotate(${rot.toFixed(1)} ${sx.toFixed(2)} ${sy.toFixed(2)})" text-anchor="middle" dominant-baseline="middle" font-size="${subFs}" font-weight="600" fill="${tcol}" opacity="0.78">${esc(sub)}</text>`;
        }
      }

      const pcol = c.pointerColor || (flat ? '#E11D2A' : '');
      const dropDefs = '<filter id="swDrop" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="1.6" stdDeviation="2.4" flood-color="#0b1220" flood-opacity="0.34"/></filter>';
      const pinDefs = '<linearGradient id="swPin" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#ffe6a0"/><stop offset="45%" stop-color="#F4C95D"/><stop offset="100%" stop-color="#d89a2f"/></linearGradient>';
      const pointer = pcol
        ? `<g filter="url(#swDrop)"><path d="M50 13.6 L42.6 0.7 Q50 -0.3 57.4 0.7 Z" fill="${pcol}" stroke="rgba(0,0,0,.18)" stroke-width="0.4" stroke-linejoin="round"/></g>`
        : `<g filter="url(#swDrop)"><path d="M50 9 L44.6 2.8 Q50 0.4 55.4 2.8 Z" fill="url(#swPin)" stroke="#8a6516" stroke-width="0.5" stroke-linejoin="round"/><circle cx="50" cy="3.4" r="2.3" fill="url(#swPin)" stroke="#8a6516" stroke-width="0.5"/><circle cx="49.2" cy="2.7" r="0.65" fill="#fff8e2" opacity="0.85"/></g>`;

      if (flat) {
        const cap = (c.buttonPlacement === 'top' || c.peek) ? '<circle cx="50" cy="50" r="6" fill="#fff" stroke="rgba(15,23,42,.2)" stroke-width="0.7"/>' : '';
        return `
          <defs>${dropDefs}${pcol ? '' : pinDefs}</defs>
          <circle cx="50" cy="50" r="48" fill="#ffffff" filter="url(#swDrop)"/>
          <circle cx="50" cy="50" r="47.6" fill="none" stroke="rgba(15,23,42,.45)" stroke-width="0.9"/>
          <g class="sw-rot">${paths}${dividers}${labels}</g>
          <circle cx="50" cy="50" r="46.4" fill="none" stroke="#ffffff" stroke-width="2.4"/>
          ${cap}${pointer}`;
      }

      let bulbs = ''; const NB = 24;
      for (let i = 0; i < NB; i++) { const [bx, by] = pt(i * (360 / NB), 0.935); bulbs += `<circle cx="${bx.toFixed(2)}" cy="${by.toFixed(2)}" r="1.15" fill="url(#swBulb)"/>`; }
      return `
        <defs>
          ${dropDefs}${pcol ? '' : pinDefs}
          <radialGradient id="swDome" cx="50%" cy="33%" r="62%"><stop offset="0%" stop-color="#ffffff" stop-opacity="0.24"/><stop offset="40%" stop-color="#ffffff" stop-opacity="0.06"/><stop offset="70%" stop-color="#000000" stop-opacity="0"/><stop offset="100%" stop-color="#000000" stop-opacity="0.20"/></radialGradient>
          <linearGradient id="swRim" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#243149"/><stop offset="52%" stop-color="#101a2c"/><stop offset="100%" stop-color="#070b14"/></linearGradient>
          <radialGradient id="swBulb" cx="50%" cy="40%" r="60%"><stop offset="0%" stop-color="#fff7da"/><stop offset="55%" stop-color="#ffdd84"/><stop offset="100%" stop-color="#bd8b2c"/></radialGradient>
        </defs>
        <circle cx="50" cy="50" r="50" fill="url(#swRim)" filter="url(#swDrop)"/>
        <circle cx="50" cy="50" r="49.3" fill="none" stroke="#3c4d6b" stroke-width="0.5"/>
        ${bulbs}
        <g class="sw-rot">${paths}${dividers}${labels}</g>
        <circle cx="50" cy="50" r="43" fill="url(#swDome)" pointer-events="none"/>
        <circle cx="50" cy="50" r="43.2" fill="none" stroke="${pcol ? '#cbd5e1' : 'url(#swPin)'}" stroke-width="1.1"/>
        ${pointer}`;
    }

    _build() {
      const c = this.cfg;
      // Localised defaults for unconfigured author copy.
      const heading = c.heading || this.t('heading');
      const buttonText = c.buttonText || this.t('spin');
      const dark = c.theme === 'dark';
      const ink = dark ? '#F1F5F9' : '#0F172A';
      const ink2 = dark ? '#94A3B8' : '#64748B';
      const panel = c.cardBg || (dark ? '#0B1220' : '#FFFFFF');
      const border = dark ? '#1E293B' : '#E2E8F0';
      const res = dark ? '#0F172A' : '#F8FAFC';
      const card = c.layout === 'card';
      // The accent doubles as segment colour 1. When it is very light (e.g. a
      // black/white wheel uses white), the hub / badge / CTA need a readable
      // stand-in so they are not white-on-white.
      const act = lumOf(c.accent) > 0.7 ? (c.pointerColor || '#111418') : c.accent;
      // Spin-button colours: explicit overrides, else the accent-derived action
      // colour with white text. Heading colour: explicit override, else the ink.
      const spinBg = c.spinColor || act;
      const spinInk = c.spinTextColor || '#ffffff';
      const headInk = c.headingColor || ink;
      // Card chrome. Transparent drops the panel, border and shadow so the
      // widget sits flush on whatever is behind it.
      const cardCss = card
        ? (c.cardTransparent
            ? 'padding:8px 0;'
            : `background:${panel};border:1px solid ${border};border-radius:18px;padding:26px 22px;box-shadow:0 1px 3px rgba(15,23,42,.06),0 18px 42px rgba(15,23,42,.10);`)
        : '';
      // Peek crops the wheel at the bottom; the spin button must sit above it.
      const topPlacement = c.buttonPlacement === 'top' || c.peek;

      this.shadow.innerHTML = `
        <style>
          :host { all: initial; }
          * { box-sizing: border-box; }
          .sw { font-family: ${c.fontFamily}; color: ${ink}; ${cardCss} max-width: ${c.size + 80}px; text-align:center; }
          .sw-head { font-size: 19px; font-weight: 800; color: ${headInk}; margin: 0 0 ${c.subheading ? '4px' : '18px'}; letter-spacing: -.015em; }
          .sw-logo { display:block; max-height:44px; max-width:72%; margin:0 auto 14px; object-fit:contain; }
          .sw-sub { font-size: 14px; color: ${ink2}; margin: 0 0 16px; line-height: 1.45; }
          .sw-topbtn { display:inline-block; margin:0 auto 16px; ${c.spinColor ? `border:1.6px solid ${spinBg}; background:${spinBg}; color:${spinInk};` : `border:1.6px solid ${ink}; background:transparent; color:${ink};`} font:inherit; font-weight:700; font-size:15px; padding:11px 26px; border-radius:999px; cursor:pointer; transition: filter .15s ease, background .15s ease, color .15s ease, transform .12s ease; }
          .sw-topbtn:hover:not(:disabled) { ${c.spinColor ? 'filter:brightness(1.08);' : `background:${ink}; color:${panel};`} }
          .sw-topbtn:active:not(:disabled) { transform: scale(.97); }
          .sw-topbtn:disabled { opacity:.55; cursor:default; }
          .sw-hubcap { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); width:54px; height:54px; border-radius:50%; background:#fff; box-shadow:0 0 0 3px #E9B949, 0 4px 10px rgba(11,18,32,.3); z-index:2; }
          .sw-stage { position: relative; width: ${c.size}px; max-width: 100%; aspect-ratio: 1 / 1; margin: 0 auto; }
          .sw-wheel { width: 100%; height: 100%; display: block; }
          .sw-rot { transform-box: fill-box; transform-origin: 50% 50%; }
          .sw.is-peek .sw-stage { aspect-ratio: auto; height: 0; padding-bottom: 60%; overflow: hidden; }
          .sw.is-peek .sw-wheel { position: absolute; top: 0; left: 0; width: 100%; height: auto; }
          .sw-hub { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); width:86px; height:86px; border-radius:50%; border:0; padding:0; cursor:pointer; z-index:3;
            background:${spinBg};
            background:radial-gradient(circle at 50% 32%, color-mix(in srgb, ${spinBg} 70%, #ffffff 30%), ${spinBg} 58%, color-mix(in srgb, ${spinBg} 62%, #000000 38%));
            box-shadow:0 0 0 4px #ffffff, 0 0 0 7px #E9B949, 0 8px 18px rgba(11,18,32,.42), inset 0 2px 6px rgba(255,255,255,.5), inset 0 -4px 8px rgba(0,0,0,.28);
            color:${spinInk}; font:inherit; font-weight:800; font-size:15px; letter-spacing:.1em; text-transform:uppercase;
            display:flex; align-items:center; justify-content:center; transition: transform .14s ease; }
          .sw-hub:hover:not(:disabled) { transform:translate(-50%,-50%) scale(1.06); }
          .sw-hub:active:not(:disabled) { transform:translate(-50%,-50%) scale(.96); }
          .sw-hub:disabled { cursor:default; }
          .sw-hub::before { content:''; position:absolute; inset:0; border-radius:50%; box-shadow:0 0 0 3px ${spinBg}; opacity:0; animation: swPing 2.4s ease-out infinite; pointer-events:none; }
          .sw-hub:disabled::before { display:none; }
          @keyframes swPing { 0% { transform:scale(1); opacity:.5 } 70% { transform:scale(1.5); opacity:0 } 100% { opacity:0 } }
          .sw-result { margin-top:20px; padding:18px 16px; border:1px solid ${border}; border-radius:14px; background:${res}; background:linear-gradient(180deg, ${dark ? '#0f1a2e' : '#FBFCFE'}, ${res}); }
          .sw-result[hidden] { display:none; }
          .sw-result:not([hidden]) { animation: swReveal .45s cubic-bezier(.2,.9,.3,1.2) both; }
          @keyframes swReveal { from { opacity:0; transform:translateY(10px) scale(.95) } to { opacity:1; transform:none } }
          .sw-res-badge { width:42px; height:42px; margin:0 auto 9px; border-radius:50%; display:flex; align-items:center; justify-content:center; background:${ink2}22; background:color-mix(in srgb, ${act} 16%, transparent); }
          .sw-res-badge svg { width:22px; height:22px; stroke:${act}; fill:none; stroke-width:2.2; stroke-linecap:round; stroke-linejoin:round; }
          .sw-res-title { font-size:19px; font-weight:800; letter-spacing:-.01em; line-height:1.2; }
          .sw-res-text { font-size:13px; color:${ink2}; margin-top:6px; line-height:1.5; }
          .sw-cta { display:inline-block; margin-top:14px; background:${act}; color:#fff; text-decoration:none; font-weight:700; font-size:14px; padding:11px 20px; border-radius:11px; box-shadow:0 6px 16px rgba(15,23,42,.16); transition:transform .14s ease, box-shadow .14s ease; }
          .sw-cta:hover { transform:translateY(-1px); box-shadow:0 9px 22px rgba(15,23,42,.22); }
          .sw-cta[hidden] { display:none; }
          @media (prefers-reduced-motion: reduce) { .sw-hub::before { animation:none; display:none } .sw-result:not([hidden]) { animation:none } }
        </style>
        <div class="sw${c.peek ? ' is-peek' : ''}">
          ${c.logo ? `<img class="sw-logo" src="${esc(c.logo)}" alt="">` : ''}
          ${heading ? `<h3 class="sw-head">${esc(heading)}</h3>` : ''}
          ${c.subheading ? `<p class="sw-sub">${esc(c.subheading)}</p>` : ''}
          ${topPlacement ? `<button class="sw-topbtn" id="spin" type="button">${esc(buttonText)}</button>` : ''}
          <div class="sw-stage">
            <svg class="sw-wheel" viewBox="0 0 100 100" role="img" aria-label="${esc(this.t('wheelLabel'))}">${this._wheelSvg()}</svg>
            ${topPlacement ? ((c.style !== 'flat' && !c.peek) ? '<div class="sw-hubcap" aria-hidden="true"></div>' : '') : `<button class="sw-hub" id="spin" type="button">${esc(buttonText)}</button>`}
          </div>
          <div class="sw-result" id="result" hidden>
            <div class="sw-res-badge" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="6"/><path d="M8.5 13.6 7 22l5-3 5 3-1.5-8.4"/></svg></div>
            <div class="sw-res-title" id="res-title"></div>
            <div class="sw-res-text" id="res-text"></div>
            <a class="sw-cta" id="cta" rel="noopener" hidden></a>
          </div>
        </div>`;

      this._rotG = this.shadow.querySelector('.sw-rot');
      this._spinBtn = this.shadow.getElementById('spin');
      this._spinBtn.addEventListener('click', () => this._spin());
    }

    _restoreLock() {
      if (this.cfg.previewMode || !this.cfg.oncePerVisitor) return;
      try {
        const v = window.localStorage.getItem(this._lockKey());
        if (v) { this._won = v; this._reveal(v, true); this._spinBtn.disabled = true; }
      } catch (e) { /* ignore */ }
    }

    _pickIndex() {
      const segs = this.cfg.segments;
      const total = segs.reduce((a, s) => a + (s.weight || 0), 0) || segs.length;
      let r = Math.random() * total;
      for (let i = 0; i < segs.length; i++) { r -= (segs[i].weight || 0) || 1; if (r <= 0) return i; }
      return segs.length - 1;
    }

    _spin() {
      if (this._spinning) return;
      const n = this.cfg.segments.length;
      const seg = 360 / n;
      const w = this._pickIndex();
      const centre = w * seg + seg / 2;
      const targetMod = (360 - (centre % 360)) % 360;
      const reduce = reducedMotion();
      const spins = reduce ? 0 : 5;
      const cur = this._rot;
      let delta = spins * 360 + ((targetMod - (cur % 360) + 360) % 360);
      if (delta === 0) delta = reduce ? 0 : 360;
      this._rot = cur + delta;
      this._spinning = true;
      this._spinBtn.disabled = true;
      const hideResult = this.shadow.getElementById('result');
      if (hideResult && !hideResult.hasAttribute('data-keep')) hideResult.hidden = true;

      const dur = reduce ? 0 : this.cfg.spinDuration;
      this._rotG.style.transition = dur ? `transform ${dur}ms cubic-bezier(0.16, 1, 0.3, 1)` : 'none';
      // Force reflow so the transition picks up the new value.
      void this._rotG.getBoundingClientRect();
      this._rotG.style.transform = `rotate(${this._rot}deg)`;

      const finish = () => {
        if (!this._spinning) return;
        this._spinning = false;
        const label = this.cfg.segments[w].label;
        this._won = label;
        this._reveal(label, false);
        if (this.cfg.oncePerVisitor && !this.cfg.previewMode) {
          try { window.localStorage.setItem(this._lockKey(), label); } catch (e) {}
          this._spinBtn.disabled = true;
        } else {
          this._spinBtn.disabled = false;
        }
      };
      if (dur) {
        let done = false;
        const onEnd = () => { if (done) return; done = true; this._rotG.removeEventListener('transitionend', onEnd); finish(); };
        this._rotG.addEventListener('transitionend', onEnd);
        setTimeout(onEnd, dur + 400); // safety net
      } else {
        setTimeout(finish, 30);
      }
    }

    _reveal(label, restored) {
      const c = this.cfg;
      const result = this.shadow.getElementById('result');
      const title = this.shadow.getElementById('res-title');
      const text = this.shadow.getElementById('res-text');
      const cta = this.shadow.getElementById('cta');
      // Result title: author override wins; otherwise the localised "You won
      // {prize}" default. The prize label itself is author content, untranslated.
      const titleTpl = c.resultTitle || this.t('youWon');
      const t = titleTpl.indexOf('{prize}') >= 0 ? titleTpl.replace(/\{prize\}/g, label) : (titleTpl + ' ' + label);
      title.textContent = t;
      text.textContent = restored && c.oncePerVisitor ? (c.resultText) : c.resultText;
      const ctaText = c.ctaText || this.t('cta');
      if (c.ctaUrl && ctaText) {
        cta.textContent = ctaText;
        cta.setAttribute('href', c.ctaUrl);
        if (/^https?:/i.test(c.ctaUrl)) cta.setAttribute('target', '_blank');
        cta.hidden = false;
      } else { cta.hidden = true; }
      result.hidden = false;
    }

    update(config) {
      const keepId = this.cfg.widgetId;
      this.cfg = this._defaults(config || {});
      if (!this.cfg.widgetId) this.cfg.widgetId = keepId;
      this.t = makeT(this.cfg);
      this._rot = 0;
      this._spinning = false;
      this._build();
      this._restoreLock();
    }

    destroy() { try { this.shadow.innerHTML = ''; } catch (e) {} try { this.el.removeAttribute('data-tg-initialised'); } catch (e) {} }
  }

  async function init() {
    if (typeof document === 'undefined') return;
    const nodes = document.querySelectorAll('[data-tg-widget="spinwheel"]:not([data-tg-initialised])');
    for (const el of nodes) {
      try {
        const inline = el.getAttribute('data-tg-config');
        if (inline) { let cfg = {}; try { cfg = JSON.parse(inline); } catch { cfg = {}; } new TGSpinWheelWidget(el, cfg); continue; }
        const id = el.getAttribute('data-tg-id');
        if (id) {
          const res = await fetch(CONFIG_API + '?id=' + encodeURIComponent(id), { credentials: 'omit' });
          if (!res.ok) throw new Error('config ' + res.status);
          const data = await res.json();
          const cfg = (data && (data.config || data)) || {};
          cfg.widgetId = id;
          new TGSpinWheelWidget(el, cfg);
          continue;
        }
        console.warn('[TG Spin Wheel] Container has neither data-tg-id nor data-tg-config');
      } catch (err) {
        console.error('[TG Spin Wheel] Failed to initialise:', err);
        try { el.innerHTML = '<p style="color:#64748b;font:14px/1.5 system-ui,sans-serif;padding:16px;text-align:center;border:1px dashed #e2e8f0;border-radius:8px;margin:0">Unable to load Spin the Wheel widget</p>'; } catch (e) {}
      }
    }
  }

  if (typeof window !== 'undefined') { window.TGSpinWheelWidget = TGSpinWheelWidget; window.__TG_SPINWHEEL_VERSION__ = VERSION; }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
    if (typeof MutationObserver !== 'undefined') {
      try {
        let scheduled = false;
        const schedule = () => { if (scheduled) return; scheduled = true; setTimeout(() => { scheduled = false; init(); }, 120); };
        const mo = new MutationObserver((records) => {
          for (const r of records) for (const node of r.addedNodes) {
            if (node.nodeType !== 1) continue;
            if ((node.matches && node.matches('[data-tg-widget="spinwheel"]:not([data-tg-initialised])')) ||
                (node.querySelector && node.querySelector('[data-tg-widget="spinwheel"]:not([data-tg-initialised])'))) { schedule(); return; }
          }
        });
        mo.observe(document.body || document.documentElement, { childList: true, subtree: true });
      } catch (e) { /* noop */ }
    }
  }
})();
