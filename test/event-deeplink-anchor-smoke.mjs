/**
 * The Travelify deeplink anchor is mandatory (probed 21 Aug 2026: the same
 * link 400s bare and 302s anchored). These pin the builder to that reality:
 * with coordinates the link reproduces Andy's working example parameter for
 * parameter, and without them there is no link at all, not a dead one.
 */
import assert from 'node:assert/strict';
import {
  buildEventDeeplink, buildEventPackageDeeplink, buildBookingOptions, ORG_PLACEHOLDER,
} from '../api/_lib/events/event-deeplink.js';

let passed = 0;
const ok = (cond, name) => { assert.ok(cond, name); passed++; };

const monza = {
  sources: [{ supplier: 'xs2event', searchboxId: '144:168e50ee39a24acf870d4527d5c20a38_spp',
    filterId: '168e50ee39a24acf870d4527d5c20a38_spp',
    rawName: 'Italian Grand Prix (Formula 1)' }],
  startDate: '2026-09-04',
  title: 'Italian Grand Prix',
  geo: { lat: 45.617548, lng: 9.28127 },
};

// ── Anchored: Andy's example, rebuilt ───────────────────────────────────────
{
  const r = buildEventDeeplink(monza, { appId: '384' });
  ok(r.status === 'ready', 'anchored: ready');
  ok(r.url === 'https://dl.tvllnk.com/deeplink/384?st=TicketsAttractions&supp=144'
    + '&refe=168e50ee39a24acf870d4527d5c20a38_spp&curr=GBP&fr=2026-09-04&to=2026-09-04'
    + '&lat=45.617548&lng=9.28127&rad=20&adt=2&chd=0&inf=0'
    + '&loc=Italian+Grand+Prix+%28Formula+1%29%3A+04-Sep-2026',
  'anchored: reproduces the working example parameter for parameter');
}

// ── Bare: no coordinates means no link, with its own status ────────────────
{
  const r = buildEventDeeplink({ ...monza, geo: null }, { appId: '384' });
  ok(r.url === null, 'bare: url withheld');
  ok(r.status === 'no-anchor', 'bare: status no-anchor');
  ok(r.reference === '168e50ee39a24acf870d4527d5c20a38_spp', 'bare: reference still reported');
}

// ── Junk coordinates are the same as none ───────────────────────────────────
{
  const r = buildEventDeeplink({ ...monza, geo: { lat: 'x', lng: 9 } }, { appId: '384' });
  ok(r.status === 'no-anchor', 'junk geo: treated as absent');
}

// ── Booking options carry the anchor too ────────────────────────────────────
{
  const opts = buildBookingOptions(monza, { appId: '250' });
  const ticket = opts.find((o) => o.kind === 'ticket');
  ok(/([?&])lat=45\.617548&lng=9\.28127&rad=20(&|$)/.test(ticket.url), 'options: anchored');
  // Default options drop a linkless kind entirely, which is what the widgets
  // rely on to show no button; includeUnavailable exposes the reason.
  const dropped = buildBookingOptions({ ...monza, geo: null }, { appId: '250' });
  ok(!dropped.some((o) => o.kind === 'ticket'), 'options: linkless kind omitted by default');
  const shown = buildBookingOptions({ ...monza, geo: null }, { appId: '250', includeUnavailable: true })
    .find((o) => o.kind === 'ticket');
  ok(shown.url === null && shown.status === 'no-anchor', 'options: no-anchor visible when asked');
}

// ── The flight package, rebuilt from Andy's 24 Aug 2026 example ─────────────
{
  const camp = {
    sources: [{ supplier: 'xs2event', searchboxId: '144:1939276025ff419489c076968d8f51b8_gnr',
      filterId: '1939276025ff419489c076968d8f51b8_gnr',
      rawName: 'FC Barcelona vs Racing de Santander (Football, La Liga)' }],
    startDate: '2026-09-16',
    title: 'FC Barcelona vs Racing Santander',
    geo: { lat: 41.38087, lng: 2.122802 },
  };
  const r = buildEventPackageDeeplink(camp, { appId: '384', destAirport: 'BCN', origin: 'LGW' });
  ok(r.status === 'ready', 'package: ready with an origin');
  ok(r.url === 'https://dl.tvllnk.com/deeplink/384?st=TicketAccommodationFlight&supp=144'
    + '&refe=1939276025ff419489c076968d8f51b8_gnr&curr=GBP&fr=2026-09-16&to=2026-09-16'
    + '&lat=41.38087&lng=2.122802&rad=20&org=LGW&dst=BCN&frd=0&dur=1&dir=false'
    + '&adt=2&chd=0&inf=0'
    + '&loc=FC+Barcelona+vs+Racing+de+Santander+%28Football%2C+La+Liga%29%3A+16-Sep-2026',
  'package: reproduces the live example parameter for parameter (loc carries our date stamp)');

  // Verified live 24 Aug 2026 via a temporary probe: this exact built link
  // 302s into the Travelify results funnel on apps 384 and 250 alike.

  const asked = buildEventPackageDeeplink(camp, { appId: '384', destAirport: 'BCN' });
  ok(asked.url === null && asked.status === 'needs-origin', 'package: no origin means a template, not a link');
  ok(asked.urlTemplate.includes('org=' + ORG_PLACEHOLDER), 'package: template carries the placeholder');
  ok(asked.dst === 'BCN', 'package: destination airport reported');

  const grounded = buildEventPackageDeeplink(camp, { appId: '384' });
  ok(grounded.url === null && grounded.status === 'no-airport', 'package: no destination airport, no package');

  const anchorless = buildEventPackageDeeplink({ ...camp, geo: null }, { appId: '384', destAirport: 'BCN', origin: 'LGW' });
  ok(anchorless.status === 'no-anchor', 'package: the anchor stays mandatory');

  const opts = buildBookingOptions(camp, {
    appId: '250', kinds: ['ticket', 'ticket-flight-hotel'], destAirport: 'BCN',
  });
  const pkg = opts.find((o) => o.kind === 'ticket-flight-hotel');
  ok(pkg && pkg.status === 'needs-origin' && pkg.urlTemplate && pkg.dst === 'BCN',
    'options: package template offered alongside the ticket');
  const noAirport = buildBookingOptions(camp, { appId: '250', kinds: ['ticket', 'ticket-flight-hotel'] });
  ok(!noAirport.some((o) => o.kind === 'ticket-flight-hotel'),
    'options: package omitted entirely when no airport is near');
}

console.log(`\n${passed} passed, 0 failed`);
