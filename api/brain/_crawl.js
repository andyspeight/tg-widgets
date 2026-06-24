/**
 * Luna Brain — source crawl engine.
 *
 * Pulls candidate facts from a client's own trusted sources (their website and
 * any configured DiscoverSources), grounded ONLY in the page they came from,
 * and runs each through the gate. Each draft is verified against the exact page
 * it was extracted from (passed to the gate as the cited source), so a fact can
 * never outrun its evidence.
 *
 * Source-grounded only: the extractor is forbidden from using outside knowledge.
 * The gate is the second, independent check.
 *
 * SSRF: only public http(s) URLs are fetched; private, loopback and metadata
 * hosts are refused even though the source list is owner-configured.
 */

import {
  listKnowledge, createKnowledge, getClientSources,
  KF, STATUS, CONFIDENCE,
} from './_luna.js';
import { gateOne } from './_gate.js';
import { fetchText as fetchUrlText, safeUrl } from '../_lib/webfetch.js';
import { similarity } from './_text.js';

const MODEL = process.env.BRAIN_GATE_MODEL_A || process.env.BRAIN_GATE_MODEL || 'claude-sonnet-4-6';
const MAX_PAGES = 5;
const MAX_PER_PAGE = 4;
const PAGE_BYTES = 200000;
const SOURCE_CHARS = 8000; // page text fed to the extractor / gate

function clamp(s, n) { s = (s == null ? '' : String(s)); return s.length > n ? s.slice(0, n) : s; }

// SSRF guard, fetchText and htmlToText now live in ../_lib/webfetch.js.

// ---- extraction (source-grounded only) ------------------------------------
async function callAnthropic({ system, user, temperature = 0.2, maxTokens = 1200 }) {
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

async function extractCandidates(pageText) {
  const sys = [
    'You extract customer-facing FAQ pairs from ONE web page, for a travel business knowledge base.',
    'Use ONLY what is written on this page. Do not add anything from outside knowledge or assumptions.',
    `Return at most ${MAX_PER_PAGE} of the most useful, concrete pairs. Skip navigation, cookie notices and marketing fluff.`,
    'Each answer must be a faithful, plain-English restatement of what the page says. UK English, no em dash.',
    'Output ONLY JSON: {"items":[{"question":"...","answer":"..."}]}',
  ].join('\n');
  const user = `PAGE TEXT:\n${clamp(pageText, SOURCE_CHARS)}\n\nExtract the pairs. JSON only.`;
  const parsed = parseJson(await callAnthropic({ system: sys, user }));
  if (!parsed || !Array.isArray(parsed.items)) return [];
  return parsed.items
    .filter(i => i && String(i.question || '').trim() && String(i.answer || '').trim())
    .slice(0, MAX_PER_PAGE)
    .map(i => ({ question: clamp(i.question, 300).trim(), answer: clamp(i.answer, 2000).trim() }));
}

async function runPool(items, worker, size = 3) {
  const out = new Array(items.length); let i = 0;
  async function next() {
    const idx = i++; if (idx >= items.length) return;
    try { out[idx] = await worker(items[idx]); } catch (e) { out[idx] = { outcome: 'error', error: e?.message }; }
    return next();
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, next));
  return out;
}

/**
 * Crawl a client's sources and draft grounded facts through the gate.
 * @returns { pages, scanned, candidates, drafted, autoPublished, escalated, skipped, blocked, results[] }
 */
export async function runCrawl(clientId, { maxPages = MAX_PAGES } = {}) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');

  const { urls } = await getClientSources(clientId);
  const safe = []; let blocked = 0;
  for (const u of urls) { const s = safeUrl(u); if (s) safe.push(s); else blocked++; if (safe.length >= maxPages) break; }

  if (!safe.length) return { pages: urls.length, scanned: 0, candidates: 0, drafted: 0, autoPublished: 0, escalated: 0, skipped: 0, blocked, results: [] };

  // Existing client knowledge for dedupe.
  const existing = (await listKnowledge({ formula: `{Status}!="${STATUS.ARCHIVED}"`, maxRecords: 500 }).catch(() => []))
    .filter(r => (r.fields[KF.client] || []).includes(clientId));
  const existingQs = existing.map(r => r.fields[KF.question] || '').filter(Boolean);

  const seenThisRun = [];
  let scanned = 0;
  const allResults = [];

  for (const url of safe) {
    const text = await fetchUrlText(url);
    if (!text || text.length < 200) { allResults.push({ url, outcome: 'empty' }); continue; }
    scanned++;
    const host = (() => { try { return new URL(url).hostname; } catch { return 'source'; } })();
    const candidates = await extractCandidates(text).catch(() => []);

    const pageResults = await runPool(candidates, async (cand) => {
      // Dedupe against existing knowledge and anything drafted earlier this run.
      const dupExisting = existingQs.some(q => similarity(cand.question, q) >= 0.7);
      const dupRun = seenThisRun.some(q => similarity(cand.question, q) >= 0.7);
      if (dupExisting || dupRun) return { url, outcome: 'skipped' };
      seenThisRun.push(cand.question);

      const created = await createKnowledge({
        [KF.question]: cand.question,
        [KF.answer]: cand.answer,
        [KF.type]: 'FAQ',
        [KF.source]: 'Suggested by Luna',
        [KF.status]: STATUS.DRAFT,
        [KF.confidence]: CONFIDENCE.NEEDS_REVIEW,
        [KF.client]: [clientId],
        [KF.notes]: `[crawl ${clamp(host, 60)}] ${clamp(url, 200)}`,
      });
      // Verify against the exact page it came from.
      const gate = await gateOne(created.id, { extraEvidence: clamp(text, SOURCE_CHARS) }).catch((e) => ({ outcome: 'error', reason: e?.message }));
      return { url, outcome: gate.outcome === 'publish' ? 'published' : gate.outcome === 'escalate' ? 'escalated' : 'error', spotCheck: !!gate.spotCheck };
    });
    allResults.push(...pageResults);
  }

  const summary = { pages: safe.length, scanned, candidates: allResults.length, drafted: 0, autoPublished: 0, escalated: 0, skipped: 0, errors: 0, blocked, results: allResults };
  for (const r of allResults) {
    if (r.outcome === 'published') { summary.drafted++; summary.autoPublished++; }
    else if (r.outcome === 'escalated') { summary.drafted++; summary.escalated++; }
    else if (r.outcome === 'skipped') summary.skipped++;
    else if (r.outcome === 'error') summary.errors++;
  }
  return summary;
}
