/**
 * A collection's own fields: the day migration 0004 planned for.
 *
 * collection.ts named three things that had to exist before the `fields` column
 * could be filled in, and this file is each of them:
 *
 * THE SCHEMA DESIGNER is a list of definitions a client edits on the collections
 * screen: a label, a kind, whether it is required. Nothing more, because a
 * tour's "Nights" needs a number and a label, not a validation language.
 *
 * THE FORM GENERATOR is the editor reading those definitions and drawing one
 * input per field, each keyed by `key`.
 *
 * THE RENAME STORY is the split between `key` and `label`. The key is minted
 * once, from the first label, and never changes, so two hundred items keep
 * storing their nights under the same key forever. Renaming the label is then
 * free, which is the operation people actually perform. DELETING a definition
 * strands its values harmlessly: they stay in the item's bag, invisible, until a
 * definition with that key exists again. Throwing away a client's writing
 * because they tidied a schema is the accident this shape exists to prevent.
 *
 * WHERE THE CLEANING HAPPENS. Shape safety is in collection.ts, inside the item
 * parse, where the definitions are not in hand. Kind safety is here, in
 * cleanFieldValues, called once at save where they are. See safeFieldBag for why
 * the two are apart.
 */

import { z } from 'zod';

import { MAX_FIELDS, safeDate, safeSlug, type FieldValue } from './collection';
import { safeUrl } from './sanitise';

export const FIELD_KINDS = [
  'text',
  'longtext',
  'number',
  'price',
  'date',
  'image',
  'toggle',
  'choice',
] as const;

export type FieldKind = (typeof FIELD_KINDS)[number];

/** What each kind is called in front of a client, and what it is for. */
export const FIELD_KIND_LABEL: Record<FieldKind, string> = {
  text: 'A few words',
  longtext: 'A paragraph',
  number: 'A number',
  price: 'A price',
  date: 'A date',
  image: 'A picture',
  toggle: 'Yes or no',
  choice: 'One from a list',
};

export const FIELD_KIND_HINT: Record<FieldKind, string> = {
  text: 'Departs from, duration, whatever fits on one line.',
  longtext: 'A sentence or two. Longer than that belongs in the words.',
  number: 'Nights, group size, altitude. Counted, not written out.',
  price: 'Shown with the site currency, and set in the data typeface.',
  date: 'A day, with no time attached.',
  image: 'A second picture beside the main one. A map, a deck plan, a menu.',
  toggle: 'Escorted, flights included, wheelchair friendly.',
  choice: 'Board basis, difficulty, season. You write the list.',
};

/** One field, as the collection declares it. */
export interface FieldDef {
  /** Minted from the first label, then immutable. What every item stores under. */
  key: string;
  label: string;
  kind: FieldKind;
  required: boolean;
  /** Only a choice field reads these. Display labels, stored as chosen. */
  choices: string[];
}

const MAX_CHOICES = 24;

const FieldDefSchema = z.object({
  key: z
    .unknown()
    .transform((value) => safeSlug(value).slice(0, 60))
    .pipe(z.string().min(1)),
  label: z
    .unknown()
    .transform((value) =>
      typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 80) : '',
    )
    .pipe(z.string().min(1)),
  kind: z.enum(FIELD_KINDS).catch('text'),
  required: z.unknown().transform((value) => value === true),
  choices: z.unknown().transform((value) => {
    if (!Array.isArray(value)) return [] as string[];
    const out: string[] = [];
    for (const raw of value) {
      if (typeof raw !== 'string') continue;
      const label = raw.replace(/\s+/g, ' ').trim().slice(0, 60);
      if (label && !out.includes(label)) out.push(label);
      if (out.length >= MAX_CHOICES) break;
    }
    return out;
  }),
});

/**
 * The definitions, from whatever the jsonb column holds.
 *
 * TOTAL, the way parseTheme is total: a junk row is dropped rather than thrown
 * over, a duplicate key keeps its first definition, and anything that is not an
 * array is no definitions at all, which is every collection made before this
 * existed and every blog that never wants any.
 */
export function parseFieldDefs(value: unknown): FieldDef[] {
  if (!Array.isArray(value)) return [];

  const out: FieldDef[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    const parsed = FieldDefSchema.safeParse(raw);
    if (!parsed.success) continue;
    if (seen.has(parsed.data.key)) continue;
    seen.add(parsed.data.key);
    out.push(parsed.data);
    if (out.length >= MAX_FIELDS) break;
  }
  return out;
}

/** A key for a new field: the label's slug, suffixed past anything taken. */
export function mintFieldKey(label: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = safeSlug(label).slice(0, 56) || 'field';
  let key = base;
  let n = 2;
  while (used.has(key)) key = `${base}-${n++}`;
  return key;
}

/**
 * One value, coerced to its field's kind, or undefined if it cannot be.
 *
 * A value that will not coerce is DROPPED rather than refused. The editor's
 * inputs make a word in a number field hard to produce in the first place, and a
 * save that fails because one of fourteen fields disagrees would lose the
 * writing in the other thirteen. Required is a prompt in the editor, not a
 * refusal here, for the same reason: a draft is allowed to be half finished.
 */
