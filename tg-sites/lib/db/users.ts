/**
 * The three questions that come before a tenant is known.
 *
 *   Who is signing in      -> withLogin, keyed on an email
 *   Which sites are mine   -> withUser, keyed on a user id
 *   Where does this invite -> withInvite, keyed on a token hash
 *   link lead
 *
 * All three open a transaction with NO tenant set, which is the whole
 * difficulty: every other policy in this schema compares tenant_id to
 * current_tenant(), and none of these questions has a tenant yet. One of them
 * IS the question.
 *
 * See db/migrations/0008_auth.sql for why this is transaction-local settings
 * and ONE privileged function rather than several privileged functions. The
 * short version: a policy can be reviewed by reading it, and SECURITY DEFINER
 * code cannot. The invite door added on 1 Aug 2026 follows the same rule and
 * adds no privileged code.
 */

import 'server-only';

import { db } from './client';
import type { StoredCredentials } from '../auth/identity';
import type { Tx } from './withTenant';

/**
 * A user id, or a thrown error.
 *
 * Provider subjects are opaque text, not uuids, so this cannot check a shape.
 * It checks the two things that would otherwise fail silently: empty, which
 * makes current_user_id() return NULL and every query come back empty for no
 * visible reason, and absurdly long, which is somebody putting a payload where
 * an id goes.
 */
