/**
 * Rate limiting on auth endpoints.
 *
 * Uses Upstash Redis (already provisioned for Luna Chat).
 *
 * Required env vars:
 *   UPSTASH_REDIS_REST_URL
 *   UPSTASH_REDIS_REST_TOKEN
 *
 * Limits per endpoint (per IP, per email — whichever is stricter):
 *   POST /api/auth/signin                   — 10 attempts per 10 min per IP+email
 *   POST /api/auth/password/forgot          —  5 per hour per IP
 *   POST /api/auth/password/reset           — 10 per hour per IP
 *   POST /api/auth/invite/send              — 30 per hour per user
 *   POST /api/auth/invite/accept            —  5 per hour per IP
 *   GET  /api/auth/me                       — 60 per minute per session (light)
 *
 * Fail-closed if Redis is unreachable: we deny rather than allow. Auth is
 * security-critical — better to lock people out for 30s than open a brute-force
 * window during an outage. Logged so you can see it in Vercel logs.
 */

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

/**
 * Increment a counter and return the new value. Sets TTL on first write.
 * @returns {Promise<number|null>} count, or null if Redis unavailable
 */
async function incrWithTtl(key, ttlSeconds) {
  if (!REDIS_URL || !REDIS_TOKEN) return null;
  try {
    // Pipeline INCR + EXPIRE in a single round trip
    const res = await fetch(`${REDIS_URL}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${REDIS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify([
        ['INCR', key],
        ['EXPIRE', key, ttlSeconds, 'NX']
      ])
    });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data) ? Number(data[0]?.result) : null;
  } catch {
    return null;
  }
}

/**
 * Check whether a request is over the limit. Increments the counter as a
 * side effect — call once per request.
 *
 * @param {object} args
 * @param {string} args.bucket — short name e.g. 'signin', 'forgot'
 * @param {string} args.key — IP, email, userId etc — the per-actor identifier
 * @param {number} args.max — maximum hits in the window
 * @param {number} args.windowSeconds
 * @param {boolean} [args.failClosed=true] — deny when Redis is down
 * @returns {Promise<{ allowed: boolean, remaining: number, retryAfterSeconds: number }>}
 */
export async function checkRateLimit({ bucket, key, max, windowSeconds, failClosed = true }) {
  const redisKey = `rl:auth:${bucket}:${key}`;
  const count = await incrWithTtl(redisKey, windowSeconds);

  if (count === null) {
    // Redis unreachable
    if (failClosed) {
      console.warn(`[auth/ratelimit] Redis unreachable, failing closed for ${bucket}`);
      return { allowed: false, remaining: 0, retryAfterSeconds: 30 };
    }
    return { allowed: true, remaining: max, retryAfterSeconds: 0 };
  }

  if (count > max) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: windowSeconds
    };
  }

  return {
    allowed: true,
    remaining: Math.max(0, max - count),
    retryAfterSeconds: 0
  };
}

/**
 * Pre-configured limiters for each endpoint. Call from the route handler.
 */
export const limiters = {
  signin:        ({ key }) => checkRateLimit({ bucket: 'signin',       key, max: 10, windowSeconds: 600 }),
  forgot:        ({ key }) => checkRateLimit({ bucket: 'forgot',       key, max: 5,  windowSeconds: 3600 }),
  resetPassword: ({ key }) => checkRateLimit({ bucket: 'reset',        key, max: 10, windowSeconds: 3600 }),
  inviteSend:    ({ key }) => checkRateLimit({ bucket: 'inviteSend',   key, max: 30, windowSeconds: 3600 }),
  inviteAccept:  ({ key }) => checkRateLimit({ bucket: 'inviteAccept', key, max: 5,  windowSeconds: 3600 }),
  me:            ({ key }) => checkRateLimit({ bucket: 'me',           key, max: 60, windowSeconds: 60 })
};
