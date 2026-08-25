import 'server-only';

import { db } from './client';
import type { Tx } from './withTenant';
import { REFERENCE_KINDS, type ReferenceKind } from '../content/reference';

/**
 * The shared destination corpus.
 *
 * THE ONE PLACE THAT READS A TABLE WITH NO TENANT IN IT, and it says so here
 * rather than leaving somebody to notice. Every other module in lib/db goes
 * through withTenant, because every other table's policies key on
 * current_tenant() and a query that forgets returns nothing. reference_records
 * is public reference material shared by every client, so there is no tenant to
 * scope it to and pretending otherwise would be theatre.
 *
 * The precedent is resolveTenantByHostname, which opens its own connection for
 * the same reason: the question has no tenant in it yet. See the note at the top
 * of db/migrations/0028_reference_records.sql for what keeps this safe, the short
 * version being that the renderer role may only read and nothing about a client
 * is in here.
 *
 * A TENANT'S OWN destination is a collection_items row, tenant scoped like
 * everything else, carrying their words. This table is the half we maintain.
 */

/** One corpus record, as the exporter hands it over and as this table stores it. */
export interface ReferenceRecord {
  kind: ReferenceKind;
  sourceId: string;
  name: string;
  slug: string;
  /** Centrally maintained. Refreshed on every sync. */
  facts: Record<string, unknown>;
  /** The seed a client's own prose starts from, copied once at adoption. */
  prose: Record<string, unknown>;
}

export interface SyncOutcome {
  kind: ReferenceKind;
  /** How many the exporter offered. */
  offered: number;
  /** How many were written. Short of `offered` means some were refused here. */
  written: number;
  /** Why any were refused, deduplicated, for the log. */
  refused: string[];
}

/**
 * The driver's json() wrapper, with the one cast it needs.
 *
 * THE SAME HELPER AS pages.ts AND theme.ts, AND FOR THE SAME BUG. Writing a
 * jsonb column with JSON.stringify hands the driver a JS string, which it then
 * serialises as JSON, so what lands is a JSON *string* containing JSON rather
 * than an object. It has bitten this codebase four times now; the fourth was
 * this module, caught by counting rows after the first real sync rather than by
 * anything failing. See db/migrations/0007_unwrap_double_encoded_json.sql.
 *
 * The quiet half is the dangerous half: referenceFacts() returns null for a
 * string, so a destination page would simply have drawn no facts at all.
 */
function json(tx: Tx, value: unknown) {
  return tx.json(value as Parameters<Tx['json']>[0]);
}

