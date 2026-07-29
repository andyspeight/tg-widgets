/**
 * The only door to the database.
 *
 * Every policy in this schema compares tenant_id to current_tenant(), which
 * reads a transaction-local setting. With nothing set it is NULL, and
 * `tenant_id = NULL` is not true, so a query outside withTenant returns zero
 * rows rather than every client's data. Failing closed is the design.
 *
 * Two things make that true rather than merely intended:
 *
 *   1. The setting is written with set_config(..., true). The `true` is the
 *      local flag, which scopes it to the transaction. Without it the value
 *      would persist on the pooled connection and carry one client's tenant
 *      into the next request, which is the exact bug this whole file exists
 *      to prevent.
 *
 *   2. It is the FIRST statement in the transaction. Nothing can run before
 *      it, so there is no window in which a query runs unscoped.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type postgres from 'postgres';

import { db, type DbRole } from './client';

/** A scoped connection. The only thing the callback is allowed to query on. */
export type Tx = postgres.TransactionSql<Record<string, never>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Scope {
  tenantId: string;
  role: DbRole;
  tx: Tx;
}

const scopes = new AsyncLocalStorage<Scope>();

/**
 * A tenant id, normalised, or a thrown error.
 *
 * Bound parameters already make injection impossible. This is here for a
 * different reason: an empty string or a stray "undefined" would reach
 * set_config, current_tenant() would return NULL, and every query would come
 * back empty with no clue why. Better to say so at the door.
 */
export function assertTenantId(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw new Error(
      `Not a tenant id: ${JSON.stringify(value)}. ` +
        'Resolve one with resolveTenantByHostname before querying.',
    );
  }
  // Lowercased so the nesting check below compares like with like.
  return value.toLowerCase();
}

/** The tenant of the transaction in progress, or null outside one. */
export function currentTenantId(): string | null {
  return scopes.getStore()?.tenantId ?? null;
}

async function run<T>(
  role: DbRole,
  rawTenantId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  const tenantId = assertTenantId(rawTenantId);
  const outer = scopes.getStore();

  if (outer && outer.tenantId !== tenantId) {
    // Almost always a loop over tenants that has ended up inside a request
    // rather than around it. Allowing it would mean one transaction holding
    // two tenants, which is how cross-tenant writes happen by accident.
    throw new Error(
      `Already inside withTenant for ${outer.tenantId}, cannot open ${tenantId}. ` +
        'Finish the outer call first, or move the loop outside it.',
    );
  }

  // Same tenant, same role: reuse the transaction already open.
  //
  // Not an optimisation. Opening a second transaction here would ask the pool
  // for another connection while this one still holds the first, and at a
  // pool size of one that is a deadlock, not an error. Reusing also keeps a
  // nested write in the same atomic unit, which is what a caller expects.
  if (outer && outer.role === role) {
    return fn(outer.tx);
  }

  return db(role).begin(async (tx) => {
    await tx`select set_config('app.current_tenant_id', ${tenantId}, true)`;
    return scopes.run({ tenantId, role, tx: tx as Tx }, () => fn(tx as Tx));
  }) as Promise<T>;
}

/**
 * Run a unit of work as the editor's role, scoped to one tenant.
 *
 * Reads and writes, its own tenant only. Everything the editor and its API
 * do goes through here.
 */
export function withTenant<T>(
  tenantId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return run('app', tenantId, fn);
}

/**
 * Run a unit of work as the public website's role, scoped to one tenant.
 *
 * Reads only, published rows only. Separate from withTenant so that a
 * compromised public site cannot write anything, cannot see a draft and
 * cannot read the publish history. Use it for anything a visitor triggers.
 */
export function withPublicTenant<T>(
  tenantId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return run('renderer', tenantId, fn);
}
