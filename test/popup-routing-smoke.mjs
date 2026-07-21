/**
 * Popup routing panel — the Newsletter editor's destination management,
 * ported to the Popup editor so popup leads can route to Google Sheets (with
 * one-click provisioning), ESPs, webhooks and email like any other form type.
 *
 * Backend was already wired (popup-lead.js dispatches through the router,
 * routing-configs accepts widgetType 'popup'); what was missing was the UI
 * and a sane spreadsheet layout. Source guards here lock in the port and the
 * compact row shape; the provisioning endpoint itself is covered by
 * test/sheets-provision-generic-smoke.mjs.
 *
 * Run: node test/popup-routing-smoke.mjs
 */
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };

const popup = readFileSync(new URL('../public/editor-popup.html', import.meta.url), 'utf8');

// ── Routing tab present and complete ─────────────────────────────────────────
ok(/data-tab="routing"/.test(popup), 'Routing tab button exists');
ok(/data-panel="routing"/.test(popup), 'Routing tab panel exists');
ok(/id="routing-list"/.test(popup) && /id="btn-add-destination"/.test(popup), 'destination list + add button');
ok(/id="dest-picker-overlay"/.test(popup) && /id="dest-grid"/.test(popup), 'destination picker modal ported');
ok(/id="dest-config-overlay"/.test(popup) && /id="dest-test-btn"/.test(popup) && /id="dest-save-btn"/.test(popup), 'destination config modal ported');
ok(/const DESTINATIONS = \{/.test(popup) && /'google-sheets':/.test(popup), 'destination catalogue ported (Sheets included)');

// ── Wiring: popup identity, record id capture, CRUD + provisioning ───────────
ok(/widgetType: 'popup',/.test(popup), 'routing configs created with widgetType popup');
ok((popup.match(/routingState\.recordId = d\.recordId;/g) || []).length >= 2, 'record id captured on load AND after save');
ok(/\/api\/routing-configs/.test(popup), 'routing-configs CRUD wired');
ok(/dc-provision-btn/.test(popup) && /\/api\/sheets-provision/.test(popup) && /widgetRecordId: routingState\.recordId/.test(popup),
  'one-click Sheets provisioning wired to the widget record');
ok(/wireRouting/.test(popup) && /openDestPicker/.test(popup), 'panel bindings installed');

// ── Styling: the ported panel has its CSS (was invisible without it) ─────────
for (const cls of ['routing-list', 'routing-card', 'add-destination-btn', 'dest-grid', 'dest-card', 'tg-modal-overlay', 'btn-prim', 'btn-secondary', 'field-group', 'text-input', 'toggle-row', 'test-result']) {
  ok(popup.includes('.' + cls), `CSS present: .${cls}`);
}

// ── Compact spreadsheet layout for lead-capture widgets ──────────────────────
const sheets = readFileSync(new URL('../api/_lib/destinations/google-sheets.js', import.meta.url), 'utf8');
ok(/COMPACT_WIDGETS = new Set\(\['newsletter', 'popup'\]\)/.test(sheets), 'popup leads get the compact 9-column layout');
ok(/COMPACT_WIDGETS\.has\(lead\?\.source\?\.widget\)/.test(sheets), 'routing log reports the shape from the same rule');

// ── Backend accepts the popup type ───────────────────────────────────────────
const rc = readFileSync(new URL('../api/routing-configs.js', import.meta.url), 'utf8');
ok(/'popup':\s+'Popup'/.test(rc), 'routing-configs knows the popup widget type');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
