/**
 * THIS FILE IS A PLACEHOLDER FOR AUTHENTICATION. DELETE IT WHEN AUTH LANDS.
 *
 * The editor has to know which tenant it is editing. After auth that comes
 * from the signed-in user and the tenant_users table. Until then there is no
 * user, so there is nothing to check, and anyone who can reach the editor can
 * open any site in the database.
 *
 * That is an acceptable state for a shell with one demo tenant in it. It is
 * not an acceptable state to forget about, so this module deliberately makes
 * it loud: the same file that grants the access also supplies the banner text
 * that admits to it, and the editor renders that banner from here. You cannot
 * quietly keep the open door and drop the sign that says the door is open.
 *
 * WHAT AUTH REPLACES
 *   - listAvailableTenants   becomes "the tenants this user belongs to"
 *   - assertMayEdit          becomes a real tenant_users lookup
 *   - the banner             goes away entirely
 */

/**
 * True while there is no sign-in. Auth work flips this to false, at which
 * point the type checker will point at everything that has to change.
 */
export const AUTH_IS_NOT_BUILT_YET = true;

/** Shown at the top of every editor screen while the above is true. */
export const OPEN_ACCESS_WARNING =
  'No sign in yet. Anyone with this link can edit these pages.';

/**
 * Whether the current request may edit this tenant.
 *
 * Always yes for now, and written as a function rather than inlined so that
 * the call sites are already in the right places when it starts saying no.
 */
export function mayEdit(_tenantId: string, _userId?: string): boolean {
  return AUTH_IS_NOT_BUILT_YET;
}

/**
 * Who made a change, for the updated_by and publish_events columns.
 *
 * Null rather than a made-up value. A publish log that says "system" for
 * every entry is worse than one that honestly says it does not know, because
 * the first looks like an answer.
 */
export function currentUserId(): string | null {
  return null;
}
