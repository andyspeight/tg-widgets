/**
 * Sanitising a whole page tree, on the way into the database.
 *
 * The renderer already sanitises on the way out. This is the other half:
 * stored content should not contain a payload in the first place, so that a
 * future renderer, an export, an API consumer or a migration script cannot
 * be the thing that trusts it. Belt and braces on purpose, and the cheaper
 * of the two to get wrong.
 *
 * Driven by the block definitions rather than a hardcoded list of props, so
 * a new block with a rich text field is covered the day it is added instead
 * of the day someone remembers this file exists.
 */

import { blockDefinition, type Field } from './blocks';
import { safeUrl, sanitiseHtml, type SanitiseMode } from './sanitise';
import type { Block, Page, Section } from './schema';

/**
 * The embed block stores raw HTML in a plain textarea, and the renderer
 * sanitises it in 'embed' mode rather than 'richtext'. Kept as a map so the
 * two modes stay visibly deliberate rather than looking like an oversight.
 */
const EMBED_MODE_PROPS: Record<string, readonly string[]> = {
  embed: ['html'],
};

/**
 * Which sanitise mode a block's RICH TEXT uses, when it is not the default.
 *
 * A heading is an h2, h3 or h4, and the paragraph's allowlist contains p, ul and
 * blockquote, none of which may legally live inside one. A browser does not
 * refuse invalid nesting, it hoists the block element out of the heading, so the
 * back half of a heading silently falls out of it. Same shape as the map above,
 * and kept as a map for the same reason: the two modes stay visibly deliberate
 * rather than looking like an oversight.
 */
const RICHTEXT_MODE: Record<string, SanitiseMode> = {
  heading: 'heading',
};

function cleanValue(
  blockType: string,
  field: Field,
  value: unknown,
): unknown {
  switch (field.kind) {
    case 'richtext':
      return sanitiseHtml(value, RICHTEXT_MODE[blockType] ?? 'richtext');

    case 'url':
      // An empty string rather than null: the field is optional and the
      // renderer already treats empty as "no link". Null would be a new
      // shape for every consumer to handle.
      return typeof value === 'string' && value ? (safeUrl(value, { allowMailto: true }) ?? '') : value;

    case 'image':
      return typeof value === 'string' && value ? (safeUrl(value) ?? '') : value;

    case 'textarea':
      return EMBED_MODE_PROPS[blockType]?.includes(field.key)
        ? sanitiseHtml(value, 'embed')
        : value;

    case 'repeater': {
      if (!Array.isArray(value)) return value;
      return value.map((item) => {
        if (!item || typeof item !== 'object') return item;
        return cleanProps(blockType, field.fields, item as Record<string, unknown>);
      });
    }

    default:
      // text, select, toggle and number render as text through React, which
      // escapes them. Nothing to do.
      return value;
  }
}

function cleanProps(
  blockType: string,
  fields: readonly Field[],
  props: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...props };
  for (const field of fields) {
    if (!(field.key in out)) continue;
    out[field.key] = cleanValue(blockType, field, out[field.key]);
  }
  return out;
}

export function sanitiseBlock(block: Block): Block {
  const definition = blockDefinition(block.type);

  // An unrecognised block is left exactly as it is. A page saved by a newer
  // build must survive an older one, and the renderer refuses to draw an
  // unknown block anyway. It is still sanitised on render once its build
  // knows what it is.
  if (!definition) return block;

  return { ...block, props: cleanProps(block.type, definition.fields, block.props) };
}

function sanitiseSection(section: Section): Section {
  return {
    ...section,
    backgroundImage: section.backgroundImage
      ? (safeUrl(section.backgroundImage) ?? '')
      : section.backgroundImage,
    rows: section.rows.map((row) => ({
      ...row,
      columns: row.columns.map((column) => ({
        ...column,
        blocks: column.blocks.map(sanitiseBlock),
      })),
    })),
  };
}

/** Every URL and every scrap of HTML in a page, run through the allowlist. */
export function sanitisePage(page: Page): Page {
  return {
    ...page,
    seo: {
      ...page.seo,
      ogImage: page.seo.ogImage ? (safeUrl(page.seo.ogImage) ?? '') : page.seo.ogImage,
      canonical: page.seo.canonical ? (safeUrl(page.seo.canonical) ?? '') : page.seo.canonical,
    },
    sections: page.sections.map(sanitiseSection),
  };
}
