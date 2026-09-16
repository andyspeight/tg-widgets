/**
 * A grant in Control beats the plan map, for whoever is signed in (16 Sep 2026).
 *
 * Andy: "I've just gone to set up the TTI offers for MT Holidays, and it is
 * saying it's not part of their plan, but I have checked in control, and it is
 * marked as available to them."
 *
 * Control was right. MT Holidays (recO0O3LMBvScaPb0) holds an ENABLED Client
 * Entitlements row sourced Add-On against the TTI Offers catalogue item
 * (rec6S3tManU6YoTKj, product name "TTI Offers", active). That row is the whole
 * design: TTI Offers is sold on no package, so every tier in PLAN_WIDGET_LIMITS
 * reads 0 and a direct grant is the only way in.
 *
 * The fault was ours, and it was in the staff bypass. The entitlement gate ran
 * inside `if (!isStaff && clientId)`, so for a staff member the block was
 * skipped — and with it the working out of the direct grant. grantedDirectly
 * stayed false, the plan map said 0, and the save was refused. A client could
 * have saved the widget that the person setting it up for them could not. A
 * staff bypass has to be one-directional: it can only unblock, never take away
 * what Control has granted.
 *
 * The same hole was open on the Duplicate button, which read the plan map with
 * no idea that grants exist, so the granted client could create a TTI widget
 * and then not copy it.
 *
 * Run: node test/direct-grant-smoke.mjs   (npm run test:direct-grant)
 */
import { readFileSync } from 'node:fs';

process.env.AIRTABLE_PAT = 'pat_test';
process.env.AIRTABLE_KEY = 'pat_test';
process.env.AIRTABLE_BASE_ID = 'appTESTBASE000000';
process.env.TG_SESSION_SECRET = 'test-session-secret-0123456789abcdef0123456789';

const { hasDirectGrant, readControlAccess, PLAN_WIDGET_LIMITS } = await import('../api/widget-config.js');
const { CLIENT_ENTITLEMENTS } = await import('../api/_lib/auth/schema.js');

let passed = 0, failed = 0;
const ok = (label, cond, detail) => {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.error('  ✗ ' + label + (detail ? '\n      ' + detail : '')); }
};

const CLIENT = 'recO0O3LMBvScaPb0';        // MT Holidays
const ITEM = 'rec6S3tManU6YoTKj';          // the TTI Offers catalogue item
const F = CLIENT_ENTITLEMENTS.fields;

/** A Client Entitlements row in the shape Airtable really returns. */
const row = (over = {}) => ({
  id: 'recENT' + String(Math.random()).slice(2, 13),
  fields: {
    [F.enabled]: true,
    [F.source]: { id: 'seldg8FQQ6D5iVYNH', name: 'Add-On', color: 'grayLight2' },
    [F.client]: [CLIENT],
    [F.catalogueItem]: [ITEM],
    ...over,
  },
});
const grant = (rows, over = {}) => hasDirectGrant({
  clientEntitlements: rows, catalogueItemId: ITEM, clientId: CLIENT, ...over,
});

console.log('The real MT Holidays row is read as a grant');
{
  ok('an enabled Add-On row for this client and this item', grant([row()]));
  ok('a Manual Override counts too',
    grant([row({ [F.source]: { id: 'selzgF1QM7hSuhNLB', name: 'Manual Override' } })]));
  ok('the source can be a plain string, as some reads return it',
    grant([row({ [F.source]: 'Add-On' })]));
  ok('it is found among the client\'s fifty other rows',
    grant([row({ [F.catalogueItem]: ['recOTHER00000001'] }), row(), row({ [F.enabled]: false })]));
}

console.log('And nothing else is');
{
  ok('a Package Default row is NOT a direct grant (it is the plan speaking)',
    !grant([row({ [F.source]: { id: 'selc8ZDayJT3NC7Qh', name: 'Package Default' } })]));
  ok('a disabled row grants nothing', !grant([row({ [F.enabled]: false })]));
  ok('another client\'s grant is not this client\'s',
    !grant([row({ [F.client]: ['recSOMEONEELSE001'] })]));
  ok('a grant on another product is not this product',
    !grant([row({ [F.catalogueItem]: ['recOTHERITEM00001'] })]));
  ok('no rows, no grant', !grant([]));
  ok('no catalogue item match means no grant', !grant([row()], { catalogueItemId: null }));
  ok('no client means no grant', !grant([row()], { clientId: null }));
  ok('rubbish in does not throw', !grant(null) && !grant([null, {}, { fields: null }]));
}

console.log('TTI Offers is still sold on no plan, so the grant is the only way in');
{
  const tti = PLAN_WIDGET_LIMITS['TTI Offers'];
  ok('every tier reads 0', tti && [tti.Spark, tti.Boost, tti.Ignite, tti.Bespoke].every((v) => v === 0),
    JSON.stringify(tti));
}

