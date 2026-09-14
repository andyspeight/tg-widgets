/**
 * The runner's own guard rails: when it stops itself, and whether it can say why.
 *
 * Both tests here exist because of one morning. On 14 Sep 2026 Andy ran Official
 * Website across 600 airports. It saved 69, held 111, then switched itself off
 * with 360 left and showed him a line reading "the runner is switched off",
 * which told him nothing at all. Two separate faults, both covered below.
 *
 * Run: node tests/destinations-queue.cjs
 */
const assert = require('node:assert');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); pass++; }
  catch (err) { fail++; console.error(`  FAIL  ${name}\n        ${err.message}`); }
}

/* A Redis that lives in a variable. The queue reads its connection details
   from the environment at import time, so they are set before the import. */
process.env.UPSTASH_REDIS_REST_URL = 'https://redis.test';
process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';

const store = new Map();
globalThis.fetch = async (url, opts = {}) => {
  const rest = String(url).replace('https://redis.test/', '');
  const [command, ...args] = rest.split('/').map(decodeURIComponent);
  if (command === 'get') {
    return { ok: true, json: async () => ({ result: store.get(args[0]) ?? null }) };
  }
  if (command === 'set') {
    store.set(args[0], opts.body != null ? String(opts.body) : args[1]);
    return { ok: true, json: async () => ({ result: 'OK' }) };
  }
  return { ok: true, json: async () => ({ result: null }) };
};

(async () => {
  const q = await import(pathToFileURL(
    path.join(__dirname, '..', 'api', '_lib', 'fill', '_queue.js')).href);

  console.log('\nThe circuit breaker counts money, not disappointment');

  await t('ten paid failures in a row trip it', async () => {
    await q.resetFailStreak();
    let streak = 0;
    for (let i = 0; i < 10; i++) streak = await q.noteOutcome(false, true);
    assert.strictEqual(streak, 10);
    assert.ok(streak >= q.FAIL_STREAK, 'a run that burns money and saves nothing must stop');
  });

  await t('free work that cannot be corroborated never trips it', async () => {
    await q.resetFailStreak();
    let streak = 0;
    // Official Website can only be verified for about a fifth of airports, so a
    // long run of holds there is the normal answer and costs nothing.
    for (let i = 0; i < 200; i++) streak = await q.noteOutcome(false, false);
    assert.strictEqual(streak, 0);
    assert.ok(streak < q.FAIL_STREAK,
      'switching the whole runner off over free holds stops every later job too');
  });

  await t('a save clears the count', async () => {
    await q.resetFailStreak();
    for (let i = 0; i < 5; i++) await q.noteOutcome(false, true);
    assert.strictEqual(await q.noteOutcome(true, true), 0);
    assert.strictEqual(await q.noteOutcome(false, true), 1);
  });

  await t('a free hold is neutral, so it neither accuses nor forgives', async () => {
    await q.resetFailStreak();
    for (let i = 0; i < 4; i++) await q.noteOutcome(false, true);
    assert.strictEqual(await q.noteOutcome(false, false), 4, 'it must not add');
    assert.strictEqual(await q.noteOutcome(false, true), 5, 'nor wipe what came before');
  });

  await t('every outcome still shows in the day\'s tally', async () => {
    store.clear();
    await q.noteOutcome(true, false);
    await q.noteOutcome(false, false);
    await q.noteOutcome(false, true);
    const tally = await q.todayTally();
    assert.strictEqual(tally.saved, 1);
    assert.strictEqual(tally.held, 2, 'free holds are not counted against the run, but Andy still sees them');
  });

  console.log('\nWhat the dashboard is told after it stops');

  await t('a deliberate stop reads as a deliberate stop', async () => {
    store.clear();
    const s = await q.setRunState({ state: 'stopped', pending: 5, note: 'the runner is switched off' });
    assert.strictEqual(s.note, 'the runner is switched off');
    assert.ok(!s.stoppedBecause);
  });

  await t('the breaker\'s explanation survives the next tick', async () => {
    store.clear();
    await q.setRunState({
      state: 'stopped', pending: 360,
      note: 'Stopped itself: the last 10 in a row were held and none saved.',
      stoppedBecause: 'nothing was saving',
      lastReason: 'only one source names a website',
    });
    // What the worker now writes a minute later, having found the runner off.
    const prev = await q.getRunState();
    const after = await q.setRunState(prev.stoppedBecause
      ? { state: 'stopped', pending: 360, note: prev.note,
          stoppedBecause: prev.stoppedBecause, lastReason: prev.lastReason || '' }
      : { state: 'stopped', pending: 360, note: 'the runner is switched off' });
    assert.match(after.note, /Stopped itself/,
      'the one line that explained the stop must not be talked over every minute');
    assert.strictEqual(after.lastReason, 'only one source names a website');
  });

  await t('a run that simply finished carries no stale stop note', async () => {
    store.clear();
    await q.setRunState({ state: 'stopped', note: 'the runner is switched off' });
    const after = await q.setRunState({ state: 'idle', pending: 0 });
    assert.strictEqual(after.note, '', 'an old orange line describing a past moment is worse than none');
  });

  console.log('\nCounting a run bigger than the lists');

  await t('the day counters are not capped, even though the lists are', async () => {
    store.clear();
    // A real morning: 157 saved and 402 held, both past the list caps.
    for (let i = 0; i < 157; i++) await q.noteOutcome(true, false);
    for (let i = 0; i < 402; i++) await q.noteOutcome(false, false);

    const tally = await q.todayTally();
    assert.strictEqual(tally.saved, 157);
    assert.strictEqual(tally.held, 402);

    const st = await q.queueStatus();
    assert.strictEqual(st.savedToday, 157,
      'the dashboard counts a run from this, so capping it reports the cap as the result');
    assert.strictEqual(st.heldToday, 402);
    // The lists stay capped on purpose, which is exactly why the count above
    // cannot be derived from them. A run of 157 read as "saved 100".
    assert.ok((st.saved || []).length <= 100, 'the saved list is a sample, not a total');
  });

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