/** A short trimmed string, or ''. */
function text(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

function plainObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * What may be written, out of what arrived.
 *
 * THE FAR END IS NOT TRUSTED, even though we wrote it. It is another deployment
 * reachable over the network, its schema has changed five times this year, and
 * the thing it reads from is edited by hand. A record with no source id could
 * never be matched again on the next sync and would insert a duplicate every
 * time it ran, which is the failure that fills a table quietly.
 */
export function usableRecords(
  kind: ReferenceKind,
  records: unknown,
): { usable: ReferenceRecord[]; refused: string[] } {
  const usable: ReferenceRecord[] = [];
  const refused = new Set<string>();

  if (!Array.isArray(records)) {
    refused.add('the export did not contain a list of records');
    return { usable, refused: [...refused] };
  }

  for (const entry of records) {
    const raw = plainObject(entry);
    const sourceId = text(raw.sourceId, 40);
    const name = text(raw.name, 120);
    const slug = text(raw.slug, 80);

    if (!sourceId) { refused.add('a record with no source id'); continue; }
    if (!name) { refused.add('a record with no name'); continue; }
    if (!slug) { refused.add('a record with no slug'); continue; }
    // The exporter is asked for one kind at a time, so a record claiming another
    // means the two ends disagree about what was requested.
    if (raw.kind !== kind) { refused.add(`a record claiming to be a ${String(raw.kind)}`); continue; }

    usable.push({ kind, sourceId, name, slug, facts: plainObject(raw.facts), prose: plainObject(raw.prose) });
  }

  return { usable, refused: [...refused] };
}

/**
 * Write one kind's records, updating what is already there.
 *
 * AN UPSERT ON (kind, source_id), so a record renamed in Airtable updates its
 * row rather than adding a second one. Nothing is deleted here: a record that
 * stops being servable simply stops being offered, and removing its row would
 * take the facts away from any client already publishing it. Deciding what to do
 * about that belongs with adoption, not with the sync.
 */
export async function saveReferenceRecords(records: readonly ReferenceRecord[]): Promise<number> {
  if (records.length === 0) return 0;

  /*
   * ONE TRANSACTION FOR THE WHOLE KIND, and not because a test asked for it. A
   * sync that writes three hundred of five hundred resorts and then fails leaves
   * a corpus that is half one vintage and half another, with nothing recording
   * which rows are which. All of it or none of it is the only state worth having.
   *
   * There is no set_config here, unlike every other transaction in this module,
   * because there is nothing to scope: reference_records has no tenant_id. That
   * is the deliberate exception documented at the top of this file and in
   * db/migrations/0028_reference_records.sql.
   */
  return db('app').begin(async (tx) => {
    let written = 0;

    /*
     * In chunks, because a corpus kind can be five hundred rows and one statement
     * carrying all of them is a statement nobody can read in a log when it fails.
     */
    const CHUNK = 100;
    for (let i = 0; i < records.length; i += CHUNK) {
      const slice = records.slice(i, i + CHUNK);
      const rows = slice.map((record) => ({
        kind: record.kind,
        source_id: record.sourceId,
        name: record.name,
        slug: record.slug,
        facts: json(tx, record.facts),
        prose: json(tx, record.prose),
        synced_at: new Date().toISOString(),
      }));

      await tx`
        insert into public.reference_records ${tx(rows, 'kind', 'source_id', 'name', 'slug', 'facts', 'prose', 'synced_at')}
        on conflict (kind, source_id) do update set
          name = excluded.name,
          slug = excluded.slug,
          facts = excluded.facts,
          prose = excluded.prose,
          synced_at = excluded.synced_at
      `;
      written += slice.length;
    }

    return written;
  }) as Promise<number>;
}

/**
 * Pull one kind from the widget suite's exporter and store it.
 *
 * Throws rather than half-succeeding: the caller runs the kinds one at a time and
 * reports each, so one kind failing leaves the other four already written rather
 * than taking the whole sync down.
 */
export async function syncReferenceKind(kind: ReferenceKind): Promise<SyncOutcome> {
  /*
   * Trimmed, and a trailing slash taken off. Both of those come from pasting a
   * URL into a settings box, and `.../export/?kind=country` is a 404 whose
   * message tells you nothing about why. Cheap to absorb, annoying to diagnose.
   */
  const base = (process.env.REFERENCE_EXPORT_URL ?? '').trim().replace(/\/+$/, '');
  const secret = process.env.REFERENCE_EXPORT_SECRET;
  if (!base || !secret) {
    throw new Error('REFERENCE_EXPORT_URL and REFERENCE_EXPORT_SECRET must both be set.');
  }

  const url = `${base}?kind=${encodeURIComponent(kind)}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${secret}` },
    // Nothing about this should be cached: it is the thing that fills the cache.
    cache: 'no-store',
  });

  if (!response.ok) {
    /*
     * The URL is in the message and the secret is not. A 401 here means the two
     * ends hold different secrets and a 404 means the address is wrong, and
     * telling those apart without the address takes a deploy to work out.
     */
    throw new Error(`The exporter answered ${response.status} for ${kind} at ${url}.`);
  }

  const payload = (await response.json()) as { records?: unknown; seen?: number; served?: number };

  /*
   * A KIND THAT COMES BACK EMPTY IS TREATED AS A FAULT, NOT AS AN ANSWER.
   *
   * The corpus has a hundred and eight countries and four hundred and ninety-five
   * resorts. Zero means the status gate stopped matching, or the table moved, or
   * the credential lapsed. Writing nothing would be correct and useless; the
   * point is that nobody would notice for weeks. So it throws, and the caller
   * reports it.
   */
  const { usable, refused } = usableRecords(kind, payload.records);
  if (usable.length === 0) {
    throw new Error(
      `The exporter offered nothing usable for ${kind} `
      + `(it looked at ${payload.seen ?? '?'} and served ${payload.served ?? '?'}).`,
    );
  }

  const written = await saveReferenceRecords(usable);
  return { kind, offered: Array.isArray(payload.records) ? payload.records.length : 0, written, refused };
}

/** Every kind, one at a time, so one failing does not lose the rest. */
export async function syncAllReference(): Promise<{
  ok: SyncOutcome[];
  failed: Array<{ kind: ReferenceKind; reason: string }>;
}> {
  const ok: SyncOutcome[] = [];
  const failed: Array<{ kind: ReferenceKind; reason: string }> = [];

  for (const kind of REFERENCE_KINDS) {
    try {
      ok.push(await syncReferenceKind(kind));
    } catch (error) {
      failed.push({ kind, reason: error instanceof Error ? error.message : 'unknown' });
    }
  }

  return { ok, failed };
}
