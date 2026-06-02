// =============================================================================
//  /api/_lib/cancellation-email-template.js
// =============================================================================
//
//  Renders the cancellation confirmation email sent to a traveller after a
//  product is successfully cancelled from the My Booking widget. Deliberately
//  matches the conventions of booking-email-template.js:
//   - 600px max width, inline styles only (Gmail strips <style> blocks)
//   - system font stack, two text colours (#0f172a primary, #64748b muted)
//   - brand colour band header with optional logo, footerLine in the footer
//
//  This email is intentionally simple — no PDF, no attachments. It confirms
//  what was cancelled and surfaces the cancellation reference, plus the
//  agency's editable message.
// =============================================================================

const FONT_STACK = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Turn the agency's free-text message (which may contain line breaks) into
// escaped HTML paragraphs.
function messageToHtml(message) {
  const safe = escapeHtml(message).trim();
  if (!safe) return '';
  return safe
    .split(/\n{2,}/)
    .map(block => `<p style="margin:0 0 12px;font-family:${FONT_STACK};font-size:15px;line-height:1.55;color:#0f172a;">${block.replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/**
 * @param {object} opts
 * @param {object} opts.brand              - { name, logoUrl?, footerLine?, primary? }
 * @param {string} [opts.customerName]     - Traveller first name
 * @param {string} [opts.productLabel]     - e.g. "Accommodation", "Transfer"
 * @param {string} [opts.bookingReference] - The product's booking reference
 * @param {string} [opts.cancellationReference]
 * @param {string} [opts.message]          - Agency's editable confirmation message
 * @param {string} [opts.supportEmail]
 * @param {string} [opts.supportPhone]
 * @returns {{subject: string, html: string, text: string}}
 */
export function renderCancellationEmail(opts) {
  const brand = opts.brand || {};
  const brandName = (brand.name || 'Travel Team').toString();
  const logoUrl = (brand.logoUrl && /^https:\/\//i.test(brand.logoUrl)) ? brand.logoUrl : '';
  const footerLine = (brand.footerLine || '').toString();
  const primary = /^#[0-9a-fA-F]{6}$/.test(brand.primary || '') ? brand.primary : '#1B2B5B';

  const customerName = (opts.customerName || '').toString().trim();
  const productLabel = (opts.productLabel || 'product').toString();
  const bookingReference = (opts.bookingReference || '').toString().trim();
  const cancellationReference = (opts.cancellationReference || '').toString().trim();
  const supportEmail = (opts.supportEmail || '').toString().trim();
  const supportPhone = (opts.supportPhone || '').toString().trim();

  const defaultMessage =
    `We're writing to confirm that your ${productLabel.toLowerCase()} has been cancelled as requested. ` +
    `If any refund is due it will be processed in line with the cancellation policy. ` +
    `If you didn't request this or have any questions, please get in touch.`;
  const messageHtml = messageToHtml(opts.message || defaultMessage);

  const greeting = customerName ? `Hi ${escapeHtml(customerName)},` : 'Hi,';
  const subject = bookingReference
    ? `Cancellation confirmed — ${productLabel} (${bookingReference})`
    : `Cancellation confirmed — ${productLabel}`;

  const headerInner = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(brandName)}" style="display:block;max-height:44px;max-width:220px;height:auto;width:auto;border:0;outline:none;">`
    : `<span style="font-family:${FONT_STACK};font-size:20px;font-weight:700;color:#ffffff;">${escapeHtml(brandName)}</span>`;

  const detailRow = (label, value) => value
    ? `<tr>
        <td style="padding:8px 0;font-family:${FONT_STACK};font-size:12px;font-weight:500;letter-spacing:.04em;text-transform:uppercase;color:#64748b;">${escapeHtml(label)}</td>
        <td style="padding:8px 0;font-family:${FONT_STACK};font-size:15px;font-weight:600;color:#0f172a;text-align:right;">${escapeHtml(value)}</td>
      </tr>`
    : '';

  const supportBits = [];
  if (supportEmail) supportBits.push(`<a href="mailto:${escapeHtml(supportEmail)}" style="color:${primary};text-decoration:none;">${escapeHtml(supportEmail)}</a>`);
  if (supportPhone) supportBits.push(escapeHtml(supportPhone));
  const supportHtml = supportBits.length
    ? `<p style="margin:16px 0 0;font-family:${FONT_STACK};font-size:13px;line-height:1.5;color:#64748b;">Need help? ${supportBits.join(' &nbsp;·&nbsp; ')}</p>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="x-apple-disable-message-reformatting">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your ${escapeHtml(productLabel.toLowerCase())} has been cancelled.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e2e8f0;">
      <tr><td style="background:${primary};padding:20px 28px;">${headerInner}</td></tr>
      <tr><td style="padding:28px 28px 8px;">
        <p style="margin:0 0 14px;font-family:${FONT_STACK};font-size:22px;font-weight:700;color:#0f172a;">${greeting}</p>
        ${messageHtml}
      </td></tr>
      <tr><td style="padding:8px 28px 4px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:6px 16px;">
          ${detailRow('Cancelled', productLabel)}
          ${detailRow('Booking reference', bookingReference)}
          ${detailRow('Cancellation reference', cancellationReference)}
        </table>
      </td></tr>
      <tr><td style="padding:12px 28px 28px;">
        ${supportHtml}
      </td></tr>
      ${footerLine ? `<tr><td style="padding:18px 28px;background:#f8fafc;border-top:1px solid #e2e8f0;">
        <p style="margin:0;font-family:${FONT_STACK};font-size:12px;line-height:1.5;color:#94a3b8;">${escapeHtml(footerLine)}</p>
      </td></tr>` : ''}
    </table>
  </td></tr>
</table>
</body>
</html>`;

  const textParts = [
    greeting.replace(/<[^>]+>/g, ''),
    '',
    (opts.message || defaultMessage),
    '',
    `Cancelled: ${productLabel}`,
  ];
  if (bookingReference) textParts.push(`Booking reference: ${bookingReference}`);
  if (cancellationReference) textParts.push(`Cancellation reference: ${cancellationReference}`);
  if (supportEmail || supportPhone) {
    textParts.push('', `Need help? ${[supportEmail, supportPhone].filter(Boolean).join(' / ')}`);
  }
  if (footerLine) textParts.push('', footerLine);

  return { subject, html, text: textParts.join('\n') };
}
