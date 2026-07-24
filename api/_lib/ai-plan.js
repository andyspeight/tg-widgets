/**
 * Shared AI plan gate — one source of truth for "is this account entitled to
 * paid AI, and what is its daily cap".
 *
 * Used by the endpoints that spend money on the model: widget-ai (generation +
 * rewrite), faq-translate and enquiry-translate. Resolving the plan FRESH from
 * Airtable (not the session token) means:
 *   - a plan upgrade/downgrade takes effect immediately, and
 *   - a Spark or suspended account is denied even with a still-valid token,
 *     which the current SSO cookie needs because it carries no plan at all.
 *
 * Kept deliberately small and pure where possible so it is unit-tested directly.
 */

// Per-plan daily AI caps. 0 = not entitled (blocked); a positive number is the
// per-day call ceiling. Kept in the four canonical Title-Case tiers.
export const PLAN_DAILY_LIMITS = {
  Spark:   0,   // blocked
  Boost:   15,
  Ignite:  40,
  Bespoke: 100,
};

// The Clients table (named "Users" before May 2026). Same id + plan field that
// widget-ai.js reads. Display name for Status is used in the formula (Airtable
// silently matches nothing for a field ID inside {braces}); reads are id-keyed.
const CLIENTS_TABLE = process.env.AIRTABLE_USERS_TABLE || 'tblikekpaTKraMktZ';
const FIELD_PLAN        = 'fldBgDeQdtwMqTIS4';
const FIELD_NAME_EMAIL  = 'Email';
const FIELD_NAME_STATUS = 'Status';
const LOOKUP_TIMEOUT_MS = 8000;

function planHeaders() {
  const pat = process.env.AIRTABLE_PAT;
  if (!pat) throw new Error('AIRTABLE_PAT not configured');
  return { Authorization: `Bearer ${pat}` };
}

async function fetchClientByFormula(formula) {
  const base = process.env.AIRTABLE_BASE_ID || 'appAYzWZxvK6qlwXK';
  const url = `https://api.airtable.com/v0/${base}/${encodeURIComponent(CLIENTS_TABLE)}`
    + `?filterByFormula=${encodeURIComponent(formula)}&maxRecords=1&returnFieldsByFieldId=true`;
  // Bound the read so a slow Airtable returns a clean error instead of running
  // the function to its platform kill (the systemic timeout convention).
  const res = await fetch(url, { headers: planHeaders(), signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Airtable GET ${res.status}`);
  const data = await res.json();
  return (data.records || [])[0] || null;
}

function planOf(rec) {
  const raw = rec && rec.fields ? rec.fields[FIELD_PLAN] : null;
  return typeof raw === 'string' ? raw : (raw && raw.name) || '';
}

/**
 * Resolve the account's plan fresh from Airtable, Active-gated. Accepts a
 * session user ({ email?, clientId?, recordId? }) — resolves by record id
 * (current SSO cookie) or by email (legacy bearer token), whichever is present.
 *
 * Returns { recordId, plan } on an active account, or null when no active
 * account matches (a real "denied"). THROWS only on an Airtable/transport error,
 * so the caller can tell "denied" (null) apart from "try again" (throw) and fail
 * closed on the latter.
 */
export async function resolveClientPlan(user) {
  const email = String((user && user.email) || '').toLowerCase().trim();
  const recordId = String((user && (user.clientId || user.recordId)) || '').trim();

  let rec = null;
  if (/^rec[A-Za-z0-9]{14,20}$/.test(recordId)) {
    rec = await fetchClientByFormula(`AND(RECORD_ID()='${recordId}',{${FIELD_NAME_STATUS}}='Active')`);
  }
  if (!rec && /^[^\s@"']+@[^\s@"']+\.[^\s@"']+$/.test(email) && email.length <= 254) {
    const safe = email.replace(/'/g, "\\'");
    rec = await fetchClientByFormula(`AND(LOWER({${FIELD_NAME_EMAIL}})='${safe}',{${FIELD_NAME_STATUS}}='Active')`);
  }
  if (!rec) return null;
  return { recordId: rec.id, plan: planOf(rec) };
}

/**
 * Given a plan name, whether AI is allowed and the daily cap. Pure.
 * Returns { allowed, limit, reason } — reason is a client-safe message when
 * !allowed (unknown plan vs. entitled-but-Spark get different guidance).
 */
export function aiEntitlement(plan) {
  const limit = PLAN_DAILY_LIMITS[plan];
  if (limit === undefined) {
    return { allowed: false, limit: 0, reason: 'Your plan does not support AI features. Contact support.' };
  }
  if (limit === 0) {
    return { allowed: false, limit: 0, reason: 'AI features require a Boost plan or higher. Upgrade to unlock.' };
  }
  return { allowed: true, limit, reason: '' };
}
