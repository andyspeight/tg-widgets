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

/**
 * Room for the whole answer PLUS the thinking, sized to the slot cap.
 *
 * Raised with MAX_SLOTS after the review round: ninety-odd slots of copy plus
 * composite keys plus adaptive thinking can pass 8k, and a truncated answer
 * fails the JSON parse and silently discards the ENTIRE fill — the worst
 * possible exchange, one over-long answer for a whole placeholder page.
 */
export const FILL_MAX_TOKENS = 16384;

/**
 * The most slots offered in one go.
 *
 * Sized so a full twelve-section plan FITS — a cap that a real page can hit is
 * not a cap, it is a cliff: everything past it kept factory copy, and factory
 * card copy is unstrippable by the placeholder pass. Blocks are offered
 * ATOMICALLY against this cap (see slotsOf): a block whose slots do not all
 * fit is not offered at all, because half-filling a card ships a fresh title
 * on a factory body, and stripUnfilled then removes the whole unoffered block
 * rather than letting it ship as somebody else's example.
 */
export const MAX_SLOTS = 96;

/** The most items of one repeater offered. Past eight, nobody is reading them. */
const MAX_ITEMS = 8;

/** A heading is a line. A paragraph is a paragraph. */
const MAX_HEADING = 90;
const MAX_BODY = 400;

