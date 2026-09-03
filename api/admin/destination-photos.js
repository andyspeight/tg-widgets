/**
 * /api/admin/destination-photos — admin-gated hero photo fill for the
 * Destination Content base.
 *
 * Why: on 3 Sep 2026, 394 of 495 resorts and 121 of 284 cities had no hero
 * photo, so their Destination Spotlight rendered a brand gradient instead of
 * a place. The countries were filled from Unsplash search results (three
 * landscape photos per record, a credit line per photo). This fills the rest
 * the same way, a batch at a time, from the admin page at
 * /admin/destination-photos.
 *
 *   GET                                   → { configured, counts: { country, city, resort } }
 *                                           (records still without a photo, per level)
 *   POST { level: 'resort'|'city'|'country', limit?: 1..25, dryRun?: true }
 *                                         → { level, dryRun, considered, filled, remaining,
 *                                             items: [{ recordId, name, query, urls, credits, status, error? }] }
 *
 * Env:
 *   UNSPLASH_ACCESS_KEY — Unsplash API access key (Client-ID auth). Without it
 *                         the endpoint reports configured:false and refuses to fill.
 *   AIRTABLE_DESTINATION_CONTENT_PAT (falls back to AIRTABLE_PAT, then
 *   AIRTABLE_KEY) — the same write path the airport reference fill uses.
 *
 * Unsplash API guidelines honoured: hotlinked `urls.raw` with our sizing params
 * (exactly the shape of the existing records), a credit line per photo with the
 * photographer's page, and the download_location endpoint pinged per photo used.
 *
 * Only records with an EMPTY images field are ever touched; a record that
 * already has a photo, however it got there, is never overwritten.
 */

import { requireAdmin, setAdminCors } from './_guard.js';

export const config = { maxDuration: 60 };

const AIRTABLE_API = 'https://api.airtable.com/v0';
const UNSPLASH_API = 'https://api.unsplash.com';
const DESTINATION_BASE_ID = process.env.DESTINATION_CONTENT_BASE_ID || 'appuZdlMJ7HKUt6qS';
const PHOTOS_PER_RECORD = 3;
const MAX_BATCH = 25;
const FETCH_TIMEOUT_MS = 8000;

// Field IDs mirror api/destination-content.js (LEVEL_MAP) so a renamed field
// in Airtable cannot break the fill.
export const LEVELS = {
  country: {
    tableId: 'tblsxbqbyhTDoWhbo',
    name: 'flddJJrpwcXOwWIow', images: 'fldTqpNZX5n1219mh', attributions: 'fldVxxvianhuEj11t',
    parent: null, parentLevel: null,
    hint: 'travel landscape',
  },
  city: {
    tableId: 'tblTkKujdVZgWPAQe',
    name: 'fld2VkY61c1JKUWKB', images: 'fldt3898YIanGbfzc', attributions: 'fldzdo1vtYbAvpt0v',
    parent: 'fldmJaOJZcMFtJNZD', parentLevel: 'country',
    hint: 'travel',
  },
  resort: {
    tableId: 'tblwV9gnbVEyZ99gI',
    name: 'fldnvOipaWpG3W1rx', images: 'fldBMns5p5ChZCriU', attributions: 'fldMn6hYB1o5OwJpN',
    parent: 'fldrUx3VrEMJPheIP', parentLevel: 'city',
    hint: 'holiday beach resort',
  },
};

const airtablePat = () => process.env.AIRTABLE_DESTINATION_CONTENT_PAT || process.env.AIRTABLE_PAT || process.env.AIRTABLE_KEY || '';
const unsplashKey = () => process.env.UNSPLASH_ACCESS_KEY || '';

/** The search query for one record: its name, the parent place for context,
 *  and the level's hint word. Exported for the smoke test. */
export function buildQuery(name, parentName, level) {
  const lv = LEVELS[level] || LEVELS.resort;
  return [String(name || '').trim(), String(parentName || '').trim(), lv.hint].filter(Boolean).join(' ').replace(/\s+/g, ' ');
}

/** Turn Unsplash search results into the multiline Images + Attributions cell
 *  values the widget already reads. Exported for the smoke test. */
export function photosToCells(results) {
  const urls = [], credits = [], downloads = [];
  for (const p of Array.isArray(results) ? results : []) {
    const raw = p && p.urls && typeof p.urls.raw === 'string' ? p.urls.raw : '';
    if (!/^https:\/\/images\.unsplash\.com\//.test(raw)) continue;
    urls.push(raw + (raw.includes('?') ? '&' : '?') + 'w=1200&fit=crop&q=80');
    const who = p.user && p.user.name ? String(p.user.name).trim() : 'Unsplash';
    const page = p.links && p.links.html ? String(p.links.html) : 'https://unsplash.com';
    credits.push('Photo by ' + who + ' on Unsplash (' + page + ')');
    if (p.links && p.links.download_location) downloads.push(String(p.links.download_location));
    if (urls.length >= PHOTOS_PER_RECORD) break;
  }
  return { urls, credits, downloads };
}

async function airtable(path, opts) {
  const res = await fetch(`${AIRTABLE_API}/${DESTINATION_BASE_ID}/${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${airtablePat()}`, 'Content-Type': 'application/json', ...(opts && opts.headers) },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`airtable ${res.status}`);
  return res.json();
}

