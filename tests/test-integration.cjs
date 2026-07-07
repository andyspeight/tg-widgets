/**
 * Integration tests for public/widget-smartsection.js running against the
 * real tgse-rules.js engine inside jsdom.
 *
 * Run: node tests/test-integration.cjs   (requires the jsdom devDependency)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ENGINE_SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'tgse-rules.js'), 'utf8');
const WIDGET_SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'widget-smartsection.js'), 'utf8');

function setup(bodyHtml, opts) {
  opts = opts || {};
  const dom = new JSDOM('<!doctype html><html><body>' + (bodyHtml || '') + '</body></html>', {
    url: opts.url || 'https://client-site.example/page',
    pretendToBeVisual: true,
    runScripts: 'outside-only',
  });
  const win = dom.window;
  if (opts.preview) win.__TG_PREVIEW__ = true;
  win.fetch = opts.fetch || (() => Promise.resolve({ ok: false }));
  if (opts.beforeScripts) opts.beforeScripts(win);
  win.eval(ENGINE_SRC);
  win.eval(WIDGET_SRC);
  return win;
}

const tick = (ms) => new Promise((r) => setTimeout(r, ms || 5));

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log('  ok  ' + name);
  } catch (e) {
    failed++;
    console.error('FAIL  ' + name);
    console.error('      ' + (e && e.stack ? e.stack.split('\n')[0] + ' ' + (e.stack.split('\n')[1] || '') : e));
  }
}
function eq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error((msg || 'assertion failed') + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
  }
}

(async () => {
  console.log('smart section integration tests (jsdom)');

  await test('1. hides while evaluating, then shows when there are no rules', async () => {
    const win = setup('<section id="s">Hello</section>');
    const el = win.document.getElementById('s');
    const w = new win.TGSmartSectionWidget(el, { rules: [] });
    eq(el.style.display, 'none', 'hidden during evaluation');
    eq(el.getAttribute('data-tgss-state'), 'evaluating', 'evaluating state');
    await tick();
    eq(el.getAttribute('data-tgss-state'), 'shown', 'shown after evaluation');
    eq(el.style.display, '', 'display restored');
    eq(typeof w.destroy, 'function');
  });

  await test('2. hides when the rules do not match', async () => {
    const win = setup('<section id="s">Offer</section>');
    const el = win.document.getElementById('s');
    // jsdom's innerWidth is 1024 -> the engine reports 'desktop'
    new win.TGSmartSectionWidget(el, { rules: [{ type: 'device', devices: ['mobile'] }] });
    await tick();
    eq(el.getAttribute('data-tgss-state'), 'hidden');
    eq(el.style.display, 'none');
    eq(el.getAttribute('data-tgss-reason'), 'rules did not match');
  });

  await test('3. auto-init picks up inline data-tg-config', async () => {
    const cfg = JSON.stringify({ rules: [] }).replace(/"/g, '&quot;');
    const win = setup('<div data-tg-widget="smartsection" data-tg-config="' + cfg + '"><p>Inline</p></div>');
    await tick();
    const el = win.document.querySelector('[data-tg-widget="smartsection"]');
    eq(el.__tgssInit, true, 'init guard set');
    eq(el.getAttribute('data-tgss-state'), 'shown');
  });

  await test('4. config fetch failure fails open (content visible)', async () => {
    const win = setup('<div data-tg-widget="smartsection" data-tg-id="tgw_x"><p>Kept</p></div>', {
      fetch: () => Promise.reject(new Error('network down')),
    });
    await tick();
    const el = win.document.querySelector('[data-tg-widget="smartsection"]');
    eq(el.style.display, '', 'content not hidden');
  });

  await test('5. remote config drives the decision', async () => {
    const config = { rules: [{ type: 'device', devices: ['mobile'] }] };
    const win = setup('<div data-tg-widget="smartsection" data-tg-id="tgw_y"><p>Mobile only</p></div>', {
      fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ config, name: 'Test' }) }),
    });
    await tick();
    const el = win.document.querySelector('[data-tg-widget="smartsection"]');
    eq(el.getAttribute('data-tgss-state'), 'hidden', 'desktop visitor hidden by mobile-only rule');
  });

  await test('6. dismiss button hides the section and persists the choice', async () => {
    const win = setup('<section id="s">Banner</section>');
    const el = win.document.getElementById('s');
    new win.TGSmartSectionWidget(el, { rules: [], dismissible: true, dismissDays: 30, widgetId: 'tgw_d1' });
    await tick();
    const btn = el.querySelector('[data-tgss-ui="dismiss"]');
    eq(!!btn, true, 'dismiss button rendered');
    btn.onclick();
    eq(el.getAttribute('data-tgss-state'), 'hidden', 'hidden after dismiss');
    const stored = JSON.parse(win.localStorage.getItem('tgsr_ss_tgw_d1_dismiss'));
    eq(typeof stored.expires, 'number', 'suppression persisted');
    eq(stored.expires > Date.now(), true, 'suppression in the future');
  });

  await test('7. a dismissed section stays hidden on the next visit', async () => {
    const win = setup('<section id="a">One</section><section id="b">Two</section>');
    const a = win.document.getElementById('a');
    const b = win.document.getElementById('b');
    new win.TGSmartSectionWidget(a, { rules: [], dismissible: true, widgetId: 'tgw_d2' });
    await tick();
    a.querySelector('[data-tgss-ui="dismiss"]').onclick();
    // simulate the next page view: a fresh widget instance, same storage
    new win.TGSmartSectionWidget(b, { rules: [], dismissible: true, widgetId: 'tgw_d2' });
    await tick();
    eq(b.getAttribute('data-tgss-state'), 'hidden');
    eq(b.getAttribute('data-tgss-reason'), 'dismissed');
  });

  await test('8. the per-visitor show cap is enforced', async () => {
    const win = setup('<section id="a">One</section><section id="b">Two</section>');
    const a = win.document.getElementById('a');
    const b = win.document.getElementById('b');
    new win.TGSmartSectionWidget(a, { rules: [], maxShows: 1, widgetId: 'tgw_f1' });
    await tick();
    eq(a.getAttribute('data-tgss-state'), 'shown', 'first view shows');
    new win.TGSmartSectionWidget(b, { rules: [], maxShows: 1, widgetId: 'tgw_f1' });
    await tick();
    eq(b.getAttribute('data-tgss-state'), 'hidden', 'second view capped');
    eq(b.getAttribute('data-tgss-reason'), 'show cap reached');
  });

  await test('9. exit intent defers, then reveals when the trigger fires', async () => {
    const win = setup('<section id="s">Wait, before you go…</section>');
    const el = win.document.getElementById('s');
    new win.TGSmartSectionWidget(el, { rules: [{ type: 'exitIntent' }] });
    await tick();
    eq(el.getAttribute('data-tgss-state'), 'deferred', 'waiting for the trigger');
    eq(el.style.display, 'none', 'hidden while deferred');
    const evt = new win.MouseEvent('mouseout', { bubbles: true, clientY: 0 });
    win.document.dispatchEvent(evt);
    await tick();
    eq(el.getAttribute('data-tgss-state'), 'shown', 'revealed on exit intent');
  });

  await test('10. preview mode always shows content with a status badge, and destroy() cleans up', async () => {
    const win = setup('<section id="s">Editing</section>', { preview: true });
    const el = win.document.getElementById('s');
    const w = new win.TGSmartSectionWidget(el, { rules: [{ type: 'device', devices: ['mobile'] }], dismissible: true });
    await tick();
    eq(el.getAttribute('data-tgss-state'), 'shown', 'content visible in preview despite failing rule');
    const badge = el.querySelector('[data-tgss-ui="badge"]');
    eq(!!badge, true, 'badge rendered');
    eq(badge.textContent.indexOf('hidden for this visitor') !== -1, true, 'badge explains the real outcome');
    eq(win.localStorage.getItem('tgsr_ss_default_shows'), null, 'nothing persisted in preview');
    w.destroy();
    eq(el.querySelector('[data-tgss-ui="badge"]'), null, 'badge removed');
    eq(el.getAttribute('data-tgss-state'), null, 'state attribute cleared');
  });

  await test('11. preview simulation: a returning-visitor context makes a returning-only rule read visible', async () => {
    const win = setup('<section id="s">Welcome back</section>', { preview: true });
    const el = win.document.getElementById('s');
    win.__TG_PREVIEW_CTX__ = { returning: true };
    new win.TGSmartSectionWidget(el, { rules: [{ type: 'visitorType', value: 'returning' }] });
    await tick();
    eq(el.getAttribute('data-tgss-state'), 'shown', 'content still shown in preview');
    const badge = el.querySelector('[data-tgss-ui="badge"]');
    eq(badge.textContent.indexOf('visible to this visitor') !== -1, true, 'badge reads visible for a simulated returning visitor');
  });

  await test('12. preview simulation: device context flips a mobile-only rule between hidden and visible', async () => {
    const desk = setup('<section id="s">Mobile only</section>', { preview: true });
    const deskEl = desk.document.getElementById('s');
    desk.__TG_PREVIEW_CTX__ = { device: 'desktop' };
    new desk.TGSmartSectionWidget(deskEl, { rules: [{ type: 'device', devices: ['mobile'] }] });
    await tick();
    const deskBadge = deskEl.querySelector('[data-tgss-ui="badge"]');
    eq(deskBadge.textContent.indexOf('hidden for this visitor') !== -1, true, 'desktop sim reads hidden under a mobile-only rule');

    const mob = setup('<section id="s2">Mobile only</section>', { preview: true });
    const mobEl = mob.document.getElementById('s2');
    mob.__TG_PREVIEW_CTX__ = { device: 'mobile' };
    new mob.TGSmartSectionWidget(mobEl, { rules: [{ type: 'device', devices: ['mobile'] }] });
    await tick();
    const mobBadge = mobEl.querySelector('[data-tgss-ui="badge"]');
    eq(mobBadge.textContent.indexOf('visible to this visitor') !== -1, true, 'mobile sim flips the same rule to visible');
  });

  console.log('');
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
