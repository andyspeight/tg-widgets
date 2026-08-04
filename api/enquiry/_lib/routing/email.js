// =============================================================================
//  /api/enquiry/_lib/routing/email.js
// =============================================================================
//
//  Sends the AGENT notification email when a new submission lands.
//  ALWAYS enabled — this is the required routing destination.
//
//  Delivered via SendGrid (https://sendgrid.com) — chosen because the client
//  already had a verified SendGrid account for other Agendas Group products.
//
//  Uses the form's custom HTML template if set, otherwise the built-in
//  default below. {token} placeholders in the HTML are replaced at send time.
//
//  The agent email is branded with the CLIENT's business name (the form's
//  Client Name field, stamped from the account) — Andy's call 20 Jul 2026:
//  every form email carries the client's brand, never "Travelgenix". The
//  verified sender ADDRESS stays on our authenticated domain; only the
//  display name changes. Reply-To is set to the visitor's email so hitting
//  Reply in the mail client goes straight to the customer.
//
// =============================================================================

import { renderDefaultAgentEmail } from './_templates/agent-email.js';
import { sendViaSendGrid, resolveFromIdentity } from './sendgrid.js';

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

  // Destinations — render rich labels when available ("Hersonissos, Crete,
  // Greece") falling back to just the name for legacy / free-text entries.
  const destParts = (f.destinations || []).map(d => {
    if (!d || !d.name) return '';
    const extras = [];
    if (d.parentCity && d.parentCity !== d.name) extras.push(d.parentCity);
    if (d.parentCountry) extras.push(d.parentCountry);
    return extras.length > 0 ? `${d.name} (${extras.join(', ')})` : d.name;
  }).filter(Boolean);
  const destNames = destParts.join(' + ') || '—';

  // Airport — array from multi-select or scalar from legacy
  const airportStr = Array.isArray(f.departure_airport)
    ? (f.departure_airport.length > 0 ? f.departure_airport.join(', ') : '—')
    : (f.departure_airport || '—');

  const travellerParts = [];
  if (travellers.adults)   travellerParts.push(`${travellers.adults} ${travellers.adults === 1 ? 'adult' : 'adults'}`);
  if (travellers.children) {
    // Child ages materially change a quote, so surface them next to the count
    // rather than dropping them (they were captured but never shown before).
    const ages = Array.isArray(travellers.childAges) && travellers.childAges.length
      ? ` (ages ${travellers.childAges.join(', ')})` : '';
    travellerParts.push(`${travellers.children} ${travellers.children === 1 ? 'child' : 'children'}${ages}`);
  }
  if (travellers.infants)  travellerParts.push(`${travellers.infants} ${travellers.infants === 1 ? 'infant' : 'infants'}`);

  // Rooms — only meaningful above the default of one.
  const roomsStr = (typeof travellers.rooms === 'number' && travellers.rooms > 1) ? `${travellers.rooms} rooms` : '';

  const durationStr = duration.custom
    ? duration.custom
    : duration.nights ? `${duration.nights} nights` : '—';

  // Dates — a firm depart date, else "Flexible" when the visitor said so, rather
  // than a bare dash that reads as missing data. A month preference, when given,
  // lands in the notes.
  const datesStr = dates.depart
    ? (dates.return ? `${dates.depart} → ${dates.return}` : dates.depart) + (dates.flexible ? ' (flexible)' : '')
    : (dates.flexible ? 'Flexible' : '—');

  const budgetStr = typeof f.budget_pp === 'number'
    ? `£${f.budget_pp.toLocaleString('en-GB')} per person`
    : '—';

  // Flights (Enquiry Pro) — whether the customer wants flights in the quote. This
  // was captured but shown NOWHERE in the email, so agents missed it entirely.
  const flightsStr = f.flights_included === true ? 'Included'
    : f.flights_included === false ? 'Not required' : '';

  // Style — stars and/or board, cleanly joined so an absent value never prints a
  // lone "—" (the old template rendered "— · —").
  const styleParts = [];
  if (f.stars) styleParts.push(`${f.stars}-star`);
  if (f.board) styleParts.push(BOARD_BASIS_LABEL[f.board] || f.board);
  const styleStr = styleParts.join(' · ');

  // Marketing consent — so the agent knows whether they may add this customer to
  // marketing. Contact consent is implied by the submission itself.
  const marketingStr = f.marketing_consent === true ? 'Opted in'
    : f.marketing_consent === false ? 'Not opted in' : '';

  // How the customer would like to be contacted (contact-preference field).
  const contactPrefStr = Array.isArray(f.contact_preference)
    ? f.contact_preference.filter((x) => typeof x === 'string' && x).join(', ')
    : '';

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
    departureAirport: airportStr,
    dates: datesStr,
    duration: durationStr,
    travellers: travellerParts.join(', ') || '—',
    budget: budgetStr,
    stars: f.stars ? `${f.stars}-star` : '—',
    boardBasis: f.board ? (BOARD_BASIS_LABEL[f.board] || f.board) : '—',
    style: styleStr,
    rooms: roomsStr,
    flightsIncluded: flightsStr,
    contactPreference: contactPrefStr,
    marketingConsent: marketingStr,
    interests: (f.interests || []).join(', ') || '—',
    notes: f.notes || '—',
    submittedAt: new Date().toLocaleString('en-GB', { timeZone: 'Europe/London' }),
    sourceUrl: payload.sourceUrl || '',
    // The agent's OWN enquiry inbox (behind their client login), never the raw
    // internal Airtable base. Linking to Airtable meant every notified client
    // hit an access wall and could "request access" to our shared enquiries
    // base — which holds EVERY client's enquiries (the 23 Jul 2026 report). The
    // inbox reads submissions owner-scoped, so a client only ever sees theirs.
    submissionUrl: `https://id.travelify.io/inbox-enquiry?id=${encodeURIComponent(submissionId)}`,
  };
}

