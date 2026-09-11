/**
 * The work queue, the day's budget, and what got held.
 *
 * WHY A QUEUE AND NOT A LOOP. "Do all" on the Official Website job is 498
 * records. At a few seconds each that is half an hour of work, and a serverless
 * function gets 300 seconds. So the button does not do the work: it writes the
 * work down. A cron worker then drains the queue a few items at a time, and
 * because every item is removed only once it has been dealt with, a function
 * that dies mid-batch loses nothing but the item it was holding.
 *
 * Everything lives in Redis, which this repo already runs for the offers cache
 * and the monitor. Keys:
 *
 *   dfill:pending    sorted set, member "type:recordId:fieldIdx", score = priority
 *   dfill:lock:<id>  short-lived claim so two workers cannot take the same item
 *   dfill:done       capped list of what happened, newest first (the audit trail)
 *   dfill:held       capped list of what was held and why (Andy's queue)
 *   dfill:spend:<d>  the day's spend in USD micros, an integer so it can be INCR'd
 *   dfill:settings   the cap, and whether the runner is on
 *   dfill:runstate   what the worker last did, for the dashboard to show
 *
 * THE BUDGET IS CHECKED BEFORE EACH ITEM, NOT AFTER. Andy's mockup showed money
 * reserved for calls in flight, and that is the right shape: an item is only
 * started if the day's remaining budget covers its estimated cost, and the
 * actual cost is recorded when it finishes. A cap that is only noticed after
 * the spend is not a cap.
 */

import {
  configured, zrangebyscore, zrem, setJson, getJson,
  lpushCapped, lrange, getString, setString, claimNxEx, del, pipeline, zcard,
} from '../../_redis.js';
import { estimateFieldUsd } from './_model.js';

const K = {
  pending: 'dfill:pending',
  done: 'dfill:done',
  held: 'dfill:held',
  settings: 'dfill:settings',
  runstate: 'dfill:runstate',
  lock: id => 'dfill:lock:' + id,
  spend: day => 'dfill:spend:' + day,
  streak: 'dfill:failstreak',
  tally: day => 'dfill:tally:' + day,
};

/** How many held in a row, with nothing saved, before the worker gives up. */
export const FAIL_STREAK = 10;

const LOG_CAP = 500;
const HELD_CAP = 500;
const LOCK_SECONDS = 180;
const DEFAULT_CAP_USD = 10;

export function queueConfigured() { return configured(); }

export const itemId = (type, recordId, fieldIdx) => type + ':' + recordId + ':' + fieldIdx;
export function parseItem(id) {
  const [type, recordId, fieldIdx] = String(id).split(':');
  return { type, recordId, fieldIdx: Number(fieldIdx) };
}

export function today() { return new Date().toISOString().slice(0, 10); }

/* ------------------------------------------------------------------ *
 * Settings: the cap, and the on switch
 * ------------------------------------------------------------------ */

export async function getSettings() {
  const s = (await getJson(K.settings).catch(() => null)) || {};
  return {
    capUsd: Number.isFinite(s.capUsd) ? s.capUsd : DEFAULT_CAP_USD,
    running: s.running === true,
    updatedAt: s.updatedAt || null,
  };
}

export async function setSettings(patch) {
  const now = await getSettings();
  const next = {
    capUsd: patch.capUsd != null ? Math.max(0, Number(patch.capUsd) || 0) : now.capUsd,
    running: patch.running != null ? !!patch.running : now.running,
    updatedAt: new Date().toISOString(),
  };
  await setJson(K.settings, next);
  return next;
}

/* ------------------------------------------------------------------ *
 * Money. Stored as integer micros so INCR is safe.
 * ------------------------------------------------------------------ */

const toMicros = usd => Math.round(Number(usd || 0) * 1e6);
const fromMicros = m => Number(m || 0) / 1e6;

export async function spentTodayUsd() {
  const raw = await getString(K.spend(today())).catch(() => null);
  return fromMicros(parseInt(raw || '0', 10) || 0);
}

