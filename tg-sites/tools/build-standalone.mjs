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

/*
 * Removes ONLY this build's own files, not the whole directory.
 *
 * It used to be `rm -rf` on standalone/out, which was fine while this was the only
 * thing writing there and became a trap the moment the theme harness arrived:
 * building the editor silently deleted theme-harness.html, so running the two
 * verifications in the obvious order made the second one report zero checks. Zero
 * checks reads as "nothing to test" rather than as "the fixture is missing", which
 * is the worst way for a harness to fail.
 */
await mkdir(outDir, { recursive: true });
for (const name of ['app.js', 'app.css', 'tg-sites-editor.html', 'tg-sites-editor.artifact.html']) {
  await rm(resolve(outDir, name), { force: true });
}

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

  plugins: [
    {
      /**
       * Swap the server actions for in-memory doubles.
       *
       * The real ones import a Postgres driver and Next's cache, neither of
       * which can exist in a file served from a static host. This is the ONLY
       * substitution the standalone build makes, and it is confined to
       * persistence: every component, every style and every validation rule
       * is the real one.
       *
       * standalone/demo-actions.ts type-checks itself against the real
       * signatures, so this cannot silently drift.
       */
      name: 'demo-actions',
      setup(build) {
        build.onResolve({ filter: /(^|\/)app\/actions\/pages$/ }, () => ({
          path: resolve(root, 'standalone/demo-actions.ts'),
        }));
        /*
         * The media actions too, for the same reason and one more.
         *
         * They import the Postgres driver, and they also import the blob store SDK
         * and reach api.pexels.com, neither of which exists in a file served from a
         * static host. Without this the image picker could not be opened in the
         * review copy at all.
         */
        build.onResolve({ filter: /(^|\/)app\/actions\/media$/ }, () => ({
          path: resolve(root, 'standalone/demo-media-actions.ts'),
        }));
        /*
         * And the writing assistant, which has a third reason on top of the
         * Postgres driver: the real one calls Anthropic with a key that bills
         * Travelgenix. A review copy anybody can open must not be able to spend
         * money, and a key bundled into a static file would not be a key for
         * long either.
         */
        build.onResolve({ filter: /(^|\/)app\/actions\/ai$/ }, () => ({
          path: resolve(root, 'standalone/demo-ai-actions.ts'),
        }));
        /*
         * And the header and footer actions, for the plain Postgres reason. The
         * double validates through the real parseRegion and sanitises through
         * the real sanitiseRegion, so a malformed header is refused in the
         * review copy exactly as it would be against the database.
         */
        build.onResolve({ filter: /(^|\/)app\/actions\/regions$/ }, () => ({
          path: resolve(root, 'standalone/demo-region-actions.ts'),
        }));
      },
    },
  ],
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
  <span>Review copy. Nothing you change here is saved, close the tab and it is gone.</span>
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
