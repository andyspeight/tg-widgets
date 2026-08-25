import 'server-only';

/**
 * The server's pass over a page's borrowed markup.
 *
 * THE ONE PLACE THE CLEANERS RUN. parse5 and postcss live behind this module,
 * and `server-only` at the top is what keeps them there: a client component that
 * imports this fails the build rather than quietly putting a quarter of a
 * megabyte of parser back into the editor. That is the whole point of the file,
 * so the import is load-bearing and not decoration.
 *
 * WHAT IT PREPARES, AND WHAT IT DELIBERATELY DOES NOT. An imported design has
 * two halves: cleaning its markup and scoping its stylesheet, which depend only
 * on props the editor never changes, and substituting the client's words into
 * the slots, which changes on every keystroke. Only the first half is here. The
 * second is pure string work with no parser behind it (applyImportContent), so
 * it stays where the edits are, on the client. Splitting there is what makes the
 * whole arrangement possible: the expensive half is stable, the changing half is
 * cheap.
 *
 * THE ORDER STILL MATTERS AND IS STILL THE OPPOSITE OF THE OBVIOUS ONE. Clean
 * first, substitute second. Substituting first would hand the cleaner markup it
 * had never checked, so a client typing into a slot would be typing into the
 * sanitiser's input. Because the clean happens HERE and the substitution happens
 * later, that order is now structural rather than a rule somebody has to
 * remember: the renderer receives markup that is already clean and has no way to
 * put anything into it except through a slot.
 *
 * STILL RE-CLEANED RATHER THAN TRUSTED. This runs on every render, not once on
 * the way in, so a snapshot restored from before a fix, a row edited by hand, or
 * a build where the save path changed all land on the same answer. Moving the
 * work off the browser did not turn it into a save-time cache.
 */

import { cleanImportHtml } from '../import/html';
import { importScopeClass, scopeImportCss } from '../import/css';
import { sanitiseEmbedHtml } from './sanitise-embed';
import { hasInnerColumns } from './inner-columns';
import { needsPreparing, type PreparedMap, type PreparedMarkup } from './prepared';
import type { ImageSizes } from './image-sizes';
import type { Block, Page, Section } from './schema';

function str(props: Record<string, unknown>, key: string): string {
  const value = props[key];
  return typeof value === 'string' ? value : '';
}

/**
 * One block's cleaned markup, or null if it needs none.
 *
 * Returns null rather than an empty entry for a block with nothing in it, so
 * `preparedFor` reads the two cases the same way and the block draws its own
 * placeholder either way.
 */
export function prepareBlock(
  block: Block,
  imageSizes?: ImageSizes,
  /*
   * Whether this block may claim the page's one eager picture. Absent means the
   * caller is not rendering (the editor, the save path), and nothing is injected.
   */
  imagePriority?: { heroFirst: boolean },
): PreparedMarkup | null {
  if (!block || !needsPreparing(block.type)) return null;
  const props = (block.props ?? {}) as Record<string, unknown>;

  if (block.type === 'embed') {
    const html = sanitiseEmbedHtml(str(props, 'html'));
    return html ? { html, css: '' } : null;
  }

  // An imported design. The stylesheet is confined to the class this block's
  // wrapper wears, and importScopeClass is the single place that name is
  // decided, because a stylesheet scoped to a class the wrapper does not carry
  // is an unstyled section with no error anywhere.
  const { html, images } = cleanImportHtml(str(props, 'html'), { imageSizes, imagePriority });
  const { css } = scopeImportCss(str(props, 'css'), { scope: `.${importScopeClass(block.id)}` });
  return html.trim() || css ? { html, css, images } : null;
}

/**
 * Every block in a tree, inner containers included.
 *
 * The nesting matters: a container's real content is the blocks inside
 * props.columns, where a pass over rows and columns alone never looks. An
 * imported design dropped into a grid would otherwise reach the renderer with no
 * entry and draw its placeholder, which is the same shape of hole
 * sanitiseContainer exists to close on the way in.
 */
function eachBlock(sections: readonly Section[], visit: (block: Block) => void): void {
  const walkBlocks = (blocks: readonly Block[] | undefined, depth: number): void => {
    if (!Array.isArray(blocks) || depth > 6) return;

    for (const block of blocks) {
      if (!block || typeof block !== 'object') continue;
      visit(block);

      if (!hasInnerColumns(block.type)) continue;
      const columns = (block.props as Record<string, unknown> | undefined)?.columns;
      if (!Array.isArray(columns)) continue;

      for (const column of columns) {
        if (!column || typeof column !== 'object') continue;
        walkBlocks((column as { blocks?: Block[] }).blocks, depth + 1);
      }
    }
  };

  for (const section of sections ?? []) {
    for (const row of section?.rows ?? []) {
      for (const column of row?.columns ?? []) walkBlocks(column?.blocks, 0);
    }
  }
}

/**
 * Cleaned markup for every block in a tree that needs it.
 *
 * Takes sections rather than a Page so the header, the footer and a collection
 * item go through the same call: all three are sections, and all three can hold
 * an imported design.
 */
export function prepareSections(
  sections: readonly Section[] | undefined,
  imageSizes?: ImageSizes,
  /*
   * THE PAGE'S OWN TREE PASSES TRUE, the header and the footer do not.
   *
   * Only one picture on a page should be eager, and on a travel site it is the
   * hero in the first section rather than a logo in the bar above it. eachBlock
   * walks in document order, so the first block here that actually draws a
   * picture takes the slot and every block after it is told the slot has gone.
   *
   * A header logo therefore comes out lazy, which sounds worse than it is: a
   * browser fetches a lazy image that is already in the viewport straight away.
   * What lazy really buys is the picture four sections down not racing the hero.
   */
  options?: { heroFirst?: boolean },
): PreparedMap {
  const out: PreparedMap = {};
  if (!Array.isArray(sections)) return out;

  let heroAvailable = options?.heroFirst === true;

  eachBlock(sections, (block) => {
    // Absent unless the caller is rendering, which is what keeps the save path
    // and the editor canvas byte-for-byte what they were.
    const priority = imageSizes ? { heroFirst: heroAvailable } : undefined;
    const entry = prepareBlock(block, imageSizes, priority);
    if (!entry) return;
    if (heroAvailable && (entry.images ?? 0) > 0) heroAvailable = false;
    out[block.id] = entry;
  });
  return out;
}

/** The same, for a whole page. */
export function preparePage(
  page: Pick<Page, 'sections'> | null | undefined,
  imageSizes?: ImageSizes,
): PreparedMap {
  return prepareSections(page?.sections, imageSizes);
}

/**
 * One map from several trees.
 *
 * A published page draws its header and its footer as well as itself, and all
 * three render through one PageRenderer chain each but share the block-id space,
 * so the caller merges rather than juggling three maps.
 */
export function mergePrepared(...maps: readonly PreparedMap[]): PreparedMap {
  return Object.assign({}, ...maps) as PreparedMap;
}
