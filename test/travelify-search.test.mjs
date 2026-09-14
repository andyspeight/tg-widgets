/**
 * The Travelify booking-API search client.
 *
 * These are the rules that are easy to get wrong and expensive to get wrong
 * quietly: the session is one path segment and must not be split, each poll
 * returns only NEW results so they have to be accumulated, and a 200 carrying
 * success:false is a failure. Every one of those has already cost this project
 * time once.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TRAVELIFY_API, SEARCH_REFERER, MAX_POLLS, DEFAULT_MAX_POLLS,
  searchHeaders, isValidSession, resultsUrl, readBody,
  startSearch, pollResults, runSearch,
} from '../api/_lib/offers/travelify-search.js';

const CREDS = { appId: '250', apiKey: 'PUBLIC-KEY' };
const SESSION = '40767552/122AA215-4286-4B3B-817A-63FD54E1D72E';
const noSleep = () => Promise.resolve();

/** Serve a queue of canned answers and record what was asked for. */
function stubFetch(queue) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    const next = queue.shift();
    if (!next) throw new Error('stub ran out of answers');
    return {
      ok: next.status === undefined ? true : next.status < 400,
      status: next.status === undefined ? 200 : next.status,
      text: async () => (typeof next.body === 'string' ? next.body : JSON.stringify(next.body)),
    };
  };
  return calls;
}

test('the session is one path segment and is never split apart', () => {
  // The bug of 14 Sep 2026: only the integer half was used, so the API
  // answered "Unrecognised API method" and the endpoint looked missing.
  const url = resultsUrl(SESSION, { reloadAll: true });
  assert.ok(url.includes('/search/40767552/122AA215-4286-4B3B-817A-63FD54E1D72E'),
    'both halves must appear, separated by a real slash');
  assert.ok(!url.includes('%2F'), 'the separator must not be percent-encoded');
  assert.ok(url.startsWith(TRAVELIFY_API + '/search/'));
});

test('a malformed session never reaches a URL', () => {
  for (const bad of ['', null, undefined, '40767552', 'abc/def', '../../etc/passwd',
                     '40767552/', '/guid', '4076 7552/' + 'a'.repeat(10)]) {
    assert.equal(isValidSession(bad), false, `${bad} must not validate`);
    assert.equal(resultsUrl(bad), '', `${bad} must not produce a URL`);
  }
  assert.equal(isValidSession(SESSION), true);
});

test('reloadAll is asked for on the first poll and not after', () => {
  assert.match(resultsUrl(SESSION, { reloadAll: true }), /reloadAll=true/);
  assert.match(resultsUrl(SESSION, { reloadAll: false }), /reloadAll=false/);
  assert.match(resultsUrl(SESSION), /version=4/);
});

test('Token auth carries the Referer the API demands', () => {
  const h = searchHeaders('250', 'KEY');
  assert.equal(h.Authorization, 'Token 250:KEY');
  // Documented as mandatory for Token auth; without it the API answers 401.
  assert.equal(h.Referer, SEARCH_REFERER);
  assert.equal(h['Content-Type'], 'application/json');
});

test('a 200 carrying success:false is a failure, not a result', () => {
  const r = readBody({ success: false, errors: ['Unrecognised API method'] });
  assert.equal(r.ok, false);
  assert.match(r.error, /Unrecognised API method/);
  assert.equal(readBody({ success: true }).ok, true);
});

test('startSearch refuses a session it could not use', async () => {
  stubFetch([{ body: { success: true, searchSession: 'nonsense' } }]);
  const r = await startSearch(CREDS, { type: 'Accommodation' });
  assert.equal(r.ok, false);
  assert.match(r.error, /no usable session/);
});

test('startSearch surfaces the API error rather than inventing one', async () => {
  stubFetch([{ status: 401, body: { success: false, errors: ['Authentication error'] } }]);
  const r = await startSearch(CREDS, {});
  assert.equal(r.ok, false);
  assert.match(r.error, /Authentication error/);
});

test('results are ACCUMULATED across polls, because each poll returns only new ones', async () => {
  // The single most damaging way to misread this API: take the last poll as
  // the answer and silently cache a fraction of what came back.
  stubFetch([
    { body: { success: true, total: 3, completed: 1, accommodationResults: [{ id: 1 }] } },
    { body: { success: true, total: 3, completed: 2, accommodationResults: [{ id: 2 }] } },
    { body: { success: true, total: 3, completed: 3, accommodationResults: [{ id: 3 }] } },
  ]);
  const r = await pollResults(CREDS, SESSION, { sleep: noSleep });
  assert.equal(r.ok, true);
  assert.equal(r.complete, true);
  assert.deepEqual(r.results.map((x) => x.id), [1, 2, 3]);
  assert.equal(r.polls, 3);
});

