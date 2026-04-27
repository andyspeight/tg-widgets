// =============================================================================
//  /api/_lib/booking-email-template.js
// =============================================================================
//
//  Renders the HTML body of the booking confirmation email.
//
//  Design rules (must match brand):
//   - Inter font family with web-safe fallback (Inter isn't installed in mail
//     clients but the fallback chain still gives a clean sans-serif).
//   - Deep navy primary (#1B2B5B) with teal accent (#00B4D8) by default.
//     Per-widget colour overrides supported via `colors` parameter.
//   - 600px max width — the standard for HTML email; wider gets clipped on
//     mobile and looks awkward in narrow preview panes.
//   - Tables for layout. Mail clients still don't reliably render flexbox/grid.
//   - Inline styles only. <style> blocks get stripped by Gmail and others.
//   - One <img> at most (the logo). Anything else inflates the email and
//     triggers spam filters.
//
//  The actual booking detail lives in the attached PDF. This email is the
//  warm covering note, not a duplicate of the PDF.
// =============================================================================

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Format a date as e.g. "Tuesday, 15 July 2026". Defensive about bad input.
 */
function formatLongDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return d.toLocaleDateString('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

/**
 * Render the booking confirmation email.
 *
 * @param {object} opts
 * @param {string} opts.customerFirstName       - For greeting (e.g. "Andy")
 * @param {string} opts.bookingReference        - Human ref (e.g. "ABC12345")
 * @param {string} [opts.destinationCity]       - Optional, e.g. "Faro"
 * @param {string} [opts.departureDate]         - ISO date for the trip
 * @param {string} [opts.hotelName]             - Optional accommodation name
 * @param {string} [opts.message]               - Optional free-text message from sender
 * @param {object} opts.brand
 * @param {string} opts.brand.name              - Agency display name
 * @param {string} [opts.brand.logoUrl]         - Public URL of agency logo
 * @param {string} [opts.brand.footerLine]      - Optional ATOL/regulatory footer line
 * @param {object} [opts.colors]
 * @param {string} [opts.colors.primary]        - Hex (default #1B2B5B)
 * @param {string} [opts.colors.accent]         - Hex (default #00B4D8)
 * @param {string} [opts.supportEmail]          - For "questions? reply to this email" line
 * @param {string} [opts.supportPhone]          - Shown if provided
 *
 * @returns {{subject: string, html: string, text: string}}
 */
export function renderBookingEmail(opts) {
  const {
    customerFirstName,
    bookingReference,
    destinationCity,
    departureDate,
    hotelName,
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

  const greeting = customerFirstName
    ? `Hi ${escapeHtml(customerFirstName)},`
    : 'Hi,';

  const departureLine = departureDate ? formatLongDate(departureDate) : '';

  // The subject is the most important "rendered" piece — what the customer
  // sees in their inbox. Lead with the agency name so they recognise it; the
  // From field shows the agency name too but Gmail aggressively truncates it.
  const subject = destinationCity
    ? `Your ${destinationCity} booking confirmation${bookingReference ? ` (${bookingReference})` : ''}`
    : `Your booking confirmation${bookingReference ? ` (${bookingReference})` : ''}`;

  // Custom message from the sender — sanitise and wrap in a quoted block.
  // We render newlines as <br> but otherwise show the sender's wording verbatim.
  const messageHtml = message && message.trim()
    ? `
      <tr>
        <td style="padding:0 32px 24px 32px;">
          <div style="border-left:3px solid ${escapeHtml(accent)};padding:8px 0 8px 16px;font-size:15px;line-height:1.6;color:#475569;font-style:italic;">
            ${escapeHtml(message.trim()).replace(/\n/g, '<br>')}
          </div>
        </td>
      </tr>
    `
    : '';

  // Logo or wordmark fallback. Logos render across all major mail clients;
  // we set explicit width so it doesn't blow out on retina displays.
  const headerInner = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(brandName)}" style="display:block;max-height:48px;max-width:240px;height:auto;width:auto;border:0;outline:none;">`
    : `<div style="font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.01em;font-family:'Inter','Segoe UI',Roboto,Helvetica,Arial,sans-serif;">${escapeHtml(brandName)}</div>`;

  // Pieces of the booking summary block. Only render lines that have data —
  // we never want an empty "Hotel: " label hanging there.
  const summaryRows = [];
  if (bookingReference) {
    summaryRows.push(['Booking reference', bookingReference]);
  }
  if (hotelName) {
    summaryRows.push(['Accommodation', hotelName]);
  }
  if (destinationCity) {
    summaryRows.push(['Destination', destinationCity]);
  }
  if (departureLine) {
    summaryRows.push(['Departure', departureLine]);
  }

  const summaryRowsHtml = summaryRows.map(([label, value]) => `
    <tr>
      <td style="padding:6px 0;font-size:13px;color:#64748b;font-family:'Inter','Segoe UI',Roboto,Helvetica,Arial,sans-serif;letter-spacing:.04em;text-transform:uppercase;font-weight:500;width:38%;">
        ${escapeHtml(label)}
      </td>
      <td style="padding:6px 0;font-size:15px;color:#0f172a;font-family:'Inter','Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-weight:600;">
        ${escapeHtml(value)}
      </td>
    </tr>
  `).join('');

  // Support contact block — only render if anything to put in it
  const supportHtml = (supportEmail || supportPhone) ? `
    <tr>
      <td style="padding:24px 32px 0 32px;">
        <div style="font-size:13px;color:#64748b;line-height:1.6;font-family:'Inter','Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
          Questions? ${supportEmail ? `Reply to this email${supportPhone ? ` or call <strong style="color:#0f172a;">${escapeHtml(supportPhone)}</strong>` : ''}.` : `Call <strong style="color:#0f172a;">${escapeHtml(supportPhone)}</strong>.`}
        </div>
      </td>
    </tr>
  ` : '';

  // Plain-text version. Some recipients prefer this; some clients can't render
  // HTML at all (older corporate mail systems). We keep it minimal and
  // information-equivalent.
  const textParts = [
    greeting,
    '',
    'Your booking is confirmed and the full details are attached as a PDF.',
    '',
    ...summaryRows.map(([l, v]) => `${l}: ${v}`),
    '',
  ];
  if (message && message.trim()) {
    textParts.push(message.trim(), '');
  }
  if (supportEmail || supportPhone) {
    textParts.push(`Questions? ${supportEmail ? `Reply to this email` : ''}${supportEmail && supportPhone ? ' or ' : ''}${supportPhone ? `call ${supportPhone}` : ''}.`, '');
  }
  textParts.push(`— ${brandName}`);
  if (footerLine) {
    textParts.push('', footerLine);
  }
  const text = textParts.join('\n');

  // The HTML structure: outer wrapper table → centred 600px container → header
  // band (primary colour) → body card (white) → footer (mid-grey on light grey).
  // Every visual property is inline style; mail clients strip <style>.
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Inter','Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
<div style="display:none;font-size:1px;color:#f1f5f9;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">Your booking is confirmed. Full details attached as PDF.</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f1f5f9;">
  <tr>
    <td align="center" style="padding:24px 16px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 6px rgba(0,0,0,.06),0 2px 4px rgba(0,0,0,.04);">

        <!-- Header band -->
        <tr>
          <td style="background:${escapeHtml(primary)};padding:32px;" align="left">
            ${headerInner}
          </td>
        </tr>

        <!-- Confirmed badge + greeting -->
        <tr>
          <td style="padding:32px 32px 16px 32px;">
            <div style="display:inline-block;background:#10b981;color:#ffffff;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;padding:4px 12px;border-radius:9999px;font-family:'Inter','Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
              ✓ Confirmed
            </div>
            <h1 style="margin:16px 0 0 0;font-size:24px;font-weight:700;color:#0f172a;letter-spacing:-.02em;line-height:1.2;font-family:'Inter','Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
              ${greeting}
            </h1>
            <p style="margin:8px 0 0 0;font-size:16px;line-height:1.6;color:#334155;font-family:'Inter','Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
              Your booking is confirmed. The full details are attached as a PDF — keep it handy for your trip.
            </p>
          </td>
        </tr>

        ${messageHtml}

        ${summaryRows.length ? `
        <!-- Summary box -->
        <tr>
          <td style="padding:8px 32px 24px 32px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f8fafc;border-radius:12px;border:1px solid #e2e8f0;">
              <tr>
                <td style="padding:20px 24px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                    ${summaryRowsHtml}
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        ` : ''}

        <!-- PDF callout -->
        <tr>
          <td style="padding:0 32px 24px 32px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                <td style="background:${escapeHtml(accent)}1a;border-left:4px solid ${escapeHtml(accent)};border-radius:8px;padding:16px 20px;">
                  <div style="font-size:14px;line-height:1.5;color:#0f172a;font-family:'Inter','Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                    <strong style="font-weight:600;">📎 Booking pack attached</strong><br>
                    <span style="color:#475569;">Your full A4 confirmation is attached to this email. Print it, save it, or forward it on.</span>
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        ${supportHtml}

        <!-- Sign-off -->
        <tr>
          <td style="padding:24px 32px 32px 32px;">
            <div style="font-size:15px;line-height:1.6;color:#0f172a;font-family:'Inter','Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
              Have a wonderful trip,<br>
              <strong style="font-weight:600;">— ${escapeHtml(brandName)}</strong>
            </div>
          </td>
        </tr>

        ${footerLine ? `
        <!-- Footer line -->
        <tr>
          <td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:16px 32px;">
            <div style="font-size:12px;line-height:1.5;color:#64748b;text-align:center;font-family:'Inter','Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
              ${escapeHtml(footerLine)}
            </div>
          </td>
        </tr>
        ` : ''}

      </table>

      <!-- Tiny powered-by line. Single colour, single line, never the focus. -->
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;">
        <tr>
          <td style="padding:16px 8px;text-align:center;">
            <div style="font-size:11px;color:#94a3b8;font-family:'Inter','Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
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
