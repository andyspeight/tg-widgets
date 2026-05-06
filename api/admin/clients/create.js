/**
 * POST /api/admin/clients/create
 *
 * The New Client wizard's submit endpoint. Creates the full client record set
 * in this order, transactionally-ish (best-effort rollback on early failure):
 *
 *   1. Validate every field
 *   2. Re-check uniqueness (defence in depth — pre-flight could be stale)
 *   3. Create the Client record in the Clients table
 *   4. Create Client Entitlement rows (one per enabled product)
 *   5. Send invite email 1: primary contact → widget_suite admin role
 *   6. (If applicable) Send invite email 2: agent → luna_chat agent role
 *
 * Note: Luna Chat client record creation in the Knowledge Bot base is
 * deferred to a later phase. This endpoint stores the lunaChat config object
 * on the Client's notes field for now so it's not lost.
 *
 * Body:
 *   {
 *     // Step 1 — company
 *     companyName, tradingName?, websiteUrl,
 *     travelifyAppId?, travelifySiteId?,
 *
 *     // Primary contact
 *     primaryContactName, primaryContactEmail, primaryContactPhone?,
 *
 *     // Step 2 — package & pricing
 *     packageId, mrr, setupFee, setupDate, goLiveDate?,
 *
 *     // Step 3 — entitlements (only enabled ones, with sources)
 *     entitlements: [
 *       { catalogueItemId, source: 'Package Default' | 'Manual Override' | 'Add-On' }
 *     ],
 *
 *     // Step 4 — Luna Chat (optional, only present if Luna Chat is enabled)
 *     lunaChat?: {
 *       knowledgeBaseName,
 *       brandColor, accentColor,
 *       welcomeMessage,
 *       useContactForAgent: boolean,    // if true, agent invite uses primary contact
 *       agentName?: string,              // only if useContactForAgent is false
 *       agentEmail?: string,             // only if useContactForAgent is false
 *     }
 *   }
 *
 * Response:
 *   {
 *     ok: true,
 *     clientId: 'recXXX',
 *     entitlementsCreated: number,
 *     invites: [
 *       { kind: 'primary' | 'agent', email, ok: boolean, alreadyMember?, error? }
 *     ]
 *   }
 *
 * Auth: widget_suite owner or admin.
 */

import { requireAuth, requireProductAccess } from '../../_lib/auth/middleware.js';
import {
  createRecord,
  listAllRecords,
  getRecord,
} from '../../_lib/auth/airtable.js';
import { jsonError } from '../../_lib/auth/http.js';
import {
  PRODUCTS,
  PERMISSIONS,
  CLIENTS,
  USERS,
  CATALOGUE,
  CLIENT_ENTITLEMENTS,
  PACKAGES,
} from '../../_lib/auth/schema.js';
import { sendAdminInvite } from '../_helpers/invite.js';

const REC_ID_RE = /^rec[A-Za-z0-9]{14}$/;
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const VALID_SOURCES = new Set(['Package Default', 'Manual Override', 'Add-On']);

