/**
 * A collection item: the shape of a blog post, a destination guide, a tour.
 *
 * THE SHAPE IS FIXED, AND THEN THE COLLECTION ADDS ITS OWN.
 *
 * Every item has the same seven things, and they are the seven that every
 * listing of anything actually needs: a title, an address, a date, a picture, a
 * summary, the body and now a bag of the fields its own collection declares.
 * The fixed part is fixed because a blog post is a blog post everywhere; the
 * bag is what makes a tour different from a post, and its definitions live on
 * the collection (lib/content/collection-fields.ts).
 *
 * The `fields` COLUMN on `collections` has been there since migration 0004,
 * waiting for the three things that had to exist first: a schema designer, a
 * form generator, and an answer for the day somebody renames a field with two
 * hundred items already using it. That answer is the key/label split in
 * collection-fields.ts, and it is why the column could be filled in without a
 * migration or an undo.
 *
 * THE BODY IS A PAGE. Sections, rows, columns, blocks, exactly as a page and a
 * header are. That is what makes a blog post editable in the real editor with
 * the whole block library, rather than in a box that can only hold paragraphs.
 * Same trick as the header and footer: see lib/content/region-page.ts.
 */

import { z } from 'zod';

import { normaliseRow, preNormalise, SectionSchema } from './schema';

/** The address for a slug, and the same reduction the section anchor uses. */
export function safeSlug(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

/**
 * A date, as the plain YYYY-MM-DD a person typed.
 *
 * NOT A TIMESTAMP. A post dated the 3rd of August is dated the 3rd of August in
 * Perth as well as in Preston, and storing an instant would make it the 2nd for
 * half the world. `published_at` on the row is the real timestamp, for ordering
 * and for knowing when the button was pressed. This is the date on the article.
 */
export function safeDate(value: unknown): string {
  if (typeof value !== 'string') return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return '';

  const [, year, month, day] = match;
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return '';

  return `${year}-${month}-${day}`;
}

/**
 * A scheduled go-live time: a valid instant, strictly in the future.
 *
 * NOT safeDate, and the opposite job. safeDate refuses new Date on purpose,
 * because a date-only string parsed as an instant slides by a day west of
 * Greenwich. This is a full timestamp the browser has already resolved to UTC
 * (the schedule dialog calls toISOString before it sends), compared as an
 * instant against now. Anything that will not parse, or is not in the future, is
 * null: scheduling a post for a moment already gone is a publish, not a schedule,
 * and the caller has a separate publish for that.
 */
export function safeFutureTimestamp(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || ms <= Date.now()) return null;
  return new Date(ms).toISOString();
}

/**
 * A post's tags, as a clean list of short display labels.
 *
 * NOT SLUGS. A tag is a word a client types and a reader sees ("Crete", "Family
 * holidays"), rendered as text, so it keeps its spelling and its spaces. The
 * address a tag filter will use is derived from the label where that lands, the
 * same way a page's path is derived from its title, so nothing stored here has
 * to be undone the day filtering arrives.
 *
 * Deduped case-insensitively, keeping the first spelling, so "Crete" and "crete"
 * are one tag not two. Capped in length and in count, because a tag is a label
 * not a paragraph, and a post with forty of them is a mistake rather than a
 * filing system. Anything that is not an array of strings becomes an empty list.
 */
export function safeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== 'string') continue;
    const label = raw.replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
    if (out.length >= 12) break;
  }
  return out;
}

/**
 * The address of a tag's archive: every post in a collection carrying that tag.
 *
 * Built from the same safeSlug an item address uses, so the link on a post and
 * the page the route resolves agree on where the archive lives. The literal
 * "tag" in the middle is what tells the route this is an archive rather than a
 * two-segment post address, and it is a segment no post slug can be (safeSlug
 * keeps it, but a collection's own key sitting before it is what disambiguates).
 */
export function tagArchivePath(collectionKey: string, tag: string): string {
  return `/${collectionKey}/tag/${safeSlug(tag)}`;
}

/** What one declared field's answer may be. */
export type FieldValue = string | number | boolean;

