'use server';

/**
 * The one read behind "Publish site": what is pending across the whole site.
 *
 * The same two rules as app/actions/pages.ts hold here. The tenant is never an
 * argument, it comes from the session; and this asks for the `publish`
 * capability, so a member who cannot publish is told so before the overlay opens
 * rather than watching it fail item by item.
 *
 * IT ONLY PLANS. The publishing itself is done by the dialog, one item at a
 * time, through the same publishPageAction and publishRegionAction a single
 * publish has always used. That keeps every guarantee those already carry (the
 * search-listing fill before a page goes live, the audit snapshot, the region's
 * whole-site revalidate) without a second publish path that would have to be
 * kept in step with the first. This just decides the worklist. See
 * lib/publish/site-plan.ts for the rule it decides it by.
 */

import { requireCapability, isPermissionError } from '../../lib/auth/capabilities';
import { listPages } from '../../lib/db/pages';
import { getRegion } from '../../lib/db/regions';
import { siteUrl } from '../../lib/db/tenants';
import { REGIONS } from '../../lib/content/schema';
import { selectSitePublishTargets, type SitePublishPlan } from '../../lib/publish/site-plan';
import type { ActionResult } from './pages';

/**
 * Local rather than shared with pages.ts, whose `attempt` is module-private.
 * The named cases are the two worth showing as written; anything else is a fault
 * and stays generic, exactly as the page actions do it.
 */
async function attempt<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    if (isPermissionError(error)) return { ok: false, error: error.message };
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith('This account is not a member')) return { ok: false, error: message };
    if (message.startsWith('Your session has ended')) return { ok: false, error: message };
    console.error('[tg-sites] could not work out what to publish', error);
    return { ok: false, error: 'Something went wrong working out what to publish. Nothing was changed.' };
  }
}

/**
 * Everything a site publish would push live, and where to send them.
 *
 * The pages, both regions and the public URL are read together: none waits on
 * another, and a site is tens of pages so the whole plan is one round of cheap
 * reads. getRegion answers for a region nobody has touched with an empty record
 * whose hasUnpublishedChanges is false, so an untouched header is simply not in
 * the plan.
 */
export async function sitePublishPlanAction(): Promise<ActionResult<SitePublishPlan>> {
  return attempt(async () => {
    const tenantId = await requireCapability('publish');

    const [pages, regionRecords, url] = await Promise.all([
      listPages(tenantId),
      Promise.all(
        REGIONS.map(async (name) => ({ name, hasUnpublishedChanges: (await getRegion(tenantId, name)).hasUnpublishedChanges })),
      ),
      siteUrl(tenantId),
    ]);

    const targets = selectSitePublishTargets(pages, regionRecords);
    return { ...targets, siteUrl: url };
  });
}
