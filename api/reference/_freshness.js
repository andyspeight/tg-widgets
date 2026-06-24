/**
 * Reference freshness re-verify engine.
 *
 * For airports whose Verified Date has lapsed, re-check the record's volatile
 * facts (terminals, transport, prices, status) against a cited source
 * (Wikipedia first, official site as fallback) and classify:
 *   - holds        : source still supports the record
 *   - drifted      : the source shows a likely factual change
 *   - unverifiable : source could not be fetched or did not cover it
 *
 * Disposition is conservative and OFF by default. The engine writes nothing
 * unless told to: `restampValid` re-stamps Verified Date on a clean hold,
 * `flagDrift` moves a drifted record to "In progress" for a human. Default is
 * a pure report, so a wrong AI call can never silently refresh stale data or
 * pull good data offline.
 *
 * Source-grounded: the verifier only compares against the fetched page, never
 * its own world knowledge.
 */

import {
  listDueAirports, restampVerified, setAirportStatus,
  AF, AIRPORT_STATUS,
} from './_ref.js';

const MODEL = process.env.BRAIN_GATE_MODEL_B || process.env.BRAIN_GATE_MODEL || 'claude-sonnet-4-6';
const SOURCE_CHARS = 8000;

function clamp(s, n) { s = (s == null ? '' : String(s)); return s.length > n ? s.slice(0, n) : s; }

// ---- web fetch (SSRF-guarded) ---------------------------------------------
function safeUrl(u) {
  let url; try { url = new URL(u); } catch { return null; }
  if (!/^https?:$/.test(url.protocol)) return null;
  const h = url.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return null;
  if (h === '169.254.169.254' || h === 'metadata.google.internal') return null;
  if (/^(127\.|10\.|0\.|169\.254\.|192\.168\.)/.test(h)) return null;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return null;
  if (h === '::1' || /^\[?(fc|fd|fe80)/.test(h)) return null;
  return url.toString();
}
function htmlToText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
}
async function fetchText(u) {
  const safe = safeUrl(u); if (!safe) return '';
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(safe, { signal: ctrl.signal, redirect: 'follow', headers: { 'User-Agent': 'LunaBrain/1.0 (+https://travelify.io)' } });
    if (!r.ok) return '';
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    if (ct && !/text|html|xml/.test(ct)) return '';
    return htmlToText((await r.text()).slice(0, 200000));
  } catch { return ''; } finally { clearTimeout(t); }
}

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
export async function runFreshness({ ttlDays = 30, limit = 15, restampValid = false, flagDrift = false, nowIso } = {}) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');
  const today = (nowIso || new Date().toISOString()).slice(0, 10);

  const due = await listDueAirports({ ttlDays, limit });
  if (!due.length) return { ttlDays, due: 0, checked: 0, holds: 0, drifted: 0, unverifiable: 0, errors: 0, restamped: 0, flagged: 0, items: [] };

  const items = await runPool(due, async (rec) => {
    const f = rec.fields;
    const src = (await fetchText(f[AF.wikipedia])) || (await fetchText(f[AF.official]));
    if (!src || src.length < 200) {
      return { id: rec.id, airport: `${f[AF.name]} (${f[AF.iata]})`, verdict: 'unverifiable', changes: [], notes: 'source could not be fetched' };
    }
    const v = await verifyAirport(rec, src);
    let action = 'none';
    if (v.verdict === 'holds' && restampValid) { await restampVerified(rec.id, today).catch(() => {}); action = 'restamped'; }
    if (v.verdict === 'drifted' && flagDrift) { await setAirportStatus(rec.id, AIRPORT_STATUS.IN_PROGRESS).catch(() => {}); action = 'flagged'; }
    return { id: rec.id, airport: `${f[AF.name]} (${f[AF.iata]})`, verdict: v.verdict, changes: v.changes, notes: v.notes, action };
  });

  const summary = { ttlDays, due: due.length, checked: items.length, holds: 0, drifted: 0, unverifiable: 0, errors: 0, restamped: 0, flagged: 0, items };
  for (const it of items) {
    if (it.verdict === 'holds') summary.holds++;
    else if (it.verdict === 'drifted') summary.drifted++;
    else if (it.verdict === 'error') summary.errors++;
    else summary.unverifiable++;
    if (it.action === 'restamped') summary.restamped++;
    if (it.action === 'flagged') summary.flagged++;
  }
  return summary;
}
