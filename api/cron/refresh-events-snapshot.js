/**
 * Cron: rebuild the events snapshot from the supplier Google Sheet.
 *
 * WHY (22 Sep 2026). The event feed is a Google Sheet Darren keeps up to date,
 * not a file anybody sends us. Andy: "it's a Google Sheet, so it is always
 * being updated, it's not a fixed point in time." The snapshot every ticket
 * widget reads was built on 21 August from a single read of that sheet and
 * committed, so a month later the sheet had moved on while the widgets were
 * still offering August's inventory. A client reported very few matches and
 * tickets that had gone, and both were that staleness rather than the sheet.
 *
 * Same shape as the offer cache: a cron fills it on our schedule, a visitor
 * never triggers the read, and the widgets read what is stored.
 *
 * The work itself lives in api/_lib/events/refresh-snapshot.js, because the
 * staff Refresh now button does exactly the same thing and the two must not
 * drift. This file is the schedule and the door.
 *
 * AUTH: Authorization: Bearer ${CRON_SECRET} (same convention as the others).
 */
import { refreshEventsSnapshot } from '../_lib/events/refresh-snapshot.js';

export default async function handler(req, res) {
  const auth = req.headers['authorization'] || '';
  const secret = process.env.CRON_SECRET || '';
  if (!secret || auth !== `Bearer ${secret}`) {
    res.statusCode = 401;
    return res.end('Unauthorized');
  }

  const result = await refreshEventsSnapshot();
  if (result.ok) console.log('[cron/refresh-events-snapshot]', JSON.stringify(result));
  else console.error('[cron/refresh-events-snapshot] not stored:', result.error);

  // 200 even when it could not store: the cron did its job by reporting, and a
  // 500 would page somebody about a spreadsheet that needs sharing.
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  return res.end(JSON.stringify(result));
}
