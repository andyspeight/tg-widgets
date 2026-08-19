/**
 * What a draft save actually changed: content, structure, or the search settings.
 *
 * THE POINT. A member with the `content` capability but not `structure` may
 * change words, swap photos and edit links, but not add, move, remove or restyle
 * anything. The editor hides the controls that would let them, but the editor is
 * a courtesy and a server action is a public endpoint, so the real gate is here:
 * saveDraftAction compares the incoming page to the one already stored and asks
 * this module whether the difference reached beyond content. See
 * lib/auth/capabilities.ts and app/actions/pages.ts.
 *
 * HOW IT DECIDES, and why it can be trusted. The tree is walked in lock step,
 * section by section, row by row, column by column, block by block, matched by id
 * and position. Any change to the SHAPE (a section added, a block moved, a column
 * removed) is structure. Any change to a container's own design (a section's tone,
 * a column's width, a block's box, its per-screen overrides, whether it is hidden)
 * is structure. Inside a block, the difference is read against the SAME block
 * definitions the editor and the sanitiser use: a change to a text, rich text,
 * address, link or image field is content, and a change to any other field, a
 * select, a colour, a toggle, a number, is structure. So the vocabulary cannot
 * drift from what a block actually is, and a block added tomorrow is covered the
 * day it is added rather than the day someone remembers this file.
 *
 * IT FAILS CLOSED. An unknown block type, an unexpected shape, a staff-only block:
 * any change to one of those reads as structure, so a request this module does not
 * fully understand is refused for a content-only member rather than waved through.
 * The cost of that is a member occasionally told to ask staff for a change staff
 * could have let them make; the cost of the other way round is a content-only
 * client restyling the site. Only one of those is worth guarding against.
 */

import { blockDefinition, type Field } from './blocks';
import type { Page, Region } from './schema';

export interface ChangeScope {
  /** The body tree changed in a way beyond editing text, photos and links. */
  structure: boolean;
  /** The page's SEO fields changed. */
  seo: boolean;
}

/**
 * The field kinds that hold CONTENT: the words, the pictures and the links a
 * content editor is meant to change. Everything else a block's fields describe,
 * a select, a colour, a toggle, a number, an icon, four corner radii, is design.
 */
const CONTENT_KINDS: ReadonlySet<string> = new Set([
  'text',
  'place',
  'textarea',
  'richtext',
  'url',
  'image',
]);

/**
 * Compare two SANITISED pages. Pass both through sanitisePage first, so the two
 * sides are in the same normal form and a difference is a real edit rather than a
 * quirk of how one was stored. Title and slug are ignored: the title is content
 * (words), and saveDraft never writes the slug from here.
 */
export function changeScope(before: Page, after: Page): ChangeScope {
  return {
    seo: !deepEqual(before.seo, after.seo),
    structure: sectionsStructural(before.sections, after.sections),
  };
}

/**
 * The same question for a header or a footer. A region is sections, so its body
 * is read exactly as a page's is; on top of that, whether the header sticks or
 * sits over the hero is structure, since both change the furniture rather than
 * its words. A region has no SEO, so there is only the one flag. Pass both
 * sanitised, the same as a page.
 */
export function regionChangeScope(before: Region, after: Region): { structure: boolean } {
  return {
    structure:
      before.sticky !== after.sticky ||
      before.overlay !== after.overlay ||
      sectionsStructural(before.sections, after.sections),
  };
}

// ---------------------------------------------------------------------------
// The structural walk
// ---------------------------------------------------------------------------

function sectionsStructural(before: unknown, after: unknown): boolean {
  return listStructural(
    before,
    after,
    (b, a) => differsExcept(b, a, 'rows') || rowsStructural(rec(b)?.rows, rec(a)?.rows),
  );
}

function rowsStructural(before: unknown, after: unknown): boolean {
  return listStructural(
    before,
    after,
    (b, a) => differsExcept(b, a, 'columns') || columnsStructural(rec(b)?.columns, rec(a)?.columns),
  );
}

function columnsStructural(before: unknown, after: unknown): boolean {
  return listStructural(
    before,
    after,
    (b, a) => differsExcept(b, a, 'blocks') || blocksStructural(rec(b)?.blocks, rec(a)?.blocks),
  );
}

function blocksStructural(before: unknown, after: unknown): boolean {
  return listStructural(before, after, blockStructural);
}

/**
 * Two ordered lists, compared position by position. Different lengths, or a
 * different id at the same position, is structure: an item was added, removed,
 * or moved. Otherwise each pair is handed to the comparator.
 */
function listStructural(
  before: unknown,
  after: unknown,
  compare: (b: unknown, a: unknown) => boolean,
): boolean {
  const bs = Array.isArray(before) ? before : [];
  const as = Array.isArray(after) ? after : [];
  if (bs.length !== as.length) return true;
  for (let i = 0; i < bs.length; i += 1) {
    if (idOf(bs[i]) !== idOf(as[i])) return true;
    if (compare(bs[i], as[i])) return true;
  }
  return false;
}

/**
 * A block's own difference. Its type, its design box, its per-screen overrides
 * and where it is hidden are all structure; the rest is down to its props.
 */
function blockStructural(before: unknown, after: unknown): boolean {
  const b = rec(before);
  const a = rec(after);
  if (!b || !a) return before !== after;
  if (b.type !== a.type) return true;
  if (!deepEqual(b.box, a.box)) return true;
  if (!deepEqual(b.responsive, a.responsive)) return true;
  if (!deepEqual(b.hideOn, a.hideOn)) return true;
  return propsStructural(String(b.type), rec(b.props) ?? {}, rec(a.props) ?? {});
}