/** One thing on the page that needs words. */
export interface Slot {
  /**
   * The block's own id, or a composite address into a block's items:
   * `blk_x` for a heading or paragraph's html, `blk_x:item:2:title` for one
   * field of one card or step, `blk_x:prop:title` for a field that sits
   * directly on the block's props (an icon-item). Composite, because the model
   * answers with these keys and an id it was never offered is dropped — so
   * copy cannot land in the wrong slot however shuffled the answer.
   */
  id: string;
  /** 'heading' or 'text', so the model knows a line from a paragraph. */
  kind: 'heading' | 'text';
  /**
   * True when the destination is a PLAIN-TEXT prop rather than a block's html.
   *
   * The difference is the apostrophe bug, third time round. Heading and text
   * blocks store html, so their words are HTML-escaped on the way in. A card
   * item's title is a plain string that React escapes at render — escaping it
   * here too would ship "Halcyon Bay&#39;s" into the editor and the page.
   */
  plain?: boolean;
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
/** The block types whose content the structured fill knows how to write. */
export const STRUCTURED_TYPES = new Set(['cards', 'steps', 'icon-item', 'list']);

/** The composite slots one structured block wants, or none for other types. */
function blockSlots(block: Block): Slot[] {
  /*
   * COMPOSITE KEYS NEED THE COLON TO BE OURS. App-minted ids are base36 after
   * `blk_`, so a colon can never appear in one — but the schema only requires
   * a non-empty string, and an imported page could carry anything. A block
   * whose own id contains a colon is skipped rather than risking an ambiguous
   * parse.
   */
  if (block.id.includes(':')) return [];

  const out: Slot[] = [];
  const props = (block.props ?? {}) as Record<string, unknown>;

  const itemField = (index: number, field: string, value: unknown, kind: Slot['kind']) => {
    // Only fields the item actually carries. An empty field is a design
    // choice (a card with no label), not a slot waiting for words.
    const current = typeof value === 'string' ? value.trim() : '';
    if (!current) return;
    out.push({ id: `${block.id}:item:${index}:${field}`, kind, plain: true, current: current.slice(0, 200) });
  };

  if (block.type === 'cards' || block.type === 'steps') {
    const items = Array.isArray(props.items) ? (props.items as Array<Record<string, unknown>>) : [];
    items.slice(0, MAX_ITEMS).forEach((item, index) => {
      // The fields a card carries; a step has only the first two.
      itemField(index, 'title', item.title, 'heading');
      itemField(index, 'body', item.body, 'text');
      itemField(index, 'label', item.label, 'heading');
      itemField(index, 'linkLabel', item.linkLabel, 'heading');
    });
  } else if (block.type === 'list') {
    // A tick list's entries are pure copy — and the factory ones include
    // "ATOL protected", which is a trust claim nobody should ship unwritten.
    const items = Array.isArray(props.items) ? (props.items as Array<Record<string, unknown>>) : [];
    items.slice(0, MAX_ITEMS).forEach((item, index) => {
      itemField(index, 'text', item.text, 'heading');
    });
  } else if (block.type === 'icon-item') {
    // A single item whose fields sit directly on props.
    const title = typeof props.title === 'string' ? props.title.trim() : '';
    const body = typeof props.body === 'string' ? props.body.trim() : '';
    if (title) out.push({ id: `${block.id}:prop:title`, kind: 'heading', plain: true, current: title.slice(0, 200) });
    if (body) out.push({ id: `${block.id}:prop:body`, kind: 'text', plain: true, current: body.slice(0, 200) });
  }

  return out;
}

export function slotsOf(sections: readonly Section[]): Slot[] {
  const slots: Slot[] = [];

  for (const section of sections) {
    for (const row of section.rows) {
      for (const column of row.columns) {
        for (const block of column.blocks) {
          if (block.type === 'heading' || block.type === 'text') {
            // The colon guard holds here too: a heading whose imported id
            // happens to LOOK like a composite key would otherwise double-fill
            // some other block's card item.
            if (block.id.includes(':')) continue;
            if (slots.length < MAX_SLOTS) {
              slots.push({ id: block.id, kind: block.type, current: visible(block).slice(0, 200) });
            }
            continue;
          }

          /*
           * ATOMIC PER BLOCK. Offering half a card's fields ships a hybrid: a
           * freshly written title sitting on a factory body about the Amalfi
           * coast. So a block's slots go in together or not at all — and a
           * block offered not at all is provably unfilled, which is exactly
           * what stripUnfilled removes.
           */
          const wanted = blockSlots(block);
          if (wanted.length > 0 && slots.length + wanted.length <= MAX_SLOTS) {
            slots.push(...wanted);
          }
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
- Slots addressed like "id:item:2:title" are one entry in a row of cards or steps. Each entry is its own thing: three cards saying the same thing in different words read as padding. A "label" is two or three words (a place, a date, a price band). A "linkLabel" is a short invitation like "See the island", never a sentence.
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
 * ESCAPED BY DESTINATION, not uniformly, and the difference is a bug this
 * feature has now had twice. Words bound for a heading or text block's html
 * are HTML-escaped on the way in, the escape-first rule the page builder and
 * the copy writer follow. Words bound for a PLAIN prop (a card item's title, a
 * step's body) are stripped to text and nothing more, because React escapes
 * them at render and a second escape ships "&#39;" to the screen.
 */
export function fillFromModel(answer: unknown, slots: readonly Slot[]): FillResult {
  const parsed = typeof answer === 'string' ? extractJson(answer) : answer;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'the answer was not a JSON object' };
  }

  const wanted = new Map(slots.map((slot) => [slot.id, { kind: slot.kind, plain: slot.plain === true }]));
  const record = parsed as Record<string, unknown>;
  const copy: Record<string, string> = {};

  for (const [id, value] of Object.entries(record)) {
    const slot = wanted.get(id);
    // An id we did not offer is not a slot on this page.
    if (!slot) continue;

    /*
     * SLICED BY CODE POINTS, BEFORE ESCAPING. A .slice on the string bisects
     * surrogate pairs (an emoji becomes a lone half) and, applied after
     * escaping, bisects entities (a literal "&am" lands on the page). Slicing
     * the plain text by code points first, then escaping, cannot do either.
     */
    const text = [...toText(value)]
      .slice(0, slot.kind === 'heading' ? MAX_HEADING : MAX_BODY)
      .join('')
      .trim();
    const words = slot.plain ? text : escapeHtml(text);
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
/**
 * Remove structured blocks the fill provably never reached.
 *
 * THE FAILURE PATH'S AMALFI PROBLEM. When the fill call dies, heading and text
 * placeholders are caught by the placeholder stripper — but a card's factory
 * copy lives in plain props that stripper cannot see, so a Caribbean site whose
 * fill failed still shipped "The Amalfi coast, slowly". Rendered and confirmed,
 * not theorised: the failure-path harness showed Amalfi back on the page.
 *
 * THE SLOTS ARE THE EVIDENCE. Every structured field the fill was going to
 * write was captured as a slot BEFORE the call, with what it said at the time.
 * So "was this block filled" has an exact answer: compare each field's value in
 * the final tree with the slot's recorded current. A block where EVERY offered
 * field is unchanged was never written, and its content is still a preset's
 * example — some other company's coast, invented trip names. Wrong words on a
 * client's site are worse than a shorter page, so the block goes.
 *
 * A PARTLY-FILLED block stays: one field the model skipped is a flaw, not a
 * fabrication, and dropping the whole block for it would throw away good copy.
 * On the success path every block changed, so this is a no-op that costs one
 * comparison per slot.
 */
export function stripUnfilled(sections: Section[], slots: readonly Slot[]): Section[] {
  /*
   * TWO WAYS TO BE UNFILLED. A block whose offered fields all still say what
   * they said was written by nobody. And a structured block that was NEVER
   * OFFERED — skipped whole at the slot cap, or carrying a type the fill
   * gained later — has factory copy by definition. Both ship somebody else's
   * example on a client's page, so both go. A structured block with no
   * offerable text at all (a collection-fed cards grid, whose items arrive at
   * render time) is neither, and stays.
   */
  // block id -> the composite slots offered for it, with what they said.
  const offered = new Map<string, Array<{ item?: number; field: string; current: string }>>();
  for (const slot of slots) {
    const itemMatch = /^(.+?):item:(\d+):(.+)$/.exec(slot.id);
    const propMatch = /^(.+?):prop:(.+)$/.exec(slot.id);
    if (!itemMatch && !propMatch) continue;
    const blockId = (itemMatch ?? propMatch)![1];
    const list = offered.get(blockId) ?? [];
    if (itemMatch) list.push({ item: Number(itemMatch[2]), field: itemMatch[3], current: slot.current });
    else list.push({ field: propMatch![2], current: slot.current });
    offered.set(blockId, list);
  }

  const untouched = (block: Block): boolean => {
    const fields = offered.get(block.id);
    if (!fields || fields.length === 0) {
      // Never offered: unfilled exactly when there was something to offer.
      return STRUCTURED_TYPES.has(block.type) && blockSlots(block).length > 0;
    }
    const props = (block.props ?? {}) as Record<string, unknown>;
    const items = Array.isArray(props.items) ? (props.items as Array<Record<string, unknown>>) : [];

    return fields.every(({ item, field, current }) => {
      const value = item === undefined ? props[field] : items[item]?.[field];
      const now = typeof value === 'string' ? value.trim().slice(0, 200) : '';
      return now === current;
    });
  };

  const kept: Section[] = [];
  for (const section of sections) {
    const rows = section.rows
      .map((row) => ({
        ...row,
        columns: row.columns
          .map((column) => ({
            ...column,
            blocks: column.blocks.filter((block) => !untouched(block)),
          }))
          .filter((column) => column.blocks.length > 0),
      }))
      .filter((row) => row.columns.length > 0);
    if (rows.length > 0) kept.push({ ...section, rows });
  }
  return kept;
}

/** The composite answers addressed to one block, parsed off their keys. */
function answersFor(blockId: string, copy: Record<string, string>) {
  const items: Array<{ index: number; field: string; words: string }> = [];
  const props: Array<{ field: string; words: string }> = [];

  const itemPrefix = `${blockId}:item:`;
  const propPrefix = `${blockId}:prop:`;

  for (const [key, words] of Object.entries(copy)) {
    if (key.startsWith(itemPrefix)) {
      const [indexPart, field] = key.slice(itemPrefix.length).split(':');
      const index = Number(indexPart);
      if (Number.isInteger(index) && index >= 0 && field) items.push({ index, field, words });
    } else if (key.startsWith(propPrefix)) {
      const field = key.slice(propPrefix.length);
      if (field) props.push({ field, words });
    }
  }

  return { items, props };
}

/** The item fields the fill is allowed to write. Nothing structural, ever. */
const ITEM_FIELDS = new Set(['title', 'body', 'label', 'linkLabel', 'text']);
const PROP_FIELDS = new Set(['title', 'body']);

export function applyFill(sections: Section[], copy: Record<string, string>): Section[] {
  return sections.map((section) => ({
    ...section,
    rows: section.rows.map((row) => ({
      ...row,
      columns: row.columns.map((column) => ({
        ...column,
        blocks: column.blocks.map((block) => {
          if (block.type === 'heading' || block.type === 'text') {
            // The same colon guard as the offer side: an imported heading whose
            // id looks like a composite key is nobody's slot.
            if (block.id.includes(':')) return block;
            const words = copy[block.id];
            if (!words) return block;
            return {
              ...block,
              props: {
                ...block.props,
                // A heading is written bare; a paragraph is wrapped, the same shape
                // buildSection uses so the renderer sees nothing new.
                html: block.type === 'heading' ? words : `<p>${words}</p>`,
              },
            };
          }

          const { items, props } = answersFor(block.id, copy);

          if ((block.type === 'cards' || block.type === 'steps' || block.type === 'list') && items.length > 0) {
            const existing = (block.props as Record<string, unknown>)?.items;
            if (!Array.isArray(existing)) return block;

            const next = (existing as Array<Record<string, unknown>>).map((item) => ({ ...item }));
            for (const { index, field, words } of items) {
              /*
               * Only a field the item ALREADY carries non-empty, and only from
               * the allowed set. The fill writes words into slots that exist;
               * it cannot add a field the design left out, and an index past
               * the array is dropped rather than growing it.
               */
              if (!ITEM_FIELDS.has(field)) continue;
              const item = next[index];
              if (!item) continue;
              if (typeof item[field] !== 'string' || !(item[field] as string).trim()) continue;
              item[field] = words;
            }
            return { ...block, props: { ...block.props, items: next } };
          }

          if (block.type === 'icon-item' && props.length > 0) {
            const nextProps = { ...(block.props as Record<string, unknown>) };
            for (const { field, words } of props) {
              if (!PROP_FIELDS.has(field)) continue;
              if (typeof nextProps[field] !== 'string' || !(nextProps[field] as string).trim()) continue;
              nextProps[field] = words;
            }
            return { ...block, props: nextProps };
          }

          return block;
        }),
      })),
    })),
  }));
}
