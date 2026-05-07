/**
 * POST /api/admin/clients/create
 *
 * The New Client wizard's submit endpoint. Creates the full client record set:
 *
 *   1. Validate every field
 *   2. Re-check uniqueness (defence in depth)
 *   3. Create the Client record
 *   4. Create Client Entitlement rows (one per enabled product)
 *   5. Grant Permissions: one row per unique Product slug that the client's
 *      enabled entitlements map to. The primary contact User gets these.
 *      This is what makes them able to actually access each product.
 *   6. Send invite email to primary contact (widget_suite admin role)
 *   7. (If applicable) Send invite email to separate Luna Chat agent
 *
 * Note: Luna Chat client record creation in the Knowledge Bot base is
 * deferred to a later phase. This endpoint stores the lunaChat config object
 * on the Client's notes field for now so it's not lost.
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

// Map a product slug → the role we grant the primary contact User on that
// product. This codifies the meaning of each role:
//   - widget_suite → client_owner (they own their workspace)
//   - luna_chat    → agent (they're an agent on their Luna Chat dashboard)
//   - luna_marketing → client_user (they use the marketing tool)
// Other slugs default to client_user.
const PRODUCT_ROLE_FOR_PRIMARY = {
  [PRODUCTS.slugs.WIDGET_SUITE]: PERMISSIONS.roles.CLIENT_OWNER,
  [PRODUCTS.slugs.LUNA_CHAT]: PERMISSIONS.roles.AGENT,
  [PRODUCTS.slugs.LUNA_MARKETING]: PERMISSIONS.roles.CLIENT_USER,
  [PRODUCTS.slugs.LUNA_BRAIN]: PERMISSIONS.roles.CLIENT_USER,
  [PRODUCTS.slugs.LUNA_TRENDS]: PERMISSIONS.roles.CLIENT_USER,
  [PRODUCTS.slugs.LUNA_QA]: PERMISSIONS.roles.CLIENT_USER,
  [PRODUCTS.slugs.TOOL_HUB]: PERMISSIONS.roles.CLIENT_USER,
};

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
  if (!isValidUrl(websiteUrlRaw)) errors.push('websiteUrl must be a valid URL');
  const websiteUrl = websiteUrlRaw.startsWith('http')
    ? websiteUrlRaw
    : 'https://' + websiteUrlRaw;

  const travelifyAppId = String(body.travelifyAppId || '').trim();
  const travelifySiteId = String(body.travelifySiteId || '').trim();
  if (travelifyAppId && !/^\d{1,10}$/.test(travelifyAppId)) errors.push('travelifyAppId must be numeric, up to 10 digits');
  if (travelifySiteId && !/^\d{1,10}$/.test(travelifySiteId)) errors.push('travelifySiteId must be numeric, up to 10 digits');

  const primaryContactName = String(body.primaryContactName || '').trim();
  if (primaryContactName.length < 2 || primaryContactName.length > 120) errors.push('primaryContactName must be 2–120 characters');

  const primaryContactEmail = normaliseEmail(body.primaryContactEmail);
  if (!isValidEmail(primaryContactEmail)) errors.push('primaryContactEmail must be a valid email');

  const primaryContactPhone = String(body.primaryContactPhone || '').trim();
  if (primaryContactPhone.length > 40) errors.push('primaryContactPhone max 40 chars');

  if (!REC_ID_RE.test(body.packageId || '')) errors.push('packageId must be a valid record id');
  const mrr = body.mrr == null || body.mrr === '' ? null : Number(body.mrr);
  if (mrr !== null && (!Number.isFinite(mrr) || mrr < 0 || mrr > 100000)) errors.push('mrr must be 0–100000');
  const setupFee = body.setupFee == null || body.setupFee === '' ? null : Number(body.setupFee);
  if (setupFee !== null && (!Number.isFinite(setupFee) || setupFee < 0 || setupFee > 100000)) errors.push('setupFee must be 0–100000');
  if (!isValidIsoDate(body.setupDate)) errors.push('setupDate must be a valid date');
  if (body.goLiveDate && !isValidIsoDate(body.goLiveDate)) errors.push('goLiveDate must be a valid date if provided');

  if (!Array.isArray(body.entitlements)) errors.push('entitlements must be an array');
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

  if (errors.length) return jsonError(res, 400, 'validation_failed', errors.join(' · '));

  // ─── Server-side uniqueness re-check ─────────────────────────────
  let pkgRecord;
  let allCatalogue;
  let allProducts;
  try {
    pkgRecord = await getRecord(PACKAGES.tableId, body.packageId).catch((err) => {
      if (err?.status === 404) return null;
      throw err;
    });
    if (!pkgRecord) return jsonError(res, 400, 'package_not_found', 'Selected package does not exist');

    const [clients, users, catalogue, products] = await Promise.all([
      listAllRecords(CLIENTS.tableId),
      listAllRecords(USERS.tableId),
      listAllRecords(CATALOGUE.tableId),
      listAllRecords(PRODUCTS.tableId),
    ]);
    allCatalogue = catalogue;
    allProducts = products;

    const websiteNorm = normaliseUrl(websiteUrl);
    const conflicts = [];
    if (clients.find((c) => normaliseEmail(c.fields[CLIENTS.fields.email]) === primaryContactEmail)) conflicts.push('A client already uses this primary email');
    if (users.find((u) => normaliseEmail(u.fields[USERS.fields.email]) === primaryContactEmail)) conflicts.push('A user with the primary contact email already exists');
    if (websiteNorm && clients.find((c) => normaliseUrl(c.fields[CLIENTS.fields.websiteUrl]) === websiteNorm)) conflicts.push('A client with this website already exists');
    if (travelifyAppId && clients.find((c) => String(c.fields[CLIENTS.fields.travelifyAppId] || '').trim() === travelifyAppId)) conflicts.push('A client with this Travelify App ID already exists');
    if (lunaChatPayload && !lunaChatPayload.useContact) {
      const ae = lunaChatPayload.agentEmail;
      if (users.find((u) => normaliseEmail(u.fields[USERS.fields.email]) === ae)) conflicts.push('A user with the Luna Chat agent email already exists');
    }
    if (conflicts.length) return jsonError(res, 409, 'conflict', conflicts.join(' · '));
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
    return res.status(207).json({
      ok: false,
      clientId,
      entitlementsCreated,
      partial: true,
      message: `Client created but entitlement loop failed at ${entitlementsCreated}/${entitlements.length}. Edit the client to fix.`,
    });
  }

  // ─── 3. Send the primary invite first (creates the User row) ─────
  // We need the User's record id to create Permission rows.
  const inviteResults = [];
  let primaryUserRecordId = null;

  try {
    const r = await sendAdminInvite({
      email: primaryContactEmail,
      role: USERS.roles.ADMIN,
      targetClientRecordId: clientId,
      invitedByUserRecordId: ctx.userRecordId,
      fullName: primaryContactName,
      inviterName: ctx.fullName || ctx.email,
    });
    primaryUserRecordId = r.userRecordId;
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

  // ─── 4. Grant Permissions for unique product slugs ───────────────
  // Build map: productSlug → product record id (from the products we loaded)
  const productIdBySlug = new Map();
  for (const p of allProducts) {
    const slug = p.fields[PRODUCTS.fields.productId];
    if (slug) productIdBySlug.set(slug, p.id);
  }

  // Build map: catalogueItemId → productSlug
  const slugByCatalogueId = new Map();
  for (const c of allCatalogue) {
    const slug = c.fields[CATALOGUE.fields.productSlug];
    if (slug) slugByCatalogueId.set(c.id, slug);
  }

  // Walk the enabled entitlements and figure out which product slugs are needed
  const neededSlugs = new Set();
  for (const e of entitlements) {
    const slug = slugByCatalogueId.get(e.catalogueItemId);
    if (slug) neededSlugs.add(slug);
  }

  // Create one Permission row per unique slug (only if we got the primary user)
  const permissionsCreated = [];
  if (primaryUserRecordId) {
    for (const slug of neededSlugs) {
      const productRecordId = productIdBySlug.get(slug);
      if (!productRecordId) {
        console.warn('[admin/clients/create] no Product record for slug:', slug);
        continue;
      }
      const grantRole = PRODUCT_ROLE_FOR_PRIMARY[slug] || PERMISSIONS.roles.CLIENT_USER;
      try {
        const permRec = await createRecord(PERMISSIONS.tableId, {
          [PERMISSIONS.fields.user]:      [primaryUserRecordId],
          [PERMISSIONS.fields.product]:   [productRecordId],
          [PERMISSIONS.fields.role]:      grantRole,
          [PERMISSIONS.fields.status]:    PERMISSIONS.statuses.ACTIVE,
          [PERMISSIONS.fields.granted]:   nowIso,
          [PERMISSIONS.fields.grantedBy]: [ctx.userRecordId],
          [PERMISSIONS.fields.notes]:     'Granted automatically during onboarding from package entitlements',
        });
        permissionsCreated.push({
          slug,
          role: grantRole,
          permissionRecordId: permRec.id,
        });
      } catch (err) {
        console.error('[admin/clients/create] failed creating permission for slug:', slug, err);
        permissionsCreated.push({ slug, role: grantRole, ok: false, error: err.message });
      }
    }
  }

  // ─── 5. Optional: separate Luna Chat agent invite ────────────────
  let agentUserRecordId = null;
  if (lunaChatPayload && !lunaChatPayload.useContact &&
      lunaChatPayload.agentEmail &&
      lunaChatPayload.agentEmail !== primaryContactEmail) {
    try {
      const r = await sendAdminInvite({
        email: lunaChatPayload.agentEmail,
        role: USERS.roles.MEMBER,
        targetClientRecordId: clientId,
        invitedByUserRecordId: ctx.userRecordId,
        fullName: lunaChatPayload.agentName,
        inviterName: ctx.fullName || ctx.email,
      });
      agentUserRecordId = r.userRecordId;
      inviteResults.push({
        kind: 'agent',
        email: lunaChatPayload.agentEmail,
        ok: true,
        alreadyMember: !!r.alreadyMember,
        userRecordId: r.userRecordId,
      });

      // Grant the agent the luna_chat permission only
      const lunaChatProductId = productIdBySlug.get(PRODUCTS.slugs.LUNA_CHAT);
      if (lunaChatProductId && agentUserRecordId) {
        try {
          await createRecord(PERMISSIONS.tableId, {
            [PERMISSIONS.fields.user]:      [agentUserRecordId],
            [PERMISSIONS.fields.product]:   [lunaChatProductId],
            [PERMISSIONS.fields.role]:      PERMISSIONS.roles.AGENT,
            [PERMISSIONS.fields.status]:    PERMISSIONS.statuses.ACTIVE,
            [PERMISSIONS.fields.granted]:   nowIso,
            [PERMISSIONS.fields.grantedBy]: [ctx.userRecordId],
            [PERMISSIONS.fields.notes]:     'Luna Chat agent permission granted at onboarding',
          });
          permissionsCreated.push({
            slug: PRODUCTS.slugs.LUNA_CHAT,
            role: PERMISSIONS.roles.AGENT,
            forUser: 'agent',
          });
        } catch (err) {
          console.error('[admin/clients/create] failed granting agent permission:', err);
        }
      }
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

  if (lunaChatPayload) {
    console.log('[admin/clients/create] Luna Chat config captured for client',
      clientId, 'but Luna Chat record creation deferred to a later phase');
  }

  return res.status(200).json({
    ok: true,
    clientId,
    entitlementsCreated,
    invites: inviteResults,
    permissionsCreated,
    lunaChatConfigured: !!lunaChatPayload,
    lunaChatRecordCreated: false,
  });
}
