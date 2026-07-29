/**
 * Builds the editor into one self-contained HTML file.
 *
 * Why this exists: the shell needs to be reviewable before there is anywhere
 * to deploy it. This bundles the real editor components, inlines the CSS and
 * JS, and writes a single file that runs from a static host with no network
 * access at all.
 *
 * It is a distribution wrapper, not a second implementation. Every component
 * it mounts is the one the Next app mounts, so feedback on this is feedback
 * on the real thing.
 *
 *   node tools/build-standalone.mjs
 *   -> standalone/out/tg-sites-editor.html
 */

import * as esbuild from 'esbuild';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const outDir = resolve(root, 'standalone/out');

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const result = await esbuild.build({
  entryPoints: [resolve(root, 'standalone/entry.tsx')],
  bundle: true,
  minify: true,
  format: 'iife',
  jsx: 'automatic',
  target: ['es2022'],
  // React ships development warnings unless this is set, and the dev build is
  // both larger and noisier in the console.
  define: { 'process.env.NODE_ENV': '"production"' },
  outdir: outDir,
  entryNames: 'app',
  metafile: true,
  logLevel: 'info',
});

const js = await readFile(resolve(outDir, 'app.js'), 'utf8');
const css = await readFile(resolve(outDir, 'app.css'), 'utf8');

const bytes = (value) => `${(Buffer.byteLength(value) / 1024).toFixed(0)} KB`;
console.log(`\n  js  ${bytes(js)}\n  css ${bytes(css)}`);

/**
 * The banner is the only thing in this file that is not the real app. It
 * exists to be honest about what a sandboxed single file cannot do, so a
 * blocked image reads as a known limitation rather than a bug in the image
 * block.
 */
const wrapperCss = `
/* --- standalone wrapper ------------------------------------------- */
html, body { margin: 0; padding: 0; height: 100%; }
body { background: #f1f5f9; }

.sa-note {
  position: fixed;
  inset: 0 0 auto 0;
  z-index: 200;
  display: flex;
  align-items: center;
  gap: 10px;
  height: 40px;
  padding: 0 14px;
  background: #0f172a;
  color: #e2e8f0;
  font: 500 12.5px/1.4 ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
}
.sa-note strong { color: #fff; font-weight: 700; }
.sa-note span { color: #94a3b8; }
.sa-note b { margin-left: auto; flex: none; font-weight: 500; color: #94a3b8; }
@media (max-width: 720px) { .sa-note span, .sa-note b { display: none; } }

/* The editor pins itself to the viewport, so make room for the banner. */
.ed-root { top: 40px; }
`;

const banner = `<div class="sa-note">
  <strong>Travelgenix Sites</strong>
  <span>CMS shell, work in progress. Your draft saves to this browser.</span>
  <b>Images and video need the hosted version, this sandbox blocks outside requests</b>
</div>`;

/** Everything inside <body>, shared by both flavours. */
const bodyParts = `${banner}\n<div id="tg-sites-root"></div>\n<script>\n${js}\n</script>`;

const styleBlock = `<style>\n${css}\n${wrapperCss}</style>`;

const html = `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>Travelgenix Sites \u2014 CMS shell</title>
${styleBlock}
</head>
<body>
${bodyParts}
</body>
</html>
`;

const outFile = resolve(outDir, 'tg-sites-editor.html');
await writeFile(outFile, html, 'utf8');
console.log(`  html ${bytes(html)}  ->  ${outFile}`);

/*
 * A second flavour for publishing as a Claude Artifact, which supplies its
 * own doctype, html, head and body and would end up with two of each if
 * given the full document above.
 */
const fragment = `<title>Travelgenix Sites \u2014 CMS shell</title>\n${styleBlock}\n${bodyParts}\n`;

const fragmentFile = resolve(outDir, 'tg-sites-editor.artifact.html');
await writeFile(fragmentFile, fragment, 'utf8');
console.log(`  artifact ${bytes(fragment)}  ->  ${fragmentFile}\n`);
