/**
 * The "publish the whole site" plan, for the standalone review copy.
 *
 * The real one reads every page and region that has unpublished changes, which
 * means Postgres, and it reaches the tenant and the member's capabilities on the
 * way, which means node:crypto and node:async_hooks. None of that can exist in a
 * file served from a static host.
 *
 * FOUND ON 17 SEP 2026 with two others: this was the module actually dragging
 * the driver into the editor bundle, so npm run verify:browser had been dying at
 * its first step. Nothing but that build reads it, which is how it stayed
 * unnoticed. tests/settings.test.ts now fails instead.
 *
 * Nothing to publish rather than a fixture, so the dialog shows its own "all up
 * to date" state, which is the truth about a review copy with no database.
 */

import type * as real from '../app/actions/publish-site';

export async function sitePublishPlanAction(): ReturnType<typeof real.sitePublishPlanAction> {
  return { ok: true, data: { pages: [], regions: [], draftsHeldBack: 0, siteUrl: 'https://example.travelgenixsites.com' } };
}

const _plan = sitePublishPlanAction satisfies typeof real.sitePublishPlanAction;
void _plan;
