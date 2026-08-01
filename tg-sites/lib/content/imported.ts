/**
 * An imported design, as a block.
 *
 * WHAT THIS BLOCK IS FOR. Andy's decision on 1 Aug 2026 was "both, in that
 * order": recognise and rebuild whatever we have a native block for, and carry
 * everything else as a frozen imported section. This is the second half, and it
 * is the half that means an import is NEVER REJECTED for containing something
 * we do not yet understand. A Relume section with a layout we have no block for
 * still lands on the page, still looks right, and still has its words and its
 * pictures editable.
 *
 * WHY IT IS NOT THE EMBED BLOCK. Embed is staff only and holds markup nobody
 * checks, on the reasoning that we are the only ones who touch it. This is the
 * opposite: it is for clients, it is expected to be common, and everything in
 * it has been through lib/import. Being safe by construction rather than by
 * permission is what lets a client use it at all.
 *
 * PARSED HERE RATHER THAN TRUSTED. Block props are a loose record by design, so
 * everything this block relies on has to be checked on the way out of the
 * database: the slots are a list of objects with a shape, and a page saved by a
 * newer build, hand-edited, or restored from an old snapshot must not be able
 * to make the renderer throw.
 */

import type { ImportField, ImportFieldKind } from '../import/tokenise';

/** The prop that holds the client's edits, keyed by slot. */
export const CONTENT_PROP = 'content';

const KINDS: readonly ImportFieldKind[] = ['text', 'image', 'link'];

function isKind(value: unknown): value is ImportFieldKind {
  return typeof value === 'string' && (KINDS as readonly string[]).includes(value);
}

/**
 * A slot key, as the markup writes it.
 *
 * Matched against the same shape lib/import/tokenise.ts emits, because a key
 * that cannot appear in the markup can only be noise, and a key with anything
 * else in it would end up inside a regular expression built at render time.
 */
function isSlotKey(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z]\d{1,3}$/.test(value);
}

/** The slots stored on a block, ignoring anything that is not one. */
export function importFields(props: Record<string, unknown>): ImportField[] {
  const raw = props.fields;
  if (!Array.isArray(raw)) return [];

  const out: ImportField[] = [];
  const seen = new Set<string>();

  for (const item of raw.slice(0, 200)) {
    if (!item || typeof item !== 'object') continue;
    const field = item as Record<string, unknown>;

    if (!isSlotKey(field.key) || seen.has(field.key)) continue;
    if (!isKind(field.kind)) continue;
    seen.add(field.key);

    out.push({
      key: field.key,
      kind: field.kind,
      label: typeof field.label === 'string' ? field.label.slice(0, 120) : field.key,
      value: typeof field.value === 'string' ? field.value.slice(0, 4000) : '',
    });
  }

  return out;
}

/**
 * The client's edits, keyed by slot.
 *
 * Only keys that are real slots, and only strings. Everything here is escaped
 * again at substitution time by what its slot IS, so this is about shape rather
 * than safety: a number or an object reaching the renderer would fall back to
 * the design's own value, and silently ignoring an edit is worse than not
 * storing it.
 */
export function importContent(props: Record<string, unknown>): Record<string, string> {
  const raw = props[CONTENT_PROP];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};

  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isSlotKey(key)) continue;
    if (typeof value !== 'string') continue;
    out[key] = value.slice(0, 4000);
  }

  return out;
}

/**
 * The line the outline shows for this block.
 *
 * The name the import screen gave it, then the first slot's words, then a
 * plain fallback. A row of identical "Imported section" entries in the outline
 * is how a client loses track of which one is the hero.
 */
export function summariseImported(props: Record<string, unknown>): string {
  const label = typeof props.label === 'string' ? props.label.trim() : '';
  if (label) return label.slice(0, 60);

  const first = importFields(props).find((field) => field.kind === 'text');
  const stored = first ? importContent(props)[first.key] : undefined;
  const words = (stored ?? first?.value ?? '').trim();

  return words ? words.slice(0, 60) : 'Imported section';
}
