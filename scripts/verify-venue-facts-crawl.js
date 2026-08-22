/**
 * Venue fact verifier — the crawl half of double verification. PRESERVED
 * here for the next rebuild; it ran as a temporary Vercel endpoint on
 * 22 Aug 2026 and was then removed from api/.
 *
 * To run it again (after rebuilding venue-facts.json):
 *   1. Copy this file to api/dev-venue-verify-probe.js on a work branch.
 *   2. Add to vercel.json "functions": { "api/dev-venue-verify-probe.js":
 *      { "maxDuration": 60 } } and push the branch (Vercel deploys a preview).
 *   3. Page through the plan from the preview URL:
 *      /api/dev-venue-verify-probe?offset=0&count=45&pad=110000
 *      (offset 0, 45, 90, ... until total is covered; count above 60 risks
 *      the 60s budget; pad pads the response so remote tooling persists it).
 *      Wikimedia throttles cloud-IP bursts: the endpoint retries once with
 *      backoff, but rerun any page with fetched:false rows and UNION the
 *      passes — a throttled fetch must never read as a refutation.
 *   4. Save each response body as verifypage-<offset>.json in one directory,
 *      then run: node scripts/verify-venue-facts.mjs <that-directory>
 *      which prunes api/_data/venue-facts.json to the confirmed facts.
 *   5. Delete the api/ copy and the vercel.json entry again.
 *
 * Policy (Andy, 22 Aug 2026): no made-up data, double verification on
 * everything. Each editorial fact on a venue sheet must be confirmed by TWO
 * independently maintained sources before it is shown. The pair here is the
 * Wikidata claim (already held) against the live Wikipedia article's own
 * infobox, fetched fresh; they are curated by different processes and
 * routinely disagree, which is what makes agreement worth something.
 *
 * For each venue this returns verdicts, not values: does the article's
 * infobox corroborate the capacity (any number within 1%), the opening year,
 * the official website's domain, and the city? It also checks the article
 * TITLE shares a real token with the venue's name or aliases, so a
 * coordinate-gated mismatch (the arena's neighbour) loses its whole match.
 * The assembler prunes everything unconfirmed.
 */
import { readFileSync } from 'node:fs';

const UA = 'tg-widgets-venue-verify/1.0 (one-off double-verification; andy.speight@agendas.group)';
const WP = 'https://en.wikipedia.org/w/api.php';

let PLAN = null;
function plan() {
  if (PLAN) return PLAN;
  const facts = JSON.parse(readFileSync(new URL('./_data/venue-facts.json', import.meta.url), 'utf8')).venues;
  const snap = JSON.parse(readFileSync(new URL('./_data/events-snapshot.json', import.meta.url), 'utf8'));
  const names = new Map(snap.venues.map((v) => [v.key, { name: v.name, aliases: v.aliases || [] }]));
  PLAN = Object.entries(facts)
    .filter(([, f]) => f.wiki)
    .sort()
    .map(([key, f]) => ({ key, f, n: names.get(key) || { name: key, aliases: [] } }));
  return PLAN;
}

async function api(params) {
  const url = WP + '?' + new URLSearchParams({ format: 'json', ...params }).toString();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(9000) });
      if (r.ok) return r.json();
    } catch (e) { /* back off */ }
    await new Promise((ok) => setTimeout(ok, 1800));
  }
  return null;
}

const fold = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const GENERIC = new Set(['stadium', 'stadion', 'stade', 'stadio', 'estadio', 'arena', 'park',
  'field', 'centre', 'center', 'hall', 'halle', 'the', 'de', 'di', 'da', 'am', 'an', 'der',
  'court', 'club', 'sports', 'sport', 'city', 'municipal', 'national', 'olympic', 'olimpico',
  'new', 'ex', 'formerly']);
const tokens = (t) => fold(t).replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 1 && !GENERIC.has(w));

async function verify(v) {
  const title = decodeURIComponent((v.f.wiki.split('/wiki/')[1] || '')).replace(/_/g, ' ');
  const d = await api({ action: 'parse', page: title, prop: 'wikitext', section: '0', redirects: '1' });
  const text = d && d.parse && d.parse.wikitext && d.parse.wikitext['*'];
  if (!text) return { key: v.key, fetched: false };

  const out = { key: v.key, fetched: true };

  // Article identity: the title (or a bolded lead alias) must share one real
  // token with the venue's name or aliases.
  const vTokens = new Set([].concat(...[v.n.name, ...v.n.aliases].map(tokens)));
  const leadNames = [title, ...(text.match(/'''([^']{2,60})'''/g) || []).map((m) => m.replace(/'''/g, ''))];
  out.titleOk = leadNames.some((t2) => tokens(t2).some((w) => vTokens.has(w)));

  const lines = text.split('\n');
  const grab = (re) => lines.filter((l) => re.test(l)).join(' ');

  if (v.f.cap) {
    const capLine = grab(/capacity/i);
    const nums = (capLine.match(/\d[\d,.]{2,}/g) || [])
      .map((x) => parseInt(x.replace(/[,.]/g, ''), 10)).filter((x) => x >= 200 && x <= 300000);
    out.capOk = nums.some((n) => Math.abs(n - v.f.cap) <= Math.max(50, v.f.cap * 0.01));
  }
  if (v.f.opened) {
    const yearLine = grab(/opened|built|inaugurat|broke.?ground|construction/i);
    out.openedOk = new RegExp('\\b' + v.f.opened + '\\b').test(yearLine);
  }
  if (v.f.web) {
    try {
      const host = new URL(v.f.web).hostname.replace(/^www\./, '');
      out.webOk = fold(text).includes(fold(host));
    } catch (e) { out.webOk = false; }
  }
  if (v.f.city) {
    out.cityOk = fold(text).includes(fold(v.f.city));
  }
  return out;
}

export default async function handler(req, res) {
  const all = plan();
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
  const count = Math.min(60, Math.max(1, parseInt(req.query.count, 10) || 45));
  const slice = all.slice(offset, offset + count);

  const rows = [];
  let i = 0;
  const worker = async () => {
    while (i < slice.length) {
      const v = slice[i++];
      try { rows.push(await verify(v)); }
      catch (e) { rows.push({ key: v.key, fetched: false, err: String(e && e.message).slice(0, 50) }); }
      await new Promise((ok) => setTimeout(ok, 350));
    }
  };
  await Promise.all([worker(), worker()]);

  res.setHeader('Cache-Control', 'no-store');
  const pad = Math.min(120000, Math.max(0, parseInt(req.query.pad, 10) || 0));
  res.status(200).json({ total: all.length, offset, count: slice.length, rows,
    pad: pad ? ' '.repeat(pad) : undefined });
}
