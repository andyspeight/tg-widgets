'use server';

/**
 * Building a site from a starter.
 *
 * TWO WRITES, IN THIS ORDER, AND THE ORDER IS THE POINT. The profile is saved to
 * settings FIRST, then the site is built from it. Not because the build needs
 * the database copy, it is handed the facts directly, but because the three
 * answers are the same three the writing assistant reads, the structured data
 * publishes and the Being found report complains about. A wizard that asked for
 * a company name, used it once and threw it away would be asking for it again on
 * the settings screen ten minutes later, and the two copies would then disagree.
 *
 * IF THE BUILD IS REFUSED THE PROFILE IS STILL SAVED, deliberately. Somebody who
 * has typed their company name into a wizard that then said "this site already
 * has content" should not have to type it again. The profile is worth having on
 * its own and it is not part of the thing being refused.
 *
 * THE REFUSAL IS ON THE SERVER. The dashboard only shows this on an empty site,
 * which is a courtesy to whoever is looking at the screen and no obstacle at all
 * to somebody calling the action directly. lib/db/starters.ts checks again
 * inside the transaction, which is the actual control.
 */

import { revalidatePath } from 'next/cache';

import { currentUserId, requireTenantId } from '../../lib/auth/session';
import { STARTERS, type StarterFacts } from '../../lib/content/starters';
import { getSettings, saveSettings } from '../../lib/db/settings';
import { applyStarter, siteIsEmpty, type StarterResult } from '../../lib/db/starters';

export type StarterActionResult =
  | { ok: true; data: StarterResult }
  | { ok: false; error: string };

/** The lengths the settings fields already enforce, applied before the save. */
const MAX_COMPANY = 120;
const MAX_TOWN = 80;
const MAX_ABOUT = 1200;

function facts(input: unknown): StarterFacts {
  const raw = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const text = (value: unknown, max: number) =>
    (typeof value === 'string' ? value : '').trim().slice(0, max);

  return {
    company: text(raw.company, MAX_COMPANY),
    town: text(raw.town, MAX_TOWN),
    about: text(raw.about, MAX_ABOUT),
  };
}

export async function siteIsEmptyAction(): Promise<boolean> {
  try {
    return await siteIsEmpty(await requireTenantId());
  } catch {
    // A question, not a command. Somebody who cannot be told is told no, and the
    // dashboard simply does not offer the wizard.
    return false;
  }
}

export async function applyStarterAction(
  starterId: unknown,
  profile: unknown,
): Promise<StarterActionResult> {
  try {
    const tenantId = await requireTenantId();
    const userId = (await currentUserId()) ?? undefined;

    const id = String(starterId ?? '');
    if (!STARTERS.some((starter) => starter.id === id)) {
      return { ok: false, error: 'That is not a starter we know about.' };
    }

    const given = facts(profile);

    /*
     * MERGED OVER WHAT IS THERE, never a wholesale replace. The wizard asks
     * three questions and the profile has more fields than that, so writing a
     * fresh object would wipe the tone of voice and the words-to-avoid of
     * anybody who filled those in before running a starter.
     *
     * And a blank answer leaves the existing value alone rather than clearing
     * it, because "I did not type anything" is not "delete what you have".
     */
    const current = await getSettings(tenantId);
    await saveSettings(tenantId, {
      ...current,
      companyName: given.company || current.companyName,
      addressLocality: given.town || current.addressLocality,
      companyAbout: given.about || current.companyAbout,
    });

    const result = await applyStarter(tenantId, id, given, userId);

    if (!result) {
      return {
        ok: false,
        error:
          'This site already has content on it, so nothing has been changed. '
          + 'A starter only runs on an empty site.',
      };
    }

    // Every screen that lists pages, plus the report, which has just gone from
    // "nothing is published" to five drafts.
    revalidatePath('/sites');
    revalidatePath('/seo');

    return { ok: true, data: result };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'That did not work. Try again.',
    };
  }
}
