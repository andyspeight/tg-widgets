/**
 * Render smoke test for widget-attraction.js (no browser).
 * Drives the real widget IIFE against a DOM shim with a realistic attraction
 * payload and checks every section renders, hides gracefully when empty, and
 * respects the section toggles and the optional hero image.
 *
 * Run: node test/widget-attraction-render.test.mjs
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function makeEl(tag) {
  return {
    tagName: tag, className: '', _children: [], _attrs: {}, _html: '', _text: '',
    style: { setProperty() {} },
    set innerHTML(v) { this._html = String(v); }, get innerHTML() { return this._html; },
    set textContent(v) { this._text = String(v); }, get textContent() { return this._text; },
    setAttribute(k, v) { this._attrs[k] = v; }, getAttribute(k) { return this._attrs[k]; }, removeAttribute(k) { delete this._attrs[k]; },
    appendChild(c) { this._children.push(c); return c; },
    get firstChild() { return this._children[0] || null; },
    removeChild(c) { const i = this._children.indexOf(c); if (i >= 0) this._children.splice(i, 1); return c; },
    querySelectorAll() { return []; }, querySelector() { return null; },
    addEventListener() {}, matches() { return false; }, attachShadow() { return makeEl('#shadow'); },
  };
}
global.document = {
  readyState: 'complete', createElement: makeEl,
  querySelectorAll() { return []; }, getElementsByTagName() { return []; },
  addEventListener() {}, currentScript: { src: 'https://widgets.travelify.io/widget-attraction.js' },
  body: makeEl('body'), documentElement: makeEl('html'), head: makeEl('head'),
};
global.window = {};

const src = readFileSync(new URL('../public/widget-attraction.js', import.meta.url), 'utf8');
vm.runInThisContext(src, { filename: 'widget-attraction.js' });
const TGAttractionWidget = global.window.TGAttractionWidget;
if (typeof TGAttractionWidget !== 'function') { console.error('FAIL: no TGAttractionWidget'); process.exit(1); }

const dlp = {
  name: 'Disneyland Paris', tagline: "Europe's most-visited theme park, with two parks and a sprinkle of pixie dust",
  type: 'Resort Complex', operator: 'Disney', country: 'France', location: 'Marne-la-Vallée, Paris',
  lat: 48.8722, lng: 2.7758,
  overview: 'Two parks side by side: Disneyland Park and Walt Disney Studios.\n\nThe resort sits 32km east of central Paris and is reachable by RER and TGV.',
  bestTime: 'Quietest in January, May and September. Peak at French and UK school holidays.',
  season: 'Year-round', daysNeeded: '2-4 days', priceBand: 'Premium (£200-£400)',
  bestFor: ['Families', 'Young Children (under 7)', 'Disney Fans', 'Couples', 'First-timers'],
  starAttractions: 'Big Thunder Mountain, Phantom Manor and the new Avengers Campus are the headline draws.',
  familyGuide: 'Baby Care Centers, Rider Switch and pushchair hire are all available.',
  thrillGuide: 'Hyperspace Mountain and Crush’s Coaster are the biggest thrills.',
  heightRestrict: '1.02m for Big Thunder Mountain, 1.20m for Hyperspace Mountain.',
  accessibility: 'Disability Access Card available; book in advance with proof.',
  fastTrack: 'Disney Premier Access is the paid skip-the-queue option, per ride or as a day pass.',
  tickets: 'Adult day tickets from around £60 online for one park. Multi-day and hotel packages cut the per-day cost.',
  nearestAirport: 'Paris Charles de Gaulle (CDG), 35-45 minutes by TGV or RER. Paris Orly (ORY) around 75 minutes.',
  gettingThere: 'Eurostar runs direct from London to a station a short walk from the parks on some services.',
  nearestTown: 'Chessy, on the edge of the resort, with hotels and a station.',
  onSiteHotels: 'Seven Disney hotels from value (Hotel Cheyenne) to flagship (Disneyland Hotel).',
  hasOnSiteHotels: true,
  nearbyHotels: 'Dozens of partner hotels in Val d’Europe with shuttle buses.',
  foodDrink: 'Character dining at several restaurants. You can bring your own food into the parks.',
  dogFriendly: false,
  quirks: 'The two parks have separate entrances. Premier Access sells out by midday on busy days.',
  combineWith: 'Val d’Europe shopping and central Paris are both a short train ride away.',
  tourOperators: 'TUI, Disney Holidays UK, easyJet holidays and Eurostar packages.',
  officialWebsite: 'https://www.disneylandparis.com', verifiedDate: '2026-05-12',
};

function render(data, cfg) {
  const c = makeEl('div');
  const w = new TGAttractionWidget(c, Object.assign({ attractionData: data }, cfg || {}));
  return w._root.innerHTML;
}
function assert(cond, msg) { if (!cond) { console.error('FAIL: ' + msg); process.exitCode = 1; } else { console.log('  ok  ' + msg); } }

console.log('Case 1: full payload renders every section');
const html = render(dlp);
assert(html.includes('Disneyland Paris'), 'hero name');
assert(html.includes('Marne-la-Vall') && html.includes('Resort Complex'), 'hero eyebrow (location, type)');
assert(html.includes('>Disney<'), 'operator badge');
assert(html.includes('On-site hotels'), 'on-site hotels badge/fact');
assert(html.includes('Premium (£200-£400)'), 'price band fact');
assert(html.includes('2-4 days'), 'days needed fact');
assert(html.includes('Best for') && html.includes('Disney Fans'), 'best-for tags');
assert(html.includes('Star attractions') && html.includes('Avengers Campus'), 'star attractions');
assert(html.includes('Height restrictions') && html.includes('1.02m'), 'guides: height restrictions');
assert(!html.includes('Skip the queue'), 'fast-track no longer a guides card');
assert(html.includes('Tickets and prices') && html.includes('from around £60'), 'tickets: prices');
assert(html.includes('Fast-track and skip-the-queue') && html.includes('Premier Access'), 'tickets: fast-track moved here');
assert(html.includes('Nearest airports') && html.includes('CDG'), 'getting there: airports');
assert(html.includes('data-tgx-map'), 'embedded map container from lat/lng');
assert(html.includes('Where to stay') && html.includes('Disneyland Hotel'), 'stay');
assert(html.includes('Food and drink') && html.includes('Character dining'), 'food');
assert(html.includes('Insider tips') && html.includes('separate entrances'), 'tips');
assert(html.includes('Combine your trip') && html.includes('Val d'), 'combine with');
assert(!html.includes('For travel agents'), 'travel-agents section removed');
assert(html.includes('Plan your visit to Disneyland Paris'), 'CTA title templated with name');
assert(!html.includes('Official website') && !html.includes('disneylandparis.com'), 'no official-website link (agents keep the booking)');
assert(html.includes('Verified 2026-05-12'), 'verified date trust line');

console.log('Case 2: sparse payload hides empty sections');
const sparse = { name: 'Warwick Castle', tagline: '1,100 years of history', type: 'Cultural Attraction', location: 'Warwick', priceBand: 'Mid (£100-£200)', daysNeeded: '1 day' };
const html2 = render(sparse);
assert(html2.includes('Warwick Castle'), 'sparse hero renders');
assert(html2.includes('Mid (£100-£200)'), 'sparse facts render');
assert(!html2.includes('Star attractions'), 'no star section without data');
assert(!html2.includes('Where to stay'), 'no stay section without data');
assert(!html2.includes('Insider tips'), 'no tips section without data');
assert(!html2.includes('data-tgx-map'), 'no map container without lat/lng');

console.log('Case 3: toggles and hero image');
const t = render(dlp, { sections: { star: false, tips: false } });
assert(!t.includes('Star attractions') && !t.includes('Insider tips'), 'toggled-off sections hidden');
assert(t.includes('Tickets and prices'), 'other sections still render when some toggled off');
const himg = render(dlp, { heroImageUrl: 'https://example.com/dlp.jpg' });
assert(himg.includes('has-img') && himg.includes('--tgx-hero-img:url(https://example.com/dlp.jpg)'), 'optional hero image applied');
const badImg = render(dlp, { heroImageUrl: 'javascript:alert(1)' });
assert(!badImg.includes('javascript:'), 'unsafe hero image url rejected');

console.log(process.exitCode ? '\nRESULT: FAILURES' : '\nRESULT: ALL PASS');
