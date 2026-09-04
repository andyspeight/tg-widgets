// =============================================================================
//  /api/_lib/destinations/auto-reply.js
// =============================================================================
//
//  Sends a WELCOME / AUTO-REPLY email to the PERSON WHO SIGNED UP.
//
//  This is the opposite recipient to email.js:
//    • email.js        → notifies the AGENT/TEAM (fixed recipient in config)
//    • auto-reply.js   → welcomes the SUBSCRIBER (lead.contact.email)
//
//  Delivered via SendGrid (existing platform integration). Subject and body
//  are configurable per widget; if unset, a warm on-brand default is used.
//
//  SAFETY: this handler will ONLY ever send to the lead's own validated email
//  address. It never reads a recipient from config, so it cannot be pointed at
//  an arbitrary address. If the lead has no valid email, it throws (logged as
//  failed) rather than sending anywhere.
//
// =============================================================================

import { renderWelcomeEmail } from '../../../public/_welcome-email-template.js';

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const SENDGRID_API = 'https://api.sendgrid.com/v3/mail/send';
const FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL || 'notifications@travelgenix.io';
// Welcome emails come "from" the brand, not from "Notifications" — this is a
// customer-facing message, not a system alert.
const DEFAULT_FROM_NAME = 'Travelgenix';

function isValidEmail(s) {
  return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim()) && s.length <= 254;
}

// ── Dispatcher ───────────────────────────────────────────────────────────
export async function dispatchAutoReply(lead, job) {
  if (!SENDGRID_API_KEY) {
    const e = new Error('SENDGRID_API_KEY not configured');
    e.statusCode = 500;
    throw e;
  }

  // HARD SAFETY GATE: only ever send to the subscriber's own validated email.
  const to = lead?.contact?.email;
  if (!isValidEmail(to)) {
    const e = new Error('No valid subscriber email to send welcome to');
    e.statusCode = 400;
    throw e;
  }

  // Compose through the SAME module the Newsletter and Popup editors preview
  // with, so what a client sees while writing is what their subscriber gets.
  // Every default (subject, headline, body, the button rules) lives there.
  const { subject, html, fromName } = renderWelcomeEmail(job.config || {}, lead);

  const payload = {
    personalizations: [{ to: [{ email: to }] }],
    from: { email: FROM_EMAIL, name: fromName },
    subject,
    content: [{ type: 'text/html', value: html }],
    custom_args: {
      leadId: lead.leadId,
      sourceWidget: lead.source.widget,
      kind: 'welcome',
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

  // SendGrid returns 202 on success with an empty body
  if (resp.status !== 202) {
    const txt = await resp.text().catch(() => '');
    const e = new Error(`SendGrid ${resp.status}: ${txt.slice(0, 200)}`);
    e.statusCode = resp.status;
    throw e;
  }

  return {
    statusCode: resp.status,
    requestPayload: { to, subject },
    responseBody: 'sent',
  };
}

export default dispatchAutoReply;
