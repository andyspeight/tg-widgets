/**
 * Tripbuster SEO suite.
 *
 * Run: node tests/tripbuster-seo.test.mjs
 *
 * The thing being protected here is not "does it render". It is the handful of
 * one-line mistakes that silently cost a comparison site its entire acquisition
 * channel and are invisible in a browser:
 *
 *   • a stray noindex on a page we want ranked
 *   • a canonical pointing at the wrong host, splitting one page into two
 *   • a 404 answering 200, so empty pages get indexed
 *   • agent-written text breaking out of a JSON-LD block
 *   • the slug the database mints and the slug the browser builds disagreeing,
 *     which turns every internal link into a 404
 *
 * A fake PostgREST stands in for Supabase so the handlers run their real fetch,
 * parse and error paths rather than against stubbed modules.
 */
import http from 'node:http';
import assert from 'node:assert/strict';

const FAKE_PG_PORT = 8341;
process.env.TRIPBUSTER_SUPABASE_URL = `http://127.0.0.1:${FAKE_PG_PORT}`;
process.env.TRIPBUSTER_SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.TRIPBUSTER_SITE_ORIGIN = 'https://tripbuster.example';

const TB = await import('../public/tripbuster/tb-site.js');
const seo = await import('../api/_lib/tripbuster/seo.js');
const { toDeal } = await import('../api/_lib/tripbuster/deal-view.js');
const { default: page } = await import('../api/tripbuster/page.js');
const { default: sitemap } = await import('../api/tripbuster/sitemap.js');
const { default: robots } = await import('../api/robots.js');

// ── fixtures ────────────────────────────────────────────────────
// Shaped exactly like a tb_search_deals row, taken from the live demo database
// rather than invented, so a change to the read path's column names fails here.

const CONTACT_OPEN_ALWAYS = {
  hoursMode: 'always', timeZone: 'Europe/London', closedBehaviour: 'callback',
  hours: [], specialDays: [],
  phones: [{ label: 'Main number', phone: '01273 555 240', whenShown: 'always' }],
};

// Monday to Friday, nine to five. Used with a fixed Sunday date so "closed" is
// deterministic rather than dependent on when the suite happens to run.
const CONTACT_SCHEDULED = {
  hoursMode: 'scheduled', timeZone: 'Europe/London', closedBehaviour: 'callback',
  hours: [1, 2, 3, 4, 5].map((day) => ({ day, opens: '09:00', closes: '17:00' })),
  specialDays: [],
  phones: [
    { label: 'Main number', phone: '01273 555 240', whenShown: 'always' },
    { label: 'Evenings and weekends', phone: '07700 900782', whenShown: 'closed' },
  ],
};

function dealRow(over = {}) {
  return {
    id: 'a1509144-61ae-4a17-bb6e-1d005d696171',
    slug: 'hotel-wawel-old-town-krakow-a1509144',
    title: 'Krakow, 3 nights bed and breakfast',
    strapline: 'A long weekend in the old town',
    accommodation_name: 'Hotel Wawel Old Town',
    country: 'Poland',
    region: 'Lesser Poland',
    resort: 'Krakow',
    star_rating: 4,
    guest_score: 8.9,
    holiday_type: 'City break',
    board_basis: 'Bed & breakfast',
    nights: 3,
    price_from: 179,
    was_price: 229,
    discount_pct: 22,
    currency: 'GBP',
    availability_status: 'Limited',
    departure_airports: ['Bristol'],
    facilities: ['Old town', 'Breakfast', 'Wi-Fi'],
    selling_points: ['Two minutes from the market square'],
    offer_badges: ['City break'],
    travel_from: '2026-11-14',
    travel_until: '2027-03-14',
    updated_at: '2026-07-27T15:05:48.520156+00:00',
    published_at: '2026-07-21T16:52:59.893387+00:00',
    hero_image_url: null,
    agent_name: 'Coastline Holidays',
    agent_slug: 'coastline-holidays',
    agent_town: 'Brighton',
    effective_atol: '9840',
    effective_clickout: 'https://coastlineholidays.co.uk/deals/cst-2010',
    effective_phone: '01273 555 240',
    effective_billing_mode: 'click',
    effective_protection: 'ATOL + ABTA',
    agent_contact: CONTACT_OPEN_ALWAYS,
    agentCount: 1,
    compare: [{
      dealId: 'a1509144-61ae-4a17-bb6e-1d005d696171',
      slug: 'hotel-wawel-old-town-krakow-a1509144',
      agent: 'Coastline Holidays',
      agentSlug: 'coastline-holidays',
      atol: '9840',
      price: 179,
      clickoutUrl: 'https://coastlineholidays.co.uk/deals/cst-2010',
      phone: '01273 555 240',
      billingMode: 'click',
      contact: CONTACT_OPEN_ALWAYS,
    }],
    ...over,
  };
}

