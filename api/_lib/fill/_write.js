/**
 * The editorial writer.
 *
 * It writes one field for one place, and it is deliberately given very little
 * rope. The brief comes from the field spec, the facts come from the record and
 * its parents, and the instruction is to work from those facts rather than from
 * whatever the model happens to associate with the name. Anything it produces
 * still has to survive the gate, so this file's job is not to be trusted — it
 * is to give the gate something worth passing.
 *
 * THE HOUSE VOICE IS A CONSTRAINT, NOT A SUGGESTION. Warm, plain, UK English,
 * no em dashes, no Oxford comma, no marketing cliche. Those come from CLAUDE.md
 * and the humaniser rules, and the gate rejects breaches outright, so stating
 * them here saves money rather than costing it.
 *
 * WHAT IT IS TOLD NOT TO DO matters more than what it is told to do. It must
 * not invent a named beach, a festival, a price or an opening time. Where it
 * does not know, the instruction is to write the general truth or to return
 * NOTHING, because a held record costs Andy a minute and a fabricated one costs
 * him a client.
 */

import { callModel, WRITER_MODEL } from './_model.js';

const VOICE = [
  'You write destination content for Travelgenix, whose customers are UK travel agents and their clients.',
  '',
  'VOICE',
  '- Warm and plain. Knowledgeable friend, not a brochure.',
  '- UK English throughout.',
  '- No em dashes. No Oxford comma. No exclamation marks.',
  '- Never use: hidden gem, nestled, bustling, vibrant tapestry, must-visit, breathtaking, delve, elevate, seamless, unleash.',
  '- Specific beats decorative. One real detail is worth three adjectives.',
  '- Do not open by restating the place name and the country.',
  '',
  'TRUTH',
  '- Work only from the FACTS given. They are what we hold about this place.',
  '- Never invent a named beach, hotel, restaurant, festival, price, distance or opening time.',
  '- If the facts do not support a specific claim, write the general truth instead.',
  '- If you cannot write the field honestly from what you are given, reply with exactly: INSUFFICIENT',
  '',
  'OUTPUT',
  '- Return the field value and nothing else. No preamble, no label, no quotes around it.',
].join('\n');

/** The facts we hold, as the writer sees them. Also the gate's evidence. */
export function buildEvidence({ rec, ancestors, type }) {
  const lines = [];
  lines.push(type.singular.replace(/^\w/, c => c.toUpperCase()) + ': ' + rec.name);
  if (ancestors && ancestors.length) {
    lines.push('Sits within: ' + ancestors.map(a => a.name).join(', then '));
  }
  if (rec.group) lines.push('Region: ' + rec.group);

  const known = Object.entries(rec.values || {})
    .filter(([, v]) => v != null && String(v).trim() !== '')
    .slice(0, 40);
  if (known.length) {
    lines.push('', 'What we already hold about it:');
    for (const [label, v] of known) {
      const s = String(v).replace(/\s+/g, ' ').trim();
      lines.push('- ' + label + ': ' + (s.length > 300 ? s.slice(0, 300) + '…' : s));
    }
  }

  // A parent's content is the best guard against inventing: a resort's country
  // overview tells the writer what is true of the area without it guessing.
  for (const a of (ancestors || []).slice(0, 2)) {
    const bits = ['Overview', 'Best Time to Visit', 'Region', 'Currency', 'Language', 'Time Zone']
      .map(l => [l, a.values && a.values[l]])
      .filter(([, v]) => v != null && String(v).trim() !== '');
    if (!bits.length) continue;
    lines.push('', 'What we hold about ' + a.name + ':');
    for (const [l, v] of bits) {
      const s = String(v).replace(/\s+/g, ' ').trim();
      lines.push('- ' + l + ': ' + (s.length > 400 ? s.slice(0, 400) + '…' : s));
    }
  }

  return lines.join('\n');
}

/**
 * Write one field.
 * @returns {{ok:true, value:string, evidence:string, costUsd:number} | {ok:false, why:string, costUsd:number}}
 */
export async function writeField({ field, brief, rec, ancestors, type }) {
  const evidence = buildEvidence({ rec, ancestors, type });

  const instruction = [
    'FIELD TO WRITE: ' + field.label,
    brief || (field.hint ? field.hint + '.' : ''),
    field.kind === 'json' ? 'Return valid JSON only.' : '',
    field.kind === 'prose' ? 'Prose, not a bulleted list.' : '',
  ].filter(Boolean).join('\n');

  let out;
  try {
    out = await callModel({
      model: WRITER_MODEL,
      system: VOICE,
      user: 'FACTS\n' + evidence + '\n\n' + instruction,
      maxTokens: field.kind === 'json' ? 1400 : 900,
    });
  } catch (err) {
    return { ok: false, why: String(err.message || err), costUsd: 0 };
  }

  const value = out.text.trim();
  if (!value || /^INSUFFICIENT$/i.test(value)) {
    return {
      ok: false,
      why: 'the writer said there was not enough to go on, which is the honest answer for this record',
      costUsd: out.costUsd,
    };
  }

  return { ok: true, value, evidence, costUsd: out.costUsd };
}