/** Every record at a level with name, images and parent link, by field id. */
async function listLevel(level) {
  const lv = LEVELS[level];
  const out = [];
  let offset;
  do {
    const params = new URLSearchParams();
    params.set('pageSize', '100');
    params.set('returnFieldsByFieldId', 'true');
    params.append('fields[]', lv.name);
    params.append('fields[]', lv.images);
    if (lv.parent) params.append('fields[]', lv.parent);
    if (offset) params.set('offset', offset);
    const data = await airtable(`${lv.tableId}?${params.toString()}`);
    for (const r of data.records || []) {
      const f = r.fields || {};
      out.push({
        recordId: r.id,
        name: String(f[lv.name] || '').trim(),
        hasImage: typeof f[lv.images] === 'string' && f[lv.images].trim() !== '',
        parentId: lv.parent && Array.isArray(f[lv.parent]) && f[lv.parent][0] ? f[lv.parent][0] : '',
      });
    }
    offset = data.offset;
  } while (offset);
  return out;
}

/** Names for a set of parent record ids (one call per 40 ids). */
async function parentNames(level, ids) {
  const lv = LEVELS[level];
  const names = new Map();
  const uniq = Array.from(new Set(ids.filter(Boolean)));
  for (let i = 0; i < uniq.length; i += 40) {
    const chunk = uniq.slice(i, i + 40);
    const formula = 'OR(' + chunk.map(id => `RECORD_ID()='${id}'`).join(',') + ')';
    const params = new URLSearchParams();
    params.set('filterByFormula', formula);
    params.set('returnFieldsByFieldId', 'true');
    params.append('fields[]', lv.name);
    params.set('pageSize', '100');
    try {
      const data = await airtable(`${lv.tableId}?${params.toString()}`);
      for (const r of data.records || []) names.set(r.id, String((r.fields || {})[lv.name] || '').trim());
    } catch (e) { /* context only: a miss just means a plainer query */ }
  }
  return names;
}

async function unsplashSearch(query) {
  const params = new URLSearchParams({ query, per_page: String(PHOTOS_PER_RECORD), orientation: 'landscape', content_filter: 'high' });
  const res = await fetch(`${UNSPLASH_API}/search/photos?${params.toString()}`, {
    headers: { Authorization: `Client-ID ${unsplashKey()}`, 'Accept-Version': 'v1' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (res.status === 403) throw new Error('unsplash rate limit');
  if (!res.ok) throw new Error(`unsplash ${res.status}`);
  const data = await res.json();
  return Array.isArray(data.results) ? data.results : [];
}

// Unsplash asks that a "download" is registered when a photo is used.
async function registerDownloads(urls) {
  await Promise.allSettled(urls.map(u => fetch(u, {
    headers: { Authorization: `Client-ID ${unsplashKey()}`, 'Accept-Version': 'v1' },
    signal: AbortSignal.timeout(4000),
  })));
}

export default async function handler(req, res) {
  setAdminCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  const gate = requireAdmin(req);
  if (gate.error) return res.status(gate.status).json({ error: gate.error });
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    try {
      const counts = {};
      for (const level of Object.keys(LEVELS)) {
        const rows = await listLevel(level);
        counts[level] = rows.filter(r => !r.hasImage).length;
      }
      return res.status(200).json({ configured: !!unsplashKey(), counts });
    } catch (e) {
      console.error('[destination-photos] count failed', e.message);
      return res.status(502).json({ error: 'Could not read the Destination Content base.' });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  if (!body || typeof body !== 'object') body = {};
  const level = LEVELS[body.level] ? body.level : '';
  if (!level) return res.status(400).json({ error: "level must be 'resort', 'city' or 'country'" });
  const limit = Math.max(1, Math.min(MAX_BATCH, parseInt(body.limit, 10) || 10));
  const dryRun = body.dryRun === true;
  if (!unsplashKey()) return res.status(409).json({ error: 'UNSPLASH_ACCESS_KEY is not set on the deployment, so nothing can be fetched.', configured: false });

  const lv = LEVELS[level];
  let rows;
  try { rows = await listLevel(level); }
  catch (e) {
    console.error('[destination-photos] list failed', e.message);
    return res.status(502).json({ error: 'Could not read the Destination Content base.' });
  }
  const missing = rows.filter(r => !r.hasImage && r.name);
  const batch = missing.slice(0, limit);
  const parents = lv.parentLevel ? await parentNames(lv.parentLevel, batch.map(b => b.parentId)) : new Map();

  const items = [];
  let filled = 0;
  for (const rec of batch) {
    const query = buildQuery(rec.name, parents.get(rec.parentId) || '', level);
    const item = { recordId: rec.recordId, name: rec.name, query, urls: [], credits: [], status: 'skipped' };
    try {
      const results = await unsplashSearch(query);
      const cells = photosToCells(results);
      item.urls = cells.urls;
      item.credits = cells.credits;
      if (!cells.urls.length) { item.status = 'no-results'; items.push(item); continue; }
      if (dryRun) { item.status = 'would-fill'; items.push(item); continue; }
      await airtable(`${lv.tableId}/${rec.recordId}`, {
        method: 'PATCH',
        body: JSON.stringify({ fields: { [lv.images]: cells.urls.join('\n'), [lv.attributions]: cells.credits.join('\n') }, typecast: true }),
      });
      registerDownloads(cells.downloads).catch(() => {});
      item.status = 'filled';
      filled++;
    } catch (e) {
      item.status = 'failed';
      item.error = e.message;
      // An Unsplash rate limit stops the batch: retrying would only burn the hour.
      if (/rate limit/.test(e.message)) { items.push(item); break; }
    }
    items.push(item);
  }

  return res.status(200).json({
    level, dryRun, limit,
    considered: batch.length,
    filled,
    remaining: Math.max(0, missing.length - filled),
    items,
  });
}
