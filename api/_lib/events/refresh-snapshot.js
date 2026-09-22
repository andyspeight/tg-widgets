/**
 * api/_lib/events/refresh-snapshot.js — pull the sheet, rebuild, store
 *
 * One implementation, two callers: the six-hourly cron and the Refresh now
 * button on the staff page. Andy, 22 Sep 2026: "I will be giving you weekly
 * updates so we need a simple way to do it." The simple way is that nobody has
 * to do anything, because the cron picks the sheet up on its own; the button
 * exists so a change made five minutes ago does not wait up to six hours.
 *
 * Two copies of this would drift, and the one that drifts is always the one
 * nobody watches.
 */
import { put } from '@vercel/blob';
import { fetchSupplierRows, sheetConfigured, SUPPLIER_SHEET_ID } from './supplier-sheet.js';
import { buildSnapshot, SNAPSHOT_BLOB_PATH } from './build-snapshot.js';

/**
 * A rebuild that produced far less than what we are already serving is a
 * symptom, not an update: a half-written sheet, a renamed column, a partial
 * read. Serving last week's events beats serving a tenth of them, so a shrink
 * past this is reported and NOT stored.
 */
const MIN_KEEP_RATIO = 0.5;

/**
 * The PUBLIC blob store's token.
 *
 * The project has two stores: tg-widgets-public and tg-widgets-blob. The
 * default BLOB_READ_WRITE_TOKEN points at the PRIVATE one, which rejects an
 * access:'public' write with "Cannot use public access on a private store".
 * The offer photo and logo uploads already hit this and already resolve it the
 * same way, so the snapshot does too rather than inventing a third answer.
 *
 * It has to be the public store: the feed reads the snapshot back over plain
 * HTTP on a cold start, with no token to hand.
 */
function blobToken() {
  return process.env.TG_Blob_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN || '';
}

/** What is stored right now, without rebuilding anything. */
export async function currentStoredSnapshot() {
  const token = blobToken();
  if (!token) return null;
  try {
    const { head } = await import('@vercel/blob');
    const meta = await head(SNAPSHOT_BLOB_PATH, { token });
    if (!meta || !meta.url) return null;
    const res = await fetch(meta.url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const snap = await res.json();
    return {
      url: meta.url,
      uploadedAt: meta.uploadedAt || null,
      size: meta.size || null,
      generatedAt: snap.generatedAt || null,
      source: snap.source || null,
      counts: snap.counts || null,
    };
  } catch {
    // No refresh has run yet, which is the ordinary state on day one.
    return null;
  }
}

/**
 * Read the sheet, rebuild the snapshot and store it.
 *
 * Never throws: returns { ok, stored, ... } with a reason a person can act on,
 * because the failures that actually happen are "the sheet is not shared" and
 * "a column was renamed", and both need a human rather than a retry.
 */
export async function refreshEventsSnapshot() {
  const started = Date.now();
  const fail = (error, extra = {}) => ({ ok: false, stored: false, error, ms: Date.now() - started, ...extra });

  if (!sheetConfigured()) return fail('Google service account credentials are not set.');
  if (!blobToken()) return fail('No Blob read-write token is set, so there is nowhere to put the snapshot.');

  let previous = null;
  try {
    const cur = await currentStoredSnapshot();
    previous = cur && cur.counts ? cur.counts.events : null;
  } catch { /* first run */ }

  try {
    const { rows, rowCount } = await fetchSupplierRows();

    // notBefore trims the past at BUILD time as well as at read time. The feed
    // clamps every view to today anyway, so this is only about size: a year of
    // expired rows is a third of the file for nobody's benefit. Two days of
    // slack keeps today's fixtures safe whatever timezone the rows are in.
    const notBefore = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
    const snapshot = buildSnapshot(rows, {
      notBefore,
      generatedAt: new Date().toISOString().slice(0, 10),
      source: `google-sheet:${SUPPLIER_SHEET_ID.slice(0, 8)}`,
    });

    if (previous && snapshot.counts.events < previous * MIN_KEEP_RATIO) {
      return fail('the rebuild came back far smaller than what is already live, so it was not stored', {
        rowsIn: rowCount, events: snapshot.counts.events, previous,
      });
    }

    const body = JSON.stringify(snapshot);
    const blob = await put(SNAPSHOT_BLOB_PATH, body, {
      access: 'public',          // public event listings, and the feed reads it
      contentType: 'application/json',
      addRandomSuffix: false,    // one stable path the feed can find without being told
      allowOverwrite: true,
      cacheControlMaxAge: 300,
      token: blobToken(),        // the PUBLIC store, see above
    });

    return {
      ok: true,
      stored: true,
      url: blob.url,
      rowsIn: rowCount,
      generatedAt: snapshot.generatedAt,
      previousEvents: previous,
      events: snapshot.counts.events,
      teams: snapshot.counts.teams,
      venues: snapshot.counts.venues,
      competitions: snapshot.counts.competitions,
      bytes: body.length,
      ms: Date.now() - started,
    };
  } catch (err) {
    return fail((err && err.message) || 'failed');
  }
}