function coerce(def: FieldDef, value: FieldValue): FieldValue | undefined {
  switch (def.kind) {
    case 'toggle':
      return value === true || value === 'true';

    case 'number':
    case 'price': {
      let n: number;
      if (typeof value === 'number') {
        n = value;
      } else {
        // "£1,299.50" and "7 nights" are both numbers somebody typed, so the
        // currency and the units come off. The digit check is not decoration:
        // stripping "a fortnight" leaves an empty string, and Number('') is
        // ZERO, which would store a tour of nought nights and print it on a
        // card as a fact. No digits means no number.
        const digits = String(value).replace(/[^0-9.-]/g, '');
        if (!/[0-9]/.test(digits)) return undefined;
        n = Number(digits);
      }
      // Rounded to the penny: a price is money and a number of nights is a
      // number of nights, and neither wants a float's tail printed on a card.
      return Number.isFinite(n) ? Math.round(n * 100) / 100 : undefined;
    }

    case 'date': {
      const date = safeDate(String(value));
      return date || undefined;
    }

    case 'choice': {
      const choice = String(value);
      return def.choices.includes(choice) ? choice : undefined;
    }

    case 'image':
      // A media id or a URL, through the same allowlist every other picture on
      // the site goes through. Done HERE rather than in sanitiseItem because
      // this is the only place that knows which of an item's values are URLs.
      return safeUrl(String(value).slice(0, 2048)) ?? undefined;

    case 'longtext':
      return String(value).slice(0, 2000);

    default:
      return String(value).replace(/\s+/g, ' ').trim().slice(0, 200);
  }
}

/**
 * An item's answers, cleaned against its collection's definitions, at save.
 *
 * Values under keys with no definition pass through untouched: see the rename
 * story above on why they are worth keeping.
 */
export function cleanFieldValues(
  defs: readonly FieldDef[],
  raw: Record<string, FieldValue>,
): Record<string, FieldValue> {
  const out: Record<string, FieldValue> = { ...raw };
  for (const def of defs) {
    const value = out[def.key];
    if (value === undefined) continue;

    const clean = coerce(def, value);
    if (clean === undefined) delete out[def.key];
    else out[def.key] = clean;
  }
  return out;
}

/** Every declared field an item has left empty. What the editor prompts about. */
export function missingRequired(
  defs: readonly FieldDef[],
  values: Record<string, FieldValue>,
): FieldDef[] {
  return defs.filter((def) => {
    if (!def.required) return false;
    const value = values[def.key];
    // False is an answer to "Escorted", so only a toggle may be false and full.
    if (def.kind === 'toggle') return value === undefined;
    return value === undefined || value === '';
  });
}

/**
 * Starter sets, so a client's first collection is not a blank schema designer.
 *
 * The keys minted here are the stable contract; every label is the client's to
 * rename the moment it does not match how they talk about their own trips.
 */
export interface FieldPreset {
  id: string;
  name: string;
  /** The collection this preset makes, if the client has not named one. */
  collectionName: string;
  blurb: string;
  fields: FieldDef[];
}

function def(
  key: string,
  label: string,
  kind: FieldKind,
  required = false,
  choices: string[] = [],
): FieldDef {
  return { key, label, kind, required, choices };
}

export const FIELD_PRESETS: FieldPreset[] = [
  {
    id: 'tours',
    name: 'Tours and holidays',
    collectionName: 'Tours',
    blurb: 'Price, nights, departures and board. The facts a card has to carry.',
    fields: [
      def('price-from', 'Price from, per person', 'price', true),
      def('nights', 'Nights', 'number', true),
      def('departs', 'Departs from', 'text'),
      def('next-departure', 'Next departure', 'date'),
      def('board', 'Board', 'choice', false, [
        'Room only',
        'Bed and breakfast',
        'Half board',
        'Full board',
        'All inclusive',
      ]),
      def('escorted', 'Escorted throughout', 'toggle'),
    ],
  },
  {
    id: 'destinations',
    name: 'Destinations',
    collectionName: 'Destinations',
    blurb: 'Country, flying time, best months. A guide page that answers first.',
    fields: [
      def('country', 'Country', 'text', true),
      def('flying-time', 'Flying time, hours', 'number'),
      def('best-months', 'Best months', 'text'),
      def('currency', 'Currency', 'text'),
      def('visa', 'Visa needed', 'toggle'),
      def('map', 'Map', 'image'),
    ],
  },
  {
    id: 'blog',
    name: 'Blog',
    collectionName: 'Blog',
    blurb: 'No extra fields. A post already has a title, a picture and a date.',
    fields: [],
  },
];

/** The Tours starter on its own, which is the one a travel business wants. */
export function toursPresetFields(): FieldDef[] {
  return FIELD_PRESETS.find((preset) => preset.id === 'tours')?.fields ?? [];
}
