'use server';

/**
 * Site-level operations: making a new one, and duplicating one.
 *
 * STAFF ONLY, AND THE GATE IS HERE. Creating a site is a Travelgenix job, not
 * something a client or an editor does, so the check is isStaffEmail, the same
 * gate the custom code and domains panels use. It is enforced in the action, not
 * on the screen: a server action is a public endpoint whose URL is in the page's
 * own JavaScript, so a button drawn for staff only is a courtesy and the refusal
 * is the control. Same lesson as app/actions/members.ts.
 */

import { revalidatePath } from 'next/cache';

import { chooseSite, currentUser, requireTenantId } from '../../lib/auth/session';
import { isStaffEmail } from '../../lib/auth/staff';
import { duplicateSite } from '../../lib/db/duplicate';
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
  if (!isStaffEmail(user.email)) throw new Error('Only Travelgenix staff can do that.');
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

/**
 * Duplicate the site the caller is in, as a new draft, and switch to it.
 *
 * THE SOURCE IS THE ACTIVE SITE, taken from the session and never from the
 * caller: requireTenantId resolves the site this person is signed into, so staff
 * can only duplicate a site they are already in, and a forged id in the request
 * body has nowhere to land. The name is the only input, defaulted by the screen
 * to "<source> copy" and editable there; everything else, the deep copy and its
 * order, is duplicateSite's job.
 *
 * This is the slow one. It copies every image object, so for an image-heavy site
 * it runs for several seconds; app/sites/page.tsx raises the function's time
 * limit for exactly this call.
 */
export async function duplicateSiteAction(input: {
  name: unknown;
}): Promise<SiteResult<{ slug: string; name: string }>> {
  try {
    const user = await requireStaff();

    const name = String(input?.name ?? '').trim();
    if (!name) return { ok: false, error: 'Give the copy a name.' };

    const source = await requireTenantId();
    const clone = await duplicateSite(source, user.id, name.slice(0, 200));

    // The maker becomes the clone, so the reload lands on it rather than on the
    // site it was copied from. createTenant made them its owner, so this takes.
    await chooseSite(clone.slug);
    revalidatePath('/sites');

    return { ok: true, data: { slug: clone.slug, name: clone.name } };
  } catch (error) {
    return { ok: false, error: explain(error) };
  }
}

function explain(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  // The two worth showing as written. Anything else stays generic on purpose.
  if (message.startsWith('Your session has ended')) return message;
  if (message.startsWith('Only Travelgenix staff')) return message;

  console.error('[tg-sites] site action failed', error);
  return 'That did not work. Reload the page and try again.';
}
