/**
 * POST /api/auth/act-as/start
 *
 * Begins a scoped "act as client" for Travelgenix staff. Unlike the old
 * /api/auth/switch-client, this does NOT touch the shared tg_session cookie, so
 * it cannot flip other tools. It returns a short-lived signed grant that the
 * calling tool sends back on its own requests (header X-TG-Act-As), scoping the
 * impersonation to that tool and tab. See docs/act-as-scoping-spec.md.
 *
 * Body: { clientId: 'rec...' }
 * Returns: { ok, grant, ttlMs, client: { recordId, clientName, plan, status } }
 *
 * Security model:
 *   - Valid current session (requireAuth)
 *   - STAFF ONLY (isTravelgenixStaff). Members switching their OWN companies use
 *     /api/auth/switch-client; this endpoint is impersonation and is staff-gated.
 *   - Target client must exist and not be suspended
 *   - Origin allowlist (*.travelify.io) — CSRF defence, same as switch-client
 *   - Rate limited per user
 *   - Audited (source: 'act_as_start') with the real user id and the target
 */

import {
  setCors, requireMethod, parseJson, jsonOk, jsonError,
  getRequestIp, getUserAgent,
} from '../../_lib/auth/http.js';
import { requireAuth } from '../../_lib/auth/middleware.js';
import { limiters } from '../../_lib/auth/ratelimit.js';
import { getRecord } from '../../_lib/auth/airtable.js';
import { CLIENTS, AUTH_EVENTS } from '../../_lib/auth/schema.js';
import { isTravelgenixStaff } from '../../_lib/auth/staff.js';
import { logAuthEvent } from '../../_lib/auth/audit.js';
import { signActAsGrant, ACT_AS_TTL_MS } from '../../_lib/auth/actas.js';

const REC_ID_RE = /^rec[A-Za-z0-9]{14}$/;

function isAllowedOrigin(origin) {
  if (!origin) return false;
  try {
    const u = new URL(origin);
    const h = u.hostname.toLowerCase();
    return h === 'travelify.io' || h.endsWith('.travelify.io') ||
           h === 'localhost' || h === '127.0.0.1';
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  if (setCors(req, res)) return;
  if (!requireMethod(req, res, 'POST')) return;

  const origin = req.headers.origin || req.headers.referer || '';
  if (origin && !isAllowedOrigin(origin)) {
    return jsonError(res, 403, 'forbidden_origin', 'Forbidden');
  }

  const ctx = await requireAuth(req, res);
  if (!ctx) return;

  // Impersonation is staff only. Fail closed for everyone else.
  if (!isTravelgenixStaff(ctx)) {
    return jsonError(res, 403, 'not_staff', 'Staff access required');
  }

  const ip = getRequestIp(req);
  const ua = getUserAgent(req);

  const rl = await limiters.clientSwitch({ key: ctx.userRecordId });
  if (!rl.allowed) {
    res.setHeader('Retry-After', String(rl.retryAfterSeconds));
    return jsonError(res, 429, 'rate_limit', 'Too many switches. Try again in a moment.');
  }

  const body = await parseJson(req);
  if (!body) return jsonError(res, 400, 'bad_json', 'Invalid request body');

  const targetClientId = String(body.clientId || '').trim();
  if (!REC_ID_RE.test(targetClientId)) {
    return jsonError(res, 400, 'invalid_client_id', 'A valid clientId is required');
  }

  // Load the target client, verify it is live.
  let targetClient;
  try {
    targetClient = await getRecord(CLIENTS.tableId, targetClientId);
  } catch (err) {
    if (err?.status === 404) {
      return jsonError(res, 404, 'client_not_found', 'Company not found');
    }
    console.error('[auth/act-as/start] client lookup failed:', err);
    return jsonError(res, 500, 'lookup_failed', 'Could not load target company');
  }

  const targetStatus = String(targetClient.fields[CLIENTS.fields.status] || '').toLowerCase();
  if (targetStatus === 'suspended') {
    return jsonError(res, 403, 'target_suspended', 'That company is suspended. Contact support.');
  }

  const grant = signActAsGrant({
    staffUserId: ctx.userRecordId,
    targetClientId,
  });

  logAuthEvent({
    type: AUTH_EVENTS.types.SIGNIN_SUCCESS, success: true,
    userRecordId: ctx.userRecordId,
    clientRecordId: targetClientId,
    emailAttempted: ctx.email,
    ip, userAgent: ua,
    detail: {
      source: 'act_as_start',
      fromClientId: ctx.clientRecordId,
      toClientId: targetClientId,
    },
  }).catch(() => {});

  console.log('[auth/act-as/start] user', ctx.userRecordId,
    'started act-as', targetClientId, '(scoped grant, no cookie change)');

  return jsonOk(res, {
    grant,
    ttlMs: ACT_AS_TTL_MS,
    client: {
      recordId: targetClient.id,
      clientName: targetClient.fields[CLIENTS.fields.clientName] || '',
      plan: targetClient.fields[CLIENTS.fields.plan] || '',
      status: targetClient.fields[CLIENTS.fields.status] || '',
    },
  });
}
