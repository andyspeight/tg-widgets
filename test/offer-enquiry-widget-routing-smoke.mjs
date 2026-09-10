/**
 * Offer enquiry routing for offers that live in a widget's saved config.
 *
 * A hand-built offer embedded by widget id has no record in the saved-offers
 * feed, so the stored-offer lookup finds nothing and the lead used to fall back
 * to CONTACT_TO — meaning a client's own customers enquired to Travelgenix
 * rather than to the client. api/offer-enquiry.js now resolves the recipient
 * from the widget's config server-side, the same way api/trip-enquiry.js does.
 *
 * This exercises the REAL handler with fetch stubbed, so it covers the Airtable
 * lookup, the config parse, the ClientEmail backstop and, critically, that a
 * client-supplied address is still never honoured.
 *
 * Run: node test/offer-enquiry-widget-routing-smoke.mjs
 *      (also: npm run test:offer-enquiry-routing)
 */
process.env.SENDGRID_API_KEY = 'SG.test';
process.env.AIRTABLE_KEY = 'pat_test';
process.env.AIRTABLE_BASE_ID = 'appAYzWZxvK6qlwXK';
process.env.CONTACT_TO = 'info@travelgenix.io';

const { default: handler } = await import('../api/offer-enquiry.js');

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };

// One Airtable Widgets row, as the endpoint would fetch it.
function widgetRow(config, clientEmail) {
  return { records: [{ id: 'recTest', fields: { Config: JSON.stringify(config), ClientEmail: clientEmail } }] };
}

// Stub fetch for both hops: Airtable (GET) and SendGrid (POST). Returns the
// captured SendGrid payload plus how many Airtable calls were made.
function stubFetch(airtableBody) {
  const calls = { airtable: 0, sent: null };
  global.fetch = async (url, opts) => {
    if (String(url).includes('api.airtable.com')) {
      calls.airtable++;
      if (!airtableBody) return { ok: false, status: 500, json: async () => ({}), text: async () => '' };
      return { ok: true, status: 200, json: async () => airtableBody };
    }
    if (String(url).includes('sendgrid')) {
      calls.sent = JSON.parse(opts.body);
      return { ok: true, status: 202, text: async () => '' };
    }
    throw new Error('unexpected fetch: ' + url);
  };
  return calls;
}

function makeRes() {
  const res = { statusCode: 0, body: null, headers: {} };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.end = () => res;
  return res;
}

// Distinct IPs per case: the endpoint rate-limits 8 posts per IP per 10 minutes.
let ipN = 0;
async function post(body) {
  const req = {
    method: 'POST',
    headers: { 'x-forwarded-for': '203.0.113.' + (++ipN) },
    socket: { remoteAddress: '203.0.113.' + ipN },
    body: Object.assign({ name: 'Test Person', email: 'test@example.com' }, body)
  };
  const res = makeRes();
  await handler(req, res);
  return res;
}
const recipientOf = (calls) => calls.sent && calls.sent.personalizations[0].to[0].email;

const OFFER = {
  offer: { fields: { title: 'Red Sea and Umrah', reference: 'HWT-SA-NOV26', enquiryEmail: 'info@halalworldtravel.com' } }
};

// 1. The offer's own enquiry email wins.
{
  const calls = stubFetch(widgetRow(OFFER, 'romina@travelaire.co.uk'));
  const res = await post({ widgetId: 'tgw_1786358921770_k2bak5' });
  ok(res.statusCode === 200, 'a config-hosted enquiry is accepted');
  ok(recipientOf(calls) === 'info@halalworldtravel.com', 'routes to the offer enquiry email, not CONTACT_TO');
  ok(/HWT-SA-NOV26/.test(JSON.stringify(calls.sent)), 'carries the reference read from the config');
  ok(/Red Sea and Umrah/.test(JSON.stringify(calls.sent)), 'carries the title read from the config');
}

// 2. No enquiry email in the config falls back to the owning client, not to us.
{
  const calls = stubFetch(widgetRow({ offer: { fields: { title: 'Zanzibar' } } }, 'romina@travelaire.co.uk'));
  await post({ widgetId: 'tgw_1786358921770_zzzzzz' });
  ok(recipientOf(calls) === 'romina@travelaire.co.uk', 'falls back to the widget owner');
}

// 3. A client-supplied address is never honoured (open-relay guard).
{
  const calls = stubFetch(widgetRow(OFFER, 'romina@travelaire.co.uk'));
  await post({ widgetId: 'tgw_1786358921770_aaaaaa', to: 'attacker@evil.test', enquiryEmail: 'attacker@evil.test' });
  ok(recipientOf(calls) === 'info@halalworldtravel.com', 'ignores a recipient supplied by the browser');
  ok(!/evil\.test/.test(JSON.stringify(calls.sent)), 'the attacker address appears nowhere in the email');
}

// 4. A malformed widget id is never looked up.
{
  const calls = stubFetch(widgetRow(OFFER, 'romina@travelaire.co.uk'));
  await post({ widgetId: "tgw_' OR 1=1" });
  ok(calls.airtable === 0, 'a widget id failing the pattern is not sent to Airtable');
  ok(recipientOf(calls) === 'info@travelgenix.io', 'and the lead still falls back safely');
}

// 5. No widget id at all keeps the old behaviour.
{
  const calls = stubFetch(widgetRow(OFFER, 'romina@travelaire.co.uk'));
  await post({});
  ok(calls.airtable === 0, 'no widget id means no lookup');
  ok(recipientOf(calls) === 'info@travelgenix.io', 'unchanged fallback for a plain enquiry');
}

// 6. An Airtable outage degrades to the fallback rather than dropping the lead.
{
  const calls = stubFetch(null);
  const res = await post({ widgetId: 'tgw_1786358921770_bbbbbb' });
  ok(res.statusCode === 200, 'the enquiry is still accepted when Airtable is down');
  ok(recipientOf(calls) === 'info@travelgenix.io', 'and falls back rather than being lost');
}

// 7. The widget page actually sends the id.
{
  const { readFileSync } = await import('node:fs');
  const page = readFileSync(new URL('../public/widget-offer-page.js', import.meta.url), 'utf8');
  ok(/widgetId: this\.cfg\.widgetId/.test(page), 'widget-offer-page.js posts widgetId with the enquiry');
  ok(/widgetId: c\._widgetId \|\| c\.widgetId \|\| ''/.test(page), 'and resolves it from the remote config');
}

console.log('\nOffer enquiry widget routing: ' + passed + ' passed, ' + failed + ' failed.');
process.exit(failed ? 1 : 0);
