/**
 * The pure half of a form submission: find the form on the published page,
 * pair the posted controls with its fields, and decide bot or person.
 *
 * Everything here is a plain function over plain values so the tests can cover
 * every rejection without an HTTP request or a database. The route
 * (app/site/[host]/_form/route.ts) is the thin glue around it.
 *
 * THE PUBLISHED CONTENT IS THE CONTRACT. Control names are q_0, q_1... and the
 * stored keys are the LABELS READ FROM THE PUBLISHED BLOCK, never anything the
 * visitor posted. A submission for a block id that is not a form on that page
 * is refused outright, which is what keeps /_form from being a general-purpose
 * write endpoint: it will only store what a published form asked for.
 */

import type { Page, Section } from '../content/schema';

/** One field as the published block declares it. */
export interface DeclaredField {
  kind: string;
  label: string;
  required: boolean;
}

export interface FoundForm {
  name: string;
  notifyEmail: string;
  fields: DeclaredField[];
}

/** How a refusal should be answered: as if it worked, or as a visible error. */
export type Refusal = 'silent' | 'error';

const MAX_FIELDS = 12;
const MAX_VALUE_LENGTH = 4000;
const MAX_TOTAL_BYTES = 12_000;

/** How long a person plausibly needs between seeing a form and sending it. */
const MIN_FILL_MS = 2500;

/** How stale a render timestamp may be before we stop trusting it at all. A
 * cached page can be old, so only a FUTURE timestamp is suspicious. */
const MAX_CLOCK_SKEW_MS = 60_000;

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function fieldFrom(raw: unknown): DeclaredField | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  const label = asString(item.label).trim();
  return {
    kind: asString(item.kind) || 'text',
    label,
    required: item.required === true,
  };
}

/**
 * Walk every block on the page, including blocks nested inside grid and
 * container cells, whose props carry column-like objects with blocks of their
 * own. The walk is shape-driven rather than type-driven so a future nesting
 * block is included by construction.
 */
function* blocksOf(page: Page): Generator<{ id: string; type: string; props: Record<string, unknown> }> {
  function* fromColumns(columns: unknown): Generator<{ id: string; type: string; props: Record<string, unknown> }> {
    if (!Array.isArray(columns)) return;
    for (const column of columns) {
      if (!column || typeof column !== 'object') continue;
      const blocks = (column as Record<string, unknown>).blocks;
      if (!Array.isArray(blocks)) continue;
      for (const block of blocks) yield* fromBlock(block);
    }
  }

  function* fromBlock(raw: unknown): Generator<{ id: string; type: string; props: Record<string, unknown> }> {
    if (!raw || typeof raw !== 'object') return;
    const block = raw as { id?: unknown; type?: unknown; props?: unknown };
    const props = (block.props && typeof block.props === 'object' ? block.props : {}) as Record<string, unknown>;
    yield { id: asString(block.id), type: asString(block.type), props };
    yield* fromColumns(props.columns);
  }

  for (const section of (page.sections ?? []) as Section[]) {
    for (const row of section.rows ?? []) {
      yield* fromColumns((row as { columns?: unknown }).columns);
    }
  }
}

/** The form block with this id on this page, or null: not published, not stored. */
export function findFormBlock(page: Page, blockId: string): FoundForm | null {
  if (!blockId) return null;
  for (const block of blocksOf(page)) {
    if (block.type !== 'form' || block.id !== blockId) continue;
    const rawFields = Array.isArray(block.props.fields) ? block.props.fields : [];
    return {
      name: asString(block.props.name).trim(),
      notifyEmail: asString(block.props.notifyEmail).trim(),
      fields: rawFields.slice(0, MAX_FIELDS).map(fieldFrom).filter((f): f is DeclaredField => f !== null),
    };
  }
  return null;
}

export type ParseResult =
  | { ok: true; data: Record<string, string> }
  | { ok: false; refusal: Refusal };

/**
 * Pair the posted controls with the declared fields.
 *
 * - The honeypot filled, or the form sent faster than a person reads: refuse
 *   SILENTLY. A bot told its post failed simply retries; one told it worked
 *   moves on.
 * - Required declared fields empty, or the payload over its caps: refuse as an
 *   ERROR, because a person with a broken submission needs to be told.
 *
 * `now` is a parameter so the tests can hold the clock still.
 */
export function parseSubmission(
  entries: Iterable<[string, unknown]>,
  form: FoundForm,
  now: number,
): ParseResult {
  const posted = new Map<string, string>();
  let count = 0;
  for (const [key, value] of entries) {
    // Files and exotic parts are never something a form here asked for.
    if (typeof value !== 'string') return { ok: false, refusal: 'silent' };
    if (++count > 40) return { ok: false, refusal: 'silent' };
    posted.set(key, value);
  }

  if ((posted.get('_website') ?? '') !== '') return { ok: false, refusal: 'silent' };

  const at = Number(posted.get('_at'));
  if (!Number.isFinite(at) || at <= 0) return { ok: false, refusal: 'silent' };
  if (now - at < MIN_FILL_MS) return { ok: false, refusal: 'silent' };
  if (at - now > MAX_CLOCK_SKEW_MS) return { ok: false, refusal: 'silent' };

  const data: Record<string, string> = {};
  let total = 0;
  let answered = 0;

  form.fields.forEach((field, index) => {
    const raw = (posted.get(`q_${index}`) ?? '').trim();
    const value = raw.slice(0, MAX_VALUE_LENGTH);
    if (value) answered += 1;
    total += value.length;
    // The stored key is the published label, deduplicated by suffix so two
    // fields a client labelled identically do not overwrite each other.
    const base = field.label || `Field ${index + 1}`;
    let key = base;
    let n = 2;
    while (key in data) key = `${base} (${n++})`;
    data[key] = value;
  });

  if (total > MAX_TOTAL_BYTES) return { ok: false, refusal: 'error' };
  if (answered === 0) return { ok: false, refusal: 'error' };
  for (let index = 0; index < form.fields.length; index += 1) {
    if (form.fields[index].required && !(posted.get(`q_${index}`) ?? '').trim()) {
      return { ok: false, refusal: 'error' };
    }
  }

  return { ok: true, data };
}

/** A plausible notification address, or empty. Deliberately simple: the real
 * arbiter is the mail provider; this only refuses obvious junk. */
export function cleanNotifyEmail(value: string): string {
  const email = value.trim();
  if (email.length === 0 || email.length > 200) return '';
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}