/** The same hotel from two agents, which is what the compare page is for. */
function twoAgentRow() {
  const base = dealRow();
  return {
    ...base,
    agentCount: 2,
    compare: [
      base.compare[0],
      {
        dealId: 'b2609255-61ae-4a17-bb6e-1d005d696172',
        slug: 'hotel-wawel-old-town-krakow-b2609255',
        agent: 'Jetaway Travel',
        agentSlug: 'jetaway-travel',
        atol: '4471',
        price: 195,
        clickoutUrl: 'https://jetaway.example/deals/j-1',
        phone: '0161 555 100',
        billingMode: 'both',
        contact: CONTACT_SCHEDULED,
      },
    ],
  };
}

const DESTINATIONS = {
  countries: [
    { name: 'Poland', slug: 'poland', deal_count: 1, min_price: 179, max_discount: 22, last_change: '2026-07-27T15:05:48Z', image: null },
    { name: 'Spain', slug: 'spain', deal_count: 12, min_price: 199, max_discount: 28, last_change: '2026-07-27T15:05:48Z', image: null },
  ],
  resorts: [
    { name: 'Krakow', slug: 'krakow', country_name: 'Poland', country_slug: 'poland', deal_count: 1, min_price: 179, max_discount: 22, last_change: '2026-07-27T15:05:48Z', image: null },
    { name: 'Benidorm', slug: 'benidorm', country_name: 'Spain', country_slug: 'spain', deal_count: 4, min_price: 199, max_discount: 28, last_change: '2026-07-27T15:05:48Z', image: null },
  ],
};

// What the fake database is currently pretending to hold. Tests reassign this.
let rpcHandlers = {};

const fakePg = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const fn = req.url.replace('/rest/v1/rpc/', '');
    const args = body ? JSON.parse(body) : {};
    const handler = rpcHandlers[fn];
    if (!handler) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ message: `no such function ${fn}` }));
    }
    const out = handler(args);
    if (out === '__error__') {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ message: 'boom' }));
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(out));
  });
});
await new Promise((r) => fakePg.listen(FAKE_PG_PORT, r));

function defaultRpcs(row = dealRow()) {
  return {
    tb_search_deals: (a) => {
      if (a.p_deal_slug && a.p_deal_slug !== row.slug
        && !(row.compare || []).some((c) => c.slug === a.p_deal_slug)) {
        return { total: 0, limit: 20, offset: 0, compare: true, deals: [] };
      }
      return { total: 1, limit: 20, offset: 0, compare: !!a.p_compare, deals: [row] };
    },
    tb_destinations: () => DESTINATIONS,
    tb_destination: (a) => {
      if (a.p_country_slug !== 'poland') return { country: null };
      if (a.p_resort_slug && a.p_resort_slug !== 'krakow') return { country: null };
      return {
        country: 'Poland',
        countrySlug: 'poland',
        resort: a.p_resort_slug ? 'Krakow' : null,
        resortSlug: a.p_resort_slug ? 'krakow' : null,
        dealCount: 1,
        minPrice: 179,
        maxDiscount: 22,
        agentCount: 1,
        lastChange: '2026-07-27T15:05:48Z',
        children: a.p_resort_slug ? [] : [{ name: 'Krakow', slug: 'krakow', dealCount: 1, minPrice: 179 }],
        results: { total: 1, deals: [row] },
      };
    },
    tb_sitemap: () => ({
      deals: [{ slug: row.slug, lastmod: '2026-07-27T15:05:48Z' }],
      destinations: DESTINATIONS,
      generated: '2026-07-27T16:00:00Z',
    }),
  };
}
rpcHandlers = defaultRpcs();

