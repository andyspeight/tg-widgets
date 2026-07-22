/**
 * Payment reminder email — renderer (phase 2).
 *
 * Turns a fetched Travelify order + the client agency's branding into the
 * balance reminder email the customer receives. Archetype D (transactional)
 * from the Travelgenix email design system: calm, scannable, one primary
 * action, agency-branded (the agency's name is the sender, Travelgenix is
 * invisible). Built with the bulletproof patterns (tables, VML button,
 * bgcolor fallbacks, inline styles) so it renders correctly in Outlook
 * desktop as well as Apple Mail and Gmail.
 *
 * The ONE action: "Pay my balance", linking to the client's booking page
 * with the #tg-pay deep link (widget-mybooking.js v1.11.0+ reads it,
 * prefills the booking reference and opens the payment card after
 * retrieval). When the agency has no booking page URL configured, the email
 * degrades to a contact-first layout with no dead button.
 *
 * All amounts come from decideCharge() over the freshly fetched order (the
 * same engine the widget and /api/pay-balance use), never from the pushed
 * notification alone, so a customer who already paid is never chased.
 */

const FONT = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif";

const C = {
  navy: '#1b2b5b',
  teal: '#00b4d8',
  textPrimary: '#0f172a',
  textSecondary: '#475569',
  textTertiary: '#94a3b8',
  bgSecondary: '#f8fafc',
  border: '#e2e8f0',
  amberBg: '#fef3c7',
  amberText: '#b45309',
};

export function escHtml(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function formatMoney(amount, currency) {
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: currency || 'GBP' }).format(amount);
  } catch {
    return `${currency || 'GBP'} ${Number(amount).toFixed(2)}`;
  }
}

/** "Friday 15 August 2026" from an ISO date, or '' when unparseable. */
export function formatLongDate(iso) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return '';
  const d = new Date(iso.slice(0, 10) + 'T12:00:00Z');
  if (Number.isNaN(d.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
      .format(d).replace(/,/g, '');
  } catch {
    return iso.slice(0, 10);
  }
}

function costRow(label, value, { bold = false, topBorder = false } = {}) {
  const weight = bold ? 700 : 500;
  const colour = bold ? C.textPrimary : C.textSecondary;
  const size = bold ? 16 : 14;
  const border = topBorder ? `border-top:1px solid ${C.border};` : '';
  return `
    <tr>
      <td style="padding:${topBorder ? 14 : 8}px 0 ${bold ? 4 : 8}px;${border}font-family:${FONT};font-size:${size}px;font-weight:${weight};color:${colour};">${escHtml(label)}</td>
      <td align="right" style="padding:${topBorder ? 14 : 8}px 0 ${bold ? 4 : 8}px;${border}font-family:${FONT};font-size:${size}px;font-weight:${bold ? 800 : 600};color:${colour};">${escHtml(value)}</td>
    </tr>`;
}

/** §12.2 P2 — bulletproof CTA that renders as a button in Outlook too. */
function bulletproofButton(url, label) {
  const u = escHtml(url);
  const l = escHtml(label);
  return `
    <table border="0" cellspacing="0" cellpadding="0" style="margin:0 auto;">
      <tr>
        <td align="center" bgcolor="${C.teal}" style="border-radius:10px;">
          <!--[if mso]>
            <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"
              href="${u}" style="height:48px;v-text-anchor:middle;width:240px;" arcsize="20%" stroke="f" fillcolor="${C.teal}">
              <w:anchorlock/>
              <center style="color:${C.textPrimary};font-family:'Segoe UI',Arial,sans-serif;font-size:15px;font-weight:bold;">${l}</center>
            </v:roundrect>
          <![endif]-->
          <!--[if !mso]><!-- -->
            <a href="${u}" style="display:inline-block;padding:14px 32px;background:${C.teal};color:${C.textPrimary};text-decoration:none;border-radius:10px;font-family:${FONT};font-size:15px;font-weight:700;letter-spacing:-0.005em;">${l}</a>
          <!--<![endif]-->
        </td>
      </tr>
    </table>`;
}

function step(num, title, body) {
  return `
    <tr>
      <td width="36" valign="top" style="padding:12px 0;">
        <table border="0" cellspacing="0" cellpadding="0"><tr>
          <td width="24" height="24" align="center" bgcolor="#f1f5f9" style="border-radius:12px;font-family:${FONT};font-size:11px;font-weight:700;color:${C.navy};">${num}</td>
        </tr></table>
      </td>
      <td valign="top" style="padding:12px 0;font-family:${FONT};">
        <div style="font-size:14px;font-weight:600;color:${C.textPrimary};letter-spacing:-0.01em;">${title}</div>
        <div style="font-size:13px;line-height:1.55;color:${C.textSecondary};padding-top:3px;">${body}</div>
      </td>
    </tr>`;
}

