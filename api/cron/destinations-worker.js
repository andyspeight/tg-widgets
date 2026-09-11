/**
 * GET/POST /api/cron/destinations-worker  (Vercel Cron, every minute)
 *
 * The thing that actually does the work Andy queued.
 *
 * IT DOES NOTHING UNLESS THERE IS SOMETHING TO DO. An empty queue is a read of
 * one Redis key and an immediate return, so this costs nothing to leave on the
 * schedule. That is the difference between this and the crons paused earlier
 * today: those went looking for work every night whether or not any existed.
 *
 * IT STOPS ITSELF on any of three conditions, and says which:
 *   - the runner has been switched off from the dashboard, or the queue is empty
 *   - the day's budget is spent, for the paid work only
 *   - it is running out of function time
 *
 * IT DELIBERATELY DOES NOT READ THE OLD PAUSE SWITCH. That switch exists to
 * stop SCHEDULED jobs writing to this base unattended, and it stays on: the
 * nightly re-verify is still off the schedule and the manual reference routes
 * are still shut. This is the opposite kind of work. Nothing here happens until
 * Andy presses a button, and the queue it drains holds only the records he
 * chose. Making his own button wait on a switch meant for unattended crons
 * would mean the button silently did nothing.
 *
 * Each item is claimed with a short Redis lock, so two overlapping runs cannot
 * take the same record, and an item whose function dies simply comes back when
 * the lock lapses. Nothing is lost, nothing is done twice.
 *
 * AUTH: Authorization: Bearer ${CRON_SECRET}, same as every other cron here.
 */

import { TYPES } from '../_lib/destination-coverage.js';
import {
  queueConfigured, claim, complete, release, getSettings, setSettings, budgetState,
  recordSpendUsd, setRunState, pendingCount, noteOutcome, FAIL_STREAK,
} from '../_lib/fill/_queue.js';
import { fillPlanFor } from '../_lib/fill/_registry.js';
import { runItem } from '../_lib/fill/_run.js';
import { readRecord, writeField, shapeRecord } from '../_lib/fill/_airtable.js';

const BATCH = parseInt(process.env.DFILL_BATCH || '4', 10);
const TIME_BUDGET_MS = 45000;          // leave room under the function's ceiling

const typeOf = key => TYPES.find(t => t.key === key);

/** Who sits above whom. Airports and attractions carry no parent link. */
const PARENT_OF = { resort: 'city', city: 'country' };

