'use server';

/**
 * A site's own domains: adding one, checking it, removing it, choosing which is
 * canonical.
 *
 * OWNER OR STAFF, THE SAME GATE AS CUSTOM CODE, and for a stronger version of the
 * same reason. Custom code is arbitrary script on one site; a domain attaches a
 * hostname to our shared Vercel project and points a client's public web address
 * at us. That is not something an editor who can change a heading should be able
 * to do, so the check is requireDomainAccess and it is a refusal in the action,
 * not a hidden button. Every server action is a public endpoint; the UI hiding
 * the tab is a courtesy on top of the gate, never the gate itself. Same lesson as
 * app/actions/settings.ts.
 *
 * THE PROVIDER LIVES BEHIND ONE FILE. Nothing here talks to Vercel directly; it
 * calls lib/domains/vercel.ts, which is the only place api.vercel.com is reached.
 * When the token is not set yet (the deliberate "build first, wire it later"
 * state) adding a domain still records the row, so the resolver and the render
 * path are ready, and checking a domain says plainly that hosting is not
 * connected rather than failing in a way nobody can act on.
 */

import { revalidatePath } from 'next/cache';

import { currentUser, isSignInRequired, requireSite } from '../../lib/auth/session';
import { isStaffEmail } from '../../lib/auth/staff';
import {
  addDomain,
  forgetHostname,
  getTenant,
  listDomains,
  recordDomainProvisioning,
  removeDomain,
  setPrimaryDomain,
  type SiteDomain,
} from '../../lib/db/tenants';
import { previewHostname } from '../../lib/domains/preview';
import {
  attachDomain,
  detachDomain,
  getDomainConfig,
  vercelConfigured,
} from '../../lib/domains/vercel';

export type DomainResult<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * The gate, in one place, used by every action here.
 *
 * Owner or staff. An editor or a viewer is refused with a message that does not
 * say which they are, so probing it teaches nothing. A throw rather than a
 * boolean, because every caller's right response to a refusal is to stop.
 */
async function requireDomainAccess(): Promise<{ tenantId: string; email: string; as: string }> {
  const user = await currentUser();
  if (!user) throw new Error('Your session has ended. Sign in again to carry on.');

  const site = await requireSite();
  const staff = isStaffEmail(user.email);

  if (site.role !== 'owner' && !staff) {
    throw new Error('Only the site owner can change the site domains.');
  }

  return { tenantId: site.tenantId, email: user.email, as: staff ? 'staff' : site.role };
}

/**
 * Bring a domain into step with the provider.
 *
 * The same call whether a domain is brand new or being re-checked: attachDomain
 * is idempotent (a domain already on the project comes back as its current
 * state, not an error), so this both adds and refreshes. Active only when Vercel
 * says the domain is verified AND its DNS is not misconfigured, which is exactly
 * when the certificate issues. Anything short of that stays pending with the
 * reason kept in the row's verification.
 */
async function syncWithVercel(tenantId: string, hostname: string): Promise<SiteDomain | null> {
  const { verified, verification } = await attachDomain(hostname);
  const { misconfigured } = await getDomainConfig(hostname);
  const sslStatus = verified && !misconfigured ? 'active' : 'pending';
  return recordDomainProvisioning(tenantId, hostname, {
    provider: 'vercel',
    verification,
    sslStatus,
  });
}

/** Everything the domains screen draws in one read. */
export interface DomainsView {
  domains: SiteDomain[];
  /** Whether hosting is switched on. False means the token is not set yet, so the
   *  screen can say a domain will finish connecting later rather than offer a
   *  Check that cannot work. */
  hostingConnected: boolean;
  /** The free address the site always answers on, shown as the fallback. */
  previewUrl: string;
}

export async function listDomainsAction(): Promise<DomainResult<DomainsView>> {
  try {
    const { tenantId } = await requireDomainAccess();
    const [domains, tenant] = await Promise.all([listDomains(tenantId), getTenant(tenantId)]);
    const previewUrl = tenant ? `https://${previewHostname(tenant.slug) ?? tenant.slug}` : '';
    return {
      ok: true,
      data: { domains, hostingConnected: vercelConfigured(), previewUrl },
    };
  } catch (error) {
    return { ok: false, error: explain(error, 'Could not read the domains.') };
  }
}

/**
 * Add a domain the client owns.
 *
 * The row goes in first, whatever the provider does next. It is what makes the
 * site resolve on that hostname, and it fails fast and locally on a domain that
 * is already taken or is one of ours. Then, if hosting is connected, the domain
 * is attached to the project and what Vercel said is recorded; if that step
 * fails, the row stays as pending rather than being lost, and the client can
 * check it again once DNS is sorted.
 */
