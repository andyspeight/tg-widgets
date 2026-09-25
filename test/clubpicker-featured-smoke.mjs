/**
 * Club Picker: featured clubs, the banner style, and monograms a page
 * translator cannot touch (25 Sep 2026).
 *
 * Andy, from a client page: "Be able to select a number of teams as 'featured',
 * and then they would sit above the rest and be marked as 'featured Clubs'.
 * They would be removed from the all clubs listing. Have a design option so
 * that just the preferred teams and / or all the teams have the exact layout as
 * the design in the client's buttons." And: "if you look at Manchester City,
 * their badge doesnt say MC; it says Motorcycle." The client's page is Swedish,
 * where MC is the short form of motorcykel, and a browser translation rewrote
 * the monogram.
 *
 * jsdom + a mocked feed, no network.
 *
 * Run: node test/clubpicker-featured-smoke.mjs   (npm run test:clubpicker-featured)
 */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const WIDGET = readFileSync(new URL('../public/widget-clubpicker.js', import.meta.url), 'utf8');

let passed = 0, failed = 0;
const ok = (name, cond, detail) => {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (detail ? '  — ' + detail : '')); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The grid as the feed returns it: A to Z, the feed's own monograms and hues.
const TEAMS = [
  ['afc-bournemouth', 'A.F.C. Bournemouth', 'AF'], ['arsenal', 'Arsenal', 'AR'], ['chelsea', 'Chelsea', 'CH'],
  ['liverpool', 'Liverpool', 'LI'], ['manchester-city', 'Manchester City', 'MC'],
  ['manchester-united', 'Manchester United', 'MU'], ['tottenham-hotspur', 'Tottenham Hotspur', 'TH'],
  ['wolverhampton', 'Wolverhampton', 'WO'],
].map(([key, name, initials], i) => ({ key, name, initials, hue: 20 * i, home: 17, away: 17, homeVenueName: 'Ground ' + i }));

const EVENTS = [
  { title: 'Liverpool vs Arsenal', startDate: '2026-10-03', timeKnown: true, startTime: '15:00', homeTeamKey: 'liverpool', awayTeamKey: 'arsenal', venue: { name: 'Anfield' }, bookingOptions: [] },
];

function mount(cfg, { teams = TEAMS } = {}) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'dangerously', pretendToBeVisual: true });
  const { window } = dom;
  const calls = [];
  window.fetch = async (url) => {
    const u = String(url); calls.push(u);
    if (/[?&]view=teams(&|$)/.test(u)) return { ok: true, json: async () => ({ items: teams }) };
    if (/[?&]view=team(&|$)/.test(u)) return { ok: true, json: async () => ({ events: EVENTS }) };
    return { ok: true, json: async () => ({}) };
  };
  const s = window.document.createElement('script'); s.textContent = WIDGET; window.document.body.appendChild(s);
  const el = window.document.createElement('div');
  window.document.body.appendChild(el);
  const w = new window.TGClubPickerWidget(el, Object.assign({ gridOf: 'team', competition: 'english-premier-league', maxEntities: 24 }, cfg));
  return { window, w, calls, el };
}

// The client's six, in THEIR order (not A to Z).
const SIX = [
  { key: 'arsenal', name: 'Arsenal', image: 'https://img.example.com/arsenal.jpg' },
  { key: 'liverpool', name: 'Liverpool', image: 'https://img.example.com/liverpool.jpg' },
  { key: 'manchester-city', name: 'Manchester City' },
  { key: 'manchester-united', name: 'Manchester United' },
  { key: 'chelsea', name: 'Chelsea' },
  { key: 'tottenham-hotspur', name: 'Tottenham' },
];
const names = (nodes) => [...nodes].map((n) => n.textContent.trim());

console.log('\nWith nothing featured, the widget is exactly what it was');
{
  const { w } = mount({});
  await sleep(10);
  ok('no featured section', !w.shadow.querySelector('.tgcp-feat'));
  ok('every club is in the grid, as badge tiles', w.shadow.querySelectorAll('.tgcp-grid .tgcp-tile').length === TEAMS.length);
  ok('no banners anywhere', !w.shadow.querySelector('.tgcp-banner'));
  ok('the prompt still sits above the grid', /Pick a badge/.test(w.shadow.querySelector('.tgcp-prompt')?.textContent || ''));
}

