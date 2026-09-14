/**
 * GET /api/v1/applications/{applicationId}/widget-directory
 *
 * Every widget the given Travelify application is entitled to use here,
 * installed or not. Travelify merges this into its own Widget Directory.
 *
 * Auth: X-Api-Key, the shared secret. Backend to backend only.
 * Contract: docs/travelify-widget-integration.md
 *
 * Entitled means in the client's plan AND released. Andy's call (14 Sep 2026):
 * showing a widget the client cannot create is a dead end, because the save API
 * gates on plan and the contract has no field to mark a widget as locked.
 *
 * Returns 200 with an empty widgets array for a real application entitled to
 * nothing, and 404 when no client exists for the Application ID at all. A 404
 * means "has never signed into the widget platform", which Travelify handles by
 * showing its existing More Tools SSO link so the first sign-in provisions them.
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
import { entitledWidgets, toDirectoryEntry } from '../../../_lib/v1/widget-view.js';
import { getStatusesCached } from '../../../_lib/widget-catalogue-status.js';
import { resolveClientPlan } from '../../../_lib/auth/plan.js';

const ENDPOINT = 'widget-directory';

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

    // Plan and release status are independent reads; neither depends on the
    // other, so let them overlap inside the 300ms budget.
    const [plan, statuses] = await Promise.all([
      resolveClientPlan(client.id),
      getStatusesCached(),
    ]);

    const origin = publicOrigin(req);
    const widgets = entitledWidgets(plan, statuses).map((w) => toDirectoryEntry(w, origin));

    logCall({
      endpoint: ENDPOINT,
      applicationId,
      outcome: 'ok',
      detail: `plan=${plan || 'unresolved'} widgets=${widgets.length}`,
    });

    // Close to static per application, so Travelify can cache it. The ETag lets
    // them revalidate cheaply when a plan changes or a widget goes live.
    return sendJson(req, res, { applicationId, widgets }, { cacheControl: 'private, max-age=300' });
  } catch (err) {
    console.error(`[v1] ${ENDPOINT} failed:`, err && err.message);
    logCall({ endpoint: ENDPOINT, applicationId, outcome: 'error' });
    return sendError(res, 500, 'server_error', 'The request could not be completed.');
  }
}