console.log('The reader answers the real question, against a stubbed Control');
{
  // The REAL readControlAccess, the REAL Airtable client, with only the network
  // replaced. This is the lookup that decides whether Andy's save goes through.
  const { CATALOGUE, CLIENT_ENTITLEMENTS, PACKAGE_CATALOGUE, CLIENTS } = await import('../api/_lib/auth/schema.js');
  const CF = CATALOGUE.fields;
  const tables = {
    [CATALOGUE.tableId]: [
      { id: ITEM, fields: { [CF.productCode]: 'widget-tti-offers', [CF.productName]: 'TTI Offers', [CF.active]: true } },
      { id: 'recLOADER00000001', fields: { [CF.productCode]: 'widget-loader', [CF.productName]: 'Loader', [CF.active]: true } },
    ],
    [PACKAGE_CATALOGUE.tableId]: [],          // TTI Offers is in no package
    [CLIENT_ENTITLEMENTS.tableId]: [row(), row({ [F.catalogueItem]: ['recLOADER00000001'],
      [F.source]: { name: 'Package Default' } })],
  };
  const clientRecord = { id: CLIENT, fields: { [CLIENTS.fields.package]: ['recPKGBOOST000001'] } };

  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    const table = Object.keys(tables).find((t) => u.includes('/' + t));
    if (u.includes('/' + CLIENTS.tableId + '/')) {
      // Any other client id reads as a real record with no package, so the
      // "not granted" answer below is reached honestly rather than by an
      // exception being swallowed.
      const rec = u.includes(CLIENT) ? clientRecord : { id: 'recSOMEONEELSE001', fields: {} };
      return { ok: true, status: 200, json: async () => rec, text: async () => '' };
    }
    if (table) return { ok: true, status: 200, json: async () => ({ records: tables[table] }), text: async () => '' };
    return { ok: true, status: 200, json: async () => ({ records: [] }), text: async () => '' };
  };
  try {
    const access = await readControlAccess(CLIENT, 'TTI Offers');
    ok('MT Holidays comes back granted', access.grantedDirectly === true, JSON.stringify(access.grantedDirectly));
    ok('the catalogue item is matched by product name', !!access.catItem && access.catItem.id === ITEM);
    ok('and it is honestly reported as not in their package', access.includedInPlan === false);

    const other = await readControlAccess('recSOMEONEELSE001', 'TTI Offers');
    ok('another client is not granted', other.grantedDirectly === false);

    const unknown = await readControlAccess(CLIENT, 'Widget That Does Not Exist');
    ok('an unknown widget type matches nothing and blocks nothing',
      unknown.grantedDirectly === false && unknown.catItem === null && unknown.includedInPlan === null);

    globalThis.fetch = async () => { throw new Error('Airtable is down'); };
    const broken = await readControlAccess(CLIENT, 'TTI Offers');
    ok('an Airtable outage answers "do not know" rather than throwing',
      broken.grantedDirectly === false && broken.catItem === null);
  } finally {
    globalThis.fetch = realFetch;
  }
}

console.log('The create path asks Control even when staff are signed in');
{
  const SRC = readFileSync(new URL('../api/widget-config.js', import.meta.url), 'utf8');
  const gate = SRC.slice(SRC.indexOf('let grantedDirectly = false;'), SRC.indexOf('const planLimits = PLAN_WIDGET_LIMITS[safeType];'));
  ok('the lookup is no longer behind the staff check',
    /if \(clientId\) \{/.test(gate) && !/if \(!isStaff && clientId\)/.test(gate));
  ok('the grant is worked out for everyone', /grantedDirectly = access\.grantedDirectly;/.test(gate));
  ok('the BLOCK is still the part staff skip', /if \(!isStaff && !grantedDirectly && access\.catItem/.test(gate));
  ok('a lookup failure still fails open', /entitlement gate skipped \(fail-open\)/.test(gate));
  ok('it asks Control about the client the widget will belong to',
    /const clientId = ownerClientIdFromSession/.test(gate));
  ok('and a grant still beats a zero plan limit',
    /if \(planLimit === 0 && !grantedDirectly\) \{/.test(SRC));
  ok('a granted widget is not counted against an allowance',
    /A direct grant is unlimited by definition/.test(SRC));
  ok('one rule, exported for the other door', /export function hasDirectGrant\(/.test(SRC)
    && /export async function readControlAccess\(/.test(SRC));
  ok('the reader never throws at the caller', /Control access lookup failed \(fail-open\)/.test(SRC));
}

console.log('The duplicate path asks the same question');
{
  const COPY = readFileSync(new URL('../api/widget-copy.js', import.meta.url), 'utf8');
  ok('it reads the shared rule rather than its own idea of access',
    /import \{ PLAN_WIDGET_LIMITS, canonicalisePlan, readControlAccess \} from '\.\/widget-config\.js';/.test(COPY));
  ok('a grant beats a zero plan limit here too', /if \(planLimit === 0 && !grantedDirectly\)/.test(COPY));
  ok('it only pays for the lookup when the map would refuse',
    /if \(planLimit === 0\) \{[\s\S]{0,400}?readControlAccess\(/.test(COPY));
  ok('it asks about the widget\'s OWNING client, not whoever clicked',
    /sourceFields\.ClientRecordId/.test(COPY.slice(COPY.indexOf('let grantedDirectly = false;'))));
  ok('and a granted widget is not counted against an allowance',
    /if \(!grantedDirectly && planLimit !== null/.test(COPY));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
