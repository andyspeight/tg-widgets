/**
 * Does a tree hold a motion recipe that needs the script?
 *
 * The same shape as lib/content/slideshow.ts, and here for the same reason: it is a
 * plain walk over a page shape, testable without a DOM or a JSX transform, and the
 * MotionScript component only maps its answer to a tag.
 *
 * WHY THIS IS A SHORT LIST AND MUST STAY ONE. Clause 1 of the rule in
 * lib/content/blocks.ts is that a page which asks for nothing ships nothing, so this
 * asks the narrow question "does anything here need tg-motion.js" and not the broad
 * one "does anything here move". A page with no reveal, no parallax and no A3 stays
 * exactly as script-free as it was.
 *
 * THREE THINGS PULL THE SCRIPT NOW, not one (31 Aug 2026). The A3 drifting-rail recipe
 * always needs it. Reveal and parallax added it because they are scroll-driven CSS on a
 * view() timeline that only Chromium ships, so the script carries a fallback for the
 * browsers that lack it; where the timeline is present the script runs nothing (it
 * feature-detects), so this is still "the page might need it", not "the page will use
 * it". Ken Burns, the gradient and the ambient recipes are time-based CSS that plays
 * everywhere, so they never appear here.
 *
 * Motion lives on the SECTION, so unlike the slideshow walk this never has to reach
 * into rows, columns and blocks.
 */

import { MOTION_SCRIPT_RECIPES, type MotionRecipe } from './schema';

/** Anything with sections: a Page, a header, a footer. */
export type Tree = { sections?: unknown } | null | undefined;

/** A section-shaped thing, as it arrives from stored JSON. */
type LooseSection = { motion?: { recipe?: unknown } | null; reveal?: unknown; parallax?: unknown };

/**
 * True when any section in the tree needs tg-motion.js: an A3 recipe, or a reveal or a
 * parallax (which need the script only as a fallback where scroll timelines are absent).
 *
 * Reads the stored shape defensively rather than assuming a parsed Page, because the
 * routes that assemble a document hand this whatever came out of the database.
 */
export function needsMotionScript(tree: Tree): boolean {
  const sections = tree && typeof tree === 'object' ? (tree as { sections?: unknown }).sections : null;
  if (!Array.isArray(sections)) return false;

  return sections.some((raw) => {
    if (!raw || typeof raw !== 'object') return false;
    const section = raw as LooseSection;
    // Reveal or parallax pull the fallback. Both are stored as true when on.
    if (section.reveal === true || section.parallax === true) return true;
    const motion = section.motion;
    if (!motion || typeof motion !== 'object') return false;
    const recipe = (motion as { recipe?: unknown }).recipe;
    return typeof recipe === 'string' && MOTION_SCRIPT_RECIPES.has(recipe as MotionRecipe);
  });
}

/** True when ANY of the trees making up a document needs the script. */
export function anyNeedsMotionScript(trees: ReadonlyArray<Tree>): boolean {
  return trees.some((tree) => needsMotionScript(tree));
}

/**
 * True when any section carries the WebGL sea (A1), which loads a DIFFERENT file,
 * public/tg-sea.js, the shader engine. Kept apart from needsMotionScript so a page
 * with a drifting rail does not pull the sea and a page with the sea does not pull
 * the rail: two files, each conditional, neither dragging the other onto a page.
 */
export function needsSeaScript(tree: Tree): boolean {
  const sections = tree && typeof tree === 'object' ? (tree as { sections?: unknown }).sections : null;
  if (!Array.isArray(sections)) return false;
  return sections.some((raw) => {
    if (!raw || typeof raw !== 'object') return false;
    const motion = (raw as LooseSection).motion;
    if (!motion || typeof motion !== 'object') return false;
    return (motion as { recipe?: unknown }).recipe === 'A1';
  });
}

/** True when ANY of the trees making up a document carries the sea. */
export function anyNeedsSeaScript(trees: ReadonlyArray<Tree>): boolean {
  return trees.some((tree) => needsSeaScript(tree));
}
