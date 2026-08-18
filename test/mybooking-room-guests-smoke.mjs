/**
 * My Booking — the Room panel guest count is the WHOLE party (Andy, Aug 2026).
 *
 * Booking YTG75824 (2 adults + 2 children in one room) showed "Room only ·
 * 2 guests". The Room subtitle was reading units[].sleepsAdults alone and
 * labelling it "guests", so the two children were dropped. The travellers
 * panel on the same widget correctly showed all four, because it reads the
 * full traveller list. The room count must sum sleepsAdults + sleepsChildren,
 * both of which the retrieve-order feed carries per unit.
 *
 * Source-guards the widget (the room guest sum) and the API (both occupancy
 * fields are mapped through), since the room panel is built as a template
 * string inside the browser IIFE and has no DOM unit test.
 *
 * Run: node test/mybooking-room-guests-smoke.mjs  (npm run test:mybooking-room-guests)
 */
import { readFileSync } from 'node:fs';

const WIDGET = readFileSync(new URL('../public/widget-mybooking.js', import.meta.url), 'utf8');
const API = readFileSync(new URL('../api/internal/retrieve-order-by-client.js', import.meta.url), 'utf8');

let passed = 0, failed = 0;
const ok = (name, cond) => { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; console.error('  ✗ ' + name); } };

console.log('The Room panel counts the whole party, not just the adults');
{
  ok('the room guest count sums sleepsAdults + sleepsChildren',
    /\(u\.sleepsAdults \|\| 0\) \+ \(u\.sleepsChildren \|\| 0\)/.test(WIDGET));
  ok('the count still shows only when the room carries occupancy info',
    /u\?\.sleepsAdults != null \|\| u\?\.sleepsChildren != null/.test(WIDGET));
  ok('the old adults-only "N guests" label is gone (it dropped children)',
    !/\$\{u\.sleepsAdults\} \$\{esc\(u\.sleepsAdults === 1/.test(WIDGET));
  ok('the guest/guests singular-plural label is still chosen off the total',
    /roomGuests === 1 \? c\.t\('guest'\) : c\.t\('guests'\)/.test(WIDGET));
}

console.log('The order feed carries both occupancy counts per room');
{
  ok('the API maps sleepsAdults through', /sleepsAdults: safeNum\(u\.sleepsAdults\)/.test(API));
  ok('the API maps sleepsChildren through', /sleepsChildren: safeNum\(u\.sleepsChildren\)/.test(API));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
