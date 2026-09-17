/**
 * What Luna Assist may change, as typed operations against the page.
 *
 * THE BRIEF'S FIRST HARD RULE LIVES HERE: operations, never markup. The model
 * does not write HTML and it does not write a page; it names a block and says
 * what the words or one setting should become. Every operation is checked
 * against the SAME registry the editor's own panels are built from
 * (lib/content/blocks.ts), applied with the SAME tree helpers the editor uses
 * (lib/content/tree.ts), and the result is parsed by the SAME schema the save
 * path parses (lib/content/schema.ts). An operation that does not survive all
 * three is refused, and the refusal goes back to the model as a sentence it
 * can correct rather than as a silent no.
 *
 * BINDINGS ARE SACRED (rule 6). A block whose value holds a {{token}} draws
 * its words from a collection. Replacing that value with literal text is the
 * exact failure Duda's copilot has, so it is refused here, in the one place
 * every write goes through, and the message says what to do instead.
 *
 * ROLE-SCOPED (rule 7), field by field rather than tool by tool. The catalogue
 * already divides a block's fields into what a client types (content) and what
 * switches a variant or a layout (config); the same division decides which
 * capability an operation needs. So a content-only client may rewrite a
 * heading and may not restyle the section it sits in, without a second list
 * anywhere saying so.
 *
 * PURE. A page in, a page out, no database and no network, so every rule above
 * is tested with a fixture.
 */

import { toHtml, toText } from '../ai/copy';
import type { Capability } from '../auth/permissions';
import { blockDefinition, type Field } from '../content/blocks';
import { parsePage, type Block, type Page } from '../content/schema';
import { containerColumns, updateBlockProps, updateInnerBlockProps } from '../content/tree';
import { tokensIn } from './context';

export type Operation =
  | { kind: 'set_text'; block: string; text: string; why?: string }
  | { kind: 'set_setting'; block: string; setting: string; value: string | number | boolean; why?: string }
  | { kind: 'set_page_seo'; title?: string; description?: string; why?: string };

export const OPERATION_KINDS = ['set_text', 'set_setting', 'set_page_seo'] as const;

/** One change, as the panel shows it and the change set records it. */
export interface Change {
  kind: Operation['kind'];
  /** What the person reads: "Hero heading", "Search description". */
  label: string;
  before: string;
  after: string;
  why: string;
}

export interface OperationOutcome {
  page: Page;
  changes: Change[];
  /** One sentence per refused operation, for the model to correct. */
  errors: string[];
}

/** The longest words one operation may write. */
export const MAX_TEXT = 4_000;

const SEO_TITLE_MAX = 70;
const SEO_DESCRIPTION_MAX = 200;

/** The catalogue's own division, kept in step with tools/block-catalogue.mjs. */
const CONTENT_KINDS = new Set(['text', 'textarea', 'richtext', 'url', 'image', 'icon', 'repeater', 'imported', 'place']);

/** Where a block keeps its words, taken from its own field list. */
const TEXT_KINDS = new Set(['richtext', 'textarea', 'text']);

function capabilityForField(field: Field): Capability {
  return CONTENT_KINDS.has(field.kind) ? 'content' : 'structure';
}

// ---------------------------------------------------------------------------
// Finding a block by the id the model was given
// ---------------------------------------------------------------------------

type Spot =
  | { at: 'block'; section: number; row: number; column: number; block: number; node: Block }
  | {
      at: 'inner';
      section: number;
      row: number;
      column: number;
      block: number;
      inner: number;
      innerBlock: number;
      node: Block;
    };

export function findBlock(page: Page, id: string): Spot | null {
  for (let s = 0; s < page.sections.length; s += 1) {
    const rows = page.sections[s].rows ?? [];
    for (let r = 0; r < rows.length; r += 1) {
      const columns = rows[r].columns ?? [];
      for (let c = 0; c < columns.length; c += 1) {
        const blocks = columns[c].blocks ?? [];
        for (let b = 0; b < blocks.length; b += 1) {
          const node = blocks[b];
          if (node.id === id) return { at: 'block', section: s, row: r, column: c, block: b, node };
          /* A container and a loop keep their children in props.columns, which
             is where a bound card lives. The assistant is shown those blocks in
             the outline, so it can name one, so this has to find one. */
          const inner = containerColumns(node);
          for (let i = 0; i < inner.length; i += 1) {
            const innerBlocks = inner[i].blocks ?? [];
            for (let ib = 0; ib < innerBlocks.length; ib += 1) {
              if (innerBlocks[ib].id === id) {
                return {
                  at: 'inner',
                  section: s,
                  row: r,
                  column: c,
                  block: b,
                  inner: i,
                  innerBlock: ib,
                  node: innerBlocks[ib],
                };
              }
            }
          }
        }
      }
    }
  }
  return null;
}

