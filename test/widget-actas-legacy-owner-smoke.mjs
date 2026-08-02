/**
 * Acting as a client must be able to edit that client's older widgets.
 *
 * THE REPORT (2 Aug 2026). Andy opened a Cypher Travel offer box while acting
 * as the client, changed a setting, hit save and got "You do not have
 * permission to edit this widget".
 *
 * WHY. A widget's owner is its ClientRecordId. 65 of our 273 widgets predate
 * that field, so the check falls back to matching the signed-in email against
 * the widget's ClientEmail — the address of whoever BUILT it
 * (rashad.ali@cyphertravelsoftware.com on this one). A staff member acting as
 * the client is signed in as themselves, so the addresses never match and all
 * 65 were uneditable from an act-as session. Which is precisely the session we
 * do support from.
 *
 * THE FIX. When the legacy email check is the only thing standing in the way,
 * resolve that ClientEmail to the client it belongs to and ask the real
 * ownership question: is this session signed into the client that owns the
 * widget? Then stamp ClientRecordId so the widget takes the fast path next
 * time and the backlog drains itself.
 *
 * This must not become a staff skeleton key. The tests below pin the shape of
 * the escalation as much as the behaviour: it applies to exactly one verdict,
 * requires a session client id, and compares for equality — never "is staff".
 *
 * Run: node test/widget-actas-legacy-owner-smoke.mjs
 */
import { readFileSync } from 'node:fs';
import { canModifyWidget } from '../api/widget-config.js';

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };

const SRC = readFileSync(new URL('../api/widget-config.js', import.meta.url), 'utf8');

const CYPHER = 'rec1LH3fZ0LhsZvxz';
const OTHER = 'recZZZZZZZZZZZZZZ';
const BUILDER = 'rashad.ali@cyphertravelsoftware.com';
const STAFF = 'andy.speight@agendas.group';

const widget = (fields) => ({ id: 'rec7ITQTBksMEnD9a', fields });
const legacy = widget({ ClientEmail: BUILDER });          // no ClientRecordId
const stamped = widget({ ClientEmail: BUILDER, ClientRecordId: CYPHER });

// ── The gate itself, unchanged where it was already right ────────────────────
ok(canModifyWidget(stamped, { sessionClientId: CYPHER, userEmail: STAFF }) === true,
  'a stamped widget is editable by anyone signed into the owning client, staff included');
ok(canModifyWidget(stamped, { sessionClientId: OTHER, userEmail: STAFF }) === 'client-mismatch',
  'and never from a session signed into a different client');
ok(canModifyWidget(stamped, { sessionClientId: null, userEmail: BUILDER }) === true,
  'a session with no client id falls back to the owning email');
ok(canModifyWidget(stamped, { sessionClientId: null, userEmail: STAFF }) === 'client-missing-email-mismatch',
  'and is denied when that email does not match either');
ok(canModifyWidget(legacy, { sessionClientId: CYPHER, userEmail: BUILDER }) === true,
  'the builder can still edit their own legacy widget');

// This is the reported failure, and the verdict the escalation keys off. It
// must stay exactly this string — the caller matches on it.
ok(canModifyWidget(legacy, { sessionClientId: CYPHER, userEmail: STAFF }) === 'email-mismatch',
  'a legacy widget still returns email-mismatch for a staff act-as session');
ok(canModifyWidget(widget({}), { sessionClientId: CYPHER, userEmail: STAFF }) === 'email-mismatch',
  'a widget with no owner recorded at all is denied, not permitted');
ok(canModifyWidget(widget({ ClientEmail: '' }), { sessionClientId: null, userEmail: '' }) === 'email-mismatch',
  'two blanks are not a match');

// ── The escalation ───────────────────────────────────────────────────────────
// Reimplements the caller's decision so the rule is pinned by behaviour, not
// only by reading the source.
function permits({ verdict, sessionClientId, legacyOwner }) {
  let heal = '';
  if (verdict === 'email-mismatch' && sessionClientId) {
    if (legacyOwner && legacyOwner === sessionClientId) heal = legacyOwner;
  }
  return { allowed: verdict === true || !!heal, stamps: heal };
}

const reported = permits({ verdict: 'email-mismatch', sessionClientId: CYPHER, legacyOwner: CYPHER });
ok(reported.allowed === true, 'acting as Cypher Travel, the legacy offer box saves');
ok(reported.stamps === CYPHER, 'and the widget is stamped with its owner on the way through');

ok(permits({ verdict: 'email-mismatch', sessionClientId: OTHER, legacyOwner: CYPHER }).allowed === false,
  'acting as a DIFFERENT client does not unlock it — this is the whole point of the check');
