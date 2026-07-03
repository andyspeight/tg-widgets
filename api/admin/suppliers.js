/**
 * GET /api/admin/suppliers
 * Admin-gated. The master supplier list for the offer-supplier feature, fetched
 * from Travelify's public activesuppliers API and cached in Redis (daily).
 *
 * Only the product types the offer cache holds — Packages, Accommodation and
 * Flights — are returned, since those are the only suppliers whose offers can
 * appear in the map or offer widgets. Each supplier gets a stable `key`
 * (prodType:id): the raw `id` repeats across product types (Traveltek,
 * HotelBeds, Custom, Travelify, Jonview…), so id alone is not unique.
 *
 * ?refresh=1 forces a re-fetch. On upstream failure we serve the last good
 * cached copy rather than breaking the Control page.
 */
import { requireAdmin, setAdminCors } from './_guard.js';
import { getJson, setJson } from '../_redis.js';

const SRC = 'https://api.travelify.io/admin/activesuppliers';
const CACHE_KEY = 'suppliers:master:v1';
const TTL_MS = 24 * 60 * 60 * 1000;
const OFFER_PRODTYPES = new Set(['Packages', 'Accommodation', 'Flights']);

// Stable unique key for a supplier (id repeats across product types).
export function supplierKey(prodType, id) { return String(prodType) + ':' + String(id); }

export function normaliseSuppliers(raw) {
  const list = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.data) ? raw.data : []);
  return list
    .filter((s) => s && OFFER_PRODTYPES.has(String(s.prodType)))
    .map((s) => ({
      key: supplierKey(s.prodType, s.id),
      id: s.id,
      prodType: String(s.prodType),
      type: s.type || '',
      name: s.name || String(s.type || 'Supplier'),
      isPremium: !!s.isPremium,
    }))
    .sort((a, b) => (a.prodType.localeCompare(b.prodType) || a.name.localeCompare(b.name)));
}

async function fetchSuppliers() {
  const r = await fetch(SRC, { signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error('activesuppliers HTTP ' + r.status);
  return normaliseSuppliers(await r.json());
}

export default async function handler(req, res) {
  setAdminCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  const gate = requireAdmin(req);
  if (gate.error) return res.status(gate.status).json({ error: gate.error });
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const force = req.query && req.query.refresh === '1';
  try {
    const cached = await getJson(CACHE_KEY);
    const fresh = cached && cached.fetchedAt && (Date.now() - Date.parse(cached.fetchedAt) < TTL_MS);
    if (cached && fresh && !force) {
      return res.status(200).json({ suppliers: cached.suppliers, fetchedAt: cached.fetchedAt, cached: true });
    }
    const suppliers = await fetchSuppliers();
    const payload = { suppliers, fetchedAt: new Date().toISOString() };
    await setJson(CACHE_KEY, payload);
    return res.status(200).json({ suppliers, fetchedAt: payload.fetchedAt, cached: false });
  } catch (e) {
    // Serve stale on upstream failure rather than breaking the Control page.
    const cached = await getJson(CACHE_KEY);
    if (cached && cached.suppliers) {
      return res.status(200).json({ suppliers: cached.suppliers, fetchedAt: cached.fetchedAt, cached: true, stale: true });
    }
    console.error('[admin/suppliers]', e.message);
    return res.status(502).json({ error: 'Could not load suppliers', detail: e.message });
  }
}
