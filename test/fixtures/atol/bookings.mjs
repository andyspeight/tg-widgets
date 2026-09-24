/**
 * Bookings for the ATOL certificate tests, in the shape our order trimmers
 * really produce (flights at item.flights.routes[].segments[], people on each
 * product, dates as Travelify writes them: a calendar date wearing a time).
 * The flights are ET122149's (Luton to Rhodes and back, easyJet).
 */
const flightItem = (people, extra = {}) => ({
  id: 1, status: 'Confirmed', product: 'Flights', bookingReference: 'K8L2PQ', price: 812.46, currency: 'GBP',
  startDate: '2026-09-26T00:00:00',
  flights: {
    pricing: { currency: 'GBP', price: 812.46 },
    routes: [
      { direction: 'Outbound', duration: 255, segments: [{ origin: { iataCode: 'LTN', name: 'London Luton' }, destination: { iataCode: 'RHO', name: 'Rhodes' }, depart: '2026-09-26T12:55:00', arrive: '2026-09-26T19:10:00', marketingCarrier: { code: 'U2', name: 'easyJet' }, flightNo: '2231' }] },
      { direction: 'Inbound', duration: 270, segments: [{ origin: { iataCode: 'RHO', name: 'Rhodes' }, destination: { iataCode: 'LTN', name: 'London Luton' }, depart: '2026-10-05T20:05:00', arrive: '2026-10-05T22:35:00', marketingCarrier: { code: 'U2', name: 'easyJet' }, flightNo: 'U22232' }] },
    ],
    travellers: people,
  },
  ...extra,
});
export const PARTY = [
  { type: 'Adult', title: 'MRS', firstname: 'GEMMA', surname: 'WHITAKER' },
  { type: 'Adult', title: 'MR', firstname: 'DANIEL', surname: 'WHITAKER' },
  { type: 'Child', title: 'MISS', firstname: 'ISLA', surname: 'WHITAKER' },
  { type: 'Infant', title: 'MSTR', firstname: 'OSCAR', surname: 'WHITAKER' },
];
export const flightOnly = () => ({
  id: 122149, status: 'Confirmed', currency: 'GBP', created: '2026-06-02T10:15:00',
  items: [flightItem(PARTY)],
});
export const flightAndHotel = () => ({
  id: 121109, status: 'Confirmed', currency: 'GBP', created: '2026-06-02T10:15:00',
  items: [
    flightItem(PARTY),
    { id: 2, status: 'Confirmed', product: 'Accommodation', price: 1158, currency: 'GBP', startDate: '2026-09-26T00:00:00', duration: 6,
      accommodation: { name: 'Lambis Studios', location: { city: 'Lindos' }, units: [{ checkin: '2026-09-26T00:00:00', nights: 6 }],
        guests: [{ type: 'Lead', firstname: 'Gemma', surname: 'Whitaker' }, { type: 'Adult', firstname: 'Daniel', surname: 'Whitaker' }, { type: 'Child', firstname: 'Isla', surname: 'Whitaker' }, { type: 'Infant', firstname: 'Oscar', surname: 'Whitaker' }] } },
    { id: 3, status: 'Confirmed', product: 'CarRental', price: 143, currency: 'GBP', startDate: '2026-09-26T19:40:00',
      carRental: { name: 'Fiat Panda or similar', pickup: { name: 'Rhodes Airport', dateTime: '2026-09-26T19:40:00', iataCode: 'RHO' }, travellers: [{ type: 'Adult', title: 'Mr', firstname: 'Daniel', surname: 'Whitaker' }] } },
  ],
});
// A Jet2 Holidays package: the operator's ATOL, not the agency's.
export const operatorPackage = () => ({
  id: 120001, status: 'Confirmed', currency: 'GBP',
  items: [{ ...flightItem(PARTY), product: 'Packages', accommodation: { name: 'Hotel Sol', guests: PARTY }, package: { operator: { code: 'JET2', name: 'Jet2 Holidays' }, atolProtected: true, inclusions: ['ATOLProtection'] } }],
});
export const hotelOnly = () => ({
  id: 120002, status: 'Confirmed', currency: 'GBP',
  items: [flightAndHotel().items[1]],
});
