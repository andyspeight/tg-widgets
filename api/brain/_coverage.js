/**
 * Luna Brain — coverage gap engine.
 *
 * Proactively finds the things a travel business SHOULD have a verified answer
 * for but doesn't, and fills what it safely can.
 *
 * For one client:
 *   1. Diff a canonical travel-agent checklist against the client's existing
 *      (non-archived) knowledge to find missing topics.
 *   2. For each missing topic, try to draft an answer using ONLY the client's
 *      trusted source material (owner profile + website text). If the source
 *      supports it -> create a Draft and run the gate (so it still has to pass
 *      grounding + adversarial before going live). If the source does NOT
 *      contain it -> create an owner-question (a Knowledge Gap) instead. The
 *      engine never invents an answer.
 *
 * Safety: the engine only ever proposes. The two-step gate disposes. A draft
 * with no real support fails grounding and lands in the human queue.
 */

import {
  listKnowledge, createKnowledge, getClientProfile,
  listGaps, createGap,
  KF, GF, STATUS, CONFIDENCE, GAP_STATUS,
} from './_luna.js';
import { gateOne } from './_gate.js';

const MODEL = process.env.BRAIN_GATE_MODEL_A || process.env.BRAIN_GATE_MODEL || 'claude-sonnet-4-6';
const COVERAGE_MARK = '[coverage';

// The canonical things a travel agency's brain should be able to answer.
// key is stable; type seeds the gate's risk classification.
export const CHECKLIST = [
  { key: 'bonding',      topic: 'Financial protection', type: 'Policy',          question: 'Are my holiday and money financially protected (ATOL, ABTA, bonding)?' },
  { key: 'deposit',      topic: 'Deposit',              type: 'Pricing',         question: 'How much deposit do I need to pay to book?' },
  { key: 'balance',      topic: 'Balance and instalments', type: 'Pricing',      question: 'When is the balance due and can I pay in instalments?' },
  { key: 'cancellation', topic: 'Cancellation',         type: 'Policy',          question: 'What is your cancellation policy?' },
  { key: 'amendments',   topic: 'Amendments',           type: 'Policy',          question: 'Can I change my booking and are there any fees?' },
  { key: 'insurance',    topic: 'Travel insurance',     type: 'Policy',          question: 'Do you offer or require travel insurance?' },
  { key: 'documents',    topic: 'Passports and visas',  type: 'FAQ',             question: 'Do you help with passport and visa requirements?' },
  { key: 'payment',      topic: 'Payment methods',      type: 'Booking Process', question: 'What payment methods do you accept?' },
  { key: 'howtobook',    topic: 'How to book',          type: 'Booking Process', question: 'How do I book a holiday with you?' },
  { key: 'hours',        topic: 'Opening hours',        type: 'FAQ',             question: 'What are your opening hours?' },
  { key: 'contact',      topic: 'Contact',              type: 'FAQ',             question: 'How can I contact you?' },
  { key: 'specialisms',  topic: 'Specialisms',          type: 'Preference',      question: 'What types of holidays do you specialise in?' },
  { key: 'destinations', topic: 'Destinations',         type: 'Destination Note',question: 'Which destinations do you sell?' },
  { key: 'groups',       topic: 'Group bookings',       type: 'FAQ',             question: 'Do you arrange group or multi-family bookings?' },
  { key: 'accessibility',topic: 'Accessibility and dietary', type: 'FAQ',        question: 'Can you handle accessibility needs or dietary requirements?' },
  { key: 'children',     topic: 'Children and infants', type: 'Policy',          question: 'What are the rules and prices for children and infants?' },
  { key: 'aftercare',    topic: 'After you book',       type: 'FAQ',             question: 'What support do I get after booking and while I am away?' },
];

function clamp(s, n) { s = (s == null ? '' : String(s)); return s.length > n ? s.slice(0, n) : s; }

async function callAnthropic({ system, user, temperature = 0.2, maxTokens = 700 }) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 28000);
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: ctrl.signal,
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, temperature, system, messages: [{ role: 'user', content: user }] }),
    });
    if (!r.ok) throw new Error(`anthropic ${r.status}`);
    const data = await r.json();
    return (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
  } finally { clearTimeout(t); }
}

function parseJson(text) {
  let t = (text || '').trim().replace(/^```[a-zA-Z]*\s*/, '').replace(/\s*```$/, '').trim();
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a !== -1 && b !== -1 && b > a) t = t.slice(a, b + 1);
  try { return JSON.parse(t); } catch { return null; }
}

// Which checklist keys are NOT already covered by the client's questions.
async function findMissing(existingQuestions) {
  const sys = 'You map a travel business\'s existing FAQ questions onto a fixed checklist of topics. Return ONLY the checklist keys that are NOT already covered by an existing question. Output JSON: {"missing":["key", ...]}.';
  const user = [
    'CHECKLIST (key — topic):',
    CHECKLIST.map(c => `${c.key} — ${c.topic}: ${c.question}`).join('\n'),
    '',
    'EXISTING QUESTIONS the business already has answers for:',
    existingQuestions.length ? existingQuestions.map(q => `- ${clamp(q, 160)}`).join('\n') : '(none yet)',
    '',
    'Return the checklist keys with no matching existing question. JSON only.',
  ].join('\n');
  const parsed = parseJson(await callAnthropic({ system: sys, user, temperature: 0.1 }));
  const valid = new Set(CHECKLIST.map(c => c.key));
  if (!parsed || !Array.isArray(parsed.missing)) return null;
  return parsed.missing.filter(k => valid.has(k));
}