/**
 * A block's props, read against its own field definitions. A content field may
 * change; a design field may not; a repeater's item count may not; a block this
 * module does not fully understand may not change at all.
 */
function propsStructural(
  type: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): boolean {
  if (deepEqual(before, after)) return false;

  // The two blocks whose real content is not their own fields.
  if (type === 'container') return containerStructural(before, after);
  if (type === 'imported') return importedStructural(before, after);

  const definition = blockDefinition(type);
  // An unknown block, or a staff-only one, is not a content-only member's to
  // touch. Both fail closed.
  if (!definition) return true;
  if (definition.staffOnly) return true;

  const fields = fieldMap(definition.fields);
  for (const key of unionKeys(before, after)) {
    if (deepEqual(before[key], after[key])) continue;
    const field = fields.get(key);
    // A prop with no field is recorded or editor-set companion data that travels
    // with the picture it belongs to: an image's width and height change when the
    // photo is swapped, its focus point and crop when it is adjusted. None of it
    // is the staff-built layout, so a difference there is not structure.
    if (!field) continue;
    if (field.kind === 'repeater') {
      if (repeaterStructural(field.fields, before[key], after[key])) return true;
      continue;
    }
    if (CONTENT_KINDS.has(field.kind)) continue;
    return true;
  }
  return false;
}

/**
 * A repeater's items. Adding or removing one is structure: the shape is fixed and
 * a content editor fills it in. Editing an item is read field by field, the same
 * way a block's own props are.
 */
function repeaterStructural(
  fields: readonly Field[],
  before: unknown,
  after: unknown,
): boolean {
  if (!Array.isArray(before) || !Array.isArray(after)) return true;
  if (before.length !== after.length) return true;
  const map = fieldMap(fields);
  for (let i = 0; i < before.length; i += 1) {
    if (itemStructural(map, before[i], after[i])) return true;
  }
  return false;
}

function itemStructural(
  fields: Map<string, Field>,
  before: unknown,
  after: unknown,
): boolean {
  if (deepEqual(before, after)) return false;
  const b = rec(before);
  const a = rec(after);
  if (!b || !a) return true;
  for (const key of unionKeys(b, a)) {
    if (deepEqual(b[key], a[key])) continue;
    const field = fields.get(key);
    if (!field) continue;
    if (field.kind === 'repeater') {
      if (repeaterStructural(field.fields, b[key], a[key])) return true;
      continue;
    }
    if (CONTENT_KINDS.has(field.kind)) continue;
    return true;
  }
  return false;
}

/**
 * A container holds columns of blocks, not content of its own. Its gap and its
 * stacking are design; the columns are the nested layout, compared exactly as a
 * section's columns are.
 */
function containerStructural(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): boolean {
  if (differsExcept(before, after, 'columns')) return true;
  return columnsStructural(before.columns, after.columns);
}

/**
 * An imported design keeps its layout and styling frozen in `html` and `css`, and
 * its slot definitions in `fields`. The only things a content editor changes are
 * the words and pictures in `content` and the block's name in `label`; a change
 * to anything else is structure.
 */
function importedStructural(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): boolean {
  for (const key of unionKeys(before, after)) {
    if (deepEqual(before[key], after[key])) continue;
    if (key === 'content' || key === 'label') continue;
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** A plain object, or null for anything else (including an array or null). */
function rec(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** The stable id of a section, row, column or block, when it has one. */
function idOf(value: unknown): string | undefined {
  const object = rec(value);
  return object && typeof object.id === 'string' ? object.id : undefined;
}

/** Every key present in either object. */
function unionKeys(a: Record<string, unknown>, b: Record<string, unknown>): Set<string> {
  return new Set([...Object.keys(a), ...Object.keys(b)]);
}

/** A block's fields by their key, for looking one up while walking props. */
function fieldMap(fields: readonly Field[]): Map<string, Field> {
  const map = new Map<string, Field>();
  for (const field of fields) map.set(field.key, field);
  return map;
}

/**
 * Whether two objects differ once one named key is set aside. Used to compare a
 * section, row or column's own design while its children are compared separately.
 */
function differsExcept(before: unknown, after: unknown, exclude: string): boolean {
  const b = rec(before);
  const a = rec(after);
  if (!b || !a) return before !== after;
  const bc = { ...b };
  const ac = { ...a };
  delete bc[exclude];
  delete ac[exclude];
  return !deepEqual(bc, ac);
}

/**
 * A structural deep equality for plain JSON. Key order does not matter, so a
 * sanitiser that rebuilt an object in a different order does not read as a change.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== typeof b) return false;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  if (typeof a === 'object') {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    // A key set to undefined is the same as an absent key. parsePage emits a few
    // undefined fields (an unset background focus, say), and a JSON round trip
    // drops them, so without this an untouched page could read as a change.
    const keys = definedKeys(ao);
    if (keys.length !== definedKeys(bo).length) return false;
    for (const key of keys) {
      if (!deepEqual(ao[key], bo[key])) return false;
    }
    return true;
  }

  return false;
}

/** An object's keys whose value is not undefined. */
function definedKeys(object: Record<string, unknown>): string[] {
  return Object.keys(object).filter((key) => object[key] !== undefined);
}
