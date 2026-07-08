// Smoke: the Travelify "Extras" product (post-booking add-ons, e.g. ET90582's
// "Private Return Taxi") must surface in the booking PDF and confirmation
// email. Pure Node — renders the two exported templates against the trimmed
// order shape retrieve-order now produces (item.extras) and asserts the extra,
// its participants and its price all appear, plus HTML escaping holds.
//
// Run: node test/mybooking-extras-smoke.mjs
import { renderPdfHtml } from '../public/_pdf-template.js';
import { renderBookingEmail } from '../api/_lib/booking-email-template.js';

function extrasItem() {
  return {
    id: 99504, status: 'Confirmed', product: 'Extras', bookingReference: 'MANOLIS TAXI',
    price: 159, currency: 'GBP', startDate: '2026-09-05T00:00:00', duration: 14,
    extras: {
      groups: [{
        type: 'Transport', name: 'TRANSFERS', description: 'RETURN PRIVATE TAXI',
        extras: [{
          type: 'Transport', name: 'Private Return Taxi', description: 'Airport to Atmosphere Bar Return',
          qty: 1, payAtPickup: false,
          pricing: { currency: 'GBP', price: 159, refundability: 'NonRefundable' },
          participants: [{ type: 'Adult', title: 'Mr', firstname: 'Mark', surname: 'Woollard' }],
        }],
      }],
      travellers: [{ type: 'Adult', title: 'Mr', firstname: 'Mark', surname: 'Woollard' }],
    },
  };
}

function order(items) {
  return {
    id: 90582, status: 'Confirmed', customerTitle: 'Mr', customerFirstname: 'Mark',
    customerSurname: 'Woollard', customerEmail: 'markwoollardmw@gmail.com', currency: 'GBP',
    created: '2026-07-07T11:34:00Z', items,
    summary: {
      totalPrice: items.reduce((a, i) => a + (i.price || 0), 0),
      hasAccommodation: items.some(i => i.product === 'Accommodation'),
      hasFlights: items.some(i => i.product === 'Flights'),
      hasExtras: items.some(i => i.product === 'Extras'),
      hasAirportExtras: false, hasTransfers: false, hasCarRental: false,
      hasTicketsAttractions: false, hasPackages: false, extrasItems: 1,
      earliestStart: '2026-09-05T00:00:00',
      travellers: [{ type: 'Adult', title: 'Mr', firstname: 'Mark', surname: 'Woollard' }],
    },
    payments: [], documents: [],
  };
}

const hotel = {
  id: 1, status: 'Confirmed', product: 'Accommodation', bookingReference: 'HOTEL1', price: 2000,
  currency: 'GBP', startDate: '2026-09-05T00:00:00', duration: 14,
  accommodation: { name: 'Atmosphere Bar Hotel', rating: 4, location: { city: 'Rhodes', country: 'GR' }, units: [{ name: 'Double Room', nights: 14, sleepsAdults: 1 }], pricing: { currency: 'GBP', price: 2000 }, guests: [{ type: 'Adult', title: 'Mr', firstname: 'Mark', surname: 'Woollard' }], media: [], descriptions: [], amenities: [], goodFor: [] },
};
const flights = {
  id: 2, status: 'Confirmed', product: 'Flights', bookingReference: 'FLT1', price: 800,
  currency: 'GBP', startDate: '2026-09-05T00:00:00', duration: 14,
  flights: { routes: [], travellers: [{ type: 'Adult', title: 'Mr', firstname: 'Mark', surname: 'Woollard' }], fareInformation: [] },
};

let fails = 0;
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) fails++; };

const mixed = order([hotel, flights, extrasItem()]);
const pdf = renderPdfHtml(mixed, { brandName: 'Test Travel' });
check('PDF: extra name', pdf.includes('Private Return Taxi'));
check('PDF: extra description', pdf.includes('Airport to Atmosphere Bar Return'));
check('PDF: group context', pdf.includes('TRANSFERS'));
check('PDF: Extras section title', /pdf-section-title">Extras</.test(pdf));
check('PDF: participant', pdf.includes('Mark Woollard'));
check('PDF: breakdown Extras line + price', pdf.includes('— Extras') && /159/.test(pdf));

const email = renderBookingEmail({ order: mixed, orderRef: 'ET90582', brand: { name: 'Test Travel' } });
check('Email: html is a string', typeof email.html === 'string');
check('Email: extra name (html)', email.html.includes('Private Return Taxi'));
check('Email: extra description (html)', email.html.includes('Airport to Atmosphere Bar Return'));
check('Email: group label (html)', email.html.includes('TRANSFERS'));

// Edge: empty groups must not throw
try {
  const empty = order([{ id: 3, status: 'Confirmed', product: 'Extras', price: 0, currency: 'GBP', extras: { groups: [], travellers: [] } }]);
  renderPdfHtml(empty);
  renderBookingEmail({ order: empty, orderRef: 'X', brand: { name: 'T' } });
  check('Edge: empty extras groups render without throwing', true);
} catch (e) { check('Edge: empty extras groups render without throwing — ' + e.message, false); }

// Security: a hostile extra name must be escaped, never injected.
const evil = order([hotel, flights, extrasItem()]);
evil.items[2].extras.groups[0].extras[0].name = '<img src=x onerror=alert(1)>';
const evilPdf = renderPdfHtml(evil);
const evilEmail = renderBookingEmail({ order: evil, orderRef: 'X', brand: { name: 'T' } }).html;
check('XSS: PDF escapes extra name', !evilPdf.includes('<img src=x onerror=alert(1)>') && evilPdf.includes('&lt;img'));
check('XSS: Email escapes extra name', !evilEmail.includes('<img src=x onerror=alert(1)>') && evilEmail.includes('&lt;img'));

console.log(`\n${fails === 0 ? 'ALL PASS' : fails + ' FAILED'}`);
process.exit(fails ? 1 : 0);
