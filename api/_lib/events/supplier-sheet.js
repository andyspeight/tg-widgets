/**
 * api/_lib/events/supplier-sheet.js — read the supplier feed from its Sheet
 *
 * The event feed is a Google Sheet that Darren keeps up to date, not a file
 * anybody sends us (Andy, 22 Sep 2026: "it's a Google Sheet, so it is always
 * being updated, it's not a fixed point in time"). The snapshot the widgets
 * read was built on 21 Aug 2026 from a one-off read of it and never refreshed,
 * so by late September the sheet had moved on by a month while every widget was
 * still offering August's inventory. That is most of "very few matches
 * available" and most of the tickets that turned out to be gone.
 *
 * So the platform reads the sheet itself, on a schedule, the same way the offer
 * cache is filled by a cron rather than by a visitor.
 *
 * Credentials are the service account the lead-routing Sheets destination
 * already uses, with a READ-ONLY scope: this pass never writes to a client's
 * spreadsheet or to the supplier's. The sheet must be shared with
 * GOOGLE_SERVICE_ACCOUNT_EMAIL (viewer is enough) or the read 403s and the
 * feed keeps serving the committed snapshot.
 *
 * 22 Sep 2026.
 */
import { getAccessToken } from '../../enquiry/_lib/routing/google-sheets.js';

/** Read-only. This pass has no business writing to anybody's spreadsheet. */
const READ_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';

/** The supplier feed. Overridable so a test or a second feed can point elsewhere. */
export const SUPPLIER_SHEET_ID =
  process.env.TG_EVENTS_SHEET_ID || '1gvZH9EWxpLygjnkn0EwlBeIXHEjMmcLFjTAH_KYkfB8';

/** A1 range. Columns A to G are the seven the feed has always had. */
const RANGE = process.env.TG_EVENTS_SHEET_RANGE || 'A:G';

/** Sanity bounds. A feed this far outside its usual size is not one we trust. */
const MIN_ROWS = 100;
const MAX_ROWS = 200000;

export function sheetConfigured() {
  return !!(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY);
}

/**
 * Every row of the supplier sheet, as objects keyed by its header row.
 *
 * Returns { rows, headers, rowCount, sheetId }. Throws with a reason a human
 * can act on, because the two failures that actually happen are "the sheet was
 * never shared with the service account" and "somebody renamed a column", and
 * both need a person rather than a retry.
 */
export async function fetchSupplierRows({ sheetId = SUPPLIER_SHEET_ID, range = RANGE } = {}) {
  if (!sheetConfigured()) throw new Error('Google service account credentials are not set');

  const token = await getAccessToken(READ_SCOPE);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}`
    + `/values/${encodeURIComponent(range)}?majorDimension=ROWS`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(60000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 403) {
      throw new Error(
        `Google refused the read (403). Share the sheet with ${process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL} as a viewer.`
      );
    }
    if (res.status === 404) throw new Error(`No sheet with id ${sheetId} (404).`);
    throw new Error(`Sheets API ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  const values = Array.isArray(data.values) ? data.values : [];
  if (!values.length) throw new Error('The sheet came back empty.');

  const headers = (values[0] || []).map((h) => String(h == null ? '' : h).trim());
  if (!headers.length) throw new Error('The sheet has no header row.');

  const body = values.slice(1);
  // A short read is far more likely to be a partial response or the wrong tab
  // than a supplier who has genuinely withdrawn their whole catalogue, and
  // replacing 10,000 good events with 12 is worse than serving yesterday's.
  if (body.length < MIN_ROWS) throw new Error(`Only ${body.length} rows came back; refusing to rebuild from that.`);
  if (body.length > MAX_ROWS) throw new Error(`${body.length} rows is beyond anything this feed has been.`);

  const rows = body.map((row) => {
    const out = Object.create(null); // no prototype: header names come from the sheet
    for (let i = 0; i < headers.length; i++) {
      if (headers[i]) out[headers[i]] = String(row[i] == null ? '' : row[i]);
    }
    return out;
  });

  return { rows, headers, rowCount: rows.length, sheetId };
}
