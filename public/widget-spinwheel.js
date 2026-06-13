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

  const VERSION = '1.0.0';

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

  class TGSpinWheelWidget {
    constructor(el, config) {
      this.el = el;
      this.cfg = this._defaults(config || {});
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
          .map(s => ({ label: String(s.label).slice(0, 28), weight: Math.max(0, Number(s.weight) || 1), color: hexOk(s.color) ? s.color : '' }))
          .slice(0, 12);
      }
      if (!segs || segs.length < 2) segs = [
        { label: 'Bali', weight: 1, color: '' }, { label: 'Maldives', weight: 1, color: '' },
        { label: 'Dubai', weight: 1, color: '' }, { label: 'New York', weight: 1, color: '' },
        { label: 'Barbados', weight: 1, color: '' }, { label: 'Rome', weight: 1, color: '' },
      ];
      if (segs.every(s => s.weight === 0)) segs.forEach(s => s.weight = 1);
      return {
        heading: typeof c.heading === 'string' ? c.heading : 'Spin to win your next trip',
        segments: segs,
        buttonText: String(c.buttonText || 'Spin').slice(0, 18),
        resultTitle: typeof c.resultTitle === 'string' ? c.resultTitle : 'Your destination: {prize}',
        resultText: typeof c.resultText === 'string' ? c.resultText : 'Quote this when you enquire and we will build it around you.',
        ctaText: String(c.ctaText || 'Enquire now').slice(0, 24),
        ctaUrl: safeUrl(c.ctaUrl) || '',
        oncePerVisitor: !!c.oncePerVisitor,
        spinDuration: Math.max(1500, Math.min(8000, Number(c.spinDuration) || 4500)),
        accent: hexOk(c.accent) ? c.accent : '#0891B2',
        layout: c.layout === 'inline' ? 'inline' : 'card',
        theme: c.theme === 'dark' ? 'dark' : 'light',
        fontFamily: typeof c.fontFamily === 'string' && c.fontFamily ? c.fontFamily : 'Inter, system-ui, sans-serif',
        previewMode: !!c.previewMode,
        widgetId: c.widgetId || '',
      };
    }

    _segColor(i) {
      const s = this.cfg.segments[i];
      if (s.color) return s.color;
      const n = this.cfg.segments.length;
      const hue = (hexToHue(this.cfg.accent) + Math.round(i * 360 / n)) % 360;
      return `hsl(${hue}, 66%, ${i % 2 ? 52 : 58}%)`;
    }

    _wheelSvg() {
      const segs = this.cfg.segments;
      const n = segs.length;
      const seg = 360 / n;
      let paths = '', labels = '';
      for (let i = 0; i < n; i++) {
        const a0 = i * seg, a1 = (i + 1) * seg;
        const [x0, y0] = pt(a0, 1), [x1, y1] = pt(a1, 1);
        const large = seg > 180 ? 1 : 0;
        paths += `<path d="M50,50 L${x0.toFixed(2)},${y0.toFixed(2)} A50,50 0 ${large},1 ${x1.toFixed(2)},${y1.toFixed(2)} Z" fill="${this._segColor(i)}" stroke="rgba(255,255,255,.55)" stroke-width="0.5"/>`;
        const mid = a0 + seg / 2;
        const [lx, ly] = pt(mid, 0.62);
        let rot = mid;
        if (mid > 90 && mid < 270) rot = mid + 180;
        const label = segs[i].label.length > 14 ? segs[i].label.slice(0, 13) + '…' : segs[i].label;
        labels += `<text x="${lx.toFixed(2)}" y="${ly.toFixed(2)}" transform="rotate(${rot.toFixed(1)} ${lx.toFixed(2)} ${ly.toFixed(2)})" text-anchor="middle" dominant-baseline="middle" font-size="4.6" font-weight="700" fill="#fff" style="paint-order:stroke;stroke:rgba(0,0,0,.18);stroke-width:.4px">${esc(label)}</text>`;
      }
      return `<g class="sw-rot">${paths}${labels}</g><circle cx="50" cy="50" r="50" fill="none" stroke="rgba(0,0,0,.08)" stroke-width="1"/>`;
    }

    _build() {
      const c = this.cfg;
      const dark = c.theme === 'dark';
      const ink = dark ? '#F1F5F9' : '#0F172A';
      const ink2 = dark ? '#94A3B8' : '#64748B';
      const panel = dark ? '#0B1220' : '#FFFFFF';
      const border = dark ? '#1E293B' : '#E2E8F0';
      const res = dark ? '#0F172A' : '#F8FAFC';
      const card = c.layout === 'card';

      this.shadow.innerHTML = `
        <style>
          :host { all: initial; }
          * { box-sizing: border-box; }
          .sw { font-family: ${c.fontFamily}; color: ${ink}; ${card ? `background:${panel};border:1px solid ${border};border-radius:16px;padding:24px 22px;box-shadow:0 1px 3px rgba(15,23,42,.06),0 10px 30px rgba(15,23,42,.04);` : ''} max-width: 380px; text-align:center; }
          .sw-head { font-size: 18px; font-weight: 800; margin: 0 0 16px; letter-spacing: -.01em; }
          .sw-stage { position: relative; width: 300px; max-width: 100%; aspect-ratio: 1 / 1; margin: 0 auto; }
          .sw-wheel { width: 100%; height: 100%; display: block; filter: drop-shadow(0 6px 16px rgba(15,23,42,.18)); border-radius: 50%; }
          .sw-rot { transform-box: fill-box; transform-origin: 50% 50%; }
          .sw-pointer { position:absolute; top:-4px; left:50%; transform:translateX(-50%); width:0; height:0; border-left:11px solid transparent; border-right:11px solid transparent; border-top:18px solid ${c.accent}; z-index:3; filter: drop-shadow(0 2px 2px rgba(0,0,0,.25)); }
          .sw-hub { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); width:74px; height:74px; border-radius:50%; border:4px solid #fff; background:${c.accent}; color:#fff; font:inherit; font-weight:800; font-size:15px; cursor:pointer; z-index:2; box-shadow:0 3px 10px rgba(15,23,42,.25); transition: transform .12s ease; }
          .sw-hub:hover { transform:translate(-50%,-50%) scale(1.05); }
          .sw-hub:disabled { cursor:not-allowed; opacity:.85; }
          .sw-result { margin-top:18px; padding:16px; background:${res}; border:1px solid ${border}; border-radius:12px; }
          .sw-result[hidden] { display:none; }
          .sw-res-title { font-size:17px; font-weight:800; letter-spacing:-.01em; }
          .sw-res-text { font-size:13px; color:${ink2}; margin-top:6px; line-height:1.5; }
          .sw-cta { display:inline-block; margin-top:12px; background:${c.accent}; color:#fff; text-decoration:none; font-weight:700; font-size:14px; padding:10px 18px; border-radius:10px; }
          .sw-cta:hover { filter:brightness(1.05); }
          .sw-cta[hidden] { display:none; }
        </style>
        <div class="sw">
          ${c.heading ? `<h3 class="sw-head">${esc(c.heading)}</h3>` : ''}
          <div class="sw-stage">
            <div class="sw-pointer" aria-hidden="true"></div>
            <svg class="sw-wheel" viewBox="0 0 100 100" role="img" aria-label="Prize wheel">${this._wheelSvg()}</svg>
            <button class="sw-hub" id="spin" type="button">${esc(c.buttonText)}</button>
          </div>
          <div class="sw-result" id="result" hidden>
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
      const t = c.resultTitle.indexOf('{prize}') >= 0 ? c.resultTitle.replace(/\{prize\}/g, label) : (c.resultTitle + ' ' + label);
      title.textContent = t;
      text.textContent = restored && c.oncePerVisitor ? (c.resultText) : c.resultText;
      if (c.ctaUrl && c.ctaText) {
        cta.textContent = c.ctaText;
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
