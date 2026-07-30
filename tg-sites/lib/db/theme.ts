/**
 * Reading and writing a tenant's theme.
 *
 * One jsonb column, `tenants.theme`, which has existed and been empty since the
 * schema was written. Everything goes through withTenant, so the policy is what
 * limits it to one row and there is no WHERE clause here to get wrong.
 */

import 'server-only';

import { parseTheme, ThemeSchema, type Theme } from '../theme/schema';
import { withTenant, withPublicTenant, type Tx } from './withTenant';

/**
 * jsonb, as an object, whatever shape it arrives in.
 *
 * Same guard as pages.ts and tenants.ts, and for the same reason: a jsonb value
 * written with JSON.stringify instead of the driver's json() comes back double
 * encoded. That bug lost a page's content once already, so every jsonb read in
 * this codebase tolerates it rather than trusting that it cannot happen again.
 */
function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string') {
    try {
      return asObject(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return {};
}

/**
 * The driver's json() wrapper, with the one cast it needs.
 *
 * Same helper as lib/db/pages.ts, for the same reason: postgres types the
 * parameter as an index-signature shape and TypeScript will not accept a
 * concrete interface as one, even when every value inside it is plain JSON.
 */
function json(tx: Tx, value: unknown) {
  return tx.json(value as Parameters<Tx['json']>[0]);
}

async function read(tx: Tx): Promise<Theme> {
  // No WHERE. The policy on `tenants` is `id = current_tenant()`, so this table
  // has exactly one visible row inside a scoped transaction.
  const rows = await tx`select theme from public.tenants limit 1`;
  return parseTheme(rows.length ? asObject(rows[0].theme) : {});
}

/** The theme for the editor and the dashboard. */
export function getTheme(tenantId: string): Promise<Theme> {
  return withTenant(tenantId, read);
}

/**
 * The theme for a published page, read through the read-only role.
 *
 * Separate from getTheme rather than a parameter, so a visitor-triggered render
 * cannot accidentally be given the read-write connection. Same reason
 * withPublicTenant exists at all.
 */
export function getPublicTheme(tenantId: string): Promise<Theme> {
  return withPublicTenant(tenantId, read);
}

/**
 * Save a theme, and return what was actually stored.
 *
 * Validated here as well as in the action, because this is the last place
 * before the database and the action is not the only thing that could call it.
 * The value written is the PARSED theme, never the caller's object, so a client
 * cannot smuggle an extra key into the column and cannot store a colour in a
 * notation the renderer would then have to handle.
 */
export async function saveTheme(tenantId: string, input: unknown): Promise<Theme> {
  const theme = parseTheme(input);

  return withTenant(tenantId, async (tx) => {
    /*
     * tx.json(), not JSON.stringify.
     *
     * The driver wraps the value so Postgres receives it as jsonb. Stringifying
     * first sends a jsonb STRING containing JSON, which reads back as a quoted
     * blob rather than an object. That is exactly how draft_content was lost
     * on 29 Jul, and the cast is here so this one is written the right way.
     */
    const rows = await tx`
      update public.tenants
      set theme = ${json(tx, theme)}
      returning theme
    `;

    // Read back rather than returning the input. If a policy silently matched
    // no row the answer should be the truth, not an echo of what was asked for.
    return rows.length ? parseTheme(asObject(rows[0].theme)) : ThemeSchema.parse(theme);
  });
}
