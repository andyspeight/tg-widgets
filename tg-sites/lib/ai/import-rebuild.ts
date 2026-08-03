/**
 * The prompt for the import rebuild fallback.
 *
 * WHEN THIS IS USED. The deterministic recogniser in lib/import/rebuild.ts reads
 * most designs on its own, for free and exactly. When a design's markup is too
 * unusual for it to structure, the action falls back to the model, and this is
 * what it sends: the house voice, one job (REBUILD, not invent), the block kit,
 * the output shape, and the client's own content as an outline.
 *
 * THE ONE RULE THAT MATTERS. It is rebuilding a real section a client sliced off
 * their own or another site, so the words are not the model's to change. The
 * rules below say so three ways, because a rebuild that quietly reworded a price
 * or a claim would put a lie on the client's page. The words are pinned; only
 * the layout is the model's to decide.
 *
 * PURE, like the rest of the prompt layer. The action owns the login, the
 * allowance and the single network call; everything here is a string built from
 * the palette and the profile, which is the part that can be tested.
 */

import type { SiteSettings } from '../settings/schema';

import { blockPalette, paletteText } from './palette';
import { HOUSE_RULES, profileBlock } from './prompt';
import { OUTPUT_SHAPE } from './section-build';

export const REBUILD_RULES = `Your job here is to REBUILD a section a client captured from another website, as blocks from the kit. You are GIVEN its content as an outline. You are not writing new copy, and you are not inventing a section from a brief.

USE THE WORDS YOU ARE GIVEN, AND ONLY THOSE.
- Every line of the outline must appear in your section. Do not drop any of it.
- Do not invent, reword, rewrite, summarise, correct or translate. The words are the client's, exactly as written. A price, a name, a number or a claim you change is a lie on their site.
- Do not add a heading, a point, a button or a sentence that is not in the outline.

HOW TO READ THE OUTLINE.
- A line starting with "# " is a heading.
- A line starting with "* " is a list item; a run of them is one list.
- "[image: ...]" is a picture: use an image block and leave its src empty, since the client sets the picture.
- "[button: ...]" is a call to action.
- A short title line with a sentence under it is one point: put the two together in a single icon-and-text block and choose a fitting icon.

HOW TO LAY IT OUT. The way it reads. A run of points is a row of two to four columns; a single statement is one wide column. Match the shape of what was captured rather than redesigning it. Pick a section tone that suits the content.`;

/** The system prompt for a rebuild: house voice, the rebuild job, the kit, the brand. */
export function rebuildSystemPrompt(settings: SiteSettings): string {
  return [
    HOUSE_RULES,
    REBUILD_RULES,
    `BLOCKS you may use:\n${paletteText(blockPalette())}`,
    OUTPUT_SHAPE,
    profileBlock(settings),
  ].join('\n\n');
}

/** The captured content, handed over for the model to lay out as blocks. */
export function rebuildUserPrompt(outline: string): string {
  const clean = outline.slice(0, 6000);
  return `Rebuild this captured section as blocks, using these exact words and adding nothing:\n\n<content>\n${clean}\n</content>`;
}
