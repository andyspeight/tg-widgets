/**
 * Signed, short-lived state tokens for the calendar OAuth flow, and helpers
 * shared by the appointment endpoints (booking refs, manage tokens, the widget
 * record lookup).
 *
 * State and manage tokens are HMAC-SHA256 signed with a secret derived from
 * TG_ENCRYPTION_KEY, so the callback cannot be forged or replayed past its TTL.
 */

import crypto from 'node:crypto';

function secret() {
  const raw = process.env.TG_OAUTH_STATE_SECRET || process.env.TG_ENCRYPTION_KEY || '';
  if (!raw) throw new Error('TG_OAUTH_STATE_SECRET / TG_ENCRYPTION_KEY missing');
  return crypto.createHash('sha256').update('tg-cal-state|' + raw).digest();
}
function b64url(buf) { return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function fromB64url(s) { return Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64'); }

export function signState(payload, ttlMs) {
  const body = Object.assign({}, payload, { exp: Date.now() + (ttlMs || 10 * 60 * 1000) });
  const json = b64url(Buffer.from(JSON.stringify(body), 'utf8'));
  const sig = b64url(crypto.createHmac('sha256', secret()).update(json).digest());
  return json + '.' + sig;
}

export function verifyState(token) {
  if (typeof token !== 'string' || token.indexOf('.') < 0) return null;
  const [json, sig] = token.split('.');
  const expect = b64url(crypto.createHmac('sha256', secret()).update(json).digest());
  let ok = false;
  try { ok = crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect)); } catch (e) { ok = false; }
  if (!ok) return null;
  let payload;
  try { payload = JSON.parse(fromB64url(json).toString('utf8')); } catch (e) { return null; }
  if (!payload || typeof payload.exp !== 'number' || Date.now() > payload.exp) return null;
  return payload;
}

export function manageToken() {
  return crypto.randomBytes(24).toString('hex');
}

export function bookingRef(startMs) {
  return 'apt_' + Number(startMs).toString(36) + '_' + crypto.randomBytes(3).toString('hex');
}

/**
 * Resolve a widget by its public WidgetID to its scheduling config and owning
 * client. Reads the same Widgets table widget-config.js uses. Returns
 * { clientRecordId, clientEmail, config, name } or null.
 */
export async function resolveWidget(widgetId) {
  const { AIRTABLE_KEY, AIRTABLE_BASE_ID } = process.env;
  if (!AIRTABLE_KEY || !AIRTABLE_BASE_ID || !widgetId) return null;
  const table = process.env.AIRTABLE_WIDGETS_TABLE || 'Widgets';
  const safe = String(widgetId).replace(/['"\\]/g, '');
  const formula = encodeURIComponent(`{WidgetID} = '${safe}'`);
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(table)}?filterByFormula=${formula}&maxRecords=1`;
  try {
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + AIRTABLE_KEY } });
    if (!r.ok) return null;
    const data = await r.json();
    const rec = data.records && data.records[0];
    if (!rec) return null;
    let config = {};
    try { config = JSON.parse(rec.fields.Config || '{}'); } catch (e) { config = {}; }
    return {
      clientRecordId: rec.fields.ClientRecordId || (Array.isArray(rec.fields.Client) ? rec.fields.Client[0] : '') || '',
      clientEmail: (rec.fields.ClientEmail || '').toLowerCase().trim(),
      widgetType: rec.fields.WidgetType || '',
      name: rec.fields.Name || '',
      config,
    };
  } catch (e) { return null; }
}

export function pickEvent(config, eventId) {
  const list = Array.isArray(config.eventTypes) && config.eventTypes.length
    ? config.eventTypes
    : [{ id: 'consult', label: config.heading || 'Appointment', mins: 30, mode: config.mode || 'callback' }];
  if (eventId) { const m = list.find(e => e.id === eventId); if (m) return m; }
  return list[0];
}
