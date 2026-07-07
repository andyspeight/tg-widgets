/**
 * Smoke test for the entitlement resolver behind GET /api/auth/me.
 *
 * Focus: contracting clients must reach the Contract Loader. The loader reads
 * entitledWidgetCodes, keeps the contract-loader-* codes, and treats the rest of
 * each code (flights, transfers, ...) as an enabled engine. No engines means no
 * access. Before the fix, entitledWidgetCodes for a non-staff client came ONLY
 * from the package plan, which never carries contracting codes, so every
 * contracting client was refused. This test locks the fix: enabled contracting
 * entitlements are folded into entitledWidgetCodes verbatim.
 *
 * Pure Node, no network. Run: node test/auth-me-entitlements-smoke.mjs
 */

import { resolveEntitlements } from '../api/_lib/auth/entitlements.js';
import {
  PRODUCTS, CATALOGUE, CLIENT_ENTITLEMENTS, PACKAGE_CATALOGUE,
} from '../api/_lib/auth/schema.js';

let passed = 0;
let failed = 0;

function ok(name, cond, detail) {
  if (cond) { passed++; console.log(`  ok   ${name}`); }
  else { failed++; console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
}

function eqSet(name, actual, expected) {
  const a = [...new Set(actual)].sort();
  const e = [...new Set(expected)].sort();
  ok(name, a.length === e.length && a.every((v, i) => v === e[i]),
    `got [${a.join(', ')}] expected [${e.join(', ')}]`);
}

// --- Fixture builders (records shaped exactly as Airtable returns them with
//     returnFieldsByFieldId=true: { id, fields } keyed by field ID). ----------

function product(slug, name, status = 'active') {
  return { id: `prod_${slug}`, fields: {
    [PRODUCTS.fields.productId]: slug,
    [PRODUCTS.fields.displayName]: name,
    [PRODUCTS.fields.status]: status,
  } };
}

function catItem(id, code, category, slug, active = true) {
  return { id, fields: {
    [CATALOGUE.fields.productCode]: code,
    [CATALOGUE.fields.category]: category,
    [CATALOGUE.fields.productSlug]: slug,
    [CATALOGUE.fields.active]: active,
  } };
}

function pkgCat(id, packageId, catalogueId, includedByDefault = true) {
  return { id, fields: {
    [PACKAGE_CATALOGUE.fields.package]: [packageId],
    [PACKAGE_CATALOGUE.fields.catalogueItem]: [catalogueId],
    [PACKAGE_CATALOGUE.fields.includedByDefault]: includedByDefault,
  } };
}

function entitlement(id, clientId, catalogueId, enabled = true) {
  return { id, fields: {
    [CLIENT_ENTITLEMENTS.fields.client]: [clientId],
    [CLIENT_ENTITLEMENTS.fields.catalogueItem]: [catalogueId],
    [CLIENT_ENTITLEMENTS.fields.enabled]: enabled,
  } };
}

// Mimic exactly what the Contract Loader does with entitledWidgetCodes: keep the
// contract-loader-* codes and read the remainder as the enabled engine. Empty
// engine list => the loader shows the "no access" screen.
function loaderEngines(entitledWidgetCodes) {
  return entitledWidgetCodes
    .filter((c) => c.startsWith('contract-loader-'))
    .map((c) => c.slice('contract-loader-'.length));
}

// --- Shared catalogue / products / package plan --------------------------------

const PKG_BOOST = 'pkg_boost';
const CLIENT = 'rec_skisolutions';

const products = [
  product('widget_suite', 'Widget Suite'),
  product('contract_loader', 'Contract Loader'),
  product('luna_chat', 'Luna Chat'),
];

// Widget-suite catalogue items (plan-driven) and contracting items (per client).
const CAT = {
  widgetLoader: catItem('cat_wloader', 'widget-loader', 'Widget', 'widget_suite'),
  widgetFaq:    catItem('cat_wfaq', 'widget-faq', 'Widget', 'widget_suite'),
  flights:      catItem('cat_flights', 'contract-loader-flights', 'Contracting', 'contract_loader'),
  transfers:    catItem('cat_transfers', 'contract-loader-transfers', 'Contracting', 'contract_loader'),
  cars:         catItem('cat_cars', 'contract-loader-cars', 'Contracting', 'contract_loader'),
  // A contracting item switched off in the Catalogue. Even a stale enabled
  // entitlement for it must not surface.
  trainsOff:    catItem('cat_trains', 'contract-loader-trains', 'Contracting', 'contract_loader', false),
};
const catalogue = Object.values(CAT);

// Boost plan includes the two widgets by default. Crucially it carries NO
// contracting rows — contracting is granted per client, not by package.
const packageCatalogue = [
  pkgCat('pc_1', PKG_BOOST, CAT.widgetLoader.id),
  pkgCat('pc_2', PKG_BOOST, CAT.widgetFaq.id),
];

// ==============================================================================
console.log('Scenario 1: Ski Solutions — Flights + Transfers on, Cars off');
// Enabled: a widget entitlement (so widget_suite shows) + flights + transfers.
// Cars is disabled; trains is enabled but its catalogue item is inactive.
{
  const entitlements = [
    entitlement('e_wloader', CLIENT, CAT.widgetLoader.id, true),
    entitlement('e_flights', CLIENT, CAT.flights.id, true),
    entitlement('e_transfers', CLIENT, CAT.transfers.id, true),
    entitlement('e_cars', CLIENT, CAT.cars.id, false),
    entitlement('e_trains', CLIENT, CAT.trainsOff.id, true),
  ];
  const r = resolveEntitlements({
    catalogue, products, entitlements, packageCatalogue,
    clientRecordId: CLIENT, clientPackageId: PKG_BOOST,
    isStaff: false, isImpersonating: false,
    permissions: [], role: 'owner',
  });

  eqSet('entitledWidgetCodes = plan widgets + enabled contracting', r.entitledWidgetCodes,
    ['widget-loader', 'widget-faq', 'contract-loader-flights', 'contract-loader-transfers']);
  eqSet('loader engines = flights + transfers', loaderEngines(r.entitledWidgetCodes),
    ['flights', 'transfers']);
  ok('loader grants access (engines non-empty)', loaderEngines(r.entitledWidgetCodes).length > 0);
  ok('disabled Cars entitlement excluded', !r.entitledWidgetCodes.includes('contract-loader-cars'));
  ok('inactive Trains catalogue item excluded', !r.entitledWidgetCodes.includes('contract-loader-trains'));
  eqSet('accessibleProducts slugs', r.accessibleProducts.map((p) => p.slug),
    ['widget_suite', 'contract_loader']);
}

// ==============================================================================
console.log('Scenario 2: contracting switched off — still no access');
{
  const entitlements = [
    entitlement('e_wloader', CLIENT, CAT.widgetLoader.id, true),
  ];
  const r = resolveEntitlements({
    catalogue, products, entitlements, packageCatalogue,
    clientRecordId: CLIENT, clientPackageId: PKG_BOOST,
    isStaff: false, isImpersonating: false,
    permissions: [], role: 'owner',
  });
  ok('no contract-loader-* codes present',
    !r.entitledWidgetCodes.some((c) => c.startsWith('contract-loader-')));
  ok('loader refuses (engines empty)', loaderEngines(r.entitledWidgetCodes).length === 0);
}

// ==============================================================================
console.log('Scenario 3: Travelgenix staff see every active engine');
{
  const r = resolveEntitlements({
    catalogue, products, entitlements: [], packageCatalogue,
    clientRecordId: CLIENT, clientPackageId: PKG_BOOST,
    isStaff: true, isImpersonating: false,
    permissions: [], role: 'admin',
  });
  eqSet('staff loader engines = every ACTIVE contracting engine',
    loaderEngines(r.entitledWidgetCodes), ['flights', 'transfers', 'cars']);
  ok('inactive Trains still excluded for staff',
    !r.entitledWidgetCodes.includes('contract-loader-trains'));
}

// ==============================================================================
console.log('Scenario 4: client with no package plan (fallback to entitlements)');
{
  const entitlements = [
    entitlement('e_flights', CLIENT, CAT.flights.id, true),
    entitlement('e_transfers', CLIENT, CAT.transfers.id, true),
  ];
  const r = resolveEntitlements({
    catalogue, products, entitlements, packageCatalogue,
    clientRecordId: CLIENT, clientPackageId: null,
    isStaff: false, isImpersonating: false,
    permissions: [], role: 'owner',
  });
  eqSet('loader engines still resolve from entitlements',
    loaderEngines(r.entitledWidgetCodes), ['flights', 'transfers']);
}

// ==============================================================================
console.log('Scenario 5: entitlements belonging to a different client are ignored');
{
  const entitlements = [
    entitlement('e_other', 'rec_someoneelse', CAT.flights.id, true),
  ];
  const r = resolveEntitlements({
    catalogue, products, entitlements, packageCatalogue,
    clientRecordId: CLIENT, clientPackageId: PKG_BOOST,
    isStaff: false, isImpersonating: false,
    permissions: [], role: 'owner',
  });
  ok('another client\'s contracting entitlement does not leak in',
    !r.entitledWidgetCodes.includes('contract-loader-flights'));
  ok('loader refuses (engines empty)', loaderEngines(r.entitledWidgetCodes).length === 0);
}

// ------------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
