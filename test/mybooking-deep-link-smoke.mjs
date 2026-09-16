/**
 * A booking opens straight from a link (16 Sep 2026).
 *
 * Andy: "On the My Booking widget, if someone arrives with a URL containing all
 * three details, can you please set it to bypass the form and just open the
 * booking?", with a real one from Tripgift:
 *
 *   https://tripgift.com/orders?orderref=TG96472&depdate=2027-01-13
 *     &emailaddr=luke.livsey%40agendas.group&orderstatus=Confirmed
 *     &itemcount=1&ordertotal=A%24148.79
 *
 * The three details in that address are the three the form asks for, so
 * arriving with all of them is the customer having already answered. Anything
 * less is a head start, not a shortcut: what is there fills the form in and the
 * customer supplies the rest.
 *
 * This drives the REAL widget in jsdom, mounted on a page at that real address,
 * and watches what it asks the server for — because the thing being claimed is
 * what happens when a customer clicks a link in their confirmation email.
 *
 * Run: node test/mybooking-deep-link-smoke.mjs  (npm run test:mybooking-deep-link)
 */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const WIDGET = readFileSync(new URL('../public/widget-mybooking.js', import.meta.url), 'utf8');

let passed = 0, failed = 0;
const ok = (label, cond, detail) => {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.error('  ✗ ' + label + (detail ? '\n      ' + detail : '')); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const REF = 'TG96472';
const DATE = '2027-01-13';
const EMAIL = 'luke.livsey@agendas.group';
const LIVE = 'https://tripgift.com/orders?orderref=' + REF + '&depdate=' + DATE
  + '&emailaddr=' + encodeURIComponent(EMAIL)
  + '&orderstatus=Confirmed&itemcount=1&ordertotal=' + encodeURIComponent('A$148.79');

const ORDER = {
  id: 96472, status: 'Confirmed', bookingReference: REF,
  customerTitle: 'Mr', customerFirstname: 'Luke', customerSurname: 'Livsey',
  customerEmail: EMAIL, created: '2026-09-01T00:00:00', currency: 'AUD',
  summary: { totalPrice: 148.79, hasAccommodation: true,
    travellers: [{ type: 'Lead', title: 'Mr', firstname: 'Luke', surname: 'Livsey' }] },
  items: [{
    id: 1, status: 'Confirmed', product: 'Accommodation', bookingReference: REF,
    price: 148.79, currency: 'AUD', startDate: DATE + 'T00:00:00', duration: 3,
    accommodation: {
      name: 'The Rocks Hotel', propertyType: 'Hotel', rating: 4,
      location: { address1: '1 George St', city: 'Sydney', country: 'AU' },
      units: [{ name: 'Harbour View', roomType: 'Harbour View', checkin: DATE + 'T00:00:00',
        nights: 3, rates: [{ board: 'RoomOnly' }], sleepsAdults: 2, sleepsChildren: 0 }],
      pricing: { price: 148.79, currency: 'AUD', isRefundable: false },
      guests: [{ type: 'Lead', title: 'Mr', firstname: 'Luke', surname: 'Livsey' }], media: [],
    },
  }],
};

/** A client's page at a given address, with the real widget on it. */
function page(url, { found = true } = {}) {
  const dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>',
    { runScripts: 'outside-only', url, pretendToBeVisual: true });
  const { window } = dom;
  window.requestAnimationFrame = (cb) => window.setTimeout(() => cb(0), 0);
  if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  const calls = [];
  window.fetch = async (u, opts) => {
    calls.push({ url: String(u), body: opts && opts.body ? JSON.parse(opts.body) : null });
    if (!found) return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
    return { ok: true, status: 200, json: async () => ({ order: ORDER }), text: async () => '' };
  };
  window.eval(WIDGET);
  return { window, calls };
}
const mount = async ({ window }, cfg) => {
  const host = window.document.getElementById('host');
  const w = new window.TGMyBookingWidget(host, Object.assign({ widgetId: 'tgw_tripgift_1' }, cfg || {}));
  await sleep(60);
  return w;
};
const html = (w) => (w.shadow ? w.shadow.innerHTML : '');
const retrieves = (calls) => calls.filter((c) => /retrieve-order/.test(c.url));
const formValue = (w, name) => {
  const el = w.shadow.querySelector('[name="' + name + '"]');
  return el ? el.value : null;
};

