/**
 * TEMPORARY MIGRATION ENDPOINT — delete after Phase 1 cutover.
 *
 * GET /api/_admin/migrate?key=<MIGRATION_SECRET>&mode=<dry-run|target|full>
 *                        &target=<email>     (only used when mode=target)
 *                        &limit=<n>          (optional, caps records processed)
 *                        &noEmail=1          (optional, creates rows but skips email)
 *
 * Modes:
 *   dry-run  — Read every Client, print what would happen, write nothing.
 *   target   — Process only the client whose email matches ?target=...
 *   full     — Process all unmigrated clients (idempotent — skips already done).
 *
 * Returns JSON with per-record results and a totals summary.
 *
 * Security:
 *   - Requires MIGRATION_SECRET env var, compared in constant time.
 *   - Returns 404 (not 401) if secret missing/wrong, to avoid leaking that
 *     this endpoint exists to scanners.
 *   - Cache-Control: no-store so the response is never cached anywhere.
 *
 * After bulk migration is done:
 *   1. Delete this file
 *   2. Delete the MIGRATION_SECRET env var
 *   3. Commit + redeploy
 */

import {
  CLIENTS, USERS, INVITES
} from '../_lib/auth/schema.js';
import {
  listAllRecords, createRecord, findOneByField
} from '../_lib/auth/airtable.js';
import { generateSecureToken, hashToken, constantTimeEqual } from '../_lib/auth/crypto.js';
import { sendMigrationResetEmail } from '../_lib/auth/email.js';

const RESET_LIFETIME_DAYS = 7;
const MIGRATION_SECRET = process.env.MIGRATION_SECRET;

function notFound(res) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(404).json({ error: 'Not found' });
}

async function processClient(clientRec, opts, log) {
  const f = clientRec.fields;
  const email = String(f[CLIENTS.fields.email] || '').trim().toLowerCase();
  const clientName = f[CLIENTS.fields.clientName] || '';

  if (!email) {
    log(`SKIP ${clientRec.id} — no email`);
    return { skipped: true, reason: 'no_email' };
  }

  if (opts.target && email !== opts.target) {
    return { skipped: true, reason: 'not_target' };
  }

  // Re-run safety: skip if already migrated
  const existingUser = await findOneByField(USERS.tableId, USERS.fields.email, email);
  if (existingUser) {
    log(`SKIP ${email} — User already exists (${existingUser.id})`);
    return { skipped: true, reason: 'already_migrated', email };
  }

  log(`PROCESS ${email}  clientRecord=${clientRec.id}  clientName="${clientName}"`);

  if (opts.dryRun) {
    log(`  [dry-run] would create User, link to Client, send reset email`);
    return { dryRun: true, email, clientName };
  }

  const nowIso = new Date().toISOString();

  // 1. Create the User row
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
    [INVITES.fields.invitedBy]: [userRec.id],
    [INVITES.fields.role]:      USERS.roles.OWNER,
    [INVITES.fields.status]:    INVITES.statuses.PENDING,
    [INVITES.fields.expiresAt]: expiresAt.toISOString(),
    [INVITES.fields.created]:   nowIso
  });
  log(`  created reset-token invite (expires ${expiresAt.toISOString()})`);

  // 3. Send the migration email
  if (opts.noEmail) {
    log(`  [no-email] skipping send`);
    return { processed: true, email, userRecId: userRec.id, emailSent: false };
  }

  try {
    await sendMigrationResetEmail({
      to: email,
      resetToken: rawToken,
      fullName: clientName,
      clientName
    });
    log(`  email sent`);
    return { processed: true, email, userRecId: userRec.id, emailSent: true };
  } catch (err) {
    log(`  EMAIL FAILED for ${email}: ${err.message}`);
    return { processed: true, email, userRecId: userRec.id, emailSent: false, emailError: err.message };
  }
}

export default async function handler(req, res) {
  // Gate behind secret
  if (!MIGRATION_SECRET) return notFound(res);
  const key = (req.query && req.query.key) || '';
  if (!constantTimeEqual(String(key), MIGRATION_SECRET)) return notFound(res);

  // Parse mode
  const modeRaw = String((req.query && req.query.mode) || '').toLowerCase();
  const mode = modeRaw === 'dry-run' ? 'dry-run'
             : modeRaw === 'target'  ? 'target'
             : modeRaw === 'full'    ? 'full'
             : null;
  if (!mode) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(400).json({
      error: 'mode required',
      allowed: ['dry-run', 'target', 'full']
    });
  }

  const target = mode === 'target'
    ? String((req.query && req.query.target) || '').trim().toLowerCase()
    : null;
  if (mode === 'target' && !target) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(400).json({ error: 'target email required when mode=target' });
  }

  const limitRaw = parseInt(String((req.query && req.query.limit) || ''), 10);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : null;
  const noEmail = String((req.query && req.query.noEmail) || '') === '1';

  const opts = {
    dryRun: mode === 'dry-run',
    target,
    limit,
    noEmail
  };

  const lines = [];
  const log = (...parts) => {
    const line = parts.join(' ');
    lines.push(line);
    console.log('[migrate]', line);
  };

  log(`Starting migration  mode=${mode}  target=${target || '-'}  limit=${limit || '-'}  noEmail=${noEmail}`);

  // Pre-flight env checks
  if (!process.env.AIRTABLE_PAT) {
    log('ABORT: AIRTABLE_PAT not set');
    return res.status(500).json({ ok: false, lines, error: 'AIRTABLE_PAT not set' });
  }
  if (!opts.dryRun && !opts.noEmail && !process.env.SENDGRID_API_KEY) {
    log('ABORT: SENDGRID_API_KEY not set');
    return res.status(500).json({ ok: false, lines, error: 'SENDGRID_API_KEY not set' });
  }

  let allClients;
  try {
    allClients = await listAllRecords(CLIENTS.tableId);
  } catch (err) {
    log(`ABORT: failed to read Clients table — ${err.message}`);
    return res.status(500).json({ ok: false, lines, error: err.message });
  }
  log(`Loaded ${allClients.length} client records`);

  const counts = { processed: 0, skipped: 0, emailFailed: 0, dryRun: 0 };
  const results = [];

  for (const clientRec of allClients) {
    let result;
    try {
      result = await processClient(clientRec, opts, log);
    } catch (err) {
      log(`ERROR on client ${clientRec.id}: ${err.message}`);
      result = { error: err.message, clientRecId: clientRec.id };
    }
    results.push(result);

    if (result.processed) counts.processed += 1;
    if (result.skipped)   counts.skipped += 1;
    if (result.dryRun)    counts.dryRun += 1;
    if (result.processed && result.emailSent === false && !opts.noEmail) {
      counts.emailFailed += 1;
    }

    if (opts.limit && (counts.processed + counts.dryRun) >= opts.limit) {
      log(`Hit limit=${opts.limit}, stopping`);
      break;
    }

    // Pace to ~4 writes/sec when actually writing
    if (!result.skipped && !opts.dryRun) {
      await new Promise(r => setTimeout(r, 250));
    }
  }

  log(`DONE  ${JSON.stringify(counts)}`);

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    ok: true,
    mode,
    counts,
    totalClients: allClients.length,
    results,
    log: lines
  });
}
