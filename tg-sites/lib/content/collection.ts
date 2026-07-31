/**
 * A collection item: the shape of a blog post, a destination guide, a job.
 *
 * WHY THE SHAPE IS FIXED RATHER THAN DESIGNED PER COLLECTION.
 *
 * The `collections` table has had a `fields` column since migration 0004, meant
 * for a client to design their own. Filling it in would mean building a schema
 * designer, then a form generator for whatever it produced, then a migration
 * story for the day somebody renames a field with two hundred items already
 * using it. That is a product on its own and it is not the product Andy asked
 * for: a blog, and a listing page that stays in step with it.
 *
 * So every item has the same six things, and they are the six that every
 * listing of anything actually needs: a title, an address, a date, a picture, a
 * summary and the body. `fields` stays empty and stays available, so the day
 * that product IS wanted, nothing here has to be undone.
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

export const CollectionItemSchema = z.object({
  version: z.literal(1),
  title: z.string().max(200).default(''),
  /** The line under the title in a listing, and the search description. */
  summary: z.string().max(400).default(''),
  /** Media id or absolute URL. The picture on the card and at the top. */
  image: z.string().max(2048).default(''),
  alt: z.string().max(200).default(''),
  date: z.unknown().transform(safeDate),
  /** The article itself, in the same sections a page is made of. */
  sections: z.array(SectionSchema).default([]),
});

export type CollectionItem = z.infer<typeof CollectionItemSchema>;

export type CollectionItemParseResult =
  | { ok: true; item: CollectionItem }
  | { ok: false; errors: string[] };

export function emptyItem(): CollectionItem {
  return { version: 1, title: '', summary: '', image: '', alt: '', date: '', sections: [] };
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
