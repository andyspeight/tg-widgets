/**
 * Render smoke test for widget-airport.js (no browser).
 *
 * Loads the real widget IIFE against a tiny DOM shim and inspects the HTML for
 * the three fields the API used to read then drop: Eating and shopping (a
 * Facilities card), Drop-off & pick-up (an origin getting-there tab) and Useful
 * Tips (a second block in the Tips section). Also checks they hide when blank.
 *
 * Run: node test/widget-airport-render.test.mjs
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function makeEl(tag) {
  return {
    tagName: tag, className: '', _children: [], _attrs: {}, _html: '', _text: '',
    style: { setProperty() {} },
    set innerHTML(v) { this._html = String(v); },
    get innerHTML() { return this._html; },
    set textContent(v) { this._text = String(v); },
    get textContent() { return this._text; },
    setAttribute(k, v) { this._attrs[k] = v; },
    getAttribute(k) { return this._attrs[k]; },
    removeAttribute(k) { delete this._attrs[k]; },
    appendChild(c) { this._children.push(c); return c; },
    get firstChild() { return this._children[0] || null; },
    removeChild(c) { const i = this._children.indexOf(c); if (i >= 0) this._children.splice(i, 1); return c; },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    addEventListener() {}, matches() { return false; },
    attachShadow() { return makeEl('#shadow'); },
  };
}

global.document = {
  readyState: 'complete', createElement: makeEl,
  querySelectorAll() { return []; }, getElementsByTagName() { return []; },
  addEventListener() {}, currentScript: { src: 'https://widgets.travelify.io/widget-airport.js' },
  body: makeEl('body'), documentElement: makeEl('html'), head: makeEl('head'),
};
global.window = {};

const src = readFileSync(new URL('../public/widget-airport.js', import.meta.url), 'utf8');
vm.runInThisContext(src, { filename: 'widget-airport.js' });
const TGAirportWidget = global.window.TGAirportWidget;
if (typeof TGAirportWidget !== 'function') { console.error('FAIL: no TGAirportWidget'); process.exit(1); }

const lhr = {
  name: 'London Heathrow', iata: 'LHR', role: 'origin', type: 'International',
  cityServed: 'London', country: 'United Kingdom', tagline: 'The UK hub',
  overview: '', overviewHeading: '', heroImageUrl: '',
  lat: 51.47, lng: -0.4543, cityLat: 51.5, cityLng: -0.12,
  distanceToCity: '14 miles west of central London.', driveTimeSummary: '45-60 min',
  terminalsCount: 4, terminalsNote: 'T2-T5', terminalsAndAirlines: '',
  keyAirlines: 'BA, Virgin', keyAirlinesNote: '', flightTimeFromUK: '', flightTimeNote: '',
  checkInSummary: '2-3 hours', checkInDetail: '', recommendedArrival: '3 hours for long-haul.',
  hasLounges: true, hasFastTrack: true,
  gettingThereByTrain: 'Heathrow Express from Paddington.', gettingThereByCar: 'M4 and M25.',
  gettingThereByCoach: 'National Express.', taxiAndRideshare: 'Black cabs and Uber.',
  parking: 'Short and long stay.',
  dropOffInfo: 'Drop-off is now chargeable at all terminals. The free alternative is the Long Stay car parks with a free shuttle bus.',
  transferInfo: '', carHireInfo: '', taxiInfo: '', coachInfo: '',
  loungesInfo: 'No1 Lounge and Plaza Premium in several terminals.',
  eatShopInfo: 'A wide range of restaurants and shops airside, including World Duty Free and Pret.',
  familyInfo: 'Family security lanes and baby-change.', assistInfo: 'Book special assistance 48 hours ahead.',
  hotelsInfo: 'Sofitel at T5, Hilton at T4.',
  tips: 'Gatwick and Heathrow are different airports, so confirm which you fly from.',
  usefulTips: 'Free WiFi throughout. Prayer rooms in every terminal. Currency exchange airside but rates are poor.',
  officialWebsite: 'https://www.heathrow.com', resorts: [], cities: [],
};

function render(data) {
  const c = makeEl('div');
  const w = new TGAirportWidget(c, { airportData: data, showMap: false });
  return w._root.innerHTML;
}
function assert(cond, msg) {
  if (!cond) { console.error('FAIL: ' + msg); process.exitCode = 1; } else { console.log('  ok  ' + msg); }
}

console.log('Case 1: all three fields populated (origin airport)');
const html = render(lhr);
assert(html.includes('Eating and shopping'), 'Eating and shopping facilities card rendered');
assert(html.includes('World Duty Free'), 'eating/shopping body text present');
assert(html.includes('tga-tab-dropoff'), 'Drop-off & pick-up tab rendered');
assert(html.includes('free shuttle bus'), 'drop-off body text present');
assert(html.includes('tga-tips-sublabel') && html.includes('Useful to know'), 'Useful Tips sublabel present when both tips exist');
assert(html.includes('Prayer rooms'), 'useful tips body text present');
assert(html.includes('confirm which you fly from'), 'quirks (existing tips) still present');

console.log('Case 2: the three fields blank -> hidden');
const bare = Object.assign({}, lhr, { eatShopInfo: '', dropOffInfo: '', usefulTips: '' });
const html2 = render(bare);
assert(!html2.includes('Eating and shopping'), 'no eating/shopping card when blank');
assert(!html2.includes('tga-tab-dropoff'), 'no drop-off tab when blank');
assert(!html2.includes('Useful to know'), 'no useful-tips sublabel when blank');
assert(html2.includes('insider tips'), 'Tips section still renders the quirks');
assert(html2.includes('Lounges'), 'other facilities still render');

console.log(process.exitCode ? '\nRESULT: FAILURES' : '\nRESULT: ALL PASS');