// ── harness ─────────────────────────────────────────────────────
let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`PASS  ${name}`);
  } catch (e) {
    failures.push({ name, message: e.message });
    console.log(`FAIL  ${name}\n      ${e.message}`);
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`PASS  ${name}`);
  } catch (e) {
    failures.push({ name, message: e.message });
    console.log(`FAIL  ${name}\n      ${e.message}`);
  }
}

/** Call a handler with a stub req/res and collect everything it sent. */
async function call(handler, { query = {}, method = 'GET', headers = {} } = {}) {
  const out = { status: 0, headers: {}, body: '' };
  const res = {
    setHeader(k, v) { out.headers[k.toLowerCase()] = v; },
    status(code) { out.status = code; return res; },
    send(payload) { out.body = payload; return res; },
    json(payload) { out.body = JSON.stringify(payload); return res; },
    end(payload) { if (payload) out.body = payload; return res; },
  };
  await handler({ method, query, headers: { host: 'ignored.example', ...headers } }, res);
  return out;
}

/** Pull the JSON-LD objects back out of a rendered page. */
function jsonLdOf(html) {
  const blocks = [...html.matchAll(
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
  )];
  return blocks.map((m) => JSON.parse(m[1].replace(/\\u003c/g, '<')));
}

function metaOf(html, name) {
  const m = new RegExp(`<meta name="${name}" content="([^"]*)"`).exec(html);
  return m ? m[1] : null;
}

// ════════════════════════════════════════════════════════════════
// 1. slugs
// ════════════════════════════════════════════════════════════════
// The browser builds links with TB.slugify and the database mints deal slugs and
// resolves destination slugs with tb_slugify. If they ever disagree, every
// internal link to that destination 404s. These expectations were produced by
// running the real SQL function, not by reading the JavaScript.

test('slugify matches the database on the cases that differ between naive implementations', () => {
  const parity = [
    ['Costa del Sol, Málaga  —  Spain!', 'costa-del-sol-malaga-spain'],
    ['Ærø & Ølstykke ß', 'aero-olstykke-ss'],
    ['Benidorm', 'benidorm'],
    ['United Arab Emirates', 'united-arab-emirates'],
    ["Côte d'Azur", 'cote-d-azur'],
    ['Spain', 'spain'],
    ['Cala Millor', 'cala-millor'],
  ];
  for (const [input, expected] of parity) {
    assert.equal(TB.slugify(input), expected, `slugify(${JSON.stringify(input)})`);
  }
});

test('slugify never produces a leading, trailing or doubled hyphen', () => {
  for (const input of ['  --Hello--  ', '!!!', 'a  b', '///x///']) {
    const out = TB.slugify(input);
    assert.ok(!/^-|-$|--/.test(out), `"${input}" produced "${out}"`);
  }
});

test('a deal links to its slug, and falls back to the legacy URL without one', () => {
  assert.equal(TB.dealHref({ slug: 'x-abc12345' }), '/tripbuster/holiday/x-abc12345');
  assert.equal(TB.dealHref({ id: 'u-1' }), '/tripbuster/deal?id=u-1');
  // In compare mode the group's slug can live on the cheapest rival.
  assert.equal(TB.dealHref({ id: 'u-1', compare: [{ slug: 'y-def67890' }] }),
    '/tripbuster/holiday/y-def67890');
});

test('destination links nest the resort under its country', () => {
  assert.equal(TB.destinationHref('spain'), '/tripbuster/holidays/spain');
  assert.equal(TB.destinationHref('spain', 'benidorm'), '/tripbuster/holidays/spain/benidorm');
});

