/**
 * The font library: families a tenant has, and the files behind them.
 *
 * Everything goes through withTenant or withPublicTenant, so the policies do
 * the scoping and there is no WHERE tenant_id anywhere in this file to get
 * wrong. See db/migrations/0010_fonts.sql for why the bytes live in Postgres.
 */

import 'server-only';

import {
  familySlug,
  FONT_MIME,
  normaliseFamilyName,
  type FontFormat,
  type ImportedFamily,
} from '../fonts/google';
import { withPublicTenant, withTenant, type Tx } from './withTenant';

/** A family, as the library and the theme see it. */
export interface FontFamily {
  id: string;
  /** The CSS font-family name. */
  family: string;
  /** What the theme stores. */
  slug: string;
  source: 'google' | 'upload';
  /** What to show while the file loads, so the page does not reflow shape. */
  fallback: 'sans' | 'serif' | 'slab' | 'script' | 'mono' | 'display';
  /** Which weights are actually available, ascending. */
  weights: number[];
  /** Everything this family costs, for the UI to show. */
  bytes: number;
}

/**
 * One file, without its bytes. Enough to write a @font-face rule.
 *
 * Structurally the same as LibraryFontFile in lib/theme/fonts.ts, on purpose:
 * this is what comes out of the database and that is what the emitter takes, and
 * a mapping function between two identical shapes is a place for them to drift.
 * fallback is repeated on every file rather than looked up per family so the
 * family list can be derived without a second query.
 */
