// =============================================================================
//  /api/_lib/booking-email-template.js
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
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatShortDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return d.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
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
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
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
      Insurance:           'Total insurance cost',
    };
    return map[only] || 'Total cost';
  }
  return 'Total cost';
}

function addDays(iso, days) {
  if (!iso || typeof days !== 'number') return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
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
  const accItem = order.items?.find(i => i.product === 'Accommodation' || i.product === 'Packages');
  const summary = order.summary || {};
  const pricing = accItem?.accommodation?.pricing;
  const currency = pricing?.currency || order.currency || 'GBP';

  const total = (typeof summary.totalPrice === 'number' && summary.totalPrice > 0)
    ? summary.totalPrice
    : (pricing?.memberPrice ?? pricing?.price ?? accItem?.price ?? 0);

  if (!total) return null;

  const result = {
    total,
    currency,
    depositPaid: null,   // rendered as "Paid so far"
    balanceDue: null,    // rendered as "Balance remaining"
    balanceDueDate: null,
  };

  // Order-level truth: "Paid so far" = payments taken; "Balance remaining" =
  // total − paid. The depositOption.breakdown is only a schedule (Travelify
  // leaves it after a payment), so we use it ONLY for the next due date.
  const dep = order.depositOption;
  const paid = typeof order.paidToDate === 'number' ? order.paidToDate : null;
  if (paid != null) {
    if (paid > 0) result.depositPaid = Math.round(paid * 100) / 100;
    const outstanding = Math.max(0, Math.round((total - paid) * 100) / 100);
    if (outstanding > 0) {
      result.balanceDue = outstanding;
      if (dep && Array.isArray(dep.breakdown) && dep.breakdown.length) {
        const next = dep.breakdown.slice().sort((a, b) => (Date.parse(a.dueDate) || Infinity) - (Date.parse(b.dueDate) || Infinity))[0];
        result.balanceDueDate = next?.dueDate || null;
      }
    }
  } else {
    // Legacy fallback: no order-level payment data — use the hotel deposit.
    const depositOpts = pricing?.depositOptions || [];
    const standardDep = depositOpts.find(d => !d.installments) || depositOpts[0] || null;
    if (standardDep) {
      result.depositPaid = standardDep.amount;
      const balanceLine = standardDep.breakdown?.[0];
      if (balanceLine) {
        result.balanceDue = balanceLine.amount;
        result.balanceDueDate = balanceLine.dueDate;
      }
    }
  }

  // Clear "settled" signal for the cost summary when nothing is outstanding.
  result.paidInFull = result.depositPaid != null
    && result.depositPaid > 0
    && (result.balanceDue == null || result.balanceDue <= 0)
    && typeof total === 'number' && total > 0
    && Math.round((total - result.depositPaid) * 100) / 100 <= 0;

  return result;
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
  } = opts;

  const primary = colors.primary || '#1B2B5B';
  const accent = colors.accent || '#00B4D8';
  const brandName = brand?.name || 'Travel Team';
  const logoUrl = brand?.logoUrl;
  const footerLine = brand?.footerLine;

  const accItem = order?.items?.find(i => i.product === 'Accommodation' || i.product === 'Packages');
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
    summaryRows.push({ label: 'Booking reference', value: bookingReference });
  }

  // ATOL operator disclosure — required on any ATOL-protected package sale.
  // Shows next to the booking reference so it's prominent. Format:
  //   ATOL protected · Operated by EveryHoliday
  if (packageInfo && (packageInfo.atolProtected || packageInfo.operator?.name)) {
    const parts = [];
    if (packageInfo.atolProtected) parts.push('ATOL Protected');
    if (packageInfo.operator?.name) parts.push(`Operated by ${packageInfo.operator.name}`);
    if (parts.length) summaryRows.push({ label: 'Holiday protection', value: parts.join(' · ') });
  }

  if (travellers.length > 0) {
    const value = travellers.length === 1
      ? travellers[0]
      : `${travellers[0]} +${travellers.length - 1} other${travellers.length - 1 === 1 ? '' : 's'}`;
    summaryRows.push({ label: travellers.length === 1 ? 'Lead guest' : 'Travellers', value });
  }

  if (destinationCity) {
    const dest = destinationCountry ? `${destinationCity}, ${destinationCountry}` : destinationCity;
    summaryRows.push({ label: 'Destination', value: dest });
  }

  if (hotelName) {
    summaryRows.push({ label: 'Accommodation', value: hotelName });
  }

  if (checkin) {
    const checkinShort = formatShortDate(checkin);
    const checkoutShort = checkout ? formatShortDate(checkout) : '';
    const nightsLabel = nights > 0 ? ` · ${nights} ${nights === 1 ? 'night' : 'nights'}` : '';
    const value = checkoutShort
      ? `${checkinShort} → ${checkoutShort}${nightsLabel}`
      : `${checkinShort}${nightsLabel}`;
    summaryRows.push({ label: 'Your stay', value });
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
      summaryRows.push({ label: 'Outbound flight', value: `${outDate}${outboundLine}` });
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
        summaryRows.push({ label: 'Return flight', value: `${retDate}${returnLine}` });
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
      label: tk.ticketType || 'Tickets',
      value: `${name}${bits ? ` · ${bits}` : ''}${city ? ` · ${city}` : ''}`,
    });
  }

  // Summary row HTML — every row uses the same body + caption sizes. No mono.
  const summaryRowsHtml = summaryRows.map((row, idx) => {
    const isLast = idx === summaryRows.length - 1;
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

    if (payment.depositPaid != null) {
      const isLast = (payment.balanceDue == null || payment.balanceDue <= 0) && !payment.paidInFull;
      const borderStyle = isLast ? '' : 'border-bottom:1px solid #e2e8f0;';
      const amtColor = payment.paidInFull ? '#10b981' : '#0f172a';
      rows.push(`
        <tr>
          <td style="padding:12px 0;${borderStyle}font:400 15px/1.6 ${FONT};color:#64748b;">
            Paid so far
          </td>
          <td style="padding:12px 0;${borderStyle}text-align:right;font:600 15px/1.6 ${FONT};color:${amtColor};">
            ${escapeHtml(formatMoney(payment.depositPaid, payment.currency))}
          </td>
        </tr>
      `);
    }

    if (payment.paidInFull) {
      // Settled status — green is permitted for status indicators. Green
      // Unicode bullet (not a CSS span) for Outlook reliability.
      rows.push(`
        <tr>
          <td colspan="2" style="padding:14px 0 2px;text-align:center;font:700 14px/1.5 ${FONT};color:#10b981;">
            <span style="color:#10b981;font-size:16px;">&#9679;</span>&nbsp; Paid in full — thank you
          </td>
        </tr>
      `);
    }

    if (payment.balanceDue != null && payment.balanceDue > 0) {
      const dueLabel = payment.balanceDueDate
        ? `Balance remaining (due by ${formatShortDate(payment.balanceDueDate)})`
        : 'Balance remaining';
      rows.push(`
        <tr>
          <td style="padding:12px 0;font:400 15px/1.6 ${FONT};color:#64748b;">
            ${escapeHtml(dueLabel)}
          </td>
          <td style="padding:12px 0;text-align:right;font:600 15px/1.6 ${FONT};color:#0f172a;">
            ${escapeHtml(formatMoney(payment.balanceDue, payment.currency))}
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
    if (payment.balanceDue != null && payment.balanceDue > 0) {
      const dueLabel = payment.balanceDueDate
        ? `Balance remaining (due by ${formatShortDate(payment.balanceDueDate)})`
        : 'Balance remaining';
      textParts.push(`${dueLabel}: ${formatMoney(payment.balanceDue, payment.currency)}`);
    }

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

        ${messageHtml}

        ${summaryRows.length ? `
        <!-- Summary -->
        <tr>
          <td style="padding:8px 32px 24px 32px;">
            <div style="font:500 12px/1.4 ${FONT};color:#64748b;letter-spacing:.04em;text-transform:uppercase;margin-bottom:12px;">Your booking</div>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;">
              <tr>
                <td style="padding:4px 24px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                    ${summaryRowsHtml}
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        ` : ''}

        ${documentsHtml}

        ${paymentHtml}

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

        ${supportHtml}

        <!-- Sign-off -->
        <tr>
          <td style="padding:24px 32px 32px 32px;">
            <div style="font:400 15px/1.6 ${FONT};color:#0f172a;">
              Have a wonderful trip,<br>
              <strong style="font-weight:600;">— ${escapeHtml(brandName)}</strong>
            </div>
          </td>
        </tr>

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
