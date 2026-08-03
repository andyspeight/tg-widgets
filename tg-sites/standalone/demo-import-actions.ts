/**
 * In-memory stand-in for the import action, for the standalone build only.
 *
 * WHY IT HAS TO EXIST. The real app/actions/import calls requireTenantId first,
 * which reaches the Postgres driver, and a file served from a static host has
 * no database and no node built-ins. Without this swap the whole editor bundle
 * fails to build the moment the import screen is reachable from it, which is
 * what happened between the import screen landing (task #92) and 2 Aug 2026:
 * the standalone review copy quietly stopped building and nobody was watching
 * the harness. Adding the swap here is the fix the handover already prescribed
 * for exactly this shape of breakage.
 *
 * IT IS A REAL DOUBLE, NOT A STUB. The only thing dropped is the auth gate; the
 * cleaning and splitting are the actual splitImport the server runs, so a paste
 * that would come back as three sections on the live site comes back as three
 * here, in the browser, where the harness can see it. That is the whole reason
 * to double rather than stub.
 */

import { createBlock, createSection } from '../lib/content/factory';
import type { Section } from '../lib/content/schema';
import { splitImport, type ImportCandidate } from '../lib/import/sections';
import { rebuildSection } from '../lib/import/rebuild';

// Kept in step with the real action. If those ceilings change, this is the
// second place, and the paste is clamped the same way so the harness sees the
// same refusal.
const MAX_HTML = 400_000;
const MAX_CSS = 200_000;

export interface ImportPreview {
  sections: { label: string; section: Section; slots: number }[];
  removed: string[];
}

export type ImportActionResult =
  | { ok: true; data: ImportPreview }
  | { ok: false; error: string };

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

/** The same shaping the real action does, minus the auth it cannot have here. */
function asSection(candidate: ImportCandidate): Section {
  const section = createSection('1');
  const block = createBlock('imported');

  block.props = {
    html: candidate.html,
    css: candidate.css,
    label: candidate.label,
    fields: candidate.fields,
    content: {},
  };

  section.name = candidate.label;
  section.rows[0].columns[0].blocks = [block];
  section.width = 'full';
  section.paddingY = 0;

  return section;
}

export async function previewImportAction(input: unknown): Promise<ImportActionResult> {
  const raw = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const html = text(raw.html, MAX_HTML);
  const css = text(raw.css, MAX_CSS);

  if (!html.trim()) {
    return { ok: false, error: 'Paste the HTML of the design you want to bring in.' };
  }

  let split;
  try {
    split = splitImport(html, css);
  } catch {
    return { ok: false, error: 'We could not read that. Check you copied the whole design.' };
  }

  if (!split.candidates.length) {
    return { ok: false, error: 'There was nothing in that paste we could bring in.' };
  }

  return {
    ok: true,
    data: {
      sections: split.candidates.map((candidate) => ({
        label: candidate.label,
        section: asSection(candidate),
        slots: candidate.fields.length,
      })),
      removed: split.removed,
    },
  };
}

export type RebuildActionResult =
  | { ok: true; section: Section }
  | { ok: false; error: string };

/** The real rebuild, minus the auth it cannot have here. See the real action. */
export async function rebuildImportAction(input: unknown): Promise<RebuildActionResult> {
  const props = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  try {
    return rebuildSection(props);
  } catch {
    return { ok: false, error: 'We could not rebuild this design as blocks.' };
  }
}