export default async function handler(req, res) {
  const auth = req.headers['authorization'] || '';
  const secret = process.env.CRON_SECRET || '';
  if (!secret || auth !== `Bearer ${secret}`) { res.statusCode = 401; return res.end('Unauthorized'); }

  const done = (body) => {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    return res.end(JSON.stringify(body));
  };

  if (!queueConfigured()) return done({ ok: true, skipped: 'no queue configured' });

  const pending = await pendingCount().catch(() => 0);
  if (!pending) {
    await setRunState({ state: 'idle', pending: 0 }).catch(() => {});
    return done({ ok: true, idle: true });
  }

  const settings = await getSettings();
  if (!settings.running) {
    await setRunState({ state: 'stopped', pending, note: 'the runner is switched off' }).catch(() => {});
    return done({ ok: true, stopped: true, pending });
  }
  const started = Date.now();
  const workerId = 'w' + Math.random().toString(36).slice(2, 8);
  const results = [];
  let spent = 0;

  // Claim more than we will work. Anything the runner cannot fill costs
  // nothing to discard, so a run can clear a lot of dead queue and still do a
  // full batch of real work. Without this, 498 items queued for a field with no
  // fixer would take two hours to drain at four a minute, writing the same
  // sentence into the held list five hundred times on the way.
  const items = await claim(BATCH * 8, workerId);
  await setRunState({ state: 'working', pending, batch: items.length }).catch(() => {});

  let worked = 0;
  for (const item of items) {
    if (Date.now() - started > TIME_BUDGET_MS) { await release(item.id); continue; }

    const spec = typeOf(item.type);
    if (!spec) {
      results.push(await complete(item.id, { result: 'skipped', reason: 'unknown content type', place: item.recordId }));
      continue;
    }

    const field = spec.fields[item.fieldIdx];
    const plan = field ? fillPlanFor(field) : null;

    // Drop what this runner has no fixer for, quietly. It is not "held" — held
    // means a person needs to look, and there is nothing here to look at.
    if (!plan || plan.kind === 'fact' || plan.kind === 'manual' || plan.kind === 'source') {
      results.push(await complete(item.id, {
        result: 'skipped',
        place: item.recordId,
        field: field ? field.label : 'field ' + item.fieldIdx,
        reason: plan && plan.kind === 'fact'
          ? 'needs two independent sources to agree, and that fixer is not built yet'
          : plan && plan.kind === 'source'
            ? (plan.why || 'this needs a source we do not hold')
            : 'not a field the runner writes',
      }));
      continue;
    }

    // Past here is real work, and real work is rationed.
    if (worked >= BATCH) { await release(item.id); continue; }
    worked++;

    const paid = plan.kind === 'write';

    // Check the money before starting, not after spending it.
    let allowPaid = true;
    if (paid) {
      const budget = await budgetState();
      if (!budget.roomForPaidWork) {
        await release(item.id);
        await setRunState({
          state: 'waiting', pending,
          note: 'the day\'s budget of $' + budget.capUsd.toFixed(2) + ' is spent',
        }).catch(() => {});
        break;                                   // leave the rest queued for tomorrow
      }
      allowPaid = true;
    }

    let outcome;
    try {
      const raw = await readRecord(spec.tableId, item.recordId);
      const record = shapeRecord({ raw, spec });

      // Ancestors, for inheritance and for the writer's context. The
      // hierarchy is stated rather than inferred: a resort's parent is a city
      // and a city's parent is a country, always.
      const byId = new Map();
      if (record) {
        byId.set(record.id, record);
        let parentType = PARENT_OF[spec.key];
        let parentId = record.parentId;
        while (parentId && parentType) {
          const pSpec = typeOf(parentType);
          if (!pSpec) break;
          const p = shapeRecord({ raw: await readRecord(pSpec.tableId, parentId).catch(() => null), spec: pSpec });
          if (!p) break;
          byId.set(p.id, p);
          parentId = p.parentId;
          parentType = PARENT_OF[parentType];
        }
      }

      outcome = await runItem({ item, spec, record, byId, writeBack: writeField, allowPaid });
    } catch (err) {
      outcome = { result: 'held', reason: String(err.message || err), place: item.recordId, field: field ? field.label : '', costUsd: 0 };
    }

    spent += outcome.costUsd || 0;
    results.push(await complete(item.id, outcome));

    // THE CIRCUIT BREAKER. On 11 Sep Andy ran a 375-record job twice. Every
    // single item was held for the same reason, it took two hours a time, and
    // it cost $4.14 to learn nothing. A run that is failing wholesale is not
    // working, so stop it and say so rather than grinding to the end of the
    // queue. The queue is left intact: he decides whether to resume.
    const streak = await noteOutcome(outcome.result === 'saved');
    if (streak >= FAIL_STREAK) {
      await setSettings({ running: false });
      await setRunState({
        state: 'stopped',
        pending: await pendingCount().catch(() => 0),
        note: 'Stopped itself: the last ' + streak + ' in a row were held and none saved. ' +
              'Last reason was "' + String(outcome.reason || 'not given') + '".',
        stoppedBecause: 'nothing was saving',
        lastReason: String(outcome.reason || ''),
      }).catch(() => {});
      console.log('[destinations-worker] circuit breaker', JSON.stringify({ streak, reason: outcome.reason }));
      break;
    }
  }

  if (spent > 0) await recordSpendUsd(spent).catch(() => {});

  const left = await pendingCount().catch(() => 0);
  const saved = results.filter(r => r.result === 'saved').length;
  const held = results.filter(r => r.result === 'held').length;
  const skipped = results.filter(r => r.result === 'skipped').length;
  await setRunState({
    state: left ? 'working' : 'idle',
    pending: left, lastBatch: results.length, saved, held,
  }).catch(() => {});

  console.log('[destinations-worker]', JSON.stringify({ took: results.length, saved, held, skipped, spentUsd: +spent.toFixed(4), left }));

  return done({ ok: true, processed: results.length, saved, held, skipped, spentUsd: +spent.toFixed(4), pending: left });
}
