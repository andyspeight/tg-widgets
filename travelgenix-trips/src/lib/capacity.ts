// =============================================================================
//  lib/capacity.ts
// =============================================================================
//
//  The capacity rule, ported unchanged from api/_lib/trips/supabase.js.
//
//  Locked 7 Aug 2026: a place is taken by a deposit_paid or paid booking always,
//  and by a pending booking only while its hold has NOT expired. A pending row
//  with no hold_expires_at is treated as a fresh hold and still counts, because
//  it is the cron sweep that moves a genuinely stale pending to 'expired'.
//  cancelled and expired never count.
//
//  The only thing gt_002 changes is what we count against: a departure, rather
//  than a tgw_ widget id. The arithmetic is identical and stays pure so the
//  expiry edge is unit-tested without a live database.
//
// =============================================================================

/** Statuses that can occupy a place. 'pending' is conditional on the hold. */
export const COUNTING_STATUSES = ['pending', 'deposit_paid', 'paid'] as const;

export interface CountableBooking {
  party_size: number;
  status: string;
  hold_expires_at?: string | null;
}

export interface Availability {
  capacity: number;
  taken: number;
  remaining: number;
  soldOut: boolean;
}

/**
 * How many places a set of booking rows occupies right now. Pure on purpose.
 */
export function computeSpotsTaken(rows: CountableBooking[], nowMs: number = Date.now()): number {
  if (!Array.isArray(rows)) return 0;

  let taken = 0;
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;

    const size = Number(r.party_size);
    if (!Number.isFinite(size) || size <= 0) continue;

    if (r.status === 'deposit_paid' || r.status === 'paid') {
      taken += size;
    } else if (r.status === 'pending') {
      const exp = r.hold_expires_at ? Date.parse(r.hold_expires_at) : NaN;
      // Unparseable or absent expiry means a fresh, unexpired hold.
      if (!Number.isFinite(exp) || exp > nowMs) taken += size;
    }
  }
  return taken;
}

/** Turn a capacity and a set of rows into the shape the UI renders. */
export function summarise(
  capacity: number,
  rows: CountableBooking[],
  nowMs: number = Date.now(),
): Availability {
  const cap = Math.max(0, Number.parseInt(String(capacity), 10) || 0);
  const taken = computeSpotsTaken(rows, nowMs);
  const remaining = Math.max(0, cap - taken);
  return { capacity: cap, taken, remaining, soldOut: cap > 0 && remaining <= 0 };
}
