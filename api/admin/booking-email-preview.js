/**
 * GET /api/admin/booking-email-preview
 *
 * Staff-only: render a REAL Travelify booking through every pre-built
 * confirmation-email style, so the new platform can be shown to somebody with
 * a genuine booking on screen rather than invented data.
 *
 * Why it exists (21 Sep 2026): the confirmation email is sent by the booking
 * webhook, and the webhook is not wired for most applications yet. Until it
 * is, there was no way to look at what a client's customers will actually
 * receive. Andy: "a test page so I can enter a booking reference from Travelify
 * and it will show a mock-up of each of the pre-built designs ... with real
 * data that doesn't require the webhooks to be set."
 *
 * It is a PREVIEW and nothing else. It sends no email, writes nothing, and
 * queues nothing. The order is read through /api/retrieve-order, the same
 * endpoint the widget and the real sender use, so what is drawn here is what
 * would be sent.
 *
 *   ?widgetId=&orderRef=&email=&departDate=
 *       JSON: the booking's identity plus one entry per style
 *       { orderRef, brandName, styles: [{ id, label, hint, subject }] }
 *
 *   ...&style=<id>&format=html
 *       That one style rendered, as text/html, for an <iframe> or a new tab.
 *
 * The style list is EMAIL_STYLES from the shared renderer, plus the client's
 * OWN saved layout when they have one — the most useful thing to show a
 * prospect is usually what this agency's customers get today.
 *
 * Auth: requireAdmin. GET only. Rate limited per user. A real customer's
 * booking is rendered in full here, exactly as the customer would see it, so
 * this is staff-only for the same reason the order inspector is.
 */
import { requireAdmin, setAdminCors } from './_guard.js';
import { applyRateLimit, RATE_LIMITS } from '../_auth.js';
import {
  validateWidgetId, validateEmail, validateDate, validateOrderRef,
  resolveWidgetCredentials, DEMO_WIDGET_SENTINEL,
} from '../_lib/travelify.js';
import { renderBookingEmail, EMAIL_STYLES } from '../_lib/booking-email-template.js';
import { layoutWantsDestination, resolveBookingDestination } from '../_lib/booking-destination.js';
import { readWidgetSettings, buildEmailBrand, demoEmailBrand } from '../_lib/booking-email-brand.js';

function buildInternalUrl(req, path) {
  const proto = (req.headers['x-forwarded-proto'] || 'https').toString().split(',')[0];
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '').toString().split(',')[0];
  if (!host) return null;
  return `${proto}://${host}${path}`;
}

function internalHeaders(realIp) {
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.TG_INTERNAL_KEY) {
    headers['X-TG-Internal-Key'] = process.env.TG_INTERNAL_KEY;
    headers['X-TG-Real-IP'] = realIp;
  }
  return headers;
}


const AIRTABLE_BASE = process.env.AIRTABLE_BASE_ID || 'appAYzWZxvK6qlwXK';
const WIDGETS_TABLE = 'tblVAThVqAjqtria2';
const CLIENTS_TABLE = 'tblikekpaTKraMktZ';

/**
 * Every Active My Booking widget, labelled by the agency that owns it.
 *
 * The order inspector makes staff type a widget id, and on 18 Sep 2026 that
 * cost an hour of guessing which of 21 clients held a booking. A picker is the
 * whole difference between a tool that gets used and one that does not.
 *
 * Two reads: the widgets, then the clients, joined on ClientRecordId. Field
 * NAMES inside the formula braces — a field id there silently matches nothing.
 */
