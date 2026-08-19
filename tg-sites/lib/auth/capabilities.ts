/**
 * What the current request is allowed to do, resolved once and checked at every
 * save. This is the server side of lib/auth/permissions.ts: that leaf module
 * holds the vocabulary and the rules, this reaches the database for the pieces
 * the rules need (the member's role, whether they are staff, their stored set)
 * and turns them into a yes or no a server action can gate on.
 *
 * THE RULE THE PROJECT ALREADY STATES. app/actions/*.ts open with "availability
 * gating is enforced at save time on the API, never trusted to the client". Until
 * now that held only for owner-or-staff things (code, domains, members); every
 * content, structure, theme, page and settings save was open to any member.
 * requireCapability is what finally makes the finer gates real, at the save.
 */

import 'server-only';

import { currentUser, currentUserId, requireSite } from './session';
import { isStaffEmail } from './staff';
import { effectiveCapabilities, type Capability } from './permissions';
import { memberPermissions } from '../db/members';

/** A save refused because the member lacks the capability, told apart from a bug. */
export class PermissionError extends Error {
  readonly permissionDenied = true;
  constructor(
    readonly capability: Capability,
    message = 'You do not have permission to do that on this site.',
  ) {
    super(message);
    this.name = 'PermissionError';
  }
}

export function isPermissionError(error: unknown): error is PermissionError {
  return error instanceof Error && (error as PermissionError).permissionDenied === true;
}

export interface CurrentCapabilities {
  tenantId: string;
  userId: string;
  caps: Set<Capability>;
}

/**
 * The capabilities the signed-in person has in the site they are working on.
 *
 * Resolves the active site (which fails closed for a non-member), the person's
 * email (so staff bypass the per-member set) and their stored set, then hands the
 * three to effectiveCapabilities. A staff member never needs the stored read.
 */
export async function currentCapabilities(): Promise<CurrentCapabilities> {
  const site = await requireSite();
  const userId = (await currentUserId()) ?? '';
  const user = await currentUser();
  const staff = isStaffEmail(user?.email);
  const stored = staff ? null : await memberPermissions(site.tenantId, userId);

  return {
    tenantId: site.tenantId,
    userId,
    caps: effectiveCapabilities({ role: site.role, staff, stored }),
  };
}

/**
 * The tenant id, but only if the caller may do `capability` here. Throws a
 * PermissionError otherwise. Shaped to drop in where an action currently calls
 * requireTenantId, so a gated action reads `const tenantId = await
 * requireCapability('theme')` and is scoped and gated in one line.
 */
export async function requireCapability(capability: Capability): Promise<string> {
  const { tenantId, caps } = await currentCapabilities();
  if (!caps.has(capability)) throw new PermissionError(capability);
  return tenantId;
}
