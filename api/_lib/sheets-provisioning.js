/**
 * Shared Google Sheets provisioning engine.
 *
 * One place that knows how to mint a client-ready spreadsheet: create it
 * inside the platform's Shared Drive (Google no longer lets service accounts
 * own files — a direct create answers PERMISSION_DENIED), optionally rename
 * the default tab and write a header row, then share it with the client's
 * email so it lands in their inbox already wired up.
 *
 * Used by:
 *  - api/enquiry/sheets-provision.js  (Enquiry / Enquiry Pro — Enquiries tab
 *    plus the fixed 26-column header row)
 *  - api/sheets-provision.js          (Widgets-table form types, e.g. the
 *    Newsletter lead router — default tab, no headers: the destination's
 *    auto-header writes the right per-widget layout on first append)
 *
 * Env:
 *  - GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY —
 *    via the routing module's getAccessToken.
 *  - TG_SHEETS_SHARED_DRIVE_ID — the Shared Drive (or folder inside one) the
 *    service account belongs to as Content manager. Without it a direct
 *    create is attempted and Google's ownership refusal is translated into
 *    the one-off setup instruction.
 */
import { getAccessToken } from '../enquiry/_lib/routing/google-sheets.js';

const PROVISION_SCOPE = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive';

export function sharedDriveIdConfigured() {
  return !!String(process.env.TG_SHEETS_SHARED_DRIVE_ID || '').trim();
}

// Read a Google error response and produce a typed Error. The one case the
// callers must distinguish is "Drive API not enabled on the project" — a
// one-off platform setup step, not something to retry.
export async function googleError(response, stage) {
  let detail = '';
  try { detail = (await response.text()).slice(0, 400); } catch (e) { /* ignore */ }
  const err = new Error(`google ${stage} HTTP ${response.status}: ${detail}`);
  err.stage = stage;
  if (response.status === 403 && /accessNotConfigured|has not been used in project|is disabled/i.test(detail)) {
    err.driveDisabled = true;
  }
  return err;
}

// Run an idempotent Google step with a stage label and ONE retry — a
// just-created spreadsheet can stall its first follow-up call, and every
// step here (metadata read, tab rename, header write, permission grant) is
// safe to repeat. Aborts and network rejects carry no stage of their own,
// so the label is stamped on whatever escapes.
export async function googleStep(stage, fn) {
  try {
    return await fn();
  } catch (first) {
    console.warn(`[sheets-provisioning] ${stage} retrying after:`, first.message || first);
    try {
      return await fn();
    } catch (err) {
      if (!err.stage) err.stage = stage;
      throw err;
    }
  }
}

/**
 * Create a spreadsheet, optionally set up its first tab, share it.
 *
 * @param {object} opts
 * @param {string} opts.title      — spreadsheet title (clamped to 120 chars)
 * @param {string} opts.shareWith  — email granted writer access (Google sends
 *                                   the standard notification with the link)
 * @param {string} [opts.tabName]  — rename the first tab to this (omit to
 *                                   keep Google's default "Sheet1")
 * @param {string[]} [opts.headers]— write this header row into the first tab
 *                                   and freeze it (omit for none)
 * @returns {{ sheetId: string, url: string, tab: string }}
 */