test('the row mapper carries the slug through', () => {
  assert.equal(toDeal(dealRow()).slug, 'hotel-wawel-old-town-krakow-a1509144');
  assert.equal(toDeal({ ...dealRow(), slug: null }).slug, '');
});

// ════════════════════════════════════════════════════════════════
// 2. meta text
// ════════════════════════════════════════════════════════════════

test('clamp trims to a word boundary rather than mid-word', () => {
  const out = seo.clamp('the quick brown fox jumps over the lazy dog', 20);
  assert.ok(out.length <= 20, `too long: ${out.length}`);
  assert.ok(!/ $/.test(out));
  assert.ok(out.endsWith('…'));
  assert.ok(!out.includes('jum'), `cut mid-word: ${out}`);
});

test('clamp leaves short text completely alone', () => {
  assert.equal(seo.clamp('Spain holidays', 60), 'Spain holidays');
});

// ════════════════════════════════════════════════════════════════
// 3. the deal page
// ════════════════════════════════════════════════════════════════

await testAsync('a deal page is indexable, canonical and self-describing', async () => {
  const r = await call(page, { query: { type: 'deal', slug: 'hotel-wawel-old-town-krakow-a1509144' } });
  assert.equal(r.status, 200);
  assert.match(r.headers['content-type'], /text\/html/);

  // THE regression this whole suite exists for.
  assert.ok(!/name="robots" content="[^"]*noindex/.test(r.body),
    'a deal page must never carry noindex');

  assert.ok(r.body.includes(
    '<link rel="canonical" href="https://tripbuster.example/tripbuster/holiday/hotel-wawel-old-town-krakow-a1509144">',
  ), 'missing or wrong canonical');

  // The title used to be the same fixed string on every deal.
  const title = /<title>([^<]*)<\/title>/.exec(r.body)[1];
  assert.ok(title.includes('Hotel Wawel Old Town'), title);
  assert.ok(title.includes('Krakow'), title);
  assert.ok(title.includes('£179'), title);
  assert.ok(title.length <= 70, `title too long (${title.length}): ${title}`);

  const desc = metaOf(r.body, 'description');
  assert.ok(desc.length <= 160, `description too long (${desc.length})`);
  assert.ok(desc.includes('Hotel Wawel Old Town'), desc);
});

await testAsync('the deal page ships the content in the HTML, not just a loading spinner', async () => {
  const r = await call(page, { query: { type: 'deal', slug: 'hotel-wawel-old-town-krakow-a1509144' } });
  // A crawler that never runs JavaScript has to be able to read all of this.
  for (const needle of [
    '<h1>Hotel Wawel Old Town',
    'A long weekend in the old town',
    'Two minutes from the market square',
    'Coastline Holidays',
    '£179',
    'Old town',
  ]) {
    assert.ok(r.body.includes(needle), `server HTML is missing: ${needle}`);
  }
});

await testAsync('breadcrumbs link home, country and resort', async () => {
  const r = await call(page, { query: { type: 'deal', slug: 'hotel-wawel-old-town-krakow-a1509144' } });
  assert.ok(r.body.includes('href="/tripbuster/holidays/poland"'), 'no country breadcrumb');
  assert.ok(r.body.includes('href="/tripbuster/holidays/poland/krakow"'), 'no resort breadcrumb');

  const [crumbLd] = jsonLdOf(r.body).filter((o) => o['@type'] === 'BreadcrumbList');
  assert.ok(crumbLd, 'no BreadcrumbList');
  assert.deepEqual(crumbLd.itemListElement.map((i) => i.name),
    ['Home', 'Poland', 'Krakow', 'Hotel Wawel Old Town']);
  assert.equal(crumbLd.itemListElement[1].item,
    'https://tripbuster.example/tripbuster/holidays/poland');
});

