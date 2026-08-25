/**
 * Event widgets — visitor Home/Away filter for a team (client feedback, Aug 2026).
 *
 * When a widget lists a single team's fixtures, a Home/Away toggle appears at the
 * top so a visitor can filter to home or away games. It works on the already
 * loaded events (the feed tags each with homeTeamKey/awayTeamKey), so no extra
 * fetch. It only appears when there is a real split — both home AND away games in
 * the set.
 *
 * jsdom + a mocked feed. Covers the Club Picker (fixtures panel) and Event
 * Tickets (team source).
 *
 * Run: node test/event-home-away-smoke.mjs   (npm run test:event-home-away)
 */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

let passed = 0, failed = 0;
const ok = (name, cond) => { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; console.error('  ✗ ' + name); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TEAMS = [{ key: 'arsenal', name: 'Arsenal', initials: 'AR', hue: 210, home: 1, away: 1, homeVenueName: 'Emirates Stadium' }];
// One home game (Arsenal at home) and one away game (Arsenal away at Brighton).
const EVENTS = [
  { title: 'Arsenal vs Chelsea', startDate: '2026-09-12', timeKnown: true, startTime: '15:00', homeTeamKey: 'arsenal', awayTeamKey: 'chelsea', venue: { name: 'Emirates Stadium' }, bookingOptions: [{ kind: 'ticket', short: 'Book', url: 'https://dl.tvllnk.com/a' }] },
  { title: 'Brighton vs Arsenal', startDate: '2026-09-20', timeKnown: true, startTime: '17:30', homeTeamKey: 'brighton', awayTeamKey: 'arsenal', venue: { name: 'Amex Stadium' }, bookingOptions: [{ kind: 'ticket', short: 'Book', url: 'https://dl.tvllnk.com/b' }] },
];

function makeWindow(widgetPath) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'dangerously', pretendToBeVisual: true });
  const { window } = dom;
  window.fetch = async (url) => {
    const u = String(url);
    if (/[?&]view=teams(&|$)/.test(u)) return { ok: true, json: async () => ({ items: TEAMS }) };
    if (/[?&]view=team(&|$)/.test(u)) return { ok: true, json: async () => ({ events: EVENTS }) };
    return { ok: true, json: async () => ({ events: [], items: [] }) };
  };
  const s = window.document.createElement('script'); s.textContent = readFileSync(new URL(widgetPath, import.meta.url), 'utf8');
  window.document.body.appendChild(s);
  return window;
}

console.log('Club Picker: Home/Away toggle filters a club\'s fixtures');
{
  const window = makeWindow('../public/widget-clubpicker.js');
  const el = window.document.createElement('div'); window.document.body.appendChild(el);
  const w = new window.TGClubPickerWidget(el, { gridOf: 'team', competition: 'english-premier-league', maxEntities: 24, bookingKinds: ['ticket'] });
  await sleep(10);
  w.shadow.querySelector('.tgcp-tile[data-key="arsenal"]').dispatchEvent(new window.Event('click'));
  await sleep(10);

  const filter = w.shadow.querySelector('.tgcp-hafilter');
  ok('the Home/Away filter appears (both sides present)', !!filter);
  ok('it offers All, Home and Away', filter && filter.querySelectorAll('.tgcp-hf').length === 3);
  ok('both games show under All', w.shadow.querySelectorAll('.tgcp-row').length === 2);

  const homeBtn = [...w.shadow.querySelectorAll('.tgcp-hf')].find((b) => b.getAttribute('data-side') === 'home');
  homeBtn.dispatchEvent(new window.Event('click'));
  await sleep(5);
  let html = w.shadow.innerHTML;
  ok('Home shows only the home fixture', w.shadow.querySelectorAll('.tgcp-row').length === 1 && html.includes('Arsenal vs Chelsea') && !html.includes('Brighton vs Arsenal'));

  const awayBtn = [...w.shadow.querySelectorAll('.tgcp-hf')].find((b) => b.getAttribute('data-side') === 'away');
  awayBtn.dispatchEvent(new window.Event('click'));
  await sleep(5);
  html = w.shadow.innerHTML;
  ok('Away shows only the away fixture', w.shadow.querySelectorAll('.tgcp-row').length === 1 && html.includes('Brighton vs Arsenal') && !html.includes('Arsenal vs Chelsea'));

  const allBtn = [...w.shadow.querySelectorAll('.tgcp-hf')].find((b) => b.getAttribute('data-side') === 'all');
  allBtn.dispatchEvent(new window.Event('click'));
  await sleep(5);
  ok('All restores both fixtures', w.shadow.querySelectorAll('.tgcp-row').length === 2);
}

console.log('Event Tickets: Home/Away toggle filters a team\'s events');
{
  const window = makeWindow('../public/widget-tickets.js');
  const el = window.document.createElement('div'); window.document.body.appendChild(el);
  const w = new window.TGTicketsWidget(el, { sourceType: 'team', sourceValue: 'arsenal', competition: 'english-premier-league', bookingKinds: ['ticket'] });
  await sleep(15);

  const filter = w.shadow.querySelector('.tgtk-hafilter');
  ok('the Home/Away filter appears', !!filter);
  ok('it offers All, Home and Away', filter && filter.querySelectorAll('.tgtk-hf').length === 3);
  ok('both games show under All', w.shadow.innerHTML.includes('Arsenal vs Chelsea') && w.shadow.innerHTML.includes('Brighton vs Arsenal'));

  const click = (btn) => btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  click([...w.shadow.querySelectorAll('.tgtk-hf')].find((b) => b.getAttribute('data-side') === 'home'));
  await sleep(5);
  ok('Home shows only the home fixture', w.shadow.innerHTML.includes('Arsenal vs Chelsea') && !w.shadow.innerHTML.includes('Brighton vs Arsenal'));

  click([...w.shadow.querySelectorAll('.tgtk-hf')].find((b) => b.getAttribute('data-side') === 'away'));
  await sleep(5);
  ok('Away shows only the away fixture', w.shadow.innerHTML.includes('Brighton vs Arsenal') && !w.shadow.innerHTML.includes('Arsenal vs Chelsea'));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
