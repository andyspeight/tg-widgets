/**
 * In-memory stand-ins for the theme and font actions, for the theme harness only.
 *
 * THIS IS A TEST DOUBLE, NOT A SECOND IMPLEMENTATION. Nothing in the app imports
 * it. The `satisfies` clauses at the bottom are what make "the doubles still match
 * the real signatures" a checked claim rather than a hope.
 *
 * The Google CATALOGUE is the real one, deliberately. Search is the part of this
 * screen most likely to be subtly wrong, and running it against the committed
 * 1,941 entries means the harness exercises the same ranking, the same
 * case-insensitive matching and the same awkward names (PT Sans, DM Serif Text) as
 * production. Only the network is faked.
 */

import { CATEGORY_LABEL, GOOGLE_FONTS, type FontCategory } from '../lib/fonts/catalogue';
import type { FontFamily } from '../lib/db/fonts';

const library: FontFamily[] = [
  {
    id: 'demo-1',
    family: 'Playfair Display',
    slug: 'playfair-display',
    source: 'google',
    fallback: 'serif',
    weights: [400, 700],
    bytes: 61_440,
  },
  {
    id: 'demo-2',
    family: 'Founders Grotesk',
    slug: 'founders-grotesk',
    source: 'upload',
    fallback: 'sans',
    weights: [400],
    bytes: 28_672,
  },
];

// ---------------------------------------------------------------------------

/** The real ranking, over the real catalogue. Only the transport is a double. */
export async function searchGoogleFontsAction(query: string, category?: string) {
  const needle = String(query ?? '').trim().toLowerCase();
  const wanted = typeof category === 'string' && category in CATEGORY_LABEL
    ? (category as FontCategory)
    : null;

  const scored: Array<{ match: { family: string; category: FontCategory; categoryLabel: string }; rank: number }> = [];

  for (const [family, cat] of GOOGLE_FONTS) {
    if (wanted && cat !== wanted) continue;
    let rank = 0;
    if (needle) {
      const name = family.toLowerCase();
      if (name === needle) rank = 3;
      else if (name.startsWith(needle)) rank = 2;
      else if (name.includes(needle)) rank = 1;
      else continue;
    }
    scored.push({ match: { family, category: cat, categoryLabel: CATEGORY_LABEL[cat] }, rank });
  }

  scored.sort((a, b) => b.rank - a.rank || a.match.family.localeCompare(b.match.family, 'en'));
  return { ok: true as const, data: scored.slice(0, 40).map((s) => s.match) };
}

export async function importGoogleFontAction(family: string) {
  const slug = family.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  if (!library.some((font) => font.slug === slug)) {
    library.push({
      id: `demo-${library.length + 1}`,
      family,
      slug,
      source: 'google',
      fallback: 'sans',
      weights: [400, 700],
      bytes: 48_000,
    });
  }
  return { ok: true as const, data: [...library] };
}

export async function deleteFontAction(slug: string) {
  const index = library.findIndex((font) => font.slug === slug);
  if (index >= 0) library.splice(index, 1);
  return { ok: true as const, data: [...library] };
}

/**
 * No storage here, so it says so.
 *
 * A double that faked a successful upload would make the harness claim a
 * capability it does not have, and the missing font afterwards would read as a bug.
 */
export async function uploadFontAction(_form: FormData) {
  return {
    ok: false as const,
    error: 'This is the review harness, which has nowhere to put a font file.',
  };
}

/** Saving a theme. Accepted and forgotten, which is honest for a harness. */
export async function saveThemeAction(theme: unknown) {
  return { ok: true as const, data: theme };
}

// ---------------------------------------------------------------------------

import type * as realFonts from '../app/actions/fonts';

const _search = searchGoogleFontsAction satisfies typeof realFonts.searchGoogleFontsAction;
const _import = importGoogleFontAction satisfies typeof realFonts.importGoogleFontAction;
const _delete = deleteFontAction satisfies typeof realFonts.deleteFontAction;
const _upload = uploadFontAction satisfies (
  ...args: Parameters<typeof realFonts.uploadFontAction>
) => ReturnType<typeof realFonts.uploadFontAction>;

void _search;
void _import;
void _delete;
void _upload;
