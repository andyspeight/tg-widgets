/**
 * The one script tag a page with a script-driven motion recipe needs.
 *
 * MOST PAGES NEVER GET THIS, and that is the point. Seven of the eight recipes built
 * so far are pure CSS, so a site whose sections drift, breathe, wipe, stack or settle
 * still ships exactly the bytes it did before, which is none. Only A3 drifting-rail
 * pulls this file, because a track that moves on its own AND is added to by scroll is
 * the one thing CSS cannot express. Clause 1 of the rule in lib/content/blocks.ts: a
 * page that asks for nothing ships nothing.
 *
 * ONE TAG PER DOCUMENT, like WidgetScripts and SlideshowScript and for the same
 * reason. The header, the page and the footer are three separate trees, the script
 * auto-inits on every match wherever it sits, so the routes that assemble a whole
 * document collect the trees and this renders the tag once rather than each tree
 * emitting its own and fetching the same file two or three times.
 *
 * NEVER IN THE EDITOR. The canvas re-renders on every keystroke and never runs a page
 * script, which is exactly why the rail is a working scroll-snap carousel in CSS: it
 * must preview without this. The editor simply does not render this component.
 *
 * `defer` matches the widgets and the slideshow: it runs after the document is
 * parsed, so the rails exist wherever React put the tag.
 *
 * The src is a fixed same-origin path. Nothing a client typed reaches it.
 */

import type { ReactElement } from 'react';

import { anyNeedsMotionScript, type Tree } from '../../lib/content/motion';

export function MotionScript({ trees }: { trees: ReadonlyArray<Tree> }): ReactElement | null {
  if (!anyNeedsMotionScript(trees)) return null;
  return <script src="/tg-motion.js" defer />;
}
