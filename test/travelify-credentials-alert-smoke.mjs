/**
 * A dead widget should not look like a mistyped booking reference (17 Sep 2026).
 *
 * Andy: "The My Booking widget has stopped working both for manual entry and
 * using the deep link." The cause was not our code. Travelify had started
 * answering 401 for one client's credentials (Better Lifestyle, app 474) at
 * 22:23 the night before, and /api/retrieve-order turns ANY failed Travelify
 * response into the same calm "we cannot find that booking".
 *
 * That message is right for the visitor and stays exactly as it was. It was
 * wrong for us: the agency saw it too, so a dead widget and a typo were the
 * same event, and the only way to tell them apart was to read the runtime log.
 * Fifteen hours passed before anyone did.
 *
 * So a 401 or 403 now leaves a marker, and the monitor — the robot client whose
 * whole job is to turn "the client tells us" into "we already knew" — reads the
 * markers and emails. This suite holds three things:
 *
 *   1. Only an AUTH refusal is recorded. A 404, a 500 or a timeout is not a
 *      credentials problem and must not raise a credentials alarm.
 *   2. The visitor's answer never changes, whatever happened underneath.
 *   3. The alert names the app id and the widget, because that is what somebody
 *      has to take to Travelify.
 *
 * Run: node test/travelify-credentials-alert-smoke.mjs
 *      (npm run test:travelify-cred-alert)
 */
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
const ok = (label, cond, detail) => {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.error('  ✗ ' + label + (detail ? '\n      ' + detail : '')); }
};

const R = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const ORDER = R('api/retrieve-order.js');
const PROBES = R('api/_lib/monitor/probes.js');
const MONITOR = R('api/cron/monitor.js');

const { CRED_ALERT_PREFIX } = await import('../api/retrieve-order.js');

console.log('Only a refusal of our credentials is recorded');
{
  ok('the marker is written on 401 and 403, and on nothing else',
    /if \(travelifyRes\.status === 401 \|\| travelifyRes\.status === 403\) \{\s*\n\s*await noteCredentialRejection\(/.test(ORDER));
  // A 404 is answered earlier and must never reach the recorder.
  ok('a 404 still returns not-found without raising an alarm',
    /if \(travelifyRes\.status === 404\) \{\s*\n\s*return notFound\(res\);\s*\n\s*\}/.test(ORDER));
  ok('the recorder is only ever called from that one branch',
    (ORDER.match(/await noteCredentialRejection\(/g) || []).length === 1);
  ok('it carries the app id, which is what Travelify is asked about',
    /appId,/.test(ORDER.slice(ORDER.indexOf('noteCredentialRejection({'), ORDER.indexOf('noteCredentialRejection({') + 240)));
  ok('and the widget id, so the right embed can be found',
    /widgetId,/.test(ORDER.slice(ORDER.indexOf('noteCredentialRejection({'), ORDER.indexOf('noteCredentialRejection({') + 240)));
}

console.log('Recording it can never cost a booking lookup');
{
  const fn = ORDER.slice(ORDER.indexOf('async function noteCredentialRejection'),
    ORDER.indexOf('export default async function handler'));
  ok('the whole recorder is wrapped in try/catch', /try \{[\s\S]+\} catch \(e\) \{/.test(fn));
  ok('and it never rethrows', !/throw /.test(fn));
  ok('it expires on its own rather than waiting to be tidied up',
    /CRED_ALERT_TTL_SECONDS/.test(fn) && /setNxEx\(/.test(fn));
  ok('one key per client, so a busy widget cannot flood storage',
    /info\.clientRecordId \|\| info\.clientEmail \|\| info\.widgetId/.test(fn));
  ok('the prefix is exported, so the reader cannot drift from the writer',
    /export const CRED_ALERT_PREFIX/.test(ORDER) && typeof CRED_ALERT_PREFIX === 'string' && CRED_ALERT_PREFIX.length > 0);
}

console.log('The visitor still gets the calm answer, whatever happened');
{
  // The point of the change is that OUR visibility improves and THEIRS does
  // not change: a failed lookup is still a generic not-found, so a stranger
  // cannot tell a real reference from a wrong one by the error they get.
  // Wide enough to reach past the comment that explains the branch. At 900 it
  // stopped one word short of the `return notFound(res)` it was looking for and
  // failed a line that was perfectly correct.
  const start = ORDER.indexOf('if (!travelifyRes.ok) {');
  const branch = ORDER.slice(start, ORDER.indexOf('\n    }', start) + 6);
  ok('an auth refusal still answers the visitor with not-found',
    /return notFound\(res\);/.test(branch));
  ok('and nothing about the credentials reaches the response',
    !/res\.status\(401\)/.test(branch) && !/appId/.test(branch.split('return notFound')[1] || ''));
}

console.log('The monitor turns a marker into an alert');
{
  ok('the probe exists and is exported',
    /export async function checkTravelifyCredentials\(\)/.test(PROBES));
  ok('it runs with the others on every monitor pass',
    /checkTravelifyCredentials\(\),/.test(PROBES)
    && /const \[offers, cachedOffers, widgetConfig, redis, travelifyCreds\]/.test(PROBES)
    && /travelifyCreds, checkConfig\(\)\]/.test(PROBES));
  ok('a refusal fails the probe, which is what sends the email',
    /name: 'travelify-credentials',\s*\n?\s*ok: false/.test(PROBES));
  ok('the alert names the app id and the widget',
    /app \$\{r\.appId \|\| '\?'\}/.test(PROBES) && /r\.widgetId/.test(PROBES));
  ok('it says what the client is actually experiencing',
    /Order lookups return "not found" for those clients/.test(PROBES));
  // Redis being down is checkRedis's business. If this probe failed too, one
  // outage would send two alarms and the second would be a lie.
  ok('storage being unreachable does not masquerade as a credentials fault',
    /no storage configured — not checked/.test(PROBES)
    && /could not be checked: /.test(PROBES));
  ok('the monitor still emails on a check that starts failing',
    /const failing = probes\.filter\(\(p\) => !p\.ok\)/.test(MONITOR));
}

console.log('The probe behaves with no storage to read');
{
  const { checkTravelifyCredentials } = await import('../api/_lib/monitor/probes.js');
  const before = process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_URL;
  const r = await checkTravelifyCredentials();
  ok('it reports ok rather than inventing a credentials failure', r.ok === true, JSON.stringify(r));
  ok('and says plainly that it was not checked', /not checked|could not be checked/.test(r.detail), r.detail);
  ok('it is named for what it checks', r.name === 'travelify-credentials');
  ok('and reports how long it took, like every other probe', typeof r.latencyMs === 'number');
  if (before !== undefined) process.env.UPSTASH_REDIS_REST_URL = before;
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
