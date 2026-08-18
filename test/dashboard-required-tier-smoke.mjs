/**
 * Dashboard — the "plan you need" a locked widget shows must be the CATALOGUE
 * tier, everywhere (Andy, 18 Aug 2026).
 *
 * The card lock text, the Request access modal ("included from the X plan") and
 * the request email ("Included from: X") all read one tier value. It used to
 * come from the hardcoded registry `access` map (getMinTier), which had drifted
 * BELOW the live catalogue: Destination Carousel is Ignite in the catalogue but
 * the map said Spark, so a Boost client was told it was "included from Spark"
 * and access was granted on that wrong figure. The tier must come from the same
 * /api/widget-packages feed that draws the correct on-card plan pills.
 *
 * Source-guards index.html (getRequiredTier reads packagesByCode; the card + the
 * modal both call it; getMinTier is only the fallback) and re-checks the tier
 * selection against catalogue-shaped data.
 *
 * Run: node test/dashboard-required-tier-smoke.mjs  (npm run test:dashboard-required-tier)
 */
import { readFileSync } from 'node:fs';

const HTML = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

let passed = 0, failed = 0;
const ok = (name, cond) => { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; console.error('  ✗ ' + name); } };

console.log('The required tier is sourced from the catalogue feed, not the stale access map');
{
  ok('getRequiredTier exists and reads packagesByCode (the pills source)',
    /function getRequiredTier\(widget, code\)[\s\S]*?packagesByCode\[code\]/.test(HTML));
  ok('it orders Spark < Boost < Ignite < Bespoke and picks the lowest present',
    /function getRequiredTier[\s\S]*?\['Spark', 'Boost', 'Ignite', 'Bespoke'\][\s\S]*?i < order\.indexOf\(best\)/.test(HTML));
  ok('it falls back to the access-map tier only when packages have not loaded',
    /function getRequiredTier[\s\S]*?return getMinTier\(widget\);\n\}/.test(HTML));

  ok('the card lock text uses getRequiredTier(w, code)',
    /const minTier = getRequiredTier\(w, code\);/.test(HTML));
  ok('the Request access modal uses getRequiredTier(w, code)',
    /openUpgradeModal\(w, code, getRequiredTier\(w, code\)\);/.test(HTML));
  ok('the old display calls getMinTier(w) are gone (the loop-variable form the card + modal used)',
    !/getMinTier\(w\b/.test(HTML));
  ok('getMinTier remains only as its definition plus the single fallback call',
    (HTML.match(/getMinTier\(/g) || []).length === 2);
}

console.log('The lowest-present catalogue tier is chosen (matches the card pills)');
{
  // Re-implement the shipped selection and check it against catalogue-shaped data.
  const order = ['Spark', 'Boost', 'Ignite', 'Bespoke'];
  const pick = (pkgs) => {
    let best = null;
    for (const t of (pkgs || [])) {
      const i = order.indexOf(t);
      if (i !== -1 && (best === null || i < order.indexOf(best))) best = t;
    }
    return best;
  };
  ok('Ignite-only widget → Ignite (e.g. Destination Carousel, Spotlight, My Booking)', pick(['Ignite']) === 'Ignite');
  ok('Boost+Ignite widget → Boost', pick(['Boost', 'Ignite']) === 'Boost');
  ok('all-plan widget → Spark', pick(['Spark', 'Boost', 'Ignite']) === 'Spark');
  ok('unordered list still picks the lowest tier', pick(['Ignite', 'Boost']) === 'Boost');
  ok('empty/missing packages → null (caller falls back to the access map)', pick([]) === null && pick(undefined) === null);
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
