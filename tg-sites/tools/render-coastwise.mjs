/**
 * Renders every Coastwise page the way the published site route does — header
 * region, page, footer region, real theme tokens — into standalone HTML files
 * for browser verification. Verification pages only; the seed JSON from
 * build-coastwise.mjs is what the database gets.
 */
import { build } from 'esbuild';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const entry = join(mkdtempSync(join(tmpdir(), 'cwr-')), 'entry.cjs');

await build({
  stdin: {
    contents: `
      import { renderToStaticMarkup } from 'react-dom/server';
      import { createElement as h } from 'react';
      import { PageRenderer } from ${JSON.stringify(join(here, '../components/render/PageRenderer.tsx'))};
      import { RegionRenderer } from ${JSON.stringify(join(here, '../components/render/RegionRenderer.tsx'))};
      import { themeTokens } from ${JSON.stringify(join(here, '../lib/theme/tokens.ts'))};
      import { parseTheme } from ${JSON.stringify(join(here, '../lib/theme/schema.ts'))};
      import { parsePage } from ${JSON.stringify(join(here, '../lib/content/schema.ts'))};
      import { fillNavRegion } from ${JSON.stringify(join(here, '../lib/content/nav.ts'))};
      export { renderToStaticMarkup, h, PageRenderer, RegionRenderer, themeTokens, parseTheme, parsePage, fillNavRegion };
    `,
    resolveDir: here,
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: entry,
  logLevel: 'silent',
  jsx: 'automatic',
  loader: { '.css': 'empty' },
})
const { renderToStaticMarkup, h, PageRenderer, RegionRenderer, themeTokens, parseTheme, parsePage, fillNavRegion } =
  await import(pathToFileURL(entry).href);

// The Coastwise theme, exactly as it will be stored on the tenant row.
export const COASTWISE_THEME = {
  brand: '#1b333d',
  accent: '#c8452c',
  pageBackground: '#f2efe9',
  text: '#14181c',
  corners: 'soft',
  typography: {
    h1: { family: 'archivo', size: 56, weight: 700, tracking: -2, lineHeight: 1.05 },
    h2: { family: 'archivo', size: 38, weight: 650, tracking: -2, lineHeight: 1.1 },
    h3: { family: 'archivo', size: 28, weight: 600, tracking: -1, lineHeight: 1.2 },
    h4: { family: 'archivo', size: 22, weight: 600, tracking: -1, lineHeight: 1.25 },
    h5: { family: 'archivo', size: 18, weight: 600, tracking: 0, lineHeight: 1.3 },
    h6: { family: 'archivo', size: 16, weight: 600, tracking: 0, lineHeight: 1.35 },
    p: { family: 'archivo', size: 17, weight: 400, tracking: 0, lineHeight: 1.6 },
  },
};

const theme = parseTheme(COASTWISE_THEME);
// The library is empty locally (fonts arrive at seed time); Archivo falls back
// to the sans stack in the preview, which is fine for layout checks.
const tokens = themeTokens(theme, []).style;

const css = readFileSync(join(here, '../app/globals.css'), 'utf8');
const outDir = join(here, 'coastwise-preview');
mkdirSync(outDir, { recursive: true });

const seedDir = join(here, 'coastwise-seed');
const { readdirSync } = await import('node:fs');
const headerJson = JSON.parse(readFileSync(join(seedDir, 'region-header.json'), 'utf8'));
const footer = JSON.parse(readFileSync(join(seedDir, 'region-footer.json'), 'utf8'));

/*
 * Fill the menu's folder dropdowns the way the live routes do, so the preview
 * exercises the dropdown markup and its colours rather than a flat menu. The
 * nav pages are reconstructed from the seed files plus the FOLDERS map, which
 * is exactly the parent shape the edge function seeds into the database.
 */
const { FOLDERS } = await import(pathToFileURL(join(here, 'coastwise-seed/.folders.mjs')).href)
  .catch(() => ({ FOLDERS: { destinations: [], holidays: [] } }));
const seedPages = readdirSync(seedDir)
  .filter((f) => f.startsWith('page-'))
  .map((f) => JSON.parse(readFileSync(join(seedDir, f), 'utf8')));
const parentOf = new Map();
for (const [folder, slugs] of Object.entries(FOLDERS)) {
  const folderPage = seedPages.find((p) => p.slug === folder);
  if (folderPage) for (const slug of slugs) parentOf.set(slug, folderPage.id);
}
const navPages = seedPages.map((p) => ({
  id: p.id,
  title: p.title,
  slug: p.slug,
  parentId: parentOf.get(p.slug) ?? null,
  published: true,
}));
const header = fillNavRegion({ sections: headerJson.sections }, navPages);

for (const file of readdirSync(seedDir).filter((f) => f.startsWith('page-'))) {
  const pageJson = JSON.parse(readFileSync(join(seedDir, file), 'utf8'));
  const parsed = parsePage(pageJson);
  if (!parsed.ok) { console.error('parse fail', file); process.exit(1); }

  const body = renderToStaticMarkup(
    h('div', { className: 'tgs-page', style: tokens },
      h(RegionRenderer, { region: { region: 'header', sections: header.sections } }),
      h(PageRenderer, { page: parsed.page }),
      h(RegionRenderer, { region: { region: 'footer', sections: footer.sections } }),
    ),
  );
  const html = `<!doctype html><html lang="en-GB"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${pageJson.title}</title>
<style>${css}</style></head><body style="margin:0">${body}
<script src="/slideshow.js"></script></body></html>`;
  const name = file.replace(/^page-/, '').replace(/\.json$/, '');
  writeFileSync(join(outDir, `${name}.html`), html);
  console.log('rendered', name);
}
console.log('previews in tools/coastwise-preview/');
