/**
 * Loading a designed home's own typefaces onto the site that adopts it.
 *
 * A frozen design names its fonts in its own CSS ("Bodoni Moda", "Jost"), and
 * the import strips the @font-face rules that would fetch them, because the
 * product self-hosts fonts rather than letting a visitor's browser talk to
 * Google. So a site built from a design has to be handed those families, exactly
 * once, into its own font library. After that the head emitter serves them and
 * the design's type is exact rather than a fallback.
 *
 * BEST EFFORT, NEVER FATAL. A font that will not import (a typo in the catalogue,
 * Google unreachable for a moment) leaves that design in its fallback face, which
 * is chosen by category so a serif stays a serif. A missing font is never a
 * reason to fail building somebody's whole site, so every import is caught and
 * the rest still run.
 */

import 'server-only';

import { GOOGLE_FONTS, type FontCategory } from '../fonts/catalogue';
import { importGoogleFamily, normaliseFamilyName, resolveFamilyName } from '../fonts/google';
import { saveFontFamily } from '../db/fonts';
import { designedHomeMeta } from './designed-homes-meta';

/** What a family falls back to while its file loads, from the catalogue. */
function categoryOf(family: string): FontCategory {
  const found = GOOGLE_FONTS.find(([name]) => name === family);
  return found ? found[1] : 'sans';
}

/**
 * Import the fonts a designed home names into the tenant's library.
 *
 * The families run in parallel and each is caught on its own: the site keeps
 * whatever imported, and anything that did not falls back to its category face.
 * Idempotent through saveFontFamily's upsert, so building the same design twice
 * on one site is harmless.
 */
export async function importDesignedFonts(tenantId: string, designId: string): Promise<void> {
  const meta = designedHomeMeta(designId);
  if (!meta) return;

  await Promise.all(
    meta.fonts.map(async (family) => {
      try {
        const typed = normaliseFamilyName(family);
        if (!typed) return;
        const imported = await importGoogleFamily(typed);
        const resolved = resolveFamilyName(imported.family, GOOGLE_FONTS) ?? imported.family;
        await saveFontFamily(tenantId, imported, 'google', categoryOf(resolved));
      } catch {
        // Best effort: the design keeps its fallback face rather than the site failing.
      }
    }),
  );
}
