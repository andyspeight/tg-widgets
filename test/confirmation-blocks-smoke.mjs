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
  renderBookingEmail, EMAIL_BLOCKS, EMAIL_STYLES, DEFAULT_EMAIL_LAYOUT, normaliseLayout,
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
        guests: [{ type: 'Lead', title: 'Mrs', firstname: 'Gemma', surname: 'Whitaker' }],
        media: [{ type: 'GenericImage', url: 'https://static.travelify.io/hotels/kanifushi-1.jpg', caption: 'Beach villa' }] } },
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

// The destination pack, exactly the shape /api/destination-content returns.
// The renderer cannot look anything up, so the caller passes this in; every
// block that reads it draws nothing when it is absent, which is the pair of
// assertions below.
const DESTINATION = {
  level: 'country',
  name: 'The Maldives',
  tagline: 'A thousand islands scattered across the Indian Ocean.',
  heroIntro: 'Barely two hundred of the twelve hundred coral islands are lived on at all.\n\nA second paragraph the email must not print.',
  images: ['https://static.travelify.io/dest/maldives-1.jpg'],
  climate: { temps: [28, 28, 29, 30, 30, 29, 29, 29, 29, 29, 29, 28], rainfall: [], season: [] },
  facts: { flightTime: '10h 45m direct', timeZone: 'GMT+5', currency: 'Rufiyaa (MVR)', language: 'Dhivehi', voltage: '230V, type D and G' },
  highlights: [
    { icon: 'fish', title: 'Snorkel the house reef', description: 'The drop-off is where the turtles are.' },
    { icon: 'boat', title: 'Take a dhoni at dawn', description: 'The fishing boats go out before six.' },
    { icon: 'moon', title: 'Look for bioluminescence', description: 'The plankton light the shoreline blue.' },
  ],
  events: [
    { month: 'September', name: 'Whale shark season, South Ari Atoll', description: 'The clearest water of the year.' },
    { month: 'March', name: 'Ramadan begins', description: 'Observed nationally.' },
  ],
};

const OPTS = {
  order: ORDER, destination: DESTINATION, message: 'Booked for you by Jess. Any questions, just shout.',
  brand: { name: 'Exclusively Travel', logoUrl: 'https://cdn.example.com/et.png', footerLine: 'ABTA P1234' },
  colors: { primary: '#1B2B5B', accent: '#00B4D8' },
  supportEmail: 'hello@exclusivelytravel.co.uk', supportPhone: '01202 934033',
  orderRef: 'ET121109', baseUrl: 'https://exclusivelytravel.co.uk/my-booking',
  // The "Add to your trip" tiles, as /api/retrieve-order hands them to the real
  // email (24 Sep 2026). Only the upsell block reads them, and the built-in
  // layout does not carry that block, so the email we have always sent is
  // unchanged by their being here.
  upsell: [{ product: 'TicketsAttractions', label: 'Things to do', hint: 'Tours, attractions and days out while you are there.',
    url: 'https://dl.tvllnk.com/deeplink/474?st=TicketsAttractions&loc=Lindos&ctry=GR&fr=2026-09-26&to=2026-10-02&adt=2&orderRef=121109/0CB5D0BC-51FE-4950-9201-E9AD792489F5' }],
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
  // Andy, 24 Sep 2026: "Add to your trip" goes in everyone's email by default,
  // after the booking and before the contact details, as it is on the page.
  // Andy, 24 Sep 2026, twice: every passenger listed after the summary, and
  // "Add to your trip" before the contact details.
  ok('and the built-in order is the one we ship',
    DEFAULT_EMAIL_LAYOUT.map(b => b.type).join(',')
      === 'greeting,message,summary,travellers,documents,payment,pdfnote,upsell,support,signoff');

  // A booking with nothing to offer: the upsell block draws nothing at all, so
  // the email is exactly the same email without that block in it.
  const plain = (layout) => renderBookingEmail({ ...OPTS, upsell: [], layout });
  const withoutUpsell = DEFAULT_EMAIL_LAYOUT.filter(b => b.type !== 'upsell');
  ok('with nothing to offer, the upsell block leaves no trace',
    norm(plain(undefined).html) === norm(plain(withoutUpsell).html)
      && plain(undefined).text === plain(withoutUpsell).text);
  ok('and with something to offer, it says so',
    render(undefined).html.includes('Add to your trip') && !plain(undefined).html.includes('Add to your trip'));
}

