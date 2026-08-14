/**
 * Smoke test for the whole-table read cache behind GET /api/auth/me.
 *
 * Locks the behaviour that keeps the sign-in check off Airtable on the hot path:
 * a table is read once and reused within its TTL, re-read after it expires, and
 * each table caches on its own. Pure Node, no network (the fetcher is injected).
 *
 * Run: node test/auth-table-cache-smoke.mjs
 */

import { cachedListAll, _resetTableCache } from '../api/_lib/auth/tableCache.js';

let passed = 0;
let failed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log(`  ok   ${name}`); }
  else { failed++; console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
}

// A fake fetcher that counts how many times it is called.
function counter(records) {
  let calls = 0;
  return { get calls() { return calls; }, fn: async () => { calls++; return records; } };
}

_resetTableCache();

console.log('Within the TTL: read once, served from cache after');
{
  const c = counter(['a', 'b']);
  const r1 = await cachedListAll('tbl1', 1000, { now: 0, fetchFn: c.fn });
  const r2 = await cachedListAll('tbl1', 1000, { now: 500, fetchFn: c.fn });
  ok('returns the records', r1.length === 2 && r2.length === 2);
  ok('second call within TTL does not re-read (one fetch)', c.calls === 1, `calls=${c.calls}`);
}

console.log('After the TTL: re-read');
{
  const c = counter(['x']);
  await cachedListAll('tbl2', 1000, { now: 0, fetchFn: c.fn });
  await cachedListAll('tbl2', 1000, { now: 1500, fetchFn: c.fn }); // past the TTL
  ok('re-reads once the TTL has passed (two fetches)', c.calls === 2, `calls=${c.calls}`);
}

console.log('Tables cache independently');
{
  const a = counter(['a']);
  const b = counter(['b']);
  await cachedListAll('tblA', 1000, { now: 0, fetchFn: a.fn });
  const rb = await cachedListAll('tblB', 1000, { now: 0, fetchFn: b.fn });
  ok('a different table is fetched on its own', a.calls === 1 && b.calls === 1 && rb[0] === 'b');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
