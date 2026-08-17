'use server';

/**
 * A site's activity log, read for the screen that shows it.
 *
 * ANY MEMBER OF THE SITE, and no finer than that in this slice. Reading the
 * history changes nothing and reveals only what already happened on a site the
 * caller belongs to: requireTenantId resolves the tenant from the signed-in
 * user's own memberships, and the table's row policy scopes the rows to it, so a
 * member only ever reads their own site's log. If a later slice needs to keep
 * some events from some roles that is a change here and in the policy, not a
 * hidden button. Every server action is a public endpoint, the same lesson as
 * app/actions/domains.ts.
 *
 * Recording is not here. An event is written from inside the mutation that
 * caused it (see lib/db/pages.ts and lib/db/activity.ts), so it shares that
 * transaction and cannot be forged from the outside by calling an action.
 */

import { requireTenantId } from '../../lib/auth/session';
import { listActivity, type ActivityEntry } from '../../lib/db/activity';

export async function listActivityAction(): Promise<ActivityEntry[]> {
  return listActivity(await requireTenantId());
}