function writeProps(page: Page, spot: Spot, patch: Record<string, unknown>): Page {
  return spot.at === 'block'
    ? updateBlockProps(page, spot.section, spot.row, spot.column, spot.block, patch)
    : updateInnerBlockProps(
        page,
        spot.section,
        spot.row,
        spot.column,
        spot.block,
        spot.inner,
        spot.innerBlock,
        patch,
      );
}

function label(block: Block, field?: Field): string {
  const definition = blockDefinition(block.type);
  const name = definition?.label ?? block.type;
  return field ? `${name} ${field.label.toLowerCase()}` : name;
}

function plainOf(value: unknown): string {
  if (typeof value !== 'string') return value === undefined || value === null ? '' : String(value);
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * The refusal that keeps a binding. Returns null when nothing is bound or every
 * token survives, and a sentence naming what would be lost otherwise.
 */
export function bindingRefusal(current: unknown, next: string): string | null {
  const had = tokensIn(current);
  if (had.length === 0) return null;
  const kept = tokensIn(next);
  const lost = had.filter((token) => !kept.includes(token));
  if (lost.length === 0) return null;
  return `That would replace ${lost.join(' ')} with fixed words. This value is filled from a collection for every item, so changing what it says means changing the collection, not this block.`;
}

// ---------------------------------------------------------------------------
// The operations
// ---------------------------------------------------------------------------

function setText(page: Page, op: Extract<Operation, { kind: 'set_text' }>, caps: ReadonlySet<Capability>):
  { page: Page; change: Change } | { error: string } {
  const spot = findBlock(page, op.block);
  if (!spot) return { error: `There is no block called ${op.block} on this page.` };

  const definition = blockDefinition(spot.node.type);
  const field = definition?.fields.find((entry) => TEXT_KINDS.has(entry.kind));
  if (!field) return { error: `A ${spot.node.type} block has no words to set. Use set_setting for its settings.` };

  if (!caps.has('content')) return { error: 'You do not have permission to edit the words on this site.' };

  const text = op.text.slice(0, MAX_TEXT);
  if (!text.trim()) return { error: 'The words cannot be empty.' };

  const current = (spot.node.props as Record<string, unknown>)[field.key];
  const refusal = bindingRefusal(current, text);
  if (refusal) return { error: refusal };

  /* THE OUTPUT BOUNDARY, the same one the writing assistant uses: a richtext
     field gets sanitised HTML built from the model's plain text, and a plain
     field gets plain text. Nothing the model said is trusted as markup. */
  const value = field.kind === 'richtext' ? toHtml(text) : toText(text);
  const next = writeProps(page, spot, { [field.key]: value });

  return {
    page: next,
    change: {
      kind: 'set_text',
      label: label(spot.node, field),
      before: plainOf(current),
      after: plainOf(value),
      why: (op.why ?? '').slice(0, 200),
    },
  };
}

function setSetting(page: Page, op: Extract<Operation, { kind: 'set_setting' }>, caps: ReadonlySet<Capability>):
  { page: Page; change: Change } | { error: string } {
  const spot = findBlock(page, op.block);
  if (!spot) return { error: `There is no block called ${op.block} on this page.` };

  const definition = blockDefinition(spot.node.type);
  const field = definition?.fields.find((entry) => entry.key === op.setting);
  if (!field) {
    const offered = (definition?.fields ?? []).map((entry) => entry.key).slice(0, 20).join(', ');
    return { error: `A ${spot.node.type} block has no setting called ${op.setting}. It has: ${offered || 'none'}.` };
  }

  const needed = capabilityForField(field);
  if (!caps.has(needed)) {
    return {
      error: needed === 'structure'
        ? 'You do not have permission to change the layout or styling of this site.'
        : 'You do not have permission to edit the content of this site.',
    };
  }

  let value: string | number | boolean;
  switch (field.kind) {
    case 'select': {
      const options = field.options.map((option) => option.value);
      if (typeof op.value !== 'string' || !options.includes(op.value)) {
        return { error: `${field.label} must be one of: ${options.join(', ')}.` };
      }
      value = op.value;
      break;
    }
    case 'toggle': {
      if (typeof op.value !== 'boolean') return { error: `${field.label} is a yes or no setting.` };
      value = op.value;
      break;
    }
    case 'number': {
      const number = typeof op.value === 'number' ? op.value : Number(op.value);
      if (!Number.isFinite(number)) return { error: `${field.label} is a number.` };
      if (field.min !== undefined && number < field.min) return { error: `${field.label} cannot be below ${field.min}.` };
      if (field.max !== undefined && number > field.max) return { error: `${field.label} cannot be above ${field.max}.` };
      value = number;
      break;
    }
    case 'text':
    case 'textarea':
    case 'place': {
      if (typeof op.value !== 'string') return { error: `${field.label} is words.` };
      value = toText(op.value.slice(0, MAX_TEXT));
      break;
    }
    case 'richtext':
      return { error: `Use set_text for ${field.label}.` };
    default:
      /* An image, an icon, a link or a repeater needs the media library or a
         shape this cannot check, so it is not offered rather than guessed at. */
      return { error: `${field.label} cannot be set from here yet.` };
  }

  const current = (spot.node.props as Record<string, unknown>)[field.key];
  const refusal = bindingRefusal(current, String(value));
  if (refusal) return { error: refusal };

  const next = writeProps(page, spot, { [field.key]: value });
  return {
    page: next,
    change: {
      kind: 'set_setting',
      label: label(spot.node, field),
      before: plainOf(current),
      after: plainOf(value),
      why: (op.why ?? '').slice(0, 200),
    },
  };
}

function setPageSeo(page: Page, op: Extract<Operation, { kind: 'set_page_seo' }>, caps: ReadonlySet<Capability>):
  { page: Page; change: Change } | { error: string } {
  if (!caps.has('seo')) return { error: 'You do not have permission to change this site’s search settings.' };

  const title = typeof op.title === 'string' ? toText(op.title).slice(0, SEO_TITLE_MAX) : undefined;
  const description = typeof op.description === 'string' ? toText(op.description).slice(0, SEO_DESCRIPTION_MAX) : undefined;
  if (title === undefined && description === undefined) {
    return { error: 'Give a search title, a search description, or both.' };
  }

  const seo = { ...(page.seo ?? { noindex: false }) };
  const before: string[] = [];
  const after: string[] = [];
  if (title !== undefined) {
    before.push(`Title: ${seo.title ?? 'not set'}`);
    after.push(`Title: ${title}`);
    seo.title = title;
  }
  if (description !== undefined) {
    before.push(`Description: ${seo.description ?? 'not set'}`);
    after.push(`Description: ${description}`);
    seo.description = description;
  }

  return {
    page: { ...page, seo },
    change: {
      kind: 'set_page_seo',
      label: 'Search listing',
      before: before.join('\n'),
      after: after.join('\n'),
      why: (op.why ?? '').slice(0, 200),
    },
  };
}

/**
 * Run the operations in order. A refused one does not stop the others: the
 * valid changes stand as the proposal and the refusals go back to the model,
 * which is what lets it correct one line rather than start again.
 *
 * The page is parsed after every operation, so a change that would produce a
 * page the editor could not save never reaches the draft.
 */
export function applyOperations(
  page: Page,
  operations: readonly Operation[],
  caps: ReadonlySet<Capability>,
): OperationOutcome {
  let current = page;
  const changes: Change[] = [];
  const errors: string[] = [];

  for (const op of operations) {
    const result =
      op.kind === 'set_text'
        ? setText(current, op, caps)
        : op.kind === 'set_setting'
          ? setSetting(current, op, caps)
          : op.kind === 'set_page_seo'
            ? setPageSeo(current, op, caps)
            : { error: `There is no operation called ${String((op as { kind: string }).kind)}.` };

    if ('error' in result) {
      errors.push(result.error);
      continue;
    }

    const parsed = parsePage(result.page);
    if (!parsed.ok) {
      errors.push(`That change would not make a valid page: ${parsed.errors.slice(0, 2).join('; ')}`);
      continue;
    }
    current = parsed.page;
    changes.push(result.change);
  }

  return { page: current, changes, errors };
}

/** A parsed operation, or null. Free input from the model, so nothing is assumed. */
export function parseOperation(value: unknown): Operation | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const why = typeof raw.why === 'string' ? raw.why : undefined;

  if (raw.kind === 'set_text') {
    if (typeof raw.block !== 'string' || typeof raw.text !== 'string') return null;
    return { kind: 'set_text', block: raw.block, text: raw.text, why };
  }
  if (raw.kind === 'set_setting') {
    if (typeof raw.block !== 'string' || typeof raw.setting !== 'string') return null;
    const value_ = raw.value;
    if (typeof value_ !== 'string' && typeof value_ !== 'number' && typeof value_ !== 'boolean') return null;
    return { kind: 'set_setting', block: raw.block, setting: raw.setting, value: value_, why };
  }
  if (raw.kind === 'set_page_seo') {
    const title = typeof raw.title === 'string' ? raw.title : undefined;
    const description = typeof raw.description === 'string' ? raw.description : undefined;
    if (title === undefined && description === undefined) return null;
    return { kind: 'set_page_seo', title, description, why };
  }
  return null;
}
