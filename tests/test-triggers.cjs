/**
 * Tests for the shared trigger system: tgseRules.armTrigger (public/tgse-rules.js)
 * and Popup's delegation to it (public/widget-popup.js).
 *
 * armTrigger is the canonical implementation of the event triggers Popup used
 * to inline. These tests pin each trigger's fire condition, and confirm Popup
 * hands the engine a correctly-mapped spec so behaviour is preserved.
 *
 * Run: node tests/test-triggers.cjs
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ENGINE_SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'tgse-rules.js'), 'utf8');
const POPUP_SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'widget-popup.js'), 'utf8');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; console.error('FAIL  ' + name); console.error('      ' + (e && e.stack ? e.stack.split('\n').slice(0, 2).join(' ') : e)); }
}
function eq(a, b, msg) { if (a !== b) throw new Error((msg || 'assert') + ' — expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }
function ok(v, msg) { if (!v) throw new Error(msg || 'expected truthy'); }

// A jsdom window with controllable timers and layout metrics, then the engine.
function engineEnv(opts) {
  opts = opts || {};
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://site.example/', pretendToBeVisual: true, runScripts: 'outside-only' });
  const win = dom.window;

  // Fake timers we can flush deterministically.
  const timers = [];
  win.setTimeout = (fn, ms) => { timers.push({ fn, ms: ms || 0, cleared: false }); return timers.length - 1; };
  win.clearTimeout = (id) => { if (timers[id]) timers[id].cleared = true; };
  win._flush = (uptoMs) => timers.forEach((t) => { if (!t.cleared && t.ms <= uptoMs) { t.cleared = true; t.fn(); } });

  // Layout metrics for the scroll trigger (jsdom does no layout).
  win._scrollY = 0;
  Object.defineProperty(win, 'scrollY', { configurable: true, get: () => win._scrollY });
  Object.defineProperty(win, 'pageYOffset', { configurable: true, get: () => win._scrollY });
  Object.defineProperty(win, 'innerHeight', { configurable: true, get: () => opts.innerHeight || 1000 });
  if (opts.innerWidth) Object.defineProperty(win, 'innerWidth', { configurable: true, get: () => opts.innerWidth });
  Object.defineProperty(win.document.body, 'scrollHeight', { configurable: true, get: () => opts.scrollHeight || 0 });
  Object.defineProperty(win.document.documentElement, 'scrollHeight', { configurable: true, get: () => opts.scrollHeight || 0 });

  win.globalThis = win;
  win.eval(ENGINE_SRC);
  return win;
}

console.log('shared trigger system tests');

// ── load / time ───────────────────────────────────────────────────────────
test('1. load fires after its delay (default 0)', () => {
  const win = engineEnv();
  let fired = 0;
  win.tgseRules.armTrigger({ type: 'load' }, () => fired++);
  eq(fired, 0, 'not before flush');
  win._flush(0);
  eq(fired, 1, 'fires at delay 0');
});

test('2. time uses a 5000ms default (0/undefined delay does not fire early)', () => {
  const win = engineEnv();
  let fired = 0;
  win.tgseRules.armTrigger({ type: 'time', delay: 0 }, () => fired++); // 0 -> falsy -> 5000
  win._flush(100);
  eq(fired, 0, 'not fired at 100ms');
  win._flush(5000);
  eq(fired, 1, 'fired at 5000ms');
});

test('3. time honours an explicit delay', () => {
  const win = engineEnv();
  let fired = 0;
  win.tgseRules.armTrigger({ type: 'time', delay: 250 }, () => fired++);
  win._flush(200); eq(fired, 0, 'not at 200');
  win._flush(250); eq(fired, 1, 'at 250');
});

// ── scroll ──────────────────────────────────────────────────────────────
test('4. scroll fires once past the percentage, not before', () => {
  const win = engineEnv({ innerHeight: 1000, scrollHeight: 2000 }); // docH = 1000
  let fired = 0;
  win.tgseRules.armTrigger({ type: 'scroll', scrollPercent: 50 }, () => fired++);
  win._scrollY = 400; // 40%
  win.dispatchEvent(new win.Event('scroll'));
  eq(fired, 0, 'not at 40%');
  win._scrollY = 600; // 60%
  win.dispatchEvent(new win.Event('scroll'));
  eq(fired, 1, 'fires at 60%');
});

// ── exit intent ───────────────────────────────────────────────────────────
test('5. exit intent (desktop) fires on mouseout past the top edge', () => {
  const win = engineEnv({ innerWidth: 1200 }); // desktop
  let fired = 0;
  win.tgseRules.armTrigger({ type: 'exitIntent' }, () => fired++);
  const away = new win.MouseEvent('mouseout', { clientY: 5, bubbles: true });
  win.document.dispatchEvent(away);
  eq(fired, 0, 'inside the page does not fire');
  const leave = new win.MouseEvent('mouseout', { clientY: 0, bubbles: true }); // relatedTarget null
  win.document.dispatchEvent(leave);
  eq(fired, 1, 'leaving via the top fires');
});

// ── click ──────────────────────────────────────────────────────────────
test('6. click fires only for the configured selector', () => {
  const win = engineEnv();
  win.document.body.innerHTML = '<button id="cta">Go</button><button id="other">No</button>';
  let fired = 0;
  win.tgseRules.armTrigger({ type: 'click', selector: '#cta' }, () => fired++);
  win.document.getElementById('other').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  eq(fired, 0, 'other button does not fire');
  win.document.getElementById('cta').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  eq(fired, 1, 'the selector fires');
});

test('7. click with no selector never fires', () => {
  const win = engineEnv();
  win.document.body.innerHTML = '<button id="x">x</button>';
  let fired = 0;
  const cleanup = win.tgseRules.armTrigger({ type: 'click', selector: '   ' }, () => fired++);
  win.document.getElementById('x').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  eq(fired, 0, 'no selector, no fire');
  eq(typeof cleanup, 'function', 'still returns a cleanup');
});

// ── inactivity ───────────────────────────────────────────────────────────
test('8. inactivity fires after the idle window and resets on activity', () => {
  const win = engineEnv();
  let fired = 0;
  win.tgseRules.armTrigger({ type: 'inactivity', inactivitySeconds: 5 }, () => fired++); // 5000ms
  win._flush(4000); eq(fired, 0, 'not yet idle');
  win.document.dispatchEvent(new win.Event('keydown')); // resets the timer
  win._flush(5000); eq(fired, 1, 'fires once the idle window elapses');
});

// ── pageviews ────────────────────────────────────────────────────────────
test('9. pageviews counts across arms using the injected storage + key', () => {
  const win = engineEnv();
  const mem = new Map();
  const storage = {
    read: (k) => (mem.has(k) ? mem.get(k) : null),
    write: (k, v) => mem.set(k, v),
  };
  let fired = 0;
  const spec = { type: 'pageviews', pageviews: 2, storage, storageKey: 'pv_tgw_x' };
  win.tgseRules.armTrigger(spec, () => fired++); // 1st view
  eq(fired, 0, 'first view does not fire');
  eq(mem.get('pv_tgw_x'), 1, 'count persisted under the injected key');
  win.tgseRules.armTrigger(spec, () => fired++); // 2nd view
  eq(fired, 1, 'second view fires');
  eq(mem.get('pv_tgw_x'), 2, 'count incremented');
});

// ── one-shot guarantee ─────────────────────────────────────────────────────
test('10. a trigger fires at most once', () => {
  const win = engineEnv({ innerHeight: 1000, scrollHeight: 2000 });
  let fired = 0;
  win.tgseRules.armTrigger({ type: 'scroll', scrollPercent: 10 }, () => fired++);
  win._scrollY = 500;
  win.dispatchEvent(new win.Event('scroll'));
  win.dispatchEvent(new win.Event('scroll'));
  win.dispatchEvent(new win.Event('scroll'));
  eq(fired, 1, 'only the first qualifying event fires');
});

// ── Popup delegation ───────────────────────────────────────────────────────
test('11. Popup delegates to tgseRules.armTrigger with a correctly-mapped spec', () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://client.example/', pretendToBeVisual: true, runScripts: 'outside-only' });
  const win = dom.window;
  // Stub the shared engine so we capture what Popup hands it.
  let captured = null;
  win.tgseRules = {
    armTrigger: (spec) => { captured = spec; return () => {}; },
  };
  win.fetch = () => Promise.resolve({ ok: false });
  win.globalThis = win;
  win.eval(POPUP_SRC);

  ok(typeof win.TGPopupWidget === 'function', 'popup global exposed');
  const el = win.document.createElement('div');
  win.document.body.appendChild(el);
  // previewMode bypasses eligibility so _init reaches the trigger step.
  new win.TGPopupWidget(el, {
    previewMode: true,
    widgetId: 'tgw_p1',
    trigger: 'pageviews',
    triggerPageviews: 3,
    triggerDelay: 250,
    triggerScrollPercent: 70,
    triggerSelector: '#buy',
    triggerInactivitySeconds: 45,
  });

  ok(captured, 'Popup called tgseRules.armTrigger');
  eq(captured.type, 'pageviews', 'trigger type mapped');
  eq(captured.pageviews, 3, 'pageviews mapped');
  eq(captured.delay, 250, 'delay mapped');
  eq(captured.scrollPercent, 70, 'scrollPercent mapped');
  eq(captured.selector, '#buy', 'selector mapped');
  eq(captured.inactivitySeconds, 45, 'inactivitySeconds mapped');
  eq(captured.storageKey, 'pv_tgw_p1', 'pageviews key preserves Popup prefix/id');
  ok(captured.storage && typeof captured.storage.read === 'function', 'Popup storage injected');
});

test('12. Popup falls back to its inline triggers when the engine is absent', () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://client.example/', pretendToBeVisual: true, runScripts: 'outside-only' });
  const win = dom.window;
  // No window.tgseRules on this page.
  win.fetch = () => Promise.resolve({ ok: false });
  win.globalThis = win;
  win.eval(POPUP_SRC);
  const el = win.document.createElement('div');
  win.document.body.appendChild(el);
  // A load trigger with delay 0 opens on the next tick via the inline path.
  const inst = new win.TGPopupWidget(el, { previewMode: true, widgetId: 'tgw_p2', trigger: 'load', triggerDelay: 0 });
  ok(inst && Array.isArray(inst.cleanupFns) && inst.cleanupFns.length === 1, 'inline trigger armed, cleanup registered');
});

console.log('');
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
