/**
 * An offer opens on the client's own website (16 Sep 2026).
 *
 * Andy, on Hala World Travel: "we have used the custom offer widget and placed
 * it on the homepage, but when the offer is clicked, it changes the domain to a
 * widget domain (us) - this should not happen. We are the technology provider,
 * not the story."
 *
 * The offers grid linked every card at https://widgets.travelify.io/offer/...,
 * so a visitor reading halalworldtravel.com was handed to us mid-journey. Each
 * card now links to a #offer/<slug>-<id> hash on the address the visitor is
 * already reading, and the grid draws the whole offer in its own place with the
 * client's header and footer still around it.
 *
 * The hash IS the state, so this suite checks the four ways a person reaches an
 * offer: a click, a shared link opened cold, the browser Back button, and a
 * second click straight afterwards. It drives the REAL grid and the REAL offer
 * page in jsdom rather than reading the source, because the thing being claimed
 * is what a visitor sees.
 *
 * Run: node test/offer-opens-in-place-smoke.mjs  (npm run test:offer-in-place)
 */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const GRID = readFileSync(new URL('../public/widget-offers-grid.js', import.meta.url), 'utf8');
const CARD = readFileSync(new URL('../public/widget-offer-card.js', import.meta.url), 'utf8');
const PAGE = readFileSync(new URL('../public/widget-offer-page.js', import.meta.url), 'utf8');

