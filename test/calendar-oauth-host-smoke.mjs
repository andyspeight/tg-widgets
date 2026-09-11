/**
 * OAuth redirect URIs come from ONE host list (11 Sep 2026).
 *
 * A user setting up the Appointment Scheduler on id.travelify.io was stopped by
 * Google with "Error 400: redirect_uri_mismatch". Cause: /api/calendar/connect
 * built its redirect URI straight from `req.headers.host`, so it handed Google
 * a callback URI that was never registered on the calendar OAuth client, while
 * the sign-in flow kept its own private allow-list of the three hosts we serve.
 * Two lists, one of them absent, no test holding them together.
 *
 * This guards:
 *   1. api/_lib/app-hosts.js is the one list, and resolveHost() normalises the
 *      proxy header, a comma list, a port and case, falling back to the primary
 *      for anything unrecognised (a Vercel preview, a new alias).
 *   2. Both Google flows read it — the sign-in module declares no host list of
 *      its own, and the calendar connect does not touch req.headers.host.
 *   3. Every host on the list has its calendar callback URI written down in
 *      google.js, which is what someone copies into the Google console.
 *   4. configError() names a calendar client that is really the sign-in client,
 *      the other way to earn a redirect_uri_mismatch.
 *
 * Run: node test/calendar-oauth-host-smoke.mjs  (npm run test:calendar-oauth-host)
 */
import { readFileSync } from 'node:fs';
import { APP_HOSTS, PRIMARY_HOST, resolveHost, isAppHost, normaliseHost, appUrl } from '../api/_lib/app-hosts.js';
import * as google from '../api/_lib/calendar/google.js';

let passed = 0, failed = 0;
const ok = (name, cond, detail) => {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (detail ? '\n      ' + detail : '')); }
};
const req = (headers) => ({ headers: headers || {} });

const CONNECT = readFileSync(new URL('../api/calendar/connect.js', import.meta.url), 'utf8');
const SHARED = readFileSync(new URL('../api/auth/google/_shared.js', import.meta.url), 'utf8');
const GOOGLE = readFileSync(new URL('../api/_lib/calendar/google.js', import.meta.url), 'utf8');
const EDITOR = readFileSync(new URL('../public/editor-appointment.html', import.meta.url), 'utf8');
const SETUP_DOC = readFileSync(new URL('../CALENDAR-OAUTH.md', import.meta.url), 'utf8');

console.log('The list itself');
{
  ok('the three hosts we serve are on it',
    APP_HOSTS.length === 3
    && APP_HOSTS.includes('id.travelify.io')
    && APP_HOSTS.includes('widgets.travelify.io')
    && APP_HOSTS.includes('tg-widgets.vercel.app'), APP_HOSTS.join(', '));
  ok('the primary is one of them', APP_HOSTS.includes(PRIMARY_HOST));
  ok('isAppHost accepts ours and refuses a stranger',
    isAppHost('widgets.travelify.io') && !isAppHost('evil.example.com'));
  ok('isAppHost ignores case and a port',
    isAppHost('ID.Travelify.IO') && isAppHost('id.travelify.io:443'));
  ok('normaliseHost survives nothing at all',
    normaliseHost(undefined) === '' && normaliseHost(null) === '' && normaliseHost('') === '');
}

console.log('resolveHost picks a host we can actually redirect to');
{
  ok('the proxy header wins over the internal Host',
    resolveHost(req({ 'x-forwarded-host': 'widgets.travelify.io', host: 'tg-widgets.vercel.app' })) === 'widgets.travelify.io');
  ok('a bare Host header is used when there is no proxy header',
    resolveHost(req({ host: 'widgets.travelify.io' })) === 'widgets.travelify.io');
  ok('each of our hosts round-trips to itself (nothing that works today changes)',
    APP_HOSTS.every((h) => resolveHost(req({ 'x-forwarded-host': h })) === h));
  ok('a comma-separated chain takes the first hop',
    resolveHost(req({ 'x-forwarded-host': 'id.travelify.io, internal.vercel' })) === 'id.travelify.io');
  ok('case and a port are normalised, not rejected',
    resolveHost(req({ host: 'WIDGETS.Travelify.io:443' })) === 'widgets.travelify.io');
  ok('a Vercel preview host falls back to the primary rather than a URI Google has never seen',
    resolveHost(req({ 'x-forwarded-host': 'tg-widgets-9w453w3il-agendasgroup.vercel.app' })) === PRIMARY_HOST);
  ok('no headers at all still yields the primary',
    resolveHost(req()) === PRIMARY_HOST && resolveHost(undefined) === PRIMARY_HOST);
  ok('appUrl builds an https callback on the resolved host',
    appUrl(req({ host: 'widgets.travelify.io' }), '/api/calendar/callback') === 'https://widgets.travelify.io/api/calendar/callback');
  ok('appUrl never emits http, whatever the proxy claims',
    appUrl(req({ 'x-forwarded-proto': 'http', host: 'id.travelify.io' }), '/x').startsWith('https://'));
}

