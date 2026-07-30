/**
 * @font-face rules for EVERY font in the library, for the theme screen.
 *
 * WHY THIS IS NOT JUST FontHead
 *
 * FontHead emits rules only for the families the theme actually uses, and that is
 * right for a page being rendered: a visitor should not download a typeface the
 * page never sets. It is wrong for the screen where somebody is CHOOSING, because
 * every option in the list has to be able to draw itself in its own typeface, and
 * a font with no rule silently falls back to the system stack.
 *
 * That is exactly what was happening. The library list and the Typeface control
 * both already asked for the family by name, and the theme page rendered no
 * @font-face rules at all, so both quietly showed the same system sans for
 * everything. The code looked correct in isolation and there was nothing to see in
 * the console: an unresolvable font-family is not an error, it is a fallback.
 *
 * No preloads, deliberately. Preloading is for a file the page is definitely about
 * to use; here most of these will only ever be glanced at in a list, and telling
 * the browser to fetch all of them at high priority would make the screen slower
 * to become usable, not faster.
 *
 * Same generator as the published page, so there is one place that knows how to
 * write a @font-face rule and no chance of the picker and the page disagreeing
 * about what a font is called.
 */

import type { ReactElement } from 'react';

import { fontFaceCss, type LibraryFontFile } from '../../lib/theme/fonts';

interface Props {
  /** The tenant's slug, which is the first segment of every font URL. */
  tenantSlug: string;
  files: LibraryFontFile[];
}

export function LibraryFontFaces({ tenantSlug, files }: Props): ReactElement | null {
  // Every family present, rather than the used subset. See above.
  const all = new Set(files.map((file) => file.slug));
  if (all.size === 0) return null;

  const css = fontFaceCss(files, tenantSlug, all);
  if (!css) return null;

  /*
   * Inline, and the cost is stated in FontHead: this needs style-src to allow
   * inline styles, and when a Content-Security-Policy arrives it needs a nonce.
   * The string is built entirely from database rows through fontFaceCss, from a
   * family name that passed normaliseFamilyName, a numeric weight, a format from
   * a fixed set and a URL built from a uuid, so nothing a client typed reaches
   * it unchecked.
   */
  return <style dangerouslySetInnerHTML={{ __html: css }} />;
}
