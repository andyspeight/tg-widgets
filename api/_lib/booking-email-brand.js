/**
 * api/_lib/booking-email-brand.js — whose email is this, and what does it look like
 *
 * The confirmation email's identity comes from the My Booking widget record:
 * the agency name in the from line, the logo above the header, the footer line
 * beneath it, the reply-to, the support contacts and the palette. api/booking-
 * email.js worked all of that out inline, which was fine while it was the only
 * thing that sent one.
 *
 * It is not any more. The staff preview at /api/admin/booking-email-preview
 * renders the same order through the same styles so a real booking can be shown
 * to a prospect without the webhook being wired, and a preview that resolved
 * branding its own way would be a mock-up of an email we never send. So both
 * read it from here.
 *
 * Pure: no network, no Airtable. The caller hands in the widget record's fields
 * and gets back the render inputs. That keeps it trivially testable and keeps
 * the Airtable lookup in the one place each endpoint already does it.
 *
 * 21 Sep 2026.
 */

import { isValidEmail } from './sendgrid.js';

/**
 * The widget's saved configuration.
 *
 * `Config` is the field the editor writes and the live widget reads.
 * `Settings` is a legacy field the widget never writes, so reading it first
 * left emails on Travelgenix defaults — kept only as a fallback for records
 * old enough to have it.
 */
export function readWidgetSettings(fields) {
  const raw = (fields && (fields.Config || fields.Settings)) || null;
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Brand, reply-to and support details for one widget's confirmation email.
 *
 * Returns { brandConfig: { name, logoUrl, footerLine }, replyToAddress,
 *           supportEmail, supportPhone }.
 */
export function buildEmailBrand(fields, widgetSettings) {
  const f = fields || {};
  const s = widgetSettings || {};
  const str = (v) => (v == null ? '' : String(v).trim());

  const fromName = str(f.FromName);
  const fromEmail = str(f.FromEmail).toLowerCase();
  const logoUrl = str(f.LogoUrl);
  const clientName = str(f.ClientName);

  const brandConfig = {
    name: fromName || s?.brand?.name || clientName || 'Travel Team',
    // Only HTTPS logos — an http:// URL renders as a broken image in many mail
    // clients, which block mixed content.
    logoUrl: (logoUrl && /^https:\/\//i.test(logoUrl)) ? logoUrl : '',
    footerLine: str(f.EmailFooter),
  };

  let replyToAddress = null;
  if (fromEmail && isValidEmail(fromEmail)) {
    replyToAddress = fromEmail;
  } else {
    const fallback = str(f.ClientEmail).toLowerCase();
    if (fallback && isValidEmail(fallback)) replyToAddress = fallback;
  }

  return {
    brandConfig,
    replyToAddress,
    supportEmail: s?.support?.email || replyToAddress || null,
    supportPhone: s?.support?.phone || null,
  };
}

/** The defaults used when there is no widget record — the demo sentinel path. */
export function demoEmailBrand() {
  return {
    brandConfig: { name: 'Travelgenix Demo', logoUrl: '', footerLine: '' },
    replyToAddress: null,
    supportEmail: null,
    supportPhone: null,
  };
}
