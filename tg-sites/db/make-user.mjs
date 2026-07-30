/**
 * Print the SQL to create a user, with a properly hashed password.
 *
 *   node db/make-user.mjs andy@travelgenix.com 'a long passphrase here' iso-alpha
 *
 * The third argument is optional and is a tenant slug: give it and the output
 * also adds a membership, so one paste into the Supabase SQL editor produces
 * somebody who can actually sign in and see a site.
 *
 * WHY A SCRIPT AND NOT A SIGN-UP PAGE
 *
 * Travelgenix Sites has no self-service sign-up and should not have one. These
 * are staff and agent accounts on a product sold to travel businesses, so an
 * account exists because somebody decided it should. That makes the first
 * account a chicken-and-egg problem, and this is the smallest honest answer to
 * it: no endpoint, nothing reachable from the internet, and it prints SQL for a
 * person to read rather than connecting to anything itself.
 *
 * It deliberately does NOT touch the database. This container cannot reach
 * Postgres anyway, and more to the point, a script that writes credentials is a
 * script somebody will point at production by accident.
 */

// Both are leaf modules with no relative imports, which is what lets Node run
// this with --experimental-strip-types and no build step.
import { normaliseEmail } from '../lib/auth/email.ts';
import { hashPassword, MIN_PASSWORD_LENGTH } from '../lib/auth/password.ts';

const [rawEmail, password, slug] = process.argv.slice(2);

function die(message) {
  console.error(`\n${message}\n`);
  console.error("Usage: node db/make-user.mjs <email> '<password>' [tenant-slug]\n");
  process.exit(1);
}

const email = normaliseEmail(rawEmail);
if (!email) die(`"${rawEmail ?? ''}" is not an email address.`);
if (!password || password.length < MIN_PASSWORD_LENGTH) {
  die(`The password needs at least ${MIN_PASSWORD_LENGTH} characters.`);
}

/*
 * The id is derived from the email rather than random.
 *
 * When Travelify SSO lands, tenant_users.user_id has to match the subject it
 * issues, and every row created here will need remapping. A readable id makes
 * that a job somebody can do by looking; a uuid makes it a job requiring a
 * join and a guess.
 */
const id = `local:${email}`;
const hash = await hashPassword(password);

const quote = (value) => `'${String(value).replace(/'/g, "''")}'`;

console.log(`
-- Travelgenix Sites: one user, created ${new Date().toISOString().slice(0, 10)}.
-- Paste into the Supabase SQL editor. Safe to re-run: it updates the password
-- rather than failing on the second go.

insert into public.auth_users (id, email, password_hash, name)
values (${quote(id)}, ${quote(email)}, ${quote(hash)}, ${quote(email.split('@')[0])})
on conflict (email) do update
  set password_hash = excluded.password_hash;
`.trim());

if (slug) {
  console.log(`
-- And a membership, so there is a site to open.
insert into public.tenant_users (tenant_id, user_id, role)
select t.id, ${quote(id)}, 'owner'
from public.tenants t
where t.slug = ${quote(slug)}
on conflict (tenant_id, user_id) do update set role = 'owner';
`.trim());
} else {
  console.log(`
-- No tenant slug was given, so this user belongs to no site yet and will see
-- "No sites yet" after signing in. Add a membership with:
--
--   insert into public.tenant_users (tenant_id, user_id, role)
--   select t.id, ${quote(id)}, 'owner' from public.tenants t where t.slug = 'your-slug';
`.trim());
}

console.error(`\nHashed with scrypt. The password itself is not in the output above.\n`);
