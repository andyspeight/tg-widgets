/**
 * One item, start to finish: work out the value, gate it, and only then write.
 *
 * The order is the whole point. Nothing reaches Airtable that has not been
 * through the same check that found the gap in the first place, and nothing
 * overwrites a value that is already good.
 *
 *   1  Re-read the record. The scan that queued this work may be ten minutes
 *      old and Andy may have filled the field himself in the meantime. If the
 *      field is now good, the item is "already done", not an overwrite.
 *   2  Produce a value: inherit it, source it, or write it.
 *   3  Gate it. Fail closed on anything unclear.
 *   4  Write the single field. Never the record, never a field we were not
 *      asked for.
 *
 * WHY IT ONLY EVER FILLS BLANKS AND FIXES BROKEN VALUES. Andy has 1,539 records
 * that people have worked on. A runner that improves what is already there is a
 * runner that can quietly undo a morning's editing, and no amount of gate is
 * worth that risk. If a field holds something usable, this leaves it alone.
 */

import { checkValue } from '../destination-coverage.js';
import { fillPlanFor } from './_registry.js';
import { derive, ancestorsOf } from './_derive.js';
import { writeField, buildEvidence } from './_write.js';
import { gate } from './_gate.js';
import { callModel, GATE_MODEL } from './_model.js';

/** The gate's verifier, wired to the cheap model, tallying its own spend. */
function makeAsk(spend) {
  return async ({ system, user, temperature }) => {
    const out = await callModel({ model: GATE_MODEL, system, user, temperature, maxTokens: 400 });
    spend.usd += out.costUsd;
    return out.text;
  };
}

/**
 * @param {object} args
 *   item      {type, recordId, fieldIdx}
 *   spec      the type spec from destination-coverage TYPES
 *   record    { id, name, group, parentId, values: {label: value}, fields: {fieldId: raw} }
 *   byId      Map of id -> record-shaped ancestors
 *   writeBack async ({tableId, recordId, fieldId, value}) => void
 *   allowPaid whether the budget has room for a model call
 * @returns {Promise<{result:'saved'|'held'|'skipped', ...}>}
 */
export async function runItem({ item, spec, record, byId, writeBack, allowPaid = true }) {
  const field = spec.fields[item.fieldIdx];
  const spend = { usd: 0 };
  const base = {
    type: item.type,
    recordId: item.recordId,
    place: record ? record.name : item.recordId,
    field: field ? field.label : 'field ' + item.fieldIdx,
  };

  if (!field) return { ...base, result: 'held', reason: 'that field no longer exists on the table', costUsd: 0 };
  if (!record) return { ...base, result: 'held', reason: 'the record could not be read', costUsd: 0 };

  // 1. Is it still a gap?
  const current = record.fields ? record.fields[field.id] : undefined;
  if (checkValue(current, field.kind) === 'filled') {
    return { ...base, result: 'skipped', reason: 'already filled since the scan', costUsd: 0 };
  }

  const plan = fillPlanFor(field);
  if (plan.kind === 'manual') {
    return { ...base, result: 'held', reason: plan.why || 'this field is not one the runner writes', costUsd: 0 };
  }

  // 2. Produce a value.
  let value, evidence, kind = plan.kind;
  const ancestors = ancestorsOf(record, byId);

  if (plan.kind === 'derive') {
    const d = derive({ field, how: plan.how, rec: record, byId });
    if (!d.ok) return { ...base, result: 'held', reason: d.why, costUsd: 0 };
    value = d.value;
    evidence = d.evidence;

  } else if (plan.kind === 'fact') {
    // The two-source engines this repo already runs (Open-Meteo against NASA
    // POWER for climate, OurAirports against Wikidata for airport identity) are
    // batch jobs over a whole table, not per-field lookups. Wiring them item by
    // item is its own piece of work, so until then a factual gap is reported
    // honestly rather than guessed at by a model that would happily oblige.
    return {
      ...base,
      result: 'held',
      reason: 'this needs two independent sources to agree, and the source fixer for it is not wired up yet',
      costUsd: 0,
    };

  } else {
    if (!allowPaid) {
      return { ...base, result: 'held', reason: 'the day\'s budget is spent, so this waits for tomorrow', costUsd: 0, retryable: true };
    }
    const w = await writeField({ field, brief: plan.brief, rec: record, ancestors, type: spec });
    spend.usd += w.costUsd || 0;
    if (!w.ok) return { ...base, result: 'held', reason: w.why, costUsd: spend.usd };
    value = w.value;
    evidence = w.evidence;
  }

  // 3. Gate it.
  const verdict = await gate({
    value, field, kind,
    evidence: evidence || buildEvidence({ rec: record, ancestors, type: spec }),
    place: record.name,
    ask: kind === 'write' ? makeAsk(spend) : undefined,
  });

  if (!verdict.save) {
    return { ...base, result: 'held', reason: verdict.reason, risk: verdict.risk, value, costUsd: spend.usd };
  }

  // 4. Write exactly one field.
  try {
    await writeBack({ tableId: spec.tableId, recordId: record.id, fieldId: field.id, value });
  } catch (err) {
    return { ...base, result: 'held', reason: 'the write to Airtable failed: ' + String(err.message || err), costUsd: spend.usd };
  }

  return {
    ...base,
    result: 'saved',
    reason: verdict.reason,
    risk: verdict.risk,
    kind,
    value: typeof value === 'string' && value.length > 160 ? value.slice(0, 160) + '…' : value,
    costUsd: spend.usd,
  };
}
