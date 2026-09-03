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

/** True for the widget ids we mint (tgw_...), demo ids and anything id-like. */
export function isCountableId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_.-]{4,60}$/.test(id);
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
