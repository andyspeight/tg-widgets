/**
 * Event Menu: a choice opens its events inside the widget (8 Sep 2026).
 *
 * Andy: "at the moment the event menu widget is just a link to other pages,
 * which is very time-consuming to set up ... list the events in the space on
 * the right so the widget is fully self-contained ... keep the option to add
 * a page slug, and if that is there it will go to that page, if it's not it
 * will show the results within the widget."
 *
 * Run: node test/eventmenu-results-smoke.mjs   (npm run test:eventmenu-results)
 */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const R = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const WIDGET = R('public/widget-eventmenu.js');
const EDITOR = R('public/editor-eventmenu.html');
const CONFIG_API = R('api/widget-config.js');
const DASH = R('public/index.html');
const DEMO = R('public/demo-eventmenu.html');
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
const EVENT = (over) => Object.assign({
  title: 'Arsenal v Chelsea', startDate: '2026-10-03', startTime: '15:00', timeKnown: true,
  venue: { name: 'Emirates Stadium' }, competitionLabel: 'Premier League', homeTeamKey: 'arsenal', awayTeamKey: 'chelsea',
  bookingOptions: [{ kind: 'ticket', label: 'Tickets', short: 'Book', url: 'https://dl.tvllnk.com/deeplink/t?fr=2026-10-03' }],
}, over || {});

