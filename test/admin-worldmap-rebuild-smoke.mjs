/**
 * Admin World Map — rebuild UX (auto-continue + coverage).
 *
 * The "Rebuild all" button used to do one budget-limited batch and ask the
 * operator to press again; if they waited, the scheduled sweep overwrote the
 * "continue" message and it looked like it reset. Now one click auto-continues
 * to 100% with a progress bar, and the Cache tab shows live coverage.
 *
 * Guards the admin page against a broken inline script and confirms the new
 * pieces are wired. Run: node test/admin-worldmap-rebuild-smoke.mjs
 */
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };

const HTML = readFileSync(new URL('../public/admin-worldmap.html', import.meta.url), 'utf8');

// The inline script must parse — a syntax error here blanks the whole dashboard.
{
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m, scripts = 0, errs = 0;
  while ((m = re.exec(HTML))) { scripts++; try { new Function(m[1]); } catch (e) { errs++; console.error('  parse:', e.message); } }
  ok(scripts >= 1, 'the page has an inline script');
  ok(errs === 0, 'every inline script parses cleanly');
}

// Auto-continue is wired: the button drives the chained rebuild, not a single call.
ok(/function rebuildAllChained\(/.test(HTML), 'the auto-continuing rebuild function exists');
ok(/rebuildAllChained\(e\.currentTarget\)/.test(HTML), 'the "Rebuild all" button uses it');
ok(/id="rebuild-progress"/.test(HTML) && /id="rebuild-progress-bar"/.test(HTML), 'the progress bar markup is present');
ok(/id="btn-rebuild-stop"/.test(HTML) && /rebuildAbort = true/.test(HTML), 'the Stop control aborts the loop');

// It reads the cron progress fields and stops when the whole list is covered.
ok(/cron\.processedCountries/.test(HTML) && /cron\.totalCountries/.test(HTML) && /cron\.partial/.test(HTML),
  'it drives the loop from the cron progress fields');
ok(/covered >= total/.test(HTML), 'it stops once the whole list is covered');
ok(/rounds < MAX_ROUNDS/.test(HTML), 'it has a safety cap against an endless loop');

// Coverage line: how much of the list is fresh right now.
ok(/refreshed in the last hour/.test(HTML), 'the Cache tab shows live coverage');
ok(/const freshHr = cs\.filter/.test(HTML), 'coverage counts destinations refreshed within the hour');

// The cron still returns the fields the client relies on.
const CRON = readFileSync(new URL('../api/cron/refresh-map-offers.js', import.meta.url), 'utf8');
ok(/partial: budgetExhausted/.test(CRON), 'the cron reports partial');
ok(/processedCountries: processed/.test(CRON) && /totalCountries: rows\.length/.test(CRON),
  'the cron reports processed and total counts');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
