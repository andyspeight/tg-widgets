// =============================================================================
//  /public/_welcome-email-template.js — shared server + editor module
// =============================================================================
//
//  The WELCOME email sent to someone who signs up through the Newsletter
//  Signup or Popup widget (and any other widget routed through the shared lead
//  router's auto-reply destination).
//
//  Lives in public/ so it is BOTH the server renderer (imported by
//  api/_lib/destinations/auto-reply.js) and the live preview inside the
//  Newsletter and Popup editors. One module, so the wording a client writes in
//  the editor is exactly what their subscriber receives. Before this, a client
//  filled in five copy fields completely blind.
//
//  Every default lives here rather than in the sender, so "leave it blank"
//  previews the real fallback rather than an editor's guess at it.
//
//  Keep it dependency-free and runtime-neutral: no Node imports, no DOM access.
// =============================================================================

const DEFAULT_FROM_NAME = 'Travelgenix';

// Brand palette (email-design skill): navy + teal + neutrals only.
const NAVY = '#1B2B5B';
const TEAL = '#00B4D8';
const INK = '#0F172A';
const MUTED = '#64748B';
const HAIRLINE = '#E2E8F0';
const BG = '#F8FAFC';

function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isValidUrl(s) {
  if (typeof s !== 'string') return false;
  try {
    const u = new URL(s.trim());
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch { return false; }
}

// ── Tokens available in the configurable subject/body ────────────────────
// Kept deliberately small — a welcome email shouldn't leak enquiry detail.
function buildTokens(lead, fromName) {
  const c = lead.contact || {};
  const first = (c.firstName || '').trim();
  return {
    firstName: first || 'there',
    fromName: fromName || DEFAULT_FROM_NAME,
  };
}

function applyTokens(str, tokens) {
  return String(str).replace(/\{(\w+)\}/g, (_, key) =>
    Object.prototype.hasOwnProperty.call(tokens, key) ? tokens[key] : ''
  );
}

// ── Default welcome copy (brand voice: warm, conversational, no em dashes,
//    no Oxford comma, no AI filler) ─────────────────────────────────────
function defaultBody(tokens) {
  // Plain lines — rendered into the template as paragraphs. Editable copy lives
  // here so the default reads like a person wrote it.
  return [
    `Hi ${tokens.firstName},`,
    `Thanks for signing up. You are on the list, and that is genuinely good news for your inbox.`,
    `From here you can expect hand-picked destinations, the odd exclusive offer, and a bit of travel inspiration when we spot something worth sharing. No spam, no daily pestering, just the good stuff.`,
    `Talk soon,`,
    `The ${tokens.fromName} team`,
  ];
}

// Render an array of paragraph strings (or a single string with newlines) into
// safe HTML paragraphs.
function bodyToHtml(body, tokens) {
  let lines;
  if (Array.isArray(body)) lines = body;
  else lines = String(body).split(/\n{1,}/);
  return lines
    .map(l => applyTokens(l, tokens).trim())
    .filter(Boolean)
    .map(l => `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:${INK}">${esc(l)}</p>`)
    .join('');
}

function welcomeTemplate({ headline, bodyHtml, ctaLabel, ctaUrl, fromName }) {
  const cta = (ctaLabel && isValidUrl(ctaUrl))
    ? `<tr><td style="padding:8px 0 8px">
         <a href="${esc(ctaUrl)}" style="display:inline-block;background:${TEAL};color:#06283D;text-decoration:none;font-weight:700;font-size:15px;padding:13px 26px;border-radius:10px">${esc(ctaLabel)}</a>
       </td></tr>`
    : '';

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="color-scheme" content="light" />
<title>${esc(headline)}</title></head>
<body style="margin:0;padding:0;background:${BG};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${INK}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">You are on the list. Here is what to expect.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BG};padding:24px 12px">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#FFFFFF;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,0.07)">
  <tr><td style="height:6px;background:${TEAL};line-height:6px;font-size:6px">&nbsp;</td></tr>
  <tr><td style="padding:34px 36px 8px">
    <div style="font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${TEAL}">Welcome aboard</div>
    <h1 style="margin:10px 0 18px;font-size:26px;line-height:1.25;font-weight:800;color:${NAVY}">${esc(headline)}</h1>
  </td></tr>
  <tr><td style="padding:0 36px 8px">${bodyHtml}</td></tr>
  ${cta ? `<tr><td style="padding:8px 36px 8px"><table role="presentation" cellpadding="0" cellspacing="0" border="0">${cta}</table></td></tr>` : ''}
  <tr><td style="padding:24px 36px 30px;border-top:1px solid ${HAIRLINE};color:${MUTED};font-size:12px;line-height:1.6;margin-top:16px">
    Sent by ${esc(fromName)}. You are receiving this because you signed up on our website.
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

/**
 * Render the welcome email exactly as the sender would.
 *
 * @param {object} config  The widget's auto-reply config: { fromName, subject,
 *                         headline, body, ctaLabel, ctaUrl }. Any blank field
 *                         falls back to our default.
 * @param {object} lead    { contact: { firstName } } — the subscriber.
 * @returns {{subject: string, html: string, fromName: string}}
 */
export function renderWelcomeEmail(config, lead) {
  const cfg = config || {};
  const fromName = (typeof cfg.fromName === 'string' && cfg.fromName.trim())
    ? cfg.fromName.trim().slice(0, 80)
    : DEFAULT_FROM_NAME;

  const tokens = buildTokens(lead || {}, fromName);

  const subject = (typeof cfg.subject === 'string' && cfg.subject.trim())
    ? applyTokens(cfg.subject, tokens).slice(0, 200)
    : `You are in. Welcome to ${fromName}.`;

  const headline = (typeof cfg.headline === 'string' && cfg.headline.trim())
    ? applyTokens(cfg.headline, tokens).slice(0, 120)
    : 'You are on the list';

  // Body: prefer the client's message, else our default copy.
  const bodySource = (typeof cfg.body === 'string' && cfg.body.trim())
    ? cfg.body
    : defaultBody(tokens);

  const html = welcomeTemplate({
    headline,
    bodyHtml: bodyToHtml(bodySource, tokens),
    ctaLabel: typeof cfg.ctaLabel === 'string' ? cfg.ctaLabel.trim().slice(0, 40) : '',
    ctaUrl: typeof cfg.ctaUrl === 'string' ? cfg.ctaUrl.trim() : '',
    fromName,
  });

  return { subject, html, fromName };
}

/** True when a Button link would actually render a button. */
export function welcomeCtaIsUsable(ctaLabel, ctaUrl) {
  return !!(ctaLabel && String(ctaLabel).trim() && isValidUrl(ctaUrl));
}