console.log('Both Google flows read that one list');
{
  ok('the calendar connect imports resolveHost',
    /import \{ resolveHost \} from '\.\.\/_lib\/app-hosts\.js';/.test(CONNECT));
  ok('the calendar connect no longer builds the URI from req.headers.host',
    !/req\.headers\.host/.test(CONNECT), 'still reads the raw Host header');
  ok('the calendar redirect URI is https + the resolved host + the callback path',
    /const host = resolveHost\(req\);[\s\S]{0,120}https:\/\/\$\{host\}\/api\/calendar\/callback/.test(CONNECT));
  ok('the sign-in module declares no host list of its own',
    !/const ALLOWED_HOSTS = \[/.test(SHARED) && !/const PRIMARY_HOST = '/.test(SHARED));
  ok('the sign-in module takes both from app-hosts.js',
    /import \{ APP_HOSTS, PRIMARY_HOST, resolveHost \} from '\.\.\/\.\.\/_lib\/app-hosts\.js';/.test(SHARED));
  ok('sign-in still resolves its host the same way',
    /export function requestHost\(req\) \{\s*return resolveHost\(req\);\s*\}/.test(SHARED));
  ok('the connect logs the exact URI it sent, so a refusal is one log line',
    /console\.log\([^)]*\[calendar\/connect\][^)]*redirect_uri=/.test(CONNECT));
}

console.log('The console list is written down where someone can copy it');
{
  for (const h of APP_HOSTS) {
    ok('google.js documents https://' + h + '/api/calendar/callback',
      GOOGLE.includes('https://' + h + '/api/calendar/callback'));
  }
  ok('it says the URIs belong to the CALENDAR client, not the sign-in one',
    /calendar client's "Authorized redirect URIs"/.test(GOOGLE));

  // CALENDAR-OAUTH.md is the page someone actually follows when creating the
  // OAuth client. It listed only two hosts, written before id.travelify.io
  // existed, which is how the missing URI went unnoticed for three weeks.
  for (const h of APP_HOSTS) {
    ok('CALENDAR-OAUTH.md lists https://' + h + '/api/calendar/callback',
      SETUP_DOC.includes('https://' + h + '/api/calendar/callback'));
  }
  ok('the setup doc warns against reusing the sign-in client',
    /GOOGLE_CLIENT_ID` must not be the\s*\n?\s*same value as `GOOGLE_SIGNIN_CLIENT_ID/.test(SETUP_DOC));
}

console.log('A calendar client that is really the sign-in client is named, not bounced');
{
  const saved = { id: process.env.GOOGLE_CLIENT_ID, secret: process.env.GOOGLE_CLIENT_SECRET, signin: process.env.GOOGLE_SIGNIN_CLIENT_ID };
  try {
    delete process.env.GOOGLE_CLIENT_ID; delete process.env.GOOGLE_CLIENT_SECRET; delete process.env.GOOGLE_SIGNIN_CLIENT_ID;
    ok('no credentials at all reads as not_configured', google.configError() === 'not_configured');

    process.env.GOOGLE_CLIENT_ID = 'cal.apps.googleusercontent.com';
    process.env.GOOGLE_CLIENT_SECRET = 's3cret';
    ok('a calendar client of its own is fine', google.configError() === null);

    process.env.GOOGLE_SIGNIN_CLIENT_ID = 'signin.apps.googleusercontent.com';
    ok('a DIFFERENT sign-in client is still fine', google.configError() === null);

    process.env.GOOGLE_SIGNIN_CLIENT_ID = 'cal.apps.googleusercontent.com';
    ok('the same id on both is called out (it cannot carry the calendar callback)',
      google.configError() === 'same_client_as_signin');

    process.env.GOOGLE_CLIENT_SECRET = '';
    ok('a missing secret still reads as not_configured first', google.configError() === 'not_configured');
  } finally {
    if (saved.id === undefined) delete process.env.GOOGLE_CLIENT_ID; else process.env.GOOGLE_CLIENT_ID = saved.id;
    if (saved.secret === undefined) delete process.env.GOOGLE_CLIENT_SECRET; else process.env.GOOGLE_CLIENT_SECRET = saved.secret;
    if (saved.signin === undefined) delete process.env.GOOGLE_SIGNIN_CLIENT_ID; else process.env.GOOGLE_SIGNIN_CLIENT_ID = saved.signin;
  }
  ok('the connect asks the provider for a config error before leaving for it',
    /provider\.configError === 'function' \? provider\.configError\(\) : null/.test(CONNECT));
  ok('missing credentials take the same path as wrong ones',
    /!provider\.configured\(\)\s*\?\s*'not_configured'/.test(CONNECT));
  ok('a setup failure returns to the editor, never a JSON body on a full-page navigation',
    /if \(configError\) \{[\s\S]{0,200}back\(res, ret, 'notsetup', param\)/.test(CONNECT)
    && !/configError[\s\S]{0,200}res\.status\(500\)/.test(CONNECT));
  ok('zoom comes back on its own status parameter',
    /const param = providerName === 'zoom' \? 'zoom' : 'calendar';/.test(CONNECT));
  ok('the editor has a message for notsetup on both calendar and zoom',
    (EDITOR.match(/notsetup: \[/g) || []).length === 2);
  ok('that message tells the agent it is our side, not theirs',
    /notsetup: \['Calendar connections are not set up on our side yet/.test(EDITOR));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
