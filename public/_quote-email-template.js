// =============================================================================
//  /public/_quote-email-template.js — shared server + editor module
// =============================================================================
//
//  The email that carries a client's quote PDF to their customer.
//
//  Until Sep 2026 this was the least designed customer-facing email in the
//  suite, sitting next to the best-designed document we produce: three
//  unstyled <p> tags, no branding, no colour, no logo, hardcoded on the server
//  and invisible to the client. The PDF attached to it already carried their
//  full brand kit — logo, tagline, six colours, contact details — and the
//  covering email used none of it.
//
//  It now renders from the SAME brand kit as the PDF, so the email and the
//  document arrive looking like one piece of work, and a client can write
//  their own subject and message with a live preview.
//
//  Lives in public/ so it is BOTH the server renderer (imported by
//  api/quote-pdf.js) and the preview inside the Quote PDF editor. Keep it
//  dependency-free and runtime-neutral: no Node imports, no DOM, no Buffer.
// =============================================================================

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

const DEFAULTS = {
  topBar: '#111D3E',
  hero: '#1B2B5B',
  accent: '#00B4D8',
  text: '#0F172A',
};

export function escapeHtml(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const hex = (v, fallback) => (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(String(v || '').trim()) ? String(v).trim() : fallback);
const httpsOnly = (v) => (/^https:\/\/[^\s]+$/i.test(String(v || '').trim()) ? String(v).trim() : '');

/** The same brand shape the PDF renderer consumes, defaulted the same way. */
function resolveBrand(brand) {
  const b = (brand && typeof brand === 'object') ? brand : {};
  const c = (b.colors && typeof b.colors === 'object') ? b.colors : {};
  // Contact details are hidden across the PDF when showContact is off; the
  // covering email must respect the same switch or it leaks what the document
  // deliberately withholds.
  const showContact = b.showContact !== false;
  return {
    name: String(b.name || '').trim() || 'Your travel team',
    tagline: String(b.tagline || '').trim(),
    logoUrl: httpsOnly(b.logoUrl),
    supportEmail: showContact ? String(b.supportEmail || '').trim() : '',
    supportPhone: showContact ? String(b.supportPhone || '').trim() : '',
    topBar: hex(c.topBar, DEFAULTS.topBar),
    hero: hex(c.hero, DEFAULTS.hero),
    accent: hex(c.accent, DEFAULTS.accent),
    text: hex(c.text, DEFAULTS.text),
  };
}

/** Merge tags a client can use in their subject and message. */
export const QUOTE_EMAIL_TAGS = [
  { tag: '{firstName}', label: 'First name' },
  { tag: '{quoteTitle}', label: 'Quote title' },
  { tag: '{company}', label: 'Your company' },
];

function buildTags(brand, quoteTitle, leadName) {
  const first = String(leadName || '').trim().split(/\s+/)[0] || '';
  return { firstname: first, quotetitle: String(quoteTitle || ''), company: brand.name };
}

function applyTags(text, tags) {
  return String(text == null ? '' : text).replace(/\{\s*([a-zA-Z]+)\s*\}/g, (m, key) => {
    const k = key.toLowerCase();
    return Object.prototype.hasOwnProperty.call(tags, k) ? String(tags[k] == null ? '' : tags[k]) : m;
  });
}

/** Client prose -> escaped paragraphs. Blank lines start new paragraphs. */
function proseToHtml(text, tags, colour) {
  return String(text || '').replace(/\r\n/g, '\n').split(/\n{2,}/)
    .map(b => b.trim()).filter(Boolean)
    .map(b => `<p style="margin:0 0 16px;font-family:${FONT};font-size:15px;line-height:1.65;color:${colour}">${escapeHtml(applyTags(b, tags)).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/** The same prose, as plain text, for the text/plain part. */
function proseToText(text, tags) {
  return String(text || '').replace(/\r\n/g, '\n').split(/\n{2,}/)
    .map(b => applyTags(b.trim(), tags)).filter(Boolean).join('\n\n');
}

/** Only what the editor advertises, bounded. */
export function normaliseQuoteEmail(raw) {
  const t = (raw && typeof raw === 'object') ? raw : {};
  const subject = typeof t.subject === 'string' ? t.subject.trim().slice(0, 200) : '';
  const body = typeof t.body === 'string' ? t.body.trim().slice(0, 4000) : '';
  return (subject || body) ? { subject, body } : {};
}

/**
 * Render the covering email for a quote PDF.
 *
 * @param {object} p
 * @param {object} p.brand           Same brand kit the PDF uses
 * @param {string} p.quoteTitle      The quote's title
 * @param {string} [p.leadName]      Customer's name
 * @param {string} [p.filename]      The attached PDF's filename
 * @param {number} [p.extraCount]    Extra documents attached alongside (T&Cs etc)
 * @param {object} [p.template]      Client's own { subject, body }
 * @returns {{subject: string, html: string, text: string}}
 */
export function renderQuoteEmail(p) {
  const o = p || {};
  const brand = resolveBrand(o.brand);
  const quoteTitle = String(o.quoteTitle || '').trim() || 'your travel quote';
  const leadName = String(o.leadName || '').trim();
  const first = leadName.split(/\s+/)[0] || 'there';
  const filename = String(o.filename || '').trim();
  const extraCount = Number.isFinite(o.extraCount) ? o.extraCount : 0;
  const tags = buildTags(brand, quoteTitle, leadName || 'there');

  const tpl = (o.template && typeof o.template === 'object') ? o.template : {};
  const prose = typeof tpl.body === 'string' ? tpl.body.trim() : '';
  const customSubject = typeof tpl.subject === 'string' ? tpl.subject.trim() : '';

  const defaultBody = [
    `Hi ${first},`,
    `Your quote for ${quoteTitle} is ready, and it is attached to this email as a PDF.`,
    `Have a read through, and if anything needs changing or you have a question about it, just reply to this email and we will sort it.`,
  ];

  const bodyHtml = prose
    ? proseToHtml(prose, tags, brand.text)
    : defaultBody.map(l => `<p style="margin:0 0 16px;font-family:${FONT};font-size:15px;line-height:1.65;color:${brand.text}">${escapeHtml(l)}</p>`).join('');

  const header = brand.logoUrl
    ? `<img src="${escapeHtml(brand.logoUrl)}" alt="${escapeHtml(brand.name)}" height="34" style="display:block;height:34px;max-width:220px;border:0">`
    : `<span style="font-family:${FONT};font-size:17px;font-weight:700;letter-spacing:-0.01em;color:#FFFFFF">${escapeHtml(brand.name)}</span>`;
  const taglineHtml = brand.tagline
    ? `<div style="font-family:${FONT};font-size:12px;color:rgba(255,255,255,0.72);padding-top:5px">${escapeHtml(brand.tagline)}</div>`
    : '';

  // The attachment card: says plainly what arrived, so the customer knows to
  // look for it even in a client that hides attachments below the fold.
  const extraLine = extraCount > 0
    ? `, plus ${extraCount} more document${extraCount === 1 ? '' : 's'}`
    : '';
  const attachmentCard = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:12px">
      <tr>
        <td width="44" valign="top" style="padding:16px 0 16px 18px">
          <div style="width:34px;height:34px;border-radius:8px;background:${brand.accent};text-align:center;line-height:34px;font-family:${FONT};font-size:13px;font-weight:700;color:#FFFFFF">PDF</div>
        </td>
        <td style="padding:16px 18px 16px 12px;font-family:${FONT}">
          <div style="font-size:14.5px;font-weight:600;color:${brand.text}">${escapeHtml(quoteTitle)}</div>
          <div style="font-size:12.5px;color:#64748B;padding-top:3px">Attached to this email${escapeHtml(extraLine)}${filename ? ` &middot; ${escapeHtml(filename)}` : ''}</div>
        </td>
      </tr>
    </table>`;

  const contacts = [];
  if (brand.supportPhone) contacts.push(`<a href="tel:${escapeHtml(String(brand.supportPhone).replace(/[^+\d]/g, ''))}" style="font-family:${FONT};font-size:13px;font-weight:600;color:${brand.hero};text-decoration:none">${escapeHtml(brand.supportPhone)}</a>`);
  if (brand.supportEmail) contacts.push(`<a href="mailto:${escapeHtml(brand.supportEmail)}" style="font-family:${FONT};font-size:13px;font-weight:600;color:${brand.hero};text-decoration:none">${escapeHtml(brand.supportEmail)}</a>`);
  const contactBlock = contacts.length ? `
    <tr><td style="padding:0 32px 26px" align="center">
      <div style="font-family:${FONT};font-size:13px;color:#64748B;padding-bottom:8px">Prefer to talk it through?</div>
      <div>${contacts.join('&nbsp;&nbsp;&middot;&nbsp;&nbsp;')}</div>
    </td></tr>` : '';

  const subject = customSubject
    ? (applyTags(customSubject, tags).slice(0, 200).trim() || `Your quote: ${quoteTitle}`)
    : `Your quote: ${quoteTitle}`;

  const preheader = `Your quote for ${quoteTitle} is attached as a PDF.`;

  const html = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#F1F5F9">
<span style="display:none;font-size:1px;color:#F1F5F9;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden">${escapeHtml(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F5F9"><tr><td align="center" style="padding:32px 12px">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#FFFFFF;border-radius:14px;overflow:hidden">
    <tr><td style="background:${brand.topBar};padding:20px 32px">${header}${taglineHtml}</td></tr>
    <tr><td style="height:4px;background:${brand.accent};font-size:0;line-height:0">&nbsp;</td></tr>
    <tr><td style="padding:32px 32px 8px">
      <h1 style="margin:0 0 18px;font-family:${FONT};font-size:23px;font-weight:700;line-height:1.25;letter-spacing:-0.02em;color:${brand.hero}">Your quote is ready</h1>
      ${bodyHtml}
    </td></tr>
    <tr><td style="padding:6px 32px 26px">${attachmentCard}</td></tr>
    ${contactBlock}
    <tr><td align="center" style="padding:18px 32px 24px;border-top:1px solid #F1F5F9">
      <div style="font-family:${FONT};font-size:11px;line-height:1.6;color:#94A3B8">Sent by ${escapeHtml(brand.name)}.</div>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;

  const textParts = [
    prose ? proseToText(prose, tags) : defaultBody.join('\n\n'),
    '',
    `Attached: ${quoteTitle}${filename ? ` (${filename})` : ''}${extraLine}`,
  ];
  if (brand.supportPhone || brand.supportEmail) {
    textParts.push('', `Prefer to talk it through? ${[brand.supportPhone, brand.supportEmail].filter(Boolean).join(' / ')}`);
  }
  textParts.push('', `Sent by ${brand.name}.`);

  return { subject, html, text: textParts.join('\n') };
}
