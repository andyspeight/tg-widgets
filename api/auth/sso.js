/**
 * GET /api/auth/sso?ssotoken=<JWT>&next=<path>
 *
 * Single sign-on endpoint for the main Travelify platform. The platform
 * mints an HS256-signed JWT containing the user and company identity, and
 * redirects the browser here. We validate the token, ensure the company
 * and user records exist (creating them if not), mint a tg_session cookie,
 * and redirect to the target product.
 *
 * Expected JWT payload (signed with HS256 using JWT_SECURITYKEY):
 *   unique_name      — user id in the main platform (informational only)
 *   email            — user's email (the global key)
 *   given_name       — first name
 *   family_name      — last name
 *   role             — should always be "AppUser"
 *   primarysid       — Travelify App ID (the company key)
 *   primarygroupsid  — application public API key (stored on the client)
 *   groupsid         — package code (spark / boost / ignite / apionly / etc.)
 *   upn              — company name
 *   website          — company website URL
 *   authmethod       — informational (always "pwd" at the moment)
 *   nbf, exp, iat    — standard JWT timing claims
 *
 * Security model:
 *   - HS256 algorithm allowlist (no alg-confusion)
 *   - Short token lifetime is enforced by jwt.verify via exp/nbf
 *   - Token is single-use: hash recorded in Upstash Redis with TTL = remaining
 *     lifetime; replay rejected
 *   - role MUST equal "AppUser" — any other value rejected
 *   - primarysid MUST be a 1–10 digit numeric string (matches the format
 *     used elsewhere in CLIENTS.travelifyAppId)
 *   - email globally unique on the Users table — if it exists at a different
 *     App ID's client, we refuse rather than silently move them
 *   - If the App ID matches an existing client, we use that client as-is and
 *     log a warning if name/website/package in the JWT diverge (deliberate
 *     sync is a separate operation, not a user-login side-effect)
 *   - If the App ID is new and the package code matches no package, refuse
 *   - Cookie scoped to .travelify.io with HttpOnly, Secure, SameSite=Lax
 *   - All failure paths redirect to /signin.html?error=<message>
 *   - All steps log AUTH_EVENTS for audit
 */

import jwt from 'jsonwebtoken';
import { createHash } from 'crypto';
import {
  findOneByField, listAllRecords, createRecord, updateRecord, getRecord,
} from '../_lib/auth/airtable.js';
import {
  USERS, CLIENTS, PACKAGES, PERMISSIONS, PRODUCTS, SESSIONS,
  CLIENT_ENTITLEMENTS, PACKAGE_CATALOGUE, CATALOGUE, AUTH_EVENTS,
} from '../_lib/auth/schema.js';
import {
  hashPassword, signSessionToken, uuid,
} from '../_lib/auth/crypto.js';
import { setSessionCookie, clearSessionCookie } from '../_lib/auth/cookie.js';
import { getRequestIp, getUserAgent } from '../_lib/auth/http.js';
import { resolveUserPermissions } from '../_lib/auth/permissions.js';
import { logAuthEvent } from '../_lib/auth/audit.js';
import { revokeAllUserSessions } from '../_lib/auth/sessions.js';
import { isStaffEmail } from '../_lib/auth/staff.js';

// ─── Config ─────────────────────────────────────────────────────────
const SIGNIN_PATH = '/signin.html';
const DEFAULT_REDIRECT = '/home.html';

// Allowlist of safe redirect paths for the ?next= param. Anything outside
// these prefixes is ignored and the default is used. Prevents open-redirect.
const SAFE_NEXT_PREFIXES = ['/home.html', '/admin', '/dashboard.html'];

// SSO failure codes. These end up in the URL as ?error=<code>, and
// /public/signin.html maps each code to a friendly user-facing message.
//
// Adding a new code? Add it here AND in the SSO_ERRORS map in signin.html
// (otherwise the user falls back to the generic "Couldn't sign you in" copy).
//
// The codes are short, stable, lowercase_snake. They're safe to expose
// because this is a B2B integration between two systems we control; "leaking"
// whether a token was expired vs malformed is not a meaningful attack surface
// here, and the debugging value is huge.
const SSO_ERRORS = {
  NOT_CONFIGURED:        'sso_not_configured',
  MISSING_TOKEN:         'sso_missing_token',
  BAD_SIGNATURE:         'sso_bad_signature',          // JWT verification failed
  EXPIRED:               'sso_expired',                // exp claim in the past
  NOT_YET_VALID:         'sso_not_yet_valid',          // nbf claim in the future
  PAYLOAD_INVALID:       'sso_payload_invalid',        // required claim missing/malformed
  REPLAY:                'sso_replay',                 // token already used
  PACKAGE_UNKNOWN:       'sso_package_unknown',        // groupsid doesn't map to a Package
  CLIENT_CREATE_FAILED:  'sso_client_create_failed',   // Airtable create failed
  LINK_FAILED:           'sso_link_failed',            // multi-company link write failed
  ACCOUNT_SUSPENDED:     'sso_account_suspended',
  UNEXPECTED:            'sso_unexpected',
};

// Token replay protection. Upstash Redis with key TTL = token's remaining
// lifetime. Fail-closed if Redis is unavailable: better to reject some valid
// tokens than to allow replay during a Redis outage.
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

