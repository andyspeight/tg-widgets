/**
 * Widget List API (Hardened)
 * GET /api/widget-list → AUTHENTICATED, returns widgets owned by the authenticated user
 * 
 * Security: requires valid session token, scopes results to authenticated user's email
 */
import { requireAuth, sanitiseForFormula, setCors, applyRateLimit, RATE_LIMITS } from './_auth.js';

// Hydration fallback for cookie-issued JWTs that lack the legacy `email`
// field. The list query is scoped to user.email, so we MUST resolve it
// before running the query. See widget-config.js for the same pattern.
import { getRecord } from './_lib/auth/airtable.js';
import { USERS } from './_lib/auth/schema.js';

async function hydrateUserEmail(user) {
  if (!user || user.email || !user.recordId) return;
  try {
    const u = await getRecord(USERS.tableId, user.recordId);
    const email = u?.fields?.[USERS.fields.email];
    if (typeof email === 'string' && email.trim()) {
      user.email = email.trim();
    }
  } catch (err) {
    console.warn('[widget-list] hydrate email failed:', err.message);
  }
}

const AIRTABLE_API = 'https://api.airtable.com/v0';
const TABLE_NAME = 'Widgets';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { AIRTABLE_KEY, AIRTABLE_BASE_ID } = process.env;
  if (!AIRTABLE_KEY || !AIRTABLE_BASE_ID) return res.status(500).json({ error: 'Server configuration error' });

  // ── Require authentication ────────────────────────────────
  const auth = requireAuth(req);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });
  const user = auth.user;

  // Cookie-issued JWTs don't carry email in the payload — hydrate it
  // before the scope query below uses it.
  await hydrateUserEmail(user);

  if (!user.email) {
    // Should never happen on a valid session; fail closed.
    console.error('[widget-list] No email available for user', user.recordId);
    return res.status(401).json({ error: 'Could not resolve account email' });
  }

  // ── Rate limit (per-user, in-memory) ──────────────────────
  // Catches buggy clients and opportunistic abuse. Not a strong control on
  // its own — see _auth.js for the cold-start caveat.
  if (!applyRateLimit(res, `list:${user.email}`, RATE_LIMITS.widgetRead)) return;

  try {
    // Always scope to the authenticated user's email — never trust query params
    const safeEmail = sanitiseForFormula(user.email.toLowerCase());
    const formula = encodeURIComponent(`LOWER({ClientEmail}) = '${safeEmail}'`);
    const url = `${AIRTABLE_API}/${AIRTABLE_BASE_ID}/${TABLE_NAME}?filterByFormula=${formula}&sort%5B0%5D%5Bfield%5D=UpdatedAt&sort%5B0%5D%5Bdirection%5D=desc&maxRecords=50`;

    const resp = await fetch(url, {
      headers: { 'Authorization': `Bearer ${AIRTABLE_KEY}` },
    });
    if (!resp.ok) throw new Error(`Upstream error`);
    const data = await resp.json();

    const widgets = (data.records || []).map(r => ({
      widgetId: r.fields.WidgetID || '',
      name: r.fields.Name || 'Untitled',
      type: r.fields.WidgetType || 'Unknown',
      status: r.fields.Status || 'Draft',
      views: r.fields.Views || 0,
      updated: r.fields.UpdatedAt ? new Date(r.fields.UpdatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '',
    }));

    res.setHeader('Cache-Control', 'private, max-age=10');
    return res.status(200).json(widgets);
  } catch (err) {
    console.error('[widget-list]', err.message);
    return res.status(500).json({ error: 'Service temporarily unavailable' });
  }
}