function makeWindow(events) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://client.test/tickets' });
  const { window } = dom;
  window.requestAnimationFrame = (cb) => setTimeout(() => cb(0), 0);
  window.__calls = [];
  window.fetch = async (u) => {
    const url = String(u);
    window.__calls.push(url);
    if (/[?&]view=(competition|browse|team|venue|performer)(&|$)/.test(url)) {
      const list = typeof events === 'function' ? events(url) : events;
      return { ok: true, status: 200, json: async () => ({ events: list, total: list.length }) };
    }
    if (/[?&]view=/.test(url)) return { ok: true, status: 200, json: async () => ({ items: [], airports: [['LHR', 'London Heathrow']] }) };
    return { ok: true, status: 200, json: async () => INDEX };
  };
  const s = window.document.createElement('script'); s.textContent = WIDGET; window.document.body.appendChild(s);
  return window;
}
async function mount(window, cfg) {
  const el = window.document.createElement('div'); window.document.body.appendChild(el);
  const w = new window.TGEventMenuWidget(el, cfg);
  await sleep(40);
  return w;
}
const row = (w, key) => [...w.shadow.querySelectorAll('.tgmn-item')].find((b) => b.getAttribute('data-key') === key);
const click = (window, el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
const calls = (window, re) => window.__calls.filter((u) => re.test(u));

console.log('Blank page address: the events open beside the menu');
{
  const window = makeWindow([EVENT()]);
  const w = await mount(window, { layout: 'sidebar', appId: '250' });
  const html = () => w.shadow.innerHTML;
  ok('the menu and the panel sit in one split root', !!w.shadow.querySelector('.tgmn-root.tgmn-has-panel .tgmn-split') && !!w.shadow.querySelector('.tgmn-results.tgtk-root'));
  ok('before a choice the panel shows what\'s on (a browse call, all sports)', /What(&#39;|')s on/.test(html()) && calls(window, /view=browse/).length === 1 && !/category=/.test(calls(window, /view=browse/)[0]));
  ok('the browse call carries the client\'s AppID and the booking kinds', /appId=250/.test(calls(window, /view=browse/)[0]) && /booking=ticket(&|$)/.test(calls(window, /view=browse/)[0]));
  ok('rows are buttons, not links, so nothing leaves the page', row(w, 'epl') && row(w, 'epl').tagName === 'BUTTON' && !row(w, 'epl').getAttribute('href'));
  let detail = null;
  w.el.addEventListener('tg:eventmenu:select', (e) => { detail = e.detail; });
  click(window, row(w, 'epl'));
  await sleep(40);
  ok('the choice still fires tg:eventmenu:select for a developer', detail && detail.type === 'competition' && detail.key === 'epl' && detail.name === 'Premier League' && detail.href === '');
  ok('and asks the feed for that competition', calls(window, /view=competition&slug=epl/).length === 1 || calls(window, /view=competition.*slug=epl/).length === 1);
  ok('the panel is headed by the choice, with the count', /<h2 class="tgmn-rh">Premier League<\/h2>/.test(html()) && /1 event</.test(html()));
  ok('the card renders with its Book link into Travelify', /tgtk-card/.test(html()) && /Arsenal v Chelsea/.test(html()) && /href="https:\/\/dl\.tvllnk\.com\/deeplink\/t\?fr=2026-10-03"/.test(html()));
  ok('the chosen row is marked current', row(w, 'epl').getAttribute('aria-current') === 'page');
  ok('the menu itself was not torn down (the search box survived)', !!w.shadow.querySelector('.tgmn-input'));
}

console.log('\nA developer who takes the choice keeps the panel out of it');
{
  const window = makeWindow([EVENT()]);
  const w = await mount(window, { layout: 'sidebar', startWith: 'none' });
  ok('startWith none: a prompt, no feed call', /Choose a competition, club, venue or artist/.test(w.shadow.innerHTML) && calls(window, /view=browse/).length === 0);
  w.el.addEventListener('tg:eventmenu:select', (e) => e.preventDefault());
  click(window, row(w, 'epl'));
  await sleep(30);
  ok('preventDefault: nothing chosen, nothing fetched', w.sel === null && calls(window, /view=competition/).length === 0);
}

console.log('\nA page address set: rows link there, as before');
{
  const window = makeWindow([EVENT()]);
  const w = await mount(window, { layout: 'sidebar', linkPattern: '/tickets/{type}/{slug}', newTab: true });
  ok('no panel in the widget', !w.shadow.querySelector('.tgmn-results') && !w.shadow.querySelector('.tgmn-split'));
  ok('rows are links built from the pattern', row(w, 'epl').tagName === 'A' && row(w, 'epl').getAttribute('href') === '/tickets/competition/epl' && row(w, 'epl').getAttribute('target') === '_blank');
  ok('no feed call for events at all', calls(window, /view=(browse|competition)/).length === 0);
  let detail = null;
  w.el.addEventListener('tg:eventmenu:select', (e) => { detail = e.detail; e.preventDefault(); });
  click(window, row(w, 'epl'));
  await sleep(20);
  ok('the select event carries the href', detail && detail.href === '/tickets/competition/epl');
  ok('a javascript: pattern is refused and falls back to the panel', (() => { w.update({ linkPattern: 'javascript:alert(1)' }); return !!w.shadow.querySelector('.tgmn-results') && row(w, 'epl').tagName === 'BUTTON'; })());
}

console.log('\nOn a phone the drawer closes and the events fill the widget');
{
  const window = makeWindow([EVENT()]);
  const w = await mount(window, { layout: 'drawer' });
  ok('the panel sits under the Browse events button', !!w.shadow.querySelector('.tgmn-root.tgmn-stack > .tgmn-trigger') && !!w.shadow.querySelector('.tgmn-root.tgmn-stack > .tgmn-results'));
  click(window, w.shadow.querySelector('[data-open]'));
  await sleep(30);
  ok('the drawer opens', w.drawerOpen === true);
  click(window, row(w, 'epl'));
  await sleep(40);
  ok('the choice closes the drawer', w.drawerOpen === false);
  ok('and the events show below', /<h2 class="tgmn-rh">Premier League<\/h2>/.test(w.shadow.innerHTML) && /Arsenal v Chelsea/.test(w.shadow.innerHTML));
}

console.log('\nThe panel is the Tickets widget\'s own card');
{
  const hotel = { kind: 'ticket-hotel', label: 'Ticket + hotel', short: '+ Hotel', url: 'https://dl.tvllnk.com/deeplink/h?fr=2026-10-03' };
  const fly = { kind: 'ticket-flight-hotel', label: 'Flight package', short: '+ Flight & hotel', status: 'needs-origin', urlTemplate: 'https://dl.tvllnk.com/deeplink/f?org=__ORG__' };
  const window = makeWindow([EVENT({ title: 'Spurs v <b>Arsenal</b>', bookingOptions: [EVENT().bookingOptions[0], hotel, fly] })]);
  const w = await mount(window, { layout: 'sidebar', appId: '250', bookingKinds: ['ticket', 'ticket-hotel', 'ticket-flight-hotel'], resultsLayout: 'cards' });
  const html = w.shadow.innerHTML;
  // The heading is a text node, so markup in a title serialises escaped. (An
  // attribute such as the button's aria-label serialises its < and > raw, as
  // the HTML serialiser does for every attribute; that is not injection.)
  ok('the title is escaped', /<h3 class="tgtk-title">Spurs v &lt;b&gt;Arsenal&lt;\/b&gt;/.test(html) && !/<h3 class="tgtk-title">Spurs v <b>/.test(html));
  ok('the hotel package opens the stay calendar', /data-stay="https:\/\/dl\.tvllnk\.com\/deeplink\/h\?fr=2026-10-03"/.test(html));
  ok('the flight package opens the airport chooser', /data-fly="https:\/\/dl\.tvllnk\.com\/deeplink\/f\?org=__ORG__"/.test(html));
  ok('the query asked for all three kinds', /booking=ticket%2Cticket-hotel%2Cticket-flight-hotel/.test(calls(window, /view=browse/)[0]));
  ok('grid layout when asked', /class="tgtk-grid"/.test(html));
  click(window, w.shadow.querySelector('[data-stay]'));
  await sleep(10);
  ok('the stay calendar opens inside the panel', !!w.shadow.querySelector('.tgmn-results .tgtk-fly') && /When would you like to stay\?/.test(w.shadow.innerHTML));
  w.destroy();
  ok('destroy closes it', !w._stayUi);

  // With every kind unticked the API is asked for booking=none and builds no
  // options; the stub mirrors that (no bookingOptions, a plain ticket link the
  // fallback must NOT use), so the panel shows the event with no button.
  const window2 = makeWindow([EVENT({ bookingOptions: [], booking: { url: 'https://dl.tvllnk.com/deeplink/plain' } })]);
  const w2 = await mount(window2, { layout: 'sidebar', bookingKinds: [] });
  ok('every kind unticked: booking=none and no button', /booking=none/.test(calls(window2, /view=browse/)[0]) && !/tgtk-btn/.test(w2.shadow.innerHTML.replace(/<style>[\s\S]*?<\/style>/, '')) && /Arsenal v Chelsea/.test(w2.shadow.innerHTML));
}

console.log('\nEditing does not hammer the feed');
{
  const window = makeWindow([EVENT()]);
  const w = await mount(window, { layout: 'sidebar', onlyCategories: ['football'] });
  ok('one sport only: what\'s on is that sport', /view=browse.*category=football/.test(calls(window, /view=browse/)[0]));
  const before = calls(window, /view=browse/).length;
  w.update({ heading: 'Tickets', accent: '#ff0000' });
  await sleep(20);
  ok('a heading or colour change refetches nothing', calls(window, /view=browse/).length === before);
  w.update({ limit: 20 });
  await sleep(20);
  ok('a change to the query refetches once', calls(window, /view=browse/).length === before + 1 && /limit=20/.test(calls(window, /view=browse/).pop()));
}

console.log('\nThe editor, the config API, the dashboard and the demo follow');
{
  ok('editor: the page address is optional and blank by default', /linkPattern: '',/.test(EDITOR) && /Your page address \(optional\)/.test(EDITOR));
  ok('editor: an events panel section with the Tickets booking options', /id="sec-results"/.test(EDITOR) && /K\.bookingOptions\('book-opts'/.test(EDITOR) && /c\.seg\('f-start', 'startWith'\)/.test(EDITOR) && /c\.slider\('f-limit', 'v-limit', 'limit'\)/.test(EDITOR));
  ok('editor: the panel section hides when an address is set', /\$\('sec-results'\)\.hidden = !!pat;/.test(EDITOR));
  ok('editor: the preview stage gives the widget both columns in panel mode', /classList\.toggle\('is-full', !\(C\.linkPattern \|\| ''\)\.trim\(\)\)/.test(EDITOR) && /\.menu-col\.is-full \.pv-mock \{ display: none; \}/.test(EDITOR));
  ok('editor: every panel setting is synced back on load', ['segSync(\'f-start\'', 'sliderSync(\'f-limit\'', 'colourOptSync(\'f-pkgbg-swatch\'', "$('f-currency').value = C.currency"].every((t) => EDITOR.includes(t)));
  ok('config API: Event Menu now receives the client\'s AppID', /NEEDS_APP_ID = \[[^\]]*'Event Menu'\]/.test(CONFIG_API));
  ok('dashboard: the description says the events list beside it', /with their events listed beside it, or linking into your own pages/.test(DASH));
  ok('dashboard: the mini preview keeps a page address so the card stays a menu', /new window\.TGEventMenuWidget\(el, \{[^}]*linkPattern:'\/tickets\/\{type\}\/\{slug\}'/.test(DASH));
  ok('demo: in-widget events by default, with a switch to pages mode', /data-goes="panel" aria-pressed="true"/.test(DEMO) && /linkPattern: state\.goes === 'pages' \? '\/tickets\/\{type\}\/\{slug\}' : ''/.test(DEMO));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