export async function recordSpendUsd(usd) {
  const micros = toMicros(usd);
  if (micros <= 0) return;
  const key = K.spend(today());
  // INCR by one is not enough: spend arrives in arbitrary amounts, so read,
  // add and write. Contention here costs at most a rounding error on one item,
  // and the worker is single-flight anyway.
  const raw = await getString(key).catch(() => null);
  await setString(key, String((parseInt(raw || '0', 10) || 0) + micros));
}

/**
 * Is there room for one more editorial item?
 * Derived and factual work costs nothing, so it is never blocked by the budget.
 */
export async function budgetState() {
  const [settings, spent] = await Promise.all([getSettings(), spentTodayUsd()]);
  const perItem = estimateFieldUsd();
  const remaining = Math.max(0, settings.capUsd - spent);
  return {
    capUsd: settings.capUsd,
    spentUsd: spent,
    remainingUsd: remaining,
    perItemUsd: perItem,
    roomForPaidWork: remaining >= perItem,
    itemsAffordable: perItem > 0 ? Math.floor(remaining / perItem) : 0,
  };
}

/* ------------------------------------------------------------------ *
 * The queue
 * ------------------------------------------------------------------ */

/**
 * Add work. Items already queued are simply re-scored, so pressing "do all"
 * twice does not double the work.
 * @param {Array<{type,recordId,fieldIdx,priority}>} items
 */
export async function enqueue(items) {
  // One round trip per chunk, not one per record. Queueing 498 records as 498
  // separate calls is what timed the endpoint out on 10 Sep; a chunked pipeline
  // does the same work in three requests.
  const CHUNK = 250;
  let added = 0;
  for (let i = 0; i < items.length; i += CHUNK) {
    const slice = items.slice(i, i + CHUNK);
    const cmds = slice.map(it => [
      'ZADD', K.pending,
      // Higher priority first: the sorted set reads low-to-high, so negate.
      String(-(Number(it.priority) || 0)),
      itemId(it.type, it.recordId, it.fieldIdx),
    ]);
    const out = await pipeline(cmds);
    if (out === null) throw new Error('the queue could not be written to');
    added += slice.length;
  }
  return added;
}

export async function pendingCount() {
  return await zcard(K.pending);
}

export async function peek(limit = 20) {
  const all = await zrangebyscore(K.pending, '-inf', '+inf').catch(() => []);
  return (all || []).slice(0, limit).map(parseItem);
}

/**
 * Take up to `limit` items and lock them. An item whose lock cannot be taken is
 * already in another worker's hands and is skipped, not waited for.
 */
export async function claim(limit = 5, workerId = 'w') {
  const all = await zrangebyscore(K.pending, '-inf', '+inf').catch(() => []);
  const out = [];
  for (const id of (all || [])) {
    if (out.length >= limit) break;
    const got = await claimNxEx(K.lock(id), workerId, LOCK_SECONDS).catch(() => false);
    if (got) out.push({ id, ...parseItem(id) });
  }
  return out;
}

/** Done with an item, whatever the outcome. It leaves the queue either way. */
export async function complete(id, outcome) {
  await zrem(K.pending, id).catch(() => {});
  await del(K.lock(id)).catch(() => {});
  const entry = { id, at: new Date().toISOString(), ...outcome };
  await lpushCapped(K.done, JSON.stringify(entry), LOG_CAP).catch(() => {});
  if (outcome && outcome.result === 'held') {
    await lpushCapped(K.held, JSON.stringify(entry), HELD_CAP).catch(() => {});
  }
  return entry;
}

/** Put an item back, unlocked, for the next pass. Used when the budget runs out. */
export async function release(id) {
  await del(K.lock(id)).catch(() => {});
}

/**
 * Empty the queue. Stop has to be fast and has to work even when the queue is
 * enormous, because a runaway queue is exactly when you press it: deleting the
 * whole key in one command beats removing five hundred members one at a time.
 */