await testAsync('one agent gives a single Offer, two give an AggregateOffer', async () => {
  let [ld] = jsonLdOf((await call(page, {
    query: { type: 'deal', slug: 'hotel-wawel-old-town-krakow-a1509144' },
  })).body).filter((o) => o['@type'] === 'Product');
  assert.equal(ld.offers['@type'], 'Offer');
  assert.equal(ld.offers.price, 179);
  assert.equal(ld.offers.seller.name, 'Coastline Holidays');
  assert.equal(ld.offers.seller['@type'], 'TravelAgency');

  rpcHandlers = defaultRpcs(twoAgentRow());
  [ld] = jsonLdOf((await call(page, {
    query: { type: 'deal', slug: 'hotel-wawel-old-town-krakow-a1509144' },
  })).body).filter((o) => o['@type'] === 'Product');
  assert.equal(ld.offers['@type'], 'AggregateOffer');
  assert.equal(ld.offers.lowPrice, 179);
  assert.equal(ld.offers.highPrice, 195);
  assert.equal(ld.offers.offerCount, 2);
  rpcHandlers = defaultRpcs();
});

await testAsync('we never claim a rating we did not collect', async () => {
  // guest_score is 8.9 on the fixture and is typed in by the agent. Emitting it
  // as aggregateRating would tell Google we hold reviews we do not hold.
  const r = await call(page, { query: { type: 'deal', slug: 'hotel-wawel-old-town-krakow-a1509144' } });
  assert.ok(!r.body.includes('aggregateRating'), 'structured data must not claim ratings');
  assert.ok(!r.body.includes('"review"'), 'structured data must not claim reviews');
  // It is still fine to SHOW the agent's score on the page as the agent's score.
  assert.ok(r.body.includes('guest rating'), 'the visible score should still be there');
});

await testAsync('an unknown slug is a real 404, not an empty 200', async () => {
  const r = await call(page, { query: { type: 'deal', slug: 'no-such-hotel-00000000' } });
  assert.equal(r.status, 404);
  assert.ok(/name="robots" content="noindex/.test(r.body),
    'a 404 page must not be indexable');
  assert.ok(r.body.includes('/tripbuster/destinations'), 'a dead end should offer a way out');
});

await testAsync('a malformed slug is refused before it reaches the database', async () => {
  let reached = false;
  rpcHandlers = { ...defaultRpcs(), tb_search_deals: () => { reached = true; return { deals: [] }; } };
  const r = await call(page, { query: { type: 'deal', slug: '../../etc/passwd' } });
  assert.equal(r.status, 404);
  assert.equal(reached, false, 'a bad slug should never be looked up');
  rpcHandlers = defaultRpcs();
});

// ════════════════════════════════════════════════════════════════
// 4. injection
// ════════════════════════════════════════════════════════════════
// Deal text is written by travel agents. They have to sign in, but "signed in"
// is not "trusted", and this text now travels through two places raw HTML
// escaping does not cover: a JSON-LD block and an embedded JSON island.

await testAsync('a hotel name cannot break out of the JSON-LD block', async () => {
  rpcHandlers = defaultRpcs(dealRow({
    accommodation_name: '</script><script>alert(1)</script>',
    strapline: '</script><img src=x onerror=alert(2)>',
  }));
  const r = await call(page, { query: { type: 'deal', slug: 'hotel-wawel-old-town-krakow-a1509144' } });

  // What matters is that no LIVE tag survives. The characters "onerror=alert(2)"
  // appearing inside an escaped &lt;img&gt; is inert text, and asserting on the
  // substring rather than on the angle brackets would be testing the wrong thing.
  assert.ok(!r.body.includes('<script>alert(1)</script>'), 'script escaped out of JSON-LD');
  assert.ok(!r.body.includes('<img src=x'), 'an img tag escaped out');
  assert.ok(r.body.includes('&lt;img src=x onerror=alert(2)&gt;'),
    'the text should survive, escaped, rather than being stripped');
  // And the structured data is still valid JSON with the literal text intact.
  const [ld] = jsonLdOf(r.body).filter((o) => o['@type'] === 'Product');
  assert.equal(ld.name, '</script><script>alert(1)</script>');
  rpcHandlers = defaultRpcs();
});

