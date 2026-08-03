/**
 * The section builder's engine: the prompt it sends, and the safety net that
 * turns whatever the model says back into a real, editable Section.
 *
 * SPLIT FROM THE ACTION ON PURPOSE. The action (app/actions/ai.ts) owns the
 * money and the membership: it checks the login, the daily allowance and the
 * key, and it makes the one network call. Everything in THIS file is pure, so it
 * is the part that can be tested without a login, a database or a penny spent:
 * the prompt is a string built from the palette and the profile, and the
 * normaliser is data in, data out. The non-deterministic bit is the single line
 * in the action that calls the model; it has no logic to test.
 *
 * THE NORMALISER IS THE WHOLE GAME. A model asked for JSON will now and then
 * return a block that does not exist, a prop that is not a field, a colour that
 * is not a colour, or six columns that should be three. So its answer is never
 * trusted as a Section. It is walked: only real blocks survive, only real fields
 * are kept, every value goes through the same sanitiser a hand-built block does,
 * and the whole thing is run through SectionSchema, which fills the defaults and
 * squares the column widths. What comes out the far side is a Section as valid
 * as one dragged together by hand, or an honest failure. That is what lets the
 * built section be edited the instant it lands: it IS one of ours.
 */

import { blockDefinition, defaultPropsFor, isKnownBlock, type Field } from '../content/blocks';
import { createBlock, createColumn, createRow, createSection } from '../content/factory';
import { sanitiseBlock } from '../content/sanitise-page';
import { SectionSchema, type Block, type Section } from '../content/schema';
import type { SiteSettings } from '../settings/schema';
import { blockPalette, BUILDER_EXCLUDES, paletteText } from './palette';
import { HOUSE_RULES, profileBlock } from './prompt';

/** How much of one build we are willing to accept, so a runaway cannot land. */
const MAX_ROWS = 8;
const MAX_COLUMNS = 6;
const MAX_BLOCKS_PER_COLUMN = 12;
const MAX_BLOCKS = 40;

/** The request cap, applied here as well as at the action boundary. */
export const MAX_BUILD_INSTRUCTION = 600;

/** Long enough for a rich section of JSON, capped so a build cannot run away. */
export const BUILD_MAX_TOKENS = 4096;

export type BuildResult =
  | { ok: true; section: Section }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// The prompt
// ---------------------------------------------------------------------------

/**
 * What the builder is, over the top of the house voice rules.
 *
 * This is the travel-and-structure layer: it tells the model it is composing a
 * section of a real travel company's site out of a fixed kit, and what a good
 * one looks like in this industry rather than in general. The house rules
 * (UK English, no AI tells, invent no facts) still lead; this adds the job.
 */
export const SECTION_RULES = `Your job here is not to write a paragraph. It is to BUILD ONE SECTION of a travel company's website, by choosing blocks from a fixed kit and filling them in.

You are building for a travel business: an agency, a tour operator or a travel adviser. So think like one.
- These sites sell an ENQUIRY, not a checkout. The natural call to action is "Start an enquiry", "Talk to us", "Get a quote", never "Buy now" or "Add to basket".
- Trust is the currency. ABTA and ATOL protection, years in business, real people who have been to the places, and being on the end of the phone while someone travels, all matter more than slogans.
- The subject is places and trips: destinations, itineraries, resorts, the shape of a holiday. Keep it concrete.
- Do not invent a company name, a location, a price, an award or a number. If the profile below does not give you a fact, write around it.

How to build:
- Use ONLY the block types listed under BLOCKS. Never invent a type or a field.
- Put the blocks in rows and columns. A row of two or three columns reads as a set of points; one wide column reads as a statement. Two to four blocks is usually a section, not twenty.
- Fill each block's fields with real, on-brand words. Leave an image field empty; the client picks the picture. Leave a colour empty unless a colour genuinely helps.
- Pick a section tone that suits the content: light for most, subtle for a quiet band, dark or accent for a bold statement.`;

/** The output contract, spelled out so the model returns JSON and only JSON. */
export const OUTPUT_SHAPE = `Return ONE section as JSON and NOTHING else. No prose before or after, no markdown fences. The exact shape:

{
  "name": "a short name for this section, for the outline only",
  "tone": "light | subtle | dark | accent",
  "width": "narrow | contained | wide | full",
  "rows": [
    { "columns": [ { "blocks": [ { "type": "heading", "props": { "html": "..." } } ] } ] }
  ]
}

Every block is { "type": <one of the BLOCKS>, "props": { ...its fields } }. A row holds one or more columns; a column holds one or more blocks. Widths are worked out for you, so do not set them.`;

/** The system prompt: house voice, the builder's job, the kit, then the brand. */
export function buildSystemPrompt(settings: SiteSettings): string {
  return [
    HOUSE_RULES,
    SECTION_RULES,
    `BLOCKS you may use:\n${paletteText(blockPalette())}`,
    OUTPUT_SHAPE,
    profileBlock(settings),
  ].join('\n\n');
}

/** The request the person typed, capped and stripped of our own block tags. */
export function buildUserPrompt(instruction: string): string {
  const clean = instruction.replace(/<\/?(company|tone|avoid|copy|request)>/gi, '').trim().slice(0, MAX_BUILD_INSTRUCTION);
  return `Build this section:\n\n<request>\n${clean}\n</request>`;
}

/**
 * The follow-up when the first answer would not parse.
 *
 * One repair, not a loop: the reason is fed back so the model can correct the
 * one thing, and a second miss is a failure rather than a bill with no ceiling.
 */
