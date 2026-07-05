/**
 * Travelgenix Rule Engine (tgse-rules) v1.0.0
 * Shell-level, reusable visitor-rule engine for the TG widget suite.
 * Zero dependencies. Loaded once per page. No eval, no Function constructor:
 * rules are pure data, evaluated by a hardcoded dispatch table of named
 * functions, so there is no way to inject executable code through a rule.
 *
 * First consumer: Smart Section (widget-smartsection.js). Designed to take on
 * Popup triggers, Countdown display rules and future widgets (Phase 2).
 *
 * Rule group shape (single AND/OR group, no nesting):
 *   {
 *     match: 'all' | 'any',            // default 'all'
 *     rules: [
 *       { type: 'visitorType', value: 'new' | 'returning' },
 *       { type: 'timeOfDay',   from: 'HH:MM', to: 'HH:MM' },   // overnight ok
 *       { type: 'dayOfWeek',   days: [0-6] },                  // 0 = Sunday
 *       { type: 'device',      devices: ['mobile','tablet','desktop'] },
 *       { type: 'utm',         param: 'source'|'medium'|'campaign'|'referrer',
 *                              value: 'text', match: 'is'|'contains' },
 *       { type: 'exitIntent' }                                 // deferrable
 *     ]
 *   }
 *
 * evaluate(group, ctx?) -> { show, defer, results }
 *   - show:  final boolean for the group right now
 *   - defer: true when the outcome depends only on a deferred trigger
 *            (exit intent) — arm it with armDeferred(group, cb)
 *   - fail-open: an invalid group, unknown rule type or thrown evaluator
 *     counts as a pass. Better to show content than to hide a section
 *     because of a malformed rule.
 *
 * Storage: localStorage/sessionStorage under the 'tgsr_' prefix. Anonymous
 * visit markers and counters only — no PII.
 */
