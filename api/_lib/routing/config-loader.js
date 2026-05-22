// =============================================================================
//  /api/_lib/routing/config-loader.js
// =============================================================================
//
//  Fetches RoutingConfig records from the TG Enquiries base, filters by
//  widget record ID, decrypts credentials, returns a list of dispatch jobs.
//
//  Caching: in-memory cache, 60s TTL, keyed by widget record ID. Per-instance
//  only — Vercel cold starts will re-fetch. Acceptable; configs rarely change.
//  Cache is invalidated on demand via `invalidateConfigCache(widgetId)`.
//
//  Table + field IDs are wired to the live RoutingConfig table and mirror the
//  `F` map in /api/routing-configs.js. If that table's schema changes, update
//  BOTH files together.
//
// =============================================================================

import { decryptPat, encryptPat } from './pat-crypt.js';
import { KNOWN_DESTINATIONS } from './schema.js';

// ── Airtable connection ─────────────────────────────────────────────────

const ENQUIRIES_BASE_ID = process.env.TG_ENQUIRIES_AIRTABLE_BASE_ID;
const ENQUIRIES_PAT = process.env.TG_ENQUIRIES_AIRTABLE_PAT;

// Live RoutingConfig table — same table routing-configs.js writes to.
// Hardcoded to match the sibling file (no ROUTING_CONFIG_TABLE_ID env var is
// set in Vercel); an env override is still honoured if one is added later.
export const CONFIG_TABLE_ID = process.env.ROUTING_CONFIG_TABLE_ID || 'tblZO9mRFpD1eMcKx';

// Field name → field ID, from the live RoutingConfig table. These mirror the
// `F` map in /api/routing-configs.js exactly — the two files MUST stay in sync.
export const CONFIG_FIELDS = {
  name:               'flddEbJI8dRIjjO9p',
  widgetType:         'flduxQu6qlFU1GJhI',
  widgetRecordId:     'fldvhIuUMZ8wfKMN8',
  clientName:         'fldZxnhYrf6UY89Zg',
  clientEmail:        'fldqQA8EwGXA4gnIA',
  destination:        'fld7CL01oCQWcal3U',
  enabled:            'fldTzl9alTonLX7k4',
  testMode:           'fldfwrXvimwCFeRXQ',
  configJson:         'fld9z6pPdhXwm7tun',
  credentialsEnc:     'fldmbEIDSs9XFPosT',
  lastVerifiedAt:     'fldB6r6bFUM3EMPYT',
  lastVerifiedStatus: 'fld8CBagHhBcWDEiI',
  lastVerifiedError:  'fldnUrF7Gbq9fSbea',
  lastUsedAt:         'fldZOVXwrLvWe3Sbp',
  lastErrorAt:        'fldWaYy78qqbBDH2Y',
  lastErrorMessage:   'fldM93ZFZvwrkHhna',
};

// ── Cache ───────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 60_000;
const cache = new Map(); // widgetRecordId → { fetchedAt, jobs }

export function invalidateConfigCache(widgetRecordId) {
  if (widgetRecordId) cache.delete(widgetRecordId);
  else cache.clear();
}

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Fetch the active routing jobs for a given widget record.
 * Returns an array of dispatch job objects, ready to pass to the router:
 *   [
 *     {
 *       configRecordId: "rec...",
 *       destination: "mailchimp",
 *       config: { audienceId: "...", tags: [...] },
 *       credentials: { apiKey: "..." },
 *       testMode: false,
 *       clientEmail: "...",
 *       clientName: "..."
 *     },
 *     ...
 *   ]
 *
 * Disabled rows are filtered out. Rows with corrupt credentials are skipped
 * with an error logged but do not throw (so one bad config doesn't block
 * all routing for a widget).
 */
export async function loadRoutingJobs(widgetRecordId, options = {}) {
  if (!widgetRecordId) return [];

  // Cache check
  if (!options.skipCache) {
    const cached = cache.get(widgetRecordId);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return cached.jobs;
    }
  }

  if (!ENQUIRIES_BASE_ID || !ENQUIRIES_PAT) {
    console.warn('[config-loader] Airtable env vars not configured — returning no jobs');
    return [];
  }

  // If table ID is still a placeholder, log and bail gracefully
  if (CONFIG_TABLE_ID.startsWith('tblPLACEHOLDER')) {
    console.warn('[config-loader] CONFIG_TABLE_ID is still a placeholder — returning no jobs');
    return [];
  }

  try {
    const records = await fetchByWidgetId(widgetRecordId);
    const jobs = [];
    for (const rec of records) {
      try {
        const job = recordToJob(rec);
        if (job) jobs.push(job);
      } catch (err) {
        console.error(`[config-loader] Skipping config ${rec.id}: ${err.message}`);
      }
    }
    cache.set(widgetRecordId, { fetchedAt: Date.now(), jobs });
    return jobs;
  } catch (err) {
    console.error(`[config-loader] Failed to load configs for widget ${widgetRecordId}:`, err.message);
    return [];
  }
}

/**
 * Update a RoutingConfig record's last-used / last-error fields.
 * Fire-and-forget; errors logged but not thrown.
 */