function normaliseEmail(s) {
  return String(s || '').trim().toLowerCase();
}
function normaliseUrl(s) {
  return String(s || '').trim().toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');
}
function isValidEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}
function isValidUrl(s) {
  try {
    const u = new URL(s.startsWith('http') ? s : 'https://' + s);
    return !!u.hostname && u.hostname.includes('.');
  } catch {
    return false;
  }
}
function isValidIsoDate(s) {
  if (!s) return false;
  const d = new Date(s);
  return !isNaN(d.getTime());
}
function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
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

  // ─── Validation ──────────────────────────────────────────────────
  const errors = [];

  const companyName = String(body.companyName || '').trim();
  if (companyName.length < 2 || companyName.length > 120) {
    errors.push('companyName must be 2–120 characters');
  }

  const tradingName = body.tradingName == null ? '' : String(body.tradingName).trim();
  if (tradingName.length > 120) errors.push('tradingName max 120 chars');

  const websiteUrlRaw = String(body.websiteUrl || '').trim();
  if (!isValidUrl(websiteUrlRaw)) {
    errors.push('websiteUrl must be a valid URL');
  }
  const websiteUrl = websiteUrlRaw.startsWith('http')
    ? websiteUrlRaw
    : 'https://' + websiteUrlRaw;

  const travelifyAppId = String(body.travelifyAppId || '').trim();
  const travelifySiteId = String(body.travelifySiteId || '').trim();
  if (travelifyAppId && !/^\d{1,10}$/.test(travelifyAppId)) {
    errors.push('travelifyAppId must be numeric, up to 10 digits');
  }
  if (travelifySiteId && !/^\d{1,10}$/.test(travelifySiteId)) {
    errors.push('travelifySiteId must be numeric, up to 10 digits');
  }

  const primaryContactName = String(body.primaryContactName || '').trim();
  if (primaryContactName.length < 2 || primaryContactName.length > 120) {
    errors.push('primaryContactName must be 2–120 characters');
  }

  const primaryContactEmail = normaliseEmail(body.primaryContactEmail);
  if (!isValidEmail(primaryContactEmail)) {
    errors.push('primaryContactEmail must be a valid email');
  }

  const primaryContactPhone = String(body.primaryContactPhone || '').trim();
  if (primaryContactPhone.length > 40) errors.push('primaryContactPhone max 40 chars');

  // Step 2
  if (!REC_ID_RE.test(body.packageId || '')) {
    errors.push('packageId must be a valid record id');
  }
  const mrr = body.mrr == null || body.mrr === '' ? null : Number(body.mrr);
  if (mrr !== null && (!Number.isFinite(mrr) || mrr < 0 || mrr > 100000)) {
    errors.push('mrr must be 0–100000');
  }
  const setupFee = body.setupFee == null || body.setupFee === '' ? null : Number(body.setupFee);
  if (setupFee !== null && (!Number.isFinite(setupFee) || setupFee < 0 || setupFee > 100000)) {
    errors.push('setupFee must be 0–100000');
  }
  if (!isValidIsoDate(body.setupDate)) errors.push('setupDate must be a valid date');
  if (body.goLiveDate && !isValidIsoDate(body.goLiveDate)) {
    errors.push('goLiveDate must be a valid date if provided');
  }

  // Step 3 — entitlements
  if (!Array.isArray(body.entitlements)) {
    errors.push('entitlements must be an array');
  }
  const entitlements = Array.isArray(body.entitlements) ? body.entitlements : [];
  for (const e of entitlements) {
    if (!REC_ID_RE.test(e?.catalogueItemId || '')) {
      errors.push('every entitlement needs a valid catalogueItemId');
      break;
    }
    if (!VALID_SOURCES.has(e?.source)) {
      errors.push(`entitlement source must be one of: ${[...VALID_SOURCES].join(', ')}`);
      break;
    }
  }

  // Step 4 — Luna Chat (optional but validated if present)
  let lunaChatPayload = null;
  if (body.lunaChat) {
    const lc = body.lunaChat;
    const useContact = !!lc.useContactForAgent;
    const kbName = String(lc.knowledgeBaseName || '').trim();
    const brand = String(lc.brandColor || '').trim();
    const accent = String(lc.accentColor || '').trim();
    const welcome = String(lc.welcomeMessage || '').trim();

    if (kbName.length < 2 || kbName.length > 120) errors.push('Luna Chat knowledgeBaseName must be 2–120 chars');
    if (brand && !HEX_COLOR_RE.test(brand)) errors.push('Luna Chat brandColor must be a hex like #1B2B5B');
    if (accent && !HEX_COLOR_RE.test(accent)) errors.push('Luna Chat accentColor must be a hex like #00B4D8');
    if (welcome.length > 500) errors.push('Luna Chat welcomeMessage max 500 chars');

    if (!useContact) {
      const agentEmail = normaliseEmail(lc.agentEmail);
      const agentName = String(lc.agentName || '').trim();
      if (!isValidEmail(agentEmail)) errors.push('Luna Chat agentEmail must be valid when not reusing primary contact');
      if (agentName.length < 2) errors.push('Luna Chat agentName must be at least 2 chars when not reusing primary contact');
      lunaChatPayload = { useContact, kbName, brand, accent, welcome, agentEmail, agentName };
    } else {
      lunaChatPayload = { useContact: true, kbName, brand, accent, welcome };
    }
  }

  if (errors.length) {
    return jsonError(res, 400, 'validation_failed', errors.join(' · '));
  }

  // ─── Server-side uniqueness re-check ─────────────────────────────
  let pkgRecord;
  try {
    pkgRecord = await getRecord(PACKAGES.tableId, body.packageId).catch((err) => {
      if (err?.status === 404) return null;
      throw err;
    });
    if (!pkgRecord) {
      return jsonError(res, 400, 'package_not_found', 'Selected package does not exist');
    }

    const [clients, users] = await Promise.all([
      listAllRecords(CLIENTS.tableId),
      listAllRecords(USERS.tableId),
    ]);

    const websiteNorm = normaliseUrl(websiteUrl);
    const conflicts = [];

    if (clients.find((c) => normaliseEmail(c.fields[CLIENTS.fields.email]) === primaryContactEmail)) {
      conflicts.push('A client already uses this primary email');
    }
    if (users.find((u) => normaliseEmail(u.fields[USERS.fields.email]) === primaryContactEmail)) {
      conflicts.push('A user with the primary contact email already exists');
    }
    if (websiteNorm && clients.find((c) => normaliseUrl(c.fields[CLIENTS.fields.websiteUrl]) === websiteNorm)) {
      conflicts.push('A client with this website already exists');
    }
    if (travelifyAppId && clients.find((c) =>
      String(c.fields[CLIENTS.fields.travelifyAppId] || '').trim() === travelifyAppId)) {
      conflicts.push('A client with this Travelify App ID already exists');
    }
    if (lunaChatPayload && !lunaChatPayload.useContact) {
      const ae = lunaChatPayload.agentEmail;
      if (users.find((u) => normaliseEmail(u.fields[USERS.fields.email]) === ae)) {
        conflicts.push('A user with the Luna Chat agent email already exists');
      }
    }

    if (conflicts.length) {
      return jsonError(res, 409, 'conflict', conflicts.join(' · '));
    }
  } catch (err) {
    console.error('[admin/clients/create] uniqueness check failed:', err);
    return jsonError(res, 500, 'internal_error', 'Could not verify uniqueness');
  }

  // ─── 1. Create the Client record ─────────────────────────────────
  let clientRec;
  try {
    const clientFields = {
      [CLIENTS.fields.email]:               primaryContactEmail,
      [CLIENTS.fields.clientName]:          companyName,
      [CLIENTS.fields.status]:              'Active',
      [CLIENTS.fields.tradingName]:         tradingName || '',
      [CLIENTS.fields.websiteUrl]:          websiteUrl,
      [CLIENTS.fields.travelifyAppId]:      travelifyAppId || '',
      [CLIENTS.fields.travelifySiteId]:     travelifySiteId || '',
      [CLIENTS.fields.primaryContactName]:  primaryContactName,
      [CLIENTS.fields.primaryContactPhone]: primaryContactPhone || '',
      [CLIENTS.fields.package]:             [body.packageId],
      [CLIENTS.fields.mrr]:                 mrr,
      [CLIENTS.fields.setupFeeCharged]:     setupFee,
      [CLIENTS.fields.setupDate]:           body.setupDate,
      [CLIENTS.fields.goLiveDate]:          body.goLiveDate || null,
      [CLIENTS.fields.createdAt]:           new Date().toISOString(),
    };

    // Stash Luna Chat config in notes for now — we'll move it to a proper
    // table/fields when we implement the Knowledge Bot integration in a
    // later phase.
    if (lunaChatPayload) {
      clientFields[CLIENTS.fields.notes] =
        '[Luna Chat config captured at onboarding]\n' +
        JSON.stringify(lunaChatPayload, null, 2);
    }

    clientRec = await createRecord(CLIENTS.tableId, clientFields);
  } catch (err) {
    console.error('[admin/clients/create] failed creating client record:', err);
    return jsonError(res, 500, 'failed_to_create_client', 'Could not create client record');
  }

  const clientId = clientRec.id;
  const nowIso = new Date().toISOString();

  // ─── 2. Create entitlement rows ──────────────────────────────────
  // Each entitlement row stores: client link, catalogue link, enabled=true,
  // source, activatedDate. We use createRecord one at a time because the
  // existing airtable helper doesn't have a bulkCreate yet. Volume is
  // bounded (~15-20 per client) so this is fine.
  let entitlementsCreated = 0;
  try {
    for (const e of entitlements) {
      await createRecord(CLIENT_ENTITLEMENTS.tableId, {
        [CLIENT_ENTITLEMENTS.fields.client]:        [clientId],
        [CLIENT_ENTITLEMENTS.fields.catalogueItem]: [e.catalogueItemId],
        [CLIENT_ENTITLEMENTS.fields.enabled]:       true,
        [CLIENT_ENTITLEMENTS.fields.source]:        e.source,
        [CLIENT_ENTITLEMENTS.fields.activatedDate]: nowIso,
        [CLIENT_ENTITLEMENTS.fields.created]:       nowIso,
        [CLIENT_ENTITLEMENTS.fields.lastModified]:  nowIso,
      });
      entitlementsCreated++;
    }
  } catch (err) {
    console.error('[admin/clients/create] entitlement creation partial-failed:', err);
    // Don't roll back — the Client and any entitlements created are valid.
    // The admin can fix from the detail view later.
    return res.status(207).json({
      ok: false,
      clientId,
      entitlementsCreated,
      partial: true,
      message: `Client created but entitlement loop failed at ${entitlementsCreated}/${entitlements.length}. Edit the client to fix.`,
    });
  }

  // ─── 3. Send invites ─────────────────────────────────────────────
  const inviteResults = [];

  // Invite 1: primary contact → widget_suite admin
  try {
    const r = await sendAdminInvite({
      email: primaryContactEmail,
      role: USERS.roles.ADMIN,
      targetClientRecordId: clientId,
      invitedByUserRecordId: ctx.userRecordId,
      fullName: primaryContactName,
      inviterName: ctx.fullName || ctx.email,
    });
    inviteResults.push({
      kind: 'primary',
      email: primaryContactEmail,
      ok: true,
      alreadyMember: !!r.alreadyMember,
      userRecordId: r.userRecordId,
    });
  } catch (err) {
    console.error('[admin/clients/create] primary invite failed:', err);
    inviteResults.push({
      kind: 'primary',
      email: primaryContactEmail,
      ok: false,
      error: err.code || err.message || 'unknown',
    });
  }

  // Invite 2 (conditional): separate Luna Chat agent
  // Only sent if Luna Chat is enabled AND useContactForAgent is false AND
  // the agent email is different from the primary contact.
  if (lunaChatPayload && !lunaChatPayload.useContact &&
      lunaChatPayload.agentEmail &&
      lunaChatPayload.agentEmail !== primaryContactEmail) {
    try {
      const r = await sendAdminInvite({
        email: lunaChatPayload.agentEmail,
        role: USERS.roles.MEMBER, // Luna Chat agents are 'member' role on the user side
        targetClientRecordId: clientId,
        invitedByUserRecordId: ctx.userRecordId,
        fullName: lunaChatPayload.agentName,
        inviterName: ctx.fullName || ctx.email,
      });
      inviteResults.push({
        kind: 'agent',
        email: lunaChatPayload.agentEmail,
        ok: true,
        alreadyMember: !!r.alreadyMember,
        userRecordId: r.userRecordId,
      });
    } catch (err) {
      console.error('[admin/clients/create] agent invite failed:', err);
      inviteResults.push({
        kind: 'agent',
        email: lunaChatPayload.agentEmail,
        ok: false,
        error: err.code || err.message || 'unknown',
      });
    }
  }

  // Note about Luna Chat record creation (deferred):
  if (lunaChatPayload) {
    console.log('[admin/clients/create] Luna Chat config captured for client',
      clientId, 'but Luna Chat record creation deferred to Phase 4');
  }

  return res.status(200).json({
    ok: true,
    clientId,
    entitlementsCreated,
    invites: inviteResults,
    lunaChatConfigured: !!lunaChatPayload,
    lunaChatRecordCreated: false, // deferred
  });
}
