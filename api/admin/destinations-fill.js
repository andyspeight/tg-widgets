/**
 * /api/admin/destinations-fill — the buttons on the dashboard.
 *
 * GET                      what the runner is doing, what it has spent, what it held
 * POST {action:'queue'}    add work: one record's field, or a whole job
 * POST {action:'settings'} the daily cap and the on switch
 * POST {action:'stop'}     empty the queue
 * POST {action:'clearHeld'} clear the held-aside list once Andy has read it
 *
 * IT QUEUES, IT DOES NOT FILL. Andy presses a button on 498 records; the work
 * takes far longer than a serverless function lives. So this writes the work
 * down and returns immediately, and api/cron/destinations-worker.js drains it.
 * That also means a browser tab closing mid-run costs nothing.
 *
 * Nothing here writes to the destination base. The only thing that does is the
 * worker, and only one field at a time, and only through the gate.
 *
 * Admin-gated, same as the dashboard it serves.
 */
import { requireAdmin, setAdminCors } from './_guard.js';
import { TYPES } from '../_lib/destination-coverage.js';
import { fillPlanFor, estimatePence } from '../_lib/fill/_registry.js';
import { estimateFieldUsd } from '../_lib/fill/_model.js';
import {
  queueConfigured, enqueue, queueStatus, clearQueue, setSettings, clearHeld, budgetState,
} from '../_lib/fill/_queue.js';

const MAX_QUEUE = 2000;   // one press should not be able to queue the whole library

const typeOf = key => TYPES.find(t => t.key === key);

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  return res.end(JSON.stringify(body));
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

export default async function handler(req, res) {
  setAdminCors(req, res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }

  const gate = requireAdmin(req);
  if (gate.error) return json(res, gate.status, { error: gate.error });

  if (!queueConfigured()) {
    return json(res, 503, { error: 'The work queue needs Redis, which is not configured on this deployment.' });
  }

  if (req.method === 'GET') {
    try {
      return json(res, 200, await queueStatus());
    } catch (err) {
      console.error('[destinations-fill] status', err);
      return json(res, 502, { error: 'Could not read the runner state.' });
    }
  }

  if (req.method !== 'POST') return json(res, 405, { error: 'GET or POST' });

  const body = await readBody(req);
  const action = String(body.action || '');

  try {
    if (action === 'settings') {
      const next = await setSettings({
        capUsd: body.capUsd,
        running: body.running,
      });
      return json(res, 200, { ok: true, settings: next, budget: await budgetState() });
    }

    if (action === 'stop') {
      const removed = await clearQueue();
      await setSettings({ running: false });
      return json(res, 200, { ok: true, removed, ...(await queueStatus()) });
    }

    if (action === 'clearHeld') {
      await clearHeld();
      return json(res, 200, { ok: true, ...(await queueStatus()) });
    }

    if (action === 'queue') {
      const spec = typeOf(String(body.type || ''));
      if (!spec) return json(res, 400, { error: 'unknown content type' });

      const fieldIdx = Number(body.fieldIdx);
      const field = spec.fields[fieldIdx];
      if (!field) return json(res, 400, { error: 'unknown field' });

      const plan = fillPlanFor(field);
      if (plan.kind === 'manual') {
        return json(res, 400, {
          error: 'This field is not one the runner writes. ' + (plan.why || ''),
        });
      }
      // Refuse work that could only ever be held. On 10 Sep this endpoint
      // happily queued 498 airports for Official Website, a two-source fact
      // whose fixer is not built, and the worker then held four a minute for
      // an hour achieving nothing. Saying no here is the honest answer.
      if (plan.kind === 'fact') {
        return json(res, 400, {
          error: field.label + ' is a fact that needs two independent sources to agree, ' +
                 'and that fixer is not built yet. Queueing it would hold every record ' +
                 'without filling any. Try a written field such as Overview or Tagline.',
        });
      }

      // The browser sends the record ids it is showing, so the queue matches
      // exactly what Andy was looking at when he pressed the button.
      const ids = Array.isArray(body.recordIds) ? body.recordIds.filter(s => /^rec[A-Za-z0-9]{14}$/.test(s)) : [];
      if (!ids.length) return json(res, 400, { error: 'no records to work on' });
      if (ids.length > MAX_QUEUE) {
        return json(res, 400, { error: 'That is ' + ids.length + ' records at once. Narrow it below ' + MAX_QUEUE + ' and go again.' });
      }

      const items = ids.map((recordId, i) => ({
        type: spec.key, recordId, fieldIdx,
        priority: ids.length - i,          // keep the order the dashboard showed
      }));

      const added = await enqueue(items);
      await setSettings({ running: true });

      const perItem = plan.kind === 'write' ? estimateFieldUsd() : 0;
      return json(res, 200, {
        ok: true,
        queued: added,
        kind: plan.kind,
        estimateUsd: perItem * added,
        ...(await queueStatus()),
      });
    }

    return json(res, 400, { error: 'unknown action' });
  } catch (err) {
    console.error('[destinations-fill]', action, err);
    return json(res, 502, { error: String(err.message || err) });
  }
}

/** Exported for the dashboard's estimate, so the two never drift. */
export { estimatePence };
