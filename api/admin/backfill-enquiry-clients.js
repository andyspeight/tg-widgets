/**
 * GET|POST /api/admin/backfill-enquiry-clients
 *
 * One-off (and self-healing) migration: stamp ClientRecordId on Enquiry Form
 * pointer records in the Widgets table that never had it.
 *
 * WHY: /api/widget-list scopes the dashboard strictly by ClientRecordId (its
 * ClientEmail fallback is dropped for staff whose login email spans several
 * client accounts). Enquiry Forms were the one widget type that never stamped
 * ClientRecordId at save (fixed forward in api/enquiry-form-config.js), so every
 * pre-fix form is invisible in the dashboard and its owner can't reopen it.
 *
 * WHAT: for each Enquiry Form pointer with a blank ClientRecordId, resolve the
 * owner (the pointer's ClientEmail) to their linked client via the Users table
 * and stamp it. SAFETY: we only stamp when the owner links to EXACTLY ONE client
 * — a multi-account owner (typically Travelgenix staff) is ambiguous, so we skip
 * rather than guess the wrong client and hide the form from everyone. Blank
 * values are only ever filled, never overwritten, so the job is idempotent and
 * safe to run repeatedly.
 *
 * TRIGGER: an authenticated admin (manual, via the browser) OR a Vercel cron
 * (see vercel.json — x-vercel-cron header). The manual path returns a detailed
 * report; the cron path returns counts only (the detail is in the server log).
 */
import { requireAdmin, setAdminCors } from './_guard.js';

const AIRTABLE_API = 'https://api.airtable.com/v0';
const WIDGETS_TABLE = 'Widgets';
const USERS_TABLE = 'Users';
const REC_ID_RE = /^rec[A-Za-z0-9]{14}$/;

// Escape a value for safe interpolation into an Airtable filterByFormula string
// literal (single-quoted). Mirrors sanitiseForFormula in api/_auth.js.
function forFormula(v) {
  return String(v == null ? '' : v).replace(/\\/g, '\\\\').replace(/'/g, "\\'").slice(0, 200);
}

async function airtableGet(base, key, path, params) {
  const qs = params ? ('?' + params) : '';
  const resp = await fetch(`${AIRTABLE_API}/${base}/${path}${qs}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!resp.ok) throw new Error(`Airtable GET ${path} → ${resp.status}`);
  return resp.json();
}

// Every Enquiry Form pointer whose ClientRecordId is still blank, across all pages.
async function fetchOwnerlessEnquiryPointers(base, key) {
  const formula = encodeURIComponent(`AND({WidgetType}='Enquiry Form', {ClientRecordId}='')`);
  const out = [];
  let offset = '';
  do {
    const params = `filterByFormula=${formula}&pageSize=100` + (offset ? `&offset=${offset}` : '');
    const data = await airtableGet(base, key, WIDGETS_TABLE, params);
    for (const r of (data.records || [])) {
      out.push({
        id: r.id,
        widgetId: r.fields.WidgetID || '',
        name: r.fields.Name || '',
        email: String(r.fields.ClientEmail || '').toLowerCase().trim(),
      });
    }
    offset = data.offset || '';
  } while (offset);
  return out;
}

// Resolve an owner email to their client id, but ONLY when it is unambiguous
// (the Users record links to exactly one client). Returns { clientId } or
// { skip: '<reason>' }. Cached by the caller.
async function resolveSingleClientId(base, key, email) {
  if (!email) return { skip: 'no-owner-email' };
  const formula = encodeURIComponent(`LOWER({Email})='${forFormula(email)}'`);
  const data = await airtableGet(base, key, USERS_TABLE, `filterByFormula=${formula}&maxRecords=2`);
  const recs = data.records || [];
  if (recs.length === 0) return { skip: 'no-user-record' };
  if (recs.length > 1) return { skip: 'ambiguous-user' };
  const links = recs[0].fields.Client;
  const ids = Array.isArray(links)
    ? links.map((x) => (typeof x === 'string' ? x : x && x.id)).filter((id) => typeof id === 'string' && REC_ID_RE.test(id))
    : [];
  const unique = [...new Set(ids)];
  if (unique.length === 0) return { skip: 'user-has-no-client' };
  if (unique.length > 1) return { skip: 'owner-multi-client' };
  return { clientId: unique[0] };
}

// PATCH up to 10 records per Airtable request.
async function stampRecords(base, key, updates) {
  for (let i = 0; i < updates.length; i += 10) {
    const chunk = updates.slice(i, i + 10);
    const resp = await fetch(`${AIRTABLE_API}/${base}/${WIDGETS_TABLE}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ records: chunk.map((u) => ({ id: u.id, fields: { ClientRecordId: u.clientId } })) }),
    });
    if (!resp.ok) {
      const t = await resp.text();
      throw new Error(`Airtable PATCH → ${resp.status} ${t.slice(0, 200)}`);
    }
  }
}

export default async function handler(req, res) {
  setAdminCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // No hard auth gate. This migration is safe to run unauthenticated: it is
  // idempotent (fills only a blank ClientRecordId, never overwrites), only
  // stamps owners it can resolve to a single client, and returns just counts to
  // a non-admin caller (no PII). That lets a Vercel cron — which we can't hand a
  // session — run the self-heal, and means an accidental or repeat hit does no
  // harm. Detailed per-form output (owner emails, widget ids) is admin-only.
  const gate = requireAdmin(req);
  const isAdmin = !gate.error;

  const { AIRTABLE_KEY, AIRTABLE_BASE_ID } = process.env;
  if (!AIRTABLE_KEY || !AIRTABLE_BASE_ID) {
    return res.status(500).json({ error: 'Server configuration error' });
  }

  try {
    const pointers = await fetchOwnerlessEnquiryPointers(AIRTABLE_BASE_ID, AIRTABLE_KEY);

    const cache = new Map();       // email → { clientId } | { skip }
    const updates = [];            // { id, clientId, widgetId, email }
    const skipped = [];            // { widgetId, email, reason }

    for (const p of pointers) {
      if (!cache.has(p.email)) {
        cache.set(p.email, await resolveSingleClientId(AIRTABLE_BASE_ID, AIRTABLE_KEY, p.email));
      }
      const r = cache.get(p.email);
      if (r.clientId) updates.push({ id: p.id, clientId: r.clientId, widgetId: p.widgetId, email: p.email });
      else skipped.push({ widgetId: p.widgetId, email: p.email, reason: r.skip });
    }

    if (updates.length) await stampRecords(AIRTABLE_BASE_ID, AIRTABLE_KEY, updates);

    console.log(`[backfill-enquiry-clients] scanned=${pointers.length} stamped=${updates.length} skipped=${skipped.length}` +
      (skipped.length ? ' | skips: ' + skipped.map((s) => `${s.widgetId || '?'}:${s.reason}`).join(', ') : ''));

    const summary = { ok: true, scanned: pointers.length, stamped: updates.length, skipped: skipped.length };
    // Detail (owner emails / widget ids) only to an authenticated admin.
    if (isAdmin) {
      summary.stampedForms = updates.map((u) => ({ widgetId: u.widgetId, email: u.email, clientId: u.clientId }));
      summary.skippedForms = skipped;
    }
    return res.status(200).json(summary);
  } catch (err) {
    console.error('[backfill-enquiry-clients]', err.message);
    return res.status(500).json({ error: 'Backfill failed', detail: err.message });
  }
}
