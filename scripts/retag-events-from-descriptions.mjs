/**
 * Rebuild event month tags from the descriptions underneath them.
 *
 * WHY. An audit on 15 Sep 2026 found 227 events across the destination library
 * whose month tag contradicts their own description: Art Deco Weekend tagged
 * February when its text says mid-January, and 226 more like it. A traveller
 * filters on the tag and reads the description, so we were telling them two
 * different things and one of them sent them weeks late.
 *
 * Which half is wrong could not be settled from outside. A sample of 45 checked
 * against Wikipedia settled two, and in both the description won; the rest are
 * local festivals with no article. Andy's call was to rebuild the tags from the
 * descriptions, which are far more specific and, crucially, already ours.
 *
 * SO NOTHING HERE IS INVENTED. Every month written back was already in the
 * record, put there by a person. Where a description does not clearly say when
 * the thing happens, the record is left exactly as it is and reported instead.
 * The judgement lives in monthTagFromText and proposedRetag in
 * _lib/destination-events.js, next to the audit that found the problem.
 *
 * Usage:
 *   node scripts/retag-events-from-descriptions.mjs            # dry run
 *   node scripts/retag-events-from-descriptions.mjs --apply    # write
 *   node scripts/retag-events-from-descriptions.mjs --out=f.json
 *
 * Needs AIRTABLE_DESTINATION_CONTENT_PAT, the same token the dashboard uses.
 */
import fs from 'node:fs';
import { proposedRetag, eventProblems } from '../api/_lib/destination-events.js';

const BASE = 'appuZdlMJ7HKUt6qS';
const TABLES = [
  { key: 'country', label: 'Countries',         id: 'tblsxbqbyhTDoWhbo', name: 'flddJJrpwcXOwWIow', ev: 'fldylxHJYE7PtQ86s' },
  { key: 'city',    label: 'Cities and Regions', id: 'tblTkKujdVZgWPAQe', name: 'fld2VkY61c1JKUWKB', ev: 'fldxze1iXQRrJ0UZW' },
  { key: 'resort',  label: 'Resorts and Areas',  id: 'tblwV9gnbVEyZ99gI', name: 'fldnvOipaWpG3W1rx', ev: 'fldWRl0d0z1MY6DMq' },
];

const APPLY = process.argv.includes('--apply');
const OUT = (process.argv.find(a => a.startsWith('--out=')) || '').slice(6);
const PAT = process.env.AIRTABLE_DESTINATION_CONTENT_PAT || process.env.AIRTABLE_PAT;
if (!PAT) { console.error('Set AIRTABLE_DESTINATION_CONTENT_PAT first.'); process.exit(1); }

const api = async (path, init = {}) => {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch('https://api.airtable.com/v0/' + path, {
      ...init,
      headers: { authorization: 'Bearer ' + PAT, 'content-type': 'application/json', ...(init.headers || {}) },
      signal: AbortSignal.timeout(30000),
    });
    if (r.ok) return r.json();
    // 429 is the per-base rate limit, and it clears on its own.
    if ((r.status === 429 || r.status >= 500) && attempt < 4) {
      await new Promise(res => setTimeout(res, 1000 * Math.pow(2, attempt)));
      continue;
    }
    throw new Error(path.split('?')[0] + ' -> ' + r.status + ' ' + (await r.text()).slice(0, 300));
  }
};

async function allRecords(t) {
  const out = [];
  let offset;
  do {
    const q = new URLSearchParams({ pageSize: '100' });
    q.append('fields[]', t.name); q.append('fields[]', t.ev);
    if (offset) q.set('offset', offset);
    const page = await api(BASE + '/' + t.id + '?' + q);
    out.push(...page.records);
    offset = page.offset;
  } while (offset);
  return out;
}

const changes = [], held = [], skipped = [];

for (const t of TABLES) {
  const records = await allRecords(t);
  const writes = [];
  for (const rec of records) {
    const raw = rec.fields[t.ev];
    if (typeof raw !== 'string' || !raw.trim()) continue;
    let events;
    try { events = JSON.parse(raw); } catch { continue; }
    if (!Array.isArray(events)) continue;

    const place = rec.fields[t.name] || rec.id;
    const before = JSON.stringify(events);
    const done = [];

    events.forEach((e, i) => {
      const fix = proposedRetag(e);
      if (fix) {
        // Change only the key that already holds the month. Nothing else on the
        // entry is touched, including the icon and the description itself.
        e[fix.key] = fix.next;
        done.push({ type: t.key, place, id: rec.id, index: i, event: fix.name, key: fix.key, was: fix.was, now: fix.next });
        return;
      }
      // Still wrong, and the text would not say what to put instead.
      const why = eventProblems(JSON.stringify([e]));
      if (why.some(w => /tagged .* but its own description says/.test(w))) {
        held.push({ type: t.key, place, id: rec.id, index: i,
          event: e.name || e.title || '(unnamed)', month: e.month ?? e.period ?? e.date ?? '',
          why: why.find(w => /tagged/.test(w)), text: String(e.description || '') });
      }
    });

    if (!done.length) continue;
    const after = JSON.stringify(events, null, 0);
    if (after === before) { skipped.push(place); continue; }
    changes.push(...done);
    writes.push({ id: rec.id, fields: { [t.ev]: after } });
  }

  if (APPLY && writes.length) {
    for (let i = 0; i < writes.length; i += 10) {
      await api(BASE + '/' + t.id, { method: 'PATCH', body: JSON.stringify({ records: writes.slice(i, i + 10) }) });
      process.stderr.write('.');
    }
  }
  console.log(t.label.padEnd(20) + String(writes.length).padStart(4) + ' records, ' +
              String(changes.filter(c => c.type === t.key).length).padStart(4) + ' tags' +
              (APPLY ? ' WRITTEN' : ' (dry run)'));
}

console.log('\n' + changes.length + ' tags rebuilt from their own descriptions');
console.log(held.length + ' left alone because the text does not say clearly enough');
const moved = changes.reduce((m, c) => ((m[c.was + ' -> ' + c.now] = (m[c.was + ' -> ' + c.now] || 0) + 1), m), {});
console.log('\nmost common corrections:');
Object.entries(moved).sort((a, b) => b[1] - a[1]).slice(0, 12)
  .forEach(([k, v]) => console.log('  ' + String(v).padStart(3) + '  ' + k));
if (OUT) { fs.writeFileSync(OUT, JSON.stringify({ apply: APPLY, changes, held }, null, 1)); console.log('\nwritten to ' + OUT); }
if (!APPLY) console.log('\nDRY RUN. Nothing was written. Re-run with --apply.');
