/**
 * Narrowing and ordering a listing by what its collection declares.
 *
 * Slice 1 made a collection's fields typed; this is what that buys. A Cards
 * block showed the newest N and nothing else, so a page could say "our tours"
 * and never "our half board tours" or "our tours under a thousand pounds,
 * cheapest first". Same block, same one query, one more question answered.
 *
 * WHY ONLY SOME KINDS FILTER. Every operator here is one a client picks from a
 * dropdown and cannot get wrong: a choice is or is not one of its own options, a
 * toggle is yes or no, a number is at least or at most. Text and longtext have
 * no such operator. "Contains" over free prose is a search box rather than a
 * filter, and the search block already is one, so offering it here would be a
 * worse version of something that exists. An image filters by nothing at all.
 *
 * TOTAL, like every parser in this folder. A filter naming a field the
 * collection no longer declares, or carrying an operator that does not belong to
 * that field's kind, reads as NO FILTER rather than as an empty listing. That
 * matters more here than in most places: a client who renames a field would
 * otherwise come back to a page showing nothing, with no clue why, and a page
 * that quietly shows everything is a far better failure than a page that quietly
 * shows nothing.
 */

import type { FieldDef, FieldKind } from './collection-fields';
import type { FieldValue } from './collection';

/** The comparisons a client may ask for. */
export const FILTER_OPS = ['is', 'isNot', 'atLeast', 'atMost', 'before', 'after'] as const;

export type FilterOp = (typeof FILTER_OPS)[number];

/**
 * Which operators belong to which kind, and the ONLY place that is decided.
 * The pane offers what this says and the matcher accepts what this says, so a
 * control cannot offer a comparison the engine would then ignore.
 */
export const OPS_FOR_KIND: Record<FieldKind, readonly FilterOp[]> = {
  text: [],
  longtext: [],
  image: [],
  choice: ['is', 'isNot'],
  toggle: ['is'],
  number: ['is', 'atLeast', 'atMost'],
  price: ['is', 'atLeast', 'atMost'],
  date: ['is', 'before', 'after'],
};

export function canFilter(kind: FieldKind): boolean {
  return OPS_FOR_KIND[kind].length > 0;
}

/** Kinds worth ordering by. A toggle sorts, but into two heaps, which is no use. */
export function canSort(kind: FieldKind): boolean {
  return kind === 'number' || kind === 'price' || kind === 'date' || kind === 'choice' || kind === 'text';
}

export interface ListingFilter {
  /** The declared field's key, as minted on the Collections screen. */
  field: string;
  op: FilterOp;
  /** Compared after coercion, so '7' and 7 mean the same thing. */
  value: string;
}

export type SortDir = 'asc' | 'desc';

export interface ListingSort {
  field: string;
  dir: SortDir;
}

function defOf(defs: readonly FieldDef[], key: string): FieldDef | null {
  return defs.find((def) => def.key === key) ?? null;
}

/**
 * A filter the collection can actually answer, or null.
 *
 * Checked against the DEFINITIONS rather than against itself, because a filter
 * is only meaningful next to the schema it names. A stored filter that survived
 * a field being renamed or retyped is exactly the case this catches.
 */
export function parseFilter(defs: readonly FieldDef[], raw: unknown): ListingFilter | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;

  const field = typeof value.field === 'string' ? value.field : '';
  const def = field ? defOf(defs, field) : null;
  if (!def || !canFilter(def.kind)) return null;

  const op = typeof value.op === 'string' ? (value.op as FilterOp) : null;
  if (!op || !OPS_FOR_KIND[def.kind].includes(op)) return null;

  const text = typeof value.value === 'string' ? value.value : typeof value.value === 'number' ? String(value.value) : '';
  if (text === '') return null;

  // A choice may only be compared to one of its own options. Anything else is a
  // filter that can never match, which is the shape a renamed option leaves.
  if (def.kind === 'choice' && !def.choices.includes(text)) return null;
  if (def.kind === 'toggle' && text !== 'yes' && text !== 'no') return null;
  if ((def.kind === 'number' || def.kind === 'price') && !Number.isFinite(Number(text))) return null;

  return { field, op, value: text };
}

