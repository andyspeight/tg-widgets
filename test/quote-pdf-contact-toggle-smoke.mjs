/**
 * Quote PDF — "Show contact details" toggle (widget feedback, Sep 2026).
 *
 * A client can hide the phone + email everywhere on the quote PDF when they'd
 * rather not show an agent's direct details. The setting lives in the My… no,
 * in the Quote PDF editor as config.showContact (default true) and is forwarded
 * through buildRenderOpts → resolveBrand → the two places contact appears:
 *   - the header block (company support phone/email, or the page contact), and
 *   - the agent footer block (the agent's own email + phone).
 * When off, BOTH hide; the agent's NAME and role stay. Default/absent → shown,
 * so every existing saved quote renders exactly as before.
 *
 * Run: node test/quote-pdf-contact-toggle-smoke.mjs  (npm run test:quote-pdf-contact)
 */
import { renderQuoteHTML } from '../render-quote.js';

let passed = 0, failed = 0;
const ok = (name, cond) => { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; console.error('  ✗ ' + name); } };

// A flat-shape quote carrying both a lead contact and an agent (page details).
const quote = {
  quoteId: 'Q-1', name: 'Sunshine Getaway', currency: 'GBP',
  contactEmail: 'lead@client.example', contactTelNo: '01111 222333',
  agent: { name: 'Dana Agent', role: 'Travel Consultant', email: 'dana@agency.example', phone: '07777 888999' },
  items: [{ accommodationName: 'Test Hotel', city: 'Nice', checkIn: '2026-09-01', checkOut: '2026-09-08', price: 1200, currency: 'GBP' }],
  total: 1200,
};
// Header contacts come from the brand's own support fields.
const brand = (showContact) => ({ brand: { name: 'Agency', supportEmail: 'hello@agency.example', supportPhone: '0333 000 111', showContact } });

console.log('Default (no flag) shows every contact — unchanged behaviour');
{
  const html = renderQuoteHTML(quote, { brand: { name: 'Agency', supportEmail: 'hello@agency.example', supportPhone: '0333 000 111' } });
  ok('header support phone shows', html.includes('0333 000 111'));
  ok('header support email shows', html.includes('hello@agency.example'));
  ok('agent email shows', html.includes('dana@agency.example'));
  ok('agent phone shows', html.includes('07777 888999'));
  ok('agent name shows', html.includes('Dana Agent'));
}

console.log('showContact:false hides phone + email everywhere, keeps the agent name');
{
  const html = renderQuoteHTML(quote, brand(false));
  ok('header support phone is hidden', !html.includes('0333 000 111'));
  ok('header support email is hidden', !html.includes('hello@agency.example'));
  ok('agent email is hidden', !html.includes('dana@agency.example'));
  ok('agent phone is hidden', !html.includes('07777 888999'));
  ok('the empty agent-contact box is dropped entirely', !html.includes('<div class="agent-contact">'));
  ok('the agent NAME still shows', html.includes('Dana Agent'));
  ok('the agent role still shows', html.includes('Travel Consultant'));
}

console.log('showContact:true explicit behaves like the default');
{
  const html = renderQuoteHTML(quote, brand(true));
  ok('header phone shows', html.includes('0333 000 111'));
  ok('agent phone shows', html.includes('07777 888999'));
}

console.log('The header page-contact FALLBACK is gated too (no brand support fields)');
{
  const shown = renderQuoteHTML(quote, { brand: { name: 'Agency' } });
  ok('with no support fields the header falls back to the page contact tel', shown.includes('01111 222333'));
  const hidden = renderQuoteHTML(quote, { brand: { name: 'Agency', showContact: false } });
  ok('and that fallback is hidden when contact is off', !hidden.includes('01111 222333'));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