/**
 * Simple {token} replacement. HTML-escapes values to prevent injection when
 * an agent's custom template mixes visitor data with HTML.
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
 * Accepts comma, semicolon or newline separated values.
 */
function parseRecipients(raw) {
  if (!raw || typeof raw !== 'string') return [];
  return raw
    .split(/[\n,;]/)
    .map(s => s.trim())
    // Accept "Name <email>" entries — agents paste these from mail clients,
    // and silently dropping them used to kill their notifications entirely.
    .map(s => { const m = /<([^<>@\s]+@[^<>@\s]+\.[^<>@\s]+)>/.exec(s); return m ? m[1] : s; })
    .filter(s => s.length > 0 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s))
    .slice(0, 10); // cap at 10 recipients
}

// ---------- Public interface -------------------------------------------------

export default async function sendAgentEmail(ctx) {
  const { form, payload, reference, submissionId, meta } = ctx;

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

  // From identity is the client's own brand: their business name always, and
  // their own ADDRESS (the form owner's email) when their domain is
  // authenticated in SendGrid — platform sender otherwise.
  const agentBrandName = form.fields.fldrw1eTFYCFIo0pp || ''; // Client Name
  const ownerEmail = form.fields.fldLzWF0XnEXeZYH1 || ''; // Owner Email

  return await sendViaSendGrid({
    from: await resolveFromIdentity(agentBrandName, ownerEmail),
    to: recipients,
    subject,
    html,
    replyTo: tokens.email || undefined,
    headers: {
      'X-TG-Reference': reference,
      'X-TG-Submission-Id': submissionId,
    },
    // custom_args are what SendGrid surfaces back on Event Webhook payloads,
    // so the webhook can match delivery/open/bounce events to this submission.
    // The X- headers above are for the recipient mail client; custom_args are
    // internal metadata for our own webhook.
    customArgs: {
      submissionId,
      reference,
      emailKind: 'agent-notification',
    },
    categoryTag: 'enquiry-agent-notification',
  });
}
