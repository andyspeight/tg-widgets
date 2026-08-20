/**
 * The Light / dark switch's wiring, and the flash guard.
 *
 * THE FIRST SCRIPT ON A PUBLISHED PAGE, and the pattern the rest now follow. It
 * is emitted only on a page that carries a switch: the caller checks
 * hasThemeToggle first and passes `active`, so a site without one renders
 * exactly the bytes it did before, which is none.
 *
 * It was the ONLY script for a while, and that line used to sit here. It is not
 * true any more. SlideshowScript and WidgetScripts emit the same way, and the
 * motion layer will too. What survived is the shape rather than the count, and
 * it is now clause 1 of the rule in lib/content/blocks.ts: a page that asks for
 * nothing ships nothing. The automatic half of light and dark is pure CSS, so
 * this file only ever adds the manual press.
 *
 * TWO SCRIPTS, AND WHY THE ORDER MATTERS
 *
 *   The inline one runs BEFORE the page paints and does one thing: if the visitor
 *   has picked a theme by hand before, put it back. Without it, a manual choice
 *   that differs from the system setting would show the system's answer for a
 *   frame on every reload, then snap. It has to be inline and early to beat the
 *   paint; a deferred file cannot. The automatic half needs none of this, because
 *   it is pure CSS (see globals.css) and is already right in the first paint.
 *
 *   The deferred file wires the button. Progressive enhancement: blocked or slow,
 *   the automatic half still works and only the manual press is missing.
 *
 * The inline script is tiny, fixed text with nothing from the page in it, and is
 * the one place a future Content Security Policy will need a hash. Noted here so
 * it is found when that lands, alongside the note in next.config.ts.
 */

import type { ReactElement } from 'react';

/*
 * Put back a saved manual choice before the first paint. Only 'dark' and 'light'
 * are honoured; anything else (including the absence of a value, which is the
 * automatic default) is left for the CSS to decide from the system setting.
 */
const BOOT =
  "(function(){try{var t=localStorage.getItem('tgs-theme');" +
  "if(t==='dark'||t==='light'){document.documentElement.setAttribute('data-theme',t);}" +
  '}catch(e){}})();';

export function ThemeToggleScript({ active }: { active: boolean }): ReactElement | null {
  if (!active) return null;
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: BOOT }} />
      <script src="/theme-toggle.js" defer />
    </>
  );
}
