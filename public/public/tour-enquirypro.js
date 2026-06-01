/* ============================================================================
   Enquiry Pro — guided product tour  v1.0.0
   ----------------------------------------------------------------------------
   Unlike the editor tours (which spotlight editor controls via tgse.tour and
   depend on editor-shell.js), Enquiry Pro's value is in the TRAVELLER FLOW, and
   it has no dedicated editor — it reuses the Enquiry Form config. So this is a
   self-contained PRODUCT tour: it drives the live widget through each step and
   spotlights what makes it better than the classic Enquiry Form.

   Standalone by design — no tgse / editor-shell dependency, so it runs on the
   public demo page. Mirrors the suite tour look: light scrim, brand spotlight
   ring, callout card. Brand colour read from the widget so it themes per client.

   Usage (added to demo-enquirypro.html):
     <script src="/tour-enquirypro.js"></script>
     <script> TGEnquiryProTour.mount({ getWidget: () => window.__epWidget }); </script>

   Public API:
     TGEnquiryProTour.start(opts)    // start immediately
     TGEnquiryProTour.mount(opts)    // add a launcher button + auto-offer once
   opts.getWidget()  -> the TGEnquiryProWidget instance to drive (required)
   opts.container    -> optional light-DOM element to spotlight (defaults to the
                        widget's host element)
   ============================================================================ */
