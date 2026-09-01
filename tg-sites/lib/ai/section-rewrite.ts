/**
 * Rewriting the words of ONE section, in place, on an instruction.
 *
 * The section-level counterpart to the page fill. A person selects a section in
 * the editor and says "make it warmer" or "shorter" or "for families", and this
 * rewrites the words in that section's slots and NOTHING ELSE: the layout, the
 * blocks, the pictures, the design all stay exactly as they were. It is the same
 * discipline as home-personalise (only text, only slots, invent nothing) applied
 * to a native preset or AI-built section rather than a frozen imported one.
 *
 * TWO SLOT SYSTEMS, ONE INTENT. A native section (built from a preset or by the
 * AI) exposes its words through page-fill's slotsOf/applyFill. A section that is
 * a frozen imported design (a seeded designed home) exposes them through
 * home-personalise's homeTextSlots/applyHomeCopy. sectionIsImported picks the
 * path; the caller runs the model in between. Everything here is pure so the
 * action stays a thin money-and-network wrapper.
 */

import type { Section } from '../content/schema';
import type { SiteSettings } from '../settings/schema';
import { HOUSE_RULES, profileBlock } from './prompt';
import { FILL_OUTPUT_SHAPE, type Slot } from './page-fill';

/** True when the section is a frozen imported design rather than native blocks. */
export function sectionIsImported(section: Section): boolean {
  return section.rows.some((row) =>
    row.columns.some((column) => column.blocks.some((block) => block.type === 'imported')),
  );
}

/** The longest an instruction may be. A tone, not an essay. */
export const MAX_REWRITE_INSTRUCTION = 200;

export const REWRITE_RULES = `You are given the words currently in ONE section of a travel company's website, slot by slot, in reading order. Rewrite each slot as the instruction asks, and change nothing else about it.

- KEEP EACH SLOT'S LENGTH AND ROLE. A one-line heading stays one line, a paragraph stays a paragraph, a two or three word label stays that short. The section was designed around these lengths and a slot that doubles breaks its layout.
- Apply the instruction to every slot, in the house voice. If the instruction is a tone ("warmer", "more formal") carry it through all of them; if it names an audience ("for families") speak to that audience.
- You are REPHRASING what is there, not researching. Invent no fact the slot did not already carry: no new price, date, award, rating, place or number. A regulated claim (ATOL, ABTA, protection) stays general and keeps no invented number.
- A heading carries no full stop unless it is a question.
- Return EVERY slot you are given; a slot you leave out keeps its current words.`;

export function buildRewriteSystemPrompt(settings: SiteSettings): string {
  return [HOUSE_RULES, REWRITE_RULES, FILL_OUTPUT_SHAPE, profileBlock(settings)]
    .filter(Boolean)
    .join('\n\n');
}

/** The section's slots and the instruction, for a native rewrite. */
export function buildRewriteUserPrompt(instruction: string, slots: readonly Slot[]): string {
  const list = slots
    .map((slot) => `${slot.id} (${slot.kind}): ${slot.current || '[empty]'}`)
    .join('\n');
  return `Rewrite the words in each of these slots so they are: ${instruction}\n\nKeep every slot's length and role.\n\n${list}`;
}

/** The same, for an imported (designed) section, addressed by home-personalise's ids. */
export function buildImportedRewriteUserPrompt<
  T extends { block: number; key: string; label: string; value: string },
>(instruction: string, slots: readonly T[], slotIdOf: (slot: T) => string): string {
  const list = slots
    .map((slot) => `${slotIdOf(slot)} (${slot.label}): ${slot.value}`)
    .join('\n');
  return `Rewrite the words in each of these slots so they are: ${instruction}\n\nKeep every slot's length and role, and do not touch the design.\n\n${list}`;
}