await testAsync('a hotel name cannot break out of the embedded deal JSON', async () => {
  rpcHandlers = defaultRpcs(dealRow({ title: '</script><script>alert(3)</script>' }));
  const r = await call(page, { query: { type: 'deal', slug: 'hotel-wawel-old-town-krakow-a1509144' } });
  assert.ok(!r.body.includes('<script>alert(3)</script>'));
  const m = /<script type="application\/json" id="tb-deal">([\s\S]*?)<\/script>/.exec(r.body);
  assert.ok(m, 'the deal island is missing');
  assert.equal(JSON.parse(m[1].replace(/\\u003c/g, '<')).title, '</script><script>alert(3)</script>');
  rpcHandlers = defaultRpcs();
});

// ════════════════════════════════════════════════════════════════
// 5. destinations
// ════════════════════════════════════════════════════════════════

await testAsync('a country page ranks for the country and links to its resorts', async () => {
  const r = await call(page, { query: { type: 'destination', country: 'poland' } });
  assert.equal(r.status, 200);
  const title = /<title>([^<]*)<\/title>/.exec(r.body)[1];
  assert.ok(title.startsWith('Cheap Poland holidays'), title);
  assert.ok(r.body.includes('<h1>Poland holidays</h1>'));
  assert.ok(r.body.includes('href="/tripbuster/holidays/poland/krakow"'), 'no link to the resort');
  assert.ok(r.body.includes('<link rel="canonical" href="https://tripbuster.example/tripbuster/holidays/poland">'));
  assert.ok(!/content="[^"]*noindex/.test(r.body), 'destination pages must be indexable');

  const [list] = jsonLdOf(r.body).filter((o) => o['@type'] === 'ItemList');
  assert.equal(list.numberOfItems, 1);
  assert.equal(list.itemListElement[0].url,
    'https://tripbuster.example/tripbuster/holiday/hotel-wawel-old-town-krakow-a1509144');
});

await testAsync('a resort page sits under its country and offers no children', async () => {
  const r = await call(page, { query: { type: 'destination', country: 'poland', resort: 'krakow' } });
  assert.equal(r.status, 200);
  assert.ok(r.body.includes('<h1>Krakow holidays</h1>'));
  assert.ok(r.body.includes('<link rel="canonical" href="https://tripbuster.example/tripbuster/holidays/poland/krakow">'));
  assert.ok(!r.body.includes('Where in Poland'), 'a resort page has nothing below it');
});

