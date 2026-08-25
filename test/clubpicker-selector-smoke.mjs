/**
 * Club Picker — selector mode: grid / dropdown / both (client feedback, Aug 2026).
 *
 * The badge grid can now be shown as a dropdown instead, or both together. The
 * dropdown drives the exact same "open this club's fixtures" path as a tile, so
 * picking from it loads fixtures the same way.
 *
 * jsdom + a mocked feed — no network.
 *
 * Run: node test/clubpicker-selector-smoke.mjs   (npm run test:clubpicker-selector)
 */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const WIDGET = readFileSync(new URL('../public/widget-clubpicker.js', import.meta.url), 'utf8');

let passed = 0, failed = 0;
const ok = (name, cond) => { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; console.error('  ✗ ' + name); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TEAMS = [
  { key: 'arsenal', name: 'Arsenal', initials: 'AR', hue: 210, home: 19, away: 19, homeVenueName: 'Emirates Stadium' },
  { key: 'chelsea', name: 'Chelsea', initials: 'CH', hue: 120, home: 19, away: 19, homeVenueName: 'Stamford Bridge' },
];
const EVENTS = [
  { title: 'Arsenal vs Chelsea', startDate: '2026-09-12', timeKnown: true, startTime: '15:00', homeTeamKey: 'arsenal', awayTeamKey: 'chelsea', venue: { name: 'Emirates Stadium' }, bookingOptions: [{ kind: 'ticket', short: 'Book', url: 'https://dl.tvllnk.com/x' }] },
];

function mount(cfg) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'dangerously', pretendToBeVisual: true });
  const { window } = dom;
  const calls = [];
  window.fetch = async (url) => {
    const u = String(url); calls.push(u);
    if (/[?&]view=teams(&|$)/.test(u)) return { ok: true, json: async () => ({ items: TEAMS }) };
    if (/[?&]view=team(&|$)/.test(u)) return { ok: true, json: async () => ({ events: EVENTS }) };
    return { ok: true, json: async () => ({}) };
  };
  const s = window.document.createElement('script'); s.textContent = WIDGET; window.document.body.appendChild(s);
  const el = window.document.createElement('div');
  window.document.body.appendChild(el);
  const w = new window.TGClubPickerWidget(el, Object.assign({ gridOf: 'team', competition: 'english-premier-league', maxEntities: 24 }, cfg));
  return { window, w, calls, el };
}

console.log('Dropdown mode shows a <select>, not a grid');
{
  const { w } = mount({ selectorMode: 'dropdown' });
  await sleep(10);
  const sel = w.shadow.querySelector('.tgcp-select');
  ok('a select renders', !!sel);
  ok('it has a placeholder + one option per club', sel && sel.querySelectorAll('option').length === 3);
  ok('the placeholder option is disabled', sel && sel.querySelector('option[disabled]'));
  ok('no badge grid is rendered', !w.shadow.querySelector('.tgcp-grid'));
}

console.log('Both mode shows the dropdown AND the grid');
{
  const { w } = mount({ selectorMode: 'both' });
  await sleep(10);
  ok('the select renders', !!w.shadow.querySelector('.tgcp-select'));
  ok('the grid renders too', !!w.shadow.querySelector('.tgcp-grid'));
}

console.log('Grid mode (default) shows the grid, no dropdown');
{
  const { w } = mount({});
  await sleep(10);
  ok('the grid renders', !!w.shadow.querySelector('.tgcp-grid'));
  ok('no select is rendered', !w.shadow.querySelector('.tgcp-select'));
}

console.log('Picking from the dropdown opens that club\'s fixtures');
{
  const { window, w, calls } = mount({ selectorMode: 'dropdown' });
  await sleep(10);
  const sel = w.shadow.querySelector('.tgcp-select');
  sel.value = 'arsenal';
  sel.dispatchEvent(new window.Event('change'));
  await sleep(10);
  ok('the widget marks arsenal open', w.openKey === 'arsenal');
  ok('it fetched that team\'s fixtures', calls.some((u) => /view=team(&|$)/.test(u) && /key=arsenal/.test(u)));
  ok('the fixtures panel renders', !!w.shadow.querySelector('.tgcp-panel'));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
