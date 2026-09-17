/**
 * Where is this booking going, and what does that cost us? (17 Sep 2026)
 *
 * The confirmation email's picture and destination blocks read a pack the
 * CALLER passes in, because public/_booking-email-template.js is
 * runtime-neutral and cannot look anything up. api/_lib/booking-destination.js
 * is the bit that looks it up on the server, and this suite holds it to three
 * promises:
 *
 *   1. It asks for the most specific place first. A resort write-up beats a
 *      country one, and a Travelify order files the same trip under a resort,
 *      a city and a country at once.
 *   2. A client on the built-in layout never pays for it. No destination block
 *      in the layout, no Airtable round trip.
 *   3. Nothing here can lose a confirmation email. A lookup that fails, throws
 *      or runs long means no pack, and the blocks draw nothing, exactly as they
 *      do for a destination we hold no content for.
 *
 * Run: node test/booking-destination-smoke.mjs  (npm run test:booking-destination)
 */
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
const ok = (label, cond, detail) => {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.error('  ✗ ' + label + (detail ? '\n      ' + detail : '')); }
};

const {
  DESTINATION_BLOCKS, layoutWantsDestination, destinationCandidates, resolveBookingDestination,
} = await import('../api/_lib/booking-destination.js');
const { EMAIL_STYLES, EMAIL_BLOCKS, renderBookingEmail } =
  await import('../public/_booking-email-template.js');

const SRC = readFileSync(new URL('../api/_lib/booking-destination.js', import.meta.url), 'utf8');
const EMAILER = readFileSync(new URL('../api/booking-email.js', import.meta.url), 'utf8');
const CONTENT = readFileSync(new URL('../api/destination-content.js', import.meta.url), 'utf8');

const ORDER = {
  items: [
    { product: 'Accommodation', accommodation: {
      name: 'Atmosphere Kanifushi',
      location: { address1: 'Lhaviyani Atoll', city: 'Male', state: 'Lhaviyani Atoll', country: 'MV' } } },
    { product: 'Transfers', transfers: {
      outPickup: { name: 'Male Airport' }, outDropoff: { name: 'Atmosphere Kanifushi' } } },
    { product: 'TicketsAttractions', ticketsAttractions: {
      name: 'Sunset dolphin cruise', location: { city: 'Lhaviyani', country: 'MV' } } },
  ],
};

console.log('It asks for the most specific place first');
{
  const c = destinationCandidates(ORDER);
  ok('the resort comes before the city', c.indexOf('Lhaviyani Atoll') < c.indexOf('Male'), c.join(' > '));
  ok('and the city before the country', c.indexOf('Male') < c.indexOf('Maldives'), c.join(' > '));
  ok('an ISO country code is turned into a name a slug can match',
    c.includes('Maldives') && !c.includes('MV'), c.join(' > '));
  ok('the same place is not asked for twice',
    new Set(c.map(s => s.toLowerCase())).size === c.length, c.join(' > '));
  ok('a booking with no places at all asks for nothing',
    destinationCandidates({ items: [{ product: 'Flights' }] }).length === 0);
  ok('and neither does a malformed order',
    destinationCandidates(null).length === 0 && destinationCandidates({}).length === 0);
}

console.log('A country we cannot name is not guessed at');
{
  const c = destinationCandidates({ items: [{ product: 'Accommodation',
    accommodation: { location: { city: 'Nowhere', country: 'ZZ' } } }] });
  ok('an unknown two-letter code is dropped rather than searched for',
    c.join(',') === 'Nowhere', c.join(','));
  const named = destinationCandidates({ items: [{ product: 'Accommodation',
    accommodation: { location: { city: 'Male', country: 'Maldives' } } }] });
  ok('a country already spelled out is kept as it is', named.includes('Maldives'));
}

console.log('Only a layout that uses the pack pays for it');
{
  ok('the built-in layout does not', layoutWantsDestination(undefined) === false);
  ok('nor does an empty one', layoutWantsDestination([]) === false);
  ok('nor a layout of ordinary blocks',
    layoutWantsDestination([{ type: 'greeting' }, { type: 'summary' }, { type: 'payment' }]) === false);
  for (const type of DESTINATION_BLOCKS) {
    ok('but ' + type + ' does', layoutWantsDestination([{ type: 'greeting' }, { type }]) === true);
  }
  ok('every block on that list is one the renderer really has',
    DESTINATION_BLOCKS.every(t => EMAIL_BLOCKS.some(b => b.type === t)));
  // The four starter styles, against the rule. Standard must cost nothing.
  const wants = Object.fromEntries(EMAIL_STYLES.map(s => [s.id, layoutWantsDestination(s.layout)]));
  ok('Standard costs nothing', wants.standard === false);
  ok('Postcard asks, because its hero prefers a destination photo', wants.postcard === true);
  ok('Magazine asks', wants.magazine === true);
  ok('Itinerary asks, for the facts strip', wants.itinerary === true);
}

