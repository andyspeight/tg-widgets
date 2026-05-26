/**
 * Travelgenix Quote PDF Button v1.0.0
 * Self-contained, embeddable button for the Quick Quote viewer page.
 * Zero dependencies. Shadow DOM isolated. Reads the quote id + key from the
 * page URL hash (#quoteid=ID/KEY), then calls the quote-pdf endpoint to
 * download or email a branded PDF of the quote.
 *
 * Usage:
 *   <div data-tg-widget="quote-pdf"></div>
 *   <script src="https://tg-widgets.vercel.app/widget-quote-pdf.js"></script>
 *
 * Optional attributes on the mount div:
 *   data-tg-api="https://tg-widgets.vercel.app/api/quote-pdf"  (endpoint override)
 *   data-tg-label="Download PDF"                               (button label)
 *   data-tg-theme="dark"                                       (force dark)
 *   data-tg-actions="download,email"                           (which actions to show)
 */
(function () {
  'use strict';

  var VERSION = '1.1.0';
  var DEFAULT_API = (typeof window !== 'undefined' && window.__TG_QUOTE_PDF_API__) ||
    'https://tg-widgets.vercel.app/api/quote-pdf';

  // --- Inline SVG icons (no external deps) ---
  var IC = {
    doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><polyline points="9 15 12 18 15 15"/></svg>',
    mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 5L2 7"/></svg>',
    spin: '<svg class="tgqp-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>'
  };

  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /**
   * Parse the quote id + key from the current URL.
   * Official format (Travelify doc, May 2026) is query params:
   *   https://www.traveldemo.site/quick-quote?key=UUID&id=17629
   * We also accept the older hash form (#quoteid=ID/KEY) as a fallback.
   */
  function parseQuoteRef(href) {
    var url = href || (typeof window !== 'undefined' ? window.location.href : '');
    if (!url) return null;

    // 1. Query params ?id=...&key=...
    try {
      var qs = url.indexOf('?') !== -1 ? url.slice(url.indexOf('?') + 1) : '';
      // Strip any hash off the query string.
      qs = qs.split('#')[0];
      var params = {};
      qs.split('&').forEach(function (pair) {
        if (!pair) return;
        var kv = pair.split('=');
        params[decodeURIComponent(kv[0] || '').toLowerCase()] = decodeURIComponent(kv[1] || '');
      });
      if (params.id && params.key) {
        return { quoteId: params.id, key: params.key };
      }
    } catch (e) { /* fall through to hash form */ }

    // 2. Legacy hash form #quoteid=ID/KEY
    var hash = (typeof window !== 'undefined') ? window.location.hash : '';
    var m = /quoteid=([^/&]+)\/([^&]+)/i.exec(hash || url || '');
    if (m) return { quoteId: decodeURIComponent(m[1]), key: decodeURIComponent(m[2]) };

    return null;
  }

  // --- Quote-document auto-detection ----------------------------------------
  // The Quick Quote viewer loads the quote into the page. We look for the clean,
  // document-ready `quoteDocument` object (NOT the raw items array that carries
  // cost prices). A valid quote object is either the official hotlist shape
  // (items[].product.units[].rates[]) or an already-flat doc. We scrub all
  // known cost keys before anything leaves the page. If we can't find a quote
  // object, we return null and the button falls back to sending id+key for the
  // server to fetch.

  var COST_FIELDS = ['nettPrice', 'memberPrice', 'originalPrice', 'costPrice',
    'costCurrency', 'inResortFees', 'priceBeforeChange', 'originalCurrency',
    'exchangeRate', 'ruleIds', 'memberRuleIds'];

  /** True if obj looks like a quote we can render (official OR legacy shape). */
  function looksLikeQuoteDoc(o) {
    if (!o || typeof o !== 'object') return false;
    var d = (o.data && typeof o.data === 'object') ? o.data : o;
    if (!Array.isArray(d.items) || d.items.length === 0) return false;
    var first = d.items[0];
    // Official hotlist shape: item carries a product object.
    if (first && first.product && typeof first.product === 'object') return true;
    // Legacy flat shape: item has accommodationName and the doc has setup.
    if (first && first.accommodationName !== undefined &&
        d.setup && typeof d.setup === 'object') return true;
    return false;
  }

  /**
   * Deep-clone a quoteDocument while stripping any cost/nett/member fields.
   * Defence in depth: even though the clean quoteDocument should only carry the
   * sell `price`, we scrub known cost keys client-side so they can never leave
   * the page through our endpoint. The server scrubs again, and the renderer
   * only ever reads the sell `price`.
   */
  function scrubCosts(value) {
    if (Array.isArray(value)) return value.map(scrubCosts);
    if (value && typeof value === 'object') {
      var out = {};
      for (var k in value) {
        if (!Object.prototype.hasOwnProperty.call(value, k)) continue;
        if (COST_FIELDS.indexOf(k) !== -1) continue; // drop cost fields
        out[k] = scrubCosts(value[k]);
      }
      return out;
    }
    return value;
  }

  /**
   * Try to find the quoteDocument the page has already loaded.
   * Strategy, in order:
   *   1. A small set of likely named globals (fast path).
   *   2. A bounded breadth-first walk of each candidate global, descending a
   *      few levels, since frameworks (SvelteKit/Next/Nuxt) nest hydration data
   *      deep (e.g. window.__x.state.data.quoteDocument).
   * Returns a scrubbed quoteDocument, or null.
   */
  function findQuoteDoc() {
    if (typeof window === 'undefined') return null;

    // Is this a plain data object/array we can safely inspect — and NOT a
    // Window, frame, or other exotic host object? Reaching into a cross-origin
    // iframe's Window (e.g. an embedded Google Maps frame) throws a SecurityError
    // that can escape ordinary try/catch, so we exclude such objects up front.
    function isSafeData(v) {
      if (!v || typeof v !== 'object') return false;
      try {
        // A cross-origin Window exposes very few props and throws on most reads.
        // These checks are wrapped so any throw => treat as unsafe.
        if (v === window) return false;
        if (typeof v.window === 'object' && v.window === v) return false; // self-ref Window
        if (typeof Window !== 'undefined' && v instanceof Window) return false;
        if (typeof v.self !== 'undefined' && v.self === v) return false;
        if (v.nodeType !== undefined) return false; // DOM node
        // location/document presence is a strong Window signal
        if ('document' in v && 'location' in v && 'navigator' in v) return false;
      } catch (e) {
        return false; // any throw means it's not safe plain data
      }
      return true;
    }

    // Pass 1: only accept a value reached via an explicit `quoteDocument` key.
    function bfs(root, preferKeyed) {
      var MAX_NODES = 4000, MAX_DEPTH = 6;
      if (!isSafeData(root)) return null;
      var queue = [{ v: root, d: 0, viaKey: false }];
      var visited = 0;
      var seen = (typeof WeakSet !== 'undefined') ? new WeakSet() : null;
      while (queue.length) {
        if (visited++ > MAX_NODES) break;
        var node = queue.shift();
        var v = node.v;
        if (!isSafeData(v)) continue;
        if (seen) { if (seen.has(v)) continue; seen.add(v); }
        if (looksLikeQuoteDoc(v) && (!preferKeyed || node.viaKey)) return v;
        if (node.d >= MAX_DEPTH) continue;
        var keys;
        try { keys = Object.keys(v); } catch (e) { continue; }
        for (var i = 0; i < keys.length; i++) {
          var child;
          try { child = v[keys[i]]; } catch (e) { continue; }
          if (isSafeData(child)) {
            queue.push({ v: child, d: node.d + 1, viaKey: keys[i] === 'quoteDocument' });
          }
        }
      }
      return null;
    }

    // Gather candidate roots: likely-named globals first, then a bounded scan
    // of other window globals.
    function candidateRoots() {
      var roots = [];
      var NAMED = ['quoteDocument', 'quoteData', 'quote', '__QUOTE__', 'QUOTE',
        'tgQuote', 'quoteResponse', 'tvlQuote', 'travelify', 'quickQuote',
        '__NEXT_DATA__', '__NUXT__', '__sveltekit_data', '__INITIAL_STATE__'];
      for (var i = 0; i < NAMED.length; i++) {
        try { var v = window[NAMED[i]]; if (isSafeData(v)) roots.push(v); }
        catch (e) { /* getter throw */ }
      }
      var keys;
      try { keys = Object.keys(window); } catch (e) { keys = []; }
      var scanned = 0;
      for (var j = 0; j < keys.length; j++) {
        if (scanned > 600) break;
        // Skip obvious frame/window slots by name (numeric = frame index).
        var name = keys[j];
        if (/^\d+$/.test(name)) continue; // window[0], window[1] = child frames
        if (name === 'window' || name === 'self' || name === 'top' ||
            name === 'parent' || name === 'frames' || name === 'opener') continue;
        scanned++;
        var val;
        try { val = window[name]; } catch (e) { continue; }
        if (isSafeData(val)) roots.push(val);
      }
      return roots;
    }

    var roots = candidateRoots();
    // Pass 1 across ALL roots: explicit `quoteDocument` key wins.
    for (var a = 0; a < roots.length; a++) {
      var keyed = bfs(roots[a], true);
      if (keyed) return scrubCosts(keyed);
    }
    // Pass 2 across ALL roots: accept a structural quoteDocument.
    for (var b = 0; b < roots.length; b++) {
      var structural = bfs(roots[b], false);
      if (structural) return scrubCosts(structural);
    }
    return null;
  }

  var STYLES = '\
    :host{ all:initial; display:inline-block; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif; }\
    .tgqp-root{\
      --tgqp-navy:#1B2B5B; --tgqp-navy-dark:#111D3E; --tgqp-teal:#00B4D8; --tgqp-teal-dark:#0096B7;\
      --tgqp-ink:#0F172A; --tgqp-sub:#475569; --tgqp-bg:#FFFFFF; --tgqp-border:#E2E8F0;\
      --tgqp-ok:#10B981; --tgqp-err:#EF4444; --tgqp-radius:10px;\
      display:inline-flex; gap:10px; align-items:center;\
    }\
    .tgqp-root[data-theme="dark"]{ --tgqp-ink:#F8FAFC; --tgqp-sub:#CBD5E1; --tgqp-bg:#1E293B; --tgqp-border:#334155; }\
    .tgqp-btn{\
      display:inline-flex; align-items:center; gap:8px; cursor:pointer;\
      font-size:14px; font-weight:600; line-height:1; min-height:44px; padding:0 18px;\
      border-radius:var(--tgqp-radius); border:1px solid transparent;\
      transition:transform .12s ease-out, box-shadow .12s ease-out, background-color .12s ease-out;\
      -webkit-tap-highlight-color:transparent; white-space:nowrap;\
    }\
    .tgqp-btn svg{ width:18px; height:18px; flex:0 0 auto; }\
    .tgqp-btn:focus-visible{ outline:none; box-shadow:0 0 0 3px rgba(0,180,216,.35); }\
    .tgqp-btn--primary{ background:var(--tgqp-navy); color:#fff; }\
    .tgqp-btn--primary:hover{ background:var(--tgqp-navy-dark); }\
    .tgqp-btn--primary:active{ transform:scale(.98); }\
    .tgqp-btn--ghost{ background:var(--tgqp-bg); color:var(--tgqp-ink); border-color:var(--tgqp-border); }\
    .tgqp-btn--ghost:hover{ border-color:var(--tgqp-teal); color:var(--tgqp-teal-dark); }\
    .tgqp-btn--ghost:active{ transform:scale(.98); }\
    .tgqp-btn[disabled]{ opacity:.6; cursor:default; pointer-events:none; }\
    .tgqp-spin{ animation:tgqp-rot .7s linear infinite; }\
    @keyframes tgqp-rot{ to{ transform:rotate(360deg); } }\
    .tgqp-msg{ font-size:13px; font-weight:500; display:inline-flex; align-items:center; gap:6px; }\
    .tgqp-msg svg{ width:16px; height:16px; }\
    .tgqp-msg--ok{ color:var(--tgqp-ok); } .tgqp-msg--err{ color:var(--tgqp-err); }\
    @media (prefers-reduced-motion: reduce){ .tgqp-btn{ transition:none; } .tgqp-spin{ animation:none; } }\
  ';

  function TGQuotePdfButton(container) {
    this.el = container;
    this.api = container.getAttribute('data-tg-api') || DEFAULT_API;
    this.label = container.getAttribute('data-tg-label') || 'Download PDF';
    this.theme = container.getAttribute('data-tg-theme') || 'light';
    var actionsAttr = (container.getAttribute('data-tg-actions') || 'download,email')
      .split(',').map(function (s) { return s.trim(); });
    this.actions = actionsAttr.filter(function (a) { return a === 'download' || a === 'email'; });
    if (this.actions.length === 0) this.actions = ['download'];
    this.ref = parseQuoteRef();
    this.shadow = container.attachShadow({ mode: 'open' });
    this._render();
  }

  TGQuotePdfButton.prototype._render = function () {
    var btns = '';
    if (this.actions.indexOf('download') !== -1) {
      btns += '<button class="tgqp-btn tgqp-btn--primary" data-act="download" type="button">' +
        IC.doc + '<span>' + esc(this.label) + '</span></button>';
    }
    if (this.actions.indexOf('email') !== -1) {
      btns += '<button class="tgqp-btn tgqp-btn--ghost" data-act="email" type="button">' +
        IC.mail + '<span>Email me a copy</span></button>';
    }
    this.shadow.innerHTML =
      '<style>' + STYLES + '</style>' +
      '<div class="tgqp-root" data-theme="' + esc(this.theme) + '">' +
        btns +
        '<span class="tgqp-msg" data-msg hidden></span>' +
      '</div>';
    this._bind();
  };

  TGQuotePdfButton.prototype._bind = function () {
    var self = this;
    var buttons = this.shadow.querySelectorAll('.tgqp-btn');
    buttons.forEach(function (b) {
      b.addEventListener('click', function () { self._run(b.getAttribute('data-act'), b); });
    });
  };

  TGQuotePdfButton.prototype._setMsg = function (text, kind) {
    var m = this.shadow.querySelector('[data-msg]');
    if (!text) { m.hidden = true; m.textContent = ''; return; }
    m.hidden = false;
    m.className = 'tgqp-msg ' + (kind === 'err' ? 'tgqp-msg--err' : 'tgqp-msg--ok');
    m.innerHTML = (kind === 'err' ? IC.alert : IC.check) + '<span>' + esc(text) + '</span>';
  };

  TGQuotePdfButton.prototype._busy = function (btn, on, busyLabel) {
    var all = this.shadow.querySelectorAll('.tgqp-btn');
    all.forEach(function (b) { b.disabled = on; });
    if (!btn) return;
    if (on) {
      btn._html = btn.innerHTML;
      btn.innerHTML = IC.spin + '<span>' + esc(busyLabel || 'Working…') + '</span>';
    } else if (btn._html) {
      btn.innerHTML = btn._html;
    }
  };

  TGQuotePdfButton.prototype._run = function (action, btn) {
    var self = this;
    this._setMsg('');

    // Re-read the id+key from the URL at click time.
    if (!this.ref) this.ref = parseQuoteRef();

    // If the URL gives us id+key (the normal case on the viewer page), prefer
    // letting the SERVER fetch the quote from Travelify. That avoids scanning
    // the page's JS at all — more robust on pages full of third-party iframes
    // (maps, ads) where scanning can hit cross-origin frames. We only fall back
    // to reading the quote off the page when the URL has no id+key.
    var doc = null;
    if (!this.ref) {
      try { doc = findQuoteDoc(); } catch (e) { doc = null; }
    }

    if (!doc && !this.ref) {
      this._setMsg('No quote found on this page', 'err');
      return;
    }

    this._busy(btn, true, action === 'email' ? 'Sending…' : 'Preparing…');

    // Build the request. With id+key the server fetches + renders. If we only
    // have a page-scraped doc (no URL id+key), we send that instead.
    var bodyObj = { action: action };
    if (this.ref) { bodyObj.quoteId = this.ref.quoteId; bodyObj.key = this.ref.key; }
    if (doc) {
      bodyObj.quoteDocument = doc;
      // Backfill id/key from the detected doc if the URL didn't carry them.
      // Official shape: doc.data.id / doc.data.key (or unwrapped doc.id/key).
      // Legacy shape: doc.setup.quoteId / doc.setup.quoteUuid.
      var dd = (doc.data && doc.data.items) ? doc.data : doc;
      if (!bodyObj.quoteId) {
        if (dd.id !== undefined) bodyObj.quoteId = String(dd.id);
        else if (dd.setup && dd.setup.quoteId !== undefined) bodyObj.quoteId = String(dd.setup.quoteId);
      }
      if (!bodyObj.key) {
        if (dd.key) bodyObj.key = String(dd.key);
        else if (dd.setup && dd.setup.quoteUuid) bodyObj.key = String(dd.setup.quoteUuid);
      }
    }

    var payload = JSON.stringify(bodyObj);
    var resolvedId = bodyObj.quoteId || 'document';

    fetch(this.api, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    }).then(function (res) {
      if (action === 'email') {
        return res.json().then(function (j) {
          if (!res.ok || !j.ok) throw new Error('email failed');
          self._setMsg('Sent to your email', 'ok');
        });
      }
      // download: expect a PDF blob
      if (!res.ok) throw new Error('download failed');
      return res.blob().then(function (blob) {
        var cd = res.headers.get('Content-Disposition') || '';
        var nameMatch = /filename="?([^"]+)"?/.exec(cd);
        var filename = nameMatch ? nameMatch[1] : ('Quote-' + resolvedId + '.pdf');
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
        self._setMsg('Downloaded', 'ok');
      });
    }).catch(function () {
      self._setMsg(action === 'email' ? 'Could not send email' : 'Could not generate PDF', 'err');
    }).then(function () {
      self._busy(btn, false);
      // auto-clear the message after a few seconds
      setTimeout(function () { self._setMsg(''); }, 5000);
    });
  };

  function init() {
    var containers = document.querySelectorAll('[data-tg-widget="quote-pdf"]');
    containers.forEach(function (c) {
      if (c.__tgqpInit) return;
      c.__tgqpInit = true;
      try { new TGQuotePdfButton(c); } catch (e) { /* fail silent on host page */ }
    });
  }

  window.TGQuotePdfButton = TGQuotePdfButton;
  window.__TG_QUOTE_PDF_VERSION__ = VERSION;
  // Exposed for debugging on the host page: run window.__TG_findQuoteDoc__()
  // in the console to confirm the page's quoteDocument is auto-detected.
  window.__TG_findQuoteDoc__ = findQuoteDoc;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
