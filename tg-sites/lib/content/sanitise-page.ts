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
import { hasInnerColumns } from './inner-columns';
import { importContent, importFields } from './imported';
import { cleanImportHtml } from '../import/html';
import { importScopeClass, scopeImportCss } from '../import/css';
import { safeUrl, sanitiseHtml, type SanitiseMode } from './sanitise';
import { sanitiseEmbedHtml } from './sanitise-embed';
import { safeIconName } from './icons';
import type { CollectionItem } from './collection';
import { safeColour } from './schema';
import type { Block, Page, Region, Section } from './schema';

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
      return typeof value === 'string' && value ? (safeUrl(value, { allowContact: true }) ?? '') : value;

    case 'image':
      return typeof value === 'string' && value ? (safeUrl(value) ?? '') : value;

    case 'textarea':
      /*
       * THE EMBEDDED WIDGET IS DELIBERATELY NOT SANITISED, and that is the whole
       * design of the block rather than an omission.
       *
       * Sanitising it would strip the script that is the only reason anybody
       * pastes an embed, exactly as the staff head and body HTML says of itself.
       * The difference is what stands in for the parser: this HTML never runs on
       * the page. It goes into a sandboxed iframe with no allow-same-origin, so
       * it executes at an opaque origin and can reach nothing outside its own
       * rectangle. Containment instead of a permission check, which is what lets
       * a client use it rather than only us.
       *
       * See components/render/blocks.tsx for the sandbox tokens, and the one
       * combination that is deliberately never offered.
       */
      if (blockType === 'embed-widget' && field.key === 'html') {
        return typeof value === 'string'
          // Control characters out, which are never intentional in a paste, and
          // a length cap. Nothing else.
          ? value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').slice(0, 20_000)
          : '';
      }
      return EMBED_MODE_PROPS[blockType]?.includes(field.key)
        ? sanitiseEmbedHtml(value)
        : value;

    case 'repeater': {
      if (!Array.isArray(value)) return value;
      return value.map((item) => {
        if (!item || typeof item !== 'object') return item;
        return cleanProps(blockType, field.fields, item as Record<string, unknown>);
      });
    }

    /*
     * AN ICON IS TRIMMED, NOT CHECKED AGAINST THE LIBRARY, and that is the
     * same arrangement the widget blocks use: make the shape safe here, do the
     * closed-list lookup at render. Two reasons it is right rather than lazy.
     *
     * The set is 558KB and the sanitiser runs on every save, so checking
     * membership here would put the whole icon library into the save path.
     * More importantly, a client saving a page on an older build that uses an
     * icon added in a NEWER one would have that icon deleted from their
     * content rather than merely not drawn today, and content loss is a far
     * worse failure than a missing picture.
     *
     * Nothing is at risk in letting an unknown value through: the value is
     * rendered either as an icon looked up in the closed list, or as text,
     * which React escapes. See lib/content/icons.ts and ContentIcon.
     */
    case 'icon':
      return safeIconName(value);

    /*
     * A COLOUR IS CHECKED HERE TOO, not only at render, so the field and the
     * store cannot disagree about what a colour is. safeColour returns a theme
     * token or a hex and nothing else; anything it refuses becomes empty, which
     * the renderer reads as "follow the section". Same belt-and-braces the
     * imported props get: the render still cleans it, this keeps the junk from
     * ever being what a future export or migration trusts.
     */
    case 'colour':
      return safeColour(value) ?? '';

    /*
     * FOUR CORNER RADII, EACH PINNED TO 0..500. The same belt-and-braces the
     * colours get: made safe here as well as at render, so a stored corner is
     * never anything but a bounded number a future export or migration could
     * trust. Shape enforced too, so a corners prop that arrived as something
     * other than an object comes back as four zeros rather than junk.
     */
    case 'corners': {
      const pin = (v: unknown): number => {
        const n = typeof v === 'number' ? v : Number(v);
        return Number.isFinite(n) ? Math.min(500, Math.max(0, Math.round(n))) : 0;
      };
      const c = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
      return { tl: pin(c.tl), tr: pin(c.tr), br: pin(c.br), bl: pin(c.bl) };
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

/**
 * An imported design, on the way into the database.
 *
 * NOT DRIVEN BY THE FIELD LIST like every other block, because the two props
 * that matter are not fields. `html` and `css` are written by the import screen
 * and never typed into, so no Field describes them, and a save path that only
 * looked at fields would store whatever arrived on the wire. A server action is
 * a public endpoint: the shape of the form is not a constraint on the request.
 *
 * The renderer cleans all of this again, so this is the belt to that pair of
 * braces. It is still the cheaper of the two to get wrong, because stored
 * content is what a future renderer, an export or a migration script would
 * trust.
 */
function cleanImportedProps(blockId: string, props: Record<string, unknown>): Record<string, unknown> {
  const fields = importFields(props);
  const stored = importContent(props);

  /*
   * ONLY SLOTS THE MARKUP ACTUALLY USES. A design edited, then re-imported
   * smaller, would otherwise carry the old slots' words around forever, and
   * they would come back the moment anybody restored a snapshot.
   */
  const used = new Set(fields.map((field) => field.key));
  const content: Record<string, string> = {};
  for (const [key, value] of Object.entries(stored)) {
    if (used.has(key)) content[key] = value;
  }

  return {
    ...props,
    html: cleanImportHtml(typeof props.html === 'string' ? props.html : '').html,
    /*
     * THE SAME SCOPE THE RENDERER WILL USE, worked out from the block's own id
     * in both places. Scoping to anything else here would make the second pass
     * nest one scope inside the other and match nothing, and scoping to nothing
     * would leave a stored stylesheet that reaches the whole page if anything
     * ever served it without asking the renderer.
     */
    css: scopeImportCss(typeof props.css === 'string' ? props.css : '', {
      scope: `.${importScopeClass(blockId)}`,
    }).css,
    fields,
    content,
    label: typeof props.label === 'string' ? props.label.slice(0, 60) : '',
  };
}

export function sanitiseBlock(block: Block): Block {
  const definition = blockDefinition(block.type);

  // An unrecognised block is left exactly as it is. A page saved by a newer
  // build must survive an older one, and the renderer refuses to draw an
  // unknown block anyway. It is still sanitised on render once its build
  // knows what it is.
  if (!definition) return block;

  if (block.type === 'imported') {
    return { ...block, props: cleanImportedProps(block.id, block.props) };
  }

  if (hasInnerColumns(block.type)) {
    return sanitiseContainer(block);
  }

  /*
   * A BREADCRUMBS BLOCK NEVER STORES ITS CRUMBS.
   *
   * They are written in at render time from the page's own address (see
   * lib/content/breadcrumbs.ts), so a stored copy would be a second description
   * of the site's shape: right on the day it was written, wrong the first time
   * anybody moved or renamed a page, and disagreeing with the BreadcrumbList
   * structured data the same page emits. Dropped here rather than trusted not to
   * arrive, because an imported page or a hand-edited JSON payload can carry any
   * key it likes.
   */
  if (block.type === 'breadcrumbs') {
    const props = cleanProps(block.type, definition.fields, block.props);
    if ('crumbs' in props) {
      const { crumbs: _derived, ...rest } = props;
      return { ...block, props: rest };
    }
    return { ...block, props };
  }

  return { ...block, props: cleanProps(block.type, definition.fields, block.props) };
}

/**
 * A container, on the way into the database.
 *
 * WHY IT NEEDS ITS OWN PATH. Every other block's content is its own props, which
 * cleanProps handles. A container's real content is the BLOCKS inside its
 * columns, and those live in props.columns where the field-driven pass never
 * looks. Without this a text block dropped into a container would carry whatever
 * markup it arrived with straight past the sanitiser, which is the exact hole
 * this whole file exists to close. So each inner block goes through sanitiseBlock
 * the same as a block in an ordinary column does.
 *
 * The inner column's own box is validated here too: it reaches the renderer as
 * CSS custom properties and, unlike a real column, never passes through the
 * schema's colour allowlist, so its two colour strings are run through safeColour
 * on the way in.
 */
function sanitiseContainer(block: Block): Block {
  // Reads the block's OWN definition rather than the container's, so a grid is
  // cleaned against a grid's fields. Both keep their content the same way: in
  // props.columns, where the field-driven pass never looks.
  const definition = blockDefinition(block.type);
  const props = definition ? cleanProps(block.type, definition.fields, block.props) : { ...block.props };
  const columns = props.columns;
  if (!Array.isArray(columns)) return { ...block, props };

  return {
    ...block,
    props: {
      ...props,
      columns: columns.map((column) => {
        if (!column || typeof column !== 'object') return column;
        const col = column as Record<string, unknown>;
        const box = col.box && typeof col.box === 'object' ? (col.box as Record<string, unknown>) : undefined;
        return {
          ...col,
          box: box
            ? { ...box, background: safeColour(box.background), borderColour: safeColour(box.borderColour) }
            : box,
          blocks: Array.isArray(col.blocks) ? col.blocks.map(sanitiseBlock) : col.blocks,
        };
      }),
    },
  };
}

function sanitiseSection(section: Section): Section {
  return {
    ...section,
    backgroundImage: section.backgroundImage
      ? (safeUrl(section.backgroundImage) ?? '')
      : section.backgroundImage,
    // The same allowlist as the picture. A background video is a URL the
    // renderer puts in a src, so it gets the same treatment and for the same
    // reason: nothing a client types may become a scheme.
    backgroundVideo: section.backgroundVideo
      ? (safeUrl(section.backgroundVideo) ?? '')
      : section.backgroundVideo,
    rows: section.rows.map((row) => ({
      ...row,
      columns: row.columns.map((column) => ({
        ...column,
        blocks: column.blocks.map(sanitiseBlock),
      })),
    })),
  };
}

/**
 * The same treatment for a header or a footer.
 *
 * A region is sections and nothing else, so this is sanitiseSection across the
 * lot with no SEO to clean. Sharing sanitiseSection rather than copying it is
 * the point: a block whose sanitising changes cannot end up correct on a page
 * and wrong in a header, which would be the worse of the two places to get it
 * wrong since a header is on every URL.
 */
export function sanitiseRegion(region: Region): Region {
  return { ...region, sections: region.sections.map(sanitiseSection) };
}

/**
 * The same treatment for a collection item.
 *
 * Its body is sections, so that half is sanitiseSection again. The two strings
 * of its own that reach the browser as attributes rather than as text, the
 * picture and nothing else, go through the same allowlist a section background
 * does. Title, summary, alt, author and the tags are rendered as text by React
 * and need nothing here; the tags were cleaned by safeTags through parseItem.
 */
export function sanitiseItem(item: CollectionItem): CollectionItem {
  return {
    ...item,
    image: item.image ? (safeUrl(item.image) ?? '') : item.image,
    sections: item.sections.map(sanitiseSection),
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