/** The most fields one collection may declare, and so the most an item stores. */
export const MAX_FIELDS = 24;

/**
 * An item's declared-field answers, made SHAPE-safe WITHOUT the definitions.
 *
 * This runs inside the item parse, where the collection's definitions are not in
 * hand and must not need to be: turning stored bytes into an item cannot depend
 * on a second database read, or every listing would cost one. So this caps types
 * and sizes and nothing else. The definition-aware cleaning, which is where a
 * number becomes a number and a choice is checked against its list, happens once
 * at save in cleanFieldValues (lib/content/collection-fields.ts).
 *
 * UNKNOWN KEYS ARE KEPT ON PURPOSE. A key with no definition is either a
 * definition somebody deleted or one a newer deploy added, and both must survive
 * a round trip through an older editor. Nothing renders them, so they cost a few
 * bytes and save a client's data from a schema edit.
 */
export function safeFieldBag(value: unknown): Record<string, FieldValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  const out: Record<string, FieldValue> = {};
  let seen = 0;
  for (const [rawKey, raw] of Object.entries(value as Record<string, unknown>)) {
    const key = safeSlug(rawKey).slice(0, 60);
    if (!key || key in out) continue;
    // Twice the declared maximum: room for the stranded keys above, and still a
    // ceiling, because an item is not a place to store a megabyte of anything.
    if (++seen > MAX_FIELDS * 2) break;

    if (typeof raw === 'boolean') out[key] = raw;
    else if (typeof raw === 'number' && Number.isFinite(raw)) out[key] = raw;
    else if (typeof raw === 'string') out[key] = raw.slice(0, 2000);
  }
  return out;
}

export const CollectionItemSchema = z.object({
  version: z.literal(1),
  title: z.string().max(200).default(''),
  /** The line under the title in a listing, and the search description. */
  summary: z.string().max(400).default(''),
  /** Media id or absolute URL. The picture on the card and at the top. */
  image: z.string().max(2048).default(''),
  alt: z.string().max(200).default(''),
  /** The post's byline, optional. A person's name, shown on the post and card. */
  author: z.string().max(120).default(''),
  date: z.unknown().transform(safeDate),
  /** The post's tags, a short list of display labels. Cleaned the same way
   *  wherever they arrive from: the editor, an import, or an older stored row
   *  that has none. */
  tags: z.unknown().transform(safeTags),
  /** The answers to whatever its collection declares, keyed by field key. */
  fields: z.unknown().transform(safeFieldBag),
  /** The article itself, in the same sections a page is made of. */
  sections: z.array(SectionSchema).default([]),
});

export type CollectionItem = z.infer<typeof CollectionItemSchema>;

export type CollectionItemParseResult =
  | { ok: true; item: CollectionItem }
  | { ok: false; errors: string[] };

export function emptyItem(): CollectionItem {
  return {
    version: 1,
    title: '',
    summary: '',
    image: '',
    alt: '',
    author: '',
    date: '',
    tags: [],
    fields: {},
    sections: [],
  };
}

/**
 * Parse stored bytes into an item.
 *
 * SHARES preNormalise WITH A PAGE AND A REGION. That function keys off the
 * `sections` array rather than off anything page-shaped, which is exactly why:
 * a column dragged in a blog post is repaired by the same code that repairs one
 * on a page, and a block written by an older deploy is upgraded here too. What
 * an item does NOT share is the rest of a page: no slug in the tree, no title
 * inside it, no SEO of its own. Those are columns on the row.
 */
export function parseItem(input: unknown): CollectionItemParseResult {
  const pre = preNormalise(input);
  const base = pre && typeof pre === 'object' ? (pre as Record<string, unknown>) : {};
  const result = CollectionItemSchema.safeParse({ version: 1, ...base });

  if (result.success) {
    return {
      ok: true,
      item: {
        ...result.data,
        sections: result.data.sections.map((section) => ({
          ...section,
          rows: section.rows.map(normaliseRow),
        })),
      },
    };
  }

  return {
    ok: false,
    errors: result.error.issues.map(
      (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
    ),
  };
}
