#!/usr/bin/env node
/**
 * Build the events snapshot that /api/events-feed serves.
 *
 * The feed is a periodic export, not a live API, so the prototype surfaces read
 * a snapshot committed alongside the code. One file, built here, loaded once per
 * cold start by the API and sliced per request.
 *
 * Fields are shortened because the whole point is to keep the bundle small:
 * 8.9MB of full records becomes about 2.2MB this way, and the API expands the
 * short keys back out before it answers. The map is in SHORT_KEYS below and in
 * api/events-feed.js, which is the only reader.
 *
 * Usage:
 *   node scripts/build-events-snapshot.mjs feed.csv
 *   node scripts/build-events-snapshot.mjs feed.csv --out api/_data/events-snapshot.json
 *   node scripts/build-events-snapshot.mjs feed.csv --not-before 2026-08-01
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
// The snapshot itself is built by api/_lib/events/build-snapshot.js, which the
// cron that reads the supplier Google Sheet uses too. One shape, one place.
import { buildSnapshot, SHORT_KEYS } from '../api/_lib/events/build-snapshot.js';
export { SHORT_KEYS };

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length > 1 || (r[0] || '').trim());
}

function toObjects(rows) {
  if (!rows.length) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const o = Object.create(null);
    for (let i = 0; i < headers.length; i++) o[headers[i]] = (r[i] ?? '').trim();
    return o;
  });
}

const argv = process.argv.slice(2);
const value = (name, fallback = null) => {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
};
const FLAGS = new Set(['--out', '--not-before', '--generated']);
const input = argv.find((a, i) => !a.startsWith('--') && !FLAGS.has(argv[i - 1]));

if (!input) {
  console.error('Usage: node scripts/build-events-snapshot.mjs <feed.csv> [--out path] [--not-before YYYY-MM-DD]');
  process.exit(1);
}

const outPath = value('--out', 'api/_data/events-snapshot.json');
const rows = toObjects(parseCsv(readFileSync(input, 'utf8')));
const snapshot = buildSnapshot(rows, {
  notBefore: value('--not-before'),
  // The build stamps its own date rather than the pass reading a clock, so the
  // normalisation stays pure and the snapshot stays reproducible.
  generatedAt: value('--generated', new Date().toISOString().slice(0, 10)),
  source: input.split('/').pop(),
});

mkdirSync(dirname(outPath), { recursive: true });
const json = JSON.stringify(snapshot);
writeFileSync(outPath, json);

const mb = (json.length / 1048576).toFixed(2);
console.log(`\nevents snapshot -> ${outPath}`);
console.log('─'.repeat(56));
console.log(`  generated       ${snapshot.generatedAt}`);
console.log(`  events          ${snapshot.counts.events}`);
console.log(`  competitions    ${snapshot.counts.competitions}`);
console.log(`  teams           ${snapshot.counts.teams}`);
console.log(`  performers      ${snapshot.counts.performers}`);
console.log(`  venues          ${snapshot.counts.venues}`);
console.log(`  size            ${mb} MB`);
console.log('');
console.log('  biggest competitions by roster:');
for (const c of [...snapshot.competitions].sort((a, b) => b.teams - a.teams).slice(0, 8)) {
  console.log(`    ${String(c.teams).padStart(3)} teams  ${String(c.events).padStart(4)} events  ${c.label}`);
}
console.log('');
