/**
 * Renders a published page to static HTML, for measuring.
 *
 * A MEASUREMENT WRAPPER, NOT A SECOND RENDERER. Every component here is the one
 * app/site/[host]/[[...path]]/page.tsx mounts, assembled the same way: the same
 * PageRenderer, the same theme tokens on the same element, the same globals.css.
 * If this file starts special-casing anything for the harness, the numbers stop
 * being about the product.
 *
 * WHAT IT DELIBERATELY LEAVES OUT, because a static file cannot have it: the
 * server. No database, no time to first byte, no cache headers. So this measures
 * everything AFTER the first byte and nothing before it. TTFB has to be measured
 * against the real deployment, which is what PageSpeed Insights is for. Reporting
 * a number from here as though it covered the server would be the "measure the
 * thing you actually ship" mistake this repo keeps re-learning.
 *
 * TWO PROFILES, because they stress different things:
 *   designed - a baked template homepage, mostly `imported` blocks carrying their
 *              own frozen CSS. What a client who picked a get-started design has.
 *   native   - the seed page, built from native blocks. What globals.css is for.
 */

import { renderToStaticMarkup } from 'react-dom/server';

import { PageRenderer } from '../components/render/PageRenderer';
import { prepareSections } from '../lib/content/prepare-markup';
import { imageUrlsIn, type ImageSizes } from '../lib/content/image-sizes';
import { designedHomeSections } from '../lib/content/designed-homes';
import { SEED_PAGE } from '../lib/content/seed';
import { CONTENT_VERSION, parsePage, type Page } from '../lib/content/schema';
import { DEFAULT_THEME, parseTheme } from '../lib/theme/schema';
import { themeTokens } from '../lib/theme/tokens';

export type Profile = 'designed' | 'native' | 'photo' | 'photo-single';

/**
 * A page whose largest paint is a photograph the client placed themselves.
 *
 * WHY THIS PROFILE HAD TO EXIST. The other two cannot measure the srcset at all,
 * and finding that out was the point of building the harness before the fix. The
 * seed page's image block carries no src, so it renders no img. The designed
 * homepages DO carry pictures, but inside `imported` blocks, which are frozen
 * markup our renderer never writes an attribute onto. So a change to ImageBlock
 * and to the section background was invisible to both.
 *
 * This is the shape the change actually serves: a full-bleed hero with a picture
 * on the section, and a photograph in a column below it, both from the bank.
 */
function photoPage(): Page {
  const hero = 'https://example.test/hero.jpg';
  const inline = 'https://example.test/inline.jpg';

  const parsed = parsePage({
    version: CONTENT_VERSION,
    id: 'perf_photo',
    title: 'Home',
    slug: '',
    sections: [
      {
        id: 'sec_hero',
        tone: 'dark',
        width: 'full',
        paddingY: 96,
        minHeight: 70,
        overlay: 40,
        backgroundImage: hero,
        rows: [
          {
            id: 'row_hero',
            columns: [
              {
                id: 'col_hero',
                width: 100,
                blocks: [
                  { id: 'b_h1', type: 'heading', props: { text: 'Slow mornings on the Amalfi Coast', level: 'h1' } },
                  { id: 'b_p1', type: 'text', props: { html: '<p>Ten nights, two harbours and a boat that waits for you.</p>' } },
                ],
              },
            ],
          },
        ],
      },
      {
        id: 'sec_body',
        tone: 'light',
        width: 'contained',
        paddingY: 64,
        minHeight: 0,
        overlay: 0,
        rows: [
          {
            id: 'row_body',
            columns: [
              {
                id: 'col_img',
                width: 50,
                blocks: [{ id: 'b_img', type: 'image', props: { src: inline, alt: 'A harbour at dusk' } }],
              },
              {
                id: 'col_txt',
                width: 50,
                blocks: [
                  { id: 'b_h2', type: 'heading', props: { text: 'What the week looks like', level: 'h2' } },
                  { id: 'b_p2', type: 'text', props: { html: '<p>Mornings are yours. Afternoons are ours.</p>' } },
                ],
              },
            ],
          },
        ],
      },
    ],
  });
  if (!parsed.ok) throw new Error(`photo page did not parse: ${parsed.errors.join('; ')}`);
  return parsed.page;
}

function pageFor(profile: Profile): Page {
  if (profile === 'photo' || profile === 'photo-single') return photoPage();
  if (profile === 'native') {
    const parsed = parsePage(SEED_PAGE);
    if (!parsed.ok) throw new Error(`seed page did not parse: ${parsed.errors.join('; ')}`);
    return parsed.page;
  }

  const parsed = parsePage({
    version: CONTENT_VERSION,
    id: 'perf_designed',
    title: 'Home',
    slug: '',
    sections: designedHomeSections('bucket-and-spade'),
  });
  if (!parsed.ok) throw new Error(`designed home did not parse: ${parsed.errors.join('; ')}`);
  return parsed.page;
}

export function renderProfile(profile: Profile): string {
  const page = pageFor(profile);
  const theme = parseTheme(DEFAULT_THEME);
  const tokens = themeTokens(theme).style as Record<string, string>;

  /*
   * No wrapper of our own. PageRenderer emits `.tgs-page` and puts the theme
   * tokens on it itself, exactly as the published route relies on, so adding a
   * second .tgs-page here would measure a document the product never serves.
   */
  /*
   * The prepared side channel, exactly as app/site/[host]/[[...path]]/page.tsx
   * builds it. Without it an `imported` block renders nothing, so the designed
   * profile would measure a blank page and report a flattering LCP for a
   * document the product never serves. That happened on the first run here.
   */
  const prepared = prepareSections(page.sections);

  /*
   * The stored sizes, stood in for.
   *
   * On the real site these come from the media row. Here every picture is given
   * the same modelled ladder, pointing at the local files the build writes, so
   * the RENDERER genuinely produces the srcset rather than the harness pasting
   * one in afterwards. That distinction is the whole point: this measures what
   * components/render emits, not what I hoped it would emit.
   */
  /*
   * photo-single is the SAME page with no stored sizes, which is the state every
   * image uploaded before variants existed is in. It is here so the harness
   * always prints the before and the after side by side: a claim about how much
   * the srcset saved is worth nothing without the control it is measured against.
   */
  const sizes: ImageSizes = {};
  for (const url of profile === 'photo-single' ? [] : imageUrlsIn(page.sections)) {
    sizes[url] = [
      { url: '/img/hero-400.jpg', width: 400, height: 225, bytes: 0 },
      { url: '/img/hero-800.jpg', width: 800, height: 450, bytes: 0 },
      { url: '/img/hero-1600.jpg', width: 1600, height: 900, bytes: 0 },
      { url: '/img/hero.jpg', width: 2400, height: 1350, bytes: 0 },
    ];
  }

  const body = renderToStaticMarkup(
    <PageRenderer page={page} theme={tokens} prepared={prepared} sizes={sizes} />,
  );

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${profile} profile</title>
<link rel="stylesheet" href="/globals.css">
</head>
<body>
${body}
</body>
</html>`;
}
