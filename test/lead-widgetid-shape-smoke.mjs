/**
 * Canonical lead — source.widgetId must be the Airtable RECORD id, not the
 * public tgw_ widget id.
 *
 * buildCanonicalLead enforces isRecId(source.widgetId) and throws
 * ValidationError otherwise. dispatchLead turns that into a 400, so a lead built
 * with the public id NEVER reaches Submissions and is NOT sent to any
 * destination — it is silently lost from the client's point of view.
 *
 * api/popup-lead.js resolved the widget record and then passed the public tgw_
 * id anyway, so every popup lead was dropped (found 30 Jul 2026).
 * api/newsletter-submit.js was already correct. These guards keep both honest.
 *
 * Run: node test/lead-widgetid-shape-smoke.mjs
 */
import { readFileSync } from 'node:fs';
import { buildCanonicalLead, KNOWN_WIDGETS } from '../api/_lib/routing/schema.js';

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };

const base = {
  contact: { email: 'visitor@example.com' },
  consent: { contact: true },
};
const lead = (widget, widgetId) => ({
  ...base,
  source: { widget, widgetId, clientName: 'Test Client', clientEmail: 'client@example.com' },
});
const build = (w, id) => {
  try { return { ok: true, lead: buildCanonicalLead(lead(w, id)) }; }
  catch (e) { return { ok: false, msg: e.message }; }
};

// ── The contract itself ───────────────────────────────────────────────────────
let r = build('popup', 'recSPh7ZE3Fc4grVs');
ok(r.ok, 'a RECORD id is accepted as source.widgetId');

r = build('popup', 'tgw_1784820891723_gfaa3j');
ok(!r.ok && /widgetId/i.test(r.msg), 'a PUBLIC tgw_ id is REJECTED (this is what silently lost popup leads)');

r = build('popup', '');
ok(!r.ok, 'a missing widgetId is rejected');

// ── Source guards: both lead endpoints must pass the RESOLVED record id ──────
const popup = readFileSync(new URL('../api/popup-lead.js', import.meta.url), 'utf8');
const newsletter = readFileSync(new URL('../api/newsletter-submit.js', import.meta.url), 'utf8');

for (const [name, src] of [['popup-lead', popup], ['newsletter-submit', newsletter]]) {
  // The canonical lead must be built with a *RecordId variable, never the bare
  // `widgetId` (which holds the public tgw_ value in both files).
  ok(/widgetId:\s*widget(Record)?Id/.test(src) && !/\n\s*widgetId,\s*\n/.test(src.split('source: {')[1] || ''),
    `${name}: source.widgetId is the resolved record id, not the bare public id`);
  // And it must refuse to continue when the widget cannot be resolved, rather
  // than proceeding to build a lead that can never validate.
  ok(/if \(!widget \|\| !widget\.recordId\)/.test(src),
    `${name}: bails out when the widget record cannot be resolved (no silent drop)`);
}

// ── The widget name must be whitelisted or the lead throws ───────────────────
r = build('definitely-not-a-widget', 'recSPh7ZE3Fc4grVs');
ok(!r.ok && /source\.widget/i.test(r.msg), 'an unknown source.widget is rejected (KNOWN_WIDGETS whitelist)');
ok(KNOWN_WIDGETS.includes('popup') && KNOWN_WIDGETS.includes('newsletter'),
  'popup and newsletter are on the KNOWN_WIDGETS whitelist');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
