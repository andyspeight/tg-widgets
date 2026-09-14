/**
 * Travelgenix Widget Suite — Travelify booking-API search client
 *
 * The real search, as documented at https://docs.travelify.io. This replaces
 * the `widgetsvc/traveloffers` path for TTI Offers, which was the wrong service
 * for the job: it answers with a feed of pre-built offers, whereas a property
 * scoped widget needs an actual search run against the suppliers.
 *
 * THE FLOW (every booking journey shares it)
 *   POST /search                       -> opens a session, returns searchSession
 *   GET  /search/{searchSession}        -> polled until completed >= total
 *
 * A `searchSession` comes back as `{searchId}/{searchKey}` — an integer, a
 * slash, then a guid — and the WHOLE thing goes into the path. Do not split it.
 * Splitting it is what produced "Unrecognised API method" on 14 Sep 2026 and
 * sent this project chasing a missing endpoint that was never missing; the
 * documentation lists it as a common pitfall for exactly that reason.
 *
 * POLLING, and why the numbers are what they are
 *   - At least 1s between polls. The docs are explicit that hitting it harder
 *     returns nothing sooner, because the wait is suppliers answering.
 *   - Each poll returns ONLY results new since the last one, so the caller must
 *     accumulate. `reloadAll=true` on the FIRST poll returns everything
 *     collected so far, which is what we want after opening a session.
 *   - The documented ceiling is 30 polls. The sweep uses fewer by default: an
 *     accommodation search scoped to one property settles quickly, and 30
 *     hotels x 30s would not fit in a cron window.
 *
 * AUTHENTICATION (Andy, 14 Sep 2026: use the public key, not a private one)
 *   Token auth, the same public credentials the widgets already use, with a
 *   Referer header — which the docs make mandatory for Token auth, and without
 *   which the API answers 401. No private key is needed and none is held.
 *
 * WHAT IS NOT HERE YET
 *   `buildAccommodationCriteria` is a stub. The one field still to confirm is
 *   the one that scopes an accommodation search to a single property by its TTI
 *   code — the deeplink spells it `refn=TTI:{code}`. Everything either side of
 *   that is finished and tested.
 */

export const TRAVELIFY_API = 'https://api.travelify.io';

// Token auth requires a Referer and 401s without one. Andy's instruction,
// 14 Sep 2026: send this value. It is not a real page, it is the origin the
// credentials are registered against for server-side use.
export const SEARCH_REFERER = 'https://localhost/';

// The results shape asked for. version=4 is what the live results engine sends.
export const RESULTS_VERSION = '4';

// Documented ceiling is 30. See the note above on why the sweep runs lower.
export const MAX_POLLS = 30;
export const DEFAULT_MAX_POLLS = 12;
export const POLL_INTERVAL_MS = 1100;   // "at least 1 second", with headroom
export const REQUEST_TIMEOUT_MS = 20000;

/** Token auth, exactly as the docs specify it. Credentials never leave the
 *  server: callers pass them in, this module never reads them from config. */