export async function recordDispatchOutcome(configRecordId, outcome) {
  if (!configRecordId || CONFIG_TABLE_ID.startsWith('tblPLACEHOLDER')) return;

  const fields = {};
  const now = new Date().toISOString();

  if (outcome.status === 'success') {
    fields[CONFIG_FIELDS.lastUsedAt] = now;
  } else if (outcome.status === 'failed') {
    fields[CONFIG_FIELDS.lastErrorAt] = now;
    fields[CONFIG_FIELDS.lastErrorMessage] = String(outcome.error || '').slice(0, 5000);
  }

  if (Object.keys(fields).length === 0) return;

  try {
    const url = `https://api.airtable.com/v0/${ENQUIRIES_BASE_ID}/${CONFIG_TABLE_ID}/${configRecordId}`;
    await fetch(url, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${ENQUIRIES_PAT}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fields }),
    });
  } catch (err) {
    console.error(`[config-loader] Failed to record outcome for ${configRecordId}:`, err.message);
  }
}

/**
 * Persist refreshed credentials for a RoutingConfig record.
 *
 * Some destination handlers (e.g. Constant Contact OAuth) refresh their access
 * tokens during dispatch and return them as `result.refreshedCredentials`. The
 * router calls this to write the new creds back so the next dispatch uses them
 * instead of re-refreshing every time.
 *
 * Signature matches the router call:
 *   updateCredentials(configRecordId, widgetRecordId, refreshedCredentials)
 *
 * Credentials are re-encrypted with the same AES-256-GCM key (TG_PAT_ENCRYPTION_KEY)
 * that routing-configs.js used to write them, so the round-trip is symmetric.
 *
 * Fire-and-forget; errors are logged, never thrown. After a successful write the
 * widget's config cache is invalidated so the refreshed creds are picked up.
 */
export async function updateCredentials(configRecordId, widgetRecordId, refreshedCredentials) {
  if (!configRecordId || CONFIG_TABLE_ID.startsWith('tblPLACEHOLDER')) return;
  if (!refreshedCredentials || typeof refreshedCredentials !== 'object') return;
  if (!ENQUIRIES_BASE_ID || !ENQUIRIES_PAT) return;

  let credentialsEnc;
  try {
    credentialsEnc = encryptPat(JSON.stringify(refreshedCredentials));
  } catch (err) {
    console.error(`[config-loader] Failed to encrypt refreshed creds for ${configRecordId}:`, err.message);
    return;
  }

  try {
    const url = `https://api.airtable.com/v0/${ENQUIRIES_BASE_ID}/${CONFIG_TABLE_ID}/${configRecordId}`;
    const resp = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${ENQUIRIES_PAT}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fields: { [CONFIG_FIELDS.credentialsEnc]: credentialsEnc } }),
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      console.error(`[config-loader] updateCredentials PATCH ${resp.status} for ${configRecordId}: ${txt.slice(0, 200)}`);
      return;
    }
    // Next dispatch should read the refreshed creds, not the cached jobs.
    if (widgetRecordId) invalidateConfigCache(widgetRecordId);
  } catch (err) {
    console.error(`[config-loader] Failed to update credentials for ${configRecordId}:`, err.message);
  }
}

// ── Internals ───────────────────────────────────────────────────────────

async function fetchByWidgetId(widgetRecordId) {
  // Filter formula: {Widget Record ID} = "rec..." AND {Enabled} = TRUE()
  const safe = widgetRecordId.replace(/[^a-zA-Z0-9]/g, '');
  const formula = `AND({${CONFIG_FIELDS.widgetRecordId}} = "${safe}", {${CONFIG_FIELDS.enabled}} = TRUE())`;

  const params = new URLSearchParams();
  params.set('filterByFormula', formula);
  params.set('pageSize', '50');
  // Limit to fields we actually use
  const fieldIds = Object.values(CONFIG_FIELDS);
  for (const f of fieldIds) params.append('fields[]', f);

  const url = `https://api.airtable.com/v0/${ENQUIRIES_BASE_ID}/${CONFIG_TABLE_ID}?${params}`;
  const resp = await fetch(url, {
    headers: { 'Authorization': `Bearer ${ENQUIRIES_PAT}` },
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`Airtable ${resp.status}: ${txt.slice(0, 200)}`);
  }
  const data = await resp.json();
  return data.records || [];
}

function recordToJob(rec) {
  const f = rec.fields || {};
  const destination = f[CONFIG_FIELDS.destination];
  if (!destination) return null;
  if (!KNOWN_DESTINATIONS.includes(destination)) {
    throw new Error(`Unknown destination: ${destination}`);
  }

  // Parse non-secret config
  let config = {};
  const rawCfg = f[CONFIG_FIELDS.configJson];
  if (rawCfg) {
    try { config = JSON.parse(rawCfg); }
    catch { throw new Error('Config JSON parse failed'); }
  }

  // Decrypt credentials if present
  let credentials = {};
  const enc = f[CONFIG_FIELDS.credentialsEnc];
  if (enc) {
    try {
      const decrypted = decryptPat(enc);
      credentials = JSON.parse(decrypted);
    } catch (err) {
      throw new Error(`Credentials decrypt/parse failed: ${err.message}`);
    }
  }

  return {
    configRecordId: rec.id,
    destination,
    config,
    credentials,
    testMode: !!f[CONFIG_FIELDS.testMode],
    clientName: f[CONFIG_FIELDS.clientName] || '',
    clientEmail: f[CONFIG_FIELDS.clientEmail] || '',
  };
}
