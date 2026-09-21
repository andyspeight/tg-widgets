/**
 * Showing a real booking through every design (21 Sep 2026).
 *
 * Andy: "a test page so I can enter a booking reference from Travelify, and it
 * will show a mock-up of each of the pre-built designs so I can show people the
 * new platform with real data that doesn't require the webhooks to be set."
 *
 * The one way to get this wrong is the way it was got wrong before. The My
 * Booking editor used to preview this email with a SECOND implementation, and
 * the two drifted: the preview said "Your Dubai booking is confirmed — 3 Feb
 * 2027" while the real email said "Your Dubai booking confirmation (DEMO81376)",
 * 15.7KB against 10.2KB, different headings and structure. A client checking
 * their branding was shown an email we do not send. That file is gone and the
 * renderer is shared.
 *
 * So this preview reuses everything: the order comes from /api/retrieve-order,
 * the styles from EMAIL_STYLES, and the brand, reply-to and support details
 * from api/_lib/booking-email-brand.js, which api/booking-email.js now also
 * uses. This suite holds that line, and proves every style actually draws.
 *
 * Run: node test/booking-email-preview-smoke.mjs  (npm run test:booking-email-preview)
 */
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
const ok = (label, cond, detail) => {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.error('  ✗ ' + label + (detail ? '\n      ' + detail : '')); }
};

const R = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const SENDER = R('api/booking-email.js');
const PREVIEW = R('api/admin/booking-email-preview.js');

const { readWidgetSettings, buildEmailBrand, demoEmailBrand } =
  await import('../api/_lib/booking-email-brand.js');
const { stylesToRender } = await import('../api/admin/booking-email-preview.js');
const { renderBookingEmail, EMAIL_STYLES } = await import('../api/_lib/booking-email-template.js');

// Shapes copied from test/confirmation-blocks-smoke.mjs, which is built on a
// real Travelify order. Inventing a shape is how earlier work went wrong.
const ORDER = {
  id: 121109, status: 'Confirmed', bookingReference: 'ET121109',
  customerTitle: 'Mrs', customerFirstname: 'Gemma', customerSurname: 'Whitaker',
  customerEmail: 'gemma@example.com', created: '2026-05-02T00:00:00', currency: 'GBP',
  summary: { totalPrice: 3700, hasAccommodation: true, earliestStart: '2026-09-26T00:00:00',
    travellers: [{ type: 'Lead', title: 'Mrs', firstname: 'Gemma', surname: 'Whitaker' }] },
  payments: [{ amount: 1000, date: '2026-05-02T00:00:00', status: 'Success' }],
  documents: [{ name: 'ATOL certificate', url: 'https://static.travelify.io/docs/atol.pdf' }],
  items: [
    { id: 1, status: 'Confirmed', product: 'Accommodation', bookingReference: 'ET121109',
      price: 2100, currency: 'GBP', startDate: '2026-09-26T00:00:00', duration: 6,
      accommodation: { name: 'Atmosphere Kanifushi', propertyType: 'Hotel', rating: 5,
        location: { address1: 'Lhaviyani Atoll', city: 'Male', country: 'Maldives' },
        units: [{ name: 'Beach Villa', checkin: '2026-09-26T00:00:00', nights: 6,
          rates: [{ board: 'AllInclusive' }], sleepsAdults: 2, sleepsChildren: 0 }],
        pricing: { price: 2100, currency: 'GBP', isRefundable: false },
        media: [{ type: 'GenericImage', url: 'https://static.travelify.io/hotels/kanifushi-1.jpg' }] } },
    { id: 2, status: 'Confirmed', product: 'Flights', bookingReference: 'FL9921',
      price: 1600, currency: 'GBP', startDate: '2026-09-26T00:00:00',
      flights: { routes: [
        { direction: 'Outbound', segments: [{ depart: '2026-09-26T14:00:00', arrive: '2026-09-27T06:10:00',
          origin: { iataCode: 'LHR', name: 'Heathrow' }, destination: { iataCode: 'MLE', name: 'Male' },
          carrier: { name: 'British Airways' }, flightNumber: 'BA2049' }] },
      ] } },
  ],
};

