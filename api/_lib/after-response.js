/**
 * Work that must still happen after a function has answered its caller.
 *
 * Vercel freezes a function once its response has gone, so anything a handler
 * awaits AFTER res.json() may never run. That is what happened to the worker
 * nudge in the three intake endpoints (/api/v1/booking-confirmations,
 * /api/v1/booking-webhook, /api/v1/payment-reminders): each answered, then
 * awaited a fetch that never left. The production logs of 25 Sep 2026 show it:
 * Darren's confirmation request was accepted at 10:51:43 and nothing ran until
 * the five-minute sweep at 10:55:01, and no nudge ever appears in the logs.
 *
 * waitUntil tells the platform to keep the function alive until the promise
 * settles. Off the platform (tests, local runs) it does nothing, and the
 * returned promise is the one the caller already had, so `await` behaves as
 * before.
 */

import { waitUntil } from '@vercel/functions';

export function afterResponse(promise) {
  try { waitUntil(promise); } catch { /* not on the platform */ }
  return promise;
}
