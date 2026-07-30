/**
 * Generate lib/fonts/catalogue.ts from Google's own family list.
 *
 *   node tools/build-font-catalogue.mjs
 *
 * WHY A COMMITTED FILE RATHER THAN A FETCH
 *
 * The catalogue is for BROWSING. Somebody opening the font picker wants to
 * scroll and search a list, and that list should not depend on a network call
 * succeeding at the moment they click, nor on an API key, nor on a Google
 * endpoint that could change shape.
 *
 * It is deliberately NOT the authority on what exists. Any name a person types
 * is checked against Google itself, so a font published after this file was
 * generated still imports. The catalogue going stale costs discovery, never
 * capability, which is the right way round for a generated file that somebody
 * has to remember to re-run.
 *
 * WHERE THE DATA COMES FROM
 *
 * google/fonts holds tags/all/families.csv: one row per family per tag, with a
 * score. It is the file behind the filters on fonts.google.com. The family
 * list endpoint needs an API key and the metadata endpoint is not public, so
 * this is the one source that is both complete and reachable without
 * credentials.
 *
 * The classification comes from the tag namespaces. /Sans/Grotesque and
 * /Serif/Didone are real classifications; /Expressive/Calm and /Quality/* are
 * mood and scoring, which are not used yet and are the obvious next thing if
 * anybody wants "find me a calm, businesslike font".
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SOURCE =
  'https://raw.githubusercontent.com/google/fonts/main/tags/all/families.csv';

/** Tag namespaces that describe the shape of the letters, not the mood. */
const CATEGORY_FROM_TAG = {
  Sans: 'sans',
  Serif: 'serif',
  Slab: 'slab',
  Script: 'script',
  Monospace: 'mono',
};

const response = await fetch(SOURCE);
if (!response.ok) {
  console.error(`Could not fetch the family list: HTTP ${response.status}`);
  process.exit(1);
}

const csv = await response.text();

/** family -> { category, score } keeping the highest scoring classification. */
const families = new Map();

for (const line of csv.split('\n')) {
  if (!line.trim()) continue;

  // family,subfamily,/Namespace/Tag,score
  const parts = line.split(',');
  if (parts.length < 4) continue;

  const family = parts[0].trim();
  const tag = parts[2].trim();
  const score = Number(parts[3]);
  if (!family || !tag.startsWith('/')) continue;

  const namespace = tag.split('/')[1];
  const category = CATEGORY_FROM_TAG[namespace];

  const existing = families.get(family);
  if (!existing) {
    families.set(family, { category: category ?? null, score: category ? score : -1 });
    continue;
  }

  // Keep the strongest classification. A family tagged /Sans/Grotesque 90 and
  // /Serif/Modern 10 is a sans, and taking the first row would be a coin toss
  // on CSV ordering.
  if (category && score > existing.score) {
    families.set(family, { category, score });
  }
}

const rows = [...families.entries()]
  .map(([family, { category }]) => [family, category ?? 'display'])
  // Alphabetical, so a diff of this file is readable when it is regenerated.
  .sort((a, b) => a[0].localeCompare(b[0], 'en'));

const counts = rows.reduce((acc, [, category]) => {
  acc[category] = (acc[category] ?? 0) + 1;
  return acc;
}, {});

const file = `/**
 * Every font family Google publishes, with a rough classification.
 *
 * GENERATED. Do not edit by hand: run \`node tools/build-font-catalogue.mjs\`.
 * Regenerate it occasionally, or when somebody says a font is missing from the
 * picker. See that script for why this is committed rather than fetched.
 *
 * NOT the authority on what exists. A name typed by a person is checked against
 * Google itself, so a family added after this was generated still imports; it
 * just will not appear in the list until somebody re-runs the script. Stale
 * costs discovery, never capability.
 *
 * Generated from ${SOURCE}
 * ${rows.length} families: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')}.
 */

export type FontCategory = 'sans' | 'serif' | 'slab' | 'script' | 'mono' | 'display';

export const CATEGORY_LABEL: Record<FontCategory, string> = {
  sans: 'Sans serif',
  serif: 'Serif',
  slab: 'Slab serif',
  script: 'Handwriting',
  mono: 'Monospace',
  display: 'Display',
};

/** [family, category], alphabetical by family. */
export const GOOGLE_FONTS: ReadonlyArray<readonly [string, FontCategory]> = [
${rows.map(([f, c]) => `  ['${f.replace(/'/g, "\\'")}', '${c}'],`).join('\n')}
];
`;

const out = resolve(process.cwd(), 'lib/fonts/catalogue.ts');
writeFileSync(out, file);

console.log(`${rows.length} families -> lib/fonts/catalogue.ts`);
console.log(Object.entries(counts).map(([k, v]) => `  ${v} ${k}`).join('\n'));
