/**
 * An in-memory stand-in for the activity action, harness only.
 *
 * THIS IS A TEST DOUBLE, NOT A SECOND IMPLEMENTATION. Nothing in the app imports it.
 * The Activity tab is unchanged: it calls the same function with the same signature
 * and gets the same shape back, and the satisfies clause at the bottom is what makes
 * that a checked claim rather than a hope.
 *
 * WHY IT HAS TO EXIST. The real action reaches Postgres through lib/db/activity and
 * lib/auth/session, so bundling it for a browser drags in the driver, node:crypto and
 * node:async_hooks and the build fails. That failure is the right way round, and it
 * is the one that broke `npm run verify:browser` from 17 Aug 2026 until this landed:
 * the Activity tab arrived in a5e7f4c and nothing added the swap for it.
 *
 * The dates are fixed rather than relative to now, so the harness renders the same
 * screen every run and a screenshot diff means something.
 */

import type { ActivityLine } from '../lib/activity/log';

const LINES: ActivityLine[] = [
  {
    id: 'act_1',
    action: 'page.publish',
    summary: 'Published Holidays',
    createdAt: new Date('2026-08-18T09:14:00Z'),
    actor: 'Andy Speight',
  },
  {
    id: 'act_2',
    action: 'page.create',
    summary: 'Created Meet the team',
    createdAt: new Date('2026-08-17T16:02:00Z'),
    actor: 'sam@example.com',
  },
  {
    id: 'act_3',
    action: 'page.delete',
    summary: 'Deleted Old offers',
    createdAt: new Date('2026-08-16T11:47:00Z'),
    // The null case on purpose: somebody since removed from the site. The tab has
    // to draw it without a name, and the harness is where that gets looked at.
    actor: null,
  },
];

export async function listActivityAction(): Promise<ActivityLine[]> {
  return LINES;
}

import type * as real from '../app/actions/activity';

const _list = listActivityAction satisfies typeof real.listActivityAction;
void _list;
