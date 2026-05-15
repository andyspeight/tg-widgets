/**
 * Plan resolution helper.
 *
 * Loads a client's package/plan name from the Clients table and normalises
 * it to one of the strings the rest of the system expects:
 *   'Spark' | 'Boost' | 'Ignite' | 'Bespoke' | ''
 *
 * The Clients.plan field can come back from Airtable in several shapes
 * depending on how it was configured:
 *   - string           — singleSelect or plain text
 *   - object {name}    — singleSelect serialised as an object (rare)
 *   - array [string]   — linked-record field returning record IDs
 *   - undefined / null — missing
 *
 * For linked-record shape we look up the linked Packages record by ID
 * and read its packageName field. For all other shapes we coerce to
 * a trimmed string. Unknown values pass through unchanged so debugging
 * can see what's actually in the field.
 *
 * Used by:
 *   - api/auth/signin.js        — embed plan in newly-issued JWT
 *   - api/auth/sso.js           — same, on SSO redirect path
 *   - api/auth/switch-client.js — re-issue JWT with new client's plan
 *   - api/widget-config.js      — fallback for legacy JWTs missing plan
 *
 * @param {string} clientRecordId — Airtable record id of the Clients row
 * @returns {Promise<string>} plan name string, or empty string on failure
 */

import { getRecord } from './airtable.js';
import { CLIENTS, PACKAGES } from './schema.js';

export async function resolveClientPlan(clientRecordId) {
  if (!clientRecordId || typeof clientRecordId !== 'string') return '';

  let client;
  try {
    client = await getRecord(CLIENTS.tableId, clientRecordId);
  } catch (err) {
    console.warn('[plan] Failed to load client record', clientRecordId, err.message);
    return '';
  }

  const raw = client?.fields?.[CLIENTS.fields.plan];
  return await normalisePlanValue(raw);
}

/**
 * Normalise whatever shape the plan field returns into a plain string.
 * Exported so tests / call sites that already have the raw value can
 * use the same logic without a re-fetch.
 *
 * @param {*} raw — value of Clients.plan from Airtable
 * @returns {Promise<string>}
 */
export async function normalisePlanValue(raw) {
  if (raw === undefined || raw === null) return '';

  // singleSelect-as-object shape: { name: 'Boost' }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return typeof raw.name === 'string' ? raw.name.trim() : '';
  }

  // plain string shape
  if (typeof raw === 'string') return raw.trim();

  // linked-record shape: ['recXXXX...']
  if (Array.isArray(raw) && raw.length > 0) {
    const first = raw[0];

    // If the array element is already a string (could be either a record ID
    // or a plain plan name in a multipleSelect field), try to recognise a
    // record ID by Airtable's usual 'rec' prefix + 14+ alphanumeric chars.
    if (typeof first === 'string') {
      if (/^rec[A-Za-z0-9]{14,}$/.test(first)) {
        // Linked record — look up the Packages row to get packageName
        try {
          const pkg = await getRecord(PACKAGES.tableId, first);
          const name = pkg?.fields?.[PACKAGES.fields.packageName];
          return typeof name === 'string' ? name.trim() : '';
        } catch (err) {
          console.warn('[plan] Failed to load package record', first, err.message);
          return '';
        }
      }
      // multipleSelect or similar — first string is the plan
      return first.trim();
    }

    // Array of objects shape: [{ name: 'Boost' }]
    if (typeof first === 'object' && first && typeof first.name === 'string') {
      return first.name.trim();
    }
  }

  return '';
}
