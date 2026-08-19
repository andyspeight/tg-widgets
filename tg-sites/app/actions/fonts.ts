'use server';

/**
 * Adding and removing fonts.
 *
 * Same rules as every other action here: the tenant comes from the session, and
 * everything a caller sends is a suggestion. On top of that, two of these reach
 * OUT to the internet or accept a file, which nothing else in this codebase does,
 * so they carry their own limits.
 */

import { revalidatePath } from 'next/cache';

import { isPermissionError, requireCapability } from '../../lib/auth/capabilities';
import { deleteFontFamily, listFonts, saveFontFamily, type FontFamily } from '../../lib/db/fonts';
import { CATEGORY_LABEL, GOOGLE_FONTS, type FontCategory } from '../../lib/fonts/catalogue';
import {
  importGoogleFamily,
  normaliseFamilyName,
  resolveFamilyName,
  sniffFontFormat,
  type ImportedFamily,
} from '../../lib/fonts/google';

export type FontResult<T = FontFamily[]> =
  | { ok: true; data: T }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Browsing the catalogue
// ---------------------------------------------------------------------------

export interface CatalogueMatch {
  family: string;
  category: FontCategory;
  categoryLabel: string;
}

/**
 * Search the Google catalogue.
 *
 * SERVER SIDE, and that is the point. The catalogue is 1941 families and about
 * 57KB of source, and shipping it to the browser so a text box could filter it
 * would put 57KB in the bundle of a screen most people open once. Searching here
 * costs one round trip per keystroke-with-a-pause and sends back forty rows.
 *
 * Ranked so a prefix match beats a match in the middle. Typing "lat" should find
 * Lato before Cinzel Decorative, and a plain includes() filter does not do that.
 */
export async function searchGoogleFontsAction(
  query: string,
  category?: string,
): Promise<FontResult<CatalogueMatch[]>> {
  const needle = String(query ?? '').trim().toLowerCase();
  const wantedCategory = typeof category === 'string' && category in CATEGORY_LABEL
    ? (category as FontCategory)
    : null;

  const scored: Array<{ match: CatalogueMatch; rank: number }> = [];

  for (const [family, cat] of GOOGLE_FONTS) {
    if (wantedCategory && cat !== wantedCategory) continue;

    let rank = 0;
    if (needle) {
      const name = family.toLowerCase();
      if (name === needle) rank = 3;
      else if (name.startsWith(needle)) rank = 2;
      else if (name.includes(needle)) rank = 1;
      else continue;
    }

    scored.push({
      match: { family, category: cat, categoryLabel: CATEGORY_LABEL[cat] },
      rank,
    });
  }

  scored.sort((a, b) => b.rank - a.rank || a.match.family.localeCompare(b.match.family, 'en'));

  return { ok: true, data: scored.slice(0, 40).map((s) => s.match) };
}

// ---------------------------------------------------------------------------
// Importing from Google
// ---------------------------------------------------------------------------

/**
 * The classification, for the fallback stack.
 *
 * Looked up here rather than stored on the way through, because this is the last
 * place the catalogue is available: lib/theme/fonts.ts runs in the browser too,
 * and it must not have to import 1941 rows to know that a serif should fall back
 * to a serif.
 */
function categoryOf(family: string): FontCategory {
  const found = GOOGLE_FONTS.find(([name]) => name === family);
  return found ? found[1] : 'sans';
}

export async function importGoogleFontAction(family: string): Promise<FontResult> {
  try {
    const tenantId = await requireCapability('theme');

    const typed = normaliseFamilyName(family);
    if (!typed) {
      return { ok: false, error: 'That is not a font name. Letters, numbers and spaces only.' };
    }

    /*
     * The fetch happens here, on our server, exactly once per import.
     *
     * Not on a visitor's browser and not on every page view. After this, Google
     * is never contacted again for this font by anybody. See lib/fonts/google.ts
     * for why that matters beyond speed.
     */
    const imported = await importGoogleFamily(typed);

    const resolved = resolveFamilyName(imported.family, GOOGLE_FONTS) ?? imported.family;
    await saveFontFamily(tenantId, imported, 'google', categoryOf(resolved));

    revalidatePath('/', 'layout');
    return { ok: true, data: await listFonts(tenantId) };
  } catch (error) {
    return { ok: false, error: explain(error, 'Could not import that font.') };
  }
}

// ---------------------------------------------------------------------------
// Uploading
// ---------------------------------------------------------------------------

/** 1MB per file. A Latin woff2 is 20 to 60KB; a megabyte is already generous. */
const MAX_UPLOAD_BYTES = 1_000_000;

/** Eight files is four weights in two styles, which is a whole brand family. */
const MAX_UPLOAD_FILES = 8;

