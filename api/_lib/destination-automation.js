/**
 * The pause switch for every automated process that writes to the Destination
 * Content base (appuZdlMJ7HKUt6qS) — Countries, Cities and Regions, Resorts and
 * Areas, Airports, Theme Parks and Attractions.
 *
 * WHY THIS EXISTS. Paused 10 Sep 2026 at Andy's instruction, ahead of the
 * destination dashboard and the data expansion that follows it. The dashboard
 * measures coverage and gaps across 1,539 records. A background job that
 * re-stamps a Verified Date, flips a Status or creates a Draft skeleton while
 * that measurement is being read makes the numbers lie, and makes a gap that was
 * closed by hand look like one that closed itself. So the writes stop until the
 * data work is deliberately driven from the dashboard.
 *
 * WHAT IT GATES. Every write path into that base:
 *   - api/cron/reference-freshness.js   (was scheduled daily 04:00; entry also
 *                                        removed from vercel.json crons)
 *   - api/cron/reference-climate.js     (already unscheduled)
 *   - api/cron/reference-identity.js    (already unscheduled)
 *   - api/reference/refresh.js          (manual POST)
 *   - api/reference/identity-backfill.js(manual POST)
 *   - api/reference/breadth-fill.js     (manual POST)
 *
 * Read-only routes are deliberately NOT gated. /api/reference/coverage,
 * /api/reference/breadth, /api/reference/export, the destination search and
 * content endpoints and the dashboard itself all keep working while paused —
 * pausing is meant to freeze the data, not blind us to it.
 *
 * HOW TO LIFT IT. Either set DESTINATION_AUTOMATION=on in Vercel (takes effect
 * without a deploy) or flip PAUSED_BY_DEFAULT below and redeploy. Restore the
 * reference-freshness entry in vercel.json at the same time, or the daily
 * re-verify stays off however this switch reads.
 */

/**
 * The committed position. `true` means paused unless an env var says otherwise,
 * so a fresh deploy cannot quietly resume the writes.
 */
export const PAUSED_BY_DEFAULT = true;

/** The date and reason, surfaced by the dashboard so the pause explains itself. */
export const PAUSE_NOTE = {
  since: '2026-09-10',
  reason: 'Paused for the destination dashboard build and the data expansion that follows it.',
};

/**
 * Is destination-content automation currently paused?
 *
 * DESTINATION_AUTOMATION=on|live   -> running
 * DESTINATION_AUTOMATION=off|paused-> paused
 * unset / anything else            -> PAUSED_BY_DEFAULT
 */
export function destinationAutomationPaused() {
  const raw = String(process.env.DESTINATION_AUTOMATION || '').trim().toLowerCase();
  if (raw === 'on' || raw === 'live' || raw === 'running') return false;
  if (raw === 'off' || raw === 'paused') return true;
  return PAUSED_BY_DEFAULT;
}

/**
 * Guard for a route that writes to the destination base. Returns true and ends
 * the response when paused, so a handler reads:
 *
 *   if (haltIfPaused(res, 'cron/reference-freshness')) return;
 *
 * 200 rather than 503 on purpose: a paused cron is a healthy cron doing exactly
 * what it was told, and a 5xx here would page us every night for a month.
 */
export function haltIfPaused(res, processName) {
  if (!destinationAutomationPaused()) return false;
  const body = {
    ok: true,
    skipped: true,
    paused: true,
    process: processName,
    since: PAUSE_NOTE.since,
    reason: PAUSE_NOTE.reason,
    resume: 'Set DESTINATION_AUTOMATION=on, or flip PAUSED_BY_DEFAULT in api/_lib/destination-automation.js.',
  };
  console.log('[destination-automation] paused, skipped', processName);
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
  return true;
}
