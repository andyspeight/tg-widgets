/**
 * Applying a designed theme to a tenant: the server half of theme-design.ts.
 *
 * Split from the design so the design stays pure and testable. This half does
 * the two things that need a server: it imports the pairing's typefaces into
 * the tenant's own font library (self-hosted, one fetch per family, the same
 * pipeline the designed homes use - see lib/content/designed-fonts.ts), and it
 * saves the theme.
 *
 * THE FONTS ARE BEST EFFORT AND THE THEME IS NOT. A family that will not
 * import leaves its text styles resolving to the category fallback stack (a
 * serif stays a serif - lib/theme/fonts.ts), which is a worse face and never a
 * broken site. The theme save is the thing that actually changes how the site
 * looks, so a failure there is a real failure and the caller decides what it
 * costs.
 */

import 'server-only';

import { GOOGLE_FONTS, type FontCategory } from '../fonts/catalogue';
import { importGoogleFamily, normaliseFamilyName, resolveFamilyName } from '../fonts/google';
import { saveFontFamily } from '../db/fonts';
import { saveTheme } from '../db/theme';
import type { FontPairing } from './theme-design';

function categoryOf(family: string): FontCategory {
  const found = GOOGLE_FONTS.find(([name]) => name === family);
  return found ? found[1] : 'sans';
}

/**
 * Every fetch inside a font import carries its own deadline. Without one, a
 * stalled fonts.gstatic.com connection would hold the whole plan action until
 * the route's maxDuration killed it - and best effort that can hang forever
 * is not best effort. An abort rejects, the per-family catch below swallows
 * it, and the site keeps the fallback face.
 */
const FONT_FETCH_TIMEOUT_MS = 15_000;

const fetchWithDeadline: typeof fetch = (input, init) =>
  fetch(input, { ...init, signal: AbortSignal.timeout(FONT_FETCH_TIMEOUT_MS) });

export async function applyDesignedTheme(
  tenantId: string,
  design: { theme: Record<string, unknown>; pairing: FontPairing },
): Promise<void> {
  const families = [...new Set([design.pairing.display, design.pairing.body])];

  await Promise.all(
    families.map(async (family) => {
      try {
        const typed = normaliseFamilyName(family);
        if (!typed) return;
        const imported = await importGoogleFamily(typed, fetchWithDeadline);
        const resolved = resolveFamilyName(imported.family, GOOGLE_FONTS) ?? imported.family;
        await saveFontFamily(tenantId, imported, 'google', categoryOf(resolved));
      } catch {
        // Best effort: the theme still lands, in the fallback face.
      }
    }),
  );

  await saveTheme(tenantId, design.theme);
}
