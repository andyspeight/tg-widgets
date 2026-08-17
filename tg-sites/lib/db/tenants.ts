/**
 * Tenants, and the hostname lookup that has to happen before one is known.
 */

import { isPreviewHostname, PREVIEW_DOT_SUFFIX } from '../domains/preview';
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

/** A DNS challenge the provider handed back, to show the client verbatim. */
export interface DomainVerificationRecord {
  type: string;
  domain: string;
  value: string;
  reason?: string;
}

/**
 * A row of the domains table, as a screen wants it.
 *
 * Wider than the three fields the dashboards read (hostname, primary, status),
 * because the domains screen also needs to tell a preview row from a custom one,
 * name the provider, and show the pending challenge. The extra fields are
 * additive, so siteUrl and the dashboards that only read the first three are
 * untouched.
 */
export interface SiteDomain {
  hostname: string;
  isPrimary: boolean;
  sslStatus: 'pending' | 'active' | 'failed' | 'deleted';
  kind: 'preview' | 'custom';
  provider: string | null;
  verification: DomainVerificationRecord[];
  verifiedAt: string | null;
}

/** jsonb verification, defended against the double-encoded string case. */
function asVerification(value: unknown): DomainVerificationRecord[] {
  const array = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? (() => {
          try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : [];
          } catch {
            return [];
          }
        })()
      : [];

  return array.filter(
    (item): item is DomainVerificationRecord =>
      !!item &&
      typeof item === 'object' &&
      typeof (item as { type?: unknown }).type === 'string' &&
      typeof (item as { value?: unknown }).value === 'string',
  );
}

function toDomain(row: Record<string, unknown>): SiteDomain {
  return {
    hostname: String(row.hostname),
    isPrimary: Boolean(row.is_primary),
    sslStatus: String(row.ssl_status) as SiteDomain['sslStatus'],
    kind: row.kind === 'preview' ? 'preview' : 'custom',
    provider: row.provider ? String(row.provider) : null,
    verification: asVerification(row.verification),
    verifiedAt: row.verified_at ? new Date(row.verified_at as string).toISOString() : null,
  };
}

/** The columns every domain read wants, in one place so the three writers agree. */
function domainColumns(tx: Tx) {
  return tx`hostname, is_primary, ssl_status, kind, provider, verification, verified_at`;
}

/** The tenant's own domains, primary first. */
export async function listDomains(tenantId: string): Promise<SiteDomain[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      select ${domainColumns(tx)}
      from public.domains
      order by is_primary desc, hostname
    `;
    return rows.map((row) => toDomain(row as Record<string, unknown>));
  });
}

// ---------------------------------------------------------------------------
// Writing a domain
// ---------------------------------------------------------------------------

/**
 * Add a custom domain to a site, as pending.
 *
 * Inserts the row and nothing more. Attaching it to the certificate provider and
 * recording what they said is recordDomainProvisioning's job, called by the
 * action once Vercel has answered, so this stays a pure database write a test can
 * drive with no network. kind is 'custom', never 'preview': a preview row is ours
 * to make and this is the path a client reaches.
 *
 * Refuses a hostname under our own preview domain before the database does, so
 * the client gets a sentence rather than a raw constraint name. The unique index
 * on hostname does the rest: a domain already claimed, by this tenant or any
 * other, comes back as a thrown duplicate the action turns into a friendly line.
 */
export async function addDomain(tenantId: string, rawHostname: unknown): Promise<SiteDomain> {
  const hostname = normaliseHostname(rawHostname);
  if (!hostname) throw new Error('That does not look like a web address.');
  if (isPreviewHostname(hostname)) {
    throw new Error('That address is part of our own preview domain. Add a domain you own.');
  }

  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      insert into public.domains (tenant_id, hostname, kind, is_primary)
      values (
        ${tenantId}::uuid, ${hostname}, 'custom',
        -- The first custom domain a site adds becomes its canonical one, so a
        -- site with a domain always has an answer to "which URL is the real one",
        -- which every canonical tag reads through siteUrl. The subquery sees only
        -- this tenant's rows under RLS, so it is "no primary of MINE yet". Later
        -- domains come in secondary, and Make main moves the flag.
        not exists (select 1 from public.domains where is_primary)
      )
      returning ${domainColumns(tx)}
    `;
    return toDomain(rows[0] as Record<string, unknown>);
  });
}

/**
 * Record what the provider said after attaching a domain.
 *
 * One update, so a half-recorded row cannot exist: the provider, its id if it
 * gave one, the challenge to show, and the status all move together. verified_at
 * is stamped the first time a domain goes active and never cleared by a later
 * refresh, so it stays the honest answer to "since when has this been live".
 * Scoped to a custom row within the tenant, so a client only ever updates their
 * own, and never a preview row.
 */
export async function recordDomainProvisioning(
  tenantId: string,
  hostname: string,
  fields: {
    provider?: string | null;
    providerId?: string | null;
    verification?: unknown;
    sslStatus: 'pending' | 'active' | 'failed' | 'deleted';
  },
): Promise<SiteDomain | null> {
  const host = normaliseHostname(hostname);
  if (!host) return null;

  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      update public.domains set
        provider = ${fields.provider ?? 'vercel'},
        provider_id = coalesce(${fields.providerId ?? null}, provider_id),
        verification = ${tx.json((fields.verification ?? []) as never)},
        ssl_status = ${fields.sslStatus},
        verified_at = case
          when ${fields.sslStatus} = 'active' then coalesce(verified_at, now())
          else verified_at
        end
      where hostname = ${host} and kind = 'custom'
      returning ${domainColumns(tx)}
    `;
    return rows.length ? toDomain(rows[0] as Record<string, unknown>) : null;
  });
}

/**
 * Remove a custom domain from a site.
 *
 * Custom only. A preview row is ours and a client deleting theirs would lose the
 * address their site answers on before DNS is pointed. Detaching it from the
 * provider is the action's job; this is the row. Returns whether a row went, so
 * the caller knows a domain was really theirs to remove.
 */
export async function removeDomain(tenantId: string, hostname: string): Promise<boolean> {
  const host = normaliseHostname(hostname);
  if (!host) return false;

  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      delete from public.domains
      where hostname = ${host} and kind = 'custom'
      returning hostname
    `;
    return rows.length > 0;
  });
}

/**
 * Make one domain the canonical address for the site.
 *
 * Two statements in one transaction because the partial unique index allows only
 * one primary per tenant: the old primary has to be cleared before the new one is
 * set, or the index refuses the second row mid-statement. Whether a domain is
 * ready to be canonical is the action's judgement; this just moves the flag.
 */
export async function setPrimaryDomain(tenantId: string, hostname: string): Promise<boolean> {
  const host = normaliseHostname(hostname);
  if (!host) return false;

  return withTenant(tenantId, async (tx) => {
    await tx`update public.domains set is_primary = false where is_primary`;
    const rows = await tx`
      update public.domains set is_primary = true
      where hostname = ${host}
      returning hostname
    `;
    return rows.length > 0;
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
