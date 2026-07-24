/**
 * Enquiry API endpoints load without a broken import (23 Jul 2026 audit #6).
 *
 * api/enquiry/airtable-pat.js imported pat-crypt from './_lib/pat-crypt.js',
 * which does not exist (the file is at './_lib/routing/pat-crypt.js'), so the
 * whole endpoint crashed on load with ERR_MODULE_NOT_FOUND — every attempt to
 * save, verify or remove a client's Airtable connection token 500'd, meaning no
 * client could ever connect their own Airtable CRM as an enquiry destination.
 * Importing the module here fails loudly if any import path breaks again.
 *
 * Run: node test/enquiry-modules-load-smoke.mjs
 */
let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };

// Harmless placeholders so module-scope env reads don't matter.
process.env.AIRTABLE_BASE_ID ||= 'appTEST000000000';
process.env.AIRTABLE_KEY ||= 'patTEST';
process.env.ENQUIRY_PAT_SECRET ||= '0123456789abcdef0123456789abcdef';

const MODULES = [
  '../api/enquiry/airtable-pat.js',
  '../api/enquiry/submit.js',
  '../api/enquiry/sheets-provision.js',
];

for (const m of MODULES) {
  try {
    const mod = await import(m);
    ok(typeof mod.default === 'function', `${m} loads and exports a handler (imports resolve)`);
  } catch (e) {
    failed++;
    console.error('  FAIL:', m, 'did not load —', e.message);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