// Try to answer a single checklist item from the client's own source only.
async function draftFromSource(item, sourceText) {
  const sys = [
    'You draft a knowledge-base answer for a travel business, using ONLY the SOURCE provided. You must not use any outside knowledge or assumptions.',
    'If the source clearly contains the answer, write it in the business\'s voice (warm, plain UK English, no em dash). If the source does not contain it, set answerable=false and do not guess.',
    'Output ONLY JSON: {"answerable": boolean, "answer": "...", "basis": "the exact words from the source that support it"}',
  ].join('\n');
  const user = [
    'QUESTION to answer:', item.question, '',
    'SOURCE (the only thing you may use):', sourceText || '(empty)', '',
    'JSON only.',
  ].join('\n');
  const parsed = parseJson(await callAnthropic({ system: sys, user, temperature: 0.2 }));
  if (!parsed) return { answerable: false };
  return { answerable: parsed.answerable === true && !!String(parsed.answer || '').trim(), answer: clamp(parsed.answer, 2000).trim() };
}

async function runPool(items, worker, size = 3) {
  const out = new Array(items.length); let i = 0;
  async function next() {
    const idx = i++; if (idx >= items.length) return;
    try { out[idx] = await worker(items[idx]); } catch (e) { out[idx] = { key: items[idx].key, outcome: 'error', error: e?.message }; }
    return next();
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, next));
  return out;
}

/**
 * Run the coverage engine for one client.
 * @returns { missing, drafted, autoPublished, ownerQuestions, skipped, capped, results[] }
 */
export async function runCoverage(clientId, { limit = 12 } = {}) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');

  const profile = await getClientProfile(clientId).catch(() => ({ trusted: '', scanned: '', name: '' }));
  const sourceText = [profile.trusted, profile.scanned].filter(Boolean).join('\n\n');

  // Existing (non-archived) knowledge for this client — for the coverage diff
  // and so we never re-draft something already pending.
  const existing = (await listKnowledge({ formula: `{Status}!="${STATUS.ARCHIVED}"`, maxRecords: 500 }).catch(() => []))
    .filter(r => (r.fields[KF.client] || []).includes(clientId));
  const existingQuestions = existing.map(r => r.fields[KF.question] || '').filter(Boolean);

  const missingKeys = await findMissing(existingQuestions);
  if (!missingKeys) throw new Error('coverage classification failed');

  let missing = CHECKLIST.filter(c => missingKeys.includes(c.key));
  const capped = missing.length > limit;
  missing = missing.slice(0, limit);

  // Existing open owner-question gaps for this client, to avoid duplicates.
  const openGaps = (await listGaps({ formula: `OR({Status}="${GAP_STATUS.OPEN}",{Status}="${GAP_STATUS.IN_PROGRESS}")`, maxRecords: 300 }).catch(() => []))
    .filter(g => (g.fields[GF.client] || []).includes(clientId));
  const gapHasKey = (key) => openGaps.some(g => String(g.fields[GF.notes] || '').includes(`${COVERAGE_MARK}-owner-question ${key}]`));

  const nowIso = new Date().toISOString();

  const results = await runPool(missing, async (item) => {
    const draft = sourceText ? await draftFromSource(item, sourceText) : { answerable: false };

    if (draft.answerable) {
      const created = await createKnowledge({
        [KF.question]: item.question,
        [KF.answer]: draft.answer,
        [KF.type]: item.type,
        [KF.source]: 'Suggested by Luna',
        [KF.status]: STATUS.DRAFT,
        [KF.confidence]: CONFIDENCE.NEEDS_REVIEW,
        [KF.client]: [clientId],
        [KF.notes]: `${COVERAGE_MARK} ${item.key}] drafted from the business's own source`,
      });
      const gate = await gateOne(created.id).catch((e) => ({ outcome: 'error', reason: e?.message }));
      return { key: item.key, outcome: gate.outcome === 'publish' ? 'published' : 'drafted', spotCheck: !!gate.spotCheck };
    }

    // No trusted source — ask the owner. Skip if we already have that question.
    if (gapHasKey(item.key)) return { key: item.key, outcome: 'skipped' };
    await createGap({
      [GF.question]: item.question,
      [GF.client]: [clientId],
      [GF.status]: GAP_STATUS.OPEN,
      [GF.topic]: `Coverage: ${item.topic}`,
      [GF.lastSeenAt]: nowIso,
      [GF.notes]: `${COVERAGE_MARK}-owner-question ${item.key}] only the business can answer this`,
    });
    return { key: item.key, outcome: 'owner-question' };
  });

  const summary = { missing: missingKeys.length, drafted: 0, autoPublished: 0, ownerQuestions: 0, skipped: 0, errors: 0, capped, results };
  for (const r of results) {
    if (r.outcome === 'published') { summary.drafted++; summary.autoPublished++; }
    else if (r.outcome === 'drafted') summary.drafted++;
    else if (r.outcome === 'owner-question') summary.ownerQuestions++;
    else if (r.outcome === 'skipped') summary.skipped++;
    else summary.errors++;
  }
  return summary;
}
