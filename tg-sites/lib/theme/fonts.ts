/**
 * Turning a typography setting into CSS: a stack, an @font-face, a preload.
 *
 * Pure. Takes the theme and a description of the tenant's font library, and
 * hands back strings and objects. No database, no fetch, no React, so all of it
 * is testable and the same functions serve the published page and the editor.
 *
 * THREE THINGS HAVE TO LINE UP or a font silently does not load:
 *
 *   The @font-face family name must be exactly the name in the font-family
 *   declaration. They are generated from the same field here for that reason.
 *
 *   The preload href must be byte-identical to the src in the @font-face, or the
 *   browser fetches the file twice and the preload was worse than nothing. Both
 *   come from fontFileUrl.
 *
 *   Only files that will actually be used should be preloaded. A family holds
 *   eight files; preloading all of them would download 230KB to use 40KB of it.
 */

import { FONTS, type FontId } from './schema';
import { FONT_WEIGHTS, TEXT_STYLES, type Typography } from './typography';

/** What this module needs to know about a family in the library. */
export interface LibraryFont {
  slug: string;
  /** The CSS family name. */
  family: string;
  /** What to use while the file loads, or if it never arrives. */
  fallback: 'sans' | 'serif' | 'slab' | 'script' | 'mono' | 'display';
  weights: number[];
}

/** One file, as the emitter needs it. */
export interface LibraryFontFile {
  id: string;
  slug: string;
  family: string;
  /** Carried on every file so the family list can be derived from the files. */
  fallback: LibraryFont['fallback'];
  /** The lightest weight this file covers. */
  weight: number;
  /**
   * The heaviest weight it covers, or null for a single-weight file.
   *
   * A variable font is ONE file spanning a range. Storing that range rather
   * than a row per weight is what lets the @font-face below declare it, so the
   * browser downloads the file once and interpolates the weights between.
   */
  weightMax?: number | null;
  style: 'normal' | 'italic';
  format: string;
  unicodeRange: string | null;
}

/**
 * The standard weights a file actually offers, expanding a variable range.
 *
 * A file covering 400 to 700 can render 500 and 600 as well, and the type panel
 * has to know that or a client who picks a variable family is offered one
 * weight. Expanded to the four standard steps rather than to every integer:
 * those are the ones the panel names, and a range covers the ones inside it.
 */
export function weightsCovered(file: {
  weight: number;
  weightMax?: number | null;
}): number[] {
  const top = file.weightMax ?? file.weight;
  if (top <= file.weight) return [file.weight];
  const steps = FONT_WEIGHTS.filter((w) => w >= file.weight && w <= top);
  // Keep the ends even when they are not standard steps, so a 350-450 face is
  // not reported as offering nothing.
  return [...new Set([file.weight, ...steps, top])].sort((a, b) => a - b);
}

/**
 * The families implied by a list of files.
 *
 * So a page needs ONE query. The renderer wants both: the files, to write
 * @font-face rules and preloads, and the families, to resolve a style's slug to
 * a font-family stack. Every field the second needs is already on the first, so
 * asking the database twice would be asking it the same question twice.
 */
export function familiesFromFiles(files: LibraryFontFile[]): LibraryFont[] {
  const byslug = new Map<string, LibraryFont>();

  for (const file of files) {
    // Every weight the file can render, not just the one it is filed under, or
    // a variable family reports a single weight and the type panel offers one.
    const covered = weightsCovered(file);
    const existing = byslug.get(file.slug);
    if (existing) {
      for (const weight of covered) {
        if (!existing.weights.includes(weight)) existing.weights.push(weight);
      }
      continue;
    }
    byslug.set(file.slug, {
      slug: file.slug,
      family: file.family,
      fallback: file.fallback,
      weights: [...covered],
    });
  }

  for (const font of byslug.values()) font.weights.sort((a, b) => a - b);
  return [...byslug.values()];
}

/**
 * The generic stack behind a custom font.
 *
 * A custom font is one network request away from not being there: the file can
 * fail, the visitor can be on a metered connection with fonts blocked, or the
 * page can paint before it lands. What shows in that moment should be the same
 * SHAPE of letter, so the page does not reflow into something unrecognisable.
 *
 * Exported for the font picker, which has the same problem in miniature. A
 * preview row has to show something before its file arrives, and showing a serif
 * candidate in a sans means the row changes shape as it lands, so a list of forty
 * reflows forty times. Using the stack the published page would use keeps the
 * movement down and keeps one answer to "what stands in for a slab".
 */
export const FALLBACK_STACK: Record<LibraryFont['fallback'], string> = {
  sans: FONTS.system.stack,
  serif: FONTS.serif.stack,
  slab: FONTS.slab.stack,
  // A handwriting face has no sensible system equivalent, and cursive is the
  // one generic family that at least signals "not the body text".
  script: `${FONTS.humanist.stack}, cursive`,
  mono: "ui-monospace, 'SF Mono', 'Cascadia Mono', Menlo, monospace",
  display: FONTS.grotesque.stack,
};