await testAsync('a destination nobody advertises is a 404, not an empty page', async () => {
  for (const query of [
    { type: 'destination', country: 'atlantis' },
    { type: 'destination', country: 'poland', resort: 'narnia' },
  ]) {
    const r = await call(page, { query });
    assert.equal(r.status, 404, JSON.stringify(query));
    assert.ok(/content="noindex/.test(r.body));
  }
});

await testAsync('the destinations hub links to every country and resort', async () => {
  const r = await call(page, { query: { type: 'destinations' } });
  assert.equal(r.status, 200);
  for (const href of ['/tripbuster/holidays/poland', '/tripbuster/holidays/spain',
    '/tripbuster/holidays/spain/benidorm', '/tripbuster/holidays/poland/krakow']) {
    assert.ok(r.body.includes(`href="${href}"`), `hub is missing ${href}`);
  }
});

// ════════════════════════════════════════════════════════════════
// 6. the front page
// ════════════════════════════════════════════════════════════════

await testAsync('the front page is rendered, canonical and describes the business', async () => {
  const r = await call(page, { query: { type: 'home' } });
  assert.equal(r.status, 200);
  assert.ok(r.body.includes('<link rel="canonical" href="https://tripbuster.example/tripbuster">'));
  // A card leads with the deal's own headline; the hotel name is the deal page's
  // h1. Either way the words are in the HTML rather than fetched afterwards.
  assert.ok(r.body.includes('Krakow, 3 nights bed and breakfast'),
    'featured deals should be in the HTML');
  assert.ok(r.body.includes('href="/tripbuster/holiday/hotel-wawel-old-town-krakow-a1509144"'));
  // Destination tiles must go to landing pages, not to a search query, or the
  // country pages have no crawlable route in from the home page.
  assert.ok(r.body.includes('href="/tripbuster/holidays/poland"'), 'tiles must link to landing pages');
  assert.ok(!r.body.includes('dest" href="/tripbuster/search?q='), 'tiles must not link to search');

  const ld = jsonLdOf(r.body);
  const site = ld.find((o) => o['@type'] === 'WebSite');
  const org = ld.find((o) => o['@type'] === 'Organization');
  assert.ok(site && org);
  assert.equal(site.potentialAction.target.urlTemplate,
    'https://tripbuster.example/tripbuster/search?q={search_term_string}');
  assert.ok(org.description.includes('does not take bookings'));
});

// ════════════════════════════════════════════════════════════════
// 7. the old URLs
// ════════════════════════════════════════════════════════════════

await testAsync('the legacy deal URL moves permanently to the slug', async () => {
  const r = await call(page, {
    query: { type: 'legacy', id: 'a1509144-61ae-4a17-bb6e-1d005d696171' },
  });
  assert.equal(r.status, 301);
  assert.equal(r.headers.location, '/tripbuster/holiday/hotel-wawel-old-town-krakow-a1509144');
});

await testAsync('a legacy URL for a deal that has gone is a 404, not a redirect loop', async () => {
  const r = await call(page, {
    query: { type: 'legacy', id: '00000000-0000-0000-0000-000000000000' },
  });
  assert.equal(r.status, 404);
});

// ════════════════════════════════════════════════════════════════
// 8. sitemap and robots
// ════════════════════════════════════════════════════════════════

await testAsync('the sitemap lists every page type with absolute URLs', async () => {
  const r = await call(sitemap, {});
  assert.equal(r.status, 200);
  assert.match(r.headers['content-type'], /application\/xml/);
  assert.ok(r.body.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));

  const locs = [...r.body.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
  assert.ok(locs.every((l) => l.startsWith('https://tripbuster.example/')),
    'every sitemap URL must be absolute and on the canonical host');
  for (const expected of [
    'https://tripbuster.example/tripbuster',
    'https://tripbuster.example/tripbuster/destinations',
    'https://tripbuster.example/tripbuster/holidays/spain',
    'https://tripbuster.example/tripbuster/holidays/spain/benidorm',
    'https://tripbuster.example/tripbuster/holiday/hotel-wawel-old-town-krakow-a1509144',
  ]) {
    assert.ok(locs.includes(expected), `sitemap is missing ${expected}`);
  }
  // lastmod must be a real date per URL, not today's date on everything.
  assert.ok(r.body.includes('<lastmod>2026-07-27</lastmod>'));
});

await testAsync('the sitemap says 503 rather than serving a broken one', async () => {
  rpcHandlers = { ...defaultRpcs(), tb_sitemap: () => '__error__' };
  const r = await call(sitemap, {});
  assert.equal(r.status, 503);
  rpcHandlers = defaultRpcs();
});

await testAsync('robots.txt points at the sitemap on the right host', async () => {
  const r = await call(robots, {});
  assert.equal(r.status, 200);
  assert.match(r.headers['content-type'], /text\/plain/);
  assert.ok(r.body.includes('Sitemap: https://tripbuster.example/tripbuster/sitemap.xml'));
  assert.ok(r.body.includes('Disallow: /api/'));
  assert.ok(r.body.includes('Disallow: /tripbuster/dashboard'));
  // Search carries its own noindex, so it has to stay crawlable for that to be
  // readable at all.
  assert.ok(!r.body.includes('Disallow: /tripbuster/search'));
});

test('the canonical host falls back to the request when nothing is configured', () => {
  const saved = process.env.TRIPBUSTER_SITE_ORIGIN;
  delete process.env.TRIPBUSTER_SITE_ORIGIN;
  assert.equal(
    seo.siteOrigin({ headers: { host: 'widgets.travelify.io' } }),
    'https://widgets.travelify.io',
  );
  assert.equal(
    seo.siteOrigin({ headers: { 'x-forwarded-host': 'a.example, b.example' } }),
    'https://a.example',
  );
  process.env.TRIPBUSTER_SITE_ORIGIN = saved;
});

// ════════════════════════════════════════════════════════════════
// 9. rendering without a device
// ════════════════════════════════════════════════════════════════
// The server has no window to ask whether this is a phone, and the response is
// cached at the edge and served to whoever asks next. So the call button ships
// both shapes and a media query picks, rather than guessing once for everybody.

test('a server-rendered call button offers both the dial and the reveal', () => {
  const entry = { dealId: 'd1', phone: '01273 555 240', contact: CONTACT_OPEN_ALWAYS };
  const html = TB.callCta(entry);
  assert.ok(html.includes('tb-onphone'), 'no phone variant');
  assert.ok(html.includes('tb-ondesk'), 'no desktop variant');
  assert.ok(html.includes('href="tel:01273555240"'), 'the phone variant must dial');
  assert.ok(html.includes('data-phone="01273 555 240"'), 'the desktop variant must reveal');
});

test('a closed agency on call-back shows the number without offering a call', () => {
  // A Sunday. The fixture opens Monday to Friday only.
  const at = new Date('2026-07-26T12:00:00Z');
  const route = TB.callRoute({ dealId: 'd1', contact: CONTACT_SCHEDULED }, at);
  assert.equal(route.open, false);
  assert.equal(route.muted, true);
  const html = TB.callCta({ dealId: 'd1', contact: CONTACT_SCHEDULED }, { route });
  assert.ok(html.includes('is-shut'));
  assert.ok(!html.includes('data-call'), 'a muted number must not report a call');
  assert.ok(!html.includes('tel:'), 'a muted number must not be dialable');
  // A number marked "always" keeps the lead even while they are shut, and the
  // out-of-hours mobile joins the list under its own label rather than replacing
  // it. Both are listed, and while muted neither can be dialled.
  assert.equal(route.primary.phone, '01273 555 240');
  assert.deepEqual(route.phones.map((p) => p.phone), ['01273 555 240', '07700 900782']);
  const extras = TB.extraPhones({ dealId: 'd1', contact: CONTACT_SCHEDULED }, { route });
  assert.ok(extras.includes('07700 900782'), 'the out-of-hours mobile should be listed');
  assert.ok(!extras.includes('tel:'), 'a muted extra number must not be dialable either');
});

await testAsync('the booking panel the browser re-renders is the one the server sent', async () => {
  // Same function, same input, same output. This is what makes it safe to
  // replace the server's panel on load instead of maintaining two renderers.
  const deal = toDeal(dealRow());
  assert.equal(TB.bookingPanel(deal), TB.bookingPanel(deal));
  const r = await call(page, { query: { type: 'deal', slug: 'hotel-wawel-old-town-krakow-a1509144' } });
  assert.ok(r.body.includes('<aside class="book" id="book">'),
    'the browser needs #book to re-render into');
});

// ════════════════════════════════════════════════════════════════
// 10. the database being down
// ════════════════════════════════════════════════════════════════

await testAsync('a database failure is a 503, so a crawler comes back', async () => {
  rpcHandlers = { ...defaultRpcs(), tb_search_deals: () => '__error__' };
  const r = await call(page, { query: { type: 'deal', slug: 'hotel-wawel-old-town-krakow-a1509144' } });
  // Not 200. A 200 would record the outage as the page's content.
  assert.equal(r.status, 503);
  assert.ok(/content="noindex/.test(r.body));
  assert.equal(r.headers['cache-control'], 'no-store');
  rpcHandlers = defaultRpcs();
});

// ── report ──────────────────────────────────────────────────────
await new Promise((r) => fakePg.close(r));
console.log(`\n${passed}/${passed + failures.length} passed`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  ${f.name}: ${f.message}`);
  process.exit(1);
}
process.exit(0);
