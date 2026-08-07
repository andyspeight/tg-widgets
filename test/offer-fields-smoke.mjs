/**
 * Special Offers builder — type-aware structured fields smoke test.
 *
 * Renders the offer-builder widget in jsdom and checks that sections 2 and 3
 * (the structured fields) change with the chosen offer type:
 *   - a package holiday asks for property, board and star rating
 *   - a cruise asks for the ship, cruise line, cabin and ports, not board/stars
 *   - a flight-only asks for the route and cabin class
 *   - values typed under one type survive a switch away and back
 *
 * Run: node test/offer-fields-smoke.mjs   (also: npm run test:offer-fields)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__dirname, '..', 'public', 'widget-offer-builder.js'), 'utf8');

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name); }
}

const dom = new JSDOM('<!doctype html><body><div id="host"></div></body>', {
  runScripts: 'outside-only', pretendToBeVisual: true
});
const { window } = dom;
// The widget never fetches at render, but guard anyway so nothing escapes.
window.fetch = () => Promise.reject(new Error('no network in test'));
if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });

// eslint-disable-next-line no-eval
window.eval(SRC);

const host = window.document.getElementById('host');
const widget = new window.TGOfferBuilderWidget(host, { aiEnabled: false });
const sr = widget.shadow;

function fieldKeys() {
  return Array.prototype.slice
    .call(sr.querySelectorAll('[data-fields] [data-key]'))
    .map((e) => e.getAttribute('data-key'));
}
function setType(v) {
  const sel = sr.querySelector('[data-key="type"]');
  sel.value = v;
  sel.dispatchEvent(new window.Event('change'));
}

console.log('Package holiday (default)');
{
  const keys = fieldKeys();
  ok('shows property', keys.indexOf('property') !== -1);
  ok('shows board', keys.indexOf('board') !== -1);
  ok('shows star rating', keys.indexOf('stars') !== -1);
  ok('shows airline', keys.indexOf('airline') !== -1);
  ok('does not ask for a ship', keys.indexOf('shipName') === -1);
  ok('does not ask for cabin class', keys.indexOf('cabinClass') === -1);
}

console.log('Cruise');
{
  setType('Cruise');
  const keys = fieldKeys();
  ok('shows the ship', keys.indexOf('shipName') !== -1);
  ok('shows the cruise line', keys.indexOf('cruiseLine') !== -1);
  ok('shows the cabin', keys.indexOf('cabinType') !== -1);
  ok('shows the departure port', keys.indexOf('departurePort') !== -1);
  ok('hides board basis', keys.indexOf('board') === -1);
  ok('hides star rating', keys.indexOf('stars') === -1);
  ok('hides the property field', keys.indexOf('property') === -1);
}

console.log('Flight only');
{
  setType('Flight only');
  const keys = fieldKeys();
  ok('shows the destination', keys.indexOf('destination') !== -1);
  ok('shows cabin class', keys.indexOf('cabinClass') !== -1);
  ok('shows the airline', keys.indexOf('airline') !== -1);
  ok('does not ask for board', keys.indexOf('board') === -1);
  ok('does not ask for a property', keys.indexOf('property') === -1);
  ok('does not ask for nights', keys.indexOf('nights') === -1);
}

console.log('Rail holiday');
{
  setType('Rail holiday');
  const keys = fieldKeys();
  ok('shows the rail operator', keys.indexOf('railOperator') !== -1);
  ok('shows the class', keys.indexOf('railClass') !== -1);
  ok('shows departure station', keys.indexOf('station') !== -1);
  ok('does not ask for an airline', keys.indexOf('airline') === -1);
}

console.log('Value preservation across a type switch');
{
  setType('Cruise');
  const ship = sr.querySelector('[data-fields] [data-key="shipName"]');
  ship.value = 'Wonder of the Seas';
  ship.dispatchEvent(new window.Event('input'));
  setType('Package holiday (flight + hotel)');
  ok('ship field is gone on a package', !sr.querySelector('[data-fields] [data-key="shipName"]'));
  setType('Cruise');
  const ship2 = sr.querySelector('[data-fields] [data-key="shipName"]');
  ok('ship value is remembered on return', ship2 && ship2.value === 'Wonder of the Seas');
}

console.log('Collected offer keeps only the visible type fields');
{
  // Cruise with a ship, then collect — the offer carries the ship, not a stale hotel.
  setType('Cruise');
  const line = sr.querySelector('[data-fields] [data-key="cruiseLine"]');
  line.value = 'Royal Caribbean';
  line.dispatchEvent(new window.Event('input'));
  const offer = widget._collect();
  ok('_collect captures the cruise line', offer.fields.cruiseLine === 'Royal Caribbean');
  ok('_collect does not invent a board basis', !offer.fields.board);
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
