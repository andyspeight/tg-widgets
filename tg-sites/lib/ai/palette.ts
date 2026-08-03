/**
 * The palette the section builder composes from.
 *
 * THE ONE IDEA THIS WHOLE FEATURE RESTS ON. The AI builder does NOT write HTML.
 * It writes a Section in the SAME schema the editor uses, out of the SAME blocks
 * a person drags in by hand. So a built section renders through the same
 * PageRenderer, is sanitised by the same sanitiser, and the moment it lands it
 * is editable by the same toolbar, colour controls and inline typing as
 * everything else. "Build it, then tweak it" is not a second system: the tweak
 * is the editor the client already has. Emitting HTML would give an opaque block
 * nobody could nudge, which is the opposite of what was asked for.
 *
 * For the model to compose only from real blocks, it has to be told what the
 * blocks ARE: their purpose and their exact fields. That description is this
 * file, and it is GENERATED FROM THE REGISTRY rather than written by hand, so a
 * block added or a field renamed changes the palette in the same commit and the
 * two can never drift. A hand-kept copy would be a lie waiting to happen.
 *
 * WHAT IS LEFT OUT, and why it is a blocklist not an allowlist. Almost every
 * block can be composed from a sentence. The few that cannot are the ones whose
 * content is not words: an imported design needs pasted markup, an embed needs
 * pasted code, a widget needs an id from the widget suite, a cards block reading
 * a collection needs a collection that exists. Offering those to a model with
 * only a description to go on invites a confident, broken guess, so they are
 * withheld here and stay a human choice.
 */

import { BLOCKS, type Field } from '../content/blocks';

/** A block the builder is allowed to use, flattened for a prompt. */
export interface PaletteEntry {
  type: string;
  label: string;
  group: string;
  purpose: string;
  fields: PaletteField[];
}

export interface PaletteField {
  key: string;
  /** A short, model-facing description of what the value may be. */
  accepts: string;
  /** Present for a repeater: the fields of one item in the list. */
  item?: PaletteField[];
}

/**
 * The blocks a description cannot fill on its own. See the header: their content
 * is markup, code, a widget id or a collection, none of which a model can invent
 * safely from words, so they stay a human choice rather than a confident guess.
 */
export const BUILDER_EXCLUDES: ReadonlySet<string> = new Set([
  'imported',
  'embed',
  'embed-widget',
  'widget',
]);

/** One field, described for the model in a few words rather than as a type. */
function describeField(field: Field): PaletteField {
  const base = { key: field.key };
  switch (field.kind) {
    case 'text':
      return { ...base, accepts: `short plain text${'max' in field && field.max ? `, up to ${field.max} characters` : ''}` };
    case 'textarea':
      return { ...base, accepts: `plain text, a few sentences${field.max ? `, up to ${field.max} characters` : ''}. Blank lines start new paragraphs` };
    case 'richtext':
      return { ...base, accepts: 'a short run of HTML: p, strong, em, a, ul/ol/li only. No headings, no styles' };
    case 'url':
      return { ...base, accepts: 'a link: a path like /contact or a full https:// address' };
    case 'image':
      return { ...base, accepts: 'leave empty; the client chooses the picture' };
    case 'icon':
      return { ...base, accepts: 'an icon name such as map, plane, phone, star, check, heart, sparkles' };
    case 'colour':
      return { ...base, accepts: 'leave empty to follow the theme, or a hex like #1d4ed8' };
    case 'select':
      return { ...base, accepts: `one of: ${field.options.map((option) => option.value).join(', ')}` };
    case 'toggle':
      return { ...base, accepts: 'true or false' };
    case 'number':
      return { ...base, accepts: `a number${field.min != null ? ` from ${field.min}` : ''}${field.max != null ? ` to ${field.max}` : ''}` };
    case 'repeater':
      return { ...base, accepts: `a list${field.max ? ` of up to ${field.max}` : ''} of "${field.itemLabel}" items`, item: field.fields.map(describeField) };
    default:
      // imported and any future kind the builder should not be filling in.
      return { ...base, accepts: 'leave empty' };
  }
}

/** The blocks the builder may use, in registry order, excludes removed. */
export function blockPalette(): PaletteEntry[] {
  return BLOCKS.filter((block) => !BUILDER_EXCLUDES.has(block.type)).map((block) => ({
    type: block.type,
    label: block.label,
    group: block.group,
    purpose: block.description,
    fields: block.fields.map(describeField),
  }));
}

/**
 * The palette as compact text for the system prompt.
 *
 * Deliberately terse. Every token here is paid for on every build, and a model
 * reads a tight list of "type — purpose — fields" better than a page of prose.
 * One block per line, its fields indented, nested repeater fields indented
 * again, so the shape on the page mirrors the shape of the JSON it is asking for.
 */
export function paletteText(entries: PaletteEntry[] = blockPalette()): string {
  const lines: string[] = [];
  for (const entry of entries) {
    lines.push(`- ${entry.type} (${entry.label}): ${entry.purpose}`);
    for (const field of entry.fields) {
      lines.push(`    ${field.key}: ${field.accepts}`);
      for (const sub of field.item ?? []) {
        lines.push(`        ${sub.key}: ${sub.accepts}`);
      }
    }
  }
  return lines.join('\n');
}
