/**
 * Spotlight family speed — Step 4: hero image optimisation.
 *
 *  - Spotlight's hero is a real <img> (the LCP): it now carries
 *    fetchpriority="high" and decoding="async".
 *  - Airport and Attraction heroes are CSS background images, which the browser
 *    discovers late. When one is set they now inject a <link rel="preload"
 *    as="image" fetchpriority="high"> so it starts fetching straight away.
 *
 * Renders the airport widget (which takes inline data) to prove the preload is
 * injected and deduped, plus source guards for spotlight and attraction.
 *
 * Run: node test/spotlight-image-smoke.mjs  (also: npm run test:spotlight-image)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name); }
}

console.log('Airport preloads its background hero (and dedupes)');
{
  const SRC = readFileSync(join(ROOT, 'public', 'widget-airport.js'), 'utf8');
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  window.fetch = () => Promise.reject(new Error('no network'));
  // eslint-disable-next-line no-eval
  window.eval(SRC);

  const HERO = 'https://img.test/dalaman-hero.jpg';
  const airportData = {
    iata: 'DLM', name: 'Dalaman Airport', cityServed: 'Dalaman', country: 'Turkey', type: 'International',
    tagline: 'Gateway to the Turquoise Coast', servesResorts: [], facts: {}, terminals: [], facilities: [],
  };
  const cfg = { airportData: airportData, heroImageUrl: HERO, sections: { hero: true, serves: false, facts: false, overview: false, terminals: false, located: false, facilities: false, arrival: false, tips: false, cta: false } };

  const host1 = window.document.createElement('div');
  window.document.body.appendChild(host1);
  new window.TGAirportWidget(host1, cfg);

  const links = () => window.document.head.querySelectorAll('link[rel="preload"][as="image"]');
  ok('a preload link was injected', links().length >= 1);
  const l = links()[0];
  ok('preload points at the hero URL', l && l.getAttribute('href') === HERO);
  ok('preload is high priority', l && l.getAttribute('fetchpriority') === 'high');

  // Second widget, same hero → still one preload link (deduped).
  const host2 = window.document.createElement('div');
  window.document.body.appendChild(host2);
  new window.TGAirportWidget(host2, cfg);
  ok('a repeat hero is not preloaded twice', links().length === 1);
}

console.log('Source guards');
{
  const spot = readFileSync(join(ROOT, 'public', 'widget-spotlight.js'), 'utf8');
  ok('spotlight hero <img> is high priority', /class="tgs-hero-img"[^>]*fetchpriority="high"/.test(spot));
  ok('spotlight hero <img> decodes async', /class="tgs-hero-img"[^>]*decoding="async"/.test(spot));

  const air = readFileSync(join(ROOT, 'public', 'widget-airport.js'), 'utf8');
  ok('airport defines preloadImage', /function preloadImage\(/.test(air));
  ok('airport calls it in the hero render', /if \(heroImg\) preloadImage\(heroImg\)/.test(air));

  const attr = readFileSync(join(ROOT, 'public', 'widget-attraction.js'), 'utf8');
  ok('attraction defines preloadImage', /function preloadImage\(/.test(attr));
  ok('attraction calls it in the hero render', /if \(heroImg\) preloadImage\(heroImg\)/.test(attr));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
