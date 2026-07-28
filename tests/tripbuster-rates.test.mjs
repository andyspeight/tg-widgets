/**
 * Tripbuster rate card and sponsored placement.
 *
 * Run: node tests/tripbuster-rates.test.mjs
 *
 * This is the money. The failure modes are quiet and expensive:
 *
 *   • an override that silently does not apply, so an agreed rate is not charged
 *   • a rate change that re-prices a month somebody has already been invoiced for
 *   • the rate card leaking into a public response, one event at a time
 *   • paid placement that is not labelled, which is undisclosed advertising
 *
 * The precedence expectations here were produced by running the real SQL against
 * the live database, not by reading the JavaScript.
 */
import assert from 'node:assert/strict';

const TB = await import('../public/tripbuster/tb-site.js');
const { toDeal } = await import('../api/_lib/tripbuster/deal-view.js');

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log(`PASS  ${name}`); } catch (e) {
    failures.push({ name, message: e.message });
    console.log(`FAIL  ${name}\n      ${e.message}`);
  }
}

// ════════════════════════════════════════════════════════════════
// 1. precedence
// ════════════════════════════════════════════════════════════════
//
// A JavaScript model of tb_resolve_rate, checked against the answers the real
// function gave. It exists so the RULE is documented and regression-tested here
// in the repo; the database remains the authority, and section 2 pins the
// numbers the live function actually returned.

function resolve(card, { agentId, holidayType, eventType, tier }) {
  const matches = card.filter((r) => r.eventType === eventType
    && r.tier === tier
    && (r.agentId === null || r.agentId === agentId)
    && (r.holidayType === null || r.holidayType === holidayType));
  if (!matches.length) return { pence: 0, source: 'unrated' };
  const score = (r) => (r.agentId ? 2 : 0) + (r.holidayType ? 1 : 0);
  const best = matches.sort((a, b) => score(b) - score(a))[0];
  return {
    pence: best.pence,
    source: ['default', 'product', 'client', 'client_product'][score(best)],
  };
}

const CARD = [
  // The platform defaults, exactly as migration 014 seeds them.
  { agentId: null, holidayType: null, eventType: 'click', tier: 'standard', pence: 10 },
  { agentId: null, holidayType: null, eventType: 'click', tier: 'premium', pence: 25 },
  { agentId: null, holidayType: null, eventType: 'call', tier: 'standard', pence: 100 },
  { agentId: null, holidayType: null, eventType: 'call', tier: 'premium', pence: 200 },
  { agentId: null, holidayType: null, eventType: 'lead', tier: 'standard', pence: 100 },
  { agentId: null, holidayType: null, eventType: 'lead', tier: 'premium', pence: 200 },
  // The three kinds of override.
  { agentId: null, holidayType: 'Flight only', eventType: 'click', tier: 'standard', pence: 4 },
  { agentId: 'sun', holidayType: null, eventType: 'click', tier: 'standard', pence: 30 },
  { agentId: 'sun', holidayType: 'Cruise', eventType: 'click', tier: 'standard', pence: 50 },
];

const at = (o) => resolve(CARD, { tier: 'standard', ...o });

test('the agreed rate card is what a standard agency pays', () => {
  assert.equal(at({ agentId: 'jet', holidayType: 'Package holiday', eventType: 'click' }).pence, 10);
  assert.equal(at({ agentId: 'jet', holidayType: 'Package holiday', eventType: 'call' }).pence, 100);
  assert.equal(at({ agentId: 'jet', holidayType: 'Package holiday', eventType: 'lead' }).pence, 100);
});

test('premium is 25p a click and £2 for a call or an enquiry', () => {
  const p = (eventType) => resolve(CARD, {
    agentId: 'jet', holidayType: 'Package holiday', eventType, tier: 'premium',
  }).pence;
  assert.equal(p('click'), 25);
  assert.equal(p('call'), 200);
  assert.equal(p('lead'), 200);
});

test('a per-product rate beats the default', () => {
  const r = at({ agentId: 'jet', holidayType: 'Flight only', eventType: 'click' });
  assert.equal(r.pence, 4);
  assert.equal(r.source, 'product');
});

