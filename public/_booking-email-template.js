// =============================================================================
//  /public/_booking-email-template.js — shared server + editor module
//
//  Lives in public/ so it is BOTH the server renderer (imported by
//  api/booking-email.js through the api/_lib shim) and the My Booking editor's
//  email preview. ONE implementation, so the preview cannot drift from the
//  email we send — which is exactly what went wrong before: a separate
//  preview-only template had diverged in subject, structure and length.
//  Keep it dependency-free and runtime-neutral: no Node imports, no DOM.
// =============================================================================
//
//  Renders the HTML body of the booking confirmation email.
//
//  Type system — kept deliberately tight:
//
//   - One font family throughout. The system stack hits the native UI font
//     on every platform: SF Pro on Apple, Segoe UI on Windows, Roboto on
//     Android. We don't try to load Inter — webfonts in HTML email are
//     unreliable across clients (Outlook, Apple Mail, Gmail all behave
//     differently) so the fallback chain becomes the actual font for most
//     users anyway. Going system-stack-only means the email looks consistent
//     instead of "Inter for some recipients, Helvetica for others".
//
//   - Four type roles, no mixing:
//       Display   22px / 700 — greeting, header brand
//       Body      15px / 400 (or 600 emphasis)
//       Caption   12px / 500 — section labels, uppercase
//       Headline  18px / 700 — total cost only
//
//   - Two text colours: #0f172a primary, #64748b muted. No mid-grey accents.
//
//   - Brand colour bands at the header and inside the payment card. Every
//     label/value uses the same two colours regardless of section.
//
//  600px max width — the email-client standard. Inline styles only —
//  <style> blocks get stripped by Gmail.
//
//  The email contains enough detail for a customer who can't open the PDF
//  to still know what's been booked. The PDF is the canonical source of
//  truth; the email is the friendly summary.
// =============================================================================


// One font stack used everywhere. -apple-system maps to SF Pro on macOS/iOS,
// BlinkMacSystemFont keeps Chrome on Mac happy, Segoe UI is Windows, Roboto
// is Android. Each is a clean professional UI font on its native platform.
import { moneyOf, paymentStatusMessage, voucherLabel, MONEY_STRINGS } from './_order-money.js';
import { listStays, bookingMoment, stayCheckout } from './_order-stays.js';

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";


// =============================================================================
//  The block vocabulary
//
//  Andy, 16 Sep 2026: "I want the email set up / editor to be very flexible so
//  that the user can create their own email layout, and just add the data
//  blocks with the booking information."
//
//  So the email is no longer one fixed page. It is an ORDERED LIST OF BLOCKS.
//  A client arranges them, writes their own words between them, and every
//  block that carries booking information fills itself from the order.
//
//  This list is the single source of truth for what a block IS: the editor
//  builds its palette from this export, and the renderer below draws from the
//  same array, so a block can never exist in one and not the other.
//
//  kind: 'data'  — fills itself from the booking, nothing to write
//        'write' — the client supplies the content
//  fields        — what a 'write' block stores on itself
// =============================================================================
export const EMAIL_BLOCKS = [
  { type: 'greeting',   kind: 'data',  label: 'Greeting',              hint: 'The confirmed badge, "Hi Sarah," and one line of welcome.' },
  { type: 'summary',    kind: 'data',  label: 'Booking summary',       hint: 'Everything we know, in one card: reference, travellers, stay, flights and the rest.' },
  { type: 'reference',  kind: 'data',  label: 'Booking reference',     hint: 'The reference on its own, with ATOL protection where it applies.' },
  { type: 'travellers', kind: 'data',  label: 'Travellers',            hint: 'Who is going.' },
  { type: 'stay',       kind: 'data',  label: 'Accommodation',         hint: 'Destination, property and dates. Every property on a multi-centre trip.' },
  { type: 'flights',    kind: 'data',  label: 'Flights',               hint: 'Outbound and return.' },
  { type: 'transfers',  kind: 'data',  label: 'Transfers',             hint: 'Pick-up, drop-off and times.' },
  { type: 'carhire',    kind: 'data',  label: 'Car hire',              hint: 'Vehicle, pick-up and drop-off.' },
  { type: 'tickets',    kind: 'data',  label: 'Tickets and attractions', hint: 'What is booked, when and where.' },
  { type: 'extras',     kind: 'data',  label: 'Extras',                hint: 'Anything added after the booking was made.' },
  { type: 'payment',    kind: 'data',  label: 'Cost and balance',      hint: 'Total, what is paid, what is left and when it is due.' },
  { type: 'documents',  kind: 'data',  label: 'Documents',             hint: 'Links to every supplier document on the booking.' },
  { type: 'pdfnote',    kind: 'data',  label: 'Booking pack note',     hint: 'The note telling the customer the A4 pack is attached.' },
  { type: 'support',    kind: 'data',  label: 'Contact details',       hint: 'Your phone number and reply-to line.' },
  { type: 'signoff',    kind: 'data',  label: 'Sign off',              hint: '"Have a wonderful trip" and your company name.' },
  { type: 'message',    kind: 'data',  label: 'Customer note',         hint: 'The note a customer types when they email the booking to someone. Empty on a confirmation we send.' },
  { type: 'text',       kind: 'write', label: 'Your own words',        fields: ['text'], hint: 'A paragraph or several. Merge tags are filled in.' },
  { type: 'heading',    kind: 'write', label: 'Heading',               fields: ['text'] },
  { type: 'button',     kind: 'write', label: 'Button',                fields: ['text', 'url'], hint: 'A link the customer can tap, such as your booking page.' },
  { type: 'image',      kind: 'write', label: 'Image',                 fields: ['url'], hint: 'A banner across the width of the email. Must be an https address.' },
  { type: 'divider',    kind: 'write', label: 'Divider',               fields: [] },
];

/**
 * The built-in layout: what every confirmation email has looked like since the
 * widget shipped. A client who never opens the layout builder gets exactly
 * this, byte for byte, which is what `test:confirmation-blocks` holds us to.
 */
export const DEFAULT_EMAIL_LAYOUT = [
  { type: 'greeting' },
  { type: 'message' },
  { type: 'summary' },
  { type: 'documents' },
  { type: 'payment' },
  { type: 'pdfnote' },
  { type: 'support' },
  { type: 'signoff' },
];

const BLOCK_TYPES = new Set(EMAIL_BLOCKS.map(b => b.type));

/**
 * Read whatever the editor saved and hand back a layout we can render.
 * A saved layout that is empty, not an array or made entirely of blocks we no
 * longer have falls back to the built-in one — an email with no body is worse
 * than an email in the old shape.
 */
