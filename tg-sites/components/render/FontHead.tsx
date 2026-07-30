/**
 * The @font-face rules and preloads for a page.
 *
 * A server component with no interactivity, rendered inside the page tree. React
 * hoists <style> and <link> into the document head, so this can sit next to the
 * content it applies to rather than being threaded up through a layout.
 *
 * WHY A <style> TAG AND NOT A STYLESHEET ROUTE
 *
 * A separate /fonts.css would be tidier and is worse. It is a blocking request
 * that has to complete before the browser knows a font exists, so the preload
 * below could not fire until it came back, which is the whole benefit gone. The
 * rules are a few hundred bytes and they are needed immediately, so they travel
 * with the HTML.
 *
 * THE COST, STATED: this needs style-src to allow inline styles. There is no
 * Content-Security-Policy on the rendered site yet, so nothing is broken today,
 * and when one is added this tag needs a nonce or a hash. That is a real
 * constraint on a later piece of work, which is why it is written down here
 * rather than discovered.
 *
 * ORDER MATTERS. The preloads come first, because the browser acts on the head
 * in order and there is no reason to make it parse a stylesheet before it starts
 * fetching the file that stylesheet is about.
 */

import type { ReactElement } from 'react';

import { fontFaceCss, fontPreloads, usedFontSlugs, type LibraryFontFile } from '../../lib/theme/fonts';
import type { Typography } from '../../lib/theme/typography';

interface Props {
  /** The tenant's slug, which is the first segment of every font URL. */
  tenantSlug: string;
  files: LibraryFontFile[];
  typography: Typography;
}

export function FontHead({ tenantSlug, files, typography }: Props): ReactElement | null {
  const used = usedFontSlugs(typography);

  // Nothing custom in the theme: no rules, no preloads, no empty <style>.
  // Every style is on a system stack, which is already on the reader's device.
  if (used.size === 0) return null;

  const css = fontFaceCss(files, tenantSlug, used);
  if (!css) return null;

  const preloads = fontPreloads(files, tenantSlug, typography);

  return (
    <>
      {preloads.map((preload) => (
        <link
          key={preload.href}
          rel="preload"
          as="font"
          type={preload.type}
          href={preload.href}
          /*
           * crossorigin, even though this is same-origin.
           *
           * Fonts are fetched in CORS mode by the CSS engine whatever their
           * origin, and a preload without this attribute is treated as a
           * DIFFERENT request from the one the stylesheet makes. The file would
           * be downloaded twice and the console would warn that the preload went
           * unused, which is the single most common way a font preload is wrong.
           */
          crossOrigin="anonymous"
        />
      ))}

      {/*
        Generated entirely from database rows via fontFaceCss, which builds each
        rule from validated fields: a family name that passed
        normaliseFamilyName, a numeric weight, a format from a fixed set, and a
        URL built from a uuid. Nothing a client typed reaches this string
        unchecked, which is what makes an inline style tag acceptable here.
      */}
      <style dangerouslySetInnerHTML={{ __html: css }} />
    </>
  );
}
