/**
 * Copy a widget while acting as a client (Jess, 12 Aug 2026).
 *
 * THE REPORT. Jess (Travelgenix staff, jessica.speight@agendas.group) switched
 * into the Better Lifestyle account and tried to Copy any widget. She got a red
 * "Widget not found" and nothing copied.
 *
 * WHY. /api/widget-copy looked up the source widget with
 * AND({WidgetID}=…, {ClientEmail}='<caller email>'). Acting as a client only
 * rebases the session's clientId — the caller's email stays their own staff
 * address, while the client's widgets carry the CLIENT's ClientEmail. The two
 * never matched, so the lookup returned nothing and the endpoint 404'd. It also
 * stamped the new copy with the staff address as ClientEmail.
 *
 * THE FIX. Scope ownership by the ACTIVE CLIENT (ClientRecordId === session
 * clientId), mirroring widget-list's buildScopeFormula, and inherit the copy's
 * owner identity from the SOURCE. Anything the caller can see in their list,
 * they can now copy.
 *
 * The endpoint imports jsonwebtoken (via _auth.js), which isn't installed in
 * the local dev sandbox, so we extract the REAL buildOwnerClause and evaluate
 * it with faithful stubs of its two helpers — the same approach the worldmap
 * suites use. That runs both locally and in CI. Source-guards pin the wiring.
 *
 * Run: node test/widget-copy-actas-scope-smoke.mjs  (npm run test:widget-copy-actas)
 */
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../api/widget-copy.js', import.meta.url), 'utf8');

let passed = 0, failed = 0;
const ok = (name, cond) => { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; console.error('  ✗ ' + name); } };

