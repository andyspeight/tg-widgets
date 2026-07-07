/**
 * Travelgenix Smart Section Widget v1.1.0
 * Show different content to different visitors without a developer.
 * Self-contained, embeddable wrapper widget — zero dependencies beyond the
 * shared rule engine (tgse-rules.js), which it loads itself if missing.
 *
 * Smart Section is the ONE widget in the suite that intentionally does NOT
 * use Shadow DOM: it wraps user content (Duda elements, other TG widgets)
 * that must render in the light DOM. The few UI elements the widget injects
 * (dismiss button, debug badge) use inline styles with high specificity.
 *
 * Behaviour is fail-open by design: if the rule engine fails to load, the
 * config fetch errors or evaluation throws, the wrapped content is shown.
 * Better to show content than to permanently hide a section over a blip.
 *
 * Usage:
 *   <div data-tg-widget="smartsection" data-tg-id="YOUR_WIDGET_ID">
 *     ... the content to show or hide ...
 *   </div>
 *   <script src="https://tg-widgets.vercel.app/tgse-rules.js" defer></script>
 *   <script src="https://tg-widgets.vercel.app/widget-smartsection.js" defer></script>
 */
(function () {
  'use strict';

  var VERSION = '1.1.0';

  /* ------------------------------------------------------------------ *
   * API base resolution (shared suite convention)
   * ------------------------------------------------------------------ */

  function scriptOrigin() {
    try {
      if (document.currentScript && document.currentScript.src) {
        return new URL(document.currentScript.src).origin;
      }
    } catch (e) { /* fall through */ }
    try {
      var scripts = document.getElementsByTagName('script');
      for (var i = scripts.length - 1; i >= 0; i--) {
        var src = scripts[i].src || '';
        if (/\/widget\-smartsection\.js(\?|$|#)/.test(src)) {
          return new URL(src).origin;
        }
      }
    } catch (e) { /* fall through */ }
    return '';
  }

  var SCRIPT_ORIGIN = scriptOrigin();

  function resolveApiBase() {
    if (window.__TG_WIDGET_API__) return window.__TG_WIDGET_API__;
    if (SCRIPT_ORIGIN) return SCRIPT_ORIGIN + '/api/widget-config';
    return '/api/widget-config';
  }

  var API_BASE = resolveApiBase();

  /* ------------------------------------------------------------------ *
   * Defaults + config hygiene. Everything read off the network is
   * validated before use; strings never reach innerHTML.
   * ------------------------------------------------------------------ */

  var DEFAULTS = {
    match: 'all',      // 'all' | 'any'
    rules: [],         // see tgse-rules.js for rule shapes
    dismissible: false,
    dismissDays: 30,   // suppression window after a dismiss
    maxShows: 0,       // per-visitor show cap; 0 = unlimited
    reveal: 'fade',    // 'fade' | 'none'
    debug: false,      // debug badge outside preview mode
  };

  function clampInt(v, min, max, fallback) {
    var n = parseInt(v, 10);
    if (isNaN(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function normaliseConfig(raw) {
    var c = Object.assign({}, DEFAULTS, raw && typeof raw === 'object' ? raw : {});
    c.match = c.match === 'any' ? 'any' : 'all';
    c.rules = Array.isArray(c.rules) ? c.rules : [];
    c.dismissible = !!c.dismissible;
    c.dismissDays = clampInt(c.dismissDays, 0, 365, DEFAULTS.dismissDays);
    c.maxShows = clampInt(c.maxShows, 0, 1000, DEFAULTS.maxShows);
    c.reveal = c.reveal === 'none' ? 'none' : 'fade';
    c.debug = !!c.debug;
    return c;
  }

  /* ------------------------------------------------------------------ *
   * Rule engine loading. The engine is a separate shell-level script so
   * it can be shared across the suite; if the page did not include it,
   * fetch it from the widget's own origin. On any failure, fail open.
   * ------------------------------------------------------------------ */

  var enginePromise = null;
  function ensureEngine() {
    if (window.tgseRules) return Promise.resolve(window.tgseRules);
    if (enginePromise) return enginePromise;
    enginePromise = new Promise(function (resolve) {
      var done = false;
      function settle() {
        if (done) return;
        done = true;
        resolve(window.tgseRules || null);
      }
      try {
        var s = document.createElement('script');
        s.src = (SCRIPT_ORIGIN || '') + '/tgse-rules.js';
        s.async = true;
        s.onload = settle;
        s.onerror = settle;
        document.head.appendChild(s);
        setTimeout(settle, 4000);
      } catch (e) {
        settle();
      }
    });
    return enginePromise;
  }

  /* ------------------------------------------------------------------ *
   * Per-widget visitor state, stored through the engine's safe storage
   * helpers ('tgsr_' prefix). Anonymous counters only — no PII.
   * ------------------------------------------------------------------ */

  function stateKey(id, suffix) {
    return 'ss_' + (id || 'default') + '_' + suffix;
  }

  function isDismissed(engine, id) {
    var st = engine.storage.read(stateKey(id, 'dismiss'), 'local');
    return !!(st && st.expires && Date.now() < st.expires);
  }

  function recordDismiss(engine, id, days) {
    engine.storage.write(stateKey(id, 'dismiss'), { expires: Date.now() + days * 86400000 }, 'local');
  }

  function showCount(engine, id) {
    var n = engine.storage.read(stateKey(id, 'shows'), 'local');
    return typeof n === 'number' && n >= 0 ? n : 0;
  }

  function recordShow(engine, id) {
    engine.storage.write(stateKey(id, 'shows'), showCount(engine, id) + 1, 'local');
  }

  /* ------------------------------------------------------------------ *
   * The widget
   * ------------------------------------------------------------------ */

  function isPreview() {
    return !!window.__TG_PREVIEW__;
  }

  function TGSmartSectionWidget(container, config) {
    this.el = container;
    this.config = normaliseConfig(config);
    this.state = 'evaluating'; // evaluating | shown | hidden | deferred
    this._prevDisplay = container.style.display || '';
    this._prevPosition = container.style.position || '';
    this._disarm = null;
    this._watchdog = null;
    this._ui = [];
    this._destroyed = false;
    this._start();
  }

  TGSmartSectionWidget.prototype._start = function () {
    var self = this;
    // Hide immediately so ineligible visitors never see a flash, then let
    // a watchdog reveal if evaluation somehow never completes (fail-open).
    this.el.style.display = 'none';
    this.el.setAttribute('data-tgss-state', 'evaluating');
    this._watchdog = setTimeout(function () {
      if (self.state === 'evaluating') self._reveal('watchdog timeout, failing open');
    }, 4000);

    ensureEngine().then(function (engine) {
      if (self._destroyed) return;
      try {
        self._decide(engine);
      } catch (e) {
        try { console.warn('[TG SmartSection] evaluation failed, failing open', e); } catch (e2) { /* noop */ }
        self._reveal('error, failing open');
      }
    });
  };

  TGSmartSectionWidget.prototype._decide = function (engine) {
    var c = this.config;
    var id = c.widgetId;

    if (!engine) {
      this._reveal('rule engine unavailable, failing open');
      return;
    }

    // Keep the new/returning marker fresh on every page view, so a
    // "returning visitor" rule added later has history to work with.
    engine.isReturningVisitor();

    if (isPreview() || c.debug) {
      // Editors always see their content; the badge reports what real
      // visitors would get. Nothing is persisted in preview. The editor can
      // set window.__TG_PREVIEW_CTX__ to simulate a specific visitor (device,
      // new/returning, day + time, traffic source) — any keys it omits fall
      // back to the real visitor via the engine's context merge.
      var simCtx = (typeof window !== 'undefined' && window.__TG_PREVIEW_CTX__) || null;
      var verdict = engine.evaluate({ match: c.match, rules: c.rules }, simCtx);
      this._reveal(null, true);
      this._badge(verdict);
      if (c.dismissible) this._dismissButton(true);
      return;
    }

    if (c.dismissible && isDismissed(engine, id)) {
      this._hide('dismissed');
      return;
    }

    if (c.maxShows > 0 && showCount(engine, id) >= c.maxShows) {
      this._hide('show cap reached');
      return;
    }

    var result = engine.evaluate({ match: c.match, rules: c.rules });
    if (result.show) {
      this._show(engine, id);
    } else if (result.defer) {
      this._deferUntilTriggered(engine, id);
    } else {
      this._hide('rules did not match');
    }
  };

  TGSmartSectionWidget.prototype._deferUntilTriggered = function (engine, id) {
    var self = this;
    this.state = 'deferred';
    this.el.setAttribute('data-tgss-state', 'deferred');
    if (this._watchdog) { clearTimeout(this._watchdog); this._watchdog = null; }
    var group = { match: this.config.match, rules: this.config.rules };
    this._disarm = engine.armDeferred(group, function () {
      if (self._destroyed || self.state !== 'deferred') return;
      // The trigger fired, so the deferred rules are satisfied — re-check
      // only the non-deferred rules (time may have moved on).
      var rest = group.rules.filter(function (r) {
        return !(r && engine.deferrableTypes.indexOf(r.type) !== -1);
      });
      var again = engine.evaluate({ match: group.match, rules: rest });
      // In 'any' mode the trigger firing is itself a match.
      if (group.match === 'any' || again.show) {
        self._show(engine, id);
      } else {
        self._hide('rules did not match');
      }
    });
  };

  TGSmartSectionWidget.prototype._show = function (engine, id) {
    if (this.config.maxShows > 0 || this.config.dismissible) recordShow(engine, id);
    this._reveal(null);
    if (this.config.dismissible) this._dismissButton(false, engine, id);
  };

  TGSmartSectionWidget.prototype._reveal = function (warn, silent) {
    if (this._watchdog) { clearTimeout(this._watchdog); this._watchdog = null; }
    if (warn && !silent) {
      try { console.warn('[TG SmartSection] ' + warn); } catch (e) { /* noop */ }
    }
    this.state = 'shown';
    this.el.setAttribute('data-tgss-state', 'shown');
    var el = this.el;
    if (this.config.reveal === 'fade') {
      el.style.opacity = '0';
      el.style.transition = 'opacity 320ms ease';
      el.style.display = this._prevDisplay;
      var raf = window.requestAnimationFrame || function (fn) { setTimeout(fn, 16); };
      raf(function () { raf(function () { el.style.opacity = '1'; }); });
    } else {
      el.style.display = this._prevDisplay;
    }
  };

  TGSmartSectionWidget.prototype._hide = function (reason) {
    if (this._watchdog) { clearTimeout(this._watchdog); this._watchdog = null; }
    this.state = 'hidden';
    this.el.style.display = 'none';
    this.el.setAttribute('data-tgss-state', 'hidden');
    this.el.setAttribute('data-tgss-reason', reason || '');
  };

  /* ------------------------------------------------------------------ *
   * Injected UI — inline styles only (no stylesheet, CSP-clean, and no
   * Shadow DOM by design). Text is set via textContent, never innerHTML.
   * ------------------------------------------------------------------ */

  TGSmartSectionWidget.prototype._hostPosition = function () {
    var pos = '';
    try { pos = window.getComputedStyle(this.el).position; } catch (e) { /* noop */ }
    if (!pos || pos === 'static') this.el.style.position = 'relative';
  };

  TGSmartSectionWidget.prototype._dismissButton = function (inert, engine, id) {
    var self = this;
    this._hostPosition();
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Dismiss this section');
    btn.setAttribute('data-tgss-ui', 'dismiss');
    btn.textContent = '×';
    btn.style.cssText =
      'position:absolute;top:8px;right:8px;z-index:2147483000;width:28px;height:28px;' +
      'border:0;border-radius:50%;background:rgba(15,23,42,.55);color:#fff;' +
      'font:400 18px/28px Arial,sans-serif;text-align:center;padding:0;cursor:pointer;' +
      'opacity:.75;transition:opacity 150ms ease;';
    btn.onmouseenter = function () { btn.style.opacity = '1'; };
    btn.onmouseleave = function () { btn.style.opacity = '.75'; };
    btn.onclick = function () {
      if (!inert && engine) recordDismiss(engine, id, self.config.dismissDays);
      self._hide('dismissed');
    };
    this.el.appendChild(btn);
    this._ui.push(btn);
  };

  TGSmartSectionWidget.prototype._badge = function (verdict) {
    this._hostPosition();
    var badge = document.createElement('div');
    badge.setAttribute('data-tgss-ui', 'badge');

    var label;
    if (verdict.show) {
      label = 'Smart Section · visible to this visitor';
    } else if (verdict.defer) {
      label = 'Smart Section · waiting for exit intent';
    } else {
      var failedTypes = (verdict.results || [])
        .filter(function (r) { return r.outcome === false; })
        .map(function (r) { return r.type; });
      label = 'Smart Section · hidden for this visitor' +
        (failedTypes.length ? ' (' + failedTypes.join(', ') + ')' : '');
    }
    badge.textContent = label;
    badge.style.cssText =
      'position:absolute;top:8px;left:8px;z-index:2147483000;padding:4px 10px;' +
      'border-radius:999px;background:' + (verdict.show ? 'rgba(5,150,105,.92)' : 'rgba(217,119,6,.92)') + ';' +
      'color:#fff;font:600 11px/16px Arial,sans-serif;letter-spacing:.02em;' +
      'pointer-events:none;max-width:calc(100% - 16px);white-space:nowrap;' +
      'overflow:hidden;text-overflow:ellipsis;';
    this.el.appendChild(badge);
    this._ui.push(badge);
  };

  /* ------------------------------------------------------------------ *
   * Lifecycle for editors: re-render on config change.
   * ------------------------------------------------------------------ */

  TGSmartSectionWidget.prototype.update = function (config) {
    this.destroy();
    this._destroyed = false;
    this.config = normaliseConfig(config);
    this.state = 'evaluating';
    this._start();
  };

  TGSmartSectionWidget.prototype.destroy = function () {
    this._destroyed = true;
    if (this._watchdog) { clearTimeout(this._watchdog); this._watchdog = null; }
    if (this._disarm) { try { this._disarm(); } catch (e) { /* noop */ } this._disarm = null; }
    this._ui.forEach(function (node) {
      if (node.parentNode) node.parentNode.removeChild(node);
    });
    this._ui = [];
    this.el.style.display = this._prevDisplay;
    this.el.style.opacity = '';
    this.el.style.transition = '';
    this.el.style.position = this._prevPosition;
    this.el.removeAttribute('data-tgss-state');
    this.el.removeAttribute('data-tgss-reason');
  };

  /* ------------------------------------------------------------------ *
   * Auto-init
   * ------------------------------------------------------------------ */

  async function init() {
    var containers = document.querySelectorAll('[data-tg-widget="smartsection"]');
    for (var i = 0; i < containers.length; i++) {
      var el = containers[i];
      if (el.__tgssInit) continue;
      el.__tgssInit = true;
      try {
        var config = null;
        var inline = el.getAttribute('data-tg-config');
        if (inline) {
          config = JSON.parse(inline);
        } else {
          var id = el.getAttribute('data-tg-id');
          if (id) {
            var resp = await fetch(API_BASE + '?id=' + encodeURIComponent(id));
            if (resp.ok) {
              var data = await resp.json();
              config = data && data.config ? data.config : data;
            }
            if (config) config.widgetId = id;
          }
        }
        // No config (fetch failed, bad id, empty attr) -> fail open with
        // defaults: an empty rule group always shows the content.
        el.__tgssWidget = new TGSmartSectionWidget(el, config || {});
      } catch (e) {
        try { console.warn('[TG SmartSection] init failed, failing open', e); } catch (e2) { /* noop */ }
        el.style.display = '';
      }
    }
  }

  window.TGSmartSectionWidget = TGSmartSectionWidget;
  window.__TG_SMARTSECTION_VERSION__ = VERSION;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
