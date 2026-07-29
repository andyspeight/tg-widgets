import 'server-only';

/**
 * Which tenant is this request editing.
 *
 * TWO DIFFERENT QUESTIONS, DELIBERATELY KEPT APART
 *
 *   The public website asks "what tenant owns this hostname". That is
 *   resolveTenantByHostname, and it is the finished article.
 *
 *   The editor asks "what tenant is this person working on". That is a
 *   session question, and there is no session yet. This module is the
 *   stand-in, and it is built in the shape the real answer will have.
 *
 * HOW IT WORKS, AND WHY IT IS NOT A HACK
 *
 * A workspace is chosen by slug and remembered in a cookie. The slug is
 * turned into a tenant id by resolve_tenant, the same SECURITY DEFINER
 * function the public renderer uses, via the staging hostname every tenant
 * always has.
 *
 * The tempting alternative was a second privileged function that lists every
 * tenant so the picker could show a dropdown. That was refused: the isolation
 * suite asserts there is exactly ONE function in the database that sees past
 * row level security, and that assertion is worth more than a dropdown.
 *
 * Listing the tenants a person belongs to is properly answered by auth, not
 * by a privileged read. When it lands, `tenant_users` gains a policy keyed on
 * the user rather than the tenant, and the list falls out of an ordinary
 * query with no special powers at all.
 */

import { cookies } from 'next/headers';

import { resolveTenantByHostname, STAGING_SUFFIX } from './db/tenants';

const COOKIE = 'tgs_workspace';

/** Where the editor starts before anyone has chosen anything. */
export const DEFAULT_WORKSPACE = 'demo';

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: 60 * 60 * 24 * 30,
} as const;

/**
 * A workspace slug, or null.
 *
 * Same rules as a tenant slug in the database, checked here as well so a
 * cookie someone has hand edited never reaches a query.
 */
export function normaliseWorkspace(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const slug = value.trim().toLowerCase();
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return null;
  if (slug.length < 2 || slug.length > 63) return null;
  return slug;
}

/** The workspace slug this browser last chose. */
export async function currentWorkspace(): Promise<string> {
  const store = await cookies();
  return normaliseWorkspace(store.get(COOKIE)?.value) ?? DEFAULT_WORKSPACE;
}

/**
 * The tenant id for this request, or null if the workspace does not exist.
 *
 * Null is a real answer, not an error: a cookie can outlive the tenant it
 * points at, and the caller should offer the picker rather than crash.
 */
export async function currentTenantId(): Promise<string | null> {
  return resolveTenantByHostname(`${await currentWorkspace()}${STAGING_SUFFIX}`, 'app');
}

/**
 * Same, but throws.
 *
 * For server actions, where there is no sensible way to render a picker and
 * a null tenant would otherwise silently return zero rows and look like an
 * empty site.
 */
export async function requireTenantId(): Promise<string> {
  const tenantId = await currentTenantId();
  if (!tenantId) {
    throw new Error(
      `No workspace called "${await currentWorkspace()}". Pick one at /sites.`,
    );
  }
  return tenantId;
}

/**
 * Switch workspace. Returns false if no such tenant exists, in which case
 * the cookie is left alone.
 */
export async function chooseWorkspace(value: unknown): Promise<boolean> {
  const slug = normaliseWorkspace(value);
  if (!slug) return false;

  const tenantId = await resolveTenantByHostname(`${slug}${STAGING_SUFFIX}`, 'app');
  if (!tenantId) return false;

  (await cookies()).set(COOKIE, slug, COOKIE_OPTIONS);
  return true;
}
