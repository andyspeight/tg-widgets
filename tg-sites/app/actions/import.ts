'use server';

/**
 * Bringing a design in from Relume, Figma or the slicer.
 *
 * WHY THE WORK IS HERE RATHER THAN IN THE BROWSER. The cleaning is parser
 * backed, which means parse5 and postcss, which is roughly two hundred kilobytes
 * somebody would be downloading to paste one section. More importantly this is
 * where it BELONGS: the answer is content that will be saved and served, and
 * content that a client's own browser assembled is content we would then have to
 * check again anyway. The client posts a string and gets back sections.
 *
 * A SERVER ACTION IS A PUBLIC ENDPOINT. The screen that calls this is only
 * reachable by somebody signed in with a site open, and that is a courtesy to
 * whoever is looking at it rather than a control. requireTenantId is the
 * control, and it is here for the same reason every other action has it: nothing
 * about the shape of the form constrains the request.
 *
 * NOTHING IS SAVED HERE. This turns a paste into candidate sections and hands
 * them back for somebody to look at and choose from. They are written by the
 * ordinary page save, through the ordinary sanitiser, exactly as if they had
 * been built by hand. That means there is no second write path into a page, and
 * no way for an import to reach the database without passing sanitisePage.
 */

import { requireTenantId } from '../../lib/auth/session';
import { createBlock, createSection } from '../../lib/content/factory';
import { splitImport, type ImportCandidate } from '../../lib/import/sections';
import { rebuildSection } from '../../lib/import/rebuild';
import type { Section } from '../../lib/content/schema';

/**
 * The most we will read in one go.
 *
 * A Relume page export runs to a few hundred kilobytes of markup and a Tailwind
 * build to a few hundred more. Generous enough for a whole page, small enough
 * that a paste cannot be used to make the server do arbitrary work.
 */
const MAX_HTML = 800_000;
const MAX_CSS = 500_000;

export interface ImportPreview {
  /** One entry per candidate section, in the order the design had them. */
  sections: {
    label: string;
    /** A whole section, ready to be added to a page as it stands. */
    section: Section;
    /** How many words and pictures this one turned out to have. */
    slots: number;
  }[];
  /** What the cleaner took out, in plain words. */
  removed: string[];
}

export type ImportActionResult =
  | { ok: true; data: ImportPreview }
  | { ok: false; error: string };

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

/**
 * One candidate, as a section holding a single imported block.
 *
 * A SECTION RATHER THAN A BARE BLOCK, because that is the unit the outline, the
 * reordering and the background controls all work in. An imported design gets
 * the same section furniture everything else has: it can take a background, sit
 * between two native sections and be moved above either of them.
 */
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

  /*
   * FULL WIDTH AND NO PADDING OF OURS. An imported design brings its own
   * container and its own spacing, so putting it inside our contained wrapper
   * with our vertical rhythm on top gives a hero that is narrower than it was
   * drawn and a gap above it nobody asked for. The commonest way a faithful
   * import ends up looking wrong in a way nobody can explain.
   */
  section.width = 'full';
  section.paddingY = 0;

  return section;
}

/**
 * Read a pasted design and say what we would make of it.
 *
 * The padding is deliberately none: an imported design brings its own spacing,
 * and adding ours on top is the quickest way to make a faithful import look
 * wrong in a way nobody can explain.
 */
export async function previewImportAction(input: unknown): Promise<ImportActionResult> {
  try {
    await requireTenantId();
  } catch {
    return { ok: false, error: 'Open a site first.' };
  }

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
    /*
     * A paste that cannot be read at all. Said as one plain sentence rather than
     * an error from a parser, because the person reading it copied something out
     * of a design tool and has no way to act on "unexpected token".
     */
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

/**
 * Rebuild one imported block as native blocks.
 *
 * The recogniser produces a model, sectionFromModel turns it into a Section as
 * valid as a hand-built one, and that is what the editor swaps in. The client's
 * current edits are read from the block's own props, so words already changed
 * come across changed. Nothing is saved here: the swapped-in section is written
 * by the ordinary page save through the ordinary sanitiser, one undo away from
 * the frozen import it replaced.
 *
 * A design with nothing to rebuild is a plain refusal, not an empty section: the
 * caller keeps the import exactly as it was.
 */
export async function rebuildImportAction(input: unknown): Promise<RebuildActionResult> {
  try {
    await requireTenantId();
  } catch {
    return { ok: false, error: 'Open a site first.' };
  }

  const props = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};

  try {
    return rebuildSection(props);
  } catch {
    return { ok: false, error: 'We could not rebuild this design as blocks.' };
  }
}
