/**
 * Smoke test for the scoped act-as grant (api/_lib/auth/actas.js).
 *
 * Focus: the signed grant round-trips, and every tamper / expiry / bad-shape
 * path fails closed to null so requireAuth falls back to the real staff user.
 * Also checks the staffUserId is carried so the middleware can reject a grant
 * replayed by a different user, and that the header reader is tolerant.
 *
 * Pure Node, no network. Run: node test/act-as-grant-smoke.mjs
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-act-as-0123456789abcdef';

import {
  signActAsGrant, verifyActAsGrant, readActAsHeader, resolveActAs,
  ACT_AS_HEADER, ACT_AS_TTL_MS,
} from '../api/_lib/auth/actas.js';

let passed = 0, failed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log(`  ok   ${name}`); }
  else { failed++; console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
}

const STAFF = 'recStaff000000001';   // 'rec' + 14 chars → valid rec id shape
const CLIENT = 'recClient00000001';
const OTHER = 'recStaff000000002';

// 1. Round trip
const tok = signActAsGrant({ staffUserId: STAFF, targetClientId: CLIENT });
const p = verifyActAsGrant(tok);
ok('round trip returns payload', !!p);
ok('carries staffUserId', p && p.staffUserId === STAFF, p && p.staffUserId);
ok('carries targetClientId', p && p.targetClientId === CLIENT, p && p.targetClientId);
ok('has exp in the future', p && p.exp > Date.now());
ok('default TTL is 30 min', ACT_AS_TTL_MS === 30 * 60 * 1000, String(ACT_AS_TTL_MS));

// 2. Middleware replay defence: a grant for STAFF must not match OTHER. verify
//    still returns the payload; the caller (requireAuth) compares staffUserId.
ok('grant names its staff so a different user is rejected by the caller',
  p && p.staffUserId !== OTHER);

// 3. Tampered payload → null
const [json, sig] = tok.split('.');
const badPayload = Buffer.from(JSON.stringify({ staffUserId: OTHER, targetClientId: CLIENT, iat: Date.now(), exp: Date.now() + 60000 }), 'utf8')
  .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
ok('tampered payload, original sig → null', verifyActAsGrant(badPayload + '.' + sig) === null);

// 4. Tampered signature → null
ok('tampered signature → null', verifyActAsGrant(json + '.' + sig.slice(0, -2) + 'xx') === null);

// 5. Expired grant → null
const expired = signActAsGrant({ staffUserId: STAFF, targetClientId: CLIENT }, -1000);
ok('expired grant → null', verifyActAsGrant(expired) === null);

// 6. Bad shapes → null
ok('non-string → null', verifyActAsGrant(null) === null);
ok('no dot → null', verifyActAsGrant('abcdef') === null);
ok('empty sig → null', verifyActAsGrant(json + '.') === null);
ok('garbage → null', verifyActAsGrant('..') === null);

// 7. Invalid target client id shape → null (defends against a re-signed grant
//    whose target is not a real record id)
const badTarget = signActAsGrant({ staffUserId: STAFF, targetClientId: 'not-a-rec-id' });
ok('invalid targetClientId shape → null', verifyActAsGrant(badTarget) === null);

// 8. Header reader
ok('reads lower-case header', readActAsHeader({ headers: { [ACT_AS_HEADER]: tok } }) === tok);
ok('reads array header', readActAsHeader({ headers: { [ACT_AS_HEADER]: [tok, 'x'] } }) === tok);
ok('missing header → empty string', readActAsHeader({ headers: {} }) === '');
ok('no req → empty string', readActAsHeader(undefined) === '');

// 9. resolveActAs — the exact decision requireAuth runs. This is the security
//    gate: who gets an overlay and who falls through to their real self.
const reqWith = (t) => ({ headers: t ? { [ACT_AS_HEADER]: t } : {} });

ok('staff + valid matching grant → overlay to target',
  resolveActAs({ isStaff: true, req: reqWith(tok), userRecordId: STAFF })?.targetClientId === CLIENT);
ok('NON-staff + valid grant → no overlay (null)',
  resolveActAs({ isStaff: false, req: reqWith(tok), userRecordId: STAFF }) === null);
ok('staff + no header → no overlay (null)',
  resolveActAs({ isStaff: true, req: reqWith(''), userRecordId: STAFF }) === null);
ok('staff + grant for a DIFFERENT user → no overlay (no replay)',
  resolveActAs({ isStaff: true, req: reqWith(tok), userRecordId: OTHER }) === null);
ok('staff + expired grant → no overlay (null)',
  resolveActAs({ isStaff: true, req: reqWith(expired), userRecordId: STAFF }) === null);
ok('staff + tampered grant → no overlay (null)',
  resolveActAs({ isStaff: true, req: reqWith(json + '.' + sig.slice(0, -2) + 'xx'), userRecordId: STAFF }) === null);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