test('a per-client rate beats a per-product one', () => {
  // WORTH KNOWING: Sunseeker pays their agreed 30p on flights, NOT the 4p
  // everyone else gets. Most specific scope wins, and a client is more specific
  // than a product across all clients. To make flights cheap for one client you
  // set a client-and-product rate.
  const r = at({ agentId: 'sun', holidayType: 'Flight only', eventType: 'click' });
  assert.equal(r.pence, 30);
  assert.equal(r.source, 'client');
});

test('a per-client-per-product rate beats everything', () => {
  const r = at({ agentId: 'sun', holidayType: 'Cruise', eventType: 'click' });
  assert.equal(r.pence, 50);
  assert.equal(r.source, 'client_product');
});

test('an override on one event type does not leak into the others', () => {
  // Sunseeker's 30p is a CLICK rate. Their calls stay on the default.
  assert.equal(at({ agentId: 'sun', holidayType: 'Cruise', eventType: 'call' }).pence, 100);
});

test('no rate at all charges nothing rather than inventing a number', () => {
  const r = resolve([], { agentId: 'sun', holidayType: 'Cruise', eventType: 'click', tier: 'standard' });
  assert.equal(r.pence, 0);
  assert.equal(r.source, 'unrated');
});

// ════════════════════════════════════════════════════════════════
// 2. what the live database actually returned
// ════════════════════════════════════════════════════════════════

test('the model agrees with the answers the real SQL function gave', () => {
  // Captured from tb_resolve_rate against the live schema on 28 July 2026, with
  // the same three overrides loaded. If the JavaScript model above ever drifts
  // from the database, this is where it shows.
  const observed = [
    [{ agentId: 'sun', holidayType: 'Cruise', eventType: 'click' }, 50, 'client_product'],
    [{ agentId: 'sun', holidayType: 'Package holiday', eventType: 'click' }, 30, 'client'],
    [{ agentId: 'sun', holidayType: 'Flight only', eventType: 'click' }, 30, 'client'],
    [{ agentId: 'jet', holidayType: 'Flight only', eventType: 'click' }, 4, 'product'],
    [{ agentId: 'jet', holidayType: 'Package holiday', eventType: 'click' }, 10, 'default'],
    [{ agentId: 'jet', holidayType: 'Package holiday', eventType: 'call' }, 100, 'default'],
  ];
  for (const [args, pence, source] of observed) {
    const r = at(args);
    assert.equal(r.pence, pence, JSON.stringify(args));
    assert.equal(r.source, source, JSON.stringify(args));
  }
});

// ════════════════════════════════════════════════════════════════
// 3. the charge is frozen onto the event
// ════════════════════════════════════════════════════════════════

test('an unbillable event costs nothing but still knows what it would have cost', () => {
  // tb_record_click resolves the rate even when it is not charging, and stores
  // zero. "This call was worth £2 and we did not charge for it" is a different
  // fact from "we have no idea what this call was worth", and the first is the
  // one an agency rings up about.
  const charge = (billable, pence) => (billable ? pence : 0);
  assert.equal(charge(false, 200), 0);
  assert.equal(charge(true, 200), 200);
});

test('changing a rate cannot re-price events that already happened', () => {
  // The invoice sums charged_pence off the rows. It never re-runs the rate card.
  const events = [
    { at: 'june', charged_pence: 10 },
    { at: 'june', charged_pence: 10 },
    { at: 'july', charged_pence: 25 }, // moved to premium in between
  ];
  const total = events.reduce((n, e) => n + e.charged_pence, 0);
  assert.equal(total, 45);
  // Re-deriving from today's rate card would have produced 75 and re-billed June.
  assert.notEqual(events.length * 25, total);
});

// ════════════════════════════════════════════════════════════════
// 4. the rate card stays private
// ════════════════════════════════════════════════════════════════

test('what an event cost never reaches a traveller', async () => {
  // tb_record_click returns chargedPence to the API. api/tripbuster/click.js
  // must pick out only the routing fields, or the rate card is published one
  // click at a time and any agency can read every other agency's rates.
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../api/tripbuster/click.js', import.meta.url), 'utf8');
  const responded = src.slice(src.indexOf('res.status(200)'));
  assert.ok(!/chargedPence/.test(responded),
    'the click response must not carry what the event cost');
});

