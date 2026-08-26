/**
 * The second pass: giving every slot on a built page its own words.
 *
 * WHY THERE IS A SECOND PASS AT ALL. The page builder chooses an ordered list of
 * our designed sections and writes two things into each: a heading and one
 * paragraph. Everything else a preset holds — the tagline under a hero, the
 * three feature items, the questions in an FAQ — keeps the copy the preset ships
 * with to show an author what goes where. So a page could have nine sections and
 * still be scaffolding with a real headline on top.
 *
 * Andy, 26 Aug 2026, on the first site the builder produced: "it's very poor. No
 * images. Placeholder text. Short pages." Those are three descriptions of this
 * one fault. Nine of the twelve pages carried preset instructions.
 *
 * WHY NOT ONE BIGGER FIRST CALL. The model cannot write a preset's slots until
 * it has chosen the preset, and putting every slot of all fifty-odd presets into
 * the planning prompt to make that possible would be an enormous prompt to
 * answer one question. Choosing and filling are two decisions, so they are two
 * calls, and each stays small enough to be reliable.
 *
 * KEYED ON BLOCK ID, NOT POSITION. Each fillable block is offered to the model
 * with the id it already has, and the answer is applied by looking that id up.
 * A model that skips one, invents one or returns them shuffled cannot move copy
 * into the wrong slot: an unknown id is dropped and a missing one keeps what it
 * had, which the placeholder stripper then removes.
 *
 * TEXT ONLY, AND NEVER STRUCTURE. This replaces the words inside heading and
 * text blocks. It cannot add a block, remove one, reorder them or touch a
 * button, a picture or a layout. The worst a bad answer can do is write a poor
 * sentence into a slot that already existed.
 */

import { escapeHtml } from '../content/sanitise';
import type { Block, Section } from '../content/schema';
import { extractJson } from './section-build';
import { HOUSE_RULES, profileBlock } from './prompt';
import { toText } from './copy';
import type { SiteSettings } from '../settings/schema';

/** Long enough for a dozen slots of real copy, capped so it cannot run away. */
export const FILL_MAX_TOKENS = 8192;

/**
 * The most slots offered in one go.
 *
 * A page of eight sections has perhaps twenty. Past this the answer is long
 * enough to be unreliable, and the tail is the least important copy on the page,
 * so the rest keep their factory text and the stripper takes them out.
 */
export const MAX_SLOTS = 24;

/** A heading is a line. A paragraph is a paragraph. */
const MAX_HEADING = 90;
const MAX_BODY = 400;

/** One thing on the page that needs words. */
export interface Slot {
  id: string;
  /** 'heading' or 'text', so the model knows a line from a paragraph. */
  kind: 'heading' | 'text';
  /** What the preset put there, which says what the slot is FOR. */
  current: string;
}