export function searchHeaders(appId, publicKey) {
  return {
    Authorization: `Token ${String(appId).trim()}:${String(publicKey).trim()}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Referer: SEARCH_REFERER,
  };
}

/** A session is "{searchId}/{searchKey}". Validate the SHAPE rather than
 *  splitting it: the whole string is the path segment, and a malformed one must
 *  never be interpolated into a URL. */
export function isValidSession(session) {
  return /^\d{1,15}\/[A-Za-z0-9-]{8,64}$/.test(String(session || ''));
}

/** The URL a poll goes to. `reloadAll` only on the first one. */
export function resultsUrl(session, { reloadAll = false, productType = '' } = {}) {
  if (!isValidSession(session)) return '';
  const q = new URLSearchParams({
    returnAllData: 'false',
    version: RESULTS_VERSION,
    reloadAll: reloadAll ? 'true' : 'false',
  });
  if (productType) q.set('productType', productType);
  // The session already carries its own slash. Encode each half so a hostile
  // value cannot escape the path, then rejoin — never encode the separator.
  const [id, key] = String(session).split('/');
  return `${TRAVELIFY_API}/search/${encodeURIComponent(id)}/${encodeURIComponent(key)}?${q}`;
}

/** A 200 with success:false is a failure and the reason is in errors[]. The
 *  docs call this out; treating the status code alone as the verdict is the
 *  single easiest way to mis-read this API. */
export function readBody(data) {
  if (!data || typeof data !== 'object') return { ok: false, error: 'no body' };
  if (data.success === false) {
    const errs = Array.isArray(data.errors) ? data.errors.filter(Boolean) : [];
    return { ok: false, error: errs.join('; ') || 'the search was rejected', data };
  }
  return { ok: true, data };
}

async function call(url, init, timeoutMs) {
  try {
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs || REQUEST_TIMEOUT_MS) });
    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text); } catch { /* non-JSON handled below */ }
    if (!data) return { ok: false, status: r.status, error: `non-JSON answer (${r.status})` };
    const read = readBody(data);
    // 417 is a supplier-side business error (sold out, unavailable), not a bug
    // in the request. Surface it as such so a sweep does not retry it forever.
    if (r.status === 417) return { ok: false, status: 417, supplierError: true, error: read.error || 'unavailable', data };
    if (!r.ok) return { ok: false, status: r.status, error: read.error || `HTTP ${r.status}`, data };
    return { ...read, status: r.status };
  } catch (e) {
    const timedOut = e && e.name === 'TimeoutError';
    return { ok: false, error: timedOut ? 'timed out' : (e && e.message) || 'request failed', timedOut };
  }
}

/** Open a search session. Returns the session string on success. */
export async function startSearch(creds, criteria, opts = {}) {
  const r = await call(`${TRAVELIFY_API}/search`, {
    method: 'POST',
    headers: searchHeaders(creds.appId, creds.apiKey),
    body: JSON.stringify(criteria),
  }, opts.timeoutMs);
  if (!r.ok) return r;
  const session = r.data && r.data.searchSession;
  if (!isValidSession(session)) {
    return { ok: false, error: 'the search opened but returned no usable session', data: r.data };
  }
  return { ok: true, session, data: r.data };
}

/** Poll one session to completion, accumulating results.
 *
 *  `pick` says which result array to collect (e.g. 'accommodationResults'), so
 *  the same loop serves accommodation and dynamic packaging without branching.
 *  `sleep` is injectable purely so tests do not wait real seconds. */
export async function pollResults(creds, session, opts = {}) {
  const pick = opts.pick || 'accommodationResults';
  const maxPolls = Math.min(opts.maxPolls || DEFAULT_MAX_POLLS, MAX_POLLS);
  const wait = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const headers = searchHeaders(creds.appId, creds.apiKey);

  const collected = [];
  let polls = 0;
  let complete = false;
  let last = null;

  for (let i = 0; i < maxPolls; i++) {
    if (i) await wait(opts.intervalMs || POLL_INTERVAL_MS);
    polls++;
    const r = await call(resultsUrl(session, { reloadAll: i === 0, productType: opts.productType }), { headers }, opts.timeoutMs);
    if (!r.ok) {
      // A single failed poll mid-flight is not fatal while polls remain: the
      // session is still filling and the next one may answer. Only give up
      // when the session itself is gone or we are out of attempts.
      last = r;
      if (r.data && r.data.isSessionTimeout) return { ok: false, error: 'the search session expired', polls, results: collected };
      if (i === maxPolls - 1) break;
      continue;
    }
    last = r;
    const arr = r.data && r.data[pick];
    if (Array.isArray(arr) && arr.length) collected.push(...arr);
    const total = Number(r.data && r.data.total);
    const done = Number(r.data && r.data.completed);
    if (Number.isFinite(total) && Number.isFinite(done) && done >= total) { complete = true; break; }
  }

  if (!collected.length && last && !last.ok) {
    return { ok: false, error: last.error, polls, results: [], complete };
  }
  // Running out of polls is not an error: partial results are still results,
  // and a sweep that threw them away would cache nothing on a busy night.
  return { ok: true, results: collected, polls, complete, data: last && last.data };
}

/** Open a search and poll it out in one call. */
export async function runSearch(creds, criteria, opts = {}) {
  const opened = await startSearch(creds, criteria, opts);
  if (!opened.ok) return opened;
  const polled = await pollResults(creds, opened.session, opts);
  return { ...polled, session: opened.session };
}
