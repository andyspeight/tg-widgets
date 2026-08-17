/**
 * Turning a stored activity row into the words and the actor a reader sees.
 *
 * PURE, AND FREE OF ANY SERVER IMPORT. The one import is a type, erased at build,
 * so the client panel and a plain-Node test can both use this. The database layer
 * in lib/db/activity.ts records and reads a row; this file shapes what is shown,
 * and it is kept apart from the action so it can be tested without a tenant.
 */

import type { ActivityAction, ActivityEntry } from '../db/activity';

export type { ActivityAction } from '../db/activity';

/**
 * One event as the screen shows it, with the actor resolved to a name rather
 * than the opaque id the row stores.
 */
export interface ActivityLine {
  id: string;
  action: ActivityAction;
  summary: string;
  createdAt: Date;
  /**
   * Who did it, by name or email, or null for an event no current member
   * accounts for: somebody since removed from the site, or an event no person
   * triggered (a later slice's API or scheduled change).
   */
  actor: string | null;
}

/**
 * The member fields resolveActors needs, named rather than the whole Member
 * type so a test can build one without a database row.
 */
interface NamedMember {
  userId: string;
  email: string;
  name: string | null;
}

/**
 * Attach a readable actor to each entry from the site's member list.
 *
 * A name if the person set one, their email if not, and null when the id
 * belongs to nobody currently in the site. Showing an email reveals nothing new:
 * a teammate already sees every member's email on the members screen, and the
 * activity log is scoped to the same people. Pure and separate from the action
 * so it is tested without a tenant.
 */
export function resolveActors(
  entries: ActivityEntry[],
  members: NamedMember[],
): ActivityLine[] {
  const nameById = new Map(members.map((member) => [member.userId, member.name?.trim() || member.email]));
  return entries.map((entry) => ({
    id: entry.id,
    action: entry.action,
    summary: entry.summary,
    createdAt: entry.createdAt,
    actor: entry.actorId ? nameById.get(entry.actorId) ?? null : null,
  }));
}

/**
 * How long ago, in words, for a timeline that is read rather than calculated.
 *
 * Plain UK English: "just now", "5 minutes ago", "3 hours ago", "2 days ago",
 * then a plain date once it is more than a week old, because "23 days ago" is
 * harder to place than the date itself. `now` is a parameter so a test is not at
 * the mercy of the clock, and a time in the future (a clock a little ahead) reads
 * as "just now" rather than as a negative count.
 */
export function relativeTime(value: Date | string | number, now: number = Date.now()): string {
  const then = new Date(value).getTime();
  const seconds = Math.round((now - then) / 1000);

  if (!Number.isFinite(seconds) || seconds < 45) return 'just now';

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;

  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;

  return absoluteDate(value);
}

/** A plain date, the fallback for anything older than a week. */
export function absoluteDate(value: Date | string | number): string {
  return new Date(value).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
