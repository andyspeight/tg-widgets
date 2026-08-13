/**
 * /api/admin/map-rebuild
 *
 * Trigger the World Map offers cron from the admin dashboard, so the operator
 * never has to hold CRON_SECRET in the browser or use an external tool like
 * ReqBin. This route holds the secret server-side and calls the cron on the
 * caller's behalf.
 *
 * POST (admin-gated):
 *   body { scope: 'all' }            → full rebuild (?full=1, sweeps every country)
 *   body { scope: 'summary' }        → rebuild the summary only (normal run)
 *   body { country: 'GR' }           → (best-effort) rebuild scoped to one country
 *
 * Note on per-country: the cron's own granularity governs what 'country' does;
 * we pass it through as ?country=XX. If the cron ignores unknown params it will
 * simply do a normal run — harmless. We surface the cron's own response.
 *
 * Security: requireAdmin; CRON_SECRET server-side only; no-store; same-origin
 * CORS. The cron call uses the absolute deployment URL from VERCEL_URL (or an
 * explicit SITE_URL) so it works in preview + production.
 */
import { requireAdmin, setAdminCors } from './_guard.js';

function cronBaseUrl(req) {
  // Prefer an explicit configured site URL; else derive from the request host;
  // else fall back to the production domain.
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, '');
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (host) return `https://${host}`;
  return 'https://tg-widgets.vercel.app';
}

export default async function handler(req, res) {
  setAdminCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const gate = requireAdmin(req);
  if (gate.error) return res.status(gate.status).json({ error: gate.error });

  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(500).json({ error: 'CRON_SECRET not configured on the server.' });

  const b = req.body || {};
  const country = b.country ? String(b.country).toUpperCase().trim() : null;
  const scope = String(b.scope || '').toLowerCase();
  const diag = b.diag && typeof b.diag === 'object' ? b.diag : null;

  // Build the cron query string.
  let qs = '';
  if (diag) {
    // Read-only hotel destination probe (writes nothing). Forwarded to the
    // cron's ?hotelprobe branch so the operator can test what Travelify's hotel
    // search returns for different destination forms, without holding CRON_SECRET.
    const params = new URLSearchParams({ hotelprobe: '1' });
    if (diag.cc) params.set('cc', String(diag.cc).toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2));
    if (diag.dests) params.set('dests', String(diag.dests).slice(0, 400));
    if (diag.max) params.set('max', String(parseInt(diag.max, 10) || 100));
    qs = '?' + params.toString();
  }
  else if (country && /^[A-Z]{2}$/.test(country)) qs = `?country=${country}`;
  else if (scope === 'all') qs = '?full=1';
  // scope 'summary' (or anything else) → no params → normal run.

  const url = `${cronBaseUrl(req)}/api/cron/refresh-map-offers${qs}`;

  // The full sweep can run long; give it room but don't hang forever.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), scope === 'all' ? 290000 : 60000);

  try {
    const cronResp = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${secret}` },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const text = await cronResp.text().catch(() => '');
    let payload; try { payload = JSON.parse(text); } catch { payload = { raw: text.slice(0, 500) }; }
    if (!cronResp.ok) {
      return res.status(502).json({ error: `Cron returned ${cronResp.status}`, detail: payload });
    }
    return res.status(200).json({ ok: true, scope: diag ? 'diag:hotelprobe' : (country ? `country:${country}` : (scope || 'summary')), result: payload });
  } catch (e) {
    clearTimeout(timeout);
    if (e.name === 'AbortError') {
      // A full sweep may still be running server-side even though we stopped
      // waiting — tell the operator honestly rather than implying failure.
      return res.status(202).json({ ok: true, pending: true, message: 'Rebuild is still running. Check counts again in a minute.' });
    }
    console.error('[admin/map-rebuild]', e.message);
    return res.status(500).json({ error: 'Failed to trigger rebuild.' });
  }
}
