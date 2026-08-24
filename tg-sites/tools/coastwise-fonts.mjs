/**
 * Downloads the Coastwise faces (Archivo, IBM Plex Mono) through the repo's own
 * Google importer — the exact code the theme screen runs — and emits SQL that
 * stores them for the coastwise tenant, byte for byte what saveFontFamily would
 * have written. Run: node tools/coastwise-fonts.mjs <tenant-uuid>
 */
import { build } from 'esbuild';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const entry = join(mkdtempSync(join(tmpdir(), 'cwf-')), 'entry.cjs');
await build({
  stdin: {
    contents: `export { importGoogleFamily, familySlug } from ${JSON.stringify(join(here, '../lib/fonts/google.ts'))};`,
    resolveDir: here,
  },
  bundle: true, platform: 'node', format: 'cjs', outfile: entry, logLevel: 'silent',
});
const { importGoogleFamily, familySlug } = await import(pathToFileURL(entry).href);

const tenant = process.argv[2];
if (!tenant) { console.error('usage: node tools/coastwise-fonts.mjs <tenant-uuid>'); process.exit(1); }

let sql = '-- Coastwise fonts, mirrored from the app\'s own Google import.\n';
for (const family of ['Archivo', 'IBM Plex Mono']) {
  const imported = await importGoogleFamily(family);
  const slug = familySlug(imported.family);
  const fallback = family === 'IBM Plex Mono' ? 'mono' : 'sans';
  sql += `
insert into public.fonts (tenant_id, family, slug, source, fallback)
values ('${tenant}', '${imported.family.replace(/'/g, "''")}', '${slug}', 'google', '${fallback}')
on conflict (tenant_id, slug) do update set family = excluded.family
returning id;
`;
  for (const file of imported.files) {
    const hex = Buffer.from(file.bytes).toString('hex');
    sql += `
insert into public.font_files (tenant_id, font_id, weight, style, format, subset, unicode_range, bytes, byte_size)
select '${tenant}', id, ${file.weight}, 'normal', 'woff2', '${file.subset}', ${file.unicodeRange ? `'${file.unicodeRange}'` : 'null'}, '\\x${hex}'::bytea, ${file.bytes.byteLength}
from public.fonts where tenant_id = '${tenant}' and slug = '${slug}';
`;
  }
  console.log(`${imported.family}: ${imported.files.length} files, ${imported.files.reduce((a, f) => a + f.bytes.byteLength, 0)} bytes`);
}
writeFileSync(join(here, 'coastwise-seed', 'fonts.sql'), sql);
console.log('fonts.sql written,', sql.length, 'chars');