/**
 * A font-family value for one style.
 *
 * The family reference is a slug, and it can mean three things: a family in the
 * tenant's library, one of the built-in system stacks, or nothing.
 *
 * Nothing means INHERIT FROM PARAGRAPH, which is what makes the screen quick to
 * use: set the paragraph font and all seven follow it, then override the ones
 * that should differ. Without it, choosing a typeface would mean setting the
 * same value seven times.
 */
export function resolveStack(
  ref: string | null,
  library: LibraryFont[],
  fallbackRef: string | null = null,
): string {
  const reference = ref ?? fallbackRef;
  if (!reference) return FONTS.system.stack;

  const custom = library.find((font) => font.slug === reference);
  if (custom) {
    /*
     * Quoted, always. A family with a space in it is invalid in a font-family
     * declaration unquoted, and normaliseFamilyName has already guaranteed there
     * is no apostrophe in the name to close the quote early.
     */
    return `'${custom.family}', ${FALLBACK_STACK[custom.fallback]}`;
  }

  if (reference in FONTS) return FONTS[reference as FontId].stack;

  // A slug that is neither. Happens when a family has been deleted from the
  // library while the theme still names it, which is a normal thing to do.
  return FONTS.system.stack;
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

/**
 * The typography half of the theme, as custom properties.
 *
 * Five per style, seven styles. Verbose, and the alternative is worse: one
 * shorthand token per style would have to be parsed by the stylesheet, and CSS
 * cannot do that.
 */
export function typographyTokens(
  typography: Typography,
  library: LibraryFont[],
): Record<string, string> {
  const tokens: Record<string, string> = {};

  // Paragraph first: it is what every other style falls back to.
  const bodyRef = typography.p.family;

  for (const id of TEXT_STYLES) {
    const style = typography[id];
    tokens[`--tgs-${id}-font`] = resolveStack(style.family, library, bodyRef);
    tokens[`--tgs-${id}-weight`] = String(style.weight);
    tokens[`--tgs-${id}-size`] = `${style.size}px`;
    tokens[`--tgs-${id}-leading`] = String(style.lineHeight);
    // Hundredths of an em in the data, em in the CSS, so the stored value is a
    // readable integer and the emitted one is the unit CSS wants.
    tokens[`--tgs-${id}-tracking`] = `${(style.tracking / 100).toFixed(3)}em`;
  }

  /*
   * The two older tokens, kept and pointed at the new ones.
   *
   * --tgs-font-body and --tgs-font-display are referenced all through
   * globals.css, by the page shell, the quote block, the button and more. Making
   * them aliases means per-style typography lands without every one of those
   * rules having to be found and rewritten, and anything added later that reaches
   * for the old name still gets the right answer.
   */
  tokens['--tgs-font-body'] = tokens['--tgs-p-font'];
  tokens['--tgs-font-display'] = tokens['--tgs-h2-font'];

  return tokens;
}

// ---------------------------------------------------------------------------
// Serving
// ---------------------------------------------------------------------------

/**
 * Where a font file lives.
 *
 * Keyed on the file's id, which never changes for a given set of bytes, so the
 * URL is immutable and the route can answer with a one-year cache. Re-importing
 * a family makes new rows and therefore new URLs, so a changed font is never
 * served from a stale cache.
 *
 * The tenant slug is in the path because the route has to scope its read: a
 * request from a visitor's browser carries no session, so the tenant has to come
 * from somewhere, and the URL is the only place left. It is not a secret; it is
 * already the staging hostname.
 */
export function fontFileUrl(tenantSlug: string, fileId: string, format: string): string {
  const extension =
    format === 'woff2' ? 'woff2' : format === 'woff' ? 'woff' : format === 'opentype' ? 'otf' : 'ttf';
  return `/fonts/${tenantSlug}/${fileId}.${extension}`;
}

const CSS_FORMAT: Record<string, string> = {
  woff2: 'woff2',
  woff: 'woff',
  truetype: 'truetype',
  opentype: 'opentype',
};

/**
 * The @font-face rules for a tenant's library.
 *
 * Only for families the typography actually names, so a library holding six
 * fonts while the theme uses two emits two. An unused @font-face costs nothing
 * to download, because a browser only fetches a face it needs, but it is still
 * bytes in every page's HTML and a thing to read when debugging.
 *
 * font-display: swap, deliberately. The alternative, block, hides the text for
 * up to three seconds while the font loads, and text that arrives late is far
 * better than text that is invisible on a slow connection. It costs a reflow,
 * which is why the fallback stacks above are chosen to match the shape.
 */
export function fontFaceCss(
  files: LibraryFontFile[],
  tenantSlug: string,
  usedSlugs: Set<string>,
): string {
  const rules: string[] = [];

  for (const file of files) {
    if (!usedSlugs.has(file.slug)) continue;

    const src = `url(${fontFileUrl(tenantSlug, file.id, file.format)}) format('${
      CSS_FORMAT[file.format] ?? 'woff2'
    }')`;

    // No newlines or spare spaces. This goes in every page's HTML.
    /*
     * A RANGE WHEN THE FILE COVERS ONE, and it does two things at once.
     *
     * The browser downloads a variable file once instead of once per weight,
     * and it can render the weights BETWEEN the steps. A face pinned to a
     * single weight says "this file is 700", so a style asking for 650 snaps to
     * the nearest pinned face: measured in Chromium, Coastwise's h2 at 650 came
     * out at exactly the width of 700. With the range declared the same file
     * renders 650 between 400 and 700, where the client asked for it.
     */
    const top = file.weightMax ?? file.weight;
    const weight = top > file.weight ? `${file.weight} ${top}` : `${file.weight}`;

    rules.push(
      `@font-face{font-family:'${file.family}';font-style:${file.style};` +
        `font-weight:${weight};font-display:swap;src:${src};` +
        (file.unicodeRange ? `unicode-range:${file.unicodeRange};` : '') +
        '}',
    );
  }

  return rules.join('');
}

export interface Preload {
  href: string;
  type: string;
}

/**
 * The files worth preloading, which is far fewer than the files that exist.
 *
 * A preload tells the browser to fetch something before it has found the
 * reference to it, which turns a font from a second-round request into a
 * first-round one. It is also the easiest performance feature to get wrong:
 * preload everything and the important bytes queue behind the unimportant ones,
 * so it ends up slower than not bothering.
 *
 * So this is narrow on purpose:
 *
 *   Only weights the typography actually asks for. A family is stored at four
 *   weights and a site typically uses two.
 *
 *   Only the primary Latin subset. latin-ext exists for accented characters and
 *   most pages have none, and the browser will fetch it if a page does.
 *
 *   Only woff2. The older formats are there for an upload that has nothing
 *   better, and preloading a format the browser will not choose wastes the whole
 *   download.
 */
export function fontPreloads(
  files: LibraryFontFile[],
  tenantSlug: string,
  typography: Typography,
): Preload[] {
  // Which family and weight pairs the seven styles between them ask for.
  const wanted = new Set<string>();
  const bodyRef = typography.p.family;

  for (const id of TEXT_STYLES) {
    const style = typography[id];
    const ref = style.family ?? bodyRef;
    if (ref) wanted.add(`${ref}:${style.weight}`);
  }

  const preloads: Preload[] = [];
  const seen = new Set<string>();

  for (const file of files) {
    if (file.format !== 'woff2') continue;

    /*
     * Wanted if ANY weight the page asks for falls inside this file's range.
     *
     * A variable file covering 400 to 700 answers for every style using this
     * family, so matching on the single weight it is filed under would have
     * skipped the preload for a page whose body is 400 and whose headings are
     * 700, and preloaded the same bytes twice when it did match.
     */
    const top = file.weightMax ?? file.weight;
    let asked = false;
    for (const key of wanted) {
      const [slug, weight] = key.split(':');
      if (slug === file.slug && Number(weight) >= file.weight && Number(weight) <= top) {
        asked = true;
        break;
      }
    }
    if (!asked) continue;

    /*
     * One file per family and weight, and the FIRST one wins.
     *
     * listFontFaces orders subsets with nulls first then alphabetically, so
     * "latin" comes before "latin-ext" and an upload with no subset comes before
     * either. That ordering is what makes "the first one" mean "the one a page
     * in English will actually need", and it is asserted by a test rather than
     * left as a coincidence of the ORDER BY.
     */
    /*
     * Keyed on the RANGE, not on a single weight. A static family filed at 400
     * and 700 is two ranges and still gets two preloads, one per weight, which
     * is what it needs. A variable family is one range however many weights the
     * page uses, so its file is preloaded once rather than once per weight.
     */
    const key = `${file.slug}:${file.weight}:${top}`;
    if (seen.has(key)) continue;
    seen.add(key);

    preloads.push({
      href: fontFileUrl(tenantSlug, file.id, file.format),
      type: 'font/woff2',
    });
  }

  return preloads;
}

/** Which library families a theme's typography actually uses. */
export function usedFontSlugs(typography: Typography): Set<string> {
  const used = new Set<string>();
  const bodyRef = typography.p.family;

  for (const id of TEXT_STYLES) {
    const ref = typography[id].family ?? bodyRef;
    if (ref) used.add(ref);
  }

  return used;
}
