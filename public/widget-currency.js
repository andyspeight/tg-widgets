/**
 * Travelgenix Currency Converter Widget v1.0.0
 * Self-contained, embeddable currency converter. Zero dependencies, Shadow DOM
 * isolation, works on any site via a single script tag.
 *
 * Live rates are fetched at render time from /api/fx-rates (European Central
 * Bank reference data via Frankfurter) and cached in memory for the session.
 * Conversion happens client-side from a single rates table, so changing the
 * amount or currencies is instant with no extra network calls. If the rates
 * fetch fails the widget falls back to a small built-in table so it always
 * shows something sensible (and says the rates are indicative).
 *
 * Usage (remote config, default):
 *   <div data-tg-widget="currency" data-tg-id="YOUR_WIDGET_ID"></div>
 *   <script src="https://tg-widgets.vercel.app/widget-currency.js"></script>
 *
 * Usage (inline config, editor preview):
 *   <div data-tg-widget="currency" data-tg-config='{...}'></div>
 *   <script src="https://tg-widgets.vercel.app/widget-currency.js"></script>
 */
(function () {
  'use strict';

  const VERSION = '1.0.1';

  // ─── i18n ───────────────────────────────────────────────────
  // Fixed UI chrome only (field labels, the swap control, the rates status and
  // updated prefix, and the load-failure message). Currency names and codes are
  // a data list and stay in their canonical form. The author-set heading and
  // note are content, translated separately, but fall back to a localised
  // default when the author leaves them blank. English is the source + fallback.
  const MESSAGES = {
    en: { heading: 'Currency converter', amount: 'Amount', from: 'From', to: 'To', fromCurrency: 'From currency', toCurrency: 'To currency', swap: 'Swap currencies', liveRates: 'Live rates', indicativeRates: 'Indicative rates', ratesPrefix: 'ECB', note: 'Rates are indicative and for guidance only.', loadError: 'Unable to load Currency widget' },
    fr: { heading: 'Convertisseur de devises', amount: 'Montant', from: 'De', to: 'À', fromCurrency: 'Devise de départ', toCurrency: 'Devise d’arrivée', swap: 'Inverser les devises', liveRates: 'Taux en direct', indicativeRates: 'Taux indicatifs', ratesPrefix: 'BCE', note: 'Les taux sont indicatifs et fournis à titre informatif uniquement.', loadError: 'Impossible de charger le convertisseur de devises' },
    de: { heading: 'Währungsrechner', amount: 'Betrag', from: 'Von', to: 'Nach', fromCurrency: 'Ausgangswährung', toCurrency: 'Zielwährung', swap: 'Währungen tauschen', liveRates: 'Live-Kurse', indicativeRates: 'Indikative Kurse', ratesPrefix: 'EZB', note: 'Die Kurse sind indikativ und dienen nur zur Orientierung.', loadError: 'Währungsrechner konnte nicht geladen werden' },
    es: { heading: 'Conversor de divisas', amount: 'Cantidad', from: 'De', to: 'A', fromCurrency: 'Divisa de origen', toCurrency: 'Divisa de destino', swap: 'Intercambiar monedas', liveRates: 'Tipos en directo', indicativeRates: 'Tipos indicativos', ratesPrefix: 'BCE', note: 'Los tipos son indicativos y solo a título orientativo.', loadError: 'No se pudo cargar el conversor de divisas' },
    it: { heading: 'Convertitore di valuta', amount: 'Importo', from: 'Da', to: 'A', fromCurrency: 'Valuta di partenza', toCurrency: 'Valuta di arrivo', swap: 'Inverti valute', liveRates: 'Tassi in tempo reale', indicativeRates: 'Tassi indicativi', ratesPrefix: 'BCE', note: 'I tassi sono indicativi e forniti solo a scopo informativo.', loadError: 'Impossibile caricare il convertitore di valuta' },
    ro: { heading: 'Convertor valutar', amount: 'Sumă', from: 'Din', to: 'În', fromCurrency: 'Valuta de plecare', toCurrency: 'Valuta de destinație', swap: 'Inversează valutele', liveRates: 'Cursuri în direct', indicativeRates: 'Cursuri indicative', ratesPrefix: 'BCE', note: 'Cursurile sunt indicative și au doar scop informativ.', loadError: 'Convertorul valutar nu a putut fi încărcat' },
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

  function resolveBase(path) {
    if (typeof window === 'undefined') return path;
    try {
      const me = document.currentScript;
      if (me && me.src) return new URL(me.src).origin + path;
      const scripts = document.getElementsByTagName('script');
      for (let i = scripts.length - 1; i >= 0; i--) {
        const s = scripts[i].src || '';
        if (/\/widget-currency\.js(\?|$|#)/.test(s)) return new URL(s).origin + path;
      }
    } catch (e) { /* fall through */ }
    return path;
  }
  const CONFIG_API = resolveBase('/api/widget-config');
  const FX_API = resolveBase('/api/fx-rates');

  // Code → display name. Mirrors the server allowlist in api/fx-rates.js.
  const NAMES = {
    AUD: 'Australian Dollar', BGN: 'Bulgarian Lev', BRL: 'Brazilian Real',
    CAD: 'Canadian Dollar', CHF: 'Swiss Franc', CNY: 'Chinese Yuan',
    CZK: 'Czech Koruna', DKK: 'Danish Krone', EUR: 'Euro', GBP: 'British Pound',
    HKD: 'Hong Kong Dollar', HUF: 'Hungarian Forint', IDR: 'Indonesian Rupiah',
    ILS: 'Israeli Shekel', INR: 'Indian Rupee', ISK: 'Icelandic Krona',
    JPY: 'Japanese Yen', KRW: 'South Korean Won', MXN: 'Mexican Peso',
    MYR: 'Malaysian Ringgit', NOK: 'Norwegian Krone', NZD: 'New Zealand Dollar',
    PHP: 'Philippine Peso', PLN: 'Polish Zloty', RON: 'Romanian Leu',
    SEK: 'Swedish Krona', SGD: 'Singapore Dollar', THB: 'Thai Baht',
    TRY: 'Turkish Lira', USD: 'US Dollar', ZAR: 'South African Rand',
  };

  // Small fallback table (relative to GBP) so the preview and offline cases
  // still render. Clearly indicative, never presented as live.
  const FALLBACK_GBP = {
    GBP: 1, EUR: 1.17, USD: 1.27, AUD: 1.93, CAD: 1.73, CHF: 1.13, JPY: 199,
    NZD: 2.10, ZAR: 23.2, SGD: 1.71, THB: 46.5, INR: 106,
  };

  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hexOk = (v) => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(v || '').trim());

  // Two-letter regional-indicator flag from the currency's country prefix.
  function flagFor(code) {
    const cc = String(code || '').slice(0, 2).toUpperCase();
    if (!/^[A-Z]{2}$/.test(cc)) return '';
    return String.fromCodePoint(...[...cc].map(ch => 0x1F1E6 + ch.charCodeAt(0) - 65));
  }

  class TGCurrencyWidget {
    constructor(el, config) {
      this.el = el;
      this.cfg = this._defaults(config || {});
      this.t = makeT(this.cfg);   // resolve viewer language + UI strings
      this.rates = null;       // { base, rates:{...}, date }
      this.live = false;
      this.amount = Number(this.cfg.defaultAmount) || 0;
      this.from = this.cfg.defaultFrom;
      this.to = this.cfg.defaultTo;
      this.shadow = el.attachShadow ? el.attachShadow({ mode: 'open' }) : el;
      el.setAttribute('data-tg-initialised', '1');
      this._build();
      this._loadRates();
    }

    _defaults(c) {
      let list = Array.isArray(c.currencies) && c.currencies.length
        ? c.currencies.map(x => String(x).toUpperCase()).filter(x => NAMES[x])
        : ['GBP', 'EUR', 'USD', 'AUD', 'CAD', 'CHF', 'JPY', 'NZD'];
      list = [...new Set(list)];
      if (list.length < 2) list = ['GBP', 'EUR'];
      const base = NAMES[String(c.baseCurrency || '').toUpperCase()] ? String(c.baseCurrency).toUpperCase() : list[0];
      const ensure = (v, fb) => (NAMES[String(v || '').toUpperCase()] && list.includes(String(v).toUpperCase())) ? String(v).toUpperCase() : fb;
      const from = ensure(c.defaultFrom, base);
      const to = ensure(c.defaultTo, list.find(x => x !== from) || list[0]);
      return {
        heading: typeof c.heading === 'string' ? c.heading : '',
        baseCurrency: base,
        currencies: list,
        defaultFrom: from,
        defaultTo: to,
        defaultAmount: Number.isFinite(Number(c.defaultAmount)) ? Number(c.defaultAmount) : 100,
        decimals: Math.max(0, Math.min(4, Number.isFinite(Number(c.decimals)) ? Number(c.decimals) : 2)),
        accent: hexOk(c.accent) ? c.accent : '#0891B2',
        layout: c.layout === 'inline' ? 'inline' : 'card',
        showFlags: c.showFlags !== false,
        showRate: c.showRate !== false,
        showUpdated: c.showUpdated !== false,
        theme: c.theme === 'dark' ? 'dark' : 'light',
        fontFamily: typeof c.fontFamily === 'string' && c.fontFamily ? c.fontFamily : 'Inter, system-ui, sans-serif',
        note: typeof c.note === 'string' ? c.note : '',
        previewMode: !!c.previewMode,
        fxData: (c.fxData && typeof c.fxData === 'object') ? c.fxData : null,
      };
    }

    _opt(sel, code) {
      const f = this.cfg.showFlags ? (flagFor(code) + ' ') : '';
      return `<option value="${code}"${code === sel ? ' selected' : ''}>${esc(f + code + ' · ' + (NAMES[code] || code))}</option>`;
    }

    _build() {
      const c = this.cfg;
      const dark = c.theme === 'dark';
      const ink = dark ? '#F1F5F9' : '#0F172A';
      const ink2 = dark ? '#94A3B8' : '#64748B';
      const panel = dark ? '#0B1220' : '#FFFFFF';
      const field = dark ? '#0F172A' : '#FFFFFF';
      const border = dark ? '#1E293B' : '#E2E8F0';
      const opts = c.currencies.map(code => ({ from: this._opt(this.from, code), to: this._opt(this.to, code) }));
      const card = c.layout === 'card';
      const t = this.t;
      // Author content with a localised default when left blank.
      const heading = c.heading || t('heading');
      const note = c.note || t('note');
      this.shadow.innerHTML = `
        <style>
          :host { all: initial; }
          * { box-sizing: border-box; }
          .tgc { font-family: ${c.fontFamily}; color: ${ink}; ${card ? `background:${panel};border:1px solid ${border};border-radius:16px;padding:22px 22px 18px;box-shadow:0 1px 3px rgba(15,23,42,.06),0 10px 30px rgba(15,23,42,.04);` : ''} max-width: 460px; }
          .tgc-head { font-size: 17px; font-weight: 700; margin: 0 0 14px; letter-spacing: -.01em; }
          .tgc-amtrow { margin: 0 0 10px; }
          .tgc-row { display: grid; grid-template-columns: 1fr auto 1fr; gap: 8px; align-items: end; }
          .tgc-amtrow label, .tgc-cell label { display:block; font-size: 11px; font-weight:600; color:${ink2}; margin:0 0 5px; letter-spacing:.02em; }
          .tgc-amt, .tgc-sel { width:100%; font:inherit; font-size:14px; padding:10px 11px; border:1px solid ${border}; border-radius:10px; background:${field}; color:${ink}; }
          .tgc-amt:focus, .tgc-sel:focus { outline:none; border-color:${c.accent}; box-shadow:0 0 0 3px ${c.accent}22; }
          .tgc-sel { appearance:none; -webkit-appearance:none; cursor:pointer; background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E"); background-repeat:no-repeat; background-position:right 9px center; padding-right:30px; }
          .tgc-swap { align-self:end; margin-bottom:1px; width:38px; height:40px; border:1px solid ${border}; background:${field}; color:${c.accent}; border-radius:10px; cursor:pointer; display:flex; align-items:center; justify-content:center; transition:background .15s ease; }
          .tgc-swap:hover { background:${c.accent}14; }
          .tgc-swap svg { width:17px; height:17px; }
          .tgc-out { margin:16px 0 0; padding:14px 16px; background:${dark ? '#0F172A' : '#F8FAFC'}; border:1px solid ${border}; border-radius:12px; }
          .tgc-result { font-size:24px; font-weight:800; letter-spacing:-.02em; line-height:1.1; }
          .tgc-rate { font-size:12px; color:${ink2}; margin-top:5px; }
          .tgc-foot { display:flex; justify-content:space-between; gap:10px; margin-top:10px; font-size:11px; color:${ink2}; }
          .tgc-live { display:inline-flex; align-items:center; gap:5px; }
          .tgc-dot { width:7px; height:7px; border-radius:999px; background:#10B981; display:inline-block; }
          .tgc-dot.is-stale { background:#F59E0B; }
          .tgc-note { margin-top:9px; font-size:11px; color:${ink2}; line-height:1.45; }
          @media (max-width: 380px){ .tgc-row { grid-template-columns:1fr; } .tgc-swap { width:100%; transform:rotate(90deg); margin:2px 0; } }
        </style>
        <div class="tgc">
          ${heading ? `<h3 class="tgc-head">${esc(heading)}</h3>` : ''}
          <div class="tgc-amtrow">
            <label for="amt">${esc(t('amount'))}</label>
            <input class="tgc-amt" id="amt" type="number" inputmode="decimal" min="0" step="any" value="${esc(this.amount)}" aria-label="${esc(t('amount'))}">
          </div>
          <div class="tgc-row">
            <div class="tgc-cell"><label for="from">${esc(t('from'))}</label><select class="tgc-sel" id="from" aria-label="${esc(t('fromCurrency'))}">${opts.map(o => o.from).join('')}</select></div>
            <button class="tgc-swap" id="swap" title="${esc(t('swap'))}" aria-label="${esc(t('swap'))}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg></button>
            <div class="tgc-cell"><label for="to">${esc(t('to'))}</label><select class="tgc-sel" id="to" aria-label="${esc(t('toCurrency'))}">${opts.map(o => o.to).join('')}</select></div>
          </div>
          <div class="tgc-out">
            <div class="tgc-result" id="result">—</div>
            ${c.showRate ? '<div class="tgc-rate" id="rate"></div>' : ''}
            ${(c.showUpdated) ? '<div class="tgc-foot"><span class="tgc-live" id="live"></span><span id="updated"></span></div>' : ''}
          </div>
          ${note ? `<div class="tgc-note">${esc(note)}</div>` : ''}
        </div>`;
      this._wire();
    }

    _wire() {
      const sh = this.shadow;
      const amt = sh.getElementById('amt');
      const from = sh.getElementById('from');
      const to = sh.getElementById('to');
      const swap = sh.getElementById('swap');
      amt.addEventListener('input', () => { this.amount = Math.max(0, Number(amt.value) || 0); this._compute(); });
      from.addEventListener('change', () => { this.from = from.value; this._compute(); });
      to.addEventListener('change', () => { this.to = to.value; this._compute(); });
      swap.addEventListener('click', () => {
        const a = this.from; this.from = this.to; this.to = a;
        from.value = this.from; to.value = this.to; this._compute();
      });
    }

    _loadRates() {
      // Editor can inject a rates table to avoid a network call.
      if (this.cfg.fxData && this.cfg.fxData.rates) {
        this.rates = this.cfg.fxData; this.live = true; this._compute(); return;
      }
      const base = this.cfg.baseCurrency;
      const symbols = this.cfg.currencies.filter(c => c !== base).join(',');
      fetch(FX_API + '?base=' + encodeURIComponent(base) + '&symbols=' + encodeURIComponent(symbols), { credentials: 'omit' })
        .then(r => r.ok ? r.json() : null)
        .then(d => {
          if (d && d.ok && d.rates) { this.rates = d; this.live = true; }
          else this._useFallback();
          this._compute();
        })
        .catch(() => { this._useFallback(); this._compute(); });
    }

    _useFallback() {
      // Build a rate table in the configured base from the GBP fallback.
      const base = this.cfg.baseCurrency;
      const g = FALLBACK_GBP;
      const baseInGbp = g[base] || 1;
      const rates = {};
      this.cfg.currencies.forEach(code => { if (g[code]) rates[code] = g[code] / baseInGbp; });
      rates[base] = 1;
      this.rates = { base, rates, date: '' };
      this.live = false;
    }

    _rate(code) {
      if (!this.rates || !this.rates.rates) return null;
      const v = this.rates.rates[code];
      return (Number.isFinite(v) && v > 0) ? v : (code === this.rates.base ? 1 : null);
    }

    _fmt(value, code) {
      try {
        return new Intl.NumberFormat(undefined, { style: 'currency', currency: code, minimumFractionDigits: this.cfg.decimals, maximumFractionDigits: this.cfg.decimals }).format(value);
      } catch (e) {
        return value.toFixed(this.cfg.decimals) + ' ' + code;
      }
    }

    _compute() {
      const sh = this.shadow;
      const resultEl = sh.getElementById('result');
      const rateEl = sh.getElementById('rate');
      const liveEl = sh.getElementById('live');
      const updEl = sh.getElementById('updated');
      const rf = this._rate(this.from), rt = this._rate(this.to);
      if (!resultEl) return;
      if (rf == null || rt == null) { resultEl.textContent = '—'; if (rateEl) rateEl.textContent = ''; return; }
      const factor = rt / rf;
      resultEl.textContent = this._fmt(this.amount * factor, this.to);
      if (rateEl) rateEl.textContent = '1 ' + this.from + ' = ' + this._fmt(factor, this.to);
      if (liveEl) {
        const stale = !this.live;
        liveEl.innerHTML = '<span class="tgc-dot' + (stale ? ' is-stale' : '') + '"></span>' + esc(stale ? this.t('indicativeRates') : this.t('liveRates'));
      }
      if (updEl) {
        const d = this.rates && this.rates.date;
        updEl.textContent = this.live && d ? (this.t('ratesPrefix') + ' ' + d) : '';
      }
    }

    update(config) { this.cfg = this._defaults(config || {}); this.t = makeT(this.cfg); this.from = this.cfg.defaultFrom; this.to = this.cfg.defaultTo; this.amount = Number(this.cfg.defaultAmount) || 0; this._build(); this._loadRates(); }

    destroy() { try { this.shadow.innerHTML = ''; } catch (e) {} try { this.el.removeAttribute('data-tg-initialised'); } catch (e) {} }
  }

  async function init() {
    if (typeof document === 'undefined') return;
    const nodes = document.querySelectorAll('[data-tg-widget="currency"]:not([data-tg-initialised])');
    for (const el of nodes) {
      try {
        const inline = el.getAttribute('data-tg-config');
        if (inline) { let cfg = {}; try { cfg = JSON.parse(inline); } catch { cfg = {}; } new TGCurrencyWidget(el, cfg); continue; }
        const id = el.getAttribute('data-tg-id');
        if (id) {
          const res = await fetch(CONFIG_API + '?id=' + encodeURIComponent(id), { credentials: 'omit' });
          if (!res.ok) throw new Error('config ' + res.status);
          const data = await res.json();
          const cfg = (data && (data.config || data)) || {};
          cfg.widgetId = id;
          new TGCurrencyWidget(el, cfg);
          continue;
        }
        console.warn('[TG Currency] Container has neither data-tg-id nor data-tg-config');
      } catch (err) {
        console.error('[TG Currency] Failed to initialise:', err);
        try {
          const msg = makeT(null)('loadError');
          el.innerHTML = '<p style="color:#64748b;font:14px/1.5 system-ui,sans-serif;padding:16px;text-align:center;border:1px dashed #e2e8f0;border-radius:8px;margin:0">' + esc(msg) + '</p>';
        } catch (e) {}
      }
    }
  }

  if (typeof window !== 'undefined') { window.TGCurrencyWidget = TGCurrencyWidget; window.__TG_CURRENCY_VERSION__ = VERSION; }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
    if (typeof MutationObserver !== 'undefined') {
      try {
        let scheduled = false;
        const schedule = () => { if (scheduled) return; scheduled = true; setTimeout(() => { scheduled = false; init(); }, 120); };
        const mo = new MutationObserver((records) => {
          for (const r of records) for (const node of r.addedNodes) {
            if (node.nodeType !== 1) continue;
            if ((node.matches && node.matches('[data-tg-widget="currency"]:not([data-tg-initialised])')) ||
                (node.querySelector && node.querySelector('[data-tg-widget="currency"]:not([data-tg-initialised])'))) { schedule(); return; }
          }
        });
        mo.observe(document.body || document.documentElement, { childList: true, subtree: true });
      } catch (e) { /* noop */ }
    }
  }
})();