console.log('\nFeatured clubs sit above the rest, marked, in the client\'s order');
{
  const { w } = mount({ featured: SIX });
  await sleep(10);
  const feat = w.shadow.querySelector('.tgcp-feat');
  ok('a featured section renders', !!feat);
  ok('headed "Featured clubs" by default', feat?.querySelector('.tgcp-sh')?.textContent === 'Featured clubs');
  ok('and it comes before the rest of the grid',
    !!feat && !!w.shadow.querySelector('.tgcp-grid') && (feat.compareDocumentPosition(w.shadow.querySelector('.tgcp-grid')) & 4) !== 0);
  ok('as banners by default, the client\'s design', feat?.querySelectorAll('.tgcp-banner').length === 6);
  ok('in the order the client chose, not A to Z',
    names(feat.querySelectorAll('.tgcp-banner-name')).join('|') === 'Arsenal|Liverpool|Manchester City|Manchester United|Chelsea|Tottenham Hotspur',
    names(feat.querySelectorAll('.tgcp-banner-name')).join('|'));
  const rest = names(w.shadow.querySelectorAll('.tgcp-grid .tgcp-tname'));
  ok('and they are gone from the list below', rest.join('|') === 'A.F.C. Bournemouth|Wolverhampton', rest.join('|'));
  ok('no club appears twice', new Set([...w.shadow.querySelectorAll('[data-key]')].map((n) => n.getAttribute('data-key'))).size
    === w.shadow.querySelectorAll('[data-key]').length);
}