/**
 * Upload a brand font.
 *
 * A FormData action rather than a JSON one, because a file cannot be a server
 * action argument any other way, and base64 in a JSON body would inflate every
 * upload by a third.
 *
 * WHAT IS CHECKED, AND WHY EACH
 *
 * The bytes are sniffed for a real font signature. The filename is not trusted
 * for anything: it is whatever somebody typed, and these bytes get served to
 * every visitor of a client's site with a font MIME type. Browsers parse fonts
 * in code that has a long history of memory-safety bugs, so refusing anything
 * that is not at least the format it claims to be is the cheapest possible gate.
 *
 * The weight comes from the form, not from the filename. "Bold" in a filename
 * means nothing reliable, and guessing it wrong means the weight control on the
 * theme screen silently does nothing.
 */
export async function uploadFontAction(form: FormData): Promise<FontResult> {
  try {
    const tenantId = await requireCapability('theme');

    const family = normaliseFamilyName(form.get('family'));
    if (!family) {
      return {
        ok: false,
        error: 'Give the font a name. Letters, numbers and spaces only, as the foundry spells it.',
      };
    }

    const fallback = String(form.get('fallback') ?? 'sans');
    const category = (fallback in CATEGORY_LABEL ? fallback : 'sans') as FontCategory;

    const entries = form.getAll('file').filter((f): f is File => f instanceof File);
    if (entries.length === 0) return { ok: false, error: 'Choose at least one font file.' };
    if (entries.length > MAX_UPLOAD_FILES) {
      return { ok: false, error: `That is more than ${MAX_UPLOAD_FILES} files.` };
    }

    // Parallel to the files, so file[i] gets weight[i]. A single weight value
    // applies to all of them, which is the common case of one upload.
    const weights = form.getAll('weight').map((w) => Number(w));

    const files: ImportedFamily['files'] = [];

    for (const [index, entry] of entries.entries()) {
      if (entry.size > MAX_UPLOAD_BYTES) {
        return {
          ok: false,
          error: `${entry.name} is larger than 1MB. A web font should be a woff2, which is far smaller.`,
        };
      }

      const bytes = new Uint8Array(await entry.arrayBuffer());
      const format = sniffFontFormat(bytes);

      if (!format) {
        return {
          ok: false,
          error:
            `${entry.name} is not a font file. Accepted: woff2, woff, ttf and otf. ` +
            'woff2 is much the smallest and is what a foundry should give you for the web.',
        };
      }

      const weight = weights[index] ?? weights[0] ?? 400;

      files.push({
        weight: Number.isFinite(weight) ? Math.min(900, Math.max(100, Math.round(weight))) : 400,
        format,
        bytes,
        // An uploaded file covers whatever it covers. There is nothing to split
        // it on, so no subset and no unicode-range: the browser uses it for
        // everything.
        subset: null,
        unicodeRange: null,
      });
    }

    await saveFontFamily(tenantId, { family, files }, 'upload', category);

    revalidatePath('/', 'layout');
    return { ok: true, data: await listFonts(tenantId) };
  } catch (error) {
    return { ok: false, error: explain(error, 'Could not upload that font.') };
  }
}

// ---------------------------------------------------------------------------
// Removing
// ---------------------------------------------------------------------------

export async function deleteFontAction(slug: string): Promise<FontResult> {
  try {
    const tenantId = await requireCapability('theme');

    const clean = String(slug ?? '').trim().toLowerCase();
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(clean)) {
      return { ok: false, error: 'No such font.' };
    }

    await deleteFontFamily(tenantId, clean);

    /*
     * The theme is deliberately NOT edited to stop naming it.
     *
     * A style that referenced this family now names a font the library does not
     * have, and resolveStack falls back to the system stack for exactly that
     * case. Leaving the reference means re-importing the same family puts the
     * typeface back everywhere it was, which is what somebody who deleted it by
     * mistake wants. Rewriting seven styles on a delete is not undoable.
     */
    revalidatePath('/', 'layout');
    return { ok: true, data: await listFonts(tenantId) };
  } catch (error) {
    return { ok: false, error: explain(error, 'Could not remove that font.') };
  }
}

// ---------------------------------------------------------------------------

function explain(error: unknown, generic: string): string {
  if (isPermissionError(error)) return error.message;

  const message = error instanceof Error ? error.message : String(error);

  // Worth showing as written: they name a font, a size or a missing membership.
  if (message.startsWith('Google does not have')) return message;
  if (message.startsWith('Your session has ended')) return message;
  if (message.startsWith('This account is not a member')) return message;
  if (message.includes('is too large') || message.includes('unexpectedly large')) return message;
  if (message.includes('no Latin characters')) return message;

  console.error('[tg-sites] font action failed', error);
  return generic;
}
