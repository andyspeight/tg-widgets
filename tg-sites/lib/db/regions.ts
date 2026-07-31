/**
 * The header and the footer: reading, saving and publishing.
 *
 * Deliberately shaped like lib/db/pages.ts, because a region is a page's worth
 * of sections that happens to appear on every URL. Same draft-and-published
 * split, same read-only role for the public copy, same parse-then-sanitise on
 * every write.
 *
 * WHAT IS DIFFERENT, AND WHY
 *
 * 1. THERE IS NO ROW UNTIL SOMEBODY SAVES ONE. A tenant that has never touched
 *    its header has no header row, and getRegion answers with an empty region
 *    rather than creating one. Seeding a row per tenant per region at sign-up
 *    would mean a migration that has to find every existing tenant, and a new
 *    region added later would need another. An absent row and an empty one mean
 *    the same thing to every reader here, so there is no reason to insist on
 *    the second.
 *
 * 2. THE WRITE IS AN UPSERT, for exactly that reason. The primary key is
 *    (tenant_id, region), so `on conflict` needs nothing looked up first.
 *
 * 3. THERE IS NO PUBLISH HISTORY. Pages keep fifty snapshots each. A header is
 *    one document per site rather than one per page, and the rollback story for
 *    it is the same story as the page it appears on. If that turns out to be
 *    wrong it is an additive change: another table, the same shape as
 *    publish_events.
 *
 * 4. THE RENDERER CANNOT SEE A DRAFT AT ALL. `pages` keeps drafts from the
 *    public role with a row policy, because a draft page is a whole row. Here
 *    the draft and the live copy are two columns of the same row, so the
 *    equivalent guarantee is a column grant: see 0016_site_regions.sql.
 */

import { sanitiseRegion } from '../content/sanitise-page';
import {
  emptyRegion,
  parseRegion,
  type Region,
  type RegionName,
} from '../content/schema';
import { withPublicTenant, withTenant, type Tx } from './withTenant';

export interface RegionRecord {
  region: Region;
  /** True when the draft has moved on since the last publish. */
  hasUnpublishedChanges: boolean;
  publishedAt: Date | null;
  updatedAt: Date | null;
}

/** Same cast as every other jsonb write in this directory. See pages.ts. */
function json(tx: Tx, value: unknown) {
  return tx.json(value as Parameters<Tx['json']>[0]);
}

/**
 * A jsonb column as an object, whatever shape it arrives in.
 *
 * The same unwrapping pages.ts does, and for the same reason: rows written
 * before tx.json() existed are double encoded, and there is no version of this
 * worth failing to read a client's header over.
 */
