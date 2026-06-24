/**
 * Reference freshness re-verify engine (two-independent-source model).
 *
 * For airports whose Verified Date has lapsed, the AI re-checks the record
 * against TWO independent sources (the stored Source 1 / Source 2, falling back
 * to Wikipedia / official site to make two) and classifies:
 *   - verified     : two independent sources each still support the record
 *   - drifted      : a source shows a likely factual change
 *   - unverifiable : fewer than two sources reachable, or none confirm it
 *
 * A fact is only auto-confirmed when TWO independent sources agree. Anything
 * the AI cannot verify that way (one source, conflicting sources, nothing
 * reachable) is escalated to a human rather than guessed — the human is the
 * fallback, not the default reviewer.
 *
 * Disposition is OFF by default (pure report). `restampValid` re-stamps the
 * Verified Date on a clean two-source confirmation; `flagForHuman` moves a
 * drifted or unverifiable record to "In progress" for you.
 *
 * Source-grounded: each per-source check compares only against that fetched
 * page, never the model's own world knowledge.
 */

import {
  listDueAirports, restampVerified, setAirportStatus,
  AF, AIRPORT_STATUS,
} from './_ref.js';
import { fetchText } from '../_lib/webfetch.js';

const MODEL = process.env.BRAIN_GATE_MODEL_B || process.env.BRAIN_GATE_MODEL || 'claude-sonnet-4-6';
const SOURCE_CHARS = 8000;

function clamp(s, n) { s = (s == null ? '' : String(s)); return s.length > n ? s.slice(0, n) : s; }

// SSRF guard, fetchText and htmlToText now live in ../_lib/webfetch.js.

// ---- verifier -------------------------------------------------------------
async function callAnthropic({ system, user, temperature = 0.1, maxTokens = 700 }) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 28000);
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

const SYS = [
  'You re-verify a travel reference record against a freshly fetched SOURCE page. You are checking whether the record is still accurate, especially the things that change over time: terminal layout, airline moves, airport name changes, closures, transport links and prices, and any visa/entry notes.',
  'Use ONLY the SOURCE text. Do not use outside knowledge. If the source does not cover a point, that point is simply unverifiable, not wrong.',
  'Classify the record:',
  '- "holds": nothing in the source contradicts the record on the things it does cover.',
  '- "drifted": the source clearly shows a factual change from the record (name, terminals, a closed/opened line, a materially different price or rule).',
  '- "unverifiable": the source is empty, irrelevant, or covers none of the checkable facts.',
  'Be conservative: only say "drifted" for a clear, specific contradiction. List each change concretely.',
  'Output ONLY JSON: {"verdict":"holds|drifted|unverifiable","changes":["..."],"notes":"one short sentence"}',
].join('\n');

async function verifyAirport(rec, sourceText) {
  const f = rec.fields;
  const facts = [
    `Airport: ${f[AF.name] || ''} (${f[AF.iata] || ''}), ${f[AF.cityServed] || ''}, ${f[AF.countryText] || ''}`,
    `Overview: ${clamp(f[AF.overview], 700)}`,
    `Distance & drive time: ${clamp(f[AF.distance], 400)}`,
    `Terminals & airlines: ${clamp(f[AF.terminals], 400)}`,
    `Parking: ${clamp(f[AF.parking], 300)}`,
    `Lounges: ${clamp(f[AF.lounges], 300)}`,
  ].join('\n');
  const user = `RECORD FACTS:\n${facts}\n\nSOURCE:\n${clamp(sourceText, SOURCE_CHARS)}\n\nClassify. JSON only.`;
  const p = parseJson(await callAnthropic({ system: SYS, user }));
  if (!p) return { verdict: 'unverifiable', changes: [], notes: 'no parseable verdict' };
  return {
    verdict: ['holds', 'drifted', 'unverifiable'].includes(p.verdict) ? p.verdict : 'unverifiable',
    changes: Array.isArray(p.changes) ? p.changes.slice(0, 6).map(c => clamp(c, 200)) : [],
    notes: clamp(p.notes, 200),
  };
}

