/**
 * Widget List API (Hardened)
 * GET /api/widget-list → AUTHENTICATED.
 *
 * Scope model (v2 — fixes the regression where staff stopped seeing their own
 * widgets after the active-client rewrite):
 *
 *   A user ALWAYS sees widgets they created under their own email. On top of
 *   that, when a session is inside a client workspace, the active client's
 *   widgets are included too:
 *       ClientRecordId === activeClientId            (authoritative, Stage 5+)
 *     OR LOWER(ClientEmail) === active client email   (legacy client widgets)
 *
 *   Own-email rule: LOWER(ClientEmail) === the logged-in user's email. This is
 *   the original behaviour and is what guarantees no regression — your own
 *   widgets always show in your home workspace.
 *
 *   Clean impersonation: when a staff member is ACTING AS a client they are not
 *   a member of (activeClientId not in their Users.client[] links), the
 *   own-email rule is dropped, so they see ONLY that client's widgets, not their
 *   own. When the active client IS one of their linked clients (their home),
 *   the own-email rule applies as normal.
 *
 *   Fallback: if the session carries no usable clientId (e.g. an old legacy
 *   Bearer token), we scope purely by the user's own email — the pre-existing
 *   behaviour, so nothing regresses for those sessions.
 *
 * Security: requires a valid session; never trusts a client-supplied clientId
 * or email from the query string. All formula inputs are validated/sanitised.
 */
import { requireAuth, sanitiseForFormula, setCors, applyRateLimit, RATE_LIMITS } from './_auth.js';
import { getRecord } from './_lib/auth/airtable.js';
import { USERS, CLIENTS } from './_lib/auth/schema.js';

const REC_ID_RE = /^rec[A-Za-z0-9]{14}$/;

// One read of the Users record gives us both the email (cookie JWTs don't
// carry it) and the linked-client list (to tell "home" from "impersonating").
async function loadUserFacts(user) {
  const facts = { linkedClientIds: [] };
  if (!user || !user.recordId) return facts;
  try {
    const u = await getRecord(USERS.tableId, user.recordId);
    if (!user.email) {
      const e = u?.fields?.[USERS.fields.email];
      if (typeof e === 'string' && e.trim()) user.email = e.trim();
    }
    const links = u?.fields?.[USERS.fields.client];
    if (Array.isArray(links)) {
      facts.linkedClientIds = links
        .map((x) => (typeof x === 'string' ? x : x && x.id))
        .filter((id) => typeof id === 'string' && REC_ID_RE.test(id));
    }
  } catch (err) {
    console.warn('[widget-list] loadUserFacts failed:', err.message);
  }
  return facts;
}

// Active client's login email, lowercased, so legacy client widgets (no
// ClientRecordId) can still be matched by ClientEmail. '' on any failure.
async function resolveActiveClientEmail(activeClientId) {
  try {
    const c = await getRecord(CLIENTS.tableId, activeClientId);
    const email = c?.fields?.[CLIENTS.fields.email];
    return typeof email === 'string' ? email.toLowerCase().trim() : '';
  } catch (err) {
    console.warn('[widget-list] resolve client email failed:', err.message);
    return '';
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

  // One Users read → hydrate email (cookie JWTs lack it) + linked clients.
  const { linkedClientIds } = await loadUserFacts(user);

  if (!user.email) {
    console.error('[widget-list] No email available for user', user.recordId);
    return res.status(401).json({ error: 'Could not resolve account email' });
  }

  // ── Rate limit (per-user, in-memory) ──────────────────────
  if (!applyRateLimit(res, `list:${user.email}`, RATE_LIMITS.widgetRead)) return;

  const userEmailLower = user.email.toLowerCase();
  const activeClientId =
    (typeof user.clientId === 'string' && REC_ID_RE.test(user.clientId))
      ? user.clientId
      : null;

  // Build the scope clauses (deduped before OR-ing).
  const clauses = new Set();
  let includeOwnEmail = true; // default: always see your own widgets

  if (activeClientId) {
    // Impersonating = the active client is NOT one of your linked clients.
    const isHome = linkedClientIds.includes(activeClientId);
    includeOwnEmail = isHome;

    clauses.add(`{ClientRecordId}='${activeClientId}'`); // activeClientId is REC_ID_RE-validated
    const activeClientEmail = await resolveActiveClientEmail(activeClientId);
    if (activeClientEmail) {
      clauses.add(`LOWER({ClientEmail})='${sanitiseForFormula(activeClientEmail)}'`);
    }
  }

  if (includeOwnEmail) {
    clauses.add(`LOWER({ClientEmail})='${sanitiseForFormula(userEmailLower)}'`);
  }

  const parts = Array.from(clauses);
  const formula = parts.length === 1 ? parts[0] : `OR(${parts.join(', ')})`;

  try {
    const url = `${AIRTABLE_API}/${AIRTABLE_BASE_ID}/${TABLE_NAME}`
      + `?filterByFormula=${encodeURIComponent(formula)}`
      + `&sort%5B0%5D%5Bfield%5D=UpdatedAt&sort%5B0%5D%5Bdirection%5D=desc&maxRecords=50`;

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
