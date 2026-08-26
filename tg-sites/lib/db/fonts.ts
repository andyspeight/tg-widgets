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
import { weightsCovered } from '../theme/fonts';
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
  /** The top of a variable file's range, or null for a single weight. */
  weightMax: number | null;
  style: 'normal' | 'italic';
  format: FontFormat;
  unicodeRange: string | null;
}

/**
 * A whole family with its files and their bytes, for copying a library.
 *
 * The one read that DOES pull bytes, because copying a site has to move the
 * actual font, not a reference to it. Everything a face carries is kept: the
 * style and subset and unicode range that saveFontFamily flattens or infers, so
 * a copy is faithful where a re-import would not be.
 */
export interface FontForCopy {
  family: string;
  slug: string;
  source: 'google' | 'upload';
  fallback: FontFamily['fallback'];
  files: Array<{
    weight: number;
    /** The top of a variable file's range, or null for a single weight. */
    weightMax: number | null;
    style: 'normal' | 'italic';
    format: FontFormat;
    subset: string | null;
    unicodeRange: string | null;
    bytes: Buffer;
    byteSize: number;
  }>;
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
        coalesce(
          jsonb_agg(distinct jsonb_build_array(ff.weight, ff.weight_max))
            filter (where ff.weight is not null),
          '[]'::jsonb
        ) as ranges,
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
      /*
       * Expanded from the RANGES rather than aggregated from the filed weights.
       * A variable family is one row covering 400 to 700, and aggregating the
       * column would have reported it as offering 400 alone, which is what the
       * type panel would then have let anyone pick.
       */
      weights: [
        ...new Set(
          (row.ranges as Array<[number, number | null]>).flatMap(([weight, weightMax]) =>
            weightsCovered({ weight: Number(weight), weightMax: weightMax == null ? null : Number(weightMax) }),
          ),
        ),
      ].sort((a, b) => a - b),
      bytes: Number(row.bytes),
    }));
  });
}

/**
 * Every family with its files and bytes, for duplicating a site.
 *
 * PULLS THE BYTES, unlike listFonts, because the caller is copying the library
 * into another tenant and a reference would leave the copy pointing at files it
 * does not own. That is the whole cost of it, so it is its own function rather
 * than a flag on the list: a duplicate is rare and reads everything once, where
 * the theme screen must never drag megabytes of woff2 through to show six names.
 *
 * A query per family for its files. A tenant has a handful of families, so the
 * round trips do not matter, and the alternative is stitching bytes back apart
 * from one big join in JavaScript.
 */
export async function listFontsForCopy(tenantId: string): Promise<FontForCopy[]> {
  return withTenant(tenantId, async (tx) => {
    const families = await tx`
      select id, family, slug, source, fallback from public.fonts order by slug
    `;

    const out: FontForCopy[] = [];
    for (const raw of families) {
      const row = raw as Record<string, unknown>;
      const files = await tx`
        select weight, weight_max, style, format, subset, unicode_range, bytes, byte_size
        from public.font_files where font_id = ${String(row.id)}::uuid
        order by weight, style
      `;

      out.push({
        family: String(row.family),
        slug: String(row.slug),
        source: row.source === 'upload' ? 'upload' : 'google',
        fallback: String(row.fallback) as FontFamily['fallback'],
        files: files.map((fileRaw) => {
          const file = fileRaw as Record<string, unknown>;
          return {
            weight: Number(file.weight),
            weightMax: file.weight_max == null ? null : Number(file.weight_max),
            style: file.style === 'italic' ? 'italic' : 'normal',
            format: file.format as FontFormat,
            subset: file.subset == null ? null : String(file.subset),
            unicodeRange: file.unicode_range == null ? null : String(file.unicode_range),
            bytes: file.bytes as Buffer,
            byteSize: Number(file.byte_size),
          };
        }),
      });
    }

    return out;
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
        ff.weight, ff.weight_max, ff.style, ff.format, ff.unicode_range
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
      weightMax: row.weight_max == null ? null : Number(row.weight_max),
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
          (tenant_id, font_id, weight, weight_max, style, format, subset, unicode_range, bytes, byte_size)
        values (
          ${tenantId}, ${fontId}, ${file.weight}, ${file.weightMax}, 'normal', ${file.format},
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
      // Expanded, so a variable family imported as one file per subset reports
      // the four weights it can actually render rather than only its lightest.
      weights: [...new Set(imported.files.flatMap((f) => weightsCovered(f)))].sort((a, b) => a - b),
      bytes: total,
    };
  });
}

/**
 * Write a family and its files verbatim, for a site duplicate.
 *
 * SEPARATE FROM saveFontFamily on purpose. That one takes a freshly imported
 * family and writes every face as style 'normal', which is right for an import
 * but would flatten an italic on a copy. This takes a face exactly as it was
 * read and puts it back byte for byte, style and subset and unicode range
 * intact, so the clone's library is the source's and not a lossy re-import.
 *
 * Upsert on the slug and clear the old files first, the same shape saveFontFamily
 * uses, so a copy that runs twice ends up with one family and its files rather
 * than a duplicate. Meant to be called inside the destination's transaction: by
 * id it reuses that scope, so the whole library copy is one atomic write.
 */
export async function insertCopiedFont(tenantId: string, font: FontForCopy): Promise<void> {
  await withTenant(tenantId, async (tx) => {
    const [row] = await tx`
      insert into public.fonts (tenant_id, family, slug, source, fallback)
      values (${tenantId}, ${font.family}, ${font.slug}, ${font.source}, ${font.fallback})
      on conflict (tenant_id, slug) do update set
        family = excluded.family,
        source = excluded.source,
        fallback = excluded.fallback
      returning id
    `;
    const fontId = String(row.id);

    await tx`delete from public.font_files where font_id = ${fontId}`;

    for (const file of font.files) {
      await tx`
        insert into public.font_files
          (tenant_id, font_id, weight, weight_max, style, format, subset, unicode_range, bytes, byte_size)
        values (
          ${tenantId}, ${fontId}, ${file.weight}, ${file.weightMax}, ${file.style}, ${file.format},
          ${file.subset}, ${file.unicodeRange}, ${file.bytes}, ${file.byteSize}
        )
      `;
    }
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