/** The words a block shows, with any markup taken off. */
function visible(block: Block): string {
  const html = typeof block.props?.html === 'string' ? (block.props.html as string) : '';
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Every heading and paragraph on a page, in the order somebody reads them.
 *
 * INCLUDING THE ONES ALREADY WRITTEN, and that is deliberate. The model is
 * composing a page, not patching one, and it writes a better tagline when it can
 * see the headline above it. The first pass's heading and paragraph are simply
 * offered back with everything else, and it may improve them or leave them.
 */
export function slotsOf(sections: readonly Section[]): Slot[] {
  const slots: Slot[] = [];

  for (const section of sections) {
    for (const row of section.rows) {
      for (const column of row.columns) {
        for (const block of column.blocks) {
          if (slots.length >= MAX_SLOTS) return slots;
          if (block.type !== 'heading' && block.type !== 'text') continue;
          slots.push({
            id: block.id,
            kind: block.type,
            current: visible(block).slice(0, 200),
          });
        }
      }
    }
  }

  return slots;
}

// ---------------------------------------------------------------------------
// The prompt
// ---------------------------------------------------------------------------

export const FILL_RULES = `Your job here is to WRITE THE WORDS for one page of a travel company's website. The page's shape is already decided: below is every heading and paragraph on it, in the order a visitor reads them, with what each one currently says.

You are writing for a travel business: an agency, a tour operator or a travel adviser.
- These sites sell an ENQUIRY, not a checkout. A call to action is "Start an enquiry", "Talk to us", "Get a quote", never "Buy now".
- Trust is the currency: how long they have done this, who they are, what protects a customer's money.
- The subject is places and trips. Keep it concrete: name the island, the coast, the flight time, the kind of stay.

How to write them:
- Write EVERY slot you are given. A slot you skip keeps the placeholder it has now, and a page with "This is a short title" on it reads as broken.
- What a slot currently says tells you what it is FOR. "Tagline here" under a headline wants one line of support, not a second headline. A short title above a paragraph in a list of questions wants a question.
- A heading is one line and carries no full stop unless it is a question. A paragraph is one to three sentences.
- Do not repeat yourself. The same fact stated in three sections reads as padding, and a visitor scanning the page sees it at once.
- Invent no facts. No price, date, award, number, rating or place detail the profile and the brief did not give you. Where a claim would help and you do not have it, write around it. That applies twice over to terms, privacy and financial protection: say what the page covers and that the company sets out the detail, never invented policy.`;

export const FILL_OUTPUT_SHAPE = `Return a JSON object and NOTHING else. No prose before or after, no markdown fences. Each key is a slot id exactly as given, each value is the words for it as plain text with no markup:

{
  "blk_a1b2": "Where the west coast goes quiet",
  "blk_c3d4": "Seven villas we know well, all within a walk of the water."
}

Every id you were given should appear once. Do not invent ids and do not return anything else.`;

export function buildFillSystemPrompt(settings: SiteSettings): string {
  return [HOUSE_RULES, FILL_RULES, FILL_OUTPUT_SHAPE, profileBlock(settings)]
    .filter(Boolean)
    .join('\n\n');
}

/** The page being written, and every slot on it. */
export function buildFillUserPrompt(title: string, purpose: string, slots: readonly Slot[]): string {
  const list = slots
    .map((slot) => `${slot.id} (${slot.kind}): ${slot.current || '[empty]'}`)
    .join('\n');

  const about = purpose ? `The page is "${title}". ${purpose}` : `The page is "${title}".`;

  return `${about}\n\nWrite the words for each of these slots:\n\n${list}`;
}

export function repairFillPrompt(reason: string): string {
  return `That could not be used: ${reason}. Answer again with the JSON object only, keyed by the slot ids given, and nothing else.`;
}

// ---------------------------------------------------------------------------
// The safety net
// ---------------------------------------------------------------------------

export type FillResult =
  | { ok: true; copy: Record<string, string> }
  | { ok: false; error: string };

/**
 * Whatever the model said, turned into copy we would put on a page.
 *
 * Escaped here, the escape-first rule the page builder and the copy writer both
 * follow: these words are written straight into a block's html.
 */
export function fillFromModel(answer: unknown, slots: readonly Slot[]): FillResult {
  const parsed = typeof answer === 'string' ? extractJson(answer) : answer;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'the answer was not a JSON object' };
  }

  const wanted = new Map(slots.map((slot) => [slot.id, slot.kind]));
  const record = parsed as Record<string, unknown>;
  const copy: Record<string, string> = {};

  for (const [id, value] of Object.entries(record)) {
    const kind = wanted.get(id);
    // An id we did not offer is not a slot on this page.
    if (!kind) continue;

    const words = escapeHtml(toText(value)).slice(0, kind === 'heading' ? MAX_HEADING : MAX_BODY).trim();
    if (words) copy[id] = words;
  }

  if (Object.keys(copy).length === 0) return { ok: false, error: 'none of the slots came back' };
  return { ok: true, copy };
}

/**
 * The copy, written into the page.
 *
 * A slot the model did not answer keeps what it had, which for a preset's own
 * instruction means the placeholder stripper removes it. That is the right
 * order: better a shorter page than one carrying "Tagline here".
 */
export function applyFill(sections: Section[], copy: Record<string, string>): Section[] {
  return sections.map((section) => ({
    ...section,
    rows: section.rows.map((row) => ({
      ...row,
      columns: row.columns.map((column) => ({
        ...column,
        blocks: column.blocks.map((block) => {
          const words = copy[block.id];
          if (!words) return block;
          if (block.type !== 'heading' && block.type !== 'text') return block;

          return {
            ...block,
            props: {
              ...block.props,
              // A heading is written bare; a paragraph is wrapped, the same shape
              // buildSection uses so the renderer sees nothing new.
              html: block.type === 'heading' ? words : `<p>${words}</p>`,
            },
          };
        }),
      })),
    })),
  }));
}
