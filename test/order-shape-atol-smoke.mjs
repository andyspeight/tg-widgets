/**
 * The order inspector's ATOL trail (24 Sep 2026).
 *
 * A client that holds its own ATOL must give the customer an ATOL certificate
 * when a booking is protected under it. Travelify's order model is not
 * published, and the one ATOL flag we read (a Packages item's inclusions list
 * naming 'ATOLProtection') is the TOUR OPERATOR's licence, not the agency's.
 * /api/admin/order-shape now reports every field whose name speaks of ATOL or
 * protection, so one run on a real booking answers how Travelify marks it.
 *
 * It must answer that without handing a customer's name to a support thread:
 * only flags and codes are shown; anything with a space in it is reported by
 * its length.
 *
 * Run: node test/order-shape-atol-smoke.mjs   (npm run test:order-shape-atol)
 */
import { atolTrail, buildOrderShapeReport } from '../api/admin/order-shape.js';

let passed = 0, failed = 0;
const ok = (name, cond, detail) => {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (detail ? '  — ' + detail : '')); }
};
const at = (trail, path) => trail.find((t) => t.at === path);

const order = {
  id: 9001, status: 'Confirmed', atolNumber: '12345', atolType: 'FlightOnly',
  items: [
    { product: 'Packages', dataObject: { inclusions: ['Baggage', 'ATOLProtection'], operator: { name: 'Jet2 Holidays', atolNumber: 'T7433' } } },
    { product: 'Flights', dataObject: {
      atolProtected: true, protectedCost: 812.5,
      protectedPassengers: ['Jo Bloggs', 'Sam Bloggs'],
      atolHolderName: 'Exclusively Travel Ltd',
      routes: [{ direction: 'Outbound', segments: [{ flightNumber: 'LS123' }] }],
    } },
  ],
};

const trail = atolTrail(order);
console.log('\nWhat it finds\n');
ok('an order-level ATOL number', at(trail, 'atolNumber')?.value === '12345');
ok('an order-level type code', at(trail, 'atolType')?.value === 'FlightOnly');
ok('the operator\'s flag in a package\'s inclusions list', at(trail, 'items[0].dataObject.inclusions[1]')?.value === 'ATOLProtection');
ok('the operator\'s own ATOL number', at(trail, 'items[0].dataObject.operator.atolNumber')?.value === 'T7433');
ok('a flag on an item', at(trail, 'items[1].dataObject.atolProtected')?.value === true);
ok('a protected amount', at(trail, 'items[1].dataObject.protectedCost')?.value === 812.5);
ok('nothing that is not about protection', !trail.some((t) => /flightNumber|routes|status$/.test(t.at)), JSON.stringify(trail.map((t) => t.at)));

console.log('\nWhat it keeps to itself\n');
const people = at(trail, 'items[1].dataObject.protectedPassengers');
ok('a list of names under an ATOL key comes back as lengths, not names',
  JSON.stringify(people?.value) === JSON.stringify(['(text, 9 characters)', '(text, 10 characters)']));
ok('any text with a space in it is reported by its length only',
  at(trail, 'items[1].dataObject.atolHolderName')?.value === '(text, 22 characters)');
ok('and no name appears anywhere in the report', !/Bloggs|Exclusively/.test(JSON.stringify(buildOrderShapeReport(order, {}))));

console.log('\nIn the report\n');
const report = buildOrderShapeReport(order, {});
ok('the inspector\'s report carries the trail', Array.isArray(report.atolTrail) && report.atolTrail.length === trail.length);
ok('an order that says nothing about ATOL gives an empty trail', buildOrderShapeReport({ id: 1, items: [{ product: 'Flights', dataObject: {} }] }, {}).atolTrail.length === 0);

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed ? 1 : 0);
