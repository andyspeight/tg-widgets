/**
 * Staff-led client setup + handover email heal (Andy, 23 Jul 2026).
 *
 * Staff are often first into a client account — they build the site before
 * the client ever signs in. The New Client wizard therefore supports a
 * staff-led mode: no contact required, no invite sent, account email left
 * BLANK (never a staff address — the cause of the Worldchoice widget-list
 * leak). At handover, inviting the client's first owner/admin heals the
 * account email automatically.
 *
 * Runs the REAL shouldHealAccountEmail decision helper, plus source guards
 * on the create endpoint, the invite endpoint and the wizard.
 *
 * Run: node test/staff-led-setup-smoke.mjs
 */
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };

process.env.AIRTABLE_PAT = 'pat_test';
process.env.AIRTABLE_KEY = 'pat_test';
process.env.AIRTABLE_BASE_ID = 'appTESTBASE000000';
process.env.TG_SESSION_SECRET = 'test-session-secret-0123456789abcdef0123456789';

const { shouldHealAccountEmail } = await import('../api/admin/clients/invite-user.js');

// ── The heal decision (pure) ─────────────────────────────────────────────────
ok(shouldHealAccountEmail('', 'owner') === true, 'blank account email + owner invite → heal (the staff-led handover)');
ok(shouldHealAccountEmail('', 'admin') === true, 'blank account email + admin invite → heal');
ok(shouldHealAccountEmail('luke.livsey@agendas.group', 'owner') === true, 'staff account email + owner invite → heal (repairs Worldchoice-shaped accounts)');
ok(shouldHealAccountEmail('luke.livsey@agendas.group', 'admin') === true, 'staff account email + admin invite → heal');
ok(shouldHealAccountEmail('', 'member') === false, 'member invite is NOT a handover — no heal');
ok(shouldHealAccountEmail('luke.livsey@agendas.group', 'member') === false, 'member invite never heals');
ok(shouldHealAccountEmail('sarah@acme-travel.co.uk', 'owner') === false, 'a genuine client email is NEVER overwritten');
ok(shouldHealAccountEmail('sarah@acme-travel.co.uk', 'admin') === false, 'a genuine client email is never overwritten (admin)');
ok(shouldHealAccountEmail(null, 'owner') === true && shouldHealAccountEmail(undefined, 'OWNER') === true, 'null/undefined email and role casing handled');

// ── Source guards: create endpoint ───────────────────────────────────────────
const create = readFileSync(new URL('../api/admin/clients/create.js', import.meta.url), 'utf8');
ok(/staffLedSetup = body\.staffLedSetup === true/.test(create), 'create: staff-led mode is an explicit opt-in flag');
ok(/staffLedSetup \? '' : normaliseEmail\(body\.primaryContactEmail\)/.test(create), 'create: staff-led account email is BLANK, never a staff address');
ok(/if \(!staffLedSetup\) \{[\s\S]{0,200}isValidEmail\(primaryContactEmail\)/.test(create), 'create: contact email only required outside staff-led mode');
ok(/if \(primaryContactEmail\) \{[\s\S]{0,200}A client already uses this primary email/.test(create), 'create: email-uniqueness checks skipped when there is no email');
ok(/skipped: 'staff-led setup/.test(create), 'create: no invite is sent in staff-led mode');
ok(/\[Staff-led setup\] Created by/.test(create), 'create: staff-led setups are stamped in the client notes');
ok(/Tick "Staff-led setup"/.test(create), 'create: the staff-email error points at the sanctioned route');

// ── Source guards: invite endpoint (handover) ────────────────────────────────
const invite = readFileSync(new URL('../api/admin/clients/invite-user.js', import.meta.url), 'utf8');
ok(/shouldHealAccountEmail\(targetClient\.fields\?\.\[CLIENTS\.fields\.email\], newUserRole\)/.test(invite), 'invite: heal decision runs against the target client');
ok(/updateRecord\(CLIENTS\.tableId, clientId, \{ \[CLIENTS\.fields\.email\]: email \}\)/.test(invite), 'invite: heal writes the invited address as the account email');
ok(/healedAccountEmail/.test(invite), 'invite: heal outcome reported to the admin UI');

// ── Source guards: the wizard ────────────────────────────────────────────────
const wizard = readFileSync(new URL('../public/admin/new-client.html', import.meta.url), 'utf8');
ok(/id="f-staff-led"/.test(wizard) && /staffLedSetup: state\.staffLedSetup === true/.test(wizard), 'wizard: staff-led checkbox wired into the submit payload');
ok(/if \(!state\.staffLedSetup\) \{/.test(wizard), 'wizard: contact validation relaxed in staff-led mode');
ok(/state\.useContactForAgent = false/.test(wizard), 'wizard: Luna Chat cannot silently reuse a contact that does not exist');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
