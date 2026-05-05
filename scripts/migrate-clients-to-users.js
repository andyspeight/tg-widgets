#!/usr/bin/env node
/**
 * One-off migration: split each existing Client into Client + first User.
 *
 * What this does for every record in the Clients table:
 *   1. Creates a User row with: same email, role=owner, status=active,
 *      forcePasswordReset=true, no password hash
 *   2. Links it back to the Client record via the Users field
 *   3. Generates a one-time reset token (7-day expiry — stored hashed in Invites
 *      table with a special status — see below) and emails them the
 *      "we've upgraded our security" link
 *
 * Reset-token storage strategy:
 *   The Invites table is the closest fit for "one-time tokens with expiry"
 *   we already have. We use it dual-purpose:
 *     - For real invites: status starts at 'pending'
 *     - For migration resets: status is 'pending' too, but Email matches an
 *       existing User. The accept-invite endpoint detects this and routes
 *       to "set new password for existing user" rather than "create new user".
 *   This keeps the data model clean — one tokens table, not two.
 *
 * Modes:
 *   --dry-run        Print what would happen, write nothing, send no emails
 *   --target=email   Only process the matching client (use for the test run)
 *   --limit=N        Stop after N records (use for a small live batch)
 *   --no-email       Create User rows + invites but skip the email send
 *
 * Run:
 *   node scripts/migrate-clients-to-users.js --dry-run
 *   node scripts/migrate-clients-to-users.js --target=andy.speight@agendas.group
 *   node scripts/migrate-clients-to-users.js --limit=5
 *   node scripts/migrate-clients-to-users.js                     # full run
 */

import {
  CLIENTS, USERS, INVITES
} from '../api/_lib/auth/schema.js';
import {
  listAllRecords, createRecord, updateRecord, findOneByField
} from '../api/_lib/auth/airtable.js';
import { generateSecureToken, hashToken } from '../api/_lib/auth/crypto.js';
import { sendMigrationResetEmail } from '../api/_lib/auth/email.js';

const RESET_LIFETIME_DAYS = 7;

function parseArgs() {
  const args = { dryRun: false, target: null, limit: null, noEmail: false };
  for (const a of process.argv.slice(2)) {
    if (a === '--dry-run')       args.dryRun = true;
    else if (a === '--no-email') args.noEmail = true;
    else if (a.startsWith('--target=')) args.target = a.slice(9).toLowerCase();
    else if (a.startsWith('--limit='))  args.limit  = parseInt(a.slice(8), 10);
  }
  return args;
}

function log(...parts) { console.log('[migrate]', ...parts); }

async function processClient(clientRec, opts) {
  const f = clientRec.fields;
  const email = String(f[CLIENTS.fields.email] || '').trim().toLowerCase();
  const clientName = f[CLIENTS.fields.clientName] || '';

  if (!email) {
    log(`SKIP ${clientRec.id} — no email`);
    return { skipped: true };
  }

  if (opts.target && email !== opts.target) {
    return { skipped: true };
  }

  // Has this client already been migrated? (re-run safety)
  const existingUser = await findOneByField(USERS.tableId, USERS.fields.email, email);
  if (existingUser) {
    log(`SKIP ${email} — User already exists (${existingUser.id})`);
    return { skipped: true };
  }

  log(`PROCESS ${email}  clientRecord=${clientRec.id}  clientName="${clientName}"`);

  if (opts.dryRun) {
    log(`  [dry-run] would create User, link to Client, send reset email`);
    return { dryRun: true };
  }

  // 1. Create the User
  const nowIso = new Date().toISOString();
  const userRec = await createRecord(USERS.tableId, {
    [USERS.fields.email]:              email,
    [USERS.fields.client]:             [clientRec.id],
    [USERS.fields.fullName]:           clientName,
    [USERS.fields.role]:               USERS.roles.OWNER,
    [USERS.fields.status]:             USERS.statuses.ACTIVE,
    [USERS.fields.authMethods]:        [USERS.authMethodValues.PASSWORD],
    [USERS.fields.forcePasswordReset]: true,
    [USERS.fields.created]:            nowIso
  });
  log(`  created User ${userRec.id}`);

  // 2. Generate reset token (stored hashed in Invites table)
  const rawToken = generateSecureToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + RESET_LIFETIME_DAYS * 24 * 60 * 60 * 1000);

  await createRecord(INVITES.tableId, {
    [INVITES.fields.tokenHash]: tokenHash,
    [INVITES.fields.email]:     email,
    [INVITES.fields.client]:    [clientRec.id],
    [INVITES.fields.invitedBy]: [userRec.id], // self — they're the owner
    [INVITES.fields.role]:      USERS.roles.OWNER,
    [INVITES.fields.status]:    INVITES.statuses.PENDING,
    [INVITES.fields.expiresAt]: expiresAt.toISOString(),
    [INVITES.fields.created]:   nowIso
  });
  log(`  created reset-token invite (expires ${expiresAt.toISOString()})`);

  // 3. Send the migration email
  if (opts.noEmail) {
    log(`  [no-email] skipping send. Token: ${rawToken}`);
  } else {
    try {
      await sendMigrationResetEmail({
        to: email,
        resetToken: rawToken,
        fullName: clientName,
        clientName
      });
      log(`  email sent`);
    } catch (err) {
      log(`  EMAIL FAILED for ${email}: ${err.message}`);
      return { processed: true, emailFailed: true };
    }
  }

  return { processed: true };
}

async function main() {
  const opts = parseArgs();
  log('Starting migration', JSON.stringify(opts));

  if (!process.env.AIRTABLE_PAT) {
    console.error('AIRTABLE_PAT not set — abort');
    process.exit(1);
  }
  if (!opts.dryRun && !opts.noEmail && !process.env.SENDGRID_API_KEY) {
    console.error('SENDGRID_API_KEY not set — pass --no-email to skip sending or set the var');
    process.exit(1);
  }

  const allClients = await listAllRecords(CLIENTS.tableId);
  log(`Loaded ${allClients.length} client records`);

  const counts = { processed: 0, skipped: 0, emailFailed: 0 };
  let processedSinceLast = 0;

  for (const clientRec of allClients) {
    const result = await processClient(clientRec, opts);
    if (result.processed) counts.processed += 1;
    if (result.skipped)   counts.skipped += 1;
    if (result.emailFailed) counts.emailFailed += 1;

    if (opts.limit && counts.processed >= opts.limit) {
      log(`Hit --limit=${opts.limit}, stopping`);
      break;
    }

    // Light pacing: 250ms between non-skipped writes (~4/sec, well under
    // Airtable's 5/sec). Skips don't pause.
    if (!result.skipped) {
      processedSinceLast += 1;
      if (processedSinceLast >= 1) {
        await new Promise(r => setTimeout(r, 250));
        processedSinceLast = 0;
      }
    }
  }

  log('---');
  log('DONE', JSON.stringify(counts));
}

main().catch(err => {
  console.error('[migrate] fatal:', err);
  process.exit(1);
});
