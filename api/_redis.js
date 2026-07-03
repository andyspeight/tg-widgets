/**
 * Upstash Redis REST client helper.
 *
 * Reads UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN from env.
 * If either is missing, the helpers return null rather than throwing —
 * this keeps the never-empty fallback chain working when Redis is
 * misconfigured in a preview deploy or local dev.
 *
 * No TTLs on keys we set here — the world map cache must never expire.
 * It is only ever overwritten by a successful cron run.
 */

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || '';
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';

export function configured() {
  return !!(REDIS_URL && REDIS_TOKEN);
}

async function callRedis(command, ...args) {
  if (!configured()) return null;
  try {
    const res = await fetch(`${REDIS_URL}/${command}/${args.map(encodeURIComponent).join('/')}`, {
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
    });
    if (!res.ok) {
      console.error('[redis] HTTP', res.status, command);
      return null;
    }
    const j = await res.json();
    return j && Object.prototype.hasOwnProperty.call(j, 'result') ? j.result : null;
  } catch (e) {
    console.error('[redis] error', command, e.message);
    return null;
  }
}

/** SET key value, no TTL. Body is the value. */
export async function setJson(key, valueObject) {
  if (!configured()) return false;
  try {
    const body = JSON.stringify(valueObject);
    const res = await fetch(`${REDIS_URL}/set/${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${REDIS_TOKEN}`,
        'Content-Type': 'text/plain',
      },
      body,
    });
    if (!res.ok) {
      console.error('[redis] SET HTTP', res.status);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[redis] SET error', e.message);
    return false;
  }
}

/** GET key — returns parsed JSON or null. */
export async function getJson(key) {
  const raw = await callRedis('get', key);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

/** Set a plain string (used for lastRunAt timestamps). */
export async function setString(key, value) {
  if (!configured()) return false;
  try {
    const res = await fetch(`${REDIS_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
    });
    return res.ok;
  } catch { return false; }
}

export async function getString(key) {
  return await callRedis('get', key);
}

// ── Sorted sets + counters (used by the appointment booking index) ──
export async function zadd(key, score, member) {
  return await callRedis('zadd', key, String(score), member);
}
export async function zrangebyscore(key, min, max) {
  const r = await callRedis('zrangebyscore', key, String(min), String(max));
  return Array.isArray(r) ? r : [];
}
export async function zrem(key, member) {
  return await callRedis('zrem', key, member);
}
export async function incr(key) {
  const r = await callRedis('incr', key);
  return Number.isFinite(+r) ? +r : null;
}
export async function decr(key) {
  const r = await callRedis('decr', key);
  return Number.isFinite(+r) ? +r : null;
}
/** DEL key — returns the number of keys removed (0/1), or null if unconfigured. */
export async function del(key) {
  return await callRedis('del', key);
}

/** KEYS pattern — returns matching key names ([] if none/unconfigured).
 *  Fine here: the store holds a few dozen keys (one per country plus
 *  bookkeeping), so KEYS is cheap. Do not use on large keyspaces. */
export async function keys(pattern) {
  const r = await callRedis('keys', pattern);
  return Array.isArray(r) ? r : [];
}

// ── Lists (used by the widget telemetry log — a capped rolling buffer) ──
/** LPUSH key value — prepend. Returns new length or null. */
export async function lpush(key, value) {
  return await callRedis('lpush', key, value);
}
/** LTRIM key start stop — keep only the given range (caps the list). */
export async function ltrim(key, start, stop) {
  return await callRedis('ltrim', key, String(start), String(stop));
}
/** LRANGE key start stop — returns the slice as an array ([] if none). */
export async function lrange(key, start, stop) {
  const r = await callRedis('lrange', key, String(start), String(stop));
  return Array.isArray(r) ? r : [];
}

/**
 * SET key value only if absent, with a TTL (seconds). Returns true if it was
 * set (the key did not exist), false otherwise. Used as a dedupe/throttle gate
 * so one broken widget can't send a flood of alert emails.
 */
export async function setNxEx(key, value, ttlSeconds) {
  if (!configured()) return false;
  try {
    const url = `${REDIS_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}?NX=true&EX=${Math.max(1, Math.floor(ttlSeconds))}`;
    const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${REDIS_TOKEN}` } });
    if (!res.ok) return false;
    const j = await res.json();
    return j && j.result === 'OK';
  } catch (e) {
    console.error('[redis] setNxEx error', e.message);
    return false;
  }
}
