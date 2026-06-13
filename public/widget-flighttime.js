/**
 * Travelgenix Flight Time & Distance Widget v1.0.0
 * Self-contained, embeddable. Pick two airports and get the great-circle
 * distance and an approximate flight time. Zero dependencies, Shadow DOM
 * isolation, no API and no key — airport coordinates are bundled and the maths
 * runs in the browser.
 *
 * Usage (remote config, default):
 *   <div data-tg-widget="flighttime" data-tg-id="YOUR_WIDGET_ID"></div>
 *   <script src="https://tg-widgets.vercel.app/widget-flighttime.js"></script>
 *
 * Usage (inline config, editor preview):
 *   <div data-tg-widget="flighttime" data-tg-config='{...}'></div>
 *   <script src="https://tg-widgets.vercel.app/widget-flighttime.js"></script>
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
        if (/\/widget-flighttime\.js(\?|$|#)/.test(s)) return new URL(s).origin + '/api/widget-config';
      }
    } catch (e) { /* fall through */ }
    return '/api/widget-config';
  }
  const CONFIG_API = resolveConfigApi();

  // Bundled airports: IATA -> [name, countryCode, lat, lon]. Curated for the
  // routes UK travel agencies sell most.
  const AIRPORTS = {
    LHR:['London Heathrow','GB',51.4700,-0.4543], LGW:['London Gatwick','GB',51.1537,-0.1821],
    MAN:['Manchester','GB',53.3537,-2.2750], STN:['London Stansted','GB',51.8860,0.2389],
    LTN:['London Luton','GB',51.8747,-0.3683], EDI:['Edinburgh','GB',55.9500,-3.3725],
    BHX:['Birmingham','GB',52.4539,-1.7480], GLA:['Glasgow','GB',55.8719,-4.4331],
    BRS:['Bristol','GB',51.3827,-2.7191], NCL:['Newcastle','GB',55.0375,-1.6917],
    BFS:['Belfast','GB',54.6575,-6.2158], LPL:['Liverpool','GB',53.3336,-2.8497],
    CDG:['Paris Charles de Gaulle','FR',49.0097,2.5479], ORY:['Paris Orly','FR',48.7233,2.3794],
    AMS:['Amsterdam','NL',52.3105,4.7683], FRA:['Frankfurt','DE',50.0379,8.5622],
    MUC:['Munich','DE',48.3538,11.7861], MAD:['Madrid','ES',40.4719,-3.5626],
    BCN:['Barcelona','ES',41.2974,2.0833], AGP:['Malaga','ES',36.6749,-4.4991],
    PMI:['Palma, Mallorca','ES',39.5517,2.7388], ALC:['Alicante','ES',38.2822,-0.5582],
    FCO:['Rome Fiumicino','IT',41.8003,12.2389], MXP:['Milan Malpensa','IT',45.6306,8.7281],
    VCE:['Venice','IT',45.5053,12.3519], LIS:['Lisbon','PT',38.7742,-9.1342],
    OPO:['Porto','PT',41.2481,-8.6814], FAO:['Faro','PT',37.0144,-7.9659],
    DUB:['Dublin','IE',53.4213,-6.2701], ATH:['Athens','GR',37.9364,23.9445],
    HER:['Heraklion, Crete','GR',35.3397,25.1803], RHO:['Rhodes','GR',36.4054,28.0862],
    IST:['Istanbul','TR',41.2753,28.7519], AYT:['Antalya','TR',36.8987,30.8005],
    VIE:['Vienna','AT',48.1103,16.5697], ZRH:['Zurich','CH',47.4647,8.5492],
    GVA:['Geneva','CH',46.2381,6.1090], CPH:['Copenhagen','DK',55.6180,12.6508],
    OSL:['Oslo','NO',60.1939,11.1004], ARN:['Stockholm','SE',59.6519,17.9186],
    HEL:['Helsinki','FI',60.3172,24.9633], PRG:['Prague','CZ',50.1008,14.2600],
    KEF:['Reykjavik','IS',63.9850,-22.6056], TFS:['Tenerife South','ES',28.0445,-16.5725],
    LPA:['Gran Canaria','ES',27.9319,-15.3866], ACE:['Lanzarote','ES',28.9455,-13.6052],
    FNC:['Funchal, Madeira','PT',32.6979,-16.7745], MLA:['Malta','MT',35.8575,14.4775],
    NCE:['Nice','FR',43.6584,7.2159],
    DXB:['Dubai','AE',25.2532,55.3657], AUH:['Abu Dhabi','AE',24.4330,54.6511],
    DOH:['Doha','QA',25.2731,51.6080], RUH:['Riyadh','SA',24.9576,46.6988],
    JED:['Jeddah','SA',21.6796,39.1565], TLV:['Tel Aviv','IL',32.0114,34.8867],
    SIN:['Singapore','SG',1.3644,103.9915], HKG:['Hong Kong','HK',22.3080,113.9185],
    BKK:['Bangkok','TH',13.6900,100.7501], HKT:['Phuket','TH',8.1132,98.3169],
    KUL:['Kuala Lumpur','MY',2.7456,101.7099], DPS:['Bali (Denpasar)','ID',-8.7482,115.1672],
    CGK:['Jakarta','ID',-6.1256,106.6559], NRT:['Tokyo Narita','JP',35.7720,140.3929],
    HND:['Tokyo Haneda','JP',35.5494,139.7798], ICN:['Seoul Incheon','KR',37.4602,126.4407],
    PEK:['Beijing','CN',40.0799,116.6031], PVG:['Shanghai Pudong','CN',31.1443,121.8083],
    DEL:['Delhi','IN',28.5562,77.1000], BOM:['Mumbai','IN',19.0896,72.8656],
    MLE:['Malé, Maldives','MV',4.1918,73.5291], CMB:['Colombo','LK',7.1808,79.8841],
    CPT:['Cape Town','ZA',-33.9690,18.6017], JNB:['Johannesburg','ZA',-26.1392,28.2460],
    CAI:['Cairo','EG',30.1219,31.4056], RAK:['Marrakesh','MA',31.6069,-8.0363],
    NBO:['Nairobi','KE',-1.3192,36.9278], MRU:['Mauritius','MU',-20.4302,57.6836],
    SEZ:['Seychelles','SC',-4.6743,55.5218],
    JFK:['New York JFK','US',40.6413,-73.7781], EWR:['Newark','US',40.6895,-74.1745],
    LAX:['Los Angeles','US',33.9416,-118.4085], SFO:['San Francisco','US',37.6213,-122.3790],
    ORD:['Chicago','US',41.9742,-87.9073], MIA:['Miami','US',25.7959,-80.2870],
    MCO:['Orlando','US',28.4312,-81.3081], LAS:['Las Vegas','US',36.0840,-115.1537],
    BOS:['Boston','US',42.3656,-71.0096], YYZ:['Toronto','CA',43.6777,-79.6248],
    YVR:['Vancouver','CA',49.1947,-123.1792],
    CUN:['Cancun','MX',21.0365,-86.8771], MBJ:['Montego Bay','JM',18.5037,-77.9134],
    BGI:['Barbados','BB',13.0746,-59.4925], PUJ:['Punta Cana','DO',18.5674,-68.3634],
    NAS:['Nassau','BS',25.0390,-77.4662], ANU:['Antigua','AG',17.1367,-61.7927],
    GCM:['Grand Cayman','KY',19.2928,-81.3577], GIG:['Rio de Janeiro','BR',-22.8090,-43.2506],
    GRU:['São Paulo','BR',-23.4356,-46.4731], EZE:['Buenos Aires','AR',-34.8222,-58.5358],
    LIM:['Lima','PE',-12.0219,-77.1143],
    SYD:['Sydney','AU',-33.9399,151.1753], MEL:['Melbourne','AU',-37.6690,144.8410],
    BNE:['Brisbane','AU',-27.3842,153.1175], PER:['Perth','AU',-31.9385,115.9672],
    AKL:['Auckland','NZ',-37.0082,174.7850], NAN:['Nadi, Fiji','FJ',-17.7554,177.4434],
  };

  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hexOk = (v) => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(v || '').trim());

  function flagFor(cc) {
    const c = String(cc || '').slice(0, 2).toUpperCase();
    if (!/^[A-Z]{2}$/.test(c)) return '';
    return String.fromCodePoint(...[...c].map(ch => 0x1F1E6 + ch.charCodeAt(0) - 65));
  }

  // Great-circle distance in km (haversine).
  function haversineKm(a, b) {
    const R = 6371;
    const toRad = d => d * Math.PI / 180;
    const dLat = toRad(b[2] - a[2]);
    const dLon = toRad(b[3] - a[3]);
    const lat1 = toRad(a[2]), lat2 = toRad(b[2]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  // Approximate block time: cruise at an effective speed plus a fixed overhead
  // for taxi, climb, descent and approach. Deliberately labelled approximate.
  function flightHours(km, speed) {
    const s = speed > 200 ? speed : 800;
    return Math.max(0.5, km / s + 0.5);
  }

  function fmtHours(h) {
    const total = Math.round(h * 60 / 5) * 5; // round to 5 min
    const hh = Math.floor(total / 60), mm = total % 60;
    return hh + 'h' + (mm ? ' ' + mm + 'm' : '');
  }

  const COMMAS = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  class TGFlightTimeWidget {
    constructor(el, config) {
      this.el = el;
      this.cfg = this._defaults(config || {});
      this.from = this.cfg.defaultFrom;
      this.to = this.cfg.defaultTo;
      this.shadow = el.attachShadow ? el.attachShadow({ mode: 'open' }) : el;
      el.setAttribute('data-tg-initialised', '1');
      this._build();
      this._compute();
    }

    _validCode(c) { const k = String(c || '').toUpperCase(); return AIRPORTS[k] ? k : ''; }

    _defaults(c) {
      const from = this._validCode(c.defaultFrom) || 'LHR';
      let to = this._validCode(c.defaultTo) || 'JFK';
      if (to === from) to = from === 'LHR' ? 'JFK' : 'LHR';
      return {
        heading: typeof c.heading === 'string' ? c.heading : 'Flight time & distance',
        defaultFrom: from,
        defaultTo: to,
        units: ['km', 'mi', 'both'].includes(c.units) ? c.units : 'both',
        cruiseSpeed: Number.isFinite(Number(c.cruiseSpeed)) && Number(c.cruiseSpeed) > 200 ? Number(c.cruiseSpeed) : 800,
        accent: hexOk(c.accent) ? c.accent : '#0891B2',
        layout: c.layout === 'inline' ? 'inline' : 'card',
        showFlags: c.showFlags !== false,
        showTime: c.showTime !== false,
        theme: c.theme === 'dark' ? 'dark' : 'light',
        fontFamily: typeof c.fontFamily === 'string' && c.fontFamily ? c.fontFamily : 'Inter, system-ui, sans-serif',
        previewMode: !!c.previewMode,
      };
    }

    _options(sel) {
      // Sorted by city/name for an easy-to-scan dropdown.
      return Object.keys(AIRPORTS)
        .sort((a, b) => AIRPORTS[a][0].localeCompare(AIRPORTS[b][0]))
        .map(code => {
          const a = AIRPORTS[code];
          const f = this.cfg.showFlags ? (flagFor(a[1]) + ' ') : '';
          return `<option value="${code}"${code === sel ? ' selected' : ''}>${esc(f + a[0] + ' (' + code + ')')}</option>`;
        }).join('');
    }

    _build() {
      const c = this.cfg;
      const dark = c.theme === 'dark';
      const ink = dark ? '#F1F5F9' : '#0F172A';
      const ink2 = dark ? '#94A3B8' : '#64748B';
      const panel = dark ? '#0B1220' : '#FFFFFF';
      const field = dark ? '#0F172A' : '#FFFFFF';
      const border = dark ? '#1E293B' : '#E2E8F0';
      const out = dark ? '#0F172A' : '#F8FAFC';
      const card = c.layout === 'card';

      this.shadow.innerHTML = `
        <style>
          :host { all: initial; }
          * { box-sizing: border-box; }
          .ft { font-family: ${c.fontFamily}; color: ${ink}; ${card ? `background:${panel};border:1px solid ${border};border-radius:16px;padding:22px;box-shadow:0 1px 3px rgba(15,23,42,.06),0 10px 30px rgba(15,23,42,.04);` : ''} max-width: 480px; }
          .ft-head { font-size: 17px; font-weight: 700; margin: 0 0 14px; letter-spacing: -.01em; }
          .ft-row { display: grid; grid-template-columns: 1fr auto 1fr; gap: 8px; align-items: end; }
          .ft-cell label { display:block; font-size: 11px; font-weight:600; color:${ink2}; margin:0 0 5px; letter-spacing:.02em; }
          .ft-sel { width:100%; font:inherit; font-size:13px; padding:10px 11px; border:1px solid ${border}; border-radius:10px; background:${field}; color:${ink}; appearance:none; -webkit-appearance:none; cursor:pointer; background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E"); background-repeat:no-repeat; background-position:right 9px center; padding-right:30px; }
          .ft-sel:focus { outline:none; border-color:${c.accent}; box-shadow:0 0 0 3px ${c.accent}22; }
          .ft-swap { align-self:end; margin-bottom:1px; width:38px; height:40px; border:1px solid ${border}; background:${field}; color:${c.accent}; border-radius:10px; cursor:pointer; display:flex; align-items:center; justify-content:center; transition:background .15s ease; }
          .ft-swap:hover { background:${c.accent}14; }
          .ft-swap svg { width:17px; height:17px; }
          .ft-out { margin:16px 0 0; padding:16px; background:${out}; border:1px solid ${border}; border-radius:12px; text-align:center; }
          .ft-route { font-size:12px; color:${ink2}; margin-bottom:8px; }
          .ft-dist { font-size:26px; font-weight:800; letter-spacing:-.02em; line-height:1.05; }
          .ft-time { font-size:13px; color:${ink2}; margin-top:7px; }
          .ft-time b { color:${ink}; font-weight:700; }
          .ft-note { margin-top:9px; font-size:11px; color:${ink2}; line-height:1.45; }
          @media (max-width: 380px){ .ft-row { grid-template-columns:1fr; } .ft-swap { width:100%; transform:rotate(90deg); margin:2px 0; } }
        </style>
        <div class="ft">
          ${c.heading ? `<h3 class="ft-head">${esc(c.heading)}</h3>` : ''}
          <div class="ft-row">
            <div class="ft-cell"><label for="from">From</label><select class="ft-sel" id="from" aria-label="From airport">${this._options(this.from)}</select></div>
            <button class="ft-swap" id="swap" title="Swap airports" aria-label="Swap airports"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg></button>
            <div class="ft-cell"><label for="to">To</label><select class="ft-sel" id="to" aria-label="To airport">${this._options(this.to)}</select></div>
          </div>
          <div class="ft-out">
            <div class="ft-route" id="route"></div>
            <div class="ft-dist" id="dist">—</div>
            ${c.showTime ? '<div class="ft-time" id="time"></div>' : ''}
          </div>
          <div class="ft-note">Distance is the direct great-circle route. Flight time is approximate and excludes connections.</div>
        </div>`;
      this._wire();
    }

    _wire() {
      const sh = this.shadow;
      const from = sh.getElementById('from'), to = sh.getElementById('to'), swap = sh.getElementById('swap');
      from.addEventListener('change', () => { this.from = from.value; this._compute(); });
      to.addEventListener('change', () => { this.to = to.value; this._compute(); });
      swap.addEventListener('click', () => {
        const a = this.from; this.from = this.to; this.to = a;
        from.value = this.from; to.value = this.to; this._compute();
      });
    }

    _compute() {
      const sh = this.shadow;
      const a = AIRPORTS[this.from], b = AIRPORTS[this.to];
      const distEl = sh.getElementById('dist'), routeEl = sh.getElementById('route'), timeEl = sh.getElementById('time');
      if (!distEl) return;
      if (!a || !b) { distEl.textContent = '—'; return; }
      if (this.from === this.to) {
        routeEl.textContent = a[0] + ' (' + this.from + ')';
        distEl.textContent = '0 km';
        if (timeEl) timeEl.textContent = '';
        return;
      }
      const km = haversineKm(a, b);
      const mi = km * 0.621371;
      routeEl.textContent = a[0] + ' (' + this.from + ')  →  ' + b[0] + ' (' + this.to + ')';
      const kmTxt = COMMAS(Math.round(km)) + ' km';
      const miTxt = COMMAS(Math.round(mi)) + ' mi';
      distEl.textContent = this.cfg.units === 'km' ? kmTxt : this.cfg.units === 'mi' ? miTxt : (kmTxt + ' · ' + miTxt);
      if (timeEl) timeEl.innerHTML = 'Approx. flight time <b>' + fmtHours(flightHours(km, this.cfg.cruiseSpeed)) + '</b>';
    }

    update(config) { this.cfg = this._defaults(config || {}); this.from = this.cfg.defaultFrom; this.to = this.cfg.defaultTo; this._build(); this._compute(); }

    destroy() { try { this.shadow.innerHTML = ''; } catch (e) {} try { this.el.removeAttribute('data-tg-initialised'); } catch (e) {} }
  }

  // Expose the class and the airport table so the editor can share one source.
  TGFlightTimeWidget.AIRPORTS = AIRPORTS;

  async function init() {
    if (typeof document === 'undefined') return;
    const nodes = document.querySelectorAll('[data-tg-widget="flighttime"]:not([data-tg-initialised])');
    for (const el of nodes) {
      try {
        const inline = el.getAttribute('data-tg-config');
        if (inline) { let cfg = {}; try { cfg = JSON.parse(inline); } catch { cfg = {}; } new TGFlightTimeWidget(el, cfg); continue; }
        const id = el.getAttribute('data-tg-id');
        if (id) {
          const res = await fetch(CONFIG_API + '?id=' + encodeURIComponent(id), { credentials: 'omit' });
          if (!res.ok) throw new Error('config ' + res.status);
          const data = await res.json();
          const cfg = (data && (data.config || data)) || {};
          cfg.widgetId = id;
          new TGFlightTimeWidget(el, cfg);
          continue;
        }
        console.warn('[TG Flight Time] Container has neither data-tg-id nor data-tg-config');
      } catch (err) {
        console.error('[TG Flight Time] Failed to initialise:', err);
        try { el.innerHTML = '<p style="color:#64748b;font:14px/1.5 system-ui,sans-serif;padding:16px;text-align:center;border:1px dashed #e2e8f0;border-radius:8px;margin:0">Unable to load Flight Time widget</p>'; } catch (e) {}
      }
    }
  }

  if (typeof window !== 'undefined') { window.TGFlightTimeWidget = TGFlightTimeWidget; window.__TG_FLIGHTTIME_VERSION__ = VERSION; }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
    if (typeof MutationObserver !== 'undefined') {
      try {
        let scheduled = false;
        const schedule = () => { if (scheduled) return; scheduled = true; setTimeout(() => { scheduled = false; init(); }, 120); };
        const mo = new MutationObserver((records) => {
          for (const r of records) for (const node of r.addedNodes) {
            if (node.nodeType !== 1) continue;
            if ((node.matches && node.matches('[data-tg-widget="flighttime"]:not([data-tg-initialised])')) ||
                (node.querySelector && node.querySelector('[data-tg-widget="flighttime"]:not([data-tg-initialised])'))) { schedule(); return; }
          }
        });
        mo.observe(document.body || document.documentElement, { childList: true, subtree: true });
      } catch (e) { /* noop */ }
    }
  }
})();
