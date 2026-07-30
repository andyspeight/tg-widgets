/**
 * Reading and writing site settings.
 *
 * Two jsonb columns on `tenants`, and the split between them is the security
 * model rather than tidiness. See db/migrations/0012_site_settings.sql.
 *
 * THE RULE THIS FILE EXISTS TO KEEP: there is exactly ONE function that writes
 * staff_settings, it is named for what it is, and no client-reachable action calls
 * it. Everything else writes `settings` and names that column in its SQL, so a
 * client's save has no path to the other one even if a caller is confused.
 *
 * Everything goes through withTenant or withPublicTenant, so the policies do the
 * scoping and there is no WHERE tenant_id here to get wrong.
 */

import 'server-only';

import {
  parseSettings,
  parseStaffSettings,
  type SiteSettings,
  type StaffSettings,
} from '../settings/schema';
import { withPublicTenant, withTenant, type Tx } from './withTenant';

/**
 * What a rendered page needs: both shapes, together.
 *
 * The WRITE paths are what must stay apart. A page being rendered needs the
 * client's analytics id and the staff's head HTML in the same breath, and keeping
 * them separate here would mean two reads and a merge at every call site.
 */
export type PublicSiteSettings = SiteSettings & StaffSettings;

/** Same helper as every other jsonb write here, with the one cast it needs. */
function json(tx: Tx, value: unknown) {
  return tx.json(value as Parameters<Tx['json']>[0]);
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** The client-editable settings, for the settings screen. */
export async function getSettings(tenantId: string): Promise<SiteSettings> {
  return withTenant(tenantId, async (tx) => {
    // No WHERE. The policy on `tenants` is `id = current_tenant()`, so a scoped
    // transaction sees exactly one row.
    const rows = await tx`select settings from public.tenants limit 1`;
    return parseSettings(rows[0]?.settings);
  });
}

/**
 * The staff-only settings.
 *
 * Named so that a call to it is obvious in a diff. There is no version of this
 * that a client-reachable action should be calling, and the name is the last line
 * of defence after the column split.
 */
export async function getStaffSettings(tenantId: string): Promise<StaffSettings> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`select staff_settings from public.tenants limit 1`;
    return parseStaffSettings(rows[0]?.staff_settings);
  });
}

/**
 * Everything a published page needs, through the READ-ONLY role.
 *
 * One query for both columns, because a visitor is waiting and two round trips to
 * eu-west-2 to assemble one head section would be two too many.
 */
export async function getPublicSettings(tenantId: string): Promise<PublicSiteSettings> {
  return withPublicTenant(tenantId, async (tx) => {
    const rows = await tx`select settings, staff_settings from public.tenants limit 1`;
    return {
      ...parseSettings(rows[0]?.settings),
      ...parseStaffSettings(rows[0]?.staff_settings),
    };
  });
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/**
 * Save the client-editable settings.
 *
 * Names `settings` in the SQL and nothing else, so this cannot touch head or body
 * HTML however it is called. Parsed on the way in as well as on the way out: the
 * caller is a server action holding whatever arrived over the wire, and the column
 * should never contain a shape the reader would have to defend against.
 */
export async function saveSettings(
  tenantId: string,
  settings: SiteSettings,
): Promise<SiteSettings> {
  const clean = parseSettings(settings);

  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      update public.tenants set settings = ${json(tx, clean)} returning settings
    `;
    return parseSettings(rows[0]?.settings);
  });
}

/**
 * Save the staff-only settings.
 *
 * THE ONLY FUNCTION IN THIS CODEBASE THAT WRITES staff_settings. The staff check
 * lives in the action that calls it, because that is where the session is; this
 * function's contribution is being the single, findable place, so "who can set head
 * HTML" is answered by looking at its callers rather than by auditing a whole
 * screen.
 */
export async function saveStaffSettings(
  tenantId: string,
  settings: StaffSettings,
): Promise<StaffSettings> {
  const clean = parseStaffSettings(settings);

  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      update public.tenants set staff_settings = ${json(tx, clean)} returning staff_settings
    `;
    return parseStaffSettings(rows[0]?.staff_settings);
  });
}
