/**
 * Special Offers — cruise route builder (Andrea, Aug 2026), part B.
 *
 * The builder's Map section gains a Cruise route: type ports in order (looked
 * up via MapTiler geocoding), reorder / remove / nudge them, and a
 * land-avoiding sea line is fetched from /api/sea-route. The ordered ports and
 * the line are saved on offer.cruiseRoute (whitelisted by the save API) so the
 * offer page can draw the route.
 *
 * Exercises the real save-API sanitiser and the real builder (add / reorder /
 * remove / collect / prefill, plus the route fetch with a mocked endpoint).
 *
 * Run: node test/offer-cruise-route-smoke.mjs   (npm run test:offer-cruise-route)
 */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { _test } from '../api/saved-offers.js';

const BUILDER = readFileSync(new URL('../public/widget-offer-builder.js', import.meta.url), 'utf8');

let passed = 0, failed = 0;
const ok = (name, cond) => { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; console.error('  ✗ ' + name); } };

console.log('The save API whitelists a bounded cruiseRoute');
{
  const good = _test.cleanOffer({ fields: { title: 'X' }, cruiseRoute: {
    ports: [{ name: 'Barcelona', lat: 41.38, lng: 2.17 }, { name: 'Rome', lat: 42.09, lng: 11.79 }],
    line: [[2.17, 41.38], [9.2, 41.3], [11.79, 42.09]],
  } });
  ok('valid ports + line survive', good.cruiseRoute && good.cruiseRoute.ports.length === 2 && good.cruiseRoute.line.length === 3);
  ok('the port name and coords round-trip', good.cruiseRoute.ports[0].name === 'Barcelona' && good.cruiseRoute.ports[0].lat === 41.38);

  const oneport = _test.cleanOffer({ fields: { title: 'X' }, cruiseRoute: { ports: [{ name: 'Solo', lat: 1, lng: 1 }] } });
  ok('a route with fewer than two valid ports is dropped', !oneport.cruiseRoute);

  const dirty = _test.cleanOffer({ fields: { title: 'X' }, cruiseRoute: {
    ports: [{ name: 'A', lat: 1, lng: 1 }, { name: 'B', lat: 999, lng: 2 }, { name: 'C', lat: 3, lng: 3 }],
    line: [[1, 1], ['x', 2], [3, 3]],
  } });
  ok('out-of-range ports are filtered', dirty.cruiseRoute.ports.length === 2);
  ok('non-numeric line points are filtered', dirty.cruiseRoute.line.length === 2);
}

console.log('The builder collects, reorders and round-trips a cruise route');
{
  const { window } = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'dangerously', pretendToBeVisual: true });
  const s = window.document.createElement('script'); s.textContent = BUILDER; window.document.body.appendChild(s);
  const d = window.document.createElement('div'); window.document.body.appendChild(d);
  const b = new window.TGOfferBuilderWidget(d, { currency: 'GBP' });

  ok('the Cruise route section is rendered', !!b.root.querySelector('.ob-crroute [data-crports]'));

  b._addCruisePort({ name: 'Barcelona', lat: 41.38, lng: 2.17 });
  b._addCruisePort({ name: 'Marseille', lat: 43.30, lng: 5.35 });
  b._addCruisePort({ name: 'Rome', lat: 42.09, lng: 11.79 });
  ok('ports are added in order', b._cruisePorts.length === 3 && b._cruisePorts[0].name === 'Barcelona');
  ok('the port list renders one row per port', b.root.querySelectorAll('.ob-crport').length === 3);

  // Move Rome up one (Marseille <-> Rome).
  b.root.querySelector('.ob-crport:nth-child(3) [data-up]').click();
  ok('reorder swaps the two ports', b._cruisePorts[1].name === 'Rome' && b._cruisePorts[2].name === 'Marseille');

  // Remove the middle one.
  b.root.querySelector('.ob-crport:nth-child(2) [data-crrm]').click();
  ok('remove drops that port', b._cruisePorts.length === 2 && b._cruisePorts.map((p) => p.name).join(',') === 'Barcelona,Marseille');

  b._cruiseLine = [[2.17, 41.38], [9.2, 41.3], [5.35, 43.30]];
  const offer = b._collect();
  ok('collect saves the ordered ports', offer.cruiseRoute && offer.cruiseRoute.ports.length === 2);
  ok('collect saves the sea line', offer.cruiseRoute.line.length === 3);

  // Reopen an offer carrying a route → ports + line restore.
  const d2 = window.document.createElement('div'); window.document.body.appendChild(d2);
  const b2 = new window.TGOfferBuilderWidget(d2, { currency: 'GBP', offer: { fields: { title: 'Y' }, cruiseRoute: {
    ports: [{ name: 'Athens', lat: 37.94, lng: 23.63 }, { name: 'Santorini', lat: 36.39, lng: 25.43 }],
    line: [[23.63, 37.94], [25.43, 36.39]],
  } } });
  ok('a saved route reopens with its ports', b2._cruisePorts.length === 2 && b2._cruisePorts[1].name === 'Santorini');
  ok('a saved route round-trips through collect', b2._collect().cruiseRoute.ports.length === 2);
}

console.log('The route line is fetched from /api/sea-route');
{
  const { window } = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'dangerously', pretendToBeVisual: true });
  const s = window.document.createElement('script'); s.textContent = BUILDER; window.document.body.appendChild(s);
  let calledUrl = '';
  window.fetch = async (url, opts) => { calledUrl = String(url); return { ok: true, json: async () => ({ ok: true, line: [[2, 41], [9, 41], [11, 42]], nm: 581 }) }; };
  const d = window.document.createElement('div'); window.document.body.appendChild(d);
  const b = new window.TGOfferBuilderWidget(d, { currency: 'GBP' });
  b._cruisePorts = [{ name: 'A', lat: 41, lng: 2 }, { name: 'B', lat: 42, lng: 11 }];
  await b._doRecomputeRoute();
  ok('it posts to the sea-route endpoint', /\/sea-route$/.test(calledUrl));
  ok('the returned line is stored', Array.isArray(b._cruiseLine) && b._cruiseLine.length === 3 && b._cruiseNm === 581);
}

console.log('Source guards');
{
  ok('a sea-route endpoint default is configured', /seaRouteEndpoint: c\.seaRouteEndpoint \|\| API_BASE\.replace\('\/widget-config', '\/sea-route'\)/.test(BUILDER));
  ok('ports are geocoded via MapTiler', /api\.maptiler\.com\/geocoding\//.test(BUILDER));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
