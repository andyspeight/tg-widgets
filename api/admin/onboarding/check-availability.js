/**
 * POST /api/admin/onboarding/check-availability
 *
 * Pre-flight check: do any of these values already exist on another client?
 * Used by the wizard so it can warn live, before the user fills in everything
 * else. The server still re-checks on submit (defence in depth) but this gives
 * fast feedback.
 *
 * Body (all optional, only checks ones provided):
 *   {
 *     primaryEmail?: string,
 *     agentEmail?: string,
 *     websiteUrl?: string,
 *     travelifyAppId?: string
 *   }
 *
 * Response:
 *   {
 *     primaryEmail:    { ok, conflict?: { kind, recordId, label } },
 *     agentEmail:      { ok, conflict? },
 *     websiteUrl:      { ok, conflict? },
 *     travelifyAppId:  { ok, conflict? }
 *   }
 *
 * conflict.kind is one of:
 *   - 'user'   — email already in Users table
 *   - 'client' — value already on a Client record
 *
 * Auth: widget_suite owner or admin.
 */

import { requireAuth, requireProductAccess } from '../../_lib/auth/middleware.js';
import { listAllRecords } from '../../_lib/auth/airtable.js';
import { jsonError } from '../../_lib/auth/http.js';
import {
  PRODUCTS,
  PERMISSIONS,
  CLIENTS,
  USERS,
} from '../../_lib/auth/schema.js';

function normaliseEmail(s) {
  return String(s || '').trim().toLowerCase();
}
function normaliseUrl(s) {
  // Compare hosts case-insensitively, ignore trailing slashes and protocol
  return String(s || '').trim().toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');
}

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

  const primaryEmail = normaliseEmail(body.primaryEmail);
  const agentEmail = normaliseEmail(body.agentEmail);
  const websiteUrl = normaliseUrl(body.websiteUrl);
  const travelifyAppId = String(body.travelifyAppId || '').trim();

  // Default response: everything is fine until proven otherwise
  const out = {
    primaryEmail: { ok: true },
    agentEmail: { ok: true },
    websiteUrl: { ok: true },
    travelifyAppId: { ok: true },
  };

  try {
    // Pull both tables in parallel — clients are small (low hundreds at most)
    // and users are also small at this stage.
    const [clients, users] = await Promise.all([
      listAllRecords(CLIENTS.tableId),
      listAllRecords(USERS.tableId),
    ]);

    // ─── Email checks ────────────────────────────────────────
    if (primaryEmail) {
      const userMatch = users.find(
        (u) => normaliseEmail(u.fields[USERS.fields.email]) === primaryEmail
      );
      if (userMatch) {
        out.primaryEmail = {
          ok: false,
          conflict: {
            kind: 'user',
            recordId: userMatch.id,
            label: 'A user with this email already exists',
          },
        };
      } else {
        const clientMatch = clients.find(
          (c) => normaliseEmail(c.fields[CLIENTS.fields.email]) === primaryEmail
        );
        if (clientMatch) {
          out.primaryEmail = {
            ok: false,
            conflict: {
              kind: 'client',
              recordId: clientMatch.id,
              label: `A client uses this email: ${clientMatch.fields[CLIENTS.fields.clientName] || 'unnamed'}`,
            },
          };
        }
      }
    }

    if (agentEmail && agentEmail !== primaryEmail) {
      const userMatch = users.find(
        (u) => normaliseEmail(u.fields[USERS.fields.email]) === agentEmail
      );
      if (userMatch) {
        out.agentEmail = {
          ok: false,
          conflict: {
            kind: 'user',
            recordId: userMatch.id,
            label: 'A user with this email already exists',
          },
        };
      }
    }

    // ─── Website URL ─────────────────────────────────────────
    if (websiteUrl) {
      const clientMatch = clients.find(
        (c) => normaliseUrl(c.fields[CLIENTS.fields.websiteUrl]) === websiteUrl
      );
      if (clientMatch) {
        out.websiteUrl = {
          ok: false,
          conflict: {
            kind: 'client',
            recordId: clientMatch.id,
            label: `Already in use by ${clientMatch.fields[CLIENTS.fields.clientName] || 'an existing client'}`,
          },
        };
      }
    }

    // ─── Travelify App ID ────────────────────────────────────
    if (travelifyAppId) {
      const clientMatch = clients.find(
        (c) => String(c.fields[CLIENTS.fields.travelifyAppId] || '').trim() === travelifyAppId
      );
      if (clientMatch) {
        out.travelifyAppId = {
          ok: false,
          conflict: {
            kind: 'client',
            recordId: clientMatch.id,
            label: `Already in use by ${clientMatch.fields[CLIENTS.fields.clientName] || 'an existing client'}`,
          },
        };
      }
    }

    return res.status(200).json(out);
  } catch (err) {
    console.error('[admin/onboarding/check-availability] error:', err);
    return jsonError(res, 500, 'internal_error', 'Availability check failed');
  }
}