export function repairUserPrompt(reason: string): string {
  return `That was not valid. ${reason}\n\nSend the section again as JSON only, in the exact shape you were given, using only the listed block types and their fields.`;
}

// ---------------------------------------------------------------------------
// The normaliser
// ---------------------------------------------------------------------------

/** Pull the JSON object out of a model answer that may be wrapped or chatty. */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();

  // A fenced ```json ... ``` block, if the model used one despite being asked not to.
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const candidate = fence ? fence[1].trim() : trimmed;

  // Straight parse first.
  try {
    return JSON.parse(candidate);
  } catch {
    // Otherwise the widest brace-to-brace span, which drops any stray prose.
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

const TONES = new Set(['light', 'subtle', 'dark', 'accent']);
const WIDTHS = new Set(['narrow', 'contained', 'wide', 'full']);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/**
 * Widths for n even columns that sum to EXACTLY 100.
 *
 * SectionSchema refuses a row whose columns do not sum to 100, and three even
 * columns at 33.33 sum to 99.99, which is the miss that failed the first cut.
 * Whole numbers with the remainder spread across the first few keep it exact:
 * three columns are 34, 33, 33.
 */
function evenWidths(n: number): number[] {
  const base = Math.floor(100 / n);
  const widths = Array.from({ length: n }, () => base);
  let remainder = 100 - base * n;
  for (let i = 0; remainder > 0; i += 1, remainder -= 1) widths[i] += 1;
  return widths;
}

/**
 * Keep only the props that are real fields of this block.
 *
 * A model prop that is not a field is dropped here rather than left for the
 * sanitiser: an unknown key would ride along in the stored content doing
 * nothing, and a section a person could not have made by hand is a section that
 * will confuse the next thing that reads it.
 */
function pickProps(type: string, props: Record<string, unknown>): Record<string, unknown> {
  const fields = blockDefinition(type)?.fields ?? [];
  const keys = new Set(fields.map((field: Field) => field.key));
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (keys.has(key)) out[key] = value;
  }
  return out;
}

/** One block from the model, or null if it is not a real one. */
function blockFromModel(raw: unknown): Block | null {
  const record = asRecord(raw);
  const type = typeof record.type === 'string' ? record.type : '';
  if (!isKnownBlock(type) || BUILDER_EXCLUDES.has(type)) return null;

  const block = createBlock(type);
  block.props = { ...defaultPropsFor(type), ...pickProps(type, asRecord(record.props)) };
  return block;
}

/**
 * A model answer to a real Section, or a reason it could not be.
 *
 * Lenient about the wrapper the model puts around it (a bare object, a
 * `{ section: ... }`, or an array of rows), strict about everything inside:
 * unreal blocks are dropped, props are filtered, widths are ignored and
 * recomputed, and the result is validated and sanitised before it is trusted.
 */
export function sectionFromModel(answer: unknown): BuildResult {
  const parsed = typeof answer === 'string' ? extractJson(answer) : answer;
  if (parsed == null) return { ok: false, error: 'the answer was not JSON' };

  // Unwrap the shapes a model reaches for.
  const root = Array.isArray(parsed)
    ? { rows: parsed }
    : asRecord((asRecord(parsed).section as unknown) ?? parsed);

  const rawRows = Array.isArray(root.rows) ? root.rows.slice(0, MAX_ROWS) : [];
  if (rawRows.length === 0) return { ok: false, error: 'there were no rows' };

  let total = 0;
  const rows = [];
  for (const rawRow of rawRows) {
    const rawColumns = Array.isArray(asRecord(rawRow).columns)
      ? (asRecord(rawRow).columns as unknown[]).slice(0, MAX_COLUMNS)
      : [];

    const columns = [];
    for (const rawColumn of rawColumns) {
      const rawBlocks = Array.isArray(asRecord(rawColumn).blocks)
        ? (asRecord(rawColumn).blocks as unknown[]).slice(0, MAX_BLOCKS_PER_COLUMN)
        : [];

      const blocks: Block[] = [];
      for (const rawBlock of rawBlocks) {
        if (total >= MAX_BLOCKS) break;
        const block = blockFromModel(rawBlock);
        if (block) {
          blocks.push(block);
          total += 1;
        }
      }
      // An empty column would draw a gap nobody asked for; drop it.
      if (blocks.length) columns.push(createColumn(0, blocks));
    }

    if (columns.length) {
      const row = createRow('1');
      row.columns = columns.map((column, index) => ({ ...column, width: evenWidths(columns.length)[index] }));
      rows.push(row);
    }
  }

  if (total === 0) return { ok: false, error: 'none of the blocks were ones you can use' };

  const section = createSection('1');
  section.rows = rows;
  if (typeof root.name === 'string' && root.name.trim()) section.name = root.name.trim().slice(0, 80);
  if (typeof root.tone === 'string' && TONES.has(root.tone)) section.tone = root.tone as Section['tone'];
  if (typeof root.width === 'string' && WIDTHS.has(root.width)) section.width = root.width as Section['width'];

  // Structure and defaults first, then content safety on every block. Both,
  // because SectionSchema squares the shape and the sanitiser cleans the values,
  // and a built section must pass exactly what a hand-built one does.
  let validated: Section;
  try {
    validated = SectionSchema.parse(section);
  } catch {
    return { ok: false, error: 'the section did not fit the shape' };
  }

  const safe: Section = {
    ...validated,
    rows: validated.rows.map((row) => ({
      ...row,
      columns: row.columns.map((column) => ({
        ...column,
        blocks: column.blocks.map(sanitiseBlock),
      })),
    })),
  };

  return { ok: true, section: safe };
}
