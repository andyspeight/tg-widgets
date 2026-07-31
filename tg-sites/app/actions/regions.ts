'use server';

/**
 * What the editor may ask the database to do with a header or a footer.
 *
 * The same two rules as app/actions/pages.ts, and for the same reason: a server
 * action is a public HTTP endpoint with a nice syntax, so anybody can call these
 * with any arguments they like.
 *
 *   1. THE TENANT IS NEVER AN ARGUMENT. It comes from the session, server side.
 *   2. Everything else from the caller is a guess, and the query runs inside
 *      withTenant, so a guess matches nothing rather than matching somebody
 *      else's site.
 *
 * The one argument that IS from the caller is which region, and it is checked
 * here rather than trusted: `region` reaches a SQL parameter and a primary key,
 * so it is compared against the two names the schema knows and refused
 * otherwise. The database's check constraint would refuse a third name anyway;
 * this turns that into a sentence somebody can read.
 */

import { revalidatePath } from 'next/cache';

import { currentUserId, requireTenantId } from '../../lib/auth/session';
import { REGIONS, type RegionName } from '../../lib/content/schema';
import {
  getRegion,
  publishRegion,
  saveRegionDraft,
  type RegionRecord,
} from '../../lib/db/regions';
import type { ActionResult } from './pages';

async function attempt<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    return { ok: false, error: explain(error) };
  }
}

function explain(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  // Worth showing as written: one needs an invitation, one needs signing in
  // again, and one names the part of the content that would not parse.
  if (message.startsWith('This account is not a member')) return message;
  if (message.startsWith('Your session has ended')) return message;
  if (message.startsWith('Refusing to save')) return message;
  if (message.startsWith('That is not')) return message;

  console.error('[tg-sites] region action failed', error);
  return 'Something went wrong saving that. Nothing was changed.';
}

/** The caller's idea of which region, turned into one of the two real ones. */
function asRegionName(value: unknown): RegionName {
  if (typeof value === 'string' && (REGIONS as readonly string[]).includes(value)) {
    return value as RegionName;
  }
  throw new Error('That is not a part of the site you can edit.');
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getRegionAction(region: string): Promise<ActionResult<RegionRecord>> {
  return attempt(async () => getRegion(await requireTenantId(), asRegionName(region)));
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Save the draft.
 *
 * `content` arrives from the browser and is treated as hostile: saveRegionDraft
 * parses it against the schema, normalises the column widths and runs the whole
 * tree through the sanitiser before a byte of it reaches the database.
 */
export async function saveRegionAction(
  region: string,
  content: unknown,
): Promise<ActionResult<RegionRecord>> {
  return attempt(async () =>
    saveRegionDraft(
      await requireTenantId(),
      asRegionName(region),
      content,
      (await currentUserId()) ?? undefined,
    ),
  );
}

/**
 * Publish.
 *
 * REVALIDATES MORE THAN A PAGE PUBLISH DOES, because it changes more. A page
 * publish rebuilds that page. A header publish changes the furniture on every
 * URL the site has, so the whole preview tree is dropped rather than one path.
 */
export async function publishRegionAction(region: string): Promise<ActionResult<RegionRecord>> {
  const result = await attempt(async () =>
    publishRegion(
      await requireTenantId(),
      asRegionName(region),
      (await currentUserId()) ?? undefined,
    ),
  );

  if (result.ok) {
    revalidatePath('/sites');
    revalidatePath('/preview', 'layout');
  }
  return result;
}
