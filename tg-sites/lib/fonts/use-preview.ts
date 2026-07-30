'use client';

/**
 * Loading preview faces in the browser, so a font list can draw itself.
 *
 * WHY A DISTINCT FAMILY NAME PER PREVIEW
 *
 * This is the one thing in here that is not obvious, and getting it wrong is a
 * bug nobody would find for weeks.
 *
 * A preview file is subset to the letters of the family's own name. If it were
 * registered under the REAL family name, then the moment somebody imported that
 * family the browser would have two faces for the same family, weight and style:
 * the real one and the subset. Faces are only composed across a family by
 * unicode-range, and a preview has none, so the browser picks exactly one of them
 * per weight. Pick the subset and every character outside the family's name
 * vanishes. The specimen sentence on the theme screen would render with holes in
 * it, intermittently, depending on load order.
 *
 * So a preview is registered as `TGP <family>` and that name is used only by the
 * picker rows. A collision is then impossible by construction rather than by
 * timing.
 *
 * WHY MODULE-LEVEL STATE
 *
 * The cache has to outlive the component. Searching "lat" then "lato" unmounts and
 * remounts rows, and switching tabs unmounts the whole panel; per-component state
 * would refetch every font every time. document.fonts is a document-level registry
 * anyway, so tracking it anywhere narrower would be a lie about where the fonts
 * actually live.
 */

import { useEffect, useState } from 'react';

/** The prefix that keeps a preview from colliding with the real thing. */
const PREVIEW_PREFIX = 'TGP ';

/** The family name to put in a font-family declaration for a preview. */
export function previewFamily(family: string): string {
  return `${PREVIEW_PREFIX}${family}`;
}

/** Where the bytes come from. Our own origin, never Google's. */
export function previewHref(family: string): string {
  return `/api/font-preview/${encodeURIComponent(family)}`;
}

type State = 'loading' | 'ready' | 'failed';

const loaded = new Map<string, State>();

/**
 * Subscribers, so one font arriving re-renders every list showing it.
 *
 * A plain module Map cannot tell React anything changed. This is the smallest
 * thing that can: a set of callbacks, bumped when a face resolves.
 */
const listeners = new Set<() => void>();

function announce() {
  for (const listener of listeners) listener();
}

async function ensure(family: string): Promise<void> {
  if (loaded.has(family)) return;
  // Marked before the await, so two rows asking at once produce one fetch.
  loaded.set(family, 'loading');

  try {
    /*
     * FontFace rather than injecting a @font-face rule.
     *
     * No <style> tag means nothing for a Content-Security-Policy to object to, and
     * the promise tells us exactly when the font is usable. A style tag would leave
     * us guessing, and guessing shows as a flash of the fallback.
     */
    const face = new FontFace(previewFamily(family), `url(${previewHref(family)})`, {
      weight: '400',
      style: 'normal',
      display: 'swap',
    });

    await face.load();
    document.fonts.add(face);
    loaded.set(family, 'ready');
  } catch {
    /*
     * Remembered as failed, not deleted.
     *
     * A family with no 400 weight, or a preview Google will not serve, would
     * otherwise be retried by every render of every search for as long as the
     * screen is open. One attempt per family per page load.
     */
    loaded.set(family, 'failed');
  }

  announce();
}

/**
 * Ask for previews of these families, and get back the ones ready to use.
 *
 * Deliberately does NOT return the loading or failed ones. A caller should only
 * ever be choosing between "the real typeface" and "the fallback stack", and a
 * third state would mean three code paths in every row that draws a name.
 */
export function useFontPreviews(families: string[]): Set<string> {
  const [, bump] = useState(0);

  useEffect(() => {
    const listener = () => bump((n) => n + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    // FontFace is not in every browser and is not in a server render. Without this
    // the whole panel would throw rather than showing names in a fallback.
    if (typeof window === 'undefined' || typeof FontFace === 'undefined') return;
    for (const family of families) void ensure(family);
    /*
     * Compare the list's CONTENT, not its identity, or this runs on every render.
     *
     * Joined on U+0000 rather than on a space, and that is not fussiness: family
     * names contain spaces, so ['Open Sans', 'Lato'] and ['Open', 'Sans Lato']
     * would produce the same key and the effect would not re-run when the list
     * genuinely changed. A character that cannot appear in a font name is the only
     * safe separator. Written as an escape because a raw control byte in source
     * survives Node and gets mangled by a bundler.
     */
  }, [families.join('\u0000')]);

  const ready = new Set<string>();
  for (const family of families) {
    if (loaded.get(family) === 'ready') ready.add(family);
  }
  return ready;
}

/**
 * The font-family value for a name in a picker row.
 *
 * One function so the fallback is identical everywhere, including in the moment
 * before the file lands. Quoted, because a family with a space in it is invalid
 * unquoted and every Google family name may contain one.
 */
export function previewStack(family: string, ready: boolean, fallback: string): string {
  return ready ? `'${previewFamily(family)}', ${fallback}` : fallback;
}