console.log('The real Tripgift link opens the booking, no form');
{
  const ctx = page(LIVE);
  const w = await mount(ctx);
  const sent = retrieves(ctx.calls);
  ok('it looked the booking up on its own', sent.length === 1, String(sent.length) + ' lookups');
  ok('with the three details from the address',
    sent[0] && sent[0].body.orderRef === REF && sent[0].body.departDate === DATE
    && sent[0].body.emailAddress === EMAIL, JSON.stringify(sent[0] && sent[0].body));
  ok('and the widget id from its own config', sent[0] && sent[0].body.widgetId === 'tgw_tripgift_1');
  ok('the booking is on screen', w.state.stage === 'found' && /The Rocks Hotel/.test(html(w)));
  ok('the lookup form is not', !w.shadow.querySelector('[name="ref"]'));
  ok('the extra parameters on the link were ignored',
    sent[0] && Object.keys(sent[0].body).sort().join(',') === 'departDate,emailAddress,orderRef,widgetId',
    JSON.stringify(Object.keys(sent[0] ? sent[0].body : {})));
}

console.log('Other spellings of the same three work too');
{
  for (const q of [
    'ref=' + REF + '&date=' + DATE + '&email=' + encodeURIComponent(EMAIL),
    'bookingref=' + REF + '&departuredate=' + DATE + '&emailaddress=' + encodeURIComponent(EMAIL),
    'Reference=' + REF + '&DepDate=' + DATE + '&EmailAddr=' + encodeURIComponent(EMAIL),
  ]) {
    const ctx = page('https://client.test/my-booking?' + q);
    const w = await mount(ctx);
    ok('“' + q.slice(0, 28) + '…” opens the booking',
      retrieves(ctx.calls).length === 1 && w.state.stage === 'found');
  }
}

console.log('A partial link fills the form in rather than guessing');
{
  const ctx = page('https://tripgift.com/orders?orderref=' + REF + '&depdate=' + DATE);
  const w = await mount(ctx);
  ok('nothing was looked up', retrieves(ctx.calls).length === 0);
  ok('the form is showing', !!w.shadow.querySelector('[name="ref"]'));
  ok('with the reference already in it', formValue(w, 'ref') === REF, formValue(w, 'ref'));
  ok('and the departure date', formValue(w, 'date') === DATE, formValue(w, 'date'));
  ok('leaving the customer only the email', !formValue(w, 'email'));
}

console.log('A value in the wrong shape is dropped, not sent');
{
  const bad = 'https://tripgift.com/orders?orderref=' + REF
    + '&depdate=13%2F01%2F2027&emailaddr=' + encodeURIComponent('not-an-email');
  const ctx = page(bad);
  const w = await mount(ctx);
  ok('no lookup was attempted on rubbish', retrieves(ctx.calls).length === 0);
  ok('the customer lands on the form, not on "we couldn\'t find that booking"',
    w.state.stage === 'form' && !!w.shadow.querySelector('[name="ref"]'));
  ok('the one good value is still there', formValue(w, 'ref') === REF);
  ok('and the bad ones are not', !formValue(w, 'date') && !formValue(w, 'email'));
}

console.log('A link to a booking that is not there behaves like a typed one');
{
  const ctx = page(LIVE, { found: false });
  const w = await mount(ctx);
  ok('it tried once', retrieves(ctx.calls).length === 1);
  ok('and shows the not-found screen', w.state.stage === 'notfound');
  ok('Try again returns to a form holding the details, not a blank one',
    w._lastAttempt && w._lastAttempt.ref === REF && w._lastAttempt.email === EMAIL);
}

console.log('It happens once, and Look up another booking still means what it says');
{
  const ctx = page(LIVE);
  const w = await mount(ctx);
  ok('one lookup so far', retrieves(ctx.calls).length === 1);

  const again = w.shadow.querySelector('[data-tgm-newlookup]');
  ok('the booking screen offers another lookup', !!again);
  again.dispatchEvent(new ctx.window.MouseEvent('click', { bubbles: true }));
  await sleep(60);
  ok('it returns to a BLANK form even though the link is still in the address bar',
    w.state.stage === 'form' && !formValue(w, 'ref') && !formValue(w, 'email'));
  ok('and nothing was looked up again', retrieves(ctx.calls).length === 1);

  w._render();
  await sleep(30);
  ok('a re-render does not bounce the customer back into the booking',
    w.state.stage === 'form' && retrieves(ctx.calls).length === 1);
}

console.log('An ordinary page is untouched');
{
  const ctx = page('https://tripgift.com/orders');
  const w = await mount(ctx);
  ok('no lookup', retrieves(ctx.calls).length === 0);
  ok('a blank form, as before', w.state.stage === 'form' && !formValue(w, 'ref'));

  const other = page('https://tripgift.com/orders?utm_source=email&page=2');
  const w2 = await mount(other);
  ok('parameters that are nothing to do with us change nothing',
    retrieves(other.calls).length === 0 && w2.state.stage === 'form');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
