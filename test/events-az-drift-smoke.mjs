/**
 * One A to Z, no drift (15 Sep 2026).
 *
 * Andy, after the first A to Z shipped: "The AtoZ have you done that for all
 * sports, leagues etc". Sorting by name now happens in three runtimes: the feed
 * (api/events-feed.js), every editor's sport and league lists
 * (public/editor-events-kit.js) and the menu a visitor browses
 * (public/widget-eventmenu.js). Neither browser file can import from the
 * server, so each carries the same eight lines between two markers.
 *
 * Alphabetical is not one rule but three decisions - accents, case and digits -
 * and a copy that quietly drops `sensitivity: 'base'` files Bayern München after
 * Zenit on one screen and under M on the next. So the copies are compared byte
 * for byte, and the comparator is exercised on the names that actually caught
 * people out.
 *
 * Also guards the rule the three of them serve: WHICH rows survive a limit is
 * decided by how busy each one is, and the ORDER they are read in is A to Z.
 *
 * Run: node test/events-az-drift-smoke.mjs   (npm run test:events-az-drift)
 */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const R = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
let passed = 0, failed = 0;
const ok = (label, cond, detail) => {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.error('  ✗ ' + label + (detail ? '\n      ' + detail : '')); }
};

const START = '// >>> a to z';
const END = '// <<< a to z';
const dedent = (block) => block.split('\n').map((l) => (l.startsWith('  ') ? l.slice(2) : l)).join('\n');
function core(src) {
  const a = src.indexOf(START), b = src.indexOf(END);
  if (a < 0 || b < 0) return null;
  return src.slice(a, b + END.length);
}

const FILES = {
  'api/events-feed.js': R('api/events-feed.js'),
  'public/editor-events-kit.js': R('public/editor-events-kit.js'),
  'public/widget-eventmenu.js': R('public/widget-eventmenu.js'),
};

console.log('The three runtimes carry the same comparator');
const server = core(FILES['api/events-feed.js']);
{
  ok('the feed marks its comparator', !!server);
  for (const [path, src] of Object.entries(FILES)) {
    if (path === 'api/events-feed.js') continue;
    const copy = core(src);
    ok(path + ' marks its copy', !!copy);
    const same = !!copy && dedent(copy) === server;
    ok(path + ' is byte for byte the feed\'s (two spaces of indentation aside)', same);
    if (copy && !same) {
      const sl = server.split('\n'), cl = dedent(copy).split('\n');
      for (let i = 0; i < Math.max(sl.length, cl.length); i++) {
        if (sl[i] !== cl[i]) {
          console.error('    first difference at line ' + (i + 1) + ':\n      feed: ' + sl[i] + '\n      copy: ' + cl[i]);
          break;
        }
      }
    }
  }
  ok('it reads a name or a label, so sports and leagues sort too',
    /a\.name \|\| a\.label/.test(server || ''));
  ok('it is accent-insensitive, case-insensitive and number-aware',
    /sensitivity: 'base'/.test(server || '') && /numeric: true/.test(server || ''));
}

console.log('And it orders the names that catch people out');
{
  // eslint-disable-next-line no-new-func
  const byName = new Function(server + '\nreturn byName;')();
  const sorted = (names) => names.slice().sort(byName);

  ok('an accent files under its letter, not after Z',
    sorted([{ name: 'Zenit' }, { name: 'Bayern München' }, { name: 'Athletic Club' }])
      .map((x) => x.name).join(' | ') === 'Athletic Club | Bayern München | Zenit');
  ok('a lower-case name is not exiled below the capitals',
    sorted([{ name: 'Brentford' }, { name: 'aris' }, { name: 'Celtic' }])
      .map((x) => x.name)[0] === 'aris');
  ok('2. Bundesliga sits before 10th, not after it',
    sorted([{ label: '10th Man Cup' }, { label: '2. Bundesliga' }])
      .map((x) => x.label)[0] === '2. Bundesliga');
  ok('sports sort on their label', sorted([{ label: 'Rugby' }, { label: 'Athletics' }])
    .map((x) => x.label)[0] === 'Athletics');
  ok('a missing name does not throw', sorted([{}, { name: 'Arsenal' }]).length === 2);
}

