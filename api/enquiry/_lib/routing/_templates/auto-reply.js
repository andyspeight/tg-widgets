// =============================================================================
//  /api/enquiry/_lib/routing/auto-reply.js
// =============================================================================
//
//  Sends a branded confirmation email to the visitor who just submitted
//  the form. Only runs if the form has Routing Email Auto Reply enabled.
//
//  Branded with the CLIENT's colours (buttonColour / accentColour from the
//  form config), not Travelgenix's. Travelgenix appears as a small footer
//  credit. This is the visitor's communication with the travel agency.
//
//  Reply-to is set to the agent's notification email (first recipient)
//  so if the visitor replies, it reaches the agent directly.
//
// =============================================================================

import { renderDefaultAutoReplyEmail } from './_templates/auto-reply-email.js';

const RESEND_API_KEY  = process.env.RESEND_API_KEY;
const RESEND_FROM     = process.env.RESEND_FROM || 'Travelgenix Enquiries <enquiries@enquiries.tg-widgets.io>';
const RESEND_ENDPOINT = 'https://api.resend.com/emails';

const BOARD_BASIS_LABEL = {
  RO: 'Room only', BB: 'B&B', HB: 'Half board', FB: 'Full board', AI: 'All inclusive',
};

// Form field IDs we need here
const F = {
  formName:          'fldC0MLSyJqg6U1zT',
  clientName:        'fldrw1eTFYCFIo0pp',
  buttonColour:      'fldxyawmdBzNiOb7g',
  accentColour:      'fldD113UMPvDR4zOL',
  routingEmailTo:    'fldlu1HcErBfp2wh2',
  autoReplyHTML:     'fldTocc7Yd5IurXVl',
  thankYouMessage:   'fldiB3PkfcsHRKEWd',
  routingLunaChat:   'fldrnewg30EV3xMzY',
};

/**
 * Build the token map available inside auto-reply HTML templates.
 * Shares most tokens with the agent email, adds client-branding specifics.
 */
function buildTokens({ form, payload, reference, submissionId }) {
  const f = payload.fields;
  const dates = f.travel_dates || {};
  const travellers = f.travellers || { adults: 0 };
  const duration = f.duration || {};

  const destNames = (f.destinations || []).map(d => d.name).join(' + ') || 'your destination';

  const travellerParts = [];
  if (travellers.adults)   travellerParts.push(`${travellers.adults} ${travellers.adults === 1 ? 'adult' : 'adults'}`);
  if (travellers.children) travellerParts.push(`${travellers.children} ${travellers.children === 1 ? 'child' : 'children'}`);
  if (travellers.infants)  travellerParts.push(`${travellers.infants} ${travellers.infants === 1 ? 'infant' : 'infants'}`);

  const durationStr = duration.custom
    ? duration.custom
    : duration.nights ? `${duration.nights} nights` : '';

  const datesStr = dates.depart
    ? (dates.return ? `${dates.depart} to ${dates.return}` : dates.depart) + (dates.flexible ? ' (flexible)' : '')
    : '';

  const budgetStr = typeof f.budget_pp === 'number'
    ? `£${f.budget_pp.toLocaleString('en-GB')} per person`
    : '';

  // Personalised thank-you message from form config (with {firstName} token)
  const thankYouMessage = (form.fields[F.thankYouMessage] || 'Thanks, {firstName} — we\'re on it.')
    .replace(/\{firstName\}/g, f.first_name || '');

  return {
    reference,
    submissionId,
    clientName:  form.fields[F.clientName] || 'your travel specialist',
    firstName:   f.first_name || '',
    lastName:    f.last_name || '',
    fullName:    `${f.first_name || ''} ${f.last_name || ''}`.trim(),
    email:       f.email || '',
    destinations:     destNames,
    departureAirport: f.departure_airport || '',
    dates:       datesStr,
    duration:    durationStr,
    travellers:  travellerParts.join(', '),
    budget:      budgetStr,
    stars:       f.stars ? `${f.stars}-star` : '',
    boardBasis:  f.board ? (BOARD_BASIS_LABEL[f.board] || f.board) : '',
    interests:   (f.interests || []).join(', '),
    thankYouMessage,
    buttonColour: form.fields[F.buttonColour] || '#1B2B5B',
    accentColour: form.fields[F.accentColour] || '#00B4D8',
    lunaChatEnabled: !!form.fields[F.routingLunaChat],
  };
}

/**
 * Token replacement with HTML escaping. Same pattern as agent email.
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
 * Get the first valid agent email from the Routing Email To field.
 * Used as reply-to so the visitor can reply directly to the agent.
 */
function getAgentReplyTo(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const list = raw
    .split(/[\n,;]/)
    .map(s => s.trim())
    .filter(s => s.length > 0 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s));
  return list[0] || null;
}

// ---------- Public interface -------------------------------------------------

export default async function sendAutoReply(ctx) {
  const { form, payload, reference, submissionId } = ctx;

  if (!RESEND_API_KEY) {
    return { status: 'failed', error: 'RESEND_API_KEY not configured' };
  }

  // Visitor's email is the recipient
  const to = payload.fields.email;
  if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
    return { status: 'failed', error: 'Visitor email invalid or missing' };
  }

  const tokens = buildTokens({ form, payload, reference, submissionId });

  // Use custom template if the agent has set one, otherwise the default
  const customHtml = form.fields[F.autoReplyHTML];
  const html = customHtml && customHtml.trim()
    ? renderTemplate(customHtml, tokens)
    : renderDefaultAutoReplyEmail(tokens);

  const subject = `Your enquiry ${reference} — we've got it`;
  const replyTo = getAgentReplyTo(form.fields[F.routingEmailTo]);

  const body = {
    from: RESEND_FROM,
    to: [to],
    subject: subject.slice(0, 200),
    html,
    headers: {
      'X-TG-Reference': reference,
      'X-TG-Submission-Id': submissionId,
    },
  };
  if (replyTo) body.reply_to = replyTo;

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
      console.error('[routing/auto-reply] Resend failed:', response.status, errText.slice(0, 300));
      return {
        status: 'failed',
        statusCode: response.status,
        error: `Resend returned ${response.status}`,
      };
    }

    return { status: 'ok', statusCode: response.status };
  } catch (err) {
    console.error('[routing/auto-reply] Fetch error:', err);
    return { status: 'failed', error: err.message };
  }
}
