/**
 * Bundles the theme screen into one HTML file, for the browser harness.
 *
 * Separate from build-standalone.mjs on purpose. That one produces the review copy
 * Andy is sent, and its wrapper, banner and title are part of that deliverable.
 * This produces a test fixture, and mixing the two would mean every change to the
 * harness risking the thing that goes out.
 *
 *   node tools/build-theme-harness.mjs
 *   -> standalone/out/theme-harness.html      (then tools/verify-theme.mjs)
 *   -> standalone/out/settings-harness.html
 *
 * Two entries through one builder, because the esbuild config and the action
 * substitution are identical and a second script would be a copy to keep in step.
 */

import * as esbuild from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const outDir = resolve(root, 'standalone/out');

await mkdir(outDir, { recursive: true });

const HARNESSES = [
  {
    entry: 'standalone/theme-entry.tsx',
    name: 'theme-harness',
    title: 'Theme harness',
    // Both action modules import the Postgres driver, and the fonts one also reaches
    // Google. Neither can exist in a file served from a static host.
    swap: [
      [/(^|\/)app\/actions\/fonts$/, 'standalone/demo-theme-actions.ts'],
      [/(^|\/)app\/actions\/theme$/, 'standalone/demo-theme-actions.ts'],
    ],
  },
  {
    entry: 'standalone/settings-entry.tsx',
    name: 'settings-harness',
    title: 'Settings harness',
    swap: [
      [/(^|\/)app\/actions\/settings$/, 'standalone/demo-settings-actions.ts'],
      [/(^|\/)app\/actions\/media$/, 'standalone/demo-media-actions.ts'],
    ],
  },
];

for (const harness of HARNESSES) {
  await esbuild.build({
    entryPoints: [resolve(root, harness.entry)],
    bundle: true,
    minify: true,
    format: 'iife',
    jsx: 'automatic',
    target: ['es2022'],
    define: { 'process.env.NODE_ENV': '"production"' },
    outdir: outDir,
    entryNames: harness.name,
    logLevel: 'warning',
    plugins: [
      {
        name: `demo-actions-${harness.name}`,
        setup(build) {
          for (const [filter, target] of harness.swap) {
            build.onResolve({ filter }, () => ({ path: resolve(root, target) }));
          }
        },
      },
    ],
  });

  await writeHtml(harness.name, harness.title);
}

async function writeHtml(name, title) {
  const js = await readFile(resolve(outDir, `${name}.js`), 'utf8');
  const css = await readFile(resolve(outDir, `${name}.css`), 'utf8');

  const html = `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>${title}</title>
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

  const out = resolve(outDir, `${name}.html`);
  await writeFile(out, html, 'utf8');
  console.log(`  ${name} ${(Buffer.byteLength(html) / 1024).toFixed(0)} KB -> ${out}`);
}