export function assertUserId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 255) {
    throw new Error(
      `Not a user id: ${JSON.stringify(value)}. ` +
        'It comes from a verified session cookie, never from a request body.',
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// Signing in
// ---------------------------------------------------------------------------

/**
 * Read the credentials row for one email, and nothing else.
 *
 * The auth_users_login policy is `email = login_email()`, so this transaction
 * can see exactly the row it names and no others. Naming an email that does
 * not exist returns nothing, which is why the caller has to burn the hashing
 * time anyway: the database's answer is fast either way.
 *
 * Not exported. Sign-in goes through findCredentials, so there is one path and
 * it always sets the setting first.
 */
async function withLogin<T>(email: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db('app').begin(async (tx) => {
    // First statement in the transaction. Nothing can query before the policy
    // has something to compare against.
    await tx`select set_config('app.login_email', ${email}, true)`;
    return fn(tx as Tx);
  }) as Promise<T>;
}

/**
 * The stored credentials for an email, or null.
 *
 * Null means "no usable account", which covers no row at all. The caller must
 * not treat those differently: see the timing note in lib/auth/identity.ts.
 */
export async function findCredentials(email: string): Promise<StoredCredentials | null> {
  return withLogin(email, async (tx) => {
    // No WHERE clause on email. The policy is the WHERE clause, and writing it
    // twice would suggest the query is what limits the rows.
    const rows = await tx`
      select id, email, name, password_hash, status
      from public.auth_users
      limit 1
    `;
    if (!rows.length) return null;

    const row = rows[0] as Record<string, unknown>;
    return {
      id: String(row.id),
      email: String(row.email),
      name: row.name == null ? null : String(row.name),
      passwordHash: row.password_hash == null ? null : String(row.password_hash),
      status: row.status === 'suspended' ? 'suspended' : 'active',
    };
  });
}

// ---------------------------------------------------------------------------
// A signed-in person
// ---------------------------------------------------------------------------

/**
 * Run a unit of work as a known user, with no tenant chosen.
 *
 * For the two things a session needs before it can pick a site: the person's
 * own record, and the list of sites they belong to. Anything scoped to one site
 * goes through withTenant instead.
 */
export function withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const id = assertUserId(userId);
  return db('app').begin(async (tx) => {
    await tx`select set_config('app.current_user_id', ${id}, true)`;
    return fn(tx as Tx);
  }) as Promise<T>;
}

export interface Membership {
  tenantId: string;
  /** The slug, so a URL can name a site without exposing its id. */
  slug: string;
  name: string;
  role: 'owner' | 'editor' | 'viewer';
}

/**
 * Every site this person can open, in a stable order.
 *
 * THIS IS THE ONLY PLACE A TENANT ID MAY COME FROM.
 *
 * Not a request body, not a query string, not a cookie. A tenant id that
 * arrived from outside is a tenant id somebody chose, and the whole session
 * layer rests on the id being one the database handed over in answer to "which
 * sites belong to this user".
 *
 * The join is an ordinary one. tenants_mine and tenant_users_own_memberships
 * do the work, and a switched-off site drops out here rather than needing a
 * status check in this query, because tenants_mine already requires active.
 * The isolation suite has a check for exactly that.
 */
export async function listMemberships(userId: string): Promise<Membership[]> {
  return withUser(userId, async (tx) => {
    const rows = await tx`
      select t.id, t.slug, t.name, tu.role
      from public.tenant_users tu
      join public.tenants t on t.id = tu.tenant_id
      order by t.name
    `;
    return rows.map((row) => ({
      tenantId: String(row.id),
      slug: String(row.slug),
      name: String(row.name),
      role: (row.role === 'owner' || row.role === 'viewer' ? row.role : 'editor') as
        Membership['role'],
    }));
  });
}

/**
 * The person's own record, or null if the session names somebody who is gone.
 *
 * Null is a real answer. A signed cookie outlives the row it points at when an
 * account is deleted, and the right response is to sign them out rather than
 * to crash.
 */
export async function findUser(
  userId: string,
): Promise<{ id: string; email: string; name: string | null } | null> {
  return withUser(userId, async (tx) => {
    const rows = await tx`
      select id, email, name from public.auth_users limit 1
    `;
    if (!rows.length) return null;
    const row = rows[0] as Record<string, unknown>;
    return {
      id: String(row.id),
      email: String(row.email),
      name: row.name == null ? null : String(row.name),
    };
  });
}

/**
 * Record that somebody signed in.
 *
 * Best effort. A failure here must not stop a sign-in that has already been
 * verified, so the caller is expected to ignore what this throws. It is a
 * nice-to-have column, not part of the security story.
 */
export async function touchLastSeen(userId: string): Promise<void> {
  await withUser(userId, async (tx) => {
    // The auth_users_self policy limits this to the caller's own row, so there
    // is no WHERE clause to get wrong.
    await tx`update public.auth_users set last_seen_at = now()`;
  });
}

// ---------------------------------------------------------------------------
// An invite link, held by somebody who is not in the site yet
// ---------------------------------------------------------------------------

/**
 * Run a unit of work with an invite token hash set, and no tenant.
 *
 * THE THIRD QUESTION THAT HAS NO TENANT, and the reason is the sharpest of the
 * three: the person holding the link is by definition not a member of the site
 * it leads to, so there is no membership to derive a tenant from and no way for
 * them to name one. The token is the only thing they have.
 *
 * Same shape as withLogin, and for the same reason 0008 gives about sign-in: a
 * second SECURITY DEFINER function would answer this too, and privileged code
 * is the thing you cannot review by reading a policy. The policy this pairs
 * with, site_invites_by_token, reveals exactly the row whose hash matches, and
 * that hash is one the caller already named. It cannot enumerate.
 *
 * Not exported. Every read of an invite goes through inviteByToken below, so
 * there is one path and it always sets the setting first.
 */
function withInvite<T>(tokenHash: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  /*
   * Checked here rather than trusted, even though the only caller hashes it
   * with SHA-256 a line earlier. It is a transaction-local setting compared
   * against a column, and a value that is not a hash cannot match one, so this
   * costs nothing and closes the door on a future caller passing a raw token.
   */
  if (!/^[0-9a-f]{64}$/.test(tokenHash)) {
    throw new Error('An invite is looked up by the hash of its token, not by the token.');
  }

  return db('app').begin(async (tx) => {
    // First statement in the transaction. Nothing can query before the policy
    // has something to compare against.
    await tx`select set_config('app.invite_token_hash', ${tokenHash}, true)`;
    return fn(tx as Tx);
  }) as Promise<T>;
}

export interface InviteRow {
  id: string;
  tenantId: string;
  /** Who it was issued to, lower-cased. */
  email: string;
  role: 'owner' | 'editor' | 'viewer';
}

/**
 * The invite a link leads to, or null.
 *
 * NULL COVERS EVERY WAY OF BEING WRONG, and that is deliberate. Expired,
 * already used, revoked, for a site that has been switched off, or simply never
 * real: all of them come back as nothing, so a stale link and a made-up one are
 * indistinguishable to whoever is holding it.
 *
 * Deliberately does NOT return the token hash, who issued it or anything about
 * the site beyond its id. The name of the site is read afterwards, inside that
 * tenant, through the ordinary policies.
 */
export async function inviteByToken(tokenHash: string): Promise<InviteRow | null> {
  return withInvite(tokenHash, async (tx) => {
    const rows = await tx`
      select id, tenant_id, email, role
      from public.site_invites
      where accepted_at is null and expires_at > now()
      limit 1
    `;

    if (!rows.length) return null;

    const row = rows[0] as Record<string, unknown>;
    return {
      id: String(row.id),
      tenantId: String(row.tenant_id),
      email: String(row.email),
      role: (row.role === 'owner' || row.role === 'viewer' ? row.role : 'editor') as
        InviteRow['role'],
    };
  });
}

/**
 * Create the account an invite is for, if there is not one already.
 *
 * THE ONLY PATH IN THIS PRODUCT THAT MAKES AN ACCOUNT, and it is reachable
 * exactly once per invite by whoever holds a 256-bit token addressed to that
 * email. db/make-user.mjs says this product should not have self-service
 * sign-up and it still does not: an account exists because somebody who owns a
 * site decided it should.
 *
 * THE ID IS `local:<email>`, matching make-user.mjs rather than inventing a
 * second shape. When Travelify SSO lands every locally created row has to be
 * remapped to the subject it issues, and one convention makes that a job
 * somebody can do by looking.
 *
 * Runs under withUser SET TO THE NEW ID, which is not a trick: auth_users_self
 * is `with check (id = current_user_id())`, so naming the row being created is
 * exactly what that policy asks for. No new policy, and the insert still cannot
 * write anybody else's row.
 *
 * Null when the email is taken. The caller tells them to sign in instead, which
 * leaks nothing: they are holding an invite addressed to that address.
 */
export async function createInvitedAccount(input: {
  email: string;
  passwordHash: string;
  name?: string | null;
}): Promise<{ id: string; email: string; name: string | null } | null> {
  const id = `local:${input.email}`;

  return withUser(id, async (tx) => {
    const rows = await tx`
      insert into public.auth_users (id, email, password_hash, name)
      values (${id}, ${input.email}, ${input.passwordHash}, ${input.name ?? null}::text)
      on conflict (email) do nothing
      returning id, email, name
    `;

    if (!rows.length) return null;

    const row = rows[0] as Record<string, unknown>;
    return {
      id: String(row.id),
      email: String(row.email),
      name: row.name == null ? null : String(row.name),
    };
  });
}
