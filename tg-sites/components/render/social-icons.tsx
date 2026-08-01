/**
 * The little pictures on a Social links block.
 *
 * ONE ENTRY PER NETWORK IN lib/content/social.ts, and tests/social.test.ts
 * checks the two lists against each other. A network in the list with no
 * drawing here would render an empty box, which is worse than not offering it.
 *
 * WHY THESE ARE DRAWN FROM PRIMITIVES rather than pasted in as one long path
 * each. A brand mark from an icon set is a 400-character string of coordinates:
 * unreadable, unreviewable, and impossible to tell "correct" from "one digit
 * out" without rendering it. Built from circles, rectangles and short strokes,
 * each one is a few lines somebody can read, and a mistake looks like a mistake
 * rather than like a slightly different curve. They are simplified marks that
 * read as the network at 20 pixels, which is the only size they are ever drawn
 * at, and they were checked in a browser rather than assumed.
 *
 * currentColor throughout, never a brand colour. A row of these sits in a footer
 * that might be light, dark or the client's accent, and eleven fixed brand
 * colours would look like a sticker sheet in all three. They take the colour of
 * the text around them, which is what every well-made footer does.
 *
 * NO TITLE ELEMENT AND aria-hidden ON ALL OF THEM. The accessible name belongs
 * to the LINK, which carries it as an aria-label, so a title here would make a
 * screen reader read the network name twice.
 */

import type { ReactElement } from 'react';

/** Shared by every icon: the box, the colour, and the fact it is decorative. */
function Glyph({ children }: { children: React.ReactNode }): ReactElement {
  return (
    <svg
      className="tgs-social__icon"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

const ICONS: Readonly<Record<string, ReactElement>> = {
  /* The f, as one filled path. The only one that really is a letter shape. */
  facebook: (
    <Glyph>
      <path
        d="M13.4 21v-8h2.7l.4-3.1h-3.1V7.9c0-.9.25-1.45 1.55-1.45h1.65V3.7c-.3-.04-1.3-.13-2.45-.13-2.4 0-4.05 1.47-4.05 4.17v2.16H7.4V13h2.7v8z"
        fill="currentColor"
        stroke="none"
      />
    </Glyph>
  ),

  /* A rounded square, the lens, and the little dot at the top right. */
  instagram: (
    <Glyph>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.2" cy="6.8" r="1.1" fill="currentColor" stroke="none" />
    </Glyph>
  ),

  /* Two crossing strokes. The mark is an X and nothing else. */
  x: (
    <Glyph>
      <path d="M4.5 4.5 19.5 19.5" strokeWidth="2.4" />
      <path d="M19.5 4.5 4.5 19.5" strokeWidth="2.4" />
    </Glyph>
  ),

  /* The square, the i with its dot, and the n. */
  linkedin: (
    <Glyph>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <circle cx="7.6" cy="7.9" r="1.15" fill="currentColor" stroke="none" />
      <path d="M7.6 11v6.5" />
      <path d="M11.6 17.5V11" />
      <path d="M11.6 13.6a2.4 2.4 0 0 1 4.8 0v3.9" />
    </Glyph>
  ),

  /* The rounded screen with the play triangle in it. */
  youtube: (
    <Glyph>
      <rect x="2" y="5.5" width="20" height="13" rx="4" />
      <path d="M10.4 9.3 15.8 12l-5.4 2.7z" fill="currentColor" stroke="none" />
    </Glyph>
  ),

  /* The note: a stem with a hook at the top and a round head at the bottom. */
  tiktok: (
    <Glyph>
      <path d="M14.4 3v10.9a3.4 3.4 0 1 1-2.9-3.36" />
      <path d="M14.4 3a5.3 5.3 0 0 0 5.1 4.9" />
    </Glyph>
  ),

  /*
   * The circle with a P in it.
   *
   * A clean capital P rather than the script one the real mark uses. The first
   * attempt traced the script p as two curves and rendered as a spiral, which
   * looks like an at sign and not like anything. A plain letter is honest at
   * 20 pixels and reads immediately.
   */
  pinterest: (
    <Glyph>
      <circle cx="12" cy="12" r="9.2" />
      <path d="M10 18V6.9h3.1a3.3 3.3 0 0 1 0 6.6H10" strokeWidth="1.9" />
    </Glyph>
  ),

  /* The speech bubble with its tail, and a handset inside. */
  whatsapp: (
    <Glyph>
      <path d="M12 3a9 9 0 0 0-7.7 13.7L3 21.3l4.7-1.3A9 9 0 1 0 12 3z" />
      <path
        d="M9.6 8.4c.15-.35.3-.35.5-.35h.4c.15 0 .35 0 .5.4l.6 1.4c.1.2 0 .35-.1.5l-.35.4c-.1.15-.2.3-.05.5a5.6 5.6 0 0 0 2.5 2.2c.25.1.4 0 .5-.1l.4-.5c.15-.15.3-.15.45-.1l1.35.65c.15.1.3.15.3.3v.4c0 .7-.5 1.35-1.15 1.45-1.45.15-3.4-.85-4.85-2.3s-2.45-3.4-2.3-4.85c.1-.65.55-1.15 1.1-1.15z"
        fill="currentColor"
        stroke="none"
      />
    </Glyph>
  ),

  /*
   * The owl: a head with two eyes in it and a beak on top.
   *
   * The head outline is what makes it an owl. Without it the two eyes read as
   * binoculars, which is what the first version looked like, and the beak was
   * a nub lost against the tops of the circles.
   */
  tripadvisor: (
    <Glyph>
      <rect x="1.6" y="8.4" width="20.8" height="11.2" rx="5.6" />
      <circle cx="7.2" cy="14" r="2.9" />
      <circle cx="16.8" cy="14" r="2.9" />
      <circle cx="7.2" cy="14" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="16.8" cy="14" r="1.1" fill="currentColor" stroke="none" />
      <path d="M10.1 8.6 12 5.6l1.9 3" />
    </Glyph>
  ),

  /* An envelope, for the address that usually ends one of these rows. */
  email: (
    <Glyph>
      <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
      <path d="M3.4 7.2 12 13.2l8.6-6" />
    </Glyph>
  ),

  /* And a handset, for the number beside it. */
  phone: (
    <Glyph>
      <path
        d="M6.6 3h2.9l1.5 3.8-2 1.3a12.4 12.4 0 0 0 5.4 5.4l1.3-2 3.8 1.5v2.9c0 .85-.7 1.55-1.55 1.5A16.9 16.9 0 0 1 5.1 4.55C5.05 3.7 5.75 3 6.6 3z"
        fill="currentColor"
        stroke="none"
      />
    </Glyph>
  ),
};

/**
 * The picture for a network, or null.
 *
 * NULL RATHER THAN A FALLBACK GLYPH. A network with no drawing is a mistake in
 * this file, and a generic circle in its place would hide it: the block draws
 * the network's name as text instead, which still works and is visibly wrong to
 * whoever added it.
 */
export function SocialIcon({ network }: { network: string }): ReactElement | null {
  return ICONS[network] ?? null;
}

/** Every network this file can draw. Read by tests/social.test.ts. */
export const DRAWN_NETWORKS: readonly string[] = Object.keys(ICONS);