export async function addDomainAction(hostname: string): Promise<DomainResult<SiteDomain>> {
  try {
    const { tenantId } = await requireDomainAccess();

    const created = await addDomain(tenantId, hostname);
    // The row exists now, so the resolver should stop remembering there was no
    // such host. Cheap, and it means a visitor sees the site the moment DNS lands.
    forgetHostname(created.hostname);

    let domain = created;
    if (vercelConfigured()) {
      try {
        domain = (await syncWithVercel(tenantId, created.hostname)) ?? created;
      } catch (error) {
        // Keep the pending row. A provider hiccup on add is not worth throwing
        // away a domain the client just typed; Check will retry it.
        console.error('[tg-sites] domain attach failed', created.hostname, error);
      }
    }

    revalidatePath('/settings');
    revalidatePath('/', 'layout');
    return { ok: true, data: domain };
  } catch (error) {
    return { ok: false, error: explain(error, 'Could not add that domain.') };
  }
}

/**
 * Check where a domain stands and record it.
 *
 * This is the button a client presses after setting their DNS. It re-asks the
 * provider and writes the answer, so a domain flips from pending to active on its
 * own once the records are right and the certificate has issued.
 */
export async function refreshDomainAction(hostname: string): Promise<DomainResult<SiteDomain | null>> {
  try {
    const { tenantId } = await requireDomainAccess();

    if (!vercelConfigured()) {
      throw new Error(
        'Domain hosting is not connected yet, so we cannot check that domain. ' +
          'Add a VERCEL_API_TOKEN in Vercel and it will start working.',
      );
    }

    const updated = await syncWithVercel(tenantId, hostname);
    forgetHostname(hostname);

    revalidatePath('/settings');
    revalidatePath('/', 'layout');
    return { ok: true, data: updated };
  } catch (error) {
    return { ok: false, error: explain(error, 'Could not check that domain.') };
  }
}

/**
 * Remove a domain from a site.
 *
 * The row is the thing that decides whether the site answers on that hostname, so
 * it is removed whatever the provider does. Detaching from Vercel is attempted
 * first and allowed to fail quietly: an attachment left behind on the project is
 * tidy-up, while a row left behind is a client's address still pointing at a site
 * we no longer mean to serve there.
 */
export async function removeDomainAction(hostname: string): Promise<DomainResult<boolean>> {
  try {
    const { tenantId } = await requireDomainAccess();

    if (vercelConfigured()) {
      try {
        await detachDomain(hostname);
      } catch (error) {
        console.error('[tg-sites] domain detach failed', hostname, error);
      }
    }

    const removed = await removeDomain(tenantId, hostname);
    forgetHostname(hostname);

    revalidatePath('/settings');
    revalidatePath('/', 'layout');
    return { ok: true, data: removed };
  } catch (error) {
    return { ok: false, error: explain(error, 'Could not remove that domain.') };
  }
}

/**
 * Make one domain the canonical address for the site.
 *
 * Moves the primary flag, which is what every canonical link tag and og:url on
 * the published site reads through siteUrl. No provider call: which of a site's
 * verified domains is the canonical one is our decision, not Vercel's.
 */
export async function setPrimaryDomainAction(hostname: string): Promise<DomainResult<boolean>> {
  try {
    const { tenantId } = await requireDomainAccess();
    const set = await setPrimaryDomain(tenantId, hostname);

    revalidatePath('/settings');
    revalidatePath('/', 'layout');
    return { ok: true, data: set };
  } catch (error) {
    return { ok: false, error: explain(error, 'Could not set the main domain.') };
  }
}

function explain(error: unknown, generic: string): string {
  const message = error instanceof Error ? error.message : String(error);

  if (isSignInRequired(error)) return message;
  if (message.startsWith('Your session has ended')) return message;
  if (message.startsWith('This account is not a member')) return message;
  if (message.startsWith('Only the site owner')) return message;
  // The domain-shaped refusals are already sentences a client can act on.
  if (message.startsWith('That does not look like a web address')) return message;
  if (message.startsWith('That address is part of our own preview domain')) return message;
  if (message.startsWith('Domain hosting is not connected')) return message;

  // A duplicate hostname, whoever holds it, reads the same to the person adding it.
  if (message.includes('23505') || message.includes('duplicate key')) {
    return 'That domain is already in use. If it is yours, remove it from the other site first.';
  }
  // A constraint the client can still do something about (a bad shape slipping past
  // normaliseHostname, or our reserved suffix caught at the database).
  if (message.includes('domains_reserved_suffix') || message.includes('violates check constraint')) {
    return 'That address cannot be used as a custom domain. Add a domain you own.';
  }

  console.error('[tg-sites] domain action failed', error);
  return generic;
}
