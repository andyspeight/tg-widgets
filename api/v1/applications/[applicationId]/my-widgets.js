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
import { toDirectoryEntry, WIDGETS_BY_ID } from '../../../_lib/v1/widget-view.js';
// The counting rule is shared with the SSO deep link, which needs the same
// answer to decide between offering the widgets they have and opening a blank
// editor. See api/_lib/v1/client-widget-counts.js.
import { countWidgetsByType } from '../../../_lib/v1/client-widget-counts.js';

const ENDPOINT = 'my-widgets';
const REC_ID_RE = /^rec[A-Za-z0-9]{14}$/;

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

    const counts = await countWidgetsByType(client, ENDPOINT);

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