(function () {
  'use strict';

  var DISMISS_KEY = 'tgep:tour-dismissed';
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ----- steps: each drives the widget to a step, then explains the difference
  var STEPS = [
    {
      widgetStep: 0,
      title: 'One tap to begin',
      body: 'The classic form opens with a wall of fields. Enquiry Pro opens with a single choice. Starting easy is the biggest reason multi-step forms convert far better — people who answer step one feel invested and carry on.'
    },
    {
      widgetStep: 1,
      title: 'A destination picker that knows travel',
      body: 'Start typing and it searches your live destination database — countries, cities and resorts — and still accepts free text for "somewhere sunny". Dates handle the real world too: exact, just-a-month, or fully flexible.'
    },
    {
      widgetStep: 2,
      title: 'Travellers, the way you quote',
      body: 'Adults, children with their ages, and rooms — captured as structured data, not a free-text box. Child ages flow straight through so you can price correctly first time.'
    },
    {
      widgetStep: 3,
      title: 'The details that qualify the lead',
      body: 'Budget slider, board basis, departure airport, and a flights toggle. It even adapts: a honeymoon asks for the wedding date, a ski trip asks ability level. Every answer is a qualified lead, not a casual enquiry.'
    },
    {
      widgetStep: 4,
      title: 'Contact last — and protected',
      body: 'Name, email and phone come only once someone is invested, with live validation, GDPR consent and optional Turnstile anti-spam. Then a warm, personal confirmation rather than a flat "thanks".'
    },
    {
      widgetStep: 0,
      title: 'Same inbox, better leads',
      body: 'Every enquiry lands in the exact same place as your Enquiry Form — no new setup, nothing to rewire. You just get richer, better-qualified leads from a flow built to convert.',
      last: true
    }
  ];

  // ----- styles
  var STYLE_ID = 'tgep-tour-styles';
  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style'); s.id = STYLE_ID;
    s.textContent = [
      '.tgept-veil{position:fixed;inset:0;z-index:2147483000;opacity:0;transition:opacity .25s ease;pointer-events:auto}',
      '.tgept-veil.on{opacity:1}',
      '.tgept-spot{position:fixed;z-index:2147483001;border-radius:20px;pointer-events:none;transition:all .42s cubic-bezier(.22,.61,.36,1);box-shadow:0 0 0 9999px rgba(10,15,28,.42),0 0 0 3px var(--tgept-ring,#0891B2),0 0 28px 6px var(--tgept-glow,rgba(8,145,178,.45))}',
      '.tgept-card{position:fixed;z-index:2147483002;width:min(360px,calc(100vw - 32px));background:#fff;border-radius:16px;box-shadow:0 28px 70px -22px rgba(0,0,0,.6);padding:20px 20px 16px;opacity:0;transform:translateY(8px);transition:opacity .25s ease,transform .25s ease;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}',
      '.tgept-card.on{opacity:1;transform:none}',
      '.tgept-step{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--tgept-ring,#0891B2);margin-bottom:7px}',
      '.tgept-title{font-size:18px;font-weight:700;color:#0F172A;letter-spacing:-.01em;margin-bottom:7px;line-height:1.25}',
      '.tgept-body{font-size:13.5px;color:#475569;line-height:1.55;margin-bottom:16px}',
      '.tgept-row{display:flex;align-items:center;gap:10px}',
      '.tgept-dots{display:flex;gap:5px;flex:1}',
      '.tgept-dot{width:6px;height:6px;border-radius:50%;background:#CBD5E1}',
      '.tgept-dot.on{background:var(--tgept-ring,#0891B2);transform:scale(1.25)}',
      '.tgept-btn{font:inherit;font-size:13px;font-weight:600;border-radius:999px;padding:9px 16px;cursor:pointer;border:1px solid transparent}',
      '.tgept-skip{background:none;border:none;color:#94A3B8;font:inherit;font-size:12.5px;font-weight:600;cursor:pointer;padding:8px}',
      '.tgept-skip:hover{color:#475569}',
      '.tgept-next{color:#fff;border:none;background:linear-gradient(135deg,var(--tgept-ring,#0891B2),var(--tgept-ring2,#0E7490));box-shadow:0 5px 14px -6px var(--tgept-glow,rgba(8,145,178,.6))}',
      '.tgept-next:active{transform:translateY(1px)}',
      /* welcome / done centred card */
      '.tgept-modal{position:fixed;inset:0;z-index:2147483002;display:flex;align-items:center;justify-content:center;padding:20px;opacity:0;transition:opacity .25s ease}',
      '.tgept-modal.on{opacity:1}',
      '.tgept-modal-card{width:min(420px,100%);background:#fff;border-radius:20px;box-shadow:0 40px 90px -28px rgba(0,0,0,.65);padding:30px 28px 24px;text-align:center;transform:scale(.96);transition:transform .3s cubic-bezier(.22,.61,.36,1)}',
      '.tgept-modal.on .tgept-modal-card{transform:none}',
      '.tgept-badge{width:60px;height:60px;border-radius:50%;margin:0 auto 16px;display:grid;place-items:center;background:var(--tgept-tint,rgba(8,145,178,.12));color:var(--tgept-ring,#0891B2)}',
      '.tgept-modal h2{font-size:22px;font-weight:700;color:#0F172A;letter-spacing:-.01em;margin-bottom:9px}',
      '.tgept-modal p{font-size:14px;color:#475569;line-height:1.55;margin:0 auto 20px;max-width:330px}',
      '.tgept-launch{position:fixed;right:18px;bottom:18px;z-index:2147482000;display:inline-flex;align-items:center;gap:8px;background:#fff;border:1px solid #E2E8F0;border-radius:999px;padding:10px 16px;font:inherit;font-size:13px;font-weight:600;color:#0F172A;cursor:pointer;box-shadow:0 12px 30px -12px rgba(15,23,42,.3)}',
      '.tgept-launch:hover{border-color:var(--tgept-ring,#0891B2)}',
      '.tgept-launch svg{color:var(--tgept-ring,#0891B2)}',
      '@media (prefers-reduced-motion:reduce){.tgept-veil,.tgept-spot,.tgept-card,.tgept-modal,.tgept-modal-card{transition:none}}'
    ].join('');
    document.head.appendChild(s);
  }

  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }

  // Read the widget's brand colour so the tour themes to match the client.
  function themeFrom(widget) {
    var ring = '#0891B2', ring2 = '#0E7490';
    try {
      var root = widget && widget.root;
      if (root) {
        var cs = getComputedStyle(root);
        ring = (cs.getPropertyValue('--brand') || ring).trim() || ring;
        ring2 = (cs.getPropertyValue('--brand-dark') || ring2).trim() || ring2;
      }
    } catch (e) {}
    var r = document.documentElement;
    r.style.setProperty('--tgept-ring', ring);
    r.style.setProperty('--tgept-ring2', ring2);
    r.style.setProperty('--tgept-glow', 'color-mix(in srgb, ' + ring + ' 45%, transparent)');
    r.style.setProperty('--tgept-tint', 'color-mix(in srgb, ' + ring + ' 12%, transparent)');
  }

  function Tour(opts) {
    this.opts = opts || {};
    this.i = 0;
    this.veil = this.spot = this.card = this.modal = null;
  }

  Tour.prototype._widget = function () {
    try { return this.opts.getWidget ? this.opts.getWidget() : null; } catch (e) { return null; }
  };
  Tour.prototype._hostEl = function (w) {
    if (this.opts.container) return this.opts.container;
    if (w && w.container) return w.container;
    var n = document.querySelector('[data-tg-widget="enquirypro"]');
    return n || document.body;
  };

  Tour.prototype.start = function () {
    injectStyles();
    var w = this._widget();
    themeFrom(w);
    this._welcome();
  };

  Tour.prototype._welcome = function () {
    var self = this;
    var m = document.createElement('div'); m.className = 'tgept-modal';
    m.innerHTML =
      '<div class="tgept-modal-card" role="dialog" aria-label="Enquiry Pro tour">' +
      '<div class="tgept-badge"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/></svg></div>' +
      '<h2>Meet Enquiry Pro</h2>' +
      '<p>A 60-second look at what makes this multi-step enquiry form convert better than the classic one — while landing leads in the very same inbox.</p>' +
      '<div class="tgept-row" style="justify-content:center;gap:8px">' +
      '<button class="tgept-skip" data-skip>Skip</button>' +
      '<button class="tgept-btn tgept-next" data-start>Take the tour</button>' +
      '</div></div>';
    document.body.appendChild(m); this.modal = m;
    requestAnimationFrame(function(){ m.classList.add('on'); });
    m.querySelector('[data-skip]').addEventListener('click', function(){ self._closeModal(); self.finish(false); });
    m.querySelector('[data-start]').addEventListener('click', function(){ self._closeModal(); self.i = 0; self._go(0); });
  };

  Tour.prototype._closeModal = function () {
    var m = this.modal; if (!m) return; m.classList.remove('on'); this.modal = null;
    setTimeout(function(){ if (m.parentNode) m.parentNode.removeChild(m); }, reduce?0:240);
  };

  Tour.prototype._ensureLayers = function () {
    if (this.veil) return;
    var self = this;
    this.veil = document.createElement('div'); this.veil.className = 'tgept-veil';
    this.veil.addEventListener('click', function(){ self.finish(false); });
    this.spot = document.createElement('div'); this.spot.className = 'tgept-spot';
    this.card = document.createElement('div'); this.card.className = 'tgept-card'; this.card.setAttribute('role','dialog');
    document.body.appendChild(this.veil); document.body.appendChild(this.spot); document.body.appendChild(this.card);
    requestAnimationFrame(function(){ self.veil.classList.add('on'); });
    this._onKey = function(e){ if (e.key==='Escape') self.finish(false); else if (e.key==='ArrowRight' || e.key==='Enter') self._next(); else if (e.key==='ArrowLeft') self._prev(); };
    document.addEventListener('keydown', this._onKey);
    this._onResize = function(){ self._position(); };
    window.addEventListener('resize', this._onResize); window.addEventListener('scroll', this._onResize, true);
  };

  Tour.prototype._go = function (n) {
    var self = this;
    if (n < 0 || n >= STEPS.length) { return this.finish(true); }
    this.i = n;
    var st = STEPS[n];
    var w = this._widget();
    // drive the live widget to the relevant step so the spotlight matches the words
    if (w && typeof w.gotoStep === 'function' && typeof st.widgetStep === 'number') {
      try { w.gotoStep(st.widgetStep); } catch (e) {}
    }
    this._ensureLayers();
    // wait a frame for the widget re-render + layout
    setTimeout(function(){ self._paint(st); }, reduce?0:120);
  };

  Tour.prototype._paint = function (st) {
    var self = this, total = STEPS.length;
    var dots = STEPS.map(function(_, idx){ return '<span class="tgept-dot'+(idx===self.i?' on':'')+'"></span>'; }).join('');
    var nextLabel = st.last ? 'Done' : 'Next';
    this.card.innerHTML =
      '<div class="tgept-step">Step ' + (this.i+1) + ' of ' + total + '</div>' +
      '<div class="tgept-title">' + esc(st.title) + '</div>' +
      '<div class="tgept-body">' + esc(st.body) + '</div>' +
      '<div class="tgept-row"><div class="tgept-dots">' + dots + '</div>' +
      (this.i>0 ? '<button class="tgept-skip" data-prev>Back</button>' : '<button class="tgept-skip" data-skip>Skip</button>') +
      '<button class="tgept-btn tgept-next" data-next>' + nextLabel + '</button></div>';
    this.card.querySelector('[data-next]').addEventListener('click', function(){ self._next(); });
    var prev = this.card.querySelector('[data-prev]'); if (prev) prev.addEventListener('click', function(){ self._prev(); });
    var skip = this.card.querySelector('[data-skip]'); if (skip) skip.addEventListener('click', function(){ self.finish(false); });
    this._position();
    requestAnimationFrame(function(){ self.card.classList.add('on'); });
  };

  Tour.prototype._position = function () {
    if (!this.spot) return;
    var w = this._widget();
    var host = this._hostEl(w);
    var r = host.getBoundingClientRect();
    var pad = 10;
    var top = Math.max(8, r.top - pad), left = Math.max(8, r.left - pad);
    var width = Math.min(window.innerWidth - 16, r.width + pad*2);
    var height = r.height + pad*2;
    this.spot.style.top = top + 'px'; this.spot.style.left = left + 'px';
    this.spot.style.width = width + 'px'; this.spot.style.height = height + 'px';
    // place the card: to the right if room, else below, else centred-bottom
    var cardW = Math.min(360, window.innerWidth - 32);
    var spaceRight = window.innerWidth - (left + width);
    var c = this.card;
    if (spaceRight > cardW + 24) {
      c.style.left = (left + width + 16) + 'px';
      c.style.top = Math.max(8, Math.min(top, window.innerHeight - 240)) + 'px';
      c.style.right = 'auto'; c.style.bottom = 'auto';
    } else {
      // below the spotlight, or pinned to bottom on small screens
      var below = top + height + 14;
      if (below + 220 < window.innerHeight) {
        c.style.top = below + 'px';
        c.style.left = Math.max(16, Math.min(left, window.innerWidth - cardW - 16)) + 'px';
        c.style.right = 'auto'; c.style.bottom = 'auto';
      } else {
        c.style.top = 'auto'; c.style.bottom = '16px';
        c.style.left = '50%'; c.style.transform = 'translateX(-50%)';
      }
    }
  };

  Tour.prototype._next = function () {
    var self = this; if (!this.card) return;
    this.card.classList.remove('on');
    setTimeout(function(){ self._go(self.i + 1); }, reduce?0:160);
  };
  Tour.prototype._prev = function () {
    var self = this; if (this.i<=0 || !this.card) return;
    this.card.classList.remove('on');
    setTimeout(function(){ self._go(self.i - 1); }, reduce?0:160);
  };

  Tour.prototype.finish = function (completed) {
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch (e) {}
    document.removeEventListener('keydown', this._onKey);
    window.removeEventListener('resize', this._onResize); window.removeEventListener('scroll', this._onResize, true);
    var nodes = [this.veil, this.spot, this.card];
    nodes.forEach(function(n){ if (n) n.classList && n.classList.remove('on'); });
    var self = this;
    setTimeout(function(){ nodes.forEach(function(n){ if (n && n.parentNode) n.parentNode.removeChild(n); }); self.veil=self.spot=self.card=null; }, reduce?0:260);
    // reset the widget to the start so the demo is fresh
    var w = this._widget(); if (w && typeof w.gotoStep === 'function') { try { w.gotoStep(0); } catch (e) {} }
  };

  // ----- public API
  var API = {
    start: function (opts) { new Tour(opts).start(); },
    mount: function (opts) {
      opts = opts || {};
      injectStyles();
      // launcher button
      var btn = document.createElement('button'); btn.className = 'tgept-launch'; btn.type = 'button';
      btn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg> Take the tour';
      btn.addEventListener('click', function(){ API.start(opts); });
      document.body.appendChild(btn);
      // auto-offer once
      var dismissed = false; try { dismissed = localStorage.getItem(DISMISS_KEY) === '1'; } catch (e) {}
      if (!dismissed && !opts.noAuto) {
        setTimeout(function(){ API.start(opts); }, 700);
      }
    }
  };

  window.TGEnquiryProTour = API;
})();
