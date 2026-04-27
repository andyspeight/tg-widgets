/**
 * Travelgenix Widget Suite — Booking Email (public endpoint)
 *
 * Sends a branded confirmation email with the booking PDF attached.
 *
 * Architecture: this endpoint does the booking lookup itself (so it can read
 * the customer's email from Travelify for the anti-abuse check), then calls
 * /api/booking-pdf over HTTP to get the PDF bytes. We don't run Puppeteer
 * twice — the PDF endpoint is the single source of truth for PDF generation.
 *
 * Endpoint:
 *   POST /api/booking-email
 *   Body: {
 *     widgetId, emailAddress, departDate, orderRef,   // booking lookup
 *     toEmail,                                         // primary recipient
 *     ccEmails: ['a@b.com', ...],                      // optional, max 3
 *     message,                                         // optional free-text
 *   }
 *
 * Response:
 *   200 → { ok: true, messageId, sentTo, ccCount }
 *   400 → { error: 'invalid_recipients' | 'recipient_mismatch' | 'invalid_message' }
 *   404 → { error: 'not_found' }
 *   429 → { error: 'too_many_attempts' }
 *   5xx → { error: 'server_error' | 'send_failed' | 'pdf_failed' }
 *
 * Anti-abuse:
 *   - The booking customer's email (resolved from Travelify) MUST appear in
 *     the recipient list. Without this, the endpoint becomes a way for an
 *     attacker who knows a real ref+email+date to send branded mail to
 *     arbitrary addresses. With it, the worst case is "I emailed myself a
 *     confirmation pack I already had access to."
 *   - Recipients capped at 4 total (1 to + 3 cc).
 *   - Per-IP and per-(IP+widget) rate limits.
 *   - Custom message capped at 1000 chars and rendered with full escaping.
 *
 * Vercel function config (vercel.json):
 *   memory: 512, maxDuration: 30
 *   No chromium/puppeteer needed here — those live in /api/booking-pdf.
 */

import { setCors, sanitiseForFormula } from './_auth.js';
import { decrypt } from './_crypto.js';
import { renderBookingEmail } from './_lib/booking-email-template.js';
import { sendViaSendGrid, buildFromField, isValidEmail } from './_lib/sendgrid.js';

// ----- Constants (matched 1:1 with booking-pdf.js) -----

const AIRTABLE_BASE = process.env.AIRTABLE_BASE_ID || 'appAYzWZxvK6qlwXK';
const WIDGETS_TABLE = 'tblVAThVqAjqtria2';
const INTEGRATIONS_TABLE = 'tblpzQpwmcTvUeHcF';

const IF = {
  ClientEmail:     'flditBgdp6egbk3Fb',
  Service:         'fld0TP0kypkfOOJF6',
  AppId:           'fldCXwCixuvqN2HMy',
  ApiKeyEncrypted: 'fldpb4JQRSuot0Gg2',
  Status:          'fldEVMrKnEpFaxORk',
};

const TRAVELIFY_API = 'https://api.travelify.io/account/order';

const DEMO_WIDGET_SENTINEL = 'DEMO_WIDGET_ID';
const DEMO_INTEGRATION_RECORD_ID = 'rec6TnQI0Pz8PyrGs';

// Cap on additional CC recipients beyond the primary "to" address.
const MAX_CC = 3;
const MAX_MESSAGE_LENGTH = 1000;

// ----- PDF generation -----
//
// This endpoint does NOT generate the PDF directly — it calls the existing
// /api/booking-pdf endpoint over HTTP and uses its response. This keeps PDF
// generation in one place (single source of truth) and avoids re-bundling
// Puppeteer/chromium into a second function.
//
// We pass the same booking lookup params plus a shared server-side secret
// (TG_INTERNAL_API_KEY) so the PDF endpoint knows the call is coming from
// our own backend, not a public client. The PDF endpoint can use this to
// skip per-IP rate limiting on internal calls.