ok(permits({ verdict: 'email-mismatch', sessionClientId: null, legacyOwner: CYPHER }).allowed === false,
  'a session with no client id is not eligible for the second chance');
ok(permits({ verdict: 'email-mismatch', sessionClientId: CYPHER, legacyOwner: '' }).allowed === false,
  'an email we cannot resolve to a client stays denied');
// A failed lookup returns '' — it must read as "no", never as "yes".
ok(permits({ verdict: 'email-mismatch', sessionClientId: CYPHER, legacyOwner: null }).allowed === false,
  'a lookup failure denies rather than grants');
// The stronger verdicts are NOT eligible. A cross-client attempt on a stamped
// widget must not get a second bite via the builder's email.
for (const v of ['client-mismatch', 'client-missing-email-mismatch']) {
  ok(permits({ verdict: v, sessionClientId: CYPHER, legacyOwner: CYPHER }).allowed === false,
    `${v} is final — the escalation only applies to the legacy path`);
}
ok(permits({ verdict: true, sessionClientId: CYPHER, legacyOwner: CYPHER }).stamps === '',
  'an already-permitted save does not trigger a pointless stamp');

// ── Shape guards ─────────────────────────────────────────────────────────────
ok(/verdict === 'email-mismatch' && ownerClientIdFromSession/.test(SRC),
  'the escalation is gated on the legacy verdict AND a real session client');
ok(/legacyOwner && legacyOwner === ownerClientIdFromSession/.test(SRC),
  'and decides by comparing owners, not by asking whether the caller is staff');
ok(!/isTravelgenixStaff/.test(SRC.slice(SRC.indexOf('async function resolveLegacyOwner'))),
  'no staff bypass was introduced — acting as the client is what grants access');
ok(/if \(verdict !== true && !healOwner\)/.test(SRC),
  'every other denial still returns 403');
ok(/\.\.\.\(healOwner \? \{ ClientRecordId: healOwner \} : \{\}\)/.test(SRC),
  'the owner is stamped in the same write as the config, so it cannot half-apply');
// Both write paths must escalate the same way or delete stays broken.
ok(/allowed === 'email-mismatch' && ownerClientIdFromSession/.test(SRC),
  'the delete path gets the same second chance as the edit path');
// The resolver must fail closed on an Airtable error.
const resolver = SRC.slice(SRC.indexOf('async function resolveLegacyOwner'), SRC.indexOf('const legacyOwnerCache'));
ok(/catch \(err\) \{[\s\S]*return '';/.test(resolver), 'a lookup error returns empty, which denies');
ok(/if \(!REC_ID_RE\.test\(owner\)\) owner = '';/.test(resolver),
  'anything that is not a record id is discarded before it can be compared');
ok(/USERS\.fields\.email/.test(resolver) && /CLIENTS\.fields\.email/.test(resolver),
  'the address is looked up as a user of the client first, then as the client itself');

// ── The other half: the cookie has to be the one that counts ─────────────────
// Acting as a client only changes the tg_session cookie. requireAuth() prefers
// a Bearer header over that cookie, so a tg_token left in local storage from
// before the SSO migration silently outranks the live session — the act-as
// never applies and the save is authorised against whoever signed in first.
// Nothing about the fix above helps if the request never carries the act-as
// identity in the first place.
const SHELL = readFileSync(new URL('../public/editor-shell.js', import.meta.url), 'utf8');
const headers = SHELL.slice(SHELL.indexOf('function authHeaders()'),
  SHELL.indexOf('function authHeaders()') + 1400);
ok(/if \(cookieAuthState === 'authenticated'\) return h;/.test(headers),
  'the shell sends no Bearer when a cookie session is live, so act-as decides who you are');
ok(headers.indexOf("cookieAuthState === 'authenticated'") < headers.indexOf('getAuthToken()'),
  'and it checks that BEFORE reaching for the stored token');
ok(/Bearer ' \+ t/.test(headers),
  'a legacy token session still sends its Bearer — those users have no cookie to fall back on');
// requireAuth's order is the reason this matters. If it ever flips, this test
// is the note explaining why the shell was written this way.
const AUTH = readFileSync(new URL('../api/_auth.js', import.meta.url), 'utf8');
const ra = AUTH.slice(AUTH.indexOf('export function requireAuth'));
ok(ra.indexOf('getTokenFromRequest') < ra.indexOf('getCookieToken'),
  'the API still prefers a Bearer over the cookie, which is what makes the rule above necessary');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
