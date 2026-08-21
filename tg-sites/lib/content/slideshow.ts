/**
 * Does a tree hold a slideshow?
 *
 * The logic lives here, not in the component, for the same reason widgetTagsIn
 * does: it is a plain walk over a page shape, testable without a DOM or a JSX
 * transform, and the SlideshowScript component only maps its answer to a tag.
 *
 * WHAT COUNTS. Two blocks turn into a slideshow, and each does so only when it
 * has more than one thing to show:
 *
 *   - `image`, when its extra `slides` hold at least one real address. A block
 *     whose only extra slides are blank stays a single picture.
 *   - `half-overlay`, when its `items` hold more than one slide with anything in
 *     them. One slide is a static panel, and the renderer draws it without the
 *     slideshow wrapper at all.
 *   - `screen-carousel`, when more than one of its pictures has a real address.
 *     One picture is a still screen, drawn without the wrapper for the same
 *     reason.
 *
 * The rules match the renderers' exactly, which is the point: a page that gets
 * the script tag without a slideshow on it is a wasted request, and a page with
 * a slideshow and no tag silently loses its arrows, dots and PAUSE BUTTON. That
 * last one is not cosmetic — auto-moving content needs a way to stop it
 * (WCAG 2.2.2), and hover-to-pause is not reachable from a keyboard.
 */

import type { widgetTagsIn } from './widgets';

/** Anything with sections: a Page, a header, a footer. */
export type Tree = Parameters<typeof widgetTagsIn>[0];

/** A block-shaped thing, as it arrives from stored JSON. */
type LooseBlock = { type?: unknown; props?: Record<string, unknown> };

function isRealSrc(value: unknown): boolean {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * An image block that has grown into a slideshow.
 *
 * A SLIDE CAN BE A FILM INSTEAD OF A PICTURE since 21 Aug 2026, so a slide with
 * a `video` and no `src` counts. Testing `src` alone was the rule for a month
 * and would now quietly leave a picture-and-film slideshow without its arrows,
 * dots and pause button.
 */
function imageIsSlideshow(props: Record<string, unknown> | undefined): boolean {
  const slides = props?.slides;
  if (!Array.isArray(slides)) return false;
  return slides.some((raw) => {
    if (!raw) return false;
    const slide = raw as { src?: unknown; video?: unknown };
    return isRealSrc(slide.src) || isRealSrc(slide.video);
  });
}

/**
 * A half-overlay block that has grown into a slider.
 *
 * The count has to match HalfOverlayBlock's own filter, which drops a slide with
 * nothing in it so an empty row left in the repeater is not a blank panel the
 * visitor waits through. Counting raw rows here would ask for the script on a
 * block that renders one static panel.
 */
function halfOverlayIsSlideshow(props: Record<string, unknown> | undefined): boolean {
  const items = props?.items;
  if (!Array.isArray(items)) return false;

  let real = 0;
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const said =
      isRealSrc(item.title) || isRealSrc(item.body) || isRealSrc(item.src) || isRealSrc(item.panelSrc);
    if (said) real += 1;
    if (real > 1) return true;
  }
  return false;
}

/**
 * A screen carousel that has grown into one.
 *
 * Counts pictures with a real address, matching ScreenCarouselBlock's own
 * filter: a repeater row whose picture was never chosen is not a slide, and
 * asking for the script on account of two blank rows would be a wasted request.
 */
function screenIsSlideshow(props: Record<string, unknown> | undefined): boolean {
  const items = props?.items;
  if (!Array.isArray(items)) return false;

  let real = 0;
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue;
    if (isRealSrc((raw as Record<string, unknown>).src)) real += 1;
    if (real > 1) return true;
  }
  return false;
}

/**
 * Every block in a list, including the ones inside a container's or a grid's own
 * columns.
 *
 * THE RECURSION IS A FIX, NOT A FLOURISH. This walk read only the outer columns
 * until 20 Aug 2026, so a slideshow dropped inside a Container or an Advanced
 * Grid rendered, moved, and quietly had no arrows, no dots and no pause button,
 * because the page never asked for the script. Nothing announced it: the
 * slideshow works without the script by design, so the failure looked like a
 * styling choice. Reading props.columns directly rather than importing the block
 * registry keeps this module a leaf, which is what lets the published route call
 * it cheaply.
 */
function blocksInColumn(blocks: unknown): LooseBlock[] {
  if (!Array.isArray(blocks)) return [];

  const out: LooseBlock[] = [];
  for (const raw of blocks) {
    if (!raw || typeof raw !== 'object') continue;
    const block = raw as LooseBlock;
    out.push(block);

    const inner = block.props?.columns;
    if (!Array.isArray(inner)) continue;
    for (const column of inner) {
      out.push(...blocksInColumn((column as { blocks?: unknown })?.blocks));
    }
  }
  return out;
}

export function hasSlideshow(tree: Tree | null | undefined): boolean {
  if (!tree) return false;

  for (const section of tree.sections) {
    for (const row of section.rows) {
      for (const column of row.columns) {
        for (const block of blocksInColumn(column.blocks)) {
          if (block.type === 'image' && imageIsSlideshow(block.props)) return true;
          if (block.type === 'half-overlay' && halfOverlayIsSlideshow(block.props)) return true;
          if (block.type === 'screen-carousel' && screenIsSlideshow(block.props)) return true;
        }
      }
    }
  }
  return false;
}
