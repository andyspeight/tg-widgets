/**
 * Enquiry config load resilience (27 Jul 2026).
 *
 * A "config unreachable / Load failed" alert fired for the Enquiry Pro form on a
 * live site. "Load failed" is Safari's message for a network reject — a dropped
 * connection or the visitor navigating away mid-load — not an outage (the config
 * endpoint answered fine for everyone else, enquiries were landing all day).
 *
 * The config load must therefore: (1) retry a transient network reject before
 * failing the form for a real visitor, and (2) NOT beacon a failure when the tab
 * is hidden/unloading (a benign navigate-away). Both enquiry widgets are guarded.
 *
 * Run: node test/enquiry-config-resilience-smoke.mjs
 */
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };

const pro = readFileSync(new URL('../public/widget-enquirypro.js', import.meta.url), 'utf8');
const std = readFileSync(new URL('../public/widget-enquiry.js', import.meta.url), 'utf8');

// ── Enquiry Pro ──────────────────────────────────────────────────────────────
ok(/CONFIG_MAX_ATTEMPTS\s*=\s*3/.test(pro), 'pro: config load has a retry budget');
ok(/loadConfig\(attempt \+ 1\)/.test(pro), 'pro: retries on a transient network reject');
ok(/document\.visibilityState === 'hidden'[\s\S]{0,240}if \(!hidden\)\s*tgReport\('error', widgetId, 'config unreachable'/.test(pro),
  "pro: the 'config unreachable' beacon is suppressed when the tab is hidden");

// ── Standard Enquiry ─────────────────────────────────────────────────────────
ok(/catch \(firstErr\)[\s\S]{0,160}fetch\(configUrl/.test(std), 'standard: config load retries once on a reject');
ok(/document\.visibilityState === 'hidden'[\s\S]{0,240}if \(!hidden\)\s*report\('config load threw'/.test(std),
  "standard: the 'config load threw' beacon is suppressed when the tab is hidden");

// A visible-page failure must STILL alert — we only suppress the hidden case, so
// a genuine outage or CSP block on a real load is never hidden from us.
ok(/if \(!hidden\)\s*tgReport\('error', widgetId, 'config unreachable'/.test(pro)
   && /if \(!hidden\)\s*report\('config load threw'/.test(std),
  'both: a visible-page config failure still beacons');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