console.log('Whose email it is, resolved one way for everybody');
{
  const base = { FromName: 'Exclusively Travel', FromEmail: 'hello@ex.com', ClientEmail: 'acct@ex.com',
    LogoUrl: 'https://cdn.ex.com/logo.png', EmailFooter: 'Exclusively Travel — ATOL 1234', ClientName: 'Exclusively Ltd' };

  let b = buildEmailBrand(base, {});
  ok('the From name wins when set', b.brandConfig.name === 'Exclusively Travel');
  ok('an https logo is kept', b.brandConfig.logoUrl === 'https://cdn.ex.com/logo.png');
  ok('the footer line travels', b.brandConfig.footerLine === 'Exclusively Travel — ATOL 1234');
  ok('reply-to is the From address', b.replyToAddress === 'hello@ex.com');
  ok('support falls back to reply-to', b.supportEmail === 'hello@ex.com');

  b = buildEmailBrand({ ...base, FromName: '', LogoUrl: 'http://cdn.ex.com/logo.png' }, { brand: { name: 'Saved Brand' } });
  ok('the saved brand name is next in line', b.brandConfig.name === 'Saved Brand');
  // An http logo renders as a broken image in mail clients that block mixed content.
  ok('an http logo is dropped rather than shown broken', b.brandConfig.logoUrl === '');

  b = buildEmailBrand({ ...base, FromName: '', ClientName: 'Exclusively Ltd' }, {});
  ok('then the client name', b.brandConfig.name === 'Exclusively Ltd');
  ok('and never nothing', buildEmailBrand({}, {}).brandConfig.name === 'Travel Team');

  b = buildEmailBrand({ FromEmail: 'not-an-email', ClientEmail: 'acct@ex.com' }, {});
  ok('a malformed From address falls back to the client address', b.replyToAddress === 'acct@ex.com');

  b = buildEmailBrand(base, { support: { email: 'help@ex.com', phone: '020 7946 0000' } });
  ok('explicit support details win', b.supportEmail === 'help@ex.com' && b.supportPhone === '020 7946 0000');

  ok('the demo defaults are their own thing', demoEmailBrand().brandConfig.name === 'Travelgenix Demo');
}

console.log('The saved configuration is read the way the widget writes it');
{
  ok('Config as an object', readWidgetSettings({ Config: { colors: { primary: '#123456' } } }).colors.primary === '#123456');
  ok('Config as a JSON string', readWidgetSettings({ Config: '{"colors":{"primary":"#abcdef"}}' }).colors.primary === '#abcdef');
  // Settings is legacy and the widget never writes it; reading it FIRST left
  // emails on Travelgenix defaults, so it is only ever the fallback.
  ok('Settings only when there is no Config', readWidgetSettings({ Settings: '{"brand":{"name":"Old"}}' }).brand.name === 'Old');
  ok('Config wins over Settings', readWidgetSettings({ Config: '{"brand":{"name":"New"}}', Settings: '{"brand":{"name":"Old"}}' }).brand.name === 'New');
  ok('unparseable is an empty object, not a crash', JSON.stringify(readWidgetSettings({ Config: 'not json' })) === '{}');
  ok('nothing at all is an empty object', JSON.stringify(readWidgetSettings({})) === '{}');
}

console.log('The sender and the preview cannot drift apart');
{
  ok('the sender reads its brand from the shared module',
    /from '\.\/_lib\/booking-email-brand\.js'/.test(SENDER));
  ok('and no longer builds one of its own',
    !/brandConfig\.name = fromName/.test(SENDER) && !/brandConfig\.logoUrl = \(logoUrl/.test(SENDER));
  ok('the preview reads the same module',
    /from '\.\.\/_lib\/booking-email-brand\.js'/.test(PREVIEW));
  ok('both render through the one template module',
    /booking-email-template\.js/.test(SENDER) && /booking-email-template\.js/.test(PREVIEW));
  ok('the preview takes its order from /api/retrieve-order, not its own call',
    /\/api\/retrieve-order/.test(PREVIEW) && !/api\.travelify\.io/.test(PREVIEW));
}

console.log('The preview cannot send anything');
{
  ok('it never imports the mailer', !/sendgrid/i.test(PREVIEW));
  ok('it refuses anything but GET', /req\.method !== 'GET'/.test(PREVIEW));
  ok('it is behind the staff gate', /requireAdmin\(req\)/.test(PREVIEW));
  ok('a rendered customer booking is never cached by a proxy',
    /Cache-Control[\s\S]{0,40}no-store/.test(PREVIEW));
}

console.log('Every design actually draws');
{
  const styles = stylesToRender({});
  ok('all four pre-built styles are offered', styles.length === EMAIL_STYLES.length && styles.length === 4,
    styles.map(s => s.id).join(', '));

  const withOwn = stylesToRender({ confirmationEmail: { layout: [{ type: 'greeting' }, { type: 'summary' }] } });
  ok('a client with their own layout gets it too', withOwn.length === 5);
  // Showing an agency what their customers get is the point, so it leads.
  ok('and it is listed first', withOwn[0].id === 'current');
  ok('an empty saved layout is ignored', stylesToRender({ confirmationEmail: { layout: [] } }).length === 4);

  const brand = { name: 'Exclusively Travel', logoUrl: '', footerLine: 'ATOL 1234' };
  for (const s of withOwn) {
    let out = null, threw = '';
    try {
      out = renderBookingEmail({
        order: ORDER, message: '', brand, colors: {}, supportEmail: 'help@ex.com',
        supportPhone: '', orderRef: 'ET121109', layout: s.layout, destination: null, baseUrl: 'https://x',
      });
    } catch (e) { threw = String(e && e.message); }
    ok(s.id + ' renders without throwing', !threw, threw);
    ok(s.id + ' has a subject', !!(out && out.subject && out.subject.trim()), out && out.subject);
    ok(s.id + ' has a body carrying the booking reference',
      !!(out && out.html && out.html.length > 500 && out.html.indexOf('ET121109') > -1),
      out && out.html ? 'length ' + out.html.length : 'no html');
    ok(s.id + ' is branded with the agency, not with us',
      !!(out && out.html.indexOf('Exclusively Travel') > -1));
  }
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
