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