export function normaliseLayout(layout) {
  if (!Array.isArray(layout)) return DEFAULT_EMAIL_LAYOUT;
  const clean = layout
    .filter(b => b && typeof b === 'object' && BLOCK_TYPES.has(b.type))
    .slice(0, 40);
  return clean.length ? clean : DEFAULT_EMAIL_LAYOUT;
}

// Merge tags, same rules as the reminder and cancellation emails: case
// insensitive, and an unknown tag is left alone so a typo shows up rather than
// silently blanking a sentence.
function applyMergeTags(text, vars) {
  return String(text == null ? '' : text).replace(/\{\s*([a-zA-Z]+)\s*\}/g, (m, key) => {
    const k = key.toLowerCase();
    return Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k] == null ? '' : vars[k]) : m;
  });
}

// Client prose to safe HTML. A blank line starts a paragraph, a single newline
// is a line break, and everything is escaped: no client HTML reaches the email.
function proseToHtml(text, colour) {
  return String(text || '').replace(/\r\n/g, '\n').split(/\n{2,}/)
    .map(b => b.trim()).filter(Boolean)
    .map(b => `<p style="margin:0 0 12px 0;font:400 15px/1.6 ${FONT};color:${colour};">${escapeHtml(b).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

// Only https, and never a private or loopback host. Same rule the documents
// list already applies to supplier URLs.
function safeHttpsUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  let u;
  try { u = new URL(value.trim()); } catch { return ''; }
  if (u.protocol !== 'https:') return '';
  const h = u.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h === '127.0.0.1' || h === '::1') return '';
  if (/^(10|127)\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) return '';
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return '';
  return u.toString();
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Read as the wall clock wrote it, printed in UTC, so an email says the
// supplier's own date wherever it is rendered (see bookingMoment).
function formatShortDate(iso) {
  const d = bookingMoment(iso);
  if (!d) return '';
  try {
    return d.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    });
  } catch {
    return iso;
  }
}

/**
 * Times come back from Travelify in local airport time without a zone — read
 * UTC components so we don't apply a second shift via the local Node server.
 */
function formatTime(iso) {
  const d = bookingMoment(iso);
  if (!d) return '';
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function formatMoney(amount, currency) {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return '';
  const cur = currency || 'GBP';
  try {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: cur,
      minimumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `£${amount.toFixed(2)}`;
  }
}

/**
 * Mirror of widget-mybooking.js resolveTotalLabel. Kept in sync so the
 * email Total line reads the same as the widget the customer just used.
 *
 * Tiered logic (in order of precedence):
 *   1. Accommodation present  → "Total holiday cost"
 *   2. Flights only / mixed   → "Total flight cost"
 *   3. Single product type    → product-specific label
 *   4. Mixed / unknown        → "Total cost"
 */
function resolveTotalLabel(items) {
  if (!Array.isArray(items) || items.length === 0) return 'Total cost';
  const products = new Set(items.map(i => i?.product).filter(Boolean));
  // Packages bundle hotel + flights and read as a holiday from the
  // customer's POV — same tier as Accommodation.
  if (products.has('Accommodation') || products.has('Packages')) return 'Total holiday cost';
  if (products.has('Flights')) return 'Total flight cost';
  if (products.size === 1) {
    const only = products.values().next().value;
    const map = {
      AirportExtras:       'Total cost',
      TicketsAttractions:  'Total ticket cost',
      Tickets:             'Total ticket cost',
      Ticket:              'Total ticket cost',
      CarRental:           'Total car hire cost',
      CarHire:             'Total car hire cost',
      Transfers:           'Total transfer cost',
      Transfer:            'Total transfer cost',
      Extras:              'Total cost',
      Insurance:           'Total insurance cost',
    };
    return map[only] || 'Total cost';
  }
  return 'Total cost';
}

// One place counts days forward from a booking date, and it is the shared one.
function addDays(iso, days) {
  if (!iso || typeof days !== 'number') return '';
  return stayCheckout(iso, days) || '';
}

/**
 * Build a list of human-readable traveller name strings.
 * Returns ["Mr Andy Speight", "Mrs Lisa Speight"] etc.
 */
function buildTravellerList(order) {
  const accItem = order.items?.find(i => i.product === 'Accommodation' || i.product === 'Packages');
  const candidates = order.summary?.travellers?.length
    ? order.summary.travellers
    : (accItem?.accommodation?.guests || []);

  const names = candidates
    .map(g => {
      const parts = [g.title, g.firstname, g.surname]
        .map(s => (s || '').trim())
        .filter(Boolean);
      return parts.join(' ');
    })
    .filter(Boolean);

  if (names.length > 0) return names;

  const fallback = [order.customerTitle, order.customerFirstname, order.customerSurname]
    .map(s => (s || '').trim())
    .filter(Boolean)
    .join(' ');
  return fallback ? [fallback] : [];
}

/**
 * Single-line flight summary: "LGW 06:30 → FAO 10:00 (Direct)".
 */
function buildFlightLine(route) {
  const segs = route?.segments || [];
  if (segs.length === 0) return '';
  const first = segs[0];
  const last = segs[segs.length - 1];
  const stops = segs.length - 1;

  const fromIata = first.origin?.iataCode || '';
  const toIata = last.destination?.iataCode || '';
  const depTime = formatTime(first.depart);
  const arrTime = formatTime(last.arrive);
  const stopsLabel = stops === 0
    ? 'Direct'
    : `${stops} ${stops === 1 ? 'stop' : 'stops'}`;

  if (!fromIata || !toIata) return '';
  return `${fromIata} ${depTime} → ${toIata} ${arrTime} (${stopsLabel})`;
}

function buildPaymentInfo(order) {
  // From the ONE shared calculation (public/_order-money.js). The order
  // reaches this renderer from /api/retrieve-order with `money` attached,
  // computed from the raw Travelify order, so the email shows the same
  // figures as the page and the PDF. Vouchers arrive already masked.
  const money = moneyOf(order);
  if (money.status === 'none' && !(money.total > 0)) return null;
  const firstDated = money.schedule.find((e) => e.dueDate) || null;
  return {
    money,
    total: money.total,
    vouchers: money.vouchers,
    currency: money.currency,
    depositPaid: money.paid > 0 ? money.paid : null,   // rendered as "Paid so far"
    balanceDue: money.balance,                          // rendered as "Balance remaining"
    balanceDueDate: money.balance > 0 && firstDated ? firstDated.dueDate : null,
    payable: money.payable,
    paidInFull: money.settled && money.applied,
    statusLine: paymentStatusMessage(money, formatMoney),
  };
}

/**
 * Render the booking confirmation email.
 *
 * @param {object} opts
 * @param {object} opts.order           - Trimmed order (from booking-email)
 * @param {string} [opts.message]       - Optional free-text from sender
 * @param {object} opts.brand
 * @param {string} opts.brand.name      - Agency display name
 * @param {string} [opts.brand.logoUrl] - Public URL of agency logo
 * @param {string} [opts.brand.footerLine]
 * @param {object} [opts.colors]
 * @param {string} [opts.colors.primary]
 * @param {string} [opts.colors.accent]
 * @param {string} [opts.supportEmail]
 * @param {string} [opts.supportPhone]
 * @param {string} [opts.orderRef]      - Customer-typed booking ref used as final fallback
 * @param {string} [opts.baseUrl]       - Origin for building /api/doc-redirect links (e.g. "https://tg-widgets.vercel.app")
 *
 * @returns {{subject: string, html: string, text: string}}
 */
export function renderBookingEmail(opts) {
  const {
    order,
    message,
    brand,
    colors = {},
    supportEmail,
    supportPhone,
    orderRef,
    baseUrl,
    layout,
  } = opts;

  const primary = colors.primary || '#1B2B5B';
  const accent = colors.accent || '#00B4D8';
  const brandName = brand?.name || 'Travel Team';
  const logoUrl = brand?.logoUrl;
  const footerLine = brand?.footerLine;

  // EVERY stay. A trip that moves between properties used to lose all but the
  // first here, the same one-word fault as the PDF and the widget carried
  // (ET121109, 15 Sep 2026). Selection is shared: ./_order-stays.js.
  const stays = listStays(order);
  const accItem = stays[0]?.item || order?.items?.find(i => i.product === 'Accommodation' || i.product === 'Packages');
  const flightItem = order?.items?.find(i => i.product === 'Flights' || i.product === 'Packages');
  const extraItem = order?.items?.find(i => i.product === 'AirportExtras');
  const transferItem = order?.items?.find(i => i.product === 'Transfers');
  const carRentalItem = order?.items?.find(i => i.product === 'CarRental');
  const ticketsItem = order?.items?.find(i => i.product === 'TicketsAttractions');
  // ATOL operator metadata for Package bookings (Jet2 Holidays, EveryHoliday,
  // TUI etc). Required disclosure: the operator's name must be visible on
  // the customer-facing confirmation.
  const packageItem = order?.items?.find(i => i.product === 'Packages');
  const packageInfo = packageItem?.package || null;
  const acc = accItem?.accommodation;

  const customerFirstName = (order?.customerFirstname || '').trim();
  const greeting = customerFirstName
    ? `Hi ${escapeHtml(customerFirstName)},`
    : 'Hi,';

  // Booking reference policy (must match the widget and PDF):
  //   1. Real supplier bookingReference on Accommodation/Flights/AirportExtras
  //   2. Customer-typed orderRef (uppercase) — what they used to find the booking
  //   3. Nothing — never fabricate "TG{numeric-id}". The internal order.id is
  //      not a customer-facing reference and showing it confuses customers
  //      and damages trust ("That's not my booking reference").
  const bookingReference = accItem?.bookingReference
    || flightItem?.bookingReference
    || extraItem?.bookingReference
    || transferItem?.bookingReference
    || carRentalItem?.bookingReference
    || ticketsItem?.bookingReference
    || packageItem?.bookingReference
    || (orderRef ? String(orderRef).toUpperCase() : '');

  // Destination city for subject line and preheader. Falls back through
  // product types so non-hotel bookings still get a meaningful destination:
  //   1. Hotel city
  //   2. Tickets location city (e.g. 'Dubai')
  //   3. Transfer dropoff city (last word of the location name)
  //   4. Car rental city (typically from pickup location's address)
  const destinationCity = acc?.location?.city
    || ticketsItem?.ticketsAttractions?.location?.city
    || (transferItem?.transfers?.outDropoff?.name || '').split(',')[0].trim()
    || (carRentalItem?.carRental?.pickup?.address1 || carRentalItem?.carRental?.pickup?.name || '').split(',')[0].trim()
    || '';
  const destinationCountry = acc?.location?.country
    || ticketsItem?.ticketsAttractions?.location?.country
    || '';
  const hotelName = acc?.name || '';

  const checkin = accItem?.startDate || order?.summary?.earliestStart || '';
  const nights = accItem?.duration || 0;
  const checkout = (checkin && nights) ? addDays(checkin, nights) : '';

  const travellers = buildTravellerList(order || {});
  const payment = buildPaymentInfo(order || {});

  const subjectParts = [];
  if (destinationCity) subjectParts.push(destinationCity);
  subjectParts.push('booking confirmation');
  if (bookingReference) subjectParts.push(`(${bookingReference})`);
  const subject = `Your ${subjectParts.join(' ')}`;

  // Build summary rows. Each only renders if data is present.
  const summaryRows = [];

  if (bookingReference) {
    summaryRows.push({ group: 'reference', label: 'Booking reference', value: bookingReference });
  }

  // ATOL operator disclosure — required on any ATOL-protected package sale.
  // Shows next to the booking reference so it's prominent. Format:
  //   ATOL protected · Operated by EveryHoliday
  if (packageInfo && (packageInfo.atolProtected || packageInfo.operator?.name)) {
    const parts = [];
    if (packageInfo.atolProtected) parts.push('ATOL Protected');
    if (packageInfo.operator?.name) parts.push(`Operated by ${packageInfo.operator.name}`);
    if (parts.length) summaryRows.push({ group: 'reference', label: 'Holiday protection', value: parts.join(' · ') });
  }

  if (travellers.length > 0) {
    const value = travellers.length === 1
      ? travellers[0]
      : `${travellers[0]} +${travellers.length - 1} other${travellers.length - 1 === 1 ? '' : 's'}`;
    summaryRows.push({ group: 'travellers', label: travellers.length === 1 ? 'Lead guest' : 'Travellers', value });
  }

  if (destinationCity) {
    const dest = destinationCountry ? `${destinationCity}, ${destinationCountry}` : destinationCity;
    summaryRows.push({ group: 'stay', label: 'Destination', value: dest });
  }

  // One Accommodation / Your stay pair per property, numbered when there is
  // more than one so the reader can see the trip move.
  if (stays.length > 1) {
    stays.forEach((st, i) => {
      const label = `Stay ${i + 1} of ${stays.length}`;
      if (st.name) summaryRows.push({ group: 'stay', label, value: st.name });
      if (st.checkin) {
        const inShort = formatShortDate(st.checkin);
        const outShort = st.checkout ? formatShortDate(st.checkout) : '';
        const nLabel = st.nights > 0 ? ` · ${st.nights} ${st.nights === 1 ? 'night' : 'nights'}` : '';
        summaryRows.push({
          group: 'stay',
          label: 'Dates',
          value: outShort ? `${inShort} → ${outShort}${nLabel}` : `${inShort}${nLabel}`,
        });
      }
    });
  } else {
    if (hotelName) {
      summaryRows.push({ group: 'stay', label: 'Accommodation', value: hotelName });
    }

    if (checkin) {
      const checkinShort = formatShortDate(checkin);
      const checkoutShort = checkout ? formatShortDate(checkout) : '';
      const nightsLabel = nights > 0 ? ` · ${nights} ${nights === 1 ? 'night' : 'nights'}` : '';
      const value = checkoutShort
        ? `${checkinShort} → ${checkoutShort}${nightsLabel}`
        : `${checkinShort}${nightsLabel}`;
      summaryRows.push({ group: 'stay', label: 'Your stay', value });
    }
  }

  if (flightItem?.flights?.routes?.length) {
    const outbound = flightItem.flights.routes.find(r =>
      (r.direction || '').toLowerCase().includes('out')
    ) || flightItem.flights.routes[0];

    const outboundLine = buildFlightLine(outbound);
    if (outboundLine) {
      const outDate = outbound.segments?.[0]?.depart
        ? formatShortDate(outbound.segments[0].depart) + ' · '
        : '';
      summaryRows.push({ group: 'flights', label: 'Outbound flight', value: `${outDate}${outboundLine}` });
    }

    const returnRoute = flightItem.flights.routes.find(r =>
      (r.direction || '').toLowerCase().includes('return')
        || (r.direction || '').toLowerCase().includes('inbound')
    );
    if (returnRoute && returnRoute !== outbound) {
      const returnLine = buildFlightLine(returnRoute);
      if (returnLine) {
        const retDate = returnRoute.segments?.[0]?.depart
          ? formatShortDate(returnRoute.segments[0].depart) + ' · '
          : '';
        summaryRows.push({ group: 'flights', label: 'Return flight', value: `${retDate}${returnLine}` });
      }
    }
  }

  // Transfers — short summary line. Multiple transfers (rare) each get
  // their own row. Renders as "From → To · Outbound 15 Sep · 09:00".
  const allTransferItems = (order?.items || []).filter(i => i.product === 'Transfers');
  for (const tItem of allTransferItems) {
    const tf = tItem.transfers;
    if (!tf) continue;
    const fromName = tf.outPickup?.name || tf.outPickup?.address1 || '';
    const toName = tf.outDropoff?.name || tf.outDropoff?.address1 || '';
    const route = [fromName, toName].filter(Boolean).join(' → ');
    if (!route) continue;
    const outDate = tf.outPickup?.dateTime ? formatShortDate(tf.outPickup.dateTime) : '';
    const outTime = tf.outPickup?.dateTime ? formatTime(tf.outPickup.dateTime) : '';
    const dateBit = [outDate, outTime].filter(Boolean).join(' · ');
    summaryRows.push({
      group: 'transfers',
      label: tf.returnPickup?.dateTime ? 'Transfer (return)' : 'Transfer',
      value: dateBit ? `${dateBit} · ${route}` : route,
    });
  }

  // Car Hire — vehicle name, pickup date/time and location.
  const allCarRentalItems = (order?.items || []).filter(i => i.product === 'CarRental');
  for (const crItem of allCarRentalItems) {
    const cr = crItem.carRental;
    if (!cr) continue;
    const vehicle = cr.name || cr.className || 'Hire car';
    const pickupDate = cr.pickup?.dateTime ? formatShortDate(cr.pickup.dateTime) : '';
    const pickupTime = cr.pickup?.dateTime ? formatTime(cr.pickup.dateTime) : '';
    const dropoffDate = cr.dropoff?.dateTime ? formatShortDate(cr.dropoff.dateTime) : '';
    const where = cr.pickup?.name || '';
    const bits = [pickupDate, pickupTime].filter(Boolean).join(' · ');
    const dur = (pickupDate && dropoffDate && pickupDate !== dropoffDate) ? ` → ${dropoffDate}` : '';
    summaryRows.push({
      group: 'carhire',
      label: 'Car hire',
      value: `${vehicle}${bits ? ` · ${bits}${dur}` : ''}${where ? ` · ${where}` : ''}`,
    });
  }

  // Tickets & Attractions — name + scheduled date/time + city.
  const allTicketsItems = (order?.items || []).filter(i => i.product === 'TicketsAttractions');
  for (const tkItem of allTicketsItems) {
    const tk = tkItem.ticketsAttractions;
    if (!tk) continue;
    const name = tk.name || tk.selectedOption?.name || 'Ticket';
    const sched = tk.selectedOption?.scheduledDateTime || tkItem.startDate;
    const schedDate = sched ? formatShortDate(sched) : '';
    const schedTime = sched ? formatTime(sched) : '';
    const city = tk.location?.city || '';
    const bits = [schedDate, schedTime].filter(Boolean).join(' · ');
    summaryRows.push({
      group: 'tickets',
      label: tk.ticketType || 'Tickets',
      value: `${name}${bits ? ` · ${bits}` : ''}${city ? ` · ${city}` : ''}`,
    });
  }

  // Extras — post-booking "Add Extra Group / Add Extra". One row per bookable
  // extra: "Private Return Taxi · Airport to Atmosphere Bar Return".
  const allExtrasItems = (order?.items || []).filter(i => i.product === 'Extras');
  for (const xItem of allExtrasItems) {
    for (const g of (xItem.extras?.groups || [])) {
      for (const e of (g.extras || [])) {
        const namePart = e.name || g.name || 'Extra';
        const value = [namePart, e.description].filter(Boolean).join(' · ');
        summaryRows.push({
          group: 'extras',
          label: g.name || g.type || 'Extra',
          value: (typeof e.qty === 'number' && e.qty > 1) ? `${value} · ×${e.qty}` : value,
        });
      }
    }
  }

  // Summary row HTML — every row uses the same body + caption sizes. No mono.
  // One booking card, given a set of rows and the label above it. The
  // whole-booking "summary" block hands it every row; an individual data
  // block (Flights, Your stay, Travellers ...) hands it only its own group's,
  // which is the ONE difference between the built-in layout and a layout a
  // client has arranged themselves. The card markup lives here rather than in
  // the page assembly so both paths draw the identical card.
  const summaryCard = (rows, title) => {
    if (!rows || !rows.length) return '';
    const body = rows.map((row, idx) => {
      const isLast = idx === rows.length - 1;
      const borderStyle = isLast ? '' : 'border-bottom:1px solid #e2e8f0;';
      return `
      <tr>
        <td style="padding:12px 0;${borderStyle}width:38%;vertical-align:top;font:500 12px/1.4 ${FONT};color:#64748b;letter-spacing:.04em;text-transform:uppercase;">
          ${escapeHtml(row.label)}
        </td>
        <td style="padding:12px 0;${borderStyle}vertical-align:top;font:600 15px/1.6 ${FONT};color:#0f172a;">
          ${escapeHtml(row.value)}
        </td>
      </tr>
    `;
    }).join('');
    return `
        <!-- Summary -->
        <tr>
          <td style="padding:8px 32px 24px 32px;">
            <div style="font:500 12px/1.4 ${FONT};color:#64748b;letter-spacing:.04em;text-transform:uppercase;margin-bottom:12px;">${escapeHtml(title)}</div>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;">
              <tr>
                <td style="padding:4px 24px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                    ${body}
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        `;
  };

  // Payment block — same type system as summary, accent on the headline only.
  let paymentHtml = '';
  if (payment) {
    const rows = [];
    const totalLabel = resolveTotalLabel(order?.items);

    rows.push(`
      <tr>
        <td style="padding:12px 0;border-bottom:1px solid #e2e8f0;font:600 15px/1.6 ${FONT};color:#0f172a;">
          ${escapeHtml(totalLabel)}
        </td>
        <td style="padding:12px 0;border-bottom:1px solid #e2e8f0;text-align:right;font:700 18px/1.4 ${FONT};color:#0f172a;">
          ${escapeHtml(formatMoney(payment.total, payment.currency))}
        </td>
      </tr>
    `);

    // Rows in the order the shared calculation defines: payments received,
    // each voucher as a credit, the balance, then what is payable now.
    if (payment.depositPaid != null) {
      rows.push(`
        <tr>
          <td style="padding:12px 0;border-bottom:1px solid #e2e8f0;font:400 15px/1.6 ${FONT};color:#64748b;">
            Paid so far
          </td>
          <td style="padding:12px 0;border-bottom:1px solid #e2e8f0;text-align:right;font:600 15px/1.6 ${FONT};color:#0f172a;">
            ${escapeHtml(formatMoney(payment.depositPaid, payment.currency))}
          </td>
        </tr>
      `);
    }

    for (const v of payment.vouchers) {
      rows.push(`
        <tr>
          <td style="padding:12px 0;border-bottom:1px solid #e2e8f0;font:400 15px/1.6 ${FONT};color:#64748b;">
            ${escapeHtml(voucherLabel(v))}
          </td>
          <td style="padding:12px 0;border-bottom:1px solid #e2e8f0;text-align:right;font:600 15px/1.6 ${FONT};color:#10b981;">
            ${escapeHtml(formatMoney(-v.credit, payment.currency))}
          </td>
        </tr>
      `);
    }

    if (payment.money.status !== 'none') {
      const dueLabel = payment.balanceDueDate
        ? `Balance remaining (due by ${formatShortDate(payment.balanceDueDate)})`
        : 'Balance remaining';
      const balColor = payment.balanceDue > 0 ? '#0f172a' : '#10b981';
      rows.push(`
        <tr>
          <td style="padding:12px 0;border-bottom:1px solid #e2e8f0;font:400 15px/1.6 ${FONT};color:#64748b;">
            ${escapeHtml(dueLabel)}
          </td>
          <td style="padding:12px 0;border-bottom:1px solid #e2e8f0;text-align:right;font:600 15px/1.6 ${FONT};color:${balColor};">
            ${escapeHtml(formatMoney(payment.balanceDue, payment.currency))}
          </td>
        </tr>
      `);
    }

    rows.push(`
      <tr>
        <td style="padding:12px 0;font:700 15px/1.6 ${FONT};color:#0f172a;">
          ${escapeHtml(MONEY_STRINGS.amountPayableNow)}
        </td>
        <td style="padding:12px 0;text-align:right;font:700 16px/1.4 ${FONT};color:#0f172a;">
          ${escapeHtml(formatMoney(payment.payable, payment.currency))}
        </td>
      </tr>
    `);

    if (payment.statusLine && payment.money.status !== 'open') {
      // Settled or part paid: say so in words. Green is permitted for a
      // status indicator; a Unicode bullet (not a CSS span) for Outlook.
      const settled = payment.money.settled;
      rows.push(`
        <tr>
          <td colspan="2" style="padding:14px 0 2px;text-align:center;font:${settled ? '700 14px' : '400 13px'}/1.5 ${FONT};color:${settled ? '#10b981' : '#64748b'};">
            ${settled ? '<span style="color:#10b981;font-size:16px;">&#9679;</span>&nbsp; ' : ''}${escapeHtml(payment.statusLine)}
          </td>
        </tr>
      `);
    }

    // On-arrival fees — surfaces in-resort fees (city tax, resort fees,
    // tourist tax, etc) inside the payment block instead of leaving them
    // hidden in the booking detail. A customer should never arrive at a
    // hotel and be hit with a charge they hadn't been warned about.
    //
    // Data shape mirrors the widget: prefer itemised payAtLocation if
    // available, otherwise fall back to a single inResortFees total. Same
    // safety rule as the widget — skip any line with no name AND no
    // description, never fabricate a fee description.
    const accPricing = acc?.pricing;
    const inResortFees = accPricing?.inResortFees;
    const payAtLocationLines = (accPricing?.payAtLocation || [])
      .filter(line => line.name || line.description);

    if (payAtLocationLines.length > 0 || inResortFees) {
      // Visual separator before the on-arrival block — distinct treatment
      // (amber accent, dashed top border) so a customer's eye catches it
      // even when scanning the email quickly.
      const onArrivalRows = [];
      onArrivalRows.push(`
        <tr>
          <td colspan="2" style="padding:16px 0 8px 0;border-top:1px dashed #cbd5e1;font:600 11px/1.4 ${FONT};color:#b45309;letter-spacing:.04em;text-transform:uppercase;">
            Also payable on arrival
          </td>
        </tr>
      `);
      if (payAtLocationLines.length > 0) {
        payAtLocationLines.forEach(line => {
          const label = line.name || line.description;
          const subLabel = (line.description && line.description !== line.name) ? line.description : '';
          const hasPrice = typeof line.unitPrice === 'number';
          const amount = hasPrice ? (line.unitPrice || 0) * (line.qty || 1) : null;
          onArrivalRows.push(`
            <tr>
              <td style="padding:8px 0;font:400 15px/1.6 ${FONT};color:#64748b;">
                ${escapeHtml(label)}
                ${subLabel ? `<div style="font:400 12px/1.4 ${FONT};color:#94a3b8;margin-top:2px;">${escapeHtml(subLabel)}</div>` : ''}
              </td>
              <td style="padding:8px 0;text-align:right;font:600 15px/1.6 ${FONT};color:#0f172a;vertical-align:top;">
                ${amount != null ? escapeHtml(formatMoney(amount, accPricing.currency || payment.currency)) : '—'}
              </td>
            </tr>
          `);
        });
      } else if (inResortFees) {
        onArrivalRows.push(`
          <tr>
            <td style="padding:8px 0;font:400 15px/1.6 ${FONT};color:#64748b;">
              Resort fees
            </td>
            <td style="padding:8px 0;text-align:right;font:600 15px/1.6 ${FONT};color:#0f172a;">
              ${escapeHtml(formatMoney(inResortFees, accPricing.currency || payment.currency))}
            </td>
          </tr>
        `);
      }
      onArrivalRows.push(`
        <tr>
          <td colspan="2" style="padding:4px 0 4px 0;font:400 12px/1.5 ${FONT};color:#94a3b8;">
            Paid directly to the hotel at check-in. Not included in your holiday cost above.
          </td>
        </tr>
      `);
      rows.push(...onArrivalRows);
    }

    paymentHtml = `
      <tr>
        <td style="padding:0 32px 24px 32px;">
          <div style="font:500 12px/1.4 ${FONT};color:#64748b;letter-spacing:.04em;text-transform:uppercase;margin-bottom:12px;">Payment</div>
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;">
            <tr>
              <td style="padding:4px 24px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                  ${rows.join('')}
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    `;
  }

  const messageHtml = message && message.trim()
    ? `
      <tr>
        <td style="padding:0 32px 24px 32px;">
          <div style="border-left:3px solid ${escapeHtml(accent)};padding:4px 0 4px 16px;font:400 italic 15px/1.6 ${FONT};color:#475569;">
            ${escapeHtml(message.trim()).replace(/\n/g, '<br>')}
          </div>
        </td>
      </tr>
    `
    : '';

  const headerInner = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(brandName)}" style="display:block;max-height:48px;max-width:240px;height:auto;width:auto;border:0;outline:none;">`
    : `<div style="font:700 22px/1.2 ${FONT};color:#ffffff;letter-spacing:-0.01em;">${escapeHtml(brandName)}</div>`;

  const supportHtml = (supportEmail || supportPhone) ? `
    <tr>
      <td style="padding:0 32px 24px 32px;">
        <div style="font:400 15px/1.6 ${FONT};color:#64748b;">
          Questions? ${supportEmail ? `Reply to this email${supportPhone ? ` or call <strong style="color:#0f172a;font-weight:600;">${escapeHtml(supportPhone)}</strong>` : ''}.` : `Call <strong style="color:#0f172a;font-weight:600;">${escapeHtml(supportPhone)}</strong>.`}
        </div>
      </td>
    </tr>
  ` : '';

  // Documents section. Built from order.documents (set by the source order)
  // and rendered as a list of links inside the email body. Documents are
  // ALSO attached as files to the email where size allows (booking-email.js
  // handles that), but every document always appears here as a link so a
  // customer can grab it even if their mail client stripped attachments.
  // URL safety: only HTTPS, and we reject private/loopback/link-local hosts
  // as defence-in-depth (the URLs come from Travelify so a malicious URL
  // would already require upstream compromise, but the cost of checking
  // is zero).
  const isSafeDocUrl = (raw) => {
    try {
      const u = new URL(raw);
      if (u.protocol !== 'https:') return false;
      const host = u.hostname.toLowerCase();
      if (host === 'localhost' || host === '0.0.0.0') return false;
      if (host.endsWith('.local') || host.endsWith('.internal')) return false;
      if (/^127\./.test(host)) return false;
      if (/^10\./.test(host)) return false;
      if (/^192\.168\./.test(host)) return false;
      if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host)) return false;
      if (/^169\.254\./.test(host)) return false;
      if (host === '::1' || host === '[::1]') return false;
      if (/^\[?fc[0-9a-f]{2}:/i.test(host) || /^\[?fd[0-9a-f]{2}:/i.test(host)) return false;
      if (/^\[?fe80:/i.test(host)) return false;
      return true;
    } catch {
      return false;
    }
  };

  const docList = Array.isArray(order?.documents) ? order.documents : [];
  const safeDocs = docList
    .filter(d => d && typeof d.url === 'string' && isSafeDocUrl(d.url));

  // Make each document open in the browser when clicked from the email.
  //
  // PDFs open natively in every browser, so we link them directly. Office
  // formats (.doc/.docx/.xls/.xlsx/.ppt/.pptx) have no native browser viewer —
  // a raw link just downloads (or opens a blank tab that closes), so we route
  // them through Microsoft's free Office Online viewer, which renders them
  // in-browser from the public file URL. Anything else falls back to a direct
  // link. The document host (static.travelify.io) serves these publicly, which
  // is what the viewer needs.
  const OFFICE_VIEWER = 'https://view.officeapps.live.com/op/view.aspx?src=';
  const OFFICE_EXTS = new Set(['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx']);
  const docExt = (u) => {
    try {
      const m = new URL(u).pathname.match(/\.([a-z0-9]{1,8})$/i);
      return m ? m[1].toLowerCase() : '';
    } catch { return ''; }
  };
  const buildDocLink = (url) => {
    return OFFICE_EXTS.has(docExt(url)) ? OFFICE_VIEWER + encodeURIComponent(url) : url;
  };

  const fmtBytes = (n) => {
    if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return '';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  };

  const documentsHtml = safeDocs.length ? `
    <tr>
      <td style="padding:0 32px 24px 32px;">
        <div style="font:500 12px/1.4 ${FONT};color:#64748b;letter-spacing:.04em;text-transform:uppercase;margin-bottom:12px;">Your documents</div>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;">
          <tr>
            <td style="padding:8px 16px;">
              ${safeDocs.map((d, i) => {
                const name = escapeHtml(((d.name || `Document ${i + 1}`).toString()).slice(0, 100));
                const extLabel = (d.ext || '').toString().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
                const sizeLabel = fmtBytes(typeof d.size === 'number' ? d.size : 0);
                const metaBits = [extLabel || 'FILE', sizeLabel].filter(Boolean).join(' · ');
                const url = buildDocLink(d.url); // Office viewer for Office formats, direct for PDF
                const isLast = i === safeDocs.length - 1;
                return `
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="${isLast ? '' : 'border-bottom:1px solid #e2e8f0;'}">
                    <tr>
                      <td style="padding:10px 0;">
                        <a href="${escapeHtml(url)}" target="_blank" style="font:600 15px/1.4 ${FONT};color:#0f172a;text-decoration:none;">📄 ${name}</a>
                        ${metaBits ? `<div style="font:400 12px/1.4 ${FONT};color:#64748b;margin-top:2px;">${escapeHtml(metaBits)}</div>` : ''}
                      </td>
                      <td style="padding:10px 0;text-align:right;white-space:nowrap;">
                        <a href="${escapeHtml(url)}" target="_blank" style="font:500 13px/1.4 ${FONT};color:${escapeHtml(accent)};text-decoration:none;">View →</a>
                      </td>
                    </tr>
                  </table>
                `;
              }).join('')}
            </td>
          </tr>
        </table>
        <div style="font:400 12px/1.6 ${FONT};color:#94a3b8;margin-top:8px;">
          Documents are attached to this email where size allows. Use the links above to view or download them at any time.
        </div>
      </td>
    </tr>
  ` : '';

  // Plain-text fallback
  const textParts = [
    greeting,
    '',
    'Your booking is confirmed. Full details are in the attached PDF.',
    '',
    '─── Booking summary ───',
    '',
    ...summaryRows.map(r => `${r.label}: ${r.value}`),
  ];

  if (payment) {
    textParts.push('', '─── Payment ───', '');
    textParts.push(`${resolveTotalLabel(order?.items)}: ${formatMoney(payment.total, payment.currency)}`);
    if (payment.depositPaid != null) {
      textParts.push(`Paid so far: ${formatMoney(payment.depositPaid, payment.currency)}`);
    }
    for (const v of payment.vouchers) {
      textParts.push(`${voucherLabel(v)}: ${formatMoney(-v.credit, payment.currency)}`);
    }
    if (payment.money.status !== 'none') {
      const dueLabel = payment.balanceDueDate
        ? `Balance remaining (due by ${formatShortDate(payment.balanceDueDate)})`
        : 'Balance remaining';
      textParts.push(`${dueLabel}: ${formatMoney(payment.balanceDue, payment.currency)}`);
    }
    textParts.push(`${MONEY_STRINGS.amountPayableNow}: ${formatMoney(payment.payable, payment.currency)}`);
    if (payment.statusLine && payment.money.status !== 'open') textParts.push(payment.statusLine);

    // On-arrival fees in plain-text fallback. Same rules as HTML: prefer
    // itemised payAtLocation, fall back to inResortFees total.
    const accPricingForText = acc?.pricing;
    const inResortFeesForText = accPricingForText?.inResortFees;
    const payAtLocationForText = (accPricingForText?.payAtLocation || [])
      .filter(line => line.name || line.description);
    const onArrivalCurrency = accPricingForText?.currency || payment.currency;
    if (payAtLocationForText.length > 0 || inResortFeesForText) {
      textParts.push('', 'Also payable on arrival (paid at the hotel):');
      if (payAtLocationForText.length > 0) {
        payAtLocationForText.forEach(line => {
          const label = line.name || line.description;
          const hasPrice = typeof line.unitPrice === 'number';
          const amount = hasPrice ? (line.unitPrice || 0) * (line.qty || 1) : null;
          textParts.push(`  - ${label}: ${amount != null ? formatMoney(amount, onArrivalCurrency) : '—'}`);
        });
      } else if (inResortFeesForText) {
        textParts.push(`  - Resort fees: ${formatMoney(inResortFeesForText, onArrivalCurrency)}`);
      }
    }
  }

  if (safeDocs.length) {
    textParts.push('', '─── Your documents ───', '');
    for (const d of safeDocs) {
      const name = (d.name || 'Document').toString();
      textParts.push(`${name}: ${buildDocLink(d.url)}`);
    }
  }

  if (message && message.trim()) {
    textParts.push('', '─── A note from us ───', '', message.trim());
  }

  textParts.push('');
  if (supportEmail || supportPhone) {
    const parts = [];
    if (supportEmail) parts.push('Reply to this email');
    if (supportPhone) parts.push(`call ${supportPhone}`);
    textParts.push(`Questions? ${parts.join(' or ')}.`);
    textParts.push('');
  }
  textParts.push(`— ${brandName}`);
  if (footerLine) {
    textParts.push('', footerLine);
  }
  const text = textParts.join('\n');

  // HTML body
  // ── Blocks ────────────────────────────────────────────────────────────────
  // Every part of the body, named. The page below is these in the order the
  // layout gives, so "arrange your own email" and "the email we have always
  // sent" are the same code path with a different list.

  const greetingHtml = `
        <!-- Greeting -->
        <tr>
          <td style="padding:32px 32px 16px 32px;">
            <div style="display:inline-block;background:#10b981;color:#ffffff;padding:4px 12px;border-radius:9999px;font:600 12px/1.4 ${FONT};letter-spacing:.04em;text-transform:uppercase;">
              ✓ Confirmed
            </div>
            <h1 style="margin:16px 0 0 0;font:700 22px/1.2 ${FONT};color:#0f172a;letter-spacing:-.01em;">
              ${greeting}
            </h1>
            <p style="margin:8px 0 0 0;font:400 15px/1.6 ${FONT};color:#475569;">
              Your booking is confirmed${destinationCity && acc ? ` and your ${escapeHtml(destinationCity)} trip is locked in` : ''}. The essentials are below — and the full A4 confirmation pack is attached as a PDF for your records.
            </p>
          </td>
        </tr>
        `;

  const pdfNoteHtml = `
        <!-- PDF callout -->
        <tr>
          <td style="padding:0 32px 24px 32px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                <td style="background:${escapeHtml(accent)}1a;border-left:4px solid ${escapeHtml(accent)};border-radius:8px;padding:16px 20px;">
                  <div style="font:600 15px/1.6 ${FONT};color:#0f172a;margin-bottom:2px;">📎 ${safeDocs.length ? 'Booking pack and documents attached' : 'Full booking pack attached'}</div>
                  <div style="font:400 15px/1.6 ${FONT};color:#475569;">Your A4 confirmation includes the room details, full flight breakdown, payment schedule, and important booking conditions.${safeDocs.length ? ' Supplier documents are attached where size allows — and always available via the links above.' : ''}</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        `;

  const signOffHtml = `
        <!-- Sign-off -->
        <tr>
          <td style="padding:24px 32px 32px 32px;">
            <div style="font:400 15px/1.6 ${FONT};color:#0f172a;">
              Have a wonderful trip,<br>
              <strong style="font-weight:600;">— ${escapeHtml(brandName)}</strong>
            </div>
          </td>
        </tr>
        `;

  // Rows belonging to one data block. The groups were stamped on each row as
  // it was built, so a block never has to guess which rows are its own.
  const rowsIn = (...groups) => summaryRows.filter(r => groups.includes(r.group));

  // What a client's own words can merge in. Lower-cased keys: the tag itself
  // is case insensitive.
  const mergeVars = {
    firstname: customerFirstName,
    bookingref: bookingReference,
    destination: destinationCity ? (destinationCountry ? `${destinationCity}, ${destinationCountry}` : destinationCity) : '',
    hotel: hotelName,
    checkin: checkin ? formatShortDate(checkin) : '',
    checkout: checkout ? formatShortDate(checkout) : '',
    nights: nights > 0 ? String(nights) : '',
    total: payment ? formatMoney(payment.total, payment.currency) : '',
    balance: payment && payment.balanceDue > 0 ? formatMoney(payment.balanceDue, payment.currency) : '',
    agencyname: brandName,
    agencyphone: supportPhone || '',
    agencyemail: supportEmail || '',
  };

  const dataBlocks = {
    greeting:   () => greetingHtml,
    message:    () => messageHtml,
    summary:    () => summaryCard(summaryRows, 'Your booking'),
    reference:  () => summaryCard(rowsIn('reference'), 'Your booking'),
    travellers: () => summaryCard(rowsIn('travellers'), 'Travellers'),
    stay:       () => summaryCard(rowsIn('stay'), 'Your stay'),
    flights:    () => summaryCard(rowsIn('flights'), 'Flights'),
    transfers:  () => summaryCard(rowsIn('transfers'), 'Transfers'),
    carhire:    () => summaryCard(rowsIn('carhire'), 'Car hire'),
    tickets:    () => summaryCard(rowsIn('tickets'), 'Tickets and attractions'),
    extras:     () => summaryCard(rowsIn('extras'), 'Extras'),
    payment:    () => paymentHtml,
    documents:  () => documentsHtml,
    pdfnote:    () => pdfNoteHtml,
    support:    () => supportHtml,
    signoff:    () => signOffHtml,
  };

  function renderBlock(block) {
    const built = dataBlocks[block.type];
    if (built) return built();

    // The client wrote this one.
    const raw = typeof block.text === 'string' ? block.text : '';
    const filled = applyMergeTags(raw, mergeVars);

    if (block.type === 'text') {
      const body = proseToHtml(filled, '#475569');
      return body ? `
        <tr><td style="padding:0 32px 12px 32px;">${body}</td></tr>
        ` : '';
    }
    if (block.type === 'heading') {
      if (!filled.trim()) return '';
      return `
        <tr>
          <td style="padding:8px 32px 8px 32px;">
            <div style="font:700 18px/1.3 ${FONT};color:#0f172a;letter-spacing:-.01em;">${escapeHtml(filled.trim())}</div>
          </td>
        </tr>
        `;
    }
    if (block.type === 'button') {
      const href = safeHttpsUrl(applyMergeTags(block.url, mergeVars));
      const label = filled.trim() || 'View my booking';
      if (!href) return '';
      // Table-wrapped so Outlook draws the button rather than a bare link.
      return `
        <tr>
          <td style="padding:8px 32px 20px 32px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="background:${escapeHtml(primary)};border-radius:8px;">
                  <a href="${escapeHtml(href)}" style="display:inline-block;padding:13px 26px;font:600 15px/1 ${FONT};color:#ffffff;text-decoration:none;">${escapeHtml(label)}</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        `;
    }
    if (block.type === 'image') {
      const src = safeHttpsUrl(block.url);
      if (!src) return '';
      return `
        <tr>
          <td style="padding:0 0 20px 0;">
            <img src="${escapeHtml(src)}" alt="${escapeHtml(filled.trim() || brandName)}" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0;outline:none;">
          </td>
        </tr>
        `;
    }
    if (block.type === 'divider') {
      return `
        <tr>
          <td style="padding:4px 32px 20px 32px;">
            <div style="height:1px;background:#e2e8f0;line-height:1px;font-size:1px;">&nbsp;</div>
          </td>
        </tr>
        `;
    }
    return '';
  }

  const bodyHtml = normaliseLayout(layout).map(renderBlock).join('\n');

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:${FONT};-webkit-font-smoothing:antialiased;">
<div style="display:none;font-size:1px;color:#f1f5f9;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${bookingReference ? `Your booking ${escapeHtml(bookingReference)} is confirmed` : 'Your booking is confirmed'}${destinationCity ? ` for ${escapeHtml(destinationCity)}` : ''}${checkin ? ` on ${escapeHtml(formatShortDate(checkin))}` : ''}.</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f1f5f9;">
  <tr>
    <td align="center" style="padding:24px 16px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 6px rgba(0,0,0,.06),0 2px 4px rgba(0,0,0,.04);">

        <!-- Header -->
        <tr>
          <td style="background:${escapeHtml(primary)};padding:32px;" align="left">
            ${headerInner}
          </td>
        </tr>

        ${bodyHtml}

        ${footerLine ? `
        <tr>
          <td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:16px 32px;">
            <div style="font:400 12px/1.4 ${FONT};color:#64748b;text-align:center;">
              ${escapeHtml(footerLine)}
            </div>
          </td>
        </tr>
        ` : ''}

      </table>

      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;">
        <tr>
          <td style="padding:16px 8px;text-align:center;">
            <div style="font:400 12px/1.4 ${FONT};color:#94a3b8;">
              Sent from your booking confirmation page
            </div>
          </td>
        </tr>
      </table>

    </td>
  </tr>
</table>
</body>
</html>`;

  return { subject, html, text };
}
