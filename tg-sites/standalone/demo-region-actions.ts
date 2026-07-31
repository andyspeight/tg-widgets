/**
 * In-memory stand-ins for the region actions, for the standalone build only.
 *
 * Same reasoning as standalone/demo-actions.ts: the real ones import a Postgres
 * driver and Next's cache, neither of which can exist in a file served from a
 * static host. THIS IS A TEST DOUBLE, NOT A SECOND PERSISTENCE PATH. Nothing in
 * the app imports it, and the editor is unchanged.
 *
 * The save VALIDATES FOR REAL, through parseRegion, which is the whole point of
 * a double rather than a stub that answers yes. A tree the real save would
 * refuse is refused here too, in the browser, where the harness can see it.
 */

import type { ActionResult } from '../app/actions/pages';
import type { RegionRecord } from '../lib/db/regions';
import { emptyRegion, parseRegion, REGIONS, type RegionName } from '../lib/content/schema';
import { sanitiseRegion } from '../lib/content/sanitise-page';

const state: Record<RegionName, RegionRecord> = {
  header: {
    region: emptyRegion('header'),
    hasUnpublishedChanges: false,
    publishedAt: null,
    updatedAt: null,
  },
  footer: {
    region: emptyRegion('footer'),
    hasUnpublishedChanges: false,
    publishedAt: null,
    updatedAt: null,
  },
};

function named(value: string): RegionName {
  if ((REGIONS as readonly string[]).includes(value)) return value as RegionName;
  throw new Error('That is not a part of the site you can edit.');
}

export async function getRegionAction(region: string): Promise<ActionResult<RegionRecord>> {
  try {
    return { ok: true, data: { ...state[named(region)] } };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

export async function saveRegionAction(
  region: string,
  content: unknown,
): Promise<ActionResult<RegionRecord>> {
  let name: RegionName;
  try {
    name = named(region);
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }

  const parsed = parseRegion(content, name);
  if (!parsed.ok) {
    return { ok: false, error: `Refusing to save a malformed ${name}: ${parsed.errors.join('; ')}` };
  }

  // Sanitised here too, so the review copy stores what the real one would.
  state[name] = {
    region: sanitiseRegion(parsed.region),
    hasUnpublishedChanges: true,
    publishedAt: state[name].publishedAt,
    updatedAt: new Date(),
  };

  return { ok: true, data: { ...state[name] } };
}

export async function publishRegionAction(region: string): Promise<ActionResult<RegionRecord>> {
  let name: RegionName;
  try {
    name = named(region);
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }

  state[name] = { ...state[name], hasUnpublishedChanges: false, publishedAt: new Date() };
  return { ok: true, data: { ...state[name] } };
}

// Compile-time proof that the doubles still match the real thing. If a real
// action gains an argument or changes its return type, this stops building.
import type * as real from '../app/actions/regions';

const _getMatches = getRegionAction satisfies typeof real.getRegionAction;
const _saveMatches = saveRegionAction satisfies typeof real.saveRegionAction;
const _publishMatches = publishRegionAction satisfies typeof real.publishRegionAction;
void _getMatches;
void _saveMatches;
void _publishMatches;
