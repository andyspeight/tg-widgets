// =============================================================================
//  /api/_lib/trips/supabase.js
// =============================================================================
//
//  Server-only access to the Group Trips database (its own Supabase project,
//  separate from the widget-telemetry one — hence the TRIPS_ prefixed env
//  vars). The browser NEVER connects: RLS is on with no policies, so only this
//  service-role key can read or write. Raw PostgREST over fetch, no client
//  dependency (matches api/_lib/telemetry.js).
//
//  This module is the capacity source of truth for availability (GT-3) and,
//  later, the transactional hold on booking (GT-5).
//
//    Env: TRIPS_SUPABASE_URL, TRIPS_SUPABASE_SERVICE_ROLE_KEY
//
// =============================================================================

const SUPABASE_URL = (process.env.TRIPS_SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE_KEY = process.env.TRIPS_SUPABASE_SERVICE_ROLE_KEY || '';

// Statuses that occupy a place. 'pending' is conditional on the hold not having
// expired — see computeSpotsTaken. 'cancelled' and 'expired' never occupy.
export const COUNTING_STATUSES = ['pending', 'deposit_paid', 'paid'];

export function tripsDbConfigured() {
  return !!(SUPABASE_URL && SERVICE_KEY);
}

/**
 * Low-level PostgREST request against the group-trips project. The service-role
 * key bypasses RLS. Bounded by a timeout so a slow database can never hold a
 * function open. Throws on non-2xx; returns parsed JSON (or null on 204).
 */
export async function sbRequest(path, { method = 'GET', body, headers, timeoutMs = 4000 } = {}) {
  if (!tripsDbConfigured()) throw new Error('Trips DB not configured');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      method,
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        ...(headers || {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      const err = new Error(`Supabase ${res.status}: ${t.slice(0, 200)}`);
      err.statusCode = res.status;
      throw err;
    }
    if (res.status === 204) return null;
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Pure: how many places a set of booking rows occupies right now.
 *
 * Capacity rule (handover §4): a place is taken by any deposit_paid or paid
 * booking, and by a pending booking whose hold has NOT yet expired. A pending
 * row with no hold_expires_at is treated as a fresh hold (still counts) — the
 * cron sweep is what moves a genuinely stale pending to 'expired'. Anything
 * else (cancelled, expired, unknown) never counts.
 *
 * Kept pure and exported so the capacity maths — including the expiry edge —
 * is unit-tested without a live database.
 *
 * @param {Array<{party_size:number,status:string,hold_expires_at?:string}>} rows
 * @param {number} nowMs
 * @returns {number}
 */
export function computeSpotsTaken(rows, nowMs = Date.now()) {
  if (!Array.isArray(rows)) return 0;
  let taken = 0;
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const size = Number(r.party_size);
    if (!Number.isFinite(size) || size <= 0) continue;
    const status = r.status;
    if (status === 'deposit_paid' || status === 'paid') {
      taken += size;
    } else if (status === 'pending') {
      const exp = r.hold_expires_at ? Date.parse(r.hold_expires_at) : NaN;
      // Unparseable / absent expiry => treat as a fresh, unexpired hold.
      if (!Number.isFinite(exp) || exp > nowMs) taken += size;
    }
  }
  return taken;
}

/**
 * Availability for one trip, keyed on the public widget id (tgw_…, the value
 * stored in gt_bookings.widget_id). Returns counts only — never any traveller
 * data. `capacity` comes from the widget's saved config, resolved server-side
 * by the caller (never trust the browser for it).
 *
 * @returns {Promise<{capacity:number,taken:number,remaining:number,soldOut:boolean}>}
 */
export async function getTripAvailability(widgetId, capacity, nowMs = Date.now()) {
  const cap = Math.max(0, parseInt(capacity, 10) || 0);
  const statuses = COUNTING_STATUSES.join(',');
  const path =
    `gt_bookings?widget_id=eq.${encodeURIComponent(widgetId)}` +
    `&status=in.(${statuses})` +
    `&select=party_size,status,hold_expires_at`;
  const rows = await sbRequest(path);
  const taken = computeSpotsTaken(rows, nowMs);
  const remaining = Math.max(0, cap - taken);
  return { capacity: cap, taken, remaining, soldOut: cap > 0 && remaining <= 0 };
}
