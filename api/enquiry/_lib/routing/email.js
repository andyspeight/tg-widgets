// =============================================================================
//  /api/enquiry/_lib/routing/email.js
// =============================================================================
//
//  Sends the agent notification email when a new submission lands.
//  ALWAYS enabled — this is the required routing destination.
//
//  Delivered via Resend (https://resend.com) — chosen for deliverability,
//  branded-domain sending, and simple API.
//
//  Uses the form's custom HTML template if set, otherwise the built-in
//  default below. {token} placeholders in the HTML are replaced at send time.
//
// =============================================================================

import { renderDefaultAgentEmail } from './_templates/agent-email.js';

const RESEND_API_KEY   = process.env.RESEND_API_KEY;
const RESEND_FROM      = process.env.RESEND_FROM || 'Travelgenix Enquiries <enquiries@enquiries.tg-widgets.io>';
const RESEND_ENDPOINT  = 'https://api.resend.com/emails';

const BOARD_BASIS_LABEL = {
  RO: 'Room only', BB: 'B&B', HB: 'Half board', FB: 'Full board', AI: 'All inclusive',
};

/**
 * Build the replaceable token map used inside HTML templates.
 * Agents can use any of these in their custom HTML via {tokenName}.
 */
function buildTokens({ form, payload, reference, submissionId, meta }) {
  const f = payload.fields;
  const dates = f.travel_dates || {};
  const travellers = f.travellers || { adults: 0 };
  const duration = f.duration || {};

  const destNames = (f.destinations || []).map(d => d.name).join(' + ') || '—';
  const travellerParts = [];
  if (travellers.adults)   travellerParts.push(`${travellers.adults} ${travellers.adults === 1 ? 'adult' : 'adults'}`);
  if (travellers.children) travellerParts.push(`${travellers.children} ${travellers.children === 1 ? 'child' : 'children'}`);
  if (travellers.infants)  travellerParts.push(`${travellers.infants} ${travellers.infants === 1 ? 'infant' : 'infants'}`);

  const durationStr = duration.custom
    ? duration.custom
    : duration.nights ? `${duration.nights} nights` : '—';

  const datesStr = dates.depart
    ? (dates.return ? `${dates.depart} → ${dates.return}` : dates.depart) + (dates.flexible ? ' (flexible)' : '')
    : '—';

  const budgetStr = typeof f.budget_pp === 'number'
    ? `£${f.budget_pp.toLocaleString('en-GB')} per person`
    : '—';

  return {
    reference,
    submissionId,
    formName: form.fields.fldC0MLSyJqg6U1zT || 'Enquiry',
    clientName: form.fields.fldrw1eTFYCFIo0pp || '',
    firstName: f.first_name || '',
    lastName: f.last_name || '',
    fullName: `${f.first_name || ''} ${f.last_name || ''}`.trim(),
    email: f.email || '',
    phone: f.phone || '—',
    destinations: destNames,
    departureAirport: f.departure_airport || '—',
    dates: datesStr,
    duration: durationStr,
    travellers: travellerParts.join(', ') || '—',
    budget: budgetStr,
    stars: f.stars ? `${f.stars}-star` : '—',
    boardBasis: f.board ? (BOARD_BASIS_LABEL[f.board] || f.board) : '—',
    interests: (f.interests || []).join(', ') || '—',
    notes: f.notes || '—',
    submittedAt: new Date().toLocaleString('en-GB', { timeZone: 'Europe/London' }),
    sourceUrl: payload.sourceUrl || '',
    submissionUrl: `https://airtable.com/${process.env.TG_ENQUIRIES_AIRTABLE_BASE_ID}/tblxtRPhALFjeMVA6/${submissionId}`,
  };
}

/**
 * Simple {token} replacement. HTML-escapes values to prevent injection when
 * agent's custom template mixes visitor data with HTML.
 */
function renderTemplate(html, tokens) {
  return html.replace(/\{(\w+)\}/g, (_, key) => {
    const value = tokens[key];
    if (value === undefined || value === null) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  });
}

/**
 * Parse recipient list from the form's Routing Email To field.
 * Accepts comma or newline separated values.
 */
function parseRecipients(raw) {
  if (!raw || typeof raw !== 'string') return [];
  return raw
    .split(/[\n,;]/)
    .map(s => s.trim())
    .filter(s => s.length > 0 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s))
    .slice(0, 10); // cap at 10 recipients
}

// ---------- Public interface -------------------------------------------------

export default async function sendAgentEmail(ctx) {
  const { form, payload, reference, submissionId, meta } = ctx;

  if (!RESEND_API_KEY) {
    return { status: 'failed', error: 'RESEND_API_KEY not configured' };
  }

  const recipients = parseRecipients(form.fields.fldlu1HcErBfp2wh2); // Routing Email To
  if (recipients.length === 0) {
    return { status: 'failed', error: 'No valid recipients configured' };
  }

  const tokens = buildTokens({ form, payload, reference, submissionId, meta });

  // Use custom template if present, otherwise the default
  const customHtml = form.fields.fldmboZUbr73kiuyJ; // Routing Email Template HTML
  const html = customHtml && customHtml.trim()
    ? renderTemplate(customHtml, tokens)
    : renderDefaultAgentEmail(tokens);

  const subject = `New enquiry ${reference} — ${tokens.fullName} · ${tokens.destinations}`;

  const body = {
    from: RESEND_FROM,
    to: recipients,
    subject: subject.slice(0, 200),
    html,
    reply_to: tokens.email || undefined,
    headers: {
      'X-TG-Reference': reference,
      'X-TG-Submission-Id': submissionId,
    },
  };

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('[routing/email] Resend failed:', response.status, errText.slice(0, 300));
      return {
        status: 'failed',
        statusCode: response.status,
        error: `Resend returned ${response.status}`,
      };
    }

    return { status: 'ok', statusCode: response.status };
  } catch (err) {
    console.error('[routing/email] Fetch error:', err);
    return { status: 'failed', error: err.message };
  }
}
