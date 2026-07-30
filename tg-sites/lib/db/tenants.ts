/**
 * Tenants, and the hostname lookup that has to happen before one is known.
 */

import { PREVIEW_DOT_SUFFIX } from '../domains/preview';
import { db, type DbRole } from './client';
import { withTenant, type Tx } from './withTenant';

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  plan: 'spark' | 'boost' | 'ignite' | 'bespoke';
  status: 'active' | 'suspended' | 'archived';
  theme: Record<string, unknown>;
  settings: Record<string, unknown>;
}

/**
 * The suffix every tenant gets for free, reachable before DNS is pointed.
 *
 * Re-exported rather than defined, and it used to be defined here as '.tgsites.io'.
 * lib/domains/preview.ts is the one place the domain is written down in TypeScript,
 * for reasons its header sets out at length. The alias stays because "staging" is
 * what the database layer and the fonts route already call this, and one rename is
 * cheaper to read than two names for the same string.
 */
export const STAGING_SUFFIX = PREVIEW_DOT_SUFFIX;

/**
 * Tidy a Host header into something worth looking up.
 *
 * The Host header is attacker controlled, so this is a whitelist rather than
 * a clean-up: anything that is not plausibly a hostname comes back null and
 * never reaches the database.
 */
export function normaliseHostname(input: unknown): string | null {
  if (typeof input !== 'string') return null;

  let host = input.trim().toLowerCase();
  if (!host) return null;

  // Refuse anything with structure before trimming anything off.
  //
  // This has to come first. Stripping the port cuts at the first colon, so
  // "https://example.com" would become "https", which is a perfectly valid
  // hostname shape and would sail through the check at the bottom. A URL is
  // not a hostname and the answer is no, not a best guess at what was meant.
  if (/[/\\@?#\s]/.test(host)) return null;

  // A Host header carries the port, and IPv6 arrives in brackets.
  if (host.startsWith('[')) {
    const close = host.indexOf(']');
    if (close === -1) return null;
    host = host.slice(1, close);
  } else {
    const colon = host.indexOf(':');
    if (colon !== -1) host = host.slice(0, colon);
  }

  // A trailing dot is a legal fully qualified name and resolves to the same
  // place, but would not match a stored hostname.
  if (host.endsWith('.')) host = host.slice(0, -1);

  if (host.length === 0 || host.length > 253) return null;
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/.test(host)) {
    return null;
  }

  return host;
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

interface CacheEntry {
  id: string | null;
  expires: number;
}

const resolved = new Map<string, CacheEntry>();

/** Hits stay a minute. A domain moving tenant is a deliberate, rare act. */
const HIT_TTL_MS = 60_000;

/**
 * Misses expire fast. Someone who has just pointed DNS at us and is watching
 * for it to work should not have to wait out a long cache.
 */
const MISS_TTL_MS = 5_000;

/**
 * Hostname to tenant id, or null.
 *
 * The one query in the codebase that runs with no tenant set, because it is
 * the query that works out which tenant this is. It calls resolve_tenant, a
 * SECURITY DEFINER function that returns a single id and nothing else. See
 * db/migrations/0006_resolve_tenant.sql for why that is the narrowest way to
 * break the chicken and egg.
 */
export async function resolveTenantByHostname(
  hostname: unknown,
  role: DbRole = 'renderer',
  now: number = Date.now(),
): Promise<string | null> {
  const host = normaliseHostname(hostname);
  if (!host) return null;

  const cached = resolved.get(host);
  if (cached && cached.expires > now) return cached.id;

  const rows = await db(role)<{ id: string | null }[]>`
    select public.resolve_tenant(${host}) as id
  `;
  const id = rows[0]?.id ?? null;

  resolved.set(host, { id, expires: now + (id ? HIT_TTL_MS : MISS_TTL_MS) });
  return id;
}

/** Drops a hostname from the cache. Call after changing a domain. */
export function forgetHostname(hostname: unknown): void {
  const host = normaliseHostname(hostname);
  if (host) resolved.delete(host);
  else resolved.clear();
}

// ---------------------------------------------------------------------------
// Reading a tenant
// ---------------------------------------------------------------------------

/**
 * A jsonb column as an object, whatever shape it arrives in.
 *
 * Same guard as lib/db/pages.ts, and for the same reason: a jsonb value
 * written as a pre-stringified string comes back double encoded, and a
 * client's theme is not worth losing over it.
 */
function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object') return value as Record<string, unknown>;
  if (typeof value === 'string') {
    try {
      return asObject(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return {};
}

function toTenant(row: Record<string, unknown>): Tenant {
  return {
    id: String(row.id),
    slug: String(row.slug),
    name: String(row.name),
    plan: row.plan as Tenant['plan'],
    status: row.status as Tenant['status'],
    theme: asObject(row.theme),
    settings: asObject(row.settings),
  };
}

/**
 * The tenant itself.
 *
 * Returns null rather than throwing when it is not found, because "not found"
 * and "not yours" are the same answer here: RLS makes another tenant's row
 * indistinguishable from one that does not exist, which is what it should do.
 */
export async function getTenant(tenantId: string): Promise<Tenant | null> {
  return withTenant(tenantId, async (tx) => {
    // No WHERE clause needed. The policy on `tenants` is `id = current_tenant()`,
    // so this table has exactly one visible row inside a withTenant call.
    const rows = await tx`
      select id, slug, name, plan, status, theme, settings from public.tenants limit 1
    `;
    return rows.length ? toTenant(rows[0] as Record<string, unknown>) : null;
  });
}

/** The tenant's own domains, primary first. */
export async function listDomains(
  tenantId: string,
): Promise<Array<{ hostname: string; isPrimary: boolean; sslStatus: string }>> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      select hostname, is_primary, ssl_status
      from public.domains
      order by is_primary desc, hostname
    `;
    return rows.map((row) => ({
      hostname: String(row.hostname),
      isPrimary: Boolean(row.is_primary),
      sslStatus: String(row.ssl_status),
    }));
  });
}

/**
 * The address to show a client for their site.
 *
 * Their own domain once one is live, the preview subdomain until then, so the
 * editor never shows a link that does not work yet.
 */
export async function siteUrl(tenantId: string): Promise<string> {
  const [tenant, domains] = await Promise.all([
    getTenant(tenantId),
    listDomains(tenantId),
  ]);

  const live = domains.find((d) => d.isPrimary && d.sslStatus === 'active')
    ?? domains.find((d) => d.sslStatus === 'active');

  if (live) return `https://${live.hostname}`;
  return `https://${tenant?.slug ?? 'unknown'}${STAGING_SUFFIX}`;
}

/** Whether a user may edit this tenant, and in what capacity. */
export async function roleOf(
  tenantId: string,
  userId: string,
): Promise<'owner' | 'editor' | 'viewer' | null> {
  return withTenant(tenantId, async (tx: Tx) => {
    const rows = await tx`
      select role from public.tenant_users where user_id = ${userId} limit 1
    `;
    return rows.length ? (rows[0].role as 'owner' | 'editor' | 'viewer') : null;
  });
}
