// =============================================================================
//  /api/_lib/destinations/email.js
// =============================================================================
//
//  Sends the AGENT notification email when a new lead lands.
//  Delivered via SendGrid (existing platform integration).
//
//  Uses the routing config's custom HTML template if set, otherwise the
//  built-in default. {token} placeholders are replaced at send time.
//
//  The email is branded as "Travelgenix Notifications" — agents receive
//  these as system notifications. Reply-To is set to the lead's email
//  so hitting Reply goes straight to the visitor.
//
// =============================================================================

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const SENDGRID_API = 'https://api.sendgrid.com/v3/mail/send';
const FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL || 'notifications@travelgenix.io';
const FROM_NAME = 'Travelgenix Notifications';

const BOARD_BASIS_LABEL = {
  RO: 'Room only', BB: 'B&B', HB: 'Half board', FB: 'Full board', AI: 'All inclusive',
};

function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isValidEmail(s) {
  return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim()) && s.length <= 254;
}

// ── Token map for template substitution ─────────────────────────────────

function buildTokens(lead) {
  const t = lead.travel;
  const c = lead.contact;
  return {
    leadId: lead.leadId,
    receivedAt: new Date(lead.receivedAt).toUTCString(),
    sourceWidget: lead.source.widget,
    sourceUrl: lead.source.sourceUrl,
    referrer: lead.source.referrer || '—',
    firstName: c.firstName || '—',
    lastName: c.lastName || '—',
    fullName: c.fullName || `${c.firstName} ${c.lastName}`.trim() || '—',
    email: c.email,
    phone: c.phone || '—',
    tags: lead.tags.join(', ') || '—',
    destinations: t.destinations.join(', ') || '—',
    departureAirport: t.departureAirport || '—',
    departDate: t.departDate || '—',
    returnDate: t.returnDate || '—',
    durationNights: t.durationNights ?? '—',
    adults: t.adults ?? '—',
    children: t.children ?? 0,
    infants: t.infants ?? 0,
    budgetPP: t.budgetPP != null ? `£${t.budgetPP}` : '—',
    starRating: t.starRating != null ? '★'.repeat(t.starRating) : '—',
    boardBasis: BOARD_BASIS_LABEL[t.boardBasis] || '—',
    interests: t.interests.join(', ') || '—',
    marketingConsent: lead.consent.marketing ? 'Yes' : 'No',
    contactConsent: lead.consent.contact ? 'Yes' : 'No',
    clientName: lead.source.clientName || '—',
  };
}

function applyTokens(html, tokens) {
  return html.replace(/\{(\w+)\}/g, (_, key) => esc(tokens[key] ?? ''));
}

// ── Default template ────────────────────────────────────────────────────

function defaultTemplate(tokens) {
  const rows = [
    ['Source', `${tokens.sourceWidget} — ${tokens.sourceUrl}`],
    ['Received', tokens.receivedAt],
    ['Name', tokens.fullName],
    ['Email', tokens.email],
    ['Phone', tokens.phone],
    ['Tags', tokens.tags],
    ['Destinations', tokens.destinations],
    ['Departure airport', tokens.departureAirport],
    ['Depart date', tokens.departDate],
    ['Return date', tokens.returnDate],
    ['Duration', `${tokens.durationNights} nights`],
    ['Travellers', `${tokens.adults} adults · ${tokens.children} children · ${tokens.infants} infants`],
    ['Budget pp', tokens.budgetPP],
    ['Stars', tokens.starRating],
    ['Board basis', tokens.boardBasis],
    ['Interests', tokens.interests],
    ['Marketing consent', tokens.marketingConsent],
  ].filter(([, v]) => v && v !== '—');

  const tableRows = rows.map(([k, v]) =>
    `<tr><td style="padding:8px 12px;border-bottom:1px solid #E2E8F0;color:#64748B;font-weight:500;width:160px;vertical-align:top">${esc(k)}</td><td style="padding:8px 12px;border-bottom:1px solid #E2E8F0;color:#0F172A">${esc(String(v))}</td></tr>`
  ).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8" /></head>
<body style="margin:0;padding:0;background:#F8FAFC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0F172A">
<table role="presentation" width="100%" style="background:#F8FAFC;padding:24px 0">
<tr><td align="center">
<table role="presentation" width="600" style="max-width:600px;background:#FFFFFF;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,0.06)">
<tr><td style="padding:24px 28px;background:#1B2B5B;color:#FFFFFF">
<div style="font-size:13px;opacity:0.7;letter-spacing:0.04em;text-transform:uppercase">New lead · ${esc(tokens.sourceWidget)}</div>
<div style="font-size:22px;font-weight:700;margin-top:6px">${esc(tokens.fullName)}</div>
<div style="font-size:14px;opacity:0.85;margin-top:4px">${esc(tokens.email)} · ${esc(tokens.phone)}</div>
</td></tr>
<tr><td style="padding:0 28px"><table role="presentation" width="100%" style="border-collapse:collapse;margin:8px 0 16px">${tableRows}</table></td></tr>
<tr><td style="padding:16px 28px 24px;color:#94A3B8;font-size:12px;border-top:1px solid #E2E8F0">
Lead ID: ${esc(tokens.leadId)}<br/>
Sent by Travelgenix on behalf of ${esc(tokens.clientName)}
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

// ── Public dispatcher ───────────────────────────────────────────────────

export async function dispatchEmail(lead, job) {
  if (!SENDGRID_API_KEY) {
    const e = new Error('SENDGRID_API_KEY not configured');
    e.statusCode = 500;
    throw e;
  }

  const to = job.config?.to;
  if (!isValidEmail(to)) {
    const e = new Error('Invalid or missing "to" email in config');
    e.statusCode = 400;
    throw e;
  }

  const tokens = buildTokens(lead);
  const subject = job.config?.subject
    ? applyTokens(job.config.subject, tokens)
    : `New ${lead.source.widget} lead — ${tokens.fullName}`;
  const html = job.config?.templateHtml
    ? applyTokens(job.config.templateHtml, tokens)
    : defaultTemplate(tokens);

  const payload = {
    personalizations: [{ to: [{ email: to }] }],
    from: { email: FROM_EMAIL, name: FROM_NAME },
    reply_to: isValidEmail(lead.contact.email) ? { email: lead.contact.email, name: tokens.fullName } : undefined,
    subject: subject.slice(0, 200),
    content: [{ type: 'text/html', value: html }],
    custom_args: {
      leadId: lead.leadId,
      sourceWidget: lead.source.widget,
    },
  };

  const resp = await fetch(SENDGRID_API, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SENDGRID_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  // SendGrid returns 202 on success with empty body
  if (resp.status !== 202) {
    const txt = await resp.text().catch(() => '');
    const e = new Error(`SendGrid ${resp.status}: ${txt.slice(0, 200)}`);
    e.statusCode = resp.status;
    throw e;
  }

  return {
    statusCode: resp.status,
    requestPayload: { to, subject: subject.slice(0, 200) },
    responseBody: 'sent',
  };
}