function asObject(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return value as Record<string, unknown>;

  if (typeof value === 'string') {
    try {
      return asObject(JSON.parse(value) as unknown);
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Stored bytes back into a Region.
 *
 * `name` is stamped from the row's primary key rather than read out of the
 * JSON, so a blob claiming to be the footer while sitting in the header row
 * does not get to say so.
 *
 * Throws rather than salvages, exactly as hydrate does in pages.ts: every write
 * goes through parseRegion, so content that will not parse means something has
 * written round this module.
 */
function hydrate(raw: unknown, name: RegionName): Region {
  const parsed = parseRegion(asObject(raw) ?? {}, name);

  if (!parsed.ok) {
    throw new Error(
      `Stored content for the ${name} will not parse: ${parsed.errors.join('; ')}`,
    );
  }

  return parsed.region;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** The draft, for the editor. An empty region when there is no row yet. */
export async function getRegion(
  tenantId: string,
  name: RegionName,
): Promise<RegionRecord> {
  return withTenant(tenantId, async (tx) => {
    // No tenant in the WHERE. The policy on site_regions is
    // `tenant_id = current_tenant()`, so a scoped transaction sees only its own.
    const rows = await tx`
      select draft_content, published_at, updated_at,
             (published_at is null or updated_at > published_at) as has_unpublished_changes
      from public.site_regions where region = ${name}
    `;

    if (!rows.length) {
      return {
        region: emptyRegion(name),
        // Nothing to publish is not the same as changes waiting to be published.
        hasUnpublishedChanges: false,
        publishedAt: null,
        updatedAt: null,
      };
    }

    const row = rows[0] as Record<string, unknown>;
    return {
      region: hydrate(row.draft_content, name),
      hasUnpublishedChanges: Boolean(row.has_unpublished_changes),
      publishedAt: row.published_at ? new Date(row.published_at as string) : null,
      updatedAt: row.updated_at ? new Date(row.updated_at as string) : null,
    };
  });
}

/**
 * The published header and footer, for a page a visitor is waiting on.
 *
 * BOTH IN ONE QUERY, on purpose. Every page needs both, and two round trips to
 * eu-west-2 to assemble the furniture around one page would be one too many.
 *
 * A region that has never been published comes back null, which is exactly what
 * `published_content is null` means, and the renderer draws nothing for it.
 */
export async function getPublishedRegions(
  tenantId: string,
): Promise<{ header: Region | null; footer: Region | null }> {
  return withPublicTenant(tenantId, async (tx) => {
    const rows = await tx`
      select region, published_content from public.site_regions
      where published_content is not null
    `;

    const out: { header: Region | null; footer: Region | null } = {
      header: null,
      footer: null,
    };

    for (const raw of rows) {
      const row = raw as Record<string, unknown>;
      const name = String(row.region);
      if (name !== 'header' && name !== 'footer') continue;
      out[name] = hydrate(row.published_content, name);
    }

    return out;
  });
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/**
 * Save the editor's draft.
 *
 * Parsed, normalised and sanitised before it is stored, in that order, and none
 * of it is optional. The editor does the same work client side for immediate
 * feedback, but the editor is not the only thing that can write here and the
 * client half of a check is a courtesy rather than a control.
 */
export async function saveRegionDraft(
  tenantId: string,
  name: RegionName,
  input: unknown,
  userId?: string,
): Promise<RegionRecord> {
  const parsed = parseRegion(input, name);
  if (!parsed.ok) {
    throw new Error(`Refusing to save a malformed ${name}: ${parsed.errors.join('; ')}`);
  }

  const content = sanitiseRegion(parsed.region);

  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      insert into public.site_regions (tenant_id, region, draft_content, updated_by)
      values (${tenantId}::uuid, ${name}, ${json(tx, content)}, ${userId ?? null}::text)
      on conflict (tenant_id, region) do update set
        draft_content = excluded.draft_content,
        updated_by    = excluded.updated_by
      returning draft_content, published_at, updated_at,
        (published_at is null or updated_at > published_at) as has_unpublished_changes
    `;

    const row = rows[0] as Record<string, unknown>;
    return {
      region: hydrate(row.draft_content, name),
      hasUnpublishedChanges: Boolean(row.has_unpublished_changes),
      publishedAt: row.published_at ? new Date(row.published_at as string) : null,
      updatedAt: row.updated_at ? new Date(row.updated_at as string) : null,
    };
  });
}

/**
 * Publish: copy the draft to the live copy.
 *
 * PUBLISHING A HEADER CHANGES EVERY PAGE ON THE SITE, which is the one thing
 * that makes this different from publishing a page, and the reason the draft
 * exists at all. The editor says so before it calls this.
 *
 * An insert as well as an update, so publishing a region nobody has saved a
 * draft for still works rather than silently doing nothing. The insert has to
 * name published_content itself: leaving it to the column default would write
 * NULL, and NULL is precisely how this table says "never published", so a
 * publish that inserted a row would have published nothing.
 *
 * The update reads `site_regions.draft_content`, which inside ON CONFLICT is the
 * row already there rather than the one being inserted. That is what makes the
 * live copy exactly the bytes of the draft, without them passing through
 * JavaScript on the way.
 */
export async function publishRegion(
  tenantId: string,
  name: RegionName,
  userId?: string,
): Promise<RegionRecord> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      insert into public.site_regions
        (tenant_id, region, published_content, published_at, updated_by)
      values (
        ${tenantId}::uuid,
        ${name},
        ${json(tx, emptyRegion(name))},
        now(),
        ${userId ?? null}::text
      )
      on conflict (tenant_id, region) do update set
        published_content = site_regions.draft_content,
        published_at      = now(),
        updated_by        = excluded.updated_by
      returning draft_content, published_at, updated_at,
        (published_at is null or updated_at > published_at) as has_unpublished_changes
    `;

    const row = rows[0] as Record<string, unknown>;
    return {
      region: hydrate(row.draft_content, name),
      hasUnpublishedChanges: Boolean(row.has_unpublished_changes),
      publishedAt: row.published_at ? new Date(row.published_at as string) : null,
      updatedAt: row.updated_at ? new Date(row.updated_at as string) : null,
    };
  });
}
