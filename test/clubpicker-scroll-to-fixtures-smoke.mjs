/**
 * Tapping something takes you to what it opened (22 Sep 2026).
 *
 * Covers the two event widgets that open a panel UNDERNEATH what you tapped:
 * Club Picker (a badge opens that club's fixtures) and Ticket Month (a date
 * opens that day's events). Event Menu already does the same thing in its
 * drawer; the other three have no panel to go to.
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
  // 'start', not 'nearest'. 'nearest' scrolls the least it can, and for a panel
  // taller than the screen it counts any sliver as in view and does nothing,
  // which is exactly the phone case this was meant to fix.
  ok('it puts the panel heading at the top, so the first fixtures show',
    scrolls.length === 1 && scrolls[0].opts && scrolls[0].opts.block === 'start',
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

// ── A panel already in view ──────────────────────────────────────────────────
// On a desktop the fixtures usually open in full view under the grid. Yanking
// the page then is its own annoyance, so the scroll has to measure first.
{
  const { window, scrolls, w } = await build();
  // Pretend the panel is sitting comfortably on screen already.
  const panel = w.shadow.getElementById
    ? w.shadow.getElementById('tgcp-panel') : w.shadow.querySelector('#tgcp-panel');
  window.Element.prototype.getBoundingClientRect = function () {
    return { top: 40, bottom: 600, left: 0, right: 900, width: 900, height: 560, x: 0, y: 40 };
  };
  w.shadow.querySelector('.tgcp-tile[data-key="arsenal"]').dispatchEvent(new window.Event('click'));
  await sleep(20);
  ok('a panel already on screen is left where it is', scrolls.length === 0, JSON.stringify(scrolls));

  // And one pushed below the fold still gets the scroll.
  window.Element.prototype.getBoundingClientRect = function () {
    return { top: 900, bottom: 1600, left: 0, right: 900, width: 900, height: 700, x: 0, y: 900 };
  };
  w.shadow.querySelector('.tgcp-tile[data-key="chelsea"]').dispatchEvent(new window.Event('click'));
  await sleep(20);
  ok('a panel below the fold is scrolled to', scrolls.length === 1, JSON.stringify(scrolls));
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

// ── Ticket Month: the same pattern, the same fix ─────────────────────────────
// A date opens that day's events under the month grid, and a month grid is a
// screenful on a phone just as the badge grid is.
console.log('\nTicket Month: a tap on a date goes to that day');
{
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'dangerously', pretendToBeVisual: true });
  const { window } = dom;
  const soon = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  window.fetch = async () => ({
    ok: true,
    json: async () => ({
      events: [{
        title: 'Arsenal vs Chelsea', startDate: soon, timeKnown: true, startTime: '15:00',
        homeTeamKey: 'arsenal', awayTeamKey: 'chelsea', venue: { name: 'Emirates Stadium' },
        bookingOptions: [{ kind: 'ticket', short: 'Book', url: 'https://dl.tvllnk.com/a' }],
      }],
      items: [],
    }),
  });
  const scrolls = [];
  window.Element.prototype.scrollIntoView = function (opts) { scrolls.push({ id: this.id, opts }); };
  const script = window.document.createElement('script');
  script.textContent = readFileSync(new URL('../public/widget-ticketmonth.js', import.meta.url), 'utf8');
  window.document.body.appendChild(script);

  const el = window.document.createElement('div');
  window.document.body.appendChild(el);
  const w = new window.TGTicketMonthWidget(el, { bookingKinds: ['ticket'] });
  await sleep(25);

  ok('the month drew', !!w.shadow.querySelector('[data-day]'));
  ok('nothing scrolled while it was drawing itself', scrolls.length === 0, JSON.stringify(scrolls));

  const day = Number(soon.slice(8, 10));
  const cell = w.shadow.querySelector('[data-day="' + day + '"]');
  ok('the day with an event is tappable', !!cell);
  if (cell) {
    cell.dispatchEvent(new window.Event('click'));
    await sleep(20);
    ok('opening a day scrolls to its events', scrolls.length === 1, JSON.stringify(scrolls));
    ok('it goes to the day panel, not the page top',
      scrolls.length === 1 && scrolls[0].id === 'tgtm-panel', JSON.stringify(scrolls));
    ok('it puts the panel at the top so the events show',
      scrolls.length === 1 && scrolls[0].opts && scrolls[0].opts.block === 'start',
      JSON.stringify(scrolls[0] && scrolls[0].opts));

    // Closing it again must not drag them anywhere.
    const afterOpen = scrolls.length;
    cell.dispatchEvent(new window.Event('click'));
    await sleep(20);
    ok('closing the day does not scroll', scrolls.length === afterOpen,
      `${scrolls.length - afterOpen} extra`);

    // And a re-render must not either.
    w.update({ heading: 'What is on' });
    await sleep(10);
    ok('a re-render does not scroll', scrolls.length === afterOpen,
      `${scrolls.length - afterOpen} extra`);
  }
}

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed ? 1 : 0);
