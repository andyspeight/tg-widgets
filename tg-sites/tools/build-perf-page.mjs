/**
 * Builds the pages the performance harness measures.
 *
 *   node tools/build-perf-page.mjs
 *   -> perf/out/{designed,native}.html, globals.css, img/hero.jpg
 *
 * WHY A BUILD STEP RATHER THAN MEASURING THE REAL APP. The published route needs
 * a database and a deployment, and this sandbox has neither. What it does NOT
 * need is either of those to answer the questions this harness is for: how much
 * CSS a page uses out of what it downloads, when the largest paint lands, whether
 * anything shifts, and what the browser fetches in what order. Those are all
 * decided by the markup the renderer emits and the stylesheet it links, and both
 * of those are in this repo.
 *
 * THE HERO IMAGE IS SYNTHESISED, AND THAT IS A STATED MODEL, NOT A MEASUREMENT.
 * There is no real client photograph in the repo and no egress to fetch one, so
 * every remote image src is rewritten to one local file whose size we choose. A
 * real 2400px travel photograph off a phone lands around 400 to 600 KB, which is
 * the default here. The point is not to claim we measured a real photo; it is
 * that both sides of a before-and-after get the identical bytes, so the delta is
 * honest even though the absolute is a model. Change it with --hero-kb.
 */

