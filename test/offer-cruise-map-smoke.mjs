/**
 * Special Offers — the cruise route is drawn on the offer page (Andrea, Aug
 * 2026), part C.
 *
 * When an offer carries a cruiseRoute (ordered ports + a precomputed sea line),
 * the offer page shows a route map instead of the single location: a marker per
 * port in order, the land-avoiding line, and the map fits itself to the whole
 * voyage. TGMapsWidget gained a `route` polyline option to draw it.
 *
 * Source-guards the map widget's new route support, and functionally renders
 * the offer page (with TGMapsWidget mocked) to prove the ports, the "Your
 * route" heading, and the [lng,lat]→[lat,lng] route conversion.
 *
 * Run: node test/offer-cruise-map-smoke.mjs   (npm run test:offer-cruise-map)
 */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const MAPS = readFileSync(new URL('../public/widget-maps.js', import.meta.url), 'utf8');
const PAGE = readFileSync(new URL('../public/widget-offer-page.js', import.meta.url), 'utf8');

let passed = 0, failed = 0;
const ok = (name, cond) => { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; console.error('  ✗ ' + name); } };

console.log('TGMapsWidget can draw a route polyline');
{
  ok('a route config becomes an L.polyline', /this\.routeLine = L\.polyline\(routePts/.test(MAPS));
  ok('the route extent is folded into the fit bounds', /routePts\.forEach\(\(p\) => this\.bounds\.extend\(p\)\)/.test(MAPS));
  ok('the map auto-fits when there is a route', /\(locs\.length > 1 \|\| routePts\.length >= 2\) && this\.cfg\.autoFit !== false/.test(MAPS));
}

console.log('The offer page derives + renders the cruise route');
{
  ok('the page derives a cruiseRoute from the offer', /cruiseRoute: cruiseRoute,/.test(PAGE));
  ok('the map section prefers the cruise route over a single location', /d\.cruiseRoute \|\| d\.map/.test(PAGE));
  ok('the stored line is converted from \\[lng,lat\\] to \\[lat,lng\\] for Leaflet', /d\.cruiseRoute\.line[\s\S]*?return \[c\[1\], c\[0\]\];/.test(PAGE));
}

console.log('The offer page shows the route, ports and the right map config');
{
  const { window } = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'dangerously', pretendToBeVisual: true });
  const s = window.document.createElement('script'); s.textContent = PAGE; window.document.body.appendChild(s);
  // Mock the map widget so _mountMap uses it synchronously and we capture its config.
  let captured = null;
  window.TGMapsWidget = function (el, cfg) { captured = cfg; };

  const offer = {
    currency: 'EUR',
    fields: { title: 'Greek Isles', type: 'Cruise', price: '1299', mapStyle: 'streets' },
    cruiseRoute: {
      ports: [
        { name: 'Athens', lat: 37.94, lng: 23.63 },
        { name: 'Mykonos', lat: 37.45, lng: 25.33 },
        { name: 'Santorini', lat: 36.39, lng: 25.43 },
      ],
      line: [[23.63, 37.94], [24.9, 37.6], [25.43, 36.39]],
    },
  };
  const el = window.document.createElement('div'); window.document.body.appendChild(el);
  new window.TGOfferPageWidget(el, { offer, offerId: 'x' });
  const html = el.shadowRoot.innerHTML;

  ok('the "Your route" heading is shown', /Your route/.test(html));
  ok('the ports are listed in order as the route summary', html.includes('Athens → Mykonos → Santorini'));
  ok('a map holder is rendered', /data-map/.test(html));

  ok('the map widget was handed a config', !!captured);
  ok('a marker per port, in order', captured && Array.isArray(captured.locations) && captured.locations.length === 3 && captured.locations[0].lat === 37.94);
  ok('the route was passed as [lat,lng] pairs', captured && Array.isArray(captured.route) && captured.route.length === 3
    && captured.route[0][0] === 37.94 && captured.route[0][1] === 23.63);
  ok('the map auto-fits to the voyage', captured && captured.autoFit === true);
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