console.log('\nA banner is the client\'s button: name, a round arrow, their photo');
{
  const { w } = mount({ featured: SIX });
  await sleep(10);
  const b = w.shadow.querySelector('.tgcp-banner[data-key="arsenal"]');
  ok('it is a real button', b?.tagName === 'BUTTON' && b.getAttribute('type') === 'button');
  ok('with the name', b?.querySelector('.tgcp-banner-name')?.textContent === 'Arsenal');
  ok('and the round arrow, hidden from screen readers', !!b?.querySelector('.tgcp-banner-go svg') && b.querySelector('.tgcp-banner-go').getAttribute('aria-hidden') === 'true');
  const img = b?.querySelector('img.tgcp-banner-img');
  ok('its photo is an <img> with the client\'s address', img?.getAttribute('src') === 'https://img.example.com/arsenal.jpg');
  ok('decorative, so it has an empty alt', img?.getAttribute('alt') === '');
  const plain = w.shadow.querySelector('.tgcp-banner[data-key="chelsea"]');
  ok('a club with no photo is a plain card in the banner colour', !!plain && !plain.querySelector('img') && !plain.classList.contains('has-img'));
  ok('no badge monogram on a banner (the client\'s design has none)', !b?.querySelector('.tgcp-badge'));
  const css = w.shadow.querySelector('style')?.textContent || '';
  ok('the banner colours default to the client\'s navy and white',
    /--tgcp-bn-bg:#0B1330/.test(css) && /--tgcp-bn-ink:#FFFFFF/.test(css));
  ok('three to a row at most, as on the client\'s page', /\.tgcp-bgrid\{display:grid;grid-template-columns:repeat\(auto-fill,minmax\(max\(240px,calc\(\(100% - 40px\) \/ 3\)\),1fr\)\)/.test(css));
}

console.log('\nThe client can have their own words, colours and photos');
{
  const { w } = mount({
    featured: SIX, featuredHeading: 'Utvalda klubbar', restHeading: 'Alla klubbar i Premier League',
    bannerColor: '#101820', bannerTextColor: '#FFD700', bannerImage: 'https://img.example.com/stadium.jpg',
    photos: [{ key: 'wolverhampton', name: 'Wolverhampton', image: 'https://img.example.com/molineux.jpg' }],
    gridStyle: 'banner',
  });
  await sleep(10);
  const heads = names(w.shadow.querySelectorAll('.tgcp-sh'));
  ok('their featured heading', heads[0] === 'Utvalda klubbar', heads.join('|'));
  ok('and a heading over the rest', heads[1] === 'Alla klubbar i Premier League', heads.join('|'));
  const css = w.shadow.querySelector('style')?.textContent || '';
  ok('their banner colours', /--tgcp-bn-bg:#101820/.test(css) && /--tgcp-bn-ink:#FFD700/.test(css));
  ok('the rest can be banners too', w.shadow.querySelectorAll('.tgcp-bgrid').length === 2 && !w.shadow.querySelector('.tgcp-tile'));
  const src = (k) => w.shadow.querySelector('.tgcp-banner[data-key="' + k + '"] img')?.getAttribute('src');
  ok('a featured club uses its own photo', src('liverpool') === 'https://img.example.com/liverpool.jpg');
  ok('a club in the photo list uses that one', src('wolverhampton') === 'https://img.example.com/molineux.jpg');
  ok('and every other banner the shared photo', src('chelsea') === 'https://img.example.com/stadium.jpg' && src('afc-bournemouth') === 'https://img.example.com/stadium.jpg');
  ok('the list below waits to load its photos until they are near', w.shadow.querySelector('.tgcp-banner[data-key="afc-bournemouth"] img')?.getAttribute('loading') === 'lazy');
}

console.log('\nFeatured clubs can be badge tiles instead');
{
  const { w } = mount({ featured: SIX.slice(0, 2), featuredStyle: 'tile' });
  await sleep(10);
  const feat = w.shadow.querySelector('.tgcp-feat');
  ok('the featured section is tiles', feat?.querySelectorAll('.tgcp-tile').length === 2 && !feat.querySelector('.tgcp-banner'));
  ok('with the feed\'s own monogram', feat?.querySelector('.tgcp-tile[data-key="arsenal"] .tgcp-badge')?.textContent === 'AR');
}

console.log('\nOpening a featured club works exactly like any other');
{
  const { window, w, calls } = mount({ featured: SIX });
  await sleep(10);
  w.shadow.querySelector('.tgcp-banner[data-key="liverpool"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await sleep(10);
  ok('it loads that club\'s fixtures', calls.some((u) => /[?&]view=team&/.test(u) && /[?&]key=liverpool(&|$)/.test(u)));
  ok('the panel is titled with the club', /Liverpool/.test(w.shadow.querySelector('.tgcp-ptitle')?.textContent || ''));
  ok('and the banner says it is open', w.shadow.querySelector('.tgcp-banner[data-key="liverpool"]')?.getAttribute('aria-expanded') === 'true');
  w.shadow.querySelector('.tgcp-banner[data-key="liverpool"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await sleep(10);
  ok('a second click closes it again', !w.shadow.querySelector('.tgcp-panel'));
}

console.log('\nA featured club the grid has not brought back still shows, by its saved name');
{
  const { window, w, calls } = mount({ featured: [{ key: 'sunderland-afc', name: 'Sunderland AFC' }] });
  await sleep(10);
  const b = w.shadow.querySelector('.tgcp-banner[data-key="sunderland-afc"]');
  ok('it is there', b?.querySelector('.tgcp-banner-name')?.textContent === 'Sunderland AFC');
  b.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await sleep(10);
  ok('and opens by its key', calls.some((u) => /[?&]key=sunderland-afc(&|$)/.test(u)));
  ok('titled with its saved name', /Sunderland AFC/.test(w.shadow.querySelector('.tgcp-ptitle')?.textContent || ''));
  const t = mount({ featured: [{ key: 'sunderland-afc', name: 'Sunderland AFC' }], featuredStyle: 'tile' });
  await sleep(10);
  const tile = t.w.shadow.querySelector('.tgcp-tile[data-key="sunderland-afc"]');
  ok('as a tile it takes the feed\'s monogram rule (AFC is dropped): SU', tile?.querySelector('.tgcp-badge')?.textContent === 'SU');
  ok('and claims no game count it does not know', !tile?.querySelector('.tgcp-tmeta'));
}

console.log('\nFeatured clubs are there before the grid has loaded');
{
  const dom = mount({ featured: SIX.slice(0, 3) });
  ok('three banners on the first paint', dom.w.shadow.querySelectorAll('.tgcp-feat .tgcp-banner').length === 3);
  ok('with the rest still loading underneath', !!dom.w.shadow.querySelector('.tgcp-grid[aria-busy="true"]'));
}

console.log('\nThe dropdown still lists every club');
{
  const { w } = mount({ featured: SIX, selectorMode: 'dropdown' });
  await sleep(10);
  ok('the featured section shows above it', w.shadow.querySelectorAll('.tgcp-feat .tgcp-banner').length === 6);
  ok('and the dropdown has all eight clubs plus its placeholder', w.shadow.querySelectorAll('.tgcp-select option').length === TEAMS.length + 1);
}

console.log('\nThe heading over the rest only appears when something is featured');
{
  const { w } = mount({ restHeading: 'All clubs' });
  await sleep(10);
  ok('no featured, no extra heading', !w.shadow.querySelector('.tgcp-sh'));
  const all = mount({ featured: TEAMS.map((t) => ({ key: t.key, name: t.name })).slice(0, 8), restHeading: 'All clubs' });
  await sleep(10);
  ok('every club featured: no empty rest, no heading over nothing',
    !all.w.shadow.querySelector('.tgcp-grid') && names(all.w.shadow.querySelectorAll('.tgcp-sh')).join('|') === 'Featured clubs');
}

console.log('\nWhat the config can smuggle in, it cannot');
{
  const { w } = mount({
    featured: [
      { key: 'arsenal', name: 'Arsenal', image: 'javascript:alert(1)' },
      { key: 'arsenal', name: 'Arsenal again' },
      { key: 'Bad Key!', name: 'Nope' },
      { key: 'liverpool', name: 'Liverpool', image: 'http://insecure.example.com/a.jpg' },
      { key: 'chelsea', name: 'Chelsea', image: 'https://x.example.com/a.jpg" onerror="alert(1)' },
      { key: 'manchester-city', name: '<img src=x onerror=alert(1)>' },
    ],
    bannerColor: 'red;background:url(https://evil)', bannerTextColor: 'expression(1)',
  });
  await sleep(10);
  const keys = [...w.shadow.querySelectorAll('.tgcp-feat [data-key]')].map((n) => n.getAttribute('data-key'));
  ok('a repeated or malformed key is dropped', keys.join('|') === 'arsenal|liverpool|chelsea|manchester-city', keys.join('|'));
  ok('no photo that is not a plain https address', !w.shadow.querySelector('.tgcp-feat img'));
  ok('no injected element from a name', !w.shadow.querySelector('.tgcp-feat .tgcp-banner-name img'));
  const css = w.shadow.querySelector('style')?.textContent || '';
  ok('a colour that is not a colour falls back to the default', /--tgcp-bn-bg:#0B1330;/.test(css) && /--tgcp-bn-ink:#FFFFFF;/.test(css) && !/evil|expression/.test(css));
  const many = mount({ featured: Array.from({ length: 20 }, (_, i) => ({ key: 'club-' + i, name: 'Club ' + i })) });
  ok('at most twelve featured', many.w.shadow.querySelectorAll('.tgcp-feat .tgcp-banner').length === 12);
}

console.log('\nArtists and venues get their own word for featured');
{
  const { w } = mount({ gridOf: 'performer', featured: [{ key: 'coldplay', name: 'Coldplay' }] });
  await sleep(10);
  ok('"Featured artists"', w.shadow.querySelector('.tgcp-feat .tgcp-sh')?.textContent === 'Featured artists');
  const v = mount({ gridOf: 'venue', featured: [{ key: 'wembley', name: 'Wembley' }] });
  ok('"Featured venues"', v.w.shadow.querySelector('.tgcp-feat .tgcp-sh')?.textContent === 'Featured venues');
}

console.log('\nManchester City is MC, and a page translator may not change that');
{
  const { w } = mount({ featured: [{ key: 'arsenal', name: 'Arsenal' }], featuredStyle: 'tile' });
  await sleep(10);
  const mc = w.shadow.querySelector('.tgcp-tile[data-key="manchester-city"]');
  ok('the monogram reads MC', mc?.querySelector('.tgcp-badge')?.textContent === 'MC');
  ok('and is marked translate="no"', mc?.querySelector('.tgcp-badge')?.getAttribute('translate') === 'no');
  ok('so is the club\'s name', mc?.querySelector('.tgcp-tname')?.getAttribute('translate') === 'no');
  ok('every monogram in the widget is marked', [...w.shadow.querySelectorAll('.tgcp-badge')].every((b) => b.getAttribute('translate') === 'no'));
  const bn = mount({ featured: SIX });
  await sleep(10);
  ok('and every banner name', [...bn.w.shadow.querySelectorAll('.tgcp-banner-name')].every((b) => b.getAttribute('translate') === 'no'));
  const src = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
  ok('the Ticket Search widget marks its monograms and names too',
    /class="tgts-badge" translate="no"/.test(src('public/widget-ticketsearch.js')) && /class="tgts-cname" translate="no"/.test(src('public/widget-ticketsearch.js')));
  ok('and so do our own events pages', /translate: 'no'/.test(src('public/events-explorer.js')));
}

console.log('\nAn editor preview update does not reload the grid for a featured change');
{
  const { w, calls } = mount({});
  await sleep(10);
  const before = calls.filter((u) => /view=teams/.test(u)).length;
  w.update({ featured: SIX, featuredStyle: 'banner', bannerColor: '#222222' });
  await sleep(10);
  ok('no second grid fetch', calls.filter((u) => /view=teams/.test(u)).length === before);
  ok('and the featured section appears', w.shadow.querySelectorAll('.tgcp-feat .tgcp-banner').length === 6);
}

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed ? 1 : 0);
