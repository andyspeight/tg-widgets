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
import { mkdir, readFile, writeFile, rm, copyFile } from 'node:fs/promises';
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
for (const name of ['designed.html', 'native.html', 'globals.css', 'render.cjs']) {
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

/*
 * Every remote image becomes the one local hero.
 *
 * Not cosmetic: an <img> pointing at a host this sandbox cannot reach fails, and
 * a failed image is not an LCP candidate, so the largest paint would silently
 * become a heading and the measurement would flatter us.
 */
function localiseImages(html) {
  return html.replace(/src="https?:\/\/[^"]*"/g, 'src="/img/hero.jpg"');
}

for (const profile of ['designed', 'native']) {
  const html = localiseImages(renderProfile(profile));
  await writeFile(resolve(outDir, `${profile}.html`), html, 'utf8');
  console.log(`${profile}.html  ${(Buffer.byteLength(html) / 1024).toFixed(1)} KB of HTML`);
}

await copyFile(resolve(root, 'app/globals.css'), resolve(outDir, 'globals.css'));

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

await rm(bundle, { force: true });