export async function clearQueue() {
  const n = await zcard(K.pending);
  const all = await zrangebyscore(K.pending, '-inf', '+inf').catch(() => []);
  const cmds = [['DEL', K.pending]].concat((all || []).slice(0, 900).map(id => ['DEL', K.lock(id)]));
  await pipeline(cmds);
  return n;
}

const readLog = async (key, limit) => {
  const raw = await lrange(key, 0, Math.max(0, limit - 1)).catch(() => []);
  return (raw || []).map(s => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean);
};

export const recentDone = (limit = 50) => readLog(K.done, limit);
export const heldAside = (limit = 100) => readLog(K.held, limit);

/**
 * Count a real outcome, and return the current run of consecutive failures.
 *
 * A save resets the run to zero. Anything else adds one. The worker stops when
 * this reaches FAIL_STREAK, which is the difference between learning a job
 * cannot run for a few pence and learning it for $4.14 over two hours.
 */
export async function noteOutcome(saved) {
  const day = today();
  const tally = (await getJson(K.tally(day)).catch(() => null)) || { saved: 0, held: 0 };
  if (saved) tally.saved += 1; else tally.held += 1;
  await setJson(K.tally(day), tally).catch(() => {});

  if (saved) { await setString(K.streak, '0').catch(() => {}); return 0; }
  const now = Number(await getString(K.streak).catch(() => 0)) || 0;
  const next = now + 1;
  await setString(K.streak, String(next)).catch(() => {});
  return next;
}

/** A fresh press of a button is a fresh start, whatever went before. */
export async function resetFailStreak() {
  await setString(K.streak, '0').catch(() => {});
}

export async function todayTally() {
  return (await getJson(K.tally(today())).catch(() => null)) || { saved: 0, held: 0 };
}

export async function clearHeld() {
  await del(K.held).catch(() => {});
}

/* ------------------------------------------------------------------ *
 * What the worker last did, so the dashboard can say something true
 * ------------------------------------------------------------------ */

export async function setRunState(patch) {
  const now = (await getJson(K.runstate).catch(() => null)) || {};
  // A patch that does not carry a note CLEARS the old one. Merging it forward
  // meant "the runner is switched off" sat in orange on Andy's screen long
  // after the runner had finished, describing a moment that had passed.
  const carried = Object.prototype.hasOwnProperty.call(patch, 'note')
    ? now
    : { ...now, note: '', stoppedBecause: '', lastReason: '' };
  const next = { ...carried, ...patch, at: new Date().toISOString() };
  await setJson(K.runstate, next);
  return next;
}

export async function getRunState() {
  return (await getJson(K.runstate).catch(() => null)) || {};
}

/** Everything the dashboard needs in one read. */
export async function queueStatus() {
  const [settings, budget, pending, run, held, done, tally] = await Promise.all([
    getSettings(), budgetState(), pendingCount(), getRunState(),
    heldAside(100), recentDone(50), todayTally(),
  ]);

  // The most common reason, so the page can say WHY a run saved nothing
  // instead of only that it did.
  const heldToday = held.filter(h => (h.at || '').slice(0, 10) === today());
  const byReason = {};
  for (const h of heldToday) {
    const r = String(h.reason || 'not given').slice(0, 120);
    byReason[r] = (byReason[r] || 0) + 1;
  }
  const top = Object.entries(byReason).sort((a, b) => b[1] - a[1])[0];

  return {
    settings,
    budget,
    pending,
    run,
    heldCount: held.length,
    held: held.slice(0, 50),
    recent: done.slice(0, 25),
    // Real counters. These used to be read off the last 50 log entries, so
    // they could never exceed 50 and were not today's totals at all.
    savedToday: tally.saved || 0,
    heldToday: tally.held || 0,
    topHeldReason: top ? { reason: top[0], count: top[1] } : null,
  };
}

export const KEYS = K;
