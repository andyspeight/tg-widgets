/**
 * The confirmation email is a list of blocks (16 Sep 2026).
 *
 * Andy: "I want the email set up / editor to be very flexible so that the user
 * can create their own email layout, and just add the data blocks with the
 * booking information."
 *
 * So the email stopped being one fixed page. It is now an ordered list of
 * blocks: the client arranges them, writes their own words between them, and
 * every block carrying booking information fills itself from the order.
 *
 * The rule that makes this safe to ship is the FIRST test below: a client who
 * never opens the layout builder must get exactly the email we have always
 * sent. That was proved against the pre-change renderer before this suite was
 * written — same subject, same plain-text part, and HTML identical once
 * indentation and HTML comments are normalised (an email client renders those
 * the same; nothing else moved). This suite holds the line from here on.
 *
 * ONE list: the editor builds its palette from EMAIL_BLOCKS and the renderer
 * draws from the same array, so a block cannot exist in one and not the other.
 *
 * Run: node test/confirmation-blocks-smoke.mjs  (npm run test:confirmation-blocks)
 */
import {
  renderBookingEmail, EMAIL_BLOCKS, DEFAULT_EMAIL_LAYOUT, normaliseLayout,
} from '../public/_booking-email-template.js';

let passed = 0, failed = 0;
const ok = (label, cond, detail) => {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.error('  ✗ ' + label + (detail ? '\n      ' + detail : '')); }
};

const ORDER = {
  id: 121109, status: 'Confirmed', bookingReference: 'ET121109',
  customerTitle: 'Mrs', customerFirstname: 'Gemma', customerSurname: 'Whitaker',
  customerEmail: 'gemma@example.com', created: '2026-05-02T00:00:00', currency: 'GBP',
  summary: { totalPrice: 4210.5, hasAccommodation: true, earliestStart: '2026-09-26T00:00:00',
    travellers: [
      { type: 'Lead', title: 'Mrs', firstname: 'Gemma', surname: 'Whitaker' },
      { type: 'Adult', title: 'Mr', firstname: 'Paul', surname: 'Whitaker' },
    ] },
  payments: [{ amount: 1000, date: '2026-05-02T00:00:00', status: 'Success' }],
  documents: [{ name: 'ATOL certificate', url: 'https://static.travelify.io/docs/atol.pdf' }],
  items: [
    { id: 1, status: 'Confirmed', product: 'Accommodation', bookingReference: 'ET121109',
      price: 2100, currency: 'GBP', startDate: '2026-09-26T00:00:00', duration: 6,
      accommodation: { name: 'Atmosphere Kanifushi', propertyType: 'Hotel', rating: 5,
        location: { address1: 'Lhaviyani Atoll', city: 'Male', country: 'Maldives' },
        units: [{ name: 'Beach Villa', roomType: 'Beach Villa', checkin: '2026-09-26T00:00:00',
          nights: 6, rates: [{ board: 'AllInclusive' }], sleepsAdults: 2, sleepsChildren: 0 }],
        pricing: { price: 2100, currency: 'GBP', isRefundable: false },
        guests: [{ type: 'Lead', title: 'Mrs', firstname: 'Gemma', surname: 'Whitaker' }], media: [] } },
    { id: 2, status: 'Confirmed', product: 'Flights', bookingReference: 'FL9921',
      price: 1600, currency: 'GBP', startDate: '2026-09-26T00:00:00',
      flights: { routes: [
        { direction: 'Outbound', segments: [{ depart: '2026-09-26T14:00:00', arrive: '2026-09-27T06:10:00',
          origin: { iataCode: 'LHR', name: 'Heathrow' }, destination: { iataCode: 'MLE', name: 'Male' },
          carrier: { name: 'British Airways' }, flightNumber: 'BA2049' }] },
        { direction: 'Return', segments: [{ depart: '2026-10-02T09:30:00', arrive: '2026-10-02T17:45:00',
          origin: { iataCode: 'MLE', name: 'Male' }, destination: { iataCode: 'LHR', name: 'Heathrow' },
          carrier: { name: 'British Airways' }, flightNumber: 'BA2048' }] },
      ] } },
    { id: 3, status: 'Confirmed', product: 'Transfers', price: 120, currency: 'GBP',
      transfers: { outPickup: { name: 'Male Airport', dateTime: '2026-09-27T07:00:00' },
        outDropoff: { name: 'Atmosphere Kanifushi' },
        returnPickup: { name: 'Atmosphere Kanifushi', dateTime: '2026-10-02T06:00:00' } } },
    { id: 4, status: 'Confirmed', product: 'CarRental', price: 210, currency: 'GBP',
      carRental: { name: 'VW Golf', className: 'Compact',
        pickup: { name: 'Heathrow T5', address1: 'Heathrow', dateTime: '2026-09-26T10:00:00' },
        dropoff: { name: 'Heathrow T5', dateTime: '2026-09-26T13:00:00' } } },
    { id: 5, status: 'Confirmed', product: 'TicketsAttractions', price: 90, currency: 'GBP',
      startDate: '2026-09-28T00:00:00',
      ticketsAttractions: { name: 'Sunset dolphin cruise', ticketType: 'Excursion',
        location: { city: 'Lhaviyani', country: 'Maldives' },
        selectedOption: { name: 'Adult', scheduledDateTime: '2026-09-28T16:30:00' } } },
    { id: 6, status: 'Confirmed', product: 'Extras', price: 90.5, currency: 'GBP',
      extras: { groups: [{ name: 'Airport extras', type: 'Extra',
        extras: [{ name: 'Lounge pass', description: 'Aspire Lounge T5', qty: 2 }] }] } },
  ],
};

