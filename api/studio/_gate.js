/**
 * TG Studio — access gate (shared by capture.js and refine.js)
 *
 * TG Studio is an Ignite / Bespoke product (locked with Andy 2026-07-09).
 * Gating is enforced server-side, never trusted to the client.
 *
 * Rules, in order:
 *   1. Travelgenix staff (a STAFF_DOMAINS email) always pass, so the team can
 *      demo and set up. Mirrors the entitlement staff bypass in widget-config.
 *   2. Otherwise the client's plan must be Ignite or Bespoke.
 *
 * Plan resolution mirrors widget-config: use user.plan from the JWT if present,
 * else resolve it from the Clients table by clientId. Unknown plan denies.
 */

import { resolveClientPlan } from '../_lib/auth/plan.js';
import { isStaffEmail } from '../_lib/auth/staff.js';

const STUDIO_PLANS = new Set(['Ignite', 'Bespoke']);
const PLAN_ALIASES = { spark: 'Spark', boost: 'Boost', ignite: 'Ignite', bespoke: 'Bespoke' };

function canonicalisePlan(raw) {
  if (typeof raw !== 'string') return null;
  const t = raw.trim().toLowerCase();
  if (!t) return null;
  // Tolerate a suffix like "Ignite Plan": match on the first known word.
  for (const key of Object.keys(PLAN_ALIASES)) {
    if (t === key || t.startsWith(key + ' ')) return PLAN_ALIASES[key];
  }
  return null;
}

/**
 * @param {object} user — the user object from requireAuth()
 * @returns {Promise<{ ok: true, plan: string } | { ok: false, status: number, plan: string|null, error: string }>}
 */
export async function requireStudioAccess(user) {
  // 1. Staff bypass (email present only; cookie sessions may lack it — those
  //    fall through to the plan check, which is the correct default).
  if (user && typeof user.email === 'string' && isStaffEmail(user.email)) {
    return { ok: true, plan: 'Staff' };
  }

  // 2. Plan check
  let plan = canonicalisePlan(user && user.plan);
  if (!plan && user && typeof user.clientId === 'string') {
    try { plan = canonicalisePlan(await resolveClientPlan(user.clientId)); }
    catch (err) { console.warn('[studio-gate] plan resolve failed:', err.message); }
  }

  if (plan && STUDIO_PLANS.has(plan)) return { ok: true, plan };

  return {
    ok: false,
    status: 403,
    plan: plan || null,
    error: 'TG Studio is available on the Ignite and Bespoke plans. Upgrade to unlock it.',
  };
}
