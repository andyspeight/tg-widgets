/**
 * The two questions that come before a tenant is known.
 *
 *   Who is signing in    -> withLogin, keyed on an email
 *   Which sites are mine -> withUser, keyed on a user id
 *
 * Both open a transaction with NO tenant set, which is the whole difficulty:
 * every other policy in this schema compares tenant_id to current_tenant(), and
 * neither of these questions has a tenant yet. One of them IS the question.
 *
 * See db/migrations/0008_auth.sql for why this is three transaction-local
 * settings and one privileged function rather than several privileged
 * functions. The short version: a policy can be reviewed by reading it, and
 * SECURITY DEFINER code cannot.
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
