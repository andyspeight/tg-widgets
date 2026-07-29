/**
 * Provision a client in Luna Chat.
 *
 * Client Control is where client access is granted, so switching Luna Chat on
 * here has to create the client in Luna Chat too. Until now it did not, and
 * every Luna Chat record was made by hand. That produced, in one week:
 *
 *   - a client live in Client Control with no Luna Chat record at all, so they
 *     appeared nowhere — not in the client list, not in "Act as"
 *   - a client with no App ID, so Luna had no search configured and invented
 *     booking links on their own domain that all 404'd
 *   - a client with no AuthClientId, so they hit "No Luna Chat client linked to
 *     your account" when they tried to open their dashboard
 *
 * Luna Chat's endpoint is an upsert keyed on `externalId`, so calling this
 * repeatedly is safe: flipping the toggle twice updates one record rather than
 * creating a duplicate, and a rename moves the existing client instead of
 * orphaning them.
 *
 * NOTE ON IDS. Luna Chat needs two ids and they are BOTH this client's Airtable
 * record id in the auth base:
 *   - externalId    the stable key it upserts against
 *   - authClientId  what it compares against `client.recordId` from /api/auth/me
 *                   to decide whether a signed-in user may open this client
 * They are the same value; that is not a mistake.
 *
 * Failure is deliberately NOT fatal to the caller. The entitlement in Client
 * Control is the source of truth and must save even if Luna Chat is unreachable.
 * Callers should surface the returned warning rather than failing the request.
 *
 * Env:
 *   LUNA_CHAT_ADMIN_PASS  required — the ADMIN_PASSWORD of the Luna Chat project
 *   LUNA_CHAT_BASE_URL    optional — defaults to https://chat.travelify.io
 */

import { CLIENTS } from './auth/schema.js';

const DEFAULT_BASE = 'https://chat.travelify.io';
const TIMEOUT_MS = 8000;

/**
 * @param {object} clientRecord  Airtable record from the Clients table
 * @param {boolean} enabled      true = active in Luna Chat, false = deactivate
 * @returns {Promise<{ok: boolean, skipped?: boolean, action?: string, warning?: string}>}
 */
export async function provisionLunaChat(clientRecord, enabled) {
  const adminPass = process.env.LUNA_CHAT_ADMIN_PASS;
  if (!adminPass) {
    console.warn('[luna-chat-provision] LUNA_CHAT_ADMIN_PASS not set — skipping');
    return {
      ok: false,
      skipped: true,
      warning: 'Luna Chat was not updated: the integration is not configured on this environment.'
    };
  }

  const f = (clientRecord && clientRecord.fields) || {};
  // Trading name is what the public sees, so prefer it — but this string becomes
  // the clientName in their widget embed code, and changing it later is what
  // nearly took a live client's chat down. Luna Chat handles the rename safely
  // (it keeps the old name working), but pick the most stable one available.
  const name = String(f[CLIENTS.fields.tradingName] || f[CLIENTS.fields.clientName] || '').trim();
  const email = String(f[CLIENTS.fields.email] || '').trim();
  const appId = String(f[CLIENTS.fields.travelifyAppId] || f[CLIENTS.fields.travelifySiteId] || '').trim();

  if (!name || !email) {
    console.warn('[luna-chat-provision] client', clientRecord?.id, 'has no name or email — skipping');
    return {
      ok: false,
      skipped: true,
      warning: 'Luna Chat was not updated: this client needs a name and a contact email first.'
    };
  }

  const base = (process.env.LUNA_CHAT_BASE_URL || DEFAULT_BASE).replace(/\/$/, '');
  const payload = {
    externalId: clientRecord.id,
    name,
    email,
    appId,
    authClientId: clientRecord.id,
    active: !!enabled
  };

  try {
    const r = await fetch(base + '/api/clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Pass': adminPass },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error('[luna-chat-provision] failed', r.status, data && data.error);
      return {
        ok: false,
        warning: 'Saved here, but Luna Chat could not be updated (' + r.status + '). '
          + 'Their entitlement is correct; retry the toggle once Luna Chat is reachable.'
      };
    }
    console.log('[luna-chat-provision]', data.action || 'ok', name,
      'externalId=' + clientRecord.id, 'appId=' + (appId || '(none)'), 'active=' + !!enabled);
    return { ok: true, action: data.action };
  } catch (err) {
    console.error('[luna-chat-provision] error:', err && err.message);
    return {
      ok: false,
      warning: 'Saved here, but Luna Chat could not be reached. Their entitlement is '
        + 'correct; retry the toggle when Luna Chat is back.'
    };
  }
}

export default provisionLunaChat;