const OPTS = {
  order: ORDER, message: 'Booked for you by Jess. Any questions, just shout.',
  brand: { name: 'Exclusively Travel', logoUrl: 'https://cdn.example.com/et.png', footerLine: 'ABTA P1234' },
  colors: { primary: '#1B2B5B', accent: '#00B4D8' },
  supportEmail: 'hello@exclusivelytravel.co.uk', supportPhone: '01202 934033',
  orderRef: 'ET121109', baseUrl: 'https://exclusivelytravel.co.uk/my-booking',
};

const render = (layout) => renderBookingEmail({ ...OPTS, layout });
const norm = (h) => h.replace(/<!--[^>]*-->/g, '').replace(/\s+/g, ' ').trim();
// Where a block sits in the finished email, or -1. Anchored on wording only
// that block produces.
const at = (html, needle) => html.indexOf(needle);

console.log('A client who never touches it gets the email we have always sent');
{
  const none = render(undefined);
  const dflt = render(DEFAULT_EMAIL_LAYOUT);
  ok('no layout and the built-in layout are the same email', norm(none.html) === norm(dflt.html));
  ok('as are the subject and the plain-text part',
    none.subject === dflt.subject && none.text === dflt.text);
  ok('an empty layout falls back rather than sending a blank email',
    norm(render([]).html) === norm(none.html));
  ok('so does rubbish', norm(render('nonsense').html) === norm(none.html)
    && norm(render([{ type: 'not-a-block' }, null, 7]).html) === norm(none.html));
  ok('and the built-in order is the one we shipped',
    DEFAULT_EMAIL_LAYOUT.map(b => b.type).join(',')
      === 'greeting,message,summary,documents,payment,pdfnote,support,signoff');
}

console.log('Every block in the palette is one the renderer knows');
{
  const types = EMAIL_BLOCKS.map(b => b.type);
  ok('no duplicates in the palette', new Set(types).size === types.length);
  ok('every built-in layout entry is in the palette',
    DEFAULT_EMAIL_LAYOUT.every(b => types.includes(b.type)));
  ok('normaliseLayout keeps only blocks the palette has',
    normaliseLayout([{ type: 'flights' }, { type: 'invented' }]).map(b => b.type).join(',') === 'flights');
  ok('every block says whether it is filled in or written',
    EMAIL_BLOCKS.every(b => b.kind === 'data' || b.kind === 'write'));
  ok('every written block declares its fields',
    EMAIL_BLOCKS.filter(b => b.kind === 'write').every(b => Array.isArray(b.fields)));
  // Each data block must actually draw something from this order, or the
  // palette is offering a client a block that silently does nothing.
  const silent = EMAIL_BLOCKS
    .filter(b => b.kind === 'data' && b.type !== 'message')
    .filter(b => norm(render([{ type: b.type }]).html).length <= norm(render([{ type: 'divider' }]).html).length);
  ok('every data block renders something for a booking that has it', silent.length === 0,
    silent.map(b => b.type).join(', '));
}

console.log('The order of the list is the order of the email');
{
  const html = render([{ type: 'payment' }, { type: 'flights' }, { type: 'greeting' }]).html;
  const payAt = at(html, 'Balance remaining') >= 0 ? at(html, 'Balance remaining') : at(html, 'Paid so far');
  const flightAt = at(html, 'Outbound flight');
  const greetAt = at(html, 'Hi Gemma,');
  ok('payment came first because it was listed first', payAt > -1 && payAt < flightAt, `${payAt} / ${flightAt}`);
  ok('then the flights', flightAt > -1 && flightAt < greetAt, `${flightAt} / ${greetAt}`);
  ok('then the greeting, last because it was listed last', greetAt > -1);
  ok('and nothing that was left out appeared', at(html, 'Sunset dolphin cruise') === -1
    && at(html, 'Have a wonderful trip') === -1);
}

