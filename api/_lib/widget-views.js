/**
 * Per-widget view counters.
 *
 * Every widget that reports the one-time "load" heartbeat to /api/widget-log
 * increments two Redis counters: all time, and this calendar month. The
 * dashboard reads them through /api/widget-list. Nothing else ever wrote the
 * Airtable Views field, so until 3 Sep 2026 "created" and "embedded" were
 * indistinguishable; these counters are what tells them apart.
 *
 * Keys are versioned so the scheme can change without a migration.
 */
export const VIEWS_PREFIX = 'widget:views:v1:';
export const MONTH_TTL_SECONDS = 62 * 24 * 60 * 60;   // a month bucket lives ~2 months
// The all-time counter is not permanent either. A widget that stops being
// embedded should not hold a key in this store forever, and the TTL is long
// enough that any live embed refreshes it on its next load.
export const ALLTIME_TTL_SECONDS = 400 * 24 * 60 * 60;

// The counter is fed by a PUBLIC endpoint, and every key it creates lands in
// the same Upstash instance as the world-map and offers caches — a store whose
// stated invariant is that its keys never expire. So only ids WE mint are
// counted: a loose pattern let anyone POST arbitrary strings and mint unbounded
// permanent keys. tgw_<epoch ms>_<suffix> is the shape /api/widget-config
// issues; the demo ids are the handful of fixed records used by the demo pages.
const MINTED_ID = /^tgw_[0-9]{10,16}_[A-Za-z0-9]{4,12}$/;
const DEMO_IDS = new Set(['tgs_demo_greece']);

/** True only for a widget id this platform actually issued. */
export function isCountableId(id) {
  return typeof id === 'string' && (MINTED_ID.test(id) || DEMO_IDS.has(id));
}

/** Month bucket label for a date, e.g. 202609. */
export function monthBucket(date) {
  const d = date instanceof Date ? date : new Date();
  return String(d.getUTCFullYear()) + String(d.getUTCMonth() + 1).padStart(2, '0');
}

/** The two counter keys for a widget id. */
export function viewKeys(widgetId, date) {
  return {
    allTime: VIEWS_PREFIX + widgetId,
    month: VIEWS_PREFIX + widgetId + ':' + monthBucket(date),
  };
}
