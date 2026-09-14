/**
 * GET /api/v1/applications/{applicationId}/my-widgets
 *
 * Only the widgets the given Travelify application has actually configured
 * here, each with a count of its instances. Same shape as the directory plus
 * instanceCount. Travelify merges this into its own My Widgets page.
 *
 * Auth: X-Api-Key, the shared secret. Backend to backend only.
 * Contract: docs/travelify-widget-integration.md
 *
 * Counts the same rows the client's own dashboard lists, via the scope formula
 * exported from /api/widget-list — including their legacy widgets, which
 * predate the ClientRecordId owner field. Restating that rule here instead
 * would drift, and the count Travelify shows would stop matching ours.
 *
 * Deliberately NOT filtered by plan or release status: this answers "what have
 * they got", not "what may they add". A widget they installed before their plan
 * changed is still installed, and hiding it would lose them the link to manage
 * it.
 */
import {
  guardRequest,
  readApplicationId,
  findClientByApplicationId,
  publicOrigin,
  sendError,
  sendJson,
  logCall,
} from '../../../_lib/v1/platform-api.js';
import { toDirectoryEntry, widgetForAirtableType, WIDGETS_BY_ID } from '../../../_lib/v1/widget-view.js';
import { buildScopeFormula } from '../../../widget-list.js';
import { isStaffEmail } from '../../../_lib/auth/staff.js';
import { listRecords } from '../../../_lib/auth/airtable.js';
import { CLIENTS } from '../../../_lib/auth/schema.js';
import { sanitiseForFormula } from '../../../_auth.js';

const ENDPOINT = 'my-widgets';
const AIRTABLE_API = 'https://api.airtable.com/v0';
const TABLE_NAME = 'Widgets';
// Read per request, not at module load, so a test (or a redeploy that changes
// the env) sees the current value.
const baseId = () => process.env.AIRTABLE_BASE_ID || 'appAYzWZxvK6qlwXK';
const REC_ID_RE = /^rec[A-Za-z0-9]{14}$/;
// Safety ceiling, matching /api/widget-list. Our largest account is nowhere
// near this; it only stops a pathological row count paging forever.
const MAX_WIDGETS = 1000;

/**
 * Would this client's login email pull in another account's legacy widgets?
 *
 * The legacy fallback (blank ClientRecordId, matched on email) is only safe
 * when the email identifies exactly one client. A staff address never does,
 * and neither does one reused across two accounts.
 */
async function emailIsAmbiguous(clientId, email) {
  if (!email) return true;
  if (isStaffEmail(email)) return true;
  try {
    const rows = await listRecords(CLIENTS.tableId, {
      formula: `LOWER({Email})='${sanitiseForFormula(email)}'`,
      maxRecords: 5,
    });
    return (rows || []).some((r) => r.id !== clientId);
  } catch (err) {
    // Fail closed: drop the legacy fallback rather than risk counting another
    // client's widgets into this one's total.
    console.warn(`[v1] ${ENDPOINT} shared-email check failed:`, err && err.message);
    return true;
  }
}

/** Every widget row in scope, reading just the type column. */
async function fetchWidgetTypes(formula) {
  const types = [];
  let offset;
  do {
    const params = new URLSearchParams();
    params.set('filterByFormula', formula);
    params.set('pageSize', '100');
    params.append('fields[]', 'WidgetType');
    if (offset) params.set('offset', offset);

    const resp = await fetch(`${AIRTABLE_API}/${baseId()}/${TABLE_NAME}?${params}`, {
      headers: { Authorization: `Bearer ${process.env.AIRTABLE_KEY}` },
    });
    if (!resp.ok) throw new Error(`Airtable read failed (${resp.status})`);

    const data = await resp.json();
    for (const rec of data.records || []) types.push(rec.fields?.WidgetType || '');
    offset = data.offset;
  } while (offset && types.length < MAX_WIDGETS);
  return types;
}

export default async function handler(req, res) {
  if (guardRequest(req, res, { endpoint: ENDPOINT }) !== true) return;

  const parsed = readApplicationId(req, res, { endpoint: ENDPOINT });
  if (!parsed.ok) return;
  const { applicationId, applicationIdRaw } = parsed;

  try {
    const client = await findClientByApplicationId(applicationIdRaw);
    if (!client) {
      logCall({ endpoint: ENDPOINT, applicationId, outcome: 'not_found' });
      return sendError(res, 404, 'invalid_application', `Application ${applicationId} was not found.`);
    }
    if (!REC_ID_RE.test(client.id)) {
      throw new Error('client record id failed validation');
    }

    const email = String(client.fields?.[CLIENTS.fields.email] || '').trim().toLowerCase();
    const emailShared = await emailIsAmbiguous(client.id, email);

    const formula = buildScopeFormula({
      activeClientId: client.id,
      activeClientEmail: email,
      emailShared,
      userEmailLower: '',
      selfScope: false,
    });

    const counts = new Map();
    for (const type of await fetchWidgetTypes(formula)) {
      const widget = widgetForAirtableType(type);
      // A row whose type is not in the registry (retired, or renamed in
      // Airtable) has nothing we could describe to Travelify, so it is left
      // out rather than returned with guessed fields.
      if (!widget) continue;
      counts.set(widget.id, (counts.get(widget.id) || 0) + 1);
    }

    const origin = publicOrigin(req);
    const widgets = [...counts.entries()]
      .map(([id, instanceCount]) => ({
        ...toDirectoryEntry(WIDGETS_BY_ID[id], origin),
        instanceCount,
      }))
      // Stable order keeps the ETag stable across calls, since Airtable does
      // not guarantee page ordering.
      .sort((a, b) => a.name.localeCompare(b.name, 'en'));

    logCall({
      endpoint: ENDPOINT,
      applicationId,
      outcome: 'ok',
      detail: `types=${widgets.length} instances=${widgets.reduce((n, w) => n + w.instanceCount, 0)}`,
    });

    // Changes whenever someone adds a widget, so cached far more tightly than
    // the directory.
    return sendJson(req, res, { applicationId, widgets }, { cacheControl: 'private, max-age=30' });
  } catch (err) {
    console.error(`[v1] ${ENDPOINT} failed:`, err && err.message);
    logCall({ endpoint: ENDPOINT, applicationId, outcome: 'error' });
    return sendError(res, 500, 'server_error', 'The request could not be completed.');
  }
}