console.log('The lists that read A to Z say so');
{
  const kit = FILES['public/editor-events-kit.js'];
  ok('one shared sport dropdown, sorted', /function sportOptions\(sel, categories\)/.test(kit)
    && /\(categories \|\| \[\]\)\.slice\(\)\.sort\(byName\)/.test(kit));
  ok('the kit hands byName and sportOptions to the editors',
    /byName: byName,/.test(kit) && /sportOptions: sportOptions,/.test(kit));
  ok('the league picker takes the busiest forty and then reads them A to Z',
    /\.slice\(0, 40\)\.sort\(byName\)/.test(kit));

  for (const f of ['tickets', 'nextevent', 'clubpicker', 'ticketsearch', 'ticketmonth']) {
    const src = R('public/editor-' + f + '.html');
    ok('editor-' + f + ' fills its sport dropdown from the kit',
      /K\.sportOptions\('f-category', d\.categories\)/.test(src)
      && !/\(d\.categories \|\| \[\]\)\.forEach/.test(src));
  }
  ok('editor-eventmenu sorts its sport checkboxes', /\.sort\(K\.byName\)/.test(R('public/editor-eventmenu.html')));

  const menu = FILES['public/widget-eventmenu.js'];
  ok('the menu lists leagues A to Z', /return it;\n\s*\}\)\.sort\(byName\);/.test(menu));
  ok('and reads its popular lists A to Z while still choosing the busiest',
    /s\.src\.slice\(\)\.sort\(byName\)\.filter/.test(menu));

  const picker = R('public/widget-clubpicker.js');
  ok('the Club Picker grid asks the feed for A to Z', /sort: 'name'/.test(picker));
  ok('and lets the feed narrow grounds to a sport', /q\.category = c\.category;/.test(picker));
  ok('the browser-side sport filter that emptied the artist grid is gone',
    !/indexOf\(self\.cfg\.category\) !== -1/.test(picker));
}

console.log('The Event Menu\'s own headings read A to Z');
{
  // 15 Sep 2026, Andy: "yes change the sport headings to alphabetical too".
  // Sports were listed busiest first. Mounted for real, because the order a
  // visitor sees is built at render time out of the competitions, not read off
  // the index.
  const INDEX = {
    categories: [{ label: 'Football', slug: 'football', events: 5879 },
      { label: 'Rugby', slug: 'rugby', events: 99 }],
    competitions: [
      { slug: 'epl', label: 'Premier League', country: 'England', category: 'football', categoryLabel: 'Football', events: 3000 },
      { slug: 'laliga', label: 'La Liga', country: 'Spain', category: 'football', categoryLabel: 'Football', events: 2879 },
      { slug: 'nhl', label: 'NHL', country: 'USA', category: 'ice-hockey', categoryLabel: 'Ice Hockey', events: 818 },
      { slug: 'six', label: 'Six Nations', country: '', category: 'rugby', categoryLabel: 'Rugby', events: 15 },
      { slug: 'con', label: 'Concerts', country: '', category: 'entertainment', categoryLabel: 'Entertainment', events: 982 },
      { slug: 'odd', label: 'Odds and ends', country: '', category: 'unclassified', categoryLabel: 'Unclassified', events: 9 },
    ],
  };
  const dom = new JSDOM('<!doctype html><html><body></body></html>',
    { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://client.test/tickets' });
  const { window } = dom;
  window.requestAnimationFrame = (cb) => setTimeout(() => cb(0), 0);
  window.fetch = async (u) => (/[?&]view=/.test(String(u))
    ? { ok: true, status: 200, json: async () => ({ items: [], events: [], total: 0 }) }
    : { ok: true, status: 200, json: async () => INDEX });
  const tag = window.document.createElement('script');
  tag.textContent = FILES['public/widget-eventmenu.js'];
  window.document.body.appendChild(tag);

  const el = window.document.createElement('div');
  window.document.body.appendChild(el);
  const w = new window.TGEventMenuWidget(el, { appId: '250', linkPattern: '', groupBy: 'category',
    sections: ['competitions'], openFirstGroup: true, startWith: 'none' });
  await new Promise((r) => setTimeout(r, 60));

  const headings = w._groups().map((g) => g.label);
  ok('the sports read A to Z', headings.join(' | ') === 'Entertainment | Football | Ice Hockey | Rugby | Unclassified',
    headings.join(' | '));
  ok('the catch-all is last, not filed under U',
    headings[headings.length - 1] === 'Unclassified');
  // The real snapshot's proportions: football 5,879 events, entertainment
  // 1,108 in one big concerts listing. Biggest counts EVENTS, not rows, or a
  // sport with one busy league loses to a sport with two quiet ones.
  ok('and the busiest sport is still the one that opens, not the first alphabetically',
    Object.keys(w.openGroups || {}).join(',') === 'football', Object.keys(w.openGroups || {}).join(','));
  ok('the leagues inside a heading read A to Z too',
    w._groups()[1].items.map((x) => x.name).join(' | ') === 'La Liga | Premier League');
  ok('nothing ranks the headings by fixture count any more',
    !/rank\[slugify\(cat\.label\)/.test(FILES['public/widget-eventmenu.js']));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
