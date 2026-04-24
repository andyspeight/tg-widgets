// =============================================================================
//  /api/enquiry/_lib/routing/auto-reply.js
// =============================================================================
//
//  Sends a branded confirmation email to the visitor who just submitted
//  the form. Only runs if the form has Routing Email Auto Reply enabled.
//
//  Delivered via SendGrid from noreply@travelify.io (our authenticated domain).
//  The display name is the TRAVEL AGENT's business (e.g. "Travelaire",
//  "EveryHoliday") — pulled from the form's Client Name field. The customer's
//  inbox reads their travel agent's brand, even though the underlying
//  delivery infrastructure is ours. This is the standard pattern for
//  SaaS transactional email — you cannot forge from addresses on domains
//  you don't control, but you can set any display name you like.
//
//  Reply-to is the agent's first notification address so when the customer
//  hits Reply, it goes straight to the agent's inbox.
//
//  Branded with the CLIENT's colours (buttonColour / accentColour from the
//  form config), not Travelgenix's. Travelgenix appears as a small footer
//  credit.
//
// =============================================================================

import { renderDefaultAutoReplyEmail } from './_templates/auto-reply-email.js';
import { sendViaSendGrid, buildFromField } from './sendgrid.js';

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
 */
function buildTokens({ form, payload, reference, submissionId }) {
  const f = payload.fields;
  const dates = f.travel_dates || {};
  const travellers = f.travellers || { adults: 0 };
  const duration = f.duration || {};

  const destNames = (f.destinations || []).map(d => d.name).join(' + ') || '';

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
 * Used as Reply-To so the visitor can reply directly to the agent.
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

  // Build the from display name. Use the travel agent's business name
  // (their Client Name in the form config) so the customer's inbox shows
  // "From: Travelaire" rather than "From: Travelgenix". Falls back to the
  // Travelgenix default inside buildFromField() if Client Name is blank.
  const agentBrandName = form.fields[F.clientName] || '';

  // Reply-To goes to the agent's first notification address so the
  // customer's reply lands with them, not at our no-reply address.
  const replyTo = getAgentReplyTo(form.fields[F.routingEmailTo]);

  return await sendViaSendGrid({
    from: buildFromField(agentBrandName),
    to: [to],
    subject,
    html,
    replyTo: replyTo || undefined,
    headers: {
      'X-TG-Reference': reference,
      'X-TG-Submission-Id': submissionId,
    },
    // See matching comment in email.js — custom_args are what SendGrid
    // surfaces on Event Webhook payloads so we can thread delivery/open/
    // bounce events back to this submission record in Airtable.
    customArgs: {
      submissionId,
      reference,
      emailKind: 'customer-auto-reply',
    },
    categoryTag: 'enquiry-customer-auto-reply',
  });
}
