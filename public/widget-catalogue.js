/**
 * /api/widget-catalogue
 *
 * Per-widget release status for the Widget Suite dashboard catalogue.
 *
 *   GET  → public. Returns { ok, statuses: { [widgetId]: 'live' | 'coming-soon' } }.
 *          The dashboard reads this on load and overlays it onto the WIDGETS
 *          registry. Non-sensitive display state, so no auth — clients need it
 *          before they sign in.
 *
 *   POST → STAFF ONLY. Body { widgetId, status }. Flips one widget's status.
 *          Staff = a verified session whose email belongs to a Travelgenix /
 *          Agendas domain. The email is resolved SERVER-SIDE (from the token,
 *          or by looking the user up in the Users table by recordId) — never
 *          trusted from the request body. Clients can never reach this branch.
 *
 * Backing store: "Widget Catalogue Status" table (tblJHOJlt63QmuxEq) in the
 * Widgets base. One row per registry widget id.
 *
 * Env vars: AIRTABLE_KEY, AIRTABLE_BASE_ID (defaults to appAYzWZxvK6qlwXK),
 *           TG_SESSION_SECRET (used by requireAuth).
 */

import {
  requireAuth,
  applyRateLimit,
  RATE_LIMITS,
  setCors,
} from './_auth.js';

const AIRTABLE_API = 'https://api.airtable.com/v0';
const BASE_ID = process.env.AIRTABLE_BASE_ID || 'appAYzWZxvK6qlwXK';
const TABLE_ID = 'tblJHOJlt63QmuxEq'; // Widget Catalogue Status

// Field IDs (returnFieldsByFieldId=true so we read/write by id, not name)
const F = {
  widgetId:  'fldAF01jPEeJSpGFr',
  widgetName:'fldpgCvfHwifQw71g',
  status:    'flddYY41TmQRi2ZFr',
  updatedBy: 'fldtKguATp94LqYNL',
  updatedAt: 'fldiRO4yh7eCzViIf',
};

// Users table — to resolve a session recordId back to an email when the
// token doesn't carry one (cookie-auth path).
const USERS_TABLE = 'tblIpeQeZmF7CM7OJ';
const USER_EMAIL_FIELD = 'fldSQLKBfsAcVS2s3';

const VALID_STATUSES = ['live', 'coming-soon'];

// Staff domains. Anyone signed in under one of these sees every widget as live
// on the dashboard AND may change widget statuses. Keep this list tight — it is
// the single gate on the admin capability.
const STAFF_DOMAINS = ['travelgenix.io', 'travelgenix.com', 'agendas.group'];

function isStaffEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const at = email.lastIndexOf('@');
  if (at === -1) return false;
  const domain = email.slice(at + 1).toLowerCase().trim();
  return STAFF_DOMAINS.includes(domain);
}

function airtableHeaders() {
  return {
    Authorization: `Bearer ${process.env.AIRTABLE_KEY}`,
    'Content-Type': 'application/json',
  };
}

// Resolve the authenticated user's email. Prefer the email already on the
// token; otherwise look the user up by recordId in the Users table. Returns
// a lowercased email string or null. NEVER reads email from the request body.
async function resolveAuthedEmail(user) {
  const direct = user && typeof user.email === 'string' ? user.email.trim() : '';
  if (direct) return direct.toLowerCase();

  const recId = user && user.recordId;
  if (!recId || typeof recId !== 'string' || !/^rec[A-Za-z0-9]{14}$/.test(recId)) {
    return null;
  }
  try {
    const url = `${AIRTABLE_API}/${BASE_ID}/${USERS_TABLE}/${recId}?returnFieldsByFieldId=true`;
    const resp = await fetch(url, { headers: airtableHeaders() });
    if (!resp.ok) return null;
    const rec = await resp.json();
    const email = rec && rec.fields && rec.fields[USER_EMAIL_FIELD];
    return typeof email === 'string' ? email.toLowerCase().trim() : null;
  } catch {
    return null;
  }
}

