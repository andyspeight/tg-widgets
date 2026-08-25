/**
 * Event Menu — two client fixes (Aug 2026).
 *
 * 1) Clicking a sport group in the DRAWER did nothing. The drawer panel is a
 *    child of the root, and both got a delegated click handler, so a group
 *    toggled open then instantly shut in one press. The root handler is now
 *    bound only when the sidebar panel lives in it, so the drawer has exactly
 *    one handler. Sidebar was always fine and must stay fine.
 * 2) The "Browse events" drawer button's icon + text colour was fixed. A new
 *    `triggerTextColor` config drives it (--tgmn-trigger-text), falling back to
 *    the theme default when unset.
 *
 * jsdom + a mocked feed.
 *
 * Run: node test/eventmenu-fixes-smoke.mjs   (npm run test:eventmenu-fixes)
 */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const WIDGET = readFileSync(new URL('../public/widget-eventmenu.js', import.meta.url), 'utf8');
const EDITOR = readFileSync(new URL('../public/editor-eventmenu.html', import.meta.url), 'utf8');

let passed = 0, failed = 0;
const ok = (name, cond) => { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; console.error('  ✗ ' + name); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const INDEX = {
  categories: [{ label: 'Football', slug: 'football' }, { label: 'Entertainment', slug: 'entertainment' }],
  competitions: [
    { slug: 'epl', label: 'Premier League', country: 'England', category: 'football', categoryLabel: 'Football', events: 20 },
    { slug: 'ent1', label: 'Concert Series', country: '', category: 'entertainment', categoryLabel: 'Entertainment', events: 5 },
  ],
};

function makeWindow() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://x.test/' });
  const { window } = dom;
  window.requestAnimationFrame = (cb) => setTimeout(() => cb(0), 0);
  window.fetch = async (u) => ({ ok: true, json: async () => (/view=/.test(String(u)) ? { items: [] } : INDEX) });
  const s = window.document.createElement('script'); s.textContent = WIDGET; window.document.body.appendChild(s);
  return window;
}

async function mount(window, cfg) {
  const el = window.document.createElement('div'); window.document.body.appendChild(el);
  const w = new window.TGEventMenuWidget(el, cfg);
  await sleep(30);
  if ((cfg.layout || 'auto') === 'drawer') {
    w.shadow.querySelector('[data-open]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await sleep(30);
  }
  return w;
}
const clickGroup = (window, w, key) => {
  const btn = [...w.shadow.querySelectorAll('[data-group]')].find((b) => b.getAttribute('data-group') === key);
  if (btn) btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
};

console.log('Clicking a sport group opens it — in BOTH the drawer and the sidebar');
for (const layout of ['drawer', 'sidebar']) {
  const window = makeWindow();
  const w = await mount(window, { layout });
  ok(layout + ': entertainment starts closed', !w.openGroups.entertainment);
  clickGroup(window, w, 'entertainment');
  await sleep(10);
  ok(layout + ': one click opens it (not a double-toggle)', w.openGroups.entertainment === true);
  ok(layout + ': its competition now shows', w.shadow.innerHTML.includes('Concert Series'));
  clickGroup(window, w, 'entertainment');
  await sleep(10);
  ok(layout + ': clicking again closes it', w.openGroups.entertainment === false);
}

console.log('The "Browse events" button text colour is configurable');
{
  const window = makeWindow();
  const w = await mount(window, { layout: 'drawer', triggerTextColor: '#ff0000' });
  // Re-render the trigger view (drawer is open; the trigger lives in root too).
  ok('a set colour injects --tgmn-trigger-text', w.shadow.innerHTML.includes('--tgmn-trigger-text:#ff0000'));
  ok('the trigger paints from it (with a theme fallback)', w.shadow.innerHTML.includes('color:var(--tgmn-trigger-text, var(--tgmn-on-accent))'));

  const window2 = makeWindow();
  const w2 = await mount(window2, { layout: 'drawer' });
  ok('unset injects no override (follows the theme)', !w2.shadow.innerHTML.includes('--tgmn-trigger-text:#'));
}

console.log('The editor exposes the Browse-events text colour, wired');
{
  ok('has the f-trigtext colour control', /id="f-trigtext-swatch"/.test(EDITOR) && /id="f-trigtext"/.test(EDITOR));
  ok('wires it to triggerTextColor', /c\.colour\('f-trigtext-swatch', 'f-trigtext', 'triggerTextColor'\)/.test(EDITOR));
  ok('syncs it', /c\.colourSync\('f-trigtext-swatch', 'f-trigtext', C\.triggerTextColor\)/.test(EDITOR));
  ok('has a default', /triggerTextColor: '#FFFFFF'/.test(EDITOR));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
