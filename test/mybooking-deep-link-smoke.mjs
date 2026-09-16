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
 * Once the booking is open the three details come back OUT of the address bar
 * (Andy, same day: "Yes please strip the details out of the URL after it
 * opens"), because the link is the booking and it does not need to sit in
 * history afterwards. Only the parameters we used are removed.
 *
 * That cost the customer their refresh, so the tab remembers instead (Andy:
 * "Can you set it to remember"). Only the three details, never the booking, in
 * sessionStorage, keyed by widget id. A refresh here is a SECOND widget on a
 * clean address sharing the first one's storage, which is exactly what a
 * browser does.
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

/** One tab's sessionStorage, shared across a "refresh" the way a browser does. */
function makeStore() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(String(k)) ? map.get(String(k)) : null),
    setItem: (k, v) => { map.set(String(k), String(v)); },
    removeItem: (k) => { map.delete(String(k)); },
    clear: () => map.clear(),
    get length() { return map.size; },
    key: (i) => Array.from(map.keys())[i] ?? null,
    _map: map,
  };
}

/** A client's page at a given address, with the real widget on it. */
function page(url, { found = true, store = null } = {}) {
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
  if (store) Object.defineProperty(window, 'sessionStorage', { value: store, configurable: true });
  window.eval(WIDGET);
  return { window, calls, store: store || window.sessionStorage };
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

console.log('The details come out of the address bar once the booking is up');
{
  const ctx = page(LIVE);
  const w = await mount(ctx);
  const after = new URL(ctx.window.location.href);
  ok('the booking is open', w.state.stage === 'found');
  ok('the reference is gone from the address', !after.searchParams.has('orderref'), after.search);
  ok('the departure date is gone', !after.searchParams.has('depdate'), after.search);
  ok('the email address is gone', !after.searchParams.has('emailaddr'), after.search);
  ok('the client\'s own parameters survive',
    after.searchParams.get('orderstatus') === 'Confirmed'
    && after.searchParams.get('itemcount') === '1'
    && after.searchParams.get('ordertotal') === 'A$148.79', after.search);
  ok('and so does their path', after.pathname === '/orders', after.pathname);
}

console.log('It takes only what it used');
{
  // Every spelling it reads, plus a hash and a tracking parameter that are
  // nothing to do with us.
  const ctx = page('https://client.test/booking?utm_source=email&Reference=' + REF
    + '&DepDate=' + DATE + '&EmailAddress=' + encodeURIComponent(EMAIL) + '&page=2#tg-pay');
  const w = await mount(ctx);
  const after = new URL(ctx.window.location.href);
  ok('the booking opened', w.state.stage === 'found');
  ok('all three spellings were removed whatever their case',
    !/reference|depdate|emailaddress/i.test(after.search), after.search);
  ok('the tracking parameter is left alone', after.searchParams.get('utm_source') === 'email');
  ok('so is anything else the page was carrying', after.searchParams.get('page') === '2');
  ok('and the hash survives, so #tg-pay still opens the payment card', after.hash === '#tg-pay');
}

console.log('A link that did not work is left in the address to retry');
{
  const ctx = page(LIVE, { found: false });
  const w = await mount(ctx);
  ok('the lookup failed', w.state.stage === 'notfound');
  ok('the details are still in the address, so a refresh tries again',
    new URL(ctx.window.location.href).searchParams.get('orderref') === REF);
}

console.log('Nothing else touches the address bar');
{
  const partial = page('https://tripgift.com/orders?orderref=' + REF + '&depdate=' + DATE);
  await mount(partial);
  ok('a partial link is left exactly as it arrived',
    new URL(partial.window.location.href).searchParams.get('orderref') === REF);

  // A customer typing into the form, on a page with no link at all.
  const typed = page('https://tripgift.com/orders?utm_source=email');
  const w = await mount(typed);
  const form = w.shadow.querySelector('form');
  w.shadow.querySelector('[name="email"]').value = EMAIL;
  w.shadow.querySelector('[name="date"]').value = DATE;
  w.shadow.querySelector('[name="ref"]').value = REF;
  form.dispatchEvent(new typed.window.Event('submit', { bubbles: true, cancelable: true }));
  await sleep(60);
  ok('a typed lookup finds the booking', w.state.stage === 'found');
  ok('and leaves the address bar alone',
    new URL(typed.window.location.href).search === '?utm_source=email',
    new URL(typed.window.location.href).search);
}

console.log('A browser that will not rewrite the address still shows the booking');
{
  const ctx = page(LIVE);
  ctx.window.history.replaceState = () => { throw new Error('nope'); };
  const w = await mount(ctx);
  ok('the booking is on screen regardless', w.state.stage === 'found' && /The Rocks Hotel/.test(html(w)));
}

console.log('The tab remembers, so a refresh still shows the booking');
{
  const store = makeStore();
  const first = page(LIVE, { store });
  const w1 = await mount(first);
  ok('the link opened the booking', w1.state.stage === 'found');
  ok('and the address was cleaned', !new URL(first.window.location.href).searchParams.has('orderref'));
  ok('the three details are held for the tab, and nothing else is',
    store.length === 1 && JSON.parse(store.key(0) && store.getItem(store.key(0)))
    && Object.keys(JSON.parse(store.getItem(store.key(0)))).sort().join(',') === 'at,date,email,ref',
    store.key(0) + ' = ' + store.getItem(store.key(0)));
  ok('the booking itself is NOT stored', !/Rocks Hotel|Livsey/.test(store.getItem(store.key(0))));
  ok('the key names the widget', store.key(0) === 'tgm_link_tgw_tripgift_1', store.key(0));

  // The refresh: a new page at the cleaned address, same tab storage.
  const after = page('https://tripgift.com/orders?orderstatus=Confirmed', { store });
  const w2 = await mount(after);
  ok('the booking comes back without the customer doing anything', w2.state.stage === 'found');
  ok('it was looked up again rather than drawn from a stale copy',
    retrieves(after.calls).length === 1
    && retrieves(after.calls)[0].body.orderRef === REF);
  ok('and the address is still clean',
    new URL(after.window.location.href).search === '?orderstatus=Confirmed',
    new URL(after.window.location.href).search);
}

console.log('Look up another booking means the tab forgets it');
{
  const store = makeStore();
  const first = page(LIVE, { store });
  const w = await mount(first);
  w.shadow.querySelector('[data-tgm-newlookup]')
    .dispatchEvent(new first.window.MouseEvent('click', { bubbles: true }));
  await sleep(60);
  ok('nothing is remembered any more', store.length === 0);

  const after = page('https://tripgift.com/orders', { store });
  const w2 = await mount(after);
  ok('so a refresh shows the form, not the booking they just left',
    w2.state.stage === 'form' && retrieves(after.calls).length === 0);
}

console.log('A booking that has gone stops being offered back');
{
  const store = makeStore();
  const first = page(LIVE, { store });
  await mount(first);
  ok('it was remembered', store.length === 1);

  // Cancelled since, so the next refresh gets a 404.
  const gone = page('https://tripgift.com/orders', { store, found: false });
  const w2 = await mount(gone);
  ok('the refresh tried once and landed on not-found', w2.state.stage === 'notfound');
  ok('and the tab forgot it rather than trying forever', store.length === 0);

  const third = page('https://tripgift.com/orders', { store });
  const w3 = await mount(third);
  ok('the refresh after that is a plain form', w3.state.stage === 'form' && retrieves(third.calls).length === 0);
}

console.log('Only a link is remembered, and only for its own widget');
{
  const store = makeStore();
  const typed = page('https://tripgift.com/orders', { store });
  const w = await mount(typed);
  const form = w.shadow.querySelector('form');
  w.shadow.querySelector('[name="email"]').value = EMAIL;
  w.shadow.querySelector('[name="date"]').value = DATE;
  w.shadow.querySelector('[name="ref"]').value = REF;
  form.dispatchEvent(new typed.window.Event('submit', { bubbles: true, cancelable: true }));
  await sleep(60);
  ok('a typed lookup found the booking', w.state.stage === 'found');
  ok('and left nothing behind, exactly as before', store.length === 0);

  // A link, then a DIFFERENT widget reading the same tab.
  const linked = page(LIVE, { store });
  await mount(linked);
  const other = page('https://tripgift.com/orders', { store });
  const w2 = await mount(other, { widgetId: 'tgw_someone_else' });
  ok('another widget cannot read this one\'s memory',
    w2.state.stage === 'form' && retrieves(other.calls).length === 0);
}

console.log('The address always wins over the memory');
{
  const store = makeStore();
  const first = page(LIVE, { store });
  await mount(first);

  const OTHER_REF = 'TG55555';
  const second = page('https://tripgift.com/orders?orderref=' + OTHER_REF
    + '&depdate=' + DATE + '&emailaddr=' + encodeURIComponent(EMAIL), { store });
  const w2 = await mount(second);
  ok('a second link opens the booking it names, not the remembered one',
    retrieves(second.calls).length === 1 && retrieves(second.calls)[0].body.orderRef === OTHER_REF,
    JSON.stringify(retrieves(second.calls).map((c) => c.body.orderRef)));
  ok('and that one is what the tab now remembers',
    JSON.parse(store.getItem('tgm_link_tgw_tripgift_1')).ref === OTHER_REF);
}

console.log('A tab left open for days does not hand the booking over');
{
  const store = makeStore();
  const first = page(LIVE, { store });
  await mount(first);
  const saved = JSON.parse(store.getItem('tgm_link_tgw_tripgift_1'));
  saved.at = Date.now() - (13 * 60 * 60 * 1000);          // thirteen hours ago
  store.setItem('tgm_link_tgw_tripgift_1', JSON.stringify(saved));

  const after = page('https://tripgift.com/orders', { store });
  const w2 = await mount(after);
  ok('the stale memory is ignored', w2.state.stage === 'form' && retrieves(after.calls).length === 0);
  ok('and cleared out', store.length === 0);
}

console.log('A browser with storage switched off still works');
{
  const dead = {
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('denied'); },
    removeItem() { throw new Error('denied'); },
    clear() {}, key() { return null; }, get length() { return 0; },
  };
  const ctx = page(LIVE, { store: dead });
  const w = await mount(ctx);
  ok('the link still opens the booking', w.state.stage === 'found');
  ok('and the address is still cleaned', !new URL(ctx.window.location.href).searchParams.has('orderref'));
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
