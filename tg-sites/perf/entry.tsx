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
import { designedHomeSections } from '../lib/content/designed-homes';
import { SEED_PAGE } from '../lib/content/seed';
import { CONTENT_VERSION, parsePage, type Page } from '../lib/content/schema';
import { DEFAULT_THEME, parseTheme } from '../lib/theme/schema';
import { themeTokens } from '../lib/theme/tokens';

export type Profile = 'designed' | 'native';

function pageFor(profile: Profile): Page {
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

  const body = renderToStaticMarkup(
    <PageRenderer page={page} theme={tokens} prepared={prepared} />,
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