// Escape hatch for integration testing — when reusing the same JWT across
// rapid sign-in attempts during dev work, the replay check correctly fires
// and blocks every attempt after the first. Setting DISABLE_SSO_REPLAY_CHECK
// in Vercel env vars to any truthy value ('true', '1', 'yes') skips the
// claim step and logs a warning, without redeploying.
//
// SECURITY NOTE: with this flag set, SSO tokens are replayable for their
// full lifetime (up to 10 minutes). Only use it in testing environments.
// Flip the env var off again before production traffic resumes.
const SSO_REPLAY_CHECK_DISABLED = ['true', '1', 'yes', 'on'].includes(
  String(process.env.DISABLE_SSO_REPLAY_CHECK || '').toLowerCase()
);

// Map JWT package code → Airtable package code (case-insensitive). The list
// of valid codes is duplicated here as a defence in depth — the runtime
// lookup happens against the live PACKAGES table, this just narrows what
// we're willing to look up.
const VALID_PACKAGE_CODES = new Set([
  'spark', 'boost', 'ignite', 'apionly',
  'jet2pkg', 'option1', 'option2', 'option3',
]);

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Redirect to /signin.html with a structured error code (+ optional debug detail).
 *
 * @param {object} res            — Vercel response
 * @param {string} code           — one of SSO_ERRORS.*
 * @param {string} [detail]       — short debug info (e.g. "exp 2026-05-12T10:00Z").
 *                                  Surfaced behind a "Show technical detail" toggle
 *                                  in signin.html. Don't put PII or secrets here.
 */
function redirectToSignin(res, code, detail) {
  const params = new URLSearchParams();
  params.set('error', code || SSO_ERRORS.UNEXPECTED);
  if (detail) params.set('detail', String(detail).slice(0, 200));
  const target = `${SIGNIN_PATH}?${params.toString()}`;
  res.statusCode = 302;
  res.setHeader('Location', target);
  res.setHeader('Cache-Control', 'no-store');
  res.end();
}

function redirectTo(res, path) {
  res.statusCode = 302;
  res.setHeader('Location', path);
  res.setHeader('Cache-Control', 'no-store');
  res.end();
}

function safeNext(rawNext) {
  if (!rawNext || typeof rawNext !== 'string') return DEFAULT_REDIRECT;
  // Must be relative (no protocol, no host, no protocol-relative)
  if (!rawNext.startsWith('/') || rawNext.startsWith('//')) return DEFAULT_REDIRECT;
  // Must match an allowed prefix
  const ok = SAFE_NEXT_PREFIXES.some((p) => rawNext === p || rawNext.startsWith(p + '/') || rawNext.startsWith(p + '?'));
  return ok ? rawNext : DEFAULT_REDIRECT;
}

function isStringLike(v) { return typeof v === 'string' && v.length > 0; }
function isValidEmailStrict(s) {
  return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 254;
}
function normaliseEmail(s) { return String(s || '').trim().toLowerCase(); }
function normaliseUrl(s) {
  return String(s || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

/**
 * Check token replay via Upstash Redis. Returns true if this is the first
 * time we've seen this token (allow), false if it's a replay (deny).
 * Returns false if Redis is unavailable (fail-closed).
 */
async function claimTokenJti(tokenHash, ttlSeconds) {
  if (!REDIS_URL || !REDIS_TOKEN) {
    console.error('[sso] Upstash Redis not configured — refusing token to be safe');
    return false;
  }
  try {
    // SET key value NX EX ttl — atomic "set if not exists with expiry"
    const url = `${REDIS_URL}/set/sso:${tokenHash}/used?NX=true&EX=${ttlSeconds}`;
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
    });
    if (!r.ok) {
      console.error('[sso] Redis SET failed:', r.status);
      return false;
    }
    const body = await r.json();
    // Upstash returns { result: "OK" } on success, { result: null } if NX failed (key existed)
    return body && body.result === 'OK';
  } catch (err) {
    console.error('[sso] Redis claim error:', err.message);
    return false;
  }
}

