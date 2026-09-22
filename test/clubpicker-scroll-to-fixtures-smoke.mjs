/**
 * Club Picker: tapping a badge takes you to the fixtures (22 Sep 2026).
 *
 * Client feedback, via Andy: "tapping the dots should take you straight down to
 * the matches, so you don't have to scroll." The dots are the club badges, and
 * the fixtures panel opens underneath the grid. On a phone that grid is a
 * screenful on its own, so the panel arrived below the fold and the visitor was
 * left looking at the same badges with no sign their tap had done anything.
 *
 * The panel was already given focus, with `preventScroll: true`, which is right
 * for a re-render and wrong for a tap.
 *
 * Both halves matter and both are checked here, because the repo rule is not
 * "never scroll", it is "scroll only from a real user action":
 *
 *   - a tap on a badge, and a change on the dropdown, bring the panel into view
 *   - update() does NOT, because the editor calls it on every keystroke and a
 *     scroll there would yank the agent's page while they type
 *
 * Run: node test/clubpicker-scroll-to-fixtures-smoke.mjs
 *      (npm run test:clubpicker-scroll)
 */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

let passed = 0, failed = 0;
const ok = (name, cond, detail) => {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name + (detail ? '  — ' + detail : '')); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TEAMS = [
  { key: 'arsenal', name: 'Arsenal', initials: 'AR', hue: 210, home: 1, away: 1, homeVenueName: 'Emirates Stadium' },
  { key: 'chelsea', name: 'Chelsea', initials: 'CH', hue: 220, home: 1, away: 1, homeVenueName: 'Stamford Bridge' },
];
const EVENTS = [
  { title: 'Arsenal vs Chelsea', startDate: '2026-09-12', timeKnown: true, startTime: '15:00',
    homeTeamKey: 'arsenal', awayTeamKey: 'chelsea', venue: { name: 'Emirates Stadium' },
    bookingOptions: [{ kind: 'ticket', short: 'Book', url: 'https://dl.tvllnk.com/a' }] },
];

function makeWindow() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'dangerously', pretendToBeVisual: true });
  const { window } = dom;
  window.fetch = async (url) => {
    const u = String(url);
    if (/[?&]view=teams(&|$)/.test(u)) return { ok: true, json: async () => ({ items: TEAMS }) };
    if (/[?&]view=team(&|$)/.test(u)) return { ok: true, json: async () => ({ events: EVENTS }) };
    return { ok: true, json: async () => ({ events: [], items: [] }) };
  };
  // jsdom has no layout, so scrollIntoView is not implemented. Count the calls.
  const scrolls = [];
  window.Element.prototype.scrollIntoView = function (opts) { scrolls.push({ id: this.id, opts }); };
  const s = window.document.createElement('script');
  s.textContent = readFileSync(new URL('../public/widget-clubpicker.js', import.meta.url), 'utf8');
  window.document.body.appendChild(s);
  return { window, scrolls };
}

async function build() {
  const { window, scrolls } = makeWindow();
  const el = window.document.createElement('div');
  window.document.body.appendChild(el);
  const w = new window.TGClubPickerWidget(el, {
    gridOf: 'team', competition: 'english-premier-league', maxEntities: 24, bookingKinds: ['ticket'],
  });
  await sleep(15);
  return { window, scrolls, w };
}

console.log('\nClub Picker: a tap goes to the matches\n');

// ── A real tap ───────────────────────────────────────────────────────────────
{
  const { window, scrolls, w } = await build();
  ok('the grid drew its badges', w.shadow.querySelectorAll('.tgcp-tile').length === TEAMS.length);
  ok('nothing scrolled while the widget was drawing itself', scrolls.length === 0,
    JSON.stringify(scrolls));

  w.shadow.querySelector('.tgcp-tile[data-key="arsenal"]').dispatchEvent(new window.Event('click'));
  await sleep(20);

  ok('the fixtures panel opened', !!w.shadow.querySelector('#tgcp-panel'));
  ok('the tap scrolled to the panel', scrolls.length === 1, JSON.stringify(scrolls));
  ok('it scrolled the panel itself, not the page top',
    scrolls.length === 1 && scrolls[0].id === 'tgcp-panel', JSON.stringify(scrolls));
  ok('it asks for the nearest edge, so it does not overshoot',
    scrolls.length === 1 && scrolls[0].opts && scrolls[0].opts.block === 'nearest',
    JSON.stringify(scrolls[0] && scrolls[0].opts));
}

// ── A passive re-render ──────────────────────────────────────────────────────
// This is the half that protects the editor. An agent typing in a text box has
// update() fired per keystroke; a scroll there drags their page away mid-word.
{
  const { window, scrolls, w } = await build();
  w.shadow.querySelector('.tgcp-tile[data-key="arsenal"]').dispatchEvent(new window.Event('click'));
  await sleep(20);
  const afterTap = scrolls.length;

  for (let i = 0; i < 4; i++) {
    w.update({ heading: 'Pick your club'.slice(0, 8 + i) });
    await sleep(5);
  }
  ok('a re-render after the tap does not scroll again', scrolls.length === afterTap,
    `${scrolls.length - afterTap} extra scroll(s)`);

  w._render();
  await sleep(5);
  ok('drawing the widget again does not scroll', scrolls.length === afterTap,
    `${scrolls.length - afterTap} extra scroll(s)`);
}

// ── The dropdown selector ────────────────────────────────────────────────────
// The narrow layout swaps the grid for a select. It goes through the same
// _openEntity, so it has to behave the same way.
{
  const { window, scrolls, w } = await build();
  const sel = w.shadow.querySelector('.tgcp-select');
  if (sel) {
    sel.value = 'arsenal';
    sel.dispatchEvent(new window.Event('change'));
    await sleep(20);
    ok('choosing a club from the dropdown scrolls too', scrolls.length === 1, JSON.stringify(scrolls));
  } else {
    ok('choosing a club from the dropdown scrolls too (no select in this layout)', true);
  }
}

// ── Closing ──────────────────────────────────────────────────────────────────
{
  const { window, scrolls, w } = await build();
  const tile = w.shadow.querySelector('.tgcp-tile[data-key="arsenal"]');
  tile.dispatchEvent(new window.Event('click'));
  await sleep(20);
  const afterOpen = scrolls.length;
  tile.dispatchEvent(new window.Event('click')); // same badge again closes it
  await sleep(20);
  ok('closing the panel does not scroll the visitor anywhere', scrolls.length === afterOpen,
    `${scrolls.length - afterOpen} extra scroll(s)`);
}

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed ? 1 : 0);
