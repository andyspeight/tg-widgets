/**
 * Does a tree hold a motion recipe that needs the script?
 *
 * The same shape as lib/content/slideshow.ts, and here for the same reason: it is a
 * plain walk over a page shape, testable without a DOM or a JSX transform, and the
 * MotionScript component only maps its answer to a tag.
 *
 * WHY THIS IS A SHORT LIST AND MUST STAY ONE. Clause 1 of the rule in
 * lib/content/blocks.ts is that a page which asks for nothing ships nothing. Seven of
 * the eight recipes built so far are pure CSS and must never pull a script onto a
 * page, so this asks the narrow question "does anything here need tg-motion.js" and
 * not the broad one "does anything here move". A page whose only movement is a
 * drifting background stays exactly as script-free as it was.
 *
 * Motion lives on the SECTION, so unlike the slideshow walk this never has to reach
 * into rows, columns and blocks.
 */

import { MOTION_SCRIPT_RECIPES, type MotionRecipe } from './schema';

/** Anything with sections: a Page, a header, a footer. */
export type Tree = { sections?: unknown } | null | undefined;

/** A section-shaped thing, as it arrives from stored JSON. */
type LooseSection = { motion?: { recipe?: unknown } | null };

/**
 * True when any section in the tree carries a recipe that needs tg-motion.js.
 *
 * Reads the stored shape defensively rather than assuming a parsed Page, because the
 * routes that assemble a document hand this whatever came out of the database.
 */
export function needsMotionScript(tree: Tree): boolean {
  const sections = tree && typeof tree === 'object' ? (tree as { sections?: unknown }).sections : null;
  if (!Array.isArray(sections)) return false;

  return sections.some((raw) => {
    if (!raw || typeof raw !== 'object') return false;
    const motion = (raw as LooseSection).motion;
    if (!motion || typeof motion !== 'object') return false;
    const recipe = (motion as { recipe?: unknown }).recipe;
    return typeof recipe === 'string' && MOTION_SCRIPT_RECIPES.has(recipe as MotionRecipe);
  });
}

/** True when ANY of the trees making up a document needs the script. */
export function anyNeedsMotionScript(trees: ReadonlyArray<Tree>): boolean {
  return trees.some((tree) => needsMotionScript(tree));
}