export async function provisionSpreadsheet({ title, shareWith, tabName, headers }) {
  let token;
  try {
    token = await getAccessToken(PROVISION_SCOPE);
  } catch (err) {
    err.stage = 'auth';
    throw err;
  }
  const gHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const cleanTitle = String(title || 'Travelgenix spreadsheet').slice(0, 120);
  const sharedDriveId = String(process.env.TG_SHEETS_SHARED_DRIVE_ID || '').trim();

  let sheetId;
  if (sharedDriveId) {
    // Shared-drive create: the drive owns the file, which is what Google's
    // service-account ownership policy requires. The CREATE call is never
    // retried — a timed-out create may still have succeeded server-side and
    // a retry would mint a duplicate.
    const createRes = await fetch('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true', {
      method: 'POST',
      headers: gHeaders,
      body: JSON.stringify({
        name: cleanTitle,
        mimeType: 'application/vnd.google-apps.spreadsheet',
        parents: [sharedDriveId],
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!createRes.ok) throw await googleError(createRes, 'create');
    sheetId = (await createRes.json()).id;

    if (tabName) {
      // Drive-created spreadsheets arrive with a default "Sheet1" tab.
      const firstTabId = await googleStep('read-tabs', async () => {
        const metaRes = await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties.sheetId`,
          { headers: gHeaders, signal: AbortSignal.timeout(15000) }
        );
        if (!metaRes.ok) throw await googleError(metaRes, 'read-tabs');
        const meta = await metaRes.json();
        return meta.sheets && meta.sheets[0] && meta.sheets[0].properties
          ? meta.sheets[0].properties.sheetId : 0;
      });
      await googleStep('rename-tab', async () => {
        const renameRes = await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`,
          {
            method: 'POST',
            headers: gHeaders,
            body: JSON.stringify({
              requests: [{
                updateSheetProperties: {
                  properties: { sheetId: firstTabId, title: tabName, gridProperties: { frozenRowCount: headers ? 1 : 0 } },
                  fields: headers ? 'title,gridProperties.frozenRowCount' : 'title',
                },
              }],
            }),
            signal: AbortSignal.timeout(15000),
          }
        );
        if (!renameRes.ok) throw await googleError(renameRes, 'rename-tab');
      });
    }
  } else {
    // Legacy direct create — refused by Google's ownership policy; callers
    // translate the refusal into the Shared Drive setup instruction.
    const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
      method: 'POST',
      headers: gHeaders,
      body: JSON.stringify({
        properties: { title: cleanTitle },
        sheets: [{ properties: { title: tabName || 'Sheet1', gridProperties: { frozenRowCount: headers ? 1 : 0 } } }],
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!createRes.ok) throw await googleError(createRes, 'create');
    sheetId = (await createRes.json()).spreadsheetId;
  }

  const tab = tabName || 'Sheet1';

  if (headers && headers.length) {
    const range = encodeURIComponent(`'${tab}'!A1`);
    await googleStep('headers', async () => {
      const headerRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}?valueInputOption=RAW`,
        { method: 'PUT', headers: gHeaders, body: JSON.stringify({ values: [headers] }), signal: AbortSignal.timeout(15000) }
      );
      if (!headerRes.ok) throw await googleError(headerRes, 'headers');
    });
  }

  await googleStep('share', async () => {
    const shareRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${sheetId}/permissions?sendNotificationEmail=true&supportsAllDrives=true`,
      {
        method: 'POST',
        headers: gHeaders,
        body: JSON.stringify({ type: 'user', role: 'writer', emailAddress: shareWith }),
        signal: AbortSignal.timeout(15000),
      }
    );
    if (!shareRes.ok) throw await googleError(shareRes, 'share');
  });

  return { sheetId, url: `https://docs.google.com/spreadsheets/d/${sheetId}/edit`, tab };
}

/**
 * Map a provisioning error to the HTTP response both endpoints send. Keeps
 * the user-facing wording in one place.
 */
export function provisionErrorResponse(err) {
  const detail = String((err && err.message) || err).slice(0, 200);
  if (err && err.driveDisabled) {
    return {
      status: 503,
      body: { error: 'The Google Drive API is not enabled on the platform project yet — enable it in Google Cloud Console (project travelgenix-widgets) and try again.' },
    };
  }
  if (!sharedDriveIdConfigured() && err && err.stage === 'create' && /PERMISSION_DENIED|caller does not have permission/i.test(detail)) {
    return {
      status: 503,
      body: {
        error: 'Google no longer lets service accounts own new files. One-off fix: create a Shared Drive, add the service account as Content manager, then set TG_SHEETS_SHARED_DRIVE_ID in Vercel and redeploy.',
        stage: 'create', detail,
      },
    };
  }
  if (/storage.?quota|storageQuotaExceeded/i.test(detail)) {
    return {
      status: 503,
      body: {
        error: 'Google refused to store a new file for the service account (storage quota policy). Provisioning needs to move to a Shared Drive.',
        stage: (err && err.stage) || 'create', detail,
      },
    };
  }
  return {
    status: 502,
    body: {
      error: `Could not create the spreadsheet (failed at: ${(err && err.stage) || 'unknown'}).`,
      stage: (err && err.stage) || 'unknown',
      detail,
    },
  };
}
