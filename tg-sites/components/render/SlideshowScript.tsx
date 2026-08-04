/**
 * The one script tag a page with a slideshow needs.
 *
 * An image block with more than one picture auto-plays in pure CSS on its own
 * (see the ImageBlock renderer and the slideshow rules in globals.css), so a
 * page is a working, moving slideshow with no script at all. This adds the
 * buttons on top: /slideshow.js finds every `.tgs-slideshow` and gives it
 * clickable arrows, dots and a pause control. Progressive enhancement, so the
 * script blocked or slow changes nothing but the presence of the buttons.
 *
 * ONE TAG PER DOCUMENT, like WidgetScripts and for the same reason. The header,
 * the page and the footer are three separate trees; a slideshow can live in any
 * of them, and the script auto-inits on every match wherever it sits. So the
 * routes that assemble a whole document collect the trees, and this renders the
 * tag once if any of them holds a slideshow, rather than each tree emitting its
 * own and fetching the same file twice.
 *
 * NEVER IN THE EDITOR. The canvas re-renders on every keystroke and never runs a
 * page script, which is the whole reason the slideshow is pure CSS: it must
 * preview without this. The editor simply does not render this component.
 *
 * `defer` matches the widgets: it runs after the document is parsed, so the
 * containers exist wherever React put the tag.
 *
 * The src is a fixed same-origin path. Nothing a client typed reaches it.
 */

import type { ReactElement } from 'react';
import { hasSlideshow, type Tree } from '../../lib/content/slideshow';

export function SlideshowScript({
  trees,
}: {
  trees: ReadonlyArray<Tree | null | undefined>;
}): ReactElement | null {
  if (!trees.some(hasSlideshow)) return null;
  return <script src="/slideshow.js" defer />;
}
