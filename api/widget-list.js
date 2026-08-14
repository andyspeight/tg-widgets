/**
 * Widget List API (Hardened)
 * GET /api/widget-list → AUTHENTICATED.
 *
 * Scope model (v3 — strict per-client scoping):
 *
 *   When a session is inside a client workspace (active client), the list shows
 *   ONLY that client's widgets. You never see your own personal widgets, or any
 *   other client's, while working inside a client account:
 *       ClientRecordId === activeClientId            (authoritative, Stage 5+)
 *     OR AND(ClientRecordId is blank,                 (legacy client widgets,
 *            LOWER(ClientEmail) === active client email)  pre-ClientRecordId only)
 *
 *   ClientRecordId is the AUTHORITATIVE owner — the same rule canModifyWidget()
 *   uses to gate edits. ClientEmail is ONLY a legacy fallback for widgets that
 *   predate ClientRecordId (blank owner), so it is never applied to a widget that
 *   already has a ClientRecordId — two clients that share a contact/creator email
 *   must never leak into each other's lists.
 *
 *   Shared-email guard: the ClientEmail fallback assumes an email identifies one
 *   client. A user who owns several accounts set up under the same login email
 *   (e.g. a Travelgenix staff member) breaks that assumption, so when the active
 *   client's email is shared with another account the user belongs to, the email
 *   fallback is dropped and we scope by ClientRecordId alone.
 *
 *   Staff-email guard (23 Jul 2026, Worldchoice incident): a client account
 *   whose login email IS a staff address gets no email fallback either — a
 *   staff email never identifies one client, and the staff member's ownerless
 *   personal/test widgets would otherwise surface in that client's dashboard.
 *   The shared-email guard alone cannot catch this: it only compares against
 *   other accounts the LOGGED-IN user belongs to, and a client's own users
 *   belong to just their one account.
 *
 *   No own-email rule: previous versions also OR-ed in the logged-in user's own
 *   email so staff saw their personal widgets. That smeared a staff member's
 *   widgets across every client they work in, so it has been removed. A genuine
 *   single-account client still sees their own legacy widgets — they are matched
 *   as the ACTIVE CLIENT's widgets (their own email is the active client email).
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
import { isStaffEmail } from './_lib/auth/staff.js';

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

// True when ANOTHER client the user belongs to shares the active client's login
// email. The ClientEmail legacy fallback assumes an email identifies one client.
// That breaks for an owner who is a member of several accounts set up under the
// same email (e.g. a Travelgenix staff member): every account's ownerless legacy
// widgets would surface in each account. When the email is ambiguous we drop the
// email fallback entirely and scope by ClientRecordId alone, so each account
// shows only its own widgets. Unique-email clients are unaffected.
async function activeEmailIsShared(activeClientId, activeClientEmail, linkedClientIds) {
  if (!activeClientEmail) return false;
  const others = linkedClientIds.filter((id) => id !== activeClientId);
  if (!others.length) return false;
  const emails = await Promise.all(others.map(async (id) => {
    try {
      const c = await getRecord(CLIENTS.tableId, id);
      const e = c?.fields?.[CLIENTS.fields.email];
      return typeof e === 'string' ? e.toLowerCase().trim() : '';
    } catch (err) {
      console.warn('[widget-list] resolve linked client email failed:', err.message);
      return '';
    }
  }));
  return emails.some((e) => e && e === activeClientEmail);
}

// Pure Airtable filterByFormula builder for the scope. Kept side-effect-free and
// exported for tests — this is the security-critical isolation logic.
//   activeClientId    REC_ID_RE-validated id of the client being worked in, or null
//   activeClientEmail the active client's login email (lowercased), or ''
//   emailShared       true when that email is also a login for another account the
//                     user belongs to (so it can't identify one client)
//   userEmailLower    the logged-in user's own email, lowercased
function buildScopeFormula({ activeClientId, activeClientEmail, emailShared, userEmailLower, selfScope }) {
  // Self scope (the personal scheduler companion, ?scope=self): the CALLER'S OWN
  // widgets only, matched on their own login email, regardless of which client
  // the shared dashboard session is currently working in. This is what lets a
  // staff member still see their own booking pages while acting inside a client
  // account. userEmailLower is derived server-side from the authenticated
  // session, NEVER from the query, so this can only ever return the caller's
  // own-email widgets — it grants no cross-client visibility and it never touches
  // the strict default path the dashboard uses. Does NOT reintroduce the
  // Worldchoice leak: that was a CLIENT's dashboard showing staff widgets; this
  // is the staff member's own private view showing their own widgets.
  if (selfScope && userEmailLower) {
    return `LOWER({ClientEmail})='${sanitiseForFormula(userEmailLower)}'`;
  }

  const LEGACY = `{ClientRecordId}=''`;
  const clauses = new Set();

  if (activeClientId) {
    // Authoritative owner.
    clauses.add(`{ClientRecordId}='${activeClientId}'`); // activeClientId is REC_ID_RE-validated
    // The active client's own LEGACY (blank ClientRecordId) widgets, matched by
    // their login email — but only when that email is unambiguous. The logged-in
    // user's own widgets are deliberately NOT added: inside a client account only
    // that client's widgets appear.
    if (activeClientEmail && !emailShared) {
      clauses.add(`AND(${LEGACY}, LOWER({ClientEmail})='${sanitiseForFormula(activeClientEmail)}')`);
    }
  } else {
    // No usable client context (e.g. an old legacy Bearer token): scope purely by
    // the user's own email — the original pre-ClientRecordId behaviour.
    clauses.add(`LOWER({ClientEmail})='${sanitiseForFormula(userEmailLower)}'`);
  }

  const parts = Array.from(clauses);
  return parts.length === 1 ? parts[0] : `OR(${parts.join(', ')})`;
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
  // The personal scheduler companion requests ?scope=self to get the caller's
  // OWN widgets regardless of the active client (see buildScopeFormula). Every
  // other caller (the dashboard) omits it and keeps the strict per-client scope.
  const selfScope = !!(req.query && req.query.scope === 'self');
  const activeClientId =
    (typeof user.clientId === 'string' && REC_ID_RE.test(user.clientId))
      ? user.clientId
      : null;

  // Resolve the async inputs, then build the formula with the pure helper below.
  // Skipped for scope=self — it needs neither, and this saves the Airtable reads.
  const activeClientEmail = (!selfScope && activeClientId) ? await resolveActiveClientEmail(activeClientId) : '';
  // The email fallback is dropped whenever the active client's email cannot
  // identify exactly one client. Two ways that happens:
  //   1. STAFF EMAIL: the client account was set up under a Travelgenix staff
  //      address (staff configure accounts for clients, so this occurs in the
  //      wild — Worldchoice Sports, 23 Jul 2026). A staff member's ownerless
  //      personal/test widgets share that same ClientEmail, and without this
  //      guard every one of them surfaced in the CLIENT's dashboard. The
  //      shared-email check below cannot catch it because it only compares
  //      against OTHER accounts the logged-in user belongs to, and the
  //      client's users belong to one account.
  //   2. SHARED EMAIL: the same login email owns several accounts the user
  //      belongs to (the existing guard).
  const emailShared = (!selfScope && activeClientId)
    ? (isStaffEmail(activeClientEmail)
        || await activeEmailIsShared(activeClientId, activeClientEmail, linkedClientIds))
    : false;

  const formula = buildScopeFormula({ activeClientId, activeClientEmail, emailShared, userEmailLower, selfScope });

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

// Test surface — pure scope-formula logic, no network.
export const _test = { buildScopeFormula };
