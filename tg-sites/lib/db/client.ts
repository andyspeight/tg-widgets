/**
 * The two database connections, and nothing else.
 *
 * Nothing outside lib/db/ should import this file. Everything goes through
 * withTenant, which is the only thing that sets the tenant, and a query that
 * skips it sees nothing. There is a test that enforces the rule rather than
 * trusting anyone to remember it.
 */

import postgres from 'postgres';

export type Sql = postgres.Sql<Record<string, never>>;

/** The role a connection uses. Everything downstream keys off this. */
export type DbRole = 'app' | 'renderer';

/**
 * Pools are cached on globalThis rather than in a module variable.
 *
 * Next reloads modules on every edit in development. A plain module variable
 * would leak a pool per reload and exhaust the database's connection limit
 * within an afternoon. This is the same trick the Prisma docs use.
 */
const CACHE_KEY = Symbol.for('tgsites.db.pools');

type PoolCache = Partial<Record<DbRole, Sql>>;

function cache(): PoolCache {
  const g = globalThis as unknown as Record<symbol, PoolCache | undefined>;
  g[CACHE_KEY] ??= {};
  return g[CACHE_KEY]!;
}

const ENV_VAR: Record<DbRole, string> = {
  app: 'DATABASE_URL',
  renderer: 'RENDERER_DATABASE_URL',
};

function connectionString(role: DbRole): string {
  const name = ENV_VAR[role];
  const value = process.env[name];

  if (!value) {
    throw new Error(
      `${name} is not set, so the ${role} role cannot connect. ` +
        'Both roles are created without a password. See tg-sites/db/README.md.',
    );
  }

  // A cheap guard that has caught the mistake it exists for. Supabase hands
  // out a postgres:// URL for its own admin user, and that user holds
  // BYPASSRLS, so pasting it here would quietly turn off every policy in the
  // database while everything still appeared to work.
  const user = usernameFrom(value);
  const expected = role === 'app' ? 'tg_sites_app' : 'tg_sites_renderer';

  if (user && user !== expected) {
    throw new Error(
      `${name} connects as "${user}", not "${expected}". ` +
        (user === 'postgres' || user === 'service_role'
          ? 'That role bypasses row level security, which would expose every tenant to every other one.'
          : 'Use the role the migrations create.'),
    );
  }

  return value;
}

/** The username out of a connection string, or null if it cannot be read. */
export function usernameFrom(connection: string): string | null {
  try {
    const user = new URL(connection).username;
    if (!user) return null;
    // Supabase's pooler encodes the project into the username as
    // "tg_sites_app.qvzbothxlrzeklcvdhzp". The role is the part before the dot.
    return decodeURIComponent(user).split('.')[0] || null;
  } catch {
    return null;
  }
}

function create(role: DbRole): Sql {
  return postgres(connectionString(role), {
    // Required, not tuning. Supabase's transaction pooler multiplexes many
    // clients onto few server connections, and prepared statements are bound
    // to a server connection, so leaving this on produces "prepared statement
    // already exists" under any real concurrency.
    prepare: false,

    // Small on purpose. Each serverless instance handles one request at a
    // time, and the pooler is what does the real pooling.
    max: Number(process.env.DB_POOL_MAX ?? 3),
    idle_timeout: 20,
    max_lifetime: 60 * 30,
    connect_timeout: 10,

    // Never log a query. They carry client content.
    onnotice: () => {},
  });
}

export function db(role: DbRole): Sql {
  const pools = cache();
  pools[role] ??= create(role);
  return pools[role]!;
}

/** Closes both pools. For tests and for a clean shutdown, not for request code. */
export async function closeDb(): Promise<void> {
  const pools = cache();
  await Promise.all(
    (Object.keys(pools) as DbRole[]).map(async (role) => {
      const pool = pools[role];
      delete pools[role];
      if (pool) await pool.end({ timeout: 5 });
    }),
  );
}