let passed = 0, failed = 0;
const ok = (label, cond, detail) => {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.error('  ✗ ' + label + (detail ? '\n      ' + detail : '')); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const OFFER_ID = 'DT3C1C4EWhu0';
const OFFERS = [
  { id: OFFER_ID, offer: { id: OFFER_ID, currency: 'GBP', fields: {
    title: '10 nights in Qatar, a desert villa and a private island',
    teaser: 'Ten nights between the dunes and the water.',
    price: 1899, place: 'Qatar', image: 'https://cdn.example.com/qatar.jpg',
  }, includes: ['Flights', 'Transfers'], tags: ['Luxury'], images: [] } },
  { id: 'SECONDOFFER22', offer: { id: 'SECONDOFFER22', currency: 'GBP', fields: {
    title: 'Seven nights in Muscat', teaser: 'Mountains and the sea.',
    price: 1299, place: 'Oman', image: 'https://cdn.example.com/oman.jpg',
  }, includes: ['Flights'], tags: [], images: [] } },
];

/**
 * A client's page, with the widget's three scripts served the way the browser
 * would serve them from widgets.travelify.io while the page itself is theirs.
 */
function clientPage(url) {
  const dom = new JSDOM('<!doctype html><html><body><header>Hala World Travel</header>'
    + '<div id="host"></div><footer>ATOL protected</footer></body></html>',
    { runScripts: 'outside-only', url, pretendToBeVisual: true });
  const { window } = dom;
  window.requestAnimationFrame = (cb) => window.setTimeout(() => cb(0), 0);
  if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  if (!window.IntersectionObserver) {
    window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  }
  window.fetch = async (u) => {
    if (/saved-offers/.test(String(u))) return { ok: true, status: 200, json: async () => ({ offers: OFFERS }) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  // The two scripts the grid would fetch from our origin, already present.
  window.eval(CARD);
  window.eval(PAGE);
  window.eval(GRID);
  return window;
}

const mount = async (window, cfg) => {
  const host = window.document.getElementById('host');
  const w = new window.TGOffersGridWidget(host, Object.assign({ client: 'recWGiXycDnxd8Zsh' }, cfg || {}));
  await sleep(40);
  return w;
};
const shadowHtml = (w) => (w.shadow ? w.shadow.innerHTML : '');
const cardLinks = (window, w) => [...w.shadow.querySelectorAll('div')]
  .map((d) => d.shadowRoot && [...d.shadowRoot.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')))
  .filter(Boolean).flat();
// The class, not the markup: the stylesheet inside the shadow root also
// mentions is-offer, so a text search would pass whatever the widget did.
const gridPutAway = (w) => !!(w.root && w.root.classList.contains('is-offer'));
const offerShown = (w) => {
  const host = w.shadow.querySelector('[data-offer]');
  const inner = host && host.firstElementChild;
  return !!(inner && inner.shadowRoot && /Qatar/.test(inner.shadowRoot.innerHTML));
};

console.log('The card never sends the visitor to another domain');
{
  const window = clientPage('https://www.halalworldtravel.com/');
  const w = await mount(window);
  const links = cardLinks(window, w);
  ok('every card is linked', links.length >= 2, links.join(' | '));
  ok('and every link stays on this page', links.every((h) => h.indexOf('#offer/') === 0), links.join(' | '));
  ok('none of them names our domain', !links.some((h) => /travelify\.io|widgets\./.test(h)), links.join(' | '));
  ok('the link carries the readable offer name and its id',
    links[0].includes('10-nights-in-qatar') && links[0].endsWith(OFFER_ID), links[0]);
}

console.log('Clicking one opens it in the widget\'s own place');
{
  const window = clientPage('https://www.halalworldtravel.com/');
  const w = await mount(window);
  ok('the grid is showing first', !offerShown(w) && /tgog-items|tgog-car/.test(shadowHtml(w)));

  window.location.hash = '#offer/10-nights-in-qatar-' + OFFER_ID;   // what the card's link does
  await sleep(60);
  ok('the offer is now drawn inside the widget', offerShown(w));
  ok('the grid is put away while it is open', gridPutAway(w));
  ok('the client\'s own page is still the page',
    window.location.host === 'www.halalworldtravel.com' && /Hala World Travel/.test(window.document.body.textContent));
  ok('their header and footer are untouched',
    !!window.document.querySelector('header') && /ATOL protected/.test(window.document.body.textContent));

  window.location.hash = '';                                        // the offer page's Back control
  await sleep(60);
  ok('going back brings the grid straight back', !offerShown(w) && !gridPutAway(w));

  window.location.hash = '#offer/seven-nights-in-muscat-SECONDOFFER22';
  await sleep(60);
  const host = w.shadow.querySelector('[data-offer]');
  ok('a second offer opens in the same place',
    /Muscat/.test((host.firstElementChild.shadowRoot || {}).innerHTML || ''));
}

console.log('A shared link opens the offer straight away');
{
  const window = clientPage('https://www.halalworldtravel.com/#offer/10-nights-in-qatar-' + OFFER_ID);
  const w = await mount(window);
  ok('the offer is open on arrival', offerShown(w));
  ok('and it is the one the link named', /Qatar/.test(shadowHtml(w)) || offerShown(w));
}

console.log('A hash that is nothing to do with us is left alone');
{
  const window = clientPage('https://www.halalworldtravel.com/#contact');
  const w = await mount(window);
  ok('the grid renders as normal', !offerShown(w));
  window.location.hash = '#offer/not-a-real-offer-NOPE000000';
  await sleep(40);
  ok('and an unknown offer id opens nothing rather than an empty page', !offerShown(w));
}

console.log('Two grids on one page do not both open the same offer');
{
  // The documented setup: several typed embeds sharing one pool, and an offer
  // that carries both tags sits in both of them.
  const window = clientPage('https://www.halalworldtravel.com/');
  const second = window.document.createElement('div');
  window.document.body.appendChild(second);
  const a = await mount(window);
  const b = new window.TGOffersGridWidget(second, { client: 'recWGiXycDnxd8Zsh' });
  await sleep(40);

  window.location.hash = '#offer/10-nights-in-qatar-' + OFFER_ID;
  await sleep(80);
  const open = [a, b].filter(offerShown).length;
  ok('the offer is drawn once, not once per grid', open === 1, String(open) + ' copies');
  ok('and the other grid carries on showing its cards', !(offerShown(a) && offerShown(b)));

  window.location.hash = '';
  await sleep(60);
  ok('closing it puts both back', !offerShown(a) && !offerShown(b) && !gridPutAway(a) && !gridPutAway(b));
}

console.log('The old behaviour is still there for anyone who wants it');
{
  const window = clientPage('https://www.halalworldtravel.com/');
  const w = await mount(window, { offerOpen: 'link', accentColor: '#b88b4a' });
  const links = cardLinks(window, w);
  ok('offerOpen:"link" goes back to our own offer page',
    links.every((h) => h.includes('/offer/')) && links[0].includes(OFFER_ID), links[0]);
  ok('and still carries the brand through', links[0].includes('accent='), links[0]);

  const own = clientPage('https://www.halalworldtravel.com/');
  const w2 = await mount(own, { offerPage: 'https://www.halalworldtravel.com/offers/detail' });
  ok('a client who has built their own offer page keeps it',
    cardLinks(own, w2)[0].indexOf('https://www.halalworldtravel.com/offers/detail') === 0,
    cardLinks(own, w2)[0]);
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