/**
 * Render the balance reminder.
 *
 * @param {object} p
 * @param {{name: string, logoUrl?: string, footerLine?: string, supportEmail?: string, supportPhone?: string}} p.agency
 * @param {string} [p.customerFirstName]
 * @param {string|null} p.orderRef        Human booking reference, when known
 * @param {{amount: number, currency: string, total?: number, paid?: number, outstanding: number, isInstalment?: boolean, remainingAmount?: number}} p.charge
 * @param {string} [p.dueDateIso]         YYYY-MM-DD
 * @param {string|null} p.payUrl          Booking page URL with the #tg-pay deep link, or null
 * @returns {{subject: string, preheader: string, html: string}}
 */
export function renderReminderEmail({ agency, customerFirstName, orderRef, charge, dueDateIso, payUrl }) {
  const name = (agency && agency.name) || 'Your travel team';
  const money = formatMoney(charge.amount, charge.currency);
  const dueLong = formatLongDate(dueDateIso);
  const dueBy = dueLong ? ` by ${dueLong}` : '';
  const first = typeof customerFirstName === 'string' && customerFirstName.trim()
    ? customerFirstName.trim() : '';

  const subject = `Your balance of ${money} is due`;
  const preheader = `A reminder from ${name}: ${money} is due${dueBy}${orderRef ? ` on booking ${orderRef}` : ''}. Paying online is secure and takes a couple of minutes.`;

  const headline = first ? `Hello ${escHtml(first)}, your balance is due.` : 'Your balance is due.';
  const introRef = orderRef ? ` on your booking <strong style="color:${C.textPrimary};">${escHtml(orderRef)}</strong>` : ' on your booking';
  const intro = payUrl
    ? `This is a friendly reminder from ${escHtml(name)} that a payment${introRef} is due${escHtml(dueBy)}. Paying online is secure and takes a couple of minutes.`
    : `This is a friendly reminder from ${escHtml(name)} that a payment${introRef} is due${escHtml(dueBy)}. Get in touch using the details below and we will help you settle it.`;

  // Cost card rows — only rows we genuinely know.
  let rows = '';
  if (Number.isFinite(charge.total) && charge.total > 0) rows += costRow('Total holiday cost', formatMoney(charge.total, charge.currency));
  if (Number.isFinite(charge.paid) && charge.paid > 0) rows += costRow('Paid so far', formatMoney(charge.paid, charge.currency));
  rows += costRow(charge.isInstalment ? 'Due now' : 'Balance due', money, { bold: true, topBorder: rows !== '' });
  if (dueLong) rows += costRow('Due by', dueLong);

  const instalmentNote = (charge.isInstalment && Number.isFinite(charge.remainingAmount) && charge.remainingAmount > 0)
    ? `<tr><td colspan="2" style="padding:10px 0 2px;font-family:${FONT};font-size:12px;line-height:1.55;color:${C.textSecondary};">You can pay ${escHtml(money)} now and the remaining ${escHtml(formatMoney(charge.remainingAmount, charge.currency))} in later instalments, or settle the full balance in one go.</td></tr>`
    : '';

  const logo = agency && agency.logoUrl
    ? `<img src="${escHtml(agency.logoUrl)}" alt="${escHtml(name)}" height="32" style="display:block;height:32px;max-width:220px;border:0;">`
    : `<span style="font-family:${FONT};font-size:15px;font-weight:700;letter-spacing:-0.01em;color:${C.textPrimary};">${escHtml(name)}</span>`;

  const refCell = orderRef
    ? `<td align="right" style="font-family:${FONT};font-size:11px;color:${C.textTertiary};">Booking ref&nbsp;&middot;&nbsp;<span style="color:${C.textPrimary};font-weight:600;">${escHtml(orderRef)}</span></td>`
    : '<td></td>';

  const ctaBlock = payUrl ? `
    <tr><td style="padding:8px 32px 8px;">${bulletproofButton(payUrl, 'Pay my balance')}</td></tr>
    <tr><td align="center" style="padding:0 32px 28px;font-family:${FONT};font-size:12px;color:${C.textTertiary};">The secure payment page opens on our website.</td></tr>` : '';

  const refStep = orderRef
    ? `your booking reference <strong style="color:${C.textPrimary};">${escHtml(orderRef)}</strong>`
    : 'your booking reference (you will find it on your booking confirmation)';
  const howTo = payUrl ? `
    <tr><td style="padding:4px 32px 24px;">
      <table border="0" cellspacing="0" cellpadding="0" width="100%">
        <tr><td colspan="2" style="font-family:${FONT};font-size:16px;font-weight:700;letter-spacing:-0.015em;color:${C.textPrimary};padding-bottom:4px;">Paying online takes a couple of minutes</td></tr>
        ${step(1, 'Open your booking', 'The button above takes you straight to our secure booking page.')}
        ${step(2, 'Find your booking', `Enter the lead traveller&#39;s email address, your departure date and ${refStep}.`)}
        ${step(3, 'Choose Pay balance', 'Your booking appears with the amount ready to pay. Follow the secure payment steps and you are done.')}
      </table>
    </td></tr>` : '';

  const contacts = [];
  if (agency && agency.supportPhone) {
    contacts.push(`<a href="tel:${escHtml(String(agency.supportPhone).replace(/[^+\d]/g, ''))}" style="font-family:${FONT};font-size:13px;font-weight:600;color:${C.navy};text-decoration:none;">${escHtml(agency.supportPhone)}</a>`);
  }
  if (agency && agency.supportEmail) {
    contacts.push(`<a href="mailto:${escHtml(agency.supportEmail)}" style="font-family:${FONT};font-size:13px;font-weight:600;color:${C.navy};text-decoration:none;">${escHtml(agency.supportEmail)}</a>`);
  }
  const helpBlock = `
    <tr><td bgcolor="${C.bgSecondary}" style="padding:26px 32px;border-top:1px solid ${C.border};" align="center">
      <div style="font-family:${FONT};font-size:14px;font-weight:600;color:${C.textPrimary};">Questions about this payment?</div>
      <div style="font-family:${FONT};font-size:13px;line-height:1.55;color:${C.textSecondary};padding:5px 0 ${contacts.length ? 12 : 0}px;">${payUrl ? 'If anything looks wrong, or you would rather pay another way, just get in touch.' : 'We are happy to take your payment over the phone or send you a secure link.'}</div>
      ${contacts.length ? `<div>${contacts.join('&nbsp;&nbsp;&middot;&nbsp;&nbsp;')}</div>` : ''}
    </td></tr>`;

  const footerLine = agency && agency.footerLine
    ? `${escHtml(agency.footerLine)}<br>` : '';

  const html = `<!DOCTYPE html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light">
<title>${escHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;">
  <span style="display:none;font-size:1px;color:#f1f5f9;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escHtml(preheader)}</span>
  <table border="0" cellspacing="0" cellpadding="0" width="100%" bgcolor="#f1f5f9">
    <tr><td align="center" style="padding:32px 12px;">
      <table border="0" cellspacing="0" cellpadding="0" width="600" style="width:600px;max-width:100%;background:#ffffff;border-radius:12px;">

        <!-- Top bar -->
        <tr><td style="padding:20px 32px;border-bottom:1px solid ${C.border};">
          <table border="0" cellspacing="0" cellpadding="0" width="100%"><tr>
            <td>${logo}</td>
            ${refCell}
          </tr></table>
        </td></tr>

        <!-- Reminder block -->
        <tr><td style="padding:40px 32px 24px;">
          <table border="0" cellspacing="0" cellpadding="0"><tr>
            <td width="48" height="48" align="center" bgcolor="${C.amberBg}" style="border-radius:12px;font-size:22px;line-height:48px;" aria-hidden="true">&#9200;</td>
          </tr></table>
          <div style="font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${C.amberText};padding:20px 0 8px;">Payment reminder</div>
          <div style="font-family:${FONT};font-size:26px;font-weight:700;line-height:1.2;letter-spacing:-0.025em;color:${C.textPrimary};">${headline}</div>
          <div style="font-family:${FONT};font-size:15px;line-height:1.6;color:${C.textSecondary};padding-top:12px;">${intro}</div>
        </td></tr>

        <!-- Cost card -->
        <tr><td style="padding:0 32px 28px;">
          <table border="0" cellspacing="0" cellpadding="0" width="100%" bgcolor="${C.bgSecondary}" style="border-radius:12px;">
            <tr><td style="padding:18px 24px 14px;">
              <table border="0" cellspacing="0" cellpadding="0" width="100%">
                ${rows}
                ${instalmentNote}
              </table>
            </td></tr>
          </table>
        </td></tr>

        ${ctaBlock}
        ${howTo}
        ${helpBlock}

        <!-- Footer meta -->
        <tr><td align="center" style="padding:20px 32px 26px;border-top:1px solid #f1f5f9;">
          <div style="font-family:${FONT};font-size:11px;line-height:1.6;color:${C.textTertiary};">
            ${footerLine}
            You are receiving this email because you have a booking with ${escHtml(name)}.${orderRef ? ` Booking reference ${escHtml(orderRef)}.` : ''}
          </div>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject, preheader, html };
}
