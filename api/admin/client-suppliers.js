/**
 * /api/admin/client-suppliers
 * Admin-gated. Read/write which suppliers a client shows in their offer and map
 * widgets.
 *
 * Off by default (opt-in): a supplier whose key is not in `enabled` is hidden.
 * Existing clients are grandfathered to all-on at launch by a one-off migration;
 * this endpoint is the ongoing per-client editor.
 *
 *   GET  ?clientId=recXXXXXXXXXXXXXX  → { clientId, enabled:[keys], updatedAt }
 *   POST { clientId, enabled:[keys] } → validates keys against the master list,
 *                                       stores, returns { ok, enabled }
 *
 * Keys are the master-list "prodType:id" (e.g. "Packages:61").
 */
import { requireAdmin, setAdminCors } from './_guard.js';
import { getJson, setJson } from '../_redis.js';

const clientKey = (clientId) => 'suppliers:client:' + clientId;
const MASTER_KEY = 'suppliers:master:v1';
const isRec = (v) => /^rec[A-Za-z0-9]{14}$/.test(String(v || ''));

async function masterKeySet() {
  const m = await getJson(MASTER_KEY);
  const list = (m && Array.isArray(m.suppliers)) ? m.suppliers : [];
  return new Set(list.map((s) => s.key));
}

export default async function handler(req, res) {
  setAdminCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  const gate = requireAdmin(req);
  if (gate.error) return res.status(gate.status).json({ error: gate.error });

  if (req.method === 'GET') {
    const clientId = String((req.query || {}).clientId || '').trim();
    if (!isRec(clientId)) return res.status(400).json({ error: 'Valid clientId required' });
    const rec = await getJson(clientKey(clientId));
    return res.status(200).json({
      clientId,
      enabled: (rec && Array.isArray(rec.enabled)) ? rec.enabled : [],
      configured: !!rec,
      updatedAt: (rec && rec.updatedAt) || null,
    });
  }

  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    body = body || {};
    const clientId = String(body.clientId || '').trim();
    if (!isRec(clientId)) return res.status(400).json({ error: 'Valid clientId required' });

    let enabled = Array.isArray(body.enabled) ? body.enabled.map((k) => String(k)).slice(0, 1000) : [];
    // Keep only keys present in the current master list (ignore stale/garbage).
    const valid = await masterKeySet();
    if (valid.size) enabled = enabled.filter((k) => valid.has(k));
    enabled = [...new Set(enabled)];

    const rec = { enabled, updatedAt: new Date().toISOString(), updatedBy: (gate.user && gate.user.email) || '' };
    const ok = await setJson(clientKey(clientId), rec);
    if (!ok) return res.status(500).json({ error: 'Could not save supplier selection' });
    return res.status(200).json({ ok: true, clientId, enabled });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
