/**
 * GET /api/widget-packages
 *
 * Public. Returns, for each catalogue product code, the standard packages
 * (Spark / Boost / Ignite) that include it by default. Drives the "included
 * on" pills on the widget dashboard so a client can see at a glance which plan
 * a widget belongs to.
 *
 *   → { ok: true, packages: { "widget-reviews": ["Boost","Ignite"], ... } }
 *
 * Bespoke is deliberately excluded — almost everything is available bespoke, so
 * a Bespoke pill on every card would be noise. The three standard tiers are the
 * useful signal.
 *
 * Non-sensitive packaging info (effectively the price list), so no auth. Cached
 * at the edge for five minutes.
 *
 * Backing tables (Control base appAYzWZxvK6qlwXK): Package Catalogue, Packages,
 * Catalogue.
 */

import { listAllRecords } from './_lib/auth/airtable.js';
import { PACKAGES, CATALOGUE, PACKAGE_CATALOGUE } from './_lib/auth/schema.js';

const STANDARD_TIERS = ['Spark', 'Boost', 'Ignite'];
const TIER_ORDER = { Spark: 0, Boost: 1, Ignite: 2 };

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'GET only' });
  }

  try {
    const [packages, catalogue, links] = await Promise.all([
      listAllRecords(PACKAGES.tableId),
      listAllRecords(CATALOGUE.tableId),
      listAllRecords(PACKAGE_CATALOGUE.tableId),
    ]);

    // recordId → package name (Spark/Boost/Ignite/Bespoke)
    const pkgNameById = new Map();
    for (const p of packages) {
      const n = p.fields[PACKAGES.fields.packageName];
      if (n) pkgNameById.set(p.id, n);
    }
    // recordId → catalogue product code
    const codeById = new Map();
    for (const c of catalogue) {
      const code = c.fields[CATALOGUE.fields.productCode];
      if (code) codeById.set(c.id, code);
    }

    const out = {}; // code → Set of tier names
    for (const row of links) {
      if (!row.fields[PACKAGE_CATALOGUE.fields.includedByDefault]) continue;
      const pkgLinks = row.fields[PACKAGE_CATALOGUE.fields.package] || [];
      const catLinks = row.fields[PACKAGE_CATALOGUE.fields.catalogueItem] || [];
      const tier = pkgNameById.get(pkgLinks[0]);
      const code = codeById.get(catLinks[0]);
      if (!tier || !code) continue;
      if (!STANDARD_TIERS.includes(tier)) continue; // skip Bespoke
      (out[code] || (out[code] = new Set())).add(tier);
    }

    const packagesByCode = {};
    for (const code of Object.keys(out)) {
      packagesByCode[code] = [...out[code]].sort((a, b) => TIER_ORDER[a] - TIER_ORDER[b]);
    }

    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({ ok: true, packages: packagesByCode });
  } catch (err) {
    console.error('[widget-packages] failed:', err?.message);
    // Fail soft — the dashboard treats an empty map as "no pills".
    return res.status(200).json({ ok: false, packages: {} });
  }
}
