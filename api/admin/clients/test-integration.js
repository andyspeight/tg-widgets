/**
 * POST /api/admin/clients/test-integration
 *
 * Live check that a client's saved Travelify credentials actually work.
 *
 * It resolves the App ID + API key the SAME way the booking flow does
 * (lookupClientCredentialsByRecordId in _auth.js, which reads the Clients
 * record), then makes one real, minimal call to Travelify and reports whether
 * the credentials were accepted. A pass here means a traveller's My Booking
 * lookup would authenticate too — this is not a field-presence check.
 *
 * The query is deliberately a throwaway, non-existent booking: if the creds
 * are valid Travelify returns 404 (or its in-body 404 shape); if they are not
 * it returns 401/403. We only learn whether the App ID + key were accepted —
 * no real customer data is read. The key never leaves the server.
 *
 * Auth: widget_suite owner or admin.
 *
 * Body:    { id: 'recXXX' }
 * Returns: { ok: true, status: 'connected' | 'rejected' | 'unreachable' | 'not_configured', detail }
 */

import { requireAuth, requireProductAccess } from '../../_lib/auth/middleware.js';
import { jsonError } from '../../_lib/auth/http.js';
import { PRODUCTS, PERMISSIONS } from '../../_lib/auth/schema.js';
import { lookupClientCredentialsByRecordId } from '../../_auth.js';

const REC_ID_RE = /^rec[A-Za-z0-9]{14}$/;
const TRAVELIFY_API = 'https://api.travelify.io/account/order';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return jsonError(res, 405, 'method_not_allowed', 'POST only');
  }

  const ctx = await requireAuth(req, res);
  if (!ctx) return;

  const role = requireProductAccess(
    ctx,
    PRODUCTS.slugs.WIDGET_SUITE,
    [PERMISSIONS.roles.OWNER, PERMISSIONS.roles.ADMIN],
    res
  );
  if (!role) return;

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  } catch {
    return jsonError(res, 400, 'invalid_json', 'Body must be JSON');
  }

  const id = String(body.id || '').trim();
  if (!REC_ID_RE.test(id)) {
    return jsonError(res, 400, 'invalid_id', 'id must be a valid record id');
  }

  // Resolve credentials exactly as the live booking flow does.
  let creds;
  try {
    creds = await lookupClientCredentialsByRecordId(id);
  } catch (err) {
    console.error('[admin/clients/test-integration] credential lookup failed:', err?.message || err);
    return res.status(200).json({
      ok: true,
      status: 'unreachable',
      detail: 'Could not read the saved credentials. Try again.',
    });
  }

  if (!creds || !creds.appId || !creds.apiKey) {
    return res.status(200).json({
      ok: true,
      status: 'not_configured',
      detail: 'No Travelify App ID and API key are saved yet.',
    });
  }

  try {
    const tfRes = await fetch(TRAVELIFY_API, {
      method: 'POST',
      headers: {
        // Token AppId:Key — same auth the My Booking widget uses.
        'Authorization': `Token ${creds.appId}:${creds.apiKey}`,
        'Content-Type': 'application/json',
        // Travelify rejects server-to-server calls with no Origin as a 401
        // that looks like bad credentials but isn't. Send our product origin.
        'Origin': 'https://www.travelgenix.io',
      },
      body: JSON.stringify({
        emailAddress: 'connection-test@travelgenix.io',
        departDate: '2020-01-01',
        orderRef: 'TGCONNECTIONTEST',
      }),
      signal: AbortSignal.timeout(12000),
    });

    const status = tfRes.status;

    // Bad credentials.
    if (status === 401 || status === 403) {
      return res.status(200).json({
        ok: true,
        status: 'rejected',
        detail: `Travelify rejected the credentials (${status}). Check the App ID and API key.`,
      });
    }

    // 200 or 404 both mean the credentials authenticated. 404 just means the
    // throwaway test booking does not exist, which is expected.
    if (status === 200 || status === 404) {
      return res.status(200).json({
        ok: true,
        status: 'connected',
        detail: 'Travelify accepted the credentials.',
      });
    }

    return res.status(200).json({
      ok: true,
      status: 'unreachable',
      detail: `Travelify responded with ${status}. Could not confirm — try again.`,
    });
  } catch (err) {
    // Timeout or network failure — inconclusive, not a credential verdict.
    console.error('[admin/clients/test-integration] Travelify call failed:', err?.message || err);
    return res.status(200).json({
      ok: true,
      status: 'unreachable',
      detail: 'Could not reach Travelify. Try again in a moment.',
    });
  }
}
