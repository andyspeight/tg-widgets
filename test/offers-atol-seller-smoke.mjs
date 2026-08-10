/**
 * Travel Offers — ATOL badge + seller name on every package & DP card
 * (Andy, 10 Aug 2026).
 *
 * The ATOL badge must show on ALL package and dynamic-package cards, not just
 * Package Holidays whose operator message happened to mention ATOL. A Package
 * Holiday shows its tour operator (Tui); a Dynamic Package shows the selling
 * AGENT — our client's own agency name (cfg.agencyName), injected server-side —
 * because a DP is assembled and sold by the agent under their ATOL and carries
 * no operator name in the offer data.
 *
 * Exercises the REAL _packageSeller logic (extracted from the widget source and
 * evaluated against a mock instance) plus source guards on the render changes
 * and the server-side agencyName injection.
 *
 * Run: node test/offers-atol-seller-smoke.mjs  (also: npm run test:offers-atol)
 */
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };

const widget = readFileSync(new URL('../public/widget-offers.js', import.meta.url), 'utf8');
const widgetConfig = readFileSync(new URL('../api/widget-config.js', import.meta.url), 'utf8');
const auth = readFileSync(new URL('../api/_auth.js', import.meta.url), 'utf8');

// ── Extract the real functions/methods from the widget source ────────────────
const methodBody = (src, signature) => {
  const i = src.indexOf(signature);
  if (i === -1) throw new Error('not found: ' + signature);
  const open = src.indexOf('{', i);
  let depth = 0, j = open;
  for (; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(open + 1, j);
};

// getPackageType is a module-level function _packageSeller depends on.
const getPackageType = new Function('o', methodBody(widget, 'function getPackageType(o)'));
// _packageSeller is a method reading this.cfg / this.t / getPackageType. Eval the
// body as a plain function taking (o, getPackageType); call it with a mock `this`.
const _packageSellerRaw = new Function('o', 'getPackageType', methodBody(widget, '_packageSeller(o) {'));
const _packageSeller = function (o) { return _packageSellerRaw.call(this, o, getPackageType); };

const T = { operator: 'Operator', agent: 'Agent' };
const mk = (cfg) => ({ cfg, t: (k) => T[k] || k });

const PH = { packageType: 'PackageHolidays', accommodation: { operator: { name: 'Tui' } } };
const DP = { packageType: 'DynamicPackages', accommodation: {} };
const UNTYPED_OP = { accommodation: { operator: { name: 'Jet2holidays' } } };
const UNTYPED_NONE = { accommodation: {} };

// ── _packageSeller behaviour ─────────────────────────────────────────────────
{
  const s = _packageSeller.call(mk({ agencyName: 'Cypher Travel' }), PH);
  ok(s.name === 'Tui' && s.role === 'operator' && s.atol === true, 'Package Holiday → tour operator name (Tui), ATOL true');
}
{
  const s = _packageSeller.call(mk({ agencyName: 'Cypher Travel' }), DP);
  ok(s.name === 'Cypher Travel' && s.role === 'agent' && s.atol === true, 'Dynamic Package → agent = client agency name (Cypher Travel), ATOL true');
}
{
  const s = _packageSeller.call(mk({ agencyName: '' }), DP);
  ok(s.name === '' && s.role === 'agent' && s.atol === true, 'DP with no agency name → still ATOL (badge shows), name empty');
}
{
  const s = _packageSeller.call(mk({ agencyName: 'Cypher Travel' }), UNTYPED_OP);
  ok(s.name === 'Jet2holidays' && s.role === 'operator', 'untyped package with an operator → operator name');
}
{
  const s = _packageSeller.call(mk({ agencyName: 'Cypher Travel' }), UNTYPED_NONE);
  ok(s.name === 'Cypher Travel' && s.role === 'agent', 'untyped package with no operator → falls back to agency');
}
{
  const s = _packageSeller.call(mk({ agencyName: 'Cypher Travel' }), PH);
  ok(s.label === 'Operator', 'label resolves via t(role) → Operator');
  const d = _packageSeller.call(mk({ agencyName: 'Cypher Travel' }), DP);
  ok(d.label === 'Agent', 'label resolves via t(role) → Agent');
}

// ── Source guards: widget render ─────────────────────────────────────────────
ok(/agencyName: typeof c\.agencyName === 'string'/.test(widget), 'agencyName is a config default');
ok(/agent: 'Agent'/.test(widget), 'agent label present in MESSAGES');
ok(!/function isAtolMessage/.test(widget), 'the old operator-message ATOL gate is gone (badge is now unconditional)');

// Grid operator/agent strip: seller-driven, ATOL always appended
{
  const strip = widget.slice(widget.indexOf('Operator / agent strip'));
  ok(/const seller = this\._packageSeller\(o\)/.test(strip.slice(0, 600)), 'grid strip uses _packageSeller');
  ok(/tgo-operator-atol' \+ \(showName \? '' : ' solo'\)/.test(strip.slice(0, 800)), 'grid strip always appends the ATOL badge (solo when no name)');
}
// List row: ATOL pushed unconditionally, img badge uses seller name
ok(/\/\/ Every flight-inclusive package[\s\S]{0,80}tags\.push\('ATOL'\)/.test(widget), 'list tags push ATOL for every package/DP (not just holidays)');
ok(/if \(seller\.name && this\.cfg\.show\.packageOperator\)/.test(widget), 'list image badge shows the seller name');
// Magazine: ATOL surfaced in both kickers
{
  const atolKickers = (widget.match(/bits\.push\('ATOL'\)/g) || []).length;
  ok(atolKickers >= 2, `magazine hero + banner kickers surface ATOL (found ${atolKickers})`);
}
// CSS
ok(/\.tgo-operator-atol\.solo \{ margin-left: 0; \}/.test(widget), 'solo ATOL badge left-aligns when no name');
// Version
{
  const vm = widget.match(/VERSION = '(\d+)\.(\d+)\.(\d+)'/);
  ok(vm && (+vm[1] > 1 || (+vm[1] === 1 && +vm[2] >= 18)), 'widget version at or beyond 1.18');
}

// ── Source guards: server-side agencyName injection ──────────────────────────
ok(/config\.agencyName = creds\.tradingName \|\| creds\.clientName \|\| ''/.test(widgetConfig), 'widget-config injects agencyName (tradingName, else clientName) for Travel Offers');
// It must sit inside the Travel Offers branch, alongside the apiKey injection —
// not leak to World Map (which shares the credential lookup but renders no cards).
{
  const idx = widgetConfig.indexOf('config.agencyName');
  const branchStart = widgetConfig.lastIndexOf("if (widgetType === 'Travel Offers')", idx);
  const between = branchStart >= 0 ? widgetConfig.slice(branchStart, idx) : '';
  ok(between.includes('config.apiKey = creds.apiKey'), 'agencyName injection is scoped to the Travel Offers branch (same block as apiKey)');
}
ok(/tradingName:\s*'fldDbFv039Bip6W8u'/.test(auth), '_auth.js maps the tradingName field id');
ok(/tradingName: String\(rec\.fields\?\.\[TG_CLIENT_FIELDS\.tradingName\]/.test(auth), 'packCredentials returns tradingName');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
