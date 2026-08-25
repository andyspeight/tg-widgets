/**
 * Which pictures already in the bank could be made smaller, and which cannot.
 *
 * WHY A BACKFILL IS NEEDED AT ALL. Variants are encoded in the browser at upload
 * time (Andy's call on 23 Aug 2026: no per-request fee, no native module, no
 * vendor lock). Every picture uploaded before that existed therefore has none,
 * and a site duplicated from another drops them deliberately, because a variant
 * url points into the SOURCE tenant's prefix. Measured on the live database the
 * day the feature shipped: 30 images, 30 with no variants. So the srcset work was
 * live and doing nothing for a single existing page.
 *
 * PURE, AND SEPARATE FROM THE DOING. Deciding what to work on needs no browser,
 * no canvas and no network, so it is testable on its own. The encoding and the
 * uploading are the picker's job, in the browser, reusing the same path a real
 * upload takes rather than a second implementation of it.
 *
 * NOTHING HERE MUTATES. A plan is a description, so it can be shown to somebody
 * before it runs. That matters more than usual for this one: it re-encodes and
 * re-uploads a client's whole photograph library, and the worst version of this
 * feature is the one that starts doing that without saying how much it is about
 * to do.
 */

import type { MediaItem } from './types';
import { variantWidthsFor } from './downscale';

/** Why a picture is being left alone, in words a person can act on. */
export type SkipReason =
  | 'not an image'
  | 'already has every useful size'
  | 'no stored dimensions'
  | 'already small enough';

/** The widths a picture already has stored, for asking what is still missing. */
function storedWidths(item: MediaItem): number[] {
  return (item.variants ?? []).map((v) => v.width).filter((w) => Number.isFinite(w));
}

export interface BackfillPlan {
  /** Pictures worth re-encoding, largest first so the biggest wins land early. */
  candidates: MediaItem[];
  /** Everything else, and why. Shown rather than hidden. */
  skipped: Array<{ item: MediaItem; why: SkipReason }>;
  /** How many widths the whole run would produce, for an honest progress total. */
  variantCount: number;
}

/** Whether this one picture would gain anything, and if not, why not. */
export function skipReason(item: MediaItem): SkipReason | null {
  if (!item || typeof item.mime !== 'string' || !item.mime.startsWith('image/')) {
    return 'not an image';
  }

  /*
   * A row with no dimensions cannot be planned for: the ladder is decided from
   * the picture's size, and guessing would mean either skipping one that would
   * have benefited or making copies larger than the original.
   *
   * SKIPPED, NOT REPAIRED, and being straight about that matters more than the
   * feature would. The browser could measure the picture while it had it decoded
   * and fill the gap, and it does not. Zero of the 30 images on the live database
   * lack dimensions, so this is a defensive branch rather than a real case, and
   * writing code for a case that does not occur is how it goes untested and wrong
   * on the day it finally happens. If a bank ever shows these, that is the moment
   * to handle them properly.
   */
  if (!item.width || !item.height) return 'no stored dimensions';

  /*
   * ASKED AGAINST WHAT IS ALREADY THERE, not merely whether anything is. A run
   * that treats "has some copies" as "is finished" cannot ever add a rung, and
   * the ladder has already changed once: a real client's 1920px photographs were
   * given 400 and 800 and nothing between 800 and the original, so a phone at 3x
   * took the original and the whole run bought it nothing.
   */
  const missing = variantWidthsFor(item.width, item.height, storedWidths(item));
  if (missing.length === 0) {
    return storedWidths(item).length > 0 ? 'already has every useful size' : 'already small enough';
  }

  return null;
}

/**
 * The whole bank, sorted into work and not-work.
 *
 * Largest first, deliberately. A run can be stopped half way, by a closed tab or
 * a person losing patience, and the pictures that matter are the big ones. This
 * way a partial run has still done the part worth doing.
 */
export function backfillPlan(items: readonly MediaItem[]): BackfillPlan {
  const candidates: MediaItem[] = [];
  const skipped: BackfillPlan['skipped'] = [];

  for (const item of items ?? []) {
    const why = skipReason(item);
    if (why) skipped.push({ item, why });
    else candidates.push(item);
  }

  candidates.sort((a, b) => (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0));

  const variantCount = candidates.reduce(
    (n, item) => n + variantWidthsFor(item.width ?? 0, item.height ?? 0, storedWidths(item)).length,
    0,
  );

  return { candidates, skipped, variantCount };
}

/**
 * What to tell somebody before they press the button.
 *
 * Deliberately says the number of pictures AND the number of files it will
 * create, because those differ by roughly three and the second is the one that
 * decides how long they will be waiting.
 */
export function describePlan(plan: BackfillPlan): string {
  if (plan.candidates.length === 0) {
    return plan.skipped.length === 0
      ? 'There are no pictures in this bank yet.'
      : 'Every picture here is already as small as it needs to be.';
  }

  const pictures = plan.candidates.length === 1 ? '1 picture' : `${plan.candidates.length} pictures`;
  const files = plan.variantCount === 1 ? '1 smaller copy' : `${plan.variantCount} smaller copies`;
  return `${pictures} can be made smaller for phones, which means making ${files}.`;
}
