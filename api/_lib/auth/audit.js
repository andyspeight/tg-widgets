/**
 * Append-only audit log for auth events.
 *
 * Every interesting auth event lands here. Used for:
 * - Security review (failed-login patterns, brute force detection)
 * - Support ("when did Sarah last sign in?")
 * - Compliance / due diligence (acquirers will ask)
 *
 * Failures to log are NEVER fatal — we log and swallow so a transient
 * Airtable issue can't break sign-in.
 */

import { AUTH_EVENTS } from './schema.js';
import { createRecord } from './airtable.js';
import { uuid } from './crypto.js';

/**
 * @param {object} event
 * @param {string} event.type — one of AUTH_EVENTS.types
 * @param {boolean} event.success
 * @param {string} [event.userRecordId]
 * @param {string} [event.clientRecordId]
 * @param {string} [event.emailAttempted]
 * @param {string} [event.ip]
 * @param {string} [event.userAgent]
 * @param {object|string} [event.detail] — JSON-serialisable extra context
 */
export async function logAuthEvent(event) {
  try {
    const fields = {
      [AUTH_EVENTS.fields.eventId]:   uuid(),
      [AUTH_EVENTS.fields.type]:      event.type,
      [AUTH_EVENTS.fields.success]:   !!event.success,
      [AUTH_EVENTS.fields.timestamp]: new Date().toISOString()
    };
    if (event.userRecordId)   fields[AUTH_EVENTS.fields.user]           = [event.userRecordId];
    if (event.clientRecordId) fields[AUTH_EVENTS.fields.client]         = [event.clientRecordId];
    if (event.emailAttempted) fields[AUTH_EVENTS.fields.emailAttempted] = event.emailAttempted;
    if (event.ip)             fields[AUTH_EVENTS.fields.ip]             = event.ip.slice(0, 64);
    if (event.userAgent)      fields[AUTH_EVENTS.fields.userAgent]      = event.userAgent.slice(0, 500);
    if (event.detail) {
      const d = typeof event.detail === 'string' ? event.detail : JSON.stringify(event.detail);
      fields[AUTH_EVENTS.fields.detail] = d.slice(0, 5000);
    }
    await createRecord(AUTH_EVENTS.tableId, fields);
  } catch (err) {
    // Never throw from the logger — we don't want logging failure to block auth
    console.error('[auth/audit] logAuthEvent failed:', err.message);
  }
}
