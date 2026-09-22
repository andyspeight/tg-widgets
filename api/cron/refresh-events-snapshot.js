/**
 * Cron: rebuild the events snapshot from the supplier Google Sheet.
 *
 * WHY (22 Sep 2026). The event feed is a Google Sheet Darren keeps up to date,
 * not a file anybody sends us. Andy: "it's a Google Sheet, so it is always
 * being updated, it's not a fixed point in time." The snapshot every ticket
 * widget reads was built on 21 August from a single read of that sheet and
 * committed, so a month later the sheet had moved on while the widgets were
 * still offering August's inventory. A client reported very few matches and
 * tickets that turned out to be gone, and both were that staleness rather than
 * anything wrong with the sheet.
 *
 * This is the same shape as the offer cache: a cron fills it on our schedule,
 * a visitor never triggers the read, and the widgets read what is stored.
 *
 * WHERE IT GOES. Vercel Blob, not the repo, because a cron cannot commit and
 * the snapshot is a few megabytes. api/events-feed.js prefers the stored one
 * and falls back to the committed file, so a failed or never-run refresh
 * degrades to exactly today's behaviour rather than to an empty site.
 *
 * WHAT IT NEEDS. The supplier sheet shared with GOOGLE_SERVICE_ACCOUNT_EMAIL
 * as a viewer, and BLOB_READ_WRITE_TOKEN. Without either it reports why and
 * changes nothing.
 *
 * AUTH: Authorization: Bearer ${CRON_SECRET} (same convention as the others).
 */
import { put } from '@vercel/blob';
import { fetchSupplierRows, sheetConfigured, SUPPLIER_SHEET_ID } from '../_lib/events/supplier-sheet.js';
import { buildSnapshot, SNAPSHOT_BLOB_PATH } from '../_lib/events/build-snapshot.js';

/**
 * A rebuild that produced far less than what we are already serving is a
 * symptom, not an update: a half-written sheet, a renamed column, a partial
 * read. Serving last week's events beats serving a tenth of them, so a shrink
 * past this is reported and NOT stored.
 */
const MIN_KEEP_RATIO = 0.5;

export default async function handler(req, res) {
  const auth = req.headers['authorization'] || '';
  const secret = process.env.CRON_SECRET || '';
  if (!secret || auth !== `Bearer ${secret}`) {
    res.statusCode = 401;
    return res.end('Unauthorized');
  }

  const json = (status, body) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    return res.end(JSON.stringify(body));
  };

  if (!sheetConfigured()) {
    return json(500, { ok: false, error: 'Google service account credentials are not set.' });
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return json(500, { ok: false, error: 'BLOB_READ_WRITE_TOKEN is not set, so there is nowhere to put the snapshot.' });
  }

  const started = Date.now();
  try {
    const { rows, rowCount } = await fetchSupplierRows();

    // notBefore trims the past at BUILD time as well as at read time. The feed
    // API already clamps every view to today, so this is only about size: a
    // year of expired rows is a third of the file for no one's benefit.
    const notBefore = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
    const snapshot = buildSnapshot(rows, {
      notBefore,
      generatedAt: new Date().toISOString().slice(0, 10),
      source: `google-sheet:${SUPPLIER_SHEET_ID.slice(0, 8)}`,
    });

    const previous = Number(process.env.TG_EVENTS_LAST_COUNT || 0) || null;
    if (previous && snapshot.counts.events < previous * MIN_KEEP_RATIO) {
      return json(200, {
        ok: false,
        stored: false,
        reason: 'the rebuild came back far smaller than what is already live, so it was not stored',
        rowsIn: rowCount,
        events: snapshot.counts.events,
        previous,
      });
    }

    const body = JSON.stringify(snapshot);
    const blob = await put(SNAPSHOT_BLOB_PATH, body, {
      access: 'public',              // it is public event listings, and the feed API reads it
      contentType: 'application/json',
      addRandomSuffix: false,        // one stable path the feed can read every time
      allowOverwrite: true,
      cacheControlMaxAge: 300,
    });

    const out = {
      ok: true,
      stored: true,
      url: blob.url,
      rowsIn: rowCount,
      generatedAt: snapshot.generatedAt,
      events: snapshot.counts.events,
      teams: snapshot.counts.teams,
      venues: snapshot.counts.venues,
      competitions: snapshot.counts.competitions,
      bytes: body.length,
      ms: Date.now() - started,
    };
    console.log('[cron/refresh-events-snapshot]', JSON.stringify(out));
    return json(200, out);
  } catch (err) {
    const message = (err && err.message) || 'failed';
    console.error('[cron/refresh-events-snapshot] error:', message);
    // Deliberately 200 with ok:false for the credential and shape problems: the
    // cron did its job by reporting, and a 500 would page somebody for a
    // spreadsheet that needs sharing.
    return json(200, { ok: false, stored: false, error: message, ms: Date.now() - started });
  }
}
