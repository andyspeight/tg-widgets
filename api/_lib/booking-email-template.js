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
  const accItem = order.items?.find(i => i.product === 'Accommodation');
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
  const accItem = order.items?.find(i => i.product === 'Accommodation');
  const summary = order.summary || {};
  const pricing = accItem?.accommodation?.pricing;
  const currency = pricing?.currency || order.currency || 'GBP';

  const total = (typeof summary.totalPrice === 'number' && summary.totalPrice > 0)
    ? summary.totalPrice
    : (pricing?.memberPrice ?? pricing?.price ?? accItem?.price ?? 0);

  if (!total) return null;

  const depositOpts = pricing?.depositOptions || [];
  const standardDep = depositOpts.find(d => !d.installments) || depositOpts[0] || null;

  const result = {
    total,
    currency,
    depositPaid: null,
    balanceDue: null,
    balanceDueDate: null,
  };

  if (standardDep) {
    result.depositPaid = standardDep.amount;
    const balanceLine = standardDep.breakdown?.[0];
    if (balanceLine) {
      result.balanceDue = balanceLine.amount;
      result.balanceDueDate = balanceLine.dueDate;
    }
  }

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
  } = opts;

  const primary = colors.primary || '#1B2B5B';
  const accent = colors.accent || '#00B4D8';
  const brandName = brand?.name || 'Travel Team';
  const logoUrl = brand?.logoUrl;
  const footerLine = brand?.footerLine;

  const accItem = order?.items?.find(i => i.product === 'Accommodation');
  const flightItem = order?.items?.find(i => i.product === 'Flights');
  const acc = accItem?.accommodation;

  const customerFirstName = (order?.customerFirstname || '').trim();
  const greeting = customerFirstName
    ? `Hi ${escapeHtml(customerFirstName)},`
    : 'Hi,';

  const bookingReference = accItem?.bookingReference
    || flightItem?.bookingReference
    || `TG${order?.id || ''}`;

  const destinationCity = acc?.location?.city || '';
  const destinationCountry = acc?.location?.country || '';
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

    rows.push(`
      <tr>
        <td style="padding:12px 0;border-bottom:1px solid #e2e8f0;font:600 15px/1.6 ${FONT};color:#0f172a;">
          Total holiday cost
        </td>
        <td style="padding:12px 0;border-bottom:1px solid #e2e8f0;text-align:right;font:700 18px/1.4 ${FONT};color:#0f172a;">
          ${escapeHtml(formatMoney(payment.total, payment.currency))}
        </td>
      </tr>
    `);

    if (payment.depositPaid != null) {
      const isLast = payment.balanceDue == null || payment.balanceDue <= 0;
      const borderStyle = isLast ? '' : 'border-bottom:1px solid #e2e8f0;';
      rows.push(`
        <tr>
          <td style="padding:12px 0;${borderStyle}font:400 15px/1.6 ${FONT};color:#64748b;">
            Deposit paid
          </td>
          <td style="padding:12px 0;${borderStyle}text-align:right;font:600 15px/1.6 ${FONT};color:#0f172a;">
            ${escapeHtml(formatMoney(payment.depositPaid, payment.currency))}
          </td>
        </tr>
      `);
    }

    if (payment.balanceDue != null && payment.balanceDue > 0) {
      const dueLabel = payment.balanceDueDate
        ? `Balance due by ${formatShortDate(payment.balanceDueDate)}`
        : 'Balance due';
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
    textParts.push(`Total holiday cost: ${formatMoney(payment.total, payment.currency)}`);
    if (payment.depositPaid != null) {
      textParts.push(`Deposit paid: ${formatMoney(payment.depositPaid, payment.currency)}`);
    }
    if (payment.balanceDue != null && payment.balanceDue > 0) {
      const dueLabel = payment.balanceDueDate
        ? `Balance due by ${formatShortDate(payment.balanceDueDate)}`
        : 'Balance due';
      textParts.push(`${dueLabel}: ${formatMoney(payment.balanceDue, payment.currency)}`);
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
<div style="display:none;font-size:1px;color:#f1f5f9;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">Your booking ${escapeHtml(bookingReference)} is confirmed${destinationCity ? ` for ${escapeHtml(destinationCity)}` : ''}${checkin ? ` on ${escapeHtml(formatShortDate(checkin))}` : ''}.</div>
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
              Your booking is confirmed${destinationCity ? ` and your ${escapeHtml(destinationCity)} trip is locked in` : ''}. The essentials are below — and the full A4 confirmation pack is attached as a PDF for your records.
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

        ${paymentHtml}

        <!-- PDF callout -->
        <tr>
          <td style="padding:0 32px 24px 32px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                <td style="background:${escapeHtml(accent)}1a;border-left:4px solid ${escapeHtml(accent)};border-radius:8px;padding:16px 20px;">
                  <div style="font:600 15px/1.6 ${FONT};color:#0f172a;margin-bottom:2px;">📎 Full booking pack attached</div>
                  <div style="font:400 15px/1.6 ${FONT};color:#475569;">Your A4 confirmation includes the room details, full flight breakdown, payment schedule, and important booking conditions.</div>
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