// ----- Rate limit (in-memory, per-warm-instance) -----
// Same pattern as booking-pdf.js. Vercel functions can scale horizontally so
// this is a soft limit, not a hard guarantee — but it stops naive attacks.

const rateLimitStore = new Map();
function rateLimit(key, max, windowMs = 60_000) {
  const now = Date.now();
  const cutoff = now - windowMs;
  const hits = (rateLimitStore.get(key) || []).filter(t => t > cutoff);
  if (hits.length >= max) {
    return { ok: false, retryAfterMs: hits[0] + windowMs - now };
  }
  hits.push(now);
  rateLimitStore.set(key, hits);
  return { ok: true };
}

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string') return xff.split(',')[0].trim();
  if (Array.isArray(xff)) return xff[0];
  return req.socket?.remoteAddress || 'unknown';
}

// ----- Validators (matched with booking-pdf.js) -----

function validateEmail(s) {
  if (typeof s !== 'string') return null;
  const trimmed = s.trim().toLowerCase();
  if (trimmed.length === 0 || trimmed.length > 254) return null;
  if (!isValidEmail(trimmed)) return null;
  return trimmed;
}

function validateDate(s) {
  if (typeof s !== 'string') return null;
  const trimmed = s.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) return null;
  return trimmed;
}

function validateOrderRef(s) {
  if (typeof s !== 'string') return null;
  const trimmed = s.trim();
  if (!/^[A-Za-z0-9_-]{3,50}$/.test(trimmed)) return null;
  return trimmed;
}

function validateWidgetId(s) {
  if (typeof s !== 'string') return null;
  const trimmed = s.trim();
  if (!/^[A-Za-z0-9_-]{3,100}$/.test(trimmed)) return null;
  return trimmed;
}

function validateMessage(s) {
  if (s == null || s === '') return '';
  if (typeof s !== 'string') return null;
  const trimmed = s.trim();
  if (trimmed.length > MAX_MESSAGE_LENGTH) return null;
  return trimmed;
}

// ----- Airtable helpers (matched with booking-pdf.js) -----

function airtableHeaders() {
  return {
    'Authorization': `Bearer ${process.env.AIRTABLE_KEY}`,
    'Content-Type': 'application/json',
  };
}

async function findWidgetById(widgetId) {
  const safe = sanitiseForFormula(widgetId);
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${WIDGETS_TABLE}?filterByFormula=${encodeURIComponent(`{WidgetID} = "${safe}"`)}&maxRecords=1`;
  const res = await fetch(url, { headers: airtableHeaders() });
  if (!res.ok) return null;
  const data = await res.json();
  return data.records?.[0] || null;
}

async function findActiveTravelifyIntegration(clientEmail) {
  const safe = sanitiseForFormula(clientEmail);
  const formula = `AND({${IF.ClientEmail}} = "${safe}", {${IF.Service}} = "Travelify", {${IF.Status}} = "Active")`;
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${INTEGRATIONS_TABLE}?filterByFormula=${encodeURIComponent(formula)}&returnFieldsByFieldId=true&maxRecords=1`;
  const res = await fetch(url, { headers: airtableHeaders() });
  if (!res.ok) return null;
  const data = await res.json();
  return data.records?.[0] || null;
}

