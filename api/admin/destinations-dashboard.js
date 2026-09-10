/**
 * GET /api/admin/destinations-dashboard
 *
 * The read model behind /admin/destinations — one pass over the whole
 * Destination Content base (appuZdlMJ7HKUt6qS), turned into coverage figures,
 * field-level fill rates and a ranked queue of what to fix next.
 *
 * WHY A SINGLE ENDPOINT. The five tables only mean something together. A
 * country is not "done" because its own fields are full if the twelve resorts
 * hanging off it are skeletons, and a field is not "worth filling" because it
 * is empty on one record if it is empty on four hundred. Both judgements need
 * the whole base in memory at once, so the scan happens here, server-side,
 * once, and the browser receives figures rather than 1,539 raw records.
 *
 * WHAT IT DOES NOT DO. It writes nothing, ever. Fixing the gaps it finds is a
 * separate, deliberate act — see api/_lib/destination-automation.js for the
 * switch that currently holds every write path shut. This route stays readable
 * while that switch is on, which is the whole point of pausing rather than
 * turning things off.
 *
 * The scoring itself lives in api/_lib/destination-coverage.js, which has no
 * network or auth imports so the judgement calls can be tested on their own.
 *
 * Query:
 *   ?refresh=1   bypass the cache and re-scan
 *
 * Security: admin-gated (same requireAdmin as the other admin routes),
 * same-origin, no-store. The Destination Content PAT stays server-side.
 */
import { requireAdmin, setAdminCors } from './_guard.js';
import { getJson, setJson, configured as redisConfigured } from '../_redis.js';
import { destinationAutomationPaused, PAUSE_NOTE } from '../_lib/destination-automation.js';
import { TYPES, fieldIdsFor, aggregate } from '../_lib/destination-coverage.js';

const AIRTABLE_API = 'https://api.airtable.com/v0';
const BASE_ID = process.env.REFERENCE_BASE_ID || 'appuZdlMJ7HKUt6qS';
const PAT = process.env.AIRTABLE_DESTINATION_CONTENT_PAT || process.env.AIRTABLE_PAT || '';

const CACHE_KEY = 'destinations:dashboard:v1';
const CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * Walk one table in full. The page cap is a guard, not a limit: 40 pages of
 * 100 covers every table with headroom, and stops a runaway from hanging the
 * function rather than silently truncating a table we actually have.
 */
async function listAll(tableId, fieldIds) {
  const out = [];
  let offset = '';
  for (let page = 0; page < 40; page++) {
    const qs = new URLSearchParams({ pageSize: '100', returnFieldsByFieldId: 'true' });
    for (const id of fieldIds) qs.append('fields[]', id);
    if (offset) qs.set('offset', offset);
    const r = await fetch(`${AIRTABLE_API}/${BASE_ID}/${tableId}?${qs}`, {
      headers: { Authorization: `Bearer ${PAT}` },
    });
    if (!r.ok) throw new Error(`Airtable ${r.status} on ${tableId}`);
    const json = await r.json();
    for (const rec of json.records || []) {
      out.push({ id: rec.id, createdTime: rec.createdTime, fields: rec.fields || {} });
    }
    offset = json.offset || '';
    if (!offset) return out;
  }
  throw new Error(`Table ${tableId} did not finish paginating in 40 pages`);
}

/** Scan every table in parallel, then aggregate. */
async function buildDashboard() {
  const scanned = await Promise.all(TYPES.map(async (spec) => ({
    spec,
    rows: await listAll(spec.tableId, fieldIdsFor(spec)),
  })));

  return {
    ...aggregate(scanned),
    baseId: BASE_ID,
    automation: {
      paused: destinationAutomationPaused(),
      since: PAUSE_NOTE.since,
      reason: PAUSE_NOTE.reason,
    },
  };
}

export default async function handler(req, res) {
  setAdminCors(req, res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.statusCode = 405;
    return res.end(JSON.stringify({ error: 'GET only' }));
  }

  const gate = requireAdmin(req);
  if (gate.error) {
    res.statusCode = gate.status;
    return res.end(JSON.stringify({ error: gate.error }));
  }

  if (!PAT) {
    res.statusCode = 500;
    return res.end(JSON.stringify({ error: 'Destination Content PAT is not configured.' }));
  }

  const force = new URL(req.url, 'http://localhost').searchParams.get('refresh') === '1';

  try {
    if (!force && redisConfigured()) {
      const hit = await getJson(CACHE_KEY).catch(() => null);
      if (hit && hit.generatedAt && (Date.now() - new Date(hit.generatedAt).getTime()) < CACHE_TTL_MS) {
        // The pause can be lifted without a redeploy, so never serve a cached
        // automation state — re-read it on the way out.
        hit.automation = {
          paused: destinationAutomationPaused(),
          since: PAUSE_NOTE.since,
          reason: PAUSE_NOTE.reason,
        };
        return res.end(JSON.stringify({ ...hit, cached: true }));
      }
    }

    const data = await buildDashboard();
    if (redisConfigured()) await setJson(CACHE_KEY, data).catch(() => {});
    return res.end(JSON.stringify({ ...data, cached: false }));
  } catch (err) {
    console.error('[destinations-dashboard]', err);
    res.statusCode = 502;
    return res.end(JSON.stringify({
      error: 'Could not read the destination base.',
      detail: String(err.message || err),
    }));
  }
}