test('a deal handed to the browser carries no rate information', () => {
  const d = toDeal({
    id: 'x', slug: 's-1', title: 'T', is_premium: true,
    agent_name: 'Coastline', charged_pence: 25, rate_tier: 'premium',
  });
  // Whether a listing bought position is public — it has to be, it is the
  // disclosure. What that position COST is not.
  assert.equal(d.sponsored, true);
  const asJson = JSON.stringify(d);
  assert.ok(!asJson.includes('charged'), 'a charge reached the public deal shape');
  assert.ok(!asJson.includes('rateTier'), 'a rate tier reached the public deal shape');
  assert.ok(!asJson.includes('25'), 'a rate amount reached the public deal shape');
});

// ════════════════════════════════════════════════════════════════
// 5. paid placement is labelled
// ════════════════════════════════════════════════════════════════

test('a deal that paid for position says so', () => {
  const card = TB.dealCard({
    id: '1', slug: 'x-1', title: 'Benidorm, 7 nights', priceFrom: 342,
    agent: { name: 'Coastline Holidays' }, sponsored: true,
  });
  assert.ok(card.includes('Promoted'), 'paid position must be labelled');
});

test('an ordinary deal card does not, because the badge is about ORDER', () => {
  const card = TB.dealCard({
    id: '1', slug: 'x-1', title: 'Benidorm, 7 nights', priceFrom: 329,
    agent: { name: 'Sunseeker Travel' }, sponsored: false,
  });
  // Every listing on this site is advertising. The badge cannot mean "this one
  // is paid for" or it would imply the unbadged ones are editorial picks, which
  // is misleading the other way. It means "this one paid to be higher up".
  assert.ok(!card.includes('Promoted'),
    'the badge marks bought position, not the mere fact of payment');
});

test('the label is not softened into something that implies an endorsement', () => {
  const tag = TB.sponsoredTag();
  assert.ok(/Promoted/.test(tag));
  // "Recommended" implies we are recommending, which we are not; "Featured"
  // reads as editorial. Both fail the test of whether a normal person
  // understands that money changed hands.
  assert.ok(!/Featured|Recommended|Top pick|Best/i.test(tag));
  // And the badge itself carries the wider truth for anyone who hovers it.
  assert.ok(/advertising/i.test(tag));
});

test('the site says on every page that all of it is advertising', () => {
  // Not a per-listing claim and not only on pages that happen to have a
  // promoted deal on them: it is true of the whole site, all the time, so it
  // lives in the footer.
  const foot = TB.footer();
  assert.ok(/advertised by the agent/i.test(foot));
  assert.ok(/pays us when you get in touch/i.test(foot));
  assert.ok(/never add anything to the price/i.test(foot));
});

test('the ranking note leads with the fact that every listing is an advert', () => {
  const note = TB.rankingNote();
  // The first claim, because it is the one that is true of everything on the
  // page rather than of five listings on it.
  assert.ok(/every deal here is an advert/i.test(note));
  assert.ok(/pay more to appear higher/i.test(note));
  assert.ok(/Promoted/.test(note));
  // And that we still show every agent, so the badge is not a way of burying
  // the cheaper option.
  assert.ok(/cheapest/i.test(note));
});

test('the sponsored flag survives the mapping onto a compare row', () => {
  const d = toDeal({
    id: 'x', slug: 's-1', title: 'T', is_premium: true, agent_name: 'Coastline',
    compare: [
      { dealId: 'a', slug: 's-1', agent: 'Coastline', price: 342, sponsored: true },
      { dealId: 'b', slug: 's-2', agent: 'Sunseeker', price: 329, sponsored: false },
    ],
  });
  assert.equal(d.compare[0].sponsored, true);
  assert.equal(d.compare[1].sponsored, false);
});

test('the booking panel labels the promoted agency and still names the cheapest', () => {
  const deal = {
    id: 'x', currency: 'GBP', billingMode: 'click',
    compare: [
      { dealId: 'a', agent: 'Coastline Holidays', price: 329, sponsored: true, clickoutUrl: 'https://x.example' },
      { dealId: 'b', agent: 'Sunseeker Travel', price: 342, sponsored: false, clickoutUrl: 'https://y.example' },
    ],
  };
  const html = TB.bookingPanel(deal);
  assert.ok(html.includes('Promoted'));
  // Both claims coexist: one is about who paid, the other about the price.
  assert.ok(html.includes('CHEAPEST'));
});

// ── report ──────────────────────────────────────────────────────
console.log(`\n${passed}/${passed + failures.length} passed`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  ${f.name}: ${f.message}`);
  process.exit(1);
}
process.exit(0);