(function () {
  'use strict';

  var root = typeof globalThis !== 'undefined' ? globalThis : window;
  if (root.tgseRules) return; // load once per page

  var VERSION = '1.0.0';
  var STORAGE_PREFIX = 'tgsr_';

  /* ------------------------------------------------------------------ *
   * Safe storage helpers (quota/privacy-mode errors are swallowed)
   * ------------------------------------------------------------------ */

  function store(type) {
    try {
      return type === 'session' ? root.sessionStorage : root.localStorage;
    } catch (e) {
      return null;
    }
  }

  function readKey(key, type) {
    try {
      var s = store(type);
      if (!s) return null;
      var raw = s.getItem(STORAGE_PREFIX + key);
      return raw == null ? null : JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function writeKey(key, val, type) {
    try {
      var s = store(type);
      if (!s) return;
      s.setItem(STORAGE_PREFIX + key, JSON.stringify(val));
    } catch (e) { /* storage full or blocked — non-fatal */ }
  }

  function removeKey(key, type) {
    try {
      var s = store(type);
      if (s) s.removeItem(STORAGE_PREFIX + key);
    } catch (e) { /* non-fatal */ }
  }

  /* ------------------------------------------------------------------ *
   * Visitor context readers. Every reader can be overridden through the
   * ctx argument of evaluate() — that is how the editor simulates
   * conditions and how the unit tests run outside a browser.
   * ------------------------------------------------------------------ */

  function getDevice() {
    try {
      var ua = (root.navigator && root.navigator.userAgent) || '';
      var w = root.innerWidth || 1200;
      var tabletUA = /iPad|Tablet|PlayBook|Silk/i.test(ua);
      if (w < 640 && !tabletUA) return 'mobile';
      if (w < 1024 || tabletUA) return 'tablet';
      return 'desktop';
    } catch (e) {
      return 'desktop';
    }
  }

  var _returningMemo = null;
  function isReturningVisitor() {
    if (_returningMemo !== null) return _returningMemo;
    var seen = readKey('visitor_seen', 'local');
    if (!seen) {
      writeKey('visitor_seen', Date.now(), 'local');
      _returningMemo = false;
    } else {
      _returningMemo = true;
    }
    return _returningMemo;
  }

  // UTM params usually appear only on the landing URL, so the entry source
  // is captured once per browsing session and remembered.
  function getEntrySource() {
    var cached = readKey('entry_src', 'session');
    if (cached) return cached;
    var src = { referrer: '', source: '', medium: '', campaign: '' };
    try {
      src.referrer = (root.document && root.document.referrer) || '';
      var qs = (root.location && root.location.search) || '';
      var params = new URLSearchParams(qs);
      src.source = (params.get('utm_source') || '').toLowerCase();
      src.medium = (params.get('utm_medium') || '').toLowerCase();
      src.campaign = (params.get('utm_campaign') || '').toLowerCase();
    } catch (e) { /* leave defaults */ }
    writeKey('entry_src', src, 'session');
    return src;
  }

  function liveContext() {
    return {
      now: new Date(),
      device: getDevice(),
      returning: isReturningVisitor(),
      entrySource: getEntrySource(),
    };
  }

  /* ------------------------------------------------------------------ *
   * Rule evaluators — the hardcoded dispatch table. Each named function
   * takes (rule, ctx) and returns true / false / 'defer'.
   * ------------------------------------------------------------------ */

  function parseHM(str) {
    if (typeof str !== 'string') return null;
    var m = /^(\d{1,2}):(\d{2})$/.exec(str.trim());
    if (!m) return null;
    var h = parseInt(m[1], 10);
    var min = parseInt(m[2], 10);
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
  }

  function evalVisitorType(rule, ctx) {
    if (rule.value === 'new') return !ctx.returning;
    if (rule.value === 'returning') return !!ctx.returning;
    return true; // unknown value — fail open
  }

  function evalTimeOfDay(rule, ctx) {
    var from = parseHM(rule.from);
    var to = parseHM(rule.to);
    if (from == null || to == null) return true; // malformed — fail open
    var now = ctx.now.getHours() * 60 + ctx.now.getMinutes();
    if (from === to) return true; // zero-length window means always
    if (from < to) return now >= from && now < to;
    return now >= from || now < to; // overnight window, e.g. 22:00-06:00
  }

  function evalDayOfWeek(rule, ctx) {
    if (!Array.isArray(rule.days) || rule.days.length === 0) return true;
    return rule.days.indexOf(ctx.now.getDay()) !== -1;
  }

  function evalDevice(rule, ctx) {
    if (!Array.isArray(rule.devices) || rule.devices.length === 0) return true;
    return rule.devices.indexOf(ctx.device) !== -1;
  }

  function evalUtm(rule, ctx) {
    var src = ctx.entrySource || {};
    var field = { source: 'source', medium: 'medium', campaign: 'campaign', referrer: 'referrer' }[rule.param];
    if (!field) return true; // unknown param — fail open
    var actual = String(src[field] || '').toLowerCase();
    var wanted = String(rule.value || '').toLowerCase().trim();
    if (!wanted) return true;
    if (rule.match === 'contains') return actual.indexOf(wanted) !== -1;
    return actual === wanted;
  }

  function evalExitIntent() {
    // Cannot be known synchronously — it is a trigger, not a state.
    return 'defer';
  }

  var EVALUATORS = {
    visitorType: evalVisitorType,
    timeOfDay: evalTimeOfDay,
    dayOfWeek: evalDayOfWeek,
    device: evalDevice,
    utm: evalUtm,
    exitIntent: evalExitIntent,
  };

  var DEFERRABLE = { exitIntent: true };

  /* ------------------------------------------------------------------ *
   * evaluate(group, ctx?)
   * ------------------------------------------------------------------ */

  function evalRule(rule, ctx) {
    if (!rule || typeof rule !== 'object' || typeof rule.type !== 'string') {
      return true; // malformed rule — fail open
    }
    var fn = EVALUATORS[rule.type];
    if (!fn) return true; // unknown type — fail open
    try {
      return fn(rule, ctx);
    } catch (e) {
      try { console.warn('[tgse-rules] rule "' + rule.type + '" failed, counting as pass', e); } catch (e2) { /* noop */ }
      return true;
    }
  }

  function evaluate(group, ctx) {
    try {
      if (!group || typeof group !== 'object' || !Array.isArray(group.rules) || group.rules.length === 0) {
        return { show: true, defer: false, results: [] };
      }
      var context = ctx ? mergeContext(ctx) : liveContext();
      var matchAny = group.match === 'any';
      var results = [];
      var anyTrue = false;
      var anyFalse = false;
      var anyDefer = false;

      for (var i = 0; i < group.rules.length; i++) {
        var rule = group.rules[i];
        var outcome = evalRule(rule, context);
        results.push({ type: rule && rule.type, outcome: outcome });
        if (outcome === 'defer') anyDefer = true;
        else if (outcome) anyTrue = true;
        else anyFalse = true;
      }

      if (matchAny) {
        if (anyTrue) return { show: true, defer: false, results: results };
        if (anyDefer) return { show: false, defer: true, results: results };
        return { show: false, defer: false, results: results };
      }
      // match all
      if (anyFalse) return { show: false, defer: false, results: results };
      if (anyDefer) return { show: false, defer: true, results: results };
      return { show: true, defer: false, results: results };
    } catch (e) {
      try { console.warn('[tgse-rules] evaluate failed, failing open', e); } catch (e2) { /* noop */ }
      return { show: true, defer: false, results: [], error: true };
    }
  }

  function mergeContext(ctx) {
    var live = null; // build lazily so tests never touch browser APIs
    function pick(key, fallbackFn) {
      if (ctx && Object.prototype.hasOwnProperty.call(ctx, key)) return ctx[key];
      if (!live) live = {};
      if (!(key in live)) live[key] = fallbackFn();
      return live[key];
    }
    return {
      now: pick('now', function () { return new Date(); }),
      device: pick('device', getDevice),
      returning: pick('returning', isReturningVisitor),
      entrySource: pick('entrySource', getEntrySource),
    };
  }

  /* ------------------------------------------------------------------ *
   * Deferred triggers. armDeferred(group, cb) attaches listeners for the
   * deferred rules in the group and calls cb() exactly once, when a
   * deferred trigger fires. The caller re-evaluates with the trigger
   * satisfied. Returns a cleanup function.
   * ------------------------------------------------------------------ */

  function armExitIntent(fire) {
    var doc = root.document;
    if (!doc || !doc.addEventListener) return function () {};
    var cleanups = [];

    if (getDevice() === 'mobile') {
      // No mouse to leave with — use the fast-scroll-toward-top heuristic.
      var lastY = root.pageYOffset || 0;
      var onScroll = function () {
        var y = root.pageYOffset || 0;
        if (y < lastY - 50 && y < 200) fire();
        lastY = y;
      };
      root.addEventListener('scroll', onScroll, { passive: true });
      cleanups.push(function () { root.removeEventListener('scroll', onScroll); });
    } else {
      var onMouseOut = function (e) {
        if (e.clientY <= 0 && !e.relatedTarget) fire();
      };
      doc.addEventListener('mouseout', onMouseOut);
      cleanups.push(function () { doc.removeEventListener('mouseout', onMouseOut); });
    }
    return function () { cleanups.forEach(function (fn) { fn(); }); };
  }

  var ARMERS = {
    exitIntent: armExitIntent,
  };

  function armDeferred(group, cb) {
    var cleanup = [];
    var fired = false;
    function fire() {
      if (fired) return;
      fired = true;
      cleanup.forEach(function (fn) { try { fn(); } catch (e) { /* noop */ } });
      try { cb(); } catch (e) { /* consumer error — not ours */ }
    }
    try {
      var rules = (group && Array.isArray(group.rules)) ? group.rules : [];
      var armed = {};
      for (var i = 0; i < rules.length; i++) {
        var type = rules[i] && rules[i].type;
        if (type && DEFERRABLE[type] && ARMERS[type] && !armed[type]) {
          armed[type] = true;
          cleanup.push(ARMERS[type](fire));
        }
      }
    } catch (e) {
      fire(); // arming failed — fail open by firing immediately
    }
    return function () {
      cleanup.forEach(function (fn) { try { fn(); } catch (e) { /* noop */ } });
    };
  }

  /* ------------------------------------------------------------------ *
   * Public surface
   * ------------------------------------------------------------------ */

  root.tgseRules = {
    version: VERSION,
    types: Object.keys(EVALUATORS),
    deferrableTypes: Object.keys(DEFERRABLE),
    evaluate: evaluate,
    armDeferred: armDeferred,
    getDevice: getDevice,
    isReturningVisitor: isReturningVisitor,
    getEntrySource: getEntrySource,
    storage: { read: readKey, write: writeKey, remove: removeKey },
    _resetMemo: function () { _returningMemo = null; }, // test hook
  };
})();
