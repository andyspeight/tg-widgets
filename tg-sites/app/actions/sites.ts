'use server';

/**
 * Site-level operations: making a new one, and, in a later slice, duplicating
 * one.
 *
 * STAFF ONLY, AND THE GATE IS HERE. Creating a site is a Travelgenix job, not
 * something a client or an editor does, so the check is isStaffEmail, the same
 * gate the custom code and domains panels use. It is enforced in the action, not
 * on the screen: a server action is a public endpoint whose URL is in the page's
 * own JavaScript, so a button drawn for staff only is a courtesy and the refusal
 * is the control. Same lesson as app/actions/members.ts.
 */

import { revalidatePath } from 'next/cache';

import { chooseSite, currentUser } from '../../lib/auth/session';
import { isStaffEmail } from '../../lib/auth/staff';
import { createTenant } from '../../lib/db/tenants';

export type SiteResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/**
 * The signed-in person, but only if they are staff.
 *
 * Throws rather than returning a flag, so a caller that forgets to check gets an
 * exception instead of carrying on with a falsy value.
 */
async function requireStaff() {
  const user = await currentUser();
  if (!user) throw new Error('Your session has ended. Sign in again to carry on.');
  if (!isStaffEmail(user.email)) throw new Error('Only Travelgenix staff can create a site.');
  return user;
}

/**
 * Make a new, empty site and switch to it.
 *
 * The name is the only thing a caller supplies; the address is derived and made
 * unique by createTenant. The new site is remembered as the active one before we
 * return, so the reload the client does lands on it rather than on whatever site
 * they were looking at.
 */
export async function createSiteAction(input: {
  name: unknown;
}): Promise<SiteResult<{ slug: string; name: string }>> {
  try {
    const user = await requireStaff();

    const name = String(input?.name ?? '').trim();
    if (!name) return { ok: false, error: 'Give the new site a name.' };

    const tenant = await createTenant({ name: name.slice(0, 200) }, user.id);

    // The creator becomes the site they just made. chooseSite checks the
    // membership first, and createTenant made them its owner a moment ago, so
    // this always takes.
    await chooseSite(tenant.slug);
    revalidatePath('/sites');

    return { ok: true, data: { slug: tenant.slug, name: tenant.name } };
  } catch (error) {
    return { ok: false, error: explain(error) };
  }
}

function explain(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  // The two worth showing as written. Anything else stays generic on purpose.
  if (message.startsWith('Your session has ended')) return message;
  if (message.startsWith('Only Travelgenix staff')) return message;

  console.error('[tg-sites] createSite failed', error);
  return 'That did not work. Reload the page and try again.';
}
