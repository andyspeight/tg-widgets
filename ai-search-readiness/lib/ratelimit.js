'use strict';

/**
 * lib/ratelimit.js — per-IP rate limiting, applied BEFORE any outbound fetch.
 *
 * The order matters. This endpoint fetches arbitrary URLs on request, so
 * limiting after the fetch would leave it usable as a free scanning proxy.
 *
 * Upstash REST when it is configured, an in-memory sliding window when it is
 * not. If Upstash is unreachable we FAIL OPEN, because a Redis outage should
 * degrade the tool rather than take a public marketing page offline. The
 * in-memory window still applies in that case, so a fail-open is not a free
 * pass, it just stops being shared across serverless instances.
 */

const PER_MINUTE = 8;
const PER_HOUR = 40;

/* ------------------------------------------------------------------ *
 * In-memory sliding window
 * ------------------------------------------------------------------ */

function createMemoryStore() {
  const hits = new Map();
  let lastSweep = Date.now();

  function sweep(now) {
    if (now - lastSweep < 60000) return;
    lastSweep = now;
    for (const [key, times] of hits) {
      const kept = times.filter((t) => now - t < 3600000);
      if (kept.length) hits.set(key, kept);
      else hits.delete(key);
    }
  }

  return {
    record(key, now) {
      sweep(now);
      const times = (hits.get(key) || []).filter((t) => now - t < 3600000);
      times.push(now);
      hits.set(key, times);
      return {
        minute: times.filter((t) => now - t < 60000).length,
        hour: times.length,
        oldestInMinute: times.find((t) => now - t < 60000) || now,
        oldestInHour: times[0] || now,
      };
    },
    reset() {
      hits.clear();
    },
  };
}

/* ------------------------------------------------------------------ *
 * Upstash REST
 * ------------------------------------------------------------------ */

async function upstashCount(fetchImpl, url, token, key, ttlSeconds) {
  const res = await fetchImpl(`${url.replace(/\/$/, '')}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([
      ['INCR', key],
      ['EXPIRE', key, String(ttlSeconds), 'NX'],
    ]),
  });
  if (!res || !res.ok) throw new Error('upstash request failed');
  const body = await res.json();
  const first = Array.isArray(body) ? body[0] : null;
  const count = first && typeof first.result === 'number' ? first.result : null;
  if (count === null) throw new Error('unexpected upstash response');
  return count;
}

/* ------------------------------------------------------------------ *
 * Limiter
 * ------------------------------------------------------------------ */

/**
 * @param {{redisUrl?: string|null, redisToken?: string|null, fetchImpl?: Function, perMinute?: number, perHour?: number}} [config]
 */
function createLimiter(config = {}) {
  const {
    redisUrl = process.env.UPSTASH_REDIS_REST_URL || null,
    redisToken = process.env.UPSTASH_REDIS_REST_TOKEN || null,
    fetchImpl = typeof fetch === 'function' ? fetch : null,
    perMinute = PER_MINUTE,
    perHour = PER_HOUR,
  } = config;

  const memory = createMemoryStore();
  const useRedis = Boolean(redisUrl && redisToken && fetchImpl);

  /**
   * @param {string} key usually the client IP
   * @returns {Promise<{allowed:boolean, retryAfter:number, degraded:boolean, scope?:string}>}
   */
  async function check(key) {
    const now = Date.now();
    const id = String(key || 'unknown').slice(0, 128);

    // The local window always runs. It is the floor, and it is what keeps the
    // fail-open path honest.
    const local = memory.record(id, now);

    if (local.minute > perMinute) {
      return {
        allowed: false,
        retryAfter: Math.max(1, Math.ceil((60000 - (now - local.oldestInMinute)) / 1000)),
        degraded: false,
        scope: 'minute',
      };
    }
    if (local.hour > perHour) {
      return {
        allowed: false,
        retryAfter: Math.max(1, Math.ceil((3600000 - (now - local.oldestInHour)) / 1000)),
        degraded: false,
        scope: 'hour',
      };
    }

    if (!useRedis) {
      return { allowed: true, retryAfter: 0, degraded: false };
    }

    try {
      const minuteBucket = Math.floor(now / 60000);
      const hourBucket = Math.floor(now / 3600000);
      const [minuteCount, hourCount] = await Promise.all([
        upstashCount(fetchImpl, redisUrl, redisToken, `asr:m:${id}:${minuteBucket}`, 70),
        upstashCount(fetchImpl, redisUrl, redisToken, `asr:h:${id}:${hourBucket}`, 3700),
      ]);

      if (minuteCount > perMinute) {
        return { allowed: false, retryAfter: 60 - Math.floor((now % 60000) / 1000) || 1, degraded: false, scope: 'minute' };
      }
      if (hourCount > perHour) {
        return { allowed: false, retryAfter: 3600 - Math.floor((now % 3600000) / 1000) || 1, degraded: false, scope: 'hour' };
      }
      return { allowed: true, retryAfter: 0, degraded: false };
    } catch {
      // Redis is down. The local window has already been applied, so let it through.
      return { allowed: true, retryAfter: 0, degraded: true };
    }
  }

  return { check, reset: memory.reset, usingRedis: useRedis, perMinute, perHour };
}

module.exports = { createLimiter, PER_MINUTE, PER_HOUR };
