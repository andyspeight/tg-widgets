/**
 * Renders designed sections as a real page you can look at.
 *
 * WHY THIS EXISTS. Everything about the block library was checked by reading
 * source and asserting on data, and three things had shipped anyway that only a
 * rendered pixel could have shown:
 *
 *   1,112 of the 1,817 icons drew as solid black blobs, because the parser
 *   flattened the group their fill and stroke were written on.
 *
 *   Every card in the library drew `border: 1px solid transparent`, a ring of
 *   nothing, because a width was set and a colour never was.
 *
 *   PANEL had a radius and some padding and no background at all, so the two
 *   presets using one showed a panel nobody could see.
 *
 * None of the three is a wrong VALUE, which is what a unit test catches. All
 * three are a value that is right and draws nothing, and the only assertion
 * that finds those is a person looking. This makes looking cheap: no database,
 * no dev server, no tenant, no login.
 *
 *   node tools/preview-presets.mjs                        every preset
 *   node tools/preview-presets.mjs pricing-three-panels   just these
 *   node tools/preview-presets.mjs --out ~/look.html      somewhere else
 *
 * It mounts the SAME PageRenderer the published site does, over the default
 * theme's real tokens, so what opens in a browser is what a client gets.
 */

import * as esbuild from 'esbuild';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const argv = process.argv.slice(2);
const outAt = argv.indexOf('--out');
const out = outAt === -1 ? resolve(root, 'standalone/out/presets.html') : argv[outAt + 1];

/*
 * `outAt + 1` is 0 when there is no --out, so the guard has to be on outAt
 * itself. Without it the first preset named on the command line was silently
 * dropped, which is the -1 sentinel trap this codebase has now hit three times.
 */
const ids = argv.filter((arg, index) => index !== outAt && !(outAt !== -1 && index === outAt + 1));

/*
 * Bundled to a temporary directory rather than into the repo. This is a thing
 * you run to look at something, not a build artefact anybody keeps, and a
 * stray .cjs in tools/ is the kind of file that gets committed by accident.
 */
const work = await mkdtemp(join(tmpdir(), 'tg-presets-'));

try {
  await preview();
} finally {
  await rm(work, { recursive: true, force: true });
}

async function preview() {
  const bundle = join(work, 'entry.cjs');

  await esbuild.build({
    entryPoints: [resolve(root, 'standalone/preset-entry.tsx')],
    outfile: bundle,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    logLevel: 'error',
  });

  let stdout;
  try {
    ({ stdout } = await run(process.execPath, [bundle], {
      env: { ...process.env, PRESET_IDS: JSON.stringify(ids) },
      // Every preset at once is a big page.
      maxBuffer: 64 * 1024 * 1024,
    }));
  } catch (error) {
    // A mistyped preset name is the common case, and it deserves its one line
    // rather than a Node stack trace with a temporary path in it.
    process.stderr.write(error.stderr || `${error.message}\n`);
    process.exitCode = 1;
    return;
  }

  const { html, vars, ids: drawn } = JSON.parse(stdout);
  const css = await readFile(resolve(root, 'app/globals.css'), 'utf8');

  /*
   * The stylesheet FIRST and the theme after it, which is the order a real page
   * uses: globals.css carries the layout and the fallback palette, the theme
   * overrides the palette with the client's own. Reversing the two would show
   * every site in Travelgenix navy whatever the client had chosen.
   */
  await writeFile(
    out,
    `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Designed sections</title>
<style>${css}
:root {
${vars}
}
body { margin: 0; }
</style>
</head>
<body><div class="tgs-page">${html}</div></body>
</html>
`,
    'utf8',
  );

  process.stdout.write(`${drawn.length} section${drawn.length === 1 ? '' : 's'} -> ${out}\n`);
}
