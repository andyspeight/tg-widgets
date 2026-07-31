/**
 * The widget script tags for a rendered site page.
 *
 * WHY THIS IS NOT INSIDE PageRenderer ANY MORE
 *
 * It was, until the header and footer arrived on 31 Jul 2026. A widget file
 * auto-inits on every matching container on the page and carries its own
 * double-init guard, so three Opening Hours blocks want ONE script and three
 * containers. That was easy to arrange while a page was the only thing on the
 * page. It stopped being true the moment a header could hold a widget too: the
 * header, the page and the footer are three separate trees, and three trees each
 * emitting their own scripts would fetch the same file up to three times.
 *
 * So the trees no longer decide. Whoever assembles a whole document, the public
 * site route and the preview route, collects the tags from all three and renders
 * this once. One script per distinct widget, whatever it appears in.
 *
 * NEVER IN THE EDITOR. The canvas re-renders on every keystroke and the blocks
 * draw a placeholder there instead of the real thing, so a script would be
 * loading for containers that do not exist and hammering the widget config API
 * while somebody types. The editor simply does not render this component.
 *
 * `defer` is what the embed contract specifies: it runs after the document is
 * parsed, so it does not matter whether React hoists these into the head or
 * leaves them where they are, the containers exist either way.
 *
 * Every URL is built by lib/content/widgets.ts from a closed list. Nothing a
 * client typed can reach a src here, which is the whole reason the widget block
 * can belong to them rather than to us.
 */

import type { ReactElement } from 'react';
import { widgetScriptsFor, widgetTagsIn } from '../../lib/content/widgets';

/** Anything with sections: a Page, a header, a footer. */
type Tree = Parameters<typeof widgetTagsIn>[0];

export function WidgetScripts({ trees }: { trees: ReadonlyArray<Tree | null | undefined> }): ReactElement {
  const tags = new Set<string>();
  for (const tree of trees) {
    if (!tree) continue;
    for (const tag of widgetTagsIn(tree)) tags.add(tag);
  }

  return (
    <>
      {widgetScriptsFor([...tags]).map((src) => (
        <script key={src} src={src} defer />
      ))}
    </>
  );
}
