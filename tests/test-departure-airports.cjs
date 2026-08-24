/**
 * The departure list must cover any airport a visitor could fly from
 * (Andy, 24 Aug 2026, after Cologne failed to match): every large or medium
 * scheduled-service airport worldwide, not just the curated majors. These
 * pin the committed file's shape and coverage so a bad refresh cannot
 * quietly shrink the chooser back down.
 */
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

let passed = 0;
const ok = (cond, name) => { assert.ok(cond, name); passed++; };

const dep = JSON.parse(readFileSync(path.join(__dirname, '../api/_data/airports-departures.json'), 'utf8'));
const majors = JSON.parse(readFileSync(path.join(__dirname, '../api/_data/airports.json'), 'utf8')).airports;

const rows = dep.airports;
ok(Array.isArray(rows) && rows.length >= 2000 && rows.length <= 5000,
  'a worldwide list, not a shortlist (' + rows.length + ')');

const IATA = /^[A-Z]{3}$/;
const codes = new Set();
for (const r of rows) {
  assert.ok(Array.isArray(r) && IATA.test(r[0]) && typeof r[1] === 'string' && r[1].length,
    'row shape: ' + JSON.stringify(r));
  assert.ok(!codes.has(r[0]), 'duplicate IATA ' + r[0]);
  codes.add(r[0]);
}
passed++;

// The complaint that started this: Cologne must be findable by name.
const cgn = rows.find((r) => r[0] === 'CGN');
ok(cgn && /cologne/i.test(cgn[1]), 'Cologne is present and searchable');
// A name that only works because the municipality is folded into the label.
const jfk = rows.find((r) => r[0] === 'JFK');
ok(jfk && /new york/i.test(jfk[1]), 'JFK is findable by city');
// Every curated major must be in the departure list too.
ok(majors.every((m) => codes.has(m[0])), 'all curated majors present');
// Large airports rank first, so the hubs surface before same-named regionals.
ok(dep.counts && dep.counts.large > 500 && rows.length === dep.counts.large + dep.counts.medium,
  'tier counts add up');

console.log(`\n${passed} passed, 0 failed`);