console.log('Each data block brings its own rows and nobody else\'s');
{
  const only = (t) => render([{ type: t }]).html;
  ok('Flights brings the flights', at(only('flights'), 'LHR 14:00 → MLE 06:10') > -1);
  ok('and not the hotel', at(only('flights'), 'Atmosphere Kanifushi') === -1);
  ok('Accommodation brings the property and the dates',
    at(only('stay'), 'Atmosphere Kanifushi') > -1 && at(only('stay'), '26 Sep') > -1);
  ok('Travellers brings the names', at(only('travellers'), 'Gemma') > -1);
  ok('Booking reference brings the reference', at(only('reference'), 'ET121109') > -1);
  ok('Transfers brings the transfer', at(only('transfers'), 'Male Airport') > -1);
  ok('Car hire brings the car', at(only('carhire'), 'VW Golf') > -1);
  ok('Tickets brings the excursion', at(only('tickets'), 'Sunset dolphin cruise') > -1);
  ok('Extras brings the lounge passes', at(only('extras'), 'Lounge pass') > -1);
  ok('Documents brings the ATOL certificate', at(only('documents'), 'ATOL certificate') > -1);
  ok('Cost and balance brings the money', /£4,?210\.50/.test(only('payment')));
  ok('the all-in-one summary still brings everything',
    ['ET121109', 'Gemma', 'Atmosphere Kanifushi', 'LHR 14:00', 'VW Golf', 'Lounge pass']
      .every(bit => at(only('summary'), bit) > -1));
}

console.log('A block with nothing to say says nothing');
{
  const bare = { ...OPTS, order: { ...ORDER, items: [ORDER.items[0]], documents: [] }, message: '' };
  const html = renderBookingEmail({ ...bare,
    layout: [{ type: 'flights' }, { type: 'carhire' }, { type: 'documents' }, { type: 'stay' }] }).html;
  ok('no flights on the booking means no empty Flights card', at(html, 'Flights') === -1);
  ok('no car hire means no empty card', at(html, 'Car hire') === -1);
  ok('no documents means no empty list', at(html, 'Documents') === -1 && at(html, 'ATOL') === -1);
  ok('the block that does have something still draws', at(html, 'Atmosphere Kanifushi') > -1);
}

console.log('The client writes their own words, and cannot write HTML');
{
  const html = render([
    { type: 'heading', text: 'Before you fly' },
    { type: 'text', text: 'Hello {firstName}\n\nYour reference is {bookingRef} and the balance of {balance} is due before you travel. Call us on {agencyPhone}.' },
    { type: 'divider' },
    { type: 'button', text: 'View my booking', url: 'https://exclusivelytravel.co.uk/my-booking' },
  ]).html;
  ok('the heading is there', at(html, 'Before you fly') > -1);
  ok('{firstName} is filled in', at(html, 'Hello Gemma') > -1 && at(html, '{firstName}') === -1);
  ok('{bookingRef} is filled in', at(html, 'Your reference is ET121109') > -1);
  ok('{balance} is filled in as money', /balance of £3,?210\.50 is due/.test(html));
  ok('{agencyPhone} is filled in', at(html, '01202 934033') > -1);
  ok('a blank line became a new paragraph', (html.match(/<p style="margin:0 0 12px/g) || []).length === 2);
  ok('the button is a link to the page', at(html, 'href="https://exclusivelytravel.co.uk/my-booking"') > -1);
  ok('the divider drew a rule', at(html, 'height:1px;background:#e2e8f0') > -1);

  const nasty = render([{ type: 'text', text: '<script>alert(1)</script> & "quotes" <b>bold</b>' }]).html;
  ok('a script tag is escaped, not run', at(nasty, '<script>') === -1 && at(nasty, '&lt;script&gt;') > -1);
  ok('so is everything else', at(nasty, '<b>bold</b>') === -1 && at(nasty, '&amp;') > -1);

  const tagTypo = render([{ type: 'text', text: 'Dear {frstName}' }]).html;
  ok('a mistyped tag shows rather than blanking the sentence', at(tagTypo, '{frstName}') > -1);
}

console.log('Links and images have to be safe');
{
  const bad = (url) => render([{ type: 'button', text: 'Go', url }]).html;
  ok('http is refused', at(bad('http://example.com'), '>Go<') === -1);
  ok('javascript: is refused', at(bad('javascript:alert(1)'), '>Go<') === -1);
  ok('our own network is refused', at(bad('https://192.168.0.1/admin'), '>Go<') === -1
    && at(bad('https://localhost/x'), '>Go<') === -1);
  ok('a real https address is allowed', at(bad('https://example.com/book'), '>Go<') > -1);
  ok('an image must be https too',
    at(render([{ type: 'image', url: 'http://cdn.example.com/b.jpg' }]).html, '<img src="http:') === -1);
  ok('and a https one is drawn full width',
    at(render([{ type: 'image', url: 'https://cdn.example.com/b.jpg' }]).html, 'width="600"') > -1);
  ok('an empty button is dropped rather than drawn dead',
    at(render([{ type: 'button', text: 'Go', url: '' }]).html, '>Go<') === -1);
}

console.log('The frame around the blocks is still ours');
{
  const html = render([{ type: 'text', text: 'Just this.' }]).html;
  ok('the branded header stays', at(html, 'https://cdn.example.com/et.png') > -1);
  ok('the ABTA footer line stays', at(html, 'ABTA P1234') > -1);
  ok('the preheader still describes the booking', at(html, 'Your booking ET121109 is confirmed') > -1);
  ok('the subject is still built from the booking, not the layout',
    render([{ type: 'divider' }]).subject === 'Your Male booking confirmation (ET121109)');
  ok('a layout cannot exceed forty blocks',
    normaliseLayout(Array.from({ length: 80 }, () => ({ type: 'divider' }))).length === 40);
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