export interface FontFaceRow {
  id: string;
  family: string;
  slug: string;
  fallback: FontFamily['fallback'];
  weight: number;
  style: 'normal' | 'italic';
  format: FontFormat;
  unicodeRange: string | null;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * Every family in the library, with its weights rolled up.
 *
 * Deliberately does NOT select bytes. This is what the theme screen lists, and
 * pulling two megabytes of woff2 through the connection to render a list of six
 * names is the kind of query that looks fine until a tenant has ten families.
 */
export async function listFonts(tenantId: string): Promise<FontFamily[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      select
        f.id, f.family, f.slug, f.source, f.fallback,
        coalesce(array_agg(distinct ff.weight order by ff.weight)
                 filter (where ff.weight is not null), '{}') as weights,
        coalesce(sum(ff.byte_size), 0) as bytes
      from public.fonts f
      left join public.font_files ff on ff.font_id = f.id
      group by f.id, f.family, f.slug, f.source, f.fallback
      order by f.family
    `;

    return rows.map((row) => ({
      id: String(row.id),
      family: String(row.family),
      slug: String(row.slug),
      source: row.source === 'upload' ? 'upload' : 'google',
      fallback: String(row.fallback) as FontFamily['fallback'],
      weights: (row.weights as number[]).map(Number),
      bytes: Number(row.bytes),
    }));
  });
}

/**
 * Everything needed to write the @font-face rules for a page.
 *
 * `role` picks the connection. A published page is rendered for a visitor, so it
 * reads through the read-only role; the editor reads through its own. The
 * default is the renderer, because getting that wrong on the public path is the
 * expensive mistake and a default should fail towards the safer one.
 */
export async function listFontFaces(
  tenantId: string,
  role: 'app' | 'renderer' = 'renderer',
): Promise<FontFaceRow[]> {
  const run = role === 'app' ? withTenant : withPublicTenant;

  return run(tenantId, async (tx: Tx) => {
    const rows = await tx`
      select
        ff.id, f.family, f.slug, f.fallback,
        ff.weight, ff.style, ff.format, ff.unicode_range
      from public.font_files ff
      join public.fonts f on f.id = ff.font_id
      order by f.family, ff.weight, ff.subset nulls first
    `;

    return rows.map((row) => ({
      id: String(row.id),
      family: String(row.family),
      slug: String(row.slug),
      fallback: String(row.fallback) as FontFamily['fallback'],
      weight: Number(row.weight),
      style: row.style === 'italic' ? 'italic' : 'normal',
      format: row.format as FontFormat,
      unicodeRange: row.unicode_range == null ? null : String(row.unicode_range),
    }));
  });
}

/**
 * One file's bytes, for the route that serves it.
 *
 * Read through the READ-ONLY role, because the caller is an unauthenticated
 * request from somebody's browser. A font file is public by nature, so the
 * renderer having select on it is correct; what matters is that this path
 * cannot write and cannot reach anything else.
 */
export async function getFontFile(
  tenantId: string,
  fileId: string,
): Promise<{ bytes: Buffer; mime: string } | null> {
  // Checked here rather than trusted from the URL. A malformed id would reach
  // Postgres as a failed uuid cast, which is an error page instead of a 404.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(fileId)) {
    return null;
  }

  return withPublicTenant(tenantId, async (tx) => {
    const rows = await tx`
      select bytes, format from public.font_files where id = ${fileId} limit 1
    `;
    if (!rows.length) return null;

    const row = rows[0] as Record<string, unknown>;
    return {
      bytes: row.bytes as Buffer,
      mime: FONT_MIME[row.format as FontFormat] ?? 'application/octet-stream',
    };
  });
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/**
 * Store a family and its files, replacing any earlier import of the same name.
 *
 * REPLACES RATHER THAN ADDS. Importing the same family twice is something a
 * person will do, either because they forgot or because they want a newer
 * version, and the reasonable outcome is one family with fresh files rather than
 * a duplicate or an error. Deleting the old files first is what makes that true:
 * a family that used to have four weights and now has one should end up with
 * one, not five.
 *
 * All inside a single transaction, so a failure part way through leaves the
 * library as it was rather than as a family with half its weights.
 */
export async function saveFontFamily(
  tenantId: string,
  imported: ImportedFamily,
  source: 'google' | 'upload',
  /** What to fall back to while the file loads. See the fonts table. */
  fallback: FontFamily['fallback'] = 'sans',
): Promise<FontFamily> {
  const family = normaliseFamilyName(imported.family);
  if (!family) throw new Error(`"${imported.family}" is not a usable font name.`);
  if (imported.files.length === 0) throw new Error(`${family} has no font files.`);

  const slug = familySlug(family);

  return withTenant(tenantId, async (tx) => {
    const [row] = await tx`
      insert into public.fonts (tenant_id, family, slug, source, fallback)
      values (${tenantId}, ${family}, ${slug}, ${source}, ${fallback})
      on conflict (tenant_id, slug)
        do update set
          family = excluded.family,
          source = excluded.source,
          fallback = excluded.fallback
      returning id
    `;
    const fontId = String(row.id);

    // The old files go, so a re-import cannot leave a weight behind that the
    // new version does not have.
    await tx`delete from public.font_files where font_id = ${fontId}`;

    let total = 0;
    for (const file of imported.files) {
      const bytes = Buffer.from(file.bytes);
      total += bytes.byteLength;

      await tx`
        insert into public.font_files
          (tenant_id, font_id, weight, style, format, subset, unicode_range, bytes, byte_size)
        values (
          ${tenantId}, ${fontId}, ${file.weight}, 'normal', ${file.format},
          ${file.subset}, ${file.unicodeRange},
          ${bytes}, ${bytes.byteLength}
        )
      `;
    }

    return {
      id: fontId,
      family,
      slug,
      source,
      fallback,
      weights: [...new Set(imported.files.map((f) => f.weight))].sort((a, b) => a - b),
      bytes: total,
    };
  });
}

/**
 * Remove a family and everything under it.
 *
 * Returns false when there was nothing to remove, which for a policy-scoped
 * delete also covers "belongs to another tenant". Those are the same answer
 * here on purpose: a guessed id should confirm nothing.
 */
export async function deleteFontFamily(tenantId: string, slug: string): Promise<boolean> {
  return withTenant(tenantId, async (tx) => {
    // font_files goes with it, by the foreign key's ON DELETE CASCADE.
    const rows = await tx`
      delete from public.fonts where slug = ${slug} returning id
    `;
    return rows.length > 0;
  });
}
