#!/usr/bin/env node
/**
 * Run the supplier event normalisation pass over a CSV export.
 *
 * The "Supplier Event Listings" sheet exports as CSV with these headers:
 *   Supplier, Event ID For Searchbox, Event ID For Filters, Event Name,
 *   Start Date/Time, Venue Name, Venue ID
 *
 * All the logic lives in api/_lib/events/supplier-normalise.js. This file is
 * only the CSV reader, the argument parsing and the printed report, so the same
 * pass can be reused unchanged from an API route or a cron.
 *
 * Examples:
 *   node scripts/normalise-supplier-events.mjs feed.csv
 *   node scripts/normalise-supplier-events.mjs feed.csv --out events.json --venues venues.json
 *   node scripts/normalise-supplier-events.mjs feed.csv --not-before 2026-09-01 --no-merge
 *   node scripts/normalise-supplier-events.mjs feed.csv --sample 5
 *
 * Options:
 *   --out <path>        write the normalised events as JSON
 *   --venues <path>     write the unified venue registry as JSON
 *   --not-before <date> drop events starting before YYYY-MM-DD
 *   --no-merge          keep one record per supplier row (no dedupe)
 *   --window <minutes>  merge window, default 360
 *   --sample <n>        print n example records
 *   --quiet             report only, no sample
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { normaliseSupplierEvents } from '../api/_lib/events/supplier-normalise.js';

// ── CSV (RFC 4180: quoted fields, embedded commas, quotes and newlines) ──────
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  // Strip a UTF-8 BOM so the first header does not come back as "﻿Supplier".
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
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

// ── Arguments ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name, fallback = null) => {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
};

const input = argv.find((a) => !a.startsWith('--') && argv[argv.indexOf(a) - 1] !== '--out'
  && argv[argv.indexOf(a) - 1] !== '--venues' && argv[argv.indexOf(a) - 1] !== '--not-before'
  && argv[argv.indexOf(a) - 1] !== '--window' && argv[argv.indexOf(a) - 1] !== '--sample');

if (!input) {
  console.error('Usage: node scripts/normalise-supplier-events.mjs <feed.csv> [--out events.json] [--venues venues.json] [--not-before YYYY-MM-DD] [--no-merge] [--window 360] [--sample 5]');
  process.exit(1);
}

const raw = readFileSync(input, 'utf8');
const rows = toObjects(parseCsv(raw));

const started = Date.now();
const { events, venues, report } = normaliseSupplierEvents(rows, {
  merge: !flag('--no-merge'),
  mergeWindowMinutes: Number(value('--window', 360)) || 360,
  notBefore: value('--not-before'),
});
const elapsed = Date.now() - started;

// ── Report ───────────────────────────────────────────────────────────────────
const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : '—');

console.log(`\nSupplier event normalisation — ${input}`);
console.log('─'.repeat(64));
console.log(`  rows in                 ${report.rowsIn}`);
console.log(`  parsed                  ${report.parsed}`);
console.log(`  rejected                ${report.rejected}${report.rejected ? '  ' + JSON.stringify(report.rejectedReasons) : ''}`);
if (report.droppedBefore) console.log(`  dropped before ${report.droppedBefore}  ${report.droppedPast}`);
console.log(`  events out              ${report.eventsOut}`);
console.log(`  duplicates merged away  ${report.mergedAway}  (${pct(report.mergedAway, report.parsed)} of parsed rows)`);
console.log(`    of which cross-supplier ${report.crossSupplierMerges}`);
console.log(`  records with conflicts  ${report.conflicts}`);
console.log('');
console.log(`  names truncated by feed ${report.nameTruncated}`);
console.log(`    category repaired     ${report.repairedCategory}`);
console.log(`    competition repaired  ${report.repairedCompetition}`);
console.log(`    category still lost   ${report.truncatedCategoryLost}`);
console.log(`    competition still lost ${report.truncatedCompetitionLost}`);
console.log(`  no taxonomy bracket         ${report.taxonomyMissing}`);
console.log(`  category not in taxonomy    ${report.unresolvedCategory}`);
console.log(`  competition not in taxonomy ${report.unresolvedCompetition}`);
console.log(`  placeholder-team rows (never merged) ${report.placeholderTeams}`);
console.log('');
console.log(`  venues                  ${report.venues}`);
console.log(`    known to both suppliers ${report.venuesWithBothSuppliers}`);
console.log('');
if (report.timeOffsets.length) {
  console.log('  supplier time disagreements (the suppliers use different timezones —');
  console.log('  nothing is converted, the display time follows supplierPriority):');
  for (const o of report.timeOffsets.slice(0, 8)) {
    const top = Object.entries(o.competitions).slice(0, 3).map(([k, v]) => `${k} ${v}`).join(', ');
    console.log(`    ${String(o.offsetMinutes).padStart(5)} min  x${String(o.count).padStart(4)}   ${top}`);
  }
  console.log('');
}

if (report.venueAliasCandidates.length) {
  console.log('  venue alias candidates (same fixture, two venue names). Review before');
  console.log('  applying: most are one ground under two names, a few are feed errors:');
  for (const v of report.venueAliasCandidates.slice(0, 10)) {
    console.log(`    x${String(v.support).padStart(3)}  ${v.names[0]}  ==  ${v.names[1]}`);
  }
  console.log('');
}

console.log('  by supplier (rows):', JSON.stringify(report.bySupplier));
console.log('  by category (events):');
for (const [k, v] of Object.entries(report.byCategory).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${String(v).padStart(6)}  ${k}`);
}
console.log(`\n  ${elapsed}ms`);

if (report.rejectedRows.length) {
  console.log('\n  first rejected rows:');
  for (const r of report.rejectedRows.slice(0, 10)) console.log(`    row ${r.index + 2}: ${r.reason}`);
}

const sampleCount = Number(value('--sample', flag('--quiet') ? 0 : 2)) || 0;
if (sampleCount > 0) {
  console.log('\n  sample:');
  const multi = events.filter((e) => e.suppliers.length > 1).slice(0, sampleCount);
  const rest = events.slice(0, Math.max(0, sampleCount - multi.length));
  for (const e of [...multi, ...rest]) console.log(JSON.stringify(e, null, 2).split('\n').map((l) => '    ' + l).join('\n'));
}

const outPath = value('--out');
if (outPath) {
  writeFileSync(outPath, JSON.stringify(events, null, 2));
  console.log(`\n  wrote ${events.length} events to ${outPath}`);
}
const venuePath = value('--venues');
if (venuePath) {
  writeFileSync(venuePath, JSON.stringify(venues, null, 2));
  console.log(`  wrote ${venues.length} venues to ${venuePath}`);
}
console.log('');
