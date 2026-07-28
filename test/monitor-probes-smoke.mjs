/**
 * Synthetic monitor probes — the robot client classifies real vs false failures.
 *
 * Drives the REAL probe functions with a mocked fetch. The offers probe must
 * pass on real data and fail on an empty/error/timeout body; the widget-config
 * probe must treat a clean 200/404 as alive but a 5xx/timeout as down; the config
 * probe must catch a missing required setting and name it.
 *
 * Run: node test/monitor-probes-smoke.mjs
 */
import { checkOffers, checkWidgetConfig, checkConfig, REQUIRED_ENV, runAllProbes } from '../api/_lib/monitor/probes.js';

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };
const SELF = 'https://tg-widgets.vercel.app';
const realFetch = global.fetch;

// ── offers probe ─────────────────────────────────────────────────────────────
global.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ success: true, data: [1, 2, 3] }) });
let r = await checkOffers(SELF, 'sekret');
ok(r.name === 'offers' && r.ok === true && /3 offers/.test(r.detail), 'offers: real data → ok');

global.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ success: false, error: 'Unknown client' }) });
r = await checkOffers(SELF, 'sekret');
ok(r.ok === false && /Unknown client/.test(r.detail), 'offers: success:false → fail with the reason');

global.fetch = async () => ({ ok: false, status: 500, text: async () => '' });
r = await checkOffers(SELF, 'sekret');
ok(r.ok === false && /HTTP 500/.test(r.detail), 'offers: HTTP 500 → fail');

global.fetch = async () => ({ ok: true, status: 200, text: async () => '' });
r = await checkOffers(SELF, 'sekret');
ok(r.ok === false && /empty|invalid/.test(r.detail), 'offers: empty 200 body → fail (would be the dropped-connection case)');

global.fetch = async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; };
r = await checkOffers(SELF, 'sekret');
ok(r.ok === false && /timed out/.test(r.detail), 'offers: abort → timed out');

// The offers probe must carry the internal-cron secret so it is exempt from the
// per-IP rate limit and the abuse telemetry.
let sawSecret = null;
global.fetch = async (url, opts) => { sawSecret = opts.headers['x-tgs-internal']; return { ok: true, status: 200, text: async () => JSON.stringify({ success: true, data: [1] }) }; };
await checkOffers(SELF, 'sekret');
ok(sawSecret === 'sekret', 'offers probe sends the internal-cron secret (rate-limit + telemetry exempt)');

// ── widget-config probe ──────────────────────────────────────────────────────
global.fetch = async () => ({ status: 200, text: async () => '{}' });
r = await checkWidgetConfig(SELF);
ok(r.ok === true && /HTTP 200/.test(r.detail), 'widget-config: 200 → ok');

global.fetch = async () => ({ status: 404, text: async () => '{}' });
r = await checkWidgetConfig(SELF);
ok(r.ok === true && /HTTP 404/.test(r.detail), 'widget-config: 404 (Airtable reached, id absent) → ok');

global.fetch = async () => ({ status: 500, text: async () => '' });
r = await checkWidgetConfig(SELF);
ok(r.ok === false && /HTTP 500/.test(r.detail), 'widget-config: 500 → fail');

global.fetch = async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; };
r = await checkWidgetConfig(SELF);
ok(r.ok === false && /timed out/.test(r.detail), 'widget-config: timeout → fail');

// The probe must carry the internal-cron secret so widget-config skips telemetry
// for it (its throwaway id 404s by design and would otherwise inflate the config
// error counts).
let cfgSecret = null;
global.fetch = async (url, opts) => { cfgSecret = opts && opts.headers && opts.headers['x-tgs-internal']; return { status: 404, text: async () => '{}' }; };
await checkWidgetConfig(SELF, 'sekret');
ok(cfgSecret === 'sekret', 'widget-config probe sends the internal-cron secret (telemetry exempt)');

// ── config probe ─────────────────────────────────────────────────────────────
const saved = {};
for (const k of REQUIRED_ENV) { saved[k] = process.env[k]; process.env[k] = 'present'; }
r = checkConfig();
ok(r.name === 'config' && r.ok === true, 'config: all required settings present → ok');
delete process.env.SUPABASE_URL;
r = checkConfig();
ok(r.ok === false && /SUPABASE_URL/.test(r.detail), 'config: a missing setting → fail and names it');
for (const k of REQUIRED_ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }

// ── runAllProbes shape ───────────────────────────────────────────────────────
global.fetch = async (url) => {
  const u = String(url);
  if (u.includes('/api/offers')) return { ok: true, status: 200, text: async () => JSON.stringify({ success: true, data: [1] }) };
  if (u.includes('/api/widget-config')) return { status: 404, text: async () => '{}' };
  return { ok: false, status: 500, text: async () => '' };
};
const all = await runAllProbes({ selfOrigin: SELF, secret: 'sekret' });
ok(Array.isArray(all) && all.length === 4, 'runAllProbes returns four checks');
ok(all.map((p) => p.name).sort().join(',') === 'config,offers,redis,widget-config', 'runAllProbes covers offers, widget-config, redis and config');
ok(all.every((p) => typeof p.ok === 'boolean' && typeof p.name === 'string'), 'every probe returns a { name, ok } shape');

global.fetch = realFetch;
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
