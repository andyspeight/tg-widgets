/**
 * Render smoke test for widget-spotlight.js (no browser).
 *
 * Loads the real widget IIFE against a tiny DOM shim, instantiates it with an
 * inline destinationData payload, and inspects the HTML the widget produces.
 * Verifies the new "Good to know" planning section renders its chips and the
 * expandable visa/health detail, sits between Quick facts and Highlights, and
 * hides itself when there is no planning data.
 *
 * Run: node test/widget-spotlight-render.test.mjs
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// ---- Minimal DOM shim ----------------------------------------------------
function makeEl(tag) {
  const el = {
    tagName: tag,
    className: '',
    _children: [],
    _attrs: {},
    _html: '',
    _text: '',
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
    addEventListener() {},
    matches() { return false; },
    attachShadow() { return makeEl('#shadow'); },
  };
  return el;
}

const document = {
  readyState: 'complete',
  createElement: makeEl,
  querySelectorAll() { return []; },
  getElementsByTagName() { return []; },
  addEventListener() {},
  currentScript: { src: 'https://widgets.travelify.io/widget-spotlight.js' },
  body: makeEl('body'),
  documentElement: makeEl('html'),
};

global.window = {};
global.document = document;

// ---- Load the widget IIFE ------------------------------------------------
const src = readFileSync(new URL('../public/widget-spotlight.js', import.meta.url), 'utf8');
vm.runInThisContext(src, { filename: 'widget-spotlight.js' });

const TGSpotlightWidget = global.window.TGSpotlightWidget;
if (typeof TGSpotlightWidget !== 'function') {
  console.error('FAIL: widget did not expose TGSpotlightWidget'); process.exit(1);
}

// ---- Fixtures ------------------------------------------------------------
const greece = {
  level: 'country', name: 'Greece',
  tagline: 'Where every island tells a different story',
  region: 'Mediterranean · Southern Europe',
  images: ['https://example.com/greece.jpg'], attributions: ['Photo: Unsplash'],
  climate: {
    temps: [12,12,14,17,22,27,30,30,26,21,17,14],
    rainfall: [60,50,40,25,12,5,2,3,10,45,70,75],
    season: ['off','off','shoulder','shoulder','best','best','best','best','best','shoulder','off','off'],
  },
  facts: { flightTime: '3h 45m', timeZone: 'GMT +2', currency: 'Euro (€)', language: 'Greek', voltage: '230V · Type F' },
  highlights: [{ icon: 'temple', title: 'Ancient wonders', description: 'Acropolis, Delphi and more.' }],
  bestForTags: ['Couples', 'Beach', 'Culture'],
  events: [{ month: 'Jul-Aug', name: 'Athens Festival', description: 'Music and theatre.' }],
  planning: {
    priceBand: '£££',
    bookingLead: 'Book ahead (3-6 months)',
    tripDuration: ['7 nights', '10-14 nights'],
    visaStatus: 'Not required',
    visaAdvisory: 'UK passport holders can visit visa-free under Schengen rules: up to 90 days within any 180-day period.',
    healthNotes: 'No vaccinations required. Tap water is generally safe in Athens and main resort areas.',
  },
  planningInherited: {}, factsInherited: {},
  pairedWith: [
    { name: 'Turkey', slug: 'turkey', url: '/destinations/countries/turkey' },
    { name: 'Italy', slug: 'italy', url: '/destinations/countries/italy' },
  ],
};

function render(data) {
  const container = makeEl('div');
  // Give the CTA a real URL: since the dead-end fix, the CTA section is only
  // emitted when it has a usable destination (an empty URL renders nothing).
  const w = new TGSpotlightWidget(container, { destinationData: data, theme: 'light', cta: { url: 'https://example.com/enquire' } });
  return w.root.innerHTML;
}

function assert(cond, msg) {
  if (!cond) { console.error('FAIL: ' + msg); process.exitCode = 1; }
  else { console.log('  ok  ' + msg); }
}

// ---- Case 1: full planning data -----------------------------------------
console.log('Case 1: planning populated');
const html = render(greece);

assert(html.includes('id="tgs-planning-heading"'), 'planning section rendered');
assert(html.includes('Good to know'), 'default heading "Good to know" present');
assert(html.includes('Price band') && html.includes('£££'), 'price band chip present');
assert(html.includes('When to book') && html.includes('Book ahead (3-6 months)'), 'booking lead chip present');
assert(html.includes('Ideal length') && html.includes('7 nights · 10-14 nights'), 'trip duration joined with middle dot');
assert(html.includes('UK visa') && html.includes('Not required'), 'visa status chip present');
assert(html.includes('tgs-plan-detail') && html.includes('Visa and entry'), 'visa detail disclosure present');
assert(html.includes('Health and vaccinations') && html.includes('Tap water is generally safe'), 'health detail disclosure present');

// Ordering (v1.6 layout): the quick-facts rail sits under the hero, then the
// body's main column (climate -> highlights -> events) and its side column
// (planning -> paired -> CTA). Planning therefore follows highlights and events
// in the DOM, which is also the phone reading order: the practical "plan it"
// reads close the page together, right above the CTA.
const iFacts = html.indexOf('tgs-facts-heading');
const iPlan = html.indexOf('tgs-planning-heading');
const iHigh = html.indexOf('tgs-highlights-heading');
const iEv = html.indexOf('tgs-events-heading');
assert(iFacts > -1 && iPlan > iFacts, 'planning comes after quick facts');
assert(iHigh > -1 && iEv > iHigh && iPlan > iEv, 'planning opens the side column, after highlights and events');
assert(html.includes('class="tgs-main"') && html.includes('class="tgs-side"'), 'body renders a main and a side column');
assert(html.indexOf('class="tgs-side"') > html.indexOf('class="tgs-main"'), 'side column follows the main column');

// ---- Case 2: empty planning hides the section ---------------------------
console.log('Case 2: planning empty');
const noPlan = JSON.parse(JSON.stringify(greece));
noPlan.planning = { priceBand: '', bookingLead: '', tripDuration: [], visaStatus: '', visaAdvisory: '', healthNotes: '' };
const html2 = render(noPlan);
assert(!html2.includes('tgs-planning-heading'), 'planning section omitted when no data');
assert(html2.includes('tgs-facts-heading'), 'other sections still render');

// ---- Case 3: toggle off via config --------------------------------------
console.log('Case 3: planning toggled off');
const container3 = makeEl('div');
const w3 = new TGSpotlightWidget(container3, { destinationData: greece, sections: { planning: false } });
assert(!w3.root.innerHTML.includes('tgs-planning-heading'), 'planning hidden when sections.planning=false');

// ---- Case 4: "Pairs well with" ------------------------------------------
console.log('Case 4: pairs well with');
assert(html.includes('id="tgs-paired-heading"'), 'paired section rendered');
assert(html.includes('Pairs well with'), 'default heading "Pairs well with" present');
assert(html.includes('>Turkey<') && html.includes('>Italy<'), 'paired destination names present');
assert(html.includes('href="/destinations/countries/turkey"'), 'paired link uses the destination url');
assert(html.includes('class="tgs-pair"'), 'paired pill class present');
const iEvents = html.indexOf('tgs-events-heading');
const iPaired = html.indexOf('tgs-paired-heading');
const iCta = html.indexOf('tgs-cta-heading');
assert(iEvents > -1 && iPaired > iEvents, 'paired comes after events');
assert(iCta > -1 && iPaired < iCta, 'paired comes before the CTA');

// CTA is a dead end with no destination → omit it entirely (not a disabled button)
const noCtaUrl = makeEl('div');
const wNoCta = new TGSpotlightWidget(noCtaUrl, { destinationData: greece, theme: 'light' });
assert(!wNoCta.root.innerHTML.includes('tgs-cta-heading'), 'CTA section omitted when it has no URL');

// empty + safety
console.log('Case 5: paired empty and unsafe url');
const noPair = JSON.parse(JSON.stringify(greece));
noPair.pairedWith = [];
assert(!render(noPair).includes('tgs-paired-heading'), 'paired section omitted when no pairs');
const badPair = JSON.parse(JSON.stringify(greece));
badPair.pairedWith = [{ name: 'Sketchy', slug: '', url: '//evil.example.com' }];
const htmlBad = render(badPair);
assert(htmlBad.includes('>Sketchy<'), 'unsafe-url pair still shows the name');
assert(!htmlBad.includes('evil.example.com'), 'protocol-relative url is rejected, rendered as plain pill');

console.log(process.exitCode ? '\nRESULT: FAILURES' : '\nRESULT: ALL PASS');