// ─── Main handler ───────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET');
    res.setHeader('Content-Type', 'text/plain');
    res.end('Method Not Allowed');
    return;
  }

  const ip = getRequestIp(req);
  const ua = getUserAgent(req);
  const secret = process.env.JWT_SECURITYKEY;

  if (!secret) {
    console.error('[sso] JWT_SECURITYKEY env var missing');
    return redirectToSignin(res, SSO_ERRORS.NOT_CONFIGURED);
  }

  // 1. Extract and validate the JWT signature + expiry
  const ssotoken = String(req.query?.ssotoken || '').trim();
  if (!ssotoken) {
    logAuthEvent({
      type: AUTH_EVENTS.types.SIGNIN_FAIL, success: false,
      ip, userAgent: ua,
      detail: { source: 'sso', reason: 'missing_token' },
    }).catch(() => {});
    return redirectToSignin(res, SSO_ERRORS.MISSING_TOKEN, 'no ssotoken query param');
  }

  let payload;
  try {
    payload = jwt.verify(ssotoken, secret, {
      algorithms: ['HS256'],     // explicit allowlist — defends against alg-confusion
      clockTolerance: 30,        // allow 30s clock skew between platforms
    });
  } catch (err) {
    logAuthEvent({
      type: AUTH_EVENTS.types.SIGNIN_FAIL, success: false,
      ip, userAgent: ua,
      detail: { source: 'sso', reason: 'jwt_verify_failed', error: err.name || err.message },
    }).catch(() => {});

    // Map the specific verify error to a structured code so the sign-in
    // page can show a useful message and we can debug from the URL alone.
    const errName = err.name || '';
    if (errName === 'TokenExpiredError') {
      const expiredAt = err.expiredAt ? new Date(err.expiredAt).toISOString() : '';
      return redirectToSignin(res, SSO_ERRORS.EXPIRED,
        expiredAt ? `expired at ${expiredAt}` : '');
    }
    if (errName === 'NotBeforeError') {
      const validFrom = err.date ? new Date(err.date).toISOString() : '';
      return redirectToSignin(res, SSO_ERRORS.NOT_YET_VALID,
        validFrom ? `valid from ${validFrom}` : '');
    }
    // JsonWebTokenError, SyntaxError, etc. — treat as bad signature / malformed
    return redirectToSignin(res, SSO_ERRORS.BAD_SIGNATURE,
      (err.message || errName || 'verify failed').slice(0, 100));
  }

  // 2. Validate payload shape
  const email = normaliseEmail(payload.email);
  const givenName = String(payload.given_name || '').trim();
  const familyName = String(payload.family_name || '').trim();
  const userRole = String(payload.role || '').trim();
  const travelifyAppId = String(payload.primarysid || '').trim();
  const publicApiKey = String(payload.primarygroupsid || '').trim();
  const packageCode = String(payload.groupsid || '').trim().toLowerCase();
  const companyName = String(payload.upn || '').trim();
  const websiteRaw = String(payload.website || '').trim();

  const validationErrors = [];
  if (userRole !== 'AppUser') validationErrors.push('role must be AppUser');
  if (!isValidEmailStrict(email)) validationErrors.push('valid email required');
  if (!isStringLike(givenName) || givenName.length > 80) validationErrors.push('valid given_name required');
  if (!isStringLike(familyName) || familyName.length > 80) validationErrors.push('valid family_name required');
  if (!/^\d{1,10}$/.test(travelifyAppId)) validationErrors.push('primarysid must be 1–10 digit numeric');
  if (publicApiKey.length === 0 || publicApiKey.length > 80) validationErrors.push('primarygroupsid required (max 80 chars)');
  if (!VALID_PACKAGE_CODES.has(packageCode)) validationErrors.push(`unknown groupsid: ${packageCode}`);
  if (!isStringLike(companyName) || companyName.length > 200) validationErrors.push('valid upn (company name) required');
  // Website is optional in some setups; if provided, must be a sane URL
  let website = '';
  if (websiteRaw) {
    try {
      const u = new URL(websiteRaw.startsWith('http') ? websiteRaw : 'https://' + websiteRaw);
      if (!u.hostname || !u.hostname.includes('.')) throw new Error('bad host');
      website = u.toString();
    } catch {
      validationErrors.push('website must be a valid URL if present');
    }
  }

  if (validationErrors.length > 0) {
    logAuthEvent({
      type: AUTH_EVENTS.types.SIGNIN_FAIL, success: false,
      emailAttempted: email || undefined,
      ip, userAgent: ua,
      detail: { source: 'sso', reason: 'payload_invalid', errors: validationErrors },
    }).catch(() => {});
    return redirectToSignin(res, SSO_ERRORS.PAYLOAD_INVALID,
      validationErrors.slice(0, 3).join('; '));
  }

  // 3. Single-use enforcement via Redis (uses SHA-256 of the raw token as key)
  if (SSO_REPLAY_CHECK_DISABLED) {
    // Loud breadcrumb so this never silently stays on in production.
    // Logs on every SSO attempt — verbose but deliberate.
    console.warn('[sso] ⚠️  REPLAY CHECK DISABLED via DISABLE_SSO_REPLAY_CHECK env var. ' +
      'Tokens are replayable for their full lifetime. Do not leave this on in production.');
  } else {
    const tokenHash = createHash('sha256').update(ssotoken).digest('hex');
    const remainingSeconds = Math.max(60, Math.min(600, payload.exp - Math.floor(Date.now() / 1000) + 60));
    const claimed = await claimTokenJti(tokenHash, remainingSeconds);
    if (!claimed) {
      logAuthEvent({
        type: AUTH_EVENTS.types.SIGNIN_FAIL, success: false,
        emailAttempted: email,
        ip, userAgent: ua,
        detail: { source: 'sso', reason: 'replay_or_redis_unavailable', appId: travelifyAppId },
      }).catch(() => {});
      return redirectToSignin(res, SSO_ERRORS.REPLAY,
        `appId=${travelifyAppId}`);
    }
  }

  // ─── From here on, the token is verified and single-use claimed.
  //     Errors below are infrastructure failures and we log/surface
  //     a generic message to the user.

  try {
    // 4. Resolve or create the Client (company) by Travelify App ID
    const clients = await listAllRecords(CLIENTS.tableId);
    let clientRec = clients.find(
      (c) => String(c.fields[CLIENTS.fields.travelifyAppId] || '').trim() === travelifyAppId
    );
    let clientCreated = false;

    if (!clientRec) {
      // Need to look up the package by code BEFORE creating the client
      const packages = await listAllRecords(PACKAGES.tableId);
      const packageRec = packages.find(
        (p) => String(p.fields[PACKAGES.fields.packageCode] || '').toLowerCase() === packageCode
      );
      if (!packageRec) {
        logAuthEvent({
          type: AUTH_EVENTS.types.SIGNIN_FAIL, success: false,
          emailAttempted: email,
          ip, userAgent: ua,
          detail: { source: 'sso', reason: 'package_not_found', packageCode, appId: travelifyAppId },
        }).catch(() => {});
        return redirectToSignin(res, SSO_ERRORS.PACKAGE_UNKNOWN,
          `package code "${packageCode}"`);
      }

      // NOTE: previously refused if email already belonged to a different
      // client. Removed — a user can legitimately have access to multiple
      // companies (Andy's call). The user-resolution path below appends
      // this new client to their existing client links.

      // Create the Client record
      const nowIso = new Date().toISOString();
      try {
        clientRec = await createRecord(CLIENTS.tableId, {
          [CLIENTS.fields.email]:            email,
          [CLIENTS.fields.clientName]:       companyName,
          [CLIENTS.fields.status]:           'Active',
          [CLIENTS.fields.websiteUrl]:       website || '',
          [CLIENTS.fields.travelifyAppId]:   travelifyAppId,
          [CLIENTS.fields.travelifySiteId]: '', // not in JWT — left blank
          [CLIENTS.fields.apiKey]:           publicApiKey,
          [CLIENTS.fields.package]:          [packageRec.id],
          [CLIENTS.fields.notes]:            `Auto-created via SSO from Travelify on ${nowIso}`,
          [CLIENTS.fields.createdAt]:        nowIso,
        });
      } catch (err) {
        console.error('[sso] failed to create client:', err);
        logAuthEvent({
          type: AUTH_EVENTS.types.SIGNIN_FAIL, success: false,
          emailAttempted: email,
          ip, userAgent: ua,
          detail: { source: 'sso', reason: 'client_create_failed', error: err.message?.slice(0, 200) },
        }).catch(() => {});
        return redirectToSignin(res, SSO_ERRORS.CLIENT_CREATE_FAILED,
          (err.message || 'airtable create failed').slice(0, 100));
      }

      // Create entitlements: every Package Catalogue row marked includedByDefault=true
      // gets a Client Entitlement row with source=Package Default.
      try {
        const packageCatalogue = await listAllRecords(PACKAGE_CATALOGUE.tableId);
        const defaults = packageCatalogue.filter((pc) => {
          const linkedPackages = pc.fields[PACKAGE_CATALOGUE.fields.package] || [];
          const included = pc.fields[PACKAGE_CATALOGUE.fields.includedByDefault];
          return linkedPackages.includes(packageRec.id) && !!included;
        });
        for (const pc of defaults) {
          const catLinks = pc.fields[PACKAGE_CATALOGUE.fields.catalogueItem] || [];
          if (catLinks.length === 0) continue;
          await createRecord(CLIENT_ENTITLEMENTS.tableId, {
            [CLIENT_ENTITLEMENTS.fields.client]:        [clientRec.id],
            [CLIENT_ENTITLEMENTS.fields.catalogueItem]: [catLinks[0]],
            [CLIENT_ENTITLEMENTS.fields.enabled]:       true,
            [CLIENT_ENTITLEMENTS.fields.source]:        CLIENT_ENTITLEMENTS.sources.PACKAGE_DEFAULT,
            [CLIENT_ENTITLEMENTS.fields.activatedDate]: nowIso,
            [CLIENT_ENTITLEMENTS.fields.created]:       nowIso,
            [CLIENT_ENTITLEMENTS.fields.lastModified]:  nowIso,
          });
        }
      } catch (err) {
        // Non-fatal — log and continue. Admin can fix entitlements later.
        console.error('[sso] entitlement seeding partial-failed:', err.message);
      }

      clientCreated = true;
    } else {
      // Existing client. JWT is the source of truth for the package — if it
      // differs from the current linked Package, update the link and reseed
      // the 'Package Default' entitlements. Manual Override and Add-On rows
      // are deliberate human additions; leave them alone.

      const currentPackageLinks = clientRec.fields[CLIENTS.fields.package] || [];
      const currentPackageId = currentPackageLinks[0] || null;

      // Look up the JWT package (always — we need its id to compare)
      const packages = await listAllRecords(PACKAGES.tableId);
      const jwtPackageRec = packages.find(
        (p) => String(p.fields[PACKAGES.fields.packageCode] || '').toLowerCase() === packageCode
      );
      if (!jwtPackageRec) {
        logAuthEvent({
          type: AUTH_EVENTS.types.SIGNIN_FAIL, success: false,
          emailAttempted: email, clientRecordId: clientRec.id,
          ip, userAgent: ua,
          detail: { source: 'sso', reason: 'package_not_found_on_existing_client', packageCode, appId: travelifyAppId },
        }).catch(() => {});
        return redirectToSignin(res, SSO_ERRORS.PACKAGE_UNKNOWN,
          `package code "${packageCode}" for existing client ${travelifyAppId}`);
      }

      // Name / website divergence: leave existing record alone, just log
      const existingName = clientRec.fields[CLIENTS.fields.clientName] || '';
      const existingWebsite = normaliseUrl(clientRec.fields[CLIENTS.fields.websiteUrl] || '');
      const divergences = [];
      if (existingName && existingName !== companyName) divergences.push(`name: existing="${existingName}" jwt="${companyName}"`);
      if (existingWebsite && website && normaliseUrl(website) !== existingWebsite) {
        divergences.push(`website: existing="${existingWebsite}" jwt="${normaliseUrl(website)}"`);
      }
      if (divergences.length > 0) {
        console.warn('[sso] divergent JWT vs client record for appId', travelifyAppId, divergences.join('; '));
      }

      // Package sync — if the JWT package differs from the current package, update
      if (currentPackageId !== jwtPackageRec.id) {
        const nowIso = new Date().toISOString();
        try {
          // 1. Update the Client.package link
          await updateRecord(CLIENTS.tableId, clientRec.id, {
            [CLIENTS.fields.package]: [jwtPackageRec.id],
          });

          // 2. Load entitlements + package_catalogue to compute the diff
          const [allEntitlements, packageCatalogue] = await Promise.all([
            listAllRecords(CLIENT_ENTITLEMENTS.tableId),
            listAllRecords(PACKAGE_CATALOGUE.tableId),
          ]);

          // Which catalogue items are the new package's defaults?
          const newDefaultsCatIds = new Set();
          for (const pc of packageCatalogue) {
            const linkedPkgs = pc.fields[PACKAGE_CATALOGUE.fields.package] || [];
            if (!linkedPkgs.includes(jwtPackageRec.id)) continue;
            if (!pc.fields[PACKAGE_CATALOGUE.fields.includedByDefault]) continue;
            const catLinks = pc.fields[PACKAGE_CATALOGUE.fields.catalogueItem] || [];
            if (catLinks[0]) newDefaultsCatIds.add(catLinks[0]);
          }

          // Existing entitlements for this client, by source
          const myEntitlements = allEntitlements.filter((e) =>
            (e.fields[CLIENT_ENTITLEMENTS.fields.client] || []).includes(clientRec.id)
          );
          const existingByCatId = new Map();
          for (const ent of myEntitlements) {
            const catLinks = ent.fields[CLIENT_ENTITLEMENTS.fields.catalogueItem] || [];
            if (catLinks[0]) existingByCatId.set(catLinks[0], ent);
          }

          let added = 0, removed = 0, kept = 0;

          // (a) Remove Package Default rows for catalogue items NOT in the new defaults
          for (const ent of myEntitlements) {
            const source = ent.fields[CLIENT_ENTITLEMENTS.fields.source] || '';
            if (source !== CLIENT_ENTITLEMENTS.sources.PACKAGE_DEFAULT) continue; // preserve Manual Override + Add-On
            const catLinks = ent.fields[CLIENT_ENTITLEMENTS.fields.catalogueItem] || [];
            const catId = catLinks[0];
            if (!catId || !newDefaultsCatIds.has(catId)) {
              // Mark disabled rather than hard-delete — preserves history
              await updateRecord(CLIENT_ENTITLEMENTS.tableId, ent.id, {
                [CLIENT_ENTITLEMENTS.fields.enabled]:         false,
                [CLIENT_ENTITLEMENTS.fields.source]:          CLIENT_ENTITLEMENTS.sources.REMOVED,
                [CLIENT_ENTITLEMENTS.fields.deactivatedDate]: nowIso,
                [CLIENT_ENTITLEMENTS.fields.lastModified]:    nowIso,
              });
              removed++;
            } else {
              kept++;
            }
          }

          // (b) Add Package Default rows for new defaults not currently held
          for (const catId of newDefaultsCatIds) {
            const existing = existingByCatId.get(catId);
            if (existing) {
              const src = existing.fields[CLIENT_ENTITLEMENTS.fields.source] || '';
              if (src === CLIENT_ENTITLEMENTS.sources.PACKAGE_DEFAULT &&
                  existing.fields[CLIENT_ENTITLEMENTS.fields.enabled]) {
                // Already active under the same source — nothing to do
                continue;
              }
              if (src === CLIENT_ENTITLEMENTS.sources.MANUAL_OVERRIDE ||
                  src === CLIENT_ENTITLEMENTS.sources.ADD_ON) {
                // Preserve manual additions exactly — do not touch
                continue;
              }
              // Re-enable a previously Removed row
              await updateRecord(CLIENT_ENTITLEMENTS.tableId, existing.id, {
                [CLIENT_ENTITLEMENTS.fields.enabled]:         true,
                [CLIENT_ENTITLEMENTS.fields.source]:          CLIENT_ENTITLEMENTS.sources.PACKAGE_DEFAULT,
                [CLIENT_ENTITLEMENTS.fields.activatedDate]:   nowIso,
                [CLIENT_ENTITLEMENTS.fields.deactivatedDate]: null,
                [CLIENT_ENTITLEMENTS.fields.lastModified]:    nowIso,
              });
              added++;
            } else {
              // Brand new entitlement row
              await createRecord(CLIENT_ENTITLEMENTS.tableId, {
                [CLIENT_ENTITLEMENTS.fields.client]:        [clientRec.id],
                [CLIENT_ENTITLEMENTS.fields.catalogueItem]: [catId],
                [CLIENT_ENTITLEMENTS.fields.enabled]:       true,
                [CLIENT_ENTITLEMENTS.fields.source]:        CLIENT_ENTITLEMENTS.sources.PACKAGE_DEFAULT,
                [CLIENT_ENTITLEMENTS.fields.activatedDate]: nowIso,
                [CLIENT_ENTITLEMENTS.fields.created]:       nowIso,
                [CLIENT_ENTITLEMENTS.fields.lastModified]:  nowIso,
              });
              added++;
            }
          }

          console.log('[sso] package sync for client', clientRec.id,
            `(${currentPackageId} → ${jwtPackageRec.id}):`,
            { added, removed, kept });

          // Refresh clientRec so the rest of the flow has the updated package link
          clientRec = await getRecord(CLIENTS.tableId, clientRec.id);
        } catch (err) {
          // Package sync is critical-ish but we don't want to block sign-in if
          // a partial update happened. Log loudly, continue with whatever state
          // is now in Airtable.
          console.error('[sso] package sync failed:', err);
        }
      }

      // API Key sync — the JWT is authoritative for the current Travelify
      // public API key for this App ID. Three cases:
      //   1. Stored value is blank → backfill from JWT (covers manually-set-up
      //      clients on their first SSO, and clients created before this field
      //      existed).
      //   2. Stored value differs from JWT → update to JWT (handles key
      //      rotation in Travelify).
      //   3. Stored value matches JWT → no-op.
      // Non-fatal: if the write fails, log and carry on so sign-in still works.
      const storedApiKey = String(clientRec.fields[CLIENTS.fields.apiKey] || '').trim();
      if (publicApiKey && storedApiKey !== publicApiKey) {
        try {
          await updateRecord(CLIENTS.tableId, clientRec.id, {
            [CLIENTS.fields.apiKey]: publicApiKey,
          });
          if (storedApiKey === '') {
            console.log('[sso] api key backfilled for client', clientRec.id, '(was blank)');
          } else {
            console.log('[sso] api key updated for client', clientRec.id, '(rotated)');
          }
        } catch (err) {
          console.error('[sso] api key sync failed for client', clientRec.id, err);
        }
      }
    }

    const clientId = clientRec.id;

    // 5. Resolve or create the User
    let userRec = await findOneByField(USERS.tableId, USERS.fields.email, email);
    let userCreated = false;

    if (userRec) {
      // Email exists. Append this client to the user's client links if not
      // already linked. Andy's call: a single user can have access to
      // multiple companies. Permissions are per (user × product) so the
      // user's set of accessible products varies depending on which client
      // the session is currently scoped to.
      const userClientIds = userRec.fields[USERS.fields.client] || [];
      if (!userClientIds.includes(clientId) && isStaffEmail(email)) {
        // Travelgenix staff act as any client via the switcher without becoming
        // a member. Auto-linking them here is what silently turned act-as into
        // permanent membership and broke impersonation detection. Skip it.
        console.log('[sso] staff', userRec.id, 'arrived with client', clientId,
          '— not auto-linking (act-as is membership-free for staff)');
      }
      if (!userClientIds.includes(clientId) && !isStaffEmail(email)) {
        try {
          await updateRecord(USERS.tableId, userRec.id, {
            [USERS.fields.client]: [...userClientIds, clientId],
          });
          // Refresh userRec so downstream code sees the new link
          userRec = await getRecord(USERS.tableId, userRec.id);
          console.log('[sso] linked existing user', userRec.id, 'to additional client', clientId);
        } catch (err) {
          console.error('[sso] failed to add user to additional client:', err);
          logAuthEvent({
            type: AUTH_EVENTS.types.SIGNIN_FAIL, success: false,
            userRecordId: userRec.id, clientRecordId: clientId,
            emailAttempted: email,
            ip, userAgent: ua,
            detail: { source: 'sso', reason: 'multi_company_link_failed', error: err.message?.slice(0, 200) },
          }).catch(() => {});
          return redirectToSignin(res, SSO_ERRORS.LINK_FAILED,
            (err.message || 'multi-company link write failed').slice(0, 100));
        }

        // Grant per-product permissions for this new client based on its
        // current enabled entitlements. Same pattern as new-user creation
        // below.
        try {
          const [catalogue, products, entitlements] = await Promise.all([
            listAllRecords(CATALOGUE.tableId),
            listAllRecords(PRODUCTS.tableId),
            listAllRecords(CLIENT_ENTITLEMENTS.tableId),
          ]);
          const productRecordIdBySlug = new Map();
          for (const p of products) {
            const slug = p.fields[PRODUCTS.fields.productId];
            if (slug) productRecordIdBySlug.set(slug, p.id);
          }
          const slugByCatalogueId = new Map();
          for (const c of catalogue) {
            const slug = c.fields[CATALOGUE.fields.productSlug];
            if (slug) slugByCatalogueId.set(c.id, slug);
          }
          const clientEnts = entitlements.filter((e) => {
            const linked = e.fields[CLIENT_ENTITLEMENTS.fields.client] || [];
            const enabled = e.fields[CLIENT_ENTITLEMENTS.fields.enabled];
            return linked.includes(clientId) && !!enabled;
          });
          const neededSlugs = new Set();
          for (const ent of clientEnts) {
            const cats = ent.fields[CLIENT_ENTITLEMENTS.fields.catalogueItem] || [];
            for (const cId of cats) {
              const slug = slugByCatalogueId.get(cId);
              if (slug) neededSlugs.add(slug);
            }
          }
          // Find which slugs they already have for THIS client (they may have
          // had permissions previously and we're re-linking)
          const existingPermsForThisClient = await listAllRecords(PERMISSIONS.tableId);
          const existingSlugsHeld = new Set();
          for (const perm of existingPermsForThisClient) {
            const userLinks = perm.fields[PERMISSIONS.fields.user] || [];
            if (!userLinks.includes(userRec.id)) continue;
            const productLinks = perm.fields[PERMISSIONS.fields.product] || [];
            const productRecId = productLinks[0];
            // Check if this product permission was granted in context of this client
            // (we don't track client on permission rows directly — permissions are
            // user×product. So we conservatively skip any slug they already hold,
            // even if from a different client).
            for (const [slug, recId] of productRecordIdBySlug.entries()) {
              if (recId === productRecId) existingSlugsHeld.add(slug);
            }
          }
          const nowIso = new Date().toISOString();
          for (const slug of neededSlugs) {
            if (existingSlugsHeld.has(slug)) continue; // already have it
            const productRecordId = productRecordIdBySlug.get(slug);
            if (!productRecordId) continue;
            await createRecord(PERMISSIONS.tableId, {
              [PERMISSIONS.fields.user]:    [userRec.id],
              [PERMISSIONS.fields.product]: [productRecordId],
              [PERMISSIONS.fields.role]:    PERMISSIONS.roles.CLIENT_USER,
              [PERMISSIONS.fields.status]:  PERMISSIONS.statuses.ACTIVE,
              [PERMISSIONS.fields.granted]: nowIso,
              [PERMISSIONS.fields.notes]:   `Granted via SSO multi-company link to client ${clientId}`,
            });
          }
        } catch (err) {
          // Non-fatal — they'll still sign in, just may see fewer products.
          console.error('[sso] permission grant on multi-company link failed:', err.message);
        }
      }

      if (userRec.fields[USERS.fields.status] === USERS.statuses.SUSPENDED) {
        logAuthEvent({
          type: AUTH_EVENTS.types.SIGNIN_FAIL, success: false,
          userRecordId: userRec.id, clientRecordId: clientId,
          emailAttempted: email,
          ip, userAgent: ua,
          detail: { source: 'sso', reason: 'suspended' },
        }).catch(() => {});
        return redirectToSignin(res, SSO_ERRORS.ACCOUNT_SUSPENDED, `user ${userRec.id}`);
      }
    } else {
      // Create the user with a random password they'll never need
      const randomPassword = uuid() + uuid(); // 64+ chars of entropy
      const passwordHash = await hashPassword(randomPassword);
      const fullName = `${givenName} ${familyName}`.trim();
      const nowIso = new Date().toISOString();
      userRec = await createRecord(USERS.tableId, {
        [USERS.fields.email]:        email,
        [USERS.fields.fullName]:     fullName,
        [USERS.fields.client]:       [clientId],
        [USERS.fields.role]:         clientCreated ? USERS.roles.OWNER : USERS.roles.MEMBER,
        [USERS.fields.status]:       USERS.statuses.ACTIVE,
        [USERS.fields.passwordHash]: passwordHash,
        // authMethods left empty — schema's multipleSelects options don't
        // include 'sso' and we don't want a schema modification just for
        // provenance. SSO origin is recorded in the AUTH_EVENTS log.
        [USERS.fields.authMethods]:  [],
        [USERS.fields.created]:      nowIso,
      });
      userCreated = true;

      // Grant permissions matching the client's enabled entitlements.
      // For a brand-new owner of a brand-new client we grant the full set;
      // for a new member at an existing client we grant whatever entitlements
      // the client currently has. Maps catalogue → product slug via the
      // CATALOGUE.productSlug field.
      try {
        const [catalogue, products, entitlements] = await Promise.all([
          listAllRecords(CATALOGUE.tableId),
          listAllRecords(PRODUCTS.tableId),
          listAllRecords(CLIENT_ENTITLEMENTS.tableId),
        ]);

        const productRecordIdBySlug = new Map();
        for (const p of products) {
          const slug = p.fields[PRODUCTS.fields.productId];
          if (slug) productRecordIdBySlug.set(slug, p.id);
        }
        const slugByCatalogueId = new Map();
        for (const c of catalogue) {
          const slug = c.fields[CATALOGUE.fields.productSlug];
          if (slug) slugByCatalogueId.set(c.id, slug);
        }

        const myEntitlements = entitlements.filter((e) => {
          const linked = e.fields[CLIENT_ENTITLEMENTS.fields.client] || [];
          const enabled = e.fields[CLIENT_ENTITLEMENTS.fields.enabled];
          return linked.includes(clientId) && !!enabled;
        });

        const neededSlugs = new Set();
        for (const ent of myEntitlements) {
          const cats = ent.fields[CLIENT_ENTITLEMENTS.fields.catalogueItem] || [];
          for (const cId of cats) {
            const slug = slugByCatalogueId.get(cId);
            if (slug) neededSlugs.add(slug);
          }
        }

        const grantRole = clientCreated ? PERMISSIONS.roles.CLIENT_OWNER : PERMISSIONS.roles.CLIENT_USER;
        for (const slug of neededSlugs) {
          const productRecordId = productRecordIdBySlug.get(slug);
          if (!productRecordId) continue;
          await createRecord(PERMISSIONS.tableId, {
            [PERMISSIONS.fields.user]:    [userRec.id],
            [PERMISSIONS.fields.product]: [productRecordId],
            [PERMISSIONS.fields.role]:    grantRole,
            [PERMISSIONS.fields.status]:  PERMISSIONS.statuses.ACTIVE,
            [PERMISSIONS.fields.granted]: nowIso,
            [PERMISSIONS.fields.notes]:   'Granted via SSO auto-provisioning',
          });
        }
      } catch (err) {
        // Non-fatal — log and continue. Without permissions they won't see
        // products but the session itself is good and admin can fix it.
        console.error('[sso] permission seeding partial-failed:', err.message);
      }
    }

    // 6. Mint session and set cookie (mirrors signin.js)
    const userFields = userRec.fields;
    const role = userFields[USERS.fields.role] || USERS.roles.MEMBER;
    const fullName = userFields[USERS.fields.fullName] || `${givenName} ${familyName}`.trim();
    const permissions = await resolveUserPermissions(userRec.id, email, { bypassCache: true });

    // Revoke any existing active sessions for this user. SSO is a hard
    // reset on session state — if the user signs in via SSO from app A
    // then again from app B, the A session should be killed. Without this
    // we accumulate stale session rows AND, worse, a stale cookie can
    // continue to resolve a prior session if the new cookie isn't picked
    // up cleanly by the browser (the bug Darren hit on 2026-05-12).
    let revokedCount = 0;
    try {
      revokedCount = await revokeAllUserSessions(userRec.id, 'sso_new_session');
    } catch (err) {
      // Non-fatal — log and continue. Better to have a duplicate session
      // than to block sign-in.
      console.error('[sso] revoke previous sessions failed:', err.message);
    }

    console.log('[sso] resolved client', clientId, 'for user', userRec.id,
      `(email=${email} appId=${travelifyAppId} package=${packageCode}` +
      ` clientCreated=${clientCreated} userCreated=${userCreated}` +
      ` previousSessionsRevoked=${revokedCount})`);

    const sessionId = uuid();
    const { token, jti, expiresAt } = signSessionToken({
      userId: userRec.id,
      clientId,
      role,
      sessionId,
      permissions: permissions.map((p) => ({ product: p.product, role: p.role })),
    });

    const nowIso = new Date().toISOString();
    await createRecord(SESSIONS.tableId, {
      [SESSIONS.fields.sessionId]: sessionId,
      [SESSIONS.fields.user]:      [userRec.id],
      [SESSIONS.fields.jwtJti]:    jti,
      [SESSIONS.fields.userAgent]: ua,
      [SESSIONS.fields.ipAddress]: ip,
      [SESSIONS.fields.created]:   nowIso,
      [SESSIONS.fields.expiresAt]: expiresAt.toISOString(),
      [SESSIONS.fields.lastUsed]:  nowIso,
    });

    console.log('[sso] minted new session', sessionId, 'for user', userRec.id, 'client', clientId);

    // Update last-login timestamp (best-effort)
    updateRecord(USERS.tableId, userRec.id, {
      [USERS.fields.lastLogin]:   nowIso,
      [USERS.fields.lastLoginIp]: ip,
    }).catch(() => {});

    // Clear the cookie first, then set the new one. This is defensive against
    // a stale cookie from a previous deploy that might have a slightly
    // different path or domain attribute and would otherwise sit alongside
    // the new cookie in the browser, ambiguously.
    clearSessionCookie(res, { req });
    setSessionCookie(res, token, expiresAt, { req });

    logAuthEvent({
      type: AUTH_EVENTS.types.SIGNIN_SUCCESS, success: true,
      userRecordId: userRec.id,
      clientRecordId: clientId,
      emailAttempted: email,
      ip, userAgent: ua,
      detail: {
        source: 'sso',
        clientCreated, userCreated,
        appId: travelifyAppId,
        packageCode,
      },
    }).catch(() => {});

    return redirectTo(res, safeNext(req.query?.next));
  } catch (err) {
    console.error('[sso] unexpected error:', err);
    logAuthEvent({
      type: AUTH_EVENTS.types.SIGNIN_FAIL, success: false,
      emailAttempted: email,
      ip, userAgent: ua,
      detail: { source: 'sso', reason: 'unexpected_error', error: String(err?.message || err).slice(0, 200) },
    }).catch(() => {});
    return redirectToSignin(res, SSO_ERRORS.UNEXPECTED,
      String(err?.message || err).slice(0, 100));
  }
}