/** A sort the collection can answer, or null for the default order. */
export function parseSort(defs: readonly FieldDef[], raw: unknown): ListingSort | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;

  const field = typeof value.field === 'string' ? value.field : '';
  const def = field ? defOf(defs, field) : null;
  if (!def || !canSort(def.kind)) return null;

  const dir: SortDir = value.dir === 'desc' ? 'desc' : 'asc';
  return { field, dir };
}

/** A stored answer as a number, or null where it is not one. */
function asNumber(value: FieldValue | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
}

/** A stored date as a comparable number, or null. */
function asTime(value: FieldValue | undefined): number | null {
  if (typeof value !== 'string' || value === '') return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

/**
 * Whether one item's answers satisfy the filter.
 *
 * AN ITEM THAT NEVER ANSWERED THE QUESTION IS OUT, for every operator including
 * isNot. That is the one judgement call here and it is deliberate: a client
 * filtering to "board basis is not full board" is building a list of tours they
 * know the board basis of, and a tour that has never been asked does not belong
 * on it. Letting blanks through "is not" would fill the page with the items the
 * client has not got round to filling in yet.
 */
export function matchesFilter(
  defs: readonly FieldDef[],
  fields: Record<string, FieldValue>,
  filter: ListingFilter,
): boolean {
  const def = defOf(defs, filter.field);
  if (!def) return true;

  const stored = fields?.[filter.field];
  if (stored === undefined || stored === '' || stored === null) return false;

  if (def.kind === 'toggle') {
    return (stored === true) === (filter.value === 'yes');
  }

  if (def.kind === 'number' || def.kind === 'price') {
    const have = asNumber(stored);
    const want = Number(filter.value);
    if (have === null || !Number.isFinite(want)) return false;
    if (filter.op === 'atLeast') return have >= want;
    if (filter.op === 'atMost') return have <= want;
    return have === want;
  }

  if (def.kind === 'date') {
    const have = asTime(stored);
    const want = asTime(filter.value);
    if (have === null || want === null) return false;
    if (filter.op === 'before') return have < want;
    if (filter.op === 'after') return have > want;
    return have === want;
  }

  // A choice, compared as the words it is.
  const have = String(stored);
  return filter.op === 'isNot' ? have !== filter.value : have === filter.value;
}

/**
 * Order two items by a declared field.
 *
 * BLANKS ALWAYS SINK, whichever way the sort runs. Ascending by price with the
 * unpriced tours at the top would bury the answer the client asked for, and
 * reversing the direction should not promote them: "cheapest first" and "dearest
 * first" both mean "of the ones that have a price".
 */
export function compareByField(
  defs: readonly FieldDef[],
  sort: ListingSort,
  a: Record<string, FieldValue>,
  b: Record<string, FieldValue>,
): number {
  const def = defOf(defs, sort.field);
  if (!def) return 0;

  const flip = sort.dir === 'desc' ? -1 : 1;
  const left = a?.[sort.field];
  const right = b?.[sort.field];

  const blank = (v: FieldValue | undefined) => v === undefined || v === null || v === '';
  if (blank(left) && blank(right)) return 0;
  if (blank(left)) return 1;
  if (blank(right)) return -1;

  if (def.kind === 'number' || def.kind === 'price') {
    const x = asNumber(left) ?? 0;
    const y = asNumber(right) ?? 0;
    return (x - y) * flip;
  }

  if (def.kind === 'date') {
    const x = asTime(left) ?? 0;
    const y = asTime(right) ?? 0;
    return (x - y) * flip;
  }

  // Words, compared the way a person reads a list: case-insensitive, and with
  // numbers inside them in numeric order, so "Tour 10" follows "Tour 9".
  return String(left).localeCompare(String(right), 'en-GB', { numeric: true, sensitivity: 'base' }) * flip;
}