console.log('Nothing here can lose a confirmation email');
{
  // No PAT in this environment, so the real lookup returns null without ever
  // reaching Airtable. That IS the failure path, and it must be quiet.
  const before = process.env.AIRTABLE_DESTINATION_CONTENT_PAT;
  delete process.env.AIRTABLE_DESTINATION_CONTENT_PAT;
  const got = await resolveBookingDestination(ORDER);
  ok('no credentials means no pack, not an exception', got === null);
  ok('a booking with nowhere to look means no pack',
    (await resolveBookingDestination({ items: [] })) === null);
  ok('and the email still renders without one',
    /ET121109|Have a wonderful trip/.test(renderBookingEmail({
      order: { bookingReference: 'ET121109', items: ORDER.items, customerFirstname: 'Gemma' },
      brand: { name: 'Exclusively Travel' }, colors: {},
      layout: EMAIL_STYLES.find(s => s.id === 'magazine').layout,
      destination: null,
    }).html));
  if (before !== undefined) process.env.AIRTABLE_DESTINATION_CONTENT_PAT = before;

  ok('the resolver puts a ceiling on how long it will spend',
    /timeoutMs = \d+/.test(SRC) && /Date\.now\(\) >= deadline/.test(SRC));
  ok('and swallows its own errors rather than throwing at the sender',
    /catch \{/.test(SRC) && /return null;/.test(SRC));
  ok('the lookup itself never throws either',
    /export async function lookupDestination/.test(CONTENT)
    && /\[destination-content\] lookupDestination/.test(CONTENT));
}

console.log('The sender asks, and only when it should');
{
  ok('booking-email.js imports the resolver',
    /import \{[^}]*resolveBookingDestination[^}]*\} from '\.\/_lib\/booking-destination\.js'/.test(EMAILER));
  ok('it checks the layout before spending anything',
    /if \(layoutWantsDestination\(emailLayout\)\)[\s\S]{0,120}resolveBookingDestination\(order\)/.test(EMAILER));
  ok('and passes the pack to the renderer', /^\s*destination,$/m.test(EMAILER));
  ok('the layout is read once and used twice, not read twice',
    (EMAILER.match(/widgetSettings\?\.confirmationEmail\?\.layout/g) || []).length === 1);
}

console.log('The lookup reuses the endpoint rather than copying it');
{
  ok('it is exported from the endpoint that already knows how',
    /export async function lookupDestination\(text, lookupOrder\)/.test(CONTENT));
  ok('it resolves through the same level walk the widget uses',
    /lookupDestination[\s\S]{0,1400}resolveSlug\(slug, order, pat\)/.test(CONTENT));
  ok('it shapes the same payload the endpoint returns',
    /lookupDestination[\s\S]{0,1600}shapePayload\(resolved\.level/.test(CONTENT));
  ok('it defaults to the same resort, city, country order',
    /lookupDestination[\s\S]{0,700}DEFAULT_LOOKUP_ORDER/.test(CONTENT));
  ok('and shares the endpoint\'s cache, so a sweep costs one round trip',
    /lookupDestination[\s\S]{0,900}memGet\(key\)/.test(CONTENT)
    && /lookupDestination[\s\S]{0,1600}memSet\(key/.test(CONTENT));
  ok('a miss is cached too, so a destination we do not hold is asked for once',
    /memSet\(key, \{ found: false \}\)/.test(CONTENT));
  ok('the resolver does not keep a second copy of the Airtable logic',
    !/filterByFormula/.test(SRC) && !/AIRTABLE_API|api\.airtable\.com|LEVEL_MAP/.test(SRC));
  ok('it reads the pack from the endpoint, not from its own env credentials',
    /import \{ lookupDestination \} from '\.\.\/destination-content\.js'/.test(SRC)
    && !/AIRTABLE_DESTINATION_CONTENT_PAT/.test(SRC));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
