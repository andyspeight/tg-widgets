'use server';

/**
 * Saving site settings.
 *
 * TWO ACTIONS, AND THE SECOND ONE IS THE WHOLE POINT
 *
 * saveSettingsAction is for any member of a site: analytics ids, icons, the social
 * image, the language. saveCustomCodeAction is for head and body HTML and checks
 * that the caller is the site's OWNER or Travelgenix staff.
 *
 * Owner, not staff-only. Andy reversed that on 30 Jul 2026 and was right to: Wix,
 * Squarespace, Duda and WordPress all let a site owner inject code, and a platform
 * that makes an agency raise a ticket to add a chat widget is a platform they will
 * resent. An editor or a viewer still cannot, because the blast radius of a mistake
 * here is the whole site and the person who owns it should be the one carrying it.
 *
 * THE CHECK IS HERE, NOT IN THE UI. Hiding a panel is a courtesy to the person
 * looking at the screen and no obstacle at all to anybody calling the action
 * directly, which for a server action means anybody who can read the page's
 * JavaScript. Every server action is a public endpoint; the only difference from a
 * route handler is that Next generates the URL. So the gate is a refusal in the
 * action, and the hidden panel is decoration on top of it.
 *
 * There is a third thing keeping these apart, underneath both: they write different
 * COLUMNS, and lib/db/settings.ts names the column in each query. So even a
 * confused caller reaching the wrong function writes the wrong column rather than
 * the wrong field.
 */

import { revalidatePath } from 'next/cache';

import {
  currentUser,
  isSignInRequired,
  requireSite,
  requireTenantId,
} from '../../lib/auth/session';
import { isStaffEmail } from '../../lib/auth/staff';
import {
  getSettings,
  getStaffSettings,
  saveSettings,
  saveStaffSettings,
} from '../../lib/db/settings';
import {
  parseSettings,
  parseStaffSettings,
  type SiteSettings,
  type StaffSettings,
} from '../../lib/settings/schema';

export type SettingsResult<T> = { ok: true; data: T } | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Client-editable
// ---------------------------------------------------------------------------

export async function saveSettingsAction(
  input: unknown,
): Promise<SettingsResult<SiteSettings>> {
  try {
    const tenantId = await requireTenantId();

    /*
     * Parsed before it goes anywhere near the database.
     *
     * The argument is whatever arrived over the wire. parseSettings is total and
     * keeps only the six fields it knows about, so a payload carrying headHtml
     * loses it here, before saveSettings is called, before the column is named.
     * Three independent reasons the same attempt fails, which is what defence in
     * depth is supposed to look like.
     */
    const saved = await saveSettings(tenantId, parseSettings(input));

    /*
     * Every page of the site, because these settings are in the head of all of
     * them. A favicon change that only took effect on the page you happened to
     * reload would read as not having saved.
     */
    revalidatePath('/', 'layout');
    return { ok: true, data: saved };
  } catch (error) {
    return { ok: false, error: explain(error, 'Could not save those settings.') };
  }
}

// ---------------------------------------------------------------------------
// Staff only
// ---------------------------------------------------------------------------

/**
 * The gate on custom code, in one place, used by both the read and the write.
 *
 * OWNER OR STAFF. An editor or a viewer is refused: this field runs on every page
 * of a live site, so it belongs to whoever answers for the site rather than to
 * everybody who can change a heading.
 *
 * Returns who it was rather than a boolean, so the caller can log it. A throw
 * rather than a false, because every caller's correct response is to stop and a
 * boolean is something a caller can forget to check.
 */
async function requireCodeAccess(): Promise<{ email: string; tenantId: string; as: string }> {
  const user = await currentUser();
  if (!user) throw new Error('Your session has ended. Sign in again to carry on.');

  const site = await requireSite();
  const staff = isStaffEmail(user.email);

  if (site.role !== 'owner' && !staff) {
    /*
     * The same message whether they are an editor, a viewer, or not a member at
     * all. Somebody probing this should not learn which, and somebody who reached
     * it by accident does not need the distinction.
     */
    throw new Error('Only the site owner can change the custom code.');
  }

  return { email: user.email, tenantId: site.tenantId, as: staff ? 'staff' : site.role };
}

/**
 * Read the custom code.
 *
 * Gated as well as the write, because head HTML can contain an API key for whatever
 * it was pasted to load. An editor being shown it is a smaller problem than an
 * editor changing it, and still a real one.
 */
export async function loadCustomCodeAction(): Promise<SettingsResult<StaffSettings>> {
  try {
    const { tenantId } = await requireCodeAccess();
    return { ok: true, data: await getStaffSettings(tenantId) };
  } catch (error) {
    return { ok: false, error: explain(error, 'Could not read those settings.') };
  }
}

export async function saveCustomCodeAction(
  input: unknown,
): Promise<SettingsResult<StaffSettings>> {
  try {
    const { email, tenantId, as } = await requireCodeAccess();

    const saved = await saveStaffSettings(tenantId, parseStaffSettings(input));

    /*
     * Logged, deliberately.
     *
     * This is the one field in the product that puts arbitrary script on a live
     * client site. If a site ever starts doing something nobody expects, the first
     * question is when this last changed and who changed it, and an answer that
     * exists only in somebody's memory is not an answer. A proper audit row is
     * owed and is noted in the handover; a log line is what there is today and is
     * better than nothing.
     */
    console.log(
      `[tg-sites] custom code changed tenant=${tenantId} by=${email} as=${as} ` +
        `head=${saved.headHtml.length}b body=${saved.bodyHtml.length}b`,
    );

    revalidatePath('/', 'layout');
    return { ok: true, data: saved };
  } catch (error) {
    return { ok: false, error: explain(error, 'Could not save those settings.') };
  }
}

// ---------------------------------------------------------------------------

/** So a screen can show the current values without a second round trip. */
export async function loadSettingsAction(): Promise<
  SettingsResult<{ settings: SiteSettings; canEditCode: boolean }>
> {
  try {
    const tenantId = await requireTenantId();
    const user = await currentUser();

    return {
      ok: true,
      data: {
        settings: await getSettings(tenantId),
        // Answered by the server, never by the client. The screen uses it to decide
        // what to draw; the actions decide for themselves whether to obey.
        canEditCode: (await requireSite()).role === 'owner' || isStaffEmail(user?.email),
      },
    };
  } catch (error) {
    return { ok: false, error: explain(error, 'Could not read those settings.') };
  }
}

function explain(error: unknown, generic: string): string {
  const message = error instanceof Error ? error.message : String(error);

  if (isSignInRequired(error)) return message;
  if (message.startsWith('Your session has ended')) return message;
  if (message.startsWith('This account is not a member')) return message;
  if (message.startsWith('Only the site owner')) return message;

  console.error('[tg-sites] settings action failed', error);
  return generic;
}
