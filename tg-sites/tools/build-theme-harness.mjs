/**
 * Bundles the theme screen into one HTML file, for the browser harness.
 *
 * Separate from build-standalone.mjs on purpose. That one produces the review copy
 * Andy is sent, and its wrapper, banner and title are part of that deliverable.
 * This produces a test fixture, and mixing the two would mean every change to the
 * harness risking the thing that goes out.
 *
 *   node tools/build-theme-harness.mjs
 *   -> standalone/out/theme-harness.html   (then tools/verify-theme.mjs)
 */

import * as esbuild from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const outDir = resolve(root, 'standalone/out');

await mkdir(outDir, { recursive: true });

await esbuild.build({
  entryPoints: [resolve(root, 'standalone/theme-entry.tsx')],
  bundle: true,
  minify: true,
  format: 'iife',
  jsx: 'automatic',
  target: ['es2022'],
  define: { 'process.env.NODE_ENV': '"production"' },
  outdir: outDir,
  entryNames: 'theme-harness',
  logLevel: 'warning',

  plugins: [
    {
      name: 'demo-theme-actions',
      setup(build) {
        // Both action modules import the Postgres driver, and the fonts one also
        // reaches Google. Neither can exist in a file served from a static host.
        for (const filter of [/(^|\/)app\/actions\/fonts$/, /(^|\/)app\/actions\/theme$/]) {
          build.onResolve({ filter }, () => ({
            path: resolve(root, 'standalone/demo-theme-actions.ts'),
          }));
        }
      },
    },
  ],
});

const js = await readFile(resolve(outDir, 'theme-harness.js'), 'utf8');
const css = await readFile(resolve(outDir, 'theme-harness.css'), 'utf8');

const html = `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>Theme harness</title>
<style>
${css}
html, body { margin: 0; padding: 0; }
</style>
</head>
<body>
<div id="tg-sites-root"></div>
<script>
${js}
</script>
</body>
</html>
`;

const out = resolve(outDir, 'theme-harness.html');
await writeFile(out, html, 'utf8');
console.log(`  theme harness ${(Buffer.byteLength(html) / 1024).toFixed(0)} KB -> ${out}`);
