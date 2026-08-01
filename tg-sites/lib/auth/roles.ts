/**
 * What somebody is allowed to do in a site.
 *
 * A LEAF MODULE WITH NO IMPORTS, deliberately, and the reason is a build error
 * rather than tidiness. These three words are needed in two places that cannot
 * share code any other way: lib/db/members.ts, which is `server-only` because it
 * holds queries, and the members screen, which is a client component. Reading
 * the list from the query layer made the whole database module part of the
 * browser bundle's import graph, and Next refused to compile it. Correctly.
 *
 * The same shape as lib/domains/preview.ts, which is a leaf for the same class
 * of reason: middleware cannot import anything that drags a driver in with it.
 *
 * THE THREE MATCH A CHECK CONSTRAINT on tenant_users.role, written in 0002.
 * A fourth here without one there is a value the database refuses at save time
 * with an error nobody can read, so tests/members.test.ts holds the two lists
 * against each other.
 */

export const MEMBER_ROLES = ['owner', 'editor', 'viewer'] as const;

export type MemberRole = (typeof MEMBER_ROLES)[number];

export function isMemberRole(value: unknown): value is MemberRole {
  return typeof value === 'string' && (MEMBER_ROLES as readonly string[]).includes(value);
}

/**
 * What each one actually lets somebody do, in words a travel agent uses.
 *
 * Here rather than in the screen because two screens now say it: the members
 * list against each person, and the invite form under the picker. Two copies is
 * two things to keep in step, and the one that drifts is the one nobody is
 * looking at.
 */
export const ROLE_NOTES: Record<MemberRole, string> = {
  owner: 'Everything, including who else is in here and the custom code',
  editor: 'Make and publish pages, change the theme and the settings',
  viewer: 'Look at everything and change nothing',
};
