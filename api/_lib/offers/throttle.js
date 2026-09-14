/**
 * Pacing and 429 handling for our own calls to Travelify.
 *
 * WHY THIS EXISTS
 *   The world-map cache refresh drives thousands of live searches an hour, and
 *   Travelify answers a share of them with HTTP 429. Our monitor's own probe
 *   then fails with the same 429 and emails an alert; that has been happening
 *   several times a day since late July. The client-facing path was never
 *   affected (widgets read the cache, never the live proxy), but a throttled
 *   cache fill means a cache that slowly stops being refreshed.
 *
 *   Two things made it worse than it needed to be. We retried a 429 after a
 *   flat 500ms, which is asking the same question again while still being told
 *   to wait. And nothing bounded the RATE: a country was swept at concurrency
 *   six as fast as the responses came back, so the average looked survivable
 *   while the bursts were not.
 *
 * WHAT IT PROVIDES
 *   parseRetryAfter — read the supplier's own answer to "when may I come back",
 *     in either of the two formats the header is allowed to take.
 *   createPacer     — space our requests evenly instead of firing them in
 *     bursts. Same work, spread out.
 *   createCircuit   — when we ARE told to back off, stop the run rather than
 *     spending the rest of it collecting more 429s.
 *
 *   The clock and sleep are injectable so the tests run instantly and
 *   deterministically rather than sleeping in real time.
 */

// Retry-After is either a number of seconds or an HTTP date (RFC 9110).
// Returns milliseconds to wait, or null when the header is absent or unusable.
// Clamped: a supplier answer of "come back in three hours" would park the cron
// for longer than its own lifetime, and a negative date is not a wait at all.
const MAX_RETRY_AFTER_MS = 5 * 60 * 1000;

export function parseRetryAfter(value, nowMs = Date.now()) {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  // Delta-seconds form: "120"
  if (/^\d+$/.test(raw)) {
    const ms = parseInt(raw, 10) * 1000;
    return Math.min(ms, MAX_RETRY_AFTER_MS);
  }

  // HTTP-date form: "Wed, 21 Oct 2026 07:28:00 GMT"
  const at = Date.parse(raw);
  if (!Number.isFinite(at)) return null;
  const ms = at - nowMs;
  if (ms <= 0) return 0;
  return Math.min(ms, MAX_RETRY_AFTER_MS);
}

/**
 * Space outgoing requests to at most `perMinute`, across every caller sharing
 * this pacer. `burst` slots may go straight through after an idle period, so a
 * small sweep is not slowed for no reason; a long one settles to the steady
 * rate. Returns { take, stats }.
 *
 * This is per-process, which is the right scope here: one cron invocation is
 * one process, runs do not overlap (every 10 minutes, 5 minute ceiling), and
 * the only other caller of the proxy is the monitor's single probe. A
 * Redis-backed pacer would also bound across instances, at the cost of a round
 * trip per request — thousands of extra Upstash calls per sweep to solve a
 * problem we do not have.
 */
export function createPacer({ perMinute = 60, burst = 5, now = Date.now, sleep } = {}) {
  const rate = Math.max(1, Number(perMinute) || 1);
  const intervalMs = 60000 / rate;
  const wait = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  let nextAt = null;   // null until the first take, so the bucket starts full
  let waited = 0;
  let taken = 0;

  async function take() {
    const t = now();
    // Start with the burst already banked, and never let idle time bank more
    // than that. Set explicitly rather than leaning on "nextAt starts at 0,
    // which is 1970 and therefore long past" — true with a wall clock, not
    // with an injected one, and not a thing to leave a reader to work out.
    const floor = t - intervalMs * Math.max(0, burst);
    if (nextAt === null || nextAt < floor) nextAt = floor;
    const delay = Math.max(0, nextAt - t);
    nextAt = nextAt + intervalMs;
    taken++;
    if (delay > 0) { waited += delay; await wait(delay); }
    return delay;
  }

  return {
    take,
    stats: () => ({ perMinute: rate, taken, waitedMs: Math.round(waited) }),
  };
}

/**
 * Trips when the supplier says to back off, and stays open until the wait it
 * asked for has passed. Callers check `open()` BEFORE spending a request, so a
 * throttled run stops adding to the problem instead of grinding through the
 * rest of its work collecting 429s.
 */
export function createCircuit({ now = Date.now, defaultCooloffMs = 60000 } = {}) {
  let until = 0;
  let trips = 0;
  let lastRetryAfterMs = null;

  return {
    /** Record a back-off instruction. `retryAfterMs` may be null (use default). */
    trip(retryAfterMs) {
      const ms = Number.isFinite(retryAfterMs) && retryAfterMs >= 0 ? retryAfterMs : defaultCooloffMs;
      lastRetryAfterMs = Number.isFinite(retryAfterMs) ? retryAfterMs : null;
      until = Math.max(until, now() + ms);
      trips++;
    },
    open() { return now() < until; },
    remainingMs() { return Math.max(0, until - now()); },
    tripped() { return trips > 0; },
    stats: () => ({ trips, lastRetryAfterMs, remainingMs: Math.max(0, until - now()) }),
  };
}