// ── The real buildOwnerClause, extracted and evaluated with faithful deps ──
const m = SRC.match(/export function buildOwnerClause\(\{[\s\S]*?\n\}/);
ok('buildOwnerClause is defined + exported', !!m);

// Faithful reimplementations of the two helpers it closes over (verbatim logic
// from api/_auth.js sanitiseForFormula and api/_lib/auth/staff.js isStaffEmail).
const sanitiseForFormula = (str) => {
  if (typeof str !== 'string') return '';
  return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"')
    .replace(/\n/g, ' ').replace(/\r/g, '').slice(0, 500);
};
const STAFF_DOMAINS = ['travelgenix.io', 'travelgenix.com', 'agendas.group'];
const isStaffEmail = (email) => {
  if (!email || typeof email !== 'string') return false;
  const clean = email.trim().toLowerCase();
  const at = clean.lastIndexOf('@');
  if (at === -1) return false;
  return STAFF_DOMAINS.includes(clean.slice(at + 1));
};
const REC_ID_RE = /^rec[A-Za-z0-9]{14}$/;

let buildOwnerClause = () => { throw new Error('not loaded'); };
if (m) {
  const body = m[0].replace(/^export function/, 'function');
  buildOwnerClause = new Function('sanitiseForFormula', 'isStaffEmail', 'REC_ID_RE',
    body + '\n return buildOwnerClause;')(sanitiseForFormula, isStaffEmail, REC_ID_RE);
}

const BETTER_LIFESTYLE = 'rec4rWiDD1LoQEVi5';   // the account Jess acts as
const CLIENT_EMAIL = 'hello@betterlifestyle.co.uk';
const STAFF_EMAIL = 'jessica.speight@agendas.group';

console.log('Acting as a client scopes ownership by ClientRecordId, never the staff email');
{
  const clause = buildOwnerClause({ activeClientId: BETTER_LIFESTYLE, activeClientEmail: CLIENT_EMAIL, userEmailLower: STAFF_EMAIL });
  ok('matches the active client by ClientRecordId', clause.includes(`{ClientRecordId}='${BETTER_LIFESTYLE}'`));
  ok('includes the legacy blank-owner + client-email fallback', clause.includes(`AND({ClientRecordId}='', LOWER({ClientEmail})='${CLIENT_EMAIL}')`));
  ok('is an OR of the two ownership routes', clause.startsWith('OR(') && clause.endsWith(')'));
  ok('NEVER scopes by the staff caller email (the reported bug)', !clause.includes(STAFF_EMAIL));
}

console.log('A client account set up under a staff address drops the email fallback');
{
  const clause = buildOwnerClause({ activeClientId: BETTER_LIFESTYLE, activeClientEmail: 'setup@agendas.group', userEmailLower: STAFF_EMAIL });
  ok('keeps the ClientRecordId match', clause === `{ClientRecordId}='${BETTER_LIFESTYLE}'`);
  ok('no email clause at all', !clause.includes('ClientEmail'));
}

console.log('No client context falls back to the caller email (legacy Bearer token)');
{
  const clause = buildOwnerClause({ activeClientId: null, activeClientEmail: '', userEmailLower: 'Owner@Acme.test' });
  ok('scopes by the caller email, lowercased', clause === `LOWER({ClientEmail})='owner@acme.test'`);
  ok('does not reference ClientRecordId', !clause.includes('ClientRecordId'));
}

console.log('A malformed active client id is never interpolated into the formula');
{
  const clause = buildOwnerClause({ activeClientId: "rec'); DROP", activeClientEmail: CLIENT_EMAIL, userEmailLower: 'safe@acme.test' });
  ok('rejects the bad id and falls back to the email scope', clause === `LOWER({ClientEmail})='safe@acme.test'`);
  ok('the bad id does not appear anywhere in the clause', !clause.includes('DROP'));
}

console.log('Normal client copying their own widget still resolves');
{
  const OWN = 'recAAAAAAAAAAAAAA';
  const clause = buildOwnerClause({ activeClientId: OWN, activeClientEmail: 'me@myshop.test', userEmailLower: 'me@myshop.test' });
  ok('matches their own ClientRecordId', clause.includes(`{ClientRecordId}='${OWN}'`));
  ok('and their own legacy widgets by email', clause.includes(`LOWER({ClientEmail})='me@myshop.test'`));
}

console.log('Endpoint wiring');
{
  ok('source lookup uses the ownerClause, not a raw ClientEmail=caller filter',
    /AND\(\{WidgetID\}='\$\{safeWidgetId\}', \$\{ownerClause\}\)/.test(SRC)
    && !/\{ClientEmail\}='\$\{safeEmail\}'/.test(SRC));
  ok('plan-limit count is scoped to the active client too',
    /countWidgetsOfType\(headers, baseId, ownerClause, sourceType\)/.test(SRC));
  ok('the copy inherits ClientEmail from the source, not the caller',
    /ClientEmail: sourceFields\.ClientEmail \|\| activeClientEmail \|\| user\.email/.test(SRC));
  ok('the copy inherits ClientName from the source, not the caller',
    /ClientName: sourceFields\.ClientName \|\| activeClientName \|\| user\.clientName/.test(SRC));
  ok('copy ClientRecordId falls back to the active client, not user.clientId directly',
    /REC_ID_RE\.test\(srcOwner\) \? srcOwner : \(activeClientId \|\| ''\)/.test(SRC));
  ok('ownership scope is resolved from the active client',
    /resolveOwnerScope\(user, headers, baseId\)/.test(SRC));
  ok('staff identity check is imported, not re-implemented',
    /import \{ isStaffEmail \} from '\.\/_lib\/auth\/staff\.js'/.test(SRC));
}

console.log('Enquiry Form copy endpoint wiring (same root cause, separate endpoint)');
{
  const EF = readFileSync(new URL('../api/enquiry-form-copy.js', import.meta.url), 'utf8');
  ok('resolves the active client from the session clientId',
    /REC_ID_RE\.test\(user\.clientId\)/.test(EF) && /getRecord\(CLIENTS\.tableId, activeClientId\)/.test(EF));
  ok('ownership allows the caller OR the active client (by ClientRecordId or client email)',
    /ownedByCaller \|\| !ownedByActiveClient|!ownedByCaller && !ownedByActiveClient/.test(EF)
    && /pointerOwner === activeClientId/.test(EF)
    && /ownerEmail === activeClientEmail/.test(EF));
  ok('no longer denies purely on ownerEmail !== the caller email',
    !/ownerEmail !== userEmail/.test(EF));
  ok('the new form owner is inherited from the source, not the caller',
    /EF\.ownerEmail\] = sourceEf\.fields\[EF\.ownerEmail\] \|\| activeClientEmail \|\| user\.email/.test(EF));
  ok('the pointer ClientEmail is inherited from the source, not the caller',
    /ClientEmail: sourceEf\.fields\[EF\.ownerEmail\] \|\| activeClientEmail \|\| user\.email/.test(EF));
  ok('the pointer carries ClientRecordId so the copy shows in the scoped list',
    /if \(copyClientRecordId\) pointerFields\.ClientRecordId = copyClientRecordId;/.test(EF));
  ok('the source pointer is fetched to read its authoritative owner',
    /const sourcePointer = await fetchPointerByWidgetId\(widgetId, headers, baseId\);/.test(EF));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