console.log("Who's travelling: everyone on the booking, with ages");
{
  // Andy, 24 Sep 2026: "the email should have a section for passengers, and
  // list them all, including ages". The ages are the ones retrieve-order has
  // already worked out; the email prints them.
  const family = { ...ORDER, summary: { ...ORDER.summary, travellers: [
    { type: 'Lead', title: 'Mr', firstname: 'Luke', surname: 'Livsey' },
    { type: 'Adult', title: 'Mrs', firstname: 'Hannah', surname: 'Livsey', age: 41 },
    { type: 'Child', title: 'Miss', firstname: 'Ella', surname: 'Livsey', age: 9 },
    { type: 'Child', firstname: 'Sam', surname: 'Livsey' },
    { type: 'Infant', firstname: 'Tom', surname: 'Livsey', age: 1 },
    { type: 'Infant', firstname: 'Rosie', surname: 'Livsey', age: 0 },
  ] } };
  const out = renderBookingEmail({ ...OPTS, order: family });
  const h = out.html;
  ok('the section is in the email a client sends by default', h.includes("Who&#39;s travelling") || h.includes("Who's travelling"));
  ok('every one of them is listed by name',
    ['Mr Luke Livsey', 'Mrs Hannah Livsey', 'Miss Ella Livsey', 'Sam Livsey', 'Tom Livsey', 'Rosie Livsey'].every(n => h.includes(n)));
  ok('the lead guest is named as the lead, as on the booking page', h.includes('Lead guest'));
  ok('a child shows their age', h.includes('Child, aged 9'));
  ok('a child with no age on the booking is still listed, as a child', /Child\s*<\/td>/.test(h));
  ok('an infant shows their age', h.includes('Infant, aged 1'));
  ok('a baby under one says so rather than "aged 0"', h.includes('Infant, under 1') && !h.includes('aged 0'));
  ok('a grown-up\'s age is not printed', !h.includes('aged 41') && !h.includes('41'));
  ok('the summary does not also say "+5 others" above the full list', !h.includes('+5 others'));
  ok('the plain-text version lists everyone too',
    out.text.includes("Who's travelling") && out.text.includes('Miss Ella Livsey (Child, aged 9)')
      && out.text.includes('Rosie Livsey (Infant, under 1)'));
  // A client's own layout without the section keeps the summary's short line.
  const own = renderBookingEmail({ ...OPTS, order: family, layout: [{ type: 'greeting' }, { type: 'summary' }] }).html;
  ok('a layout without the section still says who is going in the summary', own.includes('+5 others'));
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

// ---------------------------------------------------------------------------
// The picture-led and destination blocks, and the four starter styles
// (17 Sep 2026). Andy, having seen the mockups: "i liked them all please".
// ---------------------------------------------------------------------------

console.log('The picture blocks draw from the booking');
{
  const hero = render([{ type: 'hero' }]).html;
  ok('the hero used the hotel photo when given none of its own',
    at(hero, 'https://static.travelify.io/hotels/kanifushi-1.jpg') > -1);
  ok('the hero names the destination we hold, not the airport city',
    at(hero, 'The Maldives') > -1 && at(hero, '>Male<') === -1);
  ok('the hero carries the dates and the nights',
    at(hero, '26 Sept 2026 to 2 Oct 2026') > -1 && at(hero, '6 nights') > -1);
  ok('the client can give the hero its own picture',
    at(render([{ type: 'hero', url: 'https://static.travelify.io/own.jpg' }]).html,
      'https://static.travelify.io/own.jpg') > -1);
  ok('and only an https one',
    at(render([{ type: 'hero', url: 'http://insecure.example.com/x.jpg' }]).html,
      'insecure.example.com') === -1);

  const card = render([{ type: 'hotelcard' }]).html;
  ok('the hotel card names the property', at(card, 'Atmosphere Kanifushi') > -1);
  ok('it shows the room and the board through the shared labels',
    at(card, 'Beach Villa') > -1 && at(card, 'All inclusive') > -1);
  ok('it shows five stars for a five star property', (card.match(/&#9733;/g) || []).length === 5);
  ok('it shows the dates', at(card, '26 Sept 2026 to 2 Oct 2026') > -1);
  ok('the separator is a separator, not the word &middot;', at(card, '&amp;middot;') === -1);
}

console.log('The itinerary runs in the order the trip happens');
{
  const html = render([{ type: 'itinerary' }]).html;
  const order = ['Flight out', 'Check in', 'Transfer', 'Sunset dolphin cruise', 'Transfer back', 'Flight home']
    .map(t => at(html, t));
  ok('every leg is on it', order.every(i => i > -1), order.join(','));
  ok('and they are in trip order', order.every((v, i) => i === 0 || v > order[i - 1]), order.join(','));
  // The bug this catches: a check-in is a calendar date with no clock on it,
  // so at midnight it sorted ABOVE the flight that gets you there that day.
  ok('a dated leg with no clock sits after the timed legs of its own day',
    at(html, 'Check in') > at(html, 'Flight out'));
  ok('it prints the times the traveller reads at the gate', at(html, '14:00') > -1);
  ok('nothing is double escaped', at(html, '&amp;middot;') === -1 && at(html, '&amp;rarr;') === -1);
}

console.log('The destination blocks read the pack the caller passed in');
{
  const d = render([{ type: 'destination' }]).html;
  ok('the tagline is there', at(d, 'A thousand islands scattered') > -1);
  ok('the opening paragraph is there', at(d, 'Barely two hundred') > -1);
  ok('but only the opening, not the whole write-up', at(d, 'must not print') === -1);

  const k = render([{ type: 'knowbefore' }]).html;
  ok('the facts strip carries the currency and the plugs',
    at(k, 'Rufiyaa (MVR)') > -1 && at(k, '230V, type D and G') > -1);
  ok('it gives the average high for the month they actually travel',
    at(k, '29°C') > -1 && at(k, 'Average high in September') > -1);

  const w = render([{ type: 'whatson' }]).html;
  ok('what is on picks the event in the travel month', at(w, 'Whale shark season') > -1);
  ok('and leaves the other months alone', at(w, 'Ramadan') === -1);

  const t = render([{ type: 'thingstodo' }]).html;
  ok('three things to do lists three', (t.match(/font:700 16px/g) || []).length === 3);
  ok('with their descriptions', at(t, 'where the turtles are') > -1);
}

console.log('A block with nothing to say says nothing');
{
  // This is the rule the four styles rest on: a client picks Magazine for a
  // destination we hold no content for, or a hotel with no photograph, and
  // gets a shorter email rather than a row of empty boxes.
  const bare = JSON.parse(JSON.stringify(ORDER));
  bare.items[0].accommodation.media = [];
  const nothing = (type) => renderBookingEmail({
    ...OPTS, order: bare, destination: null, layout: [{ type }],
  }).html;
  const baseline = norm(renderBookingEmail({ ...OPTS, order: bare, destination: null, layout: [{ type: 'divider' }] }).html).length;
  for (const type of ['hero', 'destination', 'knowbefore', 'whatson', 'thingstodo']) {
    ok('no material, nothing drawn: ' + type, norm(nothing(type)).length < baseline);
  }
  ok('the hotel card still draws without a photograph, because it has a hotel',
    at(nothing('hotelcard'), 'Atmosphere Kanifushi') > -1);
  ok('an event in a month they are not travelling is not "what is on"',
    at(renderBookingEmail({ ...OPTS, destination: { ...DESTINATION, events: [{ month: 'March', name: 'Ramadan begins' }] },
      layout: [{ type: 'whatson' }] }).html, 'Ramadan') === -1);
  ok('a climate series that is not twelve months is ignored rather than guessed',
    at(renderBookingEmail({ ...OPTS, destination: { ...DESTINATION, climate: { temps: [28, 29] } },
      layout: [{ type: 'knowbefore' }] }).html, 'Average high') === -1);
  ok('a destination pack that is not an object is simply absent',
    norm(renderBookingEmail({ ...OPTS, destination: 'the maldives', layout: [{ type: 'destination' }] }).html).length < baseline);
}

console.log('The four starter styles are real layouts');
{
  const types = EMAIL_BLOCKS.map(b => b.type);
  ok('there are four', EMAIL_STYLES.length === 4);
  ok('each has an id, a label and a hint',
    EMAIL_STYLES.every(s => s.id && s.label && s.hint));
  ok('every block in every style is one the renderer can draw',
    EMAIL_STYLES.every(s => s.layout.every(b => types.includes(b.type))));
  ok('Standard is our built-in layout, so the picker and the fallback agree',
    JSON.stringify(EMAIL_STYLES.find(s => s.id === 'standard').layout)
      === JSON.stringify(DEFAULT_EMAIL_LAYOUT));
  // Whatever a client starts from, a confirmation still has to tell them the
  // pack is attached, how to reach a human, and who it is from.
  for (const s of EMAIL_STYLES) {
    const have = s.layout.map(b => b.type);
    ok(s.id + ' keeps the pack note, the contact details and the sign off',
      ['pdfnote', 'support', 'signoff'].every(t => have.includes(t)));
    ok(s.id + ' offers "Add to your trip", just before the contact details',
      have.indexOf('upsell') !== -1 && have.indexOf('upsell') === have.indexOf('support') - 1);
    const html = render(s.layout).html;
    ok(s.id + ' renders, branded, with the booking on it',
      at(html, 'ET121109') > -1 && at(html, 'ABTA P1234') > -1);
    ok(s.id + ' has no unresolved template left in it',
      at(html, 'undefined') === -1 && at(html, 'NaN') === -1 && at(html, '[object Object]') === -1);
  }
  ok('Postcard opens on the picture, before the greeting',
    (() => { const h = render(EMAIL_STYLES.find(s => s.id === 'postcard').layout).html;
      return at(h, 'You are going to') > -1 && at(h, 'You are going to') < at(h, 'Hi Gemma'); })());
  ok('Magazine carries the destination half',
    (() => { const have = EMAIL_STYLES.find(s => s.id === 'magazine').layout.map(b => b.type);
      return ['hero', 'hotelcard', 'destination', 'thingstodo', 'whatson', 'knowbefore'].every(t => have.includes(t)); })());
  ok('Itinerary is built on the timeline',
    EMAIL_STYLES.find(s => s.id === 'itinerary').layout.some(b => b.type === 'itinerary'));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