test('polling stops the moment completed reaches total', async () => {
  const calls = stubFetch([
    { body: { success: true, total: 2, completed: 2, accommodationResults: [{ id: 1 }] } },
    { body: { success: true, total: 2, completed: 2, accommodationResults: [{ id: 99 }] } },
  ]);
  const r = await pollResults(CREDS, SESSION, { sleep: noSleep });
  assert.equal(r.polls, 1, 'a finished search must not be polled again');
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /reloadAll=true/, 'the first poll asks for everything so far');
});

test('an expired session stops the loop at once', async () => {
  stubFetch([{ status: 400, body: { success: false, errors: ['Session expired'], isSessionTimeout: true } }]);
  const r = await pollResults(CREDS, SESSION, { sleep: noSleep });
  assert.equal(r.ok, false);
  assert.match(r.error, /expired/);
  assert.equal(r.polls, 1);
});

test('one failed poll mid-flight does not abandon the search', async () => {
  stubFetch([
    { body: { success: true, total: 2, completed: 1, accommodationResults: [{ id: 1 }] } },
    { status: 500, body: { success: false, errors: ['Internal error'] } },
    { body: { success: true, total: 2, completed: 2, accommodationResults: [{ id: 2 }] } },
  ]);
  const r = await pollResults(CREDS, SESSION, { sleep: noSleep });
  assert.equal(r.ok, true);
  assert.deepEqual(r.results.map((x) => x.id), [1, 2]);
});

test('running out of polls keeps what came back rather than throwing it away', async () => {
  // A slow night must still fill the cache with what did arrive.
  stubFetch(Array.from({ length: 4 }, (_, i) => (
    { body: { success: true, total: 99, completed: i + 1, accommodationResults: [{ id: i }] } }
  )));
  const r = await pollResults(CREDS, SESSION, { sleep: noSleep, maxPolls: 4 });
  assert.equal(r.ok, true);
  assert.equal(r.complete, false, 'it must report that it did not finish');
  assert.equal(r.results.length, 4);
});

test('the poll ceiling is respected and cannot be raised past the documented max', async () => {
  stubFetch(Array.from({ length: 40 }, () => (
    { body: { success: true, total: 99, completed: 1, accommodationResults: [] } }
  )));
  const r = await pollResults(CREDS, SESSION, { sleep: noSleep, maxPolls: 999 });
  assert.equal(r.polls, MAX_POLLS, `the documented ceiling is ${MAX_POLLS}`);
  assert.ok(DEFAULT_MAX_POLLS < MAX_POLLS, 'the sweep default must sit below the ceiling');
});

test('a supplier-side 417 is reported as theirs, not as our bug', async () => {
  stubFetch([{ status: 417, body: { success: false, errors: ['Sold out'] } }]);
  const r = await startSearch(CREDS, {});
  assert.equal(r.ok, false);
  assert.equal(r.supplierError, true);
});

test('runSearch opens a session and polls it out', async () => {
  const calls = stubFetch([
    { body: { success: true, searchSession: SESSION } },
    { body: { success: true, total: 1, completed: 1, accommodationResults: [{ id: 'a' }] } },
  ]);
  const r = await runSearch(CREDS, { type: 'Accommodation' }, { sleep: noSleep });
  assert.equal(r.ok, true);
  assert.equal(r.session, SESSION);
  assert.equal(r.results.length, 1);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].url, TRAVELIFY_API + '/search');
  assert.match(calls[1].url, /\/search\/40767552\/122AA215/);
});

test('a non-JSON answer is reported rather than parsed into nonsense', async () => {
  stubFetch([{ body: '<html>gateway timeout</html>' }]);
  const r = await startSearch(CREDS, {});
  assert.equal(r.ok, false);
  assert.match(r.error, /non-JSON/);
});

test('a package search counts the flights alongside the properties', () => {
  // A package returns two arrays. The properties are what gets cached, but
  // "no flights came back" is the difference between a package price and a
  // hotel price under a package heading — the exact thing that has to be
  // visible rather than assumed. Counted, not kept: nothing renders a flight.
  const stub = stubFetch([
    { body: { success: true, total: 2, completed: 1, accommodationResults: [{ rid: 1 }], flightResults: [{ id: 'f1' }, { id: 'f2' }] } },
    { body: { success: true, total: 2, completed: 2, accommodationResults: [{ rid: 2 }], flightResults: [{ id: 'f3' }] } },
  ]);
  return pollResults(CREDS, SESSION, { sleep: noSleep, also: 'flightResults' }).then((r) => {
    assert.equal(stub.length, 2);
    assert.equal(r.ok, true);
    assert.equal(r.results.length, 2, 'the properties are still what is collected');
    assert.equal(r.alsoCount, 3, 'and the flights accumulate across polls, like everything else');
  });
});

test('a search that is not asked to count flights reports none', () => {
  // The accommodation path must not suddenly grow a flight count it never
  // asked for, and must never read the second array by accident.
  stubFetch([
    { body: { success: true, total: 1, completed: 1, accommodationResults: [{ rid: 1 }], flightResults: [{ id: 'f1' }] } },
  ]);
  return pollResults(CREDS, SESSION, { sleep: noSleep }).then((r) => {
    assert.equal(r.alsoCount, 0);
  });
});