// Fetch all status rows → { statuses, recordsById }. statuses maps widgetId to
// 'live'/'coming-soon'; recordsById maps widgetId to the Airtable record id for
// writes. Paginates defensively though the table is tiny.
async function fetchAllStatuses() {
  const statuses = {};
  const recordsById = {};
  let offset;
  do {
    let url = `${AIRTABLE_API}/${BASE_ID}/${TABLE_ID}`
      + `?returnFieldsByFieldId=true&pageSize=100`;
    if (offset) url += `&offset=${encodeURIComponent(offset)}`;
    const resp = await fetch(url, { headers: airtableHeaders() });
    if (!resp.ok) {
      throw new Error(`Airtable read failed (${resp.status})`);
    }
    const data = await resp.json();
    for (const rec of data.records || []) {
      const wid = rec.fields?.[F.widgetId];
      if (!wid) continue;
      const st = rec.fields?.[F.status];
      statuses[wid] = VALID_STATUSES.includes(st) ? st : 'live';
      recordsById[wid] = rec.id;
    }
    offset = data.offset;
  } while (offset);
  return { statuses, recordsById };
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  // ── GET: public read ──────────────────────────────────────────
  if (req.method === 'GET') {
    if (!applyRateLimit(res, `catalogue-read:${req.headers['x-forwarded-for'] || 'anon'}`, RATE_LIMITS.widgetRead)) {
      return;
    }
    try {
      const { statuses } = await fetchAllStatuses();
      // Short cache — admin changes should propagate quickly, but we don't
      // need this fresh to the second.
      res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=60');
      res.status(200).json({ ok: true, statuses });
    } catch (e) {
      // Fail OPEN on read: if Airtable is unreachable the dashboard falls back
      // to the registry's hardcoded statuses. Better than a broken catalogue.
      console.error('[widget-catalogue] GET failed:', e && e.message);
      res.status(200).json({ ok: false, statuses: {}, degraded: true });
    }
    return;
  }

  // ── POST: staff-only write ────────────────────────────────────
  if (req.method === 'POST') {
    const auth = requireAuth(req);
    if (auth.error) {
      res.status(auth.status || 401).json({ ok: false, error: auth.error });
      return;
    }

    const email = await resolveAuthedEmail(auth.user);
    if (!isStaffEmail(email)) {
      // Don't leak whether the record exists or why — just deny.
      res.status(403).json({ ok: false, error: 'Staff access required.' });
      return;
    }

    if (!applyRateLimit(res, `catalogue-write:${email}`, RATE_LIMITS.widgetWrite)) {
      return;
    }

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const widgetId = typeof body.widgetId === 'string' ? body.widgetId.trim() : '';
    const status = typeof body.status === 'string' ? body.status.trim() : '';

    if (!widgetId || !/^[a-z0-9-]{1,40}$/.test(widgetId)) {
      res.status(400).json({ ok: false, error: 'Invalid widgetId.' });
      return;
    }
    if (!VALID_STATUSES.includes(status)) {
      res.status(400).json({ ok: false, error: 'Invalid status. Must be live or coming-soon.' });
      return;
    }

    let recordsById;
    try {
      ({ recordsById } = await fetchAllStatuses());
    } catch (e) {
      console.error('[widget-catalogue] POST read failed:', e && e.message);
      res.status(502).json({ ok: false, error: 'Could not reach the catalogue store.' });
      return;
    }

    const recId = recordsById[widgetId];
    if (!recId) {
      // Only known, seeded widgets can be toggled. Prevents creating junk rows.
      res.status(404).json({ ok: false, error: `Unknown widget "${widgetId}". Seed it in the catalogue first.` });
      return;
    }

    try {
      const url = `${AIRTABLE_API}/${BASE_ID}/${TABLE_ID}/${recId}`;
      const resp = await fetch(url, {
        method: 'PATCH',
        headers: airtableHeaders(),
        body: JSON.stringify({
          fields: {
            [F.status]: status,
            [F.updatedBy]: email,
            [F.updatedAt]: new Date().toISOString(),
          },
          typecast: false,
          returnFieldsByFieldId: true,
        }),
      });
      if (!resp.ok) {
        const detail = await resp.text().catch(() => '');
        console.error('[widget-catalogue] PATCH failed:', resp.status, detail.slice(0, 300));
        res.status(502).json({ ok: false, error: 'Failed to update status.' });
        return;
      }
      res.status(200).json({ ok: true, widgetId, status });
    } catch (e) {
      console.error('[widget-catalogue] PATCH threw:', e && e.message);
      res.status(502).json({ ok: false, error: 'Failed to update status.' });
    }
    return;
  }

  res.setHeader('Allow', 'GET, POST, OPTIONS');
  res.status(405).json({ ok: false, error: 'Method not allowed' });
}