async function listMyBookingWidgets() {
  const key = process.env.AIRTABLE_KEY;
  if (!key) return [];
  const headers = { Authorization: `Bearer ${key}` };
  const get = async (table, params) => {
    const url = new URL(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${table}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const r = await fetch(url.toString(), { headers, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return [];
    return (await r.json()).records || [];
  };

  const widgets = await get(WIDGETS_TABLE, {
    filterByFormula: "AND({WidgetType}='My Booking',{Status}='Active')",
    pageSize: '100',
  });
  if (!widgets.length) return [];

  const clients = await get(CLIENTS_TABLE, { pageSize: '100' });
  const nameById = new Map();
  for (const c of clients) {
    const f = c.fields || {};
    const label = (f['Trading Name'] || f.ClientName || '').toString().trim();
    if (label) nameById.set(c.id, label);
  }

  return widgets.map((w) => {
    const f = w.fields || {};
    const client = nameById.get((f.ClientRecordId || '').toString().trim()) || '';
    return {
      widgetId: (f.WidgetID || '').toString(),
      name: (f.Name || 'Untitled').toString(),
      client,
      label: client ? `${client} — ${f.Name || 'Untitled'}` : (f.Name || 'Untitled').toString(),
    };
  })
  .filter((w) => w.widgetId)
  .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Every style to draw: the pre-built ones, plus this client's own saved layout
 * when they have one. Their own goes FIRST — when showing an agency what their
 * customers will get, that is the answer.
 */
export function stylesToRender(widgetSettings) {
  const own = widgetSettings?.confirmationEmail?.layout;
  const list = EMAIL_STYLES.map((s) => ({ id: s.id, label: s.label, hint: s.hint, layout: s.layout }));
  if (Array.isArray(own) && own.length) {
    list.unshift({
      id: 'current',
      label: 'This client’s current layout',
      hint: 'What this agency’s customers receive today, as saved in their My Booking editor.',
      layout: own,
    });
  }
  return list;
}

export default async function handler(req, res) {
  setAdminCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const gate = requireAdmin(req);
  if (gate.error) return res.status(gate.status).json({ error: gate.error });
  const who = String((gate.user && (gate.user.email || gate.user.userId || gate.user.id)) || 'staff').toLowerCase();
  if (!applyRateLimit(res, `email-preview:${who}`, RATE_LIMITS.widgetRead)) return;

  const q = req.query || {};

  // The client picker. Asked for on its own, before any booking is chosen.
  if (String(q.widgets || '') === '1') {
    return res.status(200).json({ widgets: await listMyBookingWidgets() });
  }

  const orderRef = validateOrderRef(String(q.orderRef || ''));
  const emailAddress = validateEmail(String(q.email || ''));
  const departDate = validateDate(String(q.departDate || ''));
  const widgetId = q.widgetId ? validateWidgetId(String(q.widgetId)) : DEMO_WIDGET_SENTINEL;
  const wantHtml = String(q.format || '') === 'html';
  const wantStyle = String(q.style || '').trim();

  if (!orderRef || !emailAddress || !departDate) {
    return res.status(400).json({ error: 'Order reference, customer email and departure date are all needed. The date is yyyy-mm-dd.' });
  }
  if (!widgetId) return res.status(400).json({ error: 'That widget id is not in the expected form.' });

  try {
    // ----- The order, through the endpoint that already knows how -----
    // Not a direct Travelify call: /api/retrieve-order trims and sanitises the
    // order into the exact shape the widget, the PDF and the real sender all
    // read. Rendering anything else here would preview a different email.
    const url = buildInternalUrl(req, '/api/retrieve-order');
    if (!url) return res.status(500).json({ error: 'server_error' });
    const lookup = await fetch(url, {
      method: 'POST',
      headers: internalHeaders(String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || '127.0.0.1'),
      body: JSON.stringify({ widgetId, emailAddress, departDate, orderRef }),
      signal: AbortSignal.timeout(15000),
    });
    if (!lookup.ok) {
      return res.status(lookup.status === 404 ? 404 : 502).json({
        error: lookup.status === 404
          ? 'No booking with that reference, email and departure date for this client. Check the widget belongs to the agency that holds it, and that the date is the real departure.'
          : 'The booking lookup did not complete.',
        lookupStatus: lookup.status,
      });
    }
    const looked = await lookup.json();
    const order = looked?.order;
    // The booking page's own upsell tiles, so a style with the "Add to your
    // trip" block previews what this customer would really be offered.
    const upsell = Array.isArray(looked?.upsell) ? looked.upsell : [];
    if (!order || !order.id) return res.status(404).json({ error: 'That lookup returned no order.' });

    // ----- Who the email is from, resolved exactly as the sender does -----
    let { brandConfig, supportEmail, supportPhone } = demoEmailBrand();
    let widgetSettings = {};
    if (widgetId !== DEMO_WIDGET_SENTINEL) {
      const resolved = await resolveWidgetCredentials(widgetId, 'My Booking');
      const fields = resolved?.widget?.fields;
      if (fields) {
        widgetSettings = readWidgetSettings(fields);
        ({ brandConfig, supportEmail, supportPhone } = buildEmailBrand(fields, widgetSettings));
      }
    }

    const styles = stylesToRender(widgetSettings);
    const chosen = wantStyle ? styles.filter((s) => s.id === wantStyle) : styles;
    if (wantStyle && !chosen.length) return res.status(404).json({ error: 'No style with that id.' });

    // One destination lookup for the whole page, not one per style: the pack
    // describes where the booking goes, which does not change with the layout.
    const needsDestination = chosen.some((s) => layoutWantsDestination(s.layout));
    const destination = needsDestination ? await resolveBookingDestination(order) : null;

    const baseUrl = buildInternalUrl(req, '');
    const render = (style) => renderBookingEmail({
      order,
      message: '',
      brand: brandConfig,
      colors: widgetSettings?.colors || {},
      supportEmail,
      supportPhone,
      orderRef,
      layout: style.layout,
      destination,
      upsell,
      baseUrl,
    });

    // ----- One style, as HTML, for an iframe or a new tab -----
    if (wantHtml) {
      const { html } = render(chosen[0]);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      // A real customer's booking. Never store it anywhere, at any hop.
      res.setHeader('Cache-Control', 'no-store, private');
      return res.status(200).send(html);
    }

    // ----- The list, with each subject line, and no HTML -----
    // Subjects are cheap and worth seeing side by side; the bodies are fetched
    // per frame so one response does not carry half a megabyte of email.
    return res.status(200).json({
      orderRef,
      brandName: brandConfig.name,
      hasLogo: !!brandConfig.logoUrl,
      destinationResolved: !!destination,
      styles: chosen.map((s) => ({
        id: s.id,
        label: s.label,
        hint: s.hint,
        subject: render(s).subject,
        usesDestination: layoutWantsDestination(s.layout),
      })),
    });
  } catch (e) {
    return res.status(502).json({ error: String((e && e.message) || 'failed') });
  }
}
