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
 * SECTIONS ARE THE SAME DEAL. add_section names a design from the SAME library
 * the Designed panel offers (lib/content/presets.ts), page-scoped, so the model
 * cannot drop a footer into the middle of an About page and cannot invent a
 * section that does not exist. move_section and remove_section name a section by
 * the id the outline gave it. All three need the structure capability, which is
 * the one the permissions screen already calls "Add, remove and move sections",
 * so nothing new has to be granted and nothing new has to be explained.
 *
 * PURE. A page in, a page out, no database and no network, so every rule above
 * is tested with a fixture.
 */

import { toHtml, toText } from '../ai/copy';
import type { Capability } from '../auth/permissions';
import { blockDefinition, type Field } from '../content/blocks';
import {
  buildPresetSection,
  presetBlocks,
  presetById,
  presetRoles,
  PRESET_CATEGORIES,
  SECTION_PRESETS,
  type SectionPreset,
} from '../content/presets';
import { escapeHtml } from '../content/sanitise';
import { parsePage, type Block, type Page, type Section } from '../content/schema';
import {
  addSection as insertSection,
  containerColumns,
  moveSection as reorderSection,
  removeSection as dropSection,
  updateBlockProps,
  updateInnerBlockProps,
} from '../content/tree';
import { isBound, tokensIn } from './context';

export type Operation =
  | { kind: 'set_text'; block: string; text: string; why?: string }
  | { kind: 'set_setting'; block: string; setting: string; value: string | number | boolean; why?: string }
  | { kind: 'set_page_seo'; title?: string; description?: string; why?: string }
  | { kind: 'add_section'; preset: string; after?: string; heading?: string; text?: string; why?: string }
  | { kind: 'move_section'; section: string; after?: string; why?: string }
  | { kind: 'remove_section'; section: string; why?: string };

export const OPERATION_KINDS = [
  'set_text',
  'set_setting',
  'set_page_seo',
  'add_section',
  'move_section',
  'remove_section',
] as const;

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
// Sections: the designed library, and where one goes
// ---------------------------------------------------------------------------

/*
 * PAGE SCOPE ONLY. A header and a footer preset are the same shape as a page
 * section, so nothing in the data stops a four-column footer landing halfway
 * down an About page. The picker's answer to that is to offer only the
 * categories that fit the screen (categoriesFor in lib/content/presets.ts) and
 * this is the same answer for the assistant. It is also the list read_catalogue
 * shows it, so what it is offered and what it may name are one list rather than
 * two that can drift.
 */
const PAGE_CATEGORIES = new Set<string>(
  PRESET_CATEGORIES.filter((entry) => entry.scope === 'page').map((entry) => entry.id),
);

/** Every designed section a page may be given, in library order. */
export function pageSectionPresets(): SectionPreset[] {
  return SECTION_PRESETS.filter((preset) => PAGE_CATEGORIES.has(preset.category));
}

function pagePreset(id: string): SectionPreset | null {
  const preset = presetById(id.trim());
  return preset && PAGE_CATEGORIES.has(preset.category) ? preset : null;
}

/** What a position means when it is not a section id: the top of the page. */
const START = 'start';

function findSection(page: Page, id: string): number {
  return page.sections.findIndex((section) => section.id === id.trim());
}

function sectionBlocks(section: Section): Block[] {
  return (section.rows ?? []).flatMap((row) => (row.columns ?? []).flatMap((column) => column.blocks ?? []));
}

/** What to call a section to somebody reading the proposal. */
function sectionTitle(section: Section): string {
  const named = typeof section.name === 'string' ? section.name.trim() : '';
  if (named) return named;
  /* Its own first words, which is what somebody would call it. A section with
     no words at all is named by its id, so the line still points somewhere. */
  for (const block of sectionBlocks(section)) {
    for (const key of ['html', 'text', 'title', 'heading']) {
      const words = plainOf((block.props as Record<string, unknown>)[key]);
      if (words) return words.length > 48 ? `${words.slice(0, 47).trimEnd()}\u2026` : words;
    }
  }
  return `Untitled section ${section.id}`;
}

/**
 * Whether anything in this section is drawn from a collection.
 *
 * ASKED BLOCK BY BLOCK rather than by walking the whole section, because
 * tokensIn stops at eight levels down and a loop's card sits below that when
 * the walk starts at a section: sections, rows, columns, blocks, props,
 * columns, blocks, props, and only then the token. From a block it is well
 * inside the limit, and isBound is the same question the outline's [bound]
 * mark answers, so there is one answer to it rather than two.
 */
function sectionIsBound(section: Section): boolean {
  return sectionBlocks(section).some((block) => isBound(block));
}

