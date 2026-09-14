/**
 * Build the shared widget registry the serverless functions read.
 *
 * The dashboard's WIDGETS array in public/index.html is the single source of
 * truth for what a widget is called, what it does and which plans include it.
 * It lives inside a browser <script> block, so a Vercel function cannot import
 * it. This script lifts the API-relevant fields out of that array and writes
 * api/_lib/widget-registry.js, which /api/v1/* imports.
 *
 * The generated file is committed so the functions have no build step. Drift is
 * caught by test/widget-registry-drift-smoke.mjs, which re-runs this extraction
 * and fails if the committed copy is stale.
 *
 * Run: node scripts/build-widget-registry.mjs   (npm run build:widget-registry)
 * Flags: --check  exit 1 instead of writing when the output would change.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const SRC = new URL('../public/index.html', import.meta.url);
const OUT = new URL('../api/_lib/widget-registry.js', import.meta.url);

// A single-quoted JS string literal, honouring backslash escapes. The plain
// /'([^']*)'/ form breaks on the Contact Card description, which contains
// "visitor\'s".
const STR = "'((?:[^'\\\\]|\\\\.)*)'";

function unescapeJs(s) {
  return s.replace(/\\(['"\\nrt])/g, (_, c) =>
    ({ n: '\n', r: '\r', t: '\t' })[c] || c);
}

function field(entry, key) {
  const m = entry.match(new RegExp(`\\b${key}:\\s*${STR}`));
  return m ? unescapeJs(m[1]) : '';
}

// The dashboard's inline SVG icon and brand colour. Used to draw a fallback
// preview tile for widgets that cannot be photographed (animations, overlays,
// anything whose data comes from a third party at render time).
function icon(entry) {
  const viewBox = (entry.match(new RegExp(`viewBox:\\s*${STR}`)) || [])[1] || '0 0 24 24';
  const paths = (entry.match(new RegExp(`paths:\\s*${STR}`)) || [])[1] || '';
  return { viewBox, paths: unescapeJs(paths) };
}

function accessMap(entry) {
  const block = (entry.match(/\baccess:\s*\{([^}]*)\}/) || [, ''])[1];
  const out = {};
  for (const [, plan, val] of block.matchAll(/(\w+):\s*(-?\d+)/g)) out[plan] = Number(val);
  return out;
}

export function extractRegistry(html) {
  const start = html.indexOf('const WIDGETS = [');
  if (start < 0) throw new Error('WIDGETS array not found in public/index.html');
  const body = html.slice(start);
  const rows = [];
  // Same one-entry-at-a-time walk as test/plan-limits-drift-smoke.mjs, so a
  // card whose fields sit in an unusual order cannot be read against its
  // neighbour's values.
  for (const chunk of body.split(/\n  \{\n/).slice(1)) {
    const entry = chunk.split(/\n  \},?\n/)[0];
    const id = field(entry, 'id');
    if (!id) continue;
    rows.push({
      id,
      name: field(entry, 'name'),
      airtableType: field(entry, 'airtableType') || field(entry, 'name'),
      description: field(entry, 'description'),
      dashboardCategory: field(entry, 'category'),
      status: field(entry, 'status') || 'live',
      editorUrl: field(entry, 'editorUrl'),
      widgetTag: field(entry, 'widgetTag'),
      color: field(entry, 'color'),
      icon: icon(entry),
      access: accessMap(entry),
    });
  }
  return rows;
}

export function renderModule(rows) {
  const entries = rows.map((r) => `  {
    id: ${JSON.stringify(r.id)},
    name: ${JSON.stringify(r.name)},
    airtableType: ${JSON.stringify(r.airtableType)},
    description: ${JSON.stringify(r.description)},
    dashboardCategory: ${JSON.stringify(r.dashboardCategory)},
    status: ${JSON.stringify(r.status)},
    editorUrl: ${JSON.stringify(r.editorUrl)},
    widgetTag: ${JSON.stringify(r.widgetTag)},
    color: ${JSON.stringify(r.color)},
    icon: ${JSON.stringify(r.icon)},
    access: ${JSON.stringify(r.access)},
  },`).join('\n');

  return `/**
 * GENERATED FILE - do not edit by hand.
 *
 * Lifted from the WIDGETS registry in public/index.html, which stays the single
 * source of truth for widget names, copy and plan availability. Regenerate with
 * \`npm run build:widget-registry\` after changing that array; the drift test
 * (npm run test:widget-registry-drift) fails if this copy goes stale.
 *
 * Consumed by the Travelify platform endpoints under /api/v1/.
 */

export const WIDGET_REGISTRY = [
${entries}
];

/** Widget ids keyed for O(1) lookup. */
export const WIDGETS_BY_ID = Object.freeze(
  Object.fromEntries(WIDGET_REGISTRY.map((w) => [w.id, w])),
);

/** Every widget id in the registry. */
export const WIDGET_IDS = Object.freeze(WIDGET_REGISTRY.map((w) => w.id));
`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rows = extractRegistry(readFileSync(SRC, 'utf8'));
  const next = renderModule(rows);
  let current = '';
  try { current = readFileSync(OUT, 'utf8'); } catch { /* first run */ }

  if (process.argv.includes('--check')) {
    if (current !== next) {
      console.error('✗ api/_lib/widget-registry.js is stale. Run: npm run build:widget-registry');
      process.exit(1);
    }
    console.log(`✓ widget registry is current (${rows.length} widgets)`);
  } else {
    writeFileSync(OUT, next);
    console.log(`✓ wrote api/_lib/widget-registry.js (${rows.length} widgets)`);
  }
}
