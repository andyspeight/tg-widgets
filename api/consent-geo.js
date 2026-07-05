/**
 * GET /api/consent-geo
 * Public, cross-origin helper for the cookie consent widget.
 *
 * Tells the widget which consent model applies to this visitor:
 *   - mode "gdpr":   EEA / UK / CH — prior opt-in required, banner blocks
 *                    non-essential cookies until the visitor chooses.
 *   - mode "optout": everywhere else — implied consent with a light notice
 *                    and an easy opt-out.
 *
 * The country comes from Vercel's x-vercel-ip-country edge header. No IP is
 * read, stored or returned. If the header is missing (local dev, unusual
 * proxies) we answer "gdpr" so the widget fails safe to the stricter flow.
 */

// EU 27 + EEA (IS, LI, NO) + UK + CH — the prior-consent jurisdictions.
const GDPR_COUNTRIES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR',
  'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK',
  'SI', 'ES', 'SE', 'IS', 'LI', 'NO', 'GB', 'CH',
]);

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  // Per-visitor answer — must never be cached by a shared cache.
  res.setHeader('Cache-Control', 'private, no-store');
}

export default function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const raw = String(req.headers['x-vercel-ip-country'] || '').toUpperCase();
  const country = /^[A-Z]{2}$/.test(raw) ? raw : '';
  const mode = !country || GDPR_COUNTRIES.has(country) ? 'gdpr' : 'optout';

  return res.status(200).json({ country, mode });
}