/** What is in it, by block name, for the one operation that takes it away. */
function sectionContents(section: Section): string {
  const names: string[] = [];
  for (const block of sectionBlocks(section)) {
    const name = blockDefinition(block.type)?.label ?? block.type;
    if (!names.includes(name)) names.push(name);
    if (names.length >= 6) break;
  }
  return names.join(', ');
}

function ordinal(n: number): string {
  const teens = n % 100;
  if (teens >= 11 && teens <= 13) return `${n}th`;
  const last = n % 10;
  return `${n}${last === 1 ? 'st' : last === 2 ? 'nd' : last === 3 ? 'rd' : 'th'}`;
}

function badPosition(after: string): string {
  return `There is no section called ${after} on this page. Name one by the id in the page outline, or say "start" for the top of the page.`;
}

/** Where a NEW section lands, from the id it should follow. */
function placeIndex(page: Page, after: string | undefined): { index: number } | { error: string } {
  const wanted = (after ?? '').trim();
  if (!wanted) return { index: page.sections.length };
  if (wanted.toLowerCase() === START) return { index: 0 };
  const at = findSection(page, wanted);
  return at < 0 ? { error: badPosition(wanted) } : { index: at + 1 };
}

/** The same position in words, for the person reading the change. */
function placeWords(page: Page, after: string | undefined): string {
  const wanted = (after ?? '').trim();
  if (!wanted) return 'At the end of the page';
  if (wanted.toLowerCase() === START) return 'At the top of the page';
  const at = findSection(page, wanted);
  return at < 0 ? 'At the end of the page' : `After \u201c${sectionTitle(page.sections[at])}\u201d`;
}

/**
 * Where a section ALREADY on the page lands, in moveSection's terms.
 *
 * moveSection takes the section out of the list before putting it back, so a
 * target that sits after it is one index lower by the time the insert happens.
 * Getting this wrong moves a section one place short, which looks like the
 * model misunderstanding rather than like arithmetic.
 */
function moveIndex(page: Page, from: number, after: string | undefined): { to: number } | { error: string } {
  const wanted = (after ?? '').trim();
  if (!wanted) return { to: page.sections.length - 1 };
  if (wanted.toLowerCase() === START) return { to: 0 };
  if (wanted === page.sections[from].id) {
    return { error: 'A section cannot move after itself. Name the section it should follow, or say "start" for the top of the page.' };
  }
  const at = findSection(page, wanted);
  if (at < 0) return { error: badPosition(wanted) };
  return { to: at < from ? at + 1 : at };
}

/**
 * The words a new section arrives with.
 *
 * A preset carries placeholder copy, which is right in the picker, where
 * somebody is choosing a shape, and wrong here, where somebody has asked for a
 * section ABOUT something. The preset's declared roles say which block is the
 * title and which is the body (presetRoles), so the words go where the design
 * meant them, and a preset whose built shape does not match its own block list
 * is left with its own copy rather than filled by position.
 *
 * MUTATES A SECTION THIS MODULE JUST BUILT, the same as starters.ts does and
 * for the same reason: rebuilding would mint a second set of ids.
 */
function fillSection(preset: SectionPreset, section: Section, heading?: string, text?: string): void {
  const specs = presetBlocks(preset);
  const built = sectionBlocks(section);
  if (specs.length !== built.length) return;
  const roles = presetRoles(preset);
  const words = (heading ?? '').trim();
  const body = (text ?? '').trim();
  let bodyDone = false;
  for (let i = 0; i < specs.length; i += 1) {
    const role = roles.get(specs[i]);
    const block = built[i];
    /* A heading holds INLINE markup only (see the 'heading' mode in
       sanitise.ts), so it gets escaped text rather than toHtml's paragraphs. */
    if (words && role === 'title' && block.type === 'heading') {
      block.props.html = escapeHtml(toText(words).slice(0, SECTION_HEADING_MAX));
    }
    if (body && !bodyDone && role === 'body' && block.type === 'text') {
      block.props.html = toHtml(body.slice(0, MAX_TEXT));
      bodyDone = true;
    }
  }
}

/** The longest heading a new section may arrive with. */
const SECTION_HEADING_MAX = 200;

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

