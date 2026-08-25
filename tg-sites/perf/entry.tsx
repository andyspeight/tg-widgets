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
import type { ImageSizes } from '../lib/content/image-sizes';
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
  /*
   * EVERY PICTURE GETS ITS OWN ADDRESS, and that detail is load-bearing.
   *
   * The first version of this pointed every img at one local file. The browser
   * deduplicates by URL, so a four-picture homepage fetched one image and
   * measured like a one-picture page. Every number it produced was flattering
   * and none of them were wrong in a way that showed. Distinct query strings
   * make the browser treat them as four resources while the server still hands
   * back the same bytes, so the weight is right without needing four real
   * photographs the repo does not have.
   */
  /*
   * DISCOVERED FROM THE RENDERED OUTPUT, not from the tree, and that difference
   * is the whole reason this is not a one-liner.
   *
   * An imported design keeps its pictures as editable SLOTS: props.html holds
   * `src="{{tg:i1}}"` and the real address lives in props.content, substituted by
   * applyImportContent at render time. So walking the tree finds tokens, not
   * pictures. Keying the size map on those tokens produced a page whose imgs
   * carried a srcset for a DIFFERENT image, which looked like a working
   * optimisation and measured like one.
   *
   * So: render once to find out what the addresses really are, build the map
   * from those, render again. Two renders is free here, because this is a build
   * step rather than a request.
   */
  const discover = renderToStaticMarkup(
    <PageRenderer page={page} theme={tokens} prepared={prepareSections(page.sections)} />,
  );
  const urls =
    profile === 'photo-single'
      ? []
      : [...new Set([...discover.matchAll(/\ssrc="([^"]{1,2048})"/g)].map((m) => m[1]))]
          .map((u) => u.replace(/&amp;/g, '&'))
          .filter((u) => /^https?:/.test(u));
  const sizes: ImageSizes = {};
  urls.forEach((url, i) => {
    sizes[url] = [
      { url: `/img/hero-400.jpg?i=${i}`, width: 400, height: 225, bytes: 0 },
      { url: `/img/hero-800.jpg?i=${i}`, width: 800, height: 450, bytes: 0 },
      { url: `/img/hero-1600.jpg?i=${i}`, width: 1600, height: 900, bytes: 0 },
      { url: `/img/hero.jpg?i=${i}`, width: 2400, height: 1350, bytes: 0 },
    ];
  });

  /*
   * Sizes first, because the import cleaner needs them: an imported design keeps
   * its pictures inside frozen markup, and the one pass that rebuilds that
   * markup is the only place a srcset can be added to it without parsing the
   * whole document twice on every page view.
   */
  /*
   * heroFirst, because the PUBLISHED ROUTE passes it and a harness that renders
   * differently from the site is the thing this harness has been caught doing
   * three times already. Without it every picture came out lazy, the hero
   * included, which measured well for the wrong reason: it saved the bytes of
   * the images below the fold while delaying discovery of the one being waited
   * on.
   */
  const prepared = prepareSections(page.sections, sizes, { heroFirst: true });

  const body = renderToStaticMarkup(
    <PageRenderer page={page} theme={tokens} prepared={prepared} sizes={sizes} />,
  );

  /*
   * Localised HERE rather than in the build tool, because this is where the url
   * list lives and both the src and the srcset have to agree on which picture is
   * which. A picture the walk did not find keeps its own address and simply
   * fails to load, which is the honest outcome: it says the discovery missed one.
   */
  const localised = urls.reduce((html, url, i) => {
    /*
     * Both spellings. The cleaner escapes an attribute on the way out, so a url
     * carrying a query string appears in the markup with &amp; where the props
     * hold &. Matching only the raw form replaced one image out of four and left
     * the rest pointing at a host this sandbox cannot reach, which showed up as
     * an oddly cheap page rather than as an error.
     */
    const escaped = url.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    return html
      .split(`src="${url}"`)
      .join(`src="/img/hero.jpg?i=${i}"`)
      .split(`src="${escaped}"`)
      .join(`src="/img/hero.jpg?i=${i}"`);
  }, body);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${profile} profile</title>
<link rel="stylesheet" href="/globals.css">
</head>
<body>
${localised}
</body>
</html>`;
}