import * as esbuild from 'esbuild';
import { mkdir, readFile, writeFile, rm, copyFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const repoRoot = resolve(root, '..');
const outDir = resolve(root, 'perf/out');

const heroKb = Number(
  (process.argv.find((a) => a.startsWith('--hero-kb=')) ?? '--hero-kb=450').split('=')[1],
);
if (!Number.isFinite(heroKb) || heroKb < 1) {
  console.error('--hero-kb must be a positive number');
  process.exit(1);
}

await mkdir(resolve(outDir, 'img'), { recursive: true });
for (const name of ['designed.html', 'native.html', 'photo.html', 'photo-single.html', 'globals.css', 'render.cjs']) {
  await rm(resolve(outDir, name), { force: true });
}

/*
 * Bundled for Node, not for a browser: this renders on the server the way the
 * real route does. The CSS import is stubbed because esbuild would otherwise try
 * to bundle a stylesheet into a Node module, and the harness links the real file
 * from the document instead, which is what the browser actually does.
 */
const bundle = resolve(outDir, 'render.cjs');
await esbuild.build({
  entryPoints: [resolve(root, 'perf/entry.tsx')],
  bundle: true,
  /*
   * CommonJS, not ESM. prepare-markup pulls in postcss and parse5 through the
   * import sanitiser, both of which are CJS and call require() at runtime. An
   * ESM bundle turns those into a "Dynamic require of path is not supported"
   * throw at import time. CJS is what they already are.
   */
  format: 'cjs',
  platform: 'node',
  target: ['node20'],
  jsx: 'automatic',
  outfile: bundle,
  /*
   * React stays external (it is installed and there is no reason to inline it);
   * everything else, the frozen design JSON in particular, is bundled. Leaving
   * JSON external makes Node demand an import attribute the bundle does not
   * carry, which fails at import time rather than at build time.
   */
  external: ['react', 'react-dom', 'react-dom/server', 'react/jsx-runtime'],
  // Bundling postcss and parse5 in rather than leaving them external keeps this
  // one file self-contained; CJS output means their require() calls still work.
  loader: { '.json': 'json' },
  /*
   * lib/content/prepare-markup.ts carries `import 'server-only'` as a build-time
   * guarantee it never reaches a browser bundle. This renders on the server, so
   * the guarantee holds; the package just has no Node entry point. The test
   * suite already keeps a stub for exactly this.
   */
  alias: { 'server-only': resolve(root, 'tests/stubs/server-only.ts') },
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'warning',
});

const { renderProfile } = createRequire(import.meta.url)(bundle);

for (const profile of ['designed', 'native', 'photo-single', 'photo']) {
  const html = renderProfile(profile);
  await writeFile(resolve(outDir, `${profile}.html`), html, 'utf8');
  console.log(`${profile}.html  ${(Buffer.byteLength(html) / 1024).toFixed(1)} KB of HTML`);
}

/*
 * THE STYLESHEET COMES FROM THE BUILD, NOT FROM SOURCE.
 *
 * This copied app/globals.css at first, and that overstated the cost roughly
 * fourfold: the source is 302 KB raw and 80.9 KB gzipped, while what the route
 * actually ships is Next's minified output at 129.6 KB raw and 20.7 KB gzipped.
 * A harness that measures a proxy for the artefact instead of the artefact is
 * worse than no harness, because its numbers look authoritative.
 *
 * The manifest is the authority on WHICH css the published route loads. It comes
 * off the root layout, not the page, because globals.css is imported there.
 */
const manifestPath = resolve(root, '.next/app-build-manifest.json');
let manifest;
try {
  manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
} catch {
  console.error('No production build found. Run: npx next build');
  process.exit(1);
}

const cssFiles = Object.entries(manifest.pages)
  .filter(([route]) => route === '/layout' || route.includes('site/[host]/[[...path]]'))
  .flatMap(([, files]) => files)
  .filter((f) => f.endsWith('.css'));

if (cssFiles.length === 0) {
  console.error('The build manifest lists no CSS for the published route. Refusing to measure nothing.');
  process.exit(1);
}

/*
 * REFUSE A STALE STYLESHEET, the same guard tools/verify-standalone.mjs keeps and
 * for the same reason, learned here the hard way on 25 Aug 2026.
 *
 * This serves what `next build` produced. Editing app/globals.css and re-running
 * the harness without rebuilding measures the PREVIOUS stylesheet, and the
 * failure is silent: every check still passes, the numbers look plausible, and a
 * rule that was just added appears to have no effect at all. That cost a round of
 * debugging a fix that was already correct.
 */
const sourceCss = resolve(root, 'app/globals.css');
const builtNewest = Math.max(
  ...(await Promise.all(cssFiles.map(async (f) => (await stat(resolve(root, '.next', f))).mtimeMs))),
);
if ((await stat(sourceCss)).mtimeMs > builtNewest) {
  console.error(
    'app/globals.css is newer than the built stylesheet. Run `npx next build` first,\n' +
      'or this measures the previous one and says nothing about your change.',
  );
  process.exit(1);
}

const cssParts = [];
for (const file of cssFiles) cssParts.push(await readFile(resolve(root, '.next', file)));
const css = Buffer.concat(cssParts);
await writeFile(resolve(outDir, 'globals.css'), css);
console.log(
  `globals.css   ${(css.length / 1024).toFixed(1)} KB minified, from ${cssFiles.length} built file(s) the route ships`,
);

/*
 * A real photograph padded to the target size.
 *
 * The padding sits after the JPEG end-of-image marker, so a decoder stops at the
 * real picture and the network still carries every byte. That gives a file that
 * weighs what a client upload weighs while still decoding to a real image, which
 * a block of random bytes would not.
 */
const source = await readFile(resolve(repoRoot, 'test/fixtures/photo.jpg'));
const target = Math.round(heroKb * 1024);
const hero =
  target > source.length
    ? Buffer.concat([source, Buffer.alloc(target - source.length, 0)])
    : source;
await writeFile(resolve(outDir, 'img/hero.jpg'), hero);
console.log(`img/hero.jpg  ${(hero.length / 1024).toFixed(0)} KB (real photo, padded to model a client upload)`);

/*
 * The smaller copies, weighted by pixel count.
 *
 * A photograph's compressed size tracks its area rather than its width, so a
 * 1600px copy of a 2400px original is about (1600/2400)^2 of the bytes, not two
 * thirds. Modelled, like the primary, and for the same reason: there is no real
 * client photograph here to measure. What it makes honest is the COMPARISON, and
 * that is what the harness is for.
 */
for (const width of [400, 800, 1600]) {
  const bytes = Math.max(source.length, Math.round(target * (width / 2400) ** 2));
  const variant =
    bytes > source.length ? Buffer.concat([source, Buffer.alloc(bytes - source.length, 0)]) : source;
  await writeFile(resolve(outDir, `img/hero-${width}.jpg`), variant);
  console.log(`img/hero-${width}.jpg  ${(variant.length / 1024).toFixed(0)} KB`);
}

await rm(bundle, { force: true });
