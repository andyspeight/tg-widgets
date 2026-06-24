/**
 * GET /api/reference/coverage
 *
 * A read-only health report on the shared reference layer: how much exists,
 * how deep it goes (rich-field fill rates), and how fresh it is. Use it to see
 * the gaps before deciding what to fill or re-verify. Writes nothing.
 *
 * Auth: Luna Brain access or Travelgenix staff.
 */

import { requireAuth, getProductRole } from '../_lib/auth/middleware.js';
import { isStaffEmail } from '../_lib/auth/staff.js';
import { PRODUCTS } from '../_lib/auth/schema.js';
import { jsonError } from '../_lib/auth/http.js';
import { listAll, refConfigured, COUNTRIES_TBL, AIRPORTS_TBL, CF, AF } from './_ref.js';

function selName(v) { return v && typeof v === 'object' ? v.name : v; }
function tally(rows, pick) {
  const out = {};
  for (const r of rows) { const k = selName(pick(r)) || '(blank)'; out[k] = (out[k] || 0) + 1; }
  return out;
}
function fillRates(rows, fields) {
  const out = {};
  for (const [label, fid] of Object.entries(fields)) {
    const n = rows.filter(r => { const v = r.fields[fid]; return v != null && String(selName(v)).trim() !== ''; }).length;
    out[label] = { filled: n, pct: rows.length ? Math.round((n / rows.length) * 100) : 0 };
  }
  return out;
}
function daysSince(iso, nowMs) { const t = new Date(iso).getTime(); return isNaN(t) ? null : Math.floor((nowMs - t) / 86400000); }

export default async function handler(req, res) {
  if (req.method !== 'GET') return jsonError(res, 405, 'method_not_allowed', 'GET only');

  const ctx = await requireAuth(req, res);
  if (!ctx) return;
  const hasBrain = !!getProductRole(ctx, PRODUCTS.slugs.LUNA_BRAIN);
  if (!hasBrain && !isStaffEmail(ctx.email)) {
    return jsonError(res, 403, 'no_product_access', 'You do not have access to Luna Brain');
  }
  if (!refConfigured()) return jsonError(res, 500, 'not_configured', 'Reference data is not configured');

  const nowMs = Date.now();
  try {
    const [airports, countries] = await Promise.all([
      listAll(AIRPORTS_TBL, [AF.name, AF.iata, AF.status, AF.role || 'fldUSTC6kdgXNgKfI', AF.verifiedDate, AF.overview, AF.distance, AF.terminals, AF.parking, AF.lounges, AF.train]),
      listAll(COUNTRIES_TBL, [CF.name, CF.status, CF.visaStatus, CF.visaAdvisory, CF.health, CF.practical, CF.bestTime, CF.flightTime]),
    ]);

    // Airport freshness buckets by Verified Date age.
    const fresh = { within30: 0, within60: 0, within90: 0, over90: 0, noDate: 0 };
    for (const a of airports) {
      const d = a.fields[AF.verifiedDate] ? daysSince(a.fields[AF.verifiedDate], nowMs) : null;
      if (d == null) fresh.noDate++;
      else if (d <= 30) fresh.within30++;
      else if (d <= 60) fresh.within60++;
      else if (d <= 90) fresh.within90++;
      else fresh.over90++;
    }

    return res.status(200).json({
      ok: true,
      airports: {
        total: airports.length,
        byStatus: tally(airports, a => a.fields[AF.status]),
        byRole: tally(airports, a => a.fields['fldUSTC6kdgXNgKfI']),
        freshness: fresh,
        depth: fillRates(airports, { overview: AF.overview, distance: AF.distance, terminals: AF.terminals, parking: AF.parking, lounges: AF.lounges, trainInfo: AF.train }),
      },
      countries: {
        total: countries.length,
        byStatus: tally(countries, c => c.fields[CF.status]),
        visaStatusSet: countries.filter(c => c.fields[CF.visaStatus]).length,
        depth: fillRates(countries, { practicalInfo: CF.practical, visaAdvisory: CF.visaAdvisory, healthNotes: CF.health, bestTime: CF.bestTime, flightTime: CF.flightTime }),
      },
    });
  } catch (err) {
    console.error('[reference/coverage] error:', err && err.message);
    return jsonError(res, 502, 'coverage_failed', 'Could not build the coverage report');
  }
}
