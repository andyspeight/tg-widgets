/**
 * widget-config — the injected Travelify AppID comes from the widget's OWNING
 * ACCOUNT, not the creator's email (Andy, Aug 2026).
 *
 * The bug: the five booking widgets (Event Tickets, Next Event, Club Picker,
 * Ticket Search, Ticket Month) plus Venue Guide / World Map / Travel Offers get
 * their client's AppID injected at config-GET. That injection resolved the
 * credentials by the CREATOR'S EMAIL. One person can own many client accounts
 * under the same email (staff acting-as, a multi-brand owner), so the email
 * lookup returned an ARBITRARY account — a Club Picker built in the "250" account
 * came back with AppID 475. The widget already stores its authoritative owning
 * account in ClientRecordId (it is the owner used for the edit-permission check),
 * so the fix resolves credentials from THAT, falling back to email only for
 * legacy widgets with no ClientRecordId.
 *
 * Source-level guard (the live path calls Airtable): asserts the resolution is
 * wired ClientRecordId-first.
 *
 * Run: node test/widget-appid-injection-smoke.mjs   (npm run test:widget-appid)
 */
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../api/widget-config.js', import.meta.url), 'utf8');

let passed = 0, failed = 0;
const ok = (name, cond) => { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; console.error('  ✗ ' + name); } };

ok('lookupClientCredentialsByRecordId is imported', /import\s*\{[^}]*lookupClientCredentialsByRecordId[^}]*\}\s*from\s*'\.\/_auth\.js'/.test(SRC));
ok('the owning account is read from the widget record ClientRecordId', /clientRecordId\s*=\s*\(widgetRecord\.fields\.ClientRecordId/.test(SRC));
ok('the injection gate allows a record id OR an email', /NEEDS_APP_ID\.includes\(widgetType\)\s*&&\s*\(clientRecordId\s*\|\|\s*clientEmail\)/.test(SRC));

// Credentials resolve by record id BEFORE the email fallback.
const m = SRC.match(/const creds =\s*\(clientRecordId \? await lookupClientCredentialsByRecordId\(clientRecordId\) : null\)\s*\|\|\s*\(clientEmail \? await lookupClientCredentialsByEmail\(clientEmail\) : null\)/);
ok('credentials resolve by ClientRecordId first, then email', !!m);

// Regression: the old behaviour (email-only resolution) must be gone.
ok('the old email-only resolution is gone', !/const creds = await lookupClientCredentialsByEmail\(clientEmail\);/.test(SRC));

// Club Picker (and the rest of the family) are still in the gate list.
ok('Club Picker is still gated for AppID injection', /NEEDS_APP_ID = \[[\s\S]*'Club Picker'/.test(SRC));

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