async function getIntegrationById(recordId) {
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${INTEGRATIONS_TABLE}/${recordId}?returnFieldsByFieldId=true`;
  const res = await fetch(url, { headers: airtableHeaders() });
  if (!res.ok) return null;
  return await res.json();
}

// ----- Order trim helpers (mirror booking-pdf.js) -----
// We need the same trimmed structure that the PDF template expects. Rather
// than duplicate ~150 lines of trim helpers we keep it minimal here: take the
// raw Travelify response and pass through the items the template uses. If the
// trim logic in booking-pdf.js drifts, this should be updated to match.
//
// IMPORTANT: keep this in sync with booking-pdf.js trim functions. They are
// expected to produce identical structure for renderPdfHtml.

function trimAccommodation(d) {
  if (!d) return null;
  return {
    name: d.name,
    rating: d.rating,
    review: d.review,
    location: d.location,
    media: Array.isArray(d.media) ? d.media : [],
    descriptions: Array.isArray(d.descriptions) ? d.descriptions : [],
    units: Array.isArray(d.units) ? d.units : [],
    pricing: d.pricing,
    guests: Array.isArray(d.guests) ? d.guests : [],
  };
}

function trimFlightSegment(s) {
  if (!s) return null;
  return {
    depart: s.depart, arrive: s.arrive,
    origin: s.origin, destination: s.destination,
    marketingCarrier: s.marketingCarrier,
    flightNo: s.flightNo, duration: s.duration,
    aircraft: s.aircraft, cabinClass: s.cabinClass,
    fareName: s.fareName, baggage: s.baggage,
  };
}

function trimFlights(d) {
  if (!d) return null;
  return {
    routes: Array.isArray(d.routes)
      ? d.routes.map(r => ({
          direction: r.direction,
          segments: Array.isArray(r.segments) ? r.segments.map(trimFlightSegment) : [],
        }))
      : [],
    fareInformation: Array.isArray(d.fareInformation) ? d.fareInformation : [],
  };
}

function trimAirportExtras(d) {
  if (!d) return null;
  return {
    type: d.type, name: d.name, subTitle: d.subTitle,
    location: d.location,
    startDateTime: d.startDateTime, endDateTime: d.endDateTime,
    descriptions: Array.isArray(d.descriptions) ? d.descriptions : [],
    features: Array.isArray(d.features) ? d.features : [],
    media: Array.isArray(d.media) ? d.media : [],
  };
}

function trimItem(item) {
  if (!item) return null;
  const out = {
    product: item.product,
    bookingReference: item.bookingReference,
    startDate: item.startDate,
    duration: item.duration,
    price: item.price,
  };
  if (item.product === 'Accommodation') out.accommodation = trimAccommodation(item.accommodation);
  if (item.product === 'Flights') out.flights = trimFlights(item.flights);
  if (item.product === 'AirportExtras') out.airportExtras = trimAirportExtras(item.airportExtras);
  return out;
}

function computeSummary(items) {
  const summary = {
    hasAccommodation: false,
    hasFlights: false,
    hasAirportExtras: false,
    totalPrice: 0,
    earliestStart: null,
    travellers: [],
  };
  let earliest = null;
  for (const it of items) {
    if (!it) continue;
    if (it.product === 'Accommodation') summary.hasAccommodation = true;
    if (it.product === 'Flights') summary.hasFlights = true;
    if (it.product === 'AirportExtras') summary.hasAirportExtras = true;
    if (typeof it.price === 'number') summary.totalPrice += it.price;
    if (it.startDate) {
      const t = Date.parse(it.startDate);
      if (Number.isFinite(t) && (earliest === null || t < earliest)) {
        earliest = t;
        summary.earliestStart = it.startDate;
      }
    }
    if (it.accommodation?.guests?.length) {
      summary.travellers = it.accommodation.guests;
    }
  }
  return summary;
}

function trimOrder(raw) {
  if (!raw || !raw.id) return null;
  const items = (raw.items || []).map(trimItem).filter(Boolean);
  return {
    id: raw.id,
    customerTitle: raw.customerTitle,
    customerFirstname: raw.customerFirstname,
    customerSurname: raw.customerSurname,
    customerEmail: raw.customerEmail,
    currency: raw.currency,
    specialRequests: raw.specialRequests,
    items,
    documents: Array.isArray(raw.documents) ? raw.documents : [],
    summary: computeSummary(items),
  };
}

// ----- Response helpers -----

function notFound(res) { return res.status(404).json({ error: 'not_found' }); }
function badRequest(res, code) { return res.status(400).json({ error: code }); }

// ----- Main handler -----

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = getClientIp(req);
  // Tighter limit than PDF endpoint — sending mail is more abusable than
  // generating a PDF (which only consumes our resources). 3 emails / IP / min.
  const ipLimit = rateLimit(`email:ip:${ip}`, 3);
  if (!ipLimit.ok) {
    return res.status(429).json({ error: 'too_many_attempts', retryAfterMs: ipLimit.retryAfterMs });
  }

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  } catch {
    return notFound(res);
  }

  const widgetId = validateWidgetId(body.widgetId);
  const emailAddress = validateEmail(body.emailAddress);  // booking lookup email
  const departDate = validateDate(body.departDate);
  const orderRef = validateOrderRef(body.orderRef);

  if (!widgetId || !emailAddress || !departDate || !orderRef) return notFound(res);

  // Recipient validation
  const toEmail = validateEmail(body.toEmail);
  if (!toEmail) return badRequest(res, 'invalid_recipients');

  const ccEmails = [];
  if (Array.isArray(body.ccEmails)) {
    const seen = new Set([toEmail]);
    for (const candidate of body.ccEmails) {
      const valid = validateEmail(candidate);
      if (!valid) continue;
      if (seen.has(valid)) continue;
      seen.add(valid);
      ccEmails.push(valid);
      if (ccEmails.length >= MAX_CC) break;
    }
  }

  // Optional message — null-able. Validator returns '' for empty, null for
  // overlong/invalid. We treat null as a hard reject so the caller knows
  // the message was dropped.
  const message = validateMessage(body.message);
  if (message === null) return badRequest(res, 'invalid_message');

  const widgetLimit = rateLimit(`email:ipw:${ip}:${widgetId}`, 10);
  if (!widgetLimit.ok) {
    return res.status(429).json({ error: 'too_many_attempts', retryAfterMs: widgetLimit.retryAfterMs });
  }

  try {
    let appId;
    let apiKey;
    let widgetRecord = null;

    if (widgetId === DEMO_WIDGET_SENTINEL) {
      // ----- Demo path -----
      const integration = await getIntegrationById(DEMO_INTEGRATION_RECORD_ID);
      if (!integration) return notFound(res);

      const demoAppId = integration.fields?.[IF.AppId];
      const demoApiKeyEncrypted = integration.fields?.[IF.ApiKeyEncrypted];
      if (!demoAppId || !demoApiKeyEncrypted) return notFound(res);

      try {
        apiKey = decrypt(demoApiKeyEncrypted);
      } catch (e) {
        console.error('Email: Demo key decryption failed:', e.message);
        return notFound(res);
      }
      appId = demoAppId;
    } else {
      // ----- Real client path -----
      const widget = await findWidgetById(widgetId);
      if (!widget) return notFound(res);

      const widgetType = widget.fields?.WidgetType;
      if (widgetType !== 'My Booking') return notFound(res);

      const widgetStatus = widget.fields?.Status;
      if (widgetStatus && widgetStatus !== 'Active' && widgetStatus !== 'Draft') return notFound(res);

      const clientEmail = (widget.fields?.ClientEmail || '').toLowerCase().trim();
      if (!clientEmail) return notFound(res);

      const integration = await findActiveTravelifyIntegration(clientEmail);
      if (!integration) return notFound(res);

      const integrationAppId = integration.fields?.[IF.AppId];
      const apiKeyEncrypted = integration.fields?.[IF.ApiKeyEncrypted];
      if (!integrationAppId || !apiKeyEncrypted) return notFound(res);

      try {
        apiKey = decrypt(apiKeyEncrypted);
      } catch (e) {
        console.error('Email decryption failed:', e.message);
        return notFound(res);
      }
      appId = integrationAppId;
      widgetRecord = widget;
    }

    // ----- Travelify lookup (mirrors booking-pdf.js) -----
    const travelifyRes = await fetch(TRAVELIFY_API, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${appId}:${apiKey}`,
        'Content-Type': 'application/json',
        'Origin': 'https://www.travelgenix.io',
      },
      body: JSON.stringify({ emailAddress, departDate, orderRef }),
      signal: AbortSignal.timeout(12000),
    });

    const rawText = await travelifyRes.text();

    if (travelifyRes.status === 404) return notFound(res);
    if (!travelifyRes.ok) {
      console.error(`Email: Travelify ${travelifyRes.status} for widget ${widgetId}`);
      return notFound(res);
    }

    let raw;
    try { raw = JSON.parse(rawText); } catch { return notFound(res); }
    if (raw && (raw.code === '404' || raw.code === 404)) return notFound(res);

    const order = trimOrder(raw);
    if (!order || !order.id) return notFound(res);

    // ----- ANTI-ABUSE: customer's email must be in recipients -----
    // The endpoint exists to send a confirmation email about a booking; the
    // booking customer is, by definition, an authorised recipient. Requiring
    // their email to be one of the addresses prevents the endpoint being
    // used as a "send to anyone" relay for anyone who knows ref+date+email.
    const customerEmail = (order.customerEmail || emailAddress || '').toLowerCase().trim();
    const allRecipients = new Set([toEmail, ...ccEmails]);
    if (customerEmail && !allRecipients.has(customerEmail)) {
      return badRequest(res, 'recipient_mismatch');
    }

    // ----- Pull branding from widget record -----
    let widgetSettings = {};
    let brandConfig = { name: '', logoUrl: '', footerLine: '' };
    let replyToAddress = null;
    let supportEmail = null;
    let supportPhone = null;
    let agencyDisplayName = '';

    if (widgetRecord) {
      const fields = widgetRecord.fields || {};

      // Settings JSON (existing — colours, support contact, brand name)
      const s = fields.Settings;
      if (s) {
        if (typeof s === 'object') widgetSettings = s;
        else { try { widgetSettings = JSON.parse(s); } catch { widgetSettings = {}; } }
      }

      // New per-widget email-branding fields (FromName, FromEmail, LogoUrl,
      // EmailFooter). These are independent from Settings JSON because they
      // need to be discoverable + editable in the Airtable grid view.
      const fromName = (fields.FromName || '').toString().trim();
      const fromEmail = (fields.FromEmail || '').toString().trim().toLowerCase();
      const logoUrl = (fields.LogoUrl || '').toString().trim();
      const emailFooter = (fields.EmailFooter || '').toString().trim();
      const clientName = (fields.ClientName || '').toString().trim();

      agencyDisplayName = fromName
        || widgetSettings?.brand?.name
        || clientName
        || 'Travel Team';

      if (fromEmail && isValidEmail(fromEmail)) {
        replyToAddress = fromEmail;
      } else {
        const fallback = (fields.ClientEmail || '').toString().trim().toLowerCase();
        if (fallback && isValidEmail(fallback)) replyToAddress = fallback;
      }

      // Only use logo URLs that look like real HTTPS URLs. We embed them in
      // the email <img src> AND the PDF, so a typo or open-redirect URL would
      // show as a broken image to the customer.
      brandConfig.logoUrl = (logoUrl && /^https:\/\//i.test(logoUrl)) ? logoUrl : '';
      brandConfig.footerLine = emailFooter;
      brandConfig.name = agencyDisplayName;

      supportEmail = widgetSettings?.support?.email || replyToAddress || null;
      supportPhone = widgetSettings?.support?.phone || null;
    } else {
      // Demo path — use Travelgenix defaults so the demo page demonstrates
      // the feature even without a configured widget.
      agencyDisplayName = 'Travelgenix Demo';
      brandConfig.name = agencyDisplayName;
      brandConfig.logoUrl = '';
      brandConfig.footerLine = '';
      supportEmail = null;
      supportPhone = null;
    }

    // ----- Fetch PDF from /api/booking-pdf -----
    // Build the URL from the request itself (host header) so this works on
    // any deployment (production, preview branches, local dev) without
    // needing an env var. The booking-pdf endpoint handles all the same
    // lookup logic — calling it here means we don't re-do the work.
    //
    // We pass two headers the PDF endpoint understands:
    //   - X-TG-Internal-Key: shared secret. Bypasses default rate limit.
    //     If unset (env var missing), the call still works but rate limits
    //     against the Vercel egress IP — fine for low traffic, bad at scale.
    //   - X-TG-Real-IP: the actual user's IP, so the PDF endpoint can rate
    //     limit per-user instead of per-Vercel-egress-IP.
    const proto = (req.headers['x-forwarded-proto'] || 'https').toString().split(',')[0];
    const host = (req.headers['x-forwarded-host'] || req.headers.host || '').toString().split(',')[0];
    if (!host) {
      console.error('Email: missing host header');
      return res.status(500).json({ error: 'server_error' });
    }
    const pdfUrl = `${proto}://${host}/api/booking-pdf`;

    const pdfHeaders = { 'Content-Type': 'application/json' };
    if (process.env.TG_INTERNAL_KEY) {
      pdfHeaders['X-TG-Internal-Key'] = process.env.TG_INTERNAL_KEY;
      pdfHeaders['X-TG-Real-IP'] = ip;
    }

    const pdfRes = await fetch(pdfUrl, {
      method: 'POST',
      headers: pdfHeaders,
      body: JSON.stringify({ widgetId, emailAddress, departDate, orderRef }),
      signal: AbortSignal.timeout(28000),
    });

    if (!pdfRes.ok) {
      console.error(`Email: booking-pdf returned ${pdfRes.status} for widget ${widgetId} ref ${orderRef}`);
      if (pdfRes.status === 404) return notFound(res);
      return res.status(502).json({ error: 'pdf_failed' });
    }

    const pdfArrayBuffer = await pdfRes.arrayBuffer();
    const pdfBuffer = Buffer.from(pdfArrayBuffer);
    if (!pdfBuffer.length) {
      console.error('Email: booking-pdf returned empty body');
      return res.status(502).json({ error: 'pdf_failed' });
    }
    const pdfBase64 = pdfBuffer.toString('base64');
    const pdfFilename = `booking-${orderRef.replace(/[^A-Z0-9_-]/gi, '')}.pdf`;

    // ----- Build email body -----
    const accItem = order.items.find(i => i.product === 'Accommodation');
    const flightItem = order.items.find(i => i.product === 'Flights');
    const startDate = order.summary?.earliestStart || accItem?.startDate;
    const destinationCity = accItem?.accommodation?.location?.city || '';

    const { subject, html, text } = renderBookingEmail({
      customerFirstName: order.customerFirstname || '',
      bookingReference: accItem?.bookingReference || flightItem?.bookingReference || `TG${order.id}`,
      destinationCity,
      departureDate: startDate,
      hotelName: accItem?.accommodation?.name || '',
      message,
      brand: brandConfig,
      colors: widgetSettings?.colors || {},
      supportEmail,
      supportPhone,
    });

    // ----- Send via SendGrid -----
    const sendResult = await sendViaSendGrid({
      from: buildFromField(brandConfig.name),
      to: toEmail,
      cc: ccEmails.length > 0 ? ccEmails : undefined,
      replyTo: replyToAddress || undefined,
      subject,
      html,
      text,
      headers: {
        'X-TG-Widget-Id': widgetId,
        'X-TG-Order-Ref': orderRef,
      },
      categoryTag: 'booking-confirmation',
      attachments: [{
        filename: pdfFilename,
        content: pdfBase64,
        type: 'application/pdf',
        disposition: 'attachment',
      }],
    });

    if (sendResult.status !== 'sent') {
      console.error(`Email send failed for widget ${widgetId} ref ${orderRef}: ${sendResult.error}`);
      return res.status(502).json({ error: 'send_failed' });
    }

    return res.status(200).json({
      ok: true,
      messageId: sendResult.sgMessageId || null,
      sentTo: toEmail,
      ccCount: ccEmails.length,
    });

  } catch (err) {
    console.error('Booking email error:', err);
    return res.status(500).json({ error: 'server_error' });
  }
}