/**
 * Combine per-source verdicts into one. Pure and unit-tested.
 * A record is "verified" only when at least two independent sources hold and
 * none contradicts. Any conflict -> drifted. Otherwise -> unverifiable (human).
 */
export function combineVerdicts(perSource) {
  if (perSource.some(v => v === 'drifted')) return 'drifted';
  if (perSource.filter(v => v === 'holds').length >= 2) return 'verified';
  return 'unverifiable';
}

// Distinct source URLs to try, in priority order, deduped.
function sourceUrls(f) {
  const seen = new Set();
  return [f[AF.source1], f[AF.source2], f[AF.wikipedia], f[AF.official]]
    .filter(Boolean)
    .filter(u => { const k = String(u).toLowerCase().trim(); if (seen.has(k)) return false; seen.add(k); return true; });
}

async function runPool(items, worker, size = 3) {
  const out = new Array(items.length); let i = 0;
  async function next() {
    const idx = i++; if (idx >= items.length) return;
    try { out[idx] = await worker(items[idx]); } catch (e) { out[idx] = { verdict: 'error', error: e?.message }; }
    return next();
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, next));
  return out;
}

/**
 * @returns { ttlDays, due, checked, holds, drifted, unverifiable, errors,
 *            restamped, flagged, items[] }
 */
export async function runFreshness({ ttlDays = 30, limit = 15, restampValid = false, flagForHuman = false, nowIso } = {}) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');
  const today = (nowIso || new Date().toISOString()).slice(0, 10);

  const due = await listDueAirports({ ttlDays, limit });
  if (!due.length) return { ttlDays, due: 0, checked: 0, verified: 0, drifted: 0, unverifiable: 0, errors: 0, restamped: 0, flagged: 0, items: [] };

  const items = await runPool(due, async (rec) => {
    const f = rec.fields;
    const label = `${f[AF.name]} (${f[AF.iata]})`;

    // Fetch up to two independent, reachable sources.
    const fetched = [];
    for (const url of sourceUrls(f)) {
      if (fetched.length >= 2) break;
      const txt = await fetchText(url);
      if (txt && txt.length >= 200) fetched.push({ url, txt });
    }

    // Need two independent sources to auto-confirm; otherwise it's for a human.
    if (fetched.length < 2) {
      return { id: rec.id, airport: label, verdict: 'unverifiable', sourcesChecked: fetched.length, changes: [], notes: 'fewer than two sources reachable' };
    }

    const perSource = await Promise.all(fetched.map(s => verifyAirport(rec, s.txt)));
    const verdict = combineVerdicts(perSource.map(v => v.verdict));
    const changes = perSource.flatMap(v => v.changes).slice(0, 8);

    let action = 'none';
    if (verdict === 'verified' && restampValid) { await restampVerified(rec.id, today).catch(() => {}); action = 'restamped'; }
    else if (verdict !== 'verified' && flagForHuman) { await setAirportStatus(rec.id, AIRPORT_STATUS.IN_PROGRESS).catch(() => {}); action = 'flagged'; }

    return { id: rec.id, airport: label, verdict, sourcesChecked: fetched.length, sources: fetched.map(s => s.url), changes, action };
  });

  const summary = { ttlDays, due: due.length, checked: items.length, verified: 0, drifted: 0, unverifiable: 0, errors: 0, restamped: 0, flagged: 0, items };
  for (const it of items) {
    if (it.verdict === 'verified') summary.verified++;
    else if (it.verdict === 'drifted') summary.drifted++;
    else if (it.verdict === 'error') summary.errors++;
    else summary.unverifiable++;
    if (it.action === 'restamped') summary.restamped++;
    if (it.action === 'flagged') summary.flagged++;
  }
  return summary;
}
