/**
 * Builds the Coastwise demonstration site from tools/coastwise-site.ts,
 * validates every page through the same parsePage + sanitisePage the editor
 * saves through, and writes seed JSON to tools/coastwise-seed/.
 *
 * Run: node tools/build-coastwise.mjs
 * A validation failure is a build failure: nothing is emitted unless every
 * page parses clean, so what lands in the database is exactly what the editor
 * would have saved.
 */
import { build } from 'esbuild';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const entry = join(mkdtempSync(join(tmpdir(), 'coastwise-')), 'entry.cjs');

await build({
  stdin: {
    contents: `
      export * as site from ${JSON.stringify(join(here, 'coastwise-site.ts'))};
      export { parsePage } from ${JSON.stringify(join(here, '../lib/content/schema.ts'))};
      export { sanitisePage } from ${JSON.stringify(join(here, '../lib/content/sanitise-page.ts'))};
      export { blockDefinition, defaultPropsFor } from ${JSON.stringify(join(here, '../lib/content/blocks.ts'))};
    `,
    resolveDir: here,
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: entry,
  logLevel: 'silent',
});

const { site, parsePage, sanitisePage, blockDefinition, defaultPropsFor } = await import(pathToFileURL(entry).href);

/*
 * A PROP KEY THE BLOCK DOES NOT HAVE IS A SILENT DEFAULT, not an error: props
 * are a free record, so a typo ("colums") parses clean and renders as if the
 * setting was never made. Sweep every block against its registry defaults and
 * name the strays. Repeater item keys are checked against the first default
 * item where one exists.
 */
function sweepProps(pageLike, label) {
  const warn = [];
  for (const section of pageLike.sections) {
    for (const r of section.rows) for (const c of r.columns) for (const b of c.blocks) {
      const def = blockDefinition(b.type);
      if (!def) { warn.push(`${label}: unknown block type "${b.type}"`); continue; }
      const known = new Set(Object.keys(defaultPropsFor(b.type)));
      for (const key of Object.keys(b.props ?? {})) {
        if (!known.has(key)) warn.push(`${label}: ${b.type}.${key} is not a prop the block has`);
      }
      const defItems = defaultPropsFor(b.type).items;
      if (Array.isArray(b.props?.items) && Array.isArray(defItems) && defItems[0]) {
        const itemKnown = new Set(Object.keys(defItems[0]));
        for (const [i, item] of b.props.items.entries()) {
          for (const key of Object.keys(item ?? {})) {
            if (!itemKnown.has(key)) warn.push(`${label}: ${b.type}.items[${i}].${key} is not an item field`);
          }
        }
      }
    }
  }
  return [...new Set(warn)];
}

const outDir = join(here, 'coastwise-seed');
mkdirSync(outDir, { recursive: true });

const pages = site.pages();
let failed = false;

for (const p of pages) {
  const parsed = parsePage(p);
  if (!parsed.ok) {
    failed = true;
    console.error(`FAIL  ${p.slug || '(home)'}\n      ${parsed.errors.join('\n      ')}`);
    continue;
  }
  const clean = sanitisePage(parsed.page);
  for (const w of sweepProps(clean, p.slug || '(home)')) { failed = true; console.error(`PROP  ${w}`); }
  // What the sanitiser CHANGED is a bug in this file: content authored here
  // should already be exactly what survives. Diff and complain.
  const before = JSON.stringify(parsed.page);
  const after = JSON.stringify(clean);
  let note = '';
  if (before !== after) {
    note = '  (sanitiser altered content — check)';
    // Walk both trees and name the first few differing paths, so the fix is
    // aimed rather than hunted.
    const diffs = [];
    (function walk(a, b, path) {
      if (diffs.length >= 6) return;
      if (typeof a !== typeof b) { diffs.push(`${path}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`); return; }
      if (a && typeof a === 'object') {
        const keys = new Set([...Object.keys(a), ...Object.keys(b ?? {})]);
        for (const k of keys) walk(a[k], (b ?? {})[k], `${path}.${k}`);
        return;
      }
      if (a !== b) diffs.push(`${path}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
    })(parsed.page, clean, p.slug || 'home');
    for (const d of diffs) console.log(`        ${d}`);
  }
  console.log(`ok    ${(p.slug || '(home)').padEnd(36)} sections=${clean.sections.length}${note}`);
  writeFileSync(join(outDir, `page-${p.slug ? p.slug.replace(/\//g, '__') : 'home'}.json`), JSON.stringify(clean, null, 1));
}

for (const [name, region] of Object.entries(site.regions())) {
  // A region is validated by wrapping it as a page, the same trick the editor
  // uses (lib/content/region-page.ts).
  const asPage = { version: 1, id: `rg_${name}`, title: name, slug: `region-${name}`, seo: { noindex: false }, sections: region.sections };
  const parsed = parsePage(asPage);
  if (!parsed.ok) {
    failed = true;
    console.error(`FAIL  region ${name}\n      ${parsed.errors.join('\n      ')}`);
    continue;
  }
  const clean = sanitisePage(parsed.page);
  for (const w of sweepProps(clean, `region:${name}`)) { failed = true; console.error(`PROP  ${w}`); }
  console.log(`ok    region:${name.padEnd(29)} sections=${clean.sections.length}`);
  writeFileSync(join(outDir, `region-${name}.json`), JSON.stringify({ sections: clean.sections }, null, 1));
}

if (failed) process.exit(1);
console.log('\nseed written to tools/coastwise-seed/');
