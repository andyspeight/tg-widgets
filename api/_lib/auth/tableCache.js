/**
 * A tiny in-memory cache for whole-table Airtable reads, keyed by table id.
 *
 * GET /api/auth/me used to read four Control tables end to end on every sign-in
 * check (the product catalogue, products, package rules and client
 * entitlements), none of them cached. Those tables are the same for everyone and
 * barely change, and even the client entitlements only need to be fresh within a
 * short window, so re-reading them on every request was the bulk of the latency
 * and burned through Airtable's five-requests-a-second budget. Holding each table
 * for a short TTL in the warm lambda turns those four reads into near zero once
 * warm.
 *
 * Per-instance (Vercel may run several at once), which is fine: each warms on its
 * own and a change still lands within the TTL. The clock and the fetcher are
 * injectable so this stays unit-testable with no network.
 */

import { listAllRecords } from './airtable.js';

const _cache = new Map(); // tableId -> { at, records }

export async function cachedListAll(tableId, ttlMs, { now = Date.now(), fetchFn = listAllRecords } = {}) {
  const hit = _cache.get(tableId);
  if (hit && (now - hit.at) < ttlMs) return hit.records;
  const records = await fetchFn(tableId);
  _cache.set(tableId, { at: now, records });
  return records;
}

// Test-only: clear the cache between cases.
export function _resetTableCache() { _cache.clear(); }
