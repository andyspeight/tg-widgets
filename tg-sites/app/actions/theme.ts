'use server';

/**
 * Saving a site's theme.
 *
 * Same two rules as every other action in this folder. The tenant is never an
 * argument, it comes from the session. And the caller's input is a suggestion:
 * parseTheme turns whatever arrives into a valid theme, so a hand-crafted
 * request cannot store a colour in a notation the renderer would then have to
 * cope with, or a font stack of its own choosing.
 */

import { revalidatePath } from 'next/cache';

import { isPermissionError, requireCapability } from '../../lib/auth/capabilities';
import { saveTheme } from '../../lib/db/theme';
import { parseTheme, type Theme } from '../../lib/theme/schema';

export type ThemeResult =
  | { ok: true; data: Theme }
  | { ok: false; error: string };

export async function saveThemeAction(input: unknown): Promise<ThemeResult> {
  try {
    const tenantId = await requireCapability('theme');
    const saved = await saveTheme(tenantId, parseTheme(input));

    /*
     * Every page, not just this screen.
     *
     * A theme change repaints the published site and the editor canvas, and
     * both are rendered from the same tokens. Revalidating only /theme would
     * leave a client looking at a stale preview of the colours they just
     * changed, which reads as the save not having worked.
     */
    revalidatePath('/', 'layout');

    return { ok: true, data: saved };
  } catch (error) {
    if (isPermissionError(error)) return { ok: false, error: error.message };

    const message = error instanceof Error ? error.message : String(error);

    if (message.startsWith('Your session has ended')) return { ok: false, error: message };
    if (message.startsWith('This account is not a member')) return { ok: false, error: message };

    console.error('[tg-sites] could not save the theme', error);
    return { ok: false, error: 'Could not save that. Nothing was changed.' };
  }
}