function addSectionOp(page: Page, op: Extract<Operation, { kind: 'add_section' }>, caps: ReadonlySet<Capability>):
  { page: Page; change: Change } | { error: string } {
  if (!caps.has('structure')) return { error: 'You do not have permission to add sections to this site.' };

  const preset = pagePreset(op.preset ?? '');
  if (!preset) {
    return { error: `There is no designed section called ${op.preset}. Call read_catalogue for "sections" and name one by its id.` };
  }

  const heading = (op.heading ?? '').trim();
  const body = (op.text ?? '').trim();
  /* The section is structure and the words in it are content, which are two
     permissions. Refused rather than quietly dropped, because a section that
     arrives saying something other than what was asked for is worse than one
     that does not arrive. */
  if ((heading || body) && !caps.has('content')) {
    return { error: 'You do not have permission to edit the words on this site. Add the section without a heading or text and it will arrive with the design\u2019s own words.' };
  }

  const where = placeIndex(page, op.after);
  if ('error' in where) return where;

  const section = buildPresetSection(preset);
  if (heading || body) fillSection(preset, section, heading, body);

  const headed = heading ? `, headed \u201c${toText(heading).slice(0, 60)}\u201d` : '';
  return {
    page: insertSection(page, section, where.index),
    change: {
      kind: 'add_section',
      label: `New section: ${preset.label}`,
      before: '',
      after: `${placeWords(page, op.after)}${headed}. ${preset.description}`,
      why: (op.why ?? '').slice(0, 200),
    },
  };
}

function moveSectionOp(page: Page, op: Extract<Operation, { kind: 'move_section' }>, caps: ReadonlySet<Capability>):
  { page: Page; change: Change } | { error: string } {
  if (!caps.has('structure')) return { error: 'You do not have permission to move sections on this site.' };

  const from = findSection(page, op.section ?? '');
  if (from < 0) return { error: `There is no section called ${op.section} on this page.` };

  const target = moveIndex(page, from, op.after);
  if ('error' in target) return target;
  if (target.to === from) return { error: `\u201c${sectionTitle(page.sections[from])}\u201d is already there.` };

  const total = page.sections.length;
  return {
    page: reorderSection(page, from, target.to),
    change: {
      kind: 'move_section',
      label: `Move section: ${sectionTitle(page.sections[from])}`,
      before: `${ordinal(from + 1)} of ${total}`,
      after: `${ordinal(target.to + 1)} of ${total}`,
      why: (op.why ?? '').slice(0, 200),
    },
  };
}

function removeSectionOp(page: Page, op: Extract<Operation, { kind: 'remove_section' }>, caps: ReadonlySet<Capability>):
  { page: Page; change: Change } | { error: string } {
  if (!caps.has('structure')) return { error: 'You do not have permission to remove sections from this site.' };

  const at = findSection(page, op.section ?? '');
  if (at < 0) return { error: `There is no section called ${op.section} on this page.` };

  const section = page.sections[at];
  const contents = sectionContents(section);
  /* A section holding a loop is a section holding a collection, and the person
     is about to lose the whole arrangement rather than a paragraph. Said in the
     change itself, where they read it before they apply it. */
  const bound = sectionIsBound(section) ? ' It is filled from a collection.' : '';

  return {
    page: dropSection(page, at),
    change: {
      kind: 'remove_section',
      label: `Remove section: ${sectionTitle(section)}`,
      before: `${ordinal(at + 1)} of ${page.sections.length}. ${contents ? `Holds: ${contents}.` : 'Empty.'}${bound}`,
      after: 'Gone from the page',
      why: (op.why ?? '').slice(0, 200),
    },
  };
}

/** One operation, dispatched by its kind. Every branch answers the same shape. */
function runOperation(page: Page, op: Operation, caps: ReadonlySet<Capability>):
  { page: Page; change: Change } | { error: string } {
  switch (op.kind) {
    case 'set_text':
      return setText(page, op, caps);
    case 'set_setting':
      return setSetting(page, op, caps);
    case 'set_page_seo':
      return setPageSeo(page, op, caps);
    case 'add_section':
      return addSectionOp(page, op, caps);
    case 'move_section':
      return moveSectionOp(page, op, caps);
    case 'remove_section':
      return removeSectionOp(page, op, caps);
    default:
      return { error: `There is no operation called ${String((op as { kind: string }).kind)}.` };
  }
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
    const result = runOperation(current, op, caps);

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
  if (raw.kind === 'add_section') {
    if (typeof raw.preset !== 'string' || !raw.preset.trim()) return null;
    return {
      kind: 'add_section',
      preset: raw.preset,
      after: typeof raw.after === 'string' ? raw.after : undefined,
      heading: typeof raw.heading === 'string' ? raw.heading : undefined,
      text: typeof raw.text === 'string' ? raw.text : undefined,
      why,
    };
  }
  if (raw.kind === 'move_section') {
    if (typeof raw.section !== 'string' || !raw.section.trim()) return null;
    return {
      kind: 'move_section',
      section: raw.section,
      after: typeof raw.after === 'string' ? raw.after : undefined,
      why,
    };
  }
  if (raw.kind === 'remove_section') {
    if (typeof raw.section !== 'string' || !raw.section.trim()) return null;
    return { kind: 'remove_section', section: raw.section, why };
  }
  return null;
}
